const router = require('express').Router()
const { listar, obtener, crear, editar, cambiarEstado, obtenerVentas, obtenerAbonos, abonarCredito } = require('./clientes.controller')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal } = require('../../middlewares/scope.middleware')
const { requireRole } = require('../../middlewares/auth.middleware')

const ROLES_OPERATIVOS = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO']

router.use(requestContext, tenantGlobal)

router.get('/',                    listar)
router.get('/:id',                 obtener)
router.post('/',                   requireRole(...ROLES_OPERATIVOS), crear)
router.put('/:id',                 requireRole(...ROLES_OPERATIVOS), editar)
router.patch('/:id/estado',        requireRole(...ROLES_OPERATIVOS), cambiarEstado)
router.get('/:id/ventas',          obtenerVentas)
router.get('/:id/abonos',          obtenerAbonos)
router.post('/:id/abonar-credito', requireRole(...ROLES_OPERATIVOS), abonarCredito)

module.exports = router
