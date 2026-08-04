'use strict'

process.env.TENANT_JWT_SECRET = process.env.TENANT_JWT_SECRET || 'lists-scope-test-tenant-secret-'.padEnd(64, 't')
process.env.TENANT_JWT_ISSUER = process.env.TENANT_JWT_ISSUER || 'lists-scope-test-issuer'
process.env.TENANT_JWT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE || 'lists-scope-test-audience'
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

const HELPER_SRC = 'helpers/construirWhereScopeTenant.js'
const PEDIDOS = 'modules/pedidos/pedidos.controller.js'
const COMPRAS = 'modules/compras/compras.controller.js'
const DEVOLUCIONES = 'modules/devoluciones/devoluciones.controller.js'
const COTIZACIONES_SERVICE = 'modules/cotizaciones/cotizaciones.service.js'
const COTIZACIONES = 'modules/cotizaciones/cotizaciones.controller.js'
const BITACORA = 'modules/bitacora/bitacora.controller.js'

describe('P0 — Cross-Tenant Lists (contrato de listados)', () => {
  let helper, pedidosSrc, comprasSrc, devolucionesSrc, cotizSvc, cotizCtrl, bitacoraSrc

  before(() => {
    helper = readSource(HELPER_SRC)
    pedidosSrc = readSource(PEDIDOS)
    comprasSrc = readSource(COMPRAS)
    devolucionesSrc = readSource(DEVOLUCIONES)
    cotizSvc = readSource(COTIZACIONES_SERVICE)
    cotizCtrl = readSource(COTIZACIONES)
    bitacoraSrc = readSource(BITACORA)
  })

  describe('10. Helper construirWhereScopeTenant', () => {
    it('helper existe y exporta una función', () => {
      assert.ok(helper.length > 0)
      assert.ok(hasPattern(helper, /function construirWhereScopeTenant/))
      assert.ok(hasPattern(helper, /module\.exports/))
    })

    it('empresa autoritativa vía getEmpresaId(req) — nunca body/query/params', () => {
      assert.ok(hasPattern(helper, /getEmpresaId\(req\)/))
      assert.strictEqual(countPatterns(helper, /req\.body/g), 0, 'nunca body')
      assert.strictEqual(countPatterns(helper, /req\.query/g), 0, 'nunca query')
      assert.strictEqual(countPatterns(helper, /req\.params/g), 0, 'nunca params')
      assert.strictEqual(countPatterns(helper, /req\.usuario\.empresaId/g), 0, 'nunca empresa desde usuario')
    })

    it('empresaId siempre; sucursalId solo para no-SUPERADMIN', () => {
      assert.ok(hasPattern(helper, /empresaId: getEmpresaId\(req\)/))
      assert.ok(hasPattern(helper, /rol !== 'SUPERADMIN'/))
    })
  })

  describe('1. Pedidos.listar', () => {
    let fn
    before(() => { fn = extractFn(pedidosSrc, 'const listar = async (req, res) => {') })

    it('findMany y count scoped por empresaId', () => {
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/))
      assert.ok(hasPattern(fn, /prisma\.pedido\.count\(\{ where \}\)/))
      assert.ok(hasPattern(fn, /prisma\.pedido\.findMany\(\{[\s\S]*?where,?[\s\S]*?select: PEDIDO_SELECT/))
    })

    it('filtros no pueden reemplazar empresaId (empresaId no se sobre-escribe)', () => {
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/))
      assert.strictEqual(countPatterns(fn, /where\.empresaId\s*=\s*/g), 0, 'empresaId no se asigna desde filtros')
      assert.strictEqual(countPatterns(fn, /Object\.assign\(where/g), 0, 'sin Object.assign')
    })

    it('page/limit normalizados de forma segura (sin NaN → 500)', () => {
      assert.ok(hasPattern(fn, /Math\.max\(1, parseInt\(page\) \|\| 1\)/))
      assert.ok(hasPattern(fn, /Math\.min\(100, Math\.max\(1, parseInt\(limit\) \|\| 25\)\)/))
    })
  })

  describe('2. Compras.listar', () => {
    let fn
    before(() => { fn = extractFn(comprasSrc, 'const listar = async (req, res) => {') })

    it('findMany y count scoped por empresaId', () => {
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/))
      assert.ok(hasPattern(fn, /prisma\.ordenCompra\.count\(\{ where \}\)/))
    })

    it('filtro de proveedor/sucursal B no elimina empresaId (empresaId no se sobre-escribe)', () => {
      assert.strictEqual(countPatterns(fn, /where\.empresaId\s*=\s*/g), 0)
      assert.ok(hasPattern(fn, /if \(proveedorId\) where\.proveedorId = parseInt\(proveedorId\)/))
    })
  })

  describe('3. Devoluciones.listar', () => {
    let fn
    before(() => { fn = extractFn(devolucionesSrc, 'exports.listar = async (req, res) => {') })

    it('findMany y count scoped; filtro ventaId no elimina empresaId', () => {
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/))
      assert.ok(hasPattern(fn, /prisma\.devolucion\.count\(\{ where \}\)/))
      assert.strictEqual(countPatterns(fn, /where\.empresaId\s*=\s*/g), 0)
      assert.ok(hasPattern(fn, /if \(ventaId\) where\.ventaId = parseInt\(ventaId\)/))
    })

    it('no expone Venta/Producto/Cliente de B a través de includes', () => {
      assert.ok(hasPattern(fn, /Venta:\s*\{ select/))
      assert.ok(hasPattern(fn, /DetalleDevolucion:\s*\{ include: \{ Producto/))
    })
  })

  describe('4. Cotizaciones.listar (controller + service)', () => {
    it('controller resuelve empresa vía getEmpresaId y la pasa al service', () => {
      const fn = extractFn(cotizCtrl, 'const listar = async (req, res) => {')
      assert.ok(hasPattern(fn, /empresaId: getEmpresaId\(req\)/))
    })

    it('service usa empresaId en where y count; auto-vencer scoped', () => {
      assert.ok(hasPattern(cotizSvc, /async function listar\(\{ empresaId/))
      assert.ok(hasPattern(cotizSvc, /const where = \{ empresaId \}/))
      assert.ok(hasPattern(cotizSvc, /prisma\.cotizacion\.count\(\{ where \}\)/))
      assert.ok(hasPattern(cotizSvc, /WHERE "empresaId" = \$\{empresaId\}/))
    })

    it('filtros no reemplazan empresaId', () => {
      assert.ok(hasPattern(cotizSvc, /if \(tipo\)\s+where\.tipo = tipo/))
      assert.strictEqual(countPatterns(cotizSvc, /where\.empresaId\s*=\s*/g), 0)
    })
  })

  describe('5/6/8. Bitácora normal + full-text', () => {
    let fn
    before(() => { fn = extractFn(bitacoraSrc, 'const listar = async (req, res) => {') })

    it('findMany y count scoped por empresaId', () => {
      assert.ok(hasPattern(fn, /const where = construirWhereScopeTenant\(req\)/))
      assert.ok(hasPattern(fn, /prisma\.bitacora\.count\(\{ where \}\)/))
    })

    it('full-text $queryRaw incluye b."empresaId" y texto parametrizado', () => {
      assert.ok(hasPattern(fn, /b\."empresaId" = \$\{empresaId\}/))
      assert.ok(hasPattern(fn, /plainto_tsquery\('simple', \$\{termLimpio\}\)/))
    })

    it('texto de búsqueda validado (trim) y count usa el mismo where', () => {
      assert.ok(hasPattern(fn, /termLimpio = buscar\.trim\(\)/))
      assert.ok(hasPattern(fn, /prisma\.bitacora\.count\(\{ where \}\)/))
    })

    it('page/limit normalizados de forma segura', () => {
      assert.ok(hasPattern(fn, /Math\.max\(1, parseInt\(page\) \|\| 1\)/))
      assert.ok(hasPattern(fn, /Math\.min\(100, Math\.max\(1, parseInt\(limit\) \|\| 25\)\)/))
    })
  })

  describe('7. Seguridad SQL (global)', () => {
    it('cero $queryRawUnsafe en toda la carpeta de listados', () => {
      for (const src of [pedidosSrc, comprasSrc, devolucionesSrc, cotizSvc, cotizCtrl, bitacoraSrc, helper]) {
        assert.strictEqual(countPatterns(src, /\$queryRawUnsafe/g), 0, 'no debe existir $queryRawUnsafe')
      }
    })

    it('sin concatenación manual de valores en full-text', () => {
      assert.ok(!hasPattern(bitacoraSrc, /plainto_tsquery\('simple', '\s*\+/))
    })

    it('no se construye SQL interpolar nombres/filtros de columnas del cliente en listados', () => {
      assert.ok(!hasPattern(pedidosSrc, /\$\{where\}/g))
      assert.ok(!hasPattern(comprasSrc, /\$\{where\}/g))
      assert.ok(!hasPattern(bitacoraSrc, /\$\{where\}/g))
    })
  })

  describe('12. Respuesta vacía (Empresa C) — contrato de shape', () => {
    it('todos los listados responden envelope con array y total (jamás 404 por vacío)', () => {
      // Los handlers no devuelven 404 por listado; resuelven 200 con shape estable.
      const pedidos = extractFn(pedidosSrc, 'const listar = async (req, res) => {')
      const compras = extractFn(comprasSrc, 'const listar = async (req, res) => {')
      const dev = extractFn(devolucionesSrc, 'exports.listar = async (req, res) => {')
      const bitacoras = extractFn(bitacoraSrc, 'const listar = async (req, res) => {')
      assert.ok(hasPattern(pedidos, /res\.json\(\{ success: true, data: pedidos, total, page: pageInt, limit: limitInt \}\)/))
      assert.ok(hasPattern(compras, /res\.json\(\{ success: true, data: ordenes, total, page: pageInt, limit: limitInt \}\)/))
      assert.ok(hasPattern(dev, /success: true,\n\s+data: devoluciones\.map/))
      assert.ok(hasPattern(bitacoras, /res\.json\(\{ success: true, data: bitacoras, total, page: pageInt, limit: limitInt \}\)/))
    })

    it('cotizaciones usa envelope propio con cotizaciones[]', () => {
      assert.ok(hasPattern(cotizSvc, /return \{ cotizaciones, total, page: pageInt, limit: limitInt \}/))
    })
  })
})