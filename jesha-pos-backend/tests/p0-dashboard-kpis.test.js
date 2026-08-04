'use strict'

// P0-DASHBOARD-KPIS UNIT TEST
// Valida obtenerDashboardKpis con prisma mockeado y contexto tenant.
// No requiere BD: verifica aislamiento, ignorar query legacy sucursalId,
// validación de fechas y forma de respuesta.

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')

let controller, prisma

function buildReq({ empresaId = 1, branchSucursalId = null, query = {} } = {}) {
  return {
    query,
    context: Object.freeze({
      version: 1,
      kind: 'TENANT',
      actor: { id: 1, rol: 'SUPERADMIN' },
      tenant: { empresaId },
      branch: { mode: branchSucursalId === null ? 'NONE' : 'SELECTED', sucursalId: branchSucursalId }
    })
  }
}

function mockRes() {
  const state = { statusCode: 200, body: null }
  return {
    state,
    status(code) { state.statusCode = code; return this },
    json(body) { state.body = body; return this }
  }
}

function aggregateResult(total, count) {
  return { _sum: { total: total === undefined ? null : total }, _count: { id: count || 0 } }
}

before(() => {
  prisma = require('../src/lib/prisma')
  controller = require('../src/modules/ventas/ventas.controller')
})

describe('P0-DASHBOARD-KPIS: scope de queries', { concurrency: 1 }, () => {
  after(() => {
    delete prisma.venta.aggregate
    delete prisma.venta.findMany
    delete prisma.devolucion.aggregate
    delete prisma.movimientoCaja.aggregate
  })

  it('NONE: todas las queries incluyen empresaId y ninguna sucursalId', async () => {
    const seen = { ventas: [], devoluciones: [], movimientos: [] }
    prisma.venta.aggregate = async ({ where }) => {
      seen.ventas.push(JSON.stringify(where))
      return aggregateResult(100, 2)
    }
    prisma.venta.findMany = async ({ where }) => {
      seen.ventas.push(JSON.stringify(where))
      return []
    }
    prisma.devolucion.aggregate = async ({ where }) => {
      seen.devoluciones.push(JSON.stringify(where))
      return { _sum: { montoReembolso: 5 } }
    }
    prisma.movimientoCaja.aggregate = async ({ where }) => {
      seen.movimientos.push(JSON.stringify(where))
      return { _sum: { monto: 20 }, _count: { id: 1 } }
    }

    const req = buildReq({ empresaId: 7, branchSucursalId: null })
    const res = mockRes()
    await controller.obtenerDashboardKpis(req, res)

    assert.strictEqual(res.state.statusCode, 200)
    assert.ok(seen.ventas.length >= 2)
    for (const w of seen.ventas) {
      assert.ok(JSON.parse(w).empresaId === 7, `venta sin empresaId: ${w}`)
      assert.strictEqual(JSON.parse(w).sucursalId, undefined, `venta con sucursalId en NONE: ${w}`)
    }
    const dev = JSON.parse(seen.devoluciones[0])
    assert.strictEqual(dev.empresaId, 7)
    assert.strictEqual(dev.sucursalId, undefined)
    const mov = JSON.parse(seen.movimientos[0])
    assert.strictEqual(mov.TurnoCaja.empresaId, 7)
    assert.strictEqual(mov.TurnoCaja.sucursalId, undefined)
  })

  it('SELECTED: todas las queries incluyen empresaId y sucursalId numérico', async () => {
    const seen = { ventas: [], devoluciones: [], movimientos: [] }
    prisma.venta.aggregate = async ({ where }) => {
      seen.ventas.push(JSON.stringify(where))
      return aggregateResult(50, 1)
    }
    prisma.venta.findMany = async ({ where }) => {
      seen.ventas.push(JSON.stringify(where))
      return []
    }
    prisma.devolucion.aggregate = async ({ where }) => {
      seen.devoluciones.push(JSON.stringify(where))
      return { _sum: { montoReembolso: 0 } }
    }
    prisma.movimientoCaja.aggregate = async ({ where }) => {
      seen.movimientos.push(JSON.stringify(where))
      return { _sum: { monto: 0 }, _count: { id: 0 } }
    }

    const req = buildReq({ empresaId: 3, branchSucursalId: 9 })
    const res = mockRes()
    await controller.obtenerDashboardKpis(req, res)

    assert.strictEqual(res.state.statusCode, 200)
    for (const w of seen.ventas) {
      const parsed = JSON.parse(w)
      assert.strictEqual(parsed.empresaId, 3)
      assert.strictEqual(parsed.sucursalId, 9, `sucursalId no aplicado: ${w}`)
      assert.strictEqual(typeof parsed.sucursalId, 'number')
    }
    const dev = JSON.parse(seen.devoluciones[0])
    assert.strictEqual(dev.sucursalId, 9)
    assert.strictEqual(typeof dev.sucursalId, 'number')
    const mov = JSON.parse(seen.movimientos[0])
    assert.strictEqual(mov.TurnoCaja.sucursalId, 9)
  })

  it('Ventas recientes excluyen canceladas', async () => {
    prisma.venta.aggregate = async () => aggregateResult(0, 0)
    prisma.venta.findMany = async ({ where }) => {
      assert.deepStrictEqual(where.estado, { not: 'CANCELADA' })
      return []
    }
    prisma.devolucion.aggregate = async () => ({ _sum: { montoReembolso: 0 } })
    prisma.movimientoCaja.aggregate = async () => ({ _sum: { monto: 0 }, _count: { id: 0 } })

    const req = buildReq({})
    const res = mockRes()
    await controller.obtenerDashboardKpis(req, res)
    assert.strictEqual(res.state.statusCode, 200)
  })
})

describe('P0-DASHBOARD-KPIS: query legacy sucursalId ignorado', { concurrency: 1 }, () => {
  after(() => {
    delete prisma.venta.aggregate
    delete prisma.venta.findMany
    delete prisma.devolucion.aggregate
    delete prisma.movimientoCaja.aggregate
  })

  it('sucursalId en query no altera el contexto (NONE sigue NONE)', async () => {
    prisma.venta.aggregate = async ({ where }) => {
      assert.strictEqual(where.sucursalId, undefined, 'query sucursalId con autoridad')
      return aggregateResult(100, 1)
    }
    prisma.venta.findMany = async () => []
    prisma.devolucion.aggregate = async () => ({ _sum: { montoReembolso: 0 } })
    prisma.movimientoCaja.aggregate = async () => ({ _sum: { monto: 0 }, _count: { id: 0 } })

    const req = buildReq({ empresaId: 1, branchSucursalId: null, query: { sucursalId: '50' } })
    const res = mockRes()
    await controller.obtenerDashboardKpis(req, res)
    assert.strictEqual(res.state.statusCode, 200)
  })
})

describe('P0-DASHBOARD-KPIS: validación de fechas', { concurrency: 1 }, () => {
  after(() => {
    delete prisma.venta.aggregate
    delete prisma.venta.findMany
    delete prisma.devolucion.aggregate
    delete prisma.movimientoCaja.aggregate
  })

  function stubOk() {
    prisma.venta.aggregate = async () => aggregateResult(0, 0)
    prisma.venta.findMany = async () => []
    prisma.devolucion.aggregate = async () => ({ _sum: { montoReembolso: 0 } })
    prisma.movimientoCaja.aggregate = async () => ({ _sum: { monto: 0 }, _count: { id: 0 } })
  }

  it('sin desde/hasta usa hoy y responde 200', async () => {
    stubOk()
    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({}), res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.strictEqual(res.state.body.success, true)
  })

  it('desde solo → 400', async () => {
    stubOk()
    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({ query: { desde: '2026-01-01' } }), res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('hasta solo → 400', async () => {
    stubOk()
    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({ query: { hasta: '2026-01-01' } }), res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('fechas vacías → 400', async () => {
    stubOk()
    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({ query: { desde: '', hasta: '' } }), res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('fecha inválida → 400', async () => {
    stubOk()
    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({ query: { desde: 'no-una-fecha', hasta: '2026-01-01' } }), res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('rango invertido → 400', async () => {
    stubOk()
    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({ query: { desde: '2026-02-01', hasta: '2026-01-01' } }), res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('rango válido → 200 y hasta al final del día', async () => {
    let capturado = null
    let llamadas = 0
    prisma.venta.aggregate = async ({ where }) => {
      llamadas++
      if (llamadas === 1) capturado = where.creadaEn
      return aggregateResult(10, 1)
    }
    prisma.venta.findMany = async () => []
    prisma.devolucion.aggregate = async () => ({ _sum: { montoReembolso: 0 } })
    prisma.movimientoCaja.aggregate = async () => ({ _sum: { monto: 0 }, _count: { id: 0 } })

    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({ query: { desde: '2026-01-01', hasta: '2026-01-01' } }), res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.ok(capturado.lte instanceof Date)
    assert.strictEqual(capturado.lte.getHours(), 23)
    assert.strictEqual(capturado.lte.getMinutes(), 59)
  })
})

describe('P0-DASHBOARD-KPIS: forma de respuesta y 500 solo errores reales', { concurrency: 1 }, () => {
  after(() => {
    delete prisma.venta.aggregate
    delete prisma.venta.findMany
    delete prisma.devolucion.aggregate
    delete prisma.movimientoCaja.aggregate
  })

  it('respuesta 200 completa con ceros cuando no hay datos', async () => {
    prisma.venta.aggregate = async () => aggregateResult(null, 0)
    prisma.venta.findMany = async () => []
    prisma.devolucion.aggregate = async () => ({ _sum: { montoReembolso: null } })
    prisma.movimientoCaja.aggregate = async () => ({ _sum: { monto: null }, _count: { id: 0 } })

    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({}), res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.strictEqual(res.state.body.success, true)
    assert.strictEqual(res.state.body.ventasHoy.total, 0)
    assert.strictEqual(res.state.body.ventasHoy.totalBruto, 0)
    assert.strictEqual(res.state.body.ventasHoy.devoluciones, 0)
    assert.strictEqual(res.state.body.ventasHistorico.total, 0)
    assert.strictEqual(res.state.body.ventasHistorico.count, 0)
    assert.strictEqual(res.state.body.cobranzaHoy.total, 0)
    assert.deepStrictEqual(res.state.body.ventasRecientes, [])
  })

  it('error de prisma → 500', async () => {
    prisma.venta.aggregate = async () => { throw new Error('fallo simulado') }
    const res = mockRes()
    await controller.obtenerDashboardKpis(buildReq({}), res)
    assert.strictEqual(res.state.statusCode, 500)
  })
})
