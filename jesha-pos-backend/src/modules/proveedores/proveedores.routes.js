// src/modules/proveedores/proveedores.routes.js
const router = require('express').Router()
const c      = require('./proveedores.controller')

router.get('/',                       c.listar)
router.post('/',                      c.crear)
router.get('/:id',                    c.obtener)
router.put('/:id',                    c.editar)
router.patch('/:id/activar',          c.toggleActivo)
router.get('/:id/compras',            c.historialCompras)
router.post('/:id/productos',         c.vincularProducto)
router.delete('/:id/productos/:prodId',  c.desvincularProducto)

module.exports = router
