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

function mapearProducto(fila) {
    let codigoBarras = fila['CLAVE ALTERNA'] || null
    if (codigoBarras && esNotacionCientifica(codigoBarras)) {
        codigoBarras = null
    }

    // Stock inicial y mínimo desde el CSV
    const stockInicial = parseInt(fila['EXIST.']) || 0
    const stockMinimo  = parseInt(fila['INV_MIN']) || 5
    const stockMaximo  = parseInt(fila['INV_MAX']) || null
    const esGranel     = (fila['GRANEL (S/N)'] || '').toUpperCase().trim() === 'S'

    return {
        codigoInterno: fila['CLAVE'].trim(),
        codigoBarras,
        nombre: (fila['DESCRIPCION'] || '').trim(),
        descripcion: fila['CARACTERISTICAS'] || null,
        precioBase: parseFloat(fila['PRECIO 1']) || 0,
        costo: fila['PRECIO COMPRA'] ? parseFloat(fila['PRECIO COMPRA']) : null,
        claveSat:  fila['CLAVE SAT']  || '31162800',
        unidadSat: fila['UNIDAD SAT'] || 'H87',
        esGranel,
        activo: true,
        // Campos auxiliares no en BD directa — los usamos para el inventario
        _stockInicial: stockInicial,
        _stockMinimo:  stockMinimo,
        _stockMaximo:  stockMaximo,
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

/**
 * Busca categoriaId en el cache ya poblado (sin queries, sin race condition)
 */
function obtenerCategoriaIdDelCache(cacheCats, nombreDepto, nombreCat) {
    if (!nombreDepto || !nombreCat) return 1

    const key = `${nombreDepto.toUpperCase().trim()}|${nombreCat.trim()}`
    return cacheCats.get(key) || 1
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

        // ── Procesar productos en lotes ──
        let creados = 0
        let actualizados = 0
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
                        fila['CATEGORIA']
                    )

                    // Upsert: crear si no existe, actualizar si existe
                    const existente = await prisma.producto.findUnique({
                        where: { codigoInterno: data.codigoInterno }
                    })

                    if (existente) {
                        const { _stockInicial, _stockMinimo, _stockMaximo, ...dataSinAux } = data
                        await prisma.producto.update({
                            where: { codigoInterno: dataSinAux.codigoInterno },
                            data: {
                                nombre:       dataSinAux.nombre,
                                codigoBarras: dataSinAux.codigoBarras,
                                descripcion:  dataSinAux.descripcion,
                                precioBase:   dataSinAux.precioBase,
                                costo:        dataSinAux.costo,
                                claveSat:     dataSinAux.claveSat,
                                unidadSat:    dataSinAux.unidadSat,
                                esGranel:     dataSinAux.esGranel,
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
                        actualizados++
                    } else {
                        // Extraer campos auxiliares antes de insertar
                        const { _stockInicial, _stockMinimo, _stockMaximo, ...dataSinAux } = data

                        let productoCreado
                        try {
                            productoCreado = await prisma.producto.create({
                                data: { ...dataSinAux, categoriaId }
                            })
                        } catch (createErr) {
                            productoCreado = await prisma.producto.create({
                                data: { ...dataSinAux, codigoBarras: null, categoriaId }
                            })
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
                        creados++
                    }

                } catch (err) {
                    erroresInsert.push({
                        fila: numFila,
                        clave: fila['CLAVE'],
                        error: err.message.substring(0, 300)
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