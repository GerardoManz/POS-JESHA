// ════════════════════════════════════════════════════════════════════
//  LIB/FACTURAPI.JS
//  src/lib/facturapi.js
//
//  P1 — Infraestructura fiscal MULTI-TENANT. Cada Empresa tiene su propia
//  Organization + Test/Live Key en Facturapi (ver ConfiguracionFiscal).
//
//  Clientes que se resuelven aquí:
//    FACTURAPI_USER_KEY        = User Key (sk_user_...) — server-only.
//                                Crea Organizations y administra keys de la
//                                cuenta Facturapi. NUNCA se guarda en BD.
//    getFacturapiForEmpresa()  = cliente de la Organization de UNA Empresa,
//                                construido con su key propia (cifrada en BD).
//
//  Legado (LEGACY_SINGLE_ISSUER, NO usar en flujos nuevos):
//    FACTURAPI_KEY / FACTURAPI_KEY_TEST + getFacturapi() = emisor global único
//    (JESHA). Se conserva para compatibilidad/migración; los flujos fiscales
//    multi-tenant jamás caen a esta key.
//
//  Reglas de seguridad:
//   - El modo se determina EXCLUSIVAMENTE por FACTURAPI_MODE ('test'|'live').
//   - Si FACTURAPI_MODE falta o es inválido: default = 'test' (fail-safe).
//   - NUNCA se infiere LIVE desde NODE_ENV, RENDER, hostname u otra variable.
//   - LIVE requiere opt-in explícito: FACTURAPI_MODE=live.
//   - FAIL-CLOSED: si una Empresa no tiene ConfiguracionFiscal (o no tiene key
//     para el modo activo) se lanza FiscalError 409. JAMÁS fallback a la key
//     global de JESHA. "Una factura de Pedregal jamás usa la llave de JESHA."
//   - Coherencia modo↔prefijo de la key: si no coinciden, ABORTA.
//   - La cache de clientes es POR Empresa+modo; nunca se comparte una instancia
//     de Facturapi entre Empresas.
// ════════════════════════════════════════════════════════════════════

'use strict'

const prisma = require('./prisma')
const { cifrarSecreto, descifrarSecreto } = require('./fiscal-secrets')

let _facturapi = null
let _logged = false
let _factory = null

// Errores funcionales que los controllers deben traducir a HTTP 409 (o el
// código que corresponda). `expose` permite que el error handler de app.js lo
// devuelva con su mensaje sin volcarlo a 500.
class FiscalError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'FiscalError'
    this.status = status
    this.code = code
    this.expose = true
  }
}

// Modo a partir del prefijo de la key.
function detectarModo(key) {
  if (!key) return null
  if (key.startsWith('sk_test')) return 'TEST'
  if (key.startsWith('sk_live')) return 'LIVE'
  if (key.startsWith('sk_user')) return 'USER'
  return 'DESCONOCIDO'
}

// Determina si el entorno es producción (para logging, no para modo fiscal).
function esProduccion() {
  return process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'
}

// Modo activo — EXCLUSIVAMENTE por FACTURAPI_MODE.
// En producción (NODE_ENV=production o RENDER=true): SIEMPRE 'live'.
// Fuera de producción: FACTURAPI_MODE ('test'|'live'); default 'test'.
// Regla: producción NUNCA puede caer silenciosamente a test.
function modoActivo() {
  if (esProduccion()) return 'live'
  const m = (process.env.FACTURAPI_MODE || 'test').trim().toLowerCase()
  return m === 'live' ? 'live' : 'test'
}

// Key activa según el modo (convención fija de los nombres de variable).
function keyActiva() {
  return modoActivo() === 'live'
    ? process.env.FACTURAPI_KEY
    : process.env.FACTURAPI_KEY_TEST
}

// Valida coherencia modo↔key. Llamar al arrancar (app.js) para fail-fast.
// Sin key configurada para el modo no es error fatal: Facturapi queda desactivado.
function assertFacturapiSeguro() {
  const modo = modoActivo()
  const key = keyActiva()
  const userKey = process.env.FACTURAPI_USER_KEY
  if (userKey && detectarModo(userKey) !== 'USER') {
    throw new Error('FACTURAPI_USER_KEY debe ser una User Key (prefijo sk_user_)')
  }
  if (!key) return
  const prefijo = detectarModo(key)
  const esperado = modo === 'live' ? 'LIVE' : 'TEST'
  if (prefijo !== esperado) {
    const cual = modo === 'live' ? 'FACTURAPI_KEY' : 'FACTURAPI_KEY_TEST'
    throw new Error(
      `Modo Facturapi '${modo}' pero ${cual} es una key ${prefijo}. ` +
      'Convención: FACTURAPI_KEY = sk_live..., FACTURAPI_KEY_TEST = sk_test...'
    )
  }
}

// Fábrica de clientes. Inyectable para tests (nunca hacer llamadas reales).
function _buildClient(key, meta) {
  if (_factory) return _factory(key, meta)
  const Facturapi = require('facturapi').default
  return new Facturapi(key)
}

// Reemplaza la fábrica (tests) y limpia caches. `null` restaura el SDK real.
function setFacturapiFactory(fn) {
  _factory = fn || null
  _facturapi = null
  _porEmpresa.clear()
}

function resetFacturapiCache() {
  _facturapi = null
  _porEmpresa.clear()
}

// Devuelve la instancia de Facturapi LEGACY (emisor global único), o null si no
// hay key para el modo activo. LEGACY_SINGLE_ISSUER — NO usar en flujos nuevos.
function getFacturapi() {
  if (_facturapi) return _facturapi

  const modo = modoActivo()
  const key = keyActiva()

  if (!key) {
    if (!_logged) {
      const cual = modo === 'live' ? 'FACTURAPI_KEY' : 'FACTURAPI_KEY_TEST'
      console.warn(`⚠️  ${cual} no configurada (modo ${modo}) — Facturapi desactivado`)
      _logged = true
    }
    return null
  }

  // Coherencia modo↔key antes de instanciar.
  assertFacturapiSeguro()

  if (!_logged) {
    console.log(`🧾 Facturapi en modo ${modo.toUpperCase()}${modo === 'test' ? ' (sandbox)' : ''}`)
    _logged = true
  }

  _facturapi = _buildClient(key, { rol: 'legacy', modo })
  return _facturapi
}

// ── Cache de clientes POR EMPRESA+modo ──
const _porEmpresa = new Map()

// FAIL-CLOSED (P1): verifica que la Empresa tiene ConfiguracionFiscal y key para
// el modo activo. Lanza FiscalError 409 si falta — los controllers responden el
// código antes de crear PENDIENTE / tomar lock. Nunca cae a la key global.
async function verificarFacturacionEmpresa(empresaId, { modo } = {}) {
  const config = await prisma.configuracionFiscal.findUnique({ where: { empresaId } })
  if (!config || !config.facturapiOrganizationId) {
    throw new FiscalError(
      409,
      'FISCAL_CONFIG_NOT_READY',
      'La facturación de esta empresa no está configurada. No se puede timbrar.'
    )
  }
  const m = modo || modoActivo()
  const enc = m === 'live' ? config.facturapiLiveKeyEnc : config.facturapiTestKeyEnc
  if (!enc) {
    const code = m === 'live' ? 'FACTURAPI_LIVE_KEY_MISSING' : 'FACTURAPI_TEST_KEY_MISSING'
    const msg = m === 'live'
      ? 'La empresa no tiene credencial de producción (live key). Crea la live key en Configuración Fiscal antes de facturar.'
      : `La empresa no tiene key de Facturapi para el modo ${m}.`
    throw new FiscalError(409, code, msg)
  }
  return { config, modo: m }
}

// Cliente Facturapi de la Organization PROPIa de la Empresa. La key se descifra
// de ConfiguracionFiscal en memoria; nunca se cachea la key en claro.
async function getFacturapiForEmpresa(empresaId, { modo } = {}) {
  const cacheKey = `${empresaId}:${modo || modoActivo()}`
  if (_porEmpresa.has(cacheKey)) return _porEmpresa.get(cacheKey)

  const { config, modo: m } = await verificarFacturacionEmpresa(empresaId, { modo })
  const enc = m === 'live' ? config.facturapiLiveKeyEnc : config.facturapiTestKeyEnc
  const key = descifrarSecreto(enc)

  const prefijo = detectarModo(key)
  const esperado = m === 'live' ? 'LIVE' : 'TEST'
  if (prefijo !== esperado) {
    throw new FiscalError(
      409,
      'FACTURAPI_EMPRESA_KEY_MODO_INVALIDO',
      `La key de Facturapi de la empresa no corresponde al modo ${m}.`
    )
  }

  const cliente = _buildClient(key, { rol: 'empresa', empresaId, modo: m, organizationId: config.facturapiOrganizationId })
  _porEmpresa.set(cacheKey, cliente)
  return cliente
}

// Cliente con la User Key (server-only). Retorna null si no está configurada.
// Usado para crear Organizations y administrar keys. Nunca se persiste.
function getFacturapiUser() {
  const userKey = process.env.FACTURAPI_USER_KEY
  if (!userKey) return null
  if (detectarModo(userKey) !== 'USER') {
    throw new Error('FACTURAPI_USER_KEY debe ser una User Key (prefijo sk_user_)')
  }
  return _buildClient(userKey, { rol: 'user' })
}

// Guard post-create: verifica que la respuesta de Facturapi sea consistente
// con el modo activo. En producción, si la factura resulta ser de test,
// RECHAZA el timbrado (nunca marcar TIMBRADA con un CFDI sin validez fiscal).
function assertLivemodeConsistente(invoice, { facturaId } = {}) {
  const modo = modoActivo()
  if (invoice == null || typeof invoice !== 'object') return
  const livemode = invoice.livemode
  if (typeof livemode !== 'boolean') return

  if (modo === 'live' && livemode === false) {
    console.error(`🔴 FACTURAPI_TEST_MODE_BLOCKED: factura ${facturaId || '?'}, livemode=${livemode}, modo=${modo}`)
    throw new FiscalError(
      422,
      'FACTURAPI_TEST_MODE_BLOCKED',
      'Facturapi respondió en modo de pruebas (test). La factura NO tiene validez fiscal. Timbrado bloqueado.'
    )
  }

  if (modo === 'test' && livemode === true) {
    console.warn(`⚠️  Facturapi live invoice created in test mode: factura ${facturaId || '?'}`)
  }
}

// Persiste la live key desde la variable de entorno FACTURAPI_KEY en
// ConfiguracionFiscal de la empresa. Usar solo cuando:
//   1. La empresa ya tiene facturapiOrganizationId
//   2. facturapiLiveKeyEnc es NULL
//   3. FACTURAPI_KEY existe en el entorno y es una sk_live_*
// Retorna { persistida: true } o lanza error.
async function persistirLiveKeyDeEntorno(empresaId) {
  const liveKeyEnv = process.env.FACTURAPI_KEY
  if (!liveKeyEnv || typeof liveKeyEnv !== 'string' || !liveKeyEnv.trim()) {
    throw new FiscalError(409, 'FACTURAPI_LIVE_KEY_ENV_MISSING', 'FACTURAPI_KEY no está configurada en el entorno.')
  }
  if (!liveKeyEnv.startsWith('sk_live_')) {
    throw new FiscalError(409, 'FACTURAPI_LIVE_KEY_INVALID', 'FACTURAPI_KEY no parece ser una live key (debe empezar con sk_live_).')
  }
  const config = await prisma.configuracionFiscal.findUnique({ where: { empresaId } })
  if (!config || !config.facturapiOrganizationId) {
    throw new FiscalError(409, 'FISCAL_CONFIG_NOT_READY', 'La empresa no tiene Organization Facturapi configurada.')
  }
  if (config.facturapiLiveKeyEnc) {
    return { persistida: false, razon: 'already_has_live_key' }
  }
  const encrypted = cifrarSecreto(liveKeyEnv.trim())
  await prisma.configuracionFiscal.update({
    where: { empresaId },
    data: { facturapiLiveKeyEnc: encrypted }
  })
  resetFacturapiCache()
  console.log(`✅ Live key persistida para empresa ${empresaId}`)
  return { persistida: true }
}

module.exports = {
  FiscalError,
  detectarModo,
  modoActivo,
  esProduccion,
  assertFacturapiSeguro,
  assertLivemodeConsistente,
  persistirLiveKeyDeEntorno,
  getFacturapi,
  getFacturapiForEmpresa,
  verificarFacturacionEmpresa,
  getFacturapiUser,
  setFacturapiFactory,
  resetFacturapiCache
}
