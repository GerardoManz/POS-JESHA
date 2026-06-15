// ════════════════════════════════════════════════════════════════════
//  COTIZACIONES.JS — v2
//  Soporta PRODUCTOS (descuento por línea + IVA desglosado) y SERVICIOS
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'cotizaciones.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

// ════════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════════

let cotizacionActual = null
let itemsEdicion     = []   // { productoId?, concepto?, unidad, cantidad, precio, descuento, nombre? }
let tipoActual       = 'PRODUCTOS'
let descuentoGlobalPct = 0   // porcentaje de descuento global sobre el total
let clientesLista    = []
let paginaActual     = 1
const LIMIT          = 20
const IVA        = window.__JESHA_IVA__        || 0.16
const IVA_FACTOR = window.__JESHA_IVA_FACTOR__ || 1.16

// ════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════

const fmt = n => `$${parseFloat(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtFecha = iso => iso
  ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'

function fechaHoyLocalInput() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const fechaInputValue = value => value ? String(value).slice(0, 10) : ''
const fechaTabla = value => fechaInputValue(value) || '—'
const round2 = value => parseFloat((parseFloat(value || 0)).toFixed(2))

function desgloseLineaCotizacion(detalle) {
  const cantidad = parseFloat(detalle.cantidad || 0)
  const precioConIva = parseFloat(detalle.precioUnitario || 0)
  const descuentoConIva = parseFloat(detalle.descuento || 0)
  const importeConIva = round2(precioConIva * cantidad)
  const importeSinIva = round2(importeConIva / IVA_FACTOR)
  const descuentoSinIva = round2(descuentoConIva / IVA_FACTOR)
  const netoConIva = round2(importeConIva - descuentoConIva)
  const netoSinIva = round2(importeSinIva - descuentoSinIva)
  const iva = round2(netoConIva - netoSinIva)
  const precioSinIva = round2(precioConIva / IVA_FACTOR)
  const ivaUnitario = round2(precioConIva - precioSinIva)
  return { cantidad, precioConIva, precioSinIva, ivaUnitario, importeSinIva, descuentoConIva, descuentoSinIva, netoConIva, netoSinIva, iva }
}

function resumenProductosCotizacion(detalles = []) {
  return detalles.reduce((acc, d) => {
    const dg = desgloseLineaCotizacion(d)
    acc.subtotalSinIva += dg.importeSinIva
    acc.descuentoSinIva += dg.descuentoSinIva
    acc.iva += dg.iva
    return acc
  }, { subtotalSinIva: 0, descuentoSinIva: 0, iva: 0 })
}

function numeroALetras(n) {
  n = Math.floor(Number(n) || 0)
  if (n === 0) return 'cero'

  const unidades = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
  const especiales = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve']
  const decenas = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
  const centenas = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

  const menorMil = num => {
    if (num === 0) return ''
    if (num === 100) return 'cien'
    const c = Math.floor(num / 100)
    const r = num % 100
    const partes = []
    if (c) partes.push(centenas[c])
    if (r) {
      if (r < 10) partes.push(unidades[r])
      else if (r < 20) partes.push(especiales[r - 10])
      else if (r < 30) partes.push(r === 20 ? 'veinte' : `veinti${unidades[r - 20]}`)
      else {
        const d = Math.floor(r / 10)
        const u = r % 10
        partes.push(u ? `${decenas[d]} y ${unidades[u]}` : decenas[d])
      }
    }
    return partes.join(' ')
  }

  const millones = Math.floor(n / 1000000)
  const miles = Math.floor((n % 1000000) / 1000)
  const resto = n % 1000
  const partes = []

  if (millones) partes.push(millones === 1 ? 'un millón' : `${numeroALetras(millones)} millones`)
  if (miles) partes.push(miles === 1 ? 'mil' : `${menorMil(miles)} mil`)
  if (resto) partes.push(menorMil(resto))

  return partes.join(' ')
}

function montoEnLetras(monto) {
  const total = Math.max(0, round2(monto))
  const pesos = Math.floor(total)
  const centavos = String(Math.round((total - pesos) * 100)).padStart(2, '0')
  let texto = numeroALetras(pesos)
    .replace(/veintiuno$/g, 'veintiún')
    .replace(/ y uno$/g, ' y un')
    .replace(/ uno$/g, ' un')
    .replace(/^uno$/g, 'un')
  const centavosNumero = Number(centavos)
  let centavosTexto = numeroALetras(centavosNumero)
    .replace(/veintiuno$/g, 'veintiún')
    .replace(/ y uno$/g, ' y un')
    .replace(/ uno$/g, ' un')
    .replace(/^uno$/g, 'un')
  return `Cantidad en letra: ${texto.toUpperCase()} CON ${centavosTexto.toUpperCase()} ${centavosNumero === 1 ? 'CENTAVO' : 'CENTAVOS'}`
}

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

function estadoBadge(estado) {
  const m = { PENDIENTE:['pendiente','Pendiente'], CONVERTIDA:['convertida','Convertida'], VENCIDA:['vencida','Vencida'], CANCELADA:['cancelada','Cancelada'] }
  const [cls, label] = m[estado] || ['pendiente', estado]
  return `<span class="estado-badge ${cls}">${label}</span>`
}

function tipoBadge(tipo) {
  return tipo === 'SERVICIOS'
    ? `<span class="tipo-badge servicios">Servicios</span>`
    : `<span class="tipo-badge productos">Productos</span>`
}

function mostrarError(elId, msg) {
  const el = document.getElementById(elId)
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
}
function ocultarError(elId) {
  document.getElementById(elId)?.classList.remove('show')
}

// ════════════════════════════════════════════════════════════════════
//  API
// ════════════════════════════════════════════════════════════════════

// apiFetch global disponible desde sidebar.js

// ════════════════════════════════════════════════════════════════════
//  LISTAR
// ════════════════════════════════════════════════════════════════════

async function cargarCotizaciones() {
  const tbody  = document.getElementById('cot-tbody')
  const pagDiv = document.getElementById('pagination')
  const buscar = document.getElementById('search-input')?.value.trim() || ''
  const estado = document.getElementById('filtro-estado')?.value || ''
  const tipo   = document.getElementById('filtro-tipo')?.value || ''

  tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  try {
    const params = new URLSearchParams({ page: paginaActual, limit: LIMIT, ...(buscar && { buscar }), ...(estado && { estado }), ...(tipo && { tipo }) })
    const data = await apiFetch(`/cotizaciones?${params}`)
    const { cotizaciones, total } = data

    if (!cotizaciones || cotizaciones.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><p>No hay cotizaciones</p></td></tr>`
      pagDiv.style.display = 'none'
      return
    }

    tbody.innerHTML = cotizaciones.map(c => `
      <tr onclick="verCotizacion(${c.id})" title="Ver detalle">
        <td><strong>${c.folio}</strong></td>
        <td>${tipoBadge(c.tipo)}</td>
        <td>${fmtFecha(c.creadaEn)}</td>
        <td>${c.Cliente?.nombre || '<span style="color:var(--muted)">Sin cliente</span>'}</td>
        <td style="color:var(--muted)">${c.DetalleCotizacion?.length || 0}</td>
        <td><strong>${fmt(c.total)}</strong></td>
        <td>${c.venceEn ? fmtFecha(c.venceEn) : '<span style="color:var(--muted)">—</span>'}</td>
        <td>${estadoBadge(c.estado)}</td>
        <td>
          <div class="actions-cell" onclick="event.stopPropagation()">
            <button class="btn-icon" onclick="verCotizacion(${c.id})" title="Ver">👁</button>
            ${c.estado === 'PENDIENTE' ? `<button class="btn-icon" onclick="abrirEdicion(${c.id})" title="Editar">✏️</button>` : ''}
            ${c.tipo === 'PRODUCTOS' ? `<button class="btn-icon" onclick="cargarEnPos(${c.id})" title="Cargar en POS">🛒</button>` : ''}
            <button class="btn-icon" onclick="descargarPdf(${c.id})" title="PDF">📄</button>
          </div>
        </td>
      </tr>
    `).join('')

    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} total)`
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

window.verCotizacion = async function(id) {
  try {
    const data = await apiFetch(`/cotizaciones/${id}`)
    cotizacionActual = data.data
    const c = cotizacionActual

    document.getElementById('ver-folio').textContent = c.folio
    const badgeEl = document.getElementById('ver-estado-badge')
    const estadoMap   = { PENDIENTE:'pendiente', CONVERTIDA:'convertida', VENCIDA:'vencida', CANCELADA:'cancelada' }
    const estadoLabel = { PENDIENTE:'Pendiente', CONVERTIDA:'Convertida', VENCIDA:'Vencida', CANCELADA:'Cancelada' }
    badgeEl.className   = `estado-badge ${estadoMap[c.estado] || 'pendiente'}`
    badgeEl.textContent = estadoLabel[c.estado] || c.estado

    const tipoBadgeEl = document.getElementById('ver-tipo-badge')
    tipoBadgeEl.className   = `tipo-badge-ver ${c.tipo === 'SERVICIOS' ? 'servicios' : 'productos'}`
    tipoBadgeEl.textContent = c.tipo === 'SERVICIOS' ? 'Servicios' : 'Productos'
    tipoBadgeEl.style.background = c.tipo === 'SERVICIOS' ? 'rgba(232,113,10,0.15)' : 'rgba(31,58,102,0.25)'
    tipoBadgeEl.style.color      = c.tipo === 'SERVICIOS' ? 'var(--orange)' : '#7aa4e8'

    document.getElementById('ver-cliente').textContent  = c.Cliente?.nombre || '—'
    document.getElementById('ver-fecha').textContent    = fmtFecha(c.creadaEn)
    document.getElementById('ver-vigencia').textContent = c.venceEn ? fmtFecha(c.venceEn) : '—'
    document.getElementById('ver-usuario').textContent  = c.Usuario?.nombre || '—'

    const notasEl = document.getElementById('ver-notas')
    if (c.notas) { notasEl.textContent = c.notas; notasEl.style.display = 'block' }
    else { notasEl.style.display = 'none' }

    if (c.tipo === 'SERVICIOS') {
      document.getElementById('ver-tabla-productos').style.display = 'none'
      document.getElementById('ver-tabla-servicios').style.display = 'table'
      document.getElementById('ver-resumen-productos').style.display = 'none'
      document.getElementById('ver-resumen-servicios').style.display = 'block'

      document.getElementById('ver-servicios-tbody').innerHTML = (c.DetalleCotizacion || []).map(d => `
        <tr>
          <td>${fechaTabla(d.fechaManual)}</td>
          <td>${d.concepto || '—'}</td>
          <td style="text-align:center">${d.unidad || '—'}</td>
          <td style="text-align:center">${d.cantidad}</td>
          <td>${fmt(d.precioUnitario)}</td>
          <td><strong>${fmt(d.subtotal)}</strong></td>
        </tr>
      `).join('')
      document.getElementById('ver-total-srv').textContent = fmt(c.total)

    } else {
      document.getElementById('ver-tabla-productos').style.display = 'table'
      document.getElementById('ver-tabla-servicios').style.display = 'none'
      document.getElementById('ver-resumen-productos').style.display = 'block'
      document.getElementById('ver-resumen-servicios').style.display = 'none'

      document.getElementById('ver-items-tbody').innerHTML = (c.DetalleCotizacion || []).map(d => {
        const imgHtml = d.Producto?.imagenUrl
          ? `<img src="${d.Producto.imagenUrl}" class="img-producto-ver" alt="${d.Producto.nombre}" />`
          : `<div class="img-placeholder">📦</div>`
        const clave = d.Producto?.codigoInterno || '—'
        const importe = parseFloat(d.precioUnitario) * parseFloat(d.cantidad)
        return `
          <tr>
            <td style="text-align:center">${imgHtml}<div style="font-size:0.7rem;color:var(--muted);margin-top:2px">${clave}</div></td>
            <td>${fechaTabla(d.fechaManual)}</td>
            <td>${d.Producto?.nombre || d.concepto || d.nombre || '—'}</td>
            <td style="text-align:center">${d.unidad || '—'}</td>
            <td style="text-align:center">${d.cantidad}</td>
            <td>${fmt(d.precioUnitario)}</td>
            <td>${fmt(d.descuento || 0)}</td>
            <td><strong>${fmt(importe - parseFloat(d.descuento || 0))}</strong></td>
          </tr>
        `
      }).join('')

      // Calcular desglose IVA (fórmula SAT: base = total / 1.16, IVA = total - base)
      const totalConIva   = parseFloat(c.total)
      const resumen       = resumenProductosCotizacion(c.DetalleCotizacion || [])
      const baseGravable  = round2(totalConIva / IVA_FACTOR)
      const ivaAmount     = round2(totalConIva - baseGravable)
      const descTotal     = (c.DetalleCotizacion || []).reduce((s, d) => s + parseFloat(d.descuento || 0), 0)
      const descGlobal    = parseFloat(c.descuento || 0)
      const descGlobalSinIva = round2(descGlobal / IVA_FACTOR)

      document.getElementById('ver-subtotal').textContent       = fmt(resumen.subtotalSinIva)
      document.getElementById('ver-descuento-total').textContent = fmt(descTotal)
      document.getElementById('ver-descuento-global').style.display = descGlobal > 0 ? 'flex' : 'none'
      if (descGlobal > 0) {
        document.getElementById('ver-descuento-global-monto').textContent = fmt(descGlobal)
      }
      document.getElementById('ver-base-gravable').textContent  = fmt(baseGravable)
      document.getElementById('ver-iva').textContent             = fmt(ivaAmount)
      document.getElementById('ver-total').textContent           = fmt(totalConIva)
    }

    const btnEditar   = document.getElementById('btn-editar-cot')
    const btnCancelar = document.getElementById('btn-cancelar-cot')
    const btnPos      = document.getElementById('btn-cargar-pos')
    btnEditar.style.display   = c.estado === 'PENDIENTE' ? 'flex' : 'none'
    btnCancelar.style.display = c.estado === 'PENDIENTE' ? 'flex' : 'none'
    btnPos.style.display      = c.tipo === 'PRODUCTOS' ? 'flex' : 'none'

    document.getElementById('modal-ver').classList.add('active')
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
  }
}

// ════════════════════════════════════════════════════════════════════
//  MODAL CREAR / EDITAR
// ════════════════════════════════════════════════════════════════════

function abrirModalNuevo() {
  cotizacionActual = null
  itemsEdicion     = []
  tipoActual       = 'PRODUCTOS'
  descuentoGlobalPct = 0
  document.getElementById('modal-titulo').textContent = 'Nueva Cotización'
  document.getElementById('cot-vence').value          = ''
  document.getElementById('cot-notas').value          = ''
  document.getElementById('search-producto-modal').value = ''
  document.getElementById('lista-productos-modal').innerHTML = '<p class="muted-hint">Escribe para buscar productos...</p>'
  cerrarDropdownProductosCot()
  ocultarError('modal-error')

  // ── Resetear descuento ──
  const inputDesc = document.getElementById('cot-descuento-input')
  if (inputDesc) { inputDesc.value = ''; inputDesc.style.borderColor = '' }
  const avisoDesc = document.getElementById('cot-descuento-aviso')
  if (avisoDesc) avisoDesc.style.display = 'none'
  const filaDesc = document.getElementById('cot-descuento-fila')
  if (filaDesc) filaDesc.style.display = 'none'

  // ── Cliente: habilitado para nueva cotización ──
  const clienteInput = document.getElementById('cot-cliente-buscar')
  clienteInput.value          = ''
  clienteInput.disabled       = false
  clienteInput.style.opacity  = ''
  clienteInput.style.cursor   = ''
  document.getElementById('cot-cliente-id').value = ''
  const chevron = document.getElementById('btn-chevron-cliente')
  if (chevron) chevron.style.display = ''

  // ── Tabs: mostrar ambos ──
  document.querySelectorAll('.tipo-tab').forEach(tab => { tab.style.display = '' })

  setTipoModal('PRODUCTOS')
  renderItems()
  document.getElementById('modal-cotizacion').classList.add('active')
}

window.abrirEdicion = async function(id) {
  document.getElementById('modal-ver').classList.remove('active')
  try {
    const data = await apiFetch(`/cotizaciones/${id}`)
    cotizacionActual = data.data
    const c = cotizacionActual
    tipoActual = c.tipo || 'PRODUCTOS'

    document.getElementById('modal-titulo').textContent = `Editar ${c.folio}`
    document.getElementById('cot-vence').value          = c.venceEn ? c.venceEn.split('T')[0] : ''
    document.getElementById('cot-notas').value          = c.notas || ''
    document.getElementById('search-producto-modal').value = ''
    document.getElementById('lista-productos-modal').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
    cerrarDropdownProductosCot()
    ocultarError('modal-error')

    // ── Cliente: bloqueado en edición ──
    const clienteInput = document.getElementById('cot-cliente-buscar')
    const clienteId    = c.Cliente?.id || c.clienteId || ''
    clienteInput.value          = c.Cliente?.nombre || ''
    clienteInput.disabled       = true
    clienteInput.style.opacity  = '0.6'
    clienteInput.style.cursor   = 'not-allowed'
    document.getElementById('cot-cliente-id').value    = clienteId
    document.getElementById('btn-chevron-cliente').style.display = 'none'

    // ── Restaurar descuento global ──
    const descAmt = parseFloat(c.descuento || 0)
    if (descAmt > 0) {
      const totalAntesDesc = parseFloat(c.total) + descAmt
      descuentoGlobalPct = totalAntesDesc > 0 ? parseFloat(((descAmt / totalAntesDesc) * 100).toFixed(1)) : 0
    } else {
      descuentoGlobalPct = 0
    }
    const inputDesc = document.getElementById('cot-descuento-input')
    if (inputDesc) { inputDesc.value = descuentoGlobalPct > 0 ? descuentoGlobalPct : ''; inputDesc.style.borderColor = '' }
    const avisoDesc = document.getElementById('cot-descuento-aviso')
    if (avisoDesc) avisoDesc.style.display = 'none'

    // ── Tabs de tipo: ocultar el que no corresponde ──
    document.querySelectorAll('.tipo-tab').forEach(tab => {
      tab.style.display = tab.dataset.tipo === tipoActual ? '' : 'none'
    })

    itemsEdicion = (c.DetalleCotizacion || []).map(d => ({
      productoId: d.productoId || d.Producto?.id,
      nombre:     d.Producto?.nombre || d.concepto || '—',
      codigoInterno: d.Producto?.codigoInterno || null,
      codigoBarras:  d.Producto?.codigoBarras || null,
      concepto:   d.concepto || '',
      unidad:     d.unidad || '',
      cantidad:   d.cantidad,
      precio:     parseFloat(d.precioUnitario),
      descuento:  parseFloat(d.descuento || 0),
      fechaManual: fechaInputValue(d.fechaManual)
    }))

    setTipoModal(tipoActual)
    renderItems()
    document.getElementById('modal-cotizacion').classList.add('active')
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

function setTipoModal(tipo) {
  tipoActual = tipo
  document.querySelectorAll('.tipo-tab').forEach(t => t.classList.toggle('active', t.dataset.tipo === tipo))
  const esProductos = tipo === 'PRODUCTOS'

  // Colapsar/expandir grid según tipo
  const split = document.querySelector('.modal-body-split')
  if (split) split.classList.toggle('servicios-mode', !esProductos)

  document.getElementById('panel-productos-left').style.display       = esProductos ? 'flex' : 'none'
  document.getElementById('tabla-productos-container').style.display  = esProductos ? 'block' : 'none'
  document.getElementById('tabla-servicios-container').style.display  = esProductos ? 'none' : 'block'
}

// ── Render ítems según tipo ──
function renderItems() {
  if (tipoActual === 'PRODUCTOS') renderItemsProductos()
  else renderItemsServicios()
}

function renderItemsProductos() {
  const tbody = document.getElementById('items-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="items-empty"><td colspan="9" class="empty-items">Agrega productos desde el buscador superior</td></tr>`
    actualizarTotal()
    return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => {
    const codigo = item.codigoInterno || item.codigoBarras || '—'
    return `
    <tr id="cot-item-${item.productoId}">
      <td><span class="cot-item-codigo">${codigo}</span></td>
      <td><input type="date" value="${item.fechaManual || ''}" style="width:120px" oninput="itemsEdicion[${i}].fechaManual=this.value" /></td>
      <td><div class="cot-item-desc">${item.nombre}</div></td>
      <td><input type="text" value="${item.unidad || 'PZA'}" style="width:50px" oninput="itemsEdicion[${i}].unidad=this.value" /></td>
      <td><input type="number" min="1" value="${item.cantidad}" style="width:52px" oninput="actualizarCantidadItem(${i},this.value)" min="${item.esGranel ? 0.001 : 1}" step="1" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.precio.toFixed(2)}" style="width:82px" oninput="actualizarPrecioItem(${i},this.value)" /></td>
      <td><input type="number" min="0" step="0.01" value="${(item.descuento || 0).toFixed(2)}" style="width:82px" oninput="actualizarDescuentoItem(${i},this.value)" /></td>
      <td id="prod-total-${i}"><strong>${fmt((item.precio * item.cantidad) - item.descuento)}</strong></td>
      <td><button class="btn-icon" onclick="quitarItem(${i})" style="color:#f44336">&times;</button></td>
    </tr>
  `}).join('')
  actualizarTotal()
}

function renderItemsServicios() {
  const tbody = document.getElementById('servicios-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="servicios-empty"><td colspan="7" class="empty-items">Agrega líneas con el botón +</td></tr>`
    actualizarTotal()
    return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => `
    <tr>
      <td><input type="date" value="${item.fechaManual || ''}" style="width:120px" oninput="itemsEdicion[${i}].fechaManual=this.value" /></td>
      <td><input type="text" value="${item.concepto || ''}" placeholder="Descripción del servicio" style="width:100%;min-width:180px" oninput="itemsEdicion[${i}].concepto=this.value" /></td>
      <td><input type="text" value="${item.unidad || ''}" placeholder="m2" style="width:60px" oninput="itemsEdicion[${i}].unidad=this.value" /></td>
      <td><input type="number" min="1" value="${item.cantidad}" style="width:52px" oninput="actualizarCantidadItem(${i},this.value)" min="${item.esGranel ? 0.001 : 1}" step="1" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.precio.toFixed(2)}" style="width:82px" oninput="actualizarPrecioItem(${i},this.value)" /></td>
      <td id="srv-total-${i}"><strong>${fmt(item.precio * item.cantidad)}</strong></td>
      <td><button class="btn-icon" onclick="quitarItem(${i})" style="color:#f44336">&times;</button></td>
    </tr>
  `).join('')
  actualizarTotal()
}

window.actualizarCantidadItem = function(i, v) {
  const n = parseFloat(parseFloat(v).toFixed(3))
  if (!isNaN(n) && n > 0) { itemsEdicion[i].cantidad = n; actualizarFilaTotal(i) }
}
window.actualizarPrecioItem = function(i, v) {
  const n = parseFloat(v)
  if (!isNaN(n) && n >= 0) { itemsEdicion[i].precio = n; actualizarFilaTotal(i) }
}
window.actualizarDescuentoItem = function(i, v) {
  const n = parseFloat(v)
  if (!isNaN(n) && n >= 0) { itemsEdicion[i].descuento = n; actualizarFilaTotal(i) }
}
window.quitarItem = function(i) { itemsEdicion.splice(i, 1); renderItems() }

function actualizarFilaTotal(i) {
  const item  = itemsEdicion[i]
  const total = (item.precio * item.cantidad) - (item.descuento || 0)
  // Actualizar celda de la fila sin tocar el resto del DOM
  const celda = document.getElementById(`prod-total-${i}`) || document.getElementById(`srv-total-${i}`)
  if (celda) celda.innerHTML = `<strong>${fmt(total)}</strong>`
  actualizarTotal()
}

function actualizarTotal() {
  const totalLineas = itemsEdicion.reduce((s, i) => s + (i.precio * i.cantidad) - (i.descuento || 0), 0)
  const pct = descuentoGlobalPct
  const descAmt = parseFloat((totalLineas * (pct / 100)).toFixed(2))
  const totalFinal = parseFloat((totalLineas - descAmt).toFixed(2))

  document.getElementById('modal-total').textContent = fmt(totalFinal)

  const filaDesc = document.getElementById('cot-descuento-fila')
  const elDesc = document.getElementById('modal-descuento')
  if (filaDesc && elDesc) {
    if (pct > 0 && totalLineas > 0) {
      elDesc.textContent = `-${fmt(descAmt)} (${pct}%)`
      filaDesc.style.display = 'flex'
    } else {
      filaDesc.style.display = 'none'
    }
  }
}

function enfocarItemCotizacion(productoId) {
  requestAnimationFrame(() => {
    const fila = document.getElementById(`cot-item-${productoId}`)
    if (!fila) return

    const wrapper = fila.closest('.cot-items-wrapper') || document.querySelector('.cot-items-wrapper')
    if (wrapper) {
      const wrapperRect = wrapper.getBoundingClientRect()
      const filaRect = fila.getBoundingClientRect()
      const margen = 18

      if (filaRect.top < wrapperRect.top + margen) {
        wrapper.scrollTo({ top: wrapper.scrollTop + (filaRect.top - wrapperRect.top) - margen, behavior: 'smooth' })
      } else if (filaRect.bottom > wrapperRect.bottom - margen) {
        wrapper.scrollTo({ top: wrapper.scrollTop + (filaRect.bottom - wrapperRect.bottom) + margen, behavior: 'smooth' })
      }
    } else {
      fila.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }

    fila.classList.remove('fila-resaltada')
    requestAnimationFrame(() => fila.classList.add('fila-resaltada'))
  })
}

function agregarProductoAItems(prod) {
  const existe = itemsEdicion.find(i => i.productoId === prod.id)
  if (existe) {
    existe.cantidad += 1
    existe.codigoInterno = existe.codigoInterno || prod.codigoInterno || null
    existe.codigoBarras  = existe.codigoBarras  || prod.codigoBarras  || null
  }
  else {
    itemsEdicion.push({
      productoId: prod.id,
      nombre:     prod.nombre,
      codigoInterno: prod.codigoInterno || null,
      codigoBarras:  prod.codigoBarras || null,
      unidad:     prod.unidadVenta || 'PZA',
      cantidad:   prod.esGranel ? 0.1 : 1,
      precio:     parseFloat(prod.precioVenta || prod.precioBase),
      descuento:  0,
      esGranel:   prod.esGranel || false,
      fechaManual: fechaHoyLocalInput()
    })
  }
  renderItems()
  enfocarItemCotizacion(prod.id)
}

function agregarLineaServicio() {
  itemsEdicion.push({ concepto: '', unidad: '', cantidad: 1, precio: 0, descuento: 0, fechaManual: fechaHoyLocalInput() })
  renderItems()
}

// ── Guardar ──
async function guardarCotizacion() {
  ocultarError('modal-error')
  if (itemsEdicion.length === 0) { mostrarError('modal-error', 'Agrega al menos una línea.'); return }

  const clienteId = document.getElementById('cot-cliente-id').value || null
  const venceEn   = document.getElementById('cot-vence').value || null
  const notas     = document.getElementById('cot-notas').value.trim() || null

  // Calcular descuento global
  const totalLineas = itemsEdicion.reduce((s, i) => s + (i.precio * i.cantidad) - (i.descuento || 0), 0)
  const descAmt = parseFloat((totalLineas * (descuentoGlobalPct / 100)).toFixed(2))

  let detalles
  if (tipoActual === 'PRODUCTOS') {
    detalles = itemsEdicion.map(i => ({
      productoId:     i.productoId,
      unidad:         i.unidad,
      cantidad:       i.cantidad,
      precioUnitario: i.precio,
      descuento:      i.descuento || 0,
      fechaManual:    i.fechaManual || null
    }))
  } else {
    detalles = itemsEdicion.map(i => ({
      concepto:       i.concepto,
      unidad:         i.unidad,
      cantidad:       i.cantidad,
      precioUnitario: i.precio,
      descuento:      0,
      fechaManual:    i.fechaManual || null
    }))
  }

  const btn = document.getElementById('btn-guardar-cotizacion')
  btn.disabled  = true
  btn.textContent = 'Guardando...'

  try {
    let data
    if (cotizacionActual) {
      data = await apiFetch(`/cotizaciones/${cotizacionActual.id}`, { method: 'PUT', body: JSON.stringify({ clienteId, venceEn, notas, detalles, tipo: tipoActual, descuento: descAmt }) })
    } else {
      data = await apiFetch('/cotizaciones', { method: 'POST', body: JSON.stringify({ clienteId, venceEn, notas, detalles, tipo: tipoActual, descuento: descAmt }) })
    }
    cotizacionActual = data?.data ?? cotizacionActual
    document.getElementById('modal-cotizacion').classList.remove('active')
    paginaActual = 1
    cargarCotizaciones()
  } catch (err) {
    mostrarError('modal-error', err.message)
  } finally {
    btn.disabled = false
    btn.textContent = 'Guardar Cotización'
  }
}

// ════════════════════════════════════════════════════════════════════
//  BUSQUEDA PRODUCTOS EN MODAL
// ════════════════════════════════════════════════════════════════════

let debounceProducto
let busquedaProductoSeq = 0
const PRODUCTOS_MODAL_LIMIT = 100
let busquedaProductoTermino = ''
let busquedaProductoPagina = 1
let busquedaProductoTotalPaginas = 1
let busquedaProductoTotal = 0
let busquedaProductoCargando = false
let productosModalResultados = []

function posicionarDropdownProductosCot() {
  const lista = document.getElementById('lista-productos-modal')
  const input = document.getElementById('search-producto-modal')
  if (!lista || !input || !lista.classList.contains('is-open')) return

  const anchor = input.closest('.producto-search-group') || input
  const rect = anchor.getBoundingClientRect()
  const margen = 8
  const top = rect.bottom + 8
  const left = Math.max(margen, rect.left)
  const width = Math.min(rect.width, window.innerWidth - left - margen)
  const maxHeight = Math.max(180, window.innerHeight - top - margen)

  lista.style.top = `${top}px`
  lista.style.left = `${left}px`
  lista.style.width = `${width}px`
  lista.style.maxHeight = `${Math.min(460, maxHeight)}px`
}

function abrirDropdownProductosCot() {
  const lista = document.getElementById('lista-productos-modal')
  if (lista) {
    lista.classList.add('is-open')
    posicionarDropdownProductosCot()
  }
}

function cerrarDropdownProductosCot() {
  const lista = document.getElementById('lista-productos-modal')
  if (!lista?.classList.contains('is-open')) return
  busquedaProductoSeq++
  lista.classList.remove('is-open')
}

function resetBusquedaProductosModal() {
  busquedaProductoTermino = ''
  busquedaProductoPagina = 1
  busquedaProductoTotalPaginas = 1
  busquedaProductoTotal = 0
  busquedaProductoCargando = false
  productosModalResultados = []
  window._productosModalCache = {}
}

function renderProductosModal({ preserveScroll = false } = {}) {
  const lista = document.getElementById('lista-productos-modal')
  if (!lista) return
  const scrollTop = preserveScroll ? lista.scrollTop : 0

  window._productosModalCache = {}
  productosModalResultados.forEach(p => { window._productosModalCache[p.id] = p })

  const itemsHtml = productosModalResultados.map(p => {
    const codigo = p.codigoInterno || p.codigoBarras || '—'
    return `
      <div class="producto-item-modal" data-producto-id="${p.id}">
        <span class="prod-codigo">${escapeHtml(codigo)}</span>
        <span class="prod-nombre">${escapeHtml(p.nombre)}</span>
        <span class="prod-precio">${fmt(p.precioVenta || p.precioBase)}</span>
      </div>
    `
  }).join('')

  const hayMas = busquedaProductoPagina < busquedaProductoTotalPaginas
  const total = busquedaProductoTotal || productosModalResultados.length
  const masHtml = hayMas ? `
    <button type="button" class="producto-load-more" ${busquedaProductoCargando ? 'disabled' : ''}>
      ${busquedaProductoCargando ? 'Cargando...' : `Ver más resultados (${productosModalResultados.length} de ${total})`}
    </button>
  ` : ''

  lista.innerHTML = itemsHtml + masHtml
  abrirDropdownProductosCot()
  if (preserveScroll) lista.scrollTop = scrollTop
}

async function cargarPaginaProductosModal(page, seq) {
  const params = new URLSearchParams({ buscar: busquedaProductoTermino, page, limit: PRODUCTOS_MODAL_LIMIT })
  const data = await apiFetch(`/productos?${params}`)
  if (seq !== busquedaProductoSeq) return false

  const productos = Array.isArray(data) ? data : (data.data || [])
  const pag = !Array.isArray(data) ? data.paginacion : null
  busquedaProductoPagina = pag?.pagina || page
  busquedaProductoTotalPaginas = pag?.totalPaginas || 1
  busquedaProductoTotal = pag?.total || productos.length

  if (page === 1) {
    productosModalResultados = productos
  } else {
    const idsActuales = new Set(productosModalResultados.map(p => p.id))
    productosModalResultados = productosModalResultados.concat(productos.filter(p => !idsActuales.has(p.id)))
  }

  return true
}

async function buscarProductosModal(q) {
  const lista = document.getElementById('lista-productos-modal')
  if (!lista) return
  const seq = ++busquedaProductoSeq
  if (!q || q.length < 2) {
    resetBusquedaProductosModal()
    lista.innerHTML = '<p class="muted-hint">Escribe para buscar productos...</p>'
    cerrarDropdownProductosCot()
    return
  }
  busquedaProductoTermino = q
  busquedaProductoPagina = 1
  busquedaProductoTotalPaginas = 1
  busquedaProductoTotal = 0
  productosModalResultados = []
  busquedaProductoCargando = true
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  abrirDropdownProductosCot()
  try {
    const ok = await cargarPaginaProductosModal(1, seq)
    if (!ok) return
    busquedaProductoCargando = false
    if (productosModalResultados.length === 0) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; abrirDropdownProductosCot(); return }
    renderProductosModal()
  } catch (err) {
    busquedaProductoCargando = false
    if (seq !== busquedaProductoSeq) return
    lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error: ${escapeHtml(err.message)}</p>`
    abrirDropdownProductosCot()
  }
}

async function cargarMasProductosModal() {
  if (busquedaProductoCargando || busquedaProductoPagina >= busquedaProductoTotalPaginas) return
  const seq = busquedaProductoSeq
  busquedaProductoCargando = true
  renderProductosModal({ preserveScroll: true })
  try {
    const ok = await cargarPaginaProductosModal(busquedaProductoPagina + 1, seq)
    if (!ok) return
  } catch (err) {
    const lista = document.getElementById('lista-productos-modal')
    if (lista) lista.insertAdjacentHTML('beforeend', `<p class="muted-hint" style="color:#f44336">Error: ${escapeHtml(err.message)}</p>`)
  } finally {
    busquedaProductoCargando = false
    if (seq === busquedaProductoSeq) renderProductosModal({ preserveScroll: true })
  }
}

window._addProd = function(id) {
  const p = window._productosModalCache?.[id]
  if (!p) return
  busquedaProductoSeq++
  agregarProductoAItems(p)
  document.getElementById('search-producto-modal').value = ''
  document.getElementById('lista-productos-modal').innerHTML = '<p class="muted-hint">Escribe para buscar productos...</p>'
  resetBusquedaProductosModal()
  cerrarDropdownProductosCot()
}

// ════════════════════════════════════════════════════════════════════
//  AUTOCOMPLETE CLIENTES
// ════════════════════════════════════════════════════════════════════

async function cargarClientes() {
  try {
    const data = await apiFetch('/clientes?activo=true')
    clientesLista = Array.isArray(data) ? data : (data.data || [])
  } catch (e) { console.warn('No se pudieron cargar clientes:', e.message) }
}

// Filtra en memoria — sin mínimo de caracteres para poder mostrar toda la lista
function filtrarClientes(q) {
  const l = (q || '').toLowerCase().trim()
  if (!l) return clientesLista.slice(0, 50)
  return clientesLista.filter(c =>
    c.nombre?.toLowerCase().includes(l) ||
    c.apodo?.toLowerCase().includes(l)  ||
    c.rfc?.toLowerCase().includes(l)    ||
    c.telefono?.includes(l)
  ).slice(0, 50)
}

// Renderiza items del dropdown — incluye opción de público general
function renderDropdownClientes(lista) {
  const dd = document.getElementById('dropdown-clientes')
  if (!dd) return

  // Construir buscador interno + lista
  dd.innerHTML = `
    <div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <input type="text" id="dd-cot-search"
        placeholder="Buscar cliente..."
        autocomplete="off"
        style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
               border-radius:6px;padding:6px 10px;color:var(--text,#fff);font-size:0.85rem;outline:none;" />
    </div>
    <div id="dd-cot-list" style="max-height:220px;overflow-y:auto;"></div>
  `
  dd.style.display = 'block'

  // Render items
  const renderItems = (items) => {
    const listEl = document.getElementById('dd-cot-list')
    if (!listEl) return
    listEl.innerHTML =
      `<div class="dropdown-item" style="color:var(--muted);font-style:italic;"
            onclick="seleccionarCliente(null, '')">
         👤 Público general
       </div>` +
      (items.length === 0
        ? `<div style="padding:10px 12px;color:var(--muted);font-size:0.85rem;">Sin resultados</div>`
        : items.map(c => `
            <div class="dropdown-item" onclick="seleccionarCliente(${c.id}, '${(c.apodo || c.nombre).replace(/'/g,"\\'")}')">
              <span>${c.apodo ? `${c.apodo} <span style="color:var(--muted);font-size:0.78rem">(${c.nombre})</span>` : c.nombre}</span>
              ${c.telefono ? `<span style="color:var(--muted);font-size:0.75rem;">${c.telefono}</span>` : ''}
            </div>`
          ).join('')
      )
  }
  renderItems(lista)

  // Buscador interno del dropdown
  const ddInput = document.getElementById('dd-cot-search')
  if (ddInput) {
    ddInput.addEventListener('input', e => renderItems(filtrarClientes(e.target.value)))
    setTimeout(() => ddInput.focus(), 40)
  }
}

// Abre el dropdown con toda la lista (sin filtro)
function abrirDropdownClientesCot() {
  const dd = document.getElementById('dropdown-clientes')
  if (!dd) return
  // Toggle
  if (dd.style.display !== 'none') {
    cerrarDropdownClientesCot()
    return
  }
  renderDropdownClientes(filtrarClientes(''))
}

function cerrarDropdownClientesCot() {
  const dd = document.getElementById('dropdown-clientes')
  if (dd) dd.style.display = 'none'
  document.getElementById('btn-chevron-cliente')?.classList.remove('active')
}

window.seleccionarCliente = function(id, nombre) {
  document.getElementById('cot-cliente-id').value     = id || ''
  document.getElementById('cot-cliente-buscar').value = nombre || ''
  cerrarDropdownClientesCot()
}

// ════════════════════════════════════════════════════════════════════
//  CAMBIAR ESTADO
// ════════════════════════════════════════════════════════════════════

async function cancelarCotizacion(id) {
  if (!cotizacionActual || cotizacionActual.id !== id) return
  const ok = await jeshaConfirm({
    title: 'Cancelar cotización',
    message: `¿Cancelar la cotización <strong>${cotizacionActual.folio}</strong>?`,
    confirmText: 'Sí, cancelar', type: 'danger'
  })
  if (!ok) return
  try {
    await apiFetch(`/cotizaciones/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'CANCELADA' }) })
    document.getElementById('modal-ver').classList.remove('active')
    cargarCotizaciones()
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// ════════════════════════════════════════════════════════════════════
//  CARGAR EN POS
// ════════════════════════════════════════════════════════════════════

window.cargarEnPos = async function(id) {
  try {
    const d = await apiFetch(`/cotizaciones/${id}`)
    const cot = d.data
    cotizacionActual = cot
    if (!cot.DetalleCotizacion || cot.DetalleCotizacion.length === 0) { jeshaToast('Esta cotización no tiene productos', 'warning'); return }
    const posPayload = {
      fuente: 'cotizacion', cotFolio: cot.folio, cotId: cot.id,
      clienteId: cot.Cliente?.id || null, clienteNombre: cot.Cliente?.nombre || '',
      items: cot.DetalleCotizacion.map(d => ({
        id:       d.Producto?.id ?? d.productoId,
        nombre:   d.Producto?.nombre || '—',
        precio:   parseFloat(d.precioUnitario),
        cantidad: parseFloat(d.cantidad) || 1
      }))
    }
    localStorage.setItem('pos_cotizacion', JSON.stringify(posPayload))
    window.location.href = 'punto-venta.html'
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// ════════════════════════════════════════════════════════════════════
//  PDF
// ════════════════════════════════════════════════════════════════════

window.descargarPdf = async function(id) {
  try {
    const d = await apiFetch(`/cotizaciones/${id}`)
    const cot = d.data
    cotizacionActual = cot
    generarPdf(cot)
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

const LOGO_URL = window.__JESHA_LOGO_URL__

function logoPdfUrl() {
  if (!LOGO_URL) return ''
  return LOGO_URL.replace('/image/upload/', '/image/upload/e_trim/c_fit,w_840,h_300,q_100,f_png/')
}

function generarPdf(c) {
  const esProductos = c.tipo !== 'SERVICIOS'
  const vigencia    = c.venceEn ? `<p><strong>Vigencia:</strong> ${fmtFecha(c.venceEn)}</p>` : ''
  const notas       = c.notas  ? `<p style="margin-top:16px;font-size:12px;color:#555"><strong>Notas:</strong> ${c.notas}</p>` : ''
  const totalNumerico = parseFloat(c.total || 0)
  const totalLetras = montoEnLetras(totalNumerico)
  const logoUrl = logoPdfUrl()

  let tablaHtml = ''
  let resumenHtml = ''

  if (esProductos) {
    // Tabla con imagen + clave + descuento + IVA desglosado
    const lineas = (c.DetalleCotizacion || []).map(d => {
      const dg = desgloseLineaCotizacion(d)
      const imgHtml  = d.Producto?.imagenUrl
        ? `<img src="${d.Producto.imagenUrl}" style="width:48px;height:48px;object-fit:contain;display:block;margin:0 auto" />`
        : `<div style="width:48px;height:48px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:18px;margin:0 auto">📦</div>`
      const clave    = d.Producto?.codigoInterno || '—'
      const unidad   = d.unidad || d.Producto?.unidadVenta || 'PZA'
      return `
        <tr>
          <td style="text-align:center;padding:8px">${imgHtml}<div style="font-size:10px;color:#888;margin-top:2px">${clave}</div></td>
          <td style="text-align:center">${fechaTabla(d.fechaManual)}</td>
          <td style="text-align:center">${dg.cantidad}</td>
          <td style="text-align:center">${unidad}</td>
          <td>${d.Producto?.nombre || d.concepto || '—'}</td>
          <td style="text-align:right">$${dg.precioSinIva.toFixed(2)}</td>
          <td style="text-align:right">$${dg.ivaUnitario.toFixed(2)}</td>
          <td style="text-align:right">$${dg.precioConIva.toFixed(2)}</td>
          <td style="text-align:right">$${dg.descuentoConIva.toFixed(2)}</td>
          <td style="text-align:right"><strong>$${dg.netoConIva.toFixed(2)}</strong></td>
        </tr>`
    }).join('')

    const resumen = resumenProductosCotizacion(c.DetalleCotizacion || [])
    const subtotalSinIva = round2(resumen.subtotalSinIva)
    const descuentoSinIva = round2(resumen.descuentoSinIva)
    const baseGravable = round2(totalNumerico / IVA_FACTOR)
    const ivaAmount = round2(totalNumerico - baseGravable)
    const descGlobal = parseFloat(c.descuento || 0)
    const descGlobalSinIva = round2(descGlobal / IVA_FACTOR)

    tablaHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:80px;text-align:center">IMAGEN/CLAVE</th>
            <th style="width:70px;text-align:center">FECHA</th>
            <th style="width:45px;text-align:center">CANT</th>
            <th style="width:60px;text-align:center">UNIDAD</th>
            <th>DESCRIPCIÓN</th>
            <th style="width:75px;text-align:right">P.U. SIN IVA</th>
            <th style="width:65px;text-align:right">IVA UNIT.</th>
            <th style="width:75px;text-align:right">P.U. C/IVA</th>
            <th style="width:75px;text-align:right">DESCUENTO</th>
            <th style="width:90px;text-align:right">IMPORTE</th>
          </tr>
        </thead>
        <tbody>${lineas}</tbody>
      </table>`

    resumenHtml = `
      <div class="resumen-box">
        <div class="resumen-row"><span>Subtotal sin IVA:</span><span>$${subtotalSinIva.toFixed(2)}</span></div>
        ${descuentoSinIva > 0 ? `<div class="resumen-row"><span>Descuento por línea (sin IVA):</span><span>-$${descuentoSinIva.toFixed(2)}</span></div>` : ''}
        ${descGlobal > 0 ? `<div class="resumen-row"><span>Descuento global:</span><span style="color:#e8710a;">-$${descGlobal.toFixed(2)}</span></div>` : ''}
        <div class="resumen-row"><span>Base gravable:</span><span>$${baseGravable.toFixed(2)}</span></div>
        <div class="resumen-row"><span>IVA (16%):</span><span>$${ivaAmount.toFixed(2)}</span></div>
        <div class="resumen-row total"><span>Total:</span><span>$${totalNumerico.toFixed(2)}</span></div>
        <div class="resumen-letras">${totalLetras}</div>
      </div>`
  } else {
    // SERVICIOS — tabla simple
    const lineas = (c.DetalleCotizacion || []).map(d => `
      <tr>
        <td style="text-align:center">${fechaTabla(d.fechaManual)}</td>
        <td>${d.concepto || '—'}</td>
        <td style="text-align:center">${d.unidad || '—'}</td>
        <td style="text-align:center">${d.cantidad}</td>
        <td style="text-align:right">$${parseFloat(d.precioUnitario).toFixed(2)}</td>
        <td style="text-align:right"><strong>$${parseFloat(d.subtotal).toFixed(2)}</strong></td>
      </tr>`
    ).join('')

    const subtotalServicios = round2((c.DetalleCotizacion || []).reduce((s, d) => s + parseFloat(d.subtotal || 0), 0))
    const ivaServicios = round2(subtotalServicios * IVA)
    const totalServicios = round2(subtotalServicios + ivaServicios)
    const totalServiciosLetras = montoEnLetras(totalServicios)

    tablaHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:80px;text-align:center">FECHA</th>
            <th>CONCEPTO</th>
            <th style="width:80px;text-align:center">UNIDAD</th>
            <th style="width:60px;text-align:center">CANTIDAD</th>
            <th style="width:100px;text-align:right">P.U.</th>
            <th style="width:100px;text-align:right">TOTAL</th>
          </tr>
        </thead>
        <tbody>${lineas}</tbody>
      </table>`

    resumenHtml = `
      <div class="resumen-box">
        <div class="resumen-row"><span>Subtotal del trabajo:</span><span>$${subtotalServicios.toFixed(2)}</span></div>
        <div class="resumen-row"><span>IVA (${Math.round(IVA * 100)}%):</span><span>$${ivaServicios.toFixed(2)}</span></div>
        <div class="resumen-row total"><span>Total a pagar:</span><span>$${totalServicios.toFixed(2)}</span></div>
        <div class="resumen-letras">${totalServiciosLetras}</div>
      </div>`
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Cotización ${c.folio}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; font-size:12px; color:#222; padding:28px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; border-bottom:2px solid #1f3a66; padding-bottom:14px; }
  .empresa { min-width:${esProductos ? 'auto' : '320px'}; }
  .logo-jesha { width:${esProductos ? '170px' : '280px'}; height:${esProductos ? '70px' : '100px'}; object-fit:contain; object-position:left center; display:block; margin-bottom:8px; filter:brightness(0) contrast(2); }
  .empresa p { color:#555; font-size:11px; margin-top:4px; }
  .folio-box { text-align:right; }
  .folio-box .folio { font-size:18px; font-weight:700; color:#1f3a66; }
  .folio-box p { font-size:11px; color:#666; margin-top:2px; }
  .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 20px; margin-bottom:18px; background:#f7f8fa; padding:12px; border-radius:6px; font-size:11px; }
  table { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:10px; }
  th { background:#1f3a66; color:#fff; padding:7px 8px; text-align:left; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; }
  td { padding:7px 8px; border-bottom:1px solid #eee; vertical-align:middle; }
  tr:nth-child(even) td { background:#fafafa; }
  .resumen-box { display:flex; flex-direction:column; align-items:flex-end; gap:4px; margin-top:8px; }
  .resumen-row { display:flex; gap:20px; min-width:260px; justify-content:space-between; font-size:12px; color:#555; }
  .resumen-row span:last-child { font-weight:600; color:#222; }
  .resumen-row.total { border-top:1px solid #ccc; padding-top:6px; margin-top:4px; font-size:14px; font-weight:700; color:#1f3a66; }
  .resumen-row.total span:last-child { color:#1f3a66; font-size:16px; }
  .resumen-letras { max-width:420px; text-align:right; margin-top:6px; color:#333; font-size:11px; font-weight:700; }
  .footer { margin-top:24px; border-top:1px solid #ddd; padding-top:12px; font-size:10px; color:#888; text-align:center; }
</style>
</head>
<body>
  <div class="header">
    <div class="empresa">
      ${logoUrl ? `<img src="${logoUrl}" alt="JESHA" class="logo-jesha" />` : `<div style="font-size:18px;font-weight:700;color:#1f3a66;margin-bottom:8px;">FERRETERÍA E ILUMINACIÓN JESHA</div>`}
      <p>Av. Vialidad San Simón 3, La Toma de Zacatecas, C.P. 98660</p>
      <p>Guadalupe, Zacatecas · Tel: 492 101 6879 · jeshadelgado544@gmail.com</p>
    </div>
    <div class="folio-box">
      <div class="folio">${c.folio}</div>
      <p>Fecha: ${fmtFecha(c.creadaEn)}</p>
      ${vigencia}
      <p style="margin-top:4px;font-size:11px;color:#888">${esProductos ? 'Cotización de Productos' : 'Cotización de Servicios'}</p>
    </div>
  </div>

  <div class="meta">
    <p><strong>Cliente:</strong> ${c.Cliente?.nombre || 'Público General'}</p>
    <p><strong>RFC:</strong> ${c.Cliente?.rfc || '—'}</p>
    <p><strong>Elaboró:</strong> ${c.Usuario?.nombre || '—'}</p>
    <p><strong>Sucursal:</strong> ${c.Sucursal?.nombre || '—'}</p>
  </div>

  ${tablaHtml}
  ${resumenHtml}
  ${notas}

  <div class="footer">
    <p>${esProductos ? 'Los precios incluyen IVA · ' : ''}Cotización válida por los días indicados · Ferretería e Iluminación JESHA</p>
  </div>
</body>
</html>`

  const ventana = window.open('', '_blank')
  ventana.document.write(html)
  ventana.document.close()
  ventana.onload = () => ventana.print()
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })

  await cargarClientes()
  cargarCotizaciones()

  const listaProductosModal = document.getElementById('lista-productos-modal')
  if (listaProductosModal && listaProductosModal.parentElement !== document.body) {
    document.body.appendChild(listaProductosModal)
  }
  window.addEventListener('resize', posicionarDropdownProductosCot)
  window.addEventListener('scroll', posicionarDropdownProductosCot, true)

  let debounce
  document.getElementById('search-input')?.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { paginaActual = 1; cargarCotizaciones() }, 400) })
  document.getElementById('filtro-estado')?.addEventListener('change', () => { paginaActual = 1; cargarCotizaciones() })
  document.getElementById('filtro-tipo')?.addEventListener('change',   () => { paginaActual = 1; cargarCotizaciones() })

  document.getElementById('btn-prev')?.addEventListener('click', () => { if (paginaActual > 1) { paginaActual--; cargarCotizaciones() } })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++; cargarCotizaciones() })

  // Tabs de tipo
  document.querySelectorAll('.tipo-tab').forEach(tab => {
    tab.addEventListener('click', () => { itemsEdicion = []; cerrarDropdownProductosCot(); setTipoModal(tab.dataset.tipo); renderItems() })
  })

  // Modal crear/editar
  document.getElementById('btn-nueva-cotizacion')?.addEventListener('click', abrirModalNuevo)
  document.getElementById('modal-close-btn')?.addEventListener('click', () => document.getElementById('modal-cotizacion').classList.remove('active'))
  document.getElementById('btn-cancel-modal')?.addEventListener('click', () => document.getElementById('modal-cotizacion').classList.remove('active'))
  document.getElementById('btn-guardar-cotizacion')?.addEventListener('click', guardarCotizacion)
  document.getElementById('btn-add-servicio')?.addEventListener('click', agregarLineaServicio)

  // Búsqueda productos
  document.getElementById('search-producto-modal')?.addEventListener('input', e => {
    clearTimeout(debounceProducto)
    debounceProducto = setTimeout(() => buscarProductosModal(e.target.value.trim()), 350)
  })
  document.getElementById('search-producto-modal')?.addEventListener('keydown', e => {
    const lista = document.getElementById('lista-productos-modal')
    const abierto = lista?.classList.contains('is-open')
    if (e.key === 'Escape' && abierto) {
      e.preventDefault()
      e.stopPropagation()
      cerrarDropdownProductosCot()
      return
    }
    if (e.key === 'Enter' && abierto) {
      const primero = lista.querySelector('.producto-item-modal')
      if (primero) {
        e.preventDefault()
        primero.click()
      }
    }
  })
  document.getElementById('lista-productos-modal')?.addEventListener('click', e => {
    e.stopPropagation()
    const mas = e.target.closest('.producto-load-more')
    if (mas) {
      e.preventDefault()
      cargarMasProductosModal()
      return
    }
    const item = e.target.closest('.producto-item-modal')
    if (!item) return
    const id = parseInt(item.dataset.productoId, 10)
    if (id) window._addProd(id)
  })

  // Autocomplete clientes — búsqueda al escribir + chevron para ver lista completa
  document.getElementById('cot-cliente-buscar')?.addEventListener('input', e => {
    const q = e.target.value
    if (q.length === 0) {
      cerrarDropdownClientesCot()
      // Limpiar selección si se borra todo el texto
      document.getElementById('cot-cliente-id').value = ''
    } else {
      renderDropdownClientes(filtrarClientes(q))
    }
  })
  document.getElementById('cot-cliente-buscar')?.addEventListener('focus', () => {
    // Al enfocar, abrir con la lista filtrada por lo que ya haya escrito
    const q = document.getElementById('cot-cliente-buscar')?.value || ''
    renderDropdownClientes(filtrarClientes(q))
  })
  document.getElementById('btn-chevron-cliente')?.addEventListener('click', abrirDropdownClientesCot)
  document.addEventListener('click', e => {
    const searchProd = document.getElementById('search-producto-modal')
    const listaProd = document.getElementById('lista-productos-modal')
    if (!e.target.closest('#cot-cliente-buscar') &&
        !e.target.closest('#btn-chevron-cliente') &&
        !e.target.closest('#dropdown-clientes'))
      cerrarDropdownClientesCot()
    if (!searchProd?.contains(e.target) &&
        !listaProd?.contains(e.target))
      cerrarDropdownProductosCot()
  })

  // Modal ver
  document.getElementById('ver-close-btn')?.addEventListener('click', () => document.getElementById('modal-ver').classList.remove('active'))
  document.getElementById('btn-editar-cot')?.addEventListener('click', () => { if (cotizacionActual) abrirEdicion(cotizacionActual.id) })
  document.getElementById('btn-cargar-pos')?.addEventListener('click', () => { if (!cotizacionActual) return; cargarEnPos(cotizacionActual.id) })
  document.getElementById('btn-pdf')?.addEventListener('click', () => { if (cotizacionActual) descargarPdf(cotizacionActual.id) })
  document.getElementById('btn-cancelar-cot')?.addEventListener('click', () => { if (cotizacionActual) cancelarCotizacion(cotizacionActual.id) })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const listaProd = document.getElementById('lista-productos-modal')
      if (listaProd?.classList.contains('is-open')) {
        cerrarDropdownProductosCot()
        return
      }
      document.getElementById('modal-cotizacion')?.classList.remove('active')
      document.getElementById('modal-ver')?.classList.remove('active')
      cerrarDropdownClientesCot()
    }
  })

  // ── Descuento global: visibilidad por rol ──
  const puedeDescuento = ['SUPERADMIN', 'ADMIN_SUCURSAL'].includes(USUARIO.rol)
  const wrapDesc = document.getElementById('cot-descuento-wrap')
  if (wrapDesc) wrapDesc.style.display = puedeDescuento ? '' : 'none'

  // ── Evento: input de descuento ──
  document.getElementById('cot-descuento-input')?.addEventListener('input', function() {
    const aviso = document.getElementById('cot-descuento-aviso')
    const val = parseFloat(this.value) || 0
    if (val > 10) {
      this.value = 10
      this.style.borderColor = 'var(--orange)'
      if (aviso) aviso.style.display = 'block'
      setTimeout(() => { this.style.borderColor = ''; if (aviso) aviso.style.display = 'none' }, 2500)
    } else if (val < 0) {
      this.value = 0
    }
    descuentoGlobalPct = parseFloat(this.value) || 0
    actualizarTotal()
  })
})
