// src/modules/pedidos/pedidos.routes.js
const router     = require('express').Router()
const controller = require('./pedidos.controller')
const { requireRole } = require('../../middlewares/auth.middleware')

const ROLES_OPERATIVOS = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO']

router.get('/',             controller.listar)
router.get('/:id',          controller.obtener)
router.post('/',            requireRole(...ROLES_OPERATIVOS), controller.crear)
router.put('/:id',          requireRole(...ROLES_OPERATIVOS), controller.editar)
router.patch('/:id/estado', requireRole(...ROLES_OPERATIVOS), controller.cambiarEstado)

module.exports = router
