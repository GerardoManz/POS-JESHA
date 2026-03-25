// ════════════════════════════════════════════════════════════════════
//  COTIZACIONES.SERVICE.JS — v2
//  Soporta tipo PRODUCTOS (con descuento por línea) y SERVICIOS
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

async function generarFolio() {
  const fecha = new Date()
  const año   = fecha.getFullYear()
  const mes   = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia   = String(fecha.getDate()).padStart(2, '0')
  const ultima = await prisma.cotizacion.findFirst({
    where:   { folio: { startsWith: `COT-${año}${mes}${dia}` } },
    orderBy: { id: 'desc' },
    select:  { folio: true }
  })
  let secuencial = 1
  if (ultima) {
    const partes = ultima.folio.split('-')
    secuencial = parseInt(partes[partes.length - 1]) + 1
  }
  return `COT-${año}${mes}${dia}-${String(secuencial).padStart(5, '0')}`
}

async function audit(usuarioId, sucursalId, accion, referencia) {
  try {
    const data = { accion, modulo: 'cotizaciones', referencia }
    if (usuarioId)  data.usuarioId  = usuarioId
    if (sucursalId) data.sucursalId = sucursalId
    await prisma.auditoria.create({ data })
  } catch (e) { console.error('Audit error:', e.message) }
}

const COTIZACION_SELECT = {
  id: true, folio: true, estado: true, tipo: true, total: true,
  venceEn: true, notas: true, creadaEn: true,
  cliente:  { select: { id: true, nombre: true, rfc: true, telefono: true } },
  usuario:  { select: { id: true, nombre: true } },
  sucursal: { select: { id: true, nombre: true } },
  detalles: {
    select: {
      id: true, cantidad: true, precioUnitario: true, descuento: true,
      subtotal: true, concepto: true, unidad: true,
      producto: {
        select: { id: true, nombre: true, codigoInterno: true,
                  codigoBarras: true, unidadVenta: true, imagenUrl: true }
      }
    }
  }
}

function calcularDetalle(precioUnitario, cantidad, descuento) {
  const pu  = parseFloat(precioUnitario)
  const qty = parseInt(cantidad)
  const dto = parseFloat(descuento || 0)
  const importe  = parseFloat((pu * qty).toFixed(2))
  const subtotal = parseFloat((importe - dto).toFixed(2))
  return { precioUnitario: pu, cantidad: qty, descuento: dto, subtotal }
}

async function listar({ sucursalId, rol, estado, excluirCanceladas, tipo, buscar, page = 1, limit = 30 }) {
  const where = {}
  if (rol !== 'SUPERADMIN' && sucursalId) where.sucursalId = sucursalId

  // Filtro de estado: si viene explícito úsalo, si no excluir CANCELADA
  if (estado) {
    where.estado = estado
  } else if (excluirCanceladas === 'EXCLUIR') {
    where.estado = { not: 'CANCELADA' }
  }

  if (tipo)   where.tipo = tipo
  if (buscar) {
    where.OR = [
      { folio:   { contains: buscar, mode: 'insensitive' } },
      { cliente: { nombre: { contains: buscar, mode: 'insensitive' } } },
      { notas:   { contains: buscar, mode: 'insensitive' } }
    ]
  }
  const skip = (parseInt(page) - 1) * parseInt(limit)
  const [total, cotizaciones] = await Promise.all([
    prisma.cotizacion.count({ where }),
    prisma.cotizacion.findMany({ where, select: COTIZACION_SELECT, orderBy: { creadaEn: 'desc' }, skip, take: parseInt(limit) })
  ])
  return { cotizaciones, total, page: parseInt(page), limit: parseInt(limit) }
}

async function obtenerPorId(id) {
  return prisma.cotizacion.findUnique({ where: { id: parseInt(id) }, select: COTIZACION_SELECT })
}

async function crear({ sucursalId, usuarioId, clienteId, tipo = 'PRODUCTOS', detalles, notas, venceEn }) {
  clienteId = clienteId ? parseInt(clienteId) : null
  if (isNaN(clienteId)) clienteId = null

  let rows = []

  if (tipo === 'PRODUCTOS') {
    const ids = detalles.map(d => parseInt(d.productoId)).filter(Boolean)
    const productos = await prisma.producto.findMany({
      where: { id: { in: ids }, activo: true },
      select: { id: true, nombre: true, precioBase: true, unidadVenta: true }
    })
    if (productos.length !== ids.length) {
      const enc = productos.map(p => p.id)
      throw new Error(`Productos no encontrados: ${ids.filter(i => !enc.includes(i)).join(', ')}`)
    }
    const mapa = Object.fromEntries(productos.map(p => [p.id, p]))
    rows = detalles.map(d => {
      const pid  = parseInt(d.productoId)
      const p    = mapa[pid]
      const precioFinal = p ? (d.precioUnitario ?? p.precioBase) : (d.precioUnitario || 0)
      const calc = calcularDetalle(precioFinal, d.cantidad, d.descuento)
      return {
        productoId: pid,
        concepto:   p?.nombre || d.concepto || null,
        unidad:     d.unidad || p?.unidadVenta || 'PZA',
        ...calc
      }
    })
  } else {
    rows = detalles.map(d => {
      const calc = calcularDetalle(d.precioUnitario, d.cantidad, d.descuento)
      return { concepto: d.concepto || '', unidad: d.unidad || '', ...calc }
    })
  }

  const total = parseFloat(rows.reduce((s, r) => s + r.subtotal, 0).toFixed(2))
  const folio = await generarFolio()

  const cotizacion = await prisma.cotizacion.create({
    data: { folio, sucursalId, usuarioId, clienteId, tipo, total, estado: 'PENDIENTE',
            notas: notas || null, venceEn: venceEn ? new Date(venceEn) : null,
            detalles: { create: rows } },
    select: COTIZACION_SELECT
  })
  await audit(usuarioId, sucursalId, 'CREAR_COTIZACION', folio)
  return cotizacion
}

async function editar(id, { clienteId, notas, venceEn, detalles, tipo, usuarioId, sucursalId }) {
  clienteId = clienteId ? parseInt(clienteId) : null
  if (isNaN(clienteId)) clienteId = null

  const existente = await prisma.cotizacion.findUnique({
    where: { id: parseInt(id) }, select: { id: true, folio: true, estado: true, tipo: true }
  })
  if (!existente) throw new Error('Cotización no encontrada')
  if (existente.estado !== 'PENDIENTE') throw new Error(`No se puede editar en estado ${existente.estado}`)

  const tipoFinal  = tipo || existente.tipo
  const updateData = {}
  if (clienteId !== undefined) updateData.clienteId = clienteId || null
  if (notas     !== undefined) updateData.notas     = notas
  if (venceEn   !== undefined) updateData.venceEn   = venceEn ? new Date(venceEn) : null
  if (tipo)                    updateData.tipo       = tipo

  if (detalles && detalles.length > 0) {
    let rows = []
    if (tipoFinal === 'PRODUCTOS') {
      const ids = detalles.map(d => parseInt(d.productoId)).filter(Boolean)
      const productos = await prisma.producto.findMany({
        where: { id: { in: ids }, activo: true },
        select: { id: true, nombre: true, precioBase: true, unidadVenta: true }
      })
      const mapa = Object.fromEntries(productos.map(p => [p.id, p]))
      rows = detalles.map(d => {
        const pid  = parseInt(d.productoId)
        const p    = mapa[pid]
        // Guard: si el producto no está en el mapa usar los valores que vienen del frontend
        const precioFinal = p ? (d.precioUnitario ?? p.precioBase) : (d.precioUnitario || 0)
        const calc = calcularDetalle(precioFinal, d.cantidad, d.descuento)
        return {
          productoId: pid,
          concepto:   p?.nombre || d.concepto || null,
          unidad:     d.unidad || p?.unidadVenta || 'PZA',
          ...calc
        }
      })
    } else {
      rows = detalles.map(d => {
        const calc = calcularDetalle(d.precioUnitario, d.cantidad, d.descuento)
        return { concepto: d.concepto || '', unidad: d.unidad || '', ...calc }
      })
    }
    updateData.total = parseFloat(rows.reduce((s, r) => s + r.subtotal, 0).toFixed(2))
    const cot = await prisma.$transaction(async (tx) => {
      await tx.detalleCotizacion.deleteMany({ where: { cotizacionId: parseInt(id) } })
      return tx.cotizacion.update({ where: { id: parseInt(id) }, data: { ...updateData, detalles: { create: rows } }, select: COTIZACION_SELECT })
    })
    await audit(usuarioId, sucursalId, 'EDITAR_COTIZACION', existente.folio)
    return cot
  }

  const cot = await prisma.cotizacion.update({ where: { id: parseInt(id) }, data: updateData, select: COTIZACION_SELECT })
  await audit(usuarioId, sucursalId, 'EDITAR_COTIZACION', existente.folio)
  return cot
}

async function cambiarEstado(id, estado, { usuarioId, sucursalId }) {
  const validos = ['PENDIENTE', 'CONVERTIDA', 'VENCIDA', 'CANCELADA']
  if (!validos.includes(estado)) throw new Error(`Estado inválido: ${estado}`)
  const existente = await prisma.cotizacion.findUnique({ where: { id: parseInt(id) }, select: { id: true, folio: true } })
  if (!existente) throw new Error('Cotización no encontrada')
  const cot = await prisma.cotizacion.update({ where: { id: parseInt(id) }, data: { estado }, select: COTIZACION_SELECT })
  await audit(usuarioId, sucursalId, `ESTADO_COTIZACION_${estado}`, existente.folio)
  return cot
}

module.exports = { listar, obtenerPorId, crear, editar, cambiarEstado }