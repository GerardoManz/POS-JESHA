'use strict';

/**
 * Controlador del endpoint de sugerencia SAT.
 * Separado de productos.controller.js (que ya es grande) para aislar el
 * módulo SAT. Solo LECTURA: sugiere, no valida ni guarda nada.
 *
 * Ruta: POST /productos/sat/sugerir  (requireAuth ya aplicado en el mount)
 */

const getEmpresaId = require('../../helpers/getEmpresaId');
const satService = require('./sat.service');

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

module.exports = { sugerirSat };
