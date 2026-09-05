'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')

const mod = require('../prisma/seed')

// ═══════════ HELPERS ═══════════
function envOk(target) {
  const e = {
    SEED_SUPERADMIN_PASSWORD: 'psa',
    SEED_ADMIN_PASSWORD: 'padm',
    SEED_EMPLEADO_PASSWORD: 'pemp',
    SEED_TARGET: target,
    DATABASE_URL: target === 'test'
      ? 'postgresql://u:p@localhost:5432/jesha_p0_seed_test_x'
      : 'postgresql://u:p@localhost:5432/jesha_db'
  }
  if (target === 'test') e.P0_SEED_CONFIRMATION = 'SEED_JESHA_ISOLATED_TEST_ONLY'
  if (target === 'local') e.LOCAL_SEED_CONFIRMATION = 'SEED_JESHA_LOCAL_ONLY'
  return e
}

function loggerFake() {
  const lines = []
  return {
    log(...args) { lines.push(args.join(' ')) },
    error(...args) { lines.push(args.join(' ')) },
    getLines() { return lines },
    hasLine(needle) { return lines.some(l => l.includes(needle)) }
  }
}

// ════════════════════════════════════════════════════════════════════
//  Fábrica de Prisma falso con contadores
// ════════════════════════════════════════════════════════════════════
function makePrismaFake(opts = {}) {
  let disconnectCount = 0
  let txCount = 0
  let createCount = 0
  let updateCount = 0
  let advisoryCallCount = 0
  let $queryRawCallCount = 0
  let $executeRawCallCount = 0

  const counters = {
    getDisconnectCount: () => disconnectCount,
    getTxCount: () => txCount,
    getCreateCount: () => createCount,
    getUpdateCount: () => updateCount,
    getAdvisoryCallCount: () => advisoryCallCount,
    getQueryRawCallCount: () => $queryRawCallCount,
    getExecuteRawCallCount: () => $executeRawCallCount,
    getWriteCount: () => createCount + updateCount
  }

  function recordWrite(d) { createCount++; return { id: 1, ...d.data } }
  function txQueryRaw(sql) {
    $queryRawCallCount++
    if (String(sql).includes('pg_advisory_xact_lock')) advisoryCallCount++
    return []
  }

  function makeTx(extra) {
    return {
      $queryRaw: txQueryRaw,
      $executeRaw: async () => { $executeRawCallCount++; return [] },
      ...(opts.txEmpresa || {
        empresa: {
          findUnique: async (q) => {
            if (q && q.where && q.where.slug === 'jesha') return null
            return { id: 1, slug: 'jesha', activa: true, nombreComercial: 'JESHA', razonSocial: 'JESHA SA' }
          },
          create: recordWrite
        }
      }),
      ...(opts.txSucursal || {
        sucursal: {
          findMany: async () => [],
          create: recordWrite,
          findUnique: async () => ({ id: 1, empresaId: 1, activa: true, nombre: 'Ferretería JESHA - Matriz' })
        }
      }),
      ...(opts.txUsuario || {
        usuario: {
          findUnique: async () => null,
          create: recordWrite,
          count: async (q) => (q && q.where && q.where.sucursalId === null) ? 0 : 3,
          findFirst: async (q) => ({ empresaId: 1, sucursalId: q.where.username === 'Gerardo_Manz' ? null : 1, activo: true })
        }
      }),
      ...(opts.txDepto || {
        departamento: {
          findMany: async () => [],
          create: recordWrite
        }
      }),
      ...(opts.txCategoria || {
        categoria: {
          findMany: async () => [],
          create: recordWrite
        }
      }),
      ...(opts.txCliente || {
        cliente: {
          findUnique: async () => null,
          create: recordWrite
        }
      }),
      ...(opts.txProveedor || {
        proveedor: {
          findUnique: async () => null,
          create: recordWrite
        }
      }),
      ...(opts.txProducto || {
        producto: {
          findUnique: async () => null,
          create: recordWrite
        }
      }),
      ...(opts.txInventario || {
        inventarioSucursal: {
          findUnique: async () => null,
          create: recordWrite
        }
      }),
      ...extra
    }
  }

  const prisma = {
    $disconnect: async () => { disconnectCount++ },
    $queryRaw: async () => (opts.currentDbResponse || [{ db: opts.dbName || 'jesha_p0_seed_test_x' }]),
    getDisconnectCount: () => disconnectCount,
    getTxCount: () => txCount,
    getAdvisoryCallCount: () => advisoryCallCount,
    getCreateCount: () => createCount,
    getUpdateCount: () => updateCount,
    getWriteCount: () => createCount + updateCount,
    getExecuteRawCallCount: () => $executeRawCallCount,
    ...counters
  }

  prisma.$transaction = async (cb) => {
    txCount++
    const tx = makeTx()
    Object.defineProperty(prisma, 'getTxCount', { value: () => txCount, writable: true })
    Object.defineProperty(prisma, 'getAdvisoryCallCount', { value: () => advisoryCallCount, writable: true })
    Object.defineProperty(prisma, 'getCreateCount', { value: () => createCount, writable: true })
    Object.defineProperty(prisma, 'getUpdateCount', { value: () => updateCount, writable: true })
    Object.defineProperty(prisma, 'getWriteCount', { value: () => createCount + updateCount, writable: true })
    const result = await cb(tx)
    return result
  }
  if (opts.beforeTx) opts.beforeTx(prisma)

  return prisma
}

function nullRuntime() {
  return { bcrypt: { hash: async () => 'h' }, prisma: makePrismaFake({ ...arguments[0] }), validarEstadoUsuarioPorRol: () => true }
}

// ════════════════════════════════════════════════════════════════════
//  1. Confirmaciones exclusivas
// ════════════════════════════════════════════════════════════════════
describe('Confirmaciones exclusivas', { concurrency: 1 }, () => {
  const e = (target) => ({
    SEED_SUPERADMIN_PASSWORD: 'a', SEED_ADMIN_PASSWORD: 'b', SEED_EMPLEADO_PASSWORD: 'c',
    SEED_TARGET: target,
    DATABASE_URL: 'postgresql://u@localhost/db'
  })

  it('test correcto → OK', () => {
    const env = { ...e('test'), P0_SEED_CONFIRMATION: 'SEED_JESHA_ISOLATED_TEST_ONLY' }
    assert.strictEqual(mod.resolverConfiguracion(env).target, 'test')
  })
  it('test con LOCAL definido → CONFLICT', () => {
    const env = { ...e('test'), P0_SEED_CONFIRMATION: 'SEED_JESHA_ISOLATED_TEST_ONLY', LOCAL_SEED_CONFIRMATION: 'X' }
    assert.throws(() => mod.resolverConfiguracion(env), { code: 'SEED_CONFIRMATION_CONFLICT' })
  })
  it('local correcto → OK', () => {
    const env = { ...e('local'), LOCAL_SEED_CONFIRMATION: 'SEED_JESHA_LOCAL_ONLY' }
    assert.strictEqual(mod.resolverConfiguracion(env).target, 'local')
  })
  it('local con P0 definido → CONFLICT', () => {
    const env = { ...e('local'), LOCAL_SEED_CONFIRMATION: 'SEED_JESHA_LOCAL_ONLY', P0_SEED_CONFIRMATION: 'X' }
    assert.throws(() => mod.resolverConfiguracion(env), { code: 'SEED_CONFIRMATION_CONFLICT' })
  })
  it('local sin confirmacion → REQUIRED', () => {
    assert.throws(() => mod.resolverConfiguracion(e('local')), { code: 'SEED_CONFIRMATION_REQUIRED' })
  })
})

// ════════════════════════════════════════════════════════════════════
//  2. validarDestino
// ════════════════════════════════════════════════════════════════════
describe('validarDestino', { concurrency: 1 }, () => {
  it('host remoto → BLOCKED', () => { assert.throws(() => mod.validarDestino('test', 'postgresql://u@r.com/db'), { code: 'SEED_REMOTE_HOST_BLOCKED' }) })
  it('cloud neon → BLOCKED', () => { assert.throws(() => mod.validarDestino('test', 'postgresql://u@ep.neon.tech/db'), { code: 'SEED_REMOTE_HOST_BLOCKED' }) })
  it('test con jesha_db → GUARD_FAILED', () => { assert.throws(() => mod.validarDestino('test', 'postgresql://u@localhost/jesha_db'), { code: 'SEED_DATABASE_GUARD_FAILED' }) })
  it('test prefijo ok', () => { const r = mod.validarDestino('test', 'postgresql://u@localhost/jesha_p0_seed_test_x'); assert.strictEqual(r.dbName, 'jesha_p0_seed_test_x') })
  it('local solo jesha_db', () => { const r = mod.validarDestino('local', 'postgresql://u@localhost/jesha_db'); assert.strictEqual(r.dbName, 'jesha_db') })
  it('local rechaza prefijo test', () => { assert.throws(() => mod.validarDestino('local', 'postgresql://u@localhost/jesha_p0_seed_test_x'), { code: 'SEED_DATABASE_GUARD_FAILED' }) })
  it('DATABASE_URL undefined → INVALID', () => {
    const prev = process.env.DATABASE_URL
    try {
      delete process.env.DATABASE_URL
      assert.throws(() => mod.validarDestino('test', undefined), { code: 'SEED_DATABASE_URL_INVALID' })
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev
      else delete process.env.DATABASE_URL
    }
  })

  it('IPv6 [::1] test → OK y hostname normalizado', () => {
    const r = mod.validarDestino('test', 'postgresql://u:p@[::1]:5432/jesha_p0_seed_test_ipv6')
    assert.strictEqual(r.hostname, '::1')
    assert.strictEqual(r.dbName, 'jesha_p0_seed_test_ipv6')
  })

  it('IPv6 [::1] local → OK', () => {
    const r = mod.validarDestino('local', 'postgresql://u:p@[::1]:5432/jesha_db')
    assert.strictEqual(r.hostname, '::1')
  })

  it('http:// → INVALID', () => {
    assert.throws(() => mod.validarDestino('test', 'http://localhost/jesha_p0_seed_test_x'), { code: 'SEED_DATABASE_URL_INVALID' })
  })

  it('file:// → INVALID', () => {
    assert.throws(() => mod.validarDestino('test', 'file://localhost/jesha_p0_seed_test_x'), { code: 'SEED_DATABASE_URL_INVALID' })
  })

  it('mysql:// → INVALID', () => {
    assert.throws(() => mod.validarDestino('test', 'mysql://localhost/jesha_p0_seed_test_x'), { code: 'SEED_DATABASE_URL_INVALID' })
  })

  it('resolverConfiguracion() sin argumento usa process.env', () => {
    const prev = {
      SEED_SUPERADMIN_PASSWORD: process.env.SEED_SUPERADMIN_PASSWORD,
      SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
      SEED_EMPLEADO_PASSWORD: process.env.SEED_EMPLEADO_PASSWORD,
      SEED_TARGET: process.env.SEED_TARGET,
      P0_SEED_CONFIRMATION: process.env.P0_SEED_CONFIRMATION,
      LOCAL_SEED_CONFIRMATION: process.env.LOCAL_SEED_CONFIRMATION
    }
    process.env.SEED_SUPERADMIN_PASSWORD = 'x'
    process.env.SEED_ADMIN_PASSWORD = 'x'
    process.env.SEED_EMPLEADO_PASSWORD = 'x'
    process.env.SEED_TARGET = 'test'
    process.env.P0_SEED_CONFIRMATION = 'SEED_JESHA_ISOLATED_TEST_ONLY'
    try {
      assert.strictEqual(mod.resolverConfiguracion().target, 'test')
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  it('validarDestino sin segundo arg usa DATABASE_URL', () => {
    const prev = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://u@localhost/jesha_p0_seed_test_default'
    try {
      const r = mod.validarDestino('test')
      assert.strictEqual(r.dbName, 'jesha_p0_seed_test_default')
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = prev
    }
  })
})

// ════════════════════════════════════════════════════════════════════
//  3. validarCurrentDatabase
// ════════════════════════════════════════════════════════════════════
describe('validarCurrentDatabase', { concurrency: 1 }, () => {
  function fp(db) { return { $queryRaw: async () => [{ db }] } }
  it('exact match → OK', async () => { await mod.validarCurrentDatabase(fp('jesha_p0_seed_test_x'), 'jesha_p0_seed_test_x') })
  it('prefijo igual nombre distinto → error', async () => { await assert.rejects(() => mod.validarCurrentDatabase(fp('jesha_p0_seed_test_b'), 'jesha_p0_seed_test_a'), { code: 'SEED_DATABASE_GUARD_FAILED' }) })
  it('local distinto → error', async () => { await assert.rejects(() => mod.validarCurrentDatabase(fp('x'), 'jesha_db'), { code: 'SEED_DATABASE_GUARD_FAILED' }) })
  it('vacio → error', async () => { await assert.rejects(() => mod.validarCurrentDatabase({ $queryRaw: async () => [] }, 'x'), { code: 'SEED_DATABASE_GUARD_FAILED' }) })
  it('lanza → error', async () => { await assert.rejects(() => mod.validarCurrentDatabase({ $queryRaw: async () => { throw new Error('x') } }, 'x'), { code: 'SEED_DATABASE_GUARD_FAILED' }) })
})

// ════════════════════════════════════════════════════════════════════
//  4. Ciclo de vida — disconnect count
// ════════════════════════════════════════════════════════════════════
describe('Ciclo de vida — disconnect count', { concurrency: 1 }, () => {
  const env = envOk('test')

  it('exito → disconnect count = 1', async () => {
    const p = makePrismaFake()
    await mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) })
    assert.strictEqual(p.getDisconnectCount(), 1)
    assert.ok(p.getTxCount() >= 2)
  })

  it('current_database falla → disconnect count = 1', async () => {
    const p = makePrismaFake()
    p.$queryRaw = async () => { throw new Error('conn') }
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }), { code: 'SEED_DATABASE_GUARD_FAILED' })
    assert.strictEqual(p.getDisconnectCount(), 1)
    assert.strictEqual(p.getTxCount(), 0)
  })

  it('bcrypt falla → disconnect count = 1, cero tx', async () => {
    const p = makePrismaFake()
    const bcrypt = { hash: async () => { throw new Error('bcrypt crash') } }
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ prisma: p, bcrypt, validarEstadoUsuarioPorRol: () => true }) }))
    assert.strictEqual(p.getDisconnectCount(), 1)
    assert.strictEqual(p.getTxCount(), 0)
  })

  it('core falla → disconnect count = 1', async () => {
    const p = makePrismaFake({ txUsuario: { usuario: { findUnique: async () => null, create: async () => { throw new Error('crash') }, count: async () => 0, findFirst: async () => null } } })
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }))
    assert.strictEqual(p.getDisconnectCount(), 1)
  })

  it('demo falla → disconnect count = 1', async () => {
    let n = 0
    const p = makePrismaFake({
      beforeTx: (prisma) => {
        const orig = prisma.$transaction
        prisma.$transaction = async (cb) => {
          n++
          if (n === 2) throw new Error('demo crash')
          return orig.call(prisma, cb)
        }
      }
    })
    const bcrypt = { hash: async () => 'h' }
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ prisma: p, bcrypt, validarEstadoUsuarioPorRol: () => true }) }))
    assert.strictEqual(p.getDisconnectCount(), 1)
  })

  it('guarda pre-runtime falla → disconnect count = 0', async () => {
    const p = makePrismaFake()
    const badEnv = { ...env, SEED_SUPERADMIN_PASSWORD: '' }
    await assert.rejects(() => mod.main({ env: badEnv, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }), { code: 'SEED_PASSWORD_REQUIRED' })
    assert.strictEqual(p.getDisconnectCount(), 0)
  })

  it('disconnect falla despues de exito → SEED_DISCONNECT_FAILED, sin SEED_COMPLETED', async () => {
    const p = makePrismaFake()
    const orig = p.$disconnect
    let calls = 0
    p.$disconnect = async () => { calls++; throw new Error('disconnect fail') }
    const logger = loggerFake()
    await assert.rejects(
      () => mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }), logger }),
      { code: 'SEED_DISCONNECT_FAILED' }
    )
    assert.strictEqual(calls, 1)
    assert.ok(logger.hasLine('NUCLEO_VALIDATION_OK'))
    assert.ok(logger.hasLine('DEMO_DATA_OK'))
    assert.ok(!logger.hasLine('SEED_COMPLETED'))
  })

  it('disconnect falla despues de error core → conserva error core', async () => {
    const p = makePrismaFake({
      txUsuario: { usuario: { findUnique: async () => null, create: async () => { throw new Error('crash') }, count: async () => 0, findFirst: async () => null } }
    })
    p.$disconnect = async () => { throw new Error('disconnect fail') }
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }), { code: 'SEED_CORE_FAILED' })
  })
})

// ════════════════════════════════════════════════════════════════════
//  5. SEED_GUARD_OK solo tras current_database
// ════════════════════════════════════════════════════════════════════
describe('SEED_GUARD_OK timing', { concurrency: 1 }, () => {
  const env = envOk('test')

  it('current_database correcta → imprime SEED_GUARD_OK', async () => {
    const p = makePrismaFake()
    const logger = loggerFake()
    await mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }), logger })
    assert.ok(logger.hasLine('SEED_GUARD_OK'))
    assert.ok(logger.hasLine('TARGET_DATABASE_TEST'))
  })

  it('current_database incorrecta → NO imprime SEED_GUARD_OK', async () => {
    const p = makePrismaFake({ currentDbResponse: [{ db: 'otra_db' }] })
    const logger = loggerFake()
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }), logger }))
    assert.ok(!logger.hasLine('SEED_GUARD_OK'))
    assert.strictEqual(p.getTxCount(), 0)
  })

  it('current_database incorrecta → cero transacciones', async () => {
    const p = makePrismaFake({ currentDbResponse: [{ db: 'jesha_p0_seed_test_b' }], dbName: 'jesha_p0_seed_test_a' })
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }))
    assert.strictEqual(p.getTxCount(), 0)
    assert.strictEqual(p.getWriteCount(), 0)
  })
})

// ════════════════════════════════════════════════════════════════════
//  6. Logs sin secretos
// ════════════════════════════════════════════════════════════════════
describe('Logs sin secretos', { concurrency: 1 }, () => {
  it('ninguna línea contiene passwords', async () => {
    const p = makePrismaFake()
    const logger = loggerFake()
    await mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }), logger })
    for (const line of logger.getLines()) {
      assert.ok(!line.includes('psa'), `linea contiene password: ${line}`)
      assert.ok(!line.includes('padm'), `linea contiene password: ${line}`)
      assert.ok(!line.includes('pemp'), `linea contiene password: ${line}`)
      assert.ok(!line.includes('postgresql://'), `linea contiene URL: ${line}`)
    }
  })
})

// ════════════════════════════════════════════════════════════════════
//  7. Logs — timing y no duplicación
// ════════════════════════════════════════════════════════════════════
describe('Logs — timing y no duplicación', { concurrency: 1 }, () => {
  const env = envOk('test')
  it('éxito → SEED_COMPLETED al final', async () => {
    const logger = loggerFake()
    await mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: makePrismaFake() }), logger })
    const lines = logger.getLines()
    assert.ok(lines.includes('NUCLEO_VALIDATION_OK'))
    assert.ok(lines.includes('DEMO_DATA_OK'))
    assert.strictEqual(lines[lines.length - 1], 'SEED_COMPLETED')
  })

  it('core falla → sin NUCLEO_* ni SEED_COMPLETED', async () => {
    const logger = loggerFake()
    const p = makePrismaFake({ txUsuario: { usuario: { findUnique: async () => null, create: async () => { throw new Error('x') }, count: async () => 0, findFirst: async () => null } } })
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ ...nullRuntime(), prisma: p }), logger }))
    assert.ok(!logger.hasLine('NUCLEO_EMPRESA_OK'))
    assert.ok(!logger.hasLine('SEED_COMPLETED'))
  })

  it('demo falla → NUCLEO_* sí, DEMO_DATA_OK no, no duplicado', async () => {
    const logger = loggerFake()
    let n = 0
    const p = makePrismaFake({ beforeTx: (prisma) => { const orig = prisma.$transaction; prisma.$transaction = async (cb) => { n++; if (n === 2) throw new Error('demo crash'); return orig.call(prisma, cb) } } })
    const bcrypt = { hash: async () => 'h' }
    await assert.rejects(() => mod.main({ env, cargarRuntime: () => ({ prisma: p, bcrypt, validarEstadoUsuarioPorRol: () => true }), logger }))
    assert.ok(logger.hasLine('NUCLEO_VALIDATION_OK'))
    assert.ok(!logger.hasLine('DEMO_DATA_OK'))
    assert.ok(!logger.hasLine('SEED_COMPLETED'))
    // DEMO_DATA_FAILED debe aparecer exactamente 0 veces en el logger (solo en stderr via entrypoint)
    const demoFailCount = logger.getLines().filter(l => l.includes('DEMO_DATA_FAILED')).length
    assert.strictEqual(demoFailCount, 0, 'main no debe imprimir DEMO_DATA_FAILED')
  })
})

// ════════════════════════════════════════════════════════════════════
//  8. Advisory lock — conteo real
// ════════════════════════════════════════════════════════════════════
describe('Advisory lock — conteo real', { concurrency: 1 }, () => {
  it('éxito → 2 advisory locks, cero $executeRaw', async () => {
    const p = makePrismaFake()
    await mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) })
    assert.strictEqual(p.getAdvisoryCallCount(), 2)
    assert.strictEqual(p.getExecuteRawCallCount(), 0)
  })

  it('adquirirSeedLock existe y usa $queryRaw', async () => {
    let called = false
    await mod.adquirirSeedLock({ $queryRaw: async () => { called = true } })
    assert.strictEqual(called, true)
  })
})

// ════════════════════════════════════════════════════════════════════
//  9. Stock determinista
// ════════════════════════════════════════════════════════════════════
describe('Stock determinista', { concurrency: 1 }, () => {
  it('inventario nuevo recibe stockActual = 50', async () => {
    let capturedStock = null
    const p = makePrismaFake({
      txInventario: {
        inventarioSucursal: {
          findUnique: async () => null,
          create: async (d) => { capturedStock = d.data.stockActual; return { id: 1 } }
        }
      }
    })
    await mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) })
    assert.strictEqual(capturedStock, 50)
  })

  it('inventario existente no se modifica (no create, no update)', async () => {
    let createCalls = 0
    let updateCalls = 0
    const p = makePrismaFake({
      txInventario: {
        inventarioSucursal: {
          findUnique: async () => ({ id: 1, productoId: 1, sucursalId: 1, stockActual: 77 }),
          create: async () => { createCalls++; return { id: 1 } },
          update: async () => { updateCalls++ }
        }
      }
    })
    await mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) })
    assert.strictEqual(createCalls, 0, 'no debe crear inventario ya existente')
    assert.strictEqual(updateCalls, 0, 'no debe modificar inventario existente')
  })

  it('no contiene Math.random', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'prisma', 'seed.js'), 'utf-8')
    assert.ok(!src.includes('Math.random'))
  })
})

// ════════════════════════════════════════════════════════════════════
//  10. Divergencias — Departamento global
// ════════════════════════════════════════════════════════════════════
describe('Divergencia — Departamento', { concurrency: 1 }, () => {
  it('1 depto con esGlobal=false → DEPARTAMENTO_GLOBAL_DIVERGENTE', async () => {
    const p = makePrismaFake({
      txDepto: {
        departamento: {
          findMany: async () => [{ nombre: 'Herramientas', empresaId: null, esGlobal: false, activo: true }],
          create: async (d) => ({ id: 1, ...d.data })
        }
      }
    })
    await assert.rejects(
      () => mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }),
      { code: 'DEPARTAMENTO_GLOBAL_DIVERGENTE' }
    )
  })
})

// ════════════════════════════════════════════════════════════════════
//  11. Divergencia — Categoría global
// ════════════════════════════════════════════════════════════════════
describe('Divergencia — Categoría', { concurrency: 1 }, () => {
  it('1 cat con departamentoId incorrecto → CATEGORIA_GLOBAL_DIVERGENTE', async () => {
    const p = makePrismaFake({
      txDepto: {
        departamento: {
          findMany: async () => [],
          create: async (d) => ({ id: 999, ...d.data })
        }
      },
      txCategoria: {
        categoria: {
          findMany: async () => [{ nombre: 'Martillos', empresaId: null, esGlobal: true, departamentoId: 777 }],
          create: async (d) => ({ id: 1, ...d.data })
        }
      }
    })
    await assert.rejects(
      () => mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }),
      { code: 'CATEGORIA_GLOBAL_DIVERGENTE' }
    )
  })
})

// ════════════════════════════════════════════════════════════════════
//  12. Divergencia — Cliente
// ════════════════════════════════════════════════════════════════════
describe('Divergencia — Cliente', { concurrency: 1 }, () => {
  it('cliente tipo distinto → CLIENTE_DEMO_DIVERGENTE', async () => {
    const p = makePrismaFake({
      txCliente: {
        cliente: {
          findUnique: async () => ({ empresaId: 1, rfc: 'XAXX010101000', activo: true, tipo: 'FISCAL' }),
          create: async (d) => ({ id: 1, ...d.data })
        }
      }
    })
    await assert.rejects(
      () => mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }),
      { code: 'CLIENTE_DEMO_DIVERGENTE' }
    )
  })
})

// ════════════════════════════════════════════════════════════════════
//  13. Divergencia — Proveedor
// ════════════════════════════════════════════════════════════════════
describe('Divergencia — Proveedor', { concurrency: 1 }, () => {
  it('proveedor alias distinto → PROVEEDOR_DEMO_DIVERGENTE', async () => {
    const p = makePrismaFake({
      txProveedor: {
        proveedor: {
          findUnique: async () => ({ empresaId: 1, nombreOficial: 'Herramientas del Centro', alias: 'WRONG', activo: true }),
          create: async (d) => ({ id: 1, ...d.data })
        }
      }
    })
    await assert.rejects(
      () => mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }),
      { code: 'PROVEEDOR_DEMO_DIVERGENTE' }
    )
  })
})

// ════════════════════════════════════════════════════════════════════
//  14. Divergencia — Producto
// ════════════════════════════════════════════════════════════════════
describe('Divergencia — Producto', { concurrency: 1 }, () => {
  it('producto categoriaId distinto → PRODUCTO_DEMO_DIVERGENTE', async () => {
    const p = makePrismaFake({
      txProducto: {
        producto: {
          findUnique: async (q) => ({ empresaId: 1, codigoInterno: q.where.empresaId_codigoInterno.codigoInterno, categoriaId: 999, activo: true }),
          create: async (d) => ({ id: 1, ...d.data })
        }
      }
    })
    await assert.rejects(
      () => mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) }),
      { code: 'PRODUCTO_DEMO_DIVERGENTE' }
    )
  })

  it('producto ok → crea sin error', async () => {
    const p = makePrismaFake()
    await mod.main({ env: envOk('test'), cargarRuntime: () => ({ ...nullRuntime(), prisma: p }) })
  })
})

// ════════════════════════════════════════════════════════════════════
//  15. Archivos eliminados
// ════════════════════════════════════════════════════════════════════
describe('Archivos eliminados', { concurrency: 1 }, () => {
  it('seed.js raíz no existe', () => assert.strictEqual(fs.existsSync(path.resolve(__dirname, '..', 'seed.js')), false))
  it('fix-password.js no existe', () => assert.strictEqual(fs.existsSync(path.resolve(__dirname, '..', 'fix-password.js')), false))
})

// ════════════════════════════════════════════════════════════════════
//  16. Cero secretos
// ════════════════════════════════════════════════════════════════════
describe('Cero secretos', { concurrency: 1 }, () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'prisma', 'seed.js'), 'utf-8')
  it('sin Admin2024!', () => assert.ok(!src.includes('Admin2024!')))
  it('sin admin123', () => assert.ok(!src.includes('admin123')))
  it('sin vendedor123', () => assert.ok(!src.includes('vendedor123')))
})

// ════════════════════════════════════════════════════════════════════
//  17. Verificación de código fuente
// ════════════════════════════════════════════════════════════════════
describe('Código fuente', { concurrency: 1 }, () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'prisma', 'seed.js'), 'utf-8')
  it('sin Math.random', () => assert.ok(!src.includes('Math.random')))
  it('sin findFirstOrThrow', () => assert.ok(!src.includes('findFirstOrThrow')))
  it('sin nucleoOk/demoOk', () => assert.ok(!/let\s+(nucleoOk|demoOk)\s*=/.test(src)))
  it('require.main === module', () => assert.ok(src.includes('require.main === module')))
  it('module.exports', () => assert.ok(src.includes('module.exports')))
  it('2+ $transaction', () => { const m = src.match(/\$transaction/g); assert.ok(m && m.length >= 2) })
  it('validarEstadoUsuarioPorRol', () => assert.ok(src.includes('validarEstadoUsuarioPorRol')))
  it('adquirirSeedLock 2+', () => { const m = src.match(/adquirirSeedLock/g); assert.ok(m && m.length >= 2) })
  it('SEED_DISCONNECT_FAILED', () => assert.ok(src.includes('SEED_DISCONNECT_FAILED')))
  it('primaryError', () => assert.ok(src.includes('primaryError')))
  it('sin $executeRaw con pg_advisory', () => { const m = src.match(/\$executeRaw.*pg_advisory/i); assert.strictEqual(m, null) })
})
