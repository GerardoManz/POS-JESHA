'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const LOGIN_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'login.js'), 'utf8')
const LOGIN_HTML = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8')
const PLATFORM_LOGIN_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'platform-login.js'), 'utf8')

function element() {
  const listeners = {}
  return {
    value: '', textContent: '', className: '', hidden: false, checked: false,
    disabled: false, type: 'password', src: '', alt: '', style: {}, innerHTML: '',
    classList: { add() {}, remove() {} },
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler) },
    dispatch(type) { for (const handler of listeners[type] || []) handler({ type, preventDefault() {} }) },
    removeAttribute(name) { if (name === 'src') this.src = '' },
    insertAdjacentHTML() {},
    focus() {}
  }
}

function createEnv({ branding = {}, fetchImpl, rememberedSlug = null } = {}) {
  const elements = new Map()
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element())
    return elements.get(id)
  }
  const storage = new Map()
  if (rememberedSlug) storage.set('jesha_last_empresa_slug', rememberedSlug)
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  }
  const document = {
    documentElement: { style: { setProperty() {} } },
    getElementById: get,
    querySelector: selector => selector === '.btn-login' ? get('btn-login') : get(selector),
    createElement: () => element()
  }
  const window = {
    __JESHA_API_URL__: 'http://localhost:3000',
    location: { origin: 'http://localhost:5500', href: 'http://localhost:5500/login.html', pathname: '/login.html' },
    jeshaSession: { isValid: () => false, clear() {} },
    fetch: fetchImpl || (async () => new Response(JSON.stringify({ branding }), { status: 200 }))
  }
  const context = vm.createContext({
    window,
    document,
    localStorage,
    fetch: window.fetch,
    URL,
    Headers,
    Request,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    console
  })
  vm.runInContext(LOGIN_SOURCE, context, { filename: 'login.js' })
  get('login-brand-name').textContent = 'POS'
  get('login-brand-name').className = 'brand-name-neutral'
  get('login-brand-logo').hidden = true
  return { get, storage }
}

function brandingInput(env, value) {
  const input = env.get('empresa-slug')
  input.value = value
  input.dispatch('input')
  return input
}

const TENANT_A = { nombreComercial: 'Empresa A', logoUrl: 'https://cdn.example/a.png', colorPrimario: '#112233', colorSecundario: '#223344', colorAcento: '#334455' }
const TENANT_B = { nombreComercial: 'Empresa B', logoUrl: 'https://cdn.example/b.png', colorPrimario: '#445566', colorSecundario: '#556677', colorAcento: '#667788' }

describe('LOGIN-BRANDING-1', () => {
  it('LB01: no slug uses neutral branding', () => {
    const env = createEnv()
    assert.equal(env.get('login-brand-name').textContent, 'POS')
    assert.equal(env.get('login-brand-logo').hidden, true)
  })

  it('LB02-LB04: valid slug applies name, logo and colors', async () => {
    const env = createEnv({ branding: TENANT_A })
    brandingInput(env, 'empresa-a')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(env.get('login-brand-name').textContent, 'Empresa A')
    assert.equal(env.get('login-brand-name').className, 'brand-name-tenant')
    assert.equal(env.get('login-brand-logo').src, TENANT_A.logoUrl)
    env.get('login-brand-logo').onload()
    assert.equal(env.get('login-brand-logo').hidden, false)
  })

  it('LB05-LB06: invalid and malformed slugs reset neutral and do not storm requests', async () => {
    let calls = 0
    const env = createEnv({ fetchImpl: async () => { calls++; return new Response(JSON.stringify({ branding: TENANT_A })) } })
    brandingInput(env, 'empresa-a')
    await new Promise(resolve => setTimeout(resolve, 350))
    brandingInput(env, 'bad/slug')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(env.get('login-brand-name').textContent, 'POS')
    assert.equal(calls, 1)
  })

  it('LB07: remembered valid slug preloads visual branding only', async () => {
    const env = createEnv({ branding: TENANT_A, rememberedSlug: 'empresa-a' })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(env.get('empresa-slug').value, 'empresa-a')
    assert.equal(env.get('login-brand-name').textContent, 'Empresa A')
    assert.equal(env.storage.get('jesha_token'), undefined)
  })

  it('LB08: remembered invalid slug remains neutral', async () => {
    const env = createEnv({ rememberedSlug: 'bad/slug' })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(env.get('login-brand-name').textContent, 'POS')
    assert.equal(env.storage.get('jesha_last_empresa_slug'), undefined)
  })

  it('LB09-LB10: missing or broken logo falls back without a broken image', async () => {
    const env = createEnv({ branding: { ...TENANT_A, logoUrl: null } })
    brandingInput(env, 'empresa-a')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(env.get('login-brand-logo').hidden, true)

    const broken = createEnv({ branding: TENANT_A })
    brandingInput(broken, 'empresa-a')
    await new Promise(resolve => setTimeout(resolve, 350))
    broken.get('login-brand-logo').onerror()
    assert.equal(broken.get('login-brand-logo').hidden, true)
    assert.equal(broken.get('login-brand-logo').src, '')
    assert.equal(broken.get('login-brand-name').textContent, 'POS')
    assert.equal(broken.get('login-brand-name').className, 'brand-name-neutral')
  })

  it('LB11: network failure keeps login usable and neutral', async () => {
    const env = createEnv({ fetchImpl: async () => { throw new Error('ECONNRESET') } })
    brandingInput(env, 'empresa-a')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(env.get('login-brand-name').textContent, 'POS')
    assert.equal(env.get('login-form').disabled, false)
  })

  it('LB12-LB13: tenant switch and invalid reset remove previous branding', async () => {
    let current = TENANT_A
    const env = createEnv({ fetchImpl: async () => new Response(JSON.stringify({ branding: current })) })
    brandingInput(env, 'empresa-a')
    await new Promise(resolve => setTimeout(resolve, 350))
    current = TENANT_B
    brandingInput(env, 'empresa-b')
    assert.equal(env.get('login-brand-name').textContent, 'POS')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(env.get('login-brand-name').textContent, 'Empresa B')
    brandingInput(env, 'bad/slug')
    assert.equal(env.get('login-brand-name').textContent, 'POS')
  })

  it('LB14: slow A cannot overwrite fast B', async () => {
    const pending = new Map()
    const env = createEnv({ fetchImpl: url => new Promise(resolve => pending.set(url, resolve)) })
    brandingInput(env, 'empresa-a')
    await new Promise(resolve => setTimeout(resolve, 350))
    brandingInput(env, 'empresa-b')
    await new Promise(resolve => setTimeout(resolve, 350))
    const urls = [...pending.keys()]
    pending.get(urls[1])(new Response(JSON.stringify({ branding: TENANT_B }), { status: 200 }))
    await new Promise(resolve => setTimeout(resolve, 10))
    pending.get(urls[0])(new Response(JSON.stringify({ branding: TENANT_A }), { status: 200 }))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(env.get('login-brand-name').textContent, 'Empresa B')
  })

  it('LB15-LB17: branding remains visual and auth source is unchanged', () => {
    assert.match(LOGIN_SOURCE, /body: JSON\.stringify\(\{ empresaSlug, username, password \}\)/)
    assert.doesNotMatch(LOGIN_SOURCE, /empresaId\s*=.*branding/)
    assert.doesNotMatch(LOGIN_SOURCE, /branding.*token|token.*branding/)
  })

  it('LB18: branding request uses only encoded slug', () => {
    assert.match(LOGIN_SOURCE, /branding\?slug=\$\{encodeURIComponent\(slug\)\}/)
    assert.doesNotMatch(LOGIN_SOURCE, /branding\?.*(username|email|password)/)
  })

  it('LB19: platform login remains independent', () => {
    assert.doesNotMatch(PLATFORM_LOGIN_SOURCE, /jesha_last_empresa_slug|\/branding\?slug|logoUrl/)
  })

  it('LB20: technical branding errors are not rendered', () => {
    assert.doesNotMatch(LOGIN_SOURCE, /errorBox\.textContent\s*=\s*error\.message/)
    assert.doesNotMatch(LOGIN_SOURCE, /loginBrandName\.innerHTML/)
  })

  it('LB21: company name uses textContent', () => {
    assert.match(LOGIN_SOURCE, /loginBrandName\.textContent = nombre \|\| 'POS'/)
    assert.doesNotMatch(LOGIN_SOURCE, /nombreComercial.*innerHTML/)
  })

  it('LB22: invalid colors use neutral defaults', () => {
    assert.match(LOGIN_SOURCE, /COLOR_RE = \/\^#\[0-9a-f\]\{6\}\$\/i/)
    assert.match(LOGIN_SOURCE, /colorSeguro\(data\.colorPrimario, BRANDING_DEFAULTS\.colorPrimario\)/)
    assert.match(LOGIN_SOURCE, /colorSeguro\(data\.colorAcento, BRANDING_DEFAULTS\.colorAcento\)/)
  })

  it('rejects executable and data URL schemes before assigning the logo source', async () => {
    for (const unsafeUrl of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'data:image/svg+xml;base64,AAAA']) {
      const env = createEnv({ branding: { ...TENANT_A, logoUrl: unsafeUrl } })
      brandingInput(env, 'empresa-a')
      await new Promise(resolve => setTimeout(resolve, 350))
      assert.equal(env.get('login-brand-logo').src, '')
      assert.equal(env.get('login-brand-logo').hidden, true)
    }
  })

  it('preserves current login DOM and mobile logo constraints', () => {
    assert.match(LOGIN_HTML, /id="empresa-slug"/)
    assert.match(LOGIN_HTML, /id="login-brand-name"/)
    assert.match(LOGIN_HTML, /id="login-brand-logo"/)
    const css = fs.readFileSync(path.join(__dirname, '..', 'login.css'), 'utf8')
    assert.match(css, /max-height: 72px/)
    assert.match(css, /object-fit: contain/)
  })
})
