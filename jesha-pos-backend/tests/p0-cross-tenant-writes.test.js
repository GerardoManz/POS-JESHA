'use strict'

process.env.TENANT_JWT_SECRET = process.env.TENANT_JWT_SECRET || 'prod-scope-test-tenant-secret-'.padEnd(64, 't')
process.env.TENANT_JWT_ISSUER = process.env.TENANT_JWT_ISSUER || 'prod-scope-test-issuer'
process.env.TENANT_JWT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE || 'prod-scope-test-audience'
process.env.TENANT_JWT_TTL = process.env.TENANT_JWT_TTL || '15m'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test'
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it, before } = require('node:test')

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

function useMiddlewareNames(stack) {
  return stack
    .filter(l => !l.route)
    .map(l => l.handle.name || '(anonymous)')
}

function routeHasHandlerName(layer, name) {
  if (!layer.route || !layer.route.stack) return false
  return layer.route.stack.some(s => s.handle && s.handle.name === name)
}

function findRoute(stack, method, pathPat) {
  return stack.find(l => {
    if (!l.route) return false
    return l.route.methods[method] && l.regexp.test(pathPat)
  })
}

function routeHandlers(layer) {
  if (!layer.route || !layer.route.stack) return []
  return layer.route.stack.map(s => ({ method: s.method, handle: s.handle }))
}

// Extrae el cuerpo de una función del controller a partir de su cabecera,
// respetando el balance de llaves para no arrastrar funciones posteriores.
function extractFn(src, headerStart) {
  const idx = src.indexOf(headerStart)
  if (idx === -1) return ''
  const braceIdx = src.indexOf('{', idx)
  if (braceIdx === -1) return src.slice(idx)
  let depth = 0
  for (let i = braceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(idx, i + 1)
    }
  }
  return src.slice(idx)
}

describe('P0 — Cross-Tenant Writes (4 escrituras bloqueantes)', () => {

  // ═══════════════════════════════════════════════════════════════
  // ABONO A CRÉDITO (P0-XTENANT-002) — 6 casos
  // ═══════════════════════════════════════════════════════════════
  describe('ABONO — POST /clientes/:id/abonar-credito', () => {
    let router, src
    before(() => {
      router = require('../src/modules/clientes/clientes.routes')
      src = readSource('modules/clientes/clientes.controller.js')
    })

    it('1. router clientes usa requestContext + tenantGlobal', () => {
      const useMw = useMiddlewareNames(router.stack)
      assert.ok(useMw.includes('requestContext'), 'router.use debe incluir requestContext')
      assert.ok(useMw.includes('tenantGlobal'), 'router.use debe incluir tenantGlobal')
    })

    it('2. abonarCredito usa getEmpresaId(req)', () => {
      const fn = extractFn(src, 'const abonarCredito = async (req, res) => {')
      assert.ok(hasPattern(fn, /const empresaId = getEmpresaId\(req\)/), 'debe resolver empresa desde contexto')
    })

    it('3. abonarCredito busca cliente por id+empresaId (findFirst, no findUnique global)', () => {
      const fn = extractFn(src, 'const abonarCredito = async (req, res) => {')
      assert.ok(hasPattern(fn, /findFirst\(\{\s*where: \{ id: parseInt\(id\), empresaId \}/),
        'lookup debe incluir empresaId')
      assert.strictEqual(countPatterns(fn, /findUnique\(\{ where: \{ id: parseInt\(id\) \} \}\)/g), 0,
        'NO debe existir findUnique por id global en abonarCredito')
    })

    it('4. update scoped: updateMany con id+empresaId y count===1', () => {
      const fn = extractFn(src, 'const abonarCredito = async (req, res) => {')
      assert.ok(hasPattern(fn, /updateMany\(\{[\s\S]*?where: \{ id: parseInt\(id\), empresaId \}/),
        'update debe estar scoped por empresa')
      assert.ok(hasPattern(fn, /\.count !== 1/), 'debe validar count === 1')
    })

    it('5. cliente de otra empresa o inexistente → 404', () => {
      const fn = extractFn(src, 'const abonarCredito = async (req, res) => {')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ error: 'Cliente no encontrado' \}\)/),
        'debe responder 404 si el cliente no pertenece a la empresa')
    })

    it('6. parseFloat en montos (sin concatenación de strings)', () => {
      const fn = extractFn(src, 'const abonarCredito = async (req, res) => {')
      assert.ok(hasPattern(fn, /parseFloat\(monto\)/), 'monto debe parsearse como número')
      assert.ok(hasPattern(fn, /parseFloat\(cliente\.saldoPendiente\)/),
        'saldoPendiente (Decimal) debe parsearse antes de aritmética')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // CAMBIO DE PRECIO (P0-XTENANT-013) — 5 casos
  // ═══════════════════════════════════════════════════════════════
  describe('PRECIO — PATCH /precios/:id', () => {
    let router, src
    before(() => {
      router = require('../src/modules/precios/precios.routes')
      src = readSource('modules/precios/precios.controller.js')
    })

    it('7. router precios usa requestContext + tenantGlobal', () => {
      const useMw = useMiddlewareNames(router.stack)
      assert.ok(useMw.includes('requestContext'), 'precios.routes debe usar requestContext')
      assert.ok(useMw.includes('tenantGlobal'), 'precios.routes debe usar tenantGlobal')
    })

    it('8. actualizarPrecios usa getEmpresaId(req)', () => {
      assert.ok(hasPattern(src, /const empresaId = getEmpresaId\(req\)/), 'debe resolver empresa desde contexto')
    })

    it('9. actualizarPrecios busca producto por id+empresaId (findFirst)', () => {
      assert.ok(hasPattern(src, /findFirst\(\{\s*where: \{ id: parseInt\(id\), empresaId \}/),
        'lookup debe incluir empresaId')
      assert.strictEqual(countPatterns(src, /findUnique\(\{ where: \{ id: parseInt\(id\) \} \}\)/g), 0,
        'NO debe existir findUnique por id global en precios.controller')
    })

    it('10. update scoped: updateMany con id+empresaId y count===1', () => {
      assert.ok(hasPattern(src, /updateMany\(\{[\s\S]*?where: \{ id: parseInt\(id\), empresaId \}/),
        'update debe estar scoped por empresa')
      assert.ok(hasPattern(src, /\.count !== 1/), 'debe validar count === 1')
    })

    it('11. producto de otra empresa o inexistente → 404', () => {
      assert.ok(hasPattern(src, /status\(404\)\.json\(\{ error: 'Producto no encontrado' \}\)/),
        'debe responder 404 si el producto no pertenece a la empresa')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // ESTADO DE USUARIO (P0-XTENANT-014) — 5 casos
  // ═══════════════════════════════════════════════════════════════
  describe('USUARIO — PATCH /usuarios/:id/estado', () => {
    let router, src
    before(() => {
      router = require('../src/modules/usuarios/usuarios.routes')
      src = readSource('modules/usuarios/usuarios.controller.js')
    })

    it('12. ruta estado usa tenantGlobal + requireRole SUPERADMIN', () => {
      const estado = findRoute(router.stack, 'patch', '/:id/estado')
      assert.ok(estado, 'PATCH /:id/estado debe existir')
      assert.ok(routeHasHandlerName(estado, 'tenantGlobal'), 'debe usar tenantGlobal')
      const routeSrc = readSource('modules/usuarios/usuarios.routes.js')
      assert.ok(/router\.patch\('\/:id\/estado',\s*tenantGlobal,\s*requireRole\('SUPERADMIN'\)/.test(routeSrc),
        'debe usar requireRole(SUPERADMIN) en la ruta de estado')
    })

    it('13. cambiarEstado usa getEmpresaId(req)', () => {
      const fn = extractFn(src, 'const cambiarEstado = async (req, res) => {')
      assert.ok(hasPattern(fn, /const empresaId = getEmpresaId\(req\)/), 'debe resolver empresa desde contexto')
    })

    it('14. cambiarEstado busca usuario por id+empresaId (findFirst)', () => {
      const fn = extractFn(src, 'const cambiarEstado = async (req, res) => {')
      assert.ok(hasPattern(fn, /findFirst\(\{\s*where: \{ id: parseInt\(id\), empresaId \}/),
        'lookup debe incluir empresaId')
      assert.strictEqual(countPatterns(fn, /findUnique\(\{ where: \{ id: parseInt\(id\) \} \}\)/g), 0,
        'NO debe existir findUnique por id global en cambiarEstado')
    })

    it('15. update scoped: updateMany con id+empresaId y count===1', () => {
      const fn = extractFn(src, 'const cambiarEstado = async (req, res) => {')
      assert.ok(hasPattern(fn, /updateMany\(\{[\s\S]*?where: \{ id: parseInt\(id\), empresaId \}/),
        'update debe estar scoped por empresa')
      assert.ok(hasPattern(fn, /\.count !== 1/), 'debe validar count === 1')
    })

    it('16. usuario de otra empresa o inexistente → 404', () => {
      const fn = extractFn(src, 'const cambiarEstado = async (req, res) => {')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ error: 'Usuario no encontrado' \}\)/),
        'debe responder 404 si el usuario no pertenece a la empresa')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // AJUSTE RÁPIDO DE INVENTARIO (P0-XTENANT-015) — 10 casos
  // ═══════════════════════════════════════════════════════════════
  describe('INVENTARIO — POST /inventario/ajuste-rapido', () => {
    let router, src
    before(() => {
      router = require('../src/modules/inventario/inventario.routes')
      src = readSource('modules/inventario/inventario.controller.js')
    })

    it('17. router inventario usa requestContext', () => {
      const useMw = useMiddlewareNames(router.stack)
      assert.ok(useMw.includes('requestContext'), 'inventario.routes debe usar requestContext')
    })

    it('18. POST /ajuste-rapido usa branchRequired', () => {
      const ajuste = findRoute(router.stack, 'post', '/ajuste-rapido')
      assert.ok(ajuste, 'POST /ajuste-rapido debe existir')
      assert.ok(routeHasHandlerName(ajuste, 'branchRequired'), 'ajuste-rapido debe exigir sucursal')
    })

    it('19. sucursalId se resuelve SOLO desde req.context.branch.sucursalId', () => {
      assert.ok(hasPattern(src, /req\.context\?\.branch\?\.sucursalId/),
        'sucursalId debe provenir del contexto de sucursal')
    })

    it('20. NO se acepta sucursalId desde el body', () => {
      assert.strictEqual(countPatterns(src, /req\.body\.sucursalId/g), 0,
        'NO debe leer sucursalId del body')
      assert.strictEqual(countPatterns(src, /body\.sucursalId/g), 0,
        'NO debe leer sucursalId del body')
    })

    it('21. NO existe fallback a Sucursal 1 (ni || ni ?? ni hardcode)', () => {
      assert.strictEqual(countPatterns(src, /sucursalId.*\|\|\s*1/g), 0, 'no debe haber fallback || 1')
      assert.strictEqual(countPatterns(src, /sucursalId.*\?\?\s*1/g), 0, 'no debe haber fallback ?? 1')
      assert.strictEqual(countPatterns(src, /sucursalId: 1/g), 0, 'no debe haber hardcode : 1')
      assert.strictEqual(countPatterns(src, /parseInt\(req\.body\.sucursalId\)/g), 0,
        'no debe parsear sucursalId del body')
    })

    it('22. NO se usa sucursalIdToken del JWT como autoridad', () => {
      assert.strictEqual(countPatterns(src, /sucursalIdToken/g), 0,
        'no debe usar el token para resolver la sucursal operativa')
    })

    it('23. productoId se valida contra la empresa (findFirst con empresaId)', () => {
      assert.ok(hasPattern(src, /producto\.findFirst\(\{[\s\S]*?empresaId/),
        'debe verificar que el producto pertenece a la empresa')
    })

    it('24. branchRequired sin sucursal en contexto → 400', () => {
      const { branchRequired } = require('../src/middlewares/scope.middleware')
      const req = { context: Object.freeze({
        version: 1, kind: 'TENANT',
        actor: { id: 1, rol: 'SUPERADMIN' },
        tenant: { empresaId: 5 },
        branch: { mode: 'NONE', sucursalId: null }
      }) }
      let statusCode = null
      const res = { status(c) { statusCode = c; return this }, json() { return this } }
      let nextCalled = false
      branchRequired(req, res, () => { nextCalled = true })
      assert.strictEqual(statusCode, 400, 'branchRequired debe responder 400 sin sucursal')
      assert.strictEqual(nextCalled, false, 'branchRequired no debe dejar pasar NONE')
    })

    it('25. branchRequired deja pasar FIXED/SELECTED', () => {
      const { branchRequired } = require('../src/middlewares/scope.middleware')
      const base = { version: 1, kind: 'TENANT', actor: { id: 1, rol: 'ADMIN_SUCURSAL' }, tenant: { empresaId: 5 } }
      const reqFixed = { context: Object.freeze({ ...base, actor: { id: 1, rol: 'ADMIN_SUCURSAL' }, branch: { mode: 'FIXED', sucursalId: 7 } }) }
      let nextFixed = false
      branchRequired(reqFixed, {}, () => { nextFixed = true })
      assert.ok(nextFixed, 'branchRequired pasa con FIXED')

      const reqSel = { context: Object.freeze({ ...base, actor: { id: 1, rol: 'SUPERADMIN' }, branch: { mode: 'SELECTED', sucursalId: 9 } }) }
      let nextSel = false
      branchRequired(reqSel, {}, () => { nextSel = true })
      assert.ok(nextSel, 'branchRequired pasa con SELECTED')
    })

    it('26. ajusteRapido usa getEmpresaId(req)', () => {
      assert.ok(hasPattern(src, /const empresaId\s*=\s*getEmpresaId\(req\)/),
        'debe resolver empresa desde contexto')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // GENERAL — 7 casos
  // ═══════════════════════════════════════════════════════════════
  describe('GENERAL', () => {

    it('27. getEmpresaId solo usa req.context (nunca body/query/token)', () => {
      const src = readSource('helpers/getEmpresaId.js')
      assert.strictEqual(countPatterns(src, /req\.body/g), 0)
      assert.strictEqual(countPatterns(src, /req\.query/g), 0)
      assert.ok(hasPattern(src, /req\.context/))
    })

    it('28. requireAuth hidrata req.context en cada request', () => {
      const src = readSource('middlewares/auth.middleware.js')
      assert.ok(hasPattern(src, /hydrateTenantRequestContext\(req, hydrated\.actor\)/),
        'requireAuth debe hidratar el contexto tenant')
    })

    it('29. no hay sucursalId hardcodeada 1 en ninguno de los 4 controllers', () => {
      const archivos = [
        'modules/clientes/clientes.controller.js',
        'modules/precios/precios.controller.js',
        'modules/usuarios/usuarios.controller.js',
        'modules/inventario/inventario.controller.js'
      ]
      for (const f of archivos) {
        const c = readSource(f)
        assert.strictEqual(countPatterns(c, /sucursalId: 1\b/g), 0, `${f} no debe hardcodear sucursal 1`)
        assert.strictEqual(countPatterns(c, /sucursalId\s*=\s*[^;]*\|\|\s*1/g), 0, `${f} no debe tener fallback || 1`)
      }
    })

    it('30. no se lee sucursalId del query en ninguno de los 4 controllers', () => {
      const archivos = [
        'modules/clientes/clientes.controller.js',
        'modules/precios/precios.controller.js',
        'modules/usuarios/usuarios.controller.js',
        'modules/inventario/inventario.controller.js'
      ]
      for (const f of archivos) {
        assert.strictEqual(countPatterns(readSource(f), /req\.query\.sucursalId/g), 0, `${f} no debe leer query.sucursalId`)
      }
    })

    it('31. scope.middleware conserva exports estables', () => {
      const { tenantGlobal, branchOptional, branchRequired } = require('../src/middlewares/scope.middleware')
      assert.strictEqual(typeof tenantGlobal, 'function')
      assert.strictEqual(typeof branchOptional, 'function')
      assert.strictEqual(typeof branchRequired, 'function')
    })

    it('32. getEmpresaId/resolverSucursalId usan assertTenantRequestContext', () => {
      const g = readSource('helpers/getEmpresaId.js')
      assert.ok(hasPattern(g, /assertTenantRequestContext/))
      const s = readSource('modules/sucursal/sucursal.helper.js')
      assert.ok(hasPattern(s, /assertTenantRequestContext/))
      assert.ok(hasPattern(s, /context\.branch\.sucursalId/))
    })

    it('33. request-context contract estable: BRANCH_MODE + buildTenantRequestContext', () => {
      const src = readSource('security/request-context.js')
      assert.ok(hasPattern(src, /BRANCH_MODE = Object\.freeze/))
      assert.ok(hasPattern(src, /NONE: 'NONE'/))
      assert.ok(hasPattern(src, /FIXED: 'FIXED'/))
      assert.ok(hasPattern(src, /SELECTED: 'SELECTED'/))
      assert.ok(hasPattern(src, /buildTenantRequestContext/))
    })
  })
})
