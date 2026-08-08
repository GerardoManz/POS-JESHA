const router = require('express').Router()
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal } = require('../../middlewares/scope.middleware')
const { requireRole } = require('../../middlewares/auth.middleware')
const {
  listar,
  listarDisponibles,
  gestion,
  obtener,
  crear,
  editar,
  activar,
  desactivar
} = require('./sucursal.controller')

// ── Contratos operativos (cualquier rol tenant autenticado) ──
router.get('/disponibles', requestContext, tenantGlobal, listarDisponibles)
router.get('/', requestContext, tenantGlobal, listar)

// ── Administración de sucursales (solo SUPERADMIN) ──
router.get('/gestion', requestContext, tenantGlobal, requireRole('SUPERADMIN'), gestion)
router.get('/gestion/:id', requestContext, tenantGlobal, requireRole('SUPERADMIN'), obtener)
router.post('/gestion', requestContext, tenantGlobal, requireRole('SUPERADMIN'), crear)
router.patch('/gestion/:id', requestContext, tenantGlobal, requireRole('SUPERADMIN'), editar)
router.post('/gestion/:id/activar', requestContext, tenantGlobal, requireRole('SUPERADMIN'), activar)
router.post('/gestion/:id/desactivar', requestContext, tenantGlobal, requireRole('SUPERADMIN'), desactivar)

module.exports = router