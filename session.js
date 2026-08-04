'use strict';

// Sesión tenant centralizada. El JWT no se decodifica para tomar decisiones:
// el frontend usa únicamente el usuario sanitizado entregado por /auth/login.
(() => {
  const KEYS = Object.freeze({
    token: 'jesha_token',
    usuario: 'jesha_usuario',
    empresaSlug: 'jesha_empresa_slug',
    sucursalId: 'jesha_selected_sucursal_id'
  })

  const TENANT_ROLES = new Set(['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO', 'PRECIOS'])

  const POSTGRES_INT_MAX = 2147483647

  function positiveInt(value) {
    const number = typeof value === 'number' ? value : Number(String(value || '').trim())
    return Number.isSafeInteger(number) && number > 0 && number <= POSTGRES_INT_MAX ? number : null
  }

  function sanitizeUser(user) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) return null
    const sucursalId = user.sucursalId === null || user.sucursalId === undefined
      ? null
      : positiveInt(user.sucursalId)
    const sucursal = user.Sucursal && typeof user.Sucursal === 'object'
      ? { id: positiveInt(user.Sucursal.id), nombre: String(user.Sucursal.nombre || '') }
      : null

    return {
      id: positiveInt(user.id),
      nombre: String(user.nombre || ''),
      username: String(user.username || ''),
      rol: user.rol,
      empresaId: positiveInt(user.empresaId),
      sucursalId,
      tema: user.tema === 'light' ? 'light' : 'dark',
      Sucursal: sucursal && sucursal.id ? sucursal : null
    }
  }

  function readUser() {
    try {
      const raw = localStorage.getItem(KEYS.usuario)
      if (!raw) return null
      const user = JSON.parse(raw)
      return user && typeof user === 'object' && !Array.isArray(user) ? user : null
    } catch (_) {
      return null
    }
  }

  function clear() {
    Object.values(KEYS).forEach((key) => localStorage.removeItem(key))
  }

  function validateUser(user) {
    if (!user || !TENANT_ROLES.has(user.rol)) return false
    if (!positiveInt(user.id) || !positiveInt(user.empresaId)) return false
    if (user.rol === 'ADMIN_SUCURSAL' || user.rol === 'EMPLEADO') {
      return positiveInt(user.sucursalId) !== null
    }
    if (user.sucursalId !== null && user.sucursalId !== undefined) {
      return positiveInt(user.sucursalId) !== null
    }
    return true
  }

  function start({ token, usuario, empresaSlug }) {
    const slug = typeof empresaSlug === 'string' ? empresaSlug.trim() : ''
    if (typeof token !== 'string' || !token || !validateUser(usuario) || !slug) {
      clear()
      throw new Error('Sesión tenant inválida')
    }

    const safeUser = sanitizeUser(usuario)
    localStorage.setItem(KEYS.token, token)
    localStorage.setItem(KEYS.usuario, JSON.stringify(safeUser))
    localStorage.setItem(KEYS.empresaSlug, slug)

    const fixedSucursalId = positiveInt(safeUser.sucursalId)
    if (fixedSucursalId !== null) {
      localStorage.setItem(KEYS.sucursalId, String(fixedSucursalId))
    } else {
      localStorage.removeItem(KEYS.sucursalId)
    }
  }

  function isValid() {
    return Boolean(
      localStorage.getItem(KEYS.token) &&
      localStorage.getItem(KEYS.empresaSlug) &&
      validateUser(readUser())
    )
  }

  function getSelectedSucursalId() {
    const user = readUser()
    if (!validateUser(user)) return null

    const fixed = positiveInt(user.sucursalId)
    if (fixed !== null) return fixed

    return positiveInt(localStorage.getItem(KEYS.sucursalId))
  }

  function canSelectSucursal() {
    const user = readUser()
    if (!validateUser(user) || positiveInt(user.sucursalId) !== null) return false
    return user.rol === 'SUPERADMIN' || user.rol === 'PRECIOS'
  }

  function setSelectedSucursalId(value) {
    const user = readUser()
    if (!validateUser(user)) throw new Error('Sesión tenant inválida')

    const fixed = positiveInt(user.sucursalId)
    const requested = value === null || value === undefined || value === '' ? null : positiveInt(value)

    if (fixed !== null) {
      if (requested !== null && requested !== fixed) {
        throw new Error('La sucursal del usuario es fija')
      }
      localStorage.setItem(KEYS.sucursalId, String(fixed))
      return fixed
    }

    if (!canSelectSucursal()) throw new Error('El rol no puede seleccionar sucursal')
    if (requested === null) {
      localStorage.removeItem(KEYS.sucursalId)
      return null
    }

    localStorage.setItem(KEYS.sucursalId, String(requested))
    return requested
  }

  // Validación compartida del contexto devuelto por GET /auth/context.
  // Única fuente de verdad: la usa login.js al iniciar sesión y la topbar
  // global al cambiar de sucursal. Lanza Error con mensaje si algo no coincide.
  function validarContexto(context, usuario, selectedSucursalId) {
    if (!usuario || typeof usuario !== 'object') {
      throw new Error('Sesión tenant inválida')
    }
    const user = sanitizeUser(usuario) || usuario
    if (!context || typeof context !== 'object') {
      throw new Error('Contexto empresarial inválido')
    }
    if (context.version !== 1 || context.kind !== 'TENANT') {
      throw new Error('Contexto empresarial inválido')
    }
    if (context.actor?.id !== user.id) {
      throw new Error('Identidad de usuario no coincide')
    }
    if (context.actor?.rol !== user.rol) {
      throw new Error('Rol de usuario no coincide')
    }
    if (context.tenant?.empresaId !== user.empresaId) {
      throw new Error('Empresa no coincide con la sesión')
    }

    const fixed = positiveInt(user.sucursalId)
    const requested = selectedSucursalId === null || selectedSucursalId === undefined
      ? null
      : positiveInt(selectedSucursalId)

    if (fixed !== null) {
      if (context.branch?.mode !== 'FIXED') {
        throw new Error('El contexto no resolvió sucursal fija')
      }
      if (context.branch.sucursalId !== fixed) {
        throw new Error('La sucursal fija no coincide con el backend')
      }
    }

    if (requested !== null) {
      if (context.branch?.mode === 'NONE') {
        throw new Error('No se pudo seleccionar la sucursal')
      }
      if (context.branch?.sucursalId !== requested) {
        throw new Error('La sucursal seleccionada no coincide con el contexto')
      }
    }

    if (fixed === null && requested === null) {
      if (context.branch?.mode !== 'NONE' || context.branch?.sucursalId !== null) {
        throw new Error('No se pudo verificar el contexto empresarial')
      }
    }

    return context
  }



  const nativeFetch = window.fetch.bind(window)
  const API_PREFIXES = [
    '/auth', '/facturas', '/usuarios', '/clientes', '/productos',
    '/inventario', '/ventas', '/turnos-caja', '/cotizaciones', '/pedidos',
    '/proveedores', '/bitacoras', '/compras', '/devoluciones', '/reportes',
    '/sucursales', '/trabajadores', '/impresion', '/precios', '/abonos'
  ]

  function isApiRequest(input) {
    try {
      const base = window.__JESHA_API_URL__ || window.location.origin
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
      const apiOrigin = new URL(base, window.location.href).origin
      return url.origin === apiOrigin && API_PREFIXES.some((prefix) =>
        url.pathname === prefix || url.pathname.startsWith(prefix + '/')
      )
    } catch (_) {
      return false
    }
  }

  window.fetch = async function jeshaTenantFetch(input, init = {}) {
    if (!isApiRequest(input)) return nativeFetch(input, init)

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    const token = localStorage.getItem(KEYS.token)
    const sucursalId = getSelectedSucursalId()

    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    if (sucursalId !== null && !headers.has('X-Sucursal-Id')) {
      headers.set('X-Sucursal-Id', String(sucursalId))
    }

    const response = await nativeFetch(input, { ...init, headers })
    let pathname = ''
    try {
      pathname = new URL(typeof input === 'string' ? input : input.url, window.location.href).pathname
    } catch (_) {}

    if (response.status === 401 && pathname !== '/auth/login' && pathname !== '/platform/auth/login') {
      clear()
      if (!window.location.pathname.endsWith('/login.html')) window.location.replace('login.html')
    }
    if (response.status === 403) {
      const payload = await response.clone().json().catch(() => null)
      const message = payload?.error || 'No tienes permisos para realizar esta acción'
      if (window.jeshaToast) window.jeshaToast(message, 'error')
      window.dispatchEvent(new CustomEvent('jesha:forbidden', { detail: { pathname, message } }))
    }
    return response
  }

  window.jeshaSession = Object.freeze({
    KEYS,
    clear,
    start,
    isValid,
    getToken: () => localStorage.getItem(KEYS.token),
    getUsuario: readUser,
    getEmpresaSlug: () => localStorage.getItem(KEYS.empresaSlug),
    getSelectedSucursalId,
    canSelectSucursal,
    setSelectedSucursalId,
    validarContexto,
    positiveInt
  })
})()
