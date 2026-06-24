const prisma = require('../lib/prisma')

// ⚠️ El CP devuelto debe coincidir con el LugarExpedicion del CSD en Facturapi.
// Desincronizarlos invalida CFDIs globales (CP del receptor genérico ≠ LugarExpedicion).
// v1: hardcoded via env var. Cuando Empresa tenga codigoPostal/email, leer de BD aquí.
// Cada call site resuelve una vez y pasa el objeto — nunca hardcodear CP en los builders.
function resolverDatosEmisor(empresaId) {
  return {
    cp: process.env.JESHA_CP_EMISOR || '98660',
    email: null
  }
}

module.exports = resolverDatosEmisor
