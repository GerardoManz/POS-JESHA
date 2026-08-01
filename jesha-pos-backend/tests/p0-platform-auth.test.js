'use strict'

process.env.PLATFORM_JWT_SECRET = 'platform-test-secret-'.padEnd(64, 'x')
process.env.PLATFORM_JWT_ISSUER = 'jesha-platform-test'
process.env.PLATFORM_JWT_AUDIENCE = 'jesha-platform-api-test'
process.env.PLATFORM_JWT_TTL = '15m'
process.env.TENANT_JWT_SECRET = 'tenant-test-secret-'.padEnd(64, 'y')
process.env.TENANT_JWT_ISSUER = 'jesha-tenant-test'
process.env.TENANT_JWT_AUDIENCE = 'jesha-tenant-api-test'
process.env.TENANT_JWT_TTL = '8h'

const assert = require('node:assert/strict')
const { describe, it, before, after, beforeEach } = require('node:test')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const prisma = require('../src/lib/prisma')
const {
  resolvePlatformAuthConfig,
  PlatformAuthConfigError
} = require('../src/modules/platform-auth/platform-auth.config')
const platformController = require('../src/modules/platform-auth/platform-auth.controller')
const platformMiddleware = require('../src/middlewares/platform-auth.middleware')
const tenantController = require('../src/modules/auth/auth.controller')
const tenantMiddleware = require('../src/middlewares/auth.middleware')

const CONFIG = resolvePlatformAuthConfig()

const ORIGINALS = {}

function mockRes() {
  const state = { statusCode: 200, body: null }
  return {
    _state: state,
    status(code) { state.statusCode = code; return this },
    json(body) { state.body = body; return this },
    end() { return this }
  }
}

function platformUser(overrides = {}) {
  return {
    id: 101,
    nombre: 'Platform Owner',
    username: 'platform.owner',
    passwordHash: 'hash-ok',
    rol: 'PLATFORM_ADMIN',
    activo: true,
    empresaId: null,
    sucursalId: null,
    ...overrides
  }
}

function platformReq(body = { username: 'platform.owner', password: 'correct' }) {
  return {
    body,
    headers: {},
    path: '/login',
    ip: '127.0.0.1',
    requestId: 'req-platform-test'
  }
}

function signPlatform(payload = {}, options = {}) {
  return jwt.sign(
    {
      version: 1,
      kind: 'PLATFORM',
      sub: 101,
      rol: 'PLATFORM_ADMIN',
      ...payload
    },
    options.secret || CONFIG.secret,
    {
      algorithm: options.algorithm || CONFIG.algorithm,
      issuer: options.issuer || CONFIG.issuer,
      audience: options.audience || CONFIG.audience,
      expiresIn: options.expiresIn === undefined ? '15m' : options.expiresIn
    }
  )
}

function middlewareReq(token) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    path: '/me',
    requestId: 'req-middleware-test'
  }
}

before(() => {
  ORIGINALS.usuarioFindMany = prisma.usuario.findMany
  ORIGINALS.usuarioFindUnique = prisma.usuario.findUnique
  ORIGINALS.usuarioFindFirst = prisma.usuario.findFirst
  ORIGINALS.empresaFindUnique = prisma.empresa.findUnique
  ORIGINALS.sucursalFindUnique = prisma.sucursal.findUnique
  ORIGINALS.auditoriaCreate = prisma.auditoria.create
  ORIGINALS.bcryptCompare = bcrypt.compare
})

after(() => {
  prisma.usuario.findMany = ORIGINALS.usuarioFindMany
  prisma.usuario.findUnique = ORIGINALS.usuarioFindUnique
  prisma.usuario.findFirst = ORIGINALS.usuarioFindFirst
  prisma.empresa.findUnique = ORIGINALS.empresaFindUnique
  prisma.sucursal.findUnique = ORIGINALS.sucursalFindUnique
  prisma.auditoria.create = ORIGINALS.auditoriaCreate
  bcrypt.compare = ORIGINALS.bcryptCompare
})

beforeEach(() => {
  prisma.usuario.findMany = async () => [platformUser()]
  prisma.usuario.findUnique = async () => platformUser()
  prisma.usuario.findFirst = async () => null
  prisma.empresa.findUnique = async () => ({ id: 1, slug: 'jesha', nombreComercial: 'JESHA', activa: true })
  prisma.sucursal.findUnique = async () => ({ id: 1, empresaId: 1, nombre: 'Matriz', activa: true })
  prisma.auditoria.create = async ({ data }) => ({ id: 1, ...data })
  bcrypt.compare = async (password, hash) => password === 'correct' && hash === 'hash-ok'
})

describe('P0-PLATFORM-AUTH config', { concurrency: 1 }, () => {
  it('resuelve configuración separada y congelada', () => {
    const config = resolvePlatformAuthConfig({
      PLATFORM_JWT_SECRET: 's'.repeat(32),
      PLATFORM_JWT_ISSUER: 'issuer',
      PLATFORM_JWT_AUDIENCE: 'audience',
      PLATFORM_JWT_TTL: '30m',
      JWT_SECRET: 'tenant-secret-that-must-not-be-used'
    })
    assert.strictEqual(config.secret, 's'.repeat(32))
    assert.strictEqual(config.algorithm, 'HS256')
    assert.ok(Object.isFrozen(config))
  })

  it('no usa JWT_SECRET como fallback', () => {
    assert.throws(
      () => resolvePlatformAuthConfig({
        JWT_SECRET: 'z'.repeat(64),
        PLATFORM_JWT_ISSUER: 'issuer',
        PLATFORM_JWT_AUDIENCE: 'audience',
        PLATFORM_JWT_TTL: '15m'
      }),
      PlatformAuthConfigError
    )
  })

  it('rechaza secreto corto', () => {
    assert.throws(
      () => resolvePlatformAuthConfig({
        PLATFORM_JWT_SECRET: 'short',
        PLATFORM_JWT_ISSUER: 'issuer',
        PLATFORM_JWT_AUDIENCE: 'audience',
        PLATFORM_JWT_TTL: '15m'
      }),
      { code: 'PLATFORM_AUTH_SECRET_WEAK' }
    )
  })

  it('rechaza TTL ambiguo o sin unidad', () => {
    assert.throws(
      () => resolvePlatformAuthConfig({
        PLATFORM_JWT_SECRET: 's'.repeat(32),
        PLATFORM_JWT_ISSUER: 'issuer',
        PLATFORM_JWT_AUDIENCE: 'audience',
        PLATFORM_JWT_TTL: '900'
      }),
      { code: 'PLATFORM_AUTH_TTL_INVALID' }
    )
  })
})

describe('P0-PLATFORM-AUTH login', { concurrency: 1 }, () => {
  it('acepta body exacto y normaliza username', () => {
    assert.deepStrictEqual(
      platformController.parsePlatformLoginBody({ username: '  owner  ', password: ' x ' }),
      { username: 'owner', password: ' x ' }
    )
  })

  it('rechaza empresaSlug y campos adicionales', () => {
    assert.throws(
      () => platformController.parsePlatformLoginBody({
        username: 'owner', password: 'x', empresaSlug: 'jesha'
      }),
      { code: 'PLATFORM_LOGIN_BODY_INVALID' }
    )
  })

  it('login correcto emite claims mínimos de plataforma', async () => {
    const req = platformReq()
    const res = mockRes()
    await platformController.login(req, res)

    assert.strictEqual(res._state.statusCode, 200)
    assert.strictEqual(res._state.body.expiresIn, CONFIG.ttl)
    const payload = jwt.verify(res._state.body.token, CONFIG.secret, {
      algorithms: [CONFIG.algorithm],
      issuer: CONFIG.issuer,
      audience: CONFIG.audience
    })
    assert.strictEqual(payload.version, 1)
    assert.strictEqual(payload.kind, 'PLATFORM')
    assert.strictEqual(payload.sub, 101)
    assert.strictEqual(payload.rol, 'PLATFORM_ADMIN')
    for (const forbidden of ['id', 'empresaId', 'sucursalId', 'username', 'nombre', 'activo', 'passwordHash', 'pin']) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, forbidden), false, forbidden)
    }
  })

  it('audita PLATFORM_LOGIN sin empresa ni sucursal', async () => {
    let auditData = null
    prisma.auditoria.create = async ({ data }) => { auditData = data; return { id: 1 } }
    const res = mockRes()
    await platformController.login(platformReq(), res)
    assert.strictEqual(res._state.statusCode, 200)
    assert.deepStrictEqual(auditData, {
      empresaId: null,
      usuarioId: 101,
      sucursalId: null,
      accion: 'PLATFORM_LOGIN',
      modulo: 'platform-auth',
      ip: '127.0.0.1'
    })
  })

  it('contraseña incorrecta devuelve 401 genérico', async () => {
    const res = mockRes()
    await platformController.login(platformReq({ username: 'platform.owner', password: 'wrong' }), res)
    assert.strictEqual(res._state.statusCode, 401)
    assert.deepStrictEqual(res._state.body, { error: 'Credenciales inválidas' })
  })

  it('usuario inexistente o inactivo devuelve 401 genérico', async () => {
    prisma.usuario.findMany = async () => []
    const res = mockRes()
    await platformController.login(platformReq(), res)
    assert.strictEqual(res._state.statusCode, 401)
    assert.deepStrictEqual(res._state.body, { error: 'Credenciales inválidas' })
  })

  it('usuario tenant no puede entrar por plataforma', async () => {
    prisma.usuario.findMany = async () => [platformUser({ rol: 'SUPERADMIN', empresaId: 1 })]
    const res = mockRes()
    await platformController.login(platformReq(), res)
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('PLATFORM_ADMIN legacy queda bloqueado', async () => {
    prisma.usuario.findMany = async () => [platformUser({ empresaId: 1 })]
    const res = mockRes()
    await platformController.login(platformReq(), res)
    assert.strictEqual(res._state.statusCode, 401)
    assert.deepStrictEqual(res._state.body, { error: 'Credenciales inválidas' })
  })

  it('duplicidad de candidato falla cerrado con 500 seguro', async () => {
    prisma.usuario.findMany = async () => [platformUser(), platformUser({ id: 102 })]
    const res = mockRes()
    await platformController.login(platformReq(), res)
    assert.strictEqual(res._state.statusCode, 500)
    assert.deepStrictEqual(res._state.body, { error: 'Error interno de autenticación' })
  })
})

describe('P0-PLATFORM-AUTH middleware', { concurrency: 1 }, () => {
  it('exige Bearer estricto', () => {
    assert.throws(() => platformMiddleware.extractStrictBearer(undefined), { code: 'PLATFORM_TOKEN_MISSING' })
    assert.throws(() => platformMiddleware.extractStrictBearer('bearer abc'), { code: 'PLATFORM_TOKEN_MALFORMED' })
    assert.throws(() => platformMiddleware.extractStrictBearer('Bearer a b'), { code: 'PLATFORM_TOKEN_MALFORMED' })
    assert.strictEqual(platformMiddleware.extractStrictBearer('Bearer abc.def'), 'abc.def')
  })

  it('token válido rehidrata actor y principal desde BD', async () => {
    const req = middlewareReq(signPlatform())
    const res = mockRes()
    let nextCalled = false
    await platformMiddleware.autenticarPlataforma(req, res, () => { nextCalled = true })

    assert.strictEqual(nextCalled, true)
    assert.ok(Object.isFrozen(req.platformActor))
    assert.ok(Object.isFrozen(req.platformPrincipal))
    assert.deepStrictEqual(req.platformPrincipal, {
      version: 1, kind: 'PLATFORM', sub: 101, rol: 'PLATFORM_ADMIN'
    })
    assert.strictEqual(req.platformActor.empresaId, null)
    assert.strictEqual(req.platformActor.sucursalId, null)
    assert.strictEqual(req.usuario, undefined)
  })

  it('ignora claims de empresa, sucursal y perfil y usa la BD', async () => {
    const token = signPlatform({
      empresaId: 999,
      sucursalId: 888,
      username: 'forged',
      nombre: 'forged',
      activo: false
    })
    const req = middlewareReq(token)
    const res = mockRes()
    let nextCalled = false
    await platformMiddleware.autenticarPlataforma(req, res, () => { nextCalled = true })

    assert.strictEqual(nextCalled, true)
    assert.strictEqual(req.platformActor.username, 'platform.owner')
    assert.strictEqual(req.platformActor.nombre, 'Platform Owner')
    assert.strictEqual(req.platformActor.activo, true)
    assert.strictEqual(req.platformActor.empresaId, null)
    assert.strictEqual(req.platformActor.sucursalId, null)
  })

  it('bloquea token tenant aunque esté firmado con secreto de plataforma', async () => {
    const token = signPlatform({ kind: 'TENANT', rol: 'SUPERADMIN' })
    const req = middlewareReq(token)
    const res = mockRes()
    await platformMiddleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('bloquea issuer incorrecto', async () => {
    const req = middlewareReq(signPlatform({}, { issuer: 'wrong-issuer' }))
    const res = mockRes()
    await platformMiddleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('bloquea audience incorrecta', async () => {
    const req = middlewareReq(signPlatform({}, { audience: 'wrong-audience' }))
    const res = mockRes()
    await platformMiddleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('bloquea algoritmo distinto', async () => {
    const req = middlewareReq(signPlatform({}, { algorithm: 'HS384' }))
    const res = mockRes()
    await platformMiddleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('bloquea token expirado', async () => {
    const req = middlewareReq(signPlatform({}, { expiresIn: -1 }))
    const res = mockRes()
    await platformMiddleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('bloquea usuario eliminado o inactivo después de emitir token', async () => {
    for (const dbValue of [null, platformUser({ activo: false })]) {
      prisma.usuario.findUnique = async () => dbValue
      const req = middlewareReq(signPlatform())
      const res = mockRes()
      await platformMiddleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
      assert.strictEqual(res._state.statusCode, 403)
    }
  })

  it('bloquea cambio de rol e identidad legacy después de emitir token', async () => {
    for (const dbValue of [
      platformUser({ rol: 'SUPERADMIN', empresaId: 1 }),
      platformUser({ empresaId: 1 })
    ]) {
      prisma.usuario.findUnique = async () => dbValue
      const req = middlewareReq(signPlatform())
      const res = mockRes()
      await platformMiddleware.autenticarPlataforma(req, res, () => assert.fail('next no debe ejecutarse'))
      assert.strictEqual(res._state.statusCode, 403)
    }
  })

  it('/me expone solo id, rol y kind', () => {
    const req = {
      platformActor: Object.freeze({ id: 101, rol: 'PLATFORM_ADMIN' }),
      platformPrincipal: Object.freeze({ kind: 'PLATFORM' })
    }
    const res = mockRes()
    platformController.me(req, res)
    assert.deepStrictEqual(res._state.body, {
      id: 101,
      rol: 'PLATFORM_ADMIN',
      kind: 'PLATFORM'
    })
  })
})

describe('Aislamiento respecto al auth compartido', { concurrency: 1 }, () => {
  it('POST /auth/login bloquea PLATFORM_ADMIN aunque pertenezca a empresa legacy', async () => {
    prisma.usuario.findUnique = async () => platformUser({ empresaId: 1 })
    const req = platformReq({ empresaSlug: 'jesha', username: 'platform.owner', password: 'correct' })
    const res = mockRes()
    await tenantController.login(req, res)
    assert.strictEqual(res._state.statusCode, 401)
    assert.deepStrictEqual(res._state.body, { error: 'Credenciales inválidas' })
  })

  it('requireAuth tenant rechaza token PLATFORM firmado con secreto tenant', async () => {
    const token = jwt.sign({
      version: 1,
      kind: 'PLATFORM',
      sub: 101,
      rol: 'PLATFORM_ADMIN'
    }, process.env.TENANT_JWT_SECRET, {
      algorithm: 'HS256',
      issuer: process.env.TENANT_JWT_ISSUER,
      audience: process.env.TENANT_JWT_AUDIENCE,
      expiresIn: '1h'
    })

    const req = {
      headers: { authorization: `Bearer ${token}` },
      query: {},
      path: '/precios'
    }
    const res = mockRes()
    await tenantMiddleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 401)
  })
})
