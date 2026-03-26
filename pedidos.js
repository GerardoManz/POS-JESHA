// ════════════════════════════════════════════════════════════════════
//  PEDIDOS.JS
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'
const LIMIT   = 25

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'pedidos.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

// ── Estado ──
let paginaActual   = 1
let pedidoActual   = null
let itemsEdicion   = []
let clientesLista  = []
let debounce, debounceSearch, debounceProducto

// ── Helpers ──
const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'

const ESTADO_MAP = {
  BORRADOR:  { label:'Borrador',  cls:'borrador'  },
  ACTIVO:    { label:'Activo',    cls:'activo'    },
  EJECUTADO: { label:'Ejecutado', cls:'ejecutado' },
  CANCELADO: { label:'Cancelado', cls:'cancelado' }
}

function estadoBadge(estado) {
  const m = ESTADO_MAP[estado] || { label: estado, cls: 'borrador' }
  return `<span class="ped-estado-badge ${m.cls}">${m.label}</span>`
}

// apiFetch global disponible desde sidebar.js

// ════════════════════════════════════════════════════════════════════
//  LISTAR
// ════════════════════════════════════════════════════════════════════

async function cargarPedidos() {
  const tbody  = document.getElementById('ped-tbody')
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
    const data    = await apiFetch(`/pedidos?${params}`)
    const pedidos = data.data || []
    const total   = data.total || 0

    if (pedidos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p>No hay pedidos con los filtros aplicados</p></td></tr>`
      pagDiv.style.display = 'none'
      return
    }

    tbody.innerHTML = pedidos.map(p => `
      <tr onclick="verPedido(${p.id})">
        <td><strong>${p.folio}</strong></td>
        <td style="color:var(--muted);font-size:0.82rem">${fmtFecha(p.creadoEn)}</td>
        <td>${p.cliente?.nombre || '<span style="color:var(--muted)">Sin cliente</span>'}</td>
        <td style="color:var(--muted)">${p.usuario?.nombre || '—'}</td>
        <td style="text-align:center;color:var(--muted)">${p.detalles?.length || 0}</td>
        <td><strong>${fmt(p.totalEstimado)}</strong></td>
        <td>${estadoBadge(p.estado)}</td>
        <td><button class="btn-icon" onclick="event.stopPropagation();verPedido(${p.id})">Ver</button></td>
      </tr>
    `).join('')

    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} pedidos)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else {
      pagDiv.style.display = 'none'
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
  }
}

// ════════════════════════════════════════════════════════════════════
//  VER DETALLE
// ════════════════════════════════════════════════════════════════════

window.verPedido = async function(id) {
  try {
    const data = await apiFetch(`/pedidos/${id}`)
    pedidoActual = data.data
    const p = pedidoActual

    document.getElementById('ver-folio').textContent     = p.folio
    const badge = document.getElementById('ver-estado-badge')
    const m     = ESTADO_MAP[p.estado] || { label: p.estado, cls: 'borrador' }
    badge.className   = `ped-estado-badge ${m.cls}`
    badge.textContent = m.label

    document.getElementById('ver-cliente').textContent    = p.cliente?.nombre  || '—'
    document.getElementById('ver-telefono').textContent   = p.cliente?.telefono || '—'
    document.getElementById('ver-fecha').textContent      = fmtFecha(p.creadoEn)
    document.getElementById('ver-usuario').textContent    = p.usuario?.nombre   || '—'
    document.getElementById('ver-sucursal').textContent   = p.sucursal?.nombre  || '—'
    document.getElementById('ver-actualizado').textContent = fmtFecha(p.actualizadoEn)

    const notasEl = document.getElementById('ver-notas')
    if (p.notas) { notasEl.textContent = p.notas; notasEl.style.display = 'block' }
    else notasEl.style.display = 'none'

    document.getElementById('ver-items-tbody').innerHTML = (p.detalles || []).map(d => `
      <tr>
        <td>${d.producto?.nombre || '—'}</td>
        <td style="color:var(--muted);font-size:0.8rem">${d.producto?.codigoInterno || '—'}</td>
        <td style="text-align:center">${d.cantidad}</td>
        <td>${fmt(d.precioAcordado)}</td>
        <td><strong>${fmt(d.subtotal)}</strong></td>
      </tr>
    `).join('')

    document.getElementById('ver-total').textContent = fmt(p.totalEstimado)

    // Botones de acción según estado
    const acciones = document.getElementById('ver-acciones')
    acciones.innerHTML = ''

    if (p.estado === 'BORRADOR') {
      acciones.innerHTML += `<button class="btn-secondary" onclick="abrirEdicion(${p.id})">✏️ Editar</button>`
      acciones.innerHTML += `<button class="btn-success"   onclick="cambiarEstado(${p.id},'ACTIVO')">✓ Confirmar</button>`
      acciones.innerHTML += `<button class="btn-danger"    onclick="cambiarEstado(${p.id},'CANCELADO')">✕ Cancelar</button>`
    }
    if (p.estado === 'ACTIVO') {
      acciones.innerHTML += `<button class="btn-secondary" onclick="abrirEdicion(${p.id})">✏️ Editar</button>`
      acciones.innerHTML += `<button class="btn-pos"       onclick="cargarEnPos(${p.id})">🛒 Cargar en POS</button>`
      acciones.innerHTML += `<button class="btn-success"   onclick="cambiarEstado(${p.id},'EJECUTADO')">✓ Marcar ejecutado</button>`
      acciones.innerHTML += `<button class="btn-danger"    onclick="cambiarEstado(${p.id},'CANCELADO')">✕ Cancelar</button>`
    }
    if (p.estado === 'EJECUTADO') {
      acciones.innerHTML += `<button class="btn-pos" onclick="cargarEnPos(${p.id})">🛒 Cargar en POS</button>`
    }

    document.getElementById('modal-ver').classList.add('active')
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// ════════════════════════════════════════════════════════════════════
//  CAMBIAR ESTADO
// ════════════════════════════════════════════════════════════════════

window.cambiarEstado = async function(id, estado) {
  const labels = { ACTIVO:'confirmar', EJECUTADO:'marcar como ejecutado', CANCELADO:'cancelar' }
  const ok = await jeshaConfirm({
    title: 'Cambiar estado',
    message: `¿${labels[estado] || 'Cambiar estado de'} el pedido <strong>${pedidoActual?.folio}</strong>?`,
    confirmText: 'Confirmar', type: 'warning'
  })
  if (!ok) return
  try {
    await apiFetch(`/pedidos/${id}/estado`, { method:'PATCH', body: JSON.stringify({ estado }) })
    document.getElementById('modal-ver').classList.remove('active')
    cargarPedidos()
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// ════════════════════════════════════════════════════════════════════
//  CARGAR EN POS (mismo patrón que cotizaciones)
// ════════════════════════════════════════════════════════════════════

window.cargarEnPos = async function(id) {
  try {
    let p = pedidoActual?.id === id ? pedidoActual : null
    if (!p) { const d = await apiFetch(`/pedidos/${id}`); p = d.data }

    if (!p.detalles || p.detalles.length === 0) { jeshaToast('Este pedido no tiene productos', 'warning'); return }

    // clienteId viene dentro del objeto cliente — PEDIDO_SELECT no expone clienteId directo
    const clienteId    = p.cliente?.id    || null
    const clienteNombre = p.cliente?.nombre || ''

    const payload = {
      fuente:        'pedido',
      pedFolio:      p.folio,
      pedId:         p.id,
      clienteId,
      clienteNombre,
      items: p.detalles.map(d => ({
        id:       d.producto?.id ?? d.productoId,
        nombre:   d.producto?.nombre || '—',
        precio:   parseFloat(d.precioAcordado),
        cantidad: parseInt(d.cantidad) || 1
      }))
    }
    localStorage.setItem('pos_cotizacion', JSON.stringify(payload))
    window.location.href = 'punto-venta.html'
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// ════════════════════════════════════════════════════════════════════
//  MODAL CREAR / EDITAR
// ════════════════════════════════════════════════════════════════════

function abrirModalNuevo() {
  pedidoActual = null
  itemsEdicion = []
  document.getElementById('modal-titulo').textContent    = 'Nuevo Pedido'
  document.getElementById('ped-notas').value             = ''
  document.getElementById('search-prod-modal').value     = ''
  document.getElementById('lista-prod-modal').innerHTML  = '<p class="muted-hint">Escribe para buscar...</p>'
  document.getElementById('ped-error').classList.remove('show')

  // Restablecer campo cliente — habilitado para nuevo pedido
  const clienteInput = document.getElementById('ped-cliente-buscar')
  clienteInput.value          = ''
  clienteInput.disabled       = false
  clienteInput.style.opacity  = ''
  clienteInput.style.cursor   = ''
  document.getElementById('ped-cliente-id').value = ''

  renderItems()
  document.getElementById('modal-pedido').classList.add('active')
}

window.abrirEdicion = async function(id) {
  document.getElementById('modal-ver').classList.remove('active')
  try {
    const data = await apiFetch(`/pedidos/${id}`)
    pedidoActual = data.data
    const p = pedidoActual

    document.getElementById('modal-titulo').textContent    = `Editar ${p.folio}`
    document.getElementById('ped-notas').value             = p.notas || ''
    document.getElementById('search-prod-modal').value     = ''
    document.getElementById('lista-prod-modal').innerHTML  = '<p class="muted-hint">Escribe para buscar...</p>'
    document.getElementById('ped-error').classList.remove('show')

    // Cliente: bloqueado en edición — ya fue asignado al crear el pedido
    const clienteInput = document.getElementById('ped-cliente-buscar')
    const clienteId    = p.cliente?.id || p.clienteId || ''
    clienteInput.value    = p.cliente?.nombre || ''
    clienteInput.disabled = true
    clienteInput.style.opacity  = '0.6'
    clienteInput.style.cursor   = 'not-allowed'
    document.getElementById('ped-cliente-id').value = clienteId

    itemsEdicion = (p.detalles || []).map(d => ({
      productoId: d.productoId || d.producto?.id,
      nombre:     d.producto?.nombre || '—',
      unidad:     d.producto?.unidadVenta || 'PZA',
      cantidad:   d.cantidad,
      precio:     parseFloat(d.precioAcordado)
    }))

    renderItems()
    document.getElementById('modal-pedido').classList.add('active')
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// ── Render tabla de ítems ──
function renderItems() {
  const tbody = document.getElementById('ped-items-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="ped-items-empty"><td colspan="6" class="empty-items">Agrega productos desde el panel izquierdo</td></tr>`
    actualizarTotal()
    return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => `
    <tr>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${item.nombre}">${item.nombre}</td>
      <td style="color:var(--muted);font-size:0.8rem">${item.unidad || 'PZA'}</td>
      <td><input type="number" min="1" value="${item.cantidad}" style="width:52px" oninput="actualizarCantidad(${i},this.value)" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.precio.toFixed(2)}" style="width:80px" oninput="actualizarPrecio(${i},this.value)" /></td>
      <td id="item-total-${i}"><strong>${fmt(item.precio * item.cantidad)}</strong></td>
      <td><button class="btn-eliminar" onclick="quitarItem(${i})">✕</button></td>
    </tr>
  `).join('')
  actualizarTotal()
}

window.actualizarCantidad = function(i, v) {
  const n = parseInt(v); if (!isNaN(n) && n > 0) { itemsEdicion[i].cantidad = n; actualizarFila(i) }
}
window.actualizarPrecio = function(i, v) {
  const n = parseFloat(v); if (!isNaN(n) && n >= 0) { itemsEdicion[i].precio = n; actualizarFila(i) }
}
window.quitarItem = function(i) { itemsEdicion.splice(i, 1); renderItems() }

function actualizarFila(i) {
  const item  = itemsEdicion[i]
  const celda = document.getElementById(`item-total-${i}`)
  if (celda) celda.innerHTML = `<strong>${fmt(item.precio * item.cantidad)}</strong>`
  actualizarTotal()
}

function actualizarTotal() {
  const t = itemsEdicion.reduce((s, i) => s + i.precio * i.cantidad, 0)
  document.getElementById('ped-total').textContent = fmt(t)
}

function agregarProducto(prod) {
  const existe = itemsEdicion.find(i => i.productoId === prod.id)
  if (existe) { existe.cantidad += 1 }
  else {
    itemsEdicion.push({ productoId: prod.id, nombre: prod.nombre, unidad: prod.unidadVenta || 'PZA', cantidad: 1, precio: parseFloat(prod.precioVenta || prod.precioBase) })
  }
  renderItems()
}

// ── Búsqueda de productos ──
async function buscarProductos(q) {
  const lista = document.getElementById('lista-prod-modal')
  if (!q || q.length < 2) { lista.innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'; return }
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  try {
    const data = await apiFetch(`/productos?buscar=${encodeURIComponent(q)}&take=30`)
    const prods = data.data || data
    if (!prods || prods.length === 0) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; return }
    window._prodCache = {}
    prods.forEach(p => { window._prodCache[p.id] = p })
    lista.innerHTML = prods.map(p => `
      <div class="prod-item-modal" onclick="window._addProd(${p.id})">
        <span class="prod-nombre">${p.nombre}</span>
        <span class="prod-precio">${fmt(p.precioVenta || p.precioBase)}</span>
      </div>
    `).join('')
  } catch (err) { lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error: ${err.message}</p>` }
}
window._addProd = id => { const p = window._prodCache?.[id]; if (p) agregarProducto(p) }

// ── Autocompletado clientes ──
async function cargarClientes() {
  try {
    const data = await apiFetch('/clientes?activo=true')
    clientesLista = Array.isArray(data) ? data : (data.data || [])

    // Llenar también el filtro de la toolbar
    const sel = document.getElementById('filtro-cliente')
    clientesLista.sort((a,b) => a.nombre.localeCompare(b.nombre)).forEach(c => {
      const opt = document.createElement('option')
      opt.value = c.id; opt.textContent = c.nombre
      sel.appendChild(opt)
    })
  } catch(e) { console.warn('No se cargaron clientes:', e.message) }
}

// Sin mínimo de caracteres — devuelve toda la lista si no hay query
function filtrarClientes(q) {
  const l = (q || '').toLowerCase().trim()
  if (!l) return clientesLista.slice(0, 50)
  return clientesLista.filter(c =>
    c.nombre?.toLowerCase().includes(l) ||
    c.apodo?.toLowerCase().includes(l)  ||
    c.telefono?.includes(l)
  ).slice(0, 50)
}

// ── Portal dropdown (escapa overflow:hidden del modal) ──────────────
function obtenerPortalPed() {
  let p = document.getElementById('ped-dd-portal')
  if (!p) {
    p = document.createElement('div')
    p.id = 'ped-dd-portal'
    Object.assign(p.style, {
      position:'fixed', zIndex:'99999',
      background:'#1a1d24', border:'1px solid rgba(255,255,255,0.12)',
      borderRadius:'8px', boxShadow:'0 8px 32px rgba(0,0,0,0.5)',
      maxHeight:'260px', display:'none', minWidth:'240px',
      flexDirection:'column', overflow:'hidden'
    })
    const st = document.createElement('style')
    st.textContent = `
      #ped-dd-portal .dd-item {
        padding:9px 14px;cursor:pointer;font-size:0.875rem;color:#e9edf4;
        border-bottom:1px solid rgba(255,255,255,0.05);font-family:'Barlow',sans-serif;
      }
      #ped-dd-portal .dd-item:last-child { border-bottom:none; }
      #ped-dd-portal .dd-item:hover { background:rgba(255,255,255,0.06); }
      #ped-dd-portal .dd-list { overflow-y:auto; flex:1; }
    `
    document.head.appendChild(st)
    document.body.appendChild(p)
  }
  return p
}

function abrirPortalPed() {
  const input  = document.getElementById('ped-cliente-buscar')
  const portal = obtenerPortalPed()
  if (portal.style.display !== 'none') { cerrarPortalPed(); return }
  const rect = input.getBoundingClientRect()
  Object.assign(portal.style, {
    top:     (rect.bottom + 4) + 'px',
    left:    rect.left + 'px',
    width:   rect.width + 'px',
    display: 'flex'
  })
  renderDropdown(filtrarClientes(''))
}

function cerrarPortalPed() {
  obtenerPortalPed().style.display = 'none'
}

function renderDropdown(lista) {
  const portal = obtenerPortalPed()
  portal.innerHTML = `
    <div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
      <input type="text" id="ped-dd-search" placeholder="Buscar cliente..."
        autocomplete="off"
        style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
               border-radius:6px;padding:6px 10px;color:#e9edf4;font-size:0.85rem;outline:none;" />
    </div>
    <div class="dd-list" id="ped-dd-list"></div>
  `
  const renderItems = items => {
    const listEl = document.getElementById('ped-dd-list')
    if (!listEl) return
    listEl.innerHTML = items.length === 0
      ? `<div style="padding:10px 14px;color:#7a8599;font-size:0.85rem;">Sin resultados</div>`
      : items.map(c => `
          <div class="dd-item" onclick="window.selCliente(${c.id},'${c.nombre.replace(/'/g,"\\'")}')">
            ${c.nombre}
            ${c.apodo ? `<span style="color:#7a8599;font-size:0.8rem"> (${c.apodo})</span>` : ''}
            ${c.telefono ? `<span style="color:#7a8599;font-size:0.8rem"> · ${c.telefono}</span>` : ''}
          </div>`
        ).join('')
  }
  renderItems(lista)
  const ddInput = document.getElementById('ped-dd-search')
  if (ddInput) {
    ddInput.addEventListener('input', e => renderItems(filtrarClientes(e.target.value)))
    setTimeout(() => ddInput.focus(), 40)
  }
}

window.selCliente = (id, nombre) => {
  document.getElementById('ped-cliente-id').value     = id
  document.getElementById('ped-cliente-buscar').value = nombre
  cerrarPortalPed()
}

// ── Guardar pedido ──
async function guardarPedido() {
  document.getElementById('ped-error').classList.remove('show')
  const clienteId = document.getElementById('ped-cliente-id').value
  const notas     = document.getElementById('ped-notas').value.trim() || null

  if (!clienteId) { mostrarError('ped-error', 'Selecciona un cliente.'); return }
  if (itemsEdicion.length === 0) { mostrarError('ped-error', 'Agrega al menos un producto.'); return }

  const detalles = itemsEdicion.map(i => ({
    productoId:    i.productoId,
    cantidad:      i.cantidad,
    precioAcordado: i.precio
  }))

  const btn = document.getElementById('btn-guardar-pedido')
  btn.disabled = true; btn.textContent = 'Guardando...'

  try {
    if (pedidoActual) {
      await apiFetch(`/pedidos/${pedidoActual.id}`, { method:'PUT', body: JSON.stringify({ clienteId, detalles, notas }) })
    } else {
      await apiFetch('/pedidos', { method:'POST', body: JSON.stringify({ clienteId, detalles, notas }) })
    }
    document.getElementById('modal-pedido').classList.remove('active')
    paginaActual = 1
    cargarPedidos()
  } catch (err) {
    mostrarError('ped-error', err.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar Pedido'
  }
}

function mostrarError(id, msg) {
  const el = document.getElementById(id)
  if (el) { el.textContent = msg; el.classList.add('show') }
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX',{ weekday:'long', year:'numeric', month:'long', day:'numeric' })

  await cargarClientes()
  cargarPedidos()

  // Filtros toolbar
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounceSearch); debounceSearch = setTimeout(() => { paginaActual = 1; cargarPedidos() }, 400)
  })
  ;['filtro-estado','filtro-cliente'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { paginaActual = 1; cargarPedidos() })
  })

  // Paginación
  document.getElementById('btn-prev')?.addEventListener('click', () => { if (paginaActual > 1) { paginaActual--; cargarPedidos() } })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++; cargarPedidos() })

  // Modal nuevo
  document.getElementById('btn-nuevo-pedido')?.addEventListener('click', abrirModalNuevo)
  document.getElementById('modal-close-btn')?.addEventListener('click', () => document.getElementById('modal-pedido').classList.remove('active'))
  document.getElementById('btn-cancel-modal')?.addEventListener('click', () => document.getElementById('modal-pedido').classList.remove('active'))
  document.getElementById('btn-guardar-pedido')?.addEventListener('click', guardarPedido)

  // Búsqueda de productos
  document.getElementById('search-prod-modal')?.addEventListener('input', e => {
    clearTimeout(debounceProducto); debounceProducto = setTimeout(() => buscarProductos(e.target.value.trim()), 350)
  })

  // Autocomplete cliente — portal con lista completa + chevron
  document.getElementById('ped-cliente-buscar')?.addEventListener('input', e => {
    const q = e.target.value
    if (q.length === 0) {
      cerrarPortalPed()
      document.getElementById('ped-cliente-id').value = ''
    } else {
      abrirPortalPed()
    }
  })
  document.getElementById('ped-cliente-buscar')?.addEventListener('focus', () => abrirPortalPed())
  document.getElementById('btn-chevron-ped-cliente')?.addEventListener('click', abrirPortalPed)
  document.addEventListener('click', e => {
    if (!e.target.closest('#ped-cliente-buscar') &&
        !e.target.closest('#btn-chevron-ped-cliente') &&
        !e.target.closest('#ped-dd-portal'))
      cerrarPortalPed()
  })
  // Cerrar portal al scroll del modal
  document.querySelector('.modal-content')?.addEventListener('scroll', () => cerrarPortalPed())

  // Modal ver
  document.getElementById('ver-close-btn')?.addEventListener('click', () => document.getElementById('modal-ver').classList.remove('active'))

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-pedido')?.classList.remove('active')
      document.getElementById('modal-ver')?.classList.remove('active')
    }
  })
})

console.log('✅ pedidos.js cargado')