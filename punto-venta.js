// ══════════════════════════════════════════════════════════════════
//  PUNTO DE VENTA — JAVASCRIPT
// ══════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')

if (!TOKEN && !window.location.pathname.includes('login.html')) {
  localStorage.setItem('redirect_after_login', 'punto-venta.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'
console.log('✅ Punto-venta.js cargado correctamente')
console.log('✅ Usuario:', USUARIO.nombre || 'Anónimo')

const styleBtnCargarMas = document.createElement('style')
styleBtnCargarMas.id = 'btn-cargar-mas-styles'
styleBtnCargarMas.textContent = `
.btn-cargar-mas {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  max-width: 400px;
  margin: 20px auto;
  padding: 14px 24px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  color: #9fb3d4;
  font-family: 'Barlow', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.btn-cargar-mas:hover {
  background: rgba(255,255,255,0.10);
  color: #e8edf5;
}
.btn-cargar-mas .spinner-btn {
  font-size: 0.85rem;
}
`
document.head.appendChild(styleBtnCargarMas)

// ══════════════════════════════════════════════════════════════════
//  DOM ELEMENTS
// ══════════════════════════════════════════════════════════════════

const searchProductos          = document.getElementById('search-productos')
const productosGrid            = document.getElementById('productos-grid')
const carritoTbody             = document.getElementById('carrito-tbody')
const itemsCount               = document.getElementById('items-count')
const clienteNombre            = document.getElementById('cliente-nombre')
const metodosPayButtons        = document.querySelectorAll('.metodo-btn')
const montoRecibido            = document.getElementById('monto-recibido')
const montoEfectivoControl     = document.getElementById('monto-efectivo-control')
const resumenTotal             = document.getElementById('resumen-total')
const btnCompletarVenta        = document.getElementById('btn-completar-venta')
const btnLimpiarCarrito        = document.getElementById('btn-limpiar-carrito')
const modalClienteRapido       = document.getElementById('modal-cliente-rapido')
const modalConfirmacion        = document.getElementById('modal-confirmacion')
const modalAbrirTurno          = document.getElementById('modal-abrir-turno')
const btnConfirmarAbrirTurno   = document.getElementById('btn-confirmar-abrir-turno')
const btnCancelTurno           = document.getElementById('btn-cancel-turno')
const btnModalTurnoClose       = document.getElementById('modal-turno-close')
const montoInicialTurno        = document.getElementById('monto-inicial-turno')
const turnoError               = document.getElementById('turno-error')
const clienteRapidoForm        = document.getElementById('cliente-rapido-form')
const btnCancelCliente         = document.getElementById('btn-cancel-cliente')
const btnModalClienteClose     = document.getElementById('modal-cliente-close')
const btnCancelVenta           = document.getElementById('btn-cancelar-venta')
const btnConfirmarVenta        = document.getElementById('btn-confirmar-venta')
const btnModalConfirmacionClose = document.getElementById('modal-confirmacion-close')
const fechaActual              = document.getElementById('fecha-actual')

// ── ARTÍCULO RÁPIDO ──
const btnArticuloRapido        = document.getElementById('btn-articulo-rapido')
const modalArticuloRapido      = document.getElementById('modal-articulo-rapido')
const arForm                   = document.getElementById('articulo-rapido-form')
const arNombre                 = document.getElementById('ar-nombre')
const arCodigo                 = document.getElementById('ar-codigo')
const arCodigoBarras           = document.getElementById('ar-codigoBarras')
const arCategoria              = document.getElementById('ar-categoria')
const arPrecio                 = document.getElementById('ar-precio')
const arUnidad                 = document.getElementById('ar-unidad')
const arStock                  = document.getElementById('ar-stock')
const arCantidad               = document.getElementById('ar-cantidad')
const arEsGranel               = document.getElementById('ar-esGranel')
const arError                  = document.getElementById('ar-error')
const arSubmit                 = document.getElementById('ar-submit')
const arCancel                 = document.getElementById('ar-cancel')
const arClose                  = document.getElementById('ar-close')
const arPreview                = document.getElementById('ar-preview')
const arPreviewText            = document.getElementById('ar-preview-text')
const arBtnAvanzadas           = document.getElementById('ar-btn-avanzadas')
const arAvanzadas              = document.getElementById('ar-avanzadas')

let _arCategoriasCache  = null
let _arAvanzadasAbierto  = false
const AR_CAT_KEY        = 'jesha_categorias_cache_v1'
const AR_LAST_CAT_KEY   = 'jesha_ar_last_cat'
const turnoStatus              = document.getElementById('turno-status')

if (fechaActual) {
  const fecha = new Date()
  fechaActual.textContent = fecha.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

// ══════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════════

let carrito                = []
let _carritoRestaurado     = false // flag para evitar doble carga de cotización
let vendedorSeleccionado   = null   // { id, nombre } — usuario que hizo la venta
let descuentoManual        = 0      // porcentaje de descuento aplicado
let creditoCliente         = null   // { limite, saldo, disponible } si cliente es REGISTRADO
let turnoActivo            = null
let metodoPagoSeleccionado = null   // null = sin selección, cajero debe elegir
let clienteSeleccionado    = null
let ventaEnProceso         = false
let clientesLista          = []
let cotIdActual            = null
const productoCache        = new Map()
let resultadosBusqueda      = []     // Acumula resultados de la búsqueda activa
let paginaActual            = 1      // Página actual
let totalPaginas            = 1      // Total de páginas (del backend)
let isLoadingMore           = false  // Flag anti-doble-fetch
let terminoBusquedaActual   = ''     // Para poder hacer "cargar más"

// ══════════════════════════════════════════════════════════════════
//  PERSISTENCIA DEL CARRITO — sessionStorage
//  Se guarda cada vez que el carrito cambia.
//  Se restaura al cargar la página (si el usuario navegó a otro módulo y volvió).
//  Se limpia automáticamente al cerrar la pestaña del navegador.
// ══════════════════════════════════════════════════════════════════

function guardarCarritoEnSession() {
  try {
    const estado = {
      carrito,
      clienteSeleccionado,
      metodoPagoSeleccionado
    }
    sessionStorage.setItem('jesha_carrito', JSON.stringify(estado))
  } catch (e) {
    console.warn('⚠️ No se pudo guardar carrito en session:', e.message)
  }
}

function restaurarCarritoDeSession() {
  try {
    const raw = sessionStorage.getItem('jesha_carrito')
    if (!raw) return false

    const estado = JSON.parse(raw)
    if (!Array.isArray(estado.carrito) || estado.carrito.length === 0) return false

    carrito = estado.carrito

    // Restaurar cache de productos desde el carrito
    carrito.forEach(item => {
      if (!productoCache.has(item.id)) {
        productoCache.set(item.id, {
          id: item.id, nombre: item.nombre,
          precioVenta: item.precioOriginal || item.precio,
          precioBase: item.precioOriginal || item.precio,
          stock: null, codigoInterno: '',
          esGranel: item.esGranel || false,
          unidadVenta: item.unidadVenta || '',
          unidadCompra: item.unidadCompra || '',
          factorConversion: item.factorConversion || 1
        })
      }
    })

    // Restaurar cliente
    if (estado.clienteSeleccionado?.id) {
      clienteSeleccionado = estado.clienteSeleccionado
      if (clienteNombre) clienteNombre.value = clienteSeleccionado.nombre || ''
      const badge = document.getElementById('cliente-seleccionado-badge')
      const badgeNombre = document.getElementById('cliente-badge-nombre')
      if (badge && badgeNombre) {
        badgeNombre.textContent = clienteSeleccionado.nombre || ''
        badge.style.display = 'flex'
      }
      verificarCreditoCliente(clienteSeleccionado.id)
    }

    // Restaurar método de pago
    if (estado.metodoPagoSeleccionado) {
      metodoPagoSeleccionado = estado.metodoPagoSeleccionado
      document.querySelectorAll('.metodo-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.metodo === metodoPagoSeleccionado)
      })
    }

    actualizarCarrito()
    _carritoRestaurado = true
    console.log(`✅ Carrito restaurado: ${carrito.length} producto(s)`)
    return true
  } catch (e) {
    console.warn('⚠️ Error restaurando carrito:', e.message)
    sessionStorage.removeItem('jesha_carrito')
    return false
  }
}

function limpiarCarritoSession() {
  sessionStorage.removeItem('jesha_carrito')
}

// ══════════════════════════════════════════════════════════════════
//  EDICIÓN DE PRECIO EN CARRITO
//  Solo afecta la venta actual, NO modifica la base de datos.
//  Guarda el precio original para mostrarlo tachado como referencia.
// ══════════════════════════════════════════════════════════════════

function actualizarPrecio(productoId, nuevoPrecio) {
  const item = carrito.find(i => i.id === productoId)
  if (!item) return
  const parsed = parseFloat(nuevoPrecio)
  if (isNaN(parsed) || parsed < 0) return
  // Guardar precio original la primera vez que se edita
  if (item.precioOriginal === undefined) {
    item.precioOriginal = item.precio
  }
  item.precio = parseFloat(parsed.toFixed(2))
  // Editar el precio manualmente desliga la línea de la captura por importe
  if (item.capturadoPorImporte) { item.capturadoPorImporte = false; delete item.importeCapturado }
  actualizarCarrito()
}

// ══════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('📄 DOMContentLoaded: Punto de Venta')
  await verificarTurno()
  purgarPausadasDeOtroTurno()
  actualizarBadgePausadas()
  await cargarClientes()
  mostrarEstadoInicial()
  configurarEventListeners()
  // Quitar selección predeterminada de método de pago
  document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'))
  metodoPagoSeleccionado = null

  const tieneCotizacion = localStorage.getItem('pos_cotizacion')
  if (tieneCotizacion) {
    sessionStorage.removeItem('jesha_carrito')
    cargarCotizacionDesdeStorage()
  } else {
    const restaurado = restaurarCarritoDeSession()
    if (!restaurado) {
      actualizarCarrito()
    }
  }

  configurarEventosCotizar()
  console.log('✅ Punto de Venta listo')
})

// ══════════════════════════════════════════════════════════════════
//  TURNO
// ══════════════════════════════════════════════════════════════════

async function verificarTurno() {
  try {
    const response = await fetch(`${API_URL}/turnos-caja/activo`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (response.ok) {
      const data = await response.json()
      turnoActivo = data.data
      turnoStatus.innerHTML  = '✓ Turno abierto'
      turnoStatus.className  = 'turno-badge turno-ok'
      turnoStatus.style.cursor = 'default'
      btnCompletarVenta.disabled = carrito.length === 0
    } else {
      turnoActivo = null
      turnoStatus.innerHTML  = '⚠️ Sin turno — Abrir'
      turnoStatus.className  = 'turno-badge turno-error'
      turnoStatus.style.cursor = 'pointer'
      turnoStatus.onclick = () => { modalAbrirTurno.style.display = 'flex' }
      btnCompletarVenta.disabled = true
    }
  } catch (err) {
    console.error('❌ Error verificando turno:', err)
    turnoStatus.innerHTML = '❌ Error de conexión'
    turnoStatus.className = 'turno-badge turno-error'
    btnCompletarVenta.disabled = true
  }
}

async function abrirTurno() {
  const monto = parseFloat(montoInicialTurno.value) || 0
  if (monto < 0) {
    turnoError.textContent     = 'El monto no puede ser negativo'
    turnoError.style.display   = 'block'
    return
  }
  btnConfirmarAbrirTurno.disabled    = true
  btnConfirmarAbrirTurno.textContent = '⟳ Abriendo...'
  turnoError.style.display           = 'none'

  try {
    const response = await fetch(`${API_URL}/turnos-caja/abrir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ montoInicial: monto })
    })
    const data = await response.json()
    if (!response.ok) {
      turnoError.textContent   = data.error || 'Error abriendo turno'
      turnoError.style.display = 'block'
      return
    }
    turnoActivo = data.data
    purgarPausadasDeOtroTurno()
    actualizarBadgePausadas()
    modalAbrirTurno.style.display  = 'none'
      montoInicialTurno.value = '2000'
    turnoStatus.innerHTML          = '✓ Turno abierto'
    turnoStatus.className          = 'turno-badge turno-ok'
    turnoStatus.style.cursor       = 'default'
    turnoStatus.onclick            = null
    btnCompletarVenta.disabled     = carrito.length === 0
    console.log('✅ Turno abierto:', turnoActivo.id)
  } catch (err) {
    turnoError.textContent   = 'Error de conexión'
    turnoError.style.display = 'block'
    console.error('❌ Error abriendo turno:', err)
  } finally {
    btnConfirmarAbrirTurno.disabled    = false
    btnConfirmarAbrirTurno.textContent = 'Abrir Turno'
  }
}

// ══════════════════════════════════════════════════════════════════
//  CLIENTES — selector con lista + búsqueda
// ══════════════════════════════════════════════════════════════════

async function cargarClientes() {
  try {
    const response = await fetch(`${API_URL}/clientes?activo=true`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!response.ok) throw new Error('Error cargando clientes')
    clientesLista = await response.json()
    console.log(`✅ Clientes cargados: ${clientesLista.length}`)
  } catch (err) {
    console.error('❌ Error cargando clientes:', err)
    clientesLista = []
  }
}

function filtrarClientes(query) {
  const q = (query || '').toLowerCase().trim()
  if (!q) return clientesLista.slice(0, 50)
  return clientesLista.filter(c =>
    c.nombre?.toLowerCase().includes(q) ||
    c.apodo?.toLowerCase().includes(q)  ||
    c.rfc?.toLowerCase().includes(q)    ||
    c.telefono?.includes(q)
  ).slice(0, 50)
}

function renderItemsDropdown(clientes) {
  const list = document.getElementById('dropdown-clientes-pos')
    ?.querySelector('.dropdown-clientes-pos-list')
  if (!list) return

  list.innerHTML =
    `<div class="dropdown-cliente-item publico" data-cliente-id="0">
       <span>👤 Público general</span>
     </div>` +
    clientes.map(c => {
      const nombreSeguro = (c.apodo || c.nombre).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
      const nombreReal   = c.nombre.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
      const tel          = (c.telefono || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
      return `
      <div class="dropdown-cliente-item" data-cliente-id="${c.id}">
        <span>${c.apodo ? `${nombreSeguro} <span style="color:var(--muted);font-size:0.78rem">(${nombreReal})</span>` : nombreReal}</span>
        ${c.telefono ? `<span class="dropdown-cliente-tel">${tel}</span>` : ''}
      </div>`
    }).join('')

  // Event delegation para items del dropdown
  list.onclick = (e) => {
    const item = e.target.closest('[data-cliente-id]')
    if (!item) return
    const id = parseInt(item.dataset.clienteId, 10)
    if (id === 0) {
      seleccionarClientePOS(null, '')
    } else {
      const cliente = clientesLista.find(c => c.id === id)
      if (cliente) {
        seleccionarClientePOS(cliente.id, cliente.apodo || cliente.nombre, cliente.telefono || '')
      }
    }
  }
}

function abrirDropdownClientes() {
  const dd = document.getElementById('dropdown-clientes-pos')
  if (!dd) return

  if (dd.style.display !== 'none') {
    cerrarDropdownClientes()
    return
  }

  dd.innerHTML = `
    <div class="dropdown-clientes-pos-search">
      <input type="text" id="dd-search-cliente"
             placeholder="Buscar cliente..." autocomplete="off" />
    </div>
    <div class="dropdown-clientes-pos-list"></div>
  `
  dd.style.display = 'flex'
  document.getElementById('btn-lista-clientes')?.classList.add('active')

  renderItemsDropdown(filtrarClientes(''))

  const ddInput = document.getElementById('dd-search-cliente')
  ddInput?.addEventListener('input', e => renderItemsDropdown(filtrarClientes(e.target.value)))
  setTimeout(() => ddInput?.focus(), 40)
}

function cerrarDropdownClientes() {
  const dd = document.getElementById('dropdown-clientes-pos')
  if (dd) dd.style.display = 'none'
  document.getElementById('btn-lista-clientes')?.classList.remove('active')
}

window.seleccionarClientePOS = function(id, nombre, telefono) {
  if (id) {
    clienteSeleccionado = clientesLista.find(c => c.id === id) || { id, nombre }
    if (clienteNombre) clienteNombre.value = nombre
    const badge      = document.getElementById('cliente-seleccionado-badge')
    const badgeNombre = document.getElementById('cliente-badge-nombre')
    if (badge && badgeNombre) {
      badgeNombre.textContent = nombre + (telefono ? ` · ${telefono}` : '')
      badge.style.display = 'flex'
    }
  } else {
    clienteSeleccionado = null
    if (clienteNombre) clienteNombre.value = ''
    const badge = document.getElementById('cliente-seleccionado-badge')
    if (badge) badge.style.display = 'none'
  }
  cerrarDropdownClientes()
  if (id) {
    verificarCreditoCliente(id)
  } else {
    creditoCliente = null
    ocultarCreditoCliente()
    if (metodoPagoSeleccionado === 'CREDITO_CLIENTE') {
      metodoPagoSeleccionado = null
      document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'))
      actualizarCarrito()
    }
  }
}

function seleccionarCliente(id, nombre) {
  seleccionarClientePOS(id, nombre, '')
}

function limpiarCliente() {
  creditoCliente = null
  ocultarCreditoCliente()
  if (metodoPagoSeleccionado === 'CREDITO_CLIENTE') {
    metodoPagoSeleccionado = null
    document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'))
    actualizarCarrito()
  }
  clienteSeleccionado = null
  const badge = document.getElementById('cliente-seleccionado-badge')
  if (badge) badge.style.display = 'none'
}

function mostrarDropdownClientes() {}
function ocultarDropdownClientes() { cerrarDropdownClientes() }

// ══════════════════════════════════════════════════════════════════
//  CATÁLOGO
// ══════════════════════════════════════════════════════════════════

function mostrarEstadoInicial() {
  productosGrid.innerHTML = `
    <div class="sin-resultados" style="grid-column:1/-1; padding:60px 20px; text-align:center; color:var(--muted);">
      <div style="font-size:2.5rem; margin-bottom:12px;">🔍</div>
      <p style="font-size:1rem; margin:0;">Busca un producto por nombre o código</p>
      <p style="font-size:0.85rem; margin-top:6px; opacity:0.6;">o escanea el código de barras</p>
    </div>
  `
}

let searchTimeout

async function buscarProductos(query, skip = 0) {
  if (searchTimeout) clearTimeout(searchTimeout)
  const q = query.trim()

  if (q.length === 0) {
    resultadosBusqueda = []
    paginaActual = 1
    totalPaginas = 1
    terminoBusquedaActual = ''
    const btn = document.getElementById('btn-cargar-mas')
    if (btn) btn.style.display = 'none'
    if (productoCache.size > 0) {
      mostrarProductos(Array.from(productoCache.values()))
    } else {
      mostrarEstadoInicial()
    }
    return
  }

  if (q.length < 1) return

  const esNuevaBusqueda = skip === 0
  if (esNuevaBusqueda) {
    resultadosBusqueda = []
    paginaActual = 1
    terminoBusquedaActual = q
    totalPaginas = 1
  }

  const searchIndicator = document.getElementById('search-indicator')
  if (searchIndicator) searchIndicator.style.opacity = '1'

  searchTimeout = setTimeout(async () => {
    try {
      const response = await fetch(
        `${API_URL}/productos?q=${encodeURIComponent(q)}&take=30&skip=${skip}&contexto=pos`,
        { headers: { 'Authorization': `Bearer ${TOKEN}` } }
      )
      if (!response.ok) throw new Error('Error en búsqueda')
      const data      = await response.json()
      const resultados = data.data || []
      if (esNuevaBusqueda) {
        resultadosBusqueda = resultados
      } else {
        resultadosBusqueda = [...resultadosBusqueda, ...resultados]
      }
      if (data.paginacion) {
        totalPaginas = data.paginacion.totalPaginas || 1
        paginaActual = data.paginacion.pagina || 1
      }
      resultados.forEach(p => productoCache.set(p.id, p))
      mostrarProductosYMas(resultadosBusqueda)
      if (searchIndicator) searchIndicator.style.opacity = '0'
    } catch (err) {
      console.error('❌ Error buscando:', err)
      if (searchIndicator) searchIndicator.style.opacity = '0'
    }
  }, 300)
}

function escaparHtml(valor = '') {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function obtenerSrcImagenProducto(p) {
  const urlImagen = p.imagenUrl || p.Categoria?.imagenUrl || null
  return urlImagen
    ? (urlImagen.startsWith('http') ? urlImagen : API_URL + urlImagen)
    : null
}

function formatearStockProducto(p) {
  if (!(p.stock > 0)) return 'Agotado'
  const s = parseFloat(p.stock)
  const stock = Number.isInteger(s) ? s : s.toFixed(3).replace(/\.?0+$/, '')
  return `Stock: ${stock}${p.esGranel && p.unidadVenta ? ' ' + p.unidadVenta : ''}`
}

function renderBadgeGranel(p) {
  if (!p.esGranel) return ''
  return `<p style="margin:2px 0 0;"><span style="display:inline-block;padding:1px 6px;font-size:0.65rem;font-weight:700;background:rgba(107,157,232,0.15);color:#6b9de8;border-radius:4px;letter-spacing:0.03em;">GRANEL${p.unidadVenta ? ' · ' + escaparHtml(p.unidadVenta) : ''}</span></p>`
}

function renderTarjetaProducto(p) {
  const nombreSeguro = escaparHtml(p.nombre)
  const srcImagen = obtenerSrcImagenProducto(p)
  return `
    <div class="tarjeta-producto" data-producto-id="${p.id}" style="cursor:pointer;">
      ${srcImagen ? `<img src="${srcImagen}" alt="${nombreSeguro}" class="producto-imagen" />` : ''}
      <div class="producto-info">
        <h4>${nombreSeguro}</h4>
        <p class="producto-codigo">${escaparHtml(p.codigoInterno || '')}</p>
        ${renderBadgeGranel(p)}
        <p class="producto-precio">$${parseFloat(p.precioVenta || p.precioBase).toFixed(2)}${p.esGranel && p.unidadVenta ? `<span style="font-size:0.7rem;color:var(--muted,#999);font-weight:400;"> / ${escaparHtml(p.unidadVenta)}</span>` : ''}</p>
        <p class="producto-stock ${p.stock > 0 ? '' : 'agotado'}">${formatearStockProducto(p)}</p>
        <button type="button" class="btn-ajustar-stock" data-action="ajustar"
          style="display:block;width:100%;margin-top:8px;padding:8px 0;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:#e8edf5;font-family:'Barlow',sans-serif;font-size:0.82rem;font-weight:600;cursor:pointer;transition:background 0.15s,border-color 0.15s;">
          Ajustar
        </button>
      </div>
    </div>`
}

function renderProductoDestacado(p) {
  const nombreSeguro = escaparHtml(p.nombre)
  const srcImagen = obtenerSrcImagenProducto(p)
  const veces = parseInt(p.vecesEnTickets || 0, 10)
  return `
    <article class="producto-destacado" data-producto-id="${p.id}" style="cursor:pointer;">
      <div class="producto-destacado-media">
        ${srcImagen ? `<img src="${srcImagen}" alt="${nombreSeguro}" class="producto-destacado-imagen" />` : '<div class="producto-destacado-placeholder">J</div>'}
      </div>
      <div class="producto-destacado-info">
        <div class="producto-destacado-topline">
          <span class="producto-destacado-codigo">${escaparHtml(p.codigoInterno || '')}</span>
          ${veces > 0 ? `<span class="producto-destacado-badge">Frecuente en esta sucursal · ${veces}</span>` : ''}
        </div>
        <h3>${nombreSeguro}</h3>
        ${renderBadgeGranel(p)}
        <div class="producto-destacado-bottom">
          <div>
            <p class="producto-destacado-precio">$${parseFloat(p.precioVenta || p.precioBase).toFixed(2)}${p.esGranel && p.unidadVenta ? `<span> / ${escaparHtml(p.unidadVenta)}</span>` : ''}</p>
            <p class="producto-destacado-stock ${p.stock > 0 ? '' : 'agotado'}">${formatearStockProducto(p)}</p>
          </div>
          <button type="button" class="btn-ajustar-stock producto-destacado-accion" data-action="ajustar">Ajustar</button>
        </div>
      </div>
    </article>`
}

function mostrarProductos(productos) {
  if (productos.length === 0) {
    productosGrid.innerHTML = `<div class="sin-resultados">No se encontraron productos</div>`
    return
  }

  const hayBusquedaActiva = ((terminoBusquedaActual || searchProductos?.value || '').trim().length > 0)
  if (!hayBusquedaActiva) {
    productosGrid.innerHTML = productos.map(renderTarjetaProducto).join('')
    return
  }

  const principal = productos[0]
  const secundarios = productos.slice(1)
  productosGrid.innerHTML = `
    <div class="resultados-pos">
      <div class="resultado-principal-label">Resultado principal</div>
      ${renderProductoDestacado(principal)}
      ${secundarios.length > 0 ? `
        <div class="mas-resultados-label">Más resultados (${secundarios.length})</div>
        <div class="productos-secundarios-grid">
          ${secundarios.map(renderTarjetaProducto).join('')}
        </div>` : ''}
    </div>`
}

function mostrarProductosYMas(productos) {
  mostrarProductos(productos)

  if (paginaActual < totalPaginas) {
    let btn = document.getElementById('btn-cargar-mas')
    if (!btn) {
      productosGrid.insertAdjacentHTML('afterend', `
        <button id="btn-cargar-mas" class="btn-cargar-mas" onclick="cargarMasResultados()">
          <span class="btn-texto">Cargar más</span>
          <span class="spinner-btn" style="display:none;">⏳</span>
        </button>
      `)
      btn = document.getElementById('btn-cargar-mas')
    }
    btn.style.display = 'flex'
    const spinner = btn.querySelector('.spinner-btn')
    const texto = btn.querySelector('.btn-texto')
    if (spinner) spinner.style.display = 'none'
    if (texto) texto.textContent = `Cargar más (${(paginaActual * 30)} de ${resultadosBusqueda.length})`
  } else {
    const btn = document.getElementById('btn-cargar-mas')
    if (btn) btn.style.display = 'none'
  }
}

async function cargarMasResultados() {
  if (isLoadingMore) return
  if (paginaActual >= totalPaginas) return

  isLoadingMore = true
  const btn = document.getElementById('btn-cargar-mas')
  if (btn) {
    const spinner = btn.querySelector('.spinner-btn')
    const texto = btn.querySelector('.btn-texto')
    if (spinner) spinner.style.display = 'inline-block'
    if (texto) texto.textContent = 'Cargando...'
  }

  const nextSkip = paginaActual * 30
  await buscarProductos(terminoBusquedaActual, nextSkip)

  isLoadingMore = false
}

// ══════════════════════════════════════════════════════════════════
//  UTILIDADES NUMÉRICAS — espejo del redondeo del backend
//  crearVenta redondea el subtotal de CADA línea a 2 decimales y luego
//  suma. El frontend debe calcular idéntico para no provocar
//  TOTAL_MISMATCH con varias líneas granel de 3 decimales.
// ══════════════════════════════════════════════════════════════════

function _round2(v) { return parseFloat(parseFloat(v).toFixed(2)) }
function _round3(v) { return parseFloat(parseFloat(v).toFixed(3)) }

function subtotalLinea(item) {
  return _round2(parseFloat(item.precio) * parseFloat(item.cantidad))
}

// ── VENTA POR IMPORTE ──
// Dado un importe en pesos y el precio de catálogo, busca el par
// (cantidad a 3 decimales, precio de línea a 2 decimales) cuyo subtotal
// redondeado coincida EXACTAMENTE con el importe pedido, explorando
// cantidades vecinas (±0.001) y precios vecinos al ideal.
// El precio de línea nunca se desvía más de ±2% del catálogo
// (_TOLERANCIA_PRECIO_IMPORTE); si el importe es tan pequeño que el par
// exacto exigiría más desviación, se conserva el precio de catálogo y
// se devuelve exacto:false con el cobro real (ej. "$0.48" en vez de "$0.50").
const _TOLERANCIA_PRECIO_IMPORTE = 0.02

function calcularParExacto(importe, precioBase) {
  const precioCat = parseFloat(precioBase)
  if (!precioCat || precioCat <= 0) return null
  const imp = _round2(importe)
  if (imp <= 0) return null

  const base = _round3(imp / precioCat)
  if (base < 0.001) return null

  const candCant = [...new Set([base, _round3(base - 0.001), _round3(base + 0.001)])].filter(c => c >= 0.001)
  let mejor = null

  for (const cant of candCant) {
    const ideal = imp / cant
    const candPrecio = [...new Set([
      Math.floor(ideal * 100) / 100,
      _round2(ideal),
      Math.ceil(ideal * 100) / 100
    ])].filter(p => p > 0 && Math.abs(p - precioCat) / precioCat <= _TOLERANCIA_PRECIO_IMPORTE)

    for (const p of candPrecio) {
      const sub = _round2(cant * p)
      if (Math.round(sub * 100) === Math.round(imp * 100)) {
        const score = Math.abs(cant - base) * 1000 + Math.abs(p - precioCat)
        if (!mejor || score < mejor.score) mejor = { cantidad: cant, precio: _round2(p), subtotal: sub, exacto: true, score }
      }
    }
  }

  if (mejor) { const { score, ...par } = mejor; return par }

  // Sin par exacto dentro de tolerancia: intentar precio ajustado simple
  const precioAj = _round2(imp / base)
  if (Math.abs(precioAj - precioCat) / precioCat <= _TOLERANCIA_PRECIO_IMPORTE) {
    return { cantidad: base, precio: precioAj, subtotal: _round2(base * precioAj), exacto: false }
  }

  // Importe demasiado pequeño para ajustar precio con honestidad:
  // conservar precio de catálogo y cobrar lo que la cantidad vale realmente
  const subCat = _round2(base * precioCat)
  return { cantidad: base, precio: precioCat, subtotal: subCat, exacto: Math.round(subCat * 100) === Math.round(imp * 100) }
}

// ══════════════════════════════════════════════════════════════════
//  CARRITO
// ══════════════════════════════════════════════════════════════════

function agregarAlCarrito(productoId, nombre, precio, esGranel = false, unidadVenta = '') {
  const idParsed = parseInt(productoId, 10)
  const cached = productoCache.get(idParsed)
  const factor = cached?.factorConversion ? parseFloat(cached.factorConversion) : 1
  const unidadCompra = cached?.unidadCompra || ''

  // ✅ GRANEL o producto con FACTOR DE CONVERSIÓN > 1: abrir modal
  if (esGranel || factor > 1) {
    const existe = carrito.find(item => item.id === idParsed)
    abrirModalGranel(idParsed, nombre, parseFloat(precio), unidadVenta, existe?.cantidad || '', factor, unidadCompra)
    return
  }

  // Producto normal: sumar +1
  const existe = carrito.find(item => item.id === idParsed)

  if (existe) {
    existe.cantidad = existe.cantidad + 1
  } else {
    carrito.push({ id: idParsed, nombre, precio: parseFloat(precio), precioOriginal: parseFloat(precio), cantidad: 1, esGranel: false, unidadVenta: '', unidadCompra: '', factorConversion: 1, unidadElegida: 'base' })
  }

  if (!productoCache.get(idParsed)) {
    productoCache.set(idParsed, {
      id: idParsed, nombre,
      precioVenta: precio, precioBase: precio,
      stock: null, codigoInterno: '',
      esGranel: false, unidadVenta: '',
      unidadCompra: '', factorConversion: 1
    })
  }

  actualizarCarrito({ scrollAlFinal: true })
}

// ══════════════════════════════════════════════════════════════════
//  MODAL CANTIDAD — GRANEL + SELECTOR DE UNIDAD
// ══════════════════════════════════════════════════════════════════

let _granelPendiente = null // { id, nombre, precio, unidadVenta, factorConversion, unidadCompra }
let _unidadElegida = 'base' // 'base' o 'empaque'
let _modoCapturaGranel = 'CANTIDAD' // 'CANTIDAD' o 'IMPORTE' — modo activo del modal granel

function abrirModalGranel(id, nombre, precio, unidadVenta, cantidadActual, factorConversion = 1, unidadCompra = '') {
  _granelPendiente = { id, nombre, precio, unidadVenta, factorConversion: factorConversion || 1, unidadCompra: unidadCompra || '' }
  _unidadElegida = 'base'

  const modal     = document.getElementById('modal-cantidad-granel')
  const lblNombre = document.getElementById('granel-modal-producto-nombre')
  const lblUnidad = document.getElementById('granel-modal-unidad-label')
  const inputCant = document.getElementById('granel-modal-cantidad')
  const stockInfo = document.getElementById('granel-modal-stock-info')
  const errorDiv  = document.getElementById('granel-modal-error')
  const convDiv   = document.getElementById('granel-modal-conversion')

  if (lblNombre) lblNombre.textContent = nombre
  if (lblUnidad) lblUnidad.textContent = unidadVenta ? `(${unidadVenta})` : '(unidades)'
  if (inputCant) {
    inputCant.value = cantidadActual || ''
    inputCant.placeholder = unidadVenta ? `Ej: 2.500 ${unidadVenta}` : 'Ej: 2.500'
  }
  if (errorDiv) { errorDiv.style.display = 'none'; errorDiv.textContent = '' }
  if (convDiv) { convDiv.style.display = 'none'; convDiv.classList.remove('granel-preview-ajuste') }

  // ── Selector de unidad: mostrar solo si factor > 1 Y no es granel ──
  const cached = productoCache.get(id)
  const esGranel = cached?.esGranel || false
  const tieneEmpaque = factorConversion > 1 && !esGranel
  const unidadWrap = document.getElementById('granel-modal-unidad-wrap')

  if (unidadWrap) {
    if (tieneEmpaque) {
      unidadWrap.style.display = 'block'
      // Actualizar labels de los botones
      document.getElementById('granel-btn-base-label').textContent = (unidadVenta || 'PZA').toUpperCase()
      document.getElementById('granel-btn-empaque-label').textContent = (unidadCompra || 'CAJA').toUpperCase()
      document.getElementById('granel-btn-empaque-sub').textContent = `${factorConversion} ${unidadVenta || 'pza'} c/u`
      // Reset visual a "base"
      _setUnidadVisual('base')
    } else {
      unidadWrap.style.display = 'none'
    }
  }

  // ── Tabs de modo de captura (Cantidad / Importe $): solo productos a GRANEL ──
  const tabsWrap = document.getElementById('granel-modo-tabs-wrap')
  if (tabsWrap) tabsWrap.style.display = esGranel ? 'flex' : 'none'

  const enCarrito   = carrito.find(i => i.id === id)
  const modoInicial = (esGranel && enCarrito?.capturadoPorImporte) ? 'IMPORTE' : 'CANTIDAD'
  _setModoCaptura(modoInicial)
  if (modoInicial === 'IMPORTE') {
    const inputImp = document.getElementById('granel-modal-importe')
    if (inputImp) inputImp.value = enCarrito.importeCapturado ?? ''
    _actualizarPreviewImporte()
  }

  // Ajustar step según tipo de producto
  if (inputCant) {
    if (esGranel) {
      inputCant.min = '0.001'
      inputCant.step = '0.001'
    } else {
      inputCant.min = '1'
      inputCant.step = '1'
    }
  }

  // Mostrar stock disponible
  if (stockInfo && cached && cached.stock !== null && cached.stock !== undefined) {
    const s = parseFloat(cached.stock)
    const stockFmt = Number.isInteger(s) ? s : s.toFixed(3).replace(/\.?0+$/, '')
    let stockText = `Stock disponible: ${stockFmt}${unidadVenta ? ' ' + unidadVenta : ''}`
    // Si tiene empaque, mostrar también en cajas
    if (tieneEmpaque && factorConversion > 1) {
      const cajas = Math.floor(s / factorConversion)
      const sueltas = s % factorConversion
      let desglose = ''
      if (cajas > 0) desglose += `${cajas} ${unidadCompra}`
      if (sueltas > 0) desglose += `${desglose ? ' + ' : ''}${Number.isInteger(sueltas) ? sueltas : sueltas.toFixed(3).replace(/\.?0+$/, '')} ${unidadVenta}`
      stockText = `Stock: ${stockFmt} ${unidadVenta} (${desglose})`
    }
    stockInfo.textContent = stockText
  } else if (stockInfo) {
    stockInfo.textContent = ''
  }

  if (modal) modal.style.display = 'flex'
  setTimeout(() => {
    const foco = _modoCapturaGranel === 'IMPORTE'
      ? document.getElementById('granel-modal-importe')
      : inputCant
    if (foco) { foco.focus(); foco.select() }
  }, 100)
}

function _setUnidadVisual(modo) {
  _unidadElegida = modo
  const btnBase = document.getElementById('granel-modal-btn-base')
  const btnEmpaque = document.getElementById('granel-modal-btn-empaque')
  const lblUnidad = document.getElementById('granel-modal-unidad-label')
  const inputCant = document.getElementById('granel-modal-cantidad')

  if (modo === 'base') {
    if (btnBase) { btnBase.style.background = 'rgba(107,157,232,0.12)'; btnBase.style.borderColor = 'rgba(107,157,232,0.4)'; btnBase.style.color = '#6b9de8' }
    if (btnEmpaque) { btnEmpaque.style.background = 'rgba(255,255,255,0.04)'; btnEmpaque.style.borderColor = 'rgba(255,255,255,0.09)'; btnEmpaque.style.color = '#7a8599' }
    if (lblUnidad && _granelPendiente) lblUnidad.textContent = `(${_granelPendiente.unidadVenta || 'unidades'})`
    if (inputCant) { inputCant.min = '1'; inputCant.step = '1' }
  } else {
    if (btnEmpaque) { btnEmpaque.style.background = 'rgba(107,157,232,0.12)'; btnEmpaque.style.borderColor = 'rgba(107,157,232,0.4)'; btnEmpaque.style.color = '#6b9de8' }
    if (btnBase) { btnBase.style.background = 'rgba(255,255,255,0.04)'; btnBase.style.borderColor = 'rgba(255,255,255,0.09)'; btnBase.style.color = '#7a8599' }
    if (lblUnidad && _granelPendiente) lblUnidad.textContent = `(${_granelPendiente.unidadCompra || 'cajas'})`
    if (inputCant) { inputCant.min = '1'; inputCant.step = '1' }
  }

  // Limpiar y recalcular
  if (inputCant) inputCant.value = ''
  _actualizarConversionModal()
}

function _actualizarConversionModal() {
  const convDiv = document.getElementById('granel-modal-conversion')
  const inputCant = document.getElementById('granel-modal-cantidad')
  if (!convDiv || !_granelPendiente) return

  const cantidad = parseFloat(inputCant?.value) || 0
  const factor = _granelPendiente.factorConversion || 1

  if (_unidadElegida === 'empaque' && factor > 1 && cantidad > 0) {
    const cantidadBase = cantidad * factor
    const subtotal = cantidadBase * _granelPendiente.precio
    convDiv.innerHTML = `${cantidad} ${_granelPendiente.unidadCompra} = <strong>${cantidadBase} ${_granelPendiente.unidadVenta}</strong> en inventario — Subtotal: <strong>$${subtotal.toFixed(2)}</strong>`
    convDiv.style.display = 'block'
  } else if (cantidad > 0) {
    const subtotal = cantidad * _granelPendiente.precio
    convDiv.innerHTML = `Subtotal: <strong>$${subtotal.toFixed(2)}</strong>`
    convDiv.style.display = 'block'
  } else {
    convDiv.style.display = 'none'
  }
}

// ── Conmutador Cantidad / Importe $ (patrón replicado de cotizaciones.js setTipoModal) ──
function _setModoCaptura(modo) {
  _modoCapturaGranel = modo
  document.querySelectorAll('.granel-modo-tab').forEach(t => t.classList.toggle('active', t.dataset.modo === modo))

  const panelCant = document.getElementById('granel-panel-cantidad')
  const panelImp  = document.getElementById('granel-panel-importe')
  const inputCant = document.getElementById('granel-modal-cantidad')
  const inputImp  = document.getElementById('granel-modal-importe')
  const errorDiv  = document.getElementById('granel-modal-error')
  const convDiv   = document.getElementById('granel-modal-conversion')

  if (panelCant) panelCant.style.display = modo === 'CANTIDAD' ? 'block' : 'none'
  if (panelImp)  panelImp.style.display  = modo === 'IMPORTE'  ? 'block' : 'none'
  // Limpiar solo el input del modo que se abandona (permite prellenado del activo)
  if (inputCant && modo === 'IMPORTE')  inputCant.value = ''
  if (inputImp  && modo === 'CANTIDAD') inputImp.value = ''
  if (errorDiv) { errorDiv.style.display = 'none'; errorDiv.textContent = '' }
  if (convDiv)  { convDiv.style.display = 'none'; convDiv.classList.remove('granel-preview-ajuste') }

  const foco = modo === 'IMPORTE' ? inputImp : inputCant
  setTimeout(() => { if (foco) { foco.focus(); foco.select() } }, 60)
}

// Preview en vivo del modo importe: cantidad equivalente, precio de línea y cobro real
function _actualizarPreviewImporte() {
  const convDiv  = document.getElementById('granel-modal-conversion')
  const errorDiv = document.getElementById('granel-modal-error')
  const inputImp = document.getElementById('granel-modal-importe')
  if (!convDiv || !_granelPendiente || _modoCapturaGranel !== 'IMPORTE') return

  if (errorDiv) { errorDiv.style.display = 'none'; errorDiv.textContent = '' }
  convDiv.classList.remove('granel-preview-ajuste')

  const importe = parseFloat(inputImp?.value) || 0
  if (importe <= 0) { convDiv.style.display = 'none'; return }

  const { id, precio, unidadVenta } = _granelPendiente
  const par = calcularParExacto(importe, precio)

  if (!par) {
    const minImp = Math.max(0.01, _round2(precio * 0.001))
    convDiv.style.display = 'none'
    if (errorDiv) { errorDiv.textContent = `Importe mínimo para este producto: $${minImp.toFixed(2)}`; errorDiv.style.display = 'block' }
    return
  }

  const u = unidadVenta || 'u.'
  let html
  if (par.exacto) {
    html = `$${par.subtotal.toFixed(2)} = <strong>${par.cantidad.toFixed(3)} ${u}</strong> a $${par.precio.toFixed(2)}/${u}`
    if (Math.round(par.precio * 100) !== Math.round(precio * 100)) {
      html += ` <span style="opacity:0.7;">(normal $${precio.toFixed(2)})</span>`
    }
  } else {
    html = `Se cobrarán <strong>$${par.subtotal.toFixed(2)}</strong> = ${par.cantidad.toFixed(3)} ${u} a $${par.precio.toFixed(2)}/${u} — ajuste por redondeo`
    convDiv.classList.add('granel-preview-ajuste')
  }
  convDiv.innerHTML = html
  convDiv.style.display = 'block'

  // Aviso de stock en vivo
  const cached = productoCache.get(id)
  if (cached && cached.stock !== null && cached.stock !== undefined && par.cantidad > parseFloat(cached.stock)) {
    const stockDisp = parseFloat(cached.stock)
    const maxImp = Math.floor(stockDisp * precio * 100) / 100
    if (errorDiv) { errorDiv.textContent = `Excede el stock disponible (máximo $${maxImp.toFixed(2)})`; errorDiv.style.display = 'block' }
  }
}

// Confirmación del modo importe: valida, calcula el par exacto y agrega/reemplaza la línea
function _confirmarImporteGranel() {
  if (!_granelPendiente) return
  const inputImp = document.getElementById('granel-modal-importe')
  const errorDiv = document.getElementById('granel-modal-error')
  const importe  = parseFloat(inputImp?.value)

  if (isNaN(importe) || importe <= 0) {
    if (errorDiv) { errorDiv.textContent = 'Ingresa un importe válido mayor a $0.00'; errorDiv.style.display = 'block' }
    inputImp?.focus()
    return
  }

  const { id, nombre, precio, unidadVenta, factorConversion, unidadCompra } = _granelPendiente
  const par = calcularParExacto(importe, precio)

  if (!par) {
    const minImp = Math.max(0.01, _round2(precio * 0.001))
    if (errorDiv) { errorDiv.textContent = `Importe muy pequeño. Mínimo para este producto: $${minImp.toFixed(2)}`; errorDiv.style.display = 'block' }
    inputImp?.focus()
    return
  }

  // Validar stock con la cantidad calculada
  const cached = productoCache.get(id)
  if (cached && cached.stock !== null && cached.stock !== undefined) {
    const stockDisp = parseFloat(cached.stock)
    if (par.cantidad > stockDisp) {
      const stockFmt = Number.isInteger(stockDisp) ? stockDisp : stockDisp.toFixed(3).replace(/\.?0+$/, '')
      const maxImp = Math.floor(stockDisp * precio * 100) / 100
      if (errorDiv) {
        errorDiv.textContent = `Stock insuficiente. Disponible: ${stockFmt} ${unidadVenta || ''} (máximo $${maxImp.toFixed(2)})`
        errorDiv.style.display = 'block'
      }
      inputImp?.focus()
      return
    }
  }

  const linea = {
    id, nombre,
    precio: par.precio,
    precioOriginal: precio,
    cantidad: par.cantidad,
    cantidadVisible: par.cantidad,
    esGranel: true,
    unidadVenta: unidadVenta || '',
    unidadCompra: unidadCompra || '',
    factorConversion: factorConversion || 1,
    unidadElegida: 'base',
    capturadoPorImporte: true,
    importeCapturado: par.subtotal
  }

  const existe = carrito.find(item => item.id === id)
  if (existe) { Object.assign(existe, linea) } else { carrito.push(linea) }

  if (!productoCache.get(id)) {
    productoCache.set(id, { id, nombre, precioVenta: precio, precioBase: precio, stock: null, codigoInterno: '', esGranel: true, unidadVenta, unidadCompra, factorConversion: factorConversion || 1 })
  }

  cerrarModalGranel()
  actualizarCarrito({ scrollAlFinal: true })

  const detalle = `$${par.subtotal.toFixed(2)} = ${par.cantidad.toFixed(3)} ${unidadVenta || 'u.'}`
  if (par.exacto) {
    mostrarToast(`✓ ${nombre}: ${detalle} agregado`, 'success')
  } else {
    mostrarToast(`✓ ${nombre}: ${detalle} agregado (cobro ajustado por redondeo)`, 'warning')
  }
}

function cerrarModalGranel() {
  const modal = document.getElementById('modal-cantidad-granel')
  if (modal) modal.style.display = 'none'
  _granelPendiente = null
  _unidadElegida = 'base'
  _modoCapturaGranel = 'CANTIDAD'
}

function confirmarCantidadGranel() {
  if (!_granelPendiente) return
  if (_modoCapturaGranel === 'IMPORTE') { _confirmarImporteGranel(); return }
  const inputCant = document.getElementById('granel-modal-cantidad')
  const errorDiv  = document.getElementById('granel-modal-error')
  const cantidad  = parseFloat(inputCant?.value)

  if (isNaN(cantidad) || cantidad <= 0) {
    if (errorDiv) { errorDiv.textContent = 'Ingresa una cantidad válida mayor a 0'; errorDiv.style.display = 'block' }
    inputCant?.focus()
    return
  }

  const { id, nombre, precio, unidadVenta, factorConversion, unidadCompra } = _granelPendiente
  const esGranel = productoCache.get(id)?.esGranel || false
  const factor = factorConversion || 1

  // Calcular cantidad en unidad base
  let cantidadBase = cantidad
  if (_unidadElegida === 'empaque' && factor > 1) {
    cantidadBase = cantidad * factor
  }

  // Validar stock
  const cached = productoCache.get(id)
  if (cached && cached.stock !== null && cached.stock !== undefined) {
    if (cantidadBase > parseFloat(cached.stock)) {
      const stockDisp = parseFloat(cached.stock)
      let maxMsg = `Stock insuficiente. Disponible: ${Number.isInteger(stockDisp) ? stockDisp : stockDisp.toFixed(3)} ${unidadVenta}`
      if (_unidadElegida === 'empaque' && factor > 1) {
        const maxEmpaques = Math.floor(stockDisp / factor)
        maxMsg += ` (${maxEmpaques} ${unidadCompra} completos)`
      }
      if (errorDiv) { errorDiv.textContent = maxMsg; errorDiv.style.display = 'block' }
      inputCant?.focus()
      return
    }
  }

  // Buscar si ya existe en carrito (mismo producto Y misma unidad elegida)
  const existe = carrito.find(item => item.id === id)

  const cantFinal = esGranel ? parseFloat(cantidadBase.toFixed(3)) : Math.round(cantidadBase)

  if (existe) {
    existe.cantidad = cantFinal
    existe.unidadElegida = _unidadElegida
    existe.cantidadVisible = esGranel ? parseFloat(cantidad.toFixed(3)) : Math.round(cantidad)
  } else {
    carrito.push({
      id, nombre, precio, precioOriginal: precio,
      cantidad: cantFinal,
      cantidadVisible: esGranel ? parseFloat(cantidad.toFixed(3)) : Math.round(cantidad),
      esGranel,
      unidadVenta: unidadVenta || '',
      unidadCompra: unidadCompra || '',
      factorConversion: factor,
      unidadElegida: _unidadElegida
    })
  }

  if (!productoCache.get(id)) {
    productoCache.set(id, { id, nombre, precioVenta: precio, precioBase: precio, stock: null, codigoInterno: '', esGranel, unidadVenta, unidadCompra, factorConversion: factor })
  }

  cerrarModalGranel()
  actualizarCarrito({ scrollAlFinal: true })

  // Toast con info de lo agregado
  const unidadMsg = _unidadElegida === 'empaque'
    ? `${Math.round(cantidad)} ${unidadCompra} (${cantFinal} ${unidadVenta})`
    : `${esGranel ? cantidad.toFixed(3) : Math.round(cantidad)} ${unidadVenta || 'u.'}`
  mostrarToast(`✓ ${nombre}: ${unidadMsg} agregado`, 'success')
}

function eliminarDelCarrito(productoId) {
  carrito = carrito.filter(item => item.id !== productoId)
  actualizarCarrito()
}

function obtenerSkuCarrito(item) {
  const cached = productoCache.get(item.id) || {}
  return item.codigoInterno || item.codigoBarras || cached.codigoInterno || cached.codigoBarras || ''
}

function ajustarCantidadCarrito(productoId, delta) {
  const item = carrito.find(i => i.id === productoId)
  if (!item) return

  const base = parseFloat(item.cantidadVisible || item.cantidad || 0)
  const siguiente = base + delta
  actualizarCantidad(productoId, siguiente)
}

function actualizarCantidad(productoId, cantidad) {
  const item = carrito.find(i => i.id === productoId)
  if (item) {
    let cantParsed = parseFloat(cantidad)
    if (isNaN(cantParsed) || cantParsed <= 0) {
      eliminarDelCarrito(productoId)
    } else {
      // ✅ Bloquear decimales para productos NO granel
      if (!item.esGranel) cantParsed = Math.round(cantParsed)

      // ✅ Línea capturada por importe: al editar la cantidad manualmente el
      //    precio ajustado deja de ser válido → restaurar precio de catálogo
      if (item.capturadoPorImporte) {
        if (item.precioOriginal !== undefined) item.precio = item.precioOriginal
        item.capturadoPorImporte = false
        delete item.importeCapturado
      }

      // Si está en modo empaque, la cantidad visible cambia pero la base se recalcula
      if (item.unidadElegida === 'empaque' && item.factorConversion > 1) {
        item.cantidadVisible = cantParsed
        item.cantidad = parseFloat((cantParsed * item.factorConversion).toFixed(3))
      } else {
        item.cantidad = parseFloat(cantParsed.toFixed(3))
        item.cantidadVisible = item.cantidad
      }
      actualizarCarrito()
    }
  }
}

function actualizarCarrito(opciones = {}) {
  const { scrollAlFinal = false } = opciones || {}
  if (carrito.length === 0) {
    carritoTbody.innerHTML = `
      <tr class="carrito-empty">
        <td colspan="5" style="text-align:center;color:var(--muted);padding:40px;">
          Agrega productos para comenzar
        </td>
      </tr>`
  } else {
    carritoTbody.innerHTML = carrito.map(item => {
      const precioModificado = item.precioOriginal !== undefined && item.precio !== item.precioOriginal
      const esEmpaque = item.unidadElegida === 'empaque' && item.factorConversion > 1
      const cantidadVisible = item.cantidadVisible || item.cantidad
      const unidadLabel = esEmpaque ? (item.unidadCompra || 'caja') : (item.unidadVenta || '')
      const sku = obtenerSkuCarrito(item)
      return `
      <tr class="carrito-row">
        <td class="carrito-producto-nombre">
          <div class="cart-product-title">${escaparHtml(item.nombre)}</div>
          ${sku ? `<div class="cart-product-sku">SKU: ${escaparHtml(sku)}</div>` : ''}
        </td>
        <td style="text-align:center;">
          ${precioModificado ? `<span class="cart-price-before">$${item.precioOriginal.toFixed(2)}</span>` : ''}
          <input type="number" value="${item.precio}"
                 min="0" step="0.01"
                 class="cart-price-input ${precioModificado ? 'is-modified' : ''}"
                 onchange="actualizarPrecio(${item.id}, this.value)" />
        </td>
        <td style="text-align:center;">
          <div class="cart-qty-control">
            <button type="button" class="cart-qty-btn" onclick="ajustarCantidadCarrito(${item.id}, -1)" aria-label="Restar cantidad">−</button>
            <input type="number" value="${cantidadVisible}"
                   min="${item.esGranel ? 0.001 : 1}" step="1"
                   class="cart-qty-input"
                   onchange="actualizarCantidad(${item.id}, this.value)" />
            <button type="button" class="cart-qty-btn" onclick="ajustarCantidadCarrito(${item.id}, 1)" aria-label="Sumar cantidad">+</button>
          </div>
          ${unidadLabel ? `<span style="font-size:0.7rem;color:var(--muted);display:block;">${unidadLabel}</span>` : ""}
          ${esEmpaque ? `<span style="font-size:0.6rem;color:#6b9de8;display:block;">(${item.cantidad} ${item.unidadVenta})</span>` : ""}
          ${item.capturadoPorImporte ? `<span style="font-size:0.6rem;color:#e8a13c;display:block;">= $${(item.importeCapturado ?? subtotalLinea(item)).toFixed(2)} capturado</span>` : ""}
        </td>
        <td style="text-align:right;"><span class="cart-subtotal">$${subtotalLinea(item).toFixed(2)}</span></td>
        <td style="text-align:center;">
          <button class="btn-eliminar cart-delete-btn" onclick="eliminarDelCarrito(${item.id})" aria-label="Eliminar producto">🗑</button>
        </td>
      </tr>`
    }).join('')
  }

  itemsCount.textContent = `${carrito.length}`
  const total = carrito.reduce((sum, item) => sum + subtotalLinea(item), 0)
  resumenTotal.textContent = `$${total.toFixed(2)}`

  btnCompletarVenta.disabled = !(carrito.length > 0 && turnoActivo && metodoPagoSeleccionado)
  const btnCotizar = document.getElementById('btn-cotizar-carrito')
  if (btnCotizar) btnCotizar.disabled = carrito.length === 0
  const btnPausar = document.getElementById('btn-pausar-venta')
  if (btnPausar) btnPausar.disabled = carrito.length === 0

  // Persistir estado del carrito en sessionStorage
  guardarCarritoEnSession()

  if (scrollAlFinal && carrito.length > 0) {
    requestAnimationFrame(() => {
      const cont = document.querySelector('.carrito-items-container')
      if (cont) cont.scrollTop = cont.scrollHeight
    })
  }
}

async function limpiarCarrito() {
  if (carrito.length === 0) return
  const ok = await jeshaConfirm({
    title: 'Limpiar carrito',
    message: '¿Quitar todos los productos del carrito?',
    confirmText: 'Limpiar', type: 'warning'
  })
  if (!ok) return

  resetVentaActual()
}

// ══════════════════════════════════════════════════════════════════
//  RESET DE VENTA ACTIVA — limpieza compartida
//  Extraído de limpiarCarrito y del cierre post-venta para no duplicar.
//  Lo reutilizan también pausar/recuperar ventas en espera.
// ══════════════════════════════════════════════════════════════════

function resetVentaActual() {
  carrito                = []
  cotIdActual            = null
  clienteSeleccionado    = null
  _carritoRestaurado     = false
  vendedorSeleccionado   = null
  descuentoManual        = 0
  pinVendedorVerificado  = false
  creditoCliente         = null
  ocultarCreditoCliente()
  if (montoRecibido) montoRecibido.value = ''
  if (clienteNombre) clienteNombre.value = ''
  productoCache.clear()
  if (searchProductos) searchProductos.value = ''
  limpiarCarritoSession()

  const badge = document.getElementById('cliente-seleccionado-badge')
  if (badge) badge.style.display = 'none'

  metodoPagoSeleccionado = null
  document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'))
  if (montoEfectivoControl) montoEfectivoControl.style.display = 'none'

  cerrarDropdownClientes()
  mostrarEstadoInicial()
  actualizarCarrito()
}

// ══════════════════════════════════════════════════════════════════
//  VENTAS EN PAUSA
//  Persistencia en localStorage (sobrevive cierre de pestaña/navegador,
//  alcance: esta caja/PC). Cada pausada se sella con usuarioId y turnoId:
//  - Solo el usuario que la creó la ve en su lista.
//  - Al cerrar turno, las pausadas de ese turno se purgan en el
//    siguiente load del POS (purga diferida).
//  No reserva inventario: el backend revalida stock al completar.
// ══════════════════════════════════════════════════════════════════

const PAUSADAS_KEY = 'jesha_ventas_pausadas'

function _generarIdPausada() {
  if (window.crypto?.randomUUID) return crypto.randomUUID()
  // Fallback sin Math.random (contextos no seguros)
  const buf = new Uint32Array(4)
  crypto.getRandomValues(buf)
  return `p_${Date.now()}_${Array.from(buf, n => n.toString(16)).join('')}`
}

function _leerPausadas() {
  try {
    const raw = localStorage.getItem(PAUSADAS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    console.warn('⚠️ Error leyendo ventas pausadas:', e.message)
    return []
  }
}

function _escribirPausadas(arr) {
  try {
    localStorage.setItem(PAUSADAS_KEY, JSON.stringify(arr))
  } catch (e) {
    console.warn('⚠️ No se pudieron guardar las ventas pausadas:', e.message)
  }
}

// Purga diferida: elimina pausadas de turnos distintos al activo (cierre de turno)
function purgarPausadasDeOtroTurno() {
  if (!turnoActivo?.id) return
  const arr = _leerPausadas()
  const vivas = arr.filter(p => p.turnoId === turnoActivo.id)
  if (vivas.length !== arr.length) {
    _escribirPausadas(vivas)
    console.log(`🧹 ${arr.length - vivas.length} venta(s) pausada(s) de turnos anteriores eliminadas`)
  }
}

// Pausadas visibles para este usuario en el turno activo
function _misPausadas() {
  if (!turnoActivo?.id) return []
  return _leerPausadas().filter(p => p.usuarioId === USUARIO?.id && p.turnoId === turnoActivo.id)
}

function actualizarBadgePausadas() {
  const span = document.getElementById('pausadas-count')
  if (!span) return
  const n = _misPausadas().length
  span.textContent = n > 0 ? `(${n})` : ''
  span.style.display = n > 0 ? 'inline' : 'none'
}

function _nombreDefaultPausa() {
  const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  return `${clienteSeleccionado?.nombre || 'Venta'} — ${hora}`
}

function _snapshotVentaActual(nombre) {
  return {
    id:        _generarIdPausada(),
    nombre,
    usuarioId: USUARIO?.id ?? null,
    turnoId:   turnoActivo?.id ?? null,
    creadoEn:  Date.now(),
    carrito:   JSON.parse(JSON.stringify(carrito)),
    clienteSeleccionado: clienteSeleccionado ? JSON.parse(JSON.stringify(clienteSeleccionado)) : null,
    metodoPagoSeleccionado,
    cotizacionId:    cotIdActual || null,
    descuentoManual: descuentoManual || 0,
    vendedorSeleccionado: vendedorSeleccionado ? { ...vendedorSeleccionado } : null,
    total: carrito.reduce((s, i) => s + subtotalLinea(i), 0),
    items: carrito.length
  }
}

function pausarVentaActual(nombre, { silencioso = false } = {}) {
  if (carrito.length === 0) {
    if (!silencioso) mostrarToast('El carrito está vacío, no hay nada que pausar', 'warning')
    return false
  }
  if (!turnoActivo?.id) {
    mostrarToast('Necesitas un turno abierto para pausar ventas', 'error')
    return false
  }

  const pausadas = _leerPausadas()
  pausadas.push(_snapshotVentaActual(nombre))
  _escribirPausadas(pausadas)

  resetVentaActual()
  actualizarBadgePausadas()
  if (!silencioso) mostrarToast(`⏸️ Venta pausada: ${nombre}`, 'success')
  return true
}

// ── Modal: nombre de la pausa (opcional con default) ──
function abrirModalPausar() {
  if (carrito.length === 0) { mostrarToast('El carrito está vacío, no hay nada que pausar', 'warning'); return }
  if (!turnoActivo?.id) { mostrarToast('Necesitas un turno abierto para pausar ventas', 'error'); return }

  const input   = document.getElementById('pausar-nombre-input')
  const resumen = document.getElementById('pausar-resumen')
  if (input) { input.value = ''; input.placeholder = _nombreDefaultPausa() }
  if (resumen) {
    const total = carrito.reduce((s, i) => s + subtotalLinea(i), 0)
    resumen.textContent = `${carrito.length} producto(s) — $${total.toFixed(2)}`
  }
  const modal = document.getElementById('modal-pausar-venta')
  if (modal) modal.style.display = 'flex'
  setTimeout(() => { input?.focus() }, 100)
}

function cerrarModalPausar() {
  const modal = document.getElementById('modal-pausar-venta')
  if (modal) modal.style.display = 'none'
}

function confirmarPausarVenta() {
  const input  = document.getElementById('pausar-nombre-input')
  const nombre = (input?.value || '').trim() || _nombreDefaultPausa()
  cerrarModalPausar()
  pausarVentaActual(nombre)
}

// ── Modal: lista de ventas en espera ──
function abrirModalPausadas() {
  renderListaPausadas()
  const modal = document.getElementById('modal-pausadas')
  if (modal) modal.style.display = 'flex'
}

function cerrarModalPausadas() {
  const modal = document.getElementById('modal-pausadas')
  if (modal) modal.style.display = 'none'
}

function renderListaPausadas() {
  const cont = document.getElementById('lista-pausadas')
  if (!cont) return
  purgarPausadasDeOtroTurno()
  const pausadas = _misPausadas()

  if (pausadas.length === 0) {
    cont.innerHTML = `<div style="padding:28px 10px;text-align:center;color:#7a8599;font-size:0.85rem;">
      No tienes ventas en espera.<br>
      <span style="font-size:0.75rem;opacity:0.8;">Usa ⏸️ Pausar para guardar la venta actual y atender otra.</span>
    </div>`
    return
  }

  cont.innerHTML = pausadas.map(p => {
    const hora = new Date(p.creadoEn).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    const cli  = p.clienteSeleccionado?.nombre ? `· ${escaparHtml(p.clienteSeleccionado.nombre)}` : ''
    const cot  = p.cotizacionId ? ' · 📋 cotización' : ''
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);margin-bottom:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.9rem;font-weight:700;color:#e9edf4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escaparHtml(p.nombre)}</div>
        <div style="font-size:0.74rem;color:#7a8599;margin-top:2px;">${hora} · ${p.items} producto(s) · $${(p.total || 0).toFixed(2)} ${cli}${cot}</div>
      </div>
      <button type="button" data-accion="recuperar" data-id="${p.id}"
        style="padding:8px 14px;background:rgba(107,157,232,0.12);border:1px solid rgba(107,157,232,0.3);border-radius:8px;color:#6b9de8;font-family:'Barlow',sans-serif;font-size:0.8rem;font-weight:700;cursor:pointer;white-space:nowrap;">
        ▶ Recuperar
      </button>
      <button type="button" data-accion="eliminar" data-id="${p.id}" title="Eliminar"
        style="padding:8px 10px;background:transparent;border:1px solid rgba(255,107,107,0.25);border-radius:8px;color:#ff6b6b;font-size:0.8rem;cursor:pointer;">
        🗑
      </button>
    </div>`
  }).join('')
}

// Espejo del patrón de restauración de restaurarCarritoDeSession (sin tocarla)
function _aplicarEstadoVenta(p) {
  carrito = Array.isArray(p.carrito) ? p.carrito : []

  carrito.forEach(item => {
    if (!productoCache.has(item.id)) {
      productoCache.set(item.id, {
        id: item.id, nombre: item.nombre,
        precioVenta: item.precioOriginal || item.precio,
        precioBase: item.precioOriginal || item.precio,
        stock: null, codigoInterno: '',
        esGranel: item.esGranel || false,
        unidadVenta: item.unidadVenta || '',
        unidadCompra: item.unidadCompra || '',
        factorConversion: item.factorConversion || 1
      })
    }
  })

  cotIdActual           = p.cotizacionId || null
  descuentoManual       = p.descuentoManual || 0
  vendedorSeleccionado  = p.vendedorSeleccionado || null
  pinVendedorVerificado = false // el PIN del vendedor siempre se re-verifica al cobrar

  if (p.clienteSeleccionado?.id) {
    clienteSeleccionado = p.clienteSeleccionado
    if (clienteNombre) clienteNombre.value = clienteSeleccionado.nombre || ''
    const badge = document.getElementById('cliente-seleccionado-badge')
    const badgeNombre = document.getElementById('cliente-badge-nombre')
    if (badge && badgeNombre) {
      badgeNombre.textContent = clienteSeleccionado.nombre || ''
      badge.style.display = 'flex'
    }
    verificarCreditoCliente(clienteSeleccionado.id)
  }

  if (p.metodoPagoSeleccionado) {
    metodoPagoSeleccionado = p.metodoPagoSeleccionado
    document.querySelectorAll('.metodo-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.metodo === metodoPagoSeleccionado)
    })
  }

  actualizarCarrito() // re-persiste el estado activo en sessionStorage
}

function recuperarVentaPausada(id) {
  const p = _leerPausadas().find(x => x.id === id)
  if (!p) {
    mostrarToast('Esa venta pausada ya no existe', 'error')
    actualizarBadgePausadas()
    renderListaPausadas()
    return
  }

  // Si hay una venta en curso, pausarla automáticamente para no perderla
  if (carrito.length > 0) {
    pausarVentaActual(_nombreDefaultPausa(), { silencioso: true })
    mostrarToast('La venta en curso se pausó automáticamente', 'warning')
  }

  // Quitar del storage ANTES de restaurar (evita recuperación duplicada)
  _escribirPausadas(_leerPausadas().filter(x => x.id !== id))

  _aplicarEstadoVenta(p)
  cerrarModalPausadas()
  actualizarBadgePausadas()
  mostrarToast(`▶️ Venta recuperada: ${p.nombre}`, 'success')
}

async function eliminarVentaPausada(id) {
  const p = _leerPausadas().find(x => x.id === id)
  if (!p) { renderListaPausadas(); actualizarBadgePausadas(); return }

  const ok = await jeshaConfirm({
    title: 'Eliminar venta pausada',
    message: `¿Eliminar "${p.nombre}"? Esta acción no se puede deshacer.`,
    confirmText: 'Eliminar', type: 'warning'
  })
  if (!ok) return

  _escribirPausadas(_leerPausadas().filter(x => x.id !== id))
  actualizarBadgePausadas()
  renderListaPausadas()
  mostrarToast('Venta pausada eliminada', 'success')
}

// ══════════════════════════════════════════════════════════════════
//  NOTIFICACIONES TOAST — reemplaza alert() nativo
// ══════════════════════════════════════════════════════════════════

function mostrarToastDetalle(titulo, detalleHtml, duracion = 7000) {
  document.getElementById('pos-toast')?.remove()
  document.getElementById('pos-toast-detalle')?.remove()

  const toast = document.createElement('div')
  toast.id = 'pos-toast-detalle'
  Object.assign(toast.style, {
    position: 'fixed', top: '20px', right: '20px', zIndex: '9999',
    padding: '14px 18px',
    background: 'rgba(255,107,107,0.10)',
    border: '1px solid rgba(255,107,107,0.35)',
    borderRadius: '10px',
    color: '#ff6b6b',
    fontFamily: "'Barlow', sans-serif",
    fontSize: '0.875rem',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    maxWidth: '400px',
    lineHeight: '1.6',
    animation: 'toastIn 0.2s ease',
    transition: 'opacity 0.3s'
  })

  toast.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-weight:700;font-size:0.95rem;">✕ ${titulo}</span>
      <button onclick="this.closest('#pos-toast-detalle').remove()" style="background:none;border:none;color:#ff6b6b;font-size:1.1rem;cursor:pointer;opacity:0.7;padding:0 0 0 12px;line-height:1;">&times;</button>
    </div>
    <div style="font-size:0.82rem;color:#e9a0a0;border-top:1px solid rgba(255,107,107,0.2);padding-top:8px;">${detalleHtml}</div>
  `
  document.body.appendChild(toast)
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0'
      setTimeout(() => toast.remove(), 300)
    }
  }, duracion)
}

function mostrarToast(mensaje, tipo = 'error', duracion = 4000) {
  document.getElementById('pos-toast')?.remove()

  const colores = {
    error:   { bg: 'rgba(255,107,107,0.12)', border: 'rgba(255,107,107,0.35)', texto: '#ff6b6b', icono: '✕' },
    warning: { bg: 'rgba(232,113,10,0.12)',  border: 'rgba(232,113,10,0.35)',  texto: '#e8710a', icono: '⚠' },
    info:    { bg: 'rgba(74,144,226,0.12)',  border: 'rgba(74,144,226,0.35)',  texto: '#4a90e2', icono: 'ℹ' },
    success: { bg: 'rgba(96,208,128,0.12)',  border: 'rgba(96,208,128,0.35)',  texto: '#60d080', icono: '✓' }
  }
  const c = colores[tipo] || colores.error

  const toast = document.createElement('div')
  toast.id = 'pos-toast'
  Object.assign(toast.style, {
    position: 'fixed', top: '20px', right: '20px', zIndex: '9999',
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '13px 18px',
    background: c.bg,
    border: `1px solid ${c.border}`,
    borderRadius: '10px',
    color: c.texto,
    fontFamily: "'Barlow', sans-serif",
    fontSize: '0.9rem',
    fontWeight: '600',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    maxWidth: '380px',
    lineHeight: '1.4',
    animation: 'toastIn 0.2s ease',
    transition: 'opacity 0.3s'
  })

  if (!document.getElementById('pos-toast-style')) {
    const st = document.createElement('style')
    st.id = 'pos-toast-style'
    st.textContent = `@keyframes toastIn { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }`
    document.head.appendChild(st)
  }

  toast.innerHTML = `
    <span style="font-size:1rem;flex-shrink:0;">${c.icono}</span>
    <span>${mensaje}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:${c.texto};font-size:1.1rem;cursor:pointer;padding:0 0 0 6px;opacity:0.7;line-height:1;">&times;</button>
  `
  document.body.appendChild(toast)
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0'
      setTimeout(() => toast.remove(), 300)
    }
  }, duracion)
}

// ══════════════════════════════════════════════════════════════════
//  VENTA
// ══════════════════════════════════════════════════════════════════

async function completarVenta() {
  if (carrito.length === 0)    { mostrarToast('El carrito está vacío', 'warning'); return }
  if (!turnoActivo)            { mostrarToast('No hay turno abierto', 'warning'); return }
  if (!metodoPagoSeleccionado) {
    const metodos = document.querySelector('.metodos-pago')
    if (metodos) {
      metodos.style.outline = '2px solid #e8710a'
      metodos.style.borderRadius = '8px'
      setTimeout(() => { metodos.style.outline = ''; metodos.style.borderRadius = '' }, 1500)
    }
    mostrarToast('Selecciona el método de pago antes de continuar', 'warning')
    return
  }
  mostrarModalConfirmacion()
}

function mostrarModalConfirmacion() {
  const total = carrito.reduce((sum, item) => sum + subtotalLinea(item), 0)

  document.getElementById('confirmacion-total').textContent  = `$${total.toFixed(2)}`
  const metodoLabel = { EFECTIVO:'💵 Efectivo', CREDITO:'💳 T. Crédito', DEBITO:'💳 T. Débito', TRANSFERENCIA:'🔄 Transferencia', CREDITO_CLIENTE:'🏦 Crédito cliente', MIXTO:'🔀 Pago Mixto' }
  document.getElementById('confirmacion-metodo').textContent = metodoLabel[metodoPagoSeleccionado] || metodoPagoSeleccionado

  const rowCliente = document.getElementById('confirm-row-cliente')
  if (rowCliente) {
    if (clienteSeleccionado?.nombre) {
      document.getElementById('confirmacion-cliente').textContent = clienteSeleccionado.nombre
      rowCliente.style.display = 'flex'
    } else {
      rowCliente.style.display = 'none'
    }
  }

  const montoWrap = document.getElementById('confirm-monto-efectivo-wrap')
  const montoInput = document.getElementById('confirm-monto-recibido')
  if (montoWrap) {
    if (metodoPagoSeleccionado === 'EFECTIVO') {
      montoWrap.style.display = 'block'
      if (montoInput) montoInput.value = ''
      const cambioWrap = document.getElementById('confirm-cambio-wrap')
      if (cambioWrap) cambioWrap.style.display = 'none'
      if (montoInput) {
        montoInput.oninput = () => recalcularCambioModal()
        setTimeout(() => montoInput.focus(), 100)
      }
    } else {
      montoWrap.style.display = 'none'
    }
  }

  const tarjetaWrap = document.getElementById('confirm-tarjeta-wrap')
  const refInput    = document.getElementById('confirm-referencia-tarjeta')
  if (tarjetaWrap) {
    const esTarjeta = ['CREDITO', 'DEBITO'].includes(metodoPagoSeleccionado)
    tarjetaWrap.style.display = esTarjeta ? 'block' : 'none'
    if (refInput) {
      refInput.value = ''
      // Validación en tiempo real: solo dígitos, feedback visual
      refInput.oninput = () => {
        refInput.value = refInput.value.replace(/[^0-9]/g, '')
        const len = refInput.value.length
        const feedback = document.getElementById('ref-tarjeta-feedback')
        if (len === 0) {
          refInput.style.borderColor = 'var(--panel-border)'
          if (feedback) { feedback.textContent = 'Solo dígitos — 6 dígitos del voucher Move/2500'; feedback.style.color = 'var(--muted)' }
        } else if (len >= 4 && len <= 6) {
          refInput.style.borderColor = 'rgba(96,208,128,0.5)'
          if (feedback) { feedback.textContent = `✓ ${len} dígitos — válido`; feedback.style.color = '#60d080' }
        } else if (len < 4) {
          refInput.style.borderColor = 'rgba(232,113,10,0.5)'
          if (feedback) { feedback.textContent = `${len}/4 dígitos mínimo`; feedback.style.color = '#e8710a' }
        } else {
          refInput.style.borderColor = 'rgba(232,113,10,0.5)'
          if (feedback) { feedback.textContent = 'Máximo 6 dígitos'; feedback.style.color = '#e8710a' }
        }
      }
    }
    if (esTarjeta) setTimeout(() => refInput?.focus(), 150)
  }

  // ── Sección mixto ──
  const mixtoWrap = document.getElementById('confirm-mixto-wrap')
  if (mixtoWrap) {
    if (metodoPagoSeleccionado === 'MIXTO') {
      mixtoWrap.style.display = 'block'
      inicializarPagoMixto(total)
    } else {
      mixtoWrap.style.display = 'none'
    }
  }

  const selVendedor = document.getElementById('confirm-vendedor-select')
  if (selVendedor) {
    selVendedor.innerHTML = ''
    const optPropio = document.createElement('option')
    optPropio.value = USUARIO.id
    optPropio.textContent = `${USUARIO.nombre} (tú)`
    selVendedor.appendChild(optPropio)
    fetch(`${API_URL}/usuarios/vendedores`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
      .then(r => r.json())
      .then(data => {
        const lista = Array.isArray(data) ? data : (data.data || [])
        lista.filter(u => u.id !== USUARIO.id)
          .sort((a,b) => a.nombre.localeCompare(b.nombre))
          .forEach(u => {
            const opt = document.createElement('option')
            opt.value = u.id
            opt.textContent = u.nombre
            selVendedor.appendChild(opt)
          })
      }).catch(() => {})
    if (vendedorSeleccionado) selVendedor.value = vendedorSeleccionado.id
  }

  const inputDesc = document.getElementById('confirm-descuento-input')
  if (inputDesc) inputDesc.value = descuentoManual > 0 ? descuentoManual : ''

  // Ocultar bloque de descuento manual para EMPLEADO
  const puedeDescuento = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'].includes(USUARIO.rol)
  const wrapDesc = document.getElementById('confirm-descuento-wrap')
  if (wrapDesc) wrapDesc.style.display = puedeDescuento ? '' : 'none'
  if (!puedeDescuento && inputDesc) inputDesc.value = ''

  const wrapEmpleado = document.getElementById('confirm-venta-empleado-wrap')
  const selEmpReset  = document.getElementById('confirm-empleado-select')
  const badgeEmpReset = document.getElementById('confirm-empleado-badge')
  const puedeVerDescEmpleado = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'].includes(USUARIO.rol)
  const hayClienteSeleccionado = !!clienteSeleccionado?.id

  if (wrapEmpleado) wrapEmpleado.style.display = puedeVerDescEmpleado ? 'block' : 'none'
  if (selEmpReset) {
    selEmpReset.value = ''
    selEmpReset.disabled = hayClienteSeleccionado
  }
  if (badgeEmpReset) badgeEmpReset.style.display = 'none'
  if (hayClienteSeleccionado && badgeEmpReset) {
    badgeEmpReset.textContent = 'Descuento de empleado deshabilitado (cliente activo)'
    badgeEmpReset.style.display = 'block'
    badgeEmpReset.style.color = '#ff6b6b'
  }
  if (puedeVerDescEmpleado) cargarEmpleadosSelect()

  actualizarResumenConDescuento()
  modalConfirmacion.style.display = 'flex'
}

function getPctEfectivo() {
  const inputDesc = document.getElementById('confirm-descuento-input')
  const selEmp    = document.getElementById('confirm-empleado-select')
  const pctManual = parseFloat(inputDesc?.value) || 0
  const hayEmp    = selEmp?.value !== '' && selEmp?.value !== undefined && selEmp?.value !== null
  if (pctManual > 0) return { pct: Math.min(10, pctManual), esEmpleado: false }
  if (hayEmp)        return { pct: 3, esEmpleado: true }
  return { pct: 0, esEmpleado: false }
}

function actualizarResumenConDescuento() {
  const totalBruto = carrito.reduce((s, i) => s + subtotalLinea(i), 0)
  const { pct, esEmpleado } = getPctEfectivo()
  const descAmt    = parseFloat((totalBruto * (pct / 100)).toFixed(2))
  const totalFinal = parseFloat((totalBruto - descAmt).toFixed(2))

  const elTotal = document.getElementById('confirmacion-total')
  if (elTotal) elTotal.textContent = `$${totalFinal.toFixed(2)}`

  const elDesc = document.getElementById('confirm-row-descuento')
  if (elDesc) {
    if (pct > 0) {
      const etiqueta = esEmpleado
        ? `-$${descAmt.toFixed(2)} (3% empleado)`
        : `-$${descAmt.toFixed(2)} (${pct}%)`
      document.getElementById('confirmacion-descuento').textContent = etiqueta
      elDesc.style.display = 'flex'
    } else {
      elDesc.style.display = 'none'
    }
  }

  if (metodoPagoSeleccionado === 'EFECTIVO') recalcularCambioModal()
}

function recalcularCambioModal() {
  const totalBruto = carrito.reduce((s, i) => s + subtotalLinea(i), 0)
  const { pct }    = getPctEfectivo()
  const descAmt    = parseFloat((totalBruto * (pct / 100)).toFixed(2))
  const totalFinal = parseFloat((totalBruto - descAmt).toFixed(2))

  const montoInput = document.getElementById('confirm-monto-recibido')
  const cambioWrap = document.getElementById('confirm-cambio-wrap')
  const cambioEl   = document.getElementById('confirmacion-cambio')
  const exactoWrap = document.getElementById('confirm-pago-exacto-wrap')

  const monto  = parseFloat(montoInput?.value) || 0
  const cambio = parseFloat((monto - totalFinal).toFixed(2))

  if (!cambioWrap || !cambioEl) return

  // Pago exacto: monto >= totalFinal y diferencia despreciable
  const esPagoExacto = monto > 0 && Math.abs(cambio) < 0.005 && totalFinal > 0

  if (esPagoExacto) {
    cambioWrap.style.display = 'none'
    if (exactoWrap) exactoWrap.style.display = 'flex'
  } else if (monto > 0 && cambio > 0) {
    cambioEl.textContent     = `$${cambio.toFixed(2)}`
    cambioWrap.style.display = 'block'
    if (exactoWrap) exactoWrap.style.display = 'none'
  } else {
    cambioWrap.style.display = 'none'
    if (exactoWrap) exactoWrap.style.display = 'none'
  }
}

// ════════════════════════════════════════════════════════════════════
//  PIN DE CAJERO
// ════════════════════════════════════════════════════════════════════
let pinVendedorVerificado = false

function pedirPinVendedor(vendedorId, selectEl) {
  pinVendedorVerificado = false

  let wrapPin = document.getElementById('confirm-pin-wrap')
  if (!wrapPin) {
    wrapPin = document.createElement('div')
    wrapPin.id = 'confirm-pin-wrap'
    wrapPin.style.cssText = 'margin:10px 0;'
    selectEl.parentElement.after(wrapPin)
  }

  wrapPin.innerHTML = `
    <label style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:6px;">
      PIN del vendedor seleccionado
    </label>
    <div style="display:flex;gap:8px;">
      <input type="password" id="confirm-pin-input" maxlength="4" placeholder="••••"
        style="width:120px;padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--panel-border);border-radius:8px;color:var(--text);font-family:'Barlow',sans-serif;font-size:1.1rem;letter-spacing:0.3em;text-align:center;outline:none;"
        oninput="this.value=this.value.replace(/[^0-9]/g,'')" />
      <button type="button" id="confirm-pin-btn"
        style="padding:8px 14px;background:rgba(31,58,102,0.6);border:1px solid rgba(107,157,232,0.3);border-radius:8px;color:#6b9de8;font-family:'Barlow',sans-serif;font-size:0.875rem;font-weight:600;cursor:pointer;">
        Verificar
      </button>
    </div>
    <div id="confirm-pin-msg" style="font-size:0.78rem;margin-top:4px;min-height:16px;"></div>
  `
  wrapPin.style.display = 'block'

  document.getElementById('confirm-pin-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') verificarPinVendedor(vendedorId)
  })
  document.getElementById('confirm-pin-btn')?.addEventListener('click', () => verificarPinVendedor(vendedorId))
  setTimeout(() => document.getElementById('confirm-pin-input')?.focus(), 100)
}

function ocultarPinVendedor() {
  pinVendedorVerificado = true
  const wrap = document.getElementById('confirm-pin-wrap')
  if (wrap) wrap.style.display = 'none'
}

async function verificarPinVendedor(vendedorId) {
  const pin    = document.getElementById('confirm-pin-input')?.value.trim()
  const msgEl  = document.getElementById('confirm-pin-msg')
  const btn    = document.getElementById('confirm-pin-btn')

  if (!pin || pin.length !== 4) {
    if (msgEl) { msgEl.textContent = 'Ingresa los 4 dígitos del PIN'; msgEl.style.color = '#ff6b6b' }
    return
  }

  if (btn) { btn.disabled = true; btn.textContent = '⟳ Verificando...' }

  try {
    const res  = await fetch(`${API_URL}/usuarios/${vendedorId}/verificar-pin`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify({ pin })
    })
    const data = await res.json()

    if (res.ok && data.success) {
      pinVendedorVerificado = true
      if (msgEl) { msgEl.textContent = `✓ Verificado — ${data.usuario.nombre}`; msgEl.style.color = '#60d080' }
      document.getElementById('confirm-pin-input').style.borderColor = 'rgba(96,208,128,0.4)'
      if (btn) { btn.style.display = 'none' }
    } else {
      pinVendedorVerificado = false
      if (msgEl) { msgEl.textContent = data.error || 'PIN incorrecto'; msgEl.style.color = '#ff6b6b' }
      document.getElementById('confirm-pin-input').value = ''
      document.getElementById('confirm-pin-input').focus()
      if (btn) { btn.disabled = false; btn.textContent = 'Verificar' }
    }
  } catch (e) {
    if (msgEl) { msgEl.textContent = 'Error de conexión'; msgEl.style.color = '#ff6b6b' }
    if (btn) { btn.disabled = false; btn.textContent = 'Verificar' }
  }
}

// ══════════════════════════════════════════════════════════════════
//  MODAL VENTA EXITOSA
// ══════════════════════════════════════════════════════════════════

function mostrarModalExito(ventaData, totalFinal) {
  const overlay = document.getElementById('modal-venta-exitosa')
  if (!overlay) return

  document.getElementById('exito-folio').textContent  = `Folio: ${ventaData.folio}`
  document.getElementById('exito-total').textContent  = `$${parseFloat(ventaData.total).toFixed(2)}`

  const metodoLabel = {
    EFECTIVO:        '💵 Efectivo',
    CREDITO:         '💳 T. Crédito',
    DEBITO:          '💳 T. Débito',
    TRANSFERENCIA:   '🔄 Transferencia',
    CREDITO_CLIENTE: '🏦 Crédito cliente',
    MIXTO:           '🔀 Pago Mixto'
  }
  document.getElementById('exito-metodo').textContent =
    metodoLabel[ventaData.metodoPago] || metodoLabel[metodoPagoSeleccionado] || ventaData.metodoPago || '—'

  // ── Bloques de cambio destacado / pago exacto ──
  const cambioDestacado = document.getElementById('exito-cambio-destacado')
  const cambioEl        = document.getElementById('exito-cambio')
  const pagoExactoEl    = document.getElementById('exito-pago-exacto')

  // Reset
  if (cambioDestacado) cambioDestacado.style.display = 'none'
  if (pagoExactoEl)    pagoExactoEl.style.display    = 'none'

  let cambioFinal = 0
  let aplicaLogica = false

  if (metodoPagoSeleccionado === 'EFECTIVO') {
    const montoRec = parseFloat(document.getElementById('confirm-monto-recibido')?.value) || 0
    if (montoRec > 0) {
      cambioFinal = parseFloat((montoRec - totalFinal).toFixed(2))
      aplicaLogica = true
    }
  } else if (metodoPagoSeleccionado === 'MIXTO') {
    cambioFinal = parseFloat(ventaData.cambio || 0)
    aplicaLogica = cambioFinal > 0 || (ventaData.desglosePagos?.some(p => p.metodo === 'EFECTIVO'))
  }

  if (aplicaLogica) {
    if (Math.abs(cambioFinal) < 0.005) {
      // Pago exacto
      if (pagoExactoEl) pagoExactoEl.style.display = 'flex'
    } else if (cambioFinal > 0) {
      // Cambio destacado
      if (cambioEl)         cambioEl.textContent         = `$${cambioFinal.toFixed(2)}`
      if (cambioDestacado)  cambioDestacado.style.display = 'block'
    }
    // cambio < 0 (no debería pasar) → no muestra nada
  }

  overlay.style.display = 'flex'

// Botón imprimir ticket — abre ventana con HTML del ticket
  const btnImprimir = document.getElementById('btn-imprimir-ticket-exito')
  if (btnImprimir) {
    btnImprimir.onclick = () => {
      const ventaId = ventaData.id
      if (!ventaId) { mostrarToast('ID de venta no disponible', 'warning'); return }
      const url = `${API_URL}/ventas/${ventaId}/ticket`
      const win = window.open('', '_blank', 'width=380,height=700,scrollbars=yes')
      if (!win) { mostrarToast('Permite las ventanas emergentes para imprimir el ticket', 'warning'); return }
      win.document.write('<html><body style="font-family:sans-serif;text-align:center;padding:20px;background:#fff"><p>Cargando ticket...</p></body></html>')
      fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
        .then(r => { if (!r.ok) throw new Error('Error al cargar ticket'); return r.text() })
        .then(html => { win.document.open(); win.document.write(html); win.document.close() })
        .catch(err => { win.document.write(`<p style="color:red">Error: ${err.message}</p>`) })
    }
  }

  document.getElementById('btn-cerrar-exito').onclick = () => {
    overlay.style.display = 'none'
  }
}

async function confirmarVenta() {
  if (ventaEnProceso) return
  ventaEnProceso = true
  try {
    const selVendCheck = document.getElementById('confirm-vendedor-select')
    if (selVendCheck && parseInt(selVendCheck.value) !== USUARIO.id && !pinVendedorVerificado) {
      ventaEnProceso = false
      const msgPin = document.getElementById('confirm-pin-msg')
      if (msgPin) { msgPin.textContent = 'Debes verificar el PIN del vendedor primero'; msgPin.style.color = '#ff6b6b' }
      document.getElementById('confirm-pin-input')?.focus()
      return
    }

    const esTarjetaPago = ['CREDITO', 'DEBITO'].includes(metodoPagoSeleccionado)
    const refTarjeta    = document.getElementById('confirm-referencia-tarjeta')?.value.trim() || ''
    if (esTarjetaPago && refTarjeta) {
      if (!/^\d+$/.test(refTarjeta) || refTarjeta.length < 4 || refTarjeta.length > 6) {
        ventaEnProceso = false
        mostrarToast('El N° de Autorización debe ser de 4 a 6 dígitos numéricos', 'warning')
        document.getElementById('confirm-referencia-tarjeta')?.focus()
        return
      }
    }

    // Validar pago mixto
    if (metodoPagoSeleccionado === 'MIXTO') {
      // Refrescar estado del DOM antes de leerlo (recalcula netos y cambio)
      recalcularMixto()
      const pagos = obtenerDesgloseMixto()

      if (pagos.length < 2) {
        ventaEnProceso = false
        mostrarToast('Pago mixto requiere al menos 2 métodos de pago', 'warning')
        return
      }

      const totalBruto = carrito.reduce((s, i) => s + subtotalLinea(i), 0)
      const { pct } = getPctEfectivo()
      const descAmt = parseFloat((totalBruto * (pct / 100)).toFixed(2))
      const totalConDesc = parseFloat((totalBruto - descAmt).toFixed(2))

      // Guard: los pagos no-efectivo no pueden exceder el total
      const sumNoEf = parseFloat(
        pagos.filter(p => p.metodo !== 'EFECTIVO').reduce((s, p) => s + parseFloat(p.monto), 0).toFixed(2)
      )
      if (sumNoEf > totalConDesc + 0.005) {
        ventaEnProceso = false
        mostrarToast('Los pagos con tarjeta/transferencia exceden el total. Ajusta los montos.', 'warning')
        return
      }

      // Guard: el efectivo entregado no puede ser menor al neto requerido
      const pagoEf = pagos.find(p => p.metodo === 'EFECTIVO')
      if (pagoEf && pagoEf.recibido !== undefined && pagoEf.recibido < pagoEf.monto - 0.005) {
        ventaEnProceso = false
        mostrarToast(`Efectivo insuficiente: recibido $${pagoEf.recibido.toFixed(2)} < requerido $${pagoEf.monto.toFixed(2)}`, 'warning')
        return
      }

      // Red de seguridad: la suma de netos debe igualar el total
      const sumaPagos = parseFloat(pagos.reduce((s, p) => s + parseFloat(p.monto), 0).toFixed(2))
      if (Math.abs(sumaPagos - totalConDesc) > 0.005) {
        ventaEnProceso = false
        const dif = parseFloat((sumaPagos - totalConDesc).toFixed(2))
        const msg = dif < 0
          ? `Faltan $${Math.abs(dif).toFixed(2)} para cubrir el total`
          : `El pago mixto excede el total por $${dif.toFixed(2)}. Debe sumar exactamente $${totalConDesc.toFixed(2)}`
        mostrarToast(msg, 'warning')
        return
      }
    }

    if (metodoPagoSeleccionado === 'EFECTIVO') {
      const montoInput = document.getElementById('confirm-monto-recibido')
      const totalBrutoEf = carrito.reduce((sum, item) => sum + subtotalLinea(item), 0)
      const { pct: pctEf } = getPctEfectivo()
      const descAmtEf = parseFloat((totalBrutoEf * (pctEf / 100)).toFixed(2))
      const totalVenta = parseFloat((totalBrutoEf - descAmtEf).toFixed(2))
      const montoVal   = parseFloat(montoInput?.value) || 0
      if (!montoVal || montoVal <= 0) {
        ventaEnProceso = false
        mostrarToast('Ingresa el monto recibido en efectivo', 'warning')
        montoInput?.focus()
        return
      }
      if (montoVal < totalVenta - 0.01) {
        ventaEnProceso = false
        mostrarToast(`El monto recibido ($${montoVal.toFixed(2)}) es menor al total ($${totalVenta.toFixed(2)})`, 'warning')
        montoInput?.focus()
        return
      }
    }

    const total    = carrito.reduce((sum, item) => sum + subtotalLinea(item), 0)
    const detalles = carrito.map(item => ({
      productoId:     parseInt(item.id),
      cantidad:       parseFloat(item.cantidad),
      precioUnitario: parseFloat(item.precio),
      subtotal:       parseFloat((parseFloat(item.precio) * parseFloat(item.cantidad)).toFixed(2))
    }))

    const selVend            = document.getElementById('confirm-vendedor-select')
    const vendId             = selVend ? parseInt(selVend.value) : USUARIO.id
    const { pct, esEmpleado } = getPctEfectivo()
    const selEmpVenta        = document.getElementById('confirm-empleado-select')
    const empleadoId         = esEmpleado && selEmpVenta?.value ? parseInt(selEmpVenta.value) : null
    const descAmt            = parseFloat((total * (pct / 100)).toFixed(2))
    const totalFinal         = parseFloat((total - descAmt).toFixed(2))

    vendedorSeleccionado = selVend ? { id: vendId, nombre: selVend.options[selVend.selectedIndex]?.text } : null
    descuentoManual      = pct

    const esCredito = metodoPagoSeleccionado === 'CREDITO_CLIENTE'
    if (esCredito) {
      if (!clienteSeleccionado?.id) {
        ventaEnProceso = false
        mostrarToast('Debes seleccionar un cliente registrado para venta a crédito', 'warning')
        return
      }
      if (!creditoCliente || creditoCliente.disponible < totalFinal) {
        ventaEnProceso = false
        const disp = creditoCliente?.disponible?.toFixed(2) || '0.00'
        mostrarToast(`Crédito insuficiente. Disponible: $${disp} — Total: $${totalFinal.toFixed(2)}`, 'error')
        return
      }
    }

    // FIX: Obtener sucursalId de forma segura
    const sucursalIdSeguro = turnoActivo?.sucursalId || turnoActivo?.sucursal?.id || USUARIO?.sucursalId || USUARIO?.sucursal;
    
    // Log para depuración en la consola
    console.log(`🛒 Confirmando venta | sucursalId: ${sucursalIdSeguro} | turnoId: ${turnoActivo?.id}`);

    if (!sucursalIdSeguro) {
      ventaEnProceso = false;
      mostrarToast('Error: No se pudo identificar la sucursal del turno.', 'error');
      return;
    }

    const montoInputVal = parseFloat(document.getElementById('confirm-monto-recibido')?.value) || 0

    // Calcular montoPagado según método
    let montoPagadoPayload = totalFinal
    let desglosePagosPayload = null
    if (metodoPagoSeleccionado === 'EFECTIVO') {
      montoPagadoPayload = montoInputVal
    } else if (metodoPagoSeleccionado === 'MIXTO') {
      desglosePagosPayload = obtenerDesgloseMixto()
      montoPagadoPayload = desglosePagosPayload.reduce((s, p) => s + parseFloat(p.monto), 0)
    }

    const payload = {
      sucursalId:  parseInt(sucursalIdSeguro, 10),
      usuarioId:   vendId,
      turnoId:     turnoActivo.id,
      clienteId:   clienteSeleccionado?.id || null,
      empleadoId:  empleadoId,              
      metodoPago:  esCredito ? 'CREDITO_CLIENTE' : metodoPagoSeleccionado,
      subtotal:    parseFloat(total.toFixed(2)),
      descuento:   descAmt,
      total:       totalFinal,
      montoPagado: montoPagadoPayload,
      esCredito,
      desglosePagos: desglosePagosPayload,
      cotizacionId: cotIdActual || null,
      notas: esTarjetaPago ? `Ref. Ingenico: ${refTarjeta}` : null,
      detalles
    }

    btnConfirmarVenta.disabled  = true
    btnConfirmarVenta.innerHTML = '⟳ Procesando...'

    const response = await fetch(`${API_URL}/ventas`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json()
      const err = new Error(errorData.error || 'Error procesando venta')
      err.sinStock = errorData.sinStock || null
      err.codigo   = errorData.codigo   || null
      throw err
    }

    const venta = await response.json()
    console.log('✅ Venta completada:', venta.data.folio)

    modalConfirmacion.style.display = 'none'
    mostrarModalExito(venta.data, totalFinal)

    resetVentaActual()

    // ── FIX: Resetear estado para permitir la siguiente venta ──
    ventaEnProceso              = false
    btnConfirmarVenta.disabled  = false
    btnConfirmarVenta.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Confirmar venta`

  } catch (err) {
    console.error('❌ Error:', err)

    if (err.sinStock && err.sinStock.length > 0) {
      const lineas = err.sinStock.map(p =>
        `• ${p.nombre}: necesitas ${p.solicitados}, hay ${p.disponibles}`
      ).join('<br>')
      mostrarToastDetalle('Stock insuficiente', lineas)
    } else {
      mostrarToast(err.message, 'error')
    }

    ventaEnProceso              = false
    btnConfirmarVenta.disabled  = false
    btnConfirmarVenta.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Confirmar venta`
  }
}

// ══════════════════════════════════════════════════════════════════
//  COTIZACIÓN DESDE POS
// ══════════════════════════════════════════════════════════════════

function abrirModalCotizar() {
  if (carrito.length === 0) { mostrarToast('El carrito está vacío', 'warning'); return }
  const venceInput = document.getElementById('cotizar-vence')
  const notasInput = document.getElementById('cotizar-notas')
  const errorDiv   = document.getElementById('cotizar-error')
  if (venceInput)  venceInput.value = ''
  if (notasInput)  notasInput.value = ''
  if (errorDiv)    { errorDiv.style.display = 'none'; errorDiv.textContent = '' }
  document.getElementById('modal-cotizar').classList.add('open')
}

function cerrarModalCotizar() {
  document.getElementById('modal-cotizar').classList.remove('open')
}

async function confirmarCotizar() {
  const venceEn  = document.getElementById('cotizar-vence')?.value || null
  const notas    = document.getElementById('cotizar-notas')?.value.trim() || null
  const errorDiv = document.getElementById('cotizar-error')
  if (errorDiv) { errorDiv.style.display = 'none'; errorDiv.textContent = '' }

  const btnGuardar = document.getElementById('btn-confirmar-cotizar')
  btnGuardar.disabled = true
  btnGuardar.innerHTML = '⟳ Guardando...'

  try {
    const detalles = carrito.map(item => ({
      productoId:     parseInt(item.id),
      cantidad:       parseFloat(item.cantidad),
      precioUnitario: parseFloat(item.precio)
    }))
    const payload = { clienteId: clienteSeleccionado?.id || null, detalles, notas, venceEn: venceEn || null }

    const response = await fetch(`${API_URL}/cotizaciones`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Error guardando cotización')

    cerrarModalCotizar()
    const folio = data.data?.folio || 'COT-...'
    const aviso = document.createElement('div')
    aviso.innerHTML = `✓ Cotización <strong>${folio}</strong> guardada — <a href="cotizaciones.html" style="color:#90c8ff;text-decoration:underline;">Ver cotizaciones</a>`
    Object.assign(aviso.style, {
      position:'fixed', top:'20px', right:'20px', zIndex:'9999',
      background:'#1f3a66', color:'#fff', padding:'14px 20px',
      borderRadius:'8px', fontSize:'0.875rem', fontWeight:'600',
      boxShadow:'0 4px 16px rgba(0,0,0,0.4)', transition:'opacity 0.4s',
      maxWidth:'340px', lineHeight:'1.5'
    })
    document.body.appendChild(aviso)
    setTimeout(() => { aviso.style.opacity = '0'; setTimeout(() => aviso.remove(), 400) }, 5000)
    console.log('✅ Cotización creada:', folio)

  } catch (err) {
    console.error('❌ Error creando cotización:', err)
    if (errorDiv) { errorDiv.textContent = err.message; errorDiv.style.display = 'block' }
    else mostrarToast(err.message, 'error')
  } finally {
    btnGuardar.disabled = false
    btnGuardar.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> Guardar Cotización`
  }
}

function configurarEventosCotizar() {
  document.getElementById('btn-cotizar-carrito')?.addEventListener('click', abrirModalCotizar)
  document.getElementById('modal-cotizar-close')?.addEventListener('click', cerrarModalCotizar)
  document.getElementById('btn-cancel-cotizar')?.addEventListener('click', cerrarModalCotizar)
  document.getElementById('btn-confirmar-cotizar')?.addEventListener('click', confirmarCotizar)
}

// ══════════════════════════════════════════════════════════════════
//  CARGAR COTIZACIÓN / PEDIDO DESDE STORAGE
// ══════════════════════════════════════════════════════════════════

function cargarCotizacionDesdeStorage() {
  const raw = localStorage.getItem('pos_cotizacion')
  if (!raw) return

  try {
    const payload = JSON.parse(raw)
    localStorage.removeItem('pos_cotizacion')

    if (!['cotizacion','pedido'].includes(payload.fuente) ||
        !Array.isArray(payload.items) || payload.items.length === 0) return

    if (payload.fuente === 'cotizacion' && payload.cotId) {
      cotIdActual = payload.cotId
    }

    payload.items.forEach(item => {
      carrito.push({ id: item.id, nombre: item.nombre, precio: parseFloat(item.precio), cantidad: parseFloat(item.cantidad) || 1, esGranel: item.esGranel || false, unidadVenta: item.unidadVenta || '', unidadCompra: item.unidadCompra || '', factorConversion: item.factorConversion || 1, unidadElegida: 'base', cantidadVisible: parseFloat(item.cantidad) || 1 })
      productoCache.set(item.id, { id: item.id, nombre: item.nombre, precioVenta: item.precio, precioBase: item.precio, stock: null, esGranel: item.esGranel || false, unidadVenta: item.unidadVenta || '', unidadCompra: item.unidadCompra || '', factorConversion: item.factorConversion || 1 })
    })

    if (payload.clienteId && payload.clienteNombre) {
      clienteSeleccionado = { id: payload.clienteId, nombre: payload.clienteNombre }
      if (clienteNombre) clienteNombre.value = payload.clienteNombre
      const badge      = document.getElementById('cliente-seleccionado-badge')
      const badgeNombre = document.getElementById('cliente-badge-nombre')
      if (badge && badgeNombre) {
        badgeNombre.textContent = payload.clienteNombre
        badge.style.display     = 'flex'
      }
    }

    actualizarCarrito()

    const folio = payload.cotFolio || payload.pedFolio || ''
    const aviso = document.createElement('div')
    aviso.textContent = `✓ ${payload.fuente === 'pedido' ? 'Pedido' : 'Cotización'} ${folio} cargad${payload.fuente === 'pedido' ? 'o' : 'a'} — ${payload.items.length} producto(s)`
    Object.assign(aviso.style, {
      position:'fixed', top:'20px', right:'20px', zIndex:'9999',
      background:'#1f3a66', color:'#fff', padding:'12px 20px',
      borderRadius:'8px', fontSize:'0.875rem', fontWeight:'600',
      boxShadow:'0 4px 16px rgba(0,0,0,0.4)', transition:'opacity 0.4s'
    })
    document.body.appendChild(aviso)
    setTimeout(() => { aviso.style.opacity = '0'; setTimeout(() => aviso.remove(), 400) }, 3500)

  } catch (e) {
    console.warn('⚠️ Error leyendo pos_cotizacion:', e.message)
    localStorage.removeItem('pos_cotizacion')
  }
}

// ══════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  CRÉDITO A CLIENTES REGISTRADOS
// ════════════════════════════════════════════════════════════════════
async function verificarCreditoCliente(clienteId) {
  try {
    const data = await fetch(`${API_URL}/clientes/${clienteId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    }).then(r => r.json())

    const cliente = data.data || data
    const btnCredito  = document.getElementById('btn-metodo-credito-cliente')
    const infoCredito = document.getElementById('credito-cliente-info')
    const textoCredit = document.getElementById('credito-cliente-texto')

    if (cliente.tipo === 'REGISTRADO' && parseFloat(cliente.limiteCredito) > 0) {
      const limite     = parseFloat(cliente.limiteCredito)
      const saldo      = parseFloat(cliente.saldoPendiente)
      const disponible = parseFloat((limite - saldo).toFixed(2))

      creditoCliente = { limite, saldo, disponible }

      if (btnCredito) btnCredito.style.display = 'inline-flex'
      if (infoCredito && textoCredit) {
        textoCredit.textContent = `Crédito: $${disponible.toFixed(2)} disponible de $${limite.toFixed(2)}`
        infoCredito.style.display = 'block'
        infoCredito.style.borderColor = disponible > 0
          ? 'rgba(29,158,117,0.2)' : 'rgba(232,113,10,0.2)'
        infoCredito.style.background  = disponible > 0
          ? 'rgba(29,158,117,0.08)' : 'rgba(232,113,10,0.08)'
        textoCredit.style.color = disponible > 0 ? '#1D9E75' : '#e8710a'
      }
    } else {
      ocultarCreditoCliente()
    }
  } catch(e) {
    ocultarCreditoCliente()
  }
}

function ocultarCreditoCliente() {
  const btn  = document.getElementById('btn-metodo-credito-cliente')
  const info = document.getElementById('credito-cliente-info')
  if (btn)  btn.style.display  = 'none'
  if (info) info.style.display = 'none'
}

// ════════════════════════════════════════════════════════════════════
//  DESCUENTO EMPLEADO — carga lista de empleados activos
// ════════════════════════════════════════════════════════════════════

async function cargarEmpleadosSelect() {
  const sel = document.getElementById('confirm-empleado-select')
  if (!sel) return
  sel.innerHTML = '<option value="">— Sin descuento de empleado —</option>'
  try {
    const res  = await fetch(`${API_URL}/usuarios?rol=EMPLEADO&activo=true`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    const data = await res.json()
    const lista = Array.isArray(data) ? data : (data.data || [])
    lista
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .forEach(u => {
        const opt = document.createElement('option')
        opt.value       = u.id
        opt.textContent = u.nombre
        sel.appendChild(opt)
      })
  } catch (e) {
    console.error('❌ Error cargando empleados:', e)
  }
}

function configurarEventListeners() {

  // ── EVENT DELEGATION: click en tarjetas de producto ──
  // Un solo listener para TODAS las tarjetas (presentes y futuras).
  // Los datos se leen del productoCache, NUNCA del HTML.
  // Esto elimina problemas con comillas, acentos, XSS, etc.
  productosGrid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-producto-id]')
    if (!card) return
    const id = parseInt(card.dataset.productoId, 10)
    const producto = productoCache.get(id)
    if (!producto) {
      console.warn('⚠ Producto no encontrado en caché:', id)
      return
    }
    agregarAlCarrito(
      producto.id,
      producto.nombre,
      producto.precioVenta || producto.precioBase,
      producto.esGranel || false,
      producto.unidadVenta || ''
    )
  })

  let _scanLastKey    = 0
  let _scanFastKeys   = 0
  let _scanAutoTimer  = null
  const SCAN_MS       = 55
  const SCAN_AUTO_MS  = 120
  const SCAN_MIN_KEYS = 3

  async function buscarYAgregarProducto(q) {
    const codigo = q.trim()
    if (!codigo) return

    if (searchTimeout) clearTimeout(searchTimeout)

    try {
      const r    = await fetch(`${API_URL}/productos?q=${encodeURIComponent(codigo)}&take=5&contexto=pos`,
                               { headers: { 'Authorization': `Bearer ${TOKEN}` } })
      const data = await r.json()
      const res  = data.data || []

      if (res.length === 1) {
        const idParsed = parseInt(res[0].id, 10)
        productoCache.set(idParsed, res[0])

        const esBusquedaCodigo = !codigo.includes(' ') && codigo.length <= 20
        if (esBusquedaCodigo) {
          agregarAlCarrito(res[0].id, res[0].nombre, res[0].precioVenta || res[0].precioBase, res[0].esGranel || false, res[0].unidadVenta || '')
          mostrarToast(`✓ ${res[0].nombre} agregado`, 'success')
          searchProductos.value = ''
          _scanFastKeys = 0
          buscarProductos('')
        } else {
          mostrarProductos(res)
        }
      } else if (res.length > 1) {
        res.forEach(p => productoCache.set(p.id, p))
        mostrarProductos(res)
        mostrarToast('Varios resultados — selecciona uno', 'info')
      } else {
        mostrarToast(`Código “${codigo}” no encontrado`, 'warning')
      }
    } catch (err) {
      console.error('❌ Error escáner:', err)
      mostrarToast('Error buscando producto', 'error')
    }
  }

  searchProductos.addEventListener('keydown', async e => {
    const ahora = Date.now()
    const esTeclaTexto = e.key.length === 1

    if (esTeclaTexto) {
      const esRapido = _scanLastKey && (ahora - _scanLastKey) < SCAN_MS
      _scanFastKeys = esRapido ? _scanFastKeys + 1 : 1
      _scanLastKey = ahora
    }

    if (e.key !== 'Enter') return
    e.preventDefault()
    const vieneDeScanner = _scanFastKeys >= SCAN_MIN_KEYS && _scanLastKey && (ahora - _scanLastKey) < SCAN_AUTO_MS
    if (vieneDeScanner) return

    if (_scanAutoTimer) clearTimeout(_scanAutoTimer)
    const q = searchProductos.value.trim()
    if (!q) return
    await buscarYAgregarProducto(q)
  })

  searchProductos.addEventListener('input', e => {
    if (_scanFastKeys >= SCAN_MIN_KEYS) {
      if (_scanAutoTimer) clearTimeout(_scanAutoTimer)
      _scanAutoTimer = setTimeout(() => {
        const q = searchProductos.value.trim()
        if (q) buscarYAgregarProducto(q)
      }, SCAN_AUTO_MS)
      return
    }

    buscarProductos(e.target.value)
  })

  metodosPayButtons.forEach(btn => {
    btn.addEventListener('click', e => {
      metodosPayButtons.forEach(b => b.classList.remove('active'))
      e.target.closest('.metodo-btn').classList.add('active')
      metodoPagoSeleccionado = e.target.closest('.metodo-btn').dataset.metodo
      montoEfectivoControl.style.display = metodoPagoSeleccionado === 'EFECTIVO' ? 'block' : 'none'
      actualizarCarrito()
    })
  })

  montoRecibido.addEventListener('input', actualizarCarrito)

  btnCompletarVenta.addEventListener('click', completarVenta)
  btnLimpiarCarrito.addEventListener('click', limpiarCarrito)
  btnConfirmarVenta.addEventListener('click', confirmarVenta)
  btnCancelVenta.addEventListener('click', () => { modalConfirmacion.style.display = 'none' })
  btnModalConfirmacionClose.addEventListener('click', () => { modalConfirmacion.style.display = 'none' })

  document.getElementById('confirm-empleado-select')?.addEventListener('change', function() {
    const badge = document.getElementById('confirm-empleado-badge')
    if (badge) badge.style.display = this.value !== '' ? 'block' : 'none'
    actualizarResumenConDescuento()
    if (metodoPagoSeleccionado === 'MIXTO') recalcularMixto()
  })

  document.getElementById('confirm-descuento-input')?.addEventListener('input', function() {
    const aviso = document.getElementById('descuento-limite-aviso')
    const val = parseFloat(this.value) || 0
    if (val > 10) {
      this.value = 10
      this.style.borderColor = 'rgba(232,113,10,0.5)'
      if (aviso) aviso.style.display = 'block'
      setTimeout(() => {
        this.style.borderColor = ''
        if (aviso) aviso.style.display = 'none'
      }, 2500)
    } else if (val < 0) {
      this.value = 0
    }
    actualizarResumenConDescuento()
    if (metodoPagoSeleccionado === 'MIXTO') recalcularMixto()
  })

  document.getElementById('confirm-vendedor-select')?.addEventListener('change', function() {
    const vendId = parseInt(this.value)
    if (vendId !== USUARIO.id) {
      pedirPinVendedor(vendId, this)
    } else {
      ocultarPinVendedor()
    }
  })

  btnConfirmarAbrirTurno.addEventListener('click', abrirTurno)
  btnCancelTurno?.addEventListener('click', () => { modalAbrirTurno.style.display = 'none' })
  btnModalTurnoClose?.addEventListener('click', () => { modalAbrirTurno.style.display = 'none' })

  btnCancelCliente?.addEventListener('click', () => { modalClienteRapido.style.display = 'none' })
  btnModalClienteClose?.addEventListener('click', () => { modalClienteRapido.style.display = 'none' })

  document.getElementById('btn-lista-clientes')
    ?.addEventListener('click', abrirDropdownClientes)

  clienteNombre?.addEventListener('input', e => {
    const dd = document.getElementById('dropdown-clientes-pos')
    if (dd && dd.style.display !== 'none') {
      renderItemsDropdown(filtrarClientes(e.target.value))
    }
  })

  clienteNombre?.addEventListener('focus', () => {
    abrirDropdownClientes()
  })

  document.addEventListener('click', e => {
    if (!e.target.closest('.cliente-input-wrap') &&
        !e.target.closest('#dropdown-clientes-pos')) {
      cerrarDropdownClientes()
    }
  })

  document.getElementById('btn-limpiar-cliente')
    ?.addEventListener('click', () => {
      seleccionarClientePOS(null, '')
    })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      cerrarDropdownClientes()
      cerrarModalGranel()
      modalConfirmacion.style.display     = 'none'
      modalClienteRapido.style.display    = 'none'
      modalAbrirTurno.style.display       = 'none'
      document.getElementById('modal-cotizar')?.classList.remove('open')
      const exitoOverlay = document.getElementById('modal-venta-exitosa')
      if (exitoOverlay) exitoOverlay.style.display = 'none'
    }
  })

  // ✅ Eventos del modal de cantidad granel + selector de unidad
  document.getElementById('granel-modal-close')?.addEventListener('click', cerrarModalGranel)
  document.getElementById('granel-modal-cancel')?.addEventListener('click', cerrarModalGranel)
  document.getElementById('granel-modal-confirm')?.addEventListener('click', confirmarCantidadGranel)
  document.getElementById('granel-modal-cantidad')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirmarCantidadGranel() }
  })
  document.getElementById('granel-modal-cantidad')?.addEventListener('input', _actualizarConversionModal)
  document.getElementById('modal-cantidad-granel')?.addEventListener('click', e => {
    if (e.target.id === 'modal-cantidad-granel') cerrarModalGranel()
  })

  // Botones selector de unidad
  document.getElementById('granel-modal-btn-base')?.addEventListener('click', () => _setUnidadVisual('base'))
  document.getElementById('granel-modal-btn-empaque')?.addEventListener('click', () => _setUnidadVisual('empaque'))

  // ✅ Tabs de modo de captura granel (Cantidad / Importe $) + input de importe
  document.querySelectorAll('.granel-modo-tab').forEach(tab => {
    tab.addEventListener('click', () => _setModoCaptura(tab.dataset.modo))
  })
  document.getElementById('granel-modal-importe')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirmarCantidadGranel() }
  })
  document.getElementById('granel-modal-importe')?.addEventListener('input', _actualizarPreviewImporte)

  // ✅ Ventas en pausa
  document.getElementById('btn-pausar-venta')?.addEventListener('click', abrirModalPausar)
  document.getElementById('btn-ver-pausadas')?.addEventListener('click', abrirModalPausadas)
  document.getElementById('pausar-modal-close')?.addEventListener('click', cerrarModalPausar)
  document.getElementById('pausar-modal-cancel')?.addEventListener('click', cerrarModalPausar)
  document.getElementById('pausar-modal-confirm')?.addEventListener('click', confirmarPausarVenta)
  document.getElementById('pausar-nombre-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirmarPausarVenta() }
  })
  document.getElementById('modal-pausar-venta')?.addEventListener('click', e => {
    if (e.target.id === 'modal-pausar-venta') cerrarModalPausar()
  })
  document.getElementById('pausadas-modal-close')?.addEventListener('click', cerrarModalPausadas)
  document.getElementById('modal-pausadas')?.addEventListener('click', e => {
    if (e.target.id === 'modal-pausadas') cerrarModalPausadas()
  })
  document.getElementById('lista-pausadas')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-accion]')
    if (!btn) return
    if (btn.dataset.accion === 'recuperar') recuperarVentaPausada(btn.dataset.id)
    if (btn.dataset.accion === 'eliminar') eliminarVentaPausada(btn.dataset.id)
  })

  // ✅ Artículo rápido
  btnArticuloRapido?.addEventListener('click', abrirModalArticuloRapido)
  arClose?.addEventListener('click', cerrarModalArticuloRapido)
  arCancel?.addEventListener('click', cerrarModalArticuloRapido)
  arForm?.addEventListener('submit', enviarArticuloRapido)
  arNombre?.addEventListener('input', _arActualizarPreview)
  arPrecio?.addEventListener('input', _arActualizarPreview)
  arCantidad?.addEventListener('input', _arActualizarPreview)
  arStock?.addEventListener('input', function() {
    if (!_arAvanzadasAbierto && arCantidad) {
      arCantidad.value = arStock.value
    }
    _arActualizarPreview()
  })
  modalArticuloRapido?.addEventListener('click', function(e) {
    if (e.target === modalArticuloRapido) cerrarModalArticuloRapido()
  })

  console.log('✅ Event listeners configurados')
}

// ══════════════════════════════════════════════════════════════════
//  ARTÍCULO RÁPIDO — alta de producto + inventario desde POS
//  Backend: POST /productos/articulo-rapido
//  Cualquier usuario autenticado puede crear. La venta posterior pasa
//  por /ventas con su propia transacción (no toca MovimientoCaja aquí).
// ══════════════════════════════════════════════════════════════════

async function cargarCategoriasParaArticuloRapido(forceReload = false) {
  if (!forceReload && _arCategoriasCache && _arCategoriasCache.length) {
    return _arCategoriasCache
  }
  if (!forceReload) {
    try {
      const raw = localStorage.getItem(AR_CAT_KEY)
      if (raw) {
        const cached = JSON.parse(raw)
        if (Array.isArray(cached) && cached.length) {
          _arCategoriasCache = cached
          return cached
        }
      }
    } catch (_) { /* ignorar */ }
  }
  const res = await fetch(`${API_URL}/productos/categorias`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  })
  if (!res.ok) throw new Error('No se pudieron cargar las categorías')
  const data = await res.json()
  const lista = Array.isArray(data) ? data : (data.data || [])
  _arCategoriasCache = lista
  try { localStorage.setItem(AR_CAT_KEY, JSON.stringify(lista)) } catch (_) {}
  return lista
}

function renderCategoriasEnArticuloRapido(categorias) {
  if (!arCategoria) return
  if (!categorias || categorias.length === 0) {
    arCategoria.innerHTML = '<option value="">Sin categorías — crea una primero</option>'
    return
  }
  const opts = ['<option value="">Seleccionar…</option>']
  categorias.forEach(c => {
    const depto = c.Departamento?.nombre || ''
    const label = depto ? `${c.nombre} — ${depto}` : c.nombre
    opts.push(`<option value="${c.id}">${escaparHtml(label)}</option>`)
  })
  arCategoria.innerHTML = opts.join('')
}

function resolverSucursalParaArticuloRapido() {
  return (
    turnoActivo?.sucursalId ||
    turnoActivo?.sucursal?.id ||
    USUARIO?.sucursalId ||
    USUARIO?.sucursal ||
    null
  )
}

function _arActualizarPreview() {
  if (!arPreview || !arPreviewText) return
  const nombre  = (arNombre?.value || '').trim()
  const precio  = parseFloat(arPrecio?.value)
  const cant    = parseFloat(arCantidad?.value)

  if (!nombre && (!precio || isNaN(precio) || precio <= 0)) {
    arPreviewText.textContent = 'Completa los campos para ver el detalle'
    arPreview.classList.add('muted')
    return
  }
  arPreview.classList.remove('muted')

  const nombreCorto = nombre.length > 32 ? nombre.slice(0, 29) + '\u2026' : nombre
  const qtyFmt = Number.isInteger(cant) && isFinite(cant) ? cant.toString() : (isFinite(cant) ? cant.toFixed(3).replace(/\.?0+$/, '') : '?')
  const precioFmt = isFinite(precio) && precio > 0 ? '$' + precio.toFixed(2) : '?'
  const subtotal = isFinite(precio) && isFinite(cant) && precio > 0 && cant > 0 ? '$' + (precio * cant).toFixed(2) : ''

  if (nombre && subtotal) {
    arPreviewText.innerHTML = 'Se agregar\u00e1 al carrito: <strong>' + escaparHtml(qtyFmt) + ' \u00d7 ' + escaparHtml(nombreCorto) + '</strong> = <strong>' + subtotal + '</strong>'
    return
  }
  if (nombre) {
    arPreviewText.innerHTML = '<strong>' + escaparHtml(nombreCorto) + '</strong> \u2014 ingres\u00e1 precio y cantidad'
    return
  }
}

window.toggleArAvanzadas = function() {
  _arAvanzadasAbierto = !_arAvanzadasAbierto
  if (arAvanzadas) arAvanzadas.classList.toggle('abierto', _arAvanzadasAbierto)
  if (arBtnAvanzadas) arBtnAvanzadas.classList.toggle('abierto', _arAvanzadasAbierto)
  var icon = document.getElementById('ar-toggle-icon')
  if (icon) icon.innerHTML = _arAvanzadasAbierto ? '\u25bc' : '\u25b6'
  if (arBtnAvanzadas) {
    var children = arBtnAvanzadas.childNodes
    if (children.length) {
      children[children.length - 1].textContent = _arAvanzadasAbierto ? ' Menos opciones' : ' M\u00e1s opciones'
    }
  }
  // Si se cierra el panel, sincronizar stock = cantidad
  if (!_arAvanzadasAbierto && arStock && arCantidad) {
    arStock.value = arCantidad.value
  }
}

async function abrirModalArticuloRapido() {
  if (!modalArticuloRapido) return
  if (!turnoActivo?.id) {
    mostrarToast('Necesitas un turno abierto para crear artículos', 'warning')
    return
  }

  // Cerrar panel avanzadas
  _arAvanzadasAbierto = false
  if (arAvanzadas) arAvanzadas.classList.remove('abierto')
  if (arBtnAvanzadas) arBtnAvanzadas.classList.remove('abierto')
  var icon = document.getElementById('ar-toggle-icon')
  if (icon) icon.innerHTML = '\u25b6'

  if (arNombre)         arNombre.value = (searchProductos?.value || '').trim()
  if (arCodigo)         arCodigo.value = ''
  if (arCodigoBarras)   arCodigoBarras.value = ''
  if (arPrecio)         arPrecio.value = ''
  if (arStock)          arStock.value = '1'
  if (arCantidad)       arCantidad.value = '1'
  if (arUnidad)         arUnidad.value = 'pza'
  if (arEsGranel)       arEsGranel.checked = false
  if (arError)         { arError.style.display = 'none'; arError.textContent = '' }
  _arActualizarPreview()

  if (arCategoria) {
    arCategoria.innerHTML = '<option value="">Cargando categor\u00edas\u2026</option>'
  }
  try {
    var cats = await cargarCategoriasParaArticuloRapido()
    renderCategoriasEnArticuloRapido(cats)
    try {
      var lastCat = localStorage.getItem(AR_LAST_CAT_KEY)
      if (lastCat && arCategoria) {
        var opt = arCategoria.querySelector('option[value="' + lastCat + '"]')
        if (opt) arCategoria.value = lastCat
      }
    } catch (_) {}
  } catch (_) {
    if (arCategoria) arCategoria.innerHTML = '<option value="">Error al cargar</option>'
  }

  modalArticuloRapido.style.display = 'flex'
  setTimeout(function() { if (arNombre) arNombre.focus() }, 80)
}

function cerrarModalArticuloRapido() {
  if (!modalArticuloRapido) return
  modalArticuloRapido.style.display = 'none'
}

function _arMostrarError(msg) {
  if (!arError) { mostrarToast(msg, 'error'); return }
  arError.textContent = msg
  arError.style.display = 'block'
}

function _arValidar(data) {
  if (!data.nombre)                                  return 'El nombre es requerido'
  if (!data.precioVenta || data.precioVenta <= 0)   return 'El precio de venta debe ser mayor a 0'
  if (data.stockInicial < 0)                         return 'La existencia inicial debe ser >= 0'
  if (!data.cantidadVenta || data.cantidadVenta <= 0) return 'La cantidad a vender debe ser mayor a 0'
  if (data.cantidadVenta > data.stockInicial)        return 'La cantidad a vender no puede ser mayor a la existencia inicial'
  if (!data.categoriaId)                             return 'Selecciona una categoría'
  return null
}

async function enviarArticuloRapido(e) {
  e.preventDefault()

  const data = {
    nombre:        (arNombre?.value || '').trim(),
    codigoInterno: (arCodigo?.value || '').trim(),
    codigoBarras:  (arCodigoBarras?.value || '').trim(),
    categoriaId:   parseInt(arCategoria?.value),
    precioVenta:   parseFloat(arPrecio?.value),
    stockInicial:  parseFloat(arStock?.value),
    cantidadVenta: parseFloat(arCantidad?.value),
    unidadVenta:   arUnidad?.value || 'pza',
    esGranel:      !!arEsGranel?.checked,
    sucursalId:    resolverSucursalParaArticuloRapido(),
    turnoId:       turnoActivo?.id || null,
    claveSat:      null,
    unidadSat:     'H87'
  }

  // Si el panel avanzadas está cerrado, stockInicial = cantidadVenta
  if (!_arAvanzadasAbierto) {
    data.stockInicial = data.cantidadVenta
  }

  const error = _arValidar(data)
  if (error) { _arMostrarError(error); return }

  if (!arSubmit) return
  const textoOriginal = arSubmit.innerHTML
  arSubmit.disabled    = true
  arSubmit.innerHTML   = '⟳ Creando…'

  try {
    const res  = await fetch(`${API_URL}/productos/articulo-rapido`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify(data)
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = (json && json.error) || `Error ${res.status} al crear artículo`
      _arMostrarError(msg)
      return
    }
    const prod = (json && json.data) || json

    const idParsed = parseInt(prod.id, 10)
    const precio = parseFloat(prod.precioVenta || prod.precioBase || 0)
    productoCache.set(idParsed, {
      id:               idParsed,
      nombre:           prod.nombre,
      precioVenta:      precio,
      precioBase:       parseFloat(prod.precioBase || prod.precioVenta || 0),
      stock:            parseFloat(prod.stock ?? prod.inventario?.stockActual ?? 0),
      codigoInterno:    prod.codigoInterno || '',
      codigoBarras:     prod.codigoBarras || null,
      esGranel:         !!prod.esGranel,
      unidadVenta:      prod.unidadVenta || data.unidadVenta,
      unidadCompra:     prod.unidadCompra || prod.unidadVenta || data.unidadVenta,
      factorConversion: parseFloat(prod.factorConversion || 1)
    })

    const enCarrito = carrito.find(i => i.id === idParsed)
    const cantidadFinal = parseFloat(data.cantidadVenta.toFixed(3))
    if (data.esGranel) {
      abrirModalGranel(
        idParsed,
        prod.nombre,
        precio,
        prod.unidadVenta || data.unidadVenta,
        cantidadFinal,
        parseFloat(prod.factorConversion || 1),
        prod.unidadCompra || prod.unidadVenta || data.unidadVenta
      )
    } else {
      if (enCarrito) {
        enCarrito.cantidad = parseFloat(((parseFloat(enCarrito.cantidad) || 0) + cantidadFinal).toFixed(3))
      } else {
        carrito.push({
          id:               idParsed,
          nombre:           prod.nombre,
          precio:           precio,
          precioOriginal:   precio,
          cantidad:         cantidadFinal,
          esGranel:         false,
          unidadVenta:      prod.unidadVenta || data.unidadVenta,
          unidadCompra:     prod.unidadCompra || prod.unidadVenta || data.unidadVenta,
          factorConversion: parseFloat(prod.factorConversion || 1),
          unidadElegida:    'base'
        })
      }
      actualizarCarrito({ scrollAlFinal: true })
    }

    if (searchProductos) {
      searchProductos.value = ''
      buscarProductos('')
    }
    cerrarModalArticuloRapido()

    // Recordar última categoría para la próxima
    try {
      if (data.categoriaId) localStorage.setItem(AR_LAST_CAT_KEY, String(data.categoriaId))
    } catch (_) {}

    const quedan = data.stockInicial - data.cantidadVenta
    const sufijo = quedan > 0 ? ` — quedan ${quedan.toString()}` : ''
    mostrarToast(
      `✓ ${prod.nombre} creado (${data.cantidadVenta.toString()} ${prod.unidadVenta || data.unidadVenta})${sufijo}`,
      'success'
    )
  } catch (err) {
    console.error('❌ Error artículo rápido:', err)
    _arMostrarError(err.message || 'Error de red al crear artículo')
  } finally {
    if (arSubmit) {
      arSubmit.disabled  = false
      arSubmit.innerHTML = textoOriginal
    }
  }
}

console.log('✅ punto-venta.js completamente cargado')

// ══════════════════════════════════════════════════════════════════
//  PAGO MIXTO — Funciones UI
// ══════════════════════════════════════════════════════════════════

function inicializarPagoMixto(totalVenta) {
  const list = document.getElementById('mixto-pagos-list')
  const totalRef = document.getElementById('mixto-total-ref')
  if (totalRef) totalRef.textContent = `$${totalVenta.toFixed(2)}`
  list.innerHTML = ''
  agregarFilaMixto('EFECTIVO')
  agregarFilaMixto('DEBITO')
  recalcularMixto()

  document.getElementById('btn-mixto-agregar').onclick = () => {
    agregarFilaMixto('TRANSFERENCIA')
    recalcularMixto()
  }
}

function agregarFilaMixto(metodoDefault) {
  const list = document.getElementById('mixto-pagos-list')
  const row = document.createElement('div')
  row.className = 'mixto-row'

  if (metodoDefault === 'EFECTIVO') {
    row.classList.add('mixto-row-efectivo')
    row.innerHTML = `
      <select class="mixto-metodo" disabled>
        <option value="EFECTIVO" selected>💵 Efectivo</option>
      </select>
      <input type="number" class="mixto-recibido" min="0" step="0.01" placeholder="Recibido $" />
      <input type="number" class="mixto-monto" placeholder="$0.00" readonly tabindex="-1" />
      <span class="mixto-cambio-celda">$0.00</span>
      <button type="button" class="mixto-quitar" title="Quitar">✕</button>
    `
    row.querySelector('.mixto-recibido').addEventListener('input', recalcularMixto)
  } else {
    row.innerHTML = `
      <select class="mixto-metodo">
        <option value="CREDITO" ${metodoDefault==='CREDITO'?'selected':''}>💳 T. Crédito</option>
        <option value="DEBITO" ${metodoDefault==='DEBITO'?'selected':''}>💳 T. Débito</option>
        <option value="TRANSFERENCIA" ${metodoDefault==='TRANSFERENCIA'?'selected':''}>🔄 Transf.</option>
      </select>
      <input type="number" class="mixto-monto" min="0" step="0.01" placeholder="$0.00" />
      <button type="button" class="mixto-quitar" title="Quitar">✕</button>
    `
    row.querySelector('.mixto-monto').addEventListener('input', recalcularMixto)
  }

  row.querySelector('.mixto-quitar').addEventListener('click', () => {
    row.remove()
    recalcularMixto()
  })
  list.appendChild(row)
  const focusSel = metodoDefault === 'EFECTIVO' ? '.mixto-recibido' : '.mixto-monto'
  setTimeout(() => row.querySelector(focusSel)?.focus(), 50)
}

function recalcularMixto() {
  const rows = document.querySelectorAll('#mixto-pagos-list > div')

  const totalBruto = carrito.reduce((s, i) => s + subtotalLinea(i), 0)
  const { pct } = getPctEfectivo()
  const descAmt = parseFloat((totalBruto * (pct / 100)).toFixed(2))
  const totalFinal = parseFloat((totalBruto - descAmt).toFixed(2))

  let sumNoEfectivo = 0
  let filaEfectivo = null
  rows.forEach(row => {
    if (row.querySelector('.mixto-recibido')) {
      filaEfectivo = row
    } else {
      sumNoEfectivo += parseFloat(row.querySelector('.mixto-monto')?.value) || 0
    }
  })
  sumNoEfectivo = parseFloat(sumNoEfectivo.toFixed(2))

  const cubiertoEl = document.getElementById('mixto-cubierto')
  const faltaEl = document.getElementById('mixto-falta')
  const totalRef = document.getElementById('mixto-total-ref')
  const cambioWrap = document.getElementById('mixto-cambio-wrap')
  const cambioEl = document.getElementById('mixto-cambio')

  if (totalRef) totalRef.textContent = `$${totalFinal.toFixed(2)}`

  const pintarDiferencia = (dif) => {
    if (!faltaEl) return
    if (dif > 0.005) {
      faltaEl.textContent = `(faltan $${dif.toFixed(2)})`
      faltaEl.style.color = '#e8710a'
    } else if (dif < -0.005) {
      faltaEl.textContent = `(excede $${Math.abs(dif).toFixed(2)})`
      faltaEl.style.color = '#ff6b6b'
    } else {
      faltaEl.textContent = '✓ Cubierto'
      faltaEl.style.color = '#60d080'
    }
  }

  if (!filaEfectivo) {
    if (cubiertoEl) cubiertoEl.textContent = `$${sumNoEfectivo.toFixed(2)}`
    pintarDiferencia(parseFloat((totalFinal - sumNoEfectivo).toFixed(2)))
    if (cambioWrap) cambioWrap.style.display = 'none'
    return
  }

  const recibido = parseFloat(filaEfectivo.querySelector('.mixto-recibido')?.value) || 0
  const montoInput = filaEfectivo.querySelector('.mixto-monto')
  const cambioCelda = filaEfectivo.querySelector('.mixto-cambio-celda')
  const necesarioEfectivo = parseFloat((totalFinal - sumNoEfectivo).toFixed(2))

  if (necesarioEfectivo < -0.005) {
    if (montoInput) montoInput.value = ''
    if (cambioCelda) cambioCelda.textContent = '$0.00'
    if (cambioEl) cambioEl.textContent = '$0.00'
    if (cambioWrap) cambioWrap.style.display = 'none'
    if (cubiertoEl) cubiertoEl.textContent = `$${sumNoEfectivo.toFixed(2)}`
    if (faltaEl) {
      faltaEl.textContent = '(los otros pagos exceden el total)'
      faltaEl.style.color = '#ff6b6b'
    }
    return
  }

  const netoEfectivo = Math.max(0, necesarioEfectivo)
  if (montoInput) montoInput.value = netoEfectivo > 0 ? netoEfectivo.toFixed(2) : ''

  const sobra = recibido - necesarioEfectivo
  const cambio = sobra > 0.005 ? parseFloat(sobra.toFixed(2)) : 0
  if (cambioCelda) cambioCelda.textContent = `$${cambio.toFixed(2)}`
  if (cambioEl) cambioEl.textContent = `$${cambio.toFixed(2)}`
  if (cambioWrap) cambioWrap.style.display = 'flex'

  const efectivoAplicado = Math.min(recibido, netoEfectivo)
  const cubierto = parseFloat((sumNoEfectivo + efectivoAplicado).toFixed(2))
  if (cubiertoEl) cubiertoEl.textContent = `$${cubierto.toFixed(2)}`
  pintarDiferencia(parseFloat((totalFinal - cubierto).toFixed(2)))
}

function obtenerDesgloseMixto() {
  const rows = document.querySelectorAll('#mixto-pagos-list > div')
  const pagos = []
  rows.forEach(row => {
    const recibidoInput = row.querySelector('.mixto-recibido')
    const monto = parseFloat(row.querySelector('.mixto-monto')?.value) || 0
    if (recibidoInput) {
      const recibido = parseFloat(recibidoInput.value) || 0
      if (monto > 0) {
        pagos.push({ metodo: 'EFECTIVO', monto: parseFloat(monto.toFixed(2)), recibido: parseFloat(recibido.toFixed(2)) })
      }
    } else {
      const metodo = row.querySelector('.mixto-metodo')?.value
      if (metodo && monto > 0) {
        pagos.push({ metodo, monto: parseFloat(monto.toFixed(2)) })
      }
    }
  })
  return pagos
}

// ══════════════════════════════════════════════════════════════════
//  AJUSTE RÁPIDO DE INVENTARIO
//  Disparador: CLICK en botón "Ajustar" de la tarjeta de producto
//  Backend:    POST /inventario/ajuste-rapido
// ══════════════════════════════════════════════════════════════════

const modalAjusteRapido      = document.getElementById('modal-ajuste-rapido')
const ajusteRapidoActual     = document.getElementById('ajuste-rapido-actual')
const ajusteRapidoNuevo      = document.getElementById('ajuste-rapido-nuevo')
const ajusteRapidoDifLabel   = document.getElementById('ajuste-rapido-dif-label')
const ajusteRapidoAviso      = document.getElementById('ajuste-rapido-aviso')
const ajusteRapidoError      = document.getElementById('ajuste-rapido-error')
const ajusteRapidoCancelar   = document.getElementById('ajuste-rapido-cancelar')
const ajusteRapidoConfirmar  = document.getElementById('ajuste-rapido-confirmar')

let ajusteRapidoEstado = { productoId: null, stockActual: 0, esGranel: false, unidadVenta: '' }

function formatearStockAjuste(valor) {
  const n = parseFloat(valor)
  if (isNaN(n)) return '0'
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}

function abrirModalAjusteRapido(productoId, stockActual, esGranel, unidadVenta) {
  if (!modalAjusteRapido) {
    console.warn('⚠ modal-ajuste-rapido no existe en el DOM')
    return
  }
  const stockNum = parseFloat(stockActual) || 0
  ajusteRapidoEstado = {
    productoId:   parseInt(productoId, 10),
    stockActual:  stockNum,
    esGranel:     !!esGranel,
    unidadVenta:  unidadVenta || ''
  }

  ajusteRapidoActual.textContent       = formatearStockAjuste(stockNum)
  ajusteRapidoNuevo.value              = ''
  ajusteRapidoNuevo.step               = esGranel ? '0.001' : '1'
  ajusteRapidoDifLabel.innerHTML       = '&nbsp;'
  ajusteRapidoDifLabel.style.color     = '#9aa3b2'
  ajusteRapidoAviso.innerHTML          = '&nbsp;'
  ajusteRapidoError.style.display      = 'none'
  ajusteRapidoError.textContent        = ''

  modalAjusteRapido.style.display = 'flex'
  setTimeout(() => ajusteRapidoNuevo.focus(), 50)
}

function cerrarModalAjusteRapido() {
  if (!modalAjusteRapido) return
  modalAjusteRapido.style.display = 'none'
  ajusteRapidoEstado = { productoId: null, stockActual: 0, esGranel: false, unidadVenta: '' }
}

async function enviarAjusteRapido() {
  const productoId  = ajusteRapidoEstado.productoId
  const stockActual = ajusteRapidoEstado.stockActual
  const nuevoStock  = parseFloat(ajusteRapidoNuevo.value)

  if (!productoId) {
    mostrarToast('No se identificó el producto', 'error')
    return
  }
  if (isNaN(nuevoStock) || nuevoStock < 0) {
    ajusteRapidoError.textContent   = 'Ingresa un número válido (>= 0)'
    ajusteRapidoError.style.display = 'block'
    ajusteRapidoNuevo.focus()
    return
  }
  if (parseFloat(nuevoStock.toFixed(3)) === parseFloat(stockActual.toFixed(3))) {
    ajusteRapidoError.textContent   = 'El nuevo stock es igual al actual'
    ajusteRapidoError.style.display = 'block'
    return
  }

  const sucursalId = turnoActivo?.sucursalId
  if (!sucursalId) {
    mostrarToast('No se pudo identificar la sucursal del turno', 'error')
    return
  }

  ajusteRapidoConfirmar.disabled      = true
  ajusteRapidoConfirmar.style.opacity = '0.6'

  try {
    const response = await fetch(`${API_URL}/inventario/ajuste-rapido`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify({ productoId, sucursalId, nuevoStock })
    })

    const data = await response.json()
    if (!response.ok) {
      ajusteRapidoError.textContent   = data.error || 'Error al ajustar inventario'
      ajusteRapidoError.style.display = 'block'
      return
    }

    const cached = productoCache.get(productoId)
    if (cached) {
      cached.stock = data.data.stockDespues
      productoCache.set(productoId, cached)
    }

    const card = productosGrid?.querySelector(`[data-producto-id="${productoId}"]`)
    if (card) {
      const stockEl = card.querySelector('.producto-stock')
      if (stockEl) {
        const nuevo    = parseFloat(data.data.stockDespues)
        const esGranel = cached?.esGranel || ajusteRapidoEstado.esGranel
        const unidad   = cached?.unidadVenta || ajusteRapidoEstado.unidadVenta
        if (nuevo > 0) {
          stockEl.classList.remove('agotado')
          stockEl.textContent = `Stock: ${formatearStockAjuste(nuevo)}${esGranel && unidad ? ' ' + unidad : ''}`
        } else {
          stockEl.classList.add('agotado')
          stockEl.textContent = 'Agotado'
        }
      }
    }

    cerrarModalAjusteRapido()
    const signo = data.data.diferencia > 0 ? '+' : ''
    mostrarToast(`✓ Stock ajustado (${signo}${data.data.diferencia})`, 'success')

  } catch (err) {
    console.error('Error de red en ajuste rápido:', err)
    ajusteRapidoError.textContent   = 'Error de conexión. Intenta de nuevo.'
    ajusteRapidoError.style.display = 'block'
  } finally {
    ajusteRapidoConfirmar.disabled      = false
    ajusteRapidoConfirmar.style.opacity = '1'
  }
}

if (modalAjusteRapido) {
  ajusteRapidoCancelar?.addEventListener('click',  cerrarModalAjusteRapido)
  ajusteRapidoConfirmar?.addEventListener('click', enviarAjusteRapido)

  modalAjusteRapido.addEventListener('click', (e) => {
    if (e.target === modalAjusteRapido) cerrarModalAjusteRapido()
  })

  ajusteRapidoNuevo?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); enviarAjusteRapido() }
    if (e.key === 'Escape') { e.preventDefault(); cerrarModalAjusteRapido() }
  })

  ajusteRapidoNuevo?.addEventListener('input', () => {
    const nuevo = parseFloat(ajusteRapidoNuevo.value)
    if (isNaN(nuevo)) {
      ajusteRapidoDifLabel.innerHTML = '&nbsp;'
      ajusteRapidoAviso.innerHTML    = '&nbsp;'
      ajusteRapidoError.style.display = 'none'
      return
    }
    const dif = parseFloat((nuevo - ajusteRapidoEstado.stockActual).toFixed(3))
    if (dif > 0) {
      ajusteRapidoDifLabel.textContent = `+${dif} entrada`
      ajusteRapidoDifLabel.style.color = '#22c55e'
      ajusteRapidoAviso.textContent    = `Se aplicará un ajuste de +${dif}`
    } else if (dif < 0) {
      ajusteRapidoDifLabel.textContent = `${dif} salida`
      ajusteRapidoDifLabel.style.color = '#ef4444'
      ajusteRapidoAviso.textContent    = `Se aplicará un ajuste de ${dif}`
    } else {
      ajusteRapidoDifLabel.innerHTML   = '&nbsp;'
      ajusteRapidoAviso.innerHTML      = '&nbsp;'
    }
    ajusteRapidoError.style.display = 'none'
  })
}

// Click en botón "Ajustar" de la tarjeta — usa capture:true + stopPropagation
// para no chocar con el click de la tarjeta que agrega al carrito.
productosGrid?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="ajustar"]')
  if (!btn) return
  e.preventDefault()
  e.stopPropagation()

  const card = btn.closest('[data-producto-id]')
  if (!card) return
  const id = parseInt(card.dataset.productoId, 10)
  const producto = productoCache.get(id)
  if (!producto) {
    mostrarToast('Producto no encontrado en caché', 'warning')
    return
  }
  if (producto.stock === null || producto.stock === undefined) {
    mostrarToast('Stock no disponible para este producto', 'warning')
    return
  }
  abrirModalAjusteRapido(producto.id, producto.stock, producto.esGranel, producto.unidadVenta)
}, true)

productosGrid?.addEventListener('mouseover', (e) => {
  const btn = e.target.closest('button[data-action="ajustar"]')
  if (!btn) return
  btn.style.background  = 'rgba(59,130,246,0.15)'
  btn.style.borderColor = 'rgba(59,130,246,0.4)'
})
productosGrid?.addEventListener('mouseout', (e) => {
  const btn = e.target.closest('button[data-action="ajustar"]')
  if (!btn) return
  btn.style.background  = 'rgba(255,255,255,0.04)'
  btn.style.borderColor = 'rgba(255,255,255,0.08)'
})
