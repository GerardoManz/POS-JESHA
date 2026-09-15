'use strict'

function sugerirSlugEmpresa(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/g, '')
}

function resolverEstadoAdministrador(empresa) {
  if (['PENDIENTE', 'ACTIVO', 'INACTIVO', 'AMBIGUO'].includes(empresa?.superadminEstado)) {
    return empresa.superadminEstado
  }
  if (empresa?.superadminActivo) return 'ACTIVO'
  if (empresa?.superadminInactivo) return 'INACTIVO'
  return 'PENDIENTE'
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sugerirSlugEmpresa, resolverEstadoAdministrador }
} else {
;(async function () {
  const state = {
    empresas: [],
    total: 0,
    pagina: 1,
    porPagina: 25,
    buscar: '',
    estado: 'todas',
    editando: null,
    confirmAction: null,
    superadminTargetId: null,
    recoverTargetId: null,
    loading: false,
    slugTouched: false,
    savingEmpresa: false,
    savingSuperadmin: false,
    savingRecover: false,
    savingState: false,
    focusReturn: {},
    enterTargetId: null,
    enterTargetName: null
  }

  const el = (id) => document.getElementById(id)

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char])
  }

  function formatDate(value) {
    if (!value) return '-'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('es-MX')
  }

  function fiscalStatus(estado) {
    const statuses = {
      NO_CONFIGURADA: { label: 'No configurada', className: 'not-configured' },
      CONFIGURANDO: { label: 'Configurando', className: 'configuring' },
      LISTA: { label: 'Lista', className: 'ready' }
    }
    return statuses[estado] || statuses.NO_CONFIGURADA
  }

  function renderFiscalChip(estado, includeContext = false) {
    const status = fiscalStatus(estado)
    const label = includeContext ? `Facturación: ${status.label}` : status.label
    return `<span class="platform-fiscal-chip platform-fiscal-chip-${status.className}">${label}</span>`
  }

  function showPageMessage(message, type = 'info') {
    const box = el('platform-page-message')
    box.className = `platform-alert platform-alert-${type}`
    box.textContent = message
    box.hidden = false
  }

  function clearPageMessage() {
    const box = el('platform-page-message')
    box.textContent = ''
    box.hidden = true
  }

  function showModalMessage(message) {
    const box = el('empresa-modal-message')
    box.textContent = message
    box.hidden = false
  }

  function clearModalMessage() {
    const box = el('empresa-modal-message')
    box.textContent = ''
    box.hidden = true
  }

  function openOverlay(id) {
    const overlay = el(id)
    const wasOpen = overlay.classList.contains('open')
    if (!wasOpen) state.focusReturn[id] = document.activeElement
    overlay.classList.add('open')
    overlay.setAttribute('aria-hidden', 'false')
    if (!wasOpen) {
      requestAnimationFrame(() => {
        const target = overlay.querySelector('[data-initial-focus]')
          || overlay.querySelector('input:not([disabled]), button:not([disabled])')
        if (target) target.focus()
      })
    }
  }

  function closeOverlay(id, restoreFocus = true) {
    const overlay = el(id)
    overlay.classList.remove('open')
    overlay.setAttribute('aria-hidden', 'true')
    const target = state.focusReturn[id]
    delete state.focusReturn[id]
    if (restoreFocus && target && typeof target.focus === 'function') target.focus()
  }

  function descripcionEstadoAdministrador(estado) {
    return ({
      PENDIENTE: 'Administrador pendiente',
      ACTIVO: 'Administrador configurado',
      INACTIVO: 'Administrador inactivo',
      AMBIGUO: 'Administrador en revisión'
    })[estado] || 'Administrador pendiente'
  }

  function renderTable() {
    const tbody = el('empresas-tbody')
    if (!state.empresas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="platform-empty">No hay empresas que coincidan con los filtros.</td></tr>'
      return
    }

    tbody.innerHTML = state.empresas.map((empresa) => {
      const adminEstado = resolverEstadoAdministrador(empresa)
      const status = empresa.activa
        ? '<span class="platform-badge platform-badge-active">Activa</span>'
        : '<span class="platform-badge platform-badge-inactive">Inactiva</span>'
      const action = empresa.activa
        ? `<button class="platform-btn platform-btn-small platform-btn-danger-soft" data-action="suspender" data-id="${empresa.id}" type="button">Suspender</button>`
        : adminEstado === 'ACTIVO'
          ? `<button class="platform-btn platform-btn-small platform-btn-success" data-action="activar" data-id="${empresa.id}" type="button">Activar</button>`
          : ''
      const detailLabel = empresa.activa && adminEstado === 'ACTIVO' ? 'Ver empresa' : 'Continuar configuración'

      const enterBtn = empresa.activa
        ? `<button class="platform-btn platform-btn-small platform-btn-primary platform-enter-btn" data-action="enter" data-id="${empresa.id}" data-name="${escapeHtml(empresa.nombreComercial)}" type="button">Entrar</button>`
        : ''
      return `<tr>
        <td>
          <div class="platform-company-name">${escapeHtml(empresa.nombreComercial)}</div>
          <div class="platform-secondary">${escapeHtml(empresa.slug)} · creada ${escapeHtml(formatDate(empresa.creadaEn))}</div>
        </td>
        <td>
          <div>${escapeHtml(empresa.razonSocial)}</div>
          <div class="platform-secondary">${escapeHtml(empresa.rfc || 'Sin RFC')}</div>
        </td>
        <td>${escapeHtml(empresa.whatsapp)}</td>
        <td>${Number(empresa.sucursales || 0)}</td>
        <td>${Number(empresa.usuarios || 0)}</td>
        <td><div class="platform-company-status">${status}${renderFiscalChip(empresa.facturacionEstado, true)}<span class="platform-secondary platform-admin-state platform-admin-state-${adminEstado.toLowerCase()}">${escapeHtml(descripcionEstadoAdministrador(adminEstado))}</span></div></td>
        <td class="platform-align-right">
          <div class="platform-row-actions">
            <button class="platform-btn platform-btn-small platform-btn-ghost" data-action="detalle" data-id="${empresa.id}" type="button">${detailLabel}</button>
            ${enterBtn}
            ${action}
          </div>
        </td>
      </tr>`
    }).join('')
  }

  function renderPagination() {
    const nav = el('empresas-pagination')
    const totalPages = Math.max(1, Math.ceil(state.total / state.porPagina))
    if (state.total <= state.porPagina) {
      nav.hidden = true
      return
    }
    nav.hidden = false
    el('empresas-pagination-info').textContent = `Página ${state.pagina} de ${totalPages} · ${state.total} empresas`
    el('btn-prev').disabled = state.pagina <= 1
    el('btn-next').disabled = state.pagina >= totalPages
  }

  async function loadEmpresas() {
    if (state.loading) return
    state.loading = true
    clearPageMessage()
    el('empresas-tbody').innerHTML = '<tr><td colspan="7" class="platform-empty">Cargando empresas...</td></tr>'

    const params = new URLSearchParams({ pagina: String(state.pagina), porPagina: String(state.porPagina) })
    if (state.buscar) params.set('buscar', state.buscar)
    if (state.estado !== 'todas') params.set('estado', state.estado)

    try {
      const data = await window.jeshaPlatformSession.request(`/platform/empresas?${params.toString()}`)
      state.empresas = Array.isArray(data.empresas) ? data.empresas : []
      state.total = Number(data.total || 0)
      state.pagina = Number(data.pagina || 1)
      state.porPagina = Number(data.porPagina || 25)
      renderTable()
      renderPagination()
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        state.empresas = []
        renderTable()
        showPageMessage('No fue posible cargar las empresas.', 'error')
      }
    } finally {
      state.loading = false
    }
  }

  function formValue(id) {
    return el(id).value.trim()
  }

  function buildPayload() {
    const payload = {
      slug: formValue('empresa-slug').toLowerCase(),
      nombreComercial: formValue('empresa-nombreComercial'),
      razonSocial: formValue('empresa-razonSocial'),
      whatsapp: formValue('empresa-whatsapp')
    }
    const rfc = formValue('empresa-rfc').toUpperCase()
    const notas = formValue('empresa-notas')
    if (rfc) payload.rfc = rfc
    else if (state.editando && state.editando.rfc) payload.rfc = null
    if (notas) payload.notas = notas
    else if (state.editando && state.editando.notas) payload.notas = null
    return payload
  }

  function validateForm(payload) {
    if (!payload.nombreComercial || payload.nombreComercial.length < 2) return 'Ingresa un nombre comercial válido.'
    if (!payload.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)) return 'El slug solo puede contener minúsculas, números y guiones.'
    if (!payload.razonSocial || payload.razonSocial.length < 2) return 'Ingresa una razón social válida.'
    if (!payload.whatsapp || payload.whatsapp.length < 7) return 'Ingresa un WhatsApp válido.'
    return null
  }

  function clearForm() {
    for (const id of ['empresa-slug', 'empresa-nombreComercial', 'empresa-razonSocial', 'empresa-rfc', 'empresa-whatsapp', 'empresa-notas']) {
      el(id).value = ''
    }
  }

  function fillForm(empresa) {
    state.slugTouched = true
    el('empresa-slug').value = empresa.slug || ''
    el('empresa-nombreComercial').value = empresa.nombreComercial || ''
    el('empresa-razonSocial').value = empresa.razonSocial || ''
    el('empresa-rfc').value = empresa.rfc || ''
    el('empresa-whatsapp').value = empresa.whatsapp || ''
    el('empresa-notas').value = empresa.notas || ''
    el('empresa-additional').open = Boolean(empresa.rfc || empresa.notas)
  }

  function renderDetailMeta(empresa) {
    const meta = el('empresa-detail-meta')
    if (!empresa) {
      meta.hidden = true
      meta.innerHTML = ''
      return
    }
    meta.hidden = false
    const adminEstado = resolverEstadoAdministrador(empresa)
    meta.innerHTML = `
      <div><span>Estado</span><strong>${empresa.activa ? 'Activa' : 'Inactiva'}</strong></div>
      <div><span>Sucursales</span><strong>${Number(empresa.sucursales || 0)}</strong></div>
      <div><span>Usuarios</span><strong>${Number(empresa.usuarios || 0)}</strong></div>
      <div><span>Administrador</span><strong>${escapeHtml(descripcionEstadoAdministrador(adminEstado).replace('Administrador ', ''))}</strong></div>
      <div><span>Facturación</span><strong>${renderFiscalChip(empresa.facturacionEstado)}</strong></div>
      <div><span>Creada</span><strong>${escapeHtml(formatDate(empresa.creadaEn))}</strong></div>`
  }

  function renderOnboarding(empresa) {
    const onboarding = el('empresa-onboarding')
    const steps = el('empresa-onboarding-steps')
    if (!empresa || !empresa.id) {
      onboarding.hidden = true
      steps.innerHTML = ''
      return
    }

    const sucursales = Number(empresa.sucursales || 0)
    const adminStatus = empresa.superadminActivo
      ? { label: 'Configurado', state: 'ready', copy: 'El administrador de la empresa está activo.' }
      : empresa.superadminInactivo
        ? { label: 'Inactivo', state: 'blocked', copy: 'Recupera el acceso para continuar.' }
        : { label: 'Pendiente', state: 'pending', copy: 'Crea el primer administrador de la empresa.' }
    onboarding.hidden = false
    steps.innerHTML = `
      <li class="platform-onboarding-step">
        <span class="platform-onboarding-index">1</span>
        <div><strong>Activación de empresa</strong><span>${empresa.activa ? 'La empresa está habilitada para operar.' : 'Actívala cuando tenga un SUPERADMIN activo.'}</span></div>
        <span class="platform-step-status platform-step-status-${empresa.activa ? 'ready' : 'pending'}">${empresa.activa ? 'Activa' : 'Pendiente'}</span>
      </li>
      <li class="platform-onboarding-step">
        <span class="platform-onboarding-index">2</span>
        <div><strong>SUPERADMIN</strong><span>${adminStatus.copy}</span></div>
        <span class="platform-step-status platform-step-status-${adminStatus.state}">${adminStatus.label}</span>
      </li>
      <li class="platform-onboarding-step">
        <span class="platform-onboarding-index">3</span>
        <div><strong>Sucursal</strong><span>${sucursales ? `${sucursales} ${sucursales === 1 ? 'sucursal registrada' : 'sucursales registradas'}.` : 'Registra la primera sucursal desde la empresa.'}</span></div>
        <span class="platform-step-status platform-step-status-${sucursales ? 'ready' : 'pending'}">${sucursales ? 'Configurada' : 'Pendiente'}</span>
      </li>
      <li class="platform-onboarding-step">
        <span class="platform-onboarding-index">4</span>
        <div><strong>Configuración fiscal</strong><span>Consulta del estado fiscal del tenant.</span></div>
        ${renderFiscalChip(empresa.facturacionEstado)}
      </li>`
  }

  function renderSuperadminBox(empresa) {
    const box = el('empresa-superadmin-box')
    if (!empresa || !empresa.id) {
      box.hidden = true
      box.innerHTML = ''
      return
    }
    const adminEstado = resolverEstadoAdministrador(empresa)
    const administrador = empresa.superadmin
    const identidad = administrador
      ? `<div class="platform-onboarding-identity"><strong>${escapeHtml(administrador.nombre)}</strong><span>${escapeHtml(administrador.username)}</span></div>`
      : ''
    const adminCopy = ({
      PENDIENTE: 'Pendiente de configurar',
      ACTIVO: 'Administrador configurado',
      INACTIVO: 'La cuenta requiere recuperación',
      AMBIGUO: 'Hay más de un administrador. Se requiere revisión manual.'
    })[adminEstado]
    const adminTone = adminEstado === 'ACTIVO' ? 'complete' : adminEstado === 'PENDIENTE' ? 'pending' : 'warning'
    const adminMark = adminEstado === 'ACTIVO' ? '✓' : adminEstado === 'PENDIENTE' ? '○' : '!'
    const activationComplete = empresa.activa === true

    let actions = ''
    if (adminEstado === 'PENDIENTE') {
      actions = '<button id="btn-crear-superadmin" class="platform-btn platform-btn-small platform-btn-primary" type="button">Crear administrador</button>'
    } else if (adminEstado === 'ACTIVO') {
      actions = '<button id="btn-recuperar-superadmin" class="platform-btn platform-btn-small platform-btn-ghost" type="button">Recuperar acceso</button>'
      if (!empresa.activa) actions += '<button id="btn-activar-empresa-detail" class="platform-btn platform-btn-small platform-btn-success" type="button">Activar empresa</button>'
    } else if (adminEstado === 'INACTIVO') {
      actions = '<button id="btn-recuperar-superadmin" class="platform-btn platform-btn-small platform-btn-primary" type="button">Recuperar acceso</button>'
    }

    box.hidden = false
    box.innerHTML = `<div class="platform-onboarding-header"><div><p class="platform-eyebrow">Configuración inicial</p><h3>Preparación de la empresa</h3></div>${empresa.activa && adminEstado === 'ACTIVO' ? '<span class="platform-badge platform-badge-active">Lista para iniciar sesión</span>' : ''}</div>
      <div class="platform-onboarding-steps">
        <div class="platform-onboarding-step complete"><span class="platform-step-mark">✓</span><div><strong>Empresa creada</strong><small>Los datos principales están registrados.</small></div></div>
        <div class="platform-onboarding-step ${adminTone}"><span class="platform-step-mark">${adminMark}</span><div><strong>${escapeHtml(descripcionEstadoAdministrador(adminEstado))}</strong><small>${escapeHtml(adminCopy)}</small>${identidad}</div></div>
        <div class="platform-onboarding-step ${activationComplete ? 'complete' : 'pending'}"><span class="platform-step-mark">${activationComplete ? '✓' : '○'}</span><div><strong>Empresa ${activationComplete ? 'activada' : 'por activar'}</strong><small>${activationComplete ? 'El acceso tenant está habilitado.' : 'Se habilita después de configurar al administrador.'}</small></div></div>
      </div>
      ${actions ? `<div class="platform-onboarding-actions">${actions}</div>` : ''}
      <div class="platform-onboarding-fiscal"><div><strong>Facturación</strong><span>Estado fiscal informado por el tenant; Platform no configura ni autoriza el timbrado.</span></div>${renderFiscalChip(empresa.facturacionEstado)}</div>`

    if (el('btn-crear-superadmin')) el('btn-crear-superadmin').addEventListener('click', () => openSuperadminModal(empresa.id))
    if (el('btn-recuperar-superadmin')) el('btn-recuperar-superadmin').addEventListener('click', () => openRecoverModal(empresa.id))
    if (el('btn-activar-empresa-detail')) el('btn-activar-empresa-detail').addEventListener('click', () => confirmStateChange(empresa, 'activar'))
  }

  function openCreateModal() {
    state.editando = null
    state.slugTouched = false
    clearForm()
    el('empresa-additional').open = false
    clearModalMessage()
    renderDetailMeta(null)
    renderSuperadminBox(null)
    el('empresa-modal-eyebrow').textContent = 'Nueva empresa'
    el('empresa-modal-title').textContent = 'Crear empresa'
    el('empresa-form-submit').textContent = 'Crear empresa'
    openOverlay('empresa-modal')
    el('empresa-nombreComercial').focus()
  }

  async function openDetailModal(id) {
    clearModalMessage()
    try {
      const data = await window.jeshaPlatformSession.request(`/platform/empresas/${id}`)
      state.editando = data.empresa
      fillForm(data.empresa)
      renderDetailMeta(data.empresa)
      renderSuperadminBox(data.empresa)
      el('empresa-modal-eyebrow').textContent = `Empresa #${data.empresa.id}`
      el('empresa-modal-title').textContent = data.empresa.nombreComercial
      el('empresa-form-submit').textContent = 'Guardar cambios'
      openOverlay('empresa-modal')
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) showPageMessage(err.message, 'error')
    }
  }

  function closeCompanyModal(restoreFocus = true) {
    closeOverlay('empresa-modal', restoreFocus)
    state.editando = null
    state.slugTouched = false
    clearModalMessage()
  }

  // ── Crear administrador de empresa (primer SUPERADMIN) ─────────────
  function showSuperadminMessage(message) {
    const box = el('superadmin-modal-message')
    box.textContent = message
    box.hidden = false
  }

  function clearSuperadminMessage() {
    const box = el('superadmin-modal-message')
    box.textContent = ''
    box.hidden = true
  }

  function openSuperadminModal(id) {
    state.superadminTargetId = id
    el('superadmin-nombre').value = ''
    el('superadmin-username').value = ''
    el('superadmin-password').value = ''
    el('superadmin-confirmar').value = ''
    clearSuperadminMessage()
    openOverlay('superadmin-modal')
    el('superadmin-nombre').focus()
  }

  function closeSuperadminModal(restoreFocus = true) {
    closeOverlay('superadmin-modal', restoreFocus)
    state.superadminTargetId = null
    clearSuperadminMessage()
  }

  async function saveSuperadmin(event) {
    event.preventDefault()
    if (state.savingSuperadmin) return
    clearSuperadminMessage()
    if (!state.superadminTargetId) return

    const payload = {
      nombre: el('superadmin-nombre').value.trim(),
      username: el('superadmin-username').value.trim(),
      password: el('superadmin-password').value,
      confirmarPassword: el('superadmin-confirmar').value
    }

    if (!payload.nombre || payload.nombre.length < 2) return showSuperadminMessage('Ingresa un nombre válido.')
    if (!payload.username || payload.username.length < 1) return showSuperadminMessage('Ingresa un nombre de usuario.')
    if (!payload.password || payload.password.length < 6) return showSuperadminMessage('La contraseña debe tener al menos 6 caracteres.')
    if (payload.password !== payload.confirmarPassword) return showSuperadminMessage('Las contraseñas no coinciden.')

    const targetId = state.superadminTargetId
    const submit = el('superadmin-form-submit')
    submit.disabled = true
    const originalText = submit.textContent
    submit.textContent = 'Guardando...'
    state.savingSuperadmin = true

    try {
      const data = await window.jeshaPlatformSession.request(`/platform/empresas/${targetId}/superadmin`, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      closeSuperadminModal(false)
      await loadEmpresas()
      await openDetailModal(targetId)
      showPageMessage(`Administrador ${data.usuario.username} creado para la empresa.`, 'success')
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        if (err.code === 'EMPRESA_SUPERADMIN_USERNAME_DUPLICADO') showSuperadminMessage('Ese nombre de usuario ya existe en esta empresa.')
        else if (err.code === 'EMPRESA_YA_TIENE_SUPERADMIN') showSuperadminMessage('La empresa ya tiene un administrador configurado.')
        else showSuperadminMessage(err.message)
      }
    } finally {
      state.savingSuperadmin = false
      submit.disabled = false
      submit.textContent = originalText
    }
  }

  // ── Recuperar acceso del administrador (SUPERADMIN existente) ──────
  function showRecoverMessage(message) {
    const box = el('recover-modal-message')
    box.textContent = message
    box.hidden = false
  }

  function clearRecoverMessage() {
    const box = el('recover-modal-message')
    box.textContent = ''
    box.hidden = true
  }

  function openRecoverModal(id) {
    state.recoverTargetId = id
    el('recover-password').value = ''
    el('recover-confirmar').value = ''
    clearRecoverMessage()
    openOverlay('recover-modal')
    el('recover-password').focus()
  }

  function closeRecoverModal(restoreFocus = true) {
    closeOverlay('recover-modal', restoreFocus)
    state.recoverTargetId = null
    clearRecoverMessage()
  }

  async function saveRecover(event) {
    event.preventDefault()
    if (state.savingRecover) return
    clearRecoverMessage()
    if (!state.recoverTargetId) return

    const payload = {
      password: el('recover-password').value,
      confirmarPassword: el('recover-confirmar').value
    }

    if (!payload.password || payload.password.length < 6) return showRecoverMessage('La contraseña debe tener al menos 6 caracteres.')
    if (payload.password !== payload.confirmarPassword) return showRecoverMessage('Las contraseñas no coinciden.')

    const targetId = state.recoverTargetId
    const submit = el('recover-form-submit')
    submit.disabled = true
    const originalText = submit.textContent
    submit.textContent = 'Recuperando...'
    state.savingRecover = true

    try {
      const data = await window.jeshaPlatformSession.request(`/platform/empresas/${targetId}/superadmin/recover`, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      closeRecoverModal(false)
      await loadEmpresas()
      await openDetailModal(targetId)
      showPageMessage(`Acceso recuperado para ${data.usuario.username}.`, 'success')
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        if (err.code === 'EMPRESA_SUPERADMIN_NO_ENCONTRADO') showRecoverMessage('La empresa no tiene un administrador configurado para recuperar.')
        else if (err.code === 'EMPRESA_SUPERADMIN_AMBIGUO') showRecoverMessage('La empresa tiene más de un administrador configurado. Contacta a soporte.')
        else showRecoverMessage(err.message)
      }
    } finally {
      state.savingRecover = false
      submit.disabled = false
      submit.textContent = originalText
    }
  }

  async function saveEmpresa(event) {
    event.preventDefault()
    if (state.savingEmpresa) return
    clearModalMessage()

    const payload = buildPayload()
    const validationError = validateForm(payload)
    if (validationError) {
      showModalMessage(validationError)
      return
    }

    const submit = el('empresa-form-submit')
    submit.disabled = true
    const originalText = submit.textContent
    submit.textContent = 'Guardando...'
    state.savingEmpresa = true

    try {
      let successMessage
      let createdId = null
      if (state.editando) {
        const data = await window.jeshaPlatformSession.request(`/platform/empresas/${state.editando.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        })
        closeCompanyModal(false)
        successMessage = `Empresa ${data.empresa.nombreComercial} actualizada.`
      } else {
        const data = await window.jeshaPlatformSession.request('/platform/empresas', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
        createdId = data.empresa.id
        closeCompanyModal(false)
        clearForm()
        el('btn-nueva-empresa').focus()
        successMessage = `Empresa ${data.empresa.nombreComercial} creada como inactiva.`
      }
      await loadEmpresas()
      if (createdId) await openDetailModal(createdId)
      showPageMessage(successMessage, 'success')
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        if (err.code === 'EMPRESA_SLUG_DUPLICADO') showModalMessage('Ese slug ya está siendo utilizado por otra empresa.')
        else if (Array.isArray(err.data?.errores) && err.data.errores.length) showModalMessage(err.data.errores.map((item) => item.mensaje).join(' · '))
        else showModalMessage(err.message)
      }
    } finally {
      state.savingEmpresa = false
      submit.disabled = false
      submit.textContent = originalText
    }
  }

  function confirmStateChange(empresa, action) {
    state.confirmAction = { empresa, action }
    const activate = action === 'activar'
    el('confirm-title').textContent = activate ? 'Activar empresa' : 'Suspender empresa'
    el('confirm-copy').innerHTML = activate
      ? `<strong>Activar ${escapeHtml(empresa.nombreComercial)}</strong><span>✓ Administrador configurado</span><span>Al activar esta empresa, su administrador podrá iniciar sesión en el sistema.</span><span>La configuración fiscal se realiza posteriormente desde la empresa; Platform no es la autoridad fiscal.</span>`
      : `<strong>Suspender ${escapeHtml(empresa.nombreComercial)}</strong><span>Los datos se conservarán, pero el acceso de la empresa quedará inactivo.</span>`
    const accept = el('confirm-accept')
    accept.textContent = activate ? 'Activar empresa' : 'Suspender empresa'
    accept.className = activate
      ? 'platform-btn platform-btn-success'
      : 'platform-btn platform-btn-danger'
    openOverlay('confirm-modal')
  }

  function closeConfirm(restoreFocus = true) {
    closeOverlay('confirm-modal', restoreFocus)
    state.confirmAction = null
    state.enterTargetId = null
    state.enterTargetName = null
  }

  async function applyStateChange() {
    if (state.savingState) return
    const pending = state.confirmAction
    if (!pending) return
    const accept = el('confirm-accept')
    accept.disabled = true
    state.savingState = true
    const detailWasOpen = el('empresa-modal').classList.contains('open') && state.editando?.id === pending.empresa.id
    try {
      const data = await window.jeshaPlatformSession.request(`/platform/empresas/${pending.empresa.id}/${pending.action}`, {
        method: 'POST'
      })
      closeConfirm(false)
      const successMessage = pending.action === 'activar'
        ? `Empresa ${data.empresa.nombreComercial} activada.`
        : `Empresa ${data.empresa.nombreComercial} suspendida.`
      await loadEmpresas()
      if (detailWasOpen) await openDetailModal(pending.empresa.id)
      showPageMessage(successMessage, 'success')
    } catch (err) {
      closeConfirm()
      if (err.status !== 401 && err.status !== 403) {
        if (err.code === 'EMPRESA_SIN_SUPERADMIN') {
          showPageMessage('La empresa necesita un administrador activo antes de activarse. Créalo desde "Ver / editar".', 'warning')
        } else {
          showPageMessage(err.message, 'error')
        }
      }
    } finally {
      state.savingState = false
      accept.disabled = false
    }
  }

  // ── Entrar a empresa (delegated tenant access) ─────────────────────
  function confirmEnterEmpresa(empresa) {
    state.enterTargetId = empresa.id
    state.enterTargetName = empresa.nombreComercial
    el('confirm-title').textContent = 'Entrar a empresa'
    el('confirm-copy').innerHTML = `<strong>Vas a entrar a ${escapeHtml(empresa.nombreComercial)}</strong><span>Entrarás en modo soporte de plataforma.</span><span>Tendrás acceso completo a la empresa como SUPERADMIN.</span>`
    const accept = el('confirm-accept')
    accept.textContent = 'Entrar'
    accept.className = 'platform-btn platform-btn-primary'
    openOverlay('confirm-modal')
  }

  async function doEnterEmpresa() {
    const targetId = state.enterTargetId
    const targetName = state.enterTargetName
    if (!targetId) return
    const accept = el('confirm-accept')
    accept.disabled = true
    try {
      const data = await window.jeshaPlatformSession.request(`/platform/auth/enter/${targetId}`, {
        method: 'POST'
      })
      localStorage.removeItem('jesha_token')
      localStorage.removeItem('jesha_usuario')
      localStorage.removeItem('jesha_empresa_slug')
      localStorage.removeItem('jesha_selected_sucursal_id')
      localStorage.setItem('jesha_delegated_token', data.token)
      localStorage.setItem('jesha_delegated_empresa', JSON.stringify(data.empresa))

      try {
        const apiBase = window.__JESHA_API_URL__ || window.location.origin
        const meRes = await fetch(`${apiBase}/auth/me`, {
          headers: { Authorization: `Bearer ${data.token}` }
        })
        if (meRes.ok) {
          const meData = await meRes.json()
          if (meData?.usuario) {
            localStorage.setItem('jesha_delegated_user', JSON.stringify(meData.usuario))
          }
        }
      } catch (_) {}

      window.location.href = 'dashboard.html'
    } catch (err) {
      closeConfirm()
      if (err.status !== 401 && err.status !== 403) {
        showPageMessage(err.message || 'No fue posible entrar a la empresa.', 'error')
      }
    } finally {
      accept.disabled = false
    }
  }

  let searchTimer = null
  el('empresa-buscar').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      state.buscar = el('empresa-buscar').value.trim()
      state.pagina = 1
      loadEmpresas()
    }, 250)
  })

  el('empresa-estado').addEventListener('change', () => {
    state.estado = el('empresa-estado').value
    state.pagina = 1
    loadEmpresas()
  })

  el('btn-prev').addEventListener('click', () => {
    if (state.pagina > 1) {
      state.pagina -= 1
      loadEmpresas()
    }
  })

  el('btn-next').addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(state.total / state.porPagina))
    if (state.pagina < totalPages) {
      state.pagina += 1
      loadEmpresas()
    }
  })

  el('btn-nueva-empresa').addEventListener('click', openCreateModal)
  el('empresa-nombreComercial').addEventListener('input', () => {
    if (!state.editando && !state.slugTouched) el('empresa-slug').value = sugerirSlugEmpresa(el('empresa-nombreComercial').value)
  })
  el('empresa-slug').addEventListener('input', () => {
    if (!state.editando) state.slugTouched = true
  })
  el('empresa-modal-close').addEventListener('click', closeCompanyModal)
  el('empresa-modal-cancel').addEventListener('click', closeCompanyModal)
  el('empresa-form').addEventListener('submit', saveEmpresa)
  el('confirm-close').addEventListener('click', closeConfirm)
  el('confirm-cancel').addEventListener('click', closeConfirm)
  el('confirm-accept').addEventListener('click', () => {
    if (state.enterTargetId) doEnterEmpresa()
    else applyStateChange()
  })
  el('superadmin-modal-close').addEventListener('click', closeSuperadminModal)
  el('superadmin-modal-cancel').addEventListener('click', closeSuperadminModal)
  el('superadmin-form').addEventListener('submit', saveSuperadmin)
  el('recover-modal-close').addEventListener('click', closeRecoverModal)
  el('recover-modal-cancel').addEventListener('click', closeRecoverModal)
  el('recover-form').addEventListener('submit', saveRecover)
  el('platform-logout').addEventListener('click', () => window.jeshaPlatformSession.logout())

  el('empresas-tbody').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action][data-id]')
    if (!button) return
    const id = Number(button.dataset.id)
    const empresa = state.empresas.find((item) => item.id === id)
    if (!empresa) return
    if (button.dataset.action === 'detalle') openDetailModal(id)
    else if (button.dataset.action === 'activar') confirmStateChange(empresa, 'activar')
    else if (button.dataset.action === 'suspender') confirmStateChange(empresa, 'suspender')
    else if (button.dataset.action === 'enter') confirmEnterEmpresa(empresa)
  })

  for (const modalId of ['empresa-modal', 'confirm-modal', 'superadmin-modal', 'recover-modal']) {
    el(modalId).addEventListener('click', (event) => {
      if (event.target.id !== modalId) return
      if (modalId === 'empresa-modal') closeCompanyModal()
      else if (modalId === 'confirm-modal') closeConfirm()
      else if (modalId === 'superadmin-modal') closeSuperadminModal()
      else closeRecoverModal()
    })
  }

  document.addEventListener('keydown', (event) => {
    const openModal = ['recover-modal', 'superadmin-modal', 'confirm-modal', 'empresa-modal']
      .map((id) => el(id))
      .find((modal) => modal.classList.contains('open'))
    if (event.key === 'Tab' && openModal) {
      const focusable = [...openModal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
      if (focusable.length) {
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
      return
    }
    if (event.key !== 'Escape') return
    if (el('recover-modal').classList.contains('open')) closeRecoverModal()
    else if (el('superadmin-modal').classList.contains('open')) closeSuperadminModal()
    else if (el('confirm-modal').classList.contains('open')) closeConfirm()
    else if (el('empresa-modal').classList.contains('open')) closeCompanyModal()
  })

  try {
    const actor = await window.jeshaPlatformSession.requireSession()
    el('platform-actor').textContent = actor.rol
    await loadEmpresas()
  } catch {}
})()
}
