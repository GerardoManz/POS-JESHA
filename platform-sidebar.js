'use strict'

;(function () {
  const SIDEBAR_CONTAINER = 'platform-sidebar-container'
  const SIDEBAR_FRAGMENT = 'platform-sidebar.html'
  const MENU_ACTIVE_PAGE = 'empresas'
  const COLLAPSE_KEY = 'jesha_platform_sidebar_collapsed'
  const THEME_KEY = 'jesha_platform_theme'
  const VALID_THEMES = new Set(['dark', 'light'])

  function container() {
    return document.getElementById(SIDEBAR_CONTAINER)
  }

  function injectSidebar() {
    const el = container()
    if (!el) return

    const fragmentUrl = `${window.location.pathname.replace(/[^/]*$/, '')}${SIDEBAR_FRAGMENT}`
    fetch(fragmentUrl, { cache: 'no-store' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('NO_SIDEBAR'))))
      .then((html) => {
        el.innerHTML = html
        marcarActivo()
        configurarShell()
      })
      .catch(() => {
        // Si el fragmento no se pudo cargar, el HTML estático ya trae el
        // sidebar de respaldo; solo configurar eventos sobre él.
        marcarActivo()
        configurarShell()
      })
  }

  function marcarActivo() {
    const page = document.body.getAttribute('data-page') || MENU_ACTIVE_PAGE
    const items = container().querySelectorAll('.menu-item[data-page]')
    items.forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-page') === page)
    })
  }

  // ── Colapso persistente del sidebar (aplica sobre .app-shell) ──
  function configurarColapso() {
    const appShell = document.querySelector('.app-shell')
    const toggleBtn = document.getElementById('platform-sidebar-toggle')
    if (!appShell || !toggleBtn) return

    const collapsed = localStorage.getItem(COLLAPSE_KEY) === 'true'
    if (collapsed) {
      appShell.classList.add('sidebar-collapsed')
      toggleBtn.setAttribute('aria-label', 'Expandir menú')
    }

    toggleBtn.addEventListener('click', () => {
      const isNowCollapsed = appShell.classList.toggle('sidebar-collapsed')
      localStorage.setItem(COLLAPSE_KEY, String(isNowCollapsed))
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

  function getTheme() {
    const stored = localStorage.getItem(THEME_KEY)
    return VALID_THEMES.has(stored) ? stored : 'dark'
  }

  function applyTheme(theme) {
    const next = VALID_THEMES.has(theme) ? theme : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    document.documentElement.style.colorScheme = next
    localStorage.setItem(THEME_KEY, next)
    return next
  }

  // ── Theme toggle (igual UX que el tenant, persistido en localStorage) ──
  function configurarTheme() {
    const btn = document.getElementById('platform-theme-toggle')
    if (!btn) return

    applyTheme(getTheme())
    pintarThemeToggle(btn, getTheme())

    btn.addEventListener('click', () => {
      const next = applyTheme(getTheme() === 'dark' ? 'light' : 'dark')
      pintarThemeToggle(btn, next)
    })
  }

  function configurarShell() {
    configurarColapso()
    configurarTheme()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      configurarShell()
      injectSidebar()
    })
  } else {
    configurarShell()
    injectSidebar()
  }

  window.jeshaPlatformSidebar = Object.freeze({
    injectSidebar,
    marcarActivo,
    configurarShell,
    getTheme,
    applyTheme
  })
})()