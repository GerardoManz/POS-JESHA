'use strict'

const PLATFORM_JWT_ALGORITHM = 'HS256'
const PLATFORM_AUTH_ENV_KEYS = Object.freeze([
  'PLATFORM_JWT_SECRET',
  'PLATFORM_JWT_ISSUER',
  'PLATFORM_JWT_AUDIENCE',
  'PLATFORM_JWT_TTL'
])

class PlatformAuthConfigError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PlatformAuthConfigError'
    this.code = code
  }
}

function readRequiredString(env, key, { trim = true } = {}) {
  const raw = env && env[key]
  if (typeof raw !== 'string') {
    throw new PlatformAuthConfigError(
      'PLATFORM_AUTH_CONFIG_INVALID',
      `Falta configuración requerida: ${key}`
    )
  }

  const value = trim ? raw.trim() : raw
  if (value.length === 0) {
    throw new PlatformAuthConfigError(
      'PLATFORM_AUTH_CONFIG_INVALID',
      `Configuración vacía: ${key}`
    )
  }
  return value
}

function resolvePlatformAuthConfig(env = process.env) {
  const secret = readRequiredString(env, 'PLATFORM_JWT_SECRET', { trim: false })
  const issuer = readRequiredString(env, 'PLATFORM_JWT_ISSUER')
  const audience = readRequiredString(env, 'PLATFORM_JWT_AUDIENCE')
  const ttl = readRequiredString(env, 'PLATFORM_JWT_TTL')

  if (secret.trim().length < 32) {
    throw new PlatformAuthConfigError(
      'PLATFORM_AUTH_SECRET_WEAK',
      'PLATFORM_JWT_SECRET debe tener al menos 32 caracteres no vacíos'
    )
  }

  if (!/^[1-9]\d*(?:s|m|h|d)$/.test(ttl)) {
    throw new PlatformAuthConfigError(
      'PLATFORM_AUTH_TTL_INVALID',
      'PLATFORM_JWT_TTL debe usar formato positivo con sufijo s, m, h o d'
    )
  }

  return Object.freeze({
    secret,
    issuer,
    audience,
    ttl,
    algorithm: PLATFORM_JWT_ALGORITHM
  })
}

module.exports = {
  PLATFORM_JWT_ALGORITHM,
  PLATFORM_AUTH_ENV_KEYS,
  PlatformAuthConfigError,
  resolvePlatformAuthConfig
}
