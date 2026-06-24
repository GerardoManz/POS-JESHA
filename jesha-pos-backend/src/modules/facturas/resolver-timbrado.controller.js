// ════════════════════════════════════════════════════════════════════
//  RESOLVER-TIMBRADO.CONTROLLER.JS
//  src/modules/facturas/resolver-timbrado.controller.js
//
//  Recupera facturas que quedaron en estado INCIERTO (PENDIENTE_TIMBRADO con
//  procesandoTimbrado=true): un timbrado cuyo resultado no se pudo confirmar.
//
//  Facturapi NO devuelve la factura existente al reintentar con la misma
//  idempotency_key (devuelve 409), así que NO se puede reconciliar reintentando
//  create(). El camino es: buscar candidatos con invoices.list() por fecha +
//  filtros locales + confirmación humana.
//
//  - candidatos: READ-ONLY (no exige procesandoTimbrado; útil para verificar después).
//  - reconciliar / descartar: ESTRICTOS (CAS sobre PENDIENTE_TIMBRADO + procesandoTimbrado).
//  - reconciliar valida coherencia vía retrieve(); mismatch → 422, NUNCA vincula parcial.
//  - Scope estricto: si el rol es GLOBAL, exige empresaId explícito.
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const resolverEmpresaScope = require('../../helpers/resolverEmpresaScope')
const { getFacturapi, modoActivo } = require('../../lib/facturapi')

const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000'])
const MIN_CONFIRMACION = 10
const MAX_CONFIRMACION = 500
const MAX_PAGINAS = 10
const PAGE_SIZE = 50

// ── Scope estricto: estos endpoints mueven estado fiscal; GLOBAL debe acotar. ──
function scopeEstricto(req) {
  const scope = resolverEmpresaScope(req) // lanza 401/403 si aplica
  if (scope.modo === 'GLOBAL') {
    const empresaId = Number(req.query.empresaId ?? req.body?.empresaId)
    if (!Number.isInteger(empresaId)) {
      const e = new Error('empresaId explícito requerido para este endpoint')
      e.status = 400; e.expose = true; throw e
    }
    return empresaId
  }
  return scope.empresaId
}

// Helper (duplicado del de facturas.controller; es chico y evita acoplar archivos).
async function obtenerVentaIds(facturaId, ventaIdLegacy) {
  const rel = await prisma.facturaVenta.findMany({ where: { facturaId }, select: { ventaId: true } })
  if (rel.length) return rel.map(r => r.ventaId)
  return ventaIdLegacy != null ? [ventaIdLegacy] : []
}

async function auditar(req, factura, empresaId, detalle) {
  try {
    await prisma.auditoria.create({
      data: {
        accion: 'RESOLVER_TIMBRADO',
        modulo: 'facturas',
        referencia: `factura:${factura.id}`,
        usuarioId: req.usuario?.id ?? null,
        empresaId,
        sucursalId: req.usuario?.sucursalId ?? null,
        ip: req.ip,
        valorAntes: {
          estado: factura.estado, procesandoTimbrado: factura.procesandoTimbrado,
          facturapiId: factura.facturapiId, idempotencyKey: factura.idempotencyKey
        },
        valorDespues: detalle
      }
    })
  } catch (e) {
    console.error('Audit error (resolver-timbrado):', e.message)
  }
}

// ── Búsqueda de candidatos en Facturapi ──
function esCandidato(factura, inv) {
  if (inv.status !== 'valid') return false
  if (inv.livemode !== (modoActivo() === 'live')) return false
  if (Math.abs(Number(inv.total) - Number(factura.total)) > 0.01) return false
  return true
}

// Lista un rango paginando por total_pages. Si list() falla, marca err.listFailed
// para que el caller responda 502 explícito (nunca "sin candidatos" por error de red).
async function listarRango(fp, gte, lt) {
  const acc = []
  let page = 1, totalPages = 1
  do {
    let resp
    try {
      resp = await fp.invoices.list({
        'date[gte]': gte.toISOString(),
        'date[lt]': lt.toISOString(),
        page, limit: PAGE_SIZE
      })
    } catch (e) {
      const err = new Error(e.message); err.listFailed = true; throw err
    }
    acc.push(...(resp.data || []))
    totalPages = resp.total_pages || 1
    page++
  } while (page <= totalPages && page <= MAX_PAGINAS)
  return acc
}

// Ventana fija ±2h (alta precisión); fallback a ±12h (24h centrada en el intento,
// NO hasta "ahora" — evita arrastrar candidatos lejanos en facturas viejas).
async function buscarCandidatos(fp, factura) {
  const base = factura.procesandoTimbradoEn || factura.creadaEn
  const t = base.getTime()
  const ventanas = [
    [new Date(t - 2 * 3600e3), new Date(t + 2 * 3600e3)],
    [new Date(t - 12 * 3600e3), new Date(t + 12 * 3600e3)]
  ]
  for (const [gte, lt] of ventanas) {
    const lista = await listarRango(fp, gte, lt)
    const m = lista.filter(inv => esCandidato(factura, inv))
    if (m.length) return m
  }
  return []
}

function resumenCand(inv, exact) {
  return {
    facturapiId: inv.id, uuid: inv.uuid, total: inv.total, fecha: inv.date,
    rfc: inv.customer?.tax_id ?? null, idempotency_key: inv.idempotency_key ?? null,
    matchIdempotency: !!exact, status: inv.status, livemode: inv.livemode
  }
}

// Clasifica: idempotency_key exacto es nivel propio (determinístico). RFC genérico
// no aporta señal (lo comparten todas las públicas), así que no sube categoría.
function clasificar(factura, candidatos) {
  const exactos = candidatos.filter(c => c.idempotency_key && c.idempotency_key === factura.idempotencyKey)
  if (exactos.length === 1) return { categoria: 'EXACT_IDEMPOTENCY', candidatos: [resumenCand(exactos[0], true)] }
  if (exactos.length > 1)  return { categoria: 'AMBIGUOUS', candidatos: exactos.map(c => resumenCand(c, true)) }
  if (candidatos.length === 0) return { categoria: 'NO_CANDIDATES', candidatos: [] }

  const rfcGenerico = RFC_GENERICOS.has(factura.rfcReceptor)
  const categoria = candidatos.length === 1 ? 'APPROXIMATE' : 'AMBIGUOUS'
  return {
    categoria,
    rfcGenerico,
    aviso: rfcGenerico
      ? `RFC genérico: no distingue al receptor. ${candidatos.length} CFDI con este monto en el rango — valida monto, fecha e idempotency_key antes de confirmar.`
      : undefined,
    candidatos: candidatos.map(c => resumenCand(c, false))
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /facturas/:id/timbrado-candidatos   (READ-ONLY)
// ════════════════════════════════════════════════════════════════════
exports.timbradoCandidatos = async (req, res) => {
  try {
    const empresaId = scopeEstricto(req)
    const id = parseInt(req.params.id)

    const factura = await prisma.facturaCfdi.findFirst({ where: { id, empresaId } })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.estado !== 'PENDIENTE_TIMBRADO') {
      return res.status(409).json({ error: `La factura está ${factura.estado}; no hay timbrado por reconciliar.` })
    }

    // Atajo: ya tiene facturapiId (caso "sellado OK pero el guardado local falló").
    if (factura.facturapiId) {
      return res.json({
        success: true, categoria: 'EXACT_IDEMPOTENCY',
        procesandoActivo: factura.procesandoTimbrado,
        facturapiIdConocido: factura.facturapiId, candidatos: [],
        mensaje: 'La factura ya tiene facturapiId local. Ve directo a reconciliar con ese ID.'
      })
    }

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada' })

    const candidatos = await buscarCandidatos(fp, factura)
    return res.json({ success: true, procesandoActivo: factura.procesandoTimbrado, ...clasificar(factura, candidatos) })
  } catch (err) {
    if (err.listFailed) {
      return res.status(502).json({ error: 'La búsqueda en Facturapi falló: ' + err.message + '. No se pudo determinar si hay candidatos; reintenta.' })
    }
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturas/:id/reconciliar-timbrado   (mueve estado fiscal)
// ════════════════════════════════════════════════════════════════════
exports.reconciliarTimbrado = async (req, res) => {
  try {
    const empresaId = scopeEstricto(req)
    const id = parseInt(req.params.id)
    const { facturapiId } = req.body || {}
    if (!facturapiId || typeof facturapiId !== 'string') {
      return res.status(400).json({ error: 'facturapiId requerido' })
    }

    const factura = await prisma.facturaCfdi.findFirst({ where: { id, empresaId } })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.estado !== 'PENDIENTE_TIMBRADO' || !factura.procesandoTimbrado) {
      return res.status(409).json({ error: 'La factura no está en estado reconciliable (PENDIENTE_TIMBRADO + proceso activo).' })
    }
    if (factura.facturapiId && factura.facturapiId !== facturapiId) {
      return res.status(409).json({ error: 'La factura ya tiene otro facturapiId asociado.' })
    }

    // El facturapiId no debe pertenecer a otra factura (defensa en app; @unique es el backstop en BD).
    const otra = await prisma.facturaCfdi.findFirst({ where: { facturapiId, NOT: { id } }, select: { id: true, empresaId: true } })
    if (otra) {
      // No revelar tenant ajeno.
      return res.status(409).json({
        error: otra.empresaId === empresaId
          ? `Ese CFDI ya está vinculado a la factura ${otra.id}.`
          : 'Ese CFDI ya está vinculado a otra factura.'
      })
    }

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada' })

    let inv
    try {
      inv = await fp.invoices.retrieve(facturapiId)
    } catch (e) {
      return res.status(502).json({ error: 'No se pudo verificar el CFDI en Facturapi: ' + e.message })
    }

    // Coherencia: cualquier mismatch → 422, NUNCA vincula.
    const problemas = []
    if (inv.status !== 'valid') problemas.push(`status=${inv.status} (se esperaba valid)`)
    if (inv.livemode !== (modoActivo() === 'live')) problemas.push('livemode no coincide con el modo activo')
    if (Math.abs(Number(inv.total) - Number(factura.total)) > 0.01) problemas.push(`total ${inv.total} ≠ ${factura.total}`)
    if (factura.idempotencyKey && inv.idempotency_key && inv.idempotency_key !== factura.idempotencyKey) problemas.push('idempotency_key no coincide')
    if (!RFC_GENERICOS.has(factura.rfcReceptor) && inv.customer?.tax_id && inv.customer.tax_id !== factura.rfcReceptor) {
      problemas.push(`RFC ${inv.customer.tax_id} ≠ ${factura.rfcReceptor}`)
    }
    if (problemas.length) {
      return res.status(422).json({ error: 'El CFDI no coincide con la factura; no se vinculó.', detalles: problemas })
    }

    const ventaIds = await obtenerVentaIds(id, factura.ventaId)

    // CAS + escrituras atómicas. Si la factura cambió de estado, rollback → 409.
    try {
      await prisma.$transaction(async (tx) => {
        const upd = await tx.facturaCfdi.updateMany({
          where: { id, empresaId, estado: 'PENDIENTE_TIMBRADO', procesandoTimbrado: true },
          data: {
            facturapiId, folioFiscal: inv.uuid, estado: 'TIMBRADA',
            timbradaEn: new Date(), procesandoTimbrado: false,
            procesandoTimbradoEn: null, ultimoErrorTimbrado: null
          }
        })
        if (upd.count !== 1) { const e = new Error('CAS'); e.cas = true; throw e }
        if (ventaIds.length) {
          await tx.venta.updateMany({
            where: { id: { in: ventaIds }, empresaId },
            data: { facturaEstado: 'FACTURADA', procesoFacturaId: null }
          })
        }
      })
    } catch (e) {
      if (e.cas) return res.status(409).json({ error: 'La factura cambió de estado durante la reconciliación; reintenta.' })
      if (e.code === 'P2002') return res.status(409).json({ error: 'Ese CFDI ya fue vinculado a otra factura (condición de carrera).' })
      throw e
    }

    await auditar(req, factura, empresaId, { tipo: 'RECONCILIAR', facturapiId, uuid: inv.uuid, ventaIds })
    return res.json({ success: true, mensaje: 'Factura reconciliada y marcada como TIMBRADA.', facturapiId, uuid: inv.uuid })
  } catch (err) {
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturas/:id/descartar-timbrado-incierto
//  Limpia el estado INCIERTO. NO cancela, NO libera la venta. Exige texto libre.
// ════════════════════════════════════════════════════════════════════
exports.descartarTimbradoIncierto = async (req, res) => {
  try {
    const empresaId = scopeEstricto(req)
    const id = parseInt(req.params.id)
    const conf = (req.body?.confirmacionManual ?? '').toString().trim()
    if (conf.length < MIN_CONFIRMACION) {
      return res.status(400).json({ error: `confirmacionManual (texto libre, ≥${MIN_CONFIRMACION} caracteres, describiendo lo que verificaste en el portal del SAT) es obligatorio.` })
    }

    const factura = await prisma.facturaCfdi.findFirst({ where: { id, empresaId } })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.facturapiId) {
      return res.status(409).json({ error: 'La factura ya tiene facturapiId; usa reconciliar, no descartar.' })
    }
    if (factura.estado !== 'PENDIENTE_TIMBRADO' || !factura.procesandoTimbrado) {
      return res.status(409).json({ error: 'La factura no está en estado INCIERTO.' })
    }

    const upd = await prisma.facturaCfdi.updateMany({
      where: { id, empresaId, estado: 'PENDIENTE_TIMBRADO', procesandoTimbrado: true },
      data: {
        procesandoTimbrado: false,
        procesandoTimbradoEn: null,
        ultimoErrorTimbrado: 'DESCARTADO_INCIERTO — ver auditoría'
      }
    })
    if (upd.count !== 1) return res.status(409).json({ error: 'La factura cambió de estado; reintenta.' })

    await auditar(req, factura, empresaId, { tipo: 'DESCARTAR', confirmacionManual: conf.slice(0, MAX_CONFIRMACION) })
    return res.json({
      success: true,
      mensaje: 'Estado INCIERTO descartado. La factura queda PENDIENTE_TIMBRADO sin proceso activo; puede reintentarse el timbrado.'
    })
  } catch (err) {
    res.status(err.expose ? (err.status || 500) : 500).json({ error: err.message })
  }
}