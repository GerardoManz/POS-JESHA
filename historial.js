// ════════════════════════════════════════════════════════════════════
//  HISTORIAL DE VENTAS — JAVASCRIPT
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')

if (!TOKEN && !window.location.pathname.includes('login.html')) {
  localStorage.setItem('redirect_after_login', 'historial.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

const API_URL = 'http://localhost:3000'
const LIMIT   = 25

// ── ESTADO ──
let paginaActual    = 1
let debounceSearch

// ── HELPERS ──
const fmt = v => `$${parseFloat(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtFecha = iso => iso
  ? new Date(iso).toLocaleString('es-MX', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
  : '—'

const metodoBadge = m => {
  const map = {
    EFECTIVO:       '💵 Efectivo',
    CREDITO:        '💳 Tarjeta',
    DEBITO:         '💳 Tarjeta',
    TRANSFERENCIA:  '🔄 Transf.'
  }
  return `<span class="metodo-badge">${map[m] || m}</span>`
}

// ════════════════════════════════════════════════════════════════════
//  CARGAR CATÁLOGOS (clientes y cajeros para los selects)
// ════════════════════════════════════════════════════════════════════

async function cargarCatalogos() {
  try {
    // Clientes
    const resC = await fetch(`${API_URL}/clientes?activo=true`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (resC.ok) {
      const dataC = await resC.json()
      const clientes = Array.isArray(dataC) ? dataC : (dataC.data || [])
      const selCliente = document.getElementById('filtro-cliente')
      // Opción especial para ventas sin cliente asignado
      const optPublico = document.createElement('option')
      optPublico.value       = 'null'
      optPublico.textContent = 'Público general'
      selCliente.appendChild(optPublico)

      clientes
        .filter(c => c.nombre.toLowerCase() !== 'cliente general' && c.nombre.toLowerCase() !== 'público general')
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .forEach(c => {
          const opt = document.createElement('option')
          opt.value       = c.id
          opt.textContent = c.nombre
          selCliente.appendChild(opt)
        })
    }

    // Usuarios (cajeros)
    const resU = await fetch(`${API_URL}/usuarios`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (resU.ok) {
      const dataU = await resU.json()
      const usuarios = Array.isArray(dataU) ? dataU : (dataU.data || [])
      const selUsuario = document.getElementById('filtro-usuario')
      usuarios
        .filter(u => u.activo)
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .forEach(u => {
          const opt = document.createElement('option')
          opt.value       = u.id
          opt.textContent = u.nombre
          selUsuario.appendChild(opt)
        })
    }
  } catch (e) {
    console.warn('No se pudieron cargar catálogos:', e.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  CARGAR VENTAS
// ════════════════════════════════════════════════════════════════════

async function cargarVentas() {
  const tbody  = document.getElementById('hist-tbody')
  const pagDiv = document.getElementById('pagination')

  tbody.innerHTML = `<tr><td colspan="10" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  const params = construirParams()

  try {
    const res  = await fetch(`${API_URL}/ventas?${params}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!res.ok) throw new Error('Error cargando ventas')

    const data   = await res.json()
    const ventas = data.data || []
    const total  = data.total || 0

    if (ventas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="loading-cell"><p>No se encontraron ventas con los filtros aplicados</p></td></tr>`
      document.getElementById('hist-kpis').style.display = 'none'
      pagDiv.style.display = 'none'
      return
    }

    // Render filas
    tbody.innerHTML = ventas.map(v => `
      <tr onclick="verDetalle(${v.id})">
        <td><strong>${v.folio}</strong></td>
        <td style="color:var(--muted);font-size:0.82rem">${fmtFecha(v.fecha)}</td>
        <td>${v.cliente || '<span style="color:var(--muted)">Público general</span>'}</td>
        <td style="color:var(--muted)">${v.usuario}</td>
        <td>${metodoBadge(v.metodoPago)}</td>
        <td style="text-align:center;color:var(--muted)">${v.productosCount}</td>
        <td><strong>${fmt(v.total)}</strong></td>
        <td><span class="estado-badge ${v.estado.toLowerCase()}">${v.estado === 'COMPLETADA' ? 'Completada' : 'Cancelada'}</span></td>
        <td>
          <button class="btn-ticket-hist" onclick="event.stopPropagation();imprimirTicket(${v.id})" title="Imprimir ticket">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Ticket
          </button>
        </td>
        <td><button class="btn-ver-venta" onclick="event.stopPropagation();verDetalle(${v.id})">Ver</button></td>
      </tr>
    `).join('')

    // KPIs del resultado actual
    actualizarKpis(ventas, total)

    // Paginación
    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} ventas)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else {
      pagDiv.style.display = 'none'
    }

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
    console.error('❌ Error historial:', err)
  }
}

// ════════════════════════════════════════════════════════════════════
//  CONSTRUIR PARAMS DE LA URL
// ════════════════════════════════════════════════════════════════════

function construirParams() {
  const skip    = (paginaActual - 1) * LIMIT
  const search  = document.getElementById('search-input')?.value.trim()
  const desde   = document.getElementById('filtro-desde')?.value
  const hasta   = document.getElementById('filtro-hasta')?.value
  const metodo  = document.getElementById('filtro-metodo')?.value
  const cliente = document.getElementById('filtro-cliente')?.value
  const usuario = document.getElementById('filtro-usuario')?.value

  const p = new URLSearchParams({ skip, take: LIMIT })
  if (search)               p.set('search',     search)
  if (desde)                p.set('desde',      desde)
  if (hasta)                p.set('hasta',      hasta)
  if (metodo)               p.set('metodoPago', metodo)
  if (cliente === 'null')     p.set('clienteId', 'null')  // Público general
  else if (cliente && parseInt(cliente) > 0)
                            p.set('clienteId',  parseInt(cliente))
  if (usuario && usuario !== '0' && parseInt(usuario) > 0)
                            p.set('usuarioId',  parseInt(usuario))

  return p.toString()
}

// ════════════════════════════════════════════════════════════════════
//  KPIS DEL RESULTADO
// ════════════════════════════════════════════════════════════════════

function actualizarKpis(ventas, totalRegistros) {
  let montoTotal = 0, efectivo = 0, tarjeta = 0, transferencia = 0

  ventas.forEach(v => {
    const t = parseFloat(v.total)
    montoTotal += t
    if (v.metodoPago === 'EFECTIVO')                              efectivo     += t
    if (v.metodoPago === 'CREDITO' || v.metodoPago === 'DEBITO') tarjeta       += t
    if (v.metodoPago === 'TRANSFERENCIA')                         transferencia += t
  })

  document.getElementById('kpi-total-ventas').textContent  = totalRegistros
  document.getElementById('kpi-monto-total').textContent   = fmt(montoTotal)
  document.getElementById('kpi-efectivo').textContent      = fmt(efectivo)
  document.getElementById('kpi-tarjeta').textContent       = fmt(tarjeta)
  document.getElementById('kpi-transferencia').textContent = fmt(transferencia)
  document.getElementById('hist-kpis').style.display       = 'grid'
}

// ════════════════════════════════════════════════════════════════════
//  VER DETALLE DE VENTA
// ════════════════════════════════════════════════════════════════════

window.verDetalle = async function(id) {
  try {
    const res  = await fetch(`${API_URL}/ventas/${id}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!res.ok) throw new Error('No se pudo cargar la venta')
    const data = await res.json()
    const v    = data.data

    document.getElementById('det-folio').textContent    = v.folio
    document.getElementById('det-fecha').textContent    = fmtFecha(v.fecha)
    document.getElementById('det-cliente').textContent  = (typeof v.cliente === 'object' ? v.cliente?.nombre : v.cliente) || 'Público general'
    document.getElementById('det-cajero').textContent   = v.usuario || '—'
    document.getElementById('det-sucursal').textContent = v.sucursal || '—'
    document.getElementById('det-metodo').textContent   = { EFECTIVO:'💵 Efectivo', CREDITO:'💳 Tarjeta', DEBITO:'💳 Tarjeta', TRANSFERENCIA:'🔄 Transferencia' }[v.metodoPago] || v.metodoPago
    document.getElementById('det-factura').textContent  = { DISPONIBLE:'Disponible', BLOQUEADA:'Bloqueada', FACTURADA:'Facturada', VENCIDA:'Vencida' }[v.facturaEstado] || v.facturaEstado

    const badge = document.getElementById('det-estado-badge')
    badge.textContent = v.estado === 'COMPLETADA' ? 'Completada' : 'Cancelada'
    badge.className   = `estado-badge ${v.estado.toLowerCase()}`

    document.getElementById('det-items-tbody').innerHTML = (v.detalles || []).map(d => `
      <tr>
        <td>${d.nombre}</td>
        <td style="color:var(--muted);font-size:0.8rem">${d.codigo}</td>
        <td style="text-align:center">${d.cantidad}</td>
        <td>${fmt(d.precioUnitario)}</td>
        <td><strong>${fmt(d.subtotal)}</strong></td>
      </tr>
    `).join('')

    document.getElementById('det-subtotal').textContent  = fmt(v.subtotal)
    document.getElementById('det-descuento').textContent = fmt(v.descuento)
    document.getElementById('det-total').textContent     = fmt(v.total)

    renderAccionesModal(v)
    document.getElementById('modal-venta').classList.add('active')

  } catch (err) {
    alert('Error cargando detalle: ' + err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  LIMPIAR FILTROS
// ════════════════════════════════════════════════════════════════════

function limpiarFiltros() {
  document.getElementById('search-input').value  = ''
  document.getElementById('filtro-desde').value  = ''
  document.getElementById('filtro-hasta').value  = ''
  document.getElementById('filtro-metodo').value  = ''
  document.getElementById('filtro-cliente').value = ''
  document.getElementById('filtro-usuario').value = ''
  paginaActual = 1
  cargarVentas()
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN Y EVENT LISTENERS
// ════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  // Fecha header
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) {
    fechaEl.textContent = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
  }

  await cargarCatalogos()
  cargarVentas()

  // Búsqueda con debounce
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounceSearch)
    debounceSearch = setTimeout(() => { paginaActual = 1; cargarVentas() }, 400)
  })

  // Filtros que disparan inmediato
  ;['filtro-desde','filtro-hasta','filtro-metodo','filtro-cliente','filtro-usuario'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { paginaActual = 1; cargarVentas() })
  })

  // Limpiar
  document.getElementById('btn-limpiar-filtros')?.addEventListener('click', limpiarFiltros)

  // Paginación
  document.getElementById('btn-prev')?.addEventListener('click', () => {
    if (paginaActual > 1) { paginaActual--; cargarVentas() }
  })
  document.getElementById('btn-next')?.addEventListener('click', () => {
    paginaActual++; cargarVentas()
  })

  // Modal cerrar
  document.getElementById('modal-venta-close')?.addEventListener('click', () => {
    document.getElementById('modal-venta').classList.remove('active')
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('modal-venta')?.classList.remove('active')
  })
})

// ════════════════════════════════════════════════════════════════════
//  IMPRIMIR TICKET
// ════════════════════════════════════════════════════════════════════

window.imprimirTicket = function(id) {
  const token = localStorage.getItem('jesha_token')
  const url   = `${API_URL}/ventas/${id}/ticket`
  // Abrir en ventana nueva → el ticket se auto-imprime
  const win = window.open('', '_blank', 'width=420,height=700,scrollbars=yes')
  win.document.write('<html><body style="font-family:sans-serif;text-align:center;padding:20px"><p>Cargando ticket...</p></body></html>')
  fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(r => r.text())
    .then(html => {
      win.document.open()
      win.document.write(html)
      win.document.close()
    })
    .catch(err => {
      win.document.write(`<p style="color:red">Error: ${err.message}</p>`)
    })
}

// Fix 4: añadir botón ticket en modal de detalle
function renderAccionesModal(v) {
  const div = document.getElementById('det-acciones-modal')
  if (!div) return
  div.innerHTML = `
    <button class="btn-ticket-hist" onclick="imprimirTicket(${v.id})" style="margin-top:12px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      🖨️ Imprimir Ticket
    </button>
  `
}

console.log('✅ historial.js cargado')