'use strict'

const TENANT_JWT_ALGORITHM = 'HS256'
const TENANT_AUTH_ENV_KEYS = Object.freeze([
  'TENANT_JWT_SECRET',
  'TENANT_JWT_ISSUER',
  'TENANT_JWT_AUDIENCE',
  'TENANT_JWT_TTL'
])

class TenantAuthConfigError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TenantAuthConfigError'
    this.code = code
  }
}

function readRequiredString(env, key, { trim = true } = {}) {
  const raw = env && env[key]
  if (typeof raw !== 'string') {
    throw new TenantAuthConfigError(
      'TENANT_AUTH_CONFIG_INVALID',
      `Falta configuración requerida: ${key}`
    )
  }

  const value = trim ? raw.trim() : raw
  if (value.length === 0) {
    throw new TenantAuthConfigError(
      'TENANT_AUTH_CONFIG_INVALID',
      `Configuración vacía: ${key}`
    )
  }
  return value
}

function resolveTenantAuthConfig(env = process.env) {
  const secret = readRequiredString(env, 'TENANT_JWT_SECRET', { trim: false })
  const issuer = readRequiredString(env, 'TENANT_JWT_ISSUER')
  const audience = readRequiredString(env, 'TENANT_JWT_AUDIENCE')
  const ttl = readRequiredString(env, 'TENANT_JWT_TTL')

  if (secret.trim().length < 32) {
    throw new TenantAuthConfigError(
      'TENANT_AUTH_SECRET_WEAK',
      'TENANT_JWT_SECRET debe tener al menos 32 caracteres no vacíos'
    )
  }

  if (!/^[1-9]\d*(?:s|m|h|d)$/.test(ttl)) {
    throw new TenantAuthConfigError(
      'TENANT_AUTH_TTL_INVALID',
      'TENANT_JWT_TTL debe usar formato positivo con sufijo s, m, h o d'
    )
  }

  return Object.freeze({
    secret,
    issuer,
    audience,
    ttl,
    algorithm: TENANT_JWT_ALGORITHM
  })
}

module.exports = {
  TENANT_JWT_ALGORITHM,
  TENANT_AUTH_ENV_KEYS,
  TenantAuthConfigError,
  resolveTenantAuthConfig
}
