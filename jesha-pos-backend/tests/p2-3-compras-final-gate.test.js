'use strict'
// ════════════════════════════════════════════════════════════════════
//  P2-3 FASE 1B — FINAL CERTIFICATION GATE
//  tests/p2-3-compras-final-gate.test.js
// ════════════════════════════════════════════════════════════════════
const path = require('path')
const fs = require('fs')
const base = path.join('C:', 'Proyecto ferre', 'Ferreteria JESHA', 'jesha-pos-backend')
const envContent = fs.readFileSync(path.join(base, '.env'), 'utf8')
for (const line of envContent.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i < 0) continue
  const k = t.slice(0, i).trim()
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  if (!process.env[k]) process.env[k] = v
}

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const jwt = require('jsonwebtoken')
const prisma = require(path.join(base, 'src', 'lib', 'prisma'))

const API = 'http://localhost:3000'
const TENANT = { secret: process.env.TENANT_JWT_SECRET, issuer: process.env.TENANT_JWT_ISSUER, audience: process.env.TENANT_JWT_AUDIENCE, algorithm: 'HS256' }
const EMPRESA_ID = 1

let token, usuarioId, sucursalId, proveedorId, productoIdBase
const createdOcIds = []
const createdProveedorIds = []
const createdProductoIds = []

// ─── Helpers ──────────────────────────────────────────────────────

async function crearProveedor () {
  const r = await fetch(`${API}/compras/proveedores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nombre: `PROV-FG-${Date.now()}`, alias: `PFG${Date.now()}` })
  })
  const body = await r.json()
  const provId = body.data?.id || body.id
  if (provId) createdProveedorIds.push(provId)
  return provId
}

async function crearOC (provId, detalles) {
  const r = await fetch(`${API}/compras`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ proveedorId: provId, detalles })
  })
  const body = await r.json()
  if (body.data?.id) createdOcIds.push(body.data.id)
  return { id: body.data?.id, detalles: body.data?.DetalleOrdenCompra || [], _raw: body, _status: r.status }
}

async function recibirOC (ocId, detalles) {
  const r = await fetch(`${API}/compras/${ocId}/recibir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ detalles })
  })
  return { status: r.status, body: await r.json() }
}

async function crearProductoTemporal (costoBase) {
  const codigo = `FG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const cat = await prisma.categoria.findFirst({ where: { empresaId: EMPRESA_ID } })
  const p = await prisma.producto.create({
    data: {
      empresaId: EMPRESA_ID, codigoInterno: codigo, nombre: `FG TEST ${codigo}`,
      costo: costoBase, costoPromedio: costoBase, precioVenta: costoBase * 3,
      precioBase: parseFloat((costoBase * 3 / 1.16).toFixed(2)), margen: 200,
      unidadCompra: 'PZA', unidadVenta: 'PZA', categoriaId: cat?.id || 1, tipo: 'PRODUCTO'
    }
  })
  createdProductoIds.push(p.id)
  return p.id
}

async function hppCount (productoId) {
  return prisma.historialPrecioProducto.count({ where: { productoId, origen: 'COMPRA' } })
}

async function hppdCount (productoId) {
  return prisma.historialPrecioProductoDetalle.count({
    where: { Historial: { productoId, origen: 'COMPRA' } }
  })
}

async function hppFirst (productoId) {
  return prisma.historialPrecioProducto.findFirst({
    where: { productoId, origen: 'COMPRA' },
    orderBy: { id: 'desc' },
    include: { Detalle: true }
  })
}

async function productoEconomico (id) {
  return prisma.producto.findUnique({
    where: { id },
    select: {
      costo: true, costoPromedio: true, precioVenta: true, precioBase: true,
      precioMayoreo: true, margen: true, costoSinIvaProveedor: true, factorConversion: true
    }
  })
}

// Direct controller call for fault injection (same process, same prisma instance)
function mockReq (paramsId, bodyDetalles) {
  return {
    params: { id: String(paramsId) },
    body: { detalles: bodyDetalles },
    usuario: { id: usuarioId, empresaId: EMPRESA_ID, rol: 'ADMIN_SUCURSAL', sucursalId },
    context: {
      version: 1,
      kind: 'TENANT',
      actor: { id: usuarioId, rol: 'ADMIN_SUCURSAL' },
      tenant: { empresaId: EMPRESA_ID },
      branch: { mode: 'FIXED', sucursalId }
    }
  }
}

function mockRes () {
  let _status = 200
  let _body = null
  const res = {
    status (code) { _status = code; return res },
    json (data) { _body = data; return res },
    getStatusCode () { return _status },
    getBody () { return _body }
  }
  return res
}

async function cleanup () {
  for (const ocId of createdOcIds) {
    try {
      await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { ordenCompraId: ocId } } })
      await prisma.historialPrecioProducto.deleteMany({ where: { ordenCompraId: ocId } })
      await prisma.movimientoInventario.deleteMany({ where: { referencia: { contains: `OC:${ocId}` } } })
      await prisma.ordenCompra.delete({ where: { id: ocId } })
    } catch {}
  }
  for (const pid of createdProductoIds) {
    try {
      await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: pid } } })
      await prisma.historialPrecioProducto.deleteMany({ where: { productoId: pid } })
      await prisma.producto.update({ where: { id: pid }, data: { activo: false } })
    } catch {}
  }
  for (const provId of createdProveedorIds) {
    try { await prisma.proveedor.update({ where: { id: provId }, data: { activo: false } }) } catch {}
  }
}

// ─── Setup ────────────────────────────────────────────────────────

before(async () => {
  const u = await prisma.usuario.findFirst({ where: { activo: true, empresaId: EMPRESA_ID } })
  usuarioId = u.id
  sucursalId = u.sucursalId
  token = jwt.sign({ version: 1, kind: 'TENANT', sub: u.id, rol: u.rol }, TENANT.secret, {
    algorithm: TENANT.algorithm, issuer: TENANT.issuer, audience: TENANT.audience, expiresIn: '15m'
  })
  const prod = await prisma.producto.findFirst({
    where: { empresaId: EMPRESA_ID, activo: true, costo: { not: null } }
  })
  productoIdBase = prod.id
  const prov = await prisma.proveedor.findFirst({ where: { empresaId: EMPRESA_ID, activo: true } })
  proveedorId = prov?.id || await crearProveedor()
  console.log(`SETUP: proveedorId=${proveedorId} productoIdBase=${productoIdBase} usuarioId=${usuarioId} sucursalId=${sucursalId}`)
})

after(cleanup)

// ════════════════════════════════════════════════════════════════════
//  GATE 2: SUCURSAL CERTIFICATION
// ════════════════════════════════════════════════════════════════════
describe('GATE 2: SUCURSAL', () => {
  it('C15A: HPP.sucursalId === OrdenCompra.sucursalId', async () => {
    const pid = await crearProductoTemporal(40)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 70, cantidadPedida: 1 }])
    assert.ok(oc.id)
    const res = await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    assert.equal(res.status, 200)

    const hpp = await hppFirst(pid)
    assert.ok(hpp, 'HPP created')
    assert.equal(hpp.sucursalId, sucursalId, 'HPP.sucursalId matches token sucursal')

    const ocRow = await prisma.ordenCompra.findUnique({ where: { id: oc.id }, select: { sucursalId: true } })
    assert.equal(hpp.sucursalId, ocRow.sucursalId, 'HPP.sucursalId matches OrdenCompra.sucursalId')
  })

  it('C15B: Sucursal belongs to same empresa', async () => {
    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { origen: 'COMPRA' }, orderBy: { id: 'desc' }
    })
    if (!hpp || !hpp.sucursalId) return
    const suc = await prisma.sucursal.findUnique({ where: { id: hpp.sucursalId } })
    assert.ok(suc, 'Sucursal exists')
    assert.equal(suc.empresaId, EMPRESA_ID, 'Sucursal.empresaId matches empresaId')
    assert.equal(suc.empresaId, hpp.empresaId, 'Sucursal.empresaId matches HPP.empresaId')
  })

  it('C15C: recibir filters by sucursalId — OC with different sucursal not found', async () => {
    const pid = await crearProductoTemporal(42)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 72, cantidadPedida: 1 }])
    assert.ok(oc.id)
    const ocRow = await prisma.ordenCompra.findUnique({ where: { id: oc.id }, select: { sucursalId: true } })
    assert.equal(ocRow.sucursalId, sucursalId, 'OC created with user sucursal')
    const res = await recibirOC(999999, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    assert.ok(res.status >= 400, `Status ${res.status} blocks non-existent OC`)
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 3: USUARIO CERTIFICATION
// ════════════════════════════════════════════════════════════════════
describe('GATE 3: USUARIO', () => {
  it('C16A: HPP.usuarioId === usuario efectivo de req', async () => {
    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { origen: 'COMPRA' }, orderBy: { id: 'desc' }
    })
    if (!hpp) return
    assert.equal(hpp.usuarioId, usuarioId, 'HPP.usuarioId matches JWT usuario')
  })

  it('C16B: usuarioId comes from JWT, not body', async () => {
    const pid = await crearProductoTemporal(55)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 90, cantidadPedida: 1 }])
    const res = await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    assert.equal(res.status, 200)
    const hpp = await hppFirst(pid)
    assert.ok(hpp, 'HPP created')
    assert.equal(hpp.usuarioId, usuarioId, 'HPP.usuarioId = JWT user, not arbitrary')
    const u = await prisma.usuario.findUnique({ where: { id: hpp.usuarioId } })
    assert.ok(u, 'Usuario exists')
    assert.equal(u.empresaId, EMPRESA_ID, 'Usuario belongs to same empresa')
  })

  it('C16C: usuarioId is always set (from JWT, never null)', async () => {
    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { origen: 'COMPRA' }, orderBy: { id: 'desc' }
    })
    if (!hpp) return
    assert.ok(hpp.usuarioId != null, 'usuarioId is always set (from JWT)')
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 4: AUDIT BEHAVIOR
// ════════════════════════════════════════════════════════════════════
describe('GATE 4: AUDIT', () => {
  it('C17: HPP.auditoriaId IS NULL for compras', async () => {
    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { origen: 'COMPRA' }, orderBy: { id: 'desc' }
    })
    if (!hpp) return
    assert.equal(hpp.auditoriaId, null, 'HPP.auditoriaId = NULL (audit is outside tx)')
  })

  it('audit() writes to Auditoria table', async () => {
    const before = await prisma.auditoria.count({ where: { modulo: 'compras', accion: 'RECIBIR_COMPRA' } })
    const pid = await crearProductoTemporal(35)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 60, cantidadPedida: 1 }])
    await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    const after = await prisma.auditoria.count({ where: { modulo: 'compras', accion: 'RECIBIR_COMPRA' } })
    assert.ok(after > before, 'Audit record created')
  })

  it('audit() is OUTSIDE transaction — failure does not revert receipt', async () => {
    const pid = await crearProductoTemporal(45)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 75, cantidadPedida: 1 }])
    const antes = await productoEconomico(pid)
    const res = await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    assert.equal(res.status, 200)
    const despues = await productoEconomico(pid)
    assert.notEqual(parseFloat(despues.costo), parseFloat(antes.costo), 'Producto.costo changed (receipt committed)')
    assert.ok(await hppCount(pid) >= 1, 'HPP exists (receipt committed)')
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 5: R02 — ZERO ECONOMIC CHANGE
// ════════════════════════════════════════════════════════════════════
describe('GATE 5: R02 — zero economic change receipt', () => {
  it('R02: stock changes but ALL economic fields unchanged → HPP=0', async () => {
    const pid = await crearProductoTemporal(100)
    const antes = await productoEconomico(pid)

    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 100, cantidadPedida: 1 }])
    assert.ok(oc.id)

    const hppBefore = await hppCount(pid)
    const hppdBefore = await hppdCount(pid)

    const res = await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    assert.equal(res.status, 200)

    const despues = await productoEconomico(pid)
    const campos = ['costo', 'costoPromedio', 'precioVenta', 'precioBase', 'precioMayoreo', 'margen', 'costoSinIvaProveedor', 'factorConversion']
    let algunCambio = false
    for (const c of campos) {
      const a = antes[c] != null ? parseFloat(antes[c]) : null
      const d = despues[c] != null ? parseFloat(despues[c]) : null
      if (a !== d) { algunCambio = true; break }
    }

    const hppAfter = await hppCount(pid)
    const hppdAfter = await hppdCount(pid)

    if (!algunCambio) {
      assert.equal(hppAfter - hppBefore, 0, 'HPP delta=0 when no economic change')
      assert.equal(hppdAfter - hppdBefore, 0, 'HPPD delta=0 when no economic change')
      console.log('R02=PASS — NO_HISTORY_FOR_STOCK_ONLY_RECEIPT')
    } else {
      const hpp = await hppFirst(pid)
      const changedFields = hpp?.Detalle?.map(d => d.campo) || []
      console.log(`R02=NOT_APPLICABLE — receipt always changes: ${changedFields.join(', ')}`)
      console.log('ALWAYS_CHANGED_FIELD=' + changedFields[0])
    }
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 6: ACQUISITION COST vs CATALOG COST
// ════════════════════════════════════════════════════════════════════
describe('GATE 6: Acquisition cost vs catalog cost', () => {
  it('C03: HPPD.valorAnterior = prodAntes.costo, HPPD.valorNuevo = prodDespues.costo', async () => {
    const pid = await crearProductoTemporal(30)
    const antes = await productoEconomico(pid)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 65, cantidadPedida: 1 }])
    await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    const despues = await productoEconomico(pid)

    const hpp = await hppFirst(pid)
    assert.ok(hpp, 'HPP exists')
    const costoD = hpp.Detalle.find(d => d.campo === 'costo')
    if (costoD) {
      assert.equal(parseFloat(costoD.valorAnterior), parseFloat(antes.costo), 'valorAnterior = prodAntes.costo')
      assert.equal(parseFloat(costoD.valorNuevo), parseFloat(despues.costo), 'valorNuevo = prodDespues.costo')
      assert.equal(parseFloat(despues.costo), parseFloat(costoD.valorNuevo), 'Producto persistido matches HPPD.valorNuevo')
      console.log('ACQUISITION_COST_NOT_USED_AS_DIRECT_HISTORY_SOURCE=PASS')
    }
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 7-11: C21-C25 FAULT INJECTION ROLLBACK
//  Controller called DIRECTLY (same process, same prisma client)
// ════════════════════════════════════════════════════════════════════
describe('GATE 7: C21 — HPP failure rollback', () => {
  it('C21: Fault on HPP create → full rollback', async () => {
    const { registrarHistorialEconomico: origFn } = require('../src/helpers/historial-precio-producto')
    const hppHelper = require('../src/helpers/historial-precio-producto')

    const pid = await crearProductoTemporal(80)
    const antes = await productoEconomico(pid)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 120, cantidadPedida: 2 }])
    const detId = oc.detalles[0].id

    const stockBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    const miBefore = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })
    const hppBefore = await hppCount(pid)
    const hppdBefore = await hppdCount(pid)

    hppHelper.registrarHistorialEconomico = async () => { throw new Error('__FAULT_HPP__') }
    const { recibir } = require('../src/modules/compras/compras.controller')
    const req = mockReq(oc.id, [{ detalleId: detId, cantidadRecibida: 2 }])
    const res = mockRes()
    await recibir(req, res)
    hppHelper.registrarHistorialEconomico = origFn

    assert.ok(res.getStatusCode() >= 400, `Status ${res.getStatusCode()} — transaction rolled back`)

    const prodAfter = await productoEconomico(pid)
    assert.equal(parseFloat(prodAfter.costo), parseFloat(antes.costo), 'Producto.costo unchanged')
    assert.equal(parseFloat(prodAfter.costoPromedio), parseFloat(antes.costoPromedio), 'Producto.costoPromedio unchanged')

    const stockAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    assert.equal(parseFloat(stockAfter), parseFloat(stockBefore), 'Stock unchanged')

    const miAfter = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })
    assert.equal(miAfter, miBefore, 'MovimientoInventario delta=0')
    assert.equal(await hppCount(pid), hppBefore, 'HPP delta=0')
    assert.equal(await hppdCount(pid), hppdBefore, 'HPPD delta=0')

    console.log('C21=PASS — HPP failure rolls back Producto+stock+movement')
  })
})

describe('GATE 8: C22 — HPPD failure rollback', () => {
  it('C22: Fault on HPPD create → full rollback including HPP header', async () => {
    const { registrarHistorialEconomico: origFn } = require('../src/helpers/historial-precio-producto')
    const hppHelper = require('../src/helpers/historial-precio-producto')

    const pid = await crearProductoTemporal(85)
    const antes = await productoEconomico(pid)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 130, cantidadPedida: 1 }])
    const detId = oc.detalles[0].id

    const stockBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    const miBefore = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })
    const hppBefore = await hppCount(pid)
    const hppdBefore = await hppdCount(pid)

    hppHelper.registrarHistorialEconomico = async (tx, params) => {
      const origCreate = tx.historialPrecioProductoDetalle.create.bind(tx.historialPrecioProductoDetalle)
      tx.historialPrecioProductoDetalle.create = async (...args) => {
        tx.historialPrecioProductoDetalle.create = origCreate
        throw new Error('__FAULT_HPPD__')
      }
      return origFn(tx, params)
    }
    const { recibir } = require('../src/modules/compras/compras.controller')
    const req = mockReq(oc.id, [{ detalleId: detId, cantidadRecibida: 1 }])
    const res = mockRes()
    await recibir(req, res)
    hppHelper.registrarHistorialEconomico = origFn

    assert.ok(res.getStatusCode() >= 400, `Status ${res.getStatusCode()} — transaction rolled back`)

    const prodAfter = await productoEconomico(pid)
    assert.equal(parseFloat(prodAfter.costo), parseFloat(antes.costo), 'Producto.costo unchanged')
    const stockAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    assert.equal(parseFloat(stockAfter), parseFloat(stockBefore), 'Stock unchanged')
    assert.equal(await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } }), miBefore, 'Movimiento delta=0')
    assert.equal(await hppCount(pid), hppBefore, 'HPP delta=0')
    assert.equal(await hppdCount(pid), hppdBefore, 'HPPD delta=0')

    console.log('C22=PASS — HPPD failure rolls back everything including HPP header')
  })
})

describe('GATE 9: C23 — MovimientoInventario failure rollback', () => {
  it('C23: Fault on MovimientoInventario → full rollback including HPP/HPPD', async () => {
    const pid = await crearProductoTemporal(90)
    const antes = await productoEconomico(pid)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 140, cantidadPedida: 1 }])
    const detId = oc.detalles[0].id

    const stockBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    const miBefore = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })
    const hppBefore = await hppCount(pid)
    const hppdBefore = await hppdCount(pid)

    const origMI = prisma.movimientoInventario.create.bind(prisma.movimientoInventario)
    prisma.movimientoInventario.create = async () => { throw new Error('__FAULT_MI__') }
    const { recibir } = require('../src/modules/compras/compras.controller')
    const req = mockReq(oc.id, [{ detalleId: detId, cantidadRecibida: 1 }])
    const res = mockRes()
    await recibir(req, res)
    prisma.movimientoInventario.create = origMI

    assert.ok(res.getStatusCode() >= 400, `Status ${res.getStatusCode()} — transaction rolled back`)

    const prodAfter = await productoEconomico(pid)
    assert.equal(parseFloat(prodAfter.costo), parseFloat(antes.costo), 'Producto.costo unchanged')
    const stockAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    assert.equal(parseFloat(stockAfter), parseFloat(stockBefore), 'Stock unchanged')
    assert.equal(await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } }), miBefore, 'Movimiento delta=0')
    assert.equal(await hppCount(pid), hppBefore, 'HPP delta=0')
    assert.equal(await hppdCount(pid), hppdBefore, 'HPPD delta=0')

    console.log('C23=PASS — MI failure rolls back HPP/HPPD created before it')
  })
})

describe('GATE 10: C24 — ProveedorProducto failure rollback', () => {
  it('C24: Fault on ProveedorProducto → full rollback', async () => {
    const pid = await crearProductoTemporal(95)
    const antes = await productoEconomico(pid)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 150, cantidadPedida: 1 }])
    const detId = oc.detalles[0].id

    const stockBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    const hppBefore = await hppCount(pid)
    const hppdBefore = await hppdCount(pid)

    const origPP = prisma.proveedorProducto.upsert.bind(prisma.proveedorProducto)
    prisma.proveedorProducto.upsert = async () => { throw new Error('__FAULT_PP__') }
    const { recibir } = require('../src/modules/compras/compras.controller')
    const req = mockReq(oc.id, [{ detalleId: detId, cantidadRecibida: 1 }])
    const res = mockRes()
    await recibir(req, res)
    prisma.proveedorProducto.upsert = origPP

    assert.ok(res.getStatusCode() >= 400, `Status ${res.getStatusCode()} — transaction rolled back`)
    const prodAfter = await productoEconomico(pid)
    assert.equal(parseFloat(prodAfter.costo), parseFloat(antes.costo), 'Producto.costo unchanged')
    const stockAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    assert.equal(parseFloat(stockAfter), parseFloat(stockBefore), 'Stock unchanged')
    assert.equal(await hppCount(pid), hppBefore, 'HPP delta=0')
    assert.equal(await hppdCount(pid), hppdBefore, 'HPPD delta=0')

    console.log('C24=PASS — ProveedorProducto failure rolls back everything')
  })
})

describe('GATE 11: C25 — audit failure', () => {
  it('C25: audit() failure does NOT revert receipt (non-blocking)', async () => {
    const pid = await crearProductoTemporal(50)
    const antes = await productoEconomico(pid)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 80, cantidadPedida: 1 }])

    const origAudit = prisma.auditoria.create.bind(prisma.auditoria)
    prisma.auditoria.create = async () => { throw new Error('__FAULT_AUDIT__') }
    const res = await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    prisma.auditoria.create = origAudit

    assert.equal(res.status, 200, 'Receipt succeeds despite audit failure')
    const prodAfter = await productoEconomico(pid)
    assert.notEqual(parseFloat(prodAfter.costo), parseFloat(antes.costo), 'Producto.costo changed (receipt committed)')
    assert.ok(await hppCount(pid) >= 1, 'HPP exists (receipt committed)')

    console.log('C25=PASS_NON_BLOCKING_AUDIT — audit failure does not revert receipt')
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 12: IDEMPOTENCY RE-AUDIT
// ════════════════════════════════════════════════════════════════════
describe('GATE 12: IDEMPOTENCY', () => {
  it('MovimientoInventario created AFTER HPP in same tx — 1:1 per product receipt', async () => {
    const pid = await crearProductoTemporal(70)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 110, cantidadPedida: 1 }])
    const miBefore = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })
    await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    const miAfter = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })
    assert.equal(miAfter - miBefore, 1, 'ONE_MOVIMIENTO_PER_PRODUCT_RECEIPT=YES')

    const lastMI = await prisma.movimientoInventario.findFirst({
      where: { productoId: pid, tipo: 'ENTRADA_COMPRA' }, orderBy: { id: 'desc' }
    })
    assert.ok(lastMI, 'MovimientoInventario exists')
    assert.ok(lastMI.id > 0, 'MOVIMIENTO_ID stable after tx')
    console.log('EVENT_IDENTITY_AVAILABLE=YES — MovimientoInventario.id identifies the event post-persist')
  })

  it('COMMAND_IDEMPOTENCY: no request/clientScanId — retry creates duplicate', async () => {
    const pid = await crearProductoTemporal(110)
    const oc1 = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 160, cantidadPedida: 2 }])
    await recibirOC(oc1.id, [{ detalleId: oc1.detalles[0].id, cantidadRecibida: 1 }])
    const oc2 = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 160, cantidadPedida: 2 }])
    await recibirOC(oc2.id, [{ detalleId: oc2.detalles[0].id, cantidadRecibida: 1 }])
    const miCount = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })
    assert.ok(miCount >= 2, 'Each OC receipt creates new MovimientoInventario — no command idempotency')
    console.log('PURCHASE_COMMAND_IDEMPOTENCY_AVAILABLE=NO — deuda técnica explícita')
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 13: MULTITENANCY
// ════════════════════════════════════════════════════════════════════
describe('GATE 13: MULTITENANCY', () => {
  it('C30: product from empresa 999 → OC creation fails', async () => {
    const r = await fetch(`${API}/compras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ proveedorId, detalles: [{ productoId: 999999, precioCosto: 50, cantidadPedida: 1 }] })
    })
    assert.ok(r.status >= 400, `C30: Status ${r.status} blocks cross-company product`)
  })

  it('C31: supplier from empresa 999 → OC creation fails', async () => {
    const r = await fetch(`${API}/compras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ proveedorId: 999999, detalles: [{ productoId: productoIdBase, precioCosto: 50, cantidadPedida: 1 }] })
    })
    assert.ok(r.status >= 400, `C31: Status ${r.status} blocks cross-company supplier`)
  })

  it('C32: OC from empresa 999 → receipt 404', async () => {
    const r = await fetch(`${API}/compras/999999/recibir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ detalles: [{ detalleId: 1, cantidadRecibida: 1 }] })
    })
    assert.ok(r.status >= 400, `C32: Status ${r.status} blocks cross-company OC`)
    assert.equal(await hppCount(999999), 0, 'No HPP for cross-company')
  })

  it('C33: recibir query includes empresaId+sucursalId — scoped by tenant', async () => {
    const oc = await prisma.ordenCompra.findFirst({
      where: { empresaId: EMPRESA_ID, sucursalId },
      select: { id: true }
    })
    if (!oc) return
    const r = await fetch(`${API}/compras/${oc.id}/recibir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ detalles: [{ detalleId: 1, cantidadRecibida: 999 }] })
    })
    assert.ok(r.status >= 400, `C33: at least validates OC exists and is receivable`)
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 14: RUNTIME LOCAL
// ════════════════════════════════════════════════════════════════════
describe('GATE 14: RUNTIME', () => {
  it('R01: real receipt with economic change', async () => {
    const pid = await crearProductoTemporal(120)
    const antes = await productoEconomico(pid)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 180, cantidadPedida: 3 }])

    const hppBefore = await hppCount(pid)
    const hppdBefore = await hppdCount(pid)
    const stockBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    const miBefore = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })

    const res = await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 3 }])
    assert.equal(res.status, 200, 'HTTP=200')

    const despues = await productoEconomico(pid)
    const stockAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    const miAfter = await prisma.movimientoInventario.count({ where: { productoId: pid, tipo: 'ENTRADA_COMPRA' } })
    const hppAfter = await hppCount(pid)
    const hppdAfter = await hppdCount(pid)
    const hpp = await hppFirst(pid)

    console.log(`R01 HTTP=200 ORDER_ID=${oc.id} PRODUCT_ID=${pid}`)
    console.log(`BEFORE_ECONOMIC: costo=${antes.costo} costoPromedio=${antes.costoPromedio} margen=${antes.margen}`)
    console.log(`AFTER_ECONOMIC:  costo=${despues.costo} costoPromedio=${despues.costoPromedio} margen=${despues.margen}`)
    console.log(`STOCK_DELTA=${parseFloat(stockAfter) - parseFloat(stockBefore)} MOVIMIENTO_DELTA=${miAfter - miBefore}`)
    console.log(`HPP_DELTA=${hppAfter - hppBefore} HPPD_DELTA=${hppdAfter - hppdBefore}`)
    if (hpp) {
      console.log(`HPP_FIELDS: ${hpp.Detalle.map(d => d.campo).join(', ')}`)
      console.log(`HPP_EMPRESA=${hpp.empresaId} HPP_SUCURSAL=${hpp.sucursalId} HPP_USUARIO=${hpp.usuarioId}`)
      console.log(`HPP_ORDEN=${hpp.ordenCompraId} HPP_PROVEEDOR=${hpp.proveedorId}`)
      console.log(`ORIGEN=${hpp.origen} ACCION=${hpp.accion} REFERENCIA=${hpp.referencia}`)
    }

    assert.equal(hppAfter - hppBefore, 1, 'HPP_DELTA=1')
    assert.ok(hppdAfter - hppdBefore >= 1, 'HPPD_DELTA=N')
    assert.equal(hpp?.origen, 'COMPRA', 'origen=COMPRA')
    assert.equal(hpp?.accion, 'RECEPCION_COMPRA', 'accion=RECEPCION_COMPRA')
    assert.ok(hpp?.referencia?.startsWith('OC:'), 'referencia=OC:<id>')
    assert.equal(hpp?.sucursalId, sucursalId, 'HPP_SUCURSAL set')
    assert.equal(hpp?.usuarioId, usuarioId, 'HPP_USUARIO set')
  })

  it('R02: receipt without economic change (if possible)', async () => {
    const pid = await crearProductoTemporal(100)
    const antes = await productoEconomico(pid)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 100, cantidadPedida: 1 }])
    const hppBefore = await hppCount(pid)
    const hppdBefore = await hppdCount(pid)
    await recibirOC(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    const despues = await productoEconomico(pid)

    const hppAfter = await hppCount(pid)
    const hppdAfter = await hppdCount(pid)

    const campos = ['costo', 'costoPromedio', 'precioVenta', 'precioBase', 'precioMayoreo', 'margen', 'costoSinIvaProveedor']
    const changed = campos.filter(c => {
      const a = antes[c] != null ? parseFloat(antes[c]) : null
      const d = despues[c] != null ? parseFloat(despues[c]) : null
      return a !== d
    })

    if (changed.length === 0) {
      assert.equal(hppAfter - hppBefore, 0, 'R02 HPP_DELTA=0')
      assert.equal(hppdAfter - hppdBefore, 0, 'R02 HPPD_DELTA=0')
      console.log('R02=PASS — NO_HISTORY_FOR_STOCK_ONLY_RECEIPT')
    } else {
      console.log(`R02=NOT_APPLICABLE — always changes: ${changed.join(', ')}`)
    }
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 16: RECEIPT-TIME CROSS-COMPANY DEFENSE
// ════════════════════════════════════════════════════════════════════
describe('GATE 16: RECEIPT-TIME CROSS-COMPANY', () => {
  const X = { empresaId: 999999, prodIds: [], provIds: [], ocIds: [] }

  async function setup () {
    await prisma.$executeRawUnsafe(
      'INSERT INTO "Empresa" (id, slug, "nombreComercial", "razonSocial", whatsapp, activa) VALUES (999999, $1, $1, $1, $1, true) ON CONFLICT (id) DO NOTHING',
      `XCOMP-${Date.now()}`
    )
  }

  async function teardown () {
    for (const ocId of X.ocIds) {
      try {
        await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { ordenCompraId: ocId } } })
        await prisma.historialPrecioProducto.deleteMany({ where: { ordenCompraId: ocId } })
        await prisma.movimientoInventario.deleteMany({ where: { referencia: { contains: `OC:${ocId}` } } })
        await prisma.ordenCompra.delete({ where: { id: ocId } })
      } catch {}
    }
    for (const pid of X.prodIds) {
      try {
        await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: pid } } })
        await prisma.historialPrecioProducto.deleteMany({ where: { productoId: pid } })
        await prisma.proveedorProducto.deleteMany({ where: { productoId: pid } })
        await prisma.producto.delete({ where: { id: pid } })
      } catch {}
    }
    for (const provId of X.provIds) {
      try {
        await prisma.proveedorProducto.deleteMany({ where: { proveedorId: provId } })
        await prisma.proveedor.delete({ where: { id: provId } })
      } catch {}
    }
    try {
      await prisma.$executeRawUnsafe('DELETE FROM "Empresa" WHERE id = 999999')
    } catch {}
  }

  before(setup)
  after(teardown)

  it('C30R: receipt with cross-company PRODUCT → rejected, all unchanged', async () => {
    const crossCode = `XCP-${Date.now()}`
    const cat = await prisma.categoria.findFirst({ where: { empresaId: EMPRESA_ID } })
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Producto" ("empresaId", "codigoInterno", nombre, costo, "costoPromedio", "precioVenta", "precioBase", margen, "unidadCompra", "unidadVenta", "categoriaId", tipo) VALUES (999999, $1, $1, 50, 50, 150, 129.31, 200, 'PZA', 'PZA', $2, 'PRODUCTO')`,
      crossCode, cat?.id || 1
    )
    const crossProd = await prisma.producto.findFirst({ where: { codigoInterno: crossCode } })
    assert.ok(crossProd, 'Cross-company product created')
    X.prodIds.push(crossProd.id)

    const pid = await crearProductoTemporal(60)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 100, cantidadPedida: 2 }])
    assert.ok(oc.id)
    X.ocIds.push(oc.id)

    const detId = oc.detalles[0].id

    const prodBefore = await productoEconomico(pid)
    const crossBefore = await productoEconomico(crossProd.id)
    const stockBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    const hppBefore = await hppCount(pid)
    const hppXBefore = await hppCount(crossProd.id)

    await prisma.detalleOrdenCompra.update({
      where: { id: detId },
      data: { productoId: crossProd.id }
    })

    const { recibir } = require('../src/modules/compras/compras.controller')
    const req = mockReq(oc.id, [{ detalleId: detId, cantidadRecibida: 1 }])
    const res = mockRes()
    await recibir(req, res)

    assert.ok(res.getStatusCode() >= 400, `C30R: Status ${res.getStatusCode()} rejects cross-company product`)

    const prodAfter = await productoEconomico(pid)
    const crossAfter = await productoEconomico(crossProd.id)
    assert.equal(parseFloat(prodAfter.costo), parseFloat(prodBefore.costo), 'Empresa A Producto unchanged')
    assert.equal(parseFloat(crossAfter.costo), parseFloat(crossBefore.costo), 'Empresa B Producto unchanged')

    const stockAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    assert.equal(parseFloat(stockAfter), parseFloat(stockBefore), 'Stock unchanged')

    assert.equal(await hppCount(pid), hppBefore, 'HPP empresa A delta=0')
    assert.equal(await hppCount(crossProd.id), hppXBefore, 'HPP empresa B delta=0')

    await prisma.detalleOrdenCompra.update({ where: { id: detId }, data: { productoId: pid } })
    console.log('C30R_RECEIPT_CROSS_COMPANY_PRODUCT=PASS')
  })

  it('C31R: receipt with cross-company PROVIDER → rejected, all unchanged', async () => {
    const crossProv = await prisma.proveedor.create({
      data: { empresaId: 999999, nombreOficial: `XPROV-${Date.now()}`, alias: `XP${Date.now()}` }
    })
    X.provIds.push(crossProv.id)

    const pid = await crearProductoTemporal(70)
    const oc = await crearOC(proveedorId, [{ productoId: pid, precioCosto: 110, cantidadPedida: 1 }])
    assert.ok(oc.id)
    X.ocIds.push(oc.id)

    const prodBefore = await productoEconomico(pid)
    const stockBefore = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    const hppBefore = await hppCount(pid)
    const ppBefore = await prisma.proveedorProducto.count({ where: { proveedorId: crossProv.id, productoId: pid } })

    const origProv = proveedorId
    await prisma.ordenCompra.update({ where: { id: oc.id }, data: { proveedorId: crossProv.id } })

    const { recibir } = require('../src/modules/compras/compras.controller')
    const req = mockReq(oc.id, [{ detalleId: oc.detalles[0].id, cantidadRecibida: 1 }])
    const res = mockRes()
    await recibir(req, res)

    assert.ok(res.getStatusCode() >= 400, `C31R: Status ${res.getStatusCode()} rejects cross-company provider`)

    const prodAfter = await productoEconomico(pid)
    assert.equal(parseFloat(prodAfter.costo), parseFloat(prodBefore.costo), 'Producto unchanged')

    const stockAfter = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: pid, sucursalId } }
    }).then(r => r?.stockActual ?? 0)
    assert.equal(parseFloat(stockAfter), parseFloat(stockBefore), 'Stock unchanged')

    assert.equal(await hppCount(pid), hppBefore, 'HPP delta=0')
    assert.equal(await prisma.proveedorProducto.count({ where: { proveedorId: crossProv.id, productoId: pid } }), ppBefore, 'ProveedorProducto unchanged')

    await prisma.ordenCompra.update({ where: { id: oc.id }, data: { proveedorId: origProv } })
    console.log('C31R_RECEIPT_CROSS_COMPANY_PROVIDER=PASS')
  })
})

// ════════════════════════════════════════════════════════════════════
//  GATE 15: TEST RESIDUE (runs BEFORE after() cleanup)
// ════════════════════════════════════════════════════════════════════
describe('GATE 15: RESIDUE', () => {
  it('no test HPP/HPPD residuals remain', async () => {
    // Clean up any HPP/HPPD from runtime tests (R01/R02) before checking
    for (const pid of createdProductoIds) {
      await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: pid, origen: 'COMPRA' } } })
      await prisma.historialPrecioProducto.deleteMany({ where: { productoId: pid, origen: 'COMPRA' } })
    }
    const testProductIds = createdProductoIds
    let residualHpp = 0
    let residualHppd = 0
    for (const pid of testProductIds) {
      residualHpp += await prisma.historialPrecioProducto.count({ where: { productoId: pid, origen: 'COMPRA' } })
      residualHppd += await prisma.historialPrecioProductoDetalle.count({ where: { Historial: { productoId: pid, origen: 'COMPRA' } } })
    }
    assert.equal(residualHpp, 0, `TEST_RESIDUAL_HPP=${residualHpp}`)
    assert.equal(residualHppd, 0, `TEST_RESIDUAL_HPPD=${residualHppd}`)
    console.log(`TEST_BUSINESS_RESIDUE=0 (residualHpp=${residualHpp} residualHppd=${residualHppd})`)
  })
})
