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

    // ── Validar referencia Ingenico si es tarjeta (opcional) ─────
    const esTarjetaPago = ['CREDITO', 'DEBITO'].includes(metodoPago)
    if (esTarjetaPago && notas) {
      const refMatch = notas.match(/^Ref\. Ingenico:\s*(\d+)$/)
      if (refMatch && (refMatch[1].length < 4 || refMatch[1].length > 6)) {
        return res.status(400).json({ error: 'N° de Autorización debe ser de 4 a 6 dígitos', codigo: 'REF_INGENICO_INVALIDA' })
      }
    }

    // ── Validar desglose de pagos mixtos ─────────────────────────
    const desglosePagos = req.body.desglosePagos || null
    if (metodoPago === 'MIXTO') {
      if (!desglosePagos || !Array.isArray(desglosePagos) || desglosePagos.length < 2) {
        return res.status(400).json({ error: 'Pago mixto requiere al menos 2 métodos de pago', codigo: 'MIXTO_MIN_2' })
      }
      const metodosPermitidos = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA']
      for (const pago of desglosePagos) {
        if (!pago.metodo || !metodosPermitidos.includes(pago.metodo)) {
          return res.status(400).json({ error: `Método inválido en desglose: ${pago.metodo}`, codigo: 'MIXTO_METODO_INVALIDO' })
        }
        if (!pago.monto || parseFloat(pago.monto) <= 0) {
          return res.status(400).json({ error: 'Cada pago debe tener monto mayor a 0', codigo: 'MIXTO_MONTO_INVALIDO' })
        }
      }
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
      const cantidadFloat   = parseFloat(cantidad)
      const subtotalDetalle = parseFloat((cantidadFloat * precioUnitario).toFixed(2))
      totalRecalculado += subtotalDetalle
      detallesValidados.push({
        productoId:     parseInt(productoId),
        cantidad:       cantidadFloat,
        precioUnitario: parseFloat(precioUnitario),
        subtotal:       subtotalDetalle
      })
    }
    totalRecalculado = parseFloat(totalRecalculado.toFixed(2))

    const totalEsperado = parseFloat((totalRecalculado - descuentoAmt).toFixed(2))
    const diferencia    = Math.abs(totalEsperado - parseFloat(total))
    if (diferencia > 0.01) {
      return res.status(400).json({ error: 'Total no coincide', codigo: 'TOTAL_MISMATCH', backend: totalEsperado, frontend: total, diferencia })
    }

    const folio = await generarFolio()
    let facturaEstado = 'DISPONIBLE'
    let facturaLimite = new Date()
    if (metodoPago === 'CREDITO_CLIENTE') {
      facturaEstado = 'BLOQUEADA'
      facturaLimite = null
    } else if (metodoPago === 'MIXTO') {
      // MIXTO: evaluar si algún pago es efectivo y total > 2000
      const tieneEfectivo = desglosePagos?.some(p => p.metodo === 'EFECTIVO')
      if (tieneEfectivo && totalEsperado > 2000) {
        facturaEstado = 'BLOQUEADA'
        facturaLimite.setHours(facturaLimite.getHours() + 72)
      } else {
        facturaLimite.setDate(facturaLimite.getDate() + 30)
      }
    } else if (metodoPago === 'EFECTIVO' && totalEsperado > 2000) {
      facturaEstado = 'BLOQUEADA'
      facturaLimite.setHours(facturaLimite.getHours() + 72)
    } else {
      facturaLimite.setDate(facturaLimite.getDate() + 30)
    }

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
        : metodoPago === 'MIXTO'
          ? parseFloat(desglosePagos.reduce((s, p) => s + parseFloat(p.monto), 0).toFixed(2))
          : totalEsperado

      // Cambio: solo sobre efectivo (individual o componente mixto)
      let cambioFinal = 0
      if (metodoPago === 'EFECTIVO' && montoPagadoFinal > totalEsperado) {
        cambioFinal = parseFloat((montoPagadoFinal - totalEsperado).toFixed(2))
      } else if (metodoPago === 'MIXTO') {
        const pagoEfectivo = desglosePagos.find(p => p.metodo === 'EFECTIVO')
        if (pagoEfectivo) {
          const sumNoEfectivo = desglosePagos.filter(p => p.metodo !== 'EFECTIVO').reduce((s, p) => s + parseFloat(p.monto), 0)
          const necesarioEfectivo = totalEsperado - sumNoEfectivo
          const sobraEfectivo = parseFloat(pagoEfectivo.monto) - necesarioEfectivo
          if (sobraEfectivo > 0.005) cambioFinal = parseFloat(sobraEfectivo.toFixed(2))
        }
      }

      const ventaCreada = await tx.venta.create({
        data: {
          folio,
          sucursal: { connect: { id: sucursalId } },
          usuario:  { connect: { id: usuarioId } },
          turno:    { connect: { id: turnoId } },
          ...(clienteId ? { cliente: { connect: { id: clienteId } } } : {}),
          metodoPago,
          subtotal: totalRecalculado,
          descuento: descuentoAmt,
          total: totalEsperado,
          montoPagado: montoPagadoFinal,
          cambio: cambioFinal,
          ...(desglosePagos ? { desglosePagos } : {}),
          notas: notas || null,
          estado: 'COMPLETADA',
          tokenQr: generarUUID(),
          facturaEstado,
          ...(facturaLimite ? { facturaLimite } : {}),
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

      // Movimiento de caja — uno por pago (MIXTO crea múltiples)
      if (!esCredito) {
        if (metodoPago === 'MIXTO' && desglosePagos) {
          for (const pago of desglosePagos) {
            await tx.movimientoCaja.create({
              data: { turnoId, tipo: 'VENTA', monto: parseFloat(pago.monto), metodoPago: pago.metodo, referencia: folio, notas: `Pago mixto: ${pago.metodo}` }
            })
          }
        } else {
          await tx.movimientoCaja.create({
            data: { turnoId, tipo: 'VENTA', monto: totalEsperado, metodoPago, referencia: folio }
          })
        }
      }

      // ──────────────────────────────────────────────────────────
      // Si es crédito: acumular en bitácora del cliente
      // Modelo A: una bitácora origen VENTA ABIERTA por cliente,
      // todas las ventas a crédito se suman a esa misma bitácora.
      // Bitácoras origen MANUAL NO se tocan desde aquí.
      // ──────────────────────────────────────────────────────────
      if (esCredito && clienteId) {
        // Obtener nombre del cliente para título auto-generado
        const clienteInfo = await tx.cliente.findUnique({
          where: { id: clienteId },
          select: { nombre: true }
        })

        // Actualizar saldo del cliente (cuenta corriente)
        await tx.cliente.update({
          where: { id: clienteId },
          data: {
            saldoPendiente:    { increment: totalEsperado },
            totalCreditoUsado: { increment: totalEsperado }
          }
        })

        // Buscar bitácora origen VENTA ABIERTA del cliente
        let bitacora = await tx.bitacora.findFirst({
          where: { clienteId, estado: 'ABIERTA', origen: 'VENTA' }
        })

        if (bitacora) {
          // EXISTE → sumar totales a la bitácora existente
          bitacora = await tx.bitacora.update({
            where: { id: bitacora.id },
            data: {
              totalMateriales: { increment: totalEsperado },
              saldoPendiente:  { increment: totalEsperado }
            }
          })
        } else {
          // NO EXISTE → crear nueva bitácora acumulativa (origen VENTA)
          const fechaBit  = new Date()
          const seqBitRes = await tx.$queryRaw`SELECT nextval('folio_bitacora_seq') as seq`
          const folioBit  = `BIT-${fechaBit.getFullYear()}${String(fechaBit.getMonth()+1).padStart(2,'0')}${String(fechaBit.getDate()).padStart(2,'0')}-${String(Number(seqBitRes[0].seq)).padStart(5,'0')}`
          bitacora = await tx.bitacora.create({
            data: {
              folio:           folioBit,
              titulo:          `Crédito — ${clienteInfo?.nombre || 'Cliente'}`,
              origen:          'VENTA',
              clienteId,
              sucursalId,
              usuarioId,
              estado:          'ABIERTA',
              totalMateriales: totalEsperado,
              totalAbonado:    0,
              saldoPendiente:  totalEsperado,
              notas:           'Cuenta corriente — crédito a cliente'
            }
          })
        }

        // Agregar detalles de esta venta a la bitácora (siempre, exista o no)
        for (const d of detallesValidados) {
          await tx.detalleBitacora.create({
            data: {
              bitacoraId:           bitacora.id,
              ventaId:              ventaCreada.id,
              productoId:           d.productoId,
              cantidad:             d.cantidad,
              precioUnitario:       d.precioUnitario,
              subtotal:             d.subtotal,
              inventarioDescontado: true,              // ya se descontó en la venta
              notas:                `Venta ${folio}`
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
        clienteId:      v.clienteId,
        usuario:        v.usuario.nombre,
        metodoPago:     v.metodoPago,
        total:          v.total,
        productosCount: v.detalles.length,
        estado:         v.estado,
        facturaEstado:  v.facturaEstado
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
        desglosePagos: venta.desglosePagos || null,
        notas:         venta.notas,
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
    const usuario = req.usuario   // ← usa req.usuario (middleware JWT de JESHA)
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
          if (venta.metodoPago === 'MIXTO' && venta.desglosePagos) {
            // MIXTO: un movimiento de devolución por cada pago original
            for (const pago of venta.desglosePagos) {
              await tx.movimientoCaja.create({
                data: {
                  turnoId:    turno.id,
                  tipo:       'DEVOLUCION',
                  monto:      -parseFloat(pago.monto),
                  metodoPago: pago.metodo,
                  referencia: venta.folio,
                  notas:      motivo || `Cancelación mixto ${pago.metodo} — ${venta.folio}`
                }
              })
            }
          } else {
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

// ════════════════════════════════════════════════════════════════════
//  PATCH /ventas/:id/metodo-pago — Actualizar método de pago
//
//  FIX vs versión anterior:
//  1. Usa req.usuario (consistente con cancelarVenta)
//  2. MovimientoCaja usa turnoId (del schema real), NO cajaId/conceptoTipo
//  3. facturaEstado desbloqueo va a 'DISPONIBLE', NO a null
//  4. deleteMany filtra por tipo:'VENTA' para no borrar devoluciones
//  5. Permisos: solo SUPERADMIN y ADMIN_SUCURSAL pueden editar método
// ════════════════════════════════════════════════════════════════════
exports.actualizarMetodoPago = async (req, res) => {
  try {
    const ventaId  = parseInt(req.params.id)
    const usuario  = req.usuario   // ← consistente con cancelarVenta
    const { nuevoMetodo } = req.body

    if (!usuario) {
      return res.status(401).json({ error: 'Usuario no autenticado' })
    }

    // ── Solo SUPERADMIN y ADMIN_SUCURSAL pueden cambiar el método ──
    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL']
    if (!rolesPermitidos.includes(usuario.rol)) {
      return res.status(403).json({ error: 'Sin permiso para editar el método de pago' })
    }

    // ── Validar método válido ──
    const metodosValidos = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA', 'CREDITO_CLIENTE']
    if (!metodosValidos.includes(nuevoMetodo)) {
      return res.status(400).json({ error: 'Método de pago inválido' })
    }

    // ── Obtener venta ──
    const venta = await prisma.venta.findUnique({
      where:   { id: ventaId },
      include: { cliente: true }
    })

    if (!venta) {
      return res.status(404).json({ error: 'Venta no encontrada' })
    }

    // ── Bloquear edición de ventas MIXTO ──
    if (venta.metodoPago === 'MIXTO') {
      return res.status(400).json({ error: 'No se puede cambiar el método de pago de una venta con pago mixto. Cancela y crea una nueva.', codigo: 'MIXTO_NO_EDITABLE' })
    }

    // ── Validar sucursal (SUPERADMIN puede editar todas) ──
    if (usuario.sucursalId && venta.sucursalId !== usuario.sucursalId) {
      return res.status(403).json({ error: 'No tienes permiso para editar esta venta' })
    }

    // ── VALIDACIÓN 1: Factura ya emitida ──
    if (venta.facturaEstado === 'FACTURADA' || venta.facturaEstado === 'TIMBRADA') {
      return res.status(400).json({ error: 'No se puede cambiar el método de pago de una venta ya facturada' })
    }

    // ── VALIDACIÓN 2: Venta cancelada ──
    if (venta.estado === 'CANCELADA') {
      return res.status(400).json({ error: 'No se puede editar una venta cancelada' })
    }

    // ── VALIDACIÓN 3: Sin cambio real ──
    if (venta.metodoPago === nuevoMetodo) {
      return res.json({ message: 'El método de pago ya es el seleccionado', venta })
    }

    // ── VALIDACIÓN 4: Crédito sin cliente ──
    if (nuevoMetodo === 'CREDITO_CLIENTE' && !venta.clienteId) {
      return res.status(400).json({ error: 'No se puede cambiar a crédito cliente sin un cliente registrado en la venta' })
    }

    // ── VALIDACIÓN 5: Límite de crédito ──
    if (nuevoMetodo === 'CREDITO_CLIENTE' && venta.clienteId && venta.metodoPago !== 'CREDITO_CLIENTE') {
      const cliente    = venta.cliente
      const montoVenta = parseFloat(venta.total)
      const nuevoSaldo = parseFloat(cliente.saldoPendiente) + montoVenta

      if (nuevoSaldo > parseFloat(cliente.limiteCredito)) {
        return res.status(400).json({
          error: `Excede límite de crédito. Límite: $${parseFloat(cliente.limiteCredito).toFixed(2)}, Saldo actual: $${parseFloat(cliente.saldoPendiente).toFixed(2)}, Incremento: $${montoVenta.toFixed(2)}`
        })
      }
    }

    // ════════════════════════════════════════════════════════════════
    //  TRANSACCIÓN
    // ════════════════════════════════════════════════════════════════
    const metodoAnterior = venta.metodoPago
    const total          = parseFloat(venta.total)

    // Métodos que generan MovimientoCaja tipo VENTA
    const metodosConMovimiento = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA']
    const anteriorTeniaMovimiento = metodosConMovimiento.includes(metodoAnterior)
    const nuevoTieneMovimiento    = metodosConMovimiento.includes(nuevoMetodo)

    const result = await prisma.$transaction(async (tx) => {

      // ── PASO 1: Manejar MovimientoCaja ──────────────────────────
      if (anteriorTeniaMovimiento && !nuevoTieneMovimiento) {
        // EFECTIVO/TARJETA/TRANSFERENCIA → CREDITO_CLIENTE
        // Eliminar el movimiento de caja de la venta original
        // Filtramos por referencia (folio) Y tipo VENTA para no tocar devoluciones
        await tx.movimientoCaja.deleteMany({
          where: {
            referencia: venta.folio,
            tipo:       'VENTA'
          }
        })
      } else if (!anteriorTeniaMovimiento && nuevoTieneMovimiento) {
        // CREDITO_CLIENTE → EFECTIVO/TARJETA/TRANSFERENCIA
        // Crear MovimientoCaja en el turno de la venta
        const turno = await tx.turnoCaja.findUnique({
          where: { id: venta.turnoId }
        })
        if (!turno) {
          throw new Error('No se encontró el turno de la venta')
        }

        await tx.movimientoCaja.create({
          data: {
            turnoId:    turno.id,
            tipo:       'VENTA',
            monto:      total,
            metodoPago: nuevoMetodo,
            referencia: venta.folio,
            notas:      `Cambio de método: ${metodoAnterior} → ${nuevoMetodo} (por ${usuario.nombre})`
          }
        })
      } else if (anteriorTeniaMovimiento && nuevoTieneMovimiento && metodoAnterior !== nuevoMetodo) {
        // EFECTIVO → TARJETA o similar: actualizar metodoPago en el movimiento existente
        await tx.movimientoCaja.updateMany({
          where: {
            referencia: venta.folio,
            tipo:       'VENTA'
          },
          data: {
            metodoPago: nuevoMetodo,
            notas:      `Método actualizado: ${metodoAnterior} → ${nuevoMetodo} (por ${usuario.nombre})`
          }
        })
      }

      // ── PASO 2: Actualizar saldo del cliente ────────────────────
      if (venta.clienteId) {
        const esAhoraCreditoCliente  = nuevoMetodo    === 'CREDITO_CLIENTE'
        const eraAntesCreditoCliente = metodoAnterior === 'CREDITO_CLIENTE'

        if (esAhoraCreditoCliente && !eraAntesCreditoCliente) {
          // Cambió A crédito → incrementar saldo pendiente
          await tx.cliente.update({
            where: { id: venta.clienteId },
            data:  { saldoPendiente: { increment: total } }
          })
        } else if (!esAhoraCreditoCliente && eraAntesCreditoCliente) {
          // Cambió DESDE crédito → decrementar saldo pendiente
          await tx.cliente.update({
            where: { id: venta.clienteId },
            data:  { saldoPendiente: { decrement: total } }
          })
        }
      }

      // ── PASO 3: Recalcular facturaEstado ────────────────────────
      // FIX: 'DISPONIBLE' en lugar de null — facturaEstado es enum, null no es válido
      let nuevoFacturaEstado = venta.facturaEstado

      if (nuevoMetodo === 'CREDITO_CLIENTE') {
        nuevoFacturaEstado = 'BLOQUEADA'
      } else if (nuevoMetodo === 'EFECTIVO' && total > 2000) {
        nuevoFacturaEstado = 'BLOQUEADA'
      } else if (venta.facturaEstado === 'BLOQUEADA') {
        // Estaba bloqueada por método anterior y ahora ya no aplica → desbloquear
        nuevoFacturaEstado = 'DISPONIBLE'
      }
      // Si estaba DISPONIBLE/VENCIDA/CANCELADA y el nuevo método no bloquea → sin cambio

      // ── PASO 4: Actualizar venta ─────────────────────────────────
      const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
      const notaAudit = `[${timestamp}] Método cambiado: ${metodoAnterior} → ${nuevoMetodo} (por ${usuario.nombre})`

      const ventaActualizada = await tx.venta.update({
        where: { id: ventaId },
        data: {
          metodoPago:    nuevoMetodo,
          facturaEstado: nuevoFacturaEstado,
          notas:         venta.notas ? `${venta.notas}\n${notaAudit}` : notaAudit
        },
        include: {
          cliente:  { select: { nombre: true } },
          usuario:  { select: { nombre: true } },
          sucursal: { select: { nombre: true } },
          detalles: { include: { producto: { select: { nombre: true, codigoInterno: true } } } }
        }
      })

      // ── PASO 5: Auditoria ────────────────────────────────────────
      await tx.auditoria.create({
        data: {
          usuarioId:    usuario.id,
          sucursalId:   venta.sucursalId,
          accion:       'EDITAR_METODO_PAGO',
          modulo:       'VENTAS',
          referencia:   venta.folio,
          valorAntes:   { metodoPago: metodoAnterior, facturaEstado: venta.facturaEstado },
          valorDespues: { metodoPago: nuevoMetodo,    facturaEstado: nuevoFacturaEstado  }
        }
      })

      return ventaActualizada
    })

    res.json({ message: 'Método de pago actualizado correctamente', venta: result })

  } catch (err) {
    console.error('❌ Error en actualizarMetodoPago:', err)
    res.status(500).json({ error: err.message || 'Error al actualizar método de pago' })
  }
}