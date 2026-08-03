// ════════════════════════════════════════════════════════════════════
//  INVENTARIO ROUTES
//  Ubicación: src/modules/inventario/inventario.routes.js
//  Nota: requireAuth se aplica desde app.js (igual que productos, ventas, etc.)
// ════════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const ctrl    = require('./inventario.controller')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { branchRequired } = require('../../middlewares/scope.middleware')

// Contexto tenant: requestContext hidrata req.context; branchRequired exige
// que la sucursal se resuelva del contexto (FIXED/SELECTED), nunca del body.
router.use(requestContext)

// POST /inventario/ajuste-rapido
router.post('/ajuste-rapido', branchRequired, ctrl.ajusteRapido)

module.exports = router
