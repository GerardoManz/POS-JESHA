'use strict'

const getEmpresaId = require('./getEmpresaId')
const resolverSucursalId = require('../modules/sucursal/sucursal.helper')

/**
 * Construye el scope tenant para queries Prisma de listado.
 * - `empresaId`: siempre desde req.context (autoritativo, nunca de body/query/token).
 * - `sucursalId`: desde el contexto de sucursal operativa (req.context.branch.sucursalId).
 *   Incluye sucursal cuando el modo de rama NO es NONE (FIXED o SELECTED).
 *   SUPERADMIN+NONE ve todas las sucursales de su empresa.
 *
 * Uso:
 *   const where = construirWhereScopeTenant(req)
 *   const where = construirWhereScopeTenant(req, { incluirSucursal: false })
 */
function construirWhereScopeTenant(req, { incluirSucursal = true } = {}) {
  const where = { empresaId: getEmpresaId(req) }

  if (incluirSucursal) {
    const sucursalId = resolverSucursalId(req)
    if (sucursalId !== null && sucursalId !== undefined) {
      where.sucursalId = parseInt(sucursalId, 10)
    }
  }

  return where
}

module.exports = construirWhereScopeTenant
