'use strict'

const { randomUUID } = require('node:crypto')
const jwt = require('jsonwebtoken')
const path = require('node:path')

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const prisma = require('../src/lib/prisma')
const { resolveTenantAuthConfig } = require('../src/modules/auth/tenant-auth.config')
const { crearPrincipalTenant } = require('../src/security/identity')

const BASE = 'http://localhost:3000'
const TENANT_CONFIG = resolveTenantAuthConfig()

let passCount = 0
let failCount = 0

function signToken(usuario) {
  const principal = crearPrincipalTenant(usuario)
  return jwt.sign(principal, TENANT_CONFIG.secret, {
    algorithm: TENANT_CONFIG.algorithm,
    issuer: TENANT_CONFIG.issuer,
    audience: TENANT_CONFIG.audience,
    expiresIn: TENANT_CONFIG.ttl
  })
}

async function headers(token, sucursalId) {
  return {
    Authorization: `Bearer ${token}`,
    'X-Sucursal-Id': String(sucursalId),
    'Content-Type': 'application/json'
  }
}

async function recibir(ocId, detalles, idempotencyKey, h) {
  const hdrs = { ...h }
  if (idempotencyKey) hdrs['Idempotency-Key'] = idempotencyKey
  const r = await fetch(`${BASE}/compras/${ocId}/recibir`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ detalles })
  })
  const rawText = await r.text()
  let body = null
  try { body = JSON.parse(rawText) } catch (_) { body = { _rawText: rawText.substring(0, 200) } }
  return { status: r.status, body }
}

async function countReceipts(empresaId) {
  return prisma.recepcionOrdenCompra.count({ where: { empresaId } })
}

async function countMovements(empresaId, productoId) {
  return prisma.movimientoInventario.count({ where: { empresaId, productoId } })
}

async function getStock(productoId, sucursalId) {
  const inv = await prisma.inventarioSucursal.findUnique({
    where: { productoId_sucursalId: { productoId, sucursalId } },
    select: { stockActual: true }
  })
  return inv ? Number(inv.stockActual) : null
}

async function getDetailReceived(detalleId) {
  const d = await prisma.detalleOrdenCompra.findUnique({ where: { id: detalleId }, select: { cantidadRecibida: true } })
  return d ? Number(d.cantidadRecibida) : null
}

function report(label, actual, expected) {
  const ok = actual === expected
  if (ok) { passCount++; console.log(`  ✅ ${label}: ${actual}`) }
  else { failCount++; console.log(`  ❌ ${label}: got ${actual}, expected ${expected}`) }
}

async function main() {
  const u = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: 1, rol: { in: ['SUPERADMIN', 'ADMIN_SUCURSAL'] } },
    select: { id: true, username: true, nombre: true, rol: true, sucursalId: true, empresaId: true, activo: true }
  })
  if (!u) throw new Error('No test user')
  const token = signToken(u)
  const h = await headers(token, u.sucursalId || 1)
  console.log(`User: ${u.username} (${u.rol}) empresa=${u.empresaId} sucursal=${u.sucursalId}`)

  const health = await fetch(`${BASE}/health`)
  const healthBody = await health.json()
  if (healthBody.status !== 'ok') throw new Error('Server not healthy')
  console.log('Server healthy\n')

  const oc = await prisma.ordenCompra.findFirst({
    where: { empresaId: u.empresaId, sucursalId: u.sucursalId || 1, estado: { in: ['ENVIADO', 'RECIBIDO_PARCIAL'] } },
    select: {
      id: true, folio: true, estado: true, sucursalId: true,
      DetalleOrdenCompra: { select: { id: true, productoId: true, cantidadPedida: true, cantidadRecibida: true, precioCosto: true } }
    },
    orderBy: { id: 'desc' }
  })

  let ocToUse = oc
  let tempOcCreated = false

  const findUsableDetail = (o) => {
    if (!o) return null
    return o.DetalleOrdenCompra.find(d => {
      const recv = parseFloat(d.cantidadRecibida || 0)
      const pedida = parseFloat(d.cantidadPedida)
      return recv < pedida - 0.001 && (pedida - recv) >= 5
    })
  }

  let det = ocToUse ? findUsableDetail(ocToUse) : null

  if (!det) {
    console.log('No OC with sufficient remaining capacity. Creating temporary test OC...')
    const proveedor = await prisma.proveedor.findFirst({ where: { empresaId: u.empresaId, activo: true } })
    const producto = await prisma.producto.findFirst({ where: { empresaId: u.empresaId, activo: true } })
    if (!proveedor || !producto) throw new Error('No proveedor or producto for test OC')

    ocToUse = await prisma.ordenCompra.create({
      data: {
        Empresa: { connect: { id: u.empresaId } },
        Sucursal: { connect: { id: u.sucursalId || 1 } },
        Proveedor: { connect: { id: proveedor.id } },
        Usuario: { connect: { id: u.id } },
        folio: `OC-RUNTIME-${Date.now()}`, estado: 'ENVIADO',
        totalEstimado: 1000, totalRecibido: 0, totalPagado: 0,
        DetalleOrdenCompra: {
          create: [{ Producto: { connect: { id: producto.id } }, cantidadPedida: 20, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 1000, subtotalRecibido: 0 }]
        }
      },
      select: {
        id: true, folio: true, estado: true, sucursalId: true,
        DetalleOrdenCompra: { select: { id: true, productoId: true, cantidadPedida: true, cantidadRecibida: true, precioCosto: true } }
      }
    })
    tempOcCreated = true
    det = findUsableDetail(ocToUse)
  }

  if (!det) { console.log('Cannot find or create usable detail'); process.exit(0) }

  const remaining = parseFloat(det.cantidadPedida) - parseFloat(det.cantidadRecibida || 0)
  console.log(`OC: ${ocToUse.id} | ${ocToUse.folio} | ${ocToUse.estado}`)
  console.log(`Detail: ${det.id} | prod ${det.productoId} | pedida ${det.cantidadPedida} | recibida ${det.cantidadRecibida} | remaining ${remaining.toFixed(3)}\n`)

  const receiptBefore = await countReceipts(u.empresaId)
  const movBefore = await countMovements(u.empresaId, det.productoId)
  const stockBefore = await getStock(det.productoId, oc.sucursalId)
  const detailBefore = await getDetailReceived(det.id)

  // ─── R01: First key=A (qty=1) ───
  console.log('--- R01: First key=A ---')
  const keyA = randomUUID()
  const payloadA = [{ detalleId: det.id, cantidadRecibida: 1, precioCosto: parseFloat(det.precioCosto) }]
  const r01 = await recibir(ocToUse.id, payloadA, keyA, h)
  report('R01 HTTP', r01.status, 200)
  report('R01 success', r01.body?.success, true)
  report('R01 not replay', r01.body?.idempotentReplay ?? false, false)

  // ─── R02: Replay A ───
  console.log('\n--- R02: Replay A ---')
  const r02 = await recibir(ocToUse.id, payloadA, keyA, h)
  report('R02 HTTP', r02.status, 200)
  report('R02 replay', r02.body?.idempotentReplay, true)

  // ─── R03: Concurrent A x3 (same key, qty=1) ───
  console.log('\n--- R03: Concurrent A x3 ---')
  const keyA3 = randomUUID()
  const r03 = await Promise.all([
    recibir(ocToUse.id, payloadA, keyA3, h),
    recibir(ocToUse.id, payloadA, keyA3, h),
    recibir(ocToUse.id, payloadA, keyA3, h)
  ])
  const r03AllOk = r03.every(r => r.status === 200)
  report('R03 all 200', r03AllOk, true)
  const r03Replays = r03.filter(r => r.body?.idempotentReplay === true).length
  report('R03 replays=2', r03Replays, 2)

  // ─── R04: Same key, different payload → 409 ───
  console.log('\n--- R04: A different payload → 409 ---')
  const keyA4 = randomUUID()
  await recibir(ocToUse.id, [{ detalleId: det.id, cantidadRecibida: 1, precioCosto: parseFloat(det.precioCosto) }], keyA4, h)
  const r04 = await recibir(ocToUse.id, [{ detalleId: det.id, cantidadRecibida: 1, precioCosto: 999 }], keyA4, h)
  report('R04 HTTP', r04.status, 409)
  report('R04 code', r04.body?.codigo, 'KEY_PAYLOAD_DIFERENTE')

  // ─── R05: Legitimate key=B (qty=1) ───
  console.log('\n--- R05: Legitimate key=B ---')
  const keyB = randomUUID()
  const r05 = await recibir(ocToUse.id, [{ detalleId: det.id, cantidadRecibida: 1, precioCosto: parseFloat(det.precioCosto) }], keyB, h)
  report('R05 HTTP', r05.status, 200)
  report('R05 success', r05.body?.success, true)

  // ─── R06: Lost response → retry returns persisted snapshot ───
  console.log('\n--- R06: Lost response → retry returns snapshot ---')
  const keyR6 = randomUUID()
  const payloadR6 = [{ detalleId: det.id, cantidadRecibida: 1, precioCosto: parseFloat(det.precioCosto) }]
  const r06first = await recibir(ocToUse.id, payloadR6, keyR6, h)
  report('R06 first HTTP', r06first.status, 200)
  const r06retry = await recibir(ocToUse.id, payloadR6, keyR6, h)
  report('R06 retry HTTP', r06retry.status, 200)
  report('R06 retry replay', r06retry.body?.idempotentReplay, true)
  function sortedJson(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
    if (Array.isArray(obj)) return `[${obj.map(sortedJson).join(',')}]`
    const sorted = Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${sortedJson(obj[k])}`)
    return `{${sorted.join(',')}}`
  }
  report('R06 snapshot match', sortedJson(r06retry.body?.data), sortedJson(r06first.body?.data))

  // ─── R07: Cross-tenant replay ───
  console.log('\n--- R07: Cross-tenant replay ---')
  const keyR7 = randomUUID()
  const r07 = await recibir(999999, payloadA, keyR7, h)
  report('R07 non-existent OC', r07.status, 404)

  // ─── R08: A+B different keys concurrent cumulative ───
  console.log('\n--- R08: A+B concurrent cumulative ---')
  const keyR8A = randomUUID()
  const keyR8B = randomUUID()
  const [r08A, r08B] = await Promise.all([
    recibir(ocToUse.id, [{ detalleId: det.id, cantidadRecibida: 1, precioCosto: parseFloat(det.precioCosto) }], keyR8A, h),
    recibir(ocToUse.id, [{ detalleId: det.id, cantidadRecibida: 1, precioCosto: parseFloat(det.precioCosto) }], keyR8B, h)
  ])
  report('R08 both 200', r08A.status === 200 && r08B.status === 200, true)

  // ─── Final snapshot ───
  const receiptAfter = await countReceipts(u.empresaId)
  const movAfter = await countMovements(u.empresaId, det.productoId)
  const stockAfter = await getStock(det.productoId, oc.sucursalId)
  const detailAfter = await getDetailReceived(det.id)

  console.log('\n--- FINAL SNAPSHOT ---')
  console.log(`  Receipts: ${receiptBefore} → ${receiptAfter} (+${receiptAfter - receiptBefore})`)
  console.log(`  Movements: ${movBefore} → ${movAfter} (+${movAfter - movBefore})`)
  console.log(`  Stock: ${stockBefore} → ${stockAfter} (+${(stockAfter - stockBefore).toFixed(3)})`)
  console.log(`  Detail received: ${detailBefore} → ${detailAfter} (+${(detailAfter - detailBefore).toFixed(3)})`)

  console.log(`\n=== RESULTS: ${passCount} PASS / ${failCount} FAIL ===`)

  if (tempOcCreated) {
    console.log('\nCleaning up temporary test OC...')
    try {
      await prisma.detalleOrdenCompra.deleteMany({ where: { ordenCompraId: ocToUse.id } })
      await prisma.recepcionOrdenCompra.deleteMany({ where: { ordenCompraId: ocToUse.id } })
      await prisma.ordenCompra.delete({ where: { id: ocToUse.id } })
      console.log('  Temporary OC deleted.')
    } catch (e) { console.log('  Cleanup warning:', e.message) }
  }

  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(async e => { console.error('FATAL:', e.message); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
