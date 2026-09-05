'use strict'

process.env.TENANT_JWT_SECRET = process.env.TENANT_JWT_SECRET || 'tg-test-tenant-secret-'.padEnd(64, 't')
process.env.TENANT_JWT_ISSUER = process.env.TENANT_JWT_ISSUER || 'tg-test-issuer'
process.env.TENANT_JWT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE || 'tg-test-audience'
process.env.TENANT_JWT_TTL = process.env.TENANT_JWT_TTL || '15m'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it, before } = require('node:test')

// ── Helpers ─────────────────────────────────────────────────────────
const SRC = path.resolve(__dirname, '..', 'src')

function readSource(relativePath) {
  return fs.readFileSync(path.join(SRC, relativePath), 'utf-8')
}

function countPatterns(text, regex) {
  const matches = text.match(regex)
  return matches ? matches.length : 0
}

function hasPattern(text, regex) {
  return regex.test(text)
}

// Given a router stack layer array, find route layers (those with .route)
function routeLayers(stack) {
  return stack.filter(l => l.route)
}

// Given a route layer, get its method+path handlers
function routeHandlers(layer) {
  if (!layer.route || !layer.route.stack) return []
  return layer.route.stack.map(s => ({ method: s.method, handle: s.handle }))
}

// Check if a router stack has middleware at the router.use level
function useMiddlewareNames(stack) {
  return stack
    .filter(l => !l.route)
    .map(l => l.handle.name || '(anonymous)')
}

// Check if route-level stack contains a handler with given name
function routeHasHandlerName(layer, name) {
  if (!layer.route || !layer.route.stack) return false
  return layer.route.stack.some(s => s.handle && s.handle.name === name)
}

// Find a route layer by method and path pattern
function findRoute(stack, method, pathPat) {
  return stack.find(l => {
    if (!l.route) return false
    return l.route.methods[method] && l.regexp.test(pathPat)
  })
}

// ── ROUTE TESTS (static source verification) ────────────────────────
describe('P0 — Tenant Global Scope', () => {

  describe('ROUTES — Middleware stack verification', () => {

    // Load real route modules
    let usuariosRouter, clientesRouter, proveedoresRouter, sucursalesRouter, facturasRouter, facturacionRouter
    before(() => {
      usuariosRouter = require('../src/modules/usuarios/usuarios.routes')
      clientesRouter = require('../src/modules/clientes/clientes.routes')
      proveedoresRouter = require('../src/modules/proveedores/proveedores.routes')
      sucursalesRouter = require('../src/modules/sucursal/sucursal.routes')
      facturasRouter = require('../src/modules/facturas/facturas.routes')
      facturacionRouter = require('../src/modules/facturacion/facturacion.routes')
    })

    it('1. Usuarios GET / uses requireTenantOrDelegated + requestContext via router.use and tenantGlobal on route', () => {
      const useMw = useMiddlewareNames(usuariosRouter.stack)
      assert.ok(useMw.includes('requireTenantOrDelegated'), 'requireTenantOrDelegated debe estar en router.use')
      assert.ok(useMw.includes('requestContext'), 'requestContext debe estar en router.use')

      const getRoot = findRoute(usuariosRouter.stack, 'get', '/')
      assert.ok(getRoot, 'GET / route should exist')
      assert.ok(routeHasHandlerName(getRoot, 'tenantGlobal'), 'tenantGlobal debe estar en GET /')
    })

    it('2. Usuarios GET /vendedores uses branchOptional on route', () => {
      const vendRoute = findRoute(usuariosRouter.stack, 'get', '/vendedores')
      assert.ok(vendRoute, 'GET /vendedores route should exist')
      assert.ok(routeHasHandlerName(vendRoute, 'branchOptional'), 'branchOptional debe estar en GET /vendedores')
    })

    it('3. Clientes uses requestContext + tenantGlobal via router.use', () => {
      const useMw = useMiddlewareNames(clientesRouter.stack)
      assert.ok(useMw.includes('requestContext'), 'requestContext debe estar en router.use')
      assert.ok(useMw.includes('tenantGlobal'), 'tenantGlobal debe estar en router.use')
    })

    it('4. Proveedores uses requestContext + tenantGlobal via router.use', () => {
      const useMw = useMiddlewareNames(proveedoresRouter.stack)
      assert.ok(useMw.includes('requestContext'), 'requestContext debe estar en router.use')
      assert.ok(useMw.includes('tenantGlobal'), 'tenantGlobal debe estar en router.use')
    })

    it('5. Sucursales GET / uses requestContext + tenantGlobal on route', () => {
      const sucStack = sucursalesRouter.stack
      const getRoot = findRoute(sucStack, 'get', '/')
      assert.ok(getRoot, 'GET / route should exist')
      const handlers = routeHandlers(getRoot).map(h => h.handle.name)
      assert.ok(handlers.includes('requestContext'), 'requestContext debe estar en GET /')
      assert.ok(handlers.includes('tenantGlobal'), 'tenantGlobal debe estar en GET /')
      assert.ok(handlers.includes('listar'), 'listar debe ser el handler final')
    })

    it('6. Facturas GET / uses requestContext via router.use + tenantGlobal on route', () => {
      const useMw = useMiddlewareNames(facturasRouter.stack)
      assert.ok(useMw.includes('requestContext'), 'requestContext debe estar en router.use')

      const getRoot = findRoute(facturasRouter.stack, 'get', '/')
      assert.ok(getRoot, 'GET / route should exist')
      assert.ok(routeHasHandlerName(getRoot, 'tenantGlobal'), 'tenantGlobal debe estar en GET /')
    })

    it('7. Resolver-timbrado GET /:id/timbrado-candidatos uses requestContext via router.use + branchOptional on route', () => {
      const timbRoute = findRoute(facturasRouter.stack, 'get', '/:id/timbrado-candidatos')
      assert.ok(timbRoute, 'GET /:id/timbrado-candidatos route should exist')

      // requestContext is on router.use, not on individual resolver routes
      const useMw = useMiddlewareNames(facturasRouter.stack)
      assert.ok(useMw.includes('requestContext'), 'requestContext debe estar en router.use')

      assert.ok(routeHasHandlerName(timbRoute, 'branchOptional'), 'branchOptional debe estar en GET /:id/timbrado-candidatos')
    })

    it('8. Facturar/api (publica) NO tiene requestContext', () => {
      const useMw = useMiddlewareNames(facturacionRouter.stack)
      assert.ok(!useMw.includes('requestContext'), 'requestContext NO debe estar en facturacion router.use')

      for (const layer of facturacionRouter.stack) {
        if (layer.route && layer.route.stack) {
          for (const s of layer.route.stack) {
            assert.notStrictEqual(s.handle.name, 'requestContext', 'requestContext NO debe estar en facturacion routes')
          }
        }
      }
    })
  })

  describe('MIDDLEWARE INTEGRITY', () => {
    it('9. requireTenantOrDelegated no esta duplicado en usuarios — solo en router.use, no en rutas individuales', () => {
      const src = readSource('modules/usuarios/usuarios.routes.js')
      // After router.use(requireTenantOrDelegated), it should NOT appear on individual routes
      const routeLines = src.split('\n')
      let afterUse = false
      for (const line of routeLines) {
        if (line.includes('router.use(requireTenantOrDelegated)')) {
          afterUse = true
          continue
        }
        if (afterUse && /\brouter\.(get|post|put|patch|delete)\b/.test(line) && line.includes('requireTenantOrDelegated')) {
          assert.fail('requireTenantOrDelegated esta duplicado en ruta individual: ' + line.trim())
        }
      }
      assert.ok(true)
    })

    it('10. requestContext esta antes de tenantGlobal en todas las rutas', () => {
      // clientes, proveedores: check the router.use(requestContext, tenantGlobal) line
      for (const mod of ['clientes', 'proveedores']) {
        const src = readSource(`modules/${mod}/${mod}.routes.js`)
        const useLine = src.split('\n').find(l => /router\.use\(requestContext/.test(l))
        assert.ok(useLine, `${mod}.routes.js debe tener router.use(requestContext, tenantGlobal)`)
        const reqIdx = useLine.indexOf('requestContext')
        const tenIdx = useLine.indexOf('tenantGlobal')
        assert.ok(reqIdx < tenIdx,
          `${mod}.routes.js: en la línea router.use, requestContext (pos ${reqIdx}) debe estar antes de tenantGlobal (pos ${tenIdx})`)
      }

      // usuarios: router.use(requestContext) en línea 8, tenantGlobal en rutas a partir de línea 11
      const uLines = readSource('modules/usuarios/usuarios.routes.js').split('\n')
      const uUseLine = uLines.findIndex(l => /router\.use\(requestContext\)/.test(l))
      const uFirstTenantLine = uLines.findIndex(l => /router\.(get|post|put|patch|delete).*tenantGlobal/.test(l))
      assert.ok(uUseLine >= 0, 'usuarios.routes.js debe tener router.use(requestContext)')
      assert.ok(uFirstTenantLine >= 0, 'usuarios.routes.js debe tener rutas con tenantGlobal')
      assert.ok(uUseLine < uFirstTenantLine,
        `usuarios.routes.js: requestContext en línea ${uUseLine + 1} debe estar antes de tenantGlobal en línea ${uFirstTenantLine + 1}`)

      // facturas: router.use(requestContext) en línea 21, tenantGlobal en rutas a partir de línea 24
      const fLines = readSource('modules/facturas/facturas.routes.js').split('\n')
      const fUseLine = fLines.findIndex(l => /router\.use\(requestContext\)/.test(l))
      const fFirstTenantLine = fLines.findIndex(l => /router\.(get|post|put|patch|delete).*tenantGlobal/.test(l))
      assert.ok(fUseLine >= 0, 'facturas.routes.js debe tener router.use(requestContext)')
      assert.ok(fFirstTenantLine >= 0, 'facturas.routes.js debe tener rutas con tenantGlobal')
      assert.ok(fUseLine < fFirstTenantLine,
        `facturas.routes.js: requestContext en línea ${fUseLine + 1} debe estar antes de tenantGlobal en línea ${fFirstTenantLine + 1}`)

      // sucursal: both on same route line
      const sSrc = readSource('modules/sucursal/sucursal.routes.js')
      const sUseLine = sSrc.split('\n').find(l => /router\.get\('\/'/.test(l))
      assert.ok(sUseLine, 'sucursal.routes.js debe tener router.get con tenantGlobal')
      const sReqIdx = sUseLine.indexOf('requestContext')
      const sTenIdx = sUseLine.indexOf('tenantGlobal')
      assert.ok(sReqIdx < sTenIdx,
        `sucursal.routes.js: en router.get("/"), requestContext (pos ${sReqIdx}) debe estar antes de tenantGlobal (pos ${sTenIdx})`)
    })
  })

  describe('USUARIOS', () => {
    it('11. listarVendedores usa branch context', () => {
      const src = readSource('modules/usuarios/usuarios.controller.js')
      // listarVendedores uses req.context.branch
      assert.ok(hasPattern(src, /req\.context/), 'usuarios.controller.js debe acceder a req.context')
      assert.ok(hasPattern(src, /\bbranch\b.*sucursalId/), 'listarVendedores debe usar branch.sucursalId')
    })

    it('12. empresaId del body rechazado — getEmpresaId solo usa contexto, nunca body', () => {
      const src = readSource('helpers/getEmpresaId.js')
      assert.ok(!hasPattern(src, /req\.body/), 'getEmpresaId nunca debe leer req.body')
      assert.ok(hasPattern(src, /req\.context/), 'getEmpresaId debe usar req.context')
    })

    it('13. empresaId del query rechazado — getEmpresaId solo usa contexto, nunca query', () => {
      const src = readSource('helpers/getEmpresaId.js')
      assert.ok(!hasPattern(src, /req\.query/), 'getEmpresaId nunca debe leer req.query')
    })
  })

  describe('CLIENTES / PROVEEDORES / SUCURSALES', () => {
    it('14a. clientes — usa getEmpresaId en lugar de req.usuario.empresaId', () => {
      const src = readSource('modules/clientes/clientes.controller.js')
      assert.ok(hasPattern(src, /getEmpresaId/), 'clientes.controller debe importar getEmpresaId')
      // Must have zero reads of req.usuario.empresaId directly
      assert.strictEqual(countPatterns(src, /req\.usuario\.empresaId/g), 0, 'clientes.controller NO debe usar req.usuario.empresaId')
    })

    it('14b. proveedores — usa getEmpresaId en lugar de req.usuario.empresaId', () => {
      const src = readSource('modules/proveedores/proveedores.controller.js')
      assert.ok(hasPattern(src, /getEmpresaId/), 'proveedores.controller debe importar getEmpresaId')
      assert.strictEqual(countPatterns(src, /req\.usuario\.empresaId/g), 0, 'proveedores.controller NO debe usar req.usuario.empresaId')
    })

    it('14c. sucursales — usa getEmpresaId en lugar de req.usuario.empresaId', () => {
      const src = readSource('modules/sucursal/sucursal.controller.js')
      assert.ok(hasPattern(src, /getEmpresaId/), 'sucursal.controller debe importar getEmpresaId')
      assert.strictEqual(countPatterns(src, /req\.usuario\.empresaId/g), 0, 'sucursal.controller NO debe usar req.usuario.empresaId')
    })

    it('15a. clientes — create scoped por empresaId via getEmpresaId', () => {
      const src = readSource('modules/clientes/clientes.controller.js')
      // crear function must call getEmpresaId and use it in data
      assert.ok(hasPattern(src, /getEmpresaId\(req\)/), 'clientes.controller debe llamar getEmpresaId(req)')
    })

    it('15b. proveedores — listar scoped por empresaId via getEmpresaId', () => {
      const src = readSource('modules/proveedores/proveedores.controller.js')
      assert.ok(hasPattern(src, /getEmpresaId\(req\)/), 'proveedores.controller debe llamar getEmpresaId(req)')
    })

    it('15c. sucursales — listar scoped por empresaId via getEmpresaId', () => {
      const src = readSource('modules/sucursal/sucursal.controller.js')
      assert.ok(hasPattern(src, /getEmpresaId\(req\)/), 'sucursal.controller debe llamar getEmpresaId(req)')
    })
  })

  describe('TIMBRADO — scope enforcement', () => {
    let resolverSrc
    before(() => {
      resolverSrc = readSource('modules/facturas/resolver-timbrado.controller.js')
    })

    it('16. empresaId body no tiene autoridad en resolver-timbrado', () => {
      assert.ok(hasPattern(resolverSrc, /empresaId.*no.*acept.*body/), 'Debe rechazar empresaId en body')
    })

    it('17. sucursalId body no tiene autoridad en resolver-timbrado', () => {
      assert.ok(hasPattern(resolverSrc, /sucursalId.*no.*acept.*body/), 'Debe rechazar sucursalId en body')
    })

    it('18. empresaId desde contexto usado en resolver-timbrado', () => {
      assert.ok(hasPattern(resolverSrc, /getEmpresaId/), 'resolver-timbrado debe usar getEmpresaId')
      assert.ok(hasPattern(resolverSrc, /req\.context/), 'resolver-timbrado debe usar req.context')
    })
  })

  describe('FRONTERA — PLATFORM_ADMIN boundaries', () => {
    it('19. PLATFORM_ADMIN sigue rechazado para contextos tenant', () => {
      const { TENANT_ROLES, esRolTenant } = require('../src/security/identity')
      assert.strictEqual(esRolTenant('PLATFORM_ADMIN'), false, 'PLATFORM_ADMIN NO es rol tenant')
      assert.ok(!TENANT_ROLES.includes('PLATFORM_ADMIN'), 'PLATFORM_ADMIN NO debe estar en TENANT_ROLES')
    })

    it('20. No reaparece autorizacion tenant de PLATFORM_ADMIN — request-context rechaza PLATFORM_ADMIN', () => {
      const { assertTenantRequestContext, RequestContextError } = require('../src/security/request-context')

      // Un contexto válido pero con actor.rol = PLATFORM_ADMIN debe ser rechazado
      const badCtx = Object.freeze({
        version: 1,
        kind: 'TENANT',
        actor: { id: 1, rol: 'PLATFORM_ADMIN' },
        tenant: { empresaId: 1 },
        branch: { mode: 'NONE', sucursalId: null }
      })

      assert.throws(
        () => assertTenantRequestContext(badCtx),
        RequestContextError,
        'PLATFORM_ADMIN en rol de actor debe lanzar RequestContextError'
      )
    })

    it('21. RequestContext conserva shape esperado', () => {
      const {
        buildTenantRequestContext,
        BRANCH_MODE,
        REQUEST_CONTEXT_KIND
      } = require('../src/security/request-context')

      const usuario = { id: 42, rol: 'SUPERADMIN', activo: true, empresaId: 5, sucursalId: null }

      const ctx = buildTenantRequestContext({ usuario, requestedSucursalId: null, sucursal: null })

      assert.strictEqual(ctx.version, 1)
      assert.strictEqual(ctx.kind, REQUEST_CONTEXT_KIND.TENANT)
      assert.strictEqual(ctx.actor.id, 42)
      assert.strictEqual(ctx.actor.rol, 'SUPERADMIN')
      assert.strictEqual(ctx.tenant.empresaId, 5)
      assert.strictEqual(ctx.branch.mode, BRANCH_MODE.NONE)
      assert.strictEqual(ctx.branch.sucursalId, null)
    })
  })

  describe('SCOPE MIDDLEWARE — Behavioral tests', () => {
    it('22. tenantGlobal pasa con contexto válido (mocked req)', () => {
      const { tenantGlobal } = require('../src/middlewares/scope.middleware')
      const req = {
        context: Object.freeze({
          version: 1,
          kind: 'TENANT',
          actor: { id: 1, rol: 'SUPERADMIN' },
          tenant: { empresaId: 5 },
          branch: { mode: 'NONE', sucursalId: null }
        })
      }
      let nextCalled = false
      tenantGlobal(req, {}, () => { nextCalled = true })
      assert.ok(nextCalled, 'tenantGlobal debe llamar next() con contexto válido')
    })

    it('23. tenantGlobal rechaza sin contexto', () => {
      const { tenantGlobal } = require('../src/middlewares/scope.middleware')
      const res = { status() { return this }, json() { return this } }
      let errorReported = null
      tenantGlobal({}, res, (err) => { errorReported = err })
      assert.ok(errorReported, 'tenantGlobal debe reportar error sin req.context')
    })

    it('24. branchOptional pasa con contexto válido', () => {
      const { branchOptional } = require('../src/middlewares/scope.middleware')
      const req = {
        context: Object.freeze({
          version: 1,
          kind: 'TENANT',
          actor: { id: 1, rol: 'SUPERADMIN' },
          tenant: { empresaId: 5 },
          branch: { mode: 'NONE', sucursalId: null }
        })
      }
      let nextCalled = false
      branchOptional(req, {}, () => { nextCalled = true })
      assert.ok(nextCalled, 'branchOptional debe llamar next() con contexto válido')
    })

    it('25. getEmpresaId extrae empresaId del contexto', () => {
      const getEmpresaId = require('../src/helpers/getEmpresaId')
      const req = {
        context: Object.freeze({
          version: 1,
          kind: 'TENANT',
          actor: { id: 1, rol: 'SUPERADMIN' },
          tenant: { empresaId: 99 },
          branch: { mode: 'NONE', sucursalId: null }
        })
      }
      assert.strictEqual(getEmpresaId(req), 99)
    })
  })
})
