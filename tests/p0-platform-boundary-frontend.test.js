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
