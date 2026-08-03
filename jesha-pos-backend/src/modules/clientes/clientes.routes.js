const router = require('express').Router()
const { listar, obtener, crear, editar, cambiarEstado, obtenerVentas, obtenerAbonos, abonarCredito } = require('./clientes.controller')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal } = require('../../middlewares/scope.middleware')

router.use(requestContext, tenantGlobal)

router.get('/',                    listar)
router.get('/:id',                 obtener)
router.post('/',                   crear)
router.put('/:id',                 editar)
router.patch('/:id/estado',        cambiarEstado)
router.get('/:id/ventas',          obtenerVentas)
router.get('/:id/abonos',          obtenerAbonos)
router.post('/:id/abonar-credito', abonarCredito)

module.exports = router
