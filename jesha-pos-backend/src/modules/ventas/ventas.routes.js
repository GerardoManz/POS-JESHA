// ════════════════════════════════════════════════════════════════════
//  VENTAS ROUTES
//  Ubicación: src/modules/ventas/ventas.routes.js
// ════════════════════════════════════════════════════════════════════

const express = require('express')
const router = express.Router()

const {
  crearVenta,
  obtenerVentas,
  obtenerVenta,
  obtenerHistorial
} = require('./ventas.controller')

/**
 * POST /api/ventas
 * Crear nueva venta
 */
router.post('/', crearVenta)

/**
 * GET /api/ventas
 * Obtener lista de ventas con paginación y filtros
 */
router.get('/', obtenerVentas)

/**
 * GET /api/ventas/:id
 * Obtener venta específica con detalles
 */
router.get('/:id', obtenerVenta)

/**
 * GET /api/ventas/historial
 * Obtener historial de ventas (más datos)
 */
router.get('/historial/lista', obtenerHistorial)

module.exports = router