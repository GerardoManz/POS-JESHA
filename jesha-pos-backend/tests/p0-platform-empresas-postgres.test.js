'use strict'

const { assertSafeTestDb } = require('./helpers/test-db-safety')
// P0-PLATFORM-COMPANY-PROVISIONING — Pruebas PostgreSQL HTTP.
// Cubre el README-APLICAR-Y-TESTEAR (casos 1-22) y los 4 casos clave:
//  1) Crear Empresa deja exactamente 0 Sucursales y 0 Usuarios.
//  2) Un token tenant jamás entra a /platform/empresas.
//  3) Activar sin SUPERADMIN → 409 EMPRESA_SIN_SUPERADMIN.
//  4) Con SUPERADMIN fixture activo, la Empresa se activa y luego se suspende.
// Usa PostgreSQL temporal (nunca jesha_db).
const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const path = require('node:path')
const http = require('node:http')
const pg = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_p0_platform_integration_'
const DB_RE = /^jesha_p0_platform_integration_[a-z0-9_]+$/
const PLATFORM_SECRET = 'empresas-platform-secret-'.padEnd(64, 'p')
const PLATFORM_ISSUER = 'jesha-empresas-platform-test'
const PLATFORM_AUDIENCE = 'jesha-empresas-platform-api-test'
const TENANT_SECRET = 'empresas-tenant-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-empresas-tenant-test'
const TENANT_AUDIENCE = 'jesha-empresas-tenant-api-test'

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

describe('P0-PLATFORM-COMPANY-PROVISIONING PostgreSQL HTTP', { concurrency:1, timeout:300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  assertSafeTestDb(databaseUrl)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig,'postgres'), max:1 })
  let created = false, prisma, app, server, baseUrl

  let platformAdmin, empresa, empresaId, slug, empresaSuspendible, tokenTenant
  let tokenPlatform
  function signTenant(userId, rol) {
    return jwt.sign({ version:1, kind:'TENANT', sub:userId, rol }, TENANT_SECRET, { algorithm:'HS256', issuer:TENANT_ISSUER, audience:TENANT_AUDIENCE, expiresIn:'30m' })
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.PLATFORM_JWT_SECRET = PLATFORM_SECRET
    process.env.PLATFORM_JWT_ISSUER = PLATFORM_ISSUER
    process.env.PLATFORM_JWT_AUDIENCE = PLATFORM_AUDIENCE
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
    process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
    process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'
    process.env.DEBUG_ENABLED = 'false'
    process.env.DEBUG_INCIDENT_WINDOW = 'false'

    await adminPool.query(`CREATE DATABASE "${dbName}"`)
    created = true
    dbPush(databaseUrl)

    prisma = require('../src/lib/prisma')
    const hash = await bcrypt.hash('password', 10)

    platformAdmin = await prisma.usuario.create({ data: {
      nombre: 'Platform Owner', username: `pf-owner-${Date.now()}`, passwordHash: hash,
      rol: 'PLATFORM_ADMIN', activo: true, empresaId: null, sucursalId: null
    } })

    app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve() }) })
  })

  after(async () => {
    if (server) { try { await new Promise((r) => server.close(r)) } catch(e){} }
    if (prisma) {
      try { await prisma.$disconnect() } catch(e){}
      try { if (prisma.pool && typeof prisma.pool.end === 'function') await prisma.pool.end() } catch(e){}
    }
    await new Promise((r) => setTimeout(r, 2000))
    delete require.cache[require.resolve('../src/app')]
    delete require.cache[require.resolve('../src/lib/prisma')]
    if (created) {
      await adminPool.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [dbName]
      )
      await adminPool.query(`DROP DATABASE "${dbName}"`)
      const residual = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
      assert.strictEqual(residual.rowCount, 0, 'la base temporal debe eliminarse')
    }
    await adminPool.end()
    await new Promise((r) => setTimeout(r, 500))
  })

  async function get(path, token) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const res = await fetch(`${baseUrl}${path}`, { headers })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  async function send(method, path, token, body) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const isJson = body !== undefined && body !== null
    if (isJson) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: isJson ? JSON.stringify(body) : undefined })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  async function auditorias(accion) {
    return prisma.auditoria.findMany({ where: { modulo: 'platform-empresas', ...(accion ? { accion } : {}) } })
  }

  // ── AUTENTICACIÓN ─────────────────────────────────────────────────
  it('0. login Platform real + /me entrega sesión PLATFORM_ADMIN', async () => {
    const login = await send('POST', '/platform/auth/login', null, { username:platformAdmin.username, password:'password' })
    assert.strictEqual(login.status, 200)
    assert.ok(login.body.token)
    tokenPlatform = login.body.token

    const me = await get('/platform/auth/me', tokenPlatform)
    assert.strictEqual(me.status, 200)
    assert.deepStrictEqual(me.body, { id:platformAdmin.id, rol:'PLATFORM_ADMIN', kind:'PLATFORM' })
  })

  it('0b. credenciales Platform inválidas → 401', async () => {
    const res = await send('POST', '/platform/auth/login', null, { username:platformAdmin.username, password:'incorrecta' })
    assert.strictEqual(res.status, 401)
  })

  it('1. sin token platform → 401', async () => {
    const res = await get('/platform/empresas')
    assert.strictEqual(res.status, 401)
  })

  it('2. token tenant en /platform/empresas → 401 (jamás entra)', async () => {
    tokenTenant = signTenant(999999, 'SUPERADMIN')
    const res = await get('/platform/empresas', tokenTenant)
    assert.strictEqual(res.status, 401)
  })

  it('3. PLATFORM_ADMIN lista Empresas → 200', async () => {
    const res = await get('/platform/empresas', tokenPlatform)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body.empresas))
  })

  // ── CREAR ─────────────────────────────────────────────────────────
  it('4. crear Empresa válida → 201', async () => {
    const body = { slug: 'ferreteria-pedregal', nombreComercial: 'FERRETERÍA PEDREGAL', razonSocial: 'FERRETERÍA PEDREGAL SA DE CV', whatsapp: '9611234567', notas: 'Empresa de prueba Platform' }
    const res = await send('POST', '/platform/empresas', tokenPlatform, body)
    assert.strictEqual(res.status, 201)
    empresa = res.body.empresa
    empresaId = empresa.id
    slug = empresa.slug
    assert.strictEqual(slug, 'ferreteria-pedregal')
    assert.strictEqual(empresa.nombreComercial, 'FERRETERÍA PEDREGAL')
  })

  it('5. Empresa creada tiene activa=false', async () => {
    assert.strictEqual(empresa.activa, false)
    const row = await prisma.empresa.findUnique({ where: { id: empresaId } })
    assert.strictEqual(row.activa, false)
  })

  it('6. FERRETERÍA PEDREGAL nace completamente vacía', async () => {
    const counts = await Promise.all([
      prisma.sucursal.count({ where: { empresaId } }),
      prisma.usuario.count({ where: { empresaId } }),
      prisma.producto.count({ where: { empresaId } }),
      prisma.inventarioSucursal.count({ where: { Producto: { empresaId } } }),
      prisma.movimientoCaja.count({ where: { empresaId } }),
      prisma.turnoCaja.count({ where: { empresaId } }),
      prisma.venta.count({ where: { empresaId } })
    ])
    assert.deepStrictEqual(counts, [0, 0, 0, 0, 0, 0, 0])
  })

  it('7. body.activa=true → 400', async () => {
    const res = await send('POST', '/platform/empresas', tokenPlatform, {
      slug: 'ferre-otra', nombreComercial: 'Otra', razonSocial: 'Otra SA', whatsapp: '5555555555', activa: true
    })
    assert.strictEqual(res.status, 400)
    assert.ok((res.body.errores || []).some((e) => e.campo === 'activa'))
  })

  it('8. body.empresaId/usuarioId/sucursalId/password → 400', async () => {
    for (const campo of ['empresaId', 'usuarioId', 'sucursalId', 'password']) {
      const res = await send('POST', '/platform/empresas', tokenPlatform, {
        slug: `ferre-x-${campo}`, nombreComercial: 'X', razonSocial: 'X SA', whatsapp: '5555555555', [campo]: 1
      })
      assert.strictEqual(res.status, 400, `campo ${campo}`)
      assert.ok(res.body.errores.some((e) => e.campo === campo), `debe reportar ${campo}`)
    }
  })

  it('9. slug duplicado → 409', async () => {
    const res = await send('POST', '/platform/empresas', tokenPlatform, {
      slug: 'ferreteria-pedregal', nombreComercial: 'Duplicada', razonSocial: 'Dup SA', whatsapp: '5555555555'
    })
    assert.strictEqual(res.status, 409)
    assert.strictEqual(res.body.code, 'EMPRESA_SLUG_DUPLICADO')
  })

  // ── OBTENER ───────────────────────────────────────────────────────
  it('10. GET por id inexistente → 404', async () => {
    const res = await get('/platform/empresas/999999999', tokenPlatform)
    assert.strictEqual(res.status, 404)
  })

  it('10b. GET por id inválido → 400', async () => {
    const res = await get('/platform/empresas/abc', tokenPlatform)
    assert.strictEqual(res.status, 400)
  })

  it('10c. listado y detalle muestran FERRETERÍA PEDREGAL INACTIVA y vacía', async () => {
    const listado = await get('/platform/empresas?buscar=PEDREGAL', tokenPlatform)
    assert.strictEqual(listado.status, 200)
    const pedregal = listado.body.empresas.find((item) => item.id === empresaId)
    assert.ok(pedregal)
    assert.strictEqual(pedregal.nombreComercial, 'FERRETERÍA PEDREGAL')
    assert.strictEqual(pedregal.activa, false)
    assert.strictEqual(pedregal.sucursales, 0)
    assert.strictEqual(pedregal.usuarios, 0)

    const detalle = await get(`/platform/empresas/${empresaId}`, tokenPlatform)
    assert.strictEqual(detalle.status, 200)
    assert.strictEqual(detalle.body.empresa.id, empresaId)
    assert.strictEqual(detalle.body.empresa.activa, false)
  })

  // ── PATCH ─────────────────────────────────────────────────────────
  it('11. PATCH edita solo campos permitidos', async () => {
    assert.strictEqual(empresa.nombreComercial, 'FERRETERÍA PEDREGAL')
    const res = await send('PATCH', `/platform/empresas/${empresaId}`, tokenPlatform, { notas:'Alta certificada desde Platform' })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.empresa.nombreComercial, 'FERRETERÍA PEDREGAL')
    assert.strictEqual(res.body.empresa.notas, 'Alta certificada desde Platform')
    const row = await prisma.empresa.findUnique({ where: { id: empresaId } })
    assert.strictEqual(row.nombreComercial, 'FERRETERÍA PEDREGAL')
    assert.strictEqual(row.activa, false, 'PATCH no debe tocar activa')
  })

  it('12. PATCH no puede cambiar activa → 400', async () => {
    const res = await send('PATCH', `/platform/empresas/${empresaId}`, tokenPlatform, { activa: true })
    assert.strictEqual(res.status, 400)
  })

  it('12b. PATCH sin campos → 400', async () => {
    const res = await send('PATCH', `/platform/empresas/${empresaId}`, tokenPlatform, {})
    assert.strictEqual(res.status, 400)
  })

  // ── SUSPENDER ─────────────────────────────────────────────────────
  it('13. activar sin SUPERADMIN → 409 EMPRESA_SIN_SUPERADMIN (caso clave 3)', async () => {
    const res = await send('POST', `/platform/empresas/${empresaId}/activar`, tokenPlatform, {})
    assert.strictEqual(res.status, 409)
    assert.strictEqual(res.body.code, 'EMPRESA_SIN_SUPERADMIN')
  })

  it('14. activar sigue 409 idempotente mientras no haya SUPERADMIN', async () => {
    const res = await send('POST', `/platform/empresas/${empresaId}/activar`, tokenPlatform, {})
    assert.strictEqual(res.status, 409)
    assert.strictEqual(res.body.code, 'EMPRESA_SIN_SUPERADMIN')
  })

  // ── EMPRESA SEPARADA PARA ACTIVAR/SUSPENDER ───────────────────────
  it('15. crea fixture separada activable con SUPERADMIN', async () => {
    empresaSuspendible = await prisma.empresa.create({ data: {
      slug:'fixture-suspendible', nombreComercial:'Fixture Suspendible', razonSocial:'Fixture Suspendible SA', whatsapp:'5555555555', activa:false
    } })
    const hash = await bcrypt.hash('password', 10)
    const superUsuario = await prisma.usuario.create({ data: {
      nombre:'Super Fixture', username:`pf-super-${Date.now()}`, passwordHash:hash,
      rol:'SUPERADMIN', activo:true, empresaId:empresaSuspendible.id, sucursalId:null
    } })
    assert.ok(superUsuario.id > 0)
  })

  it('16. activar fixture con SUPERADMIN → 200 + activa=true', async () => {
    const res = await send('POST', `/platform/empresas/${empresaSuspendible.id}/activar`, tokenPlatform, {})
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.empresa.activa, true)
    const row = await prisma.empresa.findUnique({ where: { id: empresaSuspendible.id } })
    assert.strictEqual(row.activa, true)
  })

  it('17. activar nuevamente → 200 idempotente', async () => {
    const res = await send('POST', `/platform/empresas/${empresaSuspendible.id}/activar`, tokenPlatform, {})
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.empresa.activa, true)
  })

  it('18. suspender Empresa activa → 200 + activa=false', async () => {
    const res = await send('POST', `/platform/empresas/${empresaSuspendible.id}/suspender`, tokenPlatform, {})
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.empresa.activa, false)
  })

  it('19. suspender nuevamente → 200 idempotente y sin auditoría duplicada', async () => {
    const antes = await auditorias('PLATFORM_EMPRESA_SUSPENDER')
    const res = await send('POST', `/platform/empresas/${empresaSuspendible.id}/suspender`, tokenPlatform, {})
    assert.strictEqual(res.status, 200)
    const despues = await auditorias('PLATFORM_EMPRESA_SUSPENDER')
    assert.strictEqual(despues.length, antes.length, 'no debe duplicarse auditoría sin transición real')
  })

  // ── AUDITORÍA ─────────────────────────────────────────────────────
  it('20. auditoría existe para crear', async () => {
    const rows = await auditorias('PLATFORM_EMPRESA_CREAR')
    assert.ok(rows.length >= 1)
    const row = rows.find((a) => a.referencia === `empresa:${empresaId}`)
    assert.ok(row, 'debe existir auditoría de crear para esta empresa')
    assert.strictEqual(row.empresaId, empresaId)
    assert.strictEqual(row.sucursalId, null)
    assert.strictEqual(row.usuarioId, platformAdmin.id)
  })

  it('21. auditoría existe para editar (transición real)', async () => {
    const rows = await auditorias('PLATFORM_EMPRESA_EDITAR')
    const row = rows.find((a) => a.referencia === `empresa:${empresaId}`)
    assert.ok(row, 'debe existir auditoría de editar')
    assert.strictEqual(row.empresaId, empresaId)
    assert.strictEqual(row.usuarioId, platformAdmin.id)
  })

  it('22. auditoría existe para activar y suspender', async () => {
    const activar = await auditorias('PLATFORM_EMPRESA_ACTIVAR')
    const suspender = await auditorias('PLATFORM_EMPRESA_SUSPENDER')
    assert.ok(activar.length >= 1)
    assert.ok(suspender.length >= 1)
    for (const row of [...activar, ...suspender]) {
      assert.ok([empresaId, empresaSuspendible.id].includes(row.empresaId))
      assert.strictEqual(row.sucursalId, null)
      assert.strictEqual(row.usuarioId, platformAdmin.id)
    }
  })

  // ── CASO CLAVE 1: contar de nuevo tras todo el flujo ──────────────
  it('23. estado final: PEDREGAL sigue inactiva, vacía y sin SUPERADMIN', async () => {
    const row = await prisma.empresa.findUnique({ where: { id:empresaId } })
    assert.strictEqual(row.activa, false)
    assert.strictEqual(await prisma.sucursal.count({ where: { empresaId } }), 0)
    assert.strictEqual(await prisma.usuario.count({ where: { empresaId } }), 0)
    assert.strictEqual(await prisma.producto.count({ where: { empresaId } }), 0)
    assert.strictEqual(await prisma.inventarioSucursal.count({ where: { Producto: { empresaId } } }), 0)
    assert.strictEqual(await prisma.movimientoCaja.count({ where: { empresaId } }), 0)
    assert.strictEqual(await prisma.turnoCaja.count({ where: { empresaId } }), 0)
    assert.strictEqual(await prisma.venta.count({ where: { empresaId } }), 0)
  })

  // ── AISLAMIENTO DE RUTA PLATFORM ──────────────────────────────────
  it('24. token tenant (incluso de Empresa activa) no accede a /platform/empresas', async () => {
    const empresaActiva = await prisma.empresa.create({ data: {
      slug: 'activa-sep', nombreComercial: 'Activa SE', razonSocial: 'Activa SA', whatsapp: '5555555555', activa: true
    } })
    const hash = await bcrypt.hash('password', 10)
    const superActiva = await prisma.usuario.create({ data: {
      nombre: 'Super Sep', username: `pf-super-sep-${Date.now()}`, passwordHash: hash,
      rol: 'SUPERADMIN', activo: true, empresaId: empresaActiva.id, sucursalId: null
    } })
    const t = signTenant(superActiva.id, 'SUPERADMIN')
    const res = await get('/platform/empresas', t)
    assert.strictEqual(res.status, 401, 'un token tenant nunca lista empresas de plataforma')
  })

  it('25. token Platform no accede a rutas tenant', async () => {
    const res = await get('/usuarios', tokenPlatform)
    assert.strictEqual(res.status, 401)
  })
})
