// ════════════════════════════════════════════════════════════════════
//  FACTURAS.CONTROLLER.JS
//  src/modules/facturas/facturas.controller.js
//
//  Fase 2.5 — Multi-venta vía FacturaVenta con FALLBACK LEGACY.
//  cancelar() ENDURECIDO (anti-desync fiscal):
//   - Consulta el estado real en Facturapi (retrieve) antes de tocar la BD.
//   - INVARIANTE: solo marca CANCELADA local cuando el SAT confirma status='canceled'.
//   - Cancelación pendiente de aceptación → NO desincroniza, no libera la venta.
//   - "Invoice not found" en modo LIVE → no auto-cancela; exige confirmacionManual.
//   - Audita cada operación en Auditoria.
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const resolverDatosEmisor = require('../../helpers/resolverDatosEmisor')
const getEmpresaId = require('../../helpers/getEmpresaId')
const resolverSucursalId = require('../sucursal/sucursal.helper')
const { getFacturapiForEmpresa, verificarFacturacionEmpresa, FiscalError, modoActivo } = require('../../lib/facturapi')
const { trackFacturapi } = require('../../lib/debug')
const { buildFacturaScope, buildVentaScopeFacturas } = require('./factura-scope.helper')
const { buildGlobalInvoicePayload, METODOS_GLOBALES, PERIODICIDAD_FACTURAPI } = require('../facturacion/facturacion.controller')
const { mapFacturaState, mapFpError, validateMotivo, buildCancellationResponse } = require('./factura-cancelacion.mapper')

// Helper: ventas asociadas a una factura.
// FUENTE DE VERDAD = FacturaVenta. Fallback legacy a FacturaCfdi.ventaId
// para facturas creadas antes del backfill/retrofit. NO NEGOCIABLE.
async function obtenerVentaIdsDeFactura(facturaId, ventaIdLegacy) {
  const relaciones = await prisma.facturaVenta.findMany({
    where: { facturaId },
    select: { ventaId: true }
  })
  if (relaciones.length > 0) return relaciones.map(r => r.ventaId)
  return ventaIdLegacy != null ? [ventaIdLegacy] : []
}

function agruparVentasGlobalesPorSucursal(ventas) {
  const grupos = new Map()
  for (const venta of ventas) {
    const key = venta.sucursalId ?? null
    if (!grupos.has(key)) grupos.set(key, [])
    grupos.get(key).push(venta)
  }
  return new Map([...grupos.entries()].sort(([a], [b]) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER)))
}

exports.agruparVentasGlobalesPorSucursal = agruparVentasGlobalesPorSucursal

// Marca la factura CANCELADA y libera sus ventas (DISPONIBLE + procesoFacturaId=null).
// El índice parcial FacturaCfdi_ventaId_viva_key libera el cupo para re-facturar.
// P0-BRANCH-ISOLATION: invoiceScope (FacturaCfdi) y ventaScope (Venta) son INDEPENDIENTES.
// invoiceScope puede contener OR (rama), por eso la escritura usa updateMany.
async function marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds) {
  const [fRes, vRes] = await prisma.$transaction([
    prisma.facturaCfdi.updateMany({
      where: { id, ...invoiceScope },
      data: { estado: 'CANCELADA' }
    }),
    prisma.venta.updateMany({
      where: { id: { in: ventaIds }, ...ventaScope },
      data: { facturaEstado: 'DISPONIBLE', procesoFacturaId: null }
    })
  ])
  if (fRes.count !== 1) {
    const err = new Error('Factura no encontrada o fuera de alcance')
    err.status = 404
    throw err
  }
  return { id, estado: 'CANCELADA', ventasLiberadas: vRes.count }
}

// Auditoría de cancelación. No interrumpe el flujo si falla.
async function auditarCancelacion(req, factura, ventaIds, detalle) {
  try {
    await prisma.auditoria.create({
      data: {
        accion:      'CANCELAR_FACTURA',
        modulo:      'facturas',
        referencia:  `factura:${factura.id}`,
        usuarioId:   req.usuario?.id ?? null,
        empresaId:   factura.empresaId ?? null,
        sucursalId:  resolverSucursalId(req),
        ip:          req.ip,
        valorAntes:  { estado: factura.estado, facturapiId: factura.facturapiId, folioFiscal: factura.folioFiscal },
        valorDespues: { ventaIds, ...detalle }
      }
    })
  } catch (e) {
    console.error('Audit error (cancelar):', e.message)
  }
}

// P0-7: Estados válidos del enum EstadoFactura (fuente canónica del schema)
const ESTADOS_FACTURA_VALIDOS = ['DISPONIBLE', 'FACTURADA', 'VENCIDA', 'CANCELADA', 'BLOQUEADA', 'PENDIENTE_TIMBRADO', 'TIMBRADA']

// P0-7: Timezone offset para fechas operativas — misma convención que previewGlobal/timbrarGlobal
const TZ_OFFSET = '-06:00'

// GET /facturas — listar con filtros
exports.listar = async (req, res) => {
  try {
    const whereScope = buildFacturaScope(req)

    const { q, desde, hasta, estado, metodoPago, page = 1, take = 20 } = req.query
    const skip = (parseInt(page) - 1) * parseInt(take)

    const where = { ...whereScope }

    // P0-7: validar estado contra enum canónico — 400 controlado, nunca 500
    if (estado) {
      if (!ESTADOS_FACTURA_VALIDOS.includes(estado)) {
        return res.status(400).json({ error: 'Estado de factura inválido', estadosValidos: ESTADOS_FACTURA_VALIDOS })
      }
      where.estado = estado
    }

    // P0-7: fechas con timezone offset consistente (misma convención que previewGlobal)
    if (desde || hasta) {
      if (desde && isNaN(Date.parse(desde + 'T00:00:00.000' + TZ_OFFSET))) {
        return res.status(400).json({ error: 'Fecha "desde" inválida' })
      }
      if (hasta && isNaN(Date.parse(hasta + 'T23:59:59.999' + TZ_OFFSET))) {
        return res.status(400).json({ error: 'Fecha "hasta" inválida' })
      }
      if (desde && hasta && desde > hasta) {
        return res.status(400).json({ error: 'La fecha "desde" no puede ser mayor que "hasta"' })
      }
      where.creadaEn = {}
      if (desde) where.creadaEn.gte = new Date(desde + 'T00:00:00.000' + TZ_OFFSET)
      if (hasta) where.creadaEn.lte = new Date(hasta + 'T23:59:59.999' + TZ_OFFSET)
    }

    if (q || metodoPago) {
      where.AND = []
      if (q) {
        where.AND.push({
          OR: [
            { rfcReceptor:    { contains: q, mode: 'insensitive' } },
            { nombreReceptor: { contains: q, mode: 'insensitive' } },
            // Folio de la venta directa (individual legacy)
            { Venta: { folio: { contains: q, mode: 'insensitive' } } },
            // Folio de cualquier venta asociada vía FacturaVenta (conjunta/global)
            { FacturaVenta: { some: { Venta: { folio: { contains: q, mode: 'insensitive' } } } } }
          ]
        })
      }
      if (metodoPago) {
        where.AND.push({
          OR: [
            { Venta: { metodoPago } },
            { FacturaVenta: { some: { Venta: { metodoPago } } } }
          ]
        })
      }
    }

    const [data, total] = await Promise.all([
      prisma.facturaCfdi.findMany({
        where,
        skip,
        take: parseInt(take),
        orderBy: { creadaEn: 'desc' },
        include: {
          Venta:  { select: { folio: true, total: true, metodoPago: true, Sucursal: { select: { id: true, nombre: true } } } },
          FacturaVenta: {
            take: 1,
            include: { Venta: { select: { metodoPago: true, Sucursal: { select: { id: true, nombre: true } } } } }
          },
          _count: { select: { FacturaVenta: true } }
        }
      }),
      prisma.facturaCfdi.count({ where })
    ])

    const dataConConteo = data.map(f => {
      const { _count, FacturaVenta: fv, ...rest } = f
      const ventasCount = (_count?.FacturaVenta || 0) || (f.ventaId != null ? 1 : 0)
      const metodoPagoCalculado = f.Venta?.metodoPago || fv?.[0]?.Venta?.metodoPago || null
      const sucursal = fv?.[0]?.Venta?.Sucursal || f.Venta?.Sucursal || null
      return { ...rest, ventasCount, metodoPago: metodoPagoCalculado, sucursal }
    })

    const [pendientes, timbradas, canceladas, inciertas] = await Promise.all([
      prisma.facturaCfdi.count({ where: { ...whereScope, estado: 'PENDIENTE_TIMBRADO', procesandoTimbrado: false } }),
      prisma.facturaCfdi.count({ where: { ...whereScope, estado: { in: ['TIMBRADA', 'FACTURADA'] } } }),
      prisma.facturaCfdi.count({ where: { ...whereScope, estado: 'CANCELADA' } }),
      prisma.facturaCfdi.count({ where: { ...whereScope, estado: 'PENDIENTE_TIMBRADO', procesandoTimbrado: true } }),
    ])

    res.json({
      success: true,
      data: dataConConteo,
      total,
      stats: {
        total:      await prisma.facturaCfdi.count({ where: whereScope }),
        pendientes,
        timbradas,
        canceladas,
        inciertas
      },
      paginacion: {
        pagina:      parseInt(page),
        totalPaginas: Math.ceil(total / parseInt(take))
      }
    })
  } catch (err) {
    console.error('❌ Error listando facturas:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message })
  }
}

// GET /facturas/:id — detalle
exports.obtener = async (req, res) => {
  try {
    const whereScope = buildFacturaScope(req)

    const factura = await prisma.facturaCfdi.findFirst({
      where: { id: parseInt(req.params.id), ...whereScope },
      include: {
        Venta: {
          select: { folio: true, total: true, metodoPago: true, creadaEn: true },
        },
        FacturaVenta: {
          include: {
            Venta: { select: { id: true, folio: true, total: true, metodoPago: true, creadaEn: true, sucursalId: true, Sucursal: { select: { id: true, nombre: true } } } }
          }
        }
      }
    })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })

    const ventas = factura.FacturaVenta.length
      ? factura.FacturaVenta.map(fv => fv.Venta)
      : (factura.Venta ? [factura.Venta] : [])

    const data = { ...factura, ventas, sucursal: ventas[0]?.Sucursal || null }
    delete data.FacturaVenta

    res.json({ success: true, data })
  } catch (err) {
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message })
  }
}

// PATCH /facturas/:id/cancelar — ENDURECIDO (anti-desync fiscal)
exports.cancelar = async (req, res) => {
  try {
    // P0-BRANCH-ISOLATION: scope de la factura (lectura/escritura de FacturaCfdi)
    // y scope de las ventas a liberar son independientes.
    const invoiceScope = buildFacturaScope(req)
    const ventaScope = buildVentaScopeFacturas(req)

    const id = parseInt(req.params.id)
    const { motivo: motivoCancelacion = '02', confirmacionManual } = req.body || {}

    const motivoInfo = validateMotivo(motivoCancelacion)
    if (!motivoInfo) {
      return res.status(400).json({ error: 'Motivo de cancelación inválido. Usa 01, 02, 03 o 04.', codigo: 'MOTIVO_INVALIDO' })
    }

    // P0-6: motivo 01 requiere UUID de sustitución (solo para envío a Facturapi)
    const { substitutionUUID } = req.body || {}
    // Deferimos la validación: si no hay facturapiId, el UUID no es necesario (cancelación local)

    const factura = await prisma.facturaCfdi.findFirst({ where: { id, ...invoiceScope } })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.estado === 'CANCELADA') return res.status(400).json({ error: 'Ya está cancelada' })

    // Guard: timbrado en proceso/incierto → no cancelar a ciegas (podría estar sellándose).
    if (factura.procesandoTimbrado) {
      return res.status(409).json({
        error: 'Hay un timbrado en proceso o con resultado desconocido para esta factura. Reconcilia el timbrado antes de cancelar.'
      })
    }

    const ventaIds = await obtenerVentaIdsDeFactura(factura.id, factura.ventaId)

    // ── Caso A: SIN facturapiId (PENDIENTE nunca sellada) → cancelación local ──
    if (!factura.facturapiId) {
      const actualizada = await marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds)
      const warning = (factura.idempotencyKey == null)
        ? 'Esta factura pendiente no tenía clave de idempotencia. Verifica manualmente en Facturapi que no haya quedado timbrada antes de re-facturar la venta.'
        : undefined
      await auditarCancelacion(req, factura, ventaIds, { tipo: 'LOCAL_SIN_CFDI', motivo: motivoCancelacion })
      console.log(`✅ Factura ${id} cancelada (local, sin CFDI) — ${ventaIds.length} venta(s) liberada(s) por ${req.usuario?.nombre}`)
      return res.json({ success: true, data: actualizada, ...(warning ? { warning } : {}) })
    }

    // ── Caso B: CON facturapiId → consultar estado REAL en Facturapi ──
    // P0-6: motivo 01 requiere UUID de sustitución (solo cuando hay CFDI en Facturapi)
    if (motivoInfo.requiresSubstitution && !substitutionUUID) {
      return res.status(400).json({
        error: 'El motivo 01 (errores con relación) requiere un UUID de factura de sustitución.',
        codigo: 'SUBSTITUTION_UUID_REQUIRED'
      })
    }

    // ── FAIL-CLOSED (P1): cliente de la Organization PROPIA de la empresa ──
    let fp
    try {
      await verificarFacturacionEmpresa(factura.empresaId)
      fp = await getFacturapiForEmpresa(factura.empresaId)
    } catch (err) {
      if (err instanceof FiscalError) return res.status(err.status).json({ error: err.message, codigo: err.code })
      throw err
    }

    // P0-6: usar updateStatus() en vez de retrieve() para forzar consulta SAT actualizada
    let invoiceRemoto
    try {
      invoiceRemoto = await trackFacturapi('invoices.updateStatus', { facturaId: id }, () => fp.invoices.updateStatus(factura.facturapiId))
    } catch (fpErr) {
      const noEncontrado = fpErr?.status === 404 || /not\s*found|no\s*(se\s*)?encontr/i.test(fpErr?.message || '')
      if (!noEncontrado) {
        const fpCode = fpErr?.code || fpErr?.error?.code
        const mapped = mapFpError(fpCode, 'No se pudo consultar el CFDI en Facturapi: ' + fpErr.message)
        console.error(`❌ updateStatus() falló (factura ${id}):`, fpErr.message)
        return res.status(502).json({ error: mapped.message, codigo: fpCode || 'FP_ERROR', retryable: mapped.retryable, suggestSync: mapped.suggestSync })
      }

      if (modoActivo() === 'live' && !confirmacionManual) {
        return res.status(409).json({
          error: 'El CFDI no se encontró en la cuenta de Facturapi activa. En modo live no se cancela automáticamente. Verifica en el portal del SAT que el CFDI no exista o ya esté cancelado, y reenvía la solicitud con "confirmacionManual" (texto describiendo lo que verificaste).',
          requiereConfirmacionManual: true
        })
      }

      const actualizada = await marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds)
      await auditarCancelacion(req, factura, ventaIds, {
        tipo: 'LOCAL_CFDI_NO_HALLADO', motivo: motivoCancelacion,
        modo: modoActivo(), confirmacionManual: confirmacionManual || null
      })
      console.warn(`⚠️  Factura ${id} cancelada local (CFDI no hallado, modo ${modoActivo()}) por ${req.usuario?.nombre}`)
      return res.json({
        success: true, data: actualizada,
        warning: 'El CFDI no se encontró en Facturapi. Se canceló localmente. Si pudo existir un CFDI real, verifícalo en el portal del SAT.'
      })
    }

    const statusRemoto = invoiceRemoto?.status
    const cancelStatusRemoto = invoiceRemoto?.cancellation_status

    // P0-6: use centralized mapper for state detection
    const mappedState = mapFacturaState(invoiceRemoto)

    // B1: ya cancelada en el SAT → solo sincronizar el estado local.
    if (mappedState.isCanceled) {
      const actualizada = await marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds)
      await auditarCancelacion(req, factura, ventaIds, { tipo: 'SINCRONIZAR_YA_CANCELADA', motivo: motivoCancelacion, statusRemoto, cancelStatusRemoto })
      console.log(`✅ Factura ${id}: ya estaba cancelada en el SAT — estado local sincronizado por ${req.usuario?.nombre}`)
      return res.json(buildCancellationResponse({
        success: true, mappedState, data: actualizada,
        mensaje: 'El CFDI ya estaba cancelado en el SAT; se sincronizó el estado local.'
      }))
    }

    // P0-6: accepted transitorio — cancellation_status=accepted con status=valid
    // SAT aceptó pero status aún no flippeó a 'canceled'. Marcar como CANCELADA.
    if (mappedState.isAcceptedTransitorio) {
      const actualizada = await marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds)
      await auditarCancelacion(req, factura, ventaIds, { tipo: 'CANCELACION_ACEPTADA_TRANSITORIO', motivo: motivoCancelacion, statusRemoto, cancelStatusRemoto })
      console.log(`✅ Factura ${id}: cancelación aceptada (transitorio) — estado local sincronizado por ${req.usuario?.nombre}`)
      return res.json(buildCancellationResponse({
        success: true, mappedState, data: actualizada,
        mensaje: 'La cancelación fue aceptada por el SAT. Estado local sincronizado.'
      }))
    }

    // P0-6: si ya hay cancelación pendiente/verificando, NO reenviar — devolver estado actual
    if (mappedState.type === 'in_progress') {
      await auditarCancelacion(req, factura, ventaIds, { tipo: 'CANCELACION_YA_EN_CURSO', motivo: motivoCancelacion, statusRemoto, cancelStatusRemoto })
      console.warn(`⏳ Factura ${id}: cancelación ya en curso (cancellation_status=${cancelStatusRemoto}) — no se reenvía`)
      return res.status(202).json(buildCancellationResponse({
        success: true, mappedState,
        mensaje: mappedState.cancellationStatus === 'pending'
          ? 'La cancelación está pendiente de aceptación del receptor. El estado local NO se cambió. Usa "Actualizar estado" para sincronizar cuando el SAT confirme.'
          : 'La cancelación está siendo verificada por el SAT. El estado local NO se cambió. Usa "Actualizar estado" para sincronizar cuando el SAT confirme.'
      }))
    }

    // P0-6: si fue rechazada o expirada, informar claramente (permitir reintentar)
    if (mappedState.type === 'terminal_error') {
      await auditarCancelacion(req, factura, ventaIds, { tipo: cancelStatusRemoto === 'rejected' ? 'CANCELACION_RECHAZADA' : 'CANCELACION_EXPIRADA', motivo: motivoCancelacion, statusRemoto, cancelStatusRemoto })
      const msg = cancelStatusRemoto === 'rejected'
        ? 'La solicitud de cancelación fue rechazada por el SAT o el receptor. Revisa el motivo y considera una nueva solicitud.'
        : 'La solicitud de cancelación expiró sin respuesta del receptor. Puedes intentar una nueva solicitud.'
      console.warn(`🚫 Factura ${id}: cancelación ${cancelStatusRemoto} — ${msg}`)
      return res.status(409).json(buildCancellationResponse({
        success: false, mappedState,
        error: msg, mensaje: msg
      }))
    }

    // B2: viva en el SAT → cancelar en el SAT.
    let resultadoCancel
    try {
      resultadoCancel = await trackFacturapi('invoices.cancel', { facturaId: id }, () => fp.invoices.cancel(factura.facturapiId, { motive: motivoCancelacion, ...(motivoInfo.requiresSubstitution && substitutionUUID ? { substitution_uuid: substitutionUUID } : {}) }))
    } catch (fpErr) {
      const fpCode = fpErr?.code || fpErr?.error?.code
      const mapped = mapFpError(fpCode, 'No se pudo cancelar el CFDI en el SAT: ' + fpErr.message)
      console.error(`❌ cancel() falló (factura ${id}):`, fpErr.message)
      return res.status(502).json({ error: mapped.message, codigo: fpCode || 'FP_ERROR', retryable: mapped.retryable, suggestSync: mapped.suggestSync })
    }

    const cancelResultStatus = resultadoCancel?.status
    const cancelResultCancellationStatus = resultadoCancel?.cancellation_status
    const cancelMappedState = mapFacturaState(resultadoCancel)

    // INVARIANTE FISCAL: solo marcar CANCELADA local si el SAT confirma status='canceled'.
    if (cancelMappedState.isCanceled || cancelMappedState.isAcceptedTransitorio) {
      const actualizada = await marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds)
      await auditarCancelacion(req, factura, ventaIds, { tipo: 'CANCELAR_SAT_LOCAL', motivo: motivoCancelacion, statusRemoto: cancelResultStatus, cancelStatusRemoto: cancelResultCancellationStatus })
      console.log(`✅ Factura ${id} cancelada (SAT + local) — ${ventaIds.length} venta(s) liberada(s) por ${req.usuario?.nombre}`)
      return res.json(buildCancellationResponse({ success: true, mappedState: cancelMappedState, data: actualizada }))
    }

    // P0-6: respuesta no terminal → devolver cancellation_status explícito
    await auditarCancelacion(req, factura, ventaIds, { tipo: 'CANCELACION_PENDIENTE_SAT', motivo: motivoCancelacion, statusRemoto: cancelResultStatus, cancelStatusRemoto: cancelResultCancellationStatus })
    console.warn(`⏳ Factura ${id}: cancelación enviada al SAT, pendiente de confirmación (status=${cancelResultStatus}, cancellation_status=${cancelResultCancellationStatus})`)
    return res.status(202).json(buildCancellationResponse({
      success: true, mappedState: cancelMappedState,
      mensaje: 'La cancelación se envió al SAT pero quedó pendiente de confirmación. El estado local NO se cambió. Usa "Actualizar estado" para sincronizar.'
    }))

  } catch (err) {
    console.error('❌ Error cancelando factura:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: 'No se pudo cancelar la factura: ' + err.message })
  }
}

// P0-6: POST /facturas/:id/sincronizar-cancelacion — sincroniza estado de cancelación desde SAT
// Usa updateStatus() para forzar consulta actualizada. Idempotente.
exports.sincronizarCancelacion = async (req, res) => {
  try {
    const invoiceScope = buildFacturaScope(req)
    const ventaScope = buildVentaScopeFacturas(req)
    const id = parseInt(req.params.id)

    const factura = await prisma.facturaCfdi.findFirst({ where: { id, ...invoiceScope } })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.estado === 'CANCELADA') return res.status(400).json({ error: 'Ya está cancelada', estado: 'CANCELADA' })
    if (!factura.facturapiId) return res.status(400).json({ error: 'Factura sin CFDI asociado (pendiente de timbrado)' })

    if (factura.procesandoTimbrado) {
      return res.status(409).json({
        error: 'Hay un timbrado en proceso o con resultado desconocido. Reconcilia el timbrado primero.',
        codigo: 'TIMBRADO_INCIERTO'
      })
    }

    let fp
    try {
      await verificarFacturacionEmpresa(factura.empresaId)
      fp = await getFacturapiForEmpresa(factura.empresaId)
    } catch (err) {
      if (err instanceof FiscalError) return res.status(err.status).json({ error: err.message, codigo: err.code })
      throw err
    }

    let invoiceRemoto
    try {
      invoiceRemoto = await trackFacturapi('invoices.updateStatus', { facturaId: id }, () => fp.invoices.updateStatus(factura.facturapiId))
    } catch (fpErr) {
      const fpCode = fpErr?.code || fpErr?.error?.code
      const mapped = mapFpError(fpCode, 'No se pudo sincronizar el estado del CFDI: ' + fpErr.message)
      console.error(`❌ updateStatus() falló en sync (factura ${id}):`, fpErr.message)
      return res.status(502).json({ error: mapped.message, codigo: fpCode || 'FP_ERROR', retryable: mapped.retryable, suggestSync: mapped.suggestSync })
    }

    // P0-6: use centralized mapper
    const mappedState = mapFacturaState(invoiceRemoto)
    const statusRemoto = invoiceRemoto?.status
    const cancelStatusRemoto = invoiceRemoto?.cancellation_status

    // Si el SAT ya confirmó cancelación (o accepted transitorio) → marcar local y liberar
    if (mappedState.isCanceled || mappedState.isAcceptedTransitorio) {
      const ventaIds = await obtenerVentaIdsDeFactura(factura.id, factura.ventaId)
      const actualizada = await marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds)
      await auditarCancelacion(req, factura, ventaIds, {
        tipo: 'SYNC_CANCELACION_ACEPTADA', motivo: 'sincronizar-cancelacion',
        statusRemoto, cancelStatusRemoto
      })
      console.log(`✅ Factura ${id}: sincronización confirmó cancelación SAT — ${ventaIds.length} venta(s) liberada(s)`)
      return res.json(buildCancellationResponse({
        success: true, mappedState, data: actualizada,
        mensaje: 'El CFDI fue cancelado en el SAT. Estado local sincronizado.'
      }))
    }

    // Cualquier otro estado → reportar con campos normalizados
    return res.json(buildCancellationResponse({
      success: true, mappedState,
      mensaje: mappedState.tooltip || 'El CFDI sigue activo. No hay cancelación en proceso.'
    }))

  } catch (err) {
    console.error('❌ Error sincronizando cancelación:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: 'No se pudo sincronizar: ' + err.message })
  }
}

function clasificarErrorTimbradoGlobal(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status
  const reintentables = [408, 409, 425, 429]
  if (typeof status === 'number' && status >= 400 && status < 500 && !reintentables.includes(status)) {
    return 'VALIDACION'
  }
  const msg = (err?.message || '').toLowerCase()
  if (/campo|obligatorio|inv[aá]lid|v[aá]lid|requerid|required/.test(msg)) {
    return 'VALIDACION'
  }
  return 'INCIERTO'
}

exports.previewGlobal = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const whereScope = { empresaId }

    const { desde, hasta, metodoPago } = req.query
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' })
    if (!metodoPago) return res.status(400).json({ error: 'metodoPago es requerido' })
    if (!METODOS_GLOBALES.includes(metodoPago)) {
      return res.status(400).json({ error: `metodoPago inválido. Use uno de: ${METODOS_GLOBALES.join(', ')}` })
    }

    if (desde.slice(0, 7) !== hasta.slice(0, 7)) {
      return res.status(400).json({ error: 'El rango no puede cruzar meses ni años. Selecciona semanas dentro de un mismo mes.' })
    }

    const desdeDate = new Date(desde + 'T00:00:00.000-06:00')
    const hastaDate = new Date(hasta + 'T23:59:59.999-06:00')

    const [ventas, mixtoAggr] = await Promise.all([
      prisma.venta.findMany({
        where: {
          ...whereScope,
          facturaEstado: 'DISPONIBLE',
          estado: 'COMPLETADA',
          metodoPago,
          creadaEn: { gte: desdeDate, lte: hastaDate }
        },
        orderBy: { creadaEn: 'asc' },
        select: {
          id: true, folio: true, total: true, metodoPago: true, creadaEn: true, sucursalId: true,
          Sucursal: { select: { id: true, nombre: true, codigoPostal: true, activa: true } }
        }
      }),
      prisma.venta.aggregate({
        where: {
          ...whereScope,
          facturaEstado: 'DISPONIBLE',
          estado: 'COMPLETADA',
          metodoPago: 'MIXTO',
          creadaEn: { gte: desdeDate, lte: hastaDate }
        },
        _count: { id: true },
        _sum:   { total: true }
      })
    ])

    const mixtoCount = mixtoAggr._count.id || 0
    const mixtoTotal = mixtoAggr._sum.total
      ? parseFloat(mixtoAggr._sum.total.toFixed(2))
      : 0

    const totalRaw = ventas.reduce((sum, v) => sum + parseFloat(v.total), 0)
    const total    = parseFloat(totalRaw.toFixed(2))
    const subtotal = parseFloat((total / 1.16).toFixed(2))
    const iva      = parseFloat((total - subtotal).toFixed(2))

    const grupos = [...agruparVentasGlobalesPorSucursal(ventas).entries()].map(([sucursalId, grupo]) => {
      const sucursal = grupo[0]?.Sucursal
      const codigoPostalValido = /^\d{5}$/.test(String(sucursal?.codigoPostal || '').trim())
      return {
        sucursalId,
        sucursal: sucursal?.nombre || null,
        codigoPostal: codigoPostalValido ? String(sucursal.codigoPostal).trim() : null,
        ventas: grupo.length,
        total: parseFloat(grupo.reduce((sum, venta) => sum + parseFloat(venta.total), 0).toFixed(2)),
        error: sucursalId == null
          ? { code: 'GLOBAL_VENTA_SIN_SUCURSAL', mensaje: 'La venta no tiene sucursal.' }
          : !codigoPostalValido
            ? { code: 'SUCURSAL_SIN_LUGAR_EXPEDICION', mensaje: 'La sucursal no tiene un código postal válido de 5 dígitos.' }
            : null
      }
    })

    res.json({
      success: true,
      ventas,
      resumen: { total, subtotal, iva, count: ventas.length },
      sucursales: grupos,
      mixto: { count: mixtoCount, total: mixtoTotal }
    })
  } catch (err) {
    console.error('❌ Error previewGlobal:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message })
  }
}

exports.timbrarGlobal = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const whereScope = { empresaId }

    const { desde, hasta, metodoPago, periodicidad } = req.body
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' })
    if (!metodoPago) return res.status(400).json({ error: 'metodoPago es requerido' })
    if (!METODOS_GLOBALES.includes(metodoPago)) {
      return res.status(400).json({ error: `metodoPago inválido. Use uno de: ${METODOS_GLOBALES.join(', ')}` })
    }
    if (!periodicidad) return res.status(400).json({ error: 'periodicidad es requerida' })
    if (!PERIODICIDAD_FACTURAPI[periodicidad]) {
      return res.status(400).json({ error: `periodicidad inválida: "${periodicidad}". Use 01-05.` })
    }

    if (desde.slice(0, 7) !== hasta.slice(0, 7)) {
      return res.status(400).json({ error: 'El rango no puede cruzar meses ni años.' })
    }
    const mes = desde.slice(5, 7)
    const anio = desde.slice(0, 4)

    const desdeDate = new Date(desde + 'T00:00:00.000-06:00')
    const hastaDate = new Date(hasta + 'T23:59:59.999-06:00')

    // Fail-closed: no se crea ningún PENDIENTE sin autoridad fiscal válida.
    let fp
    try {
      await verificarFacturacionEmpresa(empresaId)
      fp = await getFacturapiForEmpresa(empresaId)
    } catch (err) {
      if (err instanceof FiscalError) return res.status(err.status).json({ error: err.message, codigo: err.code })
      throw err
    }

    const datosEmisor = await resolverDatosEmisor(empresaId)

    // Re-query con el mismo filtro que previewGlobal: fuente de verdad del timbrado.
    const ventas = await prisma.venta.findMany({
      where: {
        ...whereScope,
        facturaEstado: 'DISPONIBLE',
        estado: 'COMPLETADA',
        metodoPago,
        creadaEn: { gte: desdeDate, lte: hastaDate }
      },
      orderBy: { creadaEn: 'asc' },
      select: {
        id: true, folio: true, total: true, metodoPago: true, sucursalId: true,
        Sucursal: { select: { id: true, nombre: true, codigoPostal: true, activa: true } }
      }
    })

    if (ventas.length === 0) {
      return res.status(400).json({ error: 'No hay ventas DISPONIBLE para el método y rango seleccionados.' })
    }

    const grupos = agruparVentasGlobalesPorSucursal(ventas)
    const resultados = []

    for (const [sucursalId, ventasGrupo] of grupos) {
      const sucursal = ventasGrupo[0]?.Sucursal
      const codigoPostal = String(sucursal?.codigoPostal || '').trim()
      const baseResultado = {
        sucursalId,
        sucursal: sucursal?.nombre || null,
        ventas: ventasGrupo.length,
        total: parseFloat(ventasGrupo.reduce((sum, venta) => sum + parseFloat(venta.total), 0).toFixed(2))
      }

      if (sucursalId == null) {
        resultados.push({ ...baseResultado, estado: 'ERROR', error: { code: 'GLOBAL_VENTA_SIN_SUCURSAL', mensaje: 'La venta no tiene sucursal.' } })
        continue
      }
      if (!/^\d{5}$/.test(codigoPostal)) {
        resultados.push({ ...baseResultado, estado: 'ERROR', error: { code: 'SUCURSAL_SIN_LUGAR_EXPEDICION', mensaje: 'La sucursal no tiene un código postal válido de 5 dígitos.' } })
        continue
      }
      if (ventasGrupo.length > 5000) {
        resultados.push({ ...baseResultado, estado: 'ERROR', error: { code: 'GLOBAL_MAX_CONCEPTOS', mensaje: 'La sucursal supera el máximo de 5000 conceptos.' } })
        continue
      }

      const total = baseResultado.total
      const subtotal = parseFloat((total / 1.16).toFixed(2))
      const iva = parseFloat((total - subtotal).toFixed(2))
      const ventaIds = ventasGrupo.map(venta => venta.id)
      let factura

      try {
        factura = await prisma.$transaction(async (tx) => {
          const f = await tx.facturaCfdi.create({
            data: {
              empresaId, ventaId: null, clienteId: null,
              rfcReceptor: 'XAXX010101000', nombreReceptor: 'PUBLICO EN GENERAL',
              cpReceptor: datosEmisor.cp, regimenFiscal: '616', usoCfdi: 'S01',
              lugarExpedicion: codigoPostal, subtotal: 0, iva: 0, total: 0,
              estado: 'PENDIENTE_TIMBRADO', tipoFactura: 'GLOBAL',
              procesandoTimbrado: true, procesandoTimbradoEn: new Date(), idempotencyKey: null,
              periodicidad, mes, anio, fechaInicio: desdeDate, fechaFin: hastaDate
            }
          })
          const locked = await tx.venta.updateMany({
            where: { id: { in: ventaIds }, facturaEstado: 'DISPONIBLE', estado: 'COMPLETADA', metodoPago, ...whereScope },
            data: { facturaEstado: 'PENDIENTE_TIMBRADO', procesoFacturaId: f.id }
          })
          if (locked.count !== ventaIds.length) {
            throw Object.assign(new Error('Algunas ventas de la sucursal ya fueron reclamadas por otro proceso.'), { code: 'CONFLICT' })
          }
          for (const ventaId of ventaIds) {
            await tx.facturaVenta.create({ data: { facturaId: f.id, ventaId } })
          }
          return tx.facturaCfdi.update({ where: { id: f.id }, data: { idempotencyKey: `jesha-global-${f.id}` } })
        })
      } catch (err) {
        if (err?.code === 'CONFLICT' || err?.code === 'P2002') {
          resultados.push({ ...baseResultado, estado: 'CONFLICTO', error: { code: 'GLOBAL_VENTAS_RECLAMADAS', mensaje: err.message } })
          continue
        }
        throw err
      }

      const payload = buildGlobalInvoicePayload({
        ventas: ventasGrupo, metodoPago, periodicidad, mes, anio, datosEmisor, lugarExpedicion: codigoPostal
      })
      let invoice = null
      let selladoOk = false
      try {
        invoice = await fp.invoices.create({ ...payload, idempotency_key: `jesha-global-${factura.id}` })
        selladoOk = true
        await prisma.$transaction([
          prisma.facturaCfdi.update({
            where: { id: factura.id, procesandoTimbrado: true },
            data: {
              folioFiscal: invoice.uuid, facturapiId: invoice.id, subtotal, iva, total,
              estado: 'TIMBRADA', timbradaEn: new Date(), procesandoTimbrado: false,
              procesandoTimbradoEn: null, ultimoErrorTimbrado: null
            }
          }),
          prisma.venta.updateMany({
            where: { id: { in: ventaIds }, procesoFacturaId: factura.id, ...whereScope },
            data: { facturaEstado: 'FACTURADA', procesoFacturaId: null }
          })
        ])
        if (datosEmisor.email) {
          try { await fp.invoices.sendByEmail(invoice.id, { email: datosEmisor.email }) } catch (err) { console.warn('Email global:', err.message) }
        }
        resultados.push({ ...baseResultado, estado: 'TIMBRADA', facturaId: factura.id, uuid: invoice.uuid })
      } catch (fpErr) {
        console.error('Error Facturapi (timbrarGlobal):', fpErr.message)
        if (selladoOk) {
          await prisma.facturaCfdi.update({
            where: { id: factura.id },
            data: {
              folioFiscal: invoice?.uuid ?? undefined, facturapiId: invoice?.id ?? undefined,
              subtotal, iva, total, procesandoTimbrado: true,
              ultimoErrorTimbrado: ('Sellado OK, falló persistencia: ' + (fpErr.message || '')).slice(0, 500)
            }
          }).catch(() => {})
          resultados.push({ ...baseResultado, estado: 'INCIERTO', facturaId: factura.id, requiereRevision: true, error: { code: 'GLOBAL_PERSISTENCIA_INCIERTA', mensaje: 'El CFDI puede haberse timbrado; requiere reconciliación.' } })
        } else if (clasificarErrorTimbradoGlobal(fpErr) === 'VALIDACION') {
          await prisma.$transaction([
            prisma.facturaCfdi.update({
              where: { id: factura.id },
              data: { procesandoTimbrado: false, procesandoTimbradoEn: null, ultimoErrorTimbrado: (fpErr.message || '').slice(0, 500) }
            }),
            prisma.venta.updateMany({
              where: { id: { in: ventaIds }, procesoFacturaId: factura.id, ...whereScope },
              data: { facturaEstado: 'DISPONIBLE', procesoFacturaId: null }
            })
          ]).catch(() => {})
          resultados.push({ ...baseResultado, estado: 'ERROR', facturaId: factura.id, requiereCorreccion: true, error: { code: 'FACTURAPI_VALIDACION', mensaje: fpErr.message } })
        } else {
          await prisma.facturaCfdi.update({
            where: { id: factura.id },
            data: { ultimoErrorTimbrado: (fpErr.message || '').slice(0, 500) }
          }).catch(() => {})
          resultados.push({ ...baseResultado, estado: 'INCIERTO', facturaId: factura.id, requiereRevision: true, error: { code: 'FACTURAPI_RESULTADO_INCIERTO', mensaje: 'Resultado desconocido; requiere reconciliación.' } })
        }
      }
    }

    const total = parseFloat(resultados.reduce((sum, resultado) => sum + resultado.total, 0).toFixed(2))
    const exitosas = resultados.filter(resultado => resultado.estado === 'TIMBRADA')
    const fallidas = resultados.filter(resultado => resultado.estado !== 'TIMBRADA')
    const status = exitosas.length && fallidas.length ? 207 : exitosas.length ? 200 : 422
    const resultadoUnico = resultados.length === 1 ? resultados[0] : null
    return res.status(status).json({
      success: exitosas.length > 0,
      totalSucursales: resultados.length,
      totalVentas: resultados.reduce((sum, resultado) => sum + resultado.ventas, 0),
      total,
      resultados,
      ...(resultadoUnico ? {
        facturaId: resultadoUnico.facturaId,
        uuid: resultadoUnico.uuid,
        ventas: resultadoUnico.ventas,
        timbrado: resultadoUnico.estado === 'TIMBRADA'
      } : {})
    })

  } catch (err) {
    console.error('❌ Error timbrarGlobal:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) })
  }
}
