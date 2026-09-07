'use strict'

const jwt = require('jsonwebtoken')
const { resolveTenantAuthConfig } = require('../modules/auth/tenant-auth.config')

const SELLER_AUTH_AUDIENCE = 'pos-seller-auth'
const SELLER_AUTH_TTL_SECONDS = 300

let _config = null
function getConfig() {
  if (!_config) _config = resolveTenantAuthConfig()
  return _config
}

function signSellerAuthorization({ sellerId, sessionUserId, empresaId, sucursalId }) {
  if (!Number.isInteger(sellerId) || sellerId <= 0) {
    throw new Error('sellerId must be a positive integer')
  }
  if (!Number.isInteger(sessionUserId) || sessionUserId <= 0) {
    throw new Error('sessionUserId must be a positive integer')
  }
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    throw new Error('empresaId must be a positive integer')
  }

  const config = getConfig()
  const now = Math.floor(Date.now() / 1000)

  const claims = {
    sub: sellerId,
    sid: sessionUserId,
    eid: empresaId,
    bid: Number.isInteger(sucursalId) ? sucursalId : null,
    iat: now,
    exp: now + SELLER_AUTH_TTL_SECONDS
  }

  return jwt.sign(claims, config.secret, {
    algorithm: config.algorithm,
    issuer: config.issuer,
    audience: SELLER_AUTH_AUDIENCE
  })
}

function verifySellerAuthorization(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new SellerAuthError('SELLER_AUTH_TOKEN_MISSING', 'Seller authorization token required')
  }

  const config = getConfig()
  let payload
  try {
    payload = jwt.verify(token, config.secret, {
      algorithms: [config.algorithm],
      issuer: config.issuer,
      audience: SELLER_AUTH_AUDIENCE
    })
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new SellerAuthError('SELLER_AUTH_EXPIRED', 'Seller authorization expired')
    }
    if (err.name === 'JsonWebTokenError') {
      throw new SellerAuthError('SELLER_AUTH_INVALID', 'Seller authorization invalid')
    }
    throw err
  }

  if (!Number.isInteger(payload.sub) || payload.sub <= 0) {
    throw new SellerAuthError('SELLER_AUTH_INVALID', 'Seller authorization missing seller ID')
  }
  if (!Number.isInteger(payload.sid) || payload.sid <= 0) {
    throw new SellerAuthError('SELLER_AUTH_INVALID', 'Seller authorization missing session user ID')
  }
  if (!Number.isInteger(payload.eid) || payload.eid <= 0) {
    throw new SellerAuthError('SELLER_AUTH_INVALID', 'Seller authorization missing empresa ID')
  }

  return Object.freeze({
    sub: payload.sub,
    sid: payload.sid,
    eid: payload.eid,
    bid: payload.bid ?? null,
    iat: payload.iat,
    exp: payload.exp
  })
}

class SellerAuthError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SellerAuthError'
    this.code = code
    this.expose = true
  }
}

module.exports = {
  SELLER_AUTH_AUDIENCE,
  SELLER_AUTH_TTL_SECONDS,
  SellerAuthError,
  signSellerAuthorization,
  verifySellerAuthorization
}
