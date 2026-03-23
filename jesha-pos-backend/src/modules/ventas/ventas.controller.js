// ════════════════════════════════════════════════════════════════════
//  VENTAS CONTROLLER
//  Ubicación: src/modules/ventas/ventas.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

/**
 * POST /ventas
 */
exports.crearVenta = async (req, res) => {
  try {
    const { sucursalId, usuarioId, turnoId, clienteId, metodoPago, subtotal, iva, descuento, total, detalles } = req.body

    if (!sucursalId || !usuarioId || !turnoId || !metodoPago) {
      return res.status(400).json({ error: 'Faltan campos requeridos', campos: ['sucursalId', 'usuarioId', 'turnoId', 'metodoPago'] })
    }
    if (!detalles || detalles.length === 0) {
      return res.status(400).json({ error: 'La venta debe tener al menos 1 producto' })
    }

    const turno = await prisma.turnoCaja.findUnique({ where: { id: turnoId } })
    if (!turno || !turno.abierto) {
      return res.status(403).json({ error: 'Turno cerrado o no existe', codigo: 'SIN_TURNO_ABIERTO' })
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario || !usuario.activo) {
      return res.status(403).json({ error: 'Usuario inválido o inactivo' })
    }
    const rolesConVenta = ['EMPLEADO', 'ADMIN_SUCURSAL', 'SUPERADMIN']
    if (!rolesConVenta.includes(usuario.rol)) {
      return res.status(403).json({ error: 'Usuario sin permiso para vender', codigo: 'SIN_PERMISO_VENTA' })
    }

    let totalRecalculado = 0
    const detallesValidados = []
    for (const detalle of detalles) {
      const { productoId, cantidad, precioUnitario } = detalle
      if (!productoId || !cantidad || !precioUnitario) {
        return res.status(400).json({ error: 'Detalle incompleto', detalle })
      }
      if (cantidad <= 0) {
        return res.status(400).json({ error: 'Cantidad debe ser > 0', producto: productoId })
      }
      const subtotalDetalle = parseFloat((cantidad * precioUnitario).toFixed(2))
      totalRecalculado += subtotalDetalle
      detallesValidados.push({ productoId, cantidad: parseInt(cantidad), precioUnitario: parseFloat(precioUnitario), subtotal: subtotalDetalle })
    }
    totalRecalculado = parseFloat(totalRecalculado.toFixed(2))

    const diferencia = Math.abs(totalRecalculado - total)
    if (diferencia > 0.01) {
      return res.status(400).json({ error: 'Total no coincide', codigo: 'TOTAL_MISMATCH', backend: totalRecalculado, frontend: total, diferencia })
    }

    const inventarios = await prisma.inventarioSucursal.findMany({
      where: { sucursalId, productoId: { in: detallesValidados.map(d => d.productoId) } }
    })
    for (const detalle of detallesValidados) {
      const inventario = inventarios.find(i => i.productoId === detalle.productoId)
      if (!inventario || inventario.stockActual < detalle.cantidad) {
        const disponibles = inventario?.stockActual || 0
        return res.status(400).json({ error: `Stock insuficiente para producto ${detalle.productoId}`, codigo: 'STOCK_INSUFICIENTE', producto: detalle.productoId, disponibles, solicitados: detalle.cantidad })
      }
    }

    const folio = await generarFolio()
    let facturaEstado = 'DISPONIBLE'
    let facturaLimite = new Date()
    if (metodoPago === 'EFECTIVO' && totalRecalculado > 2000) {
      facturaEstado = 'BLOQUEADA'
      facturaLimite.setHours(facturaLimite.getHours() + 72)
    } else {
      facturaLimite.setDate(facturaLimite.getDate() + 30)
    }

    const venta = await prisma.$transaction(async (tx) => {
      const ventaCreada = await tx.venta.create({
        data: {
          folio, sucursalId, usuarioId, clienteId: clienteId || null, turnoId, metodoPago,
          subtotal: totalRecalculado, descuento: parseFloat(descuento || 0), total: totalRecalculado,
          estado: 'COMPLETADA', tokenQr: generarUUID(), facturaEstado, facturaLimite,
          detalles: {
            create: detallesValidados.map(d => ({ productoId: d.productoId, cantidad: d.cantidad, precioUnitario: d.precioUnitario, subtotal: d.subtotal, descuento: 0 }))
          }
        },
        include: { detalles: { include: { producto: true } } }
      })

      for (const detalle of detallesValidados) {
        const inventarioAnterior = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } }
        })
        const stockAntes   = inventarioAnterior.stockActual
        const stockDespues = stockAntes - detalle.cantidad
        await tx.inventarioSucursal.update({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
          data:  { stockActual: stockDespues }
        })
        await tx.movimientoInventario.create({
          data: { productoId: detalle.productoId, sucursalId, usuarioId, tipo: 'SALIDA_VENTA', cantidad: detalle.cantidad, stockAntes, stockDespues, referencia: folio }
        })
      }

      await tx.movimientoCaja.create({
        data: { turnoId, tipo: 'VENTA', monto: totalRecalculado, metodoPago, referencia: folio }
      })
      await tx.auditoria.create({
        data: { usuarioId, sucursalId, accion: 'CREAR_VENTA', modulo: 'VENTAS', referencia: folio, valorDespues: { ventaId: ventaCreada.id, total: totalRecalculado, items: detallesValidados.length } }
      })

      return ventaCreada
    })

    console.log(`✅ Venta creada: ${venta.folio} - Total: $${venta.total}`)
    res.status(201).json({ success: true, message: 'Venta registrada correctamente', data: venta })

  } catch (error) {
    console.error('❌ Error en crearVenta:', error)
    res.status(500).json({ error: 'Error al procesar venta: ' + error.message })
  }
}

/**
 * GET /ventas
 */
exports.obtenerVentas = async (req, res) => {
  try {
    const { skip = 0, take = 20, search, metodoPago, desde, hasta, turnoId, clienteId, usuarioId } = req.query
    const where = {}

    if (turnoId)   where.turnoId  = parseInt(turnoId)
    if (usuarioId) where.usuarioId = parseInt(usuarioId)

    if (clienteId === 'null') {
      where.clienteId = null
    } else if (clienteId && parseInt(clienteId) > 0) {
      where.clienteId = parseInt(clienteId)
    }

    if (search) {
      where.OR = [
        { folio: { contains: search, mode: 'insensitive' } },
        { cliente: { nombre: { contains: search, mode: 'insensitive' } } }
      ]
    }
    if (metodoPago) where.metodoPago = metodoPago

    if (desde || hasta) {
      where.creadaEn = {}
      if (desde) where.creadaEn.gte = new Date(desde)
      if (hasta) { const hastaDate = new Date(hasta); hastaDate.setHours(23, 59, 59, 999); where.creadaEn.lte = hastaDate }
    }

    const [ventas, total] = await Promise.all([
      prisma.venta.findMany({
        where, skip: parseInt(skip), take: parseInt(take), orderBy: { creadaEn: 'desc' },
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
        id:            v.id,
        folio:         v.folio,
        fecha:         v.creadaEn,
        cliente:       v.cliente ? v.cliente.nombre : 'Público general',
        usuario:       v.usuario.nombre,
        metodoPago:    v.metodoPago,
        total:         v.total,
        productosCount: v.detalles.length,
        estado:        v.estado
      })),
      total, skip: parseInt(skip), take: parseInt(take)
    })
  } catch (error) {
    console.error('❌ Error en obtenerVentas:', error)
    res.status(500).json({ error: error.message })
  }
}

/**
 * GET /ventas/:id
 */
exports.obtenerVenta = async (req, res) => {
  try {
    const { id } = req.params
    const venta = await prisma.venta.findUnique({
      where: { id: parseInt(id) },
      include: {
        usuario:  { select: { id: true, nombre: true } },
        cliente:  true,
        sucursal: true,
        detalles: { include: { producto: true } }
      }
    })
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })

    res.json({
      success: true,
      data: {
        id:           venta.id,
        folio:        venta.folio,
        fecha:        venta.creadaEn,
        usuario:      venta.usuario.nombre,
        cliente:      venta.cliente ? { id: venta.cliente.id, nombre: venta.cliente.nombre, rfc: venta.cliente.rfc } : null,
        sucursal:     venta.sucursal.nombre,
        metodoPago:   venta.metodoPago,
        subtotal:     venta.subtotal,
        iva:          venta.iva,
        descuento:    venta.descuento,
        total:        venta.total,
        estado:       venta.estado,
        tokenQr:      venta.tokenQr,
        facturaEstado: venta.facturaEstado,
        detalles: venta.detalles.map(d => ({
          productoId:    d.productoId,
          nombre:        d.producto.nombre,
          codigo:        d.producto.codigoInterno,
          cantidad:      d.cantidad,
          precioUnitario: d.precioUnitario,
          subtotal:      d.subtotal
        }))
      }
    })
  } catch (error) {
    console.error('❌ Error en obtenerVenta:', error)
    res.status(500).json({ error: error.message })
  }
}

/**
 * GET /ventas/historial/lista
 */
exports.obtenerHistorial = async (req, res) => {
  return exports.obtenerVentas(req, res)
}

// ════════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ════════════════════════════════════════════════════════════════════
async function generarFolio() {
  const fecha  = new Date()
  const año    = fecha.getFullYear()
  const mes    = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia    = String(fecha.getDate()).padStart(2, '0')
  const fechaStr = `${año}${mes}${dia}`
  const result = await prisma.$queryRaw`SELECT nextval('folio_venta_seq') as seq`
  const secuencial = String(Number(result[0].seq)).padStart(5, '0')
  return `VTA-${fechaStr}-${secuencial}`
}

function generarUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// ════════════════════════════════════════════════════════════════════
//  CANCELAR VENTA — agregar al final de ventas.controller.js
//  PATCH /ventas/:id/cancelar
// ════════════════════════════════════════════════════════════════════
exports.cancelarVenta = async (req, res) => {
  try {
    const id       = parseInt(req.params.id)
    const usuario  = req.usuario
    const { motivo } = req.body

    const venta = await prisma.venta.findUnique({
      where:   { id },
      include: { detalles: true }
    })

    if (!venta)
      return res.status(404).json({ error: 'Venta no encontrada' })

    if (venta.estado === 'CANCELADA')
      return res.status(409).json({ error: 'La venta ya está cancelada' })

    if (venta.estado === 'DEVOLUCION')
      return res.status(409).json({ error: 'Esta venta tiene devoluciones — cancela las devoluciones primero o usa el módulo de devoluciones.' })

    // Solo SUPERADMIN o ADMIN_SUCURSAL pueden cancelar
    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL']
    if (!rolesPermitidos.includes(usuario.rol))
      return res.status(403).json({ error: 'Sin permiso para cancelar ventas' })

    await prisma.$transaction(async (tx) => {
      // 1. Marcar venta como CANCELADA
      await tx.venta.update({
        where: { id },
        data:  { estado: 'CANCELADA', facturaEstado: 'BLOQUEADA' }
      })

      // 2. Reingresar stock por cada producto
      for (const detalle of venta.detalles) {
        const inv = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: venta.sucursalId } }
        })
        if (inv) {
          const stockAntes   = inv.stockActual
          const stockDespues = stockAntes + detalle.cantidad
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: venta.sucursalId } },
            data:  { stockActual: stockDespues }
          })
          await tx.movimientoInventario.create({
            data: {
              productoId:   detalle.productoId,
              sucursalId:   venta.sucursalId,
              usuarioId:    usuario.id,
              tipo:         'DEVOLUCION_ENTRADA',
              cantidad:     detalle.cantidad,
              stockAntes,
              stockDespues,
              referencia:   venta.folio,
              notas:        `Cancelación de venta ${venta.folio}`
            }
          })
        }
      }

      // 3. Movimiento de caja negativo (reversión)
      if (venta.turnoId) {
        const turno = await tx.turnoCaja.findFirst({
          where: { id: venta.turnoId }
        })
        if (turno) {
          await tx.movimientoCaja.create({
            data: {
              turnoId:    turno.id,
              tipo:       'DEVOLUCION',
              monto:      -parseFloat(venta.total),
              metodoPago: venta.metodoPago,
              referencia: venta.folio,
              notas:      motivo || `Cancelación de ${venta.folio}`
            }
          })
        }
      }

      // 4. Auditoría
      await tx.auditoria.create({
        data: {
          usuarioId:   usuario.id,
          sucursalId:  venta.sucursalId,
          accion:      'CANCELAR_VENTA',
          modulo:      'VENTAS',
          referencia:  venta.folio,
          valorAntes:  { estado: 'COMPLETADA' },
          valorDespues: { estado: 'CANCELADA', motivo: motivo || null }
        }
      })
    })

    console.log(`✅ Venta ${venta.folio} cancelada por ${usuario.nombre}`)
    res.json({ success: true, message: `Venta ${venta.folio} cancelada correctamente` })

  } catch (err) {
    console.error('❌ Error en cancelarVenta:', err)
    res.status(500).json({ error: 'Error al cancelar venta: ' + err.message })
  }
}