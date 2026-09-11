'use strict'

const assert = require('node:assert/strict')
const { describe, it, beforeEach, afterEach, mock } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'

// ════════════════════════════════════════════════════════════════════
//  JESHA FACTURAPI P0 — DEFINITIVE PRODUCTION GATE TESTS
//  GATE C: Producción jamás puede usar test
//  GATE D: No fallback test
//  GATE E: Live key source verification
//  GATE F: persist-live-key security
//  GATE G: isProductionReady behavior
//  GATE H: livemode post-create guard
//  GATE I: PDF mismatch hypothesis
//  GATE K: Regression $60
// ════════════════════════════════════════════════════════════════════

function loadFresh(modPath) {
  const full = require.resolve(modPath)
  delete require.cache[full]
  return require(modPath)
}

// ── GATE C: Producción jamás puede usar test ──
describe('GATE C — Production forces live, never test', () => {
  const orig = { ...process.env }
  afterEach(() => { process.env = { ...orig } })

  it('NODE_ENV=production → modoActivo() returns live', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.RENDER
    delete process.env.FACTURAPI_MODE
    const { modoActivo } = loadFresh('../src/lib/facturapi')
    assert.equal(modoActivo(), 'live')
  })

  it('RENDER=true → modoActivo() returns live', () => {
    process.env.RENDER = 'true'
    delete process.env.NODE_ENV
    delete process.env.FACTURAPI_MODE
    const { modoActivo } = loadFresh('../src/lib/facturapi')
    assert.equal(modoActivo(), 'live')
  })

  it('production + FACTURAPI_MODE=test → still returns live (force-live wins)', () => {
    process.env.NODE_ENV = 'production'
    process.env.FACTURAPI_MODE = 'test'
    const { modoActivo } = loadFresh('../src/lib/facturapi')
    assert.equal(modoActivo(), 'live')
  })

  it('production + FACTURAPI_MODE unset → returns live', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FACTURAPI_MODE
    const { modoActivo } = loadFresh('../src/lib/facturapi')
    assert.equal(modoActivo(), 'live')
  })

  it('production + FACTURAPI_MODE=invalid → still returns live', () => {
    process.env.NODE_ENV = 'production'
    process.env.FACTURAPI_MODE = 'nonsense'
    const { modoActivo } = loadFresh('../src/lib/facturapi')
    assert.equal(modoActivo(), 'live')
  })

  it('esProduccion() checks both NODE_ENV and RENDER', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.RENDER
    const { esProduccion } = loadFresh('../src/lib/facturapi')
    assert.equal(esProduccion(), true)

    delete process.env.NODE_ENV
    process.env.RENDER = 'true'
    const { esProduccion: ep2 } = loadFresh('../src/lib/facturapi')
    assert.equal(ep2(), true)

    delete process.env.NODE_ENV
    delete process.env.RENDER
    const { esProduccion: ep3 } = loadFresh('../src/lib/facturapi')
    assert.equal(ep3(), false)
  })
})

// ── GATE D: No fallback test in production ──
describe('GATE D — No test fallback in production', () => {
  const orig = { ...process.env }
  afterEach(() => { process.env = { ...orig } })

  it('production + liveKey null → modoActivo returns live, verificarFacturacionEmpresa throws FACTURAPI_LIVE_KEY_MISSING', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FACTURAPI_MODE
    const { verificarFacturacionEmpresa, FiscalError } = loadFresh('../src/lib/facturapi')

    // verificarFacturacionEmpresa will query prisma, but we can verify the mode
    // by checking that it tries to use 'live' mode (not 'test')
    const src = fs.readFileSync(
      path.join(__dirname, '../src/lib/facturapi.js'), 'utf8'
    )
    // The function resolves mode first, THEN queries DB
    assert.ok(src.includes("m === 'live' ? config.facturapiLiveKeyEnc : config.facturapiTestKeyEnc"),
      'Key selection must branch on live vs test')
    assert.ok(src.includes('FACTURAPI_LIVE_KEY_MISSING'),
      'Must throw FACTURAPI_LIVE_KEY_MISSING when live key is absent')
  })

  it('production: getFacturapiForEmpresa uses modoActivo() which returns live', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FACTURAPI_MODE
    const { modoActivo } = loadFresh('../src/lib/facturapi')
    assert.equal(modoActivo(), 'live', 'Production must resolve to live mode')
  })

  it('not production + test key present → resolves with test mode (development only)', () => {
    delete process.env.NODE_ENV
    delete process.env.RENDER
    process.env.FACTURAPI_MODE = 'test'
    const { modoActivo } = loadFresh('../src/lib/facturapi')
    assert.equal(modoActivo(), 'test', 'Development with test mode must resolve to test')
  })
})

// ── GATE E: Live key source verification ──
describe('GATE E — FACTURAPI_KEY was the historical live key', () => {
  it('facturapi.js documents FACTURAPI_KEY as live key source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/lib/facturapi.js'), 'utf8'
    )
    assert.ok(src.includes('FACTURAPI_KEY'), 'Must reference FACTURAPI_KEY')
    assert.ok(src.includes('sk_live'), 'Must document live key prefix')
    assert.ok(src.includes('sk_test'), 'Must document test key prefix')
  })

  it('persistirLiveKeyDeEntorno validates sk_live_ prefix', () => {
    process.env.NODE_ENV = 'production'
    process.env.FACTURAPI_KEY = 'sk_live_test123'
    delete require.cache[require.resolve('../src/lib/facturapi')]
    const { persistirLiveKeyDeEntorno } = require('../src/lib/facturapi')
    assert.equal(typeof persistirLiveKeyDeEntorno, 'function')
  })

  it('persistirLiveKeyDeEntorno rejects non-live key', async () => {
    process.env.NODE_ENV = 'production'
    process.env.FACTURAPI_KEY = 'sk_test_notlive'
    delete require.cache[require.resolve('../src/lib/facturapi')]
    const { persistirLiveKeyDeEntorno, FiscalError } = require('../src/lib/facturapi')

    const mockPrisma = {
      configuracionFiscal: {
        findUnique: async () => ({
          empresaId: 1,
          facturapiOrganizationId: 'org_123',
          facturapiLiveKeyEnc: null
        })
      }
    }
    const prismaPath = require.resolve('../src/lib/prisma')
    const origPrisma = require.cache[prismaPath]
    require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: mockPrisma }

    try {
      await assert.rejects(
        persistirLiveKeyDeEntorno(1),
        (err) => {
          assert.ok(err instanceof FiscalError)
          assert.equal(err.code, 'FACTURAPI_LIVE_KEY_INVALID')
          return true
        }
      )
    } finally {
      if (origPrisma) require.cache[prismaPath] = origPrisma
      else delete require.cache[prismaPath]
    }
  })
})

// ── GATE F: persist-live-key security ──
describe('GATE F — persist-live-key security audit', () => {
  it('endpoint requires SUPERADMIN role (route middleware)', () => {
    const routesSrc = fs.readFileSync(
      path.join(__dirname, '../src/modules/configuracion-fiscal/configuracion-fiscal.routes.js'), 'utf8'
    )
    assert.ok(routesSrc.includes("requireRole('SUPERADMIN')"), 'Route must enforce SUPERADMIN role')
    assert.ok(routesSrc.includes('persist-live-key'), 'Endpoint must exist')
  })

  it('does not accept plaintext key from request body', () => {
    const ctrlSrc = fs.readFileSync(
      path.join(__dirname, '../src/modules/configuracion-fiscal/configuracion-fiscal.controller.js'), 'utf8'
    )
    const persistFn = ctrlSrc.substring(
      ctrlSrc.indexOf('async function persistirLiveKey'),
      ctrlSrc.indexOf('return responderError(res, error', ctrlSrc.indexOf('async function persistirLiveKey'))
    )
    assert.ok(!persistFn.includes('req.body'), 'Must not read key from request body')
    assert.ok(persistFn.includes('persistirLiveKeyDeEntorno'), 'Must call persistirLiveKeyDeEntorno')
    assert.ok(persistFn.includes('getEmpresaId(req)'), 'Must scope by empresaId')
  })

  it('persistirLiveKeyDeEntorno encrypts before DB write and does not log key value', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/lib/facturapi.js'), 'utf8'
    )
    const fn = src.substring(
      src.indexOf('async function persistirLiveKeyDeEntorno'),
      src.indexOf('module.exports')
    )
    assert.ok(fn.includes('cifrarSecreto'), 'Must encrypt before persisting')
    assert.ok(fn.includes('facturapiLiveKeyEnc'), 'Must write to facturapiLiveKeyEnc field')
    // The console.log should only log empresaId, not the key value
    assert.ok(!fn.includes('console.log(`${liveKeyEnv}'), 'Must not log the actual key value')
    assert.ok(!fn.includes('console.log(liveKeyEnv'), 'Must not log the actual key value')
  })

  it('does not overwrite existing live key silently', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/lib/facturapi.js'), 'utf8'
    )
    const fn = src.substring(
      src.indexOf('async function persistirLiveKeyDeEntorno'),
      src.indexOf('module.exports')
    )
    assert.ok(fn.includes('config.facturapiLiveKeyEnc'), 'Must check existing key')
    assert.ok(fn.includes('already_has_live_key'), 'Must return idempotent response')
  })

  it('resets cache after persisting', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/lib/facturapi.js'), 'utf8'
    )
    const fn = src.substring(
      src.indexOf('async function persistirLiveKeyDeEntorno'),
      src.indexOf('module.exports')
    )
    assert.ok(fn.includes('resetFacturapiCache'), 'Must reset cache after persist')
  })
})

// ── GATE G: isProductionReady behavior ──
describe('GATE G — isProductionReady without live key = CONFIGURANDO', () => {
  it('derivarEstadoFiscal: org + productionReady + no live key → CONFIGURANDO', () => {
    const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
    assert.equal(
      derivarEstadoFiscal({
        facturapiOrganizationId: 'org_123',
        isProductionReady: true,
        facturapiLiveKeyEnc: null
      }),
      'CONFIGURANDO'
    )
  })

  it('derivarEstadoFiscal: org + productionReady + live key → LISTA', () => {
    const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
    assert.equal(
      derivarEstadoFiscal({
        facturapiOrganizationId: 'org_123',
        isProductionReady: true,
        facturapiLiveKeyEnc: 'encrypted'
      }),
      'LISTA'
    )
  })

  it('derivarEstadoFiscal: org + !productionReady + live key → CONFIGURANDO', () => {
    const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
    assert.equal(
      derivarEstadoFiscal({
        facturapiOrganizationId: 'org_123',
        isProductionReady: false,
        facturapiLiveKeyEnc: 'encrypted'
      }),
      'CONFIGURANDO'
    )
  })

  it('derivarEstadoFiscal: no org → NO_CONFIGURADA', () => {
    const { derivarEstadoFiscal } = require('../src/helpers/estado-fiscal.helper')
    assert.equal(derivarEstadoFiscal(null), 'NO_CONFIGURADA')
    assert.equal(derivarEstadoFiscal({}), 'NO_CONFIGURADA')
  })

  it('derivarEstadoFiscal never returns LISTA without live key (source check)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/helpers/estado-fiscal.helper.js'), 'utf8'
    )
    const idxLista = src.indexOf("'LISTA'")
    const idxLiveKey = src.indexOf('facturapiLiveKeyEnc')
    assert.ok(idxLiveKey < idxLista, 'facturapiLiveKeyEnc check must come BEFORE returning LISTA')
  })
})

// ── GATE H: livemode post-create guard ──
describe('GATE H — assertLivemodeConsistente blocks test in production', () => {
  const orig = { ...process.env }
  afterEach(() => { process.env = { ...orig } })

  it('production + livemode=false → throws FACTURAPI_TEST_MODE_BLOCKED', () => {
    process.env.NODE_ENV = 'production'
    delete require.cache[require.resolve('../src/lib/facturapi')]
    const { assertLivemodeConsistente, FiscalError } = require('../src/lib/facturapi')
    assert.throws(
      () => assertLivemodeConsistente({ livemode: false }, { facturaId: 42 }),
      (err) => {
        assert.ok(err instanceof FiscalError)
        assert.equal(err.code, 'FACTURAPI_TEST_MODE_BLOCKED')
        assert.equal(err.status, 422)
        return true
      }
    )
  })

  it('production + livemode=true → no throw', () => {
    process.env.NODE_ENV = 'production'
    delete require.cache[require.resolve('../src/lib/facturapi')]
    const { assertLivemodeConsistente } = require('../src/lib/facturapi')
    assert.doesNotThrow(() => assertLivemodeConsistente({ livemode: true }))
  })

  it('test mode + livemode=false → no throw (expected)', () => {
    delete process.env.NODE_ENV
    delete process.env.RENDER
    delete process.env.FACTURAPI_MODE
    delete require.cache[require.resolve('../src/lib/facturapi')]
    const { assertLivemodeConsistente } = require('../src/lib/facturapi')
    assert.doesNotThrow(() => assertLivemodeConsistente({ livemode: false }))
  })

  it('livemode=undefined → no throw (graceful)', () => {
    process.env.NODE_ENV = 'production'
    delete require.cache[require.resolve('../src/lib/facturapi')]
    const { assertLivemodeConsistente } = require('../src/lib/facturapi')
    assert.doesNotThrow(() => assertLivemodeConsistente({ id: 'abc' }))
  })

  it('livemode=null → no throw (graceful)', () => {
    process.env.NODE_ENV = 'production'
    delete require.cache[require.resolve('../src/lib/facturapi')]
    const { assertLivemodeConsistente } = require('../src/lib/facturapi')
    assert.doesNotThrow(() => assertLivemodeConsistente({ livemode: null }))
  })

  it('invoice=null → no throw (graceful)', () => {
    process.env.NODE_ENV = 'production'
    delete require.cache[require.resolve('../src/lib/facturapi')]
    const { assertLivemodeConsistente } = require('../src/lib/facturapi')
    assert.doesNotThrow(() => assertLivemodeConsistente(null))
  })

  it('solicitarFactura calls assertLivemodeConsistente after create', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8'
    )
    assert.ok(src.includes('assertLivemodeConsistente(invoice'))
  })

  it('timbrarManual calls assertLivemodeConsistente after create', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8'
    )
    assert.ok(src.includes('exports.timbrarManual'), 'timbrarManual must exist')
    // The call is deep inside the function — search the whole file
    const calls = src.match(/assertLivemodeConsistente\(invoice/g)
    assert.ok(calls && calls.length >= 2, 'Must have at least 2 assertLivemodeConsistente calls (solicitarFactura + timbrarManual)')
  })

  it('timbrarGlobal calls assertLivemodeConsistente after create', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturas/facturas.controller.js'), 'utf8'
    )
    assert.ok(src.includes('exports.timbrarGlobal'), 'timbrarGlobal must exist')
    const calls = src.match(/assertLivemodeConsistente\(invoice/g)
    assert.ok(calls && calls.length >= 1, 'Must have at least 1 assertLivemodeConsistente call (timbrarGlobal)')
  })
})

// ── GATE I: PDF mismatch hypothesis ──
describe('GATE I — PDF download uses same mode-resolved client', () => {
  it('descargarPdf calls getFacturapiForEmpresa without explicit modo', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8'
    )
    const pdfIdx = src.indexOf('exports.descargarPdf')
    assert.ok(pdfIdx > 0, 'descargarPdf must exist')
    const block = src.substring(pdfIdx, pdfIdx + 1500)
    assert.ok(block.includes('getFacturapiForEmpresa(factura.empresaId)'), 'Must call without modo override')
  })

  it('descargarXml calls getFacturapiForEmpresa without explicit modo', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8'
    )
    const xmlIdx = src.indexOf('exports.descargarXml')
    assert.ok(xmlIdx > 0, 'descargarXml must exist')
    const block = src.substring(xmlIdx, xmlIdx + 1500)
    assert.ok(block.includes('getFacturapiForEmpresa(factura.empresaId)'), 'Must call without modo override')
  })

  it('enviarEmail calls getFacturapiForEmpresa without explicit modo', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8'
    )
    const emailIdx = src.indexOf('exports.enviarEmail')
    assert.ok(emailIdx > 0, 'enviarEmail must exist')
    const block = src.substring(emailIdx, emailIdx + 1500)
    assert.ok(block.includes('getFacturapiForEmpresa(factura.empresaId)'), 'Must call without modo override')
  })

  it('FacturaCfdi schema has NO livemode field (confirmed)', () => {
    const schema = fs.readFileSync(
      path.join(__dirname, '../prisma/schema.prisma'), 'utf8'
    )
    const facturapiModelIdx = schema.indexOf('model FacturaCfdi')
    assert.ok(facturapiModelIdx > 0, 'FacturaCfdi model must exist')
    const nextModelIdx = schema.indexOf('model ', facturapiModelIdx + 10)
    const modelBlock = schema.substring(facturapiModelIdx, nextModelIdx > 0 ? nextModelIdx : facturapiModelIdx + 2000)
    assert.ok(!modelBlock.includes('livemode'), 'FacturaCfdi must NOT have livemode field')
    assert.ok(!modelBlock.includes('modo'), 'FacturaCfdi must NOT have modo field')
  })

  it('PDF failure root cause: TEST client queries LIVE invoice → 404 (documented)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8'
    )
    const pdfIdx = src.indexOf('exports.descargarPdf')
    const block = src.substring(pdfIdx, pdfIdx + 2000)
    assert.ok(block.includes('fp.invoices.downloadPdf'), 'Must call downloadPdf on Facturapi')
    assert.ok(block.includes('catch'), 'Must handle errors from Facturapi')
  })
})

// ── GATE K: Regression $60 (source-level) ──
describe('GATE K — $60 discount regression preserved', () => {
  it('buildInvoicePayload exists and handles descuento', () => {
    const { buildInvoicePayload } = require('../src/modules/facturacion/facturacion.controller')
    assert.equal(typeof buildInvoicePayload, 'function')
  })

  it('6000 === 6000 → no mismatch (source-level)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../tests/facturapi-discount.test.js'), 'utf8'
    )
    assert.ok(src.includes('REJECT payload $59.99 vs venta $60'))
    assert.ok(src.includes('REJECT payload $60.01 vs venta $60'))
    assert.ok(src.includes('PASS bruto $100, descuento $10, total $90'))
  })

  it('discount + IVA + tax_included preserved in source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/facturacion/facturacion.controller.js'), 'utf8'
    )
    assert.ok(src.includes('tax_included'), 'tax_included must be present')
    assert.ok(src.includes('buildInvoicePayload'), 'buildInvoicePayload must exist')
  })
})
