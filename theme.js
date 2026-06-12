// THEME.JS — aplica el tema antes de pintar la UI y expone helpers globales.
;(function() {
  const STORAGE_KEY = 'jesha_theme'
  const VALID_THEMES = new Set(['dark', 'light'])

  function normalizarTema(tema) {
    return VALID_THEMES.has(tema) ? tema : 'dark'
  }

  function getStoredUser() {
    try { return JSON.parse(localStorage.getItem('jesha_usuario') || '{}') }
    catch { return {} }
  }

  function getTheme() {
    const usuario = getStoredUser()
    return normalizarTema(usuario.tema || localStorage.getItem(STORAGE_KEY) || 'dark')
  }

  function updateStoredUserTheme(theme) {
    const raw = localStorage.getItem('jesha_usuario')
    if (!raw) return
    try {
      const usuario = JSON.parse(raw)
      localStorage.setItem('jesha_usuario', JSON.stringify({ ...usuario, tema: theme }))
    } catch {}
  }

  function applyTheme(theme) {
    const nextTheme = normalizarTema(theme)
    document.documentElement.setAttribute('data-theme', nextTheme)
    document.documentElement.style.colorScheme = nextTheme
    return nextTheme
  }

  function setTheme(theme) {
    const nextTheme = applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, nextTheme)
    updateStoredUserTheme(nextTheme)
    window.dispatchEvent(new CustomEvent('jesha:themechange', { detail: { theme: nextTheme } }))
    return nextTheme
  }

  function toggleTheme() {
    return setTheme(getTheme() === 'dark' ? 'light' : 'dark')
  }

  window.jeshaTheme = { getTheme, setTheme, toggleTheme, applyTheme }
  applyTheme(getTheme())
})()
