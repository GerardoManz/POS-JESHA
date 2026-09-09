const router = require('express').Router()
const { listar, crear, editar, cambiarEstado, resetPassword, establecerPin, verificarPin, listarSucursales, listarVendedores, listarResponsablesBitacora, listarBeneficiariosDescuento } = require('./usuarios.controller')
const { requireRole } = require('../../middlewares/auth.middleware')
const { requireTenantOrDelegated } = require('../../middlewares/tenant-or-delegated.middleware')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal, branchOptional } = require('../../middlewares/scope.middleware')

router.use(requireTenantOrDelegated)
router.use(requestContext)

router.get('/vendedores', branchOptional, listarVendedores)
router.get('/responsables-bitacora', tenantGlobal, listarResponsablesBitacora)
router.get('/beneficiarios-descuento', tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), listarBeneficiariosDescuento)

router.get('/sucursales', tenantGlobal, requireRole('SUPERADMIN'), listarSucursales)
router.get('/', tenantGlobal, requireRole('SUPERADMIN'), listar)
router.post('/', tenantGlobal, requireRole('SUPERADMIN'), crear)
router.put('/:id', tenantGlobal, requireRole('SUPERADMIN'), editar)

router.patch('/:id/estado', tenantGlobal, requireRole('SUPERADMIN'), cambiarEstado)
router.post('/:id/reset-password', tenantGlobal, requireRole('SUPERADMIN'), resetPassword)

router.post('/:id/pin', tenantGlobal, requireRole('SUPERADMIN'), establecerPin)
router.post('/:id/verificar-pin', tenantGlobal, verificarPin)

module.exports = router
