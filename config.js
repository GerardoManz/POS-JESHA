// ════════════════════════════════════════════════════════════════════
//  CONFIG.JS — Configuración central del frontend
//  Detecta automáticamente si estás en local o en producción.
//  Ya NO necesitas comentar/descomentar nada.
// ════════════════════════════════════════════════════════════════════

const CONFIG = (() => {
  const { protocol, hostname, port, origin } = window.location

  // isLocal: cualquier IP privada o localhost (solo para el log y consumidores)
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^192\.168\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)

  // SINGLE-ORIGIN: el API vive en el mismo origen que la página.
  // Excepción: Live Server (:5500) sirve el frontend pero el API está en :3000.
  const API_URL = (port === '5500')
    ? `${protocol}//${hostname}:3000`
    : origin

  // Tasa IVA — cambiar aquí afecta cotizaciones y cálculos frontend
  const IVA        = 0.16    // 16% tasa estándar
  const IVA_FACTOR = 1.16    // = 1 + IVA

  // Logo de la empresa (Cloudinary)
  const LOGO_URL = 'https://res.cloudinary.com/dabyfymjd/image/upload/q_auto/f_auto/v1779317658/logo-jesha_hmlble.png'

  return { API_URL, IVA, IVA_FACTOR, LOGO_URL, isLocal }
})()

// Exponer globalmente (compatibilidad con código existente)
window.__JESHA_API_URL__    = CONFIG.API_URL
window.__JESHA_IVA__        = CONFIG.IVA
window.__JESHA_IVA_FACTOR__ = CONFIG.IVA_FACTOR
window.__JESHA_LOGO_URL__   = CONFIG.LOGO_URL

// Log discreto en consola para verificar entorno
console.log(`[JESHA POS] Entorno: ${CONFIG.isLocal ? 'DESARROLLO' : 'PRODUCCIÓN'} → ${CONFIG.API_URL}`)