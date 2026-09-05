const express = require('express')
const router = express.Router()
const { requireTenantOrDelegated } = require('../../middlewares/tenant-or-delegated.middleware')
const { requireRole } = require('../../middlewares/auth.middleware')
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

const ROLES_OPERATIVOS = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO']

router.get('/activo',                    requireTenantOrDelegated, branchOptional, obtenerActivo)
router.get('/resumen',                   requireTenantOrDelegated, branchOptional, obtenerResumen)
router.get('/historial',                 requireTenantOrDelegated, branchOptional, obtenerHistorial)
router.get('/resumen-contable',          requireTenantOrDelegated, branchOptional, obtenerResumenContable)
router.post('/abrir',                    requireTenantOrDelegated, requireRole(...ROLES_OPERATIVOS), branchRequired, abrirTurno)
router.post('/cerrar',                   requireTenantOrDelegated, requireRole(...ROLES_OPERATIVOS), branchRequired, cerrarTurno)
router.get('/:id/ticket',                requireTenantOrDelegated, generarTicketCorte)

module.exports = router
