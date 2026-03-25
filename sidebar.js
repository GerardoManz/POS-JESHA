// ===== SIDEBAR.JS — CONTROL DE PERMISOS POR ROL =====

// ════════════════════════════════════════════════════
//  MAPA DE PERMISOS
//  páginas que NO deben aparecer NI en menú NI ser accesibles
// ════════════════════════════════════════════════════
const ROL_BLOQUEADO = {
  ADMIN_SUCURSAL: ['reportes', 'usuarios'],
  EMPLEADO:       ['reportes', 'usuarios', 'corte-caja', 'dashboard', 'facturas'],
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

  // ── Bloqueo horario para EMPLEADO (8:00 – 18:00 hora CDMX) ──────
  if (rol === 'EMPLEADO') {
    const ahoraLocal = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
    const hora       = ahoraLocal.getHours()   // 0-23
    const minutos    = ahoraLocal.getMinutes()
    const totalMin   = hora * 60 + minutos
    const inicio     = 8  * 60   // 08:00 → 480 min
    const fin        = 18 * 60   // 18:00 → 1080 min

    if (totalMin < inicio || totalMin >= fin) {
      // Mostrar pantalla de bloqueo en lugar de redirigir al login
      document.body.innerHTML = `
        <div style="
          min-height:100vh; display:flex; align-items:center; justify-content:center;
          background:#0e1117; font-family:'Barlow',sans-serif; flex-direction:column; gap:16px;
          text-align:center; padding:24px;
        ">
          <div style="font-size:3rem;">🔒</div>
          <div style="
            font-family:'Barlow Condensed',sans-serif; font-size:1.6rem; font-weight:700;
            letter-spacing:0.06em; text-transform:uppercase; color:#e9edf4;
          ">Sistema fuera de horario</div>
          <div style="color:#7a8599; font-size:0.95rem; max-width:360px; line-height:1.6;">
            El acceso para empleados está disponible<br>
            <strong style="color:#e9edf4;">de 8:00 a 18:00 (hora de Ciudad de México)</strong>
          </div>
          <div style="
            margin-top:8px; padding:12px 24px;
            background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
            border-radius:10px; color:#7a8599; font-size:0.875rem;
          ">
            Hora actual: <strong style="color:#e9edf4;">
              ${ahoraLocal.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', hour12:true })}
            </strong>
          </div>
          <button onclick="
            localStorage.removeItem('jesha_token');
            localStorage.removeItem('jesha_usuario');
            window.location.href='login.html';
          " style="
            margin-top:16px; padding:10px 24px;
            background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12);
            border-radius:8px; color:#e9edf4; font-family:'Barlow',sans-serif;
            font-size:0.875rem; cursor:pointer;
          ">Cerrar sesión</button>
        </div>`
      return false
    }
  }

  const bloqueadas = ROL_BLOQUEADO[rol] || []
  if (bloqueadas.includes(pagina)) {
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

// ════════════════════════════════════════════════════════════════════
//  apiFetch GLOBAL — manejo centralizado de peticiones + 401
//  Disponible en todos los módulos porque sidebar.js carga primero
// ════════════════════════════════════════════════════════════════════
window.apiFetch = async function(path, opts = {}) {
  const token  = localStorage.getItem('jesha_token')
  const apiUrl = window.__JESHA_API_URL__ || 'http://localhost:3000'

  const res = await fetch(`${apiUrl}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers || {})
    }
  })

  // Token expirado o inválido — redirigir a login
  if (res.status === 401) {
    localStorage.removeItem('jesha_token')
    localStorage.removeItem('jesha_usuario')
    window.location.href = 'login.html'
    throw new Error('Sesión expirada')
  }

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
  return data
}

// Helper para módulos que usan fetch() directo
window.handle401 = function(status) {
  if (status === 401) {
    localStorage.removeItem('jesha_token')
    localStorage.removeItem('jesha_usuario')
    window.location.href = 'login.html'
    return true
  }
  return false
}
