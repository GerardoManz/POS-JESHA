const prisma = require('../../lib/prisma')

// ════════════════════════════════════════════════════════════════════
//  GET /turnos-caja/activo
// ════════════════════════════════════════════════════════════════════

const obtenerActivo = async (req, res) => {
  try {
    const { sucursalId } = req.usuario
    if (!sucursalId) {
      return res.status(400).json({ error: 'Usuario sin sucursal asignada' })
    }

    const turno = await prisma.turnoCaja.findFirst({
      where: { sucursalId, abierto: true },
      include: {
        usuario: { select: { id: true, nombre: true } },
        sucursal: { select: { id: true, nombre: true } }
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
//  POST /turnos-caja/abrir
// ════════════════════════════════════════════════════════════════════

const abrirTurno = async (req, res) => {
  try {
    const { montoInicial } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    if (!sucursalId) {
      return res.status(400).json({ error: 'Usuario sin sucursal asignada' })
    }
    if (montoInicial === undefined || montoInicial < 0) {
      return res.status(400).json({ error: 'Monto inicial requerido y debe ser >= 0' })
    }

    const turnoExistente = await prisma.turnoCaja.findFirst({
      where: { sucursalId, abierto: true }
    })
    if (turnoExistente) {
      return res.status(409).json({ error: 'Ya hay un turno abierto en esta sucursal', turnoId: turnoExistente.id })
    }

    const turno = await prisma.turnoCaja.create({
      data: { sucursalId, usuarioId, montoInicial: parseFloat(montoInicial), abierto: true },
      include: {
        usuario: { select: { id: true, nombre: true } },
        sucursal: { select: { id: true, nombre: true } }
      }
    })

    await prisma.movimientoCaja.create({
      data: { turnoId: turno.id, tipo: 'APERTURA', monto: parseFloat(montoInicial) }
    })

    await prisma.auditoria.create({
      data: {
        usuarioId, sucursalId, accion: 'ABRIR_TURNO', modulo: 'turnos-caja',
        referencia: `Turno ${turno.id} abierto con $${montoInicial}`
      }
    })

    console.log(`✅ Turno ${turno.id} abierto por usuario ${usuarioId}`)
    res.status(201).json({ success: true, data: turno })
  } catch (err) {
    console.error('❌ Error abriendo turno:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /turnos-caja/cerrar
// ════════════════════════════════════════════════════════════════════

const cerrarTurno = async (req, res) => {
  try {
    const { montoFinalDeclarado } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    if (!sucursalId) {
      return res.status(400).json({ error: 'Usuario sin sucursal asignada' })
    }
    if (montoFinalDeclarado === undefined || montoFinalDeclarado < 0) {
      return res.status(400).json({ error: 'Monto final declarado requerido' })
    }

    const turno = await prisma.turnoCaja.findFirst({
      where: { sucursalId, abierto: true }
    })
    if (!turno) {
      return res.status(404).json({ error: 'No hay turno abierto', codigo: 'SIN_TURNO' })
    }

    // ── Calcular efectivo esperado en caja ──────────────────────────
    // Solo suma: apertura + ventas en EFECTIVO - devoluciones en efectivo
    // Las ventas con tarjeta/transferencia NO entran en el conteo físico de caja
    const movimientos = await prisma.movimientoCaja.findMany({
      where: { turnoId: turno.id },
      include: { referencia: false }  // solo campos base
    })

    // Obtener ventas del turno para saber el método de pago de cada movimiento
    const ventasTurno = await prisma.venta.findMany({
      where: { turnoId: turno.id, estado: 'COMPLETADA' },
      select: { folio: true, metodoPago: true, total: true }
    })
    const foliosEfectivo = new Set(
      ventasTurno.filter(v => v.metodoPago === 'EFECTIVO').map(v => v.folio)
    )

    const montoCalculado = movimientos.reduce((sum, m) => {
      if (m.tipo === 'APERTURA') {
        // El monto inicial siempre cuenta como efectivo físico
        return sum + parseFloat(m.monto)
      }
      if (m.tipo === 'VENTA') {
        // Solo sumar si la venta fue en efectivo
        if (foliosEfectivo.has(m.referencia)) {
          return sum + parseFloat(m.monto)
        }
        return sum  // tarjeta/transferencia no afecta el efectivo físico
      }
      if (m.tipo === 'DEVOLUCION' && foliosEfectivo.has(m.referencia)) {
        // Solo restar devoluciones de ventas que fueron en efectivo
        return sum - parseFloat(m.monto)
      }
      if (m.tipo === 'AJUSTE') {
        // Ajustes manuales siempre afectan el efectivo
        return sum - parseFloat(m.monto)
      }
      return sum
    }, 0)

    const diferencia = parseFloat(montoFinalDeclarado) - montoCalculado

    const turnoCerrado = await prisma.turnoCaja.update({
      where: { id: turno.id },
      data: {
        abierto:              false,
        montoFinalDeclarado:  parseFloat(montoFinalDeclarado),
        montoCalculado,
        diferencia,
        cerradaEn:            new Date()
      },
      include: {
        usuario: { select: { id: true, nombre: true } },
        sucursal: { select: { id: true, nombre: true } }
      }
    })

    await prisma.movimientoCaja.create({
      data: { turnoId: turno.id, tipo: 'CIERRE', monto: parseFloat(montoFinalDeclarado) }
    })

    await prisma.auditoria.create({
      data: {
        usuarioId, sucursalId, accion: 'CERRAR_TURNO', modulo: 'turnos-caja',
        referencia: `Turno ${turno.id} cerrado. Calculado: $${montoCalculado} Declarado: $${montoFinalDeclarado} Diferencia: $${diferencia}`
      }
    })

    console.log(`✅ Turno ${turno.id} cerrado. Diferencia: $${diferencia}`)
    res.json({ success: true, data: turnoCerrado })
  } catch (err) {
    console.error('❌ Error cerrando turno:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { obtenerActivo, abrirTurno, cerrarTurno }