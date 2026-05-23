// ════════════════════════════════════════════════════════════════════
//  CONSTANTES.JS — Valores compartidos del sistema
//  Al cambiar la tasa de IVA, solo se actualiza este archivo.
// ════════════════════════════════════════════════════════════════════

const TASA_IVA  = 0.16
const FACTOR_IVA = 1 + TASA_IVA

module.exports = { TASA_IVA, FACTOR_IVA }
