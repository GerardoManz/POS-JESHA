// ════════════════════════════════════════════════════════════════════
//  PEDIDOS.CONTROLLER.JS
//  Ubicación: src/modules/pedidos/pedidos.controller.js
//  Estados: BORRADOR → ACTIVO → EJECUTADO | CANCELADO
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// ── Folio ──
async function generarFolio() {
  const d   = new Date()
  const str = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  const ultimo = await prisma.pedido.findFirst({
    where:   { folio: { startsWith: `PED-${str}` } },
    orderBy: { id: 'desc' },
    select:  { folio: true }
  })
  const sec = ultimo ? parseInt(ultimo.folio.split('-').pop()) + 1 : 1
  return `PED-${str}-${String(sec).padStart(5,'0')}`
}

// ── Auditoría ──
async function audit(usuarioId, sucursalId, accion, ref) {
  try {
    await prisma.auditoria.create({
      data: { accion, modulo: 'pedidos', referencia: ref, usuarioId, sucursalId }
    })
  } catch(e) { console.error('Audit error:', e.message) }
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

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [total, pedidos] = await Promise.all([
      prisma.pedido.count({ where }),
      prisma.pedido.findMany({ where, select: PEDIDO_SELECT, orderBy: { creadoEn: 'desc' }, skip, take: parseInt(limit) })
    ])

    res.json({ success: true, data: pedidos, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    console.error('❌ listar pedidos:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── GET /pedidos/:id ──
const obtener = async (req, res) => {
  try {
    const pedido = await prisma.pedido.findUnique({ where: { id: parseInt(req.params.id) }, select: PEDIDO_SELECT })
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' })
    res.json({ success: true, data: pedido })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /pedidos ──
const crear = async (req, res) => {
  try {
    const { clienteId, detalles, notas } = req.body
    const { id: usuarioId, sucursalId }  = req.usuario

    if (!clienteId) return res.status(400).json({ success: false, error: 'El cliente es requerido' })
    if (!detalles || detalles.length === 0)
      return res.status(400).json({ success: false, error: 'Agrega al menos un producto' })

    const ids = detalles.map(d => parseInt(d.productoId)).filter(Boolean)
    const productos = await prisma.producto.findMany({
      where:  { id: { in: ids }, activo: true },
      select: { id: true, precioBase: true }
    })
    const mapa = Object.fromEntries(productos.map(p => [p.id, p]))

    const rows = detalles.map(d => {
      const precio   = parseFloat(d.precioAcordado ?? mapa[parseInt(d.productoId)]?.precioBase ?? 0)
      const cantidad = parseInt(d.cantidad) || 1
      return { productoId: parseInt(d.productoId), cantidad, precioAcordado: precio, subtotal: parseFloat((precio * cantidad).toFixed(2)) }
    })

    const totalEstimado = parseFloat(rows.reduce((s, r) => s + r.subtotal, 0).toFixed(2))
    const folio = await generarFolio()

    const pedido = await prisma.pedido.create({
      data: { folio, sucursalId, usuarioId, clienteId: parseInt(clienteId), estado: 'BORRADOR',
              totalEstimado, notas: notas || null, detalles: { create: rows } },
      select: PEDIDO_SELECT
    })

    await audit(usuarioId, sucursalId, 'CREAR_PEDIDO', folio)
    res.status(201).json({ success: true, data: pedido })
  } catch (err) {
    console.error('❌ crear pedido:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── PUT /pedidos/:id ──
const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { clienteId, detalles, notas } = req.body
    const { id: usuarioId, sucursalId }  = req.usuario

    const existente = await prisma.pedido.findUnique({ where: { id: parseInt(id) }, select: { id: true, folio: true, estado: true } })
    if (!existente) return res.status(404).json({ success: false, error: 'Pedido no encontrado' })
    if (!['BORRADOR', 'ACTIVO'].includes(existente.estado))
      return res.status(400).json({ success: false, error: `No se puede editar en estado ${existente.estado}` })

    const updateData = {}
    if (clienteId !== undefined) updateData.clienteId = parseInt(clienteId)
    if (notas     !== undefined) updateData.notas     = notas

    if (detalles && detalles.length > 0) {
      const ids = detalles.map(d => parseInt(d.productoId)).filter(Boolean)
      const productos = await prisma.producto.findMany({ where: { id: { in: ids } }, select: { id: true, precioBase: true } })
      const mapa = Object.fromEntries(productos.map(p => [p.id, p]))
      const rows = detalles.map(d => {
        const precio   = parseFloat(d.precioAcordado ?? mapa[parseInt(d.productoId)]?.precioBase ?? 0)
        const cantidad = parseInt(d.cantidad) || 1
        return { productoId: parseInt(d.productoId), cantidad, precioAcordado: precio, subtotal: parseFloat((precio * cantidad).toFixed(2)) }
      })
      updateData.totalEstimado = parseFloat(rows.reduce((s, r) => s + r.subtotal, 0).toFixed(2))

      const pedido = await prisma.$transaction(async tx => {
        await tx.detallePedido.deleteMany({ where: { pedidoId: parseInt(id) } })
        return tx.pedido.update({ where: { id: parseInt(id) }, data: { ...updateData, detalles: { create: rows } }, select: PEDIDO_SELECT })
      })
      await audit(usuarioId, sucursalId, 'EDITAR_PEDIDO', existente.folio)
      return res.json({ success: true, data: pedido })
    }

    const pedido = await prisma.pedido.update({ where: { id: parseInt(id) }, data: updateData, select: PEDIDO_SELECT })
    await audit(usuarioId, sucursalId, 'EDITAR_PEDIDO', existente.folio)
    res.json({ success: true, data: pedido })
  } catch (err) {
    console.error('❌ editar pedido:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── PATCH /pedidos/:id/estado ──
const cambiarEstado = async (req, res) => {
  try {
    const { id }     = req.params
    const { estado, motivoBloqueo } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    const validos = ['BORRADOR', 'ACTIVO', 'EJECUTADO', 'CANCELADO']
    if (!validos.includes(estado)) return res.status(400).json({ success: false, error: `Estado inválido: ${estado}` })

    const existente = await prisma.pedido.findUnique({ where: { id: parseInt(id) }, select: { id: true, folio: true, estado: true } })
    if (!existente) return res.status(404).json({ success: false, error: 'Pedido no encontrado' })

    const pedido = await prisma.pedido.update({
      where: { id: parseInt(id) },
      data:  { estado, ...(motivoBloqueo && { motivoBloqueo }) },
      select: PEDIDO_SELECT
    })

    await audit(usuarioId, sucursalId, `ESTADO_PEDIDO_${estado}`, existente.folio)
    res.json({ success: true, data: pedido })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = { listar, obtener, crear, editar, cambiarEstado }
