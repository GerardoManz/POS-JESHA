'use strict'

const assert = require('node:assert/strict')
const { describe, it, beforeEach } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'productos.js'), 'utf8')
const HTML = fs.readFileSync(path.join(__dirname, '..', 'productos.html'), 'utf8')
const start = SOURCE.indexOf('function configurarBusquedaVoz')
const end = SOURCE.indexOf('\n// ── Autosuggest ──', start)
const VOICE_SOURCE = SOURCE.slice(start, end)

class MockRecognition {
  static instances = []
  constructor() {
    MockRecognition.instances.push(this)
    this.started = false
    this.aborted = false
  }
  start() {
    this.started = true
    this.onstart?.()
  }
  abort() {
    this.aborted = true
    this.started = false
    this.onend?.()
  }
  emitResult(transcript, isFinal = true) {
    this.onresult?.({ results: [{ isFinal, 0: { transcript } }] })
  }
  emitError(error) {
    this.onerror?.({ error })
  }
}

function makeElement() {
  const listeners = {}
  return {
    hidden: true,
    value: '',
    classList: { toggle() {} },
    attributes: {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    dispatchEvent(event) { for (const fn of listeners[event.type] || []) fn(event) },
    click() { for (const fn of listeners.click || []) fn({ type: 'click' }) },
    setAttribute(name, value) { this.attributes[name] = value },
    listenerCount(type) { return (listeners[type] || []).length }
  }
}

function createHarness({ supported = true } = {}) {
  MockRecognition.instances = []
  const input = makeElement()
  const button = makeElement()
  const toasts = []
  let canonicalEvents = 0
  let inputEvents = 0
  input.addEventListener('input', event => {
    inputEvents++
    if (!event.__jeshaVoiceInput) canonicalEvents++
  })

  const document = {
    getElementById(id) {
      if (id === 'search-input') return input
      if (id === 'btn-voz-productos') return button
      return null
    }
  }
  const window = {
    SpeechRecognition: supported ? MockRecognition : undefined,
    webkitSpeechRecognition: undefined,
    addEventListener() {},
    jeshaToast(message) { toasts.push(message) }
  }
  const context = vm.createContext({ window, document, console, Event, setTimeout, clearTimeout })
  vm.runInContext(`let searchInput = document.getElementById('search-input'); let btnVozProductos, reconocimientoVozProductos, vozActiva = false, vozSesion = 0, vozCambioManual = false; ${VOICE_SOURCE}`, context)
  vm.runInContext('configurarBusquedaVoz()', context)
  return { input, button, toasts, getCanonicalEvents: () => canonicalEvents, getInputEvents: () => inputEvents, recognition: () => MockRecognition.instances[0] }
}

describe('P3 voice search — canonical inventory search handoff', () => {
  beforeEach(() => { MockRecognition.instances = [] })

  it('VS01 supported browser shows the mic', () => assert.equal(createHarness().button.hidden, false))
  it('VS02 unsupported browser preserves the text input and hides the mic', () => {
    const h = createHarness({ supported: false })
    h.input.value = 'martillo'
    assert.equal(h.button.hidden, true)
    assert.equal(h.input.value, 'martillo')
  })
  it('VS03 does not start recognition automatically', () => { const h = createHarness(); assert.equal(MockRecognition.instances.length, 1); assert.equal(h.recognition().started, false) })
  it('VS04 explicit click starts recognition', () => {
    const h = createHarness(); h.button.click(); assert.equal(h.recognition().started, true)
  })
  it('VS05 final transcript replaces the existing input', () => {
    const h = createHarness(); h.button.click(); h.recognition().emitResult('  tornillo galvanizado  '); assert.equal(h.input.value, 'tornillo galvanizado')
  })
  it('VS06 transcript dispatches the canonical input event', () => {
    const h = createHarness(); h.button.click(); h.recognition().emitResult('tornillo'); assert.equal(h.getInputEvents(), 1); assert.equal(h.input.listenerCount('input'), 2)
  })
  it('VS07 voice does not create a second search pipeline', () => assert.doesNotMatch(VOICE_SOURCE, /apiFetch|fetch\(|\/productos/))
  it('VS08 voice is a replacement, not an append', () => {
    const h = createHarness(); h.input.value = 'martillo'; h.button.click(); h.recognition().emitResult('tornillo'); assert.equal(h.input.value, 'tornillo')
  })
  it('VS09 permission denied shows a safe message', () => {
    const h = createHarness(); h.button.click(); h.recognition().emitError('not-allowed'); assert.match(h.toasts[0], /micrófono/); assert.doesNotMatch(h.toasts[0], /NotAllowedError|SpeechRecognition/)
  })
  it('VS10 no-speech preserves input and uses safe feedback', () => {
    const h = createHarness(); h.input.value = 'martillo'; h.button.click(); h.recognition().emitError('no-speech'); assert.equal(h.input.value, 'martillo'); assert.match(h.toasts[0], /No se detectó voz/)
  })
  it('VS11 aborted recognition returns to idle', () => {
    const h = createHarness(); h.button.click(); h.button.click(); assert.equal(h.recognition().aborted, true); assert.equal(h.button.attributes['aria-label'], 'Buscar por voz')
  })
  it('VS12 network speech error is safe', () => {
    const h = createHarness(); h.button.click(); h.recognition().emitError('network'); assert.match(h.toasts[0], /búsqueda por voz/); assert.doesNotMatch(h.toasts[0], /network|SpeechRecognition/)
  })
  it('VS13 prevents overlapping recognition sessions', () => {
    const h = createHarness(); h.button.click(); h.button.click(); assert.equal(MockRecognition.instances.length, 1)
  })
  it('VS14 keyboard editing remains available after voice', () => {
    const h = createHarness(); h.button.click(); h.recognition().emitResult('tornillo'); h.input.value = 'martillo'; h.input.dispatchEvent({ type: 'input', __jeshaVoiceInput: false }); assert.equal(h.input.value, 'martillo')
  })
  it('VS15 empty transcript does not trigger input', () => {
    const h = createHarness(); h.button.click(); h.recognition().emitResult('   '); assert.equal(h.input.value, ''); assert.equal(h.getCanonicalEvents(), 0)
  })
  it('VS16 recognition uses es-MX and one-shot settings', () => {
    const h = createHarness(); const r = h.recognition(); assert.equal(r.lang, 'es-MX'); assert.equal(r.continuous, false); assert.equal(r.interimResults, false)
  })
  it('VS17 existing debounce/pagination pipeline remains in productos.js', () => {
    assert.match(SOURCE, /setTimeout\(function\(\) \{ aplicarFiltros\(\) \}, 400\)/)
    assert.match(SOURCE, /function aplicarFiltros\(\) \{\s*paginaActual = 1\s*cargarProductos\(\)/)
  })
  it('VS18 mic button is keyboard accessible', () => assert.match(HTML, /<button[^>]+id="btn-voz-productos"[^>]+aria-label="Buscar por voz"/))
  it('VS19 voice result is marked so manual-change protection does not self-trigger', () => {
    const h = createHarness(); h.button.click(); h.recognition().emitResult('tornillo'); assert.equal(h.input.value, 'tornillo')
  })
  it('VS20 late result cannot overwrite a manual change during listening', () => {
    const h = createHarness(); h.button.click(); h.input.value = 'martillo'; h.input.dispatchEvent({ type: 'input', __jeshaVoiceInput: false }); h.recognition().emitResult('tornillo'); assert.equal(h.input.value, 'martillo')
  })
  it('VS21 no audio recording APIs or upload endpoints are introduced', () => {
    assert.doesNotMatch(VOICE_SOURCE, /MediaRecorder|mediaDevices|Blob|audio\//)
    assert.doesNotMatch(VOICE_SOURCE, /apiFetch|fetch\(|\/productos/)
  })
  it('VS22 unsupported and speech errors do not alter backend search code', () => assert.match(SOURCE, /params\.set\('buscar', busqueda\)/))
  it('VS23 page cleanup aborts active recognition', () => assert.match(VOICE_SOURCE, /beforeunload[\s\S]*vozActiva[\s\S]*abort/))
  it('VS24 raw speech errors are never rendered directly', () => assert.doesNotMatch(VOICE_SOURCE, /event\.error.*textContent|textContent.*event\.error/))
})

describe('P3 voice search — realistic lifecycle (VR01-VR15)', () => {
  beforeEach(() => { MockRecognition.instances = [] })

  it('VR01 start() throw InvalidStateError is caught and shows toast', () => {
    const h = createHarness()
    const r = h.recognition()
    r.started = true
    r.start = function () { throw new DOMException('InvalidStateError', 'InvalidStateError') }
    h.button.click()
    assert.equal(h.button.attributes['aria-label'], 'Buscar por voz')
    assert.ok(h.toasts.some(m => /iniciar/.test(m)), 'shows safe init-failure toast')
  })

  it('VR02 not-allowed shows permission-denied toast with micrófono keyword', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitError('not-allowed')
    assert.ok(h.toasts.some(m => /micrófono/i.test(m)), 'mentions micrófono')
    assert.ok(h.toasts.some(m => !/NotAllowedError/.test(m)), 'no raw error name')
  })

  it('VR03 service-not-allowed shows same safe message as not-allowed', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitError('service-not-allowed')
    assert.ok(h.toasts.some(m => /micrófono/i.test(m)))
  })

  it('VR04 audio-capture shows mic-not-found message', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitError('audio-capture')
    assert.ok(h.toasts.some(m => /micrófono/i.test(m)))
  })

  it('VR05 no-speech shows info toast, not warning', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitError('no-speech')
    assert.ok(h.toasts.some(m => /No se detectó voz/.test(m)))
  })

  it('VR06 network error shows safe network toast', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitError('network')
    assert.ok(h.toasts.some(m => /búsqueda por voz/i.test(m)))
    assert.ok(h.toasts.some(m => !/network|SpeechRecognition/.test(m)), 'no raw error')
  })

  it('VR07 aborted shows no toast (silent cancel)', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitError('aborted')
    assert.equal(h.toasts.length, 0, 'no toast for abort')
  })

  it('VR08 result then end returns to idle state', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitResult('tornillo')
    h.recognition().abort()
    assert.equal(h.button.attributes['aria-label'], 'Buscar por voz')
    assert.equal(h.recognition().aborted, true)
  })

  it('VR09 double click does not start a second recognition', () => {
    const h = createHarness()
    h.button.click()
    h.button.click()
    assert.equal(MockRecognition.instances.length, 1, 'single instance')
    assert.equal(h.recognition().aborted, true, 'first was aborted')
  })

  it('VR10 second session works after first end', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitResult('tornillo')
    h.recognition().abort()
    h.button.click()
    h.recognition().emitResult('martillo')
    assert.equal(h.input.value, 'martillo')
    assert.equal(h.recognition().started, true, 'second session started')
  })

  it('VR11 second session works after error', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitError('no-speech')
    h.button.click()
    h.recognition().emitResult('martillo')
    assert.equal(h.input.value, 'martillo')
  })

  it('VR12 stale result from old session does not block new session', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().abort()
    h.button.click()
    h.recognition().emitResult('martillo')
    assert.equal(h.input.value, 'martillo', 'new session result accepted after old abort')
  })

  it('VR13 result dispatches input event with __jeshaVoiceInput flag', () => {
    const h = createHarness()
    let capturedFlag = null
    const origDispatch = h.input.dispatchEvent.bind(h.input)
    h.input.dispatchEvent = function (event) {
      if (event.type === 'input' && '__jeshaVoiceInput' in event) {
        capturedFlag = event.__jeshaVoiceInput
      }
      return origDispatch(event)
    }
    h.button.click()
    h.recognition().emitResult('tornillo')
    assert.equal(capturedFlag, true, 'voice event has __jeshaVoiceInput = true')
  })

  it('VR14 manual text during listening blocks further voice updates', () => {
    const h = createHarness()
    h.button.click()
    h.input.value = 'manual'
    h.input.dispatchEvent({ type: 'input', __jeshaVoiceInput: false })
    h.recognition().emitResult('voz')
    assert.equal(h.input.value, 'manual', 'manual text preserved')
  })

  it('VR15 voice lifecycle completes after result and end', () => {
    const h = createHarness()
    h.button.click()
    h.recognition().emitResult('tornillo')
    assert.equal(h.input.value, 'tornillo')
    h.recognition().abort()
    assert.equal(h.button.attributes['aria-label'], 'Buscar por voz')
    assert.equal(h.button.attributes.title, 'Buscar por voz')
  })
})

describe('P3 voice search — source diagnostics', () => {
  it('secure context check present for production HTTPS', () => {
    assert.match(SOURCE, /isSecureContext|localhost|127\.0\.0\.1/)
  })
  it('SpeechRecognition detection uses both standard and webkit prefix', () => {
    assert.match(VOICE_SOURCE, /window\.SpeechRecognition/)
    assert.match(VOICE_SOURCE, /window\.webkitSpeechRecognition/)
  })
  it('voice result goes through existing debounce pipeline', () => {
    assert.match(VOICE_SOURCE, /dispatchEvent/)
    assert.match(SOURCE, /setTimeout\(function\(\) \{ aplicarFiltros\(\) \}, 400\)/)
  })
  it('button hidden by default in HTML', () => {
    assert.match(HTML, /<button[^>]+id="btn-voz-productos"[^>]+hidden/)
  })
  it('no maxAlternatives set (defaults to 1)', () => {
    assert.doesNotMatch(VOICE_SOURCE, /maxAlternatives/)
  })
})
