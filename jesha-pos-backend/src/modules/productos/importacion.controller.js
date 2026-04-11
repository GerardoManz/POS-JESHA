// ═══════════════════════════════════════════════════════════════════
// IMPORTACION.CONTROLLER.JS — CORREGIDO
// Recibe archivo CSV via multer, parsea, valida y hace upsert
// ═══════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// ═══════════════════════════════════════════════════════════════════
// UTILIDADES DE PARSEO CSV
// ═══════════════════════════════════════════════════════════════════

/**
 * Parsea una línea CSV respetando entrecomillado y comillas escapadas ("")
 * Maneja correctamente: "Espatula 5"" PRETUL" → Espatula 5" PRETUL
 */
function parseCSVLine(line) {
    const result = []
    let current = ''
    let insideQuotes = false

    for (let i = 0; i < line.length; i++) {
        const char = line[i]
        const next = line[i + 1]

        if (char === '"') {
            if (insideQuotes && next === '"') {
                current += '"'
                i++ // saltar la segunda comilla
            } else {
                insideQuotes = !insideQuotes
            }
        } else if (char === ',' && !insideQuotes) {
            result.push(current.trim())
            current = ''
        } else {
            current += char
        }
    }
    result.push(current.trim())
    return result
}

/**
 * Parsea buffer CSV completo → array de objetos {header: valor}
 */
function parsearCSVBuffer(buffer) {
    const texto = buffer.toString('utf-8')
    const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

    // Buscar header (primera línea no vacía)
    let headerIdx = 0
    while (headerIdx < lineas.length && !lineas[headerIdx].trim()) {
        headerIdx++
    }

    const headers = parseCSVLine(lineas[headerIdx])
    const filas = []

    for (let i = headerIdx + 1; i < lineas.length; i++) {
        const linea = lineas[i].trim()
        if (!linea) continue

        const valores = parseCSVLine(linea)
        const obj = {}
        headers.forEach((h, idx) => {
            let val = (valores[idx] || '').trim()
            if (val.toLowerCase() === 'null' || val === '') {
                val = null
            }
            obj[h] = val
        })

        // Solo incluir filas que tengan CLAVE
        if (obj['CLAVE']) {
            filas.push(obj)
        }
    }

    return { headers, filas }
}

// ═══════════════════════════════════════════════════════════════════
// VALIDACIONES
// ═══════════════════════════════════════════════════════════════════

function esNotacionCientifica(valor) {
    if (!valor) return false
    return /^[\d.]+[eE]\+\d+$/.test(valor.trim())
}

function validarFila(fila, idx) {
    const errores = []
    const clave = fila['CLAVE']
    const desc = fila['DESCRIPCION']
    const precio = fila['PRECIO 1']

    if (!clave) {
        errores.push({ fila: idx, error: 'CLAVE vacía' })
    } else if (esNotacionCientifica(clave)) {
        errores.push({ fila: idx, clave, error: `CLAVE en notación científica: "${clave}" — Excel corrompió este dato` })
    }

    if (!desc) {
        errores.push({ fila: idx, clave, error: 'DESCRIPCION vacía' })
    }

    const precioNum = parseFloat(precio)
    if (!precio || isNaN(precioNum) || precioNum <= 0) {
        errores.push({ fila: idx, clave, error: `PRECIO 1 inválido: "${precio}"` })
    }

    return errores
}

// ═══════════════════════════════════════════════════════════════════
// MAPEO CSV → PRISMA
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// INFERIR UNIDAD DE VENTA desde descripción del producto
// ═══════════════════════════════════════════════════════════════════

function inferirUnidadVenta(descripcion, esGranel) {
    if (!esGranel) return null
    const desc = (descripcion || '').toUpperCase()

    if (/X METRO|XM$|POR METRO|X MTS| XM |X M /.test(desc))  return 'm'
    if (/X KG|X KILO|POR KG|POR KILO|X GR|POR GR/.test(desc)) return 'kg'
    if (/POR LITRO|X LITRO|X LT/.test(desc))                   return 'l'
    if (/METRO CUBICO|METRO CÚB/.test(desc))                   return 'm³'
    if (/VIAJE/.test(desc))                                     return 'vje'
    if (/ROLLO/.test(desc))                                     return 'rollo'
    if (/BOTE/.test(desc))                                      return 'bote'

    return 'pza' // default para granel sin unidad clara
}

// ═══════════════════════════════════════════════════════════════════
// NORMALIZAR NOMBRE DE PROVEEDOR
// Limpia: trim, mayúsculas, sin acentos, sin comillas, espacios simples
// ═══════════════════════════════════════════════════════════════════

function normalizarNombreProveedor(nombre) {
    if (!nombre) return null
    const result = nombre
        .trim()
        .toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
        .replace(/["""'']/g, '')                           // quitar comillas
        .replace(/\s+/g, ' ')                              // colapsar espacios
        .trim()
    return result || null
}

function mapearProducto(fila) {
    let codigoBarras = fila['CLAVE ALTERNA'] || null
    if (codigoBarras && esNotacionCientifica(codigoBarras)) {
        codigoBarras = null
    }
    // FIX: limpiar comillas residuales y forzar null si vacío
    if (codigoBarras) {
        codigoBarras = codigoBarras.replace(/^[\"']+|[\"']+$/g, '').trim()
        if (!codigoBarras) codigoBarras = null
    }

    // Stock inicial y mínimo desde el CSV
    const stockInicial = parseInt(fila['EXIST.']) || 0
    const stockMinimo  = parseInt(fila['INV_MIN']) || 5
    const stockMaximo  = parseInt(fila['INV_MAX']) || null
    const esGranel     = (fila['GRANEL (S/N)'] || '').toUpperCase().trim() === 'S'

    // TIPO DE GRANEL tiene prioridad sobre inferirUnidadVenta si viene con valor
    const MAPA_UNIDADES = {
        'kg': 'kg', 'kilo': 'kg', 'kilos': 'kg', 'k': 'kg',
        'm': 'm', 'metro': 'm', 'metros': 'm', 'mts': 'm', 'mt': 'm',
        'l': 'l', 'litro': 'l', 'litros': 'l', 'lt': 'l',
        'g': 'g', 'gramo': 'g', 'gramos': 'g',
        'rollo': 'rollo', 'bote': 'bote', 'pza': 'pza', 'pieza': 'pza'
    }
    const tipoGranelCSV = (fila['TIPO DE GRANEL'] || '').trim().toLowerCase()
    const unidadVenta   = esGranel && tipoGranelCSV
        ? (MAPA_UNIDADES[tipoGranelCSV] || tipoGranelCSV)
        : inferirUnidadVenta(fila['DESCRIPCION'], esGranel)

    // Proveedor — se normaliza y se pasa como campo auxiliar
    const _proveedorNombre = normalizarNombreProveedor(fila['PROVEEDOR'])
    const _proveedorApodo = (fila['APODO_PROVEEDOR'] || '').trim() || null

    return {
        codigoInterno: fila['CLAVE'].trim().replace(/\s+0:00:00$/, '').replace(/^[\"']+|[\"']+$/g, ''),
        codigoBarras,
        nombre: (fila['DESCRIPCION'] || '').trim(),
        descripcion: fila['CARACTERISTICAS'] || null,
        precioBase:  parseFloat(fila['PRECIO 1']) || 0,
        precioVenta: fila['PRECIO_VENTA'] ? parseFloat(fila['PRECIO_VENTA']) : null,
        costo:       fila['PRECIO COMPRA'] ? parseFloat(fila['PRECIO COMPRA']) : null,
        claveSat:  fila['CLAVE SAT']  || null,
        unidadSat: fila['UNIDAD SAT'] || null,
        esGranel,
        unidadVenta,
        activo: true,
        // Campos auxiliares — no van a BD directamente
        _stockInicial:     stockInicial,
        _stockMinimo:      stockMinimo,
        _stockMaximo:      stockMaximo,
        _proveedorNombre,  // nombre normalizado para buscar/crear en ProveedorProducto
        _proveedorApodo,   // apodo del proveedor desde CSV
    }
}

// ═══════════════════════════════════════════════════════════════════
// PRE-CREAR DEPARTAMENTOS Y CATEGORÍAS (secuencial, sin race condition)
// Se ejecuta UNA VEZ antes de insertar productos
// ═══════════════════════════════════════════════════════════════════

async function preSeedDepartamentosYCategorias(filas) {
    // 1. Extraer combinaciones únicas depto|cat del CSV
    const combos = new Set()
    for (const fila of filas) {
        const depto = (fila['DEPARTAMENTO'] || '').toUpperCase().trim()
        const cat = (fila['CATEGORIA'] || '').trim()
        if (depto && cat) {
            combos.add(`${depto}|${cat}`)
        }
    }

    console.log(`📂 Pre-creando ${combos.size} combinaciones depto/categoría...`)

    const cacheDeptos = new Map()  // nombre → id
    const cacheCats = new Map()    // "DEPTO|cat" → id

    // 2. Procesar en secuencia (sin paralelo = sin race condition)
    for (const combo of combos) {
        const [nombreDepto, nombreCat] = combo.split('|')

        // ── Departamento ──
        let deptoId = cacheDeptos.get(nombreDepto)
        if (!deptoId) {
            let depto = await prisma.departamento.findFirst({
                where: { nombre: { equals: nombreDepto, mode: 'insensitive' } }
            })
            if (!depto) {
                depto = await prisma.departamento.create({
                    data: { nombre: nombreDepto, activo: true }
                })
                console.log(`   + Departamento creado: ${nombreDepto}`)
            }
            deptoId = depto.id
            cacheDeptos.set(nombreDepto, deptoId)
        }

        // ── Categoría ──
        const keyCat = combo
        if (!cacheCats.has(keyCat)) {
            let cat = await prisma.categoria.findFirst({
                where: {
                    departamentoId: deptoId,
                    nombre: { equals: nombreCat, mode: 'insensitive' }
                }
            })
            if (!cat) {
                cat = await prisma.categoria.create({
                    data: { nombre: nombreCat, departamentoId: deptoId }
                })
                console.log(`   + Categoría creada: ${nombreDepto} → ${nombreCat}`)
            }
            cacheCats.set(keyCat, cat.id)
        }
    }

    console.log(`✅ Departamentos y categorías listos`)
    return cacheCats  // devuelve el mapa "DEPTO|cat" → categoriaId
}

// ═══════════════════════════════════════════════════════════════════
// PRE-CREAR PROVEEDORES (Opción A: auto-crear si no existe)
// ═══════════════════════════════════════════════════════════════════

async function preSeedProveedores(filas) {
    // 1. Extraer nombres y apodos únicos normalizados del CSV
    const proveedoresMap = new Map() // nombre → apodo
    for (const fila of filas) {
        const nombre = normalizarNombreProveedor(fila['PROVEEDOR'])
        const apodo = (fila['APODO_PROVEEDOR'] || '').trim() || null
        if (nombre) {
            proveedoresMap.set(nombre, apodo)
        }
    }

    if (proveedoresMap.size === 0) {
        console.log('ℹ️  Sin proveedores en el CSV')
        return new Map()
    }

    console.log(`🏭 Procesando ${proveedoresMap.size} proveedores únicos del CSV...`)

    // 2. Cargar todos los proveedores existentes en BD
    const todosEnBD = await prisma.proveedor.findMany({
        where: { activo: true },
        select: { id: true, nombreOficial: true, alias: true }
    })

    // 3. Construir mapa nombre_normalizado → id (busca en alias Y nombreOficial)
    const cacheProveedores = new Map()
    for (const p of todosEnBD) {
        const normOficial = normalizarNombreProveedor(p.nombreOficial)
        const normAlias   = normalizarNombreProveedor(p.alias)
        if (normOficial) cacheProveedores.set(normOficial, p.id)
        if (normAlias)   cacheProveedores.set(normAlias,   p.id)
    }

    // 4. Crear los que no existen
    for (const [nombre, apodo] of proveedoresMap) {
        if (cacheProveedores.has(nombre)) continue
        try {
            const prov = await prisma.proveedor.create({
                data: { 
                    nombreOficial: nombre, 
                    alias: apodo || nombre,  // ← Usa apodo del CSV si existe, sino usa nombreOficial
                    activo: true 
                }
            })
            cacheProveedores.set(nombre, prov.id)
            console.log(`   + Proveedor: ${nombre} (apodo: ${apodo || nombre})`)
        } catch (err) {
            if (err.code === 'P2002') {
                // Ya existe con ese nombre — recargar y mapear
                const existente = await prisma.proveedor.findFirst({
                    where: {
                        OR: [
                            { nombreOficial: { equals: nombre, mode: 'insensitive' } },
                            { alias:         { equals: nombre, mode: 'insensitive' } }
                        ]
                    }
                })
                if (existente) cacheProveedores.set(nombre, existente.id)
            } else {
                console.warn(`   ⚠️  No se pudo crear proveedor "${nombre}": ${err.message}`)
            }
        }
    }

    console.log(`✅ Proveedores listos (${cacheProveedores.size} en cache)`)
    return cacheProveedores
}

/**
 * Busca categoriaId en el cache ya poblado (sin queries, sin race condition)
 */
async function obtenerCategoriaFallback() {
    const primera = await prisma.categoria.findFirst({ orderBy: { id: 'asc' }, select: { id: true } })
    return primera ? primera.id : null
}

function obtenerCategoriaIdDelCache(cacheCats, nombreDepto, nombreCat, fallbackId) {
    if (!nombreDepto || !nombreCat) return fallbackId

    const key = `${nombreDepto.toUpperCase().trim()}|${nombreCat.trim()}`
    return cacheCats.get(key) || fallbackId
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL — IMPORTAR CSV (recibe archivo via multer)
// ═══════════════════════════════════════════════════════════════════

exports.importarCSV = async (req, res) => {
    try {
        // ── Validar que llegó un archivo ──
        if (!req.file) {
            return res.status(400).json({
                error: 'Archivo CSV requerido. Envía el archivo con campo "archivo".',
                total: 0, creados: 0, errores: 0
            })
        }

        console.log(`📦 Archivo recibido: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`)

        // ── Parsear CSV del buffer ──
        const { headers, filas } = parsearCSVBuffer(req.file.buffer)

        console.log(`📋 Headers: ${headers.join(', ')}`)
        console.log(`📊 Filas con datos: ${filas.length}`)

        if (filas.length === 0) {
            return res.status(400).json({
                error: 'CSV vacío o sin datos válidos',
                total: 0, creados: 0, errores: 0
            })
        }

        // ── Validar TODAS las filas primero ──
        const erroresValidacion = []
        const filasValidas = []

        for (let i = 0; i < filas.length; i++) {
            const errs = validarFila(filas[i], i + 2) // +2 porque fila 1 es header
            if (errs.length > 0) {
                erroresValidacion.push(...errs)
            } else {
                filasValidas.push(filas[i])
            }
        }

        console.log(`✅ Filas válidas: ${filasValidas.length}`)
        console.log(`⚠️  Filas con error: ${erroresValidacion.length}`)

        // ── Pre-crear departamentos y categorías (secuencial, sin race condition) ──
        const cacheCats = await preSeedDepartamentosYCategorias(filasValidas)

        // ── Pre-crear proveedores (auto-crear si no existe) ──
        const cacheProveedores = await preSeedProveedores(filasValidas)

        // ── Obtener categoría fallback (primera existente en BD) ──
        const categoriaFallbackId = await obtenerCategoriaFallback()
        if (!categoriaFallbackId) {
            return res.status(400).json({
                error: 'No hay categorías en la base de datos. Crea al menos una categoría primero.',
                total: 0, creados: 0, errores: 0
            })
        }
        console.log(`📁 Categoría fallback: id=${categoriaFallbackId}`)

        // ── Procesar productos en lotes ──
        let creados = 0
        let actualizados = 0
        let vinculaciones = 0
        const erroresInsert = []
        const BATCH_SIZE = 50

        for (let i = 0; i < filasValidas.length; i += BATCH_SIZE) {
            const lote = filasValidas.slice(i, i + BATCH_SIZE)

            const promesas = lote.map(async (fila, j) => {
                const numFila = i + j + 2
                try {
                    const data = mapearProducto(fila)

                    // Obtener categoría del cache (sin queries, sin race condition)
                    const categoriaId = obtenerCategoriaIdDelCache(
                        cacheCats,
                        fila['DEPARTAMENTO'],
                        fila['CATEGORIA'],
                        categoriaFallbackId
                    )

                    // Upsert: crear si no existe, actualizar si existe
                    const existente = await prisma.producto.findUnique({
                        where: { codigoInterno: data.codigoInterno }
                    })

                    if (existente) {
                        const { _stockInicial, _stockMinimo, _stockMaximo, _proveedorNombre, _proveedorApodo, ...dataSinAux } = data

                        // FIX: codigoBarras vacío "" viola @unique — forzar null
                        if (!dataSinAux.codigoBarras || dataSinAux.codigoBarras.trim() === '') {
                            dataSinAux.codigoBarras = null
                        }

                        await prisma.producto.update({
                            where: { codigoInterno: dataSinAux.codigoInterno },
                            data: {
                                nombre:       dataSinAux.nombre,
                                codigoBarras: dataSinAux.codigoBarras,
                                descripcion:  dataSinAux.descripcion,
                                precioBase:   dataSinAux.precioBase,
                                precioVenta:  dataSinAux.precioVenta,
                                costo:        dataSinAux.costo,
                                claveSat:     dataSinAux.claveSat,
                                unidadSat:    dataSinAux.unidadSat,
                                esGranel:     dataSinAux.esGranel,
                                unidadVenta:  dataSinAux.unidadVenta,
                                categoriaId,
                            }
                        })
                        // Actualizar inventario si tiene stock en el CSV
                        if (_stockInicial > 0 || _stockMinimo > 0) {
                            const sucursalId = req.usuario?.sucursalId || 1
                            await prisma.inventarioSucursal.upsert({
                                where: { productoId_sucursalId: { productoId: existente.id, sucursalId } },
                                update: {
                                    stockActual:       _stockInicial,
                                    stockMinimoAlerta: _stockMinimo,
                                    ..._stockMaximo && { stockMaximo: _stockMaximo }
                                },
                                create: {
                                    productoId:        existente.id,
                                    sucursalId,
                                    stockActual:       _stockInicial,
                                    stockMinimoAlerta: _stockMinimo,
                                    ..._stockMaximo && { stockMaximo: _stockMaximo }
                                }
                            })
                        }
                        // Vincular proveedor si viene en el CSV
                        if (_proveedorNombre) {
                            const proveedorId = cacheProveedores.get(_proveedorNombre)
                            if (proveedorId) {
                                await prisma.proveedorProducto.upsert({
                                    where:  { proveedorId_productoId: { proveedorId, productoId: existente.id } },
                                    update: { precioCosto: dataSinAux.costo || 0, activo: true },
                                    create: { proveedorId, productoId: existente.id, precioCosto: dataSinAux.costo || 0, activo: true }
                                })
                                vinculaciones++
                            }
                        }
                        actualizados++
                    } else {
                        // Extraer campos auxiliares antes de insertar
                        const { _stockInicial, _stockMinimo, _stockMaximo, _proveedorNombre, _proveedorApodo, ...dataSinAux } = data

                        // FIX: codigoBarras vacío "" viola @unique — forzar null
                        if (!dataSinAux.codigoBarras || dataSinAux.codigoBarras.trim() === '') {
                            dataSinAux.codigoBarras = null
                        }

                        let productoCreado
                        try {
                            productoCreado = await prisma.producto.create({
                                data: { ...dataSinAux, categoriaId }
                            })
                        } catch (createErr) {
                            // Segundo intento sin codigoBarras (por si es duplicado)
                            try {
                                productoCreado = await prisma.producto.create({
                                    data: { ...dataSinAux, codigoBarras: null, categoriaId }
                                })
                            } catch (createErr2) {
                                throw new Error(`No se pudo crear: ${createErr2.message.substring(0, 200)}`)
                            }
                        }

                        // Crear o actualizar inventario con stock del CSV
                        const sucursalId = req.usuario?.sucursalId || 1
                        await prisma.inventarioSucursal.upsert({
                            where: { productoId_sucursalId: { productoId: productoCreado.id, sucursalId } },
                            update: {
                                stockActual:       _stockInicial,
                                stockMinimoAlerta: _stockMinimo,
                                ..._stockMaximo && { stockMaximo: _stockMaximo }
                            },
                            create: {
                                productoId:        productoCreado.id,
                                sucursalId,
                                stockActual:       _stockInicial,
                                stockMinimoAlerta: _stockMinimo,
                                ..._stockMaximo && { stockMaximo: _stockMaximo }
                            }
                        })
                        // Vincular proveedor si viene en el CSV
                        if (_proveedorNombre) {
                            const proveedorId = cacheProveedores.get(_proveedorNombre)
                            if (proveedorId) {
                                await prisma.proveedorProducto.upsert({
                                    where:  { proveedorId_productoId: { proveedorId, productoId: productoCreado.id } },
                                    update: { precioCosto: dataSinAux.costo || 0, activo: true },
                                    create: { proveedorId, productoId: productoCreado.id, precioCosto: dataSinAux.costo || 0, activo: true }
                                })
                                vinculaciones++
                            }
                        }
                        creados++
                    }

                } catch (err) {
                    erroresInsert.push({
                        fila: numFila,
                        clave: fila['CLAVE'],
                        error: err.message.substring(0, 500)
                    })
                }
            })

            await Promise.all(promesas)

            // Log progreso cada lote
            const procesados = Math.min(i + BATCH_SIZE, filasValidas.length)
            console.log(`   Procesados: ${procesados}/${filasValidas.length}`)
        }

        // ── Respuesta ──
        const todosErrores = [...erroresValidacion, ...erroresInsert]

        console.log(`\n✅ Importación completada`)
        console.log(`   Creados: ${creados}`)
        console.log(`   Actualizados: ${actualizados}`)
        console.log(`   Errores: ${todosErrores.length}`)

        res.json({
            mensaje: 'Importación completada',
            total: filas.length,
            creados,
            actualizados,
            vinculaciones,
            omitidos: erroresValidacion.length,
            errores: erroresInsert.length,
            detalleErrores: todosErrores.slice(0, 30)
        })

    } catch (error) {
        console.error('❌ Error general en importación:', error)
        res.status(500).json({
            error: 'Error en importación: ' + error.message,
            total: 0, creados: 0, errores: 0
        })
    }
}

// ═══════════════════════════════════════════════════════════════════
// ACTUALIZAR DATOS FISCALES — Actualización parcial masiva
// Solo toca: claveSat, unidadSat, proveedorId (si viene)
// CERO destrucción: no elimina, no oculta, no crea productos
// ═══════════════════════════════════════════════════════════════════

exports.actualizarDatosFiscales = async (req, res) => {
    try {
        // ── Validar archivo ──
        if (!req.file) {
            return res.status(400).json({
                error: 'Archivo CSV requerido. Envía el archivo con campo "archivo".',
                actualizados: 0, omitidos: 0, errores: 0
            })
        }

        console.log(`\n📦 [DATOS FISCALES] Archivo: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`)

        // ── Parsear CSV ──
        const { headers, filas } = parsearCSVBuffer(req.file.buffer)

        console.log(`📋 Headers: ${headers.join(', ')}`)
        console.log(`📊 Filas con datos: ${filas.length}`)

        if (filas.length === 0) {
            return res.status(400).json({
                error: 'CSV vacío o sin datos válidos',
                actualizados: 0, omitidos: 0, errores: 0
            })
        }

        // ── Validar columnas requeridas ──
        const columnasRequeridas = ['CLAVE', 'CLAVE SAT', 'UNIDAD SAT']
        const faltantes = columnasRequeridas.filter(col =>
            !headers.some(h => h.trim().toUpperCase() === col)
        )

        if (faltantes.length > 0) {
            return res.status(400).json({
                error: `Columnas faltantes en el CSV: ${faltantes.join(', ')}. Columnas encontradas: ${headers.join(', ')}`,
                actualizados: 0, omitidos: 0, errores: 0
            })
        }

        // ── Verificar si hay columnas de proveedor (opcionales) ──
        const tieneProveedor = headers.some(h => h.trim().toUpperCase() === 'PROVEEDOR')
        const tieneApodo     = headers.some(h => h.trim().toUpperCase() === 'APODO_PROVEEDOR')

        console.log(`🏭 Columnas de proveedor: ${tieneProveedor ? 'SÍ' : 'NO'}`)

        // ── Pre-crear proveedores si vienen en el CSV ──
        let cacheProveedores = new Map()
        if (tieneProveedor) {
            cacheProveedores = await preSeedProveedores(filas)
        }

        // ── Procesar en lotes ──
        let actualizados = 0
        let omitidos     = 0
        const erroresProc   = []
        const detalleOmitidos = []  // ← NUEVO: lista de claves sin match
        const BATCH_SIZE  = 50

        for (let i = 0; i < filas.length; i += BATCH_SIZE) {
            const lote = filas.slice(i, i + BATCH_SIZE)

            const promesas = lote.map(async (fila, j) => {
                const numFila = i + j + 2
                try {
                    const claveCSV   = (fila['CLAVE'] || '').trim()
                    const claveSat   = (fila['CLAVE SAT'] || '').trim() || null
                    const unidadSat  = (fila['UNIDAD SAT'] || '').trim() || null

                    if (!claveCSV) {
                        omitidos++
                        detalleOmitidos.push({ fila: numFila, clave: '(vacía)', razon: 'CLAVE vacía' })
                        return
                    }

                    // ── Filtrar notación científica (Excel destruyó el dato) ──
                    if (/^[\d.]+[eE]\+\d+$/.test(claveCSV)) {
                        omitidos++
                        detalleOmitidos.push({
                            fila: numFila,
                            clave: claveCSV,
                            descripcion: (fila['DESCRIPCION'] || '').substring(0, 80),
                            razon: 'Notación científica — Excel destruyó esta clave'
                        })
                        return
                    }

                    // ── Limpiar fechas de Excel (ej: "2026-04-12 0:00:00" → "2026-04-12") ──
                    if (/\d{4}-\d{2}-\d{2}\s+0:00:00/.test(claveCSV)) {
                        claveCSV = claveCSV.replace(/\s+0:00:00/, '').trim()
                    }

                    // ── Match doble: codigoInterno O codigoBarras ──
                    // Intento 1: match exacto
                    let producto = await prisma.producto.findFirst({
                        where: {
                            OR: [
                                { codigoInterno: claveCSV },
                                { codigoBarras:  claveCSV }
                            ]
                        },
                        select: { id: true, codigoInterno: true }
                    })

                    // Intento 2: si no matcheó y es numérico, buscar con endsWith (ceros iniciales)
                    if (!producto && /^\d+$/.test(claveCSV)) {
                        const sinCeros = claveCSV.replace(/^0+/, '')
                        if (sinCeros.length > 0) {
                            producto = await prisma.producto.findFirst({
                                where: {
                                    OR: [
                                        { codigoInterno: sinCeros },
                                        { codigoBarras:  sinCeros },
                                        { codigoInterno: { endsWith: sinCeros } },
                                        { codigoBarras:  { endsWith: sinCeros } }
                                    ]
                                },
                                select: { id: true, codigoInterno: true }
                            })
                        }
                    }

                    // Intento 3: startsWith — la clave del CSV está truncada
                    // Ej: CSV="DOT3" → BD="DOT3 LF3", CSV="CAEV-23" → BD="CAEV-23L"
                    // Solo si la clave tiene 3+ caracteres (evitar matches falsos con "1", "22")
                    if (!producto && claveCSV.length >= 3) {
                        producto = await prisma.producto.findFirst({
                            where: {
                                OR: [
                                    { codigoInterno: { startsWith: claveCSV, mode: 'insensitive' } },
                                    { codigoBarras:  { startsWith: claveCSV, mode: 'insensitive' } }
                                ]
                            },
                            select: { id: true, codigoInterno: true }
                        })
                    }

                    // Intento 4: limpiar comillas y ceros del CSV para emparejar con BD
                    // Ej: CSV="82269122020" → BD tiene "082269122020" (guardado con comillas en importación)
                    if (!producto) {
                        const limpia = claveCSV.replace(/^[\"']+|[\"']+$/g, '').trim()
                        const conCero = '0' + limpia
                        const sinCero = limpia.replace(/^0+/, '')
                        const variantes = [limpia, conCero, sinCero].filter(v => v && v !== claveCSV)
                        if (variantes.length > 0) {
                            producto = await prisma.producto.findFirst({
                                where: {
                                    OR: variantes.flatMap(v => [
                                        { codigoInterno: v },
                                        { codigoBarras: v }
                                    ])
                                },
                                select: { id: true, codigoInterno: true }
                            })
                        }
                    }

                    if (!producto) {
                        omitidos++
                        detalleOmitidos.push({
                            fila: numFila,
                            clave: claveCSV,
                            descripcion: (fila['DESCRIPCION'] || '').substring(0, 80),
                            razon: 'Sin match en codigoInterno ni codigoBarras'
                        })
                        return
                    }

                    // ── Construir datos a actualizar ──
                    const updateData = {}
                    if (claveSat)  updateData.claveSat  = claveSat
                    if (unidadSat) updateData.unidadSat = unidadSat

                    // ── Proveedor (solo si viene la columna) ──
                    if (tieneProveedor) {
                        const proveedorNombre = normalizarNombreProveedor(fila['PROVEEDOR'])
                        if (proveedorNombre) {
                            const proveedorId = cacheProveedores.get(proveedorNombre)
                            if (proveedorId) {
                                // Vincular proveedor al producto (upsert en tabla pivote)
                                await prisma.proveedorProducto.upsert({
                                    where:  { proveedorId_productoId: { proveedorId, productoId: producto.id } },
                                    update: { activo: true },
                                    create: { proveedorId, productoId: producto.id, precioCosto: 0, activo: true }
                                })
                            }
                        }
                    }

                    // ── Ejecutar UPDATE solo si hay algo que actualizar ──
                    if (Object.keys(updateData).length > 0) {
                        await prisma.producto.update({
                            where: { id: producto.id },
                            data: updateData
                        })
                    }

                    actualizados++

                } catch (err) {
                    erroresProc.push({
                        fila: numFila,
                        clave: fila['CLAVE'],
                        error: err.message.substring(0, 500)
                    })
                }
            })

            await Promise.all(promesas)
            const procesados = Math.min(i + BATCH_SIZE, filas.length)
            console.log(`   Procesados: ${procesados}/${filas.length}`)
        }

        // ── Respuesta ──
        console.log(`\n✅ Actualización de datos fiscales completada`)
        console.log(`   Actualizados: ${actualizados}`)
        console.log(`   Omitidos (sin match): ${omitidos}`)
        console.log(`   Errores: ${erroresProc.length}`)

        res.json({
            mensaje: 'Actualización de datos fiscales completada',
            total: filas.length,
            actualizados,
            omitidos,
            errores: erroresProc.length,
            detalleErrores: erroresProc.slice(0, 30),
            detalleOmitidos: detalleOmitidos.slice(0, 50)
        })

    } catch (error) {
        console.error('❌ Error general en actualización fiscal:', error)
        res.status(500).json({
            error: 'Error en actualización: ' + error.message,
            actualizados: 0, omitidos: 0, errores: 0
        })
    }
}