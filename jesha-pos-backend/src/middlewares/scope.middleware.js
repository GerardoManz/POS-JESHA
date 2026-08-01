'use strict'

const {
  BRANCH_MODE,
  RequestContextError,
  assertTenantRequestContext
} = require('../security/request-context')

function respondScopeError(res, err, next) {
  const status = err.status || 403
  if (status >= 500) return next(err)
  return res.status(status).json({ error: err.message, code: err.code })
}

function tenantGlobal(req, res, next) {
  try {
    assertTenantRequestContext(req.context)
    return next()
  } catch (err) {
    if (err instanceof RequestContextError) return respondScopeError(res, err, next)
    return next(err)
  }
}

function branchOptional(req, res, next) {
  try {
    assertTenantRequestContext(req.context)
    return next()
  } catch (err) {
    if (err instanceof RequestContextError) return respondScopeError(res, err, next)
    return next(err)
  }
}

function branchRequired(req, res, next) {
  try {
    const context = assertTenantRequestContext(req.context)
    if (context.branch.mode === BRANCH_MODE.NONE || context.branch.sucursalId === null) {
      throw new RequestContextError(
        'BRANCH_CONTEXT_REQUIRED',
        'Selecciona una sucursal para realizar esta operación',
        400
      )
    }
    return next()
  } catch (err) {
    if (err instanceof RequestContextError) return respondScopeError(res, err, next)
    return next(err)
  }
}

module.exports = {
  tenantGlobal,
  branchOptional,
  branchRequired
}
