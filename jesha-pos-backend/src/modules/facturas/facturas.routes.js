// ════════════════════════════════════════════════════════════════════
//  FACTURAS.ROUTES.JS
//  src/modules/facturas/facturas.routes.js
//
//  requireAuth se aplica al montar /facturas en app.js (no aquí).
//  requireRole protege operaciones fiscales (cambian estado o salen al cliente).
// ════════════════════════════════════════════════════════════════════

const express      = require('express')
const router       = express.Router()
const ctrl         = require('./facturas.controller')
const facCtrl      = require('../facturacion/facturacion.controller')
const resolverCtrl = require('./resolver-timbrado.controller')
const { requireRole } = require('../../middlewares/auth.middleware')

const ROLES_FISCAL = ['ADMIN_SUCURSAL', 'SUPERADMIN', 'PLATFORM_ADMIN']

// ── Factura Global CFDI 4.0 (ANTES de :id para que no lo capture como parám.) ──
router.get ('/global/preview',    requireRole(ROLES_FISCAL), ctrl.previewGlobal)
router.post ('/global/timbrar',   requireRole(ROLES_FISCAL), ctrl.timbrarGlobal)

// ── Facturado manual desde mostrador (mismo solicitarFactura, canal INTERNO: sin gate de 72h) ──
router.post('/manual', requireRole(ROLES_FISCAL), (req, res, next) => { req.canalFacturacion = 'INTERNO'; next() }, facCtrl.solicitarFactura)

// ── Lectura (abierta a cualquier usuario autenticado) ──
router.get('/',    ctrl.listar)
router.get('/:id', ctrl.obtener)

// ── Descarga de PDF/XML ──
router.get('/:id/descargar/pdf', facCtrl.descargarPdf)
router.get('/:id/descargar/xml', facCtrl.descargarXml)

// ── Resolver-timbrado (recuperación de facturas INCIERTO) ──
router.get ('/:id/timbrado-candidatos',         requireRole(ROLES_FISCAL), resolverCtrl.timbradoCandidatos)
router.post('/:id/reconciliar-timbrado',        requireRole(ROLES_FISCAL), resolverCtrl.reconciliarTimbrado)
router.post('/:id/descartar-timbrado-incierto', requireRole(ROLES_FISCAL), resolverCtrl.descartarTimbradoIncierto)

// ── Operaciones fiscales sobre la factura ──
router.patch('/:id/cancelar',     requireRole(ROLES_FISCAL), ctrl.cancelar)
router.post ('/:id/timbrar',      requireRole(ROLES_FISCAL), facCtrl.timbrarManual)
router.post ('/:id/enviar-email', requireRole(ROLES_FISCAL), facCtrl.enviarEmail)

module.exports = router