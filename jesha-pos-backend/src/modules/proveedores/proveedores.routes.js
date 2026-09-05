const router = require('express').Router()
const c = require('./proveedores.controller')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal } = require('../../middlewares/scope.middleware')
const { requireRole } = require('../../middlewares/auth.middleware')

router.use(requestContext, tenantGlobal)

router.get('/',                       c.listar)
router.post('/',                      requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), c.crear)
router.get('/:id',                    c.obtener)
router.put('/:id',                    requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), c.editar)
router.patch('/:id/activar',          requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), c.toggleActivo)
router.get('/:id/compras',            c.historialCompras)
router.post('/:id/productos',         requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), c.vincularProducto)
router.delete('/:id/productos/:prodId', requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), c.desvincularProducto)

module.exports = router
