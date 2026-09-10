'use strict'
// P0-6: Cancelación de Factura CFDI — Targeted Tests
// Tests against running local backend on localhost:3000
// Each test creates its own fixtures to avoid cross-test interference.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const prisma = require('../src/lib/prisma')

const BASE = process.env.TEST_BASE || 'http://localhost:3000'
const TENANT_SECRET = process.env.TENANT_JWT_SECRET
const TENANT_ISSUER = process.env.TENANT_JWT_ISSUER
const TENANT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE

let TOKEN_ADMIN, TOKEN_SUPERADMIN, TOKEN_EMPLEADO, TOKEN_OTRO_TENANT
let TEST_ADMIN_ID, TEST_SUCURSAL_ID, TEST_EMPRESA_ID
let TEST_OTRA_SUCURSAL_ID, TEST_OTRA_EMPRESA_ID
const TEST_USER_IDS = []
const TEST_CLEANUP = { facturas: [], ventas: [], turnos: [], clientes: [], mc: [] }

async function req(method, path, body, token, extraHeaders) {
  const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) }
  const useToken = token !== undefined && token !== null ? token : TOKEN_ADMIN
  if (useToken) {
    headers['Authorization'] = 'Bearer ' + useToken
  }
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  const data = await res.json().catch(function() { return null })
  return { status: res.status, data: data }
}

async function createInvoiceFixture(label) {
  const marker = `${Date.now()}-${label}-${process.pid}`
  const turno = await prisma.turnoCaja.create({
    data: { empresaId: TEST_EMPRESA_ID, sucursalId: TEST_SUCURSAL_ID, usuarioId: TEST_ADMIN_ID, montoInicial: 0, abierto: true }
  })
  TEST_CLEANUP.turnos.push(turno.id)

  const cliente = await prisma.cliente.create({
    data: { empresaId: TEST_EMPRESA_ID, nombre: `P0-6 ${label} ${marker}`, tipo: 'GENERAL', limiteCredito: 0, saldoPendiente: 0, totalCreditoUsado: 0 }
  })
  TEST_CLEANUP.clientes.push(cliente.id)

  const venta = await prisma.venta.create({
    data: {
      empresaId: TEST_EMPRESA_ID, folio: `P0-6-${label}-${marker}`, sucursalId: TEST_SUCURSAL_ID,
      usuarioId: TEST_ADMIN_ID, clienteId: cliente.id, turnoId: turno.id,
      metodoPago: 'EFECTIVO', subtotal: 10, total: 10, montoPagado: 10,
      tokenQr: `p06-${label.toLowerCase()}-${marker}`, facturaEstado: 'PENDIENTE_TIMBRADO'
    }
  })
  TEST_CLEANUP.ventas.push(venta.id)

  const factura = await prisma.facturaCfdi.create({
    data: {
      empresaId: TEST_EMPRESA_ID, ventaId: venta.id, clienteId: cliente.id,
      rfcReceptor: 'XAXX010101000', nombreReceptor: 'PUBLICO EN GENERAL', cpReceptor: '00000',
      regimenFiscal: '612', usoCfdi: 'G03', lugarExpedicion: '00000',
      subtotal: 10, iva: 0, total: 10, estado: 'PENDIENTE_TIMBRADO',
      tipoFactura: 'INDIVIDUAL', idempotencyKey: `p06-${label.toLowerCase()}-${marker}`
    }
  })
  TEST_CLEANUP.facturas.push(factura.id)

  return { venta, factura, turno, cliente }
}

async function createTimbradaFixture(label) {
  const marker = `${Date.now()}-${label}-${process.pid}`
  const turno = await prisma.turnoCaja.create({
    data: { empresaId: TEST_EMPRESA_ID, sucursalId: TEST_SUCURSAL_ID, usuarioId: TEST_ADMIN_ID, montoInicial: 0, abierto: true }
  })
  TEST_CLEANUP.turnos.push(turno.id)

  const cliente = await prisma.cliente.create({
    data: { empresaId: TEST_EMPRESA_ID, nombre: `P0-6 ${label} ${marker}`, tipo: 'GENERAL', limiteCredito: 0, saldoPendiente: 0, totalCreditoUsado: 0 }
  })
  TEST_CLEANUP.clientes.push(cliente.id)

  const venta = await prisma.venta.create({
    data: {
      empresaId: TEST_EMPRESA_ID, folio: `P0-6-${label}-${marker}`, sucursalId: TEST_SUCURSAL_ID,
      usuarioId: TEST_ADMIN_ID, clienteId: cliente.id, turnoId: turno.id,
      metodoPago: 'EFECTIVO', subtotal: 10, total: 10, montoPagado: 10,
      tokenQr: `p06-${label.toLowerCase()}-${marker}`, facturaEstado: 'TIMBRADA'
    }
  })
  TEST_CLEANUP.ventas.push(venta.id)

  const factura = await prisma.facturaCfdi.create({
    data: {
      empresaId: TEST_EMPRESA_ID, ventaId: venta.id, clienteId: cliente.id,
      rfcReceptor: 'XAXX010101000', nombreReceptor: 'PUBLICO EN GENERAL', cpReceptor: '00000',
      regimenFiscal: '612', usoCfdi: 'G03', lugarExpedicion: '00000',
      subtotal: 10, iva: 0, total: 10, estado: 'TIMBRADA', facturapiId: `fp-${label.toLowerCase()}-${marker}`,
      folioFiscal: `uuid-${label.toLowerCase()}-${marker}`, timbradaEn: new Date(),
      tipoFactura: 'INDIVIDUAL', idempotencyKey: `p06-${label.toLowerCase()}-${marker}`
    }
  })
  TEST_CLEANUP.facturas.push(factura.id)

  return { venta, factura, turno, cliente }
}

before(async function() {
  const adminUser = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: 1, rol: 'ADMIN_SUCURSAL', sucursalId: { not: null } },
    select: { id: true, nombre: true, rol: true, sucursalId: true, empresaId: true }
  })
  if (!adminUser) throw new Error('No hay ADMIN_SUCURSAL local para fixture P0-6')

  const empleadoUser = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: adminUser.empresaId, sucursalId: adminUser.sucursalId, rol: 'EMPLEADO' },
    select: { id: true, nombre: true, rol: true, sucursalId: true, empresaId: true }
  })

  TEST_ADMIN_ID = adminUser.id
  TEST_SUCURSAL_ID = adminUser.sucursalId
  TEST_EMPRESA_ID = adminUser.empresaId

  TOKEN_ADMIN = jwt.sign(
    { version: 1, kind: 'TENANT', sub: adminUser.id, rol: adminUser.rol, empresaId: adminUser.empresaId, sucursalId: adminUser.sucursalId },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )
  TOKEN_EMPLEADO = jwt.sign(
    { version: 1, kind: 'TENANT', sub: empleadoUser.id, rol: empleadoUser.rol, empresaId: empleadoUser.empresaId, sucursalId: empleadoUser.sucursalId },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )

  const marker = `${Date.now()}-${process.pid}`

  const superUser = await prisma.usuario.create({
    data: {
      empresaId: adminUser.empresaId, sucursalId: null,
      nombre: 'P0-6 Superadmin', username: `p06-super-${marker}`,
      passwordHash: 'fixture', rol: 'SUPERADMIN', activo: true
    }
  })
  TEST_USER_IDS.push(superUser.id)
  TOKEN_SUPERADMIN = jwt.sign(
    { version: 1, kind: 'TENANT', sub: superUser.id, rol: 'SUPERADMIN', empresaId: adminUser.empresaId, sucursalId: null },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )

  const otraEmpresa = await prisma.empresa.create({
    data: { slug: `p06-${marker}`, nombreComercial: `P0-6 Tenant ${marker}`, razonSocial: `P0-6 TENANT ${marker}`, whatsapp: '0000000000' }
  })
  TEST_OTRA_EMPRESA_ID = otraEmpresa.id
  const otraSucursal = await prisma.sucursal.create({
    data: { empresaId: otraEmpresa.id, nombre: `P0-6 Branch ${marker}`, codigoPostal: '00000', activa: true }
  })
  TEST_OTRA_SUCURSAL_ID = otraSucursal.id
  const otroAdmin = await prisma.usuario.create({
    data: {
      empresaId: otraEmpresa.id, sucursalId: otraSucursal.id,
      nombre: 'P0-6 Other Admin', username: `p06-other-${marker}`,
      passwordHash: 'fixture', rol: 'ADMIN_SUCURSAL', activo: true
    }
  })
  TEST_USER_IDS.push(otroAdmin.id)
  TOKEN_OTRO_TENANT = jwt.sign(
    { version: 1, kind: 'TENANT', sub: otroAdmin.id, rol: 'ADMIN_SUCURSAL', empresaId: otraEmpresa.id, sucursalId: otraSucursal.id },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )
})

after(async function() {
  if (TEST_CLEANUP.mc.length > 0) await prisma.movimientoCaja.deleteMany({ where: { id: { in: TEST_CLEANUP.mc } } }).catch(function() {})
  if (TEST_CLEANUP.facturas.length > 0) {
    await prisma.facturaVenta.deleteMany({ where: { facturaId: { in: TEST_CLEANUP.facturas } } }).catch(function() {})
    await prisma.facturaCfdi.deleteMany({ where: { id: { in: TEST_CLEANUP.facturas } } }).catch(function() {})
  }
  if (TEST_CLEANUP.ventas.length > 0) await prisma.venta.deleteMany({ where: { id: { in: TEST_CLEANUP.ventas } } }).catch(function() {})
  if (TEST_CLEANUP.turnos.length > 0) await prisma.turnoCaja.deleteMany({ where: { id: { in: TEST_CLEANUP.turnos } } }).catch(function() {})
  if (TEST_CLEANUP.clientes.length > 0) await prisma.cliente.deleteMany({ where: { id: { in: TEST_CLEANUP.clientes } } }).catch(function() {})
  if (TEST_USER_IDS.length > 0) await prisma.usuario.deleteMany({ where: { id: { in: TEST_USER_IDS } } }).catch(function() {})
  if (TEST_OTRA_SUCURSAL_ID) await prisma.sucursal.delete({ where: { id: TEST_OTRA_SUCURSAL_ID } }).catch(function() {})
  if (TEST_OTRA_EMPRESA_ID) await prisma.empresa.delete({ where: { id: TEST_OTRA_EMPRESA_ID } }).catch(function() {})
  await prisma.$disconnect()
})

describe('P0-6: Cancelación de Factura CFDI', function() {

  it('F01: motivo inválido retorna 400', async function() {
    const { factura } = await createInvoiceFixture('F01')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '99' })
    assert.equal(r.status, 400, `Expected 400, got ${r.status}`)
    assert.equal(r.data?.codigo, 'MOTIVO_INVALIDO')
  })

  it('F03: motivo vacío (undefined) usa default 02', async function() {
    const { factura } = await createInvoiceFixture('F03')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, {})
    assert.equal(r.status, 200, `Expected 200 (default motivo), got ${r.status}`)
    assert.equal(r.data?.success, true)
  })

  it('F04: motivos válidos 01-04 no son rechazados', async function() {
    for (const motivo of ['01', '02', '03', '04']) {
      const { factura } = await createInvoiceFixture(`F04-${motivo}`)
      const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo })
      assert.notEqual(r.status, 400, `Motivo ${motivo} should not be rejected (got ${r.status})`)
    }
  })

  it('F05: cancelación local sin CFDI retorna 200', async function() {
    const { factura, venta } = await createInvoiceFixture('F05')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    assert.equal(r.status, 200, `Expected 200, got ${r.status}`)
    assert.equal(r.data?.success, true)
    const fDb = await prisma.facturaCfdi.findUnique({ where: { id: factura.id }, select: { estado: true } })
    assert.equal(fDb.estado, 'CANCELADA', 'Factura should be CANCELADA in DB')
    const vDb = await prisma.venta.findUnique({ where: { id: venta.id }, select: { facturaEstado: true } })
    assert.equal(vDb.facturaEstado, 'DISPONIBLE', 'Venta should be DISPONIBLE after cancel')
  })

  it('F11: factura ya cancelada retorna 400', async function() {
    const { factura } = await createInvoiceFixture('F11')
    await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    assert.equal(r.status, 400, `Expected 400, got ${r.status}`)
  })

  it('F13: factura inexistente retorna 404', async function() {
    const r = await req('PATCH', '/facturas/999999999/cancelar', { motivo: '02' })
    assert.equal(r.status, 404)
  })

  it('F12: cross-tenant cancelación retorna 404', async function() {
    const { factura } = await createInvoiceFixture('F12')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' }, TOKEN_OTRO_TENANT)
    assert.equal(r.status, 404, 'Cross-tenant should see 404')
  })

  it('Auth: EMPLEADO returns 403 para cancelar', async function() {
    const { factura } = await createInvoiceFixture('AUTH-EMP')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' }, TOKEN_EMPLEADO)
    assert.equal(r.status, 403, `EMPLEADO should get 403, got ${r.status}`)
  })

  it('Auth: sin token retorna 401', async function() {
    const { factura } = await createInvoiceFixture('AUTH-NO')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' }, 'no-token-invalid')
    assert.ok([401, 403].includes(r.status), `Expected 401/403, got ${r.status}`)
  })

  it('Auth: SUPERADMIN puede cancelar', async function() {
    const { factura } = await createInvoiceFixture('AUTH-SUPER')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' }, TOKEN_SUPERADMIN)
    assert.equal(r.status, 200, `SUPERADMIN should cancel successfully, got ${r.status}`)
  })

  it('F19: sincronizar-cancelacion sin CFDI retorna 400', async function() {
    const { factura } = await createInvoiceFixture('F19')
    const r = await req('POST', `/facturas/${factura.id}/sincronizar-cancelacion`)
    assert.equal(r.status, 400, `Expected 400, got ${r.status}`)
    assert.ok(r.data?.error?.includes('sin CFDI'), r.data?.error)
  })

  it('F19b: sincronizar-cancelacion factura inexistente retorna 404', async function() {
    const r = await req('POST', '/facturas/999999999/sincronizar-cancelacion')
    assert.equal(r.status, 404)
  })

  it('F19c: sincronizar-cancelacion cross-tenant retorna 404', async function() {
    const { factura } = await createInvoiceFixture('F19C')
    const r = await req('POST', `/facturas/${factura.id}/sincronizar-cancelacion`, {}, TOKEN_OTRO_TENANT)
    assert.equal(r.status, 404, 'Cross-tenant sync should return 404')
  })

  it('Auth sync: EMPLEADO returns 403 para sincronizar-cancelacion', async function() {
    const { factura } = await createTimbradaFixture('SYNC-EMP')
    const r = await req('POST', `/facturas/${factura.id}/sincronizar-cancelacion`, {}, TOKEN_EMPLEADO)
    assert.equal(r.status, 403, `EMPLEADO sync should get 403, got ${r.status}`)
  })

  it('Auth sync: sin token retorna 401 para sincronizar-cancelacion', async function() {
    const { factura } = await createTimbradaFixture('SYNC-NO')
    const r = await req('POST', `/facturas/${factura.id}/sincronizar-cancelacion`, {}, 'bad-token')
    assert.ok([401, 403].includes(r.status), `Expected 401/403, got ${r.status}`)
  })

  it('F14: venta mantiene facturaEstado coherente tras cancelación local', async function() {
    const { factura, venta } = await createInvoiceFixture('F14')
    await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    const v = await prisma.venta.findUnique({ where: { id: venta.id }, select: { facturaEstado: true } })
    assert.equal(v.facturaEstado, 'DISPONIBLE', 'Venta should be DISPONIBLE after local cancel')
  })

  it('Listing: GET /facturas retorna listado exitoso', async function() {
    const r = await req('GET', '/facturas')
    assert.equal(r.status, 200)
    assert.equal(r.data?.success, true)
    assert.ok(Array.isArray(r.data?.data))
  })

  it('Audit: auditoría existe tras cancelación', async function() {
    const { factura } = await createInvoiceFixture('AUDIT')
    await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    const audit = await prisma.auditoria.findFirst({
      where: { accion: 'CANCELAR_FACTURA', modulo: 'facturas', empresaId: TEST_EMPRESA_ID },
      orderBy: { creadoEn: 'desc' },
      select: { id: true, valorDespues: true }
    })
    assert.ok(audit, 'Audit record should exist after cancellation')
  })
})
