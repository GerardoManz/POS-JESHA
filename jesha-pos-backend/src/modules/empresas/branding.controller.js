'use strict'

const prisma = require('../../lib/prisma')
const { subirLogoEmpresa } = require('../../lib/cloudinary')

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_SIZE_BYTES = 2 * 1024 * 1024

const DEFAULT_BRANDING = Object.freeze({
  logoUrl: null,
  colorPrimario: '#1e3a5f',
  colorSecundario: '#3b82f6',
  colorAcento: '#10b981'
})

function sanitizeColor(value) {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  return COLOR_RE.test(trimmed) ? trimmed : null
}

function sanitizeBrandingInput(body) {
  const updates = {}
  if (body.colorPrimario !== undefined) {
    const c = sanitizeColor(body.colorPrimario)
    if (body.colorPrimario !== null && c === null) throw new Error('colorPrimario inválido. Use formato #RRGGBB')
    updates.colorPrimario = c
  }
  if (body.colorSecundario !== undefined) {
    const c = sanitizeColor(body.colorSecundario)
    if (body.colorSecundario !== null && c === null) throw new Error('colorSecundario inválido. Use formato #RRGGBB')
    updates.colorSecundario = c
  }
  if (body.colorAcento !== undefined) {
    const c = sanitizeColor(body.colorAcento)
    if (body.colorAcento !== null && c === null) throw new Error('colorAcento inválido. Use formato #RRGGBB')
    updates.colorAcento = c
  }
  return updates
}

async function obtenerBranding(req, res) {
  try {
    const { slug } = req.query

    if (slug && typeof slug === 'string' && slug.trim()) {
      const empresa = await prisma.empresa.findUnique({
        where: { slug: slug.trim().toLowerCase() },
        select: { nombreComercial: true, logoUrl: true, colorPrimario: true, colorSecundario: true, colorAcento: true }
      })
      if (empresa && empresa.nombreComercial) {
        return res.json({ branding: empresa })
      }
    }

    return res.json({ branding: DEFAULT_BRANDING })
  } catch (err) {
    console.error('Error obteniendo branding:', err.message)
    return res.json({ branding: DEFAULT_BRANDING })
  }
}

async function actualizarBrandingTenant(req, res) {
  try {
    const empresaId = req.usuario.empresaId
    if (!empresaId) {
      return res.status(403).json({ error: 'Usuario sin empresa asignada' })
    }

    let updates
    try {
      updates = sanitizeBrandingInput(req.body || {})
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message })
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay campos válidos para actualizar' })
    }

    const empresa = await prisma.empresa.update({
      where: { id: empresaId },
      data: updates,
      select: { id: true, nombreComercial: true, logoUrl: true, colorPrimario: true, colorSecundario: true, colorAcento: true }
    })

    return res.json({ success: true, branding: empresa })
  } catch (err) {
    console.error('Error actualizando branding tenant:', err.message)
    return res.status(500).json({ error: 'Error al actualizar identidad visual' })
  }
}

async function actualizarBrandingPlatform(req, res) {
  try {
    const empresaId = parseInt(req.params.empresaId)
    if (!empresaId || empresaId <= 0) {
      return res.status(400).json({ error: 'empresaId inválido' })
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    let updates
    try {
      updates = sanitizeBrandingInput(req.body || {})
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message })
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay campos válidos para actualizar' })
    }

    const updated = await prisma.empresa.update({
      where: { id: empresaId },
      data: updates,
      select: { id: true, nombreComercial: true, logoUrl: true, colorPrimario: true, colorSecundario: true, colorAcento: true }
    })

    return res.json({ success: true, branding: updated })
  } catch (err) {
    console.error('Error actualizando branding platform:', err.message)
    return res.status(500).json({ error: 'Error al actualizar identidad visual' })
  }
}

async function subirLogo(req, res) {
  try {
    const empresaId = req.usuario.empresaId
    if (!empresaId) {
      return res.status(403).json({ error: 'Usuario sin empresa asignada' })
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó archivo' })
    }

    if (!ALLOWED_MIMES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Formato no soportado. Use PNG, JPG o WEBP' })
    }

    if (req.file.size > MAX_SIZE_BYTES) {
      return res.status(400).json({ error: 'El archivo excede 2 MB' })
    }

    const result = await subirLogoEmpresa(req.file.buffer, empresaId)

    await prisma.empresa.update({
      where: { id: empresaId },
      data: { logoUrl: result.url }
    })

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombreComercial: true, logoUrl: true, colorPrimario: true, colorSecundario: true, colorAcento: true }
    })

    return res.json({ success: true, branding: empresa })
  } catch (err) {
    console.error('Error subiendo logo:', err.message)
    return res.status(500).json({ error: 'Error al subir logo' })
  }
}

async function restaurarBranding(req, res) {
  try {
    const empresaId = req.usuario.empresaId
    if (!empresaId) {
      return res.status(403).json({ error: 'Usuario sin empresa asignada' })
    }

    await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        logoUrl: null,
        colorPrimario: DEFAULT_BRANDING.colorPrimario,
        colorSecundario: DEFAULT_BRANDING.colorSecundario,
        colorAcento: DEFAULT_BRANDING.colorAcento
      }
    })

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombreComercial: true, logoUrl: true, colorPrimario: true, colorSecundario: true, colorAcento: true }
    })

    return res.json({ success: true, branding: empresa })
  } catch (err) {
    console.error('Error restaurando branding:', err.message)
    return res.status(500).json({ error: 'Error al restaurar identidad visual' })
  }
}

module.exports = {
  obtenerBranding,
  actualizarBrandingTenant,
  actualizarBrandingPlatform,
  subirLogo,
  restaurarBranding,
  DEFAULT_BRANDING
}
