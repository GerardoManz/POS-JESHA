// ════════════════════════════════════════════════════════════════════
//  FACTURACION.ROUTES.JS
//  src/modules/facturacion/facturacion.routes.js
//  Rutas PÚBLICAS — sin requireAuth
// ════════════════════════════════════════════════════════════════════

const express   = require('express')
const router    = express.Router()
const ctrl      = require('./facturacion.controller')

// GET  /facturar?token=XXX  — Obtener datos de la venta
router.get('/',  ctrl.obtenerVentaPorToken)

// POST /facturar             — Enviar solicitud de factura
router.post('/', ctrl.solicitarFactura)

module.exports = router