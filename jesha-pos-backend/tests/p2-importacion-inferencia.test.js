'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { inferirUnidadVenta } = require('../src/modules/productos/importacion.controller')

describe('P2 — inferirUnidadVenta (controlador importación)', () => {

  it('prioridad 1: tipoGranelCSV explícito tiene prioridad', () => {
    assert.equal(inferirUnidadVenta('MARTILLO', true, 'KG'), 'KG')
  })

  it('prioridad 1: tipoGranelCSV con alias se normaliza', () => {
    assert.equal(inferirUnidadVenta('MARTILLO', true, 'kilo'), 'KG')
  })

  it('prioridad 1: tipoGranelCSV vacío cae a inferencia', () => {
    const r = inferirUnidadVenta('BOLSA CON PIJAS', false, '')
    assert.equal(r, 'BOLSA')
  })

  it('prioridad 2-3: presentación fija en nombre', () => {
    assert.equal(inferirUnidadVenta('BOLSA CON PIJAS', false), 'BOLSA')
    assert.equal(inferirUnidadVenta('CAJA DE TORNILLOS', false), 'CAJA')
    assert.equal(inferirUnidadVenta('ROLLO DE CINTA', false), 'ROLLO')
    assert.equal(inferirUnidadVenta('BULTO DE CAL', false), 'BULTO')
  })

  it('prioridad 4: fraccionable en nombre', () => {
    assert.equal(inferirUnidadVenta('CLAVO X KG', false), 'KG')
    assert.equal(inferirUnidadVenta('MANGUERA POR METRO', false), 'MT')
    assert.equal(inferirUnidadVenta('ACEITE POR LITRO', false), 'LT')
  })

  it('prioridad 5: producto físico sin patrón → PZA', () => {
    assert.equal(inferirUnidadVenta('MARTILLO', false), 'PZA')
    assert.equal(inferirUnidadVenta('TUERCA DE 1/2', false), 'PZA')
    assert.equal(inferirUnidadVenta('SELLADOR DE SILICON', false), 'PZA')
  })

  it('prioridad 6: sin descripción no se infiere', () => {
    assert.equal(inferirUnidadVenta('', false), null)
    assert.equal(inferirUnidadVenta(null, false), null)
  })

  it('servicio: sin descripción devuelve null', () => {
    assert.equal(inferirUnidadVenta('', false), null)
    assert.equal(inferirUnidadVenta(null, false), null)
  })

  it('granel sin patrón devuelve null (no inferir PZA default)', () => {
    assert.equal(inferirUnidadVenta('MATERIAL SUELTO', true), null)
    assert.equal(inferirUnidadVenta('MEZCLA', true), null)
  })

  it('granel con patrón claro sí infiere', () => {
    assert.equal(inferirUnidadVenta('CLAVO X KG', true), 'KG')
    assert.equal(inferirUnidadVenta('MANGUERA POR METRO', true), 'MT')
    assert.equal(inferirUnidadVenta('BOLSA DE CAL', true), 'BOLSA')
  })

})
