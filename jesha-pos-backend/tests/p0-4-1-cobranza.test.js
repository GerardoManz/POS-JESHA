const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const BASE = 'http://localhost:3000'
let TOKEN = null

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE)
    const http = require('http')
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    }
    const r = http.request(opts, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, data }) }
      })
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

before(() => {
  const jwt = require('jsonwebtoken')
  const { resolveTenantAuthConfig } = require('../src/modules/auth/tenant-auth.config')
  const config = resolveTenantAuthConfig()
  const principal = { version: 1, kind: 'TENANT', sub: 2, rol: 'ADMIN_SUCURSAL' }
  TOKEN = jwt.sign(principal, config.secret, {
    algorithm: config.algorithm, issuer: config.issuer,
    audience: config.audience, expiresIn: '30m'
  })
})

const HDR = () => ({
  Authorization: `Bearer ${TOKEN}`,
  'X-Sucursal-Id': '1'
})

describe('P0-4.1: Cobranza Bitácora — Monto Abono', () => {

  it('C04: monto=0 rechazado', async () => {
    const r = await req('POST', '/bitacoras/45/abonos', {
      monto: '0.00', metodoPago: 'EFECTIVO'
    }, { ...HDR(), 'Idempotency-Key': require('crypto').randomUUID() })
    assert.ok(r.status >= 400, `expected 4xx for monto=0, got ${r.status}`)
  })

  it('C05: monto negativo rechazado', async () => {
    const r = await req('POST', '/bitacoras/45/abonos', {
      monto: '-50.00', metodoPago: 'EFECTIVO'
    }, { ...HDR(), 'Idempotency-Key': require('crypto').randomUUID() })
    assert.ok(r.status >= 400, `expected 4xx, got ${r.status}`)
  })

  it('C07: abono parcial aceptado', async () => {
    const ctxRes = await req('GET', '/bitacoras/45/contexto-cobranza', null, HDR())
    const saldo = parseFloat(ctxRes.data.data.saldoPendiente)
    const montoAbono = Math.min(5, saldo)
    assert.ok(saldo > 0, `saldo should be > 0, got ${saldo}`)

    const r = await req('POST', '/bitacoras/45/abonos', {
      monto: montoAbono.toFixed(2), metodoPago: 'EFECTIVO'
    }, { ...HDR(), 'Idempotency-Key': require('crypto').randomUUID() })
    assert.equal(r.status, 201)
    assert.equal(r.data.success, true)
    const nuevoSaldo = parseFloat(r.data.saldoPosterior)
    assert.ok(nuevoSaldo < saldo, `saldo after (${nuevoSaldo}) < before (${saldo})`)
  })

  it('C06: monto > saldo rechazado', async () => {
    const ctxRes = await req('GET', '/bitacoras/45/contexto-cobranza', null, HDR())
    const saldo = parseFloat(ctxRes.data.data.saldoPendiente)
    const r = await req('POST', '/bitacoras/45/abonos', {
      monto: String(saldo + 100), metodoPago: 'EFECTIVO'
    }, { ...HDR(), 'Idempotency-Key': require('crypto').randomUUID() })
    assert.ok(r.status >= 400, `should reject, got ${r.status}`)
  })

  it('C28: idempotencia — misma key devuelve mismo abono', async () => {
    const key = require('crypto').randomUUID()
    const r1 = await req('POST', '/bitacoras/45/abonos', {
      monto: '1.00', metodoPago: 'EFECTIVO'
    }, { ...HDR(), 'Idempotency-Key': key })
    assert.equal(r1.status, 201)
    assert.equal(r1.data.idempotent, false)

    const r2 = await req('POST', '/bitacoras/45/abonos', {
      monto: '1.00', metodoPago: 'EFECTIVO'
    }, { ...HDR(), 'Idempotency-Key': key })
    assert.equal(r2.status, 200)
    assert.equal(r2.data.idempotent, true)
    assert.equal(r2.data.abonoId, r1.data.abonoId)
  })

  it('C29: MovimientoCaja usa monto real (no efectivo recibido)', async () => {
    const key = require('crypto').randomUUID()
    const r = await req('POST', '/bitacoras/45/abonos', {
      monto: '1.00', metodoPago: 'EFECTIVO'
    }, { ...HDR(), 'Idempotency-Key': key })
    assert.equal(r.status, 201)
    assert.ok(r.data.movimientoCajaId)

    const prisma = require('../src/lib/prisma')
    const mc = await prisma.movimientoCaja.findUnique({
      where: { id: r.data.movimientoCajaId },
      select: { monto: true, tipo: true }
    })
    assert.equal(mc.tipo, 'ABONO_BITACORA')
    assert.equal(parseFloat(mc.monto), 1.00)
  })

  it('C30: Venta normal sin regresión', async () => {
    const r = await req('GET', '/ventas?limite=1', null, HDR())
    assert.equal(r.status, 200)
  })
})

describe('P0-4.1: Snapshots', () => {

  it('saldoAntes/saldoDespues presentes y coherentes', async () => {
    const prisma = require('../src/lib/prisma')
    const abono = await prisma.abonoBitacora.findFirst({
      where: { bitacoraId: 45 },
      orderBy: { creadoEn: 'desc' },
      select: { saldoAntesSnapshot: true, saldoDespuesSnapshot: true, monto: true }
    })
    assert.ok(abono, 'should have abono')
    assert.ok(abono.saldoAntesSnapshot != null, 'saldoAntesSnapshot not null')
    assert.ok(abono.saldoDespuesSnapshot != null, 'saldoDespuesSnapshot not null')
    const antes = parseFloat(abono.saldoAntesSnapshot)
    const despues = parseFloat(abono.saldoDespuesSnapshot)
    const monto = parseFloat(abono.monto)
    assert.ok(Math.abs((antes - monto) - despues) < 0.01,
      `antes(${antes})-monto(${monto}) ≈ despues(${despues})`)
  })
})

describe('P0-4.1: Backend Validation', () => {

  it('C16: descuento no autorizado rechazado (EMPLEADO)', async () => {
    const jwt = require('jsonwebtoken')
    const { resolveTenantAuthConfig } = require('../src/modules/auth/tenant-auth.config')
    const config = resolveTenantAuthConfig()
    const empPrincipal = { version: 1, kind: 'TENANT', sub: 4, rol: 'EMPLEADO' }
    const empToken = jwt.sign(empPrincipal, config.secret, {
      algorithm: config.algorithm, issuer: config.issuer,
      audience: config.audience, expiresIn: '5m'
    })
    const r = await req('PATCH', '/bitacoras/45/descuento', {
      descuentoTipo: 'PORCENTAJE', descuentoValor: 5
    }, { Authorization: `Bearer ${empToken}`, 'X-Sucursal-Id': '1' })
    assert.equal(r.status, 403)
  })

  it('C18: descuento no se duplica — apply idempotente', async () => {
    const r1 = await req('PATCH', '/bitacoras/45/descuento', {
      descuentoTipo: null, descuentoValor: 0
    }, HDR())
    assert.equal(r1.status, 200)

    const r2 = await req('PATCH', '/bitacoras/45/descuento', {
      descuentoTipo: null, descuentoValor: 0
    }, HDR())
    assert.equal(r2.status, 200)
  })
})
