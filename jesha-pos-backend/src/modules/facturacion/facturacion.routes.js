// ════════════════════════════════════════════════════════════════════
//  FACTURACION.ROUTES.JS
//  src/modules/facturacion/facturacion.routes.js
//  Rutas PÚBLICAS — sin requireAuth (portal autofactura)
// ════════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const ctrl    = require('./facturacion.controller')

// GET  /facturar/api?token=XXX — datos de la venta para el formulario
router.get('/',         ctrl.obtenerVentaPorToken)

// POST /facturar/api — solicitar + timbrar (o guardar pendiente)
router.post('/',        ctrl.solicitarFactura)

module.exports = router