'use strict';

/**
 * Listas de control para el matching y la validación SAT.
 * Congeladas en Fase 0 (auditoría de insumos). Editar estas listas
 * NO requiere tocar la lógica del matcher.
 *
 * Niveles (de más a menos restrictivo):
 *
 *  HARD_BLOCKLIST  Nunca se sugiere, nunca se acepta en creación de
 *                  productos nuevos. Incluye claves que ya ni existen
 *                  en el catálogo vigente (defensa en profundidad: el
 *                  índice tampoco las contiene).
 *
 *  NO_AUTO         Claves válidas pero amplias/cajón. Pueden aparecer
 *                  como sugerencia de baja prioridad y pueden existir
 *                  en legacy, pero NUNCA se autollenan (estado AUTO).
 *
 *  NO_LEARN        Subconjunto de NO_AUTO. Productos existentes con
 *                  estas claves no aportan señal al matcher (no
 *                  "enseñan"). Decisión de Fase 0: 30111500 y 31201500
 *                  están en NO_AUTO pero FUERA de NO_LEARN; para esas,
 *                  el gate de familia por producto decide caso por caso.
 *
 *  WHITELIST_UNIDADES  Únicas unidades SAT que el sistema puede asignar
 *                  en inventario. El catálogo oficial retiene unidades
 *                  semánticamente inservibles (ej. MTS = metro por
 *                  segundo), por eso "existe en catálogo" NO basta.
 *
 * Importante: las claves mal APLICADAS en productos concretos (ej.
 * brocha con clave de inodoros) NO se listan aquí. Eso lo resuelve el
 * gate de familia por producto en el matcher: el error es del producto,
 * no de la clave.
 */

const HARD_BLOCKLIST = new Set([
  '27110000', // Histórica de importación masiva; ya no existe en catálogo vigente
  '40142300', // No existe en catálogo vigente
  '01010101', // "No existe en el catálogo"; excluida también por el preprocesador
]);

const NO_AUTO = new Set([
  '31162800', // Ferretería en general — cajón genérico evidente
  '40141700', // Material de ferretería y accesorios — muy amplia y sobreusada
  '27111500', // Herramientas de corte y engarzado — muy amplia
  '27111700', // Llaves inglesas y guías — muy amplia; preferir subclaves
  '39121700', // Ferretería eléctrica y suministros — muy amplia
  '30111500', // Concreto y morteros — semi-amplia, mal aplicada en muestras
  '31201500', // Cinta adhesiva — semi-amplia, mal aplicada en muestras
]);

const NO_LEARN = new Set([
  '31162800',
  '40141700',
  '27111500',
  '27111700',
  '39121700',
]);

// Unidades SAT operativas para inventario. Cualquier otra => MANUAL.
const WHITELIST_UNIDADES = new Set([
  'H87', // Pieza
  'MTR', // Metro
  'KGM', // Kilogramo
  'LTR', // Litro
  'XPK', // Paquete
  'PR',  // Par
  'KT',  // Kit
  'SET', // Conjunto
]);

/** La clave está prohibida de forma absoluta (sugerencia y creación). */
function esHardBlock(claveSat) {
  return HARD_BLOCKLIST.has(claveSat);
}

/** La clave puede sugerirse, pero nunca autollenarse (estado AUTO). */
function permiteAuto(claveSat) {
  return !HARD_BLOCKLIST.has(claveSat) && !NO_AUTO.has(claveSat);
}

/** Un producto existente con esta clave puede aportar señal al matcher. */
function permiteAprender(claveSat) {
  return !HARD_BLOCKLIST.has(claveSat) && !NO_LEARN.has(claveSat);
}

/** La unidad es asignable por el sistema en inventario. */
function esUnidadOperativa(unidadSat) {
  return WHITELIST_UNIDADES.has(unidadSat);
}

module.exports = {
  HARD_BLOCKLIST,
  NO_AUTO,
  NO_LEARN,
  WHITELIST_UNIDADES,
  esHardBlock,
  permiteAuto,
  permiteAprender,
  esUnidadOperativa,
};
