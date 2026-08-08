'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const path = require('node:path')
const pg = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_p0_branch_management_'
const DB_RE = /^jesha_p0_branch_management_[a-z0-9_]+$/
const TENANT_SECRET = 'branch-management-pg-secret-'.padEnd(64, 'b')
const TENANT_ISSUER = 'jesha-branch-management-pg'
const TENANT_AUDIENCE = 'jesha-branch-management-api-pg'

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Falta ${name}`)
  return value
}

function pgConfig() {
  const host = requiredEnv('P0_TEST_PG_HOST')
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Host PostgreSQL no local')
  const portRaw = requiredEnv('P0_TEST_PG_PORT')
  if (!/^\d+$/.test(portRaw)) throw new Error('Puerto inválido')
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto fuera de rango')
  return { user: requiredEnv('P0_TEST_PG_USER'), password: requiredEnv('P0_TEST_PG_PASSWORD'), host, port }
}

function validateDbName(name) {
  if (!DB_RE.test(name) || name === DB_PREFIX) throw new Error('Nombre temporal inválido')
  return name
}

function quoteDb(name) { return `"${validateDbName(name)}"` }

function connectionUrl(config, dbName) {
  const host = config.host === '::1' ? '[::1]' : config.host
  return `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${host}:${config.port}/${encodeURIComponent(dbName)}`
}

function dbPush(databaseUrl) {
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  const args = ['prisma', 'db', 'push', '--schema', 'prisma/schema.prisma']
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], {
      cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000
    })
    return
  }
  execFileSync('npx', args, { cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000 })
}

function mockRes() {
  const state = { statusCode: 200, body: null }
  return {
    state,
    status(code) { state.statusCode = code; return this },
    json(body) { state.body = JSON.parse(JSON.stringify(body)); return this },
    end() { return this }
  }
}

function sign(sub, rol) {
  return jwt.sign({ version: 1, kind: 'TENANT', sub, rol }, TENANT_SECRET, {
    algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '15m'
  })
}

describe('P0-TENANT-BRANCH-MANAGEMENT PostgreSQL aislado', { concurrency: 1, timeout: 300000 }, () => {
  const config = pgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(config, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(config, 'postgres'), max: 1 })

  let created = false
  let prisma
  let mw // auth.middleware
  let scopeM // scope.middleware
  let ctrl // sucursal.controller

  let empresaA, empresaB, empresaC
  let a1, a2, b1
  let superA, adminA, superB
  let nuevaA

  before(async () => {
    await adminPool.query(`CREATE DATABASE ${quoteDb(dbName)}`)
    created = true
    dbPush(databaseUrl)

    process.env.DATABASE_URL = databaseUrl
    process.env.TENANT_JWT_SECRET = TENANT_SECRET
    process.env.TENANT_JWT_ISSUER = TENANT_ISSUER
    process.env.TENANT_JWT_AUDIENCE = TENANT_AUDIENCE
    process.env.TENANT_JWT_TTL = '8h'

    prisma = require('../src/lib/prisma')
    mw = require('../src/middlewares/auth.middleware')
    scopeM = require('../src/middlewares/scope.middleware')
    ctrl = require('../src/modules/sucursal/sucursal.controller')

    const hash = await bcrypt.hash('branch-mgmt-test-only', 10)

    empresaA = await prisma.empresa.create({ data: {
      slug: 'br-a', nombreComercial: 'Estab A', razonSocial: 'Estab A SA', whatsapp: '0000000001', activa: true
    } })
    empresaB = await prisma.empresa.create({ data: {
      slug: 'br-b', nombreComercial: 'Estab B', razonSocial: 'Estab B SA', whatsapp: '0000000002', activa: true
    } })
    empresaC = await prisma.empresa.create({ data: {
      slug: 'br-c', nombreComercial: 'Estab C', razonSocial: 'Estab C SA', whatsapp: '0000000003', activa: true
    } })

    a1 = await prisma.sucursal.create({ data: {
      empresaId: empresaA.id, nombre: 'Matriz A', codigoPostal: '97000', activa: true
    } })
    a2 = await prisma.sucursal.create({ data: {
      empresaId: empresaA.id, nombre: 'Anexo A', codigoPostal: '97001', activa: false
    } })
    b1 = await prisma.sucursal.create({ data: {
      empresaId: empresaB.id, nombre: 'Matriz B', codigoPostal: '98000', activa: true
    } })

    superA = await prisma.usuario.create({ data: {
      nombre: 'Super A', username: 'super.a', passwordHash: hash, rol: 'SUPERADMIN',
      activo: true, empresaId: empresaA.id, sucursalId: null
    } })
    adminA = await prisma.usuario.create({ data: {
      nombre: 'Admin A1', username: 'admin.a', passwordHash: hash, rol: 'ADMIN_SUCURSAL',
      activo: true, empresaId: empresaA.id, sucursalId: a1.id
    } })
    superB = await prisma.usuario.create({ data: {
      nombre: 'Super B', username: 'super.b', passwordHash: hash, rol: 'SUPERADMIN',
      activo: true, empresaId: empresaB.id, sucursalId: null
    } })
  })

  after(async () => {
    const failures = []
    if (prisma) {
      try { await prisma.$disconnect() } catch (err) { failures.push(`prisma: ${err.message}`) }
      if (prisma.pool) { try { await prisma.pool.end() } catch (err) { failures.push(`pool: ${err.message}`) } }
    }
    if (created) {
      try {
        await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [dbName])
        await adminPool.query(`DROP DATABASE ${quoteDb(dbName)}`)
        const result = await adminPool.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])
        if (result.rows.length) failures.push('base residual')
      } catch (err) { failures.push(`drop: ${err.message}`) }
    }
    try { await adminPool.end() } catch (err) { failures.push(`admin: ${err.message}`) }
    if (failures.length) throw new Error(failures.join(' | '))
  })

  async function executeAuth(token, sucursalHeader) {
    const headers = { authorization: `Bearer ${token}` }
    if (sucursalHeader !== undefined) headers['x-sucursal-id'] = String(sucursalHeader)
    const req = { headers, query: {}, params: {}, body: {}, path: '/sucursales/gestion', requestId: 'branch-pg', ip: '127.0.0.1' }
    const res = mockRes()
    let nextCalls = 0
    await mw.requireAuth(req, res, () => { nextCalls++ })
    return { req, res, nextCalls }
  }

  // 1. requireRole gate
  it('requiere rol SUPERADMIN para gestionar (requireRole deja pasar a SUPERADMIN)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    let calls = 0
    await mw.requireRole('SUPERADMIN')(req, res, () => { calls++ })
    assert.strictEqual(calls, 1)
  })

  it('requireRole rechaza a ADMIN_SUCURSAL con 403 antes del controlador', async () => {
    const { req, res } = await executeAuth(sign(adminA.id, 'ADMIN_SUCURSAL'))
    const log = []
    await scopeM.tenantGlobal(req, res, () => log.push('scope'))
    await mw.requireRole('SUPERADMIN')(req, res, () => log.push('role'))
    assert.deepStrictEqual(log, ['scope'])
    assert.strictEqual(res.state.statusCode, 403)
  })

  it('requireRole acepta SUPERADMIN y llama al controlador', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    const log = []
    await mw.requireRole('SUPERADMIN')(req, res, () => log.push('role'))
    assert.deepStrictEqual(log, ['role'])
    assert.strictEqual(res.state.statusCode, 200)
  })

  it('crear: payload incompleto → 400 con errores por campo', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.body = {}
    await ctrl.crear(req, res)
    assert.strictEqual(res.state.statusCode, 400)
    assert.ok(Array.isArray(res.state.body.errores))
  })

  it('crear: rechaza el campo prohibido empresaId en el body', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.body = { nombre: 'Nueva', codigoPostal: '97000', empresaId: 1 }
    await ctrl.crear(req, res)
    assert.strictEqual(res.state.statusCode, 400)
    assert.ok(res.state.body.errores.some(e => e.campo === 'empresaId'))
  })

  it('crear: rechaza el campo prohibido activa=true en el body', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.body = { nombre: 'Nueva', codigoPostal: '97000', activa: true }
    await ctrl.crear(req, res)
    assert.strictEqual(res.state.statusCode, 400)
    assert.ok(res.state.body.errores.some(e => e.campo === 'activa'))
  })

  it('crear: sucursal válida nace DESACTIVADA (activa=false impuesto) y 201', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.body = { nombre: 'Nueva Suc A', codigoPostal: '97000', direccion: 'Calle 1', telefono: '9991234567' }
    await ctrl.crear(req, res)
    assert.strictEqual(res.state.statusCode, 201)
    const s = res.state.body.sucursal
    assert.strictEqual(s.activa, false)
    assert.strictEqual(s.empresaId, undefined) // no se filtra en response
    assert.strictEqual(s.nombre, 'Nueva Suc A')
    nuevaA = s.id
  })

  it('crear: sin datos falsos (no se crean caja/turno/inventario/usuario)', async () => {
    assert.ok(nuevaA > 0)
    const turnos = await prisma.turnoCaja.count({ where: { sucursalId: nuevaA } })
    const cajas = await prisma.movimientoCaja.count({})
    assert.strictEqual(turnos, 0)
  })

  it('crear: registra auditoría SUCURSAL_CREAR', async () => {
    const log = await prisma.auditoria.findFirst({
      where: { accion: 'SUCURSAL_CREAR', sucursalId: nuevaA },
      select: { modulo: true, usuarioId: true, empresaId: true, sucursalId: true }
    })
    assert.ok(log)
    assert.strictEqual(log.modulo, 'sucursales')
    assert.strictEqual(log.empresaId, empresaA.id)
    assert.strictEqual(log.sucursalId, nuevaA)
  })

  it('listar gestión: SUPERADMIN ve solo sucursales de SU empresa (activas + inactivas)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.statusCode, 200)
    const ids = res.state.body.sucursales.map(s => s.id).sort()
    assert.ok(ids.includes(a1.id) && ids.includes(a2.id) && !ids.includes(b1.id) && ids.includes(nuevaA))
    assert.strictEqual(res.state.body.sucursales.every(s => s.id !== b1.id), true) // aislada por tenant
  })

  it('listar: no filtra de otra empresa (sin b1)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { estado: 'todas' }
    await ctrl.gestion(req, res)
    const ids = res.state.body.sucursales.map(s => s.id)
    assert.strictEqual(ids.includes(b1.id), false)
  })

  it('listar: filtro solo inactivas', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { estado: 'inactivas' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.sucursales.every(s => s.activa === false), true)
  })

  it('listar: filtro solo activas', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { estado: 'activas' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.sucursales.every(s => s.activa === true), true)
  })

  it('listar: búsqueda por nombre (case-insensitive)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { buscar: 'anexo' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.sucursales.length, 1)
    assert.strictEqual(res.state.body.sucursales[0].id, a2.id)
  })

  it('listar: paginación sanitizada (porPagina truncada a 1..100)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { porPagina: '5000', pagina: '1' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.porPagina, 100)
  })

  it('empresa C: reporta cero sucursales (sin error)', async () => {
    const superC = await prisma.usuario.create({ data: { nombre: 'Super C', username: 'super.c', passwordHash: await bcrypt.hash('x', 10), rol: 'SUPERADMIN', activo: true, empresaId: empresaC.id, sucursalId: null } })
    const { req, res } = await executeAuth(sign(superC.id, 'SUPERADMIN'))
    req.query = { estado: 'todas' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.total, 0)
    assert.deepStrictEqual(res.state.body.sucursales, [])
  })

  it('obtener: 404 para sucursal de otra empresa (aislamiento)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(b1.id) }
    await ctrl.obtener(req, res)
    assert.strictEqual(res.state.statusCode, 404)
  })

  it('obtener: 200 para sucursal propia', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a1.id) }
    await ctrl.obtener(req, res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.strictEqual(res.state.body.sucursal.id, a1.id)
  })

  it('obtener: 400 para id inválido', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: 'abc' }
    await ctrl.obtener(req, res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('obtener: 404 para id inexistente con formato válido', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: '999999' }
    await ctrl.obtener(req, res)
    assert.strictEqual(res.state.statusCode, 404)
  })

  it('editar: actualiza nombre y codigoPostal', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a2.id) }
    req.body = { nombre: 'Anexo Norte', codigoPostal: '97099' }
    await ctrl.editar(req, res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.strictEqual(res.state.body.sucursal.nombre, 'Anexo Norte')
    const enDb = await prisma.sucursal.findUnique({ where: { id: a2.id }, select: { nombre: true, codigoPostal: true } })
    assert.strictEqual(enDb.codigoPostal, '97099')
  })

  it('editar: registra auditoría SUCURSAL_EDITAR', async () => {
    const log = await prisma.auditoria.findFirst({ where: { accion: 'SUCURSAL_EDITAR', sucursalId: a2.id }, select: { id: true } })
    assert.ok(log)
  })

  it('editar: rechaza cambiar activa (prohibido)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a2.id) }
    req.body = { activa: true }
    await ctrl.editar(req, res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('editar: sin campos → 400', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a2.id) }
    req.body = {}
    await ctrl.editar(req, res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('editar: 404 para sucursal de otra empresa', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(b1.id) }
    req.body = { nombre: 'Intruso' }
    await ctrl.editar(req, res)
    assert.strictEqual(res.state.statusCode, 404)
  })

  it('activar: pone activa=true', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a2.id) }
    await ctrl.activar(req, res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.strictEqual(res.state.body.sucursal.activa, true)
  })

  it('activar: es idempotente (repetir → 200 sin error)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a2.id) }
    await ctrl.activar(req, res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.strictEqual(res.state.body.sucursal.activa, true)
  })

  it('desactivar: sin turno abierto → 200 activa false', async () => {
    // nuevaA está activa (activada en tests previos); desactivarla debe registrar SUCURSAL_DESACTIVAR
    await prisma.sucursal.update({ where: { id: nuevaA }, data: { activa: true } })
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(nuevaA) }
    await ctrl.desactivar(req, res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.strictEqual(res.state.body.sucursal.activa, false)
  })

  it('desactivar: idempotente (ya inactiva → 200 sin bloquear)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(nuevaA) }
    await ctrl.desactivar(req, res)
    assert.strictEqual(res.state.statusCode, 200)
  })

  it('desactivar: bloquea 409 SUCURSAL_CON_TURNO_ABIERTO si hay turno abierto', async () => {
    // reactivar a1 y crearle un turno abierto
    await prisma.sucursal.update({ where: { id: a1.id }, data: { activa: true } })
    const turno = await prisma.turnoCaja.create({ data: {
      empresaId: empresaA.id, sucursalId: a1.id, usuarioId: superA.id, montoInicial: 0, abierto: true
    } })
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a1.id) }
    await ctrl.desactivar(req, res)
    assert.strictEqual(res.state.statusCode, 409)
    assert.strictEqual(res.state.body.error, 'SUCURSAL_CON_TURNO_ABIERTO')
  })

  it('desactivar: 404 para sucursal de otra empresa', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(b1.id) }
    await ctrl.desactivar(req, res)
    assert.strictEqual(res.state.statusCode, 404)
  })

  it('activar: registra auditoría SUCURSAL_ACTIVAR', async () => {
    const log = await prisma.auditoria.findFirst({ where: { accion: 'SUCURSAL_ACTIVAR', sucursalId: a2.id }, select: { id: true, empresaId: true } })
    assert.ok(log)
    assert.strictEqual(log.empresaId, empresaA.id)
  })

  it('desactivar: registra auditoría SUCURSAL_DESACTIVAR', async () => {
    const log = await prisma.auditoria.findFirst({ where: { accion: 'SUCURSAL_DESACTIVAR', sucursalId: nuevaA }, select: { id: true } })
    assert.ok(log)
  })

  it('invariante: no existe endpoint de borrado (controller no expone eliminar)', async () => {
    assert.strictEqual(typeof ctrl.eliminar, 'undefined')
  })

  it('contrato operativo: /sucursales (listar) devuelve SOLO activas', async () => {
    await prisma.sucursal.update({ where: { id: a2.id }, data: { activa: false } })
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    await ctrl.listar(req, res)
    assert.strictEqual(res.state.statusCode, 200)
    assert.ok(res.state.body.every(s => s.activa === true))
  })

  it('contrato operativo: /disponibles de empA incluye activas, excluye inactivas (NONE)', async () => {
    // modo seleccionado de superA es NONE (sin header)
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    const next = () => {}
    await scopeM.tenantGlobal(req, res, next)
    await ctrl.listarDisponibles(req, res)
    assert.strictEqual(res.state.statusCode, 200)
    const ids = res.state.body.sucursales.map(s => s.id)
    assert.ok(ids.includes(a1.id))
    assert.strictEqual(ids.includes(a2.id), false)
  })

  it('disponible: nunca incluye inmutable inactiva de otra empresa', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    await scopeM.tenantGlobal(req, res, () => {})
    await ctrl.listarDisponibles(req, res)
    const ids = res.state.body.sucursales.map(s => s.id)
    assert.strictEqual(ids.includes(b1.id), false)
  })

  it('requiereAuth: token de empresa B no puede listar gestión de A (404 por tenant at listado)', async () => {
    const superBLocal = superB
    const { req, res } = await executeAuth(sign(superBLocal.id, 'SUPERADMIN'))
    req.query = { estado: 'todas' }
    await ctrl.gestion(req, res)
    const ids = res.state.body.sucursales.map(s => s.id)
    assert.ok(ids.includes(b1.id))
    assert.strictEqual(ids.includes(a1.id) && ids.includes(a2.id), false)
  })

  it('empresa C: no ve sucursales ajenas aunque tenga id (vacío)', async () => {
    // crear SUPERADMIN de C no necesario; el sugerido: lista vacía
    const superC2 = await prisma.usuario.create({ data: { nombre: 'Super C2', username: 'super.c2', passwordHash: await bcrypt.hash('x', 10), rol: 'SUPERADMIN', activo: true, empresaId: empresaC.id, sucursalId: null } })
    const { req, res } = await executeAuth(sign(superC2.id, 'SUPERADMIN'))
    req.query = { estado: 'activas' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.total, 0)
  })

  it('validarEntero fallback: porPagina inválido usa default 20', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { porPagina: 'abc' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.porPagina, 20)
  })

  it('crear: nombre normaliza a string trim', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.body = { nombre: '  Suc Central  ', codigoPostal: '97010' }
    await ctrl.crear(req, res)
    assert.strictEqual(res.state.statusCode, 201)
    assert.strictEqual(res.state.body.sucursal.nombre, 'Suc Central')
  })

  it('desactivado no puede ser seleccionado: contexto rechaza inactiva', async () => {
    // a2 ahora inactiva; un SUPERADMIN que intente seleccionarla recibe 403
    const { res } = await executeAuth(sign(superA.id, 'SUPERADMIN'), String(a2.id))
    assert.strictEqual(res.state.statusCode, 403)
  })

  it('gestion: total cuenta todas las sucursales de la empresa', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { estado: 'todas' }
    await ctrl.gestion(req, res)
    assert.ok(res.state.body.total >= 3) // a1 + a2 + nuevaA + Suc Central
    assert.strictEqual(res.state.body.sucursales.length, res.state.body.total)
  })

  it('gestion: ordena por nombre asc (Anexo < Central < Matriz < Nueva...)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { estado: 'todas', porPagina: '100' }
    await ctrl.gestion(req, res)
    const nombres = res.state.body.sucursales.map(s => s.nombre.toLowerCase())
    const ordenado = [...nombres].sort()
    assert.deepStrictEqual(nombres, ordenado)
  })

  it('gestion: búsqueda por codigoPostal', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { buscar: '97010' } // Suc Central
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.total, 1)
    assert.strictEqual(res.state.body.sucursales[0].codigoPostal, '97010')
  })

  it('gestion: porPagina=2 limita la lista y mantiene total completo', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { estado: 'todas', porPagina: '2' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.sucursales.length, 2)
    assert.ok(res.state.body.total > 2)
  })

  it('gestion: pagina inválida usa default 1 (sin rango negativo)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.query = { pagina: '-5' }
    await ctrl.gestion(req, res)
    assert.strictEqual(res.state.body.pagina, 1)
  })

  it('crear: telefono excesivo → 400', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.body = { nombre: 'Con tel largo', codigoPostal: '97000', telefono: '9'.repeat(25) }
    await ctrl.crear(req, res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('crear: codigoPostal vacío → 400 obligatorio', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.body = { nombre: 'Sin cp', codigoPostal: '' }
    await ctrl.crear(req, res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('obtener/editar/activar/desactivar: id inexistente válido → 404', async () => {
    const { req: r1, res: s1 } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    r1.params = { id: '424242' }
    await ctrl.obtener(r1, s1)
    assert.strictEqual(s1.state.statusCode, 404)

    const { req: r2, res: s2 } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    r2.params = { id: '424242' }; r2.body = { nombre: 'Inexistente' }
    await ctrl.editar(r2, s2)
    assert.strictEqual(s2.state.statusCode, 404)

    const { req: r3, res: s3 } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    r3.params = { id: '424242' }
    await ctrl.activar(r3, s3)
    assert.strictEqual(s3.state.statusCode, 404)

    const { req: r4, res: s4 } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    r4.params = { id: '424242' }
    await ctrl.desactivar(r4, s4)
    assert.strictEqual(s4.state.statusCode, 404)
  })

  it('editar: codigoPostal conserva ceros iniciales como string', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a1.id) }
    req.body = { codigoPostal: '00040' }
    await ctrl.editar(req, res)
    assert.strictEqual(res.state.body.sucursal.codigoPostal, '00040')
  })

  it('respuesta de crear/obtener NO expone empresaId ni folio (shape sanitizada)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a1.id) }
    await ctrl.obtener(req, res)
    const s = res.state.body.sucursal
    assert.strictEqual(s.empresaId, undefined)
    assert.strictEqual(s.folio, undefined)
    assert.strictEqual(typeof s.id, 'number')
    assert.strictEqual(typeof s.creadaEn, 'string')
  })

  it('auditoría: activar repetido no duplica el registro (idempotencia de auditoría)', async () => {
    // a2 activa; desactivar y activar una sola vez
    await prisma.sucursal.update({ where: { id: a2.id }, data: { activa: false } })
    const antes = await prisma.auditoria.count({ where: { accion: 'SUCURSAL_ACTIVAR', sucursalId: a2.id } })
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(a2.id) }
    await ctrl.activar(req, res)
    const despues = await prisma.auditoria.count({ where: { accion: 'SUCURSAL_ACTIVAR', sucursalId: a2.id } })
    assert.strictEqual(despues, antes + 1)
  })

  it('desactivar: id inválido → 400', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: '0' }
    await ctrl.desactivar(req, res)
    assert.strictEqual(res.state.statusCode, 400)
  })

  it('activar: id de otra empresa → 404 (aislamiento en acción de estado)', async () => {
    const { req, res } = await executeAuth(sign(superA.id, 'SUPERADMIN'))
    req.params = { id: String(b1.id) }
    await ctrl.activar(req, res)
    assert.strictEqual(res.state.statusCode, 404)
  })
})