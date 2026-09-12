'use strict'

const CAMPOS_ECONOMICOS_PERMITIDOS = [
  'precioVenta', 'precioBase', 'precioMayoreo',
  'costo', 'costoPromedio', 'margen',
  'costoSinIvaProveedor', 'factorConversion', 'precioCosto'
]

/**
 * Normaliza un valor Decimal/Number/String a string canónico de 4 decimales.
 * null/undefined → null
 * NaN → null
 * 10 → "10.0000"
 * "10.00" → "10.0000"
 * Decimal("10.0000") → "10.0000"
 */
function normalizarDecimal(valor) {
  if (valor === null || valor === undefined) return null
  let num
  if (typeof valor === 'string') {
    num = parseFloat(valor)
  } else if (typeof valor === 'number') {
    num = valor
  } else if (typeof valor === 'object' && typeof valor.toFixed === 'function') {
    num = parseFloat(valor.toFixed(4))
  } else {
    num = parseFloat(valor)
  }
  if (!Number.isFinite(num)) return null
  return num.toFixed(4)
}

/**
 * Compara dos valores Decimal/Number/String de forma tipada.
 * Retorna true si son equivalentes numéricamente.
 */
function iguales(a, b) {
  return normalizarDecimal(a) === normalizarDecimal(b)
}

/**
 * Detecta cambios económicos entre estado anterior y posterior.
 * Retorna array de { campo, valorAnterior, valorNuevo } solo para campos permitidos que cambiaron.
 */
function detectarCambios(antes, despues, camposPermitidos = CAMPOS_ECONOMICOS_PERMITIDOS) {
  const cambios = []
  for (const campo of camposPermitidos) {
    const valAntes = antes[campo] !== undefined ? antes[campo] : null
    const valDespues = despues[campo] !== undefined ? despues[campo] : null
    if (!iguales(valAntes, valDespues)) {
      cambios.push({
        campo,
        valorAnterior: normalizarDecimal(valAntes),
        valorNuevo: normalizarDecimal(valDespues)
      })
    }
  }
  return cambios
}

/**
 * Registra un evento de historial económico dentro de una transacción YA ABIERTA.
 *
 * @param {Object} tx - Prisma transaction client (NO abrir transaction propia)
 * @param {Object} params
 * @param {number} params.empresaId
 * @param {number} params.productoId
 * @param {number|null} params.auditoriaId
 * @param {number|null} params.usuarioId
 * @param {number|null} params.sucursalId
 * @param {number|null} params.ordenCompraId
 * @param {number|null} params.proveedorId
 * @param {string} params.origen
 * @param {string} params.accion
 * @param {string|null} params.referencia
 * @param {string|null} params.claveIdempotencia
 * @param {Object|null} params.contexto
 * @param {string|null} params.notas
 * @param {Date|null} params.ocurridoEn
 * @param {Object} params.antes - Estado anterior del producto (campos económicos)
 * @param {Object} params.despues - Estado posterior del producto (campos económicos)
 * @param {string[]|null} params.camposPermitidos - Override de campos permitidos
 *
 * @returns {{ created: boolean, header: Object|null, details: Object[] }}
 */
async function registrarHistorialEconomico(tx, params) {
  const {
    empresaId,
    productoId,
    auditoriaId = null,
    usuarioId = null,
    sucursalId = null,
    ordenCompraId = null,
    proveedorId = null,
    origen,
    accion,
    referencia = null,
    claveIdempotencia = null,
    contexto = null,
    notas = null,
    ocurridoEn = null,
    antes,
    despues,
    camposPermitidos = null
  } = params

  const campos = camposPermitidos || CAMPOS_ECONOMICOS_PERMITIDOS
  const cambios = detectarCambios(antes, despues, campos)

  if (cambios.length === 0) {
    return { created: false, header: null, details: [] }
  }

  const headerData = {
    empresaId,
    productoId,
    origen,
    accion,
    referencia,
    claveIdempotencia,
    contexto: contexto || undefined,
    notas,
    registradoEn: new Date(),
    ocurridoEn: ocurridoEn || new Date()
  }

  if (auditoriaId != null) headerData.auditoriaId = auditoriaId
  if (usuarioId != null) headerData.usuarioId = usuarioId
  if (sucursalId != null) headerData.sucursalId = sucursalId
  if (ordenCompraId != null) headerData.ordenCompraId = ordenCompraId
  if (proveedorId != null) headerData.proveedorId = proveedorId

  const header = await tx.historialPrecioProducto.create({ data: headerData })

  const details = []
  for (const cambio of cambios) {
    const detail = await tx.historialPrecioProductoDetalle.create({
      data: {
        historialId: header.id,
        campo: cambio.campo,
        valorAnterior: cambio.valorAnterior,
        valorNuevo: cambio.valorNuevo
      }
    })
    details.push(detail)
  }

  return { created: true, header, details }
}

module.exports = {
  registrarHistorialEconomico,
  detectarCambios,
  normalizarDecimal,
  iguales,
  CAMPOS_ECONOMICOS_PERMITIDOS
}
