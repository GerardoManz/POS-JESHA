// ════════════════════════════════════════════════════════════════════
//  BITACORA.CONTROLLER.JS — Soporta dos orígenes:
//    VENTA  — creada automáticamente desde venta a crédito (POS)
//    MANUAL — creada por el cajero para servicios/pedidos externos
//  src/modules/bitacora/bitacora.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// ── Auditoría ──
async function audit(usuarioId, sucursalId, accion, ref) {
  try { await prisma.auditoria.create({ data: { accion, modulo: 'bitacora', referencia: ref, usuarioId, sucursalId } }) }
  catch(e) { console.error('Audit:', e.message) }
}

// ── Generar folio BIT ──
async function generarFolioBitacora(tx) {
  const fecha  = new Date()
  const seq    = await tx.$queryRaw`SELECT nextval('folio_bitacora_seq') as seq`
  const numero = Number(seq[0].seq)
  return `BIT-${fecha.getFullYear()}${String(fecha.getMonth()+1).padStart(2,'0')}${String(fecha.getDate()).padStart(2,'0')}-${String(numero).padStart(5,'0')}`
}

// ── SELECT base de bitácora ──
const BITACORA_SELECT = {
  id: true, folio: true, titulo: true, descripcion: true, origen: true, estado: true,
  totalMateriales: true, totalAbonado: true, saldoPendiente: true, saldoAlCerrar: true,
  notas: true, creadaEn: true, actualizadoEn: true, cerradaEn: true,
  clienteId: true, sucursalId: true, usuarioId: true,
  cliente:  { select: { id: true, nombre: true, telefono: true, limiteCredito: true, saldoPendiente: true } },
  usuario:  { select: { id: true, nombre: true } },
  sucursal: { select: { id: true, nombre: true } },
  detalles: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, cantidad: true, precioUnitario: true, subtotal: true,
      inventarioDescontado: true, notas: true, creadoEn: true,
      venta:    { select: { id: true, folio: true, creadaEn: true } },
      producto: { select: { id: true, nombre: true, codigoInterno: true, unidadVenta: true } }
    }
  },
  abonos: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, monto: true, metodoPago: true, notas: true, creadoEn: true,
      usuario: { select: { id: true, nombre: true } },
      turno:   { select: { id: true, abiertaEn: true, cerradaEn: true } }
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras
// ════════════════════════════════════════════════════════════════════
const listar = async (req, res) => {
  try {
    const { estado, clienteId, origen, buscar, page = 1, limit = 25 } = req.query
    const { sucursalId, rol } = req.usuario
    const where = {}

    if (rol !== 'SUPERADMIN' && sucursalId) where.sucursalId = sucursalId
    if (estado)    where.estado    = estado
    if (origen)    where.origen    = origen
    if (clienteId) where.clienteId = parseInt(clienteId)
    if (buscar) {
      where.OR = [
        { folio:   { contains: buscar, mode: 'insensitive' } },
        { titulo:  { contains: buscar, mode: 'insensitive' } },
        { cliente: { nombre: { contains: buscar, mode: 'insensitive' } } }
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [total, bitacoras] = await Promise.all([
      prisma.bitacora.count({ where }),
      prisma.bitacora.findMany({ where, select: BITACORA_SELECT, orderBy: { creadaEn: 'desc' }, skip, take: parseInt(limit) })
    ])
    res.json({ success: true, data: bitacoras, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    console.error('❌ listar bitacoras:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras/:id
// ════════════════════════════════════════════════════════════════════
const obtener = async (req, res) => {
  try {
    const b = await prisma.bitacora.findUnique({
      where: { id: parseInt(req.params.id) },
      select: BITACORA_SELECT
    })
    if (!b) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    res.json({ success: true, data: b })
  } catch (err) {
    console.error('❌ obtener bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras — Crear bitácora MANUAL
//  Título obligatorio. Cliente opcional. Siempre origen MANUAL.
// ════════════════════════════════════════════════════════════════════
const crear = async (req, res) => {
  try {
    const { titulo, descripcion, clienteId, notas } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.body.sucursalId) || 1

    if (!titulo?.trim()) {
      return res.status(400).json({ success: false, error: 'El título del proyecto es obligatorio', codigo: 'TITULO_REQUERIDO' })
    }

    // Si se especifica cliente, validar que existe
    if (clienteId) {
      const cliente = await prisma.cliente.findUnique({ where: { id: parseInt(clienteId) }, select: { id: true } })
      if (!cliente) return res.status(400).json({ success: false, error: 'Cliente no existe' })
    }

    const bitacora = await prisma.$transaction(async tx => {
      const folio = await generarFolioBitacora(tx)
      return await tx.bitacora.create({
        data: {
          folio,
          titulo:         titulo.trim(),
          descripcion:    descripcion?.trim() || null,
          origen:         'MANUAL',
          clienteId:      clienteId ? parseInt(clienteId) : null,
          sucursalId,
          usuarioId,
          estado:         'ABIERTA',
          totalMateriales: 0,
          totalAbonado:    0,
          saldoPendiente:  0,
          notas:           notas?.trim() || null
        },
        select: BITACORA_SELECT
      })
    })

    await audit(usuarioId, sucursalId, 'CREAR_BITACORA_MANUAL', bitacora.folio)
    res.status(201).json({ success: true, data: bitacora })
  } catch (err) {
    console.error('❌ crear bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id — Editar cabecera (título, descripción, notas)
// ════════════════════════════════════════════════════════════════════
const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { titulo, descripcion, notas } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    const existente = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, estado: true, origen: true }
    })
    if (!existente) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (['CERRADA_VENTA','CERRADA_INTERNA'].includes(existente.estado))
      return res.status(400).json({ success: false, error: 'No se puede editar una bitácora cerrada' })

    const data = {}
    if (titulo !== undefined) {
      // Bitácora MANUAL requiere título siempre
      if (existente.origen === 'MANUAL' && !titulo?.trim()) {
        return res.status(400).json({ success: false, error: 'El título es obligatorio en bitácoras manuales' })
      }
      data.titulo = titulo?.trim() || null
    }
    if (descripcion !== undefined) data.descripcion = descripcion?.trim() || null
    if (notas !== undefined)       data.notas       = notas?.trim() || null

    const b = await prisma.bitacora.update({
      where: { id: parseInt(id) },
      data,
      select: BITACORA_SELECT
    })
    await audit(usuarioId, sucursalId, 'EDITAR_BITACORA', existente.folio)
    res.json({ success: true, data: b })
  } catch (err) {
    console.error('❌ editar bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id/estado
//  Dos operaciones:
//    1. Cerrar manualmente (CERRADA_INTERNA) — cualquier usuario con permiso, motivo obligatorio
//    2. Reabrir (ABIERTA) — solo SUPERADMIN, ventana de 30 días
// ════════════════════════════════════════════════════════════════════
const cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params
    const { estado, motivo } = req.body
    const { id: usuarioId, sucursalId, rol } = req.usuario

    const validos = ['ABIERTA', 'CERRADA_INTERNA']
    if (!validos.includes(estado)) {
      return res.status(400).json({
        success: false,
        error: `Estado inválido: ${estado}. Solo se permite ABIERTA (reabrir) o CERRADA_INTERNA (cierre manual).`
      })
    }

    const existente = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true, folio: true, estado: true, saldoPendiente: true,
        saldoAlCerrar: true, clienteId: true, origen: true,
        cerradaEn: true, notas: true
      }
    })
    if (!existente) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })

    // ──────────────────────────────────────────────────────────
    // CASO 1: CERRAR MANUALMENTE (CERRADA_INTERNA)
    // ──────────────────────────────────────────────────────────
    if (estado === 'CERRADA_INTERNA') {
      if (existente.estado !== 'ABIERTA' && existente.estado !== 'PAUSADA') {
        return res.status(400).json({ success: false, error: `Solo se pueden cerrar bitácoras en estado ABIERTA o PAUSADA (actual: ${existente.estado})` })
      }
      if (!motivo?.trim()) {
        return res.status(400).json({ success: false, error: 'Debe indicar un motivo para cierre manual', codigo: 'MOTIVO_REQUERIDO' })
      }

      await prisma.$transaction(async tx => {
        const saldo = parseFloat(existente.saldoPendiente)
        const updateData = {
          estado:        'CERRADA_INTERNA',
          cerradaEn:     new Date(),
          saldoAlCerrar: saldo,
          notas:         motivo.trim()
        }
        // Al cerrar con saldo > 0, liberar el saldo del cliente (si tiene)
        if (saldo > 0 && existente.clienteId) {
          await tx.cliente.update({
            where: { id: existente.clienteId },
            data:  { saldoPendiente: { decrement: saldo } }
          })
        }
        await tx.bitacora.update({ where: { id: parseInt(id) }, data: updateData })
      })

      await audit(usuarioId, sucursalId, 'CERRAR_BITACORA_INTERNA', `${existente.folio} - saldo:$${parseFloat(existente.saldoPendiente).toFixed(2)} - ${motivo}`)
      const b = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
      return res.json({ success: true, data: b, mensaje: 'Bitácora cerrada manualmente' })
    }

    // ──────────────────────────────────────────────────────────
    // CASO 2: REABRIR (ABIERTA) - Solo SUPERADMIN, ventana 30 días
    // ──────────────────────────────────────────────────────────
    if (estado === 'ABIERTA') {
      // Validar permiso
      if (rol !== 'SUPERADMIN') {
        return res.status(403).json({
          success: false,
          error: 'Solo SUPERADMIN puede reabrir bitácoras cerradas',
          codigo: 'PERMISO_DENEGADO'
        })
      }
      // Validar estado previo
      if (!['CERRADA_VENTA', 'CERRADA_INTERNA'].includes(existente.estado)) {
        return res.status(400).json({
          success: false,
          error: `La bitácora no está cerrada (estado actual: ${existente.estado})`,
          codigo: 'NO_ESTA_CERRADA'
        })
      }
      // Validar ventana de 30 días desde cerradaEn
      if (existente.cerradaEn) {
        const diasDesdeCierre = (Date.now() - new Date(existente.cerradaEn).getTime()) / 86400000
        if (diasDesdeCierre > 30) {
          return res.status(400).json({
            success: false,
            error: `No se puede reabrir: han pasado ${Math.floor(diasDesdeCierre)} días desde el cierre (máximo 30)`,
            codigo: 'VENTANA_EXPIRADA',
            diasTranscurridos: Math.floor(diasDesdeCierre)
          })
        }
      }
      // Motivo de reapertura obligatorio
      if (!motivo?.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Debe indicar el motivo de reapertura',
          codigo: 'MOTIVO_REQUERIDO'
        })
      }

      await prisma.$transaction(async tx => {
        // 1. Re-sumar al cliente el saldo que se le había liberado al cerrar
        //    (solo aplica si era CERRADA_INTERNA — en CERRADA_VENTA el saldo era 0)
        const saldoRecuperar = parseFloat(existente.saldoAlCerrar || 0)
        if (saldoRecuperar > 0 && existente.clienteId && existente.estado === 'CERRADA_INTERNA') {
          await tx.cliente.update({
            where: { id: existente.clienteId },
            data:  { saldoPendiente: { increment: saldoRecuperar } }
          })
        }

        // 2. Restaurar estado y limpiar campos de cierre
        await tx.bitacora.update({
          where: { id: parseInt(id) },
          data: {
            estado:         'ABIERTA',
            cerradaEn:      null,
            saldoAlCerrar:  null,
            saldoPendiente: saldoRecuperar || parseFloat(existente.saldoPendiente),
            notas:          `[REAPERTURA ${new Date().toISOString().split('T')[0]}] ${motivo.trim()}\n${existente.notas || ''}`.trim()
          }
        })
      })

      await audit(usuarioId, sucursalId, 'REABRIR_BITACORA',
        `${existente.folio} - estado previo:${existente.estado} - ${motivo}`)
      const b = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
      return res.json({ success: true, data: b, mensaje: 'Bitácora reabierta. El saldo del cliente fue restaurado.' })
    }
  } catch (err) {
    console.error('❌ cambiar estado bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/productos — Agregar producto (SOLO MANUAL)
//  Descuenta inventario de la sucursal del usuario.
//  Si stock insuficiente: permite la operación pero devuelve flag.
// ════════════════════════════════════════════════════════════════════
const agregarProducto = async (req, res) => {
  try {
    const { id } = req.params
    const { productoId, cantidad, precioUnitario, notas } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.body.sucursalId) || 1

    // ── Validaciones ──
    if (!productoId)                        return res.status(400).json({ success: false, error: 'productoId requerido' })
    const cant = parseFloat(cantidad)
    if (!cant || cant <= 0)                 return res.status(400).json({ success: false, error: 'Cantidad debe ser > 0' })
    const precio = parseFloat(precioUnitario)
    if (isNaN(precio) || precio < 0)        return res.status(400).json({ success: false, error: 'Precio unitario inválido' })

    // ── Bitácora ──
    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, clienteId: true }
    })
    if (!bitacora)                          return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.origen !== 'MANUAL') {
      return res.status(403).json({
        success: false,
        error: 'Solo se pueden agregar productos a bitácoras MANUAL. Las bitácoras origen VENTA se actualizan automáticamente desde el POS.',
        codigo: 'ORIGEN_INCORRECTO'
      })
    }
    if (bitacora.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, error: `No se pueden agregar productos en estado ${bitacora.estado}`, codigo: 'ESTADO_INVALIDO' })
    }

    // ── Producto + inventario ──
    const producto = await prisma.producto.findUnique({
      where: { id: parseInt(productoId) },
      select: { id: true, nombre: true, codigoInterno: true, precioVenta: true, activo: true }
    })
    if (!producto || !producto.activo)      return res.status(404).json({ success: false, error: 'Producto no encontrado o inactivo' })

    const inv = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: producto.id, sucursalId } },
      select: { stockActual: true }
    })
    const stockActual       = parseFloat(inv?.stockActual || 0)
    const stockInsuficiente = cant > stockActual
    const subtotal          = parseFloat((cant * precio).toFixed(2))

    // ── Transacción ──
    const resultado = await prisma.$transaction(async tx => {
      // 1. Crear detalle de bitácora
      const detalle = await tx.detalleBitacora.create({
        data: {
          bitacoraId:           parseInt(id),
          productoId:           producto.id,
          cantidad:             cant,
          precioUnitario:       precio,
          subtotal,
          inventarioDescontado: !stockInsuficiente,
          notas:                notas?.trim() || null
        }
      })

      // 2. Descontar inventario (aunque sea parcial si no hay stock)
      if (inv) {
        const nuevoStock = Math.max(0, stockActual - cant)
        await tx.inventarioSucursal.update({
          where: { productoId_sucursalId: { productoId: producto.id, sucursalId } },
          data:  { stockActual: nuevoStock }
        })
        if (stockActual > 0) {
          const cantDescontada = Math.min(cant, stockActual)
          await tx.movimientoInventario.create({
            data: {
              productoId:   producto.id,
              sucursalId,
              usuarioId,
              tipo:         'SALIDA_BITACORA',
              cantidad:     cantDescontada,
              stockAntes:   stockActual,
              stockDespues: nuevoStock,
              referencia:   bitacora.folio,
              notas:        `Bitácora ${bitacora.folio} — ${producto.nombre}`
            }
          })
        }
      }

      // 3. Actualizar totales de bitácora
      const nuevoTotal = parseFloat((parseFloat(bitacora.totalMateriales) + subtotal).toFixed(2))
      const nuevoSaldo = parseFloat((parseFloat(bitacora.saldoPendiente) + subtotal).toFixed(2))
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data: {
          totalMateriales: nuevoTotal,
          saldoPendiente:  nuevoSaldo
        }
      })

      // 4. Actualizar saldo del cliente SOLO si la bitácora tiene cliente
      if (bitacora.clienteId) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data:  { saldoPendiente: { increment: subtotal } }
        })
      }

      return detalle
    })

    await audit(usuarioId, sucursalId, 'AGREGAR_PRODUCTO_BITACORA', `${bitacora.folio} — ${producto.nombre} x${cant}`)

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({
      success:  true,
      data:     bitacoraActualizada,
      detalleId: resultado.id,
      stockInsuficiente,
      stockActual,
      mensaje: stockInsuficiente
        ? `⚠️ Producto agregado pero el stock era insuficiente (había ${stockActual}, se pidieron ${cant})`
        : 'Producto agregado correctamente'
    })
  } catch (err) {
    console.error('❌ agregar producto bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id/productos/:detalleId
//  Editar cantidad o precioUnitario de un detalle (SOLO MANUAL).
//  Ajusta inventario, totales de bitácora y saldo del cliente.
// ════════════════════════════════════════════════════════════════════
const editarDetalle = async (req, res) => {
  try {
    const { id, detalleId } = req.params
    const { cantidad, precioUnitario } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || 1

    if (cantidad === undefined && precioUnitario === undefined) {
      return res.status(400).json({ success: false, error: 'Debes enviar cantidad o precioUnitario' })
    }

    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, totalAbonado: true, clienteId: true }
    })
    if (!bitacora) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.origen !== 'MANUAL')  return res.status(403).json({ success: false, error: 'Solo se pueden editar detalles de bitácoras MANUAL', codigo: 'ORIGEN_INCORRECTO' })
    if (bitacora.estado !== 'ABIERTA') return res.status(400).json({ success: false, error: `No se pueden editar detalles en estado ${bitacora.estado}` })

    const detalle = await prisma.detalleBitacora.findUnique({
      where: { id: parseInt(detalleId) },
      select: { id: true, bitacoraId: true, productoId: true, cantidad: true, precioUnitario: true, subtotal: true, inventarioDescontado: true, producto: { select: { nombre: true } } }
    })
    if (!detalle || detalle.bitacoraId !== parseInt(id)) {
      return res.status(404).json({ success: false, error: 'Detalle no encontrado en esta bitácora' })
    }

    const cantidadNueva = cantidad !== undefined ? parseFloat(cantidad) : parseFloat(detalle.cantidad)
    const precioNuevo   = precioUnitario !== undefined ? parseFloat(precioUnitario) : parseFloat(detalle.precioUnitario)

    if (isNaN(cantidadNueva) || cantidadNueva < 0) return res.status(400).json({ success: false, error: 'Cantidad inválida' })
    if (isNaN(precioNuevo) || precioNuevo < 0)     return res.status(400).json({ success: false, error: 'Precio inválido' })

    const subtotalNuevo  = parseFloat((cantidadNueva * precioNuevo).toFixed(2))
    const subtotalOrig   = parseFloat(detalle.subtotal)
    const diferencia     = subtotalNuevo - subtotalOrig

    // Validar que el nuevo total no quede por debajo del total abonado
    const nuevoTotalMat = parseFloat((parseFloat(bitacora.totalMateriales) + diferencia).toFixed(2))
    const totalAbonado  = parseFloat(bitacora.totalAbonado)
    if (nuevoTotalMat < totalAbonado - 0.005) {
      return res.status(400).json({
        success: false,
        error: `No se puede reducir tanto: el monto ya abonado ($${totalAbonado.toFixed(2)}) excedería el nuevo total ($${nuevoTotalMat.toFixed(2)}).`,
        codigo: 'ABONO_EXCEDE'
      })
    }

    // Cambio de cantidad → ajuste de inventario
    let stockInsuficiente = false
    let stockActualSucursal = 0
    if (cantidad !== undefined && detalle.productoId) {
      const cantidadOrig = parseFloat(detalle.cantidad)
      const deltaCant    = cantidadNueva - cantidadOrig

      const inv = await prisma.inventarioSucursal.findUnique({
        where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
        select: { stockActual: true }
      })
      stockActualSucursal = parseFloat(inv?.stockActual || 0)

      // Si AUMENTAMOS cantidad → necesitamos descontar más stock
      if (deltaCant > 0) {
        stockInsuficiente = deltaCant > stockActualSucursal
      }
    }

    await prisma.$transaction(async tx => {
      // 1. Ajustar inventario si cambió la cantidad
      if (cantidad !== undefined && detalle.productoId) {
        const cantidadOrig = parseFloat(detalle.cantidad)
        const deltaCant    = cantidadNueva - cantidadOrig

        if (deltaCant !== 0) {
          const inv = await tx.inventarioSucursal.findUnique({
            where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } }
          })
          if (inv) {
            const stockAntes = parseFloat(inv.stockActual)
            // Si aumenta cantidad → resta stock; si disminuye → suma stock
            const stockDespues = Math.max(0, stockAntes - deltaCant)
            await tx.inventarioSucursal.update({
              where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
              data:  { stockActual: stockDespues }
            })
            await tx.movimientoInventario.create({
              data: {
                productoId:   detalle.productoId,
                sucursalId,
                usuarioId,
                tipo:         deltaCant > 0 ? 'SALIDA_BITACORA' : 'DEVOLUCION_ENTRADA',
                cantidad:     Math.abs(deltaCant),
                stockAntes,
                stockDespues,
                referencia:   bitacora.folio,
                notas:        `Edición de detalle bitácora ${bitacora.folio}`
              }
            })
          }
        }
      }

      // 2. Actualizar el detalle
      await tx.detalleBitacora.update({
        where: { id: parseInt(detalleId) },
        data: {
          cantidad:             cantidadNueva,
          precioUnitario:       precioNuevo,
          subtotal:             subtotalNuevo,
          inventarioDescontado: !stockInsuficiente
        }
      })

      // 3. Actualizar totales de bitácora
      const nuevoSaldo = parseFloat(bitacora.saldoPendiente) + diferencia
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data: {
          totalMateriales: Math.max(0, nuevoTotalMat),
          saldoPendiente:  Math.max(0, nuevoSaldo)
        }
      })

      // 4. Actualizar saldo del cliente si aplica
      if (bitacora.clienteId) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data:  { saldoPendiente: { increment: diferencia } }
        })
      }
    })

    await audit(usuarioId, sucursalId, 'EDITAR_DETALLE_BITACORA', `${bitacora.folio} — ${detalle.producto?.nombre || 'Sin nombre'} (Δ$${diferencia.toFixed(2)})`)

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({
      success: true,
      data:    bitacoraActualizada,
      stockInsuficiente,
      stockActual: stockActualSucursal,
      mensaje: stockInsuficiente
        ? `⚠️ Cambio aplicado pero el stock no alcanza (disponible: ${stockActualSucursal})`
        : 'Cambio guardado correctamente'
    })
  } catch (err) {
    console.error('❌ editar detalle bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  DELETE /bitacoras/:id/productos/:detalleId
//  Quitar producto de bitácora MANUAL y reintegrar inventario.
// ════════════════════════════════════════════════════════════════════
const quitarProducto = async (req, res) => {
  try {
    const { id, detalleId } = req.params
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || 1

    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, totalAbonado: true, clienteId: true }
    })
    if (!bitacora)                     return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.origen !== 'MANUAL')  return res.status(403).json({ success: false, error: 'Solo se pueden quitar productos de bitácoras MANUAL', codigo: 'ORIGEN_INCORRECTO' })
    if (bitacora.estado !== 'ABIERTA') return res.status(400).json({ success: false, error: `No se pueden quitar productos en estado ${bitacora.estado}` })

    const detalle = await prisma.detalleBitacora.findUnique({
      where: { id: parseInt(detalleId) },
      select: { id: true, bitacoraId: true, productoId: true, cantidad: true, subtotal: true, inventarioDescontado: true, producto: { select: { nombre: true } } }
    })
    if (!detalle || detalle.bitacoraId !== parseInt(id)) {
      return res.status(404).json({ success: false, error: 'Detalle no encontrado en esta bitácora' })
    }

    // Validar que no se quite más de lo que queda por abonar
    const subtotalDetalle = parseFloat(detalle.subtotal)
    const totalAbonado    = parseFloat(bitacora.totalAbonado)
    const nuevoTotal      = parseFloat(bitacora.totalMateriales) - subtotalDetalle
    if (nuevoTotal < totalAbonado) {
      return res.status(400).json({
        success: false,
        error: `No se puede quitar: el monto ya abonado ($${totalAbonado}) excedería el total restante. Registra devolución de abono primero.`,
        codigo: 'ABONO_EXCEDE'
      })
    }

    await prisma.$transaction(async tx => {
      // 1. Reintegrar inventario si se había descontado
      if (detalle.productoId && detalle.inventarioDescontado) {
        const inv = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } }
        })
        if (inv) {
          const stockAntes     = parseFloat(inv.stockActual)
          const cantReintegrar = parseFloat(detalle.cantidad)
          const stockDespues   = stockAntes + cantReintegrar
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
            data:  { stockActual: stockDespues }
          })
          await tx.movimientoInventario.create({
            data: {
              productoId:   detalle.productoId,
              sucursalId,
              usuarioId,
              tipo:         'DEVOLUCION_ENTRADA',
              cantidad:     cantReintegrar,
              stockAntes,
              stockDespues,
              referencia:   bitacora.folio,
              notas:        `Reintegro por quitar producto de bitácora ${bitacora.folio}`
            }
          })
        }
      }

      // 2. Eliminar detalle
      await tx.detalleBitacora.delete({ where: { id: parseInt(detalleId) } })

      // 3. Actualizar totales de bitácora
      const nuevoSaldo = parseFloat(bitacora.saldoPendiente) - subtotalDetalle
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data: {
          totalMateriales: nuevoTotal,
          saldoPendiente:  Math.max(0, nuevoSaldo)
        }
      })

      // 4. Actualizar saldo del cliente si aplica
      if (bitacora.clienteId) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data:  { saldoPendiente: { decrement: subtotalDetalle } }
        })
      }
    })

    await audit(usuarioId, sucursalId, 'QUITAR_PRODUCTO_BITACORA', `${bitacora.folio} — ${detalle.producto?.nombre || 'Sin nombre'}`)

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({ success: true, data: bitacoraActualizada, mensaje: 'Producto eliminado y stock reintegrado' })
  } catch (err) {
    console.error('❌ quitar producto bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/abonos — Registrar abono
//  Valida turno, crea MovimientoCaja, cierre automático si saldo=0.
// ════════════════════════════════════════════════════════════════════
const registrarAbono = async (req, res) => {
  try {
    const { id } = req.params
    const { monto, metodoPago, notas, turnoId } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    const montoAbono = parseFloat(parseFloat(monto || 0).toFixed(2))
    if (!monto || montoAbono <= 0) {
      return res.status(400).json({ success: false, error: 'El monto debe ser mayor a 0', codigo: 'MONTO_INVALIDO' })
    }

    const turnoIdFinal = parseInt(turnoId)
    if (!turnoIdFinal || isNaN(turnoIdFinal)) {
      return res.status(400).json({ success: false, error: 'Se requiere turnoId para registrar abono', codigo: 'SIN_TURNO' })
    }

    const turno = await prisma.turnoCaja.findUnique({ where: { id: turnoIdFinal } })
    if (!turno || !turno.abierto) {
      return res.status(403).json({ success: false, error: 'Turno cerrado o no existe', codigo: 'TURNO_CERRADO' })
    }

    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, estado: true, totalAbonado: true, totalMateriales: true, saldoPendiente: true, clienteId: true }
    })
    if (!bitacora) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, error: `No se pueden registrar abonos en estado ${bitacora.estado}`, codigo: 'ESTADO_INVALIDO' })
    }

    const saldoActual = parseFloat(bitacora.saldoPendiente)
    if (montoAbono > saldoActual + 0.005) {
      return res.status(400).json({
        success: false,
        error: `Monto excede saldo pendiente. Saldo: $${saldoActual.toFixed(2)}, Intento: $${montoAbono.toFixed(2)}`,
        codigo: 'EXCEDE_SALDO',
        saldoActual
      })
    }

    const nuevoAbonado = parseFloat((parseFloat(bitacora.totalAbonado) + montoAbono).toFixed(2))
    const nuevoSaldo   = parseFloat((parseFloat(bitacora.totalMateriales) - nuevoAbonado).toFixed(2))
    const cerrar       = nuevoSaldo <= 0.005

    await prisma.$transaction(async tx => {
      await tx.abonoBitacora.create({
        data: {
          bitacoraId: parseInt(id),
          usuarioId,
          turnoId:    turnoIdFinal,
          monto:      montoAbono,
          metodoPago: metodoPago || 'EFECTIVO',
          notas:      notas || null
        }
      })

      const updateData = {
        totalAbonado:   nuevoAbonado,
        saldoPendiente: Math.max(0, nuevoSaldo)
      }
      if (cerrar) {
        updateData.estado    = 'CERRADA_VENTA'
        updateData.cerradaEn = new Date()
      }
      await tx.bitacora.update({ where: { id: parseInt(id) }, data: updateData })

      if (bitacora.clienteId) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data:  { saldoPendiente: { decrement: montoAbono } }
        })
      }

      await tx.movimientoCaja.create({
        data: {
          turnoId:    turnoIdFinal,
          tipo:       'ABONO_BITACORA',
          monto:      montoAbono,
          metodoPago: metodoPago || 'EFECTIVO',
          referencia: bitacora.folio,
          notas:      `Abono a bitácora ${bitacora.folio}${cerrar ? ' (liquidación completa)' : ''}`
        }
      })
    })

    const accion = cerrar ? 'ABONO_BITACORA_CIERRE' : 'ABONO_BITACORA'
    await audit(usuarioId, sucursalId, accion, `${bitacora.folio} +$${montoAbono.toFixed(2)}`)

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({
      success: true,
      data:    bitacoraActualizada,
      cerrada: cerrar,
      mensaje: cerrar ? 'Abono registrado — bitácora cerrada automáticamente (saldo en $0)' : 'Abono registrado correctamente'
    })
  } catch (err) {
    console.error('❌ abono bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = {
  listar,
  obtener,
  crear,
  editar,
  cambiarEstado,
  agregarProducto,
  editarDetalle,
  quitarProducto,
  registrarAbono
}