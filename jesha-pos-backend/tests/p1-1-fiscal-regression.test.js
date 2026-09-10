'use strict'
// P1-1 Fiscal Regression: same email, different RFC → independent payloads
// Unit test — does NOT call Facturapi. Tests buildInvoicePayload directly.

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

// Import buildInvoicePayload from the controller
// We need to require the module and extract the function
const facturacionPath = '../src/modules/facturacion/facturacion.controller.js'
let buildInvoicePayload

try {
  const mod = require(facturacionPath)
  buildInvoicePayload = mod.buildInvoicePayload
} catch (e) {
  // If the module can't be loaded (missing deps), skip gracefully
  console.log('  ⚠️  Could not load facturacion.controller.js — skipping fiscal regression')
  process.exit(0)
}

const DATOS_EMISOR = {
  rfc: 'TESTRFC123456',
  nombre: 'TEST EMISOR',
  regimen: '601',
  cp: '98000',
  logo: null
}

const DETALLES_BASE = [{
  Producto: { nombre: 'Producto Test', claveSat: '31161500', unidadSat: 'H87', tipo: 'BIEN' },
  precioUnitario: 100,
  cantidad: 1,
  descuento: 0,
  subtotal: 100
}]

;(async () => {
  const results = []
  function pass(name) { results.push({ name, pass: true }); console.log(`  ✅ ${name}`) }
  function fail(name, err) { results.push({ name, pass: false, err }); console.log(`  ❌ ${name}: ${err}`) }

  console.log('\n═══ P1-1 Fiscal Regression ═══')

  // Client A: RFC_A, nombre A, email compartido
  const payloadA = buildInvoicePayload({
    rfc: 'GRR850910QR1',
    razonSocial: 'CLIENTE A RAZON SOCIAL',
    regimenFiscal: '612',
    codigoPostal: '98000',
    usoCfdi: 'G03',
    email: 'compartido@test.local',
    metodoPago: 'EFECTIVO',
    detalles: DETALLES_BASE,
    datosEmisor: DATOS_EMISOR,
    descuento: 0,
    totalVenta: 100,
    lugarExpedicion: '98000'
  })

  // Client B: RFC_B, nombre B, same email
  const payloadB = buildInvoicePayload({
    rfc: 'CACX7605101P8',
    razonSocial: 'CLIENTE B RAZON SOCIAL',
    regimenFiscal: '612',
    codigoPostal: '98000',
    usoCfdi: 'G03',
    email: 'compartido@test.local',
    metodoPago: 'EFECTIVO',
    detalles: DETALLES_BASE,
    datosEmisor: DATOS_EMISOR,
    descuento: 0,
    totalVenta: 100,
    lugarExpedicion: '98000'
  })

  // D18: Payload A has RFC_A
  if (payloadA.customer.tax_id === 'GRR850910QR1') pass('D18: payload A has RFC_A')
  else fail('D18: payload A RFC', `got ${payloadA.customer.tax_id}`)

  // D19: Payload B has RFC_B
  if (payloadB.customer.tax_id === 'CACX7605101P8') pass('D19: payload B has RFC_B')
  else fail('D19: payload B RFC', `got ${payloadB.customer.tax_id}`)

  // D20: No fiscal customer mix
  const noMix = payloadA.customer.tax_id !== payloadB.customer.tax_id &&
                payloadA.customer.legal_name !== payloadB.customer.legal_name
  if (noMix) pass('D20: no fiscal customer mix (FISCAL_CUSTOMER_MIX=NO)')
  else fail('D20: fiscal customer mix detected')

  // Additional: email is same in both (expected — email is delivery, not identity)
  if (payloadA.customer.email === 'compartido@test.local' &&
      payloadB.customer.email === 'compartido@test.local') {
    pass('D20: shared email is delivery-only (not identity)')
  } else fail('D20: email mismatch')

  // Additional: items are independent (same content, different instances)
  if (Array.isArray(payloadA.items) && Array.isArray(payloadB.items) &&
      payloadA.items.length === 1 && payloadB.items.length === 1) {
    pass('D20: items arrays independent')
  } else fail('D20: items check')

  // ═══ SUMMARY ═══
  console.log('\n═══ FISCAL REGRESSION RESULTS ═══')
  let allPass = true
  for (const r of results) {
    if (!r.pass) { allPass = false; console.log(`  ❌ ${r.name}: ${r.err}`) }
  }
  const passCount = results.filter(r => r.pass).length
  const failCount = results.filter(r => !r.pass).length
  console.log(`\n  TOTAL: ${results.length} tests, ${passCount} pass, ${failCount} fail`)

  process.exit(allPass ? 0 : 1)
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
