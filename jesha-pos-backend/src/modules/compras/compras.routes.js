// src/modules/compras/compras.routes.js
const router = require('express').Router()
const { branchRequired } = require('../../middlewares/scope.middleware')
const { requireRole } = require('../../middlewares/auth.middleware')
const c      = require('./compras.controller')

router.get('/proveedores',     requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO'), c.listarProveedores)
router.post('/proveedores',    requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), c.crearProveedor)
router.get('/',                requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO'), c.listar)
router.post('/',               requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), branchRequired, c.crear)
router.get('/:id',             requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO'), c.obtener)
router.put('/:id',             requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), branchRequired, c.editar)
router.post('/:id/recibir',    requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), branchRequired, c.recibir)
router.post('/:id/abonos',     requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), branchRequired, c.registrarAbono)
router.patch('/:id/cancelar',  requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), branchRequired, c.cancelar)

module.exports = router
