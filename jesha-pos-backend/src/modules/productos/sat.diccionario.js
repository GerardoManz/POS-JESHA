'use strict';

/**
 * Diccionario ferretero para el matching SAT.
 *
 * Es la fuente DOMINANTE del scoring (decisión de Fase 0) y el archivo
 * que más se ajustará en Fase 7. Agregar/editar familias es tarea
 * mecánica: no requiere tocar el matcher.
 *
 * Reglas de construcción:
 *
 *  - Los tokens se escriben en SINGULAR y ya NORMALIZADOS (minúsculas,
 *    sin acentos), porque se comparan contra la salida de
 *    sat.normalizador.js. El matching pliega plurales automáticamente
 *    (token "cinchos" coincide con base "cincho").
 *
 *  - Peso 2 = token fuerte (casi inequívoco de la familia).
 *    Peso 1 = token débil (apoya, pero no decide solo).
 *    Una familia se ACTIVA solo si la suma de pesos coincidentes
 *    alcanza UMBRAL_FAMILIA (2). Así "aceite" suelto no activa nada,
 *    pero "aceite motor" sí; y "cepillo de alambre" activa cepillos (2)
 *    por encima de cables (1), evitando heredar el error histórico.
 *
 *  - `claves` contiene ÚNICAMENTE claves SAT confirmadas por la
 *    auditoría de Fase 0 (muestras reales verificadas contra catálogo).
 *    Una familia SIN claves sigue siendo útil: alimenta el gate de
 *    contradicción de familia y acota candidatos de catálogo, pero no
 *    propone clave propia todavía.
 *
 *  - AMBIGUOS: términos que por sí solos no determinan familia. Si el
 *    término aparece y NINGÚN desambiguador lo acompaña, el matcher
 *    debe tratarlo como ambigüedad crítica (nunca AUTO).
 */

const UMBRAL_FAMILIA = 2;

const FAMILIAS = [
  {
    id: 'abrazaderas',
    tokens: { abrazadera: 2, omega: 1 },
    claves: ['31162906'],
  },
  {
    id: 'taquetes_anclajes',
    tokens: { taquete: 2, anclaje: 2, ancla: 1, expansivo: 1 },
    claves: ['31162103'],
  },
  {
    id: 'cinchos',
    tokens: { cincho: 2 },
    claves: ['39121703'],
  },
  {
    id: 'cerraduras',
    tokens: { cerradura: 2, cerrojo: 2, chapa: 2 },
    claves: ['31162402'],
  },
  {
    id: 'candados',
    tokens: { candado: 2 },
    claves: ['46171500'],
  },
  {
    id: 'discos_corte',
    tokens: { disco: 1, corte: 2, diamante: 2, segueta: 1 },
    requiere: ['disco'],
    claves: ['27112838'],
  },
  {
    id: 'discos_desbaste',
    tokens: { disco: 1, desbaste: 2 },
    requiere: ['disco', 'desbaste'],
    claves: ['31191600'],
  },
  {
    id: 'guantes',
    tokens: { guante: 2, nitrilo: 1, carnaza: 1 },
    claves: ['46181504'],
  },
  {
    id: 'aceites_lubricantes',
    tokens: { lubricante: 2, aceite: 1, motor: 1 },
    claves: ['15121501'],
  },
  {
    id: 'mezcladores_pintura',
    tokens: { revolvedor: 2, mezclador: 1, pintura: 1 },
    claves: ['31211905'],
  },
  {
    id: 'desarmadores',
    tokens: { desarmador: 2, destornillador: 2 },
    claves: ['27111701'],
  },
  {
    id: 'ruedas_rodajas',
    tokens: { rodaja: 2, rueda: 2 },
    claves: ['31162702'],
  },
  {
    id: 'cables_electricos',
    tokens: { thw: 2, thhn: 2, conductor: 2, cable: 1, alambre: 1, rudo: 1, calibre: 1, cal: 1 },
    excluye: ['galvanizado', 'recocido', 'puas', 'amarre'],
    claves: ['26121600'],
  },
  {
    id: 'tornillos_pijas',
    tokens: { tornillo: 2, pija: 2, autorroscante: 1, rosca: 1 },
    claves: ['31161500'],
  },
  {
    id: 'pernos',
    tokens: { perno: 2 },
    claves: ['31161600'],
  },
  {
    id: 'focos_lamparas',
    tokens: { foco: 2, bombilla: 2, lampara: 2, led: 1 },
    claves: ['39101600'],
  },
  {
    id: 'luminarios',
    tokens: { luminario: 2, plafon: 2 },
    claves: ['39111500'],
  },
  {
    id: 'valvulas',
    tokens: { valvula: 2, llave: 1, esfera: 1, paso: 1, compuerta: 1, angular: 1, check: 1 },
    claves: ['40141600'],
  },
  {
    id: 'selladores_adhesivos',
    tokens: { silicon: 2, sellador: 2, adhesivo: 2, pegamento: 2, resistol: 1 },
    claves: ['31201600'],
  },
  {
    id: 'seguetas_arcos',
    tokens: { segueta: 2, sierra: 1 },
    claves: ['27111559'],
  },
  {
    id: 'tinacos_tanques',
    tokens: { tinaco: 2, cisterna: 1, tanque: 1 },
    claves: ['24111810'],
  },
  {
    id: 'limpieza',
    tokens: { escoba: 2, trapeador: 2, recogedor: 2, jalador: 2, cepillo: 1, sanitario: 1 },
    claves: ['47131600'],
  },
  {
    id: 'herramientas_llaves_tubo',
    tokens: { stilson: 2 },
    claves: ['27111707'],
  },
  // ---- Familias sin clave confirmada todavía (solo gate + acotación) ----
  {
    id: 'plomeria_conexiones',
    tokens: { codo: 2, tee: 2, cople: 2, niple: 2, reduccion: 2, conexion: 1, yee: 2 },
    claves: [],
  },
  {
    id: 'brocas',
    tokens: { broca: 2 },
    claves: [],
  },
  {
    id: 'cepillos',
    tokens: { cepillo: 2 },
    claves: [],
  },
  {
    id: 'griferia',
    tokens: { mezcladora: 2, monomando: 2, regadera: 2, grifo: 2, lavabo: 1 },
    claves: [],
  },
  {
    id: 'herramientas_manuales',
    tokens: { perica: 2, martillo: 2, pinza: 2, alicate: 2, allen: 2, matraca: 2, dado: 1, llave: 1, combinada: 1, espanola: 1, mixta: 1 },
    claves: [],
  },
  {
    id: 'pinturas_recubrimientos',
    tokens: { pintura: 1, vinilica: 2, esmalte: 2, impermeabilizante: 2, barniz: 2, primario: 1 },
    claves: [],
  },
  {
    id: 'brochas_aplicadores',
    tokens: { brocha: 2, rodillo: 1, aplicador: 1 },
    claves: [],
  },
  {
    id: 'bombas_agua',
    tokens: { bomba: 2, sumergible: 1, periferica: 1 },
    claves: [],
  },
  {
    id: 'mangueras',
    tokens: { manguera: 2, jardin: 1 },
    claves: [],
  },
  {
    id: 'cementos_morteros',
    tokens: { cemento: 2, mortero: 2, yeso: 2 },
    claves: [],
  },
];

/**
 * Términos que solos no determinan familia. Si el término está presente
 * y ninguno de sus desambiguadores lo acompaña, hay ambigüedad crítica.
 */
const AMBIGUOS = {
  llave: ['stilson', 'perica', 'angular', 'esfera', 'paso', 'compuerta', 'mezcladora', 'allen', 'combinada', 'espanola', 'mixta'],
  arco: ['segueta'],
  barra: ['cerradura', 'cortina', 'panico'],
};

// ---------------------------------------------------------------------------

/** Variantes singulares de un token: "cinchos" -> ["cinchos","cincho"], "llaves" -> ["llaves","llave","llav"]. */
function variantes(token) {
  const v = [token];
  if (token.length > 3 && token.endsWith('s')) v.push(token.slice(0, -1));
  if (token.length > 5 && token.endsWith('es')) v.push(token.slice(0, -2));
  return v;
}

function coincide(tokenProducto, base) {
  return variantes(tokenProducto).includes(base);
}

/**
 * Detecta familias activas para un conjunto de tokens normalizados.
 *
 * @param {string[]} tokens - tokens de sat.normalizador.js
 * @returns {Array<{ id: string, puntaje: number, claves: string[] }>}
 *          ordenadas por puntaje descendente; solo las que alcanzan
 *          UMBRAL_FAMILIA.
 */
function detectarFamilias(tokens) {
  const resultados = [];
  for (const familia of FAMILIAS) {
    // Tokens obligatorios: si la familia los declara, TODOS deben estar
    // presentes o la familia no activa (evita que un token especializador
    // como "corte" active la familia sin su ancla "disco").
    if (Array.isArray(familia.requiere)) {
      const cumple = familia.requiere.every((req) => tokens.some((t) => coincide(t, req)));
      if (!cumple) continue;
    }
    // Tokens de exclusión: si alguno está presente, la familia no activa
    // (ej. "alambre galvanizado" no es cable eléctrico).
    if (Array.isArray(familia.excluye)) {
      const excluido = familia.excluye.some((ex) => tokens.some((t) => coincide(t, ex)));
      if (excluido) continue;
    }
    let puntaje = 0;
    for (const [base, peso] of Object.entries(familia.tokens)) {
      if (peso <= 0) continue;
      if (tokens.some((t) => coincide(t, base))) puntaje += peso;
    }
    if (puntaje >= UMBRAL_FAMILIA) {
      resultados.push({ id: familia.id, puntaje, claves: familia.claves.slice() });
    }
  }
  resultados.sort((a, b) => b.puntaje - a.puntaje);
  return resultados;
}

/**
 * Evalúa ambigüedad crítica.
 *
 * @param {string[]} tokens
 * @returns {{ ambiguo: boolean, termino: string|null }}
 */
function esAmbiguo(tokens) {
  for (const [termino, desambiguadores] of Object.entries(AMBIGUOS)) {
    const presente = tokens.some((t) => coincide(t, termino));
    if (!presente) continue;
    const resuelto = desambiguadores.some((d) => tokens.some((t) => coincide(t, d)));
    if (!resuelto) return { ambiguo: true, termino };
  }
  return { ambiguo: false, termino: null };
}

// Mapa inverso clave -> familias, para el gate de contradicción.
const _clavesAFamilias = new Map();
for (const familia of FAMILIAS) {
  for (const clave of familia.claves) {
    if (!_clavesAFamilias.has(clave)) _clavesAFamilias.set(clave, []);
    _clavesAFamilias.get(clave).push(familia.id);
  }
}

/**
 * Familias a las que pertenece una clave según el diccionario.
 * Vacío si la clave no está mapeada (no implica error: el diccionario
 * solo cubre lo confirmado).
 */
function familiasDeClave(claveSat) {
  return _clavesAFamilias.get(claveSat) || [];
}

module.exports = {
  UMBRAL_FAMILIA,
  FAMILIAS,
  AMBIGUOS,
  detectarFamilias,
  esAmbiguo,
  familiasDeClave,
  variantes,
  coincide,
};
