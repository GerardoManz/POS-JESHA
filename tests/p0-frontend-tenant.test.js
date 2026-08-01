'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SESSION_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8')

function createStorage() {
  const map = new Map()
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) { map.set(key, String(value)) },
    removeItem(key) { map.delete(key) },
    dump() { return Object.fromEntries(map) }
  }
}

function loadSession(fetchImpl = async () => new Response('{}', { status: 200 })) {
  const storage = createStorage()
  const window = {
    location: {
      origin: 'http://localhost:5500',
      href: 'http://localhost:5500/dashboard.html',
      pathname: '/dashboard.html',
      replace() {}
    },
    __JESHA_API_URL__: 'http://localhost:3000',
    fetch: fetchImpl,
    dispatchEvent() {},
    jeshaToast() {}
  }
  const context = vm.createContext({
    window,
    localStorage: storage,
    Headers,
    Request,
    Response,
    URL,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } },
    console
  })
  vm.runInContext(SESSION_SOURCE, context, { filename: 'session.js' })
  return { session: window.jeshaSession, storage, window }
}

function adminUser(overrides = {}) {
  return {
    id: 1,
    nombre: 'Admin',
    username: 'admin',
    rol: 'ADMIN_SUCURSAL',
    empresaId: 10,
    sucursalId: 20,
    ...overrides
  }
}

describe('P0-FRONTEND-TENANT session', () => {
  it('inicia sesión tenant y guarda empresaSlug', () => {
    const { session, storage } = loadSession()
    session.start({ token: 'token', usuario: adminUser(), empresaSlug: 'empresa-a' })
    assert.strictEqual(session.isValid(), true)
    assert.strictEqual(session.getEmpresaSlug(), 'empresa-a')
    assert.strictEqual(storage.getItem('jesha_selected_sucursal_id'), '20')
  })

  it('guarda únicamente el usuario sanitizado sin secretos ni campos extra', () => {
    const { session, storage } = loadSession()
    session.start({
      token: 'token', empresaSlug: 'empresa-a',
      usuario: adminUser({ passwordHash: 'secret', pin: '1234', extra: true })
    })
    const stored = JSON.parse(storage.getItem('jesha_usuario'))
    assert.deepStrictEqual(Object.keys(stored).sort(), [
      'Sucursal', 'empresaId', 'id', 'nombre', 'rol', 'sucursalId', 'tema', 'username'
    ])
    assert.strictEqual(stored.passwordHash, undefined)
    assert.strictEqual(stored.pin, undefined)
  })

  it('rechaza identificadores fuera del rango PostgreSQL Int', () => {
    const { session } = loadSession()
    assert.throws(() => session.start({
      token: 'token', empresaSlug: 'empresa-a',
      usuario: adminUser({ id: 2147483648 })
    }), /Sesión tenant inválida/)
  })

  it('SUPERADMIN inicia sin sucursal seleccionada', () => {
    const { session, storage } = loadSession()
    storage.setItem('jesha_selected_sucursal_id', '999')
    session.start({
      token: 'token',
      empresaSlug: 'empresa-a',
      usuario: adminUser({ rol: 'SUPERADMIN', sucursalId: null })
    })
    assert.strictEqual(session.getSelectedSucursalId(), null)
    assert.strictEqual(storage.getItem('jesha_selected_sucursal_id'), null)
  })

  it('rechaza PLATFORM_ADMIN en el POS tenant', () => {
    const { session } = loadSession()
    assert.throws(() => session.start({
      token: 'token',
      empresaSlug: 'empresa-a',
      usuario: adminUser({ rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null })
    }), /Sesión tenant inválida/)
    assert.strictEqual(session.isValid(), false)
  })

  it('usuario fijo no puede cambiar sucursal', () => {
    const { session } = loadSession()
    session.start({ token: 'token', usuario: adminUser(), empresaSlug: 'empresa-a' })
    assert.throws(() => session.setSelectedSucursalId(21), /fija/)
    assert.strictEqual(session.getSelectedSucursalId(), 20)
  })

  it('SUPERADMIN puede seleccionar y limpiar sucursal', () => {
    const { session } = loadSession()
    session.start({
      token: 'token', empresaSlug: 'empresa-a',
      usuario: adminUser({ rol: 'SUPERADMIN', sucursalId: null })
    })
    assert.strictEqual(session.setSelectedSucursalId(21), 21)
    assert.strictEqual(session.getSelectedSucursalId(), 21)
    assert.strictEqual(session.setSelectedSucursalId(null), null)
  })

  it('PRECIOS global puede seleccionar sucursal', () => {
    const { session } = loadSession()
    session.start({
      token: 'token', empresaSlug: 'empresa-a',
      usuario: adminUser({ rol: 'PRECIOS', sucursalId: null })
    })
    assert.strictEqual(session.canSelectSucursal(), true)
    assert.strictEqual(session.setSelectedSucursalId(22), 22)
  })

  it('clear elimina token, usuario, empresa y sucursal', () => {
    const { session, storage } = loadSession()
    session.start({ token: 'token', usuario: adminUser(), empresaSlug: 'empresa-a' })
    session.clear()
    assert.strictEqual(storage.getItem('jesha_token'), null)
    assert.strictEqual(storage.getItem('jesha_usuario'), null)
    assert.strictEqual(storage.getItem('jesha_empresa_slug'), null)
    assert.strictEqual(storage.getItem('jesha_selected_sucursal_id'), null)
  })
})

describe('P0-FRONTEND-TENANT fetch wrapper', () => {
  it('agrega Authorization y X-Sucursal-Id a llamadas del API', async () => {
    let seen = null
    const { session, window } = loadSession(async (input, init) => {
      seen = { input, headers: new Headers(init.headers) }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })
    session.start({ token: 'abc', usuario: adminUser(), empresaSlug: 'empresa-a' })
    await window.fetch('http://localhost:3000/ventas', { method: 'GET' })
    assert.strictEqual(seen.headers.get('Authorization'), 'Bearer abc')
    assert.strictEqual(seen.headers.get('X-Sucursal-Id'), '20')
  })

  it('no agrega credenciales a assets del frontend', async () => {
    let seen = null
    const { session, window } = loadSession(async (input, init = {}) => {
      seen = new Headers(init.headers)
      return new Response('ok', { status: 200 })
    })
    session.start({ token: 'abc', usuario: adminUser(), empresaSlug: 'empresa-a' })
    await window.fetch('http://localhost:5500/sidebar.html')
    assert.strictEqual(seen.get('Authorization'), null)
    assert.strictEqual(seen.get('X-Sucursal-Id'), null)
  })

  it('muestra el error 403 también para fetch directo', async () => {
    let toast = null
    const { session, window } = loadSession(async () => new Response(
      JSON.stringify({ error: 'Sucursal prohibida' }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    ))
    window.jeshaToast = (message, type) => { toast = { message, type } }
    session.start({ token: 'abc', usuario: adminUser(), empresaSlug: 'empresa-a' })
    const response = await window.fetch('http://localhost:3000/ventas')
    assert.strictEqual(response.status, 403)
    assert.deepStrictEqual(toast, { message: 'Sucursal prohibida', type: 'error' })
  })

  it('respeta headers explícitos', async () => {
    let seen = null
    const { session, window } = loadSession(async (input, init) => {
      seen = new Headers(init.headers)
      return new Response('{}', { status: 200 })
    })
    session.start({ token: 'abc', usuario: adminUser(), empresaSlug: 'empresa-a' })
    await window.fetch('http://localhost:3000/ventas', {
      headers: { Authorization: 'Bearer explicit', 'X-Sucursal-Id': '25' }
    })
    assert.strictEqual(seen.get('Authorization'), 'Bearer explicit')
    assert.strictEqual(seen.get('X-Sucursal-Id'), '25')
  })
})
