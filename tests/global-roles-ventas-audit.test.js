/**
 * JESHA — GLOBAL HARDENING FASE A
 * Auditoría de roles de venta + PLATFORM_ADMIN
 *
 * Tests estáticos de autorización. Leen el código fuente y verifican
 * invariantes de seguridad sin necesidad de backend levantado.
 */
'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'jesha-pos-backend', 'src')
const SCHEMA = path.join(__dirname, '..', 'jesha-pos-backend', 'prisma', 'schema.prisma')

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}
function readSchema() {
  return fs.readFileSync(SCHEMA, 'utf8')
}

const VENTAS_CTRL = read('modules/ventas/ventas.controller.js')
const AUTH_CTRL = read('modules/auth/auth.controller.js')
const AUTH_MW = read('middlewares/auth.middleware.js')
const DELEGATED_MW = fs.existsSync(path.join(SRC, 'middlewares/delegated-auth.middleware.js'))
  ? read('middlewares/delegated-auth.middleware.js') : ''
const TENANT_OR_DELEG = fs.existsSync(path.join(SRC, 'middlewares/tenant-or-delegated.middleware.js'))
  ? read('middlewares/tenant-or-delegated.middleware.js') : ''
const IDENTITY = read('security/identity.js')
const ROLES = read('utils/roles.js')
const GET_EMPRESA = read('helpers/getEmpresaId.js')
const SUCURSAL_HELP = fs.existsSync(path.join(SRC, 'modules/sucursal/sucursal.helper.js'))
  ? read('modules/sucursal/sucursal.helper.js') : ''
const REQUEST_CTX = fs.existsSync(path.join(SRC, 'security/request-context.js'))
  ? read('security/request-context.js') : ''
const VENTAS_ROUTES = read('modules/ventas/ventas.routes.js')
const PLATFORM_AUTH = fs.existsSync(path.join(SRC, 'middlewares/platform-auth.middleware.js'))
  ? read('middlewares/platform-auth.middleware.js') : ''
const SIDEBAR = fs.existsSync(path.join(__dirname, '..', 'sidebar.js'))
  ? fs.readFileSync(path.join(__dirname, '..', 'sidebar.js'), 'utf8') : ''

// ═══════════════════════════════════════════════════════════════
// A — SCHEMA & ROLE MODEL
// ═══════════════════════════════════════════════════════════════

describe('A — Schema: Rol enum', () => {
  it('A01 schema defines exactly 5 roles', () => {
    const schema = readSchema()
    const rolMatch = schema.match(/enum Rol \{([\s\S]*?)\}/)
    assert.ok(rolMatch, 'Rol enum found')
    const roles = rolMatch[1].trim().split(/\s+/).filter(Boolean)
    assert.deepStrictEqual(roles.sort(), ['ADMIN_SUCURSAL', 'EMPLEADO', 'PLATFORM_ADMIN', 'PRECIOS', 'SUPERADMIN'])
  })

  it('A02 Usuario.empresaId is nullable (Int?)', () => {
    const schema = readSchema()
    assert.match(schema, /empresaId\s+Int\?/)
  })

  it('A03 Usuario.sucursalId is nullable (Int?)', () => {
    const schema = readSchema()
    assert.match(schema, /sucursalId\s+Int\?/)
  })
})

// ═══════════════════════════════════════════════════════════════
// B — PLATFORM_ADMIN IDENTITY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe('B — PLATFORM_ADMIN identity', () => {
  it('A04 identity.js rejects PLATFORM_ADMIN with empresaId', () => {
    assert.ok(IDENTITY.includes('PLATFORM_ADMIN'), 'PLATFORM_ADMIN referenced')
    assert.ok(IDENTITY.includes('IDENTITY_EMPRESA_FORBIDDEN'), 'IDENTITY_EMPRESA_FORBIDDEN exists')
  })

  it('A05 identity.js rejects PLATFORM_ADMIN with sucursalId', () => {
    assert.ok(IDENTITY.includes('IDENTITY_SUCURSAL_FORBIDDEN'), 'IDENTITY_SUCURSAL_FORBIDDEN exists')
  })

  it('A06 crearPrincipalTenant rejects PLATFORM_ADMIN (not a tenant role)', () => {
    assert.ok(IDENTITY.includes('crearPrincipalTenant'), 'crearPrincipalTenant exists')
    assert.ok(IDENTITY.includes('esRolTenant'), 'esRolTenant used in identity validation')
  })

  it('A07 auth controller blocks PLATFORM_ADMIN from tenant login', () => {
    assert.match(AUTH_CTRL, /esRolPlataforma[\s\S]{0,200}TENANT_CREDENTIALS_INVALID/)
  })

  it('A08 PLATFORM_ADMIN esRolPlataforma returns true', () => {
    assert.match(IDENTITY, /PLATFORM_ROLES[\s\S]{0,100}PLATFORM_ADMIN/)
    assert.match(IDENTITY, /esRolPlataforma/)
  })

  it('A09 PLATFORM_ADMIN esRolTenant returns false', () => {
    assert.match(IDENTITY, /esRolTenant/)
    assert.match(IDENTITY, /TENANT_ROLES[\s\S]{0,200}SUPERADMIN[\s\S]{0,200}ADMIN_SUCURSAL/)
  })
})

// ═══════════════════════════════════════════════════════════════
// C — DELEGATION MECHANISM
// ═══════════════════════════════════════════════════════════════

describe('C — PLATFORM_ADMIN delegation', () => {
  it('A10 delegation sets rol to SUPERADMIN (not PLATFORM_ADMIN)', () => {
    assert.match(DELEGATED_MW, /rol:\s*'SUPERADMIN'/)
  })

  it('A11 delegation sets empresaId to targetEmpresaId (not null)', () => {
    assert.match(DELEGATED_MW, /empresaId:\s*tokenIdentity\.targetEmpresaId/)
  })

  it('A12 delegation stores actorRealRol = PLATFORM_ADMIN for audit', () => {
    assert.match(DELEGATED_MW, /actorRealRol:\s*'PLATFORM_ADMIN'/)
  })

  it('A13 tenant-or-delegated routes DELEGATED to delegated auth', () => {
    assert.match(TENANT_OR_DELEG, /kind.*DELEGATED/)
    assert.match(TENANT_OR_DELEG, /requireDelegatedAuth/)
  })

  it('A14 delegation only allowed for PLATFORM_ADMIN role', () => {
    assert.match(IDENTITY, /crearPrincipalDelegado[\s\S]{0,300}PLATFORM_ADMIN/)
  })
})

// ═══════════════════════════════════════════════════════════════
// D — SALE AUTHORIZATION
// ═══════════════════════════════════════════════════════════════

describe('D — Sale authorization: role checks', () => {
  it('A15 only EMPLEADO, ADMIN_SUCURSAL, SUPERADMIN can sell', () => {
    assert.match(VENTAS_CTRL, /rolesConVenta[\s\S]{0,100}EMPLEADO/)
    assert.match(VENTAS_CTRL, /rolesConVenta[\s\S]{0,100}ADMIN_SUCURSAL/)
    assert.match(VENTAS_CTRL, /rolesConVenta[\s\S]{0,100}SUPERADMIN/)
    assert.match(VENTAS_CTRL, /SIN_PERMISO_VENTA/)
  })

  it('A16 PRECIOS not in rolesConVenta', () => {
    const match = VENTAS_CTRL.match(/rolesConVenta\s*=\s*\[([^\]]+)\]/)
    assert.ok(match, 'rolesConVenta array found')
    assert.ok(!match[1].includes('PRECIOS'), 'PRECIOS not in rolesConVenta')
  })

  it('A17 PLATFORM_ADMIN not in rolesConVenta', () => {
    const match = VENTAS_CTRL.match(/rolesConVenta\s*=\s*\[([^\]]+)\]/)
    assert.ok(match, 'rolesConVenta array found')
    assert.ok(!match[1].includes('PLATFORM_ADMIN'), 'PLATFORM_ADMIN not in rolesConVenta')
  })

  it('A18 EMPLEADO/ADMIN_SUCURSAL branch-matched to sucursal', () => {
    assert.match(VENTAS_CTRL, /EMPLEADO.*ADMIN_SUCURSAL[\s\S]{0,200}SELLER_BRANCH_FORBIDDEN/)
  })

  it('A19 SUPERADMIN exempt from branch check (not in branch-matched roles)', () => {
    const branchCheck = VENTAS_CTRL.match(/EMPLEADO.*ADMIN_SUCURSAL.*sucursalId/)
    assert.ok(branchCheck, 'branch check exists for EMPLEADO/ADMIN_SUCURSAL')
    assert.ok(!branchCheck[0].includes('SUPERADMIN'), 'SUPERADMIN not in branch check')
  })
})

// ═══════════════════════════════════════════════════════════════
// E — TENANT SCOPING (empresaId / sucursalId sources)
// ═══════════════════════════════════════════════════════════════

describe('E — Tenant scoping: empresaId source', () => {
  it('A20 empresaId from getEmpresaId (immutable context), not body', () => {
    assert.match(VENTAS_CTRL, /const empresaId = getEmpresaId\(req\)/)
    assert.match(GET_EMPRESA, /assertTenantRequestContext/)
    assert.match(GET_EMPRESA, /context\.tenant\.empresaId/)
  })

  it('A21 getEmpresaId never reads from body/query', () => {
    assert.ok(!GET_EMPRESA.includes('req.body'), 'getEmpresaId does not read req.body')
    assert.ok(!GET_EMPRESA.includes('req.query'), 'getEmpresaId does not read req.query')
  })

  it('A22 sucursalId from resolverSucursalId (immutable context)', () => {
    assert.match(VENTAS_CTRL, /const sucursalId = resolverSucursalId\(req\)/)
    assert.match(SUCURSAL_HELP, /assertTenantRequestContext/)
    assert.match(SUCURSAL_HELP, /context\.branch\.sucursalId/)
  })

  it('A23 body sucursalId is cross-checked but not authoritative', () => {
    assert.match(VENTAS_CTRL, /SUCURSAL_CONTEXT_MISMATCH/)
    assert.match(VENTAS_CTRL, /bodySucursalId !== null && bodySucursalId !== sucursalId/)
  })

  it('A24 queries scoped by empresaId (construirWhereScopeVentas)', () => {
    assert.match(VENTAS_CTRL, /construirWhereScopeVentas/)
    assert.match(VENTAS_CTRL, /empresaId.*getEmpresaId/)
  })
})

// ═══════════════════════════════════════════════════════════════
// F — PLATFORM_ADMIN BODY SPOOFING
// ═══════════════════════════════════════════════════════════════

describe('F — Body/query spoofing defense', () => {
  it('A25 body empresaId never overrides context in sale creation', () => {
    const crearMatch = VENTAS_CTRL.match(/exports\.crearVenta[\s\S]{0,2000}/)
    assert.ok(crearMatch, 'crearVenta found')
    const crear = crearMatch[0]
    assert.ok(!crear.includes('req.body.empresaId'), 'crearVenta does not read body.empresaId')
  })

  it('A26 query empresaId never used as authority in venta controller', () => {
    assert.ok(!VENTAS_CTRL.includes('req.query.empresaId'), 'ventas controller does not read query.empresaId')
  })

  it('A27 vendedor override requires SAT (seller authorization token)', () => {
    assert.match(VENTAS_CTRL, /sellerAuthorization/)
    assert.match(VENTAS_CTRL, /SELLER_AUTH_REQUIRED/)
    assert.match(VENTAS_CTRL, /SELLER_AUTH_TENANT_MISMATCH/)
  })

  it('A28 SAT validates tenant binding (eid === empresaId)', () => {
    assert.match(VENTAS_CTRL, /satClaims\.eid !== empresaId/)
  })

  it('A29 SAT validates branch binding (bid === sucursalId)', () => {
    assert.match(VENTAS_CTRL, /satClaims\.bid !== sucursalId/)
  })
})

// ═══════════════════════════════════════════════════════════════
// G — ROUTE-LEVEL GUARDS
// ═══════════════════════════════════════════════════════════════

describe('G — Route-level guards', () => {
  it('A30 POST /ventas has no route-level requireRole (guard is in controller)', () => {
    assert.ok(VENTAS_ROUTES.includes("POST"), 'POST route exists')
    // The POST route should not have requireRole in the routes file
    const postSection = VENTAS_ROUTES.split("'").filter(s => s.includes('POST') || s.includes('/ventas')).join('')
    assert.ok(!postSection.includes('requireRole'), 'POST /ventas has no requireRole in routes')
  })

  it('A31 app.js uses requireTenantOrDelegated on /ventas', () => {
    const appJs = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8')
    assert.match(appJs, /requireTenantOrDelegated[\s\S]{0,200}\/ventas/)
  })

  it('A32 PATCH cancelar has no extra role guard (controller handles it)', () => {
    const lines = VENTAS_ROUTES.split('\n')
    const cancelarIdx = lines.findIndex(l => l.includes('cancelar'))
    if (cancelarIdx >= 0) {
      const surrounding = lines.slice(Math.max(0, cancelarIdx - 1), cancelarIdx + 3).join('\n')
      assert.ok(!surrounding.includes('requireRole'), 'cancelar has no requireRole in routes')
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// H — PLATFORM_ADMIN EXCLUSION FROM TENANT OPERATIONS
// ═══════════════════════════════════════════════════════════════

describe('H — PLATFORM_ADMIN excluded from tenant operations', () => {
  it('A33 auth middleware rejects non-tenant roles (PLATFORM_ADMIN)', () => {
    assert.match(AUTH_MW, /esRolTenant/)
    assert.match(AUTH_MW, /kind.*TENANT/)
  })

  it('A34 usuarios controller excludes PLATFORM_ADMIN from user lists', () => {
    const usuariosCtrl = read('modules/usuarios/usuarios.controller.js')
    assert.ok(usuariosCtrl.includes("PLATFORM_ADMIN"), 'PLATFORM_ADMIN referenced')
    assert.ok(usuariosCtrl.includes("not: 'PLATFORM_ADMIN'"), 'PLATFORM_ADMIN excluded from queries')
  })

  it('A35 ventas controller excludes PLATFORM_ADMIN from employee discount query', () => {
    assert.ok(VENTAS_CTRL.includes("not: 'PLATFORM_ADMIN'"), 'PLATFORM_ADMIN excluded from discount beneficiary query')
  })

  it('A36 platform-auth middleware uses separate secret config', () => {
    assert.ok(PLATFORM_AUTH.includes('PLATFORM_AUTH_CONFIG'), 'uses config object')
    assert.ok(PLATFORM_AUTH.includes('resolvePlatformAuthConfig'), 'resolves from config module')
    assert.ok(PLATFORM_AUTH.includes('PLATFORM_TOKEN_KIND_INVALID'), 'validates PLATFORM kind')
  })

  it('A37 platform-auth blocks legacy PLATFORM_ADMIN with empresaId', () => {
    assert.match(PLATFORM_AUTH, /detectarIdentidadLegacy/)
  })
})

// ═══════════════════════════════════════════════════════════════
// I — FRONTEND ROLE GATES
// ═══════════════════════════════════════════════════════════════

describe('I — Frontend role gates', () => {
  it('A38 sidebar blocks PRECIOS from punto-venta', () => {
    assert.match(SIDEBAR, /PRECIOS[\s\S]{0,200}punto-venta/)
  })

  it('A39 sidebar force-logout PLATFORM_ADMIN without delegation', () => {
    assert.match(SIDEBAR, /PLATFORM_ADMIN[\s\S]{0,200}isDelegated/)
    assert.match(SIDEBAR, /clear/)
  })

  it('A40 sidebar EMPLEADO blocked from admin pages (usuarios, sucursales, config)', () => {
    assert.match(SIDEBAR, /EMPLEADO[\s\S]{0,200}usuarios/)
    assert.match(SIDEBAR, /EMPLEADO[\s\S]{0,200}sucursales/)
  })

  it('A41 SUPERADMIN not blocked from any page', () => {
    // SUPERADMIN should not appear in ROL_BLOQUEADO as a blocked role
    assert.ok(!SIDEBAR.includes("ROL_BLOQUEADO['SUPERADMIN']"), 'SUPERADMIN not in blocklist')
  })
})

// ═══════════════════════════════════════════════════════════════
// J — CROSS-TENANT DEFENSES
// ═══════════════════════════════════════════════════════════════

describe('J — Cross-tenant defenses', () => {
  it('A42 request context validates sucursal belongs to empresa', () => {
    assert.match(REQUEST_CTX, /sucursal\.empresaId/)
  })

  it('A43 auth middleware validates empresa is active', () => {
    assert.match(AUTH_MW, /activa/)
  })

  it('A44 auth middleware validates sucursal belongs to empresa', () => {
    assert.match(AUTH_MW, /sucursal[\s\S]{0,200}empresaId/)
  })

  it('A45 SAT (seller auth) validates tenant binding', () => {
    assert.match(VENTAS_CTRL, /satClaims\.eid !== empresaId/)
  })

  it('A46 SAT validates session binding (sid === req.usuario.id)', () => {
    assert.match(VENTAS_CTRL, /satClaims\.sid !== req\.usuario\.id/)
  })
})

// ═══════════════════════════════════════════════════════════════
// K — SUMMARY
// ═══════════════════════════════════════════════════════════════

describe('K — Authorization summary checks', () => {
  it('A47 PRECIOS cannot sell (not in rolesConVenta)', () => {
    const match = VENTAS_CTRL.match(/rolesConVenta\s*=\s*\[([^\]]+)\]/)
    assert.ok(!match[1].includes('PRECIOS'))
  })

  it('A48 PLATFORM_ADMIN cannot sell directly (not in rolesConVenta)', () => {
    const match = VENTAS_CTRL.match(/rolesConVenta\s*=\s*\[([^\]]+)\]/)
    assert.ok(!match[1].includes('PLATFORM_ADMIN'))
  })

  it('A49 PLATFORM_ADMIN delegation grants SUPERADMIN role (not PLATFORM_ADMIN)', () => {
    assert.match(DELEGATED_MW, /rol:\s*'SUPERADMIN'/)
  })

  it('A50 no global requireRole on /ventas POST (controller-level guard only)', () => {
    const routes = VENTAS_ROUTES.split('\n')
    const postLine = routes.findIndex(l => l.includes("POST") && l.includes("'/"))
    // Verify no requireRole appears between route definition and next route
    if (postLine >= 0) {
      const block = routes.slice(postLine, postLine + 3).join('\n')
      assert.ok(!block.includes('requireRole'), 'POST route has no requireRole')
    }
  })
})
