'use strict'
// P0-5: Cambio de Metodo de Pago - Targeted Tests

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const prisma = require('../src/lib/prisma')

const BASE = process.env.TEST_BASE || 'http://localhost:3000'
const TENANT_SECRET = process.env.TENANT_JWT_SECRET
const TENANT_ISSUER = process.env.TENANT_JWT_ISSUER
const TENANT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE

let TOKEN_ADMIN, TOKEN_EMPLEADO, TOKEN_SUPERADMIN, TOKEN_PRECIOS
let TOKEN_PLATFORM_ADMIN, TOKEN_OTRO_TENANT
let TEST_ADMIN_ID, TEST_VENTA_ID, TEST_VENTA_FOLIO, TEST_VENTA_TURNO
let TEST_VENTA_CLIENTE_ID, TEST_VENTA_SUCURSAL_ID, TEST_PRODUCTO_ID
let TEST_OTRA_SUCURSAL_ID, TEST_OTRA_EMPRESA_ID
const TEST_USER_IDS = []

async function req(method, path, body, token, extraHeaders) {
  const headers = {
    'Authorization': 'Bearer ' + (token || TOKEN_ADMIN),
    'Content-Type': 'application/json',
    ...(extraHeaders || {})
  }
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  const data = await res.json().catch(function() { return null })
  return { status: res.status, data: data }
}

async function snapshotEconomico() {
  const venta = await prisma.venta.findUnique({
    where: { id: TEST_VENTA_ID },
    select: { id: true, metodoPago: true, total: true }
  })
  const movimientos = await prisma.movimientoCaja.findMany({
    where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' },
    orderBy: { id: 'asc' },
    select: { id: true, metodoPago: true, monto: true }
  })
  const grupos = await prisma.movimientoCaja.groupBy({
    by: ['metodoPago'],
    where: { turnoId: TEST_VENTA_TURNO, tipo: 'VENTA' },
    _sum: { monto: true }
  })
  const totales = Object.fromEntries(grupos.map((grupo) => [grupo.metodoPago, parseFloat(grupo._sum.monto || 0)]))
  return {
    venta: { ...venta, total: parseFloat(venta.total) },
    movimientos: movimientos.map((movimiento) => ({ ...movimiento, monto: parseFloat(movimiento.monto) })),
    movimientoCount: movimientos.length,
    efectivo: totales.EFECTIVO || 0,
    transferencia: totales.TRANSFERENCIA || 0,
    totalGeneral: Object.values(totales).reduce((sum, monto) => sum + monto, 0)
  }
}

before(async function() {
  const adminUser = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: 1, rol: 'ADMIN_SUCURSAL' },
    select: { id: true, username: true, nombre: true, rol: true, sucursalId: true, empresaId: true }
  })
  const empleadoUser = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: 1, rol: 'EMPLEADO' },
    select: { id: true, username: true, nombre: true, rol: true, sucursalId: true, empresaId: true }
  })

  TOKEN_ADMIN = jwt.sign(
    { version: 1, kind: 'TENANT', sub: adminUser.id, rol: adminUser.rol },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )
  TOKEN_EMPLEADO = jwt.sign(
    { version: 1, kind: 'TENANT', sub: empleadoUser.id, rol: empleadoUser.rol },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )

  const producto = await prisma.producto.findFirst({
    where: { empresaId: adminUser.empresaId, activo: true },
    select: { id: true }
  })
  if (!producto) throw new Error('No hay producto local para fixture P0-5')

  const marker = `${Date.now()}-${process.pid}`
  const otraSucursal = await prisma.sucursal.create({
    data: {
      empresaId: adminUser.empresaId,
      nombre: `P0-5 BRANCH ${marker}`,
      codigoPostal: '00000',
      activa: true
    }
  })
  const otraEmpresa = await prisma.empresa.create({
    data: {
      slug: `p0-5-${marker}`,
      nombreComercial: `P0-5 TENANT ${marker}`,
      razonSocial: `P0-5 TENANT ${marker}`,
      whatsapp: '0000000000'
    }
  })
  const sucursalOtroTenant = await prisma.sucursal.create({
    data: {
      empresaId: otraEmpresa.id,
      nombre: `P0-5 OTHER BRANCH ${marker}`,
      codigoPostal: '00000',
      activa: true
    }
  })
  const usuariosFixture = await Promise.all([
    prisma.usuario.create({ data: { empresaId: adminUser.empresaId, sucursalId: null, nombre: 'P0-5 Superadmin', username: `p05-super-${marker}`, passwordHash: 'fixture', rol: 'SUPERADMIN', activo: true } }),
    prisma.usuario.create({ data: { empresaId: adminUser.empresaId, sucursalId: adminUser.sucursalId, nombre: 'P0-5 Precios', username: `p05-precios-${marker}`, passwordHash: 'fixture', rol: 'PRECIOS', activo: true } }),
    prisma.usuario.create({ data: { nombre: 'P0-5 Platform', username: `p05-platform-${marker}`, passwordHash: 'fixture', rol: 'PLATFORM_ADMIN', activo: true } }),
    prisma.usuario.create({ data: { empresaId: otraEmpresa.id, sucursalId: sucursalOtroTenant.id, nombre: 'P0-5 Other Admin', username: `p05-other-${marker}`, passwordHash: 'fixture', rol: 'ADMIN_SUCURSAL', activo: true } })
  ])
  TEST_USER_IDS.push(...usuariosFixture.map((usuario) => usuario.id))
  TOKEN_SUPERADMIN = jwt.sign({ version: 1, kind: 'TENANT', sub: usuariosFixture[0].id, rol: 'SUPERADMIN' }, TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' })
  TOKEN_PRECIOS = jwt.sign({ version: 1, kind: 'TENANT', sub: usuariosFixture[1].id, rol: 'PRECIOS' }, TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' })
  TOKEN_PLATFORM_ADMIN = jwt.sign({ version: 1, kind: 'TENANT', sub: usuariosFixture[2].id, rol: 'PLATFORM_ADMIN' }, TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' })
  TOKEN_OTRO_TENANT = jwt.sign({ version: 1, kind: 'TENANT', sub: usuariosFixture[3].id, rol: 'ADMIN_SUCURSAL' }, TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' })
  const cliente = await prisma.cliente.create({
    data: {
      empresaId: adminUser.empresaId,
      nombre: `P0-5 FIXTURE ${marker}`,
      tipo: 'REGULAR',
      limiteCredito: 1000,
      saldoPendiente: 0,
      totalCreditoUsado: 0
    }
  })
  const turno = await prisma.turnoCaja.create({
    data: {
      empresaId: adminUser.empresaId,
      sucursalId: adminUser.sucursalId,
      usuarioId: adminUser.id,
      montoInicial: 0,
      abierto: true
    }
  })
  const venta = await prisma.venta.create({
    data: {
      empresaId: adminUser.empresaId,
      folio: `P0-5-${marker}`,
      sucursalId: adminUser.sucursalId,
      usuarioId: adminUser.id,
      clienteId: cliente.id,
      turnoId: turno.id,
      metodoPago: 'EFECTIVO',
      subtotal: 10,
      total: 10,
      montoPagado: 10,
      tokenQr: `p0-5-${marker}`,
      facturaEstado: 'DISPONIBLE'
    }
  })
  await prisma.detalleVenta.create({
    data: {
      ventaId: venta.id,
      productoId: producto.id,
      cantidad: 1,
      precioUnitario: 10,
      subtotal: 10
    }
  })
  await prisma.movimientoCaja.create({
    data: {
      empresaId: adminUser.empresaId,
      turnoId: turno.id,
      tipo: 'VENTA',
      monto: 10,
      metodoPago: 'EFECTIVO',
      referencia: venta.folio,
      notas: 'Fixture P0-5'
    }
  })

  TEST_ADMIN_ID = adminUser.id
  TEST_VENTA_ID = venta.id
  TEST_VENTA_FOLIO = venta.folio
  TEST_VENTA_TURNO = venta.turnoId
  TEST_VENTA_CLIENTE_ID = cliente.id
  TEST_VENTA_SUCURSAL_ID = venta.sucursalId
  TEST_PRODUCTO_ID = producto.id
  TEST_OTRA_SUCURSAL_ID = otraSucursal.id
  TEST_OTRA_EMPRESA_ID = otraEmpresa.id
})

after(async function() {
  if (TEST_VENTA_ID) {
    await prisma.auditoria.deleteMany({ where: { referencia: TEST_VENTA_FOLIO, accion: 'CAMBIO_METODO_PAGO' } })
    await prisma.bitacora.deleteMany({ where: { clienteId: TEST_VENTA_CLIENTE_ID } })
    await prisma.movimientoCaja.deleteMany({ where: { referencia: TEST_VENTA_FOLIO } })
    await prisma.venta.delete({ where: { id: TEST_VENTA_ID } }).catch(function() {})
    await prisma.turnoCaja.delete({ where: { id: TEST_VENTA_TURNO } }).catch(function() {})
    await prisma.cliente.delete({ where: { id: TEST_VENTA_CLIENTE_ID } }).catch(function() {})
  }
  if (TEST_USER_IDS.length > 0) {
    await prisma.usuario.deleteMany({ where: { id: { in: TEST_USER_IDS } } })
  }
  if (TEST_OTRA_SUCURSAL_ID) {
    await prisma.sucursal.delete({ where: { id: TEST_OTRA_SUCURSAL_ID } }).catch(function() {})
  }
  if (TEST_OTRA_EMPRESA_ID) {
    await prisma.sucursal.deleteMany({ where: { empresaId: TEST_OTRA_EMPRESA_ID } })
    await prisma.empresa.delete({ where: { id: TEST_OTRA_EMPRESA_ID } }).catch(function() {})
  }
  await prisma.$disconnect()
})

describe('P0-5: Cambio Metodo de Pago', function() {

  it('M01: ADMIN_SUCURSAL can call endpoint (not 403)', async function() {
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    assert.notEqual(r.status, 403, 'ADMIN_SUCURSAL should not get 403')
  })

  it('M02: EMPLEADO gets 403', async function() {
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' }, TOKEN_EMPLEADO)
    assert.equal(r.status, 403)
  })

  it('M03: EMPLEADO direct API 403', async function() {
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'DEBITO' }, TOKEN_EMPLEADO)
    assert.equal(r.status, 403)
  })

  it('M04: Invalid venta ID 404', async function() {
    const r = await req('PATCH', '/ventas/999999/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    assert.equal(r.status, 404)
  })

  it('M05: Cross-tenant venta 404', async function() {
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' }, TOKEN_OTRO_TENANT)
    assert.equal(r.status, 404)
  })

  it('M06: Invalid method 400', async function() {
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'INVALIDO' })
    assert.equal(r.status, 400)
  })

  it('M07: EFECTIVO -> TRANSFERENCIA PASS', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    const before = await snapshotEconomico()
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    assert.equal(r.status, 200)
    assert.equal(r.data.ok, true)
    assert.equal(r.data.metodoNuevo, 'TRANSFERENCIA')
    const v = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
    assert.equal(v.metodoPago, 'TRANSFERENCIA')
    console.log('    EVIDENCE_NORMAL_TO_NORMAL=' + JSON.stringify({ before, after: await snapshotEconomico() }))
  })

  it('M08: TRANSFERENCIA -> EFECTIVO PASS', async function() {
    const before = await snapshotEconomico()
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    assert.equal(r.status, 200)
    assert.equal(r.data.ok, true)
    const v = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
    assert.equal(v.metodoPago, 'EFECTIVO')
    console.log('    EVIDENCE_REVERSE_CHANGE=' + JSON.stringify({ before, after: await snapshotEconomico() }))
  })

  it('M09: EFECTIVO -> DEBITO PASS', async function() {
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'DEBITO' })
    assert.equal(r.status, 200)
    const v = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
    assert.equal(v.metodoPago, 'DEBITO')
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
  })

  it('M10: Venta total unchanged after method change', async function() {
    const before = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { total: true } })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const after = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { total: true } })
    assert.equal(before.total.toString(), after.total.toString())
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M11: DetalleVenta unchanged', async function() {
    const before = await prisma.detalleVenta.findMany({ where: { ventaId: TEST_VENTA_ID }, select: { id: true, cantidad: true } })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const after = await prisma.detalleVenta.findMany({ where: { ventaId: TEST_VENTA_ID }, select: { id: true, cantidad: true } })
    assert.equal(before.length, after.length)
    for (var i = 0; i < before.length; i++) {
      assert.equal(before[i].id, after[i].id)
      assert.equal(before[i].cantidad.toString(), after[i].cantidad.toString())
    }
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M12: Venta.usuarioId unchanged', async function() {
    const before = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { usuarioId: true } })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const after = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { usuarioId: true } })
    assert.equal(before.usuarioId, after.usuarioId)
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M13: Venta.turnoId unchanged', async function() {
    const before = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { turnoId: true } })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const after = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { turnoId: true } })
    assert.equal(before.turnoId, after.turnoId)
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M14: MovimientoCaja amount unchanged', async function() {
    const mcBefore = await prisma.movimientoCaja.findFirst({
      where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' },
      select: { monto: true }
    })
    if (!mcBefore) { console.log('    (no MovCaja for test venta)'); return }
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const mcAfter = await prisma.movimientoCaja.findFirst({
      where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' },
      select: { monto: true, metodoPago: true }
    })
    assert.ok(mcAfter, 'MovimientoCaja should exist')
    assert.equal(mcBefore.monto.toString(), mcAfter.monto.toString(), 'monto should not change')
    assert.equal(mcAfter.metodoPago, 'TRANSFERENCIA', 'metodo should update')
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M15: MovCaja method updated exactly once', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'DEBITO' })
    const count = await prisma.movimientoCaja.count({
      where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA', metodoPago: 'DEBITO' }
    })
    assert.equal(count, 1, 'Exactly one MovCaja with new method')
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M16: No additional MovimientoCaja created', async function() {
    const countBefore = await prisma.movimientoCaja.count({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' } })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const countAfter = await prisma.movimientoCaja.count({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' } })
    assert.equal(countBefore, countAfter, 'No new MovCaja rows')
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M17: Venta and MovCaja metodo consistent', async function() {
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const v = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
    const mc = await prisma.movimientoCaja.findFirst({
      where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' },
      select: { metodoPago: true }
    })
    if (mc) assert.equal(v.metodoPago, mc.metodoPago, 'Venta and MovCaja methods match')
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M18: General cash total unchanged', async function() {
    const sumBefore = await prisma.movimientoCaja.aggregate({
      where: { empresaId: 1, tipo: 'VENTA' },
      _sum: { monto: true }
    })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const sumAfter = await prisma.movimientoCaja.aggregate({
      where: { empresaId: 1, tipo: 'VENTA' },
      _sum: { monto: true }
    })
    assert.equal(sumBefore._sum.monto.toString(), sumAfter._sum.monto.toString())
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M19: EFECTIVO subtotal decreases by venta total', async function() {
    const venta = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { total: true } })
    const efectivoBefore = await prisma.movimientoCaja.aggregate({
      where: { empresaId: 1, tipo: 'VENTA', metodoPago: 'EFECTIVO' },
      _sum: { monto: true }
    })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const efectivoAfter = await prisma.movimientoCaja.aggregate({
      where: { empresaId: 1, tipo: 'VENTA', metodoPago: 'EFECTIVO' },
      _sum: { monto: true }
    })
    const diff = parseFloat(efectivoBefore._sum.monto || 0) - parseFloat(efectivoAfter._sum.monto || 0)
    assert.ok(Math.abs(diff - parseFloat(venta.total)) < 0.01, 'EFECTIVO decreased by ' + venta.total)
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M20: TRANSFERENCIA subtotal increases by venta total', async function() {
    const venta = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { total: true } })
    const destBefore = await prisma.movimientoCaja.aggregate({
      where: { empresaId: 1, tipo: 'VENTA', metodoPago: 'TRANSFERENCIA' },
      _sum: { monto: true }
    })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const destAfter = await prisma.movimientoCaja.aggregate({
      where: { empresaId: 1, tipo: 'VENTA', metodoPago: 'TRANSFERENCIA' },
      _sum: { monto: true }
    })
    const diff = parseFloat(destAfter._sum.monto || 0) - parseFloat(destBefore._sum.monto || 0)
    assert.ok(Math.abs(diff - parseFloat(venta.total)) < 0.01, 'TRANSFERENCIA increased by ' + venta.total)
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M21: Cancelled venta 409', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { estado: 'CANCELADA' } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 409)
      assert.equal(r.data.codigo, 'VENTA_CANCELADA')
    } finally {
      await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { estado: 'COMPLETADA' } })
    }
  })

  it('M22: MIXTO sale 400', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'MIXTO' } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
      assert.equal(r.status, 400)
      assert.equal(r.data.codigo, 'MIXTO_NO_EDITABLE')
    } finally {
      await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    }
  })

  it('M23: Same method 200 no-op', async function() {
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    assert.equal(r.status, 200)
    assert.equal(r.data.ok, true)
  })

  it('M24: Sale without invoice allowed', async function() {
    await prisma.venta.update({
      where: { id: TEST_VENTA_ID },
      data: { metodoPago: 'EFECTIVO', facturaEstado: 'DISPONIBLE' }
    })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 200)
    } finally {
      await prisma.venta.update({
        where: { id: TEST_VENTA_ID },
        data: { metodoPago: 'EFECTIVO', facturaEstado: 'DISPONIBLE' }
      })
      await prisma.movimientoCaja.updateMany({
        where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' },
        data: { metodoPago: 'EFECTIVO' }
      })
    }
  })

  it('M25: FACTURADA venta 409', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { facturaEstado: 'FACTURADA' } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 409)
      assert.equal(r.data.codigo, 'VENTA_FACTURADA')
    } finally {
      await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { facturaEstado: 'DISPONIBLE' } })
    }
  })

  it('M26: TIMBRADA venta 409', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { facturaEstado: 'TIMBRADA' } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 409)
      assert.equal(r.data.codigo, 'VENTA_FACTURADA')
    } finally {
      await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { facturaEstado: 'DISPONIBLE' } })
    }
  })

  it('M27: PENDIENTE_TIMBRADO venta 409', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { facturaEstado: 'PENDIENTE_TIMBRADO' } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 409)
      assert.equal(r.data.codigo, 'VENTA_FACTURADA')
    } finally {
      await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { facturaEstado: 'DISPONIBLE' } })
    }
  })

  it('M28: CANCELADA fiscal permite cambio', async function() {
    await prisma.venta.update({
      where: { id: TEST_VENTA_ID },
      data: { metodoPago: 'EFECTIVO', facturaEstado: 'CANCELADA' }
    })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 200)
    } finally {
      await prisma.venta.update({
        where: { id: TEST_VENTA_ID },
        data: { metodoPago: 'EFECTIVO', facturaEstado: 'DISPONIBLE' }
      })
      await prisma.movimientoCaja.updateMany({
        where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' },
        data: { metodoPago: 'EFECTIVO' }
      })
    }
  })

  it('M29: Audit trail records change', async function() {
    const beforeCount = await prisma.auditoria.count({
      where: { empresaId: 1, accion: 'CAMBIO_METODO_PAGO', referencia: TEST_VENTA_FOLIO }
    })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const afterCount = await prisma.auditoria.count({
      where: { empresaId: 1, accion: 'CAMBIO_METODO_PAGO', referencia: TEST_VENTA_FOLIO }
    })
    assert.ok(afterCount > beforeCount, 'Audit record created')
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M30: SUPERADMIN puede cambiar método', async function() {
    const branchHeader = { 'X-Sucursal-Id': String(TEST_VENTA_SUCURSAL_ID) }
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' }, TOKEN_SUPERADMIN, branchHeader)
    assert.equal(r.status, 200)
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' }, TOKEN_SUPERADMIN, branchHeader)
  })

  it('M31: PRECIOS y PLATFORM_ADMIN no reciben operación tenant', async function() {
    const precios = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' }, TOKEN_PRECIOS)
    const platform = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' }, TOKEN_PLATFORM_ADMIN)
    assert.equal(precios.status, 403)
    assert.ok(platform.status === 401 || platform.status === 403)
  })

  it('M32: Existing sales still have correct method', async function() {
    const venta = await prisma.venta.findUnique({
      where: { id: TEST_VENTA_ID },
      select: { metodoPago: true }
    })
    var valid = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA', 'CREDITO_CLIENTE', 'MIXTO'].indexOf(venta.metodoPago) !== -1
    assert.ok(valid)
  })

  it('M33: Turno cerrado rechaza cambio', async function() {
    const ventaBefore = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
    const mcBefore = await prisma.movimientoCaja.findMany({ where: { referencia: TEST_VENTA_FOLIO }, orderBy: { id: 'asc' } })
    await prisma.turnoCaja.update({ where: { id: TEST_VENTA_TURNO }, data: { abierto: false, cerradaEn: new Date() } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 409)
      assert.equal(r.data.codigo, 'TURNO_CERRADO')
      const ventaAfter = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
      const mcAfter = await prisma.movimientoCaja.findMany({ where: { referencia: TEST_VENTA_FOLIO }, orderBy: { id: 'asc' } })
      assert.deepEqual(ventaAfter, ventaBefore)
      assert.deepEqual(mcAfter, mcBefore)
      console.log('    EVIDENCE_CLOSED_TURN=' + JSON.stringify({ http: r.status, codigo: r.data.codigo, ventaUnchanged: true, movimientoCajaUnchanged: true }))
    } finally {
      await prisma.turnoCaja.update({ where: { id: TEST_VENTA_TURNO }, data: { abierto: true, cerradaEn: null } })
    }
  })

  it('M34: Credito con abonos rechaza cambio', async function() {
    const toCredit = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'CREDITO_CLIENTE' })
    assert.equal(toCredit.status, 200)
    const detalle = await prisma.detalleBitacora.findFirst({
      where: { ventaId: TEST_VENTA_ID },
      select: { bitacoraId: true }
    })
    assert.ok(detalle, 'La venta fixture quedó vinculada a bitácora')

    const abono = await prisma.$transaction(async function(tx) {
      const creado = await tx.abonoBitacora.create({
        data: {
          empresaId: 1, bitacoraId: detalle.bitacoraId, usuarioId: TEST_ADMIN_ID,
          turnoId: TEST_VENTA_TURNO, monto: 2, metodoPago: 'EFECTIVO',
          notas: 'Fixture P0-5 abono previo', saldoAntesSnapshot: 10,
          saldoDespuesSnapshot: 8, estadoResultante: 'ABIERTA'
        }
      })
      await tx.bitacora.update({
        where: { id: detalle.bitacoraId },
        data: { totalAbonado: { increment: 2 }, saldoPendiente: { decrement: 2 } }
      })
      await tx.cliente.update({
        where: { id: TEST_VENTA_CLIENTE_ID },
        data: { saldoPendiente: { decrement: 2 } }
      })
      await tx.movimientoCaja.create({
        data: {
          empresaId: 1, turnoId: TEST_VENTA_TURNO, tipo: 'ABONO_BITACORA',
          monto: 2, metodoPago: 'EFECTIVO', referencia: TEST_VENTA_FOLIO,
          notas: 'Fixture P0-5 abono previo', abonoBitacoraId: creado.id
        }
      })
      return creado
    })

    const ventaBefore = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
    const clienteBefore = await prisma.cliente.findUnique({ where: { id: TEST_VENTA_CLIENTE_ID }, select: { saldoPendiente: true, totalCreditoUsado: true } })
    const bitBefore = await prisma.bitacora.findUnique({ where: { id: detalle.bitacoraId }, select: { totalAbonado: true, saldoPendiente: true } })
    const movBefore = await prisma.movimientoCaja.findMany({ where: { referencia: TEST_VENTA_FOLIO }, orderBy: { id: 'asc' } })

    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    assert.equal(r.status, 409)
    assert.equal(r.data.codigo, 'CREDITO_CON_ABONOS')
    assert.deepEqual(await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } }), ventaBefore)
    assert.deepEqual(await prisma.cliente.findUnique({ where: { id: TEST_VENTA_CLIENTE_ID }, select: { saldoPendiente: true, totalCreditoUsado: true } }), clienteBefore)
    assert.deepEqual(await prisma.bitacora.findUnique({ where: { id: detalle.bitacoraId }, select: { totalAbonado: true, saldoPendiente: true } }), bitBefore)
    assert.deepEqual(await prisma.movimientoCaja.findMany({ where: { referencia: TEST_VENTA_FOLIO }, orderBy: { id: 'asc' } }), movBefore)
    console.log('    EVIDENCE_CREDIT_WITH_PAYMENT=' + JSON.stringify({ http: r.status, codigo: r.data.codigo, ventaUnchanged: true, clienteUnchanged: true, bitacoraUnchanged: true, movimientoCajaUnchanged: true }))

    await prisma.movimientoCaja.deleteMany({ where: { abonoBitacoraId: abono.id } })
    await prisma.abonoBitacora.delete({ where: { id: abono.id } })
    await prisma.bitacora.delete({ where: { id: detalle.bitacoraId } })
    await prisma.cliente.update({
      where: { id: TEST_VENTA_CLIENTE_ID },
      data: { saldoPendiente: 0, totalCreditoUsado: 0 }
    })
    await prisma.venta.update({
      where: { id: TEST_VENTA_ID },
      data: { metodoPago: 'EFECTIVO', facturaEstado: 'DISPONIBLE' }
    })
    await prisma.movimientoCaja.create({
      data: {
        empresaId: 1, turnoId: TEST_VENTA_TURNO, tipo: 'VENTA', monto: 10,
        metodoPago: 'EFECTIVO', referencia: TEST_VENTA_FOLIO,
        notas: 'Fixture P0-5 restaurado'
      }
    })
  })

  it('M35: FACTURADA blocked (code check)', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { facturaEstado: 'FACTURADA' } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 409)
      assert.equal(r.data.codigo, 'VENTA_FACTURADA')
    } finally {
      await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { facturaEstado: 'DISPONIBLE' } })
    }
  })

  it('M36: Cross-tenant rejected', async function() {
    const before = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' }, TOKEN_OTRO_TENANT)
    assert.equal(r.status, 404)
    assert.deepEqual(await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } }), before)
  })

  it('M37: Cross-branch rejected', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { sucursalId: TEST_OTRA_SUCURSAL_ID } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 404)
    } finally {
      await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { sucursalId: TEST_VENTA_SUCURSAL_ID } })
    }
  })

  it('M38: No-op does not duplicate MovimientoCaja', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    const mcBefore = await prisma.movimientoCaja.count({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' } })
    const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    const mcAfter = await prisma.movimientoCaja.count({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' } })
    assert.equal(r.status, 200)
    assert.equal(mcBefore, mcAfter)
  })

  it('M39: Audit trail records ventaId, actor, empresa, methods', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    const audit = await prisma.auditoria.findFirst({
      where: { empresaId: 1, accion: 'CAMBIO_METODO_PAGO', referencia: TEST_VENTA_FOLIO },
      orderBy: { id: 'desc' },
      select: {
        id: true, usuarioId: true, sucursalId: true, empresaId: true,
        accion: true, referencia: true, valorAntes: true, valorDespues: true,
        creadoEn: true
      }
    })
    assert.ok(audit, 'Audit record exists')
    assert.equal(audit.empresaId, 1)
    assert.equal(audit.accion, 'CAMBIO_METODO_PAGO')
    assert.equal(audit.referencia, TEST_VENTA_FOLIO)
    assert.ok(audit.usuarioId, 'Audit actor exists')
    assert.equal(audit.sucursalId, TEST_VENTA_SUCURSAL_ID)
    assert.equal(audit.valorAntes.metodoPago, 'EFECTIVO')
    assert.equal(audit.valorDespues.metodoPago, 'TRANSFERENCIA')
    assert.equal(audit.valorDespues.ventaId, TEST_VENTA_ID)
    assert.ok(audit.creadoEn, 'Audit timestamp exists')
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M40: Cliente.saldoPendiente consistency after credit round-trip', async function() {
    const cliB = await prisma.cliente.findUnique({ where: { id: TEST_VENTA_CLIENTE_ID }, select: { saldoPendiente: true } })
    const normalBefore = await snapshotEconomico()
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'CREDITO_CLIENTE' })
    const cliM = await prisma.cliente.findUnique({ where: { id: TEST_VENTA_CLIENTE_ID }, select: { saldoPendiente: true } })
    const detalleCredito = await prisma.detalleBitacora.findFirst({
      where: { ventaId: TEST_VENTA_ID },
      select: { bitacoraId: true }
    })
    const creditAfter = await snapshotEconomico()
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    const cliA = await prisma.cliente.findUnique({ where: { id: TEST_VENTA_CLIENTE_ID }, select: { saldoPendiente: true } })
    const normalAfter = await snapshotEconomico()
    var delta = parseFloat(cliA.saldoPendiente || 0) - parseFloat(cliB.saldoPendiente || 0)
    assert.ok(Math.abs(delta) < 0.01, 'Cliente saldo restored after round-trip (delta=' + delta + ')')
    console.log('    EVIDENCE_CREDIT_ROUNDTRIP=' + JSON.stringify({
      normalBefore,
      normalToCredit: { clienteAntes: parseFloat(cliB.saldoPendiente), clienteDespues: parseFloat(cliM.saldoPendiente), bitacoraId: detalleCredito?.bitacoraId || null, economia: creditAfter },
      creditToNormal: { clienteAntes: parseFloat(cliM.saldoPendiente), clienteDespues: parseFloat(cliA.saldoPendiente), economia: normalAfter },
      saldoDeltaFinal: delta
    }))
  })

  it('M41: MovimientoCaja not duplicated across transitions', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    const mcB = await prisma.movimientoCaja.count({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' } })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'DEBITO' })
    await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
    const mcA = await prisma.movimientoCaja.count({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' } })
    assert.equal(mcB, mcA, 'No duplicate MovimientoCaja after transitions')
    assert.equal(mcA, 1, 'Exactly one MovCaja for this venta')
  })

  it('M42: Concurrent updates preserve Venta/MovimientoCaja consistency', async function() {
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
    const resultados = await Promise.all([
      req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' }),
      req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'DEBITO' })
    ])
    const venta = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
    const movimientos = await prisma.movimientoCaja.findMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' } })
    assert.equal(movimientos.length, 1)
    assert.equal(movimientos[0].metodoPago, venta.metodoPago)
    assert.ok(resultados.every((resultado) => resultado.status === 200 || resultado.status === 409))
    for (const resultado of resultados.filter((item) => item.status === 409)) {
      assert.equal(resultado.data.codigo, 'CAMBIO_CONCURRENTE')
    }
    console.log('    EVIDENCE_CONCURRENCY=' + JSON.stringify({ statuses: resultados.map((resultado) => resultado.status), metodoFinal: venta.metodoPago, movimientoCajaCount: movimientos.length }))
    await prisma.venta.update({ where: { id: TEST_VENTA_ID }, data: { metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.updateMany({ where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }, data: { metodoPago: 'EFECTIVO' } })
  })

  it('M43: Credit round-trip with global discount restores Bitacora exactly', async function() {
    await prisma.venta.update({
      where: { id: TEST_VENTA_ID },
      data: { metodoPago: 'EFECTIVO', subtotal: 10, descuento: 1, total: 9, montoPagado: 9 }
    })
    await prisma.movimientoCaja.updateMany({
      where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' },
      data: { metodoPago: 'EFECTIVO', monto: 9 }
    })
    try {
      const toCredit = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'CREDITO_CLIENTE' })
      assert.equal(toCredit.status, 200)
      const detalle = await prisma.detalleBitacora.findFirst({ where: { ventaId: TEST_VENTA_ID }, select: { bitacoraId: true } })
      const durante = await prisma.bitacora.findUnique({ where: { id: detalle.bitacoraId }, select: { totalMateriales: true, saldoPendiente: true } })
      assert.equal(parseFloat(durante.totalMateriales), 9)
      assert.equal(parseFloat(durante.saldoPendiente), 9)

      const toCash = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'EFECTIVO' })
      assert.equal(toCash.status, 200)
      const despues = await prisma.bitacora.findUnique({ where: { id: detalle.bitacoraId }, select: { totalMateriales: true, saldoPendiente: true } })
      assert.equal(parseFloat(despues.totalMateriales), 0)
      assert.equal(parseFloat(despues.saldoPendiente), 0)
    } finally {
      await prisma.venta.update({
        where: { id: TEST_VENTA_ID },
        data: { metodoPago: 'EFECTIVO', subtotal: 10, descuento: 0, total: 10, montoPagado: 10 }
      })
      await prisma.movimientoCaja.updateMany({
        where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' },
        data: { metodoPago: 'EFECTIVO', monto: 10 }
      })
    }
  })

  it('M44: Missing MovimientoCaja rejects without changing Venta', async function() {
    const movimiento = await prisma.movimientoCaja.findFirst({
      where: { referencia: TEST_VENTA_FOLIO, tipo: 'VENTA' }
    })
    assert.ok(movimiento)
    await prisma.movimientoCaja.delete({ where: { id: movimiento.id } })
    try {
      const r = await req('PATCH', '/ventas/' + TEST_VENTA_ID + '/metodo-pago', { nuevoMetodo: 'TRANSFERENCIA' })
      assert.equal(r.status, 409)
      assert.equal(r.data.codigo, 'MOVIMIENTO_CAJA_NO_ENCONTRADO')
      const venta = await prisma.venta.findUnique({ where: { id: TEST_VENTA_ID }, select: { metodoPago: true } })
      assert.equal(venta.metodoPago, 'EFECTIVO')
    } finally {
      await prisma.movimientoCaja.create({
        data: {
          empresaId: 1, turnoId: TEST_VENTA_TURNO, tipo: 'VENTA', monto: 10,
          metodoPago: 'EFECTIVO', referencia: TEST_VENTA_FOLIO,
          notas: 'Fixture P0-5 restaurado'
        }
      })
    }
  })

})
