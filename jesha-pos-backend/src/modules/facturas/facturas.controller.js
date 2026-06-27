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
const resolverEmpresaScope = require('../../helpers/resolverEmpresaScope')
const resolverDatosEmisor = require('../../helpers/resolverDatosEmisor')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { getFacturapi, modoActivo } = require('../../lib/facturapi')
const { buildGlobalInvoicePayload, METODOS_GLOBALES, PERIODICIDAD_FACTURAPI } = require('../facturacion/facturacion.controller')

// ════════════════════════════════════════════════════════════════════
//  Helper: ventas asociadas a una factura.
//  FUENTE DE VERDAD = FacturaVenta. Fallback legacy a FacturaCfdi.ventaId
//  para facturas creadas antes del backfill/retrofit. NO NEGOCIABLE.
// ════════════════════════════════════════════════════════════════════
async function obtenerVentaIdsDeFactura(facturaId, ventaIdLegacy) {
  const relaciones = await prisma.facturaVenta.findMany({
    where: { facturaId },
    select: { ventaId: true }
  })
  if (relaciones.length > 0) return relaciones.map(r => r.ventaId)
  return ventaIdLegacy != null ? [ventaIdLegacy] : []
}

// Marca la factura CANCELADA y libera sus ventas (DISPONIBLE + procesoFacturaId=null).
// El índice parcial FacturaCfdi_ventaId_viva_key libera el cupo para re-facturar.
async function marcarCanceladaYLiberar(id, whereScope, ventaIds) {
  const [actualizada] = await prisma.$transaction([
    prisma.facturaCfdi.update({
      where: { id, ...whereScope },
      data: { estado: 'CANCELADA' }
    }),
    prisma.venta.updateMany({
      where: { id: { in: ventaIds }, ...whereScope },
      data: { facturaEstado: 'DISPONIBLE', procesoFacturaId: null }
    })
  ])
  return actualizada
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
        sucursalId:  req.usuario?.sucursalId ?? null,
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
    const scope = resolverEmpresaScope(req)
    const whereScope = scope.modo === 'GLOBAL' ? {} : { empresaId: scope.empresaId }

    const { q, desde, hasta, estado, page = 1, take = 20 } = req.query
    const skip = (parseInt(page) - 1) * parseInt(take)

    const where = { ...whereScope }

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
        // Folio de la venta directa (individual legacy)
        { Venta: { folio: { contains: q, mode: 'insensitive' } } },
        // Folio de cualquier venta asociada vía FacturaVenta (conjunta/global)
        { FacturaVenta: { some: { Venta: { folio: { contains: q, mode: 'insensitive' } } } } }
      ]
    }

    const [data, total] = await Promise.all([
      prisma.facturaCfdi.findMany({
        where,
        skip,
        take: parseInt(take),
        orderBy: { creadaEn: 'desc' },
        include: {
          Venta:  { select: { folio: true, total: true, metodoPago: true } },
          _count: { select: { FacturaVenta: true } }
        }
      }),
      prisma.facturaCfdi.count({ where })
    ])

    const dataConConteo = data.map(f => {
      const { _count, ...rest } = f
      const ventasCount = (_count?.FacturaVenta || 0) || (f.ventaId != null ? 1 : 0)
      return { ...rest, ventasCount }
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
    const scope = resolverEmpresaScope(req)
    const whereScope = scope.modo === 'GLOBAL' ? {} : { empresaId: scope.empresaId }

    const factura = await prisma.facturaCfdi.findFirst({
      where: { id: parseInt(req.params.id), ...whereScope },
      include: {
        Venta: {
          select: { folio: true, total: true, metodoPago: true, creadaEn: true },
        },
        FacturaVenta: {
          include: {
            Venta: { select: { id: true, folio: true, total: true, metodoPago: true, creadaEn: true } }
          }
        }
      }
    })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })

    const ventas = factura.FacturaVenta.length
      ? factura.FacturaVenta.map(fv => fv.Venta)
      : (factura.Venta ? [factura.Venta] : [])

    const data = { ...factura, ventas }
    delete data.FacturaVenta

    res.json({ success: true, data })
  } catch (err) {
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message })
  }
}

// PATCH /facturas/:id/cancelar — ENDURECIDO (anti-desync fiscal)
exports.cancelar = async (req, res) => {
  try {
    const scope = resolverEmpresaScope(req)
    const whereScope = scope.modo === 'GLOBAL' ? {} : { empresaId: scope.empresaId }

    const id = parseInt(req.params.id)
    const { motivo: motivoCancelacion = '02', confirmacionManual } = req.body || {}

    const factura = await prisma.facturaCfdi.findFirst({ where: { id, ...whereScope } })
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
      const actualizada = await marcarCanceladaYLiberar(id, whereScope, ventaIds)
      const warning = (factura.idempotencyKey == null)
        ? 'Esta factura pendiente no tenía clave de idempotencia. Verifica manualmente en Facturapi que no haya quedado timbrada antes de re-facturar la venta.'
        : undefined
      await auditarCancelacion(req, factura, ventaIds, { tipo: 'LOCAL_SIN_CFDI', motivo: motivoCancelacion })
      console.log(`✅ Factura ${id} cancelada (local, sin CFDI) — ${ventaIds.length} venta(s) liberada(s) por ${req.usuario?.nombre}`)
      return res.json({ success: true, data: actualizada, ...(warning ? { warning } : {}) })
    }

    // ── Caso B: CON facturapiId → consultar estado REAL en Facturapi ──
    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada — cancelación SAT no disponible' })

    let invoiceRemoto
    try {
      invoiceRemoto = await fp.invoices.retrieve(factura.facturapiId)
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
      const actualizada = await marcarCanceladaYLiberar(id, whereScope, ventaIds)
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
      const actualizada = await marcarCanceladaYLiberar(id, whereScope, ventaIds)
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
      resultadoCancel = await fp.invoices.cancel(factura.facturapiId, { motive: motivoCancelacion })
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
    const actualizada = await marcarCanceladaYLiberar(id, whereScope, ventaIds)
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
        select: { id: true, folio: true, total: true, metodoPago: true, creadaEn: true }
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

    res.json({
      success: true,
      ventas,
      resumen: { total, subtotal, iva, count: ventas.length },
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

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada' })

    const datosEmisor = resolverDatosEmisor(empresaId)

    // Re-query con el mismo filtro que previewGlobal — fuente de verdad en el momento del timbre (TOCTOU)
    const ventas = await prisma.venta.findMany({
      where: {
        ...whereScope,
        facturaEstado: 'DISPONIBLE',
        estado: 'COMPLETADA',
        metodoPago,
        creadaEn: { gte: desdeDate, lte: hastaDate }
      },
      orderBy: { creadaEn: 'asc' },
      select: { id: true, folio: true, total: true, metodoPago: true }
    })

    if (ventas.length === 0) {
      return res.status(400).json({ error: 'No hay ventas DISPONIBLE para el método y rango seleccionados.' })
    }

    if (ventas.length > 5000) {
      return res.status(400).json({ error: `El rango genera ${ventas.length} conceptos (máximo 5000). Usa un rango más corto.` })
    }

    let factura
    try {
      factura = await prisma.$transaction(async (tx) => {
        const f = await tx.facturaCfdi.create({
          data: {
            empresaId:        empresaId,
            ventaId:          null,
            clienteId:        null,
            rfcReceptor:      'XAXX010101000',
            nombreReceptor:   'PUBLICO EN GENERAL',
            cpReceptor:       datosEmisor.cp,
            regimenFiscal:    '616',
            usoCfdi:          'S01',
            lugarExpedicion:  datosEmisor.cp,
            subtotal:         0, iva: 0, total: 0,
            estado:           'PENDIENTE_TIMBRADO',
            tipoFactura:      'GLOBAL',
            procesandoTimbrado: true,
            procesandoTimbradoEn: new Date(),
            idempotencyKey:   null,
            periodicidad,
            mes,
            anio,
            fechaInicio:      desdeDate,
            fechaFin:         hastaDate
          }
        })

        const ventaIds = ventas.map(v => v.id)
        const locked = await tx.venta.updateMany({
          where: { id: { in: ventaIds }, facturaEstado: 'DISPONIBLE', estado: 'COMPLETADA', metodoPago, ...whereScope },
          data: { facturaEstado: 'PENDIENTE_TIMBRADO', procesoFacturaId: f.id }
        })
        if (locked.count !== ventaIds.length) {
          throw Object.assign(new Error('Algunas ventas cambiaron de estado concurrentemente. Refresca e intenta de nuevo.'), { code: 'CONFLICT' })
        }

        for (const vid of ventaIds) {
          await tx.facturaVenta.create({ data: { facturaId: f.id, ventaId: vid } })
        }

        return tx.facturaCfdi.update({
          where: { id: f.id },
          data: { idempotencyKey: `jesha-global-${f.id}` }
        })
      })
    } catch (e) {
      if (e?.code === 'CONFLICT') return res.status(409).json({ error: e.message })
      throw e
    }

    // Totales calculados ANTES del try: visibles en el éxito y en el branch selladoOk
    // del catch (recuperación INCIERTO). Antes vivían dentro del try → invisibles al catch.
    const totalRaw = ventas.reduce((sum, v) => sum + parseFloat(v.total), 0)
    const total    = parseFloat(totalRaw.toFixed(2))
    const subtotal = parseFloat((total / 1.16).toFixed(2))
    const iva      = parseFloat((total - subtotal).toFixed(2))

    const payload = buildGlobalInvoicePayload({ ventas, metodoPago, periodicidad, mes, anio, datosEmisor })
    let invoice = null
    let selladoOk = false

    try {
      invoice = await fp.invoices.create({ ...payload, idempotency_key: `jesha-global-${factura.id}` })
      selladoOk = true

      await prisma.$transaction([
        prisma.facturaCfdi.update({
          where: { id: factura.id },
          data: {
            folioFiscal: invoice.uuid, facturapiId: invoice.id,
            subtotal, iva, total,
            estado: 'TIMBRADA', timbradaEn: new Date(),
            procesandoTimbrado: false, procesandoTimbradoEn: null, ultimoErrorTimbrado: null
          }
        }),
        ...ventas.map(v =>
          prisma.venta.update({
            where: { id: v.id },
            data: { facturaEstado: 'FACTURADA', procesoFacturaId: null }
          })
        )
      ])

      if (datosEmisor.email) {
        try { await fp.invoices.sendByEmail(invoice.id, { email: datosEmisor.email }) } catch (e) { console.warn('⚠️  Email global:', e.message) }
      }

      console.log(`✅ Global timbrada: ${invoice.uuid} | ${ventas.length} ventas | ${factura.id}`)
      console.log('📋 CFDI completo:', JSON.stringify(invoice, null, 2))
      return res.json({ success: true, uuid: invoice.uuid, facturaId: factura.id, ventas: ventas.length, cfdi: invoice })

    } catch (fpErr) {
      console.error('❌ Error Facturapi (timbrarGlobal):', fpErr.message)

      if (selladoOk) {
        await prisma.facturaCfdi.update({
          where: { id: factura.id },
          data: {
            folioFiscal: invoice?.uuid ?? undefined,
            facturapiId: invoice?.id ?? undefined,
            subtotal, iva, total,
            procesandoTimbrado: true,
            procesandoTimbradoEn: factura.procesandoTimbradoEn ?? new Date(),
            ultimoErrorTimbrado: ('Sellado OK, falló persistencia: ' + (fpErr.message || '')).slice(0, 500)
          }
        }).catch(() => {})
        return res.status(202).json({
          success: true, timbrado: false, requiereRevision: true,
          mensaje: 'La factura se timbró en el SAT pero falló el guardado local. Quedó marcada para reconciliar.',
          facturaId: factura.id
        })
      }

      const tipo = clasificarErrorTimbradoGlobal(fpErr)
      if (tipo === 'VALIDACION') {
        const ventaIds = ventas.map(v => v.id)
        await prisma.$transaction([
          prisma.facturaCfdi.update({
            where: { id: factura.id },
            data: { procesandoTimbrado: false, procesandoTimbradoEn: null, ultimoErrorTimbrado: (fpErr.message || '').slice(0, 500) }
          }),
          prisma.venta.updateMany({
            where: { id: { in: ventaIds }, procesoFacturaId: factura.id },
            data: { facturaEstado: 'DISPONIBLE', procesoFacturaId: null }
          })
        ]).catch(() => {})
        return res.status(422).json({ error: 'Error de validación: ' + fpErr.message, requiereCorreccion: true })
      }

      await prisma.facturaCfdi.update({
        where: { id: factura.id },
        data: { ultimoErrorTimbrado: (fpErr.message || '').slice(0, 500) }
      }).catch(() => {})
      return res.status(202).json({
        success: true, timbrado: false, requiereRevision: true,
        mensaje: 'Resultado desconocido. La factura quedó marcada para revisión manual.',
        facturaId: factura.id
      })
    }

  } catch (err) {
    console.error('❌ Error timbrarGlobal:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message })
  }
}