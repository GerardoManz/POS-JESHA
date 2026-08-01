'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const path = require('node:path')
const http = require('node:http')
const pg = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_p0_login_context_gate_test_'
const DB_RE = /^jesha_p0_login_context_gate_test_[a-z0-9_]+$/
const TENANT_SECRET = 'tenant-gate-postgres-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-gate-postgres-test'
const TENANT_AUDIENCE = 'jesha-gate-api-postgres-test'

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Falta variable requerida: ${name}`)
  }
  return value
}

function resolvePgConfig() {
  const host = requiredEnv('P0_TEST_PG_HOST')
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('P0_TEST_PG_HOST debe ser local')
  }
  const portRaw = requiredEnv('P0_TEST_PG_PORT')
  if (!/^\d+$/.test(portRaw)) throw new Error('P0_TEST_PG_PORT inválido')
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('P0_TEST_PG_PORT fuera de rango')
  }
  return Object.freeze({
    user: requiredEnv('P0_TEST_PG_USER'),
    password: requiredEnv('P0_TEST_PG_PASSWORD'),
    host,
    port
  })
}

function validateDbName(name) {
  if (!DB_RE.test(name) || name === DB_PREFIX) throw new Error('Nombre de base temporal inválido')
  return name
}

function quoteDb(name) {
  return `"${validateDbName(name)}"`
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

describe('P0-LOGIN-CONTEXT-GATE PostgreSQL HTTP real', { concurrency: 1, timeout: 300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig, 'postgres'), max: 1 })

  let created = false

  function swallowPoolTeardown() {
    process.on('unhandledRejection', (reason) => {
      const msg = reason && (reason.message || String(reason))
      if (msg && msg.includes('terminando la conexión')) return
      if (msg && msg.includes('Connection terminated')) return
      if (msg && msg.includes('closed unexpectedly')) return
      console.error('Unexpected unhandledRejection:', msg)
    })
  }
  let prisma
  let app
  let server
  let baseUrl
  let empresas = {}
  let sucursales = {}
  let usuarios = {}
  let tokens = {}

  function signLocalToken(userId, rol, empresaId, sucursalId) {
    const principal = { version: 1, kind: 'TENANT', sub: userId, rol }
    const options = {
      algorithm: 'HS256',
      issuer: TENANT_ISSUER,
      audience: TENANT_AUDIENCE,
      expiresIn: '30m'
    }
    return jwt.sign(principal, TENANT_SECRET, options)
  }

  before(async () => {
    swallowPoolTeardown()
    await adminPool.query(`CREATE DATABASE ${quoteDb(dbName)}`)
    created = true
    dbPush(databaseUrl)

    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'platform-gate-postgres-secret-'.padEnd(64, 'p')
    process.env.PLATFORM_JWT_ISSUER = 'platform-gate-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'platform-gate-api-test'
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
    process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
    process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'
    process.env.DEBUG_ENABLED = 'false'

    prisma = require('../src/lib/prisma')

    empresas.A = await prisma.empresa.create({ data: {
      slug: 'empresa-a', nombreComercial: 'Empresa A', razonSocial: 'Empresa A SA de CV',
      whatsapp: '0000000001', activa: true
    } })
    empresas.B = await prisma.empresa.create({ data: {
      slug: 'empresa-b', nombreComercial: 'Empresa B', razonSocial: 'Empresa B SA de CV',
      whatsapp: '0000000002', activa: true
    } })
    empresas.C = await prisma.empresa.create({ data: {
      slug: 'empresa-c', nombreComercial: 'Empresa C', razonSocial: 'Empresa C SA de CV',
      whatsapp: '0000000003', activa: true
    } })

    sucursales.A1 = await prisma.sucursal.create({ data: {
      empresaId: empresas.A.id, nombre: 'Matriz A', codigoPostal: '00001', activa: true
    } })
    sucursales.A2 = await prisma.sucursal.create({ data: {
      empresaId: empresas.A.id, nombre: 'Sucursal A2', codigoPostal: '00002', activa: true
    } })
    sucursales.A3 = await prisma.sucursal.create({ data: {
      empresaId: empresas.A.id, nombre: 'Inactiva A', codigoPostal: '00003', activa: false
    } })
    sucursales.B1 = await prisma.sucursal.create({ data: {
      empresaId: empresas.B.id, nombre: 'Matriz B', codigoPostal: '00004', activa: true
    } })

    const hash = await bcrypt.hash('password', 10)

    usuarios.superA = await prisma.usuario.create({ data: {
      nombre: 'Super A', username: 'super.a', passwordHash: hash, rol: 'SUPERADMIN',
      activo: true, empresaId: empresas.A.id, sucursalId: null
    } })
    usuarios.adminA1 = await prisma.usuario.create({ data: {
      nombre: 'Admin A1', username: 'admin.a1', passwordHash: hash, rol: 'ADMIN_SUCURSAL',
      activo: true, empresaId: empresas.A.id, sucursalId: sucursales.A1.id
    } })
    usuarios.empA2 = await prisma.usuario.create({ data: {
      nombre: 'Emp A2', username: 'emp.a2', passwordHash: hash, rol: 'EMPLEADO',
      activo: true, empresaId: empresas.A.id, sucursalId: sucursales.A2.id
    } })
    usuarios.pricesGlobal = await prisma.usuario.create({ data: {
      nombre: 'Prices Global', username: 'prices.global', passwordHash: hash, rol: 'PRECIOS',
      activo: true, empresaId: empresas.A.id, sucursalId: null
    } })
    usuarios.pricesA1 = await prisma.usuario.create({ data: {
      nombre: 'Prices A1', username: 'prices.a1', passwordHash: hash, rol: 'PRECIOS',
      activo: true, empresaId: empresas.A.id, sucursalId: sucursales.A1.id
    } })
    usuarios.superB = await prisma.usuario.create({ data: {
      nombre: 'Super B', username: 'super.b', passwordHash: hash, rol: 'SUPERADMIN',
      activo: true, empresaId: empresas.B.id, sucursalId: null
    } })
    usuarios.superC = await prisma.usuario.create({ data: {
      nombre: 'Super C', username: 'super.c', passwordHash: hash, rol: 'SUPERADMIN',
      activo: true, empresaId: empresas.C.id, sucursalId: null
    } })

    tokens.superA = signLocalToken(usuarios.superA.id, 'SUPERADMIN', empresas.A.id, null)
    tokens.adminA1 = signLocalToken(usuarios.adminA1.id, 'ADMIN_SUCURSAL', empresas.A.id, sucursales.A1.id)
    tokens.empA2 = signLocalToken(usuarios.empA2.id, 'EMPLEADO', empresas.A.id, sucursales.A2.id)
    tokens.pricesGlobal = signLocalToken(usuarios.pricesGlobal.id, 'PRECIOS', empresas.A.id, null)
    tokens.pricesA1 = signLocalToken(usuarios.pricesA1.id, 'PRECIOS', empresas.A.id, sucursales.A1.id)
    tokens.superB = signLocalToken(usuarios.superB.id, 'SUPERADMIN', empresas.B.id, null)
    tokens.superC = signLocalToken(usuarios.superC.id, 'SUPERADMIN', empresas.C.id, null)

    app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`
        resolve()
      })
    })
  })

  after(async () => {
    const failures = []
    if (server) {
      try { await new Promise((r) => server.close(r)) } catch (err) { failures.push(`server close: ${err.message}`) }
    }
    if (prisma) {
      try { await prisma.$disconnect() } catch (err) { failures.push(`prisma disconnect: ${err.message}`) }
    }
    if (created) {
      try {
        await adminPool.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
          [dbName]
        )
        await adminPool.query(`DROP DATABASE ${quoteDb(dbName)}`)
      } catch (err) {
        failures.push(`drop: ${err.message}`)
      }
    }
    try { await adminPool.end() } catch (err) { failures.push(`admin pool end: ${err.message}`) }

    delete require.cache[require.resolve('../src/app')]

    if (failures.length > 0) throw new Error(failures.join(' | '))
  })

  async function getDisponibles(token, sucursalId) {
    const headers = { Authorization: `Bearer ${token}` }
    if (sucursalId !== undefined) headers['X-Sucursal-Id'] = String(sucursalId)
    const res = await fetch(`${baseUrl}/sucursales/disponibles`, { headers })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  async function getContext(token, sucursalId) {
    const headers = { Authorization: `Bearer ${token}` }
    if (sucursalId !== undefined) headers['X-Sucursal-Id'] = String(sucursalId)
    const res = await fetch(`${baseUrl}/auth/context`, { headers })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  it('1. GET /sucursales/disponibles requiere auth', async () => {
    const res = await fetch(`${baseUrl}/sucursales/disponibles`)
    assert.strictEqual(res.status, 401)
  })

  it('2. GET /auth/context requiere auth', async () => {
    const res = await fetch(`${baseUrl}/auth/context`)
    assert.strictEqual(res.status, 401)
  })

  it('3. SUPERADMIN obtiene A1 y A2 (no A3)', async () => {
    const result = await getDisponibles(tokens.superA)
    assert.strictEqual(result.status, 200)
    const ids = result.body.sucursales.map((s) => s.id).sort()
    assert.deepStrictEqual(ids, [sucursales.A1.id, sucursales.A2.id].sort())
  })

  it('4. SUPERADMIN no obtiene sucursales de empresa B', async () => {
    const result = await getDisponibles(tokens.superA)
    const ids = result.body.sucursales.map((s) => s.id)
    assert.ok(!ids.includes(sucursales.B1.id))
  })

  it('5. ADMIN_SUCURSAL obtiene solo A1', async () => {
    const result = await getDisponibles(tokens.adminA1)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.sucursales.length, 1)
    assert.strictEqual(result.body.sucursales[0].id, sucursales.A1.id)
  })

  it('6. EMPLEADO obtiene solo A2', async () => {
    const result = await getDisponibles(tokens.empA2)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.sucursales.length, 1)
    assert.strictEqual(result.body.sucursales[0].id, sucursales.A2.id)
  })

  it('7. PRECIOS fijo obtiene solo A1', async () => {
    const result = await getDisponibles(tokens.pricesA1)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.sucursales.length, 1)
    assert.strictEqual(result.body.sucursales[0].id, sucursales.A1.id)
  })

  it('8. PRECIOS global obtiene A1 y A2', async () => {
    const result = await getDisponibles(tokens.pricesGlobal)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.sucursales.length, 2)
  })

  it('9. empresa B obtiene solo B1', async () => {
    const result = await getDisponibles(tokens.superB)
    assert.strictEqual(result.status, 200)
    const ids = result.body.sucursales.map((s) => s.id)
    assert.deepStrictEqual(ids, [sucursales.B1.id])
  })

  it('10. empresa C sin sucursales obtiene array vacio', async () => {
    const result = await getDisponibles(tokens.superC)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.sucursales.length, 0)
  })

  it('11. query empresaId no altera resultado', async () => {
    const headers = { Authorization: `Bearer ${tokens.superA}` }
    const res = await fetch(`${baseUrl}/sucursales/disponibles?empresaId=999`, { headers })
    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.sucursales.length, 2)
  })

  it('12. /auth/context sin header devuelve NONE para SUPERADMIN', async () => {
    const result = await getContext(tokens.superA)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.version, 1)
    assert.strictEqual(result.body.kind, 'TENANT')
    assert.strictEqual(result.body.actor.rol, 'SUPERADMIN')
    assert.strictEqual(result.body.branch.mode, 'NONE')
    assert.strictEqual(result.body.branch.sucursalId, null)
  })

  it('13. /auth/context con A1 devuelve SELECTED para SUPERADMIN', async () => {
    const result = await getContext(tokens.superA, sucursales.A1.id)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'SELECTED')
    assert.strictEqual(result.body.branch.sucursalId, sucursales.A1.id)
  })

  it('14. /auth/context con A2 devuelve SELECTED para SUPERADMIN', async () => {
    const result = await getContext(tokens.superA, sucursales.A2.id)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'SELECTED')
    assert.strictEqual(result.body.branch.sucursalId, sucursales.A2.id)
  })

  it('15. /auth/context con sucursal de otra empresa es rechazado', async () => {
    const result = await getContext(tokens.superA, sucursales.B1.id)
    assert.strictEqual(result.status, 403)
  })

  it('16. admin.a1 sin header devuelve FIXED/A1', async () => {
    const result = await getContext(tokens.adminA1)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'FIXED')
    assert.strictEqual(result.body.branch.sucursalId, sucursales.A1.id)
  })

  it('17. admin.a1 con A1 funciona FIXED/A1', async () => {
    const result = await getContext(tokens.adminA1, sucursales.A1.id)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'FIXED')
    assert.strictEqual(result.body.branch.sucursalId, sucursales.A1.id)
  })

  it('18. admin.a1 con A2 es rechazado', async () => {
    const result = await getContext(tokens.adminA1, sucursales.A2.id)
    assert.strictEqual(result.status, 403)
  })

  it('19. emp.a2 sin header devuelve FIXED/A2', async () => {
    const result = await getContext(tokens.empA2)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'FIXED')
    assert.strictEqual(result.body.branch.sucursalId, sucursales.A2.id)
  })

  it('20. prices.global sin header NONE/null', async () => {
    const result = await getContext(tokens.pricesGlobal)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'NONE')
    assert.strictEqual(result.body.branch.sucursalId, null)
  })

  it('21. prices.global con A1 SELECTED', async () => {
    const result = await getContext(tokens.pricesGlobal, sucursales.A1.id)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'SELECTED')
    assert.strictEqual(result.body.branch.sucursalId, sucursales.A1.id)
  })

  it('22. prices.a1 sin header FIXED/A1', async () => {
    const result = await getContext(tokens.pricesA1)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'FIXED')
    assert.strictEqual(result.body.branch.sucursalId, sucursales.A1.id)
  })

  it('23. /auth/context no incluye secretos', async () => {
    const result = await getContext(tokens.superA)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.token, undefined)
    assert.strictEqual(result.body.passwordHash, undefined)
    assert.strictEqual(result.body.nombre, undefined)
    assert.strictEqual(result.body.username, undefined)
  })

  it('24. Sucursal 1 no es fallback para empresa B', async () => {
    const result = await getContext(tokens.superB)
    assert.strictEqual(result.status, 200)
    assert.strictEqual(result.body.branch.mode, 'NONE')
    assert.strictEqual(result.body.branch.sucursalId, null)

    const disp = await getDisponibles(tokens.superB)
    assert.strictEqual(disp.status, 200)
    assert.strictEqual(disp.body.sucursales.length, 1)
    assert.notStrictEqual(disp.body.sucursales[0].id, 1)
  })

  it('25. login real funciona y produce claims minimos', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(typeof data.token, 'string')
    assert.strictEqual(data.usuario.rol, 'SUPERADMIN')
    assert.strictEqual(data.usuario.empresaId, empresas.A.id)
    assert.strictEqual(data.usuario.sucursalId, null)

    const contextRes = await getContext(data.token)
    assert.strictEqual(contextRes.status, 200)
    assert.strictEqual(contextRes.body.branch.mode, 'NONE')
  })

  it('26. login con slug incorrecto no revela empresas', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresaSlug: 'empresa-inexistente', username: 'super.a', password: 'password' })
    })
    assert.strictEqual(res.status, 401)
    const body = await res.json()
    assert.deepStrictEqual(body, { error: 'Credenciales inválidas' })
  })
})
