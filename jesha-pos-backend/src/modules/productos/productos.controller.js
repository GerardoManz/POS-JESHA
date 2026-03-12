// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.CONTROLLER.JS — CORREGIDO
// FIX: Usa instancia centralizada de Prisma (no crea una propia)
// ═══════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

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
// LISTAR TODOS
// ═══════════════════════════════════════════════════════════════════

async function listar(req, res) {
    try {
        console.log('🔍 Iniciando query de productos...')

        const productos = await prisma.producto.findMany({
            where: { activo: true },
            include: {
                categoria: { include: { departamento: true } },
                inventarios: { where: { sucursalId: 1 }, take: 1 }
            },
            orderBy: { nombre: 'asc' }
        })

        const data = productos.map(prod => ({
            ...prod,
            inventario: prod.inventarios?.length > 0 ? prod.inventarios[0] : null
        }))

        console.log(`✅ Productos obtenidos: ${data.length}`)
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
                error: 'Faltan campos requeridos'
            })
        }

        const existente = await prisma.producto.findUnique({ where: { id: parseInt(id) } })
        if (!existente) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado' })
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
// ACTUALIZAR IMAGEN
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

// ═══════════════════════════════════════════════════════════════════
// CATEGORÍAS POR DEPARTAMENTO
// ═══════════════════════════════════════════════════════════════════

async function categoriasPorDepartamento(req, res) {
    try {
        const { departamentoId } = req.params
        const categorias = await prisma.categoria.findMany({
            where: { departamentoId: parseInt(departamentoId) },
            orderBy: { nombre: 'asc' }
        })
        res.json({ success: true, data: categorias })
    } catch (error) {
        console.error('❌ Error categorías por depto:', error.message)
        res.status(500).json({ success: false, error: error.message })
    }
}

// ═══════════════════════════════════════════════════════════════════
// CREAR DEPARTAMENTO (desde formulario de producto)
// ═══════════════════════════════════════════════════════════════════

async function crearDepartamento(req, res) {
    try {
        const { nombre } = req.body
        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ success: false, error: 'Nombre requerido' })
        }

        const existente = await prisma.departamento.findFirst({
            where: { nombre: { equals: nombre.trim().toUpperCase(), mode: 'insensitive' } }
        })
        if (existente) {
            return res.json({ success: true, data: existente, mensaje: 'Ya existía' })
        }

        const depto = await prisma.departamento.create({
            data: { nombre: nombre.trim().toUpperCase(), activo: true }
        })
        console.log(`✅ Departamento creado: ${depto.nombre}`)
        res.status(201).json({ success: true, data: depto })
    } catch (error) {
        console.error('❌ Error creando departamento:', error.message)
        res.status(400).json({ success: false, error: error.message })
    }
}

// ═══════════════════════════════════════════════════════════════════
// CREAR CATEGORÍA (desde formulario de producto)
// ═══════════════════════════════════════════════════════════════════

async function crearCategoria(req, res) {
    try {
        const { nombre, departamentoId } = req.body
        if (!nombre || !departamentoId) {
            return res.status(400).json({ success: false, error: 'Nombre y departamentoId requeridos' })
        }

        const existente = await prisma.categoria.findFirst({
            where: {
                departamentoId: parseInt(departamentoId),
                nombre: { equals: nombre.trim(), mode: 'insensitive' }
            }
        })
        if (existente) {
            return res.json({ success: true, data: existente, mensaje: 'Ya existía' })
        }

        const cat = await prisma.categoria.create({
            data: {
                nombre: nombre.trim(),
                departamentoId: parseInt(departamentoId)
            }
        })
        console.log(`✅ Categoría creada: ${cat.nombre}`)
        res.status(201).json({ success: true, data: cat })
    } catch (error) {
        console.error('❌ Error creando categoría:', error.message)
        res.status(400).json({ success: false, error: error.message })
    }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTAR
// ═══════════════════════════════════════════════════════════════════

module.exports = {
    listarDepartamentos,
    listarCategorias,
    categoriasPorDepartamento,
    crearDepartamento,
    crearCategoria,
    listar,
    obtener,
    crear,
    editar,
    cambiarEstado,
    actualizarImagen
}