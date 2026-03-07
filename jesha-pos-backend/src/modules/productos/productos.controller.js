// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.CONTROLLER.JS
// FIX: PrismaPg adapter (schema no tiene url en datasource)
// FIX: Variable shadowing en .map() (p => prod)
// ═══════════════════════════════════════════════════════════════════

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// ═══════════════════════════════════════════════════════════════════
// DEPARTAMENTOS
// ═══════════════════════════════════════════════════════════════════

async function listarDepartamentos(req, res) {
  try {
    const departamentos = await prisma.departamento.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    })
    console.log(`✅ Departamentos: ${departamentos.length}`)
    res.json({ success: true, data: departamentos })
  } catch (error) {
    console.error('❌ Error listando departamentos:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ═══════════════════════════════════════════════════════════════════
// CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

async function listarCategorias(req, res) {
  try {
    const categorias = await prisma.categoria.findMany({
      include: { departamento: true },
      orderBy: { nombre: 'asc' }
    })
    console.log(`✅ Categorías: ${categorias.length}`)
    res.json({ success: true, data: categorias })
  } catch (error) {
    console.error('❌ Error listando categorías:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ═══════════════════════════════════════════════════════════════════
// LISTAR
// ═══════════════════════════════════════════════════════════════════

async function listar(req, res) {
  try {
    const productos = await prisma.producto.findMany({
      where: { activo: true },
      include: {
        categoria: { include: { departamento: true } },
        inventarios: { where: { sucursalId: 1 }, take: 1 }
      },
      orderBy: { nombre: 'asc' }
    })

    // FIX: 'prod' en lugar de 'p' para no shadowear nada
    const data = productos.map(prod => ({
      ...prod,
      inventario: prod.inventarios?.length > 0 ? prod.inventarios[0] : null
    }))

    console.log(`✅ Productos: ${data.length}`)
    res.json({ success: true, data })
  } catch (error) {
    console.error('❌ Error listando productos:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ═══════════════════════════════════════════════════════════════════
// OBTENER UNO
// ═══════════════════════════════════════════════════════════════════

async function obtener(req, res) {
  try {
    const { id } = req.params
    const producto = await prisma.producto.findUnique({
      where: { id: parseInt(id) },
      include: {
        categoria: { include: { departamento: true } },
        inventarios: { where: { sucursalId: 1 }, take: 1 }
      }
    })

    if (!producto) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado' })
    }

    res.json({
      success: true,
      data: {
        ...producto,
        inventario: producto.inventarios?.length > 0 ? producto.inventarios[0] : null
      }
    })
  } catch (error) {
    console.error('❌ Error obteniendo producto:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ═══════════════════════════════════════════════════════════════════
// CREAR
// ═══════════════════════════════════════════════════════════════════

async function crear(req, res) {
  try {
    const {
      nombre, codigoInterno, codigoBarras, descripcion,
      costo, precioBase, categoriaId,
      unidadCompra, unidadVenta, factorConversion,
      claveSat, unidadSat
    } = req.body

    if (!nombre || !codigoInterno || !categoriaId || !precioBase) {
      return res.status(400).json({
        success: false,
        error: 'Faltan campos requeridos: nombre, codigoInterno, categoriaId, precioBase'
      })
    }

    const existente = await prisma.producto.findUnique({ where: { codigoInterno } })
    if (existente) {
      return res.status(400).json({ success: false, error: 'El código interno ya existe' })
    }

    const producto = await prisma.producto.create({
      data: {
        nombre,
        codigoInterno,
        codigoBarras:     codigoBarras     || null,
        descripcion:      descripcion      || null,
        costo:            costo            ? parseFloat(costo)            : null,
        costoPromedio:    costo            ? parseFloat(costo)            : null,
        precioBase:       parseFloat(precioBase),
        categoriaId:      parseInt(categoriaId),
        unidadCompra:     unidadCompra     || null,
        unidadVenta:      unidadVenta      || null,
        factorConversion: factorConversion ? parseFloat(factorConversion) : null,
        claveSat:         claveSat         || null,
        unidadSat:        unidadSat        || null,
        activo: true
      },
      include: {
        categoria: { include: { departamento: true } },
        inventarios: { where: { sucursalId: 1 }, take: 1 }
      }
    })

    console.log(`✅ Producto creado: ${nombre}`)
    res.status(201).json({
      success: true,
      data: {
        ...producto,
        inventario: producto.inventarios?.length > 0 ? producto.inventarios[0] : null
      }
    })
  } catch (error) {
    console.error('❌ Error creando producto:', error.message)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ═══════════════════════════════════════════════════════════════════
// EDITAR
// ═══════════════════════════════════════════════════════════════════

async function editar(req, res) {
  try {
    const { id } = req.params
    const {
      nombre, codigoInterno, codigoBarras, descripcion,
      costo, precioBase, categoriaId,
      unidadCompra, unidadVenta, factorConversion,
      claveSat, unidadSat
    } = req.body

    if (!nombre || !codigoInterno || !categoriaId || !precioBase) {
      return res.status(400).json({
        success: false,
        error: 'Faltan campos requeridos: nombre, codigoInterno, categoriaId, precioBase'
      })
    }

    const existente = await prisma.producto.findUnique({ where: { id: parseInt(id) } })
    if (!existente) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado' })
    }

    if (codigoInterno !== existente.codigoInterno) {
      const codigoUsado = await prisma.producto.findUnique({ where: { codigoInterno } })
      if (codigoUsado) {
        return res.status(400).json({ success: false, error: 'El código interno ya existe' })
      }
    }

    const producto = await prisma.producto.update({
      where: { id: parseInt(id) },
      data: {
        nombre,
        codigoInterno,
        codigoBarras:     codigoBarras     || null,
        descripcion:      descripcion      || null,
        costo:            costo            ? parseFloat(costo)            : null,
        precioBase:       parseFloat(precioBase),
        categoriaId:      parseInt(categoriaId),
        unidadCompra:     unidadCompra     || null,
        unidadVenta:      unidadVenta      || null,
        factorConversion: factorConversion ? parseFloat(factorConversion) : null,
        claveSat:         claveSat         || null,
        unidadSat:        unidadSat        || null
      },
      include: {
        categoria: { include: { departamento: true } },
        inventarios: { where: { sucursalId: 1 }, take: 1 }
      }
    })

    console.log(`✅ Producto actualizado: ${nombre}`)
    res.json({
      success: true,
      data: {
        ...producto,
        inventario: producto.inventarios?.length > 0 ? producto.inventarios[0] : null
      }
    })
  } catch (error) {
    console.error('❌ Error editando producto:', error.message)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ═══════════════════════════════════════════════════════════════════
// CAMBIAR ESTADO
// ═══════════════════════════════════════════════════════════════════

async function cambiarEstado(req, res) {
  try {
    const { id } = req.params
    const { activo } = req.body

    if (typeof activo !== 'boolean') {
      return res.status(400).json({ success: false, error: 'El campo activo debe ser booleano' })
    }

    const producto = await prisma.producto.update({
      where: { id: parseInt(id) },
      data: { activo }
    })

    console.log(`✅ Estado actualizado: ${producto.nombre}`)
    res.json({ success: true, data: producto })
  } catch (error) {
    console.error('❌ Error cambiando estado:', error.message)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ═══════════════════════════════════════════════════════════════════
// ACTUALIZAR IMAGEN (llamado desde routes directamente, no HTTP)
// ═══════════════════════════════════════════════════════════════════

async function actualizarImagen(id, urlImagen) {
  const producto = await prisma.producto.update({
    where: { id: parseInt(id) },
    data: { imagenUrl: urlImagen },
    include: {
      categoria: { include: { departamento: true } },
      inventarios: { where: { sucursalId: 1 }, take: 1 }
    }
  })
  console.log(`✅ Imagen actualizada: ${producto.nombre}`)
  return {
    ...producto,
    inventario: producto.inventarios?.length > 0 ? producto.inventarios[0] : null
  }
}

module.exports = {
  listarDepartamentos,
  listarCategorias,
  listar,
  obtener,
  crear,
  editar,
  cambiarEstado,
  actualizarImagen
}