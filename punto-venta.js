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
const cambioInfo               = document.getElementById('cambio-info')
const cambioValor              = document.getElementById('cambio-valor')
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
}

// Compatibilidad con código antiguo que llama seleccionarCliente
function seleccionarCliente(id, nombre) {
  seleccionarClientePOS(id, nombre, '')
}

function limpiarCliente() {
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

  if (metodoPagoSeleccionado === 'EFECTIVO' && montoRecibido.value) {
    const monto  = parseFloat(montoRecibido.value) || 0
    const cambio = monto - total
    if (cambio >= 0) {
      cambioValor.textContent = `$${cambio.toFixed(2)}`
      cambioInfo.style.display = 'block'
    } else {
      cambioInfo.style.display = 'none'
    }
  }

  btnCompletarVenta.disabled = !(carrito.length > 0 && turnoActivo && metodoPagoSeleccionado)
  const btnCotizar = document.getElementById('btn-cotizar-carrito')
  if (btnCotizar) btnCotizar.disabled = carrito.length === 0
}

function limpiarCarrito() {
  if (carrito.length === 0) return
  if (!confirm('¿Limpiar todo el carrito?')) return

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
  if (cambioInfo) cambioInfo.style.display = 'none'

  cerrarDropdownClientes()
  mostrarEstadoInicial()
  actualizarCarrito()
}

// ══════════════════════════════════════════════════════════════════
//  VENTA
// ══════════════════════════════════════════════════════════════════

async function completarVenta() {
  if (carrito.length === 0)    { alert('❌ El carrito está vacío'); return }
  if (!turnoActivo)            { alert('❌ No hay turno abierto'); return }
  if (!metodoPagoSeleccionado) { 
    // Resaltar visualmente los botones de método
    const metodos = document.querySelector('.metodos-pago')
    if (metodos) {
      metodos.style.outline = '2px solid #e8710a'
      metodos.style.borderRadius = '8px'
      setTimeout(() => { metodos.style.outline = ''; metodos.style.borderRadius = '' }, 1500)
    }
    alert('⚠️ Selecciona el método de pago antes de continuar')
    return
  }

  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)
  if (metodoPagoSeleccionado === 'EFECTIVO') {
    const monto = parseFloat(montoRecibido.value) || 0
    if (monto < total) { alert(`❌ Monto insuficiente. Total: $${total.toFixed(2)}`); return }
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

  // Cambio (solo efectivo)
  const rowCambio = document.getElementById('confirm-row-cambio')
  if (rowCambio) {
    if (metodoPagoSeleccionado === 'EFECTIVO') {
      const monto  = parseFloat(montoRecibido.value) || 0
      const cambio = monto - total
      if (monto > 0 && cambio >= 0) {
        document.getElementById('confirmacion-cambio').textContent = `$${cambio.toFixed(2)}`
        rowCambio.style.display = 'flex'
      } else {
        rowCambio.style.display = 'none'
      }
    } else {
      rowCambio.style.display = 'none'
    }
  }

  // Mostrar modal con el nuevo estilo (usa display flex)
  modalConfirmacion.style.display = 'flex'
}

async function confirmarVenta() {
  if (ventaEnProceso) return
  ventaEnProceso = true
  try {
    const total    = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)
    const detalles = carrito.map(item => ({
      productoId:     parseInt(item.id),
      cantidad:       parseInt(item.cantidad),
      precioUnitario: parseFloat(item.precio),
      subtotal:       parseFloat((parseFloat(item.precio) * parseInt(item.cantidad)).toFixed(2))
    }))

    const payload = {
      sucursalId:  turnoActivo.sucursalId,
      usuarioId:   turnoActivo.usuarioId,
      turnoId:     turnoActivo.id,
      clienteId:   clienteSeleccionado?.id || null,
      metodoPago:  metodoPagoSeleccionado,
      subtotal:    parseFloat(total.toFixed(2)),
      descuento:   0,
      total:       parseFloat(total.toFixed(2)),
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
      const error = await response.json()
      throw new Error(error.error || 'Error procesando venta')
    }

    const venta = await response.json()
    console.log('✅ Venta completada:', venta.data.folio)
    alert(`✅ Venta completada\nFolio: ${venta.data.folio}\nTotal: $${venta.data.total}`)

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
    if (cambioInfo) cambioInfo.style.display = 'none'

    cerrarDropdownClientes()
    mostrarEstadoInicial()
    actualizarCarrito()
    modalConfirmacion.style.display = 'none'

  } catch (err) {
    console.error('❌ Error:', err)
    alert('❌ ' + err.message)
  } finally {
    ventaEnProceso              = false
    btnConfirmarVenta.disabled  = false
    btnConfirmarVenta.innerHTML = '✓ Confirmar'
  }
}

// ══════════════════════════════════════════════════════════════════
//  COTIZACIÓN DESDE POS
// ══════════════════════════════════════════════════════════════════

function abrirModalCotizar() {
  if (carrito.length === 0) { alert('❌ El carrito está vacío'); return }
  const venceInput = document.getElementById('cotizar-vence')
  const notasInput = document.getElementById('cotizar-notas')
  const errorDiv   = document.getElementById('cotizar-error')
  if (venceInput)  venceInput.value = ''
  if (notasInput)  notasInput.value = ''
  if (errorDiv)    { errorDiv.style.display = 'none'; errorDiv.textContent = '' }
  document.getElementById('modal-cotizar').style.display = 'flex'
}

function cerrarModalCotizar() {
  document.getElementById('modal-cotizar').style.display = 'none'
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
    else alert('❌ ' + err.message)
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
      if (metodoPagoSeleccionado !== 'EFECTIVO') cambioInfo.style.display = 'none'
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
      document.getElementById('modal-cotizar')?.style &&
        (document.getElementById('modal-cotizar').style.display = 'none')
    }
  })

  console.log('✅ Event listeners configurados')
}

console.log('✅ punto-venta.js completamente cargado')