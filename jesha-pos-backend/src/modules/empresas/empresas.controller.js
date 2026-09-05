'use strict'

const prisma = require('../../lib/prisma')
const bcrypt = require('bcryptjs')
const { derivarEstadoFiscal } = require('../../helpers/estado-fiscal.helper')

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

// ── Campos permitidos en POST /platform/empresas/:id/superadmin ──
const SUPERADMIN_BODY_KEYS = new Set(['nombre', 'username', 'password', 'confirmarPassword'])
// Campos que el cliente jamás puede forzar: el backend impone su valor.
const SUPERADMIN_CAMPOS_PROHIBIDOS = new Set(['id', 'empresaId', 'sucursalId', 'rol', 'activo', 'passwordHash'])

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

function serializarSuperadmin(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    username: usuario.username,
    rol: usuario.rol,
    activo: usuario.activo,
    empresaId: usuario.empresaId,
    sucursalId: usuario.sucursalId
  }
}

function resolverEstadoSuperadmin(superadmins) {
  const candidatos = Array.isArray(superadmins) ? superadmins : []
  if (candidatos.length === 0) {
    return {
      superadminEstado: 'PENDIENTE',
      superadminActivo: false,
      superadminInactivo: false,
      superadmin: null
    }
  }

  if (candidatos.length > 1) {
    return {
      superadminEstado: 'AMBIGUO',
      superadminActivo: false,
      superadminInactivo: false,
      superadmin: null
    }
  }

  const usuario = candidatos[0]
  const activo = usuario.activo === true
  return {
    superadminEstado: activo ? 'ACTIVO' : 'INACTIVO',
    superadminActivo: activo,
    superadminInactivo: !activo,
    superadmin: {
      id: usuario.id,
      nombre: usuario.nombre,
      username: usuario.username,
      activo
    }
  }
}

// Valida y normaliza el body de POST /platform/empresas/:id/superadmin.
// Devuelve { nombre, username, password } o lanza EmpresaPlatformError.
function validarPayloadSuperadmin(body) {
  if (!isPlainObject(body)) {
    throw new EmpresaPlatformError(400, 'EMPRESA_SUPERADMIN_BODY_INVALIDO', 'Body inválido')
  }

  const keys = Object.keys(body)
  if (keys.length === 0) {
    throw new EmpresaPlatformError(400, 'EMPRESA_SUPERADMIN_BODY_INVALIDO', 'Body inválido')
  }

  const extra = keys.filter((key) => !SUPERADMIN_BODY_KEYS.has(key))
  if (extra.length > 0) {
    const prohibidos = extra.filter((key) => SUPERADMIN_CAMPOS_PROHIBIDOS.has(key))
    const err = new EmpresaPlatformError(
      400,
      prohibidos.length > 0 ? 'EMPRESA_SUPERADMIN_CAMPOS_PROHIBIDOS' : 'EMPRESA_SUPERADMIN_BODY_INVALIDO',
      prohibidos.length > 0 ? 'No se permiten campos de identidad en esta operación' : 'Campos desconocidos en la operación'
    )
    err.campos = extra
    throw err
  }

  const nombre = normalizarTexto(body.nombre)
  const username = normalizarTexto(body.username)
  const password = typeof body.password === 'string' ? body.password : ''
  const confirmarPassword = typeof body.confirmarPassword === 'string' ? body.confirmarPassword : ''

  const errores = []
  if (nombre.length < 2 || nombre.length > 150) {
    errores.push({ campo: 'nombre', mensaje: 'nombre debe tener entre 2 y 150 caracteres' })
  }
  if (username.length < 1 || username.length > 100) {
    errores.push({ campo: 'username', mensaje: 'username debe tener entre 1 y 100 caracteres' })
  }
  if (password.length < 6 || password.length > 512) {
    errores.push({ campo: 'password', mensaje: 'password debe tener entre 6 y 512 caracteres' })
  }
  if (password !== confirmarPassword) {
    errores.push({ campo: 'confirmarPassword', mensaje: 'Las contraseñas no coinciden' })
  }

  if (errores.length > 0) {
    const err = new EmpresaPlatformError(400, 'EMPRESA_SUPERADMIN_DATOS_INVALIDOS', 'Datos del administrador inválidos')
    err.errores = errores
    throw err
  }

  return Object.freeze({ nombre, username, password })
}

// ── Campos permitidos en POST /platform/empresas/:id/superadmin/recover ──
const RECOVER_BODY_KEYS = new Set(['password', 'confirmarPassword'])
// Campos que el cliente jamás puede forzar en recuperación: el backend impone su valor.
const RECOVER_CAMPOS_PROHIBIDOS = new Set(['id', 'empresaId', 'sucursalId', 'rol', 'activo', 'username', 'nombre', 'passwordHash', 'createdBy'])

// Valida y normaliza el body de POST /platform/empresas/:id/superadmin/recover.
// Devuelve la password nueva o lanza EmpresaPlatformError.
function validarPayloadRecover(body) {
  if (!isPlainObject(body)) {
    throw new EmpresaPlatformError(400, 'EMPRESA_SUPERADMIN_RECOVER_BODY_INVALIDO', 'Body inválido')
  }

  const keys = Object.keys(body)
  if (keys.length === 0) {
    throw new EmpresaPlatformError(400, 'EMPRESA_SUPERADMIN_RECOVER_BODY_INVALIDO', 'Body inválido')
  }

  const extra = keys.filter((key) => !RECOVER_BODY_KEYS.has(key))
  if (extra.length > 0) {
    const prohibidos = extra.filter((key) => RECOVER_CAMPOS_PROHIBIDOS.has(key))
    const err = new EmpresaPlatformError(
      400,
      prohibidos.length > 0 ? 'EMPRESA_SUPERADMIN_RECOVER_CAMPOS_PROHIBIDOS' : 'EMPRESA_SUPERADMIN_RECOVER_BODY_INVALIDO',
      prohibidos.length > 0 ? 'No se permiten campos de identidad en esta operación' : 'Campos desconocidos en la operación'
    )
    err.campos = extra
    throw err
  }

  const password = typeof body.password === 'string' ? body.password : ''
  const confirmarPassword = typeof body.confirmarPassword === 'string' ? body.confirmarPassword : ''

  const errores = []
  if (password.length < 6 || password.length > 512) {
    errores.push({ campo: 'password', mensaje: 'password debe tener entre 6 y 512 caracteres' })
  }
  if (password !== confirmarPassword) {
    errores.push({ campo: 'confirmarPassword', mensaje: 'Las contraseñas no coinciden' })
  }

  if (errores.length > 0) {
    const err = new EmpresaPlatformError(400, 'EMPRESA_SUPERADMIN_RECOVER_DATOS_INVALIDOS', 'Datos de recuperación inválidos')
    err.errores = errores
    throw err
  }

  return password
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

    const ids = empresas.map((empresa) => empresa.id)
    const superadminsPorEmpresa = new Map()
    const configFiscalPorEmpresa = new Map()
    if (ids.length > 0) {
      const superadmins = await prisma.usuario.findMany({
        where: { empresaId: { in: ids }, rol: 'SUPERADMIN' },
        select: { id: true, empresaId: true, nombre: true, username: true, activo: true },
        orderBy: { id: 'asc' }
      })
      for (const item of superadmins) {
        const actuales = superadminsPorEmpresa.get(item.empresaId) || []
        actuales.push(item)
        superadminsPorEmpresa.set(item.empresaId, actuales)
      }

      const configs = await prisma.configuracionFiscal.findMany({
        where: { empresaId: { in: ids } },
        select: { empresaId: true, facturapiOrganizationId: true, isProductionReady: true }
      })
      for (const c of configs) configFiscalPorEmpresa.set(c.empresaId, c)
    }

    return res.json({
      empresas: empresas.map(({ _count, ...empresa }) => {
        const estadoSuperadmin = resolverEstadoSuperadmin(superadminsPorEmpresa.get(empresa.id))
        return {
          ...empresa,
          sucursales: _count.Sucursal,
          usuarios: _count.Usuario,
          superadminEstado: estadoSuperadmin.superadminEstado,
          superadminActivo: estadoSuperadmin.superadminActivo,
          superadminInactivo: estadoSuperadmin.superadminInactivo,
          facturacionEstado: derivarEstadoFiscal(configFiscalPorEmpresa.get(empresa.id) || null)
        }
      }),
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
    const superadmins = await prisma.usuario.findMany({
      where: { empresaId: id, rol: 'SUPERADMIN' },
      select: { id: true, nombre: true, username: true, activo: true },
      orderBy: { id: 'asc' }
    })
    const configFiscal = await prisma.configuracionFiscal.findUnique({
      where: { empresaId: id },
      select: { facturapiOrganizationId: true, isProductionReady: true }
    })
    return res.json({
      empresa: {
        ...data,
        sucursales: _count.Sucursal,
        usuarios: _count.Usuario,
        ...resolverEstadoSuperadmin(superadmins),
        facturacionEstado: derivarEstadoFiscal(configFiscal)
      }
    })
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

// ═══════════════════════════════════════════════════════════════════
// POST /platform/empresas/:id/superadmin — primer administrador
// Crea el primer SUPERADMIN de la empresa (empresaId forzado al de la
// ruta, sucursalId=null, rol=SUPERADMIN, activo=true). La empresa puede
// estar inactiva: la activación ocurre después vía /activar.
// Garantía anti-race sin schema: lock de fila (SELECT ... FOR UPDATE)
// sobre la Empresa dentro de la transacción → solo una solicitud
// concurrente crea el primer SUPERADMIN.
// ═══════════════════════════════════════════════════════════════════
async function crearSuperadmin(req, res) {
  try {
    const id = normalizarId(req.params.id)
    if (!id) throw new EmpresaPlatformError(400, 'EMPRESA_ID_INVALIDO', 'id de empresa inválido')

    const { nombre, username, password } = validarPayloadSuperadmin(req.body)

    const usuario = await prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw`SELECT id FROM "Empresa" WHERE id = ${id} FOR UPDATE`
      if (filas.length === 0) {
        throw new EmpresaPlatformError(404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada')
      }

      const superadmins = await tx.usuario.count({ where: { empresaId: id, rol: 'SUPERADMIN' } })
      if (superadmins > 0) {
        throw new EmpresaPlatformError(409, 'EMPRESA_YA_TIENE_SUPERADMIN', 'La empresa ya tiene un administrador configurado')
      }

      const passwordHash = await bcrypt.hash(password, 10)
      const creado = await tx.usuario.create({
        data: {
          nombre,
          username,
          passwordHash,
          rol: 'SUPERADMIN',
          activo: true,
          empresaId: id,
          sucursalId: null
        }
      })

      await tx.auditoria.create({
        data: {
          empresaId: id,
          usuarioId: req.platformActor.id,
          sucursalId: null,
          accion: 'PLATFORM_EMPRESA_SUPERADMIN_CREAR',
          modulo: 'platform-empresas',
          referencia: `empresa:${id}:superadmin:${creado.id}`,
          ip: req.ip || null
        }
      })

      return creado
    })

    return res.status(201).json({ empresaId: id, usuario: serializarSuperadmin(usuario) })
  } catch (err) {
    if (err instanceof EmpresaPlatformError) {
      const body = { error: err.message, code: err.code }
      if (err.errores) body.errores = err.errores
      if (err.campos) body.campos = err.campos
      return res.status(err.status).json(body)
    }
    if (err && err.code === 'P2002') {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese nombre de usuario en esta empresa',
        code: 'EMPRESA_SUPERADMIN_USERNAME_DUPLICADO'
      })
    }
    if (err && err.code === 'P2034') {
      return res.status(409).json({
        error: 'Conflicto de concurrencia. Reintenta la operación.',
        code: 'EMPRESA_SUPERADMIN_CONCURRENCIA'
      })
    }
    console.error('Error al crear SUPERADMIN de empresa:', err)
    return res.status(500).json({ error: 'Error al crear el administrador de la empresa' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /platform/empresas/:id/superadmin/recover — recuperación de emergencia
// PLATFORM_ADMIN recupera el acceso del SUPERADMIN EXISTENTE de la Empresa:
// reactiva la cuenta (activo=true) y asigna una nueva contraseña.
// NO crea otro SUPERADMIN, NO cambia identidad (id, username, nombre),
// rol, empresaId ni sucursalId. La empresa NO se activa con esta operación
// (la activación sigue siendo vía /activar).
// Garantías anti-race sin schema: lock de fila (FOR UPDATE) sobre la Empresa
// + conteo de SUPERADMIN dentro de la transacción. `crearSuperadmin` ya
// garantiza ≤1 SUPERADMIN por construcción, por lo que este path solo se
// alcanza con exactamente 1; si hubiera más de 1, se responde 409 sin
// elegir silenciosamente ni corregir datos históricos.
// La auditoría registra SOLO metadata (empresaId, superadminId, wasInactive),
// jamás password ni passwordHash.
// ═══════════════════════════════════════════════════════════════════
async function recuperarSuperadmin(req, res) {
  try {
    const id = normalizarId(req.params.id)
    if (!id) throw new EmpresaPlatformError(400, 'EMPRESA_ID_INVALIDO', 'id de empresa inválido')

    const password = validarPayloadRecover(req.body)

    const usuario = await prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw`SELECT id FROM "Empresa" WHERE id = ${id} FOR UPDATE`
      if (filas.length === 0) {
        throw new EmpresaPlatformError(404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada')
      }

      const superadmins = await tx.usuario.findMany({
        where: { empresaId: id, rol: 'SUPERADMIN' },
        select: { id: true, activo: true }
      })
      if (superadmins.length === 0) {
        throw new EmpresaPlatformError(404, 'EMPRESA_SUPERADMIN_NO_ENCONTRADO', 'La empresa no tiene administrador configurado')
      }
      if (superadmins.length > 1) {
        throw new EmpresaPlatformError(409, 'EMPRESA_SUPERADMIN_AMBIGUO', 'La empresa tiene más de un administrador configurado')
      }

      const target = superadmins[0]
      const passwordHash = await bcrypt.hash(password, 10)
      const actualizado = await tx.usuario.update({
        where: { id: target.id },
        data: { passwordHash, activo: true },
        select: {
          id: true, nombre: true, username: true, rol: true, activo: true,
          empresaId: true, sucursalId: true
        }
      })

      await tx.auditoria.create({
        data: {
          empresaId: id,
          usuarioId: req.platformActor.id,
          sucursalId: null,
          accion: 'PLATFORM_EMPRESA_SUPERADMIN_RECOVER',
          modulo: 'platform-empresas',
          referencia: `empresa:${id}:superadmin:${target.id}`,
          valorAntes: { empresaId: id, superadminId: target.id, wasInactive: !target.activo },
          valorDespues: { empresaId: id, superadminId: target.id, activo: true },
          ip: req.ip || null
        }
      })

      return actualizado
    })

    return res.json({ empresaId: id, usuario: serializarSuperadmin(usuario) })
  } catch (err) {
    if (err instanceof EmpresaPlatformError) {
      const body = { error: err.message, code: err.code }
      if (err.errores) body.errores = err.errores
      if (err.campos) body.campos = err.campos
      return res.status(err.status).json(body)
    }
    console.error('Error al recuperar SUPERADMIN de empresa:', err)
    return res.status(500).json({ error: 'Error al recuperar el acceso del administrador' })
  }
}

module.exports = {
  EmpresaPlatformError,
  validarPayload,
  construirData,
  validarPayloadSuperadmin,
  resolverEstadoSuperadmin,
  listar,
  obtener,
  crear,
  editar,
  activar,
  suspender,
  crearSuperadmin,
  recuperarSuperadmin
}
