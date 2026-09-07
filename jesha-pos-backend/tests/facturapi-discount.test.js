'use strict'

const assert = require('node:assert/strict')
const { describe, it, mock, beforeEach, afterEach } = require('node:test')
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

function build(detalles, descuento, totalVenta, opts = {}) {
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
    totalVenta,
    ...opts
  })
}

function resumen(payload) {
  const gross = Number(payload.items.reduce((sum, item) => sum + item.quantity * item.product.price, 0).toFixed(2))
  const discount = Number(payload.items.reduce((sum, item) => sum + (item.discount || 0), 0).toFixed(2))
  return { gross, discount, net: Number((gross - discount).toFixed(2)) }
}

function decimalLike(value) {
  return { toString: () => String(value), valueOf: () => value }
}

// ═══════════════════════════════════════════════════════════════
//  1. UNIT TESTS — buildInvoicePayload con totalVenta/descuento
// ═══════════════════════════════════════════════════════════════

describe('Facturapi totalVenta hotfix', () => {

  describe('buildInvoicePayload — conciliacion estricta', () => {

    it('venta $60 sin descuento, totalVenta number', () => {
      const payload = build([detalle(5, 12)], 0, 60)
      assert.deepEqual(resumen(payload), { gross: 60, discount: 0, net: 60 })
    })

    it('venta $60 sin descuento, totalVenta string "60"', () => {
      const payload = build([detalle(5, 12)], 0, '60')
      assert.deepEqual(resumen(payload), { gross: 60, discount: 0, net: 60 })
    })

    it('venta $60 sin descuento, totalVenta string "60.00"', () => {
      const payload = build([detalle(5, 12)], 0, '60.00')
      assert.deepEqual(resumen(payload), { gross: 60, discount: 0, net: 60 })
    })

    it('venta $60 sin descuento, totalVenta Decimal-like', () => {
      const payload = build([detalle(5, 12)], 0, decimalLike('60.00'))
      assert.deepEqual(resumen(payload), { gross: 60, discount: 0, net: 60 })
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

    it('asigna al ultimo concepto el residuo de centavos', () => {
      const payload = build([detalle(1, 100, 'A'), detalle(1, 100, 'B'), detalle(1, 100, 'C')], 10, 290)
      assert.deepEqual(payload.items.map(item => item.discount), [3.33, 3.33, 3.34])
      assert.deepEqual(resumen(payload), { gross: 300, discount: 10, net: 290 })
    })

    it('descuento con totalVenta Decimal-like', () => {
      const payload = build([detalle(14, 145, 'CEMENTO')], decimalLike('60.90'), decimalLike('1969.10'))
      assert.equal(payload.items[0].discount, 60.90)
      assert.deepEqual(resumen(payload), { gross: 2030, discount: 60.90, net: 1969.10 })
    })

    it('descuento null se trata como sin descuento', () => {
      const payload = build([detalle(2, 50)], null, 100)
      assert.deepEqual(resumen(payload), { gross: 100, discount: 0, net: 100 })
    })

    it('descuento undefined se trata como sin descuento', () => {
      const payload = build([detalle(2, 50)], undefined, 100)
      assert.deepEqual(resumen(payload), { gross: 100, discount: 0, net: 100 })
    })
  })

  // ═══════════════════════════════════════════════════════════════
  //  2. MISMATCH GATE — cero tolerancia despues de centavos
  // ═══════════════════════════════════════════════════════════════

  describe('Mismatch gate — cero tolerancia en centavos', () => {

    it('REJECT payload $59.99 vs venta $60', () => {
      assert.throws(
        () => build([detalle(5, 12)], 0.01, 60),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })

    it('REJECT payload $60.01 vs venta $60', () => {
      assert.throws(
        () => build([detalle(1, 60.01)], 0, 60),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })

    it('REJECT bruto $100, descuento $10, total esperado $100 (deberia ser $90)', () => {
      assert.throws(
        () => build([detalle(1, 100)], 10, 100),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })

    it('PASS bruto $100, descuento $10, total $90', () => {
      const payload = build([detalle(1, 100)], 10, 90)
      assert.deepEqual(resumen(payload), { gross: 100, discount: 10, net: 90 })
    })
  })

  // ═══════════════════════════════════════════════════════════════
  //  3. INVALID INPUTS — rechazo explicito
  // ═══════════════════════════════════════════════════════════════

  describe('Invalid inputs — totalVenta', () => {

    it('REJECT totalVenta undefined', () => {
      assert.throws(
        () => build([detalle(2, 50)], 0, undefined),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })

    it('REJECT totalVenta null', () => {
      assert.throws(
        () => build([detalle(2, 50)], 0, null),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })

    it('REJECT totalVenta "abc"', () => {
      assert.throws(
        () => build([detalle(2, 50)], 0, 'abc'),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })

    it('REJECT totalVenta NaN', () => {
      assert.throws(
        () => build([detalle(2, 50)], 0, NaN),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })

    it('REJECT totalVenta Infinity', () => {
      assert.throws(
        () => build([detalle(2, 50)], 0, Infinity),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })

    it('REJECT totalVenta negativo', () => {
      assert.throws(
        () => build([detalle(2, 50)], 0, -10),
        error => error.codigo === 'FACTURAPI_TOTAL_MISMATCH'
      )
    })
  })

  describe('Invalid inputs — descuento', () => {

    it('REJECT descuento "abc"', () => {
      assert.throws(
        () => build([detalle(1, 100)], 'abc', 100),
        error => error.codigo === 'FACTURAPI_DISCOUNT_INVALID'
      )
    })

    it('REJECT descuento negativo', () => {
      assert.throws(
        () => build([detalle(1, 100)], -10, 100),
        error => error.codigo === 'FACTURAPI_DISCOUNT_INVALID'
      )
    })

    it('REJECT descuento mayor al bruto', () => {
      assert.throws(
        () => build([detalle(1, 100)], 100.01, 0),
        error => error.codigo === 'FACTURAPI_DISCOUNT_INVALID'
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════
  //  4. CASO REAL — VTA-20260904-03264
  // ═══════════════════════════════════════════════════════════════

  describe('Caso real — VTA-20260904-03264', () => {

    it('5 MT x $12 = $60, descuento $0, total $60', () => {
      const payload = build(
        [detalle(5, 12, 'MANGUERA NIVEL TRANSPARENTE 1/2 TRUPER')],
        0, 60
      )
      assert.deepEqual(resumen(payload), { gross: 60, discount: 0, net: 60 })
      assert.equal(payload.items[0].quantity, 5)
      assert.equal(payload.items[0].product.price, 12)
      assert.equal(payload.items[0].product.tax_included, true)
    })

    it('mismo caso con descuento Decimal-like 0.00', () => {
      const payload = build(
        [detalle(5, 12, 'MANGUERA NIVEL TRANSPARENTE 1/2 TRUPER')],
        decimalLike('0.00'), decimalLike('60.00')
      )
      assert.deepEqual(resumen(payload), { gross: 60, discount: 0, net: 60 })
    })
  })

  // ═══════════════════════════════════════════════════════════════
  //  5. CANTIDADES FRACCIONARIAS
  // ═══════════════════════════════════════════════════════════════

  describe('Cantidades fraccionarias', () => {

    it('3.5 kg x $18.50 = $64.75', () => {
      const payload = build(
        [{ cantidad: 3.5, precioUnitario: 18.50, Producto: { nombre: 'TEST', claveSat: '31161500', unidadSat: 'KGM', tipo: 'PRODUCTO' } }],
        0, 64.75
      )
      assert.deepEqual(resumen(payload), { gross: 64.75, discount: 0, net: 64.75 })
    })

    it('0.75 m x $45.33 = $34.00 (redondeo)', () => {
      const payload = build(
        [{ cantidad: 0.75, precioUnitario: 45.33, Producto: { nombre: 'TEST', claveSat: '31161500', unidadSat: 'MTR', tipo: 'PRODUCTO' } }],
        0, 34.00
      )
      assert.deepEqual(resumen(payload), { gross: 34.00, discount: 0, net: 34.00 })
    })
  })

  // ═══════════════════════════════════════════════════════════════
  //  6. LUGAR EXPEDICION — no debe causar ReferenceError
  // ═══════════════════════════════════════════════════════════════

  describe('lugarExpedicion', () => {

    it('construye payload completo sin ReferenceError', () => {
      const payload = buildInvoicePayload({
        rfc: 'XAA010101AAA',
        razonSocial: 'RECEPTOR TEST',
        regimenFiscal: '601',
        codigoPostal: '01000',
        usoCfdi: 'G03',
        email: 'test@example.invalid',
        metodoPago: 'EFECTIVO',
        detalles: [detalle(2, 50)],
        datosEmisor: { cp: '98660' },
        descuento: 0,
        totalVenta: 100
      })
      assert.equal(payload.address.zip, '98660')
    })

    it('lugarExpedicion explicito tiene prioridad sobre datosEmisor.cp', () => {
      const payload = buildInvoicePayload({
        rfc: 'XAA010101AAA',
        razonSocial: 'RECEPTOR TEST',
        regimenFiscal: '601',
        codigoPostal: '01000',
        usoCfdi: 'G03',
        email: 'test@example.invalid',
        metodoPago: 'EFECTIVO',
        detalles: [detalle(2, 50)],
        datosEmisor: { cp: '98660' },
        descuento: 0,
        totalVenta: 100,
        lugarExpedicion: '06600'
      })
      assert.equal(payload.address.zip, '06600')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  //  7. WIRING — ambos call sites pasan descuento + totalVenta
  // ═══════════════════════════════════════════════════════════════

  describe('Wiring — source-level verification', () => {

    it('solicitarFactura y timbrarManual pasan descuento + totalVenta', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'),
        'utf8'
      )
      const matches = source.match(/descuento: venta\.descuento, totalVenta: venta\.total/g) || []
      assert.equal(matches.length, 2, `Expected 2 wiring sites, found ${matches.length}`)

      const spreadBuilders = [...source.matchAll(/\.\.\.buildInvoicePayload\(\{/g)].map(m => m.index)
      const creates = [...source.matchAll(/fp\.invoices\.create/g)].map(m => m.index)
      assert.equal(spreadBuilders.length, 2, `Expected 2 ...buildInvoicePayload spread calls, found ${spreadBuilders.length}`)
      assert.equal(creates.length, 2, `Expected 2 fp.invoices.create calls, found ${creates.length}`)
      assert.ok(spreadBuilders[0] > creates[0], 'solicitarFactura: ...buildInvoicePayload must be spread into fp.invoices.create')
      assert.ok(spreadBuilders[1] > creates[1], 'timbrarManual: ...buildInvoicePayload must be spread into fp.invoices.create')
    })

    it('ambos call sites pasan lugarExpedicion', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'),
        'utf8'
      )
      const lugarMatches = source.match(/lugarExpedicion/g) || []
      assert.ok(lugarMatches.length >= 2, `Expected at least 2 lugarExpedicion references, found ${lugarMatches.length}`)
    })

    it('buildInvoicePayload destructura lugarExpedicion', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'),
        'utf8'
      )
      const fnMatch = source.match(/function buildInvoicePayload\(\{[^}]+\}/)
      assert.ok(fnMatch, 'buildInvoicePayload function signature not found')
      assert.ok(
        fnMatch[0].includes('lugarExpedicion'),
        'buildInvoicePayload must destructure lugarExpedicion parameter'
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════
  //  8. CONTRACT TEST — simula el wiring completo de ambos caminos
  //     Sin mocks de Prisma (Prisma 7.4 no permite property mock).
  //     Verifica que la data que construirían solicitarFactura y
  //     timbrarManual produce un payload conciliado.
  // ═══════════════════════════════════════════════════════════════

  describe('Contract test — data flow de solicitarFactura', () => {

    it('construye payload correcto con la misma data que solicitarFactura', () => {
      const venta = {
        metodoPago: 'EFECTIVO', total: 60, descuento: 0,
        DetalleVenta: [
          { productoId: 1, cantidad: 5, precioUnitario: 12,
            Producto: { nombre: 'MANGUERA NIVEL TRANSPARENTE 1/2 TRUPER', claveSat: '31161500', unidadSat: 'H87', tipo: 'PRODUCTO' } }
        ]
      }

      const payload = buildInvoicePayload({
        rfc: 'CKL040412GU9',
        razonSocial: 'EMPRESA TEST SA DE CV',
        regimenFiscal: '601',
        codigoPostal: '01000',
        usoCfdi: 'G03',
        email: 'test@example.invalid',
        metodoPago: venta.metodoPago,
        detalles: venta.DetalleVenta,
        datosEmisor: { cp: '98660' },
        lugarExpedicion: '98660',
        descuento: venta.descuento,
        totalVenta: venta.total
      })

      const net = Number(payload.items.reduce((s, i) => s + i.quantity * i.product.price - (i.discount || 0), 0).toFixed(2))
      assert.equal(net, 60, 'Payload net must match venta.total ($60)')
      assert.equal(payload.items[0].quantity, 5)
      assert.equal(payload.items[0].product.price, 12)
      assert.equal(payload.items[0].product.tax_included, true)
      assert.equal(payload.address.zip, '98660')
    })
  })

  describe('Contract test — data flow de timbrarManual', () => {

    it('construye payload correcto con la misma data que timbrarManual', () => {
      const venta = {
        metodoPago: 'EFECTIVO', total: 60, descuento: 0,
        DetalleVenta: [
          { productoId: 1, cantidad: 5, precioUnitario: 12,
            Producto: { nombre: 'MANGUERA NIVEL TRANSPARENTE 1/2 TRUPER', claveSat: '31161500', unidadSat: 'H87', tipo: 'PRODUCTO' } }
        ]
      }

      const payload = buildInvoicePayload({
        rfc: 'CKL040412GU9',
        razonSocial: 'EMPRESA TEST SA DE CV',
        regimenFiscal: '601',
        codigoPostal: '01000',
        usoCfdi: 'G03',
        email: 'test@example.invalid',
        metodoPago: venta.metodoPago,
        detalles: venta.DetalleVenta,
        datosEmisor: { cp: '98660' },
        lugarExpedicion: '98660',
        descuento: venta.descuento,
        totalVenta: venta.total
      })

      const net = Number(payload.items.reduce((s, i) => s + i.quantity * i.product.price - (i.discount || 0), 0).toFixed(2))
      assert.equal(net, 60, 'Payload net must match venta.total ($60)')
    })

    it('construye payload correcto con descuento no nulo', () => {
      const venta = {
        metodoPago: 'EFECTIVO', total: 1969.10, descuento: 60.90,
        DetalleVenta: [
          { productoId: 1, cantidad: 14, precioUnitario: 145,
            Producto: { nombre: 'CEMENTO CEMEX 25K', claveSat: '31161500', unidadSat: 'H87', tipo: 'PRODUCTO' } }
        ]
      }

      const payload = buildInvoicePayload({
        rfc: 'CKL040412GU9',
        razonSocial: 'EMPRESA TEST SA DE CV',
        regimenFiscal: '601',
        codigoPostal: '01000',
        usoCfdi: 'G03',
        email: 'test@example.invalid',
        metodoPago: venta.metodoPago,
        detalles: venta.DetalleVenta,
        datosEmisor: { cp: '98660' },
        lugarExpedicion: '98660',
        descuento: venta.descuento,
        totalVenta: venta.total
      })

      const net = Number(payload.items.reduce((s, i) => s + i.quantity * i.product.price - (i.discount || 0), 0).toFixed(2))
      assert.equal(net, 1969.10, 'Payload net must match venta.total ($1969.10)')
      assert.equal(payload.items[0].discount, 60.90)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  //  10. PRESERVA — propiedades del payload Facturapi
  // ═══════════════════════════════════════════════════════════════

  describe('Preserva propiedades Facturapi', () => {

    it('tax_included sigue en true', () => {
      const payload = build([detalle(1, 100)], 0, 100)
      assert.equal(payload.items[0].product.tax_included, true)
    })

    it('impuestos IVA 16% presentes', () => {
      const payload = build([detalle(1, 100)], 0, 100)
      assert.equal(payload.items[0].product.taxes[0].type, 'IVA')
      assert.equal(payload.items[0].product.taxes[0].rate, 0.16)
    })

    it('price no se modifica por el descuento', () => {
      const payload = build([detalle(1, 100)], 10, 90)
      assert.equal(payload.items[0].product.price, 100)
      assert.equal(payload.items[0].discount, 10)
    })
  })
})
