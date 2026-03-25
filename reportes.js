// ── GUARD DE ACCESO ──
;(function() {
  try {
    const rol = JSON.parse(localStorage.getItem('jesha_usuario') || '{}').rol
    const ROLES_PERMITIDOS = ['SUPERADMIN']
    if (!ROLES_PERMITIDOS.includes(rol)) {
      window.location.replace('index.html')
    }
  } catch(e) { window.location.replace('index.html') }
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
    const data   = await apiFetch(`/ventas?desde=${desde}&hasta=${hasta}&take=9999`)
    const ventas = data.data || []
    procesarVentas(ventas)
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
function procesarVentas(ventas) {
  const totalIngresos  = ventas.reduce((s, v) => s + parseFloat(v.total), 0)
  const ticketPromedio = ventas.length > 0 ? totalIngresos / ventas.length : 0

  // KPIs
  document.getElementById('kpi-ingresos').textContent     = fmt(totalIngresos)
  document.getElementById('kpi-ingresos-sub').textContent = `${ventas.length} venta${ventas.length !== 1 ? 's' : ''}`
  document.getElementById('kpi-ticket').textContent       = fmt(ticketPromedio)

  const efectivo   = ventas.filter(v => v.metodoPago === 'EFECTIVO')
  const tarjeta    = ventas.filter(v => ['CREDITO','DEBITO','TRANSFERENCIA'].includes(v.metodoPago))
  const sumEfectivo = efectivo.reduce((s,v) => s + parseFloat(v.total), 0)
  const sumTarjeta  = tarjeta.reduce((s,v) => s + parseFloat(v.total), 0)

  document.getElementById('kpi-efectivo').textContent     = fmt(sumEfectivo)
  document.getElementById('kpi-efectivo-sub').textContent = `${efectivo.length} ventas`
  document.getElementById('kpi-tarjeta').textContent      = fmt(sumTarjeta)
  document.getElementById('kpi-tarjeta-sub').textContent  = `${tarjeta.length} ventas`

  // Paneles
  renderMetodos(ventas, totalIngresos)
  renderProductos(ventas)
  renderPorDia(ventas)
  renderClientes(ventas, totalIngresos)
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
function renderProductos(ventas) {
  const el = document.getElementById('rep-productos')
  if (ventas.length === 0) { el.className = 'panel-empty'; el.textContent = 'Sin ventas en este período'; return }

  // Agrupar detalles por productoId sumando cantidad e importe
  const prodMap = {}
  ventas.forEach(v => {
    if (!v.detalles || v.detalles.length === 0) return
    v.detalles.forEach(d => {
      const key = d.productoId
      if (!prodMap[key]) {
        prodMap[key] = { nombre: d.nombre || '—', codigo: d.codigo || '', cantidad: 0, importe: 0 }
      }
      prodMap[key].cantidad += parseInt(d.cantidad || 0)
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
    if (!desdeCustom || !hastaCustom) { alert('Selecciona ambas fechas'); return }
    cargarReportes()
  })

  cargarReportes()
})

console.log('✅ reportes.js cargado')