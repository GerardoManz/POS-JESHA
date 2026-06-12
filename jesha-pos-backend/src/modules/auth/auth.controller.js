const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../../lib/prisma')

const TEMAS_VALIDOS = new Set(['dark', 'light'])

function serializarUsuario(usuario, Sucursal = null) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    username: usuario.username,
    rol: usuario.rol,
    sucursalId: usuario.sucursalId,
    empresaId: usuario.empresaId,
    tema: usuario.tema || 'dark',
    Sucursal
  }
}

const login = async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' })
    }

    const usuario = await prisma.usuario.findFirst({
      where: { username: username.trim(), activo: true }
    })

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    const passwordValida = await bcrypt.compare(password, usuario.passwordHash)
    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    const Sucursal = usuario.sucursalId
      ? await prisma.sucursal.findUnique({ where: { id: usuario.sucursalId }, select: { id: true, nombre: true } })
      : null

    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, nombre: usuario.nombre, rol: usuario.rol, sucursalId: usuario.sucursalId, empresaId: usuario.empresaId }, // Incluir empresaId en el payload del token JWT
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )

    await prisma.auditoria.create({
      data: { usuarioId: usuario.id, sucursalId: usuario.sucursalId, accion: 'LOGIN', modulo: 'auth', ip: req.ip }
    })

    res.json({
      token,
      usuario: serializarUsuario(usuario, Sucursal)
    })

  } catch (err) {
    console.error('Error en login:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const me = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      select: { id: true, nombre: true, username: true, rol: true, sucursalId: true, empresaId: true, tema: true }
    })
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })
    const Sucursal = usuario.sucursalId
      ? await prisma.sucursal.findUnique({ where: { id: usuario.sucursalId }, select: { id: true, nombre: true } })
      : null
    res.json({ usuario: serializarUsuario(usuario, Sucursal) })
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const actualizarPreferencias = async (req, res) => {
  try {
    const { tema } = req.body || {}

    if (!TEMAS_VALIDOS.has(tema)) {
      return res.status(400).json({ error: 'Tema inválido' })
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.usuario.id },
      data: { tema },
      select: { id: true, nombre: true, username: true, rol: true, sucursalId: true, empresaId: true, tema: true }
    })

    const Sucursal = usuario.sucursalId
      ? await prisma.sucursal.findUnique({ where: { id: usuario.sucursalId }, select: { id: true, nombre: true } })
      : null

    res.json({ usuario: serializarUsuario(usuario, Sucursal) })
  } catch (err) {
    console.error('Error actualizando preferencias:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { login, me, actualizarPreferencias }
