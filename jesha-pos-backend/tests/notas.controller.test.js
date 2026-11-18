'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  crearNotasController,
  NotaError,
  validarContenido,
  prepararDestino
} = require('../src/modules/notas/notas.controller')

function context({ actorId = 1, rol = 'SUPERADMIN', empresaId = 10, sucursalId = null, mode = 'NONE' } = {}) {
  return {
    version: 1,
    kind: 'TENANT',
    actor: { id: actorId, rol },
    tenant: { empresaId },
    branch: { mode, sucursalId }
  }
}

function request(options = {}) {
  return {
    context: options.context || context(),
    delegation: options.delegation,
    params: options.params || {},
    query: options.query || {},
    body: options.body || {},
    ip: '127.0.0.1'
  }
}

function response() {
  const state = { status: 200, body: null }
  return {
    state,
    status(code) { state.status = code; return this },
    json(body) { state.body = body; return this }
  }
}

describe('NOTAS validation and destination policy', () => {
  it('normalizes content and enforces title and body length', () => {
    assert.deepEqual(validarContenido({ titulo: '  Aviso  ', contenido: '  Texto  ' }), {
      titulo: 'Aviso',
      contenido: 'Texto'
    })
    assert.throws(() => validarContenido({ titulo: ' ', contenido: 'Texto' }), NotaError)
    assert.throws(() => validarContenido({ titulo: 'x'.repeat(161), contenido: 'Texto' }), NotaError)
    assert.equal(validarContenido({ titulo: 'Aviso', contenido: 'x'.repeat(20000) }).contenido.length, 20000)
    assert.throws(() => validarContenido({ titulo: 'Aviso', contenido: 'x'.repeat(20001) }), NotaError)
  })

  it('ADMIN_SUCURSAL can target only its operational branch', async () => {
    const db = {
      sucursal: { findFirst: async () => ({ id: 5 }) },
      usuario: { findMany: async () => [{ id: 2 }] }
    }
    const admin = { empresaId: 10, actorId: 1, rol: 'ADMIN_SUCURSAL', sucursalId: 5, delegado: false }
    const allowed = await prepararDestino(db, admin, { alcance: 'SUCURSAL', sucursalId: 5 })
    assert.deepEqual(allowed.destinatarios, [2])
    await assert.rejects(
      prepararDestino(db, admin, { alcance: 'SUCURSAL', sucursalId: 6 }),
      (error) => error.code === 'NOTA_SUCURSAL_PROHIBIDA'
    )
    await assert.rejects(
      prepararDestino(db, admin, { alcance: 'EMPRESA' }),
      (error) => error.code === 'NOTA_ALCANCE_PROHIBIDO'
    )
  })

  it('personal destination rejects self, cross-branch and delegated publication', async () => {
    const db = {
      usuario: {
        findFirst: async ({ where }) => ({ id: where.id, sucursalId: 9 })
      }
    }
    const employee = { empresaId: 10, actorId: 1, rol: 'EMPLEADO', sucursalId: 5, delegado: false }
    await assert.rejects(
      prepararDestino(db, employee, { alcance: 'USUARIO', usuarioDestinatarioId: 1 }),
      (error) => error.code === 'NOTA_AUTODESTINO_PROHIBIDO'
    )
    await assert.rejects(
      prepararDestino(db, employee, { alcance: 'USUARIO', usuarioDestinatarioId: 2 }),
      (error) => error.code === 'NOTA_USUARIO_PROHIBIDO'
    )
    await assert.rejects(
      prepararDestino(db, { ...employee, rol: 'SUPERADMIN', delegado: true }, { alcance: 'USUARIO', usuarioDestinatarioId: 2 }),
      (error) => error.code === 'NOTA_PERSONAL_DELEGADA_PROHIBIDA'
    )
  })

  it('company snapshot includes active branchless PRECIOS and excludes author/platform users', async () => {
    let receivedWhere
    const db = {
      usuario: {
        findMany: async ({ where }) => {
          receivedWhere = where
          return [{ id: 7 }, { id: 8 }]
        }
      }
    }
    const result = await prepararDestino(db, { empresaId: 10, actorId: 1, rol: 'SUPERADMIN', sucursalId: null, delegado: false }, { alcance: 'EMPRESA' })
    assert.deepEqual(result.destinatarios, [7, 8])
    assert.deepEqual(receivedWhere, {
      empresaId: 10,
      activo: true,
      rol: { not: 'PLATFORM_ADMIN' },
      id: { not: 1 }
    })
    assert.equal(Object.hasOwn(receivedWhere, 'sucursalId'), false)
  })

  it('rejects company or branch publication without effective recipients', async () => {
    const db = {
      usuario: { findMany: async () => [] },
      sucursal: { findFirst: async () => ({ id: 5 }) }
    }
    const superadmin = { empresaId: 10, actorId: 1, rol: 'SUPERADMIN', sucursalId: null, delegado: false }
    await assert.rejects(
      prepararDestino(db, superadmin, { alcance: 'EMPRESA' }),
      (error) => error.code === 'NOTA_SIN_DESTINATARIOS'
    )
    await assert.rejects(
      prepararDestino(db, superadmin, { alcance: 'SUCURSAL', sucursalId: 5 }),
      (error) => error.code === 'NOTA_SIN_DESTINATARIOS'
    )
  })
})

describe('NOTAS controller privacy and state transitions', () => {
  it('SUPERADMIN lookup cannot expose another author personal note', async () => {
    let receivedWhere
    const db = {
      nota: {
        findFirst: async ({ where }) => {
          receivedWhere = where
          return null
        }
      }
    }
    const controller = crearNotasController({ prisma: db })
    const res = response()
    await controller.obtener(request({ params: { id: '44' } }), res)
    assert.equal(res.state.status, 404)
    assert.equal(receivedWhere.empresaId, 10)
    assert.deepEqual(receivedWhere.OR, [
      { autorId: 1 },
      { retiradaEn: null, NotaDestinatario: { some: { usuarioId: 1, empresaId: 10 } } },
      { alcance: { not: 'USUARIO' } }
    ])
  })

  it('mark-read is idempotent and never rewrites an existing timestamp', async () => {
    const timestamp = new Date('2026-11-17T10:00:00.000Z')
    let updateCalls = 0
    const tx = {
      notaDestinatario: {
        findFirst: async () => ({ id: 9, leidaEn: timestamp }),
        updateMany: async () => { updateCalls++; return { count: 1 } },
        findUnique: async () => ({ id: 9, leidaEn: timestamp })
      }
    }
    const db = { $transaction: async (callback) => callback(tx) }
    const controller = crearNotasController({ prisma: db })
    const res = response()
    await controller.leer(request({ params: { id: '3' } }), res)
    assert.equal(res.state.status, 200)
    assert.equal(res.state.body.data.leidaEn, timestamp)
    assert.equal(updateCalls, 0)
  })

  it('delegated actor gets disabled unread summary and mark-read is rejected', async () => {
    const controller = crearNotasController({ prisma: {} })
    const delegated = request({ delegation: { active: true } })
    const summaryRes = response()
    await controller.resumenNoLeidas(delegated, summaryRes)
    assert.equal(summaryRes.state.body.data.enabled, false)

    const readRes = response()
    await controller.leer(request({ delegation: { active: true }, params: { id: '2' } }), readRes)
    assert.equal(readRes.state.status, 403)
    assert.equal(readRes.state.body.code, 'NOTA_LECTURA_DELEGADA_PROHIBIDA')
  })

  it('summary cursor detects newly published notes even when unread total is unchanged', async () => {
    const firstDate = new Date('2026-11-17T10:00:00.000Z')
    const secondDate = new Date('2026-11-17T11:00:00.000Z')
    let latest = { id: 10, creadaEn: firstDate }
    let newCount = 0
    const db = {
      notaDestinatario: { count: () => Promise.resolve(2) },
      nota: {
        findFirst: () => Promise.resolve(latest),
        count: ({ where }) => Promise.resolve(where.id === -1 ? 0 : newCount)
      },
      $transaction: (queries) => Promise.all(queries)
    }
    const controller = crearNotasController({ prisma: db })
    const firstRes = response()
    await controller.resumenNoLeidas(request(), firstRes)
    const cursor = firstRes.state.body.data.cursor
    assert.equal(firstRes.state.body.data.unreadCount, 2)
    assert.equal(firstRes.state.body.data.newSinceCursor.hasNew, false)

    latest = { id: 11, creadaEn: secondDate }
    newCount = 1
    const secondRes = response()
    await controller.resumenNoLeidas(request({ query: { cursor } }), secondRes)
    assert.equal(secondRes.state.body.data.unreadCount, 2)
    assert.equal(secondRes.state.body.data.newSinceCursor.hasNew, true)
    assert.equal(secondRes.state.body.data.newSinceCursor.count, 1)
    assert.equal(secondRes.state.body.data.newSinceCursor.latest.id, 11)
  })

  it('withdrawn notes are immutable and are not updated twice', async () => {
    let updateCalls = 0
    const tx = {
      nota: {
        findFirst: async () => ({ id: 5, autorId: 1, alcance: 'EMPRESA', retiradaEn: new Date() }),
        updateMany: async () => { updateCalls++; return { count: 1 } }
      }
    }
    const db = { $transaction: async (callback) => callback(tx) }
    const controller = crearNotasController({ prisma: db })
    const res = response()
    await controller.retirar(request({ params: { id: '5' }, body: { motivo: 'Ya no aplica' } }), res)
    assert.equal(res.state.status, 409)
    assert.equal(res.state.body.code, 'NOTA_YA_RETIRADA')
    assert.equal(updateCalls, 0)
  })

  it('withdraw and replacement use scoped 404 for another author personal note', async () => {
    const receivedWhere = []
    const tx = {
      nota: {
        findFirst: async ({ where }) => {
          receivedWhere.push(where)
          return null
        }
      }
    }
    const db = { $transaction: async (callback) => callback(tx) }
    const controller = crearNotasController({ prisma: db })

    const withdrawRes = response()
    await controller.retirar(request({ params: { id: '12' }, body: { motivo: 'Corrección' } }), withdrawRes)
    assert.equal(withdrawRes.state.status, 404)

    const replaceRes = response()
    await controller.reemplazar(request({
      params: { id: '12' },
      body: { motivo: 'Corrección', titulo: 'Nuevo', contenido: 'Contenido nuevo' }
    }), replaceRes)
    assert.equal(replaceRes.state.status, 404)

    for (const where of receivedWhere) {
      assert.equal(where.empresaId, 10)
      assert.deepEqual(where.OR, [{ autorId: 1 }, { alcance: { not: 'USUARIO' } }])
    }
  })

  it('replacement withdraws and publishes the same target with a fresh recipient snapshot in one transaction', async () => {
    const events = []
    let createdData
    const tx = {
      nota: {
        findFirst: async () => ({
          id: 12,
          autorId: 1,
          alcance: 'SUCURSAL',
          sucursalId: 5,
          usuarioDestinatarioId: null,
          retiradaEn: null
        }),
        updateMany: async () => { events.push('withdraw'); return { count: 1 } },
        create: async ({ data }) => {
          events.push('create')
          createdData = data
          return {
            id: 13,
            ...data,
            creadaEn: new Date(),
            retiradaEn: null,
            retiradaPorId: null,
            motivoRetiro: null,
            Autor: null,
            Sucursal: null,
            UsuarioDestinatario: null,
            RetiradaPor: null,
            ReemplazadaPor: null,
            NotaDestinatario: [],
            _count: { NotaDestinatario: 2 }
          }
        }
      },
      sucursal: { findFirst: async () => ({ id: 5 }) },
      usuario: { findMany: async () => [{ id: 2 }, { id: 3 }] },
      auditoria: { create: async () => ({ id: 1 }) }
    }
    let transactionCalls = 0
    const db = {
      $transaction: async (callback) => {
        transactionCalls++
        return callback(tx)
      }
    }
    const controller = crearNotasController({ prisma: db })
    const res = response()
    await controller.reemplazar(request({
      params: { id: '12' },
      body: { motivo: 'Corrección', titulo: 'Nuevo', contenido: 'Contenido nuevo' }
    }), res)

    assert.equal(res.state.status, 201)
    assert.equal(transactionCalls, 1)
    assert.deepEqual(events, ['withdraw', 'create'])
    assert.equal(createdData.alcance, 'SUCURSAL')
    assert.equal(createdData.sucursalId, 5)
    assert.equal(createdData.usuarioDestinatarioId, null)
    assert.equal(createdData.reemplazaNotaId, 12)
    assert.deepEqual(createdData.NotaDestinatario.create, [
      { usuarioId: 2 },
      { usuarioId: 3 }
    ])
  })

  it('tenant scope is always included in receipt lookup', async () => {
    let receivedWhere
    const tx = {
      notaDestinatario: {
        findFirst: async ({ where }) => {
          receivedWhere = where
          return null
        }
      }
    }
    const db = { $transaction: async (callback) => callback(tx) }
    const controller = crearNotasController({ prisma: db })
    const res = response()
    await controller.leer(request({ params: { id: '77' } }), res)
    assert.equal(res.state.status, 404)
    assert.equal(receivedWhere.empresaId, 10)
    assert.equal(receivedWhere.usuarioId, 1)
    assert.equal(receivedWhere.notaId, 77)
  })
})
