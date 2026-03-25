// ════════════════════════════════════════════════════════════════════
//  CONFIG.JS — Configuración central del frontend
//  Para cambiar de entorno: edita SOLO este archivo
// ════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Para desarrollo local:
  API_URL: 'http://localhost:3000',

  // Para compartir con ngrok — comenta la de arriba y descomenta esta:
  // API_URL: 'https://tu-url.ngrok-free.dev',
}

// Exponer globalmente para que todos los módulos lo usen
window.__JESHA_API_URL__ = CONFIG.API_URL
