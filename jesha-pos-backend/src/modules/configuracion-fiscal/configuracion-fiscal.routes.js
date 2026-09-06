'use strict'

const router = require('express').Router()
const multer = require('multer')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal } = require('../../middlewares/scope.middleware')
const { requireRole } = require('../../middlewares/auth.middleware')
const controller = require('./configuracion-fiscal.controller')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 2, fields: 2 },
  fileFilter(req, file, callback) {
    const name = file.originalname.toLowerCase()
    const allowed = file.fieldname === 'cer'
      ? name.endsWith('.cer')
      : file.fieldname === 'key' && name.endsWith('.key')
    callback(allowed ? null : new Error('Solo se permiten archivos .cer y .key'), allowed)
  }
}).fields([{ name: 'cer', maxCount: 1 }, { name: 'key', maxCount: 1 }])

function uploadCsd(req, res, next) {
  upload(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message })
    next()
  })
}

router.use(requestContext, tenantGlobal, requireRole('SUPERADMIN'))
router.get('/', controller.obtener)
router.patch('/', controller.actualizar)
router.post('/organization', controller.iniciarOrganization)
router.post('/apikeys/live', controller.crearLiveKey)
router.post('/csd', uploadCsd, controller.subirCsd)
router.post('/sincronizar-status', controller.sincronizarStatus)

module.exports = router
