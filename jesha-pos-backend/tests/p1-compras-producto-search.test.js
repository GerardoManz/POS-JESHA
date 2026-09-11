'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { after, before, beforeEach, describe, it } = require('node:test')

const prismaPath = require.resolve('../src/lib/prisma')
const scopePath = require.resolve('../src/helpers/construirWhereScopeTenant')
const controllerPath = require.resolve('../src/modules/compras/compras.controller')
const frontendRoot = path.join(__dirname, '..', '..')

const products = {
  aceiteA: { id: 101, empresaId: 1, nombre: 'ACEITE MULTIGRADO SAE 40', codigoInterno: 'ACE-001', codigoBarras: '750100000001', activo: true },
  aceiteA2: { id: 102, empresaId: 1, nombre: 'ACEITE INDUSTRIAL ROJO', codigoInterno: 'ACE-002', codigoBarras: '750100000002', activo: true },
  tornilloA: { id: 103, empresaId: 1, nombre: 'TORNILLO ALLEN 1/4', codigoInterno: 'TOR-001', codigoBarras: '750100000003', activo: true },
  brocaInactivaA: { id: 104, empresaId: 1, nombre: 'BROCA SDS INACTIVA', codigoInterno: 'BRO-OLD', codigoBarras: '750100000004', activo: false },
  aceiteB: { id: 201, empresaId: 2, nombre: 'ACEITE EMPRESA B', codigoInterno: 'ACE-B-001', codigoBarras: '750200000001', activo: true }
}

const orders = [
  {
    id: 1, empresaId: 1, sucursalId: 1, folio: 'OC-A-001', estado: 'RECIBIDO', pagada: true,
    proveedorId: 10, creadaEn: new Date('2026-09-05T12:00:00Z'),
    Proveedor: { nombreOficial: 'TRUPER MAYOREO', alias: 'TRUPER' },
    DetalleOrdenCompra: [
      { id: 1001, Producto: products.aceiteA },
      { id: 1002, Producto: products.aceiteA2 },
      { id: 1003, Producto: products.tornilloA }
    ]
  },
  {
    id: 2, empresaId: 1, sucursalId: 2, folio: 'OC-A-002', estado: 'ENVIADO', pagada: false,
    proveedorId: 20, creadaEn: new Date('2026-09-06T12:00:00Z'),
    Proveedor: { nombreOficial: 'SUMINISTROS DEL CENTRO', alias: 'SUMINISTROS' },
    DetalleOrdenCompra: [{ id: 2001, Producto: products.aceiteA }]
  },
  {
    id: 3, empresaId: 2, sucursalId: 3, folio: 'OC-B-001', estado: 'RECIBIDO', pagada: true,
    proveedorId: 30, creadaEn: new Date('2026-09-07T12:00:00Z'),
    Proveedor: { nombreOficial: 'PROVEEDOR EMPRESA B', alias: 'PROV-B' },
    DetalleOrdenCompra: [{ id: 3001, Producto: products.aceiteB }]
  },
  {
    id: 4, empresaId: 1, sucursalId: 1, folio: 'OC-A-004', estado: 'CANCELADO', pagada: false,
    proveedorId: 10, creadaEn: new Date('2026-09-08T12:00:00Z'),
    Proveedor: { nombreOficial: 'TRUPER MAYOREO', alias: 'TRUPER' },
    DetalleOrdenCompra: [{ id: 4001, Producto: products.brocaInactivaA }]
  }
]

function includes(value, search) {
  return typeof value === 'string' && value.toLowerCase().includes(search.toLowerCase())
}

function matchesStringFilter(value, filter) {
  return !filter?.contains || includes(value, filter.contains)
}

function matchesProduct(product, filter) {
  if (!product) return false
  if (filter.empresaId !== undefined && product.empresaId !== filter.empresaId) return false
  return !filter.OR || filter.OR.some(condition => {
    const [field, stringFilter] = Object.entries(condition)[0]
    return matchesStringFilter(product[field], stringFilter)
  })
}

function matchesOrder(order, where) {
  for (const field of ['empresaId', 'sucursalId', 'estado', 'proveedorId', 'pagada']) {
    if (where[field] !== undefined && order[field] !== where[field]) return false
  }

  if (where.OR && !where.OR.some(condition => {
    if (condition.folio) return matchesStringFilter(order.folio, condition.folio)
    if (condition.Proveedor?.nombreOficial) return matchesStringFilter(order.Proveedor.nombreOficial, condition.Proveedor.nombreOficial)
    if (condition.Proveedor?.alias) return matchesStringFilter(order.Proveedor.alias, condition.Proveedor.alias)
    return false
  })) return false

  const productFilter = where.DetalleOrdenCompra?.some?.Producto
  if (productFilter && !order.DetalleOrdenCompra.some(detail => matchesProduct(detail.Producto, productFilter))) return false

  return true
}

const calls = { count: [], findMany: [] }
const fakePrisma = {
  ordenCompra: {
    async count(args) {
      calls.count.push(args)
      return orders.filter(order => matchesOrder(order, args.where)).length
    },
    async findMany(args) {
      calls.findMany.push(args)
      const matching = orders
        .filter(order => matchesOrder(order, args.where))
        .sort((a, b) => b.creadaEn - a.creadaEn)
      return matching.slice(args.skip || 0, (args.skip || 0) + (args.take || matching.length))
    }
  }
}

const originalPrismaCache = require.cache[prismaPath]
const originalScopeCache = require.cache[scopePath]
let controller

function cacheModule(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports }
}

before(() => {
  cacheModule(prismaPath, fakePrisma)
  cacheModule(scopePath, req => {
    const where = { empresaId: req.context.empresaId }
    if (req.context.sucursalId !== null && req.context.sucursalId !== undefined) {
      where.sucursalId = req.context.sucursalId
    }
    return where
  })
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
  await controller.listar(req, res)
  return { statusCode, body }
}

function ids(response) {
  return response.body.data.map(order => order.id)
}

describe('P1-3 compras product search', { concurrency: 1 }, () => {
  it('T01 name: returns orders containing a matching product and keeps every order detail', async () => {
    const response = await request({ producto: 'MULTIGRADO' })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(ids(response), [2, 1])
    const order = response.body.data.find(item => item.id === 1)
    assert.equal(order.DetalleOrdenCompra.length, 3)
    assert.ok(order.DetalleOrdenCompra.some(detail => detail.Producto.nombre === products.tornilloA.nombre))
  })

  it('T02 case insensitive: upper and lower case return the same set', async () => {
    const upper = await request({ producto: 'ACEITE' })
    const lower = await request({ producto: 'aceite' })
    assert.deepEqual(ids(lower), ids(upper))
  })

  it('T03 internal code: searches codigoInterno', async () => {
    const response = await request({ producto: 'TOR-001' })
    assert.deepEqual(ids(response), [1])
  })

  it('T04 barcode: searches codigoBarras', async () => {
    const response = await request({ producto: '750100000004' })
    assert.deepEqual(ids(response), [4])
  })

  it('T05 partial: applies contains semantics', async () => {
    const response = await request({ producto: 'ORNILLO ALL' })
    assert.deepEqual(ids(response), [1])
  })

  it('T06 nonexistent: returns 200, empty data and total zero', async () => {
    const response = await request({ producto: 'INEXISTENTE_P1_3_999999' })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.body.data, [])
    assert.equal(response.body.total, 0)
  })

  it('T07 dedup: an order with two matching details appears once', async () => {
    const response = await request({ producto: 'ACEITE' })
    assert.equal(ids(response).filter(id => id === 1).length, 1)
    assert.deepEqual(ids(response), [2, 1])
  })

  it('T08 product plus estado: filters by intersection', async () => {
    const response = await request({ producto: 'ACEITE', estado: 'ENVIADO' })
    assert.deepEqual(ids(response), [2])
  })

  it('T09 product plus proveedor: filters by intersection', async () => {
    const response = await request({ producto: 'ACEITE', proveedorId: '10' })
    assert.deepEqual(ids(response), [1])
  })

  it('T10 product plus pagada: filters by intersection', async () => {
    const paid = await request({ producto: 'ACEITE', pagada: 'true' })
    const unpaid = await request({ producto: 'ACEITE', pagada: 'false' })
    assert.deepEqual(ids(paid), [1])
    assert.deepEqual(ids(unpaid), [2])
  })

  it('T11 product plus buscar: both filters apply with AND', async () => {
    const response = await request({ producto: 'ACEITE', buscar: 'SUMINISTROS' })
    assert.deepEqual(ids(response), [2])
  })

  it('T12 pagination: count and findMany receive the same completed where', async () => {
    const response = await request({ producto: 'ACEITE', page: '2', limit: '1' })
    assert.equal(response.body.total, 2)
    assert.equal(response.body.page, 2)
    assert.equal(response.body.limit, 1)
    assert.deepEqual(ids(response), [1])
    assert.strictEqual(calls.count[0].where, calls.findMany[0].where)
    assert.ok(calls.count[0].where.DetalleOrdenCompra)
    assert.equal(calls.findMany[0].skip, 1)
    assert.equal(calls.findMany[0].take, 1)
  })

  it('T13 frontend: sends producto, resets page, reuses debounce and rejects stale responses', () => {
    const source = fs.readFileSync(path.join(frontendRoot, 'compras.js'), 'utf8')
    const html = fs.readFileSync(path.join(frontendRoot, 'compras.html'), 'utf8')
    assert.match(html, /id="search-producto"/)
    assert.match(source, /params\.set\('producto', producto\)/)
    assert.match(source, /getElementById\('search-producto'\)[\s\S]*?clearTimeout\(debounceSearch\)[\s\S]*?paginaActual=1/)
    assert.match(source, /const requestVersion = \+\+comprasRequestVersion/)
    assert.match(source, /requestVersion !== comprasRequestVersion/)
  })

  it('T14 tenant: the related product and order remain scoped to the server tenant', async () => {
    const empresaA = await request({ producto: 'ACEITE' }, { empresaId: 1 })
    const empresaB = await request({ producto: 'ACEITE' }, { empresaId: 2 })
    assert.deepEqual(ids(empresaA), [2, 1])
    assert.deepEqual(ids(empresaB), [3])
    assert.equal(calls.count.at(-1).where.DetalleOrdenCompra.some.Producto.empresaId, 2)
  })

  it('T15 branch: EMPLEADO and ADMIN_SUCURSAL cannot read another branch', async () => {
    const empleado = await request({ producto: 'ACEITE' }, { rol: 'EMPLEADO', empresaId: 1, sucursalId: 1 })
    const admin = await request({ producto: 'ACEITE' }, { rol: 'ADMIN_SUCURSAL', empresaId: 1, sucursalId: 1 })
    assert.deepEqual(ids(empleado), [1])
    assert.deepEqual(ids(admin), [1])
  })

  it('T16 superadmin: reads matching orders from multiple branches of its company', async () => {
    const response = await request({ producto: 'ACEITE' }, { rol: 'SUPERADMIN', empresaId: 1 })
    assert.deepEqual(ids(response), [2, 1])
    assert.equal(calls.count[0].where.sucursalId, undefined)
  })

  it('T17 inactive: products with purchase history remain searchable', async () => {
    const response = await request({ producto: 'BROCA SDS' })
    assert.deepEqual(ids(response), [4])
    assert.equal(calls.count[0].where.DetalleOrdenCompra.some.Producto.activo, undefined)
  })

  it('T18 empty: missing, empty and whitespace producto behave identically', async () => {
    const omitted = await request()
    const empty = await request({ producto: '' })
    const whitespace = await request({ producto: '   ' })
    assert.deepEqual(ids(empty), ids(omitted))
    assert.deepEqual(ids(whitespace), ids(omitted))
    assert.equal(calls.count.at(-1).where.DetalleOrdenCompra, undefined)
  })

  it('T19 response contract: producto does not change response keys', async () => {
    const unfiltered = await request()
    const filtered = await request({ producto: 'ACEITE' })
    assert.deepEqual(Object.keys(filtered.body), Object.keys(unfiltered.body))
    assert.deepEqual(Object.keys(filtered.body).sort(), ['data', 'limit', 'page', 'success', 'total'])
  })
})
