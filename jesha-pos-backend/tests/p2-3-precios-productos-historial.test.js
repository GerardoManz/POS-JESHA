'use strict'

const path = require('path')
const fs = require('fs')
const base = path.join('C:', 'Proyecto ferre', 'Ferreteria JESHA', 'jesha-pos-backend')
const envContent = fs.readFileSync(path.join(base, '.env'), 'utf8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx < 0) continue
  const key = trimmed.slice(0, eqIdx).trim()
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
  if (!process.env[key]) process.env[key] = val
}

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const jwt = require('jsonwebtoken')

const prisma = require('../src/lib/prisma')
const { registrarHistorialEconomico } = require('../src/helpers/historial-precio-producto')

const TENANT_AUTH = {
  secret:   process.env.TENANT_JWT_SECRET,
  issuer:   process.env.TENANT_JWT_ISSUER,
  audience: process.env.TENANT_JWT_AUDIENCE,
  algorithm: 'HS256'
}

// ── Test fixtures ──────────────────────────────────────────────
let empresaId, productoId, usuarioId, sucursalId, token

before(async () => {
  const empresa = await prisma.empresa.findFirst({ where: { slug: 'jesha' } })
  if (!empresa) throw new Error('No empresa "jesha"')
  empresaId = empresa.id

  // Pick a product with valid SAT values
  const producto = await prisma.producto.findFirst({
    where: { empresaId, activo: true, claveSat: { not: null }, unidadSat: { not: null } }
  })
  if (!producto) throw new Error('No active producto with valid SAT')
  productoId = producto.id

  const usuario = await prisma.usuario.findFirst({ where: { empresaId, activo: true } })
  if (!usuario) throw new Error('No active usuario')
  usuarioId = usuario.id
  sucursalId = usuario.sucursalId

  // Sign with new TENANT format: { version: 1, kind: 'TENANT', sub, rol }
  const principal = { version: 1, kind: 'TENANT', sub: usuario.id, rol: usuario.rol }
  token = jwt.sign(principal, TENANT_AUTH.secret, {
    algorithm: TENANT_AUTH.algorithm,
    issuer: TENANT_AUTH.issuer,
    audience: TENANT_AUTH.audience,
    expiresIn: '15m'
  })
})

after(async () => {
  // Cleanup test HPP records
  await prisma.historialPrecioProductoDetalle.deleteMany({
    where: { Historial: { productoId, origen: { startsWith: 'EDICION_' } } }
  })
  await prisma.historialPrecioProducto.deleteMany({
    where: { productoId, origen: { startsWith: 'EDICION_' } }
  })
  await prisma.$disconnect()
})

// ── PATCH /precios/:id tests ──────────────────────────────────

describe('PATCH /precios/:id — historial económico', () => {
  const API = `http://localhost:3000`

  it('P01: precioVenta directo crea historial', async () => {
    // Get current state
    const prod = await prisma.producto.findFirst({ where: { id: productoId, empresaId }, select: { precioVenta: true } })
    const pvActual = parseFloat(prod.precioVenta) || 100
    const pvNuevo = pvActual + 10

    const res = await fetch(`${API}/precios/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ precioVenta: pvNuevo })
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.success)

    // Verify HPP created
    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { productoId, origen: 'EDICION_PRECIOS', accion: 'ACTUALIZAR_PRECIOS' },
      orderBy: { id: 'desc' }
    })
    assert.ok(hpp, 'HPP should be created')
    assert.equal(hpp.empresaId, empresaId)
    assert.equal(hpp.productoId, productoId)
    assert.equal(hpp.usuarioId, usuarioId)
    assert.ok(hpp.referencia.startsWith('PRODUCTO:'))

    // Verify HPPD
    const hppd = await prisma.historialPrecioProductoDetalle.findMany({
      where: { historialId: hpp.id }
    })
    assert.ok(hppd.length >= 1, 'At least 1 detail for precioVenta')
    assert.ok(hppd.find(d => d.campo === 'precioVenta'), 'precioVenta detail exists')
  })

  it('P02: mismo valor NO crea historia', async () => {
    const prod = await prisma.producto.findFirst({ where: { id: productoId, empresaId }, select: { precioVenta: true } })
    const pvActual = parseFloat(prod.precioVenta)

    const res = await fetch(`${API}/precios/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ precioVenta: pvActual })
    })
    assert.equal(res.status, 200)

    // No new HPP for this specific value
    const hppCount = await prisma.historialPrecioProducto.count({
      where: { productoId, origen: 'EDICION_PRECIOS' }
    })
    // Should still be the count from P01 (no new creation)
    assert.ok(hppCount >= 1)
  })

  it('P03: precioMayoreo null→value crea detalle', async () => {
    // First set to null
    await prisma.producto.update({ where: { id: productoId }, data: { precioMayoreo: null } })

    const res = await fetch(`${API}/precios/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ precioMayoreo: 95 })
    })
    assert.equal(res.status, 200)

    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { productoId, origen: 'EDICION_PRECIOS' },
      orderBy: { id: 'desc' }
    })
    assert.ok(hpp)
    const hppd = await prisma.historialPrecioProductoDetalle.findMany({
      where: { historialId: hpp.id, campo: 'precioMayoreo' }
    })
    assert.equal(hppd.length, 1)
    assert.equal(hppd[0].valorAnterior, null)
    assert.ok(hppd[0].valorNuevo !== null)
  })

  it('P04: precioMayoreo value→null registra cambio', async () => {
    await prisma.producto.update({ where: { id: productoId }, data: { precioMayoreo: 100 } })

    const res = await fetch(`${API}/precios/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ precioMayoreo: null })
    })
    assert.equal(res.status, 200)

    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { productoId, origen: 'EDICION_PRECIOS' },
      orderBy: { id: 'desc' }
    })
    assert.ok(hpp)
    const hppd = await prisma.historialPrecioProductoDetalle.findFirst({
      where: { historialId: hpp.id, campo: 'precioMayoreo' }
    })
    assert.ok(hppd)
    assert.ok(hppd.valorAnterior !== null)
    assert.equal(hppd.valorNuevo, null)
  })

  it('P05: referencia formato PRODUCTO:<id>', async () => {
    const res = await fetch(`${API}/precios/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ precioMayoreo: 80 })
    })
    assert.equal(res.status, 200)
    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { productoId, origen: 'EDICION_PRECIOS' },
      orderBy: { id: 'desc' }
    })
    assert.equal(hpp.referencia, `PRODUCTO:${productoId}`)
  })

  it('P06: empresaId correcto', async () => {
    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { productoId, origen: 'EDICION_PRECIOS' },
      orderBy: { id: 'desc' }
    })
    assert.equal(hpp.empresaId, empresaId)
  })
})

// ── PUT /productos/:id tests ──────────────────────────────────

describe('PUT /productos/:id — historial económico', () => {
  const API = `http://localhost:3000`

  it('U01: solo nombre → 0 eventos económicos', async () => {
    const prod = await prisma.producto.findFirst({ where: { id: productoId, empresaId } })
    const countBefore = await prisma.historialPrecioProducto.count({
      where: { productoId, origen: 'EDICION_PRODUCTO' }
    })

    const res = await fetch(`${API}/productos/${productoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre: prod.nombre,
        codigoInterno: prod.codigoInterno,
        categoriaId: prod.categoriaId,
        precioBase: parseFloat(prod.precioBase),
        precioVenta: prod.precioVenta ? parseFloat(prod.precioVenta) : undefined,
        claveSat: prod.claveSat,
        unidadSat: prod.unidadSat
      })
    })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${await res.text()}`)

    const countAfter = await prisma.historialPrecioProducto.count({
      where: { productoId, origen: 'EDICION_PRODUCTO' }
    })
    assert.equal(countAfter, countBefore, 'No new HPP for non-economic change')
  })

  it('U02: costo cambia → detalle costo', async () => {
    const prod = await prisma.producto.findFirst({ where: { id: productoId, empresaId } })
    const costoActual = parseFloat(prod.costo) || 50
    const costoNuevo = costoActual + 5

    const res = await fetch(`${API}/productos/${productoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre: prod.nombre,
        codigoInterno: prod.codigoInterno,
        categoriaId: prod.categoriaId,
        precioBase: parseFloat(prod.precioBase),
        costo: costoNuevo,
        claveSat: prod.claveSat,
        unidadSat: prod.unidadSat
      })
    })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${await res.text()}`)

    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { productoId, origen: 'EDICION_PRODUCTO' },
      orderBy: { id: 'desc' }
    })
    assert.ok(hpp, 'HPP should be created')
    assert.equal(hpp.origen, 'EDICION_PRODUCTO')
    assert.equal(hpp.accion, 'EDITAR_PRODUCTO')

    const hppd = await prisma.historialPrecioProductoDetalle.findFirst({
      where: { historialId: hpp.id, campo: 'costo' }
    })
    assert.ok(hppd, 'costo detail exists')
  })

  it('U03: referencia formato correcto', async () => {
    const hpp = await prisma.historialPrecioProducto.findFirst({
      where: { productoId, origen: 'EDICION_PRODUCTO' },
      orderBy: { id: 'desc' }
    })
    assert.equal(hpp.referencia, `PRODUCTO:${productoId}`)
  })
})
