/* ═══════════════════════════════════════════════════════════════════
   PRODUCTOS.JS — Frontend Inventario
   FIXES:
   - Departamento y categoría se muestran en tabla
   - Modal llena departamentos y categorías correctamente
   - Selector cascada: depto → categoría en el modal
   - Opción de crear nuevos departamentos/categorías desde el modal
   - Filtros del toolbar separados de los selects del modal
   - Botón "Subir Inventario" integrado con modal de importación CSV
   ═══════════════════════════════════════════════════════════════════ */


// Formatea stock: entero si no tiene decimales, decimal si los tiene
function fmtStock(val) {
  if (val === '-' || val === null || val === undefined) return '-'
  const n = parseFloat(val)
  if (isNaN(n)) return '-'
  return Number.isInteger(n) ? n.toString() : n.toFixed(3).replace(/\.?0+$/, '')
}
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'
let TOKEN = localStorage.getItem('jesha_token')
let productosLista     = []
let departamentosLista = []
let categoriasLista    = []
let proveedoresLista   = []
let productoActual     = null

// Total global
let totalProductos = 0

// Variables DOM
let productosTbody, searchInput, filtroDepto, filtroCat
let btnNuevoProducto, modal, modalTitle, btnCancelModal, btnCloseModal
let filtroStock
let formulario, inputImagen
let imagenPreviewContainer, imagenPreview, btnCambiarPreview
let btnLimpiarFiltros

// Selects del modal (separados del toolbar)
let modalDeptoSelect, modalCatSelect, modalProveedorSelect

// ═══════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🌱 Iniciando productos...')
  if (!TOKEN) { console.error('❌ No hay token'); window.location.href = 'login.html'; return }

  // Capturar elementos DOM — TOOLBAR
  productosTbody   = document.getElementById('productos-tbody')
  searchInput      = document.getElementById('search-input')
  filtroDepto      = document.getElementById('filtro-departamento')
  filtroCat        = document.getElementById('filtro-categoria')
  btnNuevoProducto = document.getElementById('btn-nuevo-producto')
  btnLimpiarFiltros = document.getElementById('btn-limpiar-filtros')
  filtroStock      = document.getElementById('filtro-stock')

  // Capturar elementos DOM — MODAL
  modal              = document.getElementById('modal-producto')
  modalTitle         = document.getElementById('modal-title')
  btnCancelModal     = document.getElementById('btn-cancel')
  btnCloseModal      = document.getElementById('modal-close-btn')
  formulario         = document.getElementById('producto-form')
  inputImagen        = document.getElementById('producto-imagen')
  imagenPreviewContainer = document.getElementById('imagen-preview-container')
  imagenPreview      = document.getElementById('imagen-preview')
  btnCambiarPreview  = document.getElementById('btn-cambiar-preview')
  modalDeptoSelect   = document.getElementById('producto-departamento')
  modalCatSelect     = document.getElementById('producto-categoria')
  modalProveedorSelect = document.getElementById('producto-proveedor')

  console.log('✅ Token encontrado')
  await cargarDepartamentos()
  await cargarCategorias()
  await cargarProveedores()
  await cargarProductos()
  configurarEventos()
  actualizarFecha()
  setInterval(actualizarFecha, 60000)

  // Inicializar módulo de importación
  initImportacion()

  // Inicializar ajuste de inventario
  initAjusteInventario()
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
  } catch (error) { console.error('❌ Error cargando departamentos:', error) }
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
  } catch (error) { console.error('❌ Error cargando categorías:', error) }
}

async function cargarProveedores() {
  try {
    const response = await fetch(`${API_URL}/compras/proveedores`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!response.ok) throw new Error(`Error ${response.status}`)
    const resultado = await response.json()
    proveedoresLista = resultado.data || resultado
    console.log('✅ Proveedores:', proveedoresLista.length)
    llenarSelectProveedores()
  } catch (error) { console.error('❌ Error cargando proveedores:', error) }
}

async function cargarProductos() {
  try {
    console.log('📦 Cargando productos...')
    mostrarLoadingTabla()
    const params = new URLSearchParams()
    const busqueda = searchInput?.value?.trim()
    if (busqueda) params.set('buscar', busqueda)
    const catId = filtroCat?.value
    if (catId) params.set('categoriaId', catId)
    const response = await fetch(`${API_URL}/productos?${params}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!response.ok) throw new Error(`Error ${response.status}`)
    const resultado = await response.json()
    productosLista = resultado.data || resultado
    if (resultado.paginacion) totalProductos = resultado.paginacion.total
    if (resultado.resumenStock) window._resumenStock = resultado.resumenStock
    console.log(`✅ Productos cargados: ${productosLista.length}`)
    mostrarEstadisticasInventario()
    aplicarFiltros()
  } catch (error) {
    console.error('❌ Error cargando productos:', error)
    if (productosTbody) {
      productosTbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ff9999;padding:30px;">
        ❌ Error: ${error.message}<br/><br/>
        <button onclick="cargarProductos()" class="btn-secondary">Reintentar</button></td></tr>`
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════

function mostrarEstadisticasInventario() {
  const rs      = window._resumenStock
  const conStock = rs ? rs.conStock  : productosLista.filter(p => p.inventario && p.inventario.stockActual > 0).length
  const sinStock = rs ? rs.sinStock  : productosLista.filter(p => !p.inventario || p.inventario.stockActual === 0).length
  const bajoStock = rs ? rs.bajoStock : productosLista.filter(p =>
    p.inventario && p.inventario.stockActual > 0 && p.inventario.stockActual < p.inventario.stockMinimoAlerta
  ).length
  const headerContent = document.querySelector('.content-header')
  if (!headerContent) return
  let resumenDiv = document.getElementById('resumen-inventario')
  if (!resumenDiv) {
    resumenDiv = document.createElement('div')
    resumenDiv.id = 'resumen-inventario'
    headerContent.appendChild(resumenDiv)
  }
  resumenDiv.style.cssText = `margin-top:15px;padding:12px 15px;background:#f3f4f620;border-left:4px solid #3b82f6;border-radius:6px;font-size:13px;color:#ffffff;`
  resumenDiv.style.display = 'block'
  resumenDiv.innerHTML = `<strong>📊 Inventario:</strong> ${totalProductos} total |
    <span style="color:#16a34a;">✅ ${conStock} con stock</span> |
    <span style="color:#dc2626;">❌ ${sinStock} sin stock</span> |
    <span style="color:#ea580c;">⚠️ ${bajoStock} bajo stock</span>`
}

// ═══════════════════════════════════════════════════════════════════
// SELECTS — TOOLBAR
// ═══════════════════════════════════════════════════════════════════

function llenarSelectDepartamentos() {
  if (filtroDepto) {
    while (filtroDepto.options.length > 1) filtroDepto.remove(1)
    departamentosLista.forEach(dept => {
      const opt = document.createElement('option')
      opt.value = dept.id
      opt.textContent = `${dept.icono || '📦'} ${dept.nombre}`
      filtroDepto.appendChild(opt)
    })
  }
  llenarModalDepartamentos()
}

function actualizarCategoriasFiltroToolbar() {
  if (!filtroCat) return
  const deptId = parseInt(filtroDepto.value)
  while (filtroCat.options.length > 1) filtroCat.remove(1)
  if (deptId) {
    categoriasLista.filter(c => c.departamentoId === deptId).forEach(cat => {
      const opt = document.createElement('option')
      opt.value = cat.id; opt.textContent = cat.nombre
      filtroCat.appendChild(opt)
    })
    filtroCat.disabled = false
  } else {
    filtroCat.disabled = true; filtroCat.value = ''
  }
}

function llenarSelectProveedores() {
  if (!modalProveedorSelect) return
  
  // ✅ Limpiar completamente el select
  modalProveedorSelect.innerHTML = '<option value="">Seleccionar proveedor...</option>'
  
  // ✅ Ordenar proveedores alfabéticamente por nombreOficial
  const proveedoresOrdenados = [...proveedoresLista].sort((a, b) => 
    a.nombreOficial.localeCompare(b.nombreOficial)
  )
  
  // ✅ Agregar todas las opciones
  proveedoresOrdenados.forEach(prov => {
    const opt = document.createElement('option')
    opt.value = String(prov.id)  // ✅ Asegurar que sea string
    
    // Formato: NOMBREOFICIAL (APODO) o solo NOMBREOFICIAL si apodo es igual
    const displayName = prov.alias && prov.alias !== prov.nombreOficial 
      ? `${prov.nombreOficial} (${prov.alias})`
      : prov.nombreOficial
    opt.textContent = displayName
    
    modalProveedorSelect.appendChild(opt)
  })
  
  console.log('📋 Select de proveedores rellenado con', proveedoresOrdenados.length, 'opciones')
}

// ═══════════════════════════════════════════════════════════════════
// SELECTS — MODAL
// ═══════════════════════════════════════════════════════════════════

function llenarModalDepartamentos(selectedId = null) {
  if (!modalDeptoSelect) return
  const currentVal = selectedId || modalDeptoSelect.value
  modalDeptoSelect.innerHTML = '<option value="">Seleccionar departamento...</option>'
  departamentosLista.forEach(dept => {
    const opt = document.createElement('option')
    opt.value = dept.id; opt.textContent = dept.nombre
    if (parseInt(currentVal) === dept.id) opt.selected = true
    modalDeptoSelect.appendChild(opt)
  })
  const optNuevo = document.createElement('option')
  optNuevo.value = '__NUEVO_DEPTO__'; optNuevo.textContent = '➕ Agregar nuevo departamento...'
  modalDeptoSelect.appendChild(optNuevo)
}

function actualizarModalCategorias(departamentoId, selectedCatId = null) {
  if (!modalCatSelect) return
  modalCatSelect.innerHTML = '<option value="">Seleccionar categoría...</option>'
  if (!departamentoId) { modalCatSelect.disabled = true; return }
  categoriasLista.filter(c => c.departamentoId === parseInt(departamentoId)).forEach(cat => {
    const opt = document.createElement('option')
    opt.value = cat.id; opt.textContent = cat.nombre
    if (selectedCatId && parseInt(selectedCatId) === cat.id) opt.selected = true
    modalCatSelect.appendChild(opt)
  })
  const optNuevo = document.createElement('option')
  optNuevo.value = '__NUEVA_CAT__'; optNuevo.textContent = '➕ Agregar nueva categoría...'
  modalCatSelect.appendChild(optNuevo)
  modalCatSelect.disabled = false
}

// ═══════════════════════════════════════════════════════════════════
// CREAR DEPARTAMENTO / CATEGORÍA
// ═══════════════════════════════════════════════════════════════════

async function crearNuevoDepartamento() {
  const nombre = await jeshaPrompt({
    title: 'Nuevo departamento',
    label: 'Ingresa el nombre del departamento',
    placeholder: 'Ej: Herramientas',
    confirmText: 'Crear'
  })
  if (!nombre || !nombre.trim()) { modalDeptoSelect.value = ''; return }
  try {
    const response = await fetch(`${API_URL}/productos/departamentos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ nombre: nombre.trim() })
    })
    const json = await response.json()
    if (json.success) {
      const nuevoDepto = json.data
      if (!departamentosLista.find(d => d.id === nuevoDepto.id)) {
        departamentosLista.push(nuevoDepto)
        departamentosLista.sort((a, b) => a.nombre.localeCompare(b.nombre))
      }
      llenarSelectDepartamentos()
      llenarModalDepartamentos(nuevoDepto.id)
      actualizarModalCategorias(nuevoDepto.id)
      console.log(`✅ Departamento creado: ${nuevoDepto.nombre}`)
    } else { jeshaToast('Error: ' + json.error, 'error'); modalDeptoSelect.value = '' }
  } catch (err) { console.error('❌ Error creando departamento:', err); jeshaToast('Error de conexión', 'error'); modalDeptoSelect.value = '' }
}

async function crearNuevaCategoria() {
  const departamentoId = modalDeptoSelect.value
  if (!departamentoId || departamentoId === '__NUEVO_DEPTO__') { jeshaToast('Selecciona un departamento primero', 'error'); modalCatSelect.value = ''; return }
  const nombre = await jeshaPrompt({
    title: 'Nueva categoría',
    label: 'Ingresa el nombre de la categoría',
    placeholder: 'Ej: Desarmadores',
    confirmText: 'Crear'
  })
  if (!nombre || !nombre.trim()) { modalCatSelect.value = ''; return }
  try {
    const response = await fetch(`${API_URL}/productos/categorias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ nombre: nombre.trim(), departamentoId: parseInt(departamentoId) })
    })
    const json = await response.json()
    if (json.success) {
      const nuevaCat = json.data
      if (!categoriasLista.find(c => c.id === nuevaCat.id)) categoriasLista.push(nuevaCat)
      actualizarModalCategorias(departamentoId, nuevaCat.id)
      console.log(`✅ Categoría creada: ${nuevaCat.nombre}`)
    } else { jeshaToast('Error: ' + json.error, 'error'); modalCatSelect.value = '' }
  } catch (err) { console.error('❌ Error creando categoría:', err); jeshaToast('Error de conexión', 'error'); modalCatSelect.value = '' }
}

// ═══════════════════════════════════════════════════════════════════
// FILTRADO
// ═══════════════════════════════════════════════════════════════════

function aplicarFiltros() {
  const deptId     = parseInt(filtroDepto?.value) || null
  const stockFiltro = filtroStock?.value || ''
  let filtrados     = productosLista
  if (deptId) filtrados = filtrados.filter(p => p.categoria?.departamento?.id === deptId)
  if (stockFiltro === 'con')  filtrados = filtrados.filter(p => p.inventario && p.inventario.stockActual > 0)
  else if (stockFiltro === 'sin')  filtrados = filtrados.filter(p => !p.inventario || p.inventario.stockActual === 0)
  else if (stockFiltro === 'bajo') filtrados = filtrados.filter(p =>
    p.inventario && p.inventario.stockActual > 0 && p.inventario.stockActual <= p.inventario.stockMinimoAlerta
  )
  renderizarTabla(filtrados)
}

function limpiarFiltros() {
  if (filtroDepto)  filtroDepto.value  = ''
  if (filtroStock)  filtroStock.value  = ''
  if (filtroCat)    { filtroCat.value = ''; filtroCat.disabled = true }
  if (searchInput)  searchInput.value  = ''
  actualizarCategoriasFiltroToolbar()
  cargarProductos()
}

// ═══════════════════════════════════════════════════════════════════
// TABLA
// ═══════════════════════════════════════════════════════════════════

function mostrarLoadingTabla() {
  if (!productosTbody) return
  productosTbody.innerHTML = `<tr class="loading-row">
    <td colspan="9" style="text-align:center;padding:40px;">
      <div class="spinner"></div>
      <p style="margin-top:12px;color:var(--muted);">Cargando productos...</p>
    </td></tr>`
}

function renderizarTabla(productos) {
  if (!productosTbody) return
  if (productos.length === 0) {
    productosTbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted);">
      <div class="empty-state"><p>📭 No hay productos para mostrar</p>
      <small>Ajusta los filtros o realiza una búsqueda diferente</small></div></td></tr>`
    return
  }
  productosTbody.innerHTML = productos.map(p => {
    const stock     = p.inventario?.stockActual ?? '-'
    const minStock  = p.inventario?.stockMinimoAlerta ?? '-'
    const stockBajo = typeof stock === 'number' && typeof minStock === 'number' && stock <= minStock
    const deptoNombre = p.categoria?.departamento?.nombre || ''
    const catNombre   = p.categoria?.nombre || '-'
    return `<tr>
      <td>${p.codigoInterno || '-'}</td>
      <td><strong>${p.nombre}</strong>${p.codigoBarras ? `<br/><small style="color:var(--muted)">${p.codigoBarras}</small>` : ''}</td>
      <td>${deptoNombre ? `<small style="color:var(--muted);display:block;font-size:0.7rem;">${deptoNombre}</small>` : ''}
          <span class="categoria-badge">${catNombre}</span></td>
      <td>
        <div style="font-weight:600">$${parseFloat(p.precioVenta || p.precioBase || 0).toFixed(2)}</div>
        <div style="font-size:0.72rem;color:var(--muted)">Base: $${parseFloat(p.precioBase || 0).toFixed(2)}</div>
      </td>
      <td style="color:${stockBajo ? '#ff9999' : 'inherit'}">${fmtStock(stock)}</td>
      <td>${fmtStock(minStock)}</td>
      <td><span class="estado-badge ${p.activo ? 'activo' : 'inactivo'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td><div class="actions-cell">
        <button class="btn-icon" onclick="editarProducto(${p.id})" title="Editar">✏️</button>
        <button class="btn-ajuste-inv" onclick="event.stopPropagation();abrirAjusteInventario(${p.id})" title="Ajustar stock">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Stock
        </button>
        <button class="btn-icon btn-toggle-estado ${p.activo ? 'btn-desactivar' : 'btn-activar'}"
          onclick="toggleEstadoProducto(${p.id}, ${!p.activo}, '${p.nombre.replace(/'/g,"\\'")}')"
          title="${p.activo ? 'Desactivar producto — dejará de aparecer en el POS' : 'Activar producto — volverá a aparecer en el POS'}">
          ${p.activo ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>' : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'}
        </button>
      </div></td>
    </tr>`
  }).join('')
}

// ═══════════════════════════════════════════════════════════════════
// MODAL PRODUCTO — ABRIR / CERRAR / GUARDAR
// ═══════════════════════════════════════════════════════════════════

window.editarProducto = async function(id) {
  const producto = productosLista.find(p => p.id === id)
  if (!producto) return
  
  console.log('🔍 Editando producto:', producto)
  console.log('📦 Datos de proveedor:', producto.proveedorProducto)
  
  productoActual = producto
  if (modalTitle) modalTitle.textContent = 'Editar Producto'
  document.getElementById('producto-nombre').value            = producto.nombre
  document.getElementById('producto-codigo').value            = producto.codigoInterno
  document.getElementById('producto-codigoBarras').value      = producto.codigoBarras || ''
  document.getElementById('producto-descripcion').value       = producto.descripcion || ''
  document.getElementById('producto-costo').value             = producto.costo || ''
  document.getElementById('producto-precioBase').value        = producto.precioBase
  document.getElementById('producto-precioVenta').value       = producto.precioVenta || ''
  document.getElementById('producto-unidadCompra').value      = producto.unidadCompra || ''
  document.getElementById('producto-unidadVenta').value       = producto.unidadVenta || ''
  document.getElementById('producto-factorConversion').value  = producto.factorConversion || ''
  document.getElementById('producto-claveSat').value          = producto.claveSat || ''
  document.getElementById('producto-unidadSat').value         = producto.unidadSat || ''
  
  const deptoId = producto.categoria?.departamento?.id || ''
  llenarModalDepartamentos(deptoId)
  if (deptoId) actualizarModalCategorias(deptoId, producto.categoriaId)
  
  // ✅ SOLUCIÓN MEJORADA: Carga del proveedor con validación completa
  if (modalProveedorSelect) {
    console.log('🔄 Iniciando carga de proveedor...')
    
    // 1. Re-llenar el select para asegurar que tiene todas las opciones
    llenarSelectProveedores()
    console.log('✅ Select de proveedores rellenado. Opciones disponibles:', modalProveedorSelect.options.length)
    
    // 2. Extraer el proveedorId del producto
    let proveedorId = ''
    
    // ✅ CORREGIDO: La relación se llama 'proveedores' (plural) no 'proveedorProducto'
    if (producto.proveedores && Array.isArray(producto.proveedores) && producto.proveedores.length > 0) {
      proveedorId = producto.proveedores[0].proveedorId || producto.proveedores[0].id || ''
    } else if (producto.proveedorId) {
      proveedorId = producto.proveedorId
    }
    
    console.log('🎯 ProveedorId extraído:', proveedorId, typeof proveedorId)
    
    // 3. Convertir a string para comparación (los option.value son strings)
    const proveedorIdStr = String(proveedorId)
    
    // 4. Verificar si el proveedor existe en la lista
    const proveedorEncontrado = proveedoresLista.find(p => String(p.id) === proveedorIdStr)
    console.log('🔍 Proveedor en lista:', proveedorEncontrado)
    
    // 5. Verificar si existe la opción en el select
    const opcionExiste = Array.from(modalProveedorSelect.options).find(opt => opt.value === proveedorIdStr)
    console.log('🔍 Opción existe en select:', opcionExiste ? 'SÍ' : 'NO')
    
    // 6. Asignar el value usando requestAnimationFrame (más confiable que setTimeout)
    requestAnimationFrame(() => {
      if (proveedorIdStr && proveedorIdStr !== '') {
        modalProveedorSelect.value = proveedorIdStr
        
        // Verificar si se asignó correctamente
        const valorAsignado = modalProveedorSelect.value
        console.log('📌 Valor asignado al select:', valorAsignado)
        
        if (valorAsignado === proveedorIdStr) {
          console.log('✅ ÉXITO: Proveedor cargado correctamente:', proveedorEncontrado?.nombreOficial || valorAsignado)
        } else {
          console.error('❌ FALLO: El proveedor no se asignó. ID esperado:', proveedorIdStr, 'Valor actual:', valorAsignado)
          console.error('🔍 Verificar: ¿Existe la opción con value="' + proveedorIdStr + '" en el select?')
        }
      } else {
        console.log('ℹ️ Producto sin proveedor asignado')
        modalProveedorSelect.value = ''
      }
    })
  }
  
  if (producto.imagenUrl) {
    if (imagenPreview) imagenPreview.src = producto.imagenUrl.startsWith('http') ? producto.imagenUrl : API_URL + producto.imagenUrl
    if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'block'
  } else {
    if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'none'
  }
  
  // ✅ Calcular precio base y margen al cargar producto
  calcularPrecioBase()
  calcularMargen()
  
  ocultarError()
  if (modal) modal.classList.add('active')
}

function abrirModalNuevo() {
  productoActual = null
  if (modalTitle) modalTitle.textContent = 'Nuevo Producto'
  if (formulario) formulario.reset()
  
  // ✅ Inicializar precio base en 0.00
  const precioBaseInput = document.getElementById('producto-precioBase')
  if (precioBaseInput) precioBaseInput.value = '0.00'
  
  llenarModalDepartamentos()
  if (modalCatSelect) { modalCatSelect.innerHTML = '<option value="">Seleccionar categoría...</option>'; modalCatSelect.disabled = true }
  if (modalProveedorSelect) { modalProveedorSelect.value = '' }
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

async function guardarProducto(e) {
  e.preventDefault()
  ocultarError()
  const nombre    = document.getElementById('producto-nombre').value.trim()
  const codigo    = document.getElementById('producto-codigo').value.trim()
  const categoria = modalCatSelect?.value
  const precioBase   = document.getElementById('producto-precioBase').value
  const precioVenta  = document.getElementById('producto-precioVenta').value
  
  if (!nombre)    return mostrarError('El nombre es requerido')
  if (!codigo)    return mostrarError('El código interno es requerido')
  if (!categoria || categoria === '__NUEVA_CAT__') return mostrarError('La categoría es requerida')
  if (!precioBase)  return mostrarError('El precio base (sin IVA) es requerido')
  
  // ✅ CORRECCIÓN: Obtener proveedorId del select
  const proveedorId = modalProveedorSelect?.value || null
  
  const datos = {
    nombre, codigoInterno: codigo,
    codigoBarras:     document.getElementById('producto-codigoBarras').value.trim() || null,
    descripcion:      document.getElementById('producto-descripcion').value.trim() || null,
    costo:            parseFloat(document.getElementById('producto-costo').value) || null,
    precioBase:       parseFloat(precioBase),
    precioVenta:      precioVenta ? parseFloat(precioVenta) : null,
    categoriaId:      parseInt(categoria),
    proveedorId:      proveedorId ? parseInt(proveedorId) : null,  // ✅ AGREGADO
    unidadCompra:     document.getElementById('producto-unidadCompra').value.trim() || null,
    unidadVenta:      document.getElementById('producto-unidadVenta').value.trim() || null,
    factorConversion: parseFloat(document.getElementById('producto-factorConversion').value) || null,
    claveSat:         document.getElementById('producto-claveSat').value.trim() || null,
    unidadSat:        document.getElementById('producto-unidadSat').value.trim() || null,
  }
  
  console.log('📤 Enviando datos al backend:', datos)
  
  try {
    const metodo = productoActual ? 'PUT' : 'POST'
    const url    = productoActual ? `${API_URL}/productos/${productoActual.id}` : `${API_URL}/productos`
    const response = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify(datos)
    })
    if (!response.ok) { const err = await response.json(); throw new Error(err.error || `Error ${response.status}`) }
    const resultado = await response.json()
    const productoGuardado = resultado.data || resultado
    
    // Subir imagen si existe
    if (inputImagen && inputImagen.files.length > 0) {
      await subirImagen(productoGuardado.id, inputImagen.files[0])
    }
    
    console.log('✅ Producto guardado exitosamente')
    cerrarModal()
    await cargarProductos()
  } catch (error) { 
    console.error('❌ Error guardando:', error)
    mostrarError(error.message)
  }
}

async function guardarProveedorProducto(productoId, proveedorId) {
  try {
    // POST a /compras/proveedores/:proveedorId/productos/:productoId
    const response = await fetch(`${API_URL}/compras/proveedores/${proveedorId}/productos/${productoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ precioCosto: 0 })
    })
    if (!response.ok && response.status !== 409) {
      console.warn('⚠️ Error vinculando proveedor, pero continuamos')
    }
  } catch (error) {
    console.warn('⚠️ Error en relación proveedor:', error.message)
  }
}

// ═══════════════════════════════════════════════════════════════════
// CREAR NUEVO PROVEEDOR
// ═══════════════════════════════════════════════════════════════════

window.abrirModalNuevoProveedor = function() {
  document.getElementById('form-nuevo-proveedor').reset()
  document.getElementById('prov-error').style.display = 'none'
  document.getElementById('modal-nuevo-proveedor').style.display = 'flex'
}

window.cerrarModalNuevoProveedor = function() {
  document.getElementById('modal-nuevo-proveedor').style.display = 'none'
  document.getElementById('form-nuevo-proveedor').reset()
}

async function guardarNuevoProveedor(e) {
  e.preventDefault()
  const nombre = document.getElementById('prov-nombre').value.trim()
  const apodo = document.getElementById('prov-apodo').value.trim() || null
  const celular = document.getElementById('prov-celular').value.trim() || null
  const email = document.getElementById('prov-email').value.trim() || null

  if (!nombre) {
    mostrarErrorProveedor('Nombre oficial es requerido')
    return
  }

  const btn = e.target.querySelector('button[type="submit"]')
  btn.disabled = true
  const textOriginal = btn.textContent
  btn.textContent = 'Creando...'

  try {
    const response = await fetch(`${API_URL}/compras/proveedores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ 
        nombreOficial: nombre, 
        alias: apodo || nombre,
        celular,
        email
      })
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || `Error ${response.status}`)
    }
    const resultado = await response.json()
    const proveedorNuevo = resultado.data || resultado
    
    // Agregar a lista local
    proveedoresLista.push(proveedorNuevo)
    llenarSelectProveedores()
    
    // Seleccionar el nuevo proveedor
    modalProveedorSelect.value = proveedorNuevo.id
    
    cerrarModalNuevoProveedor()
    jeshaToast('Proveedor creado exitosamente', 'success')
  } catch (error) {
    mostrarErrorProveedor(error.message)
  } finally {
    btn.disabled = false
    btn.textContent = textOriginal
  }
}

function mostrarErrorProveedor(msg) {
  const el = document.getElementById('prov-error')
  if (el) {
    el.textContent = msg
    el.style.display = 'block'
  }
}

// ═══════════════════════════════════════════════════════════════════
// ESTADO / IMAGEN / MARGEN
// ═══════════════════════════════════════════════════════════════════

window.toggleEstadoProducto = function(id, nuevoEstado, nombreProducto) {
  if (!nuevoEstado) {
    // Desactivar — mostrar modal de confirmación del sistema
    mostrarConfirmEstado(id, nuevoEstado, nombreProducto)
  } else {
    // Activar — directo sin confirmación
    ejecutarToggleEstado(id, nuevoEstado)
  }
}

async function ejecutarToggleEstado(id, nuevoEstado) {
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
    jeshaToast('Error al cambiar estado del producto', 'error')
  }
}

function mostrarConfirmEstado(id, nuevoEstado, nombreProducto) {
  // Remover modal anterior si existe
  document.getElementById('modal-confirm-estado')?.remove()

  const nombre = (nombreProducto || 'este producto').substring(0, 60)

  const modal = document.createElement('div')
  modal.id = 'modal-confirm-estado'
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.72);
    backdrop-filter:blur(4px);z-index:3000;
    display:flex;align-items:center;justify-content:center;padding:20px;
  `

  modal.innerHTML = `
    <div style="
      background:#16191e;border:1px solid rgba(255,255,255,0.09);
      border-radius:16px;width:100%;max-width:400px;overflow:hidden;
      box-shadow:0 32px 80px rgba(0,0,0,0.7);
      animation:confirmEstadoIn 0.2s cubic-bezier(0.16,1,0.3,1);
    ">
      <style>
        @keyframes confirmEstadoIn {
          from{opacity:0;transform:translateY(16px) scale(0.97)}
          to{opacity:1;transform:translateY(0) scale(1)}
        }
      </style>

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:14px;padding:20px 22px 16px;">
        <div style="
          width:46px;height:46px;border-radius:11px;flex-shrink:0;
          background:rgba(232,113,10,0.12);border:1px solid rgba(232,113,10,0.25);
          display:grid;place-items:center;
        ">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e8710a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        </div>
        <div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:1.15rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#e9edf4;line-height:1.1;">
            Desactivar Producto
          </div>
          <div style="font-size:0.78rem;color:#7a8599;margin-top:3px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${nombre}
          </div>
        </div>
      </div>

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:0 22px;"></div>

      <!-- Body -->
      <div style="padding:18px 22px;">
        <p style="font-size:0.875rem;color:#7a8599;line-height:1.6;margin:0 0 12px;">
          Este producto <strong style="color:#e9edf4;">dejará de aparecer en el Punto de Venta</strong> y no podrá ser vendido.
        </p>
        <div style="
          display:flex;align-items:flex-start;gap:10px;
          padding:10px 14px;background:rgba(232,113,10,0.06);
          border:1px solid rgba(232,113,10,0.15);border-radius:8px;
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e8710a" stroke-width="2" style="flex-shrink:0;margin-top:2px;">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style="font-size:0.8rem;color:#e8710a;line-height:1.5;">
            Puedes volver a activarlo en cualquier momento desde el inventario.
          </span>
        </div>
      </div>

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:0 22px;"></div>

      <!-- Acciones -->
      <div style="display:flex;gap:10px;padding:14px 22px 20px;">
        <button id="cfe-cancel" style="
          flex:1;padding:11px 18px;background:transparent;
          border:1px solid rgba(255,255,255,0.1);border-radius:10px;
          color:#7a8599;font-family:'Barlow',sans-serif;font-size:0.875rem;
          font-weight:700;cursor:pointer;transition:all 0.15s;
        ">Cancelar</button>
        <button id="cfe-confirm" style="
          flex:1;padding:11px 18px;
          background:rgba(232,113,10,0.12);
          border:1px solid rgba(232,113,10,0.3);border-radius:10px;
          color:#e8710a;font-family:'Barlow',sans-serif;font-size:0.875rem;
          font-weight:700;cursor:pointer;transition:all 0.15s;
          display:inline-flex;align-items:center;justify-content:center;gap:7px;
        ">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          Sí, desactivar
        </button>
      </div>
    </div>
  `

  document.body.appendChild(modal)

  // Eventos
  const cerrar = () => modal.remove()

  document.getElementById('cfe-cancel').addEventListener('click', cerrar)
  modal.addEventListener('click', e => { if (e.target === modal) cerrar() })
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', escHandler) }
  })

  // Hover en botones
  const btnCancel  = document.getElementById('cfe-cancel')
  const btnConfirm = document.getElementById('cfe-confirm')
  btnCancel.addEventListener('mouseenter',  () => { btnCancel.style.background = 'rgba(255,255,255,0.05)'; btnCancel.style.color = '#e9edf4' })
  btnCancel.addEventListener('mouseleave',  () => { btnCancel.style.background = 'transparent'; btnCancel.style.color = '#7a8599' })
  btnConfirm.addEventListener('mouseenter', () => { btnConfirm.style.background = 'rgba(232,113,10,0.22)' })
  btnConfirm.addEventListener('mouseleave', () => { btnConfirm.style.background = 'rgba(232,113,10,0.12)' })

  document.getElementById('cfe-confirm').addEventListener('click', () => {
    cerrar()
    ejecutarToggleEstado(id, nuevoEstado)
  })
}

async function subirImagen(productoId, archivo) {
  try {
    const formData = new FormData(); formData.append('imagen', archivo)
    const response = await fetch(`${API_URL}/productos/${productoId}/imagen`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: formData
    })
    if (!response.ok) throw new Error(`Error ${response.status}`)
    console.log('✅ Imagen subida')
  } catch (error) { console.error('❌ Error subiendo imagen:', error) }
}

function calcularMargen() {
  const costo = parseFloat(document.getElementById('producto-costo').value) || 0
  const precioVenta = parseFloat(document.getElementById('producto-precioVenta').value) || 0
  const wrap = document.getElementById('info-margen-wrap')
  
  if (!wrap) return
  
  if (costo > 0 && precioVenta > 0) {
    // ✅ CORRECCIÓN: Usar precioVenta directamente (no dividir entre 1.16)
    // Utilidad = Precio Venta - Costo
    const utilidad = precioVenta - costo
    
    // Margen = ((Precio Venta - Costo) / Costo) × 100
    const margen = (utilidad / costo) * 100
    
    // Mostrar con 2 decimales
    document.getElementById('margen-valor').textContent = margen.toFixed(2) + '%'
    document.getElementById('utilidad-valor').textContent = '$' + utilidad.toFixed(2)
    wrap.style.display = 'block'
  } else {
    wrap.style.display = 'none'
  }
}

// ✅ NUEVA FUNCIÓN: Calcular precio base automáticamente desde precio venta
function calcularPrecioBase() {
  const precioVentaInput = document.getElementById('producto-precioVenta')
  const precioBaseInput = document.getElementById('producto-precioBase')
  
  if (!precioVentaInput || !precioBaseInput) return
  
  const precioVenta = parseFloat(precioVentaInput.value)
  
  // Si el precio venta es válido y mayor a 0, calcular precio base
  if (!isNaN(precioVenta) && precioVenta > 0) {
    // Fórmula: Precio Venta / 1.16
    const precioBase = precioVenta / 1.16
    precioBaseInput.value = precioBase.toFixed(2)
  } else {
    // Si está vacío o es inválido, limpiar el precio base
    precioBaseInput.value = '0.00'
  }
}

// ═══════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════

function mostrarError(msg) {
  const el = document.getElementById('producto-error')
  if (!el) return; el.textContent = msg; el.classList.add('show')
}
function ocultarError() {
  const el = document.getElementById('producto-error')
  if (!el) return; el.textContent = ''; el.classList.remove('show')
}
function actualizarFecha() {
  const el = document.getElementById('fecha-actual') || document.querySelector('.content-header p')
  if (!el) return
  el.textContent = new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
}

// ═══════════════════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════════════════

function configurarEventos() {
  if (btnNuevoProducto) btnNuevoProducto.addEventListener('click', abrirModalNuevo)
  if (btnCancelModal)   btnCancelModal.addEventListener('click', cerrarModal)
  if (btnCloseModal)    btnCloseModal.addEventListener('click', cerrarModal)
  if (formulario)       formulario.addEventListener('submit', guardarProducto)

  // Filtros toolbar
  if (filtroDepto) filtroDepto.addEventListener('change', () => { actualizarCategoriasFiltroToolbar(); aplicarFiltros() })
  if (filtroCat)   filtroCat.addEventListener('change', () => cargarProductos())
  if (searchInput) {
    let debounce
    searchInput.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => cargarProductos(), 400) })
    searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') { clearTimeout(debounce); cargarProductos() } })
  }
  if (filtroStock)       filtroStock.addEventListener('change', aplicarFiltros)
  if (btnLimpiarFiltros) btnLimpiarFiltros.addEventListener('click', limpiarFiltros)

  // Selects modal
  if (modalDeptoSelect) {
    modalDeptoSelect.addEventListener('change', () => {
      const val = modalDeptoSelect.value
      if (val === '__NUEVO_DEPTO__') crearNuevoDepartamento()
      else if (val) actualizarModalCategorias(parseInt(val))
      else { if (modalCatSelect) { modalCatSelect.innerHTML = '<option value="">Seleccionar categoría...</option>'; modalCatSelect.disabled = true } }
    })
  }
  if (modalCatSelect) {
    modalCatSelect.addEventListener('change', () => { if (modalCatSelect.value === '__NUEVA_CAT__') crearNuevaCategoria() })
  }

  // Modal background
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) cerrarModal() })

  // Imagen preview
  if (inputImagen) {
    inputImagen.addEventListener('change', e => {
      const archivo = e.target.files[0]; if (!archivo) return
      const reader = new FileReader()
      reader.onload = ev => { if (imagenPreview) imagenPreview.src = ev.target.result; if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'block' }
      reader.readAsDataURL(archivo)
    })
  }
  if (btnCambiarPreview) btnCambiarPreview.addEventListener('click', e => { e.preventDefault(); if (inputImagen) inputImagen.click() })

  // Margen y Precio Base automático
  const inputCosto  = document.getElementById('producto-costo')
  const inputPrecioVenta = document.getElementById('producto-precioVenta')
  const inputPrecioBase = document.getElementById('producto-precioBase')
  
  // Cuando cambia el precio venta: calcular precio base Y margen
  if (inputPrecioVenta) {
    inputPrecioVenta.addEventListener('input', () => {
      calcularPrecioBase()  // ✅ Calcular precio base automáticamente
      calcularMargen()      // ✅ Actualizar margen
    })
  }
  
  // Cuando cambia el costo: solo recalcular margen
  if (inputCosto) {
    inputCosto.addEventListener('input', calcularMargen)
  }

  // ── FIX: Prevenir que el escáner de código de barras dispare submit del form ──
  // Los escáneres envían los caracteres rápidamente y terminan con Enter.
  // Ese Enter dispara el submit del <form>, guardando el producto antes de tiempo.
  // Solución: bloquear Enter en el campo de código de barras.
  const inputCodigoBarras = document.getElementById('producto-codigoBarras')
  if (inputCodigoBarras) {
    inputCodigoBarras.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        // Mover foco al siguiente campo para que el usuario continúe editando
        const siguiente = inputCodigoBarras.closest('.form-group')?.nextElementSibling?.querySelector('input, select, textarea')
        if (siguiente) siguiente.focus()
      }
    })
  }

  // Nuevo Proveedor — Modal
  const btnNuevoProvModal = document.getElementById('btn-nuevo-prov-modal')
  if (btnNuevoProvModal) btnNuevoProvModal.addEventListener('click', abrirModalNuevoProveedor)

  const prov_close = document.getElementById('prov-modal-close')
  if (prov_close) prov_close.addEventListener('click', cerrarModalNuevoProveedor)

  const prov_cancel = document.getElementById('prov-cancel')
  if (prov_cancel) prov_cancel.addEventListener('click', cerrarModalNuevoProveedor)

  const formProveedor = document.getElementById('form-nuevo-proveedor')
  if (formProveedor) formProveedor.addEventListener('submit', guardarNuevoProveedor)

  // Cerrar modal al hacer click fuera
  const modalProveedor = document.getElementById('modal-nuevo-proveedor')
  if (modalProveedor) {
    modalProveedor.addEventListener('click', e => {
      if (e.target === modalProveedor) cerrarModalNuevoProveedor()
    })
  }
}



// ════════════════════════════════════════════════════════════════════
//  IMPORTACIÓN INVENTARIO — Modal integrado en productos.js
//  Añade estas funciones al final de productos.js
//  Y llama initImportacion() dentro de DOMContentLoaded
// ════════════════════════════════════════════════════════════════════

const API_URL_IMPORT = window.__JESHA_API_URL__ || 'http://localhost:3000'

// ── Estado ──
let importArchivoSeleccionado = null
let importValidado            = false

// ── Helpers parseo CSV (para validación local) ──
function importParseCSVLine(line) {
  const result = []
  let current = '', insideQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i], next = line[i+1]
    if (char === '"') {
      if (insideQuotes && next === '"') { current += '"'; i++ }
      else insideQuotes = !insideQuotes
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim()); current = ''
    } else { current += char }
  }
  result.push(current.trim())
  return result
}

function importEsCientifica(val) {
  return val && /^[\d.]+[eE]\+\d+$/.test(val.trim())
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZAR MÓDULO
// ════════════════════════════════════════════════════════════════════

function initImportacion() {
  const btnSubir       = document.getElementById('btn-subir-inventario')
  const modal          = document.getElementById('modal-importacion')
  const btnClose       = document.getElementById('import-close-btn')
  const btnCancel      = document.getElementById('import-cancel-btn')
  const btnValidar     = document.getElementById('import-validate-btn')
  const btnImportar    = document.getElementById('import-confirm-btn')
  const fileInput      = document.getElementById('import-csv-file')
  const dropZone       = document.getElementById('import-drop-zone')

  if (!btnSubir) return

  // Abrir modal
  btnSubir.addEventListener('click', () => {
    resetModalImport()
    modal.style.display = 'flex'
  })

  // Cerrar modal
  const cerrar = () => {
    modal.style.display = 'none'
    resetModalImport()
  }
  btnClose?.addEventListener('click', cerrar)
  btnCancel?.addEventListener('click', cerrar)
  modal?.addEventListener('click', e => { if (e.target === modal) cerrar() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar() })

  // Seleccionar archivo via input
  fileInput?.addEventListener('change', e => {
    if (e.target.files[0]) setArchivoImport(e.target.files[0])
  })

  // Click en dropzone
  dropZone?.addEventListener('click', () => fileInput?.click())

  // Drag & drop
  dropZone?.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone?.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) setArchivoImport(file)
    else mostrarErrorImport('Solo se aceptan archivos .csv')
  })

  // Validar
  btnValidar?.addEventListener('click', validarCSVImport)

  // Importar
  btnImportar?.addEventListener('click', ejecutarImportacion)
}

// ════════════════════════════════════════════════════════════════════
//  SET ARCHIVO
// ════════════════════════════════════════════════════════════════════

function setArchivoImport(file) {
  importArchivoSeleccionado = file
  importValidado            = false
  document.getElementById('import-validate-btn').disabled = false
  document.getElementById('import-confirm-btn').disabled  = true

  const dropZone = document.getElementById('import-drop-zone')
  dropZone.classList.add('tiene-archivo')
  document.getElementById('import-filename').textContent = `📁 ${file.name} (${(file.size/1024).toFixed(1)} KB)`
  document.getElementById('import-validacion').style.display = 'none'
  document.getElementById('import-error').style.display      = 'none'
}

// ════════════════════════════════════════════════════════════════════
//  VALIDAR CSV (local, sin enviar al servidor)
// ════════════════════════════════════════════════════════════════════

async function validarCSVImport() {
  if (!importArchivoSeleccionado) return

  const btnVal = document.getElementById('import-validate-btn')
  btnVal.disabled = true
  btnVal.innerHTML = '⟳ Validando...'

  try {
    const texto  = await importArchivoSeleccionado.text()
    const lineas = texto.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')

    let headerIdx = 0
    while (headerIdx < lineas.length && !lineas[headerIdx].trim()) headerIdx++
    const headers = importParseCSVLine(lineas[headerIdx])

    // Verificar columnas críticas
    const requeridas = ['CLAVE','DESCRIPCION','PRECIO 1']
    const faltantes  = requeridas.filter(r => !headers.some(h => h.trim() === r))
    if (faltantes.length > 0) {
      mostrarErrorImport(`Columnas faltantes: ${faltantes.join(', ')}`)
      btnVal.disabled = false
      btnVal.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Validar CSV'
      return
    }

    const idxClave    = headers.findIndex(h => h.trim() === 'CLAVE')
    const idxPrecio   = headers.findIndex(h => h.trim() === 'PRECIO 1')
    const idxClaveSat = headers.findIndex(h => h.trim() === 'CLAVE SAT')
    const idxUnidSat  = headers.findIndex(h => h.trim() === 'UNIDAD SAT')
    const idxExist    = headers.findIndex(h => h.trim() === 'EXIST.')

    let total = 0, cientificas = 0, sinPrecio = 0, sinClaveSat = 0, conStock = 0
    const clavesSet = new Set()
    let duplicados  = 0

    for (let i = headerIdx + 1; i < lineas.length; i++) {
      const linea = lineas[i].trim()
      if (!linea) continue
      const vals = importParseCSVLine(linea)
      const clave = (vals[idxClave] || '').trim()
      if (!clave) continue
      total++

      if (importEsCientifica(clave)) cientificas++
      if (clavesSet.has(clave)) duplicados++
      clavesSet.add(clave)

      const precio = parseFloat(vals[idxPrecio] || '')
      if (!precio || isNaN(precio) || precio <= 0) sinPrecio++

      const cs = (vals[idxClaveSat] || '').trim()
      if (!cs || cs.toLowerCase() === 'null') sinClaveSat++

      if (idxExist >= 0) {
        const exist = parseFloat(vals[idxExist] || '0')
        if (exist > 0) conStock++
      }
    }

    // Render resultado
    const valDiv = document.getElementById('import-validacion')
    valDiv.style.display = 'block'
    valDiv.innerHTML = `
      <div class="import-stat"><span class="import-stat-label">Total productos en CSV</span><span class="import-stat-val">${total}</span></div>
      <div class="import-stat"><span class="import-stat-label">Con CLAVE SAT</span><span class="import-stat-val ${sinClaveSat === 0 ? 'ok' : 'warn'}">${total - sinClaveSat} / ${total}</span></div>
      <div class="import-stat"><span class="import-stat-label">Con stock inicial</span><span class="import-stat-val ok">${conStock}</span></div>
      ${cientificas > 0 ? `<div class="import-stat"><span class="import-stat-label">CLAVEs en notación científica</span><span class="import-stat-val warn">${cientificas} (se omitirán)</span></div>` : ''}
      ${duplicados > 0 ? `<div class="import-stat"><span class="import-stat-label">CLAVEs duplicadas</span><span class="import-stat-val warn">${duplicados} (se actualizarán)</span></div>` : ''}
      ${sinPrecio > 0 ? `<div class="import-stat"><span class="import-stat-label">Sin precio válido</span><span class="import-stat-val danger">${sinPrecio} (se omitirán)</span></div>` : ''}
      <div class="import-stat" style="margin-top:4px;border-top:1px solid rgba(255,255,255,0.08);padding-top:8px;">
        <span class="import-stat-label">Listos para importar</span>
        <span class="import-stat-val ok">${total - cientificas - sinPrecio} productos</span>
      </div>
    `

    // Habilitar importar
    const hayErroresCriticos = (total - cientificas - sinPrecio) === 0
    document.getElementById('import-confirm-btn').disabled = hayErroresCriticos
    importValidado = true

  } catch (err) {
    mostrarErrorImport('Error al leer el archivo: ' + err.message)
  } finally {
    btnVal.disabled = false
    btnVal.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Validar CSV'
  }
}

// ════════════════════════════════════════════════════════════════════
//  EJECUTAR IMPORTACIÓN
// ════════════════════════════════════════════════════════════════════

async function ejecutarImportacion() {
  if (!importArchivoSeleccionado) return

  const btnImp     = document.getElementById('import-confirm-btn')
  const btnVal     = document.getElementById('import-validate-btn')
  const progresoDiv = document.getElementById('import-progreso')
  const progresoFill = document.getElementById('import-progreso-fill')
  const progresoText = document.getElementById('import-progreso-texto')

  btnImp.disabled = true
  btnVal.disabled = true
  progresoDiv.style.display = 'block'
  progresoFill.style.width  = '30%'
  progresoText.textContent  = 'Enviando archivo al servidor...'

  try {
    const formData = new FormData()
    formData.append('archivo', importArchivoSeleccionado)

    progresoFill.style.width = '60%'
    progresoText.textContent = 'Procesando productos...'

    const token = localStorage.getItem('jesha_token')
    const response = await fetch(`${API_URL_IMPORT}/productos/importar/csv`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    })

    progresoFill.style.width = '90%'
    const resultado = await response.json()

    if (!response.ok) throw new Error(resultado.error || 'Error en importación')

    progresoFill.style.width = '100%'
    progresoFill.style.background = '#60d080'
    progresoText.textContent = '¡Importación completada!'

    // Mostrar resultado
    const valDiv = document.getElementById('import-validacion')
    valDiv.style.display = 'block'
    valDiv.innerHTML = `
      <div class="import-stat"><span class="import-stat-label">Total en archivo</span><span class="import-stat-val">${resultado.total}</span></div>
      <div class="import-stat"><span class="import-stat-label">Creados</span><span class="import-stat-val ok">+${resultado.creados}</span></div>
      <div class="import-stat"><span class="import-stat-label">Actualizados</span><span class="import-stat-val ok">↑${resultado.actualizados || 0}</span></div>
      ${resultado.omitidos > 0 ? `<div class="import-stat"><span class="import-stat-label">Omitidos</span><span class="import-stat-val warn">${resultado.omitidos}</span></div>` : ''}
      ${resultado.errores > 0 ? `<div class="import-stat"><span class="import-stat-label">Errores</span><span class="import-stat-val danger">${resultado.errores}</span></div>` : ''}
    `

    // Recargar tabla de productos
    setTimeout(() => {
      cargarProductos()
      document.getElementById('modal-importacion').style.display = 'none'
      resetModalImport()
    }, 2000)

  } catch (err) {
    mostrarErrorImport('Error: ' + err.message)
    progresoDiv.style.display = 'none'
    btnImp.disabled = false
    btnVal.disabled = false
  }
}

// ════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════

function resetModalImport() {
  importArchivoSeleccionado = null
  importValidado = false
  const fileInput = document.getElementById('import-csv-file')
  if (fileInput) fileInput.value = ''
  const dropZone = document.getElementById('import-drop-zone')
  dropZone?.classList.remove('tiene-archivo', 'drag-over')
  const filenameEl = document.getElementById('import-filename')
  if (filenameEl) filenameEl.textContent = 'Archivos .csv'
  document.getElementById('import-validacion').style.display = 'none'
  document.getElementById('import-progreso').style.display   = 'none'
  document.getElementById('import-error').style.display      = 'none'
  const fill = document.getElementById('import-progreso-fill')
  if (fill) { fill.style.width = '0%'; fill.style.background = '#6b9de8' }
  document.getElementById('import-validate-btn').disabled = true
  document.getElementById('import-confirm-btn').disabled  = true
}

function mostrarErrorImport(msg) {
  const el = document.getElementById('import-error')
  if (el) { el.textContent = msg; el.style.display = 'block' }
}


// ════════════════════════════════════════════════════════════════════
//  AJUSTE INVENTARIO — añadir al final de productos.js
//  Llama initAjusteInventario() dentro de DOMContentLoaded
// ════════════════════════════════════════════════════════════════════

// Roles que pueden ajustar inventario
const ROLES_AJUSTE = ['SUPERADMIN', 'ADMIN_SUCURSAL']

// Producto actualmente en el modal de ajuste
let productoAjuste = null

// ── Inicializar ──
function initAjusteInventario() {
  const usuario = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
  const puedeAjustar = ROLES_AJUSTE.includes(usuario.rol)

  // Si no tiene permiso, ocultar todos los botones (por clase)
  if (!puedeAjustar) {
    document.querySelectorAll('.btn-ajuste-inv').forEach(b => b.classList.add('hidden'))
    return
  }

  const modal      = document.getElementById('modal-ajuste-inv')
  const btnClose   = document.getElementById('ajuste-close-btn')
  const btnCancel  = document.getElementById('ajuste-cancel-btn')
  const btnConfirm = document.getElementById('ajuste-confirm-btn')

  const cerrar = () => {
    modal.style.display = 'none'
    productoAjuste = null
    document.getElementById('ajuste-stock-nuevo').value = ''
    document.getElementById('ajuste-min-nuevo').value   = ''
    document.getElementById('ajuste-motivo').value      = ''
    document.getElementById('ajuste-error').style.display = 'none'
  }

  btnClose?.addEventListener('click', cerrar)
  btnCancel?.addEventListener('click', cerrar)
  modal?.addEventListener('click', e => { if (e.target === modal) cerrar() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar() })
  btnConfirm?.addEventListener('click', guardarAjuste)
}

// ── Abrir modal con datos del producto ──
window.abrirAjusteInventario = function(id) {
  const usuario = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
  if (!ROLES_AJUSTE.includes(usuario.rol)) {
    jeshaToast('No tienes permisos para ajustar inventario.', 'error')
    return
  }

  const producto = productosLista.find(p => p.id === id)
  if (!producto) return

  productoAjuste = producto

  const stock = producto.inventario?.stockActual ?? 0
  const min   = producto.inventario?.stockMinimoAlerta ?? 5

  document.getElementById('ajuste-producto-nombre').textContent   = producto.nombre
  document.getElementById('ajuste-stock-actual-display').textContent = stock
  document.getElementById('ajuste-min-actual-display').textContent   = min
  document.getElementById('ajuste-stock-nuevo').value = ''
  document.getElementById('ajuste-min-nuevo').value   = ''
  document.getElementById('ajuste-motivo').value      = ''
  document.getElementById('ajuste-error').style.display = 'none'

  document.getElementById('modal-ajuste-inv').style.display = 'flex'
  setTimeout(() => document.getElementById('ajuste-stock-nuevo').focus(), 80)
}

// ── Guardar ajuste ──
async function guardarAjuste() {
  if (!productoAjuste) return

  const stockNuevo = document.getElementById('ajuste-stock-nuevo').value.trim()
  const minNuevo   = document.getElementById('ajuste-min-nuevo').value.trim()
  const motivo     = document.getElementById('ajuste-motivo').value.trim()
  const errorDiv   = document.getElementById('ajuste-error')
  const btnConfirm = document.getElementById('ajuste-confirm-btn')

  // Validar que al menos uno tiene valor
  if (stockNuevo === '' && minNuevo === '') {
    errorDiv.textContent  = 'Ingresa al menos un valor a cambiar.'
    errorDiv.style.display = 'block'
    return
  }

  errorDiv.style.display = 'none'
  btnConfirm.disabled    = true
  btnConfirm.innerHTML   = '⟳ Guardando...'

  try {
    const body = {}
    if (stockNuevo !== '') body.stockActual       = parseInt(stockNuevo)
    if (minNuevo   !== '') body.stockMinimoAlerta = parseInt(minNuevo)
    if (motivo)            body.motivo            = motivo

    const token    = localStorage.getItem('jesha_token')
    const response = await fetch(`${API_URL}/productos/${productoAjuste.id}/inventario`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify(body)
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Error al ajustar inventario')

    // Cerrar y recargar tabla
    document.getElementById('modal-ajuste-inv').style.display = 'none'
    productoAjuste = null

    // Toast de éxito
    const toast = document.createElement('div')
    toast.textContent = '✅ Inventario actualizado correctamente'
    Object.assign(toast.style, {
      position:'fixed', top:'20px', right:'20px', zIndex:'9999',
      background:'#1a3a1a', color:'#60d080', padding:'12px 20px',
      borderRadius:'8px', fontSize:'0.875rem', fontWeight:'600',
      border:'1px solid rgba(96,208,128,0.3)',
      boxShadow:'0 4px 16px rgba(0,0,0,0.4)', transition:'opacity 0.4s'
    })
    document.body.appendChild(toast)
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400) }, 2500)

    await cargarProductos()

  } catch (err) {
    errorDiv.textContent   = err.message
    errorDiv.style.display = 'block'
  } finally {
    btnConfirm.disabled  = false
    btnConfirm.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar ajuste'
  }
}