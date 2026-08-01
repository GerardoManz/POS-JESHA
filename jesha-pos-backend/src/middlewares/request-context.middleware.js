'use strict'

const prisma = require('../lib/prisma')
const {
  RequestContextError,
  isDeepFrozen,
  assertTenantRequestContext,
  parseSucursalHeader,
  resolveBranchIntent,
  buildTenantRequestContext
} = require('../security/request-context')

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

async function hydrateTenantRequestContext(req, usuario = req && req.usuario) {
  if (!usuario) {
    throw new RequestContextError(
      'REQUEST_CONTEXT_ACTOR_MISSING',
      'Usuario autenticado requerido',
      500
    )
  }

  const requestedSucursalId = parseSucursalHeader((req && req.headers) || {})
  const intent = resolveBranchIntent(usuario, requestedSucursalId)

  if (req && Object.prototype.hasOwnProperty.call(req, 'context')) {
    const existing = assertTenantRequestContext(req.context)
    if (
      existing.actor.id !== intent.identidad.id ||
      existing.actor.rol !== intent.identidad.rol ||
      existing.tenant.empresaId !== intent.identidad.empresaId ||
      existing.branch.mode !== intent.mode ||
      existing.branch.sucursalId !== intent.sucursalId ||
      !isDeepFrozen(existing)
    ) {
      throw new RequestContextError(
        'REQUEST_CONTEXT_REHYDRATION_MISMATCH',
        'El contexto existente no coincide con el usuario rehidratado',
        500
      )
    }
    return existing
  }
  let sucursal = null

  if (intent.sucursalId !== null) {
    sucursal = await prisma.sucursal.findUnique({
      where: { id: intent.sucursalId },
      select: { id: true, empresaId: true, activa: true }
    })
  }

  const context = buildTenantRequestContext({
    usuario,
    requestedSucursalId,
    sucursal
  })

  if (req) defineImmutableRequestValue(req, 'context', context)
  return context
}

async function requestContext(req, res, next) {
  try {
    await hydrateTenantRequestContext(req)
    return next()
  } catch (err) {
    if (err instanceof RequestContextError) {
      const status = err.status || 403
      if (status >= 500) return next(err)
      return res.status(status).json({ error: err.message, code: err.code })
    }
    return next(err)
  }
}

module.exports = {
  defineImmutableRequestValue,
  hydrateTenantRequestContext,
  requestContext
}
