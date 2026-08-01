'use strict'

const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../../lib/prisma')
const debug = require('../../lib/debug')
const {
  IdentityError,
  esRolPlataforma,
  esRolTenant,
  validarIdentidadFinalUsuario,
  crearPrincipalTenant
} = require('../../security/identity')
const { resolveTenantAuthConfig } = require('./tenant-auth.config')

const TENANT_AUTH_CONFIG = resolveTenantAuthConfig()
const TEMAS_VALIDOS = new Set(['dark', 'light'])
const LOGIN_BODY_KEYS = new Set(['empresaSlug', 'username', 'password'])
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const GENERIC_CREDENTIAL_ERROR = Object.freeze({ error: 'Credenciales inválidas' })

class TenantAuthError extends Error {
  constructor(code, message, status = 401) {
    super(message)
    this.name = 'TenantAuthError'
    this.code = code
    this.status = status
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function parseTenantLoginBody(body) {
  if (!isPlainObject(body)) {
    throw new TenantAuthError('TENANT_LOGIN_BODY_INVALID', 'Body inválido', 400)
  }

  const keys = Object.keys(body)
  if (keys.length !== LOGIN_BODY_KEYS.size || keys.some((key) => !LOGIN_BODY_KEYS.has(key))) {
    throw new TenantAuthError('TENANT_LOGIN_BODY_INVALID', 'Body debe contener solo empresaSlug, username y password', 400)
  }

  if (
    typeof body.empresaSlug !== 'string' ||
    typeof body.username !== 'string' ||
    typeof body.password !== 'string'
  ) {
    throw new TenantAuthError('TENANT_LOGIN_BODY_INVALID', 'Credenciales inválidas', 400)
  }

  const empresaSlug = body.empresaSlug.trim()
  const username = body.username.trim()
  const password = body.password

  if (empresaSlug.length < 1 || empresaSlug.length > 80 || !SLUG_RE.test(empresaSlug)) {
    throw new TenantAuthError('TENANT_LOGIN_BODY_INVALID', 'empresaSlug inválido', 400)
  }
  if (username.length < 1 || username.length > 100) {
    throw new TenantAuthError('TENANT_LOGIN_BODY_INVALID', 'username inválido', 400)
  }
  if (password.length < 1 || password.length > 512) {
    throw new TenantAuthError('TENANT_LOGIN_BODY_INVALID', 'password inválido', 400)
  }

  return Object.freeze({ empresaSlug, username, password })
}

function recordTenantAuthEvent(req, code) {
  if (!debug.isEnabled()) return
  debug.logJSON({
    event: 'tenant_auth',
    code,
    requestId: req && req.requestId,
    path: req && req.path,
    ...debug.buildBase()
  })
}

async function resolveTenantLoginIdentity(credentials) {
  const empresa = await prisma.empresa.findUnique({
    where: { slug: credentials.empresaSlug },
    select: { id: true, slug: true, nombreComercial: true, activa: true }
  })

  if (!empresa || !empresa.activa) {
    throw new TenantAuthError('TENANT_CREDENTIALS_INVALID', 'Empresa no disponible')
  }

  const usuario = await prisma.usuario.findUnique({
    where: {
      empresaId_username: {
        empresaId: empresa.id,
        username: credentials.username
      }
    },
    select: {
      id: true,
      nombre: true,
      username: true,
      passwordHash: true,
      rol: true,
      activo: true,
      empresaId: true,
      sucursalId: true,
      tema: true
    }
  })

  if (!usuario || !usuario.activo || esRolPlataforma(usuario.rol) || !esRolTenant(usuario.rol)) {
    throw new TenantAuthError('TENANT_CREDENTIALS_INVALID', 'Usuario no disponible')
  }

  let identidad
  try {
    identidad = validarIdentidadFinalUsuario(usuario)
  } catch (err) {
    if (err instanceof IdentityError) {
      throw new TenantAuthError(err.code || 'TENANT_IDENTITY_INVALID', 'Identidad tenant inválida')
    }
    throw err
  }

  if (identidad.empresaId !== empresa.id) {
    throw new TenantAuthError('TENANT_EMPRESA_MISMATCH', 'Usuario fuera de la empresa solicitada')
  }

  let sucursal = null
  if (identidad.sucursalId !== null) {
    sucursal = await prisma.sucursal.findUnique({
      where: { id: identidad.sucursalId },
      select: { id: true, empresaId: true, nombre: true, activa: true }
    })

    if (!sucursal || !sucursal.activa || sucursal.empresaId !== empresa.id) {
      throw new TenantAuthError('TENANT_SUCURSAL_INVALID', 'Sucursal tenant no disponible')
    }
  }

  return Object.freeze({ empresa, usuario, identidad, sucursal })
}

function signTenantToken(principal) {
  return jwt.sign(principal, TENANT_AUTH_CONFIG.secret, {
    algorithm: TENANT_AUTH_CONFIG.algorithm,
    issuer: TENANT_AUTH_CONFIG.issuer,
    audience: TENANT_AUTH_CONFIG.audience,
    expiresIn: TENANT_AUTH_CONFIG.ttl
  })
}

function serializarUsuario(usuario, identidad, sucursal = null) {
  return {
    id: identidad.id,
    nombre: usuario.nombre,
    username: usuario.username,
    rol: identidad.rol,
    sucursalId: identidad.sucursalId,
    empresaId: identidad.empresaId,
    tema: usuario.tema || 'dark',
    Sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null
  }
}

async function login(req, res) {
  try {
    const credentials = parseTenantLoginBody(req.body)
    const resolved = await resolveTenantLoginIdentity(credentials)

    const passwordValida = await bcrypt.compare(credentials.password, resolved.usuario.passwordHash)
    if (!passwordValida) {
      return res.status(401).json(GENERIC_CREDENTIAL_ERROR)
    }

    const principal = crearPrincipalTenant(resolved.usuario)
    const token = signTenantToken(principal)

    await prisma.auditoria.create({
      data: {
        empresaId: resolved.identidad.empresaId,
        usuarioId: resolved.identidad.id,
        sucursalId: resolved.identidad.sucursalId,
        accion: 'LOGIN',
        modulo: 'auth',
        ip: req.ip || null
      }
    })

    return res.json({
      token,
      expiresIn: TENANT_AUTH_CONFIG.ttl,
      usuario: serializarUsuario(resolved.usuario, resolved.identidad, resolved.sucursal)
    })
  } catch (err) {
    if (err instanceof TenantAuthError) {
      if (err.status === 400) {
        return res.status(400).json({ error: 'Solicitud inválida' })
      }
      recordTenantAuthEvent(req, err.code)
      return res.status(401).json(GENERIC_CREDENTIAL_ERROR)
    }

    if (err instanceof IdentityError) {
      recordTenantAuthEvent(req, err.code || 'TENANT_IDENTITY_INVALID')
      return res.status(401).json(GENERIC_CREDENTIAL_ERROR)
    }

    console.error('Error en tenant login:', err)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
}

async function me(req, res) {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      select: { id: true, nombre: true, username: true, rol: true, sucursalId: true, empresaId: true, activo: true, tema: true }
    })
    if (!usuario || !usuario.activo) return res.status(404).json({ error: 'Usuario no encontrado' })

    const identidad = validarIdentidadFinalUsuario(usuario)
    const sucursal = identidad.sucursalId
      ? await prisma.sucursal.findUnique({ where: { id: identidad.sucursalId }, select: { id: true, nombre: true } })
      : null

    return res.json({ usuario: serializarUsuario(usuario, identidad, sucursal) })
  } catch (err) {
    if (err instanceof IdentityError) {
      return res.status(403).json({ error: 'Identidad de usuario inválida' })
    }
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
}

async function actualizarPreferencias(req, res) {
  try {
    const { tema } = req.body || {}

    if (!TEMAS_VALIDOS.has(tema)) {
      return res.status(400).json({ error: 'Tema inválido' })
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.usuario.id },
      data: { tema },
      select: { id: true, nombre: true, username: true, rol: true, sucursalId: true, empresaId: true, activo: true, tema: true }
    })

    const identidad = validarIdentidadFinalUsuario(usuario)
    const sucursal = identidad.sucursalId
      ? await prisma.sucursal.findUnique({ where: { id: identidad.sucursalId }, select: { id: true, nombre: true } })
      : null

    return res.json({ usuario: serializarUsuario(usuario, identidad, sucursal) })
  } catch (err) {
    if (err instanceof IdentityError) {
      return res.status(403).json({ error: 'Identidad de usuario inválida' })
    }
    console.error('Error actualizando preferencias:', err)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = {
  TenantAuthError,
  parseTenantLoginBody,
  resolveTenantLoginIdentity,
  signTenantToken,
  serializarUsuario,
  login,
  me,
  actualizarPreferencias
}
