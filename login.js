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