const router = require('express').Router()
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal } = require('../../middlewares/scope.middleware')
const { listar, listarDisponibles } = require('./sucursal.controller')

router.get('/disponibles', requestContext, tenantGlobal, listarDisponibles)
router.get('/', requestContext, tenantGlobal, listar)

module.exports = router
