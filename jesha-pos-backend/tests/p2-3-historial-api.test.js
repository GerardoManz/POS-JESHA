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

let tokenAdmin
let tokenSuperadmin
let tokenPrecios
let tokenEmpleado
let tokenOtraEmpresa
let tokenPlatformDirecto
let productoId
let productoSinHistorialId
let productoUnEventoId
let proveedorId
let ordenCompraId
let eventos

function tenantToken(usuario) {
  return jwt.sign(
    { version: 1, kind: 'TENANT', sub: usuario.id, rol: usuario.rol },
    process.env.TENANT_JWT_SECRET,
    TOKEN_OPTIONS
  )
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

async function getHistorial(id = productoId, query = '', token = tokenAdmin) {
  const response = await fetch(`${API}/productos/${id}/historial-economico${query}`, {
    headers: token ? authHeaders(token) : {}
  })
  const body = await response.json()
  return { status: response.status, body }
}

async function crearEvento(data, detalles) {
  return prisma.historialPrecioProducto.create({
    data: {
      empresaId: EMPRESA_ID,
      productoId,
      accion: 'TEST_API_HISTORIAL',
      referencia: `PRODUCTO:${productoId}`,
      ...data,
      Detalle: { create: detalles }
    }
  })
}

describe('P2-3 Phase 2A — API historial económico', { concurrency: 1, timeout: 180000 }, () => {
  before(async () => {
    const [admin, superadmin, precios, empleado, otroAdmin, platformAdmin] = await Promise.all([
      prisma.usuario.findFirst({ where: { empresaId: EMPRESA_ID, rol: 'ADMIN_SUCURSAL', activo: true } }),
      prisma.usuario.findFirst({ where: { empresaId: EMPRESA_ID, rol: 'SUPERADMIN', activo: true } }),
      prisma.usuario.findFirst({ where: { empresaId: EMPRESA_ID, rol: 'PRECIOS', activo: true } }),
      prisma.usuario.findFirst({ where: { empresaId: EMPRESA_ID, rol: 'EMPLEADO', activo: true } }),
      prisma.usuario.findFirst({ where: { empresaId: OTRA_EMPRESA_ID, rol: 'ADMIN_SUCURSAL', activo: true } }),
      prisma.usuario.findFirst({ where: { empresaId: null, rol: 'PLATFORM_ADMIN', activo: true } })
    ])
    assert.ok(admin && superadmin && precios && empleado && otroAdmin && platformAdmin, 'Usuarios de prueba disponibles')

    tokenAdmin = tenantToken(admin)
    tokenSuperadmin = tenantToken(superadmin)
    tokenPrecios = tenantToken(precios)
    tokenEmpleado = tenantToken(empleado)
    tokenOtraEmpresa = tenantToken(otroAdmin)
    tokenPlatformDirecto = jwt.sign(
      { version: 1, kind: 'PLATFORM', sub: platformAdmin.id, rol: 'PLATFORM_ADMIN' },
      process.env.TENANT_JWT_SECRET,
      TOKEN_OPTIONS
    )

    const categoria = await prisma.categoria.findFirst({
      where: { OR: [{ empresaId: EMPRESA_ID }, { esGlobal: true }] }
    })
    assert.ok(categoria, 'Categoría de prueba disponible')

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const commonProduct = {
      empresaId: EMPRESA_ID,
      categoriaId: categoria.id,
      tipo: 'PRODUCTO',
      costo: 50,
      costoPromedio: 45,
      precioBase: 107.7586,
      precioVenta: 125,
      precioMayoreo: 115,
      margen: 150,
      costoSinIvaProveedor: 43.1034,
      factorConversion: 1,
      unidadCompra: 'PZA',
      unidadVenta: 'PZA',
      claveSat: '43232300',
      unidadSat: 'H87'
    }

    const [producto, productoSinHistorial, productoUnEvento] = await Promise.all([
      prisma.producto.create({
        data: { ...commonProduct, codigoInterno: `P23-2A-MAIN-${suffix}`, nombre: 'P2-3 Phase 2A main fixture' }
      }),
      prisma.producto.create({
        data: { ...commonProduct, codigoInterno: `P23-2A-EMPTY-${suffix}`, nombre: 'P2-3 Phase 2A empty fixture' }
      }),
      prisma.producto.create({
        data: { ...commonProduct, codigoInterno: `P23-2A-ONE-${suffix}`, nombre: 'P2-3 Phase 2A one-event fixture' }
      })
    ])
    productoId = producto.id
    productoSinHistorialId = productoSinHistorial.id
    productoUnEventoId = productoUnEvento.id

    const proveedor = await prisma.proveedor.create({
      data: {
        empresaId: EMPRESA_ID,
        nombreOficial: `P2-3 Phase 2A proveedor ${suffix}`,
        alias: `P23-2A-${suffix}`
      }
    })
    proveedorId = proveedor.id

    const ordenCompra = await prisma.ordenCompra.create({
      data: {
        empresaId: EMPRESA_ID,
        folio: `P23-2A-${suffix}`,
        sucursalId: admin.sucursalId,
        proveedorId,
        usuarioId: admin.id,
        totalEstimado: 50
      }
    })
    ordenCompraId = ordenCompra.id

    const t1 = new Date('2026-01-01T10:00:00.000Z')
    const t2 = new Date('2026-01-02T10:00:00.000Z')
    const t3 = new Date('2026-01-03T10:00:00.000Z')
    const t4 = new Date('2026-01-04T10:00:00.000Z')
    const t5 = new Date('2026-01-05T10:00:00.000Z')

    eventos = []
    eventos.push(await crearEvento(
      { origen: 'CREACION_PRODUCTO', ocurridoEn: t1, registradoEn: t1 },
      [
        { campo: 'precioVenta', valorAnterior: null, valorNuevo: '100.1234' },
        { campo: 'costo', valorAnterior: null, valorNuevo: '0.0000' }
      ]
    ))
    eventos.push(await crearEvento(
      { origen: 'EDICION_PRECIOS', ocurridoEn: t2, registradoEn: t2, usuarioId: precios.id },
      [
        { campo: 'precioVenta', valorAnterior: '100.1234', valorNuevo: '110.0000' },
        { campo: 'precioBase', valorAnterior: '86.3133', valorNuevo: '94.8276' }
      ]
    ))
    eventos.push(await crearEvento(
      {
        origen: 'COMPRA',
        ocurridoEn: t3,
        registradoEn: t3,
        usuarioId: admin.id,
        sucursalId: admin.sucursalId,
        ordenCompraId,
        proveedorId,
        contexto: { secretoInterno: 'NO_EXPOSER' },
        notas: 'NO_EXPOSER'
      },
      [
        { campo: 'costo', valorAnterior: '0.0000', valorNuevo: '50.0000' },
        { campo: 'costoPromedio', valorAnterior: '0.0000', valorNuevo: '45.0000' },
        { campo: 'margen', valorAnterior: '100.0000', valorNuevo: '120.0000' }
      ]
    ))
    eventos.push(await crearEvento(
      { origen: 'EDICION_PRODUCTO', ocurridoEn: t4, registradoEn: t4, usuarioId: superadmin.id },
      [
        { campo: 'margen', valorAnterior: '120.0000', valorNuevo: '130.0000' },
        { campo: 'precioVenta', valorAnterior: '110.0000', valorNuevo: '120.0000' },
        { campo: 'precioBase', valorAnterior: '94.8276', valorNuevo: '103.4483' }
      ]
    ))
    eventos.push(await crearEvento(
      { origen: 'IMPORTACION', ocurridoEn: t5, registradoEn: t5 },
      [{ campo: 'precioVenta', valorAnterior: '120.0000', valorNuevo: '124.0000' }]
    ))
    eventos.push(await crearEvento(
      { origen: 'DUPLICACION_PRODUCTO', ocurridoEn: t5, registradoEn: t5 },
      [{ campo: 'precioVenta', valorAnterior: '124.0000', valorNuevo: '125.0000' }]
    ))

    await prisma.historialPrecioProducto.create({
      data: {
        empresaId: EMPRESA_ID,
        productoId: productoUnEventoId,
        origen: 'CREACION_PRODUCTO',
        accion: 'TEST_API_HISTORIAL',
        referencia: `PRODUCTO:${productoUnEventoId}`,
        ocurridoEn: t1,
        registradoEn: t1,
        Detalle: { create: [{ campo: 'precioVenta', valorAnterior: null, valorNuevo: '100.0000' }] }
      }
    })

    // Registro deliberadamente inconsistente para demostrar que HPP también se filtra por empresaId.
    await prisma.historialPrecioProducto.create({
      data: {
        empresaId: OTRA_EMPRESA_ID,
        productoId,
        origen: 'COMPRA',
        accion: 'TEST_CROSS_TENANT',
        referencia: `PRODUCTO:${productoId}`,
        ocurridoEn: new Date('2026-01-06T10:00:00.000Z'),
        Detalle: { create: [{ campo: 'costo', valorAnterior: '50.0000', valorNuevo: '999.0000' }] }
      }
    })
  })

  after(async () => {
    const ids = [productoId, productoSinHistorialId, productoUnEventoId].filter(Boolean)
    await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: { in: ids } } } })
    await prisma.historialPrecioProducto.deleteMany({ where: { productoId: { in: ids } } })
    if (ordenCompraId) await prisma.ordenCompra.deleteMany({ where: { id: ordenCompraId } })
    if (proveedorId) await prisma.proveedor.deleteMany({ where: { id: proveedorId } })
    await prisma.producto.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  it('A01 producto con 0 eventos -> 200 + []', async () => {
    const { status, body } = await getHistorial(productoSinHistorialId)
    assert.equal(status, 200)
    assert.deepEqual(body.historial, [])
    assert.deepEqual(body.paginacion, { page: 1, limit: 50, total: 0, totalPages: 0 })
    assert.equal(body.meta.primerEventoRegistradoEn, null)
  })

  it('A02 producto con 1 evento -> 1 evento', async () => {
    const { status, body } = await getHistorial(productoUnEventoId)
    assert.equal(status, 200)
    assert.equal(body.historial.length, 1)
    assert.equal(body.paginacion.total, 1)
  })

  it('A03 evento con N detalles -> todos incluidos', async () => {
    const { body } = await getHistorial(productoId, '?origen=COMPRA')
    assert.deepEqual(body.historial[0].detalles.map(d => d.campo), ['costo', 'costoPromedio', 'margen'])
  })

  it('A04 creación NULL->valor conserva null', async () => {
    const { body } = await getHistorial(productoId, '?origen=CREACION_PRODUCTO')
    assert.equal(body.historial[0].detalles.find(d => d.campo === 'precioVenta').valorAnterior, null)
  })

  it('A05 valor 0 se devuelve como 0, no null', async () => {
    const { body } = await getHistorial(productoId, '?origen=CREACION_PRODUCTO')
    assert.equal(body.historial[0].detalles.find(d => d.campo === 'costo').valorNuevo, '0.0000')
  })

  it('A06 Decimal conserva precisión', async () => {
    const { body } = await getHistorial(productoId, '?origen=CREACION_PRODUCTO')
    assert.equal(body.historial[0].detalles.find(d => d.campo === 'precioVenta').valorNuevo, '100.1234')
    assert.equal(body.actual.costoSinIvaProveedor, '43.1000')
  })

  it('A07 orden ocurridoEn DESC', async () => {
    const { body } = await getHistorial()
    const times = body.historial.map(e => new Date(e.ocurridoEn).getTime())
    assert.deepEqual(times, [...times].sort((a, b) => b - a))
  })

  it('A08 mismo ocurridoEn desempata por id DESC', async () => {
    const { body } = await getHistorial()
    assert.deepEqual(body.historial.slice(0, 2).map(e => e.id), [eventos[5].id, eventos[4].id])
  })

  it('A09 page=1 limit=2', async () => {
    const { body } = await getHistorial(productoId, '?page=1&limit=2')
    assert.deepEqual(body.historial.map(e => e.id), [eventos[5].id, eventos[4].id])
  })

  it('A10 page=2 devuelve siguiente bloque', async () => {
    const { body } = await getHistorial(productoId, '?page=2&limit=2')
    assert.deepEqual(body.historial.map(e => e.id), [eventos[3].id, eventos[2].id])
  })

  it('A11 total correcto', async () => {
    const { body } = await getHistorial(productoId, '?limit=2')
    assert.equal(body.paginacion.total, 6)
  })

  it('A12 totalPages correcto', async () => {
    const { body } = await getHistorial(productoId, '?limit=2')
    assert.equal(body.paginacion.totalPages, 3)
  })

  it('A13 page fuera de rango -> 200 + []', async () => {
    const { status, body } = await getHistorial(productoId, '?page=99&limit=2')
    assert.equal(status, 200)
    assert.deepEqual(body.historial, [])
  })

  it('A14 limit >100 -> 400', async () => {
    const { status } = await getHistorial(productoId, '?limit=101')
    assert.equal(status, 400)
  })

  it('A15 campo=precioVenta', async () => {
    const { body } = await getHistorial(productoId, '?campo=precioVenta')
    assert.equal(body.paginacion.total, 5)
    assert.ok(body.historial.every(e => e.detalles.some(d => d.campo === 'precioVenta')))
  })

  it('A16 campo=margen devuelve evento completo', async () => {
    const { body } = await getHistorial(productoId, '?campo=margen')
    const edit = body.historial.find(e => e.id === eventos[3].id)
    assert.deepEqual(edit.detalles.map(d => d.campo), ['margen', 'precioVenta', 'precioBase'])
  })

  it('A17 origen=COMPRA', async () => {
    const { body } = await getHistorial(productoId, '?origen=COMPRA')
    assert.equal(body.paginacion.total, 1)
    assert.equal(body.historial[0].origen, 'COMPRA')
  })

  it('A18 desde inclusive', async () => {
    const { body } = await getHistorial(productoId, '?desde=2026-01-04T10:00:00.000Z')
    assert.equal(body.paginacion.total, 3)
  })

  it('A19 hasta inclusive', async () => {
    const { body } = await getHistorial(productoId, '?hasta=2026-01-02T10:00:00.000Z')
    assert.equal(body.paginacion.total, 2)
  })

  it('A20 desde+hasta', async () => {
    const { body } = await getHistorial(productoId, '?desde=2026-01-02T10:00:00.000Z&hasta=2026-01-04T10:00:00.000Z')
    assert.equal(body.paginacion.total, 3)
  })

  it('A21 campo inválido -> 400', async () => {
    const { status } = await getHistorial(productoId, '?campo=nombre')
    assert.equal(status, 400)
  })

  it('A22 fecha inválida -> 400', async () => {
    const [formato, calendario] = await Promise.all([
      getHistorial(productoId, '?desde=no-es-fecha'),
      getHistorial(productoId, '?desde=2026-02-30')
    ])
    assert.deepEqual([formato.status, calendario.status], [400, 400])
  })

  it('A23 desde>hasta -> 400', async () => {
    const { status } = await getHistorial(productoId, '?desde=2026-02-01&hasta=2026-01-01')
    assert.equal(status, 400)
  })

  it('A24 sin auth -> 401', async () => {
    const { status } = await getHistorial(productoId, '', null)
    assert.equal(status, 401)
  })

  it('A25 cross-company product -> scoped not-found', async () => {
    const { status } = await getHistorial(productoId, '', tokenOtraEmpresa)
    assert.equal(status, 404)
  })

  it('A26 HPP empresa distinta nunca aparece', async () => {
    const { body } = await getHistorial()
    assert.equal(body.paginacion.total, 6)
    assert.ok(!body.historial.some(e => e.accion === 'TEST_CROSS_TENANT'))
  })

  it('A27 role no autorizado -> 403', async () => {
    const { status } = await getHistorial(productoId, '', tokenEmpleado)
    assert.equal(status, 403)
  })

  it('A28 role autorizado -> 200', async () => {
    const [admin, superadmin, precios] = await Promise.all([
      getHistorial(productoId, '', tokenAdmin),
      getHistorial(productoId, '', tokenSuperadmin),
      getHistorial(productoId, '', tokenPrecios)
    ])
    assert.deepEqual([admin.status, superadmin.status, precios.status], [200, 200, 200])
  })

  it('A29 PLATFORM_ADMIN directo no obtiene acceso operativo', async () => {
    const { status } = await getHistorial(productoId, '', tokenPlatformDirecto)
    assert.equal(status, 401)
  })

  it('A30 branch scope tenant-global conserva eventos null y de sucursal', async () => {
    const { body } = await getHistorial(productoId, '', tokenAdmin)
    assert.ok(body.historial.some(e => e.sucursal === null))
    assert.ok(body.historial.some(e => e.sucursal?.id))
    assert.equal(body.paginacion.total, 6)
  })

  it('A31 usuario response no incluye password/hash', async () => {
    const { body } = await getHistorial(productoId, '?origen=COMPRA')
    const usuario = body.historial[0].usuario
    assert.deepEqual(Object.keys(usuario).sort(), ['id', 'nombre', 'rol', 'username'])
    assert.ok(!('passwordHash' in usuario) && !('pin' in usuario))
  })

  it('A32 contexto raw no se filtra accidentalmente', async () => {
    const { body } = await getHistorial(productoId, '?origen=COMPRA')
    assert.ok(!('contexto' in body.historial[0]))
    assert.ok(!('notas' in body.historial[0]))
    assert.ok(!JSON.stringify(body).includes('NO_EXPOSER'))
  })

  it('A33 relaciones contienen solo campos seleccionados', async () => {
    const { body } = await getHistorial(productoId, '?origen=COMPRA')
    const event = body.historial[0]
    assert.deepEqual(Object.keys(event.sucursal).sort(), ['id', 'nombre'])
    assert.deepEqual(Object.keys(event.ordenCompra).sort(), ['estado', 'folio', 'id'])
    assert.deepEqual(Object.keys(event.proveedor).sort(), ['alias', 'id', 'nombreOficial'])
  })

  it('A34 endpoint no devuelve DetalleVenta', async () => {
    const { body } = await getHistorial()
    assert.ok(!JSON.stringify(body).includes('DetalleVenta'))
  })

  it('A35 endpoint no devuelve DetalleOrdenCompra como eventos', async () => {
    const { body } = await getHistorial()
    assert.ok(!JSON.stringify(body).includes('DetalleOrdenCompra'))
    assert.ok(body.historial.every(e => e.detalles.every(d => 'campo' in d)))
  })

  it('R01 GET sin filtros', async () => {
    const { status, body } = await getHistorial()
    assert.equal(status, 200)
    assert.equal(body.paginacion.total, 6)
    console.log(`R01 HTTP=${status} TOTAL=${body.paginacion.total} EVENT_IDS=${body.historial.map(e => e.id).join(',')}`)
  })

  it('R02 GET campo=precioVenta', async () => {
    const { status, body } = await getHistorial(productoId, '?campo=precioVenta')
    assert.equal(status, 200)
    console.log(`R02 HTTP=${status} TOTAL=${body.paginacion.total} DETAIL_FIELDS=${body.historial[0].detalles.map(d => d.campo).join(',')}`)
  })

  it('R03 GET origen=COMPRA', async () => {
    const { status, body } = await getHistorial(productoId, '?origen=COMPRA')
    assert.equal(status, 200)
    assert.equal(body.paginacion.total, 1)
    console.log(`R03 HTTP=${status} TOTAL=${body.paginacion.total} EVENT_IDS=${body.historial.map(e => e.id).join(',')}`)
  })

  it('R04 GET page=1&limit=2', async () => {
    const { status, body } = await getHistorial(productoId, '?page=1&limit=2')
    assert.equal(status, 200)
    assert.equal(body.historial.length, 2)
    console.log(`R04 HTTP=${status} TOTAL=${body.paginacion.total} EVENT_IDS=${body.historial.map(e => e.id).join(',')}`)
  })

  it('R05 cross-tenant', async () => {
    const { status } = await getHistorial(productoId, '', tokenOtraEmpresa)
    assert.equal(status, 404)
    console.log(`R05 HTTP=${status} SCOPED_DENIAL=PASS`)
  })
})
