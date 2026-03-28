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
            ${f.facturapiId ? `<button class="btn-icon" onclick="descargarFactura(${f.id},'pdf')" title="Descargar PDF">🖨️</button>` : ''}
            ${f.facturapiId ? `<button class="btn-icon" onclick="descargarFactura(${f.id},'xml')" title="Descargar XML">📄</button>` : ''}
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
    btnXml.style.display      = f.facturapiId ? 'flex' : 'none'
    btnPdf.style.display      = f.facturapiId ? 'flex' : 'none'

    btnTimbrar.onclick  = () => timbrarManual(f.id)
    btnCancelar.onclick = () => cancelarFactura(f.id)
    btnXml.onclick      = () => descargarFactura(f.id, 'xml')
    btnPdf.onclick      = () => descargarFactura(f.id, 'pdf')

    // Botón enviar email (si existe)
    const btnEmail = document.getElementById('det-btn-email')
    if (btnEmail) {
      btnEmail.style.display = f.facturapiId ? 'flex' : 'none'
      btnEmail.onclick = () => reenviarEmail(f.id)
    }

    // ── Preview PDF embebido ──
    const pdfPreview = document.getElementById('det-pdf-preview')
    const pdfIframe  = document.getElementById('det-pdf-iframe')
    const btnToggle  = document.getElementById('det-btn-toggle-pdf')

    if (f.facturapiId) {
      pdfPreview.style.display = 'block'
      pdfIframe.style.display  = 'none'
      pdfIframe.src = ''
      btnToggle.textContent = '▼ Mostrar PDF'

      btnToggle.onclick = () => {
        if (pdfIframe.style.display === 'none') {
          // Cargar PDF vía blob para enviar el token de auth
          pdfIframe.style.display = 'block'
          btnToggle.textContent = '▲ Ocultar PDF'
          // Usar blob URL para que el iframe cargue con autenticación
          fetch(`${API_URL}/facturas/${f.id}/descargar/pdf`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
          })
            .then(r => {
              if (!r.ok) throw new Error('No se pudo cargar PDF')
              return r.blob()
            })
            .then(blob => {
              const blobUrl = URL.createObjectURL(blob)
              pdfIframe.src = blobUrl
            })
            .catch(err => {
              pdfIframe.style.display = 'none'
              btnToggle.textContent = '▼ Mostrar PDF'
              jeshaToast('Error cargando PDF: ' + err.message, 'error')
            })
        } else {
          pdfIframe.style.display = 'none'
          btnToggle.textContent = '▼ Mostrar PDF'
          if (pdfIframe.src.startsWith('blob:')) URL.revokeObjectURL(pdfIframe.src)
          pdfIframe.src = ''
        }
      }
    } else {
      pdfPreview.style.display = 'none'
    }

    document.getElementById('modal-detalle').classList.add('active')
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
  }
}

// ════════════════════════════════════════════════════════════════════
//  TIMBRAR MANUAL (desde detalle — factura PENDIENTE existente)
// ════════════════════════════════════════════════════════════════════
window.timbrarManual = async function(id) {
  const ok = await jeshaConfirm({
    title: 'Timbrar factura',
    message: '¿Timbrar esta factura ahora? Se enviará a Facturapi para obtener el UUID fiscal. Esta acción no se puede deshacer.',
    confirmText: 'Sí, timbrar', type: 'primary'
  })
  if (!ok) return

  const btn = document.getElementById('det-btn-timbrar')
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Timbrando...' }

  try {
    const res  = await fetch(`${API_URL}/facturas/${id}/timbrar`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` }
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)

    document.getElementById('modal-detalle').classList.remove('active')
    limpiarPdfPreview()
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
    jeshaToast('Error al timbrar: ' + err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Timbrar ahora' }
  }
}

// ════════════════════════════════════════════════════════════════════
//  CANCELAR FACTURA
// ════════════════════════════════════════════════════════════════════
async function cancelarFactura(id) {
  const ok = await jeshaConfirm({
    title: 'Cancelar factura',
    message: '¿Cancelar esta factura ante el SAT? <strong>Esta acción no se puede deshacer.</strong>',
    confirmText: 'Sí, cancelar', type: 'danger'
  })
  if (!ok) return
  try {
    const res  = await fetch(`${API_URL}/facturas/${id}/cancelar`, {
      method:  'PATCH',
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    document.getElementById('modal-detalle').classList.remove('active')
    limpiarPdfPreview()
    cargarFacturas()
    jeshaToast('Factura cancelada', 'success')
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
  }
}

// ════════════════════════════════════════════════════════════════════
//  DESCARGAR PDF / XML (proxy por el backend)
// ════════════════════════════════════════════════════════════════════
window.descargarFactura = async function(facturaId, tipo) {
  try {
    const res = await fetch(`${API_URL}/facturas/${facturaId}/descargar/${tipo}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error desconocido' }))
      throw new Error(err.error || 'Error al descargar')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `factura.${tipo}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    jeshaToast('Error al descargar: ' + err.message, 'error')
  }
}

// Legacy — por si quedan referencias viejas con URLs directas
window.descargar = function(url, tipo) {
  if (!url) { jeshaToast('URL de factura no disponible', 'warning'); return }
  const a = document.createElement('a')
  a.href = url; a.target = '_blank'; a.download = `factura.${tipo}`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

// ════════════════════════════════════════════════════════════════════
//  REENVIAR EMAIL
// ════════════════════════════════════════════════════════════════════
async function reenviarEmail(facturaId) {
  const ok = await jeshaConfirm({
    title: 'Reenviar factura por email',
    message: '¿Enviar el PDF y XML de esta factura al correo del cliente?',
    confirmText: 'Enviar', type: 'primary'
  })
  if (!ok) return
  try {
    const res = await fetch(`${API_URL}/facturas/${facturaId}/enviar-email`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    jeshaToast(data.mensaje || 'Email enviado', 'success')
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
  }
}

// ════════════════════════════════════════════════════════════════════
//  FACTURACIÓN MANUAL — buscar venta y timbrar desde el panel admin
// ════════════════════════════════════════════════════════════════════
let ventaParaFacturar = null

async function buscarVentaParaFactura() {
  const folio = document.getElementById('m-folio').value.trim()
  const resultDiv = document.getElementById('venta-result')
  if (!folio) { resultDiv.className = 'venta-search-result error show'; resultDiv.textContent = 'Ingresa un folio de venta'; return }

  resultDiv.className = 'venta-search-result show'
  resultDiv.textContent = 'Buscando...'
  document.getElementById('manual-fiscal-fields').style.display = 'none'
  ventaParaFacturar = null

  try {
    // Buscar por folio en el listado de ventas
    const res = await fetch(`${API_URL}/ventas?q=${encodeURIComponent(folio)}&take=5`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    const data = await res.json()
    const ventas = data.data || []

    if (ventas.length === 0) {
      resultDiv.className = 'venta-search-result error show'
      resultDiv.textContent = 'No se encontró venta con ese folio'
      return
    }

    // Tomar la primera coincidencia y cargar detalle completo
    const v = ventas[0]
    const res2 = await fetch(`${API_URL}/ventas/${v.id}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    const d2 = await res2.json()
    const venta = d2.data

    // Validaciones
    if (venta.facturaEstado === 'FACTURADA') {
      resultDiv.className = 'venta-search-result error show'
      resultDiv.textContent = 'Esta venta ya fue facturada'
      return
    }
    if (venta.facturaEstado === 'BLOQUEADA') {
      resultDiv.className = 'venta-search-result error show'
      resultDiv.textContent = 'Venta bloqueada — efectivo mayor a $2,000'
      return
    }

    ventaParaFacturar = venta
    resultDiv.className = 'venta-search-result show'
    resultDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${venta.folio}</strong> · ${fmt(venta.total)} · ${venta.metodoPago}
          <br><span style="font-size:0.78rem;color:var(--muted)">Cliente: ${venta.cliente?.nombre || 'Público general'} · ${venta.estado}</span>
        </div>
        <span style="color:#60d080;font-size:0.8rem;font-weight:600;">✓ Disponible</span>
      </div>
    `

    // Mostrar campos fiscales
    document.getElementById('manual-fiscal-fields').style.display = 'block'
    llenarCatalogosManual()

    // Limpiar campos previos
    document.getElementById('m-rfc').value = ''
    document.getElementById('m-razon').value = ''
    document.getElementById('m-regimen').value = ''
    document.getElementById('m-cp').value = ''
    document.getElementById('m-uso').value = ''
    document.getElementById('m-email').value = ''
    document.getElementById('manual-error').style.display = 'none'

    // Autocompletar si hay datos del cliente
    if (venta.cliente) {
      if (venta.cliente.rfc)    document.getElementById('m-rfc').value   = venta.cliente.rfc
      if (venta.cliente.nombre) document.getElementById('m-razon').value = venta.cliente.nombre
    }

    // Focus al RFC
    setTimeout(() => document.getElementById('m-rfc')?.focus(), 100)

  } catch (e) {
    resultDiv.className = 'venta-search-result error show'
    resultDiv.textContent = 'Error: ' + e.message
  }
}

function llenarCatalogosManual() {
  const regimenes = [
    { c: '601', d: 'General de Ley Personas Morales' },
    { c: '603', d: 'Personas Morales con Fines no Lucrativos' },
    { c: '605', d: 'Sueldos y Salarios' },
    { c: '606', d: 'Arrendamiento' },
    { c: '608', d: 'Demás Ingresos' },
    { c: '612', d: 'Actividades Empresariales y Profesionales' },
    { c: '616', d: 'Sin obligaciones fiscales' },
    { c: '621', d: 'Incorporación Fiscal' },
    { c: '625', d: 'Plataformas Tecnológicas' },
    { c: '626', d: 'Régimen Simplificado de Confianza' },
  ]
  const usos = [
    { c: 'G01', d: 'Adquisición de mercancías' },
    { c: 'G02', d: 'Devoluciones, descuentos o bonificaciones' },
    { c: 'G03', d: 'Gastos en general' },
    { c: 'I01', d: 'Construcciones' },
    { c: 'I04', d: 'Equipo de cómputo y accesorios' },
    { c: 'I08', d: 'Otra maquinaria y equipo' },
    { c: 'S01', d: 'Sin efectos fiscales' },
  ]
  const selR = document.getElementById('m-regimen')
  const selU = document.getElementById('m-uso')
  // Solo llenar si están vacíos
  if (selR.options.length <= 1) {
    regimenes.forEach(r => { selR.add(new Option(`${r.c} — ${r.d}`, r.c)) })
  }
  if (selU.options.length <= 1) {
    usos.forEach(u => { selU.add(new Option(`${u.c} — ${u.d}`, u.c)) })
  }
}

async function facturarManualDesdeModal() {
  if (!ventaParaFacturar) return

  const errDiv = document.getElementById('manual-error')
  const btn    = document.getElementById('btn-facturar-manual')

  const body = {
    token:         ventaParaFacturar.tokenQr,
    rfc:           document.getElementById('m-rfc').value.trim().toUpperCase(),
    razonSocial:   document.getElementById('m-razon').value.trim(),
    regimenFiscal: document.getElementById('m-regimen').value,
    codigoPostal:  document.getElementById('m-cp').value.trim(),
    usoCfdi:       document.getElementById('m-uso').value,
    email:         document.getElementById('m-email').value.trim()
  }

  // Validar campos
  const validaciones = [
    [body.rfc,           'RFC requerido'],
    [body.razonSocial,   'Razón social requerida'],
    [body.regimenFiscal, 'Selecciona el régimen fiscal'],
    [body.codigoPostal,  'Código postal requerido'],
    [body.usoCfdi,       'Selecciona el uso del CFDI'],
    [body.email,         'Correo electrónico requerido'],
  ]
  for (const [val, msg] of validaciones) {
    if (!val) {
      errDiv.style.display = 'block'
      errDiv.textContent = msg
      return
    }
  }
  if (body.codigoPostal.length !== 5) {
    errDiv.style.display = 'block'
    errDiv.textContent = 'El código postal debe tener 5 dígitos'
    return
  }

  btn.disabled = true
  btn.textContent = '⟳ Timbrando...'
  errDiv.style.display = 'none'

  try {
    const res = await fetch(`${API_URL}/facturar/api`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al facturar')

    document.getElementById('modal-manual').classList.remove('active')
    cargarFacturas()

    if (data.timbrado) {
      jeshaToast(`Factura timbrada — UUID: ${data.uuid}`, 'success')
    } else {
      jeshaToast(data.mensaje || 'Solicitud guardada como pendiente', 'warning')
    }

  } catch (e) {
    errDiv.style.display = 'block'
    errDiv.textContent = e.message
    btn.disabled = false
    btn.textContent = '⚡ Timbrar Factura'
  }
}

// ════════════════════════════════════════════════════════════════════
//  LIMPIAR PDF PREVIEW al cerrar modal
// ════════════════════════════════════════════════════════════════════
function limpiarPdfPreview() {
  const iframe = document.getElementById('det-pdf-iframe')
  if (iframe) {
    if (iframe.src && iframe.src.startsWith('blob:')) URL.revokeObjectURL(iframe.src)
    iframe.src = ''
    iframe.style.display = 'none'
  }
  const btn = document.getElementById('det-btn-toggle-pdf')
  if (btn) btn.textContent = '▼ Mostrar PDF'
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

  // Modal detalle — cerrar
  document.getElementById('det-close')?.addEventListener('click', () => {
    document.getElementById('modal-detalle').classList.remove('active')
    limpiarPdfPreview()
  })

  // Modal manual — abrir
  document.getElementById('btn-nueva-factura')?.addEventListener('click', () => {
    document.getElementById('m-folio').value = ''
    document.getElementById('venta-result').className = 'venta-search-result'
    document.getElementById('venta-result').innerHTML = ''
    document.getElementById('manual-fiscal-fields').style.display = 'none'
    ventaParaFacturar = null
    document.getElementById('modal-manual').classList.add('active')
    setTimeout(() => document.getElementById('m-folio')?.focus(), 200)
  })

  // Modal manual — cerrar
  document.getElementById('manual-close')?.addEventListener('click', () => {
    document.getElementById('modal-manual').classList.remove('active')
  })

  // Modal manual — buscar venta
  document.getElementById('btn-buscar-venta')?.addEventListener('click', buscarVentaParaFactura)

  // Modal manual — Enter en folio dispara búsqueda
  document.getElementById('m-folio')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); buscarVentaParaFactura() }
  })

  // Modal manual — solo números en CP
  document.getElementById('m-cp')?.addEventListener('input', function() {
    this.value = this.value.replace(/\D/g, '').substring(0, 5)
  })

  // Modal manual — timbrar
  document.getElementById('btn-facturar-manual')?.addEventListener('click', facturarManualDesdeModal)

  // Escape cierra cualquier modal abierto
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-detalle')?.classList.remove('active')
      document.getElementById('modal-manual')?.classList.remove('active')
      limpiarPdfPreview()
    }
  })
})

console.log('✅ facturas.js cargado')