const API_URL = 'http://localhost:3000'
const TOKEN = localStorage.getItem('jesha_token')
let datosCSV = []
let archivoActual = null

document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('drop-zone')
  const fileInput = document.getElementById('archivo-input')

  // Drag & drop
  dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.classList.add('dragover')
  })

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover')
  })

  dropZone.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.classList.remove('dragover')
    if (e.dataTransfer.files.length > 0) {
      procesarArchivo(e.dataTransfer.files[0])
    }
  })

  fileInput.addEventListener('change', e => {
    if (e.target.files.length > 0) {
      procesarArchivo(e.target.files[0])
    }
  })

  document.getElementById('btn-importar').addEventListener('click', importar)
  document.getElementById('btn-cancelar').addEventListener('click', cancelar)
})

function procesarArchivo(archivo) {
  archivoActual = archivo
  const reader = new FileReader()
  
  reader.onload = e => {
    const contenido = e.target.result
    parsearCSV(contenido)
  }
  
  reader.readAsText(archivo)
}

function parsearCSV(contenido) {
  try {
    const lineas = contenido.split('\n').filter(l => l.trim())
    const headers = lineas[0].split(',').map(h => h.trim())
    
    datosCSV = lineas.slice(1).map(linea => {
      const valores = linea.split(',')
      const obj = {}
      headers.forEach((h, i) => {
        obj[h] = valores[i]?.trim() || ''
      })
      return obj
    }).filter(obj => Object.values(obj).some(v => v))

    mostrarPreview(headers, datosCSV.slice(0, 10))
  } catch (error) {
    alert('❌ Error al procesar el archivo: ' + error.message)
  }
}

function mostrarPreview(headers, datos) {
  document.getElementById('nombre-archivo').textContent = archivoActual?.name || '-'
  document.getElementById('total-filas').textContent = datosCSV.length
  document.getElementById('total-columnas').textContent = headers.length

  // Encabezados
  const previewHeaders = document.getElementById('preview-headers')
  previewHeaders.innerHTML = headers.map(h => `<th>${h}</th>`).join('')

  // Datos (primeras 10)
  const previewBody = document.getElementById('preview-body')
  previewBody.innerHTML = datos.map(row => 
    `<tr>${headers.map(h => `<td>${row[h] || '-'}</td>`).join('')}</tr>`
  ).join('')

  document.getElementById('preview-section').style.display = 'block'
}

async function importar() {
  if (datosCSV.length === 0) {
    alert('❌ No hay datos para importar')
    return
  }

  if (!confirm(`¿Importar ${datosCSV.length} productos? Esta acción puede tardar algunos minutos.`)) {
    return
  }

  try {
    document.getElementById('progress-section').style.display = 'block'
    document.getElementById('resultado-box').style.display = 'none'
    document.getElementById('btn-importar').disabled = true

    // Crear FormData con el archivo
    const formData = new FormData()
    formData.append('archivo', archivoActual)

    const response = await fetch(`${API_URL}/productos/importar/csv`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
      body: formData
    })

    const resultado = await response.json()

    if (!response.ok) {
      throw new Error(resultado.error || 'Error en importación')
    }

    // Mostrar resultado
    document.getElementById('progress-section').style.display = 'none'
    document.getElementById('resultado-box').style.display = 'block'
    document.getElementById('resultado-creados').textContent = resultado.resumen.creados
    document.getElementById('resultado-actualizados').textContent = resultado.resumen.actualizados
    document.getElementById('resultado-errores').textContent = resultado.resumen.errores

    setTimeout(() => {
      if (confirm('✅ Importación completada. ¿Ir al inventario para verificar?')) {
        window.location.href = 'productos.html'
      }
    }, 1000)

  } catch (error) {
    console.error('❌ Error:', error)
    alert('❌ Error en importación: ' + error.message)
  } finally {
    document.getElementById('btn-importar').disabled = false
  }
}

function cancelar() {
  datosCSV = []
  archivoActual = null
  document.getElementById('archivo-input').value = ''
  document.getElementById('preview-section').style.display = 'none'
  document.getElementById('resultado-box').style.display = 'none'
  document.getElementById('progress-section').style.display = 'none'
}