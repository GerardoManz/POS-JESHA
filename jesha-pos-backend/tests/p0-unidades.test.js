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

const { inferirUnidadVenta } = require('../src/modules/productos/importacion.controller')

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

describe('P1-2 — certificación: discos', () => {
  it('disco corte → PZA', () => {
    const r = clasificarProducto({ nombre: 'DISCO CORTE 4 1/2 INDUSTRIAL TRUPER', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('disco desbaste → PZA', () => {
    const r = clasificarProducto({ nombre: 'DISCO DESBASTE 7 180MM TRUPER', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('juego de discos → JUEGO', () => {
    const r = clasificarProducto({ nombre: 'JUEGO 5 DISCOS CORTE 4 1/2', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'JUEGO')
  })
})

describe('P1-2 — certificación: litros (contenido ≠ unidad)', () => {
  it('sellador 1 litro → PZA', () => {
    const r = clasificarProducto({ nombre: 'SELLADOR ADHESIVO 1 LITRO', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('thiner 1 litro → PZA', () => {
    const r = clasificarProducto({ nombre: 'THINER 1 LITRO', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('aceite 5 litros → PZA', () => {
    const r = clasificarProducto({ nombre: 'ACEITE HIDRAULICO 5 LITROS', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('pintura por litro → LT (señal fuerte)', () => {
    const r = clasificarProducto({ nombre: 'PINTURA VINIL VINIMEX POR LITRO', esGranel: true, unidadSat: 'LTR' })
    assert.equal(r.unidadSugerida, 'LT')
  })
})

describe('P1-2 — certificación: metros (dimensión ≠ unidad)', () => {
  it('cable x metro → MT (señal fuerte)', () => {
    const r = clasificarProducto({ nombre: 'CABLE THW-LS 10 CAL X METRO', esGranel: true, unidadSat: 'MTR' })
    assert.equal(r.unidadSugerida, 'MT')
  })
  it('extension eléctrica 10 metros → PZA', () => {
    const r = clasificarProducto({ nombre: 'EXTENSION ELECTRICA 10 METROS', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('manguera jardín 50 metros → PZA', () => {
    const r = clasificarProducto({ nombre: 'MANGUERA DE JARDIN 50 METROS', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('extension lavabo 30 cm → PZA', () => {
    const r = clasificarProducto({ nombre: 'EXTENSION LAVABO FLEXIBLE 30 CM', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
})

describe('P1-2 — certificación: presentación fija', () => {
  it('cable utp rollo → ROLLO', () => {
    const r = clasificarProducto({ nombre: 'CABLE UTP CAT6 ROLLO 305M', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'ROLLO')
  })
  it('tubo tramo → TRAMO', () => {
    const r = clasificarProducto({ nombre: 'TUBO GALVANIZADO 1/2 TRAMO 6M', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'TRAMO')
  })
})

describe('P1-2 — certificación: KG (señal fuerte vs contenido)', () => {
  it('alambre x kg → KG', () => {
    const r = clasificarProducto({ nombre: 'ALAMBRE GALVANIZADO 16 X KG', esGranel: true, unidadSat: 'KGM' })
    assert.equal(r.unidadSugerida, 'KG')
  })
  it('tornillo x kg → KG', () => {
    const r = clasificarProducto({ nombre: 'TORNILLO 1/2 X 3 X KG', esGranel: true, unidadSat: 'KGM' })
    assert.equal(r.unidadSugerida, 'KG')
  })
  it('pegamento 1 kg → PZA (contenido)', () => {
    const r = clasificarProducto({ nombre: 'PEGAMENTO PVC 1 KG', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('kilo de alambre granel+KGM → KG (GRANEL_SAT_AUTORITATIVO)', () => {
    const r = clasificarProducto({ nombre: 'KILO DE ALAMBRE GALVANIZADO', esGranel: true, unidadSat: 'KGM' })
    assert.equal(r.unidadSugerida, 'KG')
    assert.equal(r.regla, 'GRANEL_SAT_AUTORITATIVO')
  })
  it('kilo de alambre sin granel → PZA (conservador)', () => {
    const r = clasificarProducto({ nombre: 'KILO DE ALAMBRE GALVANIZADO', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
})

describe('P1-2 — certificación: falsos positivos corregidos', () => {
  it('desarmador de caja → PZA (excluido)', () => {
    const r = inferirUnidadPorNombre('DESARMADOR DE CAJA PLANO')
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('gato hidráulico de botella → PZA (excluido)', () => {
    const r = inferirUnidadPorNombre('GATO HIDRAULICO DE BOTELLA 2T')
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('boquilla para lata → PZA (excluido)', () => {
    const r = inferirUnidadPorNombre('BOQUILLA PARA LATA SPRAY')
    assert.equal(r.unidadSugerida, 'PZA')
  })
})

describe('P1-2 — certificación: otros', () => {
  it('tijera jardín truper → PZA', () => {
    const r = clasificarProducto({ nombre: 'TIJERA DE JARDIN TRUPER 8', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('broca individual → PZA', () => {
    const r = clasificarProducto({ nombre: 'BROCA PARA MADERA 1/4', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('juego de brocas → JUEGO', () => {
    const r = clasificarProducto({ nombre: 'JUEGO DE BROCAS 13 PZAS', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'JUEGO')
  })
  it('juego 13 brocas → JUEGO (sin "DE")', () => {
    const r = inferirUnidadPorNombre('JUEGO 13 BROCAS')
    assert.equal(r.unidadSugerida, 'JUEGO')
  })
  it('piso sobre piso → PZA', () => {
    const r = clasificarProducto({ nombre: 'PISO SOBRE PISO 30X30 CM', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('martillo → PZA', () => {
    const r = clasificarProducto({ nombre: 'MARTILLO 16 OZ STANLEY', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('caja de herramientas → PZA (excluido, no es empaque)', () => {
    const r = inferirUnidadPorNombre('CAJA DE HERRAMIENTAS TRUPER')
    assert.equal(r.unidadSugerida, 'PZA')
  })
})

describe('S01-S10 — semantic consistency certification', () => {
  it('S01 CAJA DE HERRAMIENTAS → PZA via contextual exclusion', () => {
    const r = inferirUnidadPorNombre('CAJA DE HERRAMIENTAS TRUPER')
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('S02 DESARMADOR DE CAJA → PZA via contextual exclusion', () => {
    const r = inferirUnidadPorNombre('DESARMADOR DE CAJA PLANO')
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('S03 CAJA PARA HERRAMIENTA → PZA via contextual exclusion', () => {
    const r = inferirUnidadPorNombre('CAJA PARA HERRAMIENTA DE 14 PULG')
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('S04 JUEGO 5 DISCOS → JUEGO (standalone JUEGO)', () => {
    const r = inferirUnidadPorNombre('JUEGO 5 DISCOS CORTE 4 1/2')
    assert.equal(r.unidadSugerida, 'JUEGO')
  })
  it('S05 JUEGO DE BROCAS → JUEGO (JUEGO DE pattern)', () => {
    const r = inferirUnidadPorNombre('JUEGO DE BROCAS 13 PZAS')
    assert.equal(r.unidadSugerida, 'JUEGO')
  })
  it('S06 Cable granel+MTR+ROLLO → MT base (granel+SAT override)', () => {
    const r = clasificarProducto({ nombre: 'CABLE THW-LS 10 CAL X METRO', esGranel: true, unidadSat: 'MTR' })
    assert.equal(r.unidadSugerida, 'MT')
  })
  it('S07 Cable no granel ROLLO → ROLLO (presentacion fija, no override)', () => {
    const r = clasificarProducto({ nombre: 'CABLE UTP CAT6 ROLLO 305M', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'ROLLO')
  })
  it('S08 Pintura granel+LTR+CUBETA → LT base (fraccionable wins)', () => {
    const r = clasificarProducto({ nombre: 'PINTURA VINIL VINIMEX POR LITRO', esGranel: true, unidadSat: 'LTR' })
    assert.equal(r.unidadSugerida, 'LT')
  })
  it('S09 Sellador 1 LITRO H87 no granel → PZA (contenido, no unidad)', () => {
    const r = clasificarProducto({ nombre: 'SELLADOR ADHESIVO 1 LITRO', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('S10 Tornillo PZA + CAJA → base PZA preserved (H87 override)', () => {
    const r = clasificarProducto({ nombre: 'TORNILLO 1/2 X 3', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
})

describe('A01-A08 — air duster / aerosol certification', () => {
  it('A01 aire comprimido removedor de polvo → PZA', () => {
    const r = clasificarProducto({ nombre: 'AIRE COMPRIMIDO REMOVEDOR DE POLVO', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('A02 aire comprimido 400 ML → PZA (ML is content, not unit)', () => {
    const r = clasificarProducto({ nombre: 'AIRE COMPRIMIDO 400 ML', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('A03 removedor de polvo 660 ML → PZA', () => {
    const r = clasificarProducto({ nombre: 'REMOVEDOR DE POLVO 660 ML', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('A04 aerosol 400 ML → PZA', () => {
    const r = clasificarProducto({ nombre: 'AIRE COMPRIMIDO EN AEROSOL 400 ML', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('A05 removedor en lata 10 OZ → PZA (H87 override wins over LATA)', () => {
    const r = clasificarProducto({ nombre: 'REMOVEDOR DE POLVO EN LATA 10 OZ', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('A06 bote aire comprimido 400 ML → PZA (H87 override wins over BOTE)', () => {
    const r = clasificarProducto({ nombre: 'BOTE AIRE COMPRIMIDO 400 ML', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('A07 removedor de polvo 300 G → PZA (G is content, not unit)', () => {
    const r = clasificarProducto({ nombre: 'REMOVEDOR DE POLVO 300 G', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('A08 aerosol caaja 12 pzas → PZA (H87 override wins over CAJA)', () => {
    const r = clasificarProducto({ nombre: 'AIRE COMPRIMIDO CAJA 12 PZAS', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
})

describe('ADVERSARIAL — random combinations (seeded, 100+ cases)', () => {
  // Deterministic PRNG (mulberry32) for reproducibility
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const rng = mulberry32(20260910) // fixed seed: 2026-09-10

  function pick(arr) { return arr[Math.floor(rng() * arr.length)] }
  function maybe(fn, prob) { return rng() < prob ? fn() : '' }

  const BASE_PRODUCTS = [
    'AIRE COMPRIMIDO', 'REMOVEDOR DE POLVO', 'SELLADOR', 'PEGAMENTO',
    'LUBRICANTE', 'EXTENSION ELECTRICA', 'MANGUERA', 'GATO HIDRAULICO',
    'LIMPIADOR', 'PINTURA EN AEROSOL', 'DESENGRASANTE', 'SILICONA',
    'THINER', 'ACEITE', 'FILTRO', 'TORNILLO', 'CLAVO', 'TARUGO',
    'CUÑA', 'DISCO', 'BROCA', 'FLASCO', 'SPRAY',
  ]

  const CONTENTS = [
    '250 ML', '400 ML', '660 ML', '1 LITRO', '5 LITROS', '2.5 L',
    '250 G', '300 G', '500 G', '1 KG', '2 KG',
    '10 OZ', '12 OZ', '16 OZ',
    '5 METROS', '10 METROS', '15 M', '30 CM', '12 PULG', '1/2 PULG',
    '750 ML', '100 ML', '200 ML', '330 ML',
  ]

  const CONTAINERS = [
    'LATA', 'BOTE', 'BOTELLA', 'AEROSOL', 'ENVASE', 'TUBO',
    'FRASCO', 'CILINDRO', 'CUBETA', 'GALON', 'GARRAFA',
  ]

  const CONTAINER_PHRASES = [
    'EN LATA', 'EN BOTE', 'EN BOTELLA', 'EN AEROSOL', 'EN ENVASE',
    'TIPO BOTELLA', 'TIPO LATA', 'CON AEROSOL', 'DE BOTELLA',
  ]

  const PREFIXES = [
    'MARCA', 'PRO', 'MAX', 'ULTRA', 'PLUS', 'SUPER', 'TOP', 'PREMIUM',
  ]

  const SUFFIXES = [
    'INDUSTRIAL', 'PROFESIONAL', 'MULTIUSOS', 'ESPECIAL', 'FORMULA AVANZADA',
    'DE ALTA RESISTENCIA', 'PARA USO GENERAL', 'CON PROTECCION',
  ]

  const STRONG_SIGNALS = [
    'X METRO', 'POR METRO', 'X KG', 'POR KG', 'POR LITRO', 'X LITRO',
    'X KILO', 'POR KILO', 'X CM', 'POR CM',
  ]

  // Strong-signal products: these SHOULD produce non-PZA units
  const STRONG_SIGNAL_PRODUCTS = []
  for (let i = 0; i < 20; i++) {
    const prod = pick(BASE_PRODUCTS)
    const signal = pick(STRONG_SIGNALS)
    STRONG_SIGNAL_PRODUCTS.push(`${prod} ${signal}`)
  }

  // Neutral products: content/descriptors that should stay PZA
  const NEUTRAL_PRODUCTS = []
  for (let i = 0; i < 80; i++) {
    const prod = pick(BASE_PRODUCTS)
    const parts = [prod]

    // Maybe add container
    if (rng() < 0.4) parts.push(pick(rng() < 0.5 ? CONTAINERS : CONTAINER_PHRASES))

    // Maybe add content/measure
    if (rng() < 0.7) parts.push(pick(CONTENTS))

    // Maybe add prefix
    if (rng() < 0.2) parts.unshift(pick(PREFIXES))

    // Maybe add suffix
    if (rng() < 0.2) parts.push(pick(SUFFIXES))

    // Maybe add random number
    if (rng() < 0.15) parts.splice(1 + Math.floor(rng() * (parts.length - 1)), 0, String(Math.floor(rng() * 999) + 1))

    // Maybe add double spaces
    let name = parts.join(' ')
    if (rng() < 0.2) name = name.replace(/ /g, '  ')

    // Maybe lowercase
    if (rng() < 0.15) name = name.toLowerCase()

    // Maybe add trailing junk
    if (rng() < 0.1) name += ` [${Math.floor(rng() * 999)}]`

    NEUTRAL_PRODUCTS.push(name)
  }

  const ALL_CASES = [
    ...STRONG_SIGNAL_PRODUCTS.map(n => ({ nombre: n, esGranel: false, unidadSat: 'H87', expected: null, type: 'STRONG' })),
    ...NEUTRAL_PRODUCTS.map(n => ({ nombre: n, esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'NEUTRAL' })),
  ]

  // Also add fixed adversarial edge cases
  const FIXED_CASES = [
    { nombre: 'AIRE COMPRIMIDO  400  ML', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'removedor de polvo 660ml', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'sellador - botella 1 litro', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'lubricante en lata 300 g industrial', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'PEGAMENTO  TIPO  BOTELLA  250  ML  PRO', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'MANGUERA JARDIN 15 M [42]', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'gato hidraulico tipo botella 2 ton', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'LIMPIADOR EN AEROSOL 10 OZ MAX', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'PINTURA EN AEROSOL 400 ML RAPIDO', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'EXTENSION  ELECTRICA  10  METROS', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'thiner 1 litro', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'aceite hidraulico 5 litros', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'desengrasante aerosol 250 ml', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'silicona spray 330 ml', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
    { nombre: 'filtro de aire 12 oz', esGranel: false, unidadSat: 'H87', expected: 'PZA', type: 'FIXED' },
  ]

  const ALL = [...FIXED_CASES, ...ALL_CASES]

  const FRACTIONAL_UNITS = new Set(['ML', 'LT', 'KG', 'G', 'MT', 'CM', 'M2', 'M3', 'MLT', 'LTR', 'KGM', 'MTR', 'MMT', 'GRM'])
  const PACKAGING_UNITS = new Set(['LATA', 'BOTE', 'BOTELLA', 'AEROSOL', 'ENVASE', 'TUBO', 'FRASCO', 'CILINDRO', 'CUBETA', 'GALON', 'GARRAFA'])

  let pass = 0, fail = 0, falseFractional = 0, falsePackaging = 0
  const failures = []

  for (const tc of ALL) {
    const r = clasificarProducto(tc)

    if (tc.type === 'STRONG') {
      // Strong signals should produce a non-PZA fractional unit
      if (r.unidadSugerida === 'PZA') {
        failures.push({ input: tc.nombre, expected: 'fractional', got: r.unidadSugerida, rule: r.regla })
        fail++
      } else {
        pass++
      }
    } else {
      // Neutral/fixed: should be PZA
      if (r.unidadSugerida !== 'PZA') {
        const isFractional = FRACTIONAL_UNITS.has(r.unidadSugerida)
        const isPackaging = PACKAGING_UNITS.has(r.unidadSugerida)
        if (isFractional) falseFractional++
        if (isPackaging) falsePackaging++
        failures.push({ input: tc.nombre, expected: 'PZA', got: r.unidadSugerida, rule: r.regla })
        fail++
      } else {
        pass++
      }
    }
  }

  it(`generates ${ALL.length} cases (>=100 required)`, () => {
    assert.ok(ALL.length >= 100, `Expected >=100 cases, got ${ALL.length}`)
  })

  it(`all neutral/fixed cases produce PZA (0 false packaging/fractional)`, () => {
    const neutralFixed = ALL.filter(c => c.type !== 'STRONG')
    const fails = []
    for (const tc of neutralFixed) {
      const r = clasificarProducto(tc)
      if (r.unidadSugerida !== 'PZA') {
        fails.push(`"${tc.nombre}" → ${r.unidadSugerida} (${r.regla})`)
      }
    }
    assert.equal(fails.length, 0,
      `${fails.length} false positives:\n${fails.join('\n')}`)
  })

  it(`all strong-signal cases produce non-PZA fractional unit`, () => {
    const fails = []
    for (const tc of STRONG_SIGNAL_PRODUCTS) {
      const r = clasificarProducto({ nombre: tc, esGranel: false, unidadSat: 'H87' })
      if (r.unidadSugerida === 'PZA') {
        fails.push(`"${tc}" → PZA (${r.regla})`)
      }
    }
    assert.equal(fails.length, 0,
      `${fails.length} strong signals incorrectly → PZA:\n${fails.join('\n')}`)
  })

  it(`zero false fractional units in neutral/fixed cases`, () => {
    const neutralFixed = ALL.filter(c => c.type !== 'STRONG')
    let count = 0
    for (const tc of neutralFixed) {
      const r = clasificarProducto(tc)
      if (FRACTIONAL_UNITS.has(r.unidadSugerida)) count++
    }
    assert.equal(count, 0, `${count} false fractional units found`)
  })

  it(`zero false packaging units in neutral/fixed cases`, () => {
    const neutralFixed = ALL.filter(c => c.type !== 'STRONG')
    let count = 0
    for (const tc of neutralFixed) {
      const r = clasificarProducto(tc)
      if (PACKAGING_UNITS.has(r.unidadSugerida)) count++
    }
    assert.equal(count, 0, `${count} false packaging units found`)
  })
})

describe('B01-B12 — bidirectional packaging gate (positive controls)', () => {
  it('B01 explicit CAJA import → CAJA preserved', () => {
    const r = inferirUnidadVenta('PRODUCTO TEST', false, 'CAJA', null)
    assert.equal(r, 'CAJA')
  })
  it('B02 explicit BOLSA import → BOLSA preserved', () => {
    const r = inferirUnidadVenta('PRODUCTO TEST', false, 'BOLSA', null)
    assert.equal(r, 'BOLSA')
  })
  it('B03 explicit ROLLO import → ROLLO preserved', () => {
    const r = inferirUnidadVenta('PRODUCTO TEST', false, 'ROLLO', null)
    assert.equal(r, 'ROLLO')
  })
  it('B04 explicit SACO import → SACO preserved', () => {
    const r = inferirUnidadVenta('PRODUCTO TEST', false, 'SACO', null)
    assert.equal(r, 'SACO')
  })
  it('B05 granel ROLLO DE LIJA → ROLLO (granel overrides conservative)', () => {
    const r = clasificarProducto({ nombre: 'ROLLO DE LIJA J-86 GRANO 120', esGranel: true, unidadSat: 'KGM' })
    assert.equal(r.unidadSugerida, 'ROLLO')
  })
  it('B06 granel ARENA POR BOTE → BOTE (granel overrides conservative)', () => {
    const r = clasificarProducto({ nombre: 'ARENA POR BOTE', esGranel: true, unidadSat: 'MTQ' })
    assert.equal(r.unidadSugerida, 'BOTE')
  })
  it('B07 multipresentation PZA+CAJA factor=12 → base is PZA', () => {
    const r = clasificarProducto({ nombre: 'CLAVO 1/2 X 1', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('B08 negative: CAJA DE HERRAMIENTAS no-granel → PZA', () => {
    const r = clasificarProducto({ nombre: 'CAJA DE HERRAMIENTAS TRUPER', esGranel: false, unidadSat: 'H87' })
    assert.equal(r.unidadSugerida, 'PZA')
  })
  it('B09 negative: BOTE AIRE COMPRIMIDO no-metadata → PZA', () => {
    const r = inferirUnidadVenta('BOTE AIRE COMPRIMIDO 400 ML', false, '', null)
    assert.equal(r, 'PZA')
  })
  it('B10 negative: LATA DE PINTURA no-metadata → PZA', () => {
    const r = inferirUnidadVenta('LATA DE PINTURA 400 ML', false, '', null)
    assert.equal(r, 'PZA')
  })
  it('B11 granel PINTURA POR LITRO → LT (strong signal wins)', () => {
    const r = clasificarProducto({ nombre: 'PINTURA POR LITRO', esGranel: true, unidadSat: 'LTR' })
    assert.equal(r.unidadSugerida, 'LT')
  })
  it('B12 granel CABLE X METRO → MT (strong signal wins)', () => {
    const r = clasificarProducto({ nombre: 'CABLE X METRO', esGranel: true, unidadSat: 'MTR' })
    assert.equal(r.unidadSugerida, 'MT')
  })
})
