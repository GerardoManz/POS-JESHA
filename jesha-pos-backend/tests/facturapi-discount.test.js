'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'

const { buildInvoicePayload } = require('../src/modules/facturacion/facturacion.controller')

function detalle(cantidad, precio, nombre = 'PRODUCTO TEST') {
  return {
    cantidad,
    precioUnitario: precio,
    Producto: {
      nombre,
      claveSat: '31161500',
      unidadSat: 'H87',
      tipo: 'PRODUCTO'
    }
  }
}

function build(detalles, descuento, totalVenta) {
  return buildInvoicePayload({
    rfc: 'XAA010101AAA',
    razonSocial: 'RECEPTOR TEST',
    regimenFiscal: '601',
    codigoPostal: '01000',
    usoCfdi: 'G03',
    email: 'test@example.invalid',
    metodoPago: 'EFECTIVO',
    detalles,
    datosEmisor: { cp: '98660' },
    descuento,
    totalVenta
  })
}

function resumen(payload) {
  const gross = Number(payload.items.reduce((sum, item) => sum + item.quantity * item.product.price, 0).toFixed(2))
  const discount = Number(payload.items.reduce((sum, item) => sum + (item.discount || 0), 0).toFixed(2))
  return { gross, discount, net: Number((gross - discount).toFixed(2)) }
}

describe('Facturapi sale discount payload', () => {
  it('preserva venta sin descuento', () => {
    const payload = build([detalle(2, 145)], 0, 290)
    assert.equal(Object.hasOwn(payload.items[0], 'discount'), false)
    assert.deepEqual(resumen(payload), { gross: 290, discount: 0, net: 290 })
  })

  it('aplica el descuento del incidente real como monto del concepto', () => {
    const payload = build([detalle(14, 145, 'CEMENTO CEMEX 25K')], 60.90, 1969.10)
    assert.equal(payload.items[0].product.price, 145)
    assert.equal(payload.items[0].product.tax_included, true)
    assert.equal(payload.items[0].discount, 60.90)
    assert.deepEqual(resumen(payload), { gross: 2030, discount: 60.90, net: 1969.10 })
  })

  it('distribuye proporcionalmente entre varias partidas', () => {
    const payload = build([detalle(1, 100, 'A'), detalle(1, 200, 'B')], 30, 270)
    assert.deepEqual(payload.items.map(item => item.discount), [10, 20])
    assert.deepEqual(resumen(payload), { gross: 300, discount: 30, net: 270 })
  })

  it('asigna al último concepto el residuo de centavos', () => {
    const payload = build([detalle(1, 100, 'A'), detalle(1, 100, 'B'), detalle(1, 100, 'C')], 10, 290)
    assert.deepEqual(payload.items.map(item => item.discount), [3.33, 3.33, 3.34])
    assert.deepEqual(resumen(payload), { gross: 300, discount: 10, net: 290 })
  })

  it('rechaza descuento mayor al subtotal', () => {
    assert.throws(
      () => build([detalle(1, 100)], 100.01, -0.01),
      error => error.codigo === 'FACTURAPI_DISCOUNT_INVALID'
    )
  })

  it('rechaza total de venta distinto al neto del payload', () => {
    assert.throws(
      () => build([detalle(14, 145)], 60.90, 2030),
      error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
    )
  })

  it('conecta descuento y total antes de Facturapi en ambos caminos', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8')
    assert.equal((source.match(/descuento: venta\.descuento, totalVenta: venta\.total/g) || []).length, 2)

    const builders = [...source.matchAll(/(?:invoicePayload|const invoicePayload)\s*=\s*buildInvoicePayload/g)].map(match => match.index)
    const creates = [...source.matchAll(/fp\.invoices\.create/g)].map(match => match.index)
    assert.equal(builders.length, 2)
    assert.ok(builders[0] < creates[0])
    assert.ok(builders[1] < creates[1])
  })
})
