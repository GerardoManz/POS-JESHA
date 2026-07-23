const test = require('node:test')
const assert = require('node:assert/strict')

const {
    construirDataEdicion,
    crear,
    editar,
    listar,
    obtener,
    cambiarEstado,
    duplicarProducto
} = require('../src/modules/productos/productos.controller')

const {
    normalizarUnidadVenta,
    esUnidadVentaValida,
    UNIDADES_VENTA
} = require('../src/helpers/unidades.helper')

function existenteFisico(overrides = {}) {
    return {
        id: 1,
        nombre: 'Tornillo 1/2',
        codigoInterno: 'TOR-001',
        codigoBarras: '7501234567890',
        descripcion: 'Tornillo de media pulgada',
        costo: 10,
        precioBase: 30,
        precioVenta: 50,
        categoriaId: 1,
        unidadVenta: 'PZA',
        unidadCompra: 'PZA',
        factorConversion: 1,
        esGranel: false,
        tipoFacturaProv: null,
        costoSinIvaProveedor: null,
        claveSat: '12345678',
        unidadSat: 'H87',
        tipo: 'PRODUCTO',
        empresaId: 1,
        margen: 400,
        ...overrides
    }
}

function existenteServicio(overrides = {}) {
    return existenteFisico({ tipo: 'SERVICIO', ...overrides })
}

function bodyMinimo(overrides = {}) {
    return {
        nombre: 'Tornillo 1/2',
        codigoInterno: 'TOR-001',
        categoriaId: 1,
        precioBase: 30,
        ...overrides
    }
}

// ── factorConversion ─────────────────────────────────────────────────

test('C6-1: factorConversion entero válido → data.factorConversion = 3', () => {
    const body = bodyMinimo({ factorConversion: 3 })
    const existente = existenteFisico({ factorConversion: 1 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.factorConversion, 3)
})

test('C6-2: factorConversion string "0" → error 400', () => {
    const body = bodyMinimo({ factorConversion: '0' })
    const existente = existenteFisico({ factorConversion: 1 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
    assert.ok(result.error.body.error.includes('factorConversion'))
})

test('C6-11: factorConversion = Infinity → error 400', () => {
    const body = bodyMinimo({ factorConversion: Infinity })
    const existente = existenteFisico({ factorConversion: 1 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
    assert.ok(result.error.body.error.includes('factorConversion'))
})

test('factorConversion omitido → existente.factorConversion preservado', () => {
    const body = bodyMinimo()
    const existente = existenteFisico({ factorConversion: 7 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.factorConversion, undefined)
})

test('factorConversion = null para físico → data.factorConversion = null', () => {
    const body = bodyMinimo({ factorConversion: null })
    const existente = existenteFisico({ factorConversion: 1 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.factorConversion, null)
})

test('factorConversion = "" para físico → data.factorConversion = null', () => {
    const body = bodyMinimo({ factorConversion: '' })
    const existente = existenteFisico({ factorConversion: 1 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.factorConversion, null)
})

test('factorConversion negativo → error 400', () => {
    const body = bodyMinimo({ factorConversion: -3 })
    const existente = existenteFisico({ factorConversion: 1 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
})

test('factorConversion = "abc" → error 400', () => {
    const body = bodyMinimo({ factorConversion: 'abc' })
    const existente = existenteFisico({ factorConversion: 1 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
})

test('factorConversion para SERVICIO → siempre null aunque sea válido', () => {
    const body = bodyMinimo({ factorConversion: 5 })
    const existente = existenteServicio({ factorConversion: null })
    const result = construirDataEdicion(body, existente, true, '78101800', 'E48')
    assert.equal(result.error, undefined)
    assert.equal(result.data.factorConversion, null)
})

// ── costoSinIvaProveedor ─────────────────────────────────────────────

test('C6-3: costoSinIvaProveedor = 0 → data.costoSinIvaProveedor = 0', () => {
    const body = bodyMinimo({ costoSinIvaProveedor: 0 })
    const existente = existenteFisico({ costoSinIvaProveedor: null })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.costoSinIvaProveedor, 0)
})

test('C6-4: costoSinIvaProveedor = -5 → error 400', () => {
    const body = bodyMinimo({ costoSinIvaProveedor: -5 })
    const existente = existenteFisico({ costoSinIvaProveedor: null })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
    assert.ok(result.error.body.error.includes('negativo'))
})

test('C6-12: costoSinIvaProveedor = "abc" → error 400', () => {
    const body = bodyMinimo({ costoSinIvaProveedor: 'abc' })
    const existente = existenteFisico({ costoSinIvaProveedor: null })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
})

test('costoSinIvaProveedor = "" → data.costoSinIvaProveedor = null', () => {
    const body = bodyMinimo({ costoSinIvaProveedor: '' })
    const existente = existenteFisico({ costoSinIvaProveedor: 50 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.costoSinIvaProveedor, null)
})

test('costoSinIvaProveedor omitido → existente preservado', () => {
    const body = bodyMinimo()
    const existente = existenteFisico({ costoSinIvaProveedor: 50 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.costoSinIvaProveedor, undefined)
})

test('costoSinIvaProveedor = 50 → data.costoSinIvaProveedor = 50', () => {
    const body = bodyMinimo({ costoSinIvaProveedor: 50 })
    const existente = existenteFisico({ costoSinIvaProveedor: null })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.costoSinIvaProveedor, 50)
})

test('costoSinIvaProveedor = 0.01 → data.costoSinIvaProveedor = 0.01', () => {
    const body = bodyMinimo({ costoSinIvaProveedor: 0.01 })
    const existente = existenteFisico({ costoSinIvaProveedor: null })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.costoSinIvaProveedor, 0.01)
})

// ── unidadVenta ──────────────────────────────────────────────────────

test('C6-5: PRODUCTO físico, unidadVenta = null → error 400', () => {
    const body = bodyMinimo({ unidadVenta: null })
    const existente = existenteFisico({ unidadVenta: 'PZA' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
    assert.ok(result.error.body.error.includes('unidadVenta'))
})

test('PRODUCTO físico, unidadVenta = "" → error 400', () => {
    const body = bodyMinimo({ unidadVenta: '' })
    const existente = existenteFisico({ unidadVenta: 'PZA' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
    assert.ok(result.error.body.error.includes('unidadVenta'))
})

test('PRODUCTO físico, unidadVenta inválida → error 400', () => {
    const body = bodyMinimo({ unidadVenta: 'INVENTADA' })
    const existente = existenteFisico({ unidadVenta: 'PZA' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
})

test('C6-6: SERVICIO, unidadVenta = null → data.unidadVenta = null', () => {
    const body = bodyMinimo({ unidadVenta: null })
    const existente = existenteServicio({ unidadVenta: 'E48' })
    const result = construirDataEdicion(body, existente, true, '78101800', 'E48')
    assert.equal(result.error, undefined)
    assert.equal(result.data.unidadVenta, null)
})

test('SERVICIO, unidadVenta omitida → existente preservado', () => {
    const body = bodyMinimo()
    const existente = existenteServicio({ unidadVenta: 'E48' })
    const result = construirDataEdicion(body, existente, true, '78101800', 'E48')
    assert.equal(result.error, undefined)
    assert.equal(result.data.unidadVenta, undefined)
})

test('SERVICIO, unidadVenta = "PZA" (física) → tolera, normaliza o raw', () => {
    const body = bodyMinimo({ unidadVenta: 'PZA' })
    const existente = existenteServicio({ unidadVenta: 'E48' })
    const result = construirDataEdicion(body, existente, true, '78101800', 'E48')
    assert.equal(result.error, undefined)
    assert.ok(result.data.unidadVenta === 'PZA')
})

// ── unidadCompra ─────────────────────────────────────────────────────

test('PRODUCTO físico, unidadCompra = "" → error 400', () => {
    const body = bodyMinimo({ unidadCompra: '' })
    const existente = existenteFisico({ unidadCompra: 'PZA' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
})

test('PRODUCTO físico, unidadCompra = null → data.unidadCompra = null', () => {
    const body = bodyMinimo({ unidadCompra: null })
    const existente = existenteFisico({ unidadCompra: 'PZA' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.unidadCompra, null)
})

test('unidadCompra inválida → error 400', () => {
    const body = bodyMinimo({ unidadCompra: 'NO_EXISTE' })
    const existente = existenteFisico({ unidadCompra: 'PZA' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.notEqual(result.error, undefined)
    assert.equal(result.error.status, 400)
})

// ── esGranel ─────────────────────────────────────────────────────────

test('C6-9: esGranel = true en PRODUCTO → data.esGranel = true', () => {
    const body = bodyMinimo({ esGranel: true })
    const existente = existenteFisico({ esGranel: false })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.esGranel, true)
})

test('C6-10: esGranel = true en SERVICIO → data.esGranel = false (forzado)', () => {
    const body = bodyMinimo({ esGranel: true })
    const existente = existenteServicio({ esGranel: false })
    const result = construirDataEdicion(body, existente, true, '78101800', 'E48')
    assert.equal(result.error, undefined)
    assert.equal(result.data.esGranel, false)
})

test('esGranel omitido → existente preservado', () => {
    const body = bodyMinimo()
    const existente = existenteFisico({ esGranel: false })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.esGranel, undefined)
})

// ── Actualización parcial ────────────────────────────────────────────

test('C6-7: Datos mínimos (solo requeridos) → success con data completa', () => {
    const body = bodyMinimo()
    const existente = existenteFisico()
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.nombre, 'Tornillo 1/2')
    assert.equal(result.data.precioBase, 30)
})

test('C6-8: Campos omitidos no están en data (preservan existente)', () => {
    const body = bodyMinimo()
    const existente = existenteFisico({
        descripcion: 'vieja desc',
        precioVenta: 99,
        costo: 20,
        factorConversion: 1,
        esGranel: false,
        tipoFacturaProv: 'FACTURA'
    })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.descripcion, undefined)
    assert.equal(result.data.precioVenta, undefined)
    assert.equal(result.data.costo, undefined)
    assert.equal(result.data.factorConversion, undefined)
    assert.equal(result.data.esGranel, undefined)
    assert.equal(result.data.tipoFacturaProv, undefined)
})

test('Actualización parcial: solo descripcion → data.descripcion = "nueva"', () => {
    const body = bodyMinimo({ descripcion: 'nueva descripción' })
    const existente = existenteFisico({ descripcion: 'vieja' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.descripcion, 'nueva descripción')
})

test('Actualización parcial: solo descripcion (null) → data.descripcion = null', () => {
    const body = bodyMinimo({ descripcion: '' })
    const existente = existenteFisico({ descripcion: 'vieja' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.descripcion, null)
})

test('Actualización parcial: solo precioVenta = null → data.precioVenta = null', () => {
    const body = bodyMinimo({ precioVenta: null })
    const existente = existenteFisico({ precioVenta: 50 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.precioVenta, null)
})

test('Actualización parcial: solo codigoBarras → data.codigoBarras = "NEW"', () => {
    const body = bodyMinimo({ codigoBarras: 'NEW123' })
    const existente = existenteFisico({ codigoBarras: 'OLD' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.codigoBarras, 'NEW123')
})

// ── precioVenta + margen ─────────────────────────────────────────────

test('precioVenta presente + costo presente → margen recalculado', () => {
    const body = bodyMinimo({ precioVenta: 60, costo: 20 })
    const existente = existenteFisico({ costo: 10, precioVenta: 50, margen: 400 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.precioVenta, 60)
    assert.equal(result.data.costo, 20)
    assert.equal(result.data.margen, 200)
})

test('precioVenta presente + costo 0 → margen = null', () => {
    const body = bodyMinimo({ precioVenta: 60, costo: 0 })
    const existente = existenteFisico({ costo: 10, precioVenta: 50, margen: 400 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.margen, null)
})

// ── costo con factorConversion ───────────────────────────────────────

test('costo = 100, factorConversion = 2 → data.costo = 50 (unitario)', () => {
    const body = bodyMinimo({ costo: 100, factorConversion: 2 })
    const existente = existenteFisico({ costo: 10, factorConversion: 1 })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.costo, 50)
    assert.equal(result.data.factorConversion, 2)
})

// ── tipoFacturaProv ──────────────────────────────────────────────────

test('tipoFacturaProv = "FACTURA" → data.tipoFacturaProv = "FACTURA"', () => {
    const body = bodyMinimo({ tipoFacturaProv: 'FACTURA' })
    const existente = existenteFisico({ tipoFacturaProv: null })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.tipoFacturaProv, 'FACTURA')
})

test('tipoFacturaProv = "" → data.tipoFacturaProv = null', () => {
    const body = bodyMinimo({ tipoFacturaProv: '' })
    const existente = existenteFisico({ tipoFacturaProv: 'FACTURA' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.tipoFacturaProv, null)
})

// ── codigoBarras ─────────────────────────────────────────────────────

test('codigoBarras = "NEW" → data.codigoBarras = "NEW"', () => {
    const body = bodyMinimo({ codigoBarras: 'NEW' })
    const existente = existenteFisico({ codigoBarras: 'OLD' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.codigoBarras, 'NEW')
})

test('codigoBarras = null → data.codigoBarras = null', () => {
    const body = bodyMinimo({ codigoBarras: null })
    const existente = existenteFisico({ codigoBarras: '7501234567890' })
    const result = construirDataEdicion(body, existente, false, '12345678', 'H87')
    assert.equal(result.error, undefined)
    assert.equal(result.data.codigoBarras, null)
})

// ── Export functions are accessible ──────────────────────────────────

test('Las funciones de export existen', () => {
    assert.equal(typeof construirDataEdicion, 'function')
    assert.equal(typeof editar, 'function')
    assert.equal(typeof crear, 'function')
    assert.equal(typeof listar, 'function')
    assert.equal(typeof obtener, 'function')
    assert.equal(typeof cambiarEstado, 'function')
})
