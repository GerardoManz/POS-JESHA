// ===== DASHBOARD.JS (OPCIÓN A - RECOMENDADA) =====
// Fusión correcta del código original con la nueva arquitectura
// Este archivo SOLO contiene lógica del dashboard
// La autenticación y logout ahora están centralizados en sidebar.js

const DASHBOARD_PAGE = 'index.html'
const LOGIN_PAGE = 'login.html'

// ✅ MANTIENE: Verificación de autenticación (primera capa de seguridad)
const token = localStorage.getItem('jesha_token')
if (!token) {
  console.warn('⚠️ No hay token - redirigiendo a login')
  window.location.href = LOGIN_PAGE
}

// ✅ AGREGAR: Lógica del dashboard cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  console.log('✓ Dashboard inicializado')
  
  // 📊 TODO: Implementar carga de KPIs
  // Cuando tengas el backend, descomentar:
  /*
  fetch('/api/dashboard/kpis')
    .then(response => response.json())
    .then(data => {
      // Actualizar Ventas Hoy
      document.querySelector('.kpi-card:nth-child(1) .kpi-value').textContent = 
        '$' + new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2 }).format(data.ventasHoy)
      
      // Actualizar Total Ventas
      document.querySelector('.kpi-card:nth-child(2) .kpi-value').textContent = 
        '$' + new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2 }).format(data.totalVentas)
      
      // Actualizar Productos
      document.querySelector('.kpi-card:nth-child(3) .kpi-value').textContent = 
        data.totalProductos
      
      // Actualizar Stock Bajo
      document.querySelector('.kpi-card:nth-child(4) .kpi-value').textContent = 
        data.stockBajo
    })
    .catch(error => console.error('Error cargando KPIs:', error))
  */
  
  // TODO: Implementar carga de ventas recientes
  /*
  fetch('/api/ventas/recientes?limit=5')
    .then(response => response.json())
    .then(data => {
      // Llenar tabla de ventas recientes
    })
  */
  
  // TODO: Implementar carga de productos con stock bajo
  /*
  fetch('/api/productos/stock-bajo')
    .then(response => response.json())
    .then(data => {
      // Llenar tabla de stock bajo
    })
  */
})

// ❌ NO INCLUIR: Manejo del logout
// RAZÓN: Ahora sidebar.js lo maneja automáticamente después de cargar sidebar.html
// Si lo pusiéramos aquí, fallaría porque #logout-btn aún no existiría en el DOM
// Así que lo removimos de aquí:
/*
const logoutButton = document.getElementById('logout-btn')
if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('jesha_token')
    localStorage.removeItem('jesha_usuario')
    window.location.href = LOGIN_PAGE
  })
}
*/
// ← Esto ahora está en sidebar.js y funciona correctamente