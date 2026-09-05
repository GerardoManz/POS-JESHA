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

// GET /facturas — listar con filtros
exports.listar = async (req, res) => {
  try {
    const whereScope = buildFacturaScope(req)

    const { q, desde, hasta, estado, metodoPago, page = 1, take = 20 } = req.query
    const skip = (parseInt(page) - 1) * parseInt(take)

    const where = { ...whereScope }

    if (estado) where.estado = estado

    if (desde || hasta) {
      where.creadaEn = {}
      if (desde) where.creadaEn.gte = new Date(desde + 'T00:00:00')
      if (hasta) where.creadaEn.lte = new Date(hasta + 'T23:59:59')
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
    // ── FAIL-CLOSED (P1): cliente de la Organization PROPIA de la empresa ──
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
      invoiceRemoto = await trackFacturapi('invoices.retrieve', { facturaId: id }, () => fp.invoices.retrieve(factura.facturapiId))
    } catch (fpErr) {
      const noEncontrado = fpErr?.status === 404 || /not\s*found|no\s*(se\s*)?encontr/i.test(fpErr?.message || '')
      if (!noEncontrado) {
        // Error real (auth/red/5xx) → NO tocar BD.
        console.error(`❌ retrieve() falló (factura ${id}):`, fpErr.message)
        return res.status(502).json({ error: 'No se pudo consultar el CFDI en Facturapi: ' + fpErr.message })
      }

      // ── "Invoice not found" ──
      // En LIVE el facturapiId puede pertenecer a otra cuenta/entorno y el CFDI estar
      // VIVO en el SAT. NO auto-cancelar sin confirmación humana explícita.
      if (modoActivo() === 'live' && !confirmacionManual) {
        return res.status(409).json({
          error: 'El CFDI no se encontró en la cuenta de Facturapi activa. En modo live no se cancela automáticamente. Verifica en el portal del SAT que el CFDI no exista o ya esté cancelado, y reenvía la solicitud con "confirmacionManual" (texto describiendo lo que verificaste).',
          requiereConfirmacionManual: true
        })
      }

      // Test (limpieza) o live con confirmación explícita → cancelar local.
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

    // B1: ya cancelada en el SAT → solo sincronizar el estado local.
    if (statusRemoto === 'canceled') {
      const actualizada = await marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds)
      await auditarCancelacion(req, factura, ventaIds, { tipo: 'SINCRONIZAR_YA_CANCELADA', motivo: motivoCancelacion, statusRemoto })
      console.log(`✅ Factura ${id}: ya estaba cancelada en el SAT — estado local sincronizado por ${req.usuario?.nombre}`)
      return res.json({
        success: true, data: actualizada,
        mensaje: 'El CFDI ya estaba cancelado en el SAT; se sincronizó el estado local.'
      })
    }

    // B2: viva en el SAT → cancelar en el SAT.
    let resultadoCancel
    try {
      resultadoCancel = await trackFacturapi('invoices.cancel', { facturaId: id }, () => fp.invoices.cancel(factura.facturapiId, { motive: motivoCancelacion }))
    } catch (fpErr) {
      console.error(`❌ cancel() falló (factura ${id}):`, fpErr.message)
      return res.status(502).json({ error: 'No se pudo cancelar el CFDI en el SAT: ' + fpErr.message })
    }

    // INVARIANTE FISCAL: solo marcar CANCELADA local si el SAT confirma status='canceled'.
    // Facturapi puede devolver status='valid' con cancelación PENDIENTE de aceptación
    // del receptor; en ese caso NO se desincroniza el estado local ni se libera la venta.
    if (resultadoCancel?.status !== 'canceled') {
      await auditarCancelacion(req, factura, ventaIds, { tipo: 'CANCELACION_PENDIENTE_SAT', motivo: motivoCancelacion, statusRemoto: resultadoCancel?.status })
      console.warn(`⏳ Factura ${id}: cancelación enviada al SAT, pendiente de confirmación (status=${resultadoCancel?.status})`)
      return res.status(202).json({
        success: true, pendiente: true,
        mensaje: 'La cancelación se envió al SAT pero quedó pendiente de confirmación (posible aceptación del receptor). El estado local NO se cambió. Vuelve a cancelar más tarde para sincronizar cuando el SAT confirme.'
      })
    }

    // Cancelación confirmada → marcar local + liberar.
    const actualizada = await marcarCanceladaYLiberar(id, invoiceScope, ventaScope, ventaIds)
    await auditarCancelacion(req, factura, ventaIds, { tipo: 'CANCELAR_SAT_LOCAL', motivo: motivoCancelacion, statusRemoto: resultadoCancel?.status })
    console.log(`✅ Factura ${id} cancelada (SAT + local) — ${ventaIds.length} venta(s) liberada(s) por ${req.usuario?.nombre}`)
    res.json({ success: true, data: actualizada })

  } catch (err) {
    console.error('❌ Error cancelando factura:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: 'No se pudo cancelar la factura: ' + err.message })
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
