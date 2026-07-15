// ═══════════════════════════════════════════════════════════════════
//  PRODUCTOS.HELPERS.JS — Centralización de normalización,
//  validación de duplicados, generación GEN- y parseo de errores
//  Prisma para el módulo de productos.
//
//  Todas las funciones son PURAS o aceptan dependencias inyectadas
//  (prismaClient). Ninguna depende de Express `res`.
// ═══════════════════════════════════════════════════════════════════

/**
 * Normaliza un valor de codigoBarras:
 * - null/undefined → null
 * - número → string
 * - string → trim, "" → null
 */
function normalizarCodigoBarras(valor) {
    if (valor === null || valor === undefined) return null
    const trimmed = String(valor).trim()
    return trimmed === '' ? null : trimmed
}

/**
 * Normaliza un valor de codigoInterno:
 * - null/undefined → ''
 * - número → string
 * - string → trim
 * Devuelve '' si no hay valor (el caller valida obligatoriedad)
 */
function normalizarCodigoInterno(valor) {
    if (valor === null || valor === undefined) return ''
    return String(valor).trim()
}

/**
 * Genera un código de barras GEN- secuencial para una empresa.
 * Recorre TODOS los GEN- existentes, calcula el máximo numérico real
 * (evita colisiones por padding inconsistente tipo GEN-1 vs GEN-00000002).
 *
 * @param {number} empresaId
 * @param {object} prismaClient - instancia de Prisma
 * @returns {Promise<string>} ej: "GEN-00000042"
 */
async function generarCodigoBarrasAutomatico(empresaId, prismaClient) {
    const todos = await prismaClient.producto.findMany({
        where: { codigoBarras: { startsWith: 'GEN-' }, empresaId },
        select: { codigoBarras: true }
    })
    let maxSeq = 0
    for (const p of todos) {
        if (!p.codigoBarras) continue
        const partes = p.codigoBarras.split('-')
        const num = parseInt(partes[partes.length - 1], 10)
        if (!isNaN(num) && num > maxSeq) maxSeq = num
    }
    return `GEN-${String(maxSeq + 1).padStart(8, '0')}`
}

/**
 * Valida si un codigoBarras ya existe en la misma empresa.
 * Si codigoBarras es null → OK (no viola unique constraint en PostgreSQL).
 * Si excluirId se provee, excluye ese producto de la búsqueda (útil en updates).
 *
 * @returns {Promise<object|null>} el producto duplicado o null si no hay conflicto
 */
async function validarCodigoBarrasDuplicado({ empresaId, codigoBarras, excluirId, prismaClient }) {
    if (codigoBarras === null) return null
    const where = { empresaId, codigoBarras }
    if (excluirId) where.id = { not: excluirId }
    return prismaClient.producto.findFirst({ where, select: { id: true } })
}

/**
 * Parsea un error de Prisma para productos.
 * Si es P2002 (unique constraint), devuelve un objeto con
 * { status, error, campo } listo para responder.
 * Si no es P2002, devuelve null.
 *
 * NO depende de Express res — cada controller decide cómo responder.
 */
function parsearErrorPrismaProducto(error) {
    if (!error || error.code !== 'P2002') return null
    const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(',')
        : String(error.meta?.target || '')
    const esCodigoInterno = /codigoInterno/i.test(target)
    const esCodigoBarras  = /codigoBarras/i.test(target)
    return {
        status: 409,
        error: esCodigoInterno
            ? 'El código interno ya existe en esta empresa'
            : esCodigoBarras
                ? 'El código de barras ya existe en esta empresa'
                : 'Error de duplicado al guardar el producto',
        campo: esCodigoInterno ? 'codigoInterno' : (esCodigoBarras ? 'codigoBarras' : null)
    }
}

module.exports = {
    normalizarCodigoBarras,
    normalizarCodigoInterno,
    generarCodigoBarrasAutomatico,
    validarCodigoBarrasDuplicado,
    parsearErrorPrismaProducto
}
