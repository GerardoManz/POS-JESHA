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
const satMatcher = require('./sat.matcher')
const { verificarStockPostOperacion } = require('../../helpers/verificarStock')
const {
    normalizarCodigoBarras,
    normalizarCodigoInterno,
    generarCodigoBarrasAutomatico,
    validarCodigoBarrasDuplicado,
    parsearErrorPrismaProducto
} = require('./productos.helpers')

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

function normalizarClaveSat(valor) {
    if (satInvalido(valor)) return null
    return String(valor).trim()
}

function normalizarUnidadSat(valor) {
    if (satInvalido(valor)) return null
    return String(valor).trim().toUpperCase()
}

function validarSatCatalogo(claveSat, unidadSat) {
    const clave = normalizarClaveSat(claveSat)
    const unidad = normalizarUnidadSat(unidadSat)

    if (!clave || !unidad) {
        return { ok: false, campo: 'sat', error: 'CLAVE SAT y UNIDAD SAT son obligatorios' }
    }

    if (!/^\d{8}$/.test(clave)) {
        return { ok: false, campo: 'claveSat', error: 'CLAVE SAT debe tener 8 dígitos' }
    }

    if (!satMatcher.validarClaveSat(clave)) {
        return { ok: false, campo: 'claveSat', error: `CLAVE SAT ${clave} no existe en el catálogo SAT vigente` }
    }

    if (!satMatcher.validarUnidadSat(unidad)) {
        return { ok: false, campo: 'unidadSat', error: `UNIDAD SAT ${unidad} no existe en el catálogo SAT vigente` }
    }

    return { ok: true, claveSat: clave, unidadSat: unidad }
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
            skip, take,
            tipo,           // 'PRODUCTO' | 'SERVICIO' — filtra por tipo de producto
            activo          // 'true' | 'false' | 'all' — default: 'true' (solo activos)
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
        const where = { ...whereScope }
        if (activo === 'all') {
            // no filtra — retorna todos
        } else if (activo !== undefined) {
            where.activo = activo === 'true'
        } else {
            where.activo = true  // default: solo activos
        }

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

            if (!esCodigoNumerico) {
                // Híbrido: full-text PostgreSQL (precisión: PVC ≠ CPVC) +
                // ILIKE por palabra individual (cobertura: "concreto" en "p/concreto")
                let ids = []

                // 1) Full-text search PostgreSQL — word boundary, orden independiente
                try {
                    const rawResult = await prisma.$queryRaw`
                        SELECT p.id FROM "Producto" p
                        WHERE p."empresaId" = ${empresaIdScope}
                          AND (
                            to_tsvector('simple', p.nombre) @@ plainto_tsquery('simple', ${termLimpio})
                            OR p."codigoInterno" ILIKE ${'%' + termLimpio + '%'}
                            OR p."codigoBarras" ILIKE ${'%' + termLimpio + '%'}
                          )
                    `
                    ids = rawResult.map(r => Number(r.id))
                } catch (rawErr) {
                    console.error('⚠️ Full-text search error:', rawErr.message)
                }

                // 2) ILIKE por palabra — para que "clavo concreto" encuentre "clavo p/concreto"
                try {
                    const ilikeWhere = {
                        ...(esScopeGlobal ? {} : { empresaId: empresaIdScope }),
                        AND: palabras.map(p => ({
                            OR: [
                                { nombre:        { contains: p, mode: 'insensitive' } },
                                { codigoInterno: { contains: p, mode: 'insensitive' } },
                                { codigoBarras:  { contains: p, mode: 'insensitive' } }
                            ]
                        }))
                    }
                    const ilikeResults = await prisma.producto.findMany({
                        where: ilikeWhere,
                        select: { id: true }
                    })
                    const ilikeIds = ilikeResults.map(r => r.id)
                    ids = [...new Set([...ids, ...ilikeIds])]
                } catch (ilikeErr) {
                    console.error('⚠️ ILIKE search error:', ilikeErr.message)
                }

                if (ids.length > 0) {
                    where.id = { in: ids }
                } else {
                    return res.json({ success: true, data: [], paginacion: { total: 0, totalPaginas: 0, pagina: 1 } })
                }
            } else {
                // Numérico (escaneo de código) → lógica original
                const condiciones = [
                    { nombre:        { contains: termLimpio, mode: 'insensitive' } },
                    { codigoInterno: { contains: termLimpio, mode: 'insensitive' } },
                    { codigoBarras:  { contains: termLimpio, mode: 'insensitive' } }
                ]

                if (sinCeros !== termLimpio && sinCeros.length > 0) {
                    condiciones.push(
                        { codigoInterno: { contains: sinCeros, mode: 'insensitive' } },
                        { codigoBarras:  { contains: sinCeros, mode: 'insensitive' } }
                    )
                }

                if (sinCeros.length > 0) {
                    condiciones.push(
                        { codigoInterno: { endsWith: sinCeros, mode: 'insensitive' } },
                        { codigoBarras:  { endsWith: sinCeros, mode: 'insensitive' } }
                    )
                }

                where.OR = condiciones
            }
        }

        // ── Filtro por stock (NUEVO — antes se hacía en frontend) ──
        // Soporta el nuevo param `stock` (con|sin|bajo) y el legacy `enStock`
        const stockFiltro = stock || (enStock === 'true' ? 'con' : '')
        if (stockFiltro === 'con') {
            where.InventarioSucursal = { some: { sucursalId: sucursalIdInventario, stockActual: { gt: 0 } } }
        } else if (stockFiltro === 'sin') {
            where.InventarioSucursal = { none: { sucursalId: sucursalIdInventario, stockActual: { gt: 0 } } }
        } else if (stockFiltro === 'sin_imagen') {
            where.imagenUrl = null
        }
        // 'bajo' se maneja post-query porque requiere comparar dos columnas
        // (stockActual <= stockMinimoAlerta) que Prisma no soporta en where

        // ── Filtro por tipo de producto ──
        if (tipo && ['PRODUCTO', 'SERVICIO'].includes(tipo)) {
            where.tipo = tipo
        }

        // ── Query de datos y conteo en paralelo ──
        const whereGlobal = { ...whereScope }
        if (activo === 'all') {
            // no filtra
        } else if (activo !== undefined) {
            whereGlobal.activo = activo === 'true'
        } else {
            whereGlobal.activo = true
        }
        const requiereRanking = incluirFrecuenciaTickets || !!terminoBusqueda
        const takeConsulta = requiereRanking && stockFiltro !== 'bajo'
            ? Math.max(skipNum + takeNum, 150)
            : (stockFiltro === 'bajo' ? 9999 : takeNum)
        const skipConsulta = requiereRanking ? 0 : skipNum

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
            // Aplicar paginación manual sobre el resultado filtrado, salvo ranking.
            if (!requiereRanking) productos = productos.slice(skipNum, skipNum + takeNum)
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

        if (requiereRanking) {
            const normalizar = valor => String(valor || '').toLowerCase()
            const escaparRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
                    // Palabra exacta (ej: "PVC" en "TUBO PVC 3/4" ≠ "CPVC")
                    const re = new RegExp('\\b' + escaparRegex(terminoRanking) + '\\b', 'i')
                    if (re.test(prod.nombre)) score += 50000
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
                    orderBy: { actualizadoEn: 'desc' },
                    take: 1,
                    include: { Proveedor: true }
                }
            }
        })

        if (!producto || !producto.activo) {
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
        let {
            nombre, codigoInterno, codigoBarras, descripcion,
            costo, precioBase, precioVenta, categoriaId,
            unidadCompra, unidadVenta, factorConversion,
            claveSat, unidadSat, proveedorId,
            tipoFacturaProv, costoSinIvaProveedor,
            esGranel, tipo
        } = req.body
        const empresaId = getEmpresaId(req)

        // Normalizar codigoBarras y codigoInterno
        codigoBarras = normalizarCodigoBarras(codigoBarras)
        codigoInterno = normalizarCodigoInterno(codigoInterno)

        if (!nombre || !codigoInterno || !categoriaId || !precioBase) {
            const faltantes = []
            if (!nombre) faltantes.push('nombre')
            if (!codigoInterno) faltantes.push('codigoInterno')
            if (!categoriaId) faltantes.push('categoriaId')
            if (!precioBase) faltantes.push('precioBase')
            return res.status(400).json({
                success: false,
                error: `Faltan campos requeridos: ${faltantes.join(', ')}`
            })
        }

        // tipo: PRODUCTO (default) o SERVICIO. Servicio → sin inventario, SAT auto 78101800/E48
        const tipoFinal = tipo || 'PRODUCTO'
        if (!['PRODUCTO', 'SERVICIO'].includes(tipoFinal)) {
            return res.status(400).json({ success: false, error: "tipo debe ser 'PRODUCTO' o 'SERVICIO'", campo: 'tipo' })
        }
        const esServicio = tipoFinal === 'SERVICIO'

        // Validar CLAVE SAT y UNIDAD SAT obligatorios (solo para productos físicos)
        if (!esServicio && (satInvalido(claveSat) || satInvalido(unidadSat))) {
            return res.status(400).json({
                success: false,
                error: 'CLAVE SAT y UNIDAD SAT son obligatorios',
                campo: 'sat'
            })
        }

        // Servicio sin SAT → auto-asignar default confiable
        if (esServicio) {
            claveSat = claveSat || '78101800'     // Servicios generales
            unidadSat = unidadSat || 'E48'        // Unidad de servicio
        }

        const validacionSat = validarSatCatalogo(claveSat, unidadSat)
        if (!validacionSat.ok) {
            return res.status(400).json({ success: false, error: validacionSat.error, campo: validacionSat.campo })
        }
        claveSat = validacionSat.claveSat
        unidadSat = validacionSat.unidadSat

        // Auto-generar código de barras secuencial para productos físicos sin uno
        const codigoBarrasFueAutogenerado = codigoBarras === null
        if (!esServicio && codigoBarras === null) {
            codigoBarras = await generarCodigoBarrasAutomatico(empresaId, prisma)
        }

        // Validar duplicado de codigoInterno
        const existente = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId, codigoInterno } } })
        if (existente) {
            return res.status(409).json({ success: false, error: 'El código interno ya existe en esta empresa', campo: 'codigoInterno' })
        }

        // Validar duplicado de codigoBarras
        if (codigoBarras !== null) {
            const dupBarras = await validarCodigoBarrasDuplicado({ empresaId, codigoBarras, prismaClient: prisma })
            if (dupBarras) {
                return res.status(409).json({ success: false, error: 'El código de barras ya existe en esta empresa', campo: 'codigoBarras' })
            }
        }

        // Factor de conversión: el form envía precio por caja; Producto.costo es por pieza
        const factorRaw    = factorConversion ? parseFloat(factorConversion) : 1
        const safeFactor   = esServicio ? 1 : ((Number.isFinite(factorRaw) && factorRaw > 0) ? factorRaw : 1)
        const costoUnitVta = costo ? parseFloat((parseFloat(costo) / safeFactor).toFixed(4)) : null
        const precioVtaNum = precioVenta ? parseFloat(precioVenta) : null
        const margenProd   = (costoUnitVta && costoUnitVta > 0 && precioVtaNum && precioVtaNum > 0)
            ? parseFloat(Math.min(((precioVtaNum / costoUnitVta - 1) * 100), 999.99).toFixed(2))
            : null

        const producto = await prisma.producto.create({
            data: {
                empresaId,
                nombre,
                codigoInterno,
                codigoBarras:        codigoBarras     || null,
                descripcion:         descripcion      || null,
                costo:               costoUnitVta,
                costoPromedio:       esServicio ? null : costoUnitVta,
                margen:              margenProd,
                precioBase:          parseFloat(precioBase),
                precioVenta:         precioVenta ? parseFloat(precioVenta) : null,
                categoriaId:         parseInt(categoriaId),
                unidadCompra:        esServicio ? null : (unidadCompra || null),
                unidadVenta:         unidadVenta      || null,
                factorConversion:    esServicio ? null : (factorConversion ? parseFloat(factorConversion) : null),
                claveSat:            claveSat         || null,
                unidadSat:           unidadSat        || null,
                tipoFacturaProv:     tipoFacturaProv  || 'NETO',
                costoSinIvaProveedor: costoSinIvaProveedor ? parseFloat(costoSinIvaProveedor) : null,
                esGranel:            esServicio ? false : (esGranel === true || esGranel === 'true'),
                tipo:                tipoFinal,
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
        console.error('❌ Error creando producto:', error)
        const prismaErr = parsearErrorPrismaProducto(error)
        if (prismaErr) {
            return res.status(prismaErr.status).json({ success: false, error: prismaErr.error })
        }
        res.status(400).json({ success: false, error: 'No se pudo guardar el producto. Revisa los datos e intenta de nuevo.' })
    }
}

// ═══════════════════════════════════════════════════════════════════
//  UNIDADES DE VENTA — catálogo operativo (inline hasta P1)
// ═══════════════════════════════════════════════════════════════════

const UNIDADES_VENTA_VALIDAS = new Set([
  'PZA', 'MT', 'CM', 'KG', 'G', 'LT', 'ML', 'M2', 'M3',
  'PAQUETE', 'PAR', 'KIT', 'JUEGO', 'CAJA', 'ROLLO', 'BOLSA',
  'BULTO', 'SACO', 'BOTE', 'CUBETA', 'BOTELLA', 'LATA',
  'TAMBOR', 'TRAMO', 'DOCENA', 'VIAJE',
])

const ALIASES_UNIDAD_VENTA = {
  PZ: 'PZA', PZAS: 'PZA', PIEZA: 'PZA', PIEZAS: 'PZA',
  M: 'MT', MTS: 'MT', METRO: 'MT', METROS: 'MT',
  CM: 'CM', CENTIMETRO: 'CM', CENTIMETROS: 'CM',
  KG: 'KG', KILO: 'KG', KILOS: 'KG',
  G: 'G', GR: 'G', GRAMO: 'G',
  L: 'LT', LTS: 'LT', LITRO: 'LT', LITROS: 'LT',
  ML: 'ML', MILILITRO: 'ML', MILILITROS: 'ML',
  M2: 'M2', M3: 'M3', M: 'M',
  PAQ: 'PAQUETE', PACK: 'PAQUETE',
  PR: 'PAR', PARES: 'PAR',
  VJE: 'VIAJE', VIAJES: 'VIAJE',
  SACO: 'SACO', SACOS: 'SACO',
  BOTE: 'BOTE', BOTES: 'BOTE',
}

const UNIDADES_COMPRA_VALIDAS = new Set([
  'PZA', 'CAJA', 'BULTO', 'ROLLO', 'PAQUETE', 'MT', 'KG', 'LT',
  'TAMBOR', 'CILINDRO', 'CUBETA', 'LATA', 'BOLSA', 'BOTELLA',
  'PAR', 'KIT', 'JUEGO', 'SACO', 'TRAMO', 'DOCENA', 'VIAJE',
])

function esUnidadVentaValida(valor, esServicio) {
  if (esServicio) return valor === null || valor === undefined
  if (valor === null || valor === undefined) return false
  if (typeof valor !== 'string') return false
  const t = valor.trim().toUpperCase()
  if (t === '') return false
  if (UNIDADES_VENTA_VALIDAS.has(t)) return true
  return t in ALIASES_UNIDAD_VENTA
}

function normalizarUnidadVenta(valor, esServicio) {
  if (esServicio) return valor || null
  if (valor === null || valor === undefined) return null
  if (typeof valor !== 'string') return null
  const t = valor.trim().toUpperCase()
  if (t === '') return null
  if (UNIDADES_VENTA_VALIDAS.has(t)) return t
  return ALIASES_UNIDAD_VENTA[t] || null
}

function esUnidadCompraValida(valor, esServicio) {
  if (esServicio) return valor === null || valor === undefined
  if (valor === null || valor === undefined) return true
  if (typeof valor !== 'string') return false
  const t = valor.trim().toUpperCase()
  if (t === '') return false
  if (UNIDADES_COMPRA_VALIDAS.has(t)) return true
  return t in ALIASES_UNIDAD_VENTA
}

function normalizarUnidadCompra(valor, esServicio) {
  if (esServicio) return valor || null
  if (valor === null || valor === undefined) return null
  if (typeof valor !== 'string') return null
  const t = valor.trim().toUpperCase()
  if (t === '') return null
  if (UNIDADES_COMPRA_VALIDAS.has(t)) return t
  return ALIASES_UNIDAD_VENTA[t] || null
}

// ═══════════════════════════════════════════════════════════════════
// EDITAR
// ═══════════════════════════════════════════════════════════════════

async function editar(req, res) {
    try {
        const { id } = req.params
        let {
            nombre, codigoInterno, codigoBarras, descripcion,
            costo, precioBase, precioVenta, categoriaId,
            unidadCompra, unidadVenta, factorConversion,
            claveSat, unidadSat, proveedorId,
            tipoFacturaProv, costoSinIvaProveedor,
            esGranel, tipo
        } = req.body

        codigoBarras = normalizarCodigoBarras(codigoBarras)
        codigoInterno = normalizarCodigoInterno(codigoInterno)

        if (!nombre || !codigoInterno || !categoriaId || !precioBase) {
            const faltantes = []
            if (!nombre) faltantes.push('nombre')
            if (!codigoInterno) faltantes.push('codigoInterno')
            if (!categoriaId) faltantes.push('categoriaId')
            if (!precioBase) faltantes.push('precioBase')
            return res.status(400).json({
                success: false,
                error: `Faltan campos requeridos: ${faltantes.join(', ')}`
            })
        }

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

        if (tipo && tipo !== existente.tipo) {
            return res.status(400).json({ success: false, error: 'El tipo no se puede cambiar después de crear el producto. Crea uno nuevo.', campo: 'tipo' })
        }
        const esServ = existente.tipo === 'SERVICIO'

        let claveSatFinal  = ('claveSat'  in req.body) ? (claveSat  || null) : existente.claveSat
        let unidadSatFinal = ('unidadSat' in req.body) ? (unidadSat || null) : existente.unidadSat
        if (esServ) {
            claveSatFinal  = claveSatFinal  || '78101800'
            unidadSatFinal = unidadSatFinal || 'E48'
        }

        const validacionSat = validarSatCatalogo(claveSatFinal, unidadSatFinal)
        if (!validacionSat.ok) {
            return res.status(400).json({ success: false, error: validacionSat.error, campo: validacionSat.campo })
        }
        claveSatFinal = validacionSat.claveSat
        unidadSatFinal = validacionSat.unidadSat

        // ── Construir data CONDICIONALMENTE ──
        const has = Object.prototype.hasOwnProperty.bind(req.body)
        const data = {}

        // Siempre presentes (campos requeridos del form)
        data.nombre = nombre
        data.codigoInterno = codigoInterno
        data.categoriaId = parseInt(categoriaId)
        data.precioBase = parseFloat(precioBase)
        data.claveSat = claveSatFinal
        data.unidadSat = unidadSatFinal

        // codigoBarras — omitido → preservar
        if (has('codigoBarras')) {
            data.codigoBarras = codigoBarras
        }

        // descripcion — omitido → preservar
        if (has('descripcion')) {
            data.descripcion = descripcion || null
        }

        // precioVenta — null explícito → null; omitido → preservar
        if (has('precioVenta')) {
            data.precioVenta = (precioVenta !== null && precioVenta !== undefined && precioVenta !== '')
                ? parseFloat(precioVenta) : null
        }

        // Factor de conversión para recálculo de costo unitario
        const fc = has('factorConversion') ? factorConversion : existente.factorConversion
        const sf = esServ ? 1 : ((Number.isFinite(parseFloat(fc)) && parseFloat(fc) > 0) ? parseFloat(fc) : 1)

        // costo — omitido → preservar; presente → recalcula unitario
        if (has('costo')) {
            data.costo = costo ? parseFloat((parseFloat(costo) / sf).toFixed(4)) : null
        }

        // Margen — recalcular si cambiaron costo, precioVenta o factorConversion
        const costoUsar = has('costo') ? data.costo : existente.costo
        const pvUsar = has('precioVenta')
            ? ((precioVenta !== null && precioVenta !== undefined && precioVenta !== '') ? parseFloat(precioVenta) : null)
            : existente.precioVenta
        if (has('costo') || has('precioVenta') || has('factorConversion')) {
            if (costoUsar && costoUsar > 0 && pvUsar && pvUsar > 0) {
                data.margen = parseFloat(Math.min(((pvUsar / costoUsar - 1) * 100), 999.99).toFixed(2))
            } else {
                data.margen = null
            }
        }

        // ── Validar duplicado de codigoBarras si cambió ──
        if (has('codigoBarras') && codigoBarras !== null && codigoBarras !== existente.codigoBarras) {
            const empresaProducto = existente.empresaId
            const dupBarras = await validarCodigoBarrasDuplicado({ empresaId: empresaProducto, codigoBarras, excluirId: parseInt(id), prismaClient: prisma })
            if (dupBarras) {
                return res.status(409).json({ success: false, error: 'El código de barras ya existe en esta empresa', campo: 'codigoBarras' })
            }
        }

        // ── Validar y asignar unidadVenta ──
        if (has('unidadVenta')) {
            const raw = req.body.unidadVenta
            if (esServ) {
                data.unidadVenta = raw === null || raw === undefined ? null : (normalizarUnidadVenta(raw, true) || raw || null)
            } else {
                if (raw === null || raw === undefined) {
                    return res.status(400).json({ success: false, error: 'unidadVenta no puede ser null para productos físicos', campo: 'unidadVenta' })
                }
                if (typeof raw === 'string' && raw.trim() === '') {
                    return res.status(400).json({ success: false, error: 'unidadVenta no puede estar vacía para productos físicos', campo: 'unidadVenta' })
                }
                const normalizada = normalizarUnidadVenta(raw, false)
                if (!normalizada) {
                    return res.status(400).json({ success: false, error: `Unidad de venta no válida: "${raw}". Usa una del catálogo.`, campo: 'unidadVenta' })
                }
                data.unidadVenta = normalizada
            }
        }

        // ── Validar y asignar unidadCompra ──
        if (has('unidadCompra')) {
            const raw = req.body.unidadCompra
            if (esServ) {
                data.unidadCompra = raw === null || raw === undefined ? null : (normalizarUnidadCompra(raw, true) || raw || null)
            } else {
                if (raw === null || raw === undefined) {
                    data.unidadCompra = null
                } else if (typeof raw === 'string' && raw.trim() === '') {
                    return res.status(400).json({ success: false, error: 'unidadCompra no puede estar vacía para productos físicos', campo: 'unidadCompra' })
                } else {
                    const normalizada = normalizarUnidadCompra(raw, false)
                    if (!normalizada) {
                        return res.status(400).json({ success: false, error: `Unidad de compra no válida: "${raw}".`, campo: 'unidadCompra' })
                    }
                    data.unidadCompra = normalizada
                }
            }
        }

        // ── Validar y asignar factorConversion — omitido → preservar ──
        if (has('factorConversion')) {
            const raw = req.body.factorConversion
            if (esServ || raw === null || raw === undefined) {
                data.factorConversion = null
            } else if (raw === '' || raw === 0) {
                data.factorConversion = null
            } else {
                const parsed = parseFloat(raw)
                if (!Number.isFinite(parsed) || parsed < 0) {
                    return res.status(400).json({ success: false, error: 'factorConversion debe ser un número positivo', campo: 'factorConversion' })
                }
                data.factorConversion = parsed
            }
        }

        // ── Validar y asignar esGranel — omitido → preservar ──
        if (has('esGranel')) {
            data.esGranel = esServ ? false : (esGranel === true || esGranel === 'true')
        }

        // ── tipoFacturaProv — omitido → preservar ──
        if (has('tipoFacturaProv')) {
            data.tipoFacturaProv = tipoFacturaProv || null
        }

        // ── costoSinIvaProveedor — omitido → preservar ──
        if (has('costoSinIvaProveedor')) {
            data.costoSinIvaProveedor = costoSinIvaProveedor ? parseFloat(costoSinIvaProveedor) : null
        }

        const producto = await prisma.producto.update({
            where: { id: parseInt(id) },
            data,
            include: {
                Categoria: { include: { Departamento: true } },
                InventarioSucursal: { where: { sucursalId: 1 }, take: 1 }
            }
        })

        if (proveedorId && proveedorId !== '' && proveedorId !== 'null') {
            const ppProveedorId = parseInt(proveedorId)
            const ppProductoId  = parseInt(id)
            await prisma.proveedorProducto.upsert({
                where:  { proveedorId_productoId: { proveedorId: ppProveedorId, productoId: ppProductoId } },
                update: { precioCosto: costo ? parseFloat(costo) : 0, activo: true, actualizadoEn: new Date() },
                create: { proveedorId: ppProveedorId, productoId: ppProductoId, precioCosto: costo ? parseFloat(costo) : 0, activo: true }
            })
        }

        res.json({
            success: true,
            data: {
                ...producto,
                inventario: producto.InventarioSucursal?.length > 0 ? producto.InventarioSucursal[0] : null
            }
        })
    } catch (error) {
        console.error('❌ Error editando producto:', error)
        const prismaErr = parsearErrorPrismaProducto(error)
        if (prismaErr) {
            return res.status(prismaErr.status).json({ success: false, error: prismaErr.error })
        }
        res.status(400).json({ success: false, error: 'No se pudo guardar el producto. Revisa los datos e intenta de nuevo.' })
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
    const rolesPermitidos = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN']
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

    // Verificar stock post-operación (no bloqueante)
    let stockAlerts = []
    try {
      stockAlerts = await verificarStockPostOperacion(prisma, empresaId, sucursalId, [parseInt(id)])
    } catch (err) {
      console.warn('⚠️ Error verificando stock post-ajuste inventario:', err.message)
    }

    res.json({
      success: true,
      mensaje: 'Inventario actualizado correctamente',
      stockAlerts,
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
        const codigoInterno = normalizarCodigoInterno(req.body.codigoInterno)
        const codigoBarras  = normalizarCodigoBarras(req.body.codigoBarras)

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

        // Validar duplicado de codigoInterno
        const dupInterno = await prisma.producto.findFirst({
            where: { empresaId: empresaProducto, codigoInterno, id: { not: id } },
            select: { id: true }
        })
        if (dupInterno) {
            return res.status(409).json({ success: false, error: 'El código interno ya existe en esta empresa', campo: 'codigoInterno' })
        }

        // Validar duplicado de codigoBarras
        if (codigoBarras !== null) {
            const dupBarras = await validarCodigoBarrasDuplicado({ empresaId: empresaProducto, codigoBarras, excluirId: id, prismaClient: prisma })
            if (dupBarras) {
                return res.status(409).json({ success: false, error: 'El código de barras ya existe en esta empresa', campo: 'codigoBarras' })
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
        console.error('❌ Error editando datos básicos:', error)
        const prismaErr = parsearErrorPrismaProducto(error)
        if (prismaErr) {
            return res.status(prismaErr.status).json({ success: false, error: prismaErr.error })
        }
        return res.status(400).json({ success: false, error: 'No se pudo guardar el producto. Revisa los datos e intenta de nuevo.' })
    }
}

// ═══════════════════════════════════════════════════════════════════
// SUGERIR NOMBRES — Autocomplete ligero para el buscador
// ═══════════════════════════════════════════════════════════════════

const sugerirNombres = async (req, res) => {
    try {
        const empresaId = getEmpresaId(req)
        const { q, proveedorId, categoriaId, departamentoId, stock, tipo, activo } = req.query
        if (!q || q.trim().length < 2) {
            return res.json({ success: true, data: [] })
        }
        const busqueda = q.trim()
        const sucursalIdInt = parseInt(req.usuario?.sucursalId) || 0

        const where = { empresaId }

        if (activo === 'all') {
            // no filter
        } else if (activo !== undefined) {
            where.activo = activo === 'true'
        } else {
            where.activo = true
        }

        if (proveedorId) {
            where.ProveedorProducto = { some: { proveedorId: parseInt(proveedorId), activo: true } }
        }

        if (departamentoId) {
            where.Categoria = { Departamento: { id: parseInt(departamentoId) } }
        }

        if (categoriaId) {
            where.categoriaId = parseInt(categoriaId)
        }

        if (tipo && ['PRODUCTO', 'SERVICIO'].includes(tipo)) {
            where.tipo = tipo
        }

        if (stock === 'con') {
            where.InventarioSucursal = { some: { sucursalId: sucursalIdInt, stockActual: { gt: 0 } } }
        } else if (stock === 'sin') {
            where.InventarioSucursal = { none: { sucursalId: sucursalIdInt, stockActual: { gt: 0 } } }
        }

        const palabras = busqueda.split(/\s+/).filter(Boolean)
        const condicionesTexto = palabras.map(p => ({
            OR: [
                { nombre:        { contains: p, mode: 'insensitive' } },
                { codigoInterno: { contains: p, mode: 'insensitive' } },
                { codigoBarras:  { contains: p, mode: 'insensitive' } }
            ]
        }))
        where.AND = [
            ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
            ...condicionesTexto
        ]

        const productos = await prisma.producto.findMany({
            where,
            select: {
                id: true,
                nombre: true,
                codigoInterno: true,
                precioVenta: true,
                unidadVenta: true,
                InventarioSucursal: { where: { sucursalId: sucursalIdInt }, take: 1, select: { stockActual: true } }
            },
            take: 15,
            orderBy: { nombre: 'asc' }
        })
        const data = productos.map(p => ({
            id: p.id,
            nombre: p.nombre,
            codigoInterno: p.codigoInterno,
            precioVenta: p.precioVenta ? parseFloat(p.precioVenta) : 0,
            stock: p.InventarioSucursal?.[0]?.stockActual !== undefined ? parseFloat(p.InventarioSucursal[0].stockActual) : 0,
            unidadVenta: p.unidadVenta
        }))
        res.json({ success: true, data })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
}

// ═══════════════════════════════════════════════════════════════════
// DUPLICAR PRODUCTO
// ═══════════════════════════════════════════════════════════════════

const duplicarProducto = async (req, res) => {
    try {
        const empresaId = getEmpresaId(req)
        const id = parseInt(req.params.id)
        if (!id) return res.status(400).json({ success: false, error: 'ID requerido' })

        const { codigoInterno, codigoBarras, precioVenta, precioBase, costo, costoPromedio } = req.body

        if (!codigoInterno || !codigoInterno.trim()) {
            return res.status(400).json({ success: false, error: 'Código interno requerido' })
        }

        const original = await prisma.producto.findUnique({ where: { id }, include: { Categoria: true } })
        if (!original) return res.status(404).json({ success: false, error: 'Producto original no encontrado' })

        const codigoInternoLimpio = normalizarCodigoInterno(codigoInterno)
        const codigoBarrasLimpio = codigoBarras ? normalizarCodigoBarras(codigoBarras) : null

        const dupInterno = await prisma.producto.findFirst({
            where: { empresaId, codigoInterno: codigoInternoLimpio }
        })
        if (dupInterno) {
            return res.status(409).json({ success: false, error: 'El código interno ya existe en esta empresa', campo: 'codigoInterno' })
        }

        if (codigoBarrasLimpio) {
            const dupBarras = await validarCodigoBarrasDuplicado({ empresaId, codigoBarras: codigoBarrasLimpio, prismaClient: prisma })
            if (dupBarras) {
                return res.status(409).json({ success: false, error: 'El código de barras ya existe en esta empresa', campo: 'codigoBarras' })
            }
        }

        const precioVentaNum = precioVenta !== undefined && precioVenta !== null ? parseFloat(precioVenta) : parseFloat(original.precioVenta)
        const precioBaseNum = precioBase !== undefined && precioBase !== null ? parseFloat(precioBase) : parseFloat(original.precioBase || 0)
        const costoNum = costo !== undefined && costo !== null ? parseFloat(costo) : null
        const costoPromedioNum = costoPromedio !== undefined && costoPromedio !== null
            ? parseFloat(costoPromedio)
            : (costoNum !== null ? costoNum : null)

        const resultado = await prisma.$transaction(async (tx) => {
            const nuevo = await tx.producto.create({
                data: {
                    empresaId,
                    nombre:               original.nombre,
                    codigoInterno:         codigoInternoLimpio,
                    codigoBarras:          codigoBarrasLimpio,
                    descripcion:           original.descripcion,
                    categoriaId:           original.categoriaId,
                    unidadCompra:          original.unidadCompra,
                    unidadVenta:           original.unidadVenta,
                    factorConversion:      original.factorConversion || 1,
                    precioBase:            precioBaseNum,
                    precioVenta:           precioVentaNum,
                    costo:                 costoNum,
                    costoPromedio:         costoPromedioNum,
                    claveSat:              original.claveSat,
                    unidadSat:             original.unidadSat,
                    esGranel:              original.esGranel,
                    esServicio:            original.esServicio,
                    activo:                true,
                    stockMinimoAlerta:     original.stockMinimoAlerta,
                    tipo:                  original.tipo,
                    tipoCfdi:              original.tipoCfdi,
                    tipoFacturaProv:       original.tipoFacturaProv,
                    ieps:                  original.ieps,
                    tazaIeps:              original.tazaIeps,
                    margen:                original.margen !== null ? original.margen : null
                }
            })

            await tx.auditoria.create({
                data: {
                    accion: 'DUPLICAR_PRODUCTO',
                    modulo: 'PRODUCTOS',
                    referencia: `Original: ${original.codigoInterno} → Nuevo: ${codigoInternoLimpio}`,
                    usuarioId: req.usuario?.id ? parseInt(req.usuario.id) : null,
                    sucursalId: req.usuario?.sucursalId ? parseInt(req.usuario.sucursalId) : null
                }
            })

            return nuevo
        })

        res.status(201).json({ success: true, data: resultado })
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(409).json({ success: false, error: 'El código interno ya existe en esta empresa (conflicto concurrente)', campo: 'codigoInterno' })
        }
        res.status(500).json({ success: false, error: err.message })
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
    editarDatosBasicos,
    sugerirNombres,
    duplicarProducto
}
