// ════════════════════════════════════════════════════════════════════
//  PRECIOS.CONTROLLER.JS — PATCH /:id
//  Acceso: PRECIOS, ADMIN_SUCURSAL, SUPERADMIN, PLATFORM_ADMIN
//  Permite actualizar solo campos de precio, no otros datos del producto.
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const { FACTOR_IVA } = require('../../utils/constantes')

async function actualizarPrecios(req, res) {
  try {
    const { id } = req.params
    const { precioBase, precioVenta, precioMayoreo, margen } = req.body
    const solicitante = req.usuario

    // Paso 1: validar que al menos un campo venga (contra undefined, no falsy — el 0 es legítimo)
    if (precioBase === undefined && precioVenta === undefined &&
        precioMayoreo === undefined && margen === undefined) {
      return res.status(400).json({ error: 'Envía al menos un campo: precioBase, precioVenta, precioMayoreo o margen' })
    }

    // Paso 2: rechazar ambigüedad entre margen y precioVenta
    if (margen !== undefined && precioVenta !== undefined) {
      return res.status(400).json({
        error: 'Envía margen o precioVenta, no ambos. Si envías margen, el sistema calcula precioVenta automáticamente.'
      })
    }

    // TODO: validar sucursalId del usuario vs alcance del producto cuando exista campo/relación directa

    // Obtener producto actual (para auditoría y costo)
    const producto = await prisma.producto.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true, nombre: true, costo: true,
        precioBase: true, precioVenta: true, precioMayoreo: true, margen: true
      }
    })

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    // Paso 3: resolver margen → precioVenta
    let nuevoPrecioVenta = precioVenta !== undefined ? parseFloat(precioVenta) : undefined
    let nuevoMargen = margen !== undefined ? parseFloat(margen) : undefined
    let nuevoPrecioBase = precioBase !== undefined ? parseFloat(precioBase) : undefined

    if (margen !== undefined) {
      const costo = producto.costo ? parseFloat(producto.costo) : null
      if (!costo) {
        return res.status(400).json({ error: 'No se puede calcular precioVenta: el producto no tiene costo registrado' })
      }
      nuevoPrecioVenta = parseFloat((costo * (1 + nuevoMargen / 100)).toFixed(2))
      nuevoPrecioBase = parseFloat((nuevoPrecioVenta / FACTOR_IVA).toFixed(2))
    }

    // Paso 4: si solo precioVenta, recalcular margen y precioBase
    if (precioVenta !== undefined && margen === undefined) {
      const costo = producto.costo ? parseFloat(producto.costo) : null
      if (costo) {
        nuevoMargen = parseFloat(((nuevoPrecioVenta / costo - 1) * 100).toFixed(2))
      }
      // precioBase siempre se recalcula cuando cambia precioVenta
      nuevoPrecioBase = parseFloat((nuevoPrecioVenta / FACTOR_IVA).toFixed(2))
    }

    // Si llega precioBase manual sin precioVenta ni margen, se respeta (API avanzada)

    // Paso 5: construir data para el update (solo campos recibidos)
    const data = {}
    if (nuevoPrecioBase !== undefined)    data.precioBase    = nuevoPrecioBase
    if (nuevoPrecioVenta !== undefined) data.precioVenta    = nuevoPrecioVenta
    if (precioMayoreo !== undefined) data.precioMayoreo = parseFloat(precioMayoreo)
    if (nuevoMargen !== undefined)   data.margen        = nuevoMargen

    // Paso 6: actualizar producto
    const actualizado = await prisma.producto.update({
      where: { id: parseInt(id) },
      data,
      select: {
        id: true, nombre: true,
        precioBase: true, precioVenta: true, precioMayoreo: true,
        margen: true, costo: true
      }
    })

    // Paso 7: auditoría de cambios
    // No se usa transacción para read + write porque:
    // - Es un endpoint de baja contención (no se editan precios simultáneamente)
    // - Si hay race condition, el último valor gana — no hay invariante de negocio que romper
    // - Una transacción añadiría complejidad innecesaria en este caso
    const cambios = []
    if (nuevoPrecioBase !== undefined && parseFloat(producto.precioBase) !== parseFloat(actualizado.precioBase)) {
      cambios.push(`precioBase: ${producto.precioBase} → ${actualizado.precioBase}`)
    }
    if (nuevoPrecioVenta !== undefined && parseFloat(producto.precioVenta) !== parseFloat(actualizado.precioVenta)) {
      cambios.push(`precioVenta: ${producto.precioVenta} → ${actualizado.precioVenta}`)
    }
    if (precioMayoreo !== undefined && parseFloat(producto.precioMayoreo) !== parseFloat(actualizado.precioMayoreo)) {
      cambios.push(`precioMayoreo: ${producto.precioMayoreo} → ${actualizado.precioMayoreo}`)
    }
    if (nuevoMargen !== undefined && parseFloat(producto.margen) !== parseFloat(actualizado.margen)) {
      cambios.push(`margen: ${producto.margen} → ${actualizado.margen}`)
    }

    if (cambios.length > 0) {
      try {
        const auditoriaData = {
          accion: 'ACTUALIZAR_PRECIOS',
          modulo: 'precios',
          referencia: `Producto #${producto.id} — ${producto.nombre}`,
          valorAntes: {
            precioBase: producto.precioBase ? producto.precioBase.toString() : null,
            precioVenta: producto.precioVenta ? producto.precioVenta.toString() : null,
            precioMayoreo: producto.precioMayoreo ? producto.precioMayoreo.toString() : null,
            margen: producto.margen ? producto.margen.toString() : null
          },
          valorDespues: {
            precioBase: actualizado.precioBase ? actualizado.precioBase.toString() : null,
            precioVenta: actualizado.precioVenta ? actualizado.precioVenta.toString() : null,
            precioMayoreo: actualizado.precioMayoreo ? actualizado.precioMayoreo.toString() : null,
            margen: actualizado.margen ? actualizado.margen.toString() : null
          },
          ip: req.ip
        }
        if (solicitante.sucursalId) auditoriaData.sucursalId = solicitante.sucursalId
        if (solicitante.id)         auditoriaData.usuarioId  = solicitante.id
        await prisma.auditoria.create({ data: auditoriaData })
      } catch (e) { console.error('Audit error:', e.message) }
    }

    res.json({ success: true, producto: actualizado, cambios })
  } catch (err) {
    console.error('Error al actualizar precios:', err)
    res.status(500).json({ error: 'Error al actualizar precios' })
  }
}

module.exports = { actualizarPrecios }
