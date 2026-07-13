// ════════════════════════════════════════════════════════════════════
//  REPORTE-STOCK ROUTES
//  Ubicación: src/modules/reportes/reporte-stock.routes.js
//  Nota: requireAuth se aplica desde app.js
// ════════════════════════════════════════════════════════════════════

const express = require('express')
const router = express.Router()
const multer = require('multer')
const ctrl = require('./reporte-stock.controller')

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.originalname.endsWith('.xlsx')) {
      cb(null, true)
    } else {
      cb(new Error('Solo archivos .xlsx'), false)
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }
})

// Endpoints públicos del módulo
router.get('/stock', ctrl.obtenerReporteStock)
router.get('/stock/excel', ctrl.generarExcelReporteStock)
router.get('/stock/pdf', ctrl.generarPdfReporteStock)
router.post('/stock/alertas/generar', ctrl.generarAlertasPorTurno)
router.patch('/stock/alertas/:id', ctrl.marcarAlerta)
router.get('/stock/alertas', ctrl.obtenerAlertas)
router.get('/stock/plantilla-correccion', ctrl.generarPlantillaCorreccion)
router.post('/stock/corregir-plantilla', uploadExcel.single('archivo'), ctrl.corregirPlantilla)

module.exports = router
