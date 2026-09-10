'use strict'

// ════════════════════════════════════════════════════════════════════════════
//  TEST DB SAFETY GUARD — Centralizado para todas las suites PostgreSQL
// ════════════════════════════════════════════════════════════════════════════
//
// Incidente motivador: 2026-08-24, p0-policy-postgres escribio en jesha_db
// porque TEST_DATABASE_URL_OVERRIDE apuntaba a jesha_db sin validacion.
//
// Este modulo provee:
//   1. parseDatabaseName(url)  — extrae el nombre real de DB de una URL PG
//   2. assertSafeTestDb(url)   — lanza UNSAFE_TEST_DATABASE si es peligrosa
//   3. ALLOWED_PREFIXES        — allowlist explicita de prefijos permitidos
//
// Uso obligatorio en TODA suite PostgreSQL ANTES de cualquier:
//   fixture, seed, db push, INSERT, UPDATE, DELETE, TRUNCATE, ALTER, DROP
// ════════════════════════════════════════════════════════════════════════════

class UnsafeTestDatabaseError extends Error {
  constructor(databaseName, url) {
    super(
      `UNSAFE_TEST_DATABASE: "${databaseName}" no esta en la allowlist. ` +
      `Solo se permiten bases de prueba con prefijos: ${ALLOWED_PREFIXES.join(', ')}. ` +
      `NUNCA usar jesha_db, postgres, template0, template1 u otras bases de produccion.`
    )
    this.name = 'UnsafeTestDatabaseError'
    this.code = 'UNSAFE_TEST_DATABASE'
    this.databaseName = databaseName
    this.url = typeof url === 'string' ? url.replace(/:[^:@]+@/, ':***@') : undefined
  }
}

// Allowlist exclusiva de prefijos para bases de prueba
const ALLOWED_PREFIXES = Object.freeze([
  'jesha_p0_',
  'jesha_p1_',
  'jesha_p2_',
  'jesha_final_',
  'jesha_test_',
  'jesha_restore_',
  'jesha_incident_restore_'
])

// Nombres absolutamente prohibidos (independientemente del prefijo)
const BLOCKED_NAMES = Object.freeze(new Set([
  'jesha_db',
  'postgres',
  'template0',
  'template1'
]))

// ════════════════════════════════════════════════════════════════════════════
//  parseDatabaseName — Parser robusto de URLs PostgreSQL
// ════════════════════════════════════════════════════════════════════════════
//
// Soporta:
//   postgresql://user:pass@host:5432/dbname
//   postgresql://user:pass@host:5432/dbname?schema=public
//   postgresql://user:pass@[::1]:5432/dbname
//   postgresql://user%40domain:pass@host:5432/dbname
//   postgresql://user:pass with spaces@host:5432/dbname
//
// Usa URL nativa de Node (WHATWG) — no regex ingenuo.
// ════════════════════════════════════════════════════════════════════════════

function parseDatabaseName(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new UnsafeTestDatabaseError('<empty>', url)
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new UnsafeTestDatabaseError('<invalid-url>', url)
  }

  // pathname contiene el database name (post ultimo '/')
  const pathname = parsed.pathname || ''
  const dbName = decodeURIComponent(pathname.replace(/^\//, ''))

  if (!dbName) {
    throw new UnsafeTestDatabaseError('<missing>', url)
  }

  return dbName
}

// ════════════════════════════════════════════════════════════════════════════
//  assertSafeTestDb — Guard central
// ════════════════════════════════════════════════════════════════════════════
//
// Lanza UnsafeTestDatabaseError si la URL apunta a una base no permitida.
// Retorna el databaseName si es seguro.
//
// Debe invocarse ANTES de cualquier operacion de escritura sobre la BD.
// ════════════════════════════════════════════════════════════════════════════

function assertSafeTestDb(url) {
  const dbName = parseDatabaseName(url)

  // Bloqueo hard-coded por nombre
  if (BLOCKED_NAMES.has(dbName)) {
    throw new UnsafeTestDatabaseError(dbName, url)
  }

  // Allowlist por prefijo
  const isAllowed = ALLOWED_PREFIXES.some(prefix => dbName.startsWith(prefix))
  if (!isAllowed) {
    throw new UnsafeTestDatabaseError(dbName, url)
  }

  return dbName
}

// ════════════════════════════════════════════════════════════════════════════
//  resolveEffectiveDbName — Resuelve el nombre de DB efectivo desde env
// ════════════════════════════════════════════════════════════════════════════
//
// Prioridad:
//   1. TEST_DATABASE_URL_OVERRIDE (si existe)
//   2. DATABASE_URL (si existe)
//   3. throw
//
// Siempre valida con assertSafeTestDb antes de retornar.
// ════════════════════════════════════════════════════════════════════════════

function resolveEffectiveDbName(env = process.env) {
  const url = env.TEST_DATABASE_URL_OVERRIDE || env.DATABASE_URL
  if (!url) {
    throw new Error('TEST_DATABASE_URL_OVERRIDE y DATABASE_URL no estan definidos')
  }
  return assertSafeTestDb(url)
}

module.exports = {
  UnsafeTestDatabaseError,
  ALLOWED_PREFIXES,
  BLOCKED_NAMES,
  parseDatabaseName,
  assertSafeTestDb,
  resolveEffectiveDbName
}
