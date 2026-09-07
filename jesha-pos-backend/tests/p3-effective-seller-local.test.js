'use strict'

// ═══════════════════════════════════════════════════════════════════════
//  P3-EFFECTIVE-SELLER — LOCAL E2E INTEGRATION TEST
//  Runs ONLY when RUN_LOCAL_E2E=1
//  Requires: local PostgreSQL with jesha_db, .env with TENANT_JWT_SECRET
// ═══════════════════════════════════════════════════════════════════════

const RUN = process.env.RUN_LOCAL_E2E === '1'
if (!RUN) {
  console.log('LOCAL_E2E skipped (set RUN_LOCAL_E2E=1 to enable)')
  process.exit(0)
}

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const http = require('http')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const prisma = require('../src/lib/prisma')

// ─── Safety: refuse non-local DB ──────────────────────────────────────
const dbUrl = process.env.DATABASE_URL || ''
if (!/localhost|127\.0\.0\.1|::1/.test(dbUrl) || !/jesha_db/.test(dbUrl)) {
  console.error('LOCAL_E2E REFUSED: must target localhost jesha_db only')
  process.exit(1)
}

// ─── Tenant auth config ──────────────────────────────────────────────
const TENANT_SECRET  = process.env.TENANT_JWT_SECRET
const TENANT_ISSUER  = process.env.TENANT_JWT_ISSUER
const TENANT_AUD     = process.env.TENANT_JWT_AUDIENCE

// ─── Constants ────────────────────────────────────────────────────────
const EMPRESA_ID      = 1
const SESSION_A_ID    = 2    // Admin Sucursal
const SELLER_B_ID     = 3    // Empleado POS
const BRANCH_ID       = 1    // Ferretería JESHA TYL
const SELLER_B_PIN    = '1234'

// ─── Helpers ──────────────────────────────────────────────────────────
let server, baseUrl
const productIds = []
const createdVentaIds = []

function signTenantToken(user) {
  return jwt.sign(
    { version: 1, kind: 'TENANT', sub: user.id, nombre: user.nombre, username: user.username, rol: user.rol, empresaId: user.empresaId, sucursalId: user.sucursalId },
    TENANT_SECRET,
    { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUD, expiresIn: '1h' }
  )
}

function httpRequest(method, path, data, token, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl)
    const headers = { ...extraHeaders }
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (data) {
      const body = JSON.stringify(data)
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(body)
    }
    const opts = {
      hostname: '127.0.0.1', port: server.address().port,
      path: url.pathname + url.search, method, headers
    }
    const req = http.request(opts, res => {
      let b = ''
      res.on('data', c => b += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }) }
        catch { resolve({ status: res.statusCode, body: b }) }
      })
    })
    req.on('error', reject)
    if (data) req.write(JSON.stringify(data))
    req.end()
  })
}

const GET  = (p, t, h) => httpRequest('GET',  p, null, t, h)
const POST = (p, d, t, h) => httpRequest('POST', p, d, t, h)

// ─── Setup / Teardown ─────────────────────────────────────────────────
let bOriginal

before(async () => {
  // Get admin user from DB for real token signing
  const admin = await prisma.usuario.findUnique({
    where: { id: SESSION_A_ID },
    select: { id: true, nombre: true, username: true, rol: true, empresaId: true, sucursalId: true }
  })
  if (!admin) throw new Error(`Admin user id=${SESSION_A_ID} not found`)
  // Verify it's a valid tenant user
  assert.ok(admin.empresaId, 'admin has empresaId')
  assert.ok(admin.sucursalId, 'admin has sucursalId')
  assert.ok(['ADMIN_SUCURSAL', 'SUPERADMIN'].includes(admin.rol), `admin rol=${admin.rol}`)

  // Save and configure seller B
  bOriginal = await prisma.usuario.findUnique({ where: { id: SELLER_B_ID }, select: { tienePin: true, pin: true } })
  const pinHash = await bcrypt.hash(SELLER_B_PIN, 10)
  await prisma.usuario.update({ where: { id: SELLER_B_ID }, data: { tienePin: true, pin: pinHash, activo: true, sucursalId: BRANCH_ID, empresaId: EMPRESA_ID } })

  // Find products with stock
  const invRows = await prisma.inventarioSucursal.findMany({
    where: { sucursalId: BRANCH_ID, stockActual: { gt: 0 } },
    select: { productoId: true },
    take: 2
  })
  assert.ok(invRows.length >= 1, 'need at least 1 product with stock')
  for (const r of invRows) productIds.push(r.productoId)

  // Start real Express app on ephemeral port
  const app = require('../src/app')
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
})

after(async () => {
  // Cleanup all test-created ventas
  for (const vid of createdVentaIds) {
    try {
      await prisma.detalleVenta.deleteMany({ where: { ventaId: vid } })
      await prisma.venta.delete({ where: { id: vid } })
    } catch {}
  }
  await prisma.movimientoInventario.deleteMany({ where: { referencia: { contains: 'LOCAL-E2E' } } }).catch(() => {})
  await prisma.movimientoCaja.deleteMany({ where: { referencia: { contains: 'LOCAL-E2E' } } }).catch(() => {})
  // Restore B
  await prisma.usuario.update({ where: { id: SELLER_B_ID }, data: { tienePin: bOriginal.tienePin, pin: bOriginal.pin } }).catch(() => {})
  if (server) server.close()
  await prisma.$disconnect()
})

// ─── Tests ────────────────────────────────────────────────────────────
describe('P3-EFFECTIVE-SELLER LOCAL E2E', () => {
  let tokenA = null
  let sellerAuth = null

  // Helper: get admin token
  async function getTokenA() {
    if (tokenA) return tokenA
    const admin = await prisma.usuario.findUnique({
      where: { id: SESSION_A_ID },
      select: { id: true, nombre: true, username: true, rol: true, empresaId: true, sucursalId: true }
    })
    tokenA = signTenantToken(admin)
    return tokenA
  }

  it('A1 — session user token works against /health', async () => {
    const token = await getTokenA()
    const res = await GET('/health', token)
    assert.equal(res.status, 200, 'health returns 200')
  })

  it('A2 — verify PIN of seller B → returns sellerAuthorization', async () => {
    const token = await getTokenA()
    const res = await POST(`/usuarios/${SELLER_B_ID}/verificar-pin`, { pin: SELLER_B_PIN, sucursalId: BRANCH_ID }, token)
    assert.equal(res.status, 200, `verifyPin: ${JSON.stringify(res.body)}`)
    assert.equal(res.body.success, true)
    assert.ok(res.body.sellerAuthorization, 'sellerAuthorization present')
    sellerAuth = res.body.sellerAuthorization

    const claims = jwt.decode(sellerAuth)
    assert.equal(claims.sub, SELLER_B_ID, 'SAT.sub = seller B')
    assert.equal(claims.sid, SESSION_A_ID, 'SAT.sid = session user A')
    assert.equal(claims.eid, EMPRESA_ID, 'SAT.eid = empresa')
    assert.equal(claims.bid, BRANCH_ID, 'SAT.bid = branch')
  })

  it('A3 — verify PIN without sucursalId → 400', async () => {
    const token = await getTokenA()
    const res = await POST(`/usuarios/${SELLER_B_ID}/verificar-pin`, { pin: SELLER_B_PIN }, token)
    assert.equal(res.status, 400, `expected 400: ${JSON.stringify(res.body)}`)
    assert.ok(res.body.codigo?.includes('SELLER_AUTH'), 'error code references seller auth')
  })

  it('A4 — verify PIN with wrong PIN → 401', async () => {
    const token = await getTokenA()
    const res = await POST(`/usuarios/${SELLER_B_ID}/verificar-pin`, { pin: '9999', sucursalId: BRANCH_ID }, token)
    assert.equal(res.status, 401, `expected 401: ${JSON.stringify(res.body)}`)
  })

  it('A5 — crearVenta A→B with valid SAT → usuarioId = B', async () => {
    const token = await getTokenA()
    // Find open turno
    const turno = await prisma.turnoCaja.findFirst({ where: { empresaId: EMPRESA_ID, sucursalId: BRANCH_ID, abierto: true } })
    if (!turno) { console.log('  ⚠ no open turno, skipping'); return }

    const prod = await prisma.producto.findFirst({ where: { id: productIds[0], empresaId: EMPRESA_ID }, select: { precioVenta: true } })
    const precio = parseFloat(prod?.precioVenta || 1)
    const invBefore = await prisma.inventarioSucursal.findFirst({ where: { productoId: productIds[0], sucursalId: BRANCH_ID }, select: { stockActual: true } })
    const stockBefore = parseFloat(invBefore?.stockActual || 0)

    const res = await POST('/ventas', {
      usuarioId: SELLER_B_ID,
      turnoId: turno.id,
      metodoPago: 'EFECTIVO',
      subtotal: precio, iva: 0, descuento: 0, total: precio,
      montoPagado: precio,
      sucursalId: BRANCH_ID,
      sellerAuthorization: sellerAuth,
      detalles: [{ productoId: productIds[0], cantidad: 1, precioUnitario: precio, modoCaptura: 'CANTIDAD' }]
    }, token)

    assert.ok([200, 201].includes(res.status), `crearVenta: ${JSON.stringify(res.body)}`)
    const ventaId = res.body.id || res.body.data?.id
    assert.ok(ventaId, 'venta id present')
    createdVentaIds.push(ventaId)

    // DB checks
    const venta = await prisma.venta.findUnique({ where: { id: ventaId }, select: { usuarioId: true, empresaId: true, sucursalId: true, folio: true } })
    assert.equal(venta.usuarioId, SELLER_B_ID, 'Venta.usuarioId = seller B')
    assert.equal(venta.empresaId, EMPRESA_ID, 'Venta.empresaId = empresa')
    assert.equal(venta.sucursalId, BRANCH_ID, 'Venta.sucursalId = branch')

    // Stock decreased
    const invAfter = await prisma.inventarioSucursal.findFirst({ where: { productoId: productIds[0], sucursalId: BRANCH_ID }, select: { stockActual: true } })
    const stockAfter = parseFloat(invAfter?.stockActual || 0)
    assert.ok(stockAfter < stockBefore, `stock decreased: ${stockBefore} → ${stockAfter}`)

    // MovimientoInventario
    const mov = await prisma.movimientoInventario.findFirst({ where: { productoId: productIds[0], sucursalId: BRANCH_ID, referencia: venta.folio }, select: { usuarioId: true } })
    assert.equal(mov.usuarioId, SELLER_B_ID, 'MovimientoInventario.usuarioId = seller B')
  })

  it('A6 — ticket HTML shows seller name', async () => {
    if (createdVentaIds.length === 0) { console.log('  ⚠ no venta, skipping'); return }
    const token = await getTokenA()
    const vid = createdVentaIds[0]
    const res = await GET(`/ventas/${vid}/ticket`, token)
    assert.equal(res.status, 200, 'ticket works')
    const html = typeof res.body === 'string' ? res.body : ''
    assert.ok(html.includes('Empleado POS'), `ticket contains seller name`)
  })

  it('A7 — case A: no usuarioId → seller = session user', async () => {
    const token = await getTokenA()
    const turno = await prisma.turnoCaja.findFirst({ where: { empresaId: EMPRESA_ID, sucursalId: BRANCH_ID, abierto: true } })
    if (!turno) { console.log('  ⚠ no open turno, skipping'); return }
    const prod = await prisma.producto.findFirst({ where: { id: productIds[0], empresaId: EMPRESA_ID }, select: { precioVenta: true } })
    const precio = parseFloat(prod?.precioVenta || 1)

    const res = await POST('/ventas', {
      turnoId: turno.id,
      metodoPago: 'EFECTIVO',
      subtotal: precio, iva: 0, descuento: 0, total: precio,
      montoPagado: precio,
      sucursalId: BRANCH_ID,
      // NO usuarioId, NO sellerAuthorization
      detalles: [{ productoId: productIds[0], cantidad: 1, precioUnitario: precio, modoCaptura: 'CANTIDAD' }]
    }, token)
    if (res.status === 200 || res.status === 201) {
      const vid = res.body.id || res.body.data?.id
      createdVentaIds.push(vid)
      const venta = await prisma.venta.findUnique({ where: { id: vid }, select: { usuarioId: true } })
      assert.equal(venta.usuarioId, SESSION_A_ID, 'case A: usuarioId = session user')
    }
  })

  it('A8 — case C: usuarioId≠session, no SAT → 403 SELLER_AUTH_REQUIRED', async () => {
    const token = await getTokenA()
    const turno = await prisma.turnoCaja.findFirst({ where: { empresaId: EMPRESA_ID, sucursalId: BRANCH_ID, abierto: true } })
    if (!turno) { console.log('  ⚠ no open turno, skipping'); return }
    const prod = await prisma.producto.findFirst({ where: { id: productIds[0], empresaId: EMPRESA_ID }, select: { precioVenta: true } })
    const precio = parseFloat(prod?.precioVenta || 1)

    const res = await POST('/ventas', {
      usuarioId: SELLER_B_ID,
      turnoId: turno.id,
      metodoPago: 'EFECTIVO',
      subtotal: precio, iva: 0, descuento: 0, total: precio,
      montoPagado: precio,
      sucursalId: BRANCH_ID,
      // NO sellerAuthorization
      detalles: [{ productoId: productIds[0], cantidad: 1, precioUnitario: precio, modoCaptura: 'CANTIDAD' }]
    }, token)
    assert.equal(res.status, 403, `case C: expected 403, got ${res.status}: ${JSON.stringify(res.body)}`)
    assert.equal(res.body.codigo, 'SELLER_AUTH_REQUIRED')
  })

  it('A9 — SAT cannot be used as Bearer token (wrong audience)', async () => {
    // Test on a protected endpoint — /ventas requires auth
    // sellerAuth has audience "pos-seller-auth", not the tenant audience
    const res = await GET('/ventas', sellerAuth)
    assert.equal(res.status, 401, 'SAT as Bearer on protected endpoint → 401')
  })

  it('A10 — wrong branch SAT → SELLER_AUTH_BRANCH_MISMATCH', async () => {
    const token = await getTokenA()
    const turno = await prisma.turnoCaja.findFirst({ where: { empresaId: EMPRESA_ID, sucursalId: BRANCH_ID, abierto: true } })
    if (!turno) { console.log('  ⚠ no open turno, skipping'); return }
    const prod = await prisma.producto.findFirst({ where: { id: productIds[0], empresaId: EMPRESA_ID }, select: { precioVenta: true } })
    const precio = parseFloat(prod?.precioVenta || 1)

    // Create a SAT with wrong branch (correct issuer + audience so JWT verify passes)
    const wrongSat = jwt.sign(
      { sub: SELLER_B_ID, sid: SESSION_A_ID, eid: EMPRESA_ID, bid: 9999, kind: 'SELLER_AUTH' },
      TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: 'pos-seller-auth', expiresIn: '5m' }
    )

    const res = await POST('/ventas', {
      usuarioId: SELLER_B_ID,
      turnoId: turno.id,
      metodoPago: 'EFECTIVO',
      subtotal: precio, iva: 0, descuento: 0, total: precio,
      montoPagado: precio,
      sucursalId: BRANCH_ID,
      sellerAuthorization: wrongSat,
      detalles: [{ productoId: productIds[0], cantidad: 1, precioUnitario: precio, modoCaptura: 'CANTIDAD' }]
    }, token)
    assert.equal(res.status, 403, `wrong branch: ${JSON.stringify(res.body)}`)
    assert.equal(res.body.codigo, 'SELLER_AUTH_BRANCH_MISMATCH')
  })

  it('A11 — forged SAT (wrong secret) → 401 SELLER_AUTH_INVALID', async () => {
    const token = await getTokenA()
    const turno = await prisma.turnoCaja.findFirst({ where: { empresaId: EMPRESA_ID, sucursalId: BRANCH_ID, abierto: true } })
    if (!turno) { console.log('  ⚠ no open turno, skipping'); return }
    const prod = await prisma.producto.findFirst({ where: { id: productIds[0], empresaId: EMPRESA_ID }, select: { precioVenta: true } })
    const precio = parseFloat(prod?.precioVenta || 1)

    const forgedSat = jwt.sign(
      { sub: SELLER_B_ID, sid: SESSION_A_ID, eid: EMPRESA_ID, bid: BRANCH_ID, kind: 'SELLER_AUTH' },
      'wrong-secret-at-least-32-chars-for-hs256!!', { algorithm: 'HS256', expiresIn: '5m' }
    )

    const res = await POST('/ventas', {
      usuarioId: SELLER_B_ID,
      turnoId: turno.id,
      metodoPago: 'EFECTIVO',
      subtotal: precio, iva: 0, descuento: 0, total: precio,
      montoPagado: precio,
      sucursalId: BRANCH_ID,
      sellerAuthorization: forgedSat,
      detalles: [{ productoId: productIds[0], cantidad: 1, precioUnitario: precio, modoCaptura: 'CANTIDAD' }]
    }, token)
    assert.ok([401, 403].includes(res.status), `forged SAT: expected 401/403, got ${res.status}`)
  })

  it('A12 — SAT.sid mismatch → 403 SELLER_AUTH_SESSION_MISMATCH', async () => {
    const token = await getTokenA()
    const turno = await prisma.turnoCaja.findFirst({ where: { empresaId: EMPRESA_ID, sucursalId: BRANCH_ID, abierto: true } })
    if (!turno) { console.log('  ⚠ no open turno, skipping'); return }
    const prod = await prisma.producto.findFirst({ where: { id: productIds[0], empresaId: EMPRESA_ID }, select: { precioVenta: true } })
    const precio = parseFloat(prod?.precioVenta || 1)

    const wrongSidSat = jwt.sign(
      { sub: SELLER_B_ID, sid: 9999, eid: EMPRESA_ID, bid: BRANCH_ID, kind: 'SELLER_AUTH' },
      TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: 'pos-seller-auth', expiresIn: '5m' }
    )

    const res = await POST('/ventas', {
      usuarioId: SELLER_B_ID,
      turnoId: turno.id,
      metodoPago: 'EFECTIVO',
      subtotal: precio, iva: 0, descuento: 0, total: precio,
      montoPagado: precio,
      sucursalId: BRANCH_ID,
      sellerAuthorization: wrongSidSat,
      detalles: [{ productoId: productIds[0], cantidad: 1, precioUnitario: precio, modoCaptura: 'CANTIDAD' }]
    }, token)
    assert.equal(res.status, 403, `sid mismatch: ${JSON.stringify(res.body)}`)
    assert.equal(res.body.codigo, 'SELLER_AUTH_SESSION_MISMATCH')
  })
})
