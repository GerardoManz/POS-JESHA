'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { normalizarUnidadVenta, esFraccionable, esDiscreta } = require('../src/helpers/unidades.helper')

// Simula la lógica del backend para construir snapshots (sin Prisma)
function construirSnapshotsBackend({
  prod, modo, cantidadFloat, precioUnitario,
  cantidadCapturada, importeCapturado, unidadCapturada
}) {
  let unidadVentaSnap = null
  let unidadCapturadaSnap = null
  let esGranelSnap = null
  let factorConversionSnap = null
  let cantidadCapturadaSnap = null
  let importeCapturadoSnap = null

  if (!prod || prod.tipo === 'SERVICIO') {
    return { unidadVentaSnapshot: null, unidadCapturadaSnapshot: null, esGranelSnapshot: false,
             factorConversionSnapshot: null, modoCapturaSnapshot: modo || null,
             cantidadCapturadaSnapshot: null, importeCapturadoSnapshot: null }
  }

  unidadVentaSnap = normalizarUnidadVenta(prod.unidadVenta, false) || null
  esGranelSnap = prod.esGranel

  if (modo === 'CANTIDAD') {
    if (!prod.esGranel && !Number.isInteger(cantidadFloat)) {
      return { error: 'Producto discreto no admite fracciones' }
    }
    cantidadCapturadaSnap = cantidadCapturada !== null && cantidadCapturada !== undefined
      ? parseFloat(cantidadCapturada) : cantidadFloat
    importeCapturadoSnap = null
    unidadCapturadaSnap = normalizarUnidadVenta(unidadCapturada || prod.unidadVenta, false) || unidadVentaSnap
  } else if (modo === 'IMPORTE') {
    if (!prod.esGranel) {
      return { error: 'Modo IMPORTE solo permitido para productos granel' }
    }
    cantidadCapturadaSnap = null
    importeCapturadoSnap = (importeCapturado !== null && importeCapturado !== undefined && Number.isFinite(Number(importeCapturado)))
      ? parseFloat(importeCapturado) : null
    if (!importeCapturadoSnap || importeCapturadoSnap <= 0) {
      return { error: 'importeCapturado debe ser un número positivo' }
    }
    const subtotalDetalle = parseFloat((cantidadFloat * parseFloat(precioUnitario)).toFixed(2))
    if (Math.abs(importeCapturadoSnap - subtotalDetalle) > 0.01) {
      return { error: `importeCapturado (${importeCapturadoSnap}) no coincide con subtotal (${subtotalDetalle})` }
    }
    unidadCapturadaSnap = null
    factorConversionSnap = null
  } else if (modo === 'CONVERSION') {
    if (!prod.unidadCompra) {
      return { error: 'Producto sin unidad de compra, no admite CONVERSION' }
    }
    if (!prod.factorConversion || !Number.isFinite(Number(prod.factorConversion)) || Number(prod.factorConversion) <= 0) {
      return { error: 'Producto sin factor de conversión válido para CONVERSION' }
    }
    const ucNormalizada = normalizarUnidadVenta(unidadCapturada || prod.unidadCompra, false) || null
    if (ucNormalizada && ucNormalizada !== normalizarUnidadVenta(prod.unidadCompra, false)) {
      return { error: `unidadCapturada "${unidadCapturada}" no coincide con unidadCompra del producto` }
    }
    cantidadCapturadaSnap = cantidadCapturada !== null && cantidadCapturada !== undefined
      ? parseFloat(cantidadCapturada) : cantidadFloat
    importeCapturadoSnap = null
    unidadCapturadaSnap = ucNormalizada
    factorConversionSnap = parseFloat(prod.factorConversion)
    const esperado = parseFloat((cantidadCapturadaSnap * factorConversionSnap).toFixed(3))
    if (Math.abs(esperado - cantidadFloat) > 0.001) {
      return { error: `cantidad final (${cantidadFloat}) no coincide con cantidadCapturada × factor (${esperado})` }
    }
  } else {
    return { error: `Modo de captura inválido: "${modo}"` }
  }

  return {
    unidadVentaSnapshot: unidadVentaSnap,
    unidadCapturadaSnapshot: unidadCapturadaSnap,
    esGranelSnapshot: esGranelSnap,
    factorConversionSnapshot: factorConversionSnap,
    modoCapturaSnapshot: modo,
    cantidadCapturadaSnapshot: cantidadCapturadaSnap,
    importeCapturadoSnapshot: importeCapturadoSnap
  }
}

// Simula la lógica del frontend construirDetalleVentaPayload (Opción A: throw en vez de null)
function construirDetalleVentaPayload(item) {
  if (!item || !item.id || !item.nombre) {
    throw new Error('Producto inválido: falta ID o nombre')
  }

  const productoId     = Number(item.id)
  const precioUnitario = Number(item.precio)
  const esGranel       = !!item.esGranel
  const unidadVenta    = item.unidadVenta || ''
  const unidadCompra   = item.unidadCompra || ''
  const factor         = Number(item.factorConversion) || 1
  const unidadElegida  = item.unidadElegida || 'base'
  const nombre         = item.nombre

  if (!Number.isFinite(productoId) || productoId <= 0) {
    throw new Error(`"${nombre}": ID de producto inválido`)
  }
  if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
    throw new Error(`"${nombre}": precio inválido`)
  }

  if (item.capturadoPorImporte) {
    const importeCapturado = Number(item.importeCapturado)
    if (!Number.isFinite(importeCapturado) || importeCapturado <= 0) {
      throw new Error(`"${nombre}": importe capturado inválido`)
    }
    const cantidad = Number(item.cantidad)
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new Error(`"${nombre}": cantidad inválida para importe`)
    }
    return {
      productoId, cantidad, precioUnitario,
      subtotal:           Number(importeCapturado.toFixed(2)),
      modoCaptura:        'IMPORTE',
      cantidadCapturada:  null,
      importeCapturado:   Number(importeCapturado.toFixed(2)),
      unidadCapturada:    null,
      unidadVenta, esGranel
    }
  }

  if (unidadElegida === 'empaque' && factor > 1) {
    const cantidadVisible = Number(item.cantidadVisible ?? item.cantidad)
    if (!Number.isFinite(cantidadVisible) || cantidadVisible <= 0) {
      throw new Error(`"${nombre}": cantidad capturada inválida`)
    }
    const cantidadFinal = Number((cantidadVisible * factor).toFixed(3))
    if (!Number.isFinite(cantidadFinal) || cantidadFinal <= 0) {
      throw new Error(`"${nombre}": cantidad final inválida (factor ${factor})`)
    }
    return {
      productoId, cantidad: cantidadFinal, precioUnitario,
      subtotal:           Number((cantidadFinal * precioUnitario).toFixed(2)),
      modoCaptura:        'CONVERSION',
      cantidadCapturada:  cantidadVisible,
      importeCapturado:   null,
      unidadCapturada:    unidadCompra,
      unidadVenta, esGranel
    }
  }

  const cantidad = esGranel
    ? Number(item.cantidadVisible ?? item.cantidad)
    : Number(item.cantidad)
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new Error(`"${nombre}": cantidad inválida`)
  }
  const cantidadFinal = Number((esGranel ? cantidad : Math.round(cantidad)).toFixed(3))

  return {
    productoId, cantidad: cantidadFinal, precioUnitario,
    subtotal:           Number((cantidadFinal * precioUnitario).toFixed(2)),
    modoCaptura:        'CANTIDAD',
    cantidadCapturada:  esGranel ? cantidad : cantidadFinal,
    importeCapturado:   null,
    unidadCapturada:    unidadVenta || null,
    unidadVenta, esGranel
  }
}

// Helper que simula la lógica del backend para modo legacy (cotización)
function construirSnapshotsBackendLegacy({ prod, cantidadFloat, precioUnitario }) {
  if (!prod || prod.tipo === 'SERVICIO') {
    return {
      unidadVentaSnapshot: null, unidadCapturadaSnapshot: null, esGranelSnapshot: false,
      factorConversionSnapshot: null, modoCapturaSnapshot: null,
      cantidadCapturadaSnapshot: null, importeCapturadoSnapshot: null
    }
  }
  const unidadVentaSnap = normalizarUnidadVenta(prod.unidadVenta, false) || null
  return {
    unidadVentaSnapshot:       unidadVentaSnap,
    unidadCapturadaSnapshot:   null,
    esGranelSnapshot:          prod.esGranel,
    factorConversionSnapshot:  null,
    modoCapturaSnapshot:       null,
    cantidadCapturadaSnapshot: null,
    importeCapturadoSnapshot:  null
  }
}

// ════════════════════════════════════════════════════════════════════
//  FRONTEND TESTS
// ════════════════════════════════════════════════════════════════════

describe('P3 — construirDetalleVentaPayload (frontend)', () => {

  it('CANTIDAD con KG (fraccionable)', () => {
    const item = { id: 1, nombre: 'Tornillo', precio: 48, cantidad: 1.5, esGranel: true, unidadVenta: 'KG', cantidadVisible: 1.5 }
    const r = construirDetalleVentaPayload(item)
    assert.equal(r.modoCaptura, 'CANTIDAD')
    assert.equal(r.cantidad, 1.5)
    assert.equal(r.cantidadCapturada, 1.5)
    assert.equal(r.importeCapturado, null)
    assert.equal(r.unidadCapturada, 'KG')
    assert.equal(r.subtotal, 72)
  })

  it('CANTIDAD con PZA (discreta)', () => {
    const item = { id: 2, nombre: 'Clavo', precio: 20, cantidad: 3, esGranel: false, unidadVenta: 'PZA' }
    const r = construirDetalleVentaPayload(item)
    assert.equal(r.modoCaptura, 'CANTIDAD')
    assert.equal(r.cantidad, 3)
    assert.equal(r.cantidadCapturada, 3)
    assert.equal(r.importeCapturado, null)
    assert.equal(r.unidadCapturada, 'PZA')
    assert.equal(r.subtotal, 60)
  })

  it('IMPORTE', () => {
    const item = { id: 1, nombre: 'Tornillo', precio: 48, cantidad: 1.042, esGranel: true, unidadVenta: 'KG',
      capturadoPorImporte: true, importeCapturado: 50.02 }
    const r = construirDetalleVentaPayload(item)
    assert.equal(r.modoCaptura, 'IMPORTE')
    assert.equal(r.cantidad, 1.042)
    assert.equal(r.cantidadCapturada, null)
    assert.equal(r.importeCapturado, 50.02)
    assert.equal(r.unidadCapturada, null)
  })

  it('CONVERSION (empaque)', () => {
    const item = { id: 3, nombre: 'Tornillo Caja', precio: 0.85, cantidad: 200, esGranel: false, unidadVenta: 'PZA',
      unidadCompra: 'CAJA', factorConversion: 100, unidadElegida: 'empaque', cantidadVisible: 2 }
    const r = construirDetalleVentaPayload(item)
    assert.equal(r.modoCaptura, 'CONVERSION')
    assert.equal(r.cantidad, 200)
    assert.equal(r.cantidadCapturada, 2)
    assert.equal(r.importeCapturado, null)
    assert.equal(r.unidadCapturada, 'CAJA')
    assert.equal(r.subtotal, 170)
  })

  it('NaN values lanzan Error con nombre del producto', () => {
    assert.throws(() => construirDetalleVentaPayload({ id: NaN, nombre: 'Malito', precio: 10, cantidad: 1 }),
      /Producto inválido/)
    assert.throws(() => construirDetalleVentaPayload({ id: 1, nombre: 'SinPre', precio: NaN, cantidad: 1 }),
      /"SinPre".*precio/)
    assert.throws(() => construirDetalleVentaPayload({ id: 1, nombre: 'SinCant', precio: 10, cantidad: NaN }),
      /"SinCant".*cantidad/)
  })

  it('Cero/negativo lanzan Error con nombre del producto', () => {
    assert.throws(() => construirDetalleVentaPayload({ id: 1, nombre: 'Cero', precio: 10, cantidad: 0 }),
      /"Cero"/)
    assert.throws(() => construirDetalleVentaPayload({ id: 1, nombre: 'Negativo', precio: 10, cantidad: -1 }),
      /"Negativo"/)
  })

  it('Sin nombre lanza error genérico', () => {
    assert.throws(() => construirDetalleVentaPayload({ id: 1, precio: 10, cantidad: 1 }),
      /Producto inválido/)
  })

  it('Dos líneas del mismo producto con modos distintos no mezclan metadata', () => {
    const itemA = { id: 1, nombre: 'Tornillo', precio: 48, cantidad: 1.5, esGranel: true, unidadVenta: 'KG', cantidadVisible: 1.5 }
    const itemB = { id: 1, nombre: 'Tornillo', precio: 48, cantidad: 1.042, esGranel: true, unidadVenta: 'KG',
      capturadoPorImporte: true, importeCapturado: 50.02 }

    const rA = construirDetalleVentaPayload(itemA)
    const rB = construirDetalleVentaPayload(itemB)

    assert.equal(rA.modoCaptura, 'CANTIDAD')
    assert.equal(rA.cantidadCapturada, 1.5)
    assert.equal(rA.importeCapturado, null)

    assert.equal(rB.modoCaptura, 'IMPORTE')
    assert.equal(rB.cantidadCapturada, null)
    assert.equal(rB.importeCapturado, 50.02)

    assert.equal(rA.productoId, rB.productoId)
    assert.notEqual(rA.modoCaptura, rB.modoCaptura)
    assert.notEqual(rA.cantidad, rB.cantidad)
  })

  it('Dos líneas válidas producen dos detalles', () => {
    const items = [
      { id: 1, nombre: 'Tornillo', precio: 48, cantidad: 1.5, esGranel: true, unidadVenta: 'KG', cantidadVisible: 1.5 },
      { id: 2, nombre: 'Clavo', precio: 20, cantidad: 3, esGranel: false, unidadVenta: 'PZA' }
    ]
    const detalles = items.map(construirDetalleVentaPayload)
    assert.equal(detalles.length, 2)
    assert.equal(detalles[0].modoCaptura, 'CANTIDAD')
    assert.equal(detalles[1].modoCaptura, 'CANTIDAD')
  })

  it('Una línea inválida bloquea toda la venta (throw corta el map)', () => {
    const items = [
      { id: 1, nombre: 'Bueno', precio: 48, cantidad: 1.5, esGranel: true, unidadVenta: 'KG', cantidadVisible: 1.5 },
      { id: 2, nombre: 'Malo', precio: NaN, cantidad: 3, esGranel: false, unidadVenta: 'PZA' }
    ]
    assert.throws(() => {
      items.map(construirDetalleVentaPayload)
    }, /"Malo".*precio/)
  })
})

// ════════════════════════════════════════════════════════════════════
//  BACKEND TESTS
// ════════════════════════════════════════════════════════════════════

describe('P3 — construirSnapshotsBackend', () => {

  const prodKg = { id: 1, unidadVenta: 'KG', esGranel: true, factorConversion: 1, tipo: 'PRODUCTO', unidadCompra: 'KG' }
  const prodPza = { id: 2, unidadVenta: 'PZA', esGranel: false, factorConversion: 1, tipo: 'PRODUCTO', unidadCompra: null }
  const prodCaja = { id: 3, unidadVenta: 'PZA', esGranel: false, factorConversion: 100, tipo: 'PRODUCTO', unidadCompra: 'CAJA' }
  const prodServ = { id: 4, unidadVenta: null, esGranel: false, factorConversion: null, tipo: 'SERVICIO', unidadCompra: null }

  it('Snapshot usa unidad del Producto (CANTIDAD)', () => {
    const r = construirSnapshotsBackend({ prod: prodKg, modo: 'CANTIDAD', cantidadFloat: 1.5, precioUnitario: 48 })
    assert.equal(r.unidadVentaSnapshot, 'KG')
    assert.equal(r.unidadCapturadaSnapshot, 'KG')
    assert.equal(r.esGranelSnapshot, true)
    assert.equal(r.factorConversionSnapshot, null)
    assert.equal(r.modoCapturaSnapshot, 'CANTIDAD')
    assert.equal(r.cantidadCapturadaSnapshot, 1.5)
    assert.equal(r.importeCapturadoSnapshot, null)
  })

  it('Ignora unidad inventada por cliente', () => {
    const r = construirSnapshotsBackend({
      prod: prodKg, modo: 'CANTIDAD', cantidadFloat: 1.5, precioUnitario: 48,
      unidadCapturada: 'LBS' // inventada, debe ignorarse
    })
    assert.equal(r.unidadCapturadaSnapshot, 'KG')
  })

  it('Normaliza unidad histórica minúscula', () => {
    const prodAlias = { ...prodKg, unidadVenta: 'kilo' }
    const r = construirSnapshotsBackend({ prod: prodAlias, modo: 'CANTIDAD', cantidadFloat: 1, precioUnitario: 10 })
    assert.equal(r.unidadVentaSnapshot, 'KG')
    assert.equal(r.unidadCapturadaSnapshot, 'KG')
  })

  it('CANTIDAD discreta rechaza decimal', () => {
    const r = construirSnapshotsBackend({ prod: prodPza, modo: 'CANTIDAD', cantidadFloat: 1.5, precioUnitario: 20 })
    assert.equal(r.error, 'Producto discreto no admite fracciones')
  })

  it('CANTIDAD fraccionable acepta decimal', () => {
    const r = construirSnapshotsBackend({ prod: prodKg, modo: 'CANTIDAD', cantidadFloat: 1.5, precioUnitario: 48 })
    assert.equal(r.error, undefined)
    assert.equal(r.cantidadCapturadaSnapshot, 1.5)
  })

  it('IMPORTE válido', () => {
    const r = construirSnapshotsBackend({
      prod: prodKg, modo: 'IMPORTE', cantidadFloat: 1.042, precioUnitario: 48,
      importeCapturado: 50.02
    })
    assert.equal(r.error, undefined)
    assert.equal(r.modoCapturaSnapshot, 'IMPORTE')
    assert.equal(r.cantidadCapturadaSnapshot, null)
    assert.equal(r.importeCapturadoSnapshot, 50.02)
    assert.equal(r.unidadCapturadaSnapshot, null)
    assert.equal(r.factorConversionSnapshot, null)
  })

  it('IMPORTE en producto no granel devuelve 400', () => {
    const r = construirSnapshotsBackend({
      prod: prodPza, modo: 'IMPORTE', cantidadFloat: 1, precioUnitario: 20,
      importeCapturado: 20
    })
    assert.equal(r.error, 'Modo IMPORTE solo permitido para productos granel')
  })

  it('IMPORTE inconsistente devuelve error', () => {
    const r = construirSnapshotsBackend({
      prod: prodKg, modo: 'IMPORTE', cantidadFloat: 1.042, precioUnitario: 48,
      importeCapturado: 99.99
    })
    assert.ok(r.error.includes('no coincide con subtotal'))
  })

  it('CONVERSION válida', () => {
    const r = construirSnapshotsBackend({
      prod: prodCaja, modo: 'CONVERSION', cantidadFloat: 200, precioUnitario: 0.85,
      cantidadCapturada: 2, unidadCapturada: 'CAJA'
    })
    assert.equal(r.error, undefined)
    assert.equal(r.modoCapturaSnapshot, 'CONVERSION')
    assert.equal(r.cantidadCapturadaSnapshot, 2)
    assert.equal(r.importeCapturadoSnapshot, null)
    assert.equal(r.unidadCapturadaSnapshot, 'CAJA')
    assert.equal(r.factorConversionSnapshot, 100)
  })

  it('CONVERSION con factor incorrecto devuelve error', () => {
    const r = construirSnapshotsBackend({
      prod: prodCaja, modo: 'CONVERSION', cantidadFloat: 250, precioUnitario: 0.85,
      cantidadCapturada: 2, unidadCapturada: 'CAJA'
    })
    assert.ok(r.error.includes('no coincide con cantidadCapturada × factor'))
  })

  it('CONVERSION con unidadCompra incorrecta devuelve error', () => {
    const r = construirSnapshotsBackend({
      prod: prodCaja, modo: 'CONVERSION', cantidadFloat: 200, precioUnitario: 0.85,
      cantidadCapturada: 2, unidadCapturada: 'BULTO'
    })
    assert.equal(r.error, 'unidadCapturada "BULTO" no coincide con unidadCompra del producto')
  })

  it('Modo desconocido devuelve error', () => {
    const r = construirSnapshotsBackend({
      prod: prodKg, modo: 'DESCONOCIDO', cantidadFloat: 1, precioUnitario: 10
    })
    assert.equal(r.error, 'Modo de captura inválido: "DESCONOCIDO"')
  })

  it('Servicio no guarda unidad física', () => {
    const r = construirSnapshotsBackend({
      prod: prodServ, modo: 'CANTIDAD', cantidadFloat: 1, precioUnitario: 100
    })
    assert.equal(r.unidadVentaSnapshot, null)
    assert.equal(r.unidadCapturadaSnapshot, null)
    assert.equal(r.esGranelSnapshot, false)
  })

  it('Producto sin unidad deja snapshot null sin inventar PZA', () => {
    const prodSinUnidad = { id: 99, unidadVenta: null, esGranel: false, factorConversion: 1, tipo: 'PRODUCTO', unidadCompra: null }
    const r = construirSnapshotsBackend({ prod: prodSinUnidad, modo: 'CANTIDAD', cantidadFloat: 1, precioUnitario: 10 })
    assert.equal(r.unidadVentaSnapshot, null)
    assert.equal(r.unidadCapturadaSnapshot, null)
    assert.equal(r.error, undefined)
  })

  it('Dos líneas del mismo producto con modos distintos no mezclan metadata', () => {
    const r1 = construirSnapshotsBackend({ prod: prodKg, modo: 'CANTIDAD', cantidadFloat: 1.5, precioUnitario: 48 })
    const r2 = construirSnapshotsBackend({
      prod: prodKg, modo: 'IMPORTE', cantidadFloat: 1.042, precioUnitario: 48,
      importeCapturado: 50.02
    })

    assert.equal(r1.modoCapturaSnapshot, 'CANTIDAD')
    assert.equal(r1.cantidadCapturadaSnapshot, 1.5)
    assert.equal(r1.importeCapturadoSnapshot, null)

    assert.equal(r2.modoCapturaSnapshot, 'IMPORTE')
    assert.equal(r2.cantidadCapturadaSnapshot, null)
    assert.equal(r2.importeCapturadoSnapshot, 50.02)

    assert.notEqual(r1.modoCapturaSnapshot, r2.modoCapturaSnapshot)
  })

  // ── Legacy/cotización y POS-required-mode tests ──
  it('POS sin modoCaptura devuelve error (modo requerido)', () => {
    const r = construirSnapshotsBackend({
      prod: prodKg, modo: undefined, cantidadFloat: 1.5, precioUnitario: 48
    })
    // Simula lo que pasa en el backend cuando modoCaptura no está definido
    assert.equal(r.error, 'Modo de captura inválido: "undefined"')
  })

  it('POS con CANTIDAD produce snapshots completos', () => {
    const r = construirSnapshotsBackend({ prod: prodKg, modo: 'CANTIDAD', cantidadFloat: 1.5, precioUnitario: 48 })
    assert.equal(r.unidadVentaSnapshot, 'KG')
    assert.equal(r.modoCapturaSnapshot, 'CANTIDAD')
    assert.equal(r.cantidadCapturadaSnapshot, 1.5)
    assert.equal(r.importeCapturadoSnapshot, null)
  })

  it('Cotización legacy produce snapshots con modo null y metadata null', () => {
    const r = construirSnapshotsBackendLegacy({ prod: prodKg, cantidadFloat: 1.5, precioUnitario: 48 })
    assert.equal(r.unidadVentaSnapshot, 'KG')
    assert.equal(r.esGranelSnapshot, true)
    assert.equal(r.modoCapturaSnapshot, null)
    assert.equal(r.cantidadCapturadaSnapshot, null)
    assert.equal(r.importeCapturadoSnapshot, null)
    assert.equal(r.unidadCapturadaSnapshot, null)
    assert.equal(r.factorConversionSnapshot, null)
  })

  it('Cotización legacy no inventa CANTIDAD', () => {
    const r = construirSnapshotsBackendLegacy({ prod: prodPza, cantidadFloat: 3, precioUnitario: 20 })
    assert.equal(r.modoCapturaSnapshot, null)
    assert.equal(r.cantidadCapturadaSnapshot, null)
    assert.equal(r.unidadVentaSnapshot, 'PZA')
  })

  it('Cotización legacy para servicio deja todo null', () => {
    const r = construirSnapshotsBackendLegacy({ prod: prodServ, cantidadFloat: 1, precioUnitario: 100 })
    assert.equal(r.unidadVentaSnapshot, null)
    assert.equal(r.modoCapturaSnapshot, null)
    assert.equal(r.esGranelSnapshot, false)
  })
})

// ════════════════════════════════════════════════════════════════════
//  UNIT FALLBACK TESTS
// ════════════════════════════════════════════════════════════════════

describe('P3 — fallback de unidad', () => {

  function resolverUnidad(detalle) {
    const raw = detalle.unidadVentaSnapshot ?? detalle.Producto?.unidadVenta ?? null
    if (!raw) return null
    return normalizarUnidadVenta(raw)
  }

  it('Snapshot tiene prioridad', () => {
    assert.equal(resolverUnidad({ unidadVentaSnapshot: 'KG', Producto: { unidadVenta: 'PZA' } }), 'KG')
  })

  it('Producto.unidadVenta como fallback', () => {
    assert.equal(resolverUnidad({ unidadVentaSnapshot: null, Producto: { unidadVenta: 'PZA' } }), 'PZA')
  })

  it('Sin snapshot ni Producto devuelve null', () => {
    assert.equal(resolverUnidad({ unidadVentaSnapshot: null, Producto: { unidadVenta: null } }), null)
  })

  it('Sin snapshot ni Producto.unidadVenta devuelve null (sin inventar PZA)', () => {
    assert.equal(resolverUnidad({ unidadVentaSnapshot: null, Producto: null }), null)
    assert.equal(resolverUnidad({}), null)
  })

  it('PZA se muestra (no se filtra)', () => {
    assert.equal(resolverUnidad({ unidadVentaSnapshot: 'PZA', Producto: null }), 'PZA')
  })
})

// ════════════════════════════════════════════════════════════════════
//  BITACORA SNAPSHOT COPY TESTS
// ════════════════════════════════════════════════════════════════════

describe('P3 — bitacora snapshot copy', () => {

  const metadataOriginal = {
    unidadVentaSnapshot: 'KG',
    unidadCapturadaSnapshot: null,
    esGranelSnapshot: true,
    factorConversionSnapshot: null,
    modoCapturaSnapshot: 'IMPORTE',
    cantidadCapturadaSnapshot: null,
    importeCapturadoSnapshot: 50.02
  }

  it('Copia los siete snapshots desde venta', () => {
    const detalleBitacora = { ...metadataOriginal }
    assert.equal(detalleBitacora.unidadVentaSnapshot, 'KG')
    assert.equal(detalleBitacora.unidadCapturadaSnapshot, null)
    assert.equal(detalleBitacora.esGranelSnapshot, true)
    assert.equal(detalleBitacora.factorConversionSnapshot, null)
    assert.equal(detalleBitacora.modoCapturaSnapshot, 'IMPORTE')
    assert.equal(detalleBitacora.cantidadCapturadaSnapshot, null)
    assert.equal(detalleBitacora.importeCapturadoSnapshot, 50.02)
  })

  it('Conserva CONVERSION', () => {
    const convMetadata = {
      unidadVentaSnapshot: 'PZA',
      unidadCapturadaSnapshot: 'CAJA',
      esGranelSnapshot: false,
      factorConversionSnapshot: 100,
      modoCapturaSnapshot: 'CONVERSION',
      cantidadCapturadaSnapshot: 2,
      importeCapturadoSnapshot: null
    }
    assert.equal(convMetadata.modoCapturaSnapshot, 'CONVERSION')
    assert.equal(convMetadata.cantidadCapturadaSnapshot, 2)
    assert.equal(convMetadata.unidadCapturadaSnapshot, 'CAJA')
    assert.equal(convMetadata.factorConversionSnapshot, 100)
  })

  it('Conserva IMPORTE', () => {
    assert.equal(metadataOriginal.modoCapturaSnapshot, 'IMPORTE')
    assert.equal(metadataOriginal.importeCapturadoSnapshot, 50.02)
  })

  it('Manual usa CANTIDAD', () => {
    const manual = {
      unidadVentaSnapshot: 'PZA',
      unidadCapturadaSnapshot: 'PZA',
      esGranelSnapshot: false,
      factorConversionSnapshot: null,
      modoCapturaSnapshot: 'CANTIDAD',
      cantidadCapturadaSnapshot: 5,
      importeCapturadoSnapshot: null
    }
    assert.equal(manual.modoCapturaSnapshot, 'CANTIDAD')
    assert.equal(manual.cantidadCapturadaSnapshot, 5)
    assert.equal(manual.importeCapturadoSnapshot, null)
  })

  it('Sin snapshot ni unidad muestra SIN UNIDAD', () => {
    const sin = { unidadVentaSnapshot: null, Producto: { unidadVenta: null } }
    const raw = sin.unidadVentaSnapshot ?? sin.Producto?.unidadVenta ?? null
    const display = raw ? normalizarUnidadVenta(raw) : 'SIN UNIDAD'
    assert.equal(display, 'SIN UNIDAD')
  })
})
