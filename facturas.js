// ════════════════════════════════════════════════════════════════════
//  FACTURAS.JS — Panel interno de administración de facturas CFDI
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'facturas.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

const fmt = v => `$${parseFloat(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

let paginaActual = 1
const LIMIT      = 20
let debounce

// ════════════════════════════════════════════════════════════════════
//  ESTADO BADGES
// ════════════════════════════════════════════════════════════════════
function estadoBadge(estado) {
  const map = {
    PENDIENTE_TIMBRADO: ['badge-pendiente',  '⏳ Pendiente'],
    TIMBRADA:           ['badge-timbrada',   '✓ Timbrada'],
    FACTURADA:          ['badge-timbrada',   '✓ Facturada'],
    CANCELADA:          ['badge-cancelada',  '✕ Cancelada'],
    VENCIDA:            ['badge-vencida',    '⚠ Vencida'],
    BLOQUEADA:          ['badge-bloqueada',  '🔒 Bloqueada'],
  }
  const [cls, label] = map[estado] || ['badge-pendiente', estado]
  return `<span class="fact-badge ${cls}">${label}</span>`
}

// ════════════════════════════════════════════════════════════════════
//  CARGAR FACTURAS
// ════════════════════════════════════════════════════════════════════
async function cargarFacturas() {
  const tbody  = document.getElementById('fact-tbody')
  const pagDiv = document.getElementById('pagination')
  tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  const q      = document.getElementById('search-input')?.value.trim() || ''
  const estado = document.getElementById('filtro-estado')?.value || ''
  const desde  = document.getElementById('filtro-desde')?.value || ''
  const hasta  = document.getElementById('filtro-hasta')?.value || ''

  const params = new URLSearchParams({ page: paginaActual, take: LIMIT })
  if (q)      params.set('q', q)
  if (estado) params.set('estado', estado)
  if (desde)  params.set('desde', desde)
  if (hasta)  params.set('hasta', hasta)

  try {
    const res  = await fetch(`${API_URL}/facturas?${params}`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    if (window.handle401 && window.handle401(res.status)) return
    const data = await res.json()

    if (!res.ok) throw new Error(data.error || 'Error cargando facturas')

    // Stats
    if (data.stats) {
      document.getElementById('stat-total').textContent      = data.stats.total || 0
      document.getElementById('stat-pendientes').textContent = data.stats.pendientes || 0
      document.getElementById('stat-timbradas').textContent  = data.stats.timbradas || 0
      document.getElementById('stat-canceladas').textContent = data.stats.canceladas || 0
    }

    const lista = data.data || []
    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p>No se encontraron facturas con los filtros aplicados</p></td></tr>`
      pagDiv.style.display = 'none'
      return
    }

    tbody.innerHTML = lista.map(f => `
      <tr onclick="verDetalle(${f.id})">
        <td><strong style="font-size:0.82rem">${f.venta?.folio || '—'}</strong></td>
        <td style="font-size:0.82rem;color:var(--muted)">${fmtFecha(f.creadaEn)}</td>
        <td>
          <div style="font-weight:600;font-size:0.875rem">${f.nombreReceptor}</div>
          <div style="font-size:0.75rem;color:var(--muted)">${f.rfcReceptor}</div>
        </td>
        <td style="font-size:0.82rem;color:var(--muted)">${f.usoCfdi || '—'}</td>
        <td><strong>${fmt(f.total)}</strong></td>
        <td>${estadoBadge(f.estado)}</td>
        <td style="font-size:0.78rem;color:var(--muted)">${f.folioFiscal ? f.folioFiscal.substring(0, 18) + '...' : '—'}</td>
        <td>
          <div class="actions-cell" onclick="event.stopPropagation()">
            <button class="btn-icon" onclick="verDetalle(${f.id})" title="Ver detalle">👁</button>
            ${f.xmlUrl ? `<button class="btn-icon" onclick="descargar('${f.xmlUrl}','xml')" title="Descargar XML">📄</button>` : ''}
            ${f.pdfUrl ? `<button class="btn-icon" onclick="descargar('${f.pdfUrl}','pdf')" title="Descargar PDF">🖨️</button>` : ''}
            ${f.estado === 'PENDIENTE_TIMBRADO' ? `<button class="btn-icon btn-timbrar" onclick="timbrarManual(${f.id})" title="Timbrar ahora">⚡</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('')

    const totalPags = data.paginacion?.totalPaginas || Math.ceil(data.total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${data.total} facturas)`
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
window.verDetalle = async function(id) {
  try {
    const res  = await fetch(`${API_URL}/facturas/${id}`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    if (window.handle401 && window.handle401(res.status)) return
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    const f = data.data

    document.getElementById('det-rfc').textContent      = f.rfcReceptor
    document.getElementById('det-nombre').textContent   = f.nombreReceptor
    document.getElementById('det-regimen').textContent  = f.regimenFiscal || '—'
    document.getElementById('det-cp').textContent       = f.cpReceptor || '—'
    document.getElementById('det-uso').textContent      = f.usoCfdi || '—'
    document.getElementById('det-venta').textContent    = f.venta?.folio || '—'
    document.getElementById('det-fecha').textContent    = fmtFecha(f.creadaEn)
    document.getElementById('det-subtotal').textContent = fmt(f.subtotal)
    document.getElementById('det-iva').textContent      = fmt(f.iva)
    document.getElementById('det-total').textContent    = fmt(f.total)
    document.getElementById('det-estado').innerHTML     = estadoBadge(f.estado)
    document.getElementById('det-uuid').textContent     = f.folioFiscal || 'Pendiente de timbrado'
    document.getElementById('det-timbrado').textContent = f.timbradaEn ? fmtFecha(f.timbradaEn) : '—'

    // Botones de acción
    const btnTimbrar  = document.getElementById('det-btn-timbrar')
    const btnCancelar = document.getElementById('det-btn-cancelar')
    const btnXml      = document.getElementById('det-btn-xml')
    const btnPdf      = document.getElementById('det-btn-pdf')

    btnTimbrar.style.display  = f.estado === 'PENDIENTE_TIMBRADO' ? 'flex' : 'none'
    btnCancelar.style.display = ['TIMBRADA','FACTURADA'].includes(f.estado) ? 'flex' : 'none'
    btnXml.style.display      = f.xmlUrl ? 'flex' : 'none'
    btnPdf.style.display      = f.pdfUrl ? 'flex' : 'none'

    btnTimbrar.onclick  = () => timbrarManual(f.id)
    btnCancelar.onclick = () => cancelarFactura(f.id)
    btnXml.onclick      = () => descargar(f.xmlUrl, 'xml')
    btnPdf.onclick      = () => descargar(f.pdfUrl, 'pdf')

    document.getElementById('modal-detalle').classList.add('active')
  } catch (err) {
    alert('Error: ' + err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  TIMBRAR MANUAL
// ════════════════════════════════════════════════════════════════════
window.timbrarManual = async function(id) {
  if (!confirm('¿Timbrar esta factura ahora? Se enviará a Facturapi para obtener el UUID fiscal.')) return

  const btn = document.getElementById('det-btn-timbrar')
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Timbrando...' }

  try {
    const res  = await fetch(`${API_URL}/facturas/${id}/timbrar`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(res.status)) return
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)

    document.getElementById('modal-detalle').classList.remove('active')
    cargarFacturas()

    const toast = document.createElement('div')
    toast.innerHTML = `✓ Factura timbrada — UUID: <strong style="font-size:0.8rem">${data.uuid}</strong>`
    Object.assign(toast.style, {
      position:'fixed', top:'20px', right:'20px', zIndex:'9999',
      background:'#1a3a28', border:'1px solid rgba(96,208,128,0.3)',
      color:'#60d080', padding:'14px 20px', borderRadius:'8px',
      fontSize:'0.875rem', fontWeight:'600',
      boxShadow:'0 4px 16px rgba(0,0,0,0.4)', transition:'opacity 0.4s', maxWidth:'480px'
    })
    document.body.appendChild(toast)
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400) }, 6000)

  } catch (err) {
    alert('Error al timbrar: ' + err.message)
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Timbrar ahora' }
  }
}

// ════════════════════════════════════════════════════════════════════
//  CANCELAR FACTURA
// ════════════════════════════════════════════════════════════════════
async function cancelarFactura(id) {
  if (!confirm('¿Cancelar esta factura? Esta acción no se puede deshacer.')) return
  try {
    const res  = await fetch(`${API_URL}/facturas/${id}/cancelar`, {
      method:  'PATCH',
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(res.status)) return
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    document.getElementById('modal-detalle').classList.remove('active')
    cargarFacturas()
  } catch (err) {
    alert('Error: ' + err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  DESCARGAR XML / PDF
// ════════════════════════════════════════════════════════════════════
window.descargar = function(url, tipo) {
  if (!url) { alert('URL no disponible'); return }
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.download = `factura.${tipo}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) {
    fechaEl.textContent = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
  }

  cargarFacturas()

  // Filtros
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => { paginaActual = 1; cargarFacturas() }, 400)
  })

  ;['filtro-estado','filtro-desde','filtro-hasta'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { paginaActual = 1; cargarFacturas() })
  })

  document.getElementById('btn-limpiar')?.addEventListener('click', () => {
    document.getElementById('search-input').value  = ''
    document.getElementById('filtro-estado').value = ''
    document.getElementById('filtro-desde').value  = ''
    document.getElementById('filtro-hasta').value  = ''
    paginaActual = 1
    cargarFacturas()
  })

  // Paginación
  document.getElementById('btn-prev')?.addEventListener('click', () => { if (paginaActual > 1) { paginaActual--; cargarFacturas() } })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++; cargarFacturas() })

  // Modal detalle cerrar
  document.getElementById('det-close')?.addEventListener('click', () => {
    document.getElementById('modal-detalle').classList.remove('active')
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('modal-detalle')?.classList.remove('active')
  })
})

console.log('✅ facturas.js cargado')