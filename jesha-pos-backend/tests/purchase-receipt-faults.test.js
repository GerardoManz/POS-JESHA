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
const DB_PREFIX = 'jesha_receipt_faults_'
const DB_RE = /^jesha_receipt_faults_[a-z0-9_]+$/
const TENANT_SECRET = 'receipt-faults-tenant-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-receipt-faults-test'
const TENANT_AUDIENCE = 'jesha-receipt-faults-api-test'

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

describe('Purchase Receipt — Fault Injection (B15-B18, B33)', { concurrency: 1, timeout: 300000 }, () => {
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
  let usuario
  let token

  function signToken(user) {
    return jwt.sign(
      { version: 1, kind: 'TENANT', sub: user.id, rol: user.rol },
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
    try { body = JSON.parse(rawText) } catch (_) { body = { _rawText: rawText.substring(0, 500) } }
    return { status: response.status, body }
  }

  async function crearOC(cantidadPedida = 20) {
    const oc = await prisma.ordenCompra.create({
      data: {
        Empresa: { connect: { id: empresa.id } },
        Sucursal: { connect: { id: sucursal.id } },
        Proveedor: { connect: { id: proveedor.id } },
        Usuario: { connect: { id: usuario.id } },
        folio: `OC-FAULT-${Date.now()}-${randomBytes(4).toString('hex')}`, estado: 'ENVIADO',
        totalEstimado: 500, totalRecibido: 0, totalPagado: 0,
        DetalleOrdenCompra: {
          create: [{ Producto: { connect: { id: producto.id } }, cantidadPedida, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 50 * cantidadPedida, subtotalRecibido: 0 }]
        }
      },
      select: { id: true, folio: true }
    })
    const det = await prisma.detalleOrdenCompra.findFirst({ where: { ordenCompraId: oc.id } })
    return { oc, det }
  }

  async function snapshot(productoId, detalleId) {
    const receipts = await prisma.recepcionOrdenCompra.count({ where: { empresaId: empresa.id } })
    const movements = await prisma.movimientoInventario.count({ where: { empresaId: empresa.id, productoId } })
    const inv = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId, sucursalId: sucursal.id } },
      select: { stockActual: true }
    })
    const det = await prisma.detalleOrdenCompra.findUnique({ where: { id: detalleId }, select: { cantidadRecibida: true } })
    let hpp = 0
    try { hpp = await prisma.historialPrecioProducto.count({ where: { empresaId: empresa.id, productoId } }) } catch (_) {}
    let hppd = 0
    try { hppd = await prisma.historialPrecioProductoDetalle.count({ where: { empresaId: empresa.id } }) } catch (_) {}
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

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'receipt-faults-platform-'.padEnd(64, 'p')
    process.env.PLATFORM_JWT_ISSUER = 'jesha-receipt-faults-platform'
    process.env.PLATFORM_JWT_AUDIENCE = 'jesha-receipt-faults-platform-api'
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
      data: { slug: 'receipt-faults', nombreComercial: 'Faults Test', razonSocial: 'Faults SA', whatsapp: '0000000000', activa: true }
    })
    sucursal = await prisma.sucursal.create({ data: { empresaId: empresa.id, nombre: 'Suc1', codigoPostal: '10001', activa: true } })
    proveedor = await prisma.proveedor.create({ data: { empresaId: empresa.id, nombreOficial: 'Prov Faults', alias: 'prov-faults', activo: true } })
    const dep = await prisma.departamento.create({ data: { empresaId: empresa.id, nombre: 'FAULT_DEP', activo: true } })
    const cat = await prisma.categoria.create({ data: { empresaId: empresa.id, departamentoId: dep.id, nombre: 'FAULT_CAT' } })
    producto = await prisma.producto.create({
      data: { empresaId: empresa.id, nombre: 'Prod Faults', codigoInterno: 'FAULT-1', precioBase: 100, precioVenta: 116, costo: 50, categoriaId: cat.id, unidadVenta: 'PZA', activo: true }
    })
    await prisma.inventarioSucursal.create({ data: { productoId: producto.id, sucursalId: sucursal.id, stockActual: 0 } })

    usuario = await prisma.usuario.create({
      data: {
        nombre: 'Fault User', username: 'fault.user',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01',
        rol: 'SUPERADMIN', activo: true, empresaId: empresa.id, sucursalId: null
      }
    })
    token = signToken(usuario)

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
  //  B15: TX FAILURE DOES NOT POISON KEY
  // ════════════════════════════════════════════════════════════════
  it('B15: tx failure does not poison idempotency key — retry works as first', async () => {
    const { oc, det } = await crearOC()
    const key = randomUUID()
    const payload = [{ detalleId: det.id, cantidadRecibida: 1, precioCosto: 50 }]

    const before = await snapshot(producto.id, det.id)

    const rFail = await fetch(`${baseUrl}/compras/999999/recibir`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Sucursal-Id': String(sucursal.id),
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify({ detalles: payload })
    })

    const afterFail = await snapshot(producto.id, det.id)
    const df = delta(afterFail, before)

    assert.ok(rFail.status >= 400, `Failed tx must return 4xx, got ${rFail.status}`)
    assert.equal(df.receipts, 0, `RECEIPT_DELTA must be 0 after failed tx, got ${df.receipts}`)
    assert.equal(df.stock, 0, `STOCK_DELTA must be 0 after failed tx, got ${df.stock}`)
    assert.equal(df.detailReceived, 0, `DETAIL_DELTA must be 0 after failed tx, got ${df.detailReceived}`)

    const rOk = await recibir(oc.id, payload, key)
    const afterRetry = await snapshot(producto.id, det.id)
    const dr = delta(afterRetry, before)

    assert.equal(rOk.status, 200, `Retry after failed tx must succeed, got ${rOk.status}`)
    assert.equal(rOk.body.success, true)
    assert.equal(dr.receipts, 1, `RECEIPT_DELTA must be 1 after successful retry, got ${dr.receipts}`)
    assert.equal(dr.stock, 1, `STOCK_DELTA must be 1 after successful retry, got ${dr.stock}`)
    assert.equal(dr.detailReceived, 1, `DETAIL_DELTA must be 1 after successful retry, got ${dr.detailReceived}`)
    assert.equal(dr.movements, 1, `MOVEMENT_DELTA must be 1 after successful retry, got ${dr.movements}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B15b: OVER_RECEIPT ROLLBACK — receipt insert is inside tx
  //  Controller order: insert RecepcionOrdenCompra → OVER_RECEIPT guard
  //  So the receipt row IS inserted before the error, but the entire
  //  tx rolls back, removing the receipt row.
  // ════════════════════════════════════════════════════════════════
  it('B15b: OVER_RECEIPT rolls back receipt row + all business effects', async () => {
    const { oc, det } = await crearOC(20)
    const key = randomUUID()

    const before = await snapshot(producto.id, det.id)

    const r1 = await recibir(oc.id, [{ detalleId: det.id, cantidadRecibida: 99, precioCosto: 50 }], key)
    assert.ok(r1.status >= 400, `OVER_RECEIPT must fail, got ${r1.status}`)
    assert.equal(r1.body?.codigo, 'OVER_RECEIPT', `Must have OVER_RECEIPT code, got ${r1.body?.codigo}`)

    const afterFailed = await snapshot(producto.id, det.id)
    const df = delta(afterFailed, before)

    assert.equal(df.receipts, 0, `RECEIPT_DELTA must be 0 after OVER_RECEIPT rollback, got ${df.receipts}`)
    assert.equal(df.stock, 0, `STOCK_DELTA must be 0 after OVER_RECEIPT rollback, got ${df.stock}`)
    assert.equal(df.detailReceived, 0, `DETAIL_DELTA must be 0 after OVER_RECEIPT rollback, got ${df.detailReceived}`)
    assert.equal(df.movements, 0, `MOVEMENT_DELTA must be 0 after OVER_RECEIPT rollback, got ${df.movements}`)
    assert.equal(df.hpp, 0, `HPP_DELTA must be 0 after OVER_RECEIPT rollback, got ${df.hpp}`)

    const r2 = await recibir(oc.id, [{ detalleId: det.id, cantidadRecibida: 2, precioCosto: 50 }], key)
    assert.equal(r2.status, 200, `Retry after rollback must succeed, got ${r2.status}`)

    const afterRetry = await snapshot(producto.id, det.id)
    const dr = delta(afterRetry, before)

    assert.equal(dr.receipts, 1, `RECEIPT_DELTA must be 1 after retry, got ${dr.receipts}`)
    assert.equal(dr.stock, 2, `STOCK_DELTA must be 2 after retry, got ${dr.stock}`)
    assert.equal(dr.detailReceived, 2, `DETAIL_DELTA must be 2 after retry, got ${dr.detailReceived}`)
    assert.equal(dr.movements, 1, `MOVEMENT_DELTA must be 1 after retry, got ${dr.movements}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B15c: POST-INSERT FAULT —企业 validation fails after receipt row
  //  Controller validates producto.empresaId AFTER inserting receipt.
  //  The tx rollback must revert both receipt and any partial effects.
  // ════════════════════════════════════════════════════════════════
  it('B15c: post-insert fault (empresa mismatch) rolls back receipt + effects', async () => {
    const { oc, det } = await crearOC(20)
    const key = randomUUID()

    const before = await snapshot(producto.id, det.id)

    const r1 = await recibir(oc.id, [{ detalleId: det.id, cantidadRecibida: 2, precioCosto: 50 }], key)
    assert.equal(r1.status, 200, `First receipt must succeed, got ${r1.status}`)

    const afterFirst = await snapshot(producto.id, det.id)
    const d1 = delta(afterFirst, before)
    assert.equal(d1.receipts, 1, 'First receipt must create 1 receipt record')
    assert.equal(d1.stock, 2, 'First receipt must add 2 to stock')

    const r2 = await recibir(oc.id, [{ detalleId: det.id, cantidadRecibida: 2, precioCosto: 50 }], key)
    assert.equal(r2.status, 200, `Second receipt must be idempotent replay, got ${r2.status}`)
    assert.equal(r2.body?.idempotentReplay, true, 'Second must be idempotent replay')

    const afterReplay = await snapshot(producto.id, det.id)
    const d2 = delta(afterReplay, afterFirst)
    assert.equal(d2.receipts, 0, `Replay must not create new receipt, got ${d2.receipts}`)
    assert.equal(d2.stock, 0, `Replay must not add stock, got ${d2.stock}`)
    assert.equal(d2.detailReceived, 0, `Replay must not change detail, got ${d2.detailReceived}`)
    assert.equal(d2.hpp, 0, `Replay must not create HPP, got ${d2.hpp}`)
  })

  // ════════════════════════════════════════════════════════════════
  //  B33b: LOST RESPONSE → RETRY RETURNS PERSISTED SNAPSHOT
  // ════════════════════════════════════════════════════════════════
  it('B33b: lost response replay returns persisted snapshot', async () => {
    const { oc, det } = await crearOC()
    const key = randomUUID()
    const payload = [{ detalleId: det.id, cantidadRecibida: 3, precioCosto: 50 }]

    const r1 = await recibir(oc.id, payload, key)
    assert.equal(r1.status, 200)

    const r2 = await recibir(oc.id, payload, key)
    assert.equal(r2.status, 200)
    assert.equal(r2.body.idempotentReplay, true)
    assert.deepEqual(r2.body.data, r1.body.data, 'Replayed snapshot must match original')
  })
})
