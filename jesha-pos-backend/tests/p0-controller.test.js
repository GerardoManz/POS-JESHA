'use strict'
const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const bcrypt = require('bcryptjs')

const prisma = require('../src/lib/prisma')
const controller = require('../src/modules/usuarios/usuarios.controller')
const { normalizarIdPositivo } = require('../src/utils/usuario-policy')
const policy = require('../src/utils/usuario-policy')
const roles = require('../src/utils/roles')

function mockRes() {
  const state = { statusCode: 200, body: null }
  return {
    _state: state,
    status: function (code) { state.statusCode = code; return this },
    json: function (data) { state.body = data; return this },
    end: function () {}
  }
}

const ORIGINAL_METHODS = {}

before(() => {
  ORIGINAL_METHODS.findUnique = prisma.usuario.findUnique
  ORIGINAL_METHODS.findMany = prisma.usuario.findMany
  ORIGINAL_METHODS.update = prisma.usuario.update
  ORIGINAL_METHODS.create = prisma.usuario.create
  ORIGINAL_METHODS.findFirst = prisma.sucursal.findFirst
  ORIGINAL_METHODS.empresaFindUnique = prisma.empresa.findUnique
  ORIGINAL_METHODS.transaction = prisma.$transaction
})

after(() => {
  prisma.usuario.findUnique = ORIGINAL_METHODS.findUnique
  prisma.usuario.findMany = ORIGINAL_METHODS.findMany
  prisma.usuario.update = ORIGINAL_METHODS.update
  prisma.usuario.create = ORIGINAL_METHODS.create
  prisma.sucursal.findFirst = ORIGINAL_METHODS.findFirst
  prisma.empresa.findUnique = ORIGINAL_METHODS.empresaFindUnique
  prisma.$transaction = ORIGINAL_METHODS.transaction
})

let mockQueryRawCallCount = 0

function mockTXCrear() {
  mockQueryRawCallCount = 0
  prisma.$transaction = async (fn) => fn({
    $queryRaw: async (strings) => {
      mockQueryRawCallCount++
      const sql = strings.join(' ')
      if (sql.includes('Empresa')) return [{ id: 1, activa: true }]
      if (sql.includes('Usuario')) {
        if (mockQueryRawCallCount === 1) return [{ id: 1, rol: 'SUPERADMIN', activo: true, empresaId: 1 }]
        return [{ id: 2, rol: 'EMPLEADO', activo: true, empresaId: 1, sucursalId: 1, nombre: 'Obj', username: 'obj' }]
      }
      return []
    },
    usuario: {
      findUnique: async (args) => {
        if (args.where && args.where.id) {
          return { id: args.where.id, nombre: 'Obj', username: 'obj', rol: 'EMPLEADO', activo: true, tienePin: false, Sucursal: null }
        }
        return null
      },
      create: async (data) => data.data,
      updateMany: async () => ({ count: 1 }),
      findFirst: async () => null
    },
    sucursal: {
      findFirst: async (args) => {
        if (args.where.id === 1 && args.where.empresaId === 1) {
          return { id: 1, empresaId: 1, activa: true }
        }
        return null
      }
    }
  })
}

function mockPrevalidarActor() {
  prisma.usuario.findUnique = async () => ({ id: 1, activo: true, rol: 'SUPERADMIN', empresaId: 1 })
  prisma.empresa.findUnique = async () => ({ id: 1, activa: true })
}

function reqCrear(extra) {
  return {
    usuario: { id: 1, nombre: 'Admin' },
    ip: '127.0.0.1',
    body: { nombre: 'Test', username: 't', password: 'pass1234', confirmarPassword: 'pass1234', rol: 'EMPLEADO', ...extra }
  }
}

function reqEditar(extra) {
  return {
    usuario: { id: 1, nombre: 'Admin' },
    params: { id: '2' },
    ip: '127.0.0.1',
    body: { ...extra }
  }
}

describe('crear - sucursalId en body JSON (controller real)', () => {
  it('string numérica "1" → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    const res = mockRes()
    await controller.crear(reqCrear({ sucursalId: '1' }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('string vacía "" → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    const res = mockRes()
    await controller.crear(reqCrear({ sucursalId: '' }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('undefined explícito → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    const req = reqCrear({})
    req.body.sucursalId = undefined
    const res = mockRes()
    await controller.crear(req, res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('null para PRECIOS → permitido', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.crear(reqCrear({ rol: 'PRECIOS', sucursalId: null }), res)
    assert.strictEqual(res._state.statusCode, 201)
  })

  it('ausente para PRECIOS → permitido', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    const req = reqCrear({ rol: 'PRECIOS' })
    delete req.body.sucursalId
    assert.strictEqual(Object.prototype.hasOwnProperty.call(req.body, 'sucursalId'), false, 'sucursalId no debe existir en body')
    await controller.crear(req, res)
    assert.strictEqual(res._state.statusCode, 201, `Esperado 201, recibido ${res._state.statusCode}: ${JSON.stringify(res._state.body)}`)
  })

  it('null para ADMIN_SUCURSAL → SUCURSAL_REQUERIDA', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.crear(reqCrear({ rol: 'ADMIN_SUCURSAL', sucursalId: null }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.ok(res._state.body.error.includes('requiere'))
  })

  it('number entero positivo 1 → avanza a validación tenant-safe', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.crear(reqCrear({ sucursalId: 1 }), res)
    assert.strictEqual(res._state.statusCode, 201)
  })

  it('array [] → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    const res = mockRes()
    await controller.crear(reqCrear({ sucursalId: [] }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('objeto {} → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    const res = mockRes()
    await controller.crear(reqCrear({ sucursalId: {} }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('boolean true → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    const res = mockRes()
    await controller.crear(reqCrear({ sucursalId: true }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })
})

describe('editar - sucursalId en body JSON (controller real)', () => {
  it('string numérica "1" → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.editar(reqEditar({ sucursalId: '1' }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('string vacía "" → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.editar(reqEditar({ sucursalId: '' }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('undefined explícito → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const req = reqEditar({})
    req.body.sucursalId = undefined
    const res = mockRes()
    await controller.editar(req, res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('ausente → conserva sucursal actual', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.editar(reqEditar({ nombre: 'NuevoNombre' }), res)
    assert.strictEqual(res._state.statusCode, 200)
  })

  it('null para PRECIOS → permitido', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.editar(reqEditar({ rol: 'PRECIOS', sucursalId: null }), res)
    assert.strictEqual(res._state.statusCode, 200)
  })

  it('null para ADMIN_SUCURSAL → SUCURSAL_REQUERIDA', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    // need rol in body to trigger rol change validation
    await controller.editar(reqEditar({ rol: 'ADMIN_SUCURSAL', sucursalId: null }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.ok(res._state.body.error.includes('requiere'))
  })

  it('number entero positivo 1 → avanza correctamente', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.editar(reqEditar({ sucursalId: 1 }), res)
    assert.strictEqual(res._state.statusCode, 200)
  })

  it('array [] → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.editar(reqEditar({ sucursalId: [] }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('objeto {} → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.editar(reqEditar({ sucursalId: {} }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })

  it('boolean false → 400 SUCURSAL_INVALIDA', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.editar(reqEditar({ sucursalId: false }), res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'Sucursal inválida')
  })
})

describe('empresaId en body JSON (controller real)', () => {
  it('crear con empresaId → EMPRESA_NO_MODIFICABLE (400)', async () => {
    const res = mockRes()
    await controller.crear({ usuario: { id: 1 }, ip: '127.0.0.1', body: { nombre: 'A', username: 'b', password: 'pass1234', confirmarPassword: 'pass1234', rol: 'EMPLEADO', empresaId: 1 } }, res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'No puedes modificar la empresa del usuario')
  })

  it('crear con empresaId null → EMPRESA_NO_MODIFICABLE (400)', async () => {
    const res = mockRes()
    await controller.crear({ usuario: { id: 1 }, ip: '127.0.0.1', body: { nombre: 'A', username: 'b', password: 'pass1234', confirmarPassword: 'pass1234', rol: 'EMPLEADO', empresaId: null } }, res)
    assert.strictEqual(res._state.statusCode, 400)
    assert.strictEqual(res._state.body.error, 'No puedes modificar la empresa del usuario')
  })

  it('crear sin empresaId → pasa validación (rol PRECIOS sin sucursal)', async () => {
    mockPrevalidarActor()
    mockTXCrear()
    const res = mockRes()
    await controller.crear({ usuario: { id: 1 }, ip: '127.0.0.1', body: { nombre: 'A', username: 'b', password: 'pass1234', confirmarPassword: 'pass1234', rol: 'PRECIOS' } }, res)
    assert.strictEqual(res._state.statusCode, 201)
  })
})

describe('mapearErrorController', () => {
  function mapearErrorController(err, res) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'El nombre de usuario ya existe en esta empresa' })
    }
    if (err.code === 'P2034') {
      return res.status(409).json({ error: 'Conflicto de concurrencia. Intenta de nuevo.' })
    }
    if (err.name === 'UserPolicyError') {
      if (err.code === 'USUARIO_NO_ENCONTRADO') {
        return res.status(404).json({ error: 'Usuario no encontrado' })
      }
      const status = err.code === 'ACTOR_NO_AUTORIZADO' || err.code === 'ACTOR_SIN_EMPRESA' || err.code === 'EMPRESA_INACTIVA' || err.code === 'USUARIO_PROTEGIDO' ? 403 : 400
      return res.status(status).json({ error: err.message })
    }
    return res.status(500).json({ error: 'Error interno del servidor' })
  }

  it('P2002 → 409 username duplicado', () => {
    const res = mockRes()
    const err = new Error('unique')
    err.code = 'P2002'
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 409)
    assert.ok(res._state.body.error.includes('usuario'))
  })

  it('P2034 → 409 concurrencia', () => {
    const res = mockRes()
    const err = new Error('serialization')
    err.code = 'P2034'
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 409)
    assert.ok(res._state.body.error.includes('concurrencia'))
  })

  it('P1000 → 500', () => {
    const res = mockRes()
    const err = new Error('auth fail')
    err.code = 'P1000'
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 500)
  })

  it('ACTOR_NO_AUTORIZADO → 403', () => {
    const res = mockRes()
    const err = new Error('No autorizado')
    err.name = 'UserPolicyError'
    err.code = 'ACTOR_NO_AUTORIZADO'
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 403)
  })

  it('USUARIO_PROTEGIDO → 403', () => {
    const res = mockRes()
    const err = new Error('protegido')
    err.name = 'UserPolicyError'
    err.code = 'USUARIO_PROTEGIDO'
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 403)
  })

  it('USUARIO_NO_ENCONTRADO → 404', () => {
    const res = mockRes()
    const err = new Error('no encontrado')
    err.name = 'UserPolicyError'
    err.code = 'USUARIO_NO_ENCONTRADO'
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 404)
    assert.ok(res._state.body.error.includes('no encontrado'))
  })

  it('SUCURSAL_INVALIDA → 400', () => {
    const res = mockRes()
    const err = new Error('invalida')
    err.name = 'UserPolicyError'
    err.code = 'SUCURSAL_INVALIDA'
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 400)
  })

  it('EMPRESA_NO_MODIFICABLE → 400', () => {
    const res = mockRes()
    const err = new Error('no modificable')
    err.name = 'UserPolicyError'
    err.code = 'EMPRESA_NO_MODIFICABLE'
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 400)
  })

  it('error genérico → 500', () => {
    const res = mockRes()
    const err = new Error('algo salio mal')
    mapearErrorController(err, res)
    assert.strictEqual(res._state.statusCode, 500)
  })
})

describe('roles.js', () => {
  it('ADMIN_SUCURSAL está en ROLES_REQUIEREN_SUCURSAL', () => {
    assert.ok(roles.ROLES_REQUIEREN_SUCURSAL.has('ADMIN_SUCURSAL'))
  })

  it('EMPLEADO está en ROLES_REQUIEREN_SUCURSAL', () => {
    assert.ok(roles.ROLES_REQUIEREN_SUCURSAL.has('EMPLEADO'))
  })

  it('PRECIOS NO está en ROLES_REQUIEREN_SUCURSAL', () => {
    assert.ok(!roles.ROLES_REQUIEREN_SUCURSAL.has('PRECIOS'))
  })

  it('SUPERADMIN NO está en ROLES_ASIGNABLES_POR_SUPERADMIN', () => {
    assert.ok(!roles.ROLES_ASIGNABLES_POR_SUPERADMIN.has('SUPERADMIN'))
  })

  it('PLATFORM_ADMIN NO está en ROLES_ASIGNABLES_POR_SUPERADMIN', () => {
    assert.ok(!roles.ROLES_ASIGNABLES_POR_SUPERADMIN.has('PLATFORM_ADMIN'))
  })

  it('ADMIN_SUCURSAL está en ROLES_ASIGNABLES_POR_SUPERADMIN', () => {
    assert.ok(roles.ROLES_ASIGNABLES_POR_SUPERADMIN.has('ADMIN_SUCURSAL'))
  })

  it('EMPLEADO está en ROLES_ASIGNABLES_POR_SUPERADMIN', () => {
    assert.ok(roles.ROLES_ASIGNABLES_POR_SUPERADMIN.has('EMPLEADO'))
  })

  it('PRECIOS está en ROLES_ASIGNABLES_POR_SUPERADMIN', () => {
    assert.ok(roles.ROLES_ASIGNABLES_POR_SUPERADMIN.has('PRECIOS'))
  })
})

describe('prevalidarActor (mocked prisma)', () => {
  async function prevalidarActor(actorUsuarioId) {
    const actor = await prisma.usuario.findUnique({
      where: { id: actorUsuarioId },
      select: { id: true, activo: true, rol: true, empresaId: true }
    })
    if (!actor || !actor.activo) throw Object.assign(new Error('No autorizado'), { name: 'UserPolicyError', code: 'ACTOR_NO_AUTORIZADO' })
    if (actor.rol !== 'SUPERADMIN') throw Object.assign(new Error('No autorizado'), { name: 'UserPolicyError', code: 'ACTOR_NO_AUTORIZADO' })
    if (!actor.empresaId || !Number.isSafeInteger(Number(actor.empresaId)) || Number(actor.empresaId) <= 0) {
      throw Object.assign(new Error('No autorizado'), { name: 'UserPolicyError', code: 'ACTOR_SIN_EMPRESA' })
    }
    const empresa = await prisma.empresa.findUnique({
      where: { id: Number(actor.empresaId) },
      select: { id: true, activa: true }
    })
    if (!empresa || !empresa.activa) throw Object.assign(new Error('Operación no disponible'), { name: 'UserPolicyError', code: 'EMPRESA_INACTIVA' })
  }

  it('actor válido → ok', async () => {
    prisma.usuario.findUnique = async () => ({ id: 1, activo: true, rol: 'SUPERADMIN', empresaId: 1 })
    prisma.empresa.findUnique = async () => ({ id: 1, activa: true })
    await assert.doesNotReject(() => prevalidarActor(1))
  })

  it('actor no existe → ACTOR_NO_AUTORIZADO', async () => {
    prisma.usuario.findUnique = async () => null
    await assert.rejects(() => prevalidarActor(999), { code: 'ACTOR_NO_AUTORIZADO' })
  })

  it('actor inactivo → ACTOR_NO_AUTORIZADO', async () => {
    prisma.usuario.findUnique = async () => ({ id: 1, activo: false, rol: 'SUPERADMIN', empresaId: 1 })
    await assert.rejects(() => prevalidarActor(1), { code: 'ACTOR_NO_AUTORIZADO' })
  })

  it('actor ya no es SUPERADMIN → ACTOR_NO_AUTORIZADO', async () => {
    prisma.usuario.findUnique = async () => ({ id: 1, activo: true, rol: 'EMPLEADO', empresaId: 1 })
    await assert.rejects(() => prevalidarActor(1), { code: 'ACTOR_NO_AUTORIZADO' })
  })

  it('actor sin empresa → ACTOR_SIN_EMPRESA', async () => {
    prisma.usuario.findUnique = async () => ({ id: 1, activo: true, rol: 'SUPERADMIN', empresaId: null })
    await assert.rejects(() => prevalidarActor(1), { code: 'ACTOR_SIN_EMPRESA' })
  })

  it('empresa inactiva → EMPRESA_INACTIVA', async () => {
    prisma.usuario.findUnique = async () => ({ id: 1, activo: true, rol: 'SUPERADMIN', empresaId: 1 })
    prisma.empresa.findUnique = async () => ({ id: 1, activa: false })
    await assert.rejects(() => prevalidarActor(1), { code: 'EMPRESA_INACTIVA' })
  })
})

describe('crear - validación de body (mock $transaction)', () => {
  const reqBase = {
    usuario: { id: 1, nombre: 'Admin', rol: 'SUPERADMIN' },
    ip: '127.0.0.1'
  }

  it('body no es objeto → 400', async () => {
    const res = mockRes()
    reqBase.body = 'invalido'
    await controller.crear(reqBase, res)
    assert.strictEqual(res._state.statusCode, 400)
  })

  it('body es array → 400', async () => {
    const res = mockRes()
    reqBase.body = []
    await controller.crear(reqBase, res)
    assert.strictEqual(res._state.statusCode, 400)
  })

  it('sin campos obligatorios → 400', async () => {
    const res = mockRes()
    reqBase.body = { nombre: 'a' }
    await controller.crear(reqBase, res)
    assert.strictEqual(res._state.statusCode, 400)
  })

  it('contraseñas no coinciden → 400', async () => {
    const res = mockRes()
    reqBase.body = { nombre: 'A', username: 'a', password: 'pass123', confirmarPassword: 'otra', rol: 'EMPLEADO' }
    await controller.crear(reqBase, res)
    assert.strictEqual(res._state.statusCode, 400)
  })

  it('password muy corto → 400', async () => {
    const res = mockRes()
    reqBase.body = { nombre: 'A', username: 'a', password: '12', confirmarPassword: '12', rol: 'EMPLEADO' }
    await controller.crear(reqBase, res)
    assert.strictEqual(res._state.statusCode, 400)
  })

  it('rol no asignable → 403', async () => {
    const res = mockRes()
    reqBase.body = { nombre: 'A', username: 'a', password: 'pass123', confirmarPassword: 'pass123', rol: 'SUPERADMIN' }
    await controller.crear(reqBase, res)
    assert.strictEqual(res._state.statusCode, 403)
  })

  it('rol PLATFORM_ADMIN → 403', async () => {
    const res = mockRes()
    reqBase.body = { nombre: 'A', username: 'a', password: 'pass123', confirmarPassword: 'pass123', rol: 'PLATFORM_ADMIN' }
    await controller.crear(reqBase, res)
    assert.strictEqual(res._state.statusCode, 403)
  })
})

describe('editar - validación de body (mock $transaction)', () => {
  const reqBase = {
    usuario: { id: 1, nombre: 'Admin', rol: 'SUPERADMIN' },
    ip: '127.0.0.1',
    params: { id: '2' }
  }

  it('body no es objeto → 400', async () => {
    const res = mockRes()
    reqBase.body = null
    await controller.editar(reqBase, res)
    assert.strictEqual(res._state.statusCode, 400)
  })

  it('empresaId en body → EMPRESA_NO_MODIFICABLE', async () => {
    const res = mockRes()
    reqBase.body = { empresaId: 1 }
    await controller.editar(reqBase, res)
    assert.strictEqual(res._state.statusCode, 400)
  })
})
