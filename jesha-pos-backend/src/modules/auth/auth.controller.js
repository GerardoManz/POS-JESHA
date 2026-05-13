const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../../lib/prisma')

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

    const Sucursal = usuario.SucursalId
      ? await prisma.Sucursal.findUnique({ where: { id: usuario.SucursalId }, select: { id: true, nombre: true } })
      : null

    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, nombre: usuario.nombre, rol: usuario.rol, SucursalId: usuario.SucursalId },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )

    await prisma.auditoria.create({
      data: { usuarioId: usuario.id, SucursalId: usuario.SucursalId, accion: 'LOGIN', modulo: 'auth', ip: req.ip }
    })

    res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, username: usuario.username, rol: usuario.rol, Sucursal }
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
      select: { id: true, nombre: true, username: true, rol: true, SucursalId: true }
    })
    const Sucursal = usuario.SucursalId
      ? await prisma.Sucursal.findUnique({ where: { id: usuario.SucursalId }, select: { id: true, nombre: true } })
      : null
    res.json({ usuario: { ...usuario, Sucursal } })
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { login, me }
