// ===== SIDEBAR.JS — CONTROL DE PERMISOS POR ROL =====

// ════════════════════════════════════════════════════
//  MAPA DE PERMISOS
//  páginas que NO deben aparecer NI en menú NI ser accesibles
// ════════════════════════════════════════════════════
const ROL_BLOQUEADO = {
  ADMIN_SUCURSAL: ['usuarios'],
  EMPLEADO:       ['reportes', 'usuarios', 'corte-caja', 'historial-cortes', 'dashboard', 'facturas'],
  PRECIOS:        ['dashboard', 'punto-venta', 'cotizaciones', 'corte-caja',
                   'historial-cortes', 'compras', 'historial', 'reportes',
                   'facturas', 'bitacora', 'pedidos', 'clientes', 'usuarios'],
}

// Páginas donde el rol es redirigido a su página principal en vez del dashboard
const REDIRECCION_ROL = {
  EMPLEADO: 'punto-venta.html',
  PRECIOS:  'productos.html',  // FIX: evita loop infinito (dashboard bloqueado → index → dashboard...)
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
  if (rol === 'SUPERADMIN' || rol === 'PLATFORM_ADMIN') return true

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
    const destino = REDIRECCION_ROL[rol] || 'dashboard.html'
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
    configurarSidebarCollapse()
    configurarThemeToggle()
    configurarLogoutConReintentos(10)
  } catch (error) {
    console.error('❌ Error cargando sidebar.html:', error)
  }
}

function aplicarPermisosMenu() {
  const rol = getRol()
  if (rol === 'SUPERADMIN' || rol === 'PLATFORM_ADMIN') return

  const bloqueadas = ROL_BLOQUEADO[rol] || []

  bloqueadas.forEach(pagina => {
    const item = document.querySelector(`.menu-item[data-page="${pagina}"]`)
    if (item) {
      item.style.display = 'none'
    }
  })

  // FIX: ocultar etiquetas de sección que se quedaron sin items visibles
  // (evita ver títulos "Ventas"/"Administración" sin nada debajo para roles restringidos)
  ocultarSeccionesVacias()
}

// Recorre cada .menu-section-label y revisa sus hermanos hasta el siguiente label.
// Si ningún .menu-item del bloque está visible, oculta el label.
function ocultarSeccionesVacias() {
  const labels = document.querySelectorAll('.menu-section-label')
  labels.forEach(label => {
    let hayVisible = false
    let nodo = label.nextElementSibling
    while (nodo && !nodo.classList.contains('menu-section-label')) {
      if (nodo.classList.contains('menu-item') && nodo.style.display !== 'none') {
        hayVisible = true
        break
      }
      nodo = nodo.nextElementSibling
    }
    if (!hayVisible) label.style.display = 'none'
  })
}

function marcarPaginaActiva(paginaActual) {
  const items = document.querySelectorAll('.menu-item')
  items.forEach(item => item.classList.remove('active'))
  const itemActivo = document.querySelector(`.menu-item[data-page="${paginaActual}"]`)
  if (itemActivo) { itemActivo.classList.add('active'); console.log(`✓ Menú activo: ${paginaActual}`) }
}

function configurarSidebarCollapse() {
  const appShell = document.querySelector('.app-shell')
  const toggleBtn = document.getElementById('sidebar-toggle')
  if (!appShell || !toggleBtn) return

  const collapsed = localStorage.getItem('jesha_sidebar_collapsed') === 'true'
  if (collapsed) {
    appShell.classList.add('sidebar-collapsed')
    toggleBtn.setAttribute('aria-label', 'Expandir menú')
  }

  toggleBtn.addEventListener('click', () => {
    const isNowCollapsed = appShell.classList.toggle('sidebar-collapsed')
    localStorage.setItem('jesha_sidebar_collapsed', String(isNowCollapsed))
    toggleBtn.setAttribute('aria-label', isNowCollapsed ? 'Expandir menú' : 'Colapsar menú')
  })
}

function getThemeIcon(theme) {
  if (theme === 'dark') {
    return '<svg class="theme-icon theme-icon-sun" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>'
  }
  return '<svg class="theme-icon theme-icon-moon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.99 13.2A8.5 8.5 0 1 1 10.8 3.01a7 7 0 1 0 10.19 10.19Z"/></svg>'
}

function pintarThemeToggle(btn, theme) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  btn.innerHTML = getThemeIcon(theme)
  btn.setAttribute('aria-label', `Cambiar a modo ${nextTheme === 'dark' ? 'oscuro' : 'claro'}`)
  btn.setAttribute('title', `Cambiar a modo ${nextTheme === 'dark' ? 'oscuro' : 'claro'}`)
}

function configurarThemeToggle() {
  const btn = document.getElementById('theme-toggle')
  if (!btn || !window.jeshaTheme) return

  pintarThemeToggle(btn, window.jeshaTheme.getTheme())

  btn.addEventListener('click', async () => {
    const theme = window.jeshaTheme.toggleTheme()
    pintarThemeToggle(btn, theme)

    try {
      await window.apiFetch('/auth/preferencias', {
        method: 'PATCH',
        body: JSON.stringify({ tema: theme })
      })
    } catch (err) {
      console.warn('No se pudo guardar el tema:', err.message)
      if (window.jeshaToast) jeshaToast('Tema aplicado localmente, pero no se pudo guardar en tu usuario', 'warning')
    }
  })

  window.addEventListener('jesha:themechange', (event) => {
    pintarThemeToggle(btn, event.detail?.theme || window.jeshaTheme.getTheme())
  })
}

let logoutGlobalConfigurado = false
let cerrandoSesion = false

function obtenerLogoutDesdeTarget(target) {
  let nodo = target
  while (nodo && nodo !== document) {
    if (nodo.id === 'logout-btn') return nodo
    nodo = nodo.parentElement
  }
  return null
}

function cerrarSesion() {
  if (cerrandoSesion) return
  cerrandoSesion = true
  localStorage.removeItem('jesha_token')
  localStorage.removeItem('jesha_usuario')
  window.location.replace('login.html')
}

function configurarLogoutConReintentos(intentos) {
  if (!logoutGlobalConfigurado) {
    document.addEventListener('click', (e) => {
      const logoutBtn = obtenerLogoutDesdeTarget(e.target)
      if (!logoutBtn) return

      e.preventDefault()
      e.stopPropagation()
      cerrarSesion()
    }, true)
    logoutGlobalConfigurado = true
  }

  const logoutBtn = document.getElementById('logout-btn')
  if (logoutBtn) {
    logoutBtn.setAttribute('type', 'button')
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
  iniciarVersionChecker()
})

// ════════════════════════════════════════════════════════════════════
//  apiFetch GLOBAL — manejo centralizado de peticiones + 401
//  Disponible en todos los módulos porque sidebar.js carga primero
// ════════════════════════════════════════════════════════════════════
window.apiFetch = async function(path, opts = {}) {
  const token  = localStorage.getItem('jesha_token')
  const apiUrl = window.__JESHA_API_URL__ || 'http://localhost:3000'
  const debugOn = localStorage.getItem('jesha_debug') === '1'
  const start = Date.now()
  const safePath = String(path).split('?')[0]

  // Soporte FormData: no forzar Content-Type, dejar que el navegador lo ponga con boundary
  const esFormData = opts.body instanceof FormData

  let res
  try {
    res = await fetch(`${apiUrl}${path}`, {
      ...opts,
      headers: {
        ...(esFormData ? {} : { 'Content-Type': 'application/json' }),
        'Authorization': `Bearer ${token}`,
        ...(opts.headers || {})
      }
    })
  } catch (err) {
    if (debugOn) {
      console.debug(JSON.stringify({
        event: 'fetch_error',
        method: opts.method || 'GET',
        path: safePath,
        durationMs: Date.now() - start,
        errorType: 'network',
      }))
    }
    throw err
  }

  if (debugOn) {
    console.debug(JSON.stringify({
      event: 'fetch',
      method: opts.method || 'GET',
      path: safePath,
      status: res.status,
      durationMs: Date.now() - start,
      requestId: res.headers.get('X-Request-Id') || null,
    }))
    if (res.status === 401) {
      console.debug(JSON.stringify({ event: 'fetch_401', path: safePath }))
    }
  }

  // Intentar parsear JSON de forma segura (fallback: null si es HTML/texto)
  const data = await res.json().catch(() => null)

  // Token expirado o inválido — redirigir a login
  if (res.status === 401) {
    localStorage.removeItem('jesha_token')
    localStorage.removeItem('jesha_usuario')
    window.location.href = 'login.html'
    throw new Error('Sesión expirada')
  }

  // Permisos insuficientes — toast y lanzar error
  if (res.status === 403) {
    const msg = (data && data.error) || 'No tienes permisos para realizar esta acción'
    if (window.jeshaToast) jeshaToast(msg, 'error')
    throw new Error(msg)
  }

  if (!res.ok) {
    const msg = (data && data.error) || `Error ${res.status}: ${res.statusText}`
    throw new Error(msg)
  }

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

// ════════════════════════════════════════════════════════════════════
//  CHEQUEO DE NUEVA VERSIÓN — avisa (NO recarga solo) cuando hay deploy nuevo
//  Lee /version.json (generado en el build de Cloudflare con el commit SHA).
//  Banner manual: el usuario decide cuándo recargar — nunca auto-reload en POS.
//  Pertenece al ORIGEN del frontend (no a la API): por eso usa fetch directo,
//  root-relative, y NO apiFetch. En local (:5500) /version.json da 404 → silencio.
// ════════════════════════════════════════════════════════════════════
let versionActual          = null
let bannerVersionMostrado  = false
let versionCheckerIniciado = false
let ultimoChequeoVersion   = 0

async function chequearVersionApp() {
  // Debounce: focus + visibilitychange pueden dispararse juntos al volver a la pestaña
  if (Date.now() - ultimoChequeoVersion < 5000) return
  ultimoChequeoVersion = Date.now()

  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return                          // 404 en local/dev: esperado, ignorar
    const data = await res.json().catch(() => null)
    if (!data || !data.v) return                 // JSON inválido o sin campo v: ignorar

    if (versionActual === null) {                // primera lectura: fija baseline
      versionActual = data.v
      return
    }
    if (data.v !== versionActual && !bannerVersionMostrado) {
      mostrarBannerNuevaVersion()
    }
  } catch (_) {
    // offline / red caída: ignorar en silencio, se reintenta en el próximo ciclo
  }
}

function mostrarBannerNuevaVersion() {
  if (bannerVersionMostrado) return
  if (document.getElementById('jesha-banner-version')) return
  bannerVersionMostrado = true

  const banner = document.createElement('div')
  banner.id = 'jesha-banner-version'
  // Barra fija superior SIN backdrop: visible sobre todo, pero NO bloquea el
  // modal de cobro del POS (z-index 100000 > modales 9999 y #dd-bit-clientes 99999)
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '0', right: '0',
    zIndex: '100000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: '14px', flexWrap: 'wrap',
    padding: '10px 18px',
    background: 'rgba(31,58,102,0.97)',
    borderBottom: '1px solid rgba(255,255,255,0.14)',
    color: '#e9edf4',
    fontFamily: "'Barlow', sans-serif",
    fontSize: '0.9rem', fontWeight: '600',
    boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
    pointerEvents: 'auto'
  })
  banner.innerHTML = `
    <span style="line-height:1.4;">Hay una nueva versión disponible. Actualiza para ver los cambios.</span>
    <button id="jesha-btn-actualizar" style="
      padding:7px 18px; border-radius:8px; cursor:pointer;
      background:rgba(96,208,128,0.16); border:1px solid rgba(96,208,128,0.4);
      color:#60d080; font-family:'Barlow',sans-serif; font-size:0.875rem; font-weight:700;
    ">Actualizar</button>
  `
  document.body.appendChild(banner)
  document.getElementById('jesha-btn-actualizar')
    .addEventListener('click', () => window.location.reload())
}

function iniciarVersionChecker() {
  if (versionCheckerIniciado) return            // guard: nunca duplica setInterval/listeners
  versionCheckerIniciado = true

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') chequearVersionApp()
  })
  window.addEventListener('focus', chequearVersionApp)
  setInterval(chequearVersionApp, 60000)
  chequearVersionApp()                          // lectura inicial: fija la baseline
}

// ════════════════════════════════════════════════════════════════════
//  JESHA MODAL SYSTEM — reemplaza confirm() y prompt() nativos
//  Uso:
//    await jeshaConfirm({ title, message, confirmText, type })
//    await jeshaPrompt({ title, label, placeholder, confirmText })
// ════════════════════════════════════════════════════════════════════
;(function() {
  // Inyectar estilos una sola vez
  if (!document.getElementById('jesha-modal-styles')) {
    const style = document.createElement('style')
    style.id = 'jesha-modal-styles'
    style.textContent = `
      #jesha-overlay {
        display:none; position:fixed; inset:0; z-index:9999;
        background:rgba(0,0,0,0.75); align-items:center; justify-content:center; padding:16px;
      }
      #jesha-overlay.active { display:flex; }
      #jesha-dialog {
        background:var(--sidebar-bg,#0e1014);
        border:1px solid var(--panel-border,rgba(255,255,255,0.07));
        border-radius:14px; width:100%; max-width:420px;
        box-shadow:0 24px 60px rgba(0,0,0,0.6);
        animation:jeshaSlideUp 0.18s ease;
        font-family:'Barlow',sans-serif;
      }
      @keyframes jeshaSlideUp {
        from { opacity:0; transform:translateY(12px); }
        to   { opacity:1; transform:translateY(0); }
      }
      #jesha-dialog-header {
        display:flex; align-items:center; gap:10px;
        padding:16px 20px 12px;
        border-bottom:1px solid var(--panel-border,rgba(255,255,255,0.07));
      }
      #jesha-dialog-icon { font-size:1.2rem; flex-shrink:0; }
      #jesha-dialog-title {
        font-family:'Barlow Condensed',sans-serif;
        font-size:1.05rem; font-weight:700;
        letter-spacing:0.04em; text-transform:uppercase;
        color:var(--text,#e9edf4); margin:0;
      }
      #jesha-dialog-body { padding:16px 20px; }
      #jesha-dialog-msg {
        color:var(--muted,#7a8599); font-size:0.9rem;
        line-height:1.55; margin:0 0 4px;
      }
      #jesha-dialog-input {
        width:100%; margin-top:12px; padding:9px 12px;
        background:rgba(255,255,255,0.04);
        border:1px solid var(--panel-border,rgba(255,255,255,0.07));
        border-radius:8px; color:var(--text,#e9edf4);
        font-family:'Barlow',sans-serif; font-size:0.9rem;
        outline:none; box-sizing:border-box;
        transition:border-color 0.15s;
      }
      #jesha-dialog-input:focus {
        border-color:rgba(255,255,255,0.2);
      }
      #jesha-dialog-footer {
        display:flex; justify-content:flex-end; gap:8px;
        padding:12px 20px 16px;
      }
      .jesha-btn {
        display:inline-flex; align-items:center; gap:6px;
        padding:8px 18px; border-radius:8px; font-family:'Barlow',sans-serif;
        font-size:0.875rem; font-weight:600; cursor:pointer;
        border:1px solid; transition:background 0.15s;
      }
      .jesha-btn-cancel {
        background:rgba(255,255,255,0.04);
        border-color:rgba(255,255,255,0.1);
        color:var(--muted,#7a8599);
      }
      .jesha-btn-cancel:hover { background:rgba(255,255,255,0.08); color:var(--text,#e9edf4); }
      .jesha-btn-danger  { background:rgba(255,107,107,0.1);  border-color:rgba(255,107,107,0.3);  color:#ff6b6b; }
      .jesha-btn-danger:hover  { background:rgba(255,107,107,0.2); }
      .jesha-btn-warning { background:rgba(255,193,7,0.1);    border-color:rgba(255,193,7,0.3);    color:#ffc107; }
      .jesha-btn-warning:hover { background:rgba(255,193,7,0.2); }
      .jesha-btn-primary { background:rgba(31,58,102,0.8);    border-color:rgba(31,58,102,1);      color:#e9edf4; }
      .jesha-btn-primary:hover { background:rgba(36,63,114,0.9); }
      .jesha-btn-success { background:rgba(96,208,128,0.12);  border-color:rgba(96,208,128,0.3);   color:#60d080; }
      .jesha-btn-success:hover { background:rgba(96,208,128,0.22); }
    `
    document.head.appendChild(style)
  }

  // Crear el overlay/dialog una sola vez
  function ensureDialog() {
    if (document.getElementById('jesha-overlay')) return
    const overlay = document.createElement('div')
    overlay.id = 'jesha-overlay'
    overlay.innerHTML = `
      <div id="jesha-dialog">
        <div id="jesha-dialog-header">
          <span id="jesha-dialog-icon"></span>
          <h3 id="jesha-dialog-title"></h3>
        </div>
        <div id="jesha-dialog-body">
          <p id="jesha-dialog-msg"></p>
          <input type="text" id="jesha-dialog-input" style="display:none" />
        </div>
        <div id="jesha-dialog-footer">
          <button class="jesha-btn jesha-btn-cancel" id="jesha-btn-cancel">Cancelar</button>
          <button class="jesha-btn jesha-btn-primary" id="jesha-btn-confirm">Confirmar</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
  }

  // ── jeshaConfirm ──────────────────────────────────────────────────
  // type: 'danger' | 'warning' | 'primary' | 'success'
  window.jeshaConfirm = function({ title = '¿Confirmar acción?', message = '', confirmText = 'Confirmar', cancelText = 'Cancelar', type = 'danger' } = {}) {
    return new Promise(resolve => {
      ensureDialog()
      const overlay  = document.getElementById('jesha-overlay')
      const iconEl   = document.getElementById('jesha-dialog-icon')
      const titleEl  = document.getElementById('jesha-dialog-title')
      const msgEl    = document.getElementById('jesha-dialog-msg')
      const inputEl  = document.getElementById('jesha-dialog-input')
      const btnOk    = document.getElementById('jesha-btn-confirm')
      const btnCancel= document.getElementById('jesha-btn-cancel')

      const icons = { danger:'⚠️', warning:'⚠️', primary:'ℹ️', success:'✅' }
      iconEl.textContent  = icons[type] || '❓'
      titleEl.textContent = title
      msgEl.innerHTML     = message
      inputEl.style.display = 'none'
      btnCancel.textContent = cancelText
      btnOk.textContent   = confirmText
      btnOk.className     = `jesha-btn jesha-btn-${type}`

      overlay.classList.add('active')

      const cleanup = (result) => {
        overlay.classList.remove('active')
        btnOk.removeEventListener('click', onOk)
        btnCancel.removeEventListener('click', onCancel)
        overlay.removeEventListener('click', onOverlay)
        document.removeEventListener('keydown', onKey)
        resolve(result)
      }
      const onOk      = () => cleanup(true)
      const onCancel  = () => cleanup(false)
      const onOverlay = (e) => { if (e.target === overlay) cleanup(false) }
      const onKey     = (e) => { if (e.key === 'Escape') cleanup(false) }

      btnOk.addEventListener('click', onOk)
      btnCancel.addEventListener('click', onCancel)
      overlay.addEventListener('click', onOverlay)
      document.addEventListener('keydown', onKey)
    })
  }

  // ── jeshaPrompt ───────────────────────────────────────────────────
  window.jeshaPrompt = function({ title = 'Ingresa un valor', label = '', placeholder = '', confirmText = 'Crear', cancelText = 'Cancelar', defaultValue = '' } = {}) {
    return new Promise(resolve => {
      ensureDialog()
      const overlay  = document.getElementById('jesha-overlay')
      const iconEl   = document.getElementById('jesha-dialog-icon')
      const titleEl  = document.getElementById('jesha-dialog-title')
      const msgEl    = document.getElementById('jesha-dialog-msg')
      const inputEl  = document.getElementById('jesha-dialog-input')
      const btnOk    = document.getElementById('jesha-btn-confirm')
      const btnCancel= document.getElementById('jesha-btn-cancel')

      iconEl.textContent    = 'ℹ️'
      titleEl.textContent   = title
      msgEl.textContent     = label
      inputEl.style.display = 'block'
      inputEl.placeholder   = placeholder
      inputEl.value         = defaultValue
      btnCancel.textContent = cancelText
      btnOk.textContent     = confirmText
      btnOk.className       = 'jesha-btn jesha-btn-primary'

      overlay.classList.add('active')
      setTimeout(() => inputEl.focus(), 80)

      const cleanup = (result) => {
        overlay.classList.remove('active')
        btnOk.removeEventListener('click', onOk)
        btnCancel.removeEventListener('click', onCancel)
        overlay.removeEventListener('click', onOverlay)
        document.removeEventListener('keydown', onKey)
        inputEl.removeEventListener('keydown', onEnter)
        resolve(result)
      }
      const onOk      = () => cleanup(inputEl.value.trim() || null)
      const onCancel  = () => cleanup(null)
      const onOverlay = (e) => { if (e.target === overlay) cleanup(null) }
      const onKey     = (e) => { if (e.key === 'Escape') cleanup(null) }
      const onEnter   = (e) => { if (e.key === 'Enter') cleanup(inputEl.value.trim() || null) }

      btnOk.addEventListener('click', onOk)
      btnCancel.addEventListener('click', onCancel)
      overlay.addEventListener('click', onOverlay)
      document.addEventListener('keydown', onKey)
      inputEl.addEventListener('keydown', onEnter)
    })
  }
})()

// ════════════════════════════════════════════════════════════════════
//  jeshaToast — reemplaza alert() nativo en todos los módulos
//  Uso: jeshaToast('Mensaje')                    → error (rojo)
//       jeshaToast('Guardado', 'success')         → verde
//       jeshaToast('Atención', 'warning')         → naranja
//       jeshaToast('Información', 'info')         → azul
// ════════════════════════════════════════════════════════════════════
window.jeshaToast = function(mensaje, tipo = 'error', duracion = 4000) {
  let container = document.getElementById('jesha-toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'jesha-toast-container'
    Object.assign(container.style, {
      position: 'fixed', top: '20px', right: '20px',
      zIndex: '9999', display: 'flex', flexDirection: 'column',
      gap: '8px', maxWidth: '420px', pointerEvents: 'none'
    })
    document.body.appendChild(container)
  }

  const colores = {
    error:   { bg: 'rgba(255,107,107,0.12)', border: 'rgba(255,107,107,0.35)', texto: '#ff6b6b', icono: '✕' },
    warning: { bg: 'rgba(232,113,10,0.12)',  border: 'rgba(232,113,10,0.35)',  texto: '#e8710a', icono: '⚠' },
    info:    { bg: 'rgba(74,144,226,0.12)',  border: 'rgba(74,144,226,0.35)',  texto: '#4a90e2', icono: 'ℹ' },
    success: { bg: 'rgba(96,208,128,0.12)',  border: 'rgba(96,208,128,0.35)',  texto: '#60d080', icono: '✓' }
  }
  const col = colores[tipo] || colores.error

  const ariaMap = {
    error:   { role: 'alert', live: 'assertive' },
    warning: { role: 'alert', live: 'assertive' },
    info:    { role: 'status', live: 'polite' },
    success: { role: 'status', live: 'polite' }
  }
  const ac = ariaMap[tipo] || ariaMap.error

  function cerrarToast(el) {
    if (el._toastCerrando) return
    el._toastCerrando = true
    clearTimeout(el._toastTimer)
    el.style.setProperty('--toast-height', el.scrollHeight + 'px')
    el.style.animation = 'jeshaToastOut 0.2s ease forwards'
    setTimeout(function() {
      if (el.parentElement) {
        el.parentElement.removeChild(el)
        if (container && container.children.length === 0 && container.parentElement) {
          container.parentElement.removeChild(container)
        }
      }
    }, 200)
  }

  // Dedup: buscar toast existente con mismo mensaje + tipo
  var existing = null
  for (var i = 0; i < container.children.length; i++) {
    var child = container.children[i]
    if (child._toastKey === mensaje + '|' + tipo) {
      existing = child
      break
    }
  }
  if (existing) {
    var countEl = existing.querySelector('.jesha-toast-count')
    if (countEl) {
      var c = parseInt(countEl.dataset.count || '1') + 1
      countEl.dataset.count = String(c)
      countEl.textContent = '\u00D7' + c
      countEl.style.animation = 'jeshaToastBump 0.2s ease'
    }
    clearTimeout(existing._toastTimer)
    existing._toastTimer = setTimeout(function() { cerrarToast(existing) }, duracion)
    return
  }

  var toast = document.createElement('div')
  toast._toastKey = mensaje + '|' + tipo
  toast.role = ac.role
  toast.setAttribute('aria-live', ac.live)
  toast.setAttribute('aria-atomic', 'true')
  toast.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:13px 18px;' +
    'border-radius:10px;font-family:\'Barlow\',sans-serif;font-size:0.9rem;' +
    'font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.4);line-height:1.4;' +
    'pointer-events:auto;animation:jeshaToastIn 0.2s cubic-bezier(0.34,1.56,0.64,1);' +
    'background:' + col.bg + ';border:1px solid ' + col.border + ';color:' + col.texto + ';'

  var iconSpan = document.createElement('span')
  iconSpan.style.cssText = 'font-size:1rem;flex-shrink:0;'
  iconSpan.textContent = col.icono

  var msgSpan = document.createElement('span')
  msgSpan.textContent = mensaje

  var countSpan = document.createElement('span')
  countSpan.className = 'jesha-toast-count'
  countSpan.dataset.count = '1'
  countSpan.style.cssText = 'font-size:0.75rem;font-weight:700;opacity:0.7;flex-shrink:0;'
  countSpan.textContent = ''

  var closeBtn = document.createElement('button')
  closeBtn.style.cssText =
    'background:none;border:none;cursor:pointer;padding:0 0 0 4px;' +
    'opacity:0.7;line-height:1;font-size:1.1rem;color:' + col.texto + ';flex-shrink:0;'
  closeBtn.textContent = '\u00D7'
  closeBtn.addEventListener('click', function() { cerrarToast(toast) })

  toast.appendChild(iconSpan)
  toast.appendChild(msgSpan)
  toast.appendChild(countSpan)
  toast.appendChild(closeBtn)
  container.appendChild(toast)

  toast._toastTimer = setTimeout(function() { cerrarToast(toast) }, duracion)

  var pausar = function() { clearTimeout(toast._toastTimer) }
  var reanudar = function() {
    clearTimeout(toast._toastTimer)
    toast._toastTimer = setTimeout(function() { cerrarToast(toast) }, duracion)
  }
  toast.addEventListener('mouseenter', pausar)
  toast.addEventListener('focusin', pausar)
  toast.addEventListener('mouseleave', reanudar)
  toast.addEventListener('focusout', reanudar)

  while (container.children.length > 3) {
    var oldest = container.firstChild
    if (oldest) cerrarToast(oldest)
  }
}

// ════════════════════════════════════════════════════════════════════
//  Banner de Alertas de Stock — se muestra después de operaciones
//  stockAlerts: [{ productoId, nombre, codigoInterno, stockActual, stockMinimo, precioVenta, estado }]
// ════════════════════════════════════════════════════════════════════
if (!document.getElementById('jesha-stock-banner-styles')) {
  const st = document.createElement('style')
  st.id = 'jesha-stock-banner-styles'
  st.textContent = `
    @keyframes stockBannerIn { from { opacity:0; transform:translateY(-16px); } to { opacity:1; transform:translateY(0); } }
    @keyframes stockBannerOut { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(-16px); max-height:0; padding:0; margin:0; overflow:hidden; } }
    #jesha-stock-banner {
      animation: stockBannerIn 0.25s ease;
      margin-bottom:12px;
    }
    #jesha-stock-banner.closing {
      animation: stockBannerOut 0.25s ease forwards;
    }
  `
  document.head.appendChild(st)
}

window.mostrarBannerStockAlertas = function(stockAlerts) {
  if (!stockAlerts || stockAlerts.length === 0) return
  window.Sonidos?.play?.('chime')
  document.getElementById('jesha-stock-banner')?.remove()

  const sinStock = stockAlerts.filter(a => a.estado === 'SIN_STOCK')
  const stockBajo = stockAlerts.filter(a => a.estado === 'STOCK_BAJO')
  const total = sinStock.length + stockBajo.length

  const banner = document.createElement('div')
  banner.id = 'jesha-stock-banner'
  Object.assign(banner.style, {
    background: 'linear-gradient(135deg, rgba(255,107,107,0.1), rgba(232,113,10,0.08))',
    border: '1px solid rgba(255,107,107,0.25)',
    borderRadius: '10px',
    padding: '12px 16px',
    position: 'relative',
    cursor: 'pointer'
  })

  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', gap: '10px',
    fontFamily: "'Barlow', sans-serif", fontSize: '0.85rem'
  })
  header.innerHTML = `
    <span style="font-size:1.1rem;flex-shrink:0;">⚠️</span>
    <span style="font-weight:700;color:#ff6b6b;text-transform:uppercase;letter-spacing:0.04em;
      font-family:'Barlow Condensed',sans-serif;">
      ${total} producto${total !== 1 ? 's' : ''} cr\u00edtico${total !== 1 ? 's' : ''} de stock
    </span>
    <span style="margin-left:auto;color:var(--muted,#7a8599);font-size:0.8rem;cursor:pointer;" onclick="event.stopPropagation();this.closest('#jesha-stock-banner').classList.add('closing');setTimeout(()=>this.closest('#jesha-stock-banner').remove(),250)">✕</span>
  `
  banner.appendChild(header)

  const list = document.createElement('div')
  Object.assign(list.style, {
    marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px'
  })
  for (const a of stockAlerts) {
    const chip = document.createElement('span')
    const isSin = a.estado === 'SIN_STOCK'
    Object.assign(chip.style, {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '4px 10px', borderRadius: '6px', fontSize: '0.78rem',
      fontWeight: '600', fontFamily: "'Barlow', sans-serif",
      background: isSin ? 'rgba(255,107,107,0.15)' : 'rgba(232,113,10,0.12)',
      border: `1px solid ${isSin ? 'rgba(255,107,107,0.3)' : 'rgba(232,113,10,0.25)'}`,
      color: isSin ? '#ff6b6b' : '#e8710a'
    })
    chip.textContent = `${a.nombre} (${isSin ? '0' : a.stockActual}/${a.stockMinimo})`
    list.appendChild(chip)
  }
  banner.appendChild(list)

  banner.addEventListener('click', () => {
    const pagina = window.location.pathname.split('/').pop()
    if (pagina !== 'reportes.html') {
      window.location.href = 'reportes.html'
    }
  })

  // Insertar al inicio del main-content
  const main = document.querySelector('.main-content, main, #main-content')
  if (main && main.firstChild) {
    main.insertBefore(banner, main.firstChild)
  } else {
    // Fallback: después del sidebar
    const sb = document.getElementById('sidebar-container') || document.querySelector('.sidebar')
    if (sb && sb.nextSibling) {
      sb.parentNode.insertBefore(banner, sb.nextSibling)
    } else {
      document.body.prepend(banner)
    }
  }
}
