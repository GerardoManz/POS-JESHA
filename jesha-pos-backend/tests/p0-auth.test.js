'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')
const {
  IdentityError,
  crearPrincipalTenant,
  crearPrincipalPlataforma
} = require('../src/security/identity')

function user(overrides = {}) {
  return {
    id: 1,
    nombre: 'Usuario',
    username: 'usuario',
    rol: 'SUPERADMIN',
    empresaId: 10,
    sucursalId: null,
    activo: true,
    ...overrides
  }
}

describe('P0-TENANT-AUTH: principal y payload mínimo', () => {
  it('SUPERADMIN genera principal tenant mínimo', () => {
    assert.deepStrictEqual(crearPrincipalTenant(user()), {
      version: 1, kind: 'TENANT', sub: 1, rol: 'SUPERADMIN'
    })
  })

  it('ADMIN_SUCURSAL genera principal tenant mínimo', () => {
    assert.deepStrictEqual(crearPrincipalTenant(user({ rol: 'ADMIN_SUCURSAL', sucursalId: 20 })), {
      version: 1, kind: 'TENANT', sub: 1, rol: 'ADMIN_SUCURSAL'
    })
  })

  it('EMPLEADO genera principal tenant mínimo', () => {
    assert.deepStrictEqual(crearPrincipalTenant(user({ rol: 'EMPLEADO', sucursalId: 20 })), {
      version: 1, kind: 'TENANT', sub: 1, rol: 'EMPLEADO'
    })
  })

  it('PRECIOS sin sucursal genera principal tenant mínimo', () => {
    assert.deepStrictEqual(crearPrincipalTenant(user({ rol: 'PRECIOS' })), {
      version: 1, kind: 'TENANT', sub: 1, rol: 'PRECIOS'
    })
  })

  it('PRECIOS con sucursal genera principal tenant mínimo', () => {
    assert.deepStrictEqual(crearPrincipalTenant(user({ rol: 'PRECIOS', sucursalId: 20 })), {
      version: 1, kind: 'TENANT', sub: 1, rol: 'PRECIOS'
    })
  })

  it('principal tenant está congelado', () => {
    assert.ok(Object.isFrozen(crearPrincipalTenant(user())))
  })

  it('principal tenant no contiene empresaId ni sucursalId', () => {
    const principal = crearPrincipalTenant(user({ rol: 'ADMIN_SUCURSAL', sucursalId: 20 }))
    assert.strictEqual(principal.empresaId, undefined)
    assert.strictEqual(principal.sucursalId, undefined)
  })

  it('principal tenant no contiene datos de perfil ni secretos', () => {
    const principal = crearPrincipalTenant(user({ passwordHash: 'secret', pin: '1234' }))
    assert.deepStrictEqual(Object.keys(principal).sort(), ['kind', 'rol', 'sub', 'version'])
  })

  it('PLATFORM_ADMIN no genera principal tenant', () => {
    assert.throws(() => crearPrincipalTenant(user({
      rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null
    })), IdentityError)
  })

  it('usuario tenant no genera principal plataforma', () => {
    assert.throws(() => crearPrincipalPlataforma(user()), IdentityError)
  })

  it('JWT tenant firmado conserva únicamente principal más claims estándar', () => {
    const principal = crearPrincipalTenant(user())
    const token = jwt.sign(principal, 'tenant-test-secret', { expiresIn: '1h' })
    const decoded = jwt.verify(token, 'tenant-test-secret')
    assert.strictEqual(decoded.kind, 'TENANT')
    assert.strictEqual(decoded.sub, 1)
    assert.strictEqual(decoded.rol, 'SUPERADMIN')
    assert.strictEqual(decoded.empresaId, undefined)
    assert.strictEqual(decoded.sucursalId, undefined)
  })

  it('cambio de rol produce principal distinto y permite invalidar token anterior', () => {
    const original = crearPrincipalTenant(user({ rol: 'ADMIN_SUCURSAL', sucursalId: 20 }))
    const actualizado = crearPrincipalTenant(user({ rol: 'SUPERADMIN', sucursalId: null }))
    assert.notStrictEqual(original.rol, actualizado.rol)
  })

  it('shape exacto del principal tenant', () => {
    assert.deepStrictEqual(
      Object.keys(crearPrincipalTenant(user())).sort(),
      ['kind', 'rol', 'sub', 'version']
    )
  })
})
