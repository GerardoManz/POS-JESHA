const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')

const EMPRESA = {
  nombre:   'Ferretería e Iluminación JESHA',
  slogan:   'Productos y Servicios de Máxima Calidad',
  direccion:'Av. San Simón #03',
  ciudad:   'Guadalupe, Zacatecas',
  tel1:     '492 101 6879',
}

// ════════════════════════════════════════════════════════════════════
//  FUENTE ÚNICA DE VERDAD DEL EFECTIVO EN CAJA
//  Convención de signo (ledger contable estándar):
//    · monto POSITIVO = entrada al cajón
//    · monto NEGATIVO = salida del cajón
//  Se reconcilia SOLO el efectivo físico:
//    · APERTURA            → fondo inicial (siempre efectivo)
//    · metodoPago EFECTIVO → ventas (+), devoluciones (− ya viene negativo),
//                            abonos de bitácora (+), y ajustes futuros (con signo)
//  Tarjeta, transferencia, crédito y CIERRE no tocan el cajón → se ignoran.
//
//  Reemplaza al antiguo mecanismo `foliosEfectivo`, que decidía "es efectivo"
//  según el metodoPago de la VENTA y por eso fallaba con:
//    - ventas MIXTO (cuyo metodoPago es 'MIXTO', no 'EFECTIVO')
//    - ventas con devolución parcial (cuyo estado pasa a 'DEVOLUCION')
//
//  NOTA para AJUSTE (hoy código muerto): si se implementa, guardar
//  metodoPago: 'EFECTIVO' y monto CON SIGNO (− salida / + entrada).
// ════════════════════════════════════════════════════════════════════

function calcularEfectivoEnCaja(movimientos) {
  const total = movimientos.reduce((sum, m) => {
    if (m.tipo === 'CIERRE')      return sum
    if (m.tipo === 'APERTURA')    return sum + parseFloat(m.monto)
    if (m.metodoPago === 'EFECTIVO') return sum + parseFloat(m.monto)
    return sum
  }, 0)
  return parseFloat(total.toFixed(2))
}

function calcularTotalesPorMetodoDesdeMovimientos(movimientos) {
  const movimientosCaja = movimientos.filter(m => ['VENTA', 'DEVOLUCION'].includes(m.tipo))
  const sumar = (pred) => parseFloat(
    movimientosCaja.filter(pred).reduce((s, m) => s + parseFloat(m.monto), 0).toFixed(2)
  )

  const totalEfectivo      = sumar(m => m.metodoPago === 'EFECTIVO')
  const totalTarjeta       = sumar(m => m.metodoPago === 'DEBITO' || m.metodoPago === 'CREDITO')
  const totalTransferencia = sumar(m => m.metodoPago === 'TRANSFERENCIA')

  return {
    totalEfectivo,
    totalTarjeta,
    totalTransferencia,
    totalGeneral: parseFloat((totalEfectivo + totalTarjeta + totalTransferencia).toFixed(2))
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /turnos-caja/activo
// ════════════════════════════════════════════════════════════════════

const obtenerActivo = async (req, res) => {
  try {
    const { sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.query.sucursalId) || 1

    const turno = await prisma.turnoCaja.findFirst({
      where: { sucursalId, abierto: true },
      include: {
        Usuario: { select: { id: true, nombre: true } },
        Sucursal: { select: { id: true, nombre: true } }
      }
    })

    if (!turno) {
      return res.status(404).json({ error: 'No hay turno abierto', codigo: 'SIN_TURNO' })
    }

    res.json({ success: true, data: turno })
  } catch (err) {
    console.error('❌ Error obteniendo turno activo:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /turnos-caja/resumen
//  Totales del turno activo. El efectivo esperado se calcula desde el
//  ledger MovimientoCaja (misma función que el cierre → preview == final).
// ════════════════════════════════════════════════════════════════════

const obtenerResumen = async (req, res) => {
  try {
    const { sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.query.sucursalId) || 1

    const turno = await prisma.turnoCaja.findFirst({
      where: { sucursalId, abierto: true },
      include: {
        Usuario: { select: { id: true, nombre: true } },
        Sucursal: { select: { id: true, nombre: true } }
      }
    })

    if (!turno) {
      return res.status(404).json({ error: 'No hay turno abierto', codigo: 'SIN_TURNO' })
    }

    const [movimientos, ventasAgg] = await Promise.all([
      prisma.movimientoCaja.findMany({ where: { turnoId: turno.id } }),
      prisma.venta.aggregate({
        where: { turnoId: turno.id, estado: 'COMPLETADA' },
        _count: { id: true }
      })
    ])

    // Desglose neto por método, derivado del ledger de caja.
    // VENTA suma, DEVOLUCION resta y MIXTO ya viene separado por método.
    const { totalEfectivo, totalTarjeta, totalTransferencia, totalGeneral } = calcularTotalesPorMetodoDesdeMovimientos(movimientos)
    const numVentas = ventasAgg._count.id || 0

    // Efectivo esperado = exactamente lo que calculará el cierre.
    const efectivoEsperado = calcularEfectivoEnCaja(movimientos)

    res.json({
      success: true,
      data: {
        turno: {
          id: turno.id,
          montoInicial: parseFloat(turno.montoInicial),
          abiertaEn: turno.abiertaEn,
          Usuario: turno.Usuario,
          Sucursal: turno.Sucursal
        },
        totales: {
          totalEfectivo,
          totalTarjeta,
          totalTransferencia,
          totalGeneral,
          numVentas,
          efectivoEsperado
        }
      }
    })
  } catch (err) {
    console.error('❌ Error obteniendo resumen:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /turnos-caja/abrir  —  CON TRANSACCIÓN ATÓMICA
// ════════════════════════════════════════════════════════════════════

const abrirTurno = async (req, res) => {
  try {
    const { montoInicial, sucursalId: sucursalIdBody } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(sucursalIdBody) || 1
    const empresaId = getEmpresaId(req)

    if (montoInicial === undefined || montoInicial < 0) {
      return res.status(400).json({ error: 'Monto inicial requerido y debe ser >= 0' })
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const turnoExistente = await tx.turnoCaja.findFirst({
        where: { sucursalId, abierto: true }
      })
      if (turnoExistente) {
        throw { status: 409, error: 'Ya hay un turno abierto en esta sucursal', turnoId: turnoExistente.id }
      }

      const turno = await tx.turnoCaja.create({
        data: { empresaId, sucursalId, usuarioId, montoInicial: parseFloat(montoInicial), abierto: true },
        include: {
          Usuario: { select: { id: true, nombre: true } },
          Sucursal: { select: { id: true, nombre: true } }
        }
      })

      await tx.movimientoCaja.create({
        data: { empresaId, turnoId: turno.id, tipo: 'APERTURA', monto: parseFloat(montoInicial) }
      })

      await tx.auditoria.create({
        data: {
          empresaId,
          usuarioId, sucursalId, accion: 'ABRIR_TURNO', modulo: 'turnos-caja',
          referencia: `Turno ${turno.id} abierto con $${montoInicial}`
        }
      })

      return turno
    })

    console.log(`✅ Turno ${resultado.id} abierto por usuario ${usuarioId}`)
    res.status(201).json({ success: true, data: resultado })
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ error: err.error, turnoId: err.turnoId })
    }
    console.error('❌ Error abriendo turno:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /turnos-caja/cerrar  —  CON TRANSACCIÓN ATÓMICA
// ════════════════════════════════════════════════════════════════════

const cerrarTurno = async (req, res) => {
  try {
    const { montoFinalDeclarado, notasCierre } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.body.sucursalId) || 1
    const empresaId = getEmpresaId(req)

    if (montoFinalDeclarado === undefined || montoFinalDeclarado < 0) {
      return res.status(400).json({ error: 'Monto final declarado requerido' })
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const turno = await tx.turnoCaja.findFirst({
        where: { sucursalId, abierto: true }
      })
      if (!turno) {
        throw { status: 404, error: 'No hay turno abierto', codigo: 'SIN_TURNO' }
      }

      // Ledger del turno (el CIERRE aún no existe → no se incluye).
      const movimientos = await tx.movimientoCaja.findMany({
        where: { turnoId: turno.id }
      })

      const montoCalculado = calcularEfectivoEnCaja(movimientos)
      const diferencia = parseFloat((parseFloat(montoFinalDeclarado) - montoCalculado).toFixed(2))

      const turnoCerrado = await tx.turnoCaja.update({
        where: { id: turno.id },
        data: {
          abierto:              false,
          montoFinalDeclarado:  parseFloat(montoFinalDeclarado),
          montoCalculado,
          diferencia,
          notasCierre:          notasCierre || null,
          cerradaEn:            new Date()
        },
        include: {
          Usuario: { select: { id: true, nombre: true } },
          Sucursal: { select: { id: true, nombre: true } }
        }
      })

      await tx.movimientoCaja.create({
        data: { empresaId, turnoId: turno.id, tipo: 'CIERRE', monto: parseFloat(montoFinalDeclarado) }
      })

      await tx.auditoria.create({
        data: {
          empresaId,
          usuarioId, sucursalId, accion: 'CERRAR_TURNO', modulo: 'turnos-caja',
          referencia: `Turno ${turno.id} cerrado. Calc: $${montoCalculado} Decl: $${montoFinalDeclarado} Dif: $${diferencia}`
        }
      })

      return turnoCerrado
    })

    console.log(`✅ Turno ${resultado.id} cerrado. Diferencia: $${resultado.diferencia}`)
    res.json({ success: true, data: resultado })
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.error, codigo: err.codigo })
    }
    console.error('❌ Error cerrando turno:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /turnos-caja/historial
//  Lista de turnos cerrados con paginación
// ════════════════════════════════════════════════════════════════════

const obtenerHistorial = async (req, res) => {
  try {
    const { sucursalId: sucursalIdToken, rol } = req.usuario
    const {
      fecha,
      usuarioId,
      page = '1',
      limit = '20'
    } = req.query

    const pageNum   = Math.max(1, parseInt(page))
    const limitNum  = Math.min(100, Math.max(1, parseInt(limit)))
    const skip      = (pageNum - 1) * limitNum

    const where = { abierto: false }

    if (rol !== 'SUPERADMIN') {
      where.sucursalId = sucursalIdToken || 1
    }

    if (fecha) {
      const fechaDate = new Date(fecha)
      const fechaInicio = new Date(fechaDate.getFullYear(), fechaDate.getMonth(), fechaDate.getDate())
      const fechaFin = new Date(fechaDate.getFullYear(), fechaDate.getMonth(), fechaDate.getDate() + 1)
      where.cerradaEn = { gte: fechaInicio, lt: fechaFin }
    }

    if (usuarioId) {
      where.usuarioId = parseInt(usuarioId)
    }

    const [turnos, total] = await Promise.all([
      prisma.turnoCaja.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { cerradaEn: 'desc' },
        include: {
          Usuario:   { select: { id: true, nombre: true } },
          Sucursal:  { select: { id: true, nombre: true } }
        }
      }),
      prisma.turnoCaja.count({ where })
    ])

    // Query 3: totales netos por método de pago para cada turno desde MovimientoCaja.
    // Incluye DEVOLUCION con monto negativo para reflejar cancelaciones/reembolsos.
    const turnoIds = turnos.map(t => t.id)
    const movimientosPorTurno = turnoIds.length === 0 ? [] : await prisma.movimientoCaja.groupBy({
      by: ['turnoId', 'metodoPago'],
      where: {
        turnoId: { in: turnoIds },
        tipo: { in: ['VENTA', 'DEVOLUCION'] },
        metodoPago: { in: ['DEBITO', 'CREDITO', 'TRANSFERENCIA'] }
      },
      _sum: { monto: true }
    })

    const totalesPorTurno = {}
    for (const m of movimientosPorTurno) {
      if (!totalesPorTurno[m.turnoId]) {
        totalesPorTurno[m.turnoId] = { totalTarjeta: 0, totalTransferencia: 0 }
      }
      if (m.metodoPago === 'DEBITO' || m.metodoPago === 'CREDITO') {
        totalesPorTurno[m.turnoId].totalTarjeta += parseFloat(m._sum.monto || 0)
      } else if (m.metodoPago === 'TRANSFERENCIA') {
        totalesPorTurno[m.turnoId].totalTransferencia += parseFloat(m._sum.monto || 0)
      }
    }

    for (const totales of Object.values(totalesPorTurno)) {
      totales.totalTarjeta = parseFloat(totales.totalTarjeta.toFixed(2))
      totales.totalTransferencia = parseFloat(totales.totalTransferencia.toFixed(2))
    }

    res.json({
      success: true,
      data: {
        turnos: turnos.map(t => ({
          id:                     t.id,
          abiertaEn:              t.abiertaEn,
          cerradaEn:              t.cerradaEn,
          montoInicial:           parseFloat(t.montoInicial),
          montoFinalDeclarado:    parseFloat(t.montoFinalDeclarado),
          montoCalculado:         parseFloat(t.montoCalculado),
          diferencia:             parseFloat(t.diferencia),
          totalTarjeta:           totalesPorTurno[t.id]?.totalTarjeta || 0,
          totalTransferencia:     totalesPorTurno[t.id]?.totalTransferencia || 0,
          notasCierre:            t.notasCierre,
          Usuario:                t.Usuario,
          Sucursal:               t.Sucursal
        })),
        pagination: {
          total:      total,
          page:       pageNum,
          limit:      limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    })
  } catch (err) {
    console.error('❌ Error obteniendo historial:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /turnos-caja/resumen-contable
//  Agregación mensual/trimestral para el contador — solo TurnoCaja + Venta agrupada
// ════════════════════════════════════════════════════════════════════

const obtenerResumenContable = async (req, res) => {
  try {
    const { sucursalId: sucursalIdToken, rol } = req.usuario
    const { fechaDesde, fechaHasta, sucursalId } = req.query

    if (!fechaDesde || !fechaHasta) {
      return res.status(400).json({ error: 'fechaDesde y fechaHasta son requeridos' })
    }

    const desde = new Date(fechaDesde + 'T00:00:00.000Z')
    const hasta = new Date(fechaHasta + 'T23:59:59.999Z')

    const whereSucursal = (rol === 'SUPERADMIN' && sucursalId)
      ? parseInt(sucursalId)
      : (sucursalIdToken || 1)

    const [totales, resumenTurnos] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          COUNT(DISTINCT v.id)::integer AS "totalVentas",
          COALESCE(SUM(v.total) FILTER (WHERE v."metodoPago" = 'EFECTIVO'), 0)::numeric AS "totalEfectivo",
          COALESCE(SUM(v.total) FILTER (WHERE v."metodoPago" IN ('DEBITO','CREDITO')), 0)::numeric AS "totalTarjeta",
          COALESCE(SUM(v.total) FILTER (WHERE v."metodoPago" = 'TRANSFERENCIA'), 0)::numeric AS "totalTransferencia",
          COALESCE(SUM(v.total), 0)::numeric AS "totalGeneral",
          COUNT(DISTINCT v."turnoId")::integer AS "totalTurnos"
        FROM "Venta" v
        JOIN "TurnoCaja" tc ON v."turnoId" = tc.id
        WHERE v.estado = 'COMPLETADA'
          AND v."creadaEn" >= ${desde}
          AND v."creadaEn" <= ${hasta}
          AND tc.abierto = false
          AND v."sucursalId" = ${whereSucursal}
      `,
      prisma.turnoCaja.groupBy({
        by: ['sucursalId'],
        where: {
          abierto: false,
          cerradaEn: { gte: desde, lte: hasta },
          sucursalId: whereSucursal
        },
        _count: { id: true },
        _sum: {
          montoInicial:        true,
          montoFinalDeclarado: true,
          montoCalculado:      true,
          diferencia:          true
        }
      })
    ])

    const row = Array.isArray(totales) ? totales[0] : totales

    const sucursales = await prisma.sucursal.findMany({
      where: whereSucursal !== 1 && rol === 'SUPERADMIN' ? {} : { id: whereSucursal },
      select: { id: true, nombre: true }
    })

    res.json({
      success: true,
      data: {
        periodo: { desde: fechaDesde, hasta: fechaHasta },
        totales: {
          totalVentas:       parseInt(row.totalVentas) || 0,
          totalEfectivo:     parseFloat(row.totalEfectivo) || 0,
          totalTarjeta:      parseFloat(row.totalTarjeta) || 0,
          totalTransferencia:parseFloat(row.totalTransferencia) || 0,
          totalGeneral:      parseFloat(row.totalGeneral) || 0,
          totalTurnos:       parseInt(row.totalTurnos) || 0
        },
        resumenTurnos: resumenTurnos.map(t => ({
          sucursalId:     t.sucursalId,
          nombreSucursal: sucursales.find(s => s.id === t.sucursalId)?.nombre || '—',
          numCortes:      t._count.id,
          totalInicial:   parseFloat(t._sum.montoInicial) || 0,
          totalDeclarado: parseFloat(t._sum.montoFinalDeclarado) || 0,
          totalCalculado: parseFloat(t._sum.montoCalculado) || 0,
          totalDiferencia:parseFloat(t._sum.diferencia) || 0
        })),
        sucursales
      }
    })
  } catch (err) {
    console.error('❌ Error en resumen contable:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = {
  obtenerActivo,
  obtenerResumen,
  abrirTurno,
  cerrarTurno,
  obtenerHistorial,
  obtenerResumenContable
}
