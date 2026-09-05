'use strict'

const { assertSafeTestDb } = require('./helpers/test-db-safety')

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
const DB_PREFIX = 'jesha_p0_tgscope_test_'
const DB_RE = /^jesha_p0_tgscope_test_[a-z0-9_]+$/
const TENANT_SECRET = 'tgscope-postgres-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-tgscope-test'
const TENANT_AUDIENCE = 'jesha-tgscope-api-test'

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

describe('P0-TENANT-GLOBAL-SCOPE PostgreSQL HTTP', { concurrency:1, timeout:300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  assertSafeTestDb(databaseUrl)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig,'postgres'), max:1 })
  let created = false, prisma, app, server, baseUrl

  let empresaA, empresaB, sucursalA1, sucursalA2, sucursalB1, clienteA, proveedorA, proveedorB, productoA, productoB
  let superA, adminA1, empA2, superB, pricesGlobal
  let tokenSuperA, tokenAdminA1, tokenEmpA2, tokenSuperB, tokenPrices

  function signToken(userId, rol) {
    return jwt.sign({ version:1, kind:'TENANT', sub:userId, rol }, TENANT_SECRET, { algorithm:'HS256', issuer:TENANT_ISSUER, audience:TENANT_AUDIENCE, expiresIn:'30m' })
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'tgscope-platform-secret-'.padEnd(64,'p')
    process.env.PLATFORM_JWT_ISSUER = 'tgscope-platform-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'tgscope-platform-api-test'
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

    empresaA = await prisma.empresa.create({ data: { slug:'empresa-a', nombreComercial:'Empresa A', razonSocial:'Empresa A SA de CV', whatsapp:'0000000001', activa:true } })
    empresaB = await prisma.empresa.create({ data: { slug:'empresa-b', nombreComercial:'Empresa B', razonSocial:'Empresa B SA de CV', whatsapp:'0000000002', activa:true } })

    sucursalA1 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'Matriz A', codigoPostal:'00001', activa:true } })
    sucursalA2 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'Sucursal A2', codigoPostal:'00002', activa:true } })
    sucursalB1 = await prisma.sucursal.create({ data: { empresaId:empresaB.id, nombre:'Matriz B', codigoPostal:'00003', activa:true } })

    superA = await prisma.usuario.create({ data: { nombre:'Super A', username:'super.a', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaA.id, sucursalId:null } })
    adminA1 = await prisma.usuario.create({ data: { nombre:'Admin A1', username:'admin.a1', passwordHash:hash, rol:'ADMIN_SUCURSAL', activo:true, empresaId:empresaA.id, sucursalId:sucursalA1.id } })
    empA2 = await prisma.usuario.create({ data: { nombre:'Emp A2', username:'emp.a2', passwordHash:hash, rol:'EMPLEADO', activo:true, empresaId:empresaA.id, sucursalId:sucursalA2.id } })
    superB = await prisma.usuario.create({ data: { nombre:'Super B', username:'super.b', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaB.id, sucursalId:null } })
    pricesGlobal = await prisma.usuario.create({ data: { nombre:'Prices', username:'prices.g', passwordHash:hash, rol:'PRECIOS', activo:true, empresaId:empresaA.id, sucursalId:null } })

    clienteA = await prisma.cliente.create({ data: { empresaId:empresaA.id, nombre:'Cliente A', tipo:'REGISTRADO', rfc:'XAXX010101000' } })
    proveedorA = await prisma.proveedor.create({ data: { empresaId:empresaA.id, nombreOficial:'Proveedor A', alias:'prov-a' } })
    await prisma.cliente.create({ data: { empresaId:empresaB.id, nombre:'Cliente B', tipo:'REGISTRADO', rfc:'XEXX010101000' } })
    proveedorB = await prisma.proveedor.create({ data: { empresaId:empresaB.id, nombreOficial:'Proveedor B', alias:'prov-b' } })

    const deptoA = await prisma.departamento.create({ data: { empresaId:empresaA.id, nombre:'TG DEPT A', activo:true } })
    const deptoB = await prisma.departamento.create({ data: { empresaId:empresaB.id, nombre:'TG DEPT B', activo:true } })
    const catA = await prisma.categoria.create({ data: { empresaId:empresaA.id, departamentoId:deptoA.id, nombre:'TG Cat A' } })
    const catB = await prisma.categoria.create({ data: { empresaId:empresaB.id, departamentoId:deptoB.id, nombre:'TG Cat B' } })
    productoA = await prisma.producto.create({ data: { empresaId:empresaA.id, nombre:'TG Producto A', codigoInterno:'TG-A', precioBase:10, categoriaId:catA.id, activo:true } })
    productoB = await prisma.producto.create({ data: { empresaId:empresaB.id, nombre:'TG Producto B', codigoInterno:'TG-B', precioBase:20, categoriaId:catB.id, activo:true } })

    tokenSuperA = signToken(superA.id, 'SUPERADMIN')
    tokenAdminA1 = signToken(adminA1.id, 'ADMIN_SUCURSAL')
    tokenEmpA2 = signToken(empA2.id, 'EMPLEADO')
    tokenSuperB = signToken(superB.id, 'SUPERADMIN')
    tokenPrices = signToken(pricesGlobal.id, 'PRECIOS')

    app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve() }) })
  })

  after(async () => {
    if (server) { try { await new Promise((r) => server.close(r)) } catch(e){} }
    if (prisma) { try { await prisma.$disconnect() } catch(e){} }
    if (prisma?.pool) { try { await prisma.pool.end() } catch(e){} }
    await new Promise((r) => setTimeout(r, 500))
    delete require.cache[require.resolve('../src/app')]
    delete require.cache[require.resolve('../src/lib/prisma')]
    if (created) { try { await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]) } catch(e){} try { await adminPool.query(`DROP DATABASE "${dbName}"`) } catch(e){} }
    try { await adminPool.end() } catch(e){} 
  })

  async function get(path, token, sucursalId) {
    const headers = { Authorization: `Bearer ${token}` }
    if (sucursalId !== undefined) headers['X-Sucursal-Id'] = String(sucursalId)
    const res = await fetch(`${baseUrl}${path}`, { headers })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  async function send(method, path, token, body, sucursalId) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' }
    if (sucursalId !== undefined) headers['X-Sucursal-Id'] = String(sucursalId)
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status:res.status, body:await res.json().catch(() => null) }
  }

  // USUARIOS
  it('1. A lista solo usuarios A', async () => {
    const res = await get('/usuarios', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body))
    const ids = res.body.map(u => u.id)
    assert.ok(ids.includes(superA.id))
    assert.ok(ids.includes(adminA1.id))
    assert.ok(!ids.includes(superB.id))
  })

  it('2. B lista solo usuarios B', async () => {
    const res = await get('/usuarios', tokenSuperB)
    assert.strictEqual(res.status, 200)
    const ids = res.body.map(u => u.id)
    assert.ok(ids.includes(superB.id))
    assert.ok(!ids.includes(superA.id))
  })

  it('3. A no obtiene usuario B', async () => {
    const res = await get(`/usuarios/${superB.id}`, tokenSuperA)
    assert.ok(res.status !== 200)
  })

  // CLIENTES
  it('4. A lista cliente A, no cliente B', async () => {
    const res = await get('/clientes', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body))
    const nombres = res.body.map(c => c.nombre)
    assert.ok(nombres.includes('Cliente A'))
    assert.ok(!nombres.includes('Cliente B'))
  })

  // PROVEEDORES  
  it('5. A lista proveedor A, no B', async () => {
    const res = await get('/proveedores', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body.data))
    const nombres = res.body.data.map(p => p.nombreOficial)
    assert.ok(nombres.includes('Proveedor A'))
    assert.ok(!nombres.includes('Proveedor B'))
  })

  it('5a. A vincula Proveedor A con Producto A', async () => {
    const res = await send('POST', `/proveedores/${proveedorA.id}/productos`, tokenSuperA, { productoId:productoA.id, precioCosto:8 })
    assert.strictEqual(res.status, 201)
    const relacion = await prisma.proveedorProducto.findUnique({ where: { proveedorId_productoId: { proveedorId:proveedorA.id, productoId:productoA.id } } })
    assert.ok(relacion)
    assert.strictEqual(relacion.activo, true)
  })

  it('5b. A no vincula Proveedor A con Producto B', async () => {
    const res = await send('POST', `/proveedores/${proveedorA.id}/productos`, tokenSuperA, { productoId:productoB.id, precioCosto:8 })
    assert.strictEqual(res.status, 404)
    assert.strictEqual(await prisma.proveedorProducto.count({ where: { proveedorId:proveedorA.id, productoId:productoB.id } }), 0)
  })

  it('5c. A no vincula Proveedor B con Producto A', async () => {
    const res = await send('POST', `/proveedores/${proveedorB.id}/productos`, tokenSuperA, { productoId:productoA.id, precioCosto:8 })
    assert.strictEqual(res.status, 404)
    assert.strictEqual(await prisma.proveedorProducto.count({ where: { proveedorId:proveedorB.id, productoId:productoA.id } }), 0)
  })

  it('5d. A no desvincula relación B y ésta queda intacta', async () => {
    await prisma.proveedorProducto.create({ data: { proveedorId:proveedorB.id, productoId:productoB.id, precioCosto:15, activo:true } })
    const res = await send('DELETE', `/proveedores/${proveedorB.id}/productos/${productoB.id}`, tokenSuperA)
    assert.strictEqual(res.status, 404)
    const relacion = await prisma.proveedorProducto.findUnique({ where: { proveedorId_productoId: { proveedorId:proveedorB.id, productoId:productoB.id } } })
    assert.strictEqual(relacion.activo, true)
  })

  // SUCURSALES
  it('6. A lista sucursales A1/A2, no B1', async () => {
    const res = await get('/sucursales', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body))
    const ids = res.body.map(s => s.id)
    assert.ok(ids.includes(sucursalA1.id))
    assert.ok(ids.includes(sucursalA2.id))
    assert.ok(!ids.includes(sucursalB1.id))
  })

  it('7. B lista solo B1', async () => {
    const res = await get('/sucursales', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.length, 1)
    assert.strictEqual(res.body[0].id, sucursalB1.id)
  })

  // listarVendedores
  it('8. vendedores scoped por empresa A', async () => {
    const res = await get('/usuarios/vendedores', tokenSuperA)
    assert.strictEqual(res.status, 200)
    const vendedores = res.body
    const ids = vendedores.map(v => v.id)
    assert.ok(ids.includes(superA.id), 'debe incluir SUPERADMIN A')
    assert.ok(ids.includes(adminA1.id), 'debe incluir admin A1')
    assert.ok(!ids.includes(superB.id), 'no debe incluir SUPERADMIN B')
  })

  // EMPRESA_ID REJECTED
  it('9. empresaId en body no altera scope de clientes', async () => {
    const http = require('node:http')
    const body = JSON.stringify({ empresaId: empresaB.id, nombre: 'Try B', tipo: 'GENERAL' })
    const res = await fetch(`${baseUrl}/clientes`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokenSuperA}`, 'Content-Type':'application/json' }, body
    })
    const data = await res.json().catch(() => null)
    if (res.status === 201 || res.status === 200) {
      assert.notStrictEqual(data.empresaId, empresaB.id, 'empresaId del body no debe prevalecer')
    }
  })

  it('10. lista disponibles ya esta scoped (Gate previo)', async () => {
    const res = await get('/sucursales/disponibles', tokenSuperA)
    assert.strictEqual(res.status, 200)
    const ids = res.body.sucursales.map(s => s.id)
    assert.ok(!ids.includes(sucursalB1.id))
  })

  // CONTEXT REQUIRED
  it('11. sin token devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/clientes`)
    assert.strictEqual(res.status, 401)
  })

  it('12. vendedores con sucursal FIXED', async () => {
    const res = await get('/usuarios/vendedores', tokenAdminA1)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body))
    assert.ok(res.body.some(v => v.id === adminA1.id))
  })

  it('13. vendedores con sucursal SELECTED', async () => {
    const res = await get('/usuarios/vendedores', tokenSuperA, sucursalA2.id)
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.some(v => v.id === empA2.id))
  })
})
