'use strict'

const getEmpresaId = require('./getEmpresaId')

/**
 * Construye el scope tenant para queries Prisma de listado.
 * - `empresaId`: siempre desde req.context (autoritativo, nunca de body/query/token).
 * - `sucursalId`: solo para roles tenant con sucursal fija (ADMIN_SUCURSAL/EMPLEADO/PRECIOS).
 *   SUPERADMIN ve todas las sucursales de su empresa.
 *
 * Uso:
 *   const where = construirWhereScopeTenant(req)
 *   const where = construirWhereScopeTenant(req, { incluirSucursal: false })
 */
function construirWhereScopeTenant(req, { incluirSucursal = true } = {}) {
  const { rol, sucursalId } = req.usuario
  const where = { empresaId: getEmpresaId(req) }

  if (incluirSucursal && rol !== 'SUPERADMIN' && sucursalId) {
    where.sucursalId = parseInt(sucursalId, 10)
  }

  return where
}

module.exports = construirWhereScopeTenant
