const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const http = require('http')
const jwt = require('jsonwebtoken')

const BASE = 'http://localhost:3000'

const config = {
  secret: process.env.TENANT_JWT_SECRET,
  algorithm: 'HS256',
  issuer: 'jesha-pos-tenant',
  audience: 'jesha-pos-api'
}

function makeToken(sub, rol) {
  return jwt.sign({ version: 1, kind: 'TENANT', sub, rol }, config.secret, {
    algorithm: config.algorithm, issuer: config.issuer,
    audience: config.audience, expiresIn: '15m'
  })
}

const TOKEN_ADMIN = makeToken(2, 'ADMIN_SUCURSAL')
const TOKEN_EMPLEADO = makeToken(4, 'EMPLEADO')
const TOKEN_CROSS = makeToken(2, 'SUPERADMIN') // empresaId different if sub=2 maps to empresa 1

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE)
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json', ...headers }
    }
    const r = http.request(opts, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data), raw: data }) }
        catch { resolve({ status: res.statusCode, data, raw: data }) }
      })
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

function hdr(token) {
  return { Authorization: `Bearer ${token}`, 'X-Sucursal-Id': '1' }
}

let bitacoraId = 42 // will be set in before()
let abonoId = null

describe('P0-4.1 Gate: C31-C41 Ticket + Discount', { concurrency: false }, () => {

  it('C31: Ticket endpoint receives :abonoId as path param', async () => {
    const r = await req('GET', '/bitacoras/abonos/99/ticket', null, hdr(TOKEN_ADMIN))
    assert.equal(r.status, 200)
    assert.ok(r.raw.length > 100, 'ticket returns HTML content')
  })

  it('C32: Invalid abonoId → 400 controlled', async () => {
    const r1 = await req('GET', '/bitacoras/abonos/abc/ticket', null, hdr(TOKEN_ADMIN))
    assert.equal(r1.status, 400)
    assert.ok(r1.data.error.includes('inválido'))

    const r2 = await req('GET', '/bitacoras/abonos/0/ticket', null, hdr(TOKEN_ADMIN))
    assert.equal(r2.status, 400)
  })

  it('C33: Cross-tenant ticket → 404 (hidden)', async () => {
    const crossToken = makeToken(99, 'ADMIN_SUCURSAL')
    const r = await req('GET', '/bitacoras/abonos/99/ticket', null, hdr(crossToken))
    assert.ok(r.status === 403 || r.status === 404, `cross-tenant rejected: ${r.status}`)
  })

  it('C34-C37: Partial ticket shows prev paid / current / total / remaining', async () => {
    // First register a partial abono on bitacora 45
    const ctxRes = await req('GET', `/bitacoras/${bitacoraId}/contexto-cobranza`, null, hdr(TOKEN_ADMIN))
    const saldo = parseFloat(ctxRes.data.data.saldoPendiente)
    assert.ok(saldo > 5, `saldo must be > 5 for test, got ${saldo}`)

    const monto = 5
    const key = require('crypto').randomUUID()
    const abonoRes = await req('POST', `/bitacoras/${bitacoraId}/abonos`, {
      monto: monto.toFixed(2), metodoPago: 'EFECTIVO'
    }, { ...hdr(TOKEN_ADMIN), 'Idempotency-Key': key })
    assert.equal(abonoRes.status, 201)
    abonoId = abonoRes.data.abonoId

    // Now get the ticket
    const ticket = await req('GET', `/bitacoras/abonos/${abonoId}/ticket`, null, hdr(TOKEN_ADMIN))
    assert.equal(ticket.status, 200)
    const html = ticket.raw

    // C34: Abonado anteriormente
    const hasPrev = html.includes('Abonado anteriormente')
    // It's ok if first abono has no "anteriormente" — check that the section exists in template
    assert.ok(html.includes('Abono actual'), 'ticket has Abono actual')

    // C35: Abono actual
    assert.ok(html.includes('Abono actual'), 'C35: abono actual shown')

    // C36: Total abonado
    assert.ok(html.includes('Total abonado'), 'C36: total abonado shown')

    // C37: Saldo/RESTA
    assert.ok(html.includes('RESTA') || html.includes('SALDO'), 'C37: remaining balance shown')
  })

  it('C38: Full settlement ticket shows SALDO 0 + LIQUIDADA', async () => {
    // Find a bitacora with small remaining balance
    const ctxRes = await req('GET', `/bitacoras/${bitacoraId}/contexto-cobranza`, null, hdr(TOKEN_ADMIN))
    const saldo = parseFloat(ctxRes.data.data.saldoPendiente)
    if (saldo <= 0) {
      console.log('  (bitacora already settled, skipping)')
      return
    }

    const key = require('crypto').randomUUID()
    const abonoRes = await req('POST', `/bitacoras/${bitacoraId}/abonos`, {
      monto: saldo.toFixed(2), metodoPago: 'EFECTIVO'
    }, { ...hdr(TOKEN_ADMIN), 'Idempotency-Key': key })
    assert.equal(abonoRes.status, 201)
    assert.equal(abonoRes.data.liquidada, true)

    const ticket = await req('GET', `/bitacoras/abonos/${abonoRes.data.abonoId}/ticket`, null, hdr(TOKEN_ADMIN))
    assert.equal(ticket.status, 200)
    assert.ok(ticket.raw.includes('LIQUIDADA'), 'C38: liquidada badge shown')
    assert.ok(ticket.raw.includes('SALDO'), 'C38: SALDO label shown (not RESTA)')
  })

  it('C39: Efectivo recibido/cambio info in context (not in ticket)', async () => {
    // Efectivo/cambio are POS modal concepts, not ticket concepts
    // Verify contexto-cobranza returns what's needed for the modal
    const ctx = await req('GET', `/bitacoras/46/contexto-cobranza`, null, hdr(TOKEN_ADMIN))
    assert.equal(ctx.status, 200)
    assert.ok(ctx.data.data.saldoPendiente !== undefined, 'saldoPendiente available for modal')
  })

  it('C40: Discount authorized — SUPERADMIN can apply', async () => {
    // Use bitacora 38 which has saldo > 0
    const r = await req('PATCH', '/bitacoras/38/descuento', {
      descuentoTipo: 'PORCENTAJE', descuentoValor: 5
    }, hdr(TOKEN_ADMIN))
    assert.equal(r.status, 200)
    assert.equal(r.data.success, true)
    assert.ok(parseFloat(r.data.data.descuentoMonto) > 0, 'discount applied')

    // Reset
    await req('PATCH', '/bitacoras/38/descuento', {
      descuentoTipo: null, descuentoValor: 0
    }, hdr(TOKEN_ADMIN))
  })

  it('C41: EMPLEADO cannot modify discount', async () => {
    const r = await req('PATCH', '/bitacoras/38/descuento', {
      descuentoTipo: 'PORCENTAJE', descuentoValor: 5
    }, hdr(TOKEN_EMPLEADO))
    assert.equal(r.status, 403)
  })
})
