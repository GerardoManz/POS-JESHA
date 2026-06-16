// ════════════════════════════════════════════════════════════════════
//  resolverEmpresaScope(req)
//  src/helpers/resolverEmpresaScope.js
//
//  Resuelve el alcance multiempresa de una petición autenticada.
//  NO reemplaza a getEmpresaId(): ese sigue siendo el helper estricto
//  para CREATES con empresaId NOT NULL. Este se usa en CONSULTAS y
//  MUTACIONES (cancelar, etc.) donde un rol administrativo puede operar
//  en modo global.
//
//  CONTRATO DE RETORNO (no cambiar las claves — los handlers dependen de ellas):
//    { modo: 'GLOBAL' }                  → ve / muta todas las empresas
//    { modo: 'EMPRESA', empresaId: <n> } → acotado a una empresa
//
//  CONSUMO SEGURO en los handlers — construir el where por MODO, nunca
//  leer empresaId sin checar modo:
//    const scope = resolverEmpresaScope(req)
//    const whereScope = scope.modo === 'GLOBAL' ? {} : { empresaId: scope.empresaId }
//  ⚠️ NUNCA hagas { empresaId: scope.empresaId } sin mirar el modo: en
//     GLOBAL no existe empresaId y filtrarías mal (o por undefined).
//
//  DECISIÓN (confirmada): en modo GLOBAL, SUPERADMIN/PLATFORM_ADMIN puede
//  ejecutar mutaciones (cancelar) sobre facturas de CUALQUIER empresa.
//  El whereScope vacío aplica igual a lectura y a mutación.
// ════════════════════════════════════════════════════════════════════

function resolverEmpresaScope(req) {
  const usuario = req.usuario
  if (!usuario) {
    const err = new Error('Usuario no autenticado')
    err.status = 401
    throw err
  }

  const { rol, empresaId } = usuario

  // Admin de plataforma: siempre global (ve todas las empresas).
  if (rol === 'PLATFORM_ADMIN') {
    return { modo: 'GLOBAL' }
  }

  // SUPERADMIN: global si no trae empresaId; acotado si sí lo trae.
  if (rol === 'SUPERADMIN') {
    if (!empresaId) return { modo: 'GLOBAL' }
    return { modo: 'EMPRESA', empresaId: parseInt(empresaId) }
  }

  // Roles operativos: siempre acotados a su empresa. Sin empresaId → 401.
  if (rol === 'ADMIN_SUCURSAL' || rol === 'EMPLEADO' || rol === 'PRECIOS') {
    if (!empresaId) {
      const err = new Error('empresaId requerido para este rol')
      err.status = 401
      throw err
    }
    return { modo: 'EMPRESA', empresaId: parseInt(empresaId) }
  }

  // Rol desconocido → negar por defecto (fail-safe).
  const err = new Error('Rol no autorizado')
  err.status = 403
  throw err
}

module.exports = resolverEmpresaScope