'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const LOGIN_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'login.js'), 'utf8')
const SESSION_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8')

const FIXTURES = {
  tenantAuth: { version: 1, kind: 'TENANT', actor: { id: 1, rol: 'SUPERADMIN' }, tenant: { empresaId: 10 }, branch: { mode: 'NONE', sucursalId: null } },
  tenantAuthWrongActor: { version: 1, kind: 'TENANT', actor: { id: 99, rol: 'SUPERADMIN' }, tenant: { empresaId: 10 }, branch: { mode: 'NONE', sucursalId: null } },
  tenantAuthWrongRol: { version: 1, kind: 'TENANT', actor: { id: 1, rol: 'EMPLEADO' }, tenant: { empresaId: 10 }, branch: { mode: 'NONE', sucursalId: null } },
  tenantAuthWrongEmpresa: { version: 1, kind: 'TENANT', actor: { id: 1, rol: 'SUPERADMIN' }, tenant: { empresaId: 99 }, branch: { mode: 'NONE', sucursalId: null } },
  tenantAuthFixed: (sid) => ({ version: 1, kind: 'TENANT', actor: { id: 2, rol: 'ADMIN_SUCURSAL' }, tenant: { empresaId: 10 }, branch: { mode: 'FIXED', sucursalId: sid } }),
  tenantAuthSelected: (sid) => ({ version: 1, kind: 'TENANT', actor: { id: 1, rol: 'SUPERADMIN' }, tenant: { empresaId: 10 }, branch: { mode: 'SELECTED', sucursalId: sid } }),
  userSuper: { id: 1, nombre: 'Super', username: 'super.a', rol: 'SUPERADMIN', empresaId: 10, sucursalId: null, tema: 'dark' },
  userAdmin: { id: 2, nombre: 'Admin', username: 'admin.a1', rol: 'ADMIN_SUCURSAL', empresaId: 10, sucursalId: 5, tema: 'dark' },
  userPrecios: { id: 3, nombre: 'Prices', username: 'precios', rol: 'PRECIOS', empresaId: 10, sucursalId: null, tema: 'light' },
  sucursales: { sucursales: [{ id: 5, nombre: 'Matriz', activa: true }, { id: 6, nombre: 'Sucursal 2', activa: true }] },
}

function makeDomElement(overrides = {}) {
  const listeners = {}
  return {
    value: '',
    textContent: '',
    disabled: false,
    innerHTML: '',
    checked: false,
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    options: [],
    add() {},
    insertAdjacentHTML() {},
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = []
      listeners[type].push(fn)
    },
    dispatchEvent(ev) {
      const fns = listeners[ev.type] || []
      for (const fn of fns) {
        if (fn.length <= 1) fn.call(this, ev)
        else fn(ev)
      }
    },
    appendChild() {},
    querySelector() { return makeDomElement() },
    querySelectorAll() { return [] },
    ...overrides
  }
}

function createLoginEnv({ mockFetch = async () => new Response('{}', { status: 200 }) } = {}) {
  const storage = {
    _map: new Map(),
    getItem(k) { return this._map.has(k) ? this._map.get(k) : null },
    setItem(k, v) { this._map.set(k, String(v)) },
    removeItem(k) { this._map.delete(k) },
    clear() { this._map.clear() },
    dump() { return Object.fromEntries(this._map) }
  }

  const sessionStorage = {
    _map: new Map(),
    getItem(k) { return this._map.has(k) ? this._map.get(k) : null },
    setItem(k, v) { this._map.set(k, String(v)) },
    removeItem(k) { this._map.delete(k) },
    clear() { this._map.clear() },
    dump() { return Object.fromEntries(this._map) }
  }

  const els = {}
  function byId(id) {
    if (!els[id]) els[id] = makeDomElement()
    return els[id]
  }

  const document = {
    getElementById: byId,
    querySelector(sel) {
      if (sel === '.btn-login') return byId('.btn-login')
      return byId(sel)
    },
    querySelectorAll() { return [byId('.btn-login')] },
    createElement(tag) {
      return makeDomElement({ tagName: tag.toUpperCase() })
    }
  }

  const window = {
    location: { origin: 'http://localhost:5500', href: 'http://localhost:5500/login.html', pathname: '/login.html', replace() {} },
    __JESHA_API_URL__: 'http://localhost:3000',
    fetch: mockFetch,
    dispatchEvent() {},
    jeshaToast() {},
    jeshaSession: null
  }

  const context = vm.createContext({
    window,
    document,
    localStorage: storage,
    sessionStorage,
    Headers, Request, Response, URL,
    fetch: mockFetch,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } },
    console,
    setTimeout, clearTimeout,
    Promise
  })

  vm.runInContext(SESSION_SOURCE, context, { filename: 'session.js' })
  window.jeshaSession = context.window.jeshaSession

  vm.runInContext(LOGIN_SOURCE, context, { filename: 'login.js' })

  return { storage, window, document, els: () => els, context, form: byId('login-form') }
}

function submitForm(env, values = {}) {
  const { els } = env
  const e = els()
  if (values.empresaSlug !== undefined) e['empresa-slug'].value = values.empresaSlug
  if (values.username !== undefined) e['username'].value = values.username
  if (values.password !== undefined) e['password'].value = values.password
  const event = { type: 'submit', preventDefault() {} }
  e['login-form'].dispatchEvent(event)
}

describe('P0-LOGIN-HIBRIDO', () => {

  it('login POST /auth/login con empresaSlug', async () => {
    let loginBody = null
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login') && opts.method === 'POST') {
        loginBody = JSON.parse(opts.body)
        return new Response(JSON.stringify({ token: 't1', usuario: FIXTURES.userAdmin }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuthFixed(5)), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'admin.a1', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.ok(loginBody, 'se llamó /auth/login')
    assert.strictEqual(loginBody.empresaSlug, 'empresa-a')
    assert.strictEqual(loginBody.username, 'admin.a1')
    assert.strictEqual(typeof loginBody.password, 'string')
  })

  it('llama /auth/context antes de persistir sesion', async () => {
    let contextCalls = 0
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't2', usuario: FIXTURES.userAdmin }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        contextCalls++
        return new Response(JSON.stringify(FIXTURES.tenantAuthFixed(5)), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'admin.a1', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(contextCalls, 1, '/auth/context llamado exactamente una vez')
    assert.strictEqual(env.storage.getItem('jesha_token'), 't2', 'token guardado tras validar')
  })

  it('usuario fijo (ADMIN_SUCURSAL) no envia X-Sucursal-Id', async () => {
    let sentHeader = 'UNSET'
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't3', usuario: FIXTURES.userAdmin }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        sentHeader = opts?.headers?.['X-Sucursal-Id'] ?? (opts?.headers?.get?.('X-Sucursal-Id') ?? 'NO_HEADER')
        return new Response(JSON.stringify(FIXTURES.tenantAuthFixed(5)), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'admin.a1', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(sentHeader, 'NO_HEADER', 'usuario fijo no envió X-Sucursal-Id')
    assert.strictEqual(env.storage.getItem('jesha_token'), 't3')
  })

  it('contexto FIXED incorrecto bloquea persistencia', async () => {
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't4', usuario: FIXTURES.userAdmin }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuthSelected(99)), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'admin.a1', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(env.storage.getItem('jesha_token'), null, 'sin token si contexto no coincide')
    assert.strictEqual(env.storage.getItem('jesha_usuario'), null)
  })

  it('SUPERADMIN llama /sucursales/disponibles', async () => {
    let disponiblesCalled = false
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't5', usuario: FIXTURES.userSuper }), { status: 200 })
      }
      if (url.includes('/sucursales/disponibles')) {
        disponiblesCalled = true
        return new Response(JSON.stringify(FIXTURES.sucursales), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuth), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.ok(disponiblesCalled, '/sucursales/disponibles fue llamado')
  })

  it('SUPERADMIN sin sucursales guarda sesion sin sucursal', async () => {
    let contextBranch = 'UNSET'
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't6', usuario: FIXTURES.userSuper }), { status: 200 })
      }
      if (url.includes('/sucursales/disponibles')) {
        return new Response(JSON.stringify({ sucursales: [] }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        contextBranch = opts?.headers?.['X-Sucursal-Id'] ?? (opts?.headers?.get?.('X-Sucursal-Id') ?? 'NO_HEADER')
        return new Response(JSON.stringify(FIXTURES.tenantAuth), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(contextBranch, 'NO_HEADER', 'sin sucursales no envió header')
    assert.strictEqual(env.storage.getItem('jesha_token'), 't6')
    assert.strictEqual(env.storage.getItem('jesha_selected_sucursal_id'), null)
  })

  it('SUPERADMIN con una sucursal autoselecciona y valida', async () => {
    let sentSid = null
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't7', usuario: FIXTURES.userSuper }), { status: 200 })
      }
      if (url.includes('/sucursales/disponibles')) {
        return new Response(JSON.stringify({ sucursales: [{ id: 5, nombre: 'Unica', activa: true }] }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        sentSid = opts?.headers?.['X-Sucursal-Id'] ?? (opts?.headers?.get?.('X-Sucursal-Id') ?? null)
        return new Response(JSON.stringify(FIXTURES.tenantAuthSelected(5)), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(sentSid, '5', 'autoseleccionó sucursal 5')
    assert.strictEqual(env.storage.getItem('jesha_selected_sucursal_id'), '5')
  })

  it('PRECIOS sin sucursal fija ve selector', async () => {
    let disponiblesCalled = false
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't8', usuario: FIXTURES.userPrecios }), { status: 200 })
      }
      if (url.includes('/sucursales/disponibles')) {
        disponiblesCalled = true
        return new Response(JSON.stringify({ sucursales: [{ id: 7, nombre: 'Unica', activa: true }] }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuthSelected(7)), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'precios', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.ok(disponiblesCalled, '/sucursales/disponibles llamado para PRECIOS')
  })

  it('no guarda password ni campos extra', async () => {
    let usuarioLogin = null
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't9', usuario: FIXTURES.userAdmin }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuthFixed(5)), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'admin.a1', password: 'super-secret' })
    await new Promise(r => setTimeout(r, 100))

    const stored = JSON.parse(env.storage.getItem('jesha_usuario') || '{}')
    assert.strictEqual(stored.username, 'admin.a1')
    assert.strictEqual(stored.password, undefined)
  })

  it('actor.id distinto bloquea persistencia', async () => {
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't10', usuario: FIXTURES.userSuper }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuthWrongActor), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(env.storage.getItem('jesha_token'), null)
  })

  it('actor.rol distinto bloquea persistencia', async () => {
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't11', usuario: FIXTURES.userSuper }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuthWrongRol), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(env.storage.getItem('jesha_token'), null)
  })

  it('tenant.empresaId distinto bloquea persistencia', async () => {
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't12', usuario: FIXTURES.userSuper }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuthWrongEmpresa), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(env.storage.getItem('jesha_token'), null)
  })

  it('cero sucursales exige NONE/null en contexto', async () => {
    let contextBranch = 'UNSET'
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't13', usuario: FIXTURES.userSuper }), { status: 200 })
      }
      if (url.includes('/sucursales/disponibles')) {
        return new Response(JSON.stringify({ sucursales: [] }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        contextBranch = opts?.headers?.['X-Sucursal-Id'] ?? (opts?.headers?.get?.('X-Sucursal-Id') ?? 'NO_HEADER')
        return new Response(JSON.stringify(FIXTURES.tenantAuth), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    submitForm(env, { empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.strictEqual(contextBranch, 'NO_HEADER')
    assert.strictEqual(env.storage.getItem('jesha_token'), 't13')
    assert.strictEqual(env.storage.getItem('jesha_selected_sucursal_id'), null)
  })

  it('cero sucursales muestra mensaje de onboarding', async () => {
    let insertHtml = null
    const fetch = async (url, opts) => {
      if (url.includes('/auth/login')) {
        return new Response(JSON.stringify({ token: 't14', usuario: FIXTURES.userSuper }), { status: 200 })
      }
      if (url.includes('/sucursales/disponibles')) {
        return new Response(JSON.stringify({ sucursales: [] }), { status: 200 })
      }
      if (url.includes('/auth/context')) {
        return new Response(JSON.stringify(FIXTURES.tenantAuth), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const env = createLoginEnv({ mockFetch: fetch })
    const cardLeft = env.document.querySelector('.card .left')
    cardLeft.insertAdjacentHTML = (pos, html) => { insertHtml = html }
    submitForm(env, { empresaSlug: 'empresa-a', username: 'super.a', password: 'password' })
    await new Promise(r => setTimeout(r, 100))

    assert.ok(insertHtml, 'insertAdjacentHTML fue llamado con el mensaje de onboarding')
    assert.ok(insertHtml.includes('sucursales configuradas'), 'el mensaje contiene texto de onboarding')
    assert.strictEqual(env.storage.getItem('jesha_token'), 't14')
  })

  it('limpieza de sesion previa al cargar', async () => {
    const storage = {
      _map: new Map([['jesha_token', 'stale'], ['jesha_usuario', '{}']]),
      getItem(k) { return this._map.get(k) ?? null },
      setItem(k, v) { this._map.set(k, String(v)) },
      removeItem(k) { this._map.delete(k) },
      clear() { this._map.clear() },
      dump() { return Object.fromEntries(this._map) }
    }
    const window = {
      location: { origin: 'http://localhost:5500', href: 'http://localhost:5500/login.html', pathname: '/login.html', replace() {} },
      __JESHA_API_URL__: 'http://localhost:3000',
      fetch: async () => new Response('{}', { status: 200 }),
      dispatchEvent() {},
      jeshaToast() {}
    }
    const document = { getElementById() { return makeDomElement() }, querySelector() { return makeDomElement() }, createElement() { return makeDomElement() } }
    const ctx = vm.createContext({
      window, document, localStorage: storage, console, Headers, Request, Response, URL, Promise, CustomEvent: class {}
    })
    vm.runInContext(SESSION_SOURCE, ctx, { filename: 'session.js' })
    window.jeshaSession = ctx.window.jeshaSession

    vm.runInContext(LOGIN_SOURCE, ctx, { filename: 'login.js' })

    assert.strictEqual(storage.getItem('jesha_token'), null, 'token previo limpiado')
    assert.strictEqual(storage.getItem('jesha_usuario'), null, 'usuario previo limpiado')
  })
})
