'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const { spawn, execFileSync } = require('child_process')
const { randomBytes } = require('crypto')
const { EventEmitter } = require('events')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const pg = require('pg')

// ════════════════════════════════════════════════════════════════════
//  SeedHarnessError — error tipado del harness
// ════════════════════════════════════════════════════════════════════
class SeedHarnessError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SeedHarnessError'
    this.code = code
  }
}

// ════════════════════════════════════════════════════════════════════
//  Constantes de seguridad
// ════════════════════════════════════════════════════════════════════
const TEST_DB_PREFIX = 'jesha_p0_seed_test_'
const TEST_DB_NAME_RE = /^jesha_p0_seed_test_[a-zA-Z0-9_]+$/
const FORBIDDEN_DB_NAMES = new Set(['jesha_db', 'postgres', 'template0', 'template1'])
const PG_ADMIN_DB = 'postgres'
const BACKEND_DIR = path.resolve(__dirname, '..')
const SEED_CHILD_TIMEOUT_MS = 60000
const SCENARIO_TIMEOUT_MS = 120000
const CONCURRENCY_TIMEOUT_MS = 180000
const GUARD_NAME = 'jesha_db'

// LIMPIEZA_HISTORICA_TRAZABILIDAD_PARCIAL
// Bases eliminadas manualmente en sesiones previas (27/07/2026):
//   jesha_p0_seed_test_g_1785253353082_18172
//   jesha_p0_seed_test_f_1785196711561_7608
// No hay trazabilidad forense completa. createdDatabases es la única
// autoridad de propiedad a partir de esta implementación.

const INITIAL_DBS = new Set()

// ════════════════════════════════════════════════════════════════════
//  Configuración PostgreSQL por variables de entorno
// ════════════════════════════════════════════════════════════════════
function resolverPgTestConfig(env = process.env) {
  const user = typeof env.P0_TEST_PG_USER === 'string'
    ? env.P0_TEST_PG_USER.trim()
    : ''
  const password = typeof env.P0_TEST_PG_PASSWORD === 'string'
    ? env.P0_TEST_PG_PASSWORD
    : ''
  const hostRaw = typeof env.P0_TEST_PG_HOST === 'string'
    ? env.P0_TEST_PG_HOST.trim().toLowerCase()
    : ''
  const portRaw = typeof env.P0_TEST_PG_PORT === 'string'
    ? env.P0_TEST_PG_PORT.trim()
    : ''

  if (!user || !password || !hostRaw || !portRaw) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_PG_CONFIG_INVALID',
      'Configuración PostgreSQL de pruebas incompleta'
    )
  }

  const host = hostRaw === '[::1]' ? '::1' : hostRaw
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1'])
  if (!allowedHosts.has(host)) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_REMOTE_HOST_BLOCKED',
      'El host PostgreSQL de pruebas debe ser local'
    )
  }

  if (!/^\d+$/.test(portRaw)) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_PG_CONFIG_INVALID',
      'El puerto PostgreSQL de pruebas es inválido'
    )
  }

  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_PG_CONFIG_INVALID',
      'El puerto PostgreSQL de pruebas está fuera de rango'
    )
  }

  return Object.freeze({ user, password, host, port })
}

// ════════════════════════════════════════════════════════════════════
//  Registro central de recursos
// ════════════════════════════════════════════════════════════════════
const poolRegistry = new Map()
const childRegistry = new Map()
const createdDatabases = new Set()
const dbsBeingCleaned = new Set()
const cleanupPromises = new Map()
const unexpectedPoolErrors = []
const cleanupFailures = []

// ════════════════════════════════════════════════════════════════════
//  Helpers de validación y seguridad
// ════════════════════════════════════════════════════════════════════

function validarNombreBaseTemporal(dbName) {
  if (typeof dbName !== 'string') {
    throw new SeedHarnessError('P0_SEED_TEST_DB_NAME_INVALID',
      'dbName no es string')
  }
  if (!dbName.startsWith(TEST_DB_PREFIX)) {
    throw new SeedHarnessError('P0_SEED_TEST_DB_NAME_INVALID',
      `Prefijo inválido: ${safeDbName(dbName)}`)
  }
  if (dbName.length === TEST_DB_PREFIX.length) {
    throw new SeedHarnessError('P0_SEED_TEST_DB_NAME_INVALID',
      'Nombre sin sufijo después del prefijo')
  }
  if (!TEST_DB_NAME_RE.test(dbName)) {
    throw new SeedHarnessError('P0_SEED_TEST_DB_NAME_INVALID',
      `Formato inválido: ${safeDbName(dbName)}`)
  }
  if (FORBIDDEN_DB_NAMES.has(dbName)) {
    throw new SeedHarnessError('P0_SEED_TEST_DB_NAME_INVALID',
      `Nombre prohibido: ${safeDbName(dbName)}`)
  }
  return dbName
}

function quoteIdentifier(identifier) {
  const valid = validarNombreBaseTemporal(identifier)
  return `"${valid.replace(/"/g, '""')}"`
}

function validarNombreConexion(dbName, { allowGuard = false, allowAdmin = false } = {}) {
  if (allowAdmin && dbName === PG_ADMIN_DB) return dbName
  if (allowGuard && dbName === GUARD_NAME) return dbName
  return validarNombreBaseTemporal(dbName)
}

function dbUrl(
  dbName,
  {
    env = process.env,
    allowGuard = false,
    allowAdmin = false
  } = {}
) {
  const validName = validarNombreConexion(dbName, { allowGuard, allowAdmin })
  const cfg = resolverPgTestConfig(env)
  const host = cfg.host === '::1' ? '[::1]' : cfg.host
  const user = encodeURIComponent(cfg.user)
  const password = encodeURIComponent(cfg.password)
  const database = encodeURIComponent(validName)

  return `postgresql://${user}:${password}@${host}:${cfg.port}/${database}`
}

function crearNombreBaseTemporal(escenario) {
  if (typeof escenario !== 'string' || !/^[a-zA-Z0-9_]+$/.test(escenario)) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_DB_NAME_INVALID',
      'El identificador del escenario es inválido'
    )
  }

  return validarNombreBaseTemporal(
    `${TEST_DB_PREFIX}${escenario}_${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`
  )
}

function randomPassword() {
  return randomBytes(16).toString('hex')
}

function lineSet(text) {
  return new Set(text.split('\n').map(l => l.trim()).filter(Boolean))
}

function isTerminationError(err) {
  const msg = (err && err.message) || ''
  const code = (err && err.code) || ''
  if (code === '57P01' || code === '57P02' || code === '57P03') return true
  if (msg.includes('terminating connection due to administrator command')) return true
  if (msg.includes('terminando la conexión debido a una orden del administrador')) return true
  return false
}

function safeDbName(dbName) {
  if (typeof dbName !== 'string' || dbName.length === 0) return '<<empty>>'
  return dbName.length > 40 ? dbName.slice(0, 20) + '…' + dbName.slice(-18) : dbName
}

function sanitizeErrorMessage(error) {
  if (!error || typeof error.message !== 'string') return 'Error sin detalle'
  return error.message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL_REDACTED]')
    .slice(0, 300)
}

async function waitWithTimeout(promise, timeoutMs, errorFactory) {
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(errorFactory()), timeoutMs)
      })
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

function assertPoolCountersZero(pool) {
  const counters = {
    totalCount: typeof pool.totalCount === 'number' ? pool.totalCount : 0,
    idleCount: typeof pool.idleCount === 'number' ? pool.idleCount : 0,
    waitingCount: typeof pool.waitingCount === 'number' ? pool.waitingCount : 0
  }

  if (counters.totalCount > 0 || counters.idleCount > 0 || counters.waitingCount > 0) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_POOL_LEAK',
      `Pool con recursos residuales: total=${counters.totalCount}, idle=${counters.idleCount}, waiting=${counters.waitingCount}`
    )
  }
}

// ════════════════════════════════════════════════════════════════════
//  closePoolTracked — cierre con timeout y verificación de contadores
// ════════════════════════════════════════════════════════════════════
function normalizePoolCloseError(error) {
  if (error instanceof SeedHarnessError) return error
  return new SeedHarnessError(
    'P0_SEED_TEST_POOL_CLOSE_FAILED',
    sanitizeErrorMessage(error)
  )
}

async function closePoolTracked(pool, info, timeoutMs = 5000) {
  if (info.closed) return
  if (info.closeError) throw info.closeError
  if (info.closePromise) return info.closePromise

  if (!info.endPromise) {
    info.endPromise = new Promise((resolve, reject) => {
      pool.end((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  info.closePromise = (async () => {
    try {
      await waitWithTimeout(
        info.endPromise,
        timeoutMs,
        () => new SeedHarnessError(
          'P0_SEED_TEST_POOL_CLOSE_TIMEOUT',
          `pool.end() no resolvió en ${timeoutMs}ms`
        )
      )
      assertPoolCountersZero(pool)
      info.closed = true
      info.closeError = null
    } catch (error) {
      const normalized = normalizePoolCloseError(error)
      info.closed = false
      info.closeError = normalized
      throw normalized
    }
  })()

  return info.closePromise
}

async function waitForEndPromise(pool, info, timeoutMs = 3000) {
  if (!info.endPromise) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_POOL_CLOSE_FAILED',
      'No existe promesa de cierre del pool'
    )
  }

  try {
    await waitWithTimeout(
      info.endPromise,
      timeoutMs,
      () => new SeedHarnessError(
        'P0_SEED_TEST_POOL_CLOSE_TIMEOUT',
        `El pool no terminó después de la terminación defensiva en ${timeoutMs}ms`
      )
    )
    assertPoolCountersZero(pool)
    info.closed = true
    info.closeError = null
    info.closePromise = Promise.resolve()
  } catch (error) {
    const normalized = normalizePoolCloseError(error)
    info.closed = false
    info.closeError = normalized
    throw normalized
  }
}

// ════════════════════════════════════════════════════════════════════
//  terminateChildTracked — terminar child con SIGTERM + SIGKILL
// ════════════════════════════════════════════════════════════════════
function ensureChildClosePromise(child, info) {
  if (info.closePromise) return info.closePromise

  info.closePromise = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      resolve({ type: 'close', code, signal })
    })
    child.once('error', (error) => {
      resolve({ type: 'error', error })
    })
  })

  return info.closePromise
}

async function terminateChildTracked(
  child,
  info,
  { termTimeoutMs = 3000, killTimeoutMs = 3000 } = {}
) {
  if (child.exitCode !== null) {
    childRegistry.delete(child)
    return
  }

  const closePromise = ensureChildClosePromise(child, info)

  try {
    child.kill('SIGTERM')
  } catch (_) {
    // Continúa a esperar el evento close; el proceso podría haber terminado.
  }

  try {
    await waitWithTimeout(
      closePromise,
      termTimeoutMs,
      () => new SeedHarnessError(
        'P0_SEED_CHILD_TIMEOUT',
        `Child ${child.pid || 'desconocido'} no cerró tras SIGTERM`
      )
    )
    childRegistry.delete(child)
    return
  } catch (error) {
    if (!(error instanceof SeedHarnessError) || error.code !== 'P0_SEED_CHILD_TIMEOUT') {
      throw error
    }
  }

  try {
    child.kill('SIGKILL')
  } catch (_) {
    // Continúa a esperar close.
  }

  try {
    await waitWithTimeout(
      closePromise,
      killTimeoutMs,
      () => new SeedHarnessError(
        'P0_SEED_CHILD_TIMEOUT',
        `Child ${child.pid || 'desconocido'} no cerró tras SIGTERM+SIGKILL`
      )
    )
    childRegistry.delete(child)
  } catch (error) {
    info.timedOut = true
    throw error
  }
}

// ════════════════════════════════════════════════════════════════════
//  assertNoUnexpectedPoolErrors
// ════════════════════════════════════════════════════════════════════
function assertNoUnexpectedPoolErrors(stage) {
  if (unexpectedPoolErrors.length === 0) return
  throw new SeedHarnessError('P0_SEED_TEST_UNEXPECTED_POOL_ERROR',
    `Errores inesperados de pool en ${stage} (${unexpectedPoolErrors.length})`)
}

// ════════════════════════════════════════════════════════════════════
//  Pool administrativo único (postgres)
// ════════════════════════════════════════════════════════════════════
let _adminPool = null
let _adminPoolInfo = null

function adminPool() {
  if (!_adminPool) {
    const handler = (err) => {
      unexpectedPoolErrors.push({
        db: PG_ADMIN_DB,
        message: sanitizeErrorMessage(err),
        code: err && err.code ? err.code : null
      })
    }

    _adminPool = new pg.Pool({
      connectionString: dbUrl(PG_ADMIN_DB, { allowAdmin: true }),
      max: 2
    })
    _adminPool.on('error', handler)
    _adminPoolInfo = {
      dbName: PG_ADMIN_DB,
      client: null,
      handler,
      closePromise: null,
      endPromise: null,
      closeError: null,
      closed: false
    }
  }
  return _adminPool
}

async function closeAdminPool(timeoutMs = 5000) {
  if (!_adminPool) return

  assertNoUnexpectedPoolErrors('antes de cerrar admin pool')
  await closePoolTracked(_adminPool, _adminPoolInfo, timeoutMs)
  assertNoUnexpectedPoolErrors('después de cerrar admin pool')

  _adminPool.removeListener('error', _adminPoolInfo.handler)
  _adminPool = null
  _adminPoolInfo = null
}

// ════════════════════════════════════════════════════════════════════
//  prismaFor — crear pool+cliente con error handler controlado
// ════════════════════════════════════════════════════════════════════
function prismaFor(dbName) {
  const pool = new pg.Pool({ connectionString: dbUrl(dbName), max: 1 })
  const handler = (err) => {
    if (!dbsBeingCleaned.has(dbName) || !isTerminationError(err)) {
      unexpectedPoolErrors.push({
        db: safeDbName(dbName),
        message: sanitizeErrorMessage(err),
        code: err && err.code ? err.code : null
      })
    }
  }
  pool.on('error', handler)
  const adapter = new PrismaPg(pool)
  const client = new PrismaClient({ adapter })
  poolRegistry.set(pool, {
    dbName,
    client,
    handler,
    closePromise: null,
    endPromise: null,
    closeError: null,
    closed: false
  })
  return { client, pool }
}

// ════════════════════════════════════════════════════════════════════
//  pgExec / pgExecParams — query vía adminPool
// ════════════════════════════════════════════════════════════════════
async function pgExec(sql) {
  const p = adminPool()
  await p.query(sql)
}

async function pgExecParams(sql, params) {
  const p = adminPool()
  await p.query(sql, params)
}

// ════════════════════════════════════════════════════════════════════
//  createDB
// ════════════════════════════════════════════════════════════════════
async function createDB(dbName) {
  validarNombreBaseTemporal(dbName)
  if (createdDatabases.has(dbName)) return
  await pgExec(`CREATE DATABASE ${quoteIdentifier(dbName)}`)
  createdDatabases.add(dbName)
}

// ════════════════════════════════════════════════════════════════════
//  dbPush
// ════════════════════════════════════════════════════════════════════
async function dbPush(dbName) {
  validarNombreBaseTemporal(dbName)
  const env = { ...process.env, DATABASE_URL: dbUrl(dbName) }

  if (process.platform === 'win32') {
    const cmd = process.env.ComSpec || 'cmd.exe'
    execFileSync(
      cmd,
      ['/d', '/s', '/c', 'npx prisma db push --schema prisma/schema.prisma'],
      {
        cwd: BACKEND_DIR,
        env,
        stdio: 'pipe',
        timeout: 60000
      }
    )
  } else {
    execFileSync(
      'npx',
      ['prisma', 'db', 'push', '--schema', 'prisma/schema.prisma'],
      {
        cwd: BACKEND_DIR,
        env,
        stdio: 'pipe',
        timeout: 60000
      }
    )
  }
}

// ════════════════════════════════════════════════════════════════════
//  runSeed — spawn con timeout y tracking
// ════════════════════════════════════════════════════════════════════
async function runSeed(
  dbName,
  passwords,
  timeoutMs = SEED_CHILD_TIMEOUT_MS,
  { allowGuard = false } = {}
) {
  const env = {
    ...process.env,
    DATABASE_URL: dbUrl(dbName, { allowGuard }),
    SEED_TARGET: 'test',
    P0_SEED_CONFIRMATION: 'SEED_JESHA_ISOLATED_TEST_ONLY',
    SEED_SUPERADMIN_PASSWORD: passwords.sa,
    SEED_ADMIN_PASSWORD: passwords.adm,
    SEED_EMPLEADO_PASSWORD: passwords.emp
  }
  delete env.LOCAL_SEED_CONFIRMATION

  const child = spawn(process.execPath, ['prisma/seed.js'], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', d => { stdout += d })
  child.stderr.on('data', d => { stderr += d })

  const childInfo = {
    dbName,
    closePromise: null,
    timedOut: false
  }
  childRegistry.set(child, childInfo)
  const closePromise = ensureChildClosePromise(child, childInfo)

  let outcome
  try {
    outcome = await waitWithTimeout(
      closePromise,
      timeoutMs,
      () => new SeedHarnessError(
        'P0_SEED_CHILD_TIMEOUT',
        `El seed excedió ${timeoutMs}ms`
      )
    )
  } catch (error) {
    if (!(error instanceof SeedHarnessError) || error.code !== 'P0_SEED_CHILD_TIMEOUT') {
      childRegistry.delete(child)
      throw error
    }

    childInfo.timedOut = true
    await terminateChildTracked(child, childInfo, {
      termTimeoutMs: 3000,
      killTimeoutMs: 3000
    })
    outcome = await closePromise
  }

  childRegistry.delete(child)

  if (outcome.type === 'error') {
    return {
      code: -1,
      stdout,
      stderr: 'spawn error',
      ...(childInfo.timedOut ? { timedOut: true } : {})
    }
  }

  return {
    code: outcome.code != null ? outcome.code : 1,
    stdout,
    stderr,
    ...(childInfo.timedOut ? { timedOut: true } : {})
  }
}

// ════════════════════════════════════════════════════════════════════
//  runSeedForGuard — lanza seed apuntando a un nombre cualquiera
// ════════════════════════════════════════════════════════════════════
function runSeedForGuard(dbName) {
  return runSeed(
    dbName,
    { sa: 'x'.repeat(8), adm: 'x'.repeat(8), emp: 'x'.repeat(8) },
    30000,
    { allowGuard: true }
  )
}

// ════════════════════════════════════════════════════════════════════
//  cleanupDB — cierre ordenado de recursos + drop
// ════════════════════════════════════════════════════════════════════
async function cleanupDB(dbName) {
  const validName = validarNombreBaseTemporal(dbName)

  if (!createdDatabases.has(validName)) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_DB_NOT_OWNED',
      `La base ${safeDbName(validName)} no fue creada por esta ejecución`
    )
  }

  if (cleanupPromises.has(validName)) {
    return cleanupPromises.get(validName)
  }

  const promise = _cleanupDB(validName)
  cleanupPromises.set(validName, promise)
  try {
    return await promise
  } finally {
    cleanupPromises.delete(validName)
  }
}

async function _cleanupDB(validName) {
  dbsBeingCleaned.add(validName)
  const localFailures = []
  const poolsPendientes = []

  const addFailure = (code, stage, error) => {
    localFailures.push({
      code,
      stage,
      db: safeDbName(validName),
      message: sanitizeErrorMessage(error)
    })
  }

  try {
    // 1. Terminar y esperar children de esta BD.
    for (const [child, info] of [...childRegistry.entries()]) {
      if (info.dbName !== validName) continue
      try {
        await terminateChildTracked(child, info)
      } catch (error) {
        addFailure('P0_SEED_CHILD_TIMEOUT', 'child_termination', error)
      }
    }

    // 2. Desconectar PrismaClient y cerrar pools propios.
    const poolEntries = [...poolRegistry.entries()]
      .filter(([, info]) => info.dbName === validName)

    for (const [pool, info] of poolEntries) {
      try {
        await info.client.$disconnect()
      } catch (error) {
        addFailure('P0_SEED_TEST_POOL_CLOSE_FAILED', 'prisma_disconnect', error)
      }

      try {
        await closePoolTracked(pool, info)
        pool.removeListener('error', info.handler)
        poolRegistry.delete(pool)
      } catch (error) {
        addFailure(
          error instanceof SeedHarnessError
            ? error.code
            : 'P0_SEED_TEST_POOL_CLOSE_FAILED',
          'pool_close',
          error
        )
        poolsPendientes.push([pool, info])
      }
    }

    // 3. Terminar backends residuales como última defensa.
    const p = adminPool()
    await p.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [validName]
    )

    // 4. Confirmar cierre real de pools que fallaron inicialmente.
    for (const [pool, info] of poolsPendientes) {
      try {
        await waitForEndPromise(pool, info, 3000)
        pool.removeListener('error', info.handler)
        poolRegistry.delete(pool)
      } catch (error) {
        addFailure(
          error instanceof SeedHarnessError
            ? error.code
            : 'P0_SEED_TEST_POOL_CLOSE_FAILED',
          'pool_close_after_terminate',
          error
        )
      }
    }

    // 5. DROP DATABASE con identificador ya validado.
    await p.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(validName)}`)

    // 6. Verificar eliminación.
    const { rows } = await p.query(
      'SELECT 1 FROM pg_database WHERE datname=$1',
      [validName]
    )

    if (rows.length === 0) {
      createdDatabases.delete(validName)
    } else {
      addFailure(
        'P0_SEED_TEST_CLEANUP_FAILED',
        'verify_drop',
        new Error('La base aún existe tras DROP DATABASE')
      )
    }

    // 7. Un error de pool inesperado invalida el cleanup.
    try {
      assertNoUnexpectedPoolErrors(`cleanupDB(${safeDbName(validName)})`)
    } catch (error) {
      addFailure('P0_SEED_TEST_UNEXPECTED_POOL_ERROR', 'pool_errors', error)
    }
  } catch (error) {
    addFailure(
      error instanceof SeedHarnessError
        ? error.code
        : 'P0_SEED_TEST_CLEANUP_FAILED',
      'cleanupDB',
      error
    )
  } finally {
    dbsBeingCleaned.delete(validName)
  }

  // No vaciar registros artificialmente: cualquier recurso que continúe
  // registrado se conserva como evidencia y hace fallar el Gate.
  const remainingPools = [...poolRegistry.values()]
    .filter(info => info.dbName === validName)
  const remainingChildren = [...childRegistry.values()]
    .filter(info => info.dbName === validName)

  if (remainingPools.length > 0) {
    addFailure(
      'P0_SEED_TEST_POOL_LEAK',
      'pool_registry',
      new Error(`${remainingPools.length} pool(es) continúan registrados`)
    )
  }
  if (remainingChildren.length > 0) {
    addFailure(
      'P0_SEED_CHILD_TIMEOUT',
      'child_registry',
      new Error(`${remainingChildren.length} child(ren) continúan registrados`)
    )
  }

  for (const failure of localFailures) cleanupFailures.push(failure)

  if (localFailures.length > 0) {
    throw new SeedHarnessError(
      'P0_SEED_TEST_CLEANUP_FAILED',
      `Limpieza de ${safeDbName(validName)}: ${localFailures.length} fallo(s)`
    )
  }
}

// ════════════════════════════════════════════════════════════════════
//  report — diagnóstico sin secretos
// ════════════════════════════════════════════════════════════════════
function report(scenarioName) {
  const pools = [...poolRegistry.entries()].map(([pool, info]) => ({
    db: safeDbName(info.dbName),
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  }))
  const children = [...childRegistry.entries()].map(([child, info]) => ({
    pid: child.pid,
    db: safeDbName(info.dbName)
  }))
  return {
    scenario: scenarioName,
    pools,
    children,
    createdDbs: [...createdDatabases].map(safeDbName)
  }
}

// ════════════════════════════════════════════════════════════════════
//  Pruebas puras del harness (sin PostgreSQL)
// ════════════════════════════════════════════════════════════════════
describe('P0-SEED Harness puro', { concurrency: 1 }, () => {
  const validEnv = Object.freeze({
    P0_TEST_PG_USER: 'postgres',
    P0_TEST_PG_PASSWORD: 'test-only-password',
    P0_TEST_PG_HOST: 'localhost',
    P0_TEST_PG_PORT: '5432'
  })

  // --- resolverPgTestConfig ---
  it('resolverPgTestConfig acepta configuración local estricta', () => {
    assert.deepStrictEqual(
      resolverPgTestConfig(validEnv),
      { user: 'postgres', password: 'test-only-password', host: 'localhost', port: 5432 }
    )
  })

  it('resolverPgTestConfig no conserva cache entre env distintos', () => {
    const a = resolverPgTestConfig(validEnv)
    const b = resolverPgTestConfig({ ...validEnv, P0_TEST_PG_PORT: '5433' })
    assert.strictEqual(a.port, 5432)
    assert.strictEqual(b.port, 5433)
  })

  it('resolverPgTestConfig rechaza configuración incompleta', () => {
    assert.throws(
      () => resolverPgTestConfig({}),
      err => err instanceof SeedHarnessError && err.code === 'P0_SEED_TEST_PG_CONFIG_INVALID'
    )
  })

  it('resolverPgTestConfig rechaza host remoto', () => {
    assert.throws(
      () => resolverPgTestConfig({ ...validEnv, P0_TEST_PG_HOST: 'db.example.com' }),
      err => err instanceof SeedHarnessError && err.code === 'P0_SEED_TEST_REMOTE_HOST_BLOCKED'
    )
  })

  for (const invalidPort of ['5432abc', '12.5', '0', '65536', '-1', '0x1538', ' ']) {
    it(`resolverPgTestConfig rechaza puerto ${JSON.stringify(invalidPort)}`, () => {
      assert.throws(
        () => resolverPgTestConfig({ ...validEnv, P0_TEST_PG_PORT: invalidPort }),
        err => err instanceof SeedHarnessError && err.code === 'P0_SEED_TEST_PG_CONFIG_INVALID'
      )
    })
  }

  // --- validarNombreBaseTemporal / quoteIdentifier ---
  it('validarNombreBaseTemporal acepta nombre válido', () => {
    const name = 'jesha_p0_seed_test_a_123_456'
    assert.strictEqual(validarNombreBaseTemporal(name), name)
  })

  for (const invalidName of [
    'jesha_db',
    'postgres',
    'template0',
    'template1',
    'jesha_p0_seed_test_',
    'jesha_p0_seed_test_a b',
    'jesha_p0_seed_test_a-b',
    'jesha_p0_seed_test_a"b',
    'jesha_p0_seed_test_x";DROP DATABASE postgres;--'
  ]) {
    it(`validarNombreBaseTemporal rechaza ${JSON.stringify(invalidName)}`, () => {
      assert.throws(() => validarNombreBaseTemporal(invalidName), SeedHarnessError)
    })
  }

  it('quoteIdentifier produce identificador validado', () => {
    assert.strictEqual(
      quoteIdentifier('jesha_p0_seed_test_a_1'),
      '"jesha_p0_seed_test_a_1"'
    )
  })

  it('quoteIdentifier rechaza nombre inválido antes de SQL', () => {
    assert.throws(() => quoteIdentifier('jesha_db'), SeedHarnessError)
  })

  // --- URL y nombres aleatorios ---
  it('dbUrl codifica usuario y password', () => {
    const url = dbUrl('jesha_p0_seed_test_url_1', {
      env: {
        P0_TEST_PG_USER: 'u@s',
        P0_TEST_PG_PASSWORD: 'p:/@#',
        P0_TEST_PG_HOST: '127.0.0.1',
        P0_TEST_PG_PORT: '5432'
      }
    })
    assert.strictEqual(
      url,
      'postgresql://u%40s:p%3A%2F%40%23@127.0.0.1:5432/jesha_p0_seed_test_url_1'
    )
  })

  it('dbUrl encierra IPv6 local entre corchetes', () => {
    const url = dbUrl('jesha_p0_seed_test_ipv6_1', {
      env: { ...validEnv, P0_TEST_PG_HOST: '::1' }
    })
    assert.ok(url.includes('@[::1]:5432/'))
  })

  it('dbUrl solo permite jesha_db con allowGuard', () => {
    assert.throws(() => dbUrl('jesha_db', { env: validEnv }), SeedHarnessError)
    const url = dbUrl('jesha_db', { env: validEnv, allowGuard: true })
    assert.ok(url.endsWith('/jesha_db'))
  })

  it('crearNombreBaseTemporal genera nombres válidos, únicos y aleatorios', () => {
    const a = crearNombreBaseTemporal('pure')
    const b = crearNombreBaseTemporal('pure')
    assert.ok(TEST_DB_NAME_RE.test(a))
    assert.ok(TEST_DB_NAME_RE.test(b))
    assert.notStrictEqual(a, b)
    assert.match(a, /_[0-9a-f]{8}$/)
  })

  // --- closePoolTracked con pools falsos ---
  function makeInfo() {
    return {
      closePromise: null,
      endPromise: null,
      closeError: null,
      closed: false
    }
  }

  it('closePoolTracked cierra una vez y verifica contadores cero', async () => {
    let endCalls = 0
    const pool = {
      end(cb) { endCalls++; cb() },
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0
    }
    const info = makeInfo()
    await closePoolTracked(pool, info, 1000)
    await closePoolTracked(pool, info, 1000)
    assert.strictEqual(endCalls, 1)
    assert.strictEqual(info.closed, true)
    assert.strictEqual(info.closeError, null)
  })

  it('closePoolTracked normaliza rechazo y persiste el mismo error', async () => {
    const pool = {
      end(cb) { cb(new Error('fake error')) },
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0
    }
    const info = makeInfo()
    let first
    await assert.rejects(
      () => closePoolTracked(pool, info, 1000),
      err => {
        first = err
        return err.code === 'P0_SEED_TEST_POOL_CLOSE_FAILED'
      }
    )
    await assert.rejects(
      () => closePoolTracked(pool, info, 1000),
      err => err === first
    )
    assert.strictEqual(info.closed, false)
  })

  it('closePoolTracked timeout no marca closed y limpia su temporizador', async () => {
    const pool = {
      end(_cb) {},
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0
    }
    const info = makeInfo()
    const started = Date.now()
    await assert.rejects(
      () => closePoolTracked(pool, info, 30),
      err => err.code === 'P0_SEED_TEST_POOL_CLOSE_TIMEOUT'
    )
    assert.strictEqual(info.closed, false)
    assert.ok(Date.now() - started < 500)
  })

  for (const counter of ['totalCount', 'idleCount', 'waitingCount']) {
    it(`closePoolTracked no marca closed si ${counter}>0`, async () => {
      const pool = {
        end(cb) { cb() },
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        [counter]: 1
      }
      const info = makeInfo()
      await assert.rejects(
        () => closePoolTracked(pool, info, 1000),
        err => err.code === 'P0_SEED_TEST_POOL_LEAK'
      )
      assert.strictEqual(info.closed, false)
      assert.strictEqual(info.closeError.code, 'P0_SEED_TEST_POOL_LEAK')
    })
  }

  it('waitForEndPromise recupera un timeout solo tras resolución real', async () => {
    let finishEnd
    const pool = {
      end(cb) { finishEnd = cb },
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0
    }
    const info = makeInfo()

    await assert.rejects(
      () => closePoolTracked(pool, info, 20),
      err => err.code === 'P0_SEED_TEST_POOL_CLOSE_TIMEOUT'
    )
    assert.strictEqual(info.closed, false)

    finishEnd()
    await waitForEndPromise(pool, info, 1000)
    assert.strictEqual(info.closed, true)
    assert.strictEqual(info.closeError, null)
  })

  it('waitForEndPromise timeout no convierte espera en éxito', async () => {
    const info = makeInfo()
    info.endPromise = new Promise(() => {})
    const pool = { totalCount: 0, idleCount: 0, waitingCount: 0 }
    await assert.rejects(
      () => waitForEndPromise(pool, info, 20),
      err => err.code === 'P0_SEED_TEST_POOL_CLOSE_TIMEOUT'
    )
    assert.strictEqual(info.closed, false)
  })

  // --- children falsos ---
  it('terminateChildTracked elimina registro solo después de close real', async () => {
    const child = new EventEmitter()
    child.exitCode = null
    child.pid = 111
    child.kill = () => {
      process.nextTick(() => {
        child.exitCode = 0
        child.emit('close', 0, null)
      })
      return true
    }
    const info = { dbName: 'jesha_p0_seed_test_fake_1', closePromise: null, timedOut: false }
    childRegistry.set(child, info)
    await terminateChildTracked(child, info, { termTimeoutMs: 100, killTimeoutMs: 100 })
    assert.strictEqual(childRegistry.has(child), false)
  })

  it('terminateChildTracked conserva evidencia si nunca llega close', async () => {
    const child = new EventEmitter()
    child.exitCode = null
    child.pid = 222
    child.kill = () => true
    const info = { dbName: 'jesha_p0_seed_test_fake_2', closePromise: null, timedOut: false }
    childRegistry.set(child, info)
    try {
      await assert.rejects(
        () => terminateChildTracked(child, info, { termTimeoutMs: 10, killTimeoutMs: 10 }),
        err => err.code === 'P0_SEED_CHILD_TIMEOUT'
      )
      assert.strictEqual(childRegistry.has(child), true)
    } finally {
      childRegistry.delete(child)
    }
  })

  // --- prevalidación cleanup sin PostgreSQL ---
  it('cleanupDB rechaza jesha_db antes de abrir admin pool', async () => {
    assert.strictEqual(_adminPool, null)
    await assert.rejects(
      () => cleanupDB('jesha_db'),
      err => err.code === 'P0_SEED_TEST_DB_NAME_INVALID'
    )
    assert.strictEqual(_adminPool, null)
  })

  it('cleanupDB rechaza base válida no propia antes de abrir admin pool', async () => {
    assert.strictEqual(_adminPool, null)
    await assert.rejects(
      () => cleanupDB('jesha_p0_seed_test_not_owned_1'),
      err => err.code === 'P0_SEED_TEST_DB_NOT_OWNED'
    )
    assert.strictEqual(_adminPool, null)
  })

  // --- errores inesperados ---
  it('assertNoUnexpectedPoolErrors sin errores no lanza', () => {
    assert.strictEqual(unexpectedPoolErrors.length, 0)
    assertNoUnexpectedPoolErrors('test')
  })

  it('assertNoUnexpectedPoolErrors con errores lanza y conserva evidencia', () => {
    unexpectedPoolErrors.push({ db: 'test', message: 'test error', code: 'P0001' })
    try {
      assert.throws(
        () => assertNoUnexpectedPoolErrors('test'),
        err => err instanceof SeedHarnessError && err.code === 'P0_SEED_TEST_UNEXPECTED_POOL_ERROR'
      )
      assert.strictEqual(unexpectedPoolErrors.length, 1)
    } finally {
      unexpectedPoolErrors.pop()
    }
  })
})

// ════════════════════════════════════════════════════════════════════
//  Suite principal
// ════════════════════════════════════════════════════════════════════
describe('P0-SEED PostgreSQL', { concurrency: 1 }, () => {

  before(async () => {
    const p = adminPool()
    const { rows } = await p.query(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [TEST_DB_PREFIX + '%']
    )
    for (const r of rows) INITIAL_DBS.add(r.datname)
  })

  after(async () => {
    const finalFailures = []

    const addFinalFailure = (stage, db, error) => {
      finalFailures.push({
        stage,
        db: safeDbName(db),
        message: sanitizeErrorMessage(error)
      })
    }

    // 1. Limpiar todas las bases propias pendientes.
    for (const dbName of [...createdDatabases]) {
      try {
        await cleanupDB(dbName)
      } catch (error) {
        addFinalFailure('global_cleanup', dbName, error)
      }
    }

    // 2. Terminar children residuales sin borrar evidencia si fallan.
    for (const [child, info] of [...childRegistry.entries()]) {
      try {
        await terminateChildTracked(child, info, {
          termTimeoutMs: 2000,
          killTimeoutMs: 2000
        })
      } catch (error) {
        addFinalFailure('child_close', info.dbName, error)
      }
    }

    // 3. Cerrar pools residuales. Solo retirarlos si cerraron realmente.
    for (const [pool, info] of [...poolRegistry.entries()]) {
      try {
        await info.client.$disconnect()
      } catch (error) {
        addFinalFailure('prisma_disconnect', info.dbName, error)
      }

      try {
        if (info.endPromise && info.closeError) {
          await waitForEndPromise(pool, info, 3000)
        } else {
          await closePoolTracked(pool, info, 3000)
        }
        pool.removeListener('error', info.handler)
        poolRegistry.delete(pool)
      } catch (error) {
        addFinalFailure('pool_close', info.dbName, error)
      }
    }

    // 4. Comparar bases iniciales y finales. Nunca borrar bases no propias.
    let finalDbs = new Set()
    try {
      const p = adminPool()
      const { rows } = await p.query(
        'SELECT datname FROM pg_database WHERE datname LIKE $1',
        [TEST_DB_PREFIX + '%']
      )
      finalDbs = new Set(rows.map(row => row.datname))

      for (const db of finalDbs) {
        if (!INITIAL_DBS.has(db)) {
          addFinalFailure(
            'unowned_or_residual_db',
            db,
            new Error(createdDatabases.has(db)
              ? 'Base propia residual no eliminada'
              : 'Base no reconocida; no fue eliminada')
          )
        }
      }

      for (const db of INITIAL_DBS) {
        if (!finalDbs.has(db)) {
          addFinalFailure(
            'initial_db_missing',
            db,
            new Error('Una base inicial desapareció')
          )
        }
      }
    } catch (error) {
      addFinalFailure('final_database_inventory', PG_ADMIN_DB, error)
    }

    // 5. Verificar errores de pool antes de cerrar el admin pool.
    try {
      assertNoUnexpectedPoolErrors('antes de cerrar admin pool')
    } catch (error) {
      addFinalFailure('unexpected_pool_errors', PG_ADMIN_DB, error)
    }

    // 6. Cerrar admin pool y comprobar también errores durante su cierre.
    try {
      await closeAdminPool(5000)
    } catch (error) {
      addFinalFailure('admin_pool_close', PG_ADMIN_DB, error)
    }

    try {
      assertNoUnexpectedPoolErrors('después de cerrar admin pool')
    } catch (error) {
      addFinalFailure('unexpected_pool_errors_after_admin_close', PG_ADMIN_DB, error)
    }

    // 7. Comprobaciones finales sin clear() artificial.
    const registryChecks = [
      ['createdDatabases', createdDatabases.size],
      ['dbsBeingCleaned', dbsBeingCleaned.size],
      ['cleanupPromises', cleanupPromises.size],
      ['poolRegistry', poolRegistry.size],
      ['childRegistry', childRegistry.size]
    ]
    for (const [name, size] of registryChecks) {
      if (size !== 0) {
        addFinalFailure('registry', name, new Error(`${name}.size=${size}`))
      }
    }

    if (unexpectedPoolErrors.length !== 0) {
      addFinalFailure(
        'unexpected_pool_errors_final',
        'N/A',
        new Error(`${unexpectedPoolErrors.length} error(es) inesperado(s)`)
      )
    }
    if (cleanupFailures.length !== 0) {
      addFinalFailure(
        'cleanup_failures',
        'N/A',
        new Error(`${cleanupFailures.length} fallo(s) de limpieza`)
      )
    }
    if (_adminPool !== null || _adminPoolInfo !== null) {
      addFinalFailure(
        'admin_pool_registry',
        PG_ADMIN_DB,
        new Error('El admin pool no quedó cerrado y liberado')
      )
    }

    if (finalFailures.length > 0) {
      const details = finalFailures
        .map(f => `[${f.stage}] ${f.db}: ${f.message}`)
        .join(' | ')
      throw new Error(`FINALIZACION: ${finalFailures.length} fallo(s): ${details}`)
    }
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO A: Base vacía
  // ════════════════════════════════════════════════════════════════════
  describe('A: Base vacía', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('a')
    const passwords = { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() }
    let prisma

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      const rP = runSeed(DB, passwords)
      const { client } = prismaFor(DB)
      prisma = client
      globalThis.__seedResultA = await rP
    })

    after(async () => { await cleanupDB(DB) })

    it('exit 0 y SEED_COMPLETED', () => {
      const r = globalThis.__seedResultA
      assert.strictEqual(r.timedOut, undefined)
      assert.strictEqual(r.code, 0)
      const lines = lineSet(r.stdout)
      assert.ok(lines.has('SEED_GUARD_OK'))
      assert.ok(lines.has('TARGET_DATABASE_TEST'))
      assert.ok(lines.has('NUCLEO_EMPRESA_OK'))
      assert.ok(lines.has('NUCLEO_SUCURSAL_OK'))
      assert.ok(lines.has('NUCLEO_SUPERADMIN_OK'))
      assert.ok(lines.has('NUCLEO_ADMIN_SUCURSAL_OK'))
      assert.ok(lines.has('NUCLEO_EMPLEADO_OK'))
      assert.ok(lines.has('NUCLEO_VALIDATION_OK'))
      assert.ok(lines.has('DEMO_DATA_OK'))
      const trimmed = r.stdout.trim()
      assert.ok(trimmed.endsWith('SEED_COMPLETED'))
      assert.strictEqual(r.stderr.trim(), '')
    })

    it('empresa jesha activa', async () => {
      const e = await prisma.empresa.findUnique({ where: { slug: 'jesha' } })
      assert.ok(e)
      assert.strictEqual(e.activa, true)
    })

    it('sucursal matriz coherente', async () => {
      const e = await prisma.empresa.findUnique({ where: { slug: 'jesha' } })
      const s = await prisma.sucursal.findFirst({ where: { nombre: 'Ferretería JESHA - Matriz', empresaId: e.id } })
      assert.ok(s)
      assert.strictEqual(s.activa, true)
      assert.strictEqual(s.empresaId, e.id)
    })

    it('3 usuarios núcleo con identidad correcta', async () => {
      const e = await prisma.empresa.findUnique({ where: { slug: 'jesha' } })
      const s = await prisma.sucursal.findFirst({ where: { nombre: 'Ferretería JESHA - Matriz', empresaId: e.id } })
      const sa = await prisma.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'Gerardo_Manz' } } })
      const adm = await prisma.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'admin' } } })
      const emp = await prisma.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'empleado' } } })

      assert.ok(sa); assert.strictEqual(sa.rol, 'SUPERADMIN'); assert.strictEqual(sa.sucursalId, null); assert.strictEqual(sa.activo, true); assert.strictEqual(sa.empresaId, e.id)
      assert.ok(adm); assert.strictEqual(adm.rol, 'ADMIN_SUCURSAL'); assert.strictEqual(adm.sucursalId, s.id); assert.strictEqual(adm.activo, true)
      assert.ok(emp); assert.strictEqual(emp.rol, 'EMPLEADO'); assert.strictEqual(emp.sucursalId, s.id); assert.strictEqual(emp.activo, true)
    })

    it('bcrypt hashes coinciden con passwords aleatorias', async () => {
      const bcrypt = require('bcryptjs')
      const e = await prisma.empresa.findUnique({ where: { slug: 'jesha' } })
      const sa = await prisma.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'Gerardo_Manz' } } })
      const adm = await prisma.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'admin' } } })
      assert.ok(await bcrypt.compare(passwords.sa, sa.passwordHash))
      assert.ok(await bcrypt.compare(passwords.adm, adm.passwordHash))
      assert.ok(await bcrypt.compare(passwords.emp, (await prisma.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'empleado' } } })).passwordHash))
    })

    it('sin PLATFORM_ADMIN ni testemp', async () => {
      const pa = await prisma.usuario.count({ where: { rol: 'PLATFORM_ADMIN' } })
      assert.strictEqual(pa, 0)
      const te = await prisma.usuario.findFirst({ where: { username: { startsWith: 'testemp' } } })
      assert.strictEqual(te, null)
    })

    it('9 departamentos + 35 categorías globales', async () => {
      const depts = await prisma.departamento.count({ where: { esGlobal: true, empresaId: null } })
      assert.strictEqual(depts, 9)
      const cats = await prisma.categoria.count({ where: { esGlobal: true, empresaId: null } })
      assert.strictEqual(cats, 35)
    })

    it('3 clientes, 3 proveedores, 21 productos tenantizados', async () => {
      const e = await prisma.empresa.findUnique({ where: { slug: 'jesha' } })
      const s = await prisma.sucursal.findFirst({ where: { nombre: 'Ferretería JESHA - Matriz', empresaId: e.id } })
      assert.strictEqual(await prisma.cliente.count({ where: { empresaId: e.id } }), 3)
      assert.strictEqual(await prisma.proveedor.count({ where: { empresaId: e.id } }), 3)
      assert.strictEqual(await prisma.producto.count({ where: { empresaId: e.id } }), 21)
      const inv = await prisma.inventarioSucursal.count({ where: { sucursalId: s.id } })
      assert.strictEqual(inv, 21)
    })

    it('stock inicial = 50', async () => {
      const invs = await prisma.inventarioSucursal.findMany()
      for (const i of invs) assert.strictEqual(i.stockActual.toNumber(), 50)
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO B: Idempotencia
  // ════════════════════════════════════════════════════════════════════
  describe('B: Idempotencia', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('b')
    const pw1 = { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() }
    const pw2 = { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() }
    let snapshot

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      await runSeed(DB, pw1)
      const { client } = prismaFor(DB)
      const e = await client.empresa.findUnique({ where: { slug: 'jesha' } })
      const sa = await client.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'Gerardo_Manz' } } })
      const adm = await client.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'admin' } } })
      const emp = await client.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'empleado' } } })
      const invs = await client.inventarioSucursal.findMany()
      snapshot = {
        empresaId: e.id,
        saHash: sa.passwordHash, admHash: adm.passwordHash, empHash: emp.passwordHash,
        saId: sa.id, admId: adm.id, empId: emp.id,
        stocks: invs.map(i => ({ pid: i.productoId, stock: i.stockActual.toNumber() })),
        totalUsuarios: await client.usuario.count(),
        totalClientes: await client.cliente.count(),
        totalProveedores: await client.proveedor.count(),
        totalProductos: await client.producto.count()
      }
      await client.$disconnect()
      globalThis.__seedB_result2 = await runSeed(DB, pw2)
    })

    after(async () => { await cleanupDB(DB) })

    it('exit 0 y SEED_COMPLETED en 2a ejecución', () => {
      const r = globalThis.__seedB_result2
      assert.strictEqual(r.timedOut, undefined)
      assert.strictEqual(r.code, 0)
      assert.ok(r.stdout.trim().endsWith('SEED_COMPLETED'))
    })

    it('counts sin cambios', async () => {
      const { client } = prismaFor(DB)
      const e = await client.empresa.findUnique({ where: { slug: 'jesha' } })
      assert.strictEqual(await client.usuario.count({ where: { empresaId: e.id } }), snapshot.totalUsuarios)
      assert.strictEqual(await client.proveedor.count(), snapshot.totalProveedores)
      assert.strictEqual(await client.producto.count(), snapshot.totalProductos)
      await client.$disconnect()
    })

    it('passwordHash sin cambios, pw original funciona, pw nueva no', async () => {
      const bcrypt = require('bcryptjs')
      const { client } = prismaFor(DB)
      const e = await client.empresa.findUnique({ where: { slug: 'jesha' } })
      const sa = await client.usuario.findUnique({ where: { empresaId_username: { empresaId: e.id, username: 'Gerardo_Manz' } } })
      assert.strictEqual(sa.passwordHash, snapshot.saHash)
      assert.ok(await bcrypt.compare(pw1.sa, sa.passwordHash))
      assert.ok(!await bcrypt.compare(pw2.sa, sa.passwordHash))
      await client.$disconnect()
    })

    it('stock sin cambios', async () => {
      const { client } = prismaFor(DB)
      const invs = await client.inventarioSucursal.findMany()
      for (const i of invs) {
        const orig = snapshot.stocks.find(s => s.pid === i.productoId)
        assert.ok(orig)
        assert.strictEqual(i.stockActual.toNumber(), orig.stock)
      }
      await client.$disconnect()
    })

    it('IDs sin cambios', async () => {
      const { client } = prismaFor(DB)
      const sa = await client.usuario.findUnique({ where: { id: snapshot.saId } })
      assert.ok(sa); assert.strictEqual(sa.username, 'Gerardo_Manz')
      await client.$disconnect()
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO C: Concurrencia
  // ════════════════════════════════════════════════════════════════════
  describe('C: Concurrencia', { concurrency: 1, timeout: CONCURRENCY_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('c')
    const pw = { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() }

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      const [r1, r2] = await Promise.all([runSeed(DB, pw), runSeed(DB, pw)])
      globalThis.__seedC_results = [r1, r2]
    })

    after(async () => { await cleanupDB(DB) })

    it('ambos exit 0 con SEED_COMPLETED', () => {
      for (const r of globalThis.__seedC_results) {
        assert.strictEqual(r.timedOut, undefined)
        assert.strictEqual(r.code, 0)
        assert.ok(r.stdout.includes('SEED_COMPLETED'))
      }
    })

    it('exactamente 1 empresa, 1 sucursal, 3 usuarios', async () => {
      const { client } = prismaFor(DB)
      assert.strictEqual(await client.empresa.count(), 1)
      assert.strictEqual(await client.sucursal.count(), 1)
      const e = await client.empresa.findFirst()
      assert.strictEqual(await client.usuario.count({ where: { empresaId: e.id } }), 3)
      assert.strictEqual(await client.cliente.count(), 3)
      assert.strictEqual(await client.proveedor.count(), 3)
      assert.strictEqual(await client.producto.count(), 21)
      assert.strictEqual(await client.inventarioSucursal.count(), 21)
      assert.strictEqual(await client.departamento.count(), 9)
      assert.strictEqual(await client.categoria.count(), 35)
      await client.$disconnect()
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO D: Empresa inactiva
  // ════════════════════════════════════════════════════════════════════
  describe('D: Empresa inactiva', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('d')

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      const { client } = prismaFor(DB)
      await client.empresa.create({ data: { slug: 'jesha', nombreComercial: 'X', razonSocial: 'X', whatsapp: '0', activa: false } })
      await client.$disconnect()
      globalThis.__seedD_result = await runSeed(DB, { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() })
    })

    after(async () => { await cleanupDB(DB) })

    it('exit 1 con EMPRESA_SEED_INACTIVA', () => {
      const r = globalThis.__seedD_result
      assert.strictEqual(r.timedOut, undefined)
      assert.strictEqual(r.code, 1)
      assert.ok(r.stderr.includes('EMPRESA_SEED_INACTIVA'))
    })

    it('sin usuarios ni datos demo', async () => {
      const { client } = prismaFor(DB)
      assert.strictEqual(await client.usuario.count(), 0)
      assert.strictEqual(await client.cliente.count(), 0)
      assert.strictEqual(await client.sucursal.count(), 0)
      await client.$disconnect()
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO E: Sucursal inactiva
  // ════════════════════════════════════════════════════════════════════
  describe('E: Sucursal inactiva', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('e')

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      const { client } = prismaFor(DB)
      const e = await client.empresa.create({ data: { slug: 'jesha', nombreComercial: 'J', razonSocial: 'J', whatsapp: '0', activa: true } })
      await client.sucursal.create({ data: { nombre: 'Ferretería JESHA - Matriz', empresaId: e.id, codigoPostal: '98000', activa: false } })
      await client.$disconnect()
      globalThis.__seedE_result = await runSeed(DB, { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() })
    })

    after(async () => { await cleanupDB(DB) })

    it('SUCURSAL_SEED_INACTIVA, sin usuarios', async () => {
      const r = globalThis.__seedE_result
      assert.strictEqual(r.timedOut, undefined)
      assert.strictEqual(r.code, 1)
      assert.ok(r.stderr.includes('SUCURSAL_SEED_INACTIVA'))
      const { client } = prismaFor(DB)
      assert.strictEqual(await client.usuario.count(), 0)
      await client.$disconnect()
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO F: Sucursal ambigua
  // ════════════════════════════════════════════════════════════════════
  describe('F: Sucursal ambigua', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('f')

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      const { client } = prismaFor(DB)
      const e = await client.empresa.create({ data: { slug: 'jesha', nombreComercial: 'J', razonSocial: 'J', whatsapp: '0', activa: true } })
      await client.sucursal.create({ data: { nombre: 'Ferretería JESHA - Matriz', empresaId: e.id, codigoPostal: '98000', activa: true } })
      await client.sucursal.create({ data: { nombre: 'Ferretería JESHA - Matriz', empresaId: e.id, codigoPostal: '98001', activa: true } })
      await client.$disconnect()
      globalThis.__seedF_result = await runSeed(DB, { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() })
    })

    after(async () => { await cleanupDB(DB) })

    it('SUCURSAL_SEED_AMBIGUA, sin usuarios', async () => {
      const r = globalThis.__seedF_result
      assert.strictEqual(r.timedOut, undefined)
      assert.strictEqual(r.code, 1)
      assert.ok(r.stderr.includes('SUCURSAL_SEED_AMBIGUA'))
      const { client } = prismaFor(DB)
      assert.strictEqual(await client.usuario.count(), 0)
      await client.$disconnect()
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO G: Rol divergente, rollback núcleo
  // ════════════════════════════════════════════════════════════════════
  describe('G: Rollback núcleo', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('g')

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      const { client } = prismaFor(DB)
      const e = await client.empresa.create({ data: { slug: 'jesha', nombreComercial: 'J', razonSocial: 'J', whatsapp: '0', activa: true } })
      const s = await client.sucursal.create({ data: { nombre: 'Ferretería JESHA - Matriz', empresaId: e.id, codigoPostal: '98000', activa: true } })
      const bcrypt = require('bcryptjs')
      const hash = await bcrypt.hash('x', 10)
      await client.usuario.create({ data: { username: 'empleado', nombre: 'X', passwordHash: hash, rol: 'ADMIN_SUCURSAL', empresaId: e.id, sucursalId: s.id, activo: true } })
      await client.$disconnect()
      globalThis.__seedG_empresaId = e.id
      globalThis.__seedG_result = await runSeed(DB, { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() })
    })

    after(async () => { await cleanupDB(DB) })

    it('SEED_EMPLEADO_DIVERGENTE, rollback total', async () => {
      const r = globalThis.__seedG_result
      assert.strictEqual(r.timedOut, undefined)
      assert.strictEqual(r.code, 1)
      assert.ok(r.stderr.includes('SEED_EMPLEADO_DIVERGENTE'))
      const { client } = prismaFor(DB)
      const eId = globalThis.__seedG_empresaId
      const sa = await client.usuario.findFirst({ where: { empresaId: eId, username: 'Gerardo_Manz' } })
      assert.strictEqual(sa, null)
      const adm = await client.usuario.findFirst({ where: { empresaId: eId, username: 'admin' } })
      assert.strictEqual(adm, null)
      const emp = await client.usuario.findFirst({ where: { empresaId: eId, username: 'empleado' } })
      assert.ok(emp)
      assert.strictEqual(emp.rol, 'ADMIN_SUCURSAL')
      await client.$disconnect()
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO H: Demo divergente
  // ════════════════════════════════════════════════════════════════════
  describe('H: Demo divergente', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('h')

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      const { client } = prismaFor(DB)
      await client.departamento.create({ data: { nombre: 'Herramientas', esGlobal: false, empresaId: null, activo: true } })
      await client.$disconnect()
      globalThis.__seedH_result = await runSeed(DB, { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() })
    })

    after(async () => { await cleanupDB(DB) })

    it('núcleo OK, demo DEPARTAMENTO_GLOBAL_DIVERGENTE, sin datos demo', async () => {
      const r = globalThis.__seedH_result
      assert.strictEqual(r.timedOut, undefined)
      assert.strictEqual(r.code, 1)
      assert.ok(r.stderr.includes('DEPARTAMENTO_GLOBAL_DIVERGENTE'))
      const { client } = prismaFor(DB)
      const e = await client.empresa.findUnique({ where: { slug: 'jesha' } })
      assert.ok(e)
      assert.strictEqual(await client.usuario.count({ where: { empresaId: e.id } }), 3)
      assert.strictEqual(await client.categoria.count(), 0)
      assert.strictEqual(await client.cliente.count(), 0)
      assert.strictEqual(await client.proveedor.count(), 0)
      assert.strictEqual(await client.producto.count(), 0)
      assert.strictEqual(await client.inventarioSucursal.count(), 0)
      await client.$disconnect()
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO I: Segunda empresa intacta
  // ════════════════════════════════════════════════════════════════════
  describe('I: Segunda empresa intacta', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('i')

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      const { client } = prismaFor(DB)
      const e2 = await client.empresa.create({ data: { slug: 'otra-empresa', nombreComercial: 'Otra', razonSocial: 'Otra SA', whatsapp: '0', activa: true } })
      const s2 = await client.sucursal.create({ data: { nombre: 'Suc Otra', empresaId: e2.id, codigoPostal: '98000', activa: true } })
      const bcrypt = require('bcryptjs')
      const h = await bcrypt.hash('x', 10)
      const u2 = await client.usuario.create({ data: { username: 'otro_user', nombre: 'U', passwordHash: h, rol: 'ADMIN_SUCURSAL', empresaId: e2.id, sucursalId: s2.id, activo: true } })
      const c2 = await client.cliente.create({ data: { nombre: 'C2', rfc: 'ZZZZ999999ZZ9', tipo: 'GENERAL', activo: true, empresaId: e2.id } })
      globalThis.__seedI_snapshot = { e2id: e2.id, s2id: s2.id, u2id: u2.id, u2rol: u2.rol, c2id: c2.id }
      await client.$disconnect()
      globalThis.__seedI_result = await runSeed(DB, { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() })
    })

    after(async () => { await cleanupDB(DB) })

    it('exit 0, segunda empresa intacta', async () => {
      const r = globalThis.__seedI_result
      assert.strictEqual(r.timedOut, undefined)
      assert.strictEqual(r.code, 0)
      const { client } = prismaFor(DB)
      const snap = globalThis.__seedI_snapshot
      const u2 = await client.usuario.findUnique({ where: { id: snap.u2id } })
      assert.ok(u2)
      assert.strictEqual(u2.rol, snap.u2rol)
      assert.strictEqual(u2.empresaId, snap.e2id)
      const c2 = await client.cliente.findUnique({ where: { id: snap.c2id } })
      assert.ok(c2)
      assert.strictEqual(c2.empresaId, snap.e2id)
      await client.$disconnect()
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  ESCENARIO J: Limpieza repetida (create/query/cleanup × 3)
  // ════════════════════════════════════════════════════════════════════
  describe('J: Limpieza repetida 3x', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {

    it('create/query/cleanup × 3 sin recursos residuales', async () => {
      for (let i = 0; i < 3; i++) {
        const DB = crearNombreBaseTemporal(`j_${i}`)
        await createDB(DB)
        await dbPush(DB)
        const { client } = prismaFor(DB)
        const r = await client.$queryRaw`SELECT 1 AS ok`
        assert.strictEqual(r[0].ok, 1)
        await cleanupDB(DB)

        const dbPools = [...poolRegistry.entries()].filter(([p, info]) => info.dbName === DB)
        assert.strictEqual(dbPools.length, 0, `Pool residual en iteración ${i}`)

        const dbChildren = [...childRegistry.entries()].filter(([c, info]) => info.dbName === DB)
        assert.strictEqual(dbChildren.length, 0, `Child residual en iteración ${i}`)

        assert.ok(!createdDatabases.has(DB), `BD residual en iteración ${i}: ${DB}`)
        assert.ok(!cleanupPromises.has(DB), `Cleanup promise residual en iteración ${i}`)
        assert.strictEqual(unexpectedPoolErrors.length, 0, `Errores de pool inesperados en iteración ${i}`)
        assert.strictEqual(cleanupFailures.length, 0, `Fallos de limpieza en iteración ${i}`)
      }
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  GUARDA: jesha_db rechazada en modo test
  // ════════════════════════════════════════════════════════════════════
  describe('Guarda: jesha_db rechazada', { concurrency: 1 }, () => {
    it('exit 1 con SEED_DATABASE_GUARD_FAILED', async () => {
      const r = await runSeedForGuard(GUARD_NAME)
      assert.strictEqual(r.code, 1)
      assert.ok(r.stderr.includes('SEED_DATABASE_GUARD_FAILED'))
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  LOGS sin secretos
  // ════════════════════════════════════════════════════════════════════
  describe('Logs sin secretos', { concurrency: 1, timeout: SCENARIO_TIMEOUT_MS }, () => {
    const DB = crearNombreBaseTemporal('sec')
    const pw = { sa: randomPassword(), adm: randomPassword(), emp: randomPassword() }

    before(async () => {
      await createDB(DB)
      await dbPush(DB)
      globalThis.__seedSec_result = await runSeed(DB, pw)
    })

    after(async () => { await cleanupDB(DB) })

    it('stdout+stderr sin passwords ni DATABASE_URL', () => {
      const r = globalThis.__seedSec_result
      const all = r.stdout + r.stderr
      assert.ok(!all.includes(pw.sa))
      assert.ok(!all.includes(pw.adm))
      assert.ok(!all.includes(pw.emp))
      assert.ok(!all.includes('postgresql://'))
    })
  })
})
