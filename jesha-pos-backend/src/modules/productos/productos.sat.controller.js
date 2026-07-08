'use strict';

/**
 * Controlador del endpoint de sugerencia SAT.
 * Separado de productos.controller.js (que ya es grande) para aislar el
 * módulo SAT. Solo LECTURA: sugiere, no valida ni guarda nada.
 *
 * Rutas SAT read-only (requireAuth ya aplicado en el mount):
 *   POST /productos/sat/sugerir
 *   GET  /productos/sat/unidades
 */

const getEmpresaId = require('../../helpers/getEmpresaId');
const satService = require('./sat.service');
const { WHITELIST_UNIDADES } = require('./sat.listas');
const unidadesSatRaw = require('../../data/sat/raw/c_ClaveUnidad.json');

const UNIDADES_SAT_COMUNES_EXTRA = new Set([
  'MTQ', 'MMT', 'GRM', 'MLT', 'TNE', 'XBX', 'XRO', 'XSA', 'XBG', 'XBO',
  'XDR', 'XCY', 'XBJ', 'XCA', 'XCX', 'E48', 'DAY', 'WEE',
]);

const UNIDADES_SAT_COMUNES = new Set([...WHITELIST_UNIDADES, ...UNIDADES_SAT_COMUNES_EXTRA]);

const UNIDADES_VENTA_OPERATIVAS = [
  { valor: 'PZA', unidadSat: 'H87', nombre: 'Pieza', aliases: ['PZ', 'PZAS', 'PIEZA'] },
  { valor: 'MT', unidadSat: 'MTR', nombre: 'Metro', aliases: ['M', 'MTS', 'METRO'] },
  { valor: 'KG', unidadSat: 'KGM', nombre: 'Kilogramo', aliases: ['KILO', 'KILOS'] },
  { valor: 'LT', unidadSat: 'LTR', nombre: 'Litro', aliases: ['L', 'LTS', 'LITRO'] },
  { valor: 'PAQUETE', unidadSat: 'XPK', nombre: 'Paquete', aliases: ['PACK', 'PAQ'] },
  { valor: 'PAR', unidadSat: 'PR', nombre: 'Par', aliases: [] },
  { valor: 'KIT', unidadSat: 'KT', nombre: 'Kit', aliases: [] },
  { valor: 'JUEGO', unidadSat: 'SET', nombre: 'Juego', aliases: ['SET'] },
  { valor: 'CAJA', unidadSat: 'XBX', nombre: 'Caja', aliases: [] },
  { valor: 'ROLLO', unidadSat: 'XRO', nombre: 'Rollo', aliases: [] },
];

const UNIDADES_COMPRA_OPERATIVAS = [
  { valor: 'CAJA', unidadSat: 'XBX', nombre: 'Caja', aliases: [] },
  { valor: 'BULTO', unidadSat: 'XSA', nombre: 'Bulto / saco', aliases: ['SACO'] },
  { valor: 'ROLLO', unidadSat: 'XRO', nombre: 'Rollo', aliases: [] },
  { valor: 'PZA', unidadSat: 'H87', nombre: 'Pieza', aliases: ['PZ', 'PZAS', 'PIEZA'] },
  { valor: 'PAQUETE', unidadSat: 'XPK', nombre: 'Paquete', aliases: ['PACK', 'PAQ'] },
  { valor: 'MT', unidadSat: 'MTR', nombre: 'Metro', aliases: ['M', 'MTS', 'METRO'] },
  { valor: 'KG', unidadSat: 'KGM', nombre: 'Kilogramo', aliases: ['KILO', 'KILOS'] },
  { valor: 'LT', unidadSat: 'LTR', nombre: 'Litro', aliases: ['L', 'LTS', 'LITRO'] },
  { valor: 'TAMBOR', unidadSat: 'XDR', nombre: 'Tambor', aliases: [] },
  { valor: 'CILINDRO', unidadSat: 'XCY', nombre: 'Cilindro', aliases: [] },
  { valor: 'CUBETA', unidadSat: 'XBJ', nombre: 'Cubeta', aliases: [] },
  { valor: 'LATA', unidadSat: 'XCA', nombre: 'Lata', aliases: [] },
  { valor: 'BOLSA', unidadSat: 'XBG', nombre: 'Bolsa', aliases: [] },
  { valor: 'BOTELLA', unidadSat: 'XBO', nombre: 'Botella', aliases: [] },
  { valor: 'PAR', unidadSat: 'PR', nombre: 'Par', aliases: [] },
  { valor: 'KIT', unidadSat: 'KT', nombre: 'Kit', aliases: [] },
  { valor: 'JUEGO', unidadSat: 'SET', nombre: 'Juego', aliases: ['SET'] },
];

const unidadesSat = unidadesSatRaw
  .map((u) => ({
    id: String(u.id || '').trim(),
    nombre: String(u.nombre || '').trim(),
    simbolo: String(u.simbolo || '').trim(),
    esComun: UNIDADES_SAT_COMUNES.has(String(u.id || '').trim()),
  }))
  .filter((u) => u.id && u.nombre)
  .sort((a, b) => {
    if (a.esComun !== b.esComun) return a.esComun ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

const unidadesPorId = new Map(unidadesSat.map((u) => [u.id, u]));

function enriquecerUnidadOperativa(op) {
  const sat = unidadesPorId.get(op.unidadSat);
  return {
    valor: op.valor,
    unidadSat: op.unidadSat,
    nombre: op.nombre || sat?.nombre || op.valor,
    simbolo: sat?.simbolo || '',
    aliases: op.aliases || [],
    esComun: true,
  };
}

/**
 * POST /productos/sat/sugerir
 * Body: { nombre, descripcion?, esGranel?, unidadVenta?, categoriaId? }
 *   categoriaId se recibe pero NO se usa (reservado Fase 7).
 * Responde: { success, data: <resultado matcher> }
 */
async function sugerirSat(req, res, next) {
  try {
    const empresaId = getEmpresaId(req); // throw 401 si no hay empresaId

    const { nombre, descripcion, esGranel, unidadVenta } = req.body || {};

    if (typeof nombre !== 'string' || nombre.trim() === '') {
      return res.status(400).json({ success: false, error: 'El campo "nombre" es requerido' });
    }

    const data = await satService.sugerirParaProducto(empresaId, {
      nombre,
      descripcion,
      esGranel,
      unidadVenta,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

function listarUnidades(req, res, next) {
  try {
    return res.json({
      success: true,
      data: {
        unidadesSat,
        unidadVenta: UNIDADES_VENTA_OPERATIVAS.map(enriquecerUnidadOperativa),
        unidadCompra: UNIDADES_COMPRA_OPERATIVAS.map(enriquecerUnidadOperativa),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { sugerirSat, listarUnidades };
