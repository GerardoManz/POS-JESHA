// ════════════════════════════════════════════════════════════════════
//  CONFIG.JS — Configuración central del frontend
//  Detecta automáticamente si estás en local o en producción.
//  Ya NO necesitas comentar/descomentar nada.
// ════════════════════════════════════════════════════════════════════

const CONFIG = (() => {
  const hostname = window.location.hostname

  // ── Detección automática de entorno ──
  const isLocal = ['localhost', '127.0.0.1', '192.168.0.190'].includes(hostname)

  // ══════════════════════════════════════════════════════════════════
  //  ÚNICA LÍNEA QUE EDITAS AL HACER DEPLOY:
  //  Cambia esta URL por la de tu API en producción
  //  Ejemplo: 'https://jesha-pos-api.up.railway.app'
  // ══════════════════════════════════════════════════════════════════
  const PRODUCTION_API_URL = 'https://jesha-pos-api.onrender.com'

  const API_URL = isLocal
    ? 'http://localhost:3000'
    : PRODUCTION_API_URL

  // Tasa IVA — cambiar aquí afecta cotizaciones y cálculos frontend
  const IVA        = 0.16    // 16% tasa estándar
  const IVA_FACTOR = 1.16    // = 1 + IVA

  return { API_URL, IVA, IVA_FACTOR, isLocal }
})()

// Exponer globalmente (compatibilidad con código existente)
window.__JESHA_API_URL__    = CONFIG.API_URL
window.__JESHA_IVA__        = CONFIG.IVA
window.__JESHA_IVA_FACTOR__ = CONFIG.IVA_FACTOR

// Log discreto en consola para verificar entorno
console.log(`[JESHA POS] Entorno: ${CONFIG.isLocal ? 'DESARROLLO' : 'PRODUCCIÓN'} → ${CONFIG.API_URL}`)