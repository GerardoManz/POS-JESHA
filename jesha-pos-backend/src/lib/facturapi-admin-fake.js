'use strict'

const organizations = new Map()

function fakeError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status, expose: true })
}

function organizationPayload(state) {
  return {
    id: state.id,
    legal: { tax_id: state.legal?.tax_id || null },
    is_production_ready: state.ready,
    pending_steps: state.ready ? [] : ['certificate'],
    certificate: state.csd
      ? { has_certificate: true, serial_number: state.serial, expires_at: '2030-01-01T00:00:00.000Z' }
      : { has_certificate: false }
  }
}

function organizationId(context) {
  const empresaId = Number(context?.empresaId)
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    throw Object.assign(new Error('El adapter fake requiere contexto empresaId'), { status: 500, expose: true })
  }
  return `org_fake_empresa_${empresaId}`
}

function crearFacturapiAdminFake() {
  async function crearOrganization(data, context) {
    const id = organizationId(context)
    if (!organizations.has(id)) {
      organizations.set(id, { id, name: data.name, legal: {}, ready: false, csd: false, serial: null })
    }
    return organizationPayload(organizations.get(id))
  }

  async function obtenerOrganization(id) {
    const state = organizations.get(id)
    if (!state) throw fakeError('FACTURAPI_FAKE_ORGANIZATION_NOT_FOUND', 'Organization fake no encontrada', 404)
    return organizationPayload(state)
  }

  async function actualizarDatosLegales(id, data) {
    const state = organizations.get(id)
    if (!state) throw fakeError('FACTURAPI_FAKE_ORGANIZATION_NOT_FOUND', 'Organization fake no encontrada', 404)
    state.legal = { tax_id: data.tax_id || null }
    return organizationPayload(state)
  }

  async function subirCsd(id, { cer, key, password }) {
    if (!Buffer.isBuffer(cer) || !Buffer.isBuffer(key) || !password) {
      throw fakeError('certificate_files_invalid', 'CSD fake inválido')
    }
    const state = organizations.get(id)
    if (!state) throw fakeError('FACTURAPI_FAKE_ORGANIZATION_NOT_FOUND', 'Organization fake no encontrada', 404)

    const scenario = String(process.env.FACTURAPI_FAKE_CSD_SCENARIO || 'valid').trim().toLowerCase()
    const failures = {
      password: ['private_key_password_incorrect', 'La contraseña de la llave privada es incorrecta.'],
      mismatch: ['private_key_certificate_mismatch', 'La llave privada no coincide con el certificado.'],
      fiel: ['csd_required', 'El certificado no es un CSD.'],
      invalid: ['certificate_invalid', 'El certificado no es válido.'],
      not_yet_valid: ['certificate_not_yet_valid', 'El certificado aún no puede ser utilizado.']
    }
    if (failures[scenario]) throw fakeError(...failures[scenario])
    if (!['valid', 'rfc_mismatch'].includes(scenario)) {
      throw fakeError('FACTURAPI_FAKE_SCENARIO_INVALID', `Escenario CSD fake inválido: ${scenario}`, 500)
    }
    if (scenario === 'rfc_mismatch') state.legal = { tax_id: 'BAD010101XX9' }

    state.csd = true
    state.ready = true
    state.serial = `FAKE-${id}`
    return organizationPayload(state)
  }

  async function obtenerTestKey(id) {
    if (!organizations.has(id)) throw fakeError('FACTURAPI_FAKE_ORGANIZATION_NOT_FOUND', 'Organization fake no encontrada', 404)
    return `sk_test_fake_${id}`
  }

  async function crearLiveKey(id) {
    if (!organizations.has(id)) throw fakeError('FACTURAPI_FAKE_ORGANIZATION_NOT_FOUND', 'Organization fake no encontrada', 404)
    return `sk_live_fake_${id}`
  }

  return { crearOrganization, obtenerOrganization, actualizarDatosLegales, subirCsd, obtenerTestKey, crearLiveKey }
}

module.exports = { crearFacturapiAdminFake }
