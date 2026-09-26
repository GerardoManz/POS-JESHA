'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const prisma = require('../src/lib/prisma')
const debug = require('../src/lib/debug')
const resolverCtrl = require('../src/modules/facturas/resolver-timbrado.controller')
const {
  clasificarErrorTimbrado,
  esRespuestaPendienteFacturapi
} = require('../src/modules/facturacion/facturacion.controller')

describe('P1 facturación: clasificación segura del resultado remoto', () => {
  it('clasifica un 400 anidado en response.status como validación', () => {
    assert.equal(clasificarErrorTimbrado({ response: { status: 400 } }), 'VALIDACION')
  })

  it('clasifica códigos fiscales definitivos aunque el SDK no exponga status', () => {
    for (const code of [
      'tax_id_not_found',
      'legal_name_mismatch',
      'tax_address_zip_mismatch',
      'tax_system_not_allowed_for_tax_id'
    ]) {
      assert.equal(clasificarErrorTimbrado({ error: { code } }), 'VALIDACION', code)
    }
  })

  it('mantiene inciertos timeout, 409, 429 y 5xx', () => {
    for (const error of [
      { status: 408 },
      { status: 409 },
      { response: { status: 429 } },
      { statusCode: 500 },
      new TypeError('Network request timed out')
    ]) {
      assert.equal(clasificarErrorTimbrado(error), 'INCIERTO')
    }
  })

  it('clasifica 400, 401, 403 y 404 como validaciones', () => {
    for (const status of [400, 401, 403, 404]) {
      assert.equal(clasificarErrorTimbrado({ response: { status } }), 'VALIDACION', String(status))
    }
  })

  it('extrae código fiscal desde response.data.code', () => {
    assert.equal(
      clasificarErrorTimbrado({ response: { data: { code: 'legal_name_mismatch' } } }),
      'VALIDACION'
    )
  })

  it('detecta pending/processing como respuesta inconclusa', () => {
    assert.equal(esRespuestaPendienteFacturapi({ status: 'pending' }), true)
    assert.equal(esRespuestaPendienteFacturapi({ status: 'processing' }), true)
    assert.equal(esRespuestaPendienteFacturapi({ status: 'valid' }), false)
  })

  it('no marca respuestas pending como éxito TIMBRADA', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/modules/facturacion/facturacion.controller.js'),
      'utf8'
    )
    assert.ok((source.match(/esRespuestaPendienteFacturapi\(invoice\)/g) || []).length >= 2)
    assert.match(source, /Facturapi respondió status pendiente; requiere reconciliación\./)
  })

  it('cierra el intento local fallido y libera la venta', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/modules/facturacion/facturacion.controller.js'),
      'utf8'
    )
    assert.match(source, /async function cerrarSolicitudFallida\(/)
    assert.match(source, /estado: 'CANCELADA'/)
    assert.match(source, /facturaEstado: 'DISPONIBLE', procesoFacturaId: null/)
    assert.match(source, /requiereNuevaSolicitud: true/)
  })

  it('separa cancelación fiscal de rechazo local en las estadísticas', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/modules/facturas/facturas.controller.js'),
      'utf8'
    )
    assert.match(source, /estado: 'CANCELADA', folioFiscal: \{ not: null \}/)
    assert.match(source, /esSolicitudFallida: f\.estado === 'CANCELADA' && !f\.folioFiscal/)
  })

  it('bloquea edición y acciones de timbrado/cancelación durante incertidumbre', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../facturas.js'),
      'utf8'
    )
    assert.match(source, /esPendiente && !incierto/)
    assert.match(source, /esCfdiActivo && !incierto/)
    assert.match(source, /!f\.facturapiId && !f\.procesandoTimbrado/)
  })

  it('no envía scope tenant al buscar, reconciliar ni descartar incertidumbre', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../facturas.js'), 'utf8')
    const candidatos = source.slice(
      source.indexOf('window.verCandidatos ='),
      source.indexOf('//  RECONCILIAR TIMBRADO')
    )
    const reconciliar = source.slice(
      source.indexOf('window.reconciliarTimbrado ='),
      source.indexOf('//  DESCARTAR INCERTIDUMBRE')
    )
    const descartar = source.slice(
      source.indexOf('window.descartarTimbradoIncierto ='),
      source.indexOf('//  DESCARGAR PDF / XML')
    )

    assert.match(candidatos, /\/timbrado-candidatos`/)
    assert.doesNotMatch(candidatos, /empresaId|sucursalId/)
    assert.match(reconciliar, /const body = \{ facturapiId \}/)
    assert.doesNotMatch(reconciliar, /body\.(empresaId|sucursalId)|params\.set\(['"](empresaId|sucursalId)/)
    assert.match(descartar, /const body = \{ confirmacionManual: texto \}/)
    assert.doesNotMatch(descartar, /body\.(empresaId|sucursalId)|params\.set\(['"](empresaId|sucursalId)/)
  })

  it('mantiene el safety gate: rechaza scope externo antes de consultar Prisma', async () => {
    const originalFindFirst = prisma.facturaCfdi.findFirst
    const originalUpdateMany = prisma.facturaCfdi.updateMany
    const originalLogJSON = debug.logJSON
    let dbCalls = 0
    const logEvents = []

    prisma.facturaCfdi.findFirst = async () => { dbCalls++; throw new Error('DB_SHOULD_NOT_BE_CALLED') }
    prisma.facturaCfdi.updateMany = async () => { dbCalls++; throw new Error('DB_SHOULD_NOT_BE_CALLED') }
    debug.logJSON = event => logEvents.push(event)

    try {
      for (const scope of [
        { body: { empresaId: 1 }, query: {} },
        { body: { sucursalId: 1 }, query: {} },
        { body: {}, query: { sucursalId: 1 } }
      ]) {
        const result = await invokeDiscard(scope)
        assert.equal(result.status, 400)
      }
      assert.equal(dbCalls, 0)
      assert.equal(logEvents.length, 3)
      assert.deepEqual(
        {
          requestId: logEvents[0].requestId,
          route: logEvents[0].route,
          status: logEvents[0].status,
          code: logEvents[0].code,
          error: logEvents[0].error
        },
        {
          requestId: 'test-request-id',
          route: '/:id/descartar-timbrado-incierto',
          status: 400,
          code: null,
          error: { type: 'Error', message: 'empresaId no se acepta en body ni query' }
        }
      )
    } finally {
      prisma.facturaCfdi.findFirst = originalFindFirst
      prisma.facturaCfdi.updateMany = originalUpdateMany
      debug.logJSON = originalLogJSON
    }
  })

  it('acepta scope de req.context y ejecuta lectura, CAS y auditoría', async () => {
    const originalFindFirst = prisma.facturaCfdi.findFirst
    const originalUpdateMany = prisma.facturaCfdi.updateMany
    const originalAuditCreate = prisma.auditoria.create
    const operations = []

    prisma.facturaCfdi.findFirst = async () => {
      operations.push('findFirst')
      return {
        id: 280,
        estado: 'PENDIENTE_TIMBRADO',
        procesandoTimbrado: true,
        facturapiId: null,
        idempotencyKey: 'test-280'
      }
    }
    prisma.facturaCfdi.updateMany = async () => {
      operations.push('updateMany')
      return { count: 1 }
    }
    prisma.auditoria.create = async () => {
      operations.push('auditoria.create')
      return { id: 1 }
    }

    try {
      const result = await invokeDiscard({ body: {}, query: {} })
      assert.equal(result.status, 200)
      assert.deepEqual(operations, ['findFirst', 'updateMany', 'auditoria.create'])
    } finally {
      prisma.facturaCfdi.findFirst = originalFindFirst
      prisma.facturaCfdi.updateMany = originalUpdateMany
      prisma.auditoria.create = originalAuditCreate
    }
  })
})

async function invokeDiscard({ body, query }) {
  const req = {
    params: { id: '280' },
    body: { confirmacionManual: 'Verificado manualmente en portal SAT', ...body },
    query,
    requestId: 'test-request-id',
    route: { path: '/:id/descartar-timbrado-incierto' },
    context: {
      version: 1,
      kind: 'TENANT',
      actor: { id: 1, rol: 'ADMIN_SUCURSAL' },
      tenant: { empresaId: 1 },
      branch: { mode: 'FIXED', sucursalId: 1 }
    },
    usuario: { id: 1 },
    ip: '127.0.0.1'
  }
  const result = { status: 200, body: null }
  const res = {
    status(status) { result.status = status; return this },
    json(responseBody) { result.body = responseBody; return this }
  }
  await resolverCtrl.descartarTimbradoIncierto(req, res)
  return result
}
