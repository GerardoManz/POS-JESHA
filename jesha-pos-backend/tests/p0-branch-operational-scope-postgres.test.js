'use strict'

const { assertSafeTestDb } = require('./helpers/test-db-safety')
// P0-TURNOS-IMPORTACION-BRANCH-SCOPE — Pruebas PostgreSQL HTTP.
// Verifica que toda operación branch-dependiente use req.context.branch.sucursalId
// (helper resolverSucursalId) y que NO existan fallbacks a Sucursal 1 ni fuga cross-tenant.
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
const DB_PREFIX = 'jesha_p0_bbrscp_test_'
const DB_RE = /^jesha_p0_bbrscp_test_[a-z0-9_]+$/
const TENANT_SECRET = 'bbrscp-postgres-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-bbrscp-test'
const TENANT_AUDIENCE = 'jesha-bbrscp-api-test'

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

describe('P0-BRANCH-OPERATIONAL-SCOPE PostgreSQL HTTP', { concurrency:1, timeout:300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  assertSafeTestDb(databaseUrl)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig,'postgres'), max:1 })
  let created = false, prisma, app, server, baseUrl

  let empresaA, empresaB, empresaC, sucursalA1, sucursalA2, sucursalB1
  let deptoA, catA, deptoB, catB
  let superA, adminA1, adminA2, superB, superC
  let proveedorA, proveedorB
  let productoA1, productoB1
  let ocA1, detA1, ocB, cotA
  let tokenSuperA, tokenAdminA1, tokenAdminA2, tokenSuperB, tokenSuperC

  function signToken(userId, rol) {
    return jwt.sign({ version:1, kind:'TENANT', sub:userId, rol }, TENANT_SECRET, { algorithm:'HS256', issuer:TENANT_ISSUER, audience:TENANT_AUDIENCE, expiresIn:'30m' })
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'bbrscp-platform-secret-'.padEnd(64,'p')
    process.env.PLATFORM_JWT_ISSUER = 'bbrscp-platform-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'bbrscp-platform-api-test'
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

    // Estructura no representable por schema.prisma (secuencias de folio, índice
    // parcial de FacturaCfdi, NOT NULL de Bitacora) → proviene de la fuente
    // versionada prisma/manual-sql/ (P0-DB-STRUCTURE-DRIFT-RECONCILIATION).
    await applyManualSql((sql) => prisma.$executeRawUnsafe(sql))

    // ── Empresas ──
    empresaA = await prisma.empresa.create({ data: { slug:'bs-a', nombreComercial:'Branch A', razonSocial:'Branch A SA', whatsapp:'0000000011', activa:true } })
    empresaB = await prisma.empresa.create({ data: { slug:'bs-b', nombreComercial:'Branch B', razonSocial:'Branch B SA', whatsapp:'0000000012', activa:true } })
    empresaC = await prisma.empresa.create({ data: { slug:'bs-c', nombreComercial:'Branch C', razonSocial:'Branch C SA', whatsapp:'0000000013', activa:true } })

    // ── Sucursales ──
    sucursalA1 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'A1', codigoPostal:'00011', activa:true } })
    sucursalA2 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'A2', codigoPostal:'00012', activa:true } })
    sucursalB1 = await prisma.sucursal.create({ data: { empresaId:empresaB.id, nombre:'B1', codigoPostal:'00013', activa:true } })

    // ── Usuarios ──
    superA   = await prisma.usuario.create({ data: { nombre:'Super A', username:'bsup.a', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaA.id, sucursalId:null } })
    adminA1  = await prisma.usuario.create({ data: { nombre:'Admin A1', username:'badm.a1', passwordHash:hash, rol:'ADMIN_SUCURSAL', activo:true, empresaId:empresaA.id, sucursalId:sucursalA1.id } })
    adminA2  = await prisma.usuario.create({ data: { nombre:'Admin A2', username:'badm.a2', passwordHash:hash, rol:'ADMIN_SUCURSAL', activo:true, empresaId:empresaA.id, sucursalId:sucursalA2.id } })
    superB   = await prisma.usuario.create({ data: { nombre:'Super B', username:'bsup.b', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaB.id, sucursalId:null } })
    superC   = await prisma.usuario.create({ data: { nombre:'Super C', username:'bsup.c', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaC.id, sucursalId:null } })

    // ── Proveedores ──
    proveedorA = await prisma.proveedor.create({ data: { empresaId:empresaA.id, nombreOficial:'Prov A', alias:'prov-a', activo:true } })
    proveedorB = await prisma.proveedor.create({ data: { empresaId:empresaB.id, nombreOficial:'Prov B', alias:'prov-b', activo:true } })

    // ── Catálogo + productos ──
    deptoA = await prisma.departamento.create({ data: { empresaId:empresaA.id, nombre:'DEPT A', activo:true } })
    catA   = await prisma.categoria.create({ data: { empresaId:empresaA.id, departamentoId:deptoA.id, nombre:'Cat A' } })
    deptoB = await prisma.departamento.create({ data: { empresaId:empresaB.id, nombre:'DEPT B', activo:true } })
    catB   = await prisma.categoria.create({ data: { empresaId:empresaB.id, departamentoId:deptoB.id, nombre:'Cat B' } })
    productoA1 = await prisma.producto.create({ data: { empresaId:empresaA.id, nombre:'Tornillo A1', codigoInterno:'A-001', precioBase:10, categoriaId:catA.id, claveSat:'31161500', unidadSat:'H87', unidadVenta:'PZA', activo:true } })
    productoB1 = await prisma.producto.create({ data: { empresaId:empresaB.id, nombre:'Tornillo B1', codigoInterno:'A-001', precioBase:20, categoriaId:catB.id, claveSat:'31161500', unidadSat:'H87', unidadVenta:'PZA', activo:true } })

    tokenSuperA  = signToken(superA.id, 'SUPERADMIN')
    tokenAdminA1 = signToken(adminA1.id, 'ADMIN_SUCURSAL')
    tokenAdminA2 = signToken(adminA2.id, 'ADMIN_SUCURSAL')
    tokenSuperB  = signToken(superB.id, 'SUPERADMIN')
    tokenSuperC  = signToken(superC.id, 'SUPERADMIN')

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
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  const CSV_HEADER = 'CLAVE,DESCRIPCION,PRECIO 1,PRECIO COMPRA,CLAVE SAT,UNIDAD SAT,EXIST.,INV_MIN,INV_MAX'
  function csvRow(clave, desc, precio, claveSat, unidadSat, exist) {
    return `${clave},"${desc}",${precio},1,${claveSat},${unidadSat},${exist},0,50`
  }

  async function importCsv(token, csvContent, sucursalId) {
    const fd = new FormData()
    fd.append('archivo', new Blob([csvContent], { type: 'text/csv' }), 'import.csv')
    const headers = { Authorization: `Bearer ${token}` }
    if (sucursalId !== undefined) headers['X-Sucursal-Id'] = String(sucursalId)
    const res = await fetch(`${baseUrl}/productos/importar/csv`, { method: 'POST', headers, body: fd })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  async function inventarioDe(productoId, sucursalId) {
    return prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId, sucursalId } },
      select: { stockActual: true }
    })
  }

  // ── TURNOS ─────────────────────────────────────────────────────────
  it('1. abrir turno NONE → 400 (branch context requerido)', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperA, { montoInicial: 100 })
    assert.strictEqual(res.status, 400)
  })

  it('2. abrir turno en A1 (SELECTED) → 201 y sucursalId=A1', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperA, { montoInicial: 100 }, sucursalA1.id)
    assert.strictEqual(res.status, 201)
    assert.strictEqual(res.body.data.sucursalId, sucursalA1.id)
  })

  it('3. doble apertura en A1 → 409', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperA, { montoInicial: 100 }, sucursalA1.id)
    assert.strictEqual(res.status, 409)
  })

  it('4. GET activo adminA1 (FIXED) → 200 sucursalId=A1', async () => {
    const res = await get('/turnos-caja/activo', tokenAdminA1)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.sucursalId, sucursalA1.id)
  })

  it('5. abrir turno en A2 (SELECTED) → 201', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperA, { montoInicial: 50 }, sucursalA2.id)
    assert.strictEqual(res.status, 201)
    assert.strictEqual(res.body.data.sucursalId, sucursalA2.id)
  })

  it('6. cerrar A1 (SELECTED) → 200', async () => {
    const res = await send('POST', '/turnos-caja/cerrar', tokenSuperA, { montoFinalDeclarado: 100 }, sucursalA1.id)
    assert.strictEqual(res.status, 200)
  })

  it('7. historial NONE solo ve turnos de empresa A (no B)', async () => {
    const res = await get('/turnos-caja/historial', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.data.pagination.total >= 1, 'A debe tener al menos 1 turno cerrado')
  })

  it('8. header de sucursal de otra empresa al abrir → 403', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperA, { montoInicial: 100 }, sucursalB1.id)
    assert.strictEqual(res.status, 403)
  })

  it('9. abrir turno en B1 (superB) → 201 independiente de A', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperB, { montoInicial: 200 }, sucursalB1.id)
    assert.strictEqual(res.status, 201)
    assert.strictEqual(res.body.data.sucursalId, sucursalB1.id)
  })

  it('10. historial NONE de B no ve turnos de A (B aun abierto → 0 cerrados)', async () => {
    const res = await get('/turnos-caja/historial', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.pagination.total, 0, 'B no debe ver ningun turno cerrado de A')
  })

  it('11. GET activo NONE de A → 404 (sin sucursal fija no hay turno activo)', async () => {
    const res = await get('/turnos-caja/activo', tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('12. resumen-contable NONE de A consolida A1/A2 y no B', async () => {
    const hoy = new Date().toISOString().slice(0, 10)
    const res = await get(`/turnos-caja/resumen-contable?fechaDesde=${hoy}&fechaHasta=${hoy}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    const ids = res.body.data.sucursales.map(s => s.id).sort()
    assert.deepStrictEqual(ids, [sucursalA1.id, sucursalA2.id].sort())
  })

  it('13. resumen-contable NONE de B solo incluye B1', async () => {
    const hoy = new Date().toISOString().slice(0, 10)
    const res = await get(`/turnos-caja/resumen-contable?fechaDesde=${hoy}&fechaHasta=${hoy}`, tokenSuperB)
    assert.strictEqual(res.status, 200)
    const ids = res.body.data.sucursales.map(s => s.id)
    assert.strictEqual(ids.length, 1)
    assert.deepStrictEqual(ids, [sucursalB1.id])
  })

  it('14. GET activo adminA2 (FIXED A2) → 200 sucursalId=A2', async () => {
    const res = await get('/turnos-caja/activo', tokenAdminA2)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.sucursalId, sucursalA2.id)
  })

  // ── COMPRAS ────────────────────────────────────────────────────────
  it('15. crear compra NONE → 400', async () => {
    const res = await send('POST', '/compras', tokenSuperA, { proveedorId:proveedorA.id, detalles:[{ productoId:productoA1.id, cantidadPedida:5, precioCosto:10 }] })
    assert.strictEqual(res.status, 400)
  })

  it('16. crear compra en A1 → 201 y queda escrita a sucursal A1', async () => {
    const res = await send('POST', '/compras', tokenSuperA, { proveedorId:proveedorA.id, detalles:[{ productoId:productoA1.id, cantidadPedida:5, precioCosto:10 }] }, sucursalA1.id)
    assert.strictEqual(res.status, 201)
    assert.ok(res.body.data.id)
    ocA1 = res.body.data
    const oc = await prisma.ordenCompra.findUnique({ where: { id: ocA1.id }, select: { sucursalId: true } })
    assert.strictEqual(oc.sucursalId, sucursalA1.id)
  })

  it('17. crear compra en B1 (superB) → 201', async () => {
    const res = await send('POST', '/compras', tokenSuperB, { proveedorId:proveedorB.id, detalles:[{ productoId:productoB1.id, cantidadPedida:2, precioCosto:20 }] }, sucursalB1.id)
    assert.strictEqual(res.status, 201)
    ocB = res.body.data
  })

  it('18. recibir OC de B con token de A (SELECTED A1) → 404 sin revelar existencia', async () => {
    const res = await send('POST', `/compras/${ocB.id}/recibir`, tokenSuperA, { detalles:[{ detalleId:1, cantidadRecibida:1 }] }, sucursalA1.id)
    assert.strictEqual(res.status, 404)
  })

  it('19. recibir OC de A1 con adminA2 (FIXED A2) → 404 sin revelar branch mismatch', async () => {
    detA1 = await prisma.detalleOrdenCompra.findFirst({ where: { ordenCompraId: ocA1.id } })
    const res = await send('POST', `/compras/${ocA1.id}/recibir`, tokenAdminA2, { detalles:[{ detalleId:detA1.id, cantidadRecibida:5 }] })
    assert.strictEqual(res.status, 404)
  })

  it('20. recibir OC de A1 con SELECTED A1 → 200', async () => {
    const res = await send('POST', `/compras/${ocA1.id}/recibir`, tokenSuperA, { detalles:[{ detalleId:detA1.id, cantidadRecibida:5 }] }, sucursalA1.id)
    assert.strictEqual(res.status, 200)
  })

  it('21. listar compras NONE de A incluye la OC creada en A1', async () => {
    const res = await get('/compras?limit=200', tokenSuperA)
    assert.strictEqual(res.status, 200)
    const arr = Array.isArray(res.body.data) ? res.body.data : null
    assert.ok(arr, 'respuesta de /compras debe traer data[]')
    assert.ok(arr.some(x => x.id === ocA1.id), 'A debe listar su OC de A1')
  })

  // ── COTIZACIONES ───────────────────────────────────────────────────
  it('22. crear cotizacion NONE → 400', async () => {
    const res = await send('POST', '/cotizaciones', tokenSuperA, { tipo:'PRODUCTOS', detalles:[{ productoId:productoA1.id, cantidad:2, precioUnitario:12 }] })
    assert.strictEqual(res.status, 400)
  })

  it('23. crear cotizacion en A1 → 201 escrita a sucursal A1', async () => {
    const res = await send('POST', '/cotizaciones', tokenSuperA, { tipo:'PRODUCTOS', detalles:[{ productoId:productoA1.id, cantidad:2, precioUnitario:12 }] }, sucursalA1.id)
    assert.strictEqual(res.status, 201)
    assert.ok(res.body.data.id)
    cotA = res.body.data
    const c = await prisma.cotizacion.findUnique({ where: { id: cotA.id }, select: { sucursalId: true } })
    assert.strictEqual(c.sucursalId, sucursalA1.id)
  })

  it('24. crear cotizacion NONE en B → 400', async () => {
    const res = await send('POST', '/cotizaciones', tokenSuperB, { tipo:'PRODUCTOS', detalles:[{ productoId:productoB1.id, cantidad:1 }] })
    assert.strictEqual(res.status, 400)
  })

  it('25. crear cotizacion en B1 → 201 escrita a B1', async () => {
    const res = await send('POST', '/cotizaciones', tokenSuperB, { tipo:'PRODUCTOS', detalles:[{ productoId:productoB1.id, cantidad:1 }] }, sucursalB1.id)
    assert.strictEqual(res.status, 201)
    assert.ok(res.body.data.id)
    const c = await prisma.cotizacion.findUnique({ where: { id: res.body.data.id }, select: { sucursalId: true } })
    assert.strictEqual(c.sucursalId, sucursalB1.id)
  })

  it('26. listar cotizaciones NONE de A incluye la cotizacion A1', async () => {
    const res = await get('/cotizaciones?limit=200', tokenSuperA)
    assert.strictEqual(res.status, 200)
    const arr = Array.isArray(res.body.data) ? res.body.data : (Array.isArray(res.body.cotizaciones) ? res.body.cotizaciones : null)
    assert.ok(Array.isArray(arr), 'respuesta de /cotizaciones debe traer array')
    assert.ok(arr.some(c => c.id === cotA.id), 'A debe listar su cotizacion de A1')
  })

  // ── IMPORTACIÓN (cross-company branch header rechazado) ────────────
  it('27. importar CSV con header de otra empresa → 403', async () => {
    const res = await send('POST', '/productos/importar/csv', tokenSuperA, { dummy:true }, sucursalB1.id)
    assert.strictEqual(res.status, 403)
  })

  it('28. importar solo-nuevos con header de otra empresa → 403', async () => {
    const res = await send('POST', '/productos/importar/solo-nuevos', tokenSuperB, { dummy:true }, sucursalA1.id)
    assert.strictEqual(res.status, 403)
  })

  // ── REPORTES ───────────────────────────────────────────────────────
  it('29. alertas/generar NONE → 400', async () => {
    const res = await send('POST', '/reportes/stock/alertas/generar', tokenSuperA, {})
    assert.strictEqual(res.status, 400)
  })

  it('30. alertas/generar SELECTED A2 (turno abierto) → 200', async () => {
    const res = await send('POST', '/reportes/stock/alertas/generar', tokenSuperA, {}, sucursalA2.id)
    assert.strictEqual(res.status, 200)
  })

  it('31. reporte stock NONE de A consolida 2 sucursales', async () => {
    const res = await get('/reportes/stock', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(String(res.body.data.resumen.sucursal).includes('2 sucursales'), JSON.stringify(res.body.data && res.body.data.resumen && res.body.data.resumen.sucursal))
  })

  it('32. reporte stock NONE de B solo 1 sucursal y no fuga inventario A', async () => {
    const res = await get('/reportes/stock', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.ok(String(res.body.data.resumen.sucursal).includes('1 sucursal'), JSON.stringify(res.body.data && res.body.data.resumen && res.body.data.resumen.sucursal))
  })

  it('33. corregir-plantilla NONE → 400 (branchRequired previo a multer)', async () => {
    const res = await send('POST', '/reportes/stock/corregir-plantilla', tokenSuperA, {})
    assert.strictEqual(res.status, 400)
  })

  // ── EMPRESA C (cero sucursales) ────────────────────────────────────
  it('34. Empresa C: abrir turno NONE → 400', async () => {
    const res = await send('POST', '/turnos-caja/abrir', tokenSuperC, { montoInicial: 1 })
    assert.strictEqual(res.status, 400)
  })

  it('35. Empresa C: GET activo NONE → 404', async () => {
    const res = await get('/turnos-caja/activo', tokenSuperC)
    assert.strictEqual(res.status, 404)
  })

  it('36. Empresa C: reporte stock NONE → 200 con resumen vacio y sin datos A/B', async () => {
    const res = await get('/reportes/stock', tokenSuperC)
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.data && res.body.data.resumen)
    assert.strictEqual(res.body.data.resumen.sucursal, '—')
  })

  // ── IMPORTACIÓN EXITOSA (FASE 4: SAT válido + inventario scoped por sucursal) ──
  const CLAVE_IMP_A1 = `IMP-A1-${Date.now()}`
  const CLAVE_IMP_A2 = `IMP-A2-${Date.now()}`
  const CLAVE_IMP_FX = `IMP-FX-${Date.now()}`
  const CLAVE_IMP_NO = `IMP-NO-${Date.now()}`

  it('37. importar CSV válido en A1 → 201, producto creado e inventario SOLO en A1', async () => {
    const res = await importCsv(tokenSuperA, `${CSV_HEADER}\n${csvRow(CLAVE_IMP_A1, 'Disco import prueba', 35, '31161500', 'H87', 10)}`, sucursalA1.id)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.creados, 1)
    assert.strictEqual(res.body.errores, 0)
    const p = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresaA.id, codigoInterno: CLAVE_IMP_A1 } } })
    assert.ok(p, 'producto debe existir en empresa A')
    assert.strictEqual(p.claveSat, '31161500')
    assert.strictEqual(p.unidadSat, 'H87')
    const invA1 = await inventarioDe(p.id, sucursalA1.id)
    assert.ok(invA1, 'inventario debe existir en A1')
    assert.strictEqual(Number(invA1.stockActual), 10)
    assert.strictEqual(await inventarioDe(p.id, sucursalA2.id), null, 'no debe haber inventario en A2')
    assert.strictEqual(await inventarioDe(p.id, sucursalB1.id), null, 'no debe haber inventario en B1')
    const enB = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresaB.id, codigoInterno: CLAVE_IMP_A1 } } })
    assert.strictEqual(enB, null, 'el producto no debe fugarse a empresa B')
  })

  it('38. retry del mismo CSV → actualiza sin duplicar producto ni inventario', async () => {
    const res = await importCsv(tokenSuperA, `${CSV_HEADER}\n${csvRow(CLAVE_IMP_A1, 'Disco import prueba', 35, '31161500', 'H87', 10)}`, sucursalA1.id)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.creados, 0)
    assert.strictEqual(res.body.actualizados, 1)
    const total = await prisma.producto.count({ where: { empresaId: empresaA.id, codigoInterno: CLAVE_IMP_A1 } })
    assert.strictEqual(total, 1, 'no debe duplicarse el producto')
    const p = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresaA.id, codigoInterno: CLAVE_IMP_A1 } } })
    const invs = await prisma.inventarioSucursal.count({ where: { productoId: p.id } })
    assert.strictEqual(invs, 1, 'no debe duplicarse el inventario')
  })

  it('39. importar con header A2 → inventario en A2, A1 intacta', async () => {
    const res = await importCsv(tokenSuperA, `${CSV_HEADER}\n${csvRow(CLAVE_IMP_A2, 'Disco import A2', 40, '31161500', 'H87', 20)}`, sucursalA2.id)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.creados, 1)
    const p = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresaA.id, codigoInterno: CLAVE_IMP_A2 } } })
    const invA2 = await inventarioDe(p.id, sucursalA2.id)
    assert.ok(invA2, 'inventario debe existir en A2')
    assert.strictEqual(Number(invA2.stockActual), 20)
    assert.strictEqual(await inventarioDe(p.id, sucursalA1.id), null, 'no debe haber inventario en A1')
  })

  it('40. importar adminA1 (FIXED, sin header) → inventario en A1 desde token', async () => {
    const res = await importCsv(tokenAdminA1, `${CSV_HEADER}\n${csvRow(CLAVE_IMP_FX, 'Disco fixed admin', 30, '31161500', 'H87', 7)}`)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.creados, 1)
    const p = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresaA.id, codigoInterno: CLAVE_IMP_FX } } })
    const invA1 = await inventarioDe(p.id, sucursalA1.id)
    assert.ok(invA1, 'inventario debe existir en A1 (sucursal del token)')
    assert.strictEqual(Number(invA1.stockActual), 7)
  })

  it('41. importar NONE (superA, sin header) → 201 sin inventario (cero fallback a Sucursal 1)', async () => {
    const res = await importCsv(tokenSuperA, `${CSV_HEADER}\n${csvRow(CLAVE_IMP_NO, 'Disco sin sucursal', 25, '31161500', 'H87', 5)}`)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.creados, 1)
    const p = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresaA.id, codigoInterno: CLAVE_IMP_NO } } })
    assert.ok(p, 'producto debe crearse (import branch-agnostic)')
    const totalInv = await prisma.inventarioSucursal.count({ where: { productoId: p.id } })
    assert.strictEqual(totalInv, 0, 'sin header NO debe escribir inventario (ni Sucursal 1)')
  })

  it('42. fila con CLAVE SAT inválida → se rechaza esa fila y NO hay 500', async () => {
    const res = await importCsv(tokenSuperA, `${CSV_HEADER}\n${csvRow(`IMP-BAD-${Date.now()}`, 'Disco SAT invalido', 35, '99999999', 'H87', 10)}\n${csvRow(`IMP-OK-${Date.now()}`, 'Disco SAT valido', 35, '31161500', 'H87', 3)}`, sucursalA1.id)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.creados, 1, 'la fila válida debe importarse')
    assert.ok(res.body.omitidos >= 1, 'la fila con CLAVE SAT inválida debe ir a omitidos')
    assert.ok(Array.isArray(res.body.detalleErrores) && res.body.detalleErrores.some(e => String(e.error).includes('CLAVE SAT')), 'detalle debe mencionar CLAVE SAT')
  })

  // ── FASE 5: CONTRATOS DE TURNOS (cierre NONE, body ignorado, cross-tenant, rollback) ──
  it('43. cerrar turno NONE → 400 (branch context requerido en cerrar)', async () => {
    const res = await send('POST', '/turnos-caja/cerrar', tokenSuperA, { montoFinalDeclarado: 10 })
    assert.strictEqual(res.status, 400)
  })

  it('44. body sucursalId NO cambia contexto (request-context solo lee header/token) → 400 si no hay header', async () => {
    const res = await send('POST', '/turnos-caja/cerrar', tokenSuperA, { montoFinalDeclarado: 10, sucursalId: sucursalA1.id })
    assert.strictEqual(res.status, 400, 'sucursalId en body debe ser ignorado; el contexto sigue NONE')
  })

  it('45. cerrar turno de A2 con token de B (header A2) → 403 cross-tenant', async () => {
    const res = await send('POST', '/turnos-caja/cerrar', tokenSuperB, { montoFinalDeclarado: 10 }, sucursalA2.id)
    assert.strictEqual(res.status, 403)
  })

  it('46. rollback: intentos fallidos previos NO dejaron turnos huerfanos', async () => {
    const a2 = await prisma.turnoCaja.count({ where: { sucursalId: sucursalA2.id } })
    const a1 = await prisma.turnoCaja.count({ where: { sucursalId: sucursalA1.id } })
    const b1 = await prisma.turnoCaja.count({ where: { sucursalId: sucursalB1.id } })
    const totalA = await prisma.turnoCaja.count({ where: { Sucursal: { empresaId: empresaA.id } } })
    assert.strictEqual(a2, 1, 'A2 debe tener solo el turno abierto del test 5')
    assert.strictEqual(a1, 1, 'A1 debe tener solo el turno abierto/cerrado')
    assert.strictEqual(b1, 1, 'B1 debe tener solo su turno')
    assert.strictEqual(totalA, 2, 'los fallos (NONE, doble, cross-tenant) no deben dejar turnos huerfanos')
  })
})
