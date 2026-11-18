'use strict'

;(function () {
  const usuarioSesion = window.jeshaSession?.getUsuario() || {}
  const LIMIT = 25
  const ROLES_PUBLICAN = new Set(['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO'])
  const ALCANCES = new Set(['EMPRESA', 'SUCURSAL', 'USUARIO'])

  if (!window.jeshaSession?.isValid()) {
    localStorage.setItem('redirect_after_login', 'notas.html')
    window.location.href = 'login.html'
    throw new Error('Sin autenticación')
  }

  const estado = {
    vista: 'recibidas',
    pagina: 1,
    notas: [],
    total: 0,
    notaActual: null,
    reemplazoId: null,
    sucursales: [],
    usuarios: [],
    debounce: null
  }

  function elemento(tag, clase, texto) {
    const el = document.createElement(tag)
    if (clase) el.className = clase
    if (texto !== undefined && texto !== null) el.textContent = String(texto)
    return el
  }

  function enteroPositivo(valor) {
    const numero = Number(valor)
    return Number.isSafeInteger(numero) && numero > 0 ? numero : null
  }

  function normalizarLista(payload) {
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.data)) return payload.data
    if (Array.isArray(payload?.usuarios)) return payload.usuarios
    if (Array.isArray(payload?.sucursales)) return payload.sucursales
    return []
  }

  function normalizarPagina(payload) {
    const data = normalizarLista(payload)
    const pag = payload?.paginacion || {}
    const total = Number(pag.total ?? payload?.total ?? data.length) || 0
    const page = Number(pag.page ?? pag.pagina ?? payload?.page ?? payload?.pagina ?? estado.pagina) || 1
    const limit = Number(pag.limit ?? pag.porPagina ?? payload?.limit ?? LIMIT) || LIMIT
    const totalPages = Number(pag.totalPages ?? pag.totalPaginas ?? Math.ceil(total / limit)) || 0
    return { data, total, page, totalPages }
  }

  function fmtFecha(iso) {
    if (!iso) return '—'
    const fecha = new Date(iso)
    if (Number.isNaN(fecha.getTime())) return '—'
    return fecha.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function autorDe(nota) {
    return nota.autor?.nombre || nota.Autor?.nombre || nota.UsuarioAutor?.nombre || nota.Usuario?.nombre || nota.autorNombre || '—'
  }

  function alcanceDe(nota) {
    return ALCANCES.has(nota.alcance) ? nota.alcance : (ALCANCES.has(nota.destino) ? nota.destino : 'USUARIO')
  }

  function estaRetirada(nota) {
    return nota.retirada === true || Boolean(nota.retiradaEn) || nota.estado === 'RETIRADA'
  }

  function estaLeida(nota) {
    return nota.leida === true || Boolean(nota.leidaEn || nota.LecturaNota?.[0]?.leidaEn)
  }

  function nombreDestino(nota) {
    const alcance = alcanceDe(nota)
    if (alcance === 'EMPRESA') return nota.Empresa?.nombreComercial || 'Toda la empresa'
    if (alcance === 'SUCURSAL') return nota.sucursal?.nombre || nota.Sucursal?.nombre || nota.sucursalNombre || 'Sucursal'
    return nota.usuarioDestinatario?.nombre || nota.Destinatario?.nombre || nota.UsuarioDestino?.nombre || nota.destinatarioNombre || 'Usuario'
  }

  function etiquetaAlcance(alcance) {
    return { EMPRESA: 'Empresa', SUCURSAL: 'Sucursal', USUARIO: 'Usuario' }[alcance] || alcance
  }

  function cantidadLecturas(nota) {
    return Number(nota.lecturas?.totalDestinatarios ?? nota.lecturasCount ?? nota.totalLecturas ?? nota._count?.LecturaNota ?? nota._count?.Lecturas ?? 0) || 0
  }

  function resolverEstadoDestino(rol, alcance, sesion) {
    const fijo = enteroPositivo(sesion?.sucursalId)
    const seleccionado = enteroPositivo(window.jeshaSession?.getSelectedSucursalId?.())
    const puedeEmpresa = rol === 'SUPERADMIN'
    const alcancePermitido = alcance === 'USUARIO' || alcance === 'SUCURSAL' || (alcance === 'EMPRESA' && puedeEmpresa)
    return {
      puedeEmpresa,
      alcancePermitido,
      mostrarSucursal: alcance === 'SUCURSAL',
      mostrarUsuario: alcance === 'USUARIO',
      sucursalBloqueada: rol !== 'SUPERADMIN',
      sucursalId: rol === 'SUPERADMIN' ? seleccionado : (fijo || seleccionado)
    }
  }

  function estadoVisual(nota) {
    if (estaRetirada(nota)) return { texto: 'Retirada', clase: 'retirada' }
    if (estado.vista === 'enviadas') return { texto: 'Publicada', clase: 'activo' }
    return estaLeida(nota) ? { texto: 'Leída', clase: 'leida' } : { texto: 'No leída', clase: 'no-leida' }
  }

  function badgeNota(nota) {
    const visual = estadoVisual(nota)
    return elemento('span', `ped-estado-badge ${visual.clase}`, visual.texto)
  }

  function crearBoton(texto, clase, accion, id) {
    const boton = elemento('button', clase, texto)
    boton.type = 'button'
    boton.dataset.accion = accion
    boton.dataset.id = String(id)
    return boton
  }

  function crearFila(nota) {
    const tr = document.createElement('tr')
    tr.className = `notas-row${estado.vista === 'recibidas' && !estaLeida(nota) && !estaRetirada(nota) ? ' no-leida' : ''}`
    tr.dataset.id = String(nota.id)

    const estadoTd = document.createElement('td')
    estadoTd.appendChild(badgeNota(nota))
    tr.appendChild(estadoTd)

    const fechaTd = elemento('td', 'nota-fecha', fmtFecha(nota.creadaEn || nota.creadoEn || nota.publicadaEn))
    tr.appendChild(fechaTd)

    const tituloTd = document.createElement('td')
    tituloTd.appendChild(elemento('span', 'nota-titulo-tabla', nota.titulo || 'Sin título'))
    tr.appendChild(tituloTd)

    const destinoTd = document.createElement('td')
    const destino = elemento('div', 'nota-destino')
    destino.appendChild(elemento('strong', '', etiquetaAlcance(alcanceDe(nota))))
    destino.appendChild(elemento('small', '', nombreDestino(nota)))
    destinoTd.appendChild(destino)
    tr.appendChild(destinoTd)

    tr.appendChild(elemento('td', '', autorDe(nota)))

    const lecturasTd = document.createElement('td')
    if (estado.vista === 'enviadas') {
      const totalDestinatarios = cantidadLecturas(nota)
      const botonLecturas = crearBoton(String(totalDestinatarios), 'btn-icon nota-lecturas-btn', 'lecturas', nota.id)
      botonLecturas.setAttribute('aria-label', `${totalDestinatarios} destinatarios; ver confirmaciones de lectura`)
      lecturasTd.appendChild(botonLecturas)
    } else {
      lecturasTd.textContent = '—'
    }
    tr.appendChild(lecturasTd)

    const accionTd = document.createElement('td')
    accionTd.appendChild(crearBoton('Ver', 'btn-icon', 'ver', nota.id))
    tr.appendChild(accionTd)
    return tr
  }

  function crearCard(nota) {
    const card = elemento('article', `nota-card${estado.vista === 'recibidas' && !estaLeida(nota) && !estaRetirada(nota) ? ' no-leida' : ''}`)
    card.dataset.id = String(nota.id)
    const header = elemento('div', 'nota-card-header')
    header.appendChild(elemento('div', 'nota-card-title', nota.titulo || 'Sin título'))
    header.appendChild(badgeNota(nota))
    card.appendChild(header)

    const meta = elemento('div', 'nota-card-meta')
    ;[
      ['Fecha', fmtFecha(nota.creadaEn || nota.creadoEn || nota.publicadaEn)],
      ['Destino', `${etiquetaAlcance(alcanceDe(nota))}: ${nombreDestino(nota)}`],
      ['Autor', autorDe(nota)]
    ].forEach(([label, valor]) => {
      const item = elemento('div', 'meta-item')
      item.appendChild(elemento('span', 'meta-label', label))
      item.appendChild(elemento('span', 'meta-valor', valor))
      meta.appendChild(item)
    })
    card.appendChild(meta)

    const footer = elemento('div', 'nota-card-footer')
    footer.appendChild(elemento('span', 'nota-fecha', estado.vista === 'enviadas' ? `${cantidadLecturas(nota)} destinatarios` : ''))
    footer.appendChild(crearBoton('Ver detalle', 'btn-icon', 'ver', nota.id))
    card.appendChild(footer)
    return card
  }

  function mostrarEstadoLista(tipo, mensaje) {
    const tbody = document.getElementById('notas-tbody')
    const cards = document.getElementById('notas-cards')
    tbody.replaceChildren()
    cards.replaceChildren()
    const tr = document.createElement('tr')
    const td = elemento('td', 'loading-cell')
    td.colSpan = 7
    if (tipo === 'loading') td.appendChild(elemento('div', 'spinner'))
    td.appendChild(elemento('p', tipo === 'error' ? 'nota-error' : '', mensaje))
    if (tipo === 'error') td.appendChild(crearBoton('Reintentar', 'btn-secondary nota-retry', 'reintentar', 0))
    tr.appendChild(td)
    tbody.appendChild(tr)

    const cardEstado = elemento('div', 'loading-cell')
    if (tipo === 'loading') cardEstado.appendChild(elemento('div', 'spinner'))
    cardEstado.appendChild(elemento('p', tipo === 'error' ? 'nota-error' : '', mensaje))
    if (tipo === 'error') cardEstado.appendChild(crearBoton('Reintentar', 'btn-secondary nota-retry', 'reintentar', 0))
    cards.appendChild(cardEstado)
  }

  function renderNotas() {
    const tbody = document.getElementById('notas-tbody')
    const cards = document.getElementById('notas-cards')
    tbody.replaceChildren()
    cards.replaceChildren()
    if (estado.notas.length === 0) {
      mostrarEstadoLista('empty', `No hay notas ${estado.vista}`)
      return
    }
    estado.notas.forEach(nota => {
      tbody.appendChild(crearFila(nota))
      cards.appendChild(crearCard(nota))
    })
  }

  async function cargarNotas() {
    mostrarEstadoLista('loading', 'Cargando notas...')
    const params = new URLSearchParams({ vista: estado.vista, page: String(estado.pagina), limit: String(LIMIT) })
    const buscar = document.getElementById('search-input')?.value.trim()
    const lectura = document.getElementById('filtro-lectura')?.value
    const alcance = document.getElementById('filtro-alcance')?.value
    if (buscar) params.set('buscar', buscar)
    if (lectura && estado.vista === 'recibidas') params.set('lectura', lectura)
    if (alcance) params.set('alcance', alcance)

    try {
      const payload = await window.apiFetch(`/notas?${params.toString()}`)
      const pagina = normalizarPagina(payload)
      estado.notas = pagina.data
      estado.total = pagina.total
      estado.pagina = pagina.page
      renderNotas()
      window.jeshaRenderPaginacion({
        currentPage: estado.pagina,
        totalPages: pagina.totalPages,
        totalRegistros: pagina.total,
        etiquetaRegistro: 'notas',
        onNavigate: paginaDestino => { estado.pagina = paginaDestino; cargarNotas() }
      })
    } catch (error) {
      mostrarEstadoLista('error', window.jeshaMensajeSeguro?.(error.message, 'No fue posible cargar las notas. Intenta nuevamente.') || 'No fue posible cargar las notas.')
      document.getElementById('pagination').style.display = 'none'
    }
  }

  function poblarSelect(select, items, placeholder) {
    select.replaceChildren()
    const inicial = elemento('option', '', placeholder)
    inicial.value = ''
    select.appendChild(inicial)
    items.forEach(item => {
      const id = enteroPositivo(item.id)
      if (!id || item.activo === false || item.activa === false) return
      const option = elemento('option', '', item.nombre || `Registro ${id}`)
      option.value = String(id)
      select.appendChild(option)
    })
  }

  async function cargarDestinos() {
    const peticiones = [window.apiFetch('/sucursales')]
    if (ROLES_PUBLICAN.has(usuarioSesion.rol)) {
      const usuariosPath = usuarioSesion.rol === 'SUPERADMIN'
        ? '/usuarios/responsables-bitacora'
        : '/usuarios/vendedores'
      peticiones.push(window.apiFetch(usuariosPath))
    }
    const resultados = await Promise.allSettled(peticiones)
    estado.sucursales = resultados[0].status === 'fulfilled' ? normalizarLista(resultados[0].value) : []
    estado.usuarios = resultados[1]?.status === 'fulfilled' ? normalizarLista(resultados[1].value) : []
    estado.usuarios = estado.usuarios.filter(item => {
      if (enteroPositivo(item.id) === enteroPositivo(usuarioSesion.id)) return false
      return usuarioSesion.rol === 'SUPERADMIN' || item.rol !== 'SUPERADMIN'
    })
    poblarSelect(document.getElementById('nota-sucursal'), estado.sucursales, 'Selecciona una sucursal')
    poblarSelect(document.getElementById('nota-usuario'), estado.usuarios, 'Selecciona un usuario')
    if (resultados[0].status === 'rejected') {
      poblarSelect(document.getElementById('nota-sucursal'), [], 'No fue posible cargar sucursales')
    }
    if (resultados[1]?.status === 'rejected') {
      poblarSelect(document.getElementById('nota-usuario'), [], 'No fue posible cargar usuarios')
    }
  }

  function actualizarDestino() {
    const alcance = document.getElementById('nota-alcance').value
    const config = resolverEstadoDestino(usuarioSesion.rol, alcance, usuarioSesion)
    const grupoSucursal = document.getElementById('grupo-sucursal')
    const grupoUsuario = document.getElementById('grupo-usuario')
    const sucursal = document.getElementById('nota-sucursal')
    const usuario = document.getElementById('nota-usuario')

    grupoSucursal.hidden = !config.mostrarSucursal
    grupoUsuario.hidden = !config.mostrarUsuario
    sucursal.disabled = !config.mostrarSucursal || config.sucursalBloqueada
    usuario.disabled = !config.mostrarUsuario

    if (!config.mostrarSucursal) sucursal.value = ''
    if (!config.mostrarUsuario) usuario.value = ''
    if (config.mostrarSucursal && config.sucursalId) sucursal.value = String(config.sucursalId)
    if (config.mostrarUsuario) filtrarUsuariosPorSucursal()
  }

  function filtrarUsuariosPorSucursal() {
    const select = document.getElementById('nota-usuario')
    const config = resolverEstadoDestino(usuarioSesion.rol, 'USUARIO', usuarioSesion)
    const sucursalId = enteroPositivo(document.getElementById('nota-sucursal').value) || config.sucursalId
    const filtrados = usuarioSesion.rol === 'SUPERADMIN' || !sucursalId
      ? estado.usuarios
      : estado.usuarios.filter(item => !item.sucursalId || enteroPositivo(item.sucursalId) === sucursalId || item.rol === 'SUPERADMIN')
    const valorAnterior = select.value
    poblarSelect(select, filtrados, 'Selecciona un usuario')
    if (Array.from(select.options).some(option => option.value === valorAnterior)) select.value = valorAnterior
  }

  function limpiarErrorEditor() {
    const error = document.getElementById('editor-error')
    error.textContent = ''
    error.classList.remove('show')
  }

  function mostrarErrorEditor(mensaje) {
    const error = document.getElementById('editor-error')
    error.textContent = mensaje
    error.classList.add('show')
  }

  function abrirEditor(nota) {
    estado.reemplazoId = nota ? enteroPositivo(nota.id) : null
    limpiarErrorEditor()
    document.getElementById('nota-titulo').value = nota?.titulo || ''
    document.getElementById('nota-contenido').value = nota?.contenido || ''
    document.getElementById('nota-alcance').value = ''
    document.getElementById('nota-sucursal').value = ''
    document.getElementById('nota-usuario').value = ''

    const reemplazando = Boolean(estado.reemplazoId)
    document.getElementById('editor-titulo-modal').textContent = reemplazando ? 'Publicar nota corregida' : 'Publicar nota'
    document.getElementById('editor-guardar').textContent = reemplazando ? 'Publicar corrección' : 'Publicar nota'
    document.getElementById('editor-destino-campos').hidden = reemplazando
    const resumen = document.getElementById('editor-destino-resumen')
    resumen.hidden = !reemplazando
    resumen.textContent = reemplazando ? `La corrección conservará el destino: ${etiquetaAlcance(alcanceDe(nota))} / ${nombreDestino(nota)}.` : ''
    actualizarDestino()
    window.openJeshaModal(document.getElementById('modal-editor'))
  }

  function payloadPublicacion() {
    const titulo = document.getElementById('nota-titulo').value.trim()
    const contenido = document.getElementById('nota-contenido').value.trim()
    if (!titulo || !contenido) throw new Error('Captura el título y el contenido de la nota.')
    if (estado.reemplazoId) return { titulo, contenido }

    const alcance = document.getElementById('nota-alcance').value
    const config = resolverEstadoDestino(usuarioSesion.rol, alcance, usuarioSesion)
    if (!ALCANCES.has(alcance) || !config.alcancePermitido) throw new Error('Selecciona un destino permitido.')
    const payload = { titulo, contenido, alcance }
    if (alcance === 'SUCURSAL') {
      const sucursalId = enteroPositivo(document.getElementById('nota-sucursal').value) || config.sucursalId
      if (!sucursalId) throw new Error('Selecciona una sucursal.')
      payload.sucursalId = sucursalId
    }
    if (alcance === 'USUARIO') {
      const usuarioId = enteroPositivo(document.getElementById('nota-usuario').value)
      if (!usuarioId) throw new Error('Selecciona un usuario.')
      payload.usuarioDestinatarioId = usuarioId
    }
    return payload
  }

  async function guardarNota(event) {
    event.preventDefault()
    limpiarErrorEditor()
    let payload
    try { payload = payloadPublicacion() } catch (error) { mostrarErrorEditor(error.message); return }
    const boton = document.getElementById('editor-guardar')
    boton.disabled = true
    try {
      const path = estado.reemplazoId ? `/notas/${estado.reemplazoId}/reemplazar` : '/notas'
      await window.apiFetch(path, { method: 'POST', body: JSON.stringify(payload) })
      window.closeJeshaModal(document.getElementById('modal-editor'))
      window.jeshaToast(estado.reemplazoId ? 'Nota corregida publicada' : 'Nota publicada', 'success')
      estado.vista = 'enviadas'
      estado.pagina = 1
      actualizarVistaToolbar()
      await cargarNotas()
      window.jeshaNotas?.refresh?.()
    } catch (error) {
      mostrarErrorEditor(window.jeshaMensajeSeguro?.(error.message, 'No fue posible publicar la nota.') || 'No fue posible publicar la nota.')
    } finally {
      boton.disabled = false
    }
  }

  function setDetalleTexto(id, texto) {
    document.getElementById(id).textContent = texto || '—'
  }

  function notaDesdeRespuesta(payload) {
    return payload?.data || payload?.nota || payload
  }

  function renderDetalle(nota) {
    estado.notaActual = nota
    setDetalleTexto('detalle-titulo', nota.titulo || 'Sin título')
    const badge = document.getElementById('detalle-estado')
    const visual = estadoVisual(nota)
    badge.className = `ped-estado-badge ${visual.clase}`
    badge.textContent = visual.texto
    setDetalleTexto('detalle-autor', autorDe(nota))
    setDetalleTexto('detalle-fecha', fmtFecha(nota.creadaEn || nota.creadoEn || nota.publicadaEn))
    setDetalleTexto('detalle-destino', `${etiquetaAlcance(alcanceDe(nota))}: ${nombreDestino(nota)}`)
    setDetalleTexto('detalle-contenido', nota.contenido || '')

    const retiro = document.getElementById('detalle-retiro')
    retiro.hidden = !estaRetirada(nota)
    retiro.textContent = estaRetirada(nota) ? `Nota retirada${nota.motivoRetiro ? `: ${nota.motivoRetiro}` : ''}` : ''

    const acciones = document.getElementById('detalle-acciones')
    acciones.replaceChildren()
    if (estado.vista === 'enviadas' && !estaRetirada(nota)) {
      acciones.appendChild(crearBoton('Retirar nota', 'btn-danger', 'retirar', nota.id))
      acciones.appendChild(crearBoton('Publicar corrección', 'btn-secondary', 'reemplazar', nota.id))
    }
    document.getElementById('detalle-lecturas-seccion').hidden = estado.vista !== 'enviadas'
  }

  async function cargarLecturas(id) {
    const lista = document.getElementById('detalle-lecturas-lista')
    lista.replaceChildren(elemento('p', 'muted-hint', 'Cargando lecturas...'))
    try {
      const payload = await window.apiFetch(`/notas/${id}/lecturas`)
      const lecturas = normalizarLista(payload)
      const confirmadas = lecturas.filter(lectura => lectura.leida === true || Boolean(lectura.leidaEn)).length
      document.getElementById('detalle-lecturas-total').textContent = `${confirmadas}/${payload?.paginacion?.total ?? lecturas.length}`
      lista.replaceChildren()
      if (!lecturas.length) {
        lista.appendChild(elemento('p', 'muted-hint', 'Aún no hay confirmaciones de lectura.'))
        return
      }
      lecturas.forEach(lectura => {
        const item = elemento('div', 'nota-lectura-item')
        item.appendChild(elemento('span', '', lectura.usuario?.nombre || lectura.Usuario?.nombre || lectura.usuarioNombre || lectura.nombre || 'Usuario'))
        const fechaLectura = lectura.leidaEn || lectura.creadaEn || lectura.creadoEn
        const time = elemento('time', lectura.leida ? '' : 'nota-lectura-pendiente', fechaLectura ? fmtFecha(fechaLectura) : 'Pendiente')
        if (fechaLectura) time.dateTime = fechaLectura
        item.appendChild(time)
        lista.appendChild(item)
      })
    } catch (error) {
      lista.replaceChildren(elemento('p', 'nota-error', window.jeshaMensajeSeguro?.(error.message, 'No fue posible cargar las lecturas.') || 'No fue posible cargar las lecturas.'))
      lista.appendChild(crearBoton('Reintentar', 'btn-secondary nota-retry', 'reintentar-lecturas', id))
    }
  }

  function actualizarNotaLeida(id) {
    const nota = estado.notas.find(item => enteroPositivo(item.id) === id)
    if (nota) nota.leida = true
    if (estado.notaActual && enteroPositivo(estado.notaActual.id) === id) estado.notaActual.leida = true
    const badge = document.getElementById('detalle-estado')
    if (badge && estado.vista === 'recibidas') {
      badge.className = 'ped-estado-badge leida'
      badge.textContent = 'Leída'
    }
    renderNotas()
  }

  async function abrirDetalle(id, mostrarLecturas) {
    try {
      const payload = await window.apiFetch(`/notas/${id}`)
      const nota = notaDesdeRespuesta(payload)
      if (!nota || !enteroPositivo(nota.id)) throw new Error('Nota no encontrada')
      renderDetalle(nota)
      window.openJeshaModal(document.getElementById('modal-detalle'))
      if (estado.vista === 'enviadas') cargarLecturas(id)
      if (mostrarLecturas) document.getElementById('detalle-lecturas-seccion').scrollIntoView({ behavior: 'smooth', block: 'nearest' })

      if (estado.vista === 'recibidas' && !estaLeida(nota) && !estaRetirada(nota)) {
        try {
          await window.apiFetch(`/notas/${id}/leer`, { method: 'POST' })
          actualizarNotaLeida(id)
          window.jeshaNotas?.decrement?.(1)
          if (document.getElementById('filtro-lectura').value === 'no_leidas') cargarNotas()
        } catch (error) {
          window.jeshaToast(window.jeshaMensajeSeguro?.(error.message, 'La nota se abrió, pero no fue posible marcarla como leída.') || 'No fue posible marcar la nota como leída.', 'warning')
        }
      }
    } catch (error) {
      window.jeshaToast(window.jeshaMensajeSeguro?.(error.message, 'No fue posible abrir la nota.') || 'No fue posible abrir la nota.', 'error')
    }
  }

  async function marcarTodasLeidas() {
    const ok = await window.jeshaConfirm({ title: 'Marcar todas como leídas', message: 'Se marcarán como leídas todas las notas recibidas pendientes.', confirmText: 'Marcar todas', type: 'primary' })
    if (!ok) return
    try {
      await window.apiFetch('/notas/leer-todas', { method: 'POST' })
      estado.notas.forEach(nota => { nota.leida = true })
      renderNotas()
      window.jeshaNotas?.update?.(0)
      window.jeshaToast('Todas las notas quedaron marcadas como leídas', 'success')
      if (document.getElementById('filtro-lectura').value === 'no_leidas') await cargarNotas()
    } catch (error) {
      window.jeshaToast(window.jeshaMensajeSeguro?.(error.message, 'No fue posible marcar las notas.') || 'No fue posible marcar las notas.', 'error')
    }
  }

  async function retirarNota(id) {
    const motivo = await window.jeshaPrompt({ title: 'Retirar nota', label: 'Indica el motivo del retiro:', placeholder: 'Motivo del retiro...', confirmText: 'Retirar', cancelText: 'Cancelar' })
    if (motivo === null) return
    if (motivo.length < 3) { window.jeshaToast('Captura un motivo de al menos 3 caracteres.', 'warning'); return }
    try {
      await window.apiFetch(`/notas/${id}/retirar`, { method: 'POST', body: JSON.stringify({ motivo }) })
      window.closeJeshaModal(document.getElementById('modal-detalle'))
      window.jeshaToast('Nota retirada', 'success')
      await cargarNotas()
      window.jeshaNotas?.refresh?.()
    } catch (error) {
      window.jeshaToast(window.jeshaMensajeSeguro?.(error.message, 'No fue posible retirar la nota.') || 'No fue posible retirar la nota.', 'error')
    }
  }

  function actualizarVistaToolbar() {
    document.querySelectorAll('[data-vista]').forEach(boton => boton.classList.toggle('active', boton.dataset.vista === estado.vista))
    const recibidas = estado.vista === 'recibidas'
    document.getElementById('filtro-lectura').hidden = !recibidas
    document.getElementById('btn-leer-todas').hidden = !recibidas
    document.getElementById('th-lecturas').textContent = recibidas ? '' : 'Destinatarios'
  }

  function cambiarVista(vista) {
    if (!['recibidas', 'enviadas'].includes(vista) || vista === estado.vista) return
    estado.vista = vista
    estado.pagina = 1
    actualizarVistaToolbar()
    cargarNotas()
  }

  function manejarAccion(event) {
    const boton = event.target.closest('[data-accion]')
    if (boton) {
      const accion = boton.dataset.accion
      const id = enteroPositivo(boton.dataset.id)
      event.stopPropagation()
      if (accion === 'reintentar') cargarNotas()
      else if (accion === 'ver' && id) abrirDetalle(id, false)
      else if (accion === 'lecturas' && id) abrirDetalle(id, true)
      else if (accion === 'reintentar-lecturas' && id) cargarLecturas(id)
      else if (accion === 'retirar' && id) retirarNota(id)
      else if (accion === 'reemplazar' && id && estado.notaActual) {
        window.closeJeshaModal(document.getElementById('modal-detalle'))
        abrirEditor(estado.notaActual)
      }
      return
    }
    const contenedor = event.target.closest('[data-id]')
    const id = enteroPositivo(contenedor?.dataset.id)
    if (id) abrirDetalle(id, false)
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const fecha = document.getElementById('fecha-actual')
    if (fecha) fecha.textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    document.getElementById('btn-publicar').hidden = !ROLES_PUBLICAN.has(usuarioSesion.rol)
    const opcionEmpresa = document.querySelector('#nota-alcance option[value="EMPRESA"]')
    if (opcionEmpresa) opcionEmpresa.disabled = usuarioSesion.rol !== 'SUPERADMIN'
    actualizarVistaToolbar()

    document.querySelectorAll('[data-vista]').forEach(boton => boton.addEventListener('click', () => cambiarVista(boton.dataset.vista)))
    document.getElementById('search-input').addEventListener('input', () => {
      clearTimeout(estado.debounce)
      estado.debounce = setTimeout(() => { estado.pagina = 1; cargarNotas() }, 350)
    })
    ;['filtro-lectura', 'filtro-alcance'].forEach(id => document.getElementById(id).addEventListener('change', () => { estado.pagina = 1; cargarNotas() }))
    document.getElementById('btn-leer-todas').addEventListener('click', marcarTodasLeidas)
    document.getElementById('btn-publicar').addEventListener('click', () => abrirEditor(null))
    document.getElementById('nota-alcance').addEventListener('change', actualizarDestino)
    document.getElementById('nota-sucursal').addEventListener('change', filtrarUsuariosPorSucursal)
    document.getElementById('nota-form').addEventListener('submit', guardarNota)
    document.getElementById('editor-close').addEventListener('click', () => window.closeJeshaModal(document.getElementById('modal-editor')))
    document.getElementById('editor-cancelar').addEventListener('click', () => window.closeJeshaModal(document.getElementById('modal-editor')))
    document.getElementById('detalle-close').addEventListener('click', () => window.closeJeshaModal(document.getElementById('modal-detalle')))
    document.getElementById('notas-tbody').addEventListener('click', manejarAccion)
    document.getElementById('notas-cards').addEventListener('click', manejarAccion)
    document.getElementById('detalle-acciones').addEventListener('click', manejarAccion)
    document.getElementById('btn-prev').addEventListener('click', () => { if (estado.pagina > 1) { estado.pagina -= 1; cargarNotas() } })
    document.getElementById('btn-next').addEventListener('click', () => { estado.pagina += 1; cargarNotas() })

    cargarDestinos().then(actualizarDestino)
    cargarNotas()
  })

  window.NotasUI = Object.freeze({
    resolverEstadoDestino,
    normalizarPagina,
    payloadPublicacion,
    cargarNotas,
    abrirDetalle
  })
})()
