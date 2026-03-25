// ════════════════════════════════════════════════════════════════════
//  COTIZACIONES.JS — v2
//  Soporta PRODUCTOS (descuento por línea + IVA desglosado) y SERVICIOS
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'cotizaciones.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

// ════════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════════

let cotizacionActual = null
let itemsEdicion     = []   // { productoId?, concepto?, unidad, cantidad, precio, descuento, nombre? }
let tipoActual       = 'PRODUCTOS'
let clientesLista    = []
let paginaActual     = 1
const LIMIT          = 20
const IVA            = 0.16

// ════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════

const fmt = n => `$${parseFloat(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtFecha = iso => iso
  ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'

function estadoBadge(estado) {
  const m = { PENDIENTE:['pendiente','Pendiente'], CONVERTIDA:['convertida','Convertida'], VENCIDA:['vencida','Vencida'], CANCELADA:['cancelada','Cancelada'] }
  const [cls, label] = m[estado] || ['pendiente', estado]
  return `<span class="estado-badge ${cls}">${label}</span>`
}

function tipoBadge(tipo) {
  return tipo === 'SERVICIOS'
    ? `<span class="tipo-badge servicios">Servicios</span>`
    : `<span class="tipo-badge productos">Productos</span>`
}

function mostrarError(elId, msg) {
  const el = document.getElementById(elId)
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
}
function ocultarError(elId) {
  document.getElementById(elId)?.classList.remove('show')
}

// ════════════════════════════════════════════════════════════════════
//  API
// ════════════════════════════════════════════════════════════════════

// apiFetch global disponible desde sidebar.js

// ════════════════════════════════════════════════════════════════════
//  LISTAR
// ════════════════════════════════════════════════════════════════════

async function cargarCotizaciones() {
  const tbody  = document.getElementById('cot-tbody')
  const pagDiv = document.getElementById('pagination')
  const buscar = document.getElementById('search-input')?.value.trim() || ''
  const estado = document.getElementById('filtro-estado')?.value || ''
  const tipo   = document.getElementById('filtro-tipo')?.value || ''

  tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  try {
    const params = new URLSearchParams({ page: paginaActual, limit: LIMIT, ...(buscar && { buscar }), ...(estado && { estado }), ...(tipo && { tipo }) })
    const data = await apiFetch(`/cotizaciones?${params}`)
    const { cotizaciones, total } = data

    if (!cotizaciones || cotizaciones.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><p>No hay cotizaciones</p></td></tr>`
      pagDiv.style.display = 'none'
      return
    }

    tbody.innerHTML = cotizaciones.map(c => `
      <tr onclick="verCotizacion(${c.id})" title="Ver detalle">
        <td><strong>${c.folio}</strong></td>
        <td>${tipoBadge(c.tipo)}</td>
        <td>${fmtFecha(c.creadaEn)}</td>
        <td>${c.cliente?.nombre || '<span style="color:var(--muted)">Sin cliente</span>'}</td>
        <td style="color:var(--muted)">${c.detalles?.length || 0}</td>
        <td><strong>${fmt(c.total)}</strong></td>
        <td>${c.venceEn ? fmtFecha(c.venceEn) : '<span style="color:var(--muted)">—</span>'}</td>
        <td>${estadoBadge(c.estado)}</td>
        <td>
          <div class="actions-cell" onclick="event.stopPropagation()">
            <button class="btn-icon" onclick="verCotizacion(${c.id})" title="Ver">👁</button>
            ${c.estado === 'PENDIENTE' ? `<button class="btn-icon" onclick="abrirEdicion(${c.id})" title="Editar">✏️</button>` : ''}
            ${c.tipo === 'PRODUCTOS' ? `<button class="btn-icon" onclick="cargarEnPos(${c.id})" title="Cargar en POS">🛒</button>` : ''}
            <button class="btn-icon" onclick="descargarPdf(${c.id})" title="PDF">📄</button>
          </div>
        </td>
      </tr>
    `).join('')

    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} total)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else {
      pagDiv.style.display = 'none'
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
  }
}

// ════════════════════════════════════════════════════════════════════
//  VER DETALLE
// ════════════════════════════════════════════════════════════════════

window.verCotizacion = async function(id) {
  try {
    const data = await apiFetch(`/cotizaciones/${id}`)
    cotizacionActual = data.data
    const c = cotizacionActual

    document.getElementById('ver-folio').textContent = c.folio
    const badgeEl = document.getElementById('ver-estado-badge')
    const estadoMap   = { PENDIENTE:'pendiente', CONVERTIDA:'convertida', VENCIDA:'vencida', CANCELADA:'cancelada' }
    const estadoLabel = { PENDIENTE:'Pendiente', CONVERTIDA:'Convertida', VENCIDA:'Vencida', CANCELADA:'Cancelada' }
    badgeEl.className   = `estado-badge ${estadoMap[c.estado] || 'pendiente'}`
    badgeEl.textContent = estadoLabel[c.estado] || c.estado

    const tipoBadgeEl = document.getElementById('ver-tipo-badge')
    tipoBadgeEl.className   = `tipo-badge-ver ${c.tipo === 'SERVICIOS' ? 'servicios' : 'productos'}`
    tipoBadgeEl.textContent = c.tipo === 'SERVICIOS' ? 'Servicios' : 'Productos'
    tipoBadgeEl.style.background = c.tipo === 'SERVICIOS' ? 'rgba(232,113,10,0.15)' : 'rgba(31,58,102,0.25)'
    tipoBadgeEl.style.color      = c.tipo === 'SERVICIOS' ? 'var(--orange)' : '#7aa4e8'

    document.getElementById('ver-cliente').textContent  = c.cliente?.nombre || '—'
    document.getElementById('ver-fecha').textContent    = fmtFecha(c.creadaEn)
    document.getElementById('ver-vigencia').textContent = c.venceEn ? fmtFecha(c.venceEn) : '—'
    document.getElementById('ver-usuario').textContent  = c.usuario?.nombre || '—'

    const notasEl = document.getElementById('ver-notas')
    if (c.notas) { notasEl.textContent = c.notas; notasEl.style.display = 'block' }
    else { notasEl.style.display = 'none' }

    if (c.tipo === 'SERVICIOS') {
      document.getElementById('ver-tabla-productos').style.display = 'none'
      document.getElementById('ver-tabla-servicios').style.display = 'table'
      document.getElementById('ver-resumen-productos').style.display = 'none'
      document.getElementById('ver-resumen-servicios').style.display = 'block'

      document.getElementById('ver-servicios-tbody').innerHTML = (c.detalles || []).map(d => `
        <tr>
          <td>${d.concepto || '—'}</td>
          <td style="text-align:center">${d.unidad || '—'}</td>
          <td style="text-align:center">${d.cantidad}</td>
          <td>${fmt(d.precioUnitario)}</td>
          <td><strong>${fmt(d.subtotal)}</strong></td>
        </tr>
      `).join('')
      document.getElementById('ver-total-srv').textContent = fmt(c.total)

    } else {
      document.getElementById('ver-tabla-productos').style.display = 'table'
      document.getElementById('ver-tabla-servicios').style.display = 'none'
      document.getElementById('ver-resumen-productos').style.display = 'block'
      document.getElementById('ver-resumen-servicios').style.display = 'none'

      document.getElementById('ver-items-tbody').innerHTML = (c.detalles || []).map(d => {
        const imgHtml = d.producto?.imagenUrl
          ? `<img src="${d.producto.imagenUrl}" class="img-producto-ver" alt="${d.producto.nombre}" />`
          : `<div class="img-placeholder">📦</div>`
        const clave = d.producto?.codigoInterno || '—'
        const importe = parseFloat(d.precioUnitario) * parseInt(d.cantidad)
        return `
          <tr>
            <td style="text-align:center">${imgHtml}<div style="font-size:0.7rem;color:var(--muted);margin-top:2px">${clave}</div></td>
            <td>${d.producto?.nombre || d.concepto || d.nombre || '—'}</td>
            <td style="text-align:center">${d.unidad || '—'}</td>
            <td style="text-align:center">${d.cantidad}</td>
            <td>${fmt(d.precioUnitario)}</td>
            <td>${fmt(d.descuento || 0)}</td>
            <td><strong>${fmt(importe - parseFloat(d.descuento || 0))}</strong></td>
          </tr>
        `
      }).join('')

      // Calcular desglose IVA (precios con IVA → desglose hacia atrás)
      const totalConIva   = parseFloat(c.total)
      const baseGravable  = parseFloat((totalConIva / 1.16).toFixed(2))
      const ivaAmount     = parseFloat((totalConIva - baseGravable).toFixed(2))
      const descTotal     = (c.detalles || []).reduce((s, d) => s + parseFloat(d.descuento || 0), 0)

      document.getElementById('ver-subtotal').textContent       = fmt(baseGravable)
      document.getElementById('ver-descuento-total').textContent = fmt(descTotal)
      document.getElementById('ver-iva').textContent             = fmt(ivaAmount)
      document.getElementById('ver-total').textContent           = fmt(totalConIva)
    }

    const btnEditar   = document.getElementById('btn-editar-cot')
    const btnCancelar = document.getElementById('btn-cancelar-cot')
    const btnPos      = document.getElementById('btn-cargar-pos')
    btnEditar.style.display   = c.estado === 'PENDIENTE' ? 'flex' : 'none'
    btnCancelar.style.display = c.estado === 'PENDIENTE' ? 'flex' : 'none'
    btnPos.style.display      = c.tipo === 'PRODUCTOS' ? 'flex' : 'none'

    document.getElementById('modal-ver').classList.add('active')
  } catch (err) {
    alert('Error: ' + err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  MODAL CREAR / EDITAR
// ════════════════════════════════════════════════════════════════════

function abrirModalNuevo() {
  cotizacionActual = null
  itemsEdicion     = []
  tipoActual       = 'PRODUCTOS'
  document.getElementById('modal-titulo').textContent = 'Nueva Cotización'
  document.getElementById('cot-vence').value          = ''
  document.getElementById('cot-notas').value          = ''
  document.getElementById('search-producto-modal').value = ''
  document.getElementById('lista-productos-modal').innerHTML = '<p class="muted-hint">Escribe para buscar productos...</p>'
  ocultarError('modal-error')

  // ── Cliente: habilitado para nueva cotización ──
  const clienteInput = document.getElementById('cot-cliente-buscar')
  clienteInput.value          = ''
  clienteInput.disabled       = false
  clienteInput.style.opacity  = ''
  clienteInput.style.cursor   = ''
  document.getElementById('cot-cliente-id').value = ''
  const chevron = document.getElementById('btn-chevron-cliente')
  if (chevron) chevron.style.display = ''

  // ── Tabs: mostrar ambos ──
  document.querySelectorAll('.tipo-tab').forEach(tab => { tab.style.display = '' })

  setTipoModal('PRODUCTOS')
  renderItems()
  document.getElementById('modal-cotizacion').classList.add('active')
}

window.abrirEdicion = async function(id) {
  document.getElementById('modal-ver').classList.remove('active')
  try {
    const data = await apiFetch(`/cotizaciones/${id}`)
    cotizacionActual = data.data
    const c = cotizacionActual
    tipoActual = c.tipo || 'PRODUCTOS'

    document.getElementById('modal-titulo').textContent = `Editar ${c.folio}`
    document.getElementById('cot-vence').value          = c.venceEn ? c.venceEn.split('T')[0] : ''
    document.getElementById('cot-notas').value          = c.notas || ''
    document.getElementById('search-producto-modal').value = ''
    document.getElementById('lista-productos-modal').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
    ocultarError('modal-error')

    // ── Cliente: bloqueado en edición ──
    const clienteInput = document.getElementById('cot-cliente-buscar')
    const clienteId    = c.cliente?.id || c.clienteId || ''
    clienteInput.value          = c.cliente?.nombre || ''
    clienteInput.disabled       = true
    clienteInput.style.opacity  = '0.6'
    clienteInput.style.cursor   = 'not-allowed'
    document.getElementById('cot-cliente-id').value    = clienteId
    document.getElementById('btn-chevron-cliente').style.display = 'none'

    // ── Tabs de tipo: ocultar el que no corresponde ──
    document.querySelectorAll('.tipo-tab').forEach(tab => {
      tab.style.display = tab.dataset.tipo === tipoActual ? '' : 'none'
    })

    itemsEdicion = (c.detalles || []).map(d => ({
      productoId: d.productoId,
      nombre:     d.producto?.nombre || d.concepto || '—',
      concepto:   d.concepto || '',
      unidad:     d.unidad || '',
      cantidad:   d.cantidad,
      precio:     parseFloat(d.precioUnitario),
      descuento:  parseFloat(d.descuento || 0)
    }))

    setTipoModal(tipoActual)
    renderItems()
    document.getElementById('modal-cotizacion').classList.add('active')
  } catch (err) { alert('Error: ' + err.message) }
}

function setTipoModal(tipo) {
  tipoActual = tipo
  document.querySelectorAll('.tipo-tab').forEach(t => t.classList.toggle('active', t.dataset.tipo === tipo))
  const esProductos = tipo === 'PRODUCTOS'

  // Colapsar/expandir grid según tipo
  const split = document.querySelector('.modal-body-split')
  if (split) split.classList.toggle('servicios-mode', !esProductos)

  document.getElementById('panel-productos-left').style.display       = esProductos ? 'flex' : 'none'
  document.getElementById('tabla-productos-container').style.display  = esProductos ? 'block' : 'none'
  document.getElementById('tabla-servicios-container').style.display  = esProductos ? 'none' : 'block'
}

// ── Render ítems según tipo ──
function renderItems() {
  if (tipoActual === 'PRODUCTOS') renderItemsProductos()
  else renderItemsServicios()
}

function renderItemsProductos() {
  const tbody = document.getElementById('items-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="items-empty"><td colspan="7" class="empty-items">Agrega productos desde el panel izquierdo</td></tr>`
    actualizarTotal()
    return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => `
    <tr>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${item.nombre}">${item.nombre}</td>
      <td><input type="text" value="${item.unidad || 'PZA'}" style="width:50px" oninput="itemsEdicion[${i}].unidad=this.value" /></td>
      <td><input type="number" min="1" value="${item.cantidad}" style="width:52px" oninput="actualizarCantidadItem(${i},this.value)" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.precio.toFixed(2)}" style="width:82px" oninput="actualizarPrecioItem(${i},this.value)" /></td>
      <td><input type="number" min="0" step="0.01" value="${(item.descuento || 0).toFixed(2)}" style="width:82px" oninput="actualizarDescuentoItem(${i},this.value)" /></td>
      <td id="prod-total-${i}"><strong>${fmt((item.precio * item.cantidad) - item.descuento)}</strong></td>
      <td><button class="btn-icon" onclick="quitarItem(${i})" style="color:#f44336">✕</button></td>
    </tr>
  `).join('')
  actualizarTotal()
}

function renderItemsServicios() {
  const tbody = document.getElementById('servicios-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="servicios-empty"><td colspan="6" class="empty-items">Agrega líneas con el botón +</td></tr>`
    actualizarTotal()
    return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => `
    <tr>
      <td><input type="text" value="${item.concepto || ''}" placeholder="Descripción del servicio" style="width:100%;min-width:180px" oninput="itemsEdicion[${i}].concepto=this.value" /></td>
      <td><input type="text" value="${item.unidad || ''}" placeholder="m2" style="width:60px" oninput="itemsEdicion[${i}].unidad=this.value" /></td>
      <td><input type="number" min="1" value="${item.cantidad}" style="width:52px" oninput="actualizarCantidadItem(${i},this.value)" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.precio.toFixed(2)}" style="width:82px" oninput="actualizarPrecioItem(${i},this.value)" /></td>
      <td id="srv-total-${i}"><strong>${fmt(item.precio * item.cantidad)}</strong></td>
      <td><button class="btn-icon" onclick="quitarItem(${i})" style="color:#f44336">✕</button></td>
    </tr>
  `).join('')
  actualizarTotal()
}

window.actualizarCantidadItem = function(i, v) {
  const n = parseInt(v)
  if (!isNaN(n) && n > 0) { itemsEdicion[i].cantidad = n; actualizarFilaTotal(i) }
}
window.actualizarPrecioItem = function(i, v) {
  const n = parseFloat(v)
  if (!isNaN(n) && n >= 0) { itemsEdicion[i].precio = n; actualizarFilaTotal(i) }
}
window.actualizarDescuentoItem = function(i, v) {
  const n = parseFloat(v)
  if (!isNaN(n) && n >= 0) { itemsEdicion[i].descuento = n; actualizarFilaTotal(i) }
}
window.quitarItem = function(i) { itemsEdicion.splice(i, 1); renderItems() }

function actualizarFilaTotal(i) {
  const item  = itemsEdicion[i]
  const total = (item.precio * item.cantidad) - (item.descuento || 0)
  // Actualizar celda de la fila sin tocar el resto del DOM
  const celda = document.getElementById(`prod-total-${i}`) || document.getElementById(`srv-total-${i}`)
  if (celda) celda.innerHTML = `<strong>${fmt(total)}</strong>`
  actualizarTotal()
}

function actualizarTotal() {
  const total = itemsEdicion.reduce((s, i) => s + (i.precio * i.cantidad) - (i.descuento || 0), 0)
  document.getElementById('modal-total').textContent = fmt(total)
}

function agregarProductoAItems(prod) {
  const existe = itemsEdicion.find(i => i.productoId === prod.id)
  if (existe) { existe.cantidad += 1 }
  else {
    itemsEdicion.push({
      productoId: prod.id,
      nombre:     prod.nombre,
      unidad:     prod.unidadVenta || 'PZA',
      cantidad:   1,
      precio:     parseFloat(prod.precioBase),
      descuento:  0
    })
  }
  renderItems()
}

function agregarLineaServicio() {
  itemsEdicion.push({ concepto: '', unidad: '', cantidad: 1, precio: 0, descuento: 0 })
  renderItems()
}

// ── Guardar ──
async function guardarCotizacion() {
  ocultarError('modal-error')
  if (itemsEdicion.length === 0) { mostrarError('modal-error', 'Agrega al menos una línea.'); return }

  const clienteId = document.getElementById('cot-cliente-id').value || null
  const venceEn   = document.getElementById('cot-vence').value || null
  const notas     = document.getElementById('cot-notas').value.trim() || null

  let detalles
  if (tipoActual === 'PRODUCTOS') {
    detalles = itemsEdicion.map(i => ({
      productoId:     i.productoId,
      unidad:         i.unidad,
      cantidad:       i.cantidad,
      precioUnitario: i.precio,
      descuento:      i.descuento || 0
    }))
  } else {
    detalles = itemsEdicion.map(i => ({
      concepto:       i.concepto,
      unidad:         i.unidad,
      cantidad:       i.cantidad,
      precioUnitario: i.precio,
      descuento:      0
    }))
  }

  const btn = document.getElementById('btn-guardar-cotizacion')
  btn.disabled  = true
  btn.textContent = 'Guardando...'

  try {
    if (cotizacionActual) {
      await apiFetch(`/cotizaciones/${cotizacionActual.id}`, { method: 'PUT', body: JSON.stringify({ clienteId, venceEn, notas, detalles, tipo: tipoActual }) })
    } else {
      await apiFetch('/cotizaciones', { method: 'POST', body: JSON.stringify({ clienteId, venceEn, notas, detalles, tipo: tipoActual }) })
    }
    document.getElementById('modal-cotizacion').classList.remove('active')
    paginaActual = 1
    cargarCotizaciones()
  } catch (err) {
    mostrarError('modal-error', err.message)
  } finally {
    btn.disabled = false
    btn.textContent = 'Guardar Cotización'
  }
}

// ════════════════════════════════════════════════════════════════════
//  BÚSQUEDA PRODUCTOS EN MODAL
// ════════════════════════════════════════════════════════════════════

let debounceProducto
async function buscarProductosModal(q) {
  const lista = document.getElementById('lista-productos-modal')
  if (!q || q.length < 2) { lista.innerHTML = '<p class="muted-hint">Escribe para buscar productos...</p>'; return }
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  try {
    const data     = await apiFetch(`/productos?buscar=${encodeURIComponent(q)}&take=30`)
    const productos = data.data || data
    if (!productos || productos.length === 0) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; return }
    window._productosModalCache = {}
    productos.forEach(p => { window._productosModalCache[p.id] = p })
    lista.innerHTML = productos.map(p => `
      <div class="producto-item-modal" onclick="window._addProd(${p.id})">
        <span class="prod-nombre">${p.nombre}</span>
        <span class="prod-precio">${fmt(p.precioBase)}</span>
      </div>
    `).join('')
  } catch (err) { lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error: ${err.message}</p>` }
}
window._addProd = function(id) { const p = window._productosModalCache?.[id]; if (p) agregarProductoAItems(p) }

// ════════════════════════════════════════════════════════════════════
//  AUTOCOMPLETE CLIENTES
// ════════════════════════════════════════════════════════════════════

async function cargarClientes() {
  try {
    const data = await apiFetch('/clientes?activo=true')
    clientesLista = Array.isArray(data) ? data : (data.data || [])
  } catch (e) { console.warn('No se pudieron cargar clientes:', e.message) }
}

// Filtra en memoria — sin mínimo de caracteres para poder mostrar toda la lista
function filtrarClientes(q) {
  const l = (q || '').toLowerCase().trim()
  if (!l) return clientesLista.slice(0, 50)
  return clientesLista.filter(c =>
    c.nombre?.toLowerCase().includes(l) ||
    c.apodo?.toLowerCase().includes(l)  ||
    c.rfc?.toLowerCase().includes(l)    ||
    c.telefono?.includes(l)
  ).slice(0, 50)
}

// Renderiza items del dropdown — incluye opción de público general
function renderDropdownClientes(lista) {
  const dd = document.getElementById('dropdown-clientes')
  if (!dd) return

  // Construir buscador interno + lista
  dd.innerHTML = `
    <div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <input type="text" id="dd-cot-search"
        placeholder="Buscar cliente..."
        autocomplete="off"
        style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
               border-radius:6px;padding:6px 10px;color:var(--text,#fff);font-size:0.85rem;outline:none;" />
    </div>
    <div id="dd-cot-list" style="max-height:220px;overflow-y:auto;"></div>
  `
  dd.style.display = 'block'

  // Render items
  const renderItems = (items) => {
    const listEl = document.getElementById('dd-cot-list')
    if (!listEl) return
    listEl.innerHTML =
      `<div class="dropdown-item" style="color:var(--muted);font-style:italic;"
            onclick="seleccionarCliente(null, '')">
         👤 Público general
       </div>` +
      (items.length === 0
        ? `<div style="padding:10px 12px;color:var(--muted);font-size:0.85rem;">Sin resultados</div>`
        : items.map(c => `
            <div class="dropdown-item" onclick="seleccionarCliente(${c.id}, '${(c.apodo || c.nombre).replace(/'/g,"\\'")}')">
              <span>${c.apodo ? `${c.apodo} <span style="color:var(--muted);font-size:0.78rem">(${c.nombre})</span>` : c.nombre}</span>
              ${c.telefono ? `<span style="color:var(--muted);font-size:0.75rem;">${c.telefono}</span>` : ''}
            </div>`
          ).join('')
      )
  }
  renderItems(lista)

  // Buscador interno del dropdown
  const ddInput = document.getElementById('dd-cot-search')
  if (ddInput) {
    ddInput.addEventListener('input', e => renderItems(filtrarClientes(e.target.value)))
    setTimeout(() => ddInput.focus(), 40)
  }
}

// Abre el dropdown con toda la lista (sin filtro)
function abrirDropdownClientesCot() {
  const dd = document.getElementById('dropdown-clientes')
  if (!dd) return
  // Toggle
  if (dd.style.display !== 'none') {
    cerrarDropdownClientesCot()
    return
  }
  renderDropdownClientes(filtrarClientes(''))
}

function cerrarDropdownClientesCot() {
  const dd = document.getElementById('dropdown-clientes')
  if (dd) dd.style.display = 'none'
  document.getElementById('btn-chevron-cliente')?.classList.remove('active')
}

window.seleccionarCliente = function(id, nombre) {
  document.getElementById('cot-cliente-id').value     = id || ''
  document.getElementById('cot-cliente-buscar').value = nombre || ''
  cerrarDropdownClientesCot()
}

// ════════════════════════════════════════════════════════════════════
//  CAMBIAR ESTADO
// ════════════════════════════════════════════════════════════════════

async function cancelarCotizacion(id) {
  if (!cotizacionActual || cotizacionActual.id !== id) return
  if (!confirm(`¿Cancelar la cotización ${cotizacionActual.folio}?`)) return
  try {
    await apiFetch(`/cotizaciones/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'CANCELADA' }) })
    document.getElementById('modal-ver').classList.remove('active')
    cargarCotizaciones()
  } catch (err) { alert('Error: ' + err.message) }
}

// ════════════════════════════════════════════════════════════════════
//  CARGAR EN POS
// ════════════════════════════════════════════════════════════════════

window.cargarEnPos = async function(id) {
  try {
    let cot = cotizacionActual?.id === id ? cotizacionActual : null
    if (!cot) { const d = await apiFetch(`/cotizaciones/${id}`); cot = d.data }
    if (!cot.detalles || cot.detalles.length === 0) { alert('Esta cotización no tiene productos.'); return }
    const posPayload = {
      fuente: 'cotizacion', cotFolio: cot.folio, cotId: cot.id,
      clienteId: cot.clienteId || null, clienteNombre: cot.cliente?.nombre || '',
      items: cot.detalles.map(d => ({
        id:       d.producto?.id ?? d.productoId,
        nombre:   d.producto?.nombre || '—',
        precio:   parseFloat(d.precioUnitario),
        cantidad: parseInt(d.cantidad) || 1
      }))
    }
    localStorage.setItem('pos_cotizacion', JSON.stringify(posPayload))
    window.location.href = 'punto-venta.html'
  } catch (err) { alert('Error: ' + err.message) }
}

// ════════════════════════════════════════════════════════════════════
//  PDF
// ════════════════════════════════════════════════════════════════════

window.descargarPdf = async function(id) {
  try {
    let cot = cotizacionActual?.id === id ? cotizacionActual : null
    if (!cot) { const d = await apiFetch(`/cotizaciones/${id}`); cot = d.data }
    generarPdf(cot)
  } catch (err) { alert('Error: ' + err.message) }
}

const LOGO_B64 = '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'

function generarPdf(c) {
  const esProductos = c.tipo !== 'SERVICIOS'
  const vigencia    = c.venceEn ? `<p><strong>Vigencia:</strong> ${fmtFecha(c.venceEn)}</p>` : ''
  const notas       = c.notas  ? `<p style="margin-top:16px;font-size:12px;color:#555"><strong>Notas:</strong> ${c.notas}</p>` : ''

  let tablaHtml = ''
  let resumenHtml = ''

  if (esProductos) {
    // Tabla con imagen + clave + descuento + IVA desglosado
    const lineas = (c.detalles || []).map(d => {
      const importe  = parseFloat(d.precioUnitario) * parseInt(d.cantidad)
      const descuento = parseFloat(d.descuento || 0)
      const neto     = importe - descuento
      const imgHtml  = d.producto?.imagenUrl
        ? `<img src="${d.producto.imagenUrl}" style="width:48px;height:48px;object-fit:contain;display:block;margin:0 auto" />`
        : `<div style="width:48px;height:48px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:18px;margin:0 auto">📦</div>`
      const clave    = d.producto?.codigoInterno || '—'
      const unidad   = d.unidad || d.producto?.unidadVenta || 'PZA'
      return `
        <tr>
          <td style="text-align:center;padding:8px">${imgHtml}<div style="font-size:10px;color:#888;margin-top:2px">${clave}</div></td>
          <td style="text-align:center">${parseInt(d.cantidad)}</td>
          <td style="text-align:center">${unidad}</td>
          <td>${d.producto?.nombre || d.concepto || '—'}</td>
          <td style="text-align:right">$${parseFloat(d.precioUnitario).toFixed(2)}</td>
          <td style="text-align:right">$${descuento.toFixed(2)}</td>
          <td style="text-align:right"><strong>$${neto.toFixed(2)}</strong></td>
        </tr>`
    }).join('')

    const totalConIva  = parseFloat(c.total)
    const baseGravable = parseFloat((totalConIva / 1.16).toFixed(2))
    const ivaAmount    = parseFloat((totalConIva - baseGravable).toFixed(2))
    const descTotal    = (c.detalles || []).reduce((s, d) => s + parseFloat(d.descuento || 0), 0)

    tablaHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:80px;text-align:center">IMG/CLAVE</th>
            <th style="width:50px;text-align:center">CANT</th>
            <th style="width:60px;text-align:center">UNIDAD</th>
            <th>DESCRIPCIÓN</th>
            <th style="width:90px;text-align:right">P. UNIT.</th>
            <th style="width:80px;text-align:right">DESCUENTO</th>
            <th style="width:90px;text-align:right">IMPORTE</th>
          </tr>
        </thead>
        <tbody>${lineas}</tbody>
      </table>`

    resumenHtml = `
      <div class="resumen-box">
        <div class="resumen-row"><span>Subtotal (sin IVA):</span><span>$${baseGravable.toFixed(2)}</span></div>
        ${descTotal > 0 ? `<div class="resumen-row"><span>Descuento total:</span><span>-$${descTotal.toFixed(2)}</span></div>` : ''}
        <div class="resumen-row"><span>IVA (16%):</span><span>$${ivaAmount.toFixed(2)}</span></div>
        <div class="resumen-row total"><span>Total:</span><span>$${totalConIva.toFixed(2)}</span></div>
      </div>`
  } else {
    // SERVICIOS — tabla simple
    const lineas = (c.detalles || []).map(d => `
      <tr>
        <td>${d.concepto || '—'}</td>
        <td style="text-align:center">${d.unidad || '—'}</td>
        <td style="text-align:center">${d.cantidad}</td>
        <td style="text-align:right">$${parseFloat(d.precioUnitario).toFixed(2)}</td>
        <td style="text-align:right"><strong>$${parseFloat(d.subtotal).toFixed(2)}</strong></td>
      </tr>`
    ).join('')

    tablaHtml = `
      <table>
        <thead>
          <tr>
            <th>CONCEPTO</th>
            <th style="width:80px;text-align:center">UNIDAD</th>
            <th style="width:60px;text-align:center">CANTIDAD</th>
            <th style="width:100px;text-align:right">P.U.</th>
            <th style="width:100px;text-align:right">TOTAL</th>
          </tr>
        </thead>
        <tbody>${lineas}</tbody>
      </table>`

    resumenHtml = `
      <div class="resumen-box">
        <div class="resumen-row total"><span>Total:</span><span>$${parseFloat(c.total).toFixed(2)}</span></div>
      </div>`
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Cotización ${c.folio}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; font-size:12px; color:#222; padding:28px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; border-bottom:2px solid #1f3a66; padding-bottom:14px; }
  .empresa p { color:#555; font-size:11px; margin-top:4px; }
  .folio-box { text-align:right; }
  .folio-box .folio { font-size:18px; font-weight:700; color:#1f3a66; }
  .folio-box p { font-size:11px; color:#666; margin-top:2px; }
  .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 20px; margin-bottom:18px; background:#f7f8fa; padding:12px; border-radius:6px; font-size:11px; }
  table { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:11px; }
  th { background:#1f3a66; color:#fff; padding:8px 10px; text-align:left; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; }
  td { padding:8px 10px; border-bottom:1px solid #eee; vertical-align:middle; }
  tr:nth-child(even) td { background:#fafafa; }
  .resumen-box { display:flex; flex-direction:column; align-items:flex-end; gap:4px; margin-top:8px; }
  .resumen-row { display:flex; gap:20px; min-width:260px; justify-content:space-between; font-size:12px; color:#555; }
  .resumen-row span:last-child { font-weight:600; color:#222; }
  .resumen-row.total { border-top:1px solid #ccc; padding-top:6px; margin-top:4px; font-size:14px; font-weight:700; color:#1f3a66; }
  .resumen-row.total span:last-child { color:#1f3a66; font-size:16px; }
  .footer { margin-top:24px; border-top:1px solid #ddd; padding-top:12px; font-size:10px; color:#888; text-align:center; }
</style>
</head>
<body>
  <div class="header">
    <div class="empresa">
      <img src="data:image/png;base64,${LOGO_B64}" alt="JESHA" style="height:60px;width:auto;display:block;margin-bottom:4px;" />
      <p>Av. Vialidad San Simón 3, La Toma de Zacatecas, C.P. 98660</p>
      <p>Guadalupe, Zacatecas · Tel: 492 194 1703 · jeshadelgado544@gmail.com</p>
    </div>
    <div class="folio-box">
      <div class="folio">${c.folio}</div>
      <p>Fecha: ${fmtFecha(c.creadaEn)}</p>
      ${vigencia}
      <p style="margin-top:4px;font-size:11px;color:#888">${esProductos ? 'Cotización de Productos' : 'Cotización de Servicios'}</p>
    </div>
  </div>

  <div class="meta">
    <p><strong>Cliente:</strong> ${c.cliente?.nombre || 'Público General'}</p>
    <p><strong>RFC:</strong> ${c.cliente?.rfc || '—'}</p>
    <p><strong>Elaboró:</strong> ${c.usuario?.nombre || '—'}</p>
    <p><strong>Sucursal:</strong> ${c.sucursal?.nombre || '—'}</p>
  </div>

  ${tablaHtml}
  ${resumenHtml}
  ${notas}

  <div class="footer">
    <p>${esProductos ? 'Los precios incluyen IVA · ' : ''}Cotización válida por los días indicados · Ferretería e Iluminación JESHA</p>
  </div>
</body>
</html>`

  const ventana = window.open('', '_blank')
  ventana.document.write(html)
  ventana.document.close()
  ventana.onload = () => ventana.print()
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })

  await cargarClientes()
  cargarCotizaciones()

  let debounce
  document.getElementById('search-input')?.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { paginaActual = 1; cargarCotizaciones() }, 400) })
  document.getElementById('filtro-estado')?.addEventListener('change', () => { paginaActual = 1; cargarCotizaciones() })
  document.getElementById('filtro-tipo')?.addEventListener('change',   () => { paginaActual = 1; cargarCotizaciones() })

  document.getElementById('btn-prev')?.addEventListener('click', () => { if (paginaActual > 1) { paginaActual--; cargarCotizaciones() } })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++; cargarCotizaciones() })

  // Tabs de tipo
  document.querySelectorAll('.tipo-tab').forEach(tab => {
    tab.addEventListener('click', () => { itemsEdicion = []; setTipoModal(tab.dataset.tipo); renderItems() })
  })

  // Modal crear/editar
  document.getElementById('btn-nueva-cotizacion')?.addEventListener('click', abrirModalNuevo)
  document.getElementById('modal-close-btn')?.addEventListener('click', () => document.getElementById('modal-cotizacion').classList.remove('active'))
  document.getElementById('btn-cancel-modal')?.addEventListener('click', () => document.getElementById('modal-cotizacion').classList.remove('active'))
  document.getElementById('btn-guardar-cotizacion')?.addEventListener('click', guardarCotizacion)
  document.getElementById('btn-add-servicio')?.addEventListener('click', agregarLineaServicio)

  // Búsqueda productos
  document.getElementById('search-producto-modal')?.addEventListener('input', e => {
    clearTimeout(debounceProducto)
    debounceProducto = setTimeout(() => buscarProductosModal(e.target.value.trim()), 350)
  })

  // Autocomplete clientes — búsqueda al escribir + chevron para ver lista completa
  document.getElementById('cot-cliente-buscar')?.addEventListener('input', e => {
    const q = e.target.value
    if (q.length === 0) {
      cerrarDropdownClientesCot()
      // Limpiar selección si se borra todo el texto
      document.getElementById('cot-cliente-id').value = ''
    } else {
      renderDropdownClientes(filtrarClientes(q))
    }
  })
  document.getElementById('cot-cliente-buscar')?.addEventListener('focus', () => {
    // Al enfocar, abrir con la lista filtrada por lo que ya haya escrito
    const q = document.getElementById('cot-cliente-buscar')?.value || ''
    renderDropdownClientes(filtrarClientes(q))
  })
  document.getElementById('btn-chevron-cliente')?.addEventListener('click', abrirDropdownClientesCot)
  document.addEventListener('click', e => {
    if (!e.target.closest('#cot-cliente-buscar') &&
        !e.target.closest('#btn-chevron-cliente') &&
        !e.target.closest('#dropdown-clientes'))
      cerrarDropdownClientesCot()
  })

  // Modal ver
  document.getElementById('ver-close-btn')?.addEventListener('click', () => document.getElementById('modal-ver').classList.remove('active'))
  document.getElementById('btn-editar-cot')?.addEventListener('click', () => { if (cotizacionActual) abrirEdicion(cotizacionActual.id) })
  document.getElementById('btn-cargar-pos')?.addEventListener('click', () => { if (!cotizacionActual) return; cargarEnPos(cotizacionActual.id) })
  document.getElementById('btn-pdf')?.addEventListener('click', () => { if (cotizacionActual) descargarPdf(cotizacionActual.id) })
  document.getElementById('btn-cancelar-cot')?.addEventListener('click', () => { if (cotizacionActual) cancelarCotizacion(cotizacionActual.id) })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-cotizacion')?.classList.remove('active')
      document.getElementById('modal-ver')?.classList.remove('active')
      cerrarDropdownClientesCot()
    }
  })
})