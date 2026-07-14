const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'proveedores.html')
  window.location.href = 'login.html'
}

let paginaActual = 1
let proveedorActual = null
let debounceSearch

const ESC = v => {
  if (v == null) return ''
  const s = String(v)
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`

const fmtFecha = iso => iso
  ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
  : '—'

/* ═══════════════════════════════════════════════════════
   API
   ═══════════════════════════════════════════════════════ */

async function cargarProveedores() {
  const tbody  = document.getElementById('prov-tbody')
  const pagDiv = document.getElementById('pagination')
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  const buscar = document.getElementById('search-input')?.value.trim() || ''
  const activo = document.getElementById('filtro-activo')?.value || ''
  const params = new URLSearchParams({ page: paginaActual, limit: 25 })
  if (buscar) params.set('buscar', buscar)
  if (activo) params.set('activo', activo)

  try {
    const data = await apiFetch(`/proveedores?${params}`)
    const lista = data.data || []
    const total = data.total || 0

    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p>No hay proveedores con los filtros aplicados</p></td></tr>`
      pagDiv.classList.remove('show'); return
    }

    tbody.innerHTML = lista.map(p => {
      const nameRow = p.alias
        ? `<strong>${ESC(p.nombreOficial)}</strong><br><span class="cell-muted" style="font-size:0.78rem">${ESC(p.alias)}</span>`
        : `<strong>${ESC(p.nombreOficial)}</strong>`
      return `<tr data-action="ver-proveedor" data-id="${p.id}">
        <td>${nameRow}</td>
        <td class="cell-muted">${ESC(p.telefono) || '—'}</td>
        <td class="cell-muted">${ESC(p.celular) || '—'}</td>
        <td class="cell-muted">${ESC(p.email) || '—'}</td>
        <td class="cell-num">${p._count?.OrdenCompra || 0}</td>
        <td class="cell-num">${p._count?.ProveedorProducto || 0}</td>
        <td><span class="prov-badge ${p.activo ? 'activo' : 'inactivo'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td><button class="btn-pag" data-action="ver-proveedor" data-id="${p.id}">Ver</button></td>
      </tr>`
    }).join('')

    const totalPags = Math.ceil(total / 25)
    if (totalPags > 1) {
      pagDiv.classList.add('show')
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} proveedores)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else {
      pagDiv.classList.remove('show')
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p style="color:#f44336">Error: ${ESC(err.message)}</p></td></tr>`
  }
}

async function abrirDetalle(id) {
  try {
    const data = await apiFetch(`/proveedores/${id}`)
    proveedorActual = data.data
    renderDetalle()
    document.getElementById('modal-detalle').classList.add('active')
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
  }
}

function renderDetalle() {
  const p = proveedorActual
  document.getElementById('det-nombre').textContent = p.alias || p.nombreOficial
  const badge = document.getElementById('det-badge')
  badge.className = `prov-badge ${p.activo ? 'activo' : 'inactivo'}`
  badge.textContent = p.activo ? 'Activo' : 'Inactivo'

  document.getElementById('det-nombre-oficial').textContent = p.nombreOficial
  document.getElementById('det-alias').textContent = p.alias || '—'
  document.getElementById('det-telefono').textContent = p.telefono || '—'
  document.getElementById('det-celular').textContent = p.celular || '—'
  document.getElementById('det-email').textContent = p.email || '—'
  document.getElementById('det-total-compras').textContent = p._count?.OrdenCompra || 0
  document.getElementById('det-total-productos').textContent = p._count?.ProveedorProducto || 0

  const btnActivar = document.getElementById('det-btn-activar')
  btnActivar.textContent = p.activo ? 'Desactivar' : 'Activar'
  btnActivar.className = p.activo ? 'btn-danger btn-sm' : 'btn-success btn-sm'

  renderProductos()
  renderCompras()
}

/* ═══════════════════════════════════════════════════════
   PRODUCTOS VINCULADOS
   ═══════════════════════════════════════════════════════ */

function renderProductos() {
  const tbody = document.getElementById('det-productos-tbody')
  const productos = proveedorActual?.ProveedorProducto || []
  if (productos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="loading-cell"><p class="muted-hint">Este proveedor no tiene productos vinculados</p></td></tr>`
    return
  }
  tbody.innerHTML = productos.map(pp => {
    const inactivo = pp.Producto?.activo === false
    const nombre  = ESC(pp.Producto?.nombre || '—') + (inactivo ? ' <span class="cell-muted" style="color:#f87171;font-size:0.75rem;">(inactivo)</span>' : '')
    return `<tr>
      <td>${nombre}</td>
      <td class="cell-muted">${ESC(pp.Producto?.codigoInterno) || '—'}</td>
      <td class="cell-muted">${ESC(pp.codigoProveedor) || '—'}</td>
      <td class="cell-accent">${fmt(pp.precioCosto)}</td>
    </tr>`
  }).join('')
}

/* ═══════════════════════════════════════════════════════
   COMPRAS
   ═══════════════════════════════════════════════════════ */

async function renderCompras() {
  const tbody = document.getElementById('det-compras-tbody')
  if (!proveedorActual) return
  try {
    const data = await apiFetch(`/proveedores/${proveedorActual.id}/compras`)
    const ordenes = data.data || []
    if (ordenes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="loading-cell"><p class="muted-hint">Sin &oacute;rdenes de compra</p></td></tr>`
      return
    }
    const ESTADOS = {
      ENVIADO:          { label: 'Pendiente',       cls: 'enviado' },
      RECIBIDO_PARCIAL: { label: 'Recibido parcial', cls: 'recibido_parcial' },
      RECIBIDO:         { label: 'Recibido',         cls: 'recibido' },
      CANCELADO:        { label: 'Cancelado',        cls: 'cancelado' }
    }
    tbody.innerHTML = ordenes.map(oc => {
      const e = ESTADOS[oc.estado] || { label: oc.estado, cls: 'enviado' }
      return `<tr onclick="window.location='compras.html'" style="cursor:pointer;">
        <td><strong>${ESC(oc.folio)}</strong></td>
        <td><span class="comp-estado-badge ${e.cls}">${e.label}</span></td>
        <td class="cell-muted">${fmtFecha(oc.creadaEn)}</td>
        <td class="cell-muted">${ESC(oc.Sucursal?.nombre) || '—'}</td>
        <td class="cell-num">${fmt(oc.totalEstimado)}</td>
      </tr>`
    }).join('')
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell"><p style="color:#f44336">Error: ${ESC(err.message)}</p></td></tr>`
  }
}

/* ═══════════════════════════════════════════════════════
   ACTIVAR / DESACTIVAR
   ═══════════════════════════════════════════════════════ */

async function toggleActivo() {
  if (!proveedorActual) return
  const accion = proveedorActual.activo ? 'desactivar' : 'activar'
  const nombre = proveedorActual.alias || proveedorActual.nombreOficial
  const ok = await jeshaConfirm({
    title: `${accion === 'desactivar' ? 'Desactivar' : 'Activar'} proveedor`,
    message: `&iquest;${accion === 'desactivar' ? 'Desactivar' : 'Activar'} a <strong>${ESC(nombre)}</strong>?`,
    confirmText: `S&iacute;, ${accion}`,
    type: 'danger'
  })
  if (!ok) return
  try {
    const data = await apiFetch(`/proveedores/${proveedorActual.id}/activar`, { method: 'PATCH' })
    proveedorActual = data.data
    renderDetalle()
    await cargarProveedores()
    jeshaToast(`Proveedor ${accion === 'desactivar' ? 'desactivado' : 'activado'}`, 'success')
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
  }
}

/* ═══════════════════════════════════════════════════════
   CREAR / EDITAR
   ═══════════════════════════════════════════════════════ */

function abrirModalCrear() {
  document.getElementById('modal-proveedor-titulo').textContent = 'Nuevo Proveedor'
  document.getElementById('prov-nombre').value = ''
  document.getElementById('prov-alias').value = ''
  document.getElementById('prov-telefono').value = ''
  document.getElementById('prov-celular').value = ''
  document.getElementById('prov-email').value = ''
  document.getElementById('prov-error').classList.remove('show')
  document.getElementById('modal-proveedor').classList.add('active')
  delete document.getElementById('modal-proveedor').dataset.editId
}

function abrirEditar() {
  const p = proveedorActual
  if (!p) return
  document.getElementById('modal-proveedor-titulo').textContent = 'Editar Proveedor'
  document.getElementById('prov-nombre').value = p.nombreOficial || ''
  document.getElementById('prov-alias').value = p.alias || ''
  document.getElementById('prov-telefono').value = p.telefono || ''
  document.getElementById('prov-celular').value = p.celular || ''
  document.getElementById('prov-email').value = p.email || ''
  document.getElementById('prov-error').classList.remove('show')
  document.getElementById('modal-proveedor').dataset.editId = p.id
  document.getElementById('modal-proveedor').classList.add('active')
}

async function guardarProveedor() {
  const nombre  = document.getElementById('prov-nombre').value.trim()
  const alias   = document.getElementById('prov-alias').value.trim() || null
  const telefono = document.getElementById('prov-telefono').value.trim() || null
  const celular  = document.getElementById('prov-celular').value.trim() || null
  const email    = document.getElementById('prov-email').value.trim() || null
  if (!nombre) { mostrarError('prov-error', 'Nombre oficial requerido'); return }

  const editId = document.getElementById('modal-proveedor').dataset.editId
  const btn = document.getElementById('prov-guardar')
  btn.disabled = true; btn.textContent = 'Guardando...'
  try {
    if (editId) {
      await apiFetch(`/proveedores/${editId}`, { method: 'PUT', body: JSON.stringify({ nombreOficial: nombre, alias, telefono, celular, email }) })
      const data = await apiFetch(`/proveedores/${editId}`)
      if (document.getElementById('modal-detalle').classList.contains('active')) {
        proveedorActual = data.data
        renderDetalle()
      }
    } else {
      await apiFetch('/proveedores', { method: 'POST', body: JSON.stringify({ nombreOficial: nombre, alias, telefono, celular, email }) })
    }
    document.getElementById('modal-proveedor').classList.remove('active')
    paginaActual = 1
    await cargarProveedores()
  } catch (err) {
    mostrarError('prov-error', err.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar'
  }
}




/* ═══════════════════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════════════════ */

function mostrarError(id, msg) {
  const el = document.getElementById(id)
  if (el) { el.textContent = msg; el.classList.add('show') }
}

/* ═══════════════════════════════════════════════════════
   EVENT DELEGATION
   ═══════════════════════════════════════════════════════ */

function setupDelegation() {
  /* Prov table rows + Ver buttons */
  document.getElementById('prov-tbody').addEventListener('click', e => {
    const target = e.target.closest('[data-action]')
    if (!target) return
    if (target.dataset.action === 'ver-proveedor') {
      abrirDetalle(parseInt(target.dataset.id))
    }
  })

  /* Detail modal actions */
  document.getElementById('modal-detalle').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    if (btn.dataset.action === 'editar-proveedor') {
      cerrarDetalle()
      abrirEditar()
    }
    if (btn.dataset.action === 'toggle-activo') {
      toggleActivo()
    }
  })
}

function cerrarDetalle() {
  document.getElementById('modal-detalle').classList.remove('active')
}

/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fecha-actual').textContent =
    new Date().toLocaleDateString('es-MX',{ weekday:'long', year:'numeric', month:'long', day:'numeric' })

  cargarProveedores()
  setupDelegation()

  /* ── BÚSQUEDA / FILTROS ── */
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounceSearch)
    debounceSearch = setTimeout(() => { paginaActual = 1; cargarProveedores() }, 400)
  })
  document.getElementById('filtro-activo')?.addEventListener('change', () => {
    paginaActual = 1; cargarProveedores()
  })

  /* ── PAGINACIÓN ── */
  document.getElementById('btn-prev')?.addEventListener('click', () => {
    if (paginaActual > 1) { paginaActual--; cargarProveedores() }
  })
  document.getElementById('btn-next')?.addEventListener('click', () => {
    paginaActual++; cargarProveedores()
  })

  /* ── MODAL PROVEEDOR ── */
  document.getElementById('btn-nuevo')?.addEventListener('click', abrirModalCrear)
  document.getElementById('prov-close')?.addEventListener('click', () => cerrarModal('modal-proveedor'))
  document.getElementById('prov-cancel')?.addEventListener('click', () => cerrarModal('modal-proveedor'))
  document.getElementById('prov-guardar')?.addEventListener('click', guardarProveedor)
  document.getElementById('prov-nombre')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') guardarProveedor()
  })

  /* ── MODAL DETALLE ── */
  document.getElementById('det-close')?.addEventListener('click', cerrarDetalle)

  /* ── ESC ── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'))
    }
  })
})

function cerrarModal(id) {
  document.getElementById(id)?.classList.remove('active')
}

console.log('✅ proveedores.js cargado')