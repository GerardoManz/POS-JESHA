// ════════════════════════════════════════════════════════════════════
//  DEVOLUCIONES ROUTES
//  Ubicación: src/modules/devoluciones/devoluciones.routes.js
// ════════════════════════════════════════════════════════════════════

const express    = require('express')
const router     = express.Router()
const ctrl       = require('./devoluciones.controller')

// GET  /devoluciones              — listado con filtros
router.get('/',                 ctrl.listar)

// GET  /devoluciones/venta/:id   — devoluciones de una venta específica
router.get('/venta/:ventaId',   ctrl.porVenta)

// POST /devoluciones              — crear devolución
router.post('/',                ctrl.crear)

module.exports = router