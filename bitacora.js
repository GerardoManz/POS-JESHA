// ════════════════════════════════════════════════════════════════════
//  BITACORA.JS — Frontend Fase 4
//  Maneja dos orígenes: VENTA (desde POS) y MANUAL (creadas aquí)
// ════════════════════════════════════════════════════════════════════

// ── Estado global ──
let bitacoraActual     = null
let turnoActual        = null    // { id, abierto, abiertaEn, ... }
let todasBitacoras     = []
let productosCache     = []
let clientesCache      = []
let productoSeleccionado = null
let paginaActual       = 1
const LIMIT = 25

const usuario  = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const esSUPER  = usuario.rol === 'SUPERADMIN'

// ════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════
function formatMoney(n) {
  return '$' + parseFloat(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatFecha(iso, corto = false) {
  if (!iso) return '—'
  const d = new Date(iso)
  return corto
    ? d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
    : d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function toast(msg, tipo = 'info') {
  if (typeof jeshaToast === 'function') return jeshaToast(msg, tipo)
  alert(msg)
}

function badgeEstado(estado) {
  const nombres = { ABIERTA: 'Abierta', PAUSADA: 'Pausada', CERRADA_VENTA: 'Pagada', CERRADA_INTERNA: 'Cerrada interna' }
  return `<span class="bit-estado-badge ${estado.toLowerCase()}">${nombres[estado] || estado}</span>`
}

function badgeOrigen(origen) {
  if (origen === 'VENTA')  return `<span class="bit-origen-badge origen-venta">🛒 POS</span>`
  if (origen === 'MANUAL') return `<span class="bit-origen-badge origen-manual">📝 Manual</span>`
  return ''
}

function claseSaldo(saldo) {
  const n = parseFloat(saldo)
  if (n > 0)  return 'saldo-neg'
  if (n < 0)  return 'saldo-ok'
  return 'saldo-zer'
}

// ════════════════════════════════════════════════════════════════════
//  TURNO DE CAJA
// ════════════════════════════════════════════════════════════════════
async function cargarTurnoActivo() {
  try {
    const res = await apiFetch('/turnos-caja/activo', { method: 'GET' })
    turnoActual = res?.data || null
  } catch (e) {
    // 404 = sin turno abierto, es normal
    turnoActual = null
  }
  actualizarIndicadorTurno()
}

function actualizarIndicadorTurno() {
  const chip   = document.getElementById('info-turno')
  const icon   = document.getElementById('info-turno-icon')
  const texto  = document.getElementById('info-turno-texto')
  if (!chip) return
  chip.classList.remove('info-turno-loading', 'info-turno-abierto', 'info-turno-cerrado')
  if (turnoActual?.id && turnoActual.abierto) {
    chip.classList.add('info-turno-abierto')
    icon.textContent  = '✅'
    texto.textContent = `Turno #${turnoActual.id} abierto`
  } else {
    chip.classList.add('info-turno-cerrado')
    icon.textContent  = '⚠️'
    texto.textContent = 'Sin turno abierto'
  }
}

// ════════════════════════════════════════════════════════════════════
//  LISTADO PRINCIPAL
// ════════════════════════════════════════════════════════════════════
async function cargarBitacoras(pagina = 1) {
  const tbody = document.getElementById('bit-tbody')
  tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><div class="spinner"></div><p>Cargando...</p></td></tr>`

  const buscar = document.getElementById('search-input').value.trim()
  const estado = document.getElementById('filtro-estado').value
  const origen = document.getElementById('filtro-origen').value
  const cli    = document.getElementById('filtro-cliente').value

  const params = new URLSearchParams({ page: pagina, limit: LIMIT })
  if (buscar) params.append('buscar',    buscar)
  if (estado) params.append('estado',    estado)
  if (origen) params.append('origen',    origen)
  if (cli)    params.append('clienteId', cli)

  try {
    const res = await apiFetch(`/bitacoras?${params}`, { method: 'GET' })
    todasBitacoras = res.data || []
    renderTabla(todasBitacoras)
    renderPaginacion(res.total || 0, pagina)
    paginaActual = pagina
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p style="color:#ff6b6b;">Error: ${e.message}</p></td></tr>`
  }
}

function renderTabla(bitacoras) {
  const tbody = document.getElementById('bit-tbody')
  if (!bitacoras.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><p>Sin bitácoras</p></td></tr>`
    return
  }
  tbody.innerHTML = bitacoras.map(b => {
    const cli   = b.cliente?.nombre || '—'
    const titCli = b.titulo ? `<strong>${b.titulo}</strong><br><small style="color:var(--muted);">${cli}</small>` : cli
    return `
      <tr data-id="${b.id}">
        <td><strong>${b.folio}</strong></td>
        <td>${badgeOrigen(b.origen)}</td>
        <td>${titCli}</td>
        <td>${formatMoney(b.totalMateriales)}</td>
        <td class="saldo-ok">${formatMoney(b.totalAbonado)}</td>
        <td class="${claseSaldo(b.saldoPendiente)}">${formatMoney(b.saldoPendiente)}</td>
        <td>${badgeEstado(b.estado)}</td>
        <td style="white-space:nowrap;text-align:center;color:var(--muted);font-size:0.78rem;">${formatFecha(b.creadaEn, true)}</td>
      </tr>`
  }).join('')
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => abrirDetalle(parseInt(tr.dataset.id)))
  })
}

function renderPaginacion(total, pagina) {
  const pag = document.getElementById('pagination')
  if (total <= LIMIT) { pag.style.display = 'none'; return }
  pag.style.display = 'flex'
  const totalPags = Math.ceil(total / LIMIT)
  document.getElementById('pag-info').textContent = `Página ${pagina} de ${totalPags} (${total} registros)`
  document.getElementById('btn-prev').disabled = pagina === 1
  document.getElementById('btn-next').disabled = pagina >= totalPags
}

// ════════════════════════════════════════════════════════════════════
//  DETALLE
// ════════════════════════════════════════════════════════════════════
async function abrirDetalle(id) {
  try {
    const res = await apiFetch(`/bitacoras/${id}`, { method: 'GET' })
    bitacoraActual = res.data
    renderDetalle()
    document.getElementById('modal-detalle').classList.add('active')
  } catch (e) {
    toast('Error al cargar bitácora: ' + e.message, 'error')
  }
}

function cerrarDetalle() {
  document.getElementById('modal-detalle').classList.remove('active')
  bitacoraActual        = null
  productoSeleccionado  = null
  document.getElementById('buscador-prod-panel').style.display = 'none'
  document.getElementById('form-cantidad-prod').style.display  = 'none'
}

function renderDetalle() {
  const b = bitacoraActual
  if (!b) return

  // Header
  document.getElementById('det-folio').textContent          = b.folio
  document.getElementById('det-origen-badge').innerHTML     = badgeOrigen(b.origen)
  document.getElementById('det-estado-badge').outerHTML     = `<span id="det-estado-badge" class="bit-estado-badge ${b.estado.toLowerCase()}">${badgeEstado(b.estado).match(/>([^<]+)</)[1]}</span>`
  document.getElementById('det-titulo-header').textContent  = b.titulo || ''

  // Info
  document.getElementById('det-cliente').textContent   = b.cliente?.nombre   || '—'
  document.getElementById('det-telefono').textContent  = b.cliente?.telefono || '—'
  document.getElementById('det-fecha').textContent     = formatFecha(b.creadaEn)
  document.getElementById('det-usuario').textContent   = b.usuario?.nombre   || '—'

  const descP = document.getElementById('det-descripcion')
  if (b.descripcion) { descP.textContent = b.descripcion; descP.style.display = 'block' }
  else descP.style.display = 'none'

  const notasP = document.getElementById('det-notas-p')
  if (b.notas) { notasP.textContent = b.notas; notasP.style.display = 'block' }
  else notasP.style.display = 'none'

  // Financiero
  document.getElementById('fin-materiales').textContent = formatMoney(b.totalMateriales)
  document.getElementById('fin-abonado').textContent    = formatMoney(b.totalAbonado)
  document.getElementById('fin-saldo').textContent      = formatMoney(b.saldoPendiente)

  // Crédito del cliente
  const cardCredito = document.getElementById('card-credito-cliente')
  if (b.cliente) {
    cardCredito.style.display = 'block'
    const limite      = parseFloat(b.cliente.limiteCredito || 0)
    const saldoTotal  = parseFloat(b.cliente.saldoPendiente || 0)
    const disponible  = limite - saldoTotal
    document.getElementById('cred-limite').textContent     = formatMoney(limite)
    document.getElementById('cred-usado').textContent      = formatMoney(saldoTotal)
    document.getElementById('cred-disponible').textContent = formatMoney(disponible)
  } else {
    cardCredito.style.display = 'none'
  }

  // Productos (tabla materiales)
  renderDetalleItems(b.detalles || [])

  // Abonos
  renderAbonos(b.abonos || [])

  // Botón agregar producto — SOLO si origen MANUAL y estado ABIERTA
  const btnAgregar   = document.getElementById('btn-agregar-prod')
  const avisoVenta   = document.getElementById('aviso-origen-venta')
  const esManual     = b.origen === 'MANUAL'
  const esEditable   = b.estado === 'ABIERTA'
  if (esManual && esEditable) {
    btnAgregar.style.display = 'inline-flex'
    avisoVenta.style.display = 'none'
  } else {
    btnAgregar.style.display = 'none'
    avisoVenta.style.display = (b.origen === 'VENTA') ? 'block' : 'none'
  }

  // Abono — deshabilitar si no hay turno o estado no ABIERTA
  const btnAbonar   = document.getElementById('btn-abonar')
  const avisoTurno  = document.getElementById('aviso-sin-turno')
  const cardAbono   = document.getElementById('card-abono')
  if (!esEditable) {
    cardAbono.style.display = 'none'
  } else {
    cardAbono.style.display = 'block'
    if (!turnoActual?.abierto) {
      btnAbonar.disabled  = true
      btnAbonar.style.opacity = '0.5'
      btnAbonar.style.cursor  = 'not-allowed'
      avisoTurno.style.display = 'block'
    } else {
      btnAbonar.disabled  = false
      btnAbonar.style.opacity = '1'
      btnAbonar.style.cursor  = 'pointer'
      avisoTurno.style.display = 'none'
    }
  }

  // Acciones (botones de cierre/reapertura)
  renderAcciones()
}

function renderDetalleItems(detalles) {
  const tbody = document.getElementById('det-items-tbody')
  if (!detalles.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell"><p>Sin materiales aún</p></td></tr>`
    return
  }
  const b = bitacoraActual
  const editable = b.origen === 'MANUAL' && b.estado === 'ABIERTA'
  tbody.innerHTML = detalles.map(d => {
    const nombre   = d.producto?.nombre || '—'
    const unidad   = d.producto?.unidadVenta || 'pz'
    const cantidad = parseFloat(d.cantidad)
    const todoDevuelto = cantidad <= 0.001
    const filaStyle = todoDevuelto
      ? 'opacity:0.45;text-decoration:line-through;'
      : ''
    const sufijoNombre = todoDevuelto
      ? ' <small style="color:#ff9999;text-decoration:none;display:inline-block;">(devuelto)</small>'
      : ''

    const origen = d.venta
      ? `<small style="color:var(--muted);">VTA: ${d.venta.folio}</small>`
      : (d.inventarioDescontado
          ? '<small style="color:#60d080;">Descontado</small>'
          : '<small style="color:#ff9999;">⚠️ sin stock</small>')

    // Celdas editables solo si la bitácora es MANUAL y está ABIERTA
    const celdaCantidad = (editable && !todoDevuelto)
      ? `<td class="celda-editable" data-detid="${d.id}" data-campo="cantidad" data-original="${cantidad}" title="Click para editar">${cantidad.toLocaleString('es-MX')} <span class="edit-icon">✎</span></td>`
      : `<td>${cantidad.toLocaleString('es-MX')}</td>`

    const celdaPrecio = (editable && !todoDevuelto)
      ? `<td class="celda-editable" data-detid="${d.id}" data-campo="precioUnitario" data-original="${d.precioUnitario}" title="Click para editar">${formatMoney(d.precioUnitario)} <span class="edit-icon">✎</span></td>`
      : `<td>${formatMoney(d.precioUnitario)}</td>`

    const btnQuitar = (editable && !todoDevuelto)
      ? `<button class="btn-quitar-prod" data-detid="${d.id}" title="Quitar línea completa y reintegrar stock">✕</button>`
      : ''

    return `
      <tr style="${filaStyle}">
        <td>${nombre}${sufijoNombre}</td>
        <td>${unidad}</td>
        ${celdaCantidad}
        ${celdaPrecio}
        <td><strong>${formatMoney(d.subtotal)}</strong></td>
        <td>${origen}</td>
        <td>${btnQuitar}</td>
      </tr>`
  }).join('')

  // Conectar eventos de quitar
  tbody.querySelectorAll('.btn-quitar-prod').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      quitarProducto(parseInt(btn.dataset.detid))
    })
  })

  // Conectar eventos de edición inline
  tbody.querySelectorAll('.celda-editable').forEach(td => {
    td.addEventListener('click', () => activarEdicionCelda(td))
  })
}

// ── Edición inline de cantidad / precio ──
function activarEdicionCelda(td) {
  if (td.querySelector('input')) return  // ya está activa
  const detid    = parseInt(td.dataset.detid)
  const campo    = td.dataset.campo
  const original = parseFloat(td.dataset.original)

  const inp = document.createElement('input')
  inp.type  = 'number'
  inp.step  = campo === 'cantidad' ? '0.001' : '0.01'
  inp.min   = '0'
  inp.value = original
  inp.style.cssText = 'width:80px;padding:4px 8px;background:rgba(255,255,255,0.08);border:1px solid var(--accent);border-radius:5px;color:var(--text);font-family:inherit;font-size:0.875rem;'

  td.innerHTML = ''
  td.appendChild(inp)
  inp.focus()
  inp.select()

  const guardar = async () => {
    const nuevo = parseFloat(inp.value)
    if (isNaN(nuevo) || nuevo < 0) {
      toast('Valor inválido', 'warning')
      renderDetalle()
      return
    }
    if (nuevo === original) {
      renderDetalle()
      return
    }
    await editarDetalleBitacora(detid, campo, nuevo)
  }

  inp.addEventListener('blur', guardar)
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); inp.blur() }
    if (ev.key === 'Escape') { ev.preventDefault(); renderDetalle() }
  })
}

async function editarDetalleBitacora(detalleId, campo, nuevoValor) {
  try {
    const body = { [campo]: nuevoValor }
    const res = await apiFetch(`/bitacoras/${bitacoraActual.id}/productos/${detalleId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
    if (res?.stockInsuficiente) toast(res.mensaje || 'Aplicado con stock insuficiente', 'warning')
    else toast('Cambio guardado', 'success')
    bitacoraActual = res.data
    renderDetalle()
    cargarBitacoras(paginaActual)
  } catch (e) {
    toast('Error: ' + e.message, 'error')
    renderDetalle()
  }
}

function renderAbonos(abonos) {
  const cont = document.getElementById('lista-abonos')
  if (!abonos.length) { cont.innerHTML = '<p class="muted-hint">Sin abonos registrados</p>'; return }
  cont.innerHTML = abonos.map(a => `
    <div class="abono-item">
      <div style="flex:1;">
        <div class="abono-monto">+ ${formatMoney(a.monto)}</div>
        <div class="abono-meta">${a.metodoPago} • ${formatFecha(a.creadoEn, true)} • ${a.usuario?.nombre || ''}</div>
        ${a.notas ? `<div class="abono-meta" style="margin-top:3px;">${a.notas}</div>` : ''}
      </div>
      <button class="btn-reimprimir" data-abono-id="${a.id}" title="Reimprimir comprobante">🖨️</button>
    </div>`).join('')
  cont.querySelectorAll('.btn-reimprimir').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      abrirTicketAbono(parseInt(btn.dataset.abonoId))
    })
  })
}

function renderAcciones() {
  const cont = document.getElementById('det-acciones')
  const b = bitacoraActual
  const acciones = []

  // ABIERTA o PAUSADA → botón "Cerrar manualmente"
  if (b.estado === 'ABIERTA' || b.estado === 'PAUSADA') {
    acciones.push(`<button class="btn-danger" id="btn-abrir-cierre">🔒 Cerrar manualmente</button>`)
  }

  // Cerradas → botón "Reabrir" (solo SUPERADMIN dentro de 30 días)
  if (['CERRADA_VENTA', 'CERRADA_INTERNA'].includes(b.estado) && esSUPER) {
    const diasDesdeCierre = b.cerradaEn
      ? (Date.now() - new Date(b.cerradaEn).getTime()) / 86400000
      : 999
    if (diasDesdeCierre <= 30) {
      acciones.push(`<button class="btn-warning" id="btn-abrir-reapertura">🔓 Reabrir bitácora</button>`)
    } else {
      acciones.push(`<button class="btn-warning" disabled style="opacity:0.4;cursor:not-allowed;" title="Han pasado más de 30 días desde el cierre">🔓 Ventana de reapertura expirada</button>`)
    }
  }

  cont.innerHTML = acciones.join('')

  const btnCierre = document.getElementById('btn-abrir-cierre')
  if (btnCierre) btnCierre.addEventListener('click', abrirModalCierre)

  const btnReabrir = document.getElementById('btn-abrir-reapertura')
  if (btnReabrir) btnReabrir.addEventListener('click', abrirModalReabrir)
}

// ════════════════════════════════════════════════════════════════════
//  CREAR BITÁCORA MANUAL
// ════════════════════════════════════════════════════════════════════
function abrirModalCrear() {
  document.getElementById('bit-titulo').value        = ''
  document.getElementById('bit-descripcion').value   = ''
  document.getElementById('bit-notas').value         = ''
  document.getElementById('bit-cliente-buscar').value = ''
  document.getElementById('bit-cliente-id').value     = ''
  document.getElementById('crear-error').classList.remove('show')
  document.getElementById('modal-crear').classList.add('active')
}

function cerrarModalCrear() { document.getElementById('modal-crear').classList.remove('active') }

async function guardarNuevaBitacora() {
  const titulo      = document.getElementById('bit-titulo').value.trim()
  const descripcion = document.getElementById('bit-descripcion').value.trim()
  const notas       = document.getElementById('bit-notas').value.trim()
  const clienteId   = document.getElementById('bit-cliente-id').value || null
  const errorDiv    = document.getElementById('crear-error')
  errorDiv.classList.remove('show')

  if (!titulo) {
    errorDiv.textContent = 'El título es obligatorio'
    errorDiv.classList.add('show')
    return
  }

  const btn = document.getElementById('crear-guardar')
  btn.disabled = true; btn.textContent = 'Creando...'

  try {
    const body = { titulo }
    if (descripcion) body.descripcion = descripcion
    if (notas)       body.notas       = notas
    if (clienteId)   body.clienteId   = parseInt(clienteId)

    const res = await apiFetch('/bitacoras', { method: 'POST', body: JSON.stringify(body) })
    toast('Bitácora creada: ' + res.data.folio, 'success')
    cerrarModalCrear()
    await cargarBitacoras(1)
    abrirDetalle(res.data.id)
  } catch (e) {
    errorDiv.textContent = e.message || 'Error al crear bitácora'
    errorDiv.classList.add('show')
  } finally {
    btn.disabled = false; btn.textContent = 'Crear Bitácora'
  }
}

// ════════════════════════════════════════════════════════════════════
//  AGREGAR / QUITAR PRODUCTO (solo MANUAL)
// ════════════════════════════════════════════════════════════════════
function abrirBuscadorProducto() {
  document.getElementById('buscador-prod-panel').style.display = 'block'
  document.getElementById('form-cantidad-prod').style.display  = 'none'
  document.getElementById('search-prod-det').value             = ''
  document.getElementById('search-prod-det').focus()
  document.getElementById('lista-prod-det').innerHTML = '<p class="muted-hint">Escribe para buscar...</p>'
}

let timerBusqueda = null
async function buscarProductosDet(q) {
  if (timerBusqueda) clearTimeout(timerBusqueda)
  timerBusqueda = setTimeout(async () => {
    if (!q || q.length < 2) {
      document.getElementById('lista-prod-det').innerHTML = '<p class="muted-hint">Escribe al menos 2 caracteres...</p>'
      return
    }
    try {
      const res = await apiFetch(`/productos?buscar=${encodeURIComponent(q)}&limit=10`, { method: 'GET' })
      productosCache = res.data || []
      renderListaProductos(productosCache)
    } catch (e) {
      document.getElementById('lista-prod-det').innerHTML = `<p class="muted-hint" style="color:#ff6b6b;">Error: ${e.message}</p>`
    }
  }, 300)
}

function renderListaProductos(productos) {
  const cont = document.getElementById('lista-prod-det')
  if (!productos.length) { cont.innerHTML = '<p class="muted-hint">Sin resultados</p>'; return }
  cont.innerHTML = productos.map(p => {
    const stock = p.inventarios?.[0]?.stockActual || 0
    const stockClass = stock > 0 ? 'pi-stock-ok' : 'pi-stock-no'
    const stockText  = stock > 0 ? `${stock} disp.` : 'sin stock'
    return `
      <div class="prod-item-inline" data-prodid="${p.id}">
        <div>
          <div class="pi-nombre">${p.nombre}</div>
          <small style="color:var(--muted);font-size:0.7rem;">${p.codigoInterno || ''} • <span class="${stockClass}">${stockText}</span></small>
        </div>
        <div class="pi-precio">${formatMoney(p.precioVenta || 0)}</div>
      </div>`
  }).join('')
  cont.querySelectorAll('.prod-item-inline').forEach(it => {
    it.addEventListener('click', () => seleccionarProducto(parseInt(it.dataset.prodid)))
  })
}

function seleccionarProducto(productoId) {
  const p = productosCache.find(x => x.id === productoId)
  if (!p) return
  productoSeleccionado = p
  const stock = p.inventarios?.[0]?.stockActual || 0
  document.getElementById('prod-seleccionado-nombre').textContent = p.nombre
  document.getElementById('prod-stock-info').innerHTML =
    stock > 0
      ? `Stock disponible: <strong style="color:#60d080;">${stock} ${p.unidadVenta || 'pz'}</strong>`
      : `<strong style="color:#ff9999;">⚠️ Sin stock — se permitirá agregar pero quedará marcado</strong>`
  document.getElementById('prod-cantidad').value = '1'
  document.getElementById('prod-precio').value   = parseFloat(p.precioVenta || 0).toFixed(2)
  document.getElementById('form-cantidad-prod').style.display = 'block'
  document.getElementById('prod-cantidad').focus()
}

async function confirmarAgregarProducto() {
  const cantidad       = parseFloat(document.getElementById('prod-cantidad').value)
  const precioUnitario = parseFloat(document.getElementById('prod-precio').value)
  const errorDiv       = document.getElementById('prod-error')
  errorDiv.classList.remove('show')

  if (!cantidad || cantidad <= 0)        { errorDiv.textContent = 'Cantidad debe ser > 0'; errorDiv.classList.add('show'); return }
  if (isNaN(precioUnitario) || precioUnitario < 0) { errorDiv.textContent = 'Precio inválido';  errorDiv.classList.add('show'); return }

  const btn = document.getElementById('btn-confirmar-prod')
  btn.disabled = true; btn.textContent = 'Agregando...'

  try {
    const res = await apiFetch(`/bitacoras/${bitacoraActual.id}/productos`, {
      method: 'POST',
      body: JSON.stringify({
        productoId: productoSeleccionado.id,
        cantidad,
        precioUnitario
      })
    })
    if (res.stockInsuficiente) toast(res.mensaje, 'warning')
    else                        toast('Producto agregado', 'success')
    bitacoraActual = res.data
    renderDetalle()
    document.getElementById('buscador-prod-panel').style.display = 'none'
    cargarBitacoras(paginaActual)
  } catch (e) {
    errorDiv.textContent = e.message
    errorDiv.classList.add('show')
  } finally {
    btn.disabled = false; btn.textContent = 'Agregar'
  }
}

async function quitarProducto(detalleId) {
  const ok = await confirmarAccion('¿Quitar este producto y reintegrar el stock?')
  if (!ok) return
  try {
    const res = await apiFetch(`/bitacoras/${bitacoraActual.id}/productos/${detalleId}`, { method: 'DELETE' })
    toast('Producto eliminado', 'success')
    bitacoraActual = res.data
    renderDetalle()
    cargarBitacoras(paginaActual)
  } catch (e) {
    toast('Error: ' + e.message, 'error')
  }
}

// ════════════════════════════════════════════════════════════════════
//  ABONO (con turnoId + ticket opcional)
// ════════════════════════════════════════════════════════════════════
async function registrarAbono() {
  if (!turnoActual?.abierto) {
    toast('Debes abrir un turno de caja para registrar abonos', 'warning')
    return
  }
  const monto  = parseFloat(document.getElementById('abono-monto').value)
  const metodo = document.getElementById('abono-metodo').value
  const notas  = document.getElementById('abono-notas').value.trim()

  if (!monto || monto <= 0) { toast('Ingresa un monto válido', 'warning'); return }

  const btn = document.getElementById('btn-abonar')
  btn.disabled = true

  try {
    const res = await apiFetch(`/bitacoras/${bitacoraActual.id}/abonos`, {
      method: 'POST',
      body: JSON.stringify({ monto, metodoPago: metodo, notas, turnoId: turnoActual.id })
    })
    toast(res.mensaje || 'Abono registrado', res.cerrada ? 'success' : 'info')
    document.getElementById('abono-monto').value = ''
    document.getElementById('abono-notas').value = ''
    bitacoraActual = res.data
    renderDetalle()
    cargarBitacoras(paginaActual)

    // Preguntar si desea imprimir (modal estilizado del sistema)
    const ultimoAbono = (res.data.abonos || []).slice(-1)[0]
    if (ultimoAbono) {
      mostrarModalImprimir(monto, ultimoAbono.id)
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error')
  } finally {
    btn.disabled = false
  }
}

function abrirTicketAbono(abonoId) {
  const base = (typeof API_URL !== 'undefined' ? API_URL : window.__JESHA_API_URL__ || '').replace(/\/$/, '')
  const token = localStorage.getItem('jesha_token')
  // Ventana nueva — pasa el token como query param porque es ventana popup
  // (fetch no aplica para HTML directo)
  const url = `${base}/bitacoras/abonos/${abonoId}/ticket?token=${token}`
  window.open(url, '_blank', 'width=380,height=700')
}

// ── Modal estilizado para preguntar si imprimir ──
function mostrarModalImprimir(monto, abonoId) {
  // Crear modal si no existe
  let modal = document.getElementById('modal-imprimir')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'modal-imprimir'
    modal.className = 'modal'
    modal.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header">
          <h3>Abono registrado</h3>
          <button class="modal-close" id="imp-close">&times;</button>
        </div>
        <div style="padding:22px;text-align:center;">
          <div style="font-size:2.4rem;margin-bottom:8px;">✅</div>
          <p style="font-size:0.95rem;margin-bottom:6px;">Abono de <strong id="imp-monto" style="color:#60d080;">$0.00</strong> registrado correctamente.</p>
          <p style="font-size:0.85rem;color:var(--muted);margin-bottom:20px;">¿Deseas imprimir el comprobante?</p>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button class="btn-secondary" id="imp-cancelar">No imprimir</button>
            <button class="btn-primary" id="imp-imprimir">🖨️ Imprimir comprobante</button>
          </div>
        </div>
      </div>`
    document.body.appendChild(modal)
  }
  document.getElementById('imp-monto').textContent = formatMoney(monto)
  modal.classList.add('active')

  const cerrar = () => modal.classList.remove('active')
  document.getElementById('imp-close').onclick    = cerrar
  document.getElementById('imp-cancelar').onclick = cerrar
  document.getElementById('imp-imprimir').onclick = () => {
    cerrar()
    abrirTicketAbono(abonoId)
  }
}

// ── Modal de confirmación genérico (reemplaza confirm() nativo) ──
function confirmarAccion(mensaje, tipoBoton = 'danger') {
  return new Promise(resolve => {
    let modal = document.getElementById('modal-confirmar')
    if (!modal) {
      modal = document.createElement('div')
      modal.id = 'modal-confirmar'
      modal.className = 'modal'
      modal.innerHTML = `
        <div class="modal-content" style="max-width:400px;">
          <div class="modal-header">
            <h3>Confirmar acción</h3>
            <button class="modal-close" id="conf-close">&times;</button>
          </div>
          <div style="padding:22px;">
            <p id="conf-msg" style="font-size:0.92rem;text-align:center;margin-bottom:20px;line-height:1.5;"></p>
            <div style="display:flex;gap:10px;justify-content:center;">
              <button class="btn-secondary" id="conf-no">Cancelar</button>
              <button class="btn-danger" id="conf-si">Sí, continuar</button>
            </div>
          </div>
        </div>`
      document.body.appendChild(modal)
    }
    document.getElementById('conf-msg').textContent = mensaje
    const btnSi = document.getElementById('conf-si')
    btnSi.className = tipoBoton === 'danger' ? 'btn-danger' : 'btn-primary'
    modal.classList.add('active')

    const cerrar = (resultado) => {
      modal.classList.remove('active')
      resolve(resultado)
    }
    document.getElementById('conf-close').onclick = () => cerrar(false)
    document.getElementById('conf-no').onclick    = () => cerrar(false)
    btnSi.onclick                                  = () => cerrar(true)
  })
}

// ════════════════════════════════════════════════════════════════════
//  CIERRE MANUAL
// ════════════════════════════════════════════════════════════════════
function abrirModalCierre() {
  const b = bitacoraActual
  document.getElementById('cierre-motivo').value = ''
  document.getElementById('cierre-error').classList.remove('show')
  const saldo = parseFloat(b.saldoPendiente)
  const aviso = document.getElementById('cierre-aviso-saldo')
  if (saldo > 0 && b.clienteId) {
    aviso.innerHTML = `⚠️ Esta bitácora tiene saldo pendiente de <strong>${formatMoney(saldo)}</strong>. Al cerrarla, este monto se perdonará y se restará del saldo del cliente.`
    aviso.style.display = 'block'
  } else {
    aviso.style.display = 'none'
  }
  document.getElementById('modal-cierre').classList.add('active')
}

function cerrarModalCierre() { document.getElementById('modal-cierre').classList.remove('active') }

async function confirmarCierre() {
  const motivo = document.getElementById('cierre-motivo').value.trim()
  const errorDiv = document.getElementById('cierre-error')
  errorDiv.classList.remove('show')
  if (!motivo) {
    errorDiv.textContent = 'El motivo es obligatorio'
    errorDiv.classList.add('show')
    return
  }
  const btn = document.getElementById('cierre-confirmar')
  btn.disabled = true; btn.textContent = 'Cerrando...'
  try {
    const res = await apiFetch(`/bitacoras/${bitacoraActual.id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'CERRADA_INTERNA', motivo })
    })
    toast('Bitácora cerrada manualmente', 'success')
    cerrarModalCierre()
    bitacoraActual = res.data
    renderDetalle()
    cargarBitacoras(paginaActual)
  } catch (e) {
    errorDiv.textContent = e.message
    errorDiv.classList.add('show')
  } finally {
    btn.disabled = false; btn.textContent = 'Cerrar bitácora'
  }
}

// ════════════════════════════════════════════════════════════════════
//  REAPERTURA (solo SUPERADMIN)
// ════════════════════════════════════════════════════════════════════
function abrirModalReabrir() {
  const b = bitacoraActual
  document.getElementById('reabrir-motivo').value = ''
  document.getElementById('reabrir-error').classList.remove('show')
  const info = document.getElementById('reabrir-info')
  const saldoAlCerrar = parseFloat(b.saldoAlCerrar || 0)
  let html = `<strong>${b.folio}</strong> — cerrada el ${formatFecha(b.cerradaEn)}<br>`
  if (b.estado === 'CERRADA_INTERNA' && saldoAlCerrar > 0 && b.cliente) {
    html += `Al reabrir se restaurarán <strong>${formatMoney(saldoAlCerrar)}</strong> al saldo pendiente de <strong>${b.cliente.nombre}</strong>.`
  } else if (b.estado === 'CERRADA_VENTA') {
    html += `Esta bitácora se cerró por pago completo. Al reabrir no se modificará el saldo del cliente.`
  } else {
    html += `Al reabrir, la bitácora volverá a estado ABIERTA.`
  }
  info.innerHTML = html
  document.getElementById('modal-reabrir').classList.add('active')
}

function cerrarModalReabrir() { document.getElementById('modal-reabrir').classList.remove('active') }

async function confirmarReapertura() {
  const motivo = document.getElementById('reabrir-motivo').value.trim()
  const errorDiv = document.getElementById('reabrir-error')
  errorDiv.classList.remove('show')
  if (!motivo) {
    errorDiv.textContent = 'El motivo es obligatorio'
    errorDiv.classList.add('show')
    return
  }
  const btn = document.getElementById('reabrir-confirmar')
  btn.disabled = true; btn.textContent = 'Reabriendo...'
  try {
    const res = await apiFetch(`/bitacoras/${bitacoraActual.id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'ABIERTA', motivo })
    })
    toast(res.mensaje || 'Bitácora reabierta', 'success')
    cerrarModalReabrir()
    bitacoraActual = res.data
    renderDetalle()
    cargarBitacoras(paginaActual)
  } catch (e) {
    errorDiv.textContent = e.message
    errorDiv.classList.add('show')
  } finally {
    btn.disabled = false; btn.textContent = 'Reabrir'
  }
}

// ════════════════════════════════════════════════════════════════════
//  CLIENTES — dropdown
// ════════════════════════════════════════════════════════════════════
async function cargarClientes() {
  try {
    const res = await apiFetch('/clientes?limit=500', { method: 'GET' })
    // Manejar múltiples formatos de respuesta posibles
    const lista = Array.isArray(res) ? res
                : Array.isArray(res?.data) ? res.data
                : Array.isArray(res?.clientes) ? res.clientes
                : []
    clientesCache = lista.filter(c => c.activo !== false)

    const sel = document.getElementById('filtro-cliente')
    if (sel) {
      sel.innerHTML = '<option value="">Todos los clientes</option>' +
        clientesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')
    }
    console.log(`✅ ${clientesCache.length} clientes cargados`)
  } catch(e) {
    console.warn('No se cargaron clientes:', e.message)
    clientesCache = []
  }
}

function mostrarDropdownClientes(e) {
  if (e) { e.stopPropagation() }
  const inp = document.getElementById('bit-cliente-buscar')
  const dd  = document.getElementById('dd-bit-clientes')

  // Si no hay clientes cacheados, intentar cargarlos
  if (!clientesCache.length) {
    dd.innerHTML = '<div class="dropdown-item" style="color:var(--muted);">Cargando clientes...</div>'
    cargarClientes().then(() => mostrarDropdownClientes())
    return
  }

  const rect = inp.getBoundingClientRect()
  dd.style.left  = rect.left + 'px'
  dd.style.top   = (rect.bottom + 2) + 'px'
  dd.style.width = rect.width + 'px'
  dd.style.maxHeight = '260px'
  dd.style.overflowY = 'auto'
  dd.style.background = 'var(--sidebar-bg, #1a1a1a)'
  dd.style.border = '1px solid var(--panel-border)'
  dd.style.borderRadius = '8px'
  dd.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)'

  // Filtro por texto si el usuario escribió algo
  const filtro = (inp.value || '').toLowerCase().trim()
  const filtrados = filtro
    ? clientesCache.filter(c =>
        c.nombre.toLowerCase().includes(filtro) ||
        (c.telefono || '').includes(filtro)
      )
    : clientesCache

  let html = '<div class="dropdown-item" data-cid="">— Sin cliente —</div>'
  if (filtrados.length === 0) {
    html += '<div class="dropdown-item" style="color:var(--muted);">Sin coincidencias</div>'
  } else {
    html += filtrados.map(c =>
      `<div class="dropdown-item" data-cid="${c.id}">${c.nombre}${c.telefono ? ' · ' + c.telefono : ''}</div>`
    ).join('')
  }
  dd.innerHTML = html
  dd.style.display = 'flex'

  dd.querySelectorAll('.dropdown-item').forEach(it => {
    it.addEventListener('click', ev => {
      ev.stopPropagation()
      const cid = it.dataset.cid
      document.getElementById('bit-cliente-id').value = cid
      document.getElementById('bit-cliente-buscar').value = cid ? it.textContent : ''
      dd.style.display = 'none'
    })
  })
}

document.addEventListener('click', e => {
  const dd = document.getElementById('dd-bit-clientes')
  if (!dd) return
  if (!e.target.closest('#btn-lista-bit-clientes')
      && !e.target.closest('#bit-cliente-buscar')
      && !e.target.closest('#dd-bit-clientes')) {
    dd.style.display = 'none'
  }
})

// ════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Fecha
  const f = new Date()
  document.getElementById('fecha-actual').textContent =
    f.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  await cargarTurnoActivo()
  await cargarClientes()
  await cargarBitacoras(1)

  // ── Filtros ──
  let timerFiltro
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(timerFiltro)
    timerFiltro = setTimeout(() => cargarBitacoras(1), 400)
  })
  document.getElementById('filtro-estado').addEventListener('change',  () => cargarBitacoras(1))
  document.getElementById('filtro-origen').addEventListener('change',  () => cargarBitacoras(1))
  document.getElementById('filtro-cliente').addEventListener('change', () => cargarBitacoras(1))

  // ── Paginación ──
  document.getElementById('btn-prev').addEventListener('click', () => cargarBitacoras(paginaActual - 1))
  document.getElementById('btn-next').addEventListener('click', () => cargarBitacoras(paginaActual + 1))

  // ── Crear ──
  document.getElementById('btn-nueva').addEventListener('click',      abrirModalCrear)
  document.getElementById('crear-close').addEventListener('click',    cerrarModalCrear)
  document.getElementById('crear-cancel').addEventListener('click',   cerrarModalCrear)
  document.getElementById('crear-guardar').addEventListener('click',  guardarNuevaBitacora)
  document.getElementById('btn-lista-bit-clientes').addEventListener('click', mostrarDropdownClientes)
  document.getElementById('bit-cliente-buscar').addEventListener('click', mostrarDropdownClientes)
  document.getElementById('bit-cliente-buscar').addEventListener('input', () => {
    // Si el usuario está escribiendo, limpiar la selección previa y refiltrar
    document.getElementById('bit-cliente-id').value = ''
    mostrarDropdownClientes()
  })

  // ── Detalle ──
  document.getElementById('det-close').addEventListener('click', cerrarDetalle)

  // ── Abono ──
  document.getElementById('btn-abonar').addEventListener('click', registrarAbono)

  // ── Agregar producto ──
  document.getElementById('btn-agregar-prod').addEventListener('click', abrirBuscadorProducto)
  document.getElementById('search-prod-det').addEventListener('input', e => buscarProductosDet(e.target.value))
  document.getElementById('btn-confirmar-prod').addEventListener('click', confirmarAgregarProducto)
  document.getElementById('btn-cancelar-prod').addEventListener('click',  () => {
    document.getElementById('buscador-prod-panel').style.display = 'none'
  })

  // ── Cierre ──
  document.getElementById('cierre-close').addEventListener('click',    cerrarModalCierre)
  document.getElementById('cierre-cancel').addEventListener('click',   cerrarModalCierre)
  document.getElementById('cierre-confirmar').addEventListener('click', confirmarCierre)

  // ── Reabrir ──
  document.getElementById('reabrir-close').addEventListener('click',    cerrarModalReabrir)
  document.getElementById('reabrir-cancel').addEventListener('click',   cerrarModalReabrir)
  document.getElementById('reabrir-confirmar').addEventListener('click', confirmarReapertura)
})