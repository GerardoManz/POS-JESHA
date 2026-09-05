'use strict';

// Sesión tenant centralizada. El JWT no se decodifica para tomar decisiones:
// el frontend usa únicamente el usuario sanitizado entregado por /auth/login.
(() => {
  const KEYS = Object.freeze({
    token: 'jesha_token',
    usuario: 'jesha_usuario',
    empresaSlug: 'jesha_empresa_slug',
    sucursalId: 'jesha_selected_sucursal_id',
    delegatedToken: 'jesha_delegated_token',
    delegatedEmpresa: 'jesha_delegated_empresa',
    delegatedUser: 'jesha_delegated_user'
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
    const empresa = user.Empresa && typeof user.Empresa === 'object'
      ? {
          id: positiveInt(user.Empresa.id),
          slug: String(user.Empresa.slug || ''),
          nombreComercial: String(user.Empresa.nombreComercial || '')
        }
      : null

    return {
      id: positiveInt(user.id),
      nombre: String(user.nombre || ''),
      username: String(user.username || ''),
      rol: user.rol,
      actorRol: user.actorRol || null,
      effectiveRole: user.effectiveRole || user.rol,
      delegated: user.delegated === true,
      empresaId: positiveInt(user.empresaId),
      sucursalId,
      tema: user.tema === 'light' ? 'light' : 'dark',
      Empresa: empresa && empresa.id ? empresa : null,
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

  function isDelegated() {
    return Boolean(localStorage.getItem(KEYS.delegatedToken))
  }

  function getDelegatedToken() {
    return localStorage.getItem(KEYS.delegatedToken) || ''
  }

  function getDelegatedEmpresa() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.delegatedEmpresa) || 'null')
    } catch {
      return null
    }
  }

  function clearDelegated() {
    localStorage.removeItem(KEYS.delegatedToken)
    localStorage.removeItem(KEYS.delegatedEmpresa)
    localStorage.removeItem(KEYS.delegatedUser)
    localStorage.removeItem(KEYS.sucursalId)
  }

  function setDelegatedUser(usuario) {
    if (usuario && typeof usuario === 'object') {
      localStorage.setItem(KEYS.delegatedUser, JSON.stringify(sanitizeUser(usuario) || usuario))
    }
  }

  function getEffectiveToken() {
    if (isDelegated()) return getDelegatedToken()
    return localStorage.getItem(KEYS.token) || ''
  }

  function getEffectiveRol() {
    if (isDelegated()) return 'SUPERADMIN'
    const user = readUser()
    return user?.rol || 'EMPLEADO'
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
    if (isDelegated()) {
      return Boolean(
        localStorage.getItem(KEYS.delegatedToken) &&
        localStorage.getItem(KEYS.delegatedEmpresa)
      )
    }
    return Boolean(
      localStorage.getItem(KEYS.token) &&
      localStorage.getItem(KEYS.empresaSlug) &&
      validateUser(readUser())
    )
  }

  function getSelectedSucursalId() {
    if (isDelegated()) {
      return positiveInt(localStorage.getItem(KEYS.sucursalId))
    }
    const user = readUser()
    if (!validateUser(user)) return null

    const fixed = positiveInt(user.sucursalId)
    if (fixed !== null) return fixed

    return positiveInt(localStorage.getItem(KEYS.sucursalId))
  }

  function canSelectSucursal() {
    if (isDelegated()) return true
    const user = readUser()
    if (!validateUser(user) || positiveInt(user.sucursalId) !== null) return false
    return user.rol === 'SUPERADMIN' || user.rol === 'PRECIOS'
  }

  function setSelectedSucursalId(value) {
    if (isDelegated()) {
      const requested = value === null || value === undefined || value === '' ? null : positiveInt(value)
      if (requested === null) {
        localStorage.removeItem(KEYS.sucursalId)
        return null
      }
      localStorage.setItem(KEYS.sucursalId, String(requested))
      return requested
    }

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
    const effectiveRol = isDelegated() ? 'SUPERADMIN' : user.rol
    if (context.actor?.rol !== effectiveRol) {
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
    const token = getEffectiveToken()
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
      if (isDelegated()) {
        clearDelegated()
        window.location.replace('platform-empresas.html')
      } else {
        clear()
        if (!window.location.pathname.endsWith('/login.html')) window.location.replace('login.html')
      }
    }
    if (response.status === 403) {
      const payload = await response.clone().json().catch(() => null)
      const message = payload?.error || 'No tienes permisos para realizar esta acción'
      if (window.jeshaToast) window.jeshaToast(message, 'error')
      window.dispatchEvent(new CustomEvent('jesha:forbidden', { detail: { pathname, message } }))
    }
    return response
  }

  // ── Empresa branding cache (for PDF generators) ──
  let _empresaBrandingCache = null
  let _empresaBrandingPromise = null

  async function fetchEmpresaBranding() {
    if (_empresaBrandingCache) return _empresaBrandingCache
    if (_empresaBrandingPromise) return _empresaBrandingPromise

    _empresaBrandingPromise = (async () => {
      try {
        const token = getEffectiveToken()
        if (!token) return null
        const base = window.__JESHA_API_URL__ || window.location.origin
        const res = await nativeFetch(`${base}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) return null
        const data = await res.json()
        const emp = data?.usuario?.Empresa || data?.empresa
        if (!emp) return null
        _empresaBrandingCache = {
          nombre: emp.nombreComercial || 'Empresa',
          slug: emp.slug || '',
          logoUrl: emp.logoUrl || null,
          colorPrimario: emp.colorPrimario || '#1e3a5f',
          colorSecundario: emp.colorSecundario || '#3b82f6',
          colorAcento: emp.colorAcento || '#10b981',
          rfc: emp.rfc || null,
          whatsapp: emp.whatsapp || null,
          razonSocial: emp.razonSocial || null,
          direccion: emp.direccion || null,
          ciudad: emp.ciudad || null,
          telefono: emp.whatsapp || null,
          email: emp.email || null
        }
        return _empresaBrandingCache
      } catch (_) {
        return null
      } finally {
        _empresaBrandingPromise = null
      }
    })()
    return _empresaBrandingPromise
  }

  function invalidateEmpresaBranding() {
    _empresaBrandingCache = null
  }

  window.jeshaSession = Object.freeze({
    KEYS,
    clear,
    start,
    isValid,
    isDelegated,
    getDelegatedToken,
    getDelegatedEmpresa,
    clearDelegated,
    setDelegatedUser,
    getEffectiveToken,
    getEffectiveRol,
    getToken: () => isDelegated() ? getDelegatedToken() : localStorage.getItem(KEYS.token),
    getUsuario: () => {
      if (isDelegated()) {
        const emp = getDelegatedEmpresa()
        try {
          const stored = JSON.parse(localStorage.getItem(KEYS.delegatedUser) || 'null')
          if (stored && stored.id) return stored
        } catch (_) {}
        return {
          id: 1,
          nombre: 'Plataforma',
          username: 'platform',
          rol: 'SUPERADMIN',
          actorRol: 'PLATFORM_ADMIN',
          effectiveRole: 'SUPERADMIN',
          delegated: true,
          empresaId: emp?.id || null,
          sucursalId: positiveInt(localStorage.getItem(KEYS.sucursalId)),
          tema: 'dark',
          Empresa: emp ? { id: emp.id, slug: emp.slug, nombreComercial: emp.nombreComercial } : null,
          Sucursal: null
        }
      }
      return readUser()
    },
    getEmpresaSlug: () => isDelegated() ? (getDelegatedEmpresa()?.slug || null) : localStorage.getItem(KEYS.empresaSlug),
    getEmpresaNombre: () => {
      if (isDelegated()) return getDelegatedEmpresa()?.nombreComercial || null
      return readUser()?.Empresa?.nombreComercial || null
    },
    getSelectedSucursalId,
    canSelectSucursal,
    setSelectedSucursalId,
    validarContexto,
    positiveInt,
    fetchEmpresaBranding,
    invalidateEmpresaBranding
  })
})()
