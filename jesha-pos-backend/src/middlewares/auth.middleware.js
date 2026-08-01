'use strict'

const jwt = require('jsonwebtoken')
const prisma = require('../lib/prisma')
const debug = require('../lib/debug')
const {
  IdentityError,
  esEnteroPositivo,
  esRolTenant,
  validarIdentidadFinalUsuario,
  crearPrincipalTenant
} = require('../security/identity')
const { resolveTenantAuthConfig } = require('../modules/auth/tenant-auth.config')

const TENANT_AUTH_CONFIG = resolveTenantAuthConfig()

class TenantTokenError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TenantTokenError'
    this.code = code
  }
}

function extractTenantToken(req) {
  const authorization = req && req.headers && req.headers.authorization
  if (authorization !== undefined) {
    if (typeof authorization !== 'string') {
      throw new TenantTokenError('TENANT_TOKEN_MALFORMED', 'Authorization inválido')
    }
    const match = /^Bearer ([^\s]+)$/.exec(authorization)
    if (!match) {
      throw new TenantTokenError('TENANT_TOKEN_MALFORMED', 'Bearer inválido')
    }
    return match[1]
  }

  const queryToken = req && req.query && req.query.token
  if (queryToken !== undefined) {
    if (typeof queryToken !== 'string' || queryToken.length === 0 || /\s/.test(queryToken)) {
      throw new TenantTokenError('TENANT_TOKEN_MALFORMED', 'Token query inválido')
    }
    return queryToken
  }

  throw new TenantTokenError('TENANT_TOKEN_MISSING', 'Token requerido')
}

function validateTenantTokenPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TenantTokenError('TENANT_TOKEN_PAYLOAD_INVALID', 'Payload inválido')
  }
  if (payload.version !== 1 || payload.kind !== 'TENANT' || !esRolTenant(payload.rol)) {
    throw new TenantTokenError('TENANT_TOKEN_KIND_INVALID', 'Token no pertenece a un tenant')
  }
  if (!esEnteroPositivo(payload.sub)) {
    throw new TenantTokenError('TENANT_TOKEN_SUB_INVALID', 'sub inválido')
  }
  return Object.freeze({ sub: payload.sub, rol: payload.rol })
}

function verifyTenantToken(token) {
  const payload = jwt.verify(token, TENANT_AUTH_CONFIG.secret, {
    algorithms: [TENANT_AUTH_CONFIG.algorithm],
    issuer: TENANT_AUTH_CONFIG.issuer,
    audience: TENANT_AUTH_CONFIG.audience
  })
  return validateTenantTokenPayload(payload)
}

function buildTenantActor(usuario) {
  const identidad = validarIdentidadFinalUsuario(usuario)
  const principal = crearPrincipalTenant(usuario)
  const actor = Object.freeze({
    id: identidad.id,
    nombre: usuario.nombre,
    username: usuario.username,
    rol: identidad.rol,
    empresaId: identidad.empresaId,
    sucursalId: identidad.sucursalId,
    activo: true
  })
  return Object.freeze({ actor, principal })
}

function recordTenant401(req, code) {
  if (!debug.isEnabled()) return
  debug.recordAuth401('invalid', req.path)
  debug.logJSON({
    event: 'tenant_auth_rejected',
    code,
    requestId: req.requestId,
    path: req.path,
    ...debug.buildBase()
  })
}

async function hydrateTenantActor(tokenIdentity) {
  const usuario = await prisma.usuario.findUnique({
    where: { id: tokenIdentity.sub },
    select: {
      id: true,
      nombre: true,
      username: true,
      rol: true,
      activo: true,
      empresaId: true,
      sucursalId: true
    }
  })

  if (!usuario || !usuario.activo || !esRolTenant(usuario.rol)) {
    throw new TenantTokenError('TENANT_ACTOR_UNAVAILABLE', 'Usuario tenant no disponible')
  }

  let hydrated
  try {
    hydrated = buildTenantActor(usuario)
  } catch (err) {
    if (err instanceof IdentityError) {
      throw new TenantTokenError(err.code || 'TENANT_ACTOR_IDENTITY_INVALID', 'Identidad tenant inválida')
    }
    throw err
  }

  if (hydrated.principal.rol !== tokenIdentity.rol) {
    throw new TenantTokenError('TENANT_ROLE_CHANGED', 'El rol del usuario cambió')
  }

  const empresa = await prisma.empresa.findUnique({
    where: { id: hydrated.actor.empresaId },
    select: { id: true, activa: true }
  })
  if (!empresa || !empresa.activa) {
    throw new TenantTokenError('TENANT_EMPRESA_UNAVAILABLE', 'Empresa tenant no disponible')
  }

  if (hydrated.actor.sucursalId !== null) {
    const sucursal = await prisma.sucursal.findUnique({
      where: { id: hydrated.actor.sucursalId },
      select: { id: true, empresaId: true, activa: true }
    })
    if (!sucursal || !sucursal.activa || sucursal.empresaId !== hydrated.actor.empresaId) {
      throw new TenantTokenError('TENANT_SUCURSAL_UNAVAILABLE', 'Sucursal tenant no disponible')
    }
  }

  return hydrated
}

async function requireAuth(req, res, next) {
  try {
    const token = extractTenantToken(req)
    const tokenIdentity = verifyTenantToken(token)
    const hydrated = await hydrateTenantActor(tokenIdentity)

    req.usuario = hydrated.actor
    req.usuarioId = hydrated.actor.id
    req.authPrincipal = hydrated.principal
    return next()
  } catch (err) {
    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError' ||
      err.name === 'NotBeforeError'
    ) {
      recordTenant401(req, err.name || 'TENANT_TOKEN_INVALID')
      return res.status(401).json({ error: 'Token inválido o expirado' })
    }

    if (err instanceof TenantTokenError || err instanceof IdentityError) {
      const forbiddenCodes = new Set([
        'TENANT_ACTOR_UNAVAILABLE',
        'TENANT_ROLE_CHANGED',
        'TENANT_EMPRESA_UNAVAILABLE',
        'TENANT_SUCURSAL_UNAVAILABLE',
        'IDENTITY_EMPRESA_REQUIRED',
        'IDENTITY_SUCURSAL_REQUIRED',
        'IDENTITY_SUCURSAL_INVALID',
        'IDENTITY_SUCURSAL_FORBIDDEN'
      ])
      const status = forbiddenCodes.has(err.code) ? 403 : 401
      recordTenant401(req, err.code || 'TENANT_TOKEN_INVALID')
      return res.status(status).json({
        error: status === 403 ? 'Acceso tenant denegado' : 'Token inválido o expirado'
      })
    }

    console.error('Error en requireAuth:', err)
    return res.status(500).json({ error: 'Error interno de autenticación' })
  }
}

const requireRole = (...roles) => {
  const rolesPermitidos = roles.flat()
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'Acceso denegado - rol insuficiente' })
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

module.exports = {
  TenantTokenError,
  extractTenantToken,
  validateTenantTokenPayload,
  verifyTenantToken,
  buildTenantActor,
  hydrateTenantActor,
  requireAuth,
  requireRole,
  requireSucursalAccess
}
