// ════════════════════════════════════════════════════════════════════
//  COTIZACIONES.CONTROLLER.JS
//  Ubicación: src/modules/cotizaciones/cotizaciones.controller.js
//
//  Endpoints:
//  GET    /cotizaciones              → listar (filtros + paginación)
//  GET    /cotizaciones/:id          → detalle completo
//  POST   /cotizaciones              → crear
//  PUT    /cotizaciones/:id          → editar (solo PENDIENTE)
//  PATCH  /cotizaciones/:id/estado   → cambiar estado
// ════════════════════════════════════════════════════════════════════

const service = require('./cotizaciones.service')

// ════════════════════════════════════════════════════════════════════
//  GET /cotizaciones
// ════════════════════════════════════════════════════════════════════

const listar = async (req, res) => {
  try {
    const { estado, buscar, page, limit } = req.query
    const { sucursalId, rol } = req.usuario

    const resultado = await service.listar({ sucursalId, rol, estado, buscar, page, limit })

    res.json({ success: true, ...resultado })
  } catch (err) {
    console.error('❌ Error listando cotizaciones:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /cotizaciones/:id
// ════════════════════════════════════════════════════════════════════

const obtener = async (req, res) => {
  try {
    const { id } = req.params
    const cotizacion = await service.obtenerPorId(id)

    if (!cotizacion) {
      return res.status(404).json({ success: false, error: 'Cotización no encontrada' })
    }

    res.json({ success: true, data: cotizacion })
  } catch (err) {
    console.error('❌ Error obteniendo cotización:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /cotizaciones
//  Body: { clienteId?, detalles, notas?, venceEn? }
//  detalles: [{ productoId, cantidad, precioUnitario? }]
// ════════════════════════════════════════════════════════════════════

const crear = async (req, res) => {
  try {
    const { clienteId, tipo = 'PRODUCTOS', detalles, notas, venceEn } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    // Validaciones básicas
    if (!detalles || !Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'La cotización debe tener al menos 1 producto',
        campo: 'detalles'
      })
    }

    if (!sucursalId) {
      return res.status(400).json({
        success: false,
        error: 'Usuario sin sucursal asignada'
      })
    }

    for (const [i, d] of detalles.entries()) {
  if (!d.cantidad || d.cantidad <= 0) {
    return res.status(400).json({
      success: false,
      error: `Detalle [${i}]: cantidad debe ser mayor a 0`
    })
  }
  // productoId solo requerido en tipo PRODUCTOS
  if (tipo === 'PRODUCTOS' && !d.productoId) {
    return res.status(400).json({
      success: false,
      error: `Detalle [${i}]: productoId requerido para cotizaciones de productos`
    })
  }
  // concepto requerido en tipo SERVICIOS
  if (tipo === 'SERVICIOS' && !d.concepto?.trim()) {
    return res.status(400).json({
      success: false,
      error: `Detalle [${i}]: concepto requerido para cotizaciones de servicios`
    })
  }
}

    const cotizacion = await service.crear({
      sucursalId,
      usuarioId,
      clienteId,
      tipo,
      detalles,
      notas,
      venceEn
    })

    res.status(201).json({ success: true, data: cotizacion })
  } catch (err) {
    console.error('❌ Error creando cotización:', err.message)
    const status = err.message.includes('no encontrado') ? 400 : 500
    res.status(status).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PUT /cotizaciones/:id
//  Body: { clienteId?, notas?, venceEn?, detalles? }
// ════════════════════════════════════════════════════════════════════

const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { clienteId, notas, venceEn, detalles } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    const cotizacion = await service.editar(id, {
      clienteId,
      notas,
      venceEn,
      detalles,
      usuarioId,
      sucursalId
    })

    res.json({ success: true, data: cotizacion })
  } catch (err) {
    console.error('❌ Error editando cotización:', err.message)
    const status = err.message.includes('no encontrada') ? 404
      : err.message.includes('No se puede editar') ? 400
      : 500
    res.status(status).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /cotizaciones/:id/estado
//  Body: { estado: 'PENDIENTE' | 'CONVERTIDA' | 'VENCIDA' | 'CANCELADA' }
// ════════════════════════════════════════════════════════════════════

const cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params
    const { estado } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    if (!estado) {
      return res.status(400).json({ success: false, error: 'Campo "estado" requerido' })
    }

    const cotizacion = await service.cambiarEstado(id, estado, { usuarioId, sucursalId })

    res.json({ success: true, data: cotizacion })
  } catch (err) {
    console.error('❌ Error cambiando estado:', err.message)
    const status = err.message.includes('no encontrada') ? 404
      : err.message.includes('inválido') ? 400
      : 500
    res.status(status).json({ success: false, error: err.message })
  }
}

module.exports = { listar, obtener, crear, editar, cambiarEstado }