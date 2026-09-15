'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

describe('P0-PLATFORM-BOUNDARY-FRONTEND', { concurrency: 1 }, () => {
  function fileHasPlatformAdminAuth(filePath) {
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.includes('PLATFORM_ADMIN')) continue
      const trimmed = line.trim()
      // skip comments and test files
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      // reject: active blocking (good)
      if (trimmed.includes('replace') || trimmed.includes('clear()')) continue
      if (trimmed.includes('ROLES_PERMITIDOS')) {
        return { file: filePath, line: i + 1, content: trimmed, type: 'ROLES_PERMITIDOS' }
      }
      if (trimmed.includes('rol ===') || trimmed.includes('rol !==')) {
        return { file: filePath, line: i + 1, content: trimmed, type: 'BYPASS' }
      }
    }
    return null
  }

  const tenantPages = [
    'usuarios.js',
    'usuarios.html',
    'dashboard.js',
    'productos.js',
    'punto-venta.js',
    'compras.js',
    'cotizaciones.js',
    'facturas.js',
    'pedidos.js',
    'historial.js',
    'historial-cortes.js',
    'corte-caja.js',
    'bitacora.js',
    'clientes.js',
  ]

  for (const page of tenantPages) {
    const filePath = path.join(ROOT, page)
    if (!fs.existsSync(filePath)) continue
    it(`${page} sin autorización PLATFORM_ADMIN`, () => {
      const v = fileHasPlatformAdminAuth(filePath)
      assert.strictEqual(v, null)
    })
  }
})

describe('P0-PLATFORM-BOUNDARY-FRONTEND — guard tenant', { concurrency: 1 }, () => {
  const sidebarContent = fs.readFileSync(path.join(ROOT, 'sidebar.js'), 'utf8')

  it('sidebar.js rechaza PLATFORM_ADMIN en paginas tenant', () => {
    assert.ok(sidebarContent.includes('jeshaSession?.clear()'))
    assert.ok(sidebarContent.includes("rol === 'PLATFORM_ADMIN'"))
  })

  it('login híbrido mantiene separación platform/tenant', () => {
    const loginContent = fs.readFileSync(path.join(ROOT, 'login.js'), 'utf8')
    assert.ok(loginContent.includes('empresaSlug') || loginContent.includes('PLATFORM'))
  })
})

describe('P0-PLATFORM-BOUNDARY-FRONTEND — historial', { concurrency: 1 }, () => {
  const historialContent = fs.readFileSync(path.join(ROOT, 'historial.js'), 'utf8')
  const sessionContent = fs.readFileSync(path.join(ROOT, 'session.js'), 'utf8')
  const cargarCatalogos = historialContent.match(/async function cargarCatalogos[\s\S]*?^}/m)?.[0] || ''

  it('PB01 PLATFORM_ADMIN directo no tiene bypass tenant', () => {
    assert.doesNotMatch(cargarCatalogos, /PLATFORM_ADMIN/)
  })

  it('PB02 SUPERADMIN tenant mantiene el catálogo completo de usuarios', () => {
    assert.match(cargarCatalogos, /USUARIO\.rol === 'SUPERADMIN'/)
    assert.match(cargarCatalogos, /fetch\(`\$\{API_URL\}\/usuarios`\)/)
  })

  it('PB03 ADMIN_SUCURSAL mantiene el catálogo de vendedores', () => {
    assert.match(cargarCatalogos, /}\s*else\s*{[\s\S]*\/usuarios\/vendedores/)
  })

  it('PB04 PLATFORM_ADMIN delegado usa rol efectivo SUPERADMIN', () => {
    assert.match(sessionContent, /rol: 'SUPERADMIN'/)
    assert.match(sessionContent, /actorRol: 'PLATFORM_ADMIN'/)
    assert.match(sessionContent, /effectiveRole: 'SUPERADMIN'/)
  })

  it('PB05 EMPLEADO no recibe permisos de SUPERADMIN', () => {
    assert.doesNotMatch(cargarCatalogos, /USUARIO\.rol === 'EMPLEADO'/)
    assert.match(cargarCatalogos, /}\s*else\s*{[\s\S]*\/usuarios\/vendedores/)
  })
})
