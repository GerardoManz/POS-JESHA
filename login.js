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
const btnLogin = document.querySelector('.btn-login')
const btnTogglePass = document.getElementById('btn-toggle-pass')

const lastEmpresaSlug = localStorage.getItem(LAST_EMPRESA_KEY)
if (lastEmpresaSlug) empresaSlugInput.value = lastEmpresaSlug

btnTogglePass.addEventListener('click', () => {
  const visible = passwordInput.type === 'text'
  passwordInput.type = visible ? 'password' : 'text'
  btnTogglePass.innerHTML = visible
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
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
      return
    }

    window.jeshaSession.start({ token: data.token, usuario: data.usuario, empresaSlug })
    localStorage.setItem(LAST_EMPRESA_KEY, empresaSlug)
    localStorage.setItem('jesha_theme', data.usuario?.tema || 'dark')
    window.location.href = DASHBOARD_PAGE
  } catch (err) {
    console.error('Error de login tenant:', err)
    errorBox.textContent = err?.message === 'Sesión tenant inválida'
      ? 'La cuenta no pertenece al acceso empresarial del POS'
      : 'No se pudo conectar con el servidor'
  } finally {
    btnLogin.disabled = false
    btnLogin.textContent = 'Ingresar'
  }
})
