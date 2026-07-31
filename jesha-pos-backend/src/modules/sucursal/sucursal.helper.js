/**
 * Helper centralizado para resolver la sucursalId válida en requests.
 * - SUPERADMIN puede consultar por cualquier sucursal o todas (null)
 * - ADMIN_SUCURSAL/EMPLEADO solo ve la suya
 * - ADMIN sin sucursal → error 400
 * - Valor inválido (no numérico) → error 400
 */
module.exports = function resolverSucursalId(req) {
  const { rol, sucursalId: sucToken } = req.usuario

  if (rol === 'SUPERADMIN' || rol === 'PLATFORM_ADMIN') {
    const raw = req.query.sucursalId ?? req.body?.sucursalId ?? req.params?.sucursalId
    const sucSolicitada = raw !== undefined ? parseInt(raw) : null

    if (sucSolicitada !== null && isNaN(sucSolicitada)) {
      const err = new Error('sucursalId inválido')
      err.status = 400
      throw err
    }

    return sucSolicitada // null = todas las sucursales
  }

  if (!sucToken) {
    const err = new Error('Usuario sin sucursal asignada')
    err.status = 400
    throw err
  }

  return sucToken
}