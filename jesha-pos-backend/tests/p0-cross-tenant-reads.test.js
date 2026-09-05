'use strict'

process.env.TENANT_JWT_SECRET = process.env.TENANT_JWT_SECRET || 'reads-scope-test-tenant-secret-'.padEnd(64, 't')
process.env.TENANT_JWT_ISSUER = process.env.TENANT_JWT_ISSUER || 'reads-scope-test-issuer'
process.env.TENANT_JWT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE || 'reads-scope-test-audience'
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

// Extrae el cuerpo de una función a partir de su cabecera, respetando
// el balance de llaves para no arrastrar funciones posteriores.
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

describe('P0 — Cross-Tenant Reads (9 lecturas de registro único)', () => {

  // ═══════════════════════════════════════════════════════════════
  // 1. CLIENTE — GET /clientes/:id
  // ═══════════════════════════════════════════════════════════════
  describe('CLIENTE obtener', () => {
    let src
    before(() => { src = readSource('modules/clientes/clientes.controller.js') })

    it('1.1 obtener usa getEmpresaId(req)', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /const empresaId = getEmpresaId\(req\)/), 'debe resolver empresa desde contexto')
    })

    it('1.2 obtener busca cliente por id+empresaId (findFirst, no findUnique global)', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /findFirst\(\{\s*where: \{ id: parseInt\(id\), empresaId \}/),
        'lookup debe incluir empresaId')
      assert.strictEqual(countPatterns(fn, /findUnique\(\{ where: \{ id: parseInt\(id\) \} \}\)/g), 0,
        'NO debe existir findUnique por id global en obtener')
    })

    it('1.3 cliente de otra empresa o inexistente → 404', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ error: 'Cliente no encontrado' \}\)/),
        'debe responder 404 si el cliente no pertenece a la empresa')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // 2. CLIENTE VENTAS — GET /clientes/:id/ventas
  // ═══════════════════════════════════════════════════════════════
  describe('CLIENTE obtenerVentas', () => {
    let src
    before(() => { src = readSource('modules/clientes/clientes.controller.js') })

    it('2.1 obtenerVentas valida primero el cliente padre scoped', () => {
      const fn = extractFn(src, 'const obtenerVentas = async (req, res) => {')
      assert.ok(hasPattern(fn, /cliente\.findFirst\(\{ where: \{ id: parseInt\(id\), empresaId \}/),
        'debe validar el padre con empresaId')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ error: 'Cliente no encontrado' \}\)/),
        'padre ajeno → 404')
    })

    it('2.2 obtenerVentas consulta ventas con clienteId+empresaId', () => {
      const fn = extractFn(src, 'const obtenerVentas = async (req, res) => {')
      assert.ok(hasPattern(fn, /venta\.findMany\(\{[\s\S]*?where: \{ clienteId: parseInt\(id\), empresaId \}/),
        'query de ventas debe incluir empresaId')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // 3. CLIENTE ABONOS — GET /clientes/:id/abonos
  // ═══════════════════════════════════════════════════════════════
  describe('CLIENTE obtenerAbonos', () => {
    let src
    before(() => { src = readSource('modules/clientes/clientes.controller.js') })

    it('3.1 obtenerAbonos valida primero el cliente padre scoped', () => {
      const fn = extractFn(src, 'const obtenerAbonos = async (req, res) => {')
      assert.ok(hasPattern(fn, /cliente\.findFirst\(\{ where: \{ id: parseInt\(id\), empresaId \}/),
        'debe validar el padre con empresaId')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ error: 'Cliente no encontrado' \}\)/),
        'padre ajeno → 404')
    })

    it('3.2 obtenerAbonos consulta abonos con Bitacora.clienteId+empresaId', () => {
      const fn = extractFn(src, 'const obtenerAbonos = async (req, res) => {')
      assert.ok(hasPattern(fn, /abonoBitacora\.findMany\(\{[\s\S]*?Bitacora: \{ clienteId: parseInt\(id\), empresaId \}/),
        'query de abonos debe incluir empresaId via relación Bitacora')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // 4. PEDIDO — GET /pedidos/:id
  // ═══════════════════════════════════════════════════════════════
  describe('PEDIDO obtener', () => {
    let src
    before(() => { src = readSource('modules/pedidos/pedidos.controller.js') })

    it('4.1 obtener usa getEmpresaId(req)', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /const empresaId = getEmpresaId\(req\)/), 'debe resolver empresa desde contexto')
    })

    it('4.2 obtener busca pedido por id+empresaId (findFirst)', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /pedido\.findFirst\(\{\s*where: \{ id: parseInt\(req\.params\.id\), empresaId \}/),
        'lookup debe incluir empresaId')
      assert.strictEqual(countPatterns(fn, /findUnique\(\{ where: \{ id: parseInt\(req\.params\.id\) \} \}\)/g), 0,
        'NO debe existir findUnique por id global en obtener pedido')
    })

    it('4.3 pedido de otra empresa o inexistente → 404', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ success: false, error: 'Pedido no encontrado' \}\)/),
        'debe responder 404 si el pedido no pertenece a la empresa')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // 5. BITÁCORA — GET /bitacoras/:id
  // ═══════════════════════════════════════════════════════════════
  describe('BITÁCORA obtener', () => {
    let src
    before(() => { src = readSource('modules/bitacora/bitacora.controller.js') })

    it('5.1 obtener usa getEmpresaId(req)', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /const empresaId = getEmpresaId\(req\)/), 'debe resolver empresa desde contexto')
    })

    it('5.2 obtener busca bitácora por id+empresaId (findFirst)', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /bitacora\.findFirst\(\{\s*where: \{ id: parseInt\(req\.params\.id\), empresaId \}/),
        'lookup debe incluir empresaId')
      assert.strictEqual(countPatterns(fn, /findUnique\(\{ where: \{ id: parseInt\(req\.params\.id\) \} \}\)/g), 0,
        'NO debe existir findUnique por id global en obtener bitácora')
    })

    it('5.3 bitácora de otra empresa o inexistente → 404', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ success: false, error: 'Bitácora no encontrada' \}\)/),
        'debe responder 404 si la bitácora no pertenece a la empresa')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // 6. COMPRA — GET /compras/:id
  // ═══════════════════════════════════════════════════════════════
  describe('COMPRA obtener', () => {
    let src
    before(() => { src = readSource('modules/compras/compras.controller.js') })

    it('6.1 obtener usa getEmpresaId(req)', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /const empresaId = getEmpresaId\(req\)/), 'debe resolver empresa desde contexto')
    })

    it('6.2 obtener busca orden de compra por id+empresaId (findFirst)', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /ordenCompra\.findFirst\(\{ where: \{ id: parseInt\(req\.params\.id\), empresaId \}/),
        'lookup debe incluir empresaId')
      assert.strictEqual(countPatterns(fn, /findUnique\(\{ where: \{ id: parseInt\(req\.params\.id\) \} \}\)/g), 0,
        'NO debe existir findUnique por id global en obtener compra')
    })

    it('6.3 orden de compra de otra empresa o inexistente → 404', () => {
      const fn = extractFn(src, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ success: false, error: 'Orden no encontrada' \}\)/),
        'debe responder 404 si la orden no pertenece a la empresa')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // 7. COTIZACIÓN — GET /cotizaciones/:id (auto-vencimiento scoped)
  // ═══════════════════════════════════════════════════════════════
  describe('COTIZACIÓN obtenerPorId', () => {
    let service, controller
    before(() => {
      service = readSource('modules/cotizaciones/cotizaciones.service.js')
      controller = readSource('modules/cotizaciones/cotizaciones.controller.js')
    })

    it('7.1 obtenerPorId recibe empresaId como segundo argumento', () => {
      assert.ok(hasPattern(service, /async function obtenerPorId\(id, empresaId\)/),
        'la firma debe aceptar empresaId')
    })

    it('7.2 controller pasa getEmpresaId(req) a obtenerPorId', () => {
      const fn = extractFn(controller, 'const obtener = async (req, res) => {')
      assert.ok(hasPattern(fn, /service\.obtenerPorId\(id, getEmpresaId\(req\)\)/),
        'el controller debe propagar el tenant')
    })

    it('7.3 auto-vencimiento usa updateMany con id+empresaId+estado PENDIENTE', () => {
      const fn = extractFn(service, 'async function obtenerPorId(id, empresaId) {')
      assert.ok(hasPattern(fn, /cotizacion\.updateMany\(\{\s*where:\s*\{[\s\S]*?id: parseInt\(id\),[\s\S]*?empresaId,[\s\S]*?estado: 'PENDIENTE'/),
        'update de auto-vencimiento debe ser scoped por empresa y estado')
      assert.strictEqual(countPatterns(fn, /\$executeRaw`[\s\S]*?UPDATE "Cotizacion"/g), 0,
        'obtenerPorId NO debe usar $executeRaw sin scope')
    })

    it('7.4 lectura final usa findFirst con id+empresaId', () => {
      assert.ok(hasPattern(service, /cotizacion\.findFirst\(\{ where: \{ id: parseInt\(id\), empresaId \}/),
        'la lectura final debe incluir empresaId')
      assert.strictEqual(countPatterns(service, /findUnique\(\{ where: \{ id: parseInt\(id\) \} \}\)/g), 0,
        'NO debe existir findUnique por id global en obtenerPorId')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // 8. DEVOLUCIÓN crear — POST /devoluciones (venta scoped)
  // ═══════════════════════════════════════════════════════════════
  describe('DEVOLUCIÓN crear', () => {
    let src
    before(() => { src = readSource('modules/devoluciones/devoluciones.controller.js') })

    it('8.1 crear resuelve la venta por id+empresaId (findFirst)', () => {
      const fn = extractFn(src, 'exports.crear = async (req, res) => {')
      assert.ok(hasPattern(fn, /venta\.findFirst\(\{\s*where:\s*\{ id: parseInt\(ventaId\), empresaId \}/),
        'la venta debe resolverse scoped por empresa')
      assert.strictEqual(countPatterns(fn, /findUnique\(\{ where: \{ id: parseInt\(ventaId\) \} \}\)/g), 0,
        'NO debe existir findUnique por ventaId global en crear')
    })

    it('8.2 venta de otra empresa o inexistente → 404 (sin efectos laterales)', () => {
      const fn = extractFn(src, 'exports.crear = async (req, res) => {')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ error: 'Venta no encontrada' \}\)/),
        'debe responder 404 si la venta no pertenece a la empresa')
    })

    it('8.3 update de estado de venta scoped por id+empresaId (updateMany)', () => {
      const fn = extractFn(src, 'exports.crear = async (req, res) => {')
      assert.ok(hasPattern(fn, /tx\.venta\.updateMany\(\{\s*where: \{ id: parseInt\(ventaId\), empresaId \}/),
        'el update de la venta debe ser scoped por empresa')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // 9. DEVOLUCIÓN porVenta — GET /devoluciones/venta/:ventaId
  // ═══════════════════════════════════════════════════════════════
  describe('DEVOLUCIÓN porVenta', () => {
    let src
    before(() => { src = readSource('modules/devoluciones/devoluciones.controller.js') })

    it('9.1 porVenta valida primero la venta padre scoped', () => {
      const fn = extractFn(src, 'exports.porVenta = async (req, res) => {')
      assert.ok(hasPattern(fn, /venta\.findFirst\(\{ where: \{ id: parseInt\(ventaId\), empresaId \}/),
        'debe validar el padre con empresaId')
      assert.ok(hasPattern(fn, /status\(404\)\.json\(\{ error: 'Venta no encontrada' \}\)/),
        'padre ajeno → 404')
    })

    it('9.2 porVenta consulta devoluciones con ventaId+empresaId', () => {
      const fn = extractFn(src, 'exports.porVenta = async (req, res) => {')
      assert.ok(hasPattern(fn, /devolucion\.findMany\(\{[\s\S]*?where:\s*\{ ventaId: parseInt\(ventaId\), empresaId \}/),
        'query de devoluciones debe incluir empresaId')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // GENERAL — helpers y middleware de soporte
  // ═══════════════════════════════════════════════════════════════
  describe('GENERAL', () => {

    it('10. getEmpresaId solo usa req.context (nunca body/query/token)', () => {
      const src = readSource('helpers/getEmpresaId.js')
      assert.strictEqual(countPatterns(src, /req\.body/g), 0)
      assert.strictEqual(countPatterns(src, /req\.query/g), 0)
      assert.ok(hasPattern(src, /req\.context/))
    })

    it('11. requireAuth hidrata req.context en cada request', () => {
      const src = readSource('middlewares/auth.middleware.js')
      assert.ok(hasPattern(src, /hydrateTenantRequestContext\(req, hydrated\.actor\)/),
        'requireAuth debe hidratar el contexto tenant')
    })

    it('12. app.js monta los 6 módulos con requireAuth o requireTenantOrDelegated (scope Prisma, sin duplicar middleware)', () => {
      const src = readSource('app.js')
      for (const route of ['/clientes', '/pedidos', '/bitacoras', '/compras', '/cotizaciones', '/devoluciones']) {
        assert.ok(hasPattern(src, new RegExp(`app\\.use\\('${route.replace(/\//g, '\\/')}',\\s*(requireAuth|requireTenantOrDelegated),`)),
          `app.js debe montar ${route} con requireAuth o requireTenantOrDelegated`)
      }
    })

    it('13. no se duplica requestContext en los routers de los 6 módulos', () => {
      const modulos = [
        'modules/clientes/clientes.routes.js',
        'modules/pedidos/pedidos.routes.js',
        'modules/bitacora/bitacora.routes.js',
        'modules/compras/compras.routes.js',
        'modules/cotizaciones/cotizaciones.routes.js',
        'modules/devoluciones/devoluciones.routes.js'
      ]
      for (const f of modulos) {
        const src = readSource(f).replace(/\/\/[^\n]*/g, '')
        assert.strictEqual(countPatterns(src, /requireAuth/g), 0,
          `${f} no debe re-aplicar requireAuth (ya viene de app.js)`)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // FASE 2 — LISTADOS CROSS-TENANT + SQL CRUDO SIN SCOPE
  // ═══════════════════════════════════════════════════════════════
  describe('FASE 2 — helper de scope compartido', () => {
    it('F2.1 helper existe y exporta una función', () => {
      const src = readSource('helpers/construirWhereScopeTenant.js')
      assert.ok(src.length > 0, 'helper debe existir')
      assert.ok(hasPattern(src, /function construirWhereScopeTenant/), 'helper debe definir la función')
      assert.ok(hasPattern(src, /module\.exports/), 'helper debe exportar')
    })

    it('F2.2 helper usa getEmpresaId(req) (empresa autoritativa desde context)', () => {
      const src = readSource('helpers/construirWhereScopeTenant.js')
      assert.ok(hasPattern(src, /getEmpresaId\(req\)/), 'helper debe resolver empresa vía getEmpresaId')
      assert.strictEqual(countPatterns(src, /req\.body/g), 0, 'nunca body')
      assert.strictEqual(countPatterns(src, /req\.query/g), 0, 'nunca query')
      assert.strictEqual(countPatterns(src, /req\.params/g), 0, 'nunca params')
    })

    it('F2.3 helper aplica empresaId siempre y sucursalId desde contexto de rama (H5)', () => {
      const src = readSource('helpers/construirWhereScopeTenant.js')
      assert.ok(hasPattern(src, /empresaId: getEmpresaId\(req\)/), 'empresaId en el where base')
      assert.ok(hasPattern(src, /incluirSucursal/), 'opción incluirSucursal')
      assert.ok(hasPattern(src, /resolverSucursalId\(req\)/), 'sucursal desde contexto de rama')
      assert.strictEqual(countPatterns(src, /rol !== 'SUPERADMIN'/g), 0, 'SUPERADMIN ya no se excluye del filtro de sucursal (H5)')
      assert.ok(hasPattern(src, /where\.sucursalId = parseInt\(sucursalId/), 'sucursalId parseado como entero')
    })
  })

  describe('FASE 2 — listados scoped por empresa', () => {
    it('F2.4 pedidos.listar usa construirWhereScopeTenant', () => {
      const src = readSource('modules/pedidos/pedidos.controller.js')
      assert.ok(hasPattern(src, /construirWhereScopeTenant/), 'importa helper')
      const fn = extractFn(src, 'const listar = async (req, res) => {')
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/),
        'listar debe construir where con helper')
    })

    it('F2.5 compras.listar usa construirWhereScopeTenant', () => {
      const src = readSource('modules/compras/compras.controller.js')
      assert.ok(hasPattern(src, /construirWhereScopeTenant/), 'importa helper')
      const fn = extractFn(src, 'const listar = async (req, res) => {')
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/),
        'listar debe construir where con helper')
    })

    it('F2.6 bitacora.listar usa construirWhereScopeTenant', () => {
      const src = readSource('modules/bitacora/bitacora.controller.js')
      assert.ok(hasPattern(src, /construirWhereScopeTenant/), 'importa helper')
      const fn = extractFn(src, 'const listar = async (req, res) => {')
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/),
        'listar debe construir where con helper')
    })

    it('F2.7 devoluciones.listar usa construirWhereScopeTenant (incluye scope de sucursal)', () => {
      const src = readSource('modules/devoluciones/devoluciones.controller.js')
      assert.ok(hasPattern(src, /construirWhereScopeTenant/), 'importa helper')
      const fn = extractFn(src, 'exports.listar = async (req, res) => {')
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/),
        'listar debe construir where con helper')
    })

    it('F2.8 cotizaciones.service.listar recibe empresaId y lo usa en where', () => {
      const src = readSource('modules/cotizaciones/cotizaciones.service.js')
      assert.ok(src.includes('async function listar({ empresaId'),
        'firma debe incluir empresaId')
      assert.ok(src.includes('const where = { empresaId }'),
        'where base con empresaId')
    })

    it('F2.9 cotizaciones.controller pasa empresaId a service.listar', () => {
      const src = readSource('modules/cotizaciones/cotizaciones.controller.js')
      const fn = extractFn(src, 'const listar = async (req, res) => {')
      assert.ok(hasPattern(fn, /empresaId: getEmpresaId\(req\)/),
        'controller debe resolver empresa vía getEmpresaId y pasarla al service')
    })
  })

  describe('FASE 2 — SQL crudo sin scope corregido', () => {
    it('F2.10 bitacora $queryRaw full-text scoped por b."empresaId"', () => {
      const src = readSource('modules/bitacora/bitacora.controller.js')
      const fn = extractFn(src, 'const listar = async (req, res) => {')
      assert.ok(hasPattern(fn, /b\."empresaId" = \$\{empresaId\}/),
        'full-text debe filtrar por empresa')
    })

    it('F2.11 cotizaciones $executeRaw auto-vencer scoped por empresaId', () => {
      const src = readSource('modules/cotizaciones/cotizaciones.service.js')
      assert.ok(src.includes('WHERE "empresaId" = ${empresaId}'),
        'UPDATE de auto-vencimiento debe filtrar por empresa')
    })

    it('F2.12 clientes $queryRaw full-text scoped por c."empresaId"', () => {
      const src = readSource('modules/clientes/clientes.controller.js')
      const fn = extractFn(src, 'const listar = async (req, res) => {')
      assert.ok(hasPattern(fn, /c\."empresaId" = \$\{empresaId\}/),
        'full-text de clientes debe filtrar por empresa')
    })
  })

  describe('FASE 2 — turnos-caja scoped', () => {
    it('F2.13 obtenerActivo scoped por construirWhereScopeTenant', () => {
      const src = readSource('modules/turnos-caja/turnos-caja.controller.js')
      assert.ok(hasPattern(src, /construirWhereScopeTenant/), 'importa helper')
      const fn = extractFn(src, 'const obtenerActivo = async (req, res) => {')
      assert.ok(hasPattern(fn, /\.\.\.construirWhereScopeTenant\(req\)/),
        'turno activo debe llevar empresaId')
    })

    it('F2.14 obtenerResumen scoped por construirWhereScopeTenant', () => {
      const src = readSource('modules/turnos-caja/turnos-caja.controller.js')
      const fn = extractFn(src, 'const obtenerResumen = async (req, res) => {')
      assert.ok(hasPattern(fn, /\.\.\.construirWhereScopeTenant\(req\)/),
        'resumen debe llevar empresaId')
    })

    it('F2.15 obtenerHistorial scoped por construirWhereScopeTenant', () => {
      const src = readSource('modules/turnos-caja/turnos-caja.controller.js')
      const fn = extractFn(src, 'const obtenerHistorial = async (req, res) => {')
      assert.ok(hasPattern(fn, /construirWhereScopeTenant\(req, \{ incluirSucursal: false \}\)/),
        'historial debe llevar empresaId sin sucursal del helper')
    })

    it('F2.16 obtenerResumenContable scoped por empresaId (SQL + groupBy + sucursales)', () => {
      const src = readSource('modules/turnos-caja/turnos-caja.controller.js')
      const fn = extractFn(src, 'const obtenerResumenContable = async (req, res) => {')
      assert.ok(hasPattern(fn, /const empresaId = getEmpresaId\(req\)/),
        'debe resolver empresa vía getEmpresaId')
      assert.ok(hasPattern(fn, /v\."empresaId" = \$\{empresaId\}/),
        'SQL crudo de ventas debe filtrar por empresa')
      assert.ok(hasPattern(fn, /tc\."empresaId" = \$\{empresaId\}/),
        'SQL crudo de turnos debe filtrar por empresa')
      assert.ok(hasPattern(fn, /empresaId,\n\s+abierto: false/),
        'groupBy de turnoCaja debe incluir empresaId')
      assert.ok(hasPattern(fn, /sucursalIdContexto === null/),
        'NONE consolida todas las sucursales de la empresa')
      assert.ok(hasPattern(fn, /where: \{ id: sucursalIdContexto, empresaId \}/),
        'sucursal.findMany debe scoped por empresaId + contexto branch')
    })
  })
})
