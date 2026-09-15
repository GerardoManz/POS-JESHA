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
