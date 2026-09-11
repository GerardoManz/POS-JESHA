'use strict'

// ═══════════════════════════════════════════════════════════════════
// P2-1 — Clientes ordenados alfabéticamente A-Z
// Verifica que GET /clientes ordene por `nombre` asc + `id` asc
// ANTES de cualquier paginación (que hoy no existe), conservando
// tenant scope, filtros y contrato de respuesta.
// ═══════════════════════════════════════════════════════════════════

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { after, before, beforeEach, describe, it } = require('node:test')

const prismaPath = require.resolve('../src/lib/prisma')
const getEmpresaIdPath = require.resolve('../src/helpers/getEmpresaId')
const controllerPath = require.resolve('../src/modules/clientes/clientes.controller')

// ── Fixture base: ASCII mayúsculas, orden no ambiguo entre collations ──
const coreClients = [
  { id: 101, empresaId: 1, nombre: 'ZAPATERIA CENTRAL',       activo: true,  tipo: 'GENERAL',    rfc: 'ZAP010101XXX', telefono: '5551', email: 'z@x.mx' },
  { id: 102, empresaId: 1, nombre: 'ABARROTES DEL CENTRO',    activo: true,  tipo: 'GENERAL',    rfc: 'ABA010101XXX', telefono: '5552', email: 'a@x.mx' },
  { id: 103, empresaId: 1, nombre: 'FERRETERIA LOPEZ',        activo: true,  tipo: 'GENERAL',    rfc: 'FER010101XXX', telefono: '5553', email: 'f@x.mx' },
  { id: 104, empresaId: 1, nombre: 'ACEROS MEXICO',           activo: true,  tipo: 'FISCAL',     rfc: 'ACE010101XXX', telefono: '5554', email: 'ace@x.mx' },
  { id: 105, empresaId: 1, nombre: 'FERRETERIA JESUS',        activo: true,  tipo: 'GENERAL',    rfc: 'FEJ010101XXX', telefono: '5555', email: 'fej@x.mx' },
  { id: 106, empresaId: 1, nombre: 'FERRETERIA LOPEZ',        activo: true,  tipo: 'GENERAL',    rfc: 'FEL010101XXX', telefono: '5556', email: 'fel@x.mx' },
  { id: 107, empresaId: 1, nombre: 'JUAN PEREZ',              activo: false, tipo: 'GENERAL',    rfc: 'JUA010101XXX', telefono: '5557', email: 'j@x.mx' },
  { id: 201, empresaId: 2, nombre: 'ABARROTES EMPRESA B',     activo: true,  tipo: 'GENERAL',    rfc: 'EMB010101XXX', telefono: '5561', email: 'b@x.mx' }
]

// ── Fixture de collation: mayúsculas/minúsculas y acentos/ñ ──
const collationClients = [
  { id: 301, empresaId: 1, nombre: 'ACOSTA',        activo: true, tipo: 'GENERAL' },
  { id: 302, empresaId: 1, nombre: 'Acosta',        activo: true, tipo: 'GENERAL' },
  { id: 303, empresaId: 1, nombre: 'abarrotes',     activo: true, tipo: 'GENERAL' },
  { id: 304, empresaId: 1, nombre: 'ABARROTES',     activo: true, tipo: 'GENERAL' },
  { id: 305, empresaId: 1, nombre: 'AÑO NUEVO',     activo: true, tipo: 'GENERAL' },
  { id: 306, empresaId: 1, nombre: 'ANACLETO',      activo: true, tipo: 'GENERAL' }
]

let dataset = coreClients
const calls = { findMany: [], count: 0 }

function includes(value, search) {
  return typeof value === 'string' && value.toLowerCase().includes(String(search).toLowerCase())
}

function matchesCliente(cliente, where) {
  if (!where) return true
  if (where.empresaId !== undefined && cliente.empresaId !== where.empresaId) return false
  if (where.tipo !== undefined && cliente.tipo !== where.tipo) return false
  if (where.activo !== undefined && Boolean(cliente.activo) !== Boolean(where.activo)) return false
  if (where.OR) {
    return where.OR.some(condition => {
      if (condition.id?.in) return condition.id.in.includes(cliente.id)
      return Object.entries(condition).every(([field, filter]) => {
        if (filter && filter.contains !== undefined) return includes(cliente[field], filter.contains)
        return true
      })
    })
  }
  return true
}

// Interpreta el orderBy REAL que manda el controller (por eso el test detecta un orderBy incorrecto).
function comparar(a, b, specs) {
  for (const spec of specs) {
    const [field, dir] = Object.entries(spec)[0]
    const av = a[field]
    const bv = b[field]
    let cmp
    if (typeof av === 'string' || typeof bv === 'string') {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'es')
    } else {
      cmp = (av ?? 0) - (bv ?? 0)
    }
    if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
  }
  return 0
}

function applyOrderBy(rows, orderBy) {
  const specs = Array.isArray(orderBy) ? orderBy : (orderBy ? [orderBy] : [])
  if (!specs.length) return rows.slice()
  return rows.slice().sort((a, b) => comparar(a, b, specs))
}

const fakePrisma = {
  cliente: {
    async findMany(args) {
      calls.findMany.push(args)
      return applyOrderBy(dataset.filter(c => matchesCliente(c, args.where)), args.orderBy)
    },
    async count() {
      calls.count++
      return dataset.length
    }
  },
  async $queryRaw() { return [] } // fuerza el fallback contains del controller
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
  dataset = coreClients
  calls.findMany.length = 0
  calls.count = 0
})

after(() => {
  delete require.cache[controllerPath]
  if (originalPrismaCache) require.cache[prismaPath] = originalPrismaCache
  else delete require.cache[prismaPath]
  if (originalGetEmpresaCache) require.cache[getEmpresaIdPath] = originalGetEmpresaCache
  else delete require.cache[getEmpresaIdPath]
})

async function request(query = {}, { empresaId = 1 } = {}) {
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

const names = response => response.body.map(c => c.nombre)
const ids = response => response.body.map(c => c.id)
const isAscending = arr => arr.every((v, i) => i === 0 || arr[i - 1].localeCompare(v, 'es') <= 0)

describe('P2-1 — Clientes A-Z', { concurrency: 1 }, () => {
  it('T01 devuelve clientes ordenados A-Z por nombre', async () => {
    const res = await request()
    assert.equal(res.statusCode, 200)
    assert.deepEqual(names(res), [
      'ABARROTES DEL CENTRO',
      'ACEROS MEXICO',
      'FERRETERIA JESUS',
      'FERRETERIA LOPEZ',
      'FERRETERIA LOPEZ',
      'JUAN PEREZ',
      'ZAPATERIA CENTRAL'
    ])
    assert.ok(isAscending(names(res)), 'la secuencia debe ser ascendente')
  })

  it('T02 orden estable con nombres duplicados (desempate por id asc)', async () => {
    const res = await request()
    const lopez = res.body.filter(c => c.nombre === 'FERRETERIA LOPEZ')
    assert.deepEqual(lopez.map(c => c.id), [103, 106], 'mismo nombre → id ascendente')
    // Determinismo: dos ejecuciones idénticas
    const res2 = await request()
    assert.deepEqual(ids(res), ids(res2))
  })

  it('T03 búsqueda conserva el orden A-Z', async () => {
    const res = await request({ buscar: 'FER' })
    assert.deepEqual(names(res), ['FERRETERIA JESUS', 'FERRETERIA LOPEZ', 'FERRETERIA LOPEZ'])
    assert.ok(isAscending(names(res)))
  })

  it('T04 no hay paginación: orderBy aplica al conjunto completo', async () => {
    await request()
    assert.equal(calls.findMany.length, 1)
    const args = calls.findMany[0]
    assert.equal(args.skip, undefined, 'no debe usar skip')
    assert.equal(args.take, undefined, 'no debe usar take')
    assert.deepEqual(args.orderBy, [{ nombre: 'asc' }, { id: 'asc' }], 'orderBy explícito')
  })

  it('T05 continuidad global (página 1 + página 2 forman secuencia correcta)', async () => {
    // No hay paginación real; se simula el corte sobre el resultado ya ordenado.
    const rows = (await request()).body
    const size = 3
    const page1 = rows.slice(0, size).map(c => c.nombre)
    const page2 = rows.slice(size, size * 2).map(c => c.nombre)
    const global = [...page1, ...page2].concat(rows.slice(size * 2).map(c => c.nombre))
    assert.deepEqual(page1, ['ABARROTES DEL CENTRO', 'ACEROS MEXICO', 'FERRETERIA JESUS'])
    assert.deepEqual(page2, ['FERRETERIA LOPEZ', 'FERRETERIA LOPEZ', 'JUAN PEREZ'])
    assert.ok(isAscending(global), 'el global (p1+p2+...) debe ser ascendente')
  })

  it('T06 aislamiento por tenant: empresa 1 no mezcla clientes de empresa 2', async () => {
    const emp1 = await request({}, { empresaId: 1 })
    assert.ok(!emp1.body.some(c => c.empresaId === 2))
    assert.ok(!names(emp1).includes('ABARROTES EMPRESA B'))

    const emp2 = await request({}, { empresaId: 2 })
    assert.deepEqual(names(emp2), ['ABARROTES EMPRESA B'])
  })

  it('T07 filtro activo conserva el orden A-Z', async () => {
    const res = await request({ activo: 'true' })
    assert.ok(!names(res).includes('JUAN PEREZ'), 'excluye inactivos')
    assert.ok(isAscending(names(res)))
  })

  it('T08 contrato de respuesta sin cambios (array plano con campos del select)', async () => {
    const res = await request()
    assert.ok(Array.isArray(res.body), 'respuesta sigue siendo un array')
    for (const c of res.body) {
      assert.ok(Object.prototype.hasOwnProperty.call(c, 'id'))
      assert.ok(Object.prototype.hasOwnProperty.call(c, 'nombre'))
      assert.ok(Object.prototype.hasOwnProperty.call(c, 'activo'))
    }
  })

  it('T09 count no se ve afectado (no se invoca count)', async () => {
    await request()
    assert.equal(calls.count, 0, 'el listado no hace count')
  })

  it('T10 sin coincidencias → lista vacía normal', async () => {
    const res = await request({ buscar: 'ZZZ_NO_EXISTE' })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, [])
  })

  it('T11 mayúsculas/minúsculas: orden estable y búsqueda case-insensitive', async () => {
    dataset = collationClients
    const res = await request()
    assert.equal(res.body.length, collationClients.length)
    // Determinismo (no depende del orden de inserción)
    const res2 = await request()
    assert.deepEqual(ids(res), ids(res2))

    const searchUpper = await request({ buscar: 'acosta' })
    const searchLower = await request({ buscar: 'ACOSTA' })
    assert.deepEqual(ids(searchUpper), ids(searchLower), 'búsqueda insensible a mayúsculas')
    assert.ok(names(searchUpper).includes('ACOSTA'))
    assert.ok(names(searchUpper).includes('Acosta'))
  })

  it('T12 acentos/ñ: orden determinista y búsqueda funciona (collation de la DB decide el intercalado)', async () => {
    dataset = collationClients
    const res = await request()
    const first = names(res)
    const second = names(await request())
    assert.deepEqual(first, second, 'orden determinista entre ejecuciones')

    const searchEnie = await request({ buscar: 'AÑO' })
    assert.deepEqual(names(searchEnie), ['AÑO NUEVO'])
  })
})

describe('P2-1 — Fuente del orderBy', () => {
  it('T13 el controller usa nombre asc + id asc y ya no creadoEn desc en listar', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'clientes', 'clientes.controller.js'), 'utf8')
    const inicio = src.indexOf('const listar')
    const fin = src.indexOf('const obtener')
    assert.ok(inicio !== -1 && fin > inicio, 'debe localizarse la función listar')
    const listarSrc = src.slice(inicio, fin)
    assert.ok(listarSrc.includes("{ nombre: 'asc' }"), 'debe ordenar por nombre asc')
    assert.ok(listarSrc.includes("{ id: 'asc' }"), 'debe desempatar por id asc')
    assert.ok(!listarSrc.includes("orderBy: { creadoEn: 'desc' }"), 'no debe quedar el orderBy de creadoEn en el listado')
  })
})
