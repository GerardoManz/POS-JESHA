// src/modules/impresion/impresion.controller.js
const crypto = require('crypto')
const prisma = require('../../lib/prisma')
const service = require('./impresion.service')
const { buildAbonoSnapshot, buildRetiroSnapshot, formatFechaTicket } = require('./impresion.snapshot')
const getEmpresaId = require('../../helpers/getEmpresaId')

// Mapea tipo -> nombre de campo de entidad en PrintJob.
const CAMPO_ENTIDAD = { VENTA: 'ventaId', CORTE: 'turnoId', ABONO: 'abonoId', RETIRO: 'retiroId' }

// Envuelve handlers async para capturar throws no manejados.
// Respeta err.status y err.expose para errores controlados del helper.
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  if (err && err.code === 'P2002') {
    return res.status(409).json({ error: 'Recurso duplicado' })
  }
  if (err && err.expose && err.status) {
    return res.status(err.status).json({ error: err.message })
  }
  console.error('[impresion]', err)
  return res.status(500).json({ error: 'Error interno de impresión' })
})

// ── Middleware: autenticación del agente (T2-Auth) ──
// Token estático compartido, comparado en tiempo constante. Adjunta empresaId.
function requireAgentAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const expected = process.env.JESHA_AGENT_TOKEN || ''

  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Token de agente inválido' })
  }

  const empresaId = parseInt(process.env.JESHA_AGENT_EMPRESA_ID, 10)
  if (!empresaId) {
    return res.status(500).json({ error: 'JESHA_AGENT_EMPRESA_ID no configurado' })
  }
  req.agentEmpresaId = empresaId
  next()
}

// ── Frontend (requireAuth) ──

// ── Helper: construye el snapshot de impresión desde DB (empresa real, no constante) ──
async function construirSnapshotImpresion(req, tipo, entidadId) {
  const empresaId = getEmpresaId(req)

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { nombreComercial: true, razonSocial: true, rfc: true, whatsapp: true }
  })
  if (!empresa) {
    const err = new Error('Empresa no encontrada')
    err.status = 404
    err.expose = true
    throw err
  }

  if (tipo === 'ABONO') {
    const abono = await prisma.abonoBitacora.findFirst({
      where: { id: entidadId, empresaId },
      include: {
        Usuario: { select: { nombre: true } },
        Bitacora: {
          select: {
            sucursalId: true, folio: true, estado: true,
            Cliente: { select: { nombre: true } }
          }
        }
      }
    })
    if (!abono) {
      const err = new Error('Abono no encontrado')
      err.status = 404
      err.expose = true
      throw err
    }

    const sucursal = await prisma.sucursal.findUnique({
      where: { id: abono.Bitacora.sucursalId },
      select: { direccion: true }
    })

    const metodoLabel = {
      EFECTIVO: 'Efectivo', CREDITO: 'T. Crédito', DEBITO: 'T. Débito',
      TRANSFERENCIA: 'Transferencia'
    }[abono.metodoPago] || abono.metodoPago

    return buildAbonoSnapshot({
      empresa: {
        nombre: empresa.nombreComercial,
        slogan: null,
        direccion: sucursal?.direccion || null,
        ciudad: null,
        rfc: empresa.rfc,
        telefono: empresa.whatsapp
      },
      abonoId: abono.id,
      fecha: formatFechaTicket(abono.creadoEn),
      cajero: abono.Usuario?.nombre || null,
      cliente: abono.Bitacora.Cliente?.nombre || null,
      montoAbono: abono.monto,
      metodoPago: abono.metodoPago,
      metodoLabel,
      saldoAnterior: null,
      saldoNuevo: null,
      abrirCajon: false
    })
  }

  if (tipo === 'RETIRO') {
    const retiro = await prisma.retiroBitacora.findFirst({
      where: { id: entidadId, empresaId },
      include: {
        Usuario: { select: { nombre: true } },
        Responsable: { select: { nombre: true } },
        RecibeTrabajador: { select: { nombre: true, apodo: true } },
        Bitacora: { select: { sucursalId: true } },
        DetalleBitacora: {
          include: { Producto: { select: { nombre: true } } }
        }
      }
    })
    if (!retiro) {
      const err = new Error('Retiro no encontrado')
      err.status = 404
      err.expose = true
      throw err
    }

    const sucursal = await prisma.sucursal.findUnique({
      where: { id: retiro.Bitacora.sucursalId },
      select: { direccion: true }
    })

    const trabajador = retiro.RecibeTrabajador
      ? (retiro.RecibeTrabajador.apodo || retiro.RecibeTrabajador.nombre)
      : (retiro.recibeNombre || null)

    return buildRetiroSnapshot({
      empresa: {
        nombre: empresa.nombreComercial,
        slogan: null,
        direccion: sucursal?.direccion || null,
        ciudad: null,
        rfc: empresa.rfc,
        telefono: empresa.whatsapp
      },
      retiroId: retiro.id,
      fecha: formatFechaTicket(retiro.creadoEn),
      cajero: retiro.Usuario?.nombre || null,
      trabajador,
      productos: retiro.DetalleBitacora.map(d => ({
        nombre: d.Producto?.nombre || '',
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario
      }))
    })
  }

  const err = new Error('Tipo no soportado')
  err.status = 400
  err.expose = true
  throw err
}

// POST /impresion/job — crear ORIGINAL o COPIA según máquina de estados.
// accion: 'IMPRIMIR' (único valor actual, extensible a futuro).
const encolarManual = wrap(async (req, res) => {
  const empresaId = getEmpresaId(req)
  const { tipo, accion } = req.body
  const campo = CAMPO_ENTIDAD[tipo]
  if (!campo) return res.status(400).json({ error: 'tipo inválido' })
  if (accion && accion !== 'IMPRIMIR') return res.status(400).json({ error: 'accion inválida' })

  const entidadId = parseInt(req.body[campo], 10)
  if (!entidadId) return res.status(400).json({ error: `${campo} requerido` })

  const idFilter = { [campo]: entidadId }

  // ── Buscar ORIGINAL existente ──
  const base = await prisma.printJob.findFirst({
    where: { empresaId, tipo, modo: 'ORIGINAL', ...idFilter },
    orderBy: { creadoEn: 'desc' }
  })

  // ── CASO 1: No existe ORIGINAL → crear uno nuevo ──
  if (!base) {
    const snapshot = await construirSnapshotImpresion(req, tipo, entidadId)
    const idempotencyKey = service.buildIdempotencyKey({
      tipo, modo: 'ORIGINAL', empresaId, entidadId
    })
    try {
      const job = await prisma.printJob.create({
        data: {
          empresaId, idempotencyKey, tipo, modo: 'ORIGINAL',
          [campo]: entidadId,
          queueName: service.DEFAULT_QUEUE,
          payload: snapshot
        }
      })
      return res.json({ ok: true, printJobId: job.id, modo: 'ORIGINAL', creado: true })
    } catch (err) {
      if (err.code === 'P2002') {
        const concurrente = await prisma.printJob.findFirst({
          where: { empresaId, tipo, modo: 'ORIGINAL', ...idFilter },
          orderBy: { creadoEn: 'desc' }
        })
        if (concurrente) {
          return res.json({ ok: true, printJobId: concurrente.id, modo: 'ORIGINAL', creado: false })
        }
      }
      throw err
    }
  }

  const { estado, id } = base

  // ── CASO 2: PENDIENTE — agente ya lo recogerá ──
  if (estado === 'PENDIENTE') {
    return res.json({ ok: true, printJobId: id, modo: 'ORIGINAL', creado: false })
  }

  // ── CASO 3: EN_PROCESO — agente ya lo está procesando ──
  if (estado === 'EN_PROCESO') {
    return res.json({ ok: true, printJobId: id, modo: 'ORIGINAL', creado: false })
  }

  // ── CASO 4: ENVIADO_A_IMPRESORA → crear COPIA ──
  if (estado === 'ENVIADO_A_IMPRESORA') {
    const copiasPrevias = await prisma.printJob.count({
      where: { empresaId, tipo, modo: 'COPIA', ...idFilter }
    })
    const copiaNum = copiasPrevias + 1

    const snapshot = await construirSnapshotImpresion(req, tipo, entidadId)
    const payload = { ...snapshot, copia: true, copiaNum }

    const idempotencyKey = service.buildIdempotencyKey({
      tipo, modo: 'COPIA', empresaId, entidadId, copiaNum
    })
    try {
      const job = await prisma.printJob.create({
        data: {
          empresaId, idempotencyKey, tipo, modo: 'COPIA',
          [campo]: entidadId,
          queueName: service.DEFAULT_QUEUE,
          payload
        }
      })
      return res.json({ ok: true, printJobId: job.id, modo: 'COPIA', creado: true })
    } catch (err) {
      if (err.code === 'P2002') {
        return res.json({ ok: true, modo: 'COPIA', creado: false })
      }
      throw err
    }
  }

  // ── CASO 5: FALLIDO — reencolar si no superó máximos ──
  if (estado === 'FALLIDO') {
    if (base.intentos >= service.MAX_INTENTOS) {
      return res.status(409).json({ error: 'El trabajo falló definitivamente. Consulte al administrador.' })
    }
    const snapshot = await construirSnapshotImpresion(req, tipo, entidadId)
    await prisma.printJob.update({
      where: { id },
      data: {
        estado: 'PENDIENTE',
        error: null,
        enviadoEn: null,
        ultimoIntentoEn: null,
        payload: snapshot
      }
    })
    return res.json({ ok: true, printJobId: id, modo: 'ORIGINAL', reencolado: true })
  }

  // ── CASO 6: CANCELADO — reencolar mismo registro (idempotencyKey única) ──
  if (estado === 'CANCELADO') {
    let payload = base.payload
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      payload = await construirSnapshotImpresion(req, tipo, entidadId)
    }
    await prisma.printJob.update({
      where: { id },
      data: {
        estado: 'PENDIENTE',
        intentos: 0,
        error: null,
        enviadoEn: null,
        ultimoIntentoEn: null,
        payload
      }
    })
    return res.json({ ok: true, printJobId: id, modo: 'ORIGINAL', reencolado: true })
  }

  return res.status(500).json({ error: `Estado de impresión no manejado: ${estado}` })
})

// GET /impresion/jobs/:id — estado de un trabajo (scoped).
const consultarEstado = wrap(async (req, res) => {
  const job = await service.getJob(req.params.id, req.usuario.empresaId)
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' })
  res.json({
    id: job.id, estado: job.estado, intentos: job.intentos,
    error: job.error, creadoEn: job.creadoEn, enviadoEn: job.enviadoEn
  })
})

// GET /impresion/jobs — lista (scoped), filtro opcional ?estado=
const listarJobs = wrap(async (req, res) => {
  const jobs = await service.listJobs(req.usuario.empresaId, {
    estado: req.query.estado, take: req.query.take
  })
  res.json(jobs)
})

// ── Agente (requireAgentAuth) ──

// POST /impresion/agent/next — reclama siguiente trabajo (SKIP LOCKED, scoped).
const agentNext = wrap(async (req, res) => {
  const job = await service.claimNextJob({ empresaId: req.agentEmpresaId })
  if (!job) return res.status(204).end()
  res.json({ printJobId: job.id, tipo: job.tipo, modo: job.modo, payload: job.payload })
})

// POST /impresion/agent/:id/success
const agentSuccess = wrap(async (req, res) => {
  const id = Number(req.params.id)
  const job = await service.getJob(id, req.agentEmpresaId) // scope T2
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' })
  await service.markSuccess(id)
  res.json({ ok: true })
})

// POST /impresion/agent/:id/fail  body: { error }
const agentFail = wrap(async (req, res) => {
  const id = Number(req.params.id)
  const job = await service.getJob(id, req.agentEmpresaId) // scope T2
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' })
  await service.markFailure(id, (req.body && req.body.error) || null)
  res.json({ ok: true })
})

// POST /impresion/agent/reset — al arrancar el agente (scoped).
const agentReset = wrap(async (req, res) => {
  const count = await service.resetStaleForEmpresa(req.agentEmpresaId)
  res.json({ ok: true, resetCount: count })
})

// GET /impresion/health — estado de la cola (agente). Auditable sin tocar la impresora.
const agentHealth = wrap(async (req, res) => {
  const health = await service.getHealth(req.agentEmpresaId)
  res.json(health)
})

// POST /impresion/drawer — abrir cajón de dinero manualmente (frontend, requireAuth).
const abrirCajon = wrap(async (req, res) => {
  const empresaId = req.usuario.empresaId
  const payload = JSON.stringify({ tipo: 'CAJON', abrirCajon: true })
  const idKey = `CAJON:${empresaId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "PrintJob" ("empresaId", "idempotencyKey", "tipo", "modo", "queueName", "payload", "creadoEn")
     VALUES ($1, $2, 'VENTA', 'ORIGINAL', $3, $4::jsonb, NOW()) RETURNING id`,
    empresaId, idKey, service.DEFAULT_QUEUE, payload
  )
  res.json({ ok: true, printJobId: Number(rows[0].id) })
})

module.exports = {
  requireAgentAuth,
  encolarManual,
  consultarEstado,
  listarJobs,
  agentNext,
  agentSuccess,
  agentFail,
  agentReset,
  agentHealth,
  abrirCajon
}
