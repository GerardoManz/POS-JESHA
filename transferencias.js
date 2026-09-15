/* global apiFetch, CONFIG */
'use strict'

;(function () {
  const state = {
    transferencias: [],
    pagination: { total: 0, pagina: 1, tamano: 50, paginas: 0 },
    filtros: { desde: '', hasta: '' },
    branchMode: null,
    sucursalOrigen: null,
    sucursalOrigenId: null,
    items: [],
    clientTransferId: null,
    destinos: [],
    pendingPayload: null
  }

  function $(id) { return document.getElementById(id) }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }
  function fmtFecha(d) { return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  function fmtNum(n) { return Number(n).toLocaleString('es-MX') }

  function generarId() {
    return 'trf-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
  }

  function getUsuario() {
    return window.jeshaSession?.getUsuario() || {}
  }

  function puedeCrearTransferencia(usuario) {
    return usuario.rol === 'SUPERADMIN' || usuario.rol === 'ADMIN_SUCURSAL'
  }

  function mostrarOrigenDesdeContexto(sucursales) {
    const usuario = getUsuario()
    const fixedId = Number.isInteger(Number(usuario.sucursalId)) ? Number(usuario.sucursalId) : null
    const selectedId = window.jeshaSession?.getSelectedSucursalId?.()
    state.sucursalOrigenId = fixedId || selectedId || null
    state.branchMode = fixedId ? 'FIXED' : state.sucursalOrigenId ? 'SELECTED' : 'NONE'
    const origen = sucursales.find((s) => Number(s.id) === Number(state.sucursalOrigenId))
    state.sucursalOrigen = origen?.nombre || usuario.Sucursal?.nombre || null
  }

  async function cargarContextoSucursal() {
    try {
      const data = await apiFetch('/sucursales')
      const sucursales = Array.isArray(data) ? data : (data?.sucursales || data?.data || [])
      mostrarOrigenDesdeContexto(sucursales)
      return sucursales
    } catch (err) {
      console.warn('No se pudo cargar el contexto de sucursal:', err.message)
      mostrarOrigenDesdeContexto([])
      return []
    }
  }

  function configurarAccionNueva() {
    const button = $('btn-nueva')
    if (!button) return
    const permitido = puedeCrearTransferencia(getUsuario())
    button.hidden = !permitido
    button.addEventListener('click', abrirModalNueva)
  }

  function setModal(id, open) {
    const modal = $(id)
    if (modal) modal.classList.toggle('active', open)
  }

  function bindUiEvents() {
    $('btn-aplicar-filtros')?.addEventListener('click', aplicarFiltros)
    $('btn-limpiar-filtros')?.addEventListener('click', limpiarFiltros)
    $('btn-cerrar-modal-nueva')?.addEventListener('click', cerrarModalNueva)
    $('btn-cancelar-modal-nueva')?.addEventListener('click', cerrarModalNueva)
    $('btn-seleccionar-sucursal')?.addEventListener('click', () => { window.location.href = 'sucursales.html' })
    $('btn-agregar-item')?.addEventListener('click', agregarItem)
    $('btn-transferir')?.addEventListener('click', confirmarTransferencia)
    $('modal-destino')?.addEventListener('change', actualizarEstadoTransferir)
    $('btn-cerrar-confirmacion')?.addEventListener('click', cerrarConfirmacion)
    $('btn-cancelar-confirmacion')?.addEventListener('click', cerrarConfirmacion)
    $('btn-confirmar-transferir')?.addEventListener('click', ejecutarTransferencia)
    $('btn-cerrar-detalle')?.addEventListener('click', cerrarDetalle)
    $('btn-cerrar-detalle-footer')?.addEventListener('click', cerrarDetalle)

    $('tbody-transferencias')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-transfer-action]')
      if (!button) return
      if (button.dataset.transferAction === 'detail') verDetalle(Number(button.dataset.id))
    })
    $('pagination')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]')
      if (button && !button.disabled) cargarTransferencias(Number(button.dataset.page))
    })
    $('modal-items')?.addEventListener('input', (event) => {
      const input = event.target.closest('[data-item-action="search"]')
      if (input) buscarProducto(Number(input.dataset.index), input.value)
    })
    $('modal-items')?.addEventListener('change', (event) => {
      const input = event.target.closest('[data-item-action="quantity"]')
      if (input) actualizarCantidad(Number(input.dataset.index), input.value)
    })
    $('modal-items')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-item-action]')
      if (!button) return
      const index = Number(button.dataset.index)
      if (button.dataset.itemAction === 'minus') ajustarCantidad(index, -1)
      if (button.dataset.itemAction === 'plus') ajustarCantidad(index, 1)
      if (button.dataset.itemAction === 'remove') quitarItem(index)
      if (button.dataset.itemAction === 'select') {
        seleccionarProducto(index, Number(button.dataset.id), button.dataset.name, Number(button.dataset.stock), button.dataset.code)
      }
    })
  }

  // ── Init ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    if (!window.jeshaSession?.getUsuario()) return
    bindUiEvents()
    configurarAccionNueva()
    await cargarContextoSucursal()
    state.clientTransferId = generarId()
    await cargarTransferencias()
  })

  // ── Load transfers ───────────────────────────────────────────
  async function cargarTransferencias(pagina = 1) {
    const tbody = $('tbody-transferencias')
    tbody.innerHTML = '<tr class="loading-row"><td colspan="8"><div class="spinner"></div></td></tr>'

    const params = new URLSearchParams()
    params.append('pagina', pagina)
    params.append('tamano', state.pagination.tamano)
    if (state.filtros.desde) params.append('desde', state.filtros.desde)
    if (state.filtros.hasta) params.append('hasta', state.filtros.hasta)

    try {
      const data = await apiFetch('/inventario/transferencias?' + params.toString())
      if (!data || !data.transferencias) throw new Error('Respuesta inválida')

      state.transferencias = data.transferencias
      state.pagination = data.pagination

      renderizarTabla()
      renderizarPaginacion()
      renderizarResumen()
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted">Error al cargar transferencias</td></tr>'
      console.error(err)
    }
  }

  // ── Render table ─────────────────────────────────────────────
  function renderizarTabla() {
    const tbody = $('tbody-transferencias')
    if (state.transferencias.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8"><div class="empty-row-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10h-4"/>
          <polyline points="9 17 9 21 15 21 15 17"/><line x1="12" y1="5" x2="12" y2="15"/>
          <polyline points="8 11 12 15 16 11"/>
        </svg><p>No hay transferencias registradas</p>
      </div></td></tr>`
      return
    }

    tbody.innerHTML = state.transferencias.map(t => `
      <tr>
        <td class="mono">${esc(t.folio)}</td>
        <td>${fmtFecha(t.creadoEn)}</td>
        <td>${esc(t.origen?.nombre || '—')}</td>
        <td>${esc(t.destino?.nombre || '—')}</td>
        <td>${fmtNum(t.totalProductos)}</td>
        <td>${fmtNum(t.totalUnidades)}</td>
        <td>${esc(t.usuario?.nombre || '—')}</td>
        <td>
          <button class="btn-sm btn-secondary" type="button" data-transfer-action="detail" data-id="${t.id}">Ver</button>
        </td>
      </tr>
    `).join('')
  }

  // ── Pagination ───────────────────────────────────────────────
  function renderizarPaginacion() {
    const el = $('pagination')
    const { total, pagina, paginas } = state.pagination
    if (paginas <= 1) { el.style.display = 'none'; return }
    el.style.display = 'flex'
    el.innerHTML = `
      <button class="btn-pag" type="button" data-page="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button>
      <span>Página ${pagina} de ${paginas} (${fmtNum(total)} total)</span>
      <button class="btn-pag" type="button" data-page="${pagina + 1}" ${pagina >= paginas ? 'disabled' : ''}>Siguiente</button>
    `
  }

  function renderizarResumen() {
    const el = $('resumen')
    if (state.transferencias.length === 0) { el.style.display = 'none'; return }
    el.style.display = 'block'
    el.textContent = `${fmtNum(state.pagination.total)} transferencia(s) encontrada(s)`
  }

  // ── Filters ──────────────────────────────────────────────────
  function aplicarFiltros() {
    state.filtros.desde = $('filter-desde').value
    state.filtros.hasta = $('filter-hasta').value
    cargarTransferencias(1)
  }

  function limpiarFiltros() {
    $('filter-desde').value = ''
    $('filter-hasta').value = ''
    state.filtros = { desde: '', hasta: '' }
    cargarTransferencias(1)
  }

  // ── Nueva transferencia ──────────────────────────────────────
  async function abrirModalNueva() {
    if (!state.sucursalOrigenId) {
      $('modal-branch-notice').style.display = 'block'
      $('modal-form').style.display = 'none'
      $('modal-footer').style.display = 'none'
      setModal('modal-nueva', true)
      return
    }

    $('modal-branch-notice').style.display = 'none'
    $('modal-form').style.display = 'block'
    $('modal-footer').style.display = 'flex'

    $('modal-origen').textContent = state.sucursalOrigen || `Sucursal ${state.sucursalOrigenId}`
    $('modal-destino').value = ''
    $('modal-notas').value = ''
    state.items = []
    state.clientTransferId = generarId()
    renderizarItems()
    await cargarDestinos()
    setModal('modal-nueva', true)
  }

  function cerrarModalNueva() {
    setModal('modal-nueva', false)
  }

  async function cargarDestinos() {
    try {
      const data = await apiFetch('/sucursales')
      const sucursales = Array.isArray(data) ? data : (data?.sucursales || [])
      state.destinos = sucursales.filter(s => s.id !== state.sucursalOrigenId && s.activa !== false)
      const select = $('modal-destino')
      select.innerHTML = '<option value="">Seleccionar destino...</option>' +
        state.destinos.map(s => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('')
    } catch (err) {
      console.error('Error cargando destinos:', err)
    }
  }

  // ── Items ────────────────────────────────────────────────────
  function agregarItem() {
    state.items.push({ productoId: '', cantidad: 1, productoNombre: '', codigoInterno: '', stock: 0 })
    renderizarItems()
  }

  function actualizarEstadoTransferir() {
    const destinoId = $('modal-destino')?.value
    const itemsValidos = state.items.some((item) => item.productoId && Number.isFinite(item.cantidad) && item.cantidad > 0)
    const button = $('btn-transferir')
    if (button) button.disabled = !destinoId || !itemsValidos
  }

  function renderizarItems() {
    const container = $('modal-items')
    if (state.items.length === 0) {
      container.innerHTML = '<div class="product-empty">Agrega al menos un producto</div>'
      actualizarEstadoTransferir()
      return
    }
    container.innerHTML = state.items.map((item, i) => `
      <div class="item-row" data-index="${i}">
        <div class="item-field">
          <span class="item-field-label">Producto</span>
          <input type="text" class="form-control item-search" placeholder="Buscar por nombre o código..."
            value="${esc(item.productoNombre)}" data-item-action="search" data-index="${i}">
          <div class="item-search-results" id="search-results-${i}" style="display:none"></div>
        </div>
        <div class="item-meta">
          <span class="item-field-label">Código</span>
          <strong>${esc(item.codigoInterno || '—')}</strong>
        </div>
        <div class="item-meta">
          <span class="item-field-label">Disponible</span>
          <strong class="item-stock">${item.productoId ? fmtNum(item.stock) : '—'}</strong>
        </div>
        <div class="item-field">
          <span class="item-field-label">Cantidad</span>
          <div class="quantity-control">
            <button class="btn-ghost btn-sm" type="button" aria-label="Disminuir cantidad" data-item-action="minus" data-index="${i}">−</button>
            <input type="number" class="form-control item-cantidad" min="0" step="0.001"
              value="${item.cantidad}" data-item-action="quantity" data-index="${i}">
            <button class="btn-ghost btn-sm" type="button" aria-label="Aumentar cantidad" data-item-action="plus" data-index="${i}">+</button>
          </div>
        </div>
        <button class="btn-ghost btn-sm item-remove" type="button" aria-label="Quitar producto" title="Quitar producto" data-item-action="remove" data-index="${i}">&times;</button>
      </div>
    `).join('')
    actualizarEstadoTransferir()
  }

  let searchTimeout = null
  function buscarProducto(index, query) {
    clearTimeout(searchTimeout)
    if (!query || query.length < 2) {
      const el = $('search-results-' + index)
      if (el) el.style.display = 'none'
      return
    }
    searchTimeout = setTimeout(async () => {
      try {
        const data = await apiFetch('/productos?buscar=' + encodeURIComponent(query))
        const productos = Array.isArray(data) ? data : (data?.productos || data?.data || [])
        const el = $('search-results-' + index)
        if (!el) return
        if (productos.length === 0) {
          el.innerHTML = '<div class="search-item text-muted">Sin resultados</div>'
        } else {
          el.innerHTML = productos.slice(0, 8).map(p => `
            <div class="search-item" role="button" tabindex="0" data-item-action="select" data-index="${index}" data-id="${p.id}" data-name="${esc(p.nombre)}" data-code="${esc(p.codigoInterno || '')}" data-stock="${p.stock ?? p.inventario?.stockActual ?? 0}">
              ${esc(p.nombre)} (${esc(p.codigoInterno || '')})
            </div>
          `).join('')
        }
        el.style.display = 'block'
      } catch (err) {
        console.error(err)
      }
    }, 300)
  }

  function seleccionarProducto(index, id, nombre, stock, codigoInterno = '') {
    state.items[index].productoId = id
    state.items[index].productoNombre = nombre
    state.items[index].codigoInterno = codigoInterno
    state.items[index].stock = stock
    renderizarItems()
  }

  function actualizarCantidad(index, val) {
    const parsed = Number.parseFloat(val)
    state.items[index].cantidad = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    actualizarEstadoTransferir()
  }

  function ajustarCantidad(index, delta) {
    const current = Number.parseFloat(state.items[index]?.cantidad) || 0
    actualizarCantidad(index, Math.max(0, current + delta))
    renderizarItems()
  }

  function quitarItem(index) {
    state.items.splice(index, 1)
    renderizarItems()
  }

  // ── Confirm ──────────────────────────────────────────────────
  function confirmarTransferencia() {
    const destinoId = $('modal-destino').value
    if (!destinoId) { showToast('Selecciona un destino', 'warning'); return }

    const validItems = state.items.filter(i => i.productoId && Number.isFinite(i.cantidad) && i.cantidad > 0)
    if (validItems.length === 0) { showToast('Agrega al menos un producto con cantidad válida', 'warning'); return }

    const destino = state.destinos.find(d => d.id === parseInt(destinoId))
    state.sucursalDestinoNombre = destino?.nombre || null

    // Check stock
    const insuficientes = validItems.filter(i => i.cantidad > i.stock)
    if (insuficientes.length > 0) {
      showToast('Stock insuficiente: ' + insuficientes.map(i => i.productoNombre).join(', '), 'warning')
      return
    }

    state.pendingPayload = {
      clientTransferId: state.clientTransferId,
      sucursalDestinoId: parseInt(destinoId),
      items: validItems.map(i => ({ productoId: i.productoId, cantidad: i.cantidad })),
      notas: $('modal-notas').value.trim() || null
    }

    $('confirm-origen').textContent = state.sucursalOrigen || `Sucursal ${state.sucursalOrigenId}`
    $('confirm-destino').textContent = destino?.nombre || `Sucursal ${destinoId}`
    $('confirm-productos').textContent = validItems.length
    $('confirm-unidades').textContent = fmtNum(validItems.reduce((s, i) => s + i.cantidad, 0))

    setModal('modal-confirmar', true)
  }

  function cerrarConfirmacion() {
    setModal('modal-confirmar', false)
  }

  // ── Execute transfer ─────────────────────────────────────────
  async function ejecutarTransferencia() {
    if (!state.pendingPayload) return
    const btn = $('btn-confirmar-transferir')
    btn.disabled = true
    btn.textContent = 'Procesando...'

    try {
      const result = await apiFetch('/inventario/transferencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.pendingPayload)
      })

      cerrarConfirmacion()
      cerrarModalNueva()

      if (result?.transferencia) {
        mostrarConfirmacionTransferencia(result.transferencia)
        state.clientTransferId = generarId()
        await cargarTransferencias(1)
      }
    } catch (err) {
      console.error(err)
      showToast(window.jeshaMensajeSeguro(err.message, 'No fue posible crear la transferencia.'), 'error')
    } finally {
      btn.disabled = false
      btn.textContent = 'Transferir'
    }
  }

  // ── Detail ───────────────────────────────────────────────────
  async function verDetalle(id) {
    try {
      const data = await apiFetch('/inventario/transferencias/' + id)
      const t = data?.transferencia
      if (!t) throw new Error('Transferencia no encontrada')

      $('detalle-title').textContent = `Transferencia ${t.folio}`
      $('detalle-meta').innerHTML = `
        <div class="meta-grid">
          <div><strong>Fecha:</strong> ${fmtFecha(t.creadoEn)}</div>
          <div><strong>Origen:</strong> ${esc(t.origen?.nombre || '—')}</div>
          <div><strong>Destino:</strong> ${esc(t.destino?.nombre || '—')}</div>
          <div><strong>Usuario:</strong> ${esc(t.usuario?.nombre || '—')}</div>
          ${t.notas ? `<div><strong>Notas:</strong> ${esc(t.notas)}</div>` : ''}
        </div>
      `
      $('detalle-items').innerHTML = t.items.map(item => `
        <tr>
          <td>${esc(item.producto?.nombre || '—')}</td>
          <td class="mono">${fmtNum(item.cantidad)}</td>
          <td class="mono">${fmtNum(item.stockOrigenAntes)} → ${fmtNum(item.stockOrigenDespues)}</td>
          <td class="mono">${fmtNum(item.stockDestinoAntes)} → ${fmtNum(item.stockDestinoDespues)}</td>
        </tr>
      `).join('')

      setModal('modal-detalle', true)
    } catch (err) {
      console.error(err)
      showToast('Error al cargar detalle', 'error')
    }
  }

  function cerrarDetalle() {
    setModal('modal-detalle', false)
  }

  // ── Toast ────────────────────────────────────────────────────
  function showToast(msg, type) {
    if (window.jeshaToast) {
      window.jeshaToast(msg, type || 'info', 3500)
    } else {
      console.warn('jeshaToast not available:', msg)
    }
  }

  // ── Transfer Success Choreography ──────────────────────────
  function mostrarConfirmacionTransferencia(transferencia) {
    if (typeof gsap === 'undefined' || prefersReducedMotion()) {
      showToast('Transferencia ' + transferencia.folio + ' creada', 'success')
      return
    }

    var overlay = document.createElement('div')
    overlay.className = 'trf-confirm-overlay'
    overlay.innerHTML =
      '<div class="trf-confirm-card">' +
        '<div class="trf-confirm-step trf-confirm-origin">' +
          '<div class="trf-confirm-icon">&#127968;</div>' +
          '<div class="trf-confirm-label">' + esc(state.sucursalOrigen || 'Origen') + '</div>' +
        '</div>' +
        '<div class="trf-confirm-arrow">' +
          '<div class="trf-confirm-pkg">&#128230;</div>' +
        '</div>' +
        '<div class="trf-confirm-step trf-confirm-dest">' +
          '<div class="trf-confirm-icon">&#127970;</div>' +
          '<div class="trf-confirm-label">' + esc(state.sucursalDestinoNombre || 'Destino') + '</div>' +
        '</div>' +
        '<div class="trf-confirm-folio">' + esc(transferencia.folio) + '</div>' +
        '<div class="trf-confirm-count">' + (transferencia.items?.length || 0) + ' producto(s)</div>' +
      '</div>'
    document.body.appendChild(overlay)

    var tl = gsap.timeline({
      onComplete: function() {
        gsap.to(overlay, { opacity: 0, duration: 0.25, onComplete: function() { overlay.remove() } })
      }
    })

    tl.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.2 })
      .fromTo('.trf-confirm-origin', { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.25 }, 0.1)
      .fromTo('.trf-confirm-pkg', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.7)' }, 0.3)
      .to('.trf-confirm-pkg', { y: 40, duration: 0.45, ease: 'power2.inOut' }, 0.5)
      .fromTo('.trf-confirm-dest', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.25 }, 0.8)
      .fromTo('.trf-confirm-folio', { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.2 }, 0.95)
      .fromTo('.trf-confirm-count', { opacity: 0 }, { opacity: 1, duration: 0.15 }, 1.05)
      .to({}, { duration: 1.2 })
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // ── Public API ───────────────────────────────────────────────
  window.Transferencias = {
    cargarTransferencias,
    aplicarFiltros,
    limpiarFiltros,
    abrirModalNueva,
    cerrarModalNueva,
    agregarItem,
    buscarProducto,
    seleccionarProducto,
    actualizarCantidad,
    quitarItem,
    confirmarTransferencia,
    cerrarConfirmacion,
    ejecutarTransferencia,
    ajustarCantidad,
    verDetalle,
    cerrarDetalle
  }
})()
