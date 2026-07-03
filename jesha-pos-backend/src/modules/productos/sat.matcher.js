'use strict';

/**
 * Matcher SAT: sugiere claveSat y unidadSat para un producto.
 *
 * Módulo PURO: no consulta base de datos. Los productos existentes de la
 * empresa llegan como parámetro ya consultados (con scope empresaId
 * aplicado por el controlador). Esto permite probarlo offline con el
 * script de evaluación sin tocar Prisma.
 *
 * Pipeline (diseño congelado en Fase 0):
 *   1. Sanitizar entrada.
 *   2. Resolver unidadSat SOLO desde unidadVenta + esGranel (whitelist
 *      de 8). El nombre del producto NUNCA decide la unidad.
 *   3. Normalizar nombre+descripcion a tokens (sat.normalizador).
 *   4. Detectar familias y ambigüedad (sat.diccionario).
 *   5. Generar candidatos de 3 fuentes con filtros duros:
 *        a) diccionario ferretero (fuente dominante)
 *        b) productos existentes válidos (gate de familia por producto)
 *        c) catálogo oficial SAT (índice invertido de tokens)
 *      La frecuencia histórica NO es fuente: solo da un boost pequeño
 *      y condicionado a claves que ya llegaron por otra fuente.
 *   6. Scoring 0-100 y decisión AUTO / SUGERIR / MANUAL.
 *
 * Los UMBRALES son PROVISIONALES: se calibran en Fase 6/7 con el script
 * de evaluación offline. Por eso están exportados y concentrados.
 */

const fs = require('fs');
const path = require('path');
const { normalizarTexto } = require('./sat.normalizador');
const listas = require('./sat.listas');
const dicc = require('./sat.diccionario');
const conocimiento = require('./sat.conocimiento');

// ---------------------------------------------------------------------------
// Configuración calibrable (Fase 6/7)
// ---------------------------------------------------------------------------

const UMBRALES = {
  AUTO: 85,            // provisional; el 95 del plan original era para otra escala
  SUGERIR: 55,
  MARGEN_AUTO: 8,      // diferencia mínima top1 - top2 para AUTO
  SIMILITUD_EXISTENTE: 0.5, // overlap mínimo para que un existente cuente
  CORROBORA_EXISTENTE: 0.6, // cobertura mínima del producto NUEVO para que un existente corrobore AUTO
  CORROBORA_SAT: 0.75,      // cobertura SAT mínima para corroborar para AUTO (conservador; calibrar en Fase 6)
  REGLAS_CERTIFICADAS: new Set(), // claves promovidas a AUTO sin 2ª señal tras Fase 6
  MAX_CANDIDATOS_CATALOGO: 30,
  PISO_CANDIDATO: 40,  // score mínimo para exhibirse en candidatos
  MAX_CLAVES_POR_TOKEN: 3000, // tokens que aparecen en más claves se ignoran (demasiado genéricos)
};

const PESOS = {
  REGLA_FERRETERA: 35,
  BONO_CLAVE_ESPECIFICA: 12, // clave de regla ferretera que NO es NO_AUTO
  BONO_FAMILIA_FUERTE: 18,   // tope del bono combinado (específica + puntaje familia)
  COBERTURA_TOKENS: 20,
  SIMILITUD_EXISTENTES: 15,
  SIMILITUD_SAT: 15,
  CONSISTENCIA_UNIDAD: 10,
  BOOST_FRECUENCIA: 5,
  REGLA_CONOCIMIENTO: 65,
  BONO_CONOCIMIENTO_ALTA: 15,
  BONO_FAMILIA_CERTIFICADA: 30,
};

const PENALIZACIONES = {
  CONFLICTO_FAMILIA: -25,
  AMBIGUEDAD_CRITICA: -20,
  CONFLICTO_CONOCIMIENTO: -35,
};

// ---------------------------------------------------------------------------
// Carga lazy del índice (singleton por proceso)
// ---------------------------------------------------------------------------

const RUTA_INDICE_DEF = path.join(__dirname, '..', '..', 'data', 'sat', 'sat.index.json');

let _indice = null;
let _indiceInvertido = null; // token -> Set(claves)
let _rutaCargada = null;
let _cacheNorm = null; // Map<productoId, { tokens, importantes, familias }>

function cargarIndice(rutaIndice) {
  const ruta = rutaIndice || RUTA_INDICE_DEF;
  if (_indice !== null && _rutaCargada === ruta) return _indice;

  const crudo = fs.readFileSync(ruta, 'utf8');
  _indice = JSON.parse(crudo);
  _rutaCargada = ruta;

  _indiceInvertido = new Map();
  for (const [clave, entrada] of Object.entries(_indice.claves)) {
    const tokens = new Set([...(entrada.t || []), ...(entrada.s || [])]);
    for (const tok of tokens) {
      if (!_indiceInvertido.has(tok)) _indiceInvertido.set(tok, new Set());
      _indiceInvertido.get(tok).add(clave);
    }
  }
  return _indice;
}

function claveExiste(claveSat, indice) {
  return Object.prototype.hasOwnProperty.call(indice.claves, claveSat);
}

function unidadExiste(unidadSat, indice) {
  return Object.prototype.hasOwnProperty.call(indice.unidades, unidadSat);
}

/**
 * Pre-normaliza TODOS los productos de una vez.
 * Debe llamarse ANTES de evaluar si se usa con datasets grandes (O(n²)).
 * Devuelve un Map: productoId -> { tokens, importantes, familias }
 * Se cachea internamente y se reutiliza en todos los llamados a sugerirSat.
 *
 * @param {Array} productos - array de { id, nombre, descripcion, claveSat, unidadSat }
 * @returns {Map} cache de normalización
 */
function preNormalizarProductos(productos) {
  _cacheNorm = new Map();
  for (const prod of productos) {
    const clave = typeof prod.claveSat === 'string' ? prod.claveSat.trim() : '';
    const norm = normalizarTexto(`${prod.nombre || ''} ${prod.descripcion || ''}`);
    _cacheNorm.set(prod.id, {
      tokens: norm.tokens,
      importantes: tokensImportantes(norm.tokens),
      familias: clave === '' ? [] : dicc.detectarFamilias(norm.tokens),
    });
  }
  return _cacheNorm;
}

// ---------------------------------------------------------------------------
// Resolución de unidad (SOLO unidadVenta + esGranel)
// ---------------------------------------------------------------------------

const MAPA_UNIDAD_VENTA = {
  pieza: 'H87', pza: 'H87', pzas: 'H87', pz: 'H87', unidad: 'H87', h87: 'H87',
  metro: 'MTR', metros: 'MTR', m: 'MTR', mt: 'MTR', mts: 'MTR', mtr: 'MTR',
  kilo: 'KGM', kilos: 'KGM', kilogramo: 'KGM', kg: 'KGM', kgs: 'KGM', kgm: 'KGM',
  litro: 'LTR', litros: 'LTR', l: 'LTR', lt: 'LTR', lts: 'LTR', ltr: 'LTR',
  paquete: 'XPK', pack: 'XPK', paq: 'XPK', xpk: 'XPK',
  par: 'PR', pr: 'PR',
  kit: 'KT', kt: 'KT',
  set: 'SET', juego: 'SET', jgo: 'SET', conjunto: 'SET',
};

const UNIDADES_GRANEL = new Set(['KGM', 'MTR', 'LTR']);

/**
 * @returns {{ unidad: string|null, razon: string }}
 */
function resolverUnidad(unidadVenta, esGranel, indice) {
  const crudo = typeof unidadVenta === 'string' ? unidadVenta.trim().toLowerCase() : '';
  const mapeada = crudo === '' ? null : (MAPA_UNIDAD_VENTA[crudo] || null);

  if (esGranel === true) {
    if (mapeada === null) {
      return { unidad: null, razon: 'Granel sin unidad de venta reconocible: captura manual' };
    }
    if (!UNIDADES_GRANEL.has(mapeada)) {
      return { unidad: null, razon: `Granel con unidad ${mapeada} es contradictorio: captura manual` };
    }
    if (!listas.esUnidadOperativa(mapeada) || !unidadExiste(mapeada, indice)) {
      return { unidad: null, razon: 'Unidad fuera de whitelist operativa' };
    }
    return { unidad: mapeada, razon: `Granel con unidad de venta "${crudo}"` };
  }

  if (mapeada !== null) {
    if (!listas.esUnidadOperativa(mapeada) || !unidadExiste(mapeada, indice)) {
      return { unidad: null, razon: 'Unidad fuera de whitelist operativa' };
    }
    return { unidad: mapeada, razon: `Unidad de venta "${crudo}" mapeada a ${mapeada}` };
  }

  if (crudo === '') {
    return { unidad: 'H87', razon: 'Sin unidad de venta y no granel: pieza por defecto' };
  }
  return { unidad: null, razon: `Unidad de venta "${crudo}" no reconocida: captura manual` };
}

// ---------------------------------------------------------------------------
// Utilidades de similitud
// ---------------------------------------------------------------------------

function tokensImportantes(tokens) {
  return tokens.filter((t) => !/^\d+(?:\.\d+)?$/.test(t));
}

function tokenEnConjunto(token, conjunto) {
  for (const v of dicc.variantes(token)) {
    if (conjunto.has(v)) return true;
  }
  return false;
}

/** Coeficiente de solapamiento: |intersección| / min(|A|, |B|). */
function solapamiento(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  let inter = 0;
  for (const t of tokensA) {
    if (tokenEnConjunto(t, setB)) inter += 1;
  }
  return inter / Math.min(tokensA.length, tokensB.length);
}

/**
 * Cobertura sobre el producto NUEVO: cuántos de sus tokens importantes
 * están cubiertos por el otro. Asimétrica a propósito: para corroborar
 * AUTO, el producto existente debe cubrir casi todo el nuevo, no al
 * revés. "base tinaco" vs "tinaco" => 1/2 (no corrobora); "tinaco 750"
 * vs "tinaco 1100" => 1/1 (corrobora).
 */
function coberturaDelNuevo(tokensNuevo, tokensOtro) {
  if (tokensNuevo.length === 0) return 0;
  const setOtro = new Set(tokensOtro);
  let cubiertos = 0;
  for (const t of tokensNuevo) {
    if (tokenEnConjunto(t, setOtro)) cubiertos += 1;
  }
  return cubiertos / tokensNuevo.length;
}

// Modificadores que cambian la naturaleza del producto (accesorio/parte).
// Si el producto nuevo trae uno y el existente corroborante NO, ese
// existente no corrobora para AUTO. Lista corta a propósito (Fase 7
// puede ampliarla con evidencia de la muestra real).
const MODIFICADORES_CRITICOS = new Set([
  'base', 'soporte', 'tapa', 'repuesto', 'refaccion', 'accesorio',
]);

function tieneModificadorNoCompartido(tokensNuevo, tokensOtro) {
  const setOtro = new Set(tokensOtro);
  for (const t of tokensNuevo) {
    for (const v of dicc.variantes(t)) {
      if (MODIFICADORES_CRITICOS.has(v) && !setOtro.has(v)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fuentes de candidatos
// ---------------------------------------------------------------------------

/** Fuente b: productos existentes que SÍ pueden enseñar. */
function filtrarExistentesValidos(productosExistentes, familiasNuevo, indice, cacheNorm) {
  const validos = [];
  const idsFamiliasNuevo = new Set(familiasNuevo.map((f) => f.id));

  for (const prod of productosExistentes) {
    const clave = typeof prod.claveSat === 'string' ? prod.claveSat.trim() : '';
    if (clave === '' || !claveExiste(clave, indice)) continue;
    if (!listas.permiteAprender(clave)) continue;

    // Fast-path: usa la normalización pre-cacheada por empresa si existe.
    // Else autosuficiente: reconstruye el objeto COMPLETO { tokens,
    // importantes, familias }. normalizarTexto() solo devuelve tokens, por
    // eso importantes y familias se calculan aquí — de lo contrario, en
    // cache-miss (caller sin opciones.cacheNorm, p.ej. evaluar_matcher.js)
    // familiasExistente quedaría undefined producto por producto.
    let norm;
    if (cacheNorm && cacheNorm.has(prod.id)) {
      norm = cacheNorm.get(prod.id);
    } else {
      const n = normalizarTexto(`${prod.nombre || ''} ${prod.descripcion || ''}`);
      norm = {
        tokens: n.tokens,
        importantes: tokensImportantes(n.tokens),
        familias: dicc.detectarFamilias(n.tokens),
      };
    }
    const familiasExistente = norm.familias;

    // Gate de contradicción (estricto): si la clave está mapeada a
    // familias del diccionario, el producto existente debe CONFIRMAR
    // alguna de esas familias con sus propios tokens. Si no detecta
    // ninguna familia o detecta otras, no enseña.
    const familiasClave = dicc.familiasDeClave(clave);
    if (familiasClave.length > 0) {
      const ids = new Set(familiasExistente.map((f) => f.id));
      if (!familiasClave.some((f) => ids.has(f))) continue;
    }

    // Compatibilidad con el producto nuevo: si ambos tienen familias
    // detectadas, deben compartir al menos una.
    if (idsFamiliasNuevo.size > 0 && familiasExistente.length > 0) {
      if (!familiasExistente.some((f) => idsFamiliasNuevo.has(f.id))) continue;
    }

    validos.push({
      clave,
      tokens: norm.tokens,
      importantes: norm.importantes,
      unidadSat: typeof prod.unidadSat === 'string' ? prod.unidadSat.trim().toUpperCase() : '',
    });
  }
  return validos;
}

/** Fuente c: candidatos del catálogo oficial vía índice invertido. */
function candidatosDeCatalogo(tokens, indice) {
  const conteo = new Map();
  for (const token of tokens) {
    for (const v of dicc.variantes(token)) {
      const claves = _indiceInvertido.get(v);
      if (!claves || claves.size > UMBRALES.MAX_CLAVES_POR_TOKEN) continue;
      for (const clave of claves) {
        conteo.set(clave, (conteo.get(clave) || 0) + 1);
      }
    }
  }
  return [...conteo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, UMBRALES.MAX_CANDIDATOS_CATALOGO)
    .map(([clave]) => clave);
}

// ---------------------------------------------------------------------------
// Scoring por candidato
// ---------------------------------------------------------------------------

function puntuarCandidato(clave, ctx) {
  const { indice, importantes, familiasNuevo, existentesValidos, unidadResuelta, frecuencias, ambiguedad, reglasConocimiento } = ctx;
  const entrada = indice.claves[clave];
  const razones = [];
  let score = 0;

  // 0. Conocimiento de mercado: productos iconicos o patrones muy concretos.
  const reglaConocimiento = reglasConocimiento.find((r) => r.claveSat === clave);
  if (reglaConocimiento) {
    score += PESOS.REGLA_CONOCIMIENTO;
    razones.push(reglaConocimiento.razon);
    if (reglaConocimiento.confianza >= 95) score += PESOS.BONO_CONOCIMIENTO_ALTA;
  }

  // 1. Regla ferretera (dominante). Una clave que llega por regla
  //    ferretera directa es señal fuerte por sí sola: recibe el peso
  //    completo, más un bono si la clave es ESPECÍFICA (no NO_AUTO) y la
  //    familia quedó inequívoca (puntaje por encima del umbral). Así una
  //    regla directa y limpia alcanza SUGERIR sin depender de existentes.
  const familiaConClave = familiasNuevo.find((f) => f.claves.includes(clave));
  if (familiaConClave) {
    score += PESOS.REGLA_FERRETERA;
    razones.push(`Familia ${familiaConClave.id} detectada (regla ferretera)`);
    if (listas.permiteAuto(clave)) {
      const bono = Math.min(
        PESOS.BONO_FAMILIA_FUERTE,
        Math.round((familiaConClave.puntaje - dicc.UMBRAL_FAMILIA) * 2.5) + PESOS.BONO_CLAVE_ESPECIFICA
      );
      score += bono;
    }
    if (familiaConClave.certificada === true) {
      score += PESOS.BONO_FAMILIA_CERTIFICADA;
      razones.push('Familia certificada por catálogo SAT vigente');
    }
  }

  // 2. Cobertura de tokens importantes
  const tokensClave = new Set([...(entrada.t || []), ...(entrada.s || [])]);
  for (const f of familiasNuevo) {
    if (f.claves.includes(clave)) {
      const familiaDef = dicc.FAMILIAS.find((fd) => fd.id === f.id);
      for (const base of Object.keys(familiaDef.tokens)) tokensClave.add(base);
    }
  }
  let cubiertos = 0;
  for (const t of importantes) {
    if (tokenEnConjunto(t, tokensClave)) cubiertos += 1;
  }
  const cobertura = importantes.length === 0 ? 0 : cubiertos / importantes.length;
  score += Math.round(cobertura * PESOS.COBERTURA_TOKENS);

  // 3. Similitud con productos existentes válidos que usan esta clave
  let mejorSolape = 0;
  let existentesConClave = 0;
  let unidadCoincide = 0;
  let corroboraExistente = false;
  for (const ex of existentesValidos) {
    if (ex.clave !== clave) continue;
    existentesConClave += 1;
    const exImportantes = ex.importantes || tokensImportantes(ex.tokens);
    const s = solapamiento(importantes, exImportantes);
    if (s > mejorSolape) mejorSolape = s;
    if (unidadResuelta !== null && ex.unidadSat === unidadResuelta) unidadCoincide += 1;

    // Corroboración para AUTO (estricta): cobertura sobre el NUEVO y sin
    // modificador crítico no compartido. Distinta de la métrica de score.
    const cob = coberturaDelNuevo(importantes, exImportantes);
    if (cob >= UMBRALES.CORROBORA_EXISTENTE && !tieneModificadorNoCompartido(importantes, exImportantes)) {
      corroboraExistente = true;
    }
  }
  if (mejorSolape >= UMBRALES.SIMILITUD_EXISTENTE) {
    score += Math.round(mejorSolape * PESOS.SIMILITUD_EXISTENTES);
    razones.push('Producto existente muy similar usa esta clave');
  }

  // 4. Similitud textual con el catálogo SAT (descripcion + palabrasSimilares)
  const tokensSat = [...new Set([...(entrada.t || []), ...(entrada.s || [])])];
  const simSat = solapamiento(importantes, tokensSat);
  score += Math.round(simSat * PESOS.SIMILITUD_SAT);
  // Corroboración SAT: cobertura sobre el nuevo + sin modificador crítico
  // ausente en el catálogo (un "base/soporte/tapa" no se corrobora contra
  // la descripción SAT del objeto principal).
  const corroboraSat =
    coberturaDelNuevo(importantes, tokensSat) >= UMBRALES.CORROBORA_SAT &&
    !tieneModificadorNoCompartido(importantes, tokensSat);

  // 5. Consistencia de unidad
  if (unidadResuelta !== null) {
    if (existentesConClave === 0) {
      score += Math.round(PESOS.CONSISTENCIA_UNIDAD / 2); // neutral: sin evidencia en contra
    } else if (unidadCoincide >= existentesConClave / 2) {
      score += PESOS.CONSISTENCIA_UNIDAD;
    }
    // contradicción con la mayoría: 0 puntos
  }

  // 6. Boost de frecuencia histórica (pequeño y condicionado)
  if (frecuencias && frecuencias[clave] >= 5 && familiaConClave) {
    score += PESOS.BOOST_FRECUENCIA;
    razones.push('Frecuencia histórica validada');
  }

  // Penalizaciones
  const familiasClave = dicc.familiasDeClave(clave);
  let conflictoFamilia = false;
  if (familiasClave.length > 0 && familiasNuevo.length > 0 && !familiaConClave) {
    conflictoFamilia = true;
    score += PENALIZACIONES.CONFLICTO_FAMILIA;
    razones.push('Conflicto de familia con el diccionario');
  }
  if (ambiguedad.ambiguo) {
    score += PENALIZACIONES.AMBIGUEDAD_CRITICA;
  }
  if (reglasConocimiento.length > 0 && !reglaConocimiento) {
    score += PENALIZACIONES.CONFLICTO_CONOCIMIENTO;
    razones.push('Conflicto con regla directa de conocimiento');
  }

  // Corroboración para AUTO: una regla ferretera sola NO basta. Se exige
  // una segunda señal independiente (existente válido, cobertura SAT
  // alta, o regla previamente certificada por evaluación humana).
  const certificada = UMBRALES.REGLAS_CERTIFICADAS.has(clave);
  const conocimientoAlto = reglaConocimiento && reglaConocimiento.confianza >= 95;
  const familiaCertificada = familiaConClave && familiaConClave.certificada === true;
  const corroborado = corroboraExistente || corroboraSat || certificada || conocimientoAlto || familiaCertificada;

  return {
    claveSat: clave,
    descripcion: entrada.d,
    score: Math.max(0, Math.min(100, score)),
    conflictoFamilia,
    porReglaFerretera: Boolean(familiaConClave),
    corroborado,
    razones,
  };
}

// ---------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------

/**
 * @param {object} entrada
 * @param {string}  entrada.nombre
 * @param {string}  [entrada.descripcion]
 * @param {boolean} [entrada.esGranel]
 * @param {string}  [entrada.unidadVenta]
 * @param {Array}   [entrada.productosExistentes] - ya scoped por empresaId
 * @param {object}  [opciones]
 * @param {string}  [opciones.rutaIndice] - override para pruebas
 * @param {object}  [opciones.frecuencias] - { claveSat: total } de claves_bd.csv
 */
function sugerirSat(entrada, opciones = {}) {
  const indice = cargarIndice(opciones.rutaIndice);

  const nombre = typeof entrada.nombre === 'string' ? entrada.nombre.trim() : '';
  if (nombre === '') {
    return respuestaManual(['Nombre de producto vacío'], null);
  }

  const { unidad: unidadResuelta, razon: razonUnidad } = resolverUnidad(
    entrada.unidadVenta,
    entrada.esGranel === true,
    indice
  );

  const norm = normalizarTexto(`${nombre} ${entrada.descripcion || ''}`);
  const reglasConocimiento = conocimiento.detectarConocimiento(`${nombre} ${entrada.descripcion || ''}`);
  const importantes = tokensImportantes(norm.tokens);
  const familiasNuevo = dicc.detectarFamilias(norm.tokens);
  const ambiguedad = dicc.esAmbiguo(norm.tokens);
  const cacheNorm = opciones.cacheNorm || null;

  const existentesValidos = filtrarExistentesValidos(
    Array.isArray(entrada.productosExistentes) ? entrada.productosExistentes : [],
    familiasNuevo,
    indice,
    cacheNorm
  );

  // Universo de candidatos (filtro duro: hard blocklist y existencia)
  const universo = new Set();
  for (const r of reglasConocimiento) universo.add(r.claveSat);
  for (const f of familiasNuevo) for (const c of f.claves) universo.add(c);
  for (const ex of existentesValidos) universo.add(ex.clave);
  for (const c of candidatosDeCatalogo(importantes, indice)) universo.add(c);

  const diagnostico = opciones.diagnostico === true;
  const ctx = { indice, importantes, familiasNuevo, existentesValidos, unidadResuelta, frecuencias: opciones.frecuencias, ambiguedad, reglasConocimiento };
  const puntuados = [];
  for (const clave of universo) {
    if (listas.esHardBlock(clave) || !claveExiste(clave, indice)) continue;
    puntuados.push(puntuarCandidato(clave, ctx));
  }
  puntuados.sort((a, b) => b.score - a.score);

  const top = puntuados.filter((c) => c.score >= UMBRALES.PISO_CANDIDATO).slice(0, 3).map((c) => ({
    claveSat: c.claveSat,
    descripcion: c.descripcion,
    score: c.score,
  }));

  const razonesGlobales = [];
  if (ambiguedad.ambiguo) razonesGlobales.push(`Término ambiguo: "${ambiguedad.termino}"`);
  if (unidadResuelta === null) razonesGlobales.push(razonUnidad);
  for (const r of reglasConocimiento) razonesGlobales.push(`Conocimiento: ${r.id}`);
  for (const f of familiasNuevo) razonesGlobales.push(`Familia detectada: ${f.id}`);

  const topDiagnostico = () => puntuados.slice(0, 3).map((c) => ({
    claveSat: c.claveSat,
    descripcion: c.descripcion,
    score: c.score,
  }));

  if (puntuados.length === 0) {
    return respuestaManual([...razonesGlobales, 'Sin candidatos relevantes'], unidadResuelta);
  }

  const top1 = puntuados[0];
  const margen = puntuados.length > 1 ? top1.score - puntuados[1].score : 100;

  const puedeAuto =
    top1.score >= UMBRALES.AUTO &&
    margen >= UMBRALES.MARGEN_AUTO &&
    listas.permiteAuto(top1.claveSat) &&
    unidadResuelta !== null &&
    !ambiguedad.ambiguo &&
    !top1.conflictoFamilia &&
    top1.corroborado; // 2ª señal independiente: regla sola nunca autollenará

  if (puedeAuto) {
    return {
      estado: 'AUTO',
      claveSat: top1.claveSat,
      unidadSat: unidadResuelta,
      descripcionSat: top1.descripcion,
      confianza: top1.score,
      origen: 'LOCAL',
      razones: [...razonesGlobales, ...top1.razones, razonUnidad],
      candidatos: [top[0]],
    };
  }

  if (top1.score >= UMBRALES.SUGERIR && unidadResuelta !== null) {
    const razonesSugerir = [...razonesGlobales, ...top1.razones];
    if (!listas.permiteAuto(top1.claveSat)) {
      razonesSugerir.push('Mejor candidato es clave amplia (NO_AUTO): requiere confirmación');
    }
    if (margen < UMBRALES.MARGEN_AUTO) {
      razonesSugerir.push('Candidatos muy cercanos entre sí');
    }
    if (top1.porReglaFerretera && !top1.corroborado && top1.score >= UMBRALES.AUTO) {
      razonesSugerir.push('Regla ferretera sin segunda señal: requiere confirmación');
    }
    return {
      estado: 'SUGERIR',
      claveSat: null,
      unidadSat: unidadResuelta,
      descripcionSat: null,
      confianza: top1.score,
      origen: 'LOCAL',
      razones: razonesSugerir,
      candidatos: top,
    };
  }

  return respuestaManual(
    [...razonesGlobales, `Confianza insuficiente (top: ${top1.score})`],
    unidadResuelta,
    diagnostico ? topDiagnostico() : undefined
  );
}

function respuestaManual(razones, unidadResuelta, candidatosDiagnostico) {
  return {
    estado: 'MANUAL',
    claveSat: null,
    unidadSat: unidadResuelta,
    descripcionSat: null,
    confianza: 0,
    origen: 'LOCAL',
    razones,
    // El contrato del endpoint es candidatos: [] en MANUAL. Solo el
    // script de evaluación (opciones.diagnostico) recibe el top 3.
    candidatos: candidatosDiagnostico || [],
  };
}

/** Validador público para Fase 8/10: la clave existe en el catálogo vigente. */
function validarClaveSat(claveSat, rutaIndice) {
  const indice = cargarIndice(rutaIndice);
  const clave = typeof claveSat === 'string' ? claveSat.trim() : '';
  return clave !== '' && claveExiste(clave, indice);
}

/** Validador público para Fase 8/10: la unidad existe en el catálogo vigente. */
function validarUnidadSat(unidadSat, rutaIndice) {
  const indice = cargarIndice(rutaIndice);
  const unidad = typeof unidadSat === 'string' ? unidadSat.trim().toUpperCase() : '';
  return unidad !== '' && unidadExiste(unidad, indice);
}

module.exports = {
  sugerirSat,
  preNormalizarProductos,
  resolverUnidad,
  cargarIndice,
  validarClaveSat,
  validarUnidadSat,
  MAPA_UNIDAD_VENTA,
  UNIDADES_GRANEL,
  UMBRALES,
  PESOS,
  PENALIZACIONES,
};
