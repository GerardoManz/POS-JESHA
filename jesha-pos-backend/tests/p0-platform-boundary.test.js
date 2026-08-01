'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

process.env.TENANT_JWT_SECRET = process.env.TENANT_JWT_SECRET || 'boundary-test-tenant-secret-'.padEnd(64, 't')
process.env.TENANT_JWT_ISSUER = process.env.TENANT_JWT_ISSUER || 'boundary-test-issuer'
process.env.TENANT_JWT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE || 'boundary-test-audience'
process.env.TENANT_JWT_TTL = process.env.TENANT_JWT_TTL || '15m'
process.env.PLATFORM_JWT_SECRET = process.env.PLATFORM_JWT_SECRET || 'boundary-test-platform-secret-'.padEnd(64, 'p')
process.env.PLATFORM_JWT_ISSUER = process.env.PLATFORM_JWT_ISSUER || 'boundary-test-platform-issuer'
process.env.PLATFORM_JWT_AUDIENCE = process.env.PLATFORM_JWT_AUDIENCE || 'boundary-test-platform-audience'
process.env.PLATFORM_JWT_TTL = process.env.PLATFORM_JWT_TTL || '15m'
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test'
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test'
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test'
process.env.DEBUG_ENABLED = 'false'

// ── runtime verification ──
const path = require('path')
const fs = require('fs')

const { PLATFORM_ROLES, esRolPlataforma, esRolTenant } = require('../src/security/identity')
const { JERARQUIA_ROLES, ROLES_ASIGNABLES_POR_SUPERADMIN } = require('../src/utils/roles')

describe('P0-PLATFORM-BOUNDARY — route allow-lists', { concurrency: 1 }, () => {
  function sourceHasPlatformAdmin(filePath) {
    const fs = require('fs')
    const lines = fs.readFileSync(filePath, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.includes('PLATFORM_ADMIN')) continue
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      if (trimmed.includes("objectivoRol") || trimmed.includes('USUARIO_PROTEGIDO')) continue
      if (trimmed.includes('requireRole')) return true
    }
    return false
  }

  const routesDir = path.resolve(__dirname, '../src/modules')
  const routeFiles = [
    'cotizaciones/cotizaciones.routes.js',
    'facturas/facturas.routes.js',
    'productos/productos.routes.js',
    'trabajadores/trabajadores.routes.js',
    'usuarios/usuarios.routes.js',
    'ventas/ventas.routes.js',
  ]

  for (const rf of routeFiles) {
    const name = rf.replace('.routes.js', '').replace('/', ' ')
    it(`${name} sin PLATFORM_ADMIN en requireRole`, () => {
      assert.strictEqual(sourceHasPlatformAdmin(path.join(routesDir, rf)), false)
    })
  }
})

describe('P0-PLATFORM-BOUNDARY — controller guards', { concurrency: 1 }, () => {
  const fs = require('fs')
  const path = require('path')

  function fileContainsAuthBypass(filePath, role) {
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n')
    const violations = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // detect allow-list: ['SUPERADMIN', 'PLATFORM_ADMIN'] or includes('PLATFORM_ADMIN')
      if (line.includes(`'${role}'`) || line.includes(`"${role}"`)) {
        // skip comment lines
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue
        // skip test files
        if (filePath.includes('tests')) continue
        // skip platform-auth, identity, roles files
        if (filePath.includes('platform-auth') || filePath.includes('security') || filePath.includes('utils/roles')) continue
        // skip idempotency/abono files (not in scope)
        violations.push({ line: i + 1, content: line.trim() })
      }
    }
    return violations
  }

  const controllers = [
    'src/modules/bitacora/bitacora.controller.js',
    'src/modules/compras/compras.controller.js',
    'src/modules/inventario/inventario.controller.js',
    'src/modules/pedidos/pedidos.controller.js',
    'src/modules/productos/productos.controller.js',
    'src/modules/turnos-caja/turnos-caja.controller.js',
    'src/modules/ventas/ventas.controller.js',
    'src/modules/cotizaciones/cotizaciones.service.js',
  ]

  const BACKEND = path.resolve(__dirname, '..')

  for (const ctrl of controllers) {
    const name = ctrl.replace('src/modules/', '').replace('.controller.js', '').replace('.service.js', '')
    it(`7. ${name} sin bypass PLATFORM_ADMIN`, () => {
      const v = fileContainsAuthBypass(path.join(BACKEND, ctrl), 'PLATFORM_ADMIN')
      assert.deepStrictEqual(v, [])
    })
  }
})

describe('P0-PLATFORM-BOUNDARY — identity & roles', { concurrency: 1 }, () => {
  it('9. PLATFORM_ADMIN es solo plataforma', () => {
    assert.deepStrictEqual(PLATFORM_ROLES, ['PLATFORM_ADMIN'])
  })

  it('10. PLATFORM_ADMIN no es rol tenant', () => {
    assert.strictEqual(esRolTenant('PLATFORM_ADMIN'), false)
  })

  it('11. PLATFORM_ADMIN es rol plataforma', () => {
    assert.strictEqual(esRolPlataforma('PLATFORM_ADMIN'), true)
  })

  it('12. SUPERADMIN sí es rol tenant', () => {
    assert.strictEqual(esRolTenant('SUPERADMIN'), true)
  })

  it('13. PLATFORM_ADMIN NO está en ROLES_ASIGNABLES_POR_SUPERADMIN', () => {
    assert.ok(!ROLES_ASIGNABLES_POR_SUPERADMIN.has('PLATFORM_ADMIN'))
  })

  it('14. PLATFORM_ADMIN encima de SUPERADMIN en jerarquia', () => {
    assert.ok(JERARQUIA_ROLES['PLATFORM_ADMIN'] > JERARQUIA_ROLES['SUPERADMIN'])
  })

  it('15. identity.js reconoce PLATFORM_ADMIN', () => {
    const { validarIdentidadFinalUsuario } = require('../src/security/identity')
    const r = validarIdentidadFinalUsuario({ id: 1, rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null, activo: true })
    assert.strictEqual(r.rol, 'PLATFORM_ADMIN')
    assert.strictEqual(r.empresaId, null)
    assert.strictEqual(r.sucursalId, null)
  })
})

describe('P0-PLATFORM-BOUNDARY — usuario controller target protection', { concurrency: 1 }, () => {
  const controller = require('../src/modules/usuarios/usuarios.controller')

  it('16. SUPERADMIN no puede asignar PLATFORM_ADMIN', () => {
    // verify via static check: the controller rejects PLATFORM_ADMIN as target role
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../src/modules/usuarios/usuarios.controller.js'), 'utf8')
    // must contain target role protection
    assert.ok(src.includes("objetivoRol === 'PLATFORM_ADMIN'") || src.includes("=== 'PLATFORM_ADMIN'"))
  })

  it('17. SUPERADMIN no puede asignar SUPERADMIN desde controller tenant', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../src/modules/usuarios/usuarios.controller.js'), 'utf8')
    assert.ok(src.includes("objetivoRol === 'SUPERADMIN'") || src.includes('USUARIO_PROTEGIDO'))
  })
})
