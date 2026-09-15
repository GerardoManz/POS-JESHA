'use strict'

;(function () {
  const TOKEN_KEY = 'jesha_platform_token'
  const ACTOR_KEY = 'jesha_platform_actor'
  const LOGIN_PAGE = 'platform-login.html'
  const HOME_PAGE = 'platform-empresas.html'

  function apiBase() {
    if (window.__JESHA_API_URL__) return window.__JESHA_API_URL__
    if (typeof CONFIG !== 'undefined' && CONFIG.API_URL) return CONFIG.API_URL
    return window.location.origin
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || ''
  }

  function getActor() {
    try {
      return JSON.parse(localStorage.getItem(ACTOR_KEY) || 'null')
    } catch {
      return null
    }
  }

  function setSession(token, actor) {
    if (!token || !actor || actor.rol !== 'PLATFORM_ADMIN' || actor.kind !== 'PLATFORM') {
      throw new Error('Sesión de plataforma inválida')
    }
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(ACTOR_KEY, JSON.stringify(actor))
  }

  function clear() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ACTOR_KEY)
  }

  function redirectToLogin() {
    if (!window.location.pathname.endsWith('/' + LOGIN_PAGE) && !window.location.pathname.endsWith(LOGIN_PAGE)) {
      window.location.replace(LOGIN_PAGE)
    }
  }

  async function parseResponse(res) {
    const data = await res.json().catch(() => ({}))
    if (res.ok) return data

    const err = new Error(data.error || 'No fue posible completar la solicitud')
    err.status = res.status
    err.code = data.code || null
    err.data = data
    throw err
  }

  async function request(path, options = {}) {
    const token = getToken()
    if (!token) {
      clear()
      redirectToLogin()
      const err = new Error('Sesión de plataforma requerida')
      err.status = 401
      throw err
    }

    const headers = new Headers(options.headers || {})
    headers.set('Authorization', `Bearer ${token}`)
    if (options.body !== undefined && options.body !== null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const res = await fetch(`${apiBase()}${path}`, { ...options, headers })
    if (res.status === 401 || res.status === 403) {
      clear()
      redirectToLogin()
    }
    return parseResponse(res)
  }

  async function login(username, password) {
    const res = await fetch(`${apiBase()}/platform/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const data = await parseResponse(res)

    const meRes = await fetch(`${apiBase()}/platform/auth/me`, {
      headers: { Authorization: `Bearer ${data.token}` }
    })
    const actor = await parseResponse(meRes)

    setSession(data.token, actor)
    return actor
  }

  async function validate() {
    if (!getToken()) return null
    try {
      const actor = await request('/platform/auth/me')
      if (actor.rol !== 'PLATFORM_ADMIN' || actor.kind !== 'PLATFORM') {
        clear()
        return null
      }
      localStorage.setItem(ACTOR_KEY, JSON.stringify(actor))
      return actor
    } catch {
      clear()
      return null
    }
  }

  async function requireSession() {
    const actor = await validate()
    if (!actor) {
      redirectToLogin()
      throw new Error('Sesión de plataforma inválida')
    }
    return actor
  }

  function logout() {
    clear()
    window.location.replace(LOGIN_PAGE)
  }

  window.jeshaPlatformSession = Object.freeze({
    TOKEN_KEY,
    ACTOR_KEY,
    HOME_PAGE,
    getToken,
    getActor,
    setSession,
    clear,
    login,
    validate,
    requireSession,
    request,
    logout
  })
})()
