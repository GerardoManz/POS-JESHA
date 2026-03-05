const router = require('express').Router()
const { listar, crear, editar, cambiarEstado, resetPassword, listarSucursales } = require('./usuarios.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware')

// IMPORTANTE: ruta fija antes que rutas con :id
router.get('/sucursales', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), listarSucursales)

router.get('/', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), listar)
router.post('/', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), crear)
router.put('/:id', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), editar)
router.patch('/:id/estado', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), cambiarEstado)
router.post('/:id/reset-password', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), resetPassword)

module.exports = router