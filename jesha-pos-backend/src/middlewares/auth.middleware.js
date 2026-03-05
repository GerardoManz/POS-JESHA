const jwt = require('jsonwebtoken')

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.usuario = payload
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

const requireRole = (roles) => {
  const rolesPermitidos = Array.isArray(roles) ? roles : [roles]
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'Acceso denegado' })
    }
    next()
  }
}

const requireSucursalAccess = (req, res, next) => {
  if (req.usuario.rol === 'SUPERADMIN') return next()
  const sucursalSolicitada = parseInt(req.params.sucursalId || req.body.sucursalId)
  if (!sucursalSolicitada) return next()
  if (req.usuario.sucursalId !== sucursalSolicitada) {
    return res.status(403).json({ error: 'No tienes acceso a esta sucursal' })
  }
  next()
}

module.exports = { requireAuth, requireRole, requireSucursalAccess }
