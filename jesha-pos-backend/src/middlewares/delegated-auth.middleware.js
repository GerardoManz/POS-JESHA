'use strict'

const jwt = require('jsonwebtoken')
const prisma = require('../lib/prisma')
const debug = require('../lib/debug')
const {
  esEnteroPositivo,
  esRolPlataforma,
  crearPrincipalDelegado
} = require('../security/identity')
const {
  REQUEST_CONTEXT_KIND,
  BRANCH_MODE,
  RequestContextError,
  deepFreeze,
  parseSucursalHeader
} = require('../security/request-context')
const { resolvePlatformAuthConfig } = require('../modules/platform-auth/platform-auth.config')

const PLATFORM_AUTH_CONFIG = resolvePlatformAuthConfig()

const DELEGATED_TTL_SECONDS = 30 * 60

class DelegatedAuthError extends Error {
  constructor(code, message, status = 401) {
    super(message)
    this.name = 'DelegatedAuthError'
    this.code = code
    this.status = status
  }
}

function extractDelegatedToken(req) {
  const authorization = req && req.headers && req.headers.authorization
  if (authorization !== undefined) {
    if (typeof authorization !== 'string') {
      throw new DelegatedAuthError('DELEGATED_TOKEN_MALFORMED', 'Authorization inválido', 400)
    }
    const match = /^Bearer ([^\s]+)$/.exec(authorization)
    if (!match) {
      throw new DelegatedAuthError('DELEGATED_TOKEN_MALFORMED', 'Bearer inválido', 400)
    }
    return match[1]
  }
  throw new DelegatedAuthError('DELEGATED_TOKEN_MISSING', 'Token requerido', 401)
}

function verifyDelegatedToken(token) {
  const payload = jwt.verify(token, PLATFORM_AUTH_CONFIG.secret, {
    algorithms: [PLATFORM_AUTH_CONFIG.algorithm],
    issuer: PLATFORM_AUTH_CONFIG.issuer,
    audience: PLATFORM_AUTH_CONFIG.audience
  })

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DelegatedAuthError('DELEGATED_TOKEN_PAYLOAD_INVALID', 'Payload inválido', 401)
  }
  if (payload.version !== 1 || payload.kind !== 'DELEGATED') {
    throw new DelegatedAuthError('DELEGATED_TOKEN_KIND_INVALID', 'Token no es delegado', 401)
  }
  if (payload.rol !== 'PLATFORM_ADMIN') {
    throw new DelegatedAuthError('DELEGATED_TOKEN_ROLE_INVALID', 'Token delegado inválido', 401)
  }
  if (!esEnteroPositivo(payload.sub)) {
    throw new DelegatedAuthError('DELEGATED_TOKEN_SUB_INVALID', 'Actor inválido', 401)
  }
  if (!esEnteroPositivo(payload.targetEmpresaId)) {
    throw new DelegatedAuthError('DELEGATED_TOKEN_TARGET_INVALID', 'Empresa destino inválida', 401)
  }

  return Object.freeze({
    sub: payload.sub,
    rol: payload.rol,
    targetEmpresaId: payload.targetEmpresaId
  })
}

function recordDelegatedAuthEvent(req, code, extra = {}) {
  if (!debug.isEnabled()) return
  debug.logJSON({
    event: 'delegated_auth',
    code,
    requestId: req && req.requestId,
    path: req && req.path,
    ...extra,
    ...debug.buildBase()
  })
}

async function hydrateDelegatedActor(tokenIdentity) {
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

  if (!usuario || !usuario.activo) {
    throw new DelegatedAuthError('DELEGATED_ACTOR_UNAVAILABLE', 'Actor no disponible', 401)
  }
  if (!esRolPlataforma(usuario.rol)) {
    throw new DelegatedAuthError('DELEGATED_ACTOR_NOT_PLATFORM', 'Actor no es PLATFORM_ADMIN', 403)
  }

  return Object.freeze({
    id: usuario.id,
    nombre: usuario.nombre,
    username: usuario.username,
    rol: usuario.rol,
    empresaId: null,
    sucursalId: null,
    activo: true
  })
}

async function buildDelegatedRequestContext({ actor, targetEmpresaId, requestedSucursalId = null }) {
  let sucursal = null

  if (requestedSucursalId !== null) {
    sucursal = await prisma.sucursal.findUnique({
      where: { id: requestedSucursalId },
      select: { id: true, empresaId: true, activa: true }
    })
    if (!sucursal || !sucursal.activa || sucursal.empresaId !== targetEmpresaId) {
      throw new RequestContextError(
        'DELEGATED_BRANCH_UNAVAILABLE',
        'Sucursal no disponible en la empresa destino',
        403
      )
    }
  }

  const mode = requestedSucursalId === null ? BRANCH_MODE.NONE : BRANCH_MODE.SELECTED
  const sucursalId = requestedSucursalId

  return deepFreeze({
    version: 1,
    kind: REQUEST_CONTEXT_KIND.TENANT,
    actor: {
      id: actor.id,
      rol: 'SUPERADMIN'
    },
    tenant: {
      empresaId: targetEmpresaId
    },
    branch: {
      mode,
      sucursalId
    }
  })
}

function defineImmutableRequestValue(req, key, value) {
  if (Object.prototype.hasOwnProperty.call(req, key)) {
    return req[key]
  }
  Object.defineProperty(req, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false
  })
  return value
}

async function requireDelegatedAuth(req, res, next) {
  try {
    const token = extractDelegatedToken(req)
    const tokenIdentity = verifyDelegatedToken(token)
    const actor = await hydrateDelegatedActor(tokenIdentity)

    const empresa = await prisma.empresa.findUnique({
      where: { id: tokenIdentity.targetEmpresaId },
      select: { id: true, activa: true, nombreComercial: true }
    })
    if (!empresa || !empresa.activa) {
      throw new DelegatedAuthError('DELEGATED_EMPRESA_UNAVAILABLE', 'Empresa destino no disponible', 403)
    }

    const requestedSucursalId = parseSucursalHeader((req && req.headers) || {})
    const context = await buildDelegatedRequestContext({
      actor,
      targetEmpresaId: tokenIdentity.targetEmpresaId,
      requestedSucursalId
    })

    const principal = crearPrincipalDelegado(
      { id: actor.id, rol: actor.rol, activo: true },
      tokenIdentity.targetEmpresaId
    )

    defineImmutableRequestValue(req, 'usuario', {
      id: actor.id,
      nombre: actor.nombre,
      username: actor.username,
      rol: 'SUPERADMIN',
      empresaId: tokenIdentity.targetEmpresaId,
      sucursalId: context.branch.sucursalId,
      activo: true
    })
    defineImmutableRequestValue(req, 'usuarioId', actor.id)
    defineImmutableRequestValue(req, 'authPrincipal', principal)
    defineImmutableRequestValue(req, 'delegation', Object.freeze({
      active: true,
      actorRealRol: 'PLATFORM_ADMIN',
      actorUsername: actor.username,
      targetEmpresaId: tokenIdentity.targetEmpresaId,
      targetEmpresaNombre: empresa.nombreComercial
    }))
    defineImmutableRequestValue(req, 'context', context)

    return next()
  } catch (err) {
    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError' ||
      err.name === 'NotBeforeError'
    ) {
      recordDelegatedAuthEvent(req, err.name || 'DELEGATED_TOKEN_INVALID')
      return res.status(401).json({ error: 'Token delegado inválido o expirado' })
    }

    if (err instanceof RequestContextError) {
      const status = err.status || 403
      if (status >= 500) {
        console.error('Error construyendo contexto delegado:', err)
        return res.status(500).json({ error: 'Error interno de autenticación' })
      }
      recordDelegatedAuthEvent(req, err.code || 'DELEGATED_CONTEXT_REJECTED')
      return res.status(status).json({
        error: status === 400 ? err.message : 'Acceso delegado denegado',
        code: err.code
      })
    }

    if (err instanceof DelegatedAuthError) {
      const forbiddenCodes = new Set([
        'DELEGATED_ACTOR_UNAVAILABLE',
        'DELEGATED_ACTOR_NOT_PLATFORM',
        'DELEGATED_EMPRESA_UNAVAILABLE',
        'DELEGATED_TOKEN_KIND_INVALID',
        'DELEGATED_TOKEN_ROLE_INVALID'
      ])
      const status = forbiddenCodes.has(err.code) ? 403 : err.status || 401
      recordDelegatedAuthEvent(req, err.code || 'DELEGATED_TOKEN_INVALID')
      return res.status(status).json({
        error: status === 403 ? 'Acceso delegado denegado' : 'Token delegado inválido o expirado'
      })
    }

    console.error('Error en requireDelegatedAuth:', err)
    return res.status(500).json({ error: 'Error interno de autenticación' })
  }
}

module.exports = {
  DelegatedAuthError,
  requireDelegatedAuth,
  buildDelegatedRequestContext,
  DELEGATED_TTL_SECONDS
}
