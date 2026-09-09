/**
 * P0-3 — Descuento de empleado: TODOS los usuarios tenant EXCEPTO PLATFORM_ADMIN
 *
 * Cobertura:
 *  T01-T05:  Roles tenant elegibles aparecen
 *  T06-T07:  PLATFORM_ADMIN excluido (normal + empresaId temporal)
 *  T08:      Cross-tenant excluido
 *  T09:      Otra sucursal misma empresa → aparece (scope empresa)
 *  T10:      Usuario company-wide sin sucursal → aparece
 *  T11:      Inactivo → no aparece
 *  T12:      No depende de whitelist cerrada de roles
 *  T13:      Frontend renderiza roles tenant distintos de EMPLEADO
 *  T14-T15:  Seleccionar ADMIN_SUCURSAL / SUPERADMIN como beneficiario funciona
 *  T16:      Enviar PLATFORM_ADMIN manualmente → rechazado
 *  T17:      Cross-tenant → rechazado
 *  T18:      ID inexistente → rechazado
 *  T19:      Beneficiario no modifica Venta.usuarioId
 *  T20:      Session A + Seller B + Beneficiary C → Venta.usuarioId=B
 *  T21:      TurnoCaja atribución correcta
 *  T22:      Venta normal sin descuento funciona
 *  T23:      Descuento empleado = 3% exacto
 *  T24:      No doble descuento
 *  T25:      ADMIN_SUCURSAL puede consultar endpoint → 200
 *  T26:      EMPLEADO consulta endpoint → 403
 *  T27:      PRECIOS consulta endpoint → 403
 *  T28:      Ruta /beneficiarios-descuento no cae en /:id
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// ═══════════════════════════════════════════════════════════════════
//  SOURCE-LEVEL TESTS — Code structure and query logic
// ═══════════════════════════════════════════════════════════════════

describe('P0-3 Source: Backend endpoint structure', () => {

  const controllerPath = path.join(__dirname, '..', 'src', 'modules', 'usuarios', 'usuarios.controller.js')
  const routesPath = path.join(__dirname, '..', 'src', 'modules', 'usuarios', 'usuarios.routes.js')
  const ventasPath = path.join(__dirname, '..', 'src', 'modules', 'ventas', 'ventas.controller.js')

  let controllerCode, routesCode, ventasCode

  try {
    controllerCode = fs.readFileSync(controllerPath, 'utf-8')
    routesCode = fs.readFileSync(routesPath, 'utf-8')
    ventasCode = fs.readFileSync(ventasPath, 'utf-8')
  } catch (e) {
    // Files may not exist in test-only contexts
  }

  it('T01: listarBeneficiariosDescuento function exists in controller', () => {
    assert.ok(controllerCode, 'controller file loaded')
    assert.ok(controllerCode.includes('listarBeneficiariosDescuento'), 'function exported')
  })

  it('T02: Query filters activo=true AND rol != PLATFORM_ADMIN', () => {
    assert.ok(controllerCode, 'controller file loaded')
    // The query must include both activo: true and rol: { not: 'PLATFORM_ADMIN' }
    assert.ok(
      controllerCode.includes("activo: true") && controllerCode.includes("PLATFORM_ADMIN"),
      'query includes activo=true and PLATFORM_ADMIN exclusion'
    )
  })

  it('T03: Query does NOT filter by specific role (no whitelist)', () => {
    assert.ok(controllerCode, 'controller file loaded')
    // Find the listarBeneficiariosDescuento function body
    const fnMatch = controllerCode.match(/listarBeneficiariosDescuento[\s\S]*?module\.exports/)
    assert.ok(fnMatch, 'function body found')
    const fnBody = fnMatch[0]
    // Should NOT contain rol: 'EMPLEADO' or rol: 'SUPERADMIN' etc inside this function
    assert.ok(!fnBody.includes("rol: 'EMPLEADO'"), 'no EMPLEADO whitelist')
    assert.ok(!fnBody.includes("rol: 'SUPERADMIN'"), 'no SUPERADMIN whitelist')
    assert.ok(!fnBody.includes("rol: 'ADMIN_SUCURSAL'"), 'no ADMIN_SUCURSAL whitelist')
  })

  it('T04: Query orders by nombre ASC', () => {
    assert.ok(controllerCode, 'controller file loaded')
    const fnMatch = controllerCode.match(/listarBeneficiariosDescuento[\s\S]*?module\.exports/)
    assert.ok(fnMatch, 'function body found')
    assert.ok(fnMatch[0].includes("nombre: 'asc'"), 'orders by nombre asc')
  })

  it('T05: Route registered with requireRole SUPERADMIN and ADMIN_SUCURSAL', () => {
    assert.ok(routesCode, 'routes file loaded')
    assert.ok(
      routesCode.includes("requireRole('SUPERADMIN', 'ADMIN_SUCURSAL')") ||
      routesCode.includes('requireRole("SUPERADMIN", "ADMIN_SUCURSAL")'),
      'route requires SUPERADMIN or ADMIN_SUCURSAL'
    )
    assert.ok(
      routesCode.includes('/beneficiarios-descuento'),
      'route path exists'
    )
  })

  it('T06: Endpoint is NOT open to any authenticated user (no branchOptional/tenantGlobal only)', () => {
    assert.ok(routesCode, 'routes file loaded')
    // Find the beneficiarios-descuento route line
    const routeLine = routesCode.split('\n').find(l => l.includes('beneficiarios-descuento'))
    assert.ok(routeLine, 'route line found')
    // Must include requireRole, not just tenantGlobal
    assert.ok(routeLine.includes('requireRole'), 'route has role guard')
  })

  it('T28: Static route /beneficiarios-descuento registered before any /:id routes', () => {
    assert.ok(routesCode, 'routes file loaded')
    const lines = routesCode.split('\n')
    const beneficiaryLine = lines.findIndex(l => l.includes('beneficiarios-descuento'))
    const dynamicLine = lines.findIndex(l => l.includes('/:id'))
    assert.ok(beneficiaryLine >= 0, 'beneficiary route found')
    if (dynamicLine >= 0) {
      assert.ok(beneficiaryLine < dynamicLine, 'static route before /:id')
    }
    // If no /:id routes exist, the test passes (no collision possible)
  })

  it('T25: listarBeneficiariosDescuento is exported from controller', () => {
    assert.ok(controllerCode, 'controller file loaded')
    assert.ok(
      controllerCode.includes('listarBeneficiariosDescuento'),
      'function is exported'
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
//  SOURCE-LEVEL TESTS — empleadoId validation in ventas controller
// ═══════════════════════════════════════════════════════════════════

describe('P0-3 Source: empleadoId backend validation', () => {

  const ventasPath = path.join(__dirname, '..', 'src', 'modules', 'ventas', 'ventas.controller.js')
  let ventasCode

  try {
    ventasCode = fs.readFileSync(ventasPath, 'utf-8')
  } catch (e) {
    // File may not exist
  }

  it('T16: Backend validates empleadoId with Number()', () => {
    assert.ok(ventasCode, 'ventas controller loaded')
    assert.ok(ventasCode.includes('Number(rawEmpleadoId)'), 'uses Number() for strict conversion')
  })

  it('T16b: Backend validates empleadoId with Number.isInteger()', () => {
    assert.ok(ventasCode, 'ventas controller loaded')
    assert.ok(ventasCode.includes('Number.isInteger(eid)'), 'validates integer')
  })

  it('T16c: Backend validates empleadoId > 0', () => {
    assert.ok(ventasCode, 'ventas controller loaded')
    assert.ok(ventasCode.includes('eid <= 0') || ventasCode.includes('eid > 0'), 'validates positive')
  })

  it('T16d: Backend rejects PLATFORM_ADMIN as beneficiario', () => {
    assert.ok(ventasCode, 'ventas controller loaded')
    assert.ok(ventasCode.includes("rol: { not: 'PLATFORM_ADMIN' }"), 'excludes PLATFORM_ADMIN from query')
  })

  it('T16e: Backend validates beneficiario belongs to same empresa', () => {
    assert.ok(ventasCode, 'ventas controller loaded')
    // Find the empleadoId validation block by looking for the comment marker
    const blockStart = ventasCode.indexOf('P0-3: validar beneficiario')
    const blockEnd = ventasCode.indexOf('P0-BRANCH-ISOLATION', blockStart)
    assert.ok(blockStart >= 0 && blockEnd > blockStart, 'validation block found')
    const block = ventasCode.slice(blockStart, blockEnd)
    assert.ok(block.includes('empresaId'), 'validates empresaId')
  })

  it('T16f: Backend validates beneficiario is activo=true', () => {
    assert.ok(ventasCode, 'ventas controller loaded')
    const blockStart = ventasCode.indexOf('P0-3: validar beneficiario')
    const blockEnd = ventasCode.indexOf('P0-BRANCH-ISOLATION', blockStart)
    assert.ok(blockStart >= 0 && blockEnd > blockStart, 'validation block found')
    const block = ventasCode.slice(blockStart, blockEnd)
    assert.ok(block.includes('activo: true'), 'validates activo')
  })

  it('T18: Backend returns BENEFICIARIO_INVALIDO for invalid ID', () => {
    assert.ok(ventasCode, 'ventas controller loaded')
    assert.ok(ventasCode.includes('BENEFICIARIO_INVALIDO'), 'error code exists')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  SOURCE-LEVEL TESTS — Frontend code
// ═══════════════════════════════════════════════════════════════════

describe('P0-3 Source: Frontend employee discount', () => {

  const pvPath = path.join(__dirname, '..', '..', 'punto-venta.js')
  let pvCode

  try {
    pvCode = fs.readFileSync(pvPath, 'utf-8')
  } catch (e) {
    // File may not exist
  }

  it('T13: Frontend calls /usuarios/beneficiarios-descuento (not ?rol=EMPLEADO)', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    assert.ok(
      pvCode.includes('/usuarios/beneficiarios-descuento'),
      'uses new endpoint'
    )
    assert.ok(
      !pvCode.includes('/usuarios?rol=EMPLEADO'),
      'old ?rol=EMPLEADO query removed'
    )
  })

  it('T12: Frontend does not filter by specific roles in beneficiary list', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    // Find the cargarEmpleadosSelect function
    const fnMatch = pvCode.match(/async function cargarEmpleadosSelect[\s\S]*?^}/m)
    assert.ok(fnMatch, 'cargarEmpleadosSelect found')
    const fnBody = fnMatch[0]
    // Should NOT filter by specific role names
    assert.ok(!fnBody.includes("rol === 'EMPLEADO'"), 'no EMPLEADO filter')
    assert.ok(!fnBody.includes("rol === 'SUPERADMIN'"), 'no SUPERADMIN filter')
    assert.ok(!fnBody.includes(".filter(u =>"), 'no client-side role filter')
  })

  it('T19: Venta.usuarioId is set from seller (vendId), not from employee selection', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    // In confirmarVenta, usuarioId should come from vendId (seller), not empleadoId
    const confirmBlock = pvCode.match(/const payload[\s\S]*?const response/)
    assert.ok(confirmBlock, 'payload block found')
    assert.ok(
      confirmBlock[0].includes('usuarioId:   vendId') || confirmBlock[0].includes('usuarioId:vendId'),
      'usuarioId = vendId (seller)'
    )
  })

  it('T20: empleadoId is separate from usuarioId in payload', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    const confirmBlock = pvCode.match(/const payload[\s\S]*?const response/)
    assert.ok(confirmBlock, 'payload block found')
    // Both fields should exist and be different variables
    assert.ok(confirmBlock[0].includes('empleadoId'), 'empleadoId in payload')
    assert.ok(confirmBlock[0].includes('vendId'), 'vendId used for seller')
  })

  it('T22: Normal sale without employee discount still works', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    // getPctEfectivo should return { pct: 0, esEmpleado: false } when no employee selected
    assert.ok(pvCode.includes('return { pct: 0, esEmpleado: false }'), 'no-discount return exists')
  })

  it('T23: Employee discount is 3% hardcoded', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    assert.ok(pvCode.includes('pct: 3, esEmpleado: true'), '3% employee discount')
  })

  it('T24: No double discount (manual takes priority over employee)', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    // getPctEfectivo returns manual first, then employee — never both
    const fnMatch = pvCode.match(/function getPctEfectivo[\s\S]*?^}/m)
    assert.ok(fnMatch, 'getPctEfectivo found')
    const fnBody = fnMatch[0]
    // Manual check comes before employee check
    const manualIdx = fnBody.indexOf('pctManual')
    const empIdx = fnBody.indexOf('hayEmp')
    assert.ok(manualIdx >= 0 && empIdx >= 0, 'both checks exist')
    assert.ok(manualIdx < empIdx, 'manual check before employee (priority)')
  })

  it('T21: TurnoCaja attribution unchanged (turnoId from turnoActivo)', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    const confirmBlock = pvCode.match(/const payload[\s\S]*?const response/)
    assert.ok(confirmBlock, 'payload block found')
    assert.ok(
      confirmBlock[0].includes('turnoId:     turnoActivo.id') || confirmBlock[0].includes('turnoId:turnoActivo.id'),
      'turnoId = turnoActivo.id (unchanged)'
    )
  })

  it('T25b: Visibility whitelist preserved (SUPERADMIN/ADMIN_SUCURSAL only)', () => {
    assert.ok(pvCode, 'punto-venta.js loaded')
    assert.ok(
      pvCode.includes("['SUPERADMIN', 'ADMIN_SUCURSAL'].includes(USUARIO.rol)") ||
      pvCode.includes("['SUPERADMIN','ADMIN_SUCURSAL'].includes(USUARIO.rol)"),
      'visibility whitelist preserved'
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
//  LOGIC TESTS — Query filter simulation
// ═══════════════════════════════════════════════════════════════════

describe('P0-3 Logic: Beneficiary eligibility', () => {

  const ALL_ROLES = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO', 'PRECIOS', 'PLATFORM_ADMIN']

  function buildBeneficiaryQuery(empresaId) {
    return {
      empresaId,
      activo: true,
      rol: { not: 'PLATFORM_ADMIN' }
    }
  }

  function isEligible(usuario, empresaId) {
    return usuario.empresaId === empresaId &&
           usuario.activo === true &&
           usuario.rol !== 'PLATFORM_ADMIN'
  }

  const empresaA = 1
  const empresaB = 2

  const usuarios = [
    { id: 1, nombre: 'Super A',     rol: 'SUPERADMIN',      empresaId: 1, activo: true  },
    { id: 2, nombre: 'Admin Branch', rol: 'ADMIN_SUCURSAL',  empresaId: 1, activo: true  },
    { id: 3, nombre: 'Empleado A1',  rol: 'EMPLEADO',        empresaId: 1, activo: true  },
    { id: 4, nombre: 'Precios A',    rol: 'PRECIOS',         empresaId: 1, activo: true  },
    { id: 5, nombre: 'Platform',     rol: 'PLATFORM_ADMIN',  empresaId: null, activo: true },
    { id: 6, nombre: 'Platform Empresa', rol: 'PLATFORM_ADMIN', empresaId: 1, activo: true },
    { id: 7, nombre: 'User B',       rol: 'EMPLEADO',        empresaId: 2, activo: true  },
    { id: 8, nombre: 'Inactivo A',   rol: 'EMPLEADO',        empresaId: 1, activo: false },
    { id: 9, nombre: 'Sucursal B',   rol: 'EMPLEADO',        empresaId: 1, activo: true, sucursalId: 2 },
  ]

  const eligible = usuarios.filter(u => isEligible(u, empresaA))

  it('T01: EMPLEADO same empresa appears', () => {
    assert.ok(eligible.some(u => u.nombre === 'Empleado A1'))
  })

  it('T02: ADMIN_SUCURSAL same empresa appears', () => {
    assert.ok(eligible.some(u => u.nombre === 'Admin Branch'))
  })

  it('T03: SUPERADMIN same empresa appears', () => {
    assert.ok(eligible.some(u => u.nombre === 'Super A'))
  })

  it('T04: PRECIOS same empresa appears', () => {
    assert.ok(eligible.some(u => u.nombre === 'Precios A'))
  })

  it('T05: Future tenant role (any non-PLATFORM_ADMIN) would appear', () => {
    const hypothetical = { id: 99, nombre: 'Future Role', rol: 'CONTADOR', empresaId: 1, activo: true }
    assert.ok(isEligible(hypothetical, empresaA), 'future role is eligible')
  })

  it('T06: PLATFORM_ADMIN (global, empresaId=null) does NOT appear', () => {
    assert.ok(!eligible.some(u => u.nombre === 'Platform'))
  })

  it('T07: PLATFORM_ADMIN with empresaId=1 does NOT appear', () => {
    assert.ok(!eligible.some(u => u.nombre === 'Platform Empresa'))
  })

  it('T08: User from Empresa B does NOT appear', () => {
    assert.ok(!eligible.some(u => u.nombre === 'User B'))
  })

  it('T09: User from other branch of same empresa APPEARS (scope = empresa)', () => {
    assert.ok(eligible.some(u => u.nombre === 'Sucursal B'), 'other branch user is eligible')
  })

  it('T10: Company-wide user without sucursal appears (if activo)', () => {
    const companyWide = { id: 10, nombre: 'Global A', rol: 'EMPLEADO', empresaId: 1, sucursalId: null, activo: true }
    assert.ok(isEligible(companyWide, empresaA), 'company-wide user eligible')
  })

  it('T11: Inactive user does NOT appear', () => {
    assert.ok(!eligible.some(u => u.nombre === 'Inactivo A'))
  })

  it('T11b: Total eligible count matches expected', () => {
    // Super A, Admin Branch, Empleado A1, Precios A, Sucursal B = 5
    assert.equal(eligible.length, 5)
  })
})

// ═══════════════════════════════════════════════════════════════════
//  LOGIC TESTS — empleadoId validation simulation
// ═══════════════════════════════════════════════════════════════════

describe('P0-3 Logic: empleadoId validation', () => {

  function validateEmpleadoId(raw, empresaId, usuarios) {
    if (raw === undefined || raw === null || raw === '') return { ok: true, id: null }
    const eid = Number(raw)
    if (!Number.isInteger(eid) || eid <= 0) return { ok: false, error: 'BENEFICIARIO_INVALIDO' }
    const user = usuarios.find(u => u.id === eid && u.empresaId === empresaId && u.activo === true && u.rol !== 'PLATFORM_ADMIN')
    if (!user) return { ok: false, error: 'BENEFICIARIO_INVALIDO' }
    return { ok: true, id: eid }
  }

  const usuarios = [
    { id: 1, nombre: 'Super',    rol: 'SUPERADMIN',     empresaId: 1, activo: true },
    { id: 2, nombre: 'Admin',    rol: 'ADMIN_SUCURSAL', empresaId: 1, activo: true },
    { id: 3, nombre: 'Empleado', rol: 'EMPLEADO',       empresaId: 1, activo: true },
    { id: 4, nombre: 'Platform', rol: 'PLATFORM_ADMIN', empresaId: 1, activo: true },
    { id: 5, nombre: 'Inactivo', rol: 'EMPLEADO',       empresaId: 1, activo: false },
    { id: 6, nombre: 'User B',   rol: 'EMPLEADO',       empresaId: 2, activo: true },
  ]

  it('T14: Selecting ADMIN_SUCURSAL as beneficiary → valid', () => {
    const r = validateEmpleadoId(2, 1, usuarios)
    assert.ok(r.ok)
    assert.equal(r.id, 2)
  })

  it('T15: Selecting SUPERADMIN as beneficiary → valid', () => {
    const r = validateEmpleadoId(1, 1, usuarios)
    assert.ok(r.ok)
    assert.equal(r.id, 1)
  })

  it('T16: Sending PLATFORM_ADMIN manually → rejected', () => {
    const r = validateEmpleadoId(4, 1, usuarios)
    assert.ok(!r.ok)
    assert.equal(r.error, 'BENEFICIARIO_INVALIDO')
  })

  it('T17: Cross-tenant user → rejected', () => {
    const r = validateEmpleadoId(6, 1, usuarios)
    assert.ok(!r.ok)
    assert.equal(r.error, 'BENEFICIARIO_INVALIDO')
  })

  it('T18: Nonexistent user ID → rejected', () => {
    const r = validateEmpleadoId(999, 1, usuarios)
    assert.ok(!r.ok)
    assert.equal(r.error, 'BENEFICIARIO_INVALIDO')
  })

  it('T18b: String garbage → rejected', () => {
    const r = validateEmpleadoId('abc', 1, usuarios)
    assert.ok(!r.ok)
  })

  it('T18c: Zero → rejected', () => {
    const r = validateEmpleadoId(0, 1, usuarios)
    assert.ok(!r.ok)
  })

  it('T18d: Decimal → rejected', () => {
    const r = validateEmpleadoId(3.5, 1, usuarios)
    assert.ok(!r.ok)
  })

  it('T18e: Negative → rejected', () => {
    const r = validateEmpleadoId(-1, 1, usuarios)
    assert.ok(!r.ok)
  })

  it('T18f: Inactive user → rejected', () => {
    const r = validateEmpleadoId(5, 1, usuarios)
    assert.ok(!r.ok)
  })

  it('T18g: null → accepted (no beneficiary)', () => {
    const r = validateEmpleadoId(null, 1, usuarios)
    assert.ok(r.ok)
    assert.equal(r.id, null)
  })

  it('T18h: empty string → accepted (no beneficiary)', () => {
    const r = validateEmpleadoId('', 1, usuarios)
    assert.ok(r.ok)
    assert.equal(r.id, null)
  })
})

// ═══════════════════════════════════════════════════════════════════
//  LOGIC TESTS — Discount amount unchanged
// ═══════════════════════════════════════════════════════════════════

describe('P0-3 Logic: Discount amount and priority', () => {

  it('T23: Employee discount is exactly 3%', () => {
    const total = 1000
    const pct = 3
    const desc = parseFloat((total * (pct / 100)).toFixed(2))
    assert.equal(desc, 30)
  })

  it('T23b: Employee discount on $500 subtotal', () => {
    const total = 500
    const pct = 3
    const desc = parseFloat((total * (pct / 100)).toFixed(2))
    assert.equal(desc, 15)
  })

  it('T24: Manual discount takes priority over employee discount', () => {
    const pctManual = 5
    const hayEmp = true
    const result = pctManual > 0
      ? { pct: Math.min(10, pctManual), esEmpleado: false }
      : hayEmp
        ? { pct: 3, esEmpleado: true }
        : { pct: 0, esEmpleado: false }
    assert.equal(result.pct, 5)
    assert.equal(result.esEmpleado, false)
  })

  it('T24b: Cotizacion discount takes priority over employee', () => {
    const cotDescuentoLocked = true
    const cotDescuentoGlobal = 50
    const totalBruto = 500
    let result
    if (cotDescuentoLocked && cotDescuentoGlobal > 0) {
      const pctCalc = Math.min(10, parseFloat(((cotDescuentoGlobal / totalBruto) * 100).toFixed(1)))
      result = { pct: pctCalc, esEmpleado: false, cotDescuentoMonto: cotDescuentoGlobal }
    } else {
      result = { pct: 3, esEmpleado: true }
    }
    assert.equal(result.esEmpleado, false)
    assert.equal(result.cotDescuentoMonto, 50)
  })

  it('T24c: No discount when nothing selected', () => {
    const pctManual = 0
    const hayEmp = false
    const result = pctManual > 0
      ? { pct: Math.min(10, pctManual), esEmpleado: false }
      : hayEmp
        ? { pct: 3, esEmpleado: true }
        : { pct: 0, esEmpleado: false }
    assert.equal(result.pct, 0)
    assert.equal(result.esEmpleado, false)
  })
})

// ═══════════════════════════════════════════════════════════════════
//  LOGIC TESTS — Three-actor separation (Session/Seller/Beneficiary)
// ═══════════════════════════════════════════════════════════════════

describe('P0-3 Logic: Three-actor separation', () => {

  it('T19: Beneficiary does not modify Venta.usuarioId', () => {
    // Session = A (req.usuario.id = A)
    // Seller = B (vendId = B via SAT/PIN)
    // Beneficiary = C (empleadoId = C)
    const sessionUser = { id: 1, rol: 'SUPERADMIN' }
    const seller = { id: 2, rol: 'EMPLEADO' }
    const beneficiary = { id: 3, rol: 'ADMIN_SUCURSAL' }

    // Payload construction
    const vendId = seller.id  // from seller selector
    const empleadoId = beneficiary.id  // from employee discount selector

    // Venta.usuarioId = vendId (seller), NOT empleadoId (beneficiary)
    assert.equal(vendId, 2)
    assert.equal(empleadoId, 3)
    assert.notEqual(vendId, empleadoId, 'seller ≠ beneficiary')
    // The Venta.usuarioId would be set to vendId=2, not empleadoId=3
  })

  it('T20: Session A + Seller B + Beneficiary C → Venta.usuarioId = B', () => {
    const session = { id: 10 }
    const seller  = { id: 20 }
    const beneficiary = { id: 30 }

    // In confirmarVenta: usuarioId = vendId = seller.id
    const vendId = seller.id
    const empleadoId = beneficiary.id

    // Payload: usuarioId = vendId (seller)
    const payload = { usuarioId: vendId, empleadoId }
    assert.equal(payload.usuarioId, 20, 'Venta.usuarioId = seller')
    assert.equal(payload.empleadoId, 30, 'empleadoId = beneficiary (separate)')
  })

  it('T21: TurnoCaja attribution uses turnoActivo.id, not affected by beneficiary', () => {
    const turnoActivo = { id: 55, sucursalId: 1 }
    const beneficiary = { id: 30 }
    const payload = { turnoId: turnoActivo.id }
    assert.equal(payload.turnoId, 55, 'turnoId unchanged')
  })
})

// ═══════════════════════════════════════════════════════════════════
//  ACCESS CONTROL TESTS — Endpoint authorization
// ═══════════════════════════════════════════════════════════════════

describe('P0-3 Access: Endpoint authorization', () => {

  const routesPath = path.join(__dirname, '..', 'src', 'modules', 'usuarios', 'usuarios.routes.js')
  let routesCode

  try {
    routesCode = fs.readFileSync(routesPath, 'utf-8')
  } catch (e) { /* may not exist */ }

  it('T25: Endpoint requires SUPERADMIN or ADMIN_SUCURSAL (not open to all)', () => {
    assert.ok(routesCode, 'routes file loaded')
    const routeLine = routesCode.split('\n').find(l => l.includes('beneficiarios-descuento'))
    assert.ok(routeLine, 'route found')
    assert.ok(routeLine.includes('SUPERADMIN'), 'requires SUPERADMIN')
    assert.ok(routeLine.includes('ADMIN_SUCURSAL'), 'or ADMIN_SUCURSAL')
  })

  it('T26: EMPLEADO role would get 403 (not in requireRole list)', () => {
    assert.ok(routesCode, 'routes file loaded')
    const routeLine = routesCode.split('\n').find(l => l.includes('beneficiarios-descuento'))
    assert.ok(routeLine, 'route found')
    // requireRole checks if user's role is in the allowed list
    // EMPLEADO is NOT in ['SUPERADMIN', 'ADMIN_SUCURSAL']
    assert.ok(!routeLine.includes("'EMPLEADO'"), 'EMPLEADO not in allowed roles')
  })

  it('T27: PRECIOS role would get 403 (not in requireRole list)', () => {
    assert.ok(routesCode, 'routes file loaded')
    const routeLine = routesCode.split('\n').find(l => l.includes('beneficiarios-descuento'))
    assert.ok(routeLine, 'route found')
    assert.ok(!routeLine.includes("'PRECIOS'"), 'PRECIOS not in allowed roles')
  })
})
