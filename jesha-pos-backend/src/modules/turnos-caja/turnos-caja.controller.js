const prisma = require('../../lib/prisma')

// GET /turnos-caja/activo
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

// POST /turnos-caja/abrir
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

    // Verificar que no haya turno abierto
    const turnoExistente = await prisma.turnoCaja.findFirst({
      where: { sucursalId, abierto: true }
    })

    if (turnoExistente) {
      return res.status(409).json({ 
        error: 'Ya hay un turno abierto en esta sucursal',
        turnoId: turnoExistente.id
      })
    }

    const turno = await prisma.turnoCaja.create({
      data: {
        sucursalId,
        usuarioId,
        montoInicial: parseFloat(montoInicial),
        abierto: true
      },
      include: {
        usuario: { select: { id: true, nombre: true } },
        sucursal: { select: { id: true, nombre: true } }
      }
    })

    // Registrar movimiento apertura
    await prisma.movimientoCaja.create({
      data: {
        turnoId: turno.id,
        tipo: 'APERTURA',
        monto: parseFloat(montoInicial)
      }
    })

    await prisma.auditoria.create({
      data: {
        usuarioId,
        sucursalId,
        accion: 'ABRIR_TURNO',
        modulo: 'turnos-caja',
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

// POST /turnos-caja/cerrar
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

    // Calcular monto real sumando movimientos
    const movimientos = await prisma.movimientoCaja.findMany({
      where: { turnoId: turno.id }
    })

    const montoCalculado = movimientos.reduce((sum, m) => {
      if (m.tipo === 'APERTURA' || m.tipo === 'VENTA') {
        return sum + parseFloat(m.monto)
      }
      if (m.tipo === 'DEVOLUCION' || m.tipo === 'AJUSTE') {
        return sum - parseFloat(m.monto)
      }
      return sum
    }, 0)

    const diferencia = parseFloat(montoFinalDeclarado) - montoCalculado

    const turnoCerrado = await prisma.turnoCaja.update({
      where: { id: turno.id },
      data: {
        abierto: false,
        montoFinalDeclarado: parseFloat(montoFinalDeclarado),
        montoCalculado,
        diferencia,
        cerradaEn: new Date()
      },
      include: {
        usuario: { select: { id: true, nombre: true } },
        sucursal: { select: { id: true, nombre: true } }
      }
    })

    // Registrar movimiento cierre
    await prisma.movimientoCaja.create({
      data: {
        turnoId: turno.id,
        tipo: 'CIERRE',
        monto: parseFloat(montoFinalDeclarado)
      }
    })

    await prisma.auditoria.create({
      data: {
        usuarioId,
        sucursalId,
        accion: 'CERRAR_TURNO',
        modulo: 'turnos-caja',
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