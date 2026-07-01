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

// ── Poblar selects SAT ──
poblarSelectSAT(document.getElementById('cliente-regimenFiscal'), CATALOGO_REGIMENES)
poblarSelectSAT(document.getElementById('cliente-usoCfdi'), CATALOGO_USOS)

// ── Filtrar usos CFDI al cambiar régimen ──
document.getElementById('cliente-regimenFiscal').addEventListener('change', function() {
  filtrarUsosPorRegimen(this, document.getElementById('cliente-usoCfdi'))
})

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

// ── HELPER: Limpiar teléfono para WhatsApp ──
function limpiarTelefono(telefono) {
  let limpio = telefono.replace(/\D/g, '')
  if (!limpio.startsWith('52') && limpio.length <= 10) {
    limpio = '52' + limpio
  }
  return limpio
}

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
    const creditoDisponible = (cliente.limiteCredito || 0) - (cliente.saldoPendiente || 0)
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
              ${cliente.telefono ? `<a href="https://wa.me/${limpiarTelefono(cliente.telefono)}" target="_blank" rel="noopener noreferrer" class="btn-icon btn-whatsapp" title="WhatsApp" style="text-decoration:none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
              </a>` : ''}
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
  document.getElementById('cliente-emailSecundario1').value = clienteActual.emailSecundario1 || ''
  document.getElementById('cliente-emailSecundario2').value = clienteActual.emailSecundario2 || ''
  document.getElementById('cliente-rfc').value = clienteActual.rfc || ''
  document.getElementById('cliente-razonSocial').value = clienteActual.razonSocial || ''
  document.getElementById('cliente-codigoPostalFiscal').value = clienteActual.codigoPostalFiscal || ''
  document.getElementById('cliente-regimenFiscal').value = clienteActual.regimenFiscal || ''
  filtrarUsosPorRegimen(
    document.getElementById('cliente-regimenFiscal'),
    document.getElementById('cliente-usoCfdi')
  )
  document.getElementById('cliente-usoCfdi').value = clienteActual.usoCfdi || ''
  document.getElementById('cliente-limiteCredito').value = clienteActual.limiteCredito || 0
  document.getElementById('cliente-notas').value = clienteActual.notas || ''

  actualizarCamposDinamicos()
  if (clienteError) clienteError.classList.remove('show')
  if (modalCliente) modalCliente.classList.add('active')
}

function actualizarCamposDinamicos() {
  const tipo = document.getElementById('cliente-tipo').value
  const esFiscal = tipo === 'FISCAL'
  
  if (camposFiscales) {
    camposFiscales.style.display = esFiscal ? 'block' : 'none'
  }
  if (campoCredito) {
    campoCredito.style.display = (tipo === 'REGISTRADO' || esFiscal) ? 'block' : 'none'
  }
  
  // Campos obligatorios para clientes FISCAL
  const fiscalesRequeridos = ['cliente-rfc', 'cliente-email', 'cliente-razonSocial',
    'cliente-codigoPostalFiscal', 'cliente-regimenFiscal', 'cliente-usoCfdi']
  fiscalesRequeridos.forEach(function(id) {
    var el = document.getElementById(id)
    if (el) {
      el.required = esFiscal
      el.classList.remove('input-error')
    }
  })
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
        <td style="font-size:0.82rem;color:var(--muted)">${abono.Bitacora?.folio || '—'}${abono.Bitacora?.titulo ? ` · ${abono.Bitacora.titulo}` : ''}</td>
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
      emailSecundario1: document.getElementById('cliente-emailSecundario1').value.trim() || null,
      emailSecundario2: document.getElementById('cliente-emailSecundario2').value.trim() || null,
      rfc: document.getElementById('cliente-rfc').value.trim() || null,
      razonSocial: document.getElementById('cliente-razonSocial').value.trim() || null,
      codigoPostalFiscal: document.getElementById('cliente-codigoPostalFiscal').value.trim() || null,
      regimenFiscal: document.getElementById('cliente-regimenFiscal').value || null,
      usoCfdi: document.getElementById('cliente-usoCfdi').value || null,
      limiteCredito: parseFloat(document.getElementById('cliente-limiteCredito').value) || 0,
      notas: document.getElementById('cliente-notas').value.trim() || null
    }

    if (datos.tipo === 'FISCAL') {
      var camposRequeridos = [
        { valor: datos.rfc,               id: 'cliente-rfc',               mensaje: 'El RFC es obligatorio para clientes FISCAL' },
        { valor: datos.email,             id: 'cliente-email',             mensaje: 'El Email es obligatorio para clientes FISCAL' },
        { valor: datos.razonSocial,       id: 'cliente-razonSocial',       mensaje: 'La Razón Social es obligatoria para clientes FISCAL' },
        { valor: datos.codigoPostalFiscal, id: 'cliente-codigoPostalFiscal', mensaje: 'El Código Postal Fiscal es obligatorio para clientes FISCAL' },
        { valor: datos.regimenFiscal,     id: 'cliente-regimenFiscal',     mensaje: 'El Régimen Fiscal es obligatorio para clientes FISCAL' },
        { valor: datos.usoCfdi,           id: 'cliente-usoCfdi',           mensaje: 'El Uso CFDI es obligatorio para clientes FISCAL' }
      ]
      var hayError = false
      camposRequeridos.forEach(function(c) {
        var input = document.getElementById(c.id)
        if (!c.valor) {
          hayError = true
          if (input) input.classList.add('input-error')
          jeshaToast(c.mensaje, 'error')
        } else {
          if (input) input.classList.remove('input-error')
        }
      })
      if (hayError) return
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
        const errData = await response.json()
        if (errData.errores && Array.isArray(errData.errores)) {
          errData.errores.forEach(function(e) {
            var input = document.getElementById('cliente-' + e.campo)
            if (input) input.classList.add('input-error')
            jeshaToast(e.mensaje, 'error')
          })
        }
        throw new Error(errData.error || 'Error al guardar cliente')
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