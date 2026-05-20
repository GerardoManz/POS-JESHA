// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  COTIZACIONES.JS â€” v2
//  Soporta PRODUCTOS (descuento por lÃ­nea + IVA desglosado) y SERVICIOS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'cotizaciones.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticaciÃ³n')
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  ESTADO GLOBAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let cotizacionActual = null
let itemsEdicion     = []   // { productoId?, concepto?, unidad, cantidad, precio, descuento, nombre? }
let tipoActual       = 'PRODUCTOS'
let clientesLista    = []
let paginaActual     = 1
const LIMIT          = 20
const IVA        = window.__JESHA_IVA__        || 0.16
const IVA_FACTOR = window.__JESHA_IVA_FACTOR__ || 1.16

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const fmt = n => `$${parseFloat(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtFecha = iso => iso
  ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  : 'â€”'

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  API
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// apiFetch global disponible desde sidebar.js

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  LISTAR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
        <td>${c.venceEn ? fmtFecha(c.venceEn) : '<span style="color:var(--muted)">â€”</span>'}</td>
        <td>${estadoBadge(c.estado)}</td>
        <td>
          <div class="actions-cell" onclick="event.stopPropagation()">
            <button class="btn-icon" onclick="verCotizacion(${c.id})" title="Ver">ðŸ‘</button>
            ${c.estado === 'PENDIENTE' ? `<button class="btn-icon" onclick="abrirEdicion(${c.id})" title="Editar">âœï¸</button>` : ''}
            ${c.tipo === 'PRODUCTOS' ? `<button class="btn-icon" onclick="cargarEnPos(${c.id})" title="Cargar en POS">ðŸ›’</button>` : ''}
            <button class="btn-icon" onclick="descargarPdf(${c.id})" title="PDF">ðŸ“„</button>
          </div>
        </td>
      </tr>
    `).join('')

    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `PÃ¡gina ${paginaActual} de ${totalPags} (${total} total)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else {
      pagDiv.style.display = 'none'
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  VER DETALLE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

    document.getElementById('ver-cliente').textContent  = c.Cliente?.nombre || 'â€”'
    document.getElementById('ver-fecha').textContent    = fmtFecha(c.creadaEn)
    document.getElementById('ver-vigencia').textContent = c.venceEn ? fmtFecha(c.venceEn) : 'â€”'
    document.getElementById('ver-usuario').textContent  = c.Usuario?.nombre || 'â€”'

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
          <td>${d.concepto || 'â€”'}</td>
          <td style="text-align:center">${d.unidad || 'â€”'}</td>
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
          : `<div class="img-placeholder">ðŸ“¦</div>`
        const clave = d.Producto?.codigoInterno || 'â€”'
        const importe = parseFloat(d.precioUnitario) * parseFloat(d.cantidad)
        return `
          <tr>
            <td style="text-align:center">${imgHtml}<div style="font-size:0.7rem;color:var(--muted);margin-top:2px">${clave}</div></td>
            <td>${d.Producto?.nombre || d.concepto || d.nombre || 'â€”'}</td>
            <td style="text-align:center">${d.unidad || 'â€”'}</td>
            <td style="text-align:center">${d.cantidad}</td>
            <td>${fmt(d.precioUnitario)}</td>
            <td>${fmt(d.descuento || 0)}</td>
            <td><strong>${fmt(importe - parseFloat(d.descuento || 0))}</strong></td>
          </tr>
        `
      }).join('')

      // Calcular desglose IVA (precios con IVA â†’ desglose hacia atrÃ¡s)
      const totalConIva   = parseFloat(c.total)
      const baseGravable  = parseFloat((totalConIva / IVA_FACTOR).toFixed(2))
      const ivaAmount     = parseFloat((totalConIva - baseGravable).toFixed(2))
      const descTotal     = (c.DetalleCotizacion || []).reduce((s, d) => s + parseFloat(d.descuento || 0), 0)

      document.getElementById('ver-subtotal').textContent       = fmt(baseGravable)
      document.getElementById('ver-descuento-total').textContent = fmt(descTotal)
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  MODAL CREAR / EDITAR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function abrirModalNuevo() {
  cotizacionActual = null
  itemsEdicion     = []
  tipoActual       = 'PRODUCTOS'
  document.getElementById('modal-titulo').textContent = 'Nueva CotizaciÃ³n'
  document.getElementById('cot-vence').value          = ''
  document.getElementById('cot-notas').value          = ''
  document.getElementById('search-producto-modal').value = ''
  document.getElementById('lista-productos-modal').innerHTML = '<p class="muted-hint">Escribe para buscar productos...</p>'
  ocultarError('modal-error')

  // â”€â”€ Cliente: habilitado para nueva cotizaciÃ³n â”€â”€
  const clienteInput = document.getElementById('cot-cliente-buscar')
  clienteInput.value          = ''
  clienteInput.disabled       = false
  clienteInput.style.opacity  = ''
  clienteInput.style.cursor   = ''
  document.getElementById('cot-cliente-id').value = ''
  const chevron = document.getElementById('btn-chevron-cliente')
  if (chevron) chevron.style.display = ''

  // â”€â”€ Tabs: mostrar ambos â”€â”€
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
    ocultarError('modal-error')

    // â”€â”€ Cliente: bloqueado en ediciÃ³n â”€â”€
    const clienteInput = document.getElementById('cot-cliente-buscar')
    const clienteId    = c.Cliente?.id || c.clienteId || ''
    clienteInput.value          = c.Cliente?.nombre || ''
    clienteInput.disabled       = true
    clienteInput.style.opacity  = '0.6'
    clienteInput.style.cursor   = 'not-allowed'
    document.getElementById('cot-cliente-id').value    = clienteId
    document.getElementById('btn-chevron-cliente').style.display = 'none'

    // â”€â”€ Tabs de tipo: ocultar el que no corresponde â”€â”€
    document.querySelectorAll('.tipo-tab').forEach(tab => {
      tab.style.display = tab.dataset.tipo === tipoActual ? '' : 'none'
    })

    itemsEdicion = (c.DetalleCotizacion || []).map(d => ({
      productoId: d.productoId || d.Producto?.id,
      nombre:     d.Producto?.nombre || d.concepto || 'â€”',
      concepto:   d.concepto || '',
      unidad:     d.unidad || '',
      cantidad:   d.cantidad,
      precio:     parseFloat(d.precioUnitario),
      descuento:  parseFloat(d.descuento || 0)
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

  // Colapsar/expandir grid segÃºn tipo
  const split = document.querySelector('.modal-body-split')
  if (split) split.classList.toggle('servicios-mode', !esProductos)

  document.getElementById('panel-productos-left').style.display       = esProductos ? 'flex' : 'none'
  document.getElementById('tabla-productos-container').style.display  = esProductos ? 'block' : 'none'
  document.getElementById('tabla-servicios-container').style.display  = esProductos ? 'none' : 'block'
}

// â”€â”€ Render Ã­tems segÃºn tipo â”€â”€
function renderItems() {
  if (tipoActual === 'PRODUCTOS') renderItemsProductos()
  else renderItemsServicios()
}

function renderItemsProductos() {
  const tbody = document.getElementById('items-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="items-empty"><td colspan="7" class="empty-items">Agrega productos desde el panel izquierdo</td></tr>`
    actualizarTotal()
    return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => `
    <tr>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${item.nombre}">${item.nombre}</td>
      <td><input type="text" value="${item.unidad || 'PZA'}" style="width:50px" oninput="itemsEdicion[${i}].unidad=this.value" /></td>
      <td><input type="number" min="1" value="${item.cantidad}" style="width:52px" oninput="actualizarCantidadItem(${i},this.value)" min="${item.esGranel ? 0.001 : 1}" step="${item.esGranel ? 0.001 : 1}" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.precio.toFixed(2)}" style="width:82px" oninput="actualizarPrecioItem(${i},this.value)" /></td>
      <td><input type="number" min="0" step="0.01" value="${(item.descuento || 0).toFixed(2)}" style="width:82px" oninput="actualizarDescuentoItem(${i},this.value)" /></td>
      <td id="prod-total-${i}"><strong>${fmt((item.precio * item.cantidad) - item.descuento)}</strong></td>
      <td><button class="btn-icon" onclick="quitarItem(${i})" style="color:#f44336">âœ•</button></td>
    </tr>
  `).join('')
  actualizarTotal()
}

function renderItemsServicios() {
  const tbody = document.getElementById('servicios-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="servicios-empty"><td colspan="6" class="empty-items">Agrega lÃ­neas con el botÃ³n +</td></tr>`
    actualizarTotal()
    return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => `
    <tr>
      <td><input type="text" value="${item.concepto || ''}" placeholder="DescripciÃ³n del servicio" style="width:100%;min-width:180px" oninput="itemsEdicion[${i}].concepto=this.value" /></td>
      <td><input type="text" value="${item.unidad || ''}" placeholder="m2" style="width:60px" oninput="itemsEdicion[${i}].unidad=this.value" /></td>
      <td><input type="number" min="1" value="${item.cantidad}" style="width:52px" oninput="actualizarCantidadItem(${i},this.value)" min="${item.esGranel ? 0.001 : 1}" step="${item.esGranel ? 0.001 : 1}" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.precio.toFixed(2)}" style="width:82px" oninput="actualizarPrecioItem(${i},this.value)" /></td>
      <td id="srv-total-${i}"><strong>${fmt(item.precio * item.cantidad)}</strong></td>
      <td><button class="btn-icon" onclick="quitarItem(${i})" style="color:#f44336">âœ•</button></td>
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
  const total = itemsEdicion.reduce((s, i) => s + (i.precio * i.cantidad) - (i.descuento || 0), 0)
  document.getElementById('modal-total').textContent = fmt(total)
}

function agregarProductoAItems(prod) {
  const existe = itemsEdicion.find(i => i.productoId === prod.id)
  if (existe) { existe.cantidad += 1 }
  else {
    itemsEdicion.push({
      productoId: prod.id,
      nombre:     prod.nombre,
      unidad:     prod.unidadVenta || 'PZA',
      cantidad:   prod.esGranel ? 0.1 : 1,
      precio:     parseFloat(prod.precioVenta || prod.precioBase),
      descuento:  0,
      esGranel:   prod.esGranel || false
    })
  }
  renderItems()
}

function agregarLineaServicio() {
  itemsEdicion.push({ concepto: '', unidad: '', cantidad: 1, precio: 0, descuento: 0 })
  renderItems()
}

// â”€â”€ Guardar â”€â”€
async function guardarCotizacion() {
  ocultarError('modal-error')
  if (itemsEdicion.length === 0) { mostrarError('modal-error', 'Agrega al menos una lÃ­nea.'); return }

  const clienteId = document.getElementById('cot-cliente-id').value || null
  const venceEn   = document.getElementById('cot-vence').value || null
  const notas     = document.getElementById('cot-notas').value.trim() || null

  let detalles
  if (tipoActual === 'PRODUCTOS') {
    detalles = itemsEdicion.map(i => ({
      productoId:     i.productoId,
      unidad:         i.unidad,
      cantidad:       i.cantidad,
      precioUnitario: i.precio,
      descuento:      i.descuento || 0
    }))
  } else {
    detalles = itemsEdicion.map(i => ({
      concepto:       i.concepto,
      unidad:         i.unidad,
      cantidad:       i.cantidad,
      precioUnitario: i.precio,
      descuento:      0
    }))
  }

  const btn = document.getElementById('btn-guardar-cotizacion')
  btn.disabled  = true
  btn.textContent = 'Guardando...'

  try {
    if (cotizacionActual) {
      await apiFetch(`/cotizaciones/${cotizacionActual.id}`, { method: 'PUT', body: JSON.stringify({ clienteId, venceEn, notas, detalles, tipo: tipoActual }) })
    } else {
      await apiFetch('/cotizaciones', { method: 'POST', body: JSON.stringify({ clienteId, venceEn, notas, detalles, tipo: tipoActual }) })
    }
    document.getElementById('modal-cotizacion').classList.remove('active')
    paginaActual = 1
    cargarCotizaciones()
  } catch (err) {
    mostrarError('modal-error', err.message)
  } finally {
    btn.disabled = false
    btn.textContent = 'Guardar CotizaciÃ³n'
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  BÃšSQUEDA PRODUCTOS EN MODAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let debounceProducto
async function buscarProductosModal(q) {
  const lista = document.getElementById('lista-productos-modal')
  if (!q || q.length < 2) { lista.innerHTML = '<p class="muted-hint">Escribe para buscar productos...</p>'; return }
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  try {
    const data     = await apiFetch(`/productos?buscar=${encodeURIComponent(q)}&take=30`)
    const productos = data.data || data
    if (!productos || productos.length === 0) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; return }
    window._productosModalCache = {}
    productos.forEach(p => { window._productosModalCache[p.id] = p })
    lista.innerHTML = productos.map(p => `
      <div class="producto-item-modal" onclick="window._addProd(${p.id})">
        <span class="prod-nombre">${p.nombre}</span>
        <span class="prod-precio">${fmt(p.precioVenta || p.precioBase)}</span>
      </div>
    `).join('')
  } catch (err) { lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error: ${err.message}</p>` }
}
window._addProd = function(id) { const p = window._productosModalCache?.[id]; if (p) agregarProductoAItems(p) }

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  AUTOCOMPLETE CLIENTES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function cargarClientes() {
  try {
    const data = await apiFetch('/clientes?activo=true')
    clientesLista = Array.isArray(data) ? data : (data.data || [])
  } catch (e) { console.warn('No se pudieron cargar clientes:', e.message) }
}

// Filtra en memoria â€” sin mÃ­nimo de caracteres para poder mostrar toda la lista
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

// Renderiza items del dropdown â€” incluye opciÃ³n de pÃºblico general
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
         ðŸ‘¤ PÃºblico general
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  CAMBIAR ESTADO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function cancelarCotizacion(id) {
  if (!cotizacionActual || cotizacionActual.id !== id) return
  const ok = await jeshaConfirm({
    title: 'Cancelar cotizaciÃ³n',
    message: `Â¿Cancelar la cotizaciÃ³n <strong>${cotizacionActual.folio}</strong>?`,
    confirmText: 'SÃ­, cancelar', type: 'danger'
  })
  if (!ok) return
  try {
    await apiFetch(`/cotizaciones/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'CANCELADA' }) })
    document.getElementById('modal-ver').classList.remove('active')
    cargarCotizaciones()
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  CARGAR EN POS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

window.cargarEnPos = async function(id) {
  try {
    let cot = cotizacionActual?.id === id ? cotizacionActual : null
    if (!cot) { const d = await apiFetch(`/cotizaciones/${id}`); cot = d.data }
    if (!cot.DetalleCotizacion || cot.DetalleCotizacion.length === 0) { jeshaToast('Esta cotizaciÃ³n no tiene productos', 'warning'); return }
    const posPayload = {
      fuente: 'cotizacion', cotFolio: cot.folio, cotId: cot.id,
      clienteId: cot.clienteId || null, clienteNombre: cot.Cliente?.nombre || '',
      items: cot.DetalleCotizacion.map(d => ({
        id:       d.Producto?.id ?? d.productoId,
        nombre:   d.Producto?.nombre || 'â€”',
        precio:   parseFloat(d.precioUnitario),
        cantidad: parseFloat(d.cantidad) || 1
      }))
    }
    localStorage.setItem('pos_cotizacion', JSON.stringify(posPayload))
    window.location.href = 'punto-venta.html'
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PDF
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

window.descargarPdf = async function(id) {
  try {
    let cot = cotizacionActual?.id === id ? cotizacionActual : null
    if (!cot) { const d = await apiFetch(`/cotizaciones/${id}`); cot = d.data }
    generarPdf(cot)
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

const LOGO_URL = window.__JESHA_LOGO_URL__

function generarPdf(c) {
  const esProductos = c.tipo !== 'SERVICIOS'
  const vigencia    = c.venceEn ? `<p><strong>Vigencia:</strong> ${fmtFecha(c.venceEn)}</p>` : ''
  const notas       = c.notas  ? `<p style="margin-top:16px;font-size:12px;color:#555"><strong>Notas:</strong> ${c.notas}</p>` : ''

  let tablaHtml = ''
  let resumenHtml = ''

  if (esProductos) {
    // Tabla con imagen + clave + descuento + IVA desglosado
    const lineas = (c.DetalleCotizacion || []).map(d => {
      const importe  = parseFloat(d.precioUnitario) * parseFloat(d.cantidad)
      const descuento = parseFloat(d.descuento || 0)
      const neto     = importe - descuento
      const imgHtml  = d.Producto?.imagenUrl
        ? `<img src="${d.Producto.imagenUrl}" style="width:48px;height:48px;object-fit:contain;display:block;margin:0 auto" />`
        : `<div style="width:48px;height:48px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:18px;margin:0 auto">ðŸ“¦</div>`
      const clave    = d.Producto?.codigoInterno || 'â€”'
      const unidad   = d.unidad || d.Producto?.unidadVenta || 'PZA'
      return `
        <tr>
          <td style="text-align:center;padding:8px">${imgHtml}<div style="font-size:10px;color:#888;margin-top:2px">${clave}</div></td>
          <td style="text-align:center">${parseFloat(d.cantidad)}</td>
          <td style="text-align:center">${unidad}</td>
          <td>${d.Producto?.nombre || d.concepto || 'â€”'}</td>
          <td style="text-align:right">$${parseFloat(d.precioUnitario).toFixed(2)}</td>
          <td style="text-align:right">$${descuento.toFixed(2)}</td>
          <td style="text-align:right"><strong>$${neto.toFixed(2)}</strong></td>
        </tr>`
    }).join('')

    const totalConIva  = parseFloat(c.total)
    const baseGravable = parseFloat((totalConIva / IVA_FACTOR).toFixed(2))
    const ivaAmount    = parseFloat((totalConIva - baseGravable).toFixed(2))
    const descTotal    = (c.DetalleCotizacion || []).reduce((s, d) => s + parseFloat(d.descuento || 0), 0)

    tablaHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:80px;text-align:center">IMG/CLAVE</th>
            <th style="width:50px;text-align:center">CANT</th>
            <th style="width:60px;text-align:center">UNIDAD</th>
            <th>DESCRIPCIÃ“N</th>
            <th style="width:90px;text-align:right">P. UNIT.</th>
            <th style="width:80px;text-align:right">DESCUENTO</th>
            <th style="width:90px;text-align:right">IMPORTE</th>
          </tr>
        </thead>
        <tbody>${lineas}</tbody>
      </table>`

    resumenHtml = `
      <div class="resumen-box">
        <div class="resumen-row"><span>Subtotal (sin IVA):</span><span>$${baseGravable.toFixed(2)}</span></div>
        ${descTotal > 0 ? `<div class="resumen-row"><span>Descuento total:</span><span>-$${descTotal.toFixed(2)}</span></div>` : ''}
        <div class="resumen-row"><span>IVA (16%):</span><span>$${ivaAmount.toFixed(2)}</span></div>
        <div class="resumen-row total"><span>Total:</span><span>$${totalConIva.toFixed(2)}</span></div>
      </div>`
  } else {
    // SERVICIOS â€” tabla simple
    const lineas = (c.DetalleCotizacion || []).map(d => `
      <tr>
        <td>${d.concepto || 'â€”'}</td>
        <td style="text-align:center">${d.unidad || 'â€”'}</td>
        <td style="text-align:center">${d.cantidad}</td>
        <td style="text-align:right">$${parseFloat(d.precioUnitario).toFixed(2)}</td>
        <td style="text-align:right"><strong>$${parseFloat(d.subtotal).toFixed(2)}</strong></td>
      </tr>`
    ).join('')

    tablaHtml = `
      <table>
        <thead>
          <tr>
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
        <div class="resumen-row total"><span>Total:</span><span>$${parseFloat(c.total).toFixed(2)}</span></div>
      </div>`
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>CotizaciÃ³n ${c.folio}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; font-size:12px; color:#222; padding:28px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; border-bottom:2px solid #1f3a66; padding-bottom:14px; }
  .empresa p { color:#555; font-size:11px; margin-top:4px; }
  .folio-box { text-align:right; }
  .folio-box .folio { font-size:18px; font-weight:700; color:#1f3a66; }
  .folio-box p { font-size:11px; color:#666; margin-top:2px; }
  .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 20px; margin-bottom:18px; background:#f7f8fa; padding:12px; border-radius:6px; font-size:11px; }
  table { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:11px; }
  th { background:#1f3a66; color:#fff; padding:8px 10px; text-align:left; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; }
  td { padding:8px 10px; border-bottom:1px solid #eee; vertical-align:middle; }
  tr:nth-child(even) td { background:#fafafa; }
  .resumen-box { display:flex; flex-direction:column; align-items:flex-end; gap:4px; margin-top:8px; }
  .resumen-row { display:flex; gap:20px; min-width:260px; justify-content:space-between; font-size:12px; color:#555; }
  .resumen-row span:last-child { font-weight:600; color:#222; }
  .resumen-row.total { border-top:1px solid #ccc; padding-top:6px; margin-top:4px; font-size:14px; font-weight:700; color:#1f3a66; }
  .resumen-row.total span:last-child { color:#1f3a66; font-size:16px; }
  .footer { margin-top:24px; border-top:1px solid #ddd; padding-top:12px; font-size:10px; color:#888; text-align:center; }
</style>
</head>
<body>
  <div class="header">
    <div class="empresa">
      <img src="${LOGO_URL}" alt="JESHA" style="height:60px;width:auto;display:block;margin-bottom:4px;" />
      <p>Av. Vialidad San SimÃ³n 3, La Toma de Zacatecas, C.P. 98660</p>
      <p>Guadalupe, Zacatecas Â· Tel: 492 101 6879 Â· jeshadelgado544@gmail.com</p>
    </div>
    <div class="folio-box">
      <div class="folio">${c.folio}</div>
      <p>Fecha: ${fmtFecha(c.creadaEn)}</p>
      ${vigencia}
      <p style="margin-top:4px;font-size:11px;color:#888">${esProductos ? 'CotizaciÃ³n de Productos' : 'CotizaciÃ³n de Servicios'}</p>
    </div>
  </div>

  <div class="meta">
    <p><strong>Cliente:</strong> ${c.Cliente?.nombre || 'PÃºblico General'}</p>
    <p><strong>RFC:</strong> ${c.Cliente?.rfc || 'â€”'}</p>
    <p><strong>ElaborÃ³:</strong> ${c.Usuario?.nombre || 'â€”'}</p>
    <p><strong>Sucursal:</strong> ${c.Sucursal?.nombre || 'â€”'}</p>
  </div>

  ${tablaHtml}
  ${resumenHtml}
  ${notas}

  <div class="footer">
    <p>${esProductos ? 'Los precios incluyen IVA Â· ' : ''}CotizaciÃ³n vÃ¡lida por los dÃ­as indicados Â· FerreterÃ­a e IluminaciÃ³n JESHA</p>
  </div>
</body>
</html>`

  const ventana = window.open('', '_blank')
  ventana.document.write(html)
  ventana.document.close()
  ventana.onload = () => ventana.print()
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  INICIALIZACIÃ“N
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

document.addEventListener('DOMContentLoaded', async () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })

  await cargarClientes()
  cargarCotizaciones()

  let debounce
  document.getElementById('search-input')?.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { paginaActual = 1; cargarCotizaciones() }, 400) })
  document.getElementById('filtro-estado')?.addEventListener('change', () => { paginaActual = 1; cargarCotizaciones() })
  document.getElementById('filtro-tipo')?.addEventListener('change',   () => { paginaActual = 1; cargarCotizaciones() })

  document.getElementById('btn-prev')?.addEventListener('click', () => { if (paginaActual > 1) { paginaActual--; cargarCotizaciones() } })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++; cargarCotizaciones() })

  // Tabs de tipo
  document.querySelectorAll('.tipo-tab').forEach(tab => {
    tab.addEventListener('click', () => { itemsEdicion = []; setTipoModal(tab.dataset.tipo); renderItems() })
  })

  // Modal crear/editar
  document.getElementById('btn-nueva-cotizacion')?.addEventListener('click', abrirModalNuevo)
  document.getElementById('modal-close-btn')?.addEventListener('click', () => document.getElementById('modal-cotizacion').classList.remove('active'))
  document.getElementById('btn-cancel-modal')?.addEventListener('click', () => document.getElementById('modal-cotizacion').classList.remove('active'))
  document.getElementById('btn-guardar-cotizacion')?.addEventListener('click', guardarCotizacion)
  document.getElementById('btn-add-servicio')?.addEventListener('click', agregarLineaServicio)

  // BÃºsqueda productos
  document.getElementById('search-producto-modal')?.addEventListener('input', e => {
    clearTimeout(debounceProducto)
    debounceProducto = setTimeout(() => buscarProductosModal(e.target.value.trim()), 350)
  })

  // Autocomplete clientes â€” bÃºsqueda al escribir + chevron para ver lista completa
  document.getElementById('cot-cliente-buscar')?.addEventListener('input', e => {
    const q = e.target.value
    if (q.length === 0) {
      cerrarDropdownClientesCot()
      // Limpiar selecciÃ³n si se borra todo el texto
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
    if (!e.target.closest('#cot-cliente-buscar') &&
        !e.target.closest('#btn-chevron-cliente') &&
        !e.target.closest('#dropdown-clientes'))
      cerrarDropdownClientesCot()
  })

  // Modal ver
  document.getElementById('ver-close-btn')?.addEventListener('click', () => document.getElementById('modal-ver').classList.remove('active'))
  document.getElementById('btn-editar-cot')?.addEventListener('click', () => { if (cotizacionActual) abrirEdicion(cotizacionActual.id) })
  document.getElementById('btn-cargar-pos')?.addEventListener('click', () => { if (!cotizacionActual) return; cargarEnPos(cotizacionActual.id) })
  document.getElementById('btn-pdf')?.addEventListener('click', () => { if (cotizacionActual) descargarPdf(cotizacionActual.id) })
  document.getElementById('btn-cancelar-cot')?.addEventListener('click', () => { if (cotizacionActual) cancelarCotizacion(cotizacionActual.id) })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-cotizacion')?.classList.remove('active')
      document.getElementById('modal-ver')?.classList.remove('active')
      cerrarDropdownClientesCot()
    }
  })
})
