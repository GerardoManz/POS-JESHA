'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const path = require('node:path')
const http = require('node:http')
const pg = require('pg')
const jwt = require('jsonwebtoken')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_import_idemp_'
const DB_RE = /^jesha_import_idemp_[a-z0-9_]+$/
const TENANT_SECRET = 'import-idemp-tenant-'.padEnd(64, 't')
const TENANT_ISSUER = 'jesha-import-idemp-test'
const TENANT_AUDIENCE = 'jesha-import-idemp-api-test'

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Falta variable requerida: ${name}`)
  return value
}

function resolvePgConfig() {
  const host = requiredEnv('P0_TEST_PG_HOST')
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('P0_TEST_PG_HOST debe ser local')
  return Object.freeze({
    user: requiredEnv('P0_TEST_PG_USER'),
    password: requiredEnv('P0_TEST_PG_PASSWORD'),
    host,
    port: Number(requiredEnv('P0_TEST_PG_PORT')),
  })
}

function validateDbName(name) {
  if (!DB_RE.test(name) || name === DB_PREFIX) throw new Error('Nombre de base temporal invalido')
  return name
}

function quoteDb(name) {
  validateDbName(name)
  return `"${name}"`
}

function connectionUrl(config, dbName) {
  const host = config.host === '::1' ? '[::1]' : config.host
  return `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${host}:${config.port}/${encodeURIComponent(dbName)}`
}

function dbPush(databaseUrl) {
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  const args = ['prisma', 'db', 'push', '--schema', 'prisma/schema.prisma']
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], {
      cwd: BACKEND_DIR,
      env,
      stdio: 'pipe',
      timeout: 120000,
    })
    return
  }
  execFileSync('npx', args, { cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000 })
}

const CSV_COLUMNS = [
  ['CLAVE', 'clave'],
  ['CLAVE ALTERNA', 'barras'],
  ['DESCRIPCION', 'nombre'],
  ['CARACTERISTICAS', 'descripcion'],
  ['DEPARTAMENTO', 'depto'],
  ['CATEGORIA', 'cat'],
  ['PRECIO 1', 'precioBase'],
  ['PRECIO_VENTA', 'precioVenta'],
  ['PRECIO COMPRA', 'costo'],
  ['CLAVE SAT', 'satClave'],
  ['UNIDAD SAT', 'satUnidad'],
  ['EXIST.', 'stock'],
  ['INV_MIN', 'stockMin'],
  ['INV_MAX', 'stockMax'],
  ['PROVEEDOR', 'proveedor'],
  ['APODO_PROVEEDOR', 'proveedorApodo'],
  ['TIPO', 'tipo'],
  ['GRANEL (S/N)', 'granel'],
  ['TIPO DE GRANEL', 'tipoGranel'],
  ['UNIDAD', 'unidad'],
  ['UNIDAD COMPRA', 'unidadCompra'],
  ['FACTOR_CONVERSION', 'factorConversion'],
  ['IMAGEN_URL', 'imagenUrl'],
]

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function makeCSV(rows) {
  const defaults = {
    depto: 'GENERAL',
    cat: 'GENERAL',
    precioBase: 15,
    satClave: '52161500',
    satUnidad: 'H87',
    stock: 0,
    stockMin: 0,
    tipo: 'PRODUCTO',
  }
  const lines = rows.map((row) => {
    const complete = { ...defaults, ...row }
    return CSV_COLUMNS.map(([, key]) => csvCell(complete[key])).join(',')
  })
  return Buffer.from([CSV_COLUMNS.map(([header]) => header).join(','), ...lines].join('\n'), 'utf8')
}

describe('Importacion de productos - idempotencia C01-C46', { concurrency: 1, timeout: 300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig, 'postgres'), max: 1 })

  let created = false
  let prisma
  let server
  let baseUrl
  let empresa
  let sucursal
  let usuario
  let token
  let idempotency

  function signToken(userId) {
    return jwt.sign(
      { version: 1, kind: 'TENANT', sub: userId, rol: 'SUPERADMIN' },
      TENANT_SECRET,
      { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '30m' }
    )
  }

  async function importar(buffer, tipo = 'upsert', idempotencyKey, context = {}) {
    const boundary = `----FormBoundary${randomUUID().replace(/-/g, '')}`
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="archivo"; filename="test.csv"',
      'Content-Type: text/csv',
      '',
      buffer.toString('utf8'),
      `--${boundary}--`,
    ].join('\r\n')
    const headers = {
      Authorization: `Bearer ${context.token || token}`,
      'X-Sucursal-Id': String(context.sucursalId || sucursal.id),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    }
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey
    const endpoint = tipo === 'solo_nuevos' ? '/productos/importar/solo-nuevos' : '/productos/importar/csv'
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers, body })
    const rawText = await response.text()
    let responseBody
    try { responseBody = JSON.parse(rawText) } catch (_) { responseBody = { _rawText: rawText } }
    return { status: response.status, body: responseBody }
  }

  async function headerFor(key, empresaId = empresa.id) {
    return prisma.importacionProductos.findFirst({
      where: { empresaId, claveIdempotencia: key },
      include: { Detalle: { orderBy: { fila: 'asc' } } },
    })
  }

  async function createTenant(suffix) {
    const tenant = await prisma.empresa.create({
      data: {
        slug: `import-${suffix}-${randomBytes(3).toString('hex')}`,
        nombreComercial: `Import ${suffix}`,
        razonSocial: `Import ${suffix} SA`,
        whatsapp: '0000000000',
      },
    })
    const branch = await prisma.sucursal.create({
      data: {
        Empresa: { connect: { id: tenant.id } },
        nombre: `Sucursal ${suffix}`,
        direccion: 'Local',
        codigoPostal: '00000',
        activa: true,
      },
    })
    const user = await prisma.usuario.create({
      data: {
        Empresa: { connect: { id: tenant.id } },
        username: `import-${suffix}-${randomBytes(3).toString('hex')}`,
        passwordHash: 'fakehash',
        nombre: `Usuario ${suffix}`,
        rol: 'SUPERADMIN',
        activo: true,
      },
    })
    return { empresa: tenant, sucursal: branch, usuario: user, token: signToken(user.id) }
  }

  async function installProductFailureTrigger(code) {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_import_product() RETURNS trigger AS $$
      BEGIN
        IF NEW."codigoInterno" = '${code}' THEN RAISE EXCEPTION 'forced product failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_import_product_trigger
      BEFORE INSERT ON "Producto"
      FOR EACH ROW EXECUTE FUNCTION test_fail_import_product()
    `)
  }

  async function removeProductFailureTrigger() {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_import_product_trigger ON "Producto"')
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_import_product()')
  }

  async function installDetailFailureTrigger(code) {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_import_detail() RETURNS trigger AS $$
      BEGIN
        IF NEW."codigoInterno" = '${code}' THEN RAISE EXCEPTION 'forced detail failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_import_detail_trigger
      BEFORE INSERT ON "ImportacionProductosDetalle"
      FOR EACH ROW EXECUTE FUNCTION test_fail_import_detail()
    `)
  }

  async function removeDetailFailureTrigger() {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_import_detail_trigger ON "ImportacionProductosDetalle"')
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_import_detail()')
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'
    process.env.PLATFORM_JWT_SECRET = 'import-idemp-platform-'.padEnd(64, 'p')
    process.env.PLATFORM_JWT_ISSUER = 'jesha-import-idemp-platform'
    process.env.PLATFORM_JWT_AUDIENCE = 'jesha-import-idemp-platform-api'
    process.env.PLATFORM_JWT_TTL = '15m'
    process.env.CLOUDINARY_CLOUD_NAME = 'test'
    process.env.CLOUDINARY_API_KEY = 'test'
    process.env.CLOUDINARY_API_SECRET = 'test'
    process.env.DEBUG_ENABLED = 'false'

    await adminPool.query(`CREATE DATABASE ${quoteDb(dbName)}`)
    created = true
    dbPush(databaseUrl)

    const prismaPath = require.resolve('../src/lib/prisma')
    delete require.cache[prismaPath]
    prisma = require('../src/lib/prisma')
    if (prisma?.pool && !prisma.pool.__importIdempotencyErrorGuard) {
      prisma.pool.__importIdempotencyErrorGuard = true
      prisma.pool.on('error', () => {})
    }

    empresa = await prisma.empresa.create({
      data: { slug: `test-import-${Date.now()}`, nombreComercial: 'Test Import', razonSocial: 'Test Import SA', whatsapp: '0000000000' },
    })
    sucursal = await prisma.sucursal.create({
      data: { Empresa: { connect: { id: empresa.id } }, nombre: 'Sucursal Test', direccion: 'Local', codigoPostal: '00000', activa: true },
    })
    usuario = await prisma.usuario.create({
      data: {
        Empresa: { connect: { id: empresa.id } },
        username: `import-test-${Date.now()}`,
        passwordHash: 'fakehash',
        nombre: 'Import Test',
        rol: 'SUPERADMIN',
        activo: true,
      },
    })
    token = signToken(usuario.id)
    idempotency = require('../src/modules/productos/importacion.idempotency')

    const app = require('../src/app')
    server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (prisma) {
      try { await prisma.$disconnect() } catch (_) {}
    }
    if (created) {
      try {
        await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName])
      } catch (_) {}
      try { await adminPool.query(`DROP DATABASE IF EXISTS ${quoteDb(dbName)}`) } catch (_) {}
    }
    await adminPool.end()
  })

  it('C01 - header ausente conserva el flujo legacy', async () => {
    const response = await importar(makeCSV([{ clave: 'C01-A', nombre: 'Producto C01' }]))
    assert.equal(response.status, 200)
    assert.equal(response.body.creados, 1)
    assert.equal(await prisma.importacionProductos.count({ where: { empresaId: empresa.id } }), 0)
  })

  it('C02 - header presente vacio responde 400', async () => {
    const response = await importar(makeCSV([{ clave: 'C02-A', nombre: 'Producto C02' }]), 'upsert', '')
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'IDEMPOTENCY_KEY_INVALID')
  })

  it('C03 - header malformado responde 400', async () => {
    const response = await importar(makeCSV([{ clave: 'C03-A', nombre: 'Producto C03' }]), 'upsert', `${'a'.repeat(35)}!`)
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'IDEMPOTENCY_KEY_INVALID')
  })

  it('C04 - header corto responde 400', async () => {
    const response = await importar(makeCSV([{ clave: 'C04-A', nombre: 'Producto C04' }]), 'upsert', 'short')
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'IDEMPOTENCY_KEY_INVALID')
  })

  it('C05 - header largo responde 400', async () => {
    const response = await importar(makeCSV([{ clave: 'C05-A', nombre: 'Producto C05' }]), 'upsert', 'a'.repeat(65))
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'IDEMPOTENCY_KEY_INVALID')
  })

  it('C06 - COMPLETADA reproduce el cuerpo completo persistido', async () => {
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C06-A', nombre: 'Producto C06' }, { clave: 'C06-B', nombre: 'Producto C06 B' }])
    const first = await importar(csv, 'upsert', key)
    const header = await headerFor(key)
    const replay = await importar(csv, 'upsert', key)
    assert.equal(first.status, 200)
    assert.equal(header.estado, 'COMPLETADA')
    assert.deepEqual(first.body, header.respuesta)
    assert.deepEqual(replay, { status: 200, body: header.respuesta })
  })

  it('C07 - misma key con payload distinto responde conflicto estable', async () => {
    const key = randomUUID()
    assert.equal((await importar(makeCSV([{ clave: 'C07-A', nombre: 'Original' }]), 'upsert', key)).status, 200)
    const conflict = await importar(makeCSV([{ clave: 'C07-A', nombre: 'Cambiado' }]), 'upsert', key)
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_REUSED')
  })

  it('C08 - misma key con tipo distinto responde conflicto estable', async () => {
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C08-A', nombre: 'Producto C08' }])
    assert.equal((await importar(csv, 'upsert', key)).status, 200)
    const conflict = await importar(csv, 'solo_nuevos', key)
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_REUSED')
  })

  it('C09 - dos requests simultaneos producen un solo conjunto de efectos', async () => {
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C09-A', nombre: 'Producto C09 A' }, { clave: 'C09-B', nombre: 'Producto C09 B' }])
    const results = await Promise.all([importar(csv, 'upsert', key), importar(csv, 'upsert', key)])
    assert.ok(results.every((result) => result.status === 200 || result.status === 409))
    assert.ok(results.some((result) => result.status === 200))
    const header = await headerFor(key)
    assert.equal(header.Detalle.length, 2)
    assert.equal(await prisma.producto.count({ where: { empresaId: empresa.id, codigoInterno: { in: ['C09-A', 'C09-B'] } } }), 2)
  })

  it('C10 - PROCESANDO con lease activo responde 409', async () => {
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C10-A', nombre: 'Producto C10' }])
    assert.equal((await importar(csv, 'upsert', key)).status, 200)
    const header = await headerFor(key)
    await prisma.importacionProductos.update({
      where: { id: header.id },
      data: { estado: 'PROCESANDO', respuesta: null, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) },
    })
    const response = await importar(csv, 'upsert', key)
    assert.equal(response.status, 409)
    assert.equal(response.body.code, 'IMPORTACION_EN_PROCESO')
  })

  it('C11 - lease expirado retoma el mismo header y solo filas sin detalle', async () => {
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C11-A', nombre: 'Nombre CSV A' }, { clave: 'C11-B', nombre: 'Nombre CSV B' }])
    assert.equal((await importar(csv, 'upsert', key)).status, 200)
    const header = await headerFor(key)
    const firstProduct = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresa.id, codigoInterno: 'C11-A' } } })
    const secondProduct = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresa.id, codigoInterno: 'C11-B' } } })
    await prisma.importacionProductosDetalle.delete({ where: { importacionId_fila: { importacionId: header.id, fila: 3 } } })
    await prisma.producto.update({ where: { id: firstProduct.id }, data: { nombre: 'NO REPROCESAR' } })
    await prisma.producto.update({ where: { id: secondProduct.id }, data: { nombre: 'DEBE REPROCESARSE' } })
    await prisma.importacionProductos.update({
      where: { id: header.id },
      data: { estado: 'PROCESANDO', respuesta: null, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 60_000) },
    })
    const resumed = await importar(csv, 'upsert', key)
    const after = await headerFor(key)
    const products = await prisma.producto.findMany({ where: { id: { in: [firstProduct.id, secondProduct.id] } }, orderBy: { codigoInterno: 'asc' } })
    assert.equal(resumed.status, 200)
    assert.equal(after.id, header.id)
    assert.equal(after.Detalle.length, 2)
    assert.deepEqual(products.map((product) => product.nombre), ['NO REPROCESAR', 'Nombre CSV B'])
  })

  it('C12 - FALLIDA reproduce el mismo snapshot con status 500', async () => {
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C12-A', nombre: 'Producto C12' }])
    assert.equal((await importar(csv, 'upsert', key)).status, 200)
    const header = await headerFor(key)
    const snapshot = { error: 'fallo persistido', total: 1, creados: 0, errores: 1, detalleErrores: [{ fila: 2, clave: 'C12-A' }] }
    await prisma.importacionProductos.update({ where: { id: header.id }, data: { estado: 'FALLIDA', respuesta: snapshot, leaseExpiresAt: null } })
    const replay = await importar(csv, 'upsert', key)
    assert.deepEqual(replay, { status: 500, body: snapshot })
  })

  it('C13 - una fila invalida crea exactamente un ERROR_VALIDACION', async () => {
    const key = randomUUID()
    const response = await importar(makeCSV([{ clave: '', nombre: 'Sin clave' }]), 'upsert', key)
    const header = await headerFor(key)
    assert.equal(response.status, 200)
    assert.equal(header.Detalle.length, 1)
    assert.equal(header.Detalle[0].estado, 'ERROR_VALIDACION')
    assert.equal(header.Detalle[0].accion, 'ERROR')
    assert.equal(header.errores, 1)
  })

  it('C14 - error transaccional capturado crea ERROR_SISTEMA sin producto', async () => {
    const key = randomUUID()
    await installProductFailureTrigger('C14-FAIL')
    try {
      const response = await importar(makeCSV([{ clave: 'C14-FAIL', nombre: 'Producto C14' }]), 'upsert', key)
      const header = await headerFor(key)
      assert.equal(response.status, 200)
      assert.equal(header.Detalle.length, 1)
      assert.equal(header.Detalle[0].estado, 'ERROR_SISTEMA')
      assert.equal(await prisma.producto.count({ where: { empresaId: empresa.id, codigoInterno: 'C14-FAIL' } }), 0)
    } finally {
      await removeProductFailureTrigger()
    }
  })

  it('C15 - fallo al insertar detalle revierte Producto HPP e inventario y deja FALLIDA', async () => {
    const key = randomUUID()
    await installDetailFailureTrigger('C15-FAIL')
    try {
      const response = await importar(makeCSV([{
        clave: 'C15-FAIL', nombre: 'Producto C15', stock: 8, stockMin: 2, proveedor: 'Proveedor C15', costo: 7,
      }]), 'upsert', key)
      const header = await headerFor(key)
      assert.equal(response.status, 500)
      assert.equal(header.estado, 'FALLIDA')
      assert.equal(header.Detalle.length, 0)
      assert.equal(await prisma.producto.count({ where: { empresaId: empresa.id, codigoInterno: 'C15-FAIL' } }), 0)
      assert.equal(await prisma.proveedorProducto.count({ where: { Producto: { empresaId: empresa.id, codigoInterno: 'C15-FAIL' } } }), 0)
      assert.equal(await prisma.inventarioSucursal.count({ where: { Producto: { empresaId: empresa.id, codigoInterno: 'C15-FAIL' } } }), 0)
    } finally {
      await removeDetailFailureTrigger()
    }
  })

  it('C16 - detalles exitosos usan estado COMPLETADA', async () => {
    const key = randomUUID()
    await importar(makeCSV([{ clave: 'C16-A', nombre: 'Producto C16 A' }, { clave: 'C16-B', nombre: 'Producto C16 B' }]), 'upsert', key)
    const header = await headerFor(key)
    assert.deepEqual(header.Detalle.map((detail) => detail.estado), ['COMPLETADA', 'COMPLETADA'])
  })

  it('C17 - codigoInterno duplicado aplica last-write-wins y conserva dos detalles', async () => {
    const key = randomUUID()
    const response = await importar(makeCSV([
      { clave: 'C17-A', nombre: 'Primero', precioBase: '10.00' },
      { clave: 'C17-A', nombre: 'Ultimo', precioBase: '25.50' },
    ]), 'upsert', key)
    const header = await headerFor(key)
    const product = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresa.id, codigoInterno: 'C17-A' } } })
    assert.equal(response.status, 200)
    assert.equal(header.Detalle.length, 2)
    assert.deepEqual(header.Detalle.map((detail) => detail.accion), ['CREADO', 'ACTUALIZADO'])
    assert.equal(product.nombre, 'Ultimo')
    assert.equal(product.precioBase.toString(), '25.5')
  })

  it('C18 - counters de header y respuesta derivan de detalles con vinculaciones y advertencias', async () => {
    const key = randomUUID()
    const barcode = `750${Date.now()}`
    const response = await importar(makeCSV([
      { clave: 'C18-A', barras: barcode, nombre: 'Producto C18 A', proveedor: 'Proveedor C18', costo: 4 },
      { clave: 'C18-B', barras: barcode, nombre: 'Producto C18 B', proveedor: 'Proveedor C18', costo: 5 },
    ]), 'upsert', key)
    const header = await headerFor(key)
    const aggregate = await idempotency.aggregateFromDetails(prisma, header.id)
    assert.equal(response.status, 200)
    assert.equal(aggregate.vinculaciones, 2)
    assert.equal(aggregate.advertencias, 1)
    for (const field of ['filasProcesadas', 'creados', 'actualizados', 'vinculaciones', 'omitidos', 'errores', 'advertencias']) {
      assert.equal(header[field], aggregate[field])
    }
    for (const field of ['creados', 'actualizados', 'vinculaciones', 'omitidos', 'errores', 'advertencias']) {
      assert.equal(response.body[field], aggregate[field])
    }
  })

  it('C19 - respuesta inicial es exactamente header.respuesta', async () => {
    const key = randomUUID()
    const response = await importar(makeCSV([{ clave: 'C19-A', nombre: 'Producto C19' }]), 'upsert', key)
    assert.deepEqual(response.body, (await headerFor(key)).respuesta)
  })

  it('C20 - solo_nuevos OMITIDO es atomico y no modifica el producto', async () => {
    await importar(makeCSV([{ clave: 'C20-A', nombre: 'Original C20', precioBase: 10 }]), 'upsert', randomUUID())
    const before = await prisma.producto.findUnique({ where: { empresaId_codigoInterno: { empresaId: empresa.id, codigoInterno: 'C20-A' } } })
    const key = randomUUID()
    const response = await importar(makeCSV([{ clave: 'C20-A', nombre: 'No cambiar C20', precioBase: 99 }]), 'solo_nuevos', key)
    const header = await headerFor(key)
    const afterProduct = await prisma.producto.findUnique({ where: { id: before.id } })
    assert.equal(response.status, 200)
    assert.equal(header.Detalle.length, 1)
    assert.equal(header.Detalle[0].estado, 'COMPLETADA')
    assert.equal(header.Detalle[0].accion, 'OMITIDO')
    assert.equal(afterProduct.nombre, before.nombre)
    assert.equal(afterProduct.precioBase.toString(), before.precioBase.toString())
  })

  it('C21 - fingerprint distingue el orden de filas', () => {
    const common = { empresaId: 1, sucursalId: 1, tipo: 'upsert' }
    const a = idempotency.computeImportFingerprint({ ...common, filas: [{ codigoInterno: 'A' }, { codigoInterno: 'B' }] })
    const b = idempotency.computeImportFingerprint({ ...common, filas: [{ codigoInterno: 'B' }, { codigoInterno: 'A' }] })
    assert.notEqual(a.fingerprintHash, b.fingerprintHash)
  })

  it('C22 - fingerprint distingue tenant y sucursal', () => {
    const filas = [{ codigoInterno: 'A' }]
    const a = idempotency.computeImportFingerprint({ empresaId: 1, sucursalId: 1, tipo: 'upsert', filas })
    const tenant = idempotency.computeImportFingerprint({ empresaId: 2, sucursalId: 1, tipo: 'upsert', filas })
    const branch = idempotency.computeImportFingerprint({ empresaId: 1, sucursalId: 2, tipo: 'upsert', filas })
    assert.notEqual(a.fingerprintHash, tenant.fingerprintHash)
    assert.notEqual(a.fingerprintHash, branch.fingerprintHash)
  })

  it('C23 - fingerprint distingue tipo de importacion', () => {
    const base = { empresaId: 1, sucursalId: 1, filas: [{ codigoInterno: 'A' }] }
    const upsert = idempotency.computeImportFingerprint({ ...base, tipo: 'upsert' })
    const onlyNew = idempotency.computeImportFingerprint({ ...base, tipo: 'solo_nuevos' })
    assert.notEqual(upsert.fingerprintHash, onlyNew.fingerprintHash)
  })

  it('C24 - fingerprint distingue departamento y categoria', () => {
    const base = { empresaId: 1, sucursalId: 1, tipo: 'upsert' }
    const a = idempotency.computeImportFingerprint({ ...base, filas: [{ departamento: 'A', categoria: 'X' }] })
    const b = idempotency.computeImportFingerprint({ ...base, filas: [{ departamento: 'A', categoria: 'Y' }] })
    assert.notEqual(a.fingerprintHash, b.fingerprintHash)
  })

  it('C25 - fingerprint distingue proveedor', () => {
    const base = { empresaId: 1, sucursalId: 1, tipo: 'upsert' }
    const a = idempotency.computeImportFingerprint({ ...base, filas: [{ proveedorNombre: 'UNO' }] })
    const b = idempotency.computeImportFingerprint({ ...base, filas: [{ proveedorNombre: 'DOS' }] })
    assert.notEqual(a.fingerprintHash, b.fingerprintHash)
  })

  it('C26 - fingerprint distingue imagen', () => {
    const base = { empresaId: 1, sucursalId: 1, tipo: 'upsert' }
    const a = idempotency.computeImportFingerprint({ ...base, filas: [{ imagenUrl: 'https://img/a.webp' }] })
    const b = idempotency.computeImportFingerprint({ ...base, filas: [{ imagenUrl: 'https://img/b.webp' }] })
    assert.notEqual(a.fingerprintHash, b.fingerprintHash)
  })

  it('C27 - fingerprint normaliza decimales a su escala canonica', () => {
    const base = { empresaId: 1, sucursalId: 1, tipo: 'upsert' }
    const a = idempotency.computeImportFingerprint({
      ...base,
      filas: [{ precioBase: '10.124', costo: '4.999', stockInicial: '2.0004', factorConversion: '1.23444' }],
    })
    const b = idempotency.computeImportFingerprint({
      ...base,
      filas: [{ precioBase: '10.12', costo: '5.00', stockInicial: '2.000', factorConversion: '1.2344' }],
    })
    assert.equal(a.fingerprintHash, b.fingerprintHash)
  })

  it('C28 - renewLease renueva solo el token propietario', async () => {
    const key = randomUUID()
    const fp = idempotency.computeImportFingerprint({ empresaId: empresa.id, sucursalId: sucursal.id, tipo: 'upsert', filas: [] })
    const owner = randomUUID()
    const begin = await idempotency.beginImportCommand(prisma, {
      empresaId: empresa.id, sucursalId: sucursal.id, claveIdempotencia: key, fingerprintHash: fp.fingerprintHash,
      tipo: 'upsert', totalFilas: 0, leaseToken: owner, leaseDurationMs: 1000,
    })
    assert.equal(await idempotency.renewLease(prisma, begin.importacionId, randomUUID(), 60_000), false)
    assert.equal(await idempotency.renewLease(prisma, begin.importacionId, owner, 60_000), true)
  })

  it('C29 - acquireLease permite takeover despues de expirar', async () => {
    const record = await prisma.importacionProductos.create({
      data: { empresaId: empresa.id, claveIdempotencia: randomUUID(), fingerprintHash: 'a'.repeat(64), tipo: 'upsert', totalFilas: 0, estado: 'PROCESANDO', leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1000) },
    })
    const takeover = randomUUID()
    assert.equal(await idempotency.acquireLease(prisma, record.id, takeover, 60_000, empresa.id), true)
    assert.equal((await prisma.importacionProductos.findUnique({ where: { id: record.id } })).leaseToken, takeover)
  })

  it('C30 - acquireLease rechaza takeover con lease activo', async () => {
    const owner = randomUUID()
    const record = await prisma.importacionProductos.create({
      data: { empresaId: empresa.id, claveIdempotencia: randomUUID(), fingerprintHash: 'b'.repeat(64), tipo: 'upsert', totalFilas: 0, estado: 'PROCESANDO', leaseToken: owner, leaseExpiresAt: new Date(Date.now() + 60_000) },
    })
    assert.equal(await idempotency.acquireLease(prisma, record.id, randomUUID(), 60_000, empresa.id), false)
    assert.equal((await prisma.importacionProductos.findUnique({ where: { id: record.id } })).leaseToken, owner)
  })

  it('C31 - misma key se aisla por tenant real', async () => {
    const tenant2 = await createTenant('c31')
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C31-A', nombre: 'Producto compartido' }])
    const first = await importar(csv, 'upsert', key)
    const second = await importar(csv, 'upsert', key, { token: tenant2.token, sucursalId: tenant2.sucursal.id })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(await prisma.importacionProductos.count({ where: { claveIdempotencia: key } }), 2)
    assert.equal(await prisma.producto.count({ where: { codigoInterno: 'C31-A', empresaId: { in: [empresa.id, tenant2.empresa.id] } } }), 2)
  })

  it('C32 - fila origen permanece correcta despues de una invalida', async () => {
    const key = randomUUID()
    await importar(makeCSV([
      { clave: '', nombre: 'Invalida' },
      { clave: 'C32-B', nombre: 'Valida' },
    ]), 'upsert', key)
    const header = await headerFor(key)
    assert.deepEqual(header.Detalle.map((detail) => [detail.fila, detail.estado]), [[2, 'ERROR_VALIDACION'], [3, 'COMPLETADA']])
  })

  it('C33 - importacion multi-lote procesa todas las filas', async () => {
    const key = randomUUID()
    const rows = Array.from({ length: 105 }, (_, index) => ({ clave: `C33-${String(index).padStart(3, '0')}`, nombre: `Producto C33 ${index}` }))
    const response = await importar(makeCSV(rows), 'upsert', key)
    const header = await headerFor(key)
    assert.equal(response.status, 200)
    assert.equal(response.body.creados, 105)
    assert.equal(header.Detalle.length, 105)
    assert.equal(header.filasProcesadas, 105)
  })

  it('C34 - mezcla de filas validas e invalidas conserva un detalle por cada fila', async () => {
    const key = randomUUID()
    const rows = Array.from({ length: 12 }, (_, index) => ({
      clave: index % 4 === 0 ? '' : `C34-${index}`,
      nombre: `Producto C34 ${index}`,
    }))
    await importar(makeCSV(rows), 'upsert', key)
    const header = await headerFor(key)
    assert.equal(header.Detalle.length, rows.length)
    assert.deepEqual(header.Detalle.map((detail) => detail.fila), Array.from({ length: rows.length }, (_, index) => index + 2))
  })

  it('C35 - una importacion completada no tiene detalles ausentes', async () => {
    const key = randomUUID()
    await importar(makeCSV([{ clave: 'C35-A', nombre: 'A' }, { clave: '', nombre: 'B' }, { clave: 'C35-C', nombre: 'C' }]), 'upsert', key)
    const header = await headerFor(key)
    assert.equal(header.estado, 'COMPLETADA')
    assert.equal(header.totalFilas, header.Detalle.length)
    assert.equal(header.filasProcesadas, header.totalFilas)
  })

  it('C36 - ausencia de detalle representa un crash parcial recuperable', async () => {
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C36-A', nombre: 'A' }, { clave: 'C36-B', nombre: 'B' }, { clave: 'C36-C', nombre: 'C' }])
    await importar(csv, 'upsert', key)
    const header = await headerFor(key)
    await prisma.importacionProductosDetalle.delete({ where: { importacionId_fila: { importacionId: header.id, fila: 3 } } })
    await prisma.importacionProductos.update({
      where: { id: header.id },
      data: { estado: 'PROCESANDO', respuesta: null, leaseExpiresAt: new Date(Date.now() - 1000) },
    })
    const partial = await headerFor(key)
    assert.equal(partial.totalFilas, 3)
    assert.equal(partial.Detalle.length, 2)
    assert.equal(partial.Detalle.some((detail) => detail.fila === 3), false)
  })

  it('C37 - beginImportCommand reproduce un header COMPLETADA', async () => {
    const key = randomUUID()
    const fp = idempotency.computeImportFingerprint({ empresaId: empresa.id, sucursalId: sucursal.id, tipo: 'upsert', filas: [] })
    const first = await idempotency.beginImportCommand(prisma, {
      empresaId: empresa.id, sucursalId: sucursal.id, claveIdempotencia: key, fingerprintHash: fp.fingerprintHash,
      tipo: 'upsert', totalFilas: 0,
    })
    const snapshot = { ok: true, marker: 'C37' }
    await idempotency.finalizeImport(prisma, { importacionId: first.importacionId, leaseToken: first.leaseToken, counts: {}, respuesta: snapshot })
    const replay = await idempotency.beginImportCommand(prisma, {
      empresaId: empresa.id, sucursalId: sucursal.id, claveIdempotencia: key, fingerprintHash: fp.fingerprintHash,
      tipo: 'upsert', totalFilas: 0,
    })
    assert.equal(replay.kind, idempotency.BEGIN_RESULT.REPLAY)
    assert.deepEqual(replay.respuesta, snapshot)
  })

  it('C38 - beginImportCommand detecta fingerprint conflictivo', async () => {
    const key = randomUUID()
    const firstFp = idempotency.computeImportFingerprint({ empresaId: empresa.id, sucursalId: sucursal.id, tipo: 'upsert', filas: [{ a: 1 }] })
    const secondFp = idempotency.computeImportFingerprint({ empresaId: empresa.id, sucursalId: sucursal.id, tipo: 'upsert', filas: [{ a: 2 }] })
    await idempotency.beginImportCommand(prisma, {
      empresaId: empresa.id, sucursalId: sucursal.id, claveIdempotencia: key, fingerprintHash: firstFp.fingerprintHash,
      tipo: 'upsert', totalFilas: 1,
    })
    const conflict = await idempotency.beginImportCommand(prisma, {
      empresaId: empresa.id, sucursalId: sucursal.id, claveIdempotencia: key, fingerprintHash: secondFp.fingerprintHash,
      tipo: 'upsert', totalFilas: 1,
    })
    assert.equal(conflict.kind, idempotency.BEGIN_RESULT.CONFLICT)
    assert.equal(conflict.error, 'IDEMPOTENCY_KEY_REUSED')
  })

  it('C39 - failImport persiste snapshot y counters como FALLIDA', async () => {
    const key = randomUUID()
    const fp = idempotency.computeImportFingerprint({ empresaId: empresa.id, sucursalId: sucursal.id, tipo: 'upsert', filas: [] })
    const begin = await idempotency.beginImportCommand(prisma, {
      empresaId: empresa.id, sucursalId: sucursal.id, claveIdempotencia: key, fingerprintHash: fp.fingerprintHash,
      tipo: 'upsert', totalFilas: 2,
    })
    const counts = { filasProcesadas: 1, creados: 0, actualizados: 0, vinculaciones: 0, omitidos: 0, errores: 1, advertencias: 0 }
    const snapshot = { error: 'C39', errores: 1 }
    await idempotency.failImport(prisma, { importacionId: begin.importacionId, leaseToken: begin.leaseToken, counts, respuesta: snapshot })
    const header = await prisma.importacionProductos.findUnique({ where: { id: begin.importacionId } })
    assert.equal(header.estado, 'FALLIDA')
    assert.equal(header.errores, 1)
    assert.deepEqual(header.respuesta, snapshot)
  })

  it('C40 - aggregateFromDetails cuenta todas las acciones y metadatos', async () => {
    const header = await prisma.importacionProductos.create({ data: { empresaId: empresa.id, claveIdempotencia: randomUUID(), fingerprintHash: 'c'.repeat(64), tipo: 'upsert', totalFilas: 4 } })
    await prisma.importacionProductosDetalle.createMany({
      data: [
        { importacionId: header.id, fila: 2, codigoInterno: 'C40-A', estado: 'COMPLETADA', accion: 'CREADO', vinculaciones: 2, advertencia: 'warning' },
        { importacionId: header.id, fila: 3, codigoInterno: 'C40-B', estado: 'COMPLETADA', accion: 'ACTUALIZADO' },
        { importacionId: header.id, fila: 4, codigoInterno: 'C40-C', estado: 'COMPLETADA', accion: 'OMITIDO' },
        { importacionId: header.id, fila: 5, codigoInterno: 'C40-D', estado: 'ERROR_SISTEMA', accion: 'ERROR', error: 'x' },
      ],
    })
    assert.deepEqual(await idempotency.aggregateFromDetails(prisma, header.id), {
      filasProcesadas: 4, creados: 1, actualizados: 1, vinculaciones: 2, omitidos: 1, errores: 1, advertencias: 1,
    })
  })

  it('C41 - validacion de key acepta exactamente los limites 36 y 64', () => {
    assert.equal(idempotency.validateIdempotencyKey('a'.repeat(36)).valid, true)
    assert.equal(idempotency.validateIdempotencyKey('z'.repeat(64)).valid, true)
    assert.equal(idempotency.validateIdempotencyKey(undefined).missing, true)
  })

  it('C42 - canonicalizacion decimal conserva escala y redondeo exactos', () => {
    assert.equal(idempotency.canonicalizeDecimal('10.125', 2), '10.13')
    assert.equal(idempotency.canonicalizeDecimal('-10.125', 2), '-10.13')
    assert.equal(idempotency.canonicalizeDecimal('2e1', 3), '20.000')
    assert.equal(idempotency.canonicalizeDecimal('no-numero', 2), null)
  })

  it('C43 - solo_nuevos replay devuelve el snapshot completo', async () => {
    const key = randomUUID()
    const csv = makeCSV([{ clave: 'C43-A', nombre: 'Producto C43' }])
    const first = await importar(csv, 'solo_nuevos', key)
    const replay = await importar(csv, 'solo_nuevos', key)
    const header = await headerFor(key)
    assert.equal(first.status, 200)
    assert.deepEqual(first.body, header.respuesta)
    assert.deepEqual(replay.body, header.respuesta)
  })

  it('C44 - solo_nuevos registra validacion invalida como detalle terminal', async () => {
    const key = randomUUID()
    const response = await importar(makeCSV([{ clave: 'C44-A', nombre: '', precioBase: 10 }]), 'solo_nuevos', key)
    const header = await headerFor(key)
    assert.equal(response.status, 200)
    assert.equal(header.Detalle.length, 1)
    assert.equal(header.Detalle[0].estado, 'ERROR_VALIDACION')
    assert.equal(header.Detalle[0].fila, 2)
  })

  it('C45 - takeover helper conserva el header y cambia el lease token', async () => {
    const key = randomUUID()
    const fp = idempotency.computeImportFingerprint({ empresaId: empresa.id, sucursalId: sucursal.id, tipo: 'upsert', filas: [] })
    const first = await idempotency.beginImportCommand(prisma, {
      empresaId: empresa.id, sucursalId: sucursal.id, claveIdempotencia: key, fingerprintHash: fp.fingerprintHash,
      tipo: 'upsert', totalFilas: 0, leaseToken: randomUUID(), leaseDurationMs: 10,
    })
    await prisma.importacionProductos.update({ where: { id: first.importacionId }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })
    const nextToken = randomUUID()
    const takeover = await idempotency.beginImportCommand(prisma, {
      empresaId: empresa.id, sucursalId: sucursal.id, claveIdempotencia: key, fingerprintHash: fp.fingerprintHash,
      tipo: 'upsert', totalFilas: 0, leaseToken: nextToken,
    })
    assert.equal(takeover.kind, idempotency.BEGIN_RESULT.ACQUIRED)
    assert.equal(takeover.created, false)
    assert.equal(takeover.importacionId, first.importacionId)
    assert.equal(takeover.leaseToken, nextToken)
  })

  it('C46 - fingerprint HTTP incluye categoria proveedor imagen y decimales canonicos', async () => {
    const key = randomUUID()
    const base = {
      clave: 'C46-A', nombre: 'Producto C46', depto: 'D46', cat: 'CAT-A', proveedor: 'Proveedor A',
      imagenUrl: 'https://img/a.webp', precioBase: '10.120', costo: '5.000', stock: '2.0000',
    }
    assert.equal((await importar(makeCSV([base]), 'upsert', key)).status, 200)
    const equivalent = await importar(makeCSV([{ ...base, precioBase: '10.12', costo: '5.00', stock: '2.000' }]), 'upsert', key)
    assert.equal(equivalent.status, 200)
    for (const changed of [
      { cat: 'CAT-B' },
      { proveedor: 'Proveedor B' },
      { imagenUrl: 'https://img/b.webp' },
      { precioBase: '10.13' },
    ]) {
      const conflict = await importar(makeCSV([{ ...base, ...changed }]), 'upsert', key)
      assert.equal(conflict.status, 409)
      assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_REUSED')
    }
  })
})
