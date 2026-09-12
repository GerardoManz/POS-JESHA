'use strict'

process.env.TENANT_JWT_SECRET = process.env.TENANT_JWT_SECRET || 'prod-scope-test-tenant-secret-'.padEnd(64, 't')
process.env.TENANT_JWT_ISSUER = process.env.TENANT_JWT_ISSUER || 'prod-scope-test-issuer'
process.env.TENANT_JWT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE || 'prod-scope-test-audience'
process.env.TENANT_JWT_TTL = process.env.TENANT_JWT_TTL || '15m'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test'
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it, before } = require('node:test')
const ExcelJS = require('exceljs')

const SRC = path.resolve(__dirname, '..', 'src')

function readSource(relativePath) {
  return fs.readFileSync(path.join(SRC, relativePath), 'utf-8')
}

function findRoute(stack, method, pathPat) {
  return stack.find(l => {
    if (!l.route) return false
    return l.route.methods[method] && l.regexp.test(pathPat)
  })
}

function routeHasHandlerName(layer, name) {
  if (!layer.route || !layer.route.stack) return false
  return layer.route.stack.some(s => s.handle && s.handle.name === name)
}

function routeHandlers(layer) {
  if (!layer.route || !layer.route.stack) return []
  return layer.route.stack.map(s => ({ method: s.method, handle: s.handle }))
}

function hasPattern(text, regex) {
  return regex.test(text)
}

function countPatterns(text, regex) {
  const matches = text.match(regex)
  return matches ? matches.length : 0
}

// ── Fixture: 125 productos con datos realistas ──
function crearFixture(count = 125) {
  const productos = []
  for (let i = 0; i < count; i++) {
    const esGranel = i % 10 === 0
    const esServicio = i % 25 === 0
    productos.push({
      id: i + 1,
      codigoInterno: `PROD-${String(i + 1).padStart(4, '0')}`,
      codigoBarras: i % 7 === 0 ? null : `001234567890${String(i + 1).padStart(3, '0')}`,
      nombre: `Producto ${i + 1} ${['PVC', 'CLAVO', 'TUBO', 'CABLE', 'FERRETERIA'][i % 5]}`,
      tipo: esServicio ? 'SERVICIO' : 'PRODUCTO',
      unidadVenta: esGranel ? 'KG' : 'PZA',
      unidadCompra: esGranel ? 'KG' : 'CJA',
      factorConversion: esGranel ? 25.5 : null,
      precioBase: 10 + (i * 0.5),
      precioVenta: 15 + (i * 0.75),
      costo: 8 + (i * 0.3),
      activo: i % 20 !== 0,
      Categoria: {
        nombre: `Cat ${i % 8}`,
        Departamento: { nombre: `Depto ${i % 4}` }
      },
      InventarioSucursal: [{
        stockActual: i * 2,
        stockMinimoAlerta: i,
        stockMaximo: i * 5,
        sucursalId: 1
      }]
    })
  }
  return productos
}

// ── Helper: leer XLSX desde buffer ──
async function leerXlsxDeBuffer(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return wb
}

describe('P2-2 — Productos Export Excel', () => {

  describe('RUTAS — Route structure', () => {
    let router, src
    before(() => {
      router = require('../src/modules/productos/productos.routes')
      src = readSource('modules/productos/productos.routes.js')
    })

    it('T01. GET /exportar/excel existe antes de /:id', () => {
      const idxExport = src.indexOf("router.get('/exportar/excel'")
      const idxId = src.indexOf("router.get('/:id'")
      assert.ok(idxExport >= 0, '/exportar/excel route must exist in source')
      assert.ok(idxId >= 0, '/:id route must exist')
      assert.ok(idxExport < idxId, 'GET /exportar/excel must be declared before GET /:id')
    })

    it('T02. GET /exportar/excel usa branchOptional', () => {
      const exportRoute = findRoute(router.stack, 'get', '/exportar/excel')
      assert.ok(exportRoute, 'GET /exportar/excel route must be found in router')
      assert.ok(routeHasHandlerName(exportRoute, 'branchOptional'),
        'GET /exportar/excel must use branchOptional middleware')
    })

    it('T03. GET /exportar/excel usa requireRole para SUPERADMIN y ADMIN_SUCURSAL', () => {
      // requireRole is curried — handler name won't be "requireRole" in route stack.
      // Verify via source text that the route declaration includes the correct role guards.
      assert.ok(hasPattern(src, /router\.get\('\/exportar\/excel'[\s\S]*?requireRole\('SUPERADMIN',\s*'ADMIN_SUCURSAL'\)/),
        'GET /exportar/excel must use requireRole(SUPERADMIN, ADMIN_SUCURSAL)')
    })

    it('T04. /exportar/excel NO tiene requireAuth directo (viene de app.js)', () => {
      const exportRoute = findRoute(router.stack, 'get', '/exportar/excel')
      assert.ok(exportRoute, 'GET /exportar/excel route must exist')
      const handlers = routeHandlers(exportRoute).map(h => h.handle.name)
      assert.ok(!handlers.includes('requireAuth'),
        'requireAuth must NOT be in individual routes (comes from app.js mount)')
    })

    it('T05. GET /exportar/excel usa handler exportarExcel', () => {
      const exportRoute = findRoute(router.stack, 'get', '/exportar/excel')
      assert.ok(exportRoute, 'GET /exportar/excel route must exist')
      const handlers = routeHandlers(exportRoute)
      const exportHandler = handlers.find(h => h.handle && h.handle.name === 'exportarExcel')
      assert.ok(exportHandler, 'GET /exportar/excel must use exportarExcel handler')
    })
  })

  describe('HELPER — construirWorkbookProductos', () => {
    const { construirWorkbookProductos } = require('../src/modules/productos/productos.export.helper')
    const productos = crearFixture(125)

    it('T06. Workbook tiene hoja "Productos"', async () => {
      const wb = construirWorkbookProductos(productos)
      assert.ok(wb, 'Workbook must be returned')
      const ws = wb.getWorksheet('Productos')
      assert.ok(ws, 'Worksheet "Productos" must exist')
    })

    it('T07. Encabezados correctos (14 columnas)', async () => {
      const wb = construirWorkbookProductos(productos)
      const ws = wb.getWorksheet('Productos')
      const headers = []
      const headerRow = ws.getRow(1)
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        headers.push(cell.value)
      })
      assert.deepStrictEqual(headers, [
        'Código', 'Código de barras', 'Nombre', 'Departamento', 'Categoría',
        'Tipo', 'Unidad venta', 'Unidad compra', 'Factor',
        'Precio venta', 'Costo', 'Stock', 'Stock mínimo', 'Activo'
      ])
    })

    it('T08. 125 filas de datos + 1 encabezado = 126 total', async () => {
      const wb = construirWorkbookProductos(productos)
      const ws = wb.getWorksheet('Productos')
      assert.strictEqual(ws.rowCount, 126, 'Must have 126 rows (header + 125 products)')
    })

    it('T09. Código interno escrito como texto (preserva ceros)', async () => {
      const wb = construirWorkbookProductos(productos)
      const ws = wb.getWorksheet('Productos')
      const firstDataCell = ws.getRow(2).getCell(1)
      assert.strictEqual(typeof firstDataCell.value, 'string', 'Código must be string')
      assert.strictEqual(firstDataCell.value, 'PROD-0001', 'Código must preserve leading zeros')
      assert.strictEqual(firstDataCell.numFmt, '@', 'Código column must use text format')
    })

    it('T10. Código de barras: null → celda vacía, largo conservado', () => {
      const prodConNull = [productos[0]] // i=0 → i%7===0 → null barcode
      const wb = construirWorkbookProductos(prodConNull)
      const ws = wb.getWorksheet('Productos')
      const cell = ws.getRow(2).getCell(2)
      assert.strictEqual(cell.value, '', 'null barcode must become empty string')
      assert.strictEqual(cell.numFmt, '@', 'Barcode column must use text format')
    })

    it('T11. Código de barras largo sin notación científica', async () => {
      const prodLargo = [{
        ...productos[0],
        codigoBarras: '00123456789012345678'
      }]
      const wb = construirWorkbookProductos(prodLargo)
      const ws = wb.getWorksheet('Productos')
      const cell = ws.getRow(2).getCell(2)
      assert.strictEqual(cell.value, '00123456789012345678', 'Long barcode must be preserved as string')
    })

    it('T12. Strings tipo fórmula (=SUMA) se escriben como texto, no fórmula', async () => {
      const prodFormula = [{
        ...productos[0],
        codigoInterno: '=SUMA(A1:A10)',
        nombre: '+INCREMENTO'
      }]
      const wb = construirWorkbookProductos(prodFormula)
      const ws = wb.getWorksheet('Productos')
      const codigoCell = ws.getRow(2).getCell(1)
      const nombreCell = ws.getRow(2).getCell(3)
      assert.strictEqual(codigoCell.value, '=SUMA(A1:A10)', 'Formula-like code must be text')
      assert.strictEqual(typeof codigoCell.value, 'string', 'Formula-like code must be string type')
      assert.strictEqual(nombreCell.value, '+INCREMENTO', 'Plus-prefixed name must be text')
    })

    it('T13. Stock calculado correctamente (consolidado sin sucursal)', async () => {
      const prod = [{
        ...productos[0],
        InventarioSucursal: [
          { stockActual: 10, stockMinimoAlerta: 5, sucursalId: 1 },
          { stockActual: 20, stockMinimoAlerta: 8, sucursalId: 2 }
        ]
      }]
      const wb = construirWorkbookProductos(prod)
      const ws = wb.getWorksheet('Productos')
      const stockCell = ws.getRow(2).getCell(12)
      assert.strictEqual(stockCell.value, 30, 'Consolidated stock must sum across branches')
    })

    it('T14. Stock con sucursal filtrada', async () => {
      // When sucursalIdInventario is set, the controller's Prisma query already filters
      // InventarioSucursal by that branch. The helper receives pre-filtered data.
      const prod = [{
        ...productos[0],
        InventarioSucursal: [
          { stockActual: 20, stockMinimoAlerta: 8, sucursalId: 2 }
        ]
      }]
      const wb = construirWorkbookProductos(prod, { sucursalIdInventario: 2 })
      const ws = wb.getWorksheet('Productos')
      const stockCell = ws.getRow(2).getCell(12)
      assert.strictEqual(stockCell.value, 20, 'Branch-filtered stock must show only that branch')
    })

    it('T15. Activo true → "Sí", false → "No"', async () => {
      const prods = [
        { ...productos[0], activo: true, InventarioSucursal: [] },
        { ...productos[1], activo: false, InventarioSucursal: [] }
      ]
      const wb = construirWorkbookProductos(prods)
      const ws = wb.getWorksheet('Productos')
      assert.strictEqual(ws.getRow(2).getCell(14).value, 'Sí')
      assert.strictEqual(ws.getRow(3).getCell(14).value, 'No')
    })

    it('T16. Precio venta usa precioVenta o fallback a precioBase', async () => {
      const prods = [
        { ...productos[0], precioVenta: 25.5, precioBase: 15, InventarioSucursal: [] },
        { ...productos[1], precioVenta: null, precioBase: 30, InventarioSucursal: [] }
      ]
      const wb = construirWorkbookProductos(prods)
      const ws = wb.getWorksheet('Productos')
      assert.strictEqual(ws.getRow(2).getCell(10).value, 25.5, 'Uses precioVenta when present')
      assert.strictEqual(ws.getRow(3).getCell(10).value, 30, 'Falls back to precioBase')
    })

    it('T17. Costo null → celda vacía', async () => {
      const prod = [{ ...productos[0], costo: null, InventarioSucursal: [] }]
      const wb = construirWorkbookProductos(prod)
      const ws = wb.getWorksheet('Productos')
      assert.strictEqual(ws.getRow(2).getCell(11).value, '', 'null costo must be empty')
    })

    it('T18. Fixture completo: 125 productos, 0 duplicados, 0 faltantes', async () => {
      const wb = construirWorkbookProductos(productos)
      const ws = wb.getWorksheet('Productos')
      const codigos = []
      for (let i = 2; i <= ws.rowCount; i++) {
        codigos.push(ws.getRow(i).getCell(1).value)
      }
      assert.strictEqual(codigos.length, 125, 'Must have 125 data rows')
      const unicos = new Set(codigos)
      assert.strictEqual(unicos.size, 125, 'All codes must be unique (0 duplicates)')
    })
  })

  describe('PARITY — listar helpers usan la misma lógica', () => {
    let src
    before(() => { src = readSource('modules/productos/productos.controller.js') })

    it('T19. construirContextoProductos existe y es función', () => {
      assert.ok(hasPattern(src, /function construirContextoProductos/), 'construirContextoProductos must be defined')
    })

    it('T20. aplicarPostFiltroYOrden existe y es función', () => {
      assert.ok(hasPattern(src, /function aplicarPostFiltroYOrden/), 'aplicarPostFiltroYOrden must be defined')
    })

    it('T21. serializarProducto existe y es función', () => {
      assert.ok(hasPattern(src, /function serializarProducto/), 'serializarProducto must be defined')
    })

    it('T22. listar usa construirContextoProductos', () => {
      assert.ok(hasPattern(src, /construirContextoProductos\(req\)/), 'listar must call construirContextoProductos')
    })

    it('T23. listar usa serializarProducto en el map', () => {
      assert.ok(hasPattern(src, /productos\.map\(prod => serializarProducto/), 'listar must use serializarProducto')
    })

    it('T24. exportarExcel usa construirContextoProductos', () => {
      assert.ok(hasPattern(src, /async function exportarExcel[\s\S]*?construirContextoProductos\(req\)/),
        'exportarExcel must call construirContextoProductos')
    })

    it('T25. exportarExcel usa aplicarPostFiltroYOrden', () => {
      assert.ok(hasPattern(src, /async function exportarExcel[\s\S]*?aplicarPostFiltroYOrden/),
        'exportarExcel must use aplicarPostFiltroYOrden')
    })

    it('T26. exportarExcel usa serializarProducto', () => {
      assert.ok(hasPattern(src, /async function exportarExcel[\s\S]*?serializarProducto/),
        'exportarExcel must use serializarProducto')
    })

    it('T27. exportarExcel usa construirWorkbookProductos del helper', () => {
      assert.ok(hasPattern(src, /require\('\.\/productos\.export\.helper'\)/),
        'exportarExcel must import productos.export.helper')
    })

    it('T28. listar NO tiene paginación en applyPostFiltroYOrden (paginación es responsabilidad de listar)', () => {
      // Verificar que listar aplica slice DESPUÉS de ranking, no dentro del helper
      assert.ok(hasPattern(src, /productos = aplicarPostFiltroYOrden[\s\S]*?productos = productos\.slice/),
        'listar must apply slice after aplicarPostFiltroYOrden')
    })

    it('T29. exportarExcel tiene include Identico a listar (Categoria + InventarioSucursal + ProveedorProducto)', () => {
      // Verificar que el include en exportarExcel matchea el de listar
      const exportSection = src.match(/async function exportarExcel[\s\S]*?^}/m)?.[0] || ''
      assert.ok(exportSection.includes('Categoria: { include: { Departamento: true } }'),
        'exportarExcel must include Categoria with Departamento')
      assert.ok(exportSection.includes('ProveedorProducto: { include: { Proveedor: true } }'),
        'exportarExcel must include ProveedorProducto with Proveedor')
    })

    it('T30. exportarExcel NO tiene skip/take de paginación (usa solo take alto)', () => {
      const exportSection = src.match(/async function exportarExcel[\s\S]*?^}/m)?.[0] || ''
      assert.ok(!exportSection.includes('skipNum'), 'exportarExcel must NOT use skipNum')
      assert.ok(!exportSection.includes('takeNum'), 'exportarExcel must NOT use takeNum')
    })
  })
})
