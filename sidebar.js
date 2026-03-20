// ===== SIDEBAR.JS — CONTROL DE PERMISOS POR ROL =====

// ════════════════════════════════════════════════════
//  MAPA DE PERMISOS
//  páginas que NO deben aparecer NI en menú NI ser accesibles
// ════════════════════════════════════════════════════
const ROL_BLOQUEADO = {
  ADMIN_SUCURSAL: ['reportes', 'usuarios'],
  EMPLEADO:       ['reportes', 'usuarios', 'corte-caja', 'dashboard'],
}

// Páginas donde el empleado es redirigido al POS en vez del dashboard
const REDIRECCION_ROL = {
  EMPLEADO: 'punto-venta.html',
}

function getRol() {
  try { return JSON.parse(localStorage.getItem('jesha_usuario') || '{}').rol || 'EMPLEADO' }
  catch { return 'EMPLEADO' }
}

function verificarAutenticacion() {
  const token   = localStorage.getItem('jesha_token')
  const usuario = localStorage.getItem('jesha_usuario')
  if (!token || !usuario) {
    window.location.href = 'login.html'
    return false
  }
  return true
}

function verificarAccesoPagina(pagina) {
  const rol = getRol()
  if (rol === 'SUPERADMIN') return true

  const bloqueadas = ROL_BLOQUEADO[rol] || []
  if (bloqueadas.includes(pagina)) {
    // Redirigir según el rol
    const destino = REDIRECCION_ROL[rol] || 'index.html'
    window.location.replace(destino)
    return false
  }
  return true
}

async function cargarSidebar(paginaActual) {
  try {
    const response = await fetch('sidebar.html')
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const html = await response.text()
    const container = document.getElementById('sidebar-container')
    if (!container) { console.error('❌ No se encontró #sidebar-container'); return }

    container.innerHTML = html
    console.log('✓ Sidebar inyectado correctamente')

    aplicarPermisosMenu()
    marcarPaginaActiva(paginaActual)
    configurarLogoutConReintentos(10)
  } catch (error) {
    console.error('❌ Error cargando sidebar.html:', error)
  }
}

function aplicarPermisosMenu() {
  const rol = getRol()
  if (rol === 'SUPERADMIN') return

  const bloqueadas = ROL_BLOQUEADO[rol] || []

  bloqueadas.forEach(pagina => {
    const item = document.querySelector(`.menu-item[data-page="${pagina}"]`)
    if (item) {
      item.style.display = 'none'
    }
  })
}

function marcarPaginaActiva(paginaActual) {
  const items = document.querySelectorAll('.menu-item')
  items.forEach(item => item.classList.remove('active'))
  const itemActivo = document.querySelector(`.menu-item[data-page="${paginaActual}"]`)
  if (itemActivo) { itemActivo.classList.add('active'); console.log(`✓ Menú activo: ${paginaActual}`) }
}

function configurarLogoutConReintentos(intentos) {
  const logoutBtn = document.getElementById('logout-btn')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault()
      localStorage.removeItem('jesha_token')
      localStorage.removeItem('jesha_usuario')
      window.location.href = 'login.html'
    })
    console.log('✓ Botón de salida vinculado')
  } else if (intentos > 0) {
    requestAnimationFrame(() => configurarLogoutConReintentos(intentos - 1))
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!verificarAutenticacion()) return
  const paginaActual = document.body.getAttribute('data-page') || ''
  if (!verificarAccesoPagina(paginaActual)) return
  cargarSidebar(paginaActual)
})