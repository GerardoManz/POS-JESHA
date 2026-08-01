'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const path = require('node:path')
const pg = require('pg')
const bcrypt = require('bcryptjs')

const BACKEND_DIR = path.resolve(__dirname, '..')
const DB_PREFIX = 'jesha_p0_bdry_test_'
const DB_RE = /^jesha_p0_bdry_test_[a-z0-9_]+$/

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Falta variable requerida: ${name}`)
  }
  return value
}

function resolvePgConfig() {
  const host = requiredEnv('P0_TEST_PG_HOST')
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('P0_TEST_PG_HOST debe ser local')
  }
  const port = Number(requiredEnv('P0_TEST_PG_PORT'))
  return Object.freeze({
    user: requiredEnv('P0_TEST_PG_USER'),
    password: requiredEnv('P0_TEST_PG_PASSWORD'),
    host, port
  })
}

function validateDbName(name) {
  if (!DB_RE.test(name) || name === DB_PREFIX) throw new Error('Nombre de base temporal inválido')
  return name
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
      cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000
    })
    return
  }
  execFileSync('npx', args, { cwd: BACKEND_DIR, env, stdio: 'pipe', timeout: 120000 })
}

describe('P0-PLATFORM-BOUNDARY PostgreSQL', { concurrency: 1, timeout: 300000 }, () => {
  const pgConfig = resolvePgConfig()
  const dbName = validateDbName(`${DB_PREFIX}${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`)
  const databaseUrl = connectionUrl(pgConfig, dbName)
  const adminPool = new pg.Pool({ connectionString: connectionUrl(pgConfig, 'postgres'), max: 1 })

  let created = false
  let prisma

  before(async () => {
    await adminPool.query(`CREATE DATABASE "${dbName}"`)
    created = true
    dbPush(databaseUrl)

    process.env.DATABASE_URL = databaseUrl

    prisma = require('../src/lib/prisma')

    await prisma.empresa.create({ data: {
      slug: 'test-empresa', nombreComercial: 'Test', razonSocial: 'Test SA',
      whatsapp: '0000000001', activa: true
    } })
  })

  after(async () => {
    if (prisma) {
      try { await prisma.$disconnect() } catch (err) { /* swallow */ }
    }
    await new Promise((r) => setTimeout(r, 500))
    delete require.cache[require.resolve('../src/lib/prisma')]

    if (created) {
      try { await adminPool.query(`DROP DATABASE "${dbName}"`) } catch (err) { /* swallow */ }
    }
    try { await adminPool.end() } catch (err) { /* swallow */ }
  })

  it('1. prevalidarActor rechaza PLATFORM_ADMIN como actor', () => {
    const controllerSrc = require('fs').readFileSync(
      path.resolve(__dirname, '../src/modules/usuarios/usuarios.controller.js'), 'utf8'
    )
    const actorBypass = controllerSrc.includes("actor.rol !== 'SUPERADMIN' && actor.rol !== 'PLATFORM_ADMIN'")
    assert.strictEqual(actorBypass, false, 'PLATFORM_ADMIN bypass de actor presente')
    assert.ok(controllerSrc.includes("actor.rol !== 'SUPERADMIN'"), 'Falta validacion de actor')
  })

  it('2. SUPERADMIN crea EMPLEADO con politica correcta', async () => {
    const empresa = await prisma.empresa.findFirst()
    const hash = await bcrypt.hash('test', 10)

    const superActor = await prisma.usuario.create({ data: {
      nombre: 'Super', username: `bdry-super-${Date.now()}`, passwordHash: hash,
      rol: 'SUPERADMIN', activo: true, empresaId: empresa.id, sucursalId: null
    } })

    const superRow = await prisma.usuario.findUnique({ where: { id: superActor.id } })
    assert.strictEqual(superRow.rol, 'SUPERADMIN')
    assert.strictEqual(superRow.empresaId, empresa.id)
    assert.strictEqual(superRow.sucursalId, null)
  })

  it('3. requireRole bloquea PLATFORM_ADMIN en ruta usuarios', async () => {
    // Static verification: source code should NOT have PLATFORM_ADMIN in requireRole
    const routesSrc = require('fs').readFileSync(
      path.resolve(__dirname, '../src/modules/usuarios/usuarios.routes.js'), 'utf8'
    )
    const lines = routesSrc.split('\n').filter(l => l.includes('requireRole'))
    for (const line of lines) {
      assert.ok(!line.includes('PLATFORM_ADMIN'), `requireRole con PLATFORM_ADMIN: ${line.trim()}`)
    }
  })

  it('4. controller usuarios protege PLATFORM_ADMIN como objetivo', async () => {
    const controllerSrc = require('fs').readFileSync(
      path.resolve(__dirname, '../src/modules/usuarios/usuarios.controller.js'), 'utf8'
    )
    assert.ok(controllerSrc.includes("objetivoRol === 'PLATFORM_ADMIN'"), 'Debe proteger PLATFORM_ADMIN como target')
    assert.ok(!controllerSrc.includes("actor.rol !== 'SUPERADMIN' && actor.rol !== 'PLATFORM_ADMIN'"), 'PLATFORM_ADMIN no debe ser actor')
  })
})
