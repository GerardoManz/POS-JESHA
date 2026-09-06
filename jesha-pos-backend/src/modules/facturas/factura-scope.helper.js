'use strict'

// FACTURA-SCOPE.HELPER.JS
// src/modules/facturas/factura-scope.helper.js
//
// Scopes multi-tenant compartidos por los tres controllers del dominio fiscal
// (facturas, facturacion, resolver-timbrado). Module-local: no es helper global.
//
// Contrato de buildFacturaScope (P0-BRANCH-ISOLATION):
//  - NONE (SUPERADMIN sin X-Sucursal-Id) -> todas las facturas de su empresa.
//  - SELECTED / FIXED -> solo facturas totalmente atribuibles a la sucursal
//    operativa (toda venta asociada en esa sucursal), incluyendo el caso
//    legacy (FacturaVenta vacia + Venta.sucursalId = operativa).
//  - Facturas CONJUNTA/GLOBAL multi-sucursal quedan visibles SOLO en NONE.
//
// La autoridad SIEMPRE sale de req.context (getEmpresaId / resolverSucursalId).
// Nunca de JWT, body, query ni params.

const getEmpresaId = require('../../helpers/getEmpresaId')
const resolverSucursalId = require('../sucursal/sucursal.helper')

function buildFacturaScope(req) {
  const empresaId = getEmpresaId(req)
  const sucursalId = resolverSucursalId(req)
  if (sucursalId === null || sucursalId === undefined) {
    return { empresaId }
  }
  return {
    empresaId,
    OR: [
      // Multi-venta: todas las ventas de la factura en la sucursal operativa
      {
        FacturaVenta: {
          some: { Venta: { sucursalId } },
          none: { Venta: { sucursalId: { not: sucursalId } } }
        }
      },
      // Legacy individual: sin FacturaVenta, venta directa en la sucursal
      {
        FacturaVenta: { none: {} },
        Venta: { sucursalId }
      }
    ]
  }
}

// Scope de Venta para liberar facturación (misma rama operativa).
function buildVentaScopeFacturas(req) {
  const where = { empresaId: getEmpresaId(req) }
  const sucursalId = resolverSucursalId(req)
  if (sucursalId !== null && sucursalId !== undefined) {
    where.sucursalId = sucursalId
  }
  return where
}

module.exports = buildFacturaScope
module.exports.buildFacturaScope = buildFacturaScope
module.exports.buildVentaScopeFacturas = buildVentaScopeFacturas