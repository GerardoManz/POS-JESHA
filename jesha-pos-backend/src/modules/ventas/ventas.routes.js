// ════════════════════════════════════════════════════════════════════
//  VENTAS ROUTES
//  src/modules/ventas/ventas.routes.js
// ════════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const { crearVenta, obtenerVentas, obtenerVenta, obtenerHistorial, cancelarVenta } = require('./ventas.controller')
const ticketController = require('./ticket.controller')

// POST /ventas — Crear venta
router.post('/', crearVenta)

// GET /ventas — Lista con filtros y paginación
router.get('/', obtenerVentas)

// GET /ventas/historial/lista
router.get('/historial/lista', obtenerHistorial)

// PATCH /ventas/:id/cancelar — Cancelar venta
router.patch('/:id/cancelar', cancelarVenta)

// GET /ventas/:id/ticket — Ticket imprimible (desktop)
router.get('/:id/ticket', ticketController.generarTicket)

// GET /ventas/:id/ticket/thermal — Ticket optimizado 80mm
router.get('/:id/ticket/thermal', ticketController.generarTicketThermal)

// GET /ventas/:id — Venta específica con detalles
router.get('/:id', obtenerVenta)

module.exports = router