'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { after, before, beforeEach, describe, it } = require('node:test')

const prismaPath = require.resolve('../src/lib/prisma')
const scopePath = require.resolve('../src/modules/sucursal/sucursal.helper')
const getEmpresaIdPath = require.resolve('../src/helpers/getEmpresaId')
const controllerPath = require.resolve('../src/modules/ventas/ventas.controller')
const frontendRoot = path.join(__dirname, '..', '..')

const products = {
  cunasA:       { id: 1807, empresaId: 1, nombre: 'JUEGO DE CUNAS CON MANGO', codigoInterno: '24200', codigoBarras: '7501206633403', activo: true },
  cintaA:       { id: 1810, empresaId: 1, nombre: 'CINTA BANCARIA CANAIMA 48MM', codigoInterno: '8444', codigoBarras: '7502527862121', activo: true },
  brocaInactiva: { id: 1915, empresaId: 1, nombre: 'BROCA SDS INACTIVA', codigoInterno: 'BRO-OLD', codigoBarras: '750100000099', activo: false },
  productoB:     { id: 301, empresaId: 2, nombre: 'ACEITE EMPRESA B', codigoInterno: 'ACE-B', codigoBarras: '750200000301', activo: true }
}

const sales = [
  {
    id: 101, empresaId: 1, sucursalId: 1, folio: 'VTA-20260901-00101', estado: 'COMPLETADA',
    metodoPago: 'EFECTIVO', clienteId: null, usuarioId: 1, turnoId: 1,
    subtotal: 100, total: 116, descuento: 0, estadoPago: 'PAGADA',
    montoAbonado: 0, saldoPendiente: 0, montoPagado: 116, cambio: 0,
    creadaEn: new Date('2026-09-01T12:00:00Z'), facturaEstado: 'DISPONIBLE',
    facturaLimite: new Date('2026-10-01T12:00:00Z'), tokenQr: 'qr-101',
    Cliente: null, Usuario: { id: 1, nombre: 'Admin' },
    DetalleVenta: [
      { id: 2001, productoId: 1807, cantidad: 5, precioUnitario: 20, subtotal: 100, Producto: products.cunasA },
      { id: 2002, productoId: 1810, cantidad: 1, precioUnitario: 50, subtotal: 50, Producto: products.cintaA }
    ],
    DetalleBitacora: []
  },
  {
    id: 102, empresaId: 1, sucursalId: 1, folio: 'VTA-20260902-00102', estado: 'COMPLETADA',
    metodoPago: 'DEBITO', clienteId: null, usuarioId: 1, turnoId: 1,
    subtotal: 50, total: 58, descuento: 0, estadoPago: 'PAGADA',
    montoAbonado: 0, saldoPendiente: 0, montoPagado: 58, cambio: 0,
    creadaEn: new Date('2026-09-02T12:00:00Z'), facturaEstado: 'DISPONIBLE',
    facturaLimite: new Date('2026-10-02T12:00:00Z'), tokenQr: 'qr-102',
    Cliente: null, Usuario: { id: 1, nombre: 'Admin' },
    DetalleVenta: [{ id: 2003, productoId: 1810, cantidad: 1, precioUnitario: 50, subtotal: 50, Producto: products.cintaA }],
    DetalleBitacora: []
  },
  {
    id: 103, empresaId: 1, sucursalId: 2, folio: 'VTA-20260903-00103', estado: 'COMPLETADA',
    metodoPago: 'EFECTIVO', clienteId: null, usuarioId: 2, turnoId: 2,
    subtotal: 200, total: 232, descuento: 0, estadoPago: 'PAGADA',
    montoAbonado: 0, saldoPendiente: 0, montoPagado: 232, cambio: 0,
    creadaEn: new Date('2026-09-03T12:00:00Z'), facturaEstado: 'DISPONIBLE',
    facturaLimite: new Date('2026-10-03T12:00:00Z'), tokenQr: 'qr-103',
    Cliente: null, Usuario: { id: 2, nombre: 'Cajero' },
    DetalleVenta: [{ id: 2004, productoId: 1807, cantidad: 10, precioUnitario: 20, subtotal: 200, Producto: products.cunasA }],
    DetalleBitacora: []
  },
  {
    id: 104, empresaId: 1, sucursalId: 1, folio: 'VTA-20260904-00104', estado: 'CANCELADA',
    metodoPago: 'EFECTIVO', clienteId: null, usuarioId: 1, turnoId: 1,
    subtotal: 30, total: 34.8, descuento: 0, estadoPago: 'PAGADA',
    montoAbonado: 0, saldoPendiente: 0, montoPagado: 34.8, cambio: 0,
    creadaEn: new Date('2026-09-04T12:00:00Z'), facturaEstado: 'DISPONIBLE',
    facturaLimite: new Date('2026-10-04T12:00:00Z'), tokenQr: 'qr-104',
    Cliente: null, Usuario: { id: 1, nombre: 'Admin' },
    DetalleVenta: [{ id: 2005, productoId: 1810, cantidad: 1, precioUnitario: 30, subtotal: 30, Producto: products.cintaA }],
    DetalleBitacora: []
  },
  {
    id: 105, empresaId: 2, sucursalId: 3, folio: 'VTA-20260905-00105', estado: 'COMPLETADA',
    metodoPago: 'EFECTIVO', clienteId: null, usuarioId: 3, turnoId: 3,
    subtotal: 100, total: 116, descuento: 0, estadoPago: 'PAGADA',
    montoAbonado: 0, saldoPendiente: 0, montoPagado: 116, cambio: 0,
    creadaEn: new Date('2026-09-05T12:00:00Z'), facturaEstado: 'DISPONIBLE',
    facturaLimite: new Date('2026-10-05T12:00:00Z'), tokenQr: 'qr-105',
    Cliente: null, Usuario: { id: 3, nombre: 'Admin B' },
    DetalleVenta: [{ id: 2006, productoId: 301, cantidad: 2, precioUnitario: 50, subtotal: 100, Producto: products.productoB }],
    DetalleBitacora: []
  },
  {
    id: 106, empresaId: 1, sucursalId: 1, folio: 'VTA-20260906-00106', estado: 'COMPLETADA',
    metodoPago: 'EFECTIVO', clienteId: null, usuarioId: 1, turnoId: 1,
    subtotal: 0, total: 0, descuento: 0, estadoPago: 'PAGADA',
    montoAbonado: 0, saldoPendiente: 0, montoPagado: 0, cambio: 0,
    creadaEn: new Date('2026-09-06T12:00:00Z'), facturaEstado: 'DISPONIBLE',
    facturaLimite: new Date('2026-10-06T12:00:00Z'), tokenQr: 'qr-106',
    Cliente: null, Usuario: { id: 1, nombre: 'Admin' },
    DetalleVenta: [],
    DetalleBitacora: [
      { id: 3001, ventaId: 106, productoId: 1807, cantidad: 2, precioUnitario: 20, subtotal: 40, Producto: products.cunasA }
    ]
  },
  {
    id: 107, empresaId: 1, sucursalId: 1, folio: 'VTA-20260907-00107', estado: 'COMPLETADA',
    metodoPago: 'DEBITO', clienteId: null, usuarioId: 1, turnoId: 1,
    subtotal: 0, total: 0, descuento: 0, estadoPago: 'PAGADA',
    montoAbonado: 0, saldoPendiente: 0, montoPagado: 0, cambio: 0,
    creadaEn: new Date('2026-09-07T12:00:00Z'), facturaEstado: 'DISPONIBLE',
    facturaLimite: new Date('2026-10-07T12:00:00Z'), tokenQr: 'qr-107',
    Cliente: null, Usuario: { id: 1, nombre: 'Admin' },
    DetalleVenta: [{ id: 2007, productoId: 1807, cantidad: 1, precioUnitario: 20, subtotal: 20, Producto: products.cunasA }],
    DetalleBitacora: [
      { id: 3002, ventaId: 107, productoId: 1810, cantidad: 1, precioUnitario: 50, subtotal: 50, Producto: products.cintaA }
    ]
  },
  {
    id: 108, empresaId: 1, sucursalId: 1, folio: 'VTA-20260908-00108', estado: 'COMPLETADA',
    metodoPago: 'EFECTIVO', clienteId: null, usuarioId: 1, turnoId: 1,
    subtotal: 40, total: 46.4, descuento: 0, estadoPago: 'PAGADA',
    montoAbonado: 0, saldoPendiente: 0, montoPagado: 46.4, cambio: 0,
    creadaEn: new Date('2026-09-08T12:00:00Z'), facturaEstado: 'DISPONIBLE',
    facturaLimite: new Date('2026-10-08T12:00:00Z'), tokenQr: 'qr-108',
    Cliente: null, Usuario: { id: 1, nombre: 'Admin' },
    DetalleVenta: [{ id: 2008, productoId: 1915, cantidad: 2, precioUnitario: 20, subtotal: 40, Producto: products.brocaInactiva }],
    DetalleBitacora: []
  }
]

function matchesSale(sale, where) {
  for (const field of ['empresaId', 'sucursalId', 'metodoPago', 'usuarioId', 'clienteId']) {
    if (where[field] !== undefined && sale[field] !== where[field]) return false
  }
  if (where.turnoId !== undefined && sale.turnoId !== where.turnoId) return false
  if (where.estado !== undefined && sale.estado !== where.estado) return false

  if (where.creadaEn) {
    if (where.creadaEn.gte && sale.creadaEn < where.creadaEn.gte) return false
    if (where.creadaEn.lte && sale.creadaEn > where.creadaEn.lte) return false
  }

  if (where.AND) {
    for (const cond of where.AND) {
      if (cond.OR) {
        const match = cond.OR.some(c => {
          if (c.folio) return typeof sale.folio === 'string' && sale.folio.toLowerCase().includes(c.folio.contains.toLowerCase())
          if (c.Cliente?.nombre) return sale.Cliente?.nombre?.toLowerCase().includes(c.Cliente.nombre.contains.toLowerCase()) || false
          if (c.DetalleVenta?.some?.Producto) {
            return sale.DetalleVenta.some(d => matchesProduct(d.Producto, c.DetalleVenta.some.Producto))
          }
          if (c.DetalleBitacora?.some?.Producto) {
            return sale.DetalleBitacora.some(d => matchesProduct(d.Producto, c.DetalleBitacora.some.Producto))
          }
          return false
        })
        if (!match) return false
      }
    }
  }

  return true
}

function matchesProduct(product, filter) {
  if (!product) return false
  if (filter.empresaId !== undefined && product.empresaId !== filter.empresaId) return false
  if (filter.OR) {
    return filter.OR.some(c => {
      if (c.nombre) return product.nombre?.toLowerCase().includes(c.nombre.contains.toLowerCase()) || false
      if (c.codigoInterno) return product.codigoInterno?.toLowerCase().includes(c.codigoInterno.contains.toLowerCase()) || false
      if (c.codigoBarras) return product.codigoBarras?.toLowerCase().includes(c.codigoBarras.contains.toLowerCase()) || false
      return false
    })
  }
  return true
}

const calls = { count: [], findMany: [] }
const fakePrisma = {
  venta: {
    async count(args) {
      calls.count.push(args)
      return sales.filter(s => matchesSale(s, args.where)).length
    },
    async findMany(args) {
      calls.findMany.push(args)
      const matching = sales
        .filter(s => matchesSale(s, args.where))
        .sort((a, b) => b.creadaEn - a.creadaEn)
      return matching.slice(args.skip || 0, (args.skip || 0) + (args.take || matching.length))
    }
  }
}

const originalPrismaCache = require.cache[prismaPath]
const originalScopeCache = require.cache[scopePath]
const originalGetEmpresaIdCache = require.cache[getEmpresaIdPath]
let controller

function cacheModule(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports }
}

before(() => {
  cacheModule(prismaPath, fakePrisma)
  cacheModule(scopePath, req => req.context.sucursalId ?? null)
  cacheModule(getEmpresaIdPath, req => req.context.empresaId)
  delete require.cache[controllerPath]
  controller = require(controllerPath)
})

beforeEach(() => {
  calls.count.length = 0
  calls.findMany.length = 0
})

after(() => {
  delete require.cache[controllerPath]
  if (originalPrismaCache) require.cache[prismaPath] = originalPrismaCache
  else delete require.cache[prismaPath]
  if (originalScopeCache) require.cache[scopePath] = originalScopeCache
  else delete require.cache[scopePath]
  if (originalGetEmpresaIdCache) require.cache[getEmpresaIdPath] = originalGetEmpresaIdCache
  else delete require.cache[getEmpresaIdPath]
})

async function request(query = {}, { rol = 'SUPERADMIN', empresaId = 1, sucursalId = null } = {}) {
  let statusCode = 200
  let body
  const req = {
    query,
    usuario: { rol, sucursalId },
    context: { empresaId, sucursalId }
  }
  const res = {
    status(code) { statusCode = code; return this },
    json(value) { body = value; return this }
  }
  await controller.obtenerVentas(req, res)
  return { statusCode, body }
}

function ids(response) {
  return response.body.data.map(sale => sale.id)
}

describe('P1-4 ventas product search', { concurrency: 1 }, () => {
  it('T01 name: returns sales containing a matching product', async () => {
    const response = await request({ producto: 'CUNAS' })
    assert.equal(response.statusCode, 200)
    assert.ok(ids(response).includes(101))
    assert.ok(ids(response).includes(103))
    assert.ok(ids(response).includes(106))
    assert.ok(ids(response).includes(107))
  })

  it('T02 case insensitive: upper and lower case return the same set', async () => {
    const upper = await request({ producto: 'CINTA' })
    const lower = await request({ producto: 'cinta' })
    assert.deepEqual(ids(lower), ids(upper))
  })

  it('T03 partial name: applies contains semantics', async () => {
    const response = await request({ producto: 'CUNAS CON' })
    assert.ok(ids(response).includes(101))
    assert.ok(ids(response).includes(103))
  })

  it('T04 internal code: searches codigoInterno', async () => {
    const response = await request({ producto: '24200' })
    assert.ok(ids(response).includes(101))
    assert.ok(ids(response).includes(103))
  })

  it('T05 barcode: searches codigoBarras', async () => {
    const response = await request({ producto: '7501206633403' })
    assert.ok(ids(response).includes(101))
    assert.ok(ids(response).includes(103))
  })

  it('T06 nonexistent: returns 200, empty data and total zero', async () => {
    const response = await request({ producto: 'INEXISTENTE_P14_999999' })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.body.data, [])
    assert.equal(response.body.total, 0)
  })

  it('T07 empty/whitespace: missing, empty and whitespace behave identically', async () => {
    const omitted = await request()
    const empty = await request({ producto: '' })
    const whitespace = await request({ producto: '   ' })
    assert.deepEqual(ids(empty), ids(omitted))
    assert.deepEqual(ids(whitespace), ids(omitted))
  })

  it('T08 dedup: a sale matching via DetalleVenta and DetalleBitacora appears once', async () => {
    const response = await request({ producto: 'CINTA' })
    const matchCount = ids(response).filter(id => id === 107).length
    assert.equal(matchCount, 1)
  })

  it('T09 product plus search: both filters apply with AND', async () => {
    const response = await request({ producto: 'CUNAS', search: 'VTA-20260901' })
    assert.deepEqual(ids(response), [101])
  })

  it('T10 product plus desde: filters by intersection', async () => {
    const response = await request({ producto: 'CUNAS', desde: '2026-09-03' })
    assert.ok(ids(response).includes(103))
    assert.ok(!ids(response).includes(101))
  })

  it('T11 product plus hasta: filters by intersection', async () => {
    const response = await request({ producto: 'CUNAS', hasta: '2026-09-02' })
    assert.ok(ids(response).includes(101))
    assert.ok(!ids(response).includes(103))
  })

  it('T12 product plus metodoPago: filters by intersection', async () => {
    const efectivo = await request({ producto: 'CUNAS', metodoPago: 'EFECTIVO' })
    const debito = await request({ producto: 'CUNAS', metodoPago: 'DEBITO' })
    assert.ok(ids(efectivo).includes(101))
    assert.ok(!ids(debito).includes(101))
    assert.ok(ids(debito).includes(107))
  })

  it('T13 product plus usuarioId: filters by intersection', async () => {
    const admin = await request({ producto: 'CUNAS', usuarioId: '1' })
    const cajero = await request({ producto: 'CUNAS', usuarioId: '2' })
    assert.ok(ids(admin).includes(101))
    assert.ok(!ids(cajero).includes(101))
    assert.ok(ids(cajero).includes(103))
  })

  it('T14 tenant isolation: sales from different empresas do not mix', async () => {
    const empresaA = await request({ producto: 'ACEITE' }, { empresaId: 1 })
    const empresaB = await request({ producto: 'ACEITE' }, { empresaId: 2 })
    assert.ok(!ids(empresaA).includes(105))
    assert.deepEqual(ids(empresaB), [105])
  })

  it('T15 branch EMPLEADO: cannot read another branch', async () => {
    const response = await request({ producto: 'CUNAS' }, { rol: 'EMPLEADO', empresaId: 1, sucursalId: 1 })
    assert.ok(ids(response).includes(101))
    assert.ok(!ids(response).includes(103))
  })

  it('T16 branch ADMIN_SUCURSAL: cannot read another branch', async () => {
    const response = await request({ producto: 'CUNAS' }, { rol: 'ADMIN_SUCURSAL', empresaId: 1, sucursalId: 1 })
    assert.ok(ids(response).includes(101))
    assert.ok(!ids(response).includes(103))
  })

  it('T17 SUPERADMIN: reads matching sales from multiple branches', async () => {
    const response = await request({ producto: 'CUNAS' }, { rol: 'SUPERADMIN', empresaId: 1 })
    assert.ok(ids(response).includes(101))
    assert.ok(ids(response).includes(103))
    assert.equal(calls.count[0].where.sucursalId, undefined)
  })

  it('T18 inactive product: products with sales history remain searchable', async () => {
    const response = await request({ producto: 'BROCA SDS' })
    assert.deepEqual(ids(response), [108])
  })

  it('T19 response contract: producto does not change response keys', async () => {
    const unfiltered = await request()
    const filtered = await request({ producto: 'CUNAS' })
    assert.deepEqual(Object.keys(filtered.body).sort(), Object.keys(unfiltered.body).sort())
  })

  it('T20 count uses product filter: count matches filtered results', async () => {
    const response = await request({ producto: 'CUNAS' })
    assert.equal(response.body.total, ids(response).length)
  })

  it('T21 pagination: skip/take work correctly with product filter', async () => {
    const page1 = await request({ producto: 'CUNAS', skip: '0', take: '2' })
    const page2 = await request({ producto: 'CUNAS', skip: '2', take: '2' })
    assert.equal(page1.body.data.length, 2)
    assert.equal(page2.body.data.length, 2)
    const allIds = [...ids(page1), ...ids(page2)]
    assert.equal(new Set(allIds).size, allIds.length)
  })

  it('T22 legacy: sale with DetalleBitacora only is found via product search', async () => {
    const response = await request({ producto: 'CUNAS' })
    assert.ok(ids(response).includes(106))
  })

  it('T23 legacy: DetalleBitacora product with codigoInterno is searchable', async () => {
    const response = await request({ producto: '24200' })
    assert.ok(ids(response).includes(106))
  })

  it('T24 legacy: DetalleBitacora product with codigoBarras is searchable', async () => {
    const response = await request({ producto: '7501206633403' })
    assert.ok(ids(response).includes(106))
  })

  it('T25 mixed: sale with both DetalleVenta and DetalleBitacora appears once', async () => {
    const response = await request({ producto: 'CINTA' })
    const matchCount = ids(response).filter(id => id === 107).length
    assert.equal(matchCount, 1)
  })

  it('T26 legacy tenant: DetalleBitacora search respects empresaId', async () => {
    const empresaA = await request({ producto: '24200' }, { empresaId: 1 })
    const empresaB = await request({ producto: '24200' }, { empresaId: 2 })
    assert.ok(ids(empresaA).includes(106))
    assert.ok(!ids(empresaB).includes(106))
  })

  it('T27 frontend: sends producto param and resets page', () => {
    const source = fs.readFileSync(path.join(frontendRoot, 'historial.js'), 'utf8')
    const html = fs.readFileSync(path.join(frontendRoot, 'historial.html'), 'utf8')
    assert.match(html, /id="filtro-producto"/)
    assert.match(source, /p\.set\('producto', producto\)/)
    assert.match(source, /filtro-producto[\s\S]*?clearTimeout\(debounceProducto\)[\s\S]*?paginaActual = 1/)
    assert.match(source, /const myVersion = \+\+requestVersion/)
    assert.match(source, /myVersion !== requestVersion/)
  })
})
