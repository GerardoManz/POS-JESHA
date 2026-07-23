// ════════════════════════════════════════════════════════════════════
//  JERARQUÍA DE ROLES — Fuente única de verdad para permisos
//  Mayor número = más privilegios
//  Al agregar un nuevo rol, solo se actualiza este archivo.
// ════════════════════════════════════════════════════════════════════

const JERARQUIA_ROLES = {
  PLATFORM_ADMIN: 4,
  SUPERADMIN: 3,
  ADMIN_SUCURSAL: 2,
  EMPLEADO: 1,
  PRECIOS: 1     // mismo nivel operativo que EMPLEADO
}

// Verifica si el solicitante puede gestionar (crear/editar/desactivar/resetear)
// a un usuario del rol objetivo.
// Regla: el nivel del solicitante debe ser estrictamente mayor.
function puedeGestionar(rolSolicitante, rolObjetivo) {
  return JERARQUIA_ROLES[rolSolicitante] > JERARQUIA_ROLES[rolObjetivo]
}

const ROLES_VALIDOS = new Set(Object.keys(JERARQUIA_ROLES))

const PLATFORM_ROLES = new Set([
  'PLATFORM_ADMIN'
])

const ENTERPRISE_ROLES = new Set([
  'SUPERADMIN',
  'ADMIN_SUCURSAL',
  'EMPLEADO',
  'PRECIOS'
])

const ROLES_REQUIEREN_SUCURSAL = new Set([
  'EMPLEADO'
])

module.exports = {
  JERARQUIA_ROLES,
  ROLES_VALIDOS,
  PLATFORM_ROLES,
  ENTERPRISE_ROLES,
  ROLES_REQUIEREN_SUCURSAL,
  puedeGestionar
}
