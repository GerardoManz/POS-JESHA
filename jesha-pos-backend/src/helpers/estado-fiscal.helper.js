// ════════════════════════════════════════════════════════════════════
//  HELPERS/ESTADO-FISCAL.HELPER.JS
//  src/helpers/estado-fiscal.helper.js
//
//  Deriva el estado de la ConfiguracionFiscal de una Empresa SIN enum en BD:
//    NO_CONFIGURADA  — sin Organization Facturapi.
//    CONFIGURANDO    — Organization creada pero no lista (isProductionReady != true),
//                      o falta live key en producción.
//    LISTA           — Organization + isProductionReady = true + live key presente.
//
//  Este estado es el que ven SUPERADMIN (tenant) y PLATFORM_ADMIN (solo lectura).
// ════════════════════════════════════════════════════════════════════

'use strict'

function derivarEstadoFiscal(config) {
  if (!config || !config.facturapiOrganizationId) return 'NO_CONFIGURADA'
  if (config.isProductionReady !== true) return 'CONFIGURANDO'
  // En producción se requiere live key explícita para estar "LISTA".
  // Sin ella, la empresa puede operar en test pero NO en producción.
  if (!config.facturapiLiveKeyEnc) return 'CONFIGURANDO'
  return 'LISTA'
}

module.exports = { derivarEstadoFiscal }