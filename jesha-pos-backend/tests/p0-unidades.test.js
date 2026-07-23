'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

// ── Replicar las funciones inline del controller para probar P0 ──
// Estas se migrarán al helper en P1

const UNIDADES_VENTA_VALIDAS = new Set([
  'PZA', 'MT', 'CM', 'KG', 'G', 'LT', 'ML', 'M2', 'M3',
  'PAQUETE', 'PAR', 'KIT', 'JUEGO', 'CAJA', 'ROLLO', 'BOLSA',
  'BULTO', 'SACO', 'BOTE', 'CUBETA', 'BOTELLA', 'LATA',
  'TAMBOR', 'TRAMO', 'DOCENA', 'VIAJE',
])

const ALIASES_UNIDAD_VENTA = {
  PZ: 'PZA', PZAS: 'PZA', PIEZA: 'PZA', PIEZAS: 'PZA',
  M: 'MT', MTS: 'MT', METRO: 'MT', METROS: 'MT',
  CM: 'CM', CENTIMETRO: 'CM', CENTIMETROS: 'CM',
  KG: 'KG', KILO: 'KG', KILOS: 'KG',
  G: 'G', GR: 'G', GRAMO: 'G',
  L: 'LT', LTS: 'LT', LITRO: 'LT', LITROS: 'LT',
  ML: 'ML', MILILITRO: 'ML', MILILITROS: 'ML',
  M2: 'M2', M3: 'M3',
  PAQ: 'PAQUETE', PACK: 'PAQUETE',
  PR: 'PAR', PARES: 'PAR',
  VJE: 'VIAJE', VIAJES: 'VIAJE',
  SACO: 'SACO', SACOS: 'SACO',
  BOTE: 'BOTE', BOTES: 'BOTE',
}

const UNIDADES_COMPRA_VALIDAS = new Set([
  'PZA', 'CAJA', 'BULTO', 'ROLLO', 'PAQUETE', 'MT', 'KG', 'LT',
  'TAMBOR', 'CILINDRO', 'CUBETA', 'LATA', 'BOLSA', 'BOTELLA',
  'PAR', 'KIT', 'JUEGO', 'SACO', 'TRAMO', 'DOCENA', 'VIAJE',
])

function normalizarUnidadVenta(valor, esServicio) {
  if (esServicio) return valor || null
  if (valor === null || valor === undefined) return null
  if (typeof valor !== 'string') return null
  const t = valor.trim().toUpperCase()
  if (t === '') return null
  if (UNIDADES_VENTA_VALIDAS.has(t)) return t
  return ALIASES_UNIDAD_VENTA[t] || null
}

function esUnidadVentaValida(valor, esServicio) {
  if (esServicio) return valor === null || valor === undefined
  if (valor === null || valor === undefined) return false
  if (typeof valor !== 'string') return false
  const t = valor.trim().toUpperCase()
  if (t === '') return false
  if (UNIDADES_VENTA_VALIDAS.has(t)) return true
  return t in ALIASES_UNIDAD_VENTA
}

function normalizarUnidadCompra(valor, esServicio) {
  if (esServicio) return valor || null
  if (valor === null || valor === undefined) return null
  if (typeof valor !== 'string') return null
  const t = valor.trim().toUpperCase()
  if (t === '') return null
  if (UNIDADES_COMPRA_VALIDAS.has(t)) return t
  return ALIASES_UNIDAD_VENTA[t] || null
}

// ── Tests ──

describe('P0 — normalizarUnidadVenta', () => {

  it('normaliza valores canónicos', () => {
    assert.equal(normalizarUnidadVenta('PZA', false), 'PZA')
    assert.equal(normalizarUnidadVenta('MT', false), 'MT')
    assert.equal(normalizarUnidadVenta('KG', false), 'KG')
    assert.equal(normalizarUnidadVenta('LT', false), 'LT')
    assert.equal(normalizarUnidadVenta('CAJA', false), 'CAJA')
    assert.equal(normalizarUnidadVenta('ROLLO', false), 'ROLLO')
    assert.equal(normalizarUnidadVenta('BOLSA', false), 'BOLSA')
    assert.equal(normalizarUnidadVenta('BULTO', false), 'BULTO')
    assert.equal(normalizarUnidadVenta('SACO', false), 'SACO')
    assert.equal(normalizarUnidadVenta('BOTE', false), 'BOTE')
    assert.equal(normalizarUnidadVenta('CUBETA', false), 'CUBETA')
    assert.equal(normalizarUnidadVenta('BOTELLA', false), 'BOTELLA')
    assert.equal(normalizarUnidadVenta('LATA', false), 'LATA')
    assert.equal(normalizarUnidadVenta('TAMBOR', false), 'TAMBOR')
    assert.equal(normalizarUnidadVenta('TRAMO', false), 'TRAMO')
    assert.equal(normalizarUnidadVenta('DOCENA', false), 'DOCENA')
    assert.equal(normalizarUnidadVenta('VIAJE', false), 'VIAJE')
    assert.equal(normalizarUnidadVenta('PAR', false), 'PAR')
    assert.equal(normalizarUnidadVenta('KIT', false), 'KIT')
    assert.equal(normalizarUnidadVenta('JUEGO', false), 'JUEGO')
    assert.equal(normalizarUnidadVenta('PAQUETE', false), 'PAQUETE')
    assert.equal(normalizarUnidadVenta('M2', false), 'M2')
    assert.equal(normalizarUnidadVenta('M3', false), 'M3')
    assert.equal(normalizarUnidadVenta('CM', false), 'CM')
    assert.equal(normalizarUnidadVenta('G', false), 'G')
    assert.equal(normalizarUnidadVenta('ML', false), 'ML')
  })

  it('normaliza mayúsculas/minúsculas', () => {
    assert.equal(normalizarUnidadVenta('pza', false), 'PZA')
    assert.equal(normalizarUnidadVenta('Pieza', false), 'PZA')
    assert.equal(normalizarUnidadVenta('metro', false), 'MT')
    assert.equal(normalizarUnidadVenta('kilo', false), 'KG')
  })

  it('resuelve aliases a valor canónico', () => {
    assert.equal(normalizarUnidadVenta('PZ', false), 'PZA')
    assert.equal(normalizarUnidadVenta('PZAS', false), 'PZA')
    assert.equal(normalizarUnidadVenta('PIEZA', false), 'PZA')
    assert.equal(normalizarUnidadVenta('M', false), 'MT')
    assert.equal(normalizarUnidadVenta('MTS', false), 'MT')
    assert.equal(normalizarUnidadVenta('METRO', false), 'MT')
    assert.equal(normalizarUnidadVenta('KILO', false), 'KG')
    assert.equal(normalizarUnidadVenta('L', false), 'LT')
    assert.equal(normalizarUnidadVenta('LTS', false), 'LT')
    assert.equal(normalizarUnidadVenta('LITRO', false), 'LT')
    assert.equal(normalizarUnidadVenta('VJE', false), 'VIAJE')
    assert.equal(normalizarUnidadVenta('PAQ', false), 'PAQUETE')
    assert.equal(normalizarUnidadVenta('PR', false), 'PAR')
    assert.equal(normalizarUnidadVenta('GR', false), 'G')
    assert.equal(normalizarUnidadVenta('KILOS', false), 'KG')
  })

  it('tolera espacios alrededor', () => {
    assert.equal(normalizarUnidadVenta('  PZA  ', false), 'PZA')
    assert.equal(normalizarUnidadVenta(' kg ', false), 'KG')
  })

  it('null para producto físico devuelve null', () => {
    assert.equal(normalizarUnidadVenta(null, false), null)
    assert.equal(normalizarUnidadVenta(undefined, false), null)
  })

  it('string vacío devuelve null', () => {
    assert.equal(normalizarUnidadVenta('', false), null)
    assert.equal(normalizarUnidadVenta('   ', false), null)
  })

  it('unidad desconocida devuelve null', () => {
    assert.equal(normalizarUnidadVenta('INEXISTENTE', false), null)
    assert.equal(normalizarUnidadVenta('XYZ123', false), null)
  })

  it('servicio permite null', () => {
    assert.equal(normalizarUnidadVenta(null, true), null)
    assert.equal(normalizarUnidadVenta(undefined, true), null)
  })

  it('servicio pasa string sin normalizar', () => {
    assert.equal(normalizarUnidadVenta('PZA', true), 'PZA')
    assert.equal(normalizarUnidadVenta('kg', true), 'kg')
  })

  it('número como string no canónico no es válido', () => {
    assert.equal(normalizarUnidadVenta('123', false), null)
  })
})

describe('P0 — esUnidadVentaValida', () => {

  it('valores canónicos son válidos', () => {
    assert.equal(esUnidadVentaValida('PZA', false), true)
    assert.equal(esUnidadVentaValida('KG', false), true)
    assert.equal(esUnidadVentaValida('METRO', false), true)
  })

  it('null/undefined para producto físico es inválido', () => {
    assert.equal(esUnidadVentaValida(null, false), false)
    assert.equal(esUnidadVentaValida(undefined, false), false)
  })

  it('servicio: null/undefined es válido', () => {
    assert.equal(esUnidadVentaValida(null, true), true)
    assert.equal(esUnidadVentaValida(undefined, true), true)
  })

  it('unidad inexistente es inválida', () => {
    assert.equal(esUnidadVentaValida('BANANA', false), false)
  })
})

describe('P0 — normalizarUnidadCompra', () => {

  it('normaliza valores de compra canónicos', () => {
    assert.equal(normalizarUnidadCompra('CAJA', false), 'CAJA')
    assert.equal(normalizarUnidadCompra('CILINDRO', false), 'CILINDRO')
    assert.equal(normalizarUnidadCompra('TAMBOR', false), 'TAMBOR')
    assert.equal(normalizarUnidadCompra('BULTO', false), 'BULTO')
  })

  it('comparte aliases con venta', () => {
    assert.equal(normalizarUnidadCompra('PZ', false), 'PZA')
    assert.equal(normalizarUnidadCompra('kilo', false), 'KG')
  })

  it('null para producto es válido (compra opcional)', () => {
    assert.equal(normalizarUnidadCompra(null, false), null)
  })
})
