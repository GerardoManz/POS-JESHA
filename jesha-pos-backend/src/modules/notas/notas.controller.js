'use strict'

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { assertTenantRequestContext } = require('../../security/request-context')

const ALCANCES = new Set(['EMPRESA', 'SUCURSAL', 'USUARIO'])
const ROLES_PUBLICADORES = new Set(['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO'])
const SELECT_NOTA = {
  id: true,
  empresaId: true,
  autorId: true,
  alcance: true,
  sucursalId: true,
  usuarioDestinatarioId: true,
  titulo: true,
  contenido: true,
  creadaEn: true,
  retiradaEn: true,
  retiradaPorId: true,
  motivoRetiro: true,
  reemplazaNotaId: true,
  Autor: { select: { id: true, nombre: true, username: true, rol: true } },
  Sucursal: { select: { id: true, nombre: true } },
  UsuarioDestinatario: { select: { id: true, nombre: true, username: true } },
  RetiradaPor: { select: { id: true, nombre: true, username: true } },
  ReemplazadaPor: { select: { id: true } },
  _count: { select: { NotaDestinatario: true } }
}

class NotaError extends Error {
  constructor(status, message, code) {
    super(message)
    this.name = 'NotaError'
    this.status = status
    this.code = code
  }
}

function idPositivo(raw, campo = 'id') {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isInteger(value) || value <= 0 || value > 2147483647) {
    throw new NotaError(400, `${campo} inválido`, 'NOTA_ID_INVALIDO')
  }
  return value
}

function textoRequerido(raw, campo, maximo = null) {
  if (typeof raw !== 'string') throw new NotaError(400, `${campo} es obligatorio`, 'NOTA_CONTENIDO_INVALIDO')
  const value = raw.trim()
  if (!value) throw new NotaError(400, `${campo} es obligatorio`, 'NOTA_CONTENIDO_INVALIDO')
  if (maximo !== null && value.length > maximo) {
    throw new NotaError(400, `${campo} no puede exceder ${maximo} caracteres`, 'NOTA_CONTENIDO_INVALIDO')
  }
  return value
}

function validarContenido(body = {}) {
  return {
    titulo: textoRequerido(body.titulo, 'titulo', 160),
    contenido: textoRequerido(body.contenido, 'contenido', 20000)
  }
}

function asegurarDestinatarios(destinatarios) {
  if (destinatarios.length === 0) {
    throw new NotaError(409, 'No hay usuarios activos para recibir esta nota', 'NOTA_SIN_DESTINATARIOS')
  }
  return destinatarios
}

function contexto(req) {
  const value = assertTenantRequestContext(req.context)
  return {
    empresaId: getEmpresaId(req),
    actorId: value.actor.id,
    rol: value.actor.rol,
    sucursalId: value.branch.sucursalId,
    delegado: req.delegation?.active === true
  }
}

function puedeAdministrarNoPersonal(ctx) {
  return ctx.rol === 'SUPERADMIN'
}

function wherePuedeMutar(ctx, notaId) {
  const opciones = [{ autorId: ctx.actorId }]
  if (puedeAdministrarNoPersonal(ctx)) opciones.push({ alcance: { not: 'USUARIO' } })
  return { id: notaId, empresaId: ctx.empresaId, OR: opciones }
}

function whereVisibilidadDetalle(ctx, notaId) {
  const propia = { autorId: ctx.actorId }
  if (ctx.delegado) {
    return { id: notaId, empresaId: ctx.empresaId, alcance: { not: 'USUARIO' } }
  }
  const recibidaActiva = {
    retiradaEn: null,
    NotaDestinatario: { some: { usuarioId: ctx.actorId, empresaId: ctx.empresaId } }
  }
  const opciones = [propia, recibidaActiva]
  if (puedeAdministrarNoPersonal(ctx)) opciones.push({ alcance: { not: 'USUARIO' } })
  return { id: notaId, empresaId: ctx.empresaId, OR: opciones }
}

function mapearNota(nota, actorId, incluirLecturas = false) {
  const recibo = Array.isArray(nota.NotaDestinatario)
    ? nota.NotaDestinatario.find((item) => item.usuarioId === actorId)
    : null
  const data = {
    id: nota.id,
    alcance: nota.alcance,
    sucursalId: nota.sucursalId,
    usuarioDestinatarioId: nota.usuarioDestinatarioId,
    titulo: nota.titulo,
    contenido: nota.contenido,
    creadaEn: nota.creadaEn,
    retiradaEn: nota.retiradaEn,
    motivoRetiro: nota.motivoRetiro,
    reemplazaNotaId: nota.reemplazaNotaId,
    reemplazadaPorId: nota.ReemplazadaPor?.id ?? null,
    autor: nota.Autor ?? null,
    sucursal: nota.Sucursal ?? null,
    usuarioDestinatario: nota.UsuarioDestinatario ?? null,
    retiradaPor: nota.RetiradaPor ?? null,
    leida: Boolean(recibo?.leidaEn),
    leidaEn: recibo?.leidaEn ?? null
  }
  if (incluirLecturas) data.lecturas = { totalDestinatarios: nota._count?.NotaDestinatario ?? 0 }
  return data
}

function parsePaginacion(query = {}) {
  const page = query.page === undefined ? 1 : idPositivo(query.page, 'page')
  const limit = query.limit === undefined ? 20 : idPositivo(query.limit, 'limit')
  if (limit > 100) throw new NotaError(400, 'limit no puede exceder 100', 'NOTA_PAGINACION_INVALIDA')
  return { page, limit, skip: (page - 1) * limit }
}

function codificarCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodificarCursor(raw, scopeKey) {
  if (raw === undefined || raw === null || raw === '') return null
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    const fecha = new Date(parsed.creadaEn)
    if (parsed.v !== 1 || parsed.scopeKey !== scopeKey || !Number.isInteger(parsed.id) || parsed.id <= 0 || Number.isNaN(fecha.getTime())) {
      throw new Error('invalid')
    }
    return { id: parsed.id, creadaEn: fecha }
  } catch {
    throw new NotaError(400, 'cursor inválido', 'NOTA_CURSOR_INVALIDO')
  }
}

function filtroDespuesCursor(cursor) {
  if (!cursor) return undefined
  return {
    OR: [
      { creadaEn: { gt: cursor.creadaEn } },
      { creadaEn: cursor.creadaEn, id: { gt: cursor.id } }
    ]
  }
}

async function prepararDestino(db, ctx, payload) {
  const alcance = payload.alcance
  if (!ALCANCES.has(alcance)) throw new NotaError(400, 'alcance inválido', 'NOTA_ALCANCE_INVALIDO')
  if (ctx.delegado && alcance === 'USUARIO') {
    throw new NotaError(403, 'El acceso delegado no permite notas personales', 'NOTA_PERSONAL_DELEGADA_PROHIBIDA')
  }
  if (!ctx.delegado && !ROLES_PUBLICADORES.has(ctx.rol)) {
    throw new NotaError(403, 'Tu rol no puede publicar notas', 'NOTA_PUBLICACION_PROHIBIDA')
  }
  if ((ctx.rol === 'ADMIN_SUCURSAL' || ctx.rol === 'EMPLEADO') && alcance === 'EMPRESA') {
    throw new NotaError(403, 'Tu rol no puede publicar notas de empresa', 'NOTA_ALCANCE_PROHIBIDO')
  }

  if (alcance === 'EMPRESA') {
    const usuarios = await db.usuario.findMany({
      where: { empresaId: ctx.empresaId, activo: true, rol: { not: 'PLATFORM_ADMIN' }, id: { not: ctx.actorId } },
      select: { id: true }
    })
    return {
      alcance,
      sucursalId: null,
      usuarioDestinatarioId: null,
      destinatarios: asegurarDestinatarios(usuarios.map((u) => u.id))
    }
  }

  if (alcance === 'SUCURSAL') {
    const sucursalId = idPositivo(payload.sucursalId, 'sucursalId')
    if ((ctx.rol === 'ADMIN_SUCURSAL' || ctx.rol === 'EMPLEADO') && sucursalId !== ctx.sucursalId) {
      throw new NotaError(403, 'Solo puedes publicar en tu sucursal operativa', 'NOTA_SUCURSAL_PROHIBIDA')
    }
    const sucursal = await db.sucursal.findFirst({
      where: { id: sucursalId, empresaId: ctx.empresaId, activa: true },
      select: { id: true }
    })
    if (!sucursal) throw new NotaError(404, 'Sucursal no encontrada', 'NOTA_SUCURSAL_NO_ENCONTRADA')
    const usuarios = await db.usuario.findMany({
      where: {
        empresaId: ctx.empresaId,
        sucursalId,
        activo: true,
        rol: { not: 'PLATFORM_ADMIN' },
        id: { not: ctx.actorId }
      },
      select: { id: true }
    })
    return {
      alcance,
      sucursalId,
      usuarioDestinatarioId: null,
      destinatarios: asegurarDestinatarios(usuarios.map((u) => u.id))
    }
  }

  const usuarioDestinatarioId = idPositivo(payload.usuarioDestinatarioId, 'usuarioDestinatarioId')
  if (usuarioDestinatarioId === ctx.actorId) {
    throw new NotaError(400, 'No puedes enviarte una nota a ti mismo', 'NOTA_AUTODESTINO_PROHIBIDO')
  }
  const usuario = await db.usuario.findFirst({
    where: {
      id: usuarioDestinatarioId,
      empresaId: ctx.empresaId,
      activo: true,
      rol: { not: 'PLATFORM_ADMIN' }
    },
    select: { id: true, sucursalId: true }
  })
  if (!usuario) throw new NotaError(404, 'Usuario destinatario no encontrado', 'NOTA_USUARIO_NO_ENCONTRADO')
  if ((ctx.rol === 'ADMIN_SUCURSAL' || ctx.rol === 'EMPLEADO') && usuario.sucursalId !== ctx.sucursalId) {
    throw new NotaError(403, 'Solo puedes escribir a usuarios de tu sucursal', 'NOTA_USUARIO_PROHIBIDO')
  }
  return { alcance, sucursalId: null, usuarioDestinatarioId, destinatarios: [usuarioDestinatarioId] }
}

async function auditar(db, req, ctx, accion, notaId, valorDespues = undefined) {
  await db.auditoria.create({
    data: {
      empresaId: ctx.empresaId,
      usuarioId: ctx.actorId,
      sucursalId: ctx.sucursalId,
      accion,
      modulo: 'NOTAS',
      referencia: `nota:${notaId}`,
      valorDespues,
      ip: req.ip
    }
  })
}

async function crearNotaTx(db, req, ctx, payload, reemplazaNotaId = null) {
  const contenido = validarContenido(payload)
  const destino = await prepararDestino(db, ctx, payload)
  const nota = await db.nota.create({
    data: {
      empresaId: ctx.empresaId,
      autorId: ctx.actorId,
      alcance: destino.alcance,
      sucursalId: destino.sucursalId,
      usuarioDestinatarioId: destino.usuarioDestinatarioId,
      ...contenido,
      reemplazaNotaId,
      NotaDestinatario: {
        create: destino.destinatarios.map((usuarioId) => ({ usuarioId }))
      }
    },
    select: { ...SELECT_NOTA, NotaDestinatario: { where: { usuarioId: ctx.actorId }, select: { usuarioId: true, leidaEn: true } } }
  })
  await auditar(db, req, ctx, reemplazaNotaId ? 'NOTA_REEMPLAZAR' : 'NOTA_PUBLICAR', nota.id, {
    alcance: nota.alcance,
    destinatarios: destino.destinatarios.length,
    reemplazaNotaId
  })
  return nota
}

function responderError(res, error) {
  if (error instanceof NotaError) return res.status(error.status).json({ success: false, error: error.message, code: error.code })
  console.error('Error en notas:', error)
  return res.status(500).json({ success: false, error: 'Error interno del servidor' })
}

function crearNotasController(dependencies = {}) {
  const db = dependencies.prisma || prisma

  async function listar(req, res) {
    try {
      const ctx = contexto(req)
      const vista = req.query.vista ?? 'recibidas'
      if (!['recibidas', 'enviadas'].includes(vista)) throw new NotaError(400, 'vista inválida', 'NOTA_VISTA_INVALIDA')
      if (ctx.delegado && vista === 'recibidas') {
        return res.json({ success: true, data: [], paginacion: { page: 1, limit: 20, total: 0, totalPages: 0 } })
      }
      const { page, limit, skip } = parsePaginacion(req.query)
      const where = { empresaId: ctx.empresaId }
      if (vista === 'recibidas') {
        where.retiradaEn = null
        where.NotaDestinatario = { some: { usuarioId: ctx.actorId } }
        if (req.query.lectura === 'leidas') where.NotaDestinatario.some.leidaEn = { not: null }
        else if (req.query.lectura === 'no_leidas') where.NotaDestinatario.some.leidaEn = null
        else if (req.query.lectura !== undefined && req.query.lectura !== 'todas') throw new NotaError(400, 'lectura inválida', 'NOTA_LECTURA_INVALIDA')
      } else {
        const opciones = [{ autorId: ctx.actorId }]
        if (puedeAdministrarNoPersonal(ctx)) opciones.push({ alcance: { not: 'USUARIO' } })
        where.OR = opciones
      }
      if (req.query.alcance !== undefined) {
        if (!ALCANCES.has(req.query.alcance)) throw new NotaError(400, 'alcance inválido', 'NOTA_ALCANCE_INVALIDO')
        where.alcance = req.query.alcance
      }
      if (req.query.buscar !== undefined) {
        const buscar = textoRequerido(req.query.buscar, 'buscar', 160)
        where.AND = [{ OR: [{ titulo: { contains: buscar, mode: 'insensitive' } }, { contenido: { contains: buscar, mode: 'insensitive' } }] }]
      }
      const select = { ...SELECT_NOTA, NotaDestinatario: { where: { usuarioId: ctx.actorId }, select: { usuarioId: true, leidaEn: true } } }
      const [total, notas] = await db.$transaction([
        db.nota.count({ where }),
        db.nota.findMany({ where, select, orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }], skip, take: limit })
      ])
      const data = notas.map((nota) => mapearNota(nota, ctx.actorId, vista === 'enviadas'))
      return res.json({ success: true, data, paginacion: { page, limit, total, totalPages: Math.ceil(total / limit) } })
    } catch (error) {
      return responderError(res, error)
    }
  }

  async function resumenNoLeidas(req, res) {
    try {
      const ctx = contexto(req)
      const scopeKey = `notas:${ctx.empresaId}:${ctx.delegado ? 'delegado' : ctx.actorId}`
      if (ctx.delegado) {
        return res.json({ success: true, data: { enabled: false, unreadCount: 0, cursor: null, scopeKey, newSinceCursor: { count: 0, hasNew: false, latest: null } } })
      }
      const cursor = decodificarCursor(req.query.cursor, scopeKey)
      const baseWhere = {
        empresaId: ctx.empresaId,
        retiradaEn: null,
        NotaDestinatario: { some: { usuarioId: ctx.actorId } }
      }
      const newerWhere = filtroDespuesCursor(cursor)
      const [unreadCount, latest, newSinceCount] = await db.$transaction([
        db.notaDestinatario.count({ where: { empresaId: ctx.empresaId, usuarioId: ctx.actorId, leidaEn: null, Nota: { retiradaEn: null } } }),
        db.nota.findFirst({ where: baseWhere, orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }], select: { id: true, creadaEn: true } }),
        cursor ? db.nota.count({ where: { ...baseWhere, AND: [newerWhere] } }) : db.nota.count({ where: { id: -1 } })
      ])
      const latestMeta = latest ? { id: latest.id, creadaEn: latest.creadaEn } : null
      const nextCursor = latest
        ? codificarCursor({ v: 1, scopeKey, id: latest.id, creadaEn: latest.creadaEn.toISOString() })
        : (req.query.cursor || null)
      return res.json({
        success: true,
        data: {
          enabled: true,
          unreadCount,
          cursor: nextCursor,
          scopeKey,
          newSinceCursor: { count: newSinceCount, hasNew: newSinceCount > 0, latest: latestMeta }
        }
      })
    } catch (error) {
      return responderError(res, error)
    }
  }

  async function obtener(req, res) {
    try {
      const ctx = contexto(req)
      const notaId = idPositivo(req.params.id)
      const nota = await db.nota.findFirst({
        where: whereVisibilidadDetalle(ctx, notaId),
        select: { ...SELECT_NOTA, NotaDestinatario: { where: { usuarioId: ctx.actorId }, select: { usuarioId: true, leidaEn: true } } }
      })
      if (!nota) throw new NotaError(404, 'Nota no encontrada', 'NOTA_NO_ENCONTRADA')
      const incluirLecturas = nota.autorId === ctx.actorId || (puedeAdministrarNoPersonal(ctx) && nota.alcance !== 'USUARIO')
      return res.json({ success: true, data: mapearNota(nota, ctx.actorId, incluirLecturas) })
    } catch (error) {
      return responderError(res, error)
    }
  }

  async function lecturas(req, res) {
    try {
      const ctx = contexto(req)
      const notaId = idPositivo(req.params.id)
      const nota = await db.nota.findFirst({
        where: {
          id: notaId,
          empresaId: ctx.empresaId,
          OR: [
            { autorId: ctx.actorId },
            ...(puedeAdministrarNoPersonal(ctx) ? [{ alcance: { not: 'USUARIO' } }] : [])
          ]
        },
        select: { id: true, alcance: true }
      })
      if (!nota || (ctx.delegado && nota.alcance === 'USUARIO')) throw new NotaError(404, 'Nota no encontrada', 'NOTA_NO_ENCONTRADA')
      const items = await db.notaDestinatario.findMany({
        where: { empresaId: ctx.empresaId, notaId },
        select: { usuarioId: true, leidaEn: true, Usuario: { select: { id: true, nombre: true, username: true } } },
        orderBy: [{ leidaEn: 'asc' }, { usuarioId: 'asc' }]
      })
      return res.json({
        success: true,
        data: items.map((item) => ({ usuario: item.Usuario, leida: Boolean(item.leidaEn), leidaEn: item.leidaEn })),
        paginacion: { total: items.length }
      })
    } catch (error) {
      return responderError(res, error)
    }
  }

  async function crear(req, res) {
    try {
      const ctx = contexto(req)
      const nota = await db.$transaction((tx) => crearNotaTx(tx, req, ctx, req.body))
      return res.status(201).json({ success: true, data: mapearNota(nota, ctx.actorId, true) })
    } catch (error) {
      return responderError(res, error)
    }
  }

  async function leer(req, res) {
    try {
      const ctx = contexto(req)
      if (ctx.delegado) throw new NotaError(403, 'El acceso delegado no genera lecturas', 'NOTA_LECTURA_DELEGADA_PROHIBIDA')
      const notaId = idPositivo(req.params.id)
      const recibo = await db.$transaction(async (tx) => {
        const actual = await tx.notaDestinatario.findFirst({
          where: { empresaId: ctx.empresaId, notaId, usuarioId: ctx.actorId, Nota: { retiradaEn: null } },
          select: { id: true, leidaEn: true }
        })
        if (!actual) throw new NotaError(404, 'Nota no encontrada', 'NOTA_NO_ENCONTRADA')
        if (actual.leidaEn) return actual
        await tx.notaDestinatario.updateMany({ where: { id: actual.id, leidaEn: null }, data: { leidaEn: new Date() } })
        return tx.notaDestinatario.findUnique({ where: { id: actual.id }, select: { id: true, leidaEn: true } })
      })
      return res.json({ success: true, data: { notaId, leida: true, leidaEn: recibo.leidaEn } })
    } catch (error) {
      return responderError(res, error)
    }
  }

  async function leerTodas(req, res) {
    try {
      const ctx = contexto(req)
      if (ctx.delegado) throw new NotaError(403, 'El acceso delegado no genera lecturas', 'NOTA_LECTURA_DELEGADA_PROHIBIDA')
      const result = await db.notaDestinatario.updateMany({
        where: { empresaId: ctx.empresaId, usuarioId: ctx.actorId, leidaEn: null, Nota: { retiradaEn: null } },
        data: { leidaEn: new Date() }
      })
      return res.json({ success: true, data: { actualizadas: result.count } })
    } catch (error) {
      return responderError(res, error)
    }
  }

  async function retirar(req, res) {
    try {
      const ctx = contexto(req)
      const notaId = idPositivo(req.params.id)
      const motivoRetiro = textoRequerido(req.body?.motivo, 'motivo', 500)
      const nota = await db.$transaction(async (tx) => {
        const actual = await tx.nota.findFirst({ where: wherePuedeMutar(ctx, notaId), select: { id: true, autorId: true, alcance: true, retiradaEn: true } })
        if (!actual) throw new NotaError(404, 'Nota no encontrada', 'NOTA_NO_ENCONTRADA')
        if (actual.retiradaEn) throw new NotaError(409, 'La nota ya fue retirada', 'NOTA_YA_RETIRADA')
        const changed = await tx.nota.updateMany({
          where: { id: notaId, empresaId: ctx.empresaId, retiradaEn: null },
          data: { retiradaEn: new Date(), retiradaPorId: ctx.actorId, motivoRetiro }
        })
        if (changed.count !== 1) throw new NotaError(409, 'La nota ya fue retirada', 'NOTA_YA_RETIRADA')
        await auditar(tx, req, ctx, 'NOTA_RETIRAR', notaId, { motivoRetiro })
        return tx.nota.findUnique({ where: { id: notaId }, select: SELECT_NOTA })
      })
      return res.json({ success: true, data: mapearNota(nota, ctx.actorId, true) })
    } catch (error) {
      return responderError(res, error)
    }
  }

  async function reemplazar(req, res) {
    try {
      const ctx = contexto(req)
      const notaId = idPositivo(req.params.id)
      const motivoRetiro = 'Reemplazada por una corrección'
      validarContenido(req.body)
      const nueva = await db.$transaction(async (tx) => {
        const original = await tx.nota.findFirst({
          where: wherePuedeMutar(ctx, notaId),
          select: { id: true, autorId: true, alcance: true, sucursalId: true, usuarioDestinatarioId: true, retiradaEn: true }
        })
        if (!original) throw new NotaError(404, 'Nota no encontrada', 'NOTA_NO_ENCONTRADA')
        if (original.retiradaEn) throw new NotaError(409, 'La nota ya fue retirada', 'NOTA_YA_RETIRADA')
        const changed = await tx.nota.updateMany({
          where: { id: notaId, empresaId: ctx.empresaId, retiradaEn: null },
          data: { retiradaEn: new Date(), retiradaPorId: ctx.actorId, motivoRetiro }
        })
        if (changed.count !== 1) throw new NotaError(409, 'La nota ya fue retirada', 'NOTA_YA_RETIRADA')
        const payload = {
          titulo: req.body.titulo,
          contenido: req.body.contenido,
          alcance: original.alcance,
          sucursalId: original.sucursalId,
          usuarioDestinatarioId: original.usuarioDestinatarioId
        }
        return crearNotaTx(tx, req, ctx, payload, original.id)
      })
      return res.status(201).json({ success: true, data: mapearNota(nueva, ctx.actorId, true) })
    } catch (error) {
      return responderError(res, error)
    }
  }

  return { listar, resumenNoLeidas, obtener, lecturas, crear, leerTodas, leer, retirar, reemplazar }
}

const controller = crearNotasController()

module.exports = {
  ...controller,
  crearNotasController,
  NotaError,
  validarContenido,
  prepararDestino,
  codificarCursor,
  decodificarCursor,
  filtroDespuesCursor
}
