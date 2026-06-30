// src/modules/impresion/impresion.controller.js
const crypto = require('crypto')
const prisma = require('../../lib/prisma')
const service = require('./impresion.service')

// Mapea tipo -> nombre de campo de entidad en PrintJob.
const CAMPO_ENTIDAD = { VENTA: 'ventaId', CORTE: 'turnoId', ABONO: 'abonoId', RETIRO: 'retiroId' }

// Envuelve handlers async para capturar throws no manejados.
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  if (err && err.code === 'P2002') {
    return res.status(409).json({ error: 'Recurso duplicado' })
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

// POST /impresion/job — reimpresión manual (COPIA).
// Reusa el snapshot inmutable del trabajo más reciente de la entidad (D5).
const encolarManual = wrap(async (req, res) => {
  const empresaId = req.usuario.empresaId
  const { tipo } = req.body
  const campo = CAMPO_ENTIDAD[tipo]
  if (!campo) return res.status(400).json({ error: 'tipo inválido' })

  const entidadId = parseInt(req.body[campo], 10)
  if (!entidadId) return res.status(400).json({ error: `${campo} requerido` })

  const idFilter = { [campo]: entidadId }

  const base = await prisma.printJob.findFirst({
    where: { empresaId, tipo, ...idFilter },
    orderBy: { creadoEn: 'desc' }
  })
  if (!base) {
    return res.status(409).json({
      error: 'No hay ticket original en el sistema para reimprimir.'
    })
  }

  const copiasPrevias = await prisma.printJob.count({
    where: { empresaId, tipo, modo: 'COPIA', ...idFilter }
  })
  const copiaNum = copiasPrevias + 1

  const payload = { ...(base.payload || {}), abrirCajon: false, copia: true, copiaNum }

  const job = await service.encolarImpresion(prisma, {
    empresaId, tipo, modo: 'COPIA', entidadId,
    ventaId: tipo === 'VENTA' ? entidadId : null,
    turnoId: tipo === 'CORTE' ? entidadId : null,
    abonoId: tipo === 'ABONO' ? entidadId : null,
    retiroId: tipo === 'RETIRO' ? entidadId : null,
    payload
  })
  res.json({ ok: true, printJobId: job.id, copiaNum })
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

module.exports = {
  requireAgentAuth,
  encolarManual,
  consultarEstado,
  listarJobs,
  agentNext,
  agentSuccess,
  agentFail,
  agentReset
}
