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

module.exports = { JERARQUIA_ROLES, puedeGestionar }
