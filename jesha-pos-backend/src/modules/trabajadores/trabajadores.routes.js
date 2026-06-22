const router = require('express').Router()
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware')
const { listar, crear, editar, cambiarEstado } = require('./trabajadores.controller')

// Lectura — cualquier rol autenticado (para dropdown de Bitácora)
router.get('/',           requireAuth, listar)

// Gestión — solo SUPERADMIN y ADMIN_SUCURSAL
router.post('/',          requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), crear)
router.put('/:id',        requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), editar)
router.patch('/:id/estado', requireAuth, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), cambiarEstado)

module.exports = router
