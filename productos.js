/* ═══════════════════════════════════════════════════════════════════
   PRODUCTOS.JS — Frontend Inventario CORREGIDO
   
   FIXES:
   - Departamento y categoría se muestran en tabla
   - Modal llena departamentos y categorías correctamente
   - Selector cascada: depto → categoría en el modal
   - Opción de crear nuevos departamentos/categorías desde el modal
   - Filtros del toolbar separados de los selects del modal
   
   ═══════════════════════════════════════════════════════════════════ */

const API_URL = 'http://localhost:3000'
let TOKEN = localStorage.getItem('jesha_token')
let productosLista     = []
let departamentosLista = []
let categoriasLista    = []
let productoActual     = null

// Variables DOM
let productosTbody, searchInput, filtroDepto, filtroCat
let btnNuevoProducto, modal, modalTitle, btnCancelModal, btnCloseModal
let formulario, inputImagen
let imagenPreviewContainer, imagenPreview, btnCambiarPreview
let btnLimpiarFiltros

// Selects del modal (separados del toolbar)
let modalDeptoSelect, modalCatSelect

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

  // Capturar elementos DOM — TOOLBAR
  productosTbody         = document.getElementById('productos-tbody')
  searchInput            = document.getElementById('search-input')
  filtroDepto            = document.getElementById('filtro-departamento')
  filtroCat              = document.getElementById('filtro-categoria')
  btnNuevoProducto       = document.getElementById('btn-nuevo-producto')
  btnLimpiarFiltros      = document.getElementById('btn-limpiar-filtros')

  // Capturar elementos DOM — MODAL
  modal                  = document.getElementById('modal-producto')
  modalTitle             = document.getElementById('modal-title')
  btnCancelModal         = document.getElementById('btn-cancel')
  btnCloseModal          = document.getElementById('modal-close-btn')
  formulario             = document.getElementById('producto-form')
  inputImagen            = document.getElementById('producto-imagen')
  imagenPreviewContainer = document.getElementById('imagen-preview-container')
  imagenPreview          = document.getElementById('imagen-preview')
  btnCambiarPreview      = document.getElementById('btn-cambiar-preview')
  modalDeptoSelect       = document.getElementById('producto-departamento')
  modalCatSelect         = document.getElementById('producto-categoria')

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
    
    mostrarEstadisticasInventario(productosLista)
    aplicarFiltros()

  } catch (error) {
    console.error('❌ Error cargando productos:', error)
    if (productosTbody) {
      productosTbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center; color:#ff9999; padding:30px;">
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
  const totalProductos = productos.length
  const conStock = productos.filter(p => p.inventario && p.inventario.stockActual > 0).length
  const sinStock = productos.filter(p => !p.inventario || p.inventario.stockActual === 0).length
  const bajoStock = productos.filter(p => 
    p.inventario && p.inventario.stockActual > 0 && p.inventario.stockActual < p.inventario.stockMinimoAlerta
  ).length

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
      background: #f3f4f620;
      border-left: 4px solid #3b82f6;
      border-radius: 6px;
      font-size: 13px;
      color: #ffffff;
    `
    resumenDiv.style.display = 'block'

    resumenDiv.innerHTML = `
      <strong>📊 Inventario:</strong> 
      ${totalProductos} total | 
      <span style="color: #16a34a;">✅ ${conStock} con stock</span> | 
      <span style="color: #dc2626;">❌ ${sinStock} sin stock</span> | 
      <span style="color: #ea580c;">⚠️ ${bajoStock} bajo stock</span>
    `
  }
}

// ═══════════════════════════════════════════════════════════════════
// SELECTS — TOOLBAR (filtros)
// ═══════════════════════════════════════════════════════════════════

function llenarSelectDepartamentos() {
  // ── Toolbar ──
  if (filtroDepto) {
    while (filtroDepto.options.length > 1) filtroDepto.remove(1)
    departamentosLista.forEach(dept => {
      const opt = document.createElement('option')
      opt.value = dept.id
      opt.textContent = `${dept.icono || '📦'} ${dept.nombre}`
      filtroDepto.appendChild(opt)
    })
  }

  // ── Modal ──
  llenarModalDepartamentos()
}

function actualizarCategoriasFiltroToolbar() {
  if (!filtroCat) return
  const deptId = parseInt(filtroDepto.value)

  while (filtroCat.options.length > 1) filtroCat.remove(1)

  if (deptId) {
    const catFilt = categoriasLista.filter(c => c.departamentoId === deptId)
    catFilt.forEach(cat => {
      const opt = document.createElement('option')
      opt.value = cat.id
      opt.textContent = cat.nombre
      filtroCat.appendChild(opt)
    })
    filtroCat.disabled = false
  } else {
    filtroCat.disabled = true
    filtroCat.value = ''
  }
}

// ═══════════════════════════════════════════════════════════════════
// SELECTS — MODAL (departamento → categoría cascada)
// ═══════════════════════════════════════════════════════════════════

function llenarModalDepartamentos(selectedId = null) {
  if (!modalDeptoSelect) return

  // Guardar valor actual si no se especifica
  const currentVal = selectedId || modalDeptoSelect.value

  modalDeptoSelect.innerHTML = '<option value="">Seleccionar departamento...</option>'

  departamentosLista.forEach(dept => {
    const opt = document.createElement('option')
    opt.value = dept.id
    opt.textContent = dept.nombre
    if (parseInt(currentVal) === dept.id) opt.selected = true
    modalDeptoSelect.appendChild(opt)
  })

  // Opción de agregar nuevo
  const optNuevo = document.createElement('option')
  optNuevo.value = '__NUEVO_DEPTO__'
  optNuevo.textContent = '➕ Agregar nuevo departamento...'
  modalDeptoSelect.appendChild(optNuevo)
}

function actualizarModalCategorias(departamentoId, selectedCatId = null) {
  if (!modalCatSelect) return

  modalCatSelect.innerHTML = '<option value="">Seleccionar categoría...</option>'

  if (!departamentoId) {
    modalCatSelect.disabled = true
    return
  }

  const catFilt = categoriasLista.filter(c => c.departamentoId === parseInt(departamentoId))
  catFilt.forEach(cat => {
    const opt = document.createElement('option')
    opt.value = cat.id
    opt.textContent = cat.nombre
    if (selectedCatId && parseInt(selectedCatId) === cat.id) opt.selected = true
    modalCatSelect.appendChild(opt)
  })

  // Opción de agregar nueva
  const optNuevo = document.createElement('option')
  optNuevo.value = '__NUEVA_CAT__'
  optNuevo.textContent = '➕ Agregar nueva categoría...'
  modalCatSelect.appendChild(optNuevo)

  modalCatSelect.disabled = false
}

// ═══════════════════════════════════════════════════════════════════
// CREAR NUEVO DEPARTAMENTO / CATEGORÍA
// ═══════════════════════════════════════════════════════════════════

async function crearNuevoDepartamento() {
  const nombre = prompt('Nombre del nuevo departamento:')
  if (!nombre || !nombre.trim()) {
    modalDeptoSelect.value = ''
    return
  }

  try {
    const response = await fetch(`${API_URL}/productos/departamentos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({ nombre: nombre.trim() })
    })

    const json = await response.json()

    if (json.success) {
      const nuevoDepto = json.data
      // Agregar al array local
      if (!departamentosLista.find(d => d.id === nuevoDepto.id)) {
        departamentosLista.push(nuevoDepto)
        departamentosLista.sort((a, b) => a.nombre.localeCompare(b.nombre))
      }
      // Actualizar ambos selects
      llenarSelectDepartamentos()
      // Seleccionar el nuevo en el modal
      llenarModalDepartamentos(nuevoDepto.id)
      // Cargar categorías (vacías para depto nuevo)
      actualizarModalCategorias(nuevoDepto.id)
      console.log(`✅ Departamento creado: ${nuevoDepto.nombre}`)
    } else {
      alert('Error: ' + json.error)
      modalDeptoSelect.value = ''
    }
  } catch (err) {
    console.error('❌ Error creando departamento:', err)
    alert('Error de conexión al crear departamento')
    modalDeptoSelect.value = ''
  }
}

async function crearNuevaCategoria() {
  const departamentoId = modalDeptoSelect.value

  if (!departamentoId || departamentoId === '__NUEVO_DEPTO__') {
    alert('Selecciona un departamento primero')
    modalCatSelect.value = ''
    return
  }

  const nombre = prompt('Nombre de la nueva categoría:')
  if (!nombre || !nombre.trim()) {
    modalCatSelect.value = ''
    return
  }

  try {
    const response = await fetch(`${API_URL}/productos/categorias`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({
        nombre: nombre.trim(),
        departamentoId: parseInt(departamentoId)
      })
    })

    const json = await response.json()

    if (json.success) {
      const nuevaCat = json.data
      // Agregar al array local
      if (!categoriasLista.find(c => c.id === nuevaCat.id)) {
        categoriasLista.push(nuevaCat)
      }
      // Recargar categorías del modal con la nueva seleccionada
      actualizarModalCategorias(departamentoId, nuevaCat.id)
      console.log(`✅ Categoría creada: ${nuevaCat.nombre}`)
    } else {
      alert('Error: ' + json.error)
      modalCatSelect.value = ''
    }
  } catch (err) {
    console.error('❌ Error creando categoría:', err)
    alert('Error de conexión al crear categoría')
    modalCatSelect.value = ''
  }
}

// ═══════════════════════════════════════════════════════════════════
// FILTRADO Y BÚSQUEDA (toolbar)
// ═══════════════════════════════════════════════════════════════════

function aplicarFiltros() {
  const deptId = parseInt(filtroDepto?.value) || null
  const catId = parseInt(filtroCat?.value) || null
  const busqueda = (searchInput?.value || '').toLowerCase().trim()

  let filtrados = productosLista

  // Filtrar por departamento
  if (deptId) {
    filtrados = filtrados.filter(p => {
      return p.categoria?.departamento?.id === deptId
    })
  }

  // Filtrar por categoría
  if (catId) {
    filtrados = filtrados.filter(p => p.categoriaId === catId)
  }

  // Filtrar por búsqueda
  if (busqueda) {
    filtrados = filtrados.filter(p =>
      p.nombre.toLowerCase().includes(busqueda) ||
      (p.codigoInterno && p.codigoInterno.toLowerCase().includes(busqueda)) ||
      (p.codigoBarras && p.codigoBarras.toLowerCase().includes(busqueda)) ||
      (p.categoria?.nombre && p.categoria.nombre.toLowerCase().includes(busqueda)) ||
      (p.categoria?.departamento?.nombre && p.categoria.departamento.nombre.toLowerCase().includes(busqueda))
    )
  }

  renderizarTabla(filtrados)
}

function limpiarFiltros() {
  if (filtroDepto) filtroDepto.value = ''
  if (filtroCat) { filtroCat.value = ''; filtroCat.disabled = true }
  if (searchInput) searchInput.value = ''
  
  actualizarCategoriasFiltroToolbar()
  aplicarFiltros()
  console.log('🔄 Filtros limpiados')
}

// ═══════════════════════════════════════════════════════════════════
// RENDERIZAR TABLA
// ═══════════════════════════════════════════════════════════════════

function mostrarLoadingTabla() {
  if (!productosTbody) return
  productosTbody.innerHTML = `
    <tr class="loading-row">
      <td colspan="9" style="text-align:center; padding:40px;">
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
        <td colspan="9" style="text-align:center; padding:40px; color:var(--muted);">
          <div class="empty-state">
            <p>📭 No hay productos para mostrar</p>
            <small>Ajusta los filtros o realiza una búsqueda diferente</small>
          </div>
        </td>
      </tr>
    `
    return
  }

  productosTbody.innerHTML = productos.map(p => {
    const stock    = p.inventario?.stockActual       ?? '-'
    const minStock = p.inventario?.stockMinimoAlerta ?? '-'
    const stockBajo = typeof stock === 'number' && typeof minStock === 'number' && stock <= minStock

    const deptoNombre = p.categoria?.departamento?.nombre || ''
    const catNombre   = p.categoria?.nombre || '-'

    return `
      <tr>
        <td>${p.codigoInterno || '-'}</td>
        <td>
          <strong>${p.nombre}</strong>
          ${p.codigoBarras ? `<br/><small style="color:var(--muted)">${p.codigoBarras}</small>` : ''}
        </td>
        <td>
          ${deptoNombre ? `<small style="color:var(--muted); display:block; font-size:0.7rem;">${deptoNombre}</small>` : ''}
          <span class="categoria-badge">${catNombre}</span>
        </td>
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
// MODAL — ABRIR / CERRAR
// ═══════════════════════════════════════════════════════════════════

window.editarProducto = async function(id) {
  const producto = productosLista.find(p => p.id === id)
  if (!producto) return

  productoActual = producto
  if (modalTitle) modalTitle.textContent = 'Editar Producto'

  // Llenar campos
  document.getElementById('producto-nombre').value           = producto.nombre
  document.getElementById('producto-codigo').value           = producto.codigoInterno
  document.getElementById('producto-codigoBarras').value     = producto.codigoBarras || ''
  document.getElementById('producto-descripcion').value      = producto.descripcion || ''
  document.getElementById('producto-costo').value            = producto.costo || ''
  document.getElementById('producto-precioBase').value       = producto.precioBase
  document.getElementById('producto-unidadCompra').value     = producto.unidadCompra || ''
  document.getElementById('producto-unidadVenta').value      = producto.unidadVenta || ''
  document.getElementById('producto-factorConversion').value = producto.factorConversion || ''
  document.getElementById('producto-claveSat').value         = producto.claveSat || ''
  document.getElementById('producto-unidadSat').value        = producto.unidadSat || ''

  // Llenar departamento y categoría del modal
  const deptoId = producto.categoria?.departamento?.id || ''
  llenarModalDepartamentos(deptoId)
  if (deptoId) {
    actualizarModalCategorias(deptoId, producto.categoriaId)
  }

  // Imagen preview
  if (producto.imagenUrl) {
    if (imagenPreview) imagenPreview.src = producto.imagenUrl
    if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'block'
  } else {
    if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'none'
  }

  calcularMargen()
  ocultarError()
  if (modal) modal.classList.add('active')
}

function abrirModalNuevo() {
  productoActual = null
  if (modalTitle) modalTitle.textContent = 'Nuevo Producto'
  if (formulario) formulario.reset()
  
  // Reset selects del modal
  llenarModalDepartamentos()
  if (modalCatSelect) {
    modalCatSelect.innerHTML = '<option value="">Seleccionar categoría...</option>'
    modalCatSelect.disabled = true
  }

  if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'none'
  if (document.getElementById('info-margen')) document.getElementById('info-margen').style.display = 'none'
  
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
  const categoria  = modalCatSelect?.value
  const precioBase = document.getElementById('producto-precioBase').value

  if (!nombre)     return mostrarError('El nombre es requerido')
  if (!codigo)     return mostrarError('El código interno es requerido')
  if (!categoria || categoria === '__NUEVA_CAT__') return mostrarError('La categoría es requerida')
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
  // Nuevo producto
  if (btnNuevoProducto) {
    btnNuevoProducto.addEventListener('click', abrirModalNuevo)
  }

  // Cerrar modal
  if (btnCancelModal) btnCancelModal.addEventListener('click', cerrarModal)
  if (btnCloseModal)  btnCloseModal.addEventListener('click', cerrarModal)
  if (formulario)     formulario.addEventListener('submit', guardarProducto)

  // ── Filtros del TOOLBAR ──
  if (filtroDepto) {
    filtroDepto.addEventListener('change', () => {
      actualizarCategoriasFiltroToolbar()
      aplicarFiltros()
    })
  }
  if (filtroCat) {
    filtroCat.addEventListener('change', aplicarFiltros)
  }
  if (searchInput) {
    searchInput.addEventListener('input', aplicarFiltros)
    searchInput.addEventListener('keypress', e => { 
      if (e.key === 'Enter') aplicarFiltros()
    })
  }
  if (btnLimpiarFiltros) {
    btnLimpiarFiltros.addEventListener('click', limpiarFiltros)
  }

  // ── Selects del MODAL (separados del toolbar) ──
  if (modalDeptoSelect) {
    modalDeptoSelect.addEventListener('change', () => {
      const val = modalDeptoSelect.value
      if (val === '__NUEVO_DEPTO__') {
        crearNuevoDepartamento()
      } else if (val) {
        actualizarModalCategorias(parseInt(val))
      } else {
        if (modalCatSelect) {
          modalCatSelect.innerHTML = '<option value="">Seleccionar categoría...</option>'
          modalCatSelect.disabled = true
        }
      }
    })
  }

  if (modalCatSelect) {
    modalCatSelect.addEventListener('change', () => {
      if (modalCatSelect.value === '__NUEVA_CAT__') {
        crearNuevaCategoria()
      }
    })
  }

  // Modal background
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) cerrarModal() })

  // Imagen preview
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

  // Margen
  const inputCosto  = document.getElementById('producto-costo')
  const inputPrecio = document.getElementById('producto-precioBase')
  if (inputCosto)  inputCosto.addEventListener('input', calcularMargen)
  if (inputPrecio) inputPrecio.addEventListener('input', calcularMargen)
}