/**
 * Extrae empresaId del usuario autenticado (JWT).
 * Todos los controllers deben usar este helper para crear registros
 * en modelos con empresaId NOT NULL.
 *
 * @param {Object} req - Express request con req.usuario (del JWT)
 * @returns {number} empresaId
 * @throws {Error} si no existe empresaId en el token
 */
function getEmpresaId(req) {
  const { rol, empresaId: tokenEmpresaId } = req.usuario || {}

  if (rol === 'PLATFORM_ADMIN') {
    const fromRequest = req.body?.empresaId ?? req.query?.empresaId
    const empresaId = tokenEmpresaId ?? fromRequest
    if (!empresaId) {
      const err = new Error('PLATFORM_ADMIN debe especificar empresaId en el cuerpo o query de la petición')
      err.status = 400
      throw err
    }
    return parseInt(empresaId)
  }

  if (!tokenEmpresaId) {
    const err = new Error('empresaId no encontrado en el token del usuario')
    err.status = 401
    throw err
  }
  return parseInt(tokenEmpresaId)
}

module.exports = getEmpresaId
