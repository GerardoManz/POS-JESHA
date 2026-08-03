const router = require('express').Router()
const { actualizarPrecios } = require('./precios.controller')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal } = require('../../middlewares/scope.middleware')

// Contexto tenant: requestContext hidrata req.context; tenantGlobal exige empresaId.
// Protegido por requireRole a nivel de app.js (PRECIOS, ADMIN_SUCURSAL, SUPERADMIN)
router.use(requestContext, tenantGlobal)

// PATCH /precios/:id — Actualizar solo campos de precio de un producto
router.patch('/:id', actualizarPrecios)

module.exports = router
