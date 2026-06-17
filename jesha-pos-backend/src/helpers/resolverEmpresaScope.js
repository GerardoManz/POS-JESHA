// ════════════════════════════════════════════════════════════════════
//  RESOLVER-EMPRESA-SCOPE.JS
//  src/helpers/resolverEmpresaScope.js
//
//  Resuelve el scope multi-tenant a partir de req.usuario (JWT).
//  Contrato:
//    { modo: 'GLOBAL' }                  → sin filtro de empresa
//    { modo: 'EMPRESA', empresaId: <int> } → acotar por empresaId
//  Los errores se lanzan con .status (HTTP) y .expose = true para que
//  los catch de los controladores los propaguen como 401/403 y no como
//  500 genérico. Errores SIN expose (p.ej. del SDK de Facturapi) NO se
//  relayan: el controlador los degrada a 500.
// ════════════════════════════════════════════════════════════════════

function httpError(status, msg) {
  const err = new Error(msg)
  err.status = status
  err.expose = true
  return err
}

function resolverEmpresaScope(req) {
  const usuario = req.usuario
  if (!usuario) throw httpError(401, 'Usuario no autenticado')

  const { rol, empresaId } = usuario

  // Admin de plataforma: siempre global (ve todas las empresas).
  if (rol === 'PLATFORM_ADMIN') {
    return { modo: 'GLOBAL' }
  }

  // SUPERADMIN: global si no trae empresaId; acotado si sí lo trae.
  if (rol === 'SUPERADMIN') {
    if (!empresaId) return { modo: 'GLOBAL' }
    const id = Number(empresaId)
    if (!Number.isInteger(id)) throw httpError(401, 'empresaId inválido en token')
    return { modo: 'EMPRESA', empresaId: id }
  }

  // Roles operativos: siempre acotados a su empresa. Sin empresaId → 401.
  if (rol === 'ADMIN_SUCURSAL' || rol === 'EMPLEADO' || rol === 'PRECIOS') {
    if (!empresaId) throw httpError(401, 'empresaId requerido para este rol')
    const id = Number(empresaId)
    if (!Number.isInteger(id)) throw httpError(401, 'empresaId inválido en token')
    return { modo: 'EMPRESA', empresaId: id }
  }

  // Rol desconocido → negar por defecto (fail-safe).
  throw httpError(403, 'Rol no autorizado')
}

module.exports = resolverEmpresaScope
