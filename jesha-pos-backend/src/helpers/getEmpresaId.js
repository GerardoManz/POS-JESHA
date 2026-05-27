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
  const empresaId = req.usuario?.empresaId
  if (!empresaId) {
    const err = new Error('empresaId no encontrado en el token del usuario')
    err.status = 401
    throw err
  }
  return parseInt(empresaId)
}

module.exports = getEmpresaId
