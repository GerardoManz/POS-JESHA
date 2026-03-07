// ═══════════════════════════════════════════════════════════════════
// CLIENTES.SERVICE.JS
// CORREGIDO: sincronizado con schema actual (migración 20260306)
// Campos eliminados: activo, limiteCredito, saldoCredito,
//                   razonSocial, usoCfdi, apodo, actualizadoEn
// ═══════════════════════════════════════════════════════════════════

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// ── Campos válidos actuales en modelo Cliente ──
// id, nombre, rfc, telefono, email,
// codigoPostalFiscal, regimenFiscal, tipo, notas, creadoEn

async function registrarAudit(usuarioId, sucursalId, accion, modulo, referencia, ip) {
  try {
    const data = { accion, modulo, referencia, ip }
    if (usuarioId)  data.usuarioId  = usuarioId
    if (sucursalId) data.sucursalId = sucursalId
    await prisma.auditoria.create({ data })
  } catch (e) {
    console.error('❌ Error en auditoría:', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════
// LISTAR
// ═══════════════════════════════════════════════════════════════════

async function listarClientes(filtros = {}) {
  const { tipo, buscar } = filtros  // ← 'activo' eliminado
  const where = {}

  if (tipo) where.tipo = tipo
  if (buscar) {
    where.OR = [
      { nombre:   { contains: buscar, mode: 'insensitive' } },
      { rfc:      { contains: buscar, mode: 'insensitive' } },
      { telefono: { contains: buscar, mode: 'insensitive' } },
      { email:    { contains: buscar, mode: 'insensitive' } }
    ]
  }

  return await prisma.cliente.findMany({
    where,
    select: {
      id:                 true,
      nombre:             true,
      rfc:                true,
      telefono:           true,
      email:              true,
      tipo:               true,
      codigoPostalFiscal: true,
      regimenFiscal:      true,
      notas:              true,
      creadoEn:           true
    },
    orderBy: { creadoEn: 'desc' }
  })
}

// ═══════════════════════════════════════════════════════════════════
// OBTENER POR ID
// ═══════════════════════════════════════════════════════════════════

async function obtenerClientePorId(id) {
  return await prisma.cliente.findUnique({
    where: { id: parseInt(id) },
    select: {
      id:                 true,
      nombre:             true,
      rfc:                true,
      telefono:           true,
      email:              true,
      tipo:               true,
      codigoPostalFiscal: true,
      regimenFiscal:      true,
      notas:              true,
      creadoEn:           true
    }
  })
}

// ═══════════════════════════════════════════════════════════════════
// CREAR
// ═══════════════════════════════════════════════════════════════════

async function crearCliente(datos, usuarioId, sucursalId, ip) {
  const {
    nombre, tipo, telefono, email, rfc,
    codigoPostalFiscal, regimenFiscal, notas
  } = datos

  if (!nombre || !tipo) throw new Error('Nombre y tipo son requeridos')

  if (rfc) {
    const existe = await prisma.cliente.findUnique({ where: { rfc } })
    if (existe) throw new Error('El RFC ya está registrado')
  }

  const cliente = await prisma.cliente.create({
    data: {
      nombre,
      tipo,
      telefono:           telefono           || null,
      email:              email              || null,
      rfc:                rfc                || null,
      codigoPostalFiscal: codigoPostalFiscal || null,
      regimenFiscal:      regimenFiscal      || null,
      notas:              notas              || null
    }
  })

  await registrarAudit(usuarioId, sucursalId, 'CREAR_CLIENTE', 'clientes', `Cliente ${nombre}`, ip)
  return cliente
}

// ═══════════════════════════════════════════════════════════════════
// EDITAR
// ═══════════════════════════════════════════════════════════════════

async function editarCliente(id, datos, usuarioId, sucursalId, ip) {
  const {
    nombre, tipo, telefono, email, rfc,
    codigoPostalFiscal, regimenFiscal, notas
  } = datos

  const cliente = await obtenerClientePorId(id)
  if (!cliente) throw new Error('Cliente no encontrado')

  if (rfc && rfc !== cliente.rfc) {
    const existe = await prisma.cliente.findUnique({ where: { rfc } })
    if (existe) throw new Error('El RFC ya está registrado')
  }

  const clienteActualizado = await prisma.cliente.update({
    where: { id: parseInt(id) },
    data: {
      nombre:             nombre             !== undefined ? nombre             : cliente.nombre,
      tipo:               tipo               !== undefined ? tipo               : cliente.tipo,
      telefono:           telefono           !== undefined ? telefono           : cliente.telefono,
      email:              email              !== undefined ? email              : cliente.email,
      rfc:                rfc                !== undefined ? rfc                : cliente.rfc,
      codigoPostalFiscal: codigoPostalFiscal !== undefined ? codigoPostalFiscal : cliente.codigoPostalFiscal,
      regimenFiscal:      regimenFiscal      !== undefined ? regimenFiscal      : cliente.regimenFiscal,
      notas:              notas              !== undefined ? notas              : cliente.notas
    }
  })

  await registrarAudit(usuarioId, sucursalId, 'EDITAR_CLIENTE', 'clientes', `Cliente ${nombre || cliente.nombre}`, ip)
  return clienteActualizado
}

// ═══════════════════════════════════════════════════════════════════
// VENTAS DEL CLIENTE
// ═══════════════════════════════════════════════════════════════════

async function obtenerVentasCliente(clienteId) {
  return await prisma.venta.findMany({
    where: { clienteId: parseInt(clienteId) },
    select: {
      id:         true,
      folio:      true,
      total:      true,
      metodoPago: true,
      creadaEn:   true
    },
    orderBy: { creadaEn: 'desc' },
    take: 50
  })
}

// ═══════════════════════════════════════════════════════════════════
// ABONOS — tabla eliminada, retorna vacío
// ═══════════════════════════════════════════════════════════════════

async function obtenerAbonosCliente(clienteId) {
  return []
}

module.exports = {
  registrarAudit,
  listarClientes,
  obtenerClientePorId,
  crearCliente,
  editarCliente,
  obtenerVentasCliente,
  obtenerAbonosCliente
}