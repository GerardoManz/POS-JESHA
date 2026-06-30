// src/modules/impresion/impresion.service.js
// Cola de impresión basada en la tabla PrintJob (sin pg-boss).
// El backend NO arma ESC/POS: solo persiste payload y administra estados.
const prisma = require('../../lib/prisma')

const DEFAULT_QUEUE = 'printer-principal'
const MAX_INTENTOS = 3
const STALE_MS = 5 * 60 * 1000 // 5 min — red de seguridad del reaper

// idempotencyKey determinista por entidad. Una sola constraint @unique.
function buildIdempotencyKey({ tipo, modo, empresaId, entidadId, copiaNum }) {
  if (modo === 'COPIA') {
    const n = String(copiaNum || 1).padStart(3, '0')
    return `${tipo}:COPIA:${empresaId}:${entidadId}:copia-${n}`
  }
  return `${tipo}:ORIGINAL:${empresaId}:${entidadId}`
}

// Encola un trabajo. Acepta `client` para usar el MISMO tx de la venta (atómico).
// Solo persiste payload (JSON puro) — sin red ni sharp dentro del tx.
// Si la idempotencyKey ya existe lanza P2002; el caller decide (409).
async function encolarImpresion(client, {
  empresaId, tipo, modo = 'ORIGINAL', entidadId,
  ventaId = null, turnoId = null, abonoId = null, retiroId = null,
  payload, queueName = DEFAULT_QUEUE
}) {
  const idempotencyKey = buildIdempotencyKey({
    tipo, modo, empresaId, entidadId, copiaNum: payload && payload.copiaNum
  })
  return client.printJob.create({
    data: {
      empresaId, idempotencyKey, tipo, modo,
      ventaId, turnoId, abonoId, retiroId,
      queueName, payload
    }
  })
}

// Reclama el siguiente trabajo PENDIENTE para una empresa.
// SKIP LOCKED dentro de una sola conexión ($transaction).
// Único lugar donde `intentos` se incrementa (fix T1).
// Scoped por empresaId (fix T2-Scope).
async function claimNextJob({ empresaId, queueName = DEFAULT_QUEUE }) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT id FROM "PrintJob"
        WHERE "empresaId" = $1
          AND "queueName" = $2
          AND estado = 'PENDIENTE'::"PrintJobEstado"
        ORDER BY "creadoEn" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      empresaId, queueName
    )
    if (!rows || rows.length === 0) return null
    const id = Number(rows[0].id)
    return tx.printJob.update({
      where: { id },
      data: {
        estado: 'EN_PROCESO',
        intentos: { increment: 1 },
        ultimoIntentoEn: new Date()
      }
    })
  })
}

// Éxito: tope ENVIADO_A_IMPRESORA (sin confirmación de hardware, no "IMPRESO").
async function markSuccess(id) {
  return prisma.printJob.update({
    where: { id: Number(id) },
    data: { estado: 'ENVIADO_A_IMPRESORA', enviadoEn: new Date() }
  })
}

// Fallo: NO incrementa (ya se incrementó en el claim — fix T1).
// Decide según el valor actual: >= MAX -> FALLIDO terminal; si no -> PENDIENTE.
async function markFailure(id, errorMsg) {
  const job = await prisma.printJob.findUnique({ where: { id: Number(id) } })
  if (!job) return null
  const estado = job.intentos >= MAX_INTENTOS ? 'FALLIDO' : 'PENDIENTE'
  return prisma.printJob.update({
    where: { id: job.id },
    data: { estado, error: errorMsg || null }
  })
}

// Reset al arrancar el agente: con 1 agente, todo EN_PROCESO es huérfano.
// Scoped por empresaId (fix T2-Scope).
async function resetStaleForEmpresa(empresaId) {
  const res = await prisma.printJob.updateMany({
    where: { empresaId, estado: 'EN_PROCESO' },
    data: { estado: 'PENDIENTE' }
  })
  return res.count
}

// Reaper de respaldo (corre en server.js). Barrido por antigüedad.
async function cleanupStaleJobs() {
  const res = await prisma.printJob.updateMany({
    where: {
      estado: 'EN_PROCESO',
      ultimoIntentoEn: { lt: new Date(Date.now() - STALE_MS) }
    },
    data: { estado: 'PENDIENTE' }
  })
  return res.count
}

// Consulta de estado para el frontend. findFirst scoped -> null si no es de la
// empresa, para que el controller responda 404 (regla multi-tenant).
async function getJob(id, empresaId) {
  return prisma.printJob.findFirst({ where: { id: Number(id), empresaId } })
}

async function listJobs(empresaId, { estado, take = 50 } = {}) {
  return prisma.printJob.findMany({
    where: { empresaId, ...(estado ? { estado } : {}) },
    orderBy: { creadoEn: 'desc' },
    take: Number(take) || 50
  })
}

module.exports = {
  DEFAULT_QUEUE,
  MAX_INTENTOS,
  buildIdempotencyKey,
  encolarImpresion,
  claimNextJob,
  markSuccess,
  markFailure,
  resetStaleForEmpresa,
  cleanupStaleJobs,
  getJob,
  listJobs
}