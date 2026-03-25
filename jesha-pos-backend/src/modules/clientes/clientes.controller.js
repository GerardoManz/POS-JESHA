// ═══════════════════════════════════════════════════════════════════
// CLIENTES.CONTROLLER.JS
// Actualizado: incluye campos restaurados activo, apodo,
//              limiteCredito, razonSocial, usoCfdi
// ═══════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// Campos que existen en BD — usado en todos los select
const CLIENTE_SELECT = {
  id: true,
  nombre: true,
  apodo: true,
  rfc: true,
  telefono: true,
  email: true,
  tipo: true,
  razonSocial: true,
  codigoPostalFiscal: true,
  regimenFiscal: true,
  usoCfdi: true,
  limiteCredito: true,
  saldoPendiente: true,      
  totalCreditoUsado: true,   
  activo: true,
  notas: true,
  creadoEn: true
}

async function registrarAudit(solicitante, accion, referencia, ip) {
  try {
    const data = {
      usuario: { connect: { id: solicitante.id } },
      accion,
      modulo: 'clientes',
      referencia,
      ip
    }
    if (solicitante.sucursalId) {
      data.sucursal = { connect: { id: solicitante.sucursalId } }
    }
    await prisma.auditoria.create({ data })
  } catch (e) {
    console.error('Audit error:', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET /clientes
// ═══════════════════════════════════════════════════════════════════

const listar = async (req, res) => {
  try {
    const { tipo, activo, buscar } = req.query
    const where = {}

    if (tipo)              where.tipo   = tipo
    if (activo !== undefined) where.activo = activo === 'true'
    if (buscar) {
      where.OR = [
        { nombre:   { contains: buscar, mode: 'insensitive' } },
        { apodo:    { contains: buscar, mode: 'insensitive' } },
        { rfc:      { contains: buscar, mode: 'insensitive' } },
        { telefono: { contains: buscar, mode: 'insensitive' } },
        { email:    { contains: buscar, mode: 'insensitive' } }
      ]
    }

    const clientes = await prisma.cliente.findMany({
      where,
      select: CLIENTE_SELECT,
      orderBy: { creadoEn: 'desc' }
    })

    res.json(clientes)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al obtener clientes' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET /clientes/:id
// ═══════════════════════════════════════════════════════════════════

const obtener = async (req, res) => {
  try {
    const { id } = req.params
    const cliente = await prisma.cliente.findUnique({
      where: { id: parseInt(id) },
      select: CLIENTE_SELECT
    })

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' })
    }

    res.json(cliente)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al obtener cliente' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /clientes
// ═══════════════════════════════════════════════════════════════════

const crear = async (req, res) => {
  try {
    const {
      nombre, apodo, tipo, telefono, email, rfc,
      razonSocial, codigoPostalFiscal, regimenFiscal, usoCfdi,
      limiteCredito, notas
    } = req.body
    const solicitante = req.usuario

    if (!nombre || !tipo) {
      return res.status(400).json({ error: 'Nombre y tipo son requeridos' })
    }

    if (tipo === 'FISCAL' && !razonSocial) {
      return res.status(400).json({ error: 'Razón social requerida para clientes FISCAL' })
    }

    if (rfc) {
      const existe = await prisma.cliente.findUnique({ where: { rfc } })
      if (existe) return res.status(409).json({ error: 'El RFC ya está registrado' })
    }

    const cliente = await prisma.cliente.create({
      data: {
        nombre,
        apodo:             apodo             || null,
        tipo,
        telefono:          telefono          || null,
        email:             email             || null,
        rfc:               rfc               || null,
        razonSocial:       razonSocial       || null,
        codigoPostalFiscal: codigoPostalFiscal || null,
        regimenFiscal:     regimenFiscal     || null,
        usoCfdi:           usoCfdi           || null,
        limiteCredito:     limiteCredito ? parseFloat(limiteCredito) : 0,
        activo:            true,
        notas:             notas             || null
      },
      select: CLIENTE_SELECT
    })

    await registrarAudit(solicitante, 'CREAR_CLIENTE', `Creó cliente ${cliente.nombre} (${tipo})`, req.ip)

    res.status(201).json(cliente)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al crear cliente' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// PUT /clientes/:id
// ═══════════════════════════════════════════════════════════════════

const editar = async (req, res) => {
  try {
    const { id } = req.params
    const {
      nombre, apodo, tipo, telefono, email, rfc,
      razonSocial, codigoPostalFiscal, regimenFiscal, usoCfdi,
      limiteCredito, notas
    } = req.body
    const solicitante = req.usuario

    const cliente = await prisma.cliente.findUnique({ where: { id: parseInt(id) } })
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' })

    // RFC único solo si cambió
    if (rfc && rfc !== cliente.rfc) {
      const existe = await prisma.cliente.findUnique({ where: { rfc } })
      if (existe) return res.status(409).json({ error: 'El RFC ya está registrado' })
    }

    const clienteActualizado = await prisma.cliente.update({
      where: { id: parseInt(id) },
      data: {
        nombre:            nombre            !== undefined ? nombre                        : cliente.nombre,
        apodo:             apodo             !== undefined ? apodo                         : cliente.apodo,
        tipo:              tipo              !== undefined ? tipo                          : cliente.tipo,
        telefono:          telefono          !== undefined ? telefono                      : cliente.telefono,
        email:             email             !== undefined ? email                         : cliente.email,
        rfc:               rfc               !== undefined ? rfc                           : cliente.rfc,
        razonSocial:       razonSocial       !== undefined ? razonSocial                  : cliente.razonSocial,
        codigoPostalFiscal: codigoPostalFiscal !== undefined ? codigoPostalFiscal          : cliente.codigoPostalFiscal,
        regimenFiscal:     regimenFiscal     !== undefined ? regimenFiscal                : cliente.regimenFiscal,
        usoCfdi:           usoCfdi           !== undefined ? usoCfdi                      : cliente.usoCfdi,
        limiteCredito:     limiteCredito     !== undefined ? parseFloat(limiteCredito)    : cliente.limiteCredito,
        notas:             notas             !== undefined ? notas                         : cliente.notas
      },
      select: CLIENTE_SELECT
    })

    await registrarAudit(solicitante, 'EDITAR_CLIENTE', `Editó cliente ${cliente.nombre}`, req.ip)

    res.json(clienteActualizado)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al editar cliente' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// PATCH /clientes/:id/estado
// ═══════════════════════════════════════════════════════════════════

const cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params
    const { activo } = req.body
    const solicitante = req.usuario

    if (typeof activo !== 'boolean') {
      return res.status(400).json({ error: 'El campo activo debe ser booleano' })
    }

    const cliente = await prisma.cliente.findUnique({ where: { id: parseInt(id) } })
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' })

    const clienteActualizado = await prisma.cliente.update({
      where: { id: parseInt(id) },
      data: { activo },
      select: CLIENTE_SELECT
    })

    const accion = activo ? 'ACTIVAR_CLIENTE' : 'DESACTIVAR_CLIENTE'
    await registrarAudit(solicitante, accion, `${activo ? 'Activó' : 'Desactivó'} cliente ${cliente.nombre}`, req.ip)

    res.json(clienteActualizado)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al cambiar estado' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET /clientes/:id/ventas
// ═══════════════════════════════════════════════════════════════════

const obtenerVentas = async (req, res) => {
  try {
    const { id } = req.params
    const ventas = await prisma.venta.findMany({
      where: { clienteId: parseInt(id) },
      select: { id: true, folio: true, total: true, metodoPago: true, estado: true, creadaEn: true },
      orderBy: { creadaEn: 'desc' },
      take: 50
    })
    res.json(ventas)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al obtener ventas' })
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET /clientes/:id/abonos
// Abonos de bitácora asociados al cliente
// ═══════════════════════════════════════════════════════════════════

const obtenerAbonos = async (req, res) => {
  try {
    const { id } = req.params
    const abonos = await prisma.abonoBitacora.findMany({
      where: { bitacora: { clienteId: parseInt(id) } },
      select: {
        id:         true,
        monto:      true,
        metodoPago: true,
        notas:      true,
        creadoEn:   true,
        bitacora: { select: { folio: true, titulo: true } },
        usuario:  { select: { nombre: true } }
      },
      orderBy: { creadoEn: 'desc' },
      take: 100
    })
    res.json(abonos)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al obtener abonos' })
  }
}

const abonarCredito = async (req, res) => {
  try {
    const { id }    = req.params
    const { monto } = req.body
 
    if (!monto || parseFloat(monto) <= 0)
      return res.status(400).json({ error: 'Monto inválido' })
 
    const cliente = await prisma.cliente.findUnique({ where: { id: parseInt(id) } })
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' })
    if (cliente.tipo !== 'REGISTRADO')
      return res.status(400).json({ error: 'Cliente sin crédito habilitado' })
 
    const montoAbono  = parseFloat(parseFloat(monto).toFixed(2))
    const saldoActual = parseFloat(cliente.saldoPendiente)
    const nuevoSaldo  = parseFloat(Math.max(0, saldoActual - montoAbono).toFixed(2))
 
    const actualizado = await prisma.cliente.update({
      where: { id: parseInt(id) },
      data:  { saldoPendiente: nuevoSaldo }
    })
 
    res.json({
      success: true,
      mensaje: `Abono de $${montoAbono.toFixed(2)} aplicado al crédito`,
      saldoAnterior: saldoActual,
      saldoNuevo:    nuevoSaldo,
      cliente:       { id: actualizado.id, nombre: actualizado.nombre, saldoPendiente: nuevoSaldo }
    })
  } catch (err) {
    console.error('❌ Error en abonarCredito:', err)
    res.status(500).json({ error: 'Error al procesar abono: ' + err.message })
  }
}

module.exports = { listar, obtener, crear, editar, cambiarEstado, obtenerVentas, obtenerAbonos, abonarCredito }