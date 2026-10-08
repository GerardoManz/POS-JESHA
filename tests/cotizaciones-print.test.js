'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '..')
const cotizacionesSource = fs.readFileSync(path.join(ROOT, 'cotizaciones.js'), 'utf8')
const sessionSource = fs.readFileSync(path.join(ROOT, 'session.js'), 'utf8')
const configuracionSource = fs.readFileSync(path.join(ROOT, 'configuracion.js'), 'utf8')
const schemaSource = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'prisma', 'schema.prisma'), 'utf8')
const brandingRoutesSource = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src', 'modules', 'empresas', 'branding.routes.js'), 'utf8')
const platformBrandingRoutesSource = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src', 'modules', 'empresas', 'platform-branding.routes.js'), 'utf8')
const appSource = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src', 'app.js'), 'utf8')

function crearDocumentoVentana() {
  const writes = []
  return {
    writes,
    images: [],
    write(html) { writes.push(html) },
    close() {},
    getElementById() { return null }
  }
}

function cargarCotizaciones({ open, apiFetch, branding } = {}) {
  const toasts = []
  const document = {
    addEventListener() {},
    getElementById() { return null },
    querySelectorAll() { return [] }
  }
  const window = {
    document,
    location: { href: 'http://localhost/cotizaciones.html' },
    open: open || (() => null),
    jeshaSession: {
      isValid: () => true,
      getUsuario: () => ({ id: 1, empresaId: 1, rol: 'SUPERADMIN' }),
      getEmpresaNombre: () => 'Empresa de sesión',
      fetchEmpresaBranding: async () => branding || null
    }
  }
  const context = vm.createContext({
    window,
    document,
    localStorage: { setItem() {}, getItem() { return null } },
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    apiFetch: apiFetch || (async () => { throw new Error('apiFetch inesperado') }),
    jeshaToast: (message, type) => toasts.push({ message, type })
  })
  vm.runInContext(cotizacionesSource, context, { filename: 'cotizaciones.js' })
  return { window, helpers: window.jeshaCotizacionesPrint, toasts }
}

function imagenMock({ complete = false, naturalWidth = 0, decode } = {}) {
  const listeners = new Map()
  return {
    complete,
    naturalWidth,
    hidden: false,
    dataset: {},
    decode,
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type) { listeners.delete(type) },
    emitir(type) { listeners.get(type)?.() }
  }
}

test('espera carga y decodificación de todas las imágenes', async () => {
  const { helpers } = cargarCotizaciones()
  let decoded = false
  const img = imagenMock({ decode: async () => { decoded = true } })
  const espera = helpers.esperarImagen(img, 100)
  img.complete = true
  img.naturalWidth = 120
  img.emitir('load')
  assert.equal(await espera, true)
  assert.equal(decoded, true)
})

test('imagen resuelve false en error, timeout y fallo de decode', async () => {
  const { helpers } = cargarCotizaciones()
  const error = imagenMock()
  const esperaError = helpers.esperarImagen(error, 100)
  error.emitir('error')
  assert.equal(await esperaError, false)

  const lenta = imagenMock()
  assert.equal(await helpers.esperarImagen(lenta, 10), false)

  const decodeError = imagenMock({ complete: true, naturalWidth: 10, decode: async () => { throw new Error('decode') } })
  assert.equal(await helpers.esperarImagen(decodeError, 100), false)
})

test('usa timeout finito seguro si el llamador entrega un valor inválido', async () => {
  const { helpers } = cargarCotizaciones()
  const lenta = imagenMock()
  const inicio = Date.now()
  assert.equal(await helpers.esperarImagen(lenta, Number.POSITIVE_INFINITY), false)
  assert.ok(Date.now() - inicio < 5500)
})

test('fallo del logo oculta imagen rota y muestra nombre comercial', async () => {
  const { helpers } = cargarCotizaciones()
  const logo = imagenMock({ complete: true, naturalWidth: 0 })
  logo.dataset.fallbackId = 'empresa-nombre-fallback'
  const fallback = { hidden: true }
  const resultados = await helpers.esperarImagenesImpresion({
    images: [logo],
    getElementById: id => id === 'empresa-nombre-fallback' ? fallback : null
  }, 20)
  assert.deepEqual(Array.from(resultados), [false])
  assert.equal(logo.hidden, true)
  assert.equal(fallback.hidden, false)
})

test('fallo del logo documental intenta el logo de pantalla antes del nombre', async () => {
  const { helpers } = cargarCotizaciones()
  const logo = imagenMock({ complete: true, naturalWidth: 0 })
  logo.dataset.fallbackId = 'empresa-nombre-fallback'
  logo.dataset.fallbackSrc = 'https://cdn.example/logo-pantalla.png'
  Object.defineProperty(logo, 'src', {
    set(value) {
      this._src = value
      this.complete = true
      this.naturalWidth = 200
    },
    get() { return this._src }
  })
  const fallback = { hidden: true }
  const resultados = await helpers.esperarImagenesImpresion({
    images: [logo],
    getElementById: id => id === 'empresa-nombre-fallback' ? fallback : null
  }, 20)
  assert.deepEqual(Array.from(resultados), [true])
  assert.equal(logo.src, 'https://cdn.example/logo-pantalla.png')
  assert.equal(logo.hidden, false)
  assert.equal(fallback.hidden, true)
})

test('popup bloqueado se informa y evita solicitudes asíncronas', async () => {
  let requests = 0
  const { window, toasts } = cargarCotizaciones({
    open: () => null,
    apiFetch: async () => { requests++; return {} }
  })
  assert.equal(await window.descargarPdf(7), false)
  assert.equal(requests, 0)
  assert.match(toasts[0].message, /bloqueó la ventana del PDF/)
})

test('abre popup antes del primer await y espera generarPdf', async () => {
  const orden = []
  const popupDocument = crearDocumentoVentana()
  const popup = { closed: false, document: popupDocument, focus() {}, print() { orden.push('print') }, close() {} }
  const cotizacion = { folio: 'C-1', tipo: 'SERVICIOS', total: 0, DetalleCotizacion: [] }
  const { window } = cargarCotizaciones({
    open: () => { orden.push('open'); return popup },
    apiFetch: async () => { orden.push('fetch'); return { data: cotizacion } }
  })
  assert.equal(await window.descargarPdf(1), true)
  assert.deepEqual(orden, ['open', 'fetch', 'print'])
})

test('HTML impreso conserva logo seguro, colores y escapa datos interpolados', async () => {
  const popupDocument = crearDocumentoVentana()
  const popup = { closed: false, document: popupDocument, focus() {}, print() {}, close() {} }
  const cotizacion = {
    folio: '<img src=x onerror=alert(1)>',
    creadaEn: '2026-10-05',
    tipo: 'PRODUCTOS',
    total: 11.6,
    notas: '<script>alert(1)</script>',
    Cliente: { nombre: 'A&B', rfc: '<RFC>' },
    Usuario: { nombre: 'U<1' },
    Sucursal: { nombre: 'S"1' },
    DetalleCotizacion: [{
      cantidad: 1,
      precioUnitario: 11.6,
      descuento: 0,
      unidad: '<PZA>',
      Producto: { nombre: '<Taladro>', codigoInterno: 'A&B', imagenUrl: 'https://cdn.example/product.png' }
    }]
  }
  const { window } = cargarCotizaciones({
    open: () => popup,
    apiFetch: async () => ({ data: cotizacion }),
    branding: { nombre: 'Marca <Color>', logoUrl: 'https://cdn.example/screen-logo.png', logoDocumentalUrl: 'https://cdn.example/logo-documental.png' }
  })
  assert.equal(await window.descargarPdf(1), true)
  const html = popupDocument.writes.at(-1)
  assert.match(html, /https:\/\/cdn\.example\/logo-documental\.png/)
  assert.match(html, /data-fallback-src="https:\/\/cdn\.example\/screen-logo\.png"/)
  assert.doesNotMatch(html, /brightness\(0\)|contrast\(2\)|javascript:alert/)
  assert.match(html, /Marca &lt;Color&gt;/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /A&amp;B/)
  assert.match(html, /data-fallback-id="producto-imagen-fallback-/)
  assert.match(html, /id="producto-imagen-fallback-/)
  assert.match(cotizacionesSource, /logoDocumentalUrl/)
})

test('sin branding usa nombre del contexto y nunca fallback global JESHA', async () => {
  const popupDocument = crearDocumentoVentana()
  const popup = { closed: false, document: popupDocument, focus() {}, print() {}, close() {} }
  const { window } = cargarCotizaciones({
    open: () => popup,
    apiFetch: async () => ({ data: { folio: 'C-2', tipo: 'SERVICIOS', total: 0, DetalleCotizacion: [] } })
  })
  await window.descargarPdf(2)
  const html = popupDocument.writes.at(-1)
  assert.match(html, /EMPRESA DE SESIÓN/)
  assert.doesNotMatch(cotizacionesSource, /__JESHA_LOGO_URL__|const LOGO_URL/)
})

test('usa el logo de pantalla como fallback documental cuando es válido', async () => {
  const popupDocument = crearDocumentoVentana()
  const popup = { closed: false, document: popupDocument, focus() {}, print() {}, close() {} }
  const { window } = cargarCotizaciones({
    open: () => popup,
    apiFetch: async () => ({ data: { folio: 'C-4', tipo: 'SERVICIOS', total: 0, DetalleCotizacion: [] } }),
    branding: { nombre: 'Empresa', logoUrl: 'https://cdn.example/logo-pantalla.png', logoDocumentalUrl: null }
  })
  await window.descargarPdf(4)
  const html = popupDocument.writes.at(-1)
  assert.match(html, /logo-pantalla\.png/)
})

test('si ambos logos no son válidos usa únicamente el nombre comercial', async () => {
  const popupDocument = crearDocumentoVentana()
  const popup = { closed: false, document: popupDocument, focus() {}, print() {}, close() {} }
  const { window } = cargarCotizaciones({
    open: () => popup,
    apiFetch: async () => ({ data: { folio: 'C-5', tipo: 'SERVICIOS', total: 0, DetalleCotizacion: [] } }),
    branding: { nombre: 'Empresa Segura', logoUrl: 'javascript:alert(1)', logoDocumentalUrl: 'data:image/png;base64,abc' }
  })
  await window.descargarPdf(5)
  const html = popupDocument.writes.at(-1)
  assert.match(html, /EMPRESA SEGURA/)
  assert.doesNotMatch(html, /javascript:alert|data:image/)
})

test('WhatsApp bloqueado no impide generar el PDF', async () => {
  const popupDocument = crearDocumentoVentana()
  const popupPdf = { closed: false, document: popupDocument, focus() {}, print() {}, close() {} }
  let llamadas = 0
  const { window, toasts } = cargarCotizaciones({
    open: () => ++llamadas === 1 ? popupPdf : null,
    apiFetch: async () => ({ data: { folio: 'C-3', tipo: 'SERVICIOS', total: 0, Cliente: { telefono: '5551234567' }, DetalleCotizacion: [] } })
  })
  assert.equal(await window.enviarWhatsAppPdf(3), true)
  assert.match(toasts[0].message, /bloqueó la ventana de WhatsApp/)
  assert.equal(popupDocument.writes.length, 2)
})

test('URL solo acepta HTTP/HTTPS y escapeHtml neutraliza atributos', () => {
  const { helpers } = cargarCotizaciones()
  assert.equal(helpers.urlHttpSegura('javascript:alert(1)'), '')
  assert.equal(helpers.urlHttpSegura('data:image/png;base64,abc'), '')
  assert.equal(helpers.urlHttpSegura('/logo.png'), '')
  assert.equal(helpers.urlHttpSegura('https://example.com/a.png'), 'https://example.com/a.png')
  assert.equal(helpers.escapeHtml('"<x>&\''), '&quot;&lt;x&gt;&amp;&#39;')
})

test('branding cache se invalida y queda aislado al cambiar tenant', async () => {
  const storage = new Map()
  let requests = 0
  const localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  }
  const window = {
    location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
    fetch: async (_url, init) => {
      requests++
      const token = init.headers.Authorization.replace('Bearer ', '')
      const tenant = token === 'token-a' ? 'Empresa A' : 'Empresa B'
      return { ok: true, json: async () => ({ usuario: { Empresa: { nombreComercial: tenant } } }) }
    },
    dispatchEvent() {}
  }
  window.fetch = window.fetch.bind(window)
  const context = vm.createContext({ window, localStorage, URL, Headers, Request, CustomEvent: class {} })
  vm.runInContext(sessionSource, context, { filename: 'session.js' })

  const usuario = empresaId => ({ id: empresaId, nombre: 'U', username: 'u', rol: 'SUPERADMIN', empresaId, sucursalId: null })
  window.jeshaSession.start({ token: 'token-a', usuario: usuario(1), empresaSlug: 'a' })
  assert.equal((await window.jeshaSession.fetchEmpresaBranding()).nombre, 'Empresa A')
  assert.equal((await window.jeshaSession.fetchEmpresaBranding()).nombre, 'Empresa A')
  assert.equal(requests, 1)

  window.jeshaSession.start({ token: 'token-b', usuario: usuario(2), empresaSlug: 'b' })
  assert.equal((await window.jeshaSession.fetchEmpresaBranding()).nombre, 'Empresa B')
  assert.equal(requests, 2)

  window.jeshaSession.invalidateEmpresaBranding()
  await window.jeshaSession.fetchEmpresaBranding()
  assert.equal(requests, 3)

  storage.set('jesha_delegated_token', 'delegated-token')
  storage.set('jesha_delegated_empresa', JSON.stringify({ id: 3, slug: 'b', nombreComercial: 'Empresa B' }))
  assert.equal((await window.jeshaSession.fetchEmpresaBranding()).nombre, 'Empresa B')
  assert.equal(requests, 4)
})

test('branding de plataforma usa autenticación y actor de plataforma', () => {
  assert.match(appSource, /app\.use\('\/platform\/empresas', autenticarPlataforma, require\('\.\/modules\/empresas\/platform-branding\.routes'\)\)/)
  assert.match(platformBrandingRoutesSource, /req\.platformActor\?\.rol/)
  assert.doesNotMatch(platformBrandingRoutesSource, /req\.usuario\?\.rol/)
})

test('configuración invalida caché tras guardar y restaurar branding', () => {
  const invalidaciones = configuracionSource.match(/window\.jeshaSession\?\.invalidateEmpresaBranding\(\)/g) || []
  assert.equal(invalidaciones.length, 2)
  assert.match(schemaSource, /logoDocumentalUrl\s+String\?/)
  assert.match(brandingRoutesSource, /\/logo-documental/)
  assert.match(brandingRoutesSource, /requireTenantOrDelegated/)
  assert.match(brandingRoutesSource, /rol !== 'SUPERADMIN' && rol !== 'PLATFORM_ADMIN'/)
  assert.match(platformBrandingRoutesSource, /rol !== 'PLATFORM_ADMIN'/)
})
