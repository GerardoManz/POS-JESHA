// ════════════════════════════════════════════════════════════════════
//  PROVEEDORES.CONTROLLER.JS
//  src/modules/proveedores/proveedores.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')

async function audit(usuarioId, sucursalId, accion, ref) {
  try { await prisma.auditoria.create({ data: { accion, modulo: 'proveedores', referencia: ref, usuarioId, sucursalId } }) }
  catch(e) { console.error('Audit:', e.message) }
}

const PROVEEDOR_SELECT = {
  id: true, nombreOficial: true, alias: true, telefono: true, celular: true, email: true, activo: true, creadoEn: true,
  _count: { select: { OrdenCompra: true, ProveedorProducto: true } }
}

// ── GET /proveedores ──
const listar = async (req, res) => {
  try {
    const { buscar, activo, page = 1, limit = 25 } = req.query
    const empresaId = getEmpresaId(req)
    const where = { empresaId }

    if (activo === 'true') where.activo = true
    else if (activo === 'false') where.activo = false

    if (buscar) {
      where.OR = [
        { nombreOficial: { contains: buscar, mode: 'insensitive' } },
        { alias:         { contains: buscar, mode: 'insensitive' } },
        { telefono:      { contains: buscar, mode: 'insensitive' } },
        { celular:       { contains: buscar, mode: 'insensitive' } },
        { email:         { contains: buscar, mode: 'insensitive' } }
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [total, proveedores] = await Promise.all([
      prisma.proveedor.count({ where }),
      prisma.proveedor.findMany({ where, select: PROVEEDOR_SELECT, orderBy: { nombreOficial: 'asc' }, skip, take: parseInt(limit) })
    ])
    res.json({ success: true, data: proveedores, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    console.error('Error listar proveedores:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── GET /proveedores/:id ──
const obtener = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const proveedor = await prisma.proveedor.findFirst({
      where: { id: parseInt(req.params.id), empresaId },
      select: {
        ...PROVEEDOR_SELECT,
        ProveedorProducto: {
          where: { activo: true },
          select: {
            id: true, codigoProveedor: true, precioCosto: true, activo: true, unidadCompra: true, factorConversion: true,
            Producto: { select: { id: true, nombre: true, codigoInterno: true, codigoBarras: true, precioVenta: true, costo: true, unidadCompra: true, unidadVenta: true, activo: true } }
          },
          orderBy: { Producto: { nombre: 'asc' } }
        }
      }
    })
    if (!proveedor) return res.status(404).json({ success: false, error: 'Proveedor no encontrado' })
    res.json({ success: true, data: proveedor })
  } catch (err) {
    console.error('Error obtener proveedor:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /proveedores ──
const crear = async (req, res) => {
  try {
    const { nombreOficial, alias, telefono, celular, email } = req.body
    if (!nombreOficial?.trim()) return res.status(400).json({ success: false, error: 'Nombre oficial requerido' })

    const empresaId = getEmpresaId(req)
    const proveedor = await prisma.proveedor.create({
      data: { empresaId, nombreOficial: nombreOficial.trim(), alias: alias?.trim() || null, telefono: telefono || null, celular: celular || null, email: email || null }
    })
    await audit(req.usuario.id, req.usuario.sucursalId, 'CREAR_PROVEEDOR', proveedor.nombreOficial)
    res.status(201).json({ success: true, data: proveedor })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'Ya existe un proveedor con ese nombre o alias en esta empresa' })
    console.error('Error crear proveedor:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── PUT /proveedores/:id ──
const editar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { nombreOficial, alias, telefono, celular, email, activo } = req.body

    const existente = await prisma.proveedor.findFirst({ where: { id: parseInt(req.params.id), empresaId } })
    if (!existente) return res.status(404).json({ success: false, error: 'Proveedor no encontrado' })

    const data = {}
    if (nombreOficial !== undefined) data.nombreOficial = nombreOficial.trim()
    if (alias !== undefined) data.alias = alias?.trim() || null
    if (telefono !== undefined) data.telefono = telefono || null
    if (celular !== undefined) data.celular = celular || null
    if (email !== undefined) data.email = email || null
    if (activo !== undefined) data.activo = activo

    const proveedor = await prisma.proveedor.update({ where: { id: parseInt(req.params.id) }, data })
    await audit(req.usuario.id, req.usuario.sucursalId, 'EDITAR_PROVEEDOR', proveedor.nombreOficial)
    res.json({ success: true, data: proveedor })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'Ya existe un proveedor con ese nombre o alias en esta empresa' })
    console.error('Error editar proveedor:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── PATCH /proveedores/:id/activar ──
const toggleActivo = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const proveedor = await prisma.proveedor.findFirst({ where: { id: parseInt(req.params.id), empresaId } })
    if (!proveedor) return res.status(404).json({ success: false, error: 'Proveedor no encontrado' })

    const updated = await prisma.proveedor.update({
      where: { id: parseInt(req.params.id) },
      data: { activo: !proveedor.activo }
    })
    const accion = updated.activo ? 'ACTIVAR_PROVEEDOR' : 'DESACTIVAR_PROVEEDOR'
    await audit(req.usuario.id, req.usuario.sucursalId, accion, updated.nombreOficial)
    res.json({ success: true, data: updated })
  } catch (err) {
    console.error('Error toggle proveedor:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── GET /proveedores/:id/compras ──
const historialCompras = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { limit = 20 } = req.query

    const ordenes = await prisma.ordenCompra.findMany({
      where: { proveedorId: parseInt(req.params.id), empresaId },
      select: {
        id: true, folio: true, estado: true, totalEstimado: true, totalPagado: true, pagada: true, creadaEn: true, recibidaEn: true,
        Sucursal: { select: { nombre: true } },
        Usuario: { select: { nombre: true } },
        _count: { select: { DetalleOrdenCompra: true } }
      },
      orderBy: { creadaEn: 'desc' },
      take: parseInt(limit)
    })
    res.json({ success: true, data: ordenes })
  } catch (err) {
    console.error('Error historial compras:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /proveedores/:id/productos ──
const vincularProducto = async (req, res) => {
  try {
    const { productoId, codigoProveedor, precioCosto, unidadCompra, factorConversion } = req.body
    const proveedorId = parseInt(req.params.id)

    if (!productoId) return res.status(400).json({ success: false, error: 'Producto requerido' })

    const pp = await prisma.proveedorProducto.upsert({
      where: { proveedorId_productoId: { proveedorId, productoId: parseInt(productoId) } },
      update: {
        codigoProveedor: codigoProveedor || null,
        precioCosto: parseFloat(precioCosto || 0),
        unidadCompra: unidadCompra || null,
        factorConversion: factorConversion ? parseFloat(factorConversion) : null,
        activo: true
      },
      create: {
        proveedorId,
        productoId: parseInt(productoId),
        codigoProveedor: codigoProveedor || null,
        precioCosto: parseFloat(precioCosto || 0),
        unidadCompra: unidadCompra || null,
        factorConversion: factorConversion ? parseFloat(factorConversion) : null,
        activo: true
      },
      select: {
        id: true, codigoProveedor: true, precioCosto: true, activo: true, unidadCompra: true, factorConversion: true,
        Producto: { select: { id: true, nombre: true, codigoInterno: true } }
      }
    })
    await audit(req.usuario.id, req.usuario.sucursalId, 'VINCULAR_PRODUCTO', `Prov:${proveedorId} Prod:${productoId}`)
    res.status(201).json({ success: true, data: pp })
  } catch (err) {
    console.error('Error vincular producto:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── DELETE /proveedores/:id/productos/:prodId ──
const desvincularProducto = async (req, res) => {
  try {
    const proveedorId = parseInt(req.params.id)
    const productoId = parseInt(req.params.prodId)

    const pp = await prisma.proveedorProducto.findUnique({
      where: { proveedorId_productoId: { proveedorId, productoId } }
    })
    if (!pp) return res.status(404).json({ success: false, error: 'Relación no encontrada' })

    await prisma.proveedorProducto.update({
      where: { proveedorId_productoId: { proveedorId, productoId } },
      data: { activo: false }
    })
    await audit(req.usuario.id, req.usuario.sucursalId, 'DESVINCULAR_PRODUCTO', `Prov:${proveedorId} Prod:${productoId}`)
    res.json({ success: true, message: 'Producto desvinculado' })
  } catch (err) {
    console.error('Error desvincular producto:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = { listar, obtener, crear, editar, toggleActivo, historialCompras, vincularProducto, desvincularProducto }
