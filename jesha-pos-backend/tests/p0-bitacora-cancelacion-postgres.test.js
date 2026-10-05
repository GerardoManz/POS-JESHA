'use strict'

const { assertSafeTestDb } = require('./helpers/test-db-safety')
const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const path = require('node:path')
const http = require('node:http')
const pg = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_p0_bitacora_cancelacion_'
const DB_RE = /^jesha_p0_bitacora_cancelacion_[a-z0-9_]+$/
const TENANT_SECRET = 'bitacora-cancelacion-test-secret-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-bitacora-cancelacion-test'
const TENANT_AUDIENCE = 'jesha-bitacora-cancelacion-api-test'
const PLATFORM_SECRET = 'platform-bitacora-test-secret-'.padEnd(64, 'p')
const PLATFORM_ISSUER = 'platform-bitacora-test'
const PLATFORM_AUDIENCE = 'platform-bitacora-api-test'

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Falta variable requerida: ${name}`)
  return value
}

function pgConfig() {
  const host = requiredEnv('P0_TEST_PG_HOST')
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('P0_TEST_PG_HOST debe ser local')
  return {
    host,
    port: Number(requiredEnv('P0_TEST_PG_PORT')),
    user: requiredEnv('P0_TEST_PG_USER'),
    password: requiredEnv('P0_TEST_PG_PASSWORD')
  }
}

function validateDbName(name) {
  if (!DB_RE.test(name) || name === DB_PREFIX) throw new Error('Nombre de base temporal inválido')
  return name
}

function connectionUrl(config, database) {
  const host = config.host === '::1' ? '[::1]' : config.host
  return `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${host}:${config.port}/${database}`
}

function dbPush(databaseUrl) {
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  const command = 'npx prisma db push --schema prisma/schema.prisma'
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd: BACKEND_DIR,
    env,
    stdio: 'pipe',
    timeout: 120000
  })
}

describe('Cancelación de bitácoras PostgreSQL + HTTP real', { concurrency: 1, timeout: 300000 }, () => {
  const config = pgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(config, dbName)
  assertSafeTestDb(databaseUrl)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(config, 'postgres'), max: 1 })

  let created = false
  let prisma
  let server
  let baseUrl
  let seq = 0
  const empresas = {}
  const sucursales = {}
  const usuarios = {}
  const tokens = {}
  const productos = {}
  let trabajador
  let turno

  function token(user, rol) {
    return jwt.sign({ version: 1, kind: 'TENANT', sub: user.id, rol }, TENANT_SECRET, {
      algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '30m'
    })
  }

  async function request(method, route, authToken, branchId, body, extraHeaders = {}) {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders }
    if (authToken) headers.Authorization = `Bearer ${authToken}`
    if (branchId !== undefined && branchId !== null) headers['X-Sucursal-Id'] = String(branchId)
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return {
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      body: await response.json().catch(() => null)
    }
  }

  async function crearCaso({
    empresa = empresas.A,
    sucursal = sucursales.A1,
    usuario = usuarios.superA,
    producto = productos.A,
    origen = 'MANUAL',
    estado = 'ABIERTA',
    cantidad = 2,
    monto = 100,
    inventarioDescontado = true,
    cantidadDescontada = inventarioDescontado ? cantidad : 0,
    stockActual = 8,
    otrasDeudas = 50,
    conInventario = true,
    totalAbonado = 0
  } = {}) {
    seq++
    const folio = `TEST-BIT-${String(seq).padStart(4, '0')}`
    const cliente = await prisma.cliente.create({
      data: {
        empresaId: empresa.id,
        nombre: `Cliente ${seq}`,
        tipo: 'REGISTRADO',
        saldoPendiente: otrasDeudas + monto,
        limiteCredito: 10000,
        activo: true
      }
    })
    if (conInventario) {
      await prisma.inventarioSucursal.upsert({
        where: { productoId_sucursalId: { productoId: producto.id, sucursalId: sucursal.id } },
        create: { productoId: producto.id, sucursalId: sucursal.id, stockActual, stockMinimoAlerta: 0 },
        update: { stockActual }
      })
    } else {
      await prisma.inventarioSucursal.deleteMany({
        where: { productoId: producto.id, sucursalId: sucursal.id }
      })
    }
    const bitacora = await prisma.bitacora.create({
      data: {
        empresaId: empresa.id,
        folio,
        clienteId: cliente.id,
        sucursalId: sucursal.id,
        usuarioId: usuario.id,
        estado,
        origen,
        totalMateriales: monto,
        totalAbonado,
        saldoPendiente: monto,
        titulo: `Caso ${seq}`
      }
    })
    const detalle = await prisma.detalleBitacora.create({
      data: {
        bitacoraId: bitacora.id,
        productoId: producto.id,
        cantidad,
        precioUnitario: monto / cantidad,
        subtotal: monto,
        inventarioDescontado
      }
    })
    if (cantidadDescontada > 0) {
      await prisma.movimientoInventario.create({
        data: {
          empresaId: empresa.id,
          productoId: producto.id,
          sucursalId: sucursal.id,
          usuarioId: usuario.id,
          tipo: 'SALIDA_BITACORA',
          cantidad: cantidadDescontada,
          stockAntes: stockActual + cantidadDescontada,
          stockDespues: stockActual,
          referencia: folio,
          notas: `Fixture ${folio}`
        }
      })
    }
    return { bitacora, cliente, detalle, producto, sucursal, monto, otrasDeudas, stockActual, folio }
  }

  async function snapshot(caso) {
    const [bitacora, cliente, inventario, movimientos, auditorias, abonos] = await Promise.all([
      prisma.bitacora.findUnique({ where: { id: caso.bitacora.id } }),
      prisma.cliente.findUnique({ where: { id: caso.cliente.id } }),
      prisma.inventarioSucursal.findUnique({ where: { productoId_sucursalId: { productoId: caso.producto.id, sucursalId: caso.sucursal.id } } }),
      prisma.movimientoInventario.findMany({ where: { empresaId: caso.bitacora.empresaId, referencia: caso.folio }, orderBy: { id: 'asc' } }),
      prisma.auditoria.findMany({ where: { empresaId: caso.bitacora.empresaId, referencia: { contains: caso.folio } } }),
      prisma.abonoBitacora.findMany({ where: { bitacoraId: caso.bitacora.id } })
    ])
    return { bitacora, cliente, inventario, movimientos, auditorias, abonos }
  }

  async function cancelar(caso, authToken = tokens.superA, branchId = caso.sucursal.id) {
    return request('PATCH', `/bitacoras/${caso.bitacora.id}/estado`, authToken, branchId, {
      estado: 'CANCELADA', motivo: 'Prueba controlada'
    })
  }

  before(async () => {
    await adminPool.query(`CREATE DATABASE "${dbName}"`)
    created = true
    dbPush(databaseUrl)

    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'platform-bitacora-test-secret-'.padEnd(64, 'p')
    process.env.PLATFORM_JWT_ISSUER = 'platform-bitacora-test'
    process.env.PLATFORM_JWT_AUDIENCE = 'platform-bitacora-api-test'
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.CLOUDINARY_CLOUD_NAME = 'test'
    process.env.CLOUDINARY_API_KEY = 'test'
    process.env.CLOUDINARY_API_SECRET = 'test'
    process.env.FACTURAPI_MODE = 'test'
    delete process.env.FACTURAPI_KEY
    delete process.env.FACTURAPI_KEY_TEST
    delete process.env.FACTURAPI_USER_KEY

    prisma = require('../src/lib/prisma')
    if (prisma.pool) prisma.pool.on('error', () => {})
    const hash = await bcrypt.hash('password', 4)

    empresas.A = await prisma.empresa.create({ data: { slug: 'cancel-a', nombreComercial: 'Cancel A', razonSocial: 'Cancel A SA', whatsapp: '1', activa: true } })
    empresas.B = await prisma.empresa.create({ data: { slug: 'cancel-b', nombreComercial: 'Cancel B', razonSocial: 'Cancel B SA', whatsapp: '2', activa: true } })
    sucursales.A1 = await prisma.sucursal.create({ data: { empresaId: empresas.A.id, nombre: 'A1', codigoPostal: '00001', activa: true } })
    sucursales.A2 = await prisma.sucursal.create({ data: { empresaId: empresas.A.id, nombre: 'A2', codigoPostal: '00002', activa: true } })
    sucursales.B1 = await prisma.sucursal.create({ data: { empresaId: empresas.B.id, nombre: 'B1', codigoPostal: '00003', activa: true } })

    usuarios.superA = await prisma.usuario.create({ data: { nombre: 'Super A', username: 'cancel.super.a', passwordHash: hash, rol: 'SUPERADMIN', activo: true, empresaId: empresas.A.id, sucursalId: null } })
    usuarios.adminA1 = await prisma.usuario.create({ data: { nombre: 'Admin A1', username: 'cancel.admin.a1', passwordHash: hash, rol: 'ADMIN_SUCURSAL', activo: true, empresaId: empresas.A.id, sucursalId: sucursales.A1.id } })
    usuarios.adminA2 = await prisma.usuario.create({ data: { nombre: 'Admin A2', username: 'cancel.admin.a2', passwordHash: hash, rol: 'ADMIN_SUCURSAL', activo: true, empresaId: empresas.A.id, sucursalId: sucursales.A2.id } })
    usuarios.preciosA = await prisma.usuario.create({ data: { nombre: 'Precios A', username: 'cancel.precios.a', passwordHash: hash, rol: 'PRECIOS', activo: true, empresaId: empresas.A.id, sucursalId: null } })
    usuarios.superB = await prisma.usuario.create({ data: { nombre: 'Super B', username: 'cancel.super.b', passwordHash: hash, rol: 'SUPERADMIN', activo: true, empresaId: empresas.B.id, sucursalId: null } })
    usuarios.platform = await prisma.usuario.create({ data: { nombre: 'Platform', username: 'cancel.platform', passwordHash: hash, rol: 'PLATFORM_ADMIN', activo: true, empresaId: null, sucursalId: null } })
    tokens.superA = token(usuarios.superA, 'SUPERADMIN')
    tokens.adminA1 = token(usuarios.adminA1, 'ADMIN_SUCURSAL')
    tokens.adminA2 = token(usuarios.adminA2, 'ADMIN_SUCURSAL')
    tokens.preciosA = token(usuarios.preciosA, 'PRECIOS')
    tokens.superB = token(usuarios.superB, 'SUPERADMIN')
    tokens.delegatedA = jwt.sign({ version: 1, kind: 'DELEGATED', sub: usuarios.platform.id, rol: 'PLATFORM_ADMIN', targetEmpresaId: empresas.A.id }, PLATFORM_SECRET, {
      algorithm: 'HS256', issuer: PLATFORM_ISSUER, audience: PLATFORM_AUDIENCE, expiresIn: '30m'
    })
    tokens.platform = jwt.sign({ version: 1, kind: 'PLATFORM', sub: usuarios.platform.id, rol: 'PLATFORM_ADMIN' }, PLATFORM_SECRET, {
      algorithm: 'HS256', issuer: PLATFORM_ISSUER, audience: PLATFORM_AUDIENCE, expiresIn: '30m'
    })

    const deptA = await prisma.departamento.create({ data: { empresaId: empresas.A.id, nombre: 'Cancel Dept A', activo: true } })
    const deptB = await prisma.departamento.create({ data: { empresaId: empresas.B.id, nombre: 'Cancel Dept B', activo: true } })
    const catA = await prisma.categoria.create({ data: { empresaId: empresas.A.id, departamentoId: deptA.id, nombre: 'Cancel Cat A' } })
    const catB = await prisma.categoria.create({ data: { empresaId: empresas.B.id, departamentoId: deptB.id, nombre: 'Cancel Cat B' } })
    productos.A = await prisma.producto.create({ data: { empresaId: empresas.A.id, nombre: 'Producto A', codigoInterno: 'CANCEL-A', precioBase: 50, precioVenta: 50, margen: 0, categoriaId: catA.id, claveSat: '31161500', unidadSat: 'H87', activo: true } })
    productos.B = await prisma.producto.create({ data: { empresaId: empresas.B.id, nombre: 'Producto B', codigoInterno: 'CANCEL-B', precioBase: 50, precioVenta: 50, margen: 0, categoriaId: catB.id, claveSat: '31161500', unidadSat: 'H87', activo: true } })
    trabajador = await prisma.trabajador.create({ data: { empresaId: empresas.A.id, nombre: 'Recibe Test', activo: true } })
    turno = await prisma.turnoCaja.create({ data: { empresaId: empresas.A.id, sucursalId: sucursales.A1.id, usuarioId: usuarios.superA.id, montoInicial: 100, abierto: true } })

    const app = require('../src/app')
    server = http.createServer(app)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve))
    if (prisma) await prisma.$disconnect().catch(() => {})
    if (prisma?.pool) await prisma.pool.end().catch(() => {})
    delete require.cache[require.resolve('../src/app')]
    delete require.cache[require.resolve('../src/lib/prisma')]
    if (created) {
      await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]).catch(() => {})
      await adminPool.query(`DROP DATABASE "${dbName}"`).catch(() => {})
    }
    await adminPool.end().catch(() => {})
  })

  it('SUPERADMIN null + SELECTED cancela MANUAL en la sucursal propietaria y preserva otras deudas', async () => {
    const caso = await crearCaso()
    await prisma.inventarioSucursal.create({ data: { productoId: productos.A.id, sucursalId: sucursales.A2.id, stockActual: 30, stockMinimoAlerta: 0 } })
    const response = await cancelar(caso)
    assert.equal(response.status, 200)
    assert.equal(response.body.data.estado, 'CANCELADA')
    assert.ok(response.requestId)
    const despues = await snapshot(caso)
    assert.equal(Number(despues.inventario.stockActual), 10)
    assert.equal(Number((await prisma.inventarioSucursal.findUnique({ where: { productoId_sucursalId: { productoId: productos.A.id, sucursalId: sucursales.A2.id } } })).stockActual), 30)
    assert.equal(Number(despues.cliente.saldoPendiente), caso.otrasDeudas)
    assert.equal(despues.movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA').length, 1)
    assert.equal(despues.auditorias.length, 1)
  })

  it('reproduce cierre manual -> reapertura -> cancelación sin afectar otra sucursal', async () => {
    const caso = await crearCaso({ otrasDeudas: 75, stockActual: 8 })
    const inventarioOtraSucursal = await prisma.inventarioSucursal.upsert({
      where: { productoId_sucursalId: { productoId: productos.A.id, sucursalId: sucursales.A2.id } },
      create: { productoId: productos.A.id, sucursalId: sucursales.A2.id, stockActual: 41, stockMinimoAlerta: 0 },
      update: { stockActual: 41 }
    })
    const saldoInicial = Number((await prisma.cliente.findUnique({ where: { id: caso.cliente.id } })).saldoPendiente)

    const cierre = await request('PATCH', `/bitacoras/${caso.bitacora.id}/estado`, tokens.adminA1, sucursales.A1.id, {
      estado: 'CERRADA_INTERNA', motivo: 'Cierre manual controlado'
    })
    assert.equal(cierre.status, 200)
    const duranteCierre = await snapshot(caso)
    assert.equal(duranteCierre.bitacora.estado, 'CERRADA_INTERNA')
    assert.equal(Number(duranteCierre.bitacora.saldoPendiente), 0)
    assert.equal(Number(duranteCierre.cliente.saldoPendiente), caso.otrasDeudas)
    assert.equal(Number(duranteCierre.inventario.stockActual), caso.stockActual)

    const reapertura = await request('PATCH', `/bitacoras/${caso.bitacora.id}/estado`, tokens.superA, sucursales.A1.id, {
      estado: 'ABIERTA', motivo: 'Reapertura para cancelar'
    })
    assert.equal(reapertura.status, 200)
    const duranteReapertura = await snapshot(caso)
    assert.equal(duranteReapertura.bitacora.estado, 'ABIERTA')
    assert.equal(Number(duranteReapertura.bitacora.saldoPendiente), caso.monto)
    assert.equal(Number(duranteReapertura.cliente.saldoPendiente), saldoInicial)
    assert.equal(Number(duranteReapertura.inventario.stockActual), caso.stockActual)

    const cancelacion = await cancelar(caso, tokens.superA, sucursales.A1.id)
    assert.equal(cancelacion.status, 200)
    const final = await snapshot(caso)
    assert.equal(final.bitacora.estado, 'CANCELADA')
    assert.equal(Number(final.bitacora.saldoPendiente), 0)
    assert.equal(Number(final.cliente.saldoPendiente), caso.otrasDeudas)
    assert.equal(Number(final.inventario.stockActual), 10)
    assert.equal(Number((await prisma.inventarioSucursal.findUnique({ where: { productoId_sucursalId: { productoId: productos.A.id, sucursalId: sucursales.A2.id } } })).stockActual), Number(inventarioOtraSucursal.stockActual))
    assert.equal(final.movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA').length, 1)
  })

  it('ADMIN_SUCURSAL opera en su alcance vigente', async () => {
    const caso = await crearCaso({ usuario: usuarios.adminA1 })
    const response = await cancelar(caso, tokens.adminA1, sucursales.A1.id)
    assert.equal(response.status, 200)
    assert.equal((await snapshot(caso)).bitacora.estado, 'CANCELADA')
  })

  it('PLATFORM_ADMIN solo opera mediante delegación válida y sucursal seleccionada', async () => {
    const casoDelegado = await crearCaso()
    const delegated = await cancelar(casoDelegado, tokens.delegatedA, sucursales.A1.id)
    assert.equal(delegated.status, 200)

    const casoPlataforma = await crearCaso()
    const platform = await cancelar(casoPlataforma, tokens.platform, sucursales.A1.id)
    assert.equal(platform.status, 401)
    assert.equal((await snapshot(casoPlataforma)).bitacora.estado, 'ABIERTA')
  })

  it('rol sin permiso y petición sin autenticación no escriben', async () => {
    const caso = await crearCaso()
    const sinPermiso = await cancelar(caso, tokens.preciosA, sucursales.A1.id)
    assert.equal(sinPermiso.status, 403)
    const sinAuth = await cancelar(caso, null, sucursales.A1.id)
    assert.equal(sinAuth.status, 401)
    assert.equal((await snapshot(caso)).bitacora.estado, 'ABIERTA')
  })

  it('otra empresa y otra sucursal reciben 404 sin escrituras', async () => {
    const caso = await crearCaso()
    const crossTenant = await cancelar(caso, tokens.superB, sucursales.B1.id)
    assert.equal(crossTenant.status, 404)
    const crossBranch = await cancelar(caso, tokens.adminA2, sucursales.A2.id)
    assert.equal(crossBranch.status, 404)
    assert.equal((await snapshot(caso)).bitacora.estado, 'ABIERTA')
  })

  it('contexto NONE o scope enviado en body no amplían acceso', async () => {
    const caso = await crearCaso()
    const response = await request('PATCH', `/bitacoras/${caso.bitacora.id}/estado`, tokens.superA, null, {
      estado: 'CANCELADA', motivo: 'No debe servir', empresaId: empresas.A.id, sucursalId: sucursales.A1.id
    })
    assert.equal(response.status, 400)
    assert.equal(response.body.codigo, 'BRANCH_CONTEXT_REQUIRED')
    assert.equal((await snapshot(caso)).bitacora.estado, 'ABIERTA')
  })

  it('bitácora VENTA se rechaza sin modificar venta, inventario, deuda ni crédito', async () => {
    const caso = await crearCaso({ origen: 'VENTA' })
    const creditoAntes = Number(caso.cliente.totalCreditoUsado || 0)
    const response = await cancelar(caso)
    assert.equal(response.status, 409)
    assert.equal(response.body.codigo, 'CANCELACION_VENTA_REQUIERE_MODULO_VENTAS')
    const despues = await snapshot(caso)
    assert.equal(despues.bitacora.estado, 'ABIERTA')
    assert.equal(Number(despues.inventario.stockActual), caso.stockActual)
    assert.equal(Number(despues.cliente.saldoPendiente), caso.otrasDeudas + caso.monto)
    assert.equal(Number(despues.cliente.totalCreditoUsado), creditoAntes)
  })

  it('abono real y agregado inconsistente bloquean con códigos específicos', async () => {
    const conAbono = await crearCaso({ totalAbonado: 10 })
    const abono = await prisma.abonoBitacora.create({ data: { empresaId: empresas.A.id, bitacoraId: conAbono.bitacora.id, usuarioId: usuarios.superA.id, turnoId: turno.id, monto: 10, metodoPago: 'EFECTIVO' } })
    await prisma.movimientoCaja.create({ data: { empresaId: empresas.A.id, turnoId: turno.id, tipo: 'ABONO_BITACORA', monto: 10, metodoPago: 'EFECTIVO', referencia: conAbono.folio, abonoBitacoraId: abono.id } })
    const normal = await cancelar(conAbono)
    assert.equal(normal.status, 409)
    assert.equal(normal.body.codigo, 'BITACORA_CON_ABONOS')

    const inconsistente = await crearCaso({ totalAbonado: 10 })
    const inconsistenteResponse = await cancelar(inconsistente)
    assert.equal(inconsistenteResponse.status, 409)
    assert.equal(inconsistenteResponse.body.codigo, 'PAGOS_INCONSISTENTES')
    assert.equal((await snapshot(inconsistente)).bitacora.estado, 'ABIERTA')
  })

  it('reconstruye una deducción parcial inequívoca desde kardex', async () => {
    const caso = await crearCaso({ inventarioDescontado: false, cantidad: 2, cantidadDescontada: 1, stockActual: 9 })
    const response = await cancelar(caso)
    assert.equal(response.status, 200)
    const despues = await snapshot(caso)
    assert.equal(Number(despues.inventario.stockActual), 10)
    assert.equal(Number(despues.movimientos.at(-1).cantidad), 1)
  })

  it('reintegra detalle no descontado con cantidad completa cuando el stock está en negativo', async () => {
    const caso = await crearCaso({ inventarioDescontado: false, cantidad: 10, cantidadDescontada: 0, stockActual: -6 })
    const response = await cancelar(caso)
    assert.equal(response.status, 200)
    const despues = await snapshot(caso)
    assert.equal(despues.bitacora.estado, 'CANCELADA')
    assert.equal(Number(despues.inventario.stockActual), 4)
    const devoluciones = despues.movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA')
    assert.equal(devoluciones.length, 1)
    assert.equal(Number(devoluciones[0].cantidad), 10)
    assert.equal(Number(devoluciones[0].stockAntes), -6)
    assert.equal(Number(devoluciones[0].stockDespues), 4)
    assert.match(devoluciones[0].notas, /stock negativo/)
  })

  it('no reintegra detalle no descontado cuando el stock está en cero o positivo', async () => {
    const enCero = await crearCaso({ inventarioDescontado: false, cantidad: 30, cantidadDescontada: 0, stockActual: 0 })
    assert.equal((await cancelar(enCero)).status, 200)
    const despuesCero = await snapshot(enCero)
    assert.equal(despuesCero.bitacora.estado, 'CANCELADA')
    assert.equal(Number(despuesCero.inventario.stockActual), 0)
    assert.equal(despuesCero.movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA').length, 0)

    const positivo = await crearCaso({ inventarioDescontado: false, cantidad: 30, cantidadDescontada: 0, stockActual: 10 })
    assert.equal((await cancelar(positivo)).status, 200)
    const despuesPositivo = await snapshot(positivo)
    assert.equal(despuesPositivo.bitacora.estado, 'CANCELADA')
    assert.equal(Number(despuesPositivo.inventario.stockActual), 10)
    assert.equal(despuesPositivo.movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA').length, 0)
  })

  it('kardex parcial + detalle no descontado + stock negativo reintegra hasta la cantidad total del detalle', async () => {
    const caso = await crearCaso({ inventarioDescontado: false, cantidad: 25, cantidadDescontada: 19, stockActual: -6 })
    const response = await cancelar(caso)
    assert.equal(response.status, 200)
    const despues = await snapshot(caso)
    assert.equal(Number(despues.inventario.stockActual), 19)
    const devoluciones = despues.movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA')
    assert.equal(devoluciones.length, 1)
    assert.equal(Number(devoluciones[0].cantidad), 25)
  })

  it('inventario faltante o devolución ambigua rechazan y revierten todo', async () => {
    const faltante = await crearCaso({ conInventario: false, cantidadDescontada: 2 })
    const missing = await cancelar(faltante)
    assert.equal(missing.status, 409)
    assert.equal(missing.body.codigo, 'INVENTARIO_FALTANTE')
    assert.equal((await snapshot(faltante)).bitacora.estado, 'ABIERTA')

    const ambiguo = await crearCaso({ inventarioDescontado: false, cantidad: 2, cantidadDescontada: 3, stockActual: 7 })
    const ambiguous = await cancelar(ambiguo)
    assert.equal(ambiguous.status, 409)
    assert.equal(ambiguous.body.codigo, 'INVENTARIO_DEVOLUCION_AMBIGUA')
    const despues = await snapshot(ambiguo)
    assert.equal(despues.bitacora.estado, 'ABIERTA')
    assert.equal(Number(despues.inventario.stockActual), 7)
  })

  it('doble confirmación secuencial y concurrente produce un solo conjunto de efectos', async () => {
    const secuencial = await crearCaso()
    assert.equal((await cancelar(secuencial)).status, 200)
    const segundo = await cancelar(secuencial)
    assert.equal(segundo.status, 409)
    assert.equal(segundo.body.codigo, 'BITACORA_YA_CANCELADA')
    assert.equal((await snapshot(secuencial)).movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA').length, 1)

    const concurrente = await crearCaso()
    const resultados = await Promise.all([cancelar(concurrente), cancelar(concurrente)])
    assert.deepEqual(resultados.map(r => r.status).sort(), [200, 409])
    assert.equal((await snapshot(concurrente)).movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA').length, 1)
  })

  it('cancelación contra abono queda serializada sin estado incompatible', async () => {
    const caso = await crearCaso()
    const [cancelResult, abonoResult] = await Promise.all([
      cancelar(caso),
      request('POST', `/bitacoras/${caso.bitacora.id}/abonos`, tokens.superA, sucursales.A1.id, {
        monto: '10.00', metodoPago: 'EFECTIVO'
      }, { 'Idempotency-Key': randomUUID() })
    ])
    assert.ok([200, 409].includes(cancelResult.status))
    assert.ok([201, 409].includes(abonoResult.status))
    assert.notEqual(cancelResult.status < 300 && abonoResult.status < 300, true)
    const despues = await snapshot(caso)
    assert.equal(despues.bitacora.estado === 'CANCELADA' && despues.abonos.length > 0, false)
  })

  it('cancelación contra alta de material usa el mismo lock y deja un orden serial válido', async () => {
    const caso = await crearCaso()
    const [cancelResult, addResult] = await Promise.all([
      cancelar(caso),
      request('POST', `/bitacoras/${caso.bitacora.id}/productos`, tokens.superA, sucursales.A1.id, {
        productoId: productos.A.id,
        cantidad: 1,
        precioUnitario: 10,
        fechaManual: '2026-10-05',
        responsableId: usuarios.superA.id,
        recibeTrabajadorId: trabajador.id
      })
    ])
    assert.equal(cancelResult.status, 200)
    assert.ok([200, 409].includes(addResult.status))
    const despues = await snapshot(caso)
    assert.equal(despues.bitacora.estado, 'CANCELADA')
    const neto = despues.movimientos.reduce((total, mov) => total + (mov.tipo === 'SALIDA_BITACORA' ? Number(mov.cantidad) : -Number(mov.cantidad)), 0)
    assert.equal(neto, 0)
  })

  it('cancelación contra edición o retiro de material deja un orden serial válido', async () => {
    const casoEditar = await crearCaso()
    const [cancelEditar, editResult] = await Promise.all([
      cancelar(casoEditar),
      request('PATCH', `/bitacoras/${casoEditar.bitacora.id}/productos/${casoEditar.detalle.id}`, tokens.superA, sucursales.A1.id, { cantidad: 3 })
    ])
    assert.equal(cancelEditar.status, 200)
    assert.ok([200, 409].includes(editResult.status))
    const despuesEditar = await snapshot(casoEditar)
    assert.equal(despuesEditar.bitacora.estado, 'CANCELADA')
    assert.equal(Number(despuesEditar.inventario.stockActual), 10)

    const casoQuitar = await crearCaso()
    const [cancelQuitar, removeResult] = await Promise.all([
      cancelar(casoQuitar),
      request('DELETE', `/bitacoras/${casoQuitar.bitacora.id}/productos/${casoQuitar.detalle.id}`, tokens.superA, sucursales.A1.id)
    ])
    assert.equal(cancelQuitar.status, 200)
    assert.ok([200, 409].includes(removeResult.status))
    const despuesQuitar = await snapshot(casoQuitar)
    assert.equal(despuesQuitar.bitacora.estado, 'CANCELADA')
    assert.equal(Number(despuesQuitar.inventario.stockActual), 10)
    assert.equal(Number(despuesQuitar.cliente.saldoPendiente), casoQuitar.otrasDeudas)
  })

  it('cancelación contra ajuste de stock conserva una secuencia serial de snapshots', async () => {
    const caso = await crearCaso()
    const [cancelResult, ajusteResult] = await Promise.all([
      cancelar(caso),
      request('POST', '/inventario/ajuste-rapido', tokens.superA, sucursales.A1.id, {
        productoId: productos.A.id, nuevoStock: 20
      })
    ])
    assert.equal(cancelResult.status, 200)
    assert.equal(ajusteResult.status, 200)
    const despues = await snapshot(caso)
    assert.ok([20, 22].includes(Number(despues.inventario.stockActual)))
    const relevantes = despues.movimientos.filter(m => m.id > despues.movimientos[0].id)
    for (let i = 1; i < relevantes.length; i++) {
      assert.equal(Number(relevantes[i].stockAntes), Number(relevantes[i - 1].stockDespues))
    }
  })

  it('fallo inducido después de modificar stock revierte estado, inventario, deuda y movimientos', async () => {
    const caso = await crearCaso()
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION cancelar_test_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.tipo = 'DEVOLUCION_ENTRADA' AND NEW.notas LIKE 'Cancelación bitácora%' THEN
          RAISE EXCEPTION 'fallo inducido cancelacion';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER cancelar_test_fail_trigger BEFORE INSERT ON "MovimientoInventario"
      FOR EACH ROW EXECUTE FUNCTION cancelar_test_fail();
    `)
    try {
      const response = await cancelar(caso)
      assert.equal(response.status, 500)
      assert.ok(response.body.requestId)
      const despues = await snapshot(caso)
      assert.equal(despues.bitacora.estado, 'ABIERTA')
      assert.equal(Number(despues.inventario.stockActual), caso.stockActual)
      assert.equal(Number(despues.cliente.saldoPendiente), caso.otrasDeudas + caso.monto)
      assert.equal(despues.movimientos.filter(m => m.tipo === 'DEVOLUCION_ENTRADA').length, 0)
      assert.equal(despues.auditorias.length, 0)
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS cancelar_test_fail_trigger ON "MovimientoInventario"; DROP FUNCTION IF EXISTS cancelar_test_fail();')
    }
  })
})
