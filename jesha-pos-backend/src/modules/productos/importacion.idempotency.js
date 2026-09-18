'use strict'

const crypto = require('crypto')

const MIN_KEY_LENGTH = 36
const MAX_KEY_LENGTH = 64
const LEASE_DURATION_MS = 5 * 60 * 1000
const LEASE_STALE_MS = 10 * 60 * 1000
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{36,64}$/

const IMPORT_STATE = Object.freeze({
  PROCESSING: 'PROCESANDO',
  COMPLETED: 'COMPLETADA',
  FAILED: 'FALLIDA',
})

const BEGIN_RESULT = Object.freeze({
  ACQUIRED: 'ACQUIRED',
  CONFLICT: 'CONFLICT',
  REPLAY: 'REPLAY',
  IN_PROGRESS: 'IN_PROGRESS',
})

const DECIMAL_SCALES = Object.freeze({
  precioBase: 2,
  precioVenta: 2,
  costo: 2,
  stockInicial: 3,
  _stockInicial: 3,
  stockMinimo: 3,
  _stockMinimo: 3,
  stockMaximo: 3,
  _stockMaximo: 3,
  precioCostoProveedor: 2,
  factorConversion: 4,
})

/**
 * Validates an optional Idempotency-Key header without conflating absence and
 * an explicitly empty value.
 */
function validateIdempotencyKey(value) {
  if (value === undefined || value === null) {
    return { valid: false, missing: true, status: null, error: null }
  }

  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    return {
      valid: false,
      missing: false,
      status: 400,
      error: `La clave de idempotencia debe contener entre ${MIN_KEY_LENGTH} y ${MAX_KEY_LENGTH} caracteres [A-Za-z0-9._:-].`,
    }
  }

  return { valid: true, missing: false, key: value }
}

function powerOfTen(exponent) {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > 10000) {
    throw new RangeError('La escala decimal está fuera del rango permitido.')
  }
  return 10n ** BigInt(exponent)
}

/**
 * Converts a string or finite number to a fixed-scale decimal string using
 * exact digit arithmetic and half-away-from-zero rounding. It never converts
 * the decimal back to Number. Invalid values return null.
 */
function canonicalizeDecimal(value, scale) {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 10000) {
    throw new RangeError('La escala decimal debe ser un entero entre 0 y 10000.')
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'number' && !Number.isFinite(value)) return null

  const source = typeof value === 'number' ? String(value) : value.trim()
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source)
  if (!match) return null

  const sign = match[1] === '-' ? -1n : 1n
  const integerDigits = match[2] || '0'
  const fractionDigits = match[3] !== undefined ? match[3] : (match[4] || '')
  const exponent = Number(match[5] || 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) return null

  const digits = `${integerDigits}${fractionDigits}`.replace(/^0+(?=\d)/, '')
  let coefficient = BigInt(digits || '0')
  const sourceScale = fractionDigits.length - exponent
  const scaleDifference = sourceScale - scale

  if (scaleDifference > 0) {
    const divisor = powerOfTen(scaleDifference)
    const remainder = coefficient % divisor
    coefficient /= divisor
    if (remainder * 2n >= divisor) coefficient += 1n
  } else if (scaleDifference < 0) {
    coefficient *= powerOfTen(-scaleDifference)
  }

  coefficient *= sign
  if (coefficient === 0n) coefficient = 0n

  const negative = coefficient < 0n
  const absoluteDigits = (negative ? -coefficient : coefficient).toString()
  if (scale === 0) return `${negative ? '-' : ''}${absoluteDigits}`

  const padded = absoluteDigits.padStart(scale + 1, '0')
  const splitAt = padded.length - scale
  return `${negative ? '-' : ''}${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`
}

// Kept as the concise public name used by existing import mapping code.
const normalizeDecimal = canonicalizeDecimal

/** Canonicalizes a monetary value to two decimal places. */
function canonicalizeMoney(value) {
  return canonicalizeDecimal(value, 2)
}

/** Canonicalizes a stock value to three decimal places. */
function canonicalizeStock(value) {
  return canonicalizeDecimal(value, 3)
}

/**
 * Canonicalizes known decimal properties while retaining every business field
 * supplied by the caller. Property order is normalized when serialized.
 */
function canonicalizeImportRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError('Cada fila canónica debe ser un objeto.')
  }

  const canonical = { ...row }
  for (const [field, scale] of Object.entries(DECIMAL_SCALES)) {
    if (Object.prototype.hasOwnProperty.call(canonical, field)) {
      canonical[field] = canonicalizeDecimal(canonical[field], scale)
    }
  }
  return canonical
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableJsonValue(item))
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const result = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = stableJsonValue(value[key])
    }
    return result
  }
  return value
}

/**
 * Returns the SHA-256 fingerprint of { empresaId, sucursalId, tipo, filas }.
 * Row order is significant; all fields present in each row are retained.
 */
function computeImportFingerprint({ empresaId, sucursalId, tipo, filas }) {
  if (!Array.isArray(filas)) throw new TypeError('filas debe ser un arreglo.')

  const payload = {
    empresaId,
    sucursalId: sucursalId ?? null,
    tipo,
    filas: filas.map(canonicalizeImportRow),
  }
  const fingerprintString = JSON.stringify(stableJsonValue(payload))
  const fingerprintHash = crypto.createHash('sha256').update(fingerprintString, 'utf8').digest('hex')
  return { fingerprintString, fingerprintHash }
}

function leaseWindow(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('leaseDurationMs debe ser un número positivo.')
  }
  const now = new Date()
  return { now, expiresAt: new Date(now.getTime() + durationMs) }
}

function acquiredResult(header, leaseToken, created) {
  return {
    kind: BEGIN_RESULT.ACQUIRED,
    acquired: true,
    created,
    importacionId: header.id,
    leaseToken,
    header,
  }
}

function classifyExistingHeader(header, fingerprintHash, now) {
  if (header.fingerprintHash !== fingerprintHash) {
    return {
      kind: BEGIN_RESULT.CONFLICT,
      acquired: false,
      importacionId: header.id,
      error: 'IDEMPOTENCY_KEY_REUSED',
    }
  }

  if (header.estado === IMPORT_STATE.COMPLETED || header.estado === IMPORT_STATE.FAILED) {
    return {
      kind: BEGIN_RESULT.REPLAY,
      acquired: false,
      importacionId: header.id,
      estado: header.estado,
      respuesta: header.respuesta,
      header,
    }
  }

  if (header.estado !== IMPORT_STATE.PROCESSING) {
    throw new Error(`Estado de importación desconocido: ${header.estado}`)
  }

  if (header.leaseExpiresAt && header.leaseExpiresAt > now) {
    return {
      kind: BEGIN_RESULT.IN_PROGRESS,
      acquired: false,
      importacionId: header.id,
      leaseExpiresAt: header.leaseExpiresAt,
      header,
    }
  }

  return null
}

/**
 * Creates an import command header or resolves the concurrent winner after
 * P2002. A stale/null processing lease is taken over atomically on that same
 * tenant-scoped header; terminal states replay their persisted response.
 */
async function beginImportCommand(db, {
  empresaId,
  usuarioId = null,
  sucursalId = null,
  claveIdempotencia,
  fingerprintHash,
  tipo,
  totalFilas,
  leaseToken = crypto.randomUUID(),
  leaseDurationMs = LEASE_DURATION_MS,
}) {
  const keyValidation = validateIdempotencyKey(claveIdempotencia)
  if (!keyValidation.valid) {
    throw new TypeError(keyValidation.missing ? 'claveIdempotencia es obligatoria.' : keyValidation.error)
  }
  if (!/^[a-f0-9]{64}$/i.test(fingerprintHash || '')) {
    throw new TypeError('fingerprintHash debe ser un SHA-256 hexadecimal.')
  }

  const { expiresAt } = leaseWindow(leaseDurationMs)
  try {
    const header = await db.importacionProductos.create({
      data: {
        empresaId,
        usuarioId,
        sucursalId,
        claveIdempotencia: keyValidation.key,
        fingerprintHash: fingerprintHash.toLowerCase(),
        tipo,
        totalFilas,
        estado: IMPORT_STATE.PROCESSING,
        leaseToken,
        leaseExpiresAt: expiresAt,
      },
    })
    return acquiredResult(header, leaseToken, true)
  } catch (error) {
    if (error?.code !== 'P2002') throw error
  }

  // A concurrent insert that caused P2002 is committed before it can win the
  // unique constraint. Re-read and resolve its current state.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const header = await db.importacionProductos.findFirst({
      where: { empresaId, claveIdempotencia: keyValidation.key },
    })
    if (!header) continue

    const { now, expiresAt: takeoverExpiresAt } = leaseWindow(leaseDurationMs)
    const classified = classifyExistingHeader(header, fingerprintHash.toLowerCase(), now)
    if (classified) return classified

    const takeover = await db.importacionProductos.updateMany({
      where: {
        id: header.id,
        empresaId,
        claveIdempotencia: keyValidation.key,
        fingerprintHash: fingerprintHash.toLowerCase(),
        estado: IMPORT_STATE.PROCESSING,
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: { leaseToken, leaseExpiresAt: takeoverExpiresAt },
    })

    if (takeover.count === 1) {
      const ownedHeader = await db.importacionProductos.findFirst({
        where: { id: header.id, empresaId, leaseToken },
      })
      return acquiredResult(ownedHeader || { ...header, leaseToken, leaseExpiresAt: takeoverExpiresAt }, leaseToken, false)
    }
  }

  const winner = await db.importacionProductos.findFirst({
    where: { empresaId, claveIdempotencia: keyValidation.key },
  })
  if (!winner) throw new Error('No fue posible releer el header ganador de idempotencia.')
  return classifyExistingHeader(winner, fingerprintHash.toLowerCase(), new Date()) || {
    kind: BEGIN_RESULT.IN_PROGRESS,
    acquired: false,
    importacionId: winner.id,
    leaseExpiresAt: winner.leaseExpiresAt,
    header: winner,
  }
}

/**
 * Acquires a processing lease when it is unowned, expired, or already belongs
 * to the same token. Pass empresaId to additionally enforce tenant scope.
 */
async function acquireLease(db, importacionId, leaseToken, durationMs = LEASE_DURATION_MS, empresaId) {
  const { now, expiresAt } = leaseWindow(durationMs)
  const updated = await db.importacionProductos.updateMany({
    where: {
      id: importacionId,
      ...(empresaId === undefined ? {} : { empresaId }),
      estado: IMPORT_STATE.PROCESSING,
      OR: [
        { leaseToken },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
    },
    data: { leaseToken, leaseExpiresAt: expiresAt },
  })
  return updated.count === 1
}

/** Renews only a currently owned processing lease. */
async function renewLease(db, importacionId, leaseToken, durationMs = LEASE_DURATION_MS) {
  const { expiresAt } = leaseWindow(durationMs)
  const updated = await db.importacionProductos.updateMany({
    where: { id: importacionId, leaseToken, estado: IMPORT_STATE.PROCESSING },
    data: { leaseExpiresAt: expiresAt },
  })
  return updated.count === 1
}

/** Aggregates every persisted result counter from detail rows. */
async function aggregateFromDetails(db, importacionId) {
  const rows = await db.$queryRawUnsafe(
    `SELECT
       COUNT(*) AS "filasProcesadas",
       COUNT(*) FILTER (WHERE "accion" = 'CREADO') AS "creados",
       COUNT(*) FILTER (WHERE "accion" = 'ACTUALIZADO') AS "actualizados",
       COALESCE(SUM("vinculaciones"), 0) AS "vinculaciones",
       COUNT(*) FILTER (WHERE "accion" = 'OMITIDO') AS "omitidos",
       COUNT(*) FILTER (WHERE "accion" = 'ERROR') AS "errores",
       COUNT(*) FILTER (WHERE "advertencia" IS NOT NULL) AS "advertencias"
     FROM "ImportacionProductosDetalle"
     WHERE "importacionId" = $1`,
    importacionId
  )
  const row = rows[0] || {}
  const count = (field) => Number(row[field] || 0)
  return {
    filasProcesadas: count('filasProcesadas'),
    creados: count('creados'),
    actualizados: count('actualizados'),
    vinculaciones: count('vinculaciones'),
    omitidos: count('omitidos'),
    errores: count('errores'),
    advertencias: count('advertencias'),
  }
}

function normalizeCounters(counts = {}) {
  const names = ['filasProcesadas', 'creados', 'actualizados', 'vinculaciones', 'omitidos', 'errores', 'advertencias']
  return Object.fromEntries(names.map((name) => {
    const value = counts[name] ?? 0
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} debe ser un entero no negativo.`)
    }
    return [name, value]
  }))
}

function leaseLostError(importacionId) {
  const error = new Error(`Lease perdido para la importación ${importacionId}.`)
  error.code = 'IMPORT_LEASE_LOST'
  return error
}

async function writeTerminalState(db, { importacionId, leaseToken, respuesta, counts, estado }) {
  if (!leaseToken) throw new TypeError('leaseToken es obligatorio para finalizar una importación.')
  const counters = normalizeCounters(counts)
  const updated = await db.importacionProductos.updateMany({
    where: {
      id: importacionId,
      leaseToken,
      estado: IMPORT_STATE.PROCESSING,
    },
    data: {
      estado,
      respuesta,
      leaseExpiresAt: null,
      ...counters,
    },
  })
  if (updated.count !== 1) throw leaseLostError(importacionId)
  return { estado, respuesta, ...counters }
}

/** Finalizes an owned processing command as COMPLETADA. */
async function finalizeImport(db, options) {
  return writeTerminalState(db, { ...options, estado: IMPORT_STATE.COMPLETED })
}

/** Finalizes an owned processing command as FALLIDA. */
async function failImport(db, options) {
  return writeTerminalState(db, { ...options, estado: IMPORT_STATE.FAILED })
}

/**
 * Compatibility name with the safe signature
 * (db, importacionId, leaseToken, counts, respuesta).
 */
async function persistResponseSnapshot(db, importacionId, leaseToken, counts, respuesta) {
  return finalizeImport(db, { importacionId, leaseToken, counts, respuesta })
}

module.exports = {
  MIN_KEY_LENGTH,
  MAX_KEY_LENGTH,
  LEASE_DURATION_MS,
  LEASE_STALE_MS,
  IDEMPOTENCY_KEY_PATTERN,
  IMPORT_STATE,
  BEGIN_RESULT,
  DECIMAL_SCALES,
  validateIdempotencyKey,
  canonicalizeDecimal,
  normalizeDecimal,
  canonicalizeMoney,
  canonicalizeStock,
  canonicalizeImportRow,
  computeImportFingerprint,
  beginImportCommand,
  acquireLease,
  renewLease,
  aggregateFromDetails,
  finalizeImport,
  failImport,
  persistResponseSnapshot,
}
