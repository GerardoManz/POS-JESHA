// ═══════════════════════════════════════════════════════════════════
// IMPORTACION.JS — CORREGIDO
// FIX: Sube el archivo CSV como FormData (no parsea en el frontend)
// FIX: URL coincide con la ruta del backend: /productos/importar/csv
// FIX: Validación previa ahora detecta notación científica
// ═══════════════════════════════════════════════════════════════════

const token = localStorage.getItem('jesha_token')
const API_BASE = 'http://localhost:3000'

let archivoSeleccionado = null

// ═══════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════

function inicializar() {
    console.log('🔧 Inicializando importacion.js...')

    const fileInput = document.getElementById('csvFile')
    const validateBtn = document.getElementById('validateBtn')
    const importBtn = document.getElementById('importBtn')
    const resultDiv = document.getElementById('result')

    if (!fileInput || !validateBtn || !importBtn || !resultDiv) {
        console.error('❌ ERROR: Faltan elementos del DOM')
        return false
    }

    validateBtn.addEventListener('click', () => validarArchivo(fileInput, resultDiv, importBtn))
    importBtn.addEventListener('click', () => importarProductos(fileInput, resultDiv, importBtn))
    fileInput.addEventListener('change', () => actualizarNombreArchivo(fileInput))

    // Drag & drop
    const label = document.querySelector('.file-input-label')
    if (label) {
        label.addEventListener('dragover', (e) => {
            e.preventDefault()
            label.style.background = '#f0f2ff'
        })
        label.addEventListener('dragleave', () => {
            label.style.background = '#f8f9ff'
        })
        label.addEventListener('drop', (e) => {
            e.preventDefault()
            label.style.background = '#f8f9ff'
            fileInput.files = e.dataTransfer.files
            actualizarNombreArchivo(fileInput)
        })
    }

    console.log('✅ Importación inicializada')
    return true
}

// ═══════════════════════════════════════════════════════════════════
// ACTUALIZAR NOMBRE DE ARCHIVO
// ═══════════════════════════════════════════════════════════════════

function actualizarNombreArchivo(fileInput) {
    const fileName = fileInput.files[0]?.name || 'Ningún archivo seleccionado'
    const fileNameEl = document.querySelector('.file-name')
    if (fileNameEl) {
        fileNameEl.textContent = '📁 ' + fileName
    }
    archivoSeleccionado = fileInput.files[0] || null
}

// ═══════════════════════════════════════════════════════════════════
// PARSEO CSV (solo para validación local, NO para envío)
// ═══════════════════════════════════════════════════════════════════

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
                i++
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

function esNotacionCientifica(valor) {
    if (!valor) return false
    return /^[\d.]+[eE]\+\d+$/.test(valor.trim())
}

// ═══════════════════════════════════════════════════════════════════
// VALIDAR ARCHIVO (preview local antes de subir)
// ═══════════════════════════════════════════════════════════════════

async function validarArchivo(fileInput, resultDiv, importBtn) {
    console.log('🔍 Validando archivo...')

    if (!fileInput.files[0]) {
        mostrarError('Por favor selecciona un archivo CSV', resultDiv)
        return
    }

    try {
        const file = fileInput.files[0]
        const texto = await file.text()
        const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

        // Buscar header
        let headerIdx = 0
        while (headerIdx < lineas.length && !lineas[headerIdx].trim()) headerIdx++

        const header = parseCSVLine(lineas[headerIdx])
        console.log('📋 Headers:', header)

        // Verificar columnas requeridas
        const requeridas = ['CLAVE', 'DESCRIPCION', 'PRECIO 1']
        const faltantes = requeridas.filter(r => !header.some(h => h.includes(r)))
        if (faltantes.length > 0) {
            mostrarError(`❌ Columnas faltantes: ${faltantes.join(', ')}`, resultDiv)
            return
        }

        // Parsear filas para preview
        const idxClave = header.findIndex(h => h === 'CLAVE')
        const idxDesc = header.findIndex(h => h === 'DESCRIPCION')
        const idxPrecio = header.findIndex(h => h === 'PRECIO 1')
        const idxClaveSat = header.findIndex(h => h.includes('CLAVE SAT'))
        const idxUnidadSat = header.findIndex(h => h.includes('UNIDAD SAT'))

        let total = 0
        let sinClaveSat = 0
        let sinUnidadSat = 0
        let cientificas = 0
        let sinPrecio = 0
        let duplicados = 0
        const clavesVistas = new Set()

        for (let i = headerIdx + 1; i < lineas.length; i++) {
            const linea = lineas[i].trim()
            if (!linea) continue

            const valores = parseCSVLine(linea)
            const clave = (valores[idxClave] || '').trim()
            if (!clave) continue

            total++

            if (esNotacionCientifica(clave)) cientificas++

            if (clavesVistas.has(clave)) {
                duplicados++
            }
            clavesVistas.add(clave)

            const claveSat = idxClaveSat >= 0 ? (valores[idxClaveSat] || '').trim() : ''
            const unidadSat = idxUnidadSat >= 0 ? (valores[idxUnidadSat] || '').trim() : ''
            const precio = (valores[idxPrecio] || '').trim()

            if (!claveSat || claveSat.toLowerCase() === 'null') sinClaveSat++
            if (!unidadSat || unidadSat.toLowerCase() === 'null') sinUnidadSat++

            const precioNum = parseFloat(precio)
            if (!precio || isNaN(precioNum) || precioNum <= 0) sinPrecio++
        }

        // Mostrar resultados
        mostrarResultadosValidacion({
            total,
            cientificas,
            duplicados,
            sinClaveSat,
            sinUnidadSat,
            sinPrecio
        }, resultDiv, importBtn)

    } catch (error) {
        console.error('❌ Error al validar:', error)
        mostrarError('Error al procesar archivo: ' + error.message, resultDiv)
    }
}

// ═══════════════════════════════════════════════════════════════════
// MOSTRAR RESULTADOS DE VALIDACIÓN
// ═══════════════════════════════════════════════════════════════════

function mostrarResultadosValidacion(stats, resultDiv, importBtn) {
    const hayErroresCriticos = stats.sinPrecio > 0

    let html = `<div style="padding: 20px; background: #f9f9f9; border-radius: 8px;">
        <h3>📊 Validación de Archivo</h3>
        <p style="margin: 10px 0;"><strong>Total productos:</strong> ${stats.total}</p>`

    // Siempre mostrar resumen
    if (stats.cientificas > 0) {
        html += `<p style="color: #e67700; margin: 5px 0;">⚠️ ${stats.cientificas} CLAVEs en notación científica (Excel las corrompió). El servidor las detectará y omitirá.</p>`
    }
    if (stats.duplicados > 0) {
        html += `<p style="color: #e67700; margin: 5px 0;">⚠️ ${stats.duplicados} CLAVEs duplicadas. El servidor actualizará las existentes.</p>`
    }
    if (stats.sinClaveSat > 0) {
        html += `<p style="color: #868e96; margin: 5px 0;">ℹ️ ${stats.sinClaveSat} sin CLAVE SAT (se asignará 31162800 por defecto)</p>`
    }
    if (stats.sinUnidadSat > 0) {
        html += `<p style="color: #868e96; margin: 5px 0;">ℹ️ ${stats.sinUnidadSat} sin UNIDAD SAT (se asignará H87 por defecto)</p>`
    }
    if (stats.sinPrecio > 0) {
        html += `<p style="color: #fc8181; margin: 5px 0;">❌ ${stats.sinPrecio} sin PRECIO válido (serán omitidos)</p>`
    }

    if (stats.cientificas === 0 && stats.duplicados === 0 && stats.sinPrecio === 0) {
        html += `<p style="color: #48bb78; font-weight: bold; margin: 10px 0;">✅ TODO CORRECTO</p>`
    }

    // Habilitar importación si no hay errores críticos bloqueantes
    // (notación científica y duplicados se manejan en el servidor)
    if (!hayErroresCriticos || stats.sinPrecio < stats.total) {
        importBtn.disabled = false
        importBtn.style.opacity = '1'
        html += `<p style="color: #48bb78; margin: 10px 0;">
            <strong>✅ Listo para importar</strong> — Los productos válidos se crearán/actualizarán.
        </p>`
    } else {
        importBtn.disabled = true
        importBtn.style.opacity = '0.5'
    }

    html += '</div>'
    resultDiv.innerHTML = html
}

// ═══════════════════════════════════════════════════════════════════
// IMPORTAR — SUBE EL CSV COMO ARCHIVO (FormData)
// ═══════════════════════════════════════════════════════════════════

async function importarProductos(fileInput, resultDiv, importBtn) {
    if (!fileInput.files[0]) {
        mostrarError('Selecciona un archivo primero', resultDiv)
        return
    }

    console.log('🚀 Iniciando importación...')
    importBtn.disabled = true
    importBtn.textContent = '⏳ Importando...'

    try {
        // ── Enviar como FormData (archivo), NO como JSON ──
        const formData = new FormData()
        formData.append('archivo', fileInput.files[0])  // "archivo" debe coincidir con uploadCSV.single('archivo')

        const response = await fetch(`${API_BASE}/productos/importar/csv`, {
            method: 'POST',
            headers: {
                // NO poner Content-Type — FormData lo pone automáticamente con boundary
                'Authorization': `Bearer ${token}`
            },
            body: formData
        })

        const resultado = await response.json()

        if (!response.ok) {
            throw new Error(resultado.error || 'Error en la importación')
        }

        let mensaje = `✅ Importación completada\n`
        mensaje += `📦 Total en archivo: ${resultado.total}\n`
        mensaje += `✅ Creados: ${resultado.creados}\n`
        if (resultado.actualizados > 0) {
            mensaje += `🔄 Actualizados: ${resultado.actualizados}\n`
        }
        if (resultado.omitidos > 0) {
            mensaje += `⚠️ Omitidos (validación): ${resultado.omitidos}\n`
        }
        if (resultado.errores > 0) {
            mensaje += `❌ Errores: ${resultado.errores}\n`
        }

        // Mostrar detalle de errores si los hay
        if (resultado.detalleErrores && resultado.detalleErrores.length > 0) {
            mensaje += `\n── Detalle de errores ──\n`
            resultado.detalleErrores.slice(0, 10).forEach(err => {
                mensaje += `  Fila ${err.fila}: ${err.error}\n`
            })
            if (resultado.detalleErrores.length > 10) {
                mensaje += `  ... y ${resultado.detalleErrores.length - 10} más\n`
            }
        }

        mostrarExito(mensaje, resultDiv)
        console.log('✅ Importación exitosa')

    } catch (error) {
        console.error('❌ Error en importación:', error)
        mostrarError(`❌ Error: ${error.message}`, resultDiv)
    } finally {
        importBtn.disabled = false
        importBtn.textContent = '🚀 Importar Productos'
    }
}

// ═══════════════════════════════════════════════════════════════════
// UTILIDADES UI
// ═══════════════════════════════════════════════════════════════════

function mostrarError(mensaje, resultDiv) {
    resultDiv.innerHTML = `<div class="error-box">${mensaje}</div>`
    console.error(mensaje)
}

function mostrarExito(mensaje, resultDiv) {
    resultDiv.innerHTML = `<div class="exito-box">${mensaje.replace(/\n/g, '<br>')}</div>`
}

// ═══════════════════════════════════════════════════════════════════
// ARRANQUE
// ═══════════════════════════════════════════════════════════════════

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar)
} else {
    inicializar()
}

console.log('✅ importacion.js cargado')