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
    const sucursalId = parseInt(req.body.sucursalId)
    const usuarioId  = parseInt(req.body.usuarioId)
    const turnoId    = parseInt(req.body.turnoId)
    const { metodoPago, subtotal, iva, descuento, total, detalles, notas, montoPagado: montoPagadoRaw } = req.body
    const clienteId  = req.body.clienteId ? parseInt(req.body.clienteId) : null

    if (!sucursalId || isNaN(sucursalId) || !usuarioId || isNaN(usuarioId) || !turnoId || isNaN(turnoId) || !metodoPago) {
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

    // ── Validar descuento por rol ──────────────────────────────────
    const descuentoAmt = parseFloat(parseFloat(descuento || 0).toFixed(2))
    if (descuentoAmt > 0 && usuario.rol === 'EMPLEADO') {
      return res.status(403).json({ error: 'Sin permiso para aplicar descuentos', codigo: 'SIN_PERMISO_DESCUENTO' })
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
      // FIX: parseFloat para soportar cantidades decimales (productos granel)
      const cantidadFloat   = parseFloat(cantidad)
      const subtotalDetalle = parseFloat((cantidadFloat * precioUnitario).toFixed(2))
      totalRecalculado += subtotalDetalle
      detallesValidados.push({
        productoId:     parseInt(productoId),
        cantidad:       cantidadFloat,           // ← era parseInt, rompía granel
        precioUnitario: parseFloat(precioUnitario),
        subtotal:       subtotalDetalle
      })
    }
    totalRecalculado = parseFloat(totalRecalculado.toFixed(2))

    // Restar descuento antes de comparar
    const totalEsperado = parseFloat((totalRecalculado - descuentoAmt).toFixed(2))
    const diferencia    = Math.abs(totalEsperado - parseFloat(total))
    if (diferencia > 0.01) {
      return res.status(400).json({ error: 'Total no coincide', codigo: 'TOTAL_MISMATCH', backend: totalEsperado, frontend: total, diferencia })
    }

    const folio = await generarFolio()
    let facturaEstado = 'DISPONIBLE'
    let facturaLimite = new Date()
    if (metodoPago === 'EFECTIVO' && totalEsperado > 2000) {
      facturaEstado = 'BLOQUEADA'
      facturaLimite.setHours(facturaLimite.getHours() + 72)
    } else {
      facturaLimite.setDate(facturaLimite.getDate() + 30)
    }

    // Crédito cliente — validación previa (confirma disponibilidad antes de abrir tx)
    const esCredito = req.body.esCreditoCliente === true || req.body.esCreditoCliente === 'true'
                   || req.body.esCredito === true        || metodoPago === 'CREDITO_CLIENTE'
    let clienteCredito = null
    if (esCredito) {
      if (!clienteId) return res.status(400).json({ error: 'Se requiere cliente para venta a crédito' })
      clienteCredito = await prisma.cliente.findUnique({ where: { id: clienteId } })
      if (!clienteCredito) return res.status(404).json({ error: 'Cliente no encontrado' })
      if (clienteCredito.tipo !== 'REGISTRADO') return res.status(400).json({ error: 'Solo clientes REGISTRADO pueden comprar a crédito' })
      const disponible = parseFloat(clienteCredito.limiteCredito) - parseFloat(clienteCredito.saldoPendiente)
      if (disponible < totalEsperado) return res.status(400).json({ error: 'Crédito insuficiente', disponible, totalRequerido: totalEsperado })
    }

    const venta = await prisma.$transaction(async (tx) => {
      // ── Validar stock DENTRO de la transacción ──
      const inventarios = await tx.inventarioSucursal.findMany({
        where: { sucursalId, productoId: { in: detallesValidados.map(d => d.productoId) } }
      })

      const productosInfo = await tx.producto.findMany({
        where:  { id: { in: detallesValidados.map(d => d.productoId) } },
        select: { id: true, nombre: true }
      })
      const nombreProd = Object.fromEntries(productosInfo.map(p => [p.id, p.nombre]))

      const sinStock = []
      for (const detalle of detallesValidados) {
        const inventario  = inventarios.find(i => parseInt(i.productoId) === parseInt(detalle.productoId))
        const disponibles = inventario ? parseFloat(inventario.stockActual) : 0
        if (!inventario || disponibles < detalle.cantidad) {
          sinStock.push({
            productoId:  detalle.productoId,
            nombre:      nombreProd[detalle.productoId] || `Producto ${detalle.productoId}`,
            disponibles,
            solicitados: detalle.cantidad
          })
        }
      }

      if (sinStock.length > 0) {
        const err = new Error('Stock insuficiente')
        err.status   = 400
        err.codigo   = 'STOCK_INSUFICIENTE'
        err.sinStock = sinStock
        throw err
      }

      const montoPagadoFinal = metodoPago === 'EFECTIVO'
        ? parseFloat(parseFloat(montoPagadoRaw || 0).toFixed(2))
        : totalEsperado
      const cambioFinal = metodoPago === 'EFECTIVO' && montoPagadoFinal > totalEsperado
        ? parseFloat((montoPagadoFinal - totalEsperado).toFixed(2))
        : 0

      const ventaCreada = await tx.venta.create({
        data: {
          folio, sucursalId, usuarioId, clienteId: clienteId || null, turnoId, metodoPago,
          subtotal: totalRecalculado, descuento: descuentoAmt, total: totalEsperado,
          montoPagado: montoPagadoFinal, cambio: cambioFinal,
          notas: notas || null,
          estado: 'COMPLETADA', tokenQr: generarUUID(), facturaEstado, facturaLimite,
          detalles: {
            create: detallesValidados.map(d => ({
              productoId:     d.productoId,
              cantidad:       d.cantidad,
              precioUnitario: d.precioUnitario,
              subtotal:       d.subtotal,
              descuento:      0
            }))
          }
        },
        include: { detalles: { include: { producto: true } } }
      })

      for (const detalle of detallesValidados) {
        const inventarioAnterior = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } }
        })
        if (!inventarioAnterior) {
          throw Object.assign(
            new Error(`Registro de inventario no encontrado para producto ${detalle.productoId}`),
            { status: 400, codigo: 'INV_NOT_FOUND' }
          )
        }
        const stockAntes   = parseFloat(inventarioAnterior.stockActual)
        const stockDespues = parseFloat((stockAntes - detalle.cantidad).toFixed(3))
        await tx.inventarioSucursal.update({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
          data:  { stockActual: stockDespues }
        })
        await tx.movimientoInventario.create({
          data: {
            productoId:   detalle.productoId,
            sucursalId,
            usuarioId,
            tipo:         'SALIDA_VENTA',
            cantidad:     detalle.cantidad,
            stockAntes,
            stockDespues,
            referencia:   folio
          }
        })
      }

      // Movimiento de caja solo si NO es crédito cliente
      if (!esCredito) {
        await tx.movimientoCaja.create({
          data: { turnoId, tipo: 'VENTA', monto: totalEsperado, metodoPago, referencia: folio }
        })
      }

      // Si es crédito: actualizar saldo cliente + crear bitácora automática
      if (esCredito && clienteId) {
        await tx.cliente.update({
          where: { id: clienteId },
          data: {
            saldoPendiente:    { increment: totalEsperado },
            totalCreditoUsado: { increment: totalEsperado }
          }
        })
        const fechaBit  = new Date()
        const seqBitRes = await tx.$queryRaw`SELECT nextval('folio_bitacora_seq') as seq`
        const folioBit  = `BIT-${fechaBit.getFullYear()}${String(fechaBit.getMonth()+1).padStart(2,'0')}${String(fechaBit.getDate()).padStart(2,'0')}-${String(Number(seqBitRes[0].seq)).padStart(5,'0')}`
        const bitacoraCreada = await tx.bitacora.create({
          data: {
            folio:           folioBit,
            titulo:          `Crédito — ${folio}`,
            descripcion:     `Venta a crédito por $${totalEsperado.toFixed(2)}`,
            clienteId,
            sucursalId,
            usuarioId,
            estado:          'ABIERTA',
            totalMateriales: totalEsperado,
            totalAbonado:    0,
            saldoPendiente:  totalEsperado,
            ventaId:         ventaCreada.id,
            notas:           'Generada automáticamente — crédito a cliente'
          }
        })
        for (const d of detallesValidados) {
          await tx.detalleBitacora.create({
            data: {
              bitacoraId:           bitacoraCreada.id,
              productoId:           d.productoId,
              cantidad:             d.cantidad,
              precioUnitario:       d.precioUnitario,
              subtotal:             d.subtotal,
              inventarioDescontado: false,
              notas:                'Importado automáticamente desde venta ' + folio
            }
          })
        }
      }

      await tx.auditoria.create({
        data: {
          usuarioId,
          sucursalId,
          accion:      'CREAR_VENTA',
          modulo:      'VENTAS',
          referencia:  folio,
          valorDespues: { ventaId: ventaCreada.id, total: totalEsperado, items: detallesValidados.length, esCredito }
        }
      })

      return ventaCreada
    })

    console.log(`✅ Venta creada: ${venta.folio} - Total: $${venta.total}`)
    res.status(201).json({ success: true, message: 'Venta registrada correctamente', data: venta })

  } catch (error) {
    console.error('❌ Error en crearVenta:', error)
    const status = error.status === 400 ? 400 : 500
    res.status(status).json({
      error:    error.message,
      codigo:   error.codigo   || null,
      sinStock: error.sinStock || null
    })
  }
}

/**
 * GET /ventas
 */
exports.obtenerVentas = async (req, res) => {
  try {
    const { skip = 0, take = 20, search, metodoPago, desde, hasta, turnoId, clienteId, usuarioId } = req.query
    const where = {}

    if (turnoId)   where.turnoId   = parseInt(turnoId)
    if (usuarioId) where.usuarioId = parseInt(usuarioId)

    if (clienteId === 'null') {
      where.clienteId = null
    } else if (clienteId && parseInt(clienteId) > 0) {
      where.clienteId = parseInt(clienteId)
    }

    if (search) {
      where.OR = [
        { folio:   { contains: search, mode: 'insensitive' } },
        { cliente: { nombre: { contains: search, mode: 'insensitive' } } }
      ]
    }
    if (metodoPago) where.metodoPago = metodoPago

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
        id:             v.id,
        folio:          v.folio,
        fecha:          v.creadaEn,
        cliente:        v.cliente ? v.cliente.nombre : 'Público general',
        usuario:        v.usuario.nombre,
        metodoPago:     v.metodoPago,
        total:          v.total,
        productosCount: v.detalles.length,
        estado:         v.estado
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
        id:            venta.id,
        folio:         venta.folio,
        fecha:         venta.creadaEn,
        usuario:       venta.usuario.nombre,
        cliente:       venta.cliente ? { id: venta.cliente.id, nombre: venta.cliente.nombre, rfc: venta.cliente.rfc } : null,
        sucursal:      venta.sucursal.nombre,
        metodoPago:    venta.metodoPago,
        subtotal:      venta.subtotal,
        iva:           venta.iva,
        descuento:     venta.descuento,
        total:         venta.total,
        montoPagado:   venta.montoPagado,
        cambio:        venta.cambio,
        estado:        venta.estado,
        tokenQr:       venta.tokenQr,
        facturaEstado: venta.facturaEstado,
        detalles: venta.detalles.map(d => ({
          productoId:     d.productoId,
          nombre:         d.producto.nombre,
          codigo:         d.producto.codigoInterno,
          cantidad:       d.cantidad,
          precioUnitario: d.precioUnitario,
          subtotal:       d.subtotal
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
  const fecha    = new Date()
  const año      = fecha.getFullYear()
  const mes      = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia      = String(fecha.getDate()).padStart(2, '0')
  const fechaStr = `${año}${mes}${dia}`
  const result   = await prisma.$queryRaw`SELECT nextval('folio_venta_seq') as seq`
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
//  CANCELAR VENTA
//  PATCH /ventas/:id/cancelar
// ════════════════════════════════════════════════════════════════════
exports.cancelarVenta = async (req, res) => {
  try {
    const id      = parseInt(req.params.id)
    const usuario = req.usuario
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

    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL']
    if (!rolesPermitidos.includes(usuario.rol))
      return res.status(403).json({ error: 'Sin permiso para cancelar ventas' })

    await prisma.$transaction(async (tx) => {
      await tx.venta.update({
        where: { id },
        data:  { estado: 'CANCELADA', facturaEstado: 'BLOQUEADA' }
      })

      for (const detalle of venta.detalles) {
        const inv = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: venta.sucursalId } }
        })
        if (inv) {
          const stockAntes   = parseFloat(inv.stockActual)
          const stockDespues = parseFloat((stockAntes + parseFloat(detalle.cantidad)).toFixed(3))
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
              cantidad:     parseFloat(detalle.cantidad),
              stockAntes,
              stockDespues,
              referencia:   venta.folio,
              notas:        `Cancelación de venta ${venta.folio}`
            }
          })
        }
      }

      if (venta.turnoId) {
        const turno = await tx.turnoCaja.findFirst({ where: { id: venta.turnoId } })
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

      await tx.auditoria.create({
        data: {
          usuarioId:    usuario.id,
          sucursalId:   venta.sucursalId,
          accion:       'CANCELAR_VENTA',
          modulo:       'VENTAS',
          referencia:   venta.folio,
          valorAntes:   { estado: 'COMPLETADA' },
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
// generarFolioBitacora eliminada — usa folio_bitacora_seq directamente