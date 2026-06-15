'use strict';

/**
 * Normalizador de texto compartido para el matching SAT.
 *
 * Lo usan:
 *  - scripts/sat/preprocesar_catalogo.js (tokeniza el catálogo oficial)
 *  - src/modules/productos/sat.matcher.js (tokeniza nombres de productos)
 *
 * Regla de oro: este módulo SOLO convierte texto en tokens comparables.
 * NO detecta familia, NO resuelve unidadSat, NO decide nada.
 * Las medidas extraídas (1/2, 50kg, 2x12) son señales DESCRIPTIVAS,
 * nunca unidad de venta.
 */

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'o', 'u', 'a', 'en', 'con', 'sin', 'para', 'por', 'sobre',
  'su', 'sus', 'que', 'se', 'al', 'lo', 'le', 'es', 'tipo', 'uso',
  'marca', 'modelo', 'color', 'varios', 'varias', 'otros', 'otras',
]);

// Abreviaturas a nivel token. El valor puede expandir a varios tokens.
const ABREVIATURAS = {
  pza: ['pieza'],
  pzas: ['pieza'],
  pz: ['pieza'],
  kg: ['kilogramo'],
  kgs: ['kilogramo'],
  kilo: ['kilogramo'],
  kilos: ['kilogramo'],
  lt: ['litro'],
  lts: ['litro'],
  l: ['litro'],
  mt: ['metro'],
  mts: ['metro'],
  m: ['metro'],
  mm: ['milimetro'],
  cm: ['centimetro'],
  plg: ['pulgada'],
  pulg: ['pulgada'],
  pulgadas: ['pulgada'],
  ced: ['cedula'],
  galv: ['galvanizado'],
  galvanizada: ['galvanizado'],
  inox: ['inoxidable'],
  hex: ['hexagonal'],
  exag: ['hexagonal'],
  fco: ['fosco'],
  transp: ['transparente'],
  bco: ['blanco'],
  ngo: ['negro'],
};

// Patrones de medidas, en orden: del más específico al más general.
// Se extraen ANTES de tokenizar para que no rompan los tokens.
const RE_MEDIDAS = [
  // Fracción mixta: 1-1/2, 2 1/2
  /\b\d+\s*[- ]\s*\d+\/\d+\b/g,
  // Fracción simple: 1/2, 3/8
  /\b\d+\/\d+\b/g,
  // Dimensiones: 2x12, 25x40
  /\b\d+(?:\.\d+)?x\d+(?:\.\d+)?\b/g,
  // Número + unidad descriptiva pegada o con espacio: 50kg, 19 l, 600w, 40mm, 12awg
  /\b\d+(?:\.\d+)?\s?(?:mm|cm|km|ml|lts|lt|l|kg|kgs|gr|g|w|v|hp|awg|cal|gal|oz|lb|mts|mt|m|pulgadas|pulgada|pulg|plg)\b/g,
  // Número + comilla de pulgada: 4", 1/2"
  /\b\d+(?:\/\d+)?\s*(?:"|''|in)\B/g,
];

function quitarAcentos(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normaliza un texto libre (nombre de producto o descripción de catálogo).
 *
 * @param {string} texto
 * @returns {{ textoNormalizado: string, tokens: string[], medidas: string[] }}
 */
function normalizarTexto(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') {
    return { textoNormalizado: '', tokens: [], medidas: [] };
  }

  let t = quitarAcentos(texto.toLowerCase());

  // Cédula: "c-40", "c40" -> "cedula 40" (antes de limpiar símbolos)
  t = t.replace(/\bc-?(\d{2,3})\b/g, 'cedula $1');

  // Sustituir todo símbolo que no aporte por espacio,
  // conservando / - . x " que participan en medidas.
  t = t.replace(/[^a-z0-9/\-.x"' ]+/g, ' ');

  // Extraer medidas y removerlas del texto.
  const medidas = [];
  for (const re of RE_MEDIDAS) {
    t = t.replace(re, (match) => {
      medidas.push(match.replace(/\s+/g, '').replace(/''/g, '"'));
      return ' ';
    });
  }

  // Lo que queda de símbolos de medida ya no aporta.
  t = t.replace(/["'.\-x/]+/g, ' ');

  // Tokenizar, expandir abreviaturas, filtrar stopwords y tokens basura.
  const tokens = [];
  for (const crudo of t.split(/\s+/)) {
    if (crudo === '') continue;
    const expandidos = ABREVIATURAS[crudo] || [crudo];
    for (const tok of expandidos) {
      if (STOPWORDS.has(tok)) continue;
      const esNumero = /^\d+(?:\.\d+)?$/.test(tok);
      if (!esNumero && tok.length < 2) continue;
      tokens.push(tok);
    }
  }

  return {
    textoNormalizado: tokens.join(' '),
    tokens,
    medidas,
  };
}

module.exports = {
  normalizarTexto,
  quitarAcentos,
  STOPWORDS,
  ABREVIATURAS,
};
