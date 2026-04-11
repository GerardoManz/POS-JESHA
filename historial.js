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

const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'
const LIMIT   = 25

// ── ESTADO ──
let paginaActual        = 1
let debounceSearch
let ventaActual         = null
let devVentaData        = null
let devResumenPrevio    = {}
let devTipoSeleccionado = null

// ── HELPERS ──
const fmt = v => `$${parseFloat(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '—'
const metodoBadge = m => {
  const map = {
    EFECTIVO:        '💵 Efectivo',
    CREDITO:         '💳 Tarjeta',
    DEBITO:          '💳 Tarjeta',
    TRANSFERENCIA:   '🔄 Transf.',
    CREDITO_CLIENTE: '🏦 Crédito cliente'
  }
  return `<span class="metodo-badge">${map[m] || m}</span>`
}

// ════════════════════════════════════════════════════════════════════
//  CARGAR CATÁLOGOS
// ════════════════════════════════════════════════════════════════════
async function cargarCatalogos() {
  try {
    const resC = await fetch(`${API_URL}/clientes?activo=true`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    if (window.handle401 && window.handle401(resC.status)) return
    if (resC.ok) {
      const dataC    = await resC.json()
      const clientes = Array.isArray(dataC) ? dataC : (dataC.data || [])
      const sel      = document.getElementById('filtro-cliente')
      const optPub   = document.createElement('option')
      optPub.value   = 'null'; optPub.textContent = 'Público general'
      sel.appendChild(optPub)
      clientes
        .filter(c => !['cliente general','público general'].includes(c.nombre.toLowerCase()))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .forEach(c => {
          const opt = document.createElement('option')
          opt.value = c.id; opt.textContent = c.nombre
          sel.appendChild(opt)
        })
    }

    const resU = await fetch(`${API_URL}/usuarios`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    if (window.handle401 && window.handle401(resU.status)) return
    if (resU.ok) {
      const dataU    = await resU.json()
      const usuarios = Array.isArray(dataU) ? dataU : (dataU.data || [])
      const sel      = document.getElementById('filtro-usuario')
      usuarios.filter(u => u.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)).forEach(u => {
        const opt = document.createElement('option')
        opt.value = u.id; opt.textContent = u.nombre
        sel.appendChild(opt)
      })
    }
  } catch (e) { console.warn('No se pudieron cargar catálogos:', e.message) }
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
    const res   = await fetch(`${API_URL}/ventas?${params}`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    if (window.handle401 && window.handle401(res.status)) return
    if (!res.ok) throw new Error('Error cargando ventas')
    const data  = await res.json()
    const ventas = data.data || []
    const total  = data.total || 0

    if (ventas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="loading-cell"><p>No se encontraron ventas con los filtros aplicados</p></td></tr>`
      document.getElementById('hist-kpis').style.display = 'none'
      pagDiv.style.display = 'none'
      return
    }

    tbody.innerHTML = ventas.map(v => `
      <tr onclick="verDetalle(${v.id})">
        <td><strong>${v.folio}</strong></td>
        <td style="color:var(--muted);font-size:0.82rem">${fmtFecha(v.fecha)}</td>
        <td>${v.cliente || '<span style="color:var(--muted)">Público general</span>'}</td>
        <td style="color:var(--muted)">${v.usuario}</td>
        <td>${metodoBadge(v.metodoPago)}</td>
        <td style="text-align:center;color:var(--muted)">${v.productosCount}</td>
        <td><strong>${fmt(v.total)}</strong></td>
        <td><span class="estado-badge ${v.estado.toLowerCase()}">${{ COMPLETADA: "Completada", CANCELADA: "Cancelada", DEVOLUCION: "Devolución" }[v.estado] || v.estado}</span></td>
        <td>
          <button class="btn-ticket-hist" onclick="event.stopPropagation();imprimirTicket(${v.id})" title="Imprimir ticket">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Ticket
          </button>
        </td>
        <td><button class="btn-ver-venta" onclick="event.stopPropagation();verDetalle(${v.id})">Ver</button></td>
      </tr>
    `).join('')

    actualizarKpis(ventas, total)

    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} ventas)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else { pagDiv.style.display = 'none' }

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
    console.error('❌ Error historial:', err)
  }
}

// ════════════════════════════════════════════════════════════════════
//  CONSTRUIR PARAMS
// ════════════════════════════════════════════════════════════════════
function construirParams() {
  const skip    = (paginaActual - 1) * LIMIT
  const search  = document.getElementById('search-input')?.value.trim()
  const desde   = document.getElementById('filtro-desde')?.value
  const hasta   = document.getElementById('filtro-hasta')?.value
  const metodo  = document.getElementById('filtro-metodo')?.value
  const cliente = document.getElementById('filtro-cliente')?.value
  const usuario = document.getElementById('filtro-usuario')?.value
  const p       = new URLSearchParams({ skip, take: LIMIT })
  if (search)  p.set('search', search)
  if (desde)   p.set('desde', desde)
  if (hasta)   p.set('hasta', hasta)
  if (metodo)  p.set('metodoPago', metodo)
  if (cliente === 'null')                     p.set('clienteId', 'null')
  else if (cliente && parseInt(cliente) > 0)  p.set('clienteId', parseInt(cliente))
  if (usuario && usuario !== '0' && parseInt(usuario) > 0) p.set('usuarioId', parseInt(usuario))
  return p.toString()
}

// ════════════════════════════════════════════════════════════════════
//  KPIS
// ════════════════════════════════════════════════════════════════════
function actualizarKpis(ventas, totalRegistros) {
  let montoTotal = 0, efectivo = 0, tarjeta = 0, transferencia = 0, creditoCliente = 0
  ventas.forEach(v => {
    const t = parseFloat(v.total)
    montoTotal += t
    if (v.metodoPago === 'EFECTIVO')                              efectivo      += t
    if (v.metodoPago === 'CREDITO' || v.metodoPago === 'DEBITO') tarjeta        += t
    if (v.metodoPago === 'TRANSFERENCIA')                         transferencia  += t
    if (v.metodoPago === 'CREDITO_CLIENTE')                       creditoCliente += t
  })
  document.getElementById('kpi-total-ventas').textContent  = totalRegistros
  document.getElementById('kpi-monto-total').textContent   = fmt(montoTotal)
  document.getElementById('kpi-efectivo').textContent      = fmt(efectivo)
  document.getElementById('kpi-tarjeta').textContent       = fmt(tarjeta)
  document.getElementById('kpi-transferencia').textContent = fmt(transferencia)
  const kpiCredEl = document.getElementById('kpi-credito-cliente')
  if (kpiCredEl) kpiCredEl.textContent = fmt(creditoCliente)
  document.getElementById('hist-kpis').style.display       = 'grid'
}

// ════════════════════════════════════════════════════════════════════
//  VER DETALLE
// ════════════════════════════════════════════════════════════════════
window.verDetalle = async function(id) {
  try {
    const res  = await fetch(`${API_URL}/ventas/${id}`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    if (window.handle401 && window.handle401(res.status)) return
    if (!res.ok) throw new Error('No se pudo cargar la venta')
    const data = await res.json()
    const v    = data.data
    ventaActual = v

    document.getElementById('det-folio').textContent    = v.folio
    document.getElementById('det-fecha').textContent    = fmtFecha(v.fecha)
    document.getElementById('det-cliente').textContent  = (typeof v.cliente === 'object' ? v.cliente?.nombre : v.cliente) || 'Público general'
    document.getElementById('det-cajero').textContent   = v.usuario || '—'
    document.getElementById('det-sucursal').textContent = v.sucursal || '—'
    document.getElementById('det-metodo').textContent = {
      EFECTIVO:'💵 Efectivo', CREDITO:'💳 Tarjeta', DEBITO:'💳 Tarjeta',
      TRANSFERENCIA:'🔄 Transferencia', CREDITO_CLIENTE:'🏦 Crédito cliente'
    }[v.metodoPago] || v.metodoPago
    document.getElementById('det-factura').textContent  = {
      DISPONIBLE:'Disponible', BLOQUEADA:'Bloqueada', FACTURADA:'Facturada',
      TIMBRADA:'Timbrada', VENCIDA:'Vencida', CANCELADA:'Cancelada'
    }[v.facturaEstado] || v.facturaEstado

    const badge       = document.getElementById('det-estado-badge')
    const estadoLabel = { COMPLETADA: 'Completada', CANCELADA: 'Cancelada', DEVOLUCION: 'Devolución' }
    badge.textContent = estadoLabel[v.estado] || v.estado
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

    // Mostrar monto pagado y cambio (solo efectivo con monto mayor al total)
    const rowPagado   = document.getElementById('det-row-pagado')
    const rowCambio   = document.getElementById('det-row-cambio')
    const montoPagado = parseFloat(v.montoPagado || 0)
    const totalVenta  = parseFloat(v.total || 0)

    if (v.metodoPago === 'EFECTIVO' && montoPagado > 0 && montoPagado > totalVenta) {
      const cambio = montoPagado - totalVenta
      document.getElementById('det-pagado').textContent = fmt(montoPagado)
      document.getElementById('det-cambio').textContent = fmt(cambio)
      if (rowPagado) rowPagado.style.display = 'flex'
      if (rowCambio) rowCambio.style.display = 'flex'
    } else {
      if (rowPagado) rowPagado.style.display = 'none'
      if (rowCambio) rowCambio.style.display = 'none'
    }

    renderAccionesModal(v)
    document.getElementById('modal-venta').classList.add('active')
  } catch (err) { jeshaToast('Error cargando detalle: ' + err.message, 'error') }
}

// ════════════════════════════════════════════════════════════════════
//  ACCIONES EN MODAL DE DETALLE
// ════════════════════════════════════════════════════════════════════
function renderAccionesModal(v) {
  const div = document.getElementById('det-acciones-modal')
  if (!div) return

  const esSuperAdmin  = ['SUPERADMIN', 'ADMIN_SUCURSAL'].includes(USUARIO.rol)
  const puedeDevolver = v.estado === 'COMPLETADA' || v.estado === 'DEVOLUCION'
  const puedeCancelar = v.estado === 'COMPLETADA' && esSuperAdmin

  // Editar método: solo SUPERADMIN/ADMIN, venta no cancelada, factura no emitida
  const facturasBloqueantes = ['FACTURADA', 'TIMBRADA']
  const puedeEditarMetodo   = esSuperAdmin
    && v.estado !== 'CANCELADA'
    && !facturasBloqueantes.includes(v.facturaEstado)

  const clienteId = v.cliente?.id || null

  const btnTicket = `
    <button class="btn-ticket-hist" onclick="imprimirTicket(${v.id})">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      🖨️ Imprimir Ticket
    </button>`

  const btnDevolver = puedeDevolver ? `
    <button class="btn-devolver-hist" onclick="abrirModalDevolucion(${v.id})">
      ↩️ Devolver productos
    </button>` : ''

  const btnCancelar = puedeCancelar ? `
    <button class="btn-cancelar-venta" onclick="cancelarVenta(${v.id}, '${v.folio}')">
      ✕ Cancelar venta
    </button>` : ''

  const btnEditarMetodo = puedeEditarMetodo ? `
    <button class="btn-editar-metodo" onclick="abrirModalEditarMetodo(${v.id}, '${v.metodoPago}', ${clienteId ? clienteId : 'null'}, ${parseFloat(v.total)})">
      ✏️ Editar método de pago
    </button>` : ''

  div.innerHTML = btnTicket + btnDevolver + btnCancelar + btnEditarMetodo
}

// ════════════════════════════════════════════════════════════════════
//  CANCELAR VENTA
// ════════════════════════════════════════════════════════════════════
function abrirModalCancelacion(id, folio) {
  if (!document.getElementById('modal-cancelar-venta')) {
    const m = document.createElement('div')
    m.id        = 'modal-cancelar-venta'
    m.className = 'modal'
    m.innerHTML = `
      <div class="modal-content" style="max-width:460px;">
        <div class="modal-header">
          <h3 style="color:#ff6b6b;">Cancelar venta</h3>
          <button class="modal-close" onclick="document.getElementById('modal-cancelar-venta').classList.remove('active')">&times;</button>
        </div>
        <div style="padding:20px 22px;">
          <p style="font-size:0.875rem;color:var(--muted);margin-bottom:16px;">
            Esta acción <strong style="color:var(--text)">no se puede deshacer</strong>.
            Se reintegrará el stock y se revertirá el movimiento de caja.
          </p>
          <div class="form-group" style="margin-bottom:16px;">
            <label style="font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:6px;">
              Motivo de cancelación *
            </label>
            <input type="text" id="cancelar-motivo-input"
              placeholder="Ej: Cliente desistió, error en producto..."
              style="width:100%;padding:10px 13px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:9px;color:var(--text);font-family:'Barlow',sans-serif;font-size:0.9rem;outline:none;" />
            <div id="cancelar-motivo-error" style="color:#ff6b6b;font-size:0.78rem;margin-top:4px;display:none;">El motivo es obligatorio</div>
          </div>
          <div id="cancelar-api-error" style="padding:10px 14px;background:rgba(255,107,107,0.08);border-left:3px solid #ff6b6b;border-radius:5px;color:#ff9999;font-size:0.85rem;display:none;margin-bottom:12px;"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="btn-secondary" onclick="document.getElementById('modal-cancelar-venta').classList.remove('active')">
              Cancelar
            </button>
            <button id="cancelar-confirmar-btn" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.35);border-radius:8px;color:#ff6b6b;font-family:'Barlow',sans-serif;font-size:0.875rem;font-weight:700;cursor:pointer;">
              ✕ Confirmar cancelación
            </button>
          </div>
        </div>
      </div>`
    document.body.appendChild(m)
  }

  const input   = document.getElementById('cancelar-motivo-input')
  const errMot  = document.getElementById('cancelar-motivo-error')
  const errApi  = document.getElementById('cancelar-api-error')
  const btnConf = document.getElementById('cancelar-confirmar-btn')
  input.value          = ''
  errMot.style.display = 'none'
  errApi.style.display = 'none'
  btnConf.disabled     = false
  btnConf.textContent  = '✕ Confirmar cancelación'

  btnConf.onclick = async () => {
    const motivo = input.value.trim()
    if (!motivo) { errMot.style.display = 'block'; input.focus(); return }
    errMot.style.display = 'none'
    errApi.style.display = 'none'
    btnConf.disabled    = true
    btnConf.textContent = '⟳ Cancelando...'

    try {
      const res = await fetch(`${API_URL}/ventas/${id}/cancelar`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
        body:    JSON.stringify({ motivo })
      })
      if (window.handle401 && window.handle401(res.status)) return
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cancelar')

      document.getElementById('modal-cancelar-venta').classList.remove('active')
      document.getElementById('modal-venta').classList.remove('active')
      cargarVentas()

      const toast = document.createElement('div')
      toast.textContent = `✓ Venta ${folio} cancelada`
      Object.assign(toast.style, {
        position:'fixed', top:'20px', right:'20px', zIndex:'9999',
        background:'#3a1010', border:'1px solid rgba(255,107,107,0.3)',
        color:'#ff6b6b', padding:'14px 20px', borderRadius:'8px',
        fontSize:'0.875rem', fontWeight:'600',
        boxShadow:'0 4px 16px rgba(0,0,0,0.4)', transition:'opacity 0.4s'
      })
      document.body.appendChild(toast)
      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400) }, 4000)

    } catch (err) {
      errApi.textContent   = err.message
      errApi.style.display = 'block'
      btnConf.disabled     = false
      btnConf.textContent  = '✕ Confirmar cancelación'
    }
  }

  document.getElementById('modal-cancelar-venta').classList.add('active')
  setTimeout(() => input.focus(), 150)
}

window.cancelarVenta = function(id, folio) {
  abrirModalCancelacion(id, folio)
}

// ════════════════════════════════════════════════════════════════════
//  MÓDULO DE DEVOLUCIÓN
// ════════════════════════════════════════════════════════════════════

window.abrirModalDevolucion = async function(ventaId) {
  try {
    const resV = await fetch(`${API_URL}/ventas/${ventaId}`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    if (window.handle401 && window.handle401(resV.status)) return
    if (!resV.ok) throw new Error('No se pudo cargar la venta')
    const dataV  = await resV.json()
    devVentaData = dataV.data

    const resD = await fetch(`${API_URL}/devoluciones/venta/${ventaId}`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    if (window.handle401 && window.handle401(resD.status)) return
    devResumenPrevio = {}
    if (resD.ok) {
      const dataD      = await resD.json()
      devResumenPrevio = dataD.resumenDevuelto || {}
    }

    devTipoSeleccionado = null
    document.querySelectorAll('.dev-tipo-btn').forEach(b => b.classList.remove('active'))
    document.getElementById('dev-motivo').value        = ''
    document.getElementById('dev-notas').value         = ''
    document.getElementById('dev-error').style.display = 'none'
    document.getElementById('dev-confirmar').disabled  = true
    document.getElementById('dev-monto-total').textContent = '$0.00'
    document.getElementById('dev-folio-titulo').textContent = `Devolución — ${devVentaData.folio}`

    const horasTranscurridas = (Date.now() - new Date(devVentaData.fecha).getTime()) / 36e5
    document.getElementById('dev-aviso-tiempo').style.display = horasTranscurridas > 72 ? 'inline-block' : 'none'
    document.getElementById('dev-aviso-factura').style.display = devVentaData.facturaEstado === 'FACTURADA' ? 'block' : 'none'

    renderTablaDevolucion()

    document.getElementById('modal-venta').classList.remove('active')
    document.getElementById('modal-devolucion').classList.add('active')
  } catch (err) {
    jeshaToast('Error al abrir devolución: ' + err.message, 'error')
  }
}

function renderTablaDevolucion() {
  const tbody = document.getElementById('dev-items-tbody')
  if (!tbody || !devVentaData?.detalles) return

  tbody.innerHTML = devVentaData.detalles.map(d => {
    const yaDevuelto    = devResumenPrevio[d.productoId] || 0
    const disponible    = d.cantidad - yaDevuelto
    const deshabilitado = disponible <= 0

    return `
      <tr id="dev-row-${d.productoId}" class="${deshabilitado ? 'dev-row-disabled' : ''}">
        <td style="text-align:center;">
          <input type="checkbox" class="dev-check"
            data-id="${d.productoId}"
            data-precio="${d.precioUnitario}"
            data-disponible="${disponible}"
            ${deshabilitado ? 'disabled' : ''}
            onchange="onDevCheckChange(this)" />
        </td>
        <td>${d.nombre}</td>
        <td style="text-align:center;color:var(--muted)">${d.cantidad}</td>
        <td style="text-align:center;color:var(--muted)">${yaDevuelto > 0 ? yaDevuelto : '—'}</td>
        <td style="text-align:center;color:${disponible > 0 ? 'var(--text)' : '#ff6b6b'};font-weight:600">${disponible}</td>
        <td style="text-align:center;">
          <input type="number" class="dev-cantidad"
            id="dev-cant-${d.productoId}"
            data-id="${d.productoId}"
            data-precio="${d.precioUnitario}"
            data-disponible="${disponible}"
            min="1" max="${disponible}" value="1"
            disabled
            style="width:60px;padding:4px 6px;background:rgba(255,255,255,0.04);border:1px solid var(--panel-border);border-radius:6px;color:var(--text);font-family:'Barlow',sans-serif;font-size:0.875rem;text-align:center;"
            onchange="recalcularMontoDevolucion()" />
        </td>
        <td style="text-align:right;" id="dev-sub-${d.productoId}">—</td>
      </tr>
    `
  }).join('')
}

window.onDevCheckChange = function(checkbox) {
  const productoId = checkbox.dataset.id
  const cantInput  = document.getElementById(`dev-cant-${productoId}`)
  const disponible = parseInt(checkbox.dataset.disponible)

  if (checkbox.checked) {
    cantInput.disabled = false
    cantInput.value    = disponible
  } else {
    cantInput.disabled = true
    cantInput.value    = 1
    document.getElementById(`dev-sub-${productoId}`).textContent = '—'
  }
  recalcularMontoDevolucion()
}

function recalcularMontoDevolucion() {
  let total = 0
  document.querySelectorAll('.dev-check:checked').forEach(chk => {
    const productoId = chk.dataset.id
    const precio     = parseFloat(chk.dataset.precio)
    const disponible = parseInt(chk.dataset.disponible)
    const cantInput  = document.getElementById(`dev-cant-${productoId}`)
    let cantidad     = parseInt(cantInput.value) || 1

    if (cantidad < 1) cantidad = 1
    if (cantidad > disponible) { cantidad = disponible; cantInput.value = disponible }

    const subtotal = precio * cantidad
    total += subtotal
    document.getElementById(`dev-sub-${productoId}`).textContent = fmt(subtotal)
  })
  document.getElementById('dev-monto-total').textContent = fmt(total)
  validarFormularioDevolucion()
}

function validarFormularioDevolucion() {
  const hayProductos = document.querySelectorAll('.dev-check:checked').length > 0
  const hayTipo      = devTipoSeleccionado !== null
  const hayMotivo    = document.getElementById('dev-motivo').value.trim().length > 0
  document.getElementById('dev-confirmar').disabled = !(hayProductos && hayTipo && hayMotivo)
}

async function confirmarDevolucion() {
  const productos = []
  document.querySelectorAll('.dev-check:checked').forEach(chk => {
    const productoId = parseInt(chk.dataset.id)
    const cantidad   = parseInt(document.getElementById(`dev-cant-${productoId}`).value) || 1
    productos.push({ productoId, cantidad })
  })

  if (!productos.length)    return mostrarErrorDev('Selecciona al menos un producto')
  if (!devTipoSeleccionado) return mostrarErrorDev('Selecciona el tipo de resolución')

  const motivo = document.getElementById('dev-motivo').value.trim()
  if (!motivo) return mostrarErrorDev('El motivo es obligatorio')

  // Verificar turno activo antes de proceder
  try {
    const resTurno = await fetch(`${API_URL}/turnos-caja/activo`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(resTurno.status)) return
    if (!resTurno.ok) {
      if (devTipoSeleccionado === 'REEMBOLSO' || devTipoSeleccionado === 'CAMBIO_PARCIAL') {
        const continuar = await jeshaConfirm({
          title: 'Sin turno de caja',
          message: `⚠️ No hay turno de caja abierto.<br><br>El inventario se reintegrará correctamente, <strong>PERO el egreso de caja ($${document.getElementById('dev-monto-total').textContent}) NO quedará registrado</strong> en ningún turno.<br><br>¿Deseas continuar de todas formas?`,
          confirmText: 'Sí, continuar', cancelText: 'Cancelar', type: 'warning'
        })
        if (!continuar) return
      }
    }
  } catch (e) {
    console.warn('No se pudo verificar turno:', e.message)
  }

  const notas  = document.getElementById('dev-notas').value.trim() || null
  const btn    = document.getElementById('dev-confirmar')
  btn.disabled    = true
  btn.textContent = 'Registrando...'
  document.getElementById('dev-error').style.display = 'none'

  try {
    const res = await fetch(`${API_URL}/devoluciones`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify({
        ventaId:       devVentaData.id,
        motivo,
        tipoReembolso: devTipoSeleccionado,
        productos,
        notas
      })
    })
    if (window.handle401 && window.handle401(res.status)) return

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al registrar devolución')

    cerrarModalDevolucion()
    cargarVentas()

    const toast = document.createElement('div')
    let mensajeToast = `✓ Devolución <strong>${data.folio}</strong> registrada — ${fmt(data.data.montoReembolso)}`
    if (data.sinTurno) {
      mensajeToast += `<br><span style="font-size:0.8rem;opacity:0.85">⚠️ Sin turno activo — egreso de caja no registrado</span>`
    }
    toast.innerHTML = mensajeToast
    Object.assign(toast.style, {
      position: 'fixed', top: '20px', right: '20px', zIndex: '9999',
      background: data.sinTurno ? '#3a2a10' : '#1a3a28',
      border: `1px solid ${data.sinTurno ? 'rgba(255,193,7,0.3)' : 'rgba(96,208,128,0.3)'}`,
      color: data.sinTurno ? '#ffc107' : '#60d080',
      padding: '14px 20px', borderRadius: '8px',
      fontSize: '0.875rem', fontWeight: '600',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      transition: 'opacity 0.4s', maxWidth: '380px', lineHeight: '1.5'
    })
    document.body.appendChild(toast)
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400) }, 6000)

    if (devVentaData.facturaEstado === 'FACTURADA') {
      setTimeout(() => jeshaToast('Recuerda emitir la nota de crédito CFDI con tu contador', 'info', 7000), 600)
    }

  } catch (err) {
    mostrarErrorDev(err.message)
  } finally {
    btn.disabled    = false
    btn.textContent = 'Registrar devolución'
  }
}

function mostrarErrorDev(msg) {
  const el = document.getElementById('dev-error')
  el.textContent   = msg
  el.style.display = 'block'
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function cerrarModalDevolucion() {
  document.getElementById('modal-devolucion').classList.remove('active')
  devVentaData        = null
  devResumenPrevio    = {}
  devTipoSeleccionado = null
}

// ════════════════════════════════════════════════════════════════════
//  LIMPIAR FILTROS
// ════════════════════════════════════════════════════════════════════
function limpiarFiltros() {
  document.getElementById('search-input').value   = ''
  document.getElementById('filtro-desde').value   = ''
  document.getElementById('filtro-hasta').value   = ''
  document.getElementById('filtro-metodo').value  = ''
  document.getElementById('filtro-cliente').value = ''
  document.getElementById('filtro-usuario').value = ''
  paginaActual = 1
  cargarVentas()
}

// ════════════════════════════════════════════════════════════════════
//  IMPRIMIR TICKET
// ════════════════════════════════════════════════════════════════════
window.imprimirTicket = function(id) {
  const url = `${API_URL}/ventas/${id}/ticket`
  const win = window.open('', '_blank', 'width=420,height=700,scrollbars=yes')
  win.document.write('<html><body style="font-family:sans-serif;text-align:center;padding:20px"><p>Cargando ticket...</p></body></html>')
  fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    .then(r => r.text())
    .then(html => { win.document.open(); win.document.write(html); win.document.close() })
    .catch(err => { win.document.write(`<p style="color:red">Error: ${err.message}</p>`) })
}

// ════════════════════════════════════════════════════════════════════
//  MODAL EDITAR MÉTODO DE PAGO
// ════════════════════════════════════════════════════════════════════

window.abrirModalEditarMetodo = function(ventaId, metodoActual, clienteId, totalVenta) {
  // Crear modal dinámicamente la primera vez
  if (!document.getElementById('modal-editar-metodo')) {
    const m = document.createElement('div')
    m.id        = 'modal-editar-metodo'
    m.className = 'modal'
    m.innerHTML = `
      <div class="modal-content" style="max-width:480px;">
        <div class="modal-header">
          <h3>Editar método de pago</h3>
          <button class="modal-close" id="modal-editar-metodo-close">&times;</button>
        </div>
        <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">

          <div id="editar-metodo-info" style="
            padding:10px 14px;
            background:rgba(100,160,255,0.07);
            border:1px solid rgba(100,160,255,0.2);
            border-radius:8px;
            color:var(--muted);
            font-size:0.82rem;
            line-height:1.5;
          ">
            Método actual: <strong id="editar-metodo-actual-label" style="color:var(--text)">—</strong><br>
            <span style="font-size:0.78rem;opacity:0.8;">
              Ajusta automáticamente los movimientos de caja y el crédito del cliente.
            </span>
          </div>

          <div>
            <label style="font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:8px;">
              Nuevo método *
            </label>
            <div id="editar-metodo-opciones" style="display:flex;flex-direction:column;gap:6px;">
              <label class="em-opcion" data-v="EFECTIVO">
                <input type="radio" name="nuevo-metodo-pago" value="EFECTIVO" />
                <span style="font-size:16px;">💵</span>
                <span class="em-opcion-label">Efectivo</span>
                <span class="em-badge-actual" style="display:none;">Actual</span>
              </label>
              <label class="em-opcion" data-v="CREDITO">
                <input type="radio" name="nuevo-metodo-pago" value="CREDITO" />
                <span style="font-size:16px;">💳</span>
                <span class="em-opcion-label">Tarjeta crédito</span>
                <span class="em-badge-actual" style="display:none;">Actual</span>
              </label>
              <label class="em-opcion" data-v="DEBITO">
                <input type="radio" name="nuevo-metodo-pago" value="DEBITO" />
                <span style="font-size:16px;">💳</span>
                <span class="em-opcion-label">Tarjeta débito</span>
                <span class="em-badge-actual" style="display:none;">Actual</span>
              </label>
              <label class="em-opcion" data-v="TRANSFERENCIA">
                <input type="radio" name="nuevo-metodo-pago" value="TRANSFERENCIA" />
                <span style="font-size:16px;">🔄</span>
                <span class="em-opcion-label">Transferencia</span>
                <span class="em-badge-actual" style="display:none;">Actual</span>
              </label>
              <label class="em-opcion" data-v="CREDITO_CLIENTE" id="em-opcion-credito-cliente" style="display:none;">
                <input type="radio" name="nuevo-metodo-pago" value="CREDITO_CLIENTE" />
                <span style="font-size:16px;">🏦</span>
                <span class="em-opcion-label">Crédito cliente</span>
                <span class="em-badge-actual" style="display:none;">Actual</span>
              </label>
            </div>
          </div>

          <div id="editar-metodo-efectos" style="
            display:none;
            background:rgba(255,255,255,0.03);
            border:1px solid var(--panel-border);
            border-radius:8px;
            padding:10px 13px;
            font-size:0.8rem;
            color:var(--muted);
            line-height:1.7;
          "></div>

          <div id="editar-metodo-error" style="
            display:none;
            padding:10px 14px;
            background:rgba(255,107,107,0.08);
            border-left:3px solid #ff6b6b;
            border-radius:4px;
            color:#ff9999;
            font-size:0.85rem;
          "></div>

          <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:10px;border-top:1px solid var(--panel-border);">
            <button class="btn-secondary" id="editar-metodo-cancelar-btn">Cancelar</button>
            <button id="editar-metodo-confirmar-btn" class="btn-editar-metodo" disabled style="opacity:0.45;cursor:not-allowed;">
              ✏️ Confirmar cambio
            </button>
          </div>
        </div>
      </div>`
    document.body.appendChild(m)

    // Eventos que solo se bindan una vez
    document.getElementById('modal-editar-metodo-close')
      .addEventListener('click', cerrarModalEditarMetodo)
    document.getElementById('editar-metodo-cancelar-btn')
      .addEventListener('click', cerrarModalEditarMetodo)
  }

  // ── Configurar el modal para esta venta específica ──────────────
  const metodoLabels = {
    EFECTIVO:        '💵 Efectivo',
    CREDITO:         '💳 Tarjeta crédito',
    DEBITO:          '💳 Tarjeta débito',
    TRANSFERENCIA:   '🔄 Transferencia',
    CREDITO_CLIENTE: '🏦 Crédito cliente'
  }

  document.getElementById('editar-metodo-actual-label').textContent = metodoLabels[metodoActual] || metodoActual
  document.getElementById('editar-metodo-error').style.display   = 'none'
  document.getElementById('editar-metodo-efectos').style.display = 'none'

  // Mostrar opción crédito cliente solo si la venta tiene cliente
  document.getElementById('em-opcion-credito-cliente').style.display = clienteId ? 'flex' : 'none'

  // Resetear todas las opciones
  document.querySelectorAll('.em-opcion').forEach(label => {
    const radio   = label.querySelector('input[type="radio"]')
    const badge   = label.querySelector('.em-badge-actual')
    radio.checked = false
    label.classList.remove('em-seleccionada', 'em-actual')
    badge.style.display = 'none'

    if (radio.value === metodoActual) {
      label.classList.add('em-actual')
      badge.style.display = 'inline-block'
    }
  })

  // Reset botón confirmar
  const btnConf = document.getElementById('editar-metodo-confirmar-btn')
  btnConf.disabled      = true
  btnConf.style.opacity = '0.45'
  btnConf.style.cursor  = 'not-allowed'
  btnConf.textContent   = '✏️ Confirmar cambio'

  // Re-bindear radios con el ventaId/total de esta apertura
  document.querySelectorAll('.em-opcion input[type="radio"]').forEach(radio => {
    radio.onchange = () => {
      document.querySelectorAll('.em-opcion').forEach(l => l.classList.remove('em-seleccionada'))
      radio.closest('.em-opcion').classList.add('em-seleccionada')
      btnConf.disabled      = false
      btnConf.style.opacity = '1'
      btnConf.style.cursor  = 'pointer'
      document.getElementById('editar-metodo-error').style.display = 'none'
      mostrarEfectosMetodo(metodoActual, radio.value, clienteId, totalVenta)
    }
  })

  // Re-bindear confirmar con ventaId actual
  btnConf.onclick = () => confirmarCambioMetodo(ventaId)

  document.getElementById('modal-editar-metodo').classList.add('active')
}

function mostrarEfectosMetodo(metodoAnterior, nuevoMetodo, clienteId, totalVenta) {
  const box = document.getElementById('editar-metodo-efectos')
  const metodosConMovimiento = ['EFECTIVO', 'CREDITO', 'DEBITO', 'TRANSFERENCIA']
  const anteriorConMov = metodosConMovimiento.includes(metodoAnterior)
  const nuevoConMov    = metodosConMovimiento.includes(nuevoMetodo)

  let lineas = []

  // Efecto en caja
  if (!anteriorConMov && nuevoConMov) {
    lineas.push('+ Caja: se creará un movimiento VENTA en el turno original')
  } else if (anteriorConMov && !nuevoConMov) {
    lineas.push('− Caja: se eliminará el movimiento de esta venta')
  } else {
    lineas.push('~ Caja: se actualizará el método en el movimiento existente')
  }

  // Efecto en cliente
  if (clienteId) {
    const total = parseFloat(totalVenta || 0)
    if (nuevoMetodo === 'CREDITO_CLIENTE' && metodoAnterior !== 'CREDITO_CLIENTE') {
      lineas.push(`+ Cliente: saldo pendiente aumentará ${fmt(total)}`)
    } else if (metodoAnterior === 'CREDITO_CLIENTE' && nuevoMetodo !== 'CREDITO_CLIENTE') {
      lineas.push(`− Cliente: saldo pendiente disminuirá ${fmt(total)}`)
    }
  }

  // Efecto en factura
  const bloqueaNuevo = nuevoMetodo === 'CREDITO_CLIENTE' || (nuevoMetodo === 'EFECTIVO' && parseFloat(totalVenta) > 2000)
  const bloqueaAnterior = metodoAnterior === 'CREDITO_CLIENTE' || (metodoAnterior === 'EFECTIVO' && parseFloat(totalVenta) > 2000)
  if (bloqueaNuevo && !bloqueaAnterior) {
    lineas.push('! Factura: quedará BLOQUEADA')
  } else if (!bloqueaNuevo && bloqueaAnterior) {
    lineas.push('✓ Factura: se desbloqueará (DISPONIBLE)')
  } else {
    lineas.push('− Factura: sin cambio')
  }

  box.innerHTML  = lineas.join('<br>')
  box.style.display = 'block'
}

function cerrarModalEditarMetodo() {
  document.getElementById('modal-editar-metodo')?.classList.remove('active')
}

async function confirmarCambioMetodo(ventaId) {
  const radioSeleccionado = document.querySelector('.em-opcion input[type="radio"]:checked')
  if (!radioSeleccionado) return

  const nuevoMetodo = radioSeleccionado.value
  const errEl       = document.getElementById('editar-metodo-error')
  const btnConf     = document.getElementById('editar-metodo-confirmar-btn')

  errEl.style.display   = 'none'
  btnConf.disabled      = true
  btnConf.style.opacity = '0.45'
  btnConf.textContent   = '⟳ Guardando...'

  try {
    const res = await fetch(`${API_URL}/ventas/${ventaId}/metodo-pago`, {
      method:  'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({ nuevoMetodo })
    })
    if (window.handle401 && window.handle401(res.status)) return

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al cambiar método de pago')

    cerrarModalEditarMetodo()
    document.getElementById('modal-venta').classList.remove('active')
    cargarVentas()

    const toast = document.createElement('div')
    toast.textContent = `✓ Método de pago actualizado correctamente`
    Object.assign(toast.style, {
      position:'fixed', top:'20px', right:'20px', zIndex:'9999',
      background:'#1a3a28', border:'1px solid rgba(96,208,128,0.3)',
      color:'#60d080', padding:'14px 20px', borderRadius:'8px',
      fontSize:'0.875rem', fontWeight:'600',
      boxShadow:'0 4px 16px rgba(0,0,0,0.4)', transition:'opacity 0.4s'
    })
    document.body.appendChild(toast)
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400) }, 4000)

  } catch (err) {
    errEl.textContent    = err.message
    errEl.style.display  = 'block'
    btnConf.disabled     = false
    btnConf.style.opacity = '1'
    btnConf.textContent  = '✏️ Confirmar cambio'
  }
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) {
    fechaEl.textContent = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
  }

  await cargarCatalogos()
  cargarVentas()

  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounceSearch)
    debounceSearch = setTimeout(() => { paginaActual = 1; cargarVentas() }, 400)
  })

  ;['filtro-desde','filtro-hasta','filtro-metodo','filtro-cliente','filtro-usuario'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { paginaActual = 1; cargarVentas() })
  })

  document.getElementById('btn-limpiar-filtros')?.addEventListener('click', limpiarFiltros)

  document.getElementById('btn-prev')?.addEventListener('click', () => { if (paginaActual > 1) { paginaActual--; cargarVentas() } })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++; cargarVentas() })

  document.getElementById('modal-venta-close')?.addEventListener('click', () => {
    document.getElementById('modal-venta').classList.remove('active')
  })

  // Eventos modal devolución
  document.getElementById('modal-dev-close')?.addEventListener('click', cerrarModalDevolucion)
  document.getElementById('dev-cancelar')?.addEventListener('click', cerrarModalDevolucion)
  document.getElementById('dev-confirmar')?.addEventListener('click', confirmarDevolucion)

  document.querySelectorAll('.dev-motivo-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('dev-motivo').value = chip.dataset.motivo
      document.querySelectorAll('.dev-motivo-chip').forEach(c => c.classList.remove('active'))
      chip.classList.add('active')
      validarFormularioDevolucion()
    })
  })

  document.getElementById('dev-motivo')?.addEventListener('input', () => {
    document.querySelectorAll('.dev-motivo-chip').forEach(c => c.classList.remove('active'))
    validarFormularioDevolucion()
  })

  document.querySelectorAll('.dev-tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dev-tipo-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      devTipoSeleccionado = btn.dataset.tipo

      if (devTipoSeleccionado === 'CAMBIO_PRODUCTO') {
        document.querySelectorAll('.dev-check').forEach(chk => {
          if (chk.disabled) return
          const productoId = chk.dataset.id
          const disponible = parseInt(chk.dataset.disponible)
          const cantInput  = document.getElementById(`dev-cant-${productoId}`)
          chk.checked        = true
          cantInput.disabled = false
          cantInput.value    = disponible
        })
        recalcularMontoDevolucion()
      }

      validarFormularioDevolucion()
    })
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-venta')?.classList.remove('active')
      cerrarModalDevolucion()
      cerrarModalEditarMetodo()
    }
  })
})

console.log('✅ historial.js cargado')

// ── Inyectar estilos extra ──────────────────────────────────────────
;(function() {
  if (!document.getElementById('hist-extra-styles')) {
    const s = document.createElement('style')
    s.id = 'hist-extra-styles'
    s.textContent = `
      .estado-badge.devolucion {
        background: rgba(232,113,10,0.15);
        color: #e8710a;
      }
      .btn-cancelar-venta {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 16px;
        background: rgba(255,107,107,0.1);
        border: 1px solid rgba(255,107,107,0.3);
        border-radius: 8px; color: #ff6b6b;
        font-family: 'Barlow', sans-serif;
        font-size: 0.85rem; font-weight: 700; cursor: pointer;
        transition: all 0.15s;
      }
      .btn-cancelar-venta:hover { background: rgba(255,107,107,0.2); }
      .btn-editar-metodo {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 16px;
        background: rgba(100,160,255,0.1);
        border: 1px solid rgba(100,160,255,0.3);
        border-radius: 8px; color: #64a0ff;
        font-family: 'Barlow', sans-serif;
        font-size: 0.85rem; font-weight: 700; cursor: pointer;
        transition: all 0.15s;
      }
      .btn-editar-metodo:hover { background: rgba(100,160,255,0.2); }
      .em-opcion {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 13px;
        background: rgba(255,255,255,0.03);
        border: 1px solid var(--panel-border);
        border-radius: 8px; cursor: pointer;
        font-family: 'Barlow', sans-serif;
        font-size: 0.875rem; color: var(--text);
        transition: all 0.12s;
        user-select: none;
      }
      .em-opcion:hover:not(.em-actual) {
        border-color: rgba(100,160,255,0.4);
        background: rgba(100,160,255,0.06);
      }
      .em-opcion.em-actual {
        opacity: 0.42;
        cursor: not-allowed;
        pointer-events: none;
      }
      .em-opcion.em-seleccionada {
        border-color: rgba(100,160,255,0.5);
        background: rgba(100,160,255,0.1);
      }
      .em-opcion input[type="radio"] {
        accent-color: #64a0ff;
        width: 15px; height: 15px;
        flex-shrink: 0;
      }
      .em-opcion-label { flex: 1; }
      .em-badge-actual {
        font-size: 0.7rem;
        padding: 2px 7px;
        background: rgba(255,255,255,0.06);
        border: 1px solid var(--panel-border);
        border-radius: 4px;
        color: var(--muted);
      }
    `
    document.head.appendChild(s)
  }
})()