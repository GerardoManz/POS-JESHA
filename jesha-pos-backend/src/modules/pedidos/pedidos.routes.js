// src/modules/pedidos/pedidos.routes.js
const router     = require('express').Router()
const controller = require('./pedidos.controller')

router.get('/',             controller.listar)
router.get('/:id',          controller.obtener)
router.post('/',            controller.crear)
router.put('/:id',          controller.editar)
router.patch('/:id/estado', controller.cambiarEstado)

module.exports = router
