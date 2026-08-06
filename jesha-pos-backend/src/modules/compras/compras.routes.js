// src/modules/compras/compras.routes.js
const router = require('express').Router()
const { branchRequired } = require('../../middlewares/scope.middleware')
const c      = require('./compras.controller')

router.get('/proveedores',     c.listarProveedores)
router.post('/proveedores',    c.crearProveedor)
router.get('/',                c.listar)
router.post('/',               branchRequired, c.crear)
router.get('/:id',             c.obtener)
router.put('/:id',             c.editar)
router.post('/:id/recibir',    branchRequired, c.recibir)
router.post('/:id/abonos',     c.registrarAbono)
router.patch('/:id/cancelar',  c.cancelar)

module.exports = router