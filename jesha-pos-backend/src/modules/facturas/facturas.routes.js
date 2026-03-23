// ════════════════════════════════════════════════════════════════════
//  FACTURAS.ROUTES.JS
//  src/modules/facturas/facturas.routes.js
// ════════════════════════════════════════════════════════════════════

const express     = require('express')
const router      = express.Router()
const ctrl        = require('./facturas.controller')
const facCtrl     = require('../facturacion/facturacion.controller')

// Listado y detalle
router.get('/',              ctrl.listar)
router.get('/:id',           ctrl.obtener)

// Cancelar
router.patch('/:id/cancelar', ctrl.cancelar)

// Timbrar manualmente una factura PENDIENTE_TIMBRADO
router.post('/:id/timbrar',  facCtrl.timbrarManual)

module.exports = router