// ════════════════════════════════════════════════════════════════════
//  PEDIDOS.CONTROLLER.JS
//  Ubicación: src/modules/pedidos/pedidos.controller.js
//  Estados: BORRADOR → ACTIVO → EJECUTADO | CANCELADO
//           BORRADOR → PENDIENTE → ACTIVO
//           ACTIVO → BLOQUEADO → ACTIVO
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// ── Folio ──
async function generarFolio() {
  const d   = new Date()
  const str = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  const result = await prisma.$queryRaw`SELECT nextval('folio_pedido_seq') as seq`
  const sec = String(Number(result[0].seq)).padStart(5, '0')
  return `PED-${str}-${sec}`
}

// ── Resolver sucursal (SUPERADMIN tiene sucursalId = null en JWT) ──
async function resolverSucursal(sucursalIdToken, sucursalIdBody) {
  // 1. Si el token ya trae sucursal (ADMIN_SUCURSAL, EMPLEADO), usarla
  if (sucursalIdToken) return sucursalIdToken

  // 2. Si viene explícita del body (frontend con selector), usarla
  if (sucursalIdBody) return parseInt(sucursalIdBody)

  // 3. Auto-resolver: si solo hay 1 sucursal activa, usarla
  const sucursales = await prisma.sucursal.findMany({
    where: { activa: true },
    select: { id: true }
  })

  if (sucursales.length === 1) return sucursales[0].id

  // 4. Múltiples sucursales y no especificó → error
  return null
}

// ── Auditoría ──
async function audit(usuarioId, sucursalId, accion, ref) {
  try {
    await prisma.auditoria.create({
      data: { accion, modulo: 'pedidos', referencia: ref, usuarioId, sucursalId }
    })
  } catch(e) { console.error('Audit error:', e.message) }
}

// ── Máquina de estados válida ──
const TRANSICIONES_VALIDAS = {
  BORRADOR:  ['ACTIVO', 'PENDIENTE', 'CANCELADO'],
  PENDIENTE: ['ACTIVO', 'CANCELADO'],
  ACTIVO:    ['EJECUTADO', 'BLOQUEADO', 'CANCELADO'],
  BLOQUEADO: ['ACTIVO', 'CANCELADO'],
  // Estados terminales — no permiten transición
  EJECUTADO: [],
  CANCELADO: []
}

const PEDIDO_SELECT = {
  id: true, folio: true, estado: true, totalEstimado: true,
  motivoBloqueo: true, notas: true, creadoEn: true, actualizadoEn: true,
  cliente:  { select: { id: true, nombre: true, telefono: true } },
  usuario:  { select: { id: true, nombre: true } },
  sucursal: { select: { id: true, nombre: true } },
  detalles: {
    select: {
      id: true, cantidad: true, precioAcordado: true, subtotal: true,
      producto: { select: { id: true, nombre: true, codigoInterno: true, unidadVenta: true } }
    }
  }
}

// ── GET /pedidos ──
const listar = async (req, res) => {
  try {
    const { estado, clienteId, usuarioId, buscar, page = 1, limit = 25 } = req.query
    const { sucursalId, rol } = req.usuario
    const where = {}

    const pageInt  = Math.max(1, parseInt(page) || 1)
    const limitInt = Math.min(100, Math.max(1, parseInt(limit) || 25))

    if (rol !== 'SUPERADMIN' && sucursalId) where.sucursalId = sucursalId
    if (estado)    where.estado    = estado
    if (clienteId) where.clienteId = parseInt(clienteId)
    if (usuarioId) where.usuarioId = parseInt(usuarioId)

    if (buscar) {
      where.OR = [
        { folio:   { contains: buscar, mode: 'insensitive' } },
        { cliente: { nombre: { contains: buscar, mode: 'insensitive' } } },
        { notas:   { contains: buscar, mode: 'insensitive' } }
      ]
    }

    const skip = (pageInt - 1) * limitInt

    const [total, pedidos] = await Promise.all([
      prisma.pedido.count({ where }),
      prisma.pedido.findMany({
        where,
        select: PEDIDO_SELECT,
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limitInt
      })
    ])

    res.json({ success: true, data: pedidos, total, page: pageInt, limit: limitInt })
  } catch (err) {
    console.error('❌ listar pedidos:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── GET /pedidos/:id ──
const obtener = async (req, res) => {
  try {
    const pedido = await prisma.pedido.findUnique({
      where: { id: parseInt(req.params.id) },
      select: PEDIDO_SELECT
    })
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' })
    res.json({ success: true, data: pedido })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── Construir filas de detalle (reutilizable) ──
async function construirDetalles(detalles) {
  const ids = detalles.map(d => parseInt(d.productoId)).filter(Boolean)

  const productos = await prisma.producto.findMany({
    where:  { id: { in: ids }, activo: true },
    select: { id: true, precioBase: true, esGranel: true }
  })

  const mapa = Object.fromEntries(productos.map(p => [p.id, p]))

  // Validar que todos los productos existan y estén activos
  const noEncontrados = ids.filter(id => !mapa[id])
  if (noEncontrados.length > 0) {
    throw { status: 400, message: `Productos no encontrados o inactivos: ${noEncontrados.join(', ')}` }
  }

  return detalles.map(d => {
    const prodId   = parseInt(d.productoId)
    const precio   = parseFloat(d.precioAcordado ?? mapa[prodId]?.precioBase ?? 0)
    // FIX: parseFloat en lugar de parseInt para soportar granel
    const cantidad = parseFloat(d.cantidad) || 1
    return {
      productoId: prodId,
      cantidad,
      precioAcordado: precio,
      subtotal: parseFloat((precio * cantidad).toFixed(2))
    }
  })
}

// ── POST /pedidos ──
const crear = async (req, res) => {
  try {
    const { clienteId, detalles, notas, sucursalId: bodySucursalId } = req.body
    const { id: usuarioId, sucursalId }  = req.usuario

    // FIX: resolver sucursal inteligentemente
    const sucursalFinalId = await resolverSucursal(sucursalId, bodySucursalId)
    if (!sucursalFinalId) {
      return res.status(400).json({
        success: false,
        error: 'Hay múltiples sucursales activas. Selecciona una.'
      })
    }

    if (!detalles || detalles.length === 0) {
      return res.status(400).json({ success: false, error: 'Agrega al menos un producto' })
    }

    // clienteId es opcional en el schema — permitirlo como null
    const clienteIdFinal = clienteId ? parseInt(clienteId) : null

    const rows = await construirDetalles(detalles)
    const totalEstimado = parseFloat(rows.reduce((s, r) => s + r.subtotal, 0).toFixed(2))
    const folio = await generarFolio()

    const pedido = await prisma.pedido.create({
      data: {
        folio,
        sucursalId: sucursalFinalId,
        usuarioId,
        clienteId: clienteIdFinal,
        estado: 'BORRADOR',
        totalEstimado,
        notas: notas || null,
        detalles: { create: rows }
      },
      select: PEDIDO_SELECT
    })

    // FIX: usar sucursalFinalId para auditoría, no el null del JWT
    await audit(usuarioId, sucursalFinalId, 'CREAR_PEDIDO', folio)

    res.status(201).json({ success: true, data: pedido })

  } catch (err) {
    console.error('❌ crear pedido:', err)
    const status = err.status || 500
    res.status(status).json({ success: false, error: err.message })
  }
}

// ── PUT /pedidos/:id ──
const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { clienteId, detalles, notas, sucursalId: bodySucursalId } = req.body
    const { id: usuarioId, sucursalId }  = req.usuario

    const sucursalFinalId = await resolverSucursal(sucursalId, bodySucursalId)
    if (!sucursalFinalId) {
      return res.status(400).json({
        success: false,
        error: 'Hay múltiples sucursales activas. Selecciona una.'
      })
    }

    const existente = await prisma.pedido.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, estado: true }
    })

    if (!existente) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' })
    }

    if (!['BORRADOR', 'ACTIVO'].includes(existente.estado)) {
      return res.status(400).json({
        success: false,
        error: `No se puede editar en estado ${existente.estado}`
      })
    }

    if (detalles && detalles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Un pedido no puede quedarse sin productos'
      })
    }

    const updateData = {}
    if (clienteId !== undefined) updateData.clienteId = clienteId ? parseInt(clienteId) : null
    if (notas     !== undefined) updateData.notas     = notas

    if (detalles && detalles.length > 0) {
      // FIX: usa construirDetalles con filtro activo: true
      const rows = await construirDetalles(detalles)

      updateData.totalEstimado = parseFloat(
        rows.reduce((s, r) => s + r.subtotal, 0).toFixed(2)
      )

      const pedido = await prisma.$transaction(async tx => {
        await tx.detallePedido.deleteMany({
          where: { pedidoId: parseInt(id) }
        })

        return tx.pedido.update({
          where: { id: parseInt(id) },
          data: {
            ...updateData,
            sucursalId: sucursalFinalId,
            detalles: { create: rows }
          },
          select: PEDIDO_SELECT
        })
      })

      // FIX: usar sucursalFinalId
      await audit(usuarioId, sucursalFinalId, 'EDITAR_PEDIDO', existente.folio)

      return res.json({ success: true, data: pedido })
    }

    const pedido = await prisma.pedido.update({
      where: { id: parseInt(id) },
      data: { ...updateData, sucursalId: sucursalFinalId },
      select: PEDIDO_SELECT
    })

    await audit(usuarioId, sucursalFinalId, 'EDITAR_PEDIDO', existente.folio)

    res.json({ success: true, data: pedido })

  } catch (err) {
    console.error('❌ editar pedido:', err)
    const status = err.status || 500
    res.status(status).json({ success: false, error: err.message })
  }
}

// ── PATCH /pedidos/:id/estado ──
const cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params
    const { estado, motivoBloqueo } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    const existente = await prisma.pedido.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, estado: true, sucursalId: true }
    })

    if (!existente) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' })
    }

    // FIX: validar transición con máquina de estados
    const permitidos = TRANSICIONES_VALIDAS[existente.estado]
    if (!permitidos || !permitidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        error: `No se puede cambiar de ${existente.estado} a ${estado}. Transiciones válidas: ${(permitidos || []).join(', ') || 'ninguna (estado terminal)'}`
      })
    }

    // FIX: BLOQUEADO requiere motivo
    if (estado === 'BLOQUEADO' && !motivoBloqueo) {
      return res.status(400).json({
        success: false,
        error: 'Debes especificar un motivo de bloqueo'
      })
    }

    const updateData = { estado }
    if (motivoBloqueo) updateData.motivoBloqueo = motivoBloqueo
    // Limpiar motivo si se desbloquea
    if (estado === 'ACTIVO' && existente.estado === 'BLOQUEADO') {
      updateData.motivoBloqueo = null
    }

    const pedido = await prisma.pedido.update({
      where: { id: parseInt(id) },
      data:  updateData,
      select: PEDIDO_SELECT
    })

    // FIX: usar sucursalId del pedido existente, no del JWT
    const sucAudit = sucursalId || existente.sucursalId
    await audit(usuarioId, sucAudit, `ESTADO_PEDIDO_${estado}`, existente.folio)

    res.json({ success: true, data: pedido })

  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = { listar, obtener, crear, editar, cambiarEstado }