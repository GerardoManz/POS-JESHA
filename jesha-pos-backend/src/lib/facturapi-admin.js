'use strict'

const API_BASE = 'https://www.facturapi.io/v2'
const { crearFacturapiAdminFake } = require('./facturapi-admin-fake')

class FacturapiAdminError extends Error {
  constructor(status, code, message, details = null) {
    super(message)
    this.name = 'FacturapiAdminError'
    this.status = status
    this.code = code
    this.details = details
    this.expose = true
  }
}

function getFacturapiUserKey(value = process.env.FACTURAPI_USER_KEY) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FacturapiAdminError(503, 'FACTURAPI_USER_KEY_MISSING', 'Administración Facturapi no configurada')
  }
  return value.trim()
}

function crearFacturapiAdminAdapter(options = {}) {
  const fetchImpl = options.fetch || global.fetch
  const resolveUserKey = options.getUserKey || getFacturapiUserKey
  const baseUrl = options.baseUrl || API_BASE

  async function request(path, init = {}) {
    const headers = new Headers(init.headers || {})
    headers.set('Authorization', `Bearer ${resolveUserKey()}`)
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const remoteCode = body?.code || body?.errors?.[0]?.code || 'FACTURAPI_ADMIN_REQUEST_FAILED'
      const remoteMessage = typeof body?.message === 'string'
        ? body.message
        : `Facturapi rechazó la operación administrativa (${response.status})`
      throw new FacturapiAdminError(502, remoteCode, remoteMessage, {
        remoteStatus: response.status,
        errors: Array.isArray(body?.errors)
          ? body.errors.map(({ code, path: errorPath, location }) => ({ code, path: errorPath, location }))
          : []
      })
    }
    return body
  }

  const crearOrganization = (data) => request('/organizations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  })
  const obtenerOrganization = (id) => request(`/organizations/${encodeURIComponent(id)}`)
  const actualizarDatosLegales = (id, data) => request(`/organizations/${encodeURIComponent(id)}/legal`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  })
  const obtenerTestKey = (id) => request(`/organizations/${encodeURIComponent(id)}/apikeys/test`)
  const crearLiveKey = (id) => request(`/organizations/${encodeURIComponent(id)}/apikeys/live`, { method: 'PUT' })
  const subirCsd = (id, { cer, key, password }) => {
    const form = new FormData()
    form.append('cer', new Blob([cer]), 'certificate.cer')
    form.append('key', new Blob([key]), 'private.key')
    form.append('password', password)
    return request(`/organizations/${encodeURIComponent(id)}/certificate`, { method: 'PUT', body: form })
  }

  return { crearOrganization, obtenerOrganization, actualizarDatosLegales, subirCsd, obtenerTestKey, crearLiveKey }
}

function seleccionarFacturapiAdmin(mode = process.env.FACTURAPI_ADMIN_MODE || 'real') {
  const selected = String(mode).trim().toLowerCase()
  if (selected === 'fake') {
    if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
      throw new Error('FACTURAPI_ADMIN_MODE=fake está prohibido en producción')
    }
    return crearFacturapiAdminFake()
  }
  if (selected !== 'real') throw new Error(`FACTURAPI_ADMIN_MODE inválido: ${mode}`)
  return crearFacturapiAdminAdapter()
}

module.exports = {
  FacturapiAdminError,
  getFacturapiUserKey,
  crearFacturapiAdminAdapter,
  seleccionarFacturapiAdmin,
  facturapiAdmin: seleccionarFacturapiAdmin()
}
