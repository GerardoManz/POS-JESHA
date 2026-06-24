// ════════════════════════════════════════════════════════════════════
//  LIB/FACTURAPI.JS
//  src/lib/facturapi.js
//
//  Cliente Facturapi centralizado con DOS keys coexistiendo:
//    FACTURAPI_KEY       = key LIVE  (sk_live...)   ← siempre la de producción
//    FACTURAPI_KEY_TEST  = key TEST  (sk_test...)   ← siempre la de sandbox
//    FACTURAPI_MODE      = 'test' | 'live'          ← selector
//
//  Reglas de seguridad:
//   - En PRODUCCIÓN (NODE_ENV=production o RENDER=true) el modo se FUERZA a 'live':
//     nunca se timbra contra sandbox usando la BD real.
//   - Fuera de producción, default = 'test' (no timbrar real por olvido).
//   - Se valida coherencia modo↔prefijo de la key: si no coinciden, ABORTA.
//
//  Regla operativa (NO la impone el código): una BD = un entorno. Los facturapiId
//  no son visibles entre test y live; cambiar de modo sobre una BD que ya tiene
//  facturas del otro entorno produce 'Invoice not found'.
// ════════════════════════════════════════════════════════════════════

let _facturapi = null
let _logged = false

// Modo a partir del prefijo de la key.
function detectarModo(key) {
  if (!key) return null
  if (key.startsWith('sk_test')) return 'TEST'
  if (key.startsWith('sk_live')) return 'LIVE'
  return 'DESCONOCIDO'
}

// Render expone RENDER=true; NODE_ENV puede no venir seteado de forma confiable.
function esProduccion() {
  return process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'
}

// Modo activo:
//  - En producción SIEMPRE 'live'.
//  - Fuera de producción, FACTURAPI_MODE ('test'|'live'); default 'test'.
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
  if (!key) return
  const prefijo = detectarModo(key)
  const esperado = modo === 'live' ? 'LIVE' : 'TEST'
  if (prefijo !== esperado) {
    const cual = modo === 'live' ? 'FACTURAPI_KEY' : 'FACTURAPI_KEY_TEST'
    throw new Error(
      `Modo Facturapi '${modo}' pero ${cual} es una key ${prefijo}. ` +
      'Convención: FACTURAPI_KEY = sk_live..., FACTURAPI_KEY_TEST = sk_test...' +
      (esProduccion() ? ' (en producción el modo se fuerza a live).' : '')
    )
  }
}

// Devuelve la instancia de Facturapi, o null si no hay key para el modo activo.
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

  const Facturapi = require('facturapi').default
  _facturapi = new Facturapi(key)
  return _facturapi
}

module.exports = { getFacturapi, detectarModo, modoActivo, assertFacturapiSeguro }