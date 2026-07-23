const {
  ROLES_VALIDOS,
  PLATFORM_ROLES,
  ENTERPRISE_ROLES,
  ROLES_REQUIEREN_SUCURSAL
} = require('./roles')

function crearErrorPoliticaUsuario(codigo, mensaje) {
  const err = new Error(mensaje)
  err.name = 'UserPolicyError'
  err.code = codigo
  err.expose = true
  return err
}

function normalizarIdPositivo(
  valor,
  {
    permitirNull = false,
    codigo = 'ID_INVALIDO',
    mensaje = 'Identificador inválido'
  } = {}
) {
  if (valor === null || valor === '') {
    if (permitirNull) return null
    throw crearErrorPoliticaUsuario(codigo, mensaje)
  }

  if (valor === undefined) {
    throw crearErrorPoliticaUsuario(codigo, mensaje)
  }

  if (typeof valor === 'number') {
    if (Number.isSafeInteger(valor) && valor > 0) {
      return valor
    }
    throw crearErrorPoliticaUsuario(codigo, mensaje)
  }

  if (typeof valor === 'string' && /^[1-9]\d*$/.test(valor)) {
    const id = Number(valor)
    if (Number.isSafeInteger(id)) {
      return id
    }
  }

  throw crearErrorPoliticaUsuario(codigo, mensaje)
}

function validarEstadoUsuarioPorRol({
  rol,
  empresaId,
  empresa,
  sucursalId,
  sucursal
}) {
  if (!ROLES_VALIDOS.has(rol)) {
    throw crearErrorPoliticaUsuario('ROL_INVALIDO', 'Rol de usuario inválido')
  }

  const tieneEmpresaId = empresaId !== null && empresaId !== undefined
  const tieneEmpresa = empresa !== null && empresa !== undefined
  const tieneSucursalId = sucursalId !== null && sucursalId !== undefined
  const tieneSucursal = sucursal !== null && sucursal !== undefined

  if (tieneEmpresaId !== tieneEmpresa) {
    throw crearErrorPoliticaUsuario('EMPRESA_INCOHERENTE', 'Inconsistencia en los datos de la empresa')
  }

  if (tieneSucursalId !== tieneSucursal) {
    throw crearErrorPoliticaUsuario('SUCURSAL_INCOHERENTE', 'Inconsistencia en los datos de la sucursal')
  }

  if (tieneEmpresaId) {
    if (!Number.isSafeInteger(empresaId) || empresaId <= 0) {
      throw crearErrorPoliticaUsuario('EMPRESA_INVALIDA', 'La empresa asignada no es válida')
    }

    if (!Number.isSafeInteger(empresa.id) || empresa.id <= 0) {
      throw crearErrorPoliticaUsuario('EMPRESA_INCOHERENTE', 'Inconsistencia en los datos de la empresa')
    }

    if (empresa.id !== empresaId) {
      throw crearErrorPoliticaUsuario('EMPRESA_INCOHERENTE', 'Inconsistencia en los datos de la empresa')
    }
  }

  if (tieneSucursalId) {
    if (!Number.isSafeInteger(sucursalId) || sucursalId <= 0) {
      throw crearErrorPoliticaUsuario('SUCURSAL_INVALIDA', 'La sucursal asignada no es válida')
    }

    if (!Number.isSafeInteger(sucursal.id) || sucursal.id <= 0) {
      throw crearErrorPoliticaUsuario('SUCURSAL_INCOHERENTE', 'Inconsistencia en los datos de la sucursal')
    }

    if (sucursal.id !== sucursalId) {
      throw crearErrorPoliticaUsuario('SUCURSAL_INCOHERENTE', 'Inconsistencia en los datos de la sucursal')
    }
  }

  if (PLATFORM_ROLES.has(rol)) {
    if (tieneEmpresaId) {
      throw crearErrorPoliticaUsuario('EMPRESA_PROHIBIDA', 'El rol del usuario no debe tener empresa asignada')
    }

    if (tieneSucursalId) {
      throw crearErrorPoliticaUsuario('SUCURSAL_PROHIBIDA', 'El rol del usuario no debe tener sucursal asignada')
    }

    return true
  }

  if (!ENTERPRISE_ROLES.has(rol)) {
    throw crearErrorPoliticaUsuario('ROL_INVALIDO', 'Rol de usuario inválido')
  }

  if (!tieneEmpresaId) {
    throw crearErrorPoliticaUsuario('EMPRESA_REQUERIDA', 'El rol del usuario requiere una empresa válida')
  }

  if (empresa.activa !== true) {
    throw crearErrorPoliticaUsuario('EMPRESA_INACTIVA', 'La empresa del usuario está inactiva')
  }

  if (tieneSucursalId) {
    if (sucursal.activa !== true) {
      throw crearErrorPoliticaUsuario('SUCURSAL_INACTIVA', 'La sucursal del usuario está inactiva')
    }

    if (
      !Number.isSafeInteger(sucursal.empresaId) ||
      sucursal.empresaId <= 0 ||
      sucursal.empresaId !== empresaId
    ) {
      throw crearErrorPoliticaUsuario('SUCURSAL_EMPRESA_INCOHERENTE', 'La sucursal no pertenece a la empresa del usuario')
    }
  } else if (ROLES_REQUIEREN_SUCURSAL.has(rol)) {
    throw crearErrorPoliticaUsuario('SUCURSAL_REQUERIDA', 'El rol del usuario requiere una sucursal asignada')
  }

  return true
}

module.exports = {
  crearErrorPoliticaUsuario,
  normalizarIdPositivo,
  validarEstadoUsuarioPorRol
}
