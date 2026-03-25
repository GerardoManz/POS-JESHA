const router = require('express').Router()
const { listar, crear, editar, cambiarEstado, resetPassword, establecerPin, verificarPin, listarSucursales, listarVendedores } = require('./usuarios.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware')

// Rutas fijas antes que :id
router.get('/sucursales', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), listarSucursales)
router.get('/vendedores', requireAuth, listarVendedores)  // cualquier rol — solo id+nombre

router.get('/',    requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), listar)
router.post('/',   requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), crear)
router.put('/:id', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), editar)

router.patch('/:id/estado',        requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), cambiarEstado)
router.post('/:id/reset-password', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), resetPassword)

// PIN — asignar (solo admins) y verificar (cualquier usuario autenticado)
router.post('/:id/pin',           requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), establecerPin)
router.post('/:id/verificar-pin', requireAuth, verificarPin)

module.exports = router