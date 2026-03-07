const jwt = require('jsonwebtoken')

// ═══════════════════════════════════════════════════════════════════
// REQUIREAUTH - Verificar que el usuario tiene token válido
// ═══════════════════════════════════════════════════════════════════

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.usuario = payload
    req.usuarioId = payload.id
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// REQUIREROLE - Verificar que el usuario tiene el rol permitido
// ═══════════════════════════════════════════════════════════════════

const requireRole = (roles) => {
  const rolesPermitidos = Array.isArray(roles) ? roles : [roles]
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'Acceso denegado - rol insuficiente' })
    }
    next()
  }
}

// ═══════════════════════════════════════════════════════════════════
// REQUIRESUCURSALACCESS - Verificar que el usuario accede solo su sucursal
// ═══════════════════════════════════════════════════════════════════

const requireSucursalAccess = (req, res, next) => {
  if (req.usuario.rol === 'SUPERADMIN') return next()
  const sucursalSolicitada = parseInt(req.params.sucursalId || req.body.sucursalId)
  if (!sucursalSolicitada) return next()
  if (req.usuario.sucursalId !== sucursalSolicitada) {
    return res.status(403).json({ error: 'No tienes acceso a esta sucursal' })
  }
  next()
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTAR TODOS LOS MIDDLEWARES
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  requireAuth,
  requireRole,
  requireSucursalAccess
}