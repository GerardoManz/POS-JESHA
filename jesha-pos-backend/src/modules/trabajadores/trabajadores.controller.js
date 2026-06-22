const prisma       = require('../../lib/prisma')
const getEmpresaId  = require('../../helpers/getEmpresaId')

// ── Auditoría ──
async function audit(usuarioId, sucursalId, accion, ref, empresaId) {
  try {
    await prisma.auditoria.create({
      data: { accion, modulo: 'trabajadores', referencia: ref, usuarioId, sucursalId, empresaId }
    })
  } catch (_) { /* no interrumpir la operación principal */ }
}

// ════════════════════════════════════════════════════════════════════
//  GET /trabajadores
//  ?activo=true|false|all  (default: true)
// ════════════════════════════════════════════════════════════════════
const listar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { activo, buscar } = req.query
    const where = { empresaId }
    if (activo === 'false' || activo === 'all') {
      // no filtrar
    } else {
      where.activo = true
    }
    if (buscar?.trim()) {
      const q = buscar.trim()
      where.OR = [
        { nombre:   { contains: q, mode: 'insensitive' } },
        { apodo:    { contains: q, mode: 'insensitive' } },
        { telefono: { contains: q, mode: 'insensitive' } },
        { notas:    { contains: q, mode: 'insensitive' } }
      ]
    }

    const trabajadores = await prisma.trabajador.findMany({
      where,
      select: { id: true, nombre: true, apodo: true, telefono: true, notas: true, activo: true, creadoEn: true },
      orderBy: { nombre: 'asc' }
    })
    res.json(trabajadores)
  } catch (err) {
    console.error('❌ listar trabajadores:', err)
    res.status(500).json({ error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /trabajadores
// ════════════════════════════════════════════════════════════════════
const crear = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { id: usuarioId, sucursalId } = req.usuario
    const { nombre, apodo, telefono, notas } = req.body

    const nombreTrim = nombre?.trim()
    if (!nombreTrim) return res.status(400).json({ error: 'El nombre es obligatorio' })

    // Validar unicidad compuesta
    const existe = await prisma.trabajador.findUnique({
      where: { empresaId_nombre: { empresaId, nombre: nombreTrim } }
    })
    if (existe) return res.status(409).json({ error: 'Ya existe un trabajador con ese nombre en esta empresa' })

    const trabajador = await prisma.trabajador.create({
      data: {
        empresaId,
        nombre: nombreTrim,
        apodo: apodo?.trim() || null,
        telefono: telefono?.trim() || null,
        notas: notas?.trim() || null
      },
      select: { id: true, nombre: true, apodo: true, telefono: true, notas: true, activo: true, creadoEn: true }
    })

    await audit(usuarioId, sucursalId, 'CREAR_TRABAJADOR', `ID ${trabajador.id} — ${trabajador.nombre}`, empresaId)
    res.status(201).json(trabajador)
  } catch (err) {
    console.error('❌ crear trabajador:', err)
    if (err.code === 'P2002') return res.status(409).json({ error: 'Ya existe un trabajador con ese nombre en esta empresa' })
    res.status(500).json({ error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PUT /trabajadores/:id
// ════════════════════════════════════════════════════════════════════
const editar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { id: usuarioId, sucursalId } = req.usuario
    const { id } = req.params
    const { nombre, apodo, telefono, notas } = req.body

    const existente = await prisma.trabajador.findUnique({ where: { id: parseInt(id) } })
    if (!existente || existente.empresaId !== empresaId) return res.status(404).json({ error: 'Trabajador no encontrado' })

    const nombreTrim = nombre?.trim()
    const data = {}
    if (nombreTrim !== undefined) data.nombre = nombreTrim
    if (apodo !== undefined) data.apodo = apodo?.trim() || null
    if (telefono !== undefined) data.telefono = telefono?.trim() || null
    if (notas !== undefined) data.notas = notas?.trim() || null

    if (!data.nombre && data.nombre !== undefined) return res.status(400).json({ error: 'El nombre no puede estar vacío' })

    // Validar unicidad si cambió nombre
    if (data.nombre && data.nombre !== existente.nombre) {
      const dupe = await prisma.trabajador.findUnique({
        where: { empresaId_nombre: { empresaId, nombre: data.nombre } }
      })
      if (dupe) return res.status(409).json({ error: 'Ya existe un trabajador con ese nombre en esta empresa' })
    }

    const trabajador = await prisma.trabajador.update({
      where: { id: parseInt(id) },
      data,
      select: { id: true, nombre: true, apodo: true, telefono: true, notas: true, activo: true, creadoEn: true }
    })

    await audit(usuarioId, sucursalId, 'EDITAR_TRABAJADOR', `ID ${trabajador.id} — ${trabajador.nombre}`, empresaId)
    res.json(trabajador)
  } catch (err) {
    console.error('❌ editar trabajador:', err)
    if (err.code === 'P2002') return res.status(409).json({ error: 'Ya existe un trabajador con ese nombre en esta empresa' })
    res.status(500).json({ error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /trabajadores/:id/estado
// ════════════════════════════════════════════════════════════════════
const cambiarEstado = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { id: usuarioId, sucursalId } = req.usuario
    const { id } = req.params
    const { activo } = req.body

    const existente = await prisma.trabajador.findUnique({ where: { id: parseInt(id) } })
    if (!existente || existente.empresaId !== empresaId) return res.status(404).json({ error: 'Trabajador no encontrado' })

    const trabajador = await prisma.trabajador.update({
      where: { id: parseInt(id) },
      data: { activo: activo === true || activo === 'true' },
      select: { id: true, nombre: true, apodo: true, telefono: true, notas: true, activo: true, creadoEn: true }
    })

    await audit(usuarioId, sucursalId, trabajador.activo ? 'ACTIVAR_TRABAJADOR' : 'DESACTIVAR_TRABAJADOR', `ID ${trabajador.id} — ${trabajador.nombre}`, empresaId)
    res.json(trabajador)
  } catch (err) {
    console.error('❌ cambiar estado trabajador:', err)
    res.status(500).json({ error: err.message })
  }
}

module.exports = { listar, crear, editar, cambiarEstado }
