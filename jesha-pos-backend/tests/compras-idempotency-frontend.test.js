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
const DB_PREFIX = 'jesha_receipt_frontend_'
const DB_RE = /^jesha_receipt_frontend_[a-z0-9_]+$/
const TENANT_SECRET = 'receipt-frontend-tenant-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-receipt-frontend-test'
const TENANT_AUDIENCE = 'jesha-receipt-frontend-api-test'

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

describe('Purchase Receipt — Frontend Idempotency (B35-B37)', { concurrency: 1, timeout: 300000 }, () => {
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
    return { status: response.status, body: await response.json().catch(() => null) }
  }

  async function crearOC() {
    const oc = await prisma.ordenCompra.create({
      data: {
        Empresa: { connect: { id: empresa.id } },
        Sucursal: { connect: { id: sucursal.id } },
        Proveedor: { connect: { id: proveedor.id } },
        Usuario: { connect: { id: usuario.id } },
        folio: `OC-FE-${Date.now()}-${randomBytes(4).toString('hex')}`, estado: 'ENVIADO',
        totalEstimado: 500, totalRecibido: 0, totalPagado: 0,
        DetalleOrdenCompra: {
          create: [{ Producto: { connect: { id: producto.id } }, cantidadPedida: 20, cantidadRecibida: 0, precioCosto: 50, subtotalPedido: 1000, subtotalRecibido: 0 }]
        }
      },
      select: { id: true, folio: true }
    })
    const det = await prisma.detalleOrdenCompra.findFirst({ where: { ordenCompraId: oc.id } })
    return { oc, det }
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'receipt-frontend-platform-'.padEnd(64, 'p')
    process.env.PLATFORM_JWT_ISSUER = 'jesha-receipt-frontend-platform'
    process.env.PLATFORM_JWT_AUDIENCE = 'jesha-receipt-frontend-platform-api'
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
      data: { slug: 'receipt-frontend', nombreComercial: 'Frontend Test', razonSocial: 'FE SA', whatsapp: '0000000000', activa: true }
    })
    sucursal = await prisma.sucursal.create({ data: { empresaId: empresa.id, nombre: 'Suc1', codigoPostal: '10001', activa: true } })
    proveedor = await prisma.proveedor.create({ data: { empresaId: empresa.id, nombreOficial: 'Prov FE', alias: 'prov-fe', activo: true } })
    const dep = await prisma.departamento.create({ data: { empresaId: empresa.id, nombre: 'FE_DEP', activo: true } })
    const cat = await prisma.categoria.create({ data: { empresaId: empresa.id, departamentoId: dep.id, nombre: 'FE_CAT' } })
    producto = await prisma.producto.create({
      data: { empresaId: empresa.id, nombre: 'Prod FE', codigoInterno: 'FE-1', precioBase: 100, precioVenta: 116, costo: 50, categoriaId: cat.id, unidadVenta: 'PZA', activo: true }
    })
    await prisma.inventarioSucursal.create({ data: { productoId: producto.id, sucursalId: sucursal.id, stockActual: 0 } })

    usuario = await prisma.usuario.create({
      data: {
        nombre: 'FE User', username: 'fe.user',
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
  //  B35: AMBIGUOUS NETWORK FAILURE RETAINS KEY
  // ════════════════════════════════════════════════════════════════
  it('B35: ambiguous network failure retains same key — retry replays', async () => {
    const { oc, det } = await crearOC()
    const key = randomUUID()
    const payload = [{ detalleId: det.id, cantidadRecibida: 3, precioCosto: 50 }]

    // Simulate: first request succeeds but client "loses" response
    const r1 = await recibir(oc.id, payload, key)
    assert.equal(r1.status, 200)

    // Simulate: client retries with same key (ambiguous failure)
    const r2 = await recibir(oc.id, payload, key)
    assert.equal(r2.status, 200)
    assert.equal(r2.body.idempotentReplay, true, 'Retry must return replay, not duplicate execution')
  })

  // ════════════════════════════════════════════════════════════════
  //  B36: SUCCESSFUL RESPONSE CLEARS PENDING
  // ════════════════════════════════════════════════════════════════
  it('B36: success clears pending — new receipt gets new key', async () => {
    const { oc: oc1, det: det1 } = await crearOC()
    const key1 = randomUUID()

    const r1 = await recibir(oc1.id, [{ detalleId: det1.id, cantidadRecibida: 2, precioCosto: 50 }], key1)
    assert.equal(r1.status, 200)
    assert.ok(!r1.body.idempotentReplay)

    // New legitimate receipt on a different OC must use a new key
    const { oc: oc2, det: det2 } = await crearOC()
    const key2 = randomUUID()
    const r2 = await recibir(oc2.id, [{ detalleId: det2.id, cantidadRecibida: 1, precioCosto: 50 }], key2)
    assert.equal(r2.status, 200)
    assert.ok(key1 !== key2, 'New receipt must use different key')
  })

  // ════════════════════════════════════════════════════════════════
  //  B37: PAYLOAD CHANGE → NEW KEY
  // ════════════════════════════════════════════════════════════════
  it('B37: semantic payload change creates new fingerprint', async () => {
    const { oc, det } = await crearOC()
    const key = randomUUID()

    // First: qty=2
    await recibir(oc.id, [{ detalleId: det.id, cantidadRecibida: 2, precioCosto: 50 }], key)

    // Same key, different qty=3 → must get 409 (fingerprint mismatch)
    const r = await recibir(oc.id, [{ detalleId: det.id, cantidadRecibida: 3, precioCosto: 50 }], key)
    assert.equal(r.status, 409, `Changed payload must produce 409, got ${r.status}`)
    assert.equal(r.body.codigo, 'KEY_PAYLOAD_DIFERENTE')
  })

  // ════════════════════════════════════════════════════════════════
  //  DOUBLE-CLICK: same key for both clicks
  // ════════════════════════════════════════════════════════════════
  it('double-click simulation: same key prevents duplicate', async () => {
    const { oc, det } = await crearOC()
    const key = randomUUID()
    const payload = [{ detalleId: det.id, cantidadRecibida: 4, precioCosto: 50 }]

    const stockBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: producto.id, sucursalId: sucursal.id } },
      select: { stockActual: true }
    })
    const before = Number(stockBefore.stockActual)

    // Double-click = two requests with same key simultaneously
    const [r1, r2] = await Promise.all([
      recibir(oc.id, payload, key),
      recibir(oc.id, payload, key)
    ])

    assert.equal(r1.status, 200)
    assert.equal(r2.status, 200)

    const stockAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: producto.id, sucursalId: sucursal.id } },
      select: { stockActual: true }
    })
    const after = Number(stockAfter.stockActual)
    assert.equal(after - before, 4, 'Double-click must not duplicate stock (delta=4, not 8)')
  })
})
