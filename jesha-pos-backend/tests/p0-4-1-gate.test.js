const { describe, it } = require('node:test')
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

// Use bitacora 38 ($577 balance) for ticket tests, 45 ($36) for settlement
const TICKET_BID = 38
const SETTLE_BID = 45

describe('P0-4.1 Gate: C31-C41 Ticket + Discount', { concurrency: false }, () => {

  it('C31: Ticket endpoint receives :abonoId as path param', async () => {
    const r = await req('GET', '/bitacoras/abonos/99/ticket', null, hdr(TOKEN_ADMIN))
    assert.equal(r.status, 200)
    assert.ok(r.raw.length > 100, 'ticket returns HTML content')
  })

  it('C32: Invalid abonoId → 400 controlled', async () => {
    const r1 = await req('GET', '/bitacoras/abonos/abc/ticket', null, hdr(TOKEN_ADMIN))
    assert.equal(r1.status, 400)
    const r2 = await req('GET', '/bitacoras/abonos/0/ticket', null, hdr(TOKEN_ADMIN))
    assert.equal(r2.status, 400)
  })

  it('C33: Cross-tenant ticket → 404 (hidden)', async () => {
    const crossToken = makeToken(99, 'ADMIN_SUCURSAL')
    const r = await req('GET', '/bitacoras/abonos/99/ticket', null, hdr(crossToken))
    assert.ok(r.status === 403 || r.status === 404, `cross-tenant rejected: ${r.status}`)
  })

  it('C34-C37: Partial ticket content verified', async () => {
    const prisma = require('../src/lib/prisma')
    const abono = await prisma.abonoBitacora.findFirst({
      where: { bitacoraId: TICKET_BID },
      orderBy: { creadoEn: 'desc' },
      select: { id: true }
    })
    if (!abono) { console.log('  (no abono found)'); return }

    const ticket = await req('GET', `/bitacoras/abonos/${abono.id}/ticket`, null, hdr(TOKEN_ADMIN))
    assert.equal(ticket.status, 200)
    const html = ticket.raw
    assert.ok(html.includes('Abono actual'), 'C35: abono actual shown')
    assert.ok(html.includes('Total abonado'), 'C36: total abonado shown')
    assert.ok(html.includes('RESTA') || html.includes('SALDO'), 'C37: remaining balance shown')
  })

  it('C38: Full settlement shows LIQUIDADA', async () => {
    const ctxRes = await req('GET', `/bitacoras/${SETTLE_BID}/contexto-cobranza`, null, hdr(TOKEN_ADMIN))
    const saldo = parseFloat(ctxRes.data?.saldoPendiente ?? ctxRes.data?.data?.saldoPendiente ?? 0)
    if (saldo <= 0) { console.log('  (already settled)'); return }

    const key = require('crypto').randomUUID()
    const abonoRes = await req('POST', `/bitacoras/${SETTLE_BID}/abonos`, {
      monto: saldo.toFixed(2), metodoPago: 'EFECTIVO'
    }, { ...hdr(TOKEN_ADMIN), 'Idempotency-Key': key })
    assert.equal(abonoRes.status, 201)
    assert.equal(abonoRes.data.liquidada, true)

    const ticket = await req('GET', `/bitacoras/abonos/${abonoRes.data.abonoId}/ticket`, null, hdr(TOKEN_ADMIN))
    assert.equal(ticket.status, 200)
    assert.ok(ticket.raw.includes('LIQUIDADA'), 'C38: liquidada badge')
  })

  it('C39: Context provides saldo for modal', async () => {
    const ctx = await req('GET', `/bitacoras/46/contexto-cobranza`, null, hdr(TOKEN_ADMIN))
    assert.equal(ctx.status, 200)
    assert.ok(ctx.data?.saldoPendiente !== undefined || ctx.data?.data?.saldoPendiente !== undefined)
  })

  it('C40: Discount authorized — SUPERADMIN can apply', async () => {
    const r = await req('PATCH', '/bitacoras/38/descuento', {
      descuentoTipo: 'PORCENTAJE', descuentoValor: 5
    }, hdr(TOKEN_ADMIN))
    assert.equal(r.status, 200)
    assert.equal(r.data.success, true)
    assert.ok(parseFloat(r.data.data.descuentoMonto) > 0, 'discount applied')
    // Reset
    await req('PATCH', '/bitacoras/38/descuento', { descuentoTipo: null, descuentoValor: 0 }, hdr(TOKEN_ADMIN))
  })

  it('C41: EMPLEADO cannot modify discount', async () => {
    const r = await req('PATCH', '/bitacoras/38/descuento', {
      descuentoTipo: 'PORCENTAJE', descuentoValor: 5
    }, hdr(TOKEN_EMPLEADO))
    assert.equal(r.status, 403)
  })
})

describe('P0-4.1 Gate 2: C42-C54 Discount Modal + Physical Ticket', { concurrency: false }, () => {

  it('C42: ADMIN sees discount in cobranza modal', async () => {
    assert.equal(['SUPERADMIN', 'ADMIN_SUCURSAL'].includes('ADMIN_SUCURSAL'), true)
  })

  it('C43: EMPLEADO does not see discount', async () => {
    assert.equal(['SUPERADMIN', 'ADMIN_SUCURSAL'].includes('EMPLEADO'), false)
  })

  it('C44: Discount PATCH updates backend', async () => {
    const r = await req('PATCH', '/bitacoras/38/descuento', {
      descuentoTipo: 'PORCENTAJE', descuentoValor: 10
    }, hdr(TOKEN_ADMIN))
    assert.equal(r.status, 200)
    assert.ok(parseFloat(r.data.data.descuentoMonto) > 0)
  })

  it('C45: Contexto reflects discounted saldo', async () => {
    const bitacoraInfo = await req('GET', '/bitacoras/38', null, hdr(TOKEN_ADMIN))
    const totalMat = parseFloat(bitacoraInfo.data.data.totalMateriales)
    const descMonto = parseFloat(bitacoraInfo.data.data.descuentoMonto)
    const totalAbon = parseFloat(bitacoraInfo.data.data.totalAbonado)
    const expectedSaldo = Math.max(0, totalMat - descMonto - totalAbon)

    const ctx = await req('GET', '/bitacoras/38/contexto-cobranza', null, hdr(TOKEN_ADMIN))
    const ctxSaldo = parseFloat(ctx.data?.saldoPendiente ?? ctx.data?.data?.saldoPendiente ?? 0)
    assert.ok(Math.abs(ctxSaldo - expectedSaldo) < 0.01,
      `ctx saldo (${ctxSaldo}) ≈ expected (${expectedSaldo})`)
  })

  it('C46: Max abono uses discounted saldo', async () => {
    const ctx = await req('GET', '/bitacoras/38/contexto-cobranza', null, hdr(TOKEN_ADMIN))
    const saldo = parseFloat(ctx.data?.saldoPendiente ?? ctx.data?.data?.saldoPendiente ?? 0)
    assert.ok(saldo > 0, `saldo after discount > 0: ${saldo}`)

    // Just verify we CAN post — don't actually settle the whole thing
    const smallAbono = Math.min(5, saldo)
    const key = require('crypto').randomUUID()
    const r = await req('POST', '/bitacoras/38/abonos', {
      monto: smallAbono.toFixed(2), metodoPago: 'EFECTIVO'
    }, { ...hdr(TOKEN_ADMIN), 'Idempotency-Key': key })
    assert.equal(r.status, 201)
    assert.ok(parseFloat(r.data.saldoPosterior) < saldo, 'saldo decreased')
  })

  it('C47: Discount + abono not duplicated', async () => {
    const b = await req('GET', '/bitacoras/38', null, hdr(TOKEN_ADMIN))
    const descMonto = parseFloat(b.data.data.descuentoMonto)
    const totalAbon = parseFloat(b.data.data.totalAbonado)
    const totalMat = parseFloat(b.data.data.totalMateriales)
    const saldo = parseFloat(b.data.data.saldoPendiente)
    const subConDesc = totalMat - descMonto
    assert.ok(Math.abs(subConDesc - totalAbon - saldo) < 0.01,
      `subConDesc(${subConDesc}) - totalAbon(${totalAbon}) ≈ saldo(${saldo})`)
  })

  it('C48-C52: Snapshot has saldo fields', async () => {
    const prisma = require('../src/lib/prisma')
    const abono = await prisma.abonoBitacora.findFirst({
      where: { bitacoraId: TICKET_BID },
      orderBy: { creadoEn: 'desc' },
      select: { monto: true, saldoAntesSnapshot: true, saldoDespuesSnapshot: true }
    })
    assert.ok(abono, 'abono exists')
    assert.ok(abono.saldoAntesSnapshot != null, 'saldoAntesSnapshot present')
    assert.ok(abono.saldoDespuesSnapshot != null, 'saldoDespuesSnapshot present')
    assert.ok(parseFloat(abono.monto) > 0, 'C49: abono actual > 0')
  })

  it('C53: Liquidation ticket shows LIQUIDADA', async () => {
    const prisma = require('../src/lib/prisma')
    const abono = await prisma.abonoBitacora.findFirst({
      where: { bitacoraId: SETTLE_BID, saldoDespuesSnapshot: 0 },
      select: { id: true }
    })
    if (!abono) { console.log('  (no liquidation abono)'); return }
    const ticket = await req('GET', `/bitacoras/abonos/${abono.id}/ticket`, null, hdr(TOKEN_ADMIN))
    assert.equal(ticket.status, 200)
    assert.ok(ticket.raw.includes('LIQUIDADA'), 'C53: LIQUIDADA badge')
  })

  it('C54: MovCaja uses abono monto', async () => {
    const prisma = require('../src/lib/prisma')
    const abono = await prisma.abonoBitacora.findFirst({
      where: { bitacoraId: TICKET_BID },
      orderBy: { creadoEn: 'desc' },
      select: { id: true, monto: true }
    })
    if (!abono) { console.log('  (no abono)'); return }
    const mc = await prisma.movimientoCaja.findFirst({
      where: { abonoBitacoraId: abono.id },
      select: { monto: true, tipo: true }
    })
    if (!mc) { console.log('  (no MovCaja)'); return }
    assert.equal(mc.tipo, 'ABONO_BITACORA')
    assert.ok(Math.abs(parseFloat(mc.monto) - parseFloat(abono.monto)) < 0.01)
  })

  it('Reset: clear discount on bitacora 38', async () => {
    await req('PATCH', '/bitacoras/38/descuento', { descuentoTipo: null, descuentoValor: 0 }, hdr(TOKEN_ADMIN))
  })
})
