/* ═══════════════════════════════════════════════════════════════════
   PRODUCTOS.JS — Frontend Inventario
   FIXES:
   - Departamento y categoría se muestran en tabla
   - Modal llena departamentos y categorías correctamente
   - Selector cascada: depto → categoría en el modal
   - Opción de crear nuevos departamentos/categorías desde el modal
   - Filtros del toolbar separados de los selects del modal
   - Botón "Subir Inventario" integrado con modal de importación CSV
   - tipoFacturaProv y costoSinIvaProveedor se guardan y restauran
   - FIX: onclick inline reemplazado por data-* + delegación de eventos
   - FIX: variable modal sombreada en initImportacion renombrada
   - FIX: API_URL_IMPORT eliminada, se usa API_URL en todos lados
   - FEAT: modoImportacion (upsert / solo_nuevos) con modal dinámico
   - FEAT: columnas obligatorias ahora incluyen CLAVE SAT y UNIDAD SAT
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

const IVA_FACTOR = window.__JESHA_IVA_FACTOR__ || 1.16
const ROL_ACTUAL = JSON.parse(localStorage.getItem('jesha_usuario') || '{}').rol
const ES_ADMIN = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'].includes(ROL_ACTUAL)
const ES_PRECIOS = ROL_ACTUAL === 'PRECIOS'
const ES_EMPLEADO = ROL_ACTUAL === 'EMPLEADO'

let productosLista     = []
let departamentosLista = []
let categoriasLista    = []
let proveedoresLista   = []
let productoActual     = null
let unidadesSatLista   = []
let unidadesVentaLista = []
let unidadesCompraLista = []
let unidadesVentaMap   = new Map()
let unidadesCompraMap  = new Map()

// Total global
let totalProductos = 0

// ── Estado de paginación ──
let paginaActual   = 1
const PRODUCTOS_POR_PAGINA = 50
let totalPaginas   = 1

// Variables DOM
let productosTbody, searchInput, filtroDepto, filtroCat
let btnNuevoProducto, modal, modalTitle, btnCancelModal, btnCloseModal
let filtroStock, filtroTipo, filtroActivo
let formulario, inputImagen
let imagenPreviewContainer, imagenPreview, btnCambiarPreview
let btnLimpiarFiltros

// Grid / Vista
let productosGrid, productosListaWrap, btnVistaGrid, btnVistaLista
let vistaActual = localStorage.getItem('jesha_productos_view_mode') || 'grid'

// Selects del modal (separados del toolbar)
let modalDeptoSelect, modalCatSelect, modalProveedorSelect

// Tipo de factura proveedor
let radioFacturaA, radioFacturaB, camposFacturaA, camposFacturaB

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
  filtroTipo       = document.getElementById('filtro-tipo')
  filtroActivo     = document.getElementById('filtro-activo')

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

  // Grid / Vista
  productosGrid      = document.getElementById('productos-grid')
  productosListaWrap = document.getElementById('productos-lista-wrap')
  btnVistaGrid       = document.getElementById('btn-vista-grid')
  btnVistaLista      = document.getElementById('btn-vista-lista')

  // Tipo de factura
  radioFacturaA  = document.getElementById('radio-factura-a')
  radioFacturaB  = document.getElementById('radio-factura-b')
  camposFacturaA = document.getElementById('campos-factura-a')
  camposFacturaB = document.getElementById('campos-factura-b')

  console.log('✅ Token encontrado')
  await cargarDepartamentos()
  await cargarCategorias()
  cargarUnidadesSat()
  if (ES_ADMIN) await cargarProveedores()  // FIX: PRECIOS no usa el modal de producto, no necesita proveedores
  await cargarProductos()
  aplicarPermisosProductos()
  configurarEventos()
  actualizarFecha()
  setInterval(actualizarFecha, 60000)

  // Inicializar módulo de importación
  initImportacion()

  // Inicializar ajuste de inventario
  initAjusteInventario()

  // Inicializar plantilla de corrección
  initPlantillaCorreccion()

  // Inicializar modal de precios (rol PRECIOS)
  initModalPrecios()

  // Inicializar modal básico (rol EMPLEADO)
  initModalBasico()

  // Inicializar sugerencia SAT en modal de producto
  initSugerirSat()

  // Inicializar dropdowns de unidades y auto-fill de Unidad SAT
  initUnidadesProducto()
})

// ═══════════════════════════════════════════════════════════════════
// PERMISOS POR ROL — ocultar controles administrativos si no es admin
// ═══════════════════════════════════════════════════════════════════

function aplicarPermisosProductos() {
  if (ES_ADMIN) return

  // Ocultar botones de administración
  const idsAdmin = ['btn-nuevo-producto', 'btn-subir-inventario', 'btn-subir-solo-nuevos', 'btn-descargar-plantilla', 'btn-subir-plantilla']
  idsAdmin.forEach(id => {
    const el = document.getElementById(id)
    if (el) el.style.display = 'none'
  })

  // Marcar rol para estilos responsive
  if (ES_PRECIOS) {
    document.body.classList.add('rol-precios')
  }
}

// ═══════════════════════════════════════════════════════════════════
// CARGA DE DATOS
// ═══════════════════════════════════════════════════════════════════

const UNIDADES_FALLBACK = {
  unidadesSat: [
    { id: 'H87', nombre: 'Pieza', simbolo: '', esComun: true },
    { id: 'MTR', nombre: 'Metro', simbolo: 'm', esComun: true },
    { id: 'KGM', nombre: 'Kilogramo', simbolo: 'kg', esComun: true },
    { id: 'LTR', nombre: 'Litro', simbolo: 'l', esComun: true },
    { id: 'XPK', nombre: 'Paquete', simbolo: '', esComun: true },
    { id: 'PR', nombre: 'Par', simbolo: '', esComun: true },
    { id: 'KT', nombre: 'Kit', simbolo: '', esComun: true },
    { id: 'SET', nombre: 'Conjunto', simbolo: '', esComun: true },
  ],
  unidadVenta: [
    { valor: 'PZA', unidadSat: 'H87', nombre: 'Pieza', aliases: ['PZ', 'PZAS', 'PIEZA'], esComun: true },
    { valor: 'MT', unidadSat: 'MTR', nombre: 'Metro', aliases: ['M', 'MTS', 'METRO'], esComun: true },
    { valor: 'KG', unidadSat: 'KGM', nombre: 'Kilogramo', aliases: ['KILO', 'KILOS'], esComun: true },
    { valor: 'LT', unidadSat: 'LTR', nombre: 'Litro', aliases: ['L', 'LTS', 'LITRO'], esComun: true },
    { valor: 'PAQUETE', unidadSat: 'XPK', nombre: 'Paquete', aliases: ['PACK', 'PAQ'], esComun: true },
    { valor: 'PAR', unidadSat: 'PR', nombre: 'Par', aliases: [], esComun: true },
    { valor: 'KIT', unidadSat: 'KT', nombre: 'Kit', aliases: [], esComun: true },
    { valor: 'JUEGO', unidadSat: 'SET', nombre: 'Juego', aliases: ['SET'], esComun: true },
  ],
  unidadCompra: [
    { valor: 'CAJA', unidadSat: 'XBX', nombre: 'Caja', aliases: [], esComun: true },
    { valor: 'BULTO', unidadSat: 'XSA', nombre: 'Bulto / saco', aliases: ['SACO'], esComun: true },
    { valor: 'ROLLO', unidadSat: 'XRO', nombre: 'Rollo', aliases: [], esComun: true },
    { valor: 'PZA', unidadSat: 'H87', nombre: 'Pieza', aliases: ['PZ', 'PZAS', 'PIEZA'], esComun: true },
    { valor: 'PAQUETE', unidadSat: 'XPK', nombre: 'Paquete', aliases: ['PACK', 'PAQ'], esComun: true },
    { valor: 'MT', unidadSat: 'MTR', nombre: 'Metro', aliases: ['M', 'MTS', 'METRO'], esComun: true },
    { valor: 'KG', unidadSat: 'KGM', nombre: 'Kilogramo', aliases: ['KILO', 'KILOS'], esComun: true },
    { valor: 'LT', unidadSat: 'LTR', nombre: 'Litro', aliases: ['L', 'LTS', 'LITRO'], esComun: true },
  ],
}

function normalizarUnidadTexto(valor) {
  return String(valor || '').trim().toUpperCase().replace(/\s+/g, ' ')
}

function registrarUnidadOperativa(map, unidad) {
  if (!unidad || !unidad.valor) return
  map.set(normalizarUnidadTexto(unidad.valor), unidad)
  ;(unidad.aliases || []).forEach(alias => map.set(normalizarUnidadTexto(alias), unidad))
}

async function cargarUnidadesSat() {
  try {
    const resultado = await apiFetch('/productos/sat/unidades')
    const data = resultado?.data || resultado || {}
    aplicarCatalogoUnidades(data)
    console.log('✅ Unidades SAT:', unidadesSatLista.length)
  } catch (error) {
    console.error('❌ Error cargando unidades SAT:', error)
    aplicarCatalogoUnidades(UNIDADES_FALLBACK)
  }
}

function aplicarCatalogoUnidades(data) {
  unidadesSatLista = Array.isArray(data.unidadesSat) ? data.unidadesSat : UNIDADES_FALLBACK.unidadesSat
  unidadesVentaLista = Array.isArray(data.unidadVenta) ? data.unidadVenta : UNIDADES_FALLBACK.unidadVenta
  unidadesCompraLista = Array.isArray(data.unidadCompra) ? data.unidadCompra : UNIDADES_FALLBACK.unidadCompra

  unidadesVentaMap = new Map()
  unidadesCompraMap = new Map()
  unidadesVentaLista.forEach(u => registrarUnidadOperativa(unidadesVentaMap, u))
  unidadesCompraLista.forEach(u => registrarUnidadOperativa(unidadesCompraMap, u))

  unidadesSatLista.forEach(u => {
    if (u?.id && u?.nombre) UNIDAD_LABEL_SAT[u.id] = u.nombre
  })

  llenarDatalistUnidadOperativa('producto-unidades-venta-list', unidadesVentaLista)
  llenarDatalistUnidadOperativa('producto-unidades-compra-list', unidadesCompraLista)
  llenarDatalistSat('producto-unidades-sat-list', unidadesSatLista)
}

function llenarDatalistUnidadOperativa(id, unidades) {
  const lista = document.getElementById(id)
  if (!lista) return
  const fragment = document.createDocumentFragment()
  ;(unidades || []).forEach((u) => {
    if (!u?.valor) return
    const option = document.createElement('option')
    option.value = u.valor
    option.label = `${u.nombre || u.valor}${u.unidadSat ? ` (${u.unidadSat})` : ''}`
    fragment.appendChild(option)
  })
  lista.innerHTML = ''
  lista.appendChild(fragment)
}

function llenarDatalistSat(id, unidades) {
  const lista = document.getElementById(id)
  if (!lista) return
  const fragment = document.createDocumentFragment()
  ;(unidades || []).forEach((u) => {
    if (!u?.id) return
    const option = document.createElement('option')
    option.value = u.id
    option.label = `${u.nombre || ''}${u.simbolo ? ` - ${u.simbolo}` : ''}`
    fragment.appendChild(option)
  })
  lista.innerHTML = ''
  lista.appendChild(fragment)
}

function normalizarInputUnidad(input, map) {
  if (!input) return null
  const clave = normalizarUnidadTexto(input.value)
  const unidad = map.get(clave)
  if (unidad) input.value = unidad.valor
  return unidad || null
}

function obtenerValorUnidad(inputId, map) {
  const input = document.getElementById(inputId)
  if (!input) return null
  const unidad = normalizarInputUnidad(input, map)
  return unidad ? unidad.valor : (input.value.trim() || null)
}

function initUnidadesProducto() {
  const unidadVenta = document.getElementById('producto-unidadVenta')
  const unidadCompra = document.getElementById('producto-unidadCompra')
  const unidadSat = document.getElementById('producto-unidadSat')

  const aplicarUnidadVenta = () => {
    const unidad = normalizarInputUnidad(unidadVenta, unidadesVentaMap)
    if (unidad?.unidadSat && unidadSat) unidadSat.value = unidad.unidadSat
  }

  if (unidadVenta) {
    unidadVenta.addEventListener('change', aplicarUnidadVenta)
    unidadVenta.addEventListener('blur', aplicarUnidadVenta)
  }

  if (unidadCompra) {
    const normalizarCompra = () => normalizarInputUnidad(unidadCompra, unidadesCompraMap)
    unidadCompra.addEventListener('change', normalizarCompra)
    unidadCompra.addEventListener('blur', normalizarCompra)
  }

  if (unidadSat) {
    unidadSat.addEventListener('blur', () => { unidadSat.value = normalizarUnidadTexto(unidadSat.value) })
  }
}

async function cargarDepartamentos() {
  try {
    const resultado = await apiFetch('/productos/departamentos')
    departamentosLista = resultado.data || resultado
    console.log('✅ Departamentos:', departamentosLista.length)
    llenarSelectDepartamentos()
  } catch (error) { console.error('❌ Error cargando departamentos:', error) }
}

async function cargarCategorias() {
  try {
    const resultado = await apiFetch('/productos/categorias')
    categoriasLista = resultado.data || resultado
    console.log('✅ Categorías:', categoriasLista.length)
  } catch (error) { console.error('❌ Error cargando categorías:', error) }
}

async function cargarProveedores() {
  try {
    const resultado = await apiFetch('/compras/proveedores')
    proveedoresLista = resultado.data || resultado
    console.log('✅ Proveedores:', proveedoresLista.length)
    llenarSelectProveedores()
  } catch (error) { console.error('❌ Error cargando proveedores:', error) }
}

async function cargarProductos() {
  try {
    console.log('📦 Cargando productos...')
    mostrarLoadingTabla()

    // ── Construir query params — TODOS los filtros van al backend ──
    const params = new URLSearchParams()
    params.set('page', paginaActual)
    params.set('limit', PRODUCTOS_POR_PAGINA)

    const busqueda = searchInput?.value?.trim()
    if (busqueda) params.set('buscar', busqueda)

    const catId = filtroCat?.value
    if (catId) params.set('categoriaId', catId)

    const deptoId = filtroDepto?.value
    if (deptoId) params.set('departamentoId', deptoId)

    const stockVal = filtroStock?.value
    if (stockVal) params.set('stock', stockVal)

    const tipoVal = filtroTipo?.value
    if (tipoVal) params.set('tipo', tipoVal)

    const activoVal = filtroActivo?.value
    if (activoVal) params.set('activo', activoVal)

    const resultado = await apiFetch(`/productos?${params}`)
    productosLista = resultado.data || resultado

    if (resultado.paginacion) {
      totalProductos = resultado.paginacion.total
      totalPaginas   = resultado.paginacion.totalPaginas
      paginaActual   = resultado.paginacion.pagina
    }
    if (resultado.resumenStock) window._resumenStock = resultado.resumenStock

    const conImg = productosLista.filter(p => obtenerImagenProducto(p)).length
    console.log(`✅ Productos cargados: ${productosLista.length} de ${totalProductos} (pág ${paginaActual}/${totalPaginas})`)
    console.info(`📸 Imágenes: ${conImg} con imagen, ${productosLista.length - conImg} sin imagen`)
    mostrarEstadisticasInventario()
    renderizarProductos(productosLista)
    renderizarPaginacion()
  } catch (error) {
    console.error('❌ Error cargando productos:', error)
    if (productosTbody) {
      productosTbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ff9999;padding:30px;">
        ❌ Error: ${error.message}<br/><br/>
        <button onclick="cargarProductos()" class="btn-secondary">Reintentar</button></td></tr>`
    }
    ocultarPaginacion()
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
  
  // Limpiar completamente el select
  modalProveedorSelect.innerHTML = '<option value="">Seleccionar proveedor...</option>'
  
  // Ordenar proveedores alfabéticamente por nombreOficial
  const proveedoresOrdenados = [...proveedoresLista].sort((a, b) => 
    a.nombreOficial.localeCompare(b.nombreOficial)
  )
  
  // Agregar todas las opciones
  proveedoresOrdenados.forEach(prov => {
    const opt = document.createElement('option')
    opt.value = String(prov.id)  // Asegurar que sea string
    
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
    const json = await apiFetch('/productos/departamentos', {
      method: 'POST',
      body: JSON.stringify({ nombre: nombre.trim() })
    })
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
  } catch (err) { console.error('❌ Error creando departamento:', err); modalDeptoSelect.value = '' }
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
    const json = await apiFetch('/productos/categorias', {
      method: 'POST',
      body: JSON.stringify({ nombre: nombre.trim(), departamentoId: parseInt(departamentoId) })
    })
    if (json.success) {
      const nuevaCat = json.data
      if (!categoriasLista.find(c => c.id === nuevaCat.id)) categoriasLista.push(nuevaCat)
      actualizarModalCategorias(departamentoId, nuevaCat.id)
      console.log(`✅ Categoría creada: ${nuevaCat.nombre}`)
    } else { jeshaToast('Error: ' + json.error, 'error'); modalCatSelect.value = '' }
  } catch (err) { console.error('❌ Error creando categoría:', err); modalCatSelect.value = '' }
}

// ═══════════════════════════════════════════════════════════════════
// FILTRADO
// ═══════════════════════════════════════════════════════════════════

// Todos los filtros van al backend via cargarProductos()
// aplicarFiltros solo resetea la página a 1 y recarga
function aplicarFiltros() {
  paginaActual = 1
  cargarProductos()
}

function limpiarFiltros() {
  if (filtroDepto)  filtroDepto.value  = ''
  if (filtroStock)  filtroStock.value  = ''
  if (filtroTipo)   filtroTipo.value   = ''
  if (filtroActivo) filtroActivo.value = ''
  if (filtroCat)    { filtroCat.value = ''; filtroCat.disabled = true }
  if (searchInput)  searchInput.value  = ''
  actualizarCategoriasFiltroToolbar()
  paginaActual = 1
  cargarProductos()
}

// ═══════════════════════════════════════════════════════════════════
// TABLA
// ═══════════════════════════════════════════════════════════════════

// Acciones por fila según rol
function accionesFila(p) {
  if (ES_ADMIN) {
    return `
      <button class="btn-icon btn-editar-producto" data-id="${p.id}" title="Editar">✏️</button>
      <button class="btn-ajuste-inv" data-id="${p.id}" title="Ajustar stock">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        Stock
      </button>
      <button class="btn-icon btn-toggle-estado ${p.activo ? 'btn-desactivar' : 'btn-activar'}"
        data-id="${p.id}" data-activo="${p.activo}" data-nombre="${p.nombre}"
        title="${p.activo ? 'Desactivar producto — dejará de aparecer en el POS' : 'Activar producto — volverá a aparecer en el POS'}">
        ${p.activo ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>' : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'}
      </button>`
  }
  if (ES_PRECIOS) {
    return `<button class="btn-icon btn-editar-precio" data-id="${p.id}" title="Editar precio">💲</button>`
  }
  if (ES_EMPLEADO) {
    return `<button class="btn-icon btn-editar-basico" data-id="${p.id}" title="Editar datos básicos">✏️</button>`
  }
  return ''
}

function mostrarLoadingTabla() {
  if (!productosTbody) return
  productosTbody.innerHTML = `<tr class="loading-row">
    <td colspan="9" style="text-align:center;padding:40px;">
      <div class="spinner"></div>
      <p style="margin-top:12px;color:var(--muted);">Cargando productos...</p>
    </td></tr>`
}

// FIX: onclick inline reemplazado por data-* attributes
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
    const deptoNombre = p.Categoria?.Departamento?.nombre || ''
    const catNombre   = p.Categoria?.nombre || '-'
    return `<tr>
      <td>${p.codigoInterno || '-'}</td>
      <td><strong>${p.nombre}</strong>${p.esGranel ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:0.65rem;font-weight:700;background:rgba(107,157,232,0.15);color:#6b9de8;border-radius:4px;vertical-align:middle;letter-spacing:0.03em;">GRANEL${p.unidadVenta ? ' · ' + p.unidadVenta : ''}</span>` : ''}${p.codigoBarras ? `<br/><small style="color:var(--muted)">${p.codigoBarras}</small>` : ''}</td>
      <td class="col-categoria">${deptoNombre ? `<small style="color:var(--muted);display:block;font-size:0.7rem;">${deptoNombre}</small>` : ''}
          <span class="categoria-badge">${catNombre}</span></td>
      <td>
        <div style="font-weight:600">$${parseFloat(p.precioVenta || p.precioBase || 0).toFixed(2)}</div>
        <div style="font-size:0.72rem;color:var(--muted)">Base: $${parseFloat(p.precioBase || 0).toFixed(2)}</div>
      </td>
      <td style="color:${stockBajo ? '#ff9999' : 'inherit'}">${fmtStock(stock)}</td>
      <td class="col-min-stock">${fmtStock(minStock)}</td>
      <td class="col-estado"><span class="estado-badge ${p.activo ? 'activo' : 'inactivo'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
      ${(() => { const a = accionesFila(p); return a ? `<td><div class="actions-cell">${a}</div></td>` : '' })()}
    </tr>`
  }).join('')
}

// ═══════════════════════════════════════════════════════════════════
// GRID — Vista de tarjetas
// ═══════════════════════════════════════════════════════════════════

function obtenerImagenProducto(p) {
  const raw = p.imagenUrl || p.Categoria?.imagenUrl || ''
  if (!raw) return ''

  try {
    const url = new URL(raw, API_URL)

    if (url.hostname.includes('cloudinary') && !url.href.includes('/upload/c_pad,')) {
      const parts = url.href.split('/upload/')
      if (parts.length === 2) {
        return `${parts[0]}/upload/c_pad,w_400,h_300,f_auto,q_auto,b_rgb:f3f5f8/${parts[1]}`
      }
    }

    return url.href
  } catch {
    return ''
  }
}

function obtenerImagenOriginal(p) {
  const raw = p.imagenUrl || p.Categoria?.imagenUrl || ''
  if (!raw) return ''

  try {
    const url = new URL(raw, API_URL)

    if (url.hostname.includes('cloudinary')) {
      const idx = url.href.indexOf('/upload/')
      if (idx !== -1) {
        const base = url.href.substring(0, idx + 8)
        const rest = url.href.substring(idx + 8)
        const verMatch = rest.match(/\/v\d+/)
        if (verMatch) {
          return base + 'f_auto,q_auto' + rest.substring(verMatch.index)
        }
      }
    }

    return url.href
  } catch {
    return ''
  }
}

function renderPlaceholderImagen(texto) {
  return `
    <div class="producto-card-placeholder">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      <span>${escaparHtml(texto || 'Sin imagen')}</span>
    </div>
  `
}

function abrirZoomImagen(productoId) {
  const p = productosLista.find(x => x.id === productoId)
  if (!p) return

  const imgUrl = obtenerImagenOriginal(p)
  if (!imgUrl) {
    if (typeof jeshaToast === 'function') jeshaToast('Este producto no tiene imagen', 'warning')
    return
  }

  const existing = document.getElementById('img-lightbox')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = 'img-lightbox'
  overlay.className = 'img-lightbox-overlay'

  const backdrop = document.createElement('div')
  backdrop.className = 'img-lightbox-backdrop'
  overlay.appendChild(backdrop)

  const card = document.createElement('div')
  card.className = 'img-lightbox-card'

  const closeBtn = document.createElement('button')
  closeBtn.className = 'img-lightbox-close'
  closeBtn.setAttribute('aria-label', 'Cerrar')
  closeBtn.textContent = '\u00D7'
  card.appendChild(closeBtn)

  const body = document.createElement('div')
  body.className = 'img-lightbox-body'

  const img = document.createElement('img')
  img.className = 'img-lightbox-image'
  img.src = imgUrl
  img.alt = p.nombre || 'Producto'
  body.appendChild(img)
  card.appendChild(body)

  const footer = document.createElement('div')
  footer.className = 'img-lightbox-footer'

  const nameEl = document.createElement('strong')
  nameEl.textContent = p.nombre || 'Producto'
  footer.appendChild(nameEl)

  const codeEl = document.createElement('span')
  codeEl.textContent = p.codigoInterno || ''
  footer.appendChild(codeEl)
  card.appendChild(footer)

  overlay.appendChild(card)
  document.body.appendChild(overlay)

  requestAnimationFrame(() => {
    overlay.classList.add('active')
  })

  function cerrar() {
    document.removeEventListener('keydown', escapeHandler)
    overlay.classList.remove('active')
    overlay.addEventListener('transitionend', function handler() {
      overlay.removeEventListener('transitionend', handler)
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    })
  }

  backdrop.addEventListener('click', cerrar)
  closeBtn.addEventListener('click', cerrar)

  const escapeHandler = function (e) {
    if (e.key === 'Escape') cerrar()
  }
  document.addEventListener('keydown', escapeHandler)
}

function renderProductoCard(p) {
  const stock = p.inventario?.stockActual ?? 0
  const minStock = p.inventario?.stockMinimoAlerta ?? 0

  const stockNum = parseFloat(stock)
  const minNum = parseFloat(minStock)

  const sinStock = !stockNum || stockNum <= 0
  const stockBajo = !sinStock && minNum > 0 && stockNum <= minNum

  const catNombre = p.Categoria?.nombre || 'Sin categoría'
  const deptoNombre = p.Categoria?.Departamento?.nombre || ''
  const imagen = obtenerImagenProducto(p)

  const estadoStockClass = sinStock
    ? 'sin-stock'
    : stockBajo
      ? 'bajo-stock'
      : 'con-stock'

  const estadoStockTexto = sinStock
    ? 'Sin stock'
    : stockBajo
      ? 'Bajo stock'
      : 'Con stock'

  const wrapClass = `producto-card-image-wrap${imagen ? '' : ' no-image'}`

  let imgHtml
  if (imagen) {
    imgHtml = `<img class="producto-card-image" src="${escaparHtml(imagen)}" alt="${escaparHtml(p.nombre || 'Producto')}" loading="lazy" decoding="async" data-zoom-id="${p.id}">`
  } else {
    imgHtml = renderPlaceholderImagen('Sin imagen')
  }

  let accionesExtra = ''
  if (ES_ADMIN && !imagen) {
    accionesExtra = `<button class="btn-icon btn-agregar-imagen" data-id="${p.id}" title="Agregar imagen">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </button>`
  }

  return `
    <article class="producto-card ${!p.activo ? 'is-inactive' : ''} ${estadoStockClass}" data-id="${p.id}">
      
      <div class="${wrapClass}">
        ${imgHtml}

        <div class="producto-card-badges">
          <span class="stock-pill ${estadoStockClass}">${estadoStockTexto}</span>
          ${p.esGranel ? `<span class="stock-pill granel">Granel</span>` : ''}
          ${!p.activo ? `<span class="stock-pill inactivo">Inactivo</span>` : ''}
        </div>
      </div>

      <div class="producto-card-body">
        <div class="producto-card-category">
          ${deptoNombre ? `<span>${escaparHtml(deptoNombre)}</span>` : ''}
          <strong>${escaparHtml(catNombre)}</strong>
        </div>

        <h4 class="producto-card-name">${escaparHtml(p.nombre || 'Producto sin nombre')}</h4>

        <div class="producto-card-code">
          ${escaparHtml(p.codigoInterno || '-')}
          ${p.codigoBarras ? `<small>${escaparHtml(p.codigoBarras)}</small>` : ''}
        </div>

        <div class="producto-card-bottom">
          <div class="producto-card-price">
            $${parseFloat(p.precioVenta || p.precioBase || 0).toFixed(2)}
          </div>

          <div class="producto-card-stock">
            <strong>${fmtStock(stock)}</strong>
            <span>/ Min. ${fmtStock(minStock)}</span>
          </div>
        </div>
      </div>

      <div class="producto-card-actions">
        <div class="actions-cell">${accionesFila(p)}${accionesExtra}</div>
      </div>
    </article>
  `
}

function hidratarImagenesGrid() {
  document.querySelectorAll('#productos-grid .producto-card-image').forEach(img => {
    const wrap = img.closest('.producto-card-image-wrap')
    if (!wrap) return

    const handlerLoad = () => {
      wrap.classList.remove('no-image')
      wrap.classList.add('has-image')
    }

    const handlerError = () => {
      wrap.classList.remove('has-image')
      wrap.classList.add('no-image', 'image-error')
      img.remove()
      wrap.insertAdjacentHTML('beforeend', renderPlaceholderImagen('Imagen no disponible'))
    }

    if (img.complete && img.naturalWidth > 0) {
      handlerLoad()
    } else if (img.complete) {
      handlerError()
    } else {
      img.addEventListener('load', handlerLoad, { once: true })
      img.addEventListener('error', handlerError, { once: true })
    }
  })
}

function renderizarGrid(productos) {
  if (!productosGrid) return

  if (!productos || productos.length === 0) {
    productosGrid.innerHTML = `
      <div class="empty-state grid-empty">
        <p>No hay productos para mostrar</p>
        <small>Ajusta los filtros o realiza una búsqueda diferente</small>
      </div>
    `
    return
  }

  productosGrid.innerHTML = productos.map(p => renderProductoCard(p)).join('')
  hidratarImagenesGrid()
}

function aplicarVistaActual() {
  const esGrid = vistaActual === 'grid'

  if (productosGrid) productosGrid.style.display = esGrid ? 'grid' : 'none'
  if (productosListaWrap) productosListaWrap.style.display = esGrid ? 'none' : 'block'

  btnVistaGrid?.classList.toggle('active', esGrid)
  btnVistaLista?.classList.toggle('active', !esGrid)
}

function renderizarProductos(productos) {
  aplicarVistaActual()

  if (vistaActual === 'grid') {
    renderizarGrid(productos)
  } else {
    renderizarTabla(productos)
  }
}

// ═══════════════════════════════════════════════════════════════════
// SUGERENCIA SAT — Modal de producto
// ═══════════════════════════════════════════════════════════════════

const UNIDAD_LABEL_SAT = {
  H87: 'pieza', MTR: 'metro', KGM: 'kilo', LTR: 'litro',
  XPK: 'paquete', PR: 'par', KT: 'kit', SET: 'juego',
}

function initSugerirSat() {
  const btn = document.getElementById('btn-sugerir-sat')
  if (!btn) return

  const panel      = document.getElementById('sat-panel')
  const badgeEl    = document.getElementById('sat-badge')
  const confEl     = document.getElementById('sat-confianza')
  const clavesEl   = document.getElementById('sat-claves')
  const unidadesEl = document.getElementById('sat-unidades')
  const razonesEl  = document.getElementById('sat-razones')
  const razonesTgl = document.getElementById('sat-razones-toggle')
  const statusEl   = document.getElementById('sat-status')

  const inputNombre    = document.getElementById('producto-nombre')
  const inputDesc      = document.getElementById('producto-descripcion')
  const inputUnidadV   = document.getElementById('producto-unidadVenta')
  const inputGranel    = document.getElementById('producto-esGranel')
  const inputClaveSat  = document.getElementById('producto-claveSat')
  const inputUnidadSat = document.getElementById('producto-unidadSat')

  if (razonesTgl && razonesEl) {
    razonesTgl.addEventListener('click', () => {
      const abierto = razonesEl.style.display !== 'none'
      razonesEl.style.display = abierto ? 'none' : 'block'
      const caret = razonesTgl.querySelector('.sat-caret')
      if (caret) caret.classList.toggle('abierto', !abierto)
    })
  }

  btn.addEventListener('click', async () => {
    const nombre = (inputNombre?.value || '').trim()
    if (panel) panel.style.display = 'block'

    if (nombre === '') {
      mostrarEstadoSat('vacio')
      return
    }

    btn.disabled = true
    mostrarEstadoSat('cargando')

    try {
      const resultado = await apiFetch('/productos/sat/sugerir', {
        method: 'POST',
        body: JSON.stringify({
          nombre,
          descripcion: (inputDesc?.value || '').trim(),
          unidadVenta: (inputUnidadV?.value || '').trim(),
          esGranel: inputGranel?.checked || false,
        }),
      })
      if (resultado && resultado.success === false) {
        throw new Error(resultado.error || 'No se pudo obtener la sugerencia')
      }
      const data = (resultado && resultado.data) ? resultado.data : resultado
      pintarSugerencia(data)
    } catch (err) {
      console.error('Sugerir SAT:', err)
      mostrarEstadoSat('error', err.message)
    } finally {
      btn.disabled = false
    }
  })

  function mostrarEstadoSat(tipo, msg) {
    if (clavesEl) clavesEl.innerHTML = ''
    if (unidadesEl) unidadesEl.innerHTML = ''
    if (razonesEl) razonesEl.innerHTML = ''
    if (badgeEl) { badgeEl.className = 'sat-badge'; badgeEl.textContent = '' }
    if (confEl) confEl.textContent = ''
    if (razonesTgl) razonesTgl.style.display = 'none'

    if (!statusEl) return
    if (tipo === 'vacio') {
      statusEl.textContent = 'Escribe el nombre del producto primero.'
      statusEl.style.display = 'flex'
    } else if (tipo === 'cargando') {
      statusEl.innerHTML = '<span class="spinner"></span> Consultando catálogo.'
      statusEl.style.display = 'flex'
    } else if (tipo === 'error') {
      statusEl.textContent = msg || 'No se pudo obtener la sugerencia.'
      statusEl.style.display = 'flex'
    }
  }

  function pintarSugerencia(data) {
    if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = '' }

    const estado     = (data && data.estado) || 'MANUAL'
    const conf       = Number.isFinite(data?.confianza) ? data.confianza : null
    const unidadSat  = (data?.unidadSat || '').trim()
    const razones    = Array.isArray(data?.razones) ? data.razones : []
    let candidatos   = Array.isArray(data?.candidatos) ? data.candidatos : []

    if (candidatos.length === 0 && data?.claveSat) {
      candidatos = [{ claveSat: data.claveSat, descripcion: data.descripcionSat, score: data.confianza }]
    }

    const claseEstado = { AUTO: 'auto', SUGERIR: 'sugerir', MANUAL: 'manual' }
    const textoEstado = { AUTO: 'Alta confianza', SUGERIR: 'Sugerir', MANUAL: 'Captura manual' }
    if (badgeEl) {
      badgeEl.className = 'sat-badge sat-badge--' + (claseEstado[estado] || 'manual')
      badgeEl.textContent = textoEstado[estado] || estado
    }
    if (confEl) confEl.textContent = conf !== null ? ('confianza ' + conf) : ''

    if (clavesEl) {
      clavesEl.innerHTML = ''
      if (candidatos.length === 0) {
        clavesEl.innerHTML = '<span class="sat-empty">Sin candidatos - captura la clave manualmente.</span>'
      } else {
        candidatos.forEach((c) => {
          const clave = (c?.claveSat || '').trim()
          if (!clave) return
          const chip = document.createElement('button')
          chip.type = 'button'
          chip.className = 'sat-chip'
          chip.innerHTML =
            '<span class="sat-mono">' + escaparHtml(clave) + '</span>' +
            (c.descripcion ? ' - ' + escaparHtml(c.descripcion) : '') +
            (Number.isFinite(c.score) ? ' <span class="sat-score">' + c.score + '</span>' : '')
          chip.addEventListener('click', () => {
            if (inputClaveSat) inputClaveSat.value = clave
            marcarSeleccion(clavesEl, chip)
          })
          clavesEl.appendChild(chip)
        })
      }
    }

    if (unidadesEl) {
      unidadesEl.innerHTML = ''
      if (unidadSat) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'sat-chip'
        const lbl = UNIDAD_LABEL_SAT[unidadSat]
        chip.innerHTML = '<span class="sat-mono">' + escaparHtml(unidadSat) + '</span>' + (lbl ? ' - ' + lbl : '')
        chip.addEventListener('click', () => {
          if (inputUnidadSat) inputUnidadSat.value = unidadSat
          marcarSeleccion(unidadesEl, chip)
        })
        unidadesEl.appendChild(chip)
      } else {
        unidadesEl.innerHTML = '<span class="sat-empty">No se resolvió la unidad - captúrala manualmente.</span>'
      }
    }

    if (razonesEl) razonesEl.innerHTML = ''
    if (razones.length > 0 && razonesEl && razonesTgl) {
      razonesTgl.style.display = 'inline-flex'
      razonesEl.style.display = 'none'
      razonesEl.innerHTML = '<ul>' + razones.map((r) => '<li>' + escaparHtml(r) + '</li>').join('') + '</ul>'
    } else if (razonesTgl) {
      razonesTgl.style.display = 'none'
    }
  }
}

function resetSugerenciaSat() {
  const panel      = document.getElementById('sat-panel')
  const statusEl   = document.getElementById('sat-status')
  const badgeEl    = document.getElementById('sat-badge')
  const confEl     = document.getElementById('sat-confianza')
  const clavesEl   = document.getElementById('sat-claves')
  const unidadesEl = document.getElementById('sat-unidades')
  const razonesEl  = document.getElementById('sat-razones')
  const razonesTgl = document.getElementById('sat-razones-toggle')

  if (panel) panel.style.display = 'none'
  if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = '' }
  if (badgeEl) { badgeEl.className = 'sat-badge'; badgeEl.textContent = '' }
  if (confEl) confEl.textContent = ''
  if (clavesEl) clavesEl.innerHTML = ''
  if (unidadesEl) unidadesEl.innerHTML = ''
  if (razonesEl) { razonesEl.innerHTML = ''; razonesEl.style.display = 'none' }
  if (razonesTgl) razonesTgl.style.display = 'none'
}

function marcarSeleccion(contenedor, chip) {
  contenedor.querySelectorAll('.sat-chip').forEach((c) => c.classList.remove('sat-chip--sel'))
  chip.classList.add('sat-chip--sel')
}

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ))
}

// ═══════════════════════════════════════════════════════════════════
// MODAL PRODUCTO — ABRIR / CERRAR / GUARDAR
// ═══════════════════════════════════════════════════════════════════

window.editarProducto = async function(id) {
  const producto = productosLista.find(p => p.id === id)
  if (!producto) return
  
  console.log('🔍 Editando producto:', producto)
  console.log('📦 Datos de proveedor:', producto.proveedores)
  
  productoActual = producto
  if (modalTitle) modalTitle.textContent = 'Editar Producto'

  // Tipo: setear tab activo y mostrar/ocultar campos físicos
  const esServ = producto.tipo === 'SERVICIO'
  document.querySelectorAll('#tipo-producto-tabs .tipo-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tipo === (esServ ? 'SERVICIO' : 'PRODUCTO'))
  })
  aplicarTipoProducto(esServ)
  // Al editar, el tipo es inmutable — ocultar tabs
  const tabs = document.getElementById('tipo-producto-tabs')
  if (tabs) tabs.style.display = 'none'

  document.getElementById('producto-nombre').value            = producto.nombre
  document.getElementById('producto-codigo').value            = producto.codigoInterno
  document.getElementById('producto-codigoBarras').value      = producto.codigoBarras || ''
  document.getElementById('producto-descripcion').value       = producto.descripcion || ''
  document.getElementById('producto-precioBase').value        = producto.precioBase
  document.getElementById('producto-precioVenta').value       = producto.precioVenta || ''

  // "Precio Proveedor" = precio de CAJA real del proveedor más reciente
  // (ProveedorProducto[0], ordenado por actualizadoEn DESC en el backend).
  // NO se reconstruye desde producto.costo × factor para evitar drift de
  // redondeo; solo cae a producto.costo si el producto no tiene proveedor.
  const _pp = (producto.ProveedorProducto && producto.ProveedorProducto[0]) || null
  const precioProvCaja = (_pp && _pp.precioCosto != null) ? _pp.precioCosto : (producto.costo || '')

  // ✅ FIX: Tipo de factura — leer el valor real guardado en BD
  if (producto.tipoFacturaProv === 'DESGLOSE') {
    if (radioFacturaB) radioFacturaB.checked = true
    aplicarTipoFactura('B')
    document.getElementById('producto-costoSinIva').value      = producto.costoSinIvaProveedor || ''
    document.getElementById('producto-costo-b-display').value  = precioProvCaja
    document.getElementById('producto-costo').value            = precioProvCaja
  } else {
    if (radioFacturaA) radioFacturaA.checked = true
    aplicarTipoFactura('A')
    document.getElementById('producto-costo').value            = precioProvCaja
  }

  document.getElementById('producto-unidadCompra').value      = producto.unidadCompra || ''
  document.getElementById('producto-unidadVenta').value       = producto.unidadVenta || ''
  document.getElementById('producto-factorConversion').value  = producto.factorConversion || ''
  document.getElementById('producto-claveSat').value          = producto.claveSat || ''
  document.getElementById('producto-unidadSat').value         = producto.unidadSat || ''
  
  // Toggle de granel
  const granelCheck = document.getElementById('producto-esGranel')
  if (granelCheck) {
    granelCheck.checked = !!producto.esGranel
    actualizarVisualGranel(granelCheck.checked)
  }
  
  const deptoId = producto.Categoria?.Departamento?.id || ''
  llenarModalDepartamentos(deptoId)
  if (deptoId) actualizarModalCategorias(deptoId, producto.categoriaId)
  
  // Carga del proveedor con validación completa
  if (modalProveedorSelect) {
    console.log('🔄 Iniciando carga de proveedor...')
    
    // 1. Re-llenar el select para asegurar que tiene todas las opciones
    llenarSelectProveedores()
    console.log('✅ Select de proveedores rellenado. Opciones disponibles:', modalProveedorSelect.options.length)
    
    // 2. Extraer el proveedorId del producto
    let proveedorId = ''
    
    // La relación se llama ProveedorProducto (PascalCase)
    if (producto.ProveedorProducto && Array.isArray(producto.ProveedorProducto) && producto.ProveedorProducto.length > 0) {
      proveedorId = producto.ProveedorProducto[0].Proveedor?.id || producto.ProveedorProducto[0].proveedorId || ''
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
  
  // Calcular precio base y margen al cargar producto
  calcularPrecioBase()
  calcularMargen()
  
  resetSugerenciaSat()
  ocultarError()
  if (modal) modal.classList.add('active')
}

function abrirModalNuevo() {
  productoActual = null
  if (modalTitle) modalTitle.textContent = 'Nuevo Producto'
  if (formulario) formulario.reset()
  
  // Inicializar precio base en 0.00
  const precioBaseInput = document.getElementById('producto-precioBase')
  if (precioBaseInput) precioBaseInput.value = '0.00'

  // Resetear tipo de factura a Escenario A (default)
  if (radioFacturaA) radioFacturaA.checked = true
  aplicarTipoFactura('A')

  // Resetear tipo de producto a PRODUCTO
  document.querySelectorAll('#tipo-producto-tabs .tipo-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tipo === 'PRODUCTO')
  })
  // Mostrar tabs (se ocultan al editar)
  const tabs = document.getElementById('tipo-producto-tabs')
  if (tabs) tabs.style.display = ''
  aplicarTipoProducto(false)

  // Limpiar costoSinIva explícitamente (por si no está dentro del form)
  const costoSinIvaInput = document.getElementById('producto-costoSinIva')
  if (costoSinIvaInput) costoSinIvaInput.value = ''

  const unidadVentaInput = document.getElementById('producto-unidadVenta')
  const unidadSatInput = document.getElementById('producto-unidadSat')
  if (unidadVentaInput) unidadVentaInput.value = 'PZA'
  if (unidadSatInput) unidadSatInput.value = 'H87'
  
  llenarModalDepartamentos()
  if (modalCatSelect) { modalCatSelect.innerHTML = '<option value="">Seleccionar categoría...</option>'; modalCatSelect.disabled = true }
  if (modalProveedorSelect) { modalProveedorSelect.value = '' }
  if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'none'
  if (document.getElementById('info-margen')) document.getElementById('info-margen').style.display = 'none'
  // Resetear granel
  const granelCheck = document.getElementById('producto-esGranel')
  if (granelCheck) { granelCheck.checked = false; actualizarVisualGranel(false) }
  resetSugerenciaSat()
  ocultarError()
  if (modal) modal.classList.add('active')
}

function cerrarModal() {
  if (modal) modal.classList.remove('active')
  if (formulario) formulario.reset()
  if (imagenPreviewContainer) imagenPreviewContainer.style.display = 'none'
  resetSugerenciaSat()
  productoActual = null
  const tabs = document.getElementById('tipo-producto-tabs')
  if (tabs) tabs.style.display = ''
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
  if (!precioVenta || parseFloat(precioVenta) <= 0) return mostrarError('El precio de venta al público es requerido')
  const precioBaseNum = parseFloat(precioBase)
  if (isNaN(precioBaseNum) || precioBaseNum <= 0) return mostrarError('El precio base debe ser mayor a 0')
  
  // Obtener proveedorId del select
  const proveedorId = modalProveedorSelect?.value || null

  // ✅ FIX: Determinar tipo de factura según radio seleccionado
  const tipoFactura = radioFacturaB?.checked ? 'DESGLOSE' : 'NETO'

  const tipoProd = document.querySelector('#tipo-producto-tabs .tipo-tab.active')?.dataset.tipo || 'PRODUCTO'
  const unidadCompraValor = obtenerValorUnidad('producto-unidadCompra', unidadesCompraMap)
  const unidadVentaValor = obtenerValorUnidad('producto-unidadVenta', unidadesVentaMap)
  const unidadSatValor = normalizarUnidadTexto(document.getElementById('producto-unidadSat').value)

  const datos = {
    nombre, codigoInterno: codigo,
    codigoBarras:     tipoProd === 'SERVICIO' ? null : (document.getElementById('producto-codigoBarras').value.trim() || null),
    descripcion:      document.getElementById('producto-descripcion').value.trim() || null,
    costo:            tipoProd === 'SERVICIO' ? null : (parseFloat(document.getElementById('producto-costo').value) || null),
    costoSinIvaProveedor: tipoProd === 'SERVICIO' ? null : (parseFloat(document.getElementById('producto-costoSinIva')?.value) || null),
    tipoFacturaProv:  tipoFactura,
    precioBase:       precioBaseNum,
    precioVenta:      precioVenta ? parseFloat(precioVenta) : null,
    categoriaId:      parseInt(categoria),
    proveedorId:      tipoProd === 'SERVICIO' ? null : (proveedorId ? parseInt(proveedorId) : null),
    tipo:             tipoProd,
    unidadCompra:     tipoProd === 'SERVICIO' ? null : unidadCompraValor,
    unidadVenta:      tipoProd === 'SERVICIO' ? null : unidadVentaValor,
    factorConversion: tipoProd === 'SERVICIO' ? null : (parseFloat(document.getElementById('producto-factorConversion').value) || null),
    claveSat:         tipoProd === 'SERVICIO' ? null : (document.getElementById('producto-claveSat').value.trim() || null),
    unidadSat:        tipoProd === 'SERVICIO' ? null : (unidadSatValor || null),
    esGranel:         tipoProd === 'SERVICIO' ? false : (document.getElementById('producto-esGranel')?.checked || false),
  }
  
  console.log('📤 Enviando datos al backend:', datos)
  
  try {
    const metodo = productoActual ? 'PUT' : 'POST'
    const url    = productoActual ? `/productos/${productoActual.id}` : `/productos`
    const resultado = await apiFetch(url, {
      method: metodo,
      body: JSON.stringify(datos)
    })
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
    await apiFetch(`/compras/proveedores/${proveedorId}/productos/${productoId}`, {
      method: 'POST',
      body: JSON.stringify({ precioCosto: 0 })
    })
  } catch (error) {
    console.warn('⚠️ Error vinculando proveedor, pero continuamos')
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
    const resultado = await apiFetch('/compras/proveedores', {
      method: 'POST',
      body: JSON.stringify({ 
        nombreOficial: nombre, 
        alias: apodo || nombre,
        celular,
        email
      })
    })
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

// FIX: toggleEstadoProducto ya no se llama desde onclick inline
// Ahora se invoca desde delegación de eventos en configurarEventos()
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
    await apiFetch(`/productos/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: nuevoEstado })
    })
    await cargarProductos()
  } catch (error) {
    console.error('❌ Error cambiando estado:', error)
  }
}

function mostrarConfirmEstado(id, nuevoEstado, nombreProducto) {
  // Remover modal anterior si existe
  document.getElementById('modal-confirm-estado')?.remove()

  const nombre = (nombreProducto || 'este producto').substring(0, 60)

  const confirmModal = document.createElement('div')
  confirmModal.id = 'modal-confirm-estado'
  confirmModal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.72);
    backdrop-filter:blur(4px);z-index:3000;
    display:flex;align-items:center;justify-content:center;padding:20px;
  `

  confirmModal.innerHTML = `
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

  document.body.appendChild(confirmModal)

  // Eventos
  const cerrar = () => confirmModal.remove()

  document.getElementById('cfe-cancel').addEventListener('click', cerrar)
  confirmModal.addEventListener('mousedown', e => { confirmModal._clkOv = (e.target === confirmModal) })
  confirmModal.addEventListener('click', e => { if (e.target === confirmModal && confirmModal._clkOv) cerrar() })
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
    await apiFetch(`/productos/${productoId}/imagen`, {
      method: 'POST', body: formData
    })
    console.log('✅ Imagen subida')
  } catch (error) { console.error('❌ Error subiendo imagen:', error) }
}

// ─── TIPO DE FACTURA — show/hide campos ───────────────────────────
function aplicarTipoFactura(tipo) {
  const esB = tipo === 'B'
  if (camposFacturaA) camposFacturaA.style.display = esB ? 'none' : ''
  if (camposFacturaB) camposFacturaB.style.display = esB ? ''     : 'none'

  // Estilo visual de los radio labels
  const labelA = document.getElementById('radio-label-a')
  const labelB = document.getElementById('radio-label-b')
  if (labelA) {
    labelA.style.background    = esB ? '' : 'rgba(107,157,232,0.08)'
    labelA.style.borderColor   = esB ? 'var(--panel-border)' : '#6b9de8'
  }
  if (labelB) {
    labelB.style.background    = esB ? 'rgba(107,157,232,0.08)' : ''
    labelB.style.borderColor   = esB ? '#6b9de8' : 'var(--panel-border)'
  }

  // Si cambia a A, limpiar campo sin IVA y display
  if (!esB) {
    const sinIva = document.getElementById('producto-costoSinIva')
    const display = document.getElementById('producto-costo-b-display')
    if (sinIva)  sinIva.value   = ''
    if (display) display.value  = ''
  }

  calcularMargen()
}

// Muestra/oculta campos exclusivos de producto físico (clase .campo-fisico)
function aplicarTipoProducto(esServicio) {
  document.querySelectorAll('.campo-fisico').forEach(el => {
    el.style.display = esServicio ? 'none' : ''
  })
}

// Cuando el empleado escribe en "Precio sin IVA de proveedor" (Esc. B)
// → calcula automáticamente el Precio Proveedor y lo muestra en readonly
function calcularPrecioProveedorDesdeB() {
  const sinIva  = parseFloat(document.getElementById('producto-costoSinIva')?.value) || 0
  const display = document.getElementById('producto-costo-b-display')
  const inputCosto = document.getElementById('producto-costo')

  const precioProveedor = sinIva > 0 ? parseFloat((sinIva * IVA_FACTOR).toFixed(2)) : 0

  // Mostrar en el readonly del Esc. B
  if (display) display.value = precioProveedor > 0 ? precioProveedor : ''

  // Sincronizar también en producto-costo para que guardarProducto() lo lea
  if (inputCosto) inputCosto.value = precioProveedor > 0 ? precioProveedor : ''

  calcularMargen()
}

function calcularMargen() {
  const costoCaja = parseFloat(document.getElementById('producto-costo').value) || 0
  const precioVenta = parseFloat(document.getElementById('producto-precioVenta').value) || 0
  const wrap = document.getElementById('info-margen-wrap')

  if (!wrap) return

  // "Precio Proveedor" es por CAJA; el costo real por unidad de venta (pieza)
  // es caja / factor — la misma división que hace el backend al guardar. El
  // margen debe calcularse sobre el costo por pieza, no sobre el de caja.
  const factorRaw = parseFloat(document.getElementById('producto-factorConversion').value)
  const factor = (Number.isFinite(factorRaw) && factorRaw > 0) ? factorRaw : 1
  const costo = costoCaja / factor

  if (costo > 0 && precioVenta > 0) {
    // Utilidad = Precio Venta - Costo (ambos por pieza)
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

// Calcular precio base automáticamente desde precio venta
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
//  MODAL PRECIOS — Editar solo campos de precio (rol PRECIOS)
// ═══════════════════════════════════════════════════════════════════

let productoPrecio = null

function modoPrecioActual() {
  return document.querySelector('input[name="precio-modo"]:checked')?.value || 'precioVenta'
}

function actualizarModoPrecio() {
  const modo = modoPrecioActual()
  const inputVenta = document.getElementById('precios-venta')
  const inputMargen = document.getElementById('precios-margen')

  if (modo === 'margen') {
    inputMargen.disabled = false
    inputVenta.readOnly = true
    inputVenta.style.background = 'rgba(255,255,255,0.03)'
    inputVenta.style.color = 'var(--muted)'
  } else {
    inputMargen.disabled = true
    inputVenta.readOnly = false
    inputVenta.style.background = ''
    inputVenta.style.color = ''
  }

  actualizarPreviewPrecioBase()
}

function actualizarPreviewPrecioBase() {
  const modo = modoPrecioActual()
  const costo = parseFloat(document.getElementById('precios-costo').dataset.valor || 0)
  const inputVenta = document.getElementById('precios-venta')
  const inputMargen = document.getElementById('precios-margen')
  const previewBase = document.getElementById('precios-base-preview')

  let precioVenta = parseFloat(inputVenta.value)

  if (modo === 'margen') {
    const margen = parseFloat(inputMargen.value)
    if (!isNaN(costo) && costo > 0 && !isNaN(margen)) {
      precioVenta = parseFloat((costo * (1 + margen / 100)).toFixed(2))
      inputVenta.value = precioVenta.toFixed(2)
    }
  }

  if (!isNaN(precioVenta) && precioVenta >= 0) {
    previewBase.value = (precioVenta / IVA_FACTOR).toFixed(2)
  } else {
    previewBase.value = '0.00'
  }
}

window.abrirModalPrecios = function(id) {
  const producto = productosLista.find(p => p.id === id)
  if (!producto) return

  productoPrecio = producto

  document.getElementById('precios-producto-nombre').value = producto.nombre
  const costoInput = document.getElementById('precios-costo')
  const costo = producto.costo ? parseFloat(producto.costo).toFixed(2) : '0.00'
  costoInput.value = `$${costo}`
  costoInput.dataset.valor = producto.costo || 0

  document.getElementById('precios-venta').value = producto.precioVenta || producto.precioBase || ''
  document.getElementById('precios-margen').value = producto.margen || ''
  document.getElementById('precios-mayoreo').value = producto.precioMayoreo || ''
  document.getElementById('precios-error').style.display = 'none'

  // Resetear a modo precioVenta por defecto
  document.querySelector('input[name="precio-modo"][value="precioVenta"]').checked = true
  actualizarModoPrecio()

  document.getElementById('modal-precios').style.display = 'flex'
}

function cerrarModalPrecios() {
  document.getElementById('modal-precios').style.display = 'none'
  productoPrecio = null
}

async function guardarPrecios(e) {
  e.preventDefault()
  const errorDiv = document.getElementById('precios-error')
  errorDiv.style.display = 'none'

  if (!productoPrecio) return

  const modo = modoPrecioActual()
  const body = {}

  if (modo === 'precioVenta') {
    const pv = document.getElementById('precios-venta').value.trim()
    if (pv === '') {
      errorDiv.textContent = 'Ingresa un precio de venta'
      errorDiv.style.display = 'block'
      return
    }
    body.precioVenta = parseFloat(pv)
  }

  if (modo === 'margen') {
    const mg = document.getElementById('precios-margen').value.trim()
    if (mg === '') {
      errorDiv.textContent = 'Ingresa un margen'
      errorDiv.style.display = 'block'
      return
    }
    body.margen = parseFloat(mg)
  }

  const mayoreo = document.getElementById('precios-mayoreo').value.trim()
  if (mayoreo !== '') body.precioMayoreo = parseFloat(mayoreo)

  const btn = e.target.querySelector('button[type="submit"]')
  btn.disabled = true
  const txt = btn.textContent
  btn.textContent = 'Guardando...'

  try {
    await apiFetch(`/precios/${productoPrecio.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
    cerrarModalPrecios()
    await cargarProductos()
  } catch (err) {
    errorDiv.textContent = err.message
    errorDiv.style.display = 'block'
  } finally {
    btn.disabled = false
    btn.textContent = txt
  }
}

// Inicializar eventos del modal de precios
function initModalPrecios() {
  document.getElementById('precios-close-btn')?.addEventListener('click', cerrarModalPrecios)
  document.getElementById('precios-cancel-btn')?.addEventListener('click', cerrarModalPrecios)
  document.getElementById('precios-form')?.addEventListener('submit', guardarPrecios)

  // FIX: radios de modo (precioVenta / margen) — reemplaza onchange inline del HTML
  document.querySelectorAll('input[name="precio-modo"]').forEach(radio => {
    radio.addEventListener('change', actualizarModoPrecio)
  })

  document.getElementById('precios-venta')?.addEventListener('input', () => {
    if (modoPrecioActual() === 'precioVenta') actualizarPreviewPrecioBase()
  })
  document.getElementById('precios-margen')?.addEventListener('input', () => {
    if (modoPrecioActual() === 'margen') actualizarPreviewPrecioBase()
  })

  // Cerrar haciendo click fuera
  const mp = document.getElementById('modal-precios')
  mp?.addEventListener('mousedown', e => { mp._clkOv = (e.target === mp) })
  mp?.addEventListener('click', e => { if (e.target === mp && mp._clkOv) cerrarModalPrecios() })
}

// ════════════════════════════════════════════════════════════════════
//  MODAL BÁSICO — edición limitada para rol EMPLEADO (3 campos)
// ════════════════════════════════════════════════════════════════════

let productoBasico = null

function initModalBasico() {
  const modalB = document.getElementById('modal-basico')
  if (!modalB) return
  document.getElementById('basico-close-btn')?.addEventListener('click', cerrarModalBasico)
  document.getElementById('basico-cancel-btn')?.addEventListener('click', cerrarModalBasico)
  modalB.addEventListener('mousedown', e => { modalB._clkOv = (e.target === modalB) })
  modalB.addEventListener('click', e => { if (e.target === modalB && modalB._clkOv) cerrarModalBasico() })
  document.getElementById('basico-form')?.addEventListener('submit', guardarDatosBasicos)
}

window.abrirModalBasico = function(id) {
  const producto = productosLista.find(p => p.id === id)
  if (!producto) return
  productoBasico = producto
  document.getElementById('basico-nombre').value       = producto.nombre || ''
  document.getElementById('basico-codigo').value       = producto.codigoInterno || ''
  document.getElementById('basico-codigoBarras').value = producto.codigoBarras || ''
  mostrarErrorBasico('')
  document.getElementById('modal-basico').style.display = 'flex'
  setTimeout(() => document.getElementById('basico-nombre').focus(), 80)
}

function cerrarModalBasico() {
  const modalB = document.getElementById('modal-basico')
  if (modalB) modalB.style.display = 'none'
  productoBasico = null
}

async function guardarDatosBasicos(e) {
  e.preventDefault()
  if (!productoBasico) return
  const nombre       = document.getElementById('basico-nombre').value.trim()
  const codigo       = document.getElementById('basico-codigo').value.trim()
  const codigoBarras = document.getElementById('basico-codigoBarras').value.trim()

  if (!nombre) return mostrarErrorBasico('El nombre es requerido')
  if (!codigo) return mostrarErrorBasico('El código interno es requerido')

  const btn = document.getElementById('basico-confirm-btn')
  if (btn) { btn.disabled = true; btn.dataset.txt = btn.innerHTML; btn.innerHTML = '⟳ Guardando...' }

  try {
    await apiFetch(`/productos/${productoBasico.id}/datos-basicos`, {
      method: 'PATCH',
      body: JSON.stringify({ nombre, codigoInterno: codigo, codigoBarras: codigoBarras || null })
    })
    cerrarModalBasico()
    await cargarProductos()
  } catch (error) {
    mostrarErrorBasico(error.message)
  } finally {
    if (btn) { btn.disabled = false; if (btn.dataset.txt) btn.innerHTML = btn.dataset.txt }
  }
}

function mostrarErrorBasico(msg) {
  const el = document.getElementById('basico-error')
  if (!el) return
  el.textContent = msg
  el.classList.toggle('show', !!msg)
}

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
// PAGINACIÓN — Renderizado de controles
// ═══════════════════════════════════════════════════════════════════

function renderizarPaginacion() {
  const bar     = document.getElementById('paginacion-bar')
  const btnAnt  = document.getElementById('btn-pag-anterior')
  const btnSig  = document.getElementById('btn-pag-siguiente')
  const info    = document.getElementById('pag-info')

  if (!bar) return

  // Ocultar si solo hay 1 página o menos
  if (totalPaginas <= 1) {
    bar.style.display = 'none'
    return
  }

  bar.style.display = 'flex'

  if (btnAnt) btnAnt.disabled = paginaActual <= 1
  if (btnSig) btnSig.disabled = paginaActual >= totalPaginas
  if (info)   info.textContent = `Página ${paginaActual} de ${totalPaginas} (${totalProductos} productos)`
}

function ocultarPaginacion() {
  const bar = document.getElementById('paginacion-bar')
  if (bar) bar.style.display = 'none'
}

// ═══════════════════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════════════════

function configurarEventos() {
  if (btnNuevoProducto) btnNuevoProducto.addEventListener('click', abrirModalNuevo)
  if (btnCancelModal)   btnCancelModal.addEventListener('click', cerrarModal)
  if (btnCloseModal)    btnCloseModal.addEventListener('click', cerrarModal)
  if (formulario)       formulario.addEventListener('submit', guardarProducto)

  // Filtros toolbar — todos delegan al backend via aplicarFiltros()
  if (filtroDepto) filtroDepto.addEventListener('change', () => { actualizarCategoriasFiltroToolbar(); aplicarFiltros() })
  if (filtroCat)   filtroCat.addEventListener('change', () => aplicarFiltros())
  if (searchInput) {
    let debounce
    searchInput.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => aplicarFiltros(), 400) })
    searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') { clearTimeout(debounce); aplicarFiltros() } })
  }
  if (filtroStock)       filtroStock.addEventListener('change', aplicarFiltros)
  if (filtroTipo)        filtroTipo.addEventListener('change', aplicarFiltros)
  if (filtroActivo)      filtroActivo.addEventListener('change', aplicarFiltros)
  if (btnLimpiarFiltros) btnLimpiarFiltros.addEventListener('click', limpiarFiltros)

  // ── Paginación ──
  const btnPagAnt = document.getElementById('btn-pag-anterior')
  const btnPagSig = document.getElementById('btn-pag-siguiente')
  if (btnPagAnt) btnPagAnt.addEventListener('click', () => { if (paginaActual > 1) { paginaActual--; cargarProductos() } })
  if (btnPagSig) btnPagSig.addEventListener('click', () => { if (paginaActual < totalPaginas) { paginaActual++; cargarProductos() } })

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
  if (modal) {
    modal.addEventListener('mousedown', e => { modal._clkOv = (e.target === modal) })
    modal.addEventListener('click', e => { if (e.target === modal && modal._clkOv) cerrarModal() })
  }

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
  const inputCosto       = document.getElementById('producto-costo')
  const inputPrecioVenta = document.getElementById('producto-precioVenta')

  // Radio buttons tipo de factura
  if (radioFacturaA) radioFacturaA.addEventListener('change', () => aplicarTipoFactura('A'))
  if (radioFacturaB) radioFacturaB.addEventListener('change', () => aplicarTipoFactura('B'))

  // Tabs tipo de producto → mostrar/ocultar campos físicos
  document.querySelectorAll('#tipo-producto-tabs .tipo-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#tipo-producto-tabs .tipo-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      aplicarTipoProducto(tab.dataset.tipo === 'SERVICIO')
    })
  })

  // Campo sin IVA de proveedor (Esc. B) → calcula precio proveedor automático
  const inputCostoSinIva = document.getElementById('producto-costoSinIva')
  if (inputCostoSinIva) inputCostoSinIva.addEventListener('input', calcularPrecioProveedorDesdeB)
  
  // Cuando cambia el precio venta: calcular precio base Y margen
  if (inputPrecioVenta) {
    inputPrecioVenta.addEventListener('input', () => {
      calcularPrecioBase()
      calcularMargen()
    })
  }
  
  // Cuando cambia el costo: solo recalcular margen
  if (inputCosto) {
    inputCosto.addEventListener('input', calcularMargen)
  }

  // Recalcular margen en vivo al cambiar el factor de conversión
  const inputFactor = document.getElementById('producto-factorConversion')
  if (inputFactor) inputFactor.addEventListener('input', calcularMargen)

  // ── FIX: Prevenir que el escáner de código de barras dispare submit del form ──
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
    modalProveedor.addEventListener('mousedown', e => { modalProveedor._clkOv = (e.target === modalProveedor) })
    modalProveedor.addEventListener('click', e => { if (e.target === modalProveedor && modalProveedor._clkOv) cerrarModalNuevoProveedor() })
  }

  // Toggle de granel
  const granelCheck = document.getElementById('producto-esGranel')
  if (granelCheck) {
    granelCheck.addEventListener('change', () => actualizarVisualGranel(granelCheck.checked))
  }

  // ── Toggle vista Grid / Lista ──
  btnVistaGrid?.addEventListener('click', () => {
    if (vistaActual === 'grid') return
    vistaActual = 'grid'
    localStorage.setItem('jesha_productos_view_mode', vistaActual)
    renderizarProductos(productosLista)
  })

  btnVistaLista?.addEventListener('click', () => {
    if (vistaActual === 'lista') return
    vistaActual = 'lista'
    localStorage.setItem('jesha_productos_view_mode', vistaActual)
    renderizarProductos(productosLista)
  })

  // ═══════════════════════════════════════════════════════════════════
  // FIX: DELEGACIÓN DE EVENTOS — reemplaza onclick inline en tabla y grid
  // ═══════════════════════════════════════════════════════════════════
  function manejarClickAccionProducto(e) {
    const imgZoom = e.target.closest('.producto-card-image[data-zoom-id]')
    if (imgZoom) {
      abrirZoomImagen(parseInt(imgZoom.dataset.zoomId))
      return
    }

    const btnBasico = e.target.closest('.btn-editar-basico')
    if (btnBasico) {
      const id = parseInt(btnBasico.dataset.id)
      if (id) abrirModalBasico(id)
      return
    }

    const btnEditar = e.target.closest('.btn-editar-producto')
    if (btnEditar) {
      const id = parseInt(btnEditar.dataset.id)
      if (id) editarProducto(id)
      return
    }

    const btnAjuste = e.target.closest('.btn-ajuste-inv')
    if (btnAjuste) {
      e.stopPropagation()
      const id = parseInt(btnAjuste.dataset.id)
      if (id) abrirAjusteInventario(id)
      return
    }

    const btnEstado = e.target.closest('.btn-toggle-estado')
    if (btnEstado) {
      const id = parseInt(btnEstado.dataset.id)
      const activoActual = btnEstado.dataset.activo === 'true'
      const nombre = btnEstado.dataset.nombre || ''
      if (id) toggleEstadoProducto(id, !activoActual, nombre)
      return
    }

    const btnPrecio = e.target.closest('.btn-editar-precio')
    if (btnPrecio) {
      const id = parseInt(btnPrecio.dataset.id)
      if (id) abrirModalPrecios(id)
      return
    }

    const btnAgregarImg = e.target.closest('.btn-agregar-imagen')
    if (btnAgregarImg) {
      const id = parseInt(btnAgregarImg.dataset.id)
      if (id) {
        editarProducto(id)
        setTimeout(() => {
          const inputFile = document.getElementById('producto-imagen')
          if (inputFile) inputFile.click()
        }, 400)
      }
      return
    }
  }

  if (productosTbody) productosTbody.addEventListener('click', manejarClickAccionProducto)
  if (productosGrid) productosGrid.addEventListener('click', manejarClickAccionProducto)
}

// Visual del toggle de granel
function actualizarVisualGranel(activo) {
  const knob = document.getElementById('granel-toggle-knob')
  const track = knob?.parentElement
  const infoDiv = document.getElementById('granel-unidad-info')
  if (knob) knob.style.transform = activo ? 'translateX(20px)' : 'translateX(0)'
  if (track) track.style.background = activo ? '#6b9de8' : 'rgba(255,255,255,0.1)'
  if (infoDiv) infoDiv.style.display = activo ? 'block' : 'none'
}



// ════════════════════════════════════════════════════════════════════
//  IMPORTACIÓN INVENTARIO — Modal integrado en productos.js
//  FEAT: modoImportacion controla upsert vs solo_nuevos
//  FIX: variable modal renombrada a modalImport (evita sombra)
//  FIX: API_URL_IMPORT eliminada, se usa API_URL
// ════════════════════════════════════════════════════════════════════

// ── Estado ──
let importArchivoSeleccionado = null
let importValidado            = false
let modoImportacion           = 'upsert' // 'upsert' | 'solo_nuevos'

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
//  CONFIGURAR MODAL SEGÚN MODO
// ════════════════════════════════════════════════════════════════════

function configurarModalImportSegunModo() {
  const titulo   = document.getElementById('import-modal-titulo')
  const subtit   = document.getElementById('import-modal-sub')
  const iconSvg  = document.getElementById('import-icon-svg')

  if (modoImportacion === 'solo_nuevos') {
    if (titulo)  titulo.textContent  = 'Subir Solo Nuevos (Ignorar Existentes)'
    if (subtit)  subtit.textContent  = 'Solo se crearán productos que no existan en la base de datos'
    if (iconSvg) {
      iconSvg.setAttribute('stroke', '#f59e0b')
      iconSvg.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'
    }
  } else {
    if (titulo)  titulo.textContent  = 'Subir Inventario (Actualizar y Crear)'
    if (subtit)  subtit.textContent  = 'Importar productos desde archivo CSV'
    if (iconSvg) {
      iconSvg.setAttribute('stroke', '#6b9de8')
      iconSvg.innerHTML = '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>'
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZAR MÓDULO
// ════════════════════════════════════════════════════════════════════

function initImportacion() {
  const btnSubir       = document.getElementById('btn-subir-inventario')
  const btnSoloNuevos  = document.getElementById('btn-subir-solo-nuevos')
  const modalImport    = document.getElementById('modal-importacion') // FIX: renombrada
  const btnClose       = document.getElementById('import-close-btn')
  const btnCancel      = document.getElementById('import-cancel-btn')
  const btnValidar     = document.getElementById('import-validate-btn')
  const btnImportar    = document.getElementById('import-confirm-btn')
  const fileInput      = document.getElementById('import-csv-file')
  const dropZone       = document.getElementById('import-drop-zone')

  // Abrir modal — modo UPSERT
  btnSubir?.addEventListener('click', () => {
    modoImportacion = 'upsert'
    resetModalImport()
    configurarModalImportSegunModo()
    modalImport.style.display = 'flex'
  })

  // Abrir modal — modo SOLO NUEVOS
  btnSoloNuevos?.addEventListener('click', () => {
    modoImportacion = 'solo_nuevos'
    resetModalImport()
    configurarModalImportSegunModo()
    modalImport.style.display = 'flex'
  })

  // Cerrar modal
  const cerrarImport = () => {
    modalImport.style.display = 'none'
    resetModalImport()
  }
  btnClose?.addEventListener('click', cerrarImport)
  btnCancel?.addEventListener('click', cerrarImport)
  modalImport?.addEventListener('mousedown', e => { modalImport._clkOv = (e.target === modalImport) })
  modalImport?.addEventListener('click', e => { if (e.target === modalImport && modalImport._clkOv) cerrarImport() })
  document.addEventListener('keydown', function escImport(e) { if (e.key === 'Escape') { cerrarImport(); document.removeEventListener('keydown', escImport) } })

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
//  ACTUALIZADO: CLAVE SAT y UNIDAD SAT ahora son obligatorias
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

    // Verificar columnas críticas — ACTUALIZADO: incluye CLAVE SAT y UNIDAD SAT
    const requeridas = ['CLAVE', 'DESCRIPCION', 'PRECIO 1', 'CLAVE SAT', 'UNIDAD SAT']
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

    let total = 0, cientificas = 0, sinPrecio = 0, sinClaveSat = 0, sinUnidadSat = 0, conStock = 0
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

      const us = (vals[idxUnidSat] || '').trim()
      if (!us || us.toLowerCase() === 'null') sinUnidadSat++

      if (idxExist >= 0) {
        const exist = parseFloat(vals[idxExist] || '0')
        if (exist > 0) conStock++
      }
    }

    // Render resultado
    const valDiv = document.getElementById('import-validacion')
    valDiv.style.display = 'block'

    // Etiqueta del modo activo
    const modoLabel = modoImportacion === 'solo_nuevos'
      ? '<div style="margin-bottom:8px;padding:4px 10px;display:inline-block;font-size:0.72rem;font-weight:700;background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.25);border-radius:5px;">MODO: SOLO NUEVOS</div>'
      : '<div style="margin-bottom:8px;padding:4px 10px;display:inline-block;font-size:0.72rem;font-weight:700;background:rgba(107,157,232,0.1);color:#6b9de8;border:1px solid rgba(107,157,232,0.25);border-radius:5px;">MODO: ACTUALIZAR Y CREAR</div>'

    valDiv.innerHTML = `
      ${modoLabel}
      <div class="import-stat"><span class="import-stat-label">Total productos en CSV</span><span class="import-stat-val">${total}</span></div>
      <div class="import-stat"><span class="import-stat-label">Con CLAVE SAT</span><span class="import-stat-val ${sinClaveSat === 0 ? 'ok' : 'warn'}">${total - sinClaveSat} / ${total}</span></div>
      <div class="import-stat"><span class="import-stat-label">Con UNIDAD SAT</span><span class="import-stat-val ${sinUnidadSat === 0 ? 'ok' : 'warn'}">${total - sinUnidadSat} / ${total}</span></div>
      <div class="import-stat"><span class="import-stat-label">Con stock inicial</span><span class="import-stat-val ok">${conStock}</span></div>
      ${cientificas > 0 ? `<div class="import-stat"><span class="import-stat-label">CLAVEs en notación científica</span><span class="import-stat-val warn">${cientificas} (se omitirán)</span></div>` : ''}
      ${duplicados > 0 ? `<div class="import-stat"><span class="import-stat-label">CLAVEs duplicadas</span><span class="import-stat-val warn">${duplicados} (se ${modoImportacion === 'solo_nuevos' ? 'ignorarán' : 'actualizarán'})</span></div>` : ''}
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
//  ACTUALIZADO: lee modoImportacion para elegir endpoint y adaptar resultado
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
    progresoText.textContent = modoImportacion === 'solo_nuevos'
      ? 'Creando solo productos nuevos...'
      : 'Procesando productos...'

    // FIX: usar API_URL en lugar de API_URL_IMPORT
    const endpoint = modoImportacion === 'solo_nuevos'
      ? '/productos/importar/solo-nuevos'
      : '/productos/importar/csv'

    const resultado = await apiFetch(endpoint, {
      method: 'POST',
      body: formData
    })

    progresoFill.style.width = '100%'
    progresoFill.style.background = '#60d080'
    progresoText.textContent = '¡Importación completada!'

    // Mostrar resultado — adaptado según modo
    const valDiv = document.getElementById('import-validacion')
    valDiv.style.display = 'block'

    if (modoImportacion === 'solo_nuevos') {
      valDiv.innerHTML = `
        <div class="import-stat"><span class="import-stat-label">Total en archivo</span><span class="import-stat-val">${resultado.total}</span></div>
        <div class="import-stat"><span class="import-stat-label">Creados (nuevos)</span><span class="import-stat-val ok">+${resultado.creados}</span></div>
        <div class="import-stat"><span class="import-stat-label">Omitidos (ya existían)</span><span class="import-stat-val warn">${resultado.omitidos || 0}</span></div>
        ${resultado.vinculaciones > 0 ? `<div class="import-stat"><span class="import-stat-label">Proveedores vinculados</span><span class="import-stat-val ok">${resultado.vinculaciones}</span></div>` : ''}
        ${resultado.errores > 0 ? `<div class="import-stat"><span class="import-stat-label">Errores</span><span class="import-stat-val danger">${resultado.errores}</span></div>` : ''}
      `
    } else {
      valDiv.innerHTML = `
        <div class="import-stat"><span class="import-stat-label">Total en archivo</span><span class="import-stat-val">${resultado.total}</span></div>
        <div class="import-stat"><span class="import-stat-label">Creados</span><span class="import-stat-val ok">+${resultado.creados}</span></div>
        <div class="import-stat"><span class="import-stat-label">Actualizados</span><span class="import-stat-val ok">↑${resultado.actualizados || 0}</span></div>
        ${resultado.omitidos > 0 ? `<div class="import-stat"><span class="import-stat-label">Omitidos</span><span class="import-stat-val warn">${resultado.omitidos}</span></div>` : ''}
        ${resultado.errores > 0 ? `<div class="import-stat"><span class="import-stat-label">Errores</span><span class="import-stat-val danger">${resultado.errores}</span></div>` : ''}
      `
    }

    // Log detalle omitidos en consola
    if (resultado.detalleOmitidos && resultado.detalleOmitidos.length > 0) {
      console.warn(`⚠️ ${resultado.omitidos} productos omitidos:`)
      console.table(resultado.detalleOmitidos)
    }

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
//  AJUSTE INVENTARIO
// ════════════════════════════════════════════════════════════════════

// Roles que pueden ajustar inventario
const ROLES_AJUSTE = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN']
let productoAjuste = null

function initAjusteInventario() {
  const modalAjuste = document.getElementById('modal-ajuste-inv')
  const btnClose   = document.getElementById('ajuste-close-btn')
  const btnCancel  = document.getElementById('ajuste-cancel-btn')
  const btnConfirm = document.getElementById('ajuste-confirm-btn')

  function cerrar() {
    if (modalAjuste) modalAjuste.style.display = 'none'
    productoAjuste = null
    document.getElementById('ajuste-stock-nuevo').value = ''
    document.getElementById('ajuste-min-nuevo').value   = ''
    document.getElementById('ajuste-motivo').value      = ''
    document.getElementById('ajuste-error').style.display = 'none'
  }

  btnClose?.addEventListener('click', cerrar)
  btnCancel?.addEventListener('click', cerrar)
  modalAjuste?.addEventListener('mousedown', e => { modalAjuste._clkOv = (e.target === modalAjuste) })
  modalAjuste?.addEventListener('click', e => { if (e.target === modalAjuste && modalAjuste._clkOv) cerrar() })
  document.addEventListener('keydown', function escAjuste(e) { if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', escAjuste) } })
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
  document.getElementById('ajuste-stock-actual-display').textContent = fmtStock(stock)
  document.getElementById('ajuste-min-actual-display').textContent   = fmtStock(min)
  document.getElementById('ajuste-stock-nuevo').value = ''
  document.getElementById('ajuste-min-nuevo').value   = ''
  document.getElementById('ajuste-motivo').value      = ''
  document.getElementById('ajuste-error').style.display = 'none'

  const inputStockNuevo = document.getElementById('ajuste-stock-nuevo')
  const inputMinNuevo   = document.getElementById('ajuste-min-nuevo')
  if (inputStockNuevo) { inputStockNuevo.step = '1'; inputStockNuevo.min = '0' }
  if (inputMinNuevo)   { inputMinNuevo.step = '1'; inputMinNuevo.min = '0' }

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
    if (stockNuevo !== '') body.stockActual       = parseFloat(stockNuevo)
    if (minNuevo   !== '') body.stockMinimoAlerta = parseFloat(minNuevo)
    if (motivo)            body.motivo            = motivo

    const editResp = await apiFetch(`/productos/${productoAjuste.id}/inventario`, {
      method:  'PATCH',
      body:    JSON.stringify(body)
    })

    if (editResp.stockAlerts && editResp.stockAlerts.length > 0) {
      mostrarBannerStockAlertas(editResp.stockAlerts)
    }

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

// ════════════════════════════════════════════════════════════════════
//  PLANTILLA CORRECCIÓN — Descarga Excel con sin stock + stock bajo
//  Sube el Excel corregido para actualizar stockMinimoAlerta/stockMaximo
//  Endpoint: GET/POST /reportes/stock/plantilla-correccion
// ════════════════════════════════════════════════════════════════════

function initPlantillaCorreccion() {
  const btnDescargar = document.getElementById('btn-descargar-plantilla')
  const btnSubir     = document.getElementById('btn-subir-plantilla')
  const inputFile   = document.getElementById('input-plantilla-correccion')

  if (!btnDescargar || !btnSubir || !inputFile) return

  btnDescargar.addEventListener('click', async () => {
    const token = localStorage.getItem('jesha_token')
    const api = window.__JESHA_API_URL__ || 'http://localhost:3000'
    try {
      btnDescargar.disabled = true
      btnDescargar.textContent = '⏳ Descargando...'

      const res = await fetch(`${api}/reportes/stock/plantilla-correccion`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla-correccion.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      jeshaToast('✅ Plantilla descargada. Edita la hoja "Corrección" y súbela de vuelta.', 'success')
    } catch (err) {
      jeshaToast('❌ Error al descargar plantilla: ' + err.message, 'error')
    } finally {
      btnDescargar.disabled = false
      btnDescargar.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar Plantilla Corrección`
    }
  })

  btnSubir.addEventListener('click', () => inputFile.click())

  inputFile.addEventListener('change', async (e) => {
    const archivo = e.target.files[0]
    if (!archivo) return

    const confirmar = await jeshaConfirm({
      title: 'Subir plantilla corregida',
      message: `Se actualizarán Stock, Mín y Máx de los productos modificados en <strong>"${archivo.name}"</strong>.`,
      confirmText: 'Sí, subir',
      cancelText: 'Cancelar',
      type: 'primary'
    })
    if (!confirmar) { inputFile.value = ''; return }

    btnSubir.disabled = true
    const textoOriginal = btnSubir.innerHTML
    btnSubir.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Subiendo...`

    try {
      const formData = new FormData()
      formData.append('archivo', archivo)
      const res = await apiFetch('/reportes/stock/corregir-plantilla', {
        method: 'POST',
        body: formData
      })
      jeshaToast(
        `✅ ${res.actualizados} productos actualizados` +
        (res.sinCambios > 0 ? `, ${res.sinCambios} sin cambios` : '') +
        (res.noEncontrados > 0 ? `, ${res.noEncontrados} no encontrados` : ''),
        res.noEncontrados > 0 ? 'warning' : 'success'
      )
      await cargarProductos()
    } catch (err) {
      jeshaToast('❌ Error: ' + err.message, 'error')
    } finally {
      btnSubir.disabled = false
      btnSubir.innerHTML = textoOriginal
      inputFile.value = ''
    }
  })
}
