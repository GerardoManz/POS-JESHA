const router = require('express').Router()
const c = require('./proveedores.controller')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal } = require('../../middlewares/scope.middleware')

router.use(requestContext, tenantGlobal)

router.get('/',                       c.listar)
router.post('/',                      c.crear)
router.get('/:id',                    c.obtener)
router.put('/:id',                    c.editar)
router.patch('/:id/activar',          c.toggleActivo)
router.get('/:id/compras',            c.historialCompras)
router.post('/:id/productos',         c.vincularProducto)
router.delete('/:id/productos/:prodId',  c.desvincularProducto)

module.exports = router
