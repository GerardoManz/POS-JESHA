const jwt    = require('jsonwebtoken')
const prisma = require('../lib/prisma')
const debug = require('../lib/debug')

// ═══════════════════════════════════════════════════════════════════
// REQUIREAUTH - Verificar que el usuario tiene token válido
// Acepta token en:
//   1. Header Authorization: Bearer <token>  (fetch/XHR — método principal)
//   2. Query param ?token=<token>            (window.open — para tickets)
// ═══════════════════════════════════════════════════════════════════

const requireAuth = async (req, res, next) => {
  let token = null

  // 1. Intentar desde header Authorization (prioridad)
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]
  }

  // 2. Fallback: query param ?token=xxx (para window.open en tickets)
  if (!token && req.query.token) {
    token = req.query.token
  }

  if (!token) {
    if (debug.isEnabled()) debug.recordAuth401('missing', req.path)
    return res.status(401).json({ error: 'Token requerido' })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.usuario = payload
    req.usuarioId = payload.id

    const usuarioDB = await prisma.usuario.findUnique({
      where: { id: payload.id },
      select: { activo: true }
    })
    if (!usuarioDB?.activo) {
      return res.status(403).json({ error: 'Usuario desactivado' })
    }

    next()
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      if (debug.isEnabled()) {
        const reason = err.name === 'TokenExpiredError' ? 'expired' : 'invalid'
        debug.recordAuth401(reason, req.path)
      }
      return res.status(401).json({ error: 'Token inválido o expirado' })
    }
    console.error('Error en requireAuth:', err)
    return res.status(500).json({ error: 'Error interno de autenticación' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// REQUIREROLE - Verificar que el usuario tiene el rol permitido
// ═══════════════════════════════════════════════════════════════════

const requireRole = (...roles) => {
  const rolesPermitidos = roles.flat()
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
  if (req.usuario.rol === 'SUPERADMIN' || req.usuario.rol === 'PLATFORM_ADMIN') return next()
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