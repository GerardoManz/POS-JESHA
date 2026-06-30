// ════════════════════════════════════════════════════════════════════
//  VENTAS CONTROLLER
//  Ubicación: src/modules/ventas/ventas.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const os = require('os')
const { buildVentaSnapshot, formatFechaTicket } = require('../impresion/impresion.snapshot')
const { encolarImpresion } = require('../impresion/impresion.service')
const { EMPRESA, LOGO_URL } = require('../../../config/empresa')

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

function construirWhereScopeVentas(req) {
  const { rol, empresaId, sucursalId } = req.usuario || {}
  const where = {}

  if (rol !== 'PLATFORM_ADMIN') {
    if (!empresaId && rol !== 'SUPERADMIN') {
      const err = new Error('empresaId requerido para este rol')
      err.status = 401
      throw err
    }

    if (empresaId) where.empresaId = parseInt(empresaId)
  }

  if (!['SUPERADMIN', 'PLATFORM_ADMIN'].includes(rol)) {
    if (!sucursalId) {
      const err = new Error('Usuario sin sucursal asignada')
      err.status = 400
      throw err
    }
    where.sucursalId = parseInt(sucursalId)
  }

  return where
}

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

/**
 * POST /ventas
 */
exports.crearVenta = async (req, res) => {
  try {
    const sucursalId = parseInt(req.body.sucursalId)
    const usuarioId  = req.usuario.id   // A4: autoridad de venta = usuario autenticado (JWT), no el body
    const turnoId    = parseInt(req.body.turnoId)
    const { metodoPago, subtotal, iva, descuento, total, detalles, notas, montoPagado: montoPagadoRaw, cotizacionId } = req.body
    const clienteId  = req.body.clienteId ? parseInt(req.body.clienteId) : null
    const empresaId = getEmpresaId(req)

    if (!sucursalId || isNaN(sucursalId) || !usuarioId || isNaN(usuarioId) || !turnoId || isNaN(turnoId) || !metodoPago) {
      return res.status(400).json({ error: 'Faltan campos requeridos', campos: ['sucursalId', 'usuarioId', 'turnoId', 'metodoPago'] })
    }
    if (!detalles || detalles.length === 0) {
      return res.status(400).json({ error: 'La venta debe tener al menos 1 producto' })
    }

    const turno = await prisma.turnoCaja.findUnique({ where: { id: turnoId } })
    if (!turno || !turno.abierto) {
      return res.status(403).json({ error: 'Turno cerrado o no existe', codigo: 'SIN_TURNO_ABIERTO' })
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario || !usuario.activo) {
      return res.status(403).json({ error: 'Usuario inválido o inactivo' })
    }
    const rolesConVenta = ['EMPLEADO', 'ADMIN_SUCURSAL', 'SUPERADMIN', 'PLATFORM_ADMIN']
    if (!rolesConVenta.includes(usuario.rol)) {
      return res.status(403).json({ error: 'Usuario sin permiso para vender', codigo: 'SIN_PERMISO_VENTA' })
    }

    // ── Validar descuento por rol ──────────────────────────────────
    const descuentoAmt = parseFloat(parseFloat(descuento || 0).toFixed(2))
    if (descuentoAmt > 0 && usuario.rol === 'EMPLEADO') {
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

    let totalRecalculado = 0
    const detallesValidados = []
    for (const detalle of detalles) {
      const { productoId, cantidad, precioUnitario } = detalle
      if (!productoId || !cantidad || !precioUnitario) {
        return res.status(400).json({ error: 'Detalle incompleto', detalle })
      }
      if (cantidad <= 0) {
        return res.status(400).json({ error: 'Cantidad debe ser > 0', producto: productoId })
      }
      const cantidadFloat   = parseFloat(cantidad)
      const subtotalDetalle = parseFloat((cantidadFloat * precioUnitario).toFixed(2))
      totalRecalculado += subtotalDetalle
      detallesValidados.push({
        productoId:     parseInt(productoId),
        cantidad:       cantidadFloat,
        precioUnitario: parseFloat(precioUnitario),
        subtotal:       subtotalDetalle
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

    const esCredito = req.body.esCreditoCliente === true || req.body.esCreditoCliente === 'true'
                   || req.body.esCredito === true        || metodoPago === 'CREDITO_CLIENTE'
    let clienteCredito = null
    if (esCredito) {
      if (!clienteId) return res.status(400).json({ error: 'Se requiere cliente para venta a crédito' })
      clienteCredito = await prisma.cliente.findUnique({ where: { id: clienteId } })
      if (!clienteCredito) return res.status(404).json({ error: 'Cliente no encontrado' })
      if (clienteCredito.tipo !== 'REGISTRADO') return res.status(400).json({ error: 'Solo clientes REGISTRADO pueden comprar a crédito' })
      const disponible = parseFloat(clienteCredito.limiteCredito) - parseFloat(clienteCredito.saldoPendiente)
      if (disponible < totalEsperado) return res.status(400).json({ error: 'Crédito insuficiente', disponible, totalRequerido: totalEsperado })
    }

    const venta = await prisma.$transaction(async (tx) => {
      const inventarios = await tx.inventarioSucursal.findMany({
        where: { sucursalId, productoId: { in: detallesValidados.map(d => d.productoId) } }
      })

      const productosInfo = await tx.producto.findMany({
        where:  { id: { in: detallesValidados.map(d => d.productoId) } },
        select: { id: true, nombre: true }
      })
      const nombreProd = Object.fromEntries(productosInfo.map(p => [p.id, p.nombre]))

      const sinStock = []
      for (const detalle of detallesValidados) {
        const inventario  = inventarios.find(i => parseInt(i.productoId) === parseInt(detalle.productoId))
        const disponibles = inventario ? parseFloat(inventario.stockActual) : 0
        if (!inventario || disponibles < detalle.cantidad) {
          sinStock.push({
            productoId:  detalle.productoId,
            nombre:      nombreProd[detalle.productoId] || `Producto ${detalle.productoId}`,
            disponibles,
            solicitados: detalle.cantidad
          })
        }
      }

      if (sinStock.length > 0) {
        const err = new Error('Stock insuficiente')
        err.status   = 400
        err.codigo   = 'STOCK_INSUFICIENTE'
        err.sinStock = sinStock
        throw err
      }

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
            create: detallesValidados.map(d => ({
              productoId:     d.productoId,
              cantidad:       d.cantidad,
              precioUnitario: d.precioUnitario,
              subtotal:       d.subtotal,
              descuento:      0
            }))
          }
        },
        include: { DetalleVenta: { include: { Producto: true } } }
      })

      for (const detalle of detallesValidados) {
        // A2: decremento ATÓMICO. Solo descuenta si HAY stock suficiente en este instante.
        // Cierra la carrera entre dos cajas que venden el mismo producto a la vez.
        const upd = await tx.inventarioSucursal.updateMany({
          where: {
            productoId:  detalle.productoId,
            sucursalId,
            stockActual: { gte: detalle.cantidad }
          },
          data: { stockActual: { decrement: detalle.cantidad } }
        })

        if (upd.count === 0) {
          // No se descontó: o no existe el registro, o se quedó sin stock por una venta simultánea.
          const existe = await tx.inventarioSucursal.findUnique({
            where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
            select: { stockActual: true }
          })
          if (!existe) {
            throw Object.assign(
              new Error(`Registro de inventario no encontrado para producto ${detalle.productoId}`),
              { status: 400, codigo: 'INV_NOT_FOUND' }
            )
          }
          throw Object.assign(
            new Error('Stock insuficiente'),
            { status: 400, codigo: 'STOCK_INSUFICIENTE',
              sinStock: [{
                productoId:  detalle.productoId,
                nombre:      nombreProd[detalle.productoId] || `Producto ${detalle.productoId}`,
                disponibles: parseFloat(existe.stockActual),
                solicitados: detalle.cantidad
              }] }
          )
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
        for (const d of detallesValidados) {
          await tx.detalleBitacora.create({
            data: {
              bitacoraId:           bitacora.id,
              ventaId:              ventaCreada.id,
              productoId:           d.productoId,
              cantidad:             d.cantidad,
              precioUnitario:       d.precioUnitario,
              subtotal:             d.subtotal,
              inventarioDescontado: true,              // ya se descontó en la venta
              notas:                `Venta ${folio}`,
              fechaManual:          fechaLocalZacatecasComoDbDate(ventaCreada.creadaEn),
              responsableId:        usuarioId
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

      // Convertir cotización origen a CONVERTIDA (best-effort)
      if (cotizacionId) {
        try {
          const cot = await tx.cotizacion.findUnique({
            where: { id: parseInt(cotizacionId) },
            select: { id: true, estado: true }
          })
          if (cot && cot.estado === 'PENDIENTE') {
            await tx.cotizacion.update({
              where: { id: cot.id },
              data: { estado: 'CONVERTIDA' }
            })
          }
        } catch (e) {
          console.warn('⚠️ No se pudo convertir cotización:', e.message)
        }
      }

      // ═══ Impresión: encolar ticket de venta (atómico con la venta) ═══
      const empresaRow = await tx.empresa.findUnique({
        where: { id: empresaId },
        select: { rfc: true }
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
        empresa: { ...EMPRESA, telefono: EMPRESA.tel1, rfc: empresaRow?.rfc },
        folio,
        fecha: formatFechaTicket(),
        subtotal,
        descuento,
        total,
        productos: (ventaCreada.DetalleVenta || []).map((d) => ({
          nombre:         d.Producto?.nombre,
          cantidad:       d.cantidad,
          precioUnitario: d.precioUnitario,
          subtotal:       d.subtotal
        })),
        metodoPago,
        metodoLabel,
        montoPagado: montoPagadoFinal,
        cambio:      cambioFinal,
        cajero:  req.usuario?.nombre || req.usuario?.username || null,
        cliente: clienteNombre,
        qrUrl:   urlFacturacion,
        logoUrl: LOGO_URL,
        abrirCajon
      })

      await encolarImpresion(tx, {
        empresaId,
        tipo:      'VENTA',
        modo:      'ORIGINAL',
        entidadId: ventaCreada.id,
        ventaId:   ventaCreada.id,
        payload:   snapshot
      })
      // ═══ fin impresión ═══

      return ventaCreada
    })

    console.log(`✅ Venta creada: ${venta.folio} - Total: $${venta.total}`)
    res.status(201).json({ success: true, message: 'Venta registrada correctamente', data: venta })

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
          esGranel:       d.Producto.esGranel || false,
          unidadVenta:    d.Producto.unidadVenta || ''
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
          subtotal:       d.subtotal
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

    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO', 'PLATFORM_ADMIN']
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

      if (venta.turnoId) {
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
    res.status(500).json({ error: 'Error al cancelar venta: ' + err.message })
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
    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN']
    if (!rolesPermitidos.includes(usuario.rol)) {
      return res.status(403).json({ error: 'Sin permiso para editar el método de pago' })
    }

    // ── Validar método válido ──
    const metodosValidos = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA', 'CREDITO_CLIENTE']
    if (!metodosValidos.includes(nuevoMetodo)) {
      return res.status(400).json({ error: 'Método de pago inválido' })
    }

    // ── Obtener venta ──
    const venta = await prisma.venta.findUnique({
      where:   { id: ventaId },
      include: { Cliente: true }
    })

    if (!venta) {
      return res.status(404).json({ error: 'Venta no encontrada' })
    }

    // ── Bloquear edición de ventas MIXTO ──
    if (venta.metodoPago === 'MIXTO') {
      return res.status(400).json({ error: 'No se puede cambiar el método de pago de una venta con pago mixto. Cancela y crea una nueva.', codigo: 'MIXTO_NO_EDITABLE' })
    }

    // ── Validar sucursal (SUPERADMIN puede editar todas) ──
    if (usuario.sucursalId && venta.sucursalId !== usuario.sucursalId) {
      return res.status(403).json({ error: 'No tienes permiso para editar esta venta' })
    }

    // ── VALIDACIÓN 1: Factura ya emitida ──
    if (venta.facturaEstado === 'FACTURADA' || venta.facturaEstado === 'TIMBRADA') {
      return res.status(400).json({ error: 'No se puede cambiar el método de pago de una venta ya facturada' })
    }

    // ── VALIDACIÓN 2: Venta cancelada ──
    if (venta.estado === 'CANCELADA') {
      return res.status(400).json({ error: 'No se puede editar una venta cancelada' })
    }

    // ── VALIDACIÓN 3: Sin cambio real ──
    if (venta.metodoPago === nuevoMetodo) {
      return res.json({ message: 'El método de pago ya es el seleccionado', venta })
    }

    // ── VALIDACIÓN 4: Crédito sin cliente ──
    if (nuevoMetodo === 'CREDITO_CLIENTE' && !venta.clienteId) {
      return res.status(400).json({ error: 'No se puede cambiar a crédito cliente sin un cliente registrado en la venta' })
    }

    // ── VALIDACIÓN 5: Límite de crédito ──
    if (nuevoMetodo === 'CREDITO_CLIENTE' && venta.clienteId && venta.metodoPago !== 'CREDITO_CLIENTE') {
      const cliente    = venta.Cliente
      const montoVenta = parseFloat(venta.total)
      const nuevoSaldo = parseFloat(cliente.saldoPendiente) + montoVenta

      if (nuevoSaldo > parseFloat(cliente.limiteCredito)) {
        return res.status(400).json({
          error: `Excede límite de crédito. Límite: $${parseFloat(cliente.limiteCredito).toFixed(2)}, Saldo actual: $${parseFloat(cliente.saldoPendiente).toFixed(2)}, Incremento: $${montoVenta.toFixed(2)}`
        })
      }
    }

    // ════════════════════════════════════════════════════════════════
    //  TRANSACCIÓN
    // ════════════════════════════════════════════════════════════════
    const metodoAnterior = venta.metodoPago
    const total          = parseFloat(venta.total)

    // Métodos que generan MovimientoCaja tipo VENTA
    const metodosConMovimiento = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA']
    const anteriorTeniaMovimiento = metodosConMovimiento.includes(metodoAnterior)
    const nuevoTieneMovimiento    = metodosConMovimiento.includes(nuevoMetodo)

    const result = await prisma.$transaction(async (tx) => {

      // ── PASO 1: Manejar MovimientoCaja ──────────────────────────
      if (anteriorTeniaMovimiento && !nuevoTieneMovimiento) {
        // EFECTIVO/TARJETA/TRANSFERENCIA → CREDITO_CLIENTE
        // Eliminar el movimiento de caja de la venta original
        // Filtramos por referencia (folio) Y tipo VENTA para no tocar devoluciones
        await tx.movimientoCaja.deleteMany({
          where: {
            referencia: venta.folio,
            tipo:       'VENTA'
          }
        })
      } else if (!anteriorTeniaMovimiento && nuevoTieneMovimiento) {
        // CREDITO_CLIENTE → EFECTIVO/TARJETA/TRANSFERENCIA
        // Crear MovimientoCaja en el turno de la venta
        const turno = await tx.turnoCaja.findUnique({
          where: { id: venta.turnoId }
        })
        if (!turno) {
          throw new Error('No se encontró el turno de la venta')
        }

        await tx.movimientoCaja.create({
          data: {
            empresaId,
            turnoId:    turno.id,
            tipo:       'VENTA',
            monto:      total,
            metodoPago: nuevoMetodo,
            referencia: venta.folio,
            notas:      `Cambio de método: ${metodoAnterior} → ${nuevoMetodo} (por ${usuario.nombre})`
          }
        })
      } else if (anteriorTeniaMovimiento && nuevoTieneMovimiento && metodoAnterior !== nuevoMetodo) {
        // EFECTIVO → TARJETA o similar: actualizar metodoPago en el movimiento existente
        await tx.movimientoCaja.updateMany({
          where: {
            referencia: venta.folio,
            tipo:       'VENTA'
          },
          data: {
            metodoPago: nuevoMetodo,
            notas:      `Método actualizado: ${metodoAnterior} → ${nuevoMetodo} (por ${usuario.nombre})`
          }
        })
      }

      // ── PASO 2: Actualizar saldo del cliente ────────────────────
      if (venta.clienteId) {
        const esAhoraCreditoCliente  = nuevoMetodo    === 'CREDITO_CLIENTE'
        const eraAntesCreditoCliente = metodoAnterior === 'CREDITO_CLIENTE'

        if (esAhoraCreditoCliente && !eraAntesCreditoCliente) {
          // Cambió A crédito → incrementar saldo pendiente
          await tx.cliente.update({
            where: { id: venta.clienteId },
            data:  { saldoPendiente: { increment: total } }
          })
        } else if (!esAhoraCreditoCliente && eraAntesCreditoCliente) {
          // Cambió DESDE crédito → decrementar saldo pendiente
          await tx.cliente.update({
            where: { id: venta.clienteId },
            data:  { saldoPendiente: { decrement: total } }
          })
        }
      }

      // ── PASO 3: Recalcular facturaEstado ────────────────────────
      // FIX: 'DISPONIBLE' en lugar de null — facturaEstado es enum, null no es válido
      let nuevoFacturaEstado = venta.facturaEstado

      if (nuevoMetodo === 'CREDITO_CLIENTE') {
        nuevoFacturaEstado = 'BLOQUEADA'
      } else if (nuevoMetodo === 'EFECTIVO' && total > 2000) {
        nuevoFacturaEstado = 'BLOQUEADA'
      } else if (venta.facturaEstado === 'BLOQUEADA') {
        // Estaba bloqueada por método anterior y ahora ya no aplica → desbloquear
        nuevoFacturaEstado = 'DISPONIBLE'
      }
      // Si estaba DISPONIBLE/VENCIDA/CANCELADA y el nuevo método no bloquea → sin cambio

      // ── PASO 4: Actualizar venta ─────────────────────────────────
      const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
      const notaAudit = `[${timestamp}] Método cambiado: ${metodoAnterior} → ${nuevoMetodo} (por ${usuario.nombre})`

      const ventaActualizada = await tx.venta.update({
        where: { id: ventaId },
        data: {
          metodoPago:    nuevoMetodo,
          facturaEstado: nuevoFacturaEstado,
          notas:         venta.notas ? `${venta.notas}\n${notaAudit}` : notaAudit
        },
        include: {
          Cliente:  { select: { nombre: true } },
          Usuario:  { select: { nombre: true } },
          Sucursal: { select: { nombre: true } },
          DetalleVenta: { include: { Producto: { select: { nombre: true, codigoInterno: true } } } }
        }
      })

      // ── PASO 5: Auditoria ────────────────────────────────────────
      await tx.auditoria.create({
        data: {
          empresaId,
          usuarioId:    usuario.id,
          sucursalId:   venta.sucursalId,
          accion:       'EDITAR_METODO_PAGO',
          modulo:       'VENTAS',
          referencia:   venta.folio,
          valorAntes:   { metodoPago: metodoAnterior, facturaEstado: venta.facturaEstado },
          valorDespues: { metodoPago: nuevoMetodo,    facturaEstado: nuevoFacturaEstado  }
        }
      })

      return ventaActualizada
    })

    res.json({ message: 'Método de pago actualizado correctamente', venta: result })

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
    const resolverSucursalId = require('../sucursal/sucursal.helper')

    if (!desde || !hasta) {
      return res.status(400).json({ error: 'Se requiere desde y hasta' })
    }

    const desdeDate = new Date(desde)
    const hastaDate = new Date(hasta)
    hastaDate.setHours(23, 59, 59, 999)

    const sucursalId = resolverSucursalId(req)

    // Query 1: Ventas resumidas (sin detalles)
    const ventasWhere = {
      creadaEn: { gte: desdeDate, lte: hastaDate },
      estado: { not: 'CANCELADA' }
    }
    if (sucursalId) ventasWhere.sucursalId = sucursalId

    const ventas = await prisma.venta.findMany({
      where: ventasWhere,
      include: {
        Cliente: { select: { nombre: true } }
      },
      orderBy: { creadaEn: 'desc' }
    })

    // Query 2: Top productos pre-calculado (CORREGIDO: creadaEn no createdEn)
    const topWhere = {
      Venta: {
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

    // Obtener nombres de productos
    const productoIds = topProductos.map(t => t.productoId)
    const productos = await prisma.producto.findMany({
      where: { id: { in: productoIds } },
      select: { id: true, nombre: true, codigoInterno: true }
    })
    const productoMap = productos.reduce((acc, p) => {
      acc[p.id] = p
      return acc
    }, {})

    // Mapear top productos con nombres
    const topProductosConNombre = topProductos.map(t => ({
      productoId: t.productoId,
      nombre: productoMap[t.productoId]?.nombre || '—',
      codigo: productoMap[t.productoId]?.codigoInterno || '',
      cantidad: parseFloat(t._sum.cantidad || 0),
      importe: parseFloat(t._sum.subtotal || 0)
    }))

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
        desglosePagos: v.desglosePagos
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
    const { desde, hasta, sucursalId } = req.query
    const { sucursalId: sucursalUsuario } = req.usuario

    // Determinar sucursal (del query o del token)
    const filterSucursalId = sucursalId || sucursalUsuario

    // Construir where base (siempre exclude canceladas)
    const whereBase = {
      estado: { not: 'CANCELADA' }
    }
    if (filterSucursalId) whereBase.sucursalId = parseInt(filterSucursalId)

    // Query 1: Ventas de hoy
    let desdeDate, hastaDate
    if (desde && hasta) {
      desdeDate = new Date(desde)
      hastaDate = new Date(hasta)
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

    // Query 2: Ventas históricas (sin rango de fechas)
    const whereHistorico = { ...whereBase }

    // Queries en paralelo
    const [resHoy, resHistorico, resRecientes, resDevoluciones] = await Promise.all([
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
        where: {
          creadaEn: { gte: desdeDate, lte: hastaDate },
          tipoReembolso: { in: ['REEMBOLSO', 'CAMBIO_PARCIAL'] }
        },
        _sum: { montoReembolso: true }
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
      }))
    })

  } catch (error) {
    console.error('❌ Error en obtenerDashboardKpis:', error)
    res.status(500).json({ error: error.message })
  }
}
