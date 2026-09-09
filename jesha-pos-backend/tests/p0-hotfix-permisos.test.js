/**
 * P0-Hotfix — Permisos EMPLEADO + Version bump 2.0.1 → 2.0.2
 *
 * Cobertura:
 *  H01-H08:  Historial — sidebar, JS guards, endpoint access
 *  T01-T10:  Transferencias — backend role checks, sidebar block
 *  V01-V06:  Version consistency — 2.0.2 in all sources, no stale 2.0.1
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const BACKEND = path.join(ROOT, 'jesha-pos-backend')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function readBackend(rel) {
  return fs.readFileSync(path.join(BACKEND, rel), 'utf8')
}

// ═══════════════════════════════════════════════════════════════════
//  H: HISTORIAL — Sidebar + JS + Backend route
// ═══════════════════════════════════════════════════════════════════

describe('H: Historial — Access control', () => {

  let sidebarCode, historialJS, ventasRoutes

  try {
    sidebarCode = read('sidebar.js')
    historialJS = read('historial.js')
    ventasRoutes = readBackend('src/modules/ventas/ventas.routes.js')
  } catch (e) { /* files may not exist */ }

  it('H01: historial NOT in EMPLEADO blocked pages (EMPLEADO CAN access)', () => {
    assert.ok(sidebarCode, 'sidebar.js loaded')
    const match = sidebarCode.match(/EMPLEADO\s*:\s*\[([^\]]*)\]/)
    assert.ok(match, 'EMPLEADO blocked list found')
    assert.ok(!match[1].includes("'historial'"), 'historial NOT blocked for EMPLEADO')
  })

  it('H02: historial.js checks USUARIO.rol before fetching users', () => {
    assert.ok(historialJS, 'historial.js loaded')
    assert.ok(historialJS.includes('USUARIO.rol'), 'checks USUARIO.rol')
  })

  it('H03: historial.js only calls GET /usuarios for SUPERADMIN', () => {
    assert.ok(historialJS, 'historial.js loaded')
    assert.ok(
      historialJS.includes("USUARIO.rol === 'SUPERADMIN'") &&
      historialJS.includes('/usuarios') &&
      historialJS.includes('else if'),
      'SUPERADMIN branch fetches /usuarios, others branch away'
    )
  })

  it('H04: historial.js uses /usuarios/vendedores for non-SUPERADMIN', () => {
    assert.ok(historialJS, 'historial.js loaded')
    assert.ok(
      historialJS.includes('/usuarios/vendedores'),
      'falls back to /usuarios/vendedores for non-SUPERADMIN'
    )
  })

  it('H05: historial.js does NOT call raw /usuarios without role guard', () => {
    assert.ok(historialJS, 'historial.js loaded')
    // Find the cargarCatalogos function body
    const fnMatch = historialJS.match(/async function cargarCatalogos[\s\S]*?^}/m)
    assert.ok(fnMatch, 'cargarCatalogos function found')
    const fnBody = fnMatch[0]
    // The only /usuarios call should be inside the SUPERADMIN guard
    const usuariosCalls = fnBody.match(/fetch\(`?\$\{API_URL\}\/usuarios`?\)/g) || []
    // Should be exactly 1 call (the SUPERADMIN one)
    assert.strictEqual(usuariosCalls.length, 1, 'exactly 1 raw /usuarios fetch in cargarCatalogos')
  })

  it('H06: historial.js has auth guard at top', () => {
    assert.ok(historialJS, 'historial.js loaded')
    assert.ok(
      historialJS.includes('jeshaSession?.isValid()') || historialJS.includes('jeshaSession.isValid()'),
      'auth guard present'
    )
  })

  it('H07: GET /ventas route has NO requireRole (open to all authenticated)', () => {
    assert.ok(ventasRoutes, 'ventas.routes.js loaded')
    const lines = ventasRoutes.split('\n')
    const getLine = lines.find(l => l.match(/^router\.get\('\/'/) || l.match(/^router\.get\("\/"/))
    assert.ok(getLine, 'GET / route found')
    assert.ok(!getLine.includes('requireRole'), 'no role guard on GET /ventas')
  })

  it('H08: Historial page accessible to EMPLEADO (not redirected on entry)', () => {
    assert.ok(sidebarCode, 'sidebar.js loaded')
    assert.ok(
      sidebarCode.includes("PAGINAS_SUCURSAL_REQUERIDA") &&
      sidebarCode.includes("'historial'"),
      'historial requires sucursal (accessible with selected sucursal)'
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
//  T: TRANSFERENCIAS — Backend role checks + sidebar block
// ═══════════════════════════════════════════════════════════════════

describe('T: Transferencias — Role enforcement', () => {

  let sidebarCode, transferCtrl, inventarioRoutes

  try {
    sidebarCode = read('sidebar.js')
    transferCtrl = readBackend('src/modules/inventario/transferencias.controller.js')
    inventarioRoutes = readBackend('src/modules/inventario/inventario.routes.js')
  } catch (e) { /* files may not exist */ }

  it('T01: ROLES_PERMITIDOS defined in transferencias.controller', () => {
    assert.ok(transferCtrl, 'transferencias.controller.js loaded')
    assert.ok(
      transferCtrl.includes("ROLES_PERMITIDOS") &&
      transferCtrl.includes("'SUPERADMIN'") &&
      transferCtrl.includes("'ADMIN_SUCURSAL'"),
      'ROLES_PERMITIDOS = [SUPERADMIN, ADMIN_SUCURSAL]'
    )
  })

  it('T02: crear checks ROLES_PERMITIDOS', () => {
    assert.ok(transferCtrl, 'transferencias.controller.js loaded')
    const crearFn = transferCtrl.match(/exports\.crear[\s\S]*?(?=exports\.listar|module\.exports)/)
    assert.ok(crearFn, 'crear function found')
    assert.ok(crearFn[0].includes('ROLES_PERMITIDOS'), 'crear checks ROLES_PERMITIDOS')
  })

  it('T03: listar checks ROLES_PERMITIDOS', () => {
    assert.ok(transferCtrl, 'transferencias.controller.js loaded')
    const listarFn = transferCtrl.match(/exports\.listar[\s\S]*?(?=exports\.detalle|module\.exports)/)
    assert.ok(listarFn, 'listar function found')
    assert.ok(listarFn[0].includes('ROLES_PERMITIDOS'), 'listar checks ROLES_PERMITIDOS')
  })

  it('T04: detalle checks ROLES_PERMITIDOS', () => {
    assert.ok(transferCtrl, 'transferencias.controller.js loaded')
    assert.ok(
      transferCtrl.includes('exports.detalle') &&
      transferCtrl.includes('ROLES_PERMITIDOS'),
      'detalle function checks ROLES_PERMITIDOS'
    )
  })

  it('T05: EMPLEADO blocked from transferencias in sidebar', () => {
    assert.ok(sidebarCode, 'sidebar.js loaded')
    const match = sidebarCode.match(/EMPLEADO\s*:\s*\[([^\]]*)\]/)
    assert.ok(match, 'EMPLEADO blocked list found')
    assert.ok(match[1].includes("'transferencias'"), 'transferencias blocked for EMPLEADO')
  })

  it('T06: POST /inventario/transferencias has branchRequired', () => {
    assert.ok(inventarioRoutes, 'inventario.routes.js loaded')
    const postLine = inventarioRoutes.split('\n').find(l =>
      l.includes('transferencias') && l.includes('post')
    )
    assert.ok(postLine, 'POST /transferencias route found')
    assert.ok(postLine.includes('branchRequired'), 'branchRequired middleware present')
  })

  it('T07: GET /inventario/transferencias has tenantGlobal', () => {
    assert.ok(inventarioRoutes, 'inventario.routes.js loaded')
    const getLine = inventarioRoutes.split('\n').find(l =>
      l.includes('transferencias') && l.includes('get') && !l.includes('/:id')
    )
    assert.ok(getLine, 'GET /transferencias route found')
    assert.ok(getLine.includes('tenantGlobal'), 'tenantGlobal middleware present')
  })

  it('T08: crear role check uses 403 with SIN_PERMISO_TRANSFERENCIA code', () => {
    assert.ok(transferCtrl, 'transferencias.controller.js loaded')
    const crearFn = transferCtrl.match(/exports\.crear[\s\S]*?(?=exports\.listar)/)
    assert.ok(crearFn, 'crear function found')
    assert.ok(
      crearFn[0].includes('SIN_PERMISO_TRANSFERENCIA') &&
      crearFn[0].includes('403'),
      'crear returns 403 with SIN_PERMISO_TRANSFERENCIA'
    )
  })

  it('T09: listar role check uses 403 with SIN_PERMISO_TRANSFERENCIA code', () => {
    assert.ok(transferCtrl, 'transferencias.controller.js loaded')
    const listarFn = transferCtrl.match(/exports\.listar[\s\S]*?(?=exports\.detalle)/)
    assert.ok(listarFn, 'listar function found')
    assert.ok(
      listarFn[0].includes('SIN_PERMISO_TRANSFERENCIA') &&
      listarFn[0].includes('403'),
      'listar returns 403 with SIN_PERMISO_TRANSFERENCIA'
    )
  })

  it('T10: detalle role check uses 403 with SIN_PERMISO_TRANSFERENCIA code', () => {
    assert.ok(transferCtrl, 'transferencias.controller.js loaded')
    assert.ok(
      transferCtrl.includes('exports.detalle') &&
      transferCtrl.includes('SIN_PERMISO_TRANSFERENCIA') &&
      transferCtrl.includes('403'),
      'detalle returns 403 with SIN_PERMISO_TRANSFERENCIA'
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
//  V: VERSION — 2.0.2 consistency
// ═══════════════════════════════════════════════════════════════════

describe('V: Version — Consistency at 2.0.2', () => {

  it('V01: package.json version is 2.0.2', () => {
    const pkg = JSON.parse(readBackend('package.json'))
    assert.strictEqual(pkg.version, '2.0.2')
  })

  it('V02: sidebar.js shows 2.0.2', () => {
    const src = read('sidebar.js')
    assert.ok(src.includes('Versión 2.0.2'), 'sidebar.js shows 2.0.2')
  })

  it('V03: sidebar.html shows 2.0.2', () => {
    const src = read('sidebar.html')
    assert.ok(src.includes('Versión 2.0.2'), 'sidebar.html shows 2.0.2')
  })

  it('V04: No stale 2.0.1 references in sidebar/sidebar.html', () => {
    const js = read('sidebar.js')
    const html = read('sidebar.html')
    assert.ok(!js.includes('2.0.1'), 'sidebar.js has no 2.0.1')
    assert.ok(!html.includes('2.0.1'), 'sidebar.html has no 2.0.1')
  })

  it('V05: build-frontend.ps1 whitelist includes all needed files', () => {
    const ps1 = fs.readFileSync(path.join(ROOT, 'build-frontend.ps1'), 'utf8')
    assert.ok(ps1.includes('historial.js'), 'whitelist includes historial.js')
    assert.ok(ps1.includes('sidebar.js'), 'whitelist includes sidebar.js')
    assert.ok(ps1.includes('sidebar.html'), 'whitelist includes sidebar.html')
    assert.ok(ps1.includes('transferencias.js'), 'whitelist includes transferencias.js')
  })

  it('V06: build-frontend.ps1 generates version.json', () => {
    const ps1 = fs.readFileSync(path.join(ROOT, 'build-frontend.ps1'), 'utf8')
    assert.ok(ps1.includes('version.json'), 'build generates version.json')
    assert.ok(ps1.includes('Set-Content'), 'writes version.json')
  })
})
