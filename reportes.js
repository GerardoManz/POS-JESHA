// ── GUARD DE ACCESO ──
;(function() {
  try {
    const rol = JSON.parse(localStorage.getItem('jesha_usuario') || '{}').rol
    const ROLES_PERMITIDOS = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN']
    if (!ROLES_PERMITIDOS.includes(rol)) {
      window.location.replace('dashboard.html')
    }
  } catch(e) { window.location.replace('dashboard.html') }
})()

const TOKEN   = localStorage.getItem('jesha_token')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!TOKEN) { localStorage.setItem('redirect_after_login','reportes.html'); window.location.href = 'login.html'; throw new Error() }

// ── Helpers globales ──
function escapeHTML(str) {
  if (str === null || str === undefined) return ''
  const map = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }
  return String(str).replace(/[&<>"']/g, ch => map[ch])
}

function fmt(v) {
  const n = parseFloat(v || 0)
  return isNaN(n) ? '$0.00' : `$${n.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
}

function fmtEntero(v) {
  const n = parseInt(v || 0, 10)
  return isNaN(n) ? '0' : n.toLocaleString('es-MX')
}

const fmtFecha = iso => iso ? new Date(iso).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—'

function $id(id) { return document.getElementById(id) }

// ── Estado ──
let periodoActual = 'hoy'
let desdeCustom   = null
let hastaCustom   = null
let datosActuales = null
let datosAnteriores = null
const COLORS_DONUT = ['#4a90e2','#60d080','#ff9800','#e8710a','#ab47bc','#26c6da','#ef5350','#78909c']
const NUEVOS_PANEL_IDS = ['rep-vendedores','rep-clientes-frecuentes','rep-tendencia','rep-rentables','rep-bajocosto']
const PERIODO_COMPARATIVO_LABEL = {
  hoy: 'vs ayer',
  semana: 'vs semana ant.',
  mes: 'vs mes ant.',
  custom: 'vs rango anterior'
}

const soloNuevosMode = new URLSearchParams(window.location.search).get('soloNuevos') === 'true'
let isLoadingStock = false
let stockLoadTimeout = null

// ════════════════════════════════════════════════════════════════════
//  CALCULAR RANGO
// ════════════════════════════════════════════════════════════════════
function calcularRango(periodo) {
  const hoy   = new Date()
  let desde, hasta
  if (periodo === 'hoy') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
    hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59)
  } else if (periodo === 'semana') {
    const dia = hoy.getDay() || 7
    desde = new Date(hoy); desde.setDate(hoy.getDate() - dia + 1); desde.setHours(0,0,0,0)
    hasta = new Date(hoy); hasta.setHours(23,59,59,999)
  } else if (periodo === 'mes') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59)
  } else if (periodo === 'custom') {
    desde = desdeCustom ? new Date(desdeCustom + 'T00:00:00') : new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    hasta = hastaCustom ? new Date(hastaCustom + 'T23:59:59') : new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59)
  }
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

// ── Rango anterior equivalente (para comparativo) ──
function calcularRangoAnterior(periodo, desde, hasta) {
  const d = new Date(desde)
  const h = new Date(hasta)
  const diffMs = h.getTime() - d.getTime()
  const diffDays = Math.round(diffMs / 86400000) + 1
  const hAnt = new Date(d.getTime() - 1)
  const dAnt = new Date(hAnt.getTime() - (diffDays - 1) * 86400000)
  dAnt.setHours(0,0,0,0)
  hAnt.setHours(23,59,59,999)
  return { desde: dAnt.toISOString(), hasta: hAnt.toISOString() }
}

// ════════════════════════════════════════════════════════════════════
//  CARGAR REPORTES (principal)
// ════════════════════════════════════════════════════════════════════
async function cargarReportes() {
  const rango = calcularRango(periodoActual)
  const filtros = obtenerFiltros()
  setLoadingDashboard()

  try {
    const params = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta })
    if (filtros.categoriaId) params.append('categoriaId', filtros.categoriaId)
    if (filtros.vendedorId) params.append('vendedorId', filtros.vendedorId)
    if (filtros.sucursalId) params.append('sucursalId', filtros.sucursalId)

    // Comparativo: rango anterior paralelo
    const rangoAnt = calcularRangoAnterior(periodoActual, rango.desde, rango.hasta)
    const paramsAnt = new URLSearchParams({ desde: rangoAnt.desde, hasta: rangoAnt.hasta })

    const [resActual, resAnterior, resStock] = await Promise.all([
      apiFetch(`/ventas/reporte-resumen?${params.toString()}`),
      apiFetch(`/ventas/reporte-resumen?${paramsAnt.toString()}`).catch(() => null),
      apiFetch(`/reportes/stock?fecha=${new Date().toISOString().slice(0,10)}`).catch(() => null)
    ])

    datosActuales = resActual
    datosAnteriores = resAnterior

    const ventas = resActual.ventas || []
    const topP = resActual.topProductos || []
    const ventasAnt = resAnterior?.ventas || []

    procesarDashboard(ventas, topP, ventasAnt, resStock)
  } catch (err) {
    console.error('❌ Reportes:', err.message)
    const ids = ['rep-metodos','rep-categorias','rep-productos','rep-clientes','rep-por-dia','rep-intel',...NUEVOS_PANEL_IDS]
    ids.forEach(id => { const el = $id(id); if (el) { el.className = 'panel-empty'; el.textContent = 'Error cargando datos' } })
    mostrarKpisVacios()
  }
}

function setLoadingDashboard() {
  const ids = ['rep-metodos','rep-categorias','rep-productos','rep-clientes','rep-por-dia','rep-intel',...NUEVOS_PANEL_IDS]
  ids.forEach(id => { const el = $id(id); if (el) { el.className = 'loading-rep'; el.innerHTML = '<div class="spinner"></div>' } })
}

function mostrarKpisVacios() {
  $id('kpi-ingresos').textContent = '$0.00'
  $id('kpi-ingresos-sub').textContent = '0 ventas'
  $id('kpi-ticket').textContent = '$0.00'
  $id('kpi-margen').textContent = 'N/D'
  $id('kpi-margen-sub').textContent = 'Sin datos de costo — margen no disponible'
  $id('kpi-alertas').textContent = '—'
  $id('kpi-alertas-sub').textContent = 'sin stock / stock bajo'
}

// ════════════════════════════════════════════════════════════════════
//  PROCESAR DASHBOARD
// ════════════════════════════════════════════════════════════════════
function procesarDashboard(ventas, topProductos, ventasAnteriores, stockData) {
  const ventasActivas = ventas.filter(v => v.estado !== 'CANCELADA')
  const ventasAntActivas = ventasAnteriores.filter(v => v.estado !== 'CANCELADA')

  // KPIs
  const totalIngresos = ventasActivas.reduce((s, v) => s + parseFloat(v.total), 0)
  const ticketPromedio = ventasActivas.length > 0 ? totalIngresos / ventasActivas.length : 0

  const ingresosAnt = ventasAntActivas.reduce((s, v) => s + parseFloat(v.total), 0)
  const ticketAnt = ventasAntActivas.length > 0 ? ingresosAnt / ventasAntActivas.length : 0

  // Margen bruto (estimado)
  let totalCosto = 0
  let tieneCosto = false
  for (const v of ventasActivas) {
    if (v.detalles && v.detalles.length > 0) {
      for (const d of v.detalles) {
        if (d.producto && (d.producto.costoPromedio || d.producto.costo)) {
          const costoU = d.producto.costoPromedio || d.producto.costo
          totalCosto += parseFloat(d.cantidad) * parseFloat(costoU)
          tieneCosto = true
        }
      }
    }
  }
  // Fallback: usar topProductos si no hay detalles
  if (!tieneCosto && topProductos && topProductos.length > 0) {
    for (const p of topProductos) {
      if (p.costoPromedio) {
        totalCosto += parseFloat(p.cantidad) * parseFloat(p.costoPromedio)
        tieneCosto = true
      }
    }
  }
  const margenBruto = tieneCosto ? totalIngresos - totalCosto : null
  const margenPct = (margenBruto !== null && totalIngresos > 0) ? (margenBruto / totalIngresos * 100) : null

  // Comparativos
  const diffIngresos = ingresosAnt > 0 ? ((totalIngresos - ingresosAnt) / ingresosAnt * 100) : null
  const diffTicket = ticketAnt > 0 ? ((ticketPromedio - ticketAnt) / ticketAnt * 100) : null

  // ── Render KPIs ──
  renderKpis(totalIngresos, ventasActivas.length, ticketPromedio, margenBruto, margenPct, diffIngresos, diffTicket, tieneCosto)

  // ── Alertas stock ──
  const alertas = stockData?.data?.resumen || stockData?.resumen || {}
  renderAlertasStock(alertas)

  // ── Donut ──
  renderDonutMetodos(ventasActivas, totalIngresos)

  // ── Categorías ──
  renderCategorias(ventasActivas, tieneCosto)

  // ── Productos ──
  renderProductos(ventasActivas, topProductos)

  // ── Segmentación ──
  renderSegmentacion(ventasActivas, totalIngresos)

  // ── Heatmap / por hora-día ──
  renderHeatmap(ventasActivas)

  // ── Alertas inteligentes ──
  renderAlertasInteligentes(ventasActivas, topProductos, margenBruto, totalIngresos, margenPct, alertas, tieneCosto)

  // ── Meta de costo ──
  const costoMeta = {
    costoDisponible: tieneCosto,
    margenEstimado: true,
    usaCostoHistorico: false
  }

  // ── Vendedores ──
  renderVendedores(ventasActivas, totalIngresos)

  // ── Clientes frecuentes ──
  renderClientesFrecuentes(ventasActivas)

  // ── Tendencia ──
  renderTendencia(ventasActivas)

  // ── Productos más rentables ──
  renderProductosRentables(ventasActivas, costoMeta)

  // ── Ventas bajo costo ──
  renderVentasBajoCosto(ventasActivas, costoMeta)
}

// ════════════════════════════════════════════════════════════════════
//  RENDER KPIs
// ════════════════════════════════════════════════════════════════════
function renderKpis(ingresos, numVentas, ticket, margen, margenPct, diffIng, diffTick, tieneCosto) {
  $id('kpi-ingresos').textContent = fmt(ingresos)
  $id('kpi-ingresos-sub').textContent = `${numVentas} venta${numVentas !== 1 ? 's' : ''}`
  $id('kpi-ticket').textContent = fmt(ticket)
  $id('kpi-margen').textContent = margen !== null ? fmt(margen) : 'N/D'
  $id('kpi-margen-sub').textContent = margen !== null
    ? `${margenPct.toFixed(1)}% de margen bruto — calculado sobre costo actual de productos${tieneCosto ? ' (estimado)' : ''}`
    : 'Sin datos de costo — margen no disponible'

  // Comparativos
  renderComparativo('comp-ingresos', diffIng)
  renderComparativo('comp-ticket', diffTick)
  renderComparativo('comp-margen', null)
}

function renderComparativo(elId, diff) {
  const el = $id(elId)
  if (!el) return

  if (diff === null || diff === undefined || Number.isNaN(diff)) {
    el.classList.add('is-hidden')
    return
  }

  const label = PERIODO_COMPARATIVO_LABEL[periodoActual] || 'vs anterior'
  const cls = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'neu'
  const sign = diff > 0 ? '+' : ''
  const txt = `${sign}${diff.toFixed(1)}%`

  el.classList.remove('is-hidden', 'pos', 'neg', 'neu')
  el.classList.add(cls)

  const labelEl = el.querySelector('.kpi-comp-label')
  const valEl = el.querySelector('.kpi-comp-val')

  if (labelEl) labelEl.textContent = label
  if (valEl) {
    valEl.textContent = txt
  } else {
    el.textContent = `${label} ${txt}`
  }

  el.title = `Comparado contra ${label.replace('vs ', '')}`
  el.setAttribute('aria-label', `${label} ${txt}`)
}

function renderAlertasStock(resumen) {
  const sinStock = parseInt(resumen.sinStock || 0, 10)
  const stockBajo = parseInt(resumen.stockBajo || 0, 10)
  const alertasAct = parseInt(resumen.alertasActivasCount || 0, 10)
  const total = sinStock + stockBajo

  $id('kpi-alertas').textContent = total
  $id('kpi-alertas-sub').textContent = `${sinStock} sin stock / ${stockBajo} bajo`
  const card = $id('kpi-card-alertas')
  if (card) {
    card.style.borderLeftColor = total > 0 ? '#ff6b6b' : '#60d080'
  }
}

// ════════════════════════════════════════════════════════════════════
//  RENDER DONUT
// ════════════════════════════════════════════════════════════════════
function renderDonutMetodos(ventas, totalIngresos) {
  const el = $id('rep-metodos')
  const svg = $id('donut-segments')
  const legend = $id('donut-legend')
  const totalVal = $id('donut-total-val')

  if (ventas.length === 0) {
    el.className = 'panel-donut-body panel-empty'
    if (svg) svg.innerHTML = ''
    if (legend) legend.innerHTML = ''
    if (totalVal) totalVal.textContent = '$0'
    // Ensure donut structural elements stay visible but empty
    el.style.display = 'flex'
    el.innerHTML = '<div class="panel-empty" style="width:100%;">Sin ventas en este período</div>'
    return
  }
  el.className = 'panel-donut-body'
  el.style.display = 'flex'
  el.innerHTML = ''

  // Reconstruir estructura donut
  const container = document.createElement('div')
  container.className = 'donut-container'
  container.innerHTML = `<svg class="donut-svg" viewBox="0 0 100 100" width="180" height="180">
    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14"/>
    <g id="donut-segments"></g>
  </svg>
  <div class="donut-center">
    <span class="donut-total-label">Total</span>
    <span class="donut-total-val" id="donut-total-val">$0</span>
  </div>`
  const legendDiv = document.createElement('div')
  legendDiv.className = 'donut-legend'
  legendDiv.id = 'donut-legend'
  el.appendChild(container)
  el.appendChild(legendDiv)

  // Desglosar MIXTO
  const metodos = {}
  for (const v of ventas) {
    if (v.metodoPago === 'MIXTO' && v.desglosePagos && Array.isArray(v.desglosePagos)) {
      for (const dp of v.desglosePagos) {
        const key = dp.metodo || 'OTRO'
        if (!metodos[key]) metodos[key] = 0
        metodos[key] += parseFloat(dp.monto || 0)
      }
    } else {
      const key = v.metodoPago || 'OTRO'
      if (!metodos[key]) metodos[key] = 0
      metodos[key] += parseFloat(v.total)
    }
  }

  const labels = {
    EFECTIVO:'Efectivo', DEBITO:'Débito', CREDITO:'Crédito',
    TRANSFERENCIA:'Transferencia', CREDITO_CLIENTE:'Crédito Cliente',
    MIXTO:'Mixto', OTRO:'Otro'
  }

  const entries = Object.entries(metodos).sort((a,b) => b[1] - a[1])
  const total = entries.reduce((s, [,v]) => s + v, 0)

  const svgNew = $id('donut-segments')
  const legendNew = $id('donut-legend')
  const totalValNew = $id('donut-total-val')
  if (totalValNew) totalValNew.textContent = fmt(total)
  if (!svgNew) return

  let offset = 0
  const circumference = 2 * Math.PI * 42

  entries.forEach(([key, val], i) => {
    const pct = total > 0 ? (val / total) : 0
    const len = pct * circumference
    const color = COLORS_DONUT[i % COLORS_DONUT.length]
    const dash = `${len} ${circumference - len}`

    const segment = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    segment.setAttribute('cx', '50')
    segment.setAttribute('cy', '50')
    segment.setAttribute('r', '42')
    segment.setAttribute('fill', 'none')
    segment.setAttribute('stroke', color)
    segment.setAttribute('stroke-width', '14')
    segment.setAttribute('stroke-dasharray', dash)
    segment.setAttribute('stroke-dashoffset', String(-offset))
    segment.setAttribute('transform', 'rotate(-90 50 50)')
    segment.style.transition = 'stroke-dasharray 0.5s ease'
    svgNew.appendChild(segment)
    offset += len

    // Legend item
    const item = document.createElement('div')
    item.className = 'donut-legend-item'
    item.innerHTML = `
      <span class="donut-legend-dot" style="background:${color}"></span>
      <span class="donut-legend-label">${escapeHTML(labels[key] || key)}</span>
      <span class="donut-legend-val">${fmt(val)}</span>
      <span class="donut-legend-pct">${(pct * 100).toFixed(1)}%</span>
    `
    legendNew.appendChild(item)
  })
}

// ════════════════════════════════════════════════════════════════════
//  RENDER CATEGORÍAS
// ════════════════════════════════════════════════════════════════════
function renderCategorias(ventas, tieneCosto) {
  const el = $id('rep-categorias')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  const cats = {}
  for (const v of ventas) {
    if (!v.detalles) continue
    for (const d of v.detalles) {
      const cat = d.producto?.categoriaNombre || 'Sin categoría'
      if (!cats[cat]) cats[cat] = { ingresos: 0, costo: 0 }
      cats[cat].ingresos += parseFloat(d.subtotal || 0)
      if (d.producto?.costoPromedio || d.producto?.costo) {
        const cu = d.producto.costoPromedio || d.producto.costo
        cats[cat].costo += parseFloat(d.cantidad) * parseFloat(cu)
      }
    }
  }

  const entries = Object.entries(cats).sort((a,b) => b[1].ingresos - a[1].ingresos)
  if (entries.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin datos de categorías disponibles'; return }

  const maxIngreso = Math.max(...entries.map(([,v]) => v.ingresos))

  el.className = ''
  el.innerHTML = `<div class="cat-grid">${entries.map(([cat, vals]) => {
    const pctIngreso = maxIngreso > 0 ? (vals.ingresos / maxIngreso * 100) : 0
    const pctGanancia = maxIngreso > 0 ? ((vals.ingresos - vals.costo) / maxIngreso * 100) : 0
    const ganancia = vals.ingresos - vals.costo
    return `<div class="cat-row">
      <div class="cat-head">
        <span class="cat-name">${escapeHTML(cat)}</span>
        <span class="cat-val">${fmt(vals.ingresos)} / ${tieneCosto ? fmt(ganancia) : 'N/D'}</span>
      </div>
      <div class="cat-bars">
        <div class="cat-bar-wrap">
          <div class="cat-bar-ingreso" style="width:${pctIngreso}%"></div>
          ${tieneCosto ? `<div class="cat-bar-ganancia" style="width:${Math.max(pctGanancia, 0)}%"></div>` : ''}
        </div>
        <span class="cat-pct">${tieneCosto ? ((ganancia / vals.ingresos * 100) || 0).toFixed(1) + '%' : 'N/D'}</span>
      </div>
    </div>`
  }).join('')}</div>`
}

// ════════════════════════════════════════════════════════════════════
//  RENDER PRODUCTOS (con thumbnail)
// ════════════════════════════════════════════════════════════════════
function renderProductos(ventas, topProductos) {
  const el = $id('rep-productos')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  let items = []
  if (topProductos && topProductos.length > 0) {
    items = topProductos
  } else {
    // Fallback: calcular desde ventas.detalles
    const map = {}
    for (const v of ventas) {
      if (!v.detalles) continue
      for (const d of v.detalles) {
        if (!d.producto) continue
        const pid = d.productoId
        if (!map[pid]) map[pid] = { nombre: d.producto.nombre, codigo: d.producto.codigoInterno, imagenUrl: d.producto.imagenUrl, cantidad: 0, importe: 0, categoriaNombre: d.producto.categoriaNombre }
        map[pid].cantidad += parseFloat(d.cantidad || 0)
        map[pid].importe += parseFloat(d.subtotal || 0)
      }
    }
    items = Object.values(map).sort((a,b) => b.cantidad - a.cantidad).slice(0, 10)
  }

  if (items.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin productos vendidos en este período'; return }

  const maxCant = items[0].cantidad || 1

  el.className = ''
  el.innerHTML = `<div class="prod-list">${items.map((p, i) => {
    const pct = (p.cantidad / maxCant * 100).toFixed(0)
    const imgHtml = p.imagenUrl
      ? `<img class="prod-thumb" src="${escapeHTML(p.imagenUrl)}" alt="${escapeHTML(p.nombre)}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='${placeholderSvg()}'" />`
      : placeholderSvg()
    return `<div class="prod-row">
      <span class="prod-rank">${i + 1}</span>
      ${imgHtml}
      <div class="prod-info">
        <div class="prod-name" title="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)}</div>
        <div class="prod-code">${escapeHTML(p.codigo || p.codigoInterno || '')}</div>
      </div>
      <div class="prod-stats">
        <div class="prod-stat">
          <div class="prod-stat-val">${fmtEntero(p.cantidad)}</div>
          <div class="prod-stat-label">unds</div>
        </div>
        <div class="prod-stat">
          <div class="prod-stat-val">${fmt(p.importe)}</div>
          <div class="prod-stat-label">importe</div>
        </div>
      </div>
      <div class="prod-bar-wrap"><div class="prod-bar-fill" style="width:${pct}%"></div></div>
    </div>`
  }).join('')}</div>`
}

function placeholderSvg() {
  return '<span class="prod-thumb-placeholder"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></span>'
}

// ════════════════════════════════════════════════════════════════════
//  RENDER SEGMENTACIÓN
// ════════════════════════════════════════════════════════════════════
function renderSegmentacion(ventas, totalIngresos) {
  const el = $id('rep-clientes')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  const map = {}
  for (const v of ventas) {
    const nombre = v.cliente || 'Público general'
    if (!map[nombre]) map[nombre] = { total: 0, count: 0, clientes: new Set() }
    map[nombre].total += parseFloat(v.total)
    map[nombre].count++
    if (v.clienteId) map[nombre].clientes.add(v.clienteId)
  }

  const entries = Object.entries(map).sort((a,b) => b[1].total - a[1].total)
  const totalGral = entries.reduce((s, [,v]) => s + v.total, 0)

  // Segmentar en 3 grupos
  const totalPortion = totalGral
  let acc = 0
  const segs = []
  let currentGroup = []
  const thresholds = [0.6, 0.85, 1.0]
  let ti = 0

  for (const [nombre, vals] of entries) {
    currentGroup.push({ nombre, vals })
    acc += vals.total
    if (acc / totalPortion >= thresholds[ti] || currentGroup.length >= 5) {
      const segTotal = currentGroup.reduce((s, c) => s + c.vals.total, 0)
      const segCount = currentGroup.reduce((s, c) => s + c.vals.count, 0)
      const numClientes = new Set()
      currentGroup.forEach(c => c.vals.clientes.forEach(id => numClientes.add(id)))
      const freq = currentGroup.length > 0 ? (segCount / currentGroup.length) : 0
      const labels = ['Alto valor', 'Frecuente', 'Ocasional']
      segs.push({ label: labels[ti] || `Segmento ${ti+1}`, total: segTotal, count: segCount, clientes: numClientes.size, frecuencia: freq, items: currentGroup })
      currentGroup = []
      ti++
    }
  }
  if (currentGroup.length > 0) {
    const segTotal = currentGroup.reduce((s, c) => s + c.vals.total, 0)
    const segCount = currentGroup.reduce((s, c) => s + c.vals.count, 0)
    const numClientes = new Set()
    currentGroup.forEach(c => c.vals.clientes.forEach(id => numClientes.add(id)))
    const freq = currentGroup.length > 0 ? (segCount / currentGroup.length) : 0
    segs.push({ label: 'Ocasional', total: segTotal, count: segCount, clientes: numClientes.size, frecuencia: freq, items: currentGroup })
  }

  const segColors = ['#4a90e2','#ff9800','#78909c']
  const maxSeg = segs.length > 0 ? segs[0].total : 1

  el.className = ''
  el.innerHTML = `<div class="seg-list">${segs.map((s, i) => {
    const pct = (s.total / maxSeg * 100).toFixed(0)
    const pctTotal = totalGral > 0 ? (s.total / totalGral * 100).toFixed(1) : 0
    return `<div class="seg-row">
      <div class="seg-head">
        <span class="seg-name" style="color:${segColors[i % segColors.length]}">${escapeHTML(s.label)}</span>
        <span class="seg-total">${fmt(s.total)}</span>
      </div>
      <div class="seg-meta">
        <span>${s.clientes} cliente${s.clientes !== 1 ? 's' : ''}</span>
        <span>${s.count} venta${s.count !== 1 ? 's' : ''}</span>
        <span>${s.frecuencia.toFixed(1)} prom. c/u</span>
      </div>
      <div class="seg-bar-wrap"><div class="seg-bar-fill" style="width:${pct}%;background:${segColors[i % segColors.length]}"></div></div>
      <div style="text-align:right;font-size:0.7rem;color:var(--muted);margin-top:3px;">${pctTotal}% del total</div>
    </div>`
  }).join('')}</div>`
}

// ════════════════════════════════════════════════════════════════════
//  RENDER HEATMAP (por hora/día)
// ════════════════════════════════════════════════════════════════════
function renderHeatmap(ventas) {
  const el = $id('rep-por-dia')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas suficientes para analizar horas pico'; return }

  if (periodoActual === 'hoy' || (periodoActual === 'custom' && ventas.length < 20)) {
    // ── Por hora ──
    const porHora = {}
    for (const v of ventas) {
      const h = new Date(v.fecha).getHours()
      const key = `${String(h).padStart(2,'0')}:00`
      if (!porHora[key]) porHora[key] = { total: 0, count: 0 }
      porHora[key].total += parseFloat(v.total)
      porHora[key].count++
    }
    const entries = Object.entries(porHora).sort()
    const maxH = Math.max(...entries.map(([, g]) => g.total), 1)
    const horaPico = entries.reduce((best, [, g]) => g.total > (best?.total || 0) ? g : best, null)
    const totalHoy = entries.reduce((s, [, g]) => s + g.total, 0)
    const promHora = entries.length > 0 ? totalHoy / entries.length : 0
    const horaPicoLabel = entries.length > 0 ? entries.reduce((best, [k, g]) => g.total > (best?.total || 0) ? { key: k, ...g } : best, null) : null

    let resumenHtml = ''
    if (horaPicoLabel) {
      resumenHtml = `<div style="display:flex;gap:16px;margin-bottom:12px;padding:8px 12px;background:rgba(255,255,255,0.02);border-radius:8px;font-size:0.78rem;color:var(--muted);flex-wrap:wrap;">
        <span>Hora pico: <strong style="color:var(--accent)">${escapeHTML(horaPicoLabel.key)}</strong> <span style="color:var(--text)">${fmt(horaPicoLabel.total)}</span></span>
        <span>Promedio por hora: <strong>${fmt(promHora)}</strong></span>
        <span>Total: <strong>${fmt(totalHoy)}</strong></span>
      </div>`
    }

    const filas = entries.map(([h, g]) => {
      const pct = (g.total / maxH * 100).toFixed(0)
      return `<tr><td style="color:var(--muted)">${escapeHTML(h)}</td><td><strong>${fmt(g.total)}</strong></td><td style="color:var(--muted)">${g.count}</td><td><div class="barra-wrap"><div class="barra"><div class="barra-fill" style="width:${pct}%"></div></div></div></td></tr>`
    }).join('')
    el.className = ''
    el.innerHTML = `${resumenHtml}<table class="rep-table"><thead><tr><th>Hora</th><th>Total</th><th>Ventas</th><th>Volumen</th></tr></thead><tbody>${filas}</tbody></table>`
  } else {
    // ── Por día ──
    const porDia = {}
    for (const v of ventas) {
      const d = new Date(v.fecha)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const label = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
      if (!porDia[key]) porDia[key] = { total: 0, count: 0, label }
      porDia[key].total += parseFloat(v.total)
      porDia[key].count++
    }
    const entries = Object.entries(porDia).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    const maxTotal = Math.max(...entries.map(([, g]) => g.total), 1)
    const totalPeriodo = entries.reduce((s, [, g]) => s + g.total, 0)
    const promDia = entries.length > 0 ? totalPeriodo / entries.length : 0
    const diaPico = entries.reduce((best, [k, g]) => g.total > (best?.total || 0) ? { key: k, label: g.label, total: g.total } : best, null)

    let resumenHtml = ''
    if (diaPico) {
      resumenHtml = `<div style="display:flex;gap:16px;margin-bottom:12px;padding:8px 12px;background:rgba(255,255,255,0.02);border-radius:8px;font-size:0.78rem;color:var(--muted);flex-wrap:wrap;">
        <span>Día pico: <strong style="color:var(--accent)">${escapeHTML(diaPico.label)}</strong> <span style="color:var(--text)">${fmt(diaPico.total)}</span></span>
        <span>Promedio diario: <strong>${fmt(promDia)}</strong></span>
        <span>Días con venta: <strong>${entries.length}</strong></span>
      </div>`
    }

    const filas = entries.map(([, g]) => {
      const pct = (g.total / maxTotal * 100).toFixed(0)
      return `<tr><td style="color:var(--muted)">${escapeHTML(g.label)}</td><td><strong>${fmt(g.total)}</strong></td><td style="color:var(--muted)">${g.count}</td><td><div class="barra-wrap"><div class="barra"><div class="barra-fill" style="width:${pct}%"></div></div></div></td></tr>`
    }).join('')
    el.className = ''
    el.innerHTML = `${resumenHtml}<table class="rep-table"><thead><tr><th>Fecha</th><th>Total</th><th>Ventas</th><th>Volumen</th></tr></thead><tbody>${filas}</tbody></table>`
  }
}

// ════════════════════════════════════════════════════════════════════
//  ALERTAS INTELIGENTES
// ════════════════════════════════════════════════════════════════════
function renderAlertasInteligentes(ventas, topProductos, margenBruto, totalIngresos, margenPct, alertas, tieneCosto) {
  const el = $id('rep-intel')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin datos para generar alertas'; return }

  const alertasArr = []

  // 1. Stock crítico
  const r = alertas || {}
  const sinSt = parseInt(r.sinStock || 0, 10)
  const stBajo = parseInt(r.stockBajo || 0, 10)
  if (sinSt > 0) alertasArr.push({ tipo: 'critico', msg: `${sinSt} producto${sinSt !== 1 ? 's' : ''} sin stock — requiere atención inmediata`, icon: '🔴' })
  if (stBajo > 0) alertasArr.push({ tipo: 'advertencia', msg: `${stBajo} producto${stBajo !== 1 ? 's' : ''} con stock bajo — considerar reorden`, icon: '🟠' })

  // 2. Margen bajo
  if (tieneCosto && margenPct !== null && margenPct < 10 && totalIngresos > 0) {
    alertasArr.push({ tipo: 'advertencia', msg: `Margen bruto de ${margenPct.toFixed(1)}% — por debajo del 10% recomendado`, icon: '📉' })
  }

  // 3. Producto estrella (alto volumen + buen margen)
  if (tieneCosto && topProductos && topProductos.length > 0) {
    const estrella = topProductos.find(p => p.costoPromedio && ((p.importe - p.cantidad * p.costoPromedio) / p.importe * 100) > 25 && p.cantidad > 2)
    if (estrella) {
      alertasArr.push({ tipo: 'info', msg: `Producto estrella: ${escapeHTML(estrella.nombre)} — ${fmtEntero(estrella.cantidad)} unds vendidas con buen margen`, icon: '⭐' })
    }
  }

  // 4. Ventas anormalmente bajas
  if (datosAnteriores) {
    const antVentas = (datosAnteriores.ventas || []).filter(v => v.estado !== 'CANCELADA')
    const antTotal = antVentas.reduce((s, v) => s + parseFloat(v.total), 0)
    if (antTotal > 0 && totalIngresos / antTotal < 0.5) {
      alertasArr.push({ tipo: 'critico', msg: `Ventas un ${((1 - totalIngresos/antTotal) * 100).toFixed(0)}% menores vs período anterior`, icon: '📊' })
    }
  }

  // 5. Producto con bajo stock que se vendió mucho
  if (topProductos && topProductos.length > 0) {
    const popularBajoStock = topProductos.find(p => p.cantidad > 3 && r.alertasActivasCount > 0)
    // Usar datos de stock si disponibles
  }

  if (alertasArr.length === 0) {
    alertasArr.push({ tipo: 'info', msg: 'No se detectaron anomalías en el período actual', icon: '✅' })
  }

  el.className = ''
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">${alertasArr.slice(0, 5).map(a => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid var(--panel-border);">
      <span style="font-size:1rem;">${a.icon}</span>
      <span style="flex:1;font-size:0.82rem;color:var(--text);line-height:1.4;">${a.msg}</span>
    </div>
  `).join('')}</div>`
}

// ════════════════════════════════════════════════════════════════════
//  RANKING DE VENDEDORES
// ════════════════════════════════════════════════════════════════════
function renderVendedores(ventas, totalIngresos) {
  const el = $id('rep-vendedores')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin datos de vendedores en este período'; return }

  const grupos = {}
  for (const v of ventas) {
    const key = v.usuarioId || v.vendedorNombre || 'sin-vendedor'
    if (!grupos[key]) grupos[key] = { nombre: v.vendedorNombre || 'Sin vendedor', total: 0, tickets: 0 }
    grupos[key].total += parseFloat(v.total)
    grupos[key].tickets++
  }

  const items = Object.values(grupos)
    .map(g => ({
      ...g,
      ticketPromedio: g.tickets > 0 ? g.total / g.tickets : 0,
      participacion: totalIngresos > 0 ? (g.total / totalIngresos * 100) : 0
    }))
    .sort((a, b) => b.total - a.total)

  if (items.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin datos de vendedores en este período'; return }

  const maxTotal = items[0].total || 1

  el.className = ''
  el.innerHTML = `<div class="rank-list">${items.map((v, i) => {
    const pct = (v.total / maxTotal * 100).toFixed(0)
    return `<div class="rank-row">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name">${escapeHTML(v.nombre)}</span>
      <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
      <div class="rank-stats">
        <div class="rank-stat"><div class="rank-stat-val">${fmt(v.total)}</div><div class="rank-stat-label">total</div></div>
        <div class="rank-stat"><div class="rank-stat-val">${v.tickets}</div><div class="rank-stat-label">tickets</div></div>
        <div class="rank-stat"><div class="rank-stat-val">${fmt(v.ticketPromedio)}</div><div class="rank-stat-label">prom.</div></div>
        <div class="rank-stat"><div class="rank-stat-val">${v.participacion.toFixed(1)}%</div><div class="rank-stat-label">part.</div></div>
      </div>
    </div>`
  }).join('')}</div>`
}

// ════════════════════════════════════════════════════════════════════
//  CLIENTES FRECUENTES TOP 10
// ════════════════════════════════════════════════════════════════════
function renderClientesFrecuentes(ventas) {
  const el = $id('rep-clientes-frecuentes')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin clientes en este período'; return }

  const grupos = {}
  for (const v of ventas) {
    const key = v.clienteId || v.cliente || 'publico-general'
    if (!grupos[key]) grupos[key] = { nombre: v.cliente || 'Público general', total: 0, compras: 0, ultimaFecha: null }
    grupos[key].total += parseFloat(v.total)
    grupos[key].compras++
    if (v.fecha && (!grupos[key].ultimaFecha || new Date(v.fecha) > new Date(grupos[key].ultimaFecha))) {
      grupos[key].ultimaFecha = v.fecha
    }
  }

  const ahora = Date.now()
  const items = Object.values(grupos)
    .map(g => ({
      ...g,
      ticketPromedio: g.compras > 0 ? g.total / g.compras : 0,
      diasDesdeUltima: g.ultimaFecha ? Math.floor((ahora - new Date(g.ultimaFecha).getTime()) / 86400000) : null
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  if (items.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin clientes en este período'; return }

  const maxTotal = items[0].total || 1

  el.className = ''
  el.innerHTML = `<div class="rank-list">${items.map((c, i) => {
    const pct = (c.total / maxTotal * 100).toFixed(0)
    const ultima = c.diasDesdeUltima !== null
      ? (c.diasDesdeUltima === 0 ? 'Hoy' : `${c.diasDesdeUltima}d`)
      : '—'
    return `<div class="rank-row">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name">${escapeHTML(c.nombre)}</span>
      <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
      <div class="rank-stats">
        <div class="rank-stat"><div class="rank-stat-val">${c.compras}</div><div class="rank-stat-label">compras</div></div>
        <div class="rank-stat"><div class="rank-stat-val">${fmt(c.total)}</div><div class="rank-stat-label">total</div></div>
        <div class="rank-stat"><div class="rank-stat-val">${fmt(c.ticketPromedio)}</div><div class="rank-stat-label">prom.</div></div>
        <div class="rank-stat"><div class="rank-stat-val" style="font-size:0.75rem;color:var(--muted)">${ultima}</div><div class="rank-stat-label">última</div></div>
      </div>
    </div>`
  }).join('')}</div>`
}

// ════════════════════════════════════════════════════════════════════
//  HELPERS DE TENDENCIA
// ════════════════════════════════════════════════════════════════════
function fechaKeyLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todasVentasMismoDia(ventas) {
  const keys = new Set()
  for (const v of ventas) {
    const d = new Date(v.fecha)
    if (isNaN(d.getTime())) continue
    keys.add(fechaKeyLocal(d))
    if (keys.size > 1) return false
  }
  return true
}

function agruparTendencia(ventas) {
  const usarHora = periodoActual === 'hoy' || (periodoActual === 'custom' && todasVentasMismoDia(ventas))
  const grupos = {}
  for (const v of ventas) {
    const d = new Date(v.fecha)
    if (isNaN(d.getTime())) continue
    const total = Number(v.total || 0)
    if (!Number.isFinite(total)) continue
    const key = usarHora
      ? `${String(d.getHours()).padStart(2, '0')}:00`
      : fechaKeyLocal(d)
    if (!grupos[key]) grupos[key] = {
      key,
      label: usarHora ? key : d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
      total: 0,
      count: 0
    }
    grupos[key].total += total
    grupos[key].count++
  }
  return {
    tipo: usarHora ? 'hora' : 'dia',
    puntos: Object.values(grupos).sort((a, b) => a.key.localeCompare(b.key))
  }
}

// ════════════════════════════════════════════════════════════════════
//  TENDENCIA DE VENTAS — Helper de barras (1–2 puntos)
// ════════════════════════════════════════════════════════════════════
function renderTendenciaBarras(puntos, maxTotal) {
  return `<div class="tendencia-bars">${puntos.map(p => {
    const pct = maxTotal > 0 ? Math.max((p.total / maxTotal) * 100, 4) : 0
    return `<div class="tendencia-bar-row">
      <div class="tendencia-bar-head">
        <span class="tendencia-bar-label">${escapeHTML(p.label)}</span>
        <strong>${fmt(p.total)}</strong>
      </div>
      <div class="tendencia-bar-track">
        <div class="tendencia-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="tendencia-bar-sub">${p.count} venta${p.count !== 1 ? 's' : ''}</div>
    </div>`
  }).join('')}</div>`
}

// ════════════════════════════════════════════════════════════════════
//  TENDENCIA DE VENTAS — Card analítica adaptativa
// ════════════════════════════════════════════════════════════════════
function renderTendencia(ventas) {
  const el = $id('rep-tendencia')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin datos suficientes para tendencia'; return }

  const { tipo, puntos } = agruparTendencia(ventas)
  if (puntos.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin datos suficientes para tendencia'; return }

  const maxTotal = Math.max(...puntos.map(p => p.total), 0)
  const totalAcum = puntos.reduce((s, p) => s + p.total, 0)
  const promedio = puntos.length > 0 ? totalAcum / puntos.length : 0

  const pico = puntos.reduce((best, p) => p.total > best.total ? p : best)
  const primero = puntos[0]
  const ultimo = puntos[puntos.length - 1]
  // Badge de tendencia
  let badgeCls = 'tendencia-badge-neu', badgeTxt = 'Sin cambio'
  if (puntos.length === 1) {
    badgeTxt = 'Actividad única'
  } else if (primero.total > 0) {
    const diff = ((ultimo.total - primero.total) / primero.total) * 100
    if (diff > 0.5) { badgeCls = 'tendencia-badge-pos'; badgeTxt = `+${diff.toFixed(1)}%` }
    else if (diff < -0.5) { badgeCls = 'tendencia-badge-neg'; badgeTxt = `${diff.toFixed(1)}%` }
  }

  const picoVal = fmt(pico.total)
  const promLabel = tipo === 'hora' ? 'Promedio por hora' : 'Promedio diario'
  const actLabel = tipo === 'hora' ? 'horas' : 'días'
  const title = tipo === 'hora' ? 'Ventas por hora' : 'Ventas por día'
  const msgUnico = tipo === 'hora' ? 'Una hora con venta registrada' : 'Un día con venta registrado'

  let chartContent = renderTendenciaBarras(puntos, maxTotal)
  if (puntos.length === 1) {
    chartContent += `<div class="tendencia-note">${escapeHTML(msgUnico)}</div>`
  }

  el.className = ''
  el.innerHTML = `<div class="tendencia-card">
    <div class="tendencia-head">
      <span class="tendencia-title">${escapeHTML(title)}</span>
      <span class="tendencia-badge ${badgeCls}">${escapeHTML(badgeTxt)}</span>
    </div>
    <div class="tendencia-chart">${chartContent}</div>
    <div class="tendencia-stats">
      <div class="tendencia-chip"><span>Pico</span><strong>${escapeHTML(pico.label)} · ${picoVal}</strong></div>
      <div class="tendencia-chip"><span>${escapeHTML(promLabel)}</span><strong>${fmt(promedio)}</strong></div>
      <div class="tendencia-chip"><span>Actividad</span><strong>${puntos.length} ${escapeHTML(actLabel)}</strong></div>
    </div>
  </div>`
}

// ════════════════════════════════════════════════════════════════════
//  PRODUCTOS MÁS RENTABLES
// ════════════════════════════════════════════════════════════════════
function renderProductosRentables(ventas, costoMeta) {
  const el = $id('rep-rentables')
  if (!costoMeta.costoDisponible) { el.className = 'panel-empty'; el.textContent = 'Rentabilidad no disponible: faltan costos en el reporte'; return }
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin productos vendidos en este período'; return }

  const grupos = {}
  for (const v of ventas) {
    if (!v.detalles) continue
    for (const d of v.detalles) {
      if (!d.producto) continue
      const pid = d.productoId
      if (!grupos[pid]) grupos[pid] = {
        nombre: d.producto.nombre,
        codigo: d.producto.codigoInterno || '',
        imagenUrl: d.producto.imagenUrl || null,
        unidades: 0,
        ingresoTotal: 0,
        costoTotal: 0,
        tieneCosto: false
      }
      grupos[pid].unidades += parseFloat(d.cantidad || 0)
      grupos[pid].ingresoTotal += parseFloat(d.subtotal || 0)
      const costoU = d.producto.costoPromedio || d.producto.costo
      if (costoU !== null && costoU !== undefined) {
        const costoVal = Number(costoU)
        if (Number.isFinite(costoVal) && costoVal > 0) {
          grupos[pid].costoTotal += parseFloat(d.cantidad || 0) * costoVal
          grupos[pid].tieneCosto = true
        }
      }
    }
  }

  let items = Object.values(grupos)
    .filter(g => g.tieneCosto)
    .map(g => ({
      ...g,
      margenTotal: g.ingresoTotal - g.costoTotal,
      margenPct: g.ingresoTotal > 0 ? ((g.ingresoTotal - g.costoTotal) / g.ingresoTotal * 100) : 0
    }))
    .sort((a, b) => b.margenTotal - a.margenTotal)
    .slice(0, 10)

  if (items.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin productos con margen disponible en este período'; return }

  const maxMargen = Math.max(...items.map(p => Math.abs(p.margenTotal)), 1)

  el.className = ''
  const badgeHtml = costoMeta.margenEstimado ? '<span class="rent-badge">estimado</span>' : ''
  el.innerHTML = `<div class="rent-list">${items.map(p => {
    const pct = (p.margenTotal / maxMargen * 100).toFixed(0)
    const imgHtml = p.imagenUrl
      ? `<img class="prod-thumb" src="${escapeHTML(p.imagenUrl)}" alt="${escapeHTML(p.nombre)}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='${placeholderSvg()}'" />`
      : placeholderSvg()
    const margenCls = p.margenTotal >= 0 ? 'rent-margen-pos' : 'rent-margen-neg'
    return `<div class="rent-row">
      ${imgHtml}
      <div class="rent-info">
        <div class="rent-name" title="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} ${badgeHtml}</div>
        <div class="rent-meta">${escapeHTML(p.codigo)} &middot; ${fmtEntero(p.unidades)} unds</div>
      </div>
      <div class="rent-stats">
        <div class="rent-stat"><div class="rent-stat-val">${fmt(p.ingresoTotal)}</div><div class="rent-stat-label">ingreso</div></div>
        <div class="rent-stat"><div class="rent-stat-val ${margenCls}">${fmt(p.margenTotal)}</div><div class="rent-stat-label">margen</div></div>
        <div class="rent-stat"><div class="rent-stat-val ${margenCls}">${p.margenPct.toFixed(1)}%</div><div class="rent-stat-label">margen %</div></div>
      </div>
      <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${pct}%;background:${p.margenTotal >= 0 ? '#60d080' : '#ff6b6b'}"></div></div>
    </div>`
  }).join('')}</div>`
}

// ════════════════════════════════════════════════════════════════════
//  VENTAS BAJO COSTO
// ════════════════════════════════════════════════════════════════════
function renderVentasBajoCosto(ventas, costoMeta) {
  const el = $id('rep-bajocosto')
  if (!costoMeta.costoDisponible) { el.className = 'panel-empty'; el.textContent = 'No se puede validar ventas bajo costo: faltan costos'; return }
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  const alertas = []
  for (const v of ventas) {
    if (!v.detalles) continue
    for (const d of v.detalles) {
      if (!d.producto) continue
      let precioU = d.precioUnitario
      if ((precioU === null || precioU === undefined) && d.cantidad > 0) {
        precioU = parseFloat(d.subtotal || 0) / parseFloat(d.cantidad)
      }
      if (!Number.isFinite(precioU) || precioU <= 0) continue
      const costoU = d.producto.costoPromedio || d.producto.costo
      if (costoU === null || costoU === undefined) continue
      const costoVal = Number(costoU)
      if (!Number.isFinite(costoVal) || costoVal <= 0) continue
      if (precioU < costoVal) {
        const cant = parseFloat(d.cantidad || 0)
        const perdida = (costoVal - precioU) * cant
        alertas.push({
          producto: d.producto.nombre,
          folio: v.folio || '—',
          cantidad: cant,
          precioUnitario: precioU,
          costo: costoVal,
          perdida: perdida,
          label: costoMeta.margenEstimado ? 'Posible venta bajo costo' : 'Venta bajo costo confirmada'
        })
      }
    }
  }

  alertas.sort((a, b) => b.perdida - a.perdida)
  const top = alertas.slice(0, 10)

  if (top.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas detectadas por debajo del costo'; return }

  el.className = ''
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">${top.map(a => `
    <div class="bajo-alerta">
      <span class="bajo-alerta-icon">&#9888;</span>
      <div class="bajo-alerta-body">
        <div class="bajo-alerta-label">${escapeHTML(a.label)}</div>
        <strong>${escapeHTML(a.producto)}</strong>
        <span style="color:var(--muted)"> &middot; ${fmt(a.cantidad)} unds &middot; a $${a.precioUnitario.toFixed(2)} / costo $${a.costo.toFixed(2)}</span>
        <span class="bajo-alerta-folio">${a.folio}</span>
      </div>
      <span class="bajo-alerta-perdida">-${fmt(a.perdida)}</span>
    </div>
  `).join('')}</div>`
}

// ════════════════════════════════════════════════════════════════════
//  FILTROS GLOBALES
// ════════════════════════════════════════════════════════════════════
function obtenerFiltros() {
  const cat = $id('filtro-categoria')
  const ven = $id('filtro-vendedor')
  const zon = $id('filtro-zona')
  const usuario = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
  return {
    categoriaId: cat ? cat.value || null : null,
    vendedorId: ven ? ven.value || null : null,
    sucursalId: zon ? zon.value || null : (usuario.sucursalId || null)
  }
}

async function cargarFiltros() {
  try {
    const cats = await apiFetch('/productos/categorias').catch(() => null)
    const catSelect = $id('filtro-categoria')
    if (cats && Array.isArray(cats) && catSelect) {
      // Limpiar (conservar "Todas")
      while (catSelect.options.length > 1) catSelect.remove(1)
      for (const c of cats) {
        const opt = document.createElement('option')
        opt.value = c.id
        opt.textContent = c.nombre
        catSelect.appendChild(opt)
      }
    }

    const usuario = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
    const venSelect = $id('filtro-vendedor')
    if (venSelect && usuario.rol !== 'ADMIN_SUCURSAL') {
      // Intentar cargar vendedores desde /usuarios/vendedores o similar
      try {
        const vendedores = await apiFetch('/usuarios/vendedores').catch(() => null)
        if (vendedores && Array.isArray(vendedores)) {
          while (venSelect.options.length > 1) venSelect.remove(1)
          for (const v of vendedores) {
            const opt = document.createElement('option')
            opt.value = v.id
            opt.textContent = v.nombre
            venSelect.appendChild(opt)
          }
        }
      } catch (_) {
        // Vendedores no disponible, extraer de datos actuales como fallback
        venSelect.disabled = true
        venSelect.title = 'Filtro no disponible'
      }
    } else if (venSelect) {
      venSelect.disabled = true
    }

    const zonSelect = $id('filtro-zona')
    if (zonSelect && (usuario.rol === 'SUPERADMIN' || usuario.rol === 'PLATFORM_ADMIN')) {
      try {
        const sucs = await apiFetch('/sucursales').catch(() => null)
        const data = sucs?.data || sucs?.sucursales || sucs || []
        if (Array.isArray(data) && data.length > 0) {
          while (zonSelect.options.length > 1) zonSelect.remove(1)
          for (const s of data) {
            const opt = document.createElement('option')
            opt.value = s.id
            opt.textContent = s.nombre
            zonSelect.appendChild(opt)
          }
        }
      } catch (_) {
        zonSelect.disabled = true
      }
    } else if (zonSelect) {
      zonSelect.value = usuario.sucursalId || ''
      zonSelect.disabled = true
    }
  } catch (e) {
    console.warn('No se pudieron cargar filtros:', e.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  STOCK SCROLL
// ════════════════════════════════════════════════════════════════════
function scrollAStock() {
  const section = $id('stock-section')
  const toggle = $id('stock-section')
  if (toggle && toggle.classList.contains('collapsed')) {
    toggle.classList.remove('collapsed')
    const chev = $id('stock-chevron')
    if (chev) chev.classList.remove('collapsed')
  }
  setTimeout(() => {
    document.getElementById('stock-section-toggle')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 100)
}

// ════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const fechaEl = $id('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX',{ weekday:'long', year:'numeric', month:'long', day:'numeric' })

  // Toolbar collapse mostrar
  const panelesExtras = $id('rep-panels-extras')
  if (panelesExtras) panelesExtras.style.display = 'grid'

  // Botones de período
  document.querySelectorAll('.btn-periodo').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-periodo').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      periodoActual = btn.dataset.periodo
      const custom = $id('rep-custom')
      if (custom) custom.style.display = periodoActual === 'custom' ? 'flex' : 'none'
      if (periodoActual !== 'custom') cargarReportes()
    })
  })

  // Aplicar personalizado
  $id('btn-aplicar')?.addEventListener('click', () => {
    desdeCustom = $id('rep-desde').value
    hastaCustom = $id('rep-hasta').value
    if (!desdeCustom || !hastaCustom) { jeshaToast('Selecciona ambas fechas', 'warning'); return }
    cargarReportes()
  })

  // Filtros globales
  $id('filtro-categoria')?.addEventListener('change', cargarReportes)
  $id('filtro-vendedor')?.addEventListener('change', cargarReportes)
  $id('filtro-zona')?.addEventListener('change', cargarReportes)

  // Click en alertas → scroll a stock
  $id('kpi-card-alertas')?.addEventListener('click', scrollAStock)

  // Stock toggle
  const stockToggle = $id('stock-section-toggle')
  if (stockToggle) {
    stockToggle.addEventListener('click', (e) => {
      // No colapsar si click en botones internos
      if (e.target.closest('.stock-collapse-btn') || e.target.closest('button')) return
      const section = $id('stock-section')
      const chev = $id('stock-chevron')
      if (!section) return
      const isCollapsed = section.classList.toggle('collapsed')
      if (chev) chev.classList.toggle('collapsed', isCollapsed)
    })
  }
  $id('stock-toggle-btn')?.addEventListener('click', (e) => {
    e.stopPropagation()
    const section = $id('stock-section')
    const chev = $id('stock-chevron')
    if (!section) return
    const isCollapsed = section.classList.toggle('collapsed')
    if (chev) chev.classList.toggle('collapsed', isCollapsed)
  })

  // Cargar filtros y datos
  Promise.all([
    cargarFiltros()
  ]).then(() => {
    cargarReportes()
    initStockReport()
  })
})

// ════════════════════════════════════════════════════════════════════
//  REPORTE DE STOCK DIARIO (íntegro, sin cambios)
// ════════════════════════════════════════════════════════════════════

let stockData = null

function setStockFechaDefault() {
  const el = $id('stock-fecha')
  if (el && !el.value) el.value = new Date().toISOString().slice(0, 10)
}

async function cargarSucursalesStock() {
  const select = $id('stock-sucursal')
  if (!select || select.options.length > 1) return
  try {
    const usuario = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
    if (usuario.rol === 'SUPERADMIN' || usuario.rol === 'PLATFORM_ADMIN') {
      const data = await apiFetch('/sucursales')
      const sucs = data?.data || data?.sucursales || data || []
      sucs.forEach(s => {
        const opt = document.createElement('option')
        opt.value = s.id
        opt.textContent = s.nombre
        select.appendChild(opt)
      })
    } else {
      const opt = document.createElement('option')
      opt.value = usuario.sucursalId || 1
      opt.textContent = 'Mi sucursal'
      select.appendChild(opt)
    }
    select.value = usuario.sucursalId || 1
  } catch (e) {
    console.warn('No se pudieron cargar sucursales:', e.message)
  }
}

function setStockLoading() {
  const ids = ['stock-sin-stock', 'stock-stock-bajo', 'stock-sugerencias']
  ids.forEach(id => {
    const el = $id(id)
    if (el) { el.className = 'panel-empty'; el.innerHTML = '<div class="spinner"></div>' }
  })
}

function cargarReporteStock() {
  if (isLoadingStock) return
  if (stockLoadTimeout) clearTimeout(stockLoadTimeout)
  stockLoadTimeout = setTimeout(async () => {
    isLoadingStock = true
    try {
      const fecha = $id('stock-fecha')?.value
      const sucursalId = $id('stock-sucursal')?.value
      if (!fecha) { jeshaToast('Selecciona una fecha', 'warning'); isLoadingStock = false; return }

      setStockLoading()

      const params = new URLSearchParams({ fecha })
      if (sucursalId) params.append('sucursalId', sucursalId)
      if (soloNuevosMode) params.append('soloNuevos', 'true')
      const res = await apiFetch(`/reportes/stock?${params.toString()}`)
      stockData = res?.data || res
      renderStockReport(stockData)
    } catch (err) {
      console.error('❌ Error cargando reporte stock:', err.message)
      const ids = ['stock-sin-stock', 'stock-stock-bajo', 'stock-sugerencias']
      ids.forEach(id => { const el = $id(id); if (el) { el.className = 'panel-empty'; el.textContent = 'Error cargando datos' } })
    } finally {
      isLoadingStock = false
    }
  }, 150)
}

function renderStockReport(data) {
  if (!data) return
  const r = data.resumen || {}

  setText('skpi-con-stock', r.conStock ?? '—')
  setText('skpi-stock-bajo', r.stockBajo ?? '—')
  setText('skpi-sin-stock', r.sinStock ?? '—')
  setText('skpi-alertas', r.alertasActivasCount ?? '—')
  setText('skpi-nuevos-sin', `nuevos hoy: ${r.nuevosSinStock ?? 0}`)
  setText('skpi-nuevos-bajo', `nuevos hoy: ${r.nuevosStockBajo ?? 0}`)
  const mov = r.movimientosDelDia || {}
  setText('skpi-mov-dia', `movs.: ${mov.countEntradas ?? 0} ent. / ${mov.countSalidas ?? 0} sal.`)

  setText('badge-sin-stock', r.sinStock ?? 0)
  setText('badge-stock-bajo', r.stockBajo ?? 0)
  setText('badge-sugerencias', data.sugerenciasReorden?.length ?? 0)

  renderNuevosHoy(data.nuevosHoySin || [], data.nuevosHoyBajo || [])

  if (soloNuevosMode) {
    const sinEl = $id('stock-sin-stock')
    if (sinEl) { sinEl.className = 'panel-empty'; sinEl.textContent = '✅ Filtrado: solo productos nuevos hoy' }
    const bajoEl = $id('stock-stock-bajo')
    if (bajoEl) { bajoEl.className = 'panel-empty'; bajoEl.textContent = '✅ Filtrado: solo productos nuevos hoy' }
    setText('badge-sin-stock', 0)
    setText('badge-stock-bajo', 0)
  } else {
    renderSinStock(data.sinStock || [])
    renderStockBajo(data.stockBajo || [])
  }
  renderSugerencias(data.sugerenciasReorden || [])
}

function setText(id, val) {
  const el = $id(id)
  if (el) el.textContent = val
}

function renderNuevosHoy(sinStock, stockBajo) {
  const nuevosSin = sinStock.filter(p => p.esNuevo)
  const nuevosBajo = stockBajo.filter(p => p.esNuevo)
  const total = nuevosSin.length + nuevosBajo.length
  const el = $id('stock-nuevos-hoy')
  if (!el) return
  if (total === 0) { el.style.display = 'none'; return }

  el.style.display = 'block'
  el.innerHTML = `
    <section class="panel-grid" style="margin-bottom:14px;">
      <article class="panel" style="grid-column:1/-1;border:2px solid #42a5f5;">
        <div class="panel-header" style="background:linear-gradient(135deg,rgba(33,150,243,0.08),transparent);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#42a5f5" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <h3 style="color:#42a5f5;">Nuevos Hoy</h3>
          <span class="stock-badge" style="background:#42a5f5;">${total}</span>
        </div>
        <table class="stock-table"><thead><tr>
          <th>Código</th><th>Producto</th><th>Depto.</th><th class="num">Stock</th><th class="num">Mín</th>
          <th class="num">V7d</th><th class="num">V30d</th><th class="num">Sug.</th><th>Proveedor</th><th>Urg.</th>
        </tr></thead><tbody>
          ${nuevosSin.map(p => `<tr class="sin-stock">
            <td><span class="prod-code">${escapeHTML(p.codigoInterno)}</span></td>
            <td>${escapeHTML(p.nombre)} <span class="stock-tag stock-tag-new">NUEVO HOY</span></td>
            <td>${escapeHTML(p.departamento)}</td>
            <td class="num">${p.stockActual}</td>
            <td class="num">${p.stockMinimo}</td>
            <td class="num">${p.velocidad7d || 0}</td>
            <td class="num">${p.velocidad30d || 0}</td>
            <td class="num"><strong>${p.sugerenciaReorden || 0}</strong></td>
            <td class="proveedor-col" title="${escapeHTML(p.proveedor)}">${p.proveedor === '—' ? '-' : escapeHTML(p.proveedor)}</td>
            <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'MÁX' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
          </tr>`).join('')}
          ${nuevosBajo.map(p => `<tr class="stock-bajo">
            <td><span class="prod-code">${escapeHTML(p.codigoInterno)}</span></td>
            <td>${escapeHTML(p.nombre)} <span class="stock-tag stock-tag-new">NUEVO HOY</span></td>
            <td>${escapeHTML(p.departamento)}</td>
            <td class="num">${p.stockActual}</td>
            <td class="num">${p.stockMinimo}</td>
            <td class="num">${p.velocidad7d || 0}</td>
            <td class="num">${p.velocidad30d || 0}</td>
            <td class="num"><strong>${p.sugerenciaReorden || 0}</strong></td>
            <td class="proveedor-col" title="${escapeHTML(p.proveedor)}">${p.proveedor === '—' ? '-' : escapeHTML(p.proveedor)}</td>
            <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'MÁX' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
          </tr>`).join('')}
        </tbody></table>
      </article>
    </section>`
}

function renderSinStock(items) {
  const el = $id('stock-sin-stock')
  if (!el) return
  if (items.length === 0) { el.className = 'stock-empty'; el.textContent = '✅ Sin productos en esta categoría'; return }

  el.className = ''
  el.innerHTML = `<table class="stock-table"><thead><tr>
    <th>Código</th><th>Producto</th><th>Depto.</th><th class="num">Stock</th><th class="num">Mín</th>
    <th class="num">V7d</th><th class="num">V30d</th><th class="num">Sug.</th><th>Proveedor</th><th>Urg.</th>
  </tr></thead><tbody>
    ${items.map(p => `<tr class="sin-stock">
      <td><span class="prod-code">${escapeHTML(p.codigoInterno)}</span></td>
      <td>${escapeHTML(p.nombre)}${p.esNuevo ? ' <span class="stock-tag stock-tag-new">NUEVO</span>' : ''}</td>
      <td>${escapeHTML(p.departamento)}</td>
      <td class="num">${p.stockActual}</td>
      <td class="num">${p.stockMinimo}</td>
      <td class="num">${p.velocidad7d || 0}</td>
      <td class="num">${p.velocidad30d || 0}</td>
      <td class="num"><strong>${p.sugerenciaReorden || 0}</strong></td>
      <td class="proveedor-col" title="${escapeHTML(p.proveedor)}">${p.proveedor === '—' ? '-' : escapeHTML(p.proveedor)}</td>
      <td class="num ${p.urgencia === 5 ? 'urg-max' : 'urg-alta'}">${p.urgencia === 5 ? 'MÁX' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
    </tr>`).join('')}
  </tbody></table>`
}

function renderStockBajo(items) {
  const el = $id('stock-stock-bajo')
  if (!el) return
  if (items.length === 0) { el.className = 'stock-empty'; el.textContent = '✅ Sin productos en esta categoría'; return }

  el.className = ''
  el.innerHTML = `<table class="stock-table"><thead><tr>
    <th>Código</th><th>Producto</th><th>Depto.</th><th class="num">Stock</th><th class="num">Mín</th>
    <th class="num">V7d</th><th class="num">V30d</th><th class="num">Sug.</th><th>Proveedor</th><th>Urg.</th>
  </tr></thead><tbody>
    ${items.map(p => `<tr class="stock-bajo">
      <td><span class="prod-code">${escapeHTML(p.codigoInterno)}</span></td>
      <td>${escapeHTML(p.nombre)}${p.esNuevo ? ' <span class="stock-tag stock-tag-new">NUEVO</span>' : ''}</td>
      <td>${escapeHTML(p.departamento)}</td>
      <td class="num">${p.stockActual}</td>
      <td class="num">${p.stockMinimo}</td>
      <td class="num">${p.velocidad7d || 0}</td>
      <td class="num">${p.velocidad30d || 0}</td>
      <td class="num"><strong>${p.sugerenciaReorden || 0}</strong></td>
      <td class="proveedor-col" title="${escapeHTML(p.proveedor)}">${p.proveedor === '—' ? '-' : escapeHTML(p.proveedor)}</td>
      <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'MÁX' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
    </tr>`).join('')}
  </tbody></table>`
}

let sugerenciaPage = 1
const SUGERENCIA_LIMIT = 20
let sugerenciaItems = []

function renderSugerencias(items) {
  const el = $id('stock-sugerencias')
  if (!el) return
  sugerenciaPage = 1
  sugerenciaItems = items
  if (items.length === 0) { el.className = 'stock-empty'; el.textContent = '✅ Sin sugerencias de reorden'; return }

  renderSugerenciaPagina()
}

function renderSugerenciaPagina() {
  const el = $id('stock-sugerencias')
  if (!el) return
  const items = sugerenciaItems
  const totalPages = Math.ceil(items.length / SUGERENCIA_LIMIT)
  const start = (sugerenciaPage - 1) * SUGERENCIA_LIMIT
  const page = items.slice(start, start + SUGERENCIA_LIMIT)

  el.className = ''
  el.innerHTML = `<table class="stock-table"><thead><tr>
    <th>Producto</th><th class="num">Stock</th><th class="num">Mín</th><th class="num">V30d</th>
    <th class="num">Sugerido</th><th class="num">Costo U.</th><th class="num">Total Est.</th><th>Proveedor</th><th>Tel.</th><th>Urg.</th>
  </tr></thead><tbody>
    ${page.map(p => {
      const costo = p.proveedorCosto || p.costo || 0
      return `<tr class="${p.stockActual <= 0 ? 'sin-stock' : 'stock-bajo'}">
        <td>${escapeHTML(p.nombre)}</td>
        <td class="num">${p.stockActual}</td>
        <td class="num">${p.stockMinimo}</td>
        <td class="num">${p.velocidad30d || 0}</td>
        <td class="num"><strong>${p.sugerenciaReorden}</strong></td>
        <td class="num">${fmt(costo)}</td>
        <td class="num">${fmt(p.sugerenciaReorden * costo)}</td>
        <td class="proveedor-col" title="${escapeHTML(p.proveedor)}">${p.proveedor === '—' ? '-' : escapeHTML(p.proveedor)}</td>
        <td class="tel-col">${p.proveedorTelefono === '—' ? '-' : escapeHTML(p.proveedorTelefono)}</td>
        <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'M\u00c1X' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
      </tr>`
    }).join('')}
  </tbody></table>
  <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 0 4px;font-size:0.82rem;color:var(--muted,#7a8599);font-family:'Barlow',sans-serif;">
    <button class="sug-pag-btn" data-page="${sugerenciaPage - 1}" ${sugerenciaPage <= 1 ? 'disabled' : ''} style="background:none;border:1px solid var(--panel-border,rgba(255,255,255,0.07));border-radius:6px;padding:4px 12px;color:var(--muted,#7a8599);cursor:pointer;font-size:0.78rem;${sugerenciaPage <= 1 ? 'opacity:0.3;cursor:default;' : ''}">‹ Anterior</button>
    <span style="font-weight:600;">P\u00e1g. ${sugerenciaPage} de ${totalPages}</span>
    <button class="sug-pag-btn" data-page="${sugerenciaPage + 1}" ${sugerenciaPage >= totalPages ? 'disabled' : ''} style="background:none;border:1px solid var(--panel-border,rgba(255,255,255,0.07));border-radius:6px;padding:4px 12px;color:var(--muted,#7a8599);cursor:pointer;font-size:0.78rem;${sugerenciaPage >= totalPages ? 'opacity:0.3;cursor:default;' : ''}">Siguiente ›</button>
  </div>`

  el.querySelectorAll('.sug-pag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pg = parseInt(btn.dataset.page)
      if (pg < 1 || pg > totalPages) return
      sugerenciaPage = pg
      renderSugerenciaPagina()
    })
  })
}

async function descargarExcelStock() {
  const fecha = $id('stock-fecha')?.value
  const sucursalId = $id('stock-sucursal')?.value
  if (!fecha) { jeshaToast('Selecciona una fecha', 'warning'); return }

  const params = new URLSearchParams({ fecha })
  if (sucursalId) params.append('sucursalId', sucursalId)

  const token = localStorage.getItem('jesha_token')
  const api = window.__JESHA_API_URL__ || 'http://localhost:3000'

  try {
    const res = await fetch(`${api}/reportes/stock/excel?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-stock-${fecha}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (err) {
    jeshaToast('Error al descargar Excel: ' + err.message, 'error')
  }
}

async function descargarPdfStock() {
  const fecha = $id('stock-fecha')?.value
  const sucursalId = $id('stock-sucursal')?.value
  if (!fecha) { jeshaToast('Selecciona una fecha', 'warning'); return }

  const params = new URLSearchParams({ fecha })
  if (sucursalId) params.append('sucursalId', sucursalId)

  const token = localStorage.getItem('jesha_token')
  const api = window.__JESHA_API_URL__ || 'http://localhost:3000'

  try {
    const res = await fetch(`${api}/reportes/stock/pdf?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-stock-${fecha}.html`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (err) {
    jeshaToast('Error al descargar PDF: ' + err.message, 'error')
  }
}

function initStockReport() {
  setStockFechaDefault()

  $id('btn-stock-actualizar')?.addEventListener('click', cargarReporteStock)
  $id('btn-stock-excel')?.addEventListener('click', descargarExcelStock)
  $id('btn-stock-pdf')?.addEventListener('click', descargarPdfStock)

  $id('stock-fecha')?.addEventListener('change', () => {
    const fecha = $id('stock-fecha').value
    if (fecha) cargarReporteStock()
  })

  Promise.all([cargarSucursalesStock()]).then(() => cargarReporteStock())
}

console.log('✅ reportes.js cargado')
