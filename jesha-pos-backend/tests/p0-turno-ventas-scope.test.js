'use strict'

const { assertSafeTestDb } = require('./helpers/test-db-safety')
// P0-TURNO-VENTAS-SCOPE — Pruebas PostgreSQL HTTP.
// Verifica que turnos y ventas estén correctamente scoped por tenant y que
// un usuario tenant existente pueda abrir turno y vender SIN enviar empresaId
// manualmente por body/query.
const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const path = require('node:path')
const http = require('node:http')
const pg = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const { applyManualSql } = require('./helpers/apply-manual-sql')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_p0_turnos_scope_'
const DB_RE = /^jesha_p0_turnos_scope_[a-z0-9_]+$/
const TENANT_SECRET = 'turnos-scope-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-turnos-scope-test'
const TENANT_AUDIENCE = 'jesha-turnos-scope-api-test'

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Falta: ${name}`)
  return value
}
function resolvePgConfig() {
  const host = requiredEnv('P0_TEST_PG_HOST')
  if (!['localhost','127.0.0.1','::1'].includes(host)) throw new Error('P0_TEST_PG_HOST local')
  return Object.freeze({ user: requiredEnv('P0_TEST_PG_USER'), password: requiredEnv('P0_TEST_PG_PASSWORD'), host, port: Number(requiredEnv('P0_TEST_PG_PORT')) })
}
function validateDbName(name) { if (!DB_RE.test(name) || name === DB_PREFIX) throw new Error('DB temporal invalida'); return name }
function connectionUrl(config, dbName) {
  const h = config.host === '::1' ? '[::1]' : config.host
  return `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${h}:${config.port}/${encodeURIComponent(dbName)}`
}
function dbPush(databaseUrl) {
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  const args = ['prisma','db','push','--schema','prisma/schema.prisma']
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec||'cmd.exe', ['/d','/s','/c',`npx ${args.join(' ')}`], { cwd: BACKEND_DIR, env, stdio:'pipe', timeout:120000 })
    return
  }
  execFileSync('npx', args, { cwd: BACKEND_DIR, env, stdio:'pipe', timeout:120000 })
}

describe('P0-TURNO-VENTAS-SCOPE PostgreSQL HTTP', { concurrency:1, timeout:300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  assertSafeTestDb(databaseUrl)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig,'postgres'), max:1 })
  let created = false, prisma, app, server, baseUrl

  let empresaA, empresaB, sucursalA1, sucursalA2, sucursalB1
  let deptoA, catA
  let empleadoA1, empleadoB1, superA, superB, preciosa
  let productoA1
  let tokenEmpleadoA1, tokenSuperA, tokenSuperB, tokenPreciosa

  function signToken(userId, rol) {
    return jwt.sign({ version:1, kind:'TENANT', sub:userId, rol }, TENANT_SECRET, { algorithm:'HS256', issuer:TENANT_ISSUER, audience:TENANT_AUDIENCE, expiresIn:'30m' })
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'turnos-scope-platform-secret-'.padEnd(64,'p')
    process.env.PLATFORM_JWT_ISSUER = 'turnos-scope-platform-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'turnos-scope-platform-api-test'
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
    process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
    process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'
    process.env.DEBUG_ENABLED = 'false'

    await adminPool.query(`CREATE DATABASE "${dbName}"`)
    created = true
    dbPush(databaseUrl)

    prisma = require('../src/lib/prisma')
    if (prisma?.pool && !prisma.pool.__p0ErrorGuard) { prisma.pool.__p0ErrorGuard = true; prisma.pool.on('error', () => {}) }
    const hash = await bcrypt.hash('password', 10)

    await applyManualSql((sql) => prisma.$executeRawUnsafe(sql))

    // ── Empresas ──
    empresaA = await prisma.empresa.create({ data: { slug:'tv-a', nombreComercial:'Turno A', razonSocial:'Turno A SA', whatsapp:'0000000011', activa:true } })
    empresaB = await prisma.empresa.create({ data: { slug:'tv-b', nombreComercial:'Turno B', razonSocial:'Turno B SA', whatsapp:'0000000012', activa:true } })

    // ── Sucursales ──
    sucursalA1 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'A1', codigoPostal:'00011', activa:true } })
    sucursalA2 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'A2', codigoPostal:'00012', activa:true } })
    sucursalB1 = await prisma.sucursal.create({ data: { empresaId:empresaB.id, nombre:'B1', codigoPostal:'00013', activa:true } })

    // ── Usuarios ──
    empleadoA1 = await prisma.usuario.create({ data: { nombre:'Empleado A1', username:'temp.a1', passwordHash:hash, rol:'EMPLEADO', activo:true, empresaId:empresaA.id, sucursalId:sucursalA1.id } })
    superA     = await prisma.usuario.create({ data: { nombre:'Super A', username:'tsup.a', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaA.id, sucursalId:null } })
    superB     = await prisma.usuario.create({ data: { nombre:'Super B', username:'tsup.b', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaB.id, sucursalId:null } })
    preciosa   = await prisma.usuario.create({ data: { nombre:'Precios A', username:'tprec.a', passwordHash:hash, rol:'PRECIOS', activo:true, empresaId:empresaA.id, sucursalId:null } })

    // ── Catálogo + productos ──
    deptoA = await prisma.departamento.create({ data: { empresaId:empresaA.id, nombre:'DEPTO A', activo:true } })
    catA   = await prisma.categoria.create({ data: { empresaId:empresaA.id, departamentoId:deptoA.id, nombre:'Cat A' } })
    productoA1 = await prisma.producto.create({ data: { empresaId:empresaA.id, nombre:'Tornillo A1', codigoInterno:'T-001', precioBase:10, categoriaId:catA.id, claveSat:'31161500', unidadSat:'H87', unidadVenta:'PZA', activo:true } })

    // Tokens
    tokenEmpleadoA1 = signToken(empleadoA1.id, 'EMPLEADO')
    tokenSuperA     = signToken(superA.id, 'SUPERADMIN')
    tokenSuperB     = signToken(superB.id, 'SUPERADMIN')
    tokenPreciosa   = signToken(preciosa.id, 'PRECIOS')

    app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve() }) })
  })

  after(async () => {
    if (server) { try { await new Promise((r) => server.close(r)) } catch(e){} }
    if (prisma) { try { await prisma.$disconnect() } catch(e){} }
    if (prisma?.pool) { try { await prisma.pool.end() } catch(e){} }
    await new Promise((r) => setTimeout(r, 1500))
    delete require.cache[require.resolve('../src/app')]
    delete require.cache[require.resolve('../src/lib/prisma')]
    if (created) {
      try { await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]) } catch(e){}
      try { await adminPool.query(`DROP DATABASE "${dbName}"`) } catch(e){}
    }
    try { await adminPool.end() } catch(e){}
  })

  async function get(reqPath, token, sucursalId) {
    const headers = { Authorization: `Bearer ${token}` }
    if (sucursalId !== undefined) headers['X-Sucursal-Id'] = String(sucursalId)
    const res = await fetch(`${baseUrl}${reqPath}`, { headers })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  async function send(method, reqPath, token, body, sucursalId) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' }
    if (sucursalId !== undefined) headers['X-Sucursal-Id'] = String(sucursalId)
    const res = await fetch(`${baseUrl}${reqPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  // ── TEST 1: Usuario tenant + turno abierto → 200 ──
  it('1. empleado A1 abre turno → GET activo devuelve 200 con turno', async () => {
    const abrir = await send('POST', '/turnos-caja/abrir', tokenEmpleadoA1, { montoInicial: 1000 }, sucursalA1.id)
    assert.strictEqual(abrir.status, 201, `abrir turno: expected 201, got ${abrir.status}: ${JSON.stringify(abrir.body)}`)
    assert.ok(abrir.body.data, 'debe devolver data')
    assert.strictEqual(abrir.body.data.empresaId, empresaA.id)
    assert.strictEqual(abrir.body.data.sucursalId, sucursalA1.id)

    const activo = await get('/turnos-caja/activo', tokenEmpleadoA1, sucursalA1.id)
    assert.strictEqual(activo.status, 200, `activo: expected 200, got ${activo.status}: ${JSON.stringify(activo.body)}`)
    assert.ok(activo.body.data, 'debe devolver turno activo')
    assert.strictEqual(activo.body.data.id, abrir.body.data.id)
  })

  // ── TEST 2: Usuario tenant + sin turno → 404 SIN_TURNO ──
  it('2. superA sin turno en A2 → 404 SIN_TURNO', async () => {
    const res = await get('/turnos-caja/activo', tokenSuperA, sucursalA2.id)
    assert.strictEqual(res.status, 404)
    assert.strictEqual(res.body.codigo, 'SIN_TURNO')
  })

  // ── TEST 3: Abrir turno → GET activo devuelve ese turno ──
  it('3. superA abre turno en A2 → GET activo devuelve ese turno', async () => {
    const abrir = await send('POST', '/turnos-caja/abrir', tokenSuperA, { montoInicial: 500 }, sucursalA2.id)
    assert.strictEqual(abrir.status, 201)

    const activo = await get('/turnos-caja/activo', tokenSuperA, sucursalA2.id)
    assert.strictEqual(activo.status, 200)
    assert.strictEqual(activo.body.data.id, abrir.body.data.id)
    assert.ok(activo.body.data.montoInicial, 'debe tener montoInicial')
  })

  // ── TEST 4: Venta después de abrir turno → 201 ──
  it('4. empleado A1 crea venta después de abrir turno → 201', async () => {
    const activo = await get('/turnos-caja/activo', tokenEmpleadoA1, sucursalA1.id)
    assert.strictEqual(activo.status, 200, 'debe tener turno activo')
    const turnoId = activo.body.data.id

    const res = await send('POST', '/ventas', tokenEmpleadoA1, {
      turnoId,
      metodoPago: 'EFECTIVO',
      subtotal: 10,
      total: 10,
      montoPagado: 20,
      detalles: [{ productoId: productoA1.id, cantidad: 1, precioUnitario: 10, modoCaptura: 'CANTIDAD' }]
    }, sucursalA1.id)
    assert.strictEqual(res.status, 201, `venta: expected 201, got ${res.status}: ${JSON.stringify(res.body)}`)
    assert.ok(res.body.data, 'debe devolver venta')
    assert.ok(res.body.data.folio, 'debe tener folio')
  })

  // ── TEST 5: Empresa A intenta turno Empresa B → DENEGADO ──
  it('5. superA intenta abrir turno en B1 → 403/404 cross-tenant', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperA, { montoInicial: 100 }, sucursalB1.id)
    assert.ok(res.status === 403 || res.status === 404, `esperado 403/404 cross-tenant, got ${res.status}`)
  })

  // ── TEST 6: Sucursal A intenta turno no autorizado Sucursal B ──
  it('6. empleado A1 intenta abrir turno en A2 (no le corresponde) → 403', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenEmpleadoA1, { montoInicial: 100 }, sucursalA2.id)
    assert.strictEqual(res.status, 403, `esperado 403 sucursal fija incorrecta, got ${res.status}`)
  })

  // ── TEST 7: empresaId/sucursalId manipulados por body → NO permiten escape ──
  it('7. body con empresaId/sucursalId arbitrarios NO afecta el tenant autenticado', async () => {
    // El body lleva empresaId de B pero el token es de A
    const countAntes = await prisma.turnoCaja.count({ where: { empresaId: empresaA.id } })
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperA, {
      montoInicial: 100,
      empresaId: empresaB.id,
      sucursalId: sucursalB1.id
    }, sucursalA1.id)
    if (res.status === 201) {
      assert.strictEqual(res.body.data.empresaId, empresaA.id, 'empresaId debe ser del token, no del body')
      assert.strictEqual(res.body.data.sucursalId, sucursalA1.id, 'sucursalId debe ser del header, no del body')
      const countDespues = await prisma.turnoCaja.count({ where: { empresaId: empresaA.id } })
      assert.ok(countDespues > countAntes, 'debe haber creado turno en empresa A')
    } else {
      const countDespues = await prisma.turnoCaja.count({ where: { empresaId: empresaA.id } })
      assert.strictEqual(countDespues, countAntes, 'no debe haber creado turno si falló')
    }
  })

  // ── TEST 8: Tenant existente sin enviar empresaId por body → puede vender ──
  it('8. empleado A1 vende SIN enviar empresaId en body → venta creada correctamente', async () => {
    const activo = await get('/turnos-caja/activo', tokenEmpleadoA1, sucursalA1.id)
    assert.strictEqual(activo.status, 200)
    const turnoId = activo.body.data.id

    const res = await send('POST', '/ventas', tokenEmpleadoA1, {
      turnoId,
      metodoPago: 'EFECTIVO',
      subtotal: 20,
      total: 20,
      montoPagado: 25,
      detalles: [{ productoId: productoA1.id, cantidad: 2, precioUnitario: 10, modoCaptura: 'CANTIDAD' }]
      // NO se envía empresaId ni sucursalId en body
    }, sucursalA1.id)
    assert.strictEqual(res.status, 201, `venta sin empresaId body: expected 201, got ${res.status}: ${JSON.stringify(res.body)}`)
    assert.ok(res.body.data.folio)
  })

  // ── TEST 9: Rol sin permiso de venta → denegado ──
  it('9. PRECIOS no puede abrir turno → 403', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenPreciosa, { montoInicial: 100 }, sucursalA1.id)
    assert.strictEqual(res.status, 403, `esperado 403 para PRECIOS, got ${res.status}`)
  })

  // ── TEST 10: SUPERADMIN/PLATFORM_ADMIN sin regresión ──
  it('10. superA puede abrir turno en A1 con SELECTED mode → 201', async () => {
    // Cerrar turno existente de A1 primero
    const activo = await get('/turnos-caja/activo', tokenEmpleadoA1, sucursalA1.id)
    if (activo.status === 200 && activo.body.data) {
      await send('POST', '/turnos-caja/cerrar', tokenEmpleadoA1, { montoFinalDeclarado: 1000 }, sucursalA1.id)
    }

    const res = await send('POST', '/turnos-caja/abrir', tokenSuperA, { montoInicial: 2000 }, sucursalA1.id)
    assert.strictEqual(res.status, 201, `superA abrir en A1: expected 201, got ${res.status}`)
    assert.strictEqual(res.body.data.empresaId, empresaA.id)
    assert.strictEqual(res.body.data.sucursalId, sucursalA1.id)
  })
})
