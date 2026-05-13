const express = require('express')
const router = express.Router()
const { requireAuth } = require('../../middlewares/auth.middleware')
const {
  obtenerActivo,
  obtenerResumen,
  abrirTurno,
  cerrarTurno,
  obtenerHistorial,
  obtenerResumenContable
} = require('./turnos-caja.controller')
const { generarTicketCorte } = require('./ticket-corte.controller')

router.get('/activo',                    requireAuth, obtenerActivo)
router.get('/resumen',                   requireAuth, obtenerResumen)
router.get('/historial',                 requireAuth, obtenerHistorial)
router.get('/resumen-contable',          requireAuth, obtenerResumenContable)
router.post('/abrir',                    requireAuth, abrirTurno)
router.post('/cerrar',                   requireAuth, cerrarTurno)
router.get('/:id/ticket',                generarTicketCorte)

module.exports = router