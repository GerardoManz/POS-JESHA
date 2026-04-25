// ════════════════════════════════════════════════════════════════════
//  DASHBOARD.JS — Fase 7
//  - 5 KPIs (incluye Con stock / Stock bajo / Sin stock)
//  - Filtro de sucursal (solo SUPERADMIN)
//  - Stock bajo: stockActual > 0 && stockActual <= stockMinimoAlerta
//  - Sin stock:  stockActual <= 0
//  - Multi-sucursal: filtra inventarios[] correctamente
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!TOKEN) { window.location.href = 'login.html'; throw new Error('Sin auth') }

const fmt      = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'

// ── Estado del filtro ──
let sucursalSeleccionada = '' // '' = todas
let listaSucursales      = []
let cacheVentasHoy       = null
let cacheVentasTotales   = null
let cacheProductos       = null

// ════════════════════════════════════════════════════════════════════
//  HELPERS DE INVENTARIO
//  Clasifica un producto en una de 3 categorías según su inventario.
//  Si hay filtro de sucursal: usa solo el inventario de esa sucursal.
//  Si no: SUMA stock de todas las sucursales para el cálculo.
// ════════════════════════════════════════════════════════════════════
function calcularStockProducto(producto, sucursalId) {
  const invs = producto.inventarios || []
  if (invs.length === 0) return { stock: 0, minimo: 0, hasInv: false }

  let stock = 0
  let minimo = 0

  if (sucursalId) {
    const inv = invs.find(i => i.sucursalId === parseInt(sucursalId))
    if (!inv) return { stock: 0, minimo: 0, hasInv: false }
    stock  = parseFloat(inv.stockActual || 0)
    minimo = parseFloat(inv.stockMinimoAlerta || 0)
  } else {
    // Sin filtro: sumar todas las sucursales
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
//  FILTRO DE SUCURSAL — visible solo para SUPERADMIN
// ════════════════════════════════════════════════════════════════════
async function inicializarFiltroSucursal() {
  if (USUARIO.rol !== 'SUPERADMIN') return

  document.getElementById('sucursal-filter').style.display = 'flex'

  try {
    const res = await apiFetch('/sucursales', { method: 'GET' })
    const lista = Array.isArray(res) ? res
                : Array.isArray(res?.data) ? res.data
                : []
    listaSucursales = lista.filter(s => s.activa !== false)

    const sel = document.getElementById('filtro-sucursal')
    sel.innerHTML = '<option value="">🏢 Todas las sucursales</option>' +
      listaSucursales.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('')

    sel.addEventListener('change', e => {
      sucursalSeleccionada = e.target.value
      // Refrescar todo
      cargarKPIs()
      cargarVentasRecientes()
      cargarStockBajo()
    })
  } catch(e) {
    console.warn('No se cargaron sucursales:', e.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  KPIs
// ════════════════════════════════════════════════════════════════════
async function cargarKPIs() {
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

  try {
    // ── Ventas hoy ──
    const hoy   = new Date()
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).toISOString()
    const queryHoy = sucursalSeleccionada
      ? `/ventas?desde=${desde}&hasta=${hasta}&take=9999&sucursalId=${sucursalSeleccionada}`
      : `/ventas?desde=${desde}&hasta=${hasta}&take=9999`
    const ventasHoy = await apiFetch(queryHoy)
    const totalHoy  = (ventasHoy.data || []).reduce((s, v) => s + parseFloat(v.total), 0)
    const countHoy  = ventasHoy.total || 0

    const elVentasHoy = document.getElementById('kpi-ventas-hoy')
    elVentasHoy.querySelector('.kpi-value').textContent = fmt(totalHoy)
    elVentasHoy.querySelector('.kpi-sub').textContent   = `${countHoy} transaccion${countHoy !== 1 ? 'es' : ''}`

    // ── Total ventas (histórico) ──
    const queryTotal = sucursalSeleccionada
      ? `/ventas?take=9999&sucursalId=${sucursalSeleccionada}`
      : '/ventas?take=9999'
    const montoTotal = await apiFetch(queryTotal)
    const sumTotal   = (montoTotal.data || []).reduce((s, v) => s + parseFloat(v.total), 0)
    const countTotal = montoTotal.total || (montoTotal.data || []).length

    const elTotalVentas = document.getElementById('kpi-total-ventas')
    elTotalVentas.querySelector('.kpi-value').textContent = fmt(sumTotal)
    elTotalVentas.querySelector('.kpi-sub').textContent   = `${countTotal} ventas totales`

    // ── Productos: clasificar por categoría ──
    const productos = await apiFetch('/productos?take=9999')
    cacheProductos  = productos.data || []
    const totalActivos = productos.paginacion?.total || cacheProductos.length

    let conStock   = 0
    let stockBajo  = 0
    let sinStock   = 0

    for (const p of cacheProductos) {
      const { stock, minimo, hasInv } = calcularStockProducto(p, sucursalSeleccionada)
      if (!hasInv) continue  // producto sin inventario en la sucursal filtrada → no contar
      const cat = categoriaStock(stock, minimo)
      if      (cat === 'CON_STOCK')   conStock++
      else if (cat === 'STOCK_BAJO')  stockBajo++
      else                            sinStock++
    }

    // KPI Con stock
    const elCon = document.getElementById('kpi-con-stock')
    elCon.querySelector('.kpi-value').textContent = conStock.toLocaleString('es-MX')
    elCon.querySelector('.kpi-sub').textContent   = `de ${totalActivos.toLocaleString('es-MX')} productos`

    // KPI Stock bajo
    const elBajo = document.getElementById('kpi-stock-bajo')
    elBajo.querySelector('.kpi-value').textContent = stockBajo.toLocaleString('es-MX')
    elBajo.querySelector('.kpi-sub').textContent   = stockBajo > 0 ? 'Requieren reposición' : 'Stock suficiente ✓'

    // KPI Sin stock
    const elSin = document.getElementById('kpi-sin-stock')
    elSin.querySelector('.kpi-value').textContent = sinStock.toLocaleString('es-MX')
    elSin.querySelector('.kpi-sub').textContent   = sinStock > 0 ? 'Agotados' : 'Sin agotados ✓'

  } catch (err) {
    console.error('❌ KPIs:', err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  VENTAS RECIENTES
// ════════════════════════════════════════════════════════════════════
async function cargarVentasRecientes() {
  const panel = document.getElementById('panel-ventas')
  try {
    const query = sucursalSeleccionada
      ? `/ventas?take=8&sucursalId=${sucursalSeleccionada}`
      : '/ventas?take=8'
    const data  = await apiFetch(query)
    const ventas = data.data || []

    panel.querySelector('.panel-empty, .panel-tabla')?.remove()

    if (ventas.length === 0) {
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
  } catch (err) {
    console.error('❌ Ventas recientes:', err.message)
  }
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
      const { stock, minimo, hasInv } = calcularStockProducto(p, sucursalSeleccionada)
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
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await inicializarFiltroSucursal()
  // Pre-poblar sucursal del usuario si no es SUPERADMIN
  if (USUARIO.rol !== 'SUPERADMIN' && USUARIO.sucursalId) {
    sucursalSeleccionada = String(USUARIO.sucursalId)
  }
  cargarKPIs()
  cargarVentasRecientes()
  cargarStockBajo()
})