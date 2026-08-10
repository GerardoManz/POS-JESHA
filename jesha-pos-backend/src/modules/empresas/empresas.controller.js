'use strict'

const prisma = require('../../lib/prisma')

const SELECT_EMPRESA = {
  id: true,
  slug: true,
  nombreComercial: true,
  razonSocial: true,
  rfc: true,
  whatsapp: true,
  notas: true,
  activa: true,
  creadaEn: true
}

const CAMPOS_EDITABLES = new Set([
  'slug',
  'nombreComercial',
  'razonSocial',
  'rfc',
  'whatsapp',
  'notas'
])

const CAMPOS_PROHIBIDOS = new Set([
  'id',
  'activa',
  'creadaEn',
  'empresaId',
  'sucursalId',
  'usuarioId',
  'password',
  'passwordHash'
])

class EmpresaPlatformError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'EmpresaPlatformError'
    this.status = status
    this.code = code
    this.expose = true
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function normalizarId(raw) {
  const value = Number(String(raw ?? '').trim())
  return Number.isInteger(value) && value > 0 ? value : null
}

function validarEntero(raw, defecto, min, max) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return defecto
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function normalizarTexto(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validarPayload(body, esCrear) {
  if (!isPlainObject(body)) {
    throw new EmpresaPlatformError(400, 'EMPRESA_BODY_INVALIDO', 'Body inválido')
  }

  const errores = []

  for (const key of Object.keys(body)) {
    if (CAMPOS_PROHIBIDOS.has(key)) {
      errores.push({ campo: key, mensaje: `No se permite modificar ${key}` })
      continue
    }
    if (!CAMPOS_EDITABLES.has(key)) {
      errores.push({ campo: key, mensaje: `Campo desconocido: ${key}` })
    }
  }

  if (esCrear) {
    for (const key of ['slug', 'nombreComercial', 'razonSocial', 'whatsapp']) {
      if (typeof body[key] !== 'string' || body[key].trim() === '') {
        errores.push({ campo: key, mensaje: `${key} es obligatorio` })
      }
    }
  }

  if (body.slug !== undefined) {
    const slug = normalizarTexto(body.slug).toLowerCase()
    if (slug.length < 2 || slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      errores.push({ campo: 'slug', mensaje: 'slug inválido; usa letras minúsculas, números y guiones' })
    }
  }

  if (body.nombreComercial !== undefined) {
    const value = normalizarTexto(body.nombreComercial)
    if (value.length < 2 || value.length > 150) {
      errores.push({ campo: 'nombreComercial', mensaje: 'nombreComercial debe tener entre 2 y 150 caracteres' })
    }
  }

  if (body.razonSocial !== undefined) {
    const value = normalizarTexto(body.razonSocial)
    if (value.length < 2 || value.length > 200) {
      errores.push({ campo: 'razonSocial', mensaje: 'razonSocial debe tener entre 2 y 200 caracteres' })
    }
  }

  if (body.whatsapp !== undefined) {
    const value = normalizarTexto(body.whatsapp)
    if (value.length < 7 || value.length > 30) {
      errores.push({ campo: 'whatsapp', mensaje: 'whatsapp debe tener entre 7 y 30 caracteres' })
    }
  }

  if (body.rfc !== undefined && body.rfc !== null) {
    const value = normalizarTexto(body.rfc).toUpperCase()
    if (value.length > 20) {
      errores.push({ campo: 'rfc', mensaje: 'rfc no debe exceder 20 caracteres' })
    }
  }

  if (body.notas !== undefined && body.notas !== null) {
    const value = normalizarTexto(body.notas)
    if (value.length > 1000) {
      errores.push({ campo: 'notas', mensaje: 'notas no debe exceder 1000 caracteres' })
    }
  }

  if (errores.length > 0) {
    const err = new EmpresaPlatformError(400, 'EMPRESA_DATOS_INVALIDOS', 'Datos de empresa inválidos')
    err.errores = errores
    throw err
  }
}

function construirData(body) {
  const data = {}

  if (body.slug !== undefined) data.slug = normalizarTexto(body.slug).toLowerCase()
  if (body.nombreComercial !== undefined) data.nombreComercial = normalizarTexto(body.nombreComercial)
  if (body.razonSocial !== undefined) data.razonSocial = normalizarTexto(body.razonSocial)
  if (body.whatsapp !== undefined) data.whatsapp = normalizarTexto(body.whatsapp)
  if (body.rfc !== undefined) data.rfc = body.rfc === null || normalizarTexto(body.rfc) === '' ? null : normalizarTexto(body.rfc).toUpperCase()
  if (body.notas !== undefined) data.notas = body.notas === null || normalizarTexto(body.notas) === '' ? null : normalizarTexto(body.notas)

  return data
}

function snapshotAuditoria(empresa) {
  if (!empresa) return null
  return {
    id: empresa.id,
    slug: empresa.slug,
    nombreComercial: empresa.nombreComercial,
    razonSocial: empresa.razonSocial,
    rfc: empresa.rfc,
    whatsapp: empresa.whatsapp,
    activa: empresa.activa
  }
}

async function registrarAuditoria(tx, req, empresaId, accion, antes = null, despues = null) {
  const data = {
    empresaId,
    usuarioId: req.platformActor.id,
    sucursalId: null,
    accion,
    modulo: 'platform-empresas',
    referencia: `empresa:${empresaId}`,
    ip: req.ip || null
  }

  const valorAntes = snapshotAuditoria(antes)
  const valorDespues = snapshotAuditoria(despues)
  if (valorAntes) data.valorAntes = valorAntes
  if (valorDespues) data.valorDespues = valorDespues

  await tx.auditoria.create({ data })
}

function responderErrorConocido(res, err) {
  if (err instanceof EmpresaPlatformError) {
    const body = { error: err.message, code: err.code }
    if (err.errores) body.errores = err.errores
    res.status(err.status).json(body)
    return true
  }

  if (err && err.code === 'P2002') {
    res.status(409).json({ error: 'Ya existe una empresa con ese slug', code: 'EMPRESA_SLUG_DUPLICADO' })
    return true
  }

  return false
}

async function listar(req, res) {
  try {
    const estado = normalizarTexto(req.query.estado).toLowerCase()
    const buscar = normalizarTexto(req.query.buscar)
    const pagina = validarEntero(req.query.pagina, 1, 1, 1000000)
    const porPagina = validarEntero(req.query.porPagina, 25, 1, 100)

    const where = {}
    if (estado === 'activas') where.activa = true
    else if (estado === 'inactivas' || estado === 'suspendidas') where.activa = false

    if (buscar) {
      where.OR = [
        { slug: { contains: buscar.toLowerCase(), mode: 'insensitive' } },
        { nombreComercial: { contains: buscar, mode: 'insensitive' } },
        { razonSocial: { contains: buscar, mode: 'insensitive' } },
        { rfc: { contains: buscar.toUpperCase(), mode: 'insensitive' } }
      ]
    }

    const [total, empresas] = await Promise.all([
      prisma.empresa.count({ where }),
      prisma.empresa.findMany({
        where,
        select: {
          ...SELECT_EMPRESA,
          _count: { select: { Sucursal: true, Usuario: true } }
        },
        orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina
      })
    ])

    return res.json({
      empresas: empresas.map(({ _count, ...empresa }) => ({
        ...empresa,
        sucursales: _count.Sucursal,
        usuarios: _count.Usuario
      })),
      total,
      pagina,
      porPagina
    })
  } catch (err) {
    if (responderErrorConocido(res, err)) return
    console.error('Error al listar empresas de plataforma:', err)
    return res.status(500).json({ error: 'Error al listar empresas' })
  }
}

async function obtener(req, res) {
  try {
    const id = normalizarId(req.params.id)
    if (!id) throw new EmpresaPlatformError(400, 'EMPRESA_ID_INVALIDO', 'id de empresa inválido')

    const empresa = await prisma.empresa.findUnique({
      where: { id },
      select: {
        ...SELECT_EMPRESA,
        _count: { select: { Sucursal: true, Usuario: true } }
      }
    })

    if (!empresa) throw new EmpresaPlatformError(404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada')

    const { _count, ...data } = empresa
    return res.json({ empresa: { ...data, sucursales: _count.Sucursal, usuarios: _count.Usuario } })
  } catch (err) {
    if (responderErrorConocido(res, err)) return
    console.error('Error al obtener empresa de plataforma:', err)
    return res.status(500).json({ error: 'Error al obtener empresa' })
  }
}

async function crear(req, res) {
  try {
    validarPayload(req.body, true)
    const data = construirData(req.body)

    const empresa = await prisma.$transaction(async (tx) => {
      const creada = await tx.empresa.create({
        data: { ...data, activa: false },
        select: SELECT_EMPRESA
      })

      await registrarAuditoria(tx, req, creada.id, 'PLATFORM_EMPRESA_CREAR', null, creada)
      return creada
    })

    return res.status(201).json({ empresa })
  } catch (err) {
    if (responderErrorConocido(res, err)) return
    console.error('Error al crear empresa desde plataforma:', err)
    return res.status(500).json({ error: 'Error al crear empresa' })
  }
}

async function editar(req, res) {
  try {
    const id = normalizarId(req.params.id)
    if (!id) throw new EmpresaPlatformError(400, 'EMPRESA_ID_INVALIDO', 'id de empresa inválido')

    validarPayload(req.body, false)
    const data = construirData(req.body)
    if (Object.keys(data).length === 0) {
      throw new EmpresaPlatformError(400, 'EMPRESA_SIN_CAMBIOS', 'No se proporcionaron campos para editar')
    }

    const empresa = await prisma.$transaction(async (tx) => {
      const actual = await tx.empresa.findUnique({ where: { id }, select: SELECT_EMPRESA })
      if (!actual) throw new EmpresaPlatformError(404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada')

      const actualizada = await tx.empresa.update({
        where: { id },
        data,
        select: SELECT_EMPRESA
      })

      await registrarAuditoria(tx, req, id, 'PLATFORM_EMPRESA_EDITAR', actual, actualizada)
      return actualizada
    })

    return res.json({ empresa })
  } catch (err) {
    if (responderErrorConocido(res, err)) return
    console.error('Error al editar empresa desde plataforma:', err)
    return res.status(500).json({ error: 'Error al editar empresa' })
  }
}

async function activar(req, res) {
  try {
    const id = normalizarId(req.params.id)
    if (!id) throw new EmpresaPlatformError(400, 'EMPRESA_ID_INVALIDO', 'id de empresa inválido')

    const empresa = await prisma.$transaction(async (tx) => {
      const actual = await tx.empresa.findUnique({ where: { id }, select: SELECT_EMPRESA })
      if (!actual) throw new EmpresaPlatformError(404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada')
      if (actual.activa) return actual

      const superadmins = await tx.usuario.count({
        where: { empresaId: id, rol: 'SUPERADMIN', activo: true }
      })
      if (superadmins < 1) {
        throw new EmpresaPlatformError(
          409,
          'EMPRESA_SIN_SUPERADMIN',
          'La empresa necesita un SUPERADMIN activo antes de activarse'
        )
      }

      const actualizada = await tx.empresa.update({
        where: { id },
        data: { activa: true },
        select: SELECT_EMPRESA
      })

      await registrarAuditoria(tx, req, id, 'PLATFORM_EMPRESA_ACTIVAR', actual, actualizada)
      return actualizada
    })

    return res.json({ empresa })
  } catch (err) {
    if (responderErrorConocido(res, err)) return
    console.error('Error al activar empresa desde plataforma:', err)
    return res.status(500).json({ error: 'Error al activar empresa' })
  }
}

async function suspender(req, res) {
  try {
    const id = normalizarId(req.params.id)
    if (!id) throw new EmpresaPlatformError(400, 'EMPRESA_ID_INVALIDO', 'id de empresa inválido')

    const empresa = await prisma.$transaction(async (tx) => {
      const actual = await tx.empresa.findUnique({ where: { id }, select: SELECT_EMPRESA })
      if (!actual) throw new EmpresaPlatformError(404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada')
      if (!actual.activa) return actual

      const actualizada = await tx.empresa.update({
        where: { id },
        data: { activa: false },
        select: SELECT_EMPRESA
      })

      await registrarAuditoria(tx, req, id, 'PLATFORM_EMPRESA_SUSPENDER', actual, actualizada)
      return actualizada
    })

    return res.json({ empresa })
  } catch (err) {
    if (responderErrorConocido(res, err)) return
    console.error('Error al suspender empresa desde plataforma:', err)
    return res.status(500).json({ error: 'Error al suspender empresa' })
  }
}

module.exports = {
  EmpresaPlatformError,
  validarPayload,
  construirData,
  listar,
  obtener,
  crear,
  editar,
  activar,
  suspender
}
