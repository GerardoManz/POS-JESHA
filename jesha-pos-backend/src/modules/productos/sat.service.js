'use strict';

/**
 * Servicio SAT: orquesta el matcher con un caché de normalización por
 * empresa, para que el endpoint responda en milisegundos en vez de
 * re-normalizar miles de productos en cada petición del debounce.
 *
 * Caché por empresa (Map en memoria del proceso):
 *   Map<empresaId, { productos, cacheNorm, builtAt }>
 *
 * Invalidación por TIMESTAMP (no por hooks):
 *   Antes de usar el caché se consulta MAX("actualizadoEn") de la empresa.
 *   Si es más reciente que builtAt, o si venció el TTL de respaldo, se
 *   reconstruye. Producto.actualizadoEn es @updatedAt (lo mantiene Prisma
 *   en cada create/update, incluido el soft-delete de cambiarEstado), así
 *   que cualquier mutación gatilla reconstrucción sin tocar controladores.
 *
 *   La consulta de MAX NO filtra por activo: un producto desactivado
 *   cambia el conjunto de activos y su actualizadoEn nuevo debe gatillar
 *   la reconstrucción.
 *
 * Importante: el matcher tiene su propia variable de módulo _cacheNorm
 * (singleton de proceso). NO confiamos en ella entre empresas: este
 * servicio guarda un caché POR empresa y lo pasa explícito en cada
 * llamada vía opciones.cacheNorm, evitando que una empresa pise el caché
 * de otra.
 */

const prisma = require('../../lib/prisma');
const matcher = require('./sat.matcher');

const TTL_MS = 30 * 60 * 1000; // 30 min de respaldo

// Map<empresaId, { productos: Array, cacheNorm: Map, builtAt: Date }>
const _cachePorEmpresa = new Map();

/**
 * Devuelve la fecha de última modificación de cualquier producto de la
 * empresa (incluye inactivos a propósito). null si no hay productos.
 */
async function maxActualizadoEn(empresaId) {
  const agg = await prisma.producto.aggregate({
    where: { empresaId },
    _max: { actualizadoEn: true },
  });
  return agg._max.actualizadoEn || null;
}

/** Reconstruye el caché de una empresa desde cero. */
async function reconstruir(empresaId) {
  const productos = await prisma.producto.findMany({
    where: { empresaId, activo: true },
    select: { id: true, nombre: true, descripcion: true, claveSat: true, unidadSat: true },
  });
  const cacheNorm = matcher.preNormalizarProductos(productos);
  const entrada = { productos, cacheNorm, builtAt: new Date() };
  _cachePorEmpresa.set(empresaId, entrada);
  return entrada;
}

/**
 * Devuelve el caché vigente de la empresa, reconstruyéndolo si:
 *   - no existe,
 *   - venció el TTL de respaldo, o
 *   - hubo una mutación desde que se construyó (MAX(actualizadoEn) > builtAt).
 */
async function obtenerCacheEmpresa(empresaId) {
  const actual = _cachePorEmpresa.get(empresaId);

  if (!actual) return reconstruir(empresaId);

  if (Date.now() - actual.builtAt.getTime() > TTL_MS) {
    return reconstruir(empresaId);
  }

  const maxBd = await maxActualizadoEn(empresaId);
  if (maxBd && maxBd.getTime() > actual.builtAt.getTime()) {
    return reconstruir(empresaId);
  }

  return actual;
}

/**
 * Sugiere claveSat/unidadSat para un producto, con corroboración contra
 * los productos existentes de la empresa.
 *
 * @param {number} empresaId
 * @param {object} entrada - { nombre, descripcion, esGranel, unidadVenta }
 * @returns {Promise<object>} respuesta del matcher (AUTO/SUGERIR/MANUAL)
 */
async function sugerirParaProducto(empresaId, entrada) {
  const cache = await obtenerCacheEmpresa(empresaId);
  return matcher.sugerirSat(
    {
      nombre: entrada.nombre,
      descripcion: entrada.descripcion || '',
      esGranel: entrada.esGranel === true,
      unidadVenta: entrada.unidadVenta || '',
      productosExistentes: cache.productos,
    },
    { cacheNorm: cache.cacheNorm, diagnostico: false }
  );
}

/** Limpia el caché de una empresa (útil en pruebas o invalidación manual). */
function limpiarCache(empresaId) {
  if (empresaId === undefined) _cachePorEmpresa.clear();
  else _cachePorEmpresa.delete(empresaId);
}

module.exports = {
  sugerirParaProducto,
  obtenerCacheEmpresa,
  limpiarCache,
};
