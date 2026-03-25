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
