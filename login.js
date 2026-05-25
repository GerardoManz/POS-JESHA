const API_URL = (typeof CONFIG !== 'undefined' ? CONFIG.API_URL : null) || window.__JESHA_API_URL__ || 'http://localhost:3000'
const DASHBOARD_PAGE = 'index.html'

// Si ya hay sesión activa, redirige al dashboard
const token = localStorage.getItem('jesha_token')
if (token) {
  window.location.href = DASHBOARD_PAGE
}

const form = document.getElementById('login-form')
const usernameInput = document.getElementById('username')
const passwordInput = document.getElementById('password')
const errorBox = document.getElementById('login-error')
const btnLogin = document.querySelector('.btn-login')
const btnTogglePass = document.getElementById('btn-toggle-pass')

btnTogglePass.addEventListener('click', () => {
  const visible = passwordInput.type === 'text'
  passwordInput.type = visible ? 'password' : 'text'
  btnTogglePass.innerHTML = visible
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const username = usernameInput.value.trim()
  const password = passwordInput.value.trim()

  btnLogin.disabled = true
  btnLogin.textContent = 'Ingresando...'
  errorBox.textContent = ''

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })

    const data = await response.json()

    if (!response.ok) {
      errorBox.textContent = data.error || 'Credenciales inválidas'
      return
    }

    // Guardar token y datos del usuario
    localStorage.setItem('jesha_token', data.token)
    localStorage.setItem('jesha_usuario', JSON.stringify(data.usuario))

    window.location.href = DASHBOARD_PAGE

  } catch (err) {
    errorBox.textContent = 'No se pudo conectar con el servidor'
  } finally {
    btnLogin.disabled = false
    btnLogin.textContent = 'Ingresar'
  }
})