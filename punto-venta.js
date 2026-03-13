// ══════════════════════════════════════════════════════════════════
//  PUNTO DE VENTA — JAVASCRIPT
// ══════════════════════════════════════════════════════════════════

const TOKEN = localStorage.getItem('jesha_token')
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

const searchProductos      = document.getElementById('search-productos')
const productosGrid        = document.getElementById('productos-grid')
const carritoTbody         = document.getElementById('carrito-tbody')
const itemsCount           = document.getElementById('items-count')
const clienteNombre        = document.getElementById('cliente-nombre')
const metodosPayButtons    = document.querySelectorAll('.metodo-btn')
const montoRecibido        = document.getElementById('monto-recibido')
const montoEfectivoControl = document.getElementById('monto-efectivo-control')
const cambioInfo           = document.getElementById('cambio-info')
const cambioValor          = document.getElementById('cambio-valor')
const resumenTotal         = document.getElementById('resumen-total')
const btnCompletarVenta    = document.getElementById('btn-completar-venta')
const btnLimpiarCarrito    = document.getElementById('btn-limpiar-carrito')
const modalClienteRapido   = document.getElementById('modal-cliente-rapido')
const modalConfirmacion    = document.getElementById('modal-confirmacion')
const modalAbrirTurno      = document.getElementById('modal-abrir-turno')
const btnConfirmarAbrirTurno = document.getElementById('btn-confirmar-abrir-turno')
const btnCancelTurno       = document.getElementById('btn-cancel-turno')
const btnModalTurnoClose   = document.getElementById('modal-turno-close')
const montoInicialTurno    = document.getElementById('monto-inicial-turno')
const turnoError           = document.getElementById('turno-error')
const clienteRapidoForm    = document.getElementById('cliente-rapido-form')
const btnCancelCliente     = document.getElementById('btn-cancel-cliente')
const btnModalClienteClose = document.getElementById('modal-cliente-close')
const btnCancelVenta       = document.getElementById('btn-cancelar-venta')
const btnConfirmarVenta    = document.getElementById('btn-confirmar-venta')
const btnModalConfirmacionClose = document.getElementById('modal-confirmacion-close')
const fechaActual          = document.getElementById('fecha-actual')
const turnoStatus          = document.getElementById('turno-status')

if (fechaActual) {
  const fecha = new Date()
  fechaActual.textContent = fecha.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

// ══════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════════

let carrito                 = []
let turnoActivo             = null
let metodoPagoSeleccionado  = 'EFECTIVO'
let clienteSeleccionado     = null
let ventaEnProceso          = false

// Caché de productos buscados — persiste mientras la sesión esté abierta
// Map<id, productoObj> — se llena con cada búsqueda/escaneo
const productoCache = new Map()

// Lista de clientes cargada al iniciar
let clientesLista = []

// ══════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('📄 DOMContentLoaded: Punto de Venta')
  await verificarTurno()
  await cargarClientes()
  mostrarEstadoInicial()
  configurarEventListeners()
  actualizarCarrito()
  console.log('✅ Punto de Venta listo')
})

// ══════════════════════════════════════════════════════════════════
//  FUNCIONES PRINCIPALES
// ══════════════════════════════════════════════════════════════════

async function verificarTurno() {
  try {
    const response = await fetch(`${API_URL}/turnos-caja/activo`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })

    if (response.ok) {
      const data = await response.json()
      turnoActivo = data.data
      turnoStatus.innerHTML = '✓ Turno abierto'
      turnoStatus.className = 'turno-badge turno-ok'
      turnoStatus.style.cursor = 'default'
      btnCompletarVenta.disabled = carrito.length === 0
    } else {
      turnoActivo = null
      turnoStatus.innerHTML = '⚠️ Sin turno — Abrir'
      turnoStatus.className = 'turno-badge turno-error'
      turnoStatus.style.cursor = 'pointer'
      turnoStatus.onclick = () => { modalAbrirTurno.style.display = 'block' }
      btnCompletarVenta.disabled = true
    }
  } catch (err) {
    console.error('❌ Error verificando turno:', err)
    turnoStatus.innerHTML = '❌ Error de conexión'
    turnoStatus.className = 'turno-badge turno-error'
    btnCompletarVenta.disabled = true
  }
}

// ══════════════════════════════════════════════════════════════════
//  CLIENTES
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
  const q = query.toLowerCase().trim()
  if (!q) return clientesLista.slice(0, 8)
  return clientesLista
    .filter(c =>
      c.nombre.toLowerCase().includes(q) ||
      (c.apodo  && c.apodo.toLowerCase().includes(q)) ||
      (c.rfc    && c.rfc.toLowerCase().includes(q)) ||
      (c.telefono && c.telefono.includes(q))
    )
    .slice(0, 8)
}

function mostrarDropdownClientes(clientes) {
  let dropdown = document.getElementById('clientes-dropdown')
  if (!dropdown) {
    dropdown = document.createElement('div')
    dropdown.id = 'clientes-dropdown'
    dropdown.style.cssText = `
      position: absolute; z-index: 200;
      background: var(--panel-bg, #1a1a1a);
      border: 1px solid var(--border-color, #444);
      border-radius: 6px; width: 100%;
      max-height: 220px; overflow-y: auto;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    `
    const wrapper = clienteNombre.parentElement
    wrapper.style.position = 'relative'
    wrapper.appendChild(dropdown)
  }

  if (clientes.length === 0) {
    dropdown.innerHTML = `
      <div style="padding:10px 14px; color:var(--muted); font-size:0.85rem;">
        Sin resultados
      </div>`
    dropdown.style.display = 'block'
    return
  }

  dropdown.innerHTML = clientes.map(c => `
    <div class="cliente-opcion"
      data-id="${c.id}"
      data-nombre="${(c.apodo || c.nombre).replace(/"/g, '&quot;')}"
      style="padding:10px 14px; cursor:pointer; border-bottom:1px solid var(--border-color,#333);
             font-size:0.9rem; transition:background 0.15s;">
      <div style="font-weight:600; color:var(--text,#fff);">
        ${c.apodo ? `${c.apodo} <span style="font-weight:400;color:var(--muted)">(${c.nombre})</span>` : c.nombre}
      </div>
      ${c.rfc ? `<div style="font-size:0.75rem; color:var(--muted);">${c.rfc}</div>` : ''}
    </div>
  `).join('')

  // Hover style
  dropdown.querySelectorAll('.cliente-opcion').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.06)')
    el.addEventListener('mouseleave', () => el.style.background = 'transparent')
    el.addEventListener('click', () => {
      const id     = parseInt(el.dataset.id)
      const nombre = el.dataset.nombre
      seleccionarCliente(id, nombre)
    })
  })

  dropdown.style.display = 'block'
}

function ocultarDropdownClientes() {
  const dropdown = document.getElementById('clientes-dropdown')
  if (dropdown) dropdown.style.display = 'none'
}

function seleccionarCliente(id, nombre) {
  clienteSeleccionado = clientesLista.find(c => c.id === id) || null
  clienteNombre.value = nombre
  ocultarDropdownClientes()
  console.log('👤 Cliente seleccionado:', nombre)
}

function limpiarCliente() {
  clienteSeleccionado = null
  // No borramos el input — el cajero puede dejarlo como texto libre
}

// ══════════════════════════════════════════════════════════════════
//  CATÁLOGO
// ══════════════════════════════════════════════════════════════════

// Muestra el grid vacío con instrucción al cajero
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

  // Si se borra la búsqueda, mostrar productos en caché (los ya buscados)
  if (q.length === 0) {
    if (productoCache.size > 0) {
      mostrarProductos(Array.from(productoCache.values()))
    } else {
      mostrarEstadoInicial()
    }
    return
  }

  // Necesita al menos 1 caracter para buscar
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

      const data = await response.json()
      const resultados = data.data || []

      // Guardar en caché todos los resultados
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
    productosGrid.innerHTML = `
      <div class="sin-resultados">
        No se encontraron productos
      </div>
    `
    return
  }

  productosGrid.innerHTML = productos.map(p => `
    <div class="tarjeta-producto" onclick="agregarAlCarrito(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${p.precioBase})">
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

function agregarAlCarrito(productoId, nombre, precio) {
  const existe = carrito.find(item => item.id === productoId)

  if (existe) {
    existe.cantidad += 1
  } else {
    carrito.push({
      id: productoId,
      nombre,
      precio: parseFloat(precio),
      cantidad: 1
    })
  }

  // Al agregar al carrito, el producto queda en caché para que
  // persista en el grid aunque el cajero borre la búsqueda
  const productoEnCache = productoCache.get(productoId)
  if (!productoEnCache) {
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
        <td colspan="4" style="text-align: center; color: var(--muted); padding: 40px;">
          Agrega productos para comenzar
        </td>
      </tr>
    `
  } else {
    carritoTbody.innerHTML = carrito.map(item => `
      <tr>
        <td>${item.nombre.substring(0, 20)}</td>
        <td style="text-align: center;">
          <input 
            type="number" 
            value="${item.cantidad}" 
            min="1" 
            style="width: 50px; padding: 4px; text-align: center;"
            onchange="actualizarCantidad(${item.id}, this.value)"
          />
        </td>
        <td style="text-align: right;">
          $${(item.precio * item.cantidad).toFixed(2)}
        </td>
        <td style="text-align: center;">
          <button 
            class="btn-eliminar" 
            onclick="eliminarDelCarrito(${item.id})"
          >❌</button>
        </td>
      </tr>
    `).join('')
  }

  itemsCount.textContent = `(${carrito.length})`

  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)
  resumenTotal.textContent = `$${total.toFixed(2)}`

  if (metodoPagoSeleccionado === 'EFECTIVO' && montoRecibido.value) {
    const monto = parseFloat(montoRecibido.value) || 0
    const cambio = monto - total
    if (cambio >= 0) {
      cambioValor.textContent = `$${cambio.toFixed(2)}`
      cambioInfo.style.display = 'block'
    } else {
      cambioInfo.style.display = 'none'
    }
  }

  btnCompletarVenta.disabled = !(carrito.length > 0 && turnoActivo)
}

async function completarVenta() {
  if (carrito.length === 0) {
    alert('❌ El carrito está vacío')
    return
  }

  if (!turnoActivo) {
    alert('❌ No hay turno abierto')
    return
  }

  if (!metodoPagoSeleccionado) {
    alert('❌ Selecciona método de pago')
    return
  }

  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

  if (metodoPagoSeleccionado === 'EFECTIVO') {
    const monto = parseFloat(montoRecibido.value) || 0
    if (monto < total) {
      alert(`❌ Monto insuficiente. Total: $${total.toFixed(2)}`)
      return
    }
  }

  mostrarModalConfirmacion()
}

function mostrarModalConfirmacion() {
  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)
  document.getElementById('confirmacion-total').textContent = `$${total.toFixed(2)}`
  document.getElementById('confirmacion-metodo').textContent = metodoPagoSeleccionado
  modalConfirmacion.style.display = 'block'
}

async function confirmarVenta() {
  if (ventaEnProceso) return
  ventaEnProceso = true

  try {
    const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

    const detalles = carrito.map(item => ({
      productoId: item.id,
      cantidad: item.cantidad,
      precioUnitario: item.precio,
      subtotal: parseFloat((item.precio * item.cantidad).toFixed(2))
    }))

    const payload = {
      sucursalId: turnoActivo.sucursalId,
      usuarioId: turnoActivo.usuarioId,
      turnoId: turnoActivo.id,
      clienteId: clienteSeleccionado?.id || null,
      metodoPago: metodoPagoSeleccionado,
      subtotal: parseFloat(total.toFixed(2)),
      descuento: 0,
      total: parseFloat(total.toFixed(2)),
      detalles
    }

    btnConfirmarVenta.disabled = true
    btnConfirmarVenta.innerHTML = '⟳ Procesando...'

    const response = await fetch(`${API_URL}/ventas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Error procesando venta')
    }

    const venta = await response.json()

    console.log('✅ Venta completada:', venta.data.folio)
    alert(`✅ Venta completada\nFolio: ${venta.data.folio}\nTotal: $${venta.data.total}`)

    carrito = []
    clienteSeleccionado = null
    montoRecibido.value = ''
    clienteNombre.value = ''
    productoCache.clear()
    searchProductos.value = ''
    clienteNombre.value = ''
    clienteSeleccionado = null
    ocultarDropdownClientes()
    mostrarEstadoInicial()
    actualizarCarrito()
    modalConfirmacion.style.display = 'none'

  } catch (err) {
    console.error('❌ Error:', err)
    alert('❌ ' + err.message)
  } finally {
    ventaEnProceso = false
    btnConfirmarVenta.disabled = false
    btnConfirmarVenta.innerHTML = '✓ Confirmar'
  }
}

function limpiarCarrito() {
  if (carrito.length === 0) return
  if (confirm('¿Limpiar todo el carrito?')) {
    carrito = []
    clienteSeleccionado = null
    montoRecibido.value = ''
    clienteNombre.value = ''
    productoCache.clear()
    searchProductos.value = ''
    clienteNombre.value = ''
    clienteSeleccionado = null
    ocultarDropdownClientes()
    mostrarEstadoInicial()
    actualizarCarrito()
  }
}

async function abrirTurno() {
  const monto = parseFloat(montoInicialTurno.value) || 0

  if (monto < 0) {
    turnoError.textContent = 'El monto no puede ser negativo'
    turnoError.style.display = 'block'
    return
  }

  btnConfirmarAbrirTurno.disabled = true
  btnConfirmarAbrirTurno.textContent = '⟳ Abriendo...'
  turnoError.style.display = 'none'

  try {
    const response = await fetch(`${API_URL}/turnos-caja/abrir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({ montoInicial: monto })
    })

    const data = await response.json()

    if (!response.ok) {
      turnoError.textContent = data.error || 'Error abriendo turno'
      turnoError.style.display = 'block'
      return
    }

    turnoActivo = data.data
    modalAbrirTurno.style.display = 'none'
    montoInicialTurno.value = '0'
    turnoStatus.innerHTML = '✓ Turno abierto'
    turnoStatus.className = 'turno-badge turno-ok'
    turnoStatus.style.cursor = 'default'
    turnoStatus.onclick = null
    btnCompletarVenta.disabled = carrito.length === 0
    console.log('✅ Turno abierto:', turnoActivo.id)

  } catch (err) {
    turnoError.textContent = 'Error de conexión'
    turnoError.style.display = 'block'
    console.error('❌ Error abriendo turno:', err)
  } finally {
    btnConfirmarAbrirTurno.disabled = false
    btnConfirmarAbrirTurno.textContent = 'Abrir Turno'
  }
}

// ══════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════════════════

function configurarEventListeners() {
  searchProductos.addEventListener('input', (e) => {
    buscarProductos(e.target.value)
  })

  metodosPayButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      metodosPayButtons.forEach(b => b.classList.remove('active'))
      e.target.closest('.metodo-btn').classList.add('active')
      metodoPagoSeleccionado = e.target.closest('.metodo-btn').dataset.metodo

      if (metodoPagoSeleccionado === 'EFECTIVO') {
        montoEfectivoControl.style.display = 'block'
      } else {
        montoEfectivoControl.style.display = 'none'
        cambioInfo.style.display = 'none'
      }

      actualizarCarrito()
    })
  })

  montoRecibido.addEventListener('input', () => {
    actualizarCarrito()
  })

  btnCompletarVenta.addEventListener('click', completarVenta)
  btnLimpiarCarrito.addEventListener('click', limpiarCarrito)
  btnConfirmarVenta.addEventListener('click', confirmarVenta)

  btnConfirmarAbrirTurno.addEventListener('click', abrirTurno)
  btnCancelTurno.addEventListener('click', () => { modalAbrirTurno.style.display = 'none' })
  btnModalTurnoClose.addEventListener('click', () => { modalAbrirTurno.style.display = 'none' })

  btnCancelVenta.addEventListener('click', () => {
    modalConfirmacion.style.display = 'none'
  })
  btnModalConfirmacionClose.addEventListener('click', () => {
    modalConfirmacion.style.display = 'none'
  })
  btnCancelCliente.addEventListener('click', () => {
    modalClienteRapido.style.display = 'none'
  })
  btnModalClienteClose.addEventListener('click', () => {
    modalClienteRapido.style.display = 'none'
  })

  // ── Autocomplete de clientes ──
  clienteNombre.addEventListener('input', (e) => {
    const q = e.target.value.trim()
    if (q.length === 0) {
      limpiarCliente()
      // Mostrar los primeros 8 clientes si el campo está vacío y tiene foco
      mostrarDropdownClientes(clientesLista.slice(0, 8))
      return
    }
    const resultados = filtrarClientes(q)
    mostrarDropdownClientes(resultados)
  })

  clienteNombre.addEventListener('focus', () => {
    const q = clienteNombre.value.trim()
    mostrarDropdownClientes(filtrarClientes(q))
  })

  clienteNombre.addEventListener('blur', () => {
    // Delay para que el click en una opción se registre antes de cerrar
    setTimeout(ocultarDropdownClientes, 200)
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ocultarDropdownClientes()
      modalConfirmacion.style.display = 'none'
      modalClienteRapido.style.display = 'none'
      modalAbrirTurno.style.display = 'none'
    }
  })

  console.log('✅ Event listeners configurados')
}

console.log('✅ punto-venta.js completamente cargado')