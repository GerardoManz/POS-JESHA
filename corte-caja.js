;(function() {
  try {
    const rol = JSON.parse(localStorage.getItem('jesha_usuario') || '{}').rol || 'EMPLEADO'
    if (['EMPLEADO'].includes(rol)) {
      window.location.replace('punto-venta.html')
    }
  } catch(e) { window.location.replace('punto-venta.html') }
})()

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')

if (!TOKEN && !window.location.pathname.includes('login.html')) {
  localStorage.setItem('redirect_after_login', 'corte-caja.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

const estadoSinTurno           = document.getElementById('estado-sin-turno')
const contenidoCorte           = document.getElementById('contenido-corte')
const fechaActualEl            = document.getElementById('fecha-actual')
const kpiApertura              = document.getElementById('kpi-apertura')
const kpiMontoInicial          = document.getElementById('kpi-monto-inicial')
const kpiTotalVentas           = document.getElementById('kpi-total-ventas')
const kpiNumVentas             = document.getElementById('kpi-num-ventas')
const montoEfectivo            = document.getElementById('monto-efectivo')
const montoTarjeta             = document.getElementById('monto-tarjeta')
const montoTransferencia       = document.getElementById('monto-transferencia')
const montoTotalVentas          = document.getElementById('monto-total-ventas')
const efInicial                = document.getElementById('ef-inicial')
const efVentas                 = document.getElementById('ef-ventas')
const efTotal                  = document.getElementById('ef-total')
const turnosCajero             = document.getElementById('turno-cajero')
const turnoSucursal            = document.getElementById('turno-sucursal')
const turnoId                  = document.getElementById('turno-id')
const montoDeclarado           = document.getElementById('monto-declarado')
const diferenciaBox             = document.getElementById('diferencia-box')
const difEsperado              = document.getElementById('dif-esperado')
const difContado               = document.getElementById('dif-contado')
const difLabel                 = document.getElementById('dif-label')
const difValor                 = document.getElementById('dif-valor')
const diferenciaResultado      = document.getElementById('diferencia-resultado')
const cierreError              = document.getElementById('cierre-error')
const btnCerrarTurno           = document.getElementById('btn-cerrar-turno')
const modalConfirmarCierre     = document.getElementById('modal-confirmar-cierre')
const modalResultadoCierre     = document.getElementById('modal-resultado-cierre')
const btnCancelarCierre        = document.getElementById('btn-cancelar-cierre')
const btnConfirmarCierre       = document.getElementById('btn-confirmar-cierre')
const modalCierreClose         = document.getElementById('modal-cierre-close')
const resumenCierreModal       = document.getElementById('resumen-cierre-modal')
const resultadoCierreContenido = document.getElementById('resultado-cierre-contenido')
const notasCierreInput         = document.getElementById('notas-cierre')

let turnoActivo      = null
let efectivoEsperado = 0

document.addEventListener('DOMContentLoaded', async () => {
  if (fechaActualEl) {
    fechaActualEl.textContent = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
  }
  await cargarTurno()
  configurarEventListeners()
})

async function cargarTurno() {
  try {
    const response = await fetch(`${API_URL}/turnos-caja/activo`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(response.status)) return
    if (!response.ok) {
      estadoSinTurno.style.display = 'flex'
      contenidoCorte.style.display = 'none'
      return
    }
    const data = await response.json()
    turnoActivo = data.data
    estadoSinTurno.style.display = 'none'
    contenidoCorte.style.display = 'block'
    renderizarTurno()
    await cargarResumen()
  } catch (err) {
    console.error('❌ Error cargando turno:', err)
    estadoSinTurno.style.display = 'flex'
    contenidoCorte.style.display = 'none'
  }
}

function renderizarTurno() {
  const apertura = new Date(turnoActivo.abiertaEn)
  kpiApertura.textContent     = apertura.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  kpiMontoInicial.textContent = fmt(turnoActivo.montoInicial)
  turnosCajero.textContent    = turnoActivo.Usuario?.nombre || '—'
  turnoSucursal.textContent   = turnoActivo.Sucursal?.nombre || '—'
  turnoId.textContent         = `#${turnoActivo.id}`
}

// ── GET /turnos-caja/resumen → totales calculados por el backend ──

async function cargarResumen() {
  try {
    const response = await fetch(`${API_URL}/turnos-caja/resumen`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(response.status)) return
    if (!response.ok) throw new Error('Error cargando resumen')
    const data = await response.json()
    const { totales } = data.data

    efectivoEsperado = totales.efectivoEsperado

    kpiTotalVentas.textContent    = fmt(totales.totalGeneral)
    kpiNumVentas.textContent      = totales.numVentas
    montoEfectivo.textContent     = fmt(totales.totalEfectivo)
    montoTarjeta.textContent      = fmt(totales.totalTarjeta)
    montoTransferencia.textContent= fmt(totales.totalTransferencia)
    montoTotalVentas.textContent  = fmt(totales.totalGeneral)

    efInicial.textContent = fmt(turnoActivo.montoInicial)
    efVentas.textContent  = fmt(totales.totalEfectivo)
    efTotal.textContent   = fmt(efectivoEsperado)
  } catch (err) {
    console.error('❌ Error cargando resumen:', err)
  }
}

function calcularDiferencia() {
  const contado = parseFloat(montoDeclarado.value)
  if (isNaN(contado) || montoDeclarado.value === '') {
    diferenciaBox.style.display = 'none'
    return
  }

  diferenciaBox.style.display = 'block'
  const diferencia = parseFloat((contado - efectivoEsperado).toFixed(2))

  difEsperado.textContent = fmt(efectivoEsperado)
  difContado.textContent  = fmt(contado)

  diferenciaResultado.classList.remove('diferencia-ok', 'diferencia-mal', 'diferencia-cero')

  if (diferencia === 0) {
    difLabel.textContent = 'Sin diferencia'
    difValor.textContent = '$0.00'
    diferenciaResultado.classList.add('diferencia-cero')
  } else if (diferencia > 0) {
    difLabel.textContent = 'Sobrante'
    difValor.textContent = `+${fmt(diferencia)}`
    diferenciaResultado.classList.add('diferencia-ok')
  } else {
    difLabel.textContent = 'Faltante'
    difValor.textContent = `-${fmt(Math.abs(diferencia))}`
    diferenciaResultado.classList.add('diferencia-mal')
  }
}

function mostrarModalCierre() {
  const contado    = parseFloat(montoDeclarado.value) || 0
  const diferencia = parseFloat((contado - efectivoEsperado).toFixed(2))
  const signo      = diferencia > 0 ? '+' : ''
  const color      = diferencia === 0 ? 'var(--muted)' : diferencia > 0 ? '#60d080' : '#ff6b6b'

  resumenCierreModal.innerHTML = `
    <div class="resumen-modal-row">
      <span>Efectivo esperado</span>
      <span>${fmt(efectivoEsperado)}</span>
    </div>
    <div class="resumen-modal-row">
      <span>Monto contado</span>
      <span>${fmt(contado)}</span>
    </div>
    <div class="resumen-modal-row" style="font-weight:600; padding-top:10px;">
      <span>Diferencia</span>
      <span style="color:${color}">${diferencia === 0 ? '$0.00' : signo + fmt(diferencia)}</span>
    </div>
  `
  modalConfirmarCierre.style.display = 'flex'
}

async function cerrarTurno() {
  const montoFinalDeclarado = parseFloat(montoDeclarado.value)
  if (isNaN(montoFinalDeclarado) || montoFinalDeclarado < 0) {
    cierreError.textContent   = 'Ingresa el monto contado en caja'
    cierreError.style.display = 'block'
    return
  }

  btnConfirmarCierre.disabled    = true
  btnConfirmarCierre.textContent  = '⟳ Cerrando...'
  cierreError.style.display       = 'none'

  try {
    const response = await fetch(`${API_URL}/turnos-caja/cerrar`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify({
        montoFinalDeclarado,
        notasCierre: notasCierreInput?.value?.trim() || null
      })
    })
    if (window.handle401 && window.handle401(response.status)) return

    const data = await response.json()

    if (!response.ok) {
      cierreError.textContent  = data.error || 'Error cerrando turno'
      cierreError.style.display = 'block'
      modalConfirmarCierre.style.display = 'none'
      return
    }

    modalConfirmarCierre.style.display = 'none'
    mostrarResultadoCierre(data.data, montoFinalDeclarado)

  } catch (err) {
    console.error('❌ Error cerrando turno:', err)
    cierreError.textContent  = 'Error de conexión'
    cierreError.style.display = 'block'
    modalConfirmarCierre.style.display = 'none'
  } finally {
    btnConfirmarCierre.disabled    = false
    btnConfirmarCierre.textContent = '🔒 Confirmar Cierre'
  }
}

function mostrarResultadoCierre(turno, montoContado) {
  const contado    = parseFloat(montoContado)
  const diferencia = parseFloat((contado - efectivoEsperado).toFixed(2))
  const signo      = diferencia > 0 ? '+' : ''
  const claseColor = diferencia === 0 ? '' : diferencia > 0 ? 'resultado-ok' : 'resultado-mal'

  resultadoCierreContenido.innerHTML = `
    <div class="resultado-final">
      <div class="resultado-row">
        <span>Cajero</span>
        <span>${turno.Usuario?.nombre || '—'}</span>
      </div>
      <div class="resultado-row">
        <span>Sucursal</span>
        <span>${turno.Sucursal?.nombre || '—'}</span>
      </div>
      <div class="resultado-row">
        <span>Monto inicial</span>
        <span>${fmt(turno.montoInicial)}</span>
      </div>
      <div class="resultado-row">
        <span>Efectivo esperado</span>
        <span>${fmt(efectivoEsperado)}</span>
      </div>
      <div class="resultado-row">
        <span>Monto contado</span>
        <span>${fmt(contado)}</span>
      </div>
      <div class="resultado-row" style="font-weight:600;">
        <span>Diferencia</span>
        <span class="${claseColor}">
          ${diferencia === 0 ? '$0.00' : signo + fmt(diferencia)}
        </span>
      </div>
    </div>
  `
  modalResultadoCierre.style.display = 'flex'
}

function configurarEventListeners() {
  montoDeclarado.addEventListener('input', calcularDiferencia)

  btnCerrarTurno.addEventListener('click', () => {
    const contado = parseFloat(montoDeclarado.value)
    if (isNaN(contado) || montoDeclarado.value === '') {
      cierreError.textContent  = 'Ingresa el monto contado en caja antes de cerrar'
      cierreError.style.display = 'block'
      return
    }
    cierreError.style.display = 'none'
    mostrarModalCierre()
  })

  btnConfirmarCierre.addEventListener('click', cerrarTurno)
  btnCancelarCierre.addEventListener('click', () => { modalConfirmarCierre.style.display = 'none' })
  modalCierreClose.addEventListener('click', () => { modalConfirmarCierre.style.display = 'none' })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modalConfirmarCierre.style.display = 'none'
  })
}

function fmt(valor) {
  return `$${parseFloat(valor || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

console.log('✅ corte-caja.js cargado')