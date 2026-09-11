'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { after, before, beforeEach, describe, it } = require('node:test')

const prismaPath = require.resolve('../src/lib/prisma')
const getEmpresaIdPath = require.resolve('../src/helpers/getEmpresaId')
const controllerPath = require.resolve('../src/modules/clientes/clientes.controller')
const frontendRoot = path.join(__dirname, '..', '..')

const pad = value => String(value).padStart(3, '0')
const tenantA = []
for (let i = 1; i <= 121; i++) {
  tenantA.push({
    id: i,
    empresaId: 1,
    nombre: i % 10 === 0 ? `FERRETERIA ${pad(i)}` : `CLIENTE ${pad(i)}`,
    apodo: i % 11 === 0 ? `APODO ${pad(i)}` : null,
    rfc: `RFC${pad(i)}`,
    telefono: `555${pad(i)}`,
    email: `cliente${i}@example.test`,
    tipo: i % 3 === 0 ? 'FISCAL' : 'GENERAL',
    activo: i % 7 !== 0
  })
}
// Mismo nombre, inserción invertida: debe desempatar por id ASC.
tenantA.push({ id: 900, empresaId: 1, nombre: 'CLIENTE DUPLICADO', apodo: null, rfc: 'DUP900', telefono: '900', email: 'd900@example.test', tipo: 'GENERAL', activo: true })
tenantA.push({ id: 800, empresaId: 1, nombre: 'CLIENTE DUPLICADO', apodo: null, rfc: 'DUP800', telefono: '800', email: 'd800@example.test', tipo: 'GENERAL', activo: true })

const tenantB = Array.from({ length: 10 }, (_, index) => ({
  id: 2000 + index,
  empresaId: 2,
  nombre: `CLIENTE B ${pad(index + 1)}`,
  apodo: null,
  rfc: `BRFC${pad(index + 1)}`,
  telefono: `556${pad(index + 1)}`,
  email: `b${index + 1}@example.test`,
  tipo: 'GENERAL',
  activo: true
}))

// Llegan deliberadamente desordenados.
const dataset = [...tenantB, ...tenantA].reverse()
const calls = { count: [], findMany: [] }

function includes(value, search) {
  return typeof value === 'string' && value.toLowerCase().includes(String(search).toLowerCase())
}

function matchesCliente(cliente, where) {
  if (where.empresaId !== undefined && cliente.empresaId !== where.empresaId) return false
  if (where.tipo !== undefined && cliente.tipo !== where.tipo) return false
  if (where.activo !== undefined && cliente.activo !== where.activo) return false
  if (!where.OR) return true
  return where.OR.some(condition => {
    if (condition.id?.in) return condition.id.in.includes(cliente.id)
    return Object.entries(condition).some(([field, filter]) => filter?.contains !== undefined && includes(cliente[field], filter.contains))
  })
}

function orderRows(rows, orderBy) {
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy]
  return rows.slice().sort((a, b) => {
    for (const spec of specs) {
      const [field, direction] = Object.entries(spec)[0]
      const av = a[field]
      const bv = b[field]
      const cmp = typeof av === 'string' || typeof bv === 'string'
        ? String(av ?? '').localeCompare(String(bv ?? ''), 'es')
        : (av ?? 0) - (bv ?? 0)
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

const fakePrisma = {
  cliente: {
    async count(args) {
      calls.count.push(args)
      return dataset.filter(cliente => matchesCliente(cliente, args.where)).length
    },
    async findMany(args) {
      calls.findMany.push(args)
      const ordered = orderRows(dataset.filter(cliente => matchesCliente(cliente, args.where)), args.orderBy)
      if (args.skip === undefined && args.take === undefined) return ordered
      return ordered.slice(args.skip, args.skip + args.take)
    }
  },
  async $queryRaw() { return [] }
}

const originalPrismaCache = require.cache[prismaPath]
const originalGetEmpresaCache = require.cache[getEmpresaIdPath]
let controller

function cacheModule(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports }
}

before(() => {
  cacheModule(prismaPath, fakePrisma)
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
  if (originalGetEmpresaCache) require.cache[getEmpresaIdPath] = originalGetEmpresaCache
  else delete require.cache[getEmpresaIdPath]
})

async function request(query = {}, empresaId = 1) {
  let statusCode = 200
  let body
  const req = { query, context: { empresaId } }
  const res = {
    status(code) { statusCode = code; return this },
    json(value) { body = value; return this }
  }
  await controller.listar(req, res)
  return { statusCode, body }
}

const expectedA = orderRows(tenantA, [{ nombre: 'asc' }, { id: 'asc' }])
const isAscending = rows => rows.every((row, index) => {
  if (index === 0) return true
  const previous = rows[index - 1]
  const byName = previous.nombre.localeCompare(row.nombre, 'es')
  return byName < 0 || (byName === 0 && previous.id < row.id)
})

describe('P2-1B backend pagination', { concurrency: 1 }, () => {
  it('T01 primera página usa 50 filas', async () => {
    const { body } = await request({ page: '1', limit: '50' })
    assert.equal(body.data.length, 50)
    assert.deepEqual(body.data.map(c => c.id), expectedA.slice(0, 50).map(c => c.id))
  })

  it('T02 segunda página usa las siguientes 50 filas', async () => {
    const { body } = await request({ page: '2', limit: '50' })
    assert.equal(body.data.length, 50)
    assert.deepEqual(body.data.map(c => c.id), expectedA.slice(50, 100).map(c => c.id))
  })

  it('T03 última página devuelve las 23 filas restantes', async () => {
    const { body } = await request({ page: '3', limit: '50' })
    assert.equal(body.data.length, 23)
    assert.deepEqual(body.data.map(c => c.id), expectedA.slice(100).map(c => c.id))
  })

  it('T06 página 1 conserva A-Z', async () => {
    assert.ok(isAscending((await request({ page: '1' })).body.data))
  })

  it('T07 página 2 conserva A-Z', async () => {
    assert.ok(isAscending((await request({ page: '2' })).body.data))
  })

  it('T08 concatenar tres páginas produce el A-Z global exacto', async () => {
    const pages = await Promise.all([1, 2, 3].map(page => request({ page: String(page), limit: '50' })))
    const combined = pages.flatMap(result => result.body.data)
    assert.deepEqual(combined.map(c => c.id), expectedA.map(c => c.id))
    assert.equal(new Set(combined.map(c => c.id)).size, 123)
  })

  it('T09 nombres duplicados mantienen id ASC entre páginas', async () => {
    const pages = await Promise.all([1, 2, 3].map(page => request({ page: String(page) })))
    const duplicates = pages.flatMap(result => result.body.data).filter(c => c.nombre === 'CLIENTE DUPLICADO')
    assert.deepEqual(duplicates.map(c => c.id), [800, 900])
  })

  it('T11 búsqueda paginada mantiene A-Z', async () => {
    const { body } = await request({ page: '1', limit: '50', buscar: 'FERRETERIA' })
    assert.equal(body.paginacion.total, 12)
    assert.ok(isAscending(body.data))
    assert.ok(body.data.every(c => c.nombre.startsWith('FERRETERIA')))
  })

  it('T13 filtro tipo usa el mismo where y mantiene A-Z', async () => {
    const { body } = await request({ page: '1', tipo: 'FISCAL' })
    assert.ok(body.data.every(c => c.tipo === 'FISCAL'))
    assert.ok(isAscending(body.data))
    assert.deepEqual(calls.count[0].where, calls.findMany[0].where)
  })

  it('T14 filtro activo usa el mismo where y mantiene A-Z', async () => {
    const { body } = await request({ page: '1', activo: 'true' })
    assert.ok(body.data.every(c => c.activo === true))
    assert.ok(isAscending(body.data))
    assert.deepEqual(calls.count[0].where, calls.findMany[0].where)
  })

  it('T15 total se calcula con el mismo where que la lista', async () => {
    const { body } = await request({ page: '1', buscar: 'FERRETERIA' })
    assert.equal(body.paginacion.total, 12)
    assert.deepEqual(calls.count[0].where, calls.findMany[0].where)
  })

  it('T16 totalPaginas es correcto', async () => {
    const { body } = await request({ page: '1', limit: '50' })
    assert.equal(body.paginacion.total, 123)
    assert.equal(body.paginacion.totalPaginas, 3)
  })

  it('T17 página fuera de rango replica Inventario: lista vacía y página solicitada', async () => {
    const { body } = await request({ page: '9', limit: '50' })
    assert.deepEqual(body.data, [])
    assert.equal(body.paginacion.pagina, 9)
    assert.equal(body.paginacion.totalPaginas, 3)
  })

  it('T18 lista vacía conserva envelope normal', async () => {
    const { body } = await request({ page: '1', buscar: 'NO_EXISTE_999' })
    assert.deepEqual(body.data, [])
    assert.deepEqual(body.paginacion, { total: 0, skip: 0, take: 50, pagina: 1, totalPaginas: 0 })
  })

  it('T19 tenant isolation se aplica a count y findMany', async () => {
    const { body } = await request({ page: '1' }, 2)
    assert.equal(body.paginacion.total, 10)
    assert.ok(body.data.every(c => c.empresaId === 2))
    assert.equal(calls.count[0].where.empresaId, 2)
    assert.equal(calls.findMany[0].where.empresaId, 2)
  })

  it('T20 contrato paginado sigue el envelope de Inventario', async () => {
    const { body } = await request({ page: '1' })
    assert.equal(body.success, true)
    assert.ok(Array.isArray(body.data))
    assert.deepEqual(Object.keys(body.paginacion), ['total', 'skip', 'take', 'pagina', 'totalPaginas'])
  })

  it('T21 consumidor POS conserva array completo con activo=true', async () => {
    const { body } = await request({ activo: 'true' })
    assert.ok(Array.isArray(body))
    assert.equal(body.length, tenantA.filter(c => c.activo).length)
  })

  it('T22 facturación/bitácora conservan array con limit=500 sin page', async () => {
    const { body } = await request({ limit: '500' })
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 123)
    assert.equal(calls.count.length, 0)
  })

  it('T23 tamaño predeterminado idéntico a Inventario: 50', async () => {
    const { body } = await request({ page: '1' })
    assert.equal(body.paginacion.take, 50)
    assert.equal(body.data.length, 50)
  })

  it('T24 límite máximo idéntico a Inventario: 200', async () => {
    const { body } = await request({ page: '1', limit: '999' })
    assert.equal(body.paginacion.take, 200)
    assert.equal(body.data.length, 123)
  })

  it('T25 sin parámetros preserva el contrato legacy completo', async () => {
    const { body } = await request()
    assert.ok(Array.isArray(body))
    assert.deepEqual(body.map(c => c.id), expectedA.map(c => c.id))
    assert.equal(calls.count.length, 0)
    assert.equal(calls.findMany[0].skip, undefined)
    assert.equal(calls.findMany[0].take, undefined)
  })
})

describe('P2-1B frontend Inventory parity', () => {
  const html = fs.readFileSync(path.join(frontendRoot, 'clientes.html'), 'utf8')
  const js = fs.readFileSync(path.join(frontendRoot, 'clientes.js'), 'utf8')

  it('T04 Anterior replica control y navegación de Inventario', () => {
    assert.ok(html.includes('id="btn-pag-anterior"'))
    assert.ok(js.includes('navegarPagina(paginaActual - 1)'))
  })

  it('T05 Siguiente replica control y navegación de Inventario', () => {
    assert.ok(html.includes('id="btn-pag-siguiente"'))
    assert.ok(js.includes('navegarPagina(paginaActual + 1)'))
  })

  it('T10 búsqueda vuelve a página 1 antes de cargar', () => {
    const block = js.slice(js.indexOf("searchInput.addEventListener('input'"), js.indexOf("document.querySelectorAll('.tab-button')"))
    assert.ok(block.includes('paginaActual = 1'))
    assert.ok(block.indexOf('paginaActual = 1') < block.indexOf('cargarClientes()'))
  })

  it('T12 limpiar búsqueda también vuelve a página 1', () => {
    assert.ok(js.includes("searchInput.addEventListener('input'"))
    assert.ok(js.includes('paginaActual = 1'))
  })

  it('reutiliza HTML, CSS y helper compartidos de Inventario', () => {
    for (const id of ['paginacion-bar', 'pag-numeros', 'pag-info-label', 'pag-info-input']) {
      assert.ok(html.includes(`id="${id}"`), `falta #${id}`)
    }
    assert.ok(html.includes('href="pagination.css"'))
    assert.ok(html.includes('src="pagination.js"'))
    assert.ok(js.includes('jeshaRenderPaginacion({'))
  })
})
