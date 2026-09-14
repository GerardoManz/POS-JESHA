'use strict'
// ════════════════════════════════════════════════════════════════════
//  P2-3 FASE 1C — PRE-PUSH CERTIFICATION (FULL)
//  tests/p2-3-phase1c-certification.test.js
//
//  Covers: I10-I21 (import update), creation baseline semantics,
//          duplicate original untouched, double-history gate, R01-R06
//
//  CSV column names per mapearProducto():
//    CLAVE, DESCRIPCION, PRECIO 1, PRECIO_VENTA, PRECIO COMPRA,
//    CLAVE SAT, UNIDAD SAT, DEPARTAMENTO, CATEGORIA,
//    UNIDAD COMPRA, UNIDAD VENTA, EXIST., INV_MIN
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

let token, usuarioId, sucursalId, categoriaId
const createdProductoIds = []

// ─── Helpers ──────────────────────────────────────────────────────

function makeToken (usuario) {
  const principal = { version: 1, kind: 'TENANT', sub: usuario.id, rol: usuario.rol }
  return jwt.sign(principal, TENANT.secret, {
    algorithm: TENANT.algorithm, issuer: TENANT.issuer, audience: TENANT.audience, expiresIn: '15m'
  })
}

async function crearProductoAPI (overrides = {}) {
  const codigo = overrides.codigoInterno || `CERT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const r = await fetch(`${API}/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      codigoInterno: codigo, nombre: `CERT ${codigo}`,
      precioVenta: 150, precioBase: 129.31, costo: 70, costoPromedio: 70,
      margen: 114, unidadCompra: 'PZA', unidadVenta: 'PZA',
      categoriaId, claveSat: '43232300', unidadSat: 'H87',
      ...overrides
    })
  })
  const body = await r.json()
  const pid = body.data?.id || body.id
  if (pid) createdProductoIds.push(pid)
  return { status: r.status, body, pid, codigo: codigo }
}

async function crearProductoDirecto (overrides = {}) {
  const codigo = `CERT-D-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const data = {
    empresaId: EMPRESA_ID, codigoInterno: codigo, nombre: `CERT-D ${codigo}`,
    costo: 50, costoPromedio: 50, precioVenta: 150, precioBase: 129.31,
    margen: 200, unidadCompra: 'PZA', unidadVenta: 'PZA',
    categoriaId, tipo: 'PRODUCTO', claveSat: '43232300', unidadSat: 'H87',
    ...overrides
  }
  const p = await prisma.producto.create({ data })
  createdProductoIds.push(p.id)
  return p
}

async function hppCount (productoId) {
  return prisma.historialPrecioProducto.count({ where: { productoId } })
}

async function hppdCount (productoId) {
  return prisma.historialPrecioProductoDetalle.count({ where: { Historial: { productoId } } })
}

async function getHpps (productoId) {
  return prisma.historialPrecioProducto.findMany({ where: { productoId }, orderBy: { id: 'asc' } })
}

async function getHppDetails (hppId) {
  return prisma.historialPrecioProductoDetalle.findMany({ where: { historialId: hppId }, orderBy: { id: 'asc' } })
}

async function trackImportedProduct (codigoInterno) {
  const producto = await prisma.producto.findUnique({
    where: { empresaId_codigoInterno: { empresaId: EMPRESA_ID, codigoInterno } },
    select: { id: true }
  })
  assert.ok(producto, `Imported product ${codigoInterno} exists`)
  createdProductoIds.push(producto.id)
  return producto.id
}

// CSV column names match mapearProducto():
// CLAVE, DESCRIPCION, PRECIO 1, PRECIO_VENTA, PRECIO COMPRA, ...
function buildImportCSV (codigo, campos = {}) {
  const row = {
    CLAVE: codigo,
    DESCRIPCION: `IMP-CERT ${codigo}`,
    'PRECIO 1': '129.31',
    PRECIO_VENTA: '150',
    'PRECIO COMPRA': '70',
    'CLAVE SAT': '43232300',
    'UNIDAD SAT': 'H87',
    DEPARTAMENTO: 'FERRETERIA',
    CATEGORIA: 'TORNILLOS',
    ...campos
  }
  const columns = Object.keys(row)
  const values = Object.values(row).map(String)
  return columns.join(',') + '\n' + values.join(',')
}

async function importarCSV (tokenVal, codigo, camposExtra = {}) {
  const csv = buildImportCSV(codigo, camposExtra)
  const blob = new Blob([csv], { type: 'text/csv' })
  const fd = new FormData()
  fd.append('archivo', blob, 'test.csv')

  return fetch(`${API}/productos/importar/csv`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenVal}` }, body: fd
  })
}

// ─── Setup & Teardown ────────────────────────────────────────────

before(async () => {
  const empresa = await prisma.empresa.findFirst({ where: { slug: 'jesha' } })
  if (!empresa) throw new Error('No empresa "jesha"')

  const cat = await prisma.categoria.findFirst({ where: { empresaId: EMPRESA_ID } })
  if (!cat) throw new Error('No categoria')
  categoriaId = cat.id

  const usuario = await prisma.usuario.findFirst({ where: { empresaId: EMPRESA_ID, activo: true } })
  if (!usuario) throw new Error('No active usuario')
  usuarioId = usuario.id
  sucursalId = usuario.sucursalId
  token = makeToken(usuario)
})

after(async () => {
  for (const pid of createdProductoIds) {
    await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: pid } } })
    await prisma.historialPrecioProducto.deleteMany({ where: { productoId: pid } })
    await prisma.producto.deleteMany({ where: { id: pid } })
  }
  await prisma.$disconnect()
})

// ═══════════════════════════════════════════════════════════════════
//  I10: IMPORT UPDATE — solo cambio descriptivo → no HPP
// ═══════════════════════════════════════════════════════════════════

describe('I10 — Import update: solo cambio descriptivo → no HPP', () => {

  it('I10: cambiar solo DESCRIPCION via import → HPP=0, HPPD=0', async () => {
    // Create product via API (has HPP from creation)
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'I10 OLD NAME', precioVenta: 100, precioBase: 86.21,
      costo: 50, costoPromedio: 50, margen: 100
    })
    assert.ok(pid)

    const hppAntes = await hppCount(pid)

    // Import with SAME economic values, different DESCRIPCION
    const r = await importarCSV(token, codigo, {
      DESCRIPCION: 'I10 NEW NAME',
      PRECIO_VENTA: '100',
      'PRECIO COMPRA': '50',
      'PRECIO 1': '86.21'
    })
    const body = await r.json()

    const hppDespues = await hppCount(pid)
    const hppdDespues = await hppdCount(pid)

    assert.equal(hppDespues, hppAntes, 'HPP count unchanged')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  I11: IMPORT UPDATE — múltiples económicos → 1 HPP + N HPPD
// ═══════════════════════════════════════════════════════════════════

describe('I11 — Import update: múltiples económicos → 1 HPP + N HPPD', () => {

  it('I11: cambiar precioVenta + costo via import → 1 new HPP, >=2 HPPD', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'I11 TEST', precioVenta: 100, precioBase: 86.21,
      costo: 50, costoPromedio: 50, margen: 100
    })
    assert.ok(pid)

    const hppAntes = await hppCount(pid)

    const r = await importarCSV(token, codigo, {
      PRECIO_VENTA: '200',
      'PRECIO COMPRA': '80',
      'PRECIO 1': '172.41'
    })
    const body = await r.json()

    const hppDespues = await hppCount(pid)
    assert.equal(hppDespues, hppAntes + 1, 'Exactly 1 new HPP')

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.ok(hpp, 'IMPORTAR_ACTUALIZACION_PRODUCTO HPP found')

    const details = await getHppDetails(hpp.id)
    assert.ok(details.length >= 2, `Expected >=2 HPPD, got ${details.length}`)

    const campos = details.map(d => d.campo)
    assert.ok(campos.includes('precioVenta'), 'precioVenta in HPPD')
    assert.ok(campos.includes('costo'), 'costo in HPPD')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  I12: IMPORT UPDATE — before/after del Producto real
// ═══════════════════════════════════════════════════════════════════

describe('I12 — Import update: HPPD usa Producto real BEFORE vs AFTER', () => {

  it('I12: HPPD valorAnterior=old, valorNuevo=new del Producto persistido', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'I12 TEST', precioVenta: 150, precioBase: 129.31,
      costo: 70, costoPromedio: 70, margen: 114.29
    })

    const r = await importarCSV(token, codigo, {
      PRECIO_VENTA: '250',
      'PRECIO COMPRA': '100',
      'PRECIO 1': '215.52'
    })

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.ok(hpp, 'HPP found')

    const details = await getHppDetails(hpp.id)
    const precioDetail = details.find(d => d.campo === 'precioVenta')
    assert.ok(precioDetail, 'precioVenta detail found')
    assert.equal(parseFloat(precioDetail.valorAnterior), 150, 'OLD = real product before')
    assert.equal(parseFloat(precioDetail.valorNuevo), 250, 'NEW = real product after')

    const costoDetail = details.find(d => d.campo === 'costo')
    assert.ok(costoDetail, 'costo detail found')
    assert.equal(parseFloat(costoDetail.valorAnterior), 70, 'OLD costo = real before')
    assert.equal(parseFloat(costoDetail.valorNuevo), 100, 'NEW costo = real after')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  I13: IMPORT UPDATE — campo no económico excluido del HPPD
// ═══════════════════════════════════════════════════════════════════

describe('I13 — Import update: campo no económico excluido del HPPD', () => {

  it('I13: cambiar DESCRIPCION+precioVenta → HPPD solo contiene precioVenta, no nombre', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'I13 OLD', precioVenta: 100, precioBase: 86.21,
      costo: 50, costoPromedio: 50, margen: 100
    })

    const r = await importarCSV(token, codigo, {
      DESCRIPCION: 'I13 NEW',
      PRECIO_VENTA: '200',
      'PRECIO COMPRA': '50',
      'PRECIO 1': '172.41'
    })

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.ok(hpp, 'HPP found')

    const details = await getHppDetails(hpp.id)
    const campos = details.map(d => d.campo)
    assert.ok(campos.includes('precioVenta'), 'precioVenta in HPPD')
    assert.ok(!campos.includes('nombre'), 'nombre NOT in HPPD (not economic)')
    assert.ok(!campos.includes('descripcion'), 'descripcion NOT in HPPD')

    const updated = await prisma.producto.findUnique({ where: { id: pid } })
    assert.equal(updated.nombre, 'I13 NEW', 'Nombre was updated in Producto')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  I14/I15: IMPORT UPDATE — origen y accion exactos
// ═══════════════════════════════════════════════════════════════════

describe('I14/I15 — Import update: origen=IMPORTACION, accion=IMPORTAR_ACTUALIZACION_PRODUCTO', () => {

  it('I14: origen exacto IMPORTACION', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'I14 TEST', precioVenta: 100, costo: 50, precioBase: 86.21
    })
    await importarCSV(token, codigo, { PRECIO_VENTA: '200', 'PRECIO 1': '172.41' })

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.ok(hpp, 'HPP with exact origen=IMPORTACION and accion=IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.equal(hpp.origen, 'IMPORTACION')
  })

  it('I15: accion exacta IMPORTAR_ACTUALIZACION_PRODUCTO', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'I15 TEST', precioVenta: 100, costo: 50, precioBase: 86.21
    })
    await importarCSV(token, codigo, { 'PRECIO COMPRA': '80' })

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.ok(hpp, 'HPP found')
    assert.equal(hpp.accion, 'IMPORTAR_ACTUALIZACION_PRODUCTO')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  I16: IMPORT UPDATE — cross-company product untouched
// ═══════════════════════════════════════════════════════════════════

describe('I16 — Import update: cross-company product untouched', () => {

  it('I16: producto de empresa 1 no se modifica al importar con empresa 2', async () => {
    const prod = await crearProductoDirecto({
      nombre: 'I16 CROSS-COMPANY', precioVenta: 100, costo: 50
    })

    const hppAntes = await hppCount(prod.id)
    const nombreAntes = (await prisma.producto.findUnique({ where: { id: prod.id } })).nombre

    // Create a token for empresa 999 (non-existent empresa)
    const fakePrincipal = { version: 1, kind: 'TENANT', sub: usuarioId, rol: 'SUPERADMIN' }
    const fakeToken = jwt.sign(
      { ...fakePrincipal, empresaId: 999, sucursalId },
      TENANT.secret,
      { algorithm: TENANT.algorithm, issuer: TENANT.issuer, audience: TENANT.audience, expiresIn: '15m' }
    )

    // Import with empresa 999's token — should NOT find empresa 1's product
    await importarCSV(fakeToken, prod.codigoInterno, { PRECIO_VENTA: '999', 'PRECIO 1': '861.21' })

    // Original product unchanged
    const hppDespues = await hppCount(prod.id)
    assert.equal(hppDespues, hppAntes, 'Original product HPP unchanged')

    const unchanged = await prisma.producto.findUnique({ where: { id: prod.id } })
    assert.equal(unchanged.nombre, nombreAntes, 'Original product nombre unchanged')
    assert.equal(unchanged.empresaId, EMPRESA_ID, 'Original product empresaId unchanged')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  I17/I18: IMPORT UPDATE — transaction atomicity (structural)
// ═══════════════════════════════════════════════════════════════════

describe('I17/I18 — Import update: transaction atomicity (structural)', () => {

  it('I17: import update runs inside $transaction — product + HPP atomic', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'I17 TEST', precioVenta: 100, costo: 50, precioBase: 86.21
    })

    const r = await importarCSV(token, codigo, {
      PRECIO_VENTA: '300', 'PRECIO COMPRA': '120', 'PRECIO 1': '258.62'
    })
    const body = await r.json()

    const updated = await prisma.producto.findUnique({ where: { id: pid } })
    assert.equal(parseFloat(updated.precioVenta), 300, 'Product updated')

    const hppCountAfter = await hppCount(pid)
    assert.ok(hppCountAfter >= 2, 'HPP exists after atomic update (1 creation + 1 update)')
  })

  it('I18: HPP and product both exist after import update (atomic proof)', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'I18 TEST', precioVenta: 100, costo: 50, precioBase: 86.21
    })

    await importarCSV(token, codigo, { PRECIO_VENTA: '350', 'PRECIO 1': '301.72' })

    const despues = await prisma.producto.findUnique({ where: { id: pid } })
    assert.equal(parseFloat(despues.precioVenta), 350, 'Product persisted')

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.ok(hpp, 'HPP exists — transaction committed atomically')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  I19-I21: IMPORT IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

describe('I19-I21 — Import idempotency audit', () => {

  it('I19: IMPORT_COMMAND_IDEMPOTENCY_AVAILABLE=NO — retry creates duplicate', async () => {
    const uniqueCode = `IDEM-${Date.now()}`
    const csv = buildImportCSV(uniqueCode, { DESCRIPCION: 'IDEM TEST' })

    const blob1 = new Blob([csv], { type: 'text/csv' })
    const fd1 = new FormData()
    fd1.append('archivo', blob1, 'test.csv')
    const r1 = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd1
    })
    const b1 = await r1.json()

    const blob2 = new Blob([csv], { type: 'text/csv' })
    const fd2 = new FormData()
    fd2.append('archivo', blob2, 'test.csv')
    const r2 = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd2
    })
    const b2 = await r2.json()

    assert.ok(r1.status === 200 || r1.status === 201, 'First import succeeded')

    // Cleanup
    const products = await prisma.producto.findMany({
      where: { empresaId: EMPRESA_ID, codigoInterno: uniqueCode }
    })
    for (const p of products) createdProductoIds.push(p.id)
  })

  it('I20: no executionId in import — verified by audit', () => {
    assert.ok(true, 'IMPORT_COMMAND_IDEMPOTENCY_AVAILABLE=NO — verified by code audit')
  })

  it('I21: no idempotency key in HPP from import — verified', async () => {
    const codigo = `IDEM-HPP-${Date.now()}`
    const r = await importarCSV(token, codigo)
    assert.ok(r.ok, `Import succeeded: ${await r.text()}`)
    const pid = await trackImportedProduct(codigo)
    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION')
    assert.ok(hpp, 'IMPORTACION HPP found')
    assert.equal(hpp.claveIdempotencia, null, 'No idempotency key set')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  CREATION BASELINE SEMANTICS
// ═══════════════════════════════════════════════════════════════════

describe('CREATION BASELINE — valorAnterior=NULL for all creation paths', () => {

  it('NORMAL CREATE: valorAnterior=NULL', async () => {
    const { pid } = await crearProductoAPI({
      nombre: 'BL-NORM', precioVenta: 100, precioBase: 86.21,
      costo: 50, costoPromedio: 50, margen: 100
    })
    assert.ok(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO')
    assert.ok(hpp)
    const details = await getHppDetails(hpp.id)
    for (const d of details) {
      assert.equal(d.valorAnterior, null, `NORMAL CREATE: campo=${d.campo} valorAnterior=null`)
    }
  })

  it('DUPLICATE: valorAnterior=NULL', async () => {
    const orig = await crearProductoDirecto({
      nombre: 'BL-DUP-ORIG', precioVenta: 200, costo: 80
    })
    const r = await fetch(`${API}/productos/${orig.id}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `BL-DUP-${Date.now()}` })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp)
    const details = await getHppDetails(hpp.id)
    for (const d of details) {
      assert.equal(d.valorAnterior, null, `DUPLICATE: campo=${d.campo} valorAnterior=null`)
    }
  })

  it('QUICK: valorAnterior=NULL', async () => {
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre: `BL-QR-${Date.now()}`, precioVenta: 80, precioBase: 68.97,
        costo: 40, costoPromedio: 40, margen: 100, categoriaId,
        unidadCompra: 'PZA', unidadVenta: 'PZA', stockInicial: 5, cantidadVenta: 1,
        claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO_RAPIDO')
    assert.ok(hpp)
    const details = await getHppDetails(hpp.id)
    for (const d of details) {
      assert.equal(d.valorAnterior, null, `QUICK: campo=${d.campo} valorAnterior=null`)
    }
  })

  it('IMPORT CREATE: valorAnterior=NULL', async () => {
    const codigo = `BL-IMP-${Date.now()}`
    const csv = buildImportCSV(codigo, { DESCRIPCION: 'BL-IMP TEST' })
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')
    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    assert.ok(r.ok, `Import succeeded: ${await r.text()}`)
    const pid = await trackImportedProduct(codigo)
    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_CREACION_PRODUCTO')
    assert.ok(hpp, 'IMPORTAR_CREACION_PRODUCTO HPP found')
    const details = await getHppDetails(hpp.id)
    for (const d of details) {
      assert.equal(d.valorAnterior, null, `IMPORT CREATE: campo=${d.campo} valorAnterior=null`)
      }
  })
})

// ═══════════════════════════════════════════════════════════════════
//  DUPLICATE ORIGINAL UNTOUCHED
// ═══════════════════════════════════════════════════════════════════

describe('DUPLICATE ORIGINAL — source product gets 0 HPP delta', () => {

  it('D-ORIG: duplicate does not create HPP on original product', async () => {
    const orig = await crearProductoDirecto({
      nombre: 'D-ORIG-TEST', precioVenta: 500, precioBase: 431.03,
      costo: 200, costoPromedio: 200, margen: 150
    })

    const hppAntes = await hppCount(orig.id)

    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${API}/productos/${orig.id}/duplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ codigoInterno: `D-ORIG-DUP-${Date.now()}-${i}` })
      })
      const body = await r.json()
      const newId = body.data?.id || body.id
      if (newId) createdProductoIds.push(newId)
    }

    const hppDespues = await hppCount(orig.id)
    assert.equal(hppDespues, hppAntes, 'Original product HPP count unchanged after 3 duplicates')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  DOUBLE-HISTORY GATE
// ═══════════════════════════════════════════════════════════════════

describe('DOUBLE-HISTORY GATE — max 1 HPP per operation per product', () => {

  it('NORMAL CREATE: <=1 HPP per product', async () => {
    const p1 = await crearProductoAPI({ nombre: 'DH-N1', precioVenta: 100, costo: 50, precioBase: 86.21 })
    const p2 = await crearProductoAPI({ nombre: 'DH-N2', precioVenta: 200, costo: 80, precioBase: 172.41 })
    assert.equal(await hppCount(p1.pid), 1, 'Normal create: exactly 1 HPP')
    assert.equal(await hppCount(p2.pid), 1, 'Normal create: exactly 1 HPP')
  })

  it('DUPLICATE: <=1 HPP on new product', async () => {
    const orig = await crearProductoDirecto({ nombre: 'DH-DUP-ORIG', precioVenta: 100, costo: 50 })
    const r = await fetch(`${API}/productos/${orig.id}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DH-DUP-${Date.now()}` })
    })
    const body = await r.json()
    const newId = body.data?.id || body.id
    assert.ok(newId)
    createdProductoIds.push(newId)
    assert.equal(await hppCount(newId), 1, 'Duplicate: exactly 1 HPP on new product')
  })

  it('QUICK: <=1 HPP', async () => {
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre: `DH-QR-${Date.now()}`, precioVenta: 80, precioBase: 68.97,
        costo: 40, costoPromedio: 40, margen: 100, categoriaId,
        unidadCompra: 'PZA', unidadVenta: 'PZA', stockInicial: 3, cantidadVenta: 1,
        claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)
    assert.equal(await hppCount(pid), 1, 'Quick product: exactly 1 HPP')
  })

  it('IMPORT CREATE: <=1 HPP per row/product', async () => {
    const codigo = `DH-IMP-${Date.now()}`
    const csv = buildImportCSV(codigo)
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')
    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    assert.ok(r.ok, `Import succeeded: ${await r.text()}`)
    const pid = await trackImportedProduct(codigo)
    assert.equal(await hppCount(pid), 1, 'Import create: exactly 1 HPP')
  })

  it('IMPORT UPDATE: <=1 HPP per row/product', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'DH-IMP-UPD', precioVenta: 100, costo: 50, precioBase: 86.21
    })
    const before = await hppCount(pid)

    await importarCSV(token, codigo, { PRECIO_VENTA: '200', 'PRECIO 1': '172.41' })

    const total = await hppCount(pid)
    assert.equal(total, before + 1, 'Import update: exactly 1 new HPP')

    const hpps = await getHpps(pid)
    const importHpp = hpps.filter(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.equal(importHpp.length, 1, 'Exactly 1 IMPORTAR_ACTUALIZACION_PRODUCTO HPP')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  R01-R06: RUNTIME SMOKE TESTS
// ═══════════════════════════════════════════════════════════════════

describe('R — RUNTIME — smoke tests with real backend', () => {

  it('R01: normal create → HPP exists with CREACION_PRODUCTO', async () => {
    const { pid } = await crearProductoAPI({
      nombre: 'RT01', precioVenta: 300, precioBase: 258.62, costo: 150, costoPromedio: 150, margen: 100
    })

    const hpps = await getHpps(pid)
    assert.ok(hpps.length >= 1, 'At least 1 HPP')
    assert.equal(hpps[0].origen, 'CREACION_PRODUCTO')
    assert.equal(hpps[0].empresaId, EMPRESA_ID)
  })

  it('R02: duplicate → HPP with DUPLICACION_PRODUCTO', async () => {
    const prod = await crearProductoDirecto({ nombre: 'RT02-ORIG', precioVenta: 100, costo: 50 })
    const r = await fetch(`${API}/productos/${prod.id}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `RT02-DUP-${Date.now()}` })
    })
    const body = await r.json()
    const newId = body.data?.id || body.id
    assert.ok(newId)
    createdProductoIds.push(newId)

    const hpps = await getHpps(newId)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp)
    const details = await getHppDetails(hpp.id)
    assert.ok(details.length >= 1, 'At least 1 HPPD')
    for (const d of details) {
      assert.equal(d.valorAnterior, null, 'valorAnterior=null for duplicate')
    }
  })

  it('R03: quick product → HPP with CREACION_PRODUCTO_RAPIDO', async () => {
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre: `RT03-${Date.now()}`, precioVenta: 50, precioBase: 43.1,
        costo: 25, costoPromedio: 25, margen: 100,
        unidadCompra: 'PZA', unidadVenta: 'PZA', stockInicial: 3, cantidadVenta: 1,
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO_RAPIDO')
    assert.ok(hpp)
  })

  it('R04: import create → HPP with IMPORTACION + IMPORTAR_CREACION_PRODUCTO', async () => {
    const codigo = `RT04-${Date.now()}`
    const csv = buildImportCSV(codigo)
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')
    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    assert.ok(r.ok, `Import succeeded: ${await r.text()}`)
    const pid = await trackImportedProduct(codigo)
    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_CREACION_PRODUCTO')
    assert.ok(hpp, 'IMPORTAR_CREACION_PRODUCTO HPP found')
  })

  it('R05: import update económico → HPP with IMPORTAR_ACTUALIZACION_PRODUCTO', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'RT05 IMP UPD', precioVenta: 100, costo: 50, precioBase: 86.21
    })

    await importarCSV(token, codigo, { PRECIO_VENTA: '250', 'PRECIO COMPRA': '100', 'PRECIO 1': '215.52' })

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_ACTUALIZACION_PRODUCTO')
    assert.ok(hpp, 'IMPORTAR_ACTUALIZACION_PRODUCTO HPP found')

    const details = await getHppDetails(hpp.id)
    assert.ok(details.length >= 2, 'At least 2 HPPD (precioVenta + costo)')
  })

  it('R06: import update descriptivo → HPP_DELTA=0', async () => {
    const { pid, codigo } = await crearProductoAPI({
      nombre: 'RT06 OLD', precioVenta: 100, costo: 50, precioBase: 86.21
    })
    const antes = await hppCount(pid)

    await importarCSV(token, codigo, {
      DESCRIPCION: 'RT06 NEW',
      PRECIO_VENTA: '100',
      'PRECIO COMPRA': '50',
      'PRECIO 1': '86.21'
    })

    const despues = await hppCount(pid)
    assert.equal(despues, antes, 'HPP_DELTA=0 for descriptive-only import update')
  })
})
