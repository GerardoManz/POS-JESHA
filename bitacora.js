// ════════════════════════════════════════════════════════════════════
//  BITACORA.JS
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = 'http://localhost:3000'
const LIMIT   = 25

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'bitacora.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

let paginaActual   = 1
let bitacoraActual = null
let clientesLista  = []
let prodSeleccionado = null
let debounce, debounceSearch, debounceProd

const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—'
const fmtHora  = iso => iso ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'

const ESTADOS = {
  ABIERTA:         { label:'Abierta',          cls:'abierta' },
  PAUSADA:         { label:'Pausada',           cls:'pausada' },
  CERRADA_VENTA:   { label:'Cerrada c/venta',   cls:'cerrada_venta' },
  CERRADA_INTERNA: { label:'Cerrada interna',   cls:'cerrada_interna' }
}

async function apiFetch(path, opts={}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${TOKEN}`, ...(opts.headers||{}) }
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
  return data
}

// ════════════════════════════════════════════════════════════════════
//  LISTAR
// ════════════════════════════════════════════════════════════════════
async function cargarBitacoras() {
  const tbody  = document.getElementById('bit-tbody')
  const pagDiv = document.getElementById('pagination')
  tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  const buscar  = document.getElementById('search-input')?.value.trim() || ''
  const estado  = document.getElementById('filtro-estado')?.value || ''
  const cliente = document.getElementById('filtro-cliente')?.value || ''
  const params  = new URLSearchParams({ page: paginaActual, limit: LIMIT })
  if (buscar)  params.set('buscar',    buscar)
  if (estado)  params.set('estado',    estado)
  if (cliente && parseInt(cliente) > 0) params.set('clienteId', cliente)

  try {
    const data     = await apiFetch(`/bitacoras?${params}`)
    const lista    = data.data || []
    const total    = data.total || 0

    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p>No hay bitácoras con los filtros aplicados</p></td></tr>`
      pagDiv.style.display = 'none'
      return
    }

    tbody.innerHTML = lista.map(b => {
      const e    = ESTADOS[b.estado] || { label: b.estado, cls: 'abierta' }
      const saldo = parseFloat(b.saldoPendiente)
      const saldoCls = saldo > 0 ? 'saldo-neg' : saldo < 0 ? 'saldo-ok' : 'saldo-zer'
      return `
        <tr onclick="abrirDetalle(${b.id})">
          <td><strong>${b.folio}</strong></td>
          <td>${b.titulo}</td>
          <td>${b.cliente?.nombre || '<span style="color:var(--muted)">Sin cliente</span>'}</td>
          <td>${fmt(b.totalMateriales)}</td>
          <td style="color:#60d080">${fmt(b.totalAbonado)}</td>
          <td class="${saldoCls}">${fmt(b.saldoPendiente)}</td>
          <td><span class="bit-estado-badge ${e.cls}">${e.label}</span></td>
          <td><button class="btn-pag" onclick="event.stopPropagation();abrirDetalle(${b.id})" style="padding:4px 10px">Abrir</button></td>
        </tr>`
    }).join('')

    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} bitácoras)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else pagDiv.style.display = 'none'

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
  }
}

// ════════════════════════════════════════════════════════════════════
//  ABRIR DETALLE
// ════════════════════════════════════════════════════════════════════
window.abrirDetalle = async function(id) {
  try {
    const data = await apiFetch(`/bitacoras/${id}`)
    bitacoraActual = data.data
    renderDetalle()
    document.getElementById('modal-detalle').classList.add('active')
  } catch (err) { alert('Error: ' + err.message) }
}

function renderDetalle() {
  const b = bitacoraActual
  const e = ESTADOS[b.estado] || { label: b.estado, cls: 'abierta' }
  const abierta = ['ABIERTA','PAUSADA'].includes(b.estado)

  document.getElementById('det-folio').textContent         = b.folio
  document.getElementById('det-titulo-header').textContent = b.titulo
  const badge = document.getElementById('det-estado-badge')
  badge.className   = `bit-estado-badge ${e.cls}`
  badge.textContent = e.label

  document.getElementById('det-cliente').textContent   = b.cliente?.nombre  || '—'
  document.getElementById('det-telefono').textContent  = b.cliente?.telefono || '—'
  document.getElementById('det-fecha').textContent     = fmtFecha(b.creadaEn)
  document.getElementById('det-usuario').textContent   = b.usuario?.nombre   || '—'

  const descEl = document.getElementById('det-descripcion')
  if (b.descripcion) { descEl.textContent = b.descripcion; descEl.style.display = 'block' }
  else descEl.style.display = 'none'

  const notasEl = document.getElementById('det-notas-p')
  if (b.notas) { notasEl.textContent = `📝 ${b.notas}`; notasEl.style.display = 'block' }
  else notasEl.style.display = 'none'

  // Financiero
  document.getElementById('fin-materiales').textContent = fmt(b.totalMateriales)
  document.getElementById('fin-abonado').textContent    = fmt(b.totalAbonado)
  const saldo    = parseFloat(b.saldoPendiente)
  const saldoEl  = document.getElementById('fin-saldo')
  saldoEl.textContent = fmt(saldo)
  saldoEl.className   = `fin-monto ${saldo > 0 ? 'fin-naranja' : saldo < 0 ? 'fin-verde' : ''}`

  // Panel abono visible solo si está abierta/pausada
  document.getElementById('card-abono').style.display = abierta ? 'block' : 'none'

  // Card de crédito del cliente (solo si viene de venta a crédito)
  const cardCredito = document.getElementById('card-credito-cliente')
  if (cardCredito) {
    // Mostrar card si viene de venta a crédito — usar ventaId como señal principal
    const esCredito = b.ventaId !== null && b.ventaId !== undefined
    if (esCredito && b.cliente) {
      cardCredito.style.display = 'block'
      // Siempre cargar datos frescos del cliente al abrir
      cargarCreditoCliente(b.cliente.id)
    } else {
      cardCredito.style.display = 'none'
    }
  }

  // Abonos
  const listaAbonos = document.getElementById('lista-abonos')
  if (!b.abonos || b.abonos.length === 0) {
    listaAbonos.innerHTML = '<p class="muted-hint">Sin abonos registrados</p>'
  } else {
    listaAbonos.innerHTML = b.abonos.map(a => `
      <div class="abono-item">
        <div>
          <div class="abono-monto">+${fmt(a.monto)}</div>
          <div class="abono-meta">${a.metodoPago} · ${fmtHora(a.creadoEn)} · ${a.usuario?.nombre || '—'}</div>
          ${a.notas ? `<div class="abono-meta">${a.notas}</div>` : ''}
        </div>
      </div>
    `).join('')
  }

  // Tabla de materiales
  const tbody = document.getElementById('det-items-tbody')
  if (!b.detalles || b.detalles.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell"><p>Sin materiales aún</p></td></tr>`
  } else {
    tbody.innerHTML = b.detalles.map(d => `
      <tr>
        <td>${d.producto?.nombre || '—'}</td>
        <td style="color:var(--muted);font-size:0.78rem">${d.producto?.unidadVenta || '—'}</td>
        <td style="text-align:center">${d.cantidad}</td>
        <td>${fmt(d.precioUnitario)}</td>
        <td><strong>${fmt(d.subtotal)}</strong></td>
        <td style="color:var(--muted);font-size:0.75rem">${fmtFecha(d.creadoEn)}</td>
        <td>${abierta ? `<button class="btn-eliminar" onclick="quitarProducto(${d.id})" title="Quitar">✕</button>` : ''}</td>
      </tr>
    `).join('')
  }

  // Botón agregar producto
  document.getElementById('btn-agregar-prod').style.display = abierta ? 'inline-flex' : 'none'
  document.getElementById('buscador-prod-panel').style.display = 'none'
  document.getElementById('form-cantidad-prod').style.display  = 'none'
  document.getElementById('search-prod-det').value = ''
  document.getElementById('lista-prod-det').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
  prodSeleccionado = null

  // Acciones de estado
  renderAcciones()
}

function renderAcciones() {
  const b       = bitacoraActual
  const accDiv  = document.getElementById('det-acciones')
  accDiv.innerHTML = ''

  if (b.estado === 'ABIERTA') {
    accDiv.innerHTML += `<button class="btn-warning" onclick="cambiarEstado('PAUSADA')">⏸ Pausar</button>`
    accDiv.innerHTML += `<button class="btn-success" onclick="cambiarEstado('CERRADA_INTERNA')">✓ Cerrar (uso interno)</button>`
    accDiv.innerHTML += `<button class="btn-danger"  onclick="cambiarEstado('CERRADA_VENTA')">🛒 Cerrar con venta</button>`
  }
  if (b.estado === 'PAUSADA') {
    accDiv.innerHTML += `<button class="btn-primary" onclick="cambiarEstado('ABIERTA')">▶ Reactivar</button>`
    accDiv.innerHTML += `<button class="btn-success" onclick="cambiarEstado('CERRADA_INTERNA')">✓ Cerrar (uso interno)</button>`
    accDiv.innerHTML += `<button class="btn-danger"  onclick="cambiarEstado('CERRADA_VENTA')">🛒 Cerrar con venta</button>`
  }
}

// ════════════════════════════════════════════════════════════════════
//  CAMBIAR ESTADO
// ════════════════════════════════════════════════════════════════════
window.cambiarEstado = async function(estado) {
  const labels = { PAUSADA:'pausar', ABIERTA:'reactivar', CERRADA_INTERNA:'cerrar como uso interno', CERRADA_VENTA:'cerrar con venta' }
  if (!confirm(`¿${labels[estado] || 'cambiar estado de'} la bitácora ${bitacoraActual.folio}?`)) return
  try {
    const data = await apiFetch(`/bitacoras/${bitacoraActual.id}/estado`, { method:'PATCH', body: JSON.stringify({ estado }) })
    bitacoraActual = data.data
    renderDetalle()
    cargarBitacoras()
  } catch (err) { alert('Error: ' + err.message) }
}

// ════════════════════════════════════════════════════════════════════
//  AGREGAR PRODUCTO
// ════════════════════════════════════════════════════════════════════
async function buscarProductosDet(q) {
  const lista = document.getElementById('lista-prod-det')
  if (!q || q.length < 2) { lista.innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'; return }
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  try {
    const data = await apiFetch(`/productos?buscar=${encodeURIComponent(q)}&take=20`)
    const prods = data.data || data
    if (!prods?.length) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; return }
    window._prodDetCache = {}
    prods.forEach(p => { window._prodDetCache[p.id] = p })
    lista.innerHTML = prods.map(p => {
      const stock = p.inventarios?.[0]?.stockActual ?? p.stock ?? '—'
      const cls   = typeof stock === 'number' && stock > 0 ? 'pi-stock-ok' : 'pi-stock-no'
      return `<div class="prod-item-inline" onclick="seleccionarProd(${p.id})">
        <span class="pi-nombre">${p.nombre}</span>
        <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
          <span class="pi-precio">${fmt(p.precioBase)}</span>
          <span class="${cls}">Stock: ${stock}</span>
        </span>
      </div>`
    }).join('')
  } catch (err) { lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error: ${err.message}</p>` }
}

window.seleccionarProd = function(id) {
  prodSeleccionado = window._prodDetCache?.[id]
  if (!prodSeleccionado) return
  document.getElementById('prod-seleccionado-nombre').textContent = `${prodSeleccionado.nombre} — ${fmt(prodSeleccionado.precioBase)}`
  document.getElementById('prod-precio').value   = parseFloat(prodSeleccionado.precioBase).toFixed(2)
  document.getElementById('prod-cantidad').value = 1
  document.getElementById('form-cantidad-prod').style.display = 'block'
  document.getElementById('prod-error').classList.remove('show')
}

async function confirmarAgregarProd() {
  if (!prodSeleccionado) return
  const cantidad = parseInt(document.getElementById('prod-cantidad').value)
  const precio   = parseFloat(document.getElementById('prod-precio').value)
  if (!cantidad || cantidad <= 0) { mostrarError('prod-error', 'Cantidad debe ser mayor a 0'); return }
  if (!precio   || precio   <  0) { mostrarError('prod-error', 'Precio inválido'); return }

  const btn = document.getElementById('btn-confirmar-prod')
  btn.disabled = true; btn.textContent = 'Agregando...'

  try {
    const data = await apiFetch(`/bitacoras/${bitacoraActual.id}/productos`, {
      method: 'POST',
      body: JSON.stringify({ productoId: prodSeleccionado.id, cantidad, precioUnitario: precio })
    })
    bitacoraActual = data.data
    renderDetalle()
    cargarBitacoras()
  } catch (err) {
    mostrarError('prod-error', err.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Agregar'
  }
}

window.quitarProducto = async function(detalleId) {
  if (!confirm('¿Quitar este producto? El stock será reintegrado.')) return
  try {
    const data = await apiFetch(`/bitacoras/${bitacoraActual.id}/productos/${detalleId}`, { method: 'DELETE' })
    bitacoraActual = data.data
    renderDetalle()
    cargarBitacoras()
  } catch (err) { alert('Error: ' + err.message) }
}

// ════════════════════════════════════════════════════════════════════
//  REGISTRAR ABONO
// ════════════════════════════════════════════════════════════════════
async function registrarAbono() {
  const monto    = parseFloat(document.getElementById('abono-monto').value)
  const metodo   = document.getElementById('abono-metodo').value
  const notas    = document.getElementById('abono-notas').value.trim() || null

  if (!monto || monto <= 0) { alert('Ingresa un monto válido'); return }

  const btn = document.getElementById('btn-abonar')
  btn.disabled = true; btn.textContent = 'Registrando...'

  try {
    const data = await apiFetch(`/bitacoras/${bitacoraActual.id}/abonos`, {
      method: 'POST',
      body: JSON.stringify({ monto, metodoPago: metodo, notas })
    })
    bitacoraActual = data.data
    // Refrescar saldo del cliente si es bitácora de crédito
    // (el backend ya hace el decrement en Cliente al registrar el abono)
    if (bitacoraActual.ventaId && bitacoraActual.cliente?.id) {
      cargarCreditoCliente(bitacoraActual.cliente.id)
    }
    document.getElementById('abono-monto').value = ''
    document.getElementById('abono-notas').value = ''
    renderDetalle()
    cargarBitacoras()
  } catch (err) { alert('Error: ' + err.message) } 
  finally { btn.disabled = false; btn.textContent = '+ Registrar abono' }
}

// ════════════════════════════════════════════════════════════════════
//  CREAR BITÁCORA
// ════════════════════════════════════════════════════════════════════
function abrirModalCrear() {
  document.getElementById('bit-titulo').value         = ''
  document.getElementById('bit-cliente-buscar').value = ''
  document.getElementById('bit-cliente-id').value     = ''
  document.getElementById('bit-descripcion').value    = ''
  document.getElementById('bit-notas').value          = ''
  document.getElementById('crear-error').classList.remove('show')
  cerrarBitDD()
  document.getElementById('modal-crear').classList.add('active')
  setTimeout(() => document.getElementById('bit-titulo').focus(), 100)
}

async function guardarNuevaBitacora() {
  const titulo      = document.getElementById('bit-titulo').value.trim()
  const clienteId   = document.getElementById('bit-cliente-id').value || null
  const descripcion = document.getElementById('bit-descripcion').value.trim() || null
  const notas       = document.getElementById('bit-notas').value.trim() || null

  if (!titulo) { mostrarError('crear-error', 'El título es requerido'); return }

  const btn = document.getElementById('crear-guardar')
  btn.disabled = true; btn.textContent = 'Creando...'

  try {
    const data = await apiFetch('/bitacoras', {
      method: 'POST',
      body: JSON.stringify({ titulo, clienteId, descripcion, notas })
    })
    document.getElementById('modal-crear').classList.remove('active')
    paginaActual = 1
    cargarBitacoras()
    // Abrir directo el detalle de la nueva bitácora
    bitacoraActual = data.data
    renderDetalle()
    document.getElementById('modal-detalle').classList.add('active')
  } catch (err) {
    mostrarError('crear-error', err.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Crear Bitácora'
  }
}

// ════════════════════════════════════════════════════════════════════
//  AUTOCOMPLETE CLIENTES
// ════════════════════════════════════════════════════════════════════
async function cargarClientes() {
  try {
    const data = await apiFetch('/clientes?activo=true')
    clientesLista = Array.isArray(data) ? data : (data.data || [])
    const sel = document.getElementById('filtro-cliente')
    clientesLista.filter(c => c.nombre.toLowerCase() !== 'cliente general')
      .sort((a,b) => a.nombre.localeCompare(b.nombre))
      .forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.id; opt.textContent = c.nombre
        sel.appendChild(opt)
      })
  } catch(e) { console.warn('No se cargaron clientes:', e.message) }
}

// ════════════════════════════════════════════════════════════════════
//  DROPDOWN CLIENTES — patrón portal (body-level, escapa overflow)
// ════════════════════════════════════════════════════════════════════

;(function() {
  if (document.getElementById('bit-dd-styles')) return
  const s = document.createElement('style')
  s.id = 'bit-dd-styles'
  s.textContent = `
    #bit-dd-portal {
      position: fixed;
      z-index: 999999;
      background: #1a1d23;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      flex-direction: column;
      overflow: hidden;
    }
    #bit-dd-portal .dd-search-wrap {
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    #bit-dd-portal .dd-search-wrap input {
      width: 100%;
      box-sizing: border-box;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 6px 10px;
      color: #e9edf4;
      font-size: 0.875rem;
      outline: none;
    }
    #bit-dd-portal .dd-list { overflow-y: auto; max-height: 220px; }
    #bit-dd-portal .dd-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 9px 14px;
      cursor: pointer;
      font-size: 0.875rem;
      color: #e9edf4;
      transition: background 0.12s;
      gap: 12px;
    }
    #bit-dd-portal .dd-item:hover { background: rgba(255,255,255,0.06); }
    #bit-dd-portal .dd-item .dd-tel { color: #6b7280; font-size: 0.78rem; white-space: nowrap; }
    #bit-dd-portal .dd-item .dd-sin { color: #6b7280; }
  `
  document.head.appendChild(s)
})()

function obtenerPortal() {
  let p = document.getElementById('bit-dd-portal')
  if (!p) {
    p = document.createElement('div')
    p.id = 'bit-dd-portal'
    p.style.display = 'none'
    document.body.appendChild(p)
  }
  return p
}

function filtrarClientes(q) {
  const s = (q || '').toLowerCase().trim()
  if (!s) return clientesLista.slice(0, 60)
  return clientesLista.filter(c =>
    c.nombre?.toLowerCase().includes(s) ||
    c.apodo?.toLowerCase().includes(s)  ||
    c.telefono?.includes(s)
  ).slice(0, 60)
}

function renderItemsPortal(clientes) {
  const list = document.querySelector('#bit-dd-portal .dd-list')
  if (!list) return
  list.innerHTML =
    `<div class="dd-item" onclick="selBitCliente(null,'')">
       <span class="dd-sin">👤 Sin cliente</span>
     </div>` +
    clientes.map(c => `
      <div class="dd-item" onclick="selBitCliente(${c.id},'${c.nombre.replace(/'/g,"\\'")}')">
        <span>${c.nombre}</span>
        ${c.telefono ? `<span class="dd-tel">${c.telefono}</span>` : ''}
      </div>`
    ).join('')
}

function abrirBitDD() {
  const input  = document.getElementById('bit-cliente-buscar')
  const portal = obtenerPortal()
  if (!input) return

  if (portal.style.display === 'flex') { cerrarBitDD(); return }

  const rect = input.getBoundingClientRect()
  Object.assign(portal.style, {
    display: 'flex',
    top:     `${rect.bottom + 4}px`,
    left:    `${rect.left}px`,
    width:   `${rect.width}px`
  })

  portal.innerHTML = `
    <div class="dd-search-wrap">
      <input type="text" id="dd-bit-search" placeholder="Buscar cliente..." autocomplete="off" />
    </div>
    <div class="dd-list"></div>
  `
  renderItemsPortal(filtrarClientes(''))

  const inp = document.getElementById('dd-bit-search')
  inp?.addEventListener('input', e => renderItemsPortal(filtrarClientes(e.target.value)))
  inp?.addEventListener('mousedown', e => e.stopPropagation())
  setTimeout(() => inp?.focus(), 40)
}

function cerrarBitDD() {
  const p = document.getElementById('bit-dd-portal')
  if (p) p.style.display = 'none'
}

window.selBitCliente = function(id, nombre) {
  document.getElementById('bit-cliente-id').value     = id || ''
  document.getElementById('bit-cliente-buscar').value = nombre || ''
  cerrarBitDD()
}

function mostrarError(id, msg) {
  const el = document.getElementById(id)
  if (el) { el.textContent = msg; el.classList.add('show') }
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  CRÉDITO DEL CLIENTE — mostrar en card de bitácora
// ════════════════════════════════════════════════════════════════════
async function cargarCreditoCliente(clienteId) {
  try {
    const data    = await apiFetch(`/clientes/${clienteId}`)
    const cliente = data.data || data
    const limite     = parseFloat(cliente.limiteCredito  || 0)
    const saldo      = parseFloat(cliente.saldoPendiente || 0)
    const usado      = parseFloat(cliente.totalCreditoUsado || 0)
    const disponible = parseFloat((limite - saldo).toFixed(2))

    const el = id => document.getElementById(id)
    if (el('cred-limite'))     el('cred-limite').textContent     = fmt(limite)
    if (el('cred-usado'))      el('cred-usado').textContent      = fmt(saldo)
    if (el('cred-disponible')) {
      el('cred-disponible').textContent = fmt(disponible)
      el('cred-disponible').style.color = disponible > 0 ? 'var(--verde)' : '#e8710a'
    }
  } catch(e) { console.warn('Error cargando crédito:', e.message) }
}

document.addEventListener('DOMContentLoaded', async () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX',{ weekday:'long', year:'numeric', month:'long', day:'numeric' })

  await cargarClientes()
  cargarBitacoras()

  // Toolbar filtros
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounceSearch); debounceSearch = setTimeout(() => { paginaActual=1; cargarBitacoras() }, 400)
  })
  ;['filtro-estado','filtro-cliente'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { paginaActual=1; cargarBitacoras() })
  })

  // Paginación
  document.getElementById('btn-prev')?.addEventListener('click', () => { if(paginaActual>1){paginaActual--;cargarBitacoras()} })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++;cargarBitacoras() })

  // Modal crear
  document.getElementById('btn-nueva')?.addEventListener('click', abrirModalCrear)
  document.getElementById('crear-close')?.addEventListener('click', () => document.getElementById('modal-crear').classList.remove('active'))
  document.getElementById('crear-cancel')?.addEventListener('click', () => document.getElementById('modal-crear').classList.remove('active'))
  document.getElementById('crear-guardar')?.addEventListener('click', guardarNuevaBitacora)

  // Dropdown cliente en modal crear
  document.getElementById('bit-cliente-buscar')?.addEventListener('click', abrirBitDD)
  document.getElementById('btn-lista-bit-clientes')?.addEventListener('click', abrirBitDD)
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#bit-cliente-buscar') &&
        !e.target.closest('#btn-lista-bit-clientes') &&
        !e.target.closest('#bit-dd-portal'))
      cerrarBitDD()
  })

  // Modal detalle
  document.getElementById('det-close')?.addEventListener('click', () => {
    document.getElementById('modal-detalle').classList.remove('active')
    document.getElementById('buscador-prod-panel').style.display = 'none'
  })

  // Botón agregar producto (toggle buscador)
  document.getElementById('btn-agregar-prod')?.addEventListener('click', () => {
    const panel = document.getElementById('buscador-prod-panel')
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
    if (panel.style.display === 'block') document.getElementById('search-prod-det').focus()
  })

  // Búsqueda de productos en detalle
  document.getElementById('search-prod-det')?.addEventListener('input', e => {
    clearTimeout(debounceProd); debounceProd = setTimeout(() => buscarProductosDet(e.target.value.trim()), 350)
  })

  // Confirmar / cancelar agregar producto
  document.getElementById('btn-confirmar-prod')?.addEventListener('click', confirmarAgregarProd)
  document.getElementById('btn-cancelar-prod')?.addEventListener('click', () => {
    document.getElementById('form-cantidad-prod').style.display = 'none'
    prodSeleccionado = null
  })

  // Registrar abono
  document.getElementById('btn-abonar')?.addEventListener('click', registrarAbono)

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-crear')?.classList.remove('active')
      document.getElementById('modal-detalle')?.classList.remove('active')
    }
  })
})

console.log('✅ bitacora.js cargado')