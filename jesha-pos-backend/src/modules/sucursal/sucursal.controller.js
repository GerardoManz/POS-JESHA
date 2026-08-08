const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { assertTenantRequestContext, BRANCH_MODE } = require('../../security/request-context')

// Campos sensibles expuestos en respuestas administrativas (SUPERADMIN).
const SELECT_GESTION = {
  id: true,
  nombre: true,
  direccion: true,
  telefono: true,
  codigoPostal: true,
  activa: true,
  creadaEn: true
}

// Campos editables permitidos para una Sucursal tenant.
const CAMPOS_PERMITIDOS = new Set(['nombre', 'codigoPostal', 'direccion', 'telefono'])
// Campos prohibidos (nunca desde el cliente) — el backend impone su valor.
const CAMPOS_PROHIBIDOS = new Set(['id', 'empresaId', 'activa', 'creadaEn', 'actualizadaEn', 'creadoEn'])

// ── Auditoría (contrato replicado de clientes.controller.js, modulo 'sucursales') ──
async function registrarAudit(solicitante, accion, referencia, ip, empresaId, sucursalId) {
  try {
    const data = { accion, modulo: 'sucursales', referencia, ip }
    if (solicitante?.id) data.usuarioId = solicitante.id
    if (empresaId) data.empresaId = empresaId
    if (sucursalId) data.sucursalId = sucursalId
    await prisma.auditoria.create({ data })
  } catch (e) {
    console.error('Audit error:', e.message)
  }
}

function normalizarId(raw) {
  const value = Number(String(raw).trim())
  if (!Number.isInteger(value) || value <= 0) return null
  return value
}

function validarPayload(data, esCrear) {
  const errores = []

  for (const clave of Object.keys(data)) {
    if (CAMPOS_PROHIBIDOS.has(clave)) {
      errores.push({ campo: clave, mensaje: `No se permite modificar ${clave}` })
    }
    if (!CAMPOS_PERMITIDOS.has(clave) && !CAMPOS_PROHIBIDOS.has(clave)) {
      errores.push({ campo: clave, mensaje: `Campo desconocido: ${clave}` })
    }
  }

  const definido = clave => data[clave] !== undefined && data[clave] !== null

  if (esCrear) {
    for (const req of ['nombre', 'codigoPostal']) {
      if (!definido(req) || String(data[req]).trim() === '') {
        errores.push({ campo: req, mensaje: `${req} es obligatorio` })
      }
    }
  }

  if (definido('nombre') || (esCrear && data.nombre !== undefined)) {
    const nombre = String(data.nombre).trim()
    if (nombre.length < 2 || nombre.length > 120) {
      errores.push({ campo: 'nombre', mensaje: 'nombre debe tener entre 2 y 120 caracteres' })
    }
  }

  if (definido('codigoPostal') || (esCrear && data.codigoPostal !== undefined)) {
    const cp = String(data.codigoPostal).trim()
    if (cp.length < 1 || cp.length > 10) {
      errores.push({ campo: 'codigoPostal', mensaje: 'codigoPostal debe tener entre 1 y 10 caracteres' })
    }
  }

  if (definido('direccion')) {
    const d = String(data.direccion).trim()
    if (d.length > 250) errores.push({ campo: 'direccion', mensaje: 'direccion no debe exceder 250 caracteres' })
  }

  if (definido('telefono')) {
    const t = String(data.telefono).trim()
    if (t.length > 20) errores.push({ campo: 'telefono', mensaje: 'telefono no debe exceder 20 caracteres' })
  }

  return errores
}

// ═══════════════════════════════════════════════════════════════════
// GET /sucursales — lista sucursales ACTIVAS (contrato operativo intacto)
// ═══════════════════════════════════════════════════════════════════
const listar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)

    if (!empresaId) {
      return res.status(403).json({ error: 'No se pudo determinar la empresa del usuario' })
    }

    const sucursales = await prisma.sucursal.findMany({
      where: { empresaId, activa: true },
      select: { id: true, nombre: true, direccion: true, activa: true },
      orderBy: { nombre: 'asc' }
    })

    res.json(sucursales)
  } catch (err) {
    console.error('Error al obtener sucursales:', err)
    res.status(500).json({ error: 'Error al obtener sucursales' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET /sucursales/disponibles — sucursales activas para selección
// ═══════════════════════════════════════════════════════════════════
const listarDisponibles = async (req, res) => {
  try {
    const context = assertTenantRequestContext(req.context)

    const empresaId = context.tenant.empresaId
    const rol = context.actor.rol
    const mode = context.branch.mode
    const sucursalId = context.branch.sucursalId

    if (mode === BRANCH_MODE.FIXED) {
      const sucursal = await prisma.sucursal.findUnique({
        where: { id: sucursalId },
        select: { id: true, nombre: true, activa: true }
      })
      return res.json({
        sucursales: sucursal && sucursal.activa
          ? [{ id: sucursal.id, nombre: sucursal.nombre, activa: true }]
          : []
      })
    }

    const sucursales = await prisma.sucursal.findMany({
      where: { empresaId, activa: true },
      select: { id: true, nombre: true, activa: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }]
    })

    res.json({ sucursales })
  } catch (err) {
    if (err.code && err.status) throw err
    console.error('Error al obtener sucursales disponibles:', err)
    res.status(500).json({ error: 'Error al obtener sucursales' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET /sucursales/gestion — listado administrativo (activas + inactivas)
// ═══════════════════════════════════════════════════════════════════
const gestion = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { estado, buscar } = req.query
    const pagina = validarEntero(req.query.pagina, 1, 1, 1000000)
    const porPagina = validarEntero(req.query.porPagina, 20, 1, 100)

    const where = { empresaId }
    if (estado === 'activas') where.activa = true
    else if (estado === 'inactivas') where.activa = false

    if (buscar && String(buscar).trim()) {
      const termino = String(buscar).trim()
      where.OR = [
        { nombre: { contains: termino, mode: 'insensitive' } },
        { codigoPostal: { contains: termino, mode: 'insensitive' } }
      ]
    }

    const [total, sucursales] = await Promise.all([
      prisma.sucursal.count({ where }),
      prisma.sucursal.findMany({
        where,
        select: SELECT_GESTION,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina
      })
    ])

    res.json({ sucursales, total, pagina, porPagina })
  } catch (err) {
    if (err.code && err.status) throw err
    console.error('Error al listar sucursales (gestion):', err)
    res.status(500).json({ error: 'Error al listar sucursales' })
  }
}

function validarEntero(raw, defecto, min, max) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return defecto
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

// ═══════════════════════════════════════════════════════════════════
// GET /sucursales/gestion/:id — una sucursal
// ═══════════════════════════════════════════════════════════════════
const obtener = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const id = normalizarId(req.params.id)
    if (!id) return res.status(400).json({ error: 'id de sucursal inválido' })

    const sucursal = await prisma.sucursal.findFirst({
      where: { id, empresaId },
      select: SELECT_GESTION
    })
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' })

    res.json({ sucursal })
  } catch (err) {
    if (err.code && err.status) throw err
    console.error('Error al obtener sucursal:', err)
    res.status(500).json({ error: 'Error al obtener sucursal' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /sucursales/gestion — crear sucursal (activa=false impuesto)
// ═══════════════════════════════════════════════════════════════════
const crear = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}

    const errores = validarPayload(body, true)
    if (errores.length > 0) {
      return res.status(400).json({ error: 'Datos de sucursal inválidos', errores })
    }

    const data = armarDatosEdicion(body)
    data.activa = false // una sucursal nace DESACTIVADA; se activa explícitamente

    const sucursal = await prisma.sucursal.create({
      data: { ...data, empresaId },
      select: SELECT_GESTION
    })

    await registrarAudit(
      req.usuario,
      'SUCURSAL_CREAR',
      `Creó sucursal ${sucursal.nombre}`,
      req.ip,
      empresaId,
      sucursal.id
    )

    res.status(201).json({ sucursal })
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe una sucursal con esos datos en esta empresa' })
    }
    if (err.code && err.status) throw err
    console.error('Error al crear sucursal:', err)
    res.status(500).json({ error: 'Error al crear sucursal' })
  }
}

function armarDatosEdicion(body) {
  const data = {}
  for (const clave of ['nombre', 'codigoPostal', 'direccion', 'telefono']) {
    if (body[clave] !== undefined && body[clave] !== null) {
      data[clave] = String(body[clave]).trim()
    }
  }
  return data
}

// ═══════════════════════════════════════════════════════════════════
// PATCH /sucursales/gestion/:id — editar nombre/codigoPostal/direccion/telefono
// ═══════════════════════════════════════════════════════════════════
const editar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const id = normalizarId(req.params.id)
    if (!id) return res.status(400).json({ error: 'id de sucursal inválido' })

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const errores = validarPayload(body, false)
    if (errores.length > 0) {
      return res.status(400).json({ error: 'Datos de sucursal inválidos', errores })
    }

    const data = armarDatosEdicion(body)
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos para editar' })
    }

    const existe = await prisma.sucursal.findFirst({
      where: { id, empresaId },
      select: { id: true, nombre: true }
    })
    if (!existe) return res.status(404).json({ error: 'Sucursal no encontrada' })

    const resultado = await prisma.sucursal.updateMany({
      where: { id, empresaId },
      data
    })
    if (resultado.count !== 1) return res.status(404).json({ error: 'Sucursal no encontrada' })

    const sucursal = await prisma.sucursal.findUnique({
      where: { id },
      select: SELECT_GESTION
    })

    await registrarAudit(
      req.usuario,
      'SUCURSAL_EDITAR',
      `Editó sucursal ${sucursal.nombre}`,
      req.ip,
      empresaId,
      id
    )

    res.json({ sucursal })
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe una sucursal con esos datos en esta empresa' })
    }
    if (err.code && err.status) throw err
    console.error('Error al editar sucursal:', err)
    res.status(500).json({ error: 'Error al editar sucursal' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /sucursales/gestion/:id/activar — idempotente
// ═══════════════════════════════════════════════════════════════════
const activar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const id = normalizarId(req.params.id)
    if (!id) return res.status(400).json({ error: 'id de sucursal inválido' })

    const sucursal = await prisma.sucursal.findFirst({
      where: { id, empresaId },
      select: SELECT_GESTION
    })
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' })

    if (sucursal.activa === true) {
      return res.json({ sucursal })
    }

    const actualizada = await prisma.sucursal.update({
      where: { id },
      data: { activa: true },
      select: SELECT_GESTION
    })

    await registrarAudit(
      req.usuario,
      'SUCURSAL_ACTIVAR',
      `Activó sucursal ${actualizada.nombre}`,
      req.ip,
      empresaId,
      id
    )

    res.json({ sucursal: actualizada })
  } catch (err) {
    if (err.code && err.status) throw err
    console.error('Error al activar sucursal:', err)
    res.status(500).json({ error: 'Error al activar sucursal' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /sucursales/gestion/:id/desactivar — idempotente, bloquea turno abierto
// ═══════════════════════════════════════════════════════════════════
const desactivar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const id = normalizarId(req.params.id)
    if (!id) return res.status(400).json({ error: 'id de sucursal inválido' })

    const sucursal = await prisma.sucursal.findFirst({
      where: { id, empresaId },
      select: SELECT_GESTION
    })
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' })

    if (sucursal.activa !== true) {
      return res.json({ sucursal })
    }

    const turnosAbiertos = await prisma.turnoCaja.count({
      where: { sucursalId: id, abierto: true }
    })
    if (turnosAbiertos > 0) {
      return res.status(409).json({
        error: 'SUCURSAL_CON_TURNO_ABIERTO',
        message: 'La sucursal tiene turnos de caja abiertos. Ciérralos antes de desactivarla.'
      })
    }

    const actualizada = await prisma.sucursal.update({
      where: { id },
      data: { activa: false },
      select: SELECT_GESTION
    })

    await registrarAudit(
      req.usuario,
      'SUCURSAL_DESACTIVAR',
      `Desactivó sucursal ${actualizada.nombre}`,
      req.ip,
      empresaId,
      id
    )

    res.json({ sucursal: actualizada })
  } catch (err) {
    if (err.code && err.status) throw err
    console.error('Error al desactivar sucursal:', err)
    res.status(500).json({ error: 'Error al desactivar sucursal' })
  }
}

module.exports = {
  listar,
  listarDisponibles,
  gestion,
  obtener,
  crear,
  editar,
  activar,
  desactivar,
  validarPayload,
  normalizarId,
  validarEntero,
  CAMPOS_PERMITIDOS,
  CAMPOS_PROHIBIDOS
}
