// ══════════════════════════════════════════════════════════════════
//  CLIENTES — JAVASCRIPT (VERSIÓN CORREGIDA)
//  
//  CAMBIOS:
//  - Eliminada búsqueda de #logout-btn (sidebar.js lo maneja)
//  - Eliminada duplicación de cargarSidebar()
// ══════════════════════════════════════════════════════════════════

// ── OBTENER TOKEN ──
const TOKEN = localStorage.getItem('jesha_token')

// ── PROTECCIÓN CONTRA BUCLES ──
// Solo redirige si NO está en login.html
if (!TOKEN && !window.location.pathname.includes('login.html')) {
  console.log('❌ No hay token, redirigiendo a login...')
  localStorage.setItem('redirect_after_login', 'clientes.html')
  window.location.href = 'login.html'
  // Detener ejecución
  throw new Error('Sin autenticación')
}

// Si llegó aquí sin token, detener
if (!TOKEN) {
  console.error('❌ ERROR: Sin token y en clientes.html')
  throw new Error('Sin autenticación')
}

// ── API ──
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

console.log('✅ Clientes.js cargado correctamente')
console.log('✅ Token encontrado:', TOKEN.substring(0, 20) + '...')

// ══════════════════════════════════════════════════════════════════
//  DOM ELEMENTS
// ══════════════════════════════════════════════════════════════════

const searchInput = document.getElementById('search-input')
const btnNuevoCliente = document.getElementById('btn-nuevo-cliente')
const clientesTbody = document.getElementById('clientes-tbody')

const modalCliente = document.getElementById('modal-cliente')
const modalHistorial = document.getElementById('modal-historial')
const clienteForm = document.getElementById('cliente-form')
const clienteTipoSelect = document.getElementById('cliente-tipo')
const camposFiscales = document.getElementById('campos-fiscales')
const campoCredito = document.getElementById('campo-credito')
const clienteError = document.getElementById('cliente-error')

const modalCloseBtn = document.getElementById('modal-close-btn')
const historialCloseBtn = document.getElementById('historial-close-btn')
const btnCancel = document.getElementById('btn-cancel')

// ── FECHA ACTUAL ──
const fecha = new Date()
const fechaActual = document.getElementById('fecha-actual')
if (fechaActual) {
  fechaActual.textContent = fecha.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

// ❌ ELIMINADO: Búsqueda de #logout-btn
// El logout ahora es manejado por sidebar.js después de cargar sidebar.html
// NO lo buscamos aquí para evitar race condition
// const logoutButton = document.getElementById('logout-btn')
// if (logoutButton) { ... }

// ── VARIABLES GLOBALES ──
let clienteActual = null
let clientesLista = []

// ══════════════════════════════════════════════════════════════════
//  FUNCIONES PRINCIPALES
// ══════════════════════════════════════════════════════════════════

async function cargarClientes() {
  try {
    if (!clientesTbody) return console.error('❌ clientesTbody no encontrado')
    
    clientesTbody.innerHTML = `
      <tr class="loading-row">
        <td colspan="7" style="text-align: center; padding: 40px;">
          <div class="spinner"></div>
          <p style="margin-top: 12px; color: var(--muted);">Cargando clientes...</p>
        </td>
      </tr>
    `

    const params = new URLSearchParams()
    if (searchInput && searchInput.value) {
      params.append('buscar', searchInput.value)
    }

    const response = await fetch(`${API_URL}/clientes?${params}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(response.status)) return

    console.log('📡 Response status:', response.status)

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`)
    }

    clientesLista = await response.json()
    console.log('✅ Clientes cargados:', clientesLista.length)
    renderizarTabla()

  } catch (error) {
    console.error('❌ Error al cargar clientes:', error)
    if (clientesTbody) {
      clientesTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: #ff9999; padding: 20px;">
            Error: ${error.message}
          </td>
        </tr>
      `
    }
  }
}

function renderizarTabla() {
  if (!clientesTbody) return

  if (clientesLista.length === 0) {
    clientesTbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px; color: var(--muted);">
          No hay clientes registrados
        </td>
      </tr>
    `
    return
  }

  clientesTbody.innerHTML = clientesLista.map(cliente => {
    const creditoDisponible = (cliente.limiteCredito || 0) - (cliente.saldoCredito || 0)
    const apodo = cliente.apodo ? ` (${cliente.apodo})` : ''
    const tipoClass = cliente.tipo ? cliente.tipo.toLowerCase() : 'general'
    const estadoClass = cliente.activo ? 'activo' : 'inactivo'
    
    return `
      <tr>
        <td><strong>${cliente.nombre || '-'}</strong>${apodo}</td>
        <td>${cliente.rfc || '-'}</td>
        <td>${cliente.telefono ? cliente.telefono : cliente.email || '-'}</td>
        <td><span class="tipo-badge ${tipoClass}">${cliente.tipo || 'GENERAL'}</span></td>
        <td>$${creditoDisponible.toFixed(2)}</td>
        <td><span class="estado-badge ${estadoClass}">${cliente.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <div class="actions-cell">
            <button class="btn-icon" onclick="editarCliente(${cliente.id})" title="Editar">✏️</button>
            <button class="btn-icon" onclick="verHistorial(${cliente.id})" title="Historial">📊</button>
            <button class="btn-icon ${cliente.activo ? '' : 'danger'}" onclick="toggleEstadoCliente(${cliente.id}, ${!cliente.activo})" title="${cliente.activo ? 'Desactivar' : 'Activar'}">
              ${cliente.activo ? '✔️' : '❌'}
            </button>
          </div>
        </td>
      </tr>
    `
  }).join('')
}

function abrirModalNuevoCliente() {
  clienteActual = null
  if (clienteForm) clienteForm.reset()
  const titleEl = document.getElementById('modal-title')
  if (titleEl) titleEl.textContent = 'Nuevo Cliente'
  if (clienteTipoSelect) clienteTipoSelect.value = ''
  if (camposFiscales) camposFiscales.style.display = 'none'
  if (campoCredito) campoCredito.style.display = 'none'
  if (clienteError) clienteError.classList.remove('show')
  if (modalCliente) modalCliente.classList.add('active')
}

window.editarCliente = function(clienteId) {
  clienteActual = clientesLista.find(c => c.id === clienteId)
  if (!clienteActual) return

  document.getElementById('modal-title').textContent = `Editar Cliente`
  document.getElementById('cliente-nombre').value = clienteActual.nombre || ''
  document.getElementById('cliente-apodo').value = clienteActual.apodo || ''
  document.getElementById('cliente-tipo').value = clienteActual.tipo || ''
  document.getElementById('cliente-telefono').value = clienteActual.telefono || ''
  document.getElementById('cliente-email').value = clienteActual.email || ''
  document.getElementById('cliente-rfc').value = clienteActual.rfc || ''
  document.getElementById('cliente-razonSocial').value = clienteActual.razonSocial || ''
  document.getElementById('cliente-codigoPostalFiscal').value = clienteActual.codigoPostalFiscal || ''
  document.getElementById('cliente-regimenFiscal').value = clienteActual.regimenFiscal || ''
  document.getElementById('cliente-usoCfdi').value = clienteActual.usoCfdi || ''
  document.getElementById('cliente-limiteCredito').value = clienteActual.limiteCredito || 0
  document.getElementById('cliente-notas').value = clienteActual.notas || ''

  actualizarCamposDinamicos()
  if (clienteError) clienteError.classList.remove('show')
  if (modalCliente) modalCliente.classList.add('active')
}

function actualizarCamposDinamicos() {
  const tipo = document.getElementById('cliente-tipo').value
  
  if (camposFiscales) {
    camposFiscales.style.display = tipo === 'FISCAL' ? 'block' : 'none'
  }
  if (campoCredito) {
    campoCredito.style.display = (tipo === 'REGISTRADO' || tipo === 'FISCAL') ? 'block' : 'none'
  }
  
  const razonSocialInput = document.getElementById('cliente-razonSocial')
  if (razonSocialInput) {
    razonSocialInput.required = tipo === 'FISCAL'
  }
}

function cerrarModalCliente() {
  if (modalCliente) modalCliente.classList.remove('active')
  clienteActual = null
}

window.verHistorial = async function(clienteId) {
  const cliente = clientesLista.find(c => c.id === clienteId)
  if (!cliente) return

  const historialTitle = document.getElementById('historial-title')
  if (historialTitle) {
    historialTitle.textContent = `Historial: ${cliente.nombre}`
  }
  
  await cargarVentas(clienteId)
  await cargarAbonos(clienteId)

  if (modalHistorial) modalHistorial.classList.add('active')
}

async function cargarVentas(clienteId) {
  try {
    const response = await fetch(`${API_URL}/clientes/${clienteId}/ventas`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(response.status)) return

    const ventas = await response.json()
    const tbody = document.getElementById('ventas-tbody')

    if (!tbody) return

    if (!Array.isArray(ventas) || ventas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--muted);">Sin ventas registradas</td></tr>'
      return
    }

    tbody.innerHTML = ventas.map(venta => `
      <tr>
        <td>${venta.folio || '-'}</td>
        <td>${new Date(venta.creadaEn).toLocaleDateString('es-MX')}</td>
        <td>$${parseFloat(venta.total || 0).toFixed(2)}</td>
        <td>${{ EFECTIVO:'💵 Efectivo', CREDITO:'💳 Tarjeta', DEBITO:'💳 Tarjeta', TRANSFERENCIA:'🔄 Transferencia', CREDITO_CLIENTE:'🏦 Crédito cliente' }[venta.metodoPago] || venta.metodoPago || '—'}</td>
      </tr>
    `).join('')
  } catch (error) {
    console.error(error)
    const tbody = document.getElementById('ventas-tbody')
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ff9999;">Error al cargar ventas</td></tr>'
    }
  }
}

async function cargarAbonos(clienteId) {
  try {
    const response = await fetch(`${API_URL}/clientes/${clienteId}/abonos`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(response.status)) return

    const abonos = await response.json()
    const tbody = document.getElementById('abonos-tbody')

    if (!tbody) return

    if (!Array.isArray(abonos) || abonos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--muted);">Sin abonos registrados</td></tr>'
      return
    }

    tbody.innerHTML = abonos.map(abono => `
      <tr>
        <td>${new Date(abono.creadoEn).toLocaleDateString('es-MX')}</td>
        <td>$${parseFloat(abono.monto || 0).toFixed(2)}</td>
        <td>${{ EFECTIVO:'💵 Efectivo', TRANSFERENCIA:'🔄 Transferencia', CREDITO:'💳 Tarjeta', CREDITO_CLIENTE:'🏦 Crédito' }[abono.metodoPago] || abono.metodoPago || '—'}</td>
        <td style="font-size:0.82rem;color:var(--muted)">${abono.bitacora?.folio || '—'}${abono.bitacora?.titulo ? ` · ${abono.bitacora.titulo}` : ''}</td>
      </tr>
    `).join('')
  } catch (error) {
    console.error(error)
    const tbody = document.getElementById('abonos-tbody')
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ff9999;">Error al cargar abonos</td></tr>'
    }
  }
}

function cerrarModalHistorial() {
  if (modalHistorial) modalHistorial.classList.remove('active')
}

window.toggleEstadoCliente = async function(clienteId, nuevoEstado) {
  try {
    const response = await fetch(`${API_URL}/clientes/${clienteId}/estado`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({ activo: nuevoEstado })
    })
    if (window.handle401 && window.handle401(response.status)) return

    if (!response.ok) throw new Error('Error al cambiar estado')

    cargarClientes()
  } catch (error) {
    console.error(error)
    jeshaToast('Error: ' + error.message, 'error')
  }
}

// ══════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════════════════

if (clienteTipoSelect) {
  clienteTipoSelect.addEventListener('change', actualizarCamposDinamicos)
}

if (clienteForm) {
  clienteForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (clienteError) clienteError.classList.remove('show')

    const datos = {
      nombre: document.getElementById('cliente-nombre').value.trim(),
      apodo: document.getElementById('cliente-apodo').value.trim() || null,
      tipo: document.getElementById('cliente-tipo').value,
      telefono: document.getElementById('cliente-telefono').value.trim() || null,
      email: document.getElementById('cliente-email').value.trim() || null,
      rfc: document.getElementById('cliente-rfc').value.trim() || null,
      razonSocial: document.getElementById('cliente-razonSocial').value.trim() || null,
      codigoPostalFiscal: document.getElementById('cliente-codigoPostalFiscal').value.trim() || null,
      regimenFiscal: document.getElementById('cliente-regimenFiscal').value || null,
      usoCfdi: document.getElementById('cliente-usoCfdi').value || null,
      limiteCredito: parseFloat(document.getElementById('cliente-limiteCredito').value) || 0,
      notas: document.getElementById('cliente-notas').value.trim() || null
    }

    try {
      const metodo = clienteActual ? 'PUT' : 'POST'
      const url = clienteActual ? `${API_URL}/clientes/${clienteActual.id}` : `${API_URL}/clientes`

      const response = await fetch(url, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`
        },
        body: JSON.stringify(datos)
      })
      if (window.handle401 && window.handle401(response.status)) return

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al guardar cliente')
      }

      cargarClientes()
      cerrarModalCliente()
    } catch (error) {
      console.error(error)
      if (clienteError) {
        clienteError.textContent = error.message
        clienteError.classList.add('show')
      }
    }
  })
}

if (btnNuevoCliente) {
  btnNuevoCliente.addEventListener('click', abrirModalNuevoCliente)
}

if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', cerrarModalCliente)
}

if (btnCancel) {
  btnCancel.addEventListener('click', cerrarModalCliente)
}

if (historialCloseBtn) {
  historialCloseBtn.addEventListener('click', cerrarModalHistorial)
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(window.searchTimeout)
    window.searchTimeout = setTimeout(cargarClientes, 300)
  })
}

document.querySelectorAll('.tab-button').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
    
    e.target.classList.add('active')
    const tabName = e.target.dataset.tab
    const tabEl = document.getElementById(`tab-${tabName}`)
    if (tabEl) tabEl.classList.add('active')
  })
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarModalCliente()
    cerrarModalHistorial()
  }
})

// ── INICIAR ──
console.log('🚀 Inicializando módulo de clientes...')
cargarClientes()