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

const {
  registrarHistorialEconomico,
  detectarCambios,
  normalizarDecimal,
  iguales
} = require('../src/helpers/historial-precio-producto')

// ── Unit tests for pure functions ──────────────────────────────

describe('normalizarDecimal', () => {
  it('null → null', () => assert.equal(normalizarDecimal(null), null))
  it('undefined → null', () => assert.equal(normalizarDecimal(undefined), null))
  it('NaN → null', () => assert.equal(normalizarDecimal('abc'), null))
  it('10 → "10.0000"', () => assert.equal(normalizarDecimal(10), '10.0000'))
  it('"10.00" → "10.0000"', () => assert.equal(normalizarDecimal('10.00'), '10.0000'))
  it('"10.0000" → "10.0000"', () => assert.equal(normalizarDecimal('10.0000'), '10.0000'))
  it('0 → "0.0000"', () => assert.equal(normalizarDecimal(0), '0.0000'))
  it('"0" → "0.0000"', () => assert.equal(normalizarDecimal('0'), '0.0000'))
  it('3.14159 → "3.1416" (rounded)', () => assert.equal(normalizarDecimal(3.14159), '3.1416'))
})

describe('iguales', () => {
  it('null === null → true', () => assert.ok(iguales(null, null)))
  it('null vs 0 → false', () => assert.ok(!iguales(null, 0)))
  it('0 vs null → false', () => assert.ok(!iguales(0, null)))
  it('"10.00" vs Decimal("10.0000") equivalent → true', () => {
    assert.ok(iguales('10.00', { toFixed: () => '10.0000' }))
  })
  it('10 vs "10.00" → true', () => assert.ok(iguales(10, '10.00')))
  it('10.0001 vs 10.0000 → false', () => assert.ok(!iguales(10.0001, 10.0000)))
})

describe('detectarCambios', () => {
  const antes = { precioVenta: 100, precioBase: 86.21, margen: 25, costo: 80 }
  const despues = { precioVenta: 110, precioBase: 94.83, margen: 37.5, costo: 80 }

  it('H01: sin cambios → array vacío', () => {
    const cambios = detectarCambios(antes, antes)
    assert.equal(cambios.length, 0)
  })

  it('H02: 1 campo cambia → 1 cambio', () => {
    const cambios = detectarCambios(antes, { ...antes, precioVenta: 110 })
    assert.equal(cambios.length, 1)
    assert.equal(cambios[0].campo, 'precioVenta')
  })

  it('H03: 3 campos cambian → 3 cambios', () => {
    const cambios = detectarCambios(antes, despues)
    assert.equal(cambios.length, 3)
    assert.ok(cambios.find(c => c.campo === 'precioVenta'))
    assert.ok(cambios.find(c => c.campo === 'precioBase'))
    assert.ok(cambios.find(c => c.campo === 'margen'))
  })

  it('H04: null→0 registra cambio', () => {
    const cambios = detectarCambios(
      { precioMayoreo: null },
      { precioMayoreo: 0 }
    )
    assert.equal(cambios.length, 1)
    assert.equal(cambios[0].valorAnterior, null)
    assert.equal(cambios[0].valorNuevo, '0.0000')
  })

  it('H05: 10.00→10.0000 NO registra cambio', () => {
    const cambios = detectarCambios(
      { precioVenta: '10.00' },
      { precioVenta: { toFixed: () => '10.0000' } }
    )
    assert.equal(cambios.length, 0)
  })

  it('H06: campos no permitidos ignorados', () => {
    const cambios = detectarCambios(
      { nombre: 'A', activo: true },
      { nombre: 'B', activo: false },
      ['precioVenta']
    )
    assert.equal(cambios.length, 0)
  })

  it('H07: duplicate campo no puede generarse (mismo valor)', () => {
    const cambios = detectarCambios(
      { precioVenta: 100, precioBase: 100 },
      { precioVenta: 100, precioBase: 100 }
    )
    assert.equal(cambios.length, 0)
  })

  it('H08: Decimal(14,4) conserva precisión', () => {
    const cambios = detectarCambios(
      { precioVenta: { toFixed: () => '100.1234' } },
      { precioVenta: { toFixed: () => '100.1235' } }
    )
    assert.equal(cambios.length, 1)
    assert.equal(cambios[0].valorAnterior, '100.1234')
    assert.equal(cambios[0].valorNuevo, '100.1235')
  })
})

// ── Integration tests with real DB ──────────────────────────────

describe('registrarHistorialEconomico (integration)', () => {
  const base = path.join('C:', 'Proyecto ferre', 'Ferreteria JESHA', 'jesha-pos-backend')
  let prisma
  let empresaId, productoId, usuarioId

  before(async () => {
    prisma = require('../src/lib/prisma')

    // Find or create test fixtures
    const empresa = await prisma.empresa.findFirst({ where: { slug: 'jesha' } })
    if (!empresa) throw new Error('No empresa "jesha" found — cannot run integration tests')
    empresaId = empresa.id

    const producto = await prisma.producto.findFirst({ where: { empresaId, activo: true } })
    if (!producto) throw new Error('No active producto found for empresa')
    productoId = producto.id

    const usuario = await prisma.usuario.findFirst({ where: { empresaId, activo: true } })
    if (!usuario) throw new Error('No active usuario found')
    usuarioId = usuario.id
  })

  after(async () => {
    // Cleanup: remove test HPP records for our test producto
    await prisma.historialPrecioProductoDetalle.deleteMany({
      where: { Historial: { productoId } }
    })
    await prisma.historialPrecioProducto.deleteMany({
      where: { productoId, origen: 'TEST_HELPER' }
    })
    await prisma.$disconnect()
  })

  it('H09: no crea evento cuando no hay cambios', async () => {
    const antes = { precioVenta: 100, precioBase: 86.21 }
    const resultado = await prisma.$transaction(async (tx) => {
      return registrarHistorialEconomico(tx, {
        empresaId, productoId, usuarioId,
        origen: 'TEST_HELPER', accion: 'TEST',
        antes, despues: antes
      })
    })
    assert.equal(resultado.created, false)
    assert.equal(resultado.header, null)
    assert.equal(resultado.details.length, 0)
  })

  it('H10: crea 1 cabecera + 2 detalles para 2 campos cambiados', async () => {
    const antes = { precioVenta: 100, precioBase: 86.21, margen: 25 }
    const despues = { precioVenta: 120, precioBase: 103.45, margen: 50 }
    const resultado = await prisma.$transaction(async (tx) => {
      return registrarHistorialEconomico(tx, {
        empresaId, productoId, usuarioId,
        origen: 'TEST_HELPER', accion: 'TEST',
        antes, despues,
        notas: 'test integration'
      })
    })
    assert.equal(resultado.created, true)
    assert.ok(resultado.header.id > 0)
    assert.equal(resultado.header.empresaId, empresaId)
    assert.equal(resultado.header.productoId, productoId)
    assert.equal(resultado.header.origen, 'TEST_HELPER')
    assert.equal(resultado.header.accion, 'TEST')
    assert.equal(resultado.header.notas, 'test integration')
    assert.equal(resultado.details.length, 3)

    const campos = resultado.details.map(d => d.campo).sort()
    assert.deepEqual(campos, ['margen', 'precioBase', 'precioVenta'])
  })

  it('H11: null vs null no registra cambio', async () => {
    const antes = { precioMayoreo: null, costoSinIvaProveedor: null }
    const resultado = await prisma.$transaction(async (tx) => {
      return registrarHistorialEconomico(tx, {
        empresaId, productoId, usuarioId,
        origen: 'TEST_HELPER', accion: 'TEST_NULL',
        antes, despues: { ...antes }
      })
    })
    assert.equal(resultado.created, false)
  })

  it('H12: precioCosto detectado como campo permitido', async () => {
    const antes = { precioCosto: 50 }
    const despues = { precioCosto: 55 }
    const resultado = await prisma.$transaction(async (tx) => {
      return registrarHistorialEconomico(tx, {
        empresaId, productoId, usuarioId,
        origen: 'TEST_HELPER', accion: 'TEST_PRECIOCOSTO',
        antes, despues
      })
    })
    assert.equal(resultado.created, true)
    assert.equal(resultado.details.length, 1)
    assert.equal(resultado.details[0].campo, 'precioCosto')
  })
})
