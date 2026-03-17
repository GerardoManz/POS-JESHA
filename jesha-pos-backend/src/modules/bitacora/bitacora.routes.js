// src/modules/bitacora/bitacora.routes.js
const router = require('express').Router()
const c      = require('./bitacora.controller')

router.get('/',                          c.listar)
router.get('/:id',                       c.obtener)
router.post('/',                         c.crear)
router.patch('/:id',                     c.editar)
router.patch('/:id/estado',              c.cambiarEstado)
router.post('/:id/productos',            c.agregarProducto)
router.delete('/:id/productos/:detalleId', c.quitarProducto)
router.post('/:id/abonos',               c.registrarAbono)

module.exports = router
