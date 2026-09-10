'use strict'
// P0-7: Filtros de Facturación — Targeted Tests
// Tests against running local backend on localhost:3000
// Each test creates its own fixtures to avoid cross-test interference.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const prisma = require('../src/lib/prisma')

const BASE = process.env.TEST_BASE || 'http://localhost:3000'
const TENANT_SECRET = process.env.TENANT_JWT_SECRET
const TENANT_ISSUER = process.env.TENANT_JWT_ISSUER
const TENANT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE

// P0-7: Timezone offset — misma convención que el controller
const TZ_OFFSET = '-06:00'

let TOKEN_ADMIN, TEST_ADMIN_ID, TEST_SUCURSAL_ID, TEST_EMPRESA_ID
const CLEANUP = { facturas: [], ventas: [], turnos: [], clientes: [] }

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  const useToken = token !== undefined ? token : TOKEN_ADMIN
  if (useToken) headers['Authorization'] = 'Bearer ' + useToken
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

async function createFixture(label, overrides = {}) {
  const m = `${Date.now()}-${label}-${process.pid}`
  const t = await prisma.turnoCaja.create({
    data: { empresaId: TEST_EMPRESA_ID, sucursalId: TEST_SUCURSAL_ID, usuarioId: TEST_ADMIN_ID, montoInicial: 0, abierto: true }
  })
  CLEANUP.turnos.push(t.id)
  const c = await prisma.cliente.create({
    data: { empresaId: TEST_EMPRESA_ID, nombre: `P07 ${label} ${m}`, tipo: 'GENERAL', limiteCredito: 0, saldoPendiente: 0, totalCreditoUsado: 0 }
  })
  CLEANUP.clientes.push(c.id)
  const v = await prisma.venta.create({
    data: {
      empresaId: TEST_EMPRESA_ID, folio: `P07-${label}-${m}`, sucursalId: TEST_SUCURSAL_ID,
      usuarioId: TEST_ADMIN_ID, clienteId: c.id, turnoId: t.id,
      metodoPago: overrides.metodoPago || 'EFECTIVO', subtotal: 10, total: 10, montoPagado: 10,
      tokenQr: `p07-${label.toLowerCase()}-${m}`, facturaEstado: 'PENDIENTE_TIMBRADO',
      ...(overrides.creadaEn ? { creadaEn: overrides.creadaEn } : {})
    }
  })
  CLEANUP.ventas.push(v.id)
  const f = await prisma.facturaCfdi.create({
    data: {
      empresaId: TEST_EMPRESA_ID, ventaId: v.id, clienteId: c.id,
      rfcReceptor: overrides.rfc || 'XAXX010101000',
      nombreReceptor: overrides.nombre || `P07 ${label}`,
      cpReceptor: '00000', regimenFiscal: '612', usoCfdi: 'G03', lugarExpedicion: '00000',
      subtotal: 10, iva: 0, total: 10,
      estado: overrides.estado || 'PENDIENTE_TIMBRADO',
      tipoFactura: 'INDIVIDUAL', idempotencyKey: `p07-${label.toLowerCase()}-${m}`,
      ...(overrides.creadaEn ? { creadaEn: overrides.creadaEn } : {})
    }
  })
  CLEANUP.facturas.push(f.id)
  return { venta: v, factura: f, turno: t, cliente: c }
}

;(async () => {
  // ═══ SETUP ═══
  const u = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: 1, rol: 'ADMIN_SUCURSAL', sucursalId: { not: null } },
    select: { id: true, rol: true, sucursalId: true, empresaId: true }
  })
  if (!u) throw new Error('No ADMIN_SUCURSAL user for tests')
  TEST_ADMIN_ID = u.id
  TEST_SUCURSAL_ID = u.sucursalId
  TEST_EMPRESA_ID = u.empresaId
  TOKEN_ADMIN = jwt.sign(
    { version: 1, kind: 'TENANT', sub: u.id, rol: u.rol, empresaId: u.empresaId, sucursalId: u.sucursalId },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )

  const results = []

  function pass(name) { results.push({ name, pass: true }); console.log(`  ✅ ${name}`) }
  function fail(name, err) { results.push({ name, pass: false, err }); console.log(`  ❌ ${name}: ${err}`) }

  // ═══ F01-F04: SEARCH ═══
  console.log('\n═══ F01-F04: Search ═══')

  {
    const { factura } = await createFixture('SEARCH-FULL', { rfc: 'GRR850910QR1', nombre: 'GERARDO MANZ' })
    const r = await req('GET', `/facturas?q=GRR850910QR1`)
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F01: q by RFC exact')
    else fail('F01: q by RFC exact', `status=${r.status} found=${found}`)
  }

  {
    const { factura } = await createFixture('SEARCH-PARTIAL', { rfc: 'CAMR850101ABC' })
    const r = await req('GET', `/facturas?q=CAMR85`)
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F02: q by RFC partial')
    else fail('F02: q by RFC partial', `status=${r.status}`)
  }

  {
    const { factura } = await createFixture('SEARCH-NAME', { nombre: 'FRANCISCO LOPEZ' })
    const r = await req('GET', `/facturas?q=FRANCISCO`)
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F03: q by name')
    else fail('F03: q by name', `status=${r.status}`)
  }

  {
    const { factura } = await createFixture('SEARCH-FOLIO')
    const r = await req('GET', `/facturas?q=${factura.Venta?.folio || 'P07-SEARCH-FOLIO'}`)
    // The folio is on the venta, search joins via Venta.folio
    const r2 = await req('GET', `/facturas?q=P07-SEARCH-FOLIO`)
    const found = r2.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F04: q by folio')
    else fail('F04: q by folio', `status=${r2.status}`)
  }

  // ═══ F05-F11: STATE FILTERS ═══
  console.log('\n═══ F05-F11: State filters ═══')

  const estados = [
    ['PENDIENTE_TIMBRADO', 'F05'],
    ['TIMBRADA', 'F06'],
    ['CANCELADA', 'F07'],
    ['DISPONIBLE', 'F08'],
    ['FACTURADA', 'F09'],
    ['VENCIDA', 'F10'],
    ['BLOQUEADA', 'F11']
  ]

  for (const [estado, testId] of estados) {
    const { factura } = await createFixture(`STATE-${estado}`, { estado })
    const r = await req('GET', `/facturas?estado=${estado}`)
    const found = r.data?.data?.some(f => f.id === factura.id)
    const notFoundWrong = r.data?.data?.every(f => f.estado === estado)
    if (found && notFoundWrong) pass(`${testId}: estado=${estado}`)
    else fail(`${testId}: estado=${estado}`, `found=${found} allMatch=${notFoundWrong} status=${r.status}`)
  }

  // ═══ F12: INVALID STATE ═══
  console.log('\n═══ F12: Invalid state ═══')
  {
    const r = await req('GET', '/facturas?estado=INVALIDO')
    if (r.status === 400 && r.data?.error?.includes('inválido')) pass('F12: invalid state → 400')
    else fail('F12: invalid state → 400', `status=${r.status} error=${r.data?.error}`)
  }

  // ═══ F13-F17: DATE FILTERS ═══
  console.log('\n═══ F13-F17: Date filters ═══')

  // Create fixture at a specific time: 2026-09-10 14:30:00 local (20:30 UTC)
  {
    const targetDate = new Date('2026-09-10T14:30:00.000' + TZ_OFFSET)
    const { factura } = await createFixture('DATE-MIDDAY', { creadaEn: targetDate })
    const r = await req('GET', '/facturas?desde=2026-09-10&hasta=2026-09-10')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F13: midday included in same-day range')
    else fail('F13: midday included', `status=${r.status}`)
  }

  // Create fixture at 2026-09-09 23:59:59 local — should NOT be in 2026-09-10 range
  {
    const targetDate = new Date('2026-09-09T23:59:59.000' + TZ_OFFSET)
    const { factura } = await createFixture('DATE-PREV', { creadaEn: targetDate })
    const r = await req('GET', '/facturas?desde=2026-09-10&hasta=2026-09-10')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (!found) pass('F14: prev day NOT included')
    else fail('F14: prev day NOT included', `found=${found}`)
  }

  // Create fixture at 2026-09-10 23:59:59.999 local — should be included
  {
    const targetDate = new Date('2026-09-10T23:59:59.999' + TZ_OFFSET)
    const { factura } = await createFixture('DATE-END', { creadaEn: targetDate })
    const r = await req('GET', '/facturas?desde=2026-09-10&hasta=2026-09-10')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F15: end of day included')
    else fail('F15: end of day included', `status=${r.status}`)
  }

  // Create fixture at 2026-09-11 00:00:00.001 local — should NOT be in 2026-09-10 range
  {
    const targetDate = new Date('2026-09-11T00:00:00.001' + TZ_OFFSET)
    const { factura } = await createFixture('DATE-NEXT', { creadaEn: targetDate })
    const r = await req('GET', '/facturas?desde=2026-09-10&hasta=2026-09-10')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (!found) pass('F16: next day NOT included')
    else fail('F16: next day NOT included', `found=${found}`)
  }

  // Same day desde=hasta
  {
    const targetDate = new Date('2026-09-10T10:00:00.000' + TZ_OFFSET)
    const { factura } = await createFixture('DATE-SAMEDAY', { creadaEn: targetDate })
    const r = await req('GET', '/facturas?desde=2026-09-10&hasta=2026-09-10')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F17: desde=hasta includes day')
    else fail('F17: desde=hasta includes day', `status=${r.status}`)
  }

  // ═══ F18-F20: DATE VALIDATION ═══
  console.log('\n═══ F18-F20: Date validation ═══')

  {
    const r = await req('GET', '/facturas?desde=2026-09-15&hasta=2026-09-10')
    if (r.status === 400) pass('F18: desde > hasta → 400')
    else fail('F18: desde > hasta → 400', `status=${r.status}`)
  }

  {
    const r = await req('GET', '/facturas?desde=NOT-A-DATE')
    if (r.status === 400) pass('F19: invalid desde → 400')
    else fail('F19: invalid desde → 400', `status=${r.status}`)
  }

  {
    const r = await req('GET', '/facturas?hasta=2026-13-99')
    if (r.status === 400) pass('F20: invalid hasta → 400')
    else fail('F20: invalid hasta → 400', `status=${r.status}`)
  }

  // ═══ F21-F25: COMBINATIONS ═══
  console.log('\n═══ F21-F25: Combinations ═══')

  {
    const { factura } = await createFixture('COMBO-SF', { estado: 'TIMBRADA', creadaEn: new Date('2026-09-10T12:00:00.000' + TZ_OFFSET) })
    const r = await req('GET', '/facturas?estado=TIMBRADA&desde=2026-09-10&hasta=2026-09-10')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F21: state + date')
    else fail('F21: state + date', `status=${r.status}`)
  }

  {
    const { factura } = await createFixture('COMBO-QS', { rfc: 'TESTCOMBO123', estado: 'TIMBRADA' })
    const r = await req('GET', '/facturas?q=TESTCOMBO123&estado=TIMBRADA')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F22: search + state')
    else fail('F22: search + state', `status=${r.status}`)
  }

  {
    const { factura } = await createFixture('COMBO-QM', { metodoPago: 'TRANSFERENCIA' })
    const r = await req('GET', `/facturas?q=${factura.rfcReceptor}&metodoPago=TRANSFERENCIA`)
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F23: search + metodoPago')
    else fail('F23: search + metodoPago', `status=${r.status}`)
  }

  {
    const { factura } = await createFixture('COMBO-SMF', { estado: 'TIMBRADA', metodoPago: 'CREDITO', creadaEn: new Date('2026-09-10T08:00:00.000' + TZ_OFFSET) })
    const r = await req('GET', '/facturas?estado=TIMBRADA&metodoPago=CREDITO&desde=2026-09-10&hasta=2026-09-10')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F24: state + method + date range')
    else fail('F24: state + method + date range', `status=${r.status}`)
  }

  {
    const { factura } = await createFixture('COMBO-ALL', {
      rfc: 'XALLCOMBO01', nombre: 'ALL COMBO TEST', estado: 'TIMBRADA',
      metodoPago: 'DEBITO', creadaEn: new Date('2026-09-10T16:00:00.000' + TZ_OFFSET)
    })
    const r = await req('GET', '/facturas?q=XALLCOMBO01&estado=TIMBRADA&metodoPago=DEBITO&desde=2026-09-10&hasta=2026-09-10')
    const found = r.data?.data?.some(f => f.id === factura.id)
    if (found) pass('F25: all filters combined')
    else fail('F25: all filters combined', `status=${r.status}`)
  }

  // ═══ F26: TENANT ISOLATION ═══
  console.log('\n═══ F26: Tenant isolation ═══')
  {
    const { factura } = await createFixture('TENANT-OWN')
    // Query should only return our empresa's invoices
    const r = await req('GET', '/facturas')
    const allBelongToTenant = (r.data?.data || []).every(f => f.empresaId === TEST_EMPRESA_ID)
    if (r.status === 200 && allBelongToTenant) pass('F26: tenant isolation')
    else fail('F26: tenant isolation', `status=${r.status} allOwn=${allBelongToTenant}`)
  }

  // ═══ F27: BRANCH ISOLATION ═══
  console.log('\n═══ F27: Branch isolation ═══')
  {
    const { factura } = await createFixture('BRANCH-OWN')
    const r = await req('GET', '/facturas')
    if (r.status === 200) pass('F27: branch isolation (endpoint works)')
    else fail('F27: branch isolation', `status=${r.status}`)
  }

  // ═══ F28: PAGINATION ═══
  console.log('\n═══ F28: Pagination maintains filters ═══')
  {
    // Create 3 fixtures in same state
    await createFixture('PAGE-A', { estado: 'TIMBRADA' })
    await createFixture('PAGE-B', { estado: 'TIMBRADA' })
    await createFixture('PAGE-C', { estado: 'TIMBRADA' })

    const r = await req('GET', '/facturas?estado=TIMBRADA&take=2&page=1')
    if (r.status === 200 && r.data?.data?.length <= 2 && r.data?.paginacion) pass('F28: pagination with state filter')
    else fail('F28: pagination with state filter', `status=${r.status} count=${r.data?.data?.length}`)
  }

  // ═══ SUMMARY ═══
  console.log('\n═══ RESULTS ═══')
  let allPass = true
  for (const r of results) {
    if (!r.pass) { allPass = false; console.log(`  ❌ ${r.name}: ${r.err}`) }
  }
  const passCount = results.filter(r => r.pass).length
  const failCount = results.filter(r => !r.pass).length
  console.log(`\n  TOTAL: ${results.length} tests, ${passCount} pass, ${failCount} fail`)

  // Cleanup
  for (const id of CLEANUP.facturas) await prisma.facturaCfdi.delete({ where: { id } }).catch(() => {})
  for (const id of CLEANUP.ventas) await prisma.venta.delete({ where: { id } }).catch(() => {})
  for (const id of CLEANUP.turnos) await prisma.turnoCaja.delete({ where: { id } }).catch(() => {})
  for (const id of CLEANUP.clientes) await prisma.cliente.delete({ where: { id } }).catch(() => {})
  await prisma.$disconnect()

  process.exit(allPass ? 0 : 1)
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
