'use strict'

;(function(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.normalizeFiscalState = api.normalizeFiscalState
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const STEP_ALIASES = {
    certificate: 'CSD',
    CSD: 'CSD',
    csd: 'CSD',
    DATOS_FISCALES: 'DATOS_FISCALES',
    ORGANIZATION: 'ORGANIZATION',
    LIVE_KEY: 'LIVE_KEY',
    TEST_KEY: 'TEST_KEY'
  }

  function normalizeSteps(value) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map((step) => STEP_ALIASES[step] || String(step)).filter(Boolean))]
  }

  function normalizeFiscalState(apiResponse) {
    const data = apiResponse?.configuracion ?? apiResponse ?? {}
    const fiscalDataComplete = Boolean(
      String(data.rfc ?? '').trim()
      && String(data.regimenFiscal ?? '').trim()
      && String(data.codigoPostalFiscal ?? '').trim()
    )
    const organizationConfigured = Boolean(String(data.facturapiOrganizationId ?? '').trim())
    const csdEvidence = data.hasCsd === true || Boolean(data.csdSerial || data.csdExpiraEn)
    const csdExpired = data.csdExpiraEn && new Date(data.csdExpiraEn).getTime() <= Date.now()
    const csdConfigured = csdEvidence && !csdExpired
    const hasPendingSteps = Array.isArray(data.pendingSteps)
    const providerSteps = normalizeSteps(data.pendingSteps)
    const pendingSteps = [...providerSteps]

    if (!fiscalDataComplete && !pendingSteps.includes('DATOS_FISCALES')) pendingSteps.unshift('DATOS_FISCALES')
    if (fiscalDataComplete && !organizationConfigured && !pendingSteps.includes('ORGANIZATION')) pendingSteps.push('ORGANIZATION')
    if (organizationConfigured && !csdConfigured && !pendingSteps.includes('CSD')) pendingSteps.push('CSD')

    const ready = fiscalDataComplete
      && organizationConfigured
      && csdConfigured
      && data.isProductionReady === true
      && hasPendingSteps
      && pendingSteps.length === 0

    let uiState = 'NO_CONFIGURADA'
    if (ready) uiState = 'LISTA'
    else if (organizationConfigured) uiState = 'CONFIGURANDO'
    else if (fiscalDataComplete) uiState = 'DATOS_GUARDADOS'

    return {
      data,
      fiscalDataComplete,
      organizationConfigured,
      csdConfigured,
      ready,
      pendingSteps,
      uiState
    }
  }

  return { normalizeFiscalState }
})
