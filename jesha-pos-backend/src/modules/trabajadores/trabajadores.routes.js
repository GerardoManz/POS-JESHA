const router = require('express').Router()
const { requireRole } = require('../../middlewares/auth.middleware')
const { requireTenantOrDelegated } = require('../../middlewares/tenant-or-delegated.middleware')
const { listar, crear, editar, cambiarEstado } = require('./trabajadores.controller')

// Lectura — cualquier rol autenticado (para dropdown de Bitácora)
router.get('/',           requireTenantOrDelegated, listar)

// Gestión — solo SUPERADMIN y ADMIN_SUCURSAL
router.post('/',          requireTenantOrDelegated, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), crear)
router.put('/:id',        requireTenantOrDelegated, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), editar)
router.patch('/:id/estado', requireTenantOrDelegated, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), cambiarEstado)

module.exports = router
