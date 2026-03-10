// ════════════════════════════════════════════════════════════════════
//  VENTAS CONTROLLER — CORREGIDO
//  Ubicación: src/modules/ventas/ventas.controller.js
//  
//  IMPORTANTE: Los precios YA incluyen IVA
//  NO se calcula IVA adicional
//  Total = Subtotal (sin IVA adicional)
//  
//  Responsabilidades:
//  - Crear ventas (POST /api/ventas)
//  - Validar stock en BD (transacción)
//  - Recalcular total (no confiar frontend)
//  - Reducir inventario
//  - Registrar movimientos
//  - Auditoría
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../prisma.client')

/**
 * POST /api/ventas
 * Crear venta nueva
 */
exports.crearVenta = async (req, res) => {
  try {
    const { sucursalId, usuarioId, turnoId, clienteId, metodoPago, subtotal, iva, descuento, total, detalles } = req.body

    // ═══════════════════════════════════════════════════════════════════
    // 1. VALIDACIONES BÁSICAS
    // ═══════════════════════════════════════════════════════════════════

    if (!sucursalId || !usuarioId || !turnoId || !metodoPago) {
      return res.status(400).json({
        error: 'Faltan campos requeridos',
        campos: ['sucursalId', 'usuarioId', 'turnoId', 'metodoPago']
      })
    }

    if (!detalles || detalles.length === 0) {
      return res.status(400).json({
        error: 'La venta debe tener al menos 1 producto'
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    // 2. VALIDAR TURNO ABIERTO
    // ═══════════════════════════════════════════════════════════════════

    const turno = await prisma.turnoCaja.findUnique({
      where: { id: turnoId }
    })

    if (!turno || !turno.abierto) {
      return res.status(403).json({
        error: 'Turno cerrado o no existe',
        codigo: 'SIN_TURNO_ABIERTO'
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3. VALIDAR USUARIO Y PERMISOS
    // ═══════════════════════════════════════════════════════════════════

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId }
    })

    if (!usuario || !usuario.activo) {
      return res.status(403).json({
        error: 'Usuario inválido o inactivo'
      })
    }

    // Verificar permiso VENTA (rol EMPLEADO, ADMIN_SUCURSAL, SUPERADMIN)
    const rolesConVenta = ['EMPLEADO', 'ADMIN_SUCURSAL', 'SUPERADMIN']
    if (!rolesConVenta.includes(usuario.rol)) {
      return res.status(403).json({
        error: 'Usuario sin permiso para vender',
        codigo: 'SIN_PERMISO_VENTA'
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4. VALIDAR Y RECALCULAR TOTAL (CRÍTICO)
    //    Nota: Los precios YA incluyen IVA
    //    Total = Subtotal (sin IVA adicional)
    // ═══════════════════════════════════════════════════════════════════

    let totalRecalculado = 0
    const detallesValidados = []

    // Validar cada detalle
    for (const detalle of detalles) {
      const { productoId, cantidad, precioUnitario } = detalle

      if (!productoId || !cantidad || !precioUnitario) {
        return res.status(400).json({
          error: 'Detalle incompleto',
          detalle
        })
      }

      if (cantidad <= 0) {
        return res.status(400).json({
          error: 'Cantidad debe ser > 0',
          producto: productoId
        })
      }

      // Subtotal del detalle
      const subtotalDetalle = parseFloat((cantidad * precioUnitario).toFixed(2))
      totalRecalculado += subtotalDetalle

      detallesValidados.push({
        productoId,
        cantidad: parseInt(cantidad),
        precioUnitario: parseFloat(precioUnitario),
        subtotal: subtotalDetalle
      })
    }

    // Redondear total
    totalRecalculado = parseFloat(totalRecalculado.toFixed(2))

    // Validar que total coincida (con tolerancia de $0.01)
    const diferencia = Math.abs(totalRecalculado - total)
    if (diferencia > 0.01) {
      return res.status(400).json({
        error: 'Total no coincide',
        codigo: 'TOTAL_MISMATCH',
        backend: totalRecalculado,
        frontend: total,
        diferencia
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5. VERIFICAR STOCK EN BD (TRANSACCIÓN)
    // ═══════════════════════════════════════════════════════════════════

    const inventarios = await prisma.inventarioSucursal.findMany({
      where: {
        sucursalId,
        productoId: { in: detallesValidados.map(d => d.productoId) }
      }
    })

    // Validar stock para cada producto
    for (const detalle of detallesValidados) {
      const inventario = inventarios.find(i => i.productoId === detalle.productoId)

      if (!inventario || inventario.stockActual < detalle.cantidad) {
        const disponibles = inventario?.stockActual || 0
        return res.status(400).json({
          error: `Stock insuficiente para producto ${detalle.productoId}`,
          codigo: 'STOCK_INSUFICIENTE',
          producto: detalle.productoId,
          disponibles,
          solicitados: detalle.cantidad
        })
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 6. GENERAR FOLIO ÚNICO
    // ═══════════════════════════════════════════════════════════════════

    const folio = await generarFolio()

    // ═══════════════════════════════════════════════════════════════════
    // 7. DETERMINAR ESTADO FACTURA
    // ═══════════════════════════════════════════════════════════════════

    let facturaEstado = 'DISPONIBLE'
    let facturaLimite = new Date()

    // Si efectivo > $2000: bloquear facturación automática
    if (metodoPago === 'EFECTIVO' && totalRecalculado > 2000) {
      facturaEstado = 'BLOQUEADA'
      facturaLimite.setHours(facturaLimite.getHours() + 72) // 72 horas
    } else {
      facturaLimite.setDate(facturaLimite.getDate() + 30) // 30 días
    }

    // ═══════════════════════════════════════════════════════════════════
    // 8. EJECUTAR TRANSACCIÓN
    // ═══════════════════════════════════════════════════════════════════

    const venta = await prisma.$transaction(async (tx) => {
      // Crear venta
      const ventaCreada = await tx.venta.create({
        data: {
          folio,
          sucursalId,
          usuarioId,
          clienteId: clienteId || null,
          turnoId,
          metodoPago,
          subtotal: totalRecalculado,
          iva: 0,  // No hay IVA adicional (precios ya lo incluyen)
          descuento: parseFloat(descuento || 0),
          total: totalRecalculado,
          estado: 'COMPLETADA',
          tokenQr: generarUUID(),
          facturaEstado,
          facturaLimite,
          detalles: {
            create: detallesValidados.map(d => ({
              productoId: d.productoId,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              subtotal: d.subtotal,
              descuento: 0
            }))
          }
        },
        include: {
          detalles: {
            include: { producto: true }
          }
        }
      })

      // Reducir stock en inventario
      for (const detalle of detallesValidados) {
        const inventarioAnterior = await tx.inventarioSucursal.findUnique({
          where: {
            productoId_sucursalId: {
              productoId: detalle.productoId,
              sucursalId
            }
          }
        })

        const stockAntes = inventarioAnterior.stockActual
        const stockDespues = stockAntes - detalle.cantidad

        await tx.inventarioSucursal.update({
          where: {
            productoId_sucursalId: {
              productoId: detalle.productoId,
              sucursalId
            }
          },
          data: { stockActual: stockDespues }
        })

        // Registrar movimiento de inventario
        await tx.movimientoInventario.create({
          data: {
            productoId: detalle.productoId,
            sucursalId,
            usuarioId,
            tipo: 'SALIDA_VENTA',
            cantidad: detalle.cantidad,
            stockAntes,
            stockDespues,
            referencia: folio
          }
        })
      }

      // Registrar movimiento de caja
      await tx.movimientoCaja.create({
        data: {
          turnoId,
          tipo: 'VENTA',
          monto: totalRecalculado,
          metodoPago,
          referencia: folio
        }
      })

      // Registrar en auditoría
      await tx.auditoria.create({
        data: {
          usuarioId,
          sucursalId,
          accion: 'CREAR_VENTA',
          modulo: 'VENTAS',
          referencia: folio,
          valorDespues: {
            ventaId: ventaCreada.id,
            total: totalRecalculado,
            items: detallesValidados.length
          }
        }
      })

      return ventaCreada
    })

    // ═══════════════════════════════════════════════════════════════════
    // 9. RETORNAR RESPUESTA
    // ═══════════════════════════════════════════════════════════════════

    console.log(`✅ Venta creada: ${venta.folio} - Total: $${venta.total}`)

    res.status(201).json({
      success: true,
      message: 'Venta registrada correctamente',
      data: venta
    })

  } catch (error) {
    console.error('❌ Error en crearVenta:', error)
    res.status(500).json({
      error: 'Error al procesar venta: ' + error.message
    })
  }
}

/**
 * GET /api/ventas
 * Obtener lista de ventas con paginación
 */
exports.obtenerVentas = async (req, res) => {
  try {
    const { skip = 0, take = 20, search, metodoPago, desde, hasta } = req.query

    const where = {}

    // Búsqueda por folio o cliente
    if (search) {
      where.OR = [
        { folio: { contains: search, mode: 'insensitive' } },
        { cliente: { nombre: { contains: search, mode: 'insensitive' } } }
      ]
    }

    // Filtro método pago
    if (metodoPago) {
      where.metodoPago = metodoPago
    }

    // Filtro fechas
    if (desde || hasta) {
      where.creadaEn = {}
      if (desde) where.creadaEn.gte = new Date(desde)
      if (hasta) {
        const hastaDate = new Date(hasta)
        hastaDate.setHours(23, 59, 59, 999)
        where.creadaEn.lte = hastaDate
      }
    }

    const [ventas, total] = await Promise.all([
      prisma.venta.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(take),
        orderBy: { creadaEn: 'desc' },
        include: {
          cliente: { select: { id: true, nombre: true } },
          usuario: { select: { id: true, nombre: true } },
          detalles: true
        }
      }),
      prisma.venta.count({ where })
    ])

    res.json({
      success: true,
      data: ventas.map(v => ({
        id: v.id,
        folio: v.folio,
        fecha: v.creadaEn,
        cliente: v.cliente ? v.cliente.nombre : 'Público general',
        usuario: v.usuario.nombre,
        metodoPago: v.metodoPago,
        total: v.total,
        productosCount: v.detalles.length,
        estado: v.estado
      })),
      total,
      skip: parseInt(skip),
      take: parseInt(take)
    })

  } catch (error) {
    console.error('❌ Error en obtenerVentas:', error)
    res.status(500).json({ error: error.message })
  }
}

/**
 * GET /api/ventas/:id
 * Obtener venta específica con detalles
 */
exports.obtenerVenta = async (req, res) => {
  try {
    const { id } = req.params

    const venta = await prisma.venta.findUnique({
      where: { id: parseInt(id) },
      include: {
        usuario: { select: { id: true, nombre: true } },
        cliente: true,
        sucursal: true,
        detalles: {
          include: { producto: true }
        }
      }
    })

    if (!venta) {
      return res.status(404).json({ error: 'Venta no encontrada' })
    }

    res.json({
      success: true,
      data: {
        id: venta.id,
        folio: venta.folio,
        fecha: venta.creadaEn,
        usuario: venta.usuario.nombre,
        cliente: venta.cliente ? {
          id: venta.cliente.id,
          nombre: venta.cliente.nombre,
          rfc: venta.cliente.rfc
        } : null,
        sucursal: venta.sucursal.nombre,
        metodoPago: venta.metodoPago,
        subtotal: venta.subtotal,
        iva: venta.iva,
        descuento: venta.descuento,
        total: venta.total,
        estado: venta.estado,
        tokenQr: venta.tokenQr,
        facturaEstado: venta.facturaEstado,
        detalles: venta.detalles.map(d => ({
          productoId: d.productoId,
          nombre: d.producto.nombre,
          codigo: d.producto.codigoInterno,
          cantidad: d.cantidad,
          precioUnitario: d.precioUnitario,
          subtotal: d.subtotal
        }))
      }
    })

  } catch (error) {
    console.error('❌ Error en obtenerVenta:', error)
    res.status(500).json({ error: error.message })
  }
}

/**
 * GET /api/ventas/historial/lista
 * Obtener historial (alias para obtenerVentas)
 */
exports.obtenerHistorial = async (req, res) => {
  return exports.obtenerVentas(req, res)
}

// ═══════════════════════════════════════════════════════════════════
//  FUNCIONES AUXILIARES
// ═══════════════════════════════════════════════════════════════════

/**
 * Genera folio único: VTA-YYYYMMDD-SECUENCIAL
 */
async function generarFolio() {
  const fecha = new Date()
  const año = fecha.getFullYear()
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  const fechaStr = `${año}${mes}${dia}`

  // Contar ventas del día
  const hoyInicio = new Date(fecha)
  hoyInicio.setHours(0, 0, 0, 0)

  const hoyFin = new Date(fecha)
  hoyFin.setHours(23, 59, 59, 999)

  const countHoy = await prisma.venta.count({
    where: {
      creadaEn: {
        gte: hoyInicio,
        lte: hoyFin
      }
    }
  })

  const secuencial = String(countHoy + 1).padStart(5, '0')
  return `VTA-${fechaStr}-${secuencial}`
}

/**
 * Genera UUID para tokenQr
 */
function generarUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}