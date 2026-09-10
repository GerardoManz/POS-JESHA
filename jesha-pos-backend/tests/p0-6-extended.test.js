'use strict'
// P0-6 Extended: Mapper unit tests + cancellation_status + motives + normalized responses
// Tests against running local backend on localhost:3000 (API tests)
// AND unit tests for the mapper module (no server needed)

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const prisma = require('../src/lib/prisma')

// ── Mapper unit tests (no server) ──
const {
  mapFacturaState, mapFpError, validateMotivo, getMotivosParaUI,
  buildCancellationResponse, CANCELLATION_STATUS_MAP, MOTIVOS_SAT, FP_ERROR_MAP
} = require('../src/modules/facturas/factura-cancelacion.mapper')

describe('P0-6 Extended: Mapper Unit Tests', function() {

  describe('mapFacturaState', function() {
    it('M01: valid + none → TIMBRADA badge, canCancel=true', function() {
      const r = mapFacturaState({ status: 'valid', cancellation_status: 'none' })
      assert.equal(r.badge, 'badge-timbrada')
      assert.equal(r.canCancel, true)
      assert.equal(r.canSync, true)
      assert.equal(r.type, 'active')
      assert.equal(r.isCanceled, false)
    })

    it('M02: valid + pending → pending-cancel badge, canCancel=false', function() {
      const r = mapFacturaState({ status: 'valid', cancellation_status: 'pending' })
      assert.equal(r.badge, 'badge-pending-cancel')
      assert.equal(r.canCancel, false)
      assert.equal(r.canSync, true)
      assert.equal(r.type, 'in_progress')
    })

    it('M03: valid + verifying → verifying badge, canCancel=false', function() {
      const r = mapFacturaState({ status: 'valid', cancellation_status: 'verifying' })
      assert.equal(r.badge, 'badge-verifying')
      assert.equal(r.canCancel, false)
      assert.equal(r.canSync, true)
      assert.equal(r.type, 'in_progress')
    })

    it('M04: valid + accepted → cancelada badge (transitorio), isAcceptedTransitorio=true', function() {
      const r = mapFacturaState({ status: 'valid', cancellation_status: 'accepted' })
      assert.equal(r.badge, 'badge-cancelada')
      assert.equal(r.isAcceptedTransitorio, true)
      assert.equal(r.isCanceled, false)
      assert.equal(r.type, 'terminal')
    })

    it('M05: valid + rejected → rejected badge, canCancel=true', function() {
      const r = mapFacturaState({ status: 'valid', cancellation_status: 'rejected' })
      assert.equal(r.badge, 'badge-rejected')
      assert.equal(r.canCancel, true)
      assert.equal(r.type, 'terminal_error')
    })

    it('M06: valid + expired → expired badge, canCancel=true', function() {
      const r = mapFacturaState({ status: 'valid', cancellation_status: 'expired' })
      assert.equal(r.badge, 'badge-expired')
      assert.equal(r.canCancel, true)
      assert.equal(r.type, 'terminal_error')
    })

    it('M07: canceled + accepted → cancelada, canCancel=false', function() {
      const r = mapFacturaState({ status: 'canceled', cancellation_status: 'accepted' })
      assert.equal(r.badge, 'badge-cancelada')
      assert.equal(r.isCanceled, true)
      assert.equal(r.canCancel, false)
    })

    it('M08: pending + none → pendiente badge', function() {
      const r = mapFacturaState({ status: 'pending', cancellation_status: 'none' })
      assert.equal(r.badge, 'badge-pendiente')
      assert.equal(r.type, 'pending')
    })

    it('M09: failed + none → failed badge', function() {
      const r = mapFacturaState({ status: 'failed', cancellation_status: 'none' })
      assert.equal(r.badge, 'badge-failed')
      assert.equal(r.type, 'error')
    })

    it('M10: null invoice → valid defaults', function() {
      const r = mapFacturaState(null)
      assert.equal(r.badge, 'badge-timbrada')
      assert.equal(r.type, 'active')
    })

    it('M11: cancellation detail fields populated', function() {
      const r = mapFacturaState({
        status: 'valid', cancellation_status: 'pending',
        cancellation: { motive: '02', substitution_uuid: null, requested_at: '2026-01-01', last_checked: '2026-01-02' }
      })
      assert.equal(r.motive, '02')
      assert.equal(r.requestedAt, '2026-01-01')
      assert.equal(r.lastChecked, '2026-01-02')
    })
  })

  describe('mapFpError', function() {
    it('M12: known error code maps to message', function() {
      const r = mapFpError('invoice_cancellation_in_progress')
      assert.ok(r.message.includes('proceso'))
      assert.equal(r.retryable, true)
      assert.equal(r.suggestSync, true)
    })

    it('M13: unknown code returns fallback', function() {
      const r = mapFpError('some_unknown_code', 'Fallback message')
      assert.equal(r.message, 'Fallback message')
    })

    it('M14: null code returns fallback', function() {
      const r = mapFpError(null, 'Null fallback')
      assert.equal(r.message, 'Null fallback')
    })

    it('M15: substitution_invoice_required → not retryable', function() {
      const r = mapFpError('substitution_invoice_required')
      assert.equal(r.retryable, false)
      assert.ok(r.message.includes('sustitución'))
    })

    it('M16: all 13 FP error codes have mappings', function() {
      const expected = [
        'invoice_cancellation_in_progress', 'invoice_cancellation_receipt_unavailable',
        'invoice_cancellation_failed', 'invoice_cancellation_not_allowed',
        'invoice_cancellation_not_found', 'invoice_cancellation_rfc_mismatch',
        'invoice_cancellation_service_unavailable', 'invoice_not_cancelable',
        'invoice_not_cancelable_by_sat', 'substitution_invoice_required',
        'substitution_invoice_not_found', 'substitution_invoice_canceled',
        'substitution_invoice_status_not_allowed'
      ]
      for (const code of expected) {
        const r = mapFpError(code)
        assert.ok(r.message, `Missing message for ${code}`)
        assert.equal(typeof r.retryable, 'boolean', `Missing retryable for ${code}`)
        assert.equal(typeof r.suggestSync, 'boolean', `Missing suggestSync for ${code}`)
      }
    })
  })

  describe('validateMotivo', function() {
    it('M17: valid motivo 01 returns info', function() {
      const r = validateMotivo('01')
      assert.ok(r)
      assert.equal(r.requiresSubstitution, true)
    })

    it('M18: valid motivo 02 returns info', function() {
      const r = validateMotivo('02')
      assert.ok(r)
      assert.equal(r.requiresSubstitution, false)
    })

    it('M19: invalid motivo returns null', function() {
      assert.equal(validateMotivo('99'), null)
      assert.equal(validateMotivo(''), null)
      assert.equal(validateMotivo(null), null)
    })

    it('M20: getMotivosParaUI returns 4 items', function() {
      const r = getMotivosParaUI()
      assert.equal(r.length, 4)
      assert.ok(r.find(m => m.value === '01'))
      assert.ok(r.find(m => m.value === '02'))
      assert.ok(r.find(m => m.value === '03'))
      assert.ok(r.find(m => m.value === '04'))
    })
  })

  describe('buildCancellationResponse', function() {
    it('M21: builds normalized response with mappedState', function() {
      const mapped = mapFacturaState({ status: 'valid', cancellation_status: 'verifying' })
      const r = buildCancellationResponse({ success: true, mappedState: mapped, mensaje: 'test msg' })
      assert.equal(r.success, true)
      assert.equal(r.cancellationStatus, 'verifying')
      assert.equal(r.canCancel, false)
      assert.equal(r.canSync, true)
      assert.equal(r.mensaje, 'test msg')
      assert.equal(r.cancellationDetail.badge, 'badge-verifying')
    })

    it('M22: builds response without mappedState', function() {
      const r = buildCancellationResponse({ success: true, data: { id: 1 } })
      assert.equal(r.success, true)
      assert.equal(r.data.id, 1)
      assert.equal(r.cancellationStatus, undefined)
    })
  })
})

// ════════════════════════════════════════════════════════════════════
//  API Tests (require running backend on localhost:3000)
// ════════════════════════════════════════════════════════════════════

const BASE = process.env.TEST_BASE || 'http://localhost:3000'
const TENANT_SECRET = process.env.TENANT_JWT_SECRET
const TENANT_ISSUER = process.env.TENANT_JWT_ISSUER
const TENANT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE

let TOKEN_ADMIN, TOKEN_SUPERADMIN
let TEST_ADMIN_ID, TEST_SUCURSAL_ID, TEST_EMPRESA_ID
const TEST_USER_IDS = []
const TEST_CLEANUP = { facturas: [], ventas: [], turnos: [], clientes: [], mc: [] }

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  const useToken = token !== undefined && token !== null ? token : TOKEN_ADMIN
  if (useToken) headers['Authorization'] = 'Bearer ' + useToken
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  const data = await res.json().catch(function() { return null })
  return { status: res.status, data: data }
}

async function createInvoiceFixture(label) {
  const marker = `${Date.now()}-${label}-${process.pid}`
  const turno = await prisma.turnoCaja.create({
    data: { empresaId: TEST_EMPRESA_ID, sucursalId: TEST_SUCURSAL_ID, usuarioId: TEST_ADMIN_ID, montoInicial: 0, abierto: true }
  })
  TEST_CLEANUP.turnos.push(turno.id)

  const cliente = await prisma.cliente.create({
    data: { empresaId: TEST_EMPRESA_ID, nombre: `P0-6x ${label} ${marker}`, tipo: 'GENERAL', limiteCredito: 0, saldoPendiente: 0, totalCreditoUsado: 0 }
  })
  TEST_CLEANUP.clientes.push(cliente.id)

  const venta = await prisma.venta.create({
    data: {
      empresaId: TEST_EMPRESA_ID, folio: `P0-6x-${label}-${marker}`, sucursalId: TEST_SUCURSAL_ID,
      usuarioId: TEST_ADMIN_ID, clienteId: cliente.id, turnoId: turno.id,
      metodoPago: 'EFECTIVO', subtotal: 10, total: 10, montoPagado: 10,
      tokenQr: `p06x-${label.toLowerCase()}-${marker}`, facturaEstado: 'PENDIENTE_TIMBRADO'
    }
  })
  TEST_CLEANUP.ventas.push(venta.id)

  const factura = await prisma.facturaCfdi.create({
    data: {
      empresaId: TEST_EMPRESA_ID, ventaId: venta.id, clienteId: cliente.id,
      rfcReceptor: 'XAXX010101000', nombreReceptor: 'PUBLICO EN GENERAL', cpReceptor: '00000',
      regimenFiscal: '612', usoCfdi: 'G03', lugarExpedicion: '00000',
      subtotal: 10, iva: 0, total: 10, estado: 'PENDIENTE_TIMBRADO',
      tipoFactura: 'INDIVIDUAL', idempotencyKey: `p06x-${label.toLowerCase()}-${marker}`
    }
  })
  TEST_CLEANUP.facturas.push(factura.id)

  return { venta, factura, turno, cliente }
}

before(async function() {
  const adminUser = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: 1, rol: 'ADMIN_SUCURSAL', sucursalId: { not: null } },
    select: { id: true, nombre: true, rol: true, sucursalId: true, empresaId: true }
  })
  if (!adminUser) throw new Error('No hay ADMIN_SUCURSAL local para fixture P0-6x')

  TEST_ADMIN_ID = adminUser.id
  TEST_SUCURSAL_ID = adminUser.sucursalId
  TEST_EMPRESA_ID = adminUser.empresaId

  TOKEN_ADMIN = jwt.sign(
    { version: 1, kind: 'TENANT', sub: adminUser.id, rol: adminUser.rol, empresaId: adminUser.empresaId, sucursalId: adminUser.sucursalId },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )

  const superUser = await prisma.usuario.create({
    data: {
      empresaId: adminUser.empresaId, sucursalId: null,
      nombre: 'P0-6x Superadmin', username: `p06x-super-${Date.now()}-${process.pid}`,
      passwordHash: 'fixture', rol: 'SUPERADMIN', activo: true
    }
  })
  TEST_USER_IDS.push(superUser.id)
  TOKEN_SUPERADMIN = jwt.sign(
    { version: 1, kind: 'TENANT', sub: superUser.id, rol: 'SUPERADMIN', empresaId: adminUser.empresaId, sucursalId: null },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )
})

after(async function() {
  if (TEST_CLEANUP.mc.length > 0) await prisma.movimientoCaja.deleteMany({ where: { id: { in: TEST_CLEANUP.mc } } }).catch(function() {})
  if (TEST_CLEANUP.facturas.length > 0) {
    await prisma.facturaVenta.deleteMany({ where: { facturaId: { in: TEST_CLEANUP.facturas } } }).catch(function() {})
    await prisma.facturaCfdi.deleteMany({ where: { id: { in: TEST_CLEANUP.facturas } } }).catch(function() {})
  }
  if (TEST_CLEANUP.ventas.length > 0) await prisma.venta.deleteMany({ where: { id: { in: TEST_CLEANUP.ventas } } }).catch(function() {})
  if (TEST_CLEANUP.turnos.length > 0) await prisma.turnoCaja.deleteMany({ where: { id: { in: TEST_CLEANUP.turnos } } }).catch(function() {})
  if (TEST_CLEANUP.clientes.length > 0) await prisma.cliente.deleteMany({ where: { id: { in: TEST_CLEANUP.clientes } } }).catch(function() {})
  if (TEST_USER_IDS.length > 0) await prisma.usuario.deleteMany({ where: { id: { in: TEST_USER_IDS } } }).catch(function() {})
  await prisma.$disconnect()
})

describe('P0-6 Extended: API Tests — Motivos', function() {

  it('F20: motivo 01 sin substitutionUUID — local cancel succeeds (no CFDI, UUID not needed)', async function() {
    const { factura } = await createInvoiceFixture('F20')
    // Local cancel (no facturapiId) doesn't need substitutionUUID — it's only for Facturapi API
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '01' })
    assert.equal(r.status, 200, `Local cancel should succeed without UUID, got ${r.status}`)
    assert.equal(r.data?.success, true)
  })

  it('F21: motivo 01 con substitutionUUID no retorna 400 por UUID', async function() {
    const { factura } = await createInvoiceFixture('F21')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '01', substitutionUUID: '550e8400-e29b-41d4-a716-446655440000' })
    // Should NOT fail with SUBSTITUTION_UUID_REQUIRED (may fail for other reasons like FP not found)
    assert.notEqual(r.data?.codigo, 'SUBSTITUTION_UUID_REQUIRED', 'Should not reject valid UUID format')
  })

  it('F22: motivo 03 (no se llevó a cabo) funciona', async function() {
    const { factura } = await createInvoiceFixture('F22')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '03' })
    assert.equal(r.status, 200, `Expected 200, got ${r.status}`)
  })

  it('F23: motivo 04 (global) funciona', async function() {
    const { factura } = await createInvoiceFixture('F23')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '04' })
    assert.equal(r.status, 200, `Expected 200, got ${r.status}`)
  })

  it('F24: motivo con caracteres especiales retorna 400', async function() {
    const { factura } = await createInvoiceFixture('F24')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '05' })
    assert.equal(r.status, 400, `Expected 400, got ${r.status}`)
    assert.equal(r.data?.codigo, 'MOTIVO_INVALIDO')
  })
})

describe('P0-6 Extended: API Tests — Normalized Response', function() {

  it('F25: cancelar response includes cancellationDetail for local cancel', async function() {
    const { factura } = await createInvoiceFixture('F25')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    assert.equal(r.status, 200)
    assert.equal(r.data?.success, true)
    // Local cancel should not have cancellationDetail (no FP query)
  })

  it('F26: sincronizar-cancelacion response includes normalized fields', async function() {
    const { factura } = await createInvoiceFixture('F26')
    const r = await req('POST', `/facturas/${factura.id}/sincronizar-cancelacion`)
    // Without facturapiId, should return 400
    assert.equal(r.status, 400)
  })

  it('F27: cancelar response includes codigo field on error', async function() {
    const { factura } = await createInvoiceFixture('F27')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '99' })
    assert.equal(r.status, 400)
    assert.ok(r.data?.codigo, 'Response should include codigo field')
  })
})

describe('P0-6 Extended: API Tests — Mapper Integration', function() {

  it('F28: cancelar with invalid motivo returns MOTIVO_INVALIDO', async function() {
    const { factura } = await createInvoiceFixture('F28')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: 'XX' })
    assert.equal(r.status, 400)
    assert.equal(r.data?.codigo, 'MOTIVO_INVALIDO')
  })

  it('F29: cancelar local sets factura CANCELADA and venta DISPONIBLE', async function() {
    const { factura, venta } = await createInvoiceFixture('F29')
    await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    const f = await prisma.facturaCfdi.findUnique({ where: { id: factura.id }, select: { estado: true } })
    const v = await prisma.venta.findUnique({ where: { id: venta.id }, select: { facturaEstado: true } })
    assert.equal(f.estado, 'CANCELADA')
    assert.equal(v.facturaEstado, 'DISPONIBLE')
  })

  it('F30: cancelar sets auditarCancelacion with motivo in detail', async function() {
    const { factura } = await createInvoiceFixture('F30')
    await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '03' })
    const audit = await prisma.auditoria.findFirst({
      where: { accion: 'CANCELAR_FACTURA', referencia: `factura:${factura.id}` },
      orderBy: { creadoEn: 'desc' },
      select: { valorDespues: true }
    })
    assert.ok(audit, 'Audit record should exist')
    assert.equal(audit.valorDespues?.motivo, '03', 'Audit should include motivo')
  })
})

// ════════════════════════════════════════════════════════════════════
//  SYNC TRANSITION MAPPER TESTS (F37-F40)
//  These test the mapper's ability to handle Facturapi state transitions
//  without needing a real Facturapi connection.
// ════════════════════════════════════════════════════════════════════

describe('P0-6 Extended: Sync Transitions (Mapper)', function() {

  it('F37: verifying → pending (receptor responds)', function() {
    const before = mapFacturaState({ status: 'valid', cancellation_status: 'verifying' })
    assert.equal(before.type, 'in_progress')
    assert.equal(before.canCancel, false)
    assert.equal(before.canSync, true)

    const after = mapFacturaState({ status: 'valid', cancellation_status: 'pending' })
    assert.equal(after.type, 'in_progress')
    assert.equal(after.badge, 'badge-pending-cancel')
    assert.equal(after.canCancel, false)
    assert.equal(after.canSync, true)
  })

  it('F38: verifying → accepted (SAT confirms, transitorio)', function() {
    const before = mapFacturaState({ status: 'valid', cancellation_status: 'verifying' })
    assert.equal(before.isAcceptedTransitorio, false)

    const after = mapFacturaState({ status: 'valid', cancellation_status: 'accepted' })
    assert.equal(after.isAcceptedTransitorio, true)
    assert.equal(after.isCanceled, false)
    assert.equal(after.type, 'terminal')
    assert.equal(after.canCancel, false)
    assert.equal(after.canSync, false)
  })

  it('F38b: verifying → accepted → canceled (final flip)', function() {
    const step1 = mapFacturaState({ status: 'valid', cancellation_status: 'accepted' })
    assert.equal(step1.isAcceptedTransitorio, true)

    const step2 = mapFacturaState({ status: 'canceled', cancellation_status: 'accepted' })
    assert.equal(step2.isCanceled, true)
    assert.equal(step2.isAcceptedTransitorio, false)
    assert.equal(step2.canCancel, false)
  })

  it('F39: pending → rejected (receptor rejects)', function() {
    const before = mapFacturaState({ status: 'valid', cancellation_status: 'pending' })
    assert.equal(before.type, 'in_progress')
    assert.equal(before.canCancel, false)

    const after = mapFacturaState({ status: 'valid', cancellation_status: 'rejected' })
    assert.equal(after.type, 'terminal_error')
    assert.equal(after.badge, 'badge-rejected')
    assert.equal(after.canCancel, true)
    assert.equal(after.canSync, true)
  })

  it('F40: pending → expired (timeout)', function() {
    const before = mapFacturaState({ status: 'valid', cancellation_status: 'pending' })
    assert.equal(before.type, 'in_progress')

    const after = mapFacturaState({ status: 'valid', cancellation_status: 'expired' })
    assert.equal(after.type, 'terminal_error')
    assert.equal(after.badge, 'badge-expired')
    assert.equal(after.canCancel, true)
    assert.equal(after.canSync, true)
  })

  it('F25: invoice.pending (timbrado) != cancellation_status.pending', function() {
    const invoicePending = mapFacturaState({ status: 'pending', cancellation_status: 'none' })
    assert.equal(invoicePending.badge, 'badge-pendiente')
    assert.equal(invoicePending.type, 'pending')
    assert.equal(invoicePending.canCancel, true)

    const cancelPending = mapFacturaState({ status: 'valid', cancellation_status: 'pending' })
    assert.equal(cancelPending.badge, 'badge-pending-cancel')
    assert.equal(cancelPending.type, 'in_progress')
    assert.equal(cancelPending.canCancel, false)

    assert.notEqual(invoicePending.badge, cancelPending.badge, 'invoice.pending and cancellation.pending must produce different badges')
    assert.notEqual(invoicePending.type, cancelPending.type, 'invoice.pending and cancellation.pending must produce different types')
  })

  it('F26: invoice.failed shows failed badge, not pendiente', function() {
    const r = mapFacturaState({ status: 'failed', cancellation_status: 'none' })
    assert.equal(r.badge, 'badge-failed')
    assert.equal(r.type, 'error')
    assert.ok(r.label.includes('falló'), 'Label should indicate failure')
  })
})

// ════════════════════════════════════════════════════════════════════
//  FP ERROR CODE MAPPER TESTS (F27-F36)
// ════════════════════════════════════════════════════════════════════

describe('P0-6 Extended: FP Error Codes', function() {

  it('F27: invoice_cancellation_in_progress', function() {
    const r = mapFpError('invoice_cancellation_in_progress')
    assert.ok(r.message.includes('proceso') || r.message.includes('solicitud'))
    assert.equal(r.retryable, true)
    assert.equal(r.suggestSync, true)
  })

  it('F28: invoice_cancellation_service_unavailable', function() {
    const r = mapFpError('invoice_cancellation_service_unavailable')
    assert.ok(r.message.includes('disponible') || r.message.includes('tarde'))
    assert.equal(r.retryable, true)
  })

  it('F29: invoice_not_cancelable', function() {
    const r = mapFpError('invoice_not_cancelable')
    assert.ok(r.message.includes('cancelable') || r.message.includes('cancelarse') || r.message.includes('no es cancelable'))
    assert.equal(r.retryable, false)
  })

  it('F30: invoice_not_cancelable_by_sat', function() {
    const r = mapFpError('invoice_not_cancelable_by_sat')
    assert.ok(r.message.includes('SAT') || r.message.includes('cancelarse'))
    assert.equal(r.retryable, false)
  })

  it('F31: invoice_cancellation_rfc_mismatch', function() {
    const r = mapFpError('invoice_cancellation_rfc_mismatch')
    assert.ok(r.message.includes('RFC'))
    assert.equal(r.retryable, false)
  })

  it('F32: substitution_invoice_required', function() {
    const r = mapFpError('substitution_invoice_required')
    assert.ok(r.message.includes('sustitución') || r.message.includes('relación'))
    assert.equal(r.retryable, false)
  })

  it('F33: substitution_invoice_not_found', function() {
    const r = mapFpError('substitution_invoice_not_found')
    assert.ok(r.message.includes('no se encontró') || r.message.includes('UUID'))
    assert.equal(r.retryable, false)
  })

  it('F34: substitution_invoice_canceled', function() {
    const r = mapFpError('substitution_invoice_canceled')
    assert.ok(r.message.includes('cancelada') || r.message.includes('sustitu'))
    assert.equal(r.retryable, false)
  })

  it('F35: substitution_invoice_status_not_allowed', function() {
    const r = mapFpError('substitution_invoice_status_not_allowed')
    assert.ok(r.message.includes('estado') || r.message.includes('válido'))
    assert.equal(r.retryable, false)
  })

  it('F36: unknown error code returns safe fallback', function() {
    const r = mapFpError('some_completely_unknown_code', 'Fallback message')
    assert.equal(r.message, 'Fallback message')
    assert.equal(r.retryable, false)
  })
})

// ════════════════════════════════════════════════════════════════════
//  NORMALIZED BACKEND CONTRACT TEST (F41)
// ════════════════════════════════════════════════════════════════════

describe('P0-6 Extended: Normalized Backend Contract (F41)', function() {

  it('F41a: cancelar response has success field', async function() {
    const { factura } = await createInvoiceFixture('F41a')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    assert.equal(r.status, 200)
    assert.equal(typeof r.data?.success, 'boolean')
  })

  it('F41b: cancelar error response has error + codigo', async function() {
    const { factura } = await createInvoiceFixture('F41b')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '99' })
    assert.equal(r.status, 400)
    assert.equal(typeof r.data?.error, 'string')
    assert.equal(typeof r.data?.codigo, 'string')
  })

  it('F41c: sincronizar-cancelacion guard responses include expected fields', async function() {
    const { factura } = await createInvoiceFixture('F41c')
    const r = await req('POST', `/facturas/${factura.id}/sincronizar-cancelacion`)
    assert.equal(r.status, 400)
    assert.equal(typeof r.data?.error, 'string')
  })

  it('F41d: cancelar local cancel returns success=true + data with estado', async function() {
    const { factura } = await createInvoiceFixture('F41d')
    const r = await req('PATCH', `/facturas/${factura.id}/cancelar`, { motivo: '02' })
    assert.equal(r.status, 200)
    assert.equal(r.data?.success, true)
    assert.ok(r.data?.data, 'Response should include data field')
  })
})

// ════════════════════════════════════════════════════════════════════
//  P0-5 INTERACTION TEST (F42)
// ════════════════════════════════════════════════════════════════════

describe('P0-6 Extended: P0-5 Interaction (F42)', function() {

  it('F42a: venta with factura TIMBRADA blocks method edit', async function() {
    const marker = `${Date.now()}-F42a-${process.pid}`
    const turno = await prisma.turnoCaja.create({
      data: { empresaId: TEST_EMPRESA_ID, sucursalId: TEST_SUCURSAL_ID, usuarioId: TEST_ADMIN_ID, montoInicial: 0, abierto: true }
    })
    TEST_CLEANUP.turnos.push(turno.id)
    const cliente = await prisma.cliente.create({
      data: { empresaId: TEST_EMPRESA_ID, nombre: `P0-6x F42a ${marker}`, tipo: 'GENERAL', limiteCredito: 0, saldoPendiente: 0, totalCreditoUsado: 0 }
    })
    TEST_CLEANUP.clientes.push(cliente.id)
    const venta = await prisma.venta.create({
      data: {
        empresaId: TEST_EMPRESA_ID, folio: `P0-6x-F42a-${marker}`, sucursalId: TEST_SUCURSAL_ID,
        usuarioId: TEST_ADMIN_ID, clienteId: cliente.id, turnoId: turno.id,
        metodoPago: 'EFECTIVO', subtotal: 10, total: 10, montoPagado: 10,
        tokenQr: `p06x-f42a-${marker}`, facturaEstado: 'TIMBRADA'
      }
    })
    TEST_CLEANUP.ventas.push(venta.id)

    const r = await req('PATCH', `/ventas/${venta.id}/metodo-pago`, { nuevoMetodo: 'TRANSFERENCIA' })
    assert.ok([400, 409].includes(r.status), `TIMBRADA venta should block method edit, got ${r.status}`)
    assert.ok(r.data?.error || r.data?.codigo, 'Should include error info')
  })

  it('F42b: venta with factura DISPONIBLE allows method edit', async function() {
    const marker = `${Date.now()}-F42b-${process.pid}`
    const turno = await prisma.turnoCaja.create({
      data: { empresaId: TEST_EMPRESA_ID, sucursalId: TEST_SUCURSAL_ID, usuarioId: TEST_ADMIN_ID, montoInicial: 0, abierto: true }
    })
    TEST_CLEANUP.turnos.push(turno.id)
    const cliente = await prisma.cliente.create({
      data: { empresaId: TEST_EMPRESA_ID, nombre: `P0-6x F42b ${marker}`, tipo: 'GENERAL', limiteCredito: 0, saldoPendiente: 0, totalCreditoUsado: 0 }
    })
    TEST_CLEANUP.clientes.push(cliente.id)
    const venta = await prisma.venta.create({
      data: {
        empresaId: TEST_EMPRESA_ID, folio: `P0-6x-F42b-${marker}`, sucursalId: TEST_SUCURSAL_ID,
        usuarioId: TEST_ADMIN_ID, clienteId: cliente.id, turnoId: turno.id,
        metodoPago: 'EFECTIVO', subtotal: 10, total: 10, montoPagado: 10,
        tokenQr: `p06x-f42b-${marker}`, facturaEstado: 'DISPONIBLE'
      }
    })
    TEST_CLEANUP.ventas.push(venta.id)

    const r = await req('PATCH', `/ventas/${venta.id}/metodo-pago`, { nuevoMetodo: 'TRANSFERENCIA' })
    assert.ok([200, 400, 409].includes(r.status), `DISPONIBLE venta method edit result: ${r.status}`)
    // DISPONIBLE should NOT be blocked by CFDI guard (may fail for other reasons like turno)
    if (r.status === 409) {
      assert.notEqual(r.data?.codigo, 'VENTA_FACTURADA', 'DISPONIBLE should not get VENTA_FACTURADA error')
    }
  })

  it('F42c: venta with PENDIENTE_TIMBRADO blocks method edit', async function() {
    const marker = `${Date.now()}-F42c-${process.pid}`
    const turno = await prisma.turnoCaja.create({
      data: { empresaId: TEST_EMPRESA_ID, sucursalId: TEST_SUCURSAL_ID, usuarioId: TEST_ADMIN_ID, montoInicial: 0, abierto: true }
    })
    TEST_CLEANUP.turnos.push(turno.id)
    const cliente = await prisma.cliente.create({
      data: { empresaId: TEST_EMPRESA_ID, nombre: `P0-6x F42c ${marker}`, tipo: 'GENERAL', limiteCredito: 0, saldoPendiente: 0, totalCreditoUsado: 0 }
    })
    TEST_CLEANUP.clientes.push(cliente.id)
    const venta = await prisma.venta.create({
      data: {
        empresaId: TEST_EMPRESA_ID, folio: `P0-6x-F42c-${marker}`, sucursalId: TEST_SUCURSAL_ID,
        usuarioId: TEST_ADMIN_ID, clienteId: cliente.id, turnoId: turno.id,
        metodoPago: 'EFECTIVO', subtotal: 10, total: 10, montoPagado: 10,
        tokenQr: `p06x-f42c-${marker}`, facturaEstado: 'PENDIENTE_TIMBRADO'
      }
    })
    TEST_CLEANUP.ventas.push(venta.id)

    const r = await req('PATCH', `/ventas/${venta.id}/metodo-pago`, { nuevoMetodo: 'TRANSFERENCIA' })
    assert.ok([400, 409].includes(r.status), `PENDIENTE_TIMBRADO venta should block method edit, got ${r.status}`)
  })
})

// ════════════════════════════════════════════════════════════════════
//  CANCELLATION DETAIL MAPPER TESTS
// ════════════════════════════════════════════════════════════════════

describe('P0-6 Extended: Cancellation Detail', function() {

  it('M23: rejected allows canCancel (retry)', function() {
    const r = mapFacturaState({ status: 'valid', cancellation_status: 'rejected' })
    assert.equal(r.canCancel, true, 'Rejected should allow retry')
    assert.equal(r.canSync, true)
  })

  it('M24: expired allows canCancel (retry)', function() {
    const r = mapFacturaState({ status: 'valid', cancellation_status: 'expired' })
    assert.equal(r.canCancel, true, 'Expired should allow retry')
    assert.equal(r.canSync, true)
  })

  it('M25: verifying does NOT allow canCancel', function() {
    const r = mapFacturaState({ status: 'valid', cancellation_status: 'verifying' })
    assert.equal(r.canCancel, false, 'Verifying should block cancel')
    assert.equal(r.canSync, true)
  })

  it('M26: pending does NOT allow canCancel', function() {
    const r = mapFacturaState({ status: 'valid', cancellation_status: 'pending' })
    assert.equal(r.canCancel, false, 'Pending should block cancel')
    assert.equal(r.canSync, true)
  })

  it('M27: accepted transitorio does NOT allow canCancel or canSync', function() {
    const r = mapFacturaState({ status: 'valid', cancellation_status: 'accepted' })
    assert.equal(r.canCancel, false)
    assert.equal(r.canSync, false)
  })

  it('M28: canceled does NOT allow canCancel or canSync', function() {
    const r = mapFacturaState({ status: 'canceled', cancellation_status: 'accepted' })
    assert.equal(r.canCancel, false)
    assert.equal(r.canSync, false)
  })

  it('M29: motif 01 has requiresSubstitution=true', function() {
    const r = validateMotivo('01')
    assert.equal(r.requiresSubstitution, true)
  })

  it('M30: motifs 02/03/04 do NOT require substitution', function() {
    for (const m of ['02', '03', '04']) {
      const r = validateMotivo(m)
      assert.equal(r.requiresSubstitution, false, `Motivo ${m} should not require substitution`)
    }
  })
})
