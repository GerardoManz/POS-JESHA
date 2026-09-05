// ════════════════════════════════════════════════════════════════════
//  DASHBOARD.JS — Fase 7 + P0 hotfix
//  - 5 KPIs (incluye Con stock / Stock bajo / Sin stock)
//  - La sucursal operativa la resuelve SIEMPRE session.js
//    (X-Sucursal-Id vía apiFetch). NO se envía ?sucursalId= en query:
//    el backend resuelve la sucursal desde req.context.branch.
//  - Stock bajo: stockActual > 0 && stockActual <= stockMinimoAlerta
//  - Sin stock:  stockActual <= 0
//  - Estados visibles: CARGANDO / VACÍO REAL / ERROR (nunca $0.00 falso)
// ════════════════════════════════════════════════════════════════════

const USUARIO  = window.jeshaSession?.getUsuario() || null
const API_URL  = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!window.jeshaSession?.isValid() || !USUARIO) {
  window.location.href = 'login.html'
  throw new Error('Sin auth')
}

const fmt      = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'

const kpiAnimationFrames = new WeakMap()

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function animarKPI(el, valorFinal, formateador, duracion) {
  if (!el) return
  const final = Number(valorFinal) || 0
  const anterior = Number(el.dataset.kpiValue) || 0
  el.dataset.kpiValue = String(final)

  const rafAnterior = kpiAnimationFrames.get(el)
  if (rafAnterior) cancelAnimationFrame(rafAnterior)

  if (prefersReducedMotion() || anterior === final) {
    el.textContent = formateador(final)
    kpiAnimationFrames.delete(el)
    return
  }

  el.classList.remove('kpi-value-emphasis')
  void el.offsetWidth
  el.classList.add('kpi-value-emphasis')
  setTimeout(function() { el.classList.remove('kpi-value-emphasis') }, 300)

  const ms = duracion || 380
  const inicio = performance.now()
  function step(ahora) {
    const t = Math.min((ahora - inicio) / ms, 1)
    const eased = 1 - Math.pow(1 - t, 3)
    el.textContent = formateador(anterior + (final - anterior) * eased)
    if (t < 1) {
      kpiAnimationFrames.set(el, requestAnimationFrame(step))
    } else {
      el.textContent = formateador(final)
      kpiAnimationFrames.delete(el)
    }
  }
  kpiAnimationFrames.set(el, requestAnimationFrame(step))
}

// ── Estado del dashboard ──
// null = todas las sucursales. Lo resuelve session.js (fija o seleccionada).
let sucursalIdActiva = window.jeshaSession.getSelectedSucursalId()
let listaSucursales  = []
let cacheVentasHoy   = null
let cacheVentasTotales = null
let cacheProductos   = null

// ════════════════════════════════════════════════════════════════════
//  ESTADOS DEL DASHBOARD — nunca $0.00 silencioso ante error
//  tipo: 'cargando' | 'error' | null (limpia)
// ════════════════════════════════════════════════════════════════════
function mostrarEstadoDashboard(tipo, mensaje) {
  let el = document.getElementById('dashboard-estado')
  const grid = document.querySelector('.kpi-grid')
  if (!grid) return

  if (!tipo) {
    if (el) el.remove()
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'dashboard-estado'
    grid.parentNode.insertBefore(el, grid)
  }
  el.className = `dashboard-estado-${tipo}`
  el.textContent = mensaje || (tipo === 'cargando' ? 'Cargando indicadores...' : 'Error al cargar los indicadores')
}

function marcarKPIsSinDatos() {
  const cards = document.querySelectorAll('.kpi-card')
  cards.forEach(card => {
    const value = card.querySelector('.kpi-value')
    const sub = card.querySelector('.kpi-sub')
    if (value) value.textContent = '—'
    if (sub) sub.textContent = 'Sin datos'
  })
  const panelVentas = document.getElementById('panel-ventas')
  if (panelVentas) {
    panelVentas.querySelector('.panel-empty, .panel-tabla')?.remove()
    panelVentas.insertAdjacentHTML('beforeend', '<div class="panel-empty">No se pudieron cargar las ventas</div>')
  }
}

// ════════════════════════════════════════════════════════════════════
//  HELPERS DE INVENTARIO
//  Clasifica un producto en una de 3 categorías según su inventario.
//  Si hay sucursal activa: usa solo el inventario de esa sucursal.
//  Si no: SUMA stock de todas las sucursales para el cálculo.
// ════════════════════════════════════════════════════════════════════
function calcularStockProducto(producto, sucursalId) {
  const invs = producto.InventarioSucursal || []
  if (invs.length === 0) return { stock: 0, minimo: 0, hasInv: false }

  let stock = 0
  let minimo = 0

  if (sucursalId) {
    const inv = invs.find(i => i.sucursalId === parseInt(sucursalId))
    if (!inv) return { stock: 0, minimo: 0, hasInv: false }
    stock  = parseFloat(inv.stockActual || 0)
    minimo = parseFloat(inv.stockMinimoAlerta || 0)
  } else {
    // Sin sucursal activa: sumar todas las sucursales
    stock  = invs.reduce((s, i) => s + parseFloat(i.stockActual       || 0), 0)
    minimo = invs.reduce((s, i) => s + parseFloat(i.stockMinimoAlerta || 0), 0)
  }

  return { stock, minimo, hasInv: true }
}

function categoriaStock(stock, minimo) {
  if (stock <= 0)       return 'SIN_STOCK'
  if (stock <= minimo)  return 'STOCK_BAJO'
  return 'CON_STOCK'
}

// ════════════════════════════════════════════════════════════════════
//  KPIs
// ════════════════════════════════════════════════════════════════════
async function cargarKPIs() {
  if (!prefersReducedMotion()) {
    document.querySelectorAll('.kpi-card').forEach(function(card) {
      card.classList.remove('kpi-card-enter')
      void card.offsetWidth
      card.classList.add('kpi-card-enter')
    })
  }

  // Admin Sucursal: ocultar KPI Total Ventas con candado
  if (USUARIO.rol === 'ADMIN_SUCURSAL') {
    const kpiTotal = document.getElementById('kpi-total-ventas')
    if (kpiTotal && !kpiTotal.querySelector('.kpi-lock-overlay')) {
      kpiTotal.style.filter         = 'blur(5px)'
      kpiTotal.style.userSelect     = 'none'
      kpiTotal.style.pointerEvents  = 'none'
      kpiTotal.style.position       = 'relative'
      const ov = document.createElement('div')
      ov.className = 'kpi-lock-overlay'
      ov.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:2;border-radius:inherit;cursor:not-allowed;'
      ov.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
      kpiTotal.appendChild(ov)
    }
  }

  mostrarEstadoDashboard('cargando', 'Cargando indicadores...')

  try {
    // ── KPIs de ventas (endpoint optimizado). SIN sucursalId en query:
    //    la sucursal viaja en el header X-Sucursal-Id (session.js).
    const params = new URLSearchParams()
    const hoy = new Date()
    params.append('desde', new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString())
    params.append('hasta', new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).toISOString())

    const kpis = await apiFetch(`/ventas/dashboard-kpis?${params.toString()}`)

    if (!kpis.success) {
      throw new Error('El servidor no devolvió datos de ventas')
    }

    // Ventas hoy
    const elVentasHoy = document.getElementById('kpi-ventas-hoy')
    animarKPI(elVentasHoy.querySelector('.kpi-value'), kpis.ventasHoy.total, fmt, 380)
    elVentasHoy.querySelector('.kpi-sub').textContent = `${kpis.ventasHoy.count} transaccion${kpis.ventasHoy.count !== 1 ? 'es' : ''}`

    // Cobranza hoy (abonos a crédito)
    const elCobranzaHoy = document.getElementById('kpi-cobranza-hoy')
    animarKPI(elCobranzaHoy.querySelector('.kpi-value'), kpis.cobranzaHoy?.total || 0, fmt, 380)
    elCobranzaHoy.querySelector('.kpi-sub').textContent = `${kpis.cobranzaHoy?.count || 0} abono${(kpis.cobranzaHoy?.count || 0) !== 1 ? 's' : ''}`

    // Total histórico
    const elTotalVentas = document.getElementById('kpi-total-ventas')
    animarKPI(elTotalVentas.querySelector('.kpi-value'), kpis.ventasHistorico.total, fmt, 380)
    elTotalVentas.querySelector('.kpi-sub').textContent = `${kpis.ventasHistorico.count} ventas totales`

    // Ventas recientes - renderizar directamente desde el response
    renderizarVentasRecientes(kpis.ventasRecientes)

    // ── Productos: clasificar por categoría ──
    const productos = await apiFetch('/productos?take=9999')
    cacheProductos  = productos.data || []
    const totalActivos = productos.paginacion?.total || cacheProductos.length

    let conStock   = 0
    let stockBajo  = 0
    let sinStock   = 0

    for (const p of cacheProductos) {
      const { stock, minimo, hasInv } = calcularStockProducto(p, sucursalIdActiva)
      if (!hasInv) continue  // producto sin inventario en la sucursal filtrada → no contar
      const cat = categoriaStock(stock, minimo)
      if      (cat === 'CON_STOCK')   conStock++
      else if (cat === 'STOCK_BAJO')  stockBajo++
      else                            sinStock++
    }

    // KPI Con stock
    const elCon = document.getElementById('kpi-con-stock')
    animarKPI(elCon.querySelector('.kpi-value'), conStock, v => Math.round(v).toLocaleString('es-MX'), 380)
    elCon.querySelector('.kpi-sub').textContent   = `de ${totalActivos.toLocaleString('es-MX')} productos`

    // KPI Stock bajo
    const elBajo = document.getElementById('kpi-stock-bajo')
    animarKPI(elBajo.querySelector('.kpi-value'), stockBajo, v => Math.round(v).toLocaleString('es-MX'), 380)
    elBajo.querySelector('.kpi-sub').textContent   = stockBajo > 0 ? 'Requieren reposición' : 'Stock suficiente ✓'

    // KPI Sin stock
    const elSin = document.getElementById('kpi-sin-stock')
    animarKPI(elSin.querySelector('.kpi-value'), sinStock, v => Math.round(v).toLocaleString('es-MX'), 380)
    elSin.querySelector('.kpi-sub').textContent   = sinStock > 0 ? 'Agotados' : 'Sin agotados ✓'

    mostrarEstadoDashboard(null)
  } catch (err) {
    console.error('❌ KPIs:', err.message)
    marcarKPIsSinDatos()
    mostrarEstadoDashboard('error', `No se pudieron cargar los indicadores. ${err.message}`)
  }
}

// ════════════════════════════════════════════════════════════════════
//  VENTAS RECIENTES
// ════════════════════════════════════════════════════════════════════
function renderizarVentasRecientes(ventas) {
  const panel = document.getElementById('panel-ventas')
  panel.querySelector('.panel-empty, .panel-tabla')?.remove()

  if (!ventas || ventas.length === 0) {
    panel.insertAdjacentHTML('beforeend', '<div class="panel-empty">No hay ventas registradas</div>')
    return
  }

  const tabla = `
    <div class="panel-tabla">
      <table class="dash-table">
        <thead><tr><th>Folio</th><th>Cliente</th><th>Método</th><th>Total</th><th>Hora</th></tr></thead>
        <tbody>
          ${ventas.map(v => `
            <tr>
              <td><strong>${v.folio}</strong></td>
              <td style="color:var(--muted)">${v.cliente || 'Público general'}</td>
              <td>${{ EFECTIVO:'💵', CREDITO:'💳', DEBITO:'💳', TRANSFERENCIA:'🔄', CREDITO_CLIENTE:'🏦' }[v.metodoPago] || ''} ${v.metodoPago}</td>
              <td><strong>${fmt(v.total)}</strong></td>
              <td style="color:var(--muted);font-size:0.78rem">${fmtFecha(v.fecha)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <a href="historial.html" class="dash-ver-mas">Ver historial completo →</a>
    </div>`

  panel.insertAdjacentHTML('beforeend', tabla)
}

// ════════════════════════════════════════════════════════════════════
//  STOCK BAJO + SIN STOCK (panel inferior)
//  Muestra primero los SIN_STOCK (rojos) y luego los STOCK_BAJO (naranja)
// ════════════════════════════════════════════════════════════════════
async function cargarStockBajo() {
  const panel = document.getElementById('panel-stock')
  try {
    let prods = cacheProductos
    if (!prods) {
      const data = await apiFetch('/productos?take=9999')
      prods = data.data || []
      cacheProductos = prods
    }

    // Clasificar y filtrar
    const criticos = []
    for (const p of prods) {
      const { stock, minimo, hasInv } = calcularStockProducto(p, sucursalIdActiva)
      if (!hasInv) continue
      const cat = categoriaStock(stock, minimo)
      if (cat === 'SIN_STOCK' || cat === 'STOCK_BAJO') {
        criticos.push({ producto: p, stock, minimo, categoria: cat })
      }
    }

    // Orden: primero sin stock, luego más urgentes (menor relación stock/minimo)
    criticos.sort((a, b) => {
      if (a.categoria !== b.categoria) return a.categoria === 'SIN_STOCK' ? -1 : 1
      return a.stock - b.stock
    })

    const tope = criticos.slice(0, 10)

    panel.querySelector('.panel-empty, .panel-tabla')?.remove()

    if (tope.length === 0) {
      panel.insertAdjacentHTML('beforeend', '<div class="panel-empty">Todos los productos tienen stock suficiente ✓</div>')
      return
    }

    const tabla = `
      <div class="panel-tabla">
        <table class="dash-table">
          <thead><tr><th>Producto</th><th>Estado</th><th>Stock</th><th>Mínimo</th><th></th></tr></thead>
          <tbody>
            ${tope.map(({ producto, stock, minimo, categoria }) => {
              const esSin = categoria === 'SIN_STOCK'
              const cls   = esSin ? 'stock-cero' : 'stock-bajo'
              const etiq  = esSin
                ? '<span style="font-size:0.72rem;color:#ff6b6b;font-weight:600;">SIN STOCK</span>'
                : '<span style="font-size:0.72rem;color:#e8710a;font-weight:600;">BAJO</span>'
              return `
                <tr>
                  <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${producto.nombre}">${producto.nombre}</td>
                  <td>${etiq}</td>
                  <td><span class="stock-badge ${cls}">${stock.toLocaleString('es-MX')}</span></td>
                  <td style="color:var(--muted)">${minimo.toLocaleString('es-MX')}</td>
                  <td><a href="compras.html" style="color:var(--orange);font-size:0.78rem;text-decoration:none;">Comprar</a></td>
                </tr>`
            }).join('')}
          </tbody>
        </table>
        <a href="productos.html" class="dash-ver-mas">Ver inventario completo →</a>
      </div>`

    panel.insertAdjacentHTML('beforeend', tabla)
  } catch (err) {
    console.error('❌ Stock bajo:', err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  ONBOARDING DE SUCURSAL
//  Si la empresa no tiene sucursales activas, muestra un aviso con CTA
//  (solo SUPERADMIN) o aviso informativo para el resto de roles.
// ════════════════════════════════════════════════════════════════════
async function verificarOnboarding() {
  try {
    const data = await apiFetch('/sucursales')
    const activas = Array.isArray(data) ? data : (data && data.sucursales) ? data.sucursales : []
    const grid = document.querySelector('.kpi-grid')
    const existente = document.getElementById('onboarding-sucursal')
    if (existente) existente.remove()

    if (Array.isArray(activas) && activas.length === 0) {
      const el = document.createElement('div')
      el.id = 'onboarding-sucursal'
      const esSuper = USUARIO.rol === 'SUPERADMIN'
      el.innerHTML = `
        <div class="onboarding-sucursal">
          <span class="onboarding-sucursal-icon">🏪</span>
          <div class="onboarding-sucursal-body">
            <strong>Esta empresa todavía no tiene sucursales activas</strong>
            <p>${esSuper ? 'Crea y activa tu primera sucursal para comenzar a operar tu punto de venta.' : 'Contacta a tu administrador para configurar una sucursal.'}</p>
          </div>
          ${esSuper
            ? '<a class="onboarding-sucursal-cta" href="sucursales.html?nueva=1">Configurar sucursales →</a>'
            : ''}
        </div>`
      if (grid && grid.parentNode) grid.parentNode.insertBefore(el, grid)
    }
  } catch (err) {
    console.error('❌ Onboarding sucursal:', err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  verificarOnboarding()
  cargarKPIs()
  cargarStockBajo()
})
