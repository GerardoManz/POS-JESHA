const router = require('express').Router()
const { listar, crear, editar, cambiarEstado, resetPassword, establecerPin, verificarPin, listarSucursales, listarVendedores, listarResponsablesBitacora } = require('./usuarios.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware')

// Rutas fijas antes que :id
router.get('/sucursales', requireAuth, requireRole('SUPERADMIN'), listarSucursales)
router.get('/vendedores', requireAuth, listarVendedores)  // cualquier rol — solo id+nombre
router.get('/responsables-bitacora', requireAuth, listarResponsablesBitacora)

router.get('/',    requireAuth, requireRole('SUPERADMIN'), listar)
router.post('/',   requireAuth, requireRole('SUPERADMIN'), crear)
router.put('/:id', requireAuth, requireRole('SUPERADMIN'), editar)

router.patch('/:id/estado',        requireAuth, requireRole('SUPERADMIN'), cambiarEstado)
router.post('/:id/reset-password', requireAuth, requireRole('SUPERADMIN'), resetPassword)

// PIN — asignar (solo admins) y verificar (cualquier usuario autenticado)
router.post('/:id/pin',           requireAuth, requireRole('SUPERADMIN'), establecerPin)
router.post('/:id/verificar-pin', requireAuth, verificarPin)

module.exports = router
