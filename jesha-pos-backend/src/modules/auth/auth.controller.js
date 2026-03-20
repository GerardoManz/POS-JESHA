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
where: { username: username.trim(), activo: true },      include: { sucursal: { select: { id: true, nombre: true } } }
    })

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    const passwordValida = await bcrypt.compare(password, usuario.passwordHash)
    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, nombre: usuario.nombre, rol: usuario.rol, sucursalId: usuario.sucursalId },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )

    await prisma.auditoria.create({
      data: { usuarioId: usuario.id, sucursalId: usuario.sucursalId, accion: 'LOGIN', modulo: 'auth', ip: req.ip }
    })

    res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, username: usuario.username, rol: usuario.rol, sucursal: usuario.sucursal }
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
      select: { id: true, nombre: true, username: true, rol: true, sucursalId: true, sucursal: { select: { id: true, nombre: true } } }
    })
    res.json({ usuario })
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { login, me }
