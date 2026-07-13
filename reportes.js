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


// ════════════════════════════════════════════════════════════════════
//  REPORTES.JS
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!TOKEN) { localStorage.setItem('redirect_after_login','reportes.html'); window.location.href = 'login.html'; throw new Error() }

const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—'

// ── Estado de período ──
let periodoActual = 'hoy'
let desdeCustom   = null
let hastaCustom   = null

const soloNuevosMode = new URLSearchParams(window.location.search).get('soloNuevos') === 'true'
let isLoadingStock = false
let stockLoadTimeout = null

// apiFetch global disponible desde sidebar.js

// ════════════════════════════════════════════════════════════════════
//  CALCULAR RANGO DE FECHAS
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

// ════════════════════════════════════════════════════════════════════
//  CARGAR TODO
// ════════════════════════════════════════════════════════════════════
async function cargarReportes() {
  const { desde, hasta } = calcularRango(periodoActual)
  setLoading()

  try {
    const data   = await apiFetch(`/ventas/reporte-resumen?desde=${desde}&hasta=${hasta}`)
    const { ventas, topProductos } = data
    procesarVentas(ventas, topProductos)
  } catch (err) {
    console.error('❌ Reportes:', err.message)
    document.querySelectorAll('#rep-metodos,#rep-productos,#rep-por-dia,#rep-clientes')
      .forEach(el => { el.className = 'panel-empty'; el.textContent = 'Error cargando datos' })
  }
}

function setLoading() {
  document.querySelectorAll('#rep-metodos,#rep-productos,#rep-por-dia,#rep-clientes')
    .forEach(el => { el.className = 'loading-rep'; el.innerHTML = '<div class="spinner"></div>' })
}

// ════════════════════════════════════════════════════════════════════
//  PROCESAR VENTAS
// ════════════════════════════════════════════════════════════════════
function procesarVentas(ventas, topProductos = null) {
  // Filtrar ventas canceladas
  const ventasActivas = ventas.filter(v => v.estado !== 'CANCELADA')

  const totalIngresos  = ventasActivas.reduce((s, v) => s + parseFloat(v.total), 0)
  const ticketPromedio = ventasActivas.length > 0 ? totalIngresos / ventasActivas.length : 0

  // KPIs
  document.getElementById('kpi-ingresos').textContent     = fmt(totalIngresos)
  document.getElementById('kpi-ingresos-sub').textContent = `${ventasActivas.length} venta${ventasActivas.length !== 1 ? 's' : ''}`
  document.getElementById('kpi-ticket').textContent       = fmt(ticketPromedio)

  const efectivo      = ventasActivas.filter(v => v.metodoPago === 'EFECTIVO')
  const tarjeta       = ventasActivas.filter(v => ['CREDITO','DEBITO','TRANSFERENCIA'].includes(v.metodoPago))
  const creditoCli    = ventasActivas.filter(v => v.metodoPago === 'CREDITO_CLIENTE')
  const mixto         = ventasActivas.filter(v => v.metodoPago === 'MIXTO')
  const sumEfectivo   = efectivo.reduce((s,v) => s + parseFloat(v.total), 0)
  const sumTarjeta    = tarjeta.reduce((s,v) => s + parseFloat(v.total), 0)
  const sumCreditoCli = creditoCli.reduce((s,v) => s + parseFloat(v.total), 0)
  const sumMixto      = mixto.reduce((s,v) => s + parseFloat(v.total), 0)

  document.getElementById('kpi-efectivo').textContent     = fmt(sumEfectivo)
  document.getElementById('kpi-efectivo-sub').textContent = `${efectivo.length} ventas`
  document.getElementById('kpi-tarjeta').textContent      = fmt(sumTarjeta)
  document.getElementById('kpi-tarjeta-sub').textContent  = `${tarjeta.length} ventas`

  // Paneles
  renderMetodos(ventasActivas, totalIngresos)
  renderProductos(ventasActivas, topProductos)
  renderPorDia(ventasActivas)
  renderClientes(ventasActivas, totalIngresos)
}

// ── Ventas por método de pago ──
function renderMetodos(ventas, totalIngresos) {
  const el = document.getElementById('rep-metodos')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  const grupos = {}
  ventas.forEach(v => {
    const m = v.metodoPago === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : v.metodoPago === 'EFECTIVO' ? 'EFECTIVO' : 'TARJETA'
    if (!grupos[m]) grupos[m] = { total: 0, count: 0 }
    grupos[m].total += parseFloat(v.total)
    grupos[m].count++
  })

  const icons  = { EFECTIVO:'💵', TARJETA:'💳', TRANSFERENCIA:'🔄' }
  const labels = { EFECTIVO:'Efectivo', TARJETA:'Tarjeta', TRANSFERENCIA:'Transferencia' }
  const clases = { EFECTIVO:'verde', TARJETA:'azul', TRANSFERENCIA:'naranja' }

  const filas = Object.entries(grupos).sort((a,b) => b[1].total - a[1].total).map(([m, g]) => {
    const pct = totalIngresos > 0 ? (g.total / totalIngresos * 100).toFixed(1) : 0
    return `<tr>
      <td><span class="metodo-icon">${icons[m]}</span> ${labels[m]}</td>
      <td><strong>${fmt(g.total)}</strong></td>
      <td>${g.count}</td>
      <td style="min-width:120px;">
        <div class="barra-wrap">
          <div class="barra"><div class="barra-fill ${clases[m]}" style="width:${pct}%"></div></div>
          <span class="barra-pct">${pct}%</span>
        </div>
      </td>
    </tr>`
  }).join('')

  el.className = ''
  el.innerHTML = `<table class="rep-table"><thead><tr><th>Método</th><th>Total</th><th>Ventas</th><th>Participación</th></tr></thead><tbody>${filas}</tbody></table>`
}

// ── Top productos ──
function renderProductos(ventas, topProductos = null) {
  const el = document.getElementById('rep-productos')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  // Si viene del backend pre-calculado (nuevo endpoint)
  if (topProductos && topProductos.length > 0) {
    const maxCant = topProductos[0].cantidad || 1

    const filas = topProductos.map((p, i) => {
      const pct = ((p.cantidad / maxCant) * 100).toFixed(0)
      return `<tr>
        <td style="color:var(--muted);font-size:0.78rem;text-align:center">${i + 1}</td>
        <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${p.nombre}">
          ${p.nombre}
          ${p.codigo ? `<div style="font-size:0.72rem;color:var(--muted)">${p.codigo}</div>` : ''}
        </td>
        <td style="text-align:center"><strong>${p.cantidad}</strong></td>
        <td><strong>${fmt(p.importe)}</strong></td>
        <td style="min-width:100px;">
          <div class="barra-wrap">
            <div class="barra"><div class="barra-fill azul" style="width:${pct}%"></div></div>
          </div>
        </td>
      </tr>`
    }).join('')

    el.className = ''
    el.innerHTML = `<table class="rep-table">
      <thead><tr>
        <th style="width:32px">#</th>
        <th>Producto</th>
        <th style="width:70px;text-align:center">Unidades</th>
        <th style="width:100px">Importe</th>
        <th>Volumen</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>`
    return
  }

  // Fallback: calcular desde ventas.detalles (backwards compatible)
  const prodMap = {}
  ventas.forEach(v => {
    if (!v.detalles || v.detalles.length === 0) return
    v.detalles.forEach(d => {
      const key = d.productoId
      if (!prodMap[key]) {
        prodMap[key] = { nombre: d.nombre || '—', codigo: d.codigo || '', cantidad: 0, importe: 0 }
      }
      prodMap[key].cantidad += parseFloat(d.cantidad || 0)
      prodMap[key].importe  += parseFloat(d.subtotal || 0)
    })
  })

  const top = Object.values(prodMap)
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 10)

  if (top.length === 0) {
    el.className = 'panel-empty'
    el.textContent = 'No hay detalles de productos disponibles'
    return
  }

  const maxCant = top[0].cantidad || 1

  const filas = top.map((p, i) => {
    const pct = ((p.cantidad / maxCant) * 100).toFixed(0)
    return `<tr>
      <td style="color:var(--muted);font-size:0.78rem;text-align:center">${i + 1}</td>
      <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${p.nombre}">
        ${p.nombre}
        ${p.codigo ? `<div style="font-size:0.72rem;color:var(--muted)">${p.codigo}</div>` : ''}
      </td>
      <td style="text-align:center"><strong>${p.cantidad}</strong></td>
      <td><strong>${fmt(p.importe)}</strong></td>
      <td style="min-width:100px;">
        <div class="barra-wrap">
          <div class="barra"><div class="barra-fill azul" style="width:${pct}%"></div></div>
        </div>
      </td>
    </tr>`
  }).join('')

  el.className = ''
  el.innerHTML = `<table class="rep-table">
    <thead><tr>
      <th style="width:32px">#</th>
      <th>Producto</th>
      <th style="width:70px;text-align:center">Unidades</th>
      <th style="width:100px">Importe</th>
      <th>Volumen</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>`
}

// ── Ventas por día ──
function renderPorDia(ventas) {
  const el = document.getElementById('rep-por-dia')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  const porDia = {}
  ventas.forEach(v => {
    const d = new Date(v.fecha).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})
    if (!porDia[d]) porDia[d] = { total:0, count:0 }
    porDia[d].total += parseFloat(v.total)
    porDia[d].count++
  })

  const maxTotal = Math.max(...Object.values(porDia).map(d => d.total))
  const dias = Object.entries(porDia).sort((a,b) => new Date(a[0]) - new Date(b[0]))

  if (dias.length === 1) {
    const porHora = {}
    ventas.forEach(v => {
      const h = new Date(v.fecha).getHours()
      const key = `${String(h).padStart(2,'0')}:00`
      if (!porHora[key]) porHora[key] = { total:0, count:0 }
      porHora[key].total += parseFloat(v.total)
      porHora[key].count++
    })
    const maxH = Math.max(...Object.values(porHora).map(h => h.total))
    const filas = Object.entries(porHora).sort().map(([h, g]) => {
      const pct = maxH > 0 ? (g.total / maxH * 100).toFixed(0) : 0
      return `<tr>
        <td style="color:var(--muted)">${h}</td>
        <td><strong>${fmt(g.total)}</strong></td>
        <td style="color:var(--muted)">${g.count}</td>
        <td><div class="barra-wrap"><div class="barra"><div class="barra-fill" style="width:${pct}%"></div></div></div></td>
      </tr>`
    }).join('')
    el.className = ''
    el.innerHTML = `<table class="rep-table"><thead><tr><th>Hora</th><th>Total</th><th>Ventas</th><th>Volumen</th></tr></thead><tbody>${filas}</tbody></table>`
    return
  }

  const filas = dias.map(([d, g]) => {
    const pct = maxTotal > 0 ? (g.total / maxTotal * 100).toFixed(0) : 0
    return `<tr>
      <td style="color:var(--muted)">${d}</td>
      <td><strong>${fmt(g.total)}</strong></td>
      <td style="color:var(--muted)">${g.count}</td>
      <td><div class="barra-wrap"><div class="barra"><div class="barra-fill" style="width:${pct}%"></div></div></div></td>
    </tr>`
  }).join('')

  el.className = ''
  el.innerHTML = `<table class="rep-table"><thead><tr><th>Fecha</th><th>Total</th><th>Ventas</th><th>Volumen</th></tr></thead><tbody>${filas}</tbody></table>`
}

// ── Top clientes ──
function renderClientes(ventas, totalIngresos) {
  const el = document.getElementById('rep-clientes')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  const clienteMap = {}
  ventas.forEach(v => {
    const nombre = v.cliente || 'Público general'
    if (!clienteMap[nombre]) clienteMap[nombre] = { total:0, count:0 }
    clienteMap[nombre].total += parseFloat(v.total)
    clienteMap[nombre].count++
  })

  const top  = Object.entries(clienteMap).sort((a,b) => b[1].total - a[1].total).slice(0, 8)
  const maxC = top[0]?.[1].total || 1

  const filas = top.map(([nombre, g], i) => {
    const pct     = (g.total / maxC * 100).toFixed(0)
    const pcTotal = totalIngresos > 0 ? (g.total / totalIngresos * 100).toFixed(1) : 0
    return `<tr>
      <td style="color:var(--muted);font-size:0.78rem">${i+1}</td>
      <td style="max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${nombre}">${nombre}</td>
      <td><strong>${fmt(g.total)}</strong></td>
      <td style="color:var(--muted)">${g.count}</td>
      <td>
        <div class="barra-wrap">
          <div class="barra"><div class="barra-fill verde" style="width:${pct}%"></div></div>
          <span class="barra-pct">${pcTotal}%</span>
        </div>
      </td>
    </tr>`
  }).join('')

  el.className = ''
  el.innerHTML = `<table class="rep-table"><thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Ventas</th><th>Del total</th></tr></thead><tbody>${filas}</tbody></table>`
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const fechaEl = document.getElementById('fecha-actual')
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-MX',{ weekday:'long', year:'numeric', month:'long', day:'numeric' })

  // Botones de período
  document.querySelectorAll('.btn-periodo').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-periodo').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      periodoActual = btn.dataset.periodo
      const custom = document.getElementById('rep-custom')
      custom.style.display = periodoActual === 'custom' ? 'flex' : 'none'
      if (periodoActual !== 'custom') cargarReportes()
    })
  })

  // Aplicar rango personalizado
  document.getElementById('btn-aplicar')?.addEventListener('click', () => {
    desdeCustom = document.getElementById('rep-desde').value
    hastaCustom = document.getElementById('rep-hasta').value
    if (!desdeCustom || !hastaCustom) { jeshaToast('Selecciona ambas fechas', 'warning'); return }
    cargarReportes()
  })

  cargarReportes()
  initStockReport()
})

// ════════════════════════════════════════════════════════════════════
//  REPORTE DE STOCK DIARIO
// ════════════════════════════════════════════════════════════════════

let stockData = null

function setStockFechaDefault() {
  const el = document.getElementById('stock-fecha')
  if (el && !el.value) el.value = new Date().toISOString().slice(0, 10)
}

async function cargarSucursalesStock() {
  const select = document.getElementById('stock-sucursal')
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
    const el = document.getElementById(id)
    if (el) { el.className = 'panel-empty'; el.innerHTML = '<div class="spinner"></div>' }
  })
}

function cargarReporteStock() {
  if (isLoadingStock) return
  if (stockLoadTimeout) clearTimeout(stockLoadTimeout)
  stockLoadTimeout = setTimeout(async () => {
    isLoadingStock = true
    try {
      const fecha = document.getElementById('stock-fecha')?.value
      const sucursalId = document.getElementById('stock-sucursal')?.value
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
      ids.forEach(id => { const el = document.getElementById(id); if (el) { el.className = 'panel-empty'; el.textContent = 'Error cargando datos' } })
    } finally {
      isLoadingStock = false
    }
  }, 150)
}

function renderStockReport(data) {
  if (!data) return
  const r = data.resumen || {}

  // KPIs
  setText('skpi-con-stock', r.conStock ?? '—')
  setText('skpi-stock-bajo', r.stockBajo ?? '—')
  setText('skpi-sin-stock', r.sinStock ?? '—')
  setText('skpi-alertas', r.alertasActivasCount ?? '—')
  setText('skpi-nuevos-sin', `nuevos hoy: ${r.nuevosSinStock ?? 0}`)
  setText('skpi-nuevos-bajo', `nuevos hoy: ${r.nuevosStockBajo ?? 0}`)
  const mov = r.movimientosDelDia || {}
  setText('skpi-mov-dia', `movs.: ${mov.countEntradas ?? 0} ent. / ${mov.countSalidas ?? 0} sal.`)

  // Badges
  setText('badge-sin-stock', r.sinStock ?? 0)
  setText('badge-stock-bajo', r.stockBajo ?? 0)
  setText('badge-sugerencias', data.sugerenciasReorden?.length ?? 0)

  // Nuevos hoy
  renderNuevosHoy(data.nuevosHoySin || [], data.nuevosHoyBajo || [])

  // Paneles
  if (soloNuevosMode) {
    const sinEl = document.getElementById('stock-sin-stock')
    if (sinEl) { sinEl.className = 'panel-empty'; sinEl.textContent = '✅ Filtrado: solo productos nuevos hoy' }
    const bajoEl = document.getElementById('stock-stock-bajo')
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
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

function renderNuevosHoy(sinStock, stockBajo) {
  const nuevosSin = sinStock.filter(p => p.esNuevo)
  const nuevosBajo = stockBajo.filter(p => p.esNuevo)
  const total = nuevosSin.length + nuevosBajo.length
  const el = document.getElementById('stock-nuevos-hoy')
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
            <td><span class="prod-code">${p.codigoInterno}</span></td>
            <td>${p.nombre} <span class="stock-tag stock-tag-new">NUEVO HOY</span></td>
            <td>${p.departamento}</td>
            <td class="num">${p.stockActual}</td>
            <td class="num">${p.stockMinimo}</td>
            <td class="num">${p.velocidad7d || 0}</td>
            <td class="num">${p.velocidad30d || 0}</td>
            <td class="num"><strong>${p.sugerenciaReorden || 0}</strong></td>
            <td class="proveedor-col" title="${p.proveedor}">${p.proveedor === '—' ? '-' : p.proveedor}</td>
            <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'MÁX' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
          </tr>`).join('')}
          ${nuevosBajo.map(p => `<tr class="stock-bajo">
            <td><span class="prod-code">${p.codigoInterno}</span></td>
            <td>${p.nombre} <span class="stock-tag stock-tag-new">NUEVO HOY</span></td>
            <td>${p.departamento}</td>
            <td class="num">${p.stockActual}</td>
            <td class="num">${p.stockMinimo}</td>
            <td class="num">${p.velocidad7d || 0}</td>
            <td class="num">${p.velocidad30d || 0}</td>
            <td class="num"><strong>${p.sugerenciaReorden || 0}</strong></td>
            <td class="proveedor-col" title="${p.proveedor}">${p.proveedor === '—' ? '-' : p.proveedor}</td>
            <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'MÁX' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
          </tr>`).join('')}
        </tbody></table>
      </article>
    </section>`
}

function renderSinStock(items) {
  const el = document.getElementById('stock-sin-stock')
  if (!el) return
  if (items.length === 0) { el.className = 'stock-empty'; el.textContent = '✅ Sin productos en esta categoría'; return }

  el.className = ''
  el.innerHTML = `<table class="stock-table"><thead><tr>
    <th>Código</th><th>Producto</th><th>Depto.</th><th class="num">Stock</th><th class="num">Mín</th>
    <th class="num">V7d</th><th class="num">V30d</th><th class="num">Sug.</th><th>Proveedor</th><th>Urg.</th>
  </tr></thead><tbody>
    ${items.map(p => `<tr class="sin-stock">
      <td><span class="prod-code">${p.codigoInterno}</span></td>
      <td>${p.nombre}${p.esNuevo ? ' <span class="stock-tag stock-tag-new">NUEVO</span>' : ''}</td>
      <td>${p.departamento}</td>
      <td class="num">${p.stockActual}</td>
      <td class="num">${p.stockMinimo}</td>
      <td class="num">${p.velocidad7d || 0}</td>
      <td class="num">${p.velocidad30d || 0}</td>
      <td class="num"><strong>${p.sugerenciaReorden || 0}</strong></td>
      <td class="proveedor-col" title="${p.proveedor}">${p.proveedor === '—' ? '-' : p.proveedor}</td>
      <td class="num ${p.urgencia === 5 ? 'urg-max' : 'urg-alta'}">${p.urgencia === 5 ? 'MÁX' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
    </tr>`).join('')}
  </tbody></table>`
}

function renderStockBajo(items) {
  const el = document.getElementById('stock-stock-bajo')
  if (!el) return
  if (items.length === 0) { el.className = 'stock-empty'; el.textContent = '✅ Sin productos en esta categoría'; return }

  el.className = ''
  el.innerHTML = `<table class="stock-table"><thead><tr>
    <th>Código</th><th>Producto</th><th>Depto.</th><th class="num">Stock</th><th class="num">Mín</th>
    <th class="num">V7d</th><th class="num">V30d</th><th class="num">Sug.</th><th>Proveedor</th><th>Urg.</th>
  </tr></thead><tbody>
    ${items.map(p => `<tr class="stock-bajo">
      <td><span class="prod-code">${p.codigoInterno}</span></td>
      <td>${p.nombre}${p.esNuevo ? ' <span class="stock-tag stock-tag-new">NUEVO</span>' : ''}</td>
      <td>${p.departamento}</td>
      <td class="num">${p.stockActual}</td>
      <td class="num">${p.stockMinimo}</td>
      <td class="num">${p.velocidad7d || 0}</td>
      <td class="num">${p.velocidad30d || 0}</td>
      <td class="num"><strong>${p.sugerenciaReorden || 0}</strong></td>
      <td class="proveedor-col" title="${p.proveedor}">${p.proveedor === '—' ? '-' : p.proveedor}</td>
      <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'MÁX' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
    </tr>`).join('')}
  </tbody></table>`
}

let sugerenciaPage = 1
const SUGERENCIA_LIMIT = 20
let sugerenciaItems = []

function renderSugerencias(items) {
  const el = document.getElementById('stock-sugerencias')
  if (!el) return
  sugerenciaPage = 1
  sugerenciaItems = items
  if (items.length === 0) { el.className = 'stock-empty'; el.textContent = '✅ Sin sugerencias de reorden'; return }

  renderSugerenciaPagina()
}

function renderSugerenciaPagina() {
  const el = document.getElementById('stock-sugerencias')
  if (!el) return
  const items = sugerenciaItems
  const totalPages = Math.ceil(items.length / SUGERENCIA_LIMIT)
  const start = (sugerenciaPage - 1) * SUGERENCIA_LIMIT
  const page = items.slice(start, start + SUGERENCIA_LIMIT)

  const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
  el.className = ''
  el.innerHTML = `<table class="stock-table"><thead><tr>
    <th>Producto</th><th class="num">Stock</th><th class="num">Mín</th><th class="num">V30d</th>
    <th class="num">Sugerido</th><th class="num">Costo U.</th><th class="num">Total Est.</th><th>Proveedor</th><th>Tel.</th><th>Urg.</th>
  </tr></thead><tbody>
    ${page.map(p => {
      const costo = p.proveedorCosto || p.costo || 0
      return `<tr class="${p.stockActual <= 0 ? 'sin-stock' : 'stock-bajo'}">
        <td>${p.nombre}</td>
        <td class="num">${p.stockActual}</td>
        <td class="num">${p.stockMinimo}</td>
        <td class="num">${p.velocidad30d || 0}</td>
        <td class="num"><strong>${p.sugerenciaReorden}</strong></td>
        <td class="num">${fmt(costo)}</td>
        <td class="num">${fmt(p.sugerenciaReorden * costo)}</td>
        <td class="proveedor-col" title="${p.proveedor}">${p.proveedor === '—' ? '-' : p.proveedor}</td>
        <td class="tel-col">${p.proveedorTelefono === '—' ? '-' : p.proveedorTelefono}</td>
        <td class="num ${p.urgencia === 5 ? 'urg-max' : p.urgencia >= 3 ? 'urg-alta' : ''}">${p.urgencia === 5 ? 'M\u00c1X' : p.urgencia >= 3 ? 'ALTA' : 'MED'}</td>
      </tr>`
    }).join('')}
  </tbody></table>
  <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 0 4px;font-size:0.82rem;color:var(--muted,#7a8599);font-family:'Barlow',sans-serif;">
    <button class="sug-pag-btn" data-page="${sugerenciaPage - 1}" ${sugerenciaPage <= 1 ? 'disabled' : ''} style="background:none;border:1px solid var(--panel-border,rgba(255,255,255,0.07));border-radius:6px;padding:4px 12px;color:var(--muted,#7a8599);cursor:pointer;font-size:0.78rem;${sugerenciaPage <= 1 ? 'opacity:0.3;cursor:default;' : ''}">‹ Anterior</button>
    <span style="font-weight:600;">P\u00e1g. ${sugerenciaPage} de ${totalPages}</span>
    <button class="sug-pag-btn" data-page="${sugerenciaPage + 1}" ${sugerenciaPage >= totalPages ? 'disabled' : ''} style="background:none;border:1px solid var(--panel-border,rgba(255,255,255,0.07));border-radius:6px;padding:4px 12px;color:var(--muted,#7a8599);cursor:pointer;font-size:0.78rem;${sugerenciaPage >= totalPages ? 'opacity:0.3;cursor:default;' : ''}">Siguiente ›</button>
  </div>`

  // Attach pagination listeners
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
  const fecha = document.getElementById('stock-fecha')?.value
  const sucursalId = document.getElementById('stock-sucursal')?.value
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
  const fecha = document.getElementById('stock-fecha')?.value
  const sucursalId = document.getElementById('stock-sucursal')?.value
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

// ════════════════════════════════════════════════════════════════════
//  INIT — Stock
// ════════════════════════════════════════════════════════════════════

function initStockReport() {
  setStockFechaDefault()

  document.getElementById('btn-stock-actualizar')?.addEventListener('click', cargarReporteStock)
  document.getElementById('btn-stock-excel')?.addEventListener('click', descargarExcelStock)
  document.getElementById('btn-stock-pdf')?.addEventListener('click', descargarPdfStock)

  document.getElementById('stock-fecha')?.addEventListener('change', () => {
    const fecha = document.getElementById('stock-fecha').value
    if (fecha) cargarReporteStock()
  })

  Promise.all([cargarSucursalesStock()]).then(() => cargarReporteStock())
}

console.log('✅ reportes.js cargado')