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