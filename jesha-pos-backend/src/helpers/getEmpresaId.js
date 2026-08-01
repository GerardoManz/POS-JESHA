'use strict'

const { assertTenantRequestContext } = require('../security/request-context')

/**
 * Obtiene la empresa autoritativa del contexto tenant rehidratado.
 * Nunca acepta empresaId desde JWT, body, query o params.
 */
function getEmpresaId(req) {
  const context = assertTenantRequestContext(req && req.context)
  return context.tenant.empresaId
}

module.exports = getEmpresaId
