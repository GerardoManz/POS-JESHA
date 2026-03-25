// ════════════════════════════════════════════════════════════════════
//  CONFIG.JS — Configuración central del frontend
//  Para cambiar de entorno: edita SOLO este archivo
// ════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Para desarrollo local:
  API_URL: 'http://localhost:3000',

  // Para compartir con ngrok — comenta la de arriba y descomenta esta:
  // API_URL: 'https://tu-url.ngrok-free.dev',

  // Tasa IVA — cambiar aquí afecta cotizaciones y cálculos frontend
  IVA:        0.16,   // 16% tasa estándar
  IVA_FACTOR: 1.16,   // = 1 + IVA (para dividir precios con IVA incluido)
}

// Exponer globalmente
window.__JESHA_API_URL__    = CONFIG.API_URL
window.__JESHA_IVA__        = CONFIG.IVA
window.__JESHA_IVA_FACTOR__ = CONFIG.IVA_FACTOR