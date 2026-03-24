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

const API_URL = 'http://localhost:3000'
console.log('✅ Punto-venta.js cargado correctamente')
console.log('✅ Usuario:', USUARIO.nombre || 'Anónimo')

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
let vendedorSeleccionado   = null   // { id, nombre } — usuario que hizo la venta
let descuentoManual        = 0      // porcentaje de descuento aplicado
let creditoCliente         = null   // { limite, saldo, disponible } si cliente es REGISTRADO
let turnoActivo            = null
let metodoPagoSeleccionado = null   // null = sin selección, cajero debe elegir
let clienteSeleccionado    = null
let ventaEnProceso         = false
let clientesLista          = []
const productoCache        = new Map()

// ══════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('📄 DOMContentLoaded: Punto de Venta')
  await verificarTurno()
  await cargarClientes()
  mostrarEstadoInicial()
  configurarEventListeners()
  // Quitar selección predeterminada de método de pago
  document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'))
  metodoPagoSeleccionado = null
  actualizarCarrito()
  cargarCotizacionDesdeStorage()
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
    modalAbrirTurno.style.display  = 'none'
    montoInicialTurno.value        = '0'
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

// Filtra la lista en memoria
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

// Renderiza los ítems dentro del dropdown
function renderItemsDropdown(clientes) {
  const list = document.getElementById('dropdown-clientes-pos')
    ?.querySelector('.dropdown-clientes-pos-list')
  if (!list) return

  list.innerHTML =
    `<div class="dropdown-cliente-item publico"
          onclick="seleccionarClientePOS(null,'')">
       <span>👤 Público general</span>
     </div>` +
    clientes.map(c => `
      <div class="dropdown-cliente-item"
           onclick="seleccionarClientePOS(${c.id},'${(c.apodo||c.nombre).replace(/'/g,"\\'")}','${(c.telefono||'').replace(/'/g,"\\'")}')">
        <span>${c.apodo ? `${c.apodo} <span style="color:var(--muted);font-size:0.78rem">(${c.nombre})</span>` : c.nombre}</span>
        ${c.telefono ? `<span class="dropdown-cliente-tel">${c.telefono}</span>` : ''}
      </div>`
    ).join('')
}

// Abre el dropdown con buscador interno
function abrirDropdownClientes() {
  const dd = document.getElementById('dropdown-clientes-pos')
  if (!dd) return

  // Toggle
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

  // Render inicial
  renderItemsDropdown(filtrarClientes(''))

  // Buscador interno
  const ddInput = document.getElementById('dd-search-cliente')
  ddInput?.addEventListener('input', e => renderItemsDropdown(filtrarClientes(e.target.value)))
  setTimeout(() => ddInput?.focus(), 40)
}

function cerrarDropdownClientes() {
  const dd = document.getElementById('dropdown-clientes-pos')
  if (dd) dd.style.display = 'none'
  document.getElementById('btn-lista-clientes')?.classList.remove('active')
}

// Selecciona un cliente desde el dropdown o desde el autocompletado antiguo
window.seleccionarClientePOS = function(id, nombre, telefono) {
  if (id) {
    clienteSeleccionado = clientesLista.find(c => c.id === id) || { id, nombre }
    if (clienteNombre) clienteNombre.value = nombre
    // Badge
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
  // Verificar si cliente tiene crédito disponible
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

// Compatibilidad con código antiguo que llama seleccionarCliente
function seleccionarCliente(id, nombre) {
  seleccionarClientePOS(id, nombre, '')
}

function limpiarCliente() {
  creditoCliente = null
  ocultarCreditoCliente()
  // Si estaba en modo CREDITO_CLIENTE, resetear método
  if (metodoPagoSeleccionado === 'CREDITO_CLIENTE') {
    metodoPagoSeleccionado = null
    document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'))
    actualizarCarrito()
  }
  clienteSeleccionado = null
  const badge = document.getElementById('cliente-seleccionado-badge')
  if (badge) badge.style.display = 'none'
}

// Dropdown antiguo de compatibilidad (vacío — ya no se usa)
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

async function buscarProductos(query) {
  if (searchTimeout) clearTimeout(searchTimeout)
  const q = query.trim()

  if (q.length === 0) {
    if (productoCache.size > 0) {
      mostrarProductos(Array.from(productoCache.values()))
    } else {
      mostrarEstadoInicial()
    }
    return
  }

  if (q.length < 1) return

  const searchIndicator = document.getElementById('search-indicator')
  if (searchIndicator) searchIndicator.style.opacity = '1'

  searchTimeout = setTimeout(async () => {
    try {
      const response = await fetch(
        `${API_URL}/productos?q=${encodeURIComponent(q)}&take=30`,
        { headers: { 'Authorization': `Bearer ${TOKEN}` } }
      )
      if (!response.ok) throw new Error('Error en búsqueda')
      const data      = await response.json()
      const resultados = data.data || []
      resultados.forEach(p => productoCache.set(p.id, p))
      mostrarProductos(resultados)
      if (searchIndicator) searchIndicator.style.opacity = '0'
    } catch (err) {
      console.error('❌ Error buscando:', err)
      if (searchIndicator) searchIndicator.style.opacity = '0'
    }
  }, 300)
}

function mostrarProductos(productos) {
  if (productos.length === 0) {
    productosGrid.innerHTML = `<div class="sin-resultados">No se encontraron productos</div>`
    return
  }
  productosGrid.innerHTML = productos.map(p => `
    <div class="tarjeta-producto"
         onclick="agregarAlCarrito(${p.id}, '${p.nombre.replace(/'/g,"\\'")}', ${p.precioBase})">
      ${p.imagenUrl ? `<img src="${p.imagenUrl}" alt="${p.nombre}" class="producto-imagen" />` : ''}
      <div class="producto-info">
        <h4>${p.nombre}</h4>
        <p class="producto-codigo">${p.codigoInterno}</p>
        <p class="producto-precio">$${parseFloat(p.precioBase).toFixed(2)}</p>
        <p class="producto-stock ${p.stock > 0 ? '' : 'agotado'}">
          ${p.stock > 0 ? `Stock: ${p.stock}` : 'Agotado'}
        </p>
      </div>
    </div>
  `).join('')
}

// ══════════════════════════════════════════════════════════════════
//  CARRITO
// ══════════════════════════════════════════════════════════════════

function agregarAlCarrito(productoId, nombre, precio) {
  const existe = carrito.find(item => item.id === productoId)
  if (existe) {
    existe.cantidad += 1
  } else {
    carrito.push({ id: productoId, nombre, precio: parseFloat(precio), cantidad: 1 })
  }
  if (!productoCache.get(productoId)) {
    productoCache.set(productoId, { id: productoId, nombre, precioBase: precio, stock: null })
  }
  actualizarCarrito()
}

function eliminarDelCarrito(productoId) {
  carrito = carrito.filter(item => item.id !== productoId)
  actualizarCarrito()
}

function actualizarCantidad(productoId, cantidad) {
  const item = carrito.find(i => i.id === productoId)
  if (item) {
    if (cantidad <= 0) {
      eliminarDelCarrito(productoId)
    } else {
      item.cantidad = parseInt(cantidad)
      actualizarCarrito()
    }
  }
}

function actualizarCarrito() {
  if (carrito.length === 0) {
    carritoTbody.innerHTML = `
      <tr class="carrito-empty">
        <td colspan="4" style="text-align:center;color:var(--muted);padding:40px;">
          Agrega productos para comenzar
        </td>
      </tr>`
  } else {
    carritoTbody.innerHTML = carrito.map(item => `
      <tr>
        <td>${item.nombre.substring(0, 20)}</td>
        <td style="text-align:center;">
          <input type="number" value="${item.cantidad}" min="1"
                 style="width:50px;padding:4px;text-align:center;"
                 onchange="actualizarCantidad(${item.id}, this.value)" />
        </td>
        <td style="text-align:right;">$${(item.precio * item.cantidad).toFixed(2)}</td>
        <td style="text-align:center;">
          <button class="btn-eliminar" onclick="eliminarDelCarrito(${item.id})">❌</button>
        </td>
      </tr>`).join('')
  }

  itemsCount.textContent = `(${carrito.length})`
  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)
  resumenTotal.textContent = `$${total.toFixed(2)}`

  btnCompletarVenta.disabled = !(carrito.length > 0 && turnoActivo && metodoPagoSeleccionado)
  const btnCotizar = document.getElementById('btn-cotizar-carrito')
  if (btnCotizar) btnCotizar.disabled = carrito.length === 0
}

function limpiarCarrito() {
  if (carrito.length === 0) return
  if (!confirm('¿Limpiar todo el carrito?')) return

  carrito                = []
  clienteSeleccionado    = null
  vendedorSeleccionado   = null
  descuentoManual        = 0
  pinVendedorVerificado  = false
  creditoCliente         = null
  ocultarCreditoCliente()
  montoRecibido.value    = ''
  clienteNombre.value    = ''
  productoCache.clear()
  searchProductos.value  = ''

  const badge = document.getElementById('cliente-seleccionado-badge')
  if (badge) badge.style.display = 'none'

  // Resetear método de pago
  metodoPagoSeleccionado = null
  document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'))
  if (montoEfectivoControl) montoEfectivoControl.style.display = 'none'

  cerrarDropdownClientes()
  mostrarEstadoInicial()
  actualizarCarrito()
}

// ══════════════════════════════════════════════════════════════════
//  NOTIFICACIONES TOAST — reemplaza alert() nativo
// ══════════════════════════════════════════════════════════════════

// Toast con título + detalle multilínea (para stock insuficiente)
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
  // Eliminar toast anterior si existe
  document.getElementById('pos-toast')?.remove()

  const colores = {
    error:   { bg: 'rgba(255,107,107,0.12)', border: 'rgba(255,107,107,0.35)', texto: '#ff6b6b', icono: '✕' },
    warning: { bg: 'rgba(232,113,10,0.12)',  border: 'rgba(232,113,10,0.35)',  texto: '#e8710a', icono: '⚠' },
    info:    { bg: 'rgba(74,144,226,0.12)',   border: 'rgba(74,144,226,0.35)',  texto: '#4a90e2', icono: 'ℹ' }
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

  // Inyectar keyframe si no existe
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
  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

  // Total y método
  document.getElementById('confirmacion-total').textContent  = `$${total.toFixed(2)}`
  const metodoLabel = { EFECTIVO:'💵 Efectivo', CREDITO:'💳 Tarjeta', DEBITO:'💳 Tarjeta', TRANSFERENCIA:'🔄 Transferencia' }
  document.getElementById('confirmacion-metodo').textContent = metodoLabel[metodoPagoSeleccionado] || metodoPagoSeleccionado

  // Cliente
  const rowCliente = document.getElementById('confirm-row-cliente')
  if (rowCliente) {
    if (clienteSeleccionado?.nombre) {
      document.getElementById('confirmacion-cliente').textContent = clienteSeleccionado.nombre
      rowCliente.style.display = 'flex'
    } else {
      rowCliente.style.display = 'none'
    }
  }

  // Monto recibido + cambio (solo efectivo)
  const montoWrap = document.getElementById('confirm-monto-efectivo-wrap')
  const montoInput = document.getElementById('confirm-monto-recibido')
  if (montoWrap) {
    if (metodoPagoSeleccionado === 'EFECTIVO') {
      montoWrap.style.display = 'block'
      // Limpiar el input al abrir el modal para que el cajero ingrese el monto fresco
      if (montoInput) montoInput.value = ''
      // Ocultar cambio hasta que se ingrese el monto
      const cambioWrap = document.getElementById('confirm-cambio-wrap')
      if (cambioWrap) cambioWrap.style.display = 'none'
      // Conectar evento — recalcula cambio en tiempo real sobre el total con descuento
      if (montoInput) {
        montoInput.oninput = () => recalcularCambioModal()
        setTimeout(() => montoInput.focus(), 100)
      }
    } else {
      montoWrap.style.display = 'none'
    }
  }

  // Poblar selector de vendedor
  const selVendedor = document.getElementById('confirm-vendedor-select')
  if (selVendedor) {
    selVendedor.innerHTML = ''
    // Opción: el cajero logueado
    const optPropio = document.createElement('option')
    optPropio.value = USUARIO.id
    optPropio.textContent = `${USUARIO.nombre} (tú)`
    selVendedor.appendChild(optPropio)
    // Cargar otros usuarios activos de la sucursal
    fetch(`${API_URL}/usuarios?activo=true`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
      .then(r => r.json())
      .then(data => {
        const lista = Array.isArray(data) ? data : (data.data || [])
        lista.filter(u => u.id !== USUARIO.id && u.activo)
          .sort((a,b) => a.nombre.localeCompare(b.nombre))
          .forEach(u => {
            const opt = document.createElement('option')
            opt.value = u.id
            opt.textContent = u.nombre
            selVendedor.appendChild(opt)
          })
      }).catch(() => {})
    // Restaurar selección previa si existe
    if (vendedorSeleccionado) selVendedor.value = vendedorSeleccionado.id
  }

  // Resetear descuento manual
  const inputDesc = document.getElementById('confirm-descuento-input')
  if (inputDesc) inputDesc.value = descuentoManual > 0 ? descuentoManual : ''

  // Resetear selector de empleado y cargar lista fresca
  const selEmpReset = document.getElementById('confirm-empleado-select')
  const badgeEmpReset = document.getElementById('confirm-empleado-badge')
  if (selEmpReset)    selEmpReset.value = ''
  if (badgeEmpReset)  badgeEmpReset.style.display = 'none'
  cargarEmpleadosSelect()

  actualizarResumenConDescuento()

  // Mostrar modal con el nuevo estilo (usa display flex)
  modalConfirmacion.style.display = 'flex'
}

// Devuelve el porcentaje efectivo: manual tiene prioridad; si no hay, usa 3% si hay empleado
function getPctEfectivo() {
  const inputDesc = document.getElementById('confirm-descuento-input')
  const selEmp    = document.getElementById('confirm-empleado-select')
  const pctManual = parseFloat(inputDesc?.value) || 0
  const hayEmp    = selEmp?.value !== '' && selEmp?.value !== undefined && selEmp?.value !== null
  if (pctManual > 0) return { pct: pctManual, esEmpleado: false }
  if (hayEmp)        return { pct: 3, esEmpleado: true }
  return { pct: 0, esEmpleado: false }
}

function actualizarResumenConDescuento() {
  const totalBruto = carrito.reduce((s, i) => s + (i.precio * i.cantidad), 0)
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

  // Si es efectivo, recalcular cambio con el nuevo total
  if (metodoPagoSeleccionado === 'EFECTIVO') recalcularCambioModal()
}

// Recalcula el cambio en tiempo real usando el total con descuento ya aplicado
function recalcularCambioModal() {
  const totalBruto = carrito.reduce((s, i) => s + (i.precio * i.cantidad), 0)
  const { pct }    = getPctEfectivo()
  const descAmt    = parseFloat((totalBruto * (pct / 100)).toFixed(2))
  const totalFinal = parseFloat((totalBruto - descAmt).toFixed(2))

  const montoInput = document.getElementById('confirm-monto-recibido')
  const cambioWrap = document.getElementById('confirm-cambio-wrap')
  const cambioEl   = document.getElementById('confirmacion-cambio')

  const monto  = parseFloat(montoInput?.value) || 0
  const cambio = parseFloat((monto - totalFinal).toFixed(2))

  if (!cambioWrap || !cambioEl) return

  if (monto > 0 && cambio >= 0) {
    cambioEl.textContent    = `$${cambio.toFixed(2)}`
    cambioWrap.style.display = 'block'
  } else {
    cambioWrap.style.display = 'none'
  }
}

// ════════════════════════════════════════════════════════════════════
//  PIN DE CAJERO
// ════════════════════════════════════════════════════════════════════
let pinVendedorVerificado = false

function pedirPinVendedor(vendedorId, selectEl) {
  pinVendedorVerificado = false

  // Crear o reusar el bloque de PIN
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

  // Llenar datos
  document.getElementById('exito-folio').textContent  = `Folio: ${ventaData.folio}`
  document.getElementById('exito-total').textContent  = `$${parseFloat(ventaData.total).toFixed(2)}`

  const metodoLabel = {
    EFECTIVO:        '💵 Efectivo',
    CREDITO:         '💳 Tarjeta',
    DEBITO:          '💳 Tarjeta',
    TRANSFERENCIA:   '🔄 Transferencia',
    CREDITO_CLIENTE: '🏦 Crédito cliente'
  }
  document.getElementById('exito-metodo').textContent =
    metodoLabel[ventaData.metodoPago] || metodoLabel[metodoPagoSeleccionado] || ventaData.metodoPago || '—'

  // Cambio — solo aplica en efectivo
  const rowCambio = document.getElementById('exito-row-cambio')
  const montoRec  = parseFloat(document.getElementById('confirm-monto-recibido')?.value) || 0
  // El totalFinal ya llega como parámetro — usarlo directamente para el cambio
  if (metodoPagoSeleccionado === 'EFECTIVO' && montoRec > 0) {
    const cambio = montoRec - totalFinal
    if (cambio >= 0) {
      document.getElementById('exito-cambio').textContent = `$${cambio.toFixed(2)}`
      rowCambio.style.display = 'flex'
    } else {
      rowCambio.style.display = 'none'
    }
  } else {
    rowCambio.style.display = 'none'
  }

  // Mostrar overlay
  overlay.style.display = 'flex'

  // Botón continuar — cierra el modal y deja el sistema limpio
  document.getElementById('btn-cerrar-exito').onclick = () => {
    overlay.style.display = 'none'
  }
}

async function confirmarVenta() {
  if (ventaEnProceso) return
  ventaEnProceso = true
  try {
    // Validar PIN si el vendedor es diferente al cajero logueado
    const selVendCheck = document.getElementById('confirm-vendedor-select')
    if (selVendCheck && parseInt(selVendCheck.value) !== USUARIO.id && !pinVendedorVerificado) {
      ventaEnProceso = false
      const msgPin = document.getElementById('confirm-pin-msg')
      if (msgPin) { msgPin.textContent = 'Debes verificar el PIN del vendedor primero'; msgPin.style.color = '#ff6b6b' }
      document.getElementById('confirm-pin-input')?.focus()
      return
    }

    const total    = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)
    const detalles = carrito.map(item => ({
      productoId:     parseInt(item.id),
      cantidad:       parseInt(item.cantidad),
      precioUnitario: parseFloat(item.precio),
      subtotal:       parseFloat((parseFloat(item.precio) * parseInt(item.cantidad)).toFixed(2))
    }))

    // Leer vendedor, descuento y empleado del modal
    const selVend            = document.getElementById('confirm-vendedor-select')
    const vendId             = selVend ? parseInt(selVend.value) : USUARIO.id
    const { pct, esEmpleado } = getPctEfectivo()
    const selEmpVenta        = document.getElementById('confirm-empleado-select')
    const empleadoId         = esEmpleado && selEmpVenta?.value ? parseInt(selEmpVenta.value) : null
    const descAmt            = parseFloat((total * (pct / 100)).toFixed(2))
    const totalFinal         = parseFloat((total - descAmt).toFixed(2))

    // Guardar para próxima vez
    vendedorSeleccionado = selVend ? { id: vendId, nombre: selVend.options[selVend.selectedIndex]?.text } : null
    descuentoManual      = pct

    // Validar crédito disponible si es venta a crédito
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

    const payload = {
      sucursalId:  turnoActivo.sucursalId,
      usuarioId:   vendId,
      turnoId:     turnoActivo.id,
      clienteId:   clienteSeleccionado?.id || null,
      empleadoId:  empleadoId,              // null si no es venta a empleado
      metodoPago:  esCredito ? 'CREDITO_CLIENTE' : metodoPagoSeleccionado,
      subtotal:    parseFloat(total.toFixed(2)),
      descuento:   descAmt,
      total:       totalFinal,
      esCredito,
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

    // Cerrar modal de confirmación antes de mostrar éxito
    modalConfirmacion.style.display = 'none'

    // Mostrar modal de éxito en lugar del alert genérico
    mostrarModalExito(venta.data, totalFinal)

    // Resetear estado
    carrito             = []
    clienteSeleccionado = null
    montoRecibido.value = ''
    clienteNombre.value = ''
    productoCache.clear()
    searchProductos.value = ''

    const badge = document.getElementById('cliente-seleccionado-badge')
    if (badge) badge.style.display = 'none'

    // Resetear método de pago
    metodoPagoSeleccionado = null
    document.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'))
    if (montoEfectivoControl) montoEfectivoControl.style.display = 'none'

    cerrarDropdownClientes()
    mostrarEstadoInicial()
    actualizarCarrito()

  } catch (err) {
    console.error('❌ Error:', err)

    if (err.sinStock && err.sinStock.length > 0) {
      // Construir mensaje detallado con todos los productos sin stock
      const lineas = err.sinStock.map(p =>
        `• ${p.nombre}: necesitas ${p.solicitados}, hay ${p.disponibles}`
      ).join('<br>')
      mostrarToastDetalle('Stock insuficiente', lineas)
    } else {
      mostrarToast(err.message, 'error')
    }

    // Solo en error: reactivar botón para que el cajero pueda corregir
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
      cantidad:       parseInt(item.cantidad),
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

    payload.items.forEach(item => {
      carrito.push({ id: item.id, nombre: item.nombre, precio: parseFloat(item.precio), cantidad: parseInt(item.cantidad) || 1 })
      productoCache.set(item.id, { id: item.id, nombre: item.nombre, precioBase: item.precio, stock: null })
    })

    if (payload.clienteId && payload.clienteNombre) {
      clienteSeleccionado = { id: payload.clienteId, nombre: payload.clienteNombre }
      if (clienteNombre) clienteNombre.value = payload.clienteNombre
      // Mostrar badge
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

  // Búsqueda de productos
  searchProductos.addEventListener('input', e => buscarProductos(e.target.value))

  // Métodos de pago
  metodosPayButtons.forEach(btn => {
    btn.addEventListener('click', e => {
      metodosPayButtons.forEach(b => b.classList.remove('active'))
      e.target.closest('.metodo-btn').classList.add('active')
      metodoPagoSeleccionado = e.target.closest('.metodo-btn').dataset.metodo
      montoEfectivoControl.style.display = metodoPagoSeleccionado === 'EFECTIVO' ? 'block' : 'none'
      // NOTA: cambioInfo eliminado — el cambio se gestiona solo en el modal de confirmación
      actualizarCarrito()
    })
  })

  montoRecibido.addEventListener('input', actualizarCarrito)

  // Venta
  btnCompletarVenta.addEventListener('click', completarVenta)
  btnLimpiarCarrito.addEventListener('click', limpiarCarrito)
  btnConfirmarVenta.addEventListener('click', confirmarVenta)
  btnCancelVenta.addEventListener('click', () => { modalConfirmacion.style.display = 'none' })
  btnModalConfirmacionClose.addEventListener('click', () => { modalConfirmacion.style.display = 'none' })

  // Descuento empleado — aplica/quita 3% automático
  document.getElementById('confirm-empleado-select')?.addEventListener('change', function() {
    const badge = document.getElementById('confirm-empleado-badge')
    if (badge) badge.style.display = this.value !== '' ? 'block' : 'none'
    // Si hay descuento manual, el empleado no afecta (getPctEfectivo lo maneja)
    actualizarResumenConDescuento()
  })

  // Descuento en modal — recalcula en tiempo real
  document.getElementById('confirm-descuento-input')?.addEventListener('input', actualizarResumenConDescuento)

  // Vendedor — pedir PIN si selecciona alguien diferente al cajero logueado
  document.getElementById('confirm-vendedor-select')?.addEventListener('change', function() {
    const vendId = parseInt(this.value)
    if (vendId !== USUARIO.id) {
      pedirPinVendedor(vendId, this)
    } else {
      ocultarPinVendedor()
    }
  })

  // Turno
  btnConfirmarAbrirTurno.addEventListener('click', abrirTurno)
  btnCancelTurno?.addEventListener('click', () => { modalAbrirTurno.style.display = 'none' })
  btnModalTurnoClose?.addEventListener('click', () => { modalAbrirTurno.style.display = 'none' })

  // Cliente rápido
  btnCancelCliente?.addEventListener('click', () => { modalClienteRapido.style.display = 'none' })
  btnModalClienteClose?.addEventListener('click', () => { modalClienteRapido.style.display = 'none' })

  // ── Selector de clientes ──────────────────────────────────────

  // Botón chevron — abre/cierra lista completa
  document.getElementById('btn-lista-clientes')
    ?.addEventListener('click', abrirDropdownClientes)

  // Input de texto — filtra mientras escribe (si el dropdown ya está abierto)
  clienteNombre?.addEventListener('input', e => {
    const dd = document.getElementById('dropdown-clientes-pos')
    if (dd && dd.style.display !== 'none') {
      renderItemsDropdown(filtrarClientes(e.target.value))
    }
  })

  // Foco en el input — abre el dropdown automáticamente
  clienteNombre?.addEventListener('focus', () => {
    abrirDropdownClientes()
  })

  // Clic fuera — cerrar dropdown
  document.addEventListener('click', e => {
    if (!e.target.closest('.cliente-input-wrap') &&
        !e.target.closest('#dropdown-clientes-pos')) {
      cerrarDropdownClientes()
    }
  })

  // Botón × del badge — quitar cliente seleccionado
  document.getElementById('btn-limpiar-cliente')
    ?.addEventListener('click', () => {
      seleccionarClientePOS(null, '')
    })

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      cerrarDropdownClientes()
      modalConfirmacion.style.display     = 'none'
      modalClienteRapido.style.display    = 'none'
      modalAbrirTurno.style.display       = 'none'
      document.getElementById('modal-cotizar')?.classList.remove('open')
      const exitoOverlay = document.getElementById('modal-venta-exitosa')
      if (exitoOverlay) exitoOverlay.style.display = 'none'
    }
  })

  console.log('✅ Event listeners configurados')
}

console.log('✅ punto-venta.js completamente cargado')