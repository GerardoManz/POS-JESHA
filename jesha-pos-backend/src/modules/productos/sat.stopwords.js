'use strict';

/**
 * Stopwords adicionales para el matching SAT.
 *
 * Este archivo concentra marcas, lineas comerciales y palabras de empaque que
 * aparecen mucho en la BD pero no determinan la clave SAT por si solas. Todos
 * los tokens deben estar en minusculas y sin acentos, tal como salen del
 * normalizador.
 */

const STOPWORDS_MARCAS = new Set([
  // Top marcas detectadas en la BD JESHA.
  'truper', 'pretul', 'volteck', 'foset', 'fiero', 'vianti', 'hermex',
  'iusa', 'igoto', 'coflex', 'byp', 'tuk', 'oatey', 'contact', 'dexter',
  'rotoplas', 'bardahl', 'energizer', 'tecno', 'lite', 'tecnolite',
  'bosch', 'makita', 'dewalt', 'stanley', 'surtek', 'urrea', 'aqua',
  'resistol', 'loctite', 'devcon', 'sista', 'siler', 'infra', 'hecort',
  'fandeli', 'textuco', 'apasco', 'cemex', 'monterrey', 'lorenzetti',
  'radar', 'boris', 'boro', 'motul', 'gram', 'bel', 'handy', 'home',
  'lion', 'tools', 'exito', 'inner', 'forte', 'pens', 'kobrex', 'aquaplas',
  'iusaplus', 'fidic', 'maxi', 'imper', 'ultra', 'color', 'plus', 'basic',
  'expert', 'rustico', 'vistrom', 'vistron', 'bylack', 'solprac', 'win',
  'avante', 'fleximatic', 'bticino', 'kw', 'tae', 'promax', 'valvo',
  'simon', 'forza', 'dica', 'noman', 'alco', 'cobesa', 'tolsen', 'evesa',
  'kliker', 'ortop', 'karcher', 'mimsa', 'jama', 'banner', 'malibu',
]);

const STOPWORDS_COMERCIALES = new Set([
  // Lineas, calidades, presentaciones y textos promocionales.
  'profesional', 'industrial', 'comercial', 'domestico', 'hogar', 'uso',
  'general', 'multiusos', 'reforzado', 'reforzada', 'premium', 'economico',
  'economica', 'standard', 'std', 'estandar', 'heavy', 'duty', 'rudo',
  'ligero', 'ligera', 'maxima', 'maximo', 'minimo', 'mini', 'super',
  'blister', 'bolsa', 'caja', 'paquete', 'kit', 'juego', 'set', 'duo',
  'pieza', 'piezas', 'repuesto', 'repuestos', 'refaccion', 'refacciones',
  'accesorio', 'accesorios', 'varios', 'surtido', 'surtida', 'modelo',
  'linea', 'serie', 'tipo', 'talla', 'no', 'num', 'numero', 'codigo',
]);

const STOPWORDS_COLORES = new Set([
  // El color rara vez decide la clave; se conserva solo si una regla directa
  // lo necesita fuera del normalizador.
  'blanco', 'blanca', 'negro', 'negra', 'gris', 'rojo', 'roja', 'azul',
  'verde', 'amarillo', 'amarilla', 'naranja', 'cafe', 'beige', 'marfil',
  'transparente', 'traslucido', 'traslucida', 'natural', 'naturales',
  'cromo', 'cromado', 'cromada', 'satin', 'mate', 'oro', 'plata',
]);

const STOPWORDS_EXTRA = new Set([
  ...STOPWORDS_MARCAS,
  ...STOPWORDS_COMERCIALES,
  ...STOPWORDS_COLORES,
]);

module.exports = {
  STOPWORDS_EXTRA,
  STOPWORDS_MARCAS,
  STOPWORDS_COMERCIALES,
  STOPWORDS_COLORES,
};
