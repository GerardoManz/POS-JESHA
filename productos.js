/* ═══════════════════════════════════════════════════════════════════
   PRODUCTOS.JS — Frontend Inventario (CON ESTADÍSTICAS)
   
   AGREGADO:
   - Estadísticas de inventario (total, con stock, sin stock, bajo stock)
   - Mostrado en consola y en la página
   
   ═══════════════════════════════════════════════════════════════════ */


const API_URL = 'http://localhost:3000'
let TOKEN = localStorage.getItem('jesha_token')
let productosLista    = []
let departamentosLista = []
let categoriasLista   = []
let productoActual    = null

// Variables DOM — se asignan en DOMContentLoaded
let productosTbody, searchInput, filtroDepto, filtroCat
let btnNuevoProducto, modal, modalTitle, btnCancelModal, btnCloseModal
let formulario, inputImagen
let imagenPreviewContainer, imagenPreview, btnCambiarPreview

// ═══════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🌱 Iniciando productos...')

  if (!TOKEN) {
    console.error('❌ No hay token')
    window.location.href = 'login.html'
    return
  }

  // Capturar DOM aquí, cuando ya existe
  productosTbody         = document.getElementById('productos-tbody')
  searchInput            = document.getElementById('search-input')
  btnNuevoProducto       = document.getElementById('btn-nuevo-producto')
  modal                  = document.getElementById('modal-producto')
  modalTitle             = document.getElementById('modal-title')
  btnCancelModal         = document.getElementById('btn-cancel')
  btnCloseModal          = document.getElementById('modal-close-btn')
  formulario             = document.getElementById('producto-form')
  inputImagen            = document.getElementById('producto-imagen')
  imagenPreviewContainer = document.getElementById('imagen-preview-container')
  imagenPreview          = document.getElementById('imagen-preview')
  btnCambiarPreview      = document.getElementById('btn-cambiar-preview')

  console.log('✅ Token encontrado')

  await cargarDepartamentos()
  await cargarCategorias()
  await cargarProductos()

  configurarEventos()
  actualizarFecha()
  setInterval(actualizarFecha, 60000)
})

// ═══════════════════════════════════════════════════════════════════
// CARGA DE DATOS
// ═══════════════════════════════════════════════════════════════════

async function cargarDepartamentos() {
  try {
    const response = await fetch(`${API_URL}/productos/departamentos`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!response.ok) throw new Error(`Error ${response.status}`)
    const resultado = await response.json()
    departamentosLista = resultado.data || resultado
    console.log('✅ Departamentos:', departamentosLista.length)
    llenarSelectDepartamentos()
  } catch (error) {
    console.error('❌ Error cargando departamentos:', error)
  }
}

async function cargarCategorias() {
  try {
    const response = await fetch(`${API_URL}/productos/categorias`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!response.ok) throw new Error(`Error ${response.status}`)
    const resultado = await response.json()
    categoriasLista = resultado.data || resultado
    console.log('✅ Categorías:', categoriasLista.length)
  } catch (error) {
    console.error('❌ Error cargando categorías:', error)
  }
}

async function cargarProductos() {
  try {
    console.log('📦 Cargando productos...')
    mostrarLoadingTabla()

    const response = await fetch(`${API_URL}/productos`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!response.ok) throw new Error(`Error ${response.status}`)

    const resultado = await response.json()
    productosLista = resultado.data || resultado
    console.log('✅ Productos cargados:', productosLista.length)
    
    // MOSTRAR ESTADÍSTICAS
    mostrarEstadisticasInventario(productosLista)
    
    renderizarTabla(productosLista)

  } catch (error) {
    console.error('❌ Error cargando productos:', error)
    if (productosTbody) {
      productosTbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; color:#ff9999; padding:30px;">
            ❌ Error: ${error.message}
            <br/><br/>
            <button onclick="cargarProductos()" class="btn-secondary">Reintentar</button>
          </td>
        </tr>
      `
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ESTADÍSTICAS DE INVENTARIO
// ═══════════════════════════════════════════════════════════════════

function mostrarEstadisticasInventario(productos) {
  // Calcular estadísticas
  const totalProductos = productos.length
  const conStock = productos.filter(p => p.inventario && p.inventario.stockActual > 0).length
  const sinStock = productos.filter(p => !p.inventario || p.inventario.stockActual === 0).length
  const bajoStock = productos.filter(p => 
    p.inventario && 
    p.inventario.stockActual > 0 && 
    p.inventario.stockActual < p.inventario.stockMinimoAlerta
  ).length

  // MOSTRAR EN CONSOLA
  console.log(`
╔═══════════════════════════════════════════╗
║         📊 ESTADO DEL INVENTARIO          ║
╠═══════════════════════════════════════════╣
║ ✅ Total productos:    ${String(totalProductos).padEnd(19)}║
║ ✅ Con stock:          ${String(conStock).padEnd(19)}║
║ ❌ Sin stock:          ${String(sinStock).padEnd(19)}║
║ ⚠️  Bajo stock:        ${String(bajoStock).padEnd(19)}║
╚═══════════════════════════════════════════╝
  `)

  // MOSTRAR EN PÁGINA
  const headerContent = document.querySelector('.content-header')
  if (headerContent) {
    let resumenDiv = document.getElementById('resumen-inventario')
    
    if (!resumenDiv) {
      resumenDiv = document.createElement('div')
      resumenDiv.id = 'resumen-inventario'
      headerContent.appendChild(resumenDiv)
    }

    resumenDiv.style.cssText = `
      margin-top: 15px;
      padding: 12px 15px;
      background: #6f758624;
      border-left: 4px solid #3b82f6;
      border-radius: 6px;
      font-size: 13px;
      color: #ffffff;
    `

    resumenDiv.innerHTML = `
      <strong>📊 Inventario:</strong> 
      ${totalProductos} total | 
      <span style="color: #16a34a;">✅ ${conStock} con stock</span> | 
      <span style="color: #dc2626;">❌ ${sinStock} sin stock</span> | 
      <span style="color: #ea580c;">⚠️ ${bajoStock} bajo stock</span>
    `
  }

  // MOSTRAR PRODUCTOS SIN STOCK EN CONSOLA
  const sinStockProductos = productos.filter(p => !p.inventario || p.inventario.stockActual === 0)
  if (sinStockProductos.length > 0) {
    console.log('\n📋 PRODUCTOS SIN STOCK:\n')
    sinStockProductos.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.nombre} (${p.codigoInterno})`)
    })
  }
}

// ═══════════════════════════════════════════════════════════════════
// RENDERIZAR TABLA
// ═══════════════════════════════════════════════════════════════════

function mostrarLoadingTabla() {
  if (!productosTbody) return
  productosTbody.innerHTML = `
    <tr class="loading-row">
      <td colspan="8" style="text-align:center; padding:40px;">
        <div class="spinner"></div>
        <p style="margin-top:12px; color:var(--muted);">Cargando productos...</p>
      </td>
    </tr>
  `
}

function renderizarTabla(productos) {
  if (!productosTbody) return

  if (productos.length === 0) {
    productosTbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:40px; color:var(--muted);">
          No hay productos para mostrar
        </td>
      </tr>
    `
    return
  }

  productosTbody.innerHTML = productos.map(p => {
    const stock    = p.inventario?.stockActual       ?? '-'
    const minStock = p.inventario?.stockMinimoAlerta ?? '-'
    const stockBajo = typeof stock === 'number' && typeof minStock === 'number' && stock <= minStock

    return `
      <tr>
        <td>${p.codigoInterno || '-'}</td>
        <td>
          <strong>${p.nombre}</strong>
          ${p.codigoBarras ? `<br/><small style="color:var(--muted)">${p.codigoBarras}</small>` : ''}
        </td>
        <td>${p.categoria?.nombre || '-'}</td>
        <td>$${parseFloat(p.precioBase || 0).toFixed(2)}</td>
        <td style="color:${stockBajo ? '#ff9999' : 'inherit'}">${stock}</td>
        <td>${minStock}</td>
        <td>
          <span class="estado-badge ${p.activo ? 'activo' : 'inactivo'}">
            ${p.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td>
          <div class="actions-cell">
            <button class="btn-icon" onclick="editarProducto(${p.id})" title="Editar">✏️</button>
            <button class="btn-icon" onclick="toggleEstadoProducto(${p.id}, ${!p.activo})"
              title="${p.activo ? 'Desactivar' : 'Activar'}">
              ${p.activo ? '👁️' : '🔒'}
            </button>
          </div>
        </td>
      </tr>
    `
  }).join('')
}

// ═══════════════════════════════════════════════════════════════════
// BÚSQUEDA
// ═══════════════════════════════════════════════════════════════════

function buscarYFiltrar() {
  const texto = searchInput ? searchInput.value.toLowerCase() : ''
  const filtrados = productosLista.filter(p =>
    p.nombre.toLowerCase().includes(texto) ||
    (p.codigoInterno && p.codigoInterno.toLowerCase().includes(texto)) ||
    (p.codigoBarras  && p.codigoBarras.toLowerCase().includes(texto))
  )
  renderizarTabla(filtrados)
}

// ═══════════════════════════════════════════════════════════════════
// SELECTS
// ═══════════════════════════════════════════════════════════════════

function llenarSelectDepartamentos() {
  const selectDept = document.getElementById('producto-departamento')
  if (!selectDept) return
  while (selectDept.options.length > 1) selectDept.remove(1)
  departamentosLista.forEach(dept => {
    const opt = document.createElement('option')
    opt.value = dept.id
    opt.textContent = `${dept.icono || '📦'} ${dept.nombre}`
    selectDept.appendChild(opt)
  })
}

function actualizarSelectCategorias() {
  const selectCat = document.getElementById('producto-categoria')
  const deptVal   = document.getElementById('producto-departamento')?.value
  if (!selectCat || !deptVal) return
  while (selectCat.options.length > 1) selectCat.remove(1)
  const catFilt = categoriasLista.filter(c => c.departamentoId === parseInt(deptVal))
  catFilt.forEach(cat => {
    const opt = document.createElement('option')
    opt.value = cat.id
    opt.textContent = cat.nombre
    selectCat.appendChild(opt)
  })
}

// ═══════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════

window.editarProducto = async function(id) {
  const producto = productosLista.find(p => p.id === id)
  if (!producto) return

  productoActual = producto
  if (modalTitle) modalTitle.textContent = 'Editar Producto'

  document.getElementById('producto-nombre').value             = producto.nombre
  document.getElementById('producto-codigo').value             = producto.codigoInterno
  document.getElementById('producto-codigoBarras').value       = producto.codigoBarras || ''
  document.getElementById('producto-descripcion').value        = producto.descripcion || ''
  document.getElementById('producto-costo').value              = producto.costo || ''
  document.getElementById('producto-precioBase').value         = producto.precioBase
  document.getElementById('producto-unidadCompra').value       = producto.unidadCompra || ''
  document.getElementById('producto-unidadVenta').value        = producto.unidadVenta || ''
  document.getElementById('producto-factorConversion').value   = producto.factorConversion || ''
  document.getElementById('producto-claveSat').value           = producto.claveSat || ''
  document.getElementById('producto-unidadSat').value          = producto.unidadSat || ''

  actualizarSelectCategorias()
  document.getElementById('producto-categoria').value = producto.categoriaId || ''

  ocultarError()
  if (modal) modal.classList.add('active')
}

function cerrarModal() {
  if (modal) modal.classList.remove('active')
  if (formulario) formulario.reset()
  if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'none'
  productoActual = null
}

// ═══════════════════════════════════════════════════════════════════
// GUARDAR
// ═══════════════════════════════════════════════════════════════════

async function guardarProducto(e) {
  e.preventDefault()
  ocultarError()

  const nombre     = document.getElementById('producto-nombre').value.trim()
  const codigo     = document.getElementById('producto-codigo').value.trim()
  const categoria  = document.getElementById('producto-categoria').value
  const precioBase = document.getElementById('producto-precioBase').value

  if (!nombre)     return mostrarError('El nombre es requerido')
  if (!codigo)     return mostrarError('El código interno es requerido')
  if (!categoria)  return mostrarError('La categoría es requerida')
  if (!precioBase) return mostrarError('El precio de venta es requerido')

  const datos = {
    nombre,
    codigoInterno:    codigo,
    codigoBarras:     document.getElementById('producto-codigoBarras').value.trim()          || null,
    descripcion:      document.getElementById('producto-descripcion').value.trim()           || null,
    costo:            parseFloat(document.getElementById('producto-costo').value)            || null,
    precioBase:       parseFloat(precioBase),
    categoriaId:      parseInt(categoria),
    unidadCompra:     document.getElementById('producto-unidadCompra').value.trim()          || null,
    unidadVenta:      document.getElementById('producto-unidadVenta').value.trim()           || null,
    factorConversion: parseFloat(document.getElementById('producto-factorConversion').value) || null,
    claveSat:         document.getElementById('producto-claveSat').value.trim()              || null,
    unidadSat:        document.getElementById('producto-unidadSat').value.trim()             || null
  }

  try {
    const metodo = productoActual ? 'PUT' : 'POST'
    const url    = productoActual
      ? `${API_URL}/productos/${productoActual.id}`
      : `${API_URL}/productos`

    const response = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify(datos)
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || `Error ${response.status}`)
    }

    const resultado        = await response.json()
    const productoGuardado = resultado.data || resultado

    if (inputImagen && inputImagen.files.length > 0) {
      await subirImagen(productoGuardado.id, inputImagen.files[0])
    }

    cerrarModal()
    await cargarProductos()

  } catch (error) {
    console.error('❌ Error guardando:', error)
    mostrarError(error.message)
  }
}

// ═══════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════

window.toggleEstadoProducto = async function(id, nuevoEstado) {
  try {
    const response = await fetch(`${API_URL}/productos/${id}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ activo: nuevoEstado })
    })
    if (!response.ok) throw new Error(`Error ${response.status}`)
    await cargarProductos()
  } catch (error) {
    console.error('❌ Error cambiando estado:', error)
    alert('Error al cambiar estado del producto')
  }
}

// ═══════════════════════════════════════════════════════════════════
// IMAGEN
// ═══════════════════════════════════════════════════════════════════

async function subirImagen(productoId, archivo) {
  try {
    const formData = new FormData()
    formData.append('imagen', archivo)
    const response = await fetch(`${API_URL}/productos/${productoId}/imagen`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
      body: formData
    })
    if (!response.ok) throw new Error(`Error ${response.status}`)
    console.log('✅ Imagen subida')
  } catch (error) {
    console.error('❌ Error subiendo imagen:', error)
  }
}

// ═══════════════════════════════════════════════════════════════════
// MARGEN
// ═══════════════════════════════════════════════════════════════════

function calcularMargen() {
  const costo  = parseFloat(document.getElementById('producto-costo').value)     || 0
  const precio = parseFloat(document.getElementById('producto-precioBase').value) || 0
  const info   = document.getElementById('info-margen')
  if (!info) return
  if (costo > 0 && precio > 0) {
    document.getElementById('margen-valor').textContent = (((precio - costo) / costo) * 100).toFixed(1) + '%'
    info.style.display = 'block'
  } else {
    info.style.display = 'none'
  }
}

// ═══════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════

function mostrarError(msg) {
  const el = document.getElementById('producto-error')
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
}

function ocultarError() {
  const el = document.getElementById('producto-error')
  if (!el) return
  el.textContent = ''
  el.classList.remove('show')
}

function actualizarFecha() {
  const el = document.getElementById('fecha-actual') || document.querySelector('.content-header p')
  if (!el) return
  el.textContent = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

// ═══════════════════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════════════════

function configurarEventos() {
  if (btnNuevoProducto) {
    btnNuevoProducto.addEventListener('click', () => {
      productoActual = null
      if (modalTitle) modalTitle.textContent = 'Nuevo Producto'
      if (formulario) formulario.reset()
      actualizarSelectCategorias()
      ocultarError()
      if (modal) modal.classList.add('active')
    })
  }

  if (btnCancelModal)   btnCancelModal.addEventListener('click', cerrarModal)
  if (btnCloseModal)    btnCloseModal.addEventListener('click', cerrarModal)
  if (formulario)       formulario.addEventListener('submit', guardarProducto)

  if (searchInput) {
    searchInput.addEventListener('input', buscarYFiltrar)
    searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') buscarYFiltrar() })
  }

  const deptSelect = document.getElementById('producto-departamento')
  if (deptSelect) deptSelect.addEventListener('change', actualizarSelectCategorias)

  const inputCosto  = document.getElementById('producto-costo')
  const inputPrecio = document.getElementById('producto-precioBase')
  if (inputCosto)  inputCosto.addEventListener('input', calcularMargen)
  if (inputPrecio) inputPrecio.addEventListener('input', calcularMargen)

  if (modal) modal.addEventListener('click', e => { if (e.target === modal) cerrarModal() })

  if (inputImagen) {
    inputImagen.addEventListener('change', e => {
      const archivo = e.target.files[0]
      if (!archivo) return
      const reader = new FileReader()
      reader.onload = ev => {
        if (imagenPreview) imagenPreview.src = ev.target.result
        if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'block'
      }
      reader.readAsDataURL(archivo)
    })
  }

  if (btnCambiarPreview) {
    btnCambiarPreview.addEventListener('click', e => {
      e.preventDefault()
      if (inputImagen) inputImagen.click()
    })
  }
}