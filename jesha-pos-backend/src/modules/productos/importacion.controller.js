// ═══════════════════════════════════════════════════════════════════
// IMPORTACION.CONTROLLER.JS — CORREGIDO
// Recibe archivo CSV via multer, parsea, valida y hace upsert
// ═══════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const resolverSucursalId = require('../sucursal/sucursal.helper')
const satMatcher = require('./sat.matcher')
const { registrarHistorialEconomico } = require('../../helpers/historial-precio-producto')
const {
    normalizarCodigoBarras,
    parsearErrorPrismaProducto
} = require('./productos.helpers')
const {
    validateIdempotencyKey,
    computeImportFingerprint,
    beginImportCommand,
    renewLease,
    aggregateFromDetails,
    finalizeImport,
    failImport,
    BEGIN_RESULT,
    LEASE_DURATION_MS,
} = require('./importacion.idempotency')

const crypto = require('crypto')

const {
    normalizarUnidadVenta,
    clasificarProducto,
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
function parsearCSVBuffer(buffer, { conservarInvalidas = false } = {}) {
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

        obj._filaOrigen = i + 1
        if (conservarInvalidas || obj['CLAVE']) filas.push(obj)
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

    // TIPO: solo PRODUCTO | SERVICIO (vacío → default PRODUCTO en mapearProducto)
    const rawTipo = (fila['TIPO'] || fila['TIPO DE PRODUCTO'] || '').trim()
    if (rawTipo !== '' && !['PRODUCTO', 'SERVICIO'].includes(rawTipo.toUpperCase())) {
        errores.push({ fila: idx, clave, error: `TIPO inválido: "${rawTipo}". Solo se acepta PRODUCTO o SERVICIO` })
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

function inferirUnidadVenta(descripcion, esGranel, tipoGranelCSV, unidadSat) {
    // Prioridad 1: unidad explícita desde el CSV
    if (tipoGranelCSV) {
        const normalizada = normalizarUnidadVenta(tipoGranelCSV, false)
        if (normalizada) return normalizada
    }

    // Prioridad 2-5: usar clasificador central (única fuente de verdad)
    if (!descripcion) return null

    const resultado = clasificarProducto({
        nombre: descripcion,
        esGranel: !!esGranel,
        unidadSat: unidadSat || null,
    })

    // Granel sin patrón claro → null (no inferir PZA default)
    if (esGranel && resultado.regla === 'PZA_PROBABLE') return null

    return resultado.unidadSugerida || null
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
        const unidadSatCSV = (fila['UNIDAD SAT'] || '').trim().toUpperCase() || null
        unidadVenta = inferirUnidadVenta(fila['DESCRIPCION'], esGranel, tipoGranelCSV, unidadSatCSV)
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
        where: { empresaId, activo: true },
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
async function obtenerCategoriaFallback(empresaId) {
    const tenant = await prisma.categoria.findFirst({
        where: { empresaId },
        orderBy: { id: 'asc' },
        select: { id: true }
    })
    if (tenant) return tenant.id

    const global = await prisma.categoria.findFirst({
        where: { empresaId: null, esGlobal: true },
        orderBy: { id: 'asc' },
        select: { id: true }
    })
    return global ? global.id : null
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
        const sucursalId = resolverSucursalId(req)

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
        const categoriaFallbackId = await obtenerCategoriaFallback(empresaId)
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

                        await prisma.$transaction(async (tx) => {
                            const antes = await tx.producto.findUnique({
                                where: { id: existente.id },
                                select: { precioVenta: true, precioBase: true, costo: true, costoPromedio: true, margen: true, costoSinIvaProveedor: true, factorConversion: true }
                            })

                            await tx.producto.update({
                                where: { empresaId_codigoInterno: { empresaId, codigoInterno: dataSinAux.codigoInterno } },
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

                            const despues = await tx.producto.findUnique({
                                where: { id: existente.id },
                                select: { precioVenta: true, precioBase: true, costo: true, costoPromedio: true, margen: true, costoSinIvaProveedor: true, factorConversion: true }
                            })

                            await registrarHistorialEconomico(tx, {
                                empresaId,
                                productoId: existente.id,
                                usuarioId: req.usuario?.id ? parseInt(req.usuario.id) : null,
                                sucursalId,
                                origen: 'IMPORTACION',
                                accion: 'IMPORTAR_ACTUALIZACION_PRODUCTO',
                                referencia: `PRODUCTO:${existente.id}`,
                                contexto: { fila: numFila },
                                antes: antes || {},
                                despues: despues || {}
                            })

                            if (sucursalId !== null && (_stockInicial > 0 || _stockMinimo > 0)) {
                                await tx.inventarioSucursal.upsert({
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

                            if (_proveedorNombre) {
                                const proveedorId = cacheProveedores.get(_proveedorNombre)
                                if (proveedorId) {
                                    await tx.proveedorProducto.upsert({
                                        where:  { proveedorId_productoId: { proveedorId, productoId: existente.id } },
                                        update: { precioCosto: dataSinAux.costo || 0, activo: true },
                                        create: { proveedorId, productoId: existente.id, precioCosto: dataSinAux.costo || 0, activo: true }
                                    })
                                    vinculaciones++
                                }
                            }

                        })
                        actualizados++
                    } else {
                        // Extraer campos auxiliares antes de insertar
                        const { _stockInicial, _stockMinimo, _stockMaximo, _proveedorNombre, _proveedorApodo, ...dataSinAux } = data

                        dataSinAux.codigoBarras = normalizarCodigoBarras(dataSinAux.codigoBarras)

                        let productoCreado
                        try {
                            await prisma.$transaction(async (tx) => {
                                try {
                                    productoCreado = await tx.producto.create({
                                        data: { empresaId, ...dataSinAux, categoriaId }
                                    })
                                } catch (createErr) {
                                    const barcodeOriginal = dataSinAux.codigoBarras
                                    try {
                                        productoCreado = await tx.producto.create({
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

                                await registrarHistorialEconomico(tx, {
                                    empresaId,
                                    productoId: productoCreado.id,
                                    usuarioId: req.usuario?.id ? parseInt(req.usuario.id) : null,
                                    sucursalId,
                                    origen: 'IMPORTACION',
                                    accion: 'IMPORTAR_CREACION_PRODUCTO',
                                    referencia: `PRODUCTO:${productoCreado.id}`,
                                    contexto: { fila: numFila },
                                    antes: {},
                                    despues: {
                                        precioVenta: productoCreado.precioVenta,
                                        precioBase: productoCreado.precioBase,
                                        costo: productoCreado.costo,
                                        costoPromedio: productoCreado.costoPromedio,
                                        margen: productoCreado.margen,
                                        costoSinIvaProveedor: productoCreado.costoSinIvaProveedor,
                                        factorConversion: productoCreado.factorConversion
                                    }
                                })

                                if (sucursalId !== null) {
                                    await tx.inventarioSucursal.upsert({
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
                                }

                                if (_proveedorNombre) {
                                    const proveedorId = cacheProveedores.get(_proveedorNombre)
                                    if (proveedorId) {
                                        await tx.proveedorProducto.upsert({
                                            where:  { proveedorId_productoId: { proveedorId, productoId: productoCreado.id } },
                                            update: { precioCosto: dataSinAux.costo || 0, activo: true },
                                            create: { proveedorId, productoId: productoCreado.id, precioCosto: dataSinAux.costo || 0, activo: true }
                                        })
                                        vinculaciones++
                                    }
                                }

                            })
                        } catch (txErr) {
                            throw txErr
                        }
                        creados++
                    }

                } catch (err) {
                    erroresInsert.push({
                        fila: numFila,
                        clave: fila['CLAVE'],
                        error: 'No fue posible importar esta fila. Verifica sus datos y vuelve a intentarlo.'
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
        const sucursalId = resolverSucursalId(req)

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
        const categoriaFallbackId = await obtenerCategoriaFallback(empresaId)
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
                        await prisma.$transaction(async (tx) => {
                            try {
                                productoCreado = await tx.producto.create({
                                    data: { empresaId, ...dataSinAux, categoriaId }
                                })
                            } catch (createErr) {
                                const barcodeOriginal = dataSinAux.codigoBarras
                                try {
                                    productoCreado = await tx.producto.create({
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

                            await registrarHistorialEconomico(tx, {
                                empresaId,
                                productoId: productoCreado.id,
                                usuarioId: req.usuario?.id ? parseInt(req.usuario.id) : null,
                                sucursalId,
                                origen: 'IMPORTACION',
                                accion: 'IMPORTAR_CREACION_PRODUCTO',
                                referencia: `PRODUCTO:${productoCreado.id}`,
                                contexto: { fila: numFila },
                                antes: {},
                                despues: {
                                    precioVenta: productoCreado.precioVenta,
                                    precioBase: productoCreado.precioBase,
                                    costo: productoCreado.costo,
                                    costoPromedio: productoCreado.costoPromedio,
                                    margen: productoCreado.margen,
                                    costoSinIvaProveedor: productoCreado.costoSinIvaProveedor,
                                    factorConversion: productoCreado.factorConversion
                                }
                            })

                            if (sucursalId !== null) {
                                await tx.inventarioSucursal.upsert({
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
                            }

                            if (_proveedorNombre) {
                                const proveedorId = cacheProveedores.get(_proveedorNombre)
                                if (proveedorId) {
                                    await tx.proveedorProducto.upsert({
                                        where:  { proveedorId_productoId: { proveedorId, productoId: productoCreado.id } },
                                        update: { precioCosto: dataSinAux.costo || 0, activo: true },
                                        create: { proveedorId, productoId: productoCreado.id, precioCosto: dataSinAux.costo || 0, activo: true }
                                    })
                                    vinculaciones++
                                }
                            }

                        })
                    } catch (txErr) {
                        throw txErr
                    }

                    creados++

                } catch (err) {
                    erroresInsert.push({
                        fila: numFila,
                        clave: fila['CLAVE'],
                        error: 'No fue posible importar esta fila. Verifica sus datos y vuelve a intentarlo.'
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

// ═══════════════════════════════════════════════════════════════════
// IMPORTACIÓN IDEMPOTENTE — una fila, una transacción, un detalle
// ═══════════════════════════════════════════════════════════════════

const importarCSVLegacy = exports.importarCSV
const importarSoloNuevosLegacy = exports.importarSoloNuevos

function normalizarTextoFingerprint(value, upper = false) {
    const text = value == null ? null : String(value).trim()
    if (!text) return null
    return upper ? text.toUpperCase() : text
}

function construirFilaFingerprint(fila) {
    let data = {}
    if (fila['CLAVE']) {
        try { data = mapearProducto(fila) } catch (_) { data = {} }
    }

    return {
        fila: fila._filaOrigen,
        codigoInterno: data.codigoInterno ?? normalizarTextoFingerprint(fila['CLAVE']),
        codigoBarras: data.codigoBarras ?? normalizarCodigoBarras(fila['CLAVE ALTERNA']),
        nombre: data.nombre ?? normalizarTextoFingerprint(fila['DESCRIPCION']),
        descripcion: data.descripcion ?? normalizarTextoFingerprint(fila['CARACTERISTICAS']),
        precioBase: fila['PRECIO 1'],
        precioVenta: fila['PRECIO_VENTA'],
        costo: fila['PRECIO COMPRA'],
        claveSat: normalizarTextoFingerprint(fila['CLAVE SAT']),
        unidadSat: normalizarTextoFingerprint(fila['UNIDAD SAT'], true),
        tipo: normalizarTextoFingerprint(fila['TIPO'] || fila['TIPO DE PRODUCTO'], true) || 'PRODUCTO',
        esGranel: normalizarTextoFingerprint(fila['GRANEL (S/N)'], true) === 'S',
        unidadVenta: data.unidadVenta ?? normalizarTextoFingerprint(fila['UNIDAD'] || fila['UNIDAD VENTA'], true),
        unidadCompra: normalizarTextoFingerprint(fila['UNIDAD COMPRA'], true),
        factorConversion: fila['FACTOR CONVERSIÓN'] || fila['FACTOR_CONVERSION'] || null,
        imagenUrl: normalizarTextoFingerprint(fila['IMAGEN_URL']),
        stockInicial: fila['EXIST.'],
        stockMinimo: fila['INV_MIN'],
        stockMaximo: fila['INV_MAX'],
        departamento: normalizarTextoFingerprint(fila['DEPARTAMENTO'], true),
        categoria: normalizarTextoFingerprint(fila['CATEGORIA']),
        proveedorNombre: normalizarNombreProveedor(fila['PROVEEDOR']),
        proveedorApodo: normalizarTextoFingerprint(fila['APODO_PROVEEDOR']),
        errorMapeo: data._error || null,
    }
}

async function buscarOCrearDepartamentoTx(tx, empresaId, nombre) {
    let departamento = await tx.departamento.findFirst({
        where: { empresaId, nombre: { equals: nombre, mode: 'insensitive' } },
        select: { id: true }
    })
    if (departamento) return departamento.id

    departamento = await tx.departamento.upsert({
        where: { empresaId_nombre: { empresaId, nombre } },
        update: { activo: true },
        create: { empresaId, nombre, activo: true, esGlobal: false },
        select: { id: true }
    })
    if (!departamento) throw new Error(`No fue posible resolver el departamento "${nombre}".`)
    return departamento.id
}

async function resolverCategoriaFilaTx(tx, fila, empresaId) {
    const departamentoNombre = (fila['DEPARTAMENTO'] || '').toUpperCase().trim()
    const categoriaNombre = (fila['CATEGORIA'] || '').trim()

    if (!departamentoNombre || !categoriaNombre) {
        const tenant = await tx.categoria.findFirst({
            where: { empresaId },
            orderBy: { id: 'asc' },
            select: { id: true }
        })
        if (tenant) return tenant.id

        const global = await tx.categoria.findFirst({
            where: { empresaId: null, esGlobal: true },
            orderBy: { id: 'asc' },
            select: { id: true }
        })
        if (global) return global.id
        throw new Error('No hay una categoría disponible para esta empresa.')
    }

    const departamentoId = await buscarOCrearDepartamentoTx(tx, empresaId, departamentoNombre)
    let categoria = await tx.categoria.findFirst({
        where: {
            empresaId,
            departamentoId,
            nombre: { equals: categoriaNombre, mode: 'insensitive' }
        },
        select: { id: true }
    })
    if (categoria) return categoria.id

    categoria = await tx.categoria.upsert({
        where: {
            empresaId_departamentoId_nombre: { empresaId, departamentoId, nombre: categoriaNombre }
        },
        update: {},
        create: { empresaId, departamentoId, nombre: categoriaNombre, esGlobal: false },
        select: { id: true }
    })
    if (!categoria) throw new Error(`No fue posible resolver la categoría "${categoriaNombre}".`)
    return categoria.id
}

async function resolverProveedorFilaTx(tx, data, empresaId) {
    if (!data._proveedorNombre) return null

    let proveedor = await tx.proveedor.findFirst({
        where: {
            empresaId,
            activo: true,
            OR: [
                { nombreOficial: { equals: data._proveedorNombre, mode: 'insensitive' } },
                { alias: { equals: data._proveedorNombre, mode: 'insensitive' } }
            ]
        },
        select: { id: true }
    })
    if (proveedor) return proveedor.id

    proveedor = await tx.proveedor.upsert({
        where: {
            empresaId_nombreOficial: { empresaId, nombreOficial: data._proveedorNombre }
        },
        update: { activo: true },
        create: {
            empresaId,
            nombreOficial: data._proveedorNombre,
            alias: data._proveedorApodo || data._proveedorNombre,
            activo: true
        },
        select: { id: true }
    })
    if (!proveedor) throw new Error(`No fue posible resolver el proveedor "${data._proveedorNombre}".`)
    return proveedor.id
}

function dataProductoImportado(data, categoriaId, codigoBarras) {
    return {
        nombre: data.nombre,
        codigoBarras,
        descripcion: data.descripcion,
        precioBase: data.precioBase,
        precioVenta: data.precioVenta,
        costo: data.costo,
        claveSat: data.claveSat,
        unidadSat: data.unidadSat,
        esGranel: data.esGranel,
        unidadVenta: data.unidadVenta,
        tipo: data.tipo,
        imagenUrl: data.imagenUrl,
        categoriaId,
        activo: true,
    }
}

async function registrarInventarioFilaTx(tx, data, productoId, sucursalId, crearSiempre) {
    if (sucursalId === null || sucursalId === undefined) return
    if (!crearSiempre && !(data._stockInicial > 0 || data._stockMinimo > 0)) return

    const inventario = {
        stockActual: data._stockInicial,
        stockMinimoAlerta: data._stockMinimo,
        ...(data._stockMaximo !== null ? { stockMaximo: data._stockMaximo } : {})
    }
    await tx.inventarioSucursal.upsert({
        where: { productoId_sucursalId: { productoId, sucursalId } },
        update: inventario,
        create: { productoId, sucursalId, ...inventario }
    })
}

async function crearDetalleTerminalTx(tx, data) {
    return tx.importacionProductosDetalle.create({ data })
}

async function bloquearYValidarLeaseTx(tx, importacionId, leaseToken) {
    const rows = await tx.$queryRawUnsafe(
        `SELECT "leaseToken", "leaseExpiresAt", "estado"
         FROM "ImportacionProductos"
         WHERE "id" = $1
         FOR UPDATE`,
        importacionId
    )
    const header = rows[0]
    const vigente = header &&
        header.leaseToken === leaseToken &&
        header.estado === 'PROCESANDO' &&
        header.leaseExpiresAt &&
        new Date(header.leaseExpiresAt) > new Date()
    if (!vigente) {
        const error = new Error('La importación perdió su lease de ejecución.')
        error.code = 'IMPORT_LEASE_LOST'
        throw error
    }
}

async function procesarFilaIdempotente({
    importacionId,
    fila,
    tipo,
    empresaId,
    sucursalId,
    usuarioId,
    leaseToken,
}) {
    const filaNumero = fila._filaOrigen
    const codigoFallback = fila['CLAVE'] || `FILA_${filaNumero}`
    const existenteDetalle = await prisma.importacionProductosDetalle.findUnique({
        where: { importacionId_fila: { importacionId, fila: filaNumero } },
        select: { id: true }
    })
    if (existenteDetalle) return

    const errores = validarFila(fila, filaNumero)
    let data = null
    if (errores.length === 0) {
        data = mapearProducto(fila)
        const invariante = validarUnidadVentaInvariante(data, filaNumero)
        if (!invariante.valido) errores.push({ fila: filaNumero, clave: fila['CLAVE'], error: invariante.error })
    }

    if (errores.length > 0) {
        await prisma.$transaction(async (tx) => {
            await bloquearYValidarLeaseTx(tx, importacionId, leaseToken)
            const yaExiste = await tx.importacionProductosDetalle.findUnique({
                where: { importacionId_fila: { importacionId, fila: filaNumero } },
                select: { id: true }
            })
            if (yaExiste) return
            await crearDetalleTerminalTx(tx, {
                importacionId,
                fila: filaNumero,
                codigoInterno: codigoFallback,
                estado: 'ERROR_VALIDACION',
                accion: 'ERROR',
                error: errores.map((item) => item.error).join(' | '),
            })
        })
        return
    }

    try {
        await prisma.$transaction(async (tx) => {
            await bloquearYValidarLeaseTx(tx, importacionId, leaseToken)
            const yaExiste = await tx.importacionProductosDetalle.findUnique({
                where: { importacionId_fila: { importacionId, fila: filaNumero } },
                select: { id: true }
            })
            if (yaExiste) return

            const categoriaId = await resolverCategoriaFilaTx(tx, fila, empresaId)
            const proveedorId = await resolverProveedorFilaTx(tx, data, empresaId)
            const productoPorCodigo = await tx.producto.findUnique({
                where: { empresaId_codigoInterno: { empresaId, codigoInterno: data.codigoInterno } }
            })
            const codigoBarrasNormalizado = normalizarCodigoBarras(data.codigoBarras)
            const productoPorBarras = codigoBarrasNormalizado
                ? await tx.producto.findFirst({
                    where: { empresaId, codigoBarras: codigoBarrasNormalizado },
                    select: { id: true }
                })
                : null

            if (tipo === 'solo_nuevos' && (productoPorCodigo || productoPorBarras)) {
                const razon = productoPorCodigo
                    ? 'Ya existe por codigoInterno'
                    : `Ya existe por codigoBarras (${codigoBarrasNormalizado})`
                await crearDetalleTerminalTx(tx, {
                    importacionId,
                    fila: filaNumero,
                    codigoInterno: data.codigoInterno,
                    estado: 'COMPLETADA',
                    accion: 'OMITIDO',
                    productoId: productoPorCodigo?.id || productoPorBarras?.id || null,
                    mensaje: razon,
                })
                return
            }

            let producto
            let accion
            let advertencia = null
            let codigoBarras = codigoBarrasNormalizado
            if (productoPorBarras && productoPorBarras.id !== productoPorCodigo?.id) {
                advertencia = `El código de barras "${codigoBarrasNormalizado}" ya existía. Se procesó sin código de barras.`
                codigoBarras = null
            }

            if (productoPorCodigo) {
                const antes = await tx.producto.findUnique({
                    where: { id: productoPorCodigo.id },
                    select: { precioVenta: true, precioBase: true, costo: true, costoPromedio: true, margen: true, costoSinIvaProveedor: true, factorConversion: true }
                })
                producto = await tx.producto.update({
                    where: { empresaId_codigoInterno: { empresaId, codigoInterno: data.codigoInterno } },
                    data: dataProductoImportado(data, categoriaId, codigoBarras)
                })
                const despues = await tx.producto.findUnique({
                    where: { id: producto.id },
                    select: { precioVenta: true, precioBase: true, costo: true, costoPromedio: true, margen: true, costoSinIvaProveedor: true, factorConversion: true }
                })
                await registrarHistorialEconomico(tx, {
                    empresaId,
                    productoId: producto.id,
                    usuarioId,
                    sucursalId,
                    origen: 'IMPORTACION',
                    accion: 'IMPORTAR_ACTUALIZACION_PRODUCTO',
                    referencia: `PRODUCTO:${producto.id}`,
                    contexto: { fila: filaNumero },
                    antes: antes || {},
                    despues: despues || {}
                })
                await registrarInventarioFilaTx(tx, data, producto.id, sucursalId, false)
                accion = 'ACTUALIZADO'
            } else {
                producto = await tx.producto.create({
                    data: {
                        empresaId,
                        codigoInterno: data.codigoInterno,
                        ...dataProductoImportado(data, categoriaId, codigoBarras)
                    }
                })
                await registrarHistorialEconomico(tx, {
                    empresaId,
                    productoId: producto.id,
                    usuarioId,
                    sucursalId,
                    origen: 'IMPORTACION',
                    accion: 'IMPORTAR_CREACION_PRODUCTO',
                    referencia: `PRODUCTO:${producto.id}`,
                    contexto: { fila: filaNumero },
                    antes: {},
                    despues: {
                        precioVenta: producto.precioVenta,
                        precioBase: producto.precioBase,
                        costo: producto.costo,
                        costoPromedio: producto.costoPromedio,
                        margen: producto.margen,
                        costoSinIvaProveedor: producto.costoSinIvaProveedor,
                        factorConversion: producto.factorConversion
                    }
                })
                await registrarInventarioFilaTx(tx, data, producto.id, sucursalId, true)
                accion = 'CREADO'
            }

            let vinculaciones = 0
            if (proveedorId) {
                await tx.proveedorProducto.upsert({
                    where: { proveedorId_productoId: { proveedorId, productoId: producto.id } },
                    update: { precioCosto: data.costo || 0, activo: true },
                    create: { proveedorId, productoId: producto.id, precioCosto: data.costo || 0, activo: true }
                })
                vinculaciones = 1
            }

            await crearDetalleTerminalTx(tx, {
                importacionId,
                fila: filaNumero,
                codigoInterno: data.codigoInterno,
                estado: 'COMPLETADA',
                accion,
                productoId: producto.id,
                vinculaciones,
                advertencia,
            })
        })
    } catch (error) {
        if (error.code === 'IMPORT_LEASE_LOST') throw error
        await prisma.$transaction(async (tx) => {
            await bloquearYValidarLeaseTx(tx, importacionId, leaseToken)
            const yaExiste = await tx.importacionProductosDetalle.findUnique({
                where: { importacionId_fila: { importacionId, fila: filaNumero } },
                select: { id: true }
            })
            if (yaExiste) return
            await crearDetalleTerminalTx(tx, {
                importacionId,
                fila: filaNumero,
                codigoInterno: data?.codigoInterno || codigoFallback,
                estado: 'ERROR_SISTEMA',
                accion: 'ERROR',
                error: error.message || 'Error de sistema al procesar la fila.',
            })
        })
    }
}

async function construirRespuestaIdempotente(importacionId, total, tipo) {
    const [counts, detalles] = await Promise.all([
        aggregateFromDetails(prisma, importacionId),
        prisma.importacionProductosDetalle.findMany({
            where: { importacionId },
            orderBy: { fila: 'asc' }
        })
    ])
    const detalleErrores = detalles
        .filter((detalle) => detalle.accion === 'ERROR')
        .slice(0, 30)
        .map((detalle) => ({ fila: detalle.fila, clave: detalle.codigoInterno, error: detalle.error }))
    const detalleOmitidos = detalles
        .filter((detalle) => detalle.accion === 'OMITIDO')
        .slice(0, 50)
        .map((detalle) => ({ fila: detalle.fila, clave: detalle.codigoInterno, razon: detalle.mensaje }))
    const detalleAdvertencias = detalles
        .filter((detalle) => detalle.advertencia)
        .slice(0, 30)
        .map((detalle) => ({ fila: detalle.fila, clave: detalle.codigoInterno, advertencia: detalle.advertencia }))

    const respuesta = {
        mensaje: tipo === 'solo_nuevos' ? 'Importación Solo Nuevos completada' : 'Importación completada',
        total,
        creados: counts.creados,
        ...(tipo === 'upsert' ? { actualizados: counts.actualizados } : {}),
        vinculaciones: counts.vinculaciones,
        omitidos: counts.omitidos,
        errores: counts.errores,
        detalleErrores,
        ...(tipo === 'solo_nuevos' ? { detalleOmitidos } : {}),
        advertencias: counts.advertencias,
        detalleAdvertencias,
    }
    return { counts, respuesta }
}

function enviarResultadoInicio(res, inicio) {
    if (inicio.kind === BEGIN_RESULT.CONFLICT) {
        return res.status(409).json({
            code: 'IDEMPOTENCY_KEY_REUSED',
            error: 'La misma clave de idempotencia ya fue usada con un archivo o modo diferente.'
        })
    }
    if (inicio.kind === BEGIN_RESULT.IN_PROGRESS) {
        return res.status(409).json({
            code: 'IMPORTACION_EN_PROCESO',
            error: 'La importación todavía está en proceso.',
            importacionId: inicio.importacionId
        })
    }
    if (inicio.kind === BEGIN_RESULT.REPLAY) {
        return res.status(inicio.estado === 'FALLIDA' ? 500 : 200).json(inicio.respuesta)
    }
    return null
}

function crearHandlerImportacionIdempotente(tipo, legacyHandler) {
    return async (req, res) => {
        const validacionKey = validateIdempotencyKey(req.headers['idempotency-key'])
        if (validacionKey.missing) return legacyHandler(req, res)
        if (!validacionKey.valid) return res.status(400).json({ code: 'IDEMPOTENCY_KEY_INVALID', error: validacionKey.error })
        if (!req.file) {
            return res.status(400).json({ error: 'Archivo CSV requerido. Envía el archivo con campo "archivo".' })
        }

        let importacionId = null
        let leaseToken = null
        let totalFilas = 0
        try {
            const empresaId = getEmpresaId(req)
            const sucursalId = resolverSucursalId(req)
            const usuarioId = req.usuario?.id ? parseInt(req.usuario.id) : null
            const { filas } = parsearCSVBuffer(req.file.buffer, { conservarInvalidas: true })
            if (filas.length === 0) {
                return res.status(400).json({ error: 'CSV vacío o sin datos válidos' })
            }
            totalFilas = filas.length

            const { fingerprintHash } = computeImportFingerprint({
                empresaId,
                sucursalId,
                tipo,
                filas: filas.map(construirFilaFingerprint)
            })
            leaseToken = crypto.randomUUID()
            const inicio = await beginImportCommand(prisma, {
                empresaId,
                usuarioId,
                sucursalId,
                claveIdempotencia: validacionKey.key,
                fingerprintHash,
                tipo,
                totalFilas,
                leaseToken,
            })
            const respuestaInicio = enviarResultadoInicio(res, inicio)
            if (respuestaInicio) return respuestaInicio

            importacionId = inicio.importacionId
            leaseToken = inicio.leaseToken
            for (const fila of filas) {
                const leaseVigente = await renewLease(prisma, importacionId, leaseToken, LEASE_DURATION_MS)
                if (!leaseVigente) {
                    const error = new Error('La importación perdió su lease de ejecución.')
                    error.code = 'IMPORT_LEASE_LOST'
                    throw error
                }
                await procesarFilaIdempotente({
                    importacionId,
                    fila,
                    tipo,
                    empresaId,
                    sucursalId,
                    usuarioId,
                    leaseToken,
                })
            }

            const { counts, respuesta } = await construirRespuestaIdempotente(importacionId, totalFilas, tipo)
            await finalizeImport(prisma, { importacionId, leaseToken, counts, respuesta })
            return res.json(respuesta)
        } catch (error) {
            console.error('Error en importación idempotente:', error)
            if (error.code === 'IMPORT_LEASE_LOST') {
                return res.status(409).json({ code: 'IMPORT_LEASE_LOST', error: 'La importación fue retomada por otra ejecución.' })
            }

            const respuesta = {
                code: 'IMPORTACION_FALLIDA',
                error: 'Error en la importación. Revisa el archivo e intenta de nuevo.',
                total: totalFilas,
                creados: 0,
                actualizados: 0,
                omitidos: 0,
                errores: 0,
                vinculaciones: 0,
                advertencias: 0,
            }
            if (importacionId && leaseToken) {
                try {
                    const counts = await aggregateFromDetails(prisma, importacionId)
                    Object.assign(respuesta, counts)
                    await failImport(prisma, { importacionId, leaseToken, counts, respuesta })
                } catch (finalizeError) {
                    if (finalizeError.code === 'IMPORT_LEASE_LOST') {
                        return res.status(409).json({ code: 'IMPORT_LEASE_LOST', error: 'La importación fue retomada por otra ejecución.' })
                    }
                    console.error('No se pudo persistir el fallo de importación:', finalizeError)
                }
            }
            return res.status(500).json(respuesta)
        }
    }
}

exports.importarCSV = crearHandlerImportacionIdempotente('upsert', importarCSVLegacy)
exports.importarSoloNuevos = crearHandlerImportacionIdempotente('solo_nuevos', importarSoloNuevosLegacy)
