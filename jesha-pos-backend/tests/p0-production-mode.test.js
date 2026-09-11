'use strict'

const assert = require('node:assert/strict')
const { describe, it, beforeEach, afterEach } = require('node:test')

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'

// ════════════════════════════════════════════════════════════════════
//  P0 — Production mode hotfix tests
//  Covers: force-live en producción, fail-closed live key,
//          livemode guard post-create, derivarEstadoFiscal live key check
// ════════════════════════════════════════════════════════════════════

describe('P0 — Production mode hotfix', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  // ── P0-A: modoActivo() force-live ──
  describe('modoActivo — force-live en producción', () => {
    it('returns "live" when NODE_ENV=production and FACTURAPI_MODE is unset', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.FACTURAPI_MODE
      delete process.env.RENDER
      // Re-require to pick up env changes
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { modoActivo } = require('../src/lib/facturapi')
      assert.equal(modoActivo(), 'live')
    })

    it('returns "live" when RENDER=true and FACTURAPI_MODE is unset', () => {
      process.env.RENDER = 'true'
      delete process.env.NODE_ENV
      delete process.env.FACTURAPI_MODE
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { modoActivo } = require('../src/lib/facturapi')
      assert.equal(modoActivo(), 'live')
    })

    it('returns "live" when NODE_ENV=production even if FACTURAPI_MODE=test', () => {
      process.env.NODE_ENV = 'production'
      process.env.FACTURAPI_MODE = 'test'
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { modoActivo } = require('../src/lib/facturapi')
      assert.equal(modoActivo(), 'live')
    })

    it('returns "test" when not in production and FACTURAPI_MODE is unset', () => {
      delete process.env.NODE_ENV
      delete process.env.RENDER
      delete process.env.FACTURAPI_MODE
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { modoActivo } = require('../src/lib/facturapi')
      assert.equal(modoActivo(), 'test')
    })

    it('returns "live" when not in production but FACTURAPI_MODE=live', () => {
      delete process.env.NODE_ENV
      delete process.env.RENDER
      process.env.FACTURAPI_MODE = 'live'
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { modoActivo } = require('../src/lib/facturapi')
      assert.equal(modoActivo(), 'live')
    })

    it('returns "test" when not in production and FACTURAPI_MODE=invalid', () => {
      delete process.env.NODE_ENV
      delete process.env.RENDER
      process.env.FACTURAPI_MODE = 'invalido'
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { modoActivo } = require('../src/lib/facturapi')
      assert.equal(modoActivo(), 'test')
    })
  })

  // ── P0-C: assertLivemodeConsistente ──
  describe('assertLivemodeConsistente — livemode guard', () => {
    it('throws FACTURAPI_TEST_MODE_BLOCKED when live mode + invoice livemode=false', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.FACTURAPI_MODE
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { assertLivemodeConsistente, FiscalError } = require('../src/lib/facturapi')
      assert.throws(
        () => assertLivemodeConsistente({ livemode: false }, { facturaId: 99 }),
        (err) => {
          assert.ok(err instanceof FiscalError)
          assert.equal(err.code, 'FACTURAPI_TEST_MODE_BLOCKED')
          assert.equal(err.status, 422)
          return true
        }
      )
    })

    it('does NOT throw when live mode + invoice livemode=true', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.FACTURAPI_MODE
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { assertLivemodeConsistente } = require('../src/lib/facturapi')
      assert.doesNotThrow(() => assertLivemodeConsistente({ livemode: true }, { facturaId: 1 }))
    })

    it('does NOT throw when test mode + invoice livemode=false', () => {
      delete process.env.NODE_ENV
      delete process.env.RENDER
      delete process.env.FACTURAPI_MODE
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { assertLivemodeConsistente } = require('../src/lib/facturapi')
      assert.doesNotThrow(() => assertLivemodeConsistente({ livemode: false }, { facturaId: 1 }))
    })

    it('does NOT throw when invoice has no livemode field', () => {
      process.env.NODE_ENV = 'production'
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { assertLivemodeConsistente } = require('../src/lib/facturapi')
      assert.doesNotThrow(() => assertLivemodeConsistente({ id: 'abc' }, { facturaId: 1 }))
    })

    it('does NOT throw when invoice is null', () => {
      process.env.NODE_ENV = 'production'
      delete require.cache[require.resolve('../src/lib/facturapi')]
      const { assertLivemodeConsistente } = require('../src/lib/facturapi')
      assert.doesNotThrow(() => assertLivemodeConsistente(null))
    })
  })

  // ── P0-E: derivarEstadoFiscal live key check ──
  describe('derivarEstadoFiscal — live key availability', () => {
    it('returns CONFIGURANDO when org exists but no live key', () => {
      const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
      const config = {
        facturapiOrganizationId: 'org_123',
        isProductionReady: true,
        facturapiLiveKeyEnc: null,
        facturapiTestKeyEnc: 'encrypted_test_key'
      }
      assert.equal(derivarEstadoFiscal(config), 'CONFIGURANDO')
    })

    it('returns LISTA when org + isProductionReady + live key present', () => {
      const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
      const config = {
        facturapiOrganizationId: 'org_123',
        isProductionReady: true,
        facturapiLiveKeyEnc: 'encrypted_live_key',
        facturapiTestKeyEnc: 'encrypted_test_key'
      }
      assert.equal(derivarEstadoFiscal(config), 'LISTA')
    })

    it('returns CONFIGURANDO when org exists but isProductionReady=false', () => {
      const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
      const config = {
        facturapiOrganizationId: 'org_123',
        isProductionReady: false,
        facturapiLiveKeyEnc: 'encrypted_live_key',
        facturapiTestKeyEnc: 'encrypted_test_key'
      }
      assert.equal(derivarEstadoFiscal(config), 'CONFIGURANDO')
    })

    it('returns NO_CONFIGURADA when config is null', () => {
      const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
      assert.equal(derivarEstadoFiscal(null), 'NO_CONFIGURADA')
    })

    it('returns NO_CONFIGURADA when no organization', () => {
      const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
      const config = {
        facturapiOrganizationId: null,
        isProductionReady: false,
        facturapiLiveKeyEnc: null
      }
      assert.equal(derivarEstadoFiscal(config), 'NO_CONFIGURADA')
    })
  })

  // ── Source-level wiring verification ──
  describe('Wiring — source-level verification', () => {
    it('solicitarFactura imports assertLivemodeConsistente', () => {
      const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../src/modules/facturacion/facturacion.controller.js'),
        'utf8'
      )
      assert.ok(src.includes('assertLivemodeConsistente'), 'facturacion.controller must import assertLivemodeConsistente')
      assert.ok(src.includes('assertLivemodeConsistente(invoice'), 'facturacion.controller must call assertLivemodeConsistente after invoices.create')
    })

    it('timbrarGlobal imports assertLivemodeConsistente', () => {
      const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../src/modules/facturas/facturas.controller.js'),
        'utf8'
      )
      assert.ok(src.includes('assertLivemodeConsistente'), 'facturas.controller must import assertLivemodeConsistente')
      assert.ok(src.includes('assertLivemodeConsistente(invoice'), 'facturas.controller must call assertLivemodeConsistente after invoices.create')
    })

    it('facturapi.js exports persistirLiveKeyDeEntorno', () => {
      const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../src/lib/facturapi.js'),
        'utf8'
      )
      assert.ok(src.includes('persistirLiveKeyDeEntorno'), 'facturapi.js must export persistirLiveKeyDeEntorno')
      assert.ok(src.includes('FACTURAPI_LIVE_KEY_MISSING'), 'facturapi.js must throw FACTURAPI_LIVE_KEY_MISSING when live key is missing')
    })

    it('estado-fiscal.helper.js checks facturapiLiveKeyEnc', () => {
      const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../src/helpers/estado-fiscal.helper.js'),
        'utf8'
      )
      assert.ok(src.includes('facturapiLiveKeyEnc'), 'estado-fiscal.helper must check facturapiLiveKeyEnc')
    })

    it('routes.js has /persist-live-key endpoint', () => {
      const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../src/modules/configuracion-fiscal/configuracion-fiscal.routes.js'),
        'utf8'
      )
      assert.ok(src.includes("'/persist-live-key'"), 'routes must have /persist-live-key endpoint')
    })
  })
})
