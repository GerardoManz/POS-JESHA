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

function mensajeLoginSeguro(error, fallback = 'No fue posible completar el acceso. Intenta nuevamente.') {
  const status = error?.status
  if (status === 400) return 'Revisa los datos de acceso.'
  if (status === 401 || status === 403) return 'Usuario o contraseña incorrectos.'
  if (status >= 500) return 'No fue posible iniciar sesión. Intenta nuevamente.'
  return fallback
}

const loginBrandName = document.getElementById('login-brand-name')
const loginBrandLogo = document.getElementById('login-brand-logo')
const BRANDING_DEFAULTS = Object.freeze({
  colorPrimario: '#1e3a5f',
  colorSecundario: '#3b82f6',
  colorAcento: '#10b981'
})
const COLOR_RE = /^#[0-9a-f]{6}$/i
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
let brandingDebounce = null
let brandingRequestId = 0
let brandingAbortController = null

function slugValido(slug) {
  return typeof slug === 'string' && slug.length >= 1 && slug.length <= 80 && SLUG_RE.test(slug)
}

function colorSeguro(value, fallback) {
  return typeof value === 'string' && COLOR_RE.test(value.trim()) ? value.trim() : fallback
}

function logoUrlSegura(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim(), window.location.origin)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function aplicarBrandingNeutral() {
  loginBrandLogo.onload = null
  loginBrandLogo.onerror = null
  loginBrandName.textContent = 'POS'
  loginBrandName.className = 'brand-name-neutral'
  loginBrandLogo.hidden = true
  loginBrandLogo.removeAttribute('src')
  loginBrandLogo.alt = ''
  document.documentElement.style.setProperty('--brand-primary', BRANDING_DEFAULTS.colorPrimario)
  document.documentElement.style.setProperty('--brand-secondary', BRANDING_DEFAULTS.colorSecundario)
  document.documentElement.style.setProperty('--brand-accent', BRANDING_DEFAULTS.colorAcento)
}

function aplicarBranding(branding, requestId) {
  const data = branding && typeof branding === 'object' ? branding : {}
  const nombre = typeof data.nombreComercial === 'string' ? data.nombreComercial.trim() : ''
  const logoUrl = logoUrlSegura(data.logoUrl)

  loginBrandName.textContent = nombre || 'POS'
  loginBrandName.className = nombre ? 'brand-name-tenant' : 'brand-name-neutral'
  document.documentElement.style.setProperty('--brand-primary', colorSeguro(data.colorPrimario, BRANDING_DEFAULTS.colorPrimario))
  document.documentElement.style.setProperty('--brand-secondary', colorSeguro(data.colorSecundario, BRANDING_DEFAULTS.colorSecundario))
  document.documentElement.style.setProperty('--brand-accent', colorSeguro(data.colorAcento, BRANDING_DEFAULTS.colorAcento))

  loginBrandLogo.hidden = true
  loginBrandLogo.removeAttribute('src')
  loginBrandLogo.alt = ''
  if (!logoUrl) return

  loginBrandLogo.onload = () => {
    if (requestId === brandingRequestId) loginBrandLogo.hidden = false
  }
  loginBrandLogo.onerror = () => {
    if (requestId === brandingRequestId) aplicarBrandingNeutral()
  }
  loginBrandLogo.alt = nombre ? `Logo de ${nombre}` : ''
  loginBrandLogo.src = logoUrl
}

function cancelarBranding() {
  brandingRequestId += 1
  if (brandingAbortController) brandingAbortController.abort()
  brandingAbortController = null
  aplicarBrandingNeutral()
}

async function fetchBranding(slug) {
  if (!slugValido(slug)) {
    cancelarBranding()
    return
  }

  const requestId = ++brandingRequestId
  if (brandingAbortController) brandingAbortController.abort()
  brandingAbortController = new AbortController()

  try {
    const res = await fetch(`${API_URL}/branding?slug=${encodeURIComponent(slug)}`, { signal: brandingAbortController.signal })
    const data = await res.json().catch(() => null)
    if (requestId !== brandingRequestId) return
    aplicarBranding(data?.branding, requestId)
  } catch (error) {
    if (error?.name !== 'AbortError' && requestId === brandingRequestId) aplicarBrandingNeutral()
  } finally {
    if (requestId === brandingRequestId) brandingAbortController = null
  }
}

empresaSlugInput.addEventListener('input', () => {
  clearTimeout(brandingDebounce)
  cancelarBranding()
  const slug = empresaSlugInput.value.trim().toLowerCase()
  if (slugValido(slug)) {
    brandingDebounce = setTimeout(() => fetchBranding(slug), 300)
  }
})

const lastEmpresaSlug = localStorage.getItem(LAST_EMPRESA_KEY)
if (slugValido(lastEmpresaSlug)) {
  empresaSlugInput.value = lastEmpresaSlug
  recordarCheck.checked = true
  fetchBranding(lastEmpresaSlug).catch(() => {})
} else if (lastEmpresaSlug) {
  localStorage.removeItem(LAST_EMPRESA_KEY)
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
    const error = new Error('No fue posible validar la sucursal seleccionada.')
    error.status = res.status
    throw error
  }

  const context = await res.json()

  if (typeof window.jeshaSession?.validarContexto === 'function') {
    window.jeshaSession.validarContexto(context, usuario, selectedSucursalId)
  } else {
    throw new Error('No fue posible validar la sesión.')
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
    errorBox.textContent = mensajeLoginSeguro(err, 'No fue posible validar tu acceso. Intenta nuevamente.')
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
    sucursalError.textContent = mensajeLoginSeguro(err, 'No fue posible cargar las sucursales. Intenta nuevamente.')
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
    sucursalError.textContent = mensajeLoginSeguro(err, 'No fue posible validar la sucursal seleccionada.')
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
      errorBox.textContent = response.status === 400
        ? 'Revisa los datos de acceso.'
        : response.status === 401
          ? 'Usuario o contraseña incorrectos.'
          : 'No fue posible iniciar sesión. Intenta nuevamente.'
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
    errorBox.textContent = mensajeLoginSeguro(err, 'No se pudo conectar con el servidor.')
    btnLogin.disabled = false
    btnLogin.textContent = 'Ingresar'
  }
})
