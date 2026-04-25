// ════════════════════════════════════════════════════════════════════
//  DEVOLUCIONES CONTROLLER
//  Ubicación: src/modules/devoluciones/devoluciones.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

async function registrarAudit(usuarioId, sucursalId, referencia, detalleExtra) {
  try {
    await prisma.auditoria.create({
      data: { usuarioId, sucursalId, accion: 'CREAR_DEVOLUCION', modulo: 'devoluciones', referencia, valorDespues: detalleExtra }
    })
  } catch (e) { console.error('Audit error devoluciones:', e.message) }
}

async function generarFolioDevolucion() {
  const fecha  = new Date()
  const año    = fecha.getFullYear()
  const mes    = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia    = String(fecha.getDate()).padStart(2, '0')
  const result = await prisma.$queryRaw`SELECT nextval('folio_devolucion_seq') as seq`
  const sec    = String(Number(result[0].seq)).padStart(5, '0')
  return `DEV-${año}${mes}${dia}-${sec}`
}

// ════════════════════════════════════════════════════════════════════
//  POST /devoluciones
// ════════════════════════════════════════════════════════════════════
exports.crear = async (req, res) => {
  try {
    const { ventaId, motivo, tipoReembolso, productos, notas } = req.body
    const solicitante = req.usuario

    if (!ventaId || !motivo || !tipoReembolso || !productos?.length) {
      return res.status(400).json({ error: 'Faltan campos requeridos', requeridos: ['ventaId', 'motivo', 'tipoReembolso', 'productos'] })
    }

    const TIPOS_VALIDOS = ['REEMBOLSO', 'CAMBIO_PRODUCTO', 'CAMBIO_PARCIAL']
    if (!TIPOS_VALIDOS.includes(tipoReembolso)) {
      return res.status(400).json({ error: `tipoReembolso inválido. Use: ${TIPOS_VALIDOS.join(', ')}` })
    }

    const venta = await prisma.venta.findUnique({
      where:   { id: parseInt(ventaId) },
      include: { detalles: true, devoluciones: { include: { detalles: true } } }
    })

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })
    if (venta.estado === 'CANCELADA') {
      return res.status(409).json({ error: 'No se puede devolver una venta cancelada' })
    }

    const horasTranscurridas = (Date.now() - new Date(venta.creadaEn).getTime()) / 36e5
    const fueraDeTiempo      = horasTranscurridas > 72

    // Calcular ya devuelto por producto
    const yaDevuelto = {}
    for (const dev of venta.devoluciones) {
      for (const det of dev.detalles) {
        yaDevuelto[det.productoId] = (yaDevuelto[det.productoId] || 0) + det.cantidad
      }
    }

    let montoReembolso = 0
    const detallesValidados = []

    for (const item of productos) {
      const { productoId, cantidad } = item
      if (!productoId || !cantidad || cantidad <= 0) {
        return res.status(400).json({ error: 'Cada producto requiere productoId y cantidad > 0' })
      }
      const detalleOriginal = venta.detalles.find(d => d.productoId === parseInt(productoId))
      if (!detalleOriginal) {
        return res.status(400).json({ error: `Producto ${productoId} no pertenece a esta venta` })
      }
      const cantidadYaDevuelta = yaDevuelto[parseInt(productoId)] || 0
      const cantidadDisponible = detalleOriginal.cantidad - cantidadYaDevuelta
      if (parseInt(cantidad) > cantidadDisponible) {
        return res.status(409).json({ error: 'Cantidad excede lo disponible para devolver', productoId, vendidos: detalleOriginal.cantidad, yaDevueltos: cantidadYaDevuelta, disponibles: cantidadDisponible, solicitados: parseInt(cantidad) })
      }
      montoReembolso += parseFloat(detalleOriginal.precioUnitario) * parseInt(cantidad)
      detallesValidados.push({ productoId: parseInt(productoId), cantidad: parseInt(cantidad), precioUnitario: parseFloat(detalleOriginal.precioUnitario), sucursalId: venta.sucursalId })
    }

    montoReembolso = parseFloat(montoReembolso.toFixed(2))
    const folio    = await generarFolioDevolucion()

    // ── Determinar si la devolución es total o parcial ──────────
    // Total vendido por producto
    const totalVendido = {}
    for (const det of venta.detalles) {
      totalVendido[det.productoId] = det.cantidad
    }
    // Total devuelto INCLUYENDO esta nueva devolución
    const totalDevueltoFinal = { ...yaDevuelto }
    for (const det of detallesValidados) {
      totalDevueltoFinal[det.productoId] = (totalDevueltoFinal[det.productoId] || 0) + det.cantidad
    }
    const nuevoEstadoVenta = 'DEVOLUCION'

    // ── Verificar turno activo ───────────────────────────────────
    const turnoActivo = await prisma.turnoCaja.findFirst({
      where: { sucursalId: venta.sucursalId, abierto: true }
    })
    const sinTurno = !turnoActivo

    if (sinTurno) {
      console.warn(`⚠️ Devolución ${folio} SIN turno activo. Egreso de caja ($${montoReembolso}) NO registrado.`)
    }

    // ── Si la venta era a crédito, descontar de la bitácora ─────
    // Se valida ANTES de la transacción para fallar rápido sin tocar nada.
    let bitacoraVenta = null
    if (venta.metodoPago === 'CREDITO_CLIENTE' && venta.clienteId) {
      bitacoraVenta = await prisma.bitacora.findFirst({
        where: { clienteId: venta.clienteId, estado: 'ABIERTA', origen: 'VENTA' },
        select: { id: true, folio: true, totalMateriales: true, saldoPendiente: true, totalAbonado: true, notas: true }
      })

      if (bitacoraVenta) {
        const saldoActual = parseFloat(bitacoraVenta.saldoPendiente)
        if (montoReembolso > saldoActual + 0.005) {
          return res.status(400).json({
            error: `No se puede devolver $${montoReembolso.toFixed(2)}: la bitácora ${bitacoraVenta.folio} solo tiene saldo pendiente de $${saldoActual.toFixed(2)}. El excedente debe manejarse fuera del sistema.`,
            codigo: 'EXCEDE_SALDO_BITACORA',
            saldoBitacora: saldoActual,
            montoSolicitado: montoReembolso,
            folioBitacora: bitacoraVenta.folio
          })
        }
      }
    }

    // ── Transacción atómica ─────────────────────────────────────
    const devolucion = await prisma.$transaction(async (tx) => {

      const devCreada = await tx.devolucion.create({
        data: {
          ventaId:             parseInt(ventaId),
          sucursalId:          venta.sucursalId,
          usuarioId:           solicitante.id,
          motivo,
          tipoReembolso,
          montoReembolso,
          reintegraInventario: true,
          notas:               notas || null,
          detalles: {
            create: detallesValidados.map(d => ({
              productoId:     d.productoId,
              cantidad:       d.cantidad,
              precioUnitario: d.precioUnitario
            }))
          }
        },
        include: {
          detalles: { include: { producto: { select: { id: true, nombre: true } } } },
          usuario:  { select: { id: true, nombre: true } },
          venta:    { select: { folio: true, metodoPago: true } }
        }
      })

      // Reingresar inventario
      for (const det of detallesValidados) {
        const inv = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: det.productoId, sucursalId: det.sucursalId } }
        })
        if (inv) {
          const stockAntes   = inv.stockActual
          const stockDespues = stockAntes + det.cantidad
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: det.productoId, sucursalId: det.sucursalId } },
            data:  { stockActual: stockDespues }
          })
          await tx.movimientoInventario.create({
            data: { productoId: det.productoId, sucursalId: det.sucursalId, usuarioId: solicitante.id, tipo: 'DEVOLUCION_ENTRADA', cantidad: det.cantidad, stockAntes, stockDespues, referencia: folio, notas: `Devolución de ${venta.folio}` }
          })
        }
      }

      // Movimiento de caja
      if (!sinTurno && (tipoReembolso === 'REEMBOLSO' || tipoReembolso === 'CAMBIO_PARCIAL')) {
        await tx.movimientoCaja.create({
          data: { turnoId: turnoActivo.id, tipo: 'DEVOLUCION', monto: -montoReembolso, metodoPago: venta.metodoPago, referencia: folio, notas: `Devolución de ${venta.folio} — ${motivo}` }
        })
      }

      // ── ACTUALIZAR ESTADO DE LA VENTA ─────────────────────────
      await tx.venta.update({
        where: { id: parseInt(ventaId) },
        data:  { estado: nuevoEstadoVenta }
      })

      // ── ACTUALIZAR BITÁCORA SI APLICA (venta a crédito) ───────
      if (bitacoraVenta) {
        // 1. Reducir cantidad/subtotal en DetalleBitacora por cada producto devuelto
        for (const det of detallesValidados) {
          // Buscar todos los DetalleBitacora de esta venta+producto (suele ser 1 por producto)
          const detallesBit = await tx.detalleBitacora.findMany({
            where: { bitacoraId: bitacoraVenta.id, ventaId: parseInt(ventaId), productoId: det.productoId },
            orderBy: { creadoEn: 'asc' }
          })

          let cantidadADescontar = det.cantidad
          for (const detBit of detallesBit) {
            if (cantidadADescontar <= 0) break
            const cantActual = parseFloat(detBit.cantidad)
            const descontar  = Math.min(cantActual, cantidadADescontar)
            const nuevaCant  = cantActual - descontar
            const nuevoSub   = parseFloat((nuevaCant * parseFloat(detBit.precioUnitario)).toFixed(2))

            await tx.detalleBitacora.update({
              where: { id: detBit.id },
              data: {
                cantidad: nuevaCant,
                subtotal: nuevoSub
              }
            })
            cantidadADescontar -= descontar
          }
        }

        // 2. Reducir totales de la bitácora
        const nuevoTotalMat = parseFloat((parseFloat(bitacoraVenta.totalMateriales) - montoReembolso).toFixed(2))
        const nuevoSaldo    = parseFloat((parseFloat(bitacoraVenta.saldoPendiente)  - montoReembolso).toFixed(2))

        // 3. Construir nueva nota agregada
        const fechaCorta = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
        const lineaNueva = `[${fechaCorta}] ${folio}: ${motivo} (-$${montoReembolso.toFixed(2)})`
        const notasFinal = bitacoraVenta.notas
          ? `${bitacoraVenta.notas}\n${lineaNueva}`
          : lineaNueva

        // 4. Si se devolvió todo (totalMateriales = 0), cerrar bitácora automáticamente
        const cerrarBitacora = nuevoTotalMat <= 0.005

        const updateBitData = {
          totalMateriales: Math.max(0, nuevoTotalMat),
          saldoPendiente:  Math.max(0, nuevoSaldo),
          notas:           notasFinal
        }

        if (cerrarBitacora) {
          updateBitData.estado        = 'CERRADA_VENTA'
          updateBitData.cerradaEn     = new Date()
          updateBitData.saldoAlCerrar = Math.max(0, nuevoSaldo)
        }

        await tx.bitacora.update({
          where: { id: bitacoraVenta.id },
          data:  updateBitData
        })

        // 5. Actualizar saldo del cliente
        await tx.cliente.update({
          where: { id: venta.clienteId },
          data:  { saldoPendiente: { decrement: montoReembolso } }
        })
      }

      return devCreada
    })

    await registrarAudit(solicitante.id, venta.sucursalId, folio, {
      devolucionId:       devolucion.id,
      ventaFolio:         venta.folio,
      tipoReembolso,
      monto:              montoReembolso,
      productos:          detallesValidados.length,
      fueraDeTiempo,
      sinTurnoAlDevolver: sinTurno,
      estadoVentaResultante: nuevoEstadoVenta,
      bitacoraAfectada:   bitacoraVenta?.folio || null
    })

    console.log(`✅ Devolución ${folio} — Venta: ${venta.folio} — $${montoReembolso} — Estado venta: ${nuevoEstadoVenta}${sinTurno ? ' — ⚠️ sin turno' : ''}${bitacoraVenta ? ` — 📒 Bitácora ${bitacoraVenta.folio} actualizada` : ''}`)

    res.status(201).json({
      success:       true,
      message:       'Devolución registrada correctamente',
      folio,
      fueraDeTiempo,
      sinTurno,
      estadoVenta:   nuevoEstadoVenta,
      bitacoraAfectada: bitacoraVenta ? { folio: bitacoraVenta.folio, id: bitacoraVenta.id } : null,
      data: {
        id:             devolucion.id,
        folio,
        ventaFolio:     venta.folio,
        tipoReembolso,
        motivo,
        montoReembolso,
        productos:      devolucion.detalles.map(d => ({ nombre: d.producto.nombre, cantidad: d.cantidad, precio: d.precioUnitario })),
        cajero:         devolucion.usuario.nombre,
        creadaEn:       devolucion.creadaEn
      }
    })

  } catch (err) {
    console.error('❌ Error en crearDevolucion:', err)
    res.status(500).json({ error: 'Error al procesar devolución: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /devoluciones
// ════════════════════════════════════════════════════════════════════
exports.listar = async (req, res) => {
  try {
    const { skip = 0, take = 20, ventaId, desde, hasta } = req.query
    const where = {}
    if (ventaId) where.ventaId = parseInt(ventaId)
    if (desde || hasta) {
      where.creadaEn = {}
      if (desde) where.creadaEn.gte = new Date(desde)
      if (hasta) where.creadaEn.lte = new Date(new Date(hasta).setHours(23, 59, 59, 999))
    }
    const [devoluciones, total] = await Promise.all([
      prisma.devolucion.findMany({
        where, skip: parseInt(skip), take: parseInt(take), orderBy: { creadaEn: 'desc' },
        include: {
          venta:    { select: { folio: true, metodoPago: true } },
          usuario:  { select: { id: true, nombre: true } },
          detalles: { include: { producto: { select: { nombre: true } } } }
        }
      }),
      prisma.devolucion.count({ where })
    ])
    res.json({
      success: true,
      data: devoluciones.map(d => ({
        id: d.id, ventaFolio: d.venta.folio, metodoPago: d.venta.metodoPago,
        tipoReembolso: d.tipoReembolso, motivo: d.motivo, montoReembolso: d.montoReembolso,
        cajero: d.usuario.nombre, productos: d.detalles.length, creadaEn: d.creadaEn
      })),
      total, skip: parseInt(skip), take: parseInt(take)
    })
  } catch (err) {
    console.error('❌ Error en listarDevoluciones:', err)
    res.status(500).json({ error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /devoluciones/venta/:ventaId
// ════════════════════════════════════════════════════════════════════
exports.porVenta = async (req, res) => {
  try {
    const { ventaId } = req.params
    const devoluciones = await prisma.devolucion.findMany({
      where:   { ventaId: parseInt(ventaId) },
      orderBy: { creadaEn: 'desc' },
      include: {
        usuario:  { select: { nombre: true } },
        detalles: { include: { producto: { select: { nombre: true, codigoInterno: true } } } }
      }
    })
    const resumenProductos = {}
    for (const dev of devoluciones) {
      for (const det of dev.detalles) {
        resumenProductos[det.productoId] = (resumenProductos[det.productoId] || 0) + det.cantidad
      }
    }
    res.json({ success: true, data: devoluciones, resumenDevuelto: resumenProductos })
  } catch (err) {
    console.error('❌ Error en porVenta:', err)
    res.status(500).json({ error: err.message })
  }
}