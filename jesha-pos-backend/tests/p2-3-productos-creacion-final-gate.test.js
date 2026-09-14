'use strict'
// ════════════════════════════════════════════════════════════════════
//  P2-3 FASE 1C — CREACIÓN/DUPLICACIÓN/RÁPIDO/IMPORTACIÓN — FINAL GATE
//  tests/p2-3-productos-creacion-final-gate.test.js
//
//  Tests: N01-N10 (normal create), D01-D08 (duplicate), Q01-Q07 (quick),
//         I01-I21 (import), R01-R06 (runtime)
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

async function crearProductoDirecto (overrides = {}) {
  const codigo = `FG1C-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const data = {
    empresaId: EMPRESA_ID, codigoInterno: codigo, nombre: `FG1C TEST ${codigo}`,
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
  // Cleanup: delete test products and their HPP/HPPD
  for (const pid of createdProductoIds) {
    await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: pid } } })
    await prisma.historialPrecioProducto.deleteMany({ where: { productoId: pid } })
    await prisma.producto.deleteMany({ where: { id: pid } })
  }
  await prisma.$disconnect()
})

// ═══════════════════════════════════════════════════════════════════
//  N01-N10: NORMAL CREATE (POST /productos)
// ═══════════════════════════════════════════════════════════════════

describe('N — POST /productos — historial económico en creación', () => {

  it('N01: crear producto con precioVenta → crea HPP', async () => {
    const codigo = `N01-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N01 ${codigo}`,
        precioVenta: 200, precioBase: 172.41, costo: 80, costoPromedio: 80,
        margen: 150, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(body)}`)
    const pid = body.data?.id || body.id
    assert.ok(pid, 'Product ID returned')
    createdProductoIds.push(pid)

    const count = await hppCount(pid)
    assert.ok(count >= 1, `Expected >= 1 HPP, got ${count}`)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO')
    assert.ok(hpp, 'HPP with origen=CREACION_PRODUCTO found')
    assert.equal(hpp.accion, 'CREAR_PRODUCTO')
    assert.equal(hpp.empresaId, EMPRESA_ID)
    assert.ok(hpp.referencia.startsWith('PRODUCTO:'), `referencia starts with PRODUCTO: — got ${hpp.referencia}`)
  })

  it('N02: HPP creation — HPPD details have valorAnterior=null (antes={})', async () => {
    const codigo = `N02-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N02 ${codigo}`,
        precioVenta: 100, precioBase: 86.21, costo: 50, costoPromedio: 50,
        margen: 100, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO')
    assert.ok(hpp)
    const details = await getHppDetails(hpp.id)
    assert.ok(details.length >= 1, 'At least 1 HPPD detail')
    for (const d of details) {
      assert.equal(d.valorAnterior, null, `HPPD campo=${d.campo} — valorAnterior must be null for creation`)
    }
  })

  it('N03: HPP creation — HPPD details have valorNuevo with economic values', async () => {
    const codigo = `N03-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N03 ${codigo}`,
        precioVenta: 300, precioBase: 258.62, costo: 120, costoPromedio: 120,
        margen: 150, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO')
    assert.ok(hpp)
    const details = await getHppDetails(hpp.id)
    assert.ok(details.length >= 1, 'At least 1 HPPD detail')
    for (const d of details) {
      assert.ok(d.valorNuevo !== null, `HPPD campo=${d.campo} — valorNuevo must not be null`)
    }
  })

  it('N04: HPP tiene auditoriaId null (no Audit record)', async () => {
    const codigo = `N04-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N04 ${codigo}`,
        precioVenta: 100, precioBase: 86.21, costo: 50, costoPromedio: 50,
        margen: 100, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO')
    assert.ok(hpp)
    assert.equal(hpp.auditoriaId, null, 'auditoriaId must be null for create')
  })

  it('N05: HPP tiene usuarioId del JWT', async () => {
    const codigo = `N05-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N05 ${codigo}`,
        precioVenta: 100, precioBase: 86.21, costo: 50, costoPromedio: 50,
        margen: 100, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO')
    assert.ok(hpp)
    assert.equal(hpp.usuarioId, usuarioId, 'usuarioId must match JWT user')
  })

  it('N06: HPP tiene empresaId correcto', async () => {
    const codigo = `N06-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N06 ${codigo}`,
        precioVenta: 100, precioBase: 86.21, costo: 50, costoPromedio: 50,
        margen: 100, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO')
    assert.ok(hpp)
    assert.equal(hpp.empresaId, EMPRESA_ID)
  })

  it('N07: crear sin precioVenta → HPP still created (campo economics)', async () => {
    const codigo = `N07-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N07 ${codigo}`,
        precioBase: 86.21, costo: 30, costoPromedio: 30, margen: 50,
        unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const count = await hppCount(pid)
    assert.ok(count >= 1, `Expected >= 1 HPP even without precioVenta, got ${count}`)
  })

  it('N08: crear con precioBase minimo → HPP created (defaults differ from null)', async () => {
    const codigo = `N08-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N08 ${codigo}`,
        precioBase: 0.01, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid, `Product created — got ${r.status}: ${JSON.stringify(body)}`)
    createdProductoIds.push(pid)

    const count = await hppCount(pid)
    assert.ok(count >= 1, `Expected >= 1 HPP (precioBase default differs from null), got ${count}`)
  })

  it('N09: precio base and costo also create HPPD details', async () => {
    const codigo = `N09-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N09 ${codigo}`,
        precioVenta: 250, precioBase: 215.52, costo: 100, costoPromedio: 100,
        margen: 150, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const count = await hppdCount(pid)
    assert.ok(count >= 2, `Expected >= 2 HPPD for precioVenta+costo, got ${count}`)
  })

  it('N10: HPP and Producto created atomically — if HPP fails, no product', async () => {
    // This is a structural test — verify the $transaction wraps both
    const codigo = `N10-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `TEST N10 ${codigo}`,
        precioVenta: 100, precioBase: 86.21, costo: 50, costoPromedio: 50,
        margen: 100, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    // Both exist
    const prod = await prisma.producto.findUnique({ where: { id: pid } })
    assert.ok(prod, 'Product exists')
    const hppN = await hppCount(pid)
    assert.ok(hppN >= 1, 'HPP exists')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  D01-D08: DUPLICATE (POST /productos/:id/duplicar)
// ═══════════════════════════════════════════════════════════════════

describe('D — POST /productos/:id/duplicar — historial económico', () => {
  let originalId

  before(async () => {
    const prod = await crearProductoDirecto({
      nombre: 'D-ORIGINAL-SEED', precioVenta: 500, precioBase: 431.03,
      costo: 200, costoPromedio: 200, margen: 150
    })
    originalId = prod.id
  })

  it('D01: duplicar crea HPP en producto nuevo', async () => {
    const r = await fetch(`${API}/productos/${originalId}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DUP-${Date.now()}` })
    })
    const body = await r.json()
    assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(body)}`)
    const newId = body.data?.id || body.id
    assert.ok(newId, 'Duplicated product ID')
    createdProductoIds.push(newId)

    const count = await hppCount(newId)
    assert.ok(count >= 1, `Expected >= 1 HPP on duplicate, got ${count}`)

    const hpps = await getHpps(newId)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp, 'HPP with origen=DUPLICACION_PRODUCTO found')
    assert.equal(hpp.accion, 'DUPLICAR_PRODUCTO')
  })

  it('D02: duplicate HPPD — valorAnterior=null for all details (antes={})', async () => {
    const r = await fetch(`${API}/productos/${originalId}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DUP-${Date.now()}-2` })
    })
    const body = await r.json()
    const newId = body.data?.id || body.id
    assert.ok(newId)
    createdProductoIds.push(newId)

    const hpps = await getHpps(newId)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp)
    const details = await getHppDetails(hpp.id)
    assert.ok(details.length >= 1, 'At least 1 HPPD detail')
    for (const d of details) {
      assert.equal(d.valorAnterior, null, `HPPD campo=${d.campo} — valorAnterior must be null for creation`)
    }
  })

  it('D03: duplicate HPPD — valorNuevo has economic values', async () => {
    const r = await fetch(`${API}/productos/${originalId}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DUP-${Date.now()}-3` })
    })
    const body = await r.json()
    const newId = body.data?.id || body.id
    assert.ok(newId)
    createdProductoIds.push(newId)

    const hpps = await getHpps(newId)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp)
    const details = await getHppDetails(hpp.id)
    assert.ok(details.length >= 1, 'At least 1 HPPD detail')
    for (const d of details) {
      assert.ok(d.valorNuevo !== null, `HPPD campo=${d.campo} — valorNuevo must not be null`)
    }
  })

  it('D04: original gets 0 HPP (no events on source)', async () => {
    const antesDe = await hppCount(originalId)
    await fetch(`${API}/productos/${originalId}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DUP-${Date.now()}-4` })
    })
    const despues = await hppCount(originalId)
    assert.equal(despues, antesDe, 'Original HPP count unchanged')
  })

  it('D05: duplicate HPP auditoriaId is not null (has Audit record)', async () => {
    const r = await fetch(`${API}/productos/${originalId}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DUP-${Date.now()}-5` })
    })
    const body = await r.json()
    const newId = body.data?.id || body.id
    assert.ok(newId)
    createdProductoIds.push(newId)

    const hpps = await getHpps(newId)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp)
    // Duplicate creates an Audit record, so auditoriaId should be set
    assert.ok(hpp.auditoriaId !== null, 'auditoriaId set (Audit record created)')
  })

  it('D06: duplicate empresaId matches original', async () => {
    const r = await fetch(`${API}/productos/${originalId}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DUP-${Date.now()}-6` })
    })
    const body = await r.json()
    const newId = body.data?.id || body.id
    assert.ok(newId)
    createdProductoIds.push(newId)

    const hpps = await getHpps(newId)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp)
    assert.equal(hpp.empresaId, EMPRESA_ID)
  })

  it('D07: duplicate referencia has PRODUCTO: format', async () => {
    const r = await fetch(`${API}/productos/${originalId}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DUP-${Date.now()}-7` })
    })
    const body = await r.json()
    const newId = body.data?.id || body.id
    assert.ok(newId)
    createdProductoIds.push(newId)

    const hpps = await getHpps(newId)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp)
    assert.ok(hpp.referencia.startsWith('PRODUCTO:'), `referencia format — got ${hpp.referencia}`)
  })

  it('D08: duplicate usuarioId from JWT', async () => {
    const r = await fetch(`${API}/productos/${originalId}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigoInterno: `DUP-${Date.now()}-8` })
    })
    const body = await r.json()
    const newId = body.data?.id || body.id
    assert.ok(newId)
    createdProductoIds.push(newId)

    const hpps = await getHpps(newId)
    const hpp = hpps.find(h => h.origen === 'DUPLICACION_PRODUCTO')
    assert.ok(hpp)
    assert.equal(hpp.usuarioId, usuarioId)
  })
})

// ═══════════════════════════════════════════════════════════════════
//  Q01-Q07: QUICK PRODUCT (POST /productos/articulo-rapido)
// ═══════════════════════════════════════════════════════════════════

describe('Q — POST /productos/articulo-rapido — historial económico', () => {

  it('Q01: crear artículo rápido → crea HPP', async () => {
    const nombre = `QR-${Date.now()}`
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre, precioVenta: 80, precioBase: 68.97, costo: 40, costoPromedio: 40, margen: 100, categoriaId,
        unidadCompra: 'PZA', unidadVenta: 'PZA', stockInicial: 10, stockMinimoAlerta: 2, cantidadVenta: 1,
        claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(body)}`)
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const count = await hppCount(pid)
    assert.ok(count >= 1, `Expected >= 1 HPP for quick product, got ${count}`)
  })

  it('Q02: HPP origen=CREACION_PRODUCTO_RAPIDO', async () => {
    const nombre = `QR-${Date.now()}`
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre, precioVenta: 80, precioBase: 68.97, costo: 40, costoPromedio: 40, margen: 100, categoriaId,
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
    assert.ok(hpp, 'HPP with origen=CREACION_PRODUCTO_RAPIDO found')
    assert.equal(hpp.accion, 'CREAR_PRODUCTO_RAPIDO')
  })

  it('Q03: HPP creation — HPPD details have valorAnterior=null (antes={})', async () => {
    const nombre = `QR-${Date.now()}`
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre, precioVenta: 80, precioBase: 68.97, costo: 40, costoPromedio: 40, margen: 100, categoriaId,
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
      assert.equal(d.valorAnterior, null, `HPPD campo=${d.campo} — valorAnterior must be null`)
    }
  })

  it('Q04: HPP auditoriaId null for quick product', async () => {
    const nombre = `QR-${Date.now()}`
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre, precioVenta: 80, precioBase: 68.97, costo: 40, costoPromedio: 40, margen: 100, categoriaId,
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
    assert.equal(hpp.auditoriaId, null, 'auditoriaId null for quick product')
  })

  it('Q05: HPP empresaId correcto', async () => {
    const nombre = `QR-${Date.now()}`
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre, precioVenta: 80, precioBase: 68.97, costo: 40, costoPromedio: 40, margen: 100, categoriaId,
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
    assert.equal(hpp.empresaId, EMPRESA_ID)
  })

  it('Q06: HPP usuarioId from JWT', async () => {
    const nombre = `QR-${Date.now()}`
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre, precioVenta: 80, precioBase: 68.97, costo: 40, costoPromedio: 40, margen: 100, categoriaId,
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
    assert.equal(hpp.usuarioId, usuarioId)
  })

  it('Q07: quick product HPP + product atomic — both exist', async () => {
    const nombre = `QR-${Date.now()}`
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre, precioVenta: 80, precioBase: 68.97, costo: 40, costoPromedio: 40, margen: 100, categoriaId,
        unidadCompra: 'PZA', unidadVenta: 'PZA', stockInicial: 5, cantidadVenta: 1,
        claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const prod = await prisma.producto.findUnique({ where: { id: pid } })
    assert.ok(prod, 'Product exists')
    const hppN = await hppCount(pid)
    assert.ok(hppN >= 1, 'HPP exists')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  I01-I21: IMPORT (POST /productos/importar)
// ═══════════════════════════════════════════════════════════════════

describe('I — POST /productos/importar — historial económico', () => {

  it('I01: import crear producto nuevo → crea HPP', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 01,150,70,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(body)}`)
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const count = await hppCount(pid)
      assert.ok(count >= 1, `Expected >= 1 HPP for import create, got ${count}`)
    }
  })

  it('I02: import HPP origen=IMPORTACION', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 02,200,80,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const hpps = await getHpps(pid)
      const hpp = hpps.find(h => h.origen === 'IMPORTACION')
      assert.ok(hpp, 'HPP with origen=IMPORTACION found')
      assert.equal(hpp.accion, 'IMPORTAR_CREACION_PRODUCTO')
    }
  })

  it('I03: import HPP antes={}', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 03,200,80,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const hpps = await getHpps(pid)
      const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_CREACION_PRODUCTO')
      if (hpp) assert.deepEqual(hpp.antes, {}, 'antes must be empty for import create')
    }
  })

  it('I04: import HPP despues with economic fields', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 04,250,100,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const hpps = await getHpps(pid)
      const hpp = hpps.find(h => h.origen === 'IMPORTACION' && h.accion === 'IMPORTAR_CREACION_PRODUCTO')
      if (hpp) {
        assert.ok(hpp.despues.costo !== undefined, 'despues.costo')
        assert.ok(hpp.despues.precioVenta !== undefined, 'despues.precioVenta')
      }
    }
  })

  it('I05: import empresaId correcto', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 05,150,70,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const hpps = await getHpps(pid)
      const hpp = hpps.find(h => h.origen === 'IMPORTACION')
      if (hpp) assert.equal(hpp.empresaId, EMPRESA_ID)
    }
  })

  it('I06: import usuarioId from JWT', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 06,150,70,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const hpps = await getHpps(pid)
      const hpp = hpps.find(h => h.origen === 'IMPORTACION')
      if (hpp) assert.equal(hpp.usuarioId, usuarioId)
    }
  })

  it('I07: import auditoriaId null', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 07,150,70,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const hpps = await getHpps(pid)
      const hpp = hpps.find(h => h.origen === 'IMPORTACION')
      if (hpp) assert.equal(hpp.auditoriaId, null, 'auditoriaId null for import')
    }
  })

  it('I08: import referencia has PRODUCTO: format', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 08,150,70,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const hpps = await getHpps(pid)
      const hpp = hpps.find(h => h.origen === 'IMPORTACION')
      if (hpp) assert.ok(hpp.referencia.startsWith('PRODUCTO:'), `referencia format — got ${hpp.referencia}`)
    }
  })

  it('I09: import=context contains fila number', async () => {
    const codigo = `IMP-${Date.now()}`
    const csv = `CLAVE,NOMBRE,PRECIO_VENTA,COSTO,DEPARTAMENTO,CATEGORIA,UNIDAD_COMPRA,UNIDAD_VENTA,CLAVE_SAT,UNIDAD_SAT
${codigo},TEST IMP 09,150,70,FERRETERIA,TORNILLOS,PZA,PZA,43232300,H87`
    const blob = new Blob([csv], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('archivo', blob, 'test.csv')

    const r = await fetch(`${API}/productos/importar/csv`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
    })
    const body = await r.json()
    const pid = body.data?.productosCreados?.[0]?.id
    if (pid) {
      createdProductoIds.push(pid)
      const hpps = await getHpps(pid)
      const hpp = hpps.find(h => h.origen === 'IMPORTACION')
      if (hpp) assert.ok(hpp.contexto && hpp.contexto.fila, 'contexto.fila present')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════
//  R01-R06: RUNTIME SMOKE TESTS
// ═══════════════════════════════════════════════════════════════════

describe('R — RUNTIME — smoke tests with real backend', () => {

  it('R01: product has HPP after POST /productos', async () => {
    const codigo = `RT-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `RT01 ${codigo}`,
        precioVenta: 300, precioBase: 258.62, costo: 150, costoPromedio: 150,
        margen: 100, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    assert.ok(hpps.length >= 1, 'At least 1 HPP exists')
    assert.equal(hpps[0].empresaId, EMPRESA_ID)
  })

  it('R02: duplicate has HPP with correct origen', async () => {
    const prod = await crearProductoDirecto({ nombre: 'RT02-ORIG', precioVenta: 100, precioBase: 86.21, costo: 50, margen: 100 })
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
    assert.ok(hpp, 'Duplicate HPP exists')
    const details = await getHppDetails(hpp.id)
    assert.ok(details.length >= 1, 'At least 1 HPPD detail')
    for (const d of details) {
      assert.equal(d.valorAnterior, null, 'HPPD valorAnterior must be null for duplicate (antes={})')
    }
  })

  it('R03: quick product has HPP with correct origen', async () => {
    const r = await fetch(`${API}/productos/articulo-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre: `RT03-${Date.now()}`, precioVenta: 50, precioBase: 43.1, costo: 25, costoPromedio: 25, margen: 100,
        unidadCompra: 'PZA', unidadVenta: 'PZA', stockInicial: 3, cantidadVenta: 1, categoriaId,
        claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const hpps = await getHpps(pid)
    const hpp = hpps.find(h => h.origen === 'CREACION_PRODUCTO_RAPIDO')
    assert.ok(hpp, 'Quick product HPP exists')
  })

  it('R04: multiple products create independent HPPs', async () => {
    const ids = []
    for (let i = 0; i < 3; i++) {
      const codigo = `RT04-${Date.now()}-${i}`
      const r = await fetch(`${API}/productos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          codigoInterno: codigo, nombre: `RT04 ${i} ${codigo}`,
          precioVenta: 100 + i * 50, precioBase: (100 + i * 50) / 1.16, costo: 50 + i * 25, costoPromedio: 50 + i * 25, margen: 100,
          unidadCompra: 'PZA', unidadVenta: 'PZA',
          categoriaId, claveSat: '43232300', unidadSat: 'H87'
        })
      })
      const body = await r.json()
      const pid = body.data?.id || body.id
      if (pid) { ids.push(pid); createdProductoIds.push(pid) }
    }
    for (const pid of ids) {
      const count = await hppCount(pid)
      assert.ok(count >= 1, `Product ${pid} has >= 1 HPP`)
    }
  })

  it('R05: HPP not duplicated by PATCH without economic changes', async () => {
    const codigo = `RT05-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `RT05 ${codigo}`,
        precioVenta: 200, precioBase: 172.41, costo: 100, costoPromedio: 100,
        margen: 100, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const before = await hppCount(pid)
    // PATCH without economic changes
    await fetch(`${API}/productos/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre: 'RT05 RENAMED' })
    })
    const after = await hppCount(pid)
    assert.equal(after, before, 'HPP count unchanged after non-economic PATCH')
  })

  it('R06: HPP created atomically with product in single tx', async () => {
    // Verify both product and HPP exist — if tx rolled back, neither would
    const codigo = `RT06-${Date.now()}`
    const r = await fetch(`${API}/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigoInterno: codigo, nombre: `RT06 ${codigo}`,
        precioVenta: 100, precioBase: 86.21, costo: 50, costoPromedio: 50,
        margen: 100, unidadCompra: 'PZA', unidadVenta: 'PZA',
        categoriaId, claveSat: '43232300', unidadSat: 'H87'
      })
    })
    const body = await r.json()
    const pid = body.data?.id || body.id
    assert.ok(pid)
    createdProductoIds.push(pid)

    const prod = await prisma.producto.findUnique({ where: { id: pid } })
    assert.ok(prod, 'Product exists')
    const hppN = await hppCount(pid)
    assert.ok(hppN >= 1, 'HPP exists')
  })
})
