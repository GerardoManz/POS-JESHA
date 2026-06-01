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
let _deptosCache = []
let _catsCache   = []
let _preciosCache = {}
let _spDetalleActivo = null
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
          <td>${oc.Proveedor?.alias || oc.Proveedor?.nombreOficial || '—'}</td>
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
    _preciosCache = {}
    _spDetalleActivo = null
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

  document.getElementById('det-proveedor').textContent = oc.Proveedor?.nombreOficial || '—'
  document.getElementById('det-tel').textContent = oc.Proveedor?.celular || oc.Proveedor?.telefono || '—'
  document.getElementById('det-fecha').textContent   = fmtFecha(oc.creadaEn)
  document.getElementById('det-usuario').textContent = oc.Usuario?.nombre || '—'

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
  listaAbonos.innerHTML = (!oc.AbonoCompra || oc.AbonoCompra.length === 0)
    ? '<p class="muted-hint">Sin pagos registrados</p>'
    : oc.AbonoCompra.map(a => `
        <div class="abono-item">
          <div>
            <div class="abono-monto">+${fmt(a.monto)}</div>
            <div class="abono-meta">${a.metodoPago} · ${fmtFecha(a.creadoEn)} · ${a.Usuario?.nombre || '—'}</div>
            ${a.notas ? `<div class="abono-meta">${a.notas}</div>` : ''}
          </div>
        </div>`).join('')

  // Tabla de productos
  const recibiendo   = ocActual._recibiendo || false
  const showRecibido = !esPendiente || recibiendo

  document.getElementById('col-recibido-header').style.display = showRecibido ? '' : 'none'
  const colPend = document.getElementById('col-pendiente-header')
  if (colPend) colPend.style.display = recibiendo ? '' : 'none'
  const colPV = document.getElementById('col-precio-venta-header')
  if (colPV) colPV.style.display = recibiendo ? '' : 'none'

  const tbody = document.getElementById('det-items-tbody')
  if (recibiendo) {
    (oc.DetalleOrdenCompra || []).forEach(d => {
      if (!_preciosCache[d.id]) {
        _preciosCache[d.id] = {
          precioCosto: parseFloat(d.precioCosto),
          precioVenta: parseFloat(d.Producto?.precioVenta || 0),
          costoSinIva: null
        }
      }
    })
  }
  tbody.innerHTML = (oc.DetalleOrdenCompra || []).map(d => {
    const cantPedida   = parseFloat(d.cantidadPedida)
    const cantRecibida = parseFloat(d.cantidadRecibida)
    const pendiente    = parseFloat((cantPedida - cantRecibida).toFixed(3))
    const yaCompleto   = cantRecibida >= cantPedida
    const rowStyle     = yaCompleto && recibiendo ? 'opacity:0.45;' : ''
    const unidad       = d.Producto?.unidadCompra || 'pza'
    const granel       = d.Producto?.esGranel === true
    const stepAttr     = granel ? '0.001' : '1'
    const minAttr      = granel ? '0' : '1'
    const imAttr       = granel ? 'decimal' : 'numeric'

    const costoOrden    = parseFloat(d.precioCosto)
    const costoAnterior = parseFloat(d.Producto?.costo || costoOrden)
    const costoSubio    = costoOrden > costoAnterior
    const costoBajo     = costoOrden < costoAnterior
    const costoColor    = costoSubio ? '#f87171' : costoBajo ? '#60d080' : 'inherit'
    const costoAntLabel = recibiendo && costoOrden !== costoAnterior
      ? `<div style="font-size:0.68rem;color:var(--muted);margin-top:2px;">ant: ${fmt(costoAnterior)}</div>`
      : ''

    let estadoFila = ''
    if (!recibiendo) {
      if (yaCompleto)
        estadoFila = `<span style="font-size:0.7rem;background:rgba(96,208,128,0.12);color:#60d080;border:1px solid rgba(96,208,128,0.25);border-radius:4px;padding:1px 6px;margin-left:6px;">✓ completo</span>`
      else if (cantRecibida > 0)
        estadoFila = `<span style="font-size:0.7rem;background:rgba(255,193,7,0.1);color:#ffc107;border:1px solid rgba(255,193,7,0.25);border-radius:4px;padding:1px 6px;margin-left:6px;">parcial ${cantRecibida}/${cantPedida}</span>`
    }

    const celdaRecibido = showRecibido ? `<td style="text-align:center">
      ${recibiendo
        ? yaCompleto
          ? `<span style="color:#60d080;font-size:0.8rem;">✓ ya recibido</span>`
          : `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
               <input type="number" class="input-recibir" id="rec-${d.id}"
                 min="${minAttr}" max="${pendiente}" step="${stepAttr}" inputmode="${imAttr}" value="${pendiente}"
                 style="width:64px;text-align:center;" />
               <span style="font-size:0.68rem;color:var(--muted);">máx ${pendiente} ${unidad}</span>
             </div>`
        : `<span style="color:${yaCompleto ? '#60d080' : cantRecibida > 0 ? '#ffc107' : 'var(--muted)'}">
             ${cantRecibida} / ${cantPedida}
           </span>`
      }
    </td>` : ''

    const celdaPendiente = recibiendo ? `<td style="text-align:center">
      ${yaCompleto
        ? `<span style="color:#60d080;font-size:0.78rem;">—</span>`
        : `<span style="color:#ffc107;font-size:0.82rem;font-weight:500;">${pendiente} ${unidad}</span>`
      }
    </td>` : ''

    const precioVentaActual = parseFloat(d.Producto?.precioVenta || 0)
    const c = _preciosCache[d.id] || { precioCosto: parseFloat(d.precioCosto), precioVenta: precioVentaActual }
    const celdaMargen = recibiendo ? `<td>
      ${yaCompleto
        ? `<span style="color:var(--muted);font-size:0.8rem;">—</span>`
        : `<div style="display:flex;flex-direction:column;gap:4px;">
             <div style="font-size:11px;color:var(--muted);">
               Costo: <strong id="sumcosto-${d.id}">${fmt(c.precioCosto)}</strong>
               · PV: <strong id="sumpv-${d.id}">${c.precioVenta > 0 ? fmt(c.precioVenta) : '—'}</strong>
             </div>
             <button type="button" onclick="event.stopPropagation();recSeleccionarFila(${d.id})" class="btn-secondary btn-sm" style="cursor:pointer;font-size:11px;">✏️ Editar precios</button>
           </div>`
      }
    </td>` : ''

    return `
    <tr id="rec-tr-${d.id}" style="${rowStyle}">
      <td>
        ${d.Producto?.nombre || '—'}
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

  const alertDiv = document.getElementById('recepcion-parcial-alert')
  if (recibiendo && oc.estado === 'RECIBIDO_PARCIAL') {
    const pendientesCount = (oc.DetalleOrdenCompra || []).filter(d => parseFloat(d.cantidadRecibida) < parseFloat(d.cantidadPedida)).length
    alertDiv.innerHTML = `<div style="padding:9px 14px;background:rgba(255,193,7,0.07);border:1px solid rgba(255,193,7,0.2);border-radius:8px;font-size:0.82rem;color:#ffc107;">
        ⚠️ Recepción parcial — ${pendientesCount} producto${pendientesCount !== 1 ? 's' : ''} pendiente${pendientesCount !== 1 ? 's' : ''} de recibir.
       </div>`
  } else {
    alertDiv.innerHTML = ''
  }

  const btns = document.getElementById('det-botones-superiores')
  btns.innerHTML = ''
  if (esPendiente) {
    if (!recibiendo) {
      btns.innerHTML += `<button class="btn-secondary btn-sm" onclick="abrirEdicion(${oc.id})">✏️ Editar</button>`
      btns.innerHTML += `<button class="btn-warning btn-sm" onclick="iniciarRecepcion()">📦 Recibir mercancía</button>`
    } else {
      const pendientes = (oc.DetalleOrdenCompra || []).filter(d => d.cantidadRecibida < d.cantidadPedida).length
      btns.innerHTML += `<button class="btn-success btn-sm" onclick="confirmarRecepcion()">✓ Confirmar recepción (${pendientes} producto${pendientes !== 1 ? 's' : ''})</button>`
      btns.innerHTML += `<button class="btn-secondary btn-sm" onclick="cancelarRecepcion()">✕ Cancelar</button>`
    }
  }

  const accDiv = document.getElementById('det-acciones')
  accDiv.innerHTML = ''
  if (esPendiente)
    accDiv.innerHTML += `<button class="btn-danger" onclick="cancelarCompra(${oc.id})">✕ Cancelar compra</button>`
  if (oc.estado === 'RECIBIDO_PARCIAL' && !recibiendo)
    accDiv.innerHTML += `
      <div style="font-size:0.8rem;color:var(--muted);padding:6px 10px;background:rgba(255,193,7,0.06);border:1px solid rgba(255,193,7,0.15);border-radius:8px;line-height:1.5;">
        ⚠️ Recepción incompleta — cuando llegue el resto da clic en <strong style="color:#ffc107">Recibir mercancía</strong>
      </div>`

  const tfPanel = document.getElementById('rec-tipo-factura-panel')
  if (tfPanel) tfPanel.style.display = recibiendo ? '' : 'none'
  if (recibiendo) {
    const ra = document.getElementById('rec-radio-a')
    if (ra) ra.checked = true
    recAplicarTipoFactura('A')
  }
  const spPanel = document.getElementById('modal-precio')
  if (spPanel && !recibiendo) spPanel.classList.remove('active')
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
  _preciosCache = {}
  _spDetalleActivo = null
  renderDetalle()
}
window.confirmarRecepcion = async function() {
  const tipoFactura = document.getElementById('rec-radio-b')?.checked ? 'DESGLOSE' : 'NETO'
  const detalles = (ocActual.DetalleOrdenCompra || [])
    .filter(d => parseFloat(d.cantidadPedida) > parseFloat(d.cantidadRecibida))
    .map(d => {
      const cantNueva = parseFloat(document.getElementById(`rec-${d.id}`)?.value) || 0
      if (cantNueva <= 0) return null
      const c = _preciosCache[d.id] || {}
      const precioCosto = (c.precioCosto && c.precioCosto > 0) ? c.precioCosto : parseFloat(d.precioCosto)
      const pvVal = (c.precioVenta && c.precioVenta > 0) ? c.precioVenta : 0
      const costoSinIva = tipoFactura === 'DESGLOSE' ? (c.costoSinIva || null) : null
      return {
        detalleId: d.id,
        cantidadRecibida: cantNueva,
        precioCosto: +precioCosto.toFixed(2),
        precioVenta: pvVal > 0 ? +pvVal.toFixed(2) : null,
        tipoFacturaProv: tipoFactura,
        costoSinIvaProveedor: costoSinIva
      }
    })
    .filter(Boolean)

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
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirmar recepción' }
  }
}

window.cancelarCompra = async function(id) {
  const esRecibidoParcial = ocActual?.estado === 'RECIBIDO_PARCIAL'
  const mensaje = esRecibidoParcial
    ? `¿Cancelar la recepción del resto de <strong>${ocActual?.folio}</strong>? Los productos ya recibidos conservarán su stock. Esta acción no se puede deshacer.`
    : `¿Cancelar la orden <strong>${ocActual?.folio}</strong>? Esta acción no se puede deshacer.`
  const ok = await jeshaConfirm({
    title: 'Cancelar compra',
    message: mensaje,
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
//  ABONO — FIX: validación robusta del monto
// ════════════════════════════════════════════════════════════════════
async function registrarAbono() {
  const montoInput = document.getElementById('abono-monto')
  const rawValue   = montoInput?.value?.trim()
  if (!rawValue || rawValue === '') { jeshaToast('Ingresa un monto', 'warning'); return }

  const monto  = parseFloat(rawValue)
  if (isNaN(monto) || monto <= 0) { jeshaToast('Monto inválido', 'warning'); return }

  const metodo = document.getElementById('abono-metodo').value
  const notas  = document.getElementById('abono-notas').value.trim() || null

  const btn = document.getElementById('btn-abonar')
  btn.disabled = true; btn.textContent = 'Registrando...'
  try {
    const data = await apiFetch(`/compras/${ocActual.id}/abonos`, { method:'POST', body: JSON.stringify({ monto, metodoPago: metodo, notas }) })
    ocActual = data.data
    montoInput.value = ''
    document.getElementById('abono-notas').value = ''
    renderDetalle()
    cargarCompras()
    jeshaToast('Pago registrado', 'success')
  } catch (err) {
    const msg = err.message || 'Error al registrar abono'
    jeshaToast(msg, msg.includes('excede') ? 'warning' : 'error')
  }
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
  document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Selecciona un proveedor primero...</p>'
  document.getElementById('crear-error').classList.remove('show')
  const searchProd = document.getElementById('search-prod-modal')
  if (searchProd) { searchProd.disabled = true; searchProd.placeholder = 'Selecciona un proveedor primero...' }
  renderItemsEdicion()
  document.getElementById('modal-crear').classList.add('active')
}

window.abrirEdicion = async function(id) {
  document.getElementById('modal-detalle').classList.remove('active')
  try {
    const data = await apiFetch(`/compras/${id}`)
    ocActual = data.data
    document.getElementById('crear-titulo').textContent = `Editar ${ocActual.folio}`
    document.getElementById('prov-buscar').value = ocActual.Proveedor?.nombreOficial || ''
    document.getElementById('prov-id').value     = ocActual.Proveedor?.id || ''
    document.getElementById('comp-notas').value  = ocActual.notas || ''
    document.getElementById('search-prod-modal').value = ''
    document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
    document.getElementById('crear-error').classList.remove('show')

    itemsEdicion = (ocActual.DetalleOrdenCompra || []).map(d => ({
      productoId:       d.Producto?.id,
      nombre:           d.Producto?.nombre || '—',
      unidad:           d.Producto?.unidadCompra || 'pza',
      cantidad:         d.cantidadPedida,
      costoNeto:        parseFloat(d.precioCosto),
      cantidadRecibida: d.cantidadRecibida || 0
    }))
    renderItemsEdicion()
    document.getElementById('modal-crear').classList.add('active')
  } catch (err) { jeshaToast('Error: ' + err.message, 'error') }
}

function renderItemsEdicion() {
  const tbody = document.getElementById('comp-items-tbody')
  if (itemsEdicion.length === 0) {
    tbody.innerHTML = `<tr id="comp-empty"><td colspan="5" class="empty-items">Agrega productos desde el panel izquierdo</td></tr>`
    actualizarTotalEdicion(); return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => {
    const bloqueado = (item.cantidadRecibida || 0) > 0
    const subtotal  = item.costoNeto * item.cantidad
    return `
    <tr style="${bloqueado ? 'opacity:0.6;' : ''}">
      <td style="max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:0.82rem;" title="${item.nombre}">
        ${item.nombre}
        ${bloqueado ? `<span style="font-size:0.65rem;color:#ffc107;margin-left:3px;">rec:${item.cantidadRecibida}</span>` : ''}
      </td>
      <td>${bloqueado
        ? `<span style="color:var(--muted);font-size:0.82rem;">${item.cantidad}</span>`
        : `<input type="number" min="0.001" step="0.001" value="${item.cantidad}" oninput="editItem(${i},'cantidad',this.value)" />`
      }</td>
      <td><span style="color:var(--muted);">${fmt(item.costoNeto)}</span></td>
      <td><span id="item-sub-${i}">${fmt(subtotal)}</span></td>
      <td>${bloqueado
        ? `<span title="Mercancía ya recibida" style="color:var(--muted);font-size:0.72rem;cursor:not-allowed;">&#128274;</span>`
        : `<button class="btn-eliminar" onclick="quitarItemEdicion(${i})">\u2715</button>`
      }</td>
    </tr>`
  }).join('')
  actualizarTotalEdicion()
}

window.editItem = function(i, campo, v) {
  if (campo !== 'cantidad') return
  const n = parseFloat(v)
  if (isNaN(n) || n < 0) return
  const item = itemsEdicion[i]
  item.cantidad = n || 0.001
  const cel = document.getElementById(`item-sub-${i}`)
  if (cel) cel.textContent = fmt(item.costoNeto * item.cantidad)
  actualizarTotalEdicion()
}

window.quitarItemEdicion = function(i) {
  if ((itemsEdicion[i]?.cantidadRecibida || 0) > 0) return
  itemsEdicion.splice(i, 1)
  renderItemsEdicion()
}

function actualizarTotalEdicion() {
  const t = itemsEdicion.reduce((s, i) => s + i.costoNeto * i.cantidad, 0)
  document.getElementById('comp-total').textContent = fmt(t)
}

function agregarProductoEdicion(prod) {
  const existe = itemsEdicion.find(i => i.productoId === prod.id)
  if (existe) { existe.cantidad += 1; renderItemsEdicion(); return }
  const costoNeto = parseFloat(prod.costoPromedio || prod.costo || 0)
  itemsEdicion.push({
    productoId: prod.id,
    nombre: prod.nombre,
    unidad: prod.unidadCompra || 'pza',
    cantidad: 1,
    costoNeto,
    cantidadRecibida: 0
  })
  renderItemsEdicion()
}

async function guardarCompra() {
  const provId = document.getElementById('prov-id').value
  const notas  = document.getElementById('comp-notas').value.trim() || null
  if (!provId) { mostrarError('crear-error', 'Selecciona un proveedor'); return }
  if (itemsEdicion.length === 0) { mostrarError('crear-error', 'Agrega al menos un producto'); return }

  const detalles = itemsEdicion.map(i => ({
    productoId: i.productoId,
    cantidadPedida: i.cantidad,
    precioCosto: +(i.costoNeto || 0).toFixed(2)
  }))
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

function filtrarProveedores(q) {
  const l = (q || '').toLowerCase().trim()
  if (!l) return proveedores.slice(0, 50)
  return proveedores.filter(p =>
    p.nombreOficial?.toLowerCase().includes(l) ||
    p.alias?.toLowerCase().includes(l)
  ).slice(0, 50)
}

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

  const engancharListeners = () => {
    const listEl = document.getElementById('dd-prov-list')
    if (!listEl) return
    listEl.querySelectorAll('.dropdown-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.id)
        const prov = proveedores.find(p => p.id === id)
        if (prov) aplicarProveedorSeleccionado(id, prov.alias || prov.nombreOficial)
      })
    })
  }

  const renderItems = (items) => {
    const listEl = document.getElementById('dd-prov-list')
    if (!listEl) return
    listEl.innerHTML = items.length === 0
      ? `<div style="padding:10px 12px;color:var(--muted);font-size:0.85rem;">Sin resultados</div>`
      : items.map(p => `
          <div class="dropdown-item" data-id="${p.id}">
            <strong>${p.alias || p.nombreOficial}</strong>
            ${p.alias ? `<span style="color:var(--muted);font-size:0.78rem"> — ${p.nombreOficial}</span>` : ''}
          </div>`
        ).join('')
    engancharListeners()
  }
  renderItems(lista)

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

function aplicarProveedorSeleccionado(id, alias) {
  document.getElementById('prov-id').value     = id
  document.getElementById('prov-buscar').value = alias
  cerrarDDProv()
  const searchProd = document.getElementById('search-prod-modal')
  if (searchProd) {
    searchProd.disabled    = false
    searchProd.placeholder = 'Nombre o código...'
    searchProd.focus()
  }
  document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Escribe para buscar productos...</p>'
}

window.selProv = (id, alias, nombre) => {
  aplicarProveedorSeleccionado(id, alias)
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
    aplicarProveedorSeleccionado(prov.id, prov.alias || prov.nombreOficial)
    const sel = document.getElementById('filtro-proveedor')
    if (sel) {
      const opt = document.createElement('option')
      opt.value = prov.id
      opt.textContent = prov.alias || prov.nombreOficial
      sel.appendChild(opt)
    }
    document.getElementById('modal-prov').classList.remove('active')
  } catch (err) { mostrarError('prov-error', err.message) }
  finally { btn.disabled = false; btn.textContent = 'Crear Proveedor' }
}

// ════════════════════════════════════════════════════════════════════
//  BÚSQUEDA PRODUCTOS EN MODAL — FIX: búsqueda GLOBAL (sin proveedorId)
// ════════════════════════════════════════════════════════════════════
async function buscarProductosModal(q) {
  const lista = document.getElementById('lista-prod-modal')
  if (!q || q.length < 2) { lista.innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'; return }
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  try {
    // FIX: Búsqueda global — NO enviar proveedorId para mostrar todo el catálogo
    const params = new URLSearchParams({ buscar: q, take: 30 })
    const data = await apiFetch(`/productos?${params}`)
    const prods = data.data || data
    if (!prods?.length) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; return }
    window._prodCache = {}
    prods.forEach(p => { window._prodCache[p.id] = p })
    lista.innerHTML = prods.map(p => `
      <div class="prod-item-modal" onclick="window._addProdComp(${p.id})">
        <span class="prod-nombre">${p.nombre}</span>
        <span class="prod-precio">${fmt(p.costo || p.costoPromedio || 0)}</span>
      </div>`).join('')
  } catch (err) { lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error</p>` }
}
window._addProdComp = id => { const p = window._prodCache?.[id]; if (p) agregarProductoEdicion(p) }

function mostrarError(id, msg) {
  const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.add('show') }
}

// ════════════════════════════════════════════════════════════════════
//  PRODUCTO RÁPIDO — Lógica financiera idéntica a productos.js
// ════════════════════════════════════════════════════════════════════
async function cargarDeptosYCats() {
  try {
    const [dRes, cRes] = await Promise.all([
      apiFetch('/productos/departamentos'),
      apiFetch('/productos/categorias')
    ])
    _deptosCache = dRes.data || dRes
    _catsCache   = cRes.data || cRes
  } catch (e) { console.warn('Error cargando deptos/cats:', e.message) }
}

function llenarSelectDeptos() {
  const sel = document.getElementById('pr-depto')
  if (!sel) return
  sel.innerHTML = '<option value="">Seleccionar...</option>'
  _deptosCache.forEach(d => {
    sel.innerHTML += `<option value="${d.id}">${d.nombre}</option>`
  })
}

function llenarSelectCats(deptoId) {
  const sel = document.getElementById('pr-cat')
  if (!sel) return
  sel.innerHTML = '<option value="">Seleccionar...</option>'
  const filtradas = _catsCache.filter(c => c.departamentoId === parseInt(deptoId))
  filtradas.forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.nombre}</option>`
  })
}

function abrirModalProdRapido() {
  // Validar que haya proveedor seleccionado
  const provId = document.getElementById('prov-id').value
  if (!provId) {
    jeshaToast('Selecciona un proveedor antes de crear un producto rápido', 'warning')
    return
  }

  // Limpiar campos
  document.getElementById('pr-nombre').value      = ''
  document.getElementById('pr-codigo').value       = ''
  document.getElementById('pr-costo').value        = ''
  document.getElementById('pr-costoSinIva').value  = ''
  document.getElementById('pr-costo-b-display').value = ''
  document.getElementById('pr-pventa').value       = ''
  document.getElementById('pr-precioBase').value   = ''
  document.getElementById('pr-unidadVenta').value  = 'pza'
  document.getElementById('pr-claveSat').value     = ''
  document.getElementById('pr-unidadSat').value    = ''
  document.getElementById('pr-esGranel').checked   = false
  document.getElementById('pr-depto').value        = ''
  document.getElementById('pr-cat').innerHTML      = '<option value="">Seleccionar depto primero</option>'
  document.getElementById('pr-error').classList.remove('show')

  // Reset tipo factura a A
  document.getElementById('pr-radio-a').checked = true
  prAplicarTipoFactura('A')

  // Reset margen
  document.getElementById('pr-margen-wrap').style.display = 'none'

  // Reset granel
  prActualizarGranel()

  // Proveedor automático desde la compra
  const provNombre = document.getElementById('prov-buscar').value
  document.getElementById('pr-prov-id').value      = provId
  document.getElementById('pr-prov-nombre').textContent = provNombre || '—'

  llenarSelectDeptos()
  document.getElementById('modal-prod-rapido').classList.add('active')
  setTimeout(() => document.getElementById('pr-nombre')?.focus(), 100)
}

// ── Tipo factura (replicado de productos.js) ──
function prAplicarTipoFactura(tipo) {
  const esB = tipo === 'B'
  document.getElementById('pr-campos-a').style.display = esB ? 'none' : ''
  document.getElementById('pr-campos-b').style.display = esB ? ''     : 'none'

  const labelA = document.getElementById('pr-radio-label-a')
  const labelB = document.getElementById('pr-radio-label-b')
  if (labelA) {
    labelA.style.background  = esB ? '' : 'rgba(107,157,232,0.08)'
    labelA.style.borderColor = esB ? 'var(--panel-border)' : '#6b9de8'
  }
  if (labelB) {
    labelB.style.background  = esB ? 'rgba(107,157,232,0.08)' : ''
    labelB.style.borderColor = esB ? '#6b9de8' : 'var(--panel-border)'
  }

  if (!esB) {
    document.getElementById('pr-costoSinIva').value     = ''
    document.getElementById('pr-costo-b-display').value = ''
  }

  prCalcularMargen()
}

// sinIVA × 1.16 = Precio Proveedor (Escenario B)
function prCalcularCostoDesdeB() {
  const sinIva  = parseFloat(document.getElementById('pr-costoSinIva')?.value) || 0
  const display = document.getElementById('pr-costo-b-display')
  const inputCosto = document.getElementById('pr-costo')

  const precioProveedor = sinIva > 0 ? parseFloat((sinIva * 1.16).toFixed(2)) : 0

  if (display) display.value = precioProveedor > 0 ? precioProveedor : ''
  if (inputCosto) inputCosto.value = precioProveedor > 0 ? precioProveedor : ''

  prCalcularMargen()
}

// Precio Base = Precio Venta / 1.16
function prCalcularPrecioBase() {
  const pv = parseFloat(document.getElementById('pr-pventa')?.value) || 0
  const pbInput = document.getElementById('pr-precioBase')
  if (!pbInput) return
  pbInput.value = pv > 0 ? (pv / 1.16).toFixed(2) : ''
}

// Margen = ((PVenta - Costo) / Costo) × 100
function prCalcularMargen() {
  const costo = parseFloat(document.getElementById('pr-costo')?.value) || 0
  const pv    = parseFloat(document.getElementById('pr-pventa')?.value) || 0
  const wrap  = document.getElementById('pr-margen-wrap')
  if (!wrap) return

  if (costo > 0 && pv > 0) {
    const utilidad = pv - costo
    const margen   = (utilidad / costo) * 100
    document.getElementById('pr-margen-valor').textContent   = margen.toFixed(2) + '%'
    document.getElementById('pr-utilidad-valor').textContent = '$' + utilidad.toFixed(2)
    wrap.style.display = 'block'
  } else {
    wrap.style.display = 'none'
  }
}

// ── Panel singleton recepción (abre/cierra por fila) ──
window.recSeleccionarFila = function(id) {
  _spDetalleActivo = id
  const c = _preciosCache[id] || { precioCosto:0, precioVenta:0, costoSinIva:null }
  const esB = document.getElementById('rec-radio-b')?.checked
  const det = (ocActual.DetalleOrdenCompra || []).find(d => d.id === id)
  const tit = document.getElementById('sp-titulo')
  if (tit) tit.textContent = 'Precios: ' + (det?.Producto?.nombre || '')

  document.getElementById('sp-costo').value = c.precioCosto > 0 ? c.precioCosto.toFixed(2) : ''
  document.getElementById('sp-precioVenta').value = c.precioVenta > 0 ? c.precioVenta.toFixed(2) : ''
  document.getElementById('sp-costoSinIva').value = (c.costoSinIva && c.costoSinIva > 0) ? c.costoSinIva.toFixed(2) : ''

  document.getElementById('sp-campos-a').style.display = esB ? 'none' : ''
  document.getElementById('sp-campos-b').style.display = esB ? '' : 'none'

  document.getElementById('modal-precio').classList.add('active')

  esB ? recCalcCostoSingletonB() : recCalcSingleton()
}

window.recCalcSingleton = function() {
  const costo = parseFloat(document.getElementById('sp-costo').value) || 0
  const pv    = parseFloat(document.getElementById('sp-precioVenta').value) || 0
  const pb    = document.getElementById('sp-precioBase')
  const wrap  = document.getElementById('sp-info-margen-wrap')
  if (pb) pb.value = pv > 0 ? (pv / 1.16).toFixed(2) : ''
  if (costo > 0 && pv > 0) {
    const utilidad = pv - costo
    const margen = Math.min((utilidad / costo) * 100, 999.99)
    document.getElementById('sp-margen-valor').textContent = margen.toFixed(2) + '%'
    document.getElementById('sp-utilidad-valor').textContent = '$' + utilidad.toFixed(2)
    if (wrap) wrap.style.display = 'block'
  } else if (wrap) { wrap.style.display = 'none' }
}

window.recCalcCostoSingletonB = function() {
  const sinIva = parseFloat(document.getElementById('sp-costoSinIva').value) || 0
  const conIva = sinIva > 0 ? +(sinIva * 1.16).toFixed(2) : 0
  const costoInput = document.getElementById('sp-costo')
  const display = document.getElementById('sp-costo-b-display')
  if (costoInput) costoInput.value = conIva > 0 ? conIva.toFixed(2) : ''
  if (display) display.value = conIva > 0 ? conIva.toFixed(2) : ''
  recCalcSingleton()
}

window.recGuardarPanel = function() {
  if (_spDetalleActivo == null) return
  const id = _spDetalleActivo
  const esB = document.getElementById('rec-radio-b')?.checked
  const costo = parseFloat(document.getElementById('sp-costo').value) || 0
  const pv = parseFloat(document.getElementById('sp-precioVenta').value) || 0
  const sinIva = esB ? (parseFloat(document.getElementById('sp-costoSinIva').value) || null) : null
  _preciosCache[id] = { precioCosto: costo, precioVenta: pv, costoSinIva: sinIva }
  const sc = document.getElementById('sumcosto-' + id)
  const sp = document.getElementById('sumpv-' + id)
  if (sc) sc.textContent = fmt(costo)
  if (sp) sp.textContent = pv > 0 ? fmt(pv) : '—'
  recCerrarPanel()
}

window.recCerrarPanel = function() {
  _spDetalleActivo = null
  const p = document.getElementById('modal-precio')
  if (p) p.classList.remove('active')
}

window.recAplicarTipoFactura = function(tipo) {
  const esB = tipo === 'B'
  const a = document.getElementById('sp-campos-a')
  const b = document.getElementById('sp-campos-b')
  if (a) a.style.display = esB ? 'none' : ''
  if (b) b.style.display = esB ? '' : 'none'
  if (_spDetalleActivo != null) {
    esB ? recCalcCostoSingletonB() : recCalcSingleton()
  }
}

// Toggle granel
function prActualizarGranel() {
  const checked = document.getElementById('pr-esGranel')?.checked || false
  const knob    = document.getElementById('pr-granel-knob')
  const hint    = document.getElementById('pr-granel-hint')
  if (knob) knob.style.transform = checked ? 'translateX(20px)' : 'translateX(0)'
  if (knob?.parentElement) knob.parentElement.style.background = checked ? '#6b9de8' : 'rgba(255,255,255,0.1)'
  if (hint) hint.style.display = checked ? 'block' : 'none'
}

async function guardarProdRapido() {
  const nombre   = document.getElementById('pr-nombre').value.trim()
  const codigo   = document.getElementById('pr-codigo').value.trim()
  const catId    = document.getElementById('pr-cat').value
  const costo    = parseFloat(document.getElementById('pr-costo').value)
  const pventa   = parseFloat(document.getElementById('pr-pventa').value)
  const provId   = document.getElementById('pr-prov-id').value || null

  // Tipo de factura
  const esDesgloseB = document.getElementById('pr-radio-b')?.checked
  const tipoFactura = esDesgloseB ? 'DESGLOSE' : 'NETO'
  const costoSinIva = esDesgloseB ? (parseFloat(document.getElementById('pr-costoSinIva').value) || null) : null

  // Precio base calculado
  const precioBase = pventa > 0 ? parseFloat((pventa / 1.16).toFixed(2)) : 0

  // Unidad de venta + granel
  const unidadVenta = document.getElementById('pr-unidadVenta').value.trim() || 'pza'
  const esGranel    = document.getElementById('pr-esGranel')?.checked || false

  // SAT
  const claveSat  = document.getElementById('pr-claveSat').value.trim() || null
  const unidadSat = document.getElementById('pr-unidadSat').value.trim() || null

  // Validaciones
  if (!nombre) { mostrarError('pr-error', 'Nombre requerido'); return }
  if (!codigo) { mostrarError('pr-error', 'Código interno requerido'); return }
  if (!catId)  { mostrarError('pr-error', 'Categoría requerida'); return }
  if (!precioBase || precioBase <= 0) { mostrarError('pr-error', 'Precio de venta requerido'); return }

  // Validar costo según escenario
  if (esDesgloseB) {
    if (!costoSinIva || costoSinIva <= 0) { mostrarError('pr-error', 'Precio sin IVA requerido en escenario desglose'); return }
  } else {
    if (!costo || costo <= 0) { mostrarError('pr-error', 'Precio proveedor (costo) requerido'); return }
  }

  const btn = document.getElementById('prod-rapido-guardar')
  btn.disabled = true; btn.textContent = 'Creando...'

  try {
    const datos = {
      nombre,
      codigoInterno:        codigo,
      costo:                costo || null,
      costoSinIvaProveedor: costoSinIva,
      tipoFacturaProv:      tipoFactura,
      precioBase:           precioBase,
      precioVenta:          pventa || null,
      categoriaId:          parseInt(catId),
      proveedorId:          provId ? parseInt(provId) : null,
      unidadCompra:         'pza',
      unidadVenta:          unidadVenta,
      esGranel:             esGranel,
      claveSat:             claveSat,
      unidadSat:            unidadSat
    }

    const data = await apiFetch('/productos', { method: 'POST', body: JSON.stringify(datos) })
    const prod = data.data || data

    agregarProductoEdicion(prod)
    document.getElementById('modal-prod-rapido').classList.remove('active')
    jeshaToast(`Producto "${nombre}" creado y agregado`, 'success')
  } catch (err) { mostrarError('pr-error', err.message) }
  finally { btn.disabled = false; btn.textContent = 'Crear y Agregar' }
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

  // Producto rápido
  document.getElementById('btn-nuevo-prod')?.addEventListener('click', abrirModalProdRapido)
  document.getElementById('prod-rapido-close')?.addEventListener('click', () => document.getElementById('modal-prod-rapido').classList.remove('active'))
  document.getElementById('prod-rapido-cancel')?.addEventListener('click', () => document.getElementById('modal-prod-rapido').classList.remove('active'))
  document.getElementById('prod-rapido-guardar')?.addEventListener('click', guardarProdRapido)
  document.getElementById('pr-depto')?.addEventListener('change', e => llenarSelectCats(e.target.value))

  // Tipo de factura — radios
  document.getElementById('pr-radio-a')?.addEventListener('change', () => prAplicarTipoFactura('A'))
  document.getElementById('pr-radio-b')?.addEventListener('change', () => prAplicarTipoFactura('B'))

  // Cálculos financieros en vivo
  document.getElementById('pr-costoSinIva')?.addEventListener('input', prCalcularCostoDesdeB)
  document.getElementById('pr-costo')?.addEventListener('input', prCalcularMargen)
  document.getElementById('pr-pventa')?.addEventListener('input', () => {
    prCalcularPrecioBase()
    prCalcularMargen()
  })

  // Granel toggle
  document.getElementById('pr-esGranel')?.addEventListener('change', prActualizarGranel)

  // Cargar catálogo para producto rápido
  cargarDeptosYCats()

  document.getElementById('search-prod-modal')?.addEventListener('input', e => {
    clearTimeout(debounceProd); debounceProd = setTimeout(() => buscarProductosModal(e.target.value.trim()), 350)
  })

  // Proveedor — buscador + chevron
  document.getElementById('prov-buscar')?.addEventListener('input', e => {
    const q = e.target.value
    if (q.length === 0) {
      cerrarDDProv()
      document.getElementById('prov-id').value = ''
      const searchProd = document.getElementById('search-prod-modal')
      if (searchProd) {
        searchProd.disabled    = true
        searchProd.placeholder = 'Selecciona un proveedor primero...'
        searchProd.value       = ''
      }
      document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Selecciona un proveedor primero...</p>'
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
      document.getElementById('modal-prod-rapido')?.classList.remove('active')
      cerrarDDProv()
    }
  })
})
console.log('✅ compras.js cargado')
