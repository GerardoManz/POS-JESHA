'use strict'

const { assertSafeTestDb } = require('./helpers/test-db-safety')

// P0-CROSS-TENANT-LISTS — Certificación PostgreSQL HTTP (Fase 2 / hotfix).
// Complementa a p0-cross-tenant-reads (fuegos unarios) con cobertura explícita
// de LISTADOS cross-tenant. Dataset A/B/C (tres inquilinos) + casos de
// paginación no-numérica (NaN) + full-text scoped + shape "jamás 404 por vacío".
//
// BD temporal dedicada (PREFIX + timestamp + pid + random). NUNCA jesha_db.
// Requiere variables P0_TEST_PG_* (host local, user, password, port).

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
const DB_PREFIX = 'jesha_p0_xtlists_test_'
const DB_RE = /^jesha_p0_xtlists_test_[a-z0-9_]+$/
const TENANT_SECRET = 'xtlists-postgres-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-xtlists-test'
const TENANT_AUDIENCE = 'jesha-xtlists-api-test'

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
// Estructura no representable por schema.prisma (secuencias de folio, índice
// parcial de FacturaCfdi, NOT NULL de Bitacora) → proviene de la fuente
// versionada prisma/manual-sql/ (P0-DB-STRUCTURE-DRIFT-RECONCILIATION).
async function applyManualSqlToDb(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await applyManualSql((sql) => client.query(sql))
  } finally {
    await client.end()
  }
}

describe('P0-CROSS-TENANT-LISTS PostgreSQL HTTP', { concurrency:1, timeout:300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  assertSafeTestDb(databaseUrl)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig,'postgres'), max:1 })
  let created = false, prisma, app, server, baseUrl

  // Tres inquilinos aislados.
  let empresaA, empresaB, empresaC
  let sucursalA1, sucursalB1, sucursalC1

  let clienteA, clienteB, clienteC
  let productoA, productoB, productoC
  let proveedorA, proveedorB, proveedorC
  let superA, superB, superC
  let turnoA, turnoB, turnoC

  // Datos de listados por empresa.
  let bitacoraA, bitacoraB, bitacoraC
  let pedidoA, pedidoB, pedidoC
  let ocA, ocB, ocC
  let cotizacionA, cotizacionB, cotizacionC
  let ventaA, ventaB, ventaC
  let devolucionA, devolucionB, devolucionC
  let turnoCerradoA, turnoCerradoB, turnoCerradoC

  let tokenSuperA, tokenSuperB, tokenSuperC

  function signToken(userId, rol) {
    return jwt.sign({ version:1, kind:'TENANT', sub:userId, rol }, TENANT_SECRET, { algorithm:'HS256', issuer:TENANT_ISSUER, audience:TENANT_AUDIENCE, expiresIn:'30m' })
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'xtlists-platform-secret-'.padEnd(64,'p')
    process.env.PLATFORM_JWT_ISSUER = 'xtlists-platform-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'xtlists-platform-api-test'
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
    process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
    process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'
    process.env.DEBUG_ENABLED = 'false'

    await adminPool.query(`CREATE DATABASE "${dbName}"`)
    created = true
    dbPush(databaseUrl)
    await applyManualSqlToDb(databaseUrl)

    prisma = require('../src/lib/prisma')
  if (prisma?.pool && !prisma.pool.__p0ErrorGuard) { prisma.pool.__p0ErrorGuard = true; prisma.pool.on('error', () => {}) }
    const hash = await bcrypt.hash('password', 10)

    // ── Empresas (inquilinos) ──────────────────────────────────────
    empresaA = await prisma.empresa.create({ data: { slug:'xl-a', nombreComercial:'XL A', razonSocial:'XL A SA de CV', whatsapp:'0000000301', activa:true } })
    empresaB = await prisma.empresa.create({ data: { slug:'xl-b', nombreComercial:'XL B', razonSocial:'XL B SA de CV', whatsapp:'0000000302', activa:true } })
    empresaC = await prisma.empresa.create({ data: { slug:'xl-c', nombreComercial:'XL C', razonSocial:'XL C SA de CV', whatsapp:'0000000303', activa:true } })

    sucursalA1 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'A1', codigoPostal:'00001', activa:true } })
    sucursalB1 = await prisma.sucursal.create({ data: { empresaId:empresaB.id, nombre:'B1', codigoPostal:'00002', activa:true } })
    sucursalC1 = await prisma.sucursal.create({ data: { empresaId:empresaC.id, nombre:'C1', codigoPostal:'00003', activa:true } })

    superA = await prisma.usuario.create({ data: { nombre:'Super A', username:'xl.supa', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaA.id, sucursalId:null } })
    superB = await prisma.usuario.create({ data: { nombre:'Super B', username:'xl.supb', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaB.id, sucursalId:null } })
    superC = await prisma.usuario.create({ data: { nombre:'Super C', username:'xl.supc', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaC.id, sucursalId:null } })

    // ── Dependencias por empresa (departamento/categoria/cliente/producto) ──
    const deptoA = await prisma.departamento.create({ data: { empresaId:empresaA.id, nombre:'XL DEPT A', activo:true } })
    const deptoB = await prisma.departamento.create({ data: { empresaId:empresaB.id, nombre:'XL DEPT B', activo:true } })
    const deptoC = await prisma.departamento.create({ data: { empresaId:empresaC.id, nombre:'XL DEPT C', activo:true } })
    const catA = await prisma.categoria.create({ data: { empresaId:empresaA.id, departamentoId:deptoA.id, nombre:'XL Cat A' } })
    const catB = await prisma.categoria.create({ data: { empresaId:empresaB.id, departamentoId:deptoB.id, nombre:'XL Cat B' } })
    const catC = await prisma.categoria.create({ data: { empresaId:empresaC.id, departamentoId:deptoC.id, nombre:'XL Cat C' } })

    clienteA = await prisma.cliente.create({ data: { empresaId:empresaA.id, nombre:'Cliente A', tipo:'REGISTRADO', saldoPendiente:100, limiteCredito:1000, activo:true } })
    clienteB = await prisma.cliente.create({ data: { empresaId:empresaB.id, nombre:'Cliente B', tipo:'REGISTRADO', saldoPendiente:200, limiteCredito:1000, activo:true } })
    clienteC = await prisma.cliente.create({ data: { empresaId:empresaC.id, nombre:'Cliente C', tipo:'REGISTRADO', saldoPendiente:300, limiteCredito:1000, activo:true } })

    productoA = await prisma.producto.create({ data: { empresaId:empresaA.id, nombre:'Producto A', codigoInterno:'XL-A-001', precioBase:50, precioVenta:58, margen:16, claveSat:'31161500', unidadSat:'H87', activo:true, categoriaId:catA.id } })
    productoB = await prisma.producto.create({ data: { empresaId:empresaB.id, nombre:'Producto B', codigoInterno:'XL-B-001', precioBase:80, precioVenta:92.8, margen:16, claveSat:'31161500', unidadSat:'H87', activo:true, categoriaId:catB.id } })
    productoC = await prisma.producto.create({ data: { empresaId:empresaC.id, nombre:'Producto C', codigoInterno:'XL-C-001', precioBase:120, precioVenta:139.2, margen:16, claveSat:'31161500', unidadSat:'H87', activo:true, categoriaId:catC.id } })

    proveedorA = await prisma.proveedor.create({ data: { empresaId:empresaA.id, nombreOficial:'Prov A', alias:'provA', activo:true } })
    proveedorB = await prisma.proveedor.create({ data: { empresaId:empresaB.id, nombreOficial:'Prov B', alias:'provB', activo:true } })
    proveedorC = await prisma.proveedor.create({ data: { empresaId:empresaC.id, nombreOficial:'Prov C', alias:'provC', activo:true } })

    turnoA = await prisma.turnoCaja.create({ data: { empresaId:empresaA.id, sucursalId:sucursalA1.id, usuarioId:superA.id, montoInicial:100, abierto:true } })
    turnoB = await prisma.turnoCaja.create({ data: { empresaId:empresaB.id, sucursalId:sucursalB1.id, usuarioId:superB.id, montoInicial:100, abierto:true } })
    turnoC = await prisma.turnoCaja.create({ data: { empresaId:empresaC.id, sucursalId:sucursalC1.id, usuarioId:superC.id, montoInicial:100, abierto:true } })

    // ── Listados por empresa ───────────────────────────────────────
    bitacoraA = await prisma.bitacora.create({ data: { empresaId:empresaA.id, folio:'XL-BIT-001', clienteId:clienteA.id, sucursalId:sucursalA1.id, usuarioId:superA.id, estado:'ABIERTA', origen:'VENTA', totalMateriales:50, saldoPendiente:50, titulo:'BitSky A' } })
    bitacoraB = await prisma.bitacora.create({ data: { empresaId:empresaB.id, folio:'XL-BIT-002', clienteId:clienteB.id, sucursalId:sucursalB1.id, usuarioId:superB.id, estado:'ABIERTA', origen:'VENTA', totalMateriales:80, saldoPendiente:80, titulo:'BitSky B' } })
    bitacoraC = await prisma.bitacora.create({ data: { empresaId:empresaC.id, folio:'XL-BIT-003', clienteId:clienteC.id, sucursalId:sucursalC1.id, usuarioId:superC.id, estado:'ABIERTA', origen:'VENTA', totalMateriales:120, saldoPendiente:120, titulo:'BitSky C' } })

    pedidoA = await prisma.pedido.create({ data: { empresaId:empresaA.id, folio:'XL-PED-001', sucursalId:sucursalA1.id, usuarioId:superA.id, clienteId:clienteA.id, totalEstimado:50 } })
    pedidoB = await prisma.pedido.create({ data: { empresaId:empresaB.id, folio:'XL-PED-002', sucursalId:sucursalB1.id, usuarioId:superB.id, clienteId:clienteB.id, totalEstimado:80 } })
    pedidoC = await prisma.pedido.create({ data: { empresaId:empresaC.id, folio:'XL-PED-003', sucursalId:sucursalC1.id, usuarioId:superC.id, clienteId:clienteC.id, totalEstimado:120 } })

    ocA = await prisma.ordenCompra.create({ data: { empresaId:empresaA.id, folio:'XL-OC-001', sucursalId:sucursalA1.id, proveedorId:proveedorA.id, usuarioId:superA.id, totalEstimado:50 } })
    ocB = await prisma.ordenCompra.create({ data: { empresaId:empresaB.id, folio:'XL-OC-002', sucursalId:sucursalB1.id, proveedorId:proveedorB.id, usuarioId:superB.id, totalEstimado:80 } })
    ocC = await prisma.ordenCompra.create({ data: { empresaId:empresaC.id, folio:'XL-OC-003', sucursalId:sucursalC1.id, proveedorId:proveedorC.id, usuarioId:superC.id, totalEstimado:120 } })

    cotizacionA = await prisma.cotizacion.create({ data: { empresaId:empresaA.id, folio:'XL-COT-001', sucursalId:sucursalA1.id, usuarioId:superA.id, clienteId:clienteA.id, total:50, estado:'PENDIENTE' } })
    cotizacionB = await prisma.cotizacion.create({ data: { empresaId:empresaB.id, folio:'XL-COT-002', sucursalId:sucursalB1.id, usuarioId:superB.id, clienteId:clienteB.id, total:80, estado:'PENDIENTE' } })
    cotizacionC = await prisma.cotizacion.create({ data: { empresaId:empresaC.id, folio:'XL-COT-003', sucursalId:sucursalC1.id, usuarioId:superC.id, clienteId:clienteC.id, total:120, estado:'PENDIENTE' } })

    ventaA = await prisma.venta.create({ data: { empresaId:empresaA.id, folio:'XL-V-001', sucursalId:sucursalA1.id, usuarioId:superA.id, clienteId:clienteA.id, turnoId:turnoA.id, metodoPago:'EFECTIVO', subtotal:50, total:58, tokenQr:'xl-qr-001' } })
    ventaB = await prisma.venta.create({ data: { empresaId:empresaB.id, folio:'XL-V-002', sucursalId:sucursalB1.id, usuarioId:superB.id, clienteId:clienteB.id, turnoId:turnoB.id, metodoPago:'EFECTIVO', subtotal:80, total:92.8, tokenQr:'xl-qr-002' } })
    ventaC = await prisma.venta.create({ data: { empresaId:empresaC.id, folio:'XL-V-003', sucursalId:sucursalC1.id, usuarioId:superC.id, clienteId:clienteC.id, turnoId:turnoC.id, metodoPago:'EFECTIVO', subtotal:120, total:139.2, tokenQr:'xl-qr-003' } })

    devolucionA = await prisma.devolucion.create({ data: { empresaId:empresaA.id, ventaId:ventaA.id, sucursalId:sucursalA1.id, usuarioId:superA.id, motivo:'Prueba A', tipoReembolso:'REEMBOLSO', montoReembolso:10, reintegraInventario:true } })
    devolucionB = await prisma.devolucion.create({ data: { empresaId:empresaB.id, ventaId:ventaB.id, sucursalId:sucursalB1.id, usuarioId:superB.id, motivo:'Prueba B', tipoReembolso:'REEMBOLSO', montoReembolso:5, reintegraInventario:true } })
    devolucionC = await prisma.devolucion.create({ data: { empresaId:empresaC.id, ventaId:ventaC.id, sucursalId:sucursalC1.id, usuarioId:superC.id, motivo:'Prueba C', tipoReembolso:'REEMBOLSO', montoReembolso:15, reintegraInventario:true } })

    turnoCerradoA = await prisma.turnoCaja.create({ data: { empresaId:empresaA.id, sucursalId:sucursalA1.id, usuarioId:superA.id, montoInicial:50, abierto:false, montoFinalDeclarado:75, montoCalculado:75, diferencia:0, cerradaEn:new Date() } })
    turnoCerradoB = await prisma.turnoCaja.create({ data: { empresaId:empresaB.id, sucursalId:sucursalB1.id, usuarioId:superB.id, montoInicial:60, abierto:false, montoFinalDeclarado:93, montoCalculado:93, diferencia:0, cerradaEn:new Date() } })
    turnoCerradoC = await prisma.turnoCaja.create({ data: { empresaId:empresaC.id, sucursalId:sucursalC1.id, usuarioId:superC.id, montoInicial:70, abierto:false, montoFinalDeclarado:110, montoCalculado:110, diferencia:0, cerradaEn:new Date() } })

    tokenSuperA = signToken(superA.id, 'SUPERADMIN')
    tokenSuperB = signToken(superB.id, 'SUPERADMIN')
    tokenSuperC = signToken(superC.id, 'SUPERADMIN')

    app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve() }) })
  })

  async function dropDatabase(name) {
    for (let i = 0; i < 8; i++) {
      try { await adminPool.query(`DROP DATABASE "${name}"`); return true } catch (e) { await new Promise((r) => setTimeout(r, 1000)) }
    }
    return false
  }

  after(async () => {
    if (server) { try { await new Promise((r) => server.close(r)) } catch(e){} }
    if (prisma) { try { await prisma.$disconnect() } catch(e){} }
    if (prisma?.pool) { try { await prisma.pool.end() } catch(e){} }
    await new Promise((r) => setTimeout(r, 1500))
    delete require.cache[require.resolve('../src/app')]
    delete require.cache[require.resolve('../src/lib/prisma')]
    if (created) {
      try { await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]) } catch(e){}
      const ok = await dropDatabase(dbName)
      if (!ok) console.error('⚠️ DROP DATABASE falló tras reintentos:', dbName)
    }
    try { await adminPool.end() } catch(e){}
  })

  async function send(method, path, token, body) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' }
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  const collectionOf = (entity, res) =>
    Array.isArray(res.body.data) ? res.body.data
      : (res.body.data && Array.isArray(res.body.data.turnos)) ? res.body.data.turnos
      : Array.isArray(res.body.cotizaciones) ? res.body.cotizaciones
      : []
  const idsOf = (entity, res) => collectionOf(entity, res).map(x => x.id)

  // ═══════════════════════════════════════════════════════════════
  // 1. PEDIDOS — GET /pedidos (scope + shape + NaN paginación)
  // ═══════════════════════════════════════════════════════════════
  it('1. pedidos (A) → solo pedidoA, sin pedidoB ni pedidoC', async () => {
    const res = await send('GET', '/pedidos', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('pedido', res), [pedidoA.id])
  })

  it('2. pedidos (B) → solo pedidoB', async () => {
    const res = await send('GET', '/pedidos', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('pedido', res), [pedidoB.id])
  })

  it('3. pedidos (C) → solo pedidoC (inquilino C aislado)', async () => {
    const res = await send('GET', '/pedidos', tokenSuperC)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('pedido', res), [pedidoC.id])
  })

  it('4. pedidos filtrando por estado sin coincidencias → 200 (no 404), total 0', async () => {
    const res = await send('GET', '/pedidos?estado=BLOQUEADO', tokenSuperA)
    assert.strictEqual(res.status, 200, 'jamás 404 por resultado vacío')
    assert.strictEqual(res.body.total, 0)
    assert.deepStrictEqual(collectionOf('pedido', res), [])
  })

  // ═══════════════════════════════════════════════════════════════
  // 2. COMPRAS — GET /compras
  // ═══════════════════════════════════════════════════════════════
  it('5. compras (A) → solo ocA', async () => {
    const res = await send('GET', '/compras', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('oc', res), [ocA.id])
  })

  it('6. compras (B) → solo ocB', async () => {
    const res = await send('GET', '/compras', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('oc', res), [ocB.id])
  })

  it('7. compras (C) → solo ocC', async () => {
    const res = await send('GET', '/compras', tokenSuperC)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('oc', res), [ocC.id])
  })

  it('8. compras con estado sin coincidencias → 200 (no 404), total 0', async () => {
    const res = await send('GET', '/compras?estado=CANCELADO', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 0)
  })

  // ═══════════════════════════════════════════════════════════════
  // 3. BITÁCORAS — GET /bitacoras (+ full-text scoped + NaN)
  // ═══════════════════════════════════════════════════════════════
  it('9. bitacoras (A) → solo bitacoraA', async () => {
    const res = await send('GET', '/bitacoras', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('bit', res), [bitacoraA.id])
  })

  it('10. bitacoras (B) → solo bitacoraB', async () => {
    const res = await send('GET', '/bitacoras', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('bit', res), [bitacoraB.id])
  })

  it('11. bitacoras (C) → solo bitacoraC', async () => {
    const res = await send('GET', '/bitacoras', tokenSuperC)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('bit', res), [bitacoraC.id])
  })

  it('12. bitacoras full-text (A) con término propio exclusivo → solo A', async () => {
    const res = await send('GET', '/bitacoras?buscar=A', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(idsOf('bit', res), [bitacoraA.id])
  })

  it('13. bitacoras full-text (A) con término "Sky" presente en A/B/C → NO arrastra B ni C', async () => {
    const res = await send('GET', '/bitacoras?buscar=Sky', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1, 'el full-text debe respetar el scope de empresa')
    assert.deepStrictEqual(idsOf('bit', res), [bitacoraA.id])
  })

  it('14. bitacoras full-text (C) con término compartido → solo C', async () => {
    const res = await send('GET', '/bitacoras?buscar=Sky', tokenSuperC)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('bit', res), [bitacoraC.id])
  })

  // ═══════════════════════════════════════════════════════════════
  // 4. COTIZACIONES — GET /cotizaciones (envelope propio)
  // ═══════════════════════════════════════════════════════════════
  it('15. cotizaciones (A) → solo cotizacionA', async () => {
    const res = await send('GET', '/cotizaciones', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('cot', res), [cotizacionA.id])
  })

  it('16. cotizaciones (B) → solo cotizacionB', async () => {
    const res = await send('GET', '/cotizaciones', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('cot', res), [cotizacionB.id])
  })

  it('17. cotizaciones (C) → solo cotizacionC', async () => {
    const res = await send('GET', '/cotizaciones', tokenSuperC)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('cot', res), [cotizacionC.id])
  })

  it('18. cotizaciones con estado sin coincidencias → 200 (no 404), total 0', async () => {
    const res = await send('GET', '/cotizaciones?estado=CONVERTIDA', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 0)
  })

  // ═══════════════════════════════════════════════════════════════
  // 5. DEVOLUCIONES — GET /devoluciones
  // ═══════════════════════════════════════════════════════════════
  it('19. devoluciones (A) → solo devolucionA', async () => {
    const res = await send('GET', '/devoluciones', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('dev', res), [devolucionA.id])
  })

  it('20. devoluciones (B) → solo devolucionB', async () => {
    const res = await send('GET', '/devoluciones', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('dev', res), [devolucionB.id])
  })

  it('21. devoluciones (C) → solo devolucionC', async () => {
    const res = await send('GET', '/devoluciones', tokenSuperC)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('dev', res), [devolucionC.id])
  })

  it('22. devoluciones sin resultados → 200 (no 404), total 0', async () => {
    const res = await send('GET', '/devoluciones?ventaId=999999', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 0)
  })

  // ═══════════════════════════════════════════════════════════════
  // 6. TURNOS — historial (cerrados) scoped
  // ═══════════════════════════════════════════════════════════════
  it('23. turnos historial (A) → solo turnoCerradoA', async () => {
    const res = await send('GET', '/turnos-caja/historial', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.pagination.total, 1)
    assert.strictEqual(res.body.data.turnos[0].id, turnoCerradoA.id)
    assert.ok(!res.body.data.turnos.some(t => t.id === turnoCerradoB.id || t.id === turnoCerradoC.id))
  })

  it('24. turnos historial (B) → solo turnoCerradoB', async () => {
    const res = await send('GET', '/turnos-caja/historial', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.pagination.total, 1)
    assert.strictEqual(res.body.data.turnos[0].id, turnoCerradoB.id)
  })

  it('25. turnos historial (C) → solo turnoCerradoC', async () => {
    const res = await send('GET', '/turnos-caja/historial', tokenSuperC)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.pagination.total, 1)
    assert.strictEqual(res.body.data.turnos[0].id, turnoCerradoC.id)
  })

  it('26. turnos historial sin coincidencias (fecha sin turnos) → 200, no 404', async () => {
    const res = await send('GET', '/turnos-caja/historial?fecha=2000-01-01', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.pagination.total, 0)
  })

  // ═══════════════════════════════════════════════════════════════
  // 7. NaN en paginación → NUNCA 500 (defecto real: parseInt(limit))
  // ═══════════════════════════════════════════════════════════════
  it('27. pedidos?limit=abc → 200 (take sanitizado, no 500)', async () => {
    const res = await send('GET', '/pedidos?limit=abc', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
  })

  it('28. compras?limit=abc&page=abc → 200 (no 500)', async () => {
    const res = await send('GET', '/compras?limit=abc&page=abc', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
  })

  it('29. bitacoras?limit=abc&page=abc → 200 (no 500) — defecto clásico corregido', async () => {
    const res = await send('GET', '/bitacoras?limit=abc&page=abc', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
  })

  it('30. cotizaciones?limit=abc&page=abc → 200 (no 500)', async () => {
    const res = await send('GET', '/cotizaciones?limit=abc&page=abc', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
  })

  it('31. devoluciones?take=abc&skip=abc → 200 (no 500)', async () => {
    const res = await send('GET', '/devoluciones?take=abc&skip=abc', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
  })

  // ═══════════════════════════════════════════════════════════════
  // 8. Shape contrato + auth + integridad de tenants
  // ═══════════════════════════════════════════════════════════════
  it('32. cada listado responde envelope con array + total (nunca 404 por vacío)', async () => {
    const hits = [
      ['GET', '/pedidos', tokenSuperA],
      ['GET', '/compras', tokenSuperA],
      ['GET', '/bitacoras', tokenSuperA],
      ['GET', '/cotizaciones', tokenSuperA],
      ['GET', '/devoluciones', tokenSuperA]
    ]
    for (const [m, p, t] of hits) {
      const res = await send(m, p, t)
      assert.strictEqual(res.status, 200, `${p} debe responder 200 con dataset`)
      const coleccion = collectionOf(p, res)
      assert.ok(Array.isArray(coleccion), `${p} debe devolver array`)
      assert.ok(typeof res.body.total === 'number', `${p} debe incluir total`)
    }
  })

  it('33. sin token → 401 en todos los endpoints de listado', async () => {
    const rutas = ['/pedidos','/compras','/bitacoras','/cotizaciones','/devoluciones','/turnos-caja/historial']
    for (const p of rutas) {
      const res = await fetch(`${baseUrl}${p}`, { method:'GET', headers: { 'Content-Type':'application/json' } })
      assert.strictEqual(res.status, 401, `${p} debe responder 401`)
    }
  })

  it('34. Empresa C intacta después de operar A y B (aislamiento sin mutación)', async () => {
    assert.strictEqual(await prisma.pedido.count({ where: { empresaId:empresaC.id } }), 1)
    assert.strictEqual(await prisma.ordenCompra.count({ where: { empresaId:empresaC.id } }), 1)
    assert.strictEqual(await prisma.bitacora.count({ where: { empresaId:empresaC.id } }), 1)
    assert.strictEqual(await prisma.cotizacion.count({ where: { empresaId:empresaC.id } }), 1)
    assert.strictEqual(await prisma.devolucion.count({ where: { empresaId:empresaC.id } }), 1)
    assert.strictEqual(await prisma.turnoCaja.count({ where: { empresaId:empresaC.id } }), 2, 'turnoC abierto + turnoCerradoC')
  })

  it('35. ningún enrollado cross-tenant: ids de A/B nunca aparecen en listados de otro inquilino', async () => {
    const crucigramas = [
      ['/pedidos', tokenSuperA, [pedidoB.id, pedidoC.id]],
      ['/pedidos', tokenSuperB, [pedidoA.id, pedidoC.id]],
      ['/compras', tokenSuperA, [ocB.id, ocC.id]],
      ['/bitacoras', tokenSuperA, [bitacoraB.id, bitacoraC.id]],
      ['/cotizaciones', tokenSuperB, [cotizacionA.id, cotizacionC.id]],
      ['/devoluciones', tokenSuperC, [devolucionA.id, devolucionB.id]]
    ]
    for (const [p, t, ajenos] of crucigramas) {
      const res = await send('GET', p, t)
      assert.strictEqual(res.status, 200)
      const ids = idsOf(p, res)
      for (const ajeno of ajenos) {
        assert.ok(!ids.includes(ajeno), `${p} no debe incluir id ajeno ${ajeno}`)
      }
    }
  })

  it('36. full-text no filtra cross-tenant aunque el término coincida en varias empresas', async () => {
    const res = await send('GET', '/bitacoras?buscar=Sky', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.deepStrictEqual(idsOf('bit', res), [bitacoraB.id])
  })
})
