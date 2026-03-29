// ════════════════════════════════════════════════════════════════════
//  COMPRAS.JS
// ════════════════════════════════════════════════════════════════════
const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'
const LIMIT   = 25

if (!TOKEN) {
  localStorage.setItem('redirect_after_login', 'compras.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

let paginaActual = 1
let ocActual     = null
let itemsEdicion = []
let proveedores  = []
let debounce, debounceSearch, debounceProd, debounceProv

const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'

const ESTADOS = {
  ENVIADO:          { label:'Pendiente',         cls:'enviado' },
  RECIBIDO_PARCIAL: { label:'Recibido parcial',  cls:'recibido_parcial' },
  RECIBIDO:         { label:'Recibido',           cls:'recibido' },
  CANCELADO:        { label:'Cancelado',          cls:'cancelado' }
}

// apiFetch global disponible desde sidebar.js

// ════════════════════════════════════════════════════════════════════
//  LISTAR
// ════════════════════════════════════════════════════════════════════
async function cargarCompras() {
  const tbody  = document.getElementById('comp-tbody')
  const pagDiv = document.getElementById('pagination')
  tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  const buscar     = document.getElementById('search-input')?.value.trim() || ''
  const estado     = document.getElementById('filtro-estado')?.value || ''
  const pagada     = document.getElementById('filtro-pago')?.value || ''
  const proveedorId = document.getElementById('filtro-proveedor')?.value || ''
  const params = new URLSearchParams({ page: paginaActual, limit: LIMIT })
  if (buscar)        params.set('buscar', buscar)
  if (estado)        params.set('estado', estado)
  if (pagada !== '') params.set('pagada', pagada)
  if (proveedorId)   params.set('proveedorId', proveedorId)

  try {
    const data   = await apiFetch(`/compras?${params}`)
    const lista  = data.data || []
    const total  = data.total || 0

    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p>No hay compras con los filtros aplicados</p></td></tr>`
      pagDiv.style.display = 'none'; return
    }

    tbody.innerHTML = lista.map(oc => {
      const e = ESTADOS[oc.estado] || { label: oc.estado, cls: 'enviado' }
      const saldo = parseFloat(oc.totalEstimado) - parseFloat(oc.totalPagado || 0)
      return `
        <tr onclick="abrirDetalle(${oc.id})">
          <td><strong>${oc.folio}</strong></td>
          <td>${oc.proveedor?.alias || oc.proveedor?.nombreOficial || '—'}</td>
          <td style="color:var(--muted);font-size:0.82rem">${fmtFecha(oc.creadaEn)}</td>
          <td><strong>${fmt(oc.totalEstimado)}</strong></td>
          <td style="color:#60d080">${fmt(oc.totalPagado || 0)}</td>
          <td><span class="comp-estado-badge ${e.cls}">${e.label}</span></td>
          <td><span class="comp-pago-badge ${oc.pagada ? 'pagada' : 'no-pagada'}">${oc.pagada ? 'Pagada' : 'No pagada'}</span></td>
          <td><button class="btn-pag" onclick="event.stopPropagation();abrirDetalle(${oc.id})" style="padding:4px 10px">Ver</button></td>
        </tr>`
    }).join('')

    const totalPags = Math.ceil(total / LIMIT)
    if (totalPags > 1) {
      pagDiv.style.display = 'flex'
      document.getElementById('pag-info').textContent = `Página ${paginaActual} de ${totalPags} (${total} compras)`
      document.getElementById('btn-prev').disabled = paginaActual <= 1
      document.getElementById('btn-next').disabled = paginaActual >= totalPags
    } else pagDiv.style.display = 'none'
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p style="color:#f44336">Error: ${err.message}</p></td></tr>`
  }
}

// ════════════════════════════════════════════════════════════════════
//  DETALLE
// ════════════════════════════════════════════════════════════════════
window.abrirDetalle = async function(id) {
  try {
    const data = await apiFetch(`/compras/${id}`)
    ocActual = data.data
    renderDetalle()
    document.getElementById('modal-detalle').classList.add('active')
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

function renderDetalle() {
  const oc = ocActual
  const e  = ESTADOS[oc.estado] || { label: oc.estado, cls: 'enviado' }

  document.getElementById('det-folio').textContent = oc.folio
  const eb = document.getElementById('det-estado-badge')
  eb.className = `comp-estado-badge ${e.cls}`; eb.textContent = e.label
  const pb = document.getElementById('det-pago-badge')
  pb.className = `comp-pago-badge ${oc.pagada ? 'pagada' : 'no-pagada'}`
  pb.textContent = oc.pagada ? 'Pagada' : 'No pagada'

  document.getElementById('det-proveedor').textContent = oc.proveedor?.nombreOficial || '—'
  document.getElementById('det-tel').textContent = oc.proveedor?.celular || oc.proveedor?.telefono || '—'
  document.getElementById('det-fecha').textContent   = fmtFecha(oc.creadaEn)
  document.getElementById('det-usuario').textContent = oc.usuario?.nombre || '—'

  const notasEl = document.getElementById('det-notas-p')
  if (oc.notas) { notasEl.textContent = `📝 ${oc.notas}`; notasEl.style.display = 'block' }
  else notasEl.style.display = 'none'

  // Financiero
  const saldo = parseFloat(oc.totalEstimado) - parseFloat(oc.totalPagado || 0)
  document.getElementById('fin-total').textContent  = fmt(oc.totalEstimado)
  document.getElementById('fin-pagado').textContent = fmt(oc.totalPagado || 0)
  document.getElementById('fin-saldo').textContent  = fmt(saldo)

  const esPendiente = ['ENVIADO', 'RECIBIDO_PARCIAL'].includes(oc.estado)
  document.getElementById('card-abono').style.display = oc.pagada ? 'none' : 'block'

  // Abonos
  const listaAbonos = document.getElementById('lista-abonos')
  listaAbonos.innerHTML = (!oc.abonos || oc.abonos.length === 0)
    ? '<p class="muted-hint">Sin pagos registrados</p>'
    : oc.abonos.map(a => `
        <div class="abono-item">
          <div>
            <div class="abono-monto">+${fmt(a.monto)}</div>
            <div class="abono-meta">${a.metodoPago} · ${fmtFecha(a.creadoEn)} · ${a.usuario?.nombre || '—'}</div>
            ${a.notas ? `<div class="abono-meta">${a.notas}</div>` : ''}
          </div>
        </div>`).join('')

  // Tabla de productos
  const recibiendo   = ocActual._recibiendo || false
  const showRecibido = !esPendiente || recibiendo

  // Mostrar/ocultar columnas según modo
  document.getElementById('col-recibido-header').style.display = showRecibido ? '' : 'none'
  const colPend = document.getElementById('col-pendiente-header')
  if (colPend) colPend.style.display = recibiendo ? '' : 'none'
  const colPV = document.getElementById('col-precio-venta-header')
  if (colPV) colPV.style.display = recibiendo ? '' : 'none'

  const tbody = document.getElementById('det-items-tbody')
  tbody.innerHTML = (oc.detalles || []).map(d => {
    const cantPedida   = parseFloat(d.cantidadPedida)
    const cantRecibida = parseFloat(d.cantidadRecibida)
    const pendiente    = parseFloat((cantPedida - cantRecibida).toFixed(3))
    const yaCompleto   = cantRecibida >= cantPedida
    const rowStyle     = yaCompleto && recibiendo ? 'opacity:0.45;' : ''
    const unidad       = d.producto?.unidadCompra || 'pza'

    // Costo anterior vs nuevo
    const costoOrden    = parseFloat(d.precioCosto)
    const costoAnterior = parseFloat(d.producto?.costo || costoOrden)
    const costoSubio    = costoOrden > costoAnterior
    const costoBajo     = costoOrden < costoAnterior
    const costoColor    = costoSubio ? '#f87171' : costoBajo ? '#60d080' : 'inherit'
    const costoAntLabel = recibiendo && costoOrden !== costoAnterior
      ? `<div style="font-size:0.68rem;color:var(--muted);margin-top:2px;">ant: ${fmt(costoAnterior)}</div>`
      : ''

    // Badge de estado por fila (solo en modo vista)
    let estadoFila = ''
    if (!recibiendo) {
      if (yaCompleto)
        estadoFila = `<span style="font-size:0.7rem;background:rgba(96,208,128,0.12);color:#60d080;border:1px solid rgba(96,208,128,0.25);border-radius:4px;padding:1px 6px;margin-left:6px;">✓ completo</span>`
      else if (cantRecibida > 0)
        estadoFila = `<span style="font-size:0.7rem;background:rgba(255,193,7,0.1);color:#ffc107;border:1px solid rgba(255,193,7,0.25);border-radius:4px;padding:1px 6px;margin-left:6px;">parcial ${cantRecibida}/${cantPedida}</span>`
    }

    // Celda de recibir (input decimal) / vista
    const celdaRecibido = showRecibido ? `<td style="text-align:center">
      ${recibiendo
        ? yaCompleto
          ? `<span style="color:#60d080;font-size:0.8rem;">✓ ya recibido</span>`
          : `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
               <input type="number" class="input-recibir" id="rec-${d.id}"
                 min="0" max="${pendiente}" step="0.001" value="${pendiente}"
                 style="width:64px;text-align:center;" />
               <span style="font-size:0.68rem;color:var(--muted);">máx ${pendiente} ${unidad}</span>
             </div>`
        : `<span style="color:${yaCompleto ? '#60d080' : cantRecibida > 0 ? '#ffc107' : 'var(--muted)'}">
             ${cantRecibida} / ${cantPedida}
           </span>`
      }
    </td>` : ''

    // Celda pendiente (solo en modo recibir, solo si no está completo)
    const celdaPendiente = recibiendo ? `<td style="text-align:center">
      ${yaCompleto
        ? `<span style="color:#60d080;font-size:0.78rem;">—</span>`
        : `<span style="color:#ffc107;font-size:0.82rem;font-weight:500;">${pendiente} ${unidad}</span>`
      }
    </td>` : ''

    // Celda margen + precio venta calculado (por producto)
    const precioVentaActual = parseFloat(d.producto?.precioVenta || d.producto?.precioBase || 0)
    const celdaMargen = recibiendo ? `<td>
      ${yaCompleto
        ? `<span style="color:var(--muted);font-size:0.8rem;">—</span>`
        : `<div style="display:flex;flex-direction:column;gap:4px;">
             <div style="display:flex;align-items:center;gap:4px;">
               <input type="number" id="mg-${d.id}" min="0" max="999" step="0.1" placeholder="%" value=""
                 style="width:52px;padding:3px 5px;background:rgba(255,255,255,0.05);border:1px solid var(--panel-border);border-radius:5px;color:var(--text);font-size:0.8rem;text-align:center;"
                 oninput="calcPrecioVenta(${d.id}, ${costoOrden})" />
               <span style="font-size:0.75rem;color:var(--muted);">%</span>
             </div>
             <div style="font-size:0.78rem;color:var(--muted);">
               act: ${fmt(precioVentaActual)}
             </div>
             <div id="pv-calc-${d.id}" style="font-size:0.82rem;color:#60d080;font-weight:500;min-height:16px;"></div>
           </div>`
      }
    </td>` : ''

    return `
    <tr style="${rowStyle}">
      <td>
        ${d.producto?.nombre || '—'}
        ${estadoFila}
      </td>
      <td style="text-align:center">
        <strong>${cantPedida}</strong>
        <div class="qty-pedido">${unidad}</div>
      </td>
      ${celdaRecibido}
      ${celdaPendiente}
      <td>
        <span style="color:${costoColor}">${fmt(costoOrden)}</span>
        ${costoAntLabel}
      </td>
      ${celdaMargen}
      <td>${fmt(d.subtotalPedido)}</td>
    </tr>`
  }).join('')

  // Banner informativo cuando hay recepción parcial previa
  if (recibiendo && oc.estado === 'RECIBIDO_PARCIAL') {
    const pendientesCount = (oc.detalles || []).filter(d => d.cantidadRecibida < d.cantidadPedida).length
    tbody.insertAdjacentHTML('beforebegin',
      `<div style="margin-bottom:10px;padding:9px 14px;background:rgba(255,193,7,0.07);border:1px solid rgba(255,193,7,0.2);border-radius:8px;font-size:0.82rem;color:#ffc107;">
        ⚠️ Recepción parcial — ${pendientesCount} producto${pendientesCount !== 1 ? 's' : ''} pendiente${pendientesCount !== 1 ? 's' : ''} de recibir. Los productos en gris ya fueron recibidos.
       </div>`)
  }

  // Botones superiores
  const btns = document.getElementById('det-botones-superiores')
  btns.innerHTML = ''
  if (esPendiente) {
    if (!recibiendo) {
      btns.innerHTML += `<button class="btn-secondary btn-sm" onclick="abrirEdicion(${oc.id})">✏️ Editar</button>`
      btns.innerHTML += `<button class="btn-warning btn-sm" onclick="iniciarRecepcion()">📦 Recibir mercancía</button>`
    } else {
      const pendientes = (oc.detalles || []).filter(d => d.cantidadRecibida < d.cantidadPedida).length
      btns.innerHTML += `<button class="btn-success btn-sm" onclick="confirmarRecepcion()">✓ Confirmar recepción (${pendientes} producto${pendientes !== 1 ? 's' : ''})</button>`
      btns.innerHTML += `<button class="btn-secondary btn-sm" onclick="cancelarRecepcion()">✕ Cancelar</button>`
    }
  }

  // Acciones
  const accDiv = document.getElementById('det-acciones')
  accDiv.innerHTML = ''
  if (esPendiente)
    accDiv.innerHTML += `<button class="btn-danger" onclick="cancelarCompra(${oc.id})">✕ Cancelar compra</button>`
  if (oc.estado === 'RECIBIDO_PARCIAL' && !recibiendo)
    accDiv.innerHTML += `
      <div style="font-size:0.8rem;color:var(--muted);padding:6px 10px;background:rgba(255,193,7,0.06);border:1px solid rgba(255,193,7,0.15);border-radius:8px;line-height:1.5;">
        ⚠️ Recepción incompleta — cuando llegue el resto da clic en <strong style="color:#ffc107">Recibir mercancía</strong>
      </div>`
}

// Calcula y muestra el precio de venta en base al margen % ingresado
window.calcPrecioVenta = function(detalleId, costoOrden) {
  const mgInput = document.getElementById(`mg-${detalleId}`)
  const pvCalc  = document.getElementById(`pv-calc-${detalleId}`)
  if (!mgInput || !pvCalc) return
  const mg = parseFloat(mgInput.value) || 0
  if (mg <= 0) { pvCalc.textContent = ''; return }
  const pv = costoOrden * (1 + mg / 100)
  pvCalc.textContent = `→ ${fmt(pv)}`
}

// ════════════════════════════════════════════════════════════════════
//  RECEPCIÓN
// ════════════════════════════════════════════════════════════════════
window.iniciarRecepcion = function() {
  ocActual._recibiendo = true
  renderDetalle()
}
window.cancelarRecepcion = function() {
  ocActual._recibiendo = false
  renderDetalle()
}
window.confirmarRecepcion = async function() {
  const detalles = (ocActual.detalles || [])
    .filter(d => parseFloat(d.cantidadPedida) > parseFloat(d.cantidadRecibida))
    .map(d => {
      const cantNueva = parseFloat(document.getElementById(`rec-${d.id}`)?.value) || 0
      if (cantNueva <= 0) return null
      const costoUnit = parseFloat(d.precioCosto)
      const mg        = parseFloat(document.getElementById(`mg-${d.id}`)?.value) || 0
      const precioVenta = mg > 0 ? parseFloat((costoUnit * (1 + mg / 100)).toFixed(2)) : null
      return { detalleId: d.id, cantidadRecibida: cantNueva, precioVenta }
    }).filter(Boolean).filter(d => d.cantidadRecibida > 0)

  if (detalles.length === 0) { jeshaToast('Ingresa al menos una cantidad recibida', 'warning'); return }

  const btn = document.querySelector('#det-botones-superiores .btn-success')
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Procesando...' }

  try {
    const data = await apiFetch(`/compras/${ocActual.id}/recibir`, { method:'POST', body: JSON.stringify({ detalles }) })
    ocActual = data.data
    ocActual._recibiendo = false
    renderDetalle()
    cargarCompras()
  } catch (err) {
    jeshaToast('Error: ' + err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirmar recepción' }
  }
}

window.cancelarCompra = async function(id) {
  const ok = await jeshaConfirm({
    title: 'Cancelar compra',
    message: `¿Cancelar la orden <strong>${ocActual?.folio}</strong>? Esta acción no se puede deshacer.`,
    confirmText: 'Sí, cancelar', type: 'danger'
  })
  if (!ok) return
  try {
    const data = await apiFetch(`/compras/${id}/cancelar`, { method:'PATCH' })
    ocActual = data.data
    renderDetalle()
    cargarCompras()
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

// ════════════════════════════════════════════════════════════════════
//  ABONO
// ════════════════════════════════════════════════════════════════════
async function registrarAbono() {
  const monto  = parseFloat(document.getElementById('abono-monto').value)
  const metodo = document.getElementById('abono-metodo').value
  const notas  = document.getElementById('abono-notas').value.trim() || null
  if (!monto || monto <= 0) { jeshaToast('Monto inválido', 'warning'); return }

  const btn = document.getElementById('btn-abonar')
  btn.disabled = true; btn.textContent = 'Registrando...'
  try {
    const data = await apiFetch(`/compras/${ocActual.id}/abonos`, { method:'POST', body: JSON.stringify({ monto, metodoPago: metodo, notas }) })
    ocActual = data.data
    document.getElementById('abono-monto').value = ''
    document.getElementById('abono-notas').value = ''
    renderDetalle()
    cargarCompras()
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
  finally { btn.disabled = false; btn.textContent = '+ Registrar pago' }
}

// ════════════════════════════════════════════════════════════════════
//  CREAR / EDITAR
// ════════════════════════════════════════════════════════════════════
function abrirModalCrear() {
  ocActual     = null
  itemsEdicion = []
  document.getElementById('crear-titulo').textContent = 'Nueva Compra'
  document.getElementById('prov-buscar').value = ''
  document.getElementById('prov-id').value     = ''
  document.getElementById('comp-notas').value  = ''
  document.getElementById('search-prod-modal').value = ''
  document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
  document.getElementById('crear-error').classList.remove('show')
  renderItemsEdicion()
  document.getElementById('modal-crear').classList.add('active')
}

window.abrirEdicion = async function(id) {
  document.getElementById('modal-detalle').classList.remove('active')
  try {
    const data = await apiFetch(`/compras/${id}`)
    ocActual = data.data
    document.getElementById('crear-titulo').textContent = `Editar ${ocActual.folio}`
    document.getElementById('prov-buscar').value = ocActual.proveedor?.nombreOficial || ''
    document.getElementById('prov-id').value     = ocActual.proveedor?.id || ''
    document.getElementById('comp-notas').value  = ocActual.notas || ''
    document.getElementById('search-prod-modal').value = ''
    document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
    document.getElementById('crear-error').classList.remove('show')

    itemsEdicion = (ocActual.detalles || []).map(d => ({
      productoId:       d.producto?.id,
      nombre:           d.producto?.nombre || '—',
      unidad:           d.producto?.unidadCompra || 'pza',
      cantidad:         d.cantidadPedida,
      costo:            parseFloat(d.precioCosto),
      cantidadRecibida: d.cantidadRecibida || 0  // para proteger en UI
    }))
    renderItemsEdicion()
    document.getElementById('modal-crear').classList.add('active')
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

function renderItemsEdicion() {
  const tbody = document.getElementById('comp-items-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="comp-empty"><td colspan="6" class="empty-items">Agrega productos desde el panel izquierdo</td></tr>`
    actualizarTotalEdicion(); return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => {
    const bloqueado = (item.cantidadRecibida || 0) > 0
    return `
    <tr style="${bloqueado ? 'opacity:0.6;' : ''}">
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${item.nombre}">
        ${item.nombre}
        ${bloqueado ? `<span style="font-size:0.68rem;color:#ffc107;margin-left:4px;">recibido ${item.cantidadRecibida}</span>` : ''}
      </td>
      <td style="color:var(--muted);font-size:0.78rem">${item.unidad}</td>
      <td>${bloqueado
        ? `<span style="color:var(--muted);font-size:0.85rem;">${item.cantidad}</span>`
        : `<input type="number" min="0.001" step="0.01" value="${item.cantidad}" style="width:58px" oninput="actualizarItemEdicion(${i},'cantidad',this.value)" />`
      }</td>
      <td>${bloqueado
        ? `<span style="color:var(--muted);font-size:0.85rem;">${fmt(item.costo)}</span>`
        : `<input type="number" min="0" step="0.01" value="${item.costo.toFixed(2)}" style="width:88px" oninput="actualizarItemEdicion(${i},'costo',this.value)" />`
      }</td>
      <td id="item-sub-${i}"><strong>${fmt(item.costo * item.cantidad)}</strong></td>
      <td>${bloqueado
        ? `<span title="No se puede eliminar — ya hay mercancía recibida" style="color:var(--muted);font-size:0.75rem;cursor:not-allowed;">🔒</span>`
        : `<button class="btn-eliminar" onclick="quitarItemEdicion(${i})">✕</button>`
      }</td>
    </tr>`
  }).join('')
  actualizarTotalEdicion()
}

window.actualizarItemEdicion = function(i, campo, v) {
  const n = parseFloat(v)
  if (!isNaN(n) && n >= 0) {
    if (campo === 'cantidad') itemsEdicion[i].cantidad = parseFloat(v) || 0.001
    else itemsEdicion[i].costo = n
    const cel = document.getElementById(`item-sub-${i}`)
    if (cel) cel.innerHTML = `<strong>${fmt(itemsEdicion[i].costo * itemsEdicion[i].cantidad)}</strong>`
    actualizarTotalEdicion()
  }
}
window.quitarItemEdicion = function(i) {
  if ((itemsEdicion[i]?.cantidadRecibida || 0) > 0) return  // protegido
  itemsEdicion.splice(i, 1)
  renderItemsEdicion()
}

function actualizarTotalEdicion() {
  const t = itemsEdicion.reduce((s, i) => s + i.costo * i.cantidad, 0)
  document.getElementById('comp-total').textContent = fmt(t)
}

function agregarProductoEdicion(prod) {
  const existe = itemsEdicion.find(i => i.productoId === prod.id)
  if (existe) { existe.cantidad += 1 }
  else {
    itemsEdicion.push({ productoId: prod.id, nombre: prod.nombre, unidad: prod.unidadCompra || 'pza', cantidad: 1, costo: parseFloat(prod.costo || prod.precioBase || 0) })
  }
  renderItemsEdicion()
}

async function guardarCompra() {
  const provId = document.getElementById('prov-id').value
  const notas  = document.getElementById('comp-notas').value.trim() || null
  if (!provId) { mostrarError('crear-error', 'Selecciona un proveedor'); return }
  if (itemsEdicion.length === 0) { mostrarError('crear-error', 'Agrega al menos un producto'); return }

  const detalles = itemsEdicion.map(i => ({ productoId: i.productoId, cantidadPedida: i.cantidad, precioCosto: i.costo }))
  const btn = document.getElementById('crear-guardar')
  btn.disabled = true; btn.textContent = 'Guardando...'

  try {
    if (ocActual) {
      await apiFetch(`/compras/${ocActual.id}`, { method:'PUT', body: JSON.stringify({ proveedorId: provId, detalles, notas }) })
    } else {
      await apiFetch('/compras', { method:'POST', body: JSON.stringify({ proveedorId: provId, detalles, notas }) })
    }
    document.getElementById('modal-crear').classList.remove('active')
    paginaActual = 1; cargarCompras()
  } catch (err) { mostrarError('crear-error', err.message) }
  finally { btn.disabled = false; btn.textContent = 'Guardar Compra' }
}

// ════════════════════════════════════════════════════════════════════
//  PROVEEDORES
// ════════════════════════════════════════════════════════════════════
async function cargarProveedores() {
  try {
    const data = await apiFetch('/compras/proveedores')
    proveedores = data.data || []
    // Poblar select de filtro en toolbar
    const sel = document.getElementById('filtro-proveedor')
    if (sel) {
      sel.innerHTML = '<option value="">Todos los proveedores</option>'
      proveedores.sort((a,b) => (a.alias || a.nombreOficial).localeCompare(b.alias || b.nombreOficial))
        .forEach(p => {
          const opt = document.createElement('option')
          opt.value = p.id
          opt.textContent = p.alias || p.nombreOficial
          sel.appendChild(opt)
        })
    }
  } catch(e) { console.warn('No se cargaron proveedores:', e.message) }
}

// Filtra en memoria — sin mínimo de caracteres para poder mostrar toda la lista
function filtrarProveedores(q) {
  const l = (q || '').toLowerCase().trim()
  if (!l) return proveedores.slice(0, 50)
  return proveedores.filter(p =>
    p.nombreOficial?.toLowerCase().includes(l) ||
    p.alias?.toLowerCase().includes(l)
  ).slice(0, 50)
}

// Renderiza el dropdown con buscador interno integrado
function renderDDProv(lista) {
  const dd = document.getElementById('dd-proveedores')
  if (!dd) return

  dd.innerHTML = `
    <div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <input type="text" id="dd-prov-search"
        placeholder="Buscar proveedor..."
        autocomplete="off"
        style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
               border-radius:6px;padding:6px 10px;color:var(--text,#fff);font-size:0.85rem;outline:none;" />
    </div>
    <div id="dd-prov-list" style="max-height:220px;overflow-y:auto;"></div>
  `
  dd.style.display = 'block'

  const renderItems = (items) => {
    const listEl = document.getElementById('dd-prov-list')
    if (!listEl) return
    listEl.innerHTML = items.length === 0
      ? `<div style="padding:10px 12px;color:var(--muted);font-size:0.85rem;">Sin resultados</div>`
      : items.map(p => `
          <div class="dropdown-item"
               onclick="selProv(${p.id},'${(p.alias || p.nombreOficial).replace(/'/g,"\\'")}','${p.nombreOficial.replace(/'/g,"\\'")}')">
            <strong>${p.alias || p.nombreOficial}</strong>
            ${p.alias ? `<span style="color:var(--muted);font-size:0.78rem"> — ${p.nombreOficial}</span>` : ''}
          </div>`
        ).join('')
  }
  renderItems(lista)

  // Buscador interno
  const ddInput = document.getElementById('dd-prov-search')
  if (ddInput) {
    ddInput.addEventListener('input', e => renderItems(filtrarProveedores(e.target.value)))
    setTimeout(() => ddInput.focus(), 40)
  }
}

function abrirDDProv() {
  const dd = document.getElementById('dd-proveedores')
  if (!dd) return
  if (dd.style.display !== 'none') {
    cerrarDDProv(); return
  }
  renderDDProv(filtrarProveedores(''))
}

function cerrarDDProv() {
  const dd = document.getElementById('dd-proveedores')
  if (dd) dd.style.display = 'none'
}

window.selProv = (id, alias, nombre) => {
  document.getElementById('prov-id').value     = id
  document.getElementById('prov-buscar').value = alias
  cerrarDDProv()
}

async function guardarProveedor() {
  const nombre = document.getElementById('prov-nombre').value.trim()
  const alias  = document.getElementById('prov-alias').value.trim() || null
  const tel    = document.getElementById('prov-tel').value.trim() || null
  const cel    = document.getElementById('prov-cel').value.trim() || null
  if (!nombre) { mostrarError('prov-error', 'Nombre oficial requerido'); return }

  const btn = document.getElementById('prov-guardar')
  btn.disabled = true; btn.textContent = 'Creando...'
  try {
    const data = await apiFetch('/compras/proveedores', { method:'POST', body: JSON.stringify({ nombreOficial: nombre, alias, telefono: tel, celular: cel }) })
    const prov = data.data
    proveedores.push(prov)
    document.getElementById('prov-id').value     = prov.id
    document.getElementById('prov-buscar').value = prov.alias || prov.nombreOficial
    document.getElementById('modal-prov').classList.remove('active')
  } catch (err) { mostrarError('prov-error', err.message) }
  finally { btn.disabled = false; btn.textContent = 'Crear Proveedor' }
}

// ════════════════════════════════════════════════════════════════════
//  BÚSQUEDA PRODUCTOS EN MODAL
// ════════════════════════════════════════════════════════════════════
async function buscarProductosModal(q) {
  const lista = document.getElementById('lista-prod-modal')
  if (!q || q.length < 2) { lista.innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'; return }
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  try {
    const data = await apiFetch(`/productos?buscar=${encodeURIComponent(q)}&take=30`)
    const prods = data.data || data
    if (!prods?.length) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; return }
    window._prodCache = {}
    prods.forEach(p => { window._prodCache[p.id] = p })
    lista.innerHTML = prods.map(p => `
      <div class="prod-item-modal" onclick="window._addProdComp(${p.id})">
        <span class="prod-nombre">${p.nombre}</span>
        <span class="prod-precio">${fmt(p.costo || p.precioBase)}</span>
      </div>`).join('')
  } catch (err) { lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error</p>` }
}
window._addProdComp = id => { const p = window._prodCache?.[id]; if (p) agregarProductoEdicion(p) }

function mostrarError(id, msg) {
  const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.add('show') }
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX',{ weekday:'long', year:'numeric', month:'long', day:'numeric' })

  await cargarProveedores()
  cargarCompras()

  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounceSearch); debounceSearch = setTimeout(() => { paginaActual=1; cargarCompras() }, 400)
  })
  ;['filtro-estado','filtro-pago','filtro-proveedor'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { paginaActual=1; cargarCompras() })
  })
  document.getElementById('btn-prev')?.addEventListener('click', () => { if(paginaActual>1){paginaActual--;cargarCompras()} })
  document.getElementById('btn-next')?.addEventListener('click', () => { paginaActual++;cargarCompras() })

  document.getElementById('btn-nueva')?.addEventListener('click', abrirModalCrear)
  document.getElementById('crear-close')?.addEventListener('click', () => document.getElementById('modal-crear').classList.remove('active'))
  document.getElementById('crear-cancel')?.addEventListener('click', () => document.getElementById('modal-crear').classList.remove('active'))
  document.getElementById('crear-guardar')?.addEventListener('click', guardarCompra)

  document.getElementById('search-prod-modal')?.addEventListener('input', e => {
    clearTimeout(debounceProd); debounceProd = setTimeout(() => buscarProductosModal(e.target.value.trim()), 350)
  })

  // Proveedor — buscador + chevron para ver lista completa
  document.getElementById('prov-buscar')?.addEventListener('input', e => {
    const q = e.target.value
    if (q.length === 0) {
      cerrarDDProv()
      document.getElementById('prov-id').value = ''
    } else {
      renderDDProv(filtrarProveedores(q))
    }
  })
  document.getElementById('prov-buscar')?.addEventListener('focus', () => {
    const q = document.getElementById('prov-buscar')?.value || ''
    renderDDProv(filtrarProveedores(q))
  })
  document.getElementById('btn-chevron-prov')?.addEventListener('click', abrirDDProv)
  document.addEventListener('click', e => {
    if (!e.target.closest('#prov-buscar') &&
        !e.target.closest('#btn-chevron-prov') &&
        !e.target.closest('#dd-proveedores'))
      cerrarDDProv()
  })

  document.getElementById('btn-nuevo-prov')?.addEventListener('click', () => {
    document.getElementById('prov-nombre').value = ''
    document.getElementById('prov-alias').value  = ''
    document.getElementById('prov-tel').value    = ''
    document.getElementById('prov-cel').value    = ''
    document.getElementById('prov-error').classList.remove('show')
    document.getElementById('modal-prov').classList.add('active')
  })
  document.getElementById('prov-close')?.addEventListener('click', () => document.getElementById('modal-prov').classList.remove('active'))
  document.getElementById('prov-cancel')?.addEventListener('click', () => document.getElementById('modal-prov').classList.remove('active'))
  document.getElementById('prov-guardar')?.addEventListener('click', guardarProveedor)

  document.getElementById('det-close')?.addEventListener('click', () => document.getElementById('modal-detalle').classList.remove('active'))
  document.getElementById('btn-abonar')?.addEventListener('click', registrarAbono)

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal-crear')?.classList.remove('active')
      document.getElementById('modal-detalle')?.classList.remove('active')
      document.getElementById('modal-prov')?.classList.remove('active')
      cerrarDDProv()
    }
  })
})
console.log('✅ compras.js cargado')