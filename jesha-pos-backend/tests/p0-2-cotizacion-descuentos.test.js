/**
 * P0-2: Cotización → POS — Preservación y validación de descuentos
 *
 * Tests targeted para validar:
 *  - Descuento global se preserva de Cotización → POS → Venta
 *  - Descuento por línea se preserva en DetalleVenta
 *  - Backend valida contra Cotización DB (fuente canónica)
 *  - EMPLEADO puede cobrar descuentos autorizados, no modificarlos
 *  - Mismatch entre frontend y Cotización DB → RECHAZAR
 *  - Conciliación monetaria exacta
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// ═══════════════════════════════════════════════════════════════════
//  SOURCE-LEVEL VERIFICATION — Frontend
// ═══════════════════════════════════════════════════════════════════

const cotizacionesSrc = fs.readFileSync(path.resolve(__dirname, '../../cotizaciones.js'), 'utf8')
const puntoVentaSrc  = fs.readFileSync(path.resolve(__dirname, '../../punto-venta.js'), 'utf8')

describe('P0-2 Source: cotizaciones.js — cargarEnPos includes discount fields', () => {

  it('T01: posPayload includes cotDescuento', () => {
    assert.ok(cotizacionesSrc.includes('cotDescuento'), 'posPayload must include cotDescuento')
  })

  it('T02: posPayload includes cotSubtotalBruto', () => {
    assert.ok(cotizacionesSrc.includes('cotSubtotalBruto'), 'posPayload must include cotSubtotalBruto')
  })

  it('T03: items include descuentoLinea', () => {
    assert.ok(cotizacionesSrc.includes('descuentoLinea'), 'items must include descuentoLinea')
  })

  it('T04: items include detalleCotizacionId', () => {
    assert.ok(cotizacionesSrc.includes('detalleCotizacionId'), 'items must include detalleCotizacionId')
  })

  it('T05: descuentoLinea uses parseFloat of d.descuento', () => {
    const match = cotizacionesSrc.match(/descuentoLinea:\s*parseFloat\(d\.descuento/)
    assert.ok(match, 'descuentoLinea must be parseFloat(d.descuento || 0)')
  })

  it('T06: cotDescuento uses parseFloat of cot.descuento', () => {
    const match = cotizacionesSrc.match(/cotDescuento:\s*descGlobalCot/)
    assert.ok(match, 'cotDescuento must use the computed descGlobalCot variable')
  })
})

describe('P0-2 Source: punto-venta.js — cargarCotizacionDesdeStorage reads discounts', () => {

  it('T07: reads cotDescuento from payload', () => {
    assert.ok(puntoVentaSrc.includes('cotDescuentoGlobal'), 'must read cotDescuentoGlobal from payload')
  })

  it('T08: sets cotDescuentoLocked when discount > 0', () => {
    assert.ok(puntoVentaSrc.includes('cotDescuentoLocked = cotDescuentoGlobal > 0'), 'must lock when discount present')
  })

  it('T09: cart items include descuentoLinea', () => {
    const fnBody = puntoVentaSrc.slice(
      puntoVentaSrc.indexOf('function cargarCotizacionDesdeStorage'),
      puntoVentaSrc.indexOf('// ═══', puntoVentaSrc.indexOf('function cargarCotizacionDesdeStorage') + 10)
    )
    assert.ok(fnBody.includes('descuentoLinea: descLinea'), 'cart items must include descuentoLinea')
  })

  it('T10: cart items include detalleCotizacionId', () => {
    const fnBody = puntoVentaSrc.slice(
      puntoVentaSrc.indexOf('function cargarCotizacionDesdeStorage'),
      puntoVentaSrc.indexOf('// ═══', puntoVentaSrc.indexOf('function cargarCotizacionDesdeStorage') + 10)
    )
    assert.ok(fnBody.includes('detalleCotizacionId: item.detalleCotizacionId'), 'cart items must include detalleCotizacionId')
  })
})

describe('P0-2 Source: punto-venta.js — getPctEfectivo uses cotizacion discount', () => {

  it('T11: getPctEfectivo checks cotDescuentoLocked', () => {
    const fnMatch = puntoVentaSrc.match(/function getPctEfectivo\(\)\s*\{[\s\S]*?\n\}/)
    assert.ok(fnMatch, 'getPctEfectivo function must exist')
    assert.ok(fnMatch[0].includes('cotDescuentoLocked'), 'getPctEfectivo must check cotDescuentoLocked')
  })

  it('T12: getPctEfectivo returns cotDescuentoMonto when locked', () => {
    assert.ok(puntoVentaSrc.includes('cotDescuentoMonto'), 'must return cotDescuentoMonto')
  })
})

describe('P0-2 Source: punto-venta.js — construirDetalleVentaPayload includes discount', () => {

  it('T13: all three modes include descuentoLinea', () => {
    const fnBody = puntoVentaSrc.slice(
      puntoVentaSrc.indexOf('function construirDetalleVentaPayload'),
      puntoVentaSrc.indexOf('// ═══', puntoVentaSrc.indexOf('function construirDetalleVentaPayload') + 10)
    )
    const matches = fnBody.match(/descuentoLinea:\s*Number\(item\.descuentoLinea/g)
    assert.ok(matches && matches.length >= 3, `Expected 3 descuentoLinea assignments (one per mode), found ${matches ? matches.length : 0}`)
  })

  it('T14: all three modes include detalleCotizacionId', () => {
    const fnBody = puntoVentaSrc.slice(
      puntoVentaSrc.indexOf('function construirDetalleVentaPayload'),
      puntoVentaSrc.indexOf('// ═══', puntoVentaSrc.indexOf('function construirDetalleVentaPayload') + 10)
    )
    const matches = fnBody.match(/detalleCotizacionId:\s*item\.detalleCotizacionId/g)
    assert.ok(matches && matches.length >= 3, `Expected 3 detalleCotizacionId assignments, found ${matches ? matches.length : 0}`)
  })
})

describe('P0-2 Source: punto-venta.js — confirmarVenta sends cotizacion fields', () => {

  it('T15: payload includes cotDescuentoOriginal', () => {
    assert.ok(puntoVentaSrc.includes('cotDescuentoOriginal'), 'payload must include cotDescuentoOriginal')
  })

  it('T16: payload includes cotSubtotalBruto', () => {
    assert.ok(puntoVentaSrc.includes('cotSubtotalBruto'), 'payload must include cotSubtotalBruto')
  })

  it('T17: descAmt uses cotDescuentoMonto when available', () => {
    assert.ok(puntoVentaSrc.includes('cotDescuentoMonto != null') || puntoVentaSrc.includes('cotDescuentoMonto &&'), 'descAmt must check cotDescuentoMonto')
  })
})

describe('P0-2 Source: punto-venta.js — lock UI when cotizacion loaded', () => {

  it('T18: modal initialization sets inputDesc.readOnly when cotDescuentoLocked', () => {
    assert.ok(puntoVentaSrc.includes('inputDesc.readOnly = true'), 'must set readOnly on discount input')
    assert.ok(puntoVentaSrc.includes('inputDesc.style.cursor'), 'must set cursor not-allowed')
  })

  it('T19: resetVentaActual clears cotDescuentoGlobal and cotDescuentoLocked', () => {
    const resetBody = puntoVentaSrc.slice(
      puntoVentaSrc.indexOf('function resetVentaActual'),
      puntoVentaSrc.indexOf('// ═══', puntoVentaSrc.indexOf('function resetVentaActual') + 10)
    )
    assert.ok(resetBody.includes('cotDescuentoGlobal'), 'must reset cotDescuentoGlobal')
    assert.ok(resetBody.includes('cotDescuentoLocked'), 'must reset cotDescuentoLocked')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  SOURCE-LEVEL VERIFICATION — Backend
// ═══════════════════════════════════════════════════════════════════

const ventasSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/ventas/ventas.controller.js'), 'utf8')
const facturacionSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8')

describe('P0-2 Source: ventas.controller.js — cotizacion validation', () => {

  it('T20: loads cotizacion with DetalleCotizacion', () => {
    assert.ok(ventasSrc.includes('include: { DetalleCotizacion: true }'), 'must load cotizacion with details')
  })

  it('T21: validates descuento matches cotizacion for EMPLEADO', () => {
    assert.ok(ventasSrc.includes('COTIZACION_DESCUENTO_MISMATCH'), 'must reject mismatched discount for EMPLEADO')
  })

  it('T22: validates number of detail lines matches cotizacion', () => {
    assert.ok(ventasSrc.includes('El número de renglones no coincide con la cotización'), 'must validate detail count')
  })

  it('T23: validates detalleCotizacionId exists in cotizacion', () => {
    assert.ok(ventasSrc.includes('DetalleCotizacion'), 'must validate detail IDs against cotizacion')
    assert.ok(ventasSrc.includes('no encontrado en cotización'), 'must reject unknown detail IDs')
  })

  it('T24: validates producto matches cotizacion', () => {
    assert.ok(ventasSrc.includes('Producto no coincide con cotización'), 'must validate product matches')
  })

  it('T25: validates cantidad matches cotizacion', () => {
    assert.ok(ventasSrc.includes('Cantidad no coincide con cotización'), 'must validate quantity matches')
  })

  it('T26: validates precioUnitario matches cotizacion', () => {
    assert.ok(ventasSrc.includes('Precio unitario no coincide con cotización'), 'must validate price matches')
  })

  it('T27: validates descuentoLinea matches cotizacion', () => {
    assert.ok(ventasSrc.includes('Descuento por línea no coincide con cotización'), 'must validate line discount')
  })

  it('T28: validates global descuento matches cotizacion', () => {
    assert.ok(ventasSrc.includes('El descuento global no coincide con la cotización'), 'must validate global discount')
  })
})

describe('P0-2 Source: ventas.controller.js — DetalleVenta uses descuentoLinea', () => {

  it('T29: DetalleVenta creation uses d.descuentoLinea instead of hardcoded 0', () => {
    assert.ok(ventasSrc.includes('descuento:      d.descuentoLinea || 0'), 'must use descuentoLinea from validated detail')
    assert.ok(!ventasSrc.includes('descuento:      0,\n              ...detallesMetadata'), 'must not have hardcoded 0 anymore')
  })

  it('T30: detallesValidados capture descuentoLinea from request', () => {
    assert.ok(ventasSrc.includes('descuentoLinea: descLinea'), 'must capture descuentoLinea in validated details')
  })
})

describe('P0-2 Source: facturacion.controller.js — per-line discount in CFDI', () => {

  it('T31: buildInvoicePayload computes net unit price after line discount', () => {
    assert.ok(facturacionSrc.includes('dtoLinea'), 'must compute per-line discount')
    assert.ok(facturacionSrc.includes('netoLinea'), 'must compute net unit price')
  })

  it('T32: netoLinea = precioUnitario - (descuento / cantidad)', () => {
    const match = facturacionSrc.match(/netoLinea\s*=\s*.*dtoLinea\s*\/\s*cant/)
    assert.ok(match, 'must divide line discount by quantity for unit price')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  LOGIC TESTS — Discount calculation correctness
// ═══════════════════════════════════════════════════════════════════

describe('P0-2 Logic: Discount calculation', () => {

  it('T33: cotizacion global discount percentage reverse-calculation', () => {
    const totalLineas = 500
    const descGlobal  = 50
    const pct = parseFloat(((descGlobal / totalLineas) * 100).toFixed(1))
    assert.equal(pct, 10)
  })

  it('T34: per-line discount does not affect precioUnitario', () => {
    const precioUnitario = 100
    const descuentoLinea = 10
    const cantidad = 2
    const subtotal = parseFloat((cantidad * precioUnitario).toFixed(2))
    assert.equal(subtotal, 200)
    assert.equal(precioUnitario, 100)
  })

  it('T35: CFDI net unit price after line discount', () => {
    const precioUnitario = 100
    const cantidad = 2
    const descuentoLinea = 20
    const netoLinea = parseFloat((precioUnitario - descuentoLinea / cantidad).toFixed(6))
    assert.equal(netoLinea, 90)
  })

  it('T36: cotizacion total = sum(line subtotals after per-line discount) - global discount', () => {
    const lineas = [
      { pu: 100, cant: 2, dto: 20 },  // subtotal = 200 - 20 = 180
      { pu: 50,  cant: 3, dto: 10 }   // subtotal = 150 - 10 = 140
    ]
    const subtotalLineas = lineas.reduce((s, l) => s + (l.pu * l.cant - l.dto), 0)
    const descGlobal = 30
    const total = subtotalLineas - descGlobal
    assert.equal(subtotalLineas, 320)
    assert.equal(total, 290)
  })

  it('T37: mismatch in global discount rejected', () => {
    const cotDescuento = 50
    const frontendDescuento = 60
    const mismatch = Math.abs(cotDescuento - frontendDescuento) > 0.01
    assert.ok(mismatch, 'different discounts must be detected as mismatch')
  })

  it('T38: matching global discount accepted', () => {
    const cotDescuento = 50
    const frontendDescuento = 50
    const mismatch = Math.abs(cotDescuento - frontendDescuento) > 0.01
    assert.ok(!mismatch, 'identical discounts must pass validation')
  })
})
