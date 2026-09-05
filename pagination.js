;(function (global) {
  'use strict'

  const PAGES_PER_BLOCK = 5

  function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function resolveElement(ref) {
    if (!ref) return null
    if (typeof ref === 'string') return document.getElementById(ref)
    return ref
  }

  function jeshaPaginacionModel({ currentPage, totalPages, blockSize = PAGES_PER_BLOCK } = {}) {
    const total = Math.max(0, toInt(totalPages, 0))
    const size = Math.max(1, toInt(blockSize, PAGES_PER_BLOCK))

    if (total === 0) {
      return {
        blockIndex: 0,
        startPage: 0,
        endPage: 0,
        pages: [],
        hasPrevious: false,
        hasNext: false,
        currentPage: 1,
        totalPages: 0
      }
    }

    const current = Math.min(Math.max(1, toInt(currentPage, 1)), total)
    const blockIndex = Math.floor((current - 1) / size)
    const startPage = blockIndex * size + 1
    const endPage = Math.min(startPage + size - 1, total)
    const pages = []

    for (let page = startPage; page <= endPage; page += 1) pages.push(page)

    return {
      blockIndex,
      startPage,
      endPage,
      pages,
      hasPrevious: current > 1,
      hasNext: current < total,
      currentPage: current,
      totalPages: total
    }
  }

  function jeshaRenderPaginacion(options = {}) {
    const model = jeshaPaginacionModel(options)
    const container = resolveElement(options.container || 'pagination')
    const prevButton = resolveElement(options.prevButton || 'btn-prev')
    const nextButton = resolveElement(options.nextButton || 'btn-next')
    const numbersContainer = resolveElement(options.numbersContainer || 'pag-numeros')
    const label = resolveElement(options.label || 'pag-info')
    const input = resolveElement(options.input || 'pag-info-input')
    const onNavigate = typeof options.onNavigate === 'function' ? options.onNavigate : null

    if (!container) return model

    const visible = model.totalPages > 1
    container.hidden = !visible
    container.style.display = visible ? (options.display || 'flex') : 'none'

    if (!visible) {
      if (numbersContainer) numbersContainer.innerHTML = ''
      if (input) input.style.display = 'none'
      if (label) label.style.display = ''
      return model
    }

    if (prevButton) {
      prevButton.disabled = !model.hasPrevious
      prevButton.setAttribute('aria-label', 'Página anterior')
    }
    if (nextButton) {
      nextButton.disabled = !model.hasNext
      nextButton.setAttribute('aria-label', 'Página siguiente')
    }

    if (numbersContainer) {
      numbersContainer.innerHTML = ''
      numbersContainer.setAttribute('role', 'navigation')
      numbersContainer.setAttribute('aria-label', 'Páginas')

      model.pages.forEach(page => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'pag-num-btn'
        button.textContent = String(page)
        button.dataset.pagina = String(page)
        button.setAttribute('aria-label', `Ir a página ${page}`)

        if (page === model.currentPage) {
          button.classList.add('active')
          button.setAttribute('aria-current', 'page')
          button.disabled = true
        } else if (onNavigate) {
          button.addEventListener('click', () => onNavigate(page))
        }

        numbersContainer.appendChild(button)
      })
    }

    const totalRegistros = Number(options.totalRegistros)
    const tieneTotal = Number.isFinite(totalRegistros) && totalRegistros >= 0
    const etiqueta = String(options.etiquetaRegistro || '').trim()
    const detalle = tieneTotal && etiqueta ? ` (${totalRegistros} ${etiqueta})` : ''

    if (label) {
      label.textContent = `Página ${model.currentPage} de ${model.totalPages}${detalle}`
      label.style.display = ''

      if (input && onNavigate) {
        label.classList.add('pag-info-clickable')
        label.setAttribute('role', 'button')
        label.tabIndex = 0
        label.setAttribute('aria-label', `Ir a otra página. Página actual ${model.currentPage} de ${model.totalPages}`)
      }
    }

    if (input) {
      input.style.display = 'none'
      input.min = '1'
      input.max = String(model.totalPages)
      input.setAttribute('aria-label', `Ir a página entre 1 y ${model.totalPages}`)
    }

    function closeInput() {
      if (input) input.style.display = 'none'
      if (label) label.style.display = ''
    }

    function openInput() {
      if (!input || !label || !onNavigate) return
      label.style.display = 'none'
      input.value = String(model.currentPage)
      input.style.display = ''
      input.focus()
      input.select()
    }

    function submitInput() {
      if (!input || !onNavigate) return
      const page = toInt(input.value, NaN)
      if (!Number.isFinite(page) || page < 1 || page > model.totalPages) {
        closeInput()
        return
      }
      closeInput()
      if (page !== model.currentPage) onNavigate(page)
    }

    if (label && input && onNavigate) {
      label.onclick = openInput
      label.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openInput()
        }
      }
      input.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          submitInput()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          closeInput()
        }
      }
      input.onblur = closeInput
    }

    return model
  }

  global.PAGES_PER_BLOCK = PAGES_PER_BLOCK
  global.jeshaPaginacionModel = jeshaPaginacionModel
  global.jeshaRenderPaginacion = jeshaRenderPaginacion
})(window)
