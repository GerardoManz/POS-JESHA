'use strict'

;(async function () {
  const form = document.getElementById('platform-login-form')
  const usernameInput = document.getElementById('platform-username')
  const passwordInput = document.getElementById('platform-password')
  const submitButton = document.getElementById('platform-login-submit')
  const errorBox = document.getElementById('platform-login-error')

  function showError(message) {
    errorBox.textContent = message
    errorBox.hidden = false
  }

  function clearError() {
    errorBox.textContent = ''
    errorBox.hidden = true
  }

  try {
    const actor = await window.jeshaPlatformSession.validate()
    if (actor) {
      window.location.replace(window.jeshaPlatformSession.HOME_PAGE)
      return
    }
  } catch {}

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    clearError()

    const username = usernameInput.value.trim()
    const password = passwordInput.value

    if (!username || !password) {
      showError('Ingresa usuario y contraseña.')
      return
    }

    submitButton.disabled = true
    submitButton.textContent = 'Validando...'

    try {
      await window.jeshaPlatformSession.login(username, password)
      window.location.replace(window.jeshaPlatformSession.HOME_PAGE)
    } catch (err) {
      if (err.status === 429) showError('Demasiados intentos. Intenta de nuevo más tarde.')
      else if (err.status === 400) showError('Revisa los datos de acceso.')
      else if (err.status === 401 || err.status === 403) showError('Credenciales inválidas.')
      else showError('No fue posible iniciar sesión. Intenta nuevamente.')
    } finally {
      submitButton.disabled = false
      submitButton.textContent = 'Ingresar'
    }
  })
})()
