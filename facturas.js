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
let clientesCache = []
let facturaEmpresaId = null
const ACENTOS_RAZON_SOCIAL = /[ÁÉÍÓÚÜáéíóúü]/

function validarRazonSocialSat(razonSocial) {
  const razon = String(razonSocial || '').trim().normalize('NFC')
  if (!razon) return ''
  if (ACENTOS_RAZON_SOCIAL.test(razon)) return 'La razón social debe ir sin acentos.'
  if (razon !== razon.toUpperCase()) return 'La razón social debe ir en MAYÚSCULAS.'
  return ''
}

function llenarCatalogosDetalle() {
  poblarSelectSAT(document.getElementById('det-regimen'), CATALOGO_REGIMENES)
  poblarSelectSAT(document.getElementById('det-uso'), CATALOGO_USOS)
}

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
  tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  const q      = document.getElementById('search-input')?.value.trim() || ''
  const estado = document.getElementById('filtro-estado')?.value || ''
  const desde  = document.getElementById('filtro-desde')?.value || ''
  const hasta  = document.getElementById('filtro-hasta')?.value || ''
  const metodo = document.getElementById('filtro-metodo')?.value || ''

  const params = new URLSearchParams({ page: paginaActual, take: LIMIT })
  if (q)      params.set('q', q)
  if (estado) params.set('estado', estado)
  if (desde)  params.set('desde', desde)
  if (hasta)  params.set('hasta', hasta)
  if (metodo) params.set('metodoPago', metodo)

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
      document.getElementById('stat-inciertas').textContent  = data.stats.inciertas || 0
    }

    const lista = data.data || []
    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><p>No se encontraron facturas con los filtros aplicados</p></td></tr>`
      pagDiv.style.display = 'none'
      return
    }

    tbody.innerHTML = lista.map(f => {
      const incierto = f.estado === 'PENDIENTE_TIMBRADO' && f.procesandoTimbrado
      const esPendiente = f.estado === 'PENDIENTE_TIMBRADO'
      const rolFiscal = ['ADMIN_SUCURSAL','SUPERADMIN','PLATFORM_ADMIN'].includes(USUARIO.rol)
      const badgeEstado = incierto
        ? '<span class="fact-badge badge-incierto">⚠ INCIERTO</span>'
        : estadoBadge(f.estado)
      return `
      <tr onclick="verDetalle(${f.id})">
        <td><strong style="font-size:0.82rem">${f.Venta?.folio || '—'}</strong></td>
        <td style="font-size:0.82rem;color:var(--muted)">${fmtFecha(f.creadaEn)}</td>
        <td style="font-size:0.82rem">${f.metodoPago || '—'}</td>
        <td>
          <div style="font-weight:600;font-size:0.875rem">${f.nombreReceptor}</div>
          <div style="font-size:0.75rem;color:var(--muted)">${f.rfcReceptor}</div>
        </td>
        <td style="font-size:0.82rem;color:var(--muted)">${f.usoCfdi || '—'}</td>
        <td><strong>${fmt(f.total)}</strong></td>
        <td>${badgeEstado}</td>
        <td style="font-size:0.78rem;color:var(--muted)">${f.folioFiscal ? f.folioFiscal.substring(0, 18) + '...' : '—'}</td>
        <td>
          <div class="actions-cell" onclick="event.stopPropagation()">
            <button class="btn-icon" onclick="verDetalle(${f.id})" title="Ver detalle">👁</button>
            ${f.facturapiId ? `<button class="btn-icon" onclick="descargarFactura(${f.id},'pdf')" title="Descargar PDF">🖨️</button>` : ''}
            ${f.facturapiId ? `<button class="btn-icon" onclick="descargarFactura(${f.id},'xml')" title="Descargar XML">📄</button>` : ''}
            ${esPendiente && !f.facturapiId ? `<button class="btn-icon btn-timbrar" onclick="timbrarManual(${f.id})" title="Timbrar ahora">⚡</button>` : ''}
            ${esPendiente && rolFiscal ? `<button class="btn-icon" onclick="event.stopPropagation();verCandidatos(${f.id})" title="Buscar CFDIs en Facturapi">🔍</button>` : ''}
          </div>
        </td>
      </tr>
    ` }).join('')

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
    tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
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
    facturaEmpresaId = f.empresaId || null

    // Poblar campos fiscales (ahora inputs/selects)
    llenarCatalogosDetalle()

    const esPendiente = f.estado === 'PENDIENTE_TIMBRADO'
    ;['det-rfc','det-nombre','det-regimen','det-cp','det-uso','det-email','det-email-sec1','det-email-sec2'].forEach(id => {
      const el = document.getElementById(id)
      if (!el) return
      if (esPendiente) {
        el.disabled = false
        el.classList.add('editable')
      } else {
        el.disabled = true
        el.classList.remove('editable')
      }
    })

    document.getElementById('det-rfc').value     = f.rfcReceptor || ''
    const nombreInput = document.getElementById('det-nombre')
    nombreInput.value = f.nombreReceptor || ''
    actualizarAdvertenciaRazonSocial(nombreInput)
    document.getElementById('det-regimen').value = f.regimenFiscal || ''
    filtrarUsosPorRegimen(document.getElementById('det-regimen'), document.getElementById('det-uso'))
    document.getElementById('det-uso').value     = f.usoCfdi || ''
    document.getElementById('det-cp').value      = f.cpReceptor || ''
    document.getElementById('det-email').value      = f.emailReceptor || ''
    document.getElementById('det-email-sec1').value = f.emailSecundario1 || ''
    document.getElementById('det-email-sec2').value = f.emailSecundario2 || ''
    document.getElementById('det-venta').textContent    = f.Venta?.folio || '—'
    document.getElementById('det-fecha').textContent    = fmtFecha(f.creadaEn)
    document.getElementById('det-subtotal').textContent = fmt(f.subtotal)
    document.getElementById('det-iva').textContent      = fmt(f.iva)
    document.getElementById('det-total').textContent    = fmt(f.total)
    document.getElementById('det-estado').innerHTML     = estadoBadge(f.estado)
    document.getElementById('det-uuid').textContent     = f.folioFiscal || 'Pendiente de timbrado'
    document.getElementById('det-timbrado').textContent = f.timbradaEn ? fmtFecha(f.timbradaEn) : '—'

    // Botones de acción
    const btnTimbrar     = document.getElementById('det-btn-timbrar')
    const btnCancelar    = document.getElementById('det-btn-cancelar')
    const btnXml         = document.getElementById('det-btn-xml')
    const btnPdf         = document.getElementById('det-btn-pdf')
    const btnCandidatos  = document.getElementById('det-btn-candidatos')
    const btnDescartar   = document.getElementById('det-btn-descartar')
    const rolFiscal = ['ADMIN_SUCURSAL','SUPERADMIN','PLATFORM_ADMIN'].includes(USUARIO.rol)
    const incierto = esPendiente && f.procesandoTimbrado

    btnTimbrar.style.display   = esPendiente && !f.facturapiId ? 'flex' : 'none'
    btnCancelar.style.display  = ['TIMBRADA','FACTURADA','PENDIENTE_TIMBRADO'].includes(f.estado) ? 'flex' : 'none'
    btnXml.style.display       = f.facturapiId ? 'flex' : 'none'
    btnPdf.style.display       = f.facturapiId ? 'flex' : 'none'
    btnCandidatos.style.display = esPendiente && rolFiscal ? 'flex' : 'none'
    btnDescartar.style.display  = incierto && rolFiscal ? 'flex' : 'none'

    btnTimbrar.onclick     = () => timbrarManual(f.id)
    btnCancelar.onclick    = () => cancelarFactura(f.id)
    btnXml.onclick         = () => descargarFactura(f.id, 'xml')
    btnPdf.onclick         = () => descargarFactura(f.id, 'pdf')
    btnCandidatos.onclick  = () => verCandidatos(f.id)
    btnDescartar.onclick   = () => descartarTimbradoIncierto(f.id)

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

    // Resetear panel de candidatos al abrir
    document.getElementById('candidatos-panel').style.display = 'none'
    document.getElementById('cand-lista').innerHTML = ''
    document.getElementById('cand-aviso').style.display = 'none'
    document.getElementById('cand-error').style.display = 'none'
    document.getElementById('cand-atajo').style.display = 'none'

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
    const body = {
      rfc:           document.getElementById('det-rfc').value.trim(),
      razonSocial:   document.getElementById('det-nombre').value.trim(),
      regimenFiscal: document.getElementById('det-regimen').value,
      codigoPostal:  document.getElementById('det-cp').value.trim(),
      usoCfdi:           document.getElementById('det-uso').value,
      email:             document.getElementById('det-email').value.trim(),
      emailSecundario1:  document.getElementById('det-email-sec1').value.trim() || null,
      emailSecundario2:  document.getElementById('det-email-sec2').value.trim() || null
    }

    const errorRazon = validarRazonSocialSat(body.razonSocial)
    if (errorRazon) {
      jeshaToast(errorRazon, 'error')
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Timbrar ahora' }
      return
    }

    const res  = await fetch(`${API_URL}/facturas/${id}/timbrar`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify(body)
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
async function cancelarFactura(id, confirmacionManual = null) {
  if (!confirmacionManual) {
    const ok = await jeshaConfirm({
      title: 'Cancelar factura',
      message: '¿Cancelar esta factura ante el SAT? <strong>Esta acción no se puede deshacer.</strong>',
      confirmText: 'Sí, cancelar', type: 'danger'
    })
    if (!ok) return
  }
  try {
    const res = await fetch(`${API_URL}/facturas/${id}/cancelar`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...(confirmacionManual ? { 'Content-Type': 'application/json' } : {})
      },
      ...(confirmacionManual ? { body: JSON.stringify({ confirmacionManual }) } : {})
    })
    const data = await res.json()

    if (res.status === 409 && data.requiereConfirmacionManual) {
      const texto = window.prompt('El CFDI no se encontró en Facturapi. Verifica en el portal del SAT que no exista o ya esté cancelado, y describe lo que verificaste:')
      if (!texto || !texto.trim()) {
        jeshaToast('Cancelación abortada: se requiere la confirmación manual', 'warning')
        return
      }
      return cancelarFactura(id, texto.trim())
    }

    if (!res.ok) throw new Error(data.error)

    if (res.status === 202 || data.pendiente) {
      jeshaToast(data.mensaje || 'Cancelación pendiente de confirmación del SAT', 'warning')
      cargarFacturas()
      return
    }

    document.getElementById('modal-detalle').classList.remove('active')
    limpiarPdfPreview()
    cargarFacturas()
    jeshaToast(data.warning ? `Factura cancelada. ${data.warning}` : 'Factura cancelada',
               data.warning ? 'warning' : 'success')
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
  }
}

// ════════════════════════════════════════════════════════════════════
//  RESOLVER TIMBRADO — helpers
// ════════════════════════════════════════════════════════════════════
function esIncierto(f) {
  return f.estado === 'PENDIENTE_TIMBRADO' && f.procesandoTimbrado
}

function candBadgeHtml(match) {
  if (match) {
    return '<span class="cand-badge-exact">✅ Coincidencia exacta (idempotency_key)</span>'
  }
  return '<span class="cand-badge-approx">⚠ Por monto / fecha</span>'
}

// ════════════════════════════════════════════════════════════════════
//  VER CANDIDATOS CFDI
// ════════════════════════════════════════════════════════════════════
window.verCandidatos = async function(facturaId) {
  const panel   = document.getElementById('candidatos-panel')
  const lista   = document.getElementById('cand-lista')
  const aviso   = document.getElementById('cand-aviso')
  const error   = document.getElementById('cand-error')
  const atajo   = document.getElementById('cand-atajo')
  const titulo  = document.getElementById('cand-titulo')
  const btnClose = document.getElementById('cand-close')

  lista.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;text-align:center;padding:20px;">Buscando CFDIs en Facturapi...</p>'
  aviso.style.display = 'none'
  error.style.display = 'none'
  atajo.style.display = 'none'
  titulo.textContent = 'CFDIs encontrados en Facturapi'
  panel.style.display = 'block'

  btnClose.onclick = () => { panel.style.display = 'none' }

  try {
    const empresaId = USUARIO.empresaId || facturaEmpresaId
    const params = new URLSearchParams()
    if (empresaId) params.set('empresaId', empresaId)
    const qs = params.toString()
    const url = `${API_URL}/facturas/${facturaId}/timbrado-candidatos${qs ? '?' + qs : ''}`
    const res  = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    const data = await res.json()

    if (res.status === 502 || (res.status >= 500 && !res.ok)) {
      error.textContent = 'La búsqueda en Facturapi falló. Reintenta en unos segundos.'
      error.style.display = 'block'
      lista.innerHTML = ''
      return
    }

    if (!res.ok) {
      error.textContent = data.error || 'Error buscando candidatos'
      error.style.display = 'block'
      lista.innerHTML = ''
      return
    }

    // Aviso RFC genérico
    if (data.aviso) {
      aviso.textContent = data.aviso
      aviso.style.display = 'block'
    } else {
      aviso.style.display = 'none'
    }

    // Atajo: ya tiene facturapiId vinculado localmente
    if (data.facturapiIdConocido) {
      atajo.innerHTML = `<span>CFDI ya vinculado localmente: <strong>${data.facturapiIdConocido}</strong></span>
        <button class="btn-reconciliar" onclick="reconciliarTimbrado(${facturaId},'${data.facturapiIdConocido}')">✅ Reconciliar</button>`
      atajo.style.display = 'flex'
      lista.innerHTML = ''
      return
    }

    if (data.categoria === 'NO_CANDIDATES') {
      lista.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;text-align:center;padding:16px;">No se encontraron CFDIs en Facturapi. Verifica en el portal del SAT.</p>'
      return
    }

    // Renderizar candidatos
    lista.innerHTML = data.candidatos.map(c => {
      const exact = !!c.matchIdempotency
      const cls   = exact ? 'cand-item exact' : 'cand-item approx'
      const badge = candBadgeHtml(c.matchIdempotency)
      return `
      <div class="${cls}">
        <div class="cand-info">
          <span class="cand-info-id">${c.facturapiId}</span>
          <span class="cand-info-uuid">${(c.uuid || '').substring(0, 36)}</span>
          <span class="cand-info-total">${fmt(c.total)} MXN</span>
          ${badge}
        </div>
        <button class="btn-reconciliar" onclick="reconciliarTimbrado(${facturaId},'${c.facturapiId}')">✅ Reconciliar</button>
      </div>`
    }).join('')

  } catch (err) {
    error.textContent = 'Error de conexión: ' + err.message
    error.style.display = 'block'
    lista.innerHTML = ''
  }
}

// ════════════════════════════════════════════════════════════════════
//  RECONCILIAR TIMBRADO
// ════════════════════════════════════════════════════════════════════
window.reconciliarTimbrado = async function(facturaId, facturapiId) {
  try {
    const empresaId = USUARIO.empresaId || facturaEmpresaId
    const body = { facturapiId }
    if (empresaId) body.empresaId = empresaId
    const res  = await fetch(`${API_URL}/facturas/${facturaId}/reconciliar-timbrado`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify(body)
    })
    const data = await res.json()

    if (res.status === 422) {
      jeshaToast('El CFDI no coincide: ' + (data.detalles?.join('; ') || data.error), 'error')
      return
    }
    if (res.status === 409) {
      jeshaToast(data.error || 'La factura cambió de estado; recarga y reintenta.', 'warning')
      return
    }
    if (!res.ok) throw new Error(data.error)

    jeshaToast('CFDI reconciliado correctamente — UUID: ' + (data.uuid || '').substring(0, 8) + '...', 'success')
    document.getElementById('candidatos-panel').style.display = 'none'
    document.getElementById('modal-detalle').classList.remove('active')
    cargarFacturas()
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
  }
}

// ════════════════════════════════════════════════════════════════════
//  DESCARTAR INCERTIDUMBRE
// ════════════════════════════════════════════════════════════════════
window.descartarTimbradoIncierto = async function(facturaId) {
  const texto = await jeshaPrompt({
    title:       'Descartar incertidumbre',
    label:       'Describe lo que verificaste en el portal del SAT (mínimo 10 caracteres):',
    placeholder: 'Ej: El CFDI con estos datos no existe en el portal del SAT...',
    confirmText: 'Descartar',
    cancelText:  'Cancelar'
  })
  if (!texto || texto.length < 10) {
    if (texto !== null) jeshaToast('Se requiere texto de al menos 10 caracteres.', 'warning')
    return
  }
  try {
    const empresaId = USUARIO.empresaId || facturaEmpresaId
    const body = { confirmacionManual: texto }
    if (empresaId) body.empresaId = empresaId
    const res  = await fetch(`${API_URL}/facturas/${facturaId}/descartar-timbrado-incierto`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify(body)
    })
    const data = await res.json()
    if (res.status === 409) {
      jeshaToast(data.error || 'La factura cambió de estado; recarga y reintenta.', 'warning')
      return
    }
    if (!res.ok) throw new Error(data.error)
    jeshaToast('Incertidumbre descartada. La factura queda pendiente de timbrar.', 'success')
    document.getElementById('candidatos-panel').style.display = 'none'
    document.getElementById('modal-detalle').classList.remove('active')
    cargarFacturas()
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

// ── Dropdown cliente fiscal ──
async function cargarClientesCache() {
  if (clientesCache.length) return clientesCache
  try {
    const res = await fetch(`${API_URL}/clientes?limit=500`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
    const data = await res.json()
    const lista = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])
    clientesCache = lista.filter(c => c.activo && c.tipo === 'FISCAL')
  } catch (e) {
    clientesCache = []
  }
  return clientesCache
}

function renderClienteFiscalItem(c) {
  const saldo = parseFloat(c.saldoPendiente || 0)
  const saldoClass = saldo > 0 ? 'pendiente' : 'activo'
  return `<div class="dropdown-item" data-cid="${c.id}">
    <div class="item-left">
      <div class="item-nombre">${c.nombre}</div>
      <div class="item-sub">${c.rfc || ''}${c.telefono ? ' · ' + c.telefono : ''}</div>
    </div>
    <div class="item-right">
      <div class="item-saldo ${saldoClass}">${fmt(saldo)}</div>
    </div>
  </div>`
}

async function mostrarDropdownClienteFiscal(e) {
  if (e) e.stopPropagation()
  const inp = document.getElementById('m-cliente-buscar')
  const dd  = document.getElementById('dd-m-clientes')
  if (!inp || !dd) return

  await cargarClientesCache()

  if (!clientesCache.length) {
    dd.innerHTML = '<div class="dropdown-empty">No hay clientes fiscales</div>'
    dd.style.display = 'flex'
    return
  }

  const rect = inp.getBoundingClientRect()
  dd.style.left  = Math.min(Math.max(rect.left, 12), window.innerWidth - 380 - 12) + 'px'
  dd.style.top   = (rect.bottom + 6) + 'px'
  dd.style.width = Math.min(380, Math.max(rect.width, 320)) + 'px'
  dd.style.maxHeight = '280px'
  dd.style.overflowY = 'auto'
  dd.style.overflowX = 'hidden'

  const filtro = (inp.value || '').toLowerCase().trim()
  const filtrados = filtro
    ? clientesCache.filter(c =>
        c.nombre.toLowerCase().includes(filtro) ||
        (c.rfc || '').toLowerCase().includes(filtro) ||
        (c.telefono || '').includes(filtro)
      )
    : clientesCache

  let html = ''
  if (filtrados.length === 0) {
    html += '<div class="dropdown-empty">Sin coincidencias</div>'
  } else {
    html += filtrados.map(renderClienteFiscalItem).join('')
  }
  dd.innerHTML = html
  dd.style.display = 'flex'

  dd.querySelectorAll('.dropdown-item').forEach(it => {
    it.addEventListener('click', ev => {
      ev.stopPropagation()
      const cid = parseInt(it.dataset.cid)
      dd.style.display = 'none'
      seleccionarClienteFiscal(cid)
    })
  })
}

function seleccionarClienteFiscal(clienteId) {
  const c = clientesCache.find(x => x.id === clienteId)
  if (!c) return

  document.getElementById('m-cliente-id').value = c.id
  document.getElementById('m-cliente-buscar').value = c.nombre
  document.getElementById('m-rfc').value = c.rfc || ''
  document.getElementById('m-razon').value = String(c.razonSocial || c.nombre || '').toUpperCase()
  document.getElementById('m-cp').value = c.codigoPostalFiscal || ''
  document.getElementById('m-email').value = c.email || ''
  document.getElementById('m-email-sec1').value = c.emailSecundario1 || ''
  document.getElementById('m-email-sec2').value = c.emailSecundario2 || ''
  document.getElementById('m-regimen').value = c.regimenFiscal || ''
  document.getElementById('m-uso').value = c.usoCfdi || ''
}

function limpiarClienteFiscal() {
  document.getElementById('m-cliente-id').value = ''
  document.getElementById('m-cliente-buscar').value = ''
}

function llenarCatalogosManual() {
  poblarSelectSAT(document.getElementById('m-regimen'), CATALOGO_REGIMENES)
  poblarSelectSAT(document.getElementById('m-uso'), CATALOGO_USOS)
}

async function buscarVentaExactaParaFactura(folio) {
  const resultDiv = document.getElementById('venta-result')

  document.getElementById('m-folio').value = folio
  resultDiv.className = 'venta-search-result show'
  resultDiv.textContent = 'Buscando...'
  document.getElementById('manual-fiscal-fields').style.display = 'none'
  document.getElementById('m-rfc').value     = ''
  document.getElementById('m-razon').value   = ''
  document.getElementById('m-regimen').value = ''
  document.getElementById('m-cp').value      = ''
  document.getElementById('m-uso').value     = ''
  document.getElementById('m-email').value   = ''
  document.getElementById('m-email-sec1').value = ''
  document.getElementById('m-email-sec2').value = ''
  document.getElementById('manual-error').style.display = 'none'
  ventaParaFacturar = null
  document.getElementById('modal-manual').classList.add('active')

  try {
    const res = await fetch(`${API_URL}/ventas/folio/${encodeURIComponent(folio)}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    const data = await res.json().catch(() => ({}))

    if (res.status === 404) {
      resultDiv.className = 'venta-search-result error show'
      resultDiv.textContent = 'Venta no encontrada'
      return
    }

    if (!res.ok) throw new Error(data.error || 'Error al buscar venta')

    const venta = data.data
    if (!venta) {
      resultDiv.className = 'venta-search-result error show'
      resultDiv.textContent = 'Venta no encontrada'
      return
    }

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

    // Autocompletar solo si el cliente tiene RFC registrado.
    // RFC es el indicador mínimo de "este cliente tiene datos fiscales".
    // Sin RFC, el usuario ingresa todo manualmente para evitar datos no fiscales
    // (nombre regular) en campos fiscales (razón social).
    if (venta.cliente && venta.cliente.rfc) {
      document.getElementById('m-rfc').value   = venta.cliente.rfc || ''
      document.getElementById('m-razon').value = String(venta.cliente.razonSocial || venta.cliente.nombre || '').toUpperCase()
      document.getElementById('m-cp').value    = venta.cliente.codigoPostalFiscal || ''
      document.getElementById('m-email').value = venta.cliente.email || ''
      document.getElementById('m-email-sec1').value = venta.cliente.emailSecundario1 || ''
      document.getElementById('m-email-sec2').value = venta.cliente.emailSecundario2 || ''

      const selRegimen = document.getElementById('m-regimen')
      const selUso     = document.getElementById('m-uso')

      if (venta.cliente.regimenFiscal) {
        selRegimen.value = venta.cliente.regimenFiscal
        if (selRegimen.value !== venta.cliente.regimenFiscal) {
          console.warn('Régimen no encontrado en catálogo:', venta.cliente.regimenFiscal)
          selRegimen.value = ''
        }
      }

      if (venta.cliente.usoCfdi) {
        selUso.value = venta.cliente.usoCfdi
        if (selUso.value !== venta.cliente.usoCfdi) {
          console.warn('Uso CFDI no encontrado en catálogo:', venta.cliente.usoCfdi)
          selUso.value = ''
        }
      }

      // Filtrar usos CFDI según régimen autocompletado. El listener 'change'
      // del régimen no se dispara con asignación programática (.value =),
      // por lo que el filtro debe llamarse explícitamente.
      // Mismo patrón usado en verDetalle líneas 149-151.
      filtrarUsosPorRegimen(selRegimen, selUso)
    }

    // Focus al RFC
    setTimeout(() => document.getElementById('m-rfc')?.focus(), 100)

  } catch (e) {
    resultDiv.className = 'venta-search-result error show'
    resultDiv.textContent = 'Error: ' + e.message
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
    email:             document.getElementById('m-email').value.trim(),
    emailSecundario1:  document.getElementById('m-email-sec1').value.trim() || undefined,
    emailSecundario2:  document.getElementById('m-email-sec2').value.trim() || undefined
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
  const errorRazon = validarRazonSocialSat(body.razonSocial)
  if (errorRazon) {
    errDiv.style.display = 'block'
    errDiv.textContent = errorRazon
    return
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
    const res = await fetch(`${API_URL}/facturas/manual`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
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
//  FACTURA GLOBAL — helpers
// ════════════════════════════════════════════════════════════════════
let globalPreviewData = null

window.abrirFacturaGlobal = function() {
  document.getElementById('g-desde').value = ''
  document.getElementById('g-hasta').value = ''
  document.getElementById('g-metodo').value = ''
  document.getElementById('g-periodicidad').value = '02'
  document.getElementById('g-resumen').style.display = 'none'
  document.getElementById('g-preview-table').style.display = 'none'
  document.getElementById('g-preview-table').innerHTML = ''
  document.getElementById('g-error').style.display = 'none'
  document.getElementById('g-mixto-info').style.display = 'none'
  document.getElementById('btn-global-timbrar').disabled = true
  globalPreviewData = null
  document.getElementById('modal-global').classList.add('active')
}

window.previsualizarGlobal = async function() {
  const desde = document.getElementById('g-desde').value
  const hasta = document.getElementById('g-hasta').value
  const metodoPago = document.getElementById('g-metodo').value
  const errorDiv = document.getElementById('g-error')
  const mixtoDiv = document.getElementById('g-mixto-info')
  const resumenDiv = document.getElementById('g-resumen')
  const previewDiv = document.getElementById('g-preview-table')
  const btnTimbrar = document.getElementById('btn-global-timbrar')

  errorDiv.style.display = 'none'
  errorDiv.textContent = ''
  resumenDiv.style.display = 'none'
  previewDiv.style.display = 'none'
  previewDiv.innerHTML = ''
  mixtoDiv.style.display = 'none'
  btnTimbrar.disabled = true
  btnTimbrar.textContent = '⚡ Timbrar Factura Global'
  globalPreviewData = null

  if (!desde || !hasta) {
    errorDiv.textContent = 'Selecciona ambas fechas.'
    errorDiv.style.display = 'block'
    return
  }
  if (!metodoPago) {
    errorDiv.textContent = 'Selecciona el método de pago.'
    errorDiv.style.display = 'block'
    return
  }
  if (desde > hasta) {
    errorDiv.textContent = 'La fecha "Desde" no puede ser mayor que "Hasta".'
    errorDiv.style.display = 'block'
    return
  }
  if (desde.slice(0, 7) !== hasta.slice(0, 7)) {
    errorDiv.textContent = 'El rango no puede cruzar meses ni años.'
    errorDiv.style.display = 'block'
    return
  }

  try {
    const params = new URLSearchParams({ desde, hasta, metodoPago })
    if (USUARIO.empresaId) params.set('empresaId', USUARIO.empresaId)
    const res = await fetch(`${API_URL}/facturas/global/preview?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    const data = await res.json()

    if (!res.ok) {
      errorDiv.textContent = data.error || 'Error al previsualizar'
      errorDiv.style.display = 'block'
      return
    }

    if (data.ventas.length === 0) {
      errorDiv.textContent = 'No hay ventas DISPONIBLE para este método y rango.'
      errorDiv.style.display = 'block'
      return
    }

    if (data.mixto && data.mixto.count > 0) {
      mixtoDiv.innerHTML = `<strong>⚠️ ${data.mixto.count} venta(s) MIXTO</strong> (${fmt(data.mixto.total)}) no incluidas en esta global — requieren factura individual o decisión del contador.`
      mixtoDiv.className = 'venta-search-result show'
      mixtoDiv.style.display = 'flex'
    }

    document.getElementById('g-count').textContent = data.resumen.count
    document.getElementById('g-subtotal').textContent = fmt(data.resumen.subtotal)
    document.getElementById('g-iva').textContent = fmt(data.resumen.iva)
    document.getElementById('g-total').textContent = fmt(data.resumen.total)
    resumenDiv.style.display = 'grid'

    previewDiv.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Folio</th>
            <th>Fecha</th>
            <th>Método</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${data.ventas.map(v => `
          <tr>
            <td>${v.folio}</td>
            <td style="color:var(--muted)">${fmtFecha(v.creadaEn)}</td>
            <td>${v.metodoPago}</td>
            <td><strong>${fmt(v.total)}</strong></td>
          </tr>`).join('')}
        </tbody>
      </table>`
    previewDiv.style.display = 'block'

    btnTimbrar.disabled = false
    globalPreviewData = { desde, hasta, metodoPago, periodicidad: '02', resumen: data.resumen }

  } catch (err) {
    errorDiv.textContent = 'Error de conexión: ' + err.message
    errorDiv.style.display = 'block'
  }
}

window.timbrarGlobal = async function() {
  if (!globalPreviewData) return

  const { desde, hasta, metodoPago, periodicidad, resumen } = globalPreviewData
  const btn = document.getElementById('btn-global-timbrar')
  const errorDiv = document.getElementById('g-error')

  const ok = await jeshaConfirm({
    title: 'Timbrar Factura Global',
    message: `Se emitirá una factura global (${metodoPago}) con ${resumen.count} ventas por un total de ${fmt(resumen.total)}. Esta acción no se puede deshacer.`,
    confirmText: 'Sí, timbrar', type: 'primary'
  })
  if (!ok) return

  btn.disabled = true
  btn.textContent = '⟳ Timbrando...'

  try {
    const bodyTimbrar = { desde, hasta, metodoPago, periodicidad }
    if (USUARIO.empresaId) bodyTimbrar.empresaId = USUARIO.empresaId
    const res = await fetch(`${API_URL}/facturas/global/timbrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify(bodyTimbrar)
    })
    const data = await res.json()

    if (!res.ok) throw new Error(data.error || 'Error al timbrar')

    document.getElementById('modal-global').classList.remove('active')
    cargarFacturas()

    if (data.requiereRevision) {
      jeshaToast(data.mensaje || 'Factura marcada para revisión.', 'warning')
    } else {
      jeshaToast(`✅ Factura Global timbrada — UUID: ${data.uuid}`, 'success')
    }

  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
    btn.disabled = false
    btn.textContent = '⚡ Timbrar Factura Global'
  }
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

  const rolFiscal = ['ADMIN_SUCURSAL','SUPERADMIN','PLATFORM_ADMIN'].includes(USUARIO.rol)
  if (rolFiscal) {
    const btn = document.getElementById('btn-factura-global')
    if (btn) btn.style.display = 'inline-flex'
  }

  cargarFacturas()

  // Filtros
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => { paginaActual = 1; cargarFacturas() }, 400)
  })

  ;['filtro-estado','filtro-desde','filtro-hasta','filtro-metodo'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { paginaActual = 1; cargarFacturas() })
  })

  document.getElementById('btn-limpiar')?.addEventListener('click', () => {
    document.getElementById('search-input').value  = ''
    document.getElementById('filtro-estado').value = ''
    document.getElementById('filtro-desde').value  = ''
    document.getElementById('filtro-hasta').value  = ''
    document.getElementById('filtro-metodo').value = ''
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

  // ── Filtrar usos CFDI al cambiar régimen ──
  document.getElementById('det-regimen').addEventListener('change', function() {
    filtrarUsosPorRegimen(this, document.getElementById('det-uso'))
  })
  document.getElementById('m-regimen').addEventListener('change', function() {
    filtrarUsosPorRegimen(this, document.getElementById('m-uso'))
  })

  // Modal manual — abrir
  document.getElementById('btn-nueva-factura')?.addEventListener('click', () => {
    document.getElementById('m-folio').value = ''
    document.getElementById('venta-result').className = 'venta-search-result'
    document.getElementById('venta-result').innerHTML = ''
    document.getElementById('manual-fiscal-fields').style.display = 'none'
    // Limpiar campos fiscales para evitar fuga de datos de sesión anterior
    document.getElementById('m-rfc').value     = ''
    document.getElementById('m-razon').value   = ''
    document.getElementById('m-regimen').value = ''
    document.getElementById('m-cp').value      = ''
    document.getElementById('m-uso').value     = ''
    document.getElementById('m-email').value   = ''
    document.getElementById('m-email-sec1').value = ''
    document.getElementById('m-email-sec2').value = ''
    document.getElementById('m-cliente-id').value = ''
    document.getElementById('m-cliente-buscar').value = ''
    document.getElementById('manual-error').style.display = 'none'
    ventaParaFacturar = null
    document.getElementById('modal-manual').classList.add('active')
    setTimeout(() => document.getElementById('m-folio')?.focus(), 200)
  })

  // Modal manual — cerrar
  document.getElementById('manual-close')?.addEventListener('click', () => {
    document.getElementById('modal-manual').classList.remove('active')
  })

  // Modal manual — buscar venta
  document.getElementById('btn-buscar-venta')?.addEventListener('click', () => {
    const folio = document.getElementById('m-folio').value.trim()
    if (!folio) {
      const resultDiv = document.getElementById('venta-result')
      resultDiv.className = 'venta-search-result error show'
      resultDiv.textContent = 'Ingresa un folio de venta'
      return
    }
    buscarVentaExactaParaFactura(folio)
  })

  // Modal manual — Enter en folio dispara búsqueda
  document.getElementById('m-folio')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const folio = document.getElementById('m-folio').value.trim()
      if (folio) buscarVentaExactaParaFactura(folio)
    }
  })

  // Modal manual — solo números en CP
  document.getElementById('m-cp')?.addEventListener('input', function() {
    this.value = this.value.replace(/\D/g, '').substring(0, 5)
  })

  // Modal manual — mayúsculas automáticas en razón social
  document.getElementById('m-razon')?.addEventListener('input', function() {
    const pos = this.selectionStart
    const upper = this.value.toUpperCase()
    if (this.value !== upper) {
      this.value = upper
      if (typeof pos === 'number') this.setSelectionRange(pos, pos)
    }
  })

  // Modal detalle — mayúsculas automáticas en nombre (corrección al timbrar pendiente)
  document.getElementById('det-nombre')?.addEventListener('input', function() {
    const pos = this.selectionStart
    const upper = this.value.toUpperCase()
    if (this.value !== upper) {
      this.value = upper
      if (typeof pos === 'number') this.setSelectionRange(pos, pos)
    }
    actualizarAdvertenciaRazonSocial(this)
  })

  function actualizarAdvertenciaRazonSocial(input) {
    const warn = document.getElementById('det-razon-warning')
    if (!warn) return
    const v = (input.value || '').trim()
    const tieneSufijo = /(?:S\.A\.(?:\s*DE\s*C\.V\.)?|SA\s+DE\s+CV|S\.DE\s*R\.L\.(?:\s*DE\s*C\.V\.)?|S\.A\.P\.I\.(?:\s*DE\s*C\.V\.)?|S\.C\.|A\.C\.|S\.N\.C\.|S\.C\.P\.)\s*$/.test(v)
    warn.style.display = tieneSufijo ? 'block' : 'none'
  }

  // Modal manual — timbrar
  document.getElementById('btn-facturar-manual')?.addEventListener('click', facturarManualDesdeModal)

  // Escape cierra cualquier modal abierto
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-detalle')?.classList.remove('active')
      document.getElementById('modal-manual')?.classList.remove('active')
      document.getElementById('modal-global')?.classList.remove('active')
      document.getElementById('candidatos-panel').style.display = 'none'
      limpiarPdfPreview()
    }
  })

  // Modal global — abrir
  document.getElementById('btn-factura-global')?.addEventListener('click', abrirFacturaGlobal)

  // Modal global — cerrar
  document.getElementById('global-close')?.addEventListener('click', () => {
    document.getElementById('modal-global').classList.remove('active')
  })

  // Modal global — previsualizar
  document.getElementById('btn-global-preview')?.addEventListener('click', previsualizarGlobal)

  // Modal global — timbrar
  document.getElementById('btn-global-timbrar')?.addEventListener('click', timbrarGlobal)

  // Modal global — al cambiar fechas o método reiniciar preview
  ;['g-desde','g-hasta','g-metodo'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      document.getElementById('g-resumen').style.display = 'none'
      document.getElementById('g-preview-table').style.display = 'none'
      document.getElementById('g-preview-table').innerHTML = ''
      document.getElementById('g-error').style.display = 'none'
      document.getElementById('g-mixto-info').style.display = 'none'
      document.getElementById('btn-global-timbrar').disabled = true
      globalPreviewData = null
    })
  })

  // ── Auto-facturar desde historial ──
  const urlParams = new URLSearchParams(window.location.search)
  const folioAutoFacturar = urlParams.get('facturar')

  // ── Dropdown cliente fiscal ──
  document.getElementById('m-cliente-buscar')?.addEventListener('focus', mostrarDropdownClienteFiscal)
  document.getElementById('m-cliente-buscar')?.addEventListener('click', mostrarDropdownClienteFiscal)
  document.getElementById('m-cliente-buscar')?.addEventListener('input', mostrarDropdownClienteFiscal)
  document.getElementById('btn-lista-m-clientes')?.addEventListener('click', mostrarDropdownClienteFiscal)

  if (folioAutoFacturar) {
    // Limpiar URL para que un refresh no re-dispare
    window.history.replaceState({}, '', 'facturas.html')
    // Abrir modal manual
    document.getElementById('m-folio').value = ''
    document.getElementById('venta-result').className = 'venta-search-result'
    document.getElementById('venta-result').innerHTML = ''
    document.getElementById('manual-fiscal-fields').style.display = 'none'
    ventaParaFacturar = null
    document.getElementById('modal-manual').classList.add('active')
    // Llenar folio y disparar búsqueda
    document.getElementById('m-folio').value = folioAutoFacturar
    setTimeout(() => buscarVentaExactaParaFactura(folioAutoFacturar), 300)
  }
})

// ── Dropdown cliente fiscal ──
document.addEventListener('click', e => {
  const dd = document.getElementById('dd-m-clientes')
  if (dd && dd.style.display !== 'none'
      && !e.target.closest('#m-cliente-buscar')
      && !e.target.closest('#btn-lista-m-clientes')
      && !e.target.closest('#dd-m-clientes')) {
    dd.style.display = 'none'
  }
})

console.log('✅ facturas.js cargado')
