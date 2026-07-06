;(function() {
  try {
    const rol = JSON.parse(localStorage.getItem('jesha_usuario') || '{}').rol || 'EMPLEADO'
    if (['EMPLEADO'].includes(rol)) {
      window.location.replace('punto-venta.html')
    }
  } catch(e) { window.location.replace('punto-venta.html') }
})()

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')

if (!TOKEN) {
  window.location.href = 'login.html'
  throw new Error('Sin auth')
}

const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

// ── DOM ──
const filtroFecha   = document.getElementById('filtro-fecha')
const filtroCajero  = document.getElementById('filtro-cajero')
const btnBuscar     = document.getElementById('btn-buscar')
const btnLimpiar    = document.getElementById('btn-limpiar')
const tablaBody     = document.getElementById('tabla-cortes-body')
const pagination    = document.getElementById('pagination-operativo')
const pageInfo      = document.getElementById('page-info')
const btnAnt        = document.getElementById('btn-ant')
const btnSig        = document.getElementById('btn-sig')
const contableDesde = document.getElementById('contable-desde')
const contableHasta = document.getElementById('contable-hasta')
const btnGenerar    = document.getElementById('btn-generar-resumen')
const btnExportar   = document.getElementById('btn-exportar')
const contableEmpty = document.getElementById('contable-empty')
const contableResult= document.getElementById('contable-resultados')
const resumenBody   = document.getElementById('tabla-resumen-body')
const offcanvas     = document.getElementById('offcanvas-corte')
const offcanvasOvl  = document.getElementById('offcanvas-overlay')
const offcanvasCls  = document.getElementById('offcanvas-close')
const ticketIframe  = document.getElementById('ticket-iframe')

let paginaActual    = 1
let totalPaginas    = 1
let totalGlobal     = null
let _ultimoTurnoId  = null

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  initTabs()
  initFiltros()
  initOffcanvas()
  cargarCajeros()
  buscar()
  initContable()
})

// ── TABS ──
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      btn.classList.add('active')
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active')
    })
  })
}

// ── TAB OPERATIVO ──
function initFiltros() {
  btnBuscar.addEventListener('click', () => { paginaActual = 1; buscar() })
  btnLimpiar.addEventListener('click', limpiarFiltros)
  btnAnt.addEventListener('click', () => { if (paginaActual > 1) { paginaActual--; buscar() } })
  btnSig.addEventListener('click', () => { if (paginaActual < totalPaginas) { paginaActual++; buscar() } })

  filtroFecha.addEventListener('keydown', e => { if (e.key === 'Enter') buscar() })
}

function limpiarFiltros() {
  filtroFecha.value  = ''
  filtroCajero.value = ''
  paginaActual = 1
  buscar()
}

async function cargarCajeros() {
  try {
    const res = await fetch(`${API_URL}/usuarios/vendedores`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!res.ok) return
    const users = await res.json()
    filtroCajero.innerHTML = '<option value="">Todos</option>'
    users.forEach(u => {
      const opt = document.createElement('option')
      opt.value = u.id
      opt.textContent = u.nombre
      filtroCajero.appendChild(opt)
    })
  } catch(e) { console.warn('Error cargando cajeros:', e) }
}

async function buscar() {
  tablaBody.innerHTML = `<tr class="spinner-row"><td colspan="10"><div class="loading-spinner"></div></td></tr>`

  const params = new URLSearchParams({ page: paginaActual, limit: 20 })
  if (filtroFecha.value)  params.set('fecha', filtroFecha.value)
  if (filtroCajero.value) params.set('usuarioId', filtroCajero.value)

  try {
    const res = await fetch(`${API_URL}/turnos-caja/historial?${params}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(res.status)) return
    if (!res.ok) throw new Error('Error en respuesta')

    const data = await res.json()
    totalGlobal = data.data
    totalPaginas = data.data.pagination.totalPages

    renderTabla(data.data.turnos)
    renderPagination(data.data.pagination)
  } catch(err) {
    console.error('❌ Error buscando cortes:', err)
    tablaBody.innerHTML = `<tr class="empty-row"><td colspan="10">Error al cargar datos</td></tr>`
    pagination.style.display = 'none'
  }
}

function renderTabla(turnos) {
  if (!turnos || turnos.length === 0) {
    tablaBody.innerHTML = `<tr class="empty-row"><td colspan="10">No hay cortes en este período</td></tr>`
    pagination.style.display = 'none'
    return
  }

  tablaBody.innerHTML = turnos.map(t => {
    const diff = parseFloat(t.diferencia) || 0
    const diffClass = diff === 0 ? 'diff-zero' : diff > 0 ? 'diff-ok' : 'diff-mal'
    const diffSign  = diff >= 0 ? '+' : '-'
    const diffStr   = diff === 0 ? '$0.00' : `${diffSign}${fmt(Math.abs(diff))}`

    const cierre = t.cerradaEn ? new Date(t.cerradaEn) : null
    const fechaStr = cierre
      ? `${String(cierre.getDate()).padStart(2,'0')}/${String(cierre.getMonth()+1).padStart(2,'0')} ${String(cierre.getHours()).padStart(2,'0')}:${String(cierre.getMinutes()).padStart(2,'0')}`
      : '—'

    return `<tr onclick="abrirTicket(${t.id})">
      <td>#${t.id}</td>
      <td>${fechaStr}</td>
      <td>${t.Usuario?.nombre || '—'}</td>
      <td>${t.Sucursal?.nombre || '—'}</td>
      <td>${fmt(t.totalEfectivo || 0)}</td>
      <td>${fmt(t.totalTarjeta || 0)}</td>
      <td>${fmt(t.totalTransferencia || 0)}</td>
      <td>${fmt(t.montoFinalDeclarado)}</td>
      <td class="${diffClass}">${diffStr}</td>
      <td>
        <button class="btn-icon" title="Ver ticket" onclick="event.stopPropagation();abrirTicket(${t.id})">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
          </svg>
        </button>
      </td>
    </tr>`
  }).join('')
}

function renderPagination(p) {
  if (p.totalPages > 1) {
    pagination.style.display = 'flex'
    pageInfo.textContent = `Página ${p.page} de ${p.totalPages || 1}`
    btnAnt.disabled = p.page <= 1
    btnSig.disabled = p.page >= p.totalPages
  } else {
    pagination.style.display = 'none'
  }
}

// ── OFF-CANVAS TICKET ──
function initOffcanvas() {
  offcanvasCls.addEventListener('click', cerrarTicket)
  offcanvasOvl.addEventListener('click', cerrarTicket)
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarTicket() })
}

window.abrirTicket = function(turnoId) {
  _ultimoTurnoId = turnoId
  ticketIframe.src = `${API_URL}/turnos-caja/${turnoId}/ticket?token=${TOKEN}`
  offcanvas.classList.add('active')
  offcanvasOvl.classList.add('active')
  document.body.style.overflow = 'hidden'
}

window.descargarPDF = async function() {
  if (!_ultimoTurnoId) return
  try {
    const r = await fetch(`${API_URL}/impresion/job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ tipo: 'CORTE', turnoId: _ultimoTurnoId })
    })
    if (r.ok) {
      jeshaToast('✅ Corte enviado a impresora', 'success')
    } else {
      const d = await r.json().catch(() => ({}))
      jeshaToast(d.error || 'Error al imprimir', 'warning')
    }
  } catch (e) {
    jeshaToast('❌ Error de conexión', 'error')
  }
}

function cerrarTicket() {
  offcanvas.classList.remove('active')
  offcanvasOvl.classList.remove('active')
  document.body.style.overflow = ''
  ticketIframe.src = ''
}

// ── TAB CONTABLE ──
function initContable() {
  const hoy = new Date()
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  contableDesde.value = primerDia.toISOString().split('T')[0]
  contableHasta.value = hoy.toISOString().split('T')[0]

  btnGenerar.addEventListener('click', generarResumenContable)
  btnExportar.addEventListener('click', exportarCSV)
}

async function generarResumenContable() {
  if (!contableDesde.value || !contableHasta.value) {
    alert('Selecciona un rango de fechas')
    return
  }

  const params = new URLSearchParams({
    fechaDesde: contableDesde.value,
    fechaHasta: contableHasta.value
  })

  try {
    const res = await fetch(`${API_URL}/turnos-caja/resumen-contable?${params}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(res.status)) return
    if (!res.ok) throw new Error('Error')

    const data = await res.json()
    renderResumenContable(data.data)
  } catch(err) {
    console.error('❌ Error resumen contable:', err)
    alert('Error al generar resumen')
  }
}

function renderResumenContable(data) {
  contableEmpty.style.display = 'none'
  contableResult.style.display = 'block'
  btnExportar.style.display = 'inline-flex'

  document.getElementById('kc-total').textContent      = data.totales.totalVentas
  document.getElementById('kc-cortes').textContent     = data.totales.totalTurnos
  document.getElementById('kc-efectivo').textContent   = fmt(data.totales.totalEfectivo)
  document.getElementById('kc-tarjeta').textContent    = fmt(data.totales.totalTarjeta)
  document.getElementById('kc-transferencia').textContent = fmt(data.totales.totalTransferencia)
  document.getElementById('kc-general').textContent    = fmt(data.totales.totalGeneral)

  if (!data.resumenTurnos || data.resumenTurnos.length === 0) {
    resumenBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">Sin datos en este período</td></tr>'
    return
  }

  resumenBody.innerHTML = data.resumenTurnos.map(r => {
    const diff = parseFloat(r.totalDiferencia) || 0
    const diffClass = diff === 0 ? 'diff-zero' : diff > 0 ? 'diff-ok' : 'diff-mal'
    const diffSign  = diff >= 0 ? '+' : '-'
    return `<tr>
      <td>${r.nombreSucursal}</td>
      <td>${r.numCortes}</td>
      <td>${fmt(r.totalInicial)}</td>
      <td>${fmt(r.totalDeclarado)}</td>
      <td>${fmt(r.totalCalculado)}</td>
      <td class="${diffClass}">${diff === 0 ? '$0.00' : diffSign + fmt(Math.abs(diff))}</td>
    </tr>`
  }).join('')
}

// ── EXPORTAR CSV ──
function exportarCSV() {
  if (!totalGlobal) return

  const cortes = totalGlobal.turnos
  const desde   = contableDesde.value
  const hasta   = contableHasta.value

  const headers = ['ID','Fecha Apertura','Fecha Cierre','Cajero','Sucursal','Monto Inicial','Declarado','Calculado','Diferencia','Notas']

  const rows = cortes.map(t => {
    const diff = parseFloat(t.diferencia) || 0
    return [
      t.id,
      t.abiertaEn ? new Date(t.abiertaEn).toLocaleString('es-MX') : '',
      t.cerradaEn ? new Date(t.cerradaEn).toLocaleString('es-MX') : '',
      t.Usuario?.nombre || '',
      t.Sucursal?.nombre || '',
      parseFloat(t.montoInicial || 0).toFixed(2),
      parseFloat(t.montoFinalDeclarado || 0).toFixed(2),
      parseFloat(t.montoCalculado || 0).toFixed(2),
      diff.toFixed(2),
      (t.notasCierre || '').replace(/"/g, '""')
    ]
  })

  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(cell => {
      const s = String(cell)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }).join(','))
  ].join('\n')

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `cortes_${desde}_${hasta}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(v) {
  return `$${parseFloat(v || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

console.log('✅ historial-cortes.js cargado')