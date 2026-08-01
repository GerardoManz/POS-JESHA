'use strict'

const { assertTenantRequestContext } = require('../../security/request-context')

/**
 * Devuelve la sucursal operativa ya validada por request-context.
 * null significa que la ruta permite alcance global/opcional y no se seleccionó sucursal.
 */
module.exports = function resolverSucursalId(req) {
  const context = assertTenantRequestContext(req && req.context)
  return context.branch.sucursalId
}
