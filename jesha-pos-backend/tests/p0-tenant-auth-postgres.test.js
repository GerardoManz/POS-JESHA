'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const path = require('node:path')
const pg = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_p0_tenant_auth_test_'
const DB_RE = /^jesha_p0_tenant_auth_test_[a-z0-9_]+$/
const TENANT_SECRET = 'tenant-postgres-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-tenant-postgres-test'
const TENANT_AUDIENCE = 'jesha-tenant-api-postgres-test'
const PLATFORM_SECRET = 'platform-postgres-test-secret-'.padEnd(64, 'p')

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Falta variable requerida para PostgreSQL aislado: ${name}`)
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

function mockRes() {
  const state = { statusCode: 200, body: null }
  return {
    _state: state,
    status(code) { state.statusCode = code; return this },
    json(body) { state.body = body; return this },
    end() { return this }
  }
}

function loginReq(empresaSlug, username, password) {
  return {
    body: { empresaSlug, username, password },
    headers: {}, query: {}, path: '/auth/login', requestId: 'pg-tenant-login', ip: '127.0.0.1'
  }
}

function middlewareReq(token) {
  return {
    headers: { authorization: `Bearer ${token}` }, query: {}, params: {}, body: {},
    path: '/ventas', requestId: 'pg-tenant-middleware'
  }
}

function signTenant(sub, rol, overrides = {}, options = {}) {
  return jwt.sign({ version: 1, kind: 'TENANT', sub, rol, ...overrides }, TENANT_SECRET, {
    algorithm: options.algorithm || 'HS256',
    issuer: options.issuer || TENANT_ISSUER,
    audience: options.audience || TENANT_AUDIENCE,
    expiresIn: options.expiresIn === undefined ? '15m' : options.expiresIn
  })
}

describe('P0-TENANT-AUTH PostgreSQL aislado', { concurrency: 1, timeout: 300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig, 'postgres'), max: 1 })

  let created = false
  let prisma
  let controller
  let middleware
  let empresaA
  let empresaB
  let sucursalA
  let sucursalB
  let sharedA
  let sharedB
  let superA
  let employeeA
  let pricesGlobal
  let pricesBranch
  let mutable
  let deletable
  let companyMutable
  let branchMutable

  before(async () => {
    await adminPool.query(`CREATE DATABASE ${quoteDb(dbName)}`)
    created = true
    dbPush(databaseUrl)

    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = PLATFORM_SECRET
    process.env.PLATFORM_JWT_ISSUER = 'jesha-platform-postgres-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'jesha-platform-api-postgres-test'
    process.env.PLATFORM_JWT_TTL = '15m'

    prisma = require('../src/lib/prisma')
    controller = require('../src/modules/auth/auth.controller')
    middleware = require('../src/middlewares/auth.middleware')

    empresaA = await prisma.empresa.create({ data: {
      slug: 'empresa-a', nombreComercial: 'Empresa A', razonSocial: 'Empresa A SA de CV',
      whatsapp: '0000000001', activa: true
    } })
    empresaB = await prisma.empresa.create({ data: {
      slug: 'empresa-b', nombreComercial: 'Empresa B', razonSocial: 'Empresa B SA de CV',
      whatsapp: '0000000002', activa: true
    } })
    const empresaInactiva = await prisma.empresa.create({ data: {
      slug: 'empresa-inactiva', nombreComercial: 'Empresa Inactiva', razonSocial: 'Empresa Inactiva SA de CV',
      whatsapp: '0000000003', activa: false
    } })

    sucursalA = await prisma.sucursal.create({ data: {
      empresaId: empresaA.id, nombre: 'Matriz A', codigoPostal: '00001', activa: true
    } })
    sucursalB = await prisma.sucursal.create({ data: {
      empresaId: empresaB.id, nombre: 'Matriz B', codigoPostal: '00002', activa: true
    } })
    const sucursalInactiva = await prisma.sucursal.create({ data: {
      empresaId: empresaA.id, nombre: 'Inactiva A', codigoPostal: '00003', activa: false
    } })
    branchMutable = await prisma.sucursal.create({ data: {
      empresaId: empresaA.id, nombre: 'Mutable A', codigoPostal: '00004', activa: true
    } })

    const hashA = await bcrypt.hash('password-a', 10)
    const hashB = await bcrypt.hash('password-b', 10)
    const hashCommon = await bcrypt.hash('password-common', 10)

    sharedA = await prisma.usuario.create({ data: {
      nombre: 'Shared A', username: 'shared.user', passwordHash: hashA, rol: 'ADMIN_SUCURSAL',
      activo: true, empresaId: empresaA.id, sucursalId: sucursalA.id
    } })
    sharedB = await prisma.usuario.create({ data: {
      nombre: 'Shared B', username: 'shared.user', passwordHash: hashB, rol: 'ADMIN_SUCURSAL',
      activo: true, empresaId: empresaB.id, sucursalId: sucursalB.id
    } })
    superA = await prisma.usuario.create({ data: {
      nombre: 'Super A', username: 'super.a', passwordHash: hashCommon, rol: 'SUPERADMIN',
      activo: true, empresaId: empresaA.id, sucursalId: null
    } })
    employeeA = await prisma.usuario.create({ data: {
      nombre: 'Employee A', username: 'employee.a', passwordHash: hashCommon, rol: 'EMPLEADO',
      activo: true, empresaId: empresaA.id, sucursalId: sucursalA.id
    } })
    pricesGlobal = await prisma.usuario.create({ data: {
      nombre: 'Prices Global', username: 'prices.global', passwordHash: hashCommon, rol: 'PRECIOS',
      activo: true, empresaId: empresaA.id, sucursalId: null
    } })
    pricesBranch = await prisma.usuario.create({ data: {
      nombre: 'Prices Branch', username: 'prices.branch', passwordHash: hashCommon, rol: 'PRECIOS',
      activo: true, empresaId: empresaA.id, sucursalId: sucursalA.id
    } })
    await prisma.usuario.create({ data: {
      nombre: 'Inactive User', username: 'inactive.user', passwordHash: hashCommon, rol: 'SUPERADMIN',
      activo: false, empresaId: empresaA.id, sucursalId: null
    } })
    await prisma.usuario.create({ data: {
      nombre: 'Inactive Branch', username: 'inactive.branch', passwordHash: hashCommon, rol: 'EMPLEADO',
      activo: true, empresaId: empresaA.id, sucursalId: sucursalInactiva.id
    } })
    await prisma.usuario.create({ data: {
      nombre: 'Mismatch Branch', username: 'mismatch.branch', passwordHash: hashCommon, rol: 'EMPLEADO',
      activo: true, empresaId: empresaA.id, sucursalId: sucursalB.id
    } })
    await prisma.usuario.create({ data: {
      nombre: 'Legacy Platform', username: 'platform.legacy', passwordHash: hashCommon, rol: 'PLATFORM_ADMIN',
      activo: true, empresaId: empresaA.id, sucursalId: null
    } })
    await prisma.usuario.create({ data: {
      nombre: 'Inactive Company User', username: 'inactive.company', passwordHash: hashCommon, rol: 'SUPERADMIN',
      activo: true, empresaId: empresaInactiva.id, sucursalId: null
    } })
    mutable = await prisma.usuario.create({ data: {
      nombre: 'Mutable Role', username: 'mutable.role', passwordHash: hashCommon, rol: 'ADMIN_SUCURSAL',
      activo: true, empresaId: empresaA.id, sucursalId: sucursalA.id
    } })
    deletable = await prisma.usuario.create({ data: {
      nombre: 'Deletable', username: 'deletable.user', passwordHash: hashCommon, rol: 'EMPLEADO',
      activo: true, empresaId: empresaA.id, sucursalId: sucursalA.id
    } })
    companyMutable = await prisma.usuario.create({ data: {
      nombre: 'Company Mutable', username: 'company.mutable', passwordHash: hashCommon, rol: 'SUPERADMIN',
      activo: true, empresaId: empresaB.id, sucursalId: null
    } })
    await prisma.usuario.create({ data: {
      nombre: 'Branch Mutable', username: 'branch.mutable', passwordHash: hashCommon, rol: 'EMPLEADO',
      activo: true, empresaId: empresaA.id, sucursalId: branchMutable.id
    } })
  })

  after(async () => {
    const failures = []
    if (prisma) {
      try { await prisma.$disconnect() } catch (err) { failures.push(`prisma disconnect: ${err.message}`) }
      if (prisma.pool) {
        try { await prisma.pool.end() } catch (err) { failures.push(`pool end: ${err.message}`) }
      }
    }

    if (created) {
      try {
        await adminPool.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
          [dbName]
        )
        await adminPool.query(`DROP DATABASE ${quoteDb(dbName)}`)
        const result = await adminPool.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])
        if (result.rows.length !== 0) failures.push('base temporal residual')
      } catch (err) {
        failures.push(`drop: ${err.message}`)
      }
    }

    try { await adminPool.end() } catch (err) { failures.push(`admin pool end: ${err.message}`) }
    if (failures.length > 0) throw new Error(failures.join(' | '))
  })

  it('mismo username se desambigua por empresaSlug y contraseña', async () => {
    let res = mockRes()
    await controller.login(loginReq('empresa-a', 'shared.user', 'password-a'), res)
    assert.strictEqual(res._state.statusCode, 200)
    assert.strictEqual(res._state.body.usuario.id, sharedA.id)
    assert.strictEqual(res._state.body.usuario.empresaId, empresaA.id)

    res = mockRes()
    await controller.login(loginReq('empresa-b', 'shared.user', 'password-b'), res)
    assert.strictEqual(res._state.statusCode, 200)
    assert.strictEqual(res._state.body.usuario.id, sharedB.id)
    assert.strictEqual(res._state.body.usuario.empresaId, empresaB.id)

    res = mockRes()
    await controller.login(loginReq('empresa-a', 'shared.user', 'password-b'), res)
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('login emite token mínimo tenant y auditoría tenantizada', async () => {
    const res = mockRes()
    await controller.login(loginReq('empresa-a', 'shared.user', 'password-a'), res)
    const payload = jwt.verify(res._state.body.token, TENANT_SECRET, {
      algorithms: ['HS256'], issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE
    })
    assert.strictEqual(payload.version, 1)
    assert.strictEqual(payload.kind, 'TENANT')
    assert.strictEqual(payload.sub, sharedA.id)
    assert.strictEqual(payload.rol, 'ADMIN_SUCURSAL')
    assert.strictEqual(payload.empresaId, undefined)
    assert.strictEqual(payload.sucursalId, undefined)
    const audit = await prisma.auditoria.findFirst({
      where: { usuarioId: sharedA.id, empresaId: empresaA.id, sucursalId: sucursalA.id, accion: 'LOGIN' }
    })
    assert.ok(audit)
  })

  it('body sin empresaSlug es 400 y slug inexistente no filtra información', async () => {
    let res = mockRes()
    await controller.login({ ...loginReq('empresa-a', 'shared.user', 'password-a'), body: { username: 'shared.user', password: 'password-a' } }, res)
    assert.strictEqual(res._state.statusCode, 400)

    res = mockRes()
    await controller.login(loginReq('empresa-inexistente', 'shared.user', 'password-a'), res)
    assert.strictEqual(res._state.statusCode, 401)
    assert.deepStrictEqual(res._state.body, { error: 'Credenciales inválidas' })
  })

  it('SUPERADMIN, ADMIN_SUCURSAL, EMPLEADO y PRECIOS autentican según su identidad', async () => {
    for (const [username, rol] of [
      ['super.a', 'SUPERADMIN'],
      ['shared.user', 'ADMIN_SUCURSAL'],
      ['employee.a', 'EMPLEADO'],
      ['prices.global', 'PRECIOS'],
      ['prices.branch', 'PRECIOS']
    ]) {
      const password = username === 'shared.user' ? 'password-a' : 'password-common'
      const res = mockRes()
      await controller.login(loginReq('empresa-a', username, password), res)
      assert.strictEqual(res._state.statusCode, 200, username)
      assert.strictEqual(res._state.body.usuario.rol, rol)
    }
    assert.ok(superA.id && employeeA.id && pricesGlobal.id && pricesBranch.id)
  })

  it('bloquea empresa, usuario o sucursal inactiva, mismatch y PLATFORM_ADMIN', async () => {
    for (const [slug, username] of [
      ['empresa-inactiva', 'inactive.company'],
      ['empresa-a', 'inactive.user'],
      ['empresa-a', 'inactive.branch'],
      ['empresa-a', 'mismatch.branch'],
      ['empresa-a', 'platform.legacy']
    ]) {
      const res = mockRes()
      await controller.login(loginReq(slug, username, 'password-common'), res)
      assert.strictEqual(res._state.statusCode, 401, username)
      assert.deepStrictEqual(res._state.body, { error: 'Credenciales inválidas' })
    }
  })

  it('middleware rehidrata desde PostgreSQL e ignora claims falsos', async () => {
    const token = signTenant(sharedA.id, 'ADMIN_SUCURSAL', {
      empresaId: 999, sucursalId: 888, username: 'forged', nombre: 'forged'
    })
    const req = middlewareReq(token)
    const res = mockRes()
    let nextCalled = false
    await middleware.requireAuth(req, res, () => { nextCalled = true })
    assert.strictEqual(nextCalled, true)
    assert.strictEqual(req.usuario.id, sharedA.id)
    assert.strictEqual(req.usuario.empresaId, empresaA.id)
    assert.strictEqual(req.usuario.sucursalId, sucursalA.id)
    assert.strictEqual(req.usuario.username, 'shared.user')
    assert.deepStrictEqual(req.authPrincipal, {
      version: 1, kind: 'TENANT', sub: sharedA.id, rol: 'ADMIN_SUCURSAL'
    })
  })

  it('token queda invalidado al cambiar rol o eliminar usuario', async () => {
    const roleToken = signTenant(mutable.id, 'ADMIN_SUCURSAL')
    await prisma.usuario.update({ where: { id: mutable.id }, data: { rol: 'SUPERADMIN', sucursalId: null } })
    let req = middlewareReq(roleToken)
    let res = mockRes()
    await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 403)

    const deleteToken = signTenant(deletable.id, 'EMPLEADO')
    await prisma.usuario.delete({ where: { id: deletable.id } })
    req = middlewareReq(deleteToken)
    res = mockRes()
    await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 403)
  })

  it('token queda invalidado al desactivar empresa o sucursal', async () => {
    const companyToken = signTenant(companyMutable.id, 'SUPERADMIN')
    await prisma.empresa.update({ where: { id: empresaB.id }, data: { activa: false } })
    let req = middlewareReq(companyToken)
    let res = mockRes()
    await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 403)
    await prisma.empresa.update({ where: { id: empresaB.id }, data: { activa: true } })

    const branchUser = await prisma.usuario.findUnique({
      where: { empresaId_username: { empresaId: empresaA.id, username: 'branch.mutable' } }
    })
    const branchToken = signTenant(branchUser.id, 'EMPLEADO')
    await prisma.sucursal.update({ where: { id: branchMutable.id }, data: { activa: false } })
    req = middlewareReq(branchToken)
    res = mockRes()
    await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 403)
  })

  it('token de plataforma y token con issuer incorrecto son rechazados', async () => {
    const tokens = [
      jwt.sign({ version: 1, kind: 'PLATFORM', sub: sharedA.id, rol: 'PLATFORM_ADMIN' }, TENANT_SECRET, {
        algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '15m'
      }),
      signTenant(sharedA.id, 'ADMIN_SUCURSAL', {}, { issuer: 'wrong' })
    ]
    for (const token of tokens) {
      const req = middlewareReq(token)
      const res = mockRes()
      await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
      assert.strictEqual(res._state.statusCode, 401)
    }
  })

  it('token de otra empresa no puede alterar el tenant rehidratado', async () => {
    const token = signTenant(sharedB.id, 'ADMIN_SUCURSAL', { empresaId: empresaA.id, sucursalId: sucursalA.id })
    const req = middlewareReq(token)
    const res = mockRes()
    await middleware.requireAuth(req, res, () => {})
    assert.strictEqual(req.usuario.empresaId, empresaB.id)
    assert.strictEqual(req.usuario.sucursalId, sucursalB.id)
  })
})
