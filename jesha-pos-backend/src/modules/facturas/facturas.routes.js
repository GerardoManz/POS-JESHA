// ════════════════════════════════════════════════════════════════════
//  FACTURAS.ROUTES.JS
//  src/modules/facturas/facturas.routes.js
//
//  requireAuth se aplica al montar /facturas en app.js (no aquí).
//  requestContext es compartido: todas las rutas necesitan contexto tenant.
//  requireRole protege operaciones fiscales (cambian estado o salen al cliente).
// ════════════════════════════════════════════════════════════════════

const express      = require('express')
const router       = express.Router()
const ctrl         = require('./facturas.controller')
const facCtrl      = require('../facturacion/facturacion.controller')
const resolverCtrl = require('./resolver-timbrado.controller')
const { requireRole } = require('../../middlewares/auth.middleware')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal, branchOptional, branchRequired } = require('../../middlewares/scope.middleware')
const { BRANCH_MODE } = require('../../security/request-context')

const ROLES_FISCAL = ['ADMIN_SUCURSAL', 'SUPERADMIN']

// P0-4: la factura global opera sobre TODA la empresa (multi-sucursal).
// Solo SUPERADMIN y solo en vista NONE (sin sucursal fija/seleccionada).
function branchMustBeNone(req, res, next) {
  if (req.context.branch.mode !== BRANCH_MODE.NONE) {
    return res.status(400).json({
      error: 'La factura global requiere vista de toda la empresa',
      code: 'BRANCH_CONTEXT_MUST_BE_NONE'
    })
  }
  return next()
}

router.use(requestContext)

// ── Factura Global CFDI 4.0 (ANTES de :id para que no lo capture como parám.) ──
router.get ('/global/preview',  tenantGlobal, requireRole(['SUPERADMIN']), branchMustBeNone, ctrl.previewGlobal)
router.post('/global/timbrar',  tenantGlobal, requireRole(['SUPERADMIN']), branchMustBeNone, ctrl.timbrarGlobal)

// ── Facturado manual desde mostrador (mismo solicitarFactura, canal INTERNO: sin gate de 72h) ──
router.post('/manual', branchRequired, requireRole(ROLES_FISCAL), (req, res, next) => { req.canalFacturacion = 'INTERNO'; next() }, facCtrl.solicitarFactura)

// ── Lectura (abierta a cualquier usuario autenticado) ──
router.get('/',    tenantGlobal, ctrl.listar)
router.get('/:id', tenantGlobal, ctrl.obtener)

// ── Descarga de PDF/XML ──
router.get('/:id/descargar/pdf', tenantGlobal, facCtrl.descargarPdf)
router.get('/:id/descargar/xml', tenantGlobal, facCtrl.descargarXml)

// ── Resolver-timbrado (recuperación de facturas INCIERTO) ──
router.get ('/:id/timbrado-candidatos',         branchOptional, requireRole(ROLES_FISCAL), resolverCtrl.timbradoCandidatos)
router.post('/:id/reconciliar-timbrado',        branchOptional, requireRole(ROLES_FISCAL), resolverCtrl.reconciliarTimbrado)
router.post('/:id/descartar-timbrado-incierto', branchOptional, requireRole(ROLES_FISCAL), resolverCtrl.descartarTimbradoIncierto)

// ── Operaciones fiscales sobre la factura ──
router.patch('/:id/cancelar',              tenantGlobal, requireRole(ROLES_FISCAL), ctrl.cancelar)
router.post('/:id/sincronizar-cancelacion', tenantGlobal, requireRole(ROLES_FISCAL), ctrl.sincronizarCancelacion)
router.post ('/:id/timbrar',               tenantGlobal, requireRole(ROLES_FISCAL), facCtrl.timbrarManual)
router.post ('/:id/enviar-email',          tenantGlobal, requireRole(ROLES_FISCAL), facCtrl.enviarEmail)

module.exports = router
