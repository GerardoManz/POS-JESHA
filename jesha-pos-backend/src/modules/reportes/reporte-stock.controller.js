// ════════════════════════════════════════════════════════════════════
//  REPORTE-STOCK CONTROLLER
//  Reporte diario de stock con alertas, Excel y PDF
//  Ubicación: src/modules/reportes/reporte-stock.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { EMPRESA } = require('../../../config/empresa')
const ExcelJS = require('exceljs')

// ════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════

function fmt(v) {
  if (v === null || v === undefined) return '$0.00'
  return '$' + parseFloat(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNum(v) {
  if (v === null || v === undefined) return '0'
  return parseFloat(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtFechaCorta(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

async function buildReporteData(empresaId, sucursalId, fecha, turnoId, soloNuevos = false) {
  const desde = new Date(fecha + 'T00:00:00.000Z')
  const hasta = new Date(fecha + 'T23:59:59.999Z')

  // Parallel: sucursal + turno + inventarios + movimientos + alertas
  const [sucursal, turno, inventarios, movimientos, alertasActivas] = await Promise.all([
    prisma.sucursal.findUnique({ where: { id: sucursalId } }),
    turnoId
      ? prisma.turnoCaja.findUnique({ where: { id: turnoId }, include: { Usuario: { select: { id: true, nombre: true } } } })
      : prisma.turnoCaja.findFirst({ where: { sucursalId, abierto: true }, include: { Usuario: { select: { id: true, nombre: true } } } }),
    prisma.inventarioSucursal.findMany({
      where: { sucursalId },
      include: {
        Producto: {
          include: {
            Categoria: { include: { Departamento: true } },
            ProveedorProducto: { where: { activo: true }, include: { Proveedor: { select: { id: true, nombreOficial: true, telefono: true, celular: true } } }, take: 1 }
          }
        }
      }
    }),
    prisma.movimientoInventario.findMany({
      where: { empresaId, sucursalId, creadoEn: { gte: desde, lte: hasta } },
      include: {
        Producto: { select: { id: true, nombre: true, codigoInterno: true } },
        Usuario: { select: { id: true, nombre: true } }
      },
      orderBy: { creadoEn: 'desc' },
      take: 2000
    }),
    prisma.alertaStock.findMany({
      where: { empresaId, sucursalId, estado: 'PENDIENTE' },
      include: {
        Producto: { select: { id: true, nombre: true, codigoInterno: true, costoPromedio: true } },
        TurnoCaja: { select: { id: true, cerradaEn: true } }
      },
      orderBy: { stockActual: 'asc' }
    })
  ])

  const productosConMovimientoHoy = new Set(movimientos.map(m => m.productoId))

  // Procesar cada inventario
  const conStock = []
  const stockBajo = []
  const sinStock = []

  for (const inv of inventarios) {
    const stock = parseFloat(inv.stockActual)
    const minimo = parseFloat(inv.stockMinimoAlerta)
    const p = inv.Producto
    const categoria = p.Categoria?.nombre || '—'
    const departamento = p.Categoria?.Departamento?.nombre || '—'
    const proveedor = p.ProveedorProducto?.[0]?.Proveedor || null
    const proveedorCosto = p.ProveedorProducto?.[0]?.precioCosto || p.costoPromedio || 0
    const tieneAlerta = stock <= minimo
    const esNuevo = tieneAlerta && productosConMovimientoHoy.has(p.id)

    const base = {
      productoId: p.id,
      codigoInterno: p.codigoInterno || '—',
      codigoBarras: p.codigoBarras || '—',
      nombre: p.nombre,
      departamento,
      categoria,
      stockActual: stock,
      stockMinimo: minimo,
      stockMaximo: inv.stockMaximo ? parseFloat(inv.stockMaximo) : null,
      esNuevo,
      precioVenta: p.precioVenta ? parseFloat(p.precioVenta) : 0,
      costo: p.costoPromedio ? parseFloat(p.costoPromedio) : 0,
      proveedor: proveedor?.nombreOficial || '—',
      proveedorTelefono: proveedor?.celular || proveedor?.telefono || '—',
      proveedorCosto: parseFloat(proveedorCosto || 0)
    }

    if (stock <= 0) {
      sinStock.push(base)
    } else if (stock <= minimo) {
      stockBajo.push(base)
    } else {
      conStock.push(base)
    }
  }

  // Resumen de movimientos
  const resumenMov = { entradas: 0, salidas: 0, countEntradas: 0, countSalidas: 0 }
  for (const m of movimientos) {
    const tipo = m.tipo
    if (['ENTRADA_COMPRA', 'DEVOLUCION_ENTRADA', 'CANCELACION_VENTA', 'REINTEGRO_BITACORA', 'AJUSTE_POSITIVO'].includes(tipo)) {
      resumenMov.entradas += parseFloat(m.cantidad)
      resumenMov.countEntradas++
    } else {
      resumenMov.salidas += parseFloat(m.cantidad)
      resumenMov.countSalidas++
    }
  }

  // Velocidad de venta para productos críticos (batch groupBy en vez de N+1)
  const productosCriticos = [...sinStock, ...stockBajo]
  if (productosCriticos.length > 0) {
    const ids = productosCriticos.map(p => p.productoId)
    const desde7 = new Date(); desde7.setDate(desde7.getDate() - 7); desde7.setHours(0, 0, 0, 0)
    const desde30 = new Date(); desde30.setDate(desde30.getDate() - 30); desde30.setHours(0, 0, 0, 0)
    const [vel7d, vel30d] = await Promise.all([
      prisma.detalleVenta.groupBy({
        by: ['productoId'],
        where: { productoId: { in: ids }, Venta: { creadaEn: { gte: desde7 }, estado: { not: 'CANCELADA' }, sucursalId } },
        _sum: { cantidad: true }
      }),
      prisma.detalleVenta.groupBy({
        by: ['productoId'],
        where: { productoId: { in: ids }, Venta: { creadaEn: { gte: desde30 }, estado: { not: 'CANCELADA' }, sucursalId } },
        _sum: { cantidad: true }
      })
    ])
    const v7map = Object.fromEntries(vel7d.map(v => [v.productoId, parseFloat(v._sum.cantidad || 0)]))
    const v30map = Object.fromEntries(vel30d.map(v => [v.productoId, parseFloat(v._sum.cantidad || 0)]))
    for (const p of productosCriticos) {
      p.velocidad7d = v7map[p.productoId] || 0
      p.velocidad30d = v30map[p.productoId] || 0
      p.urgencia = p.stockActual <= 0 ? 5 : p.velocidad30d > 0 ? 4 : 3
      if (p.velocidad30d === 0) p.urgencia = 2
      const sugerencia = (p.stockMaximo || p.stockMinimo * 3) - p.stockActual
      p.sugerenciaReorden = Math.max(0, sugerencia)
      p.diasConAlerta = 0
    }
  }

  // Calcular días con alerta para alertas activas
  for (const a of alertasActivas) {
    const creada = new Date(a.creadaEn)
    const diff = Math.floor((Date.now() - creada.getTime()) / (1000 * 60 * 60 * 24))
    a.diasConAlerta = diff
  }

  return {
    resumen: {
      fecha,
      sucursal: sucursal?.nombre || '—',
      totalMonitoreados: inventarios.length,
      conStock: conStock.length,
      stockBajo: stockBajo.length,
      sinStock: sinStock.length,
      nuevosSinStock: sinStock.filter(p => p.esNuevo).length,
      nuevosStockBajo: stockBajo.filter(p => p.esNuevo).length,
      alertasActivasCount: alertasActivas.length,
      movimientosDelDia: resumenMov,
      turno: turno ? { id: turno.id, abierto: turno.abierto, cajero: turno.Usuario?.nombre || '—', abiertaEn: turno.abiertaEn, cerradaEn: turno.cerradaEn } : null
    },
    sinStock,
    stockBajo,
    alertasActivas,
    movimientos,
    sugerenciasReorden: productosCriticos.filter(p => p.sugerenciaReorden > 0).sort((a, b) => b.urgencia - a.urgencia)
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /reportes/stock/alertas/generar
//  Escanea InventarioSucursal y crea AlertaStock para el turno activo
// ════════════════════════════════════════════════════════════════════

exports.generarAlertasPorTurno = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { sucursalId: sucursalIdBody, turnoId: turnoIdBody } = req.body
    const { sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(sucursalIdBody) || 1

    const turno = turnoIdBody
      ? await prisma.turnoCaja.findUnique({ where: { id: parseInt(turnoIdBody) } })
      : await prisma.turnoCaja.findFirst({ where: { sucursalId, abierto: true } })

    if (!turno) return res.status(404).json({ error: 'No hay turno (activo o especificado) para generar alertas' })

    const todosInv = await prisma.inventarioSucursal.findMany({
      where: { sucursalId },
      select: { productoId: true, stockActual: true, stockMinimoAlerta: true }
    })

    const aAlertar = todosInv.filter(inv => parseFloat(inv.stockActual) <= parseFloat(inv.stockMinimoAlerta))
    let creadas = 0

    for (const inv of aAlertar) {
      try {
        await prisma.alertaStock.create({
          data: {
            empresaId,
            productoId: inv.productoId,
            sucursalId,
            stockActual: inv.stockActual,
            stockMinimo: inv.stockMinimoAlerta,
            estado: 'PENDIENTE',
            turnoId: turno.id
          }
        })
        creadas++
      } catch (err) {
        if (err.code === 'P2002') {
          // Ya existe alerta para este producto+branch+turno, ignorar
          continue
        }
        throw err
      }
    }

    console.log(`✅ ${creadas} alertas generadas para turno ${turno.id}`)
    res.json({ success: true, data: { alertasCreadas: creadas, turnoId: turno.id } })
  } catch (err) {
    console.error('❌ Error generando alertas:', err)
    res.status(500).json({ error: err.message || 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /reportes/stock
//  Devuelve JSON con todas las secciones del reporte
// ════════════════════════════════════════════════════════════════════

exports.obtenerReporteStock = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = req.query.sucursalId ? parseInt(req.query.sucursalId) : (sucursalIdToken || 1)
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10)
    const turnoId = req.query.turnoId ? parseInt(req.query.turnoId) : null
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50))
    const soloNuevos = req.query.soloNuevos === 'true'

    const data = await buildReporteData(empresaId, sucursalId, fecha, turnoId, soloNuevos)

    const nuevosHoySin = data.sinStock.filter(p => p.esNuevo)
    const nuevosHoyBajo = data.stockBajo.filter(p => p.esNuevo)

    let sinStock = data.sinStock
    let stockBajo = data.stockBajo

    if (soloNuevos) {
      sinStock = sinStock.filter(p => p.esNuevo)
      stockBajo = stockBajo.filter(p => p.esNuevo)
    }

    const sinStockTotal = sinStock.length
    const stockBajoTotal = stockBajo.length

    const sinStockPage = sinStock.slice((page - 1) * limit, page * limit)
    const stockBajoPage = stockBajo.slice((page - 1) * limit, page * limit)

    res.json({
      success: true,
      data: {
        ...data,
        sinStock: sinStockPage,
        stockBajo: stockBajoPage,
        nuevosHoySin,
        nuevosHoyBajo,
        pagination: {
          page,
          limit,
          sinStockTotal,
          stockBajoTotal,
          totalPages: Math.max(1, Math.ceil(Math.max(sinStockTotal, stockBajoTotal) / limit))
        }
      }
    })
  } catch (err) {
    console.error('❌ Error obteniendo reporte stock:', err)
    res.status(500).json({ error: err.message || 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /reportes/stock/excel
//  Genera archivo .xlsx con el reporte diario de stock
// ════════════════════════════════════════════════════════════════════

exports.generarExcelReporteStock = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = req.query.sucursalId ? parseInt(req.query.sucursalId) : (sucursalIdToken || 1)
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10)

    const data = await buildReporteData(empresaId, sucursalId, fecha, null)

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'JESHA POS'
    workbook.created = new Date()

    const headerFont = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A66' } }
    const dangerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } }
    const warnFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } }
    const borderStyle = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }
    const borderThick = {
      top: { style: 'medium' },
      left: { style: 'medium' },
      bottom: { style: 'medium' },
      right: { style: 'medium' }
    }

    function applyHeaderStyle(ws, columns) {
      const row = ws.getRow(1)
      row.font = headerFont
      row.fill = headerFill
      row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      row.height = 30
      columns.forEach((c, i) => {
        ws.getColumn(i + 1).width = c.width || 15
      })
    }

    function applyRowStyle(row, fill) {
      if (fill) row.fill = fill
      row.eachCell(cell => {
        cell.border = borderStyle
        cell.alignment = { vertical: 'middle', wrapText: true }
      })
    }

    // ── Hoja 1: Resumen ──
    const ws1 = workbook.addWorksheet('Resumen')
    ws1.columns = [
      { header: 'Métrica', key: 'metrica', width: 35 },
      { header: 'Valor', key: 'valor', width: 20 }
    ]
    applyHeaderStyle(ws1, ws1.columns)

    const resumenRows = [
      { metrica: 'Fecha del reporte', valor: data.resumen.fecha },
      { metrica: 'Sucursal', valor: data.resumen.sucursal },
      { metrica: 'Cajero del turno', valor: data.resumen.turno?.cajero || '—' },
      { metrica: '', valor: '' },
      { metrica: 'PRODUCTOS MONITOREADOS', valor: data.resumen.totalMonitoreados },
      { metrica: '  Con Stock', valor: data.resumen.conStock },
      { metrica: '  Stock Bajo', valor: data.resumen.stockBajo },
      { metrica: '  Sin Stock', valor: data.resumen.sinStock },
      { metrica: '', valor: '' },
      { metrica: 'NUEVOS HOY', valor: '' },
      { metrica: '  Pasaron a Sin Stock', valor: data.resumen.nuevosSinStock },
      { metrica: '  Pasaron a Stock Bajo', valor: data.resumen.nuevosStockBajo },
      { metrica: '', valor: '' },
      { metrica: 'Alertas Activas (pendientes)', valor: data.resumen.alertasActivasCount },
      { metrica: '', valor: '' },
      { metrica: 'MOVIMIENTOS DEL DÍA', valor: '' },
      { metrica: `  Entradas (${data.resumen.movimientosDelDia.countEntradas})`, valor: fmtNum(data.resumen.movimientosDelDia.entradas) },
      { metrica: `  Salidas (${data.resumen.movimientosDelDia.countSalidas})`, valor: fmtNum(data.resumen.movimientosDelDia.salidas) },
    ]

    resumenRows.forEach((r, i) => {
      const row = ws1.addRow(r)
      if (r.metrica.startsWith('PRODUCTOS') || r.metrica.startsWith('NUEVOS') || r.metrica.startsWith('Alertas') || r.metrica.startsWith('MOVIMIENTOS')) {
        row.eachCell(c => c.font = { bold: true, size: 10.5 })
      }
      applyRowStyle(row)
    })

    // ── Hoja 2: Nuevos Sin Stock ──
    const sinStockNuevos = data.sinStock.filter(p => p.esNuevo)
    const ws2 = workbook.addWorksheet('Nuevos Sin Stock')
    ws2.columns = [
      { header: 'Código', key: 'codigoInterno', width: 14 },
      { header: 'Nombre', key: 'nombre', width: 30 },
      { header: 'Departamento', key: 'departamento', width: 18 },
      { header: 'Categoría', key: 'categoria', width: 18 },
      { header: 'Stock Actual', key: 'stockActual', width: 12 },
      { header: 'Stock Mínimo', key: 'stockMinimo', width: 12 },
      { header: 'Velocidad 7d', key: 'velocidad7d', width: 12 },
      { header: 'Velocidad 30d', key: 'velocidad30d', width: 12 },
      { header: 'Costo', key: 'costo', width: 12 },
      { header: 'Proveedor', key: 'proveedor', width: 22 },
      { header: 'Tel. Proveedor', key: 'proveedorTelefono', width: 16 },
      { header: 'Sugerencia', key: 'sugerenciaReorden', width: 12 },
      { header: 'Urgencia', key: 'urgencia', width: 10 }
    ]
    applyHeaderStyle(ws2, ws2.columns)

    if (sinStockNuevos.length === 0) {
      ws2.addRow({ nombre: 'No hay productos nuevos sin stock en este período' })
    } else {
      sinStockNuevos.forEach(p => {
        const row = ws2.addRow({
          codigoInterno: p.codigoInterno,
          nombre: p.nombre,
          departamento: p.departamento,
          categoria: p.categoria,
          stockActual: p.stockActual,
          stockMinimo: p.stockMinimo,
          velocidad7d: p.velocidad7d,
          velocidad30d: p.velocidad30d,
          costo: p.costo,
          proveedor: p.proveedor,
          proveedorTelefono: p.proveedorTelefono,
          sugerenciaReorden: p.sugerenciaReorden,
          urgencia: p.urgencia === 5 ? 'Máxima' : p.urgencia >= 3 ? 'Alta' : 'Media'
        })
        applyRowStyle(row, dangerFill)
      })
    }

    // ── Hoja 3: Nuevos Stock Bajo ──
    const stockBajoNuevos = data.stockBajo.filter(p => p.esNuevo)
    const ws3 = workbook.addWorksheet('Nuevos Stock Bajo')
    ws3.columns = ws2.columns
    applyHeaderStyle(ws3, ws3.columns)

    if (stockBajoNuevos.length === 0) {
      ws3.addRow({ nombre: 'No hay productos nuevos con stock bajo en este período' })
    } else {
      stockBajoNuevos.forEach(p => {
        const row = ws3.addRow({
          codigoInterno: p.codigoInterno,
          nombre: p.nombre,
          departamento: p.departamento,
          categoria: p.categoria,
          stockActual: p.stockActual,
          stockMinimo: p.stockMinimo,
          velocidad7d: p.velocidad7d,
          velocidad30d: p.velocidad30d,
          costo: p.costo,
          proveedor: p.proveedor,
          proveedorTelefono: p.proveedorTelefono,
          sugerenciaReorden: p.sugerenciaReorden,
          urgencia: p.urgencia === 5 ? 'Máxima' : p.urgencia >= 3 ? 'Alta' : 'Media'
        })
        applyRowStyle(row, warnFill)
      })
    }

    // ── Hoja 4: Alertas Activas ──
    const ws4 = workbook.addWorksheet('Alertas Activas')
    ws4.columns = ws2.columns.concat([
      { header: 'Días Alerta', key: 'diasConAlerta', width: 12 },
      { header: 'Estado', key: 'estado', width: 14 }
    ])
    applyHeaderStyle(ws4, ws4.columns)

    if (data.alertasActivas.length === 0) {
      ws4.addRow({ nombre: 'No hay alertas activas' })
    } else {
      data.alertasActivas.forEach(a => {
        const stock = parseFloat(a.stockActual)
        const fill = stock <= 0 ? dangerFill : warnFill
        const row = ws4.addRow({
          codigoInterno: a.Producto?.codigoInterno || '—',
          nombre: a.Producto?.nombre || '—',
          departamento: '',
          categoria: '',
          stockActual: parseFloat(a.stockActual),
          stockMinimo: parseFloat(a.stockMinimo),
          estado: a.estado,
          diasConAlerta: a.diasConAlerta
        })
        applyRowStyle(row, fill)
      })
    }

    // ── Hoja 5: Movimientos del Día ──
    const ws5 = workbook.addWorksheet('Movimientos del Día')
    ws5.columns = [
      { header: 'Hora', key: 'hora', width: 16 },
      { header: 'Tipo', key: 'tipo', width: 20 },
      { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Código', key: 'codigo', width: 14 },
      { header: 'Cantidad', key: 'cantidad', width: 10 },
      { header: 'Stock Antes', key: 'stockAntes', width: 12 },
      { header: 'Stock Después', key: 'stockDespues', width: 12 },
      { header: 'Referencia', key: 'referencia', width: 22 },
      { header: 'Usuario', key: 'usuario', width: 18 }
    ]
    applyHeaderStyle(ws5, ws5.columns)

    if (data.movimientos.length === 0) {
      ws5.addRow({ producto: 'No hay movimientos en este período' })
    } else {
      data.movimientos.forEach(m => {
        const row = ws5.addRow({
          hora: m.creadoEn ? new Date(m.creadoEn).toLocaleTimeString('es-MX') : '—',
          tipo: m.tipo,
          producto: m.Producto?.nombre || '—',
          codigo: m.Producto?.codigoInterno || '—',
          cantidad: parseFloat(m.cantidad),
          stockAntes: parseFloat(m.stockAntes),
          stockDespues: parseFloat(m.stockDespues),
          referencia: m.referencia || '—',
          usuario: m.Usuario?.nombre || '—'
        })
        applyRowStyle(row)
        if (['SALIDA_VENTA', 'SALIDA_BITACORA', 'AJUSTE_NEGATIVO', 'DEVOLUCION_SALIDA'].includes(m.tipo)) {
          row.eachCell(c => c.font = { color: { argb: 'FFC62828' } })
        } else if (['ENTRADA_COMPRA', 'DEVOLUCION_ENTRADA', 'CANCELACION_VENTA'].includes(m.tipo)) {
          row.eachCell(c => c.font = { color: { argb: 'FF2E7D32' } })
        }
      })
    }

    // ── Hoja 6: Sugerencias de Reorden ──
    const ws6 = workbook.addWorksheet('Sugerencias Compra')
    ws6.columns = [
      { header: 'Código', key: 'codigoInterno', width: 14 },
      { header: 'Producto', key: 'nombre', width: 30 },
      { header: 'Stock Actual', key: 'stockActual', width: 12 },
      { header: 'Stock Mínimo', key: 'stockMinimo', width: 12 },
      { header: 'Velocidad 30d', key: 'velocidad30d', width: 12 },
      { header: 'Sugerido', key: 'sugerencia', width: 12 },
      { header: 'Costo Unit.', key: 'costo', width: 12 },
      { header: 'Total Estimado', key: 'totalEstimado', width: 14 },
      { header: 'Proveedor', key: 'proveedor', width: 22 },
      { header: 'Teléfono', key: 'telefono', width: 16 }
    ]
    applyHeaderStyle(ws6, ws6.columns)

    if (data.sugerenciasReorden.length === 0) {
      ws6.addRow({ nombre: 'No hay productos que requieran reorden' })
    } else {
      data.sugerenciasReorden.forEach(p => {
        const costo = p.proveedorCosto || p.costo || 0
        const totalEstimado = p.sugerenciaReorden * costo
        const fill = p.stockActual <= 0 ? dangerFill : warnFill
        const row = ws6.addRow({
          codigoInterno: p.codigoInterno,
          nombre: p.nombre,
          stockActual: p.stockActual,
          stockMinimo: p.stockMinimo,
          velocidad30d: p.velocidad30d,
          sugerencia: p.sugerenciaReorden,
          costo: costo,
          totalEstimado: totalEstimado,
          proveedor: p.proveedor,
          telefono: p.proveedorTelefono
        })
        applyRowStyle(row, fill)
      })
    }

    // ── Hoja 7: Corrección (plantilla editable) ──
    const ws7 = workbook.addWorksheet('Corrección')
    ws7.columns = [
      { header: 'Código', key: 'codigoInterno', width: 14 },
      { header: 'Producto', key: 'producto', width: 32 },
      { header: 'Depto.', key: 'departamento', width: 16 },
      { header: 'Stock Actual', key: 'stockActual', width: 13 },
      { header: 'Mín (ACTUAL)', key: 'minActual', width: 13 },
      { header: 'Máx (ACTUAL)', key: 'maxActual', width: 13 },
      { header: 'Stock (NUEVO)', key: 'stockNuevo', width: 13 },
      { header: 'Mín (NUEVO)', key: 'minNuevo', width: 13 },
      { header: 'Máx (NUEVO)', key: 'maxNuevo', width: 13 }
    ]
    applyHeaderStyle(ws7, ws7.columns)
    const editFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    const productosCorreccion = [...data.sinStock.filter(p => p.esNuevo), ...data.stockBajo.filter(p => p.esNuevo)]
    if (productosCorreccion.length === 0) {
      ws7.addRow({ producto: 'No hay productos críticos en este período' })
    } else {
      for (const p of productosCorreccion) {
        const row = ws7.addRow({
          codigoInterno: p.codigoInterno,
          producto: p.nombre,
          departamento: p.departamento,
          stockActual: p.stockActual,
          minActual: p.stockMinimo,
          maxActual: p.stockMaximo ?? 0,
          stockNuevo: p.stockActual,
          minNuevo: p.stockMinimo,
          maxNuevo: p.stockMaximo ?? 0
        })
        applyRowStyle(row)
        // Green highlight on editable columns (G: Stock NUEVO, H: Mín NUEVO, I: Máx NUEVO)
        row.getCell(7).fill = editFill
        row.getCell(8).fill = editFill
        row.getCell(9).fill = editFill
      }
    }

    // Escribir respuesta
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename=reporte-stock-${fecha}.xlsx`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (err) {
    console.error('❌ Error generando Excel stock:', err)
    res.status(500).json({ error: err.message || 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /reportes/stock/pdf
//  Genera PDF con el reporte diario de stock (estilo A4)
// ════════════════════════════════════════════════════════════════════

exports.generarPdfReporteStock = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = req.query.sucursalId ? parseInt(req.query.sucursalId) : (sucursalIdToken || 1)
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10)

    const data = await buildReporteData(empresaId, sucursalId, fecha, null)

    // Generar HTML A4 (mismo patrón que bitacora/reporte.controller.js)
    const EMP = {
      nombre: 'Ferretería e Iluminación JESHA',
      slogan: 'Productos y Servicios de Máxima Calidad',
      direccion: 'Av. San Simón #03',
      ciudad: 'Guadalupe, Zacatecas',
      tel1: '492 101 6879'
    }

    const LOGO = 'https://res.cloudinary.com/dabyfymjd/image/upload/q_auto/f_auto/v1779317658/logo-jesha_hmlble.png'

    function filaProductoHTML(p) {
      return `<tr>
        <td>${p.codigoInterno}</td>
        <td class="prod-nombre">${p.nombre}</td>
        <td>${p.departamento}</td>
        <td class="num">${p.stockActual}</td>
        <td class="num">${p.stockMinimo}</td>
        <td class="num">${p.velocidad30d}</td>
        <td class="num">${p.sugerenciaReorden}</td>
        <td>${p.proveedor === '—' ? '-' : p.proveedor}</td>
        <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'Máxima' : p.urgencia >= 3 ? 'Alta' : 'Media'}</td>
      </tr>`
    }

    const sinStockHTML = data.sinStock.length > 0
      ? `<div class="seccion">
          <div class="seccion-titulo seccion-peligro">Sin Stock (${data.sinStock.length})</div>
          <table class="tbl-prods">
            <thead><tr>
              <th>Código</th><th>Producto</th><th>Depto.</th><th class="num">Stock</th>
              <th class="num">Mín</th><th class="num">V30d</th><th class="num">Sug.</th><th>Proveedor</th><th>Urg.</th>
            </tr></thead>
            <tbody>${data.sinStock.map(filaProductoHTML).join('')}</tbody>
          </table>
        </div>`
      : ''

    const stockBajoHTML = data.stockBajo.length > 0
      ? `<div class="seccion">
          <div class="seccion-titulo seccion-advertencia">Stock Bajo (${data.stockBajo.length})</div>
          <table class="tbl-prods">
            <thead><tr>
              <th>Código</th><th>Producto</th><th>Depto.</th><th class="num">Stock</th>
              <th class="num">Mín</th><th class="num">V30d</th><th class="num">Sug.</th><th>Proveedor</th><th>Urg.</th>
            </tr></thead>
            <tbody>${data.stockBajo.map(filaProductoHTML).join('')}</tbody>
          </table>
        </div>`
      : ''

    const nuevosHoy = [
      ...data.sinStock.filter(p => p.esNuevo).map(p => ({ ...p, _tipo: 'Sin Stock' })),
      ...data.stockBajo.filter(p => p.esNuevo).map(p => ({ ...p, _tipo: 'Stock Bajo' }))
    ]

    const nuevosHoyHTML = nuevosHoy.length > 0
      ? `<div class="seccion">
          <div class="seccion-titulo" style="background:#1f3a66;color:#fff;">🆕 Nuevos Hoy — Productos que pasaron a crítico (${nuevosHoy.length})</div>
          <table class="tbl-prods">
            <thead><tr>
              <th>Código</th><th>Producto</th><th>Depto.</th><th class="num">Stock</th>
              <th class="num">Mín</th><th class="num">V30d</th><th class="num">Sug.</th><th>Proveedor</th><th>Urg.</th>
            </tr></thead>
            <tbody>${nuevosHoy.map(p => filaProductoHTML(p)).join('')}</tbody>
          </table>
        </div>`
      : ''

    const alertasHTML = data.alertasActivas.length > 0
      ? `<div class="seccion">
          <div class="seccion-titulo">Alertas Activas (${data.alertasActivas.length})</div>
          <table class="tbl-prods">
            <thead><tr>
              <th>Código</th><th>Producto</th><th class="num">Stock</th><th class="num">Mín</th>
              <th class="num">Días</th><th>Estado</th>
            </tr></thead>
            <tbody>${data.alertasActivas.map(a => `
              <tr>
                <td>${a.Producto?.codigoInterno || '—'}</td>
                <td class="prod-nombre">${a.Producto?.nombre || '—'}</td>
                <td class="num">${parseFloat(a.stockActual)}</td>
                <td class="num">${parseFloat(a.stockMinimo)}</td>
                <td class="num">${a.diasConAlerta}</td>
                <td>${a.estado}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`
      : ''

    const movsHTML = data.movimientos.length > 0
      ? `<div class="seccion">
          <div class="seccion-titulo">Movimientos del Día (${data.movimientos.length})</div>
          <div class="resumen-mov">
            <span class="mov-in">Entradas: ${fmtNum(data.resumen.movimientosDelDia.entradas)} (${data.resumen.movimientosDelDia.countEntradas})</span>
            <span class="mov-out">Salidas: ${fmtNum(data.resumen.movimientosDelDia.salidas)} (${data.resumen.movimientosDelDia.countSalidas})</span>
          </div>
          <table class="tbl-prods">
            <thead><tr>
              <th>Hora</th><th>Tipo</th><th>Producto</th><th class="num">Cant.</th>
              <th class="num">Antes</th><th class="num">Después</th><th>Ref.</th>
            </tr></thead>
            <tbody>${data.movimientos.slice(0, 50).map(m => `
              <tr>
                <td>${m.creadoEn ? new Date(m.creadoEn).toLocaleTimeString('es-MX') : '—'}</td>
                <td>${m.tipo}</td>
                <td class="prod-nombre">${m.Producto?.nombre || '—'}</td>
                <td class="num">${parseFloat(m.cantidad)}</td>
                <td class="num">${parseFloat(m.stockAntes)}</td>
                <td class="num">${parseFloat(m.stockDespues)}</td>
                <td style="font-size:7px">${m.referencia || '—'}</td>
              </tr>`).join('')}
          </tbody></table>
          ${data.movimientos.length > 50 ? `<p style="font-size:8px;color:#999;margin-top:2mm">Mostrando 50 de ${data.movimientos.length} movimientos</p>` : ''}
        </div>`
      : ''

    const sugerenciasHTML = data.sugerenciasReorden.length > 0
      ? `<div class="seccion">
          <div class="seccion-titulo">Sugerencias de Reorden</div>
          <table class="tbl-prods">
            <thead><tr>
              <th>Producto</th><th class="num">Stock</th><th class="num">Mín</th>
              <th class="num">V30d</th><th class="num">Sugerido</th><th class="num">Costo</th>
              <th class="num">Total Est.</th><th>Proveedor</th><th>Tel.</th>
            </tr></thead>
            <tbody>${data.sugerenciasReorden.map(p => {
              const costo = p.proveedorCosto || p.costo || 0
              return `<tr>
                <td class="prod-nombre">${p.nombre}</td>
                <td class="num">${p.stockActual}</td><td class="num">${p.stockMinimo}</td>
                <td class="num">${p.velocidad30d}</td><td class="num"><strong>${p.sugerenciaReorden}</strong></td>
                <td class="num">${fmt(costo)}</td><td class="num">${fmt(p.sugerenciaReorden * costo)}</td>
                <td>${p.proveedor === '—' ? '-' : p.proveedor}</td>
                <td style="font-size:7px">${p.proveedorTelefono === '—' ? '-' : p.proveedorTelefono}</td>
              </tr>`
            }).join('')}
          </tbody></table>
        </div>`
      : ''

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Reporte Diario de Stock - ${fecha}</title>
<style>
@page { size: A4; margin: 8mm; }
* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html, body { font-family:Arial,Helvetica,sans-serif; font-size:10px; color:#1a1a1a; background:#fff; line-height:1.35; }
.hdr { text-align:center; padding-bottom:3mm; border-bottom:2px solid #1a1a1a; margin-bottom:3mm; }
.logo { display:block; margin:0 auto 1.5mm; width:28mm; height:auto; }
.emp { font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:1px; }
.slg { font-size:9px; font-weight:700; margin-top:0.3mm; color:#444; }
.dir { font-size:8px; font-weight:700; margin-top:0.2mm; color:#555; }

.doc-tipo { text-align:center; font-size:14px; font-weight:900; letter-spacing:3px; padding:2mm 0; background:#1f3a66; color:#fff; margin:2mm 0; }
.doc-tipo span { font-size:10px; letter-spacing:0; }

.info-grid { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:2mm; margin-bottom:3mm; }
.info-item { font-size:8px; }
.info-label { font-weight:700; color:#555; text-transform:uppercase; font-size:7px; }
.info-valor { font-weight:700; font-size:9px; margin-top:0.5mm; }

.resumen-caja { display:grid; grid-template-columns:repeat(4,1fr); gap:2mm; margin:3mm 0; }
.res-item { border:1px solid #ddd; border-radius:2mm; padding:1.5mm; text-align:center; }
.res-item .num { font-size:18px; font-weight:900; }
.res-item .rotulo { font-size:7px; color:#666; text-transform:uppercase; letter-spacing:0.5px; }
.res-item.peligro { border-color:#c62828; background:#fff5f5; }
.res-item.advertencia { border-color:#e65100; background:#fff8e1; }
.res-item.ok { border-color:#2e7d32; background:#f1f8e9; }
.res-item.info { border-color:#1f3a66; background:#e8eaf6; }

.seccion { margin:3mm 0; }
.seccion-titulo { font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; padding:1.5mm 2mm; background:#f0f0f0; border-bottom:1.5px solid #1a1a1a; margin-bottom:1mm; }
.seccion-peligro { background:#c62828; color:#fff; border-bottom-color:#c62828; }
.seccion-advertencia { background:#e65100; color:#fff; border-bottom-color:#e65100; }

.tbl-prods { width:100%; border-collapse:collapse; font-size:8px; page-break-inside:auto; }
.tbl-prods th { padding:1.5mm 2mm; text-align:left; background:#f5f5f5; border-bottom:1.5px solid #1a1a1a; font-size:7px; font-weight:900; text-transform:uppercase; color:#555; }
.tbl-prods td { padding:1.5mm 2mm; border-bottom:0.5px solid #ddd; vertical-align:top; }
.tbl-prods .num { text-align:right; white-space:nowrap; }
.tbl-prods .prod-nombre { font-weight:700; }
.tbl-prods tr.peligro-row td { background:#fff5f5; }
.tbl-prods tr.advertencia-row td { background:#fff8e1; }
.urg-max { color:#c62828; font-weight:900; }
.urg-alta { color:#e65100; font-weight:700; }

.resumen-mov { display:flex; gap:3mm; margin-bottom:1mm; font-size:8px; }
.mov-in { color:#2e7d32; font-weight:700; }
.mov-out { color:#c62828; font-weight:700; }

.pie { text-align:center; font-size:8px; color:#777; margin-top:4mm; padding-top:2mm; border-top:1px solid #ddd; }
.no-print { display:block; margin:12px auto 5px; padding:10px 28px; background:#1f3a66; color:#fff; border:none; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; }

@media print {
  .no-print { display:none !important; }
  * { color:#000 !important; }
  .doc-tipo, .doc-tipo * { color:#fff !important; background:#1f3a66 !important; }
  .seccion-peligro, .seccion-peligro * { color:#fff !important; background:#c62828 !important; }
  .seccion-advertencia, .seccion-advertencia * { color:#fff !important; background:#e65100 !important; }
}
@media screen {
  html, body { max-width:210mm; margin:0 auto; padding:5mm 8mm; box-shadow:0 0 15px rgba(0,0,0,0.1); }
}
</style>
</head>
<body>

<div class="hdr">
  <img src="${LOGO}" alt="JESHA" class="logo" />
  <div class="emp">${EMP.nombre}</div>
  <div class="slg">${EMP.slogan}</div>
  <div class="dir">${EMP.direccion} — ${EMP.ciudad}</div>
</div>

<div class="doc-tipo">Reporte Diario de Stock <span>— ${fecha}</span></div>

<div class="info-grid">
  <div class="info-item"><div class="info-label">Sucursal</div><div class="info-valor">${data.resumen.sucursal}</div></div>
  <div class="info-item"><div class="info-label">Productos</div><div class="info-valor">${data.resumen.totalMonitoreados}</div></div>
  <div class="info-item"><div class="info-label">Alertas Activas</div><div class="info-valor">${data.resumen.alertasActivasCount}</div></div>
  <div class="info-item"><div class="info-label">Cajero</div><div class="info-valor">${data.resumen.turno?.cajero || '—'}</div></div>
</div>

<div class="resumen-caja">
  <div class="res-item ok">
    <div class="num">${data.resumen.conStock}</div>
    <div class="rotulo">Con Stock</div>
  </div>
  <div class="res-item advertencia">
    <div class="num">${data.resumen.stockBajo}</div>
    <div class="rotulo">Stock Bajo</div>
  </div>
  <div class="res-item peligro">
    <div class="num">${data.resumen.sinStock}</div>
    <div class="rotulo">Sin Stock</div>
  </div>
  <div class="res-item info">
    <div class="num">+${data.resumen.nuevosSinStock} / ${data.resumen.nuevosStockBajo}</div>
    <div class="rotulo">Nuevos Hoy (Sin/Bajo)</div>
  </div>
</div>

${nuevosHoyHTML}
${sinStockHTML}
${stockBajoHTML}
${alertasHTML}
${movsHTML}
${sugerenciasHTML}

<div class="pie">
  Reporte generado desde JESHA POS — ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
</div>

<button class="no-print" onclick="window.print()">Imprimir / Guardar PDF</button>
</body>
</html>`

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `inline; filename=reporte-stock-${fecha}.html`)
    res.send(html)
  } catch (err) {
    console.error('❌ Error generando PDF stock:', err)
    res.status(500).json({ error: err.message || 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /reportes/stock/alertas/:id
//  Cambia estado de una alerta (VISTA / RESUELTA)
// ════════════════════════════════════════════════════════════════════

exports.marcarAlerta = async (req, res) => {
  try {
    const { id } = req.params
    const { estado } = req.body
    const empresaId = getEmpresaId(req)

    if (!['VISTA', 'RESUELTA'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido. Usar VISTA o RESUELTA' })
    }

    const alerta = await prisma.alertaStock.findUnique({ where: { id: parseInt(id) } })
    if (!alerta || alerta.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Alerta no encontrada' })
    }

    const updateData = { estado }
    if (estado === 'VISTA') updateData.vistaEn = new Date()
    if (estado === 'RESUELTA') updateData.resueltaEn = new Date()

    await prisma.alertaStock.update({
      where: { id: parseInt(id) },
      data: updateData
    })

    res.json({ success: true, data: { id: parseInt(id), estado } })
  } catch (err) {
    console.error('❌ Error marcando alerta:', err)
    res.status(500).json({ error: err.message || 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /reportes/stock/alertas
//  Lista alertas con filtros
// ════════════════════════════════════════════════════════════════════

exports.obtenerAlertas = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = req.query.sucursalId ? parseInt(req.query.sucursalId) : (sucursalIdToken || 1)
    const { estado, turnoId, limit = '50' } = req.query

    const where = { empresaId, sucursalId }
    if (estado) where.estado = estado
    if (turnoId) where.turnoId = parseInt(turnoId)

    const alertas = await prisma.alertaStock.findMany({
      where,
      include: {
        Producto: { select: { id: true, nombre: true, codigoInterno: true, costoPromedio: true } },
        TurnoCaja: { select: { id: true, cerradaEn: true } }
      },
      orderBy: { creadaEn: 'desc' },
      take: Math.min(parseInt(limit), 200)
    })

    res.json({ success: true, data: alertas })
  } catch (err) {
    console.error('❌ Error obteniendo alertas:', err)
    res.status(500).json({ error: err.message || 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /reportes/stock/plantilla-correccion
//  Descarga Excel con Sin Stock + Stock Bajo del día, hoja "Corrección"
// ════════════════════════════════════════════════════════════════════

exports.generarPlantillaCorreccion = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = req.query.sucursalId ? parseInt(req.query.sucursalId) : (sucursalIdToken || 1)
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10)

    const data = await buildReporteData(empresaId, sucursalId, fecha, null)
    const productos = [...data.sinStock.filter(p => p.esNuevo), ...data.stockBajo.filter(p => p.esNuevo)]

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'JESHA POS'
    workbook.created = new Date()

    const ws = workbook.addWorksheet('Corrección')
    ws.columns = [
      { header: 'Código', key: 'codigoInterno', width: 14 },
      { header: 'Producto', key: 'producto', width: 32 },
      { header: 'Depto.', key: 'departamento', width: 16 },
      { header: 'Stock Actual', key: 'stockActual', width: 13 },
      { header: 'Mín (ACTUAL)', key: 'minActual', width: 13 },
      { header: 'Máx (ACTUAL)', key: 'maxActual', width: 13 },
      { header: 'Stock (NUEVO)', key: 'stockNuevo', width: 13 },
      { header: 'Mín (NUEVO)', key: 'minNuevo', width: 13 },
      { header: 'Máx (NUEVO)', key: 'maxNuevo', width: 13 }
    ]

    const headerFont = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A66' } }
    const editFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }

    // Header row
    const headerRow = ws.getRow(1)
    headerRow.font = headerFont
    headerRow.fill = headerFill
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    headerRow.height = 30

    // Data rows
    for (const p of productos) {
      const row = ws.addRow({
        codigoInterno: p.codigoInterno,
        producto: p.nombre,
        departamento: p.departamento,
        stockActual: p.stockActual,
        minActual: p.stockMinimo,
        maxActual: p.stockMaximo ?? 0,
        stockNuevo: p.stockActual,
        minNuevo: p.stockMinimo,
        maxNuevo: p.stockMaximo ?? 0
      })
      row.eachCell(cell => { cell.border = border; cell.alignment = { vertical: 'middle', wrapText: true } })
      // Highlight editable columns (G: Stock NUEVO, H: Mín NUEVO, I: Máx NUEVO)
      row.getCell(7).fill = editFill
      row.getCell(8).fill = editFill
      row.getCell(9).fill = editFill
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename=plantilla-correccion-${fecha}.xlsx`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (err) {
    console.error('❌ Error generando plantilla corrección:', err)
    res.status(500).json({ error: err.message || 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /reportes/stock/corregir-plantilla
//  Recibe Excel corregido y actualiza stockMinimoAlerta / stockMaximo
// ════════════════════════════════════════════════════════════════════

exports.corregirPlantilla = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { sucursalId: sucursalIdToken, id: usuarioId } = req.usuario
    const sucursalId = req.query.sucursalId ? parseInt(req.query.sucursalId) : (sucursalIdToken || 1)

    if (!req.file) {
      return res.status(400).json({ error: 'Archivo Excel requerido' })
    }

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(req.file.buffer)
    const ws = workbook.getWorksheet('Corrección')
    if (!ws) {
      return res.status(400).json({ error: 'No se encontró la hoja "Corrección" en el archivo' })
    }

    const headers = []
    ws.getRow(1).eachCell((cell, colNumber) => { headers[colNumber] = cell.text?.toString().trim() || '' })

    const idxCodigo = headers.indexOf('Código')
    const idxStockNuevo = headers.indexOf('Stock (NUEVO)')
    const idxMinNuevo = headers.indexOf('Mín (NUEVO)')
    const idxMaxNuevo = headers.indexOf('Máx (NUEVO)')
    const idxStockActual = headers.indexOf('Stock Actual')
    const idxMinActual = headers.indexOf('Mín (ACTUAL)')
    const idxMaxActual = headers.indexOf('Máx (ACTUAL)')

    if (idxCodigo === -1 || idxMinNuevo === -1 || idxStockNuevo === -1) {
      return res.status(400).json({ error: 'Columnas requeridas faltantes: Código, Stock (NUEVO), Mín (NUEVO)' })
    }

    let actualizados = 0
    let sinCambios = 0
    let noEncontrados = 0

    // Resolver turno activo para MovimientoInventario
    const turno = await prisma.turnoCaja.findFirst({ where: { sucursalId, abierto: true }, select: { id: true } })

    // Collect updates first
    const updates = []
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const codigo = row.getCell(idxCodigo).text?.toString().trim()
      if (!codigo) return

      const stockNuevo = parseFloat(row.getCell(idxStockNuevo).text?.toString().trim())
      const minNuevo = parseFloat(row.getCell(idxMinNuevo).text?.toString().trim())
      const maxNuevo = parseFloat(row.getCell(idxMaxNuevo).text?.toString().trim())
      const stockActual = parseFloat(row.getCell(idxStockActual).text?.toString().trim())
      const minActual = parseFloat(row.getCell(idxMinActual).text?.toString().trim())
      const maxActual = parseFloat(row.getCell(idxMaxActual).text?.toString().trim())

      if (isNaN(minNuevo)) return

      const stockChanged = !isNaN(stockNuevo) && stockNuevo !== stockActual
      const minChanged = minNuevo !== minActual
      const maxChanged = !isNaN(maxNuevo) && maxNuevo !== maxActual

      if (!stockChanged && !minChanged && !maxChanged) {
        sinCambios++
        return
      }

      updates.push({ codigo, stockNuevo, minNuevo, maxNuevo, stockChanged, minChanged, maxChanged, stockActual })
    })

    if (updates.length === 0) {
      return res.json({ actualizados: 0, sinCambios, noEncontrados: 0, mensaje: 'No se detectaron cambios' })
    }

    // Apply updates in parallel
    const results = await Promise.allSettled(
      updates.map(async (u) => {
        const producto = await prisma.producto.findFirst({
          where: { empresaId, codigoInterno: u.codigo },
          select: { id: true }
        })
        if (!producto) return { codigo: u.codigo, estado: 'no_encontrado' }

        const data = {}
        if (u.stockChanged) data.stockActual = parseFloat(u.stockNuevo.toFixed(3))
        data.stockMinimoAlerta = u.minNuevo
        if (!isNaN(u.maxNuevo)) data.stockMaximo = u.maxNuevo

        await prisma.inventarioSucursal.updateMany({
          where: { productoId: producto.id, sucursalId },
          data
        })

        // Crear MovimientoInventario si cambió el stock
        if (u.stockChanged) {
          try {
            const cantidad = parseFloat((u.stockNuevo - u.stockActual).toFixed(3))
            await prisma.movimientoInventario.create({
              data: {
                empresaId,
                sucursalId,
                productoId: producto.id,
                tipo: cantidad > 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO',
                cantidad: Math.abs(cantidad),
                stockAntes: u.stockActual,
                stockDespues: u.stockNuevo,
                referencia: 'CORRECCION-PLANTILLA',
                usuarioId,
                turnoId: turno?.id || null
              }
            })
          } catch (movErr) {
            console.error('⚠️ MovimientoInventario no registrado para', u.codigo, ':', movErr.message)
          }
        }

        return { codigo: u.codigo, estado: 'actualizado' }
      })
    )

    actualizados = results.filter(r => r.status === 'fulfilled' && r.value.estado === 'actualizado').length
    noEncontrados = results.filter(r => r.status === 'fulfilled' && r.value.estado === 'no_encontrado').length

    res.json({
      actualizados,
      sinCambios,
      noEncontrados,
      mensaje: `${actualizados} productos actualizados${noEncontrados > 0 ? `, ${noEncontrados} no encontrados` : ''}`
    })
  } catch (err) {
    console.error('❌ Error procesando plantilla corrección:', err)
    res.status(500).json({ error: err.message || 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GENERAR ALERTAS AUTOMÁTICAS (llamado desde cerrarTurno)
// ════════════════════════════════════════════════════════════════════

exports.generarAlertasAutomaticas = async (empresaId, sucursalId, turnoId) => {
  const todosInv = await prisma.inventarioSucursal.findMany({
    where: { sucursalId },
    select: { productoId: true, stockActual: true, stockMinimoAlerta: true }
  })

  const aAlertar = todosInv.filter(inv => parseFloat(inv.stockActual) <= parseFloat(inv.stockMinimoAlerta))
  let creadas = 0
  let existentes = 0

  for (const inv of aAlertar) {
    try {
      await prisma.alertaStock.create({
        data: {
          empresaId,
          productoId: inv.productoId,
          sucursalId,
          stockActual: inv.stockActual,
          stockMinimo: inv.stockMinimoAlerta,
          estado: 'PENDIENTE',
          turnoId
        }
      })
      creadas++
    } catch (err) {
      if (err.code === 'P2002') {
        existentes++
        continue
      }
      throw err
    }
  }

  console.log(`✅ Reporte stock: ${creadas} alertas creadas, ${existentes} ya existían (turno ${turnoId})`)
  return { creadas, existentes }
}
