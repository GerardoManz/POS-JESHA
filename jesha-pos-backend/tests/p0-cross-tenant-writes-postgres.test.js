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

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_p0_xtwrites_test_'
const DB_RE = /^jesha_p0_xtwrites_test_[a-z0-9_]+$/
const TENANT_SECRET = 'xtwrites-postgres-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-xtwrites-test'
const TENANT_AUDIENCE = 'jesha-xtwrites-api-test'

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

describe('P0-CROSS-TENANT-WRITES PostgreSQL HTTP', { concurrency:1, timeout:300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig,'postgres'), max:1 })
  let created = false, prisma, app, server, baseUrl

  let empresaA, empresaB, sucursalA1, sucursalB1
  let catA, catB
  let clienteA, clienteB, clienteGeneralA
  let productoA, productoB
  let superA, adminA1, superB, empB
  let tokenSuperA, tokenAdminA1, tokenSuperB, tokenEmpB

  function signToken(userId, rol) {
    return jwt.sign({ version:1, kind:'TENANT', sub:userId, rol }, TENANT_SECRET, { algorithm:'HS256', issuer:TENANT_ISSUER, audience:TENANT_AUDIENCE, expiresIn:'30m' })
  }

  async function snapshotPre() {
    return {
      saldoClienteA: await prisma.cliente.findUnique({ where: { id: clienteA.id }, select: { saldoPendiente: true } }),
      saldoClienteB: await prisma.cliente.findUnique({ where: { id: clienteB.id }, select: { saldoPendiente: true } }),
      precioProductoA: await prisma.producto.findUnique({ where: { id: productoA.id }, select: { precioBase: true, precioVenta: true } }),
      precioProductoB: await prisma.producto.findUnique({ where: { id: productoB.id }, select: { precioBase: true, precioVenta: true } }),
      stockInvB: await prisma.inventarioSucursal.findUnique({ where: { productoId_sucursalId: { productoId: productoB.id, sucursalId: sucursalB1.id } }, select: { stockActual: true } }),
      activoEmpB: await prisma.usuario.findUnique({ where: { id: empB.id }, select: { activo: true } }),
      movimientosB: await prisma.movimientoInventario.count({ where: { empresaId: empresaB.id } }),
      bitacorasB: await prisma.bitacora.count({ where: { empresaId: empresaB.id } })
    }
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'xtwrites-platform-secret-'.padEnd(64,'p')
    process.env.PLATFORM_JWT_ISSUER = 'xtwrites-platform-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'xtwrites-platform-api-test'
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

    empresaA = await prisma.empresa.create({ data: { slug:'xt-a', nombreComercial:'XT A', razonSocial:'XT A SA de CV', whatsapp:'0000000101', activa:true } })
    empresaB = await prisma.empresa.create({ data: { slug:'xt-b', nombreComercial:'XT B', razonSocial:'XT B SA de CV', whatsapp:'0000000102', activa:true } })

    sucursalA1 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'A1', codigoPostal:'00001', activa:true } })
    sucursalB1 = await prisma.sucursal.create({ data: { empresaId:empresaB.id, nombre:'B1', codigoPostal:'00002', activa:true } })

    superA  = await prisma.usuario.create({ data: { nombre:'Super A', username:'xt.supa', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaA.id, sucursalId:null } })
    adminA1 = await prisma.usuario.create({ data: { nombre:'Admin A1', username:'xt.adma1', passwordHash:hash, rol:'ADMIN_SUCURSAL', activo:true, empresaId:empresaA.id, sucursalId:sucursalA1.id } })
    superB  = await prisma.usuario.create({ data: { nombre:'Super B', username:'xt.supb', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaB.id, sucursalId:null } })
    empB    = await prisma.usuario.create({ data: { nombre:'Emp B', username:'xt.empb', passwordHash:hash, rol:'EMPLEADO', activo:true, empresaId:empresaB.id, sucursalId:sucursalB1.id } })

    const deptoA = await prisma.departamento.create({ data: { empresaId:empresaA.id, nombre:'XT DEPT A', activo:true } })
    const deptoB = await prisma.departamento.create({ data: { empresaId:empresaB.id, nombre:'XT DEPT B', activo:true } })
    catA = await prisma.categoria.create({ data: { empresaId:empresaA.id, departamentoId:deptoA.id, nombre:'XT Cat A' } })
    catB = await prisma.categoria.create({ data: { empresaId:empresaB.id, departamentoId:deptoB.id, nombre:'XT Cat B' } })

    clienteA = await prisma.cliente.create({ data: { empresaId:empresaA.id, nombre:'Cliente A', tipo:'REGISTRADO', saldoPendiente:500, limiteCredito:1000, activo:true } })
    clienteB = await prisma.cliente.create({ data: { empresaId:empresaB.id, nombre:'Cliente B', tipo:'REGISTRADO', saldoPendiente:700, limiteCredito:1000, activo:true } })
    clienteGeneralA = await prisma.cliente.create({ data: { empresaId:empresaA.id, nombre:'Cliente General A', tipo:'GENERAL', saldoPendiente:0, limiteCredito:0, activo:true } })

    productoA = await prisma.producto.create({ data: { empresaId:empresaA.id, nombre:'Producto A', codigoInterno:'XT-A-001', precioBase:100, precioVenta:116, margen:16, categoriaId:catA.id, claveSat:'31161500', unidadSat:'H87', activo:true } })
    productoB = await prisma.producto.create({ data: { empresaId:empresaB.id, nombre:'Producto B', codigoInterno:'XT-A-001', precioBase:200, precioVenta:232, margen:16, categoriaId:catB.id, claveSat:'31161500', unidadSat:'H87', activo:true } })

    await prisma.inventarioSucursal.create({ data: { productoId:productoA.id, sucursalId:sucursalA1.id, stockActual:5, stockMinimoAlerta:2 } })
    await prisma.inventarioSucursal.create({ data: { productoId:productoB.id, sucursalId:sucursalB1.id, stockActual:7, stockMinimoAlerta:2 } })

    tokenSuperA  = signToken(superA.id, 'SUPERADMIN')
    tokenAdminA1 = signToken(adminA1.id, 'ADMIN_SUCURSAL')
    tokenSuperB  = signToken(superB.id, 'SUPERADMIN')
    tokenEmpB    = signToken(empB.id, 'EMPLEADO')

    app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve() }) })
  })

  after(async () => {
    if (server) { try { await new Promise((r) => server.close(r)) } catch(e){} }
    if (prisma) { try { await prisma.$disconnect() } catch(e){} }
    await new Promise((r) => setTimeout(r, 1500))
    delete require.cache[require.resolve('../src/app')]
    delete require.cache[require.resolve('../src/lib/prisma')]
    if (created) {
      try { await adminPool.query(`DROP DATABASE "${dbName}"`) } catch(e){}
    }
    try { await adminPool.end() } catch(e){}
  })

  async function send(method, path, token, body, sucursalId) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' }
    if (sucursalId !== undefined) headers['X-Sucursal-Id'] = String(sucursalId)
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  // ═══════════════════════════════════════════════════════════════
  // P0-XTENANT-002 — ABONO A CRÉDITO
  // ═══════════════════════════════════════════════════════════════
  it('1. A no abona crédito a cliente B → 404 y saldo B intacto', async () => {
    const antes = await snapshotPre()
    const res = await send('POST', `/clientes/${clienteB.id}/abonar-credito`, tokenSuperA, { monto: 100 })
    assert.strictEqual(res.status, 404)
    const despues = await snapshotPre()
    assert.strictEqual(parseFloat(despues.saldoClienteB.saldoPendiente), parseFloat(antes.saldoClienteB.saldoPendiente))
  })

  it('2. B no abona crédito a cliente A → 404 y saldo A intacto', async () => {
    const antes = await snapshotPre()
    const res = await send('POST', `/clientes/${clienteA.id}/abonar-credito`, tokenSuperB, { monto: 100 })
    assert.strictEqual(res.status, 404)
    const despues = await snapshotPre()
    assert.strictEqual(parseFloat(despues.saldoClienteA.saldoPendiente), parseFloat(antes.saldoClienteA.saldoPendiente))
  })

  it('3. A abona a su propio cliente → 200 y saldo decrementa', async () => {
    const antes = await snapshotPre()
    const res = await send('POST', `/clientes/${clienteA.id}/abonar-credito`, tokenSuperA, { monto: 100 })
    assert.strictEqual(res.status, 200)
    const despues = await snapshotPre()
    assert.strictEqual(parseFloat(despues.saldoClienteA.saldoPendiente), parseFloat(antes.saldoClienteA.saldoPendiente) - 100)
  })

  it('4. abono con monto inválido → 400', async () => {
    const res = await send('POST', `/clientes/${clienteA.id}/abonar-credito`, tokenSuperA, { monto: -50 })
    assert.strictEqual(res.status, 400)
  })

  it('5. abono a cliente sin crédito (GENERAL) → 400', async () => {
    const res = await send('POST', `/clientes/${clienteGeneralA.id}/abonar-credito`, tokenSuperA, { monto: 50 })
    assert.strictEqual(res.status, 400)
  })

  // ═══════════════════════════════════════════════════════════════
  // P0-XTENANT-013 — CAMBIO DE PRECIO
  // ═══════════════════════════════════════════════════════════════
  it('6. A no cambia precio de producto B → 404 y precio B intacto', async () => {
    const antes = await snapshotPre()
    const res = await send('PATCH', `/precios/${productoB.id}`, tokenSuperA, { precioBase: 1 })
    assert.strictEqual(res.status, 404)
    const despues = await snapshotPre()
    assert.strictEqual(parseFloat(despues.precioProductoB.precioBase), parseFloat(antes.precioProductoB.precioBase))
  })

  it('7. B no cambia precio de producto A → 404 y precio A intacto', async () => {
    const antes = await snapshotPre()
    const res = await send('PATCH', `/precios/${productoA.id}`, tokenSuperB, { precioBase: 1 })
    assert.strictEqual(res.status, 404)
    const despues = await snapshotPre()
    assert.strictEqual(parseFloat(despues.precioProductoA.precioBase), parseFloat(antes.precioProductoA.precioBase))
  })

  it('8. A cambia precio de su propio producto → 200', async () => {
    const res = await send('PATCH', `/precios/${productoA.id}`, tokenSuperA, { precioBase: 110 })
    assert.strictEqual(res.status, 200)
  })

  it('9. precio sin campos → 400', async () => {
    const res = await send('PATCH', `/precios/${productoA.id}`, tokenSuperA, {})
    assert.strictEqual(res.status, 400)
  })

  it('10. rol no permitido en precios (EMPLEADO) → 403', async () => {
    const res = await send('PATCH', `/precios/${productoA.id}`, tokenEmpB, { precioBase: 110 })
    assert.strictEqual(res.status, 403)
  })

  // ═══════════════════════════════════════════════════════════════
  // P0-XTENANT-014 — ESTADO DE USUARIO
  // ═══════════════════════════════════════════════════════════════
  it('11. A no desactiva usuario B → 404 y activo B intacto', async () => {
    const antes = await snapshotPre()
    const res = await send('PATCH', `/usuarios/${empB.id}/estado`, tokenSuperA, { activo: false })
    assert.strictEqual(res.status, 404)
    const despues = await snapshotPre()
    assert.strictEqual(despues.activoEmpB.activo, antes.activoEmpB.activo)
  })

  it('12. B no desactiva usuario A → 404', async () => {
    const objetivo = await prisma.usuario.create({ data: { nombre:'Emp A descartable', username:'xt.epad', passwordHash:await bcrypt.hash('password',10), rol:'EMPLEADO', activo:true, empresaId:empresaA.id, sucursalId:sucursalA1.id } })
    const res = await send('PATCH', `/usuarios/${objetivo.id}/estado`, tokenSuperB, { activo: false })
    assert.strictEqual(res.status, 404)
    const tras = await prisma.usuario.findUnique({ where: { id: objetivo.id }, select: { activo: true } })
    assert.strictEqual(tras.activo, true, 'objetivo A sigue activo')
  })

  it('13. A desactiva EMPLEADO de su empresa (rol inferior) → 200', async () => {
    const objetivo = await prisma.usuario.create({ data: { nombre:'Emp A', username:'xt.epa', passwordHash:await bcrypt.hash('password',10), rol:'EMPLEADO', activo:true, empresaId:empresaA.id, sucursalId:sucursalA1.id } })
    const res = await send('PATCH', `/usuarios/${objetivo.id}/estado`, tokenSuperA, { activo: false })
    assert.strictEqual(res.status, 200)
  })

  it('14. A no puede gestionar SUPERADMIN de su propia empresa → 403', async () => {
    const res = await send('PATCH', `/usuarios/${superA.id}/estado`, tokenSuperA, { activo: false })
    assert.strictEqual(res.status, 403)
  })

  it('15. rol no SUPERADMIN en estado de usuario → 403', async () => {
    const res = await send('PATCH', `/usuarios/${empB.id}/estado`, tokenAdminA1, { activo: false })
    assert.strictEqual(res.status, 403)
    assert.strictEqual(res.body?.error, 'Acceso denegado - rol insuficiente', '403 debe venir de requireRole, no de requireAuth')
  })

  // ═══════════════════════════════════════════════════════════════
  // P0-XTENANT-015 — AJUSTE RÁPIDO DE INVENTARIO
  // ═══════════════════════════════════════════════════════════════
  it('16. A (SUPERADMIN sin sucursal) ajuste-rapido → 400 (branchRequired)', async () => {
    const res = await send('POST', '/inventario/ajuste-rapido', tokenSuperA, { productoId: productoB.id, sucursalId: sucursalB1.id, nuevoStock: 99 })
    assert.strictEqual(res.status, 400)
  })

  it('17. A (SUPERADMIN con header sucursal B1) → 403 (sucursal de otra empresa)', async () => {
    const res = await send('POST', '/inventario/ajuste-rapido', tokenSuperA, { productoId: productoB.id, nuevoStock: 99 }, sucursalB1.id)
    assert.strictEqual(res.status, 403)
  })

  it('18. A (ADMIN_SUCURSAL A1) body sucursalId=B1 NO tiene autoridad → no toca inventario B', async () => {
    const antes = await snapshotPre()
    const res = await send('POST', '/inventario/ajuste-rapido', tokenAdminA1, { productoId: productoB.id, sucursalId: sucursalB1.id, nuevoStock: 99 })
    // Con fix: sucursal resuelta desde contexto = A1 → producto B no existe en A1 → 404
    assert.strictEqual(res.status, 404)
    const despues = await snapshotPre()
    assert.strictEqual(parseFloat(despues.stockInvB.stockActual), parseFloat(antes.stockInvB.stockActual))
  })

  it('19. A (ADMIN_SUCURSAL A1) ajusta inventario propio → 200', async () => {
    const res = await send('POST', '/inventario/ajuste-rapido', tokenAdminA1, { productoId: productoA.id, nuevoStock: 6 })
    if (res.status !== 200) console.error('DIAG test19 status', res.status, JSON.stringify(res.body))
    assert.strictEqual(res.status, 200)
  })

  it('20. B (SUPERADMIN + header B1) ajusta inventario B → 200', async () => {
    const res = await send('POST', '/inventario/ajuste-rapido', tokenSuperB, { productoId: productoB.id, nuevoStock: 8 }, sucursalB1.id)
    assert.strictEqual(res.status, 200)
  })

  it('21. ajuste sin cambio → 400', async () => {
    const res = await send('POST', '/inventario/ajuste-rapido', tokenAdminA1, { productoId: productoA.id, nuevoStock: 6 })
    assert.strictEqual(res.status, 400)
  })

  it('22. ajuste con stock negativo → 400', async () => {
    const res = await send('POST', '/inventario/ajuste-rapido', tokenAdminA1, { productoId: productoA.id, nuevoStock: -1 })
    assert.strictEqual(res.status, 400)
  })

  // ═══════════════════════════════════════════════════════════════
  // GENERAL — Empresa B intacta
  // ═══════════════════════════════════════════════════════════════
  it('23. Empresa B no sufrió escrituras: stock B, movimientos B, bitácoras B', async () => {
    const despues = await snapshotPre()
    assert.strictEqual(parseFloat(despues.stockInvB.stockActual), 8, 'stock B = 8 (solo ajuste legítimo de B)')
    assert.strictEqual(despues.movimientosB, 1, 'solo 1 movimiento de B (el ajuste legítimo)')
    assert.strictEqual(despues.bitacorasB, 0, 'ninguna bitácora de B')
    assert.strictEqual(parseFloat(despues.saldoClienteB.saldoPendiente), 700, 'saldo cliente B intacto')
    assert.strictEqual(parseFloat(despues.precioProductoB.precioBase), 200, 'precio producto B intacto')
    assert.strictEqual(despues.activoEmpB.activo, true, 'usuario B activo')
  })

  it('24. cero ventas/turnos (no se tocaron operaciones comerciales)', async () => {
    assert.strictEqual(await prisma.venta.count(), 0)
    assert.strictEqual(await prisma.turnoCaja.count(), 0)
  })

  it('25. sin token → 401 en los 4 endpoints', async () => {
    const a = await fetch(`${baseUrl}/clientes/${clienteB.id}/abonar-credito`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ monto: 10 }) })
    assert.strictEqual(a.status, 401)
    const b = await fetch(`${baseUrl}/precios/${productoB.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ precioBase: 1 }) })
    assert.strictEqual(b.status, 401)
    const c = await fetch(`${baseUrl}/usuarios/${empB.id}/estado`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ activo: false }) })
    assert.strictEqual(c.status, 401)
    const d = await fetch(`${baseUrl}/inventario/ajuste-rapido`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ productoId: productoA.id, nuevoStock: 9 }) })
    assert.strictEqual(d.status, 401)
  })
})
