const router = require('express').Router()
const { listar, crear, editar, cambiarEstado, resetPassword, establecerPin, verificarPin, listarSucursales, listarVendedores, listarResponsablesBitacora } = require('./usuarios.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware')

// Rutas fijas antes que :id
router.get('/sucursales', requireAuth, requireRole('SUPERADMIN', 'PLATFORM_ADMIN'), listarSucursales)
router.get('/vendedores', requireAuth, listarVendedores)  // cualquier rol — solo id+nombre
router.get('/responsables-bitacora', requireAuth, listarResponsablesBitacora)

router.get('/',    requireAuth, requireRole('SUPERADMIN', 'PLATFORM_ADMIN'), listar)
router.post('/',   requireAuth, requireRole('SUPERADMIN', 'PLATFORM_ADMIN'), crear)
router.put('/:id', requireAuth, requireRole('SUPERADMIN', 'PLATFORM_ADMIN'), editar)

router.patch('/:id/estado',        requireAuth, requireRole('SUPERADMIN', 'PLATFORM_ADMIN'), cambiarEstado)
router.post('/:id/reset-password', requireAuth, requireRole('SUPERADMIN', 'PLATFORM_ADMIN'), resetPassword)

// PIN — asignar (solo admins) y verificar (cualquier usuario autenticado)
router.post('/:id/pin',           requireAuth, requireRole('SUPERADMIN', 'PLATFORM_ADMIN'), establecerPin)
router.post('/:id/verificar-pin', requireAuth, verificarPin)

module.exports = router
