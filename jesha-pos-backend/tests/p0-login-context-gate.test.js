'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after, mock } = require('node:test')

process.env.TENANT_JWT_SECRET = process.env.TENANT_JWT_SECRET || 'a'.repeat(32)
process.env.TENANT_JWT_ISSUER = process.env.TENANT_JWT_ISSUER || 'test-issuer'
process.env.TENANT_JWT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE || 'test-audience'
process.env.TENANT_JWT_TTL = process.env.TENANT_JWT_TTL || '15m'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test'

const REQUEST_CONTEXT_VERSION = 1
const BRANCH_MODE = Object.freeze({ NONE: 'NONE', FIXED: 'FIXED', SELECTED: 'SELECTED' })

function deepMerge(a, b) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = { ...out[k], ...v }
    } else {
      out[k] = v
    }
  }
  return out
}

function buildContext(overrides = {}) {
  const defaults = {
    version: REQUEST_CONTEXT_VERSION,
    kind: 'TENANT',
    actor: { id: 1, rol: 'SUPERADMIN' },
    tenant: { empresaId: 10 },
    branch: { mode: BRANCH_MODE.NONE, sucursalId: null }
  }
  return deepMerge(defaults, overrides)
}

function mockSucursalModel(prisma, stubs) {
  const model = {}
  if (stubs.findMany) model.findMany = stubs.findMany
  if (stubs.findUnique) model.findUnique = stubs.findUnique
  prisma.sucursal = model
}

function mkRes() {
  let _data, _status = 200
  return {
    json: (d) => { _data = d },
    status: (s) => { _status = s; return { json: (d) => { _data = d; _status = s } } },
    get data() { return _data },
    get statusCode() { return _status }
  }
}

describe('P0-LOGIN-CONTEXT-GATE (unit)', () => {
  let prisma, sucursalCtrl, authCtrl

  before(() => {
    prisma = require('../src/lib/prisma')
    sucursalCtrl = require('../src/modules/sucursal/sucursal.controller')
    authCtrl = require('../src/modules/auth/auth.controller')
  })

  after(() => {
    mock.restoreAll()
  })

  describe('listarDisponibles', () => {
    it('modo NONE: devuelve todas las sucursales activas', async () => {
      mockSucursalModel(prisma, {
        findMany: async () => [
          { id: 1, nombre: 'Matriz', activa: true },
          { id: 2, nombre: 'Sucursal 2', activa: true }
        ]
      })
      const res = mkRes()
      await sucursalCtrl.listarDisponibles({ context: buildContext() }, res)
      assert.ok(res.data)
      assert.strictEqual(res.data.sucursales.length, 2)
    })

    it('modo FIXED: devuelve solo la sucursal fija', async () => {
      mockSucursalModel(prisma, {
        findUnique: async ({ where }) => {
          assert.strictEqual(where.id, 5)
          return { id: 5, nombre: 'Matriz', activa: true }
        }
      })
      const res = mkRes()
      await sucursalCtrl.listarDisponibles({
        context: buildContext({ actor: { id: 2, rol: 'ADMIN_SUCURSAL' }, branch: { mode: BRANCH_MODE.FIXED, sucursalId: 5 } })
      }, res)
      assert.strictEqual(res.data.sucursales.length, 1)
      assert.strictEqual(res.data.sucursales[0].id, 5)
    })

    it('modo FIXED con sucursal inactiva: devuelve lista vacia', async () => {
      mockSucursalModel(prisma, {
        findUnique: async () => ({ id: 99, nombre: 'Inactiva', activa: false })
      })
      const res = mkRes()
      await sucursalCtrl.listarDisponibles({
        context: buildContext({ actor: { id: 3, rol: 'ADMIN_SUCURSAL' }, branch: { mode: BRANCH_MODE.FIXED, sucursalId: 99 } })
      }, res)
      assert.strictEqual(res.data.sucursales.length, 0)
    })

    it('modo SELECTED: devuelve todas sucursales activas', async () => {
      mockSucursalModel(prisma, {
        findMany: async () => [
          { id: 1, nombre: 'Matriz', activa: true },
          { id: 2, nombre: 'Sucursal 2', activa: true }
        ]
      })
      const res = mkRes()
      await sucursalCtrl.listarDisponibles({
        context: buildContext({ branch: { mode: BRANCH_MODE.SELECTED, sucursalId: 5 } })
      }, res)
      assert.strictEqual(res.data.sucursales.length, 2)
    })
  })

  describe('obtenerContexto', () => {
    it('devuelve contexto sanitizado con NONE', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({ context: buildContext() }, res)
      assert.ok(res.data)
      assert.strictEqual(res.data.version, REQUEST_CONTEXT_VERSION)
      assert.strictEqual(res.data.kind, 'TENANT')
      assert.strictEqual(res.data.actor.id, 1)
      assert.strictEqual(res.data.actor.rol, 'SUPERADMIN')
      assert.strictEqual(res.data.tenant.empresaId, 10)
      assert.strictEqual(res.data.branch.mode, BRANCH_MODE.NONE)
      assert.strictEqual(res.data.branch.sucursalId, null)
    })

    it('devuelve contexto FIXED sanitizado', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({
        context: buildContext({ actor: { id: 2, rol: 'ADMIN_SUCURSAL' }, branch: { mode: BRANCH_MODE.FIXED, sucursalId: 5 } })
      }, res)
      assert.strictEqual(res.data.branch.mode, BRANCH_MODE.FIXED)
      assert.strictEqual(res.data.branch.sucursalId, 5)
    })

    it('devuelve contexto SELECTED sanitizado', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({
        context: buildContext({ actor: { id: 2, rol: 'SUPERADMIN' }, branch: { mode: BRANCH_MODE.SELECTED, sucursalId: 8 } })
      }, res)
      assert.strictEqual(res.data.branch.mode, BRANCH_MODE.SELECTED)
      assert.strictEqual(res.data.branch.sucursalId, 8)
    })

    it('sin contexto: responde 500', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({ context: null }, res)
      assert.strictEqual(res.statusCode, 500)
      assert.strictEqual(res.data.error, 'Contexto no disponible')
    })

    it('no expone secretos extra del actor', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({
        context: buildContext({ actor: { id: 1, rol: 'SUPERADMIN', extraSecret: 'leaked' } })
      }, res)
      assert.strictEqual(res.data.actor.extraSecret, undefined)
    })

    it('no expone secretos extra del tenant', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({
        context: buildContext({ tenant: { empresaId: 10, secretKey: 'leaked' } })
      }, res)
      assert.strictEqual(res.data.tenant.secretKey, undefined)
    })

    it('no devuelve tenant.slug', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({
        context: buildContext({ tenant: { empresaId: 10, slug: 'empresa-a', nombreComercial: 'Empresa A' } })
      }, res)
      assert.strictEqual(res.data.tenant.slug, undefined)
    })

    it('no devuelve tenant.nombre', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({ context: buildContext() }, res)
      assert.strictEqual(res.data.tenant.nombre, undefined)
    })

    it('no devuelve branch.nombre', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({ context: buildContext() }, res)
      assert.strictEqual(res.data.branch.nombre, undefined)
    })

    it('solo devuelve campos autorizados', () => {
      const res = mkRes()
      authCtrl.obtenerContexto({ context: buildContext() }, res)
      const keys = Object.keys(res.data).sort()
      assert.deepStrictEqual(keys, ['actor', 'branch', 'kind', 'tenant', 'version'])
      assert.deepStrictEqual(Object.keys(res.data.actor).sort(), ['id', 'rol'])
      assert.deepStrictEqual(Object.keys(res.data.tenant).sort(), ['empresaId'])
      assert.deepStrictEqual(Object.keys(res.data.branch).sort(), ['mode', 'sucursalId'])
    })
  })

  describe('parseTenantLoginBody', () => {
    it('acepta solo empresaSlug, username, password', () => {
      const body = authCtrl.parseTenantLoginBody({
        empresaSlug: 'empresa-a',
        username: 'admin',
        password: 'secret'
      })
      assert.strictEqual(body.empresaSlug, 'empresa-a')
      assert.strictEqual(body.username, 'admin')
      assert.strictEqual(typeof body.password, 'string')
    })

    it('rechaza slug en mayusculas con espacios', () => {
      assert.throws(() => {
        authCtrl.parseTenantLoginBody({
          empresaSlug: 'EMPRESA A',
          username: 'admin',
          password: 'secret'
        })
      }, /empresaSlug inválido/)
    })

    it('rechaza body con campos extra', () => {
      assert.throws(() => {
        authCtrl.parseTenantLoginBody({
          empresaSlug: 'empresa-a',
          username: 'admin',
          password: 'secret',
          extra: true
        })
      }, /Body debe contener solo/)
    })

    it('rechaza body vacio', () => {
      assert.throws(() => {
        authCtrl.parseTenantLoginBody({})
      }, /Body debe contener solo/)
    })
  })
})
