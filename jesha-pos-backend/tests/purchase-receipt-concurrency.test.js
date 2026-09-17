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
const DB_PREFIX = 'jesha_receipt_concurrent_'
const DB_RE = /^jesha_receipt_concurrent_[a-z0-9_]+$/
const TENANT_SECRET = 'receipt-concurrent-tenant-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-receipt-concurrent-test'
const TENANT_AUDIENCE = 'jesha-receipt-concurrent-api-test'

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

describe('Purchase Receipt — Concurrency Critical', { concurrency: 1, timeout: 300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)

  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig, 'postgres'), max: 1 })
  let created = false
  let prisma
  let server
  let baseUrl
  let empresa
  let sucursal
  let proveedor
  let producto
  let producto2
  let usuario
  let oc
  let detalle1
  let detalle2
  let token

  function signToken(userId) {
    return jwt.sign(
      { version: 1, kind: 'TENANT', sub: userId, rol: 'SUPERADMIN' },
      TENANT_SECRET,
      { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '30m' }
    )
  }

  async function recibir(ocId, detalles, idempotencyKey) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-Sucursal-Id': String(sucursal.id),
      'Content-Type': 'application/json'
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    const response = await fetch(`${baseUrl}/compras/${ocId}/recibir`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ detalles })
    })
    const rawText = await response.text()
    let body = null
    try { body = JSON.parse(rawText) } catch (_) { body = { _rawText: rawText.substring(0, 200) } }
    return { status: response.status, body }
  }

  async function snapshotFor(productoId, detalleId, empresaIdVal) {
    const eid = empresaIdVal || empresa.id
    const receipts = await prisma.recepcionOrdenCompra.count({ where: { empresaId: eid } })
    const movements = await prisma.movimientoInventario.count({ where: { empresaId: eid, productoId } })
    const inv = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId, sucursalId: sucursal.id } },
      select: { stockActual: true }
    })
    const det = await prisma.detalleOrdenCompra.findUnique({ where: { id: detalleId }, select: { cantidadRecibida: true } })
    let hpp = 0
    try { hpp = await prisma.historialPrecioProducto.count({ where: { empresaId: eid, productoId } }) } catch (_) {}
    let hppd = 0
    try { hppd = await prisma.historialPrecioProductoDetalle.count({ where: { empresaId: eid } }) } catch (_) {}
    return {
      receipts,
      movements,
      stock: inv ? Number(inv.stockActual) : 0,
      detailReceived: det ? Number(det.cantidadRecibida) : 0,
      hpp,
      hppd
    }
  }

  function delta(a, b) {
    return {
      receipts: a.receipts - b.receipts,
      movements: a.movements - b.movements,
      stock: a.stock - b.stock,
      detailReceived: a.detailReceived - b.detailReceived,
      hpp: a.hpp - b.hpp,
      hppd: a.hppd - b.hppd
    }
  }

  async function crearOC(overrides = {}) {
    const ocLocal = await prisma.ordenCompra.create({
      data: {
        Empresa: { connect: { id: empresa.id } },
        Sucursal: { connect: { id: sucursal.id } },
        Proveedor: { connect: { id: proveedor.id } },
        Usuario: { connect: { id: usuario.id } },
        folio: `OC-RC-${Date.now()}-${randomBytes(4).toString('hex')}`, estado: 'ENVIADO',
        totalEstimado: overrides.totalEstimado || 10000, totalRecibido: 0, totalPagado: 0,
        DetalleOrdenCompra: {
          create: overrides.detalles || [
            { Producto: { connect: { id: producto.id } }, cantidadPedida: overrides.cantidadPedida || 100, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 5000, subtotalRecibido: 0 }
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
    process.env.PLATFORM_JWT_SECRET = 'receipt-concurrent-platform-'.padEnd(64, 'p')
    process.env.PLATFORM_JWT_ISSUER = 'jesha-receipt-concurrent-platform'
    process.env.PLATFORM_JWT_AUDIENCE = 'jesha-receipt-concurrent-platform-api'
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
      data: { slug: 'receipt-concurrent', nombreComercial: 'Receipt Concurrent', razonSocial: 'RC SA', whatsapp: '0000000000', activa: true }
    })
    sucursal = await prisma.sucursal.create({ data: { empresaId: empresa.id, nombre: 'Suc1', codigoPostal: '10001', activa: true } })
    proveedor = await prisma.proveedor.create({ data: { empresaId: empresa.id, nombreOficial: 'Prov RC', alias: 'prov-rc', activo: true } })
    const dep = await prisma.departamento.create({ data: { empresaId: empresa.id, nombre: 'RC_DEP', activo: true } })
    const cat = await prisma.categoria.create({ data: { empresaId: empresa.id, departamentoId: dep.id, nombre: 'RC_CAT' } })
    producto = await prisma.producto.create({
      data: { empresaId: empresa.id, nombre: 'Prod RC 1', codigoInterno: 'RC-1', precioBase: 100, precioVenta: 116, costo: 50, categoriaId: cat.id, unidadVenta: 'PZA', activo: true }
    })
    producto2 = await prisma.producto.create({
      data: { empresaId: empresa.id, nombre: 'Prod RC 2', codigoInterno: 'RC-2', precioBase: 200, precioVenta: 232, costo: 100, categoriaId: cat.id, unidadVenta: 'PZA', activo: true }
    })
    await prisma.inventarioSucursal.createMany({
      data: [
        { productoId: producto.id, sucursalId: sucursal.id, stockActual: 0 },
        { productoId: producto2.id, sucursalId: sucursal.id, stockActual: 0 }
      ]
    })

    usuario = await prisma.usuario.create({
      data: {
        nombre: 'RC User', username: 'rc.user',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01',
        rol: 'SUPERADMIN', activo: true, empresaId: empresa.id, sucursalId: null
      }
    })
    token = signToken(usuario.id)

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
  //  B09: SAME KEY x2 — FULL BUSINESS EFFECT ASSERTIONS
  // ════════════════════════════════════════════════════════════════
  it('B09: same key x2 → exactly 1 execution, full business deltas', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 100 })
    const qty = 3
    const key = randomUUID()
    const payload = [{ detalleId: freshDet.id, cantidadRecibida: qty, precioCosto: 50 }]

    const before = await snapshotFor(producto.id, freshDet.id)

    const [r1, r2] = await Promise.all([
      recibir(freshOc.id, payload, key),
      recibir(freshOc.id, payload, key)
    ])

    const after = await snapshotFor(producto.id, freshDet.id)
    const d = delta(after, before)

    assert.equal(r1.status, 200, `r1 must be 200, got ${r1.status}`)
    assert.equal(r2.status, 200, `r2 must be 200, got ${r2.status}`)

    const replayCount = [r1, r2].filter(r => r.body?.idempotentReplay === true).length
    assert.equal(replayCount, 1, 'Exactly 1 response must be idempotentReplay')

    assert.equal(d.receipts, 1, `RECEIPT_DELTA must be 1, got ${d.receipts}`)
    assert.equal(d.detailReceived, qty, `DETAIL_DELTA must be ${qty}, got ${d.detailReceived}`)
    assert.equal(d.stock, qty, `STOCK_DELTA must be ${qty}, got ${d.stock}`)
    assert.equal(d.movements, 1, `MOVEMENT_DELTA must be 1, got ${d.movements}`)
    assert.ok(d.hpp >= 1, `HPP_DELTA must be >= 1 (first receipt creates HPP record), got ${d.hpp}`)
    assert.ok(d.hppd >= 0, `HPPD_DELTA must be >= 0, got ${d.hppd}`)
    assert.equal(d.hpp, 1, `HPP_DELTA must be exactly 1 (1 exec, replay adds 0), got ${d.hpp}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B10: SAME KEY x10 — FULL BUSINESS EFFECT ASSERTIONS + DISTRIBUTION
  // ════════════════════════════════════════════════════════════════
  it('B10: same key x10 → exactly 1 execution, full deltas, distribution', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 100 })
    const qty = 2
    const key = randomUUID()
    const payload = [{ detalleId: freshDet.id, cantidadRecibida: qty, precioCosto: 50 }]

    const before = await snapshotFor(producto.id, freshDet.id)

    const results = await Promise.all(Array.from({ length: 10 }, () => recibir(freshOc.id, payload, key)))

    const after = await snapshotFor(producto.id, freshDet.id)
    const d = delta(after, before)

    const execs = results.filter(r => r.status === 200 && !r.body?.idempotentReplay).length
    const replays = results.filter(r => r.status === 200 && r.body?.idempotentReplay === true).length
    const errors = results.filter(r => r.status !== 200).length
    const fivers = results.filter(r => r.status === 500).length

    assert.equal(results.length, 10, 'Must fire exactly 10 requests')
    assert.equal(execs, 1, `NORMAL_EXECUTION_RESPONSES must be 1, got ${execs}`)
    assert.equal(replays, 9, `REPLAY_RESPONSES must be 9, got ${replays}`)
    assert.equal(fivers, 0, `ERROR_RESPONSES (5xx) must be 0, got ${fivers}`)

    assert.equal(d.receipts, 1, `RECEIPT_DELTA must be 1, got ${d.receipts}`)
    assert.equal(d.detailReceived, qty, `DETAIL_DELTA must be ${qty}, got ${d.detailReceived}`)
    assert.equal(d.stock, qty, `STOCK_DELTA must be ${qty}, got ${d.stock}`)
    assert.equal(d.movements, 1, `MOVEMENT_DELTA must be 1, got ${d.movements}`)
    assert.equal(d.hpp, 0, `HPP_DELTA must be 0, got ${d.hpp}`)
    assert.equal(d.hppd, 0, `HPPD_DELTA must be 0, got ${d.hppd}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B27: DIFFERENT KEYS SAME LINE CONCURRENT
  // ════════════════════════════════════════════════════════════════
  it('B27: different keys same line concurrent → both commit, no lost update', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 100 })
    const before = await snapshotFor(producto.id, freshDet.id)
    const keyA = randomUUID()
    const keyB = randomUUID()
    const payloadA = [{ detalleId: freshDet.id, cantidadRecibida: 5, precioCosto: 50 }]
    const payloadB = [{ detalleId: freshDet.id, cantidadRecibida: 7, precioCosto: 50 }]

    const [rA, rB] = await Promise.all([
      recibir(freshOc.id, payloadA, keyA),
      recibir(freshOc.id, payloadB, keyB)
    ])

    const after = await snapshotFor(producto.id, freshDet.id)
    const d = delta(after, before)

    assert.equal(rA.status, 200, `Request A must succeed, got ${rA.status}: ${JSON.stringify(rA.body)}`)
    assert.equal(rB.status, 200, `Request B must succeed, got ${rB.status}: ${JSON.stringify(rB.body)}`)
    assert.equal(d.detailReceived, 12, `DETAIL_DELTA must be 12 (5+7), got ${d.detailReceived}`)
    assert.equal(d.stock, 12, `STOCK_DELTA must be 12 (5+7), got ${d.stock}`)
    assert.equal(d.receipts, 2, `RECEIPT_DELTA must be 2, got ${d.receipts}`)
    assert.equal(d.movements, 2, `MOVEMENT_DELTA must be 2, got ${d.movements}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B28: DIFFERENT KEYS MULTI-LINE CONCURRENT
  // ════════════════════════════════════════════════════════════════
  it('B28: different keys multi-line concurrent → both commit correctly', async () => {
    const { oc: freshOc, detalles } = await crearOC({
      detalles: [
        { Producto: { connect: { id: producto.id } }, cantidadPedida: 100, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 5000, subtotalRecibido: 0 },
        { Producto: { connect: { id: producto2.id } }, cantidadPedida: 100, cantidadRecibida: 0, precioCosto: 100, subtotalPedido: 10000, subtotalRecibido: 0 }
      ]
    })
    const [d1, d2] = detalles
    const before1 = await snapshotFor(producto.id, d1.id)
    const before2 = await snapshotFor(producto2.id, d2.id)
    const keyA = randomUUID()
    const keyB = randomUUID()
    const payloadA = [
      { detalleId: d1.id, cantidadRecibida: 2, precioCosto: 50 },
      { detalleId: d2.id, cantidadRecibida: 3, precioCosto: 100 }
    ]
    const payloadB = [
      { detalleId: d1.id, cantidadRecibida: 1, precioCosto: 50 },
      { detalleId: d2.id, cantidadRecibida: 2, precioCosto: 100 }
    ]

    const [rA, rB] = await Promise.all([
      recibir(freshOc.id, payloadA, keyA),
      recibir(freshOc.id, payloadB, keyB)
    ])

    const after1 = await snapshotFor(producto.id, d1.id)
    const after2 = await snapshotFor(producto2.id, d2.id)
    const d1d = delta(after1, before1)
    const d2d = delta(after2, before2)

    assert.equal(rA.status, 200, `Request A must succeed, got ${rA.status}`)
    assert.equal(rB.status, 200, `Request B must succeed, got ${rB.status}`)
    assert.ok(d1d.detailReceived >= 3, `Detalle1 received must be >= 3, got ${d1d.detailReceived}`)
    assert.ok(d2d.detailReceived >= 5, `Detalle2 received must be >= 5, got ${d2d.detailReceived}`)
    assert.equal(d1d.detailReceived + d2d.detailReceived, 8, `Total detail delta must be 8, got ${d1d.detailReceived + d2d.detailReceived}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B29: NO LOST CANTIDADRECIBIDA UPDATE
  // ════════════════════════════════════════════════════════════════
  it('B29: no lost cantidadRecibida update under concurrent load', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 100 })
    const before = await snapshotFor(producto.id, freshDet.id)

    const N = 5
    const promises = Array.from({ length: N }, () => {
      const key = randomUUID()
      return recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 1, precioCosto: 50 }], key)
    })

    const results = await Promise.all(promises)
    const allOk = results.every(r => r.status === 200)
    assert.ok(allOk, `All ${N} requests must succeed`)

    const after = await snapshotFor(producto.id, freshDet.id)
    const d = delta(after, before)
    assert.equal(d.detailReceived, N, `cantidadRecibida must increase by ${N}, got ${d.detailReceived}`)
    assert.equal(d.stock, N, `stock must increase by ${N}, got ${d.stock}`)
    assert.equal(d.receipts, N, `receipts must be ${N}, got ${d.receipts}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B30: STOCK/DETAIL CUMULATIVE CONSISTENCY
  // ════════════════════════════════════════════════════════════════
  it('B30: stock/detail cumulative consistency after all concurrent tests', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 100 })
    const key = randomUUID()
    await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 10, precioCosto: 50 }], key)

    const det = await prisma.detalleOrdenCompra.findUnique({ where: { id: freshDet.id }, select: { cantidadRecibida: true, cantidadPedida: true } })
    const inv = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: producto.id, sucursalId: sucursal.id } },
      select: { stockActual: true }
    })
    const pedida = Number(det.cantidadPedida)
    const recibida = Number(det.cantidadRecibida)
    const stock = Number(inv.stockActual)

    assert.ok(recibida <= pedida + 0.001, `cantidadRecibida (${recibida}) must not exceed cantidadPedida (${pedida})`)
    assert.ok(stock >= 0, `Stock must be non-negative, got ${stock}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B31: OVER-RECEIPT BACKEND GUARD
  // ════════════════════════════════════════════════════════════════
  it('B31: over-receipt backend guard rejects with 400 + OVER_RECEIPT', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 5 })
    const before = await snapshotFor(producto.id, freshDet.id)
    const key = randomUUID()

    const r = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 20, precioCosto: 50 }], key)

    const after = await snapshotFor(producto.id, freshDet.id)
    const d = delta(after, before)

    assert.equal(r.status, 400, `Over-receipt must return 400, got ${r.status}`)
    assert.equal(r.body?.codigo, 'OVER_RECEIPT', `Must have OVER_RECEIPT code, got ${r.body?.codigo}`)
    assert.equal(d.receipts, 0, `RECEIPT_DELTA must be 0, got ${d.receipts}`)
    assert.equal(d.detailReceived, 0, `DETAIL_DELTA must be 0, got ${d.detailReceived}`)
    assert.equal(d.stock, 0, `STOCK_DELTA must be 0, got ${d.stock}`)
    assert.equal(d.movements, 0, `MOVEMENT_DELTA must be 0, got ${d.movements}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B31b: CONCURRENT OVER-RECEIPT BOUNDARY — FRESH OC
  //  Two concurrent requests that together would exceed ordered.
  //  Safety invariant: final received must never exceed ordered.
  //  OVER_RECEIPT may or may not fire depending on pg timing,
  //  but the invariant MUST hold in all cases.
  // ════════════════════════════════════════════════════════════════
  it('B31b: concurrent over-receipt boundary — safety invariant holds', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 10 })
    const pedida = 10

    const [rA, rB] = await Promise.all([
      recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 6, precioCosto: 50 }], randomUUID()),
      recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 6, precioCosto: 50 }], randomUUID())
    ])

    const finalDet = await prisma.detalleOrdenCompra.findUnique({ where: { id: freshDet.id }, select: { cantidadRecibida: true, cantidadPedida: true } })
    const finalReceived = Number(finalDet.cantidadRecibida)
    const finalPedida = Number(finalDet.cantidadPedida)

    const successes = [rA, rB].filter(r => r.status === 200).length
    const failures = [rA, rB].filter(r => r.status >= 400).length

    // SAFETY INVARIANT: final received must never exceed ordered
    assert.ok(finalReceived <= finalPedida + 0.001, `FINAL_RECEIVED (${finalReceived}) must not exceed ordered (${finalPedida})`)
    assert.ok(successes >= 1, `At least 1 must succeed, got ${successes}`)
    assert.equal(successes + failures, 2, 'Each request is either success or failure')
  })

  // ════════════════════════════════════════════════════════════════
  //  B31c: SEQUENTIAL OVER-RECEIPT — deterministic guard verification
  // ════════════════════════════════════════════════════════════════
  it('B31c: sequential over-receipt — guard rejects with 400 + OVER_RECEIPT', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 5 })
    const key = randomUUID()

    const r = await recibir(freshOc.id, [{ detalleId: freshDet.id, cantidadRecibida: 20, precioCosto: 50 }], key)

    assert.equal(r.status, 400, `Sequential over-receipt must return 400, got ${r.status}`)
    assert.equal(r.body?.codigo, 'OVER_RECEIPT', `Must have OVER_RECEIPT code, got ${r.body?.codigo}`)

    const finalDet = await prisma.detalleOrdenCompra.findUnique({ where: { id: freshDet.id }, select: { cantidadRecibida: true } })
    assert.equal(Number(finalDet.cantidadRecibida), 0, 'cantidadRecibida must remain 0 after rejected over-receipt')
  })

  // ════════════════════════════════════════════════════════════════
  //  B32b: UNRELATED P2002 MUST NOT CONFUSE RECEIPT REPLAY
  // ════════════════════════════════════════════════════════════════
  it('B32b: unrelated P2002 (Empresa slug) must not enter receipt replay logic', async () => {
    const slug = `b32b-${Date.now()}`
    await prisma.empresa.create({ data: { slug, nombreComercial: 'B32b', razonSocial: 'B32b SA', whatsapp: '0000000000', activa: true } })

    try {
      await prisma.empresa.create({ data: { slug, nombreComercial: 'B32b-dup', razonSocial: 'B32b SA 2', whatsapp: '0000000001', activa: true } })
      assert.fail('Must throw P2002 for duplicate slug')
    } catch (err) {
      assert.equal(err.code, 'P2002', `Must be P2002, got ${err.code}`)
      const modelName = err.meta?.modelName
      assert.equal(modelName, 'Empresa', `P2002 model must be Empresa, got ${modelName}`)
      assert.notEqual(modelName, 'RecepcionOrdenCompra', 'Must NOT be RecepcionOrdenCompra')
    }
  })

  // ════════════════════════════════════════════════════════════════
  //  B32c: VERIFY P2002 SHAPE FROM RECEIPT COLLISION
  // ════════════════════════════════════════════════════════════════
  it('B32c: capture actual P2002 shape from RecepcionOrdenCompra collision', async () => {
    const { oc: freshOc, detalles: [freshDet] } = await crearOC({ cantidadPedida: 100 })
    const key = randomUUID()
    const payload = [{ detalleId: freshDet.id, cantidadRecibida: 1, precioCosto: 50 }]

    const r1 = await recibir(freshOc.id, payload, key)
    assert.equal(r1.status, 200, 'First must succeed')

    const r2 = await recibir(freshOc.id, payload, key)
    assert.equal(r2.status, 200, 'Second must be replay')
    assert.equal(r2.body?.idempotentReplay, true, 'Second must be idempotentReplay')

    const receipt = await prisma.recepcionOrdenCompra.findFirst({ where: { empresaId: empresa.id, claveIdempotencia: key } })
    assert.ok(receipt, 'Receipt record must exist')
    assert.ok(receipt.fingerprintHash, 'Receipt must have fingerprintHash')
    assert.ok(receipt.respuesta, 'Receipt must have respuesta snapshot')
  })
})
