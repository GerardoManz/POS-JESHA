const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const bcrypt = require('bcrypt')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function registrarAudit(solicitante, accion, referencia, ip) {
  try {
    const data = {
      usuario: { connect: { id: solicitante.id } },
      accion,
      modulo: 'usuarios',
      referencia,
      ip
    }
    if (solicitante.sucursalId) {
      data.sucursal = { connect: { id: solicitante.sucursalId } }
    }
    await prisma.auditoria.create({ data })
  } catch (e) {
    console.error('Audit error:', e.message)
  }
}

// GET /usuarios
const listar = async (req, res) => {
  try {
    const { rol, sucursalId, buscar } = req.query
    const solicitante = req.usuario
    const where = {}

    if (solicitante.rol === 'ADMIN_SUCURSAL') {
      where.sucursalId = solicitante.sucursalId
      where.rol = { not: 'SUPERADMIN' }
    }

    if (rol) where.rol = rol
    if (sucursalId) where.sucursalId = parseInt(sucursalId)
    if (buscar) {
      where.OR = [
        { nombre: { contains: buscar, mode: 'insensitive' } },
        { username: { contains: buscar, mode: 'insensitive' } }
      ]
    }

    const usuarios = await prisma.usuario.findMany({
      where,
      select: {
        id: true, nombre: true, username: true, rol: true, activo: true, creadoEn: true,
        sucursal: { select: { id: true, nombre: true } },
        auditorias: {
          where: { accion: 'LOGIN' },
          orderBy: { creadoEn: 'desc' },
          take: 1,
          select: { creadoEn: true }
        }
      },
      orderBy: { creadoEn: 'desc' }
    })

    const resultado = usuarios.map(u => ({
      ...u,
      ultimoLogin: u.auditorias[0]?.creadoEn || null,
      auditorias: undefined
    }))

    res.json(resultado)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al obtener usuarios' })
  }
}

// POST /usuarios
const crear = async (req, res) => {
  try {
    const { nombre, username, password, confirmarPassword, rol, sucursalId } = req.body
    const solicitante = req.usuario

    if (!nombre || !username || !password || !rol)
      return res.status(400).json({ error: 'Faltan campos obligatorios' })

    if (password !== confirmarPassword)
      return res.status(400).json({ error: 'Las contrasenas no coinciden' })

    if (solicitante.rol === 'ADMIN_SUCURSAL') {
      if (rol === 'SUPERADMIN') return res.status(403).json({ error: 'No tienes permiso para crear superadmin' })
      if (rol === 'ADMIN_SUCURSAL') return res.status(403).json({ error: 'No tienes permiso para crear administradores' })
    }

    const existe = await prisma.usuario.findUnique({ where: { username } })
    if (existe) return res.status(409).json({ error: 'El nombre de usuario ya existe' })

    const sucId = solicitante.rol === 'ADMIN_SUCURSAL'
      ? solicitante.sucursalId
      : (sucursalId ? parseInt(sucursalId) : null)

    const hash = await bcrypt.hash(password, 10)

    const usuario = await prisma.usuario.create({
      data: { nombre, username, passwordHash: hash, rol, sucursalId: sucId, activo: true },
      select: { id: true, nombre: true, username: true, rol: true, activo: true, sucursal: { select: { id: true, nombre: true } } }
    })

    await registrarAudit(solicitante, 'CREAR_USUARIO', `${solicitante.nombre} creo al usuario ${username} con rol ${rol}`, req.ip)

    res.status(201).json(usuario)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al crear usuario' })
  }
}

// PUT /usuarios/:id
const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, username, rol, sucursalId } = req.body
    const solicitante = req.usuario

    const objetivo = await prisma.usuario.findUnique({ where: { id: parseInt(id) } })
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado' })

    if (solicitante.rol === 'ADMIN_SUCURSAL') {
      if (parseInt(id) === solicitante.id && rol && rol !== objetivo.rol)
        return res.status(403).json({ error: 'No puedes cambiar tu propio rol' })
      if (objetivo.rol === 'SUPERADMIN')
        return res.status(403).json({ error: 'No puedes editar a un superadmin' })
    }

    const data = { nombre, username }
    if (rol) data.rol = rol
    if (sucursalId !== undefined) data.sucursalId = sucursalId ? parseInt(sucursalId) : null

    const usuario = await prisma.usuario.update({
      where: { id: parseInt(id) },
      data,
      select: { id: true, nombre: true, username: true, rol: true, activo: true, sucursal: { select: { id: true, nombre: true } } }
    })

    await registrarAudit(solicitante, 'EDITAR_USUARIO', `${solicitante.nombre} edito al usuario ${objetivo.username}`, req.ip)

    res.json(usuario)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al editar usuario' })
  }
}

// PATCH /usuarios/:id/estado
const cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params
    const { activo } = req.body
    const solicitante = req.usuario

    const objetivo = await prisma.usuario.findUnique({ where: { id: parseInt(id) } })
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado' })

    if (solicitante.rol === 'ADMIN_SUCURSAL' && objetivo.rol !== 'VENDEDOR')
      return res.status(403).json({ error: 'Solo puedes desactivar empleados' })

    const usuario = await prisma.usuario.update({
      where: { id: parseInt(id) },
      data: { activo },
      select: { id: true, nombre: true, activo: true }
    })

    const accion = activo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO'
    const detalle = `${solicitante.nombre} ${activo ? 'activo' : 'desactivo'} al usuario ${objetivo.username}`
    
    await registrarAudit(solicitante, accion, detalle, req.ip)
    res.json(usuario)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al cambiar estado' })
  }
}

// POST /usuarios/:id/reset-password
const resetPassword = async (req, res) => {
  try {
    const { id } = req.params
    const { password, confirmarPassword } = req.body
    const solicitante = req.usuario

    if (!password || !confirmarPassword) return res.status(400).json({ error: 'Faltan campos obligatorios' })
    if (password !== confirmarPassword) return res.status(400).json({ error: 'Las contrasenas no coinciden' })
    if (password.length < 6) return res.status(400).json({ error: 'Minimo 6 caracteres' })

    const objetivo = await prisma.usuario.findUnique({ where: { id: parseInt(id) } })
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado' })

    if (solicitante.rol === 'ADMIN_SUCURSAL' && objetivo.rol !== 'VENDEDOR')
      return res.status(403).json({ error: 'Solo puedes resetear contrasenas de empleados' })

    const hash = await bcrypt.hash(password, 10)
    await prisma.usuario.update({ where: { id: parseInt(id) }, data: { passwordHash: hash } })

    await registrarAudit(solicitante, 'RESET_PASSWORD', `${solicitante.nombre} reseteo la contrasena de ${objetivo.username}`, req.ip)

    res.json({ mensaje: 'Contrasena actualizada correctamente' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al resetear contrasena' })
  }
}

// GET /usuarios/sucursales
const listarSucursales = async (req, res) => {
  try {
    const sucursales = await prisma.sucursal.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } })
    res.json(sucursales)
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener sucursales' })
  }
}

module.exports = { listar, crear, editar, cambiarEstado, resetPassword, listarSucursales }