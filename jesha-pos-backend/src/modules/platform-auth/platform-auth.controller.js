'use strict'

const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../../lib/prisma')
const debug = require('../../lib/debug')
const {
  IdentityError,
  esEnteroPositivo,
  detectarIdentidadLegacy,
  crearPrincipalPlataforma,
  crearPrincipalDelegado
} = require('../../security/identity')
const { resolvePlatformAuthConfig } = require('./platform-auth.config')
const { DELEGATED_TTL_SECONDS } = require('../../middlewares/delegated-auth.middleware')

const PLATFORM_AUTH_CONFIG = resolvePlatformAuthConfig()
const LOGIN_BODY_KEYS = new Set(['username', 'password'])
const GENERIC_CREDENTIAL_ERROR = Object.freeze({ error: 'Credenciales inválidas' })

class PlatformAuthError extends Error {
  constructor(code, message, status = 401) {
    super(message)
    this.name = 'PlatformAuthError'
    this.code = code
    this.status = status
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function parsePlatformLoginBody(body) {
  if (!isPlainObject(body)) {
    throw new PlatformAuthError('PLATFORM_LOGIN_BODY_INVALID', 'Body inválido', 400)
  }

  const keys = Object.keys(body)
  if (keys.some((key) => !LOGIN_BODY_KEYS.has(key))) {
    throw new PlatformAuthError('PLATFORM_LOGIN_BODY_INVALID', 'Body contiene campos no permitidos', 400)
  }

  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    throw new PlatformAuthError('PLATFORM_LOGIN_BODY_INVALID', 'Credenciales inválidas', 400)
  }

  const username = body.username.trim()
  const password = body.password

  if (username.length < 1 || username.length > 100) {
    throw new PlatformAuthError('PLATFORM_LOGIN_BODY_INVALID', 'Username inválido', 400)
  }
  if (password.length < 1 || password.length > 512) {
    throw new PlatformAuthError('PLATFORM_LOGIN_BODY_INVALID', 'Password inválido', 400)
  }

  return Object.freeze({ username, password })
}

function recordPlatformAuthEvent(req, code, extra = {}) {
  if (!debug.isEnabled()) return
  debug.logJSON({
    event: 'platform_auth',
    code,
    requestId: req && req.requestId,
    path: req && req.path,
    ...extra,
    ...debug.buildBase()
  })
}

async function findPlatformCandidate(username) {
  const candidates = await prisma.usuario.findMany({
    where: {
      username,
      rol: 'PLATFORM_ADMIN',
      activo: true
    },
    select: {
      id: true,
      nombre: true,
      username: true,
      passwordHash: true,
      rol: true,
      activo: true,
      empresaId: true,
      sucursalId: true
    },
    orderBy: { id: 'asc' },
    take: 2
  })

  if (candidates.length > 1) {
    throw new PlatformAuthError(
      'PLATFORM_AUTH_CANDIDATE_AMBIGUOUS',
      'Más de un PLATFORM_ADMIN activo coincide con el username',
      500
    )
  }

  return candidates[0] || null
}

function signPlatformToken(principal) {
  return jwt.sign(principal, PLATFORM_AUTH_CONFIG.secret, {
    algorithm: PLATFORM_AUTH_CONFIG.algorithm,
    issuer: PLATFORM_AUTH_CONFIG.issuer,
    audience: PLATFORM_AUTH_CONFIG.audience,
    expiresIn: PLATFORM_AUTH_CONFIG.ttl
  })
}

async function login(req, res) {
  try {
    const credentials = parsePlatformLoginBody(req.body)
    const usuario = await findPlatformCandidate(credentials.username)

    if (!usuario) {
      return res.status(401).json(GENERIC_CREDENTIAL_ERROR)
    }

    const passwordValida = await bcrypt.compare(credentials.password, usuario.passwordHash)
    if (!passwordValida) {
      return res.status(401).json(GENERIC_CREDENTIAL_ERROR)
    }

    if (detectarIdentidadLegacy(usuario)) {
      recordPlatformAuthEvent(req, 'PLATFORM_IDENTITY_LEGACY_BLOCKED')
      throw new PlatformAuthError(
        'PLATFORM_IDENTITY_LEGACY_BLOCKED',
        'PLATFORM_ADMIN legacy bloqueado',
        401
      )
    }

    const principal = crearPrincipalPlataforma(usuario)
    const token = signPlatformToken(principal)

    await prisma.auditoria.create({
      data: {
        empresaId: null,
        usuarioId: usuario.id,
        sucursalId: null,
        accion: 'PLATFORM_LOGIN',
        modulo: 'platform-auth',
        ip: req.ip || null
      }
    })

    return res.json({
      token,
      expiresIn: PLATFORM_AUTH_CONFIG.ttl
    })
  } catch (err) {
    if (err instanceof PlatformAuthError) {
      if (err.status >= 500) {
        recordPlatformAuthEvent(req, err.code)
        return res.status(500).json({ error: 'Error interno de autenticación' })
      }
      return res.status(err.status).json(
        err.status === 401 ? GENERIC_CREDENTIAL_ERROR : { error: 'Solicitud inválida' }
      )
    }

    if (err instanceof IdentityError) {
      recordPlatformAuthEvent(req, err.code || 'PLATFORM_IDENTITY_INVALID')
      return res.status(401).json(GENERIC_CREDENTIAL_ERROR)
    }

    console.error('Error en platform login:', err)
    return res.status(500).json({ error: 'Error interno de autenticación' })
  }
}

function me(req, res) {
  return res.json({
    id: req.platformActor.id,
    rol: req.platformActor.rol,
    kind: req.platformPrincipal.kind
  })
}

function signDelegatedToken(principal) {
  return jwt.sign(principal, PLATFORM_AUTH_CONFIG.secret, {
    algorithm: PLATFORM_AUTH_CONFIG.algorithm,
    issuer: PLATFORM_AUTH_CONFIG.issuer,
    audience: PLATFORM_AUTH_CONFIG.audience,
    expiresIn: `${DELEGATED_TTL_SECONDS}s`
  })
}

async function enterEmpresa(req, res) {
  try {
    const { empresaId: rawEmpresaId } = req.params
    const empresaId = Number(rawEmpresaId)
    if (!esEnteroPositivo(empresaId)) {
      return res.status(400).json({ error: 'empresaId inválido' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, activa: true, nombreComercial: true, slug: true }
    })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }
    if (!empresa.activa) {
      return res.status(403).json({ error: 'Empresa no activa' })
    }

    const actor = req.platformActor
    const principal = crearPrincipalDelegado(
      { id: actor.id, rol: actor.rol, activo: true },
      empresaId
    )
    const token = signDelegatedToken(principal)

    await prisma.auditoria.create({
      data: {
        empresaId,
        usuarioId: actor.id,
        sucursalId: null,
        accion: 'PLATFORM_TENANT_ENTER',
        modulo: 'platform-auth',
        ip: req.ip || null
      }
    })

    return res.json({
      token,
      expiresIn: `${DELEGATED_TTL_SECONDS}s`,
      empresa: {
        id: empresa.id,
        slug: empresa.slug,
        nombreComercial: empresa.nombreComercial
      }
    })
  } catch (err) {
    if (err instanceof IdentityError) {
      return res.status(400).json({ error: 'Solicitud inválida' })
    }
    console.error('Error en enterEmpresa:', err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

module.exports = {
  PlatformAuthError,
  parsePlatformLoginBody,
  findPlatformCandidate,
  signPlatformToken,
  signDelegatedToken,
  login,
  me,
  enterEmpresa
}
