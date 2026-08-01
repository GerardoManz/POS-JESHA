'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after, beforeEach } = require('node:test')
const prisma = require('../src/lib/prisma')
const {
  BRANCH_MODE,
  RequestContextError,
  deepFreeze,
  isDeepFrozen,
  parseSucursalHeader,
  resolveBranchIntent,
  buildTenantRequestContext,
  assertTenantRequestContext
} = require('../src/security/request-context')
const {
  defineImmutableRequestValue,
  hydrateTenantRequestContext
} = require('../src/middlewares/request-context.middleware')
const {
  tenantGlobal,
  branchOptional,
  branchRequired
} = require('../src/middlewares/scope.middleware')
const getEmpresaId = require('../src/helpers/getEmpresaId')
const resolverSucursalId = require('../src/modules/sucursal/sucursal.helper')

const ORIGINAL = {}

function user(overrides = {}) {
  return {
    id: 7,
    nombre: 'Usuario',
    username: 'usuario',
    rol: 'SUPERADMIN',
    empresaId: 10,
    sucursalId: null,
    activo: true,
    ...overrides
  }
}

function branch(overrides = {}) {
  return { id: 20, empresaId: 10, activa: true, ...overrides }
}

function reqFor(usuario, header) {
  const headers = {}
  if (header !== undefined) headers['x-sucursal-id'] = header
  return { usuario, headers, body: {}, query: {}, params: {} }
}

function mockRes() {
  const state = { statusCode: 200, body: null }
  return {
    state,
    status(code) { state.statusCode = code; return this },
    json(body) { state.body = body; return this }
  }
}

before(() => {
  ORIGINAL.sucursalFindUnique = prisma.sucursal.findUnique
})

after(() => {
  prisma.sucursal.findUnique = ORIGINAL.sucursalFindUnique
})

beforeEach(() => {
  prisma.sucursal.findUnique = async ({ where }) => where.id === 20 ? branch() : null
})

describe('P0-REQUEST-CONTEXT: deepFreeze', { concurrency: 1 }, () => {
  it('congela objeto y anidados', () => {
    const value = deepFreeze({ a: { b: [1, { c: true }] } })
    assert.ok(Object.isFrozen(value))
    assert.ok(Object.isFrozen(value.a))
    assert.ok(Object.isFrozen(value.a.b))
    assert.ok(Object.isFrozen(value.a.b[1]))
  })

  it('congela hijos aunque el contenedor ya estuviera congelado superficialmente', () => {
    const child = { value: 1 }
    const parent = Object.freeze({ child })
    deepFreeze(parent)
    assert.ok(Object.isFrozen(child))
    assert.ok(isDeepFrozen(parent))
  })

  it('tolera null y primitivos', () => {
    assert.strictEqual(deepFreeze(null), null)
    assert.strictEqual(deepFreeze(3), 3)
    assert.strictEqual(isDeepFrozen(null), true)
  })
})

describe('P0-REQUEST-CONTEXT: header', { concurrency: 1 }, () => {
  it('ausente produce null', () => {
    assert.strictEqual(parseSucursalHeader({}), null)
  })

  it('acepta entero positivo canónico', () => {
    assert.strictEqual(parseSucursalHeader({ 'x-sucursal-id': '20' }), 20)
  })

  it('recorta espacios externos', () => {
    assert.strictEqual(parseSucursalHeader({ 'x-sucursal-id': ' 20 ' }), 20)
  })

  it('rechaza cero, negativos, decimales y texto', () => {
    for (const value of ['0', '-1', '1.5', 'abc', '', '01', '1e2', '2147483648', '9007199254740992']) {
      assert.throws(
        () => parseSucursalHeader({ 'x-sucursal-id': value }),
        (err) => err instanceof RequestContextError && err.code === 'REQUEST_CONTEXT_BRANCH_HEADER_INVALID'
      )
    }
  })

  it('rechaza header repetido como array', () => {
    assert.throws(() => parseSucursalHeader({ 'x-sucursal-id': ['20', '21'] }), RequestContextError)
  })
})

describe('P0-REQUEST-CONTEXT: intención por rol', { concurrency: 1 }, () => {
  it('SUPERADMIN sin header queda NONE', () => {
    const intent = resolveBranchIntent(user(), null)
    assert.strictEqual(intent.mode, BRANCH_MODE.NONE)
    assert.strictEqual(intent.sucursalId, null)
  })

  it('SUPERADMIN con header queda SELECTED', () => {
    const intent = resolveBranchIntent(user(), 20)
    assert.strictEqual(intent.mode, BRANCH_MODE.SELECTED)
    assert.strictEqual(intent.sucursalId, 20)
  })

  it('ADMIN_SUCURSAL sin header usa FIXED', () => {
    const intent = resolveBranchIntent(user({ rol: 'ADMIN_SUCURSAL', sucursalId: 20 }), null)
    assert.strictEqual(intent.mode, BRANCH_MODE.FIXED)
    assert.strictEqual(intent.sucursalId, 20)
  })

  it('EMPLEADO con header igual conserva FIXED', () => {
    const intent = resolveBranchIntent(user({ rol: 'EMPLEADO', sucursalId: 20 }), 20)
    assert.strictEqual(intent.mode, BRANCH_MODE.FIXED)
  })

  it('usuario fijo no puede cambiar sucursal', () => {
    assert.throws(
      () => resolveBranchIntent(user({ rol: 'ADMIN_SUCURSAL', sucursalId: 20 }), 21),
      (err) => err.code === 'REQUEST_CONTEXT_BRANCH_FORBIDDEN' && err.status === 403
    )
  })

  it('PRECIOS global sin header queda NONE', () => {
    const intent = resolveBranchIntent(user({ rol: 'PRECIOS' }), null)
    assert.strictEqual(intent.mode, BRANCH_MODE.NONE)
  })

  it('PRECIOS global puede seleccionar sucursal', () => {
    const intent = resolveBranchIntent(user({ rol: 'PRECIOS' }), 20)
    assert.strictEqual(intent.mode, BRANCH_MODE.SELECTED)
  })

  it('PRECIOS ligado a sucursal queda FIXED', () => {
    const intent = resolveBranchIntent(user({ rol: 'PRECIOS', sucursalId: 20 }), null)
    assert.strictEqual(intent.mode, BRANCH_MODE.FIXED)
  })

  it('rechaza sucursal solicitada fuera del rango PostgreSQL Int', () => {
    assert.throws(
      () => resolveBranchIntent(user(), 2147483648),
      (err) => err.code === 'REQUEST_CONTEXT_BRANCH_ID_INVALID' && err.status === 400
    )
  })

  it('rechaza identidad no tenant válida', () => {
    assert.throws(
      () => resolveBranchIntent(user({ rol: 'PLATFORM_ADMIN', empresaId: null }), null),
      RequestContextError
    )
  })
})

describe('P0-REQUEST-CONTEXT: construcción', { concurrency: 1 }, () => {
  it('shape exacto global', () => {
    const context = buildTenantRequestContext({ usuario: user() })
    assert.deepStrictEqual(context, {
      version: 1,
      kind: 'TENANT',
      actor: { id: 7, rol: 'SUPERADMIN' },
      tenant: { empresaId: 10 },
      branch: { mode: 'NONE', sucursalId: null }
    })
  })

  it('shape exacto seleccionado', () => {
    const context = buildTenantRequestContext({
      usuario: user(), requestedSucursalId: 20, sucursal: branch()
    })
    assert.deepStrictEqual(context.branch, { mode: 'SELECTED', sucursalId: 20 })
  })

  it('contexto completo está profundamente congelado', () => {
    const context = buildTenantRequestContext({
      usuario: user(), requestedSucursalId: 20, sucursal: branch()
    })
    assert.ok(Object.isFrozen(context))
    assert.ok(Object.isFrozen(context.actor))
    assert.ok(Object.isFrozen(context.tenant))
    assert.ok(Object.isFrozen(context.branch))
  })

  it('no incluye perfil ni secretos', () => {
    const context = buildTenantRequestContext({ usuario: user({ passwordHash: 'secret', pin: '1234' }) })
    assert.deepStrictEqual(Object.keys(context).sort(), ['actor', 'branch', 'kind', 'tenant', 'version'])
    assert.strictEqual(context.passwordHash, undefined)
    assert.strictEqual(context.pin, undefined)
    assert.strictEqual(context.actor.username, undefined)
  })

  it('rechaza sucursal de otra empresa', () => {
    assert.throws(() => buildTenantRequestContext({
      usuario: user(), requestedSucursalId: 20, sucursal: branch({ empresaId: 99 })
    }), { code: 'REQUEST_CONTEXT_BRANCH_UNAVAILABLE' })
  })

  it('rechaza sucursal inactiva', () => {
    assert.throws(() => buildTenantRequestContext({
      usuario: user(), requestedSucursalId: 20, sucursal: branch({ activa: false })
    }), { code: 'REQUEST_CONTEXT_BRANCH_UNAVAILABLE' })
  })

  it('rechaza sucursal con id distinto', () => {
    assert.throws(() => buildTenantRequestContext({
      usuario: user(), requestedSucursalId: 20, sucursal: branch({ id: 21 })
    }), { code: 'REQUEST_CONTEXT_BRANCH_UNAVAILABLE' })
  })
})

describe('P0-REQUEST-CONTEXT: hidratación middleware', { concurrency: 1 }, () => {
  it('SUPERADMIN sin header no consulta sucursal', async () => {
    let calls = 0
    prisma.sucursal.findUnique = async () => { calls++; return branch() }
    const req = reqFor(user())
    const context = await hydrateTenantRequestContext(req)
    assert.strictEqual(calls, 0)
    assert.strictEqual(context.branch.mode, 'NONE')
  })

  it('SUPERADMIN con header consulta y valida sucursal', async () => {
    let whereSeen = null
    prisma.sucursal.findUnique = async ({ where }) => { whereSeen = where; return branch() }
    const req = reqFor(user(), '20')
    const context = await hydrateTenantRequestContext(req)
    assert.deepStrictEqual(whereSeen, { id: 20 })
    assert.strictEqual(context.branch.sucursalId, 20)
  })

  it('ADMIN_SUCURSAL sin header hidrata su sucursal fija', async () => {
    const req = reqFor(user({ rol: 'ADMIN_SUCURSAL', sucursalId: 20 }))
    const context = await hydrateTenantRequestContext(req)
    assert.strictEqual(context.branch.mode, 'FIXED')
    assert.strictEqual(context.branch.sucursalId, 20)
  })

  it('context se define como propiedad no reemplazable', async () => {
    const req = reqFor(user(), '20')
    await hydrateTenantRequestContext(req)
    const descriptor = Object.getOwnPropertyDescriptor(req, 'context')
    assert.strictEqual(descriptor.writable, false)
    assert.strictEqual(descriptor.configurable, false)
    assert.throws(() => { req.context = {} }, TypeError)
  })

  it('segunda hidratación reutiliza exclusivamente un contexto válido del mismo request', async () => {
    let calls = 0
    prisma.sucursal.findUnique = async () => { calls++; return branch() }
    const req = reqFor(user(), '20')
    const first = await hydrateTenantRequestContext(req)
    const second = await hydrateTenantRequestContext(req)
    assert.strictEqual(first, second)
    assert.strictEqual(calls, 1)
  })

  it('rechaza un contexto previo mutable o con branch distinto', async () => {
    const req = reqFor(user(), '20')
    req.context = {
      version: 1, kind: 'TENANT',
      actor: { id: 7, rol: 'SUPERADMIN' },
      tenant: { empresaId: 10 },
      branch: { mode: 'SELECTED', sucursalId: 21 }
    }
    await assert.rejects(
      () => hydrateTenantRequestContext(req),
      { code: 'REQUEST_CONTEXT_REHYDRATION_MISMATCH', status: 500 }
    )
  })

  it('sucursal inexistente bloquea', async () => {
    prisma.sucursal.findUnique = async () => null
    await assert.rejects(
      () => hydrateTenantRequestContext(reqFor(user(), '20')),
      { code: 'REQUEST_CONTEXT_BRANCH_UNAVAILABLE', status: 403 }
    )
  })
})

describe('P0-REQUEST-CONTEXT: helpers autoritativos', { concurrency: 1 }, () => {
  it('getEmpresaId toma exclusivamente req.context', () => {
    const context = buildTenantRequestContext({ usuario: user() })
    const req = { context, usuario: { empresaId: 999 }, body: { empresaId: 888 } }
    assert.strictEqual(getEmpresaId(req), 10)
  })

  it('getEmpresaId falla sin contexto', () => {
    assert.throws(() => getEmpresaId({ usuario: user() }), { code: 'REQUEST_CONTEXT_MISSING' })
  })

  it('resolverSucursalId usa exclusivamente req.context', () => {
    const context = buildTenantRequestContext({ usuario: user(), requestedSucursalId: 20, sucursal: branch() })
    assert.strictEqual(resolverSucursalId({ context, body: { sucursalId: 999 } }), 20)
  })

  it('resolverSucursalId permite null en contexto global', () => {
    const context = buildTenantRequestContext({ usuario: user() })
    assert.strictEqual(resolverSucursalId({ context }), null)
  })

  it('defineImmutableRequestValue no reemplaza valor existente', () => {
    const req = {}
    const first = defineImmutableRequestValue(req, 'context', { a: 1 })
    const second = defineImmutableRequestValue(req, 'context', { a: 2 })
    assert.strictEqual(first, second)
    assert.deepStrictEqual(req.context, { a: 1 })
  })
})

describe('P0-SCOPE-MIDDLEWARE: declaración de alcance', { concurrency: 1 }, () => {
  function execute(middleware, context) {
    const req = { context }
    const res = mockRes()
    let nextCalls = 0
    let nextError = null
    middleware(req, res, (err) => { nextCalls++; nextError = err || null })
    return { res, nextCalls, nextError }
  }

  it('tenantGlobal acepta contexto tenant válido', () => {
    const result = execute(tenantGlobal, buildTenantRequestContext({ usuario: user() }))
    assert.strictEqual(result.nextCalls, 1)
  })

  it('branchOptional acepta NONE', () => {
    const result = execute(branchOptional, buildTenantRequestContext({ usuario: user() }))
    assert.strictEqual(result.nextCalls, 1)
  })

  it('branchRequired rechaza NONE con 400', () => {
    const result = execute(branchRequired, buildTenantRequestContext({ usuario: user() }))
    assert.strictEqual(result.nextCalls, 0)
    assert.strictEqual(result.res.state.statusCode, 400)
    assert.strictEqual(result.res.state.body.code, 'BRANCH_CONTEXT_REQUIRED')
  })

  it('branchRequired acepta FIXED', () => {
    const context = buildTenantRequestContext({
      usuario: user({ rol: 'ADMIN_SUCURSAL', sucursalId: 20 }),
      sucursal: branch()
    })
    assert.strictEqual(execute(branchRequired, context).nextCalls, 1)
  })

  it('branchRequired acepta SELECTED', () => {
    const context = buildTenantRequestContext({
      usuario: user(), requestedSucursalId: 20, sucursal: branch()
    })
    assert.strictEqual(execute(branchRequired, context).nextCalls, 1)
  })

  it('todos delegan los errores internos de contexto ausente al error handler', () => {
    for (const middleware of [tenantGlobal, branchOptional, branchRequired]) {
      const result = execute(middleware, undefined)
      assert.strictEqual(result.nextCalls, 1)
      assert.ok(result.nextError instanceof RequestContextError)
      assert.strictEqual(result.nextError.status, 500)
      assert.strictEqual(result.res.state.body, null)
    }
  })

  it('assertTenantRequestContext rechaza combinaciones rol/branch imposibles', () => {
    assert.throws(() => assertTenantRequestContext({
      version: 1, kind: 'TENANT',
      actor: { id: 7, rol: 'ADMIN_SUCURSAL' },
      tenant: { empresaId: 10 },
      branch: { mode: 'NONE', sucursalId: null }
    }), { code: 'REQUEST_CONTEXT_INVALID' })
  })
})
