// ════════════════════════════════════════════════════════════════════
//  FACTURAS.CONTROLLER.JS
//  src/modules/facturas/facturas.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// GET /facturas — listar con filtros
exports.listar = async (req, res) => {
  try {
    const { q, desde, hasta, estado, page = 1, take = 20 } = req.query
    const skip = (parseInt(page) - 1) * parseInt(take)

    const where = {}

    if (estado) where.estado = estado

    if (desde || hasta) {
      where.creadaEn = {}
      if (desde) where.creadaEn.gte = new Date(desde + 'T00:00:00')
      if (hasta) where.creadaEn.lte = new Date(hasta + 'T23:59:59')
    }

    if (q) {
      where.OR = [
        { rfcReceptor:    { contains: q, mode: 'insensitive' } },
        { nombreReceptor: { contains: q, mode: 'insensitive' } },
        { venta: { folio: { contains: q, mode: 'insensitive' } } }
      ]
    }

    const [data, total] = await Promise.all([
      prisma.facturaCfdi.findMany({
        where,
        skip,
        take: parseInt(take),
        orderBy: { creadaEn: 'desc' },
        include: {
          venta: { select: { folio: true, total: true, metodoPago: true } }
        }
      }),
      prisma.facturaCfdi.count({ where })
    ])

    // Stats globales
    const [pendientes, timbradas, canceladas] = await Promise.all([
      prisma.facturaCfdi.count({ where: { estado: 'PENDIENTE_TIMBRADO' } }),
      prisma.facturaCfdi.count({ where: { estado: { in: ['TIMBRADA', 'FACTURADA'] } } }),
      prisma.facturaCfdi.count({ where: { estado: 'CANCELADA' } }),
    ])

    res.json({
      success: true,
      data,
      total,
      stats: {
        total:      await prisma.facturaCfdi.count(),
        pendientes,
        timbradas,
        canceladas
      },
      paginacion: {
        pagina:      parseInt(page),
        totalPaginas: Math.ceil(total / parseInt(take))
      }
    })
  } catch (err) {
    console.error('❌ Error listando facturas:', err)
    res.status(500).json({ error: err.message })
  }
}

// GET /facturas/:id — detalle
exports.obtener = async (req, res) => {
  try {
    const factura = await prisma.facturaCfdi.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        venta: {
          select: { folio: true, total: true, metodoPago: true, creadaEn: true },
        }
      }
    })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    res.json({ success: true, data: factura })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// PATCH /facturas/:id/cancelar
exports.cancelar = async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const factura = await prisma.facturaCfdi.findUnique({ where: { id } })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.estado === 'CANCELADA') return res.status(400).json({ error: 'Ya está cancelada' })

    const actualizada = await prisma.facturaCfdi.update({
      where: { id },
      data:  { estado: 'CANCELADA' }
    })

    console.log(`✅ Factura ${id} cancelada por ${req.usuario?.nombre}`)
    res.json({ success: true, data: actualizada })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
