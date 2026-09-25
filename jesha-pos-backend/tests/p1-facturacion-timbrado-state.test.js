'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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
})
