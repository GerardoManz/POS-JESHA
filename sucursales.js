'use strict'
// ════════════════════════════════════════════════════════════════════════
//  SUCURSALES.JS — Administración de sucursales tenant (solo SUPERADMIN)
//  · Lista activas + inactivas (GET /sucursales/gestion)
//  · Crea/edita/activa/desactiva de forma idempotente
//  · Onboarding cuando la empresa no tiene sucursales activas
// ════════════════════════════════════════════════════════════════════════
const API_URL = (typeof CONFIG !== 'undefined' ? CONFIG.API_URL : null) || window.__JESHA_API_URL__ || 'http://localhost:3000'
const USUARIO = (typeof window !== 'undefined' && window.jeshaSession && window.jeshaSession.getUsuario()) || null

if (!window.jeshaSession || !window.jeshaSession.isValid() || !USUARIO) {
  window.location.replace('login.html')
  throw new Error('Sin auth')
}
if (USUARIO.rol !== 'SUPERADMIN') {
  window.location.replace('dashboard.html')
  throw new Error('Rol sin permiso')
}

const $ = id => (typeof document !== 'undefined' ? document.getElementById(id) : null)
const pag = { pagina: 1, porPagina: 100 }
const estado = { filtro: 'todas', buscar: '', lista: [], total: 0, pagina: 1, porPagina: 100, editando: null }
let nuevaCreadaId = null

function toast(msg, tipo) {
  if (typeof window !== 'undefined' && window.toast) window.toast(msg, tipo)
}
function tokenActual() {
  return (typeof localStorage !== 'undefined' && localStorage.getItem('jesha_token')) || ''
}
function sucursalSeleccionada() {
  try {
    return (typeof window !== 'undefined' && window.jeshaSession) ? window.jeshaSession.getSelectedSucursalId() : null
  } catch (e) {
    return null
  }
}

async function api(url, opts = {}) {
  const headers = { Authorization: `Bearer ${tokenActual()}`, 'Content-Type': 'application/json' }
  const suc = sucursalSeleccionada()
  if (suc) headers['X-Sucursal-Id'] = String(suc)
  const res = await fetch(`${API_URL}${url}`, { ...opts, headers })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || 'Error del servidor')
    err.status = res.status
    err.data = data || {}
    throw err
  }
  return data || {}
}

// ════════════════════════════════════════════════════════════════════════
//  LISTADO
// ════════════════════════════════════════════════════════════════════════
async function cargarSucursales() {
  const par = new URLSearchParams()
  if (estado.filtro !== 'todas') par.set('estado', estado.filtro)
  if (estado.buscar) par.set('buscar', estado.buscar)
  par.set('pagina', String(estado.pagina))
  par.set('porPagina', String(estado.porPagina))
  const data = await api(`/sucursales/gestion?${par.toString()}`)
  estado.lista = data.sucursales || []
  estado.total = data.total || 0
  estado.pagina = data.pagina || 1
  estado.porPagina = data.porPagina || 100
  render()
  return data
}

function render() {
  renderTabla()
  renderOnboarding()
  renderPaginacion()
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function renderTabla() {
  const tbody = document.getElementById('tbody-sucursales')
  if (!tbody) return
  if (!estado.lista.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No hay sucursales que coincidan con la búsqueda.</td></tr>'
    return
  }
  tbody.innerHTML = estado.lista.map(s => {
    const badge = s.activa
      ? '<span class="badge badge-activa">Activa</span>'
      : '<span class="badge badge-inactiva">Inactiva</span>'
    const toggleBoton = s.activa
      ? `<button class="btn-icon desactivar" data-accion="desactivar" data-id="${s.id}" title="Desactivar">⏸</button>`
      : `<button class="btn-icon activar" data-accion="activar" data-id="${s.id}" title="Activar">▶</button>`
    const creada = s.creadaEn ? new Date(s.creadaEn).toLocaleDateString('es-MX') : '-'
    return `<tr>
      <td><div class="suc-nombre">${escapeHtml(s.nombre)}</div></td>
      <td>${escapeHtml(s.codigoPostal)}</td>
      <td>${escapeHtml(s.direccion || '-')}</td>
      <td>${escapeHtml(s.telefono || '-')}</td>
      <td>${badge}</td>
      <td>${creada}</td>
      <td class="td-acciones">
        <div class="actions">
          <button class="btn-icon editar" data-accion="editar" data-id="${s.id}" title="Editar">✎</button>
          ${toggleBoton}
        </div>
      </td>
    </tr>`
  }).join('')
}

function renderOnboarding() {
  const panel = document.getElementById('onboarding-panel')
  if (!panel) return
  const activas = (estado.lista || []).filter(s => s.activa)
  const sinActivas = activas.length === 0
  const acciones = document.getElementById('onboarding-acciones')
  const once = document.getElementById('onboarding-once')
  const titulo = document.getElementById('onboarding-titulo')
  const desc = document.getElementById('onboarding-desc')
  if (sinActivas) {
    panel.hidden = false
    if (titulo) titulo.textContent = 'Aún no tienes sucursales activas'
    if (desc) desc.textContent = 'Crea y activa tu primera sucursal para comenzar a operar.'
    if (acciones) acciones.hidden = false
    if (once) once.hidden = true
    const btn = document.getElementById('btn-onboarding-crear')
    if (btn) btn.textContent = nuevaCreadaId ? 'Crear otra sucursal' : 'Crear mi primera sucursal'
  } else {
    panel.hidden = true
  }
  if (once) {
    once.hidden = !(nuevaCreadaId !== null)
    const btnActivar = document.getElementById('btn-onboarding-activar')
    if (btnActivar) {
      btnActivar.onclick = () => { if (nuevaCreadaId !== null) activarYUsar(nuevaCreadaId) }
    }
  }
}

function renderPaginacion() {
  const el = document.getElementById('paginacion')
  if (!el) return
  const totalPaginas = Math.max(1, Math.ceil(estado.total / estado.porPagina))
  if (estado.total <= estado.porPagina) {
    el.hidden = true
    return
  }
  el.hidden = false
  const info = document.getElementById('paginacion-info')
  if (info) info.textContent = `Página ${estado.pagina} de ${totalPaginas} · ${estado.total} sucursales`
  const prev = document.getElementById('btn-pagina-prev')
  const next = document.getElementById('btn-pagina-next')
  if (prev) prev.disabled = estado.pagina <= 1
  if (next) next.disabled = estado.pagina >= totalPaginas
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL
// ════════════════════════════════════════════════════════════════════════
function abrirModal(sucursal) {
  estado.editando = sucursal || null
  const overlay = document.getElementById('modal-sucursal')
  const titulo = document.getElementById('modal-titulo')
  if (titulo) titulo.textContent = sucursal ? 'Editar sucursal' : 'Nueva sucursal'
  const error = document.getElementById('modal-error')
  if (error) { error.hidden = true; error.textContent = '' }
  const cp = document.getElementById('suc-codigoPostal')
  if (cp) cp.classList.remove('input-error')
  const nombre = document.getElementById('suc-nombre')
  if (nombre) nombre.classList.remove('input-error')
  llenarCampo('suc-nombre', sucursal?.nombre)
  llenarCampo('suc-codigoPostal', sucursal?.codigoPostal)
  llenarCampo('suc-direccion', sucursal?.direccion)
  llenarCampo('suc-telefono', sucursal?.telefono)
  if (overlay) {
    overlay.classList.add('open')
    if (nombre) nombre.focus()
  }
}

function llenarCampo(id, v) {
  const el = document.getElementById(id)
  if (el) el.value = v || ''
}

function cerrarModal() {
  const overlay = document.getElementById('modal-sucursal')
  if (overlay) overlay.classList.remove('open')
  estado.editando = null
  const error = document.getElementById('modal-error')
  if (error) { error.hidden = true; error.textContent = '' }
}

function mostrarErrorModal(msg, campos) {
  const error = document.getElementById('modal-error')
  if (error) { error.textContent = msg; error.hidden = false }
  ;(campos || []).forEach(c => {
    const el = document.getElementById(c)
    if (el) el.classList.add('input-error')
  })
}

// ════════════════════════════════════════════════════════════════════════
//  ACCIONES CRUD
// ════════════════════════════════════════════════════════════════════════
async function guardarSucursal() {
  const nombre = (document.getElementById('suc-nombre')?.value || '').trim()
  const cp = (document.getElementById('suc-codigoPostal')?.value || '').trim()
  const dir = (document.getElementById('suc-direccion')?.value || '').trim()
  const tel = (document.getElementById('suc-telefono')?.value || '').trim()
  const errores = []
  if (!nombre) errores.push('suc-nombre')
  if (nombre && nombre.length < 2) errores.push('suc-nombre')
  if (!cp) errores.push('suc-codigoPostal')
  if (errores.length) {
    mostrarErrorModal('Completa los campos obligatorios (nombre y código postal).', errores)
    return
  }
  const body = { nombre, codigoPostal: cp }
  if (dir) body.direccion = dir
  if (tel) body.telefono = tel
  const btn = document.getElementById('btn-guardar-sucursal')
  if (btn) btn.disabled = true
  try {
    if (estado.editando) {
      await api(`/sucursales/gestion/${estado.editando.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      toast('Sucursal actualizada', 'ok')
    } else {
      const data = await api('/sucursales/gestion', { method: 'POST', body: JSON.stringify(body) })
      nuevaCreadaId = data.sucursal ? data.sucursal.id : null
      toast('Sucursal creada', 'ok')
    }
    cerrarModal()
    await cargarSucursales()
  } catch (err) {
    const campos = (err.data && err.data.errores) ? err.data.errores.map(e => 'suc-' + (e.campo === 'codigoPostal' ? 'codigoPostal' : e.campo)) : []
    mostrarErrorModal(err.message, campos)
  } finally {
    if (btn) btn.disabled = false
  }
}

async function activarSucursal(id) {
  const data = await api(`/sucursales/gestion/${id}/activar`, { method: 'POST' })
  toast('Sucursal activada', 'ok')
  await cargarSucursales()
  return data
}

async function desactivarSucursal(id) {
  const data = await api(`/sucursales/gestion/${id}/desactivar`, { method: 'POST' })
  toast('Sucursal desactivada', 'ok')
  await cargarSucursales()
  return data
}

async function activarYUsar(id) {
  const data = await activarSucursal(id)
  try {
    if (window.jeshaSession) window.jeshaSession.setSelectedSucursalId(Number(id))
  } catch (e) { /* contexto lo resuelve */ }
  window.location.href = 'dashboard.html'
  return data
}

function manejarClickAccion(btn) {
  const id = btn.getAttribute('data-id')
  const accion = btn.getAttribute('data-accion')
  if (!id) return
  if (accion === 'editar') {
    const s = estado.lista.find(s => s.id === Number(id))
    abrirModal(s || { id: Number(id) })
  } else if (accion === 'activar') {
    activarSucursal(id).catch(err => toast(err.message, 'error'))
  } else if (accion === 'desactivar') {
    const confirmacion = (typeof window !== 'undefined' && window.confirm) ? window.confirm('¿Desactivar esta sucursal? Si tiene turnos de caja abiertos se bloqueará.') : true
    if (confirmacion) desactivarSucursal(id).catch(err => toast(err.message, 'error'))
  }
}

function bindEventos() {
  const tbody = document.getElementById('tbody-sucursales')
  if (tbody) tbody.addEventListener('click', e => {
    const btn = e.target.closest ? e.target.closest('[data-accion]') : null
    if (btn) manejarClickAccion(btn)
  })
  const btnNueva = document.getElementById('btn-nueva-sucursal')
  if (btnNueva) btnNueva.addEventListener('click', () => abrirModal(null))
  const btnOnboarding = document.getElementById('btn-onboarding-crear')
  if (btnOnboarding) btnOnboarding.addEventListener('click', () => abrirModal(null))
  const btnCerrar = document.getElementById('btn-cerrar-modal')
  if (btnCerrar) btnCerrar.addEventListener('click', cerrarModal)
  const btnCancelar = document.getElementById('btn-cancelar-modal')
  if (btnCancelar) btnCancelar.addEventListener('click', cerrarModal)
  const overlay = document.getElementById('modal-sucursal')
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) cerrarModal() })
  const form = document.getElementById('form-sucursal')
  if (form) form.addEventListener('submit', e => { e.preventDefault(); guardarSucursal() })
  const filtro = document.getElementById('filtro-estado')
  if (filtro) filtro.addEventListener('change', () => {
    estado.filtro = filtro.value
    estado.pagina = 1
    cargarSucursales()
  })
  const buscar = document.getElementById('buscar-sucursal')
  if (buscar) buscar.addEventListener('input', () => {
    estado.buscar = buscar.value.trim()
    estado.pagina = 1
    cargarSucursales()
  })
  const prev = document.getElementById('btn-pagina-prev')
  if (prev) prev.addEventListener('click', () => {
    if (estado.pagina > 1) { estado.pagina--; cargarSucursales() }
  })
  const next = document.getElementById('btn-pagina-next')
  if (next) next.addEventListener('click', () => {
    estado.pagina++
    cargarSucursales()
  })
}

// ════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════
bindEventos()
window.SucursalesUI = { cargarSucursales, render, renderTabla, renderOnboarding, renderPaginacion, abrirModal, cerrarModal, guardarSucursal, activarSucursal, desactivarSucursal, activarYUsar, manejarClickAccion, estado, getNuevaId: () => nuevaCreadaId }
if (new URLSearchParams(window.location.search).get('nueva') === '1') abrirModal(null)
cargarSucursales().catch(err => toast((err && err.message) || 'Error al cargar sucursales', 'error'))
