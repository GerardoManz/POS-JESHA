// ════════════════════════════════════════════════════════════════════
//  VENTAS CONTROLLER
//  Ubicación: src/modules/ventas/ventas.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const resolverSucursalId = require('../sucursal/sucursal.helper')
const os = require('os')
const { buildVentaSnapshot, formatFechaTicket } = require('../impresion/impresion.snapshot')
const { encolarImpresion } = require('../impresion/impresion.service')
const QRCode = require('qrcode')
const { verifySellerAuthorization, SellerAuthError } = require('../../security/seller-auth')
const { verificarStockPostOperacion } = require('../../helpers/verificarStock')
const { normalizarUnidadVenta, normalizarUnidadCompra, esFraccionable } = require('../../helpers/unidades.helper')

function getLanIp() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '192.168.0.190'
}

// P0-BRANCH-ISOLATION (H5): el scope de ventas se construye desde el contexto de la
// request (req.context), nunca de req.usuario ni de body/query.
//  - empresaId: siempre desde el contexto (autoritativo).
//  - sucursalId: solo cuando el modo de rama NO es NONE (FIXED o SELECTED).
// Exportado para reutilizarse en ticket.controller.js (mismo scope de lectura).
function construirWhereScopeVentas(req) {
  const where = { empresaId: getEmpresaId(req) }
  const sucursalId = resolverSucursalId(req)
  if (sucursalId !== null && sucursalId !== undefined) {
    where.sucursalId = parseInt(sucursalId, 10)
  }
  return where
}
exports.construirWhereScopeVentas = construirWhereScopeVentas

// Convierte un instante UTC a la fecha de calendario local de Zacatecas (UTC-6, sin DST)
// y la devuelve como Date a medianoche UTC, lista para columna @db.Date.
function fechaLocalZacatecasComoDbDate(date) {
  const local = new Date(date.getTime() - (6 * 60 * 60 * 1000))
  return new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  ))
}

// ════════════════════════════════════════════════════════════════════
//  HELPER CENTRAL: Resolver unidad de un detalle
//  Prioridad: unidadVentaSnapshot >> Producto.unidadVenta >> null
//  Normaliza mediante unidades.helper.js
// ════════════════════════════════════════════════════════════════════

function resolverUnidad(detalle) {
  const raw = detalle.unidadVentaSnapshot ?? detalle.Producto?.unidadVenta ?? null
  if (!raw) return null
  return normalizarUnidadVenta(raw, false) || raw
}

/**
 * POST /ventas
 */
exports.crearVenta = async (req, res) => {
  try {
    // P0-BRANCH-ISOLATION: la sucursal operativa SIEMPRE proviene del contexto
    // (req.context.branch.sucursalId), nunca del body ni del query.
    const sucursalId = resolverSucursalId(req)
    const bodySucursalId = (req.body.sucursalId !== undefined && req.body.sucursalId !== null && req.body.sucursalId !== '')
      ? parseInt(req.body.sucursalId) : null
    if (bodySucursalId !== null && bodySucursalId !== sucursalId) {
      return res.status(403).json({ error: 'La sucursal del body no coincide con el contexto', codigo: 'SUCURSAL_CONTEXT_MISMATCH' })
    }
    if (!sucursalId || isNaN(sucursalId)) {
      return res.status(400).json({ error: 'Se requiere contexto de sucursal para registrar una venta', codigo: 'BRANCH_CONTEXT_REQUIRED' })
    }
    const rawSellerAuth = req.body.sellerAuthorization || null
    const bodyUsuarioId = req.body.usuarioId != null ? parseInt(req.body.usuarioId) : null
    let usuarioId
    if (bodyUsuarioId != null && !isNaN(bodyUsuarioId) && bodyUsuarioId !== req.usuario.id) {
      // Case C/D: frontend claims a different seller — SAT is mandatory
      if (!rawSellerAuth) {
        return res.status(403).json({ error: 'Se requiere autorización de vendedor para atribuir la venta a otro usuario', codigo: 'SELLER_AUTH_REQUIRED' })
      }
      let satClaims
      try {
        satClaims = verifySellerAuthorization(rawSellerAuth)
      } catch (err) {
        const code = err.code || 'SELLER_AUTH_INVALID'
        return res.status(401).json({ error: err.message, codigo: code })
      }
      // SAT must be for this session
      if (satClaims.sid !== req.usuario.id) {
        return res.status(403).json({ error: 'La autorización de vendedor no corresponde a esta sesión', codigo: 'SELLER_AUTH_SESSION_MISMATCH' })
      }
      // SAT must be for this tenant
      if (satClaims.eid !== empresaId) {
        return res.status(403).json({ error: 'La autorización de vendedor no pertenece a esta empresa', codigo: 'SELLER_AUTH_TENANT_MISMATCH' })
      }
      // SAT must be for this branch
      if (satClaims.bid != null && satClaims.bid !== sucursalId) {
        return res.status(403).json({ error: 'La autorización de vendedor no corresponde a esta sucursal', codigo: 'SELLER_AUTH_BRANCH_MISMATCH' })
      }
      // SAT.sub must match the claimed seller
      if (satClaims.sub !== bodyUsuarioId) {
        return res.status(403).json({ error: 'El vendedor en la autorización no coincide con el solicitado', codigo: 'SELLER_AUTH_SELLER_MISMATCH' })
      }
      usuarioId = satClaims.sub
    } else {
      // Case A/B: selling as self — no SAT needed
      usuarioId = req.usuario.id
    }
    const turnoId    = parseInt(req.body.turnoId)
    const { metodoPago, subtotal, iva, descuento, total, detalles, notas, montoPagado: montoPagadoRaw, cotizacionId } = req.body
    const clienteId  = req.body.clienteId ? parseInt(req.body.clienteId) : null
    const empresaId = getEmpresaId(req)

    if (!usuarioId || isNaN(usuarioId) || !turnoId || isNaN(turnoId) || !metodoPago) {
      return res.status(400).json({ error: 'Faltan campos requeridos', campos: ['usuarioId', 'turnoId', 'metodoPago'] })
    }
    if (!detalles || detalles.length === 0) {
      return res.status(400).json({ error: 'La venta debe tener al menos 1 producto' })
    }

    // P0-BRANCH-ISOLATION: el turno debe pertenecer a la empresa y a la sucursal operativa.
    const turno = await prisma.turnoCaja.findFirst({
      where: { id: turnoId, empresaId, sucursalId, abierto: true }
    })
    if (!turno) {
      return res.status(403).json({ error: 'Turno cerrado o no existe', codigo: 'SIN_TURNO_ABIERTO' })
    }

    const esDelegada = req.delegation?.active === true
    const usuario = await prisma.usuario.findFirst({
      where: esDelegada
        ? { id: usuarioId, empresaId: null, rol: req.delegation.actorRealRol, activo: true }
        : { id: usuarioId, empresaId, activo: true }
    })
    if (!usuario) {
      return res.status(403).json({ error: 'Usuario inválido o inactivo' })
    }
    const rolVenta = esDelegada ? req.usuario.rol : usuario.rol
    const rolesConVenta = ['EMPLEADO', 'ADMIN_SUCURSAL', 'SUPERADMIN']
    if (!rolesConVenta.includes(rolVenta)) {
      return res.status(403).json({ error: 'Usuario sin permiso para vender', codigo: 'SIN_PERMISO_VENTA' })
    }

    // ── Validar descuento por rol ──────────────────────────────────
    const descuentoAmt = parseFloat(parseFloat(descuento || 0).toFixed(2))
    if (descuentoAmt > 0 && rolVenta === 'EMPLEADO') {
      return res.status(403).json({ error: 'Sin permiso para aplicar descuentos', codigo: 'SIN_PERMISO_DESCUENTO' })
    }

    // ── Validar referencia Ingenico si es tarjeta (opcional) ─────
    const esTarjetaPago = ['CREDITO', 'DEBITO'].includes(metodoPago)
    if (esTarjetaPago && notas) {
      const refMatch = notas.match(/^Ref\. Ingenico:\s*(\d+)$/)
      if (refMatch && (refMatch[1].length < 4 || refMatch[1].length > 6)) {
        return res.status(400).json({ error: 'N° de Autorización debe ser de 4 a 6 dígitos', codigo: 'REF_INGENICO_INVALIDA' })
      }
    }

    // ── Validar cotización, si se especifica (debe existir y pertenecer a la empresa) ──
    let cotizacionValida = null
    if (cotizacionId) {
      const cotId = parseInt(cotizacionId)
      if (isNaN(cotId)) {
        return res.status(400).json({ error: 'cotizacionId inválido' })
      }
      // P0-BRANCH-ISOLATION: la cotización debe pertenecer a la empresa y a la
      // sucursal operativa y estar PENDIENTE; si no, 404 (sin distinguir causa).
      const cot = await prisma.cotizacion.findFirst({
        where: { id: cotId, empresaId, sucursalId, estado: 'PENDIENTE' },
        select: { id: true }
      })
      if (!cot) {
        return res.status(404).json({ error: 'Cotización no encontrada' })
      }
      cotizacionValida = cot
    }

    // ── Validar desglose de pagos mixtos ─────────────────────────
    const desglosePagos = req.body.desglosePagos || null
    if (metodoPago === 'MIXTO') {
      if (!desglosePagos || !Array.isArray(desglosePagos) || desglosePagos.length < 2) {
        return res.status(400).json({ error: 'Pago mixto requiere al menos 2 métodos de pago', codigo: 'MIXTO_MIN_2' })
      }
      const metodosPermitidos = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA']
      for (const pago of desglosePagos) {
        if (!pago.metodo || !metodosPermitidos.includes(pago.metodo)) {
          return res.status(400).json({ error: `Método inválido en desglose: ${pago.metodo}`, codigo: 'MIXTO_METODO_INVALIDO' })
        }
        if (!pago.monto || parseFloat(pago.monto) <= 0) {
          return res.status(400).json({ error: 'Cada pago debe tener monto mayor a 0', codigo: 'MIXTO_MONTO_INVALIDO' })
        }
      }
    }

    // ── Cargar productos para validación y snapshots ──────────────
    const productoIdsUnicos = [...new Set(detalles.map(d => parseInt(d.productoId)))]
    const productoIdsValidos = productoIdsUnicos.filter(id => Number.isInteger(id))
    const productosVenta = await prisma.producto.findMany({
      where: { id: { in: productoIdsValidos }, empresaId },
      select: { id: true, unidadVenta: true, esGranel: true, factorConversion: true, tipo: true, unidadCompra: true }
    })
    // P0-BRANCH-ISOLATION: si algún producto solicitado no pertenece a la empresa, rechazar
    // (cross-tenant) en lugar de seguir con snapshots null.
    if (productosVenta.length !== productoIdsValidos.length) {
      return res.status(404).json({ error: 'Uno o más productos no disponibles', codigo: 'PRODUCTO_NO_DISPONIBLE' })
    }
    const productoMap = new Map(productosVenta.map(p => [p.id, p]))

    // Determinar si la venta proviene de cotización (origen legacy sin metadata de captura)
    const esLegacy = !!cotizacionValida

    let totalRecalculado = 0
    const detallesValidados = []
    const detallesMetadata = []
    for (let i = 0; i < detalles.length; i++) {
      const detalle = detalles[i]
      const { productoId, cantidad, precioUnitario, modoCaptura, cantidadCapturada, importeCapturado, unidadCapturada } = detalle
      if (!productoId || !cantidad || !precioUnitario) {
        return res.status(400).json({ error: 'Detalle incompleto', detalle })
      }
      if (cantidad <= 0) {
        return res.status(400).json({ error: 'Cantidad debe ser > 0', producto: productoId })
      }
      const cantidadFloat   = parseFloat(cantidad)
      const subtotalDetalle = parseFloat((cantidadFloat * parseFloat(precioUnitario)).toFixed(2))
      totalRecalculado += subtotalDetalle

      const prod = productoMap.get(parseInt(productoId))

      // ── modoCaptura: null sin modo = legacy/cotización o error si no es legacy ──
      const modo = (modoCaptura !== undefined && modoCaptura !== null)
        ? String(modoCaptura).toUpperCase() : null

      if (modoCaptura === undefined || modoCaptura === null) {
        if (!esLegacy) {
          return res.status(400).json({
            error: 'modoCaptura es obligatorio para venta POS directa',
            producto: productoId, detalleIdx: i
          })
        }
        // Legacy/cotización: snapshots de metadata null, solo inferir unidadVenta/esGranel
        const unidadVentaSnapLegacy = prod && prod.tipo !== 'SERVICIO'
          ? (normalizarUnidadVenta(prod.unidadVenta, false) || null)
          : null
        const esGranelSnapLegacy = prod && prod.tipo !== 'SERVICIO' ? prod.esGranel : false

        detallesValidados.push({
          productoId:     parseInt(productoId),
          cantidad:       cantidadFloat,
          precioUnitario: parseFloat(precioUnitario),
          subtotal:       subtotalDetalle
        })
        detallesMetadata.push({
          unidadVentaSnapshot:       unidadVentaSnapLegacy,
          unidadCapturadaSnapshot:   null,
          esGranelSnapshot:          esGranelSnapLegacy,
          factorConversionSnapshot:  null,
          modoCapturaSnapshot:       null,
          cantidadCapturadaSnapshot: null,
          importeCapturadoSnapshot:  null
        })
        continue
      }

      const METODOS_VALIDOS = { CANTIDAD: true, IMPORTE: true, CONVERSION: true }
      if (!METODOS_VALIDOS[modo]) {
        return res.status(400).json({ error: `Modo de captura inválido: "${modoCaptura}"`, producto: productoId, detalleIdx: i })
      }

      let unidadVentaSnap = null
      let unidadCapturadaSnap = null
      let esGranelSnap = null
      let factorConversionSnap = null
      let cantidadCapturadaSnap = null
      let importeCapturadoSnap = null

      if (prod) {
        if (prod.tipo !== 'SERVICIO') {
          unidadVentaSnap = normalizarUnidadVenta(prod.unidadVenta, false) || null
          esGranelSnap = prod.esGranel
          if (!unidadVentaSnap && prod.unidadVenta) {
            console.warn(`[P3] Producto ${prod.id}: unidadVenta "${prod.unidadVenta}" no se pudo normalizar.`)
          }

          if (modo === 'CANTIDAD') {
            const permiteFracciones = prod.esGranel || (prod.unidadVenta ? esFraccionable(prod.unidadVenta) : false)
            if (!permiteFracciones && !Number.isInteger(cantidadFloat)) {
              return res.status(400).json({ error: 'Producto discreto no admite fracciones', producto: productoId })
            }
            cantidadCapturadaSnap = cantidadCapturada !== null && cantidadCapturada !== undefined ? parseFloat(cantidadCapturada) : cantidadFloat
            importeCapturadoSnap = null
            unidadCapturadaSnap = normalizarUnidadVenta(unidadCapturada || prod.unidadVenta, false) || unidadVentaSnap
          } else if (modo === 'IMPORTE') {
            if (!prod.esGranel) {
              return res.status(400).json({ error: 'Modo IMPORTE solo permitido para productos granel', producto: productoId })
            }
            cantidadCapturadaSnap = null
            importeCapturadoSnap = (importeCapturado !== null && importeCapturado !== undefined && Number.isFinite(Number(importeCapturado)))
              ? parseFloat(importeCapturado) : null
            if (!importeCapturadoSnap || importeCapturadoSnap <= 0) {
              return res.status(400).json({ error: 'importeCapturado debe ser un número positivo', producto: productoId })
            }
            if (Math.abs(importeCapturadoSnap - subtotalDetalle) > 0.01) {
              return res.status(400).json({ error: `importeCapturado (${importeCapturadoSnap}) no coincide con subtotal (${subtotalDetalle})`, producto: productoId })
            }
            unidadCapturadaSnap = null
            factorConversionSnap = null
          } else if (modo === 'CONVERSION') {
            if (!prod.unidadCompra) {
              return res.status(400).json({ error: 'Producto sin unidad de compra, no admite CONVERSION', producto: productoId })
            }
            if (!prod.factorConversion || !Number.isFinite(Number(prod.factorConversion)) || Number(prod.factorConversion) <= 0) {
              return res.status(400).json({ error: 'Producto sin factor de conversión válido para CONVERSION', producto: productoId })
            }
            const uc = normalizarUnidadCompra(unidadCapturada || prod.unidadCompra, false) || null
            if (uc && uc !== normalizarUnidadCompra(prod.unidadCompra, false)) {
              return res.status(400).json({ error: `unidadCapturada "${unidadCapturada}" no coincide con unidadCompra del producto`, producto: productoId })
            }
            cantidadCapturadaSnap = cantidadCapturada !== null && cantidadCapturada !== undefined ? parseFloat(cantidadCapturada) : cantidadFloat
            importeCapturadoSnap = null
            unidadCapturadaSnap = normalizarUnidadCompra(unidadCapturada || prod.unidadCompra, false) || null
            factorConversionSnap = parseFloat(prod.factorConversion)
            const esperado = parseFloat((cantidadCapturadaSnap * factorConversionSnap).toFixed(3))
            if (Math.abs(esperado - cantidadFloat) > 0.001) {
              return res.status(400).json({ error: `cantidad final (${cantidadFloat}) no coincide con cantidadCapturada × factor (${esperado})`, producto: productoId })
            }
          }
        }
      } else {
        console.warn(`[P3] Producto ${productoId} no encontrado en empresa ${empresaId}, snapshots null.`)
      }

      detallesValidados.push({
        productoId:     parseInt(productoId),
        cantidad:       cantidadFloat,
        precioUnitario: parseFloat(precioUnitario),
        subtotal:       subtotalDetalle
      })
      detallesMetadata.push({
        unidadVentaSnapshot: unidadVentaSnap,
        unidadCapturadaSnapshot: unidadCapturadaSnap,
        esGranelSnapshot: esGranelSnap,
        factorConversionSnapshot: factorConversionSnap,
        modoCapturaSnapshot: modo,
        cantidadCapturadaSnapshot: cantidadCapturadaSnap,
        importeCapturadoSnapshot: importeCapturadoSnap
      })
    }
    totalRecalculado = parseFloat(totalRecalculado.toFixed(2))

    const totalEsperado = parseFloat((totalRecalculado - descuentoAmt).toFixed(2))
    const diferencia    = Math.abs(totalEsperado - parseFloat(total))
    if (diferencia > 0.01) {
      return res.status(400).json({ error: 'Total no coincide', codigo: 'TOTAL_MISMATCH', backend: totalEsperado, frontend: total, diferencia })
    }

    // ── Pago mixto debe sumar EXACTAMENTE el total (evita descuadre de caja por cambio) ──
    if (metodoPago === 'MIXTO') {
      const sumaPagosMixto = parseFloat(desglosePagos.reduce((s, p) => s + parseFloat(p.monto), 0).toFixed(2))
      if (Math.abs(sumaPagosMixto - totalEsperado) > 0.01) {
        return res.status(400).json({ error: 'El pago mixto debe sumar exactamente el total', codigo: 'MIXTO_TOTAL_MISMATCH', totalEsperado, sumaPagos: sumaPagosMixto })
      }
    }

    const folio = await generarFolio()
    let facturaEstado = 'DISPONIBLE'
    let facturaLimite = new Date()
    if (metodoPago === 'CREDITO_CLIENTE') {
      facturaEstado = 'BLOQUEADA'
      facturaLimite = null
    } else if (metodoPago === 'MIXTO') {
      // MIXTO: evaluar si algún pago es efectivo y total > 2000
      const tieneEfectivo = desglosePagos?.some(p => p.metodo === 'EFECTIVO')
      if (tieneEfectivo && totalEsperado > 2000) {
        facturaEstado = 'BLOQUEADA'
        facturaLimite.setHours(facturaLimite.getHours() + 72)
      } else {
        facturaLimite.setDate(facturaLimite.getDate() + 30)
      }
    } else if (metodoPago === 'EFECTIVO' && totalEsperado > 2000) {
      facturaEstado = 'BLOQUEADA'
      facturaLimite.setHours(facturaLimite.getHours() + 72)
    } else {
      facturaLimite.setDate(facturaLimite.getDate() + 30)
    }

    // ── POLÍTICA P0.11: Derivar esCredito exclusivamente del metodoPago ──
    const tieneFlagCredito = req.body.esCreditoCliente === true || req.body.esCreditoCliente === 'true' || req.body.esCredito === true
    if (tieneFlagCredito && metodoPago !== 'CREDITO_CLIENTE') {
      return res.status(409).json({
        error: 'Inconsistencia: la venta se marcó como crédito pero el método de pago no es CREDITO_CLIENTE.',
        codigo: 'INCONSISTENCIA_TIPO_VENTA'
      })
    }
    const esCredito = metodoPago === 'CREDITO_CLIENTE'
    // P0-BRANCH-ISOLATION: si se referencia cliente, debe pertenecer a la empresa
    // (anti-IDOR cross-tenant). Aplica a ventas de contado y a crédito.
    let clienteValidado = null
    if (clienteId) {
      clienteValidado = await prisma.cliente.findFirst({
        where: { id: clienteId, empresaId },
        select: { id: true, nombre: true, tipo: true, limiteCredito: true, saldoPendiente: true }
      })
      if (!clienteValidado) {
        return res.status(404).json({ error: 'Cliente no encontrado' })
      }
    }
    if (esCredito) {
      if (!clienteId) return res.status(400).json({ error: 'Se requiere cliente para venta a crédito' })
      if (clienteValidado.tipo !== 'REGISTRADO') return res.status(400).json({ error: 'Solo clientes REGISTRADO pueden comprar a crédito' })
      const disponible = parseFloat(clienteValidado.limiteCredito) - parseFloat(clienteValidado.saldoPendiente)
      if (disponible < totalEsperado) return res.status(400).json({ error: 'Crédito insuficiente', disponible, totalRequerido: totalEsperado })
    }

    const venta = await prisma.$transaction(async (tx) => {
      const montoPagadoFinal = metodoPago === 'EFECTIVO'
        ? parseFloat(parseFloat(montoPagadoRaw || 0).toFixed(2))
        : metodoPago === 'MIXTO'
          ? parseFloat(desglosePagos.reduce((s, p) => s + parseFloat(p.monto), 0).toFixed(2))
          : totalEsperado

      // Cambio: solo sobre efectivo (individual o componente mixto)
      let cambioFinal = 0
      if (metodoPago === 'EFECTIVO' && montoPagadoFinal > totalEsperado) {
        cambioFinal = parseFloat((montoPagadoFinal - totalEsperado).toFixed(2))
      } else if (metodoPago === 'MIXTO') {
        const filasEfectivo = desglosePagos.filter(p => p.metodo === 'EFECTIVO')

        // Guard P3: una sola línea de efectivo (el cálculo de necesario asume una fuente)
        if (filasEfectivo.length > 1) {
          const err = new Error('El pago mixto admite una sola línea de efectivo')
          err.status = 400
          err.codigo = 'MIXTO_EFECTIVO_DUPLICADO'
          throw err
        }

        const pagoEfectivo = filasEfectivo[0]
        if (pagoEfectivo) {
          const sumNoEfectivo = desglosePagos
            .filter(p => p.metodo !== 'EFECTIVO')
            .reduce((s, p) => s + parseFloat(p.monto), 0)
          const necesarioEfectivo = parseFloat((totalEsperado - sumNoEfectivo).toFixed(2))

          // recibido = lo que el cliente entregó en efectivo.
          // Fallback a monto (neto) en ventas antiguas / frontend sin actualizar → cambio 0.
          const recibidoEfectivo = parseFloat(
            parseFloat(pagoEfectivo.recibido ?? pagoEfectivo.monto).toFixed(2)
          )

          // Guard P2: el efectivo entregado no puede ser menor al neto requerido
          if (recibidoEfectivo < necesarioEfectivo - 0.005) {
            const err = new Error(`El efectivo recibido ($${recibidoEfectivo.toFixed(2)}) es menor al requerido ($${necesarioEfectivo.toFixed(2)})`)
            err.status = 400
            err.codigo = 'MIXTO_EFECTIVO_INSUFICIENTE'
            throw err
          }

          const sobraEfectivo = recibidoEfectivo - necesarioEfectivo
          if (sobraEfectivo > 0.005) cambioFinal = parseFloat(sobraEfectivo.toFixed(2))
        }
      }

      const ventaCreada = await tx.venta.create({
        data: {
          empresaId,
          folio,
          sucursalId,
          usuarioId,
          turnoId,
          ...(clienteId ? { clienteId } : {}),
          metodoPago,
          subtotal: totalRecalculado,
          descuento: descuentoAmt,
          total: totalEsperado,
          montoPagado: montoPagadoFinal,
          cambio: cambioFinal,
          ...(desglosePagos ? { desglosePagos } : {}),
          notas: notas || null,
          estado: 'COMPLETADA',
          tokenQr: generarUUID(),
          facturaEstado,
          ...(facturaLimite ? { facturaLimite } : {}),
          DetalleVenta: {
            create: detallesValidados.map((d, idx) => ({
              productoId:     d.productoId,
              cantidad:       d.cantidad,
              precioUnitario: d.precioUnitario,
              subtotal:       d.subtotal,
              descuento:      0,
              ...detallesMetadata[idx]
            }))
          }
        },
        include: { DetalleVenta: { include: { Producto: true } } }
      })

      // Servicios (tipo='SERVICIO') no tienen inventario: no descuentan stock
      // ni generan MovimientoInventario. Se saltan el loop de stock.
      const tipoPorProducto = new Map(
        ventaCreada.DetalleVenta.map(d => [d.productoId, d.Producto?.tipo])
      )

      for (const detalle of detallesValidados) {
        if (tipoPorProducto.get(detalle.productoId) === 'SERVICIO') continue

        // A2: decremento ATÓMICO. Permite stock negativo cuando no hay suficiente.
        const upd = await tx.inventarioSucursal.updateMany({
          where: {
            productoId:  detalle.productoId,
            sucursalId
          },
          data: { stockActual: { decrement: detalle.cantidad } }
        })

        if (upd.count === 0) {
          await tx.inventarioSucursal.create({
            data: {
              productoId: detalle.productoId,
              sucursalId,
              stockActual: parseFloat((-detalle.cantidad).toFixed(3)),
              stockMinimoAlerta: 0
            }
          })
        }

        // Leer el valor ya descontado para registrar el MovimientoInventario.
        const invDespues   = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
          select: { stockActual: true }
        })
        const stockDespues = parseFloat(invDespues.stockActual)
        const stockAntes   = parseFloat((stockDespues + detalle.cantidad).toFixed(3))

        await tx.movimientoInventario.create({
          data: {
            empresaId,
            productoId:   detalle.productoId,
            sucursalId,
            usuarioId,
            tipo:         'SALIDA_VENTA',
            cantidad:     detalle.cantidad,
            stockAntes,
            stockDespues,
            referencia:   folio
          }
        })
      }

      // Movimiento de caja — uno por pago (MIXTO crea múltiples)
      if (!esCredito) {
        if (metodoPago === 'MIXTO' && desglosePagos) {
          for (const pago of desglosePagos) {
            await tx.movimientoCaja.create({
              data: { empresaId, turnoId, tipo: 'VENTA', monto: parseFloat(pago.monto), metodoPago: pago.metodo, referencia: folio, notas: `Pago mixto: ${pago.metodo}` }
            })
          }
        } else {
          await tx.movimientoCaja.create({
            data: { empresaId, turnoId, tipo: 'VENTA', monto: totalEsperado, metodoPago, referencia: folio }
          })
        }
      }

      // ──────────────────────────────────────────────────────────
      // Si es crédito: acumular en bitácora del cliente
      // Modelo A: una bitácora origen VENTA ABIERTA por cliente,
      // todas las ventas a crédito se suman a esa misma bitácora.
      // Bitácoras origen MANUAL NO se tocan desde aquí.
      // ──────────────────────────────────────────────────────────
      if (esCredito && clienteId) {
        // Obtener nombre del cliente para título auto-generado
        const clienteInfo = await tx.cliente.findUnique({
          where: { id: clienteId },
          select: { nombre: true }
        })

        // Actualizar saldo del cliente (cuenta corriente)
        // A3: actualización ATÓMICA del saldo. Solo aplica si NO rebasa el límite de crédito.
        // Prisma no permite comparar dos columnas en el where, por eso va en SQL crudo parametrizado.
        const filasCredito = await tx.$executeRaw`
          UPDATE "Cliente"
          SET "saldoPendiente"    = "saldoPendiente"    + ${totalEsperado}::numeric,
              "totalCreditoUsado" = "totalCreditoUsado" + ${totalEsperado}::numeric
          WHERE id = ${clienteId}
            AND "saldoPendiente" + ${totalEsperado}::numeric <= "limiteCredito"`
        if (filasCredito === 0) {
          throw Object.assign(
            new Error('Crédito insuficiente'),
            { status: 400, codigo: 'CREDITO_INSUFICIENTE' }
          )
        }

        // Buscar bitácora origen VENTA ABIERTA del cliente
        let bitacora = await tx.bitacora.findFirst({
          where: { clienteId, estado: 'ABIERTA', origen: 'VENTA' }
        })

        if (bitacora) {
          // EXISTE → sumar totales a la bitácora existente
          bitacora = await tx.bitacora.update({
            where: { id: bitacora.id },
            data: {
              totalMateriales: { increment: totalEsperado },
              saldoPendiente:  { increment: totalEsperado }
            }
          })
        } else {
          // NO EXISTE → crear nueva bitácora acumulativa (origen VENTA)
          const fechaBit  = new Date()
          const seqBitRes = await tx.$queryRaw`SELECT nextval('folio_bitacora_seq') as seq`
          const folioBit  = `BIT-${fechaBit.getFullYear()}${String(fechaBit.getMonth()+1).padStart(2,'0')}${String(fechaBit.getDate()).padStart(2,'0')}-${String(Number(seqBitRes[0].seq)).padStart(5,'0')}`
          bitacora = await tx.bitacora.create({
            data: {
              empresaId,
              folio:           folioBit,
              titulo:          `Crédito — ${clienteInfo?.nombre || 'Cliente'}`,
              origen:          'VENTA',
              clienteId,
              sucursalId,
              usuarioId,
              estado:          'ABIERTA',
              totalMateriales: totalEsperado,
              totalAbonado:    0,
              saldoPendiente:  totalEsperado,
              descuentoTipo:   null,
              descuentoValor:  0,
              descuentoMonto:  0,
              notas:           'Cuenta corriente — crédito a cliente'
            }
          })
        }

        // Agregar detalles de esta venta a la bitácora (siempre, exista o no)
        for (let di = 0; di < detallesValidados.length; di++) {
          const d = detallesValidados[di]
          const md = detallesMetadata[di]
          await tx.detalleBitacora.create({
            data: {
              bitacoraId:           bitacora.id,
              ventaId:              ventaCreada.id,
              productoId:           d.productoId,
              cantidad:             d.cantidad,
              precioUnitario:       d.precioUnitario,
              subtotal:             d.subtotal,
              inventarioDescontado: true,
              notas:                `Venta ${folio}`,
              fechaManual:          fechaLocalZacatecasComoDbDate(ventaCreada.creadaEn),
              responsableId:        usuarioId,
              unidadVentaSnapshot:       md.unidadVentaSnapshot,
              unidadCapturadaSnapshot:   md.unidadCapturadaSnapshot,
              esGranelSnapshot:          md.esGranelSnapshot,
              factorConversionSnapshot:  md.factorConversionSnapshot,
              modoCapturaSnapshot:       md.modoCapturaSnapshot,
              cantidadCapturadaSnapshot: md.cantidadCapturadaSnapshot,
              importeCapturadoSnapshot:  md.importeCapturadoSnapshot
            }
          })
        }
      }

      await tx.auditoria.create({
        data: {
          empresaId,
          usuarioId,
          sucursalId,
          accion:      'CREAR_VENTA',
          modulo:      'VENTAS',
          referencia:  folio,
          valorDespues: { ventaId: ventaCreada.id, total: totalEsperado, items: detallesValidados.length, esCredito }
        }
      })

      // Convertir cotización origen a CONVERTIDA
      if (cotizacionValida) {
        try {
          await tx.cotizacion.update({
            where: { id: cotizacionValida.id },
            data: { estado: 'CONVERTIDA' }
          })
        } catch (e) {
          console.warn('⚠️ No se pudo convertir cotización:', e.message)
        }
      }

      // ═══ Impresión: encolar ticket de venta (atómico con la venta) ═══
      const empresaRow = await tx.empresa.findUnique({
        where: { id: empresaId },
        select: { id: true, rfc: true, nombreComercial: true, whatsapp: true }
      })

      const sucursalRow = await tx.sucursal.findUnique({
        where: { id: sucursalId },
        select: { id: true, nombre: true, codigoPostal: true }
      })

      const clienteNombre = clienteId
        ? ((await tx.cliente.findUnique({ where: { id: clienteId }, select: { nombre: true } }))?.nombre || null)
        : null

      const metodoLabel = {
        EFECTIVO:        'Efectivo',
        CREDITO:         'T. Crédito',
        DEBITO:          'T. Débito',
        TRANSFERENCIA:   'Transferencia',
        CREDITO_CLIENTE: 'Crédito cliente',
        MIXTO:           'Pago Mixto'
      }[metodoPago] || metodoPago

      const abrirCajon = metodoPago === 'EFECTIVO'
        || (metodoPago === 'MIXTO' && Array.isArray(desglosePagos)
            && desglosePagos.some((p) => p.metodo === 'EFECTIVO'))

      const isProduction = process.env.NODE_ENV === 'production'
      const rawHost = req.get('host')
      const host = (!isProduction && /^(localhost|127\.0\.0\.1)/.test(rawHost))
        ? rawHost.replace(/^(localhost|127\.0\.0\.1)/, getLanIp())
        : rawHost
      const baseUrl = isProduction ? `https://${host}` : `${req.protocol}://${host}`
      const facturarPath = isProduction ? '/facturar.html' : '/facturar'
      const urlFacturacion = `${baseUrl}${facturarPath}?token=${ventaCreada.tokenQr}`

      const snapshot = buildVentaSnapshot({
        empresa: {
          id: empresaRow?.id,
          nombre: empresaRow?.nombreComercial || 'Empresa',
          nombreComercial: empresaRow?.nombreComercial || 'Empresa',
          rfc: empresaRow?.rfc || null,
          telefono: empresaRow?.whatsapp || null
        },
        sucursal: sucursalRow,
        ventaId: ventaCreada.id,
        folio,
        fecha: formatFechaTicket(),
        subtotal,
        descuento,
        total,
        productos: (ventaCreada.DetalleVenta || []).map((d) => ({
          nombre:         d.Producto?.nombre,
          cantidad:       d.cantidad,
          precioUnitario: d.precioUnitario,
          subtotal:       d.subtotal,
          unidad:         resolverUnidad(d)
        })),
        metodoPago,
        metodoLabel,
        montoPagado: montoPagadoFinal,
        cambio:      cambioFinal,
        cajero:  usuario?.nombre || req.usuario?.nombre || req.usuario?.username || null,
        cliente: clienteNombre,
        qrUrl:   urlFacturacion,
        abrirCajon
      })

      const printJob = await encolarImpresion(tx, {
        empresaId,
        tipo:      'VENTA',
        modo:      'ORIGINAL',
        entidadId: ventaCreada.id,
        ventaId:   ventaCreada.id,
        payload:   snapshot
      })
      // ═══ fin impresión ═══

      return { venta: ventaCreada, receipt: snapshot, printJobId: printJob.id }
    })

    const ventaCreada = venta.venta
    const receipt = venta.receipt
    const printJobId = venta.printJobId

    if (receipt?.qrUrl) {
      try {
        receipt.qrDataUrl = await QRCode.toDataURL(receipt.qrUrl, { width: 180, margin: 1 })
      } catch (error) {
        console.warn('⚠️ No se pudo generar QR visual:', error.message)
      }
    }

    console.log(`✅ Venta creada: ${ventaCreada.folio} - Total: $${ventaCreada.total}`)

    // Verificar stock post-operación (no bloqueante)
    const productoIds = ventaCreada.DetalleVenta?.map(d => d.productoId) || []
    let stockAlerts = []
    if (productoIds.length > 0) {
      try {
        stockAlerts = await verificarStockPostOperacion(prisma, empresaId, sucursalId, productoIds)
      } catch (err) {
        console.warn('⚠️ Error verificando stock post-venta:', err.message)
      }
    }

    res.status(201).json({
      success: true,
      message: 'Venta registrada correctamente',
      data: ventaCreada,
      receipt: { ...receipt, printJobId, printMode: 'ORIGINAL' },
      printJobId,
      stockAlerts
    })

  } catch (error) {
    console.error('❌ Error en crearVenta:', error)
    const status = error.status === 400 ? 400 : 500
    res.status(status).json({
      error:    error.message,
      codigo:   error.codigo   || null,
      sinStock: error.sinStock || null
    })
  }
}

/**
 * GET /ventas
 */
exports.obtenerVentas = async (req, res) => {
  try {
    const { skip = 0, take = 20, search, metodoPago, desde, hasta, turnoId, clienteId, usuarioId } = req.query
    const where = construirWhereScopeVentas(req)

    if (turnoId)   where.turnoId   = parseInt(turnoId)
    if (usuarioId) where.usuarioId = parseInt(usuarioId)

    if (clienteId === 'null') {
      where.clienteId = null
    } else if (clienteId && parseInt(clienteId) > 0) {
      where.clienteId = parseInt(clienteId)
    }

    if (search) {
      where.OR = [
        { folio:   { contains: search, mode: 'insensitive' } },
        { Cliente: { nombre: { contains: search, mode: 'insensitive' } } }
      ]
    }
    if (metodoPago) where.metodoPago = metodoPago

    if (desde || hasta) {
      where.creadaEn = {}
      if (desde) where.creadaEn.gte = new Date(desde)
      if (hasta) {
        const hastaDate = new Date(hasta)
        hastaDate.setHours(23, 59, 59, 999)
        where.creadaEn.lte = hastaDate
      }
    }

    const [ventas, total] = await Promise.all([
      prisma.venta.findMany({
        where, skip: parseInt(skip), take: parseInt(take), orderBy: { creadaEn: 'desc' },
        include: {
          Cliente: { select: { id: true, nombre: true } },
          Usuario: { select: { id: true, nombre: true } },
          DetalleVenta: { include: { Producto: { select: { nombre: true, codigoInterno: true } } } }
        }
      }),
      prisma.venta.count({ where })
    ])

    res.json({
      success: true,
      data: ventas.map(v => ({
        id:             v.id,
        folio:          v.folio,
        fecha:          v.creadaEn,
        cliente:        v.Cliente ? v.Cliente.nombre : 'Público general',
        clienteId:      v.clienteId,
        usuario:        v.Usuario.nombre,
        metodoPago:     v.metodoPago,
        total:          v.total,
        productosCount: v.DetalleVenta.length,
        estado:         v.estado,
        facturaEstado:  v.facturaEstado,
        detalles:       v.DetalleVenta.map(d => ({
          productoId:   d.productoId,
          nombre:       d.Producto?.nombre || '—',
          codigo:       d.Producto?.codigoInterno || '',
          cantidad:     d.cantidad,
          subtotal:      d.subtotal
        }))
      })),
      total, skip: parseInt(skip), take: parseInt(take)
    })
  } catch (error) {
    console.error('❌ Error en obtenerVentas:', error)
    res.status(error.status || 500).json({ error: error.message })
  }
}

/**
 * GET /ventas/:id
 */
exports.obtenerVenta = async (req, res) => {
  try {
    const { id } = req.params
    const venta = await prisma.venta.findFirst({
      where: { id: parseInt(id), ...construirWhereScopeVentas(req) },
      include: {
        Usuario:  { select: { id: true, nombre: true } },
        Cliente:  true,
        Sucursal: true,
        DetalleVenta: { include: { Producto: true } }
      }
    })
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })

    res.json({
      success: true,
      data: {
        id:            venta.id,
        folio:         venta.folio,
        fecha:         venta.creadaEn,
        usuario:       venta.Usuario.nombre,
        cliente:       venta.Cliente ? {
          id:                 venta.Cliente.id,
          nombre:             venta.Cliente.nombre,
          rfc:                venta.Cliente.rfc,
          razonSocial:        venta.Cliente.razonSocial,
          regimenFiscal:      venta.Cliente.regimenFiscal,
          codigoPostalFiscal: venta.Cliente.codigoPostalFiscal,
          usoCfdi:            venta.Cliente.usoCfdi,
          email:              venta.Cliente.email,
          emailSecundario1:  venta.Cliente.emailSecundario1,
          emailSecundario2:  venta.Cliente.emailSecundario2
        } : null,
        sucursal:      venta.Sucursal.nombre,
        metodoPago:    venta.metodoPago,
        subtotal:      venta.subtotal,
        iva:           venta.iva,
        descuento:     venta.descuento,
        total:         venta.total,
        montoPagado:   venta.montoPagado,
        cambio:        venta.cambio,
        estado:        venta.estado,
        tokenQr:       venta.tokenQr,
        facturaEstado: venta.facturaEstado,
        desglosePagos: venta.desglosePagos || null,
        notas:         venta.notas,
        detalles: venta.DetalleVenta.map(d => ({
          productoId:     d.productoId,
          nombre:         d.Producto.nombre,
          codigo:         d.Producto.codigoInterno,
          cantidad:       d.cantidad,
          precioUnitario: d.precioUnitario,
          subtotal:       d.subtotal,
          esGranel:       (d.esGranelSnapshot ?? d.Producto?.esGranel) || false,
          unidadVenta:    d.unidadVentaSnapshot ?? d.Producto?.unidadVenta ?? null,
          unidadCapturadaSnapshot:   d.unidadCapturadaSnapshot,
          esGranelSnapshot:          d.esGranelSnapshot,
          factorConversionSnapshot:  d.factorConversionSnapshot,
          modoCapturaSnapshot:       d.modoCapturaSnapshot,
          cantidadCapturadaSnapshot: d.cantidadCapturadaSnapshot,
          importeCapturadoSnapshot:  d.importeCapturadoSnapshot
        }))
      }
    })
  } catch (error) {
    console.error('❌ Error en obtenerVenta:', error)
    res.status(error.status || 500).json({ error: error.message })
  }
}

/**
 * GET /ventas/folio/:folio
 */
exports.obtenerVentaPorFolio = async (req, res) => {
  try {
    const { folio } = req.params
    const venta = await prisma.venta.findFirst({
      where: { folio, ...construirWhereScopeVentas(req) },
      include: {
        Usuario:  { select: { id: true, nombre: true } },
        Cliente:  true,
        Sucursal: true,
        DetalleVenta: { include: { Producto: true } }
      }
    })
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })

    res.json({
      success: true,
      data: {
        id:            venta.id,
        folio:         venta.folio,
        fecha:         venta.creadaEn,
        usuario:       venta.Usuario.nombre,
        cliente:       venta.Cliente ? {
          id:                 venta.Cliente.id,
          nombre:             venta.Cliente.nombre,
          rfc:                venta.Cliente.rfc,
          razonSocial:        venta.Cliente.razonSocial,
          regimenFiscal:      venta.Cliente.regimenFiscal,
          codigoPostalFiscal: venta.Cliente.codigoPostalFiscal,
          usoCfdi:            venta.Cliente.usoCfdi,
          email:              venta.Cliente.email,
          emailSecundario1:  venta.Cliente.emailSecundario1,
          emailSecundario2:  venta.Cliente.emailSecundario2
        } : null,
        sucursal:      venta.Sucursal.nombre,
        metodoPago:    venta.metodoPago,
        subtotal:      venta.subtotal,
        iva:           venta.iva,
        descuento:     venta.descuento,
        total:         venta.total,
        montoPagado:   venta.montoPagado,
        cambio:        venta.cambio,
        estado:        venta.estado,
        tokenQr:       venta.tokenQr,
        facturaEstado: venta.facturaEstado,
        desglosePagos: venta.desglosePagos || null,
        notas:         venta.notas,
        detalles: venta.DetalleVenta.map(d => ({
          productoId:     d.productoId,
          nombre:         d.Producto.nombre,
          codigo:         d.Producto.codigoInterno,
          cantidad:       d.cantidad,
          precioUnitario: d.precioUnitario,
          subtotal:       d.subtotal,
          esGranel:       (d.esGranelSnapshot ?? d.Producto?.esGranel) || false,
          unidadVenta:    d.unidadVentaSnapshot ?? d.Producto?.unidadVenta ?? null,
          unidadCapturadaSnapshot:   d.unidadCapturadaSnapshot,
          esGranelSnapshot:          d.esGranelSnapshot,
          factorConversionSnapshot:  d.factorConversionSnapshot,
          modoCapturaSnapshot:       d.modoCapturaSnapshot,
          cantidadCapturadaSnapshot: d.cantidadCapturadaSnapshot,
          importeCapturadoSnapshot:  d.importeCapturadoSnapshot
        }))
      }
    })
  } catch (error) {
    console.error('❌ Error en obtenerVentaPorFolio:', error)
    res.status(error.status || 500).json({ error: error.message })
  }
}

/**
 * GET /ventas/historial/lista
 */
exports.obtenerHistorial = async (req, res) => {
  return exports.obtenerVentas(req, res)
}

// ════════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ════════════════════════════════════════════════════════════════════
async function generarFolio() {
  const fecha    = new Date()
  const año      = fecha.getFullYear()
  const mes      = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia      = String(fecha.getDate()).padStart(2, '0')
  const fechaStr = `${año}${mes}${dia}`
  const result   = await prisma.$queryRaw`SELECT nextval('folio_venta_seq') as seq`
  const secuencial = String(Number(result[0].seq)).padStart(5, '0')
  return `VTA-${fechaStr}-${secuencial}`
}

function generarUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// ════════════════════════════════════════════════════════════════════
//  CANCELAR VENTA
//  PATCH /ventas/:id/cancelar
// ════════════════════════════════════════════════════════════════════
exports.cancelarVenta = async (req, res) => {
  try {
    const id      = parseInt(req.params.id)
    const usuario = req.usuario   // ← usa req.usuario (middleware JWT de JESHA)
    const { motivo } = req.body

    const venta = await prisma.venta.findFirst({
      where:   { id, ...construirWhereScopeVentas(req) },
      include: { DetalleVenta: true }
    })

    if (!venta)
      return res.status(404).json({ error: 'Venta no encontrada' })

    const empresaId = venta.empresaId

    if (venta.estado === 'CANCELADA')
      return res.status(409).json({ error: 'La venta ya está cancelada' })

    if (venta.estado === 'DEVOLUCION')
      return res.status(409).json({ error: 'Esta venta tiene devoluciones — cancela las devoluciones primero o usa el módulo de devoluciones.' })

    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO']
    if (!rolesPermitidos.includes(usuario.rol))
      return res.status(403).json({ error: 'Sin permiso para cancelar ventas' })

    // === Validar bitácora vinculada (si es venta a crédito) ===
    const detallesBitacora = await prisma.detalleBitacora.findMany({
      where: { ventaId: venta.id },
      include: {
        Bitacora: { select: { id: true, folio: true, totalAbonado: true } }
      }
    })

    if (detallesBitacora.length > 0) {
      const bitacora = detallesBitacora[0].Bitacora
      if (!bitacora) {
        return res.status(409).json({
          error: 'Inconsistencia de datos: DetalleBitacora sin Bitacora padre. Contacta soporte.'
        })
      }
      if (parseFloat(bitacora.totalAbonado) > 0) {
        return res.status(400).json({
          error: `No se puede cancelar — la bitácora ${bitacora.folio} ya tiene abonos por $${parseFloat(bitacora.totalAbonado).toFixed(2)}. Usa el módulo de Devoluciones para procesar reembolso al cliente.`,
          codigo: 'BITACORA_CON_ABONOS'
        })
      }
    }

    // ── POLÍTICA P0.9: Bloquear cancelación si hay CFDI activo ──
    const cfdiActivo = await prisma.facturaCfdi.findFirst({
      where: { ventaId: venta.id, estado: { not: 'CANCELADA' } },
      select: { id: true, folioFiscal: true }
    })
    if (cfdiActivo) {
      return res.status(409).json({
        error: `No se puede cancelar — la venta tiene un CFDI activo (${cfdiActivo.folioFiscal || 'pendiente'}). Cancela primero la factura en el SAT.`,
        codigo: 'VENTA_CON_CFDI_ACTIVO'
      })
    }

    // Validar que el turno siga abierto (no cancelar ventas de turnos cerrados)
    if (venta.turnoId) {
      const turnoVenta = await prisma.turnoCaja.findUnique({
        where: { id: venta.turnoId },
        select: { abierto: true }
      })
      if (!turnoVenta || !turnoVenta.abierto) {
        return res.status(400).json({
          error: 'No se puede cancelar — el turno de esta venta ya fue cerrado',
          codigo: 'TURNO_CERRADO'
        })
      }
    }

    await prisma.$transaction(async (tx) => {
      // ── FOR UPDATE lock para serializar cancelaciones concurrentes ──
      const lockRows = await tx.$queryRaw`
        SELECT id, estado FROM "Venta"
        WHERE id = ${id} AND "empresaId" = ${empresaId}
        FOR UPDATE`
      if (lockRows.length === 0 || lockRows[0].estado === 'CANCELADA') {
        throw Object.assign(new Error('La venta ya fue cancelada o no existe'), { status: 409 })
      }

      await tx.venta.update({
        where: { id },
        data:  { estado: 'CANCELADA', facturaEstado: 'BLOQUEADA' }
      })

      for (const detalle of venta.DetalleVenta) {
        const inv = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: venta.sucursalId } }
        })
        if (inv) {
          const stockAntes   = parseFloat(inv.stockActual)
          const stockDespues = parseFloat((stockAntes + parseFloat(detalle.cantidad)).toFixed(3))
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: venta.sucursalId } },
            data:  { stockActual: stockDespues }
          })
          await tx.movimientoInventario.create({
            data: {
              empresaId,
              productoId:   detalle.productoId,
              sucursalId:   venta.sucursalId,
              usuarioId:    usuario.id,
              turnoId:      venta.turnoId,
              tipo:         'CANCELACION_VENTA',
              cantidad:     parseFloat(detalle.cantidad),
              stockAntes,
              stockDespues,
              referencia:   venta.folio,
              notas:        `Cancelación de venta ${venta.folio}`
            }
          })
        }
      }

      // P0.15: No crear DEVOLUCION de efectivo para ventas a credito (nunca entro dinero)
      if (venta.turnoId && venta.metodoPago !== 'CREDITO_CLIENTE') {
        const turno = await tx.turnoCaja.findFirst({ where: { id: venta.turnoId } })
        if (turno) {
          if (venta.metodoPago === 'MIXTO' && venta.desglosePagos) {
            // MIXTO: un movimiento de devolución por cada pago original
            for (const pago of venta.desglosePagos) {
              await tx.movimientoCaja.create({
                data: {
                  empresaId,
                  turnoId:    turno.id,
                  tipo:       'DEVOLUCION',
                  monto:      -parseFloat(pago.monto),
                  metodoPago: pago.metodo,
                  referencia: venta.folio,
                  notas:      motivo || `Cancelación mixto ${pago.metodo} — ${venta.folio}`
                }
              })
            }
          } else {
            await tx.movimientoCaja.create({
              data: {
                empresaId,
                turnoId:    turno.id,
                tipo:       'DEVOLUCION',
                monto:      -parseFloat(venta.total),
                metodoPago: venta.metodoPago,
                referencia: venta.folio,
                notas:      motivo || `Cancelación de ${venta.folio}`
              }
            })
          }
        }
      }

      // === Limpiar bitácora si la venta era a crédito ===
      const detallesParaLimpiar = await tx.detalleBitacora.findMany({
        where: { ventaId: venta.id },
        select: { id: true, bitacoraId: true, subtotal: true }
      })

      if (detallesParaLimpiar.length > 0) {
        const bitacoraId = detallesParaLimpiar[0].bitacoraId
        const montoARestar = detallesParaLimpiar.reduce(
          (sum, d) => sum + parseFloat(d.subtotal),
          0
        )

        await tx.detalleBitacora.deleteMany({
          where: { ventaId: venta.id }
        })

        await tx.bitacora.update({
          where: { id: bitacoraId },
          data: {
            totalMateriales: { decrement: montoARestar },
            saldoPendiente:  { decrement: montoARestar }
          }
        })

        // Decrementar saldoPendiente del cliente (el que se incrementó al crear venta a crédito)
        await tx.cliente.update({
          where: { id: venta.clienteId },
          data: {
            saldoPendiente: { decrement: parseFloat(venta.total) }
          }
        })

        await tx.auditoria.create({
          data: {
            empresaId,
            usuarioId:    usuario.id,
            sucursalId:   venta.sucursalId,
            accion:       'LIMPIAR_BITACORA_POR_CANCELACION',
            modulo:       'VENTAS',
            referencia:   venta.folio,
            valorDespues: {
              bitacoraId,
              montoRestado: montoARestar,
              detallesEliminados: detallesParaLimpiar.length,
              montoSaldoDecrementado: parseFloat(venta.total)
            }
          }
        })
      }

      await tx.auditoria.create({
        data: {
          empresaId,
          usuarioId:    usuario.id,
          sucursalId:   venta.sucursalId,
          accion:       'CANCELAR_VENTA',
          modulo:       'VENTAS',
          referencia:   venta.folio,
          valorAntes:   { estado: 'COMPLETADA' },
          valorDespues: { estado: 'CANCELADA', motivo: motivo || null }
        }
      })
    })

    console.log(`✅ Venta ${venta.folio} cancelada por ${usuario.nombre}`)
    res.json({ success: true, message: `Venta ${venta.folio} cancelada correctamente` })

  } catch (err) {
    console.error('❌ Error en cancelarVenta:', err)
    res.status(err.status || 500).json({ error: err.message, codigo: err.codigo || null })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /ventas/:id/metodo-pago — Actualizar método de pago
//
//  FIX vs versión anterior:
//  1. Usa req.usuario (consistente con cancelarVenta)
//  2. MovimientoCaja usa turnoId (del schema real), NO cajaId/conceptoTipo
//  3. facturaEstado desbloqueo va a 'DISPONIBLE', NO a null
//  4. deleteMany filtra por tipo:'VENTA' para no borrar devoluciones
//  5. Permisos: solo SUPERADMIN y ADMIN_SUCURSAL pueden editar método
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  PATCH /ventas/:id/desbloquear-factura — Desbloquea facturación
//  para venta CREDITO_CLIENTE cuya bitácora ya fue liquidada.
//  No modifica metodoPago ni MovimientoCaja.
// ════════════════════════════════════════════════════════════════════
exports.desbloquearFactura = async (req, res) => {
  try {
    const ventaId = parseInt(req.params.id)
    const empresaId = getEmpresaId(req)
    const usuario  = req.usuario
    if (!usuario) return res.status(401).json({ error: 'Usuario no autenticado' })

    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL']
    if (!rolesPermitidos.includes(usuario.rol)) {
      return res.status(403).json({ error: 'Sin permiso para desbloquear facturación' })
    }

    const venta = await prisma.venta.findFirst({
      where: { id: ventaId, ...construirWhereScopeVentas(req) },
      include: { Cliente: true }
    })
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })

    if (venta.metodoPago !== 'CREDITO_CLIENTE') {
      return res.status(409).json({ error: 'Solo aplica a ventas a crédito', codigo: 'METODO_NO_CREDITO' })
    }
    if (venta.facturaEstado !== 'BLOQUEADA') {
      return res.status(409).json({ error: `La venta no está bloqueada (estado actual: ${venta.facturaEstado})`, codigo: 'FACTURA_NO_BLOQUEADA' })
    }
    if (venta.estado === 'CANCELADA') {
      return res.status(409).json({ error: 'La venta está cancelada' })
    }

    // Verificar que todas las bitácoras asociadas estén cerradas
    const detallesBitacora = await prisma.detalleBitacora.findMany({
      where: { ventaId, Bitacora: { estado: { not: 'CANCELADA' } } },
      select: { Bitacora: { select: { id: true, folio: true, estado: true, saldoPendiente: true } } }
    })

    // Filtrar detalles con bitácora válida
    const bitacoras = [...new Map(
      detallesBitacora.filter(d => d.Bitacora).map(d => [d.Bitacora.id, d.Bitacora])
    ).values()]

    if (bitacoras.length === 0) {
      return res.status(409).json({ error: 'No se encontró bitácora asociada', codigo: 'SIN_BITACORA' })
    }

    const bitacorasAbiertas = bitacoras.filter(b => parseFloat(b.saldoPendiente) > 0)
    if (bitacorasAbiertas.length > 0) {
      return res.status(409).json({
        error: `La bitácora aún tiene saldo pendiente ($${bitacorasAbiertas[0].saldoPendiente}). Liquídala primero.`,
        codigo: 'BITACORA_CON_SALDO'
      })
    }

    // Verificar CFDI activo
    const cfdiActivo = await prisma.facturaCfdi.findFirst({
      where: { ventaId, estado: { not: 'CANCELADA' } },
      select: { id: true, folioFiscal: true }
    })
    if (cfdiActivo) {
      return res.status(409).json({
        error: `La venta ya tiene un CFDI activo (${cfdiActivo.folioFiscal || 'pendiente'}).`,
        codigo: 'VENTA_CON_CFDI_ACTIVO'
      })
    }

    // Desbloquear
    const facturaLimite = new Date()
    facturaLimite.setDate(facturaLimite.getDate() + 30)

    const ventaActualizada = await prisma.venta.update({
      where: { id: ventaId },
      data: { facturaEstado: 'DISPONIBLE', facturaLimite }
    })

    await prisma.auditoria.create({
      data: {
        empresaId, usuarioId: usuario.id, sucursalId: venta.sucursalId,
        accion: 'DESBLOQUEAR_FACTURA_CREDITO',
        modulo: 'VENTAS',
        referencia: venta.folio,
        valorAntes: { facturaEstado: 'BLOQUEADA', facturaLimite: null },
        valorDespues: { facturaEstado: 'DISPONIBLE', facturaLimite }
      }
    })

    res.json({ success: true, venta: ventaActualizada, mensaje: 'Facturación desbloqueada. Ya puedes facturar esta venta.' })

  } catch (err) {
    console.error('❌ Error en desbloquearFactura:', err)
    res.status(500).json({ error: err.message })
  }
}

exports.actualizarMetodoPago = async (req, res) => {
  try {
    const ventaId  = parseInt(req.params.id)
    const usuario  = req.usuario   // ← consistente con cancelarVenta
    const { nuevoMetodo } = req.body
    const empresaId = getEmpresaId(req)

    if (!usuario) {
      return res.status(401).json({ error: 'Usuario no autenticado' })
    }

    // ── Solo SUPERADMIN y ADMIN_SUCURSAL pueden cambiar el método ──
    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL']
    if (!rolesPermitidos.includes(usuario.rol)) {
      return res.status(403).json({ error: 'Sin permiso para editar el método de pago' })
    }

    // ── Validar método válido ──
    const metodosValidos = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA']
    if (!metodosValidos.includes(nuevoMetodo)) {
      return res.status(400).json({ error: 'Método de pago inválido' })
    }

    // ── Obtener venta ──
    // P0-BRANCH-ISOLATION: scope de tenant y sucursal (anti cross-tenant/cross-branch)
    const venta = await prisma.venta.findFirst({
      where:   { id: ventaId, ...construirWhereScopeVentas(req) },
      include: { Cliente: true }
    })

    if (!venta) {
      return res.status(404).json({ error: 'Venta no encontrada' })
    }

    // ── Bloquear edición de ventas MIXTO ──
    if (venta.metodoPago === 'MIXTO') {
      return res.status(400).json({ error: 'No se puede cambiar el método de pago de una venta con pago mixto. Cancela y crea una nueva.', codigo: 'MIXTO_NO_EDITABLE' })
    }

    // ── POLÍTICA P0.11: Bloquear cambios reales de método post-venta ──
    if (venta.metodoPago !== nuevoMetodo) {
      return res.status(409).json({
        error: 'El cambio de método de pago después de confirmar la venta no está disponible temporalmente.',
        codigo: 'CAMBIO_METODO_POSTVENTA_NO_DISPONIBLE'
      })
    }

    return res.json({ message: 'El método de pago ya es el seleccionado', venta })

  } catch (err) {
    console.error('❌ Error en actualizarMetodoPago:', err)
    res.status(500).json({ error: err.message || 'Error al actualizar método de pago' })
  }
}

// ════════════════════════════════════════════════════════════════════════
//  REPORTE DE VENTAS — Top productos pre-calculado
// ════════════════════════════════════════════════════════════════════════
exports.obtenerReporteVentas = async (req, res) => {
  try {
    const { desde, hasta } = req.query

    if (!desde || !hasta) {
      return res.status(400).json({ error: 'Se requiere desde y hasta' })
    }

    const desdeDate = new Date(desde)
    const hastaDate = new Date(hasta)
    hastaDate.setHours(23, 59, 59, 999)

    const sucursalId = resolverSucursalId(req)
    const empresaId = getEmpresaId(req)

    // Query 1: Ventas con detalles + producto + categoría + usuario
    // P0-BRANCH-ISOLATION (H2): el where SIEMPRE arranca con empresaId (tenant obligatorio).
    const ventasWhere = {
      empresaId,
      creadaEn: { gte: desdeDate, lte: hastaDate },
      estado: { not: 'CANCELADA' }
    }
    if (sucursalId) ventasWhere.sucursalId = sucursalId

    const ventas = await prisma.venta.findMany({
      where: ventasWhere,
      include: {
        Cliente: { select: { nombre: true } },
        Usuario: { select: { nombre: true } },
        DetalleVenta: {
          select: {
            cantidad: true,
            precioUnitario: true,
            subtotal: true,
            productoId: true,
            Producto: {
              select: {
                nombre: true,
                codigoInterno: true,
                imagenUrl: true,
                costo: true,
                costoPromedio: true,
                categoriaId: true,
                Categoria: {
                  select: { nombre: true }
                }
              }
            }
          }
        }
      },
      orderBy: { creadaEn: 'desc' }
    })

    // Query 2: Top productos pre-calculado (CORREGIDO: creadaEn no createdEn)
    // P0-BRANCH-ISOLATION (H2): el where de Venta SIEMPRE incluye empresaId.
    const topWhere = {
      Venta: {
        empresaId,
        creadaEn: { gte: desdeDate, lte: hastaDate },
        estado: { not: 'CANCELADA' }
      }
    }
    if (sucursalId) topWhere.Venta.sucursalId = sucursalId

    const topProductos = await prisma.detalleVenta.groupBy({
      by: ['productoId'],
      where: topWhere,
      _sum: {
        cantidad: true,
        subtotal: true
      },
      orderBy: {
        _sum: { cantidad: 'desc' }
      },
      take: 10
    })

    // Obtener datos completos de productos del top
    const productoIds = topProductos.map(t => t.productoId)
    // P0-BRANCH-ISOLATION: productos scoped por empresa
    const productos = await prisma.producto.findMany({
      where: { id: { in: productoIds }, empresaId },
      select: {
        id: true,
        nombre: true,
        codigoInterno: true,
        imagenUrl: true,
        costo: true,
        costoPromedio: true,
        Categoria: { select: { nombre: true } }
      }
    })
    const productoMap = productos.reduce((acc, p) => {
      acc[p.id] = p
      return acc
    }, {})

    // Mapear top productos con datos enriquecidos
    const topProductosConNombre = topProductos.map(t => {
      const prod = productoMap[t.productoId] || {}
      return {
        productoId: t.productoId,
        nombre: prod.nombre || '—',
        codigo: prod.codigoInterno || '',
        cantidad: parseFloat(t._sum.cantidad || 0),
        importe: parseFloat(t._sum.subtotal || 0),
        imagenUrl: prod.imagenUrl || null,
        categoriaNombre: prod.Categoria?.nombre || null,
        costoPromedio: prod.costoPromedio ? parseFloat(prod.costoPromedio) : (prod.costo ? parseFloat(prod.costo) : null),
        costo: prod.costo ? parseFloat(prod.costo) : null
      }
    })

    res.json({
      success: true,
      desde,
      hasta,
      ventas: ventas.map(v => ({
        id: v.id,
        folio: v.folio,
        fecha: v.creadaEn,
        metodoPago: v.metodoPago,
        total: v.total,
        estado: v.estado,
        clienteId: v.clienteId,
        cliente: v.Cliente?.nombre || 'Público general',
        usuarioId: v.usuarioId,
        sucursalId: v.sucursalId,
        vendedorNombre: v.Usuario?.nombre || null,
        desglosePagos: v.desglosePagos,
        detalles: v.DetalleVenta.map(d => ({
          productoId: d.productoId,
          cantidad: parseFloat(d.cantidad),
          precioUnitario: parseFloat(d.precioUnitario),
          subtotal: parseFloat(d.subtotal),
          producto: d.Producto ? {
            nombre: d.Producto.nombre,
            codigoInterno: d.Producto.codigoInterno,
            imagenUrl: d.Producto.imagenUrl || null,
            categoriaId: d.Producto.categoriaId,
            categoriaNombre: d.Producto.Categoria?.nombre || null,
            costo: d.Producto.costo ? parseFloat(d.Producto.costo) : null,
            costoPromedio: d.Producto.costoPromedio ? parseFloat(d.Producto.costoPromedio) : null
          } : null
        }))
      })),
      topProductos: topProductosConNombre
    })

  } catch (error) {
    console.error('❌ Error en obtenerReporteVentas:', error)
    res.status(500).json({ error: error.message })
  }
}

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD KPIs — Datos optimizados para el dashboard
// ════════════════════════════════════════════════════════════════════════
exports.obtenerDashboardKpis = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const branchSucursalId = req.context.branch.sucursalId

    // DEPRECATED_QUERY_SUCURSAL_ID: req.query.sucursalId ignorado
    // La autoridad es req.context.branch.sucursalId (NONE, FIXED o SELECTED)

    const whereBase = {
      empresaId,
      estado: { not: 'CANCELADA' }
    }
    if (branchSucursalId !== null) whereBase.sucursalId = branchSucursalId

    const { desde, hasta } = req.query
    let desdeDate, hastaDate

    if (desde !== undefined || hasta !== undefined) {
      if (!desde || !hasta) {
        return res.status(400).json({ error: 'Los parámetros desde y hasta son requeridos cuando se especifica uno' })
      }
      desdeDate = new Date(desde)
      hastaDate = new Date(hasta)
      if (isNaN(desdeDate.getTime()) || isNaN(hastaDate.getTime())) {
        return res.status(400).json({ error: 'Formato de fecha inválido' })
      }
      if (desdeDate > hastaDate) {
        return res.status(400).json({ error: 'La fecha desde no puede ser posterior a hasta' })
      }
      hastaDate.setHours(23, 59, 59, 999)
    } else {
      const hoy = new Date()
      desdeDate = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
      hastaDate = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59)
    }

    const whereHoy = {
      ...whereBase,
      creadaEn: { gte: desdeDate, lte: hastaDate }
    }

    const whereHistorico = { ...whereBase }

    const whereAbonosHoy = {
      tipo: 'ABONO_BITACORA',
      creadoEn: { gte: desdeDate, lte: hastaDate }
    }
    if (branchSucursalId !== null) {
      whereAbonosHoy.TurnoCaja = { sucursalId: branchSucursalId, empresaId }
    } else {
      whereAbonosHoy.TurnoCaja = { empresaId }
    }

    const whereDevoluciones = {
      empresaId,
      creadaEn: { gte: desdeDate, lte: hastaDate },
      tipoReembolso: { in: ['REEMBOLSO', 'CAMBIO_PARCIAL'] }
    }
    if (branchSucursalId !== null) whereDevoluciones.sucursalId = branchSucursalId

    const [resHoy, resHistorico, resRecientes, resDevoluciones, resAbonos] = await Promise.all([
      prisma.venta.aggregate({
        where: whereHoy,
        _sum: { total: true },
        _count: { id: true }
      }),
      prisma.venta.aggregate({
        where: whereHistorico,
        _sum: { total: true },
        _count: { id: true }
      }),
      prisma.venta.findMany({
        where: whereBase,
        include: {
          Cliente: { select: { nombre: true } }
        },
        orderBy: { creadaEn: 'desc' },
        take: 8
      }),
      prisma.devolucion.aggregate({
        where: whereDevoluciones,
        _sum: { montoReembolso: true }
      }),
      prisma.movimientoCaja.aggregate({
        where: whereAbonosHoy,
        _sum: { monto: true },
        _count: { id: true }
      })
    ])

    const montoDevuelto = parseFloat(resDevoluciones._sum.montoReembolso || 0)
    const ventasNetasHoy = parseFloat(resHoy._sum.total || 0) - montoDevuelto

    res.json({
      success: true,
      ventasHoy: {
        total: ventasNetasHoy,
        totalBruto: parseFloat(resHoy._sum.total || 0),
        devoluciones: montoDevuelto,
        count: resHoy._count.id
      },
      ventasHistorico: {
        total: parseFloat(resHistorico._sum.total || 0),
        count: resHistorico._count.id
      },
      ventasRecientes: resRecientes.map(v => ({
        id: v.id,
        folio: v.folio,
        fecha: v.creadaEn,
        cliente: v.Cliente?.nombre || 'Público general',
        metodoPago: v.metodoPago,
        total: v.total,
        estado: v.estado
      })),
      cobranzaHoy: {
        total: parseFloat(resAbonos._sum.monto || 0),
        count: resAbonos._count.id
      }
    })

  } catch (error) {
    console.error('Error en obtenerDashboardKpis:', error)
    res.status(500).json({ error: error.message })
  }
}
