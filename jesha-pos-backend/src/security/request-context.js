'use strict'

const {
  IdentityError,
  esEnteroPositivo,
  esRolTenant,
  validarIdentidadFinalUsuario
} = require('./identity')

const REQUEST_CONTEXT_KIND = Object.freeze({
  TENANT: 'TENANT'
})

const BRANCH_MODE = Object.freeze({
  NONE: 'NONE',
  FIXED: 'FIXED',
  SELECTED: 'SELECTED'
})

const POSTGRES_INT_MAX = 2147483647

class RequestContextError extends Error {
  constructor(code, message, status = 403) {
    super(message)
    this.name = 'RequestContextError'
    this.code = code
    this.status = status
    this.expose = true
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return value
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen)
  }
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

function isDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return true
  if (seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  return Reflect.ownKeys(value).every((key) => isDeepFrozen(value[key], seen))
}

function isSucursalId(value) {
  return esEnteroPositivo(value) && Number.isSafeInteger(value) && value <= POSTGRES_INT_MAX
}

function parseSucursalHeader(headers = {}) {
  const raw = headers['x-sucursal-id']
  if (raw === undefined) return null
  if (Array.isArray(raw) || typeof raw !== 'string') {
    throw new RequestContextError(
      'REQUEST_CONTEXT_BRANCH_HEADER_INVALID',
      'X-Sucursal-Id inválido',
      400
    )
  }

  const value = raw.trim()
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RequestContextError(
      'REQUEST_CONTEXT_BRANCH_HEADER_INVALID',
      'X-Sucursal-Id debe ser un entero positivo',
      400
    )
  }

  const sucursalId = Number(value)
  if (!isSucursalId(sucursalId)) {
    throw new RequestContextError(
      'REQUEST_CONTEXT_BRANCH_HEADER_INVALID',
      'X-Sucursal-Id fuera de rango',
      400
    )
  }
  return sucursalId
}

function resolveBranchIntent(usuario, requestedSucursalId) {
  if (requestedSucursalId !== null && !isSucursalId(requestedSucursalId)) {
    throw new RequestContextError(
      'REQUEST_CONTEXT_BRANCH_ID_INVALID',
      'Sucursal operativa inválida',
      400
    )
  }

  let identidad
  try {
    identidad = validarIdentidadFinalUsuario(usuario)
  } catch (err) {
    if (err instanceof IdentityError) {
      throw new RequestContextError(
        err.code || 'REQUEST_CONTEXT_IDENTITY_INVALID',
        'Identidad tenant inválida',
        403
      )
    }
    throw err
  }

  if (!esRolTenant(identidad.rol)) {
    throw new RequestContextError(
      'REQUEST_CONTEXT_TENANT_ROLE_REQUIRED',
      'El contexto empresarial requiere un rol tenant',
      403
    )
  }

  const fixedSucursalId = identidad.sucursalId
  const hasFixedBranch = fixedSucursalId !== null

  if (hasFixedBranch) {
    if (requestedSucursalId !== null && requestedSucursalId !== fixedSucursalId) {
      throw new RequestContextError(
        'REQUEST_CONTEXT_BRANCH_FORBIDDEN',
        'La sucursal solicitada no coincide con la asignada al usuario',
        403
      )
    }
    return deepFreeze({
      identidad,
      mode: BRANCH_MODE.FIXED,
      sucursalId: fixedSucursalId
    })
  }

  if (requestedSucursalId === null) {
    return deepFreeze({
      identidad,
      mode: BRANCH_MODE.NONE,
      sucursalId: null
    })
  }

  if (identidad.rol !== 'SUPERADMIN' && identidad.rol !== 'PRECIOS') {
    throw new RequestContextError(
      'REQUEST_CONTEXT_BRANCH_FORBIDDEN',
      'El rol no puede seleccionar una sucursal operativa',
      403
    )
  }

  return deepFreeze({
    identidad,
    mode: BRANCH_MODE.SELECTED,
    sucursalId: requestedSucursalId
  })
}

function buildTenantRequestContext({ usuario, requestedSucursalId = null, sucursal = null }) {
  const intent = resolveBranchIntent(usuario, requestedSucursalId)

  if (intent.sucursalId === null) {
    if (sucursal !== null) {
      throw new RequestContextError(
        'REQUEST_CONTEXT_BRANCH_UNEXPECTED',
        'No se esperaba una sucursal hidratada',
        500
      )
    }
  } else {
    if (!sucursal || typeof sucursal !== 'object' || Array.isArray(sucursal)) {
      throw new RequestContextError(
        'REQUEST_CONTEXT_BRANCH_UNAVAILABLE',
        'Sucursal operativa no disponible',
        403
      )
    }
    if (
      sucursal.id !== intent.sucursalId ||
      sucursal.empresaId !== intent.identidad.empresaId ||
      sucursal.activa !== true
    ) {
      throw new RequestContextError(
        'REQUEST_CONTEXT_BRANCH_UNAVAILABLE',
        'Sucursal operativa no disponible',
        403
      )
    }
  }

  return deepFreeze({
    version: 1,
    kind: REQUEST_CONTEXT_KIND.TENANT,
    actor: {
      id: intent.identidad.id,
      rol: intent.identidad.rol
    },
    tenant: {
      empresaId: intent.identidad.empresaId
    },
    branch: {
      mode: intent.mode,
      sucursalId: intent.sucursalId
    }
  })
}

function assertTenantRequestContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new RequestContextError(
      'REQUEST_CONTEXT_MISSING',
      'Contexto tenant requerido',
      500
    )
  }
  if (
    context.version !== 1 ||
    context.kind !== REQUEST_CONTEXT_KIND.TENANT ||
    !context.actor ||
    !esEnteroPositivo(context.actor.id) ||
    !esRolTenant(context.actor.rol) ||
    !context.tenant ||
    !esEnteroPositivo(context.tenant.empresaId) ||
    !context.branch ||
    !Object.values(BRANCH_MODE).includes(context.branch.mode) ||
    (context.branch.mode === BRANCH_MODE.NONE && context.branch.sucursalId !== null) ||
    (context.branch.mode !== BRANCH_MODE.NONE && !isSucursalId(context.branch.sucursalId)) ||
    ((context.actor.rol === 'ADMIN_SUCURSAL' || context.actor.rol === 'EMPLEADO') &&
      context.branch.mode !== BRANCH_MODE.FIXED) ||
    (context.actor.rol === 'SUPERADMIN' && context.branch.mode === BRANCH_MODE.FIXED) ||
    (context.branch.mode === BRANCH_MODE.SELECTED &&
      context.actor.rol !== 'SUPERADMIN' && context.actor.rol !== 'PRECIOS')
  ) {
    throw new RequestContextError(
      'REQUEST_CONTEXT_INVALID',
      'Contexto tenant inválido',
      500
    )
  }
  return context
}

module.exports = {
  REQUEST_CONTEXT_KIND,
  BRANCH_MODE,
  RequestContextError,
  deepFreeze,
  isDeepFrozen,
  parseSucursalHeader,
  resolveBranchIntent,
  buildTenantRequestContext,
  assertTenantRequestContext
}
