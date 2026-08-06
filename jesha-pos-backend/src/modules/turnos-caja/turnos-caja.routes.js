const express = require('express')
const router = express.Router()
const { requireAuth } = require('../../middlewares/auth.middleware')
const { branchRequired, branchOptional } = require('../../middlewares/scope.middleware')
const {
  obtenerActivo,
  obtenerResumen,
  abrirTurno,
  cerrarTurno,
  obtenerHistorial,
  obtenerResumenContable
} = require('./turnos-caja.controller')
const { generarTicketCorte } = require('./ticket-corte.controller')

router.get('/activo',                    requireAuth, branchOptional, obtenerActivo)
router.get('/resumen',                   requireAuth, branchOptional, obtenerResumen)
router.get('/historial',                 requireAuth, branchOptional, obtenerHistorial)
router.get('/resumen-contable',          requireAuth, branchOptional, obtenerResumenContable)
router.post('/abrir',                    requireAuth, branchRequired, abrirTurno)
router.post('/cerrar',                   requireAuth, branchRequired, cerrarTurno)
router.get('/:id/ticket',                requireAuth, generarTicketCorte)

module.exports = router