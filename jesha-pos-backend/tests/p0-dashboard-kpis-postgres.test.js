'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const path = require('node:path')
const http = require('node:http')
const pg = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const BACKEND_DIR = 'C:/Proyecto ferre/Ferreteria JESHA/jesha-pos-backend'
const DB_PREFIX = 'jesha_p0_dashboard_kpis_'
const DB_RE = /^jesha_p0_dashboard_kpis_[a-z0-9_]+$/
const TENANT_SECRET = 'dashboard-kpis-secret-'.padEnd(64, 'k')

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Falta: ${name}`)
  return value
}
function resolvePgConfig() {
  const host = requiredEnv('P0_TEST_PG_HOST')
  return Object.freeze({ user: requiredEnv('P0_TEST_PG_USER'), password: requiredEnv('P0_TEST_PG_PASSWORD'), host, port: Number(requiredEnv('P0_TEST_PG_PORT')) })
}
function validateDbName(name) { if (!DB_RE.test(name) || name === DB_PREFIX) throw new Error('DB temporal invalida'); return name }
function connectionUrl(config, dbName) {
  const h = config.host === '::1' ? '[::1]' : config.host
  return `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${h}:${config.port}/${encodeURIComponent(dbName)}`
}
function dbPush(databaseUrl) {
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  const args = ['prisma', 'db', 'push', '--schema', 'prisma/schema.prisma']
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], { cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000 })
    return
  }
  execFileSync('npx', args, { cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000 })
}

describe('P0-DASHBOARD-KPIS FIXED PostgreSQL HTTP', { concurrency: 1, timeout: 300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig, 'postgres'), max: 1 })
  let created = false, prisma, app, server, baseUrl

  let empresaA, empresaB, empresaC
  let sucursalA1, sucursalA2, sucursalB1
  let superA, adminA1, superB, superC
  let turnoA1, turnoA2, turnoB1

  function signToken(userId, rol, empresaId, sucursalId = null) {
    return jwt.sign(
      { version: 1, kind: 'TENANT', sub: userId, rol, empresaId, sucursalId },
      TENANT_SECRET,
      { algorithm: 'HS256', expiresIn: '30m', issuer: 'dashboard-test', audience: 'dashboard-test-api' }
    )
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = 'dashboard-test'
    process.env.TENANT_JWT_AUDIENCE = 'dashboard-test-api'
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'dashboard-plat-secret-'.padEnd(64, 'p')
    process.env.PLATFORM_JWT_ISSUER = 'dashboard-plat-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'dashboard-plat-api-test'
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
    process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
    process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'
    process.env.DEBUG_ENABLED = 'false'

    await adminPool.query(`CREATE DATABASE "${dbName}"`)
    created = true
    dbPush(databaseUrl)

    prisma = require('../src/lib/prisma')
    const hash = await bcrypt.hash('password', 10)

    empresaA = await prisma.empresa.create({ data: { slug: 'kpis-a', nombreComercial: 'Empresa A', razonSocial: 'Empresa A SA', whatsapp: '0000000001', activa: true } })
    empresaB = await prisma.empresa.create({ data: { slug: 'kpis-b', nombreComercial: 'Empresa B', razonSocial: 'Empresa B SA', whatsapp: '0000000002', activa: true } })
    empresaC = await prisma.empresa.create({ data: { slug: 'kpis-c', nombreComercial: 'Empresa C', razonSocial: 'Empresa C SA', whatsapp: '0000000003', activa: true } })

    sucursalA1 = await prisma.sucursal.create({ data: { empresaId: empresaA.id, nombre: 'A1', codigoPostal: '00001', activa: true } })
    sucursalA2 = await prisma.sucursal.create({ data: { empresaId: empresaA.id, nombre: 'A2', codigoPostal: '00002', activa: true } })
    sucursalB1 = await prisma.sucursal.create({ data: { empresaId: empresaB.id, nombre: 'B1', codigoPostal: '00003', activa: true } })

    superA = await prisma.usuario.create({ data: { nombre: 'Super A', username: 'kpis.supa', passwordHash: hash, rol: 'SUPERADMIN', activo: true, empresaId: empresaA.id, sucursalId: null } })
    adminA1 = await prisma.usuario.create({ data: { nombre: 'Admin A1', username: 'kpis.adma1', passwordHash: hash, rol: 'ADMIN_SUCURSAL', activo: true, empresaId: empresaA.id, sucursalId: sucursalA1.id } })
    superB = await prisma.usuario.create({ data: { nombre: 'Super B', username: 'kpis.supb', passwordHash: hash, rol: 'SUPERADMIN', activo: true, empresaId: empresaB.id, sucursalId: null } })
    superC = await prisma.usuario.create({ data: { nombre: 'Super C', username: 'kpis.supc', passwordHash: hash, rol: 'SUPERADMIN', activo: true, empresaId: empresaC.id, sucursalId: null } })

    turnoA1 = await prisma.turnoCaja.create({ data: { empresaId: empresaA.id, sucursalId: sucursalA1.id, usuarioId: adminA1.id, montoInicial: 500, abierto: true } })
    turnoA2 = await prisma.turnoCaja.create({ data: { empresaId: empresaA.id, sucursalId: sucursalA2.id, usuarioId: superA.id, montoInicial: 300, abierto: true } })
    turnoB1 = await prisma.turnoCaja.create({ data: { empresaId: empresaB.id, sucursalId: sucursalB1.id, usuarioId: superB.id, montoInicial: 400, abierto: true } })

    const hoy = new Date()
    const hoyInicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 9, 0, 0)
    const hoyMedio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12, 0, 0)
    const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1, 15, 0, 0)

    await prisma.venta.create({ data: { empresaId: empresaA.id, folio: 'A1-001', sucursalId: sucursalA1.id, usuarioId: adminA1.id, turnoId: turnoA1.id, metodoPago: 'EFECTIVO', subtotal: 100, total: 100, tokenQr: 'tok-a1-1', creadaEn: hoyInicio } })
    await prisma.venta.create({ data: { empresaId: empresaA.id, folio: 'A1-002', sucursalId: sucursalA1.id, usuarioId: adminA1.id, turnoId: turnoA1.id, metodoPago: 'TRANSFERENCIA', subtotal: 50, total: 50, tokenQr: 'tok-a1-2', creadaEn: hoyMedio } })
    await prisma.venta.create({ data: { empresaId: empresaA.id, folio: 'A1-003', sucursalId: sucursalA1.id, usuarioId: adminA1.id, turnoId: turnoA1.id, metodoPago: 'EFECTIVO', subtotal: 200, total: 200, tokenQr: 'tok-a1-3', creadaEn: ayer } })
    await prisma.venta.create({ data: { empresaId: empresaA.id, folio: 'A2-001', sucursalId: sucursalA2.id, usuarioId: superA.id, turnoId: turnoA2.id, metodoPago: 'EFECTIVO', subtotal: 80, total: 80, tokenQr: 'tok-a2-1', creadaEn: hoyMedio } })
    await prisma.venta.create({ data: { empresaId: empresaB.id, folio: 'B1-001', sucursalId: sucursalB1.id, usuarioId: superB.id, turnoId: turnoB1.id, metodoPago: 'CREDITO', subtotal: 300, total: 300, tokenQr: 'tok-b1-1', creadaEn: hoyMedio } })

    await prisma.movimientoCaja.create({ data: { empresaId: empresaA.id, turnoId: turnoA1.id, tipo: 'ABONO_BITACORA', monto: 25, creadoEn: hoyMedio } })
    await prisma.movimientoCaja.create({ data: { empresaId: empresaA.id, turnoId: turnoA2.id, tipo: 'ABONO_BITACORA', monto: 15, creadoEn: hoyMedio } })
    await prisma.movimientoCaja.create({ data: { empresaId: empresaB.id, turnoId: turnoB1.id, tipo: 'ABONO_BITACORA', monto: 60, creadoEn: hoyMedio } })

    const ventaA1 = await prisma.venta.findFirst({ where: { folio: 'A1-001' } })
    await prisma.devolucion.create({ data: { empresaId: empresaA.id, ventaId: ventaA1.id, sucursalId: sucursalA1.id, usuarioId: adminA1.id, motivo: 'Test', tipoReembolso: 'REEMBOLSO', montoReembolso: 10, creadaEn: hoyMedio } })

    app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve() }) })

    initTokens()
  })

  after(async () => {
    if (server) { try { await new Promise((r) => server.close(r)) } catch (e) {} }
    if (prisma) { try { await prisma.$disconnect() } catch (e) {} }
    await new Promise((r) => setTimeout(r, 1500))
    delete require.cache[require.resolve('../src/app')]
    delete require.cache[require.resolve('../src/lib/prisma')]
    if (created) {
      try { await adminPool.query(`DROP DATABASE "${dbName}"`) } catch (e) {}
    }
    try { await adminPool.end() } catch (e) {}
  })

  async function kpis(token, { sucursalId, desde, hasta, xSucursal } = {}) {
    const qs = new URLSearchParams()
    if (sucursalId !== undefined) qs.append('sucursalId', String(sucursalId))
    if (desde !== undefined) qs.append('desde', desde)
    if (hasta !== undefined) qs.append('hasta', hasta)
    const url = `${baseUrl}/ventas/dashboard-kpis${qs.toString() ? '?' + qs.toString() : ''}`
    const headers = { Authorization: `Bearer ${token}` }
    if (xSucursal !== undefined) headers['X-Sucursal-Id'] = String(xSucursal)
    const res = await fetch(url, { headers })
    const body = await res.json().catch(() => null)
    return { status: res.status, body }
  }

  let desdeISO, hastaISO

  // ── Helpers calculados después del seed ──
  let tSuperA, tAdminA1, tSuperB, tSuperC
  function initTokens() {
    const hoy = new Date()
    desdeISO = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
    hastaISO = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).toISOString()
    tSuperA = signToken(superA.id, 'SUPERADMIN', empresaA.id, null)
    tAdminA1 = signToken(adminA1.id, 'ADMIN_SUCURSAL', empresaA.id, sucursalA1.id)
    tSuperB = signToken(superB.id, 'SUPERADMIN', empresaB.id, null)
    tSuperC = signToken(superC.id, 'SUPERADMIN', empresaC.id, null)
  }

  // ════════════════════════════════════════════════════════════
  //  AISLAMIENTO: NONE (SUPERADMIN sin header X-Sucursal-Id)
  // ════════════════════════════════════════════════════════════
  it('1. A NONE: solo empresa A, consolida A1+A2', async () => {
    const r = await kpis(tSuperA, { desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 230)
    assert.strictEqual(r.body.ventasHoy.total, 220)
    assert.strictEqual(r.body.ventasHoy.devoluciones, 10)
    assert.strictEqual(r.body.ventasHoy.count, 3)
  })

  it('2. A NONE: ventasHistorico solo empresa A', async () => {
    const r = await kpis(tSuperA, { desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.ventasHistorico.count, 4)
  })

  it('3. A NONE: ventasRecientes no incluye B', async () => {
    const r = await kpis(tSuperA, { desde: desdeISO, hasta: hastaISO })
    const folios = r.body.ventasRecientes.map((v) => v.folio)
    assert.ok(!folios.includes('B1-001'))
  })

  it('4. A NONE: cobranza solo empresa A (25+15=40)', async () => {
    const r = await kpis(tSuperA, { desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.cobranzaHoy.total, 40)
    assert.strictEqual(r.body.cobranzaHoy.count, 2)
  })

  // ════════════════════════════════════════════════════════════
  //  AISLAMIENTO: SELECTED via X-Sucursal-Id
  // ════════════════════════════════════════════════════════════
  it('5. A SELECTED A1: solo sucursal A1', async () => {
    const r = await kpis(tSuperA, { xSucursal: sucursalA1.id, desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200, r.body && r.body.error)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 150)
    assert.strictEqual(r.body.ventasHoy.count, 2)
  })

  it('6. A SELECTED A2: solo sucursal A2', async () => {
    const r = await kpis(tSuperA, { xSucursal: sucursalA2.id, desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200, r.body && r.body.error)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 80)
    assert.strictEqual(r.body.ventasHoy.count, 1)
  })

  // ════════════════════════════════════════════════════════════
  //  AISLAMIENTO: FIXED (ADMIN_SUCURSAL)
  // ════════════════════════════════════════════════════════════
  it('7. Admin A1 FIXED: solo sucursal A1', async () => {
    const r = await kpis(tAdminA1, { desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200, r.body && r.body.error)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 150)
  })

  // ════════════════════════════════════════════════════════════
  //  CROSS-TENANT Y CROSS-BRANCH
  // ════════════════════════════════════════════════════════════
  it('8. Token A + header X-Sucursal-Id=B1 → 403', async () => {
    const r = await kpis(tSuperA, { xSucursal: sucursalB1.id, desde: desdeISO, hasta: hastaISO })
    assert.ok(r.status === 403, `esperado 403, recibió ${r.status}`)
  })

  it('9. Token A + query sucursalId=B1 → ignorado, NONE empresa A', async () => {
    const r = await kpis(tSuperA, { sucursalId: sucursalB1.id, desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 230)
  })

  // ════════════════════════════════════════════════════════════
  //  LEGACY QUERY IGNORADO (no debe romper)
  // ════════════════════════════════════════════════════════════
  it('10. Query sucursalId vacio → ignorado, 200', async () => {
    const r = await kpis(tSuperA, { sucursalId: '', desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 230)
  })

  it('11. Query sucursalId texto → ignorado, 200', async () => {
    const r = await kpis(tSuperA, { sucursalId: 'abc', desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 230)
  })

  it('12. Query sucursalId no existente → ignorado, 200', async () => {
    const r = await kpis(tSuperA, { sucursalId: 999999, desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 230)
  })

  // ════════════════════════════════════════════════════════════
  //  EMPRESA VACÍA
  // ════════════════════════════════════════════════════════════
  it('13. Empresa C sin operaciones → ceros reales', async () => {
    const r = await kpis(tSuperC, { desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.ventasHoy.totalBruto, 0)
    assert.strictEqual(r.body.ventasHoy.count, 0)
    assert.strictEqual(r.body.ventasHistorico.count, 0)
    assert.strictEqual(r.body.cobranzaHoy.total, 0)
  })

  // ════════════════════════════════════════════════════════════
  //  PLATFORM_ADMIN
  // ════════════════════════════════════════════════════════════
  it('14. PLATFORM_ADMIN → 401/403', async () => {
    const tok = jwt.sign({ version: 1, kind: 'PLATFORM', sub: 99999, rol: 'PLATFORM_ADMIN' }, TENANT_SECRET, { algorithm: 'HS256' })
    const r = await kpis(tok, { desde: desdeISO, hasta: hastaISO })
    assert.ok(r.status === 401 || r.status === 403, `recibió ${r.status}`)
  })

  // ════════════════════════════════════════════════════════════
  //  FECHAS
  // ════════════════════════════════════════════════════════════
  it('15. Sin desde/hasta (usa hoy) → 200', async () => {
    const r = await kpis(tSuperA)
    assert.strictEqual(r.status, 200)
  })

  it('16. Desde solo → 400', async () => {
    const r = await kpis(tSuperA, { desde: desdeISO })
    assert.strictEqual(r.status, 400)
  })

  it('17. Hasta solo → 400', async () => {
    const r = await kpis(tSuperA, { hasta: hastaISO })
    assert.strictEqual(r.status, 400)
  })

  it('18. Fechas vacias → 400', async () => {
    const r = await kpis(tSuperA, { desde: '', hasta: '' })
    assert.strictEqual(r.status, 400)
  })

  it('19. Fecha inválida → 400', async () => {
    const r = await kpis(tSuperA, { desde: 'not-a-date', hasta: '2024-01-01T00:00:00.000Z' })
    assert.strictEqual(r.status, 400)
  })

  it('20. Rango invertido → 400', async () => {
    const r = await kpis(tSuperA, { desde: hastaISO, hasta: desdeISO })
    assert.strictEqual(r.status, 400)
  })

  // ════════════════════════════════════════════════════════════
  //  RESPUESTA
  // ════════════════════════════════════════════════════════════
  it('21. Simetría: ventasHoy.total = totalBruto - devoluciones', async () => {
    const r = await kpis(tSuperA, { desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.body.ventasHoy.total, r.body.ventasHoy.totalBruto - r.body.ventasHoy.devoluciones)
  })

  it('22. Ventas recientes no excede take=8', async () => {
    const r = await kpis(tSuperA, { desde: desdeISO, hasta: hastaISO })
    assert.ok(r.body.ventasRecientes.length <= 8)
  })

  it('23. success true para respuestas válidas', async () => {
    const r = await kpis(tSuperA, { desde: desdeISO, hasta: hastaISO })
    assert.strictEqual(r.body.success, true)
  })
})
