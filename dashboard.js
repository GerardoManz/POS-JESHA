// ════════════════════════════════════════════════════════════════════
//  DASHBOARD.JS
// ════════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

if (!TOKEN) { window.location.href = 'login.html'; throw new Error('Sin auth') }

const fmt = v => `$${parseFloat(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const fmtFecha = iso => iso ? new Date(iso).toLocaleString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'

// apiFetch global disponible desde sidebar.js

// ════════════════════════════════════════════════════════════════════
//  KPIs
// ════════════════════════════════════════════════════════════════════
async function cargarKPIs() {
  const _rol = (() => { try { return JSON.parse(localStorage.getItem('jesha_usuario')||'{}').rol || 'EMPLEADO' } catch { return 'EMPLEADO' } })()

  // Admin Sucursal: ocultar KPI Total Ventas con candado
  if (_rol === 'ADMIN_SUCURSAL') {
    const kpiTotal = document.querySelector('.kpi-card:nth-child(2)')
    if (kpiTotal) {
      kpiTotal.style.filter         = 'blur(5px)'
      kpiTotal.style.userSelect     = 'none'
      kpiTotal.style.pointerEvents  = 'none'
      kpiTotal.style.position       = 'relative'
      const ov = document.createElement('div')
      ov.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:2;border-radius:inherit;cursor:not-allowed;'
      ov.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
      kpiTotal.appendChild(ov)
    }
  }

  try {
    // Ventas de hoy
    const hoy   = new Date()
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).toISOString()
    const ventasHoy = await apiFetch(`/ventas?desde=${desde}&hasta=${hasta}&take=9999`)

    const totalHoy  = (ventasHoy.data || []).reduce((s, v) => s + parseFloat(v.total), 0)
    const countHoy  = ventasHoy.total || 0

    document.querySelector('.kpi-card:nth-child(1) .kpi-value').textContent = fmt(totalHoy)
    document.querySelector('.kpi-card:nth-child(1) .kpi-sub').textContent   = `${countHoy} transaccion${countHoy !== 1 ? 'es' : ''}`

    // Ventas totales (histórico)
    const montoTotal  = await apiFetch('/ventas?take=9999')
    const sumTotal    = (montoTotal.data || []).reduce((s, v) => s + parseFloat(v.total), 0)
    const countTotal  = montoTotal.total || (montoTotal.data || []).length

    document.querySelector('.kpi-card:nth-child(2) .kpi-value').textContent = fmt(sumTotal)
    document.querySelector('.kpi-card:nth-child(2) .kpi-sub').textContent   = `${countTotal} ventas totales`

    // Productos e inventario — usar paginacion.total (estructura correcta del endpoint)
    const productos = await apiFetch('/productos?take=9999')
    const listaProd  = productos.data || []
    const totalActivos = productos.paginacion?.total || listaProd.length

    // Productos CON stock (stockActual > 0)
    const conStock = listaProd.filter(p => (p.inventarios?.[0]?.stockActual ?? 0) > 0).length

    document.querySelector('.kpi-card:nth-child(3) .kpi-value').textContent = conStock
    document.querySelector('.kpi-card:nth-child(3) .kpi-sub').textContent   = `de ${totalActivos} productos activos`

    // Stock bajo (stockActual <= stockMinimoAlerta)
    const sinStock = listaProd.filter(p => {
      const stock = p.inventarios?.[0]?.stockActual ?? 0
      const min   = p.inventarios?.[0]?.stockMinimoAlerta ?? 5
      return stock <= min
    }).length

    document.querySelector('.kpi-card:nth-child(4) .kpi-value').textContent = sinStock
    document.querySelector('.kpi-card:nth-child(4) .kpi-sub').textContent   = sinStock > 0 ? 'Requieren reposición' : 'Stock suficiente ✓'

    // Color de alerta en stock bajo
    const kpiStock = document.querySelector('.kpi-card:nth-child(4) .kpi-value')
    if (sinStock > 0) kpiStock.style.color = '#e8710a'

  } catch (err) { console.error('❌ KPIs:', err.message) }
}

// ════════════════════════════════════════════════════════════════════
//  VENTAS RECIENTES
// ════════════════════════════════════════════════════════════════════
async function cargarVentasRecientes() {
  const panel = document.querySelector('.panel:nth-child(1)')
  try {
    const data  = await apiFetch('/ventas?take=8')
    const ventas = data.data || []

    if (ventas.length === 0) {
      panel.querySelector('.panel-empty, .panel-tabla')?.remove()
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
                <td>${{ EFECTIVO:'💵', CREDITO:'💳', DEBITO:'💳', TRANSFERENCIA:'🔄' }[v.metodoPago] || ''} ${v.metodoPago}</td>
                <td><strong>${fmt(v.total)}</strong></td>
                <td style="color:var(--muted);font-size:0.78rem">${fmtFecha(v.fecha)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <a href="historial.html" class="dash-ver-mas">Ver historial completo →</a>
      </div>`

    panel.querySelector('.panel-empty, .panel-tabla')?.remove()
    panel.insertAdjacentHTML('beforeend', tabla)
  } catch (err) {
    console.error('❌ Ventas recientes:', err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  STOCK BAJO
// ════════════════════════════════════════════════════════════════════
async function cargarStockBajo() {
  const panel = document.querySelector('.panel:nth-child(2)')
  try {
    const data  = await apiFetch('/productos?take=9999')
    const prods = (data.data || []).filter(p => {
      const stock = p.inventarios?.[0]?.stockActual ?? 0
      const min   = p.inventarios?.[0]?.stockMinimoAlerta ?? 5
      return stock <= min
    }).slice(0, 10)

    if (prods.length === 0) {
      panel.querySelector('.panel-empty, .panel-tabla')?.remove()
      panel.insertAdjacentHTML('beforeend', '<div class="panel-empty">Todos los productos tienen stock suficiente ✓</div>')
      return
    }

    const tabla = `
      <div class="panel-tabla">
        <table class="dash-table">
          <thead><tr><th>Producto</th><th>Stock</th><th>Mínimo</th><th></th></tr></thead>
          <tbody>
            ${prods.map(p => {
              const stock = p.inventarios?.[0]?.stockActual ?? 0
              const min   = p.inventarios?.[0]?.stockMinimoAlerta ?? 5
              const cls   = stock === 0 ? 'stock-cero' : 'stock-bajo'
              return `
                <tr>
                  <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${p.nombre}">${p.nombre}</td>
                  <td><span class="stock-badge ${cls}">${stock}</span></td>
                  <td style="color:var(--muted)">${min}</td>
                  <td><a href="compras.html" style="color:var(--orange);font-size:0.78rem;text-decoration:none;">Comprar</a></td>
                </tr>`
            }).join('')}
          </tbody>
        </table>
        <a href="productos.html" class="dash-ver-mas">Ver inventario completo →</a>
      </div>`

    panel.querySelector('.panel-empty, .panel-tabla')?.remove()
    panel.insertAdjacentHTML('beforeend', tabla)
  } catch (err) {
    console.error('❌ Stock bajo:', err.message)
  }
}

// ════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  cargarKPIs()
  cargarVentasRecientes()
  cargarStockBajo()
})