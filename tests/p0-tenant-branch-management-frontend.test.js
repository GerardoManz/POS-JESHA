'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const SESSION_SOURCE = fs.readFileSync(path.join(ROOT, 'session.js'), 'utf8')
const SUCURSALES_SOURCE = fs.readFileSync(path.join(ROOT, 'sucursales.js'), 'utf8')

function makeDomElement() {
  const listeners = {}
  const cls = {}
  const classList = {
    add(c) { cls[c] = true },
    remove(c) { cls[c] = false },
    toggle(c) { cls[c] = !cls[c] },
    open: false
  }
  Object.defineProperty(classList, 'open', { get: () => cls.open === true })
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    style: {}, options: [], classList,
    add() {}, insertAdjacentHTML() {},
    getAttribute: () => '', setAttribute() {},
    addEventListener(type, fn) { if (!listeners[type]) listeners[type] = []; listeners[type].push(fn) },
    dispatchEvent(ev) { const fns = listeners[ev.type] || []; for (const fn of fns) { if (fn.length <= 1) fn.call(this, ev); else fn(ev) } },
    appendChild() {}, querySelector() { return makeDomElement() }, querySelectorAll() { return [] },
    focus() {}, remove() {},
    set onclick(v) { this._onclick = v }, get onclick() { return this._onclick }
  }
}

function createEnv({ rol, mock, search } = {}) {
  const storage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) }, clear() { this._m.clear() }, dump() { return Object.fromEntries(this._m) } }

  const els = {}
  function byId(id) { if (!els[id]) els[id] = makeDom(); return els[id] }
  const elsProxy = new Proxy(els, {
    get(t, p) { if (typeof p === 'string') return byId(p); return t[p] },
    set(t, p, v) { t[p] = v; return true }
  })

  const document = {
    getElementById: byId,
    querySelector(sel) { return byId(sel) },
    querySelectorAll() { return [] },
    createElement() { return makeDom() },
    addEventListener() {}
  }

  const redirects = []
  const window = {
    location: { origin: 'http://localhost:5500', href: 'http://localhost:5500/sucursales.html', pathname: '/sucursales.html', search: search || '', replace(u) { redirects.push(u); this.href = u } },
    __JESHA_API_URL__: 'http://localhost:3000',
    fetch: mock || (async () => new Response('{}', { status: 200 })),
    dispatchEvent() {}, jeshaToast() {}, confirm: () => true,
    jeshaSession: null
  }
  const context = vm.createContext({
    window, document, localStorage: storage, fetch: window.fetch,
    Headers, Request, Response, URL, URLSearchParams,
    CustomEvent: class CustomEvent { constructor(t, i) { this.type = t; this.detail = i?.detail } },
    console, setTimeout, clearTimeout, Promise
  })

  vm.runInContext(SESSION_SOURCE, context, { filename: 'session.js' })
  let session = context.window.jeshaSession
  session.start({
    token: 'tok',
    empresaSlug: 'empresa-a',
    usuario: {
      id: 1, nombre: 'Super', username: 'super.a', rol: rol || 'SUPERADMIN',
      empresaId: 10, sucursalId: rol === 'ADMIN_SUCURSAL' ? 5 : null, tema: 'dark'
    }
  })
  window.jeshaSession = session
  context.window.jeshaSession = session

  vm.runInContext(SUCURSALES_SOURCE, context, { filename: 'sucursales.js' })

  return { window, document, els: () => elsProxy, storage, redirects, UI: window.SucursalesUI, session }
}

function makeDom() {
  return makeDomElement()
}

const FIX_GESTION = {
  sucursales: [
    { id: 1, nombre: 'Matriz', codigoPostal: '97000', direccion: 'Centro', telefono: '999', activa: true, creadaEn: '2026-01-01T00:00:00Z' },
    { id: 2, nombre: 'Anexo', codigoPostal: '97001', direccion: null, telefono: null, activa: false, creadoEn: '2026-01-02T00:00:00Z' }
  ],
  total: 2, pagina: 1, porPagina: 100
}

describe('PBAR-TENANT-BRANCH-MANAGEMENT frontend', () => {
  it('página bloquea rol ADMIN_SUCURSAL redirigiendo al dashboard', () => {
    let throwy = null
    try { createEnv({ rol: 'ADMIN_SUCURSAL' }) } catch (err) { throwy = err }
    assert.ok(throwy, 'lazó error de rol sin permiso')
  })

  it('SUPERADMIN carga sin redirección y expone SucursalesUI', () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify(FIX_GESTION), { status: 200 }) })
    assert.strictEqual(env.redirects.length, 0)
    assert.ok(env.UI)
  })

  it('cargarSucursales con un payload pinta la fila de la sucursal activa', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify(FIX_GESTION), { status: 200 }) })
    await env.UI.cargarSucursales()
    const tbody = env.els()['tbody-sucursales']
    assert.ok(tbody.innerHTML.includes('Matriz'))
    assert.ok(tbody.innerHTML.includes('badge-activa'))
  })

  it('la sucursal inactiva se marca con badge inactiva', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify({
      sucursales: [{ id: 2, nombre: 'Anexo', codigoPostal: '97001', direccion: null, telefono: null, activa: false, creadoEn: '2026-01-02T00:00:00Z' }],
      total: 1, pagina: 1, porPagina: 100
    }), { status: 200 }) })
    await env.UI.cargarSucursales()
    const html = env.els()['tbody-sucursales'].innerHTML
    assert.ok(html.includes('badge-inactiva'))
    assert.ok(html.includes('desactivar"') === false) // inactiva ofrece activar, no desactivar
    assert.ok(html.includes('activar"'))
  })

  it('la sucursal activa ofrece desactivar', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify(FIX_GESTION), { status: 200 }) })
    await env.UI.cargarSucursales()
    const html = env.els()['tbody-sucursales'].innerHTML
    assert.ok(html.includes('desactivar"'))
  })

  it('escapa HTML en el nombre (evita inyección)', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify({
      sucursales: [{ id: 9, nombre: '<img src=x onerror=alert(1)>', codigoPostal: '000', activa: true }],
total: 1, pagina: 1, porPagina: 100
    }), { status: 200 }) })
    await env.UI.cargarSucursales()
    const html = env.els()['tbody-sucursales'].innerHTML
    assert.ok(!html.includes('<img src=x'))
  })

  it('cargarSucursales lista vacía muestra mensaje de búsqueda sin resultado', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify({ sucursales: [], total: 0, pagina: 1, porPagina: 100 }), { status: 200 }) })
    await env.UI.cargarSucursales()
    assert.ok(env.els()['tbody-sucursales'].innerHTML.includes('No hay sucursales'))
  })

  it('los filtros van codificados en la query de /sucursales/gestion', async () => {
    let url = null
    const env = createEnv({ mock: async (u) => { url = u; return new Response(JSON.stringify(FIX_GESTION), { status: 200 }) } })
    env.UI.estado.filtro = 'inactivas'
    env.UI.estado.buscar = 'anexo'
    await env.UI.cargarSucursales()
    assert.ok(url.includes('/sucursales/gestion'))
    assert.ok(url.includes('estado=inactivas'))
    assert.ok(url.includes('buscar=anexo'))
    assert.ok(url.includes('porPagina=100'))
  })

  it('paginación no visible cuando total <= porPagina', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify(FIX_GESTION), { status: 200 }) })
    await env.UI.cargarSucursales()
    assert.strictEqual(env.els()['paginacion'].hidden, true)
  })

  it('paginación visible y datos cuando hay más páginas', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify({
      sucursales: FIX_GESTION.sucursales, total: 250, pagina: 1, porPagina: 50
    }), { status: 200 }) })
    env.UI.estado.porPagina = 50
    await env.UI.cargarSucursales()
    assert.strictEqual(env.els()['paginacion'].hidden, false)
    assert.ok(env.els()['paginacion-info'].textContent.includes('Página 1'))
  })

  it('onboarding visible cuando no hay activas y muestra CTA de crear', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify({
      sucursales: [{ id: 5, nombre: 'Inactiva', codigoPostal: '1', activa: false }], total: 1, pagina: 1, porPagina: 100
    }), { status: 200 }) })
    await env.UI.cargarSucursales()
    assert.strictEqual(env.els()['onboarding-panel'].hidden, false)
    assert.strictEqual(env.els()['btn-onboarding-crear'].textContent, 'Crear mi primera sucursal')
  })

  it('onboarding se oculta cuando hay actividad = true', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify(FIX_GESTION), { status: 200 }) })
    await env.UI.cargarSucursales()
    assert.strictEqual(env.els()['onboarding-panel'].hidden, true)
  })

  it('abrirModal(null) abre el modal y el título dice Nueva sucursal', () => {
    const env = createEnv()
    env.UI.abrirModal(null)
    assert.strictEqual(env.els()['modal-sucursal'].classList.open, true)
    assert.strictEqual(env.els()['modal-titulo'].textContent, 'Nueva sucursal')
  })

  it('abrirModal(con sucursal) prellenado y título Editar', () => {
    const env = createEnv()
    env.UI.abrirModal({ id: 1, nombre: 'Matriz', codigoPostal: '97000', direccion: 'C', telefono: '1' })
    assert.strictEqual(env.els()['modal-titulo'].textContent, 'Editar sucursal')
    assert.strictEqual(env.els()['suc-nombre'].value, 'Matriz')
  })

  it('activarSucursal hace POST a /activar y recarga', async () => {
    const calls = []
    const env = createEnv({ mock: async (u, o) => { calls.push({ url: String(u), method: o?.method }); return new Response(JSON.stringify(FIX_GESTION), { status: 200 }) } })
    calls.length = 0 // descartar la carga init del script
    await env.UI.activarSucursal(2)
    assert.ok(calls.some(c => c.method === 'POST' && c.url.endsWith('/sucursales/gestion/2/activar')))
    assert.ok(calls.some(c => c.url.includes('/sucursales/gestion'))) // recarga tras activar
  })

  it('desactivarSucursal dispara POST a /desactivar y recarga', async () => {
    const calls = []
    const env = createEnv({ mock: async (u, o) => { calls.push({ u: String(u), method: o && o.method }); return new Response(JSON.stringify(FIX_GESTION), { status: 200 }) } })
    calls.length = 0
    await env.UI.desactivarSucursal(5)
    assert.ok(calls.some(c => c.method === 'POST' && c.u.endsWith('/sucursales/gestion/5/desactivar')))
  })

  it('guardarSucursal sin campos obligatorios no llama a API y marca error', async () => {
    let calls = 0
    const env = createEnv({ mock: async () => { calls++; return new Response('{}', { status: 200 }) } })
    calls = 0 // descartar la carga init del script
    await env.UI.guardarSucursal()
    assert.strictEqual(calls, 0)
    assert.strictEqual(env.els()['modal-error'].hidden, false)
  })

  it('guardarSucursal creando hace POST con body json', async () => {
    const calls = []
    const env = createEnv({ mock: async (u, o) => { calls.push({ url: String(u), opts: JSON.parse(JSON.stringify(o || {})) }); return new Response(JSON.stringify({ sucursal: { id: 77 } }), { status: 201 }) } })
    calls.length = 0
    env.els()['suc-nombre'].value = 'Nueva Central'
    env.els()['suc-codigoPostal'].value = '97000'
    env.els()['suc-direccion'].value = 'Calle 1'
    await env.UI.guardarSucursal()
    const post = calls.find(c => c.opts.method === 'POST')
    assert.ok(post, 'se emitió un POST')
    const body = JSON.parse(post.opts.body)
    assert.strictEqual(body.nombre, 'Nueva Central')
    assert.strictEqual(body.codigoPostal, '97000')
    assert.strictEqual(body.direccion, 'Calle 1')
  })

  it('crear marca la sucursal nueva para el flujo "Activar y usar"', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify({ sucursal: { id: 99 } }), { status: 201 }) })
    env.els()['suc-nombre'].value = 'Primera'
    env.els()['suc-codigoPostal'].value = '97000'
    await env.UI.guardarSucursal()
    assert.strictEqual(env.UI.getNuevaId(), 99)
  })

  it('editando una sucursal habilita PATCH a /sucursales/gestion/:id', async () => {
    const calls = []
    const env = createEnv({ mock: async (u, o) => { calls.push({ url: String(u), opts: JSON.parse(JSON.stringify(o || {})) }); return new Response(JSON.stringify({ sucursal: { id: 2 } }), { status: 200 }) } })
    calls.length = 0
    env.UI.abrirModal({ id: 2, nombre: 'Anexo' })
    env.els()['suc-nombre'].value = 'Anexo Norte'
    env.els()['suc-codigoPostal'].value = '97001'
    await env.UI.guardarSucursal()
    const patch = calls.find(c => c.opts.method === 'PATCH')
    assert.ok(patch, 'se emitió un PATCH')
    assert.ok(JSON.parse(patch.opts.body).nombre === 'Anexo Norte')
  })

  it('api adjunta el Authorization Bearer', async () => {
    let header = null
    const env = createEnv({ mock: async (u, o) => { header = o.headers.Authorization; return new Response(JSON.stringify({ sucursales: [], total: 0, pagina: 1, porPagina: 100 }), { status: 200 }) } })
    env.storage.setItem('jesha_token', 'mrow')
    await env.UI.cargarSucursales()
    assert.strictEqual(header, 'Bearer mrow')
  })

  it('manejarClickAccion > editar abre el modal con la sucursal buscada', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify(FIX_GESTION), { status: 200 }) })
    await env.UI.cargarSucursales()
    const btn = makeDom()
    btn.getAttribute = (a) => ({ 'data-accion': 'editar', 'data-id': '2' })[a] ?? null
    env.UI.manejarClickAccion(btn)
    assert.strictEqual(env.els()['modal-titulo'].textContent, 'Editar sucursal')
    assert.strictEqual(env.els()['suc-nombre'].value, 'Anexo')
  })

  it('api con respuesta 409 de desactivar lanza el mensaje del backend', async () => {
    const env = createEnv({ mock: async () => new Response(JSON.stringify({ error: 'SUCURSAL_CON_TURNO_ABIERTO', message: 'Tiene turnos abiertos' }), { status: 409 }) })
    let err = null
    try { await env.UI.desactivarSucursal(1) } catch (e) { err = e }
    assert.ok(err)
    assert.strictEqual(err.message, 'Tiene turnos abiertos')
    assert.strictEqual(err.status, 409)
  })

  it('pagina con ?nueva=1 abre el modal de creación automáticamente', () => {
    const env = createEnv({ mock: async () => new Response('{}', { status: 200 }), search: '?nueva=1' })
    assert.strictEqual(env.els()['modal-sucursal'].classList.open, true)
  })
})

describe('PBAR-TENANT-BRANCH-MANAGEMENT frontend — regresión shell/onboarding', () => {
  it('sucursales.html usa el shell canónico tenant', () => {
    const html = fs.readFileSync(path.join(ROOT, 'sucursales.html'), 'utf8')
    assert.ok(html.includes('<body data-page="sucursales">'))
    assert.ok(html.includes('<div class="app-shell">'))
    assert.ok(html.includes('<div id="sidebar-container"></div>'))
    assert.ok(html.includes('<main class="content">'))
    assert.ok(!html.includes('<main class="main-content">'))
  })

  it('CSS respeta hidden y permite tabla horizontal en móvil', () => {
    const css = fs.readFileSync(path.join(ROOT, 'sucursales.css'), 'utf8')
    assert.ok(css.includes('[hidden] { display:none !important; }'))
    assert.ok(css.includes('.table-wrap { overflow-x:auto; }'))
  })

  it('tras crear la primera sucursal inactiva muestra solo "Activar y usar"', async () => {
    const env = createEnv({
      mock: async (u, o) => {
        if (o && o.method === 'POST') {
          return new Response(JSON.stringify({ sucursal: { id: 99 } }), { status: 201 })
        }
        return new Response(JSON.stringify({
          sucursales: [{ id: 99, nombre: 'Primera', codigoPostal: '97000', activa: false }],
          total: 1, pagina: 1, porPagina: 100
        }), { status: 200 })
      }
    })
    env.els()['suc-nombre'].value = 'Primera'
    env.els()['suc-codigoPostal'].value = '97000'
    await env.UI.guardarSucursal()

    assert.strictEqual(env.els()['onboarding-panel'].hidden, false)
    assert.strictEqual(env.els()['onboarding-acciones'].hidden, true)
    assert.strictEqual(env.els()['onboarding-once'].hidden, false)
  })
})

describe('PBAR-TENANT-BRANCH-MANAGEMENT frontend — recursión toast (global === window)', () => {
  // En un script clásico del navegador, globalThis === window, y una declaración
  // top-level `function toast()` termina siendo también window.toast. Si el helper
  // se autollama vía window.toast, hay recursión infinita (RangeError).
  // Este describe NO usa createEnv (que aisla window del global); replica la
  // semántica real del navegador para detectar la recursión.

  function createBrowserEnv({ mock } = {}) {
    const storage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) }, clear() { this._m.clear() } }

    const els = {}
    function byId(id) { if (!els[id]) els[id] = makeDom(); return els[id] }
    const elsProxy = new Proxy(els, {
      get(t, p) { if (typeof p === 'string') return byId(p); return t[p] },
      set(t, p, v) { t[p] = v; return true }
    })

    const document = {
      getElementById: byId,
      querySelector(sel) { return byId(sel) },
      querySelectorAll() { return [] },
      createElement() { return makeDom() },
      addEventListener() {}
    }

    const jeshaToastCalls = []
    const redirects = []
    const location = { origin: 'http://localhost:5500', href: 'http://localhost:5500/sucursales.html', pathname: '/sucursales.html', search: '', replace(u) { redirects.push(u); this.href = u } }

    // CLAVE: en el navegador window === globalThis. El sandbox ES el global.
    const sandbox = {
      console,
      document,
      localStorage: storage,
      fetch: mock || (async () => new Response('{}', { status: 200 })),
      Headers, Request, Response, URL, URLSearchParams,
      CustomEvent: class CustomEvent { constructor(t, i) { this.type = t; this.detail = i?.detail } },
      setTimeout, clearTimeout, Promise,
      location,
      __JESHA_API_URL__: 'http://localhost:3000',
      dispatchEvent() {},
      jeshaToast(msg, tipo) { jeshaToastCalls.push({ msg, tipo }) }
    }
    sandbox.window = sandbox
    sandbox.globalThis = sandbox

    const context = vm.createContext(sandbox)
    vm.runInContext(SESSION_SOURCE, context, { filename: 'session.js' })
    let session = context.window.jeshaSession
    session.start({
      token: 'tok',
      empresaSlug: 'empresa-a',
      usuario: { id: 1, nombre: 'Super', username: 'super.a', rol: 'SUPERADMIN', empresaId: 10, sucursalId: null, tema: 'dark' }
    })
    context.window.jeshaSession = session

    // Si sucursales.js declara `function toast()` top-level, al ser window === global
    // queda expuesto como window.toast y la guarda interna se autollama.
    vm.runInContext(SUCURSALES_SOURCE, context, { filename: 'sucursales.js' })

    return { window: sandbox, els: () => elsProxy, redirects, jeshaToastCalls, UI: context.window.SucursalesUI }
  }

  it('guardarSucursal no colapsa la pila: jeshaToast exactamente una vez y POST único', async () => {
    let postCount = 0
    let getCount = 0
    const env = createBrowserEnv({
      mock: async (u, o) => {
        if (o && o.method === 'POST') {
          postCount++
          return new Response(JSON.stringify({ sucursal: { id: 77 } }), { status: 201 })
        }
        getCount++
        return new Response(JSON.stringify({
          sucursales: [{ id: 77, nombre: 'Primera', codigoPostal: '97000', activa: false }],
          total: 1, pagina: 1, porPagina: 100
        }), { status: 200 })
      }
    })

    env.els()['suc-nombre'].value = 'Primera'
    env.els()['suc-codigoPostal'].value = '97000'

    let rango = null
    try {
      await env.UI.guardarSucursal()
    } catch (err) {
      rango = err
    }

    assert.strictEqual(rango, null, `no debe haber RangeError: ${rango && rango.message}`)
    assert.strictEqual(postCount, 1, 'el POST debe ocurrir exactamente una vez')
    assert.strictEqual(env.jeshaToastCalls.length, 1, 'jeshaToast debe llamarse exactamente una vez')
    assert.strictEqual(env.jeshaToastCalls[0].msg, 'Sucursal creada')
    assert.strictEqual(env.jeshaToastCalls[0].tipo, 'success')
    assert.strictEqual(env.els()['modal-sucursal'].classList.open, false, 'el modal debe cerrarse tras el éxito')
    assert.ok(getCount >= 1, 'debe ejecutarse el refresh (GET /sucursales/gestion) tras crear')
  })

  it('no declara toast() top-level que colisione con window', () => {
    const source = SUCURSALES_SOURCE
    assert.ok(!/\bfunction\s+toast\s*\(/.test(source), 'sucursales.js no debe declarar function toast()')
    assert.ok(!/window\.toast/.test(source), 'sucursales.js no debe referenciar window.toast')
    assert.ok(/\bwindow\.jeshaToast\b/.test(source), 'debe usar window.jeshaToast como contrato de notificación')
  })
})

describe('PBAR-TENANT-BRANCH-MANAGEMENT frontend — semántica de toast (contrato jeshaToast)', () => {
  // El contrato global (sidebar.js window.jeshaToast) acepta: error, warning, info, success.
  // Cualquier otro tipo (p. ej. 'ok') cae en el default = error (fondo/borde/icono rojos).
  // El éxito canónico es 'success'.

  function createEnvSem({ mock }) {
    const storage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) }, clear() { this._m.clear() } }
    const els = {}
    function byId(id) { if (!els[id]) els[id] = makeDom(); return els[id] }
    const elsProxy = new Proxy(els, {
      get(t, p) { if (typeof p === 'string') return byId(p); return t[p] },
      set(t, p, v) { t[p] = v; return true }
    })
    const document = {
      getElementById: byId, querySelector(sel) { return byId(sel) }, querySelectorAll() { return [] },
      createElement() { return makeDom() }, addEventListener() {}
    }
    const toastCalls = []
    const sandbox = {
      console, document, localStorage: storage,
      fetch: mock || (async () => new Response('{}', { status: 200 })),
      Headers, Request, Response, URL, URLSearchParams,
      CustomEvent: class CustomEvent { constructor(t, i) { this.type = t; this.detail = i?.detail } },
      setTimeout, clearTimeout, Promise,
      location: { origin: 'http://localhost:5500', href: 'http://localhost:5500/sucursales.html', pathname: '/sucursales.html', search: '', replace() {} },
      __JESHA_API_URL__: 'http://localhost:3000',
      dispatchEvent() {},
      jeshaToast(msg, tipo) { toastCalls.push({ msg, tipo }) }
    }
    sandbox.window = sandbox
    sandbox.globalThis = sandbox
    const context = vm.createContext(sandbox)
    vm.runInContext(SESSION_SOURCE, context, { filename: 'session.js' })
    const session = context.window.jeshaSession
    session.start({
      token: 'tok', empresaSlug: 'empresa-a',
      usuario: { id: 1, nombre: 'Super', username: 'super.a', rol: 'SUPERADMIN', empresaId: 10, sucursalId: null, tema: 'dark' }
    })
    context.window.jeshaSession = session
    vm.runInContext(SUCURSALES_SOURCE, context, { filename: 'sucursales.js' })
    return { els: () => elsProxy, toastCalls, UI: context.window.SucursalesUI }
  }

  it('las notificaciones de éxito usan "success" (nunca "ok")', async () => {
    let postCount = 0
    const env = createEnvSem({
      mock: async (u, o) => {
        if (o && o.method === 'POST') { postCount++; return new Response(JSON.stringify({ sucursal: { id: 55 } }), { status: 201 }) }
        return new Response(JSON.stringify({ sucursales: [{ id: 55, nombre: 'X', codigoPostal: '1', activa: false }], total: 1, pagina: 1, porPagina: 100 }), { status: 200 })
      }
    })
    env.els()['suc-nombre'].value = 'Nueva'
    env.els()['suc-codigoPostal'].value = '97000'
    await env.UI.guardarSucursal()
    assert.strictEqual(env.toastCalls.length, 1)
    assert.strictEqual(env.toastCalls[0].tipo, 'success')
    assert.notStrictEqual(env.toastCalls[0].tipo, 'ok', 'tipo "ok" no es válido en el contrato jeshaToast')
  })

  it('editar/activar/desactivar también notifican con "success"', async () => {
    const env = createEnvSem({
      mock: async (u, o) => {
        if (o && o.method === 'PATCH') return new Response(JSON.stringify({ sucursal: { id: 2 } }), { status: 200 })
        if (o && o.method === 'POST' && u.endsWith('/activar')) return new Response(JSON.stringify({ sucursal: { id: 2 } }), { status: 200 })
        if (o && o.method === 'POST' && u.endsWith('/desactivar')) return new Response(JSON.stringify({ sucursal: { id: 2 } }), { status: 200 })
        return new Response(JSON.stringify({ sucursales: [{ id: 2, nombre: 'Matriz', codigoPostal: '97000', activa: true }], total: 1, pagina: 1, porPagina: 100 }), { status: 200 })
      }
    })
    env.UI.abrirModal({ id: 2, nombre: 'Matriz' })
    env.els()['suc-nombre'].value = 'Matriz Centro'
    env.els()['suc-codigoPostal'].value = '97000'
    await env.UI.guardarSucursal()
    assert.ok(env.toastCalls.some(t => t.msg === 'Sucursal actualizada' && t.tipo === 'success'))

    env.toastCalls.length = 0
    await env.UI.activarSucursal(2)
    assert.ok(env.toastCalls.some(t => t.msg === 'Sucursal activada' && t.tipo === 'success'))

    env.toastCalls.length = 0
    await env.UI.desactivarSucursal(2)
    assert.ok(env.toastCalls.some(t => t.msg === 'Sucursal desactivada' && t.tipo === 'success'))
  })

  it('error 500 no se notifica como success y usa variante error', async () => {
    const env = createEnvSem({
      mock: async () => new Response(JSON.stringify({ error: 'INTERNAL' }), { status: 500 })
    })
    env.els()['suc-nombre'].value = 'Falla'
    env.els()['suc-codigoPostal'].value = '97000'
    await env.UI.guardarSucursal()
    const errorCall = env.toastCalls[env.toastCalls.length - 1]
    assert.strictEqual(errorCall.tipo, 'error')
    assert.ok(!/Maximum call stack|TypeError|RangeError|Prisma|stack/i.test(errorCall.msg), 'no debe exponer errores internos')
  })

  it('error 409 SUCURSAL_CON_TURNO_ABIERTO se muestra en el modal (no como success)', async () => {
    const env = createEnvSem({
      mock: async (u, o) => {
        if (o && o.method === 'POST' && u.endsWith('/desactivar')) {
          return new Response(JSON.stringify({ error: 'SUCURSAL_CON_TURNO_ABIERTO', message: 'Tiene turnos abiertos' }), { status: 409 })
        }
        return new Response(JSON.stringify({ sucursales: [{ id: 2, nombre: 'Matriz', codigoPostal: '97000', activa: true }], total: 1, pagina: 1, porPagina: 100 }), { status: 200 })
      }
    })
    env.UI.abrirModalDesactivar({ id: 2, nombre: 'Matriz' })
    await env.UI.confirmarDesactivar()
    assert.strictEqual(env.els()['modal-desactivar'].classList.open, true, 'el modal permanece abierto tras el 409')
    assert.strictEqual(env.els()['modal-desactivar-error'].hidden, false)
    assert.ok(/turno de caja abierto/i.test(env.els()['modal-desactivar-error'].textContent))
    assert.ok(!env.toastCalls.some(t => t.tipo === 'success'), 'el 409 nunca se notifica como success')
  })
})
