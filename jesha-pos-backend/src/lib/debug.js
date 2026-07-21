const { monitorEventLoopDelay } = require('perf_hooks')
const crypto = require('crypto')

// ── Activation ──
const isEnabled = () => process.env.DEBUG_INCIDENT_WINDOW === 'true'

// ── Private counters ──
let _activeHttpRequests = 0
let _activeFacturapiCalls = 0
let _histogram = null

function incrementHttpRequests() { _activeHttpRequests++ }
function decrementHttpRequests() { if (_activeHttpRequests > 0) _activeHttpRequests-- }
function incrementFacturapiCalls() { _activeFacturapiCalls++ }
function decrementFacturapiCalls() { if (_activeFacturapiCalls > 0) _activeFacturapiCalls-- }
function getActiveHttpRequests() { return _activeHttpRequests }
function getActiveFacturapiCalls() { return _activeFacturapiCalls }
function getConcurrencyMetrics() {
  return {
    activeHttpRequests: _activeHttpRequests,
    activeFacturapiCalls: _activeFacturapiCalls,
  }
}

// ── Auth 401 counters ──
const VALID_401_REASONS = ['missing', 'expired', 'invalid', 'malformed', 'unknown']
let _authCounters = { missing: 0, expired: 0, invalid: 0, malformed: 0, unknown: 0 }
let _authSamples = { missing: [], expired: [], invalid: [], malformed: [], unknown: [] }

function recordAuth401(reason, path) {
  const key = VALID_401_REASONS.includes(reason) ? reason : 'unknown'
  _authCounters[key]++
  if (_authSamples[key].length < 3) {
    _authSamples[key].push(String(path || '').split('?')[0])
  }
}

function flushAuthSummary() {
  const total = Object.values(_authCounters).reduce((a, b) => a + b, 0)
  if (total === 0) return
  logJSON({
    event: 'auth_401_summary',
    ..._authCounters,
    samples: _authSamples,
    ...buildBase(),
  })
  _authCounters = { missing: 0, expired: 0, invalid: 0, malformed: 0, unknown: 0 }
  _authSamples = { missing: [], expired: [], invalid: [], malformed: [], unknown: [] }
}

// ── Timestamps ──
function buildBase() {
  const now = new Date()
  return {
    timestampUtc: now.toISOString(),
    timestampLocal: now.toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).replace('T', ' '),
    timeZone: 'America/Mexico_City',
    uptimeSec: Math.floor(process.uptime()),
  }
}

// ── Logging ──
function logJSON(obj) {
  console.log(JSON.stringify(obj))
}

// ── Safe error sanitization ──
function safeError(err) {
  if (!err) return null
  const type = err.constructor?.name || typeof err
  const msg = String(err.message || err).replace(/\s+/g, ' ').trim().slice(0, 200)
  const sanitized = msg
    .replace(/[a-zA-Z][\w+.-]*:\/\/[^\s<>"']+/g, '<URL>')
    .replace(/Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/gi, 'Bearer <TOKEN>')
  return { type, message: sanitized }
}

function safeStack(err) {
  if (!err?.stack) return undefined
  return err.stack
    .split('\n')
    .slice(0, 5)
    .map(line => line
      .replace(/[a-zA-Z][\w+.-]*:\/\/[^\s<>"']+/g, '<URL>')
      .replace(/[:\d]{4,5}\)?$/g, '')
    )
    .join('\n')
}

// ── Pool metrics ──
function getPoolMetrics(pool) {
  if (!pool || typeof pool.totalCount !== 'number') {
    return { total: -1, idle: -1, waiting: -1 }
  }
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  }
}

// ── Memory metrics ──
function getMemMetrics() {
  const mem = process.memoryUsage()
  return {
    rssMB: Math.round(mem.rss / 1024 / 1024),
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    externalMB: Math.round(mem.external / 1024 / 1024),
  }
}

// ── Event loop lag ──
function initHistogram() {
  const h = monitorEventLoopDelay({ resolution: 10 })
  h.enable()
  _histogram = h
  return h
}

function getEventLoopLag(histogram) {
  const h = histogram || _histogram
  if (!h) return { meanMs: 0, maxMs: 0, p99Ms: 0 }

  const sanitize = (v) => Number.isFinite(v) ? v : 0

  const lag = {
    meanMs: parseFloat((sanitize(h.mean) / 1e6).toFixed(2)),
    maxMs: parseFloat((sanitize(h.max) / 1e6).toFixed(2)),
    p99Ms: parseFloat((sanitize(h.percentile(99)) / 1e6).toFixed(2)),
  }

  h.reset()
  return lag
}

// ── Request ID ──
function makeRequestId() {
  return crypto.randomUUID()
}

// ── Route normalization ──
function normalizeRoute(req) {
  const base = req.baseUrl || ''
  const route = req.route?.path || req.path || ''
  const full = base + route
  return full.replace(/\/\d+/g, '/:id')
}

// ── Facturapi wrapper ──
async function trackFacturapi(operation, metadata, fn) {
  if (!isEnabled()) return fn()

  const start = Date.now()
  incrementFacturapiCalls()

  try {
    const result = await fn()
    logJSON({
      event: 'facturapi',
      operation,
      ...metadata,
      durationMs: Date.now() - start,
      success: true,
      activeBeforeFinish: _activeFacturapiCalls - 1,
      ...buildBase(),
    })
    return result
  } catch (error) {
    logJSON({
      event: 'facturapi',
      operation,
      ...metadata,
      durationMs: Date.now() - start,
      success: false,
      error: safeError(error),
      activeBeforeFinish: _activeFacturapiCalls - 1,
      ...buildBase(),
    })
    throw error
  } finally {
    decrementFacturapiCalls()
  }
}

module.exports = {
  isEnabled,
  incrementHttpRequests,
  decrementHttpRequests,
  incrementFacturapiCalls,
  decrementFacturapiCalls,
  getActiveHttpRequests,
  getActiveFacturapiCalls,
  getConcurrencyMetrics,
  recordAuth401,
  flushAuthSummary,
  buildBase,
  logJSON,
  safeError,
  safeStack,
  getPoolMetrics,
  getMemMetrics,
  initHistogram,
  getEventLoopLag,
  makeRequestId,
  normalizeRoute,
  trackFacturapi,
}
