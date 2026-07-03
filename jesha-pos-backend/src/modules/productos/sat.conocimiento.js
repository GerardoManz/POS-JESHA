'use strict';

/**
 * Conocimiento de mercado mexicano para productos ferreteros.
 *
 * A diferencia del diccionario, estas reglas inspeccionan texto crudo
 * normalizado y pueden usar marcas/productos iconicos. Por eso se ejecutan
 * antes/despues del stopword filtering del normalizador sin depender de el.
 */

function quitarAcentos(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizarCrudo(texto) {
  if (typeof texto !== 'string') return '';
  return quitarAcentos(texto.toLowerCase())
    .replace(/[^a-z0-9/\-.\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contieneTodos(texto, patrones) {
  return patrones.every((patron) => patron.test(texto));
}

function contieneAlguno(texto, patrones) {
  return patrones.some((patron) => patron.test(texto));
}

const REGLAS_DIRECTAS = [
  // Quimicos / lubricantes.
  {
    id: 'wd40_lubricante',
    claveSat: '15121806',
    confianza: 98,
    todos: [/\bwd\s*-?\s*40\b/],
    razon: 'WD-40 identificado como lubricante anticorrosion',
  },

  // Refacciones/componentes que no deben clasificarse como el producto padre.
  {
    id: 'mango_martillo_mazo',
    claveSat: '27111610',
    confianza: 97,
    todos: [/\bmango\b/, /\b(martillo|martillos|marro|marros|mazo|mazos)\b/],
    razon: 'Mango para martillo/marro identificado como componente',
  },
  {
    id: 'aflojatodo_lubricante',
    claveSat: '15121806',
    confianza: 94,
    todos: [/\baflojatodo\b/],
    razon: 'Aflojatodo identificado como lubricante anticorrosion',
  },

  // Cintas.
  {
    id: 'cinta_teflon_ptfe',
    claveSat: '31201514',
    confianza: 98,
    todos: [/\bcinta\b/, /\b(teflon|ptfe|sella\s*rosca|sellar\s*rosca|selladora\s*rosca)\b/],
    razon: 'Cinta de teflon/PTFE identificada',
  },
  {
    id: 'cinta_aislante_electrica',
    claveSat: '31201502',
    confianza: 97,
    todos: [/\bcinta\b/, /\b(aislante|aislar|temflex|vinil)\b/],
    razon: 'Cinta aislante electrica identificada',
  },
  {
    id: 'cinta_masking',
    claveSat: '31201503',
    confianza: 98,
    todos: [/\b(masking|enmascarar|enmascarado)\b/],
    razon: 'Masking tape identificado como cinta de enmascarar',
  },
  {
    id: 'cinta_antiderrapante',
    claveSat: '31201513',
    confianza: 96,
    todos: [/\bcinta\b/, /\b(antiderrapante|antideslizante|abrasivo)\b/],
    razon: 'Cinta antideslizante de seguridad identificada',
  },
  {
    id: 'cinta_doble_cara',
    claveSat: '31201505',
    confianza: 94,
    todos: [/\bcinta\b/, /\b(doble\s*cara|doble\s*faz|montaje)\b/],
    razon: 'Cinta doble cara/de montaje identificada',
  },
  {
    id: 'cinta_transparente_diurex',
    claveSat: '31201512',
    confianza: 93,
    todos: [/\b(cinta|diurex)\b/, /\b(transparente|diurex|cristal)\b/],
    razon: 'Cinta transparente identificada',
  },

  // Adhesivos y selladores.
  {
    id: 'kola_loka_instantaneo',
    claveSat: '31201619',
    confianza: 98,
    todos: [/\b(kola\s*loka|krazy\s*kola|cianoacrilato)\b/],
    razon: 'Kola Loka/cianoacrilato identificado como adhesivo instantaneo',
  },
  {
    id: 'plastilina_epoxica',
    claveSat: '31201605',
    confianza: 96,
    todos: [/\b(plasti\s*loka|plastilina\s*epoxica)\b/],
    razon: 'Plastilina epoxica identificada como masilla',
  },
  {
    id: 'pegamento_pvc_cpvc',
    claveSat: '31201617',
    confianza: 97,
    todos: [/\b(pegamento|cemento\s*disolvente|cemento)\b/, /\b(pvc|cpvc)\b/],
    razon: 'Pegamento/cemento disolvente para PVC/CPVC identificado',
  },
  {
    id: 'adhesivo_contacto',
    claveSat: '31201623',
    confianza: 94,
    todos: [/\b(pegamento|adhesivo|resistol)\b/, /\bcontacto\b/],
    razon: 'Adhesivo de contacto identificado',
  },
  {
    id: 'silicon_sellador',
    claveSat: '31201632',
    confianza: 92,
    todos: [/\b(silicon|silicona|sellador)\b/],
    excluye: [/\b(pistola|aplicador|pipe)\b/],
    razon: 'Silicon/sellador identificado como adhesivo de silicona',
  },

  // Pinturas y recubrimientos.
  {
    id: 'pintura_aerosol',
    claveSat: '31211507',
    confianza: 97,
    todos: [/\bpintura\b/, /\baerosol\b/],
    razon: 'Pintura en aerosol identificada',
  },
  {
    id: 'esmalte',
    claveSat: '31211701',
    confianza: 92,
    todos: [/\besmalte\b/],
    razon: 'Esmalte identificado como acabado vitrificado',
  },
  {
    id: 'impermeabilizante',
    claveSat: '12164900',
    confianza: 92,
    todos: [/\bimpermeabilizante\b/],
    razon: 'Impermeabilizante identificado como agente de impermeabilizacion',
  },

  // Materiales de construccion.
  {
    id: 'cemento',
    claveSat: '30111601',
    confianza: 95,
    todos: [/\bcemento\b/],
    excluye: [/\b(disolvente|pegamento|pvc|cpvc)\b/],
    razon: 'Cemento de construccion identificado',
  },
  {
    id: 'mortero',
    claveSat: '30111502',
    confianza: 95,
    todos: [/\bmortero\b/],
    excluye: [/\b(revolvedor|mezclador|pistola)\b/],
    razon: 'Mortero de construccion identificado',
  },
  {
    id: 'yeso',
    claveSat: '30111701',
    confianza: 93,
    todos: [/\byeso\b/],
    excluye: [/\b(serrucho|soporte|cinta|taquete|pija|tornillo)\b/],
    razon: 'Yeso de construccion identificado',
  },
];

function detectarConocimiento(texto) {
  const normalizado = normalizarCrudo(texto);
  if (normalizado === '') return [];

  return REGLAS_DIRECTAS.filter((regla) => {
    if (Array.isArray(regla.todos) && !contieneTodos(normalizado, regla.todos)) return false;
    if (Array.isArray(regla.alguno) && !contieneAlguno(normalizado, regla.alguno)) return false;
    if (Array.isArray(regla.excluye) && contieneAlguno(normalizado, regla.excluye)) return false;
    return true;
  }).map((regla) => ({
    id: regla.id,
    claveSat: regla.claveSat,
    confianza: regla.confianza,
    razon: regla.razon,
  }));
}

module.exports = {
  REGLAS_DIRECTAS,
  detectarConocimiento,
  normalizarCrudo,
};
