;(function () {
  'use strict'

  // ════════════════════════════════════════════════════════════════════
  //  ESTADO
  // ════════════════════════════════════════════════════════════════════
  const state = {
    productoId: null,
    branchMode: null,
    pagina: 1,
    tamano: 25,
    desde: '',
    hasta: '',
    tipo: '',
    sucursalFilter: '',
    producto: null,
    sucursal: null,
    stockActual: null,
    stockMinimo: null,
    total: 0,
    paginas: 0,
    movimientos: []
  }

  // ════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════════
  function escaparHtml(str) {
    if (str == null) return ''
    const s = String(str)
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
    return s.replace(/[&<>"']/g, function (c) { return map[c] })
  }

  function formatearFecha(fecha) {
    if (!fecha) return '—'
    try {
      const d = new Date(fecha)
      if (isNaN(d.getTime())) return '—'
      const dia = String(d.getDate()).padStart(2, '0')
      const mes = String(d.getMonth() + 1).padStart(2, '0')
      const anio = d.getFullYear()
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      return dia + '/' + mes + '/' + anio + ' ' + hh + ':' + mm
    } catch (_) {
      return '—'
    }
  }

  function fmtStock(val) {
    if (val == null) return '—'
    const n = parseFloat(val)
    if (!Number.isFinite(n)) return '—'
    return n.toFixed(3)
  }

  function fmtCantidad(val, esEntrada) {
    if (val == null) return '—'
    const n = parseFloat(val)
    if (!Number.isFinite(n)) return '—'
    const signo = esEntrada ? '+' : '\u2212'
    return signo + ' ' + n.toFixed(3)
  }

  function tipoLabel(tipo) {
    var labels = {
      ENTRADA_COMPRA: 'Entrada compra',
      SALIDA_VENTA: 'Salida venta',
      AJUSTE_POSITIVO: 'Ajuste +',
      AJUSTE_NEGATIVO: 'Ajuste \u2212',
      DEVOLUCION_ENTRADA: 'Devoluci\u00f3n ent.',
      DEVOLUCION_SALIDA: 'Devoluci\u00f3n sal.',
      SALIDA_BITACORA: 'Salida bit\u00e1cora',
      CANCELACION_VENTA: 'Cancel. venta',
      REINTEGRO_BITACORA: 'Reintegro bit\u00e1cora'
    }
    return labels[tipo] || tipo || '—'
  }

  function $(id) { return document.getElementById(id) }

  // ════════════════════════════════════════════════════════════════════
  //  ESTADOS DE UI
  // ════════════════════════════════════════════════════════════════════
  function mostrarSinProducto() {
    var el = $('kardex-empty')
    if (el) {
      el.innerHTML =
        '<div class="kardex-sin-producto">' +
          '<p>Selecciona un producto desde Productos para consultar su Kardex.</p>' +
          '<a href="productos.html" class="kardex-btn-volver">Volver a Productos</a>' +
        '</div>'
      el.style.display = 'flex'
    }
    var info = $('kardex-producto-info')
    if (info) info.innerHTML = ''
    var filtros = $('kardex-filtros')
    if (filtros) filtros.style.display = 'none'
    var tableWrap = $('kardex-table-wrap')
    if (tableWrap) tableWrap.style.display = 'none'
    var resumen = $('kardex-resumen')
    if (resumen) resumen.innerHTML = ''
    var pag = $('kardex-pagination')
    if (pag) pag.innerHTML = ''
    var subtitle = $('kardex-subtitle')
    if (subtitle) subtitle.textContent = 'Kardex de Inventario'
  }

  function mostrarError(msg) {
    var el = $('kardex-empty')
    if (el) {
      el.innerHTML =
        '<div class="kardex-sin-producto">' +
          '<p style="color:#ff6b6b;">' + escaparHtml(msg) + '</p>' +
          '<a href="productos.html" class="kardex-btn-volver">Volver a Productos</a>' +
        '</div>'
      el.style.display = 'flex'
    }
    var tableWrap = $('kardex-table-wrap')
    if (tableWrap) tableWrap.style.display = 'none'
  }

  function ocultarEmpty() {
    var el = $('kardex-empty')
    if (el) el.style.display = 'none'
  }

  // ════════════════════════════════════════════════════════════════════
  //  CARGAR SUCURSALES (para modo NONE)
  // ════════════════════════════════════════════════════════════════════
  async function cargarSucursales() {
    var select = $('kardex-sucursal-filter')
    var label = $('kardex-sucursal-label')
    if (!select) return
    try {
      var data = await apiFetch('/sucursales', { method: 'GET' })
      var lista = Array.isArray(data) ? data : (data && data.data ? data.data : [])
      select.innerHTML = '<option value="">Todas las sucursales</option>'
      lista.forEach(function (s) {
        if (s.activo === false) return
        var opt = document.createElement('option')
        opt.value = s.id
        opt.textContent = s.nombre
        select.appendChild(opt)
      })
      select.addEventListener('change', function () {
        state.sucursalFilter = select.value
        state.pagina = 1
        cargarKardex()
      })
    } catch (_) {
      select.innerHTML = '<option value="">Todas las sucursales</option>'
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  CARGAR KARDEX
  // ════════════════════════════════════════════════════════════════════
  async function cargarKardex() {
    if (!state.productoId) return
    var tbody = $('kardex-tbody')
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="loading-cell">' +
          '<div class="spinner"></div><p>Cargando...</p>' +
        '</td></tr>'
    }
    ocultarEmpty()
    var tableWrap = $('kardex-table-wrap')
    if (tableWrap) tableWrap.style.display = ''

    var params = new URLSearchParams()
    params.append('pagina', String(state.pagina))
    params.append('tamano', String(state.tamano))
    if (state.desde) params.append('desde', state.desde)
    if (state.hasta) params.append('hasta', state.hasta)
    if (state.tipo) params.append('tipo', state.tipo)
    if (state.branchMode === 'NONE' && state.sucursalFilter) {
      params.append('sucursalId', state.sucursalFilter)
    }

    try {
      var data = await apiFetch(
        '/inventario/producto/' + state.productoId + '/kardex?' + params.toString(),
        { method: 'GET' }
      )
      state.branchMode = data.branchMode || null
      state.producto = data.producto || null
      state.sucursal = data.sucursal || null
      state.stockActual = data.stockActual != null ? parseFloat(data.stockActual) : null
      state.stockMinimo = data.stockMinimo != null ? parseFloat(data.stockMinimo) : null
      state.total = data.total || 0
      state.paginas = data.paginas || 0
      state.movimientos = Array.isArray(data.movimientos) ? data.movimientos : []

      renderizarInfo()
      renderizarTabla()
      renderizarResumen()
      renderizarPaginacion()

      // Show/hide sucursal filter based on branchMode
      var filterSelect = $('kardex-sucursal-filter')
      var filterLabel = $('kardex-sucursal-label')
      if (filterSelect) {
        filterSelect.style.display = state.branchMode === 'NONE' ? '' : 'none'
      }
      if (filterLabel) {
        filterLabel.style.display = state.branchMode === 'NONE' ? '' : 'none'
      }
    } catch (e) {
      mostrarError('Error al cargar kardex: ' + (e.message || e))
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RENDERIZAR INFO
  // ════════════════════════════════════════════════════════════════════
  function renderizarInfo() {
    var el = $('kardex-producto-info')
    if (!el) return
    var p = state.producto
    if (!p) { el.innerHTML = ''; return }

    var nombre = p.nombre || '—'
    var codigo = p.codigoInterno || p.codigoBarras || '—'
    var unidad = p.unidadVenta || 'PZA'

    var branchLabel = ''
    if (state.branchMode === 'NONE') {
      branchLabel = '<span class="kardex-info-tag">Todas las sucursales</span>'
    } else if (state.branchMode === 'SUCURSAL') {
      var sn = state.sucursal ? state.sucursal.nombre : 'Sucursal'
      branchLabel = '<span class="kardex-info-tag">' + escaparHtml(sn) + '</span>'
    }

    var stockHtml = ''
    if (state.stockActual != null) {
      stockHtml =
        '<div class="kardex-info-item">' +
          '<span class="kardex-info-label">Stock actual</span>' +
          '<span class="kardex-info-valor">' + fmtStock(state.stockActual) + '</span>' +
        '</div>' +
        '<div class="kardex-info-item">' +
          '<span class="kardex-info-label">Stock m\u00ednimo</span>' +
          '<span class="kardex-info-valor">' + fmtStock(state.stockMinimo) + '</span>' +
        '</div>'
    }

    el.innerHTML =
      '<div class="kardex-info-grid">' +
        '<div class="kardex-info-item">' +
          '<span class="kardex-info-label">Producto</span>' +
          '<span class="kardex-info-valor kardex-info-nombre">' + escaparHtml(nombre) + '</span>' +
        '</div>' +
        '<div class="kardex-info-item">' +
          '<span class="kardex-info-label">C\u00f3digo</span>' +
          '<span class="kardex-info-valor kardex-info-codigo">' + escaparHtml(codigo) + '</span>' +
        '</div>' +
        '<div class="kardex-info-item">' +
          '<span class="kardex-info-label">Unidad</span>' +
          '<span class="kardex-info-valor">' + escaparHtml(unidad) + '</span>' +
        '</div>' +
        '<div class="kardex-info-item">' +
          '<span class="kardex-info-label">Vista</span>' +
          branchLabel +
        '</div>' +
        stockHtml +
      '</div>'

    var subtitle = $('kardex-subtitle')
    if (subtitle) subtitle.textContent = 'Kardex \u2014 ' + nombre
  }

  // ════════════════════════════════════════════════════════════════════
  //  RENDERIZAR TABLA
  // ════════════════════════════════════════════════════════════════════
  function renderizarTabla() {
    var tbody = $('kardex-tbody')
    if (!tbody) return

    var movs = state.movimientos
    if (!movs.length) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="loading-cell"><p>Sin movimientos para los filtros seleccionados.</p></td></tr>'
      return
    }

    var showSucursal = state.branchMode === 'NONE'
    var cols = showSucursal ? 9 : 8
    var headerCols = ''
    if (showSucursal) headerCols += '<th>Sucursal</th>'

    tbody.innerHTML = movs.map(function (m) {
      var esEntrada = m.esEntrada === true
      var badgeClass = esEntrada ? 'kardex-badge-entrada' : 'kardex-badge-salida'
      var cantClass = esEntrada ? 'kardex-cant-entrada' : 'kardex-cant-salida'

      var sucursalCell = ''
      if (showSucursal) {
        var sn = m.sucursal || '—'
        sucursalCell = '<td>' + escaparHtml(sn) + '</td>'
      }

      return '<tr>' +
        '<td>' + formatearFecha(m.fecha) + '</td>' +
        sucursalCell +
        '<td><span class="kardex-badge ' + badgeClass + '">' + tipoLabel(m.tipo) + '</span></td>' +
        '<td class="' + cantClass + '">' + fmtCantidad(m.cantidad, esEntrada) + '</td>' +
        '<td>' + fmtStock(m.stockAntes) + '</td>' +
        '<td>' + fmtStock(m.stockDespues) + '</td>' +
        '<td>' + escaparHtml(m.referencia) + '</td>' +
        '<td>' + escaparHtml(m.notas) + '</td>' +
        '<td>' + escaparHtml(m.usuario) + '</td>' +
      '</tr>'
    }).join('')

    // Update colspan on loading cells or empty state
    var loadingCells = tbody.querySelectorAll('.loading-cell')
    loadingCells.forEach(function (cell) {
      cell.setAttribute('colspan', String(cols))
    })
  }

  // ════════════════════════════════════════════════════════════════════
  //  RENDERIZAR RESUMEN
  // ════════════════════════════════════════════════════════════════════
  function renderizarResumen() {
    var el = $('kardex-resumen')
    if (!el) return

    var totalEntradas = 0
    var totalSalidas = 0
    var movs = state.movimientos

    movs.forEach(function (m) {
      var n = parseFloat(m.cantidad) || 0
      if (m.esEntrada) {
        totalEntradas += n
      } else {
        totalSalidas += n
      }
    })

    var neto = totalEntradas - totalSalidas

    el.innerHTML =
      '<div class="kardex-resumen-grid">' +
        '<div class="kardex-resumen-item">' +
          '<span class="kardex-resumen-label">Entradas</span>' +
          '<span class="kardex-resumen-valor kardex-cant-entrada">' + totalEntradas.toFixed(3) + '</span>' +
        '</div>' +
        '<div class="kardex-resumen-item">' +
          '<span class="kardex-resumen-label">Salidas</span>' +
          '<span class="kardex-resumen-valor kardex-cant-salida">' + totalSalidas.toFixed(3) + '</span>' +
        '</div>' +
        '<div class="kardex-resumen-item">' +
          '<span class="kardex-resumen-label">Neto</span>' +
          '<span class="kardex-resumen-valor kardex-resumen-neto">' + neto.toFixed(3) + '</span>' +
        '</div>' +
        '<div class="kardex-resumen-item">' +
          '<span class="kardex-resumen-label">Movimientos</span>' +
          '<span class="kardex-resumen-valor">' + state.total + '</span>' +
        '</div>' +
      '</div>'
  }

  // ════════════════════════════════════════════════════════════════════
  //  RENDERIZAR PAGINACIÓN
  // ════════════════════════════════════════════════════════════════════
  function renderizarPaginacion() {
    var el = $('kardex-pagination')
    if (!el) return

    var totalPag = state.paginas || 0
    var actual = state.pagina || 1

    if (totalPag <= 1) {
      el.innerHTML = ''
      el.style.display = 'none'
      return
    }
    el.style.display = ''

    var html = '<div class="kardex-pag-nav">'

    // Previous button
    html += '<button class="kardex-pag-btn" data-pag="' + (actual - 1) + '"' +
      (actual <= 1 ? ' disabled' : '') + ' aria-label="P\u00e1gina anterior">&laquo;</button>'

    // Page numbers with dots
    var pages = []
    if (totalPag <= 7) {
      for (var i = 1; i <= totalPag; i++) pages.push(i)
    } else {
      pages.push(1)
      if (actual > 4) pages.push('...')
      var start = Math.max(2, actual - 2)
      var end = Math.min(totalPag - 1, actual + 2)
      for (var j = start; j <= end; j++) pages.push(j)
      if (actual < totalPag - 3) pages.push('...')
      pages.push(totalPag)
    }

    pages.forEach(function (p) {
      if (p === '...') {
        html += '<span class="kardex-pag-dots">...</span>'
      } else {
        html += '<button class="kardex-pag-btn' + (p === actual ? ' kardex-pag-active' : '') +
          '" data-pag="' + p + '"' + (p === actual ? ' disabled' : '') + '>' + p + '</button>'
      }
    })

    // Next button
    html += '<button class="kardex-pag-btn" data-pag="' + (actual + 1) + '"' +
      (actual >= totalPag ? ' disabled' : '') + ' aria-label="P\u00e1gina siguiente">&raquo;</button>'

    html += '</div>'
    el.innerHTML = html

    // Bind click events
    el.querySelectorAll('.kardex-pag-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pag = parseInt(btn.dataset.pag, 10)
        if (Number.isFinite(pag) && pag >= 1 && pag <= totalPag && pag !== actual) {
          state.pagina = pag
          cargarKardex()
        }
      })
    })
  }

  // ════════════════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════════════════
  async function init() {
    var params = new URLSearchParams(window.location.search)
    var pid = params.get('productoId') || params.get('producto')
    if (!pid) {
      mostrarSinProducto()
      return
    }
    state.productoId = pid

    // Bind filter buttons
    var btnFiltrar = $('kardex-btn-filtrar')
    if (btnFiltrar) {
      btnFiltrar.addEventListener('click', function () {
        var desde = $('kardex-desde')
        var hasta = $('kardex-hasta')
        var tipo = $('kardex-tipo')
        state.desde = desde ? desde.value : ''
        state.hasta = hasta ? hasta.value : ''
        state.tipo = tipo ? tipo.value : ''
        state.pagina = 1
        cargarKardex()
      })
    }

    var btnLimpiar = $('kardex-btn-limpiar')
    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', function () {
        var desde = $('kardex-desde')
        var hasta = $('kardex-hasta')
        var tipo = $('kardex-tipo')
        var sucFilter = $('kardex-sucursal-filter')
        if (desde) desde.value = ''
        if (hasta) hasta.value = ''
        if (tipo) tipo.value = ''
        if (sucFilter) sucFilter.value = ''
        state.desde = ''
        state.hasta = ''
        state.tipo = ''
        state.sucursalFilter = ''
        state.pagina = 1
        cargarKardex()
      })
    }

    // Hide sucursal filter controls initially until branchMode is known
    var filterSelect = $('kardex-sucursal-filter')
    var filterLabel = $('kardex-sucursal-label')
    if (filterSelect) filterSelect.style.display = 'none'
    if (filterLabel) filterLabel.style.display = 'none'

    // Load sucursales for NONE mode filter, then load kardex
    await cargarSucursales()
    await cargarKardex()
  }

  // ════════════════════════════════════════════════════════════════════
  //  DOM READY
  // ════════════════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
