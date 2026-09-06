'use strict'

const { requireAuth } = require('./auth.middleware')

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 2 && parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload
    return null
  } catch {
    return null
  }
}

function extractTokenFromRequest(req) {
  const authorization = req && req.headers && req.headers.authorization
  if (typeof authorization === 'string') {
    const match = /^Bearer ([^\s]+)$/.exec(authorization)
    if (match) return match[1]
  }
  const queryToken = req && req.query && req.query.token
  if (typeof queryToken === 'string' && queryToken.length > 0) return queryToken
  return null
}

function requireTenantOrDelegated(req, res, next) {
  const token = extractTokenFromRequest(req)
  if (token) {
    const payload = decodeJwtPayload(token)
    if (payload && payload.kind === 'DELEGATED') {
      const { requireDelegatedAuth } = require('./delegated-auth.middleware')
      return requireDelegatedAuth(req, res, next)
    }
  }
  return requireAuth(req, res, next)
}

module.exports = { requireTenantOrDelegated }
