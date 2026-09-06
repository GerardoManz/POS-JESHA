'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { cifrarSecreto, descifrarSecreto } = require('../src/lib/fiscal-secrets')
const facturapi = require('../src/lib/facturapi')
const { crearConfiguracionFiscalController } = require('../src/modules/configuracion-fiscal/configuracion-fiscal.controller')

const MASTER_A = Buffer.alloc(32, 0x11).toString('base64')
const LEGACY_KEY = 'sk_test_jesha_org_existente_12345'
const ORG_ID = 'org_jesha_legacy_001'
const EMPRESA_RFC = 'VADU820305J97'
const originalEnv = {}

function rememberEnv (...names) {
  for (const name of names) originalEnv[name] = process.env[name]
}

function restoreEnv (...names) {
  for (const name of names) {
    if (originalEnv[name] === undefined) delete process.env[name]
    else process.env[name] = originalEnv[name]
  }
}

function buildFakeAdmin () {
  return {
    crearOrganization: async () => { throw new Error('createOrganization must NOT be called') },
    actualizarDatosLegales: async () => { throw new Error('actualizarDatosLegales must NOT be called') },
    obtenerTestKey: async () => { throw new Error('obtenerTestKey must NOT be called') },
    crearLiveKey: async () => { throw new Error('crearLiveKey must NOT be called') },
    subirCsd: async () => { throw new Error('subirCsd must NOT be called') }
  }
}

function buildRes () {
  let statusCode = null
  let jsonBody = null
  const res = {
    status (code) { statusCode = code; return res },
    json (body) { jsonBody = body; return res }
  }
  return {
    res,
    getStatus: () => statusCode,
    getBody: () => jsonBody
  }
}

function buildReq (empresaId = 1) {
  return {
    usuario: { id: 1, empresaId, rol: 'SUPERADMIN', sucursalId: null },
    context: {
      version: 1,
      kind: 'TENANT',
      actor: { id: 1, rol: 'SUPERADMIN' },
      tenant: { empresaId },
      branch: { mode: 'NONE', sucursalId: null }
    },
    body: {},
    ip: '127.0.0.1'
  }
}

function buildPrisma (overrides = {}) {
  const empresaRow = overrides.empresaRow || { id: 1, nombreComercial: 'JESHA', razonSocial: 'JESHA SA', rfc: EMPRESA_RFC, ConfiguracionFiscal: null }
  const configRow = overrides.configRow !== undefined ? overrides.configRow : null
  let createData = null

  const txPrisma = {
    $queryRaw: async () => '1',
    configuracionFiscal: {
      findUnique: async () => configRow,
      create: async ({ data }) => { createData = data; return data },
      update: overrides.updateFn || (async () => { throw new Error('must NOT update') })
    },
    empresa: {
      findUnique: async () => empresaRow
    }
  }

  const prisma = {
    configuracionFiscal: txPrisma.configuracionFiscal,
    empresa: txPrisma.empresa,
    auditoria: { create: async () => ({}) },
    $queryRaw: async () => '1',
    $transaction: async (fn) => fn(txPrisma),
    _getCreated: () => createData
  }
  return prisma
}

describe('P1 fiscal: reconcile legacy organization', { concurrency: 1 }, () => {
  beforeEach(() => {
    rememberEnv('FISCAL_SECRETS_MASTER_KEY', 'FACTURAPI_KEY_TEST', 'FACTURAPI_MODE')
    process.env.FISCAL_SECRETS_MASTER_KEY = MASTER_A
    process.env.FACTURAPI_KEY_TEST = LEGACY_KEY
    process.env.FACTURAPI_MODE = 'test'
    facturapi.resetFacturapiCache()
  })

  afterEach(() => {
    facturapi.setFacturapiFactory(null)
    restoreEnv('FISCAL_SECRETS_MASTER_KEY', 'FACTURAPI_KEY_TEST', 'FACTURAPI_MODE')
  })

  it('happy path: vincula Organization existente sin crear nueva', async () => {
    const remoteOrg = { id: ORG_ID, legal: { tax_id: EMPRESA_RFC }, is_production_ready: false, pending_steps: ['certificate'] }
    const fakeSdk = () => ({ organizations: { me: async () => remoteOrg } })
    const prisma = buildPrisma()

    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: fakeSdk
    })

    const resBuilder = buildRes()
    await controller.reconcile(buildReq(1), resBuilder.res)

    assert.equal(resBuilder.getStatus(), 200)
    const body = resBuilder.getBody()
    assert.equal(body.reconciled, true)
    assert.equal(body.organizationId, ORG_ID)
    const created = prisma._getCreated()
    assert.ok(created, 'ConfiguracionFiscal must have been created')
    assert.equal(created.facturapiOrganizationId, ORG_ID)
    assert.ok(created.facturapiTestKeyEnc, 'test key must be encrypted')
    assert.notEqual(created.facturapiTestKeyEnc, LEGACY_KEY, 'must NOT store plaintext key')
    const decrypted = descifrarSecreto(created.facturapiTestKeyEnc)
    assert.equal(decrypted, LEGACY_KEY)
  })

  it('idempotente: segunda llamada detecta Organization ya vinculada', async () => {
    const configRow = { facturapiOrganizationId: ORG_ID, facturapiTestKeyEnc: cifrarSecreto(LEGACY_KEY) }
    let sdkCallCount = 0
    const fakeSdk = () => ({
      organizations: {
        me: async () => { sdkCallCount++; return { id: ORG_ID, legal: { tax_id: EMPRESA_RFC } } }
      }
    })
    const prisma = buildPrisma({ configRow })

    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: fakeSdk
    })

    const resBuilder = buildRes()
    await controller.reconcile(buildReq(1), resBuilder.res)

    assert.equal(resBuilder.getStatus(), 200)
    assert.equal(resBuilder.getBody().reconciled, false)
    assert.equal(resBuilder.getBody().organizationId, ORG_ID)
    assert.equal(sdkCallCount, 0, 'must NOT call organizations.me() when already linked')
  })

  it('sin FACTURAPI_KEY_TEST devuelve 409', async () => {
    delete process.env.FACTURAPI_KEY_TEST
    const prisma = buildPrisma()
    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: () => ({ organizations: { me: async () => assert.fail('must NOT call') } })
    })

    const resBuilder = buildRes()
    await controller.reconcile(buildReq(1), resBuilder.res)
    assert.equal(resBuilder.getStatus(), 409)
    assert.equal(resBuilder.getBody().code, 'FISCAL_NO_LEGACY_KEY')
  })

  it('sin FISCAL_SECRETS_MASTER_KEY devuelve 500', async () => {
    delete process.env.FISCAL_SECRETS_MASTER_KEY
    const controller = crearConfiguracionFiscalController({
      prisma: buildPrisma(),
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => { throw new Error('FISCAL_SECRETS_MASTER_KEY no configurada') },
      facturapiSdk: () => ({ organizations: { me: async () => assert.fail('must NOT call') } })
    })

    const resBuilder = buildRes()
    await controller.reconcile(buildReq(1), resBuilder.res)
    assert.equal(resBuilder.getStatus(), 500)
  })

  it('RFC mismatch devuelve 409', async () => {
    const empresaRow = { id: 1, nombreComercial: 'JESHA', razonSocial: 'JESHA SA', rfc: 'OTRO_RFC_123', ConfiguracionFiscal: null }
    const remoteOrg = { id: ORG_ID, legal: { tax_id: EMPRESA_RFC } }
    const fakeSdk = () => ({ organizations: { me: async () => remoteOrg } })
    const prisma = buildPrisma({ empresaRow })

    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: fakeSdk
    })

    const resBuilder = buildRes()
    await controller.reconcile(buildReq(1), resBuilder.res)
    assert.equal(resBuilder.getStatus(), 409)
    assert.equal(resBuilder.getBody().code, 'FISCAL_RFC_MISMATCH')
  })

  it('organizations.me() failure devuelve 502', async () => {
    const fakeSdk = () => ({
      organizations: { me: async () => { throw new Error('Facturapi API unreachable') } }
    })
    const prisma = buildPrisma()

    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: fakeSdk
    })

    const resBuilder = buildRes()
    await controller.reconcile(buildReq(1), resBuilder.res)
    assert.equal(resBuilder.getStatus(), 502)
  })

  it('no llama createOrganization bajo ninguna circunstancia', async () => {
    const remoteOrg = { id: ORG_ID, legal: { tax_id: EMPRESA_RFC } }
    let createOrgCalls = 0
    const prisma = buildPrisma()

    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: {
        crearOrganization: async () => { createOrgCalls++; throw new Error('MUST NOT CREATE') },
        actualizarDatosLegales: async () => { throw new Error('MUST NOT UPDATE') },
        obtenerTestKey: async () => { throw new Error('MUST NOT GET KEY') },
        crearLiveKey: async () => { throw new Error('MUST NOT CREATE LIVE') },
        subirCsd: async () => { throw new Error('MUST NOT UPLOAD CSD') }
      },
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: () => ({ organizations: { me: async () => remoteOrg } })
    })

    const resBuilder = buildRes()
    await controller.reconcile(buildReq(1), resBuilder.res)
    assert.equal(resBuilder.getStatus(), 200)
    assert.equal(createOrgCalls, 0, 'createOrganization must NEVER be called during reconcile')
  })

  it('partial failure recovery: segundo intento puede recuperar', async () => {
    const remoteOrg = { id: ORG_ID, legal: { tax_id: EMPRESA_RFC } }
    let createFails = true
    const empresaRow = { id: 1, nombreComercial: 'JESHA', razonSocial: 'JESHA SA', rfc: EMPRESA_RFC, ConfiguracionFiscal: null }

    const prisma = {
      configuracionFiscal: {
        findUnique: async () => null,
        create: async ({ data }) => {
          if (createFails) throw new Error('DB write failed')
          return data
        },
        update: async () => { throw new Error('must NOT update') }
      },
      empresa: { findUnique: async () => empresaRow },
      auditoria: { create: async () => ({}) },
      $queryRaw: async () => '1',
      $transaction: async (fn) => fn({
        $queryRaw: async () => '1',
        configuracionFiscal: {
          findUnique: async () => null,
          create: async ({ data }) => {
            if (createFails) throw new Error('DB write failed')
            return data
          }
        },
        empresa: { findUnique: async () => empresaRow }
      })
    }

    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: () => ({ organizations: { me: async () => remoteOrg } })
    })

    const res1 = buildRes()
    await controller.reconcile(buildReq(1), res1.res)
    assert.equal(res1.getStatus(), 500, 'first attempt should fail')

    createFails = false
    const res2 = buildRes()
    await controller.reconcile(buildReq(1), res2.res)
    assert.equal(res2.getStatus(), 200)
    assert.equal(res2.getBody().reconciled, true)
    assert.equal(res2.getBody().organizationId, ORG_ID)
  })

  it('no expone la key legacy en la respuesta', async () => {
    const remoteOrg = { id: ORG_ID, legal: { tax_id: EMPRESA_RFC } }
    const prisma = buildPrisma()

    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: () => ({ organizations: { me: async () => remoteOrg } })
    })

    const resBuilder = buildRes()
    await controller.reconcile(buildReq(1), resBuilder.res)
    const serialized = JSON.stringify(resBuilder.getBody())
    assert.equal(serialized.includes(LEGACY_KEY), false, 'must NOT expose legacy key in response')
    assert.equal(serialized.includes('sk_test'), false, 'must NOT expose any sk_test prefix')
  })
})

describe('P1 fiscal: reconcile tenant isolation', { concurrency: 1 }, () => {
  beforeEach(() => {
    rememberEnv('FISCAL_SECRETS_MASTER_KEY', 'FACTURAPI_KEY_TEST', 'FACTURAPI_MODE')
    process.env.FISCAL_SECRETS_MASTER_KEY = MASTER_A
    process.env.FACTURAPI_KEY_TEST = LEGACY_KEY
    process.env.FACTURAPI_MODE = 'test'
    facturapi.resetFacturapiCache()
  })

  afterEach(() => {
    facturapi.setFacturapiFactory(null)
    restoreEnv('FISCAL_SECRETS_MASTER_KEY', 'FACTURAPI_KEY_TEST', 'FACTURAPI_MODE')
  })

  it('Empresa 1 reconcile no puede modificar ConfiguracionFiscal de Empresa 2', async () => {
    const configs = new Map([
      [1, { regimenFiscal: '601', codigoPostalFiscal: '98660' }],
      [2, { regimenFiscal: '601', codigoPostalFiscal: '06000' }]
    ])
    const empresaRows = new Map([
      [1, { id: 1, nombreComercial: 'JESHA', razonSocial: 'JESHA SA', rfc: EMPRESA_RFC, ConfiguracionFiscal: { regimenFiscal: '601', codigoPostalFiscal: '98660' } }],
      [2, { id: 2, nombreComercial: 'Pedregal', razonSocial: 'PEDREGAL SA', rfc: 'AAA010101AAA', ConfiguracionFiscal: { regimenFiscal: '601', codigoPostalFiscal: '06000' } }]
    ])

    let currentOrg = { id: 'org_jesha', legal: { tax_id: EMPRESA_RFC } }

    const prisma = {
      configuracionFiscal: {
        findUnique: async ({ where }) => configs.get(where.empresaId) || null,
        create: async ({ data }) => { configs.set(data.empresaId, data); return data },
        update: async ({ where, data }) => { configs.set(where.empresaId, { ...configs.get(where.empresaId), ...data }); return data }
      },
      empresa: {
        findUnique: async ({ where }) => empresaRows.get(where.id) || null
      },
      auditoria: {
        create: async () => ({})
      },
      $queryRaw: async () => '1',
      $transaction: async (fn) => {
        const tx = {
          $queryRaw: async () => '1',
          configuracionFiscal: {
            findUnique: async ({ where }) => configs.get(where.empresaId) || null,
            create: async ({ data }) => { configs.set(data.empresaId, data); return data },
            update: async ({ where, data }) => { configs.set(where.empresaId, { ...configs.get(where.empresaId), ...data }); return data }
          },
          empresa: {
            findUnique: async ({ where }) => empresaRows.get(where.id) || null
          }
        }
        return fn(tx)
      }
    }

    const controller = crearConfiguracionFiscalController({
      prisma,
      facturapiAdmin: buildFakeAdmin(),
      cifrarSecreto,
      obtenerMasterKey: () => Buffer.from(MASTER_A, 'base64'),
      facturapiSdk: () => ({ organizations: { me: async () => currentOrg } })
    })

    const res1 = buildRes()
    await controller.reconcile(buildReq(1), res1.res)
    assert.equal(res1.getStatus(), 200)
    assert.equal(res1.getBody().organizationId, 'org_jesha')

    currentOrg = { id: 'org_pedregal', legal: { tax_id: 'AAA010101AAA' } }
    const res2 = buildRes()
    await controller.reconcile(buildReq(2), res2.res)
    assert.equal(res2.getStatus(), 200)
    assert.equal(res2.getBody().organizationId, 'org_pedregal')

    assert.notEqual(configs.get(1).facturapiOrganizationId, configs.get(2).facturapiOrganizationId, 'organizations must be different per empresa')
  })
})
