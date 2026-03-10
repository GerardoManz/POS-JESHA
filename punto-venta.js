// ══════════════════════════════════════════════════════════════════
//  PUNTO DE VENTA — JAVASCRIPT
//  
//  Patrón: Vanilla JS + Fetch API
//  Estilos: Respeta dashboard.css existente
//  Auth: Bearer token en localStorage
// ══════════════════════════════════════════════════════════════════

// ── OBTENER TOKEN ──
const TOKEN = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')

// ── PROTECCIÓN CONTRA BUCLES ──
if (!TOKEN && !window.location.pathname.includes('login.html')) {
  console.log('❌ No hay token, redirigiendo a login...')
  localStorage.setItem('redirect_after_login', 'punto-venta.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

// ── API ──
const API_URL = 'http://localhost:3000'

console.log('✅ Punto-venta.js cargado correctamente')
console.log('✅ Usuario:', USUARIO.nombre || 'Anónimo')

// ══════════════════════════════════════════════════════════════════
//  DOM ELEMENTS
// ══════════════════════════════════════════════════════════════════

const searchProductos = document.getElementById('search-productos')
const productosGrid = document.getElementById('productos-grid')
const carritoTbody = document.getElementById('carrito-tbody')
const itemsCount = document.getElementById('items-count')
const clienteNombre = document.getElementById('cliente-nombre')
const metodosPayButtons = document.querySelectorAll('.metodo-btn')
const montoRecibido = document.getElementById('monto-recibido')
const montoEfectivoControl = document.getElementById('monto-efectivo-control')
const cambioInfo = document.getElementById('cambio-info')
const cambioValor = document.getElementById('cambio-valor')

// ── RESUMEN ──
const resumenTotal = document.getElementById('resumen-total')

// ── BOTONES ──
const btnCompletarVenta = document.getElementById('btn-completar-venta')
const btnLimpiarCarrito = document.getElementById('btn-limpiar-carrito')

// ── MODALES ──
const modalClienteRapido = document.getElementById('modal-cliente-rapido')
const modalConfirmacion = document.getElementById('modal-confirmacion')
const clienteRapidoForm = document.getElementById('cliente-rapido-form')
const btnCancelCliente = document.getElementById('btn-cancel-cliente')
const btnModalClienteClose = document.getElementById('modal-cliente-close')
const btnCancelVenta = document.getElementById('btn-cancelar-venta')
const btnConfirmarVenta = document.getElementById('btn-confirmar-venta')
const btnModalConfirmacionClose = document.getElementById('modal-confirmacion-close')

// ── FECHA ACTUAL ──
const fechaActual = document.getElementById('fecha-actual')
const turnoStatus = document.getElementById('turno-status')

if (fechaActual) {
  const fecha = new Date()
  fechaActual.textContent = fecha.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

// ══════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════════

let carrito = []
let turnoActivo = null
let metodoPagoSeleccionado = 'EFECTIVO'
let clienteSeleccionado = null
let ventaEnProceso = false

// ══════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('📄 DOMContentLoaded: Punto de Venta')
  
  // 1. Verificar turno
  await verificarTurno()
  
  // 2. Cargar productos iniciales
  await cargarProductosIniciales()
  
  // 3. Configurar event listeners
  configurarEventListeners()
  
  console.log('✅ Punto de Venta listo')
})

// ══════════════════════════════════════════════════════════════════
//  FUNCIONES PRINCIPALES
// ══════════════════════════════════════════════════════════════════

/**
 * Verifica si hay turno abierto
 */
async function verificarTurno() {
  try {
    const response = await fetch(`${API_URL}/api/turnos-caja/activo`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })

    if (response.ok) {
      const data = await response.json()
      turnoActivo = data.data
      turnoStatus.innerHTML = '✓ Turno abierto'
      turnoStatus.className = 'turno-badge turno-ok'
      btnCompletarVenta.disabled = false
    } else {
      turnoActivo = null
      turnoStatus.innerHTML = '⚠️ Sin turno abierto'
      turnoStatus.className = 'turno-badge turno-error'
      btnCompletarVenta.disabled = true
    }
  } catch (err) {
    console.error('❌ Error verificando turno:', err)
    turnoStatus.innerHTML = '❌ Error'
    btnCompletarVenta.disabled = true
  }
}

/**
 * Carga primeros 20 productos al iniciar
 */
async function cargarProductosIniciales() {
  try {
    const response = await fetch(
      `${API_URL}/api/productos?skip=0&take=20&enStock=true`,
      { headers: { 'Authorization': `Bearer ${TOKEN}` } }
    )

    if (!response.ok) throw new Error('Error cargando productos')

    const data = await response.json()
    mostrarProductos(data.data || [])
  } catch (err) {
    console.error('❌ Error cargando productos:', err)
    productosGrid.innerHTML = `
      <div class="error-message">
        Error cargando productos. Intenta de nuevo.
      </div>
    `
  }
}

/**
 * Busca productos mientras escribe (debounce)
 */
let searchTimeout
async function buscarProductos(query) {
  // Limpiar timeout anterior
  if (searchTimeout) clearTimeout(searchTimeout)

  // Si vacío, cargar iniciales
  if (query.trim().length < 2) {
    await cargarProductosIniciales()
    return
  }

  // Mostrar indicador
  const searchIndicator = document.getElementById('search-indicator')
  searchIndicator.style.opacity = '1'

  // Nuevo timeout (debounce 300ms)
  searchTimeout = setTimeout(async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/productos/search?q=${encodeURIComponent(query)}`,
        { headers: { 'Authorization': `Bearer ${TOKEN}` } }
      )

      if (!response.ok) throw new Error('Error en búsqueda')

      const data = await response.json()
      mostrarProductos(data.data || [])
      searchIndicator.style.opacity = '0'
    } catch (err) {
      console.error('❌ Error buscando:', err)
      searchIndicator.style.opacity = '0'
    }
  }, 300)
}

/**
 * Renderiza grid de productos
 */
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
    <div class="tarjeta-producto" onclick="agregarAlCarrito(${p.id}, '${p.nombre}', ${p.precioBase})">
      ${p.imagenUrl ? `<img src="${p.imagenUrl}" alt="${p.nombre}" class="producto-imagen" />` : ''}
      <div class="producto-info">
        <h4>${p.nombre}</h4>
        <p class="producto-codigo">${p.codigoInterno}</p>
        <p class="producto-precio">$${p.precioBase.toFixed(2)}</p>
        <p class="producto-stock ${p.stock > 0 ? 'ok' : 'agotado'}">
          ${p.stock > 0 ? `Stock: ${p.stock}` : 'Agotado'}
        </p>
      </div>
    </div>
  `).join('')
}

/**
 * Agrega producto al carrito
 */
function agregarAlCarrito(productoId, nombre, precio) {
  // Buscar si ya existe
  const existe = carrito.find(item => item.id === productoId)

  if (existe) {
    existe.cantidad += 1
  } else {
    carrito.push({
      id: productoId,
      nombre,
      precio,
      cantidad: 1
    })
  }

  actualizarCarrito()
}

/**
 * Elimina producto del carrito
 */
function eliminarDelCarrito(productoId) {
  carrito = carrito.filter(item => item.id !== productoId)
  actualizarCarrito()
}

/**
 * Actualiza cantidad en carrito
 */
function actualizarCantidad(productoId, cantidad) {
  const item = carrito.find(i => i.id === productoId)
  if (item) {
    if (cantidad <= 0) {
      eliminarDelCarrito(productoId)
    } else {
      item.cantidad = cantidad
      actualizarCarrito()
    }
  }
}

/**
 * Recalcula carrito y actualiza UI
 * NOTA: Los precios YA incluyen IVA, no se calcula adicional
 */
function actualizarCarrito() {
  // Actualizar tabla
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
            style="background: none; border: none; cursor: pointer; color: #ff6b6b; font-size: 18px;"
          >
            ❌
          </button>
        </td>
      </tr>
    `).join('')
  }

  // Actualizar contador
  itemsCount.textContent = `(${carrito.length})`

  // Calcular total (SIN IVA adicional - los precios ya lo incluyen)
  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

  resumenSubtotal.textContent = `$${total.toFixed(2)}`
  resumenIva.textContent = `$0.00`  // IVA ya incluido en precios
  resumenTotal.textContent = `$${total.toFixed(2)}`

  // Calcular cambio si es efectivo
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

  // Habilitar/deshabilitar botón completar
  if (carrito.length > 0 && turnoActivo) {
    btnCompletarVenta.disabled = false
  } else {
    btnCompletarVenta.disabled = true
  }
}

/**
 * Completa la venta (envía al backend)
 */
async function completarVenta() {
  // Validaciones
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

  // Calcular total (SIN IVA adicional)
  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

  // Validación para efectivo
  if (metodoPagoSeleccionado === 'EFECTIVO') {
    const monto = parseFloat(montoRecibido.value) || 0

    if (monto < total) {
      alert(`❌ Monto insuficiente. Total: $${total.toFixed(2)}`)
      return
    }
  }

  // Mostrar confirmación
  mostrarModalConfirmacion()
}

/**
 * Muestra modal de confirmación
 */
function mostrarModalConfirmacion() {
  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

  document.getElementById('confirmacion-total').textContent = `$${total.toFixed(2)}`
  document.getElementById('confirmacion-metodo').textContent = metodoPagoSeleccionado

  modalConfirmacion.style.display = 'block'
}

/**
 * Confirma y envía venta al backend
 */
async function confirmarVenta() {
  if (ventaEnProceso) return
  ventaEnProceso = true

  try {
    // Calcular total (SIN IVA adicional - precios ya lo incluyen)
    const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

    const detalles = carrito.map(item => ({
      productoId: item.id,
      cantidad: item.cantidad,
      precioUnitario: item.precio,
      subtotal: parseFloat((item.precio * item.cantidad).toFixed(2))
    }))

    const payload = {
      sucursalId: turnoActivo.sucursalId,
      usuarioId: USUARIO.id,
      turnoId: turnoActivo.id,
      clienteId: clienteSeleccionado?.id || null,
      metodoPago: metodoPagoSeleccionado,
      subtotal: total,  // Sin IVA adicional
      descuento: 0,
      total: total,     // Total es el mismo que subtotal
      detalles
    }

    // Mostrar loading
    btnConfirmarVenta.disabled = true
    btnConfirmarVenta.innerHTML = '⟳ Procesando...'

    const response = await fetch(`${API_URL}/api/ventas`, {
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

    // ✅ ÉXITO
    console.log('✅ Venta completada:', venta.data.folio)
    
    // Mostrar éxito
    alert(`✅ Venta completada\nFolio: ${venta.data.folio}\nTotal: $${venta.data.total}`)

    // Limpiar
    carrito = []
    clienteSeleccionado = null
    montoRecibido.value = ''
    clienteNombre.value = ''
    actualizarCarrito()

    // Cerrar modales
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

/**
 * Limpia el carrito
 */
function limpiarCarrito() {
  if (carrito.length === 0) return

  if (confirm('¿Limpiar todo el carrito?')) {
    carrito = []
    clienteSeleccionado = null
    montoRecibido.value = ''
    clienteNombre.value = ''
    actualizarCarrito()
  }
}

// ══════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════════════════

function configurarEventListeners() {
  // Búsqueda
  searchProductos.addEventListener('input', (e) => {
    buscarProductos(e.target.value)
  })

  // Método de pago
  metodosPayButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      metodosPayButtons.forEach(b => b.classList.remove('active'))
      e.target.closest('.metodo-btn').classList.add('active')
      metodoPagoSeleccionado = e.target.closest('.metodo-btn').dataset.metodo

      // Mostrar/ocultar monto efectivo
      if (metodoPagoSeleccionado === 'EFECTIVO') {
        montoEfectivoControl.style.display = 'block'
      } else {
        montoEfectivoControl.style.display = 'none'
        cambioInfo.style.display = 'none'
      }

      actualizarCarrito()
    })
  })

  // Monto recibido
  montoRecibido.addEventListener('input', () => {
    actualizarCarrito()
  })

  // Botones de carrito
  btnCompletarVenta.addEventListener('click', completarVenta)
  btnLimpiarCarrito.addEventListener('click', limpiarCarrito)

  // Confirmación
  btnConfirmarVenta.addEventListener('click', confirmarVenta)
  btnCancelVenta.addEventListener('click', () => {
    modalConfirmacion.style.display = 'none'
  })
  btnModalConfirmacionClose.addEventListener('click', () => {
    modalConfirmacion.style.display = 'none'
  })

  // Cliente rápido
  btnCancelCliente.addEventListener('click', () => {
    modalClienteRapido.style.display = 'none'
  })
  btnModalClienteClose.addEventListener('click', () => {
    modalClienteRapido.style.display = 'none'
  })

  // Cerrar modales con ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modalConfirmacion.style.display = 'none'
      modalClienteRapido.style.display = 'none'
    }
  })

  console.log('✅ Event listeners configurados')
}

// ── Mostrar carrito al cargar ──
actualizarCarrito()

console.log('✅ punto-venta.js completamente cargado')