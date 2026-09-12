'use strict'

const ExcelJS = require('exceljs')

const HEADER_FONT = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A66' } }
const HEADER_ALIGNMENT = { horizontal: 'center', vertical: 'middle', wrapText: true }
const BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }

const COLUMNAS = [
    { header: 'Código',          key: 'codigoInterno',  width: 14 },
    { header: 'Código de barras', key: 'codigoBarras',  width: 18 },
    { header: 'Nombre',          key: 'nombre',         width: 32 },
    { header: 'Departamento',    key: 'departamento',   width: 16 },
    { header: 'Categoría',       key: 'categoria',      width: 16 },
    { header: 'Tipo',            key: 'tipo',           width: 12 },
    { header: 'Unidad venta',    key: 'unidadVenta',    width: 13 },
    { header: 'Unidad compra',   key: 'unidadCompra',   width: 13 },
    { header: 'Factor',          key: 'factor',         width: 10 },
    { header: 'Precio venta',    key: 'precioVenta',    width: 13 },
    { header: 'Costo',           key: 'costo',          width: 13 },
    { header: 'Stock',           key: 'stock',          width: 10 },
    { header: 'Stock mínimo',    key: 'stockMinimo',    width: 12 },
    { header: 'Activo',          key: 'activo',         width: 8 }
]

function construirWorkbookProductos(productos, { sucursalIdInventario } = {}) {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'POS'
    workbook.created = new Date()

    const ws = workbook.addWorksheet('Productos')
    ws.columns = COLUMNAS

    // Estilo de encabezado
    const headerRow = ws.getRow(1)
    headerRow.font = HEADER_FONT
    headerRow.fill = HEADER_FILL
    headerRow.alignment = HEADER_ALIGNMENT
    headerRow.height = 30

    // Celdas de texto para códigos (preserva ceros iniciales)
    const TEXT_COLS = [1, 2] // Código, Código de barras

    for (const prod of productos) {
        const invs = prod.InventarioSucursal || []
        const stock = sucursalIdInventario
            ? (invs.length > 0 ? parseFloat(invs[0].stockActual) : 0)
            : invs.reduce((suma, inv) => suma + parseFloat(inv.stockActual || 0), 0)

        const stockMinimo = invs.length > 0 ? parseFloat(invs[0].stockMinimoAlerta) : null

        const rowValues = {
            codigoInterno: prod.codigoInterno != null ? String(prod.codigoInterno) : '',
            codigoBarras:  prod.codigoBarras != null ? String(prod.codigoBarras) : '',
            nombre:        prod.nombre || '',
            departamento:  prod.Categoria?.Departamento?.nombre || '',
            categoria:     prod.Categoria?.nombre || '',
            tipo:          prod.tipo || '',
            unidadVenta:   prod.unidadVenta || '',
            unidadCompra:  prod.unidadCompra || '',
            factor:        prod.factorConversion != null ? parseFloat(prod.factorConversion) : '',
            precioVenta:   prod.precioVenta != null ? parseFloat(prod.precioVenta) : (prod.precioBase != null ? parseFloat(prod.precioBase) : ''),
            costo:         prod.costo != null ? parseFloat(prod.costo) : '',
            stock:         stock,
            stockMinimo:   stockMinimo != null ? stockMinimo : '',
            activo:        prod.activo ? 'Sí' : 'No'
        }

        const row = ws.addRow(rowValues)
        row.eachCell(cell => {
            cell.border = BORDER
            cell.alignment = { vertical: 'middle' }
        })
    }

    // Forzar formato texto en columnas de código
    for (const colIdx of TEXT_COLS) {
        ws.getColumn(colIdx).numFmt = '@'
    }

    return workbook
}

module.exports = { construirWorkbookProductos }
