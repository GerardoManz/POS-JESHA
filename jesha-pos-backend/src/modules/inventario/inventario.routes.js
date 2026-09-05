// ════════════════════════════════════════════════════════════════════
//  INVENTARIO ROUTES
//  Ubicación: src/modules/inventario/inventario.routes.js
//  Nota: requireAuth se aplica desde app.js (igual que productos, ventas, etc.)
// ════════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const ctrl    = require('./inventario.controller')
const kardexCtrl = require('./kardex.controller')
const transferCtrl = require('./transferencias.controller')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { branchRequired, tenantGlobal } = require('../../middlewares/scope.middleware')

router.use(requestContext)

// GET /inventario/producto/:productoId/kardex — Kardex de producto (branch-aware)
router.get('/producto/:productoId/kardex', tenantGlobal, kardexCtrl.kardex)

// POST /inventario/ajuste-rapido
router.post('/ajuste-rapido', branchRequired, ctrl.ajusteRapido)

// ── Transferencias ─────────────────────────────────────────────
// POST /inventario/transferencias — Crear transferencia (requiere branch context)
router.post('/transferencias', branchRequired, transferCtrl.crear)

// GET /inventario/transferencias — Listado histórico (branch-aware)
router.get('/transferencias', tenantGlobal, transferCtrl.listar)

// GET /inventario/transferencias/:id — Detalle (branch-aware)
router.get('/transferencias/:id', tenantGlobal, transferCtrl.detalle)

module.exports = router
