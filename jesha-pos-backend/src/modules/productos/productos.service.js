// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.SERVICE.JS
// FIX: PrismaPg adapter
// FIX: codigoInterno incluido en crear() — era NOT NULL en schema
// NOTA: Este service no es usado por el controller actualmente.
//       Está disponible para refactors futuros.
// ═══════════════════════════════════════════════════════════════════

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// ═══════════════════════════════════════════════════════════════════
// AUDITORÍA
// ═══════════════════════════════════════════════════════════════════

async function registrarAudit(usuarioId, sucursalId, accion, referencia, ip) {
  try {
    const data = { accion, modulo: 'productos', referencia, ip }
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

async function listar(filtros = {}) {
  const { categoria, activo, buscar } = filtros
  const where = {}

  if (categoria)          where.categoriaId = parseInt(categoria)
  if (activo !== undefined) where.activo = activo === 'true' || activo === true

  if (buscar) {
    where.OR = [
      { nombre:       { contains: buscar, mode: 'insensitive' } },
      { codigoInterno:{ contains: buscar, mode: 'insensitive' } },
      { codigoBarras: { contains: buscar, mode: 'insensitive' } },
      { descripcion:  { contains: buscar, mode: 'insensitive' } }
    ]
  }

  return await prisma.producto.findMany({
    where,
    select: {
      id: true,
      nombre: true,
      codigoInterno: true,
      codigoBarras: true,
      descripcion: true,
      precioBase: true,
      costo: true,
      categoria: { select: { id: true, nombre: true } },
      activo: true,
      creadoEn: true,
      actualizadoEn: true
    },
    orderBy: { nombre: 'asc' }
  })
}

// ═══════════════════════════════════════════════════════════════════
// OBTENER POR ID
// ═══════════════════════════════════════════════════════════════════

async function obtenerPorId(id) {
  return await prisma.producto.findUnique({
    where: { id: parseInt(id) },
    select: {
      id: true,
      nombre: true,
      codigoInterno: true,
      codigoBarras: true,
      descripcion: true,
      precioBase: true,
      costo: true,
      imagenUrl: true,
      categoria: { select: { id: true, nombre: true } },
      activo: true,
      creadoEn: true,
      actualizadoEn: true
    }
  })
}

// ═══════════════════════════════════════════════════════════════════
// CREAR
// FIX: codigoInterno es NOT NULL UNIQUE en schema — era ignorado antes
// ═══════════════════════════════════════════════════════════════════

async function crear(datos, usuarioId, sucursalId, ip) {
  const { nombre, codigoInterno, codigoBarras, descripcion, precioBase, costo, categoriaId } = datos

  if (!nombre || !codigoInterno || !precioBase || !categoriaId) {
    throw new Error('Nombre, codigoInterno, precio y categoría son requeridos')
  }

  if (parseFloat(precioBase) <= 0) {
    throw new Error('El precio debe ser mayor a 0')
  }

  const categoria = await prisma.categoria.findUnique({ where: { id: parseInt(categoriaId) } })
  if (!categoria) throw new Error('Categoría no encontrada')

  // Validar codigoInterno único
  const existeCodigo = await prisma.producto.findUnique({ where: { codigoInterno } })
  if (existeCodigo) throw new Error('El código interno ya está registrado')

  // Validar codigoBarras único (opcional)
  if (codigoBarras) {
    const existeBarras = await prisma.producto.findUnique({ where: { codigoBarras } })
    if (existeBarras) throw new Error('El código de barras ya está registrado')
  }

  const producto = await prisma.producto.create({
    data: {
      nombre,
      codigoInterno,
      codigoBarras: codigoBarras || null,
      descripcion:  descripcion  || null,
      precioBase:   parseFloat(precioBase),
      costo:        costo ? parseFloat(costo) : null,
      categoriaId:  parseInt(categoriaId),
      activo: true
    },
    select: {
      id: true, nombre: true, codigoInterno: true, codigoBarras: true,
      descripcion: true, precioBase: true, costo: true,
      categoria: { select: { id: true, nombre: true } },
      activo: true, creadoEn: true
    }
  })

  await registrarAudit(usuarioId, sucursalId, 'CREAR_PRODUCTO', `Producto ${nombre}`, ip)
  return producto
}

// ═══════════════════════════════════════════════════════════════════
// EDITAR
// ═══════════════════════════════════════════════════════════════════

async function editar(id, datos, usuarioId, sucursalId, ip) {
  const { nombre, codigoInterno, codigoBarras, descripcion, precioBase, costo, categoriaId } = datos

  const producto = await obtenerPorId(id)
  if (!producto) throw new Error('Producto no encontrado')

  if (codigoInterno && codigoInterno !== producto.codigoInterno) {
    const existe = await prisma.producto.findUnique({ where: { codigoInterno } })
    if (existe) throw new Error('El código interno ya está registrado')
  }

  if (codigoBarras && codigoBarras !== producto.codigoBarras) {
    const existe = await prisma.producto.findUnique({ where: { codigoBarras } })
    if (existe) throw new Error('El código de barras ya está registrado')
  }

  if (categoriaId) {
    const cat = await prisma.categoria.findUnique({ where: { id: parseInt(categoriaId) } })
    if (!cat) throw new Error('Categoría no encontrada')
  }

  const productoActualizado = await prisma.producto.update({
    where: { id: parseInt(id) },
    data: {
      nombre:        nombre        !== undefined ? nombre                : producto.nombre,
      codigoInterno: codigoInterno !== undefined ? codigoInterno         : producto.codigoInterno,
      codigoBarras:  codigoBarras  !== undefined ? codigoBarras          : producto.codigoBarras,
      descripcion:   descripcion   !== undefined ? descripcion           : producto.descripcion,
      precioBase:    precioBase    !== undefined ? parseFloat(precioBase): producto.precioBase,
      costo:         costo         !== undefined ? parseFloat(costo)     : producto.costo,
      categoriaId:   categoriaId   !== undefined ? parseInt(categoriaId) : producto.categoria.id
    },
    select: {
      id: true, nombre: true, codigoInterno: true, codigoBarras: true,
      descripcion: true, precioBase: true, costo: true,
      categoria: { select: { id: true, nombre: true } },
      activo: true, creadoEn: true, actualizadoEn: true
    }
  })

  await registrarAudit(usuarioId, sucursalId, 'EDITAR_PRODUCTO', `Producto ${nombre || producto.nombre}`, ip)
  return productoActualizado
}

// ═══════════════════════════════════════════════════════════════════
// CAMBIAR ESTADO
// ═══════════════════════════════════════════════════════════════════

async function cambiarEstado(id, activo, usuarioId, sucursalId, ip) {
  const producto = await obtenerPorId(id)
  if (!producto) throw new Error('Producto no encontrado')

  const productoActualizado = await prisma.producto.update({
    where: { id: parseInt(id) },
    data: { activo }
  })

  const accion = activo ? 'ACTIVAR_PRODUCTO' : 'DESACTIVAR_PRODUCTO'
  await registrarAudit(usuarioId, sucursalId, accion, `Producto ${producto.nombre}`, ip)
  return productoActualizado
}

module.exports = {
  registrarAudit,
  listar,
  obtenerPorId,
  crear,
  editar,
  cambiarEstado
}