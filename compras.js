// ════════════════════════════════════════════════════════════════════
//  COMPRAS.JS
// ════════════════════════════════════════════════════════════════════
const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'
const LIMIT   = 25
const IVA_FACTOR = window.__JESHA_IVA_FACTOR__ || 1.16

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
  document.getElementById('col-uc-header').style.display = recibiendo ? '' : 'none'
  document.getElementById('col-factor-header').style.display = recibiendo ? '' : 'none'
  document.getElementById('col-piezas-header').style.display = recibiendo ? '' : 'none'
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
    const minAttr      = granel ? '0.001' : '1'
    const imAttr       = granel ? 'decimal' : 'numeric'
    // Factor/unidad de venta: el SNAPSHOT de la OC manda (es lo que el backend
    // aplicará al recibir); fallback al producto vivo para OCs legacy sin snapshot.
    const factor       = parseFloat(d.factorConversionSnapshot ?? d.Producto?.factorConversion ?? 1) || 1
    const unidadVenta  = d.unidadVentaSnapshot || d.Producto?.unidadVenta || 'pza'

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

    const celdaUC = recibiendo
      ? `<td style="text-align:center"><span style="font-size:0.82rem;color:var(--muted)">${unidad}</span></td>`
      : ''
    const celdaFactor = recibiendo
      ? `<td style="text-align:center"><span style="font-size:0.82rem;color:${factor > 1 ? 'var(--accent)' : 'var(--muted)'}">${factor > 1 ? `×${factor}` : '—'}</span></td>`
      : ''
    const celdaPiezas = recibiendo && !yaCompleto && factor > 1
      ? `<td style="text-align:right;font-size:0.82rem;">
           <span id="piezas-val-${d.id}" style="color:#60d080">${parseFloat((pendiente * factor).toFixed(3))} ${unidadVenta}</span>
         </td>`
      : (recibiendo ? `<td style="text-align:center;color:var(--muted);font-size:0.78rem;">—</td>` : '')

    const celdaRecibido = showRecibido ? `<td style="text-align:center">
      ${recibiendo
        ? yaCompleto
          ? `<span style="color:#60d080;font-size:0.8rem;">✓ ya recibido</span>`
          : `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
               <input type="number" class="input-recibir" id="rec-${d.id}"
                 min="${minAttr}" max="${pendiente}" step="${stepAttr}" inputmode="${imAttr}" value="${pendiente}"
                 data-factor="${factor}" data-uv="${unidadVenta}"
                 oninput="recRecalcularResumen(); recEquivalente('${d.id}')"
                 style="width:${granel ? '76px' : '64px'};text-align:center;" />
                <span style="font-size:0.68rem;color:var(--muted);">máx ${pendiente} ${unidad}</span>
              </div>`
        : `<span style="color:${yaCompleto ? '#60d080' : cantRecibida > 0 ? '#ffc107' : 'var(--muted)'}">
             ${cantRecibida} / ${cantPedida}
           </span>`
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

    // Auditoría de precios (solo en lectura, cuando la línea ya tiene snapshot)
    let auditBlock = ''
    if (!recibiendo && d.costoAnterior != null) {
      const cAnt = parseFloat(d.costoAnterior)
      const cNue = parseFloat(d.precioCosto)
      const cTxt = (cAnt === cNue)
        ? `<span class="audit-nochg">sin cambio</span>`
        : `<span class="audit-ant">${fmt(cAnt)}</span> → <strong style="color:${cNue > cAnt ? '#f87171' : '#60d080'};">${fmt(cNue)}</strong>`
      let pvTxt
      const pAnt = d.precioVentaAnterior != null ? parseFloat(d.precioVentaAnterior) : null
      const pNue = d.precioVentaNuevo != null ? parseFloat(d.precioVentaNuevo) : null
      if (pNue == null || (pAnt != null && pNue === pAnt)) {
        pvTxt = `<span class="audit-nochg">sin cambio</span>`
      } else {
        const pvColor = (pAnt != null && pNue > pAnt) ? '#60d080' : (pAnt != null && pNue < pAnt) ? '#f87171' : 'var(--text)'
        pvTxt = `<span class="audit-ant">${pAnt != null ? fmt(pAnt) : '—'}</span> → <strong style="color:${pvColor};">${fmt(pNue)}</strong>`
      }
      let tagFactura = ''
      let desgloseFactura = ''
      if (d.facturaDesglosada === true) {
        tagFactura = `<span class="audit-tag audit-tag-iva">Desglose IVA</span>`
        const desg = _desgloseLinea(d.precioCosto)
        desgloseFactura = `<div class="audit-desglose">${fmt(desg.sIva)} + IVA ${fmt(desg.iva)} = <strong>${fmt(desg.conIva)}</strong></div>`
      } else if (d.facturaDesglosada === false) {
        tagFactura = `<span class="audit-tag">Neto</span>`
      }
      auditBlock = `
        <div class="audit-precios">
          <div><span class="audit-lbl">Costo:</span> ${cTxt} ${tagFactura}</div>
          ${desgloseFactura}
          <div><span class="audit-lbl">P. Venta:</span> ${pvTxt}</div>
        </div>`
    }

    return `
    <tr id="rec-tr-${d.id}" style="${rowStyle}">
      <td>
        ${d.Producto?.nombre || '—'}
        ${estadoFila}
        ${auditBlock}
      </td>
      <td style="text-align:center">
        <strong>${cantPedida}</strong>
        <div class="qty-pedido">${unidad}</div>
      </td>
      ${celdaUC}
      ${celdaFactor}
      ${celdaRecibido}
      ${celdaPiezas}
      <td>
        <span style="color:${costoColor}">${fmt(costoOrden)}</span>
        ${costoAntLabel}
      </td>
      ${celdaMargen}
      <td id="subtot-${d.id}">${fmt(d.subtotalPedido)}</td>
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
  btns.innerHTML += `<button class="btn-secondary btn-sm" onclick="generarComprobanteRecepcion()">📄 Descargar PDF</button>`
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

  // Opción A: en recepción solo la factura editable; en lectura solo la tabla normal
  const tablaProductos = document.getElementById('tabla-productos-wrapper')
  if (tablaProductos) tablaProductos.style.display = recibiendo ? 'none' : ''

  if (recibiendo) {
    renderFacturaViva()
  } else {
    const fv = document.getElementById('factura-viva')
    if (fv) fv.style.display = 'none'
  }
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
  cerrarDropdownProductos()
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
    cerrarDropdownProductos()
    document.getElementById('crear-error').classList.remove('show')

    itemsEdicion = (ocActual.DetalleOrdenCompra || []).map(d => ({
      productoId:       d.Producto?.id,
      nombre:           d.Producto?.nombre || '—',
      codigoInterno:    d.Producto?.codigoInterno || null,
      codigoBarras:     d.Producto?.codigoBarras || null,
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
    tbody.innerHTML = `<tr id="comp-empty"><td colspan="6" class="empty-items">Agrega productos desde el buscador superior</td></tr>`
    actualizarTotalEdicion(); return
  }
  tbody.innerHTML = itemsEdicion.map((item, i) => {
    const bloqueado = (item.cantidadRecibida || 0) > 0
    const subtotal  = item.costoNeto * item.cantidad
    const codigo = item.codigoInterno || item.codigoBarras || '—'
    return `
    <tr id="comp-item-${item.productoId}" style="${bloqueado ? 'opacity:0.6;' : ''}">
      <td><span class="compra-item-codigo">${codigo}</span></td>
      <td>
        <div class="compra-item-desc">${item.nombre}</div>
        ${bloqueado ? `<span style="font-size:0.65rem;color:#ffc107;margin-left:3px;">rec:${item.cantidadRecibida}</span>` : ''}
      </td>
      <td>${bloqueado
        ? `<span style="color:var(--muted);font-size:0.82rem;">${item.cantidad}</span>`
        : `<input type="number" min="0.001" step="1" value="${item.cantidad}" oninput="editItem(${i},'cantidad',this.value)" />`
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

function enfocarItemEdicion(productoId) {
  requestAnimationFrame(() => {
    const fila = document.getElementById(`comp-item-${productoId}`)
    if (!fila) return

    const wrapper = fila.closest('.compra-items-wrapper') || document.querySelector('.compra-items-wrapper')
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
    void fila.offsetWidth
    fila.classList.add('fila-resaltada')
  })
}

function agregarProductoEdicion(prod) {
  const existe = itemsEdicion.find(i => i.productoId === prod.id)
  if (existe) {
    existe.cantidad += 1
    existe.codigoInterno = existe.codigoInterno || prod.codigoInterno || null
    existe.codigoBarras  = existe.codigoBarras  || prod.codigoBarras  || null
    renderItemsEdicion()
    enfocarItemEdicion(prod.id)
    if (typeof jeshaToast === 'function') jeshaToast('Cantidad aumentada', 'info')
    return
  }
  const costoNeto = parseFloat(prod.costoPromedio || prod.costo || 0)
  itemsEdicion.push({
    productoId: prod.id,
    nombre: prod.nombre,
    codigoInterno: prod.codigoInterno || null,
    codigoBarras: prod.codigoBarras || null,
    unidad: prod.unidadCompra || 'pza',
    cantidad: 1,
    costoNeto,
    cantidadRecibida: 0
  })
  renderItemsEdicion()
  enfocarItemEdicion(prod.id)
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
  cerrarDropdownProductos()
  const searchProd = document.getElementById('search-prod-modal')
  if (searchProd) {
    searchProd.disabled    = false
    searchProd.placeholder = 'Buscar producto por nombre o código...'
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
function abrirDropdownProductos() {
  const lista = document.getElementById('lista-prod-modal')
  if (lista) lista.classList.add('is-open')
}

function cerrarDropdownProductos() {
  const lista = document.getElementById('lista-prod-modal')
  if (lista) lista.classList.remove('is-open')
}

async function buscarProductosModal(q) {
  const lista = document.getElementById('lista-prod-modal')
  if (!lista) return
  if (!q || q.length < 2) {
    lista.innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
    cerrarDropdownProductos()
    return
  }
  lista.innerHTML = '<p class="muted-hint">Buscando...</p>'
  abrirDropdownProductos()
  try {
    // FIX: Búsqueda global — NO enviar proveedorId para mostrar todo el catálogo
    const params = new URLSearchParams({ buscar: q, limit: 100 })
    const data = await apiFetch(`/productos?${params}`)
    const prods = data.data || data
    if (!prods?.length) { lista.innerHTML = '<p class="muted-hint">Sin resultados</p>'; abrirDropdownProductos(); return }
    window._prodCache = {}
    prods.forEach(p => { window._prodCache[p.id] = p })
    lista.innerHTML = prods.map(p => {
      const codigo = p.codigoInterno || p.codigoBarras || '—'
      return `
      <div class="prod-item-modal" onclick="window._addProdComp(${p.id})">
        <span class="prod-codigo">${codigo}</span>
        <span class="prod-nombre">${p.nombre}</span>
        <span class="prod-precio">${fmt(p.costo || p.costoPromedio || 0)}</span>
      </div>`
    }).join('')
  } catch (err) { lista.innerHTML = `<p class="muted-hint" style="color:#f44336">Error</p>`; abrirDropdownProductos() }
}
window._addProdComp = id => {
  const p = window._prodCache?.[id]
  if (!p) return
  agregarProductoEdicion(p)
  document.getElementById('search-prod-modal').value = ''
  document.getElementById('lista-prod-modal').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
  cerrarDropdownProductos()
}

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

  const precioProveedor = sinIva > 0 ? parseFloat((sinIva * IVA_FACTOR).toFixed(2)) : 0

  if (display) display.value = precioProveedor > 0 ? precioProveedor : ''
  if (inputCosto) inputCosto.value = precioProveedor > 0 ? precioProveedor : ''

  prCalcularMargen()
}

// Precio Base = Precio Venta / 1.16
function prCalcularPrecioBase() {
  const pv = parseFloat(document.getElementById('pr-pventa')?.value) || 0
  const pbInput = document.getElementById('pr-precioBase')
  if (!pbInput) return
  pbInput.value = pv > 0 ? (pv / IVA_FACTOR).toFixed(2) : ''
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
  const sinIvaPrecarga = (c.costoSinIva && c.costoSinIva > 0)
    ? c.costoSinIva
    : (esB ? parseFloat(det?.Producto?.costoSinIvaProveedor || 0) : 0)
  document.getElementById('sp-costoSinIva').value = sinIvaPrecarga > 0 ? sinIvaPrecarga.toFixed(2) : ''

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
  if (pb) pb.value = pv > 0 ? (pv / IVA_FACTOR).toFixed(2) : ''
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
  const conIva = sinIva > 0 ? +(sinIva * IVA_FACTOR).toFixed(2) : 0
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
  renderFacturaViva()
  recCerrarPanel()
}

// Recalcula subtotal por línea y total/saldo estimado ANTES de confirmar.
// Usa cantidadPedida como base (igual que el backend en /recibir).
// Líneas para la factura viva y el PDF. Cantidad = PEDIDA (decisión de negocio:
// la factura siempre representa la orden completa al costo capturado).
//  - efectivoConIva: costo unitario que va a la deuda/total (incluye IVA si es desglose)
//  - unit: P. Unitario mostrado en la factura (SIN IVA en desglose, final en neto)
function _mgColor(m) { return m < 10 ? '#f87171' : m < 25 ? '#ffc107' : '#60d080' }

// Desglosa un costo CON IVA en sin-IVA + IVA. Resta para que siempre cuadre.
function _desgloseLinea(precioCostoConIva) {
  const conIva = parseFloat(precioCostoConIva) || 0
  const sIva   = parseFloat((conIva / IVA_FACTOR).toFixed(2))
  const iva    = parseFloat((conIva - sIva).toFixed(2))
  return { sIva, iva, conIva }
}

// Datos por línea (lee del caché _preciosCache; cantidad = PEDIDA).
//  efectivoConIva: costo unitario con IVA (base de la deuda y del margen)
//  unit: P. Unitario mostrado (SIN IVA en desglose, final en neto)
//  pventa / margen: precio de venta y margen calculados sobre costo con IVA
function _facturaLineas() {
  if (!ocActual) return { lineas: [], esB: false }
  // En recepción el tipo viene del radio; en lectura no se confía en el radio (muestra costo final)
  const esB = ocActual._recibiendo ? !!document.getElementById('rec-radio-b')?.checked : false
  let i = 0
  const lineas = (ocActual.DetalleOrdenCompra || []).map(d => {
    const cant = parseFloat(d.cantidadPedida)
    const c = _preciosCache[d.id]
    const efectivo = (c && c.precioCosto > 0) ? c.precioCosto : parseFloat(d.precioCosto)
    // En recepción el tipo es el global (radio); en lectura, el guardado por línea
    const lineDesglose = ocActual._recibiendo ? esB : (d.facturaDesglosada === true)
    const unit = lineDesglose
      ? ((c && c.costoSinIva > 0) ? c.costoSinIva : parseFloat((efectivo / IVA_FACTOR).toFixed(4)))
      : efectivo
    const importe = parseFloat((unit * cant).toFixed(2))
    const pventa  = (c && c.precioVenta > 0) ? c.precioVenta : parseFloat(d.Producto?.precioVenta || 0)
    const margen  = efectivo > 0 ? ((pventa - efectivo) / efectivo * 100) : 0
    return {
      id: d.id, linea: ++i,
      nombre: d.Producto?.nombre || '—',
      codigo: d.Producto?.codigoInterno || '—',
      um: d.Producto?.unidadCompra || 'pza',
      cant, unit, importe, pventa, margen,
      efectivoConIva: parseFloat((efectivo * cant).toFixed(2))
    }
  })
  return { lineas, esB }
}

// Asegura una entrada de caché por línea (semilla con valores actuales del producto)
function _seedCache() {
  const esB = !!document.getElementById('rec-radio-b')?.checked
  ;(ocActual?.DetalleOrdenCompra || []).forEach(d => {
    if (!_preciosCache[d.id]) {
      _preciosCache[d.id] = {
        precioCosto: parseFloat(d.precioCosto) || 0,
        precioVenta: parseFloat(d.Producto?.precioVenta || 0) || 0,
        costoSinIva: esB ? (parseFloat(d.Producto?.costoSinIvaProveedor || 0) || null) : null
      }
    }
  })
}

// Build completo de la tabla-factura (inputs). Solo al entrar a recepción,
// al cambiar tipo de factura o al guardar desde el modal.
window.renderFacturaViva = function() {
  const cont = document.getElementById('factura-viva')
  if (!cont) return
  if (!ocActual || !ocActual._recibiendo) { cont.style.display = 'none'; return }
  _seedCache()
  const { lineas, esB } = _facturaLineas()
  const tbody = document.getElementById('factura-viva-tbody')
  if (tbody) tbody.innerHTML = lineas.map(l => `
    <tr>
      <td>${l.linea}</td>
      <td>${l.cant}<div class="fv-um">${l.um}</div></td>
      <td>${l.codigo}</td>
      <td><div class="fv-desc" title="${(l.nombre || '').replace(/"/g, '&quot;')}">${l.nombre}</div></td>
      <td class="fv-edit" style="text-align:right">
        <input class="fv-input" id="fv-cost-${l.id}" type="number" step="0.01" min="0" value="${l.unit.toFixed(2)}" oninput="facOnCost(${l.id})">
        <div class="fv-ivahint" id="fv-ivah-${l.id}" style="display:${esB ? 'block' : 'none'}">${esB ? 'c/IVA ' + fmt(l.efectivoConIva / l.cant) : ''}</div>
      </td>
      <td class="fv-edit" style="text-align:right"><input class="fv-input" id="fv-pv-${l.id}" type="number" step="0.01" min="0" value="${l.pventa > 0 ? l.pventa.toFixed(2) : ''}" oninput="facOnPV(${l.id})"></td>
      <td class="fv-edit" style="text-align:right"><input class="fv-input" id="fv-mg-${l.id}" type="number" step="0.1" style="width:58px" value="${l.margen.toFixed(1)}" oninput="facOnMG(${l.id})"><span style="color:var(--muted)">%</span></td>
      <td style="text-align:right" class="num" id="fv-imp-${l.id}">${fmt(l.importe)}</td>
    </tr>`).join('')
  lineas.forEach(l => { const mg = document.getElementById('fv-mg-' + l.id); if (mg) mg.style.color = _mgColor(l.margen) })
  cont.style.display = ''
  recRecalcularResumen()
}

function _det(id) { return (ocActual?.DetalleOrdenCompra || []).find(d => d.id === id) }

// Edita COSTO (P. Unitario). En desglose lo capturado es sin IVA.
window.facOnCost = function(id) {
  const esB = !!document.getElementById('rec-radio-b')?.checked
  const raw = parseFloat(document.getElementById('fv-cost-' + id).value) || 0
  const precioCosto = esB ? parseFloat((raw * IVA_FACTOR).toFixed(2)) : raw
  const c = _preciosCache[id] || {}
  _preciosCache[id] = { precioCosto, precioVenta: c.precioVenta || 0, costoSinIva: esB ? (raw || null) : null }
  const margen = precioCosto > 0 ? ((_preciosCache[id].precioVenta - precioCosto) / precioCosto * 100) : 0
  const mg = document.getElementById('fv-mg-' + id); if (mg) { mg.value = margen.toFixed(1); mg.style.color = _mgColor(margen) }
  const d = _det(id)
  const imp = document.getElementById('fv-imp-' + id); if (imp && d) imp.textContent = fmt(raw * parseFloat(d.cantidadPedida))
  const ih = document.getElementById('fv-ivah-' + id); if (ih) { ih.style.display = esB ? 'block' : 'none'; ih.textContent = esB ? 'c/IVA ' + fmt(precioCosto) : '' }
  const sc = document.getElementById('sumcosto-' + id); if (sc) sc.textContent = fmt(precioCosto)
  recRecalcularResumen()
}

// Edita P. VENTA → recalcula margen
window.facOnPV = function(id) {
  const pv = parseFloat(document.getElementById('fv-pv-' + id).value) || 0
  const c = _preciosCache[id] || {}
  _preciosCache[id] = { precioCosto: c.precioCosto || 0, precioVenta: pv, costoSinIva: c.costoSinIva || null }
  const margen = c.precioCosto > 0 ? ((pv - c.precioCosto) / c.precioCosto * 100) : 0
  const mg = document.getElementById('fv-mg-' + id); if (mg) { mg.value = margen.toFixed(1); mg.style.color = _mgColor(margen) }
  const sp = document.getElementById('sumpv-' + id); if (sp) sp.textContent = pv > 0 ? fmt(pv) : '—'
  recRecalcularResumen()
}

// Edita % MARGEN → recalcula P. Venta
window.facOnMG = function(id) {
  const m = parseFloat(document.getElementById('fv-mg-' + id).value) || 0
  const c = _preciosCache[id] || {}
  const costo = c.precioCosto || 0
  const pv = parseFloat((costo * (1 + m / 100)).toFixed(2))
  _preciosCache[id] = { precioCosto: costo, precioVenta: pv, costoSinIva: c.costoSinIva || null }
  const pvEl = document.getElementById('fv-pv-' + id); if (pvEl) pvEl.value = pv > 0 ? pv.toFixed(2) : ''
  const mg = document.getElementById('fv-mg-' + id); if (mg) mg.style.color = _mgColor(m)
  const sp = document.getElementById('sumpv-' + id); if (sp) sp.textContent = pv > 0 ? fmt(pv) : '—'
  recRecalcularResumen()
}

// Actualiza la línea "cajas × factor = piezas al inventario" en vivo mientras
// el usuario teclea. Lee factor y unidad de venta de los data-attrs del input
// (ya resueltos con precedencia snapshot ?? producto vivo ?? 1). Solo aplica a
// productos con factor > 1; en 1:1 el span no existe y sale silencioso.
window.recEquivalente = function(id) {
  const input = document.getElementById('rec-' + id)
  const valEl = document.getElementById('piezas-val-' + id)
  if (!input || !valEl) return
  const factor = parseFloat(input.dataset.factor) || 1
  const uv     = input.dataset.uv || 'pza'
  const v      = parseFloat(input.value) || 0
  if (factor > 1 && v > 0) {
    valEl.textContent = parseFloat((v * factor).toFixed(3)) + ' ' + uv
    valEl.style.color = '#60d080'
  } else {
    valEl.textContent = '—'
    valEl.style.color = 'var(--muted)'
  }
}

window.recRecalcularResumen = function() {
  if (!ocActual || !ocActual._recibiendo) return
  const { lineas, esB } = _facturaLineas()
  let nuevoTotal = 0
  lineas.forEach(l => {
    nuevoTotal += l.efectivoConIva
    const cel = document.getElementById('subtot-' + l.id)
    if (cel) cel.textContent = fmt(l.efectivoConIva)
  })
  nuevoTotal = parseFloat(nuevoTotal.toFixed(2))

  // Pie de la factura (subtotal/IVA/total) — sin reconstruir los inputs
  const subtotalF = parseFloat(lineas.reduce((s, l) => s + l.importe, 0).toFixed(2))
  const ivaF      = parseFloat((nuevoTotal - subtotalF).toFixed(2))
  const tot = document.getElementById('factura-viva-totales')
  if (tot) {
    let rows = `<div class="rec-res-row"><span>Subtotal</span><span>${fmt(subtotalF)}</span></div>`
    if (esB) rows += `<div class="rec-res-row"><span>IVA (${Math.round((IVA_FACTOR - 1) * 100)}%)</span><span>${fmt(ivaF)}</span></div>`
    rows += `<div class="rec-res-row rec-res-nuevo"><span>Total factura</span><span>${fmt(nuevoTotal)}</span></div>`
    tot.innerHTML = rows
  }
}

// Comprobante de recepción imprimible / descargable (PDF vía window.print).
// Reusa el patrón y estilo de cotizaciones.js. Usa cantidad PEDIDA, así el total
// de la factura coincide con el nuevo total/deuda de la orden.
window.generarComprobanteRecepcion = function() {
  if (!ocActual) return
  const oc  = ocActual
  const LOGO_URL = window.__JESHA_LOGO_URL__ || ''

  const { lineas: facLineas } = _facturaLineas()
  if (!facLineas.length) { jeshaToast('La orden no tiene productos', 'warning'); return }

  const filas = facLineas.map(l => {
    const det = (oc.DetalleOrdenCompra || []).find(d => d.id === l.id)
    let sub = ''
    if (det?.facturaDesglosada === true) {
      const dg = _desgloseLinea(det.precioCosto)
      sub = `<div class="pdf-desglose-linea">${fmt(dg.sIva)} + IVA ${fmt(dg.iva)} = ${fmt(dg.conIva)}</div>`
    }
    return `
      <tr>
        <td style="text-align:center">${l.linea}</td>
        <td style="text-align:center">${l.cant} ${l.um}</td>
        <td>${l.codigo}</td>
        <td>${l.nombre}${sub}</td>
        <td style="text-align:right">${fmt(l.unit)}</td>
        <td style="text-align:right"><strong>${fmt(l.importe)}</strong></td>
      </tr>`
  }).join('')

  const subtotal = parseFloat(facLineas.reduce((s, l) => s + l.importe, 0).toFixed(2))
  const total    = parseFloat(facLineas.reduce((s, l) => s + l.efectivoConIva, 0).toFixed(2))
  const iva      = parseFloat((total - subtotal).toFixed(2))
  const hayDesglose = iva > 0.005
  const tipoLabel = hayDesglose ? 'Precio con desglose de IVA' : 'Precio neto final'
  let resumenHtml
  if (hayDesglose) {
    resumenHtml = `
      <div class="resumen-row"><span>Subtotal:</span><span>${fmt(subtotal)}</span></div>
      <div class="resumen-row"><span>IVA (${Math.round((IVA_FACTOR - 1) * 100)}%):</span><span>${fmt(iva)}</span></div>
      <div class="resumen-row total"><span>Total:</span><span>${fmt(total)}</span></div>`
  } else {
    resumenHtml = `<div class="resumen-row total"><span>Total:</span><span>${fmt(total)}</span></div>`
  }

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><title>Recepción ${oc.folio}</title>
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
  .pdf-desglose-linea { font-size:10px; color:#777; margin-top:2px; }
  .resumen-box { display:flex; flex-direction:column; align-items:flex-end; gap:4px; margin-top:8px; }
  .resumen-row { display:flex; gap:20px; min-width:280px; justify-content:space-between; font-size:12px; color:#555; }
  .resumen-row span:last-child { font-weight:600; color:#222; }
  .resumen-row.total { border-top:1px solid #ccc; padding-top:6px; margin-top:4px; font-size:14px; font-weight:700; color:#1f3a66; }
  .resumen-row.total span:last-child { color:#1f3a66; font-size:16px; }
  .deuda-box { margin-top:18px; background:#f7f8fa; border:1px solid #e3e6ec; border-radius:6px; padding:12px 14px; font-size:11px; }
  .deuda-row { display:flex; justify-content:space-between; padding:3px 0; color:#555; }
  .deuda-row strong { color:#1f3a66; }
  .footer { margin-top:24px; border-top:1px solid #ddd; padding-top:12px; font-size:10px; color:#888; text-align:center; }
  @media print { body { padding:14px; } }
</style></head><body>
  <div class="header">
    <div class="empresa">
      ${LOGO_URL ? `<img src="${LOGO_URL}" alt="JESHA" style="height:60px;width:auto;display:block;margin-bottom:4px;" />` : `<div style="font-size:18px;font-weight:700;color:#1f3a66">FERRETERÍA E ILUMINACIÓN JESHA</div>`}
      <p>Av. Vialidad San Simón 3, La Toma de Zacatecas, C.P. 98660</p>
      <p>Guadalupe, Zacatecas · Tel: 492 101 6879 · jeshadelgado544@gmail.com</p>
    </div>
    <div class="folio-box">
      <div class="folio">${oc.folio}</div>
      <p>Fecha: ${fmtFecha(new Date())}</p>
      <p style="margin-top:4px;font-size:11px;color:#888">Comprobante de recepción</p>
    </div>
  </div>

  <div class="meta">
    <p><strong>Proveedor:</strong> ${oc.Proveedor?.nombreOficial || '—'}</p>
    <p><strong>Teléfono:</strong> ${oc.Proveedor?.celular || oc.Proveedor?.telefono || '—'}</p>
    <p><strong>Recibió:</strong> ${USUARIO?.nombre || oc.Usuario?.nombre || '—'}</p>
    <p><strong>Sucursal:</strong> ${oc.Sucursal?.nombre || '—'}</p>
    <p style="grid-column:1/-1"><strong>Tipo de factura:</strong> ${tipoLabel}</p>
  </div>

  <table>
    <thead><tr>
      <th style="width:40px;text-align:center">Línea</th>
      <th style="width:70px;text-align:center">Cant</th>
      <th style="width:90px">Código</th>
      <th>Descripción</th>
      <th style="width:90px;text-align:right">P. Unitario</th>
      <th style="width:100px;text-align:right">Importe</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>

  <div class="resumen-box">${resumenHtml}</div>

  <div class="footer">
    <p>Documento interno de recepción — comparar contra la factura del proveedor · Ferretería e Iluminación JESHA</p>
  </div>
</body></html>`

  const ventana = window.open('', '_blank')
  if (!ventana) { jeshaToast('Permite las ventanas emergentes para generar el PDF', 'warning'); return }
  ventana.document.write(html)
  ventana.document.close()
  ventana.onload = () => ventana.print()
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
  renderFacturaViva()
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
  const precioBase = pventa > 0 ? parseFloat((pventa / IVA_FACTOR).toFixed(2)) : 0

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
  document.getElementById('search-prod-modal')?.addEventListener('keydown', e => {
    const lista = document.getElementById('lista-prod-modal')
    const abierto = lista?.classList.contains('is-open')
    if (e.key === 'Escape' && abierto) {
      e.preventDefault()
      e.stopPropagation()
      cerrarDropdownProductos()
      return
    }
    if (e.key === 'Enter' && abierto) {
      const primero = lista.querySelector('.prod-item-modal')
      if (primero) {
        e.preventDefault()
        primero.click()
      }
    }
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
      cerrarDropdownProductos()
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
    if (!e.target.closest('#search-prod-modal') &&
        !e.target.closest('#lista-prod-modal'))
      cerrarDropdownProductos()
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
      const listaProd = document.getElementById('lista-prod-modal')
      if (listaProd?.classList.contains('is-open')) {
        cerrarDropdownProductos()
        return
      }
      document.getElementById('modal-crear')?.classList.remove('active')
      document.getElementById('modal-detalle')?.classList.remove('active')
      document.getElementById('modal-prov')?.classList.remove('active')
      document.getElementById('modal-prod-rapido')?.classList.remove('active')
      cerrarDDProv()
    }
  })
})
console.log('✅ compras.js cargado')