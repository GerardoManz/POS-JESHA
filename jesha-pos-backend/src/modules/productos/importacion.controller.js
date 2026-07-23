// ═══════════════════════════════════════════════════════════════════
// IMPORTACION.CONTROLLER.JS — CORREGIDO
// Recibe archivo CSV via multer, parsea, valida y hace upsert
// ═══════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const satMatcher = require('./sat.matcher')
const {
    normalizarCodigoBarras,
    parsearErrorPrismaProducto
} = require('./productos.helpers')

const {
    normalizarUnidadVenta,
    inferirUnidadPorNombre,
} = require('../../helpers/unidades.helper')

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
    const texto = buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    // ── Tokenizar carácter a carácter (RFC 4180) ──────────────────────────
    // Respeta campos multilinea entre comillas: \n dentro de " " NO corta fila
    const lineasReales = []
    let current = ''
    let insideQuotes = false

    for (let i = 0; i < texto.length; i++) {
        const char = texto[i]
        const next = texto[i + 1]

        if (char === '"') {
            if (insideQuotes && next === '"') {
                current += '"' // comilla escapada ("")
                i++
            } else {
                insideQuotes = !insideQuotes
            }
        } else if (char === '\n' && !insideQuotes) {
            // Salto de línea FUERA de comillas → nueva fila real
            lineasReales.push(current)
            current = ''
        } else {
            current += char
        }
    }
    if (current.trim()) lineasReales.push(current)

    // ── Buscar header (primera línea no vacía) ────────────────────────────
    let headerIdx = 0
    while (headerIdx < lineasReales.length && !lineasReales[headerIdx].trim()) {
        headerIdx++
    }

    const headers = parseCSVLine(lineasReales[headerIdx])
    const filas = []

    for (let i = headerIdx + 1; i < lineasReales.length; i++) {
        const linea = lineasReales[i].trim()
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
    const claveSat = fila['CLAVE SAT']
    const unidadSat = fila['UNIDAD SAT']
    const claveSatLimpia = claveSat ? claveSat.trim() : ''
    const unidadSatLimpia = unidadSat ? unidadSat.trim().toUpperCase() : ''

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

    // CLAVE SAT y UNIDAD SAT ahora son obligatorias
    if (!claveSatLimpia || claveSatLimpia.toLowerCase() === 'null' || claveSatLimpia.toLowerCase() === 'undefined') {
        errores.push({ fila: idx, clave, error: 'CLAVE SAT vacía o nula' })
    } else if (!/^\d{8}$/.test(claveSatLimpia)) {
        errores.push({ fila: idx, clave, error: `CLAVE SAT debe tener 8 dígitos: "${claveSatLimpia}"` })
    } else if (!satMatcher.validarClaveSat(claveSatLimpia)) {
        errores.push({ fila: idx, clave, error: `CLAVE SAT no existe en catálogo vigente: "${claveSatLimpia}"` })
    }

    if (!unidadSatLimpia || unidadSatLimpia.toLowerCase() === 'null' || unidadSatLimpia.toLowerCase() === 'undefined') {
        errores.push({ fila: idx, clave, error: 'UNIDAD SAT vacía o nula' })
    } else if (!satMatcher.validarUnidadSat(unidadSatLimpia)) {
        errores.push({ fila: idx, clave, error: `UNIDAD SAT no existe en catálogo vigente: "${unidadSatLimpia}"` })
    }

    return errores
}

// ═══════════════════════════════════════════════════════════════════
// MAPEO CSV → PRISMA
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// INFERIR UNIDAD DE VENTA desde descripción del producto
// Usa el helper central de unidades (P1). Prioridad:
//   1. Unidad explícita en CSV (TIPO DE GRANEL)
//   2. Normalización de alias
//   3. Presentación fija inequívoca (BOLSA, CAJA, ROLLO, etc.)
//   4. Unidad fraccionable inequívoca (X KG, POR METRO, etc.)
//   5. Producto físico normal sin contradicciones → PZA
//   6. Servicio → null
//   7. Granel sin unidad inferible → warning
//   8. Conflicto → warning, no importar silenciosamente
// ═══════════════════════════════════════════════════════════════════

function inferirUnidadVenta(descripcion, esGranel, tipoGranelCSV) {
    // Prioridad 1: unidad explícita desde el CSV
    if (tipoGranelCSV) {
        const normalizada = normalizarUnidadVenta(tipoGranelCSV, false)
        if (normalizada) return normalizada
    }

    // Prioridad 2-5: usar helper de inferencia por nombre
    if (!descripcion) return null

    const inferencia = inferirUnidadPorNombre(descripcion)

    // Granel sin patrón claro → null (no inferir PZA default)
    if (esGranel && inferencia.regla === 'PZA_PROBABLE') return null

    if (inferencia.unidadSugerida) {
        return inferencia.unidadSugerida
    }

    return null
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
    if (codigoBarras) {
        codigoBarras = codigoBarras.replace(/^[\"']+|[\"']+$/g, '').trim()
    }
    codigoBarras = normalizarCodigoBarras(codigoBarras)

    const stockInicial = parseFloat(fila['EXIST.']) || 0
    const stockMinimo  = parseFloat(fila['INV_MIN']) || 5
    const stockMaximo  = parseFloat(fila['INV_MAX']) || null
    const esGranel     = (fila['GRANEL (S/N)'] || '').toUpperCase().trim() === 'S'

    // ── Columna TIPO (compatible hacia atrás) ──
    const rawTipo = (fila['TIPO'] || fila['TIPO DE PRODUCTO'] || '').trim()
    const tipo = rawTipo === '' ? 'PRODUCTO' : rawTipo.toUpperCase()

    // ── SERVICIO: null out physical fields ──
    let unidadVenta, unidadCompra, factorConversion, esGranelFinal
    if (tipo === 'SERVICIO') {
        if (esGranel || (fila['TIPO DE GRANEL'] || '').trim()) {
            return { _error: 'Un servicio no puede tener configuración de granel' }
        }
        if ((fila['UNIDAD'] || fila['UNIDAD VENTA'] || '').trim()) {
            return { _error: 'Un servicio no puede tener unidad de venta' }
        }
        if ((fila['UNIDAD COMPRA'] || '').trim()) {
            return { _error: 'Un servicio no puede tener unidad de compra' }
        }
        if ((fila['FACTOR CONVERSIÓN'] || fila['FACTOR_CONVERSION'] || '').trim()) {
            return { _error: 'Un servicio no puede tener factor de conversión' }
        }
        unidadVenta = null
        unidadCompra = null
        factorConversion = null
        esGranelFinal = false
    } else {
        // Inferir unidad de venta: helper central con prioridad explícita
        const tipoGranelCSV = (fila['TIPO DE GRANEL'] || '').trim()
        unidadVenta = inferirUnidadVenta(fila['DESCRIPCION'], esGranel, tipoGranelCSV)
        unidadCompra = null
        factorConversion = null
        esGranelFinal = esGranel
    }

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
        claveSat:  (fila['CLAVE SAT'] || '').trim() || null,
        unidadSat: (fila['UNIDAD SAT'] || '').trim().toUpperCase() || null,
        esGranel:  esGranelFinal,
        unidadVenta,
        tipo,
        activo: true,
        imagenUrl: (fila['IMAGEN_URL'] || '').trim() || null,
        _stockInicial:     stockInicial,
        _stockMinimo:      stockMinimo,
        _stockMaximo:      stockMaximo,
        _proveedorNombre,
        _proveedorApodo,
    }
}

// ═══════════════════════════════════════════════════════════════════
// VALIDACIÓN DE INVARIANTES (antes de prisma.producto.create/update)
// ═══════════════════════════════════════════════════════════════════

function validarUnidadVentaInvariante(data, numFila) {
    if (data._error) {
        return { valido: false, error: data._error }
    }
    const tipo = data.tipo || 'PRODUCTO'
    if (tipo === 'SERVICIO') {
        return { valido: true }
    }
    if (!data.unidadVenta) {
        const desc = (data.nombre || '').substring(0, 80)
        return {
            valido: false,
            error: `Producto granel sin unidad de venta explícita o inferible: "${desc}"`
        }
    }
    return { valido: true }
}

// ═══════════════════════════════════════════════════════════════════
// PRE-CREAR DEPARTAMENTOS Y CATEGORÍAS (secuencial, sin race condition)
// Se ejecuta UNA VEZ antes de insertar productos
// ═══════════════════════════════════════════════════════════════════

async function preSeedDepartamentosYCategorias(filas, empresaId) {
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
                where: { empresaId, nombre: { equals: nombreDepto, mode: 'insensitive' } }
            })
            if (!depto) {
                depto = await prisma.departamento.create({
                    data: { empresaId, nombre: nombreDepto, activo: true }
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
                    empresaId,
                    departamentoId: deptoId,
                    nombre: { equals: nombreCat, mode: 'insensitive' }
                }
            })
            if (!cat) {
                cat = await prisma.categoria.create({
                    data: { empresaId, nombre: nombreCat, departamentoId: deptoId }
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

async function preSeedProveedores(filas, empresaId) {
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
                    empresaId,
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
                        empresaId,
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
// EXPORTS (funciones auxiliares + handlers)
// ═══════════════════════════════════════════════════════════════════

exports.inferirUnidadVenta = inferirUnidadVenta
exports.validarUnidadVentaInvariante = validarUnidadVentaInvariante

// ═══════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL — IMPORTAR CSV (recibe archivo via multer)
// ═══════════════════════════════════════════════════════════════════

exports.importarCSV = async (req, res) => {
    try {
        const empresaId = getEmpresaId(req)

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
        const cacheCats = await preSeedDepartamentosYCategorias(filasValidas, empresaId)

        // ── Pre-crear proveedores (auto-crear si no existe) ──
        const cacheProveedores = await preSeedProveedores(filasValidas, empresaId)

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
        const advertenciasInsert = []
        const BATCH_SIZE = 50

        for (let i = 0; i < filasValidas.length; i += BATCH_SIZE) {
            const lote = filasValidas.slice(i, i + BATCH_SIZE)

            const promesas = lote.map(async (fila, j) => {
                const numFila = i + j + 2
                try {
                    const data = mapearProducto(fila)

                    // Validar invariantes antes de upsert
                    const inv = validarUnidadVentaInvariante(data, numFila)
                    if (!inv.valido) {
                        throw new Error(inv.error)
                    }

                    // Obtener categoría del cache (sin queries, sin race condition)
                    const categoriaId = obtenerCategoriaIdDelCache(
                        cacheCats,
                        fila['DEPARTAMENTO'],
                        fila['CATEGORIA'],
                        categoriaFallbackId
                    )

                    // Upsert: crear si no existe, actualizar si existe
                    const existente = await prisma.producto.findUnique({
                        where: { empresaId_codigoInterno: { empresaId, codigoInterno: data.codigoInterno } }
                    })

                    if (existente) {
                        const { _stockInicial, _stockMinimo, _stockMaximo, _proveedorNombre, _proveedorApodo, ...dataSinAux } = data

                        dataSinAux.codigoBarras = normalizarCodigoBarras(dataSinAux.codigoBarras)

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
                                imagenUrl:    dataSinAux.imagenUrl,
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

                        dataSinAux.codigoBarras = normalizarCodigoBarras(dataSinAux.codigoBarras)

                        let productoCreado
                        try {
                            productoCreado = await prisma.producto.create({
                                data: { empresaId, ...dataSinAux, categoriaId }
                            })
                        } catch (createErr) {
                            const barcodeOriginal = dataSinAux.codigoBarras
                            // Segundo intento sin codigoBarras (por si es duplicado por race condition)
                            try {
                                productoCreado = await prisma.producto.create({
                                    data: { empresaId, ...dataSinAux, codigoBarras: null, categoriaId }
                                })
                                if (barcodeOriginal) {
                                    advertenciasInsert.push({
                                        fila: numFila,
                                        clave: dataSinAux.codigoInterno,
                                        advertencia: `El código de barras "${barcodeOriginal}" ya existía. Producto creado sin código de barras.`
                                    })
                                }
                            } catch (createErr2) {
                                const parsed = parsearErrorPrismaProducto(createErr2)
                                throw new Error(parsed ? parsed.error : `No se pudo crear el producto en la fila ${numFila}`)
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
            detalleErrores: todosErrores.slice(0, 30),
            advertencias: advertenciasInsert.length,
            detalleAdvertencias: advertenciasInsert.slice(0, 30)
        })

    } catch (error) {
        console.error('❌ Error general en importación:', error)
        const parsed = parsearErrorPrismaProducto(error)
        res.status(500).json({
            error: parsed ? parsed.error : 'Error en la importación. Revisa el archivo e intenta de nuevo.',
            total: 0, creados: 0, errores: 0
        })
    }
}

// ═══════════════════════════════════════════════════════════════════
// ACTUALIZAR DATOS FISCALES — Actualización parcial masiva
// Solo toca: claveSat, unidadSat, proveedorId (si viene)
// CERO destrucción: no elimina, no oculta, no crea productos
// ═══════════════════════════════════════════════════════════════════

exports.actualizarDatosFiscales_ELIMINADO = async (req, res) => {
    return res.status(410).json({ error: 'Función eliminada' })
}
// ═══════════════════════════════════════════════════════════════════
// IMPORTAR SOLO NUEVOS — Crea productos que NO existen, ignora existentes
// Misma estructura que importarCSV pero sin update de existentes
// ═══════════════════════════════════════════════════════════════════

exports.importarSoloNuevos = async (req, res) => {
    try {
        const empresaId = getEmpresaId(req)

        // ── Validar que llegó un archivo ──
        if (!req.file) {
            return res.status(400).json({
                error: 'Archivo CSV requerido. Envía el archivo con campo "archivo".',
                total: 0, creados: 0, omitidos: 0, errores: 0
            })
        }

        console.log(`\n📦 [SOLO NUEVOS] Archivo: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`)

        // ── Parsear CSV del buffer ──
        const { headers, filas } = parsearCSVBuffer(req.file.buffer)

        console.log(`📋 Headers: ${headers.join(', ')}`)
        console.log(`📊 Filas con datos: ${filas.length}`)

        if (filas.length === 0) {
            return res.status(400).json({
                error: 'CSV vacío o sin datos válidos',
                total: 0, creados: 0, omitidos: 0, errores: 0
            })
        }

        // ── Validar TODAS las filas primero ──
        const erroresValidacion = []
        const filasValidas = []

        for (let i = 0; i < filas.length; i++) {
            const errs = validarFila(filas[i], i + 2)
            if (errs.length > 0) {
                erroresValidacion.push(...errs)
            } else {
                filasValidas.push(filas[i])
            }
        }

        console.log(`✅ Filas válidas: ${filasValidas.length}`)
        console.log(`⚠️  Filas con error de validación: ${erroresValidacion.length}`)

        // ── Pre-crear departamentos y categorías ──
        const cacheCats = await preSeedDepartamentosYCategorias(filasValidas, empresaId)

        // ── Pre-crear proveedores ──
        const cacheProveedores = await preSeedProveedores(filasValidas, empresaId)

        // ── Obtener categoría fallback ──
        const categoriaFallbackId = await obtenerCategoriaFallback()
        if (!categoriaFallbackId) {
            return res.status(400).json({
                error: 'No hay categorías en la base de datos. Crea al menos una categoría primero.',
                total: 0, creados: 0, omitidos: 0, errores: 0
            })
        }
        console.log(`📁 Categoría fallback: id=${categoriaFallbackId}`)

        // ── Procesar productos en lotes ──
        let creados       = 0
        let omitidos       = 0
        let vinculaciones  = 0
        const erroresInsert    = []
        const advertenciasInsert = []
        const detalleOmitidos  = []
        const BATCH_SIZE   = 50

        for (let i = 0; i < filasValidas.length; i += BATCH_SIZE) {
            const lote = filasValidas.slice(i, i + BATCH_SIZE)

            const promesas = lote.map(async (fila, j) => {
                const numFila = i + j + 2
                try {
                    const data = mapearProducto(fila)

                    // Validar invariantes antes de crear
                    const inv = validarUnidadVentaInvariante(data, numFila)
                    if (!inv.valido) {
                        throw new Error(inv.error)
                    }

                    // ══════════════════════════════════════════════════
                    // BÚSQUEDA DE EXISTENCIA — doble: codigoInterno Y codigoBarras
                    // Si CUALQUIERA matchea → omitir (no crear)
                    // ══════════════════════════════════════════════════

                    // Check 1: por codigoInterno
                    const existePorCodigo = await prisma.producto.findUnique({
                        where: { empresaId_codigoInterno: { empresaId, codigoInterno: data.codigoInterno } },
                        select: { id: true }
                    })

                    if (existePorCodigo) {
                        omitidos++
                        detalleOmitidos.push({
                            fila: numFila,
                            clave: data.codigoInterno,
                            descripcion: data.nombre.substring(0, 80),
                            razon: 'Ya existe por codigoInterno'
                        })
                        return
                    }

                    // Check 2: por codigoBarras (si tiene uno válido)
                    if (data.codigoBarras) {
                        const existePorBarras = await prisma.producto.findFirst({
                            where: { empresaId, codigoBarras: data.codigoBarras },
                            select: { id: true }
                        })
                        if (existePorBarras) {
                            omitidos++
                            detalleOmitidos.push({
                                fila: numFila,
                                clave: data.codigoInterno,
                                descripcion: data.nombre.substring(0, 80),
                                razon: `Ya existe por codigoBarras (${data.codigoBarras})`
                            })
                            return
                        }
                    }

                    // ══════════════════════════════════════════════════
                    // NO EXISTE → CREAR
                    // ══════════════════════════════════════════════════

                    const categoriaId = obtenerCategoriaIdDelCache(
                        cacheCats,
                        fila['DEPARTAMENTO'],
                        fila['CATEGORIA'],
                        categoriaFallbackId
                    )

                    const { _stockInicial, _stockMinimo, _stockMaximo, _proveedorNombre, _proveedorApodo, ...dataSinAux } = data

                    dataSinAux.codigoBarras = normalizarCodigoBarras(dataSinAux.codigoBarras)

                    let productoCreado
                    try {
                        productoCreado = await prisma.producto.create({
                            data: { empresaId, ...dataSinAux, categoriaId }
                        })
                    } catch (createErr) {
                        const barcodeOriginal = dataSinAux.codigoBarras
                        // Segundo intento sin codigoBarras (por si es duplicado por race condition)
                        try {
                            productoCreado = await prisma.producto.create({
                                data: { empresaId, ...dataSinAux, codigoBarras: null, categoriaId }
                            })
                            if (barcodeOriginal) {
                                advertenciasInsert.push({
                                    fila: numFila,
                                    clave: dataSinAux.codigoInterno,
                                    advertencia: `El código de barras "${barcodeOriginal}" ya existía. Producto creado sin código de barras.`
                                })
                            }
                        } catch (createErr2) {
                            const parsed = parsearErrorPrismaProducto(createErr2)
                            throw new Error(parsed ? parsed.error : `No se pudo crear el producto en la fila ${numFila}`)
                        }
                    }

                    // Crear inventario con stock del CSV
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

                } catch (err) {
                    erroresInsert.push({
                        fila: numFila,
                        clave: fila['CLAVE'],
                        error: err.message.substring(0, 500)
                    })
                }
            })

            await Promise.all(promesas)

            const procesados = Math.min(i + BATCH_SIZE, filasValidas.length)
            console.log(`   Procesados: ${procesados}/${filasValidas.length}`)
        }

        // ── Respuesta ──
        const todosErrores = [...erroresValidacion, ...erroresInsert]

        console.log(`\n✅ Importación SOLO NUEVOS completada`)
        console.log(`   Creados: ${creados}`)
        console.log(`   Omitidos (ya existían): ${omitidos}`)
        console.log(`   Errores: ${todosErrores.length}`)

        res.json({
            mensaje: 'Importación Solo Nuevos completada',
            total: filas.length,
            creados,
            omitidos: omitidos + erroresValidacion.length,
            vinculaciones,
            errores: erroresInsert.length,
            detalleErrores: todosErrores.slice(0, 30),
            detalleOmitidos: detalleOmitidos.slice(0, 50),
            advertencias: advertenciasInsert.length,
            detalleAdvertencias: advertenciasInsert.slice(0, 30)
        })

    } catch (error) {
        console.error('❌ Error general en importación Solo Nuevos:', error)
        const parsed = parsearErrorPrismaProducto(error)
        res.status(500).json({
            error: parsed ? parsed.error : 'Error en la importación. Revisa el archivo e intenta de nuevo.',
            total: 0, creados: 0, omitidos: 0, errores: 0
        })
    }
}
