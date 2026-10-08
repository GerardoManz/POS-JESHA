'use strict'

const express = require('express')
const multer = require('multer')
const { actualizarBrandingPlatform } = require('./branding.controller')
const prisma = require('../../lib/prisma')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })

router.get('/:empresaId/branding', async (req, res) => {
  try {
    const rol = req.platformActor?.rol
    if (rol !== 'PLATFORM_ADMIN') {
      return res.status(403).json({ error: 'Solo PLATFORM_ADMIN puede administrar branding de otras empresas' })
    }

    const empresaId = parseInt(req.params.empresaId)
    if (!empresaId || empresaId <= 0) {
      return res.status(400).json({ error: 'empresaId inválido' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombreComercial: true, logoUrl: true, logoDocumentalUrl: true, colorPrimario: true, colorSecundario: true, colorAcento: true }
    })

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    return res.json({ branding: empresa })
  } catch (err) {
    console.error('Error obteniendo branding platform:', err.message)
    return res.status(500).json({ error: 'Error al obtener identidad visual' })
  }
})

router.patch('/:empresaId/branding', (req, res, next) => {
  const rol = req.platformActor?.rol
  if (rol !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ error: 'Solo PLATFORM_ADMIN puede administrar branding de otras empresas' })
  }
  next()
}, actualizarBrandingPlatform)

router.post('/:empresaId/branding/logo', (req, res, next) => {
  const rol = req.platformActor?.rol
  if (rol !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ error: 'Solo PLATFORM_ADMIN puede administrar branding de otras empresas' })
  }
  next()
}, upload.single('logo'), async (req, res) => {
  try {
    const empresaId = parseInt(req.params.empresaId)
    if (!empresaId || empresaId <= 0) {
      return res.status(400).json({ error: 'empresaId inválido' })
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó archivo' })
    }

    const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp']
    if (!ALLOWED_MIMES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Formato no soportado. Use PNG, JPG o WEBP' })
    }

    if (req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'El archivo excede 2 MB' })
    }

    const { subirLogoEmpresa } = require('../../lib/cloudinary')
    const result = await subirLogoEmpresa(req.file.buffer, empresaId)

    await prisma.empresa.update({
      where: { id: empresaId },
      data: { logoUrl: result.url }
    })

    const updated = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombreComercial: true, logoUrl: true, logoDocumentalUrl: true, colorPrimario: true, colorSecundario: true, colorAcento: true }
    })

    return res.json({ success: true, branding: updated })
  } catch (err) {
    console.error('Error subiendo logo platform:', err.message)
    return res.status(500).json({ error: 'Error al subir logo' })
  }
})

router.post('/:empresaId/branding/logo-documental', (req, res, next) => {
  const rol = req.platformActor?.rol
  if (rol !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ error: 'Solo PLATFORM_ADMIN puede administrar branding de otras empresas' })
  }
  next()
}, upload.single('logo'), async (req, res) => {
  try {
    const empresaId = parseInt(req.params.empresaId)
    if (!empresaId || empresaId <= 0) return res.status(400).json({ error: 'empresaId inválido' })
    if (!req.file) return res.status(400).json({ error: 'No se proporcionó archivo' })
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Formato no soportado. Use PNG, JPG o WEBP' })
    }
    if (req.file.size > 2 * 1024 * 1024) return res.status(400).json({ error: 'El archivo excede 2 MB' })

    const { subirLogoDocumentalEmpresa } = require('../../lib/cloudinary')
    const result = await subirLogoDocumentalEmpresa(req.file.buffer, empresaId)
    await prisma.empresa.update({ where: { id: empresaId }, data: { logoDocumentalUrl: result.url } })
    const updated = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombreComercial: true, logoUrl: true, logoDocumentalUrl: true, colorPrimario: true, colorSecundario: true, colorAcento: true }
    })
    return res.json({ success: true, branding: updated })
  } catch (err) {
    console.error('Error subiendo logo documental platform:', err.message)
    return res.status(500).json({ error: 'Error al subir logo documental' })
  }
})

module.exports = router
