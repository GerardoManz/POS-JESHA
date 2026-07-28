const IDENTITY_KIND = Object.freeze({
  PLATFORM: 'PLATFORM',
  TENANT: 'TENANT'
})

const PLATFORM_ROLES = Object.freeze([
  'PLATFORM_ADMIN'
])

const TENANT_ROLES = Object.freeze([
  'SUPERADMIN',
  'ADMIN_SUCURSAL',
  'EMPLEADO',
  'PRECIOS'
])

const ALL_ROLES = Object.freeze([...PLATFORM_ROLES, ...TENANT_ROLES])

function esRolPlataforma(rol) {
  return PLATFORM_ROLES.includes(rol)
}

function esRolTenant(rol) {
  return TENANT_ROLES.includes(rol)
}

function requiereEmpresa(rol) {
  if (esRolPlataforma(rol)) return false
  if (esRolTenant(rol)) return true
  return false
}

function requiereSucursal(rol) {
  if (rol === 'ADMIN_SUCURSAL') return true
  if (rol === 'EMPLEADO') return true
  return false
}

function permiteSucursalOpcional(rol) {
  if (rol === 'PRECIOS') return true
  if (requiereSucursal(rol)) return true
  return false
}

function esEnteroPositivo(valor) {
  if (typeof valor === 'bigint') return false
  if (typeof valor === 'boolean') return false
  if (Array.isArray(valor)) return false
  if (valor === null || valor === undefined) return false
  if (typeof valor !== 'number') return false
  if (!Number.isFinite(valor)) return false
  if (Number.isNaN(valor)) return false
  if (!Number.isInteger(valor)) return false
  if (valor <= 0) return false
  return true
}

class IdentityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'IdentityError'
    this.code = code
  }
}

function validarIdentidadFinalUsuario(usuario) {
  if (!usuario || typeof usuario !== 'object' || Array.isArray(usuario)) {
    throw new IdentityError('IDENTITY_INPUT_INVALID', 'La identidad debe ser un objeto plano')
  }

  if (typeof usuario.id !== 'number' || !esEnteroPositivo(usuario.id)) {
    throw new IdentityError('IDENTITY_INPUT_INVALID', 'El id debe ser un entero positivo')
  }

  if (typeof usuario.activo !== 'boolean') {
    throw new IdentityError('IDENTITY_ACTIVE_INVALID', 'activo debe ser boolean')
  }

  if (!ALL_ROLES.includes(usuario.rol)) {
    throw new IdentityError('IDENTITY_ROLE_UNKNOWN', `Rol desconocido: ${usuario.rol}`)
  }

  const empresaId = 'empresaId' in usuario ? usuario.empresaId : undefined
  const sucursalId = 'sucursalId' in usuario ? usuario.sucursalId : undefined

  if (esRolPlataforma(usuario.rol)) {
    if (empresaId !== null && empresaId !== undefined) {
      throw new IdentityError('IDENTITY_EMPRESA_FORBIDDEN', 'PLATFORM_ADMIN no debe tener empresaId')
    }
    if (sucursalId !== null && sucursalId !== undefined) {
      throw new IdentityError('IDENTITY_SUCURSAL_FORBIDDEN', 'PLATFORM_ADMIN no debe tener sucursalId')
    }
  }

  if (esRolTenant(usuario.rol)) {
    if (empresaId === null || empresaId === undefined) {
      throw new IdentityError('IDENTITY_EMPRESA_REQUIRED', 'El rol de empresa requiere empresaId')
    }
    if (!esEnteroPositivo(empresaId)) {
      throw new IdentityError('IDENTITY_EMPRESA_REQUIRED', 'empresaId debe ser un entero positivo')
    }

    if (requiereSucursal(usuario.rol)) {
      if (sucursalId === null || sucursalId === undefined) {
        throw new IdentityError('IDENTITY_SUCURSAL_REQUIRED', 'El rol requiere sucursalId')
      }
      if (!esEnteroPositivo(sucursalId)) {
        throw new IdentityError('IDENTITY_SUCURSAL_INVALID', 'sucursalId debe ser un entero positivo')
      }
    }

    if (usuario.rol === 'SUPERADMIN') {
      if (sucursalId !== null && sucursalId !== undefined) {
        throw new IdentityError('IDENTITY_SUCURSAL_FORBIDDEN', 'SUPERADMIN no debe tener sucursalId')
      }
    }

    if (usuario.rol === 'PRECIOS') {
      if (sucursalId !== null && sucursalId !== undefined) {
        if (!esEnteroPositivo(sucursalId)) {
          throw new IdentityError('IDENTITY_SUCURSAL_INVALID', 'sucursalId debe ser un entero positivo o null')
        }
      }
    }
  }

  const snapshot = {
    id: usuario.id,
    rol: usuario.rol,
    activo: usuario.activo
  }

  if (usuario.rol === 'PLATFORM_ADMIN') {
    snapshot.empresaId = null
    snapshot.sucursalId = null
  } else if (usuario.rol === 'SUPERADMIN') {
    snapshot.empresaId = empresaId
    snapshot.sucursalId = null
  } else {
    snapshot.empresaId = empresaId
    if (usuario.rol === 'PRECIOS' && (sucursalId === null || sucursalId === undefined)) {
      snapshot.sucursalId = null
    } else if (requiereSucursal(usuario.rol) || usuario.rol === 'PRECIOS') {
      snapshot.sucursalId = sucursalId
    }
  }

  return Object.freeze(snapshot)
}

function detectarIdentidadLegacy(usuario) {
  if (!usuario || typeof usuario !== 'object') return null

  if (usuario.rol === 'PLATFORM_ADMIN') {
    if (usuario.empresaId !== null && usuario.empresaId !== undefined) {
      return 'PLATFORM_ADMIN_CON_EMPRESA_LEGACY'
    }
    if (usuario.sucursalId !== null && usuario.sucursalId !== undefined) {
      return 'PLATFORM_ADMIN_CON_EMPRESA_LEGACY'
    }
  }

  return null
}

function crearPrincipalPlataforma(usuario) {
  const identidad = validarIdentidadFinalUsuario(usuario)
  if (identidad.rol !== 'PLATFORM_ADMIN') {
    throw new IdentityError('IDENTITY_ROLE_UNKNOWN', 'Solo PLATFORM_ADMIN puede generar principal de plataforma')
  }
  return Object.freeze({
    version: 1,
    kind: 'PLATFORM',
    sub: identidad.id,
    rol: 'PLATFORM_ADMIN'
  })
}

function crearPrincipalTenant(usuario) {
  const identidad = validarIdentidadFinalUsuario(usuario)
  if (!TENANT_ROLES.includes(identidad.rol)) {
    throw new IdentityError('IDENTITY_ROLE_UNKNOWN', 'Solo roles tenant pueden generar principal de tenant')
  }
  return Object.freeze({
    version: 1,
    kind: 'TENANT',
    sub: identidad.id,
    rol: identidad.rol
  })
}

module.exports = {
  IDENTITY_KIND,
  PLATFORM_ROLES,
  TENANT_ROLES,
  ALL_ROLES,
  esRolPlataforma,
  esRolTenant,
  requiereEmpresa,
  requiereSucursal,
  permiteSucursalOpcional,
  esEnteroPositivo,
  IdentityError,
  validarIdentidadFinalUsuario,
  detectarIdentidadLegacy,
  crearPrincipalPlataforma,
  crearPrincipalTenant
}
