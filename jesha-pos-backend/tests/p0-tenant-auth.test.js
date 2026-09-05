'use strict'

process.env.TENANT_JWT_SECRET = 'tenant-test-secret-'.padEnd(64, 't')
process.env.TENANT_JWT_ISSUER = 'jesha-tenant-test'
process.env.TENANT_JWT_AUDIENCE = 'jesha-tenant-api-test'
process.env.TENANT_JWT_TTL = '8h'
process.env.PLATFORM_JWT_SECRET = 'platform-test-secret-'.padEnd(64, 'p')
process.env.PLATFORM_JWT_ISSUER = 'jesha-platform-test'
process.env.PLATFORM_JWT_AUDIENCE = 'jesha-platform-api-test'
process.env.PLATFORM_JWT_TTL = '15m'

const assert = require('node:assert/strict')
const { describe, it, before, after, beforeEach } = require('node:test')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const prisma = require('../src/lib/prisma')
const {
  resolveTenantAuthConfig,
  TenantAuthConfigError
} = require('../src/modules/auth/tenant-auth.config')
const controller = require('../src/modules/auth/auth.controller')
const middleware = require('../src/middlewares/auth.middleware')

const CONFIG = resolveTenantAuthConfig()
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

function empresa(overrides = {}) {
  return {
    id: 10,
    slug: 'empresa-a',
    nombreComercial: 'Empresa A',
    activa: true,
    logoUrl: null,
    colorPrimario: '#1e3a5f',
    colorSecundario: '#3b82f6',
    colorAcento: '#10b981',
    ...overrides
  }
}

function sucursal(overrides = {}) {
  return {
    id: 20,
    empresaId: 10,
    nombre: 'Matriz',
    activa: true,
    ...overrides
  }
}

function tenantUser(overrides = {}) {
  return {
    id: 100,
    nombre: 'Tenant User',
    username: 'shared.user',
    passwordHash: 'hash-ok',
    rol: 'ADMIN_SUCURSAL',
    activo: true,
    empresaId: 10,
    sucursalId: 20,
    tema: 'dark',
    ...overrides
  }
}

function loginReq(body = { empresaSlug: 'empresa-a', username: 'shared.user', password: 'correct' }) {
  return {
    body,
    headers: {},
    query: {},
    path: '/auth/login',
    ip: '127.0.0.1',
    requestId: 'tenant-login-test'
  }
}

function signTenant(payload = {}, options = {}) {
  return jwt.sign({
    version: 1,
    kind: 'TENANT',
    sub: 100,
    rol: 'ADMIN_SUCURSAL',
    ...payload
  }, options.secret || CONFIG.secret, {
    algorithm: options.algorithm || CONFIG.algorithm,
    issuer: options.issuer || CONFIG.issuer,
    audience: options.audience || CONFIG.audience,
    expiresIn: options.expiresIn === undefined ? '1h' : options.expiresIn
  })
}

function middlewareReq(token, { query = false } = {}) {
  return {
    headers: query ? {} : { authorization: `Bearer ${token}` },
    query: query ? { token } : {},
    params: {},
    body: {},
    path: '/ventas',
    requestId: 'tenant-middleware-test'
  }
}

before(() => {
  ORIGINALS.empresaFindUnique = prisma.empresa.findUnique
  ORIGINALS.usuarioFindUnique = prisma.usuario.findUnique
  ORIGINALS.sucursalFindUnique = prisma.sucursal.findUnique
  ORIGINALS.auditoriaCreate = prisma.auditoria.create
  ORIGINALS.bcryptCompare = bcrypt.compare
})

after(() => {
  prisma.empresa.findUnique = ORIGINALS.empresaFindUnique
  prisma.usuario.findUnique = ORIGINALS.usuarioFindUnique
  prisma.sucursal.findUnique = ORIGINALS.sucursalFindUnique
  prisma.auditoria.create = ORIGINALS.auditoriaCreate
  bcrypt.compare = ORIGINALS.bcryptCompare
})

beforeEach(() => {
  prisma.empresa.findUnique = async ({ where }) => {
    if (where.slug === 'empresa-a' || where.id === 10) return empresa()
    return null
  }
  prisma.usuario.findUnique = async ({ where }) => {
    if (where.id === 100) return tenantUser()
    if (where.empresaId_username) {
      const { empresaId, username } = where.empresaId_username
      if (empresaId === 10 && username === 'shared.user') return tenantUser()
    }
    return null
  }
  prisma.sucursal.findUnique = async ({ where }) => where.id === 20 ? sucursal() : null
  prisma.auditoria.create = async ({ data }) => ({ id: 1, ...data })
  bcrypt.compare = async (password, hash) => password === 'correct' && hash === 'hash-ok'
})

describe('P0-TENANT-AUTH config', { concurrency: 1 }, () => {
  it('resuelve configuración separada y congelada', () => {
    const config = resolveTenantAuthConfig({
      TENANT_JWT_SECRET: 's'.repeat(32),
      TENANT_JWT_ISSUER: 'issuer',
      TENANT_JWT_AUDIENCE: 'audience',
      TENANT_JWT_TTL: '8h',
      PLATFORM_JWT_SECRET: 'p'.repeat(64),
      JWT_SECRET: 'legacy-must-not-be-used'
    })
    assert.strictEqual(config.secret, 's'.repeat(32))
    assert.strictEqual(config.algorithm, 'HS256')
    assert.ok(Object.isFrozen(config))
  })

  it('no usa JWT_SECRET ni PLATFORM_JWT_SECRET como fallback', () => {
    assert.throws(() => resolveTenantAuthConfig({
      JWT_SECRET: 'x'.repeat(64),
      PLATFORM_JWT_SECRET: 'p'.repeat(64),
      TENANT_JWT_ISSUER: 'issuer',
      TENANT_JWT_AUDIENCE: 'audience',
      TENANT_JWT_TTL: '8h'
    }), TenantAuthConfigError)
  })

  it('rechaza secreto corto', () => {
    assert.throws(() => resolveTenantAuthConfig({
      TENANT_JWT_SECRET: 'short', TENANT_JWT_ISSUER: 'issuer',
      TENANT_JWT_AUDIENCE: 'audience', TENANT_JWT_TTL: '8h'
    }), { code: 'TENANT_AUTH_SECRET_WEAK' })
  })

  it('rechaza TTL sin unidad', () => {
    assert.throws(() => resolveTenantAuthConfig({
      TENANT_JWT_SECRET: 's'.repeat(32), TENANT_JWT_ISSUER: 'issuer',
      TENANT_JWT_AUDIENCE: 'audience', TENANT_JWT_TTL: '28800'
    }), { code: 'TENANT_AUTH_TTL_INVALID' })
  })
})

describe('P0-TENANT-AUTH body', { concurrency: 1 }, () => {
  it('acepta body exacto, recorta slug y username, no recorta password', () => {
    assert.deepStrictEqual(controller.parseTenantLoginBody({
      empresaSlug: ' empresa-a ', username: ' shared.user ', password: ' x '
    }), { empresaSlug: 'empresa-a', username: 'shared.user', password: ' x ' })
  })

  it('rechaza ausencia de empresaSlug', () => {
    assert.throws(() => controller.parseTenantLoginBody({ username: 'u', password: 'p' }), {
      code: 'TENANT_LOGIN_BODY_INVALID'
    })
  })

  it('rechaza empresaId, sucursalId, rol y campos extra', () => {
    for (const extra of ['empresaId', 'sucursalId', 'rol', 'kind']) {
      assert.throws(() => controller.parseTenantLoginBody({
        empresaSlug: 'empresa-a', username: 'u', password: 'p', [extra]: 1
      }), { code: 'TENANT_LOGIN_BODY_INVALID' })
    }
  })

  it('rechaza slug no canónico', () => {
    for (const value of ['Empresa-A', 'empresa_a', '-empresa', 'empresa-', 'empresa a']) {
      assert.throws(() => controller.parseTenantLoginBody({
        empresaSlug: value, username: 'u', password: 'p'
      }), { code: 'TENANT_LOGIN_BODY_INVALID' })
    }
  })
})

describe('P0-TENANT-AUTH login', { concurrency: 1 }, () => {
  it('resuelve usuario por empresaId + username', async () => {
    let composite = null
    prisma.usuario.findUnique = async ({ where }) => {
      composite = where.empresaId_username
      return tenantUser()
    }
    const res = mockRes()
    await controller.login(loginReq(), res)
    assert.strictEqual(res._state.statusCode, 200)
    assert.deepStrictEqual(composite, { empresaId: 10, username: 'shared.user' })
  })

  it('login correcto emite claims mínimos tenant', async () => {
    const res = mockRes()
    await controller.login(loginReq(), res)
    assert.strictEqual(res._state.statusCode, 200)
    assert.strictEqual(res._state.body.expiresIn, CONFIG.ttl)
    const payload = jwt.verify(res._state.body.token, CONFIG.secret, {
      algorithms: [CONFIG.algorithm], issuer: CONFIG.issuer, audience: CONFIG.audience
    })
    assert.strictEqual(payload.version, 1)
    assert.strictEqual(payload.kind, 'TENANT')
    assert.strictEqual(payload.sub, 100)
    assert.strictEqual(payload.rol, 'ADMIN_SUCURSAL')
    for (const forbidden of ['id', 'empresaId', 'sucursalId', 'username', 'nombre', 'activo', 'passwordHash', 'pin']) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, forbidden), false, forbidden)
    }
  })

  it('respuesta conserva usuario tenant sanitizado', async () => {
    const res = mockRes()
    await controller.login(loginReq(), res)
    assert.deepStrictEqual(res._state.body.usuario, {
      id: 100,
      nombre: 'Tenant User',
      username: 'shared.user',
      rol: 'ADMIN_SUCURSAL',
      sucursalId: 20,
      empresaId: 10,
      tema: 'dark',
      Empresa: { id: 10, slug: 'empresa-a', nombreComercial: 'Empresa A', logoUrl: null, colorPrimario: '#1e3a5f', colorSecundario: '#3b82f6', colorAcento: '#10b981' },
      Sucursal: { id: 20, nombre: 'Matriz' }
    })
  })

  it('audita LOGIN con empresa y sucursal rehidratadas', async () => {
    let auditData = null
    prisma.auditoria.create = async ({ data }) => { auditData = data; return { id: 1 } }
    const res = mockRes()
    await controller.login(loginReq(), res)
    assert.strictEqual(res._state.statusCode, 200)
    assert.deepStrictEqual(auditData, {
      empresaId: 10, usuarioId: 100, sucursalId: 20,
      accion: 'LOGIN', modulo: 'auth', ip: '127.0.0.1'
    })
  })

  it('empresa inexistente o inactiva devuelve 401 genérico', async () => {
    for (const value of [null, empresa({ activa: false })]) {
      prisma.empresa.findUnique = async () => value
      const res = mockRes()
      await controller.login(loginReq(), res)
      assert.strictEqual(res._state.statusCode, 401)
      assert.deepStrictEqual(res._state.body, { error: 'Credenciales inválidas' })
    }
  })

  it('usuario inexistente, inactivo o contraseña incorrecta devuelve 401 genérico', async () => {
    for (const value of [null, tenantUser({ activo: false })]) {
      prisma.usuario.findUnique = async () => value
      const res = mockRes()
      await controller.login(loginReq(), res)
      assert.strictEqual(res._state.statusCode, 401)
    }
    prisma.usuario.findUnique = async () => tenantUser()
    const res = mockRes()
    await controller.login(loginReq({ empresaSlug: 'empresa-a', username: 'shared.user', password: 'wrong' }), res)
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('PLATFORM_ADMIN queda bloqueado en login tenant', async () => {
    prisma.usuario.findUnique = async () => tenantUser({
      rol: 'PLATFORM_ADMIN', empresaId: 10, sucursalId: null
    })
    const res = mockRes()
    await controller.login(loginReq(), res)
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('sucursal inactiva o de otra empresa queda bloqueada', async () => {
    for (const value of [sucursal({ activa: false }), sucursal({ empresaId: 99 })]) {
      prisma.sucursal.findUnique = async () => value
      const res = mockRes()
      await controller.login(loginReq(), res)
      assert.strictEqual(res._state.statusCode, 401)
    }
  })

  it('SUPERADMIN y PRECIOS sin sucursal autentican', async () => {
    for (const rol of ['SUPERADMIN', 'PRECIOS']) {
      prisma.usuario.findUnique = async () => tenantUser({ rol, sucursalId: null })
      let sucursalQueried = false
      prisma.sucursal.findUnique = async () => { sucursalQueried = true; return null }
      const res = mockRes()
      await controller.login(loginReq(), res)
      assert.strictEqual(res._state.statusCode, 200)
      assert.strictEqual(res._state.body.usuario.sucursalId, null)
      assert.strictEqual(sucursalQueried, false)
    }
  })

  it('PRECIOS con sucursal activa autentica', async () => {
    prisma.usuario.findUnique = async () => tenantUser({ rol: 'PRECIOS' })
    const res = mockRes()
    await controller.login(loginReq(), res)
    assert.strictEqual(res._state.statusCode, 200)
    assert.strictEqual(res._state.body.usuario.rol, 'PRECIOS')
  })
})

describe('P0-TENANT-AUTH middleware', { concurrency: 1 }, () => {
  it('exige Bearer estricto y mantiene token query para tickets', () => {
    assert.throws(() => middleware.extractTenantToken({ headers: {}, query: {} }), { code: 'TENANT_TOKEN_MISSING' })
    assert.throws(() => middleware.extractTenantToken({ headers: { authorization: 'bearer abc' }, query: {} }), { code: 'TENANT_TOKEN_MALFORMED' })
    assert.throws(() => middleware.extractTenantToken({ headers: { authorization: 'Bearer a b' }, query: {} }), { code: 'TENANT_TOKEN_MALFORMED' })
    assert.strictEqual(middleware.extractTenantToken({ headers: { authorization: 'Bearer abc.def' }, query: {} }), 'abc.def')
    assert.strictEqual(middleware.extractTenantToken({ headers: {}, query: { token: 'abc.def' } }), 'abc.def')
  })

  it('token válido rehidrata actor y principal desde BD', async () => {
    const req = middlewareReq(signTenant())
    const res = mockRes()
    let nextCalled = false
    await middleware.requireAuth(req, res, () => { nextCalled = true })
    assert.strictEqual(nextCalled, true)
    assert.ok(Object.isFrozen(req.usuario))
    assert.ok(Object.isFrozen(req.authPrincipal))
    assert.deepStrictEqual(req.authPrincipal, {
      version: 1, kind: 'TENANT', sub: 100, rol: 'ADMIN_SUCURSAL'
    })
    assert.deepStrictEqual(req.usuario, {
      id: 100, nombre: 'Tenant User', username: 'shared.user', rol: 'ADMIN_SUCURSAL',
      empresaId: 10, sucursalId: 20, activo: true
    })
    assert.strictEqual(req.usuarioId, 100)
  })

  it('ignora claims falsos de empresa, sucursal y perfil', async () => {
    const token = signTenant({ empresaId: 999, sucursalId: 888, username: 'forged', nombre: 'forged', activo: false })
    const req = middlewareReq(token)
    const res = mockRes()
    await middleware.requireAuth(req, res, () => {})
    assert.strictEqual(req.usuario.empresaId, 10)
    assert.strictEqual(req.usuario.sucursalId, 20)
    assert.strictEqual(req.usuario.username, 'shared.user')
  })

  it('acepta token tenant por query param', async () => {
    const req = middlewareReq(signTenant(), { query: true })
    const res = mockRes()
    let nextCalled = false
    await middleware.requireAuth(req, res, () => { nextCalled = true })
    assert.strictEqual(nextCalled, true)
  })

  it('rechaza token de plataforma, issuer, audience y algoritmo incorrectos', async () => {
    const tokens = [
      signTenant({ kind: 'PLATFORM', rol: 'PLATFORM_ADMIN' }),
      signTenant({}, { issuer: 'wrong' }),
      signTenant({}, { audience: 'wrong' }),
      signTenant({}, { algorithm: 'HS384' })
    ]
    for (const token of tokens) {
      const req = middlewareReq(token)
      const res = mockRes()
      await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
      assert.strictEqual(res._state.statusCode, 401)
    }
  })

  it('rechaza token expirado', async () => {
    const req = middlewareReq(signTenant({}, { expiresIn: -1 }))
    const res = mockRes()
    await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 401)
  })

  it('bloquea usuario eliminado o inactivo después de emitir token', async () => {
    for (const value of [null, tenantUser({ activo: false })]) {
      prisma.usuario.findUnique = async () => value
      const req = middlewareReq(signTenant())
      const res = mockRes()
      await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
      assert.strictEqual(res._state.statusCode, 403)
    }
  })

  it('bloquea cambio de rol después de emitir token', async () => {
    prisma.usuario.findUnique = async () => tenantUser({ rol: 'SUPERADMIN', sucursalId: null })
    const req = middlewareReq(signTenant())
    const res = mockRes()
    await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
    assert.strictEqual(res._state.statusCode, 403)
  })

  it('bloquea empresa inexistente o inactiva', async () => {
    for (const value of [null, empresa({ activa: false })]) {
      prisma.empresa.findUnique = async () => value
      const req = middlewareReq(signTenant())
      const res = mockRes()
      await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
      assert.strictEqual(res._state.statusCode, 403)
    }
  })

  it('bloquea sucursal inexistente, inactiva o de otra empresa', async () => {
    for (const value of [null, sucursal({ activa: false }), sucursal({ empresaId: 99 })]) {
      prisma.sucursal.findUnique = async () => value
      const req = middlewareReq(signTenant())
      const res = mockRes()
      await middleware.requireAuth(req, res, () => assert.fail('next no debe ejecutarse'))
      assert.strictEqual(res._state.statusCode, 403)
    }
  })

  it('no incluye secretos ni propiedades del JWT en el actor', async () => {
    const req = middlewareReq(signTenant({ passwordHash: 'forged', pin: '1234' }))
    const res = mockRes()
    await middleware.requireAuth(req, res, () => {})
    assert.deepStrictEqual(Object.keys(req.usuario).sort(), [
      'activo', 'empresaId', 'id', 'nombre', 'rol', 'sucursalId', 'username'
    ])
  })
})
