'use strict'
// P0-TURNOS-IMPORTACION-BRANCH-SCOPE — Auditoría estática de código.
// Sin DB. Verifica que los módulos operativos usen req.context.branch.sucursalId
// (helper resolverSucursalId) y hayan eliminado los fallbacks a Sucursal 1.
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname, '../src')

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

describe('P0-BRANCH-OPERATIONAL-SCOPE (estático)', () => {
  // ── TURNOS-CAJA ────────────────────────────────────────────────
  it('1. turnos: sin fallback `sucursalIdToken || ... || 1`', () => {
    const src = read('modules/turnos-caja/turnos-caja.controller.js')
    assert.ok(!/sucursalIdToken\s*\|\|/.test(src), 'queda fallback sucursalIdToken ||')
    assert.ok(!/sucursalIdToken\s*=\s*[^;]*\|\|\s*1/.test(src), 'queda fallback || 1')
  })

  it('2. turnos: usa resolverSucursalId(req) en todos los handlers', () => {
    const src = read('modules/turnos-caja/turnos-caja.controller.js')
    const usos = (src.match(/resolverSucursalId\(req\)/g) || []).length
    assert.ok(usos >= 5, `esperaba >=5 usos de resolverSucursalId, vi ${usos}`)
    assert.ok(src.includes("require('../sucursal/sucursal.helper')"), 'falta import resolverSucursalId')
  })

  it('3. turnos: abrirTurno serializa con FOR UPDATE y scopa turno por empresa', () => {
    const src = read('modules/turnos-caja/turnos-caja.controller.js')
    assert.ok(src.includes('FOR UPDATE'), 'falta lock FOR UPDATE en abrirTurno')
    assert.ok(src.includes('empresaId, sucursalId, abierto: true'), 'falta scoping empresaId en apertura/cierre')
  })

  it('4. turnos.routes: branchRequired en abrir/cerrar y branchOptional en lecturas', () => {
    const src = read('modules/turnos-caja/turnos-caja.routes.js')
    assert.ok(/post\('\/abrir'.+requireTenantOrDelegated.+branchRequired/.test(src), 'abrir sin branchRequired')
    assert.ok(/post\('\/cerrar'.+requireTenantOrDelegated.+branchRequired/.test(src), 'cerrar sin branchRequired')
    for (const ruta of ['activo', 'resumen', 'historial', 'resumen-contable']) {
      assert.ok(src.includes(`'/${ruta}',`), `falta ruta /${ruta}`)
    }
  })

  // ── IMPORTACIÓN ─────────────────────────────────────────────────
  it('5. importación: elimina `req.usuario?.sucursalId || 1`', () => {
    const src = read('modules/productos/importacion.controller.js')
    assert.ok(!src.includes('req.usuario?.sucursalId'), 'queda fallback req.usuario?.sucursalId')
    assert.ok(!/sucursalId\s*=\s*[^;]*\|\|\s*1/.test(src), 'queda fallback || 1')
  })

  it('6. importación: usa resolverSucursalId y guarda inventario con sucursal !== null', () => {
    const src = read('modules/productos/importacion.controller.js')
    assert.ok(src.includes('resolverSucursalId(req)'), 'falta resolución desde contexto')
    assert.ok(src.includes("require('../sucursal/sucursal.helper')"), 'falta import resolverSucursalId')
    const guards = (src.match(/sucursalId !== null/g) || []).length
    assert.ok(guards >= 3, `esperaba >=3 guardas 'sucursalId !== null' para inventario, vi ${guards}`)
  })

  // ── COMPRAS ────────────────────────────────────────────────────
  it('7. compras: elimina fallback de sucursal y usa resolverSucursalId', () => {
    const src = read('modules/compras/compras.controller.js')
    assert.ok(!/sucursalIdToken\s*\|\|/.test(src), 'queda fallback sucursalIdToken ||')
    assert.ok((src.match(/resolverSucursalId\(req\)/g) || []).length >= 5, 'faltan usos de resolverSucursalId')
  })

  it('8. compras: recibir scopa la OC por empresaId + sucursal operativa', () => {
    const src = read('modules/compras/compras.controller.js')
    assert.ok(src.includes('empresaId, sucursalId }'), 'falta ocScoped por empresaId+sucursalId en recibir')
    assert.ok(src.includes("error: 'Orden no encontrada'"), 'falta respuesta opaca para OC fuera de scope')
  })

  it('9. compras.routes: branchRequired en POST / y /:id/recibir', () => {
    const src = read('modules/compras/compras.routes.js')
    assert.ok(/post\('\/',[^\n]*branchRequired[^\n]*c\.crear/.test(src), 'crear sin branchRequired')
    assert.ok(/post\('\/:id\/recibir',[^\n]*branchRequired[^\n]*c\.recibir/.test(src), 'recibir sin branchRequired')
  })

  // ── COTIZACIONES ───────────────────────────────────────────────
  it('10. cotizaciones: elimina fallbacks y usa resolverSucursalId', () => {
    const src = read('modules/cotizaciones/cotizaciones.controller.js')
    assert.ok(!/sucursalIdToken\s*\|\|/.test(src), 'queda fallback en cotizaciones')
    assert.ok((src.match(/resolverSucursalId\(req\)/g) || []).length >= 4, 'faltan usos en cotizaciones')
  })

  it('11. cotizaciones.routes: branchRequired en crear/editar/cambiarEstado', () => {
    const src = read('modules/cotizaciones/cotizaciones.routes.js')
    assert.ok(/post\('\/',\s+branchRequired,\s+ctrl\.crear/.test(src), 'crear sin branchRequired')
    assert.ok(/put\('\/:id',\s+branchRequired,\s+ctrl\.editar/.test(src), 'editar sin branchRequired')
    assert.ok(/patch\('\/:id\/estado',\s+branchRequired/.test(src), 'cambiarEstado sin branchRequired')
  })

  // ── REPORTE-STOCK ──────────────────────────────────────────────
  it('12. reporte-stock: elimina `query.sucursalId ? parseInt : (... || 1)`', () => {
    const src = read('modules/reportes/reporte-stock.controller.js')
    assert.ok(!src.includes('req.query.sucursalId ? parseInt'), 'queda selección por query fallback')
    assert.ok(!/sucursalIdToken\s*\|\|/.test(src), 'queda fallback sucursalIdToken ||')
  })

  it('13. reporte-stock: consolida NONE (sucursalId null) en buildReporteData', () => {
    const src = read('modules/reportes/reporte-stock.controller.js')
    assert.ok(src.includes('sucursalId === null'), 'falta consolidación NONE en buildReporteData')
    assert.ok(src.includes('sucursalId: sucursalWhere'), 'falta alcance dinámico por sucursal')
    assert.ok(src.includes('resolverSucursalId(req)'), 'falta resolverSucursalId en reportes')
  })

  it('14. reporte-stock.routes: branchRequired en alertas/generar y corregir-plantilla', () => {
    const src = read('modules/reportes/reporte-stock.routes.js')
    assert.ok(/post\('\/stock\/alertas\/generar'.+branchRequired/.test(src), 'generar sin branchRequired')
    assert.ok(/post\('\/stock\/corregir-plantilla'.+branchRequired/.test(src), 'corregirPlantilla sin branchRequired')
  })

  // ── HELPER ─────────────────────────────────────────────────────
  it('15. sucursal.helper: resolverSucursalId devuelve contexto branch, nunca sucursal 1', () => {
    const src = read('modules/sucursal/sucursal.helper.js')
    assert.ok(src.includes('context.branch.sucursalId'), 'resolverSucursalId no lee del contexto')
    assert.ok(!src.includes('|| 1'), 'resolverSucursalId no debe tener fallback 1')
  })
})
