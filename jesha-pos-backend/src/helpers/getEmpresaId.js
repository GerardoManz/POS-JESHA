/**
 * Extrae empresaId del usuario autenticado (JWT).
 * Todos los controllers deben usar este helper para crear registros
 * en modelos con empresaId NOT NULL.
 *
 * @param {Object} req - Express request con req.usuario (del JWT)
 * @returns {number} empresaId
 * @throws {Error} si no existe empresaId en el token (con err.expose para respuesta clara)
 */
function getEmpresaId(req) {
  const { rol, empresaId: tokenEmpresaId } = req.usuario || {}

  if (rol === 'PLATFORM_ADMIN') {
    const fromRequest = req.body?.empresaId ?? req.query?.empresaId
    const empresaId = tokenEmpresaId ?? fromRequest
    if (!empresaId) {
      const err = new Error('PLATFORM_ADMIN debe especificar empresaId en el cuerpo o query de la petición')
      err.status = 400
      err.expose = true
      throw err
    }
    const id = parseInt(empresaId, 10)
    if (!Number.isInteger(id)) {
      const err = new Error('empresaId inválido (no numérico)')
      err.status = 400
      err.expose = true
      throw err
    }
    return id
  }

  if (!tokenEmpresaId) {
    const err = new Error('empresaId no encontrado en el token del usuario')
    err.status = 401
    err.expose = true
    throw err
  }
  const id = parseInt(tokenEmpresaId, 10)
  if (!Number.isInteger(id)) {
    const err = new Error('empresaId inválido en el token')
    err.status = 401
    err.expose = true
    throw err
  }
  return id
}

module.exports = getEmpresaId
