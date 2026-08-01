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
const DB_PREFIX = 'jesha_p0_platform_auth_test_'
const DB_RE = /^jesha_p0_platform_auth_test_[a-z0-9_]+$/
const PLATFORM_SECRET = 'platform-postgres-test-secret-'.padEnd(64, 'p')
const PLATFORM_ISSUER = 'jesha-platform-postgres-test'
const PLATFORM_AUDIENCE = 'jesha-platform-api-postgres-test'
const TENANT_SECRET = 'tenant-postgres-test-secret-'.padEnd(64, 't')

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
      cwd: BACKEND_DIR,
      env,
      stdio: 'pipe',
      timeout: 120000
    })
    return
  }
  execFileSync('npx', args, {
    cwd: BACKEND_DIR,
    env,
    stdio: 'pipe',
    timeout: 120000
  })
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

function loginReq(username, password) {
  return {
    body: { username, password },
    headers: {},
    path: '/platform/auth/login',
    requestId: 'pg-platform-login',
    ip: '127.0.0.1'
  }
}

function middlewareReq(token) {
  return {
    headers: { authorization: `Bearer ${token}` },
    path: '/platform/auth/me',
    requestId: 'pg-platform-me'
  }
}

describe('P0-PLATFORM-AUTH PostgreSQL aislado', { concurrency: 1, timeout: 240000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig, 'postgres'), max: 1 })

  let created = false
  let prisma
  let controller
  let middleware
  let validUser
  let legacyUser
  let tenantUser
  let inactiveUser
  let mutableUser
  let deleteUser

  before(async () => {
    await adminPool.query(`CREATE DATABASE ${quoteDb(dbName)}`)
    created = true
    dbPush(databaseUrl)

    process.env.DATABASE_URL = databaseUrl
    process.env.PLATFORM_JWT_SECRET = PLATFORM_SECRET
    process.env.PLATFORM_JWT_ISSUER = PLATFORM_ISSUER
    process.env.PLATFORM_JWT_AUDIENCE = PLATFORM_AUDIENCE
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = 'jesha-tenant-postgres-test'
    process.env.TENANT_JWT_AUDIENCE = 'jesha-tenant-api-postgres-test'
    process.env.TENANT_JWT_TTL = '8h'

    prisma = require('../src/lib/prisma')
    controller = require('../src/modules/platform-auth/platform-auth.controller')
    middleware = require('../src/middlewares/platform-auth.middleware')

    const empresa = await prisma.empresa.create({
      data: {
        slug: 'platform-auth-test',
        nombreComercial: 'Platform Auth Test',
        razonSocial: 'Platform Auth Test SA de CV',
        whatsapp: '0000000000',
        activa: true
      }
    })
    const sucursal = await prisma.sucursal.create({
      data: {
        empresaId: empresa.id,
        nombre: 'Sucursal test',
        codigoPostal: '00000',
        activa: true
      }
    })

    const hash = await bcrypt.hash('correct-password', 10)
    validUser = await prisma.usuario.create({
      data: {
        nombre: 'Platform Valid', username: 'platform.valid', passwordHash: hash,
        rol: 'PLATFORM_ADMIN', activo: true, empresaId: null, sucursalId: null
      }
    })
    legacyUser = await prisma.usuario.create({
      data: {
        nombre: 'Platform Legacy', username: 'platform.legacy', passwordHash: hash,
        rol: 'PLATFORM_ADMIN', activo: true, empresaId: empresa.id, sucursalId: null
      }
    })
    tenantUser = await prisma.usuario.create({
      data: {
        nombre: 'Tenant Admin', username: 'tenant.admin', passwordHash: hash,
        rol: 'ADMIN_SUCURSAL', activo: true, empresaId: empresa.id, sucursalId: sucursal.id
      }
    })
    inactiveUser = await prisma.usuario.create({
      data: {
        nombre: 'Platform Inactive', username: 'platform.inactive', passwordHash: hash,
        rol: 'PLATFORM_ADMIN', activo: false, empresaId: null, sucursalId: null
      }
    })
    mutableUser = await prisma.usuario.create({
      data: {
        nombre: 'Platform Mutable', username: 'platform.mutable', passwordHash: hash,
        rol: 'PLATFORM_ADMIN', activo: true, empresaId: null, sucursalId: null
      }
    })
    deleteUser = await prisma.usuario.create({
      data: {
        nombre: 'Platform Delete', username: 'platform.delete', passwordHash: hash,
        rol: 'PLATFORM_ADMIN', activo: true, empresaId: null, sucursalId: null
      }
    })

    await prisma.usuario.createMany({
      data: [
        {
          nombre: 'Duplicate A', username: 'platform.duplicate', passwordHash: hash,
          rol: 'PLATFORM_ADMIN', activo: true, empresaId: null, sucursalId: null
        },
        {
          nombre: 'Duplicate B', username: 'platform.duplicate', passwordHash: hash,
          rol: 'PLATFORM_ADMIN', activo: true, empresaId: null, sucursalId: null
        }
      ]
    })
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

  it('login válido emite token mínimo y crea auditoría', async () => {
    const res = mockRes()
    await controller.login(loginReq('platform.valid', 'correct-password'), res)
    assert.strictEqual(res._state.statusCode, 200)
    const payload = jwt.verify(res._state.body.token, PLATFORM_SECRET, {
      algorithms: ['HS256'], issuer: PLATFORM_ISSUER, audience: PLATFORM_AUDIENCE
    })
    assert.strictEqual(payload.sub, validUser.id)
    assert.strictEqual(payload.kind, 'PLATFORM')
    assert.strictEqual(payload.rol, 'PLATFORM_ADMIN')
    assert.strictEqual(payload.empresaId, undefined)
    assert.strictEqual(payload.sucursalId, undefined)
    const audit = await prisma.auditoria.findFirst({
      where: { usuarioId: validUser.id, accion: 'PLATFORM_LOGIN', modulo: 'platform-auth' }
    })
    assert.ok(audit)
    assert.strictEqual(audit.empresaId, null)
    assert.strictEqual(audit.sucursalId, null)
  })

  it('bloquea contraseña incorrecta, usuario inactivo y usuario tenant', async () => {
    for (const [username, password] of [
      ['platform.valid', 'wrong-password'],
      ['platform.inactive', 'correct-password'],
      ['tenant.admin', 'correct-password']
    ]) {
      const res = mockRes()
      await controller.login(loginReq(username, password), res)
      assert.strictEqual(res._state.statusCode, 401)
      assert.deepStrictEqual(res._state.body, { error: 'Credenciales inválidas' })
    }
    assert.ok(inactiveUser.id)
    assert.ok(tenantUser.id)
  })

  it('bloquea PLATFORM_ADMIN legacy', async () => {
    const res = mockRes()
    await controller.login(loginReq('platform.legacy', 'correct-password'), res)
    assert.strictEqual(res._state.statusCode, 401)
    assert.ok(legacyUser.id)
  })

  it('duplicidad de PLATFORM_ADMIN activo falla cerrado', async () => {
    const res = mockRes()
    await controller.login(loginReq('platform.duplicate', 'correct-password'), res)
    assert.strictEqual(res._state.statusCode, 500)
    assert.deepStrictEqual(res._state.body, { error: 'Error interno de autenticación' })
  })

  it('middleware rehidrata desde PostgreSQL e ignora claims falsos', async () => {
    const token = jwt.sign({
      version: 1,
      kind: 'PLATFORM',
      sub: validUser.id,
      rol: 'PLATFORM_ADMIN',
      empresaId: 999,
      sucursalId: 888,
      username: 'forged'
    }, PLATFORM_SECRET, {
      algorithm: 'HS256', issuer: PLATFORM_ISSUER, audience: PLATFORM_AUDIENCE, expiresIn: '15m'
    })
    const req = middlewareReq(token)
    const res = mockRes()
    let nextCalled = false
    await middleware.autenticarPlataforma(req, res, () => { nextCalled = true })
    assert.strictEqual(nextCalled, true)
    assert.strictEqual(req.platformActor.id, validUser.id)
    assert.strictEqual(req.platformActor.username, 'platform.valid')
    assert.strictEqual(req.platformActor.empresaId, null)
    assert.strictEqual(req.platformActor.sucursalId, null)
    assert.strictEqual(req.usuario, undefined)
  })

  it('token queda invalidado al desactivar o cambiar rol en BD', async () => {
    const token = jwt.sign({
      version: 1, kind: 'PLATFORM', sub: mutableUser.id, rol: 'PLATFORM_ADMIN'
    }, PLATFORM_SECRET, {
      algorithm: 'HS256', issuer: PLATFORM_ISSUER, audience: PLATFORM_AUDIENCE, expiresIn: '15m'
    })

    await prisma.usuario.update({ where: { id: mutableUser.id }, data: { activo: false } })
    let req = middlewareReq(token)
    let res = mockRes()
    await middleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 403)

    await prisma.usuario.update({
      where: { id: mutableUser.id },
      data: { activo: true, rol: 'SUPERADMIN', empresaId: tenantUser.empresaId, sucursalId: null }
    })
    req = middlewareReq(token)
    res = mockRes()
    await middleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 403)
  })

  it('token queda invalidado al eliminar usuario en BD', async () => {
    const token = jwt.sign({
      version: 1, kind: 'PLATFORM', sub: deleteUser.id, rol: 'PLATFORM_ADMIN'
    }, PLATFORM_SECRET, {
      algorithm: 'HS256', issuer: PLATFORM_ISSUER, audience: PLATFORM_AUDIENCE, expiresIn: '15m'
    })
    await prisma.usuario.delete({ where: { id: deleteUser.id } })
    const req = middlewareReq(token)
    const res = mockRes()
    await middleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 403)
  })

  it('token tenant y token con issuer incorrecto son rechazados', async () => {
    const tokens = [
      jwt.sign({ version: 1, kind: 'TENANT', sub: validUser.id, rol: 'SUPERADMIN' }, PLATFORM_SECRET, {
        algorithm: 'HS256', issuer: PLATFORM_ISSUER, audience: PLATFORM_AUDIENCE, expiresIn: '15m'
      }),
      jwt.sign({ version: 1, kind: 'PLATFORM', sub: validUser.id, rol: 'PLATFORM_ADMIN' }, PLATFORM_SECRET, {
        algorithm: 'HS256', issuer: 'wrong', audience: PLATFORM_AUDIENCE, expiresIn: '15m'
      })
    ]
    for (const token of tokens) {
      const req = middlewareReq(token)
      const res = mockRes()
      await middleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
      assert.strictEqual(res._state.statusCode, 401)
    }
  })
})
