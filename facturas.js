// ════════════════════════════════════════════════════════════════════
//  FACTURAS.JS — Módulo admin de facturas (Fase 4)
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : `http://${window.location.hostname}:3000`

if (!TOKEN) { window.location.href = 'login.html'; throw new Error() }

const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'

let facturasList = []
let paginaActual = 1
const POR_PAGINA = 20

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX',{weekday:'long',year:'numeric',month:'long',day:'numeric'})

  cargarFacturas()
  configurarEventos()
})

// ════════════════════════════════════════════════════════════════════
//  CARGAR FACTURAS
// ════════════════════════════════════════════════════════════════════

async function cargarFacturas() {
  mostrarLoading()
  try {
    const params = new URLSearchParams()
    const busq   = document.getElementById('search-input')?.value?.trim()
    const desde  = document.getElementById('filtro-desde')?.value
    const hasta  = document.getElementById('filtro-hasta')?.value
    const estado = document.getElementById('filtro-estado')?.value

    if (busq)   params.set('q', busq)
    if (desde)  params.set('desde', desde)
    if (hasta)  params.set('hasta', hasta)
    if (estado) params.set('estado', estado)
    params.set('page', paginaActual)
    params.set('take', POR_PAGINA)

    const res  = await fetch(`${API_URL}/facturas?${params}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!res.ok) throw new Error(`Error ${res.status}`)
    const data = await res.json()

    facturasList = data.data || []
    renderTabla(facturasList)
    renderKPIs(data.stats || {})
    renderPaginacion(data.total || 0)

  } catch (err) {
    console.error('❌ Error cargando facturas:', err)
    document.getElementById('fact-tbody').innerHTML = `
      <tr><td colspan="8" class="loading-cell" style="color:#ff9999;">
        ❌ Error: ${err.message}
        <br/><button onclick="cargarFacturas()" class="btn-secondary" style="margin-top:12px;">Reintentar</button>
      </td></tr>`
  }
}

// ════════════════════════════════════════════════════════════════════
//  RENDER TABLA
// ════════════════════════════════════════════════════════════════════

function renderTabla(facturas) {
  const tbody = document.getElementById('fact-tbody')
  if (facturas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">No hay facturas para mostrar</td></tr>`
    return
  }

  tbody.innerHTML = facturas.map(f => {
    const estadoCls = (f.estado || '').toLowerCase().replace('_', '')
    const badgeLabel = {
      PENDIENTE_TIMBRADO: '⏳ Pendiente',
      TIMBRADA:           '✅ Timbrada',
      CANCELADA:          '❌ Cancelada',
      FACTURADA:          '✅ Timbrada',
    }[f.estado] || f.estado

    const uuidCorto = f.folioFiscal
      ? `<span class="uuid-corto">${f.folioFiscal.substring(0,8)}...</span>`
      : '<span style="color:var(--muted);font-size:0.78rem;">Sin UUID</span>'

    return `<tr onclick="verFactura(${f.id})">
      <td><strong>${f.venta?.folio || '—'}</strong></td>
      <td style="color:var(--muted);font-size:0.82rem;">${fmtFecha(f.creadaEn)}</td>
      <td style="font-family:monospace;font-size:0.82rem;">${f.rfcReceptor || '—'}</td>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${f.nombreReceptor || ''}">${f.nombreReceptor || '—'}</td>
      <td><strong>${fmt(f.total)}</strong></td>
      <td><span class="fact-badge ${estadoCls}">${badgeLabel}</span></td>
      <td>${uuidCorto}</td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:6px;">
          <button class="btn-secondary" style="padding:4px 10px;font-size:0.78rem;"
                  onclick="verFactura(${f.id})">Ver</button>
          ${f.estado === 'PENDIENTE_TIMBRADO' ? `
            <button class="btn-danger" style="padding:4px 10px;font-size:0.78rem;"
                    onclick="cancelarFactura(${f.id})">Cancelar</button>
          ` : ''}
          ${(f.estado === 'TIMBRADA' || f.estado === 'FACTURADA') && f.pdfUrl ? `
            <a href="${f.pdfUrl}" target="_blank" class="btn-secondary" style="padding:4px 10px;font-size:0.78rem;text-decoration:none;">PDF</a>
          ` : ''}
          ${(f.estado === 'TIMBRADA' || f.estado === 'FACTURADA') && f.xmlUrl ? `
            <a href="${f.xmlUrl}" target="_blank" class="btn-secondary" style="padding:4px 10px;font-size:0.78rem;text-decoration:none;">XML</a>
          ` : ''}
        </div>
      </td>
    </tr>`
  }).join('')
}

// ════════════════════════════════════════════════════════════════════
//  RENDER KPIs
// ════════════════════════════════════════════════════════════════════

function renderKPIs(stats) {
  document.getElementById('kpi-total').textContent      = stats.total      || facturasList.length
  document.getElementById('kpi-pendientes').textContent = stats.pendientes  || facturasList.filter(f => f.estado === 'PENDIENTE_TIMBRADO').length
  document.getElementById('kpi-timbradas').textContent  = stats.timbradas   || facturasList.filter(f => ['TIMBRADA','FACTURADA'].includes(f.estado)).length
  document.getElementById('kpi-canceladas').textContent = stats.canceladas  || facturasList.filter(f => f.estado === 'CANCELADA').length
}

// ════════════════════════════════════════════════════════════════════
//  PAGINACIÓN
// ════════════════════════════════════════════════════════════════════

function renderPaginacion(total) {
  const totalPags = Math.ceil(total / POR_PAGINA)
  const pagDiv    = document.getElementById('pagination')
  const pagInfo   = document.getElementById('pag-info')
  const btnPrev   = document.getElementById('btn-prev')
  const btnNext   = document.getElementById('btn-next')

  if (totalPags <= 1) { pagDiv.style.display = 'none'; return }
  pagDiv.style.display = 'flex'
  pagInfo.textContent  = `Página ${paginaActual} de ${totalPags}`
  btnPrev.disabled     = paginaActual <= 1
  btnNext.disabled     = paginaActual >= totalPags
}

// ════════════════════════════════════════════════════════════════════
//  VER DETALLE
// ════════════════════════════════════════════════════════════════════

function verFactura(id) {
  const f = facturasList.find(x => x.id === id)
  if (!f) return

  const estadoCls = (f.estado || '').toLowerCase().replace('_','')
  const badgeLabel = {
    PENDIENTE_TIMBRADO: '⏳ Pendiente timbrado',
    TIMBRADA:           '✅ Timbrada',
    CANCELADA:          '❌ Cancelada',
    FACTURADA:          '✅ Timbrada',
  }[f.estado] || f.estado

  document.getElementById('mf-folio').textContent        = `Factura #${f.id}`
  document.getElementById('mf-estado-badge').textContent = badgeLabel
  document.getElementById('mf-estado-badge').className   = `fact-badge ${estadoCls}`
  document.getElementById('mf-venta-folio').textContent  = f.venta?.folio || '—'
  document.getElementById('mf-fecha').textContent        = fmtFecha(f.creadaEn)
  document.getElementById('mf-total').textContent        = fmt(f.total)
  document.getElementById('mf-rfc').textContent          = f.rfcReceptor || '—'
  document.getElementById('mf-razon').textContent        = f.nombreReceptor || '—'
  document.getElementById('mf-regimen').textContent      = f.regimenFiscal || f.regimenReceptor || '—'
  document.getElementById('mf-cp').textContent           = f.cpReceptor || '—'
  document.getElementById('mf-uso').textContent          = f.usoCfdi || '—'
  document.getElementById('mf-email').textContent        = f.emailReceptor || '—'

  // UUID
  const uuidSection = document.getElementById('mf-uuid-section')
  if (f.folioFiscal) {
    document.getElementById('mf-uuid').textContent = f.folioFiscal
    uuidSection.style.display = 'block'
  } else {
    uuidSection.style.display = 'none'
  }

  // Acciones del modal
  const acciones = document.getElementById('fact-modal-acciones')
  acciones.innerHTML = ''

  if (f.estado === 'PENDIENTE_TIMBRADO') {
    // Fase 3 — cuando haya PAC
    const btnTimbrar = document.createElement('button')
    btnTimbrar.className = 'btn-primary'
    btnTimbrar.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Timbrar (requiere SICAR)`
    btnTimbrar.disabled = true
    btnTimbrar.title = 'Disponible en Fase 3 — integración con PAC SICAR'
    btnTimbrar.style.opacity = '0.5'
    acciones.appendChild(btnTimbrar)

    const btnCancelar = document.createElement('button')
    btnCancelar.className = 'btn-danger'
    btnCancelar.innerHTML = '❌ Cancelar solicitud'
    btnCancelar.onclick = () => { cancelarFactura(f.id); cerrarModal() }
    acciones.appendChild(btnCancelar)
  }

  if ((f.estado === 'TIMBRADA' || f.estado === 'FACTURADA')) {
    if (f.pdfUrl) {
      const btnPdf = document.createElement('a')
      btnPdf.href = f.pdfUrl; btnPdf.target = '_blank'
      btnPdf.className = 'btn-secondary'
      btnPdf.innerHTML = '📄 Descargar PDF'
      acciones.appendChild(btnPdf)
    }
    if (f.xmlUrl) {
      const btnXml = document.createElement('a')
      btnXml.href = f.xmlUrl; btnXml.target = '_blank'
      btnXml.className = 'btn-secondary'
      btnXml.innerHTML = '📋 Descargar XML'
      acciones.appendChild(btnXml)
    }
    const btnCancelar = document.createElement('button')
    btnCancelar.className = 'btn-danger'
    btnCancelar.innerHTML = '❌ Cancelar factura'
    btnCancelar.onclick = () => { cancelarFactura(f.id); cerrarModal() }
    acciones.appendChild(btnCancelar)
  }

  document.getElementById('modal-factura').classList.add('active')
}

function cerrarModal() {
  document.getElementById('modal-factura').classList.remove('active')
}

// ════════════════════════════════════════════════════════════════════
//  CANCELAR FACTURA
// ════════════════════════════════════════════════════════════════════

async function cancelarFactura(id) {
  if (!confirm('¿Cancelar esta solicitud de factura? Esta acción no se puede deshacer.')) return
  try {
    const res = await fetch(`${API_URL}/facturas/${id}/cancelar`, {
      method:  'PATCH',
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!res.ok) throw new Error(`Error ${res.status}`)
    await cargarFacturas()
    mostrarToast('✅ Factura cancelada correctamente')
  } catch (err) {
    alert('❌ Error: ' + err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════

function mostrarLoading() {
  document.getElementById('fact-tbody').innerHTML = `
    <tr><td colspan="8" class="loading-cell">
      <div class="spinner"></div><p>Cargando facturas...</p>
    </td></tr>`
}

function mostrarToast(msg) {
  const t = document.createElement('div')
  t.textContent = msg
  Object.assign(t.style, {
    position:'fixed', top:'20px', right:'20px', zIndex:'9999',
    background:'#1a3a1a', color:'#60d080', padding:'12px 20px',
    borderRadius:'8px', fontSize:'0.875rem', fontWeight:'600',
    border:'1px solid rgba(96,208,128,0.3)',
    boxShadow:'0 4px 16px rgba(0,0,0,0.4)', transition:'opacity 0.4s'
  })
  document.body.appendChild(t)
  setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.remove(),400) }, 2500)
}

// ════════════════════════════════════════════════════════════════════
//  EVENTOS
// ════════════════════════════════════════════════════════════════════

function configurarEventos() {
  // Cerrar modal
  document.getElementById('modal-factura-close')?.addEventListener('click', cerrarModal)
  document.getElementById('modal-factura')?.addEventListener('click', e => { if (e.target.id === 'modal-factura') cerrarModal() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal() })

  // Filtros
  let debounce
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounce); debounce = setTimeout(() => { paginaActual=1; cargarFacturas() }, 400)
  })
  document.getElementById('filtro-desde')?.addEventListener('change', () => { paginaActual=1; cargarFacturas() })
  document.getElementById('filtro-hasta')?.addEventListener('change', () => { paginaActual=1; cargarFacturas() })
  document.getElementById('filtro-estado')?.addEventListener('change', () => { paginaActual=1; cargarFacturas() })

  // Limpiar
  document.getElementById('btn-limpiar')?.addEventListener('click', () => {
    document.getElementById('search-input').value  = ''
    document.getElementById('filtro-desde').value  = ''
    document.getElementById('filtro-hasta').value  = ''
    document.getElementById('filtro-estado').value = ''
    paginaActual = 1
    cargarFacturas()
  })

  // Paginación
  document.getElementById('btn-prev')?.addEventListener('click', () => { paginaActual--; cargarFacturas() })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++; cargarFacturas() })
}

console.log('✅ facturas.js cargado')