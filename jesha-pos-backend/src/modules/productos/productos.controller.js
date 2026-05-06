// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.CONTROLLER.JS — INTEGRADO CON CLOUDINARY
// FIX: Usa instancia centralizada de Prisma (no crea una propia)
// FIX: Agrega tipoFacturaProv y costoSinIvaProveedor en crear/editar
// FEAT: actualizarImagen guarda url + public_id de Cloudinary
// FEAT: Nueva función eliminarImagen (para botón "quitar imagen")
// ═══════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const { eliminarImagenProducto } = require('../../lib/cloudinary')

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
// LISTAR TODOS — CON PAGINACIÓN REAL Y FILTROS EN BACKEND
// Params: page, limit, buscar, categoriaId, departamentoId,
//         stock (con|sin|bajo), proveedorId
// ═══════════════════════════════════════════════════════════════════

async function listar(req, res) {
    try {
        console.log('🔍 Iniciando query de productos...')

        const {
            buscar, q, categoriaId, departamentoId, proveedorId,
            stock,          // 'con' | 'sin' | 'bajo' — reemplaza el antiguo enStock
            enStock,        // compatibilidad hacia atrás con POS
            page = 1,
            limit = 50,
            // Compatibilidad con skip/take directo (ej: POS u otros módulos)
            skip, take
        } = req.query

        // Calcular skip/take desde page/limit O desde skip/take directo
        let takeNum, skipNum
        if (skip !== undefined || take !== undefined) {
            // Modo legacy — quien manda skip/take directo
            skipNum = parseInt(skip) || 0
            takeNum = parseInt(take) || 50
        } else {
            // Modo paginación — page/limit
            takeNum = Math.min(parseInt(limit) || 50, 200) // tope de 200 por seguridad
            const pageNum = Math.max(parseInt(page) || 1, 1)
            skipNum = (pageNum - 1) * takeNum
        }

        const terminoBusqueda = buscar || q

        const where = { activo: true }

        // ── Filtro por proveedor ──
        if (proveedorId) {
            where.proveedores = { some: { proveedorId: parseInt(proveedorId), activo: true } }
        }

        // ── Filtro por departamento (NUEVO — antes se hacía en frontend) ──
        if (departamentoId) {
            where.categoria = { departamentoId: parseInt(departamentoId) }
        }

        // ── Filtro por categoría ──
        if (categoriaId) {
            // Si ya hay where.categoria por departamento, mergeamos
            if (where.categoria) {
                where.categoriaId = parseInt(categoriaId)
                delete where.categoria // categoriaId es más específico
            } else {
                where.categoriaId = parseInt(categoriaId)
            }
        }

        // ── Filtro por búsqueda ──
        if (terminoBusqueda) {
            const termLimpio = terminoBusqueda.trim().replace(/^["']+|["']+$/g, '').trim()
            const esCodigoNumerico = /^\d+$/.test(termLimpio)
            const sinCeros = termLimpio.replace(/^0+/, '')
            const palabras = termLimpio.split(/\s+/).filter(Boolean)

            if (palabras.length <= 1) {
                const condiciones = [
                    { nombre:        { contains: termLimpio, mode: 'insensitive' } },
                    { codigoInterno: { contains: termLimpio, mode: 'insensitive' } },
                    { codigoBarras:  { contains: termLimpio, mode: 'insensitive' } }
                ]

                if (esCodigoNumerico && sinCeros !== termLimpio && sinCeros.length > 0) {
                    condiciones.push(
                        { codigoInterno: { contains: sinCeros, mode: 'insensitive' } },
                        { codigoBarras:  { contains: sinCeros, mode: 'insensitive' } }
                    )
                }

                if (esCodigoNumerico && sinCeros.length > 0) {
                    condiciones.push(
                        { codigoInterno: { endsWith: sinCeros, mode: 'insensitive' } },
                        { codigoBarras:  { endsWith: sinCeros, mode: 'insensitive' } }
                    )
                }

                where.OR = condiciones
            } else {
                where.AND = palabras.map(palabra => ({
                    nombre: { contains: palabra, mode: 'insensitive' }
                }))
            }
        }

        // ── Filtro por stock (NUEVO — antes se hacía en frontend) ──
        // Soporta el nuevo param `stock` (con|sin|bajo) y el legacy `enStock`
        const stockFiltro = stock || (enStock === 'true' ? 'con' : '')
        if (stockFiltro === 'con') {
            where.inventarios = { some: { sucursalId: 1, stockActual: { gt: 0 } } }
        } else if (stockFiltro === 'sin') {
            where.inventarios = { none: { sucursalId: 1, stockActual: { gt: 0 } } }
        }
        // 'bajo' se maneja post-query porque requiere comparar dos columnas
        // (stockActual <= stockMinimoAlerta) que Prisma no soporta en where

        // ── Query de datos y conteo en paralelo ──
        const whereGlobal = { activo: true }

        const queries = [
            prisma.producto.findMany({
                where,
                include: {
                    categoria: { include: { departamento: true } },
                    inventarios: { where: { sucursalId: 1 }, take: 1 },
                    proveedores: { include: { proveedor: true } }
                },
                orderBy: { nombre: 'asc' },
                skip: skipNum,
                take: stockFiltro === 'bajo' ? 9999 : takeNum  // bajo stock necesita filtrar post-query
            }),
            prisma.producto.count({ where: stockFiltro === 'bajo' ? { ...where } : where }),
            // Conteos globales para las estadísticas del header
            prisma.producto.count({
                where: { ...whereGlobal, inventarios: { some: { sucursalId: 1, stockActual: { gt: 0 } } } }
            }),
            prisma.producto.count({
                where: { ...whereGlobal, inventarios: { none: { sucursalId: 1, stockActual: { gt: 0 } } } }
            }),
            prisma.$queryRaw`
                SELECT COUNT(*)::int AS count
                FROM "InventarioSucursal" i
                JOIN "Producto" p ON p.id = i."productoId"
                WHERE i."sucursalId" = 1
                  AND i."stockActual" > 0
                  AND i."stockActual" <= i."stockMinimoAlerta"
                  AND p.activo = true
            `.then(r => r[0].count)
        ]

        let [productos, total, conStock, sinStock, bajoStock] = await Promise.all(queries)

        // ── Post-filtro para "bajo stock" (requiere comparar columnas) ──
        if (stockFiltro === 'bajo') {
            productos = productos.filter(p => {
                const inv = p.inventarios?.[0]
                if (!inv) return false
                const sa = parseFloat(inv.stockActual)
                const sm = parseFloat(inv.stockMinimoAlerta)
                return sa > 0 && sa <= sm
            })
            total = productos.length
            // Aplicar paginación manual sobre el resultado filtrado
            productos = productos.slice(skipNum, skipNum + takeNum)
        }

        const data = productos.map(prod => ({
            ...prod,
            stock: prod.inventarios?.length > 0 ? parseFloat(prod.inventarios[0].stockActual) : 0,
            inventario: prod.inventarios?.length > 0 ? {
              ...prod.inventarios[0],
              stockActual:       parseFloat(prod.inventarios[0].stockActual),
              stockMinimoAlerta: parseFloat(prod.inventarios[0].stockMinimoAlerta),
              stockMaximo:       prod.inventarios[0].stockMaximo ? parseFloat(prod.inventarios[0].stockMaximo) : null
            } : null
        }))

        const paginaActual = Math.floor(skipNum / takeNum) + 1

        console.log(`✅ Productos: ${data.length} de ${total} (pág ${paginaActual}) | stock: ${conStock} con, ${sinStock} sin, ${bajoStock} bajo`)
        res.json({
            success: true,
            data,
            paginacion: {
                total,
                skip:         skipNum,
                take:         takeNum,
                pagina:       paginaActual,
                totalPaginas: Math.ceil(total / takeNum)
            },
            resumenStock: {
                conStock:  Number(conStock),
                sinStock:  Number(sinStock),
                bajoStock: Number(bajoStock)
            }
        })
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
                inventarios: { where: { sucursalId: 1 }, take: 1 },
                proveedores: {
                    include: { proveedor: true }
                }
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
            costo, precioBase, precioVenta, categoriaId,
            unidadCompra, unidadVenta, factorConversion,
            claveSat, unidadSat, proveedorId,
            tipoFacturaProv, costoSinIvaProveedor,
            esGranel
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
                codigoBarras:        codigoBarras     || null,
                descripcion:         descripcion      || null,
                costo:               costo            ? parseFloat(costo)            : null,
                costoPromedio:       costo            ? parseFloat(costo)            : null,
                precioBase:          parseFloat(precioBase),
                precioVenta:         precioVenta ? parseFloat(precioVenta) : null,
                categoriaId:         parseInt(categoriaId),
                unidadCompra:        unidadCompra     || null,
                unidadVenta:         unidadVenta      || null,
                factorConversion:    factorConversion ? parseFloat(factorConversion) : null,
                claveSat:            claveSat         || null,
                unidadSat:           unidadSat        || null,
                tipoFacturaProv:     tipoFacturaProv  || 'NETO',
                costoSinIvaProveedor: costoSinIvaProveedor ? parseFloat(costoSinIvaProveedor) : null,
                esGranel:            esGranel === true || esGranel === 'true',
                activo: true
            },
            include: {
                categoria: { include: { departamento: true } },
                inventarios: { where: { sucursalId: 1 }, take: 1 }
            }
        })

        // Guardar relación con proveedor si se proporcionó
        if (proveedorId) {
            await prisma.proveedorProducto.create({
                data: {
                    productoId: producto.id,
                    proveedorId: parseInt(proveedorId),
                    precioCosto: costo ? parseFloat(costo) : 0,
                    activo: true
                }
            })
            console.log(`✅ Proveedor ${proveedorId} vinculado al producto ${producto.id}`)
        }

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
            costo, precioBase, precioVenta, categoriaId,
            unidadCompra, unidadVenta, factorConversion,
            claveSat, unidadSat, proveedorId,
            tipoFacturaProv, costoSinIvaProveedor,
            esGranel
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
                codigoBarras:        codigoBarras     || null,
                descripcion:         descripcion      || null,
                costo:               costo            ? parseFloat(costo)            : null,
                precioBase:          parseFloat(precioBase),
                precioVenta:         precioVenta ? parseFloat(precioVenta) : null,
                categoriaId:         parseInt(categoriaId),
                unidadCompra:        unidadCompra     || null,
                unidadVenta:         unidadVenta      || null,
                factorConversion:    factorConversion ? parseFloat(factorConversion) : null,
                claveSat:            claveSat         || null,
                unidadSat:           unidadSat        || null,
                tipoFacturaProv:     tipoFacturaProv  || 'NETO',
                costoSinIvaProveedor: costoSinIvaProveedor ? parseFloat(costoSinIvaProveedor) : null,
                esGranel:            esGranel === true || esGranel === 'true',
            },
            include: {
                categoria: { include: { departamento: true } },
                inventarios: { where: { sucursalId: 1 }, take: 1 }
            }
        })

        // Gestionar relación con proveedor
        // 1. Eliminar relaciones anteriores
        await prisma.proveedorProducto.deleteMany({
            where: { productoId: parseInt(id) }
        })

        // 2. Crear nueva relación si se proporcionó un proveedor
        if (proveedorId && proveedorId !== '' && proveedorId !== 'null') {
            await prisma.proveedorProducto.create({
                data: {
                    productoId: parseInt(id),
                    proveedorId: parseInt(proveedorId),
                    precioCosto: costo ? parseFloat(costo) : 0,
                    activo: true
                }
            })
            console.log(`✅ Proveedor ${proveedorId} vinculado al producto ${id}`)
        } else {
            console.log(`ℹ️ Producto ${id} actualizado sin proveedor`)
        }

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
// NOTA: Opción suave — NO borra la imagen de Cloudinary aunque se desactive
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
// ACTUALIZAR IMAGEN — INTEGRADO CON CLOUDINARY
// Recibe { url, public_id } desde productos.routes.js (tras subir a Cloudinary)
// Guarda ambos campos para permitir borrar/reemplazar después
// ═══════════════════════════════════════════════════════════════════

async function actualizarImagen(id, { url, public_id }) {
    const producto = await prisma.producto.update({
        where: { id: parseInt(id) },
        data: {
            imagenUrl:      url,
            imagenPublicId: public_id
        },
        include: {
            categoria: { include: { departamento: true } },
            inventarios: { where: { sucursalId: 1 }, take: 1 }
        }
    })
    console.log(`✅ Imagen actualizada (Cloudinary): ${producto.nombre}`)
    return {
        ...producto,
        inventario: producto.inventarios?.length > 0 ? producto.inventarios[0] : null
    }
}

// ═══════════════════════════════════════════════════════════════════
// ELIMINAR IMAGEN — NUEVO
// Endpoint listo para usar cuando se añada un botón "quitar imagen" en UI
// Borra de Cloudinary Y limpia los campos en BD
// (Si falla el borrado remoto, igual limpia BD para no dejar referencia rota)
// ═══════════════════════════════════════════════════════════════════

async function eliminarImagen(req, res) {
    try {
        const { id } = req.params
        const producto = await prisma.producto.findUnique({
            where: { id: parseInt(id) }
        })

        if (!producto) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado' })
        }

        // Si tiene public_id, intentar borrar de Cloudinary
        if (producto.imagenPublicId) {
            await eliminarImagenProducto(producto.imagenPublicId)
        }

        // Limpiar campos en BD (independiente del resultado de Cloudinary)
        const actualizado = await prisma.producto.update({
            where: { id: parseInt(id) },
            data: { imagenUrl: null, imagenPublicId: null },
            include: {
                categoria: { include: { departamento: true } },
                inventarios: { where: { sucursalId: 1 }, take: 1 }
            }
        })

        console.log(`✅ Imagen eliminada: ${actualizado.nombre}`)
        res.json({
            success: true,
            mensaje: 'Imagen eliminada',
            data: {
                ...actualizado,
                inventario: actualizado.inventarios?.length > 0 ? actualizado.inventarios[0] : null
            }
        })
    } catch (error) {
        console.error('❌ Error eliminando imagen:', error.message)
        res.status(500).json({ success: false, error: error.message })
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
// AJUSTAR INVENTARIO
// FIX: parseFloat con toFixed(3) para soportar granel
// FIX: stock con decimales ya no se trunca silenciosamente
// ═══════════════════════════════════════════════════════════════════

async function ajustarInventario(req, res) {
  try {
    const { id } = req.params
    const { stockActual, stockMinimoAlerta, motivo } = req.body
    const usuario = req.usuario  // viene del middleware requireAuth

    // ── Validar rol ──
    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL']
    if (!rolesPermitidos.includes(usuario.rol)) {
      return res.status(403).json({
        error: 'No tienes permisos para ajustar inventario. Se requiere SUPERADMIN o ADMIN_SUCURSAL.'
      })
    }

    // ── Validar que el producto existe ──
    const producto = await prisma.producto.findUnique({
      where: { id: parseInt(id) },
      include: {
        inventarios: {
          where: { sucursalId: usuario.sucursalId || 1 }
        }
      }
    })
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' })

    // ── Validar valores (soporta decimales para granel) ──
    if (stockActual !== undefined && (isNaN(parseFloat(stockActual)) || parseFloat(stockActual) < 0)) {
      return res.status(400).json({ error: 'Stock actual debe ser un número >= 0' })
    }
    if (stockMinimoAlerta !== undefined && (isNaN(parseFloat(stockMinimoAlerta)) || parseFloat(stockMinimoAlerta) < 0)) {
      return res.status(400).json({ error: 'Stock mínimo debe ser un número >= 0' })
    }

    const sucursalId = usuario.sucursalId || 1

    // ── Normalización a Decimal(10,3): parseFloat + toFixed(3) ──
    const stockAnterior = producto.inventarios[0]
      ? parseFloat(parseFloat(producto.inventarios[0].stockActual).toFixed(3))
      : 0
    const minAnterior = producto.inventarios[0]
      ? parseFloat(parseFloat(producto.inventarios[0].stockMinimoAlerta).toFixed(3))
      : 5

    // ── Upsert inventario ──
    const updateData = {}
    if (stockActual !== undefined) {
      updateData.stockActual = parseFloat(parseFloat(stockActual).toFixed(3))
    }
    if (stockMinimoAlerta !== undefined) {
      updateData.stockMinimoAlerta = parseFloat(parseFloat(stockMinimoAlerta).toFixed(3))
    }

    const inventario = await prisma.inventarioSucursal.upsert({
      where: { productoId_sucursalId: { productoId: parseInt(id), sucursalId } },
      update: updateData,
      create: {
        productoId:        parseInt(id),
        sucursalId,
        stockActual:       parseFloat(parseFloat(stockActual ?? 0).toFixed(3)),
        stockMinimoAlerta: parseFloat(parseFloat(stockMinimoAlerta ?? 5).toFixed(3)),
      }
    })

    // ── Registrar en MovimientoInventario si cambió el stock ──
    if (stockActual !== undefined) {
      const stockNuevo = parseFloat(parseFloat(stockActual).toFixed(3))
      const diferencia = parseFloat((stockNuevo - stockAnterior).toFixed(3))

      if (diferencia !== 0) {
        await prisma.movimientoInventario.create({
          data: {
            productoId:   parseInt(id),
            sucursalId,
            usuarioId:    usuario.id,
            tipo:         diferencia > 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO',
            cantidad:     Math.abs(diferencia),
            stockAntes:   stockAnterior,
            stockDespues: stockNuevo,
            notas:        motivo || 'Ajuste manual de inventario',
          }
        })
      }
    }

    console.log(`✅ Inventario ajustado: producto ${id} | stock ${stockAnterior}→${stockActual ?? stockAnterior} | min ${minAnterior}→${stockMinimoAlerta ?? minAnterior} | por ${usuario.nombre}`)

    res.json({
      success: true,
      mensaje: 'Inventario actualizado correctamente',
      data: {
        productoId:        parseInt(id),
        stockActual:       parseFloat(inventario.stockActual),
        stockMinimoAlerta: parseFloat(inventario.stockMinimoAlerta),
        stockAnterior,
        minAnterior,
      }
    })
  } catch (err) {
    console.error('❌ Error ajustando inventario:', err)
    res.status(500).json({ error: 'Error interno', detalle: err.message })
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
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
    actualizarImagen,
    eliminarImagen,
    ajustarInventario
}