// ════════════════════════════════════════════════════════════════════
//  COMPRAS.JS
// ════════════════════════════════════════════════════════════════════
const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'
const LIMIT   = 25

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'compras.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

let paginaActual = 1
let ocActual     = null
let itemsEdicion = []
let proveedores  = []
let debounce, debounceSearch, debounceProd, debounceProv

const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'

const ESTADOS = {
  ENVIADO:          { label:'Pendiente',         cls:'enviado' },
  RECIBIDO_PARCIAL: { label:'Recibido parcial',  cls:'recibido_parcial' },
  RECIBIDO:         { label:'Recibido',           cls:'recibido' },
  CANCELADO:        { label:'Cancelado',          cls:'cancelado' }
}

// apiFetch global disponible desde sidebar.js

// ════════════════════════════════════════════════════════════════════
//  LISTAR
// ════════════════════════════════════════════════════════════════════
async function cargarCompras() {
  const tbody  = document.getElementById('comp-tbody')
  const pagDiv = document.getElementById('pagination')
  tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  const buscar     = document.getElementById('search-input')?.value.trim() || ''
  const estado     = document.getElementById('filtro-estado')?.value || ''
  const pagada     = document.getElementById('filtro-pago')?.value || ''
  const proveedorId = document.getElementById('filtro-proveedor')?.value || ''
  const params = new URLSearchParams({ page: paginaActual, limit: LIMIT })
  if (buscar)        params.set('buscar', buscar)
  if (estado)        params.set('estado', estado)
  if (pagada !== '') params.set('pagada', pagada)
  if (proveedorId)   params.set('proveedorId', proveedorId)

  try {
    const data   = await apiFetch(`/compras?${params}`)
    const lista  = data.data || []
    const total  = data.total || 0

    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p>No hay compras con los filtros aplicados</p></td></tr>`
      pagDiv.style.display = 'none'; return
    }

    tbody.innerHTML = lista.map(oc => {
      const e = ESTADOS[oc.estado] || { label: oc.estado, cls: 'enviado' }
      const saldo = parseFloat(oc.totalEstimado) - parseFloat(oc.totalPagado || 0)
      return `
        <tr onclick="abrirDetalle(${oc.id})">
          <td><strong>${oc.folio}</strong></td>
          <td>${oc.proveedor?.alias || oc.proveedor?.nombreOficial || '—'}</td>
          <td style="color:var(--muted);font-size:0.82rem">${fmtFecha(oc.creadaEn)}</td>
          <td><strong>${fmt(oc.totalEstimado)}</strong></td>
          <td style="color:#60d080">${fmt(oc.totalPagado || 0)}</td>
          <td><span class="comp-estado-badge ${e.cls}">${e.label}</span></td>
          <td><span class="comp-pago-badge ${oc.pagada ? 'pagada' : 'no-pagada'}">${oc.pagada ? 'Pagada' : 'No pagada'}</span></td>
          <td><button class="btn-pag" onclick="event.stopPropagation();abrirDetalle(${oc.id})" style="padding:4px 10px">Ver</button></td>
        </tr>`
    }).join('')

    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} compras)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else pagDiv.style.display = 'none'
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
  }
}

// ════════════════════════════════════════════════════════════════════
//  DETALLE
// ════════════════════════════════════════════════════════════════════
window.abrirDetalle = async function(id) {
  try {
    const data = await apiFetch(`/compras/${id}`)
    ocActual = data.data
    renderDetalle()
    document.getElementById('modal-detalle').classList.add('active')
  } catch (err) { alert('Error: ' + err.message) }
}

function renderDetalle() {
  const oc = ocActual
  const e  = ESTADOS[oc.estado] || { label: oc.estado, cls: 'enviado' }

  document.getElementById('det-folio').textContent = oc.folio
  const eb = document.getElementById('det-estado-badge')
  eb.className = `comp-estado-badge ${e.cls}`; eb.textContent = e.label
  const pb = document.getElementById('det-pago-badge')
  pb.className = `comp-pago-badge ${oc.pagada ? 'pagada' : 'no-pagada'}`
  pb.textContent = oc.pagada ? 'Pagada' : 'No pagada'

  document.getElementById('det-proveedor').textContent = oc.proveedor?.nombreOficial || '—'
  document.getElementById('det-tel').textContent = oc.proveedor?.celular || oc.proveedor?.telefono || '—'
  document.getElementById('det-fecha').textContent   = fmtFecha(oc.creadaEn)
  document.getElementById('det-usuario').textContent = oc.usuario?.nombre || '—'

  const notasEl = document.getElementById('det-notas-p')
  if (oc.notas) { notasEl.textContent = `📝 ${oc.notas}`; notasEl.style.display = 'block' }
  else notasEl.style.display = 'none'

  // Financiero
  const saldo = parseFloat(oc.totalEstimado) - parseFloat(oc.totalPagado || 0)
  document.getElementById('fin-total').textContent  = fmt(oc.totalEstimado)
  document.getElementById('fin-pagado').textContent = fmt(oc.totalPagado || 0)
  document.getElementById('fin-saldo').textContent  = fmt(saldo)

  const esPendiente = ['ENVIADO', 'RECIBIDO_PARCIAL'].includes(oc.estado)
  document.getElementById('card-abono').style.display = oc.pagada ? 'none' : 'block'

  // Abonos
  const listaAbonos = document.getElementById('lista-abonos')
  listaAbonos.innerHTML = (!oc.abonos || oc.abonos.length === 0)
    ? '<p class="muted-hint">Sin pagos registrados</p>'
    : oc.abonos.map(a => `
        <div class="abono-item">
          <div>
            <div class="abono-monto">+${fmt(a.monto)}</div>
            <div class="abono-meta">${a.metodoPago} · ${fmtFecha(a.creadoEn)} · ${a.usuario?.nombre || '—'}</div>
            ${a.notas ? `<div class="abono-meta">${a.notas}</div>` : ''}
          </div>
        </div>`).join('')

  // Tabla de productos
  const recibiendo = ocActual._recibiendo || false
  const showRecibido = !esPendiente || recibiendo
  document.getElementById('col-recibido-header').style.display = showRecibido ? '' : 'none'

  const tbody = document.getElementById('det-items-tbody')
  tbody.innerHTML = (oc.detalles || []).map(d => `
    <tr>
      <td>${d.producto?.nombre || '—'}</td>
      <td style="text-align:center">
        <strong>${d.cantidadPedida}</strong>
        <div class="qty-pedido">${d.producto?.unidadCompra || 'pza'}</div>
      </td>
      ${showRecibido ? `<td style="text-align:center">
        ${recibiendo
          ? `<input type="number" class="input-recibir" id="rec-${d.id}" min="0" max="${d.cantidadPedida - d.cantidadRecibida}" value="${d.cantidadPedida - d.cantidadRecibida}" />`
          : `<span style="color:${d.cantidadRecibida >= d.cantidadPedida ? '#60d080' : '#ffc107'}">${d.cantidadRecibida}</span>`
        }
      </td>` : ''}
      <td>${fmt(d.precioCosto)}</td>
      <td>${fmt(d.subtotalPedido)}</td>
    </tr>`).join('')

  // Botones superiores
  const btns = document.getElementById('det-botones-superiores')
  btns.innerHTML = ''
  if (esPendiente) {
    btns.innerHTML += `<button class="btn-secondary btn-sm" onclick="abrirEdicion(${oc.id})">✏️ Editar</button>`
    if (!recibiendo) {
      btns.innerHTML += `<button class="btn-warning btn-sm" onclick="iniciarRecepcion()">📦 Recibir mercancía</button>`
    } else {
      btns.innerHTML += `<button class="btn-success btn-sm" onclick="confirmarRecepcion()">✓ Confirmar recepción</button>`
      btns.innerHTML += `<button class="btn-secondary btn-sm" onclick="cancelarRecepcion()">✕ Cancelar</button>`
    }
  }

  // Acciones
  const accDiv = document.getElementById('det-acciones')
  accDiv.innerHTML = ''
  if (esPendiente)
    accDiv.innerHTML += `<button class="btn-danger" onclick="cancelarCompra(${oc.id})">✕ Cancelar compra</button>`
  if (oc.estado === 'RECIBIDO_PARCIAL')
    accDiv.innerHTML += `<span style="font-size:0.78rem;color:var(--muted);padding:4px 0;">⚠️ Recepción incompleta — puedes recibir el resto cuando llegue</span>`
}

// ════════════════════════════════════════════════════════════════════
//  RECEPCIÓN
// ════════════════════════════════════════════════════════════════════
window.iniciarRecepcion = function() {
  ocActual._recibiendo = true
  renderDetalle()
}
window.cancelarRecepcion = function() {
  ocActual._recibiendo = false
  renderDetalle()
}
window.confirmarRecepcion = async function() {
  // Solo enviamos los que tienen cantidad nueva > 0 (los faltantes)
  const detalles = (ocActual.detalles || [])
    .filter(d => d.cantidadPedida > d.cantidadRecibida)  // solo los que aún faltan
    .map(d => ({
      detalleId:        d.id,
      cantidadRecibida: parseInt(document.getElementById(`rec-${d.id}`)?.value) || 0
    })).filter(d => d.cantidadRecibida > 0)

  if (detalles.length === 0) { alert('Ingresa al menos una cantidad recibida'); return }

  const btn = document.querySelector('#det-botones-superiores .btn-success')
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Procesando...' }

  try {
    const data = await apiFetch(`/compras/${ocActual.id}/recibir`, { method:'POST', body: JSON.stringify({ detalles }) })
    ocActual = data.data
    ocActual._recibiendo = false
    renderDetalle()
    cargarCompras()
  } catch (err) {
    alert('Error: ' + err.message)
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirmar recepción' }
  }
}

window.cancelarCompra = async function(id) {
  if (!confirm(`¿Cancelar la compra ${ocActual?.folio}?`)) return
  try {
    const data = await apiFetch(`/compras/${id}/cancelar`, { method:'PATCH' })
    ocActual = data.data
    renderDetalle()
    cargarCompras()
  } catch (err) { alert('Error: ' + err.message) }
}

// ════════════════════════════════════════════════════════════════════
//  ABONO
// ════════════════════════════════════════════════════════════════════
async function registrarAbono() {
  const monto  = parseFloat(document.getElementById('abono-monto').value)
  const metodo = document.getElementById('abono-metodo').value
  const notas  = document.getElementById('abono-notas').value.trim() || null
  if (!monto || monto <= 0) { alert('Monto inválido'); return }

  const btn = document.getElementById('btn-abonar')
  btn.disabled = true; btn.textContent = 'Registrando...'
  try {
    const data = await apiFetch(`/compras/${ocActual.id}/abonos`, { method:'POST', body: JSON.stringify({ monto, metodoPago: metodo, notas }) })
    ocActual = data.data
    document.getElementById('abono-monto').value = ''
    document.getElementById('abono-notas').value = ''
    renderDetalle()
    cargarCompras()
  } catch (err) { alert('Error: ' + err.message) }
  finally { btn.disabled = false; btn.textContent = '+ Registrar pago' }
}

// ════════════════════════════════════════════════════════════════════
//  CREAR / EDITAR
// ════════════════════════════════════════════════════════════════════
function abrirModalCrear() {
  ocActual     = null
  itemsEdicion = []
  document.getElementById('crear-titulo').textContent = 'Nueva Compra'
  document.getElementById('prov-buscar').value = ''
  document.getElementById('prov-id').value     = ''
  document.getElementById('comp-notas').value  = ''
  document.getElementById('search-prod-modal').value = ''
  document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
  document.getElementById('crear-error').classList.remove('show')
  renderItemsEdicion()
  document.getElementById('modal-crear').classList.add('active')
}

window.abrirEdicion = async function(id) {
  document.getElementById('modal-detalle').classList.remove('active')
  try {
    const data = await apiFetch(`/compras/${id}`)
    ocActual = data.data
    document.getElementById('crear-titulo').textContent = `Editar ${ocActual.folio}`
    document.getElementById('prov-buscar').value = ocActual.proveedor?.nombreOficial || ''
    document.getElementById('prov-id').value     = ocActual.proveedor?.id || ''
    document.getElementById('comp-notas').value  = ocActual.notas || ''
    document.getElementById('search-prod-modal').value = ''
    document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
    document.getElementById('crear-error').classList.remove('show')

    itemsEdicion = (ocActual.detalles || []).map(d => ({
      productoId: d.producto?.id,
      nombre:     d.producto?.nombre || '—',
      unidad:     d.producto?.unidadCompra || 'pza',
      cantidad:   d.cantidadPedida,
      costo:      parseFloat(d.precioCosto)
    }))
    renderItemsEdicion()
    document.getElementById('modal-crear').classList.add('active')
  } catch (err) { alert('Error: ' + err.message) }
}

function renderItemsEdicion() {
  const tbody = document.getElementById('comp-items-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="comp-empty"><td colspan="6" class="empty-items">Agrega productos desde el panel izquierdo</td></tr>`
    actualizarTotalEdicion(); return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => `
    <tr>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${item.nombre}">${item.nombre}</td>
      <td style="color:var(--muted);font-size:0.78rem">${item.unidad}</td>
      <td><input type="number" min="1" value="${item.cantidad}" style="width:58px" oninput="actualizarItemEdicion(${i},'cantidad',this.value)" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.costo.toFixed(2)}" style="width:88px" oninput="actualizarItemEdicion(${i},'costo',this.value)" /></td>
      <td id="item-sub-${i}"><strong>${fmt(item.costo * item.cantidad)}</strong></td>
      <td><button class="btn-eliminar" onclick="quitarItemEdicion(${i})">✕</button></td>
    </tr>`).join('')
  actualizarTotalEdicion()
}

window.actualizarItemEdicion = function(i, campo, v) {
  const n = parseFloat(v)
  if (!isNaN(n) && n >= 0) {
    if (campo === 'cantidad') itemsEdicion[i].cantidad = parseInt(v) || 1
    else itemsEdicion[i].costo = n
    const cel = document.getElementById(`item-sub-${i}`)
    if (cel) cel.innerHTML = `<strong>${fmt(itemsEdicion[i].costo * itemsEdicion[i].cantidad)}</strong>`
    actualizarTotalEdicion()
  }
}
window.quitarItemEdicion = function(i) { itemsEdicion.splice(i, 1); renderItemsEdicion() }

function actualizarTotalEdicion() {
  const t = itemsEdicion.reduce((s, i) => s + i.costo * i.cantidad, 0)
  document.getElementById('comp-total').textContent = fmt(t)
}

function agregarProductoEdicion(prod) {
  const existe = itemsEdicion.find(i => i.productoId === prod.id)
  if (existe) { existe.cantidad += 1 }
  else {
    itemsEdicion.push({ productoId: prod.id, nombre: prod.nombre, unidad: prod.unidadCompra || 'pza', cantidad: 1, costo: parseFloat(prod.costo || prod.precioBase || 0) })
  }
  renderItemsEdicion()
}

async function guardarCompra() {
  const provId = document.getElementById('prov-id').value
  const notas  = document.getElementById('comp-notas').value.trim() || null
  if (!provId) { mostrarError('crear-error', 'Selecciona un proveedor'); return }
  if (itemsEdicion.length === 0) { mostrarError('crear-error', 'Agrega al menos un producto'); return }

  const detalles = itemsEdicion.map(i => ({ productoId: i.productoId, cantidadPedida: i.cantidad, precioCosto: i.costo }))
  const btn = document.getElementById('crear-guardar')
  btn.disabled = true; btn.textContent = 'Guardando...'

  try {
    if (ocActual) {
      await apiFetch(`/compras/${ocActual.id}`, { method:'PUT', body: JSON.stringify({ proveedorId: provId, detalles, notas }) })
    } else {
      await apiFetch('/compras', { method:'POST', body: JSON.stringify({ proveedorId: provId, detalles, notas }) })
    }
    document.getElementById('modal-crear').classList.remove('active')
    paginaActual = 1; cargarCompras()
  } catch (err) { mostrarError('crear-error', err.message) }
  finally { btn.disabled = false; btn.textContent = 'Guardar Compra' }
}

// ════════════════════════════════════════════════════════════════════
//  PROVEEDORES
// ════════════════════════════════════════════════════════════════════
async function cargarProveedores() {
  try {
    const data = await apiFetch('/compras/proveedores')
    proveedores = data.data || []
    // Poblar select de filtro en toolbar
    const sel = document.getElementById('filtro-proveedor')
    if (sel) {
      sel.innerHTML = '<option value="">Todos los proveedores</option>'
      proveedores.sort((a,b) => (a.alias || a.nombreOficial).localeCompare(b.alias || b.nombreOficial))
        .forEach(p => {
          const opt = document.createElement('option')
          opt.value = p.id
          opt.textContent = p.alias || p.nombreOficial
          sel.appendChild(opt)
        })
    }
  } catch(e) { console.warn('No se cargaron proveedores:', e.message) }
}

// Filtra en memoria — sin mínimo de caracteres para poder mostrar toda la lista
function filtrarProveedores(q) {
  const l = (q || '').toLowerCase().trim()
  if (!l) return proveedores.slice(0, 50)
  return proveedores.filter(p =>
    p.nombreOficial?.toLowerCase().includes(l) ||
    p.alias?.toLowerCase().includes(l)
  ).slice(0, 50)
}

// Renderiza el dropdown con buscador interno integrado
function renderDDProv(lista) {
  const dd = document.getElementById('dd-proveedores')
  if (!dd) return

  dd.innerHTML = `
    <div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <input type="text" id="dd-prov-search"
        placeholder="Buscar proveedor..."
        autocomplete="off"
        style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
               border-radius:6px;padding:6px 10px;color:var(--text,#fff);font-size:0.85rem;outline:none;" />
    </div>
    <div id="dd-prov-list" style="max-height:220px;overflow-y:auto;"></div>
  `
  dd.style.display = 'block'

  const renderItems = (items) => {
    const listEl = document.getElementById('dd-prov-list')
    if (!listEl) return
    listEl.innerHTML = items.length === 0
      ? `<div style="padding:10px 12px;color:var(--muted);font-size:0.85rem;">Sin resultados</div>`
      : items.map(p => `
          <div class="dropdown-item"
               onclick="selProv(${p.id},'${(p.alias || p.nombreOficial).replace(/'/g,"\\'")}','${p.nombreOficial.replace(/'/g,"\\'")}')">
            <strong>${p.alias || p.nombreOficial}</strong>
            ${p.alias ? `<span style="color:var(--muted);font-size:0.78rem"> — ${p.nombreOficial}</span>` : ''}
          </div>`
        ).join('')
  }
  renderItems(lista)

  // Buscador interno
  const ddInput = document.getElementById('dd-prov-search')
  if (ddInput) {
    ddInput.addEventListener('input', e => renderItems(filtrarProveedores(e.target.value)))
    setTimeout(() => ddInput.focus(), 40)
  }
}

function abrirDDProv() {
  const dd = document.getElementById('dd-proveedores')
  if (!dd) return
  if (dd.style.display !== 'none') {
    cerrarDDProv(); return
  }
  renderDDProv(filtrarProveedores(''))
}

function cerrarDDProv() {
  const dd = document.getElementById('dd-proveedores')
  if (dd) dd.style.display = 'none'
}

window.selProv = (id, alias, nombre) => {
  document.getElementById('prov-id').value     = id
  document.getElementById('prov-buscar').value = alias
  cerrarDDProv()
}

async function guardarProveedor() {
  const nombre = document.getElementById('prov-nombre').value.trim()
  const alias  = document.getElementById('prov-alias').value.trim() || null
  const tel    = document.getElementById('prov-tel').value.trim() || null
  const cel    = document.getElementById('prov-cel').value.trim() || null
  if (!nombre) { mostrarError('prov-error', 'Nombre oficial requerido'); return }

  const btn = document.getElementById('prov-guardar')
  btn.disabled = true; btn.textContent = 'Creando...'
  try {
    const data = await apiFetch('/compras/proveedores', { method:'POST', body: JSON.stringify({ nombreOficial: nombre, alias, telefono: tel, celular: cel }) })
    const prov = data.data
    proveedores.push(prov)
    document.getElementById('prov-id').value     = prov.id
    document.getElementById('prov-buscar').value = prov.alias || prov.nombreOficial
    document.getElementById('modal-prov').classList.remove('active')
  } catch (err) { mostrarError('prov-error', err.message) }
  finally { btn.disabled = false; btn.textContent = 'Crear Proveedor' }
}

// ════════════════════════════════════════════════════════════════════
//  BÚSQUEDA PRODUCTOS EN MODAL
// ════════════════════════════════════════════════════════════════════
async function buscarProductosModal(q) {
  const lista = document.getElementById('lista-prod-modal')
  if (!q || q.length < 2) { lista.innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'; return }
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  try {
    const data = await apiFetch(`/productos?buscar=${encodeURIComponent(q)}&take=30`)
    const prods = data.data || data
    if (!prods?.length) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; return }
    window._prodCache = {}
    prods.forEach(p => { window._prodCache[p.id] = p })
    lista.innerHTML = prods.map(p => `
      <div class="prod-item-modal" onclick="window._addProdComp(${p.id})">
        <span class="prod-nombre">${p.nombre}</span>
        <span class="prod-precio">${fmt(p.costo || p.precioBase)}</span>
      </div>`).join('')
  } catch (err) { lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error</p>` }
}
window._addProdComp = id => { const p = window._prodCache?.[id]; if (p) agregarProductoEdicion(p) }

function mostrarError(id, msg) {
  const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.add('show') }
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX',{ weekday:'long', year:'numeric', month:'long', day:'numeric' })

  await cargarProveedores()
  cargarCompras()

  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounceSearch); debounceSearch = setTimeout(() => { paginaActual=1; cargarCompras() }, 400)
  })
  ;['filtro-estado','filtro-pago','filtro-proveedor'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { paginaActual=1; cargarCompras() })
  })
  document.getElementById('btn-prev')?.addEventListener('click', () => { if(paginaActual>1){paginaActual--;cargarCompras()} })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++;cargarCompras() })

  document.getElementById('btn-nueva')?.addEventListener('click', abrirModalCrear)
  document.getElementById('crear-close')?.addEventListener('click', () => document.getElementById('modal-crear').classList.remove('active'))
  document.getElementById('crear-cancel')?.addEventListener('click', () => document.getElementById('modal-crear').classList.remove('active'))
  document.getElementById('crear-guardar')?.addEventListener('click', guardarCompra)

  document.getElementById('search-prod-modal')?.addEventListener('input', e => {
    clearTimeout(debounceProd); debounceProd = setTimeout(() => buscarProductosModal(e.target.value.trim()), 350)
  })

  // Proveedor — buscador + chevron para ver lista completa
  document.getElementById('prov-buscar')?.addEventListener('input', e => {
    const q = e.target.value
    if (q.length === 0) {
      cerrarDDProv()
      document.getElementById('prov-id').value = ''
    } else {
      renderDDProv(filtrarProveedores(q))
    }
  })
  document.getElementById('prov-buscar')?.addEventListener('focus', () => {
    const q = document.getElementById('prov-buscar')?.value || ''
    renderDDProv(filtrarProveedores(q))
  })
  document.getElementById('btn-chevron-prov')?.addEventListener('click', abrirDDProv)
  document.addEventListener('click', e => {
    if (!e.target.closest('#prov-buscar') &&
        !e.target.closest('#btn-chevron-prov') &&
        !e.target.closest('#dd-proveedores'))
      cerrarDDProv()
  })

  document.getElementById('btn-nuevo-prov')?.addEventListener('click', () => {
    document.getElementById('prov-nombre').value = ''
    document.getElementById('prov-alias').value  = ''
    document.getElementById('prov-tel').value    = ''
    document.getElementById('prov-cel').value    = ''
    document.getElementById('prov-error').classList.remove('show')
    document.getElementById('modal-prov').classList.add('active')
  })
  document.getElementById('prov-close')?.addEventListener('click', () => document.getElementById('modal-prov').classList.remove('active'))
  document.getElementById('prov-cancel')?.addEventListener('click', () => document.getElementById('modal-prov').classList.remove('active'))
  document.getElementById('prov-guardar')?.addEventListener('click', guardarProveedor)

  document.getElementById('det-close')?.addEventListener('click', () => document.getElementById('modal-detalle').classList.remove('active'))
  document.getElementById('btn-abonar')?.addEventListener('click', registrarAbono)

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-crear')?.classList.remove('active')
      document.getElementById('modal-detalle')?.classList.remove('active')
      document.getElementById('modal-prov')?.classList.remove('active')
      cerrarDDProv()
    }
  })
})
console.log('✅ compras.js cargado')