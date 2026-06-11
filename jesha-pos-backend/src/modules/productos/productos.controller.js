// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.CONTROLLER.JS — INTEGRADO CON CLOUDINARY
// FIX: Usa instancia centralizada de Prisma (no crea una propia)
// FIX: Agrega tipoFacturaProv y costoSinIvaProveedor en crear/editar
// FEAT: actualizarImagen guarda url + public_id de Cloudinary
// FEAT: Nueva función eliminarImagen (para botón "quitar imagen")
// ═══════════════════════════════════════════════════════════════════

const { Prisma } = require('@prisma/client')
const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { eliminarImagenProducto } = require('../../lib/cloudinary')

// Valida si claveSat/unidadSat vienen vacíos o como "null"/"undefined"
function satInvalido(valor) {
    if (valor === null || valor === undefined) return true
    if (typeof valor === 'string') {
        const trimmed = valor.trim()
        if (trimmed === '') return true
        if (trimmed.toLowerCase() === 'null') return true
        if (trimmed.toLowerCase() === 'undefined') return true
    }
    return false
}

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
            include: { Departamento: true },
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
            contexto,
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
        const incluirFrecuenciaTickets = String(contexto || '').toLowerCase() === 'pos'
        const terminoRanking = String(terminoBusqueda || '').trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase()

        const rol = req.usuario?.rol
        const empresaIdRaw = req.usuario?.empresaId
        const esScopeGlobal = !empresaIdRaw && ['PLATFORM_ADMIN', 'SUPERADMIN'].includes(rol)
        const empresaIdScope = empresaIdRaw ? parseInt(empresaIdRaw) : null

        if (!esScopeGlobal && (!empresaIdScope || Number.isNaN(empresaIdScope))) {
            return res.status(401).json({ success: false, error: 'empresaId no encontrado en el token del usuario' })
        }

        const sucursalRaw = req.usuario?.sucursalId ?? req.query.sucursalId ?? 1
        const sucursalIdInventario = parseInt(sucursalRaw)
        if (!sucursalIdInventario || Number.isNaN(sucursalIdInventario)) {
            return res.status(400).json({ success: false, error: 'sucursalId inválido' })
        }

        const whereScope = esScopeGlobal ? {} : { empresaId: empresaIdScope }
        const where = { ...whereScope, activo: true }

        // ── Filtro por proveedor ──
        if (proveedorId) {
            where.ProveedorProducto = { some: { proveedorId: parseInt(proveedorId), activo: true } }
        }

        // ── Filtro por departamento (NUEVO — antes se hacía en frontend) ──
        if (departamentoId) {
            where.Categoria = { Departamento: { id: parseInt(departamentoId) } }
        }

        // ── Filtro por categoría ──
        if (categoriaId) {
            where.categoriaId = parseInt(categoriaId)
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
            where.InventarioSucursal = { some: { sucursalId: sucursalIdInventario, stockActual: { gt: 0 } } }
        } else if (stockFiltro === 'sin') {
            where.InventarioSucursal = { none: { sucursalId: sucursalIdInventario, stockActual: { gt: 0 } } }
        }
        // 'bajo' se maneja post-query porque requiere comparar dos columnas
        // (stockActual <= stockMinimoAlerta) que Prisma no soporta en where

        // ── Query de datos y conteo en paralelo ──
        const whereGlobal = { ...whereScope, activo: true }
        const takeConsulta = incluirFrecuenciaTickets && stockFiltro !== 'bajo'
            ? Math.max(skipNum + takeNum, 150)
            : (stockFiltro === 'bajo' ? 9999 : takeNum)
        const skipConsulta = incluirFrecuenciaTickets ? 0 : skipNum

        const queries = [
            prisma.producto.findMany({
                where,
                include: {
                    Categoria: { include: { Departamento: true } },
                    InventarioSucursal: { where: { sucursalId: sucursalIdInventario }, take: 1 },
                    ProveedorProducto: { include: { Proveedor: true } }
                },
                orderBy: { nombre: 'asc' },
                skip: skipConsulta,
                take: takeConsulta  // bajo stock y ranking POS necesitan filtrar/ordenar post-query
            }),
            prisma.producto.count({ where: stockFiltro === 'bajo' ? { ...where } : where }),
            // Conteos globales para las estadísticas del header
            prisma.producto.count({
                where: { ...whereGlobal, InventarioSucursal: { some: { sucursalId: sucursalIdInventario, stockActual: { gt: 0 } } } }
            }),
            prisma.producto.count({
                where: { ...whereGlobal, InventarioSucursal: { none: { sucursalId: sucursalIdInventario, stockActual: { gt: 0 } } } }
            }),
            prisma.$queryRaw`
                SELECT COUNT(*)::int AS count
                FROM "InventarioSucursal" i
                JOIN "Producto" p ON p.id = i."productoId"
                WHERE i."sucursalId" = ${sucursalIdInventario}
                  AND i."stockActual" > 0
                  AND i."stockActual" <= i."stockMinimoAlerta"
                  AND p.activo = true
                  AND (${esScopeGlobal} = true OR p."empresaId" = ${empresaIdScope || 0})
            `.then(r => r[0].count)
        ]

        let [productos, total, conStock, sinStock, bajoStock] = await Promise.all(queries)

        // ── Post-filtro para "bajo stock" (requiere comparar columnas) ──
        if (stockFiltro === 'bajo') {
            productos = productos.filter(p => {
                const inv = p.InventarioSucursal?.[0]
                if (!inv) return false
                const sa = parseFloat(inv.stockActual)
                const sm = parseFloat(inv.stockMinimoAlerta)
                return sa > 0 && sa <= sm
            })
            total = productos.length
            // Aplicar paginación manual sobre el resultado filtrado, salvo ranking POS.
            if (!incluirFrecuenciaTickets) productos = productos.slice(skipNum, skipNum + takeNum)
        }

        const frecuenciaTickets = new Map()
        if (incluirFrecuenciaTickets && productos.length > 0) {
            const productoIds = [...new Set(productos.map(p => parseInt(p.id)).filter(Boolean))]
            const desdeFrecuencia = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000))

            if (productoIds.length > 0) {
                const rowsFrecuencia = await prisma.$queryRaw`
                    SELECT
                      dv."productoId",
                      COUNT(DISTINCT dv."ventaId")::int AS "vecesEnTickets"
                    FROM "DetalleVenta" dv
                    JOIN "Venta" v ON v.id = dv."ventaId"
                    WHERE dv."productoId" IN (${Prisma.join(productoIds)})
                      AND v."creadaEn" >= ${desdeFrecuencia}
                      AND v."estado" <> 'CANCELADA'
                      AND v."sucursalId" = ${sucursalIdInventario}
                      AND (${esScopeGlobal} = true OR v."empresaId" = ${empresaIdScope || 0})
                    GROUP BY dv."productoId"
                `

                rowsFrecuencia.forEach(row => {
                    frecuenciaTickets.set(Number(row.productoId), Number(row.vecesEnTickets || 0))
                })
            }
        }

        if (incluirFrecuenciaTickets) {
            const normalizar = valor => String(valor || '').toLowerCase()
            const scoreProducto = prod => {
                const nombre = normalizar(prod.nombre)
                const codigoInterno = normalizar(prod.codigoInterno)
                const codigoBarras = normalizar(prod.codigoBarras)
                const stockActual = parseFloat(prod.InventarioSucursal?.[0]?.stockActual || 0)
                const frecuencia = frecuenciaTickets.get(prod.id) || 0

                let score = 0
                if (terminoRanking) {
                    if (codigoInterno === terminoRanking || codigoBarras === terminoRanking) score += 1000000
                    if (codigoInterno.includes(terminoRanking) || codigoBarras.includes(terminoRanking)) score += 500000
                    if (nombre.startsWith(terminoRanking)) score += 200000
                    if (nombre.includes(terminoRanking)) score += 100000
                }
                if (stockActual > 0) score += 10000
                score += frecuencia * 100
                return score
            }

            productos = productos
                .sort((a, b) => {
                    const porScore = scoreProducto(b) - scoreProducto(a)
                    if (porScore !== 0) return porScore
                    return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' })
                })
                .slice(skipNum, skipNum + takeNum)
        }

        const data = productos.map(prod => ({
            ...prod,
            ...(incluirFrecuenciaTickets ? { vecesEnTickets: frecuenciaTickets.get(prod.id) || 0 } : {}),
            stock: prod.InventarioSucursal?.length > 0 ? parseFloat(prod.InventarioSucursal[0].stockActual) : 0,
            inventario: prod.InventarioSucursal?.length > 0 ? {
              ...prod.InventarioSucursal[0],
              stockActual:       parseFloat(prod.InventarioSucursal[0].stockActual),
              stockMinimoAlerta: parseFloat(prod.InventarioSucursal[0].stockMinimoAlerta),
              stockMaximo:       prod.InventarioSucursal[0].stockMaximo ? parseFloat(prod.InventarioSucursal[0].stockMaximo) : null
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
                Categoria: { include: { Departamento: true } },
                InventarioSucursal: { where: { sucursalId: 1 }, take: 1 },
                ProveedorProducto: {
                    include: { Proveedor: true }
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
                inventario: producto.InventarioSucursal?.length > 0 ? producto.InventarioSucursal[0] : null
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
        const empresaId = getEmpresaId(req)

        if (!nombre || !codigoInterno || !categoriaId || !precioBase) {
            return res.status(400).json({
                success: false,
                error: 'Faltan campos requeridos: nombre, codigoInterno, categoriaId, precioBase'
            })
        }

        // Validar CLAVE SAT y UNIDAD SAT obligatorios
        if (satInvalido(claveSat) || satInvalido(unidadSat)) {
            return res.status(400).json({
                success: false,
                error: 'CLAVE SAT y UNIDAD SAT son obligatorios',
                campo: 'sat'
            })
        }

        const existente = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId, codigoInterno } } })
        if (existente) {
            return res.status(400).json({ success: false, error: 'El código interno ya existe' })
        }

        const producto = await prisma.producto.create({
            data: {
                empresaId,
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
                Categoria: { include: { Departamento: true } },
                InventarioSucursal: { where: { sucursalId: 1 }, take: 1 }
            }
        })

        // Guardar relación con proveedor si se proporcionó
        if (proveedorId) {
            await prisma.proveedorProducto.create({
                data: {
                    productoId: producto.id,
                    proveedorId: parseInt(proveedorId),
                    precioCosto: costo ? parseFloat(costo) : 0,
                    activo: true,
                    actualizadoEn: new Date()
                }
            })
            console.log(`✅ Proveedor ${proveedorId} vinculado al producto ${producto.id}`)
        }

        console.log(`✅ Producto creado: ${nombre}`)
        res.status(201).json({
            success: true,
            data: {
                ...producto,
                inventario: producto.InventarioSucursal?.length > 0 ? producto.InventarioSucursal[0] : null
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

        // Validar CLAVE SAT y UNIDAD SAT solo si vienen en el body
        if ('claveSat' in req.body && satInvalido(claveSat)) {
            return res.status(400).json({
                success: false,
                error: 'CLAVE SAT no puede estar vacía',
                campo: 'claveSat'
            })
        }

        if ('unidadSat' in req.body && satInvalido(unidadSat)) {
            return res.status(400).json({
                success: false,
                error: 'UNIDAD SAT no puede estar vacía',
                campo: 'unidadSat'
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
                Categoria: { include: { Departamento: true } },
                InventarioSucursal: { where: { sucursalId: 1 }, take: 1 }
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
                inventario: producto.InventarioSucursal?.length > 0 ? producto.InventarioSucursal[0] : null
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
            Categoria: { include: { Departamento: true } },
            InventarioSucursal: { where: { sucursalId: 1 }, take: 1 }
        }
    })
    console.log(`✅ Imagen actualizada (Cloudinary): ${producto.nombre}`)
    return {
        ...producto,
        inventario: producto.InventarioSucursal?.length > 0 ? producto.InventarioSucursal[0] : null
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
                Categoria: { include: { Departamento: true } },
                InventarioSucursal: { where: { sucursalId: 1 }, take: 1 }
            }
        })

        console.log(`✅ Imagen eliminada: ${actualizado.nombre}`)
        res.json({
            success: true,
            mensaje: 'Imagen eliminada',
            data: {
                ...actualizado,
                inventario: actualizado.InventarioSucursal?.length > 0 ? actualizado.InventarioSucursal[0] : null
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
        const empresaId = getEmpresaId(req)
        const { nombre } = req.body
        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ success: false, error: 'Nombre requerido' })
        }

        const existente = await prisma.departamento.findFirst({
            where: { empresaId, nombre: { equals: nombre.trim().toUpperCase(), mode: 'insensitive' } }
        })
        if (existente) {
            return res.json({ success: true, data: existente, mensaje: 'Ya existía' })
        }

        const depto = await prisma.departamento.create({
            data: { empresaId, nombre: nombre.trim().toUpperCase(), activo: true }
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
        const empresaId = getEmpresaId(req)
        const { nombre, departamentoId } = req.body
        if (!nombre || !departamentoId) {
            return res.status(400).json({ success: false, error: 'Nombre y departamentoId requeridos' })
        }

        const existente = await prisma.categoria.findFirst({
            where: {
                empresaId,
                departamentoId: parseInt(departamentoId),
                nombre: { equals: nombre.trim(), mode: 'insensitive' }
            }
        })
        if (existente) {
            return res.json({ success: true, data: existente, mensaje: 'Ya existía' })
        }

        const cat = await prisma.categoria.create({
            data: {
                empresaId,
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
    const empresaId = getEmpresaId(req)

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
          Categoria: { include: { Departamento: true } },
          InventarioSucursal: {
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
    const stockAnterior = producto.InventarioSucursal[0]
      ? parseFloat(parseFloat(producto.InventarioSucursal[0].stockActual).toFixed(3))
      : 0
    const minAnterior = producto.InventarioSucursal[0]
      ? parseFloat(parseFloat(producto.InventarioSucursal[0].stockMinimoAlerta).toFixed(3))
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
            empresaId,
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
// EDITAR DATOS BÁSICOS — edición limitada para rol EMPLEADO
// Solo permite: nombre, codigoInterno, codigoBarras.
// Cualquier otro campo del body se ignora.
// ═══════════════════════════════════════════════════════════════════

async function editarDatosBasicos(req, res) {
    try {
        const id = parseInt(req.params.id)
        if (!id || Number.isNaN(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' })
        }

        const nombre        = typeof req.body.nombre        === 'string' ? req.body.nombre.trim()        : ''
        const codigoInterno = typeof req.body.codigoInterno === 'string' ? req.body.codigoInterno.trim() : ''
        let   codigoBarras  = typeof req.body.codigoBarras  === 'string' ? req.body.codigoBarras.trim()  : ''
        if (codigoBarras === '') codigoBarras = null

        if (!nombre)        return res.status(400).json({ success: false, error: 'El nombre es requerido' })
        if (!codigoInterno) return res.status(400).json({ success: false, error: 'El código interno es requerido' })

        const rol          = req.usuario?.rol
        const empresaIdRaw = req.usuario?.empresaId
        const esGlobal     = empresaIdRaw === null && ['PLATFORM_ADMIN', 'SUPERADMIN'].includes(rol)
        const empresaId    = esGlobal ? null : parseInt(empresaIdRaw)

        if (!esGlobal && (!empresaId || Number.isNaN(empresaId))) {
            return res.status(401).json({ success: false, error: 'empresaId no encontrado en el token del usuario' })
        }

        const existente = await prisma.producto.findFirst({
            where: esGlobal ? { id } : { id, empresaId }
        })
        if (!existente) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado' })
        }

        const empresaProducto = existente.empresaId

        const dupInterno = await prisma.producto.findFirst({
            where: { empresaId: empresaProducto, codigoInterno, id: { not: id } },
            select: { id: true }
        })
        if (dupInterno) {
            return res.status(400).json({ success: false, error: 'El código interno ya existe en otro producto', campo: 'codigoInterno' })
        }

        if (codigoBarras !== null) {
            const dupBarras = await prisma.producto.findFirst({
                where: { empresaId: empresaProducto, codigoBarras, id: { not: id } },
                select: { id: true }
            })
            if (dupBarras) {
                return res.status(400).json({ success: false, error: 'El código de barras ya existe en otro producto', campo: 'codigoBarras' })
            }
        }

        const producto = await prisma.producto.update({
            where: { id },
            data: { nombre, codigoInterno, codigoBarras },
            include: {
                Categoria: { include: { Departamento: true } },
                InventarioSucursal: { where: { sucursalId: 1 }, take: 1 }
            }
        })

        console.log(`✅ Datos básicos actualizados: ${nombre} (id ${id})`)
        return res.json({
            success: true,
            data: {
                ...producto,
                inventario: producto.InventarioSucursal?.length > 0 ? producto.InventarioSucursal[0] : null
            }
        })
    } catch (error) {
        if (error.code === 'P2002') {
            const target  = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target || '')
            const esBarra = target.toLowerCase().includes('barras')
            return res.status(400).json({
                success: false,
                error: esBarra ? 'El código de barras ya existe en otro producto' : 'El código interno ya existe en otro producto'
            })
        }
        console.error('❌ Error editando datos básicos:', error.message)
        return res.status(400).json({ success: false, error: error.message })
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
    ajustarInventario,
    editarDatosBasicos
}
