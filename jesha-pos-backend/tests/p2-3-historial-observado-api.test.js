'use strict'

require('dotenv').config()

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const jwt = require('jsonwebtoken')
const prisma = require('../src/lib/prisma')

const API = 'http://localhost:3000'
const EMPRESA_ID = 1
const OTRA_EMPRESA_ID = 17
const TOKEN_OPTIONS = {
  algorithm: 'HS256',
  issuer: process.env.TENANT_JWT_ISSUER,
  audience: process.env.TENANT_JWT_AUDIENCE,
  expiresIn: '15m'
}

let admin
let otherAdmin
let tokenAdmin
let tokenEmpleado
let tokenOther
let productoId
let proveedorId
let foreignProveedorId
let ordenCompraId
let ventaIds = []
let movimientoIds = []
let sucursalId
let otraSucursalId
let eventosCompra
let eventosVenta

function token(usuario) {
  return jwt.sign({ version: 1, kind: 'TENANT', sub: usuario.id, rol: usuario.rol }, process.env.TENANT_JWT_SECRET, TOKEN_OPTIONS)
}

async function get(path, authToken = tokenAdmin, headers = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...headers }
  })
  return { status: response.status, body: await response.json() }
}

function date(day) {
  return new Date(`2026-02-${String(day).padStart(2, '0')}T10:00:00.000Z`)
}

function assertDecimal(value, expected) {
  assert.equal(value, expected)
}

describe('P2-3 Phase 2B — historial observado de compras y ventas', { concurrency: 1, timeout: 180000 }, () => {
  before(async () => {
    ;[admin, otherAdmin] = await Promise.all([
      prisma.usuario.findFirst({ where: { empresaId: EMPRESA_ID, rol: 'ADMIN_SUCURSAL', activo: true } }),
      prisma.usuario.findFirst({ where: { empresaId: OTRA_EMPRESA_ID, rol: 'ADMIN_SUCURSAL', activo: true } })
    ])
    const empleado = await prisma.usuario.findFirst({ where: { empresaId: EMPRESA_ID, rol: 'EMPLEADO', activo: true } })
    assert.ok(admin && otherAdmin && empleado)
    tokenAdmin = token(admin)
    tokenEmpleado = token(empleado)
    tokenOther = token(otherAdmin)
    sucursalId = admin.sucursalId
    otraSucursalId = otherAdmin.sucursalId

    const categoria = await prisma.categoria.findFirst({ where: { OR: [{ empresaId: EMPRESA_ID }, { esGlobal: true }] } })
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const producto = await prisma.producto.create({
      data: {
        empresaId: EMPRESA_ID,
        codigoInterno: `P23-2B-${suffix}`,
        nombre: 'P2-3 Phase 2B observed fixture',
        categoriaId: categoria.id,
        tipo: 'PRODUCTO',
        precioBase: 116,
        precioVenta: 135,
        costo: 80,
        costoPromedio: 75,
        precioMayoreo: 125,
        unidadCompra: 'CAJA',
        unidadVenta: 'PZA',
        factorConversion: 10,
        claveSat: '43232300',
        unidadSat: 'H87'
      }
    })
    productoId = producto.id

    const proveedor = await prisma.proveedor.create({
      data: { empresaId: EMPRESA_ID, nombreOficial: `P2-3 proveedor ${suffix}`, alias: `P23-2B-${suffix}` }
    })
    proveedorId = proveedor.id
    const foreignProveedor = await prisma.proveedor.create({
      data: { empresaId: OTRA_EMPRESA_ID, nombreOficial: `P2-3 proveedor foreign ${suffix}`, alias: `P23-2B-F-${suffix}` }
    })
    foreignProveedorId = foreignProveedor.id

    const orden = await prisma.ordenCompra.create({
      data: {
        empresaId: EMPRESA_ID,
        folio: `P23-2B-${suffix}`,
        sucursalId,
        proveedorId,
        usuarioId: admin.id,
        totalEstimado: 300
      }
    })
    ordenCompraId = orden.id
    await prisma.detalleOrdenCompra.create({
      data: {
        ordenCompraId,
        productoId,
        cantidadPedida: 30,
        cantidadRecibida: 30,
        precioCosto: 100,
        subtotalPedido: 300,
        subtotalRecibido: 300,
        factorConversionSnapshot: 10,
        unidadCompraSnapshot: 'CAJA',
        unidadVentaSnapshot: 'PZA',
        costoUnitarioVenta: 10
      }
    })

    const movements = [
      { cantidad: 10, costoUnitario: 10, stockAntes: 0, stockDespues: 10, creadoEn: date(1) },
      { cantidad: 20, costoUnitario: 12, stockAntes: 10, stockDespues: 30, creadoEn: date(2) },
      { cantidad: 5, costoUnitario: 8, stockAntes: 30, stockDespues: 35, creadoEn: date(3) }
    ]
    for (const movement of movements) {
      const row = await prisma.movimientoInventario.create({
        data: {
          empresaId: EMPRESA_ID,
          productoId,
          sucursalId,
          usuarioId: admin.id,
          tipo: 'ENTRADA_COMPRA',
          referencia: orden.folio,
          ...movement
        }
      })
      movimientoIds.push(row.id)
    }
    eventosCompra = movements

    const turno = await prisma.turnoCaja.findFirst({ where: { empresaId: EMPRESA_ID, sucursalId } })
    assert.ok(turno, 'Se requiere un turno local para fixture de venta')
    const sales = [
      { id: 1, amount: 100, quantity: 2, created: date(4), state: 'COMPLETADA' },
      { id: 2, amount: 80, quantity: 1.5, created: date(5), state: 'COMPLETADA' },
      { id: 3, amount: 120, quantity: 1, created: date(6), state: 'DEVOLUCION' },
      { id: 4, amount: 999, quantity: 1, created: date(7), state: 'CANCELADA' }
    ]
    for (const sale of sales) {
      const venta = await prisma.venta.create({
        data: {
          empresaId: EMPRESA_ID,
          folio: `P23-2B-V-${suffix}-${sale.id}`,
          sucursalId,
          usuarioId: admin.id,
          turnoId: turno.id,
          metodoPago: 'EFECTIVO',
          subtotal: sale.amount * sale.quantity,
          descuento: 0,
          total: sale.amount * sale.quantity,
          montoPagado: sale.amount * sale.quantity,
          estadoPago: 'PAGADA',
          estado: sale.state,
          tokenQr: `P23-2B-${suffix}-${sale.id}`,
          creadaEn: sale.created,
          DetalleVenta: {
            create: {
              productoId,
              cantidad: sale.quantity,
              precioUnitario: sale.amount,
              descuento: sale.id === 2 ? 5 : 0,
              subtotal: sale.amount * sale.quantity
            }
          }
        }
      })
      ventaIds.push(venta.id)
    }
    eventosVenta = sales
  })

  after(async () => {
    if (ventaIds.length) await prisma.venta.deleteMany({ where: { id: { in: ventaIds } } })
    if (movimientoIds.length) await prisma.movimientoInventario.deleteMany({ where: { id: { in: movimientoIds } } })
    if (ordenCompraId) await prisma.detalleOrdenCompra.deleteMany({ where: { ordenCompraId } })
    if (ordenCompraId) await prisma.ordenCompra.deleteMany({ where: { id: ordenCompraId } })
    if (proveedorId) await prisma.proveedor.deleteMany({ where: { id: proveedorId } })
    if (foreignProveedorId) await prisma.proveedor.deleteMany({ where: { id: foreignProveedorId } })
    if (productoId) await prisma.producto.deleteMany({ where: { id: productoId } })
    await prisma.$disconnect()
  })

  it('B01 producto sin compras devuelve []', async () => {
    const { body } = await get('/productos/999999999/historial-compras')
    assert.equal(body.error, 'Producto no encontrado')
  })
  it('B02 una o varias compras se consultan', async () => {
    const { status, body } = await get(`/productos/${productoId}/historial-compras`)
    assert.equal(status, 200); assert.equal(body.compras.length, 3)
  })
  it('B03 compras ordenadas DESC', async () => {
    const { body } = await get(`/productos/${productoId}/historial-compras`)
    assert.deepEqual(body.compras.map(x => x.fecha), [...body.compras.map(x => x.fecha)].sort().reverse())
  })
  it('B04 desempate determinista por id', async () => {
    const { body } = await get(`/productos/${productoId}/historial-compras?page=1&limit=1`)
    assert.equal(body.compras.length, 1); assert.equal(body.compras[0].id, movimientoIds[2])
  })
  it('B05 costo viene de MovimientoInventario', async () => {
    const { body } = await get(`/productos/${productoId}/historial-compras`)
    assert.deepEqual(body.compras.map(x => x.costoUnitario), ['8.00', '12.00', '10.00'])
  })
  it('B06 no usa Producto.costo', async () => {
    const { body } = await get(`/productos/${productoId}/historial-compras`)
    assert.ok(!body.compras.some(x => x.costoUnitario === '80.00'))
  })
  it('B07 proveedor correcto', async () => {
    const { body } = await get(`/productos/${productoId}/historial-compras`)
    assert.equal(body.compras[0].proveedor.id, proveedorId)
  })
  it('B08 sucursal correcta', async () => {
    const { body } = await get(`/productos/${productoId}/historial-compras`)
    assert.equal(body.compras[0].sucursal.id, sucursalId)
  })
  it('B09 decimales y unidades preservados', async () => {
    const { body } = await get(`/productos/${productoId}/historial-compras`)
    assertDecimal(body.compras[0].cantidad, '5.000'); assert.equal(body.compras[0].unidadCompra, 'CAJA')
  })
  it('B10 page 1', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?page=1&limit=2`); assert.equal(body.compras.length, 2) })
  it('B11 page 2', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?page=2&limit=2`); assert.equal(body.compras.length, 1) })
  it('B12 total', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?limit=2`); assert.equal(body.paginacion.total, 3) })
  it('B13 totalPages', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?limit=2`); assert.equal(body.paginacion.totalPages, 2) })
  it('B14 desde inclusive', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?desde=2026-02-02`); assert.equal(body.paginacion.total, 2) })
  it('B15 hasta inclusive', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?hasta=2026-02-02`); assert.equal(body.paginacion.total, 2) })
  it('B16 proveedor filter', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?proveedorId=${proveedorId}`); assert.equal(body.paginacion.total, 3) })
  it('B17 sucursal filter', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?sucursalId=${sucursalId}`); assert.equal(body.paginacion.total, 3) })
  it('B18 cross-company provider blocked', async () => { assert.ok(foreignProveedorId); const result = await get(`/productos/${productoId}/historial-compras?proveedorId=${foreignProveedorId}`); assert.equal(result.status, 404) })
  it('B19 cross-company branch blocked', async () => { const result = await get(`/productos/${productoId}/historial-compras?sucursalId=${otraSucursalId}`); assert.equal(result.status, 403) })
  it('B20 purchase min', async () => { const { body } = await get(`/productos/${productoId}/historial-compras`); assert.equal(body.resumen.min, '8.00') })
  it('B21 purchase max', async () => { const { body } = await get(`/productos/${productoId}/historial-compras`); assert.equal(body.resumen.max, '12.00') })
  it('B22 last purchase', async () => { const { body } = await get(`/productos/${productoId}/historial-compras`); assert.equal(body.resumen.ultima, date(3).toISOString()) })
  it('B23 weighted purchase average', async () => { const { body } = await get(`/productos/${productoId}/historial-compras`); assert.equal(body.resumen.promedio, '10.8571') })
  it('B24 purchase summary ignores page', async () => { const { body } = await get(`/productos/${productoId}/historial-compras?limit=1`); assert.equal(body.resumen.max, '12.00') })
  it('B25 sales source responds', async () => { const { status, body } = await get(`/productos/${productoId}/historial-ventas`); assert.equal(status, 200); assert.equal(body.ventas.length, 3) })
  it('B26 one sale row shape', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?page=1&limit=1`); assert.equal(body.ventas.length, 1); assert.equal(body.ventas[0].ventaId, ventaIds[2]) })
  it('B27 sales DESC', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.deepEqual(body.ventas.map(x => x.fecha), [...body.ventas.map(x => x.fecha)].sort().reverse()) })
  it('B28 price comes from DetalleVenta', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.deepEqual(body.ventas.map(x => x.precioUnitario), ['120.00', '80.00', '100.00']) })
  it('B29 price differs from catalog when observed', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.ok(body.ventas.some(x => x.precioUnitario !== '135.00')) })
  it('B30 decimal quantity preserved', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.equal(body.ventas.find(x => x.ventaId === ventaIds[1]).cantidad, '1.500') })
  it('B31 cancelled sale excluded', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.ok(!body.ventas.some(x => x.ventaId === ventaIds[3])) })
  it('B32 tenant correct', async () => { const result = await get(`/productos/${productoId}/historial-ventas`, tokenOther); assert.equal(result.status, 404) })
  it('B33 branch correct', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?sucursalId=${sucursalId}`); assert.equal(body.paginacion.total, 3) })
  it('B34 sales page 1', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?page=1&limit=2`); assert.equal(body.ventas.length, 2) })
  it('B35 sales page 2', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?page=2&limit=2`); assert.equal(body.ventas.length, 1) })
  it('B36 sales total', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?limit=2`); assert.equal(body.paginacion.total, 3) })
  it('B37 sales totalPages', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?limit=2`); assert.equal(body.paginacion.totalPages, 2) })
  it('B38 sales desde', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?desde=2026-02-05`); assert.equal(body.paginacion.total, 2) })
  it('B39 sales hasta', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?hasta=2026-02-05`); assert.equal(body.paginacion.total, 2) })
  it('B40 sales branch filter', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?sucursalId=${sucursalId}`); assert.equal(body.paginacion.total, 3) })
  it('B41 cross-company branch blocked for sales', async () => { const result = await get(`/productos/${productoId}/historial-ventas?sucursalId=${otraSucursalId}`); assert.equal(result.status, 403) })
  it('B42 sales min', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.equal(body.resumen.min, '80.00') })
  it('B43 sales max', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.equal(body.resumen.max, '120.00') })
  it('B44 last sale', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.equal(body.resumen.ultima, date(6).toISOString()) })
  it('B45 weighted sales average', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.equal(body.resumen.promedio, '97.7778') })
  it('B46 sales summary ignores page', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas?limit=1`); assert.equal(body.resumen.max, '120.00') })
  it('B47 no auth purchases 401', async () => { const result = await get(`/productos/${productoId}/historial-compras`, null); assert.equal(result.status, 401) })
  it('B48 no auth sales 401', async () => { const result = await get(`/productos/${productoId}/historial-ventas`, null); assert.equal(result.status, 401) })
  it('B49 EMPLEADO purchases 403', async () => { const result = await get(`/productos/${productoId}/historial-compras`, tokenEmpleado); assert.equal(result.status, 403) })
  it('B50 EMPLEADO sales 403', async () => { const result = await get(`/productos/${productoId}/historial-ventas`, tokenEmpleado); assert.equal(result.status, 403) })
  it('B51 authorized purchases 200', async () => { const result = await get(`/productos/${productoId}/historial-compras`); assert.equal(result.status, 200) })
  it('B52 authorized sales 200', async () => { const result = await get(`/productos/${productoId}/historial-ventas`); assert.equal(result.status, 200) })
  it('B53 platform direct no bypass', async () => { const platform = await prisma.usuario.findFirst({ where: { empresaId: null, rol: 'PLATFORM_ADMIN', activo: true } }); const result = await get(`/productos/${productoId}/historial-ventas`, token(platform)); assert.equal(result.status, 401) })
  it('B54 cross-company product purchases denied', async () => { const result = await get('/productos/999999999/historial-compras', tokenOther); assert.equal(result.status, 404) })
  it('B55 cross-company product sales denied', async () => { const result = await get('/productos/999999999/historial-ventas', tokenOther); assert.equal(result.status, 404) })
  it('B56 purchase is not HPP event', async () => { const { body } = await get(`/productos/${productoId}/historial-economico`); assert.ok(!body.historial.some(x => x.accion === 'ENTRADA_COMPRA')) })
  it('B57 sale is not HPP event', async () => { const { body } = await get(`/productos/${productoId}/historial-economico`); assert.ok(!body.historial.some(x => x.ventaId)) })
  it('B58 purchases do not return DetalleVenta', async () => { const { body } = await get(`/productos/${productoId}/historial-compras`); assert.ok(!JSON.stringify(body).includes('DetalleVenta')) })
  it('B59 sales do not return DetalleOrdenCompra', async () => { const { body } = await get(`/productos/${productoId}/historial-ventas`); assert.ok(!JSON.stringify(body).includes('DetalleOrdenCompra')) })
  it('B60 catalog and observed prices remain separate', async () => { const [catalog, sales] = await Promise.all([get(`/productos/${productoId}/historial-economico`), get(`/productos/${productoId}/historial-ventas`)]); assert.equal(catalog.body.actual.precioVenta, '135.0000'); assert.ok(sales.body.ventas.some(x => x.precioUnitario === '80.00')) })
  it('B61 summary uses full observed dataset', async () => { const result = await get(`/productos/${productoId}/historial-ventas?page=2&limit=1`); assert.equal(result.body.resumen.promedio, '97.7778') })
})
