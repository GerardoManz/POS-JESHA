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
    id: 'juego_brocas',
    claveSat: '27112845',
    confianza: 96,
    todos: [/\b(juego|kit|set)\b/, /\bbrocas?\b/],
    razon: 'Juego/kit de brocas identificado',
  },
  {
    id: 'aflojatodo_lubricante',
    claveSat: '15121806',
    confianza: 94,
    todos: [/\baflojatodo\b/],
    razon: 'Aflojatodo identificado como lubricante anticorrosion',
  },

  // Cinta delimitadora / seguridad.
  {
    id: 'cinta_delimitadora_seguridad',
    claveSat: '31201513',
    confianza: 96,
    todos: [/\bcinta\b/, /\b(delimitador|delimitadora|precaución|precaucion|seguridad)\b/],
    razon: 'Cinta delimitadora/de seguridad identificada',
  },

  // Pegatanke (marcas de adhesivos).
  {
    id: 'pegatanke_transparente',
    claveSat: '31201619',
    confianza: 96,
    todos: [/\bpegatanke\b/, /\btransparente\b/],
    razon: 'Pegatanke transparente identificado como adhesivo instantaneo',
  },
  {
    id: 'pegatanke_masilla',
    claveSat: '31201605',
    confianza: 96,
    todos: [/\bpegatanke\b/, /\b(masilla|epoxica)\b/],
    razon: 'Pegatanke masilla epoxica identificado',
  },
  {
    id: 'pegatanke_negro',
    claveSat: '31201632',
    confianza: 93,
    todos: [/\bpegatanke\b/, /\bnegro\b/],
    razon: 'Pegatanke negro identificado como sellador de silicona',
  },
  {
    id: 'pegatanke_generico',
    claveSat: '31201600',
    confianza: 90,
    todos: [/\bpegatanke\b/],
    razon: 'Pegatanke generico identificado como adhesivo/sellador',
  },

  // Llave nariz (hose bib / outdoor faucet).
  {
    id: 'llave_nariz_jardin',
    claveSat: '40141600',
    confianza: 96,
    todos: [/\bllave\b/, /\bnariz\b/, /\bjardin\b/],
    razon: 'Llave nariz de jardin identificada como valvula para manguera',
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
  {
    id: 'pigmento_colorante',
    claveSat: '12171600',
    confianza: 94,
    todos: [/\b(pigmento|pigmentos|colorante|colorantes)\b/],
    excluye: [/\b(pintura|esmalte|barniz)\b/],
    razon: 'Pigmento/colorante identificado',
  },

  // Materiales de construccion.
  {
    id: 'cemento',
    claveSat: '30111601',
    confianza: 95,
    todos: [/\bcemento\b/],
    excluye: [/\b(disolvente|pegamento|pvc|cpvc|pigmento|pigmentos|colorante|colorantes|oxido)\b/],
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

  // Utensilios de pintura.
  {
    id: 'cepillo_pintor',
    claveSat: '27113003',
    confianza: 92,
    todos: [/\bcepillo\b/, /\b(pintor|pintores)\b/],
    excluye: [/\balambre\b/, /\bacero\b/],
    razon: 'Cepillo para pintor identificado como cepillo de aplicar',
  },

  // Bombas manuales / infladores.
  {
    id: 'bomba_manual_inflar',
    claveSat: '40151506',
    confianza: 93,
    todos: [/\bbomba\b/, /\b(manual|inflar|inflador|bicicleta|balon|balones)\b/],
    excluye: [/\bagua\b/, /\b(sumergible|periferica|presurizadora|electrico|electrica)\b/],
    razon: 'Bomba manual/inflador identificado',
  },

  // Cortapernos.
  {
    id: 'cortapernos',
    claveSat: '27111512',
    confianza: 96,
    todos: [/\bcortapernos?\b/],
    razon: 'Cortapernos identificado',
  },

  // Brocas escalonadas (step drill bits).
  {
    id: 'broca_escalonada',
    claveSat: '27112841',
    confianza: 94,
    todos: [/\bbroca\b/, /\bescalonad[ao]\b/],
    razon: 'Broca escalonada identificada como broca para metal',
  },

  // Equipo de seguridad.
  {
    id: 'chaleco_seguridad',
    claveSat: '46181507',
    confianza: 95,
    todos: [/\bchaleco\b/, /\b(seguridad|reflectante|reflejante)\b/],
    razon: 'Chaleco de seguridad identificado',
  },
  {
    id: 'casco_seguridad',
    claveSat: '46181704',
    confianza: 95,
    todos: [/\bcasco\b/, /\b(seguridad|proteccion)\b/],
    excluye: [/\b(barco|bote|lancha|marino|antiguo|historico)\b/],
    razon: 'Casco de seguridad identificado',
  },

  // Herramientas electricas.
  {
    id: 'pistola_calor',
    claveSat: '27112717',
    confianza: 97,
    todos: [/\bpistola\b/, /\bcalor\b/],
    excluye: [/\b(soldar|silicon|calafatead)\b/],
    razon: 'Pistola de calor identificada',
  },

  // Accesorios de lavabo/fregadero.
  {
    id: 'chupon_sprayer',
    claveSat: '30181812',
    confianza: 88,
    todos: [/\bchupon\b/],
    razon: 'Chupon/rociador de lavabo identificado como rociador',
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
