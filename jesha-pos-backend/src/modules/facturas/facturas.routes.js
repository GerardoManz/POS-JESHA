// ════════════════════════════════════════════════════════════════════
//  FACTURAS.ROUTES.JS
//  src/modules/facturas/facturas.routes.js
// ════════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const ctrl    = require('./facturas.controller')

router.get('/',               ctrl.listar)
router.get('/:id',            ctrl.obtener)
router.patch('/:id/cancelar', ctrl.cancelar)

module.exports = router
