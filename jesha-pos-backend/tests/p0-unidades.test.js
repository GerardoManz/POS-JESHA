'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  normalizarUnidadVenta,
  normalizarUnidadCompra,
  esUnidadVentaValida,
  esUnidadCompraValida,
  esFraccionable,
  esDiscreta,
  obtenerLabelUnidadVenta,
  obtenerUnidadSat,
  inferirUnidadPorNombre,
  clasificarProducto,
} = require('../src/helpers/unidades.helper')

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

  it('servicio normaliza string igual que producto', () => {
    assert.equal(normalizarUnidadVenta('PZA', true), 'PZA')
    assert.equal(normalizarUnidadVenta('kg', true), 'KG')
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

// ── P1: Clasificación ──

describe('P1 — esFraccionable / esDiscreta', () => {

  it('fraccionable: MT, KG, LT, M2, M3, CM, G, ML', () => {
    assert.equal(esFraccionable('MT'), true)
    assert.equal(esFraccionable('KG'), true)
    assert.equal(esFraccionable('LT'), true)
    assert.equal(esFraccionable('M2'), true)
    assert.equal(esFraccionable('M3'), true)
    assert.equal(esFraccionable('CM'), true)
    assert.equal(esFraccionable('G'), true)
    assert.equal(esFraccionable('ML'), true)
  })

  it('fraccionable con alias', () => {
    assert.equal(esFraccionable('KILO'), true)
    assert.equal(esFraccionable('METRO'), true)
    assert.equal(esFraccionable('m'), true)
  })

  it('discreta: PZA, CAJA, ROLLO, BOLSA, etc.', () => {
    assert.equal(esDiscreta('PZA'), true)
    assert.equal(esDiscreta('CAJA'), true)
    assert.equal(esDiscreta('ROLLO'), true)
    assert.equal(esDiscreta('BOLSA'), true)
    assert.equal(esDiscreta('BULTO'), true)
    assert.equal(esDiscreta('SACO'), true)
    assert.equal(esDiscreta('BOTE'), true)
    assert.equal(esDiscreta('CUBETA'), true)
    assert.equal(esDiscreta('BOTELLA'), true)
    assert.equal(esDiscreta('LATA'), true)
    assert.equal(esDiscreta('TAMBOR'), true)
    assert.equal(esDiscreta('TRAMO'), true)
    assert.equal(esDiscreta('DOCENA'), true)
    assert.equal(esDiscreta('VIAJE'), true)
    assert.equal(esDiscreta('PAR'), true)
    assert.equal(esDiscreta('KIT'), true)
    assert.equal(esDiscreta('JUEGO'), true)
    assert.equal(esDiscreta('PAQUETE'), true)
  })

  it('PZA no es fraccionable', () => {
    assert.equal(esFraccionable('PZA'), false)
  })

  it('KG no es discreta', () => {
    assert.equal(esDiscreta('KG'), false)
  })

  it('null/undefined no es nada', () => {
    assert.equal(esFraccionable(null), false)
    assert.equal(esDiscreta(undefined), false)
  })
})

describe('P1 — obtenerLabelUnidadVenta', () => {

  it('labels canónicos', () => {
    assert.equal(obtenerLabelUnidadVenta('PZA'), 'pza')
    assert.equal(obtenerLabelUnidadVenta('MT'), 'm')
    assert.equal(obtenerLabelUnidadVenta('KG'), 'kg')
    assert.equal(obtenerLabelUnidadVenta('LT'), 'L')
    assert.equal(obtenerLabelUnidadVenta('M2'), 'm²')
    assert.equal(obtenerLabelUnidadVenta('M3'), 'm³')
  })

  it('label desde alias', () => {
    assert.equal(obtenerLabelUnidadVenta('KILO'), 'kg')
    assert.equal(obtenerLabelUnidadVenta('m'), 'm')
  })

  it('valor desconocido se devuelve tal cual', () => {
    assert.equal(obtenerLabelUnidadVenta('INVENTADO'), 'INVENTADO')
  })

  it('null devuelve string vacío', () => {
    assert.equal(obtenerLabelUnidadVenta(null), '')
  })
})

describe('P1 — obtenerUnidadSat', () => {

  it('retorna unidad SAT correcta', () => {
    assert.equal(obtenerUnidadSat('PZA'), 'H87')
    assert.equal(obtenerUnidadSat('MT'), 'MTR')
    assert.equal(obtenerUnidadSat('KG'), 'KGM')
    assert.equal(obtenerUnidadSat('LT'), 'LTR')
    assert.equal(obtenerUnidadSat('M2'), 'MTK')
    assert.equal(obtenerUnidadSat('M3'), 'MTQ')
    assert.equal(obtenerUnidadSat('CAJA'), 'XBX')
    assert.equal(obtenerUnidadSat('ROLLO'), 'XRO')
  })

  it('null devuelve null', () => {
    assert.equal(obtenerUnidadSat(null), null)
  })
})

describe('P1 — inferirUnidadPorNombre', () => {

  it('presentación fija: BOLSA', () => {
    const r = inferirUnidadPorNombre('BOLSA CON 100 PIJAS 6X1')
    assert.equal(r.unidadSugerida, 'BOLSA')
    assert.equal(r.regla, 'PRESENTACION_FIJA')
    assert.equal(r.confianza, 'ALTA')
  })

  it('presentación fija: CAJA', () => {
    const r = inferirUnidadPorNombre('CAJA DE CLAVOS 2 PULG')
    assert.equal(r.unidadSugerida, 'CAJA')
    assert.equal(r.confianza, 'ALTA')
  })

  it('presentación fija: ROLLO', () => {
    const r = inferirUnidadPorNombre('ROLLO POLIDUCTO NARANJA 1/2 100MT')
    assert.equal(r.unidadSugerida, 'ROLLO')
  })

  it('presentación fija: KIT', () => {
    const r = inferirUnidadPorNombre('KIT DE CONEXIONES SECADORA')
    assert.equal(r.unidadSugerida, 'KIT')
  })

  it('presentación fija: BULTO', () => {
    const r = inferirUnidadPorNombre('BULTO DE CEMENTO 50KG')
    assert.equal(r.unidadSugerida, 'BULTO')
  })

  it('fraccionable: X KG', () => {
    const r = inferirUnidadPorNombre('CLAVO 2 PULG X KG')
    assert.equal(r.unidadSugerida, 'KG')
    assert.equal(r.regla, 'FRACCIONABLE')
    assert.equal(r.confianza, 'ALTA')
  })

  it('fraccionable: POR METRO', () => {
    const r = inferirUnidadPorNombre('CABLE THW-LS 10 CAL X METRO')
    assert.equal(r.unidadSugerida, 'MT')
  })

  it('fraccionable: POR LITRO', () => {
    const r = inferirUnidadPorNombre('PINTURA VINIL VINIMEX POR LITRO')
    assert.equal(r.unidadSugerida, 'LT')
  })

  it('PZA_PROBABLE para producto físico sin patrón', () => {
    const r = inferirUnidadPorNombre('MARTILLO 16 OZ')
    assert.equal(r.unidadSugerida, 'PZA')
    assert.equal(r.regla, 'PZA_PROBABLE')
    assert.equal(r.confianza, 'PROBABLE')
  })

  it('PZA_PROBABLE para ferretería fina', () => {
    const r = inferirUnidadPorNombre('TUERCA 1/4')
    assert.equal(r.unidadSugerida, 'PZA')
    assert.equal(r.regla, 'PZA_PROBABLE')
  })

  it('sin nombre devuelve SIN_NOMBRE', () => {
    const r = inferirUnidadPorNombre(null)
    assert.equal(r.regla, 'SIN_NOMBRE')
    assert.equal(r.unidadSugerida, null)
  })
})

describe('P1 — clasificarProducto', () => {

  it('PZA_PROBABLE + unidadSat=H87 → PZA con confianza MEDIA', () => {
    const r = clasificarProducto({ nombre: 'MARTILLO 16 OZ', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
    assert.equal(r.confianza, 'MEDIA')
    assert.equal(r.regla, 'PZA_SAT_H87')
  })

  it('presentación fija no se modifica por unidadSat', () => {
    const r = clasificarProducto({ nombre: 'BOLSA CON 100 PIJAS', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'BOLSA')
  })

  it('unidadSat divergente genera advertencia', () => {
    const r = clasificarProducto({ nombre: 'MARTILLO 16 OZ', esGranel: false, unidadSat: 'KGM' })
    assert.equal(r.unidadSugerida, 'PZA')
    assert.ok(r.advertencias.length > 0)
  })
})
