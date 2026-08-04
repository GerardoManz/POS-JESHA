'use strict'

const API_URL = (typeof CONFIG !== 'undefined' ? CONFIG.API_URL : null) || window.__JESHA_API_URL__ || 'http://localhost:3000'
const DASHBOARD_PAGE = 'dashboard.html'
const LAST_EMPRESA_KEY = 'jesha_last_empresa_slug'

if (window.jeshaSession?.isValid()) {
  window.location.href = DASHBOARD_PAGE
} else if (localStorage.getItem('jesha_token') || localStorage.getItem('jesha_usuario')) {
  window.jeshaSession?.clear()
}

const form = document.getElementById('login-form')
const empresaSlugInput = document.getElementById('empresa-slug')
const usernameInput = document.getElementById('username')
const passwordInput = document.getElementById('password')
const errorBox = document.getElementById('login-error')
const sucursalError = document.getElementById('sucursal-error')
const btnLogin = document.querySelector('.btn-login')
const btnTogglePass = document.getElementById('btn-toggle-pass')
const recordarCheck = document.getElementById('recordar-empresa')

const loginStep = document.getElementById('login-step')
const sucursalStep = document.getElementById('sucursal-step')
const sucursalSelect = document.getElementById('sucursal-select')
const btnContinuar = document.getElementById('btn-continuar-sucursal')
const bienvenida = document.getElementById('sucursal-bienvenida')

let pendingToken = null
let pendingUsuario = null
let pendingEmpresaSlug = null

const lastEmpresaSlug = localStorage.getItem(LAST_EMPRESA_KEY)
if (lastEmpresaSlug) {
  empresaSlugInput.value = lastEmpresaSlug
  recordarCheck.checked = true
}

btnTogglePass.addEventListener('click', () => {
  const visible = passwordInput.type === 'text'
  passwordInput.type = visible ? 'password' : 'text'
  btnTogglePass.innerHTML = visible
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
})

function tieneSucursalFija(usuario) {
  return usuario.sucursalId != null && Number.isFinite(Number(usuario.sucursalId))
}

function necesitaSelectorSucursal(usuario) {
  if (!usuario || typeof usuario !== 'object') return false
  const rol = usuario.rol
  if (rol !== 'SUPERADMIN' && rol !== 'PRECIOS') return false
  return !tieneSucursalFija(usuario)
}

async function validarContextYSesion(token, usuario, empresaSlug, selectedSucursalId) {
  const apiBase = window.__JESHA_API_URL__ || API_URL
  const headers = { Authorization: `Bearer ${token}` }
  if (selectedSucursalId !== null && selectedSucursalId !== undefined) {
    headers['X-Sucursal-Id'] = String(selectedSucursalId)
  }

  const res = await fetch(`${apiBase}/auth/context`, { headers })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || 'Contexto de sucursal no válido')
  }

  const context = await res.json()

  if (typeof window.jeshaSession?.validarContexto === 'function') {
    window.jeshaSession.validarContexto(context, usuario, selectedSucursalId)
  } else {
    throw new Error('Sesión tenant inválida')
  }

  window.jeshaSession.start({ token, usuario, empresaSlug })
  if (context.branch.sucursalId !== null) {
    window.jeshaSession.setSelectedSucursalId(context.branch.sucursalId)
  }
  if (recordarCheck.checked) {
    localStorage.setItem(LAST_EMPRESA_KEY, empresaSlug)
  } else {
    localStorage.removeItem(LAST_EMPRESA_KEY)
  }
  localStorage.setItem('jesha_theme', usuario?.tema || 'dark')
  window.location.href = DASHBOARD_PAGE
}

async function completarParaFijo() {
  try {
    await validarContextYSesion(pendingToken, pendingUsuario, pendingEmpresaSlug, null)
  } catch (err) {
    errorBox.textContent = err.message
    pendingToken = null
    pendingUsuario = null
    pendingEmpresaSlug = null
    btnLogin.disabled = false
    btnLogin.textContent = 'Ingresar'
  }
}

async function mostrarSelectorSucursal() {
  loginStep.classList.remove('step-active')
  loginStep.classList.add('step-hidden')
  sucursalStep.classList.remove('step-hidden')
  sucursalStep.classList.add('step-active')

  bienvenida.textContent = `Bienvenido, ${pendingUsuario?.nombre || 'usuario'}`

  const apiBase = window.__JESHA_API_URL__ || API_URL
  try {
    const res = await fetch(`${apiBase}/sucursales/disponibles`, {
      headers: { Authorization: `Bearer ${pendingToken}` }
    })
    if (!res.ok) throw new Error('No se pudieron cargar sucursales')
    const data = await res.json()
    const lista = data.sucursales || []

    if (lista.length === 0) {
      sucursalStep.classList.remove('step-active')
      sucursalStep.classList.add('step-hidden')

      document.querySelector('.card .left').insertAdjacentHTML(
        'beforeend',
        '<div class="onboarding-msg" style="text-align:center;padding:1rem;color:var(--text-muted,#9ca3af);font-size:0.9rem">Esta empresa todavía no tiene sucursales configuradas.</div>'
      )
      await validarContextYSesion(pendingToken, pendingUsuario, pendingEmpresaSlug, null)
      return
    }

    if (lista.length === 1) {
      const autoId = lista[0].id
      await validarContextYSesion(pendingToken, pendingUsuario, pendingEmpresaSlug, autoId)
      return
    }

    sucursalSelect.innerHTML = '<option value="">— Selecciona una sucursal —</option>'
    lista.forEach((s) => {
      const opt = document.createElement('option')
      opt.value = s.id
      opt.textContent = s.nombre
      sucursalSelect.appendChild(opt)
    })
  } catch (err) {
    console.error('Error cargando sucursales:', err)
    sucursalError.textContent = err.message || 'Error al cargar sucursales'
    pendingToken = null
    pendingUsuario = null
    pendingEmpresaSlug = null
  }
}

btnContinuar.addEventListener('click', async () => {
  const val = sucursalSelect.value
  if (!val) {
    sucursalError.textContent = 'Debes seleccionar una sucursal'
    return
  }
  sucursalError.textContent = ''
  btnContinuar.disabled = true
  btnContinuar.textContent = 'Validando...'

  try {
    await validarContextYSesion(pendingToken, pendingUsuario, pendingEmpresaSlug, Number(val))
  } catch (err) {
    sucursalError.textContent = err.message
    btnContinuar.disabled = false
    btnContinuar.textContent = 'Continuar'
  }
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const empresaSlug = empresaSlugInput.value.trim().toLowerCase()
  const username = usernameInput.value.trim()
  const password = passwordInput.value

  btnLogin.disabled = true
  btnLogin.textContent = 'Ingresando...'
  errorBox.textContent = ''

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresaSlug, username, password })
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      errorBox.textContent = data?.error || 'Credenciales inválidas'
      btnLogin.disabled = false
      btnLogin.textContent = 'Ingresar'
      return
    }

    pendingToken = data.token
    pendingUsuario = data.usuario
    pendingEmpresaSlug = empresaSlug

    if (tieneSucursalFija(data.usuario)) {
      await completarParaFijo()
    } else if (necesitaSelectorSucursal(data.usuario)) {
      await mostrarSelectorSucursal()
    } else {
      errorBox.textContent = 'Error de configuración de cuenta'
      btnLogin.disabled = false
      btnLogin.textContent = 'Ingresar'
    }
  } catch (err) {
    console.error('Error de login tenant:', err)
    errorBox.textContent = err?.message === 'Sesión tenant inválida'
      ? 'La cuenta no pertenece al acceso empresarial del POS'
      : 'No se pudo conectar con el servidor'
    btnLogin.disabled = false
    btnLogin.textContent = 'Ingresar'
  }
})
