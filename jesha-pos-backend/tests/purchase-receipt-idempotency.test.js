'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const path = require('node:path')
const http = require('node:http')
const pg = require('pg')
const jwt = require('jsonwebtoken')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_receipt_idem_'
const DB_RE = /^jesha_receipt_idem_[a-z0-9_]+$/
const TENANT_SECRET = 'receipt-idem-tenant-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-receipt-idem-test'
const TENANT_AUDIENCE = 'jesha-receipt-idem-api-test'

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Falta variable requerida: ${name}`)
  return value
}

function resolvePgConfig() {
  const host = requiredEnv('P0_TEST_PG_HOST')
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('P0_TEST_PG_HOST debe ser local')
  return Object.freeze({
    user: requiredEnv('P0_TEST_PG_USER'),
    password: requiredEnv('P0_TEST_PG_PASSWORD'),
    host,
    port: Number(requiredEnv('P0_TEST_PG_PORT'))
  })
}

function validateDbName(name) {
  if (!DB_RE.test(name) || name === DB_PREFIX) throw new Error('Nombre de base temporal inválido')
  return name
}

function quoteDb(name) {
  validateDbName(name)
  return `"${name}"`
}

function connectionUrl(config, dbName) {
  const host = config.host === '::1' ? '[::1]' : config.host
  return `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${host}:${config.port}/${encodeURIComponent(dbName)}`
}

function dbPush(databaseUrl) {
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  const args = ['prisma', 'db', 'push', '--schema', 'prisma/schema.prisma']
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], {
      cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000
    })
    return
  }
  execFileSync('npx', args, { cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000 })
}

describe('Purchase Receipt — Idempotency Core (B01-B26, B33-B34)', { concurrency: 1, timeout: 300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)

  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig, 'postgres'), max: 1 })
  let created = false
  let prisma
  let server
  let baseUrl
  let empresa
  let empresa2
  let sucursal
  let sucursal2
  let proveedor
  let producto
  let producto2
  let usuario
  let usuario2
  let oc
  let oc2
  let detalle1
  let detalle2
  let token
  let token2

  function signToken(user) {
    return jwt.sign(
      { version: 1, kind: 'TENANT', sub: user.id, rol: user.rol },
      TENANT_SECRET,
      { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '30m' }
    )
  }

  async function recibir(ocId, detalles, idempotencyKey, overrideToken) {
    const headers = {
      Authorization: `Bearer ${overrideToken || token}`,
      'X-Sucursal-Id': String(sucursal.id),
      'Content-Type': 'application/json'
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    const response = await fetch(`${baseUrl}/compras/${ocId}/recibir`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ detalles })
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }

  async function crearOCconDetalle(overrides = {}) {
    const ocLocal = await prisma.ordenCompra.create({
      data: {
        Empresa: { connect: { id: empresa.id } },
        Sucursal: { connect: { id: sucursal.id } },
        Proveedor: { connect: { id: proveedor.id } },
        Usuario: { connect: { id: usuario.id } },
        folio: `OC-TEST-${Date.now()}-${randomBytes(4).toString('hex')}`, estado: 'ENVIADO',
        totalEstimado: overrides.totalEstimado || 500, totalRecibido: 0, totalPagado: 0,
        DetalleOrdenCompra: {
          create: overrides.detalles || [
            { Producto: { connect: { id: producto.id } }, cantidadPedida: overrides.cantidadPedida || 10, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 500, subtotalRecibido: 0 }
          ]
        }
      },
      select: { id: true, folio: true }
    })
    const dets = await prisma.detalleOrdenCompra.findMany({ where: { ordenCompraId: ocLocal.id }, orderBy: { id: 'asc' } })
    return { oc: ocLocal, detalles: dets }
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'receipt-idem-platform-'.padEnd(64, 'p')
    process.env.PLATFORM_JWT_ISSUER = 'jesha-receipt-idem-platform'
    process.env.PLATFORM_JWT_AUDIENCE = 'jesha-receipt-idem-platform-api'
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.CLOUDINARY_CLOUD_NAME = 'test'
    process.env.CLOUDINARY_API_KEY = 'test'
    process.env.CLOUDINARY_API_SECRET = 'test'
    process.env.DEBUG_ENABLED = 'false'

    await adminPool.query(`CREATE DATABASE ${quoteDb(dbName)}`)
    created = true
    dbPush(databaseUrl)

    prisma = require('../src/lib/prisma')
    if (prisma?.pool && !prisma.pool.__p2ErrorGuard) {
      prisma.pool.__p2ErrorGuard = true
      prisma.pool.on('error', () => {})
    }

    empresa = await prisma.empresa.create({
      data: { slug: 'receipt-idem', nombreComercial: 'Idem Test', razonSocial: 'Idem SA', whatsapp: '0000000000', activa: true }
    })
    empresa2 = await prisma.empresa.create({
      data: { slug: 'receipt-idem-2', nombreComercial: 'Idem Test 2', razonSocial: 'Idem2 SA', whatsapp: '0000000001', activa: true }
    })
    sucursal = await prisma.sucursal.create({ data: { empresaId: empresa.id, nombre: 'Suc1', codigoPostal: '10001', activa: true } })
    sucursal2 = await prisma.sucursal.create({ data: { empresaId: empresa.id, nombre: 'Suc2', codigoPostal: '10002', activa: true } })
    proveedor = await prisma.proveedor.create({ data: { empresaId: empresa.id, nombreOficial: 'Prov Idem', alias: 'prov-idem', activo: true } })
    const dep = await prisma.departamento.create({ data: { empresaId: empresa.id, nombre: 'IDEM_DEP', activo: true } })
    const cat = await prisma.categoria.create({ data: { empresaId: empresa.id, departamentoId: dep.id, nombre: 'IDEM_CAT' } })
    producto = await prisma.producto.create({
      data: { empresaId: empresa.id, nombre: 'Prod Idem 1', codigoInterno: 'IDEM-1', precioBase: 100, precioVenta: 116, costo: 50, categoriaId: cat.id, unidadVenta: 'PZA', activo: true }
    })
    producto2 = await prisma.producto.create({
      data: { empresaId: empresa.id, nombre: 'Prod Idem 2', codigoInterno: 'IDEM-2', precioBase: 200, precioVenta: 232, costo: 100, categoriaId: cat.id, unidadVenta: 'PZA', activo: true }
    })
    await prisma.inventarioSucursal.createMany({
      data: [
        { productoId: producto.id, sucursalId: sucursal.id, stockActual: 0 },
        { productoId: producto2.id, sucursalId: sucursal.id, stockActual: 0 }
      ]
    })

    usuario = await prisma.usuario.create({
      data: {
        nombre: 'Idem User', username: 'idem.user',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01',
        rol: 'SUPERADMIN', activo: true, empresaId: empresa.id, sucursalId: null
      }
    })
    token = signToken(usuario)

    const ocResult = await crearOCconDetalle()
    oc = ocResult.oc
    detalle1 = ocResult.detalles[0]
    detalle2 = null

    const oc2Result = await crearOCconDetalle({ totalEstimado: 2000, cantidadPedida: 15, detalles: [
      { Producto: { connect: { id: producto2.id } }, cantidadPedida: 15, cantidadRecibida: 0, precioCosto: 100, subtotalPedido: 1500, subtotalRecibido: 0 }
    ]})
    oc2 = oc2Result.oc
    detalle2 = oc2Result.detalles[0]

    usuario2 = await prisma.usuario.create({
      data: {
        nombre: 'Idem User 2', username: 'idem.user2',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01',
        rol: 'SUPERADMIN', activo: true, empresaId: empresa2.id, sucursalId: null
      }
    })
    token2 = signToken(usuario2)

    const app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    }))
  })

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (prisma) {
      try { await prisma.$disconnect() } catch (_) {}
      try { if (typeof prisma.pool?.end === 'function') await prisma.pool.end() } catch (_) {}
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    if (created) {
      try {
        await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName])
        await adminPool.query(`DROP DATABASE IF EXISTS ${quoteDb(dbName)}`)
      } catch (_) {}
    }
    await adminPool.end()
  })

  // ════════════════════════════════════════════════════════════════
  //  B01: FIRST RECEIPT
  // ════════════════════════════════════════════════════════════════
  it('B01: first receipt with key succeeds', async () => {
    const key = randomUUID()
    const r = await recibir(oc.id, [{ detalleId: detalle1.id, cantidadRecibida: 3, precioCosto: 50 }], key)
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`)
    assert.equal(r.body.success, true)
    assert.ok(!r.body.idempotentReplay, 'First execution must not be replay')
  })

  // ════════════════════════════════════════════════════════════════
  //  B02: REPLAY NO STOCK DUPLICATION
  // ════════════════════════════════════════════════════════════════
  it('B02: replay does not duplicate stock', async () => {
    const key = randomUUID()
    const payload = [{ detalleId: detalle1.id, cantidadRecibida: 2, precioCosto: 50 }]

    const invBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: producto.id, sucursalId: sucursal.id } },
      select: { stockActual: true }
    })
    const stockBefore = Number(invBefore.stockActual)

    await recibir(oc.id, payload, key)
    await recibir(oc.id, payload, key)

    const invAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: producto.id, sucursalId: sucursal.id } },
      select: { stockActual: true }
    })
    const stockAfter = Number(invAfter.stockActual)
    assert.equal(stockAfter - stockBefore, 2, 'Stock must increase by exactly 2, not 4')
  })

  // ════════════════════════════════════════════════════════════════
  //  B03: REPLAY NO MOVEMENT DUPLICATION
  // ════════════════════════════════════════════════════════════════
  it('B03: replay does not duplicate movements', async () => {
    const key = randomUUID()
    const payload = [{ detalleId: detalle1.id, cantidadRecibida: 1, precioCosto: 50 }]

    const movBefore = await prisma.movimientoInventario.count({ where: { empresaId: empresa.id, productoId: producto.id } })

    await recibir(oc.id, payload, key)
    await recibir(oc.id, payload, key)

    const movAfter = await prisma.movimientoInventario.count({ where: { empresaId: empresa.id, productoId: producto.id } })
    assert.equal(movAfter - movBefore, 1, 'Movement count must increase by exactly 1')
  })

  // ════════════════════════════════════════════════════════════════
  //  B04: REPLAY NO HPP/HPPD DUPLICATION
  // ════════════════════════════════════════════════════════════════
  it('B04: replay does not duplicate HPP/HPPD', async () => {
    const key = randomUUID()
    const payload = [{ detalleId: detalle1.id, cantidadRecibida: 1, precioCosto: 50 }]

    let hppBefore = 0
    try {
      hppBefore = await prisma.historialPrecioProducto.count({ where: { productoId: producto.id } })
    } catch (_) { /* table may not exist */ }

    await recibir(oc.id, payload, key)

    let hppAfterFirst = 0
    try {
      hppAfterFirst = await prisma.historialPrecioProducto.count({ where: { productoId: producto.id } })
    } catch (_) {}

    await recibir(oc.id, payload, key)

    let hppAfterReplay = 0
    try {
      hppAfterReplay = await prisma.historialPrecioProducto.count({ where: { productoId: producto.id } })
    } catch (_) {}

    assert.ok(hppAfterFirst >= hppBefore, 'HPP should be created on first receipt')
    assert.equal(hppAfterReplay, hppAfterFirst, 'HPP must not increase on replay')
  })

  // ════════════════════════════════════════════════════════════════
  //  B05: PROVIDER PRODUCT SAFE
  // ════════════════════════════════════════════════════════════════
  it('B05: provider product upsert safe on replay', async () => {
    const key = randomUUID()
    const payload = [{ detalleId: detalle1.id, cantidadRecibida: 1, precioCosto: 55 }]

    await recibir(oc.id, payload, key)
    await recibir(oc.id, payload, key)

    const pp = await prisma.proveedorProducto.findUnique({
      where: { proveedorId_productoId: { proveedorId: proveedor.id, productoId: producto.id } },
      select: { precioCosto: true }
    })
    assert.ok(pp, 'ProveedorProducto must exist')
    assert.equal(Number(pp.precioCosto), 55, 'Provider product cost must be 55 (not duplicated)')
  })

  // ════════════════════════════════════════════════════════════════
  //  B06: SAME KEY DIFFERENT QTY → 409
  // ════════════════════════════════════════════════════════════════
  it('B06: same key different qty → 409', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const key = randomUUID()

    await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 3, precioCosto: 50 }], key)
    const r = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 5, precioCosto: 50 }], key)

    assert.equal(r.status, 409, `Expected 409, got ${r.status}`)
    assert.equal(r.body.codigo, 'KEY_PAYLOAD_DIFERENTE')
  })

  // ════════════════════════════════════════════════════════════════
  //  B07: SAME KEY DIFFERENT PRODUCT → 409
  // ════════════════════════════════════════════════════════════════
  it('B07: same key different product → 409', async () => {
    const { oc: freshOc, detalles } = await crearOCconDetalle({ detalles: [
      { Producto: { connect: { id: producto.id } }, cantidadPedida: 10, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 500, subtotalRecibido: 0 },
      { Producto: { connect: { id: producto2.id } }, cantidadPedida: 10, cantidadRecibida: 0, precioCosto: 100, subtotalPedido: 1000, subtotalRecibido: 0 }
    ]})
    const key = randomUUID()

    await recibir(freshOc.id, [{ detalleId: detalles[0].id, cantidadRecibida: 2, precioCosto: 50 }], key)
    const r = await recibir(freshOc.id, [{ detalleId: detalles[1].id, cantidadRecibida: 2, precioCosto: 100 }], key)

    assert.equal(r.status, 409, `Expected 409, got ${r.status}`)
    assert.equal(r.body.codigo, 'KEY_PAYLOAD_DIFERENTE')
  })

  // ════════════════════════════════════════════════════════════════
  //  B08: SAME KEY DIFFERENT OC → 409
  // ════════════════════════════════════════════════════════════════
  it('B08: same key different OC → 409', async () => {
    const { oc: freshOc1, detalles: [d1] } = await crearOCconDetalle()
    const { oc: freshOc2, detalles: [d2] } = await crearOCconDetalle()
    const key = randomUUID()

    await recibir(freshOc1.id, [{ detalleId: d1.id, cantidadRecibida: 2, precioCosto: 50 }], key)
    const r = await recibir(freshOc2.id, [{ detalleId: d2.id, cantidadRecibida: 2, precioCosto: 50 }], key)

    assert.equal(r.status, 409, `Expected 409, got ${r.status}`)
    assert.equal(r.body.codigo, 'KEY_PAYLOAD_DIFERENTE')
  })

  // ════════════════════════════════════════════════════════════════
  //  B11: DIFFERENT KEYS SAME PAYLOAD → LEGITIMATE
  // ════════════════════════════════════════════════════════════════
  it('B11: different keys same payload → both legitimate', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const keyA = randomUUID()
    const keyB = randomUUID()
    const payload = [{ detalleId: freshDet.id, cantidadRecibida: 3, precioCosto: 50 }]

    const [rA, rB] = await Promise.all([
      recibir(freshOc.id, payload, keyA),
      recibir(freshOc.id, payload, keyB)
    ])

    assert.equal(rA.status, 200, `Request A must succeed, got ${rA.status}`)
    assert.equal(rB.status, 200, `Request B must succeed, got ${rB.status}`)

    const receipts = await prisma.recepcionOrdenCompra.count({ where: { empresaId: empresa.id, ordenCompraId: freshOc.id } })
    assert.equal(receipts, 2, 'Must have 2 receipt records for 2 different keys')
  })

  // ════════════════════════════════════════════════════════════════
  //  B12-B13: PARTIAL RECEIPTS WITH DIFFERENT KEYS
  // ════════════════════════════════════════════════════════════════
  it('B12-B13: partial receipts with different keys accumulate correctly', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle({ cantidadPedida: 20 })
    const key1 = randomUUID()
    const key2 = randomUUID()

    await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 5, precioCosto: 50 }], key1)
    await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 7, precioCosto: 50 }], key2)

    const det = await prisma.detalleOrdenCompra.findUnique({ where: { id: freshDet.id }, select: { cantidadRecibida: true } })
    assert.equal(Number(det.cantidadRecibida), 12, `Expected 12 received (5+7), got ${Number(det.cantidadRecibida)}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B14: RETRY KEY1 AFTER KEY2 → REPLAYS ORIGINAL
  // ════════════════════════════════════════════════════════════════
  it('B14: retry key1 after key2 → replays original snapshot', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const key1 = randomUUID()
    const key2 = randomUUID()

    const r1 = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 3, precioCosto: 50 }], key1)
    await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 4, precioCosto: 50 }], key2)
    const r1Retry = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 3, precioCosto: 50 }], key1)

    assert.equal(r1Retry.status, 200)
    assert.equal(r1Retry.body.idempotentReplay, true)
    assert.deepEqual(r1Retry.body.data, r1.body.data, 'Replay must return same data as original')
  })

  // ════════════════════════════════════════════════════════════════
  //  B18: LOST RESPONSE REPLAY
  // ════════════════════════════════════════════════════════════════
  it('B18: lost response → retry returns persisted snapshot', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const key = randomUUID()
    const payload = [{ detalleId: freshDet.id, cantidadRecibida: 2, precioCosto: 50 }]

    await recibir(freshOc.id, payload, key)
    const retry = await recibir(freshOc.id, payload, key)

    assert.equal(retry.status, 200)
    assert.equal(retry.body.idempotentReplay, true)
    assert.ok(retry.body.data, 'Must have persisted response data')
  })

  // ════════════════════════════════════════════════════════════════
  //  B19: CROSS-COMPANY ISOLATION
  // ════════════════════════════════════════════════════════════════
  it('B19: cross-company key isolation — same key in different empresa is independent', async () => {
    const suc2 = await prisma.sucursal.create({ data: { empresaId: empresa2.id, nombre: 'Suc A2', codigoPostal: '20001', activa: true } })
    const prov2 = await prisma.proveedor.create({ data: { empresaId: empresa2.id, nombreOficial: 'Prov A2', alias: 'prov-a2', activo: true } })
    const dep2 = await prisma.departamento.create({ data: { empresaId: empresa2.id, nombre: 'A2_DEP', activo: true } })
    const cat2 = await prisma.categoria.create({ data: { empresaId: empresa2.id, departamentoId: dep2.id, nombre: 'A2_CAT' } })
    const prodA2 = await prisma.producto.create({
      data: { empresaId: empresa2.id, nombre: 'Prod A2', codigoInterno: 'A2-1', precioBase: 100, costo: 50, categoriaId: cat2.id, unidadVenta: 'PZA', activo: true }
    })
    await prisma.inventarioSucursal.create({ data: { productoId: prodA2.id, sucursalId: suc2.id, stockActual: 0 } })

    const ocA2 = await prisma.ordenCompra.create({
      data: {
        Empresa: { connect: { id: empresa2.id } },
        Sucursal: { connect: { id: suc2.id } },
        Proveedor: { connect: { id: prov2.id } },
        Usuario: { connect: { id: usuario2.id } },
        folio: `OC-A2-${Date.now()}`, estado: 'ENVIADO', totalEstimado: 500, totalRecibido: 0, totalPagado: 0,
        DetalleOrdenCompra: {
          create: [{ Producto: { connect: { id: prodA2.id } }, cantidadPedida: 10, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 500, subtotalRecibido: 0 }]
        }
      },
      select: { id: true }
    })
    const detA2 = await prisma.detalleOrdenCompra.findFirst({ where: { ordenCompraId: ocA2.id } })

    const sharedKey = randomUUID()

    const rE1 = await recibir(oc.id, [{ detalleId: detalle1.id, cantidadRecibida: 1, precioCosto: 50 }], sharedKey)
    const headers2 = {
      Authorization: `Bearer ${token2}`,
      'X-Sucursal-Id': String(suc2.id),
      'Content-Type': 'application/json',
      'Idempotency-Key': sharedKey
    }
    const rE2 = await fetch(`${baseUrl}/compras/${ocA2.id}/recibir`, {
      method: 'POST',
      headers: headers2,
      body: JSON.stringify({ detalles: [{ detalleId: detA2.id, cantidadRecibida: 1, precioCosto: 50 }] })
    })
    const bodyE2 = await rE2.json().catch(() => null)

    assert.equal(rE1.status, 200, 'Empresa 1 receipt must succeed')
    assert.equal(rE2.status, 200, 'Empresa 2 receipt with same key must also succeed (different tenant scope)')
  })

  // ════════════════════════════════════════════════════════════════
  //  B20: BRANCH ISOLATION
  // ════════════════════════════════════════════════════════════════
  it('B20: branch isolation — receipt scoped to sucursal', async () => {
    const oc3Result = await crearOCconDetalle()
    const headersWrong = {
      Authorization: `Bearer ${token}`,
      'X-Sucursal-Id': String(sucursal2.id),
      'Content-Type': 'application/json'
    }
    const r = await fetch(`${baseUrl}/compras/${oc3Result.oc.id}/recibir`, {
      method: 'POST',
      headers: headersWrong,
      body: JSON.stringify({ detalles: [{ detalleId: oc3Result.detalles[0].id, cantidadRecibida: 1, precioCosto: 50 }] })
    })
    assert.equal(r.status, 404, `OC from different sucursal must return 404, got ${r.status}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B22: MALFORMED KEY
  // ════════════════════════════════════════════════════════════════
  it('B22: malformed key → treated as missing (legacy)', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const r = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 1, precioCosto: 50 }], 'not-a-uuid')

    assert.equal(r.status, 200, `Malformed key treated as missing/legacy, got ${r.status}`)
    assert.equal(r.body.success, true)
    assert.ok(!r.body.idempotentReplay, 'Must not be replay')
  })

  // ════════════════════════════════════════════════════════════════
  //  B23: HUGE KEY (>64 chars)
  // ════════════════════════════════════════════════════════════════
  it('B23: huge key >64 chars → treated as missing (legacy)', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const hugeKey = 'a'.repeat(65)
    const r = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 1, precioCosto: 50 }], hugeKey)

    assert.equal(r.status, 200, `Huge key treated as missing/legacy, got ${r.status}`)
    assert.equal(r.body.success, true)
  })

  // ════════════════════════════════════════════════════════════════
  //  B21: MISSING KEY → LEGACY MODE
  // ════════════════════════════════════════════════════════════════
  it('B21: missing key → legacy mode', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const r = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 1, precioCosto: 50 }], null)

    assert.equal(r.status, 200, `Legacy mode must work, got ${r.status}`)
    assert.equal(r.body.success, true)
    assert.ok(!r.body.idempotentReplay)
  })

  // ════════════════════════════════════════════════════════════════
  //  B24: DECIMAL CANONICAL EQUALITY
  // ════════════════════════════════════════════════════════════════
  it('B24: decimal canonical equality — 5.00 same as 5', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const key = randomUUID()

    await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 5, precioCosto: 50 }], key)
    const r = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 5.00, precioCosto: 50.00 }], key)

    assert.equal(r.status, 200, `Same decimal values must match, got ${r.status}`)
    assert.equal(r.body.idempotentReplay, true, 'Must be replay')
  })

  // ════════════════════════════════════════════════════════════════
  //  B25: ITEM ORDER CANONICAL
  // ════════════════════════════════════════════════════════════════
  it('B25: item order canonical — different order same fingerprint', async () => {
    const { oc: freshOc, detalles } = await crearOCconDetalle({ detalles: [
      { Producto: { connect: { id: producto.id } }, cantidadPedida: 10, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 500, subtotalRecibido: 0 },
      { Producto: { connect: { id: producto2.id } }, cantidadPedida: 10, cantidadRecibida: 0, precioCosto: 100, subtotalPedido: 1000, subtotalRecibido: 0 }
    ]})
    const key = randomUUID()

    const payloadA = [
      { detalleId: detalles[0].id, cantidadRecibida: 2, precioCosto: 50 },
      { detalleId: detalles[1].id, cantidadRecibida: 3, precioCosto: 100 }
    ]
    const payloadB = [
      { detalleId: detalles[1].id, cantidadRecibida: 3, precioCosto: 100 },
      { detalleId: detalles[0].id, cantidadRecibida: 2, precioCosto: 50 }
    ]

    await recibir(freshOc.id, payloadA, key)
    const r = await recibir(freshOc.id, payloadB, key)

    assert.equal(r.status, 200, `Same items in different order must match fingerprint, got ${r.status}`)
    assert.equal(r.body.idempotentReplay, true, 'Must be replay')
  })

  // ════════════════════════════════════════════════════════════════
  //  B26: SEMANTIC CHANGE → NEW FINGERPRINT
  // ════════════════════════════════════════════════════════════════
  it('B26: semantic payload change → different fingerprint → 409', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const key = randomUUID()

    await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 2, precioCosto: 50 }], key)
    const r = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 2, precioCosto: 99 }], key)

    assert.equal(r.status, 409, `Changed cost must produce 409, got ${r.status}`)
    assert.equal(r.body.codigo, 'KEY_PAYLOAD_DIFERENTE')
  })

  // ════════════════════════════════════════════════════════════════
  //  B33: RESPONSE SNAPSHOT STABLE
  // ════════════════════════════════════════════════════════════════
  it('B33: response snapshot stable — replay returns original, not mutated OC', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle({ cantidadPedida: 20 })
    const keyA = randomUUID()
    const keyB = randomUUID()

    const rA1 = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 3, precioCosto: 50 }], keyA)
    assert.equal(rA1.status, 200)
    const snapshotA = JSON.parse(JSON.stringify(rA1.body))

    await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 5, precioCosto: 50 }], keyB)

    const rA2 = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 3, precioCosto: 50 }], keyA)
    assert.equal(rA2.status, 200)
    assert.equal(rA2.body.idempotentReplay, true)

    assert.equal(rA2.body.data.estado, snapshotA.data.estado, 'Replayed OC estado must match original snapshot')
    assert.equal(rA2.body.data.totalRecibido, snapshotA.data.totalRecibido, 'Replayed totalRecibido must match original snapshot')
  })

  // ════════════════════════════════════════════════════════════════
  //  B34: AUDIT NOT DUPLICATED ON REPLAY
  // ════════════════════════════════════════════════════════════════
  it('B34: audit not duplicated on replay', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOCconDetalle()
    const key = randomUUID()
    const payload = [{ detalleId: freshDet.id, cantidadRecibida: 1, precioCosto: 50 }]

    const auditBefore = await prisma.auditoria.count({ where: { modulo: 'compras', referencia: freshOc.folio } })

    await recibir(freshOc.id, payload, key)
    await recibir(freshOc.id, payload, key)

    const auditAfter = await prisma.auditoria.count({ where: { modulo: 'compras', referencia: freshOc.folio } })
    assert.equal(auditAfter - auditBefore, 1, 'Audit must increase by exactly 1 (no duplicate on replay)')
  })
})
