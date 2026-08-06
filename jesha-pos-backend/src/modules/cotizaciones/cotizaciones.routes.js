// ════════════════════════════════════════════════════════════════════
//  COTIZACIONES.ROUTES.JS
//  Ubicación: src/modules/cotizaciones/cotizaciones.routes.js
//
//  Todas las rutas ya llegan con requireAuth aplicado desde app.js
//  PATCH /:id/estado debe ir ANTES de GET /:id para que Express
//  no interprete "estado" como un :id
// ════════════════════════════════════════════════════════════════════

const router  = require('express').Router()
const ctrl    = require('./cotizaciones.controller')
const { requireRole } = require('../../middlewares/auth.middleware')
const { branchRequired } = require('../../middlewares/scope.middleware')

// GET  /cotizaciones          — lista con filtros y paginación
router.get('/',                ctrl.listar)

// POST /cotizaciones          — crear nueva
router.post('/',               branchRequired, ctrl.crear)

// PATCH /cotizaciones/:id/estado  — cambiar estado (ruta fija antes de /:id)
router.patch('/:id/estado',    branchRequired, requireRole('ADMIN_SUCURSAL', 'SUPERADMIN'), ctrl.cambiarEstado)

// GET  /cotizaciones/:id      — detalle completo con detalles
router.get('/:id',             ctrl.obtener)

// PUT  /cotizaciones/:id      — editar cotización (solo PENDIENTE)
router.put('/:id',             branchRequired, ctrl.editar)

module.exports = router
