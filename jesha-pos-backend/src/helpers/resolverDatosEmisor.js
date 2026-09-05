// ════════════════════════════════════════════════════════════════════
//  HELPERS/RESOLVERDATOSEMISOR.JS
//  src/helpers/resolverDatosEmisor.js
//
//  P1 — Emisor tenant-aware. Resuelve los datos fiscales del emisor a partir
//  de la ConfiguracionFiscal de CADA Empresa (jamás un emisor global único).
//
//  FAIL-CLOSED: si la Empresa no tiene ConfiguracionFiscal → FiscalError 409
//  FISCAL_CONFIG_NOT_READY. NO cae a la key global de JESHA ni al CP hardcoded
//  (se eliminó la autoridad `JESHA_CP_EMISOR || '98660'` de este helper).
//
//  Cada call site resuelve una vez y pasa el objeto — nunca hardcodear CP en
//  los builders. `cp` es el CP FISCAL de la empresa (para RFC genérico y
//  global); el LugarExpedicion de facturas individuales sale de la sucursal.
// ════════════════════════════════════════════════════════════════════

'use strict'

const prisma = require('../lib/prisma')
const { FiscalError } = require('../lib/facturapi')
const { derivarEstadoFiscal } = require('./estado-fiscal.helper')

async function resolverDatosEmisor(empresaId) {
  const config = await prisma.configuracionFiscal.findUnique({ where: { empresaId } })
  if (!config) {
    throw new FiscalError(
      409,
      'FISCAL_CONFIG_NOT_READY',
      'La facturación de esta empresa no está configurada. No se puede timbrar.'
    )
  }
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { rfc: true, razonSocial: true, nombreComercial: true }
  })
  const cp = config.codigoPostalFiscal ?? null
  return {
    empresaId,
    rfc: empresa?.rfc ?? null,
    razonSocial: empresa?.razonSocial ?? null,
    nombreComercial: empresa?.nombreComercial ?? null,
    regimenFiscal: config.regimenFiscal ?? null,
    codigoPostalFiscal: config.codigoPostalFiscal ?? null,
    cp,
    organizationId: config.facturapiOrganizationId ?? null,
    status: derivarEstadoFiscal(config),
    csdSerial: config.csdSerial ?? null,
    csdExpiraEn: config.csdExpiraEn ?? null,
    email: null
  }
}

module.exports = resolverDatosEmisor