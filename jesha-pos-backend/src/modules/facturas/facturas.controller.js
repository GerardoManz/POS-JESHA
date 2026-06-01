// ════════════════════════════════════════════════════════════════════
//  FACTURAS.CONTROLLER.JS
//  src/modules/facturas/facturas.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// Inicialización de Facturapi (misma lógica que en facturacion.controller.js)
let facturapi = null
function getFacturapi() {
  if (facturapi) return facturapi
  const key = process.env.FACTURAPI_KEY
  if (!key) {
    console.warn('⚠️  FACTURAPI_KEY no configurada — cancelación SAT desactivada')
    return null
  }
  const Facturapi = require('facturapi').default
  facturapi = new Facturapi(key)
  return facturapi
}

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
        { Venta: { folio: { contains: q, mode: 'insensitive' } } }
      ]
    }

    const [data, total] = await Promise.all([
      prisma.facturaCfdi.findMany({
        where,
        skip,
        take: parseInt(take),
        orderBy: { creadaEn: 'desc' },
        include: {
          Venta: { select: { folio: true, total: true, metodoPago: true } }
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
        Venta: {
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

    if (factura.estado === 'PENDIENTE_TIMBRADO') {
      await prisma.$transaction([
        prisma.venta.update({
          where: { id: factura.ventaId },
          data: { facturaEstado: 'DISPONIBLE' }
        }),
        prisma.facturaCfdi.delete({ where: { id } })
      ])
      console.log(`🗑️ Factura PENDIENTE_TIMBRADO ${id} eliminada — venta ${factura.ventaId} liberada por ${req.usuario?.nombre}`)
      return res.json({ success: true, mensaje: 'Factura eliminada. La venta está disponible para re-facturar.' })
    }

    // TIMBRADA / FACTURADA — cancelar en SAT + BD
    if (factura.facturapiId) {
      const fp = getFacturapi()
      if (!fp) {
        return res.status(500).json({ error: 'Facturapi no configurada — cancelación SAT no disponible' })
      }
      const { motivo: motivoCancelacion = '02' } = req.body || {}
      await fp.invoices.cancel(factura.facturapiId, { motive: motivoCancelacion })
    }

    const [actualizada] = await prisma.$transaction([
      prisma.facturaCfdi.update({
        where: { id },
        data: { estado: 'CANCELADA' }
      }),
      prisma.venta.update({
        where: { id: factura.ventaId },
        data: { facturaEstado: 'DISPONIBLE' }
      })
    ])

    console.log(`✅ Factura ${id} cancelada (local + SAT) por ${req.usuario?.nombre}`)
    res.json({ success: true, data: actualizada })
  } catch (err) {
    console.error('❌ Error cancelando factura:', err)
    res.status(500).json({ error: 'No se pudo cancelar la factura: ' + err.message })
  }
}