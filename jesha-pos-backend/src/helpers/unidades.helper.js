'use strict'

/**
 * Helper central de unidades de venta, compra y clasificación.
 *
 * Responsabilidades separadas:
 *   A. Catálogo operativo (unidadVenta + unidadCompra + unidadSat)
 *   B. Aliases → valor canónico
 *   C. Normalización (lectura tolerante, escritura canónica)
 *   D. Validación
 *   E. Clasificación discreta / fraccionable
 *   F. Inferencia por nombre
 *
 * NOTA sobre MT vs M / LT vs L:
 *   El catálogo almacena MT/LT como valor canónico. La BD histórica
 *   contiene 'm' (58 prod.) y 'l' (3 prod.). El helper normaliza
 *   ambos sentidos: lectura acepta 'm'/'l', escritura produce MT/LT.
 *   Los consumidores (ticket, reportes, compras) deben usar
 *   obtenerUnidadLabel() para la etiqueta visual.
 */

// ═══════════════════════════════════════════════════════════════════
// A. CATÁLOGO OPERATIVO
// ═══════════════════════════════════════════════════════════════════

const UNIDADES_VENTA = [
  { valor: 'PZA', label: 'pza',  unidadSat: 'H87', tipo: 'DISCRETA', grupo: 'UNIDAD' },
  { valor: 'MT',  label: 'm',    unidadSat: 'MTR', tipo: 'FRACCIONABLE', grupo: 'LONGITUD' },
  { valor: 'CM',  label: 'cm',   unidadSat: 'MMT', tipo: 'FRACCIONABLE', grupo: 'LONGITUD' },
  { valor: 'KG',  label: 'kg',   unidadSat: 'KGM', tipo: 'FRACCIONABLE', grupo: 'PESO' },
  { valor: 'G',   label: 'g',    unidadSat: 'GRM', tipo: 'FRACCIONABLE', grupo: 'PESO' },
  { valor: 'LT',  label: 'L',    unidadSat: 'LTR', tipo: 'FRACCIONABLE', grupo: 'VOLUMEN' },
  { valor: 'ML',  label: 'ml',   unidadSat: 'MLT', tipo: 'FRACCIONABLE', grupo: 'VOLUMEN' },
  { valor: 'M2',  label: 'm²',   unidadSat: 'MTK', tipo: 'FRACCIONABLE', grupo: 'AREA' },
  { valor: 'M3',  label: 'm³',   unidadSat: 'MTQ', tipo: 'FRACCIONABLE', grupo: 'VOLUMEN' },
  { valor: 'PAQUETE', label: 'paquete', unidadSat: 'XPK', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'PAR',  label: 'par',  unidadSat: 'PR',  tipo: 'DISCRETA', grupo: 'UNIDAD' },
  { valor: 'KIT',  label: 'kit',  unidadSat: 'KT',  tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'JUEGO', label: 'juego', unidadSat: 'SET', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'CAJA', label: 'caja', unidadSat: 'XBX', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'ROLLO', label: 'rollo', unidadSat: 'XRO', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'BOLSA', label: 'bolsa', unidadSat: 'XBG', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'BULTO', label: 'bulto', unidadSat: 'XSA', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'SACO',  label: 'saco',  unidadSat: 'XSA', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'BOTE',  label: 'bote',  unidadSat: 'XBJ', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'CUBETA', label: 'cubeta', unidadSat: 'XBJ', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'BOTELLA', label: 'botella', unidadSat: 'XBO', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'LATA',  label: 'lata',  unidadSat: 'XCA', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'TAMBOR', label: 'tambor', unidadSat: 'XDR', tipo: 'DISCRETA', grupo: 'EMPAQUE' },
  { valor: 'TRAMO', label: 'tramo', unidadSat: 'MTR', tipo: 'DISCRETA', grupo: 'LONGITUD' },
  { valor: 'DOCENA', label: 'docena', unidadSat: 'DZN', tipo: 'DISCRETA', grupo: 'UNIDAD' },
  { valor: 'VIAJE', label: 'viaje', unidadSat: 'MTQ', tipo: 'DISCRETA', grupo: 'VOLUMEN' },
]

const UNIDADES_VENTA_MAP = new Map(UNIDADES_VENTA.map(u => [u.valor, u]))
const UNIDADES_VENTA_SET = new Set(UNIDADES_VENTA.map(u => u.valor))
const UNIDADES_FRACCIONABLES = new Set(
  UNIDADES_VENTA.filter(u => u.tipo === 'FRACCIONABLE').map(u => u.valor)
)
const UNIDADES_DISCRETAS = new Set(
  UNIDADES_VENTA.filter(u => u.tipo === 'DISCRETA').map(u => u.valor)
)

const UNIDADES_COMPRA = [
  { valor: 'CAJA',    label: 'caja',    unidadSat: 'XBX' },
  { valor: 'BULTO',   label: 'bulto',   unidadSat: 'XSA' },
  { valor: 'ROLLO',   label: 'rollo',   unidadSat: 'XRO' },
  { valor: 'PZA',     label: 'pza',     unidadSat: 'H87' },
  { valor: 'PAQUETE', label: 'paquete', unidadSat: 'XPK' },
  { valor: 'MT',      label: 'm',       unidadSat: 'MTR' },
  { valor: 'KG',      label: 'kg',      unidadSat: 'KGM' },
  { valor: 'LT',      label: 'L',       unidadSat: 'LTR' },
  { valor: 'TAMBOR',  label: 'tambor',  unidadSat: 'XDR' },
  { valor: 'CILINDRO',label: 'cilindro',unidadSat: 'XCY' },
  { valor: 'CUBETA',  label: 'cubeta',  unidadSat: 'XBJ' },
  { valor: 'LATA',    label: 'lata',    unidadSat: 'XCA' },
  { valor: 'BOLSA',   label: 'bolsa',   unidadSat: 'XBG' },
  { valor: 'BOTELLA', label: 'botella', unidadSat: 'XBO' },
  { valor: 'PAR',     label: 'par',     unidadSat: 'PR' },
  { valor: 'KIT',     label: 'kit',     unidadSat: 'KT' },
  { valor: 'JUEGO',   label: 'juego',   unidadSat: 'SET' },
  { valor: 'SACO',    label: 'saco',    unidadSat: 'XSA' },
  { valor: 'TRAMO',   label: 'tramo',   unidadSat: 'MTR' },
  { valor: 'DOCENA',  label: 'docena',  unidadSat: 'DZN' },
  { valor: 'VIAJE',   label: 'viaje',   unidadSat: 'MTQ' },
]

const UNIDADES_COMPRA_MAP = new Map(UNIDADES_COMPRA.map(u => [u.valor, u]))
const UNIDADES_COMPRA_SET = new Set(UNIDADES_COMPRA.map(u => u.valor))

// ═══════════════════════════════════════════════════════════════════
// B. ALIASES → valor canónico
// ═══════════════════════════════════════════════════════════════════

const ALIASES = {
  // PZA
  PZ: 'PZA', PZAS: 'PZA', PIEZA: 'PZA', PIEZAS: 'PZA',
  // MT
  M: 'MT', MTS: 'MT', METRO: 'MT', METROS: 'MT',
  // CM
  CENTIMETRO: 'CM', CENTIMETROS: 'CM',
  // KG
  KILO: 'KG', KILOS: 'KG', KGS: 'KG',
  // G
  GR: 'G', GRAMO: 'G', GRAMOS: 'G',
  // LT
  L: 'LT', LTS: 'LT', LITRO: 'LT', LITROS: 'LT',
  // ML
  MILILITRO: 'ML', MILILITROS: 'ML',
  // M2
  // M3
  // PAQUETE
  PAQ: 'PAQUETE', PACK: 'PAQUETE',
  // PAR
  PR: 'PAR', PARES: 'PAR',
  // KIT
  // JUEGO
  SET: 'JUEGO',
  // CAJA
  // ROLLO
  // BOLSA
  // BULTO
  // SACO
  SACOS: 'SACO',
  // BOTE
  BOTES: 'BOTE',
  // CUBETA
  // BOTELLA
  // LATA
  // TAMBOR
  // TRAMO
  // DOCENA
  // VIAJE
  VJE: 'VIAJE', VIAJES: 'VIAJE',
}

const ALIASES_UPPER = new Map(
  Object.entries(ALIASES).map(([k, v]) => [k.toUpperCase(), v])
)

// ═══════════════════════════════════════════════════════════════════
// C. NORMALIZACIÓN
// ═══════════════════════════════════════════════════════════════════

/**
 * Normaliza un valor cualquiera a unidad de venta canónica.
 * Lectura tolerante: acepta mayúsculas/minúsculas, espacios, aliases.
 * Escritura canónica: siempre devuelve el valor del catálogo (PZA, MT, etc.).
 *
 * @param {*} valor       - valor a normalizar (string, null, undefined)
 * @param {boolean} esServicio - si es servicio, null/undefined son válidos
 * @returns {string|null} valor canónico o null si no se pudo normalizar
 */
function normalizarUnidadVenta(valor, esServicio) {
  if (esServicio) {
    if (valor === null || valor === undefined) return null
    const t = String(valor).trim().toUpperCase()
    if (t === '') return null
    if (UNIDADES_VENTA_SET.has(t)) return t
    return ALIASES_UPPER.get(t) || null
  }
  if (valor === null || valor === undefined) return null
  if (typeof valor !== 'string' && typeof valor !== 'number') return null
  const t = String(valor).trim().toUpperCase()
  if (t === '') return null
  if (UNIDADES_VENTA_SET.has(t)) return t
  return ALIASES_UPPER.get(t) || null
}

/**
 * Normaliza un valor cualquiera a unidad de compra canónica.
 */
function normalizarUnidadCompra(valor, esServicio) {
  if (esServicio) {
    if (valor === null || valor === undefined) return null
    const t = String(valor).trim().toUpperCase()
    if (t === '') return null
    if (UNIDADES_COMPRA_SET.has(t)) return t
    return ALIASES_UPPER.get(t) || null
  }
  if (valor === null || valor === undefined) return null
  const t = String(valor).trim().toUpperCase()
  if (t === '') return null
  if (UNIDADES_COMPRA_SET.has(t)) return t
  return ALIASES_UPPER.get(t) || null
}

// ═══════════════════════════════════════════════════════════════════
// D. VALIDACIÓN
// ═══════════════════════════════════════════════════════════════════

function esUnidadVentaValida(valor, esServicio) {
  if (esServicio) return valor === null || valor === undefined
  if (valor === null || valor === undefined) return false
  const t = String(valor).trim().toUpperCase()
  if (t === '') return false
  if (UNIDADES_VENTA_SET.has(t)) return true
  return ALIASES_UPPER.has(t)
}

function esUnidadCompraValida(valor, esServicio) {
  if (esServicio) return valor === null || valor === undefined
  if (valor === null || valor === undefined) return true
  const t = String(valor).trim().toUpperCase()
  if (t === '') return false
  if (UNIDADES_COMPRA_SET.has(t)) return true
  return ALIASES_UPPER.has(t)
}

// ═══════════════════════════════════════════════════════════════════
// E. CLASIFICACIÓN
// ═══════════════════════════════════════════════════════════════════

function esFraccionable(valor) {
  if (!valor) return false
  const t = String(valor).trim().toUpperCase()
  if (UNIDADES_FRACCIONABLES.has(t)) return true
  const normalizada = ALIASES_UPPER.get(t)
  return normalizada ? UNIDADES_FRACCIONABLES.has(normalizada) : false
}

function esDiscreta(valor) {
  if (!valor) return false
  const t = String(valor).trim().toUpperCase()
  if (UNIDADES_DISCRETAS.has(t)) return true
  const normalizada = ALIASES_UPPER.get(t)
  return normalizada ? UNIDADES_DISCRETAS.has(normalizada) : false
}

/**
 * Obtiene la etiqueta visual para una unidad de venta.
 * Ej: MT → 'm',  M3 → 'm³',  PZA → 'pza'
 */
function obtenerLabelUnidadVenta(valor) {
  if (!valor) return ''
  const t = String(valor).trim().toUpperCase()
  const normalizada = UNIDADES_VENTA_MAP.has(t) ? t : (ALIASES_UPPER.get(t) || null)
  if (normalizada && UNIDADES_VENTA_MAP.has(normalizada)) {
    return UNIDADES_VENTA_MAP.get(normalizada).label
  }
  return String(valor).trim()
}

/**
 * Obtiene la unidad SAT asociada a una unidad de venta.
 */
function obtenerUnidadSat(valor) {
  if (!valor) return null
  const t = String(valor).trim().toUpperCase()
  const normalizada = UNIDADES_VENTA_MAP.has(t) ? t : (ALIASES_UPPER.get(t) || null)
  if (normalizada && UNIDADES_VENTA_MAP.has(normalizada)) {
    return UNIDADES_VENTA_MAP.get(normalizada).unidadSat
  }
  return null
}

/**
 * Obtiene el grupo al que pertenece la unidad.
 */
function obtenerGrupoUnidad(valor) {
  if (!valor) return null
  const t = String(valor).trim().toUpperCase()
  const normalizada = UNIDADES_VENTA_MAP.has(t) ? t : (ALIASES_UPPER.get(t) || null)
  if (normalizada && UNIDADES_VENTA_MAP.has(normalizada)) {
    return UNIDADES_VENTA_MAP.get(normalizada).grupo
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════
// F. INFERENCIA POR NOMBRE
// ═══════════════════════════════════════════════════════════════════

const PATRONES_PRESENTACION_FIJA = [
  { regex: /\bBOLSA\b/i,           sugerencia: 'BOLSA',  confianza: 'ALTA' },
  { regex: /\bCAJA\b/i,             sugerencia: 'CAJA',   confianza: 'ALTA' },
  { regex: /\bPAQUETE\b/i,          sugerencia: 'PAQUETE',confianza: 'ALTA' },
  { regex: /\bKIT\b/i,              sugerencia: 'KIT',    confianza: 'ALTA' },
  { regex: /\bSET\b/i,              sugerencia: 'JUEGO',  confianza: 'MEDIA' },
  { regex: /\bJUEGO DE\b/i,         sugerencia: 'JUEGO',  confianza: 'ALTA' },
  { regex: /\bROLLO\b/i,            sugerencia: 'ROLLO',  confianza: 'ALTA' },
  { regex: /\bBULTO\b/i,            sugerencia: 'BULTO',  confianza: 'ALTA' },
  { regex: /\bSACO\b/i,             sugerencia: 'SACO',   confianza: 'ALTA' },
  { regex: /\bCUBETA\b/i,           sugerencia: 'CUBETA', confianza: 'ALTA' },
  { regex: /\bBOTE\b/i,             sugerencia: 'BOTE',   confianza: 'ALTA' },
  { regex: /\bTRAMO\b/i,            sugerencia: 'TRAMO',  confianza: 'ALTA' },
  { regex: /\bBLISTER\b/i,          sugerencia: 'PAQUETE',confianza: 'MEDIA' },
  { regex: /\bDOCENA\b/i,           sugerencia: 'DOCENA', confianza: 'ALTA' },
  { regex: /\bTAMBOR\b/i,           sugerencia: 'TAMBOR', confianza: 'ALTA' },
  { regex: /\bLATA\b/i,             sugerencia: 'LATA',   confianza: 'ALTA' },
  { regex: /\bBOTELLA\b/i,          sugerencia: 'BOTELLA',confianza: 'ALTA' },
  { regex: /\bVIAJE\b/i,            sugerencia: 'VIAJE',  confianza: 'ALTA' },
  { regex: /\bPAR\b/i,              sugerencia: 'PAR',    confianza: 'BAJA' },
]

const PATRONES_FRACCIONABLE = [
  { regex: /\bX\s*KG\b|\bPOR\s*KG\b|\bPOR\s*KILO\b|\/KG\b/i, sugerencia: 'KG', confianza: 'ALTA' },
  { regex: /\bX\s*KILO\b/i,                                     sugerencia: 'KG', confianza: 'ALTA' },
  { regex: /\bX\s*METRO\b|\bPOR\s*METRO\b|\bX\s*M\b|\/M\b/i,    sugerencia: 'MT', confianza: 'ALTA' },
  { regex: /\bX\s*LITRO\b|\bPOR\s*LITRO\b|\bX\s*LT\b|\/LT\b/i,  sugerencia: 'LT', confianza: 'ALTA' },
  { regex: /\bX\s*M2\b|\bPOR\s*M2\b|\bM²\b/i,                    sugerencia: 'M2', confianza: 'ALTA' },
  { regex: /\bX\s*M3\b|\bPOR\s*M3\b|\bM³\b/i,                    sugerencia: 'M3', confianza: 'ALTA' },
  { regex: /\bMETRO\s*CUBICO\b|\bMETRO\s*CÚBICO\b/i,             sugerencia: 'M3', confianza: 'ALTA' },
  { regex: /\bX\s*CM\b|\bPOR\s*CM\b/i,                            sugerencia: 'CM', confianza: 'BAJA' },
  { regex: /\bX\s*GR\b|\bPOR\s*GR\b|\bX\s*G\b|\bPOR\s*G\b/i,     sugerencia: 'G',  confianza: 'BAJA' },
  { regex: /\bX\s*ML\b|\bPOR\s*ML\b/i,                            sugerencia: 'ML', confianza: 'BAJA' },
]

const PALABRAS_CONFLICTO = [
  /\bPULG\b/i, /\bPULGADA\b/i, /\bMM\b/i, /\bCM\b/i,
  /\bML\b/i, /\bKG\b/i, /\bG\b/i, /\bM\b(?:M|TS?\b)?/i,
]

/**
 * Infiere la unidad de venta a partir del nombre del producto.
 * No usa unidadSat ni esGranel para evitar circularidad.
 *
 * @param {string} nombre - nombre del producto
 * @returns {{ unidadSugerida: string|null, confianza: string, regla: string, advertencias: string[] }}
 */
function inferirUnidadPorNombre(nombre) {
  const resultado = {
    unidadSugerida: null,
    confianza: 'BAJA',
    regla: 'SIN_CLASIFICAR',
    advertencias: [],
  }

  if (!nombre || typeof nombre !== 'string') {
    resultado.regla = 'SIN_NOMBRE'
    return resultado
  }

  const nombreUpper = nombre.toUpperCase().trim()

  // 1. Buscar patrón de presentación fija
  const presentacionesEncontradas = []
  for (const p of PATRONES_PRESENTACION_FIJA) {
    if (p.regex.test(nombreUpper)) {
      presentacionesEncontradas.push(p)
    }
  }

  // 2. Buscar patrón fraccionable
  const fraccionablesEncontrados = []
  for (const p of PATRONES_FRACCIONABLE) {
    if (p.regex.test(nombreUpper)) {
      fraccionablesEncontrados.push(p)
    }
  }

  // 3. Detectar falsos positivos: palabras de medida en contexto no-fraccionable
  const tienePalabrasMedida = PALABRAS_CONFLICTO.some(r => r.test(nombreUpper))

  // 4. Resolver conflictos
  if (presentacionesEncontradas.length > 0 && fraccionablesEncontrados.length > 0) {
    resultado.advertencias.push(
      `Nombre tiene presentación fija y fraccionable simultáneamente: "${nombre}"`
    )
    // Priorizar presentación fija sobre fraccionable
    // (el empaque ES la unidad, aunque el nombre mencione medida)
    const mejor = presentacionesEncontradas.sort((a, b) => {
      const peso = { ALTA: 3, MEDIA: 2, BAJA: 1 }
      return peso[b.confianza] - peso[a.confianza]
    })[0]
    resultado.unidadSugerida = mejor.sugerencia
    resultado.confianza = 'MEDIA'
    resultado.regla = `PRESENTACION_FIJA_CON_MEDIDA`
    return resultado
  }

  if (presentacionesEncontradas.length > 0) {
    const mejor = presentacionesEncontradas.sort((a, b) => {
      const peso = { ALTA: 3, MEDIA: 2, BAJA: 1 }
      return peso[b.confianza] - peso[a.confianza]
    })[0]
    resultado.unidadSugerida = mejor.sugerencia
    resultado.confianza = mejor.confianza
    resultado.regla = 'PRESENTACION_FIJA'
    return resultado
  }

  if (fraccionablesEncontrados.length > 0) {
    const mejor = fraccionablesEncontrados.sort((a, b) => {
      const peso = { ALTA: 3, MEDIA: 2, BAJA: 1 }
      return peso[b.confianza] - peso[a.confianza]
    })[0]
    resultado.unidadSugerida = mejor.sugerencia
    resultado.confianza = mejor.confianza
    resultado.regla = 'FRACCIONABLE'
    return resultado
  }

  // 5. Sin patrón → PZA (default para producto físico sin ambigüedad)
  resultado.unidadSugerida = 'PZA'
  resultado.confianza = 'PROBABLE'
  resultado.regla = 'PZA_PROBABLE'

  return resultado
}

/**
 * Versión extendida de inferirUnidadPorNombre que también considera
 * esGranel y unidadSat, para usar en clasificación de backfill.
 *
 * @param {object} producto - { nombre, esGranel, unidadSat }
 * @returns {{ unidadSugerida: string|null, confianza: string, regla: string, advertencias: string[] }}
 */
function clasificarProducto(producto) {
  if (!producto || !producto.nombre) {
    return { unidadSugerida: null, confianza: 'BAJA', regla: 'SIN_DATOS', advertencias: ['Producto sin nombre'] }
  }

  const base = inferirUnidadPorNombre(producto.nombre)
  const resultado = { ...base, advertencias: [...base.advertencias] }

  // Si ya tenemos PZA_PROBABLE, verificar consistencia con unidadSat
  if (base.regla === 'PZA_PROBABLE' && producto.unidadSat) {
    const sat = String(producto.unidadSat).trim().toUpperCase()
    if (sat === 'H87') {
      resultado.confianza = 'MEDIA'
      resultado.regla = 'PZA_SAT_H87'
    } else if (sat === 'KGM' || sat === 'MTR' || sat === 'LTR') {
      // unidadSat sugiere fraccionable pero nombre no lo confirma → ambigüedad
      resultado.unidadSugerida = 'PZA'  // conservador
      resultado.confianza = 'BAJA'
      resultado.regla = 'PZA_PROBABLE_SAT_DIVERGE'
      resultado.advertencias.push(
        `unidadSat=${producto.unidadSat} pero nombre no confirma unidad fraccionable`
      )
    }
  }

  return resultado
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  // Catálogos
  UNIDADES_VENTA,
  UNIDADES_VENTA_MAP,
  UNIDADES_VENTA_SET,
  UNIDADES_FRACCIONABLES,
  UNIDADES_DISCRETAS,
  UNIDADES_COMPRA,
  UNIDADES_COMPRA_MAP,
  UNIDADES_COMPRA_SET,
  ALIASES,
  // Normalización
  normalizarUnidadVenta,
  normalizarUnidadCompra,
  // Validación
  esUnidadVentaValida,
  esUnidadCompraValida,
  // Clasificación
  esFraccionable,
  esDiscreta,
  obtenerLabelUnidadVenta,
  obtenerUnidadSat,
  obtenerGrupoUnidad,
  // Inferencia
  inferirUnidadPorNombre,
  clasificarProducto,
}
