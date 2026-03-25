// ── GUARD DE ACCESO ──
;(function() {
  try {
    const rol = JSON.parse(localStorage.getItem('jesha_usuario') || '{}').rol || 'EMPLEADO'
    if (['EMPLEADO'].includes(rol)) {
      window.location.replace('punto-venta.html')
    }
  } catch(e) { window.location.replace('punto-venta.html') }
})()

// ══════════════════════════════════════════════════════════════════
//  CORTE DE CAJA — JAVASCRIPT
// ══════════════════════════════════════════════════════════════════

const TOKEN   = localStorage.getItem('jesha_token')
const USUARIO = JSON.parse(localStorage.getItem('jesha_usuario') || '{}')

if (!TOKEN && !window.location.pathname.includes('login.html')) {
  localStorage.setItem('redirect_after_login', 'corte-caja.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

// ── DOM ──
const estadoSinTurno        = document.getElementById('estado-sin-turno')
const contenidoCorte        = document.getElementById('contenido-corte')
const fechaActualEl         = document.getElementById('fecha-actual')
const kpiApertura           = document.getElementById('kpi-apertura')
const kpiMontoInicial       = document.getElementById('kpi-monto-inicial')
const kpiTotalVentas        = document.getElementById('kpi-total-ventas')
const kpiNumVentas          = document.getElementById('kpi-num-ventas')
const montoEfectivo         = document.getElementById('monto-efectivo')
const montoTarjeta          = document.getElementById('monto-tarjeta')
const montoTransferencia    = document.getElementById('monto-transferencia')
const montoTotalVentas      = document.getElementById('monto-total-ventas')
const efInicial             = document.getElementById('ef-inicial')
const efVentas              = document.getElementById('ef-ventas')
const efTotal               = document.getElementById('ef-total')
const turnosCajero          = document.getElementById('turno-cajero')
const turnoSucursal         = document.getElementById('turno-sucursal')
const turnoId               = document.getElementById('turno-id')
const montoDeclarado        = document.getElementById('monto-declarado')
const diferenciaBox         = document.getElementById('diferencia-box')
const difEsperado           = document.getElementById('dif-esperado')
const difContado            = document.getElementById('dif-contado')
const difLabel              = document.getElementById('dif-label')
const difValor              = document.getElementById('dif-valor')
const diferenciaResultado   = document.getElementById('diferencia-resultado')
const cierreError           = document.getElementById('cierre-error')
const btnCerrarTurno        = document.getElementById('btn-cerrar-turno')
const modalConfirmarCierre  = document.getElementById('modal-confirmar-cierre')
const modalResultadoCierre  = document.getElementById('modal-resultado-cierre')
const btnCancelarCierre     = document.getElementById('btn-cancelar-cierre')
const btnConfirmarCierre    = document.getElementById('btn-confirmar-cierre')
const modalCierreClose      = document.getElementById('modal-cierre-close')
const resumenCierreModal    = document.getElementById('resumen-cierre-modal')
const resultadoCierreContenido = document.getElementById('resultado-cierre-contenido')

// ── ESTADO ──
let turnoActivo     = null
let efectivoEsperado = 0

// ══════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  if (fechaActualEl) {
    fechaActualEl.textContent = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
  }
  await cargarTurno()
  configurarEventListeners()
})

// ══════════════════════════════════════════════════════════════════
//  CARGAR TURNO ACTIVO
// ══════════════════════════════════════════════════════════════════

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
    await cargarVentas()
  } catch (err) {
    console.error('❌ Error cargando turno:', err)
    estadoSinTurno.style.display = 'flex'
    contenidoCorte.style.display = 'none'
  }
}

// ══════════════════════════════════════════════════════════════════
//  RENDERIZAR DATOS DEL TURNO
// ══════════════════════════════════════════════════════════════════

function renderizarTurno() {
  const apertura = new Date(turnoActivo.abiertaEn)
  kpiApertura.textContent    = apertura.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  kpiMontoInicial.textContent = fmt(turnoActivo.montoInicial)
  turnosCajero.textContent   = turnoActivo.usuario?.nombre || '—'
  turnoSucursal.textContent  = turnoActivo.sucursal?.nombre || '—'
  turnoId.textContent        = `#${turnoActivo.id}`
}

// ══════════════════════════════════════════════════════════════════
//  CARGAR VENTAS DEL TURNO
//  take=9999 garantiza que se sumen TODAS las ventas del turno
// ══════════════════════════════════════════════════════════════════

async function cargarVentas() {
  try {
    const response = await fetch(
      `${API_URL}/ventas?turnoId=${turnoActivo.id}&take=9999`,
      { headers: { 'Authorization': `Bearer ${TOKEN}` } }
    )
    if (window.handle401 && window.handle401(response.status)) return
    if (!response.ok) throw new Error('Error cargando ventas')
    const data   = await response.json()
    const ventas = data.data || []
    calcularTotales(ventas)
  } catch (err) {
    console.error('❌ Error cargando ventas:', err)
  }
}

// ══════════════════════════════════════════════════════════════════
//  CALCULAR TOTALES
// ══════════════════════════════════════════════════════════════════

function calcularTotales(ventas) {
  let totalEfectivo      = 0
  let totalTarjeta       = 0
  let totalTransferencia = 0
  let totalGeneral       = 0

  ventas.forEach(v => {
    const monto = parseFloat(v.total)
    totalGeneral += monto
    if (v.metodoPago === 'EFECTIVO')                              totalEfectivo      += monto
    if (v.metodoPago === 'CREDITO' || v.metodoPago === 'DEBITO') totalTarjeta       += monto
    if (v.metodoPago === 'TRANSFERENCIA')                         totalTransferencia += monto
  })

  kpiTotalVentas.textContent    = fmt(totalGeneral)
  kpiNumVentas.textContent      = ventas.length
  montoEfectivo.textContent     = fmt(totalEfectivo)
  montoTarjeta.textContent      = fmt(totalTarjeta)
  montoTransferencia.textContent = fmt(totalTransferencia)
  montoTotalVentas.textContent  = fmt(totalGeneral)

  // Efectivo esperado = monto inicial + ventas en efectivo ÚNICAMENTE
  const inicial    = parseFloat(turnoActivo.montoInicial) || 0
  efectivoEsperado = parseFloat((inicial + totalEfectivo).toFixed(2))

  efInicial.textContent = fmt(inicial)
  efVentas.textContent  = fmt(totalEfectivo)
  efTotal.textContent   = fmt(efectivoEsperado)
}

// ══════════════════════════════════════════════════════════════════
//  CALCULAR DIFERENCIA EN TIEMPO REAL
// ══════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════
//  MODAL CONFIRMACIÓN DE CIERRE
// ══════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════
//  CERRAR TURNO
// ══════════════════════════════════════════════════════════════════

async function cerrarTurno() {
  const montoFinalDeclarado = parseFloat(montoDeclarado.value)
  if (isNaN(montoFinalDeclarado) || montoFinalDeclarado < 0) {
    cierreError.textContent  = 'Ingresa el monto contado en caja'
    cierreError.style.display = 'block'
    return
  }

  btnConfirmarCierre.disabled     = true
  btnConfirmarCierre.textContent  = '⟳ Cerrando...'
  cierreError.style.display       = 'none'

  try {
    const response = await fetch(`${API_URL}/turnos-caja/cerrar`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body:    JSON.stringify({ montoFinalDeclarado })
    })
    if (window.handle401 && window.handle401(response.status)) return

    const data = await response.json()

    if (!response.ok) {
      cierreError.textContent   = data.error || 'Error cerrando turno'
      cierreError.style.display = 'block'
      modalConfirmarCierre.style.display = 'none'
      return
    }

    modalConfirmarCierre.style.display = 'none'
    mostrarResultadoCierre(data.data, montoFinalDeclarado)

  } catch (err) {
    console.error('❌ Error cerrando turno:', err)
    cierreError.textContent   = 'Error de conexión'
    cierreError.style.display = 'block'
    modalConfirmarCierre.style.display = 'none'
  } finally {
    btnConfirmarCierre.disabled    = false
    btnConfirmarCierre.textContent = '🔒 Confirmar Cierre'
  }
}

// ══════════════════════════════════════════════════════════════════
//  RESULTADO FINAL DEL CIERRE
//  Usa efectivoEsperado local (calculado solo con ventas en efectivo)
//  para garantizar consistencia con lo que el cajero vio en pantalla
// ══════════════════════════════════════════════════════════════════

function mostrarResultadoCierre(turno, montoContado) {
  // Usar el efectivoEsperado calculado localmente (solo efectivo)
  // y el monto que el cajero declaró — no confiar en turno.diferencia
  // del backend viejo que incluía todos los métodos de pago
  const contado    = parseFloat(montoContado)
  const diferencia = parseFloat((contado - efectivoEsperado).toFixed(2))
  const signo      = diferencia > 0 ? '+' : ''
  const claseColor = diferencia === 0 ? '' : diferencia > 0 ? 'resultado-ok' : 'resultado-mal'

  resultadoCierreContenido.innerHTML = `
    <div class="resultado-final">
      <div class="resultado-row">
        <span>Cajero</span>
        <span>${turno.usuario?.nombre || '—'}</span>
      </div>
      <div class="resultado-row">
        <span>Sucursal</span>
        <span>${turno.sucursal?.nombre || '—'}</span>
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

// ══════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════════════════

function configurarEventListeners() {
  montoDeclarado.addEventListener('input', calcularDiferencia)

  btnCerrarTurno.addEventListener('click', () => {
    const contado = parseFloat(montoDeclarado.value)
    if (isNaN(contado) || montoDeclarado.value === '') {
      cierreError.textContent   = 'Ingresa el monto contado en caja antes de cerrar'
      cierreError.style.display = 'block'
      return
    }
    cierreError.style.display = 'none'
    mostrarModalCierre()
  })

  btnConfirmarCierre.addEventListener('click', cerrarTurno)

  btnCancelarCierre.addEventListener('click', () => {
    modalConfirmarCierre.style.display = 'none'
  })

  modalCierreClose.addEventListener('click', () => {
    modalConfirmarCierre.style.display = 'none'
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modalConfirmarCierre.style.display  = 'none'
    }
  })
}

// ══════════════════════════════════════════════════════════════════
//  UTILIDADES
// ══════════════════════════════════════════════════════════════════

function fmt(valor) {
  return `$${parseFloat(valor || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

console.log('✅ corte-caja.js cargado')