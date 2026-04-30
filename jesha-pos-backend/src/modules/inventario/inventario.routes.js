// ════════════════════════════════════════════════════════════════════
//  INVENTARIO ROUTES
//  Ubicación: src/modules/inventario/inventario.routes.js
//  Nota: requireAuth se aplica desde app.js (igual que productos, ventas, etc.)
// ════════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const ctrl    = require('./inventario.controller')

// POST /inventario/ajuste-rapido
router.post('/ajuste-rapido', ctrl.ajusteRapido)

module.exports = router
