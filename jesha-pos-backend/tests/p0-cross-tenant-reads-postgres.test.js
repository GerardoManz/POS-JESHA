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
const DB_PREFIX = 'jesha_p0_reads_test_'
const DB_RE = /^jesha_p0_reads_test_[a-z0-9_]+$/
const TENANT_SECRET = 'reads-postgres-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-reads-test'
const TENANT_AUDIENCE = 'jesha-reads-api-test'

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

// Las secuencias de folios son manuales (no viven en schema.prisma ni en
// migraciones). La BD temporal necesita crearlas para que los endpoints
// que llaman nextval() funcionen igual que en producción.
async function createFolioSequences(databaseUrl) {
  const seqNames = [
    'folio_bitacora_seq',
    'folio_compra_seq',
    'folio_cotizacion_seq',
    'folio_devolucion_seq',
    'folio_pedido_seq',
    'folio_venta_seq'
  ]
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    for (const name of seqNames) {
      await client.query(`CREATE SEQUENCE IF NOT EXISTS "${name}" START WITH 1000`)
    }
  } finally {
    await client.end()
  }
}

describe('P0-CROSS-TENANT-READS PostgreSQL HTTP', { concurrency:1, timeout:300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig,'postgres'), max:1 })
  let created = false, prisma, app, server, baseUrl

  let empresaA, empresaB, sucursalA1, sucursalB1
  let catA, catB, deptoA, deptoB
  let clienteA, clienteB
  let productoA, productoB
  let proveedorA, proveedorB
  let superA, superB
  let turnoA, turnoB
  let ventaA, ventaB, ventaA2
  let bitacoraA, bitacoraB
  let pedidoA, pedidoB
  let ocA, ocB
  let cotizacionA, cotizacionB, cotizacionAVencida, cotizacionBVencida
  let devolucionA, devolucionB
  let turnoCerradoA, turnoCerradoB, ventaCerradaA, ventaLeakB
  let tokenSuperA, tokenSuperB

  function signToken(userId, rol) {
    return jwt.sign({ version:1, kind:'TENANT', sub:userId, rol }, TENANT_SECRET, { algorithm:'HS256', issuer:TENANT_ISSUER, audience:TENANT_AUDIENCE, expiresIn:'30m' })
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'reads-platform-secret-'.padEnd(64,'p')
    process.env.PLATFORM_JWT_ISSUER = 'reads-platform-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'reads-platform-api-test'
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
    process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
    process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'
    process.env.DEBUG_ENABLED = 'false'

    await adminPool.query(`CREATE DATABASE "${dbName}"`)
    created = true
    dbPush(databaseUrl)
    await createFolioSequences(databaseUrl)

    prisma = require('../src/lib/prisma')
    const hash = await bcrypt.hash('password', 10)

    empresaA = await prisma.empresa.create({ data: { slug:'rd-a', nombreComercial:'RD A', razonSocial:'RD A SA de CV', whatsapp:'0000000201', activa:true } })
    empresaB = await prisma.empresa.create({ data: { slug:'rd-b', nombreComercial:'RD B', razonSocial:'RD B SA de CV', whatsapp:'0000000202', activa:true } })

    sucursalA1 = await prisma.sucursal.create({ data: { empresaId:empresaA.id, nombre:'A1', codigoPostal:'00001', activa:true } })
    sucursalB1 = await prisma.sucursal.create({ data: { empresaId:empresaB.id, nombre:'B1', codigoPostal:'00002', activa:true } })

    superA = await prisma.usuario.create({ data: { nombre:'Super A', username:'rd.supa', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaA.id, sucursalId:null } })
    superB = await prisma.usuario.create({ data: { nombre:'Super B', username:'rd.supb', passwordHash:hash, rol:'SUPERADMIN', activo:true, empresaId:empresaB.id, sucursalId:null } })

    deptoA = await prisma.departamento.create({ data: { empresaId:empresaA.id, nombre:'RD DEPT A', activo:true } })
    deptoB = await prisma.departamento.create({ data: { empresaId:empresaB.id, nombre:'RD DEPT B', activo:true } })
    catA = await prisma.categoria.create({ data: { empresaId:empresaA.id, departamentoId:deptoA.id, nombre:'RD Cat A' } })
    catB = await prisma.categoria.create({ data: { empresaId:empresaB.id, departamentoId:deptoB.id, nombre:'RD Cat B' } })

    clienteA = await prisma.cliente.create({ data: { empresaId:empresaA.id, nombre:'Cliente A', tipo:'REGISTRADO', saldoPendiente:100, limiteCredito:1000, activo:true } })
    clienteB = await prisma.cliente.create({ data: { empresaId:empresaB.id, nombre:'Cliente B', tipo:'REGISTRADO', saldoPendiente:200, limiteCredito:1000, activo:true } })

    productoA = await prisma.producto.create({ data: { empresaId:empresaA.id, nombre:'Producto A', codigoInterno:'RD-A-001', precioBase:50, precioVenta:58, margen:16, categoriaId:catA.id, claveSat:'31161500', unidadSat:'H87', activo:true } })
    productoB = await prisma.producto.create({ data: { empresaId:empresaB.id, nombre:'Producto B', codigoInterno:'RD-B-001', precioBase:80, precioVenta:92.8, margen:16, categoriaId:catB.id, claveSat:'31161500', unidadSat:'H87', activo:true } })

    await prisma.inventarioSucursal.create({ data: { productoId:productoA.id, sucursalId:sucursalA1.id, stockActual:10, stockMinimoAlerta:2 } })
    await prisma.inventarioSucursal.create({ data: { productoId:productoB.id, sucursalId:sucursalB1.id, stockActual:10, stockMinimoAlerta:2 } })

    proveedorA = await prisma.proveedor.create({ data: { empresaId:empresaA.id, nombreOficial:'Prov A', alias:'provA', activo:true } })
    proveedorB = await prisma.proveedor.create({ data: { empresaId:empresaB.id, nombreOficial:'Prov B', alias:'provB', activo:true } })

    turnoA = await prisma.turnoCaja.create({ data: { empresaId:empresaA.id, sucursalId:sucursalA1.id, usuarioId:superA.id, montoInicial:100, abierto:true } })
    turnoB = await prisma.turnoCaja.create({ data: { empresaId:empresaB.id, sucursalId:sucursalB1.id, usuarioId:superB.id, montoInicial:100, abierto:true } })

    ventaA = await prisma.venta.create({
      data: {
        empresaId:empresaA.id, folio:'RD-V-001', sucursalId:sucursalA1.id, usuarioId:superA.id,
        clienteId:clienteA.id, turnoId:turnoA.id, metodoPago:'EFECTIVO',
        subtotal:50, total:58, tokenQr:'rd-qr-001',
        DetalleVenta: { create: [{ productoId:productoA.id, cantidad:1, precioUnitario:50, subtotal:50 }] }
      }
    })
    ventaB = await prisma.venta.create({
      data: {
        empresaId:empresaB.id, folio:'RD-V-002', sucursalId:sucursalB1.id, usuarioId:superB.id,
        clienteId:clienteB.id, turnoId:turnoB.id, metodoPago:'EFECTIVO',
        subtotal:80, total:92.8, tokenQr:'rd-qr-002',
        DetalleVenta: { create: [{ productoId:productoB.id, cantidad:1, precioUnitario:80, subtotal:80 }] }
      }
    })

    ventaA2 = await prisma.venta.create({
      data: {
        empresaId:empresaA.id, folio:'RD-V-003', sucursalId:sucursalA1.id, usuarioId:superA.id,
        clienteId:null, turnoId:turnoA.id, metodoPago:'EFECTIVO',
        subtotal:100, total:116, tokenQr:'rd-qr-003',
        DetalleVenta: { create: [{ productoId:productoA.id, cantidad:2, precioUnitario:50, subtotal:100 }] }
      }
    })

    bitacoraA = await prisma.bitacora.create({ data: { empresaId:empresaA.id, folio:'RD-BIT-001', clienteId:clienteA.id, sucursalId:sucursalA1.id, usuarioId:superA.id, estado:'ABIERTA', origen:'VENTA', totalMateriales:50, saldoPendiente:50, titulo:'Bit A' } })
    bitacoraB = await prisma.bitacora.create({ data: { empresaId:empresaB.id, folio:'RD-BIT-002', clienteId:clienteB.id, sucursalId:sucursalB1.id, usuarioId:superB.id, estado:'ABIERTA', origen:'VENTA', totalMateriales:80, saldoPendiente:80, titulo:'Bit B' } })

    pedidoA = await prisma.pedido.create({ data: { empresaId:empresaA.id, folio:'RD-PED-001', sucursalId:sucursalA1.id, usuarioId:superA.id, clienteId:clienteA.id, totalEstimado:50 } })
    pedidoB = await prisma.pedido.create({ data: { empresaId:empresaB.id, folio:'RD-PED-002', sucursalId:sucursalB1.id, usuarioId:superB.id, clienteId:clienteB.id, totalEstimado:80 } })

    ocA = await prisma.ordenCompra.create({ data: { empresaId:empresaA.id, folio:'RD-OC-001', sucursalId:sucursalA1.id, proveedorId:proveedorA.id, usuarioId:superA.id, totalEstimado:50 } })
    ocB = await prisma.ordenCompra.create({ data: { empresaId:empresaB.id, folio:'RD-OC-002', sucursalId:sucursalB1.id, proveedorId:proveedorB.id, usuarioId:superB.id, totalEstimado:80 } })

    cotizacionA = await prisma.cotizacion.create({ data: { empresaId:empresaA.id, folio:'RD-COT-001', sucursalId:sucursalA1.id, usuarioId:superA.id, clienteId:clienteA.id, total:50, estado:'PENDIENTE' } })
    cotizacionB = await prisma.cotizacion.create({ data: { empresaId:empresaB.id, folio:'RD-COT-002', sucursalId:sucursalB1.id, usuarioId:superB.id, clienteId:clienteB.id, total:80, estado:'PENDIENTE' } })
    cotizacionAVencida = await prisma.cotizacion.create({ data: { empresaId:empresaA.id, folio:'RD-COT-003', sucursalId:sucursalA1.id, usuarioId:superA.id, clienteId:clienteA.id, total:50, estado:'PENDIENTE', venceEn:new Date(Date.now() - 24*3600*1000) } })

    devolucionA = await prisma.devolucion.create({
      data: {
        empresaId:empresaA.id, ventaId:ventaA.id, sucursalId:sucursalA1.id, usuarioId:superA.id,
        motivo:'Prueba', tipoReembolso:'REEMBOLSO', montoReembolso:10, reintegraInventario:true,
        DetalleDevolucion: { create: [{ productoId:productoA.id, cantidad:1, precioUnitario:10 }] }
      }
    })
    devolucionB = await prisma.devolucion.create({
      data: {
        empresaId:empresaB.id, ventaId:ventaB.id, sucursalId:sucursalB1.id, usuarioId:superB.id,
        motivo:'Prueba B', tipoReembolso:'REEMBOLSO', montoReembolso:5, reintegraInventario:true,
        DetalleDevolucion: { create: [{ productoId:productoB.id, cantidad:1, precioUnitario:5 }] }
      }
    })

    cotizacionBVencida = await prisma.cotizacion.create({ data: { empresaId:empresaB.id, folio:'RD-COT-004', sucursalId:sucursalB1.id, usuarioId:superB.id, clienteId:clienteB.id, total:80, estado:'PENDIENTE', venceEn:new Date(Date.now() - 48*3600*1000) } })

    turnoCerradoA = await prisma.turnoCaja.create({ data: { empresaId:empresaA.id, sucursalId:sucursalA1.id, usuarioId:superA.id, montoInicial:50, abierto:false, montoFinalDeclarado:75, montoCalculado:75, diferencia:0, cerradaEn:new Date() } })
    turnoCerradoB = await prisma.turnoCaja.create({ data: { empresaId:empresaB.id, sucursalId:sucursalB1.id, usuarioId:superB.id, montoInicial:60, abierto:false, montoFinalDeclarado:93, montoCalculado:93, diferencia:0, cerradaEn:new Date() } })

    ventaCerradaA = await prisma.venta.create({
      data: { empresaId:empresaA.id, folio:'RD-V-004', sucursalId:sucursalA1.id, usuarioId:superA.id, clienteId:null, turnoId:turnoCerradoA.id, metodoPago:'EFECTIVO', subtotal:25, total:29, tokenQr:'rd-qr-004' }
    })
    // Registro cross-tenant intencional: pertenece a empresa B pero "vive" en la
    // sucursal/turno que A consulta. Es el peor caso que el scope por empresaId debe cortar.
    ventaLeakB = await prisma.venta.create({
      data: { empresaId:empresaB.id, folio:'RD-V-LEAK', sucursalId:sucursalA1.id, usuarioId:superA.id, clienteId:null, turnoId:turnoCerradoA.id, metodoPago:'EFECTIVO', subtotal:50, total:58, tokenQr:'rd-qr-leak-b' }
    })

    tokenSuperA = signToken(superA.id, 'SUPERADMIN')
    tokenSuperB = signToken(superB.id, 'SUPERADMIN')

    app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve() }) })
  })

  async function dropDatabase(name) {
    // Esperar a que el pool de Prisma libere todas sus conexiones y reintentar
    for (let i = 0; i < 8; i++) {
      try {
        await adminPool.query(`DROP DATABASE "${name}"`)
        return true
      } catch (e) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    return false
  }

  after(async () => {
    if (server) { try { await new Promise((r) => server.close(r)) } catch(e){} }
    if (prisma) { try { await prisma.$disconnect() } catch(e){} }
    await new Promise((r) => setTimeout(r, 1500))
    delete require.cache[require.resolve('../src/app')]
    delete require.cache[require.resolve('../src/lib/prisma')]
    if (created) {
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

  // ═══════════════════════════════════════════════════════════════
  // 1. CLIENTE — GET /clientes/:id
  // ═══════════════════════════════════════════════════════════════
  it('1. A no ve cliente B → 404', async () => {
    const res = await send('GET', `/clientes/${clienteB.id}`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('2. A ve su propio cliente → 200 con datos', async () => {
    const res = await send('GET', `/clientes/${clienteA.id}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.nombre, 'Cliente A')
  })

  // ═══════════════════════════════════════════════════════════════
  // 2. CLIENTE VENTAS — GET /clientes/:id/ventas
  // ═══════════════════════════════════════════════════════════════
  it('3. A no consulta ventas de cliente B → 404 (padre ajeno)', async () => {
    const res = await send('GET', `/clientes/${clienteB.id}/ventas`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('4. A consulta ventas de su cliente → 200 con su venta', async () => {
    const res = await send('GET', `/clientes/${clienteA.id}/ventas`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body), 'debe ser un array')
    assert.strictEqual(res.body.length, 1)
    assert.strictEqual(res.body[0].id, ventaA.id)
  })

  // ═══════════════════════════════════════════════════════════════
  // 3. CLIENTE ABONOS — GET /clientes/:id/abonos
  // ═══════════════════════════════════════════════════════════════
  it('5. A no consulta abonos de cliente B → 404 (padre ajeno)', async () => {
    const res = await send('GET', `/clientes/${clienteB.id}/abonos`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('6. A consulta abonos de su cliente → 200 (array)', async () => {
    const res = await send('GET', `/clientes/${clienteA.id}/abonos`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body))
  })

  // ═══════════════════════════════════════════════════════════════
  // 4. PEDIDO — GET /pedidos/:id
  // ═══════════════════════════════════════════════════════════════
  it('7. A no ve pedido B → 404', async () => {
    const res = await send('GET', `/pedidos/${pedidoB.id}`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('8. A ve su propio pedido → 200', async () => {
    const res = await send('GET', `/pedidos/${pedidoA.id}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.folio, 'RD-PED-001')
  })

  // ═══════════════════════════════════════════════════════════════
  // 5. BITÁCORA — GET /bitacoras/:id
  // ═══════════════════════════════════════════════════════════════
  it('9. A no ve bitácora B → 404', async () => {
    const res = await send('GET', `/bitacoras/${bitacoraB.id}`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('10. A ve su propia bitácora → 200', async () => {
    const res = await send('GET', `/bitacoras/${bitacoraA.id}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.folio, 'RD-BIT-001')
  })

  // ═══════════════════════════════════════════════════════════════
  // 6. COMPRA — GET /compras/:id
  // ═══════════════════════════════════════════════════════════════
  it('11. A no ve orden de compra B → 404', async () => {
    const res = await send('GET', `/compras/${ocB.id}`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('12. A ve su propia orden de compra → 200', async () => {
    const res = await send('GET', `/compras/${ocA.id}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.folio, 'RD-OC-001')
  })

  // ═══════════════════════════════════════════════════════════════
  // 7. COTIZACIÓN — GET /cotizaciones/:id (+ auto-vencimiento scoped)
  // ═══════════════════════════════════════════════════════════════
  it('13. A no ve cotización B → 404', async () => {
    const res = await send('GET', `/cotizaciones/${cotizacionB.id}`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('14. A ve su propia cotización → 200', async () => {
    const res = await send('GET', `/cotizaciones/${cotizacionA.id}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.folio, 'RD-COT-001')
  })

  it('15. A auto-vence SU cotización expirada, NO la de B', async () => {
    const antes = await prisma.cotizacion.findUnique({ where: { id: cotizacionB.id }, select: { estado: true } })
    const res = await send('GET', `/cotizaciones/${cotizacionAVencida.id}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    const vencida = await prisma.cotizacion.findUnique({ where: { id: cotizacionAVencida.id }, select: { estado: true } })
    assert.strictEqual(vencida.estado, 'VENCIDA', 'la cotización de A debe vencerse')
    const despues = await prisma.cotizacion.findUnique({ where: { id: cotizacionB.id }, select: { estado: true } })
    assert.strictEqual(despues.estado, antes.estado, 'la cotización de B no debe ser tocada')
  })

  // ═══════════════════════════════════════════════════════════════
  // 8. DEVOLUCIÓN crear — POST /devoluciones
  // ═══════════════════════════════════════════════════════════════
  it('16. A no devuelve productos de venta B → 404 sin efectos', async () => {
    const stockAntes = parseFloat((await prisma.inventarioSucursal.findUnique({ where: { productoId_sucursalId: { productoId:productoB.id, sucursalId:sucursalB1.id } } })).stockActual)
    const movB = await prisma.movimientoInventario.count({ where: { empresaId:empresaB.id } })
    const devB = await prisma.devolucion.count({ where: { ventaId:ventaB.id } })
    const res = await send('POST', '/devoluciones', tokenSuperA, {
      ventaId: ventaB.id, motivo:'X-Tenant', tipoReembolso:'REEMBOLSO',
      productos: [{ productoId:productoB.id, cantidad:1 }]
    })
    assert.strictEqual(res.status, 404)
    const stockDespues = parseFloat((await prisma.inventarioSucursal.findUnique({ where: { productoId_sucursalId: { productoId:productoB.id, sucursalId:sucursalB1.id } } })).stockActual)
    assert.strictEqual(stockDespues, stockAntes, 'stock de B no debe cambiar')
    assert.strictEqual(await prisma.movimientoInventario.count({ where: { empresaId:empresaB.id } }), movB, 'sin movimientos nuevos en B')
    assert.strictEqual(await prisma.devolucion.count({ where: { ventaId:ventaB.id } }), devB, 'sin devolución nueva sobre venta B')
  })

  it('17. A devuelve de SU propia venta → 201', async () => {
    const res = await send('POST', '/devoluciones', tokenSuperA, {
      ventaId: ventaA2.id, motivo:'Devolución válida', tipoReembolso:'REEMBOLSO',
      productos: [{ productoId:productoA.id, cantidad:1 }]
    })
    assert.strictEqual(res.status, 201)
  })

  it('18. A no devuelve de venta inexistente → 404', async () => {
    const res = await send('POST', '/devoluciones', tokenSuperA, {
      ventaId: 999999, motivo:'X', tipoReembolso:'REEMBOLSO',
      productos: [{ productoId:productoA.id, cantidad:1 }]
    })
    assert.strictEqual(res.status, 404)
  })

  // ═══════════════════════════════════════════════════════════════
  // 9. DEVOLUCIÓN porVenta — GET /devoluciones/venta/:ventaId
  // ═══════════════════════════════════════════════════════════════
  it('19. A no consulta devoluciones de venta B → 404 (padre ajeno)', async () => {
    const res = await send('GET', `/devoluciones/venta/${ventaB.id}`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  it('20. A consulta devoluciones de su venta → 200 con su devolución', async () => {
    const res = await send('GET', `/devoluciones/venta/${ventaA.id}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.ok(Array.isArray(res.body.data), 'data debe ser array')
    assert.ok(res.body.data.some(d => d.id === devolucionA.id), 'debe incluir la devolución de A')
  })

  it('21. A consulta devoluciones de venta inexistente → 404', async () => {
    const res = await send('GET', `/devoluciones/venta/999999`, tokenSuperA)
    assert.strictEqual(res.status, 404)
  })

  // ═══════════════════════════════════════════════════════════════
  // GENERAL — Empresa B intacta + auth
  // ═══════════════════════════════════════════════════════════════
  it('22. Empresa B no fue modificada (stock, ventas, bitácoras)', async () => {
    assert.strictEqual(await prisma.devolucion.count({ where: { empresaId:empresaB.id } }), 1, 'solo la devolución B sembrada (F2)')
    assert.strictEqual(await prisma.movimientoInventario.count({ where: { empresaId:empresaB.id } }), 0, 'sin movimientos en B')
    assert.strictEqual(await prisma.venta.count({ where: { empresaId:empresaB.id } }), 2, 'ventaB + ventaLeakB sembradas (F2)')
    assert.strictEqual(await prisma.bitacora.count({ where: { empresaId:empresaB.id } }), 1, 'solo la bitácora B sembrada')
    assert.strictEqual(await prisma.cotizacion.count({ where: { empresaId:empresaB.id } }), 2, 'cotizacionB + cotizacionBVencida sembradas (F2)')
    const stockB = parseFloat((await prisma.inventarioSucursal.findUnique({ where: { productoId_sucursalId: { productoId:productoB.id, sucursalId:sucursalB1.id } } })).stockActual)
    assert.strictEqual(stockB, 10, 'stock de B intacto')
  })

  it('23. sin token → 401 en todos los endpoints', async () => {
    const rutas = [
      ['GET', `/clientes/${clienteB.id}`],
      ['GET', `/clientes/${clienteB.id}/ventas`],
      ['GET', `/clientes/${clienteB.id}/abonos`],
      ['GET', `/pedidos/${pedidoB.id}`],
      ['GET', `/bitacoras/${bitacoraB.id}`],
      ['GET', `/compras/${ocB.id}`],
      ['GET', `/cotizaciones/${cotizacionB.id}`],
      ['GET', `/devoluciones/venta/${ventaB.id}`],
      ['POST', '/devoluciones']
    ]
    for (const [method, path] of rutas) {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type':'application/json' }, body: method === 'POST' ? JSON.stringify({}) : undefined })
      assert.strictEqual(res.status, 401, `${method} ${path} debe responder 401`)
    }
  })

  // ═══════════════════════════════════════════════════════════════
  // 10. FASE 2 — LISTADOS + SQL CRUDO + TURNOS (scope cross-tenant)
  // ═══════════════════════════════════════════════════════════════
  it('24. GET /pedidos (A) → solo pedidos de A', async () => {
    const res = await send('GET', '/pedidos', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1, 'A solo ve su pedido')
    assert.strictEqual(res.body.data[0].id, pedidoA.id)
    assert.ok(!res.body.data.some(p => p.id === pedidoB.id), 'no filtra pedido de B')
  })

  it('25. GET /compras (A) → solo órdenes de A', async () => {
    const res = await send('GET', '/compras', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1, 'A solo ve su orden de compra')
    assert.strictEqual(res.body.data[0].id, ocA.id)
    assert.ok(!res.body.data.some(o => o.id === ocB.id), 'no filtra orden de B')
  })

  it('26. GET /bitacoras (A) → solo bitácoras de A', async () => {
    const res = await send('GET', '/bitacoras', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1, 'A solo ve su bitácora')
    assert.ok(!res.body.data.some(b => b.id === bitacoraB.id), 'no filtra bitácora de B')
  })

  it('27. GET /bitacoras?buscar= (A) → full-text scoped, no filtra B', async () => {
    const res = await send('GET', '/bitacoras?buscar=Bit', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1, 'el full-text no debe arrastrar la bitácora de B')
    assert.strictEqual(res.body.data[0].id, bitacoraA.id)
  })

  it('28. GET /cotizaciones (A) → solo cotizaciones de A', async () => {
    const res = await send('GET', '/cotizaciones', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 2, 'cotizacionA + cotizacionAVencida, sin las de B')
    assert.ok(!res.body.cotizaciones.some(c => c.id === cotizacionB.id || c.id === cotizacionBVencida.id), 'no filtra cotizaciones de B')
  })

  it('29. Auto-vencer de listar (A) → NO vence la cotización vencida de B', async () => {
    const res = await send('GET', '/cotizaciones', tokenSuperA)
    assert.strictEqual(res.status, 200)
    const bVencida = await prisma.cotizacion.findUnique({ where: { id: cotizacionBVencida.id }, select: { estado: true } })
    assert.strictEqual(bVencida.estado, 'PENDIENTE', 'el $executeRaw de listar no debe tocar cotizaciones de B')
    const aVencida = await prisma.cotizacion.findUnique({ where: { id: cotizacionAVencida.id }, select: { estado: true } })
    assert.strictEqual(aVencida.estado, 'VENCIDA', 'la cotización vencida de A sí debe vencerse')
  })

  it('30. GET /devoluciones (A) → solo devoluciones de A', async () => {
    const res = await send('GET', '/devoluciones', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 2, 'devolucionA + la creada en test 17, nunca la de B')
    assert.ok(!res.body.data.some(d => d.id === devolucionB.id), 'no filtra devolución de B')
  })

  it('31. GET /turnos-caja/historial (A) → solo turnos cerrados de A', async () => {
    const res = await send('GET', '/turnos-caja/historial', tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.pagination.total, 1, 'solo turnoCerradoA')
    assert.strictEqual(res.body.data.turnos[0].id, turnoCerradoA.id)
  })

  it('32. GET /turnos-caja/activo (B) → 404, no ve el turno abierto de A', async () => {
    const res = await send('GET', '/turnos-caja/activo', tokenSuperB)
    assert.strictEqual(res.status, 404, 'B no debe leer el turno de A por el default de sucursal')
  })

  it('33. GET /turnos-caja/resumen (B) → 404, no lee resumen del turno de A', async () => {
    const res = await send('GET', '/turnos-caja/resumen', tokenSuperB)
    assert.strictEqual(res.status, 404)
  })

  it('34. GET /turnos-caja/resumen-contable (A) → excluye ventaLeakB de otra empresa', async () => {
    const hoy = new Date().toISOString().slice(0, 10)
    const res = await send('GET', `/turnos-caja/resumen-contable?fechaDesde=${hoy}&fechaHasta=${hoy}&sucursalId=${sucursalA1.id}`, tokenSuperA)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.data.totales.totalVentas, 1, 'solo ventaCerradaA, nunca ventaLeakB')
    assert.strictEqual(res.body.data.totales.totalGeneral, 29, 'el monto no debe incluir la venta de B')
  })

  it('35. Sanidad: GET /devoluciones (B) → solo devolución de B', async () => {
    const res = await send('GET', '/devoluciones', tokenSuperB)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.total, 1)
    assert.strictEqual(res.body.data[0].id, devolucionB.id)
  })
})
