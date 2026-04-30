// ════════════════════════════════════════════════════════════════════
//  INVENTARIO CONTROLLER — Ajuste Rápido en Caja
//  Ubicación: src/modules/inventario/inventario.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

/**
 * POST /inventario/ajuste-rapido
 * Body: { productoId, sucursalId, nuevoStock }
 * Auth: cualquier rol activo (EMPLEADO/ADMIN_SUCURSAL/SUPERADMIN).
 *
 * Premisa: VELOCIDAD. Cajero con fila. Sin motivo escrito.
 * `notas` se autofirma como "Ajuste rápido en caja" para que en
 * auditoría se distinga de los ajustes formales del módulo de inventario.
 */
exports.ajusteRapido = async (req, res) => {
  try {
    const productoId = parseInt(req.body.productoId)
    const nuevoStock = parseFloat(req.body.nuevoStock)

    // SUPERADMIN puede tener sucursalId = null en el token → fallback
    const sucursalIdToken = req.usuario?.sucursalId
    const sucursalId      = sucursalIdToken || parseInt(req.body.sucursalId) || 1
    const usuarioId       = req.usuario?.id ? parseInt(req.usuario.id) : null

    // ── Validaciones de entrada ────────────────────────────────────
    if (!productoId || isNaN(productoId)) {
      return res.status(400).json({ error: 'productoId inválido', codigo: 'PRODUCTO_INVALIDO' })
    }
    if (isNaN(nuevoStock) || nuevoStock < 0) {
      return res.status(400).json({ error: 'nuevoStock debe ser un número >= 0', codigo: 'STOCK_INVALIDO' })
    }
    if (!sucursalId || isNaN(sucursalId)) {
      return res.status(400).json({ error: 'sucursalId inválido', codigo: 'SUCURSAL_INVALIDA' })
    }
    if (!usuarioId) {
      return res.status(401).json({ error: 'Usuario no autenticado', codigo: 'NO_AUTH' })
    }

    // ── Validar permiso por rol ────────────────────────────────────
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario || !usuario.activo) {
      return res.status(403).json({ error: 'Usuario inválido o inactivo', codigo: 'USUARIO_INACTIVO' })
    }
    const rolesPermitidos = ['EMPLEADO', 'ADMIN_SUCURSAL', 'SUPERADMIN']
    if (!rolesPermitidos.includes(usuario.rol)) {
      return res.status(403).json({ error: 'Sin permiso para ajustar inventario', codigo: 'SIN_PERMISO_AJUSTE' })
    }

    // ── Transacción ACID ───────────────────────────────────────────
    const resultado = await prisma.$transaction(async (tx) => {
      const inventario = await tx.inventarioSucursal.findUnique({
        where:   { productoId_sucursalId: { productoId, sucursalId } },
        include: { producto: { select: { nombre: true, esGranel: true, unidadVenta: true } } }
      })

      if (!inventario) {
        throw Object.assign(
          new Error(`No existe registro de inventario para producto ${productoId} en sucursal ${sucursalId}`),
          { status: 404, codigo: 'INV_NOT_FOUND' }
        )
      }

      // Soporta granel: parseFloat + toFixed(3), igual que ventas.controller.js
      const stockAntes   = parseFloat(inventario.stockActual)
      const stockDespues = parseFloat(nuevoStock.toFixed(3))
      const diferencia   = parseFloat((stockDespues - stockAntes).toFixed(3))

      // No permitir ajuste sin cambio (ensucia auditoría)
      if (diferencia === 0) {
        throw Object.assign(
          new Error('El nuevo stock es igual al actual. No hay nada que ajustar.'),
          { status: 400, codigo: 'AJUSTE_SIN_CAMBIO' }
        )
      }

      // Actualizar stock
      await tx.inventarioSucursal.update({
        where: { productoId_sucursalId: { productoId, sucursalId } },
        data:  { stockActual: stockDespues }
      })

      // Registrar movimiento — la dirección la indica `tipo`, no el signo numérico
      const tipoMovimiento = diferencia > 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO'

      await tx.movimientoInventario.create({
        data: {
          productoId,
          sucursalId,
          usuarioId,
          tipo:         tipoMovimiento,
          cantidad:     Math.abs(diferencia), // SIEMPRE positivo
          stockAntes,
          stockDespues,
          referencia:   null,
          notas:        'Ajuste rápido en caja'
        }
      })

      return {
        productoId,
        sucursalId,
        nombreProducto: inventario.producto.nombre,
        stockAntes,
        stockDespues,
        diferencia,
        tipo: tipoMovimiento
      }
    })

    return res.json({
      ok: true,
      mensaje: 'Ajuste registrado',
      data: resultado
    })

  } catch (err) {
    console.error('❌ Error ajuste-rapido:', err)
    const status = err.status || 500
    return res.status(status).json({
      error: err.message || 'Error interno al ajustar inventario',
      codigo: err.codigo || 'INTERNAL_ERROR'
    })
  }
}
