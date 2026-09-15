'use strict'

;(function() {
  const $ = (selector) => document.querySelector(selector)
  const usuario = window.jeshaSession?.getUsuario()
  if (!window.jeshaSession?.isValid() || !usuario) {
    window.location.replace('login.html')
    return
  }
  if (usuario.rol !== 'SUPERADMIN') {
    window.location.replace('dashboard.html')
    return
  }

  const formEmpresa = $('#form-empresa')
  const formFiscal = $('#form-fiscal')
  const formCsd = $('#form-csd')
  const btnGuardarEmpresa = $('#btn-guardar-empresa')
  const btnGuardarFiscal = $('#btn-guardar-fiscal')
  const btnCargarCsd = $('#btn-cargar-csd')
  const btnSyncStatus = $('#btn-sync-status')
  const btnEnableLive = $('#btn-enable-live')
  let empresaData = null
  let fiscalData = null
  let guardandoEmpresa = false
  let guardandoFiscal = false
  let cargandoCsd = false

  function notificar(message, type = 'error') {
    window.jeshaToast?.(message, type)
  }

  function setBusy(button, busy, text) {
    if (busy) {
      button.dataset.originalText = button.textContent
      button.textContent = text
      button.disabled = true
      button.setAttribute('aria-busy', 'true')
    } else {
      button.textContent = button.dataset.originalText || button.textContent
      delete button.dataset.originalText
      button.disabled = false
      button.removeAttribute('aria-busy')
    }
  }

  function poblarRegimenes() {
    window.poblarSelectSAT($('#fisc-regimen'), window.CATALOGO_REGIMENES)
  }

  async function cargarEmpresa() {
    try {
      const response = await window.apiFetch('/auth/me')
      empresaData = response?.empresa || response
      if (!empresaData) throw new Error('Empresa no disponible')
      $('#emp-nombre').value = empresaData.nombreComercial || ''
      $('#emp-slug').value = empresaData.slug || ''
      $('#emp-razonSocial').value = empresaData.razonSocial || ''
      $('#emp-rfc').value = empresaData.rfc || ''
      $('#emp-whatsapp').value = empresaData.whatsapp || ''
      $('#badge-empresa').textContent = empresaData.activa !== false ? 'Activa' : 'Inactiva'
      $('#badge-empresa').classList.toggle('config-badge--ok', empresaData.activa !== false)
    } catch (error) {
      $('#badge-empresa').textContent = 'Error'
      notificar(error.message)
    }
  }

  async function cargarFiscal() {
    try {
      const response = await window.apiFetch('/configuracion-fiscal/')
      fiscalData = response?.configuracion ?? response
    } catch (error) {
      fiscalData = null
      notificar(error.message)
    }
    renderFiscalStatus()
  }

  function resetFiscalView() {
    for (const id of [
      '#fiscal-empty', '#fiscal-form-wrap', '#fiscal-configuring', '#fiscal-csd-wrap',
      '#fiscal-csd-info', '#fiscal-pending', '#fiscal-actions', '#fiscal-ready', '#fiscal-summary',
      '#fiscal-steps'
    ]) $(id).hidden = true
  }

  function setSummaryItem(dotSelector, statusSelector, complete, completeText) {
    $(dotSelector).classList.toggle('active', complete)
    $(statusSelector).classList.toggle('active', complete)
    $(statusSelector).textContent = complete ? completeText : 'Pendiente'
  }

  function renderSummary(state) {
    $('#fiscal-summary').hidden = false
    setSummaryItem('#dot-datos', '#status-datos', state.fiscalDataComplete, 'Configurados')
    setSummaryItem('#dot-facturapi', '#status-facturapi', state.organizationConfigured, 'Configurado')
    setSummaryItem('#dot-csd', '#status-csd', state.csdConfigured, 'Configurado')
  }

  let previousFiscalUiState = null
  function renderFiscalSteps(state) {
    var stepsEl = $('#fiscal-steps')
    if (!stepsEl) return
    stepsEl.hidden = false

    var steps = stepsEl.querySelectorAll('.fiscal-step')
    var datosStep = steps[0]
    var facturapiStep = steps[1]
    var csdStep = steps[2]

    datosStep.classList.remove('is-complete', 'is-active', 'is-error', 'just-complete')
    facturapiStep.classList.remove('is-complete', 'is-active', 'is-error', 'just-complete')
    csdStep.classList.remove('is-complete', 'is-active', 'is-error', 'just-complete')

    if (state.fiscalDataComplete) {
      datosStep.classList.add('is-complete')
    } else {
      datosStep.classList.add('is-active')
    }

    if (state.organizationConfigured) {
      facturapiStep.classList.add('is-complete')
    } else if (state.fiscalDataComplete) {
      facturapiStep.classList.add('is-active')
    }

    if (state.csdConfigured) {
      csdStep.classList.add('is-complete')
    } else if (state.organizationConfigured) {
      csdStep.classList.add('is-active')
    }

    if (state.ready) {
      datosStep.classList.add('is-complete')
      facturapiStep.classList.add('is-complete')
      csdStep.classList.add('is-complete')
    }

    if (previousFiscalUiState && previousFiscalUiState !== state.uiState) {
      var allSteps = [datosStep, facturapiStep, csdStep]
      allSteps.forEach(function(s) {
        if (s.classList.contains('is-complete')) {
          s.classList.add('just-complete')
          setTimeout(function() { s.classList.remove('just-complete') }, 400)
        }
      })
    }
    previousFiscalUiState = state.uiState
  }

  function renderCsdInfo(state) {
    $('#fiscal-csd-info').hidden = !state.csdConfigured
    $('#csd-estado').textContent = state.csdConfigured ? 'Configurado' : 'No cargado'
    $('#csd-serial-row').hidden = !fiscalData?.csdSerial
    $('#csd-serial').textContent = fiscalData?.csdSerial || '-'
    $('#csd-expira-row').hidden = !fiscalData?.csdExpiraEn
    $('#csd-expira').textContent = fiscalData?.csdExpiraEn
      ? new Date(fiscalData.csdExpiraEn).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
      : '-'
  }

  function renderPendingSteps(steps) {
    const labels = {
      CSD: 'Certificado de Sello Digital',
      DATOS_FISCALES: 'Datos fiscales completos',
      ORGANIZATION: 'Conexión con Facturapi',
      LIVE_KEY: 'Habilitación productiva',
      TEST_KEY: 'Llave de pruebas'
    }
    $('#fiscal-pending').hidden = !steps.length
    $('#fiscal-pending-list').replaceChildren(...steps.map((step) => {
      const item = document.createElement('li')
      item.textContent = labels[step] || step
      return item
    }))
  }

  function renderStartOrganization(state) {
    let button = $('#btn-start-org')
    if (state.uiState === 'DATOS_GUARDADOS' && !$('#fiscal-form-wrap').hidden) {
      if (!button) {
        button = document.createElement('button')
        button.id = 'btn-start-org'
        button.type = 'button'
        button.className = 'btn-primary'
        button.textContent = 'Iniciar configuración'
        $('#form-fiscal .form-acciones').appendChild(button)
      }
      button.hidden = false
    } else if (button) {
      button.hidden = true
    }
  }

  function fillFiscalForm(state) {
    const data = state.data
    $('#fisc-razonSocial').value = data.razonSocial || empresaData?.razonSocial || ''
    $('#fisc-rfc').value = data.rfc || empresaData?.rfc || ''
    $('#fisc-regimen').value = data.regimenFiscal || ''
    $('#fisc-cp').value = data.codigoPostalFiscal || ''
  }

  function renderFiscalStatus() {
    resetFiscalView()
    const state = window.normalizeFiscalState(fiscalData)
    fillFiscalForm(state)

    const badge = $('#badge-fiscal')
    const badgeByState = {
      NO_CONFIGURADA: ['No configurada', 'config-badge'],
      DATOS_GUARDADOS: ['Datos guardados', 'config-badge config-badge--pending'],
      CONFIGURANDO: ['Pendiente', 'config-badge config-badge--pending'],
      LISTA: ['Lista', 'config-badge config-badge--ok']
    }
    const [badgeText, badgeClass] = badgeByState[state.uiState]
    badge.textContent = badgeText
    badge.className = badgeClass

    renderFiscalSteps(state)

    $('#fiscal-form-wrap').hidden = false
    if (state.uiState === 'NO_CONFIGURADA' || state.uiState === 'DATOS_GUARDADOS') {
      $('#fiscal-empty').hidden = false
      $('#fiscal-empty-title').textContent = state.uiState === 'DATOS_GUARDADOS' ? 'Datos fiscales guardados' : 'No configurada'
      $('#fiscal-empty-message').textContent = state.uiState === 'DATOS_GUARDADOS'
        ? 'Los datos fiscales están guardados. Inicia la configuración de Facturapi.'
        : 'Configura los datos fiscales para habilitar la emisión de CFDI.'
    } else if (state.uiState === 'CONFIGURANDO') {
      $('#fiscal-configuring').hidden = false
      $('#fiscal-csd-wrap').hidden = state.csdConfigured
      $('#fiscal-actions').hidden = false
      btnEnableLive.hidden = !(fiscalData?.isProductionReady === true && !fiscalData?.tieneLiveKey)
      renderCsdInfo(state)
      renderPendingSteps(state.pendingSteps)
    } else {
      $('#fiscal-ready').hidden = false
      $('#fiscal-actions').hidden = false
      btnEnableLive.hidden = Boolean(fiscalData?.tieneLiveKey)
      renderCsdInfo(state)
    }

    renderSummary(state)
    renderStartOrganization(state)
  }

  function validarDatosFiscales() {
    const rfc = $('#fisc-rfc').value.trim().toUpperCase()
    const razonSocial = $('#fisc-razonSocial').value.trim()
    const regimenFiscal = $('#fisc-regimen').value
    const cp = $('#fisc-cp').value.trim()
    if (!rfc) throw new Error('El RFC fiscal es obligatorio')
    if (!razonSocial) throw new Error('La razón social fiscal es obligatoria')
    if (!regimenFiscal) throw new Error('Selecciona un régimen fiscal')
    if (!cp || cp.length !== 5) throw new Error('El código postal fiscal debe tener 5 dígitos')
    return { rfc, razonSocial, regimenFiscal, codigoPostalFiscal: cp }
  }

  async function onGuardarEmpresa(event) {
    event.preventDefault()
    if (guardandoEmpresa) return
    guardandoEmpresa = true
    setBusy(btnGuardarEmpresa, true, 'Guardando...')
    try {
      const rfc = $('#emp-rfc').value.trim().toUpperCase()
      const razonSocial = $('#emp-razonSocial').value.trim()
      if (!rfc) throw new Error('El RFC es obligatorio')
      if (!razonSocial) throw new Error('La razón social es obligatoria')
      await window.apiFetch('/configuracion-fiscal/', {
        method: 'PATCH', body: JSON.stringify({ rfc, razonSocial })
      })
      empresaData = { ...empresaData, rfc, razonSocial }
      notificar('Datos de empresa guardados', 'success')
      await cargarFiscal()
    } catch (error) {
      notificar(error.message)
    } finally {
      guardandoEmpresa = false
      setBusy(btnGuardarEmpresa, false)
    }
  }

  async function onGuardarFiscal(event) {
    event.preventDefault()
    if (guardandoFiscal) return
    guardandoFiscal = true
    setBusy(btnGuardarFiscal, true, 'Guardando...')
    try {
      await window.apiFetch('/configuracion-fiscal/', {
        method: 'PATCH', body: JSON.stringify(validarDatosFiscales())
      })
      notificar('Datos fiscales guardados', 'success')
      await cargarFiscal()
    } catch (error) {
      notificar(error.message)
    } finally {
      guardandoFiscal = false
      setBusy(btnGuardarFiscal, false)
    }
  }

  async function onIniciarOrganization(button) {
    setBusy(button, true, 'Configurando...')
    try {
      await window.apiFetch('/configuracion-fiscal/organization', { method: 'POST' })
      notificar('Conexión de facturación creada', 'success')
      await cargarFiscal()
    } catch (error) {
      notificar(error.message)
      setBusy(button, false)
    }
  }

  async function onCargarCsd(event) {
    event.preventDefault()
    if (cargandoCsd) return
    cargandoCsd = true
    setBusy(btnCargarCsd, true, 'Cargando...')
    try {
      const cerFile = $('#csd-cer').files[0]
      const keyFile = $('#csd-key').files[0]
      const password = $('#csd-password').value
      if (!cerFile) throw new Error('Selecciona el archivo .cer')
      if (!keyFile) throw new Error('Selecciona el archivo .key')
      if (!password) throw new Error('Ingresa la contraseña de la llave privada')
      const formData = new FormData()
      formData.append('cer', cerFile)
      formData.append('key', keyFile)
      formData.append('password', password)
      await window.apiFetch('/configuracion-fiscal/csd', { method: 'POST', body: formData })
      formCsd.reset()
      $('#csd-cer-label').textContent = 'Seleccionar archivo'
      $('#csd-key-label').textContent = 'Seleccionar archivo'
      notificar('CSD cargado correctamente', 'success')
      await cargarFiscal()
    } catch (error) {
      notificar(error.message)
    } finally {
      $('#csd-password').value = ''
      cargandoCsd = false
      setBusy(btnCargarCsd, false)
    }
  }

  async function onSyncStatus() {
    if (!fiscalData?.facturapiOrganizationId) return notificar('Primero configura la organización fiscal.', 'info')
    setBusy(btnSyncStatus, true, 'Actualizando...')
    try {
      await window.apiFetch('/configuracion-fiscal/sincronizar-status', { method: 'POST' })
      notificar('Estado actualizado', 'success')
      await cargarFiscal()
    } catch (error) {
      notificar(error.code === 'FISCAL_CONFIG_NOT_READY' ? 'Primero configura la organización fiscal.' : error.message, 'info')
    } finally {
      setBusy(btnSyncStatus, false)
    }
  }

  async function onEnableLive() {
    setBusy(btnEnableLive, true, 'Habilitando...')
    try {
      await window.apiFetch('/configuracion-fiscal/apikeys/live', { method: 'POST' })
      notificar('Facturación habilitada', 'success')
      await cargarFiscal()
    } catch (error) {
      notificar(error.message)
    } finally {
      setBusy(btnEnableLive, false)
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     BRANDING — IDENTIDAD VISUAL
     ════════════════════════════════════════════════════════════════════ */

  const COLOR_RE = /^#[0-9A-Fa-f]{6}$/
  const DEFAULT_COLORS = { colorPrimario: '#1e3a5f', colorSecundario: '#3b82f6', colorAcento: '#10b981' }
  let brandingData = null
  let brandingLogoFile = null

  const brandingLogoInput = $('#branding-logo-input')
  const brandingLogoPreview = $('#branding-logo-preview')
  const brandingLogoImg = $('#branding-logo-img')
  const brandingLogoInitials = $('#branding-logo-initials')
  const btnQuitarLogo = $('#btn-quitar-logo')
  const colorPrimario = $('#branding-color-primario')
  const colorPrimarioHex = $('#branding-color-primario-hex')
  const colorSecundario = $('#branding-color-secundario')
  const colorSecundarioHex = $('#branding-color-secundario-hex')
  const colorAcento = $('#branding-color-acento')
  const colorAcentoHex = $('#branding-color-acento-hex')
  const btnGuardarBranding = $('#btn-guardar-branding')
  const btnRestaurarBranding = $('#btn-restaurar-branding')
  const previewShell = $('#branding-preview-shell')
  const previewBrandName = $('#preview-brand-name')
  const previewTopbarName = $('#preview-topbar-name')
  const previewBtnPrimary = $('#preview-btn-primary')
  const previewBadge = $('#preview-badge')

  function getInitials(name) {
    if (!name) return '?'
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase()
    return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  }

  function syncColorInputs(colorInput, hexInput) {
    colorInput.addEventListener('input', () => { hexInput.value = colorInput.value; updatePreview() })
    hexInput.addEventListener('input', () => {
      if (COLOR_RE.test(hexInput.value.trim())) {
        colorInput.value = hexInput.value.trim()
        updatePreview()
      }
    })
    hexInput.addEventListener('blur', () => {
      if (!COLOR_RE.test(hexInput.value.trim())) hexInput.value = colorInput.value
    })
  }

  function updatePreview() {
    const primary = colorPrimario.value
    const secondary = colorSecundario.value
    const accent = colorAcento.value
    const name = empresaData?.nombreComercial || ''

    previewShell.style.setProperty('--brand-primary', primary)
    previewShell.style.setProperty('--brand-secondary', secondary)
    previewShell.style.setProperty('--brand-accent', accent)

    previewBtnPrimary.style.background = primary
    previewBadge.style.background = accent + '22'
    previewBadge.style.color = accent

    const activeItem = previewShell.querySelector('.branding-preview-item.active')
    if (activeItem) activeItem.style.background = primary

    previewBrandName.textContent = brandingLogoFile ? getInitials(name) : getInitials(name)
    previewTopbarName.textContent = name || 'Empresa'
  }

  async function cargarBranding() {
    try {
      const response = await window.apiFetch('/auth/me')
      const empresa = response?.usuario?.Empresa || response?.empresa
      if (!empresa) throw new Error('Empresa no disponible')

      brandingData = {
        logoUrl: empresa.logoUrl || null,
        colorPrimario: empresa.colorPrimario || DEFAULT_COLORS.colorPrimario,
        colorSecundario: empresa.colorSecundario || DEFAULT_COLORS.colorSecundario,
        colorAcento: empresa.colorAcento || DEFAULT_COLORS.colorAcento
      }

      colorPrimario.value = brandingData.colorPrimario
      colorPrimarioHex.value = brandingData.colorPrimario
      colorSecundario.value = brandingData.colorSecundario
      colorSecundarioHex.value = brandingData.colorSecundario
      colorAcento.value = brandingData.colorAcento
      colorAcentoHex.value = brandingData.colorAcento

      if (brandingData.logoUrl) {
        brandingLogoImg.src = brandingData.logoUrl
        brandingLogoImg.hidden = false
        brandingLogoInitials.hidden = true
        btnQuitarLogo.hidden = false
      } else {
        brandingLogoImg.hidden = true
        brandingLogoInitials.hidden = false
        brandingLogoInitials.textContent = getInitials(empresa.nombreComercial)
        btnQuitarLogo.hidden = true
      }

      $('#badge-branding').textContent = 'Configurada'
      $('#badge-branding').classList.add('config-badge--ok')

      updatePreview()
    } catch (error) {
      $('#badge-branding').textContent = 'Error'
      notificar(error.message)
    }
  }

  async function onGuardarBranding() {
    if (btnGuardarBranding.disabled) return
    setBusy(btnGuardarBranding, true, 'Guardando...')

    try {
      if (brandingLogoFile) {
        const formData = new FormData()
        formData.append('logo', brandingLogoFile)
        await window.apiFetch('/branding/logo', { method: 'POST', body: formData, isFormData: true })
      }

      await window.apiFetch('/branding', {
        method: 'PATCH',
        body: JSON.stringify({
          colorPrimario: colorPrimario.value,
          colorSecundario: colorSecundario.value,
          colorAcento: colorAcento.value
        })
      })

      brandingLogoFile = null
      notificar('Identidad visual guardada', 'success')
      await cargarBranding()
    } catch (error) {
      notificar(error.message)
    } finally {
      setBusy(btnGuardarBranding, false)
    }
  }

  async function onRestaurarBranding() {
    if (!confirm('Restaurar la identidad visual a los valores predeterminados?')) return
    setBusy(btnRestaurarBranding, true, 'Restaurando...')

    try {
      await window.apiFetch('/branding/restaurar', { method: 'POST' })
      brandingLogoFile = null
      brandingLogoImg.hidden = true
      brandingLogoInitials.hidden = false
      btnQuitarLogo.hidden = true
      notificar('Identidad visual restaurada', 'success')
      await cargarBranding()
    } catch (error) {
      notificar(error.message)
    } finally {
      setBusy(btnRestaurarBranding, false)
    }
  }

  brandingLogoInput.addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      notificar('El archivo excede 2 MB')
      brandingLogoInput.value = ''
      return
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notificar('Formato no soportado. Use PNG, JPG o WEBP')
      brandingLogoInput.value = ''
      return
    }
    brandingLogoFile = file
    const reader = new FileReader()
    reader.onload = (ev) => {
      brandingLogoImg.src = ev.target.result
      brandingLogoImg.hidden = false
      brandingLogoInitials.hidden = true
      btnQuitarLogo.hidden = false
    }
    reader.readAsDataURL(file)
  })

  btnQuitarLogo.addEventListener('click', () => {
    brandingLogoFile = null
    brandingLogoInput.value = ''
    if (brandingData?.logoUrl) {
      brandingLogoImg.src = brandingData.logoUrl
      brandingLogoImg.hidden = false
      brandingLogoInitials.hidden = true
    } else {
      brandingLogoImg.hidden = true
      brandingLogoInitials.hidden = false
      brandingLogoInitials.textContent = getInitials(empresaData?.nombreComercial)
    }
    btnQuitarLogo.hidden = true
  })

  syncColorInputs(colorPrimario, colorPrimarioHex)
  syncColorInputs(colorSecundario, colorSecundarioHex)
  syncColorInputs(colorAcento, colorAcentoHex)

  document.addEventListener('DOMContentLoaded', () => {
    poblarRegimenes()
    formEmpresa.addEventListener('submit', onGuardarEmpresa)
    formFiscal.addEventListener('submit', onGuardarFiscal)
    formCsd.addEventListener('submit', onCargarCsd)
    btnSyncStatus.addEventListener('click', onSyncStatus)
    btnEnableLive.addEventListener('click', onEnableLive)
    btnGuardarBranding.addEventListener('click', onGuardarBranding)
    btnRestaurarBranding.addEventListener('click', onRestaurarBranding)
    document.addEventListener('click', (event) => {
      if (event.target.id === 'btn-start-org') onIniciarOrganization(event.target)
    })
    $('#csd-cer').addEventListener('change', (event) => {
      $('#csd-cer-label').textContent = event.target.files[0]?.name || 'Seleccionar archivo'
    })
    $('#csd-key').addEventListener('change', (event) => {
      $('#csd-key-label').textContent = event.target.files[0]?.name || 'Seleccionar archivo'
    })
    Promise.all([cargarEmpresa(), cargarFiscal(), cargarBranding()])
  })
})()
