'use strict'

const express = require('express')
const multer = require('multer')
const { requireTenantOrDelegated } = require('../../middlewares/tenant-or-delegated.middleware')
const {
  obtenerBranding,
  actualizarBrandingTenant,
  subirLogo,
  restaurarBranding
} = require('./branding.controller')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })

router.get('/', obtenerBranding)

router.patch('/', requireTenantOrDelegated, (req, res, next) => {
  const rol = req.usuario?.rol
  if (rol !== 'SUPERADMIN' && rol !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ error: 'Solo SUPERADMIN puede modificar identidad visual' })
  }
  next()
}, actualizarBrandingTenant)

router.post('/logo', requireTenantOrDelegated, (req, res, next) => {
  const rol = req.usuario?.rol
  if (rol !== 'SUPERADMIN' && rol !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ error: 'Solo SUPERADMIN puede modificar identidad visual' })
  }
  next()
}, upload.single('logo'), subirLogo)

router.post('/restaurar', requireTenantOrDelegated, (req, res, next) => {
  const rol = req.usuario?.rol
  if (rol !== 'SUPERADMIN' && rol !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ error: 'Solo SUPERADMIN puede modificar identidad visual' })
  }
  next()
}, restaurarBranding)

module.exports = router
