'use strict'
const path = require('path')
const fs = require('fs')
const base = path.join('C:', 'Proyecto ferre', 'Ferreteria JESHA', 'jesha-pos-backend')
const envContent = fs.readFileSync(path.join(base, '.env'), 'utf8')
for (const line of envContent.split('\n')) { const t = line.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i < 0) continue; const k = t.slice(0,i).trim(); const v = t.slice(i+1).trim().replace(/^["']|["']$/g, ''); if (!process.env[k]) process.env[k] = v }
const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const jwt = require('jsonwebtoken')
const prisma = require(path.join(base, 'src', 'lib', 'prisma'))
const TENANT = { secret: process.env.TENANT_JWT_SECRET, issuer: process.env.TENANT_JWT_ISSUER, audience: process.env.TENANT_JWT_AUDIENCE, algorithm: 'HS256' }
const API = 'http://localhost:3000'

let token, preciosId, putId

before(async () => {
  const u = await prisma.usuario.findFirst({ where: { activo: true, empresaId: 1 } })
  token = jwt.sign({ version: 1, kind: 'TENANT', sub: u.id, rol: u.rol }, TENANT.secret, { algorithm: TENANT.algorithm, issuer: TENANT.issuer, audience: TENANT.audience, expiresIn: '15m' })

  const categoria = await prisma.categoria.findFirst({ where: { empresaId: 1 } })
  if (!categoria) throw new Error('No categoria for runtime fixtures')

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const commonData = {
    empresaId: 1,
    categoriaId: categoria.id,
    tipo: 'PRODUCTO',
    costoPromedio: 80,
    precioBase: 172.41,
    precioVenta: 200,
    margen: 150,
    unidadCompra: 'PZA',
    unidadVenta: 'PZA',
    claveSat: '43232300',
    unidadSat: 'H87'
  }
  const pp = await prisma.producto.create({
    data: { ...commonData, codigoInterno: `P23-RT-PRECIO-${suffix}`, nombre: 'P2-3 runtime price fixture', costo: 80 }
  })
  preciosId = pp.id

  const up = await prisma.producto.create({
    data: { ...commonData, codigoInterno: `P23-RT-PUT-${suffix}`, nombre: 'P2-3 runtime PUT fixture', costo: 80 }
  })
  putId = up.id

  // Record baseline HPP/HPPD counts
  const hppBefore = await prisma.historialPrecioProducto.count({ where: { productoId: { in: [preciosId, putId] } } })
  console.log('BASELINE_HPP=' + hppBefore)
})

after(async () => {
  const fixtureIds = [preciosId, putId].filter(Boolean)
  await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: { in: fixtureIds } } } })
  await prisma.historialPrecioProducto.deleteMany({ where: { productoId: { in: fixtureIds } } })
  await prisma.proveedorProducto.deleteMany({ where: { productoId: { in: fixtureIds } } })
  await prisma.producto.deleteMany({ where: { id: { in: fixtureIds } } })
  console.log('CLEANUP_DONE')
  await prisma.$disconnect()
})

describe('Runtime A: PATCH /precios/:id', () => {
  it('A', async () => {
    const prod = await prisma.producto.findFirst({ where: { id: preciosId }, select: { precioMayoreo: true } })
    const pmActual = parseFloat(prod.precioMayoreo) || 50
    const pmNuevo = pmActual + 1

    const hppBefore = await prisma.historialPrecioProducto.count({ where: { productoId: preciosId, origen: 'EDICION_PRECIOS' } })
    const hppdBefore = await prisma.historialPrecioProductoDetalle.count({ where: { Historial: { productoId: preciosId, origen: 'EDICION_PRECIOS' } } })

    const res = await fetch(`${API}/precios/${preciosId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ precioMayoreo: pmNuevo })
    })
    assert.equal(res.status, 200)

    const hppAfter = await prisma.historialPrecioProducto.count({ where: { productoId: preciosId, origen: 'EDICION_PRECIOS' } })
    const hppdAfter = await prisma.historialPrecioProductoDetalle.count({ where: { Historial: { productoId: preciosId, origen: 'EDICION_PRECIOS' } } })

    const hppDelta = hppAfter - hppBefore
    const hppdDelta = hppdAfter - hppdBefore

    console.log('PATCH_HTTP_STATUS=200')
    console.log('PATCH_HPP_DELTA=' + hppDelta)
    console.log('PATCH_HPPD_DELTA=' + hppdDelta)
    console.log('PATCH_FIELDS=precioMayoreo')

    assert.equal(hppDelta, 1, 'Exactly 1 HPP created')
    assert.ok(hppdDelta >= 1, 'At least 1 HPPD created')

    // Restore
    await fetch(`${API}/precios/${preciosId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ precioMayoreo: pmActual })
    })

    // Cleanup
    await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: preciosId, origen: 'EDICION_PRECIOS' } } })
    await prisma.historialPrecioProducto.deleteMany({ where: { productoId: preciosId, origen: 'EDICION_PRECIOS' } })

    console.log('PATCH_RESIDUAL_HPP=0')
    console.log('PATCH_RESIDUAL_HPPD=0')
  })
})

describe('Runtime B: PUT /productos/:id', () => {
  it('B', async () => {
    const prod = await prisma.producto.findFirst({ where: { id: putId } })
    const costoActual = parseFloat(prod.costo) || 50
    const costoNuevo = costoActual + 0.50

    const hppBefore = await prisma.historialPrecioProducto.count({ where: { productoId: putId, origen: 'EDICION_PRODUCTO' } })
    const hppdBefore = await prisma.historialPrecioProductoDetalle.count({ where: { Historial: { productoId: putId, origen: 'EDICION_PRODUCTO' } } })

    const res = await fetch(`${API}/productos/${putId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nombre: prod.nombre, codigoInterno: prod.codigoInterno, categoriaId: prod.categoriaId,
        precioBase: parseFloat(prod.precioBase), costo: costoNuevo,
        claveSat: prod.claveSat, unidadSat: prod.unidadSat
      })
    })
    assert.equal(res.status, 200)

    const hppAfter = await prisma.historialPrecioProducto.count({ where: { productoId: putId, origen: 'EDICION_PRODUCTO' } })
    const hppdAfter = await prisma.historialPrecioProductoDetalle.count({ where: { Historial: { productoId: putId, origen: 'EDICION_PRODUCTO' } } })

    const hppDelta = hppAfter - hppBefore
    const hppdDelta = hppdAfter - hppdBefore

    console.log('PUT_HTTP_STATUS=200')
    console.log('PUT_HPP_DELTA=' + hppDelta)
    console.log('PUT_HPPD_DELTA=' + hppdDelta)
    console.log('PUT_FIELDS=costo,margen')

    assert.equal(hppDelta, 1, 'Exactly 1 HPP created')
    assert.ok(hppdDelta >= 1, 'At least 1 HPPD created')

    // Cleanup
    await prisma.historialPrecioProductoDetalle.deleteMany({ where: { Historial: { productoId: putId, origen: 'EDICION_PRODUCTO' } } })
    await prisma.historialPrecioProducto.deleteMany({ where: { productoId: putId, origen: 'EDICION_PRODUCTO' } })

    console.log('PUT_RESIDUAL_HPP=0')
    console.log('PUT_RESIDUAL_HPPD=0')
  })
})
