'use strict'

const jwt = require('jsonwebtoken')
const prisma = require('../lib/prisma')
const debug = require('../lib/debug')
const {
  IdentityError,
  esEnteroPositivo,
  detectarIdentidadLegacy,
  crearPrincipalPlataforma
} = require('../security/identity')
const { resolvePlatformAuthConfig } = require('../modules/platform-auth/platform-auth.config')

const PLATFORM_AUTH_CONFIG = resolvePlatformAuthConfig()

class PlatformTokenError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PlatformTokenError'
    this.code = code
  }
}

function extractStrictBearer(authorization) {
  if (typeof authorization !== 'string') {
    throw new PlatformTokenError('PLATFORM_TOKEN_MISSING', 'Authorization ausente')
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (!match) {
    throw new PlatformTokenError('PLATFORM_TOKEN_MALFORMED', 'Bearer inválido')
  }
  return match[1]
}

function validatePlatformTokenPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PlatformTokenError('PLATFORM_TOKEN_PAYLOAD_INVALID', 'Payload inválido')
  }
  if (payload.version !== 1 || payload.kind !== 'PLATFORM' || payload.rol !== 'PLATFORM_ADMIN') {
    throw new PlatformTokenError('PLATFORM_TOKEN_KIND_INVALID', 'Token no pertenece a plataforma')
  }
  if (!esEnteroPositivo(payload.sub)) {
    throw new PlatformTokenError('PLATFORM_TOKEN_SUB_INVALID', 'sub inválido')
  }
  return payload.sub
}

function verifyPlatformToken(token) {
  const payload = jwt.verify(token, PLATFORM_AUTH_CONFIG.secret, {
    algorithms: [PLATFORM_AUTH_CONFIG.algorithm],
    issuer: PLATFORM_AUTH_CONFIG.issuer,
    audience: PLATFORM_AUTH_CONFIG.audience
  })
  validatePlatformTokenPayload(payload)
  return payload
}

function buildPlatformActor(usuario) {
  const principal = crearPrincipalPlataforma(usuario)
  const actor = Object.freeze({
    id: usuario.id,
    nombre: usuario.nombre,
    username: usuario.username,
    rol: 'PLATFORM_ADMIN',
    empresaId: null,
    sucursalId: null,
    activo: true
  })
  return Object.freeze({ actor, principal })
}

function recordPlatform401(req, code) {
  if (!debug.isEnabled()) return
  debug.recordAuth401('invalid', req.path)
  debug.logJSON({
    event: 'platform_auth_rejected',
    code,
    requestId: req.requestId,
    path: req.path,
    ...debug.buildBase()
  })
}

async function autenticarPlataforma(req, res, next) {
  try {
    const token = extractStrictBearer(req.headers && req.headers.authorization)
    const payload = verifyPlatformToken(token)

    const usuario = await prisma.usuario.findUnique({
      where: { id: payload.sub },
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
      recordPlatform401(req, 'PLATFORM_ACTOR_UNAVAILABLE')
      return res.status(403).json({ error: 'Acceso de plataforma denegado' })
    }

    if (detectarIdentidadLegacy(usuario)) {
      recordPlatform401(req, 'PLATFORM_IDENTITY_LEGACY_BLOCKED')
      return res.status(403).json({ error: 'Acceso de plataforma denegado' })
    }

    let hydrated
    try {
      hydrated = buildPlatformActor(usuario)
    } catch (err) {
      if (err instanceof IdentityError) {
        recordPlatform401(req, err.code || 'PLATFORM_ACTOR_IDENTITY_INVALID')
        return res.status(403).json({ error: 'Acceso de plataforma denegado' })
      }
      throw err
    }

    req.platformActor = hydrated.actor
    req.platformPrincipal = hydrated.principal
    return next()
  } catch (err) {
    if (
      err instanceof PlatformTokenError ||
      err instanceof IdentityError ||
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError' ||
      err.name === 'NotBeforeError'
    ) {
      recordPlatform401(req, err.code || err.name || 'PLATFORM_TOKEN_INVALID')
      return res.status(401).json({ error: 'Token de plataforma inválido o expirado' })
    }

    console.error('Error en autenticarPlataforma:', err)
    return res.status(500).json({ error: 'Error interno de autenticación' })
  }
}

module.exports = {
  PlatformTokenError,
  extractStrictBearer,
  validatePlatformTokenPayload,
  verifyPlatformToken,
  buildPlatformActor,
  autenticarPlataforma
}
