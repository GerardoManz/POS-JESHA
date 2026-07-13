/**
 * Verifica el estado de stock de productos después de una operación.
 * Devuelve los productos que quedaron SIN_STOCK o STOCK_BAJO.
 *
 * @param {Object} prisma - Instancia de Prisma
 * @param {number} empresaId
 * @param {number} sucursalId
 * @param {number[]} productoIds - IDs de los productos afectados en la operación
 * @returns {Promise<Array>} [{ productoId, nombre, codigoInterno, stockActual, stockMinimo, precioVenta, estado }]
 */
async function verificarStockPostOperacion(prisma, empresaId, sucursalId, productoIds) {
  if (!productoIds || productoIds.length === 0) return []

  const ids = productoIds.map(id => parseInt(id)).filter(id => !isNaN(id))
  if (ids.length === 0) return []

  const inventarios = await prisma.inventarioSucursal.findMany({
    where: { sucursalId, productoId: { in: ids } },
    include: {
      Producto: { select: { nombre: true, codigoInterno: true, precioVenta: true } }
    }
  })

  return inventarios
    .filter(inv => parseFloat(inv.stockActual) <= parseFloat(inv.stockMinimoAlerta))
    .map(inv => ({
      productoId: inv.productoId,
      nombre: inv.Producto.nombre,
      codigoInterno: inv.Producto.codigoInterno || '—',
      stockActual: parseFloat(inv.stockActual),
      stockMinimo: parseFloat(inv.stockMinimoAlerta),
      precioVenta: inv.Producto.precioVenta ? parseFloat(inv.Producto.precioVenta) : 0,
      estado: parseFloat(inv.stockActual) <= 0 ? 'SIN_STOCK' : 'STOCK_BAJO'
    }))
}

module.exports = { verificarStockPostOperacion }
