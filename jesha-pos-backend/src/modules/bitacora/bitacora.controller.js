// ════════════════════════════════════════════════════════════════════
//  BITACORA.CONTROLLER.JS — Soporta dos orígenes:
//    VENTA  — creada automáticamente desde venta a crédito (POS)
//    MANUAL — creada por el cajero para servicios/pedidos externos
//  src/modules/bitacora/bitacora.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')

// ── Auditoría ──
async function audit(usuarioId, sucursalId, accion, ref, empresaId, valorDespues = null) {
  try {
    const data = { accion, modulo: 'bitacora', referencia: ref, usuarioId, sucursalId }
    if (empresaId) data.empresaId = empresaId
    if (valorDespues !== null) data.valorDespues = valorDespues
    await prisma.auditoria.create({ data })
  }
  catch(e) { console.error('Audit:', e.message) }
}

function parseFechaManual(fechaManual) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaManual || '')) {
    throw new Error('fechaManual debe tener formato YYYY-MM-DD')
  }
  const [year, month, day] = fechaManual.split('-').map(n => parseInt(n, 10))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('fechaManual no es una fecha válida')
  }
  return date
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
  Cliente:  { select: { id: true, nombre: true, telefono: true, limiteCredito: true, saldoPendiente: true } },
  Usuario:  { select: { id: true, nombre: true } },
  Sucursal: { select: { id: true, nombre: true } },
  DetalleBitacora: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, cantidad: true, precioUnitario: true, subtotal: true,
      inventarioDescontado: true, notas: true, creadoEn: true,
      fechaManual: true, responsableId: true,
      Venta:       { select: { id: true, folio: true, creadaEn: true } },
      Producto:    { select: { id: true, nombre: true, codigoInterno: true, unidadVenta: true } },
      Responsable: { select: { id: true, nombre: true } }
    }
  },
  AbonoBitacora: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, monto: true, metodoPago: true, notas: true, creadoEn: true,
      Usuario: { select: { id: true, nombre: true } },
      TurnoCaja:   { select: { id: true, abiertaEn: true, cerradaEn: true } }
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
    if (clienteId && clienteId !== 'null') where.clienteId = parseInt(clienteId)
    if (buscar) {
      where.OR = [
        { folio:   { contains: buscar, mode: 'insensitive' } },
        { titulo:  { contains: buscar, mode: 'insensitive' } },
        { Cliente: { nombre: { contains: buscar, mode: 'insensitive' } } }
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
    const empresaId = getEmpresaId(req)

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
          empresaId,
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
          notas:           notas?.trim() || null,
          actualizadoEn:   new Date()
        },
        select: BITACORA_SELECT
      })
    })

    await audit(usuarioId, sucursalId, 'CREAR_BITACORA_MANUAL', bitacora.folio, empresaId)
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
    const empresaId = getEmpresaId(req)

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
    await audit(usuarioId, sucursalId, 'EDITAR_BITACORA', existente.folio, empresaId)
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
    const empresaId = getEmpresaId(req)

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

      await audit(usuarioId, sucursalId, 'CERRAR_BITACORA_INTERNA', `${existente.folio} - saldo:$${parseFloat(existente.saldoPendiente).toFixed(2)} - ${motivo}`, empresaId)
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
        `${existente.folio} - estado previo:${existente.estado} - ${motivo}`, empresaId)
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
    const { productoId, cantidad, precioUnitario, notas, fechaManual, responsableId } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.body.sucursalId) || 1
    const empresaId = getEmpresaId(req)

    // ── Validaciones ──
    if (!productoId)                        return res.status(400).json({ success: false, error: 'productoId requerido' })
    const cant = parseFloat(cantidad)
    if (!cant || cant <= 0)                 return res.status(400).json({ success: false, error: 'Cantidad debe ser > 0' })
    const precio = parseFloat(precioUnitario)
    if (isNaN(precio) || precio < 0)        return res.status(400).json({ success: false, error: 'Precio unitario inválido' })

    // ── Fecha manual (obligatoria en altas manuales) ──
    let fechaManualDate
    try {
      fechaManualDate = parseFechaManual(fechaManual)
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message, codigo: 'FECHA_INVALIDA' })
    }

    // ── Responsable (obligatorio, misma empresa, activo) ──
    const respId = Number(responsableId)
    if (!Number.isInteger(respId) || respId <= 0) {
      return res.status(400).json({ success: false, error: 'responsableId requerido', codigo: 'RESPONSABLE_REQUERIDO' })
    }
    const responsable = await prisma.usuario.findFirst({
      where: { id: respId, empresaId, activo: true },
      select: { id: true, nombre: true }
    })
    if (!responsable) {
      return res.status(400).json({ success: false, error: 'Responsable inválido o de otra empresa', codigo: 'RESPONSABLE_INVALIDO' })
    }

    // ── Bitácora ──
    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, clienteId: true }
    })
    if (!bitacora)                          return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.empresaId !== empresaId) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
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
          notas:                notas?.trim() || null,
          fechaManual:          fechaManualDate,
          responsableId:        responsable.id
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
              empresaId,
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

    await audit(usuarioId, sucursalId, 'AGREGAR_PRODUCTO_BITACORA', `${bitacora.folio} — ${producto.nombre} x${cant}`, empresaId, {
      detalleId:      resultado.id,
      productoId:     producto.id,
      cantidad:       cant,
      precioUnitario: precio,
      subtotal,
      fechaManual,
      responsableId:  responsable.id
    })

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
//  POST /bitacoras/:id/productos/batch — Agregar varios productos (SOLO MANUAL)
//  Atómico: o entran todos los items o ninguno (un item inválido aborta el lote).
//  Cada item es un renglón nuevo en DetalleBitacora con su propia fecha/responsable
//  (no hay merge ni suma por producto repetido).
//  Stock secuencial: un mismo producto repetido se descuenta acumulado dentro del lote.
//  Stock insuficiente NO aborta el lote (marca inventarioDescontado:false, como agregarProducto).
//  Totales de bitácora y saldo de cliente se actualizan UNA sola vez al final.
// ════════════════════════════════════════════════════════════════════
const agregarProductosBatch = async (req, res) => {
  try {
    const { id } = req.params
    const { items } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.body.sucursalId) || 1
    const empresaId = getEmpresaId(req)

    // ── Validar lote ──
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items debe ser un arreglo con al menos un producto', codigo: 'ITEMS_VACIO' })
    }
    if (items.length > 100) {
      return res.status(400).json({ success: false, error: 'Máximo 100 productos por lote', codigo: 'ITEMS_EXCESO' })
    }

    // ── Validar forma de cada item + parsear fecha (un item inválido aborta todo) ──
    const itemsNorm = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {}
      const productoId = parseInt(it.productoId)
      if (!productoId) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: productoId requerido`, codigo: 'ITEM_INVALIDO', indice: i })
      }
      const cant = parseFloat(it.cantidad)
      if (!cant || cant <= 0) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: cantidad debe ser > 0`, codigo: 'ITEM_INVALIDO', indice: i })
      }
      const precio = parseFloat(it.precioUnitario)
      if (isNaN(precio) || precio < 0) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: precio unitario inválido`, codigo: 'ITEM_INVALIDO', indice: i })
      }
      let fechaManualDate
      try {
        fechaManualDate = parseFechaManual(it.fechaManual)
      } catch (e) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: ${e.message}`, codigo: 'FECHA_INVALIDA', indice: i })
      }
      const respId = Number(it.responsableId)
      if (!Number.isInteger(respId) || respId <= 0) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: responsableId requerido`, codigo: 'RESPONSABLE_REQUERIDO', indice: i })
      }
      itemsNorm.push({ indice: i, productoId, cant, precio, fechaManualDate, respId, notas: it.notas?.trim() || null })
    }

    // ── Bitácora (validada una sola vez) ──
    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, clienteId: true }
    })
    if (!bitacora)                          return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.empresaId !== empresaId) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
    if (bitacora.origen !== 'MANUAL') {
      return res.status(403).json({ success: false, error: 'Solo se pueden agregar productos a bitácoras MANUAL', codigo: 'ORIGEN_INCORRECTO' })
    }
    if (bitacora.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, error: `No se pueden agregar productos en estado ${bitacora.estado}`, codigo: 'ESTADO_INVALIDO' })
    }

    // ── Responsables: todos válidos, activos, misma empresa (una sola query) ──
    const respIds = [...new Set(itemsNorm.map(x => x.respId))]
    const responsables = await prisma.usuario.findMany({
      where: { id: { in: respIds }, empresaId, activo: true },
      select: { id: true }
    })
    const respValidos = new Set(responsables.map(r => r.id))
    const itemRespMal = itemsNorm.find(x => !respValidos.has(x.respId))
    if (itemRespMal) {
      return res.status(400).json({ success: false, error: `Ítem ${itemRespMal.indice}: responsable inválido o de otra empresa`, codigo: 'RESPONSABLE_INVALIDO', indice: itemRespMal.indice })
    }

    // ── Productos: todos existen, activos, misma empresa (una sola query) ──
    const prodIds = [...new Set(itemsNorm.map(x => x.productoId))]
    const productos = await prisma.producto.findMany({
      where: { id: { in: prodIds }, empresaId, activo: true },
      select: { id: true, nombre: true }
    })
    const prodMap = new Map(productos.map(p => [p.id, p]))
    const itemProdMal = itemsNorm.find(x => !prodMap.has(x.productoId))
    if (itemProdMal) {
      return res.status(404).json({ success: false, error: `Ítem ${itemProdMal.indice}: producto no encontrado o inactivo`, codigo: 'PRODUCTO_INVALIDO', indice: itemProdMal.indice })
    }

    // ── Transacción única: todo el lote es atómico ──
    const resultado = await prisma.$transaction(async tx => {
      // Stock vigente por producto, en memoria, para descuento secuencial
      const stockMap = new Map()
      for (const pid of prodIds) {
        const inv = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: pid, sucursalId } },
          select: { stockActual: true }
        })
        stockMap.set(pid, { existe: !!inv, stock: parseFloat(inv?.stockActual || 0) })
      }

      const resumen  = []
      let totalLote  = 0

      for (const it of itemsNorm) {
        const prod = prodMap.get(it.productoId)
        const st   = stockMap.get(it.productoId)
        const stockActual       = st.stock
        const stockInsuficiente = it.cant > stockActual
        const subtotal          = parseFloat((it.cant * it.precio).toFixed(2))

        // 1. Crear detalle (un renglón por item, sin merge)
        const detalle = await tx.detalleBitacora.create({
          data: {
            bitacoraId:           parseInt(id),
            productoId:           prod.id,
            cantidad:             it.cant,
            precioUnitario:       it.precio,
            subtotal,
            inventarioDescontado: !stockInsuficiente,
            notas:                it.notas,
            fechaManual:          it.fechaManualDate,
            responsableId:        it.respId
          }
        })

        // 2. Descontar inventario si existe registro
        if (st.existe) {
          const nuevoStock = Math.max(0, stockActual - it.cant)
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: prod.id, sucursalId } },
            data:  { stockActual: nuevoStock }
          })
          // 3. Movimiento solo si había stock positivo (descuenta lo disponible)
          if (stockActual > 0) {
            const cantDescontada = Math.min(it.cant, stockActual)
            await tx.movimientoInventario.create({
              data: {
                empresaId,
                productoId:   prod.id,
                sucursalId,
                usuarioId,
                tipo:         'SALIDA_BITACORA',
                cantidad:     cantDescontada,
                stockAntes:   stockActual,
                stockDespues: nuevoStock,
                referencia:   bitacora.folio,
                notas:        `Bitácora ${bitacora.folio} — ${prod.nombre}`
              }
            })
          }
          st.stock = nuevoStock   // actualizar memoria para el próximo item del mismo producto
        }

        totalLote = parseFloat((totalLote + subtotal).toFixed(2))
        resumen.push({ indice: it.indice, detalleId: detalle.id, productoId: prod.id, cantidad: it.cant, stockInsuficiente })
      }

      // 4. Totales de bitácora — una sola vez
      const nuevoTotal = parseFloat((parseFloat(bitacora.totalMateriales) + totalLote).toFixed(2))
      const nuevoSaldo = parseFloat((parseFloat(bitacora.saldoPendiente) + totalLote).toFixed(2))
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data:  { totalMateriales: nuevoTotal, saldoPendiente: nuevoSaldo }
      })

      // 5. Saldo del cliente — una sola vez, solo si hay cliente
      if (bitacora.clienteId) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data:  { saldoPendiente: { increment: totalLote } }
        })
      }

      return { resumen, totalLote }
    })

    const conStockInsuf = resultado.resumen.filter(r => r.stockInsuficiente).length
    await audit(usuarioId, sucursalId, 'AGREGAR_PRODUCTOS_BATCH', `${bitacora.folio} — ${resultado.resumen.length} productos +$${resultado.totalLote.toFixed(2)}`, empresaId, {
      cantidadItems:        resultado.resumen.length,
      totalLote:            resultado.totalLote,
      conStockInsuficiente: conStockInsuf,
      detalleIds:           resultado.resumen.map(r => r.detalleId)
    })

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({
      success:              true,
      data:                 bitacoraActualizada,
      agregados:            resultado.resumen.length,
      conStockInsuficiente: conStockInsuf,
      resumen:              resultado.resumen,
      mensaje: conStockInsuf > 0
        ? `${resultado.resumen.length} productos agregados (${conStockInsuf} con stock insuficiente)`
        : `${resultado.resumen.length} productos agregados correctamente`
    })
  } catch (err) {
    console.error('❌ agregar productos batch bitacora:', err)
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
    const empresaId = getEmpresaId(req)

    if (cantidad === undefined && precioUnitario === undefined) {
      return res.status(400).json({ success: false, error: 'Debes enviar cantidad o precioUnitario' })
    }

    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, totalAbonado: true, clienteId: true }
    })
    if (!bitacora) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.empresaId !== empresaId) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
    if (bitacora.origen !== 'MANUAL')  return res.status(403).json({ success: false, error: 'Solo se pueden editar detalles de bitácoras MANUAL', codigo: 'ORIGEN_INCORRECTO' })
    if (bitacora.estado !== 'ABIERTA') return res.status(400).json({ success: false, error: `No se pueden editar detalles en estado ${bitacora.estado}` })

    const detalle = await prisma.detalleBitacora.findUnique({
      where: { id: parseInt(detalleId) },
      select: { id: true, bitacoraId: true, productoId: true, cantidad: true, precioUnitario: true, subtotal: true, inventarioDescontado: true, Producto: { select: { nombre: true } } }
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
                empresaId,
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
      const nuevoSaldo = parseFloat((parseFloat(bitacora.saldoPendiente) + diferencia).toFixed(2))
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

    await audit(usuarioId, sucursalId, 'EDITAR_DETALLE_BITACORA', `${bitacora.folio} — ${detalle.producto?.nombre || 'Sin nombre'} (Δ$${diferencia.toFixed(2)})`, empresaId)

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
    const empresaId = getEmpresaId(req)

    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, totalAbonado: true, clienteId: true }
    })
    if (!bitacora)                     return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.empresaId !== empresaId) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
    if (bitacora.origen !== 'MANUAL')  return res.status(403).json({ success: false, error: 'Solo se pueden quitar productos de bitácoras MANUAL', codigo: 'ORIGEN_INCORRECTO' })
    if (bitacora.estado !== 'ABIERTA') return res.status(400).json({ success: false, error: `No se pueden quitar productos en estado ${bitacora.estado}` })

    const detalle = await prisma.detalleBitacora.findUnique({
      where: { id: parseInt(detalleId) },
      select: { id: true, bitacoraId: true, productoId: true, cantidad: true, subtotal: true, inventarioDescontado: true, Producto: { select: { nombre: true } } }
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
          const stockDespues   = parseFloat((stockAntes + cantReintegrar).toFixed(3))
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
            data:  { stockActual: stockDespues }
          })
          await tx.movimientoInventario.create({
            data: {
              empresaId,
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

    await audit(usuarioId, sucursalId, 'QUITAR_PRODUCTO_BITACORA', `${bitacora.folio} — ${detalle.producto?.nombre || 'Sin nombre'}`, empresaId)

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({ success: true, data: bitacoraActualizada, mensaje: 'Producto eliminado y stock reintegrado' })
  } catch (err) {
    console.error('❌ quitar producto bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/abonos — Registrar abono
//  VENTA  → exige turno, crea MovimientoCaja (afecta corte de caja)
//  MANUAL → turno opcional, NO crea MovimientoCaja (dinero aparte)
//  Cierre automático si saldo llega a $0.
// ════════════════════════════════════════════════════════════════════
const registrarAbono = async (req, res) => {
  try {
    const { id } = req.params
    const { monto, metodoPago, notas, turnoId } = req.body
    const { id: usuarioId, sucursalId } = req.usuario
    const empresaId = getEmpresaId(req)

    const montoAbono = parseFloat(parseFloat(monto || 0).toFixed(2))
    if (!monto || montoAbono <= 0) {
      return res.status(400).json({ success: false, error: 'El monto debe ser mayor a 0', codigo: 'MONTO_INVALIDO' })
    }

    // ── Obtener bitácora CON origen ──
    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, estado: true, origen: true, totalAbonado: true, totalMateriales: true, saldoPendiente: true, clienteId: true }
    })
    if (!bitacora) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, error: `No se pueden registrar abonos en estado ${bitacora.estado}`, codigo: 'ESTADO_INVALIDO' })
    }

    const esVenta = bitacora.origen === 'VENTA'

    // ── Validar turno SOLO para bitácoras VENTA (crédito POS) ──
    let turnoIdFinal = null
    if (esVenta) {
      turnoIdFinal = parseInt(turnoId)
      if (!turnoIdFinal || isNaN(turnoIdFinal)) {
        return res.status(400).json({ success: false, error: 'Se requiere turno de caja abierto para abonar créditos POS', codigo: 'SIN_TURNO' })
      }
      const turno = await prisma.turnoCaja.findUnique({ where: { id: turnoIdFinal } })
      if (!turno || !turno.abierto) {
        return res.status(403).json({ success: false, error: 'Turno cerrado o no existe', codigo: 'TURNO_CERRADO' })
      }
    } else {
      // MANUAL: turno opcional (si viene se guarda para trazabilidad, pero no se exige)
      if (turnoId && !isNaN(parseInt(turnoId))) {
        turnoIdFinal = parseInt(turnoId)
      }
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
          empresaId,
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

      // ── MovimientoCaja SOLO para bitácoras VENTA (crédito POS) ──
      // Las bitácoras MANUAL son servicios externos; ese dinero no entra a caja
      if (esVenta && turnoIdFinal) {
        await tx.movimientoCaja.create({
          data: {
            empresaId,
            turnoId:    turnoIdFinal,
            tipo:       'ABONO_BITACORA',
            monto:      montoAbono,
            metodoPago: metodoPago || 'EFECTIVO',
            referencia: bitacora.folio,
            notas:      `Abono a bitácora ${bitacora.folio}${cerrar ? ' (liquidación completa)' : ''}`
          }
        })
      }
    })

    const accion = cerrar ? 'ABONO_BITACORA_CIERRE' : 'ABONO_BITACORA'
    const sufijo = esVenta ? '' : ' [MANUAL-sin caja]'
    await audit(usuarioId, sucursalId, accion, `${bitacora.folio} +$${montoAbono.toFixed(2)}${sufijo}`, empresaId)

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
  agregarProductosBatch,
  editarDetalle,
  quitarProducto,
  registrarAbono
}