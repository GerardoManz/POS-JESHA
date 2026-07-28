'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const identity = require('../src/security/identity')

function ok(val) { return val }

describe('IDENTITY_KIND', () => {
  it('tiene PLATFORM y TENANT', () => {
    assert.strictEqual(identity.IDENTITY_KIND.PLATFORM, 'PLATFORM')
    assert.strictEqual(identity.IDENTITY_KIND.TENANT, 'TENANT')
  })

  it('está congelado', () => {
    assert.throws(() => { identity.IDENTITY_KIND.PLATFORM = 'X' })
  })
})

describe('PLATFORM_ROLES', () => {
  it('contiene solo PLATFORM_ADMIN', () => {
    assert.deepStrictEqual(identity.PLATFORM_ROLES, ['PLATFORM_ADMIN'])
  })

  it('está congelado', () => {
    assert.throws(() => { identity.PLATFORM_ROLES.push('X') })
  })
})

describe('TENANT_ROLES', () => {
  it('contiene SUPERADMIN, ADMIN_SUCURSAL, EMPLEADO, PRECIOS', () => {
    assert.deepStrictEqual(identity.TENANT_ROLES, [
      'SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO', 'PRECIOS'
    ])
  })

  it('está congelado', () => {
    assert.throws(() => { identity.TENANT_ROLES.push('X') })
  })
})

describe('ALL_ROLES', () => {
  it('incluye los 5 roles', () => {
    assert.strictEqual(identity.ALL_ROLES.length, 5)
    assert.ok(identity.ALL_ROLES.includes('PLATFORM_ADMIN'))
    assert.ok(identity.ALL_ROLES.includes('SUPERADMIN'))
    assert.ok(identity.ALL_ROLES.includes('ADMIN_SUCURSAL'))
    assert.ok(identity.ALL_ROLES.includes('EMPLEADO'))
    assert.ok(identity.ALL_ROLES.includes('PRECIOS'))
  })

  it('está congelado', () => {
    assert.throws(() => { identity.ALL_ROLES.push('X') })
  })
})

describe('esRolPlataforma', () => {
  it('PLATFORM_ADMIN → true', () => {
    assert.strictEqual(identity.esRolPlataforma('PLATFORM_ADMIN'), true)
  })

  it('SUPERADMIN → false', () => {
    assert.strictEqual(identity.esRolPlataforma('SUPERADMIN'), false)
  })

  it('ADMIN_SUCURSAL → false', () => {
    assert.strictEqual(identity.esRolPlataforma('ADMIN_SUCURSAL'), false)
  })

  it('EMPLEADO → false', () => {
    assert.strictEqual(identity.esRolPlataforma('EMPLEADO'), false)
  })

  it('PRECIOS → false', () => {
    assert.strictEqual(identity.esRolPlataforma('PRECIOS'), false)
  })

  it('rol inexistente → false', () => {
    assert.strictEqual(identity.esRolPlataforma('X'), false)
  })
})

describe('esRolTenant', () => {
  it('PLATFORM_ADMIN → false', () => {
    assert.strictEqual(identity.esRolTenant('PLATFORM_ADMIN'), false)
  })

  it('SUPERADMIN → true', () => {
    assert.strictEqual(identity.esRolTenant('SUPERADMIN'), true)
  })

  it('ADMIN_SUCURSAL → true', () => {
    assert.strictEqual(identity.esRolTenant('ADMIN_SUCURSAL'), true)
  })

  it('EMPLEADO → true', () => {
    assert.strictEqual(identity.esRolTenant('EMPLEADO'), true)
  })

  it('PRECIOS → true', () => {
    assert.strictEqual(identity.esRolTenant('PRECIOS'), true)
  })

  it('rol inexistente → false', () => {
    assert.strictEqual(identity.esRolTenant('X'), false)
  })
})

describe('requiereEmpresa', () => {
  it('PLATFORM_ADMIN → false', () => {
    assert.strictEqual(identity.requiereEmpresa('PLATFORM_ADMIN'), false)
  })

  it('SUPERADMIN → true', () => {
    assert.strictEqual(identity.requiereEmpresa('SUPERADMIN'), true)
  })

  it('ADMIN_SUCURSAL → true', () => {
    assert.strictEqual(identity.requiereEmpresa('ADMIN_SUCURSAL'), true)
  })

  it('EMPLEADO → true', () => {
    assert.strictEqual(identity.requiereEmpresa('EMPLEADO'), true)
  })

  it('PRECIOS → true', () => {
    assert.strictEqual(identity.requiereEmpresa('PRECIOS'), true)
  })
})

describe('requiereSucursal', () => {
  it('PLATFORM_ADMIN → false', () => {
    assert.strictEqual(identity.requiereSucursal('PLATFORM_ADMIN'), false)
  })

  it('SUPERADMIN → false', () => {
    assert.strictEqual(identity.requiereSucursal('SUPERADMIN'), false)
  })

  it('ADMIN_SUCURSAL → true', () => {
    assert.strictEqual(identity.requiereSucursal('ADMIN_SUCURSAL'), true)
  })

  it('EMPLEADO → true', () => {
    assert.strictEqual(identity.requiereSucursal('EMPLEADO'), true)
  })

  it('PRECIOS → false', () => {
    assert.strictEqual(identity.requiereSucursal('PRECIOS'), false)
  })
})

describe('permiteSucursalOpcional', () => {
  it('PLATFORM_ADMIN → false', () => {
    assert.strictEqual(identity.permiteSucursalOpcional('PLATFORM_ADMIN'), false)
  })

  it('SUPERADMIN → false', () => {
    assert.strictEqual(identity.permiteSucursalOpcional('SUPERADMIN'), false)
  })

  it('ADMIN_SUCURSAL → true (la requiere)', () => {
    assert.strictEqual(identity.permiteSucursalOpcional('ADMIN_SUCURSAL'), true)
  })

  it('EMPLEADO → true (la requiere)', () => {
    assert.strictEqual(identity.permiteSucursalOpcional('EMPLEADO'), true)
  })

  it('PRECIOS → true (opcional)', () => {
    assert.strictEqual(identity.permiteSucursalOpcional('PRECIOS'), true)
  })
})

describe('esEnteroPositivo', () => {
  it('entero positivo → true', () => {
    assert.strictEqual(identity.esEnteroPositivo(1), true)
    assert.strictEqual(identity.esEnteroPositivo(42), true)
    assert.strictEqual(identity.esEnteroPositivo(999999), true)
  })

  it('0 → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(0), false)
  })

  it('negativo → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(-1), false)
  })

  it('decimal → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(1.5), false)
  })

  it('NaN → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(NaN), false)
  })

  it('Infinity → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(Infinity), false)
  })

  it('bigint → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(1n), false)
  })

  it('boolean → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(true), false)
    assert.strictEqual(identity.esEnteroPositivo(false), false)
  })

  it('string → false', () => {
    assert.strictEqual(identity.esEnteroPositivo('1'), false)
  })

  it('array → false', () => {
    assert.strictEqual(identity.esEnteroPositivo([1]), false)
  })

  it('objeto → false', () => {
    assert.strictEqual(identity.esEnteroPositivo({}), false)
  })

  it('null → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(null), false)
  })

  it('undefined → false', () => {
    assert.strictEqual(identity.esEnteroPositivo(undefined), false)
  })
})

describe('validarIdentidadFinalUsuario — PLATFORM_ADMIN', () => {
  const VALIDO = { id: 1, rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null, activo: true }

  it('válido → snapshot congelado', () => {
    const r = identity.validarIdentidadFinalUsuario(VALIDO)
    assert.strictEqual(r.id, 1)
    assert.strictEqual(r.rol, 'PLATFORM_ADMIN')
    assert.strictEqual(r.activo, true)
    assert.strictEqual(r.empresaId, null)
    assert.strictEqual(r.sucursalId, null)
    assert.strictEqual(Object.isFrozen(r), true)
  })

  it('empresaId presente → IDENTITY_EMPRESA_FORBIDDEN', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, empresaId: 1 }),
      { code: 'IDENTITY_EMPRESA_FORBIDDEN' }
    )
  })

  it('sucursalId presente → IDENTITY_SUCURSAL_FORBIDDEN', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, sucursalId: 1 }),
      { code: 'IDENTITY_SUCURSAL_FORBIDDEN' }
    )
  })

  it('entrada no mutada', () => {
    const entrada = { ...VALIDO }
    const copia = { ...entrada }
    identity.validarIdentidadFinalUsuario(entrada)
    assert.deepStrictEqual(entrada, copia)
  })
})

describe('validarIdentidadFinalUsuario — SUPERADMIN', () => {
  const VALIDO = { id: 2, rol: 'SUPERADMIN', empresaId: 1, sucursalId: null, activo: true }

  it('válido → snapshot congelado', () => {
    const r = identity.validarIdentidadFinalUsuario(VALIDO)
    assert.strictEqual(r.id, 2)
    assert.strictEqual(r.rol, 'SUPERADMIN')
    assert.strictEqual(r.activo, true)
    assert.strictEqual(r.empresaId, 1)
    assert.strictEqual(r.sucursalId, null)
    assert.strictEqual(Object.isFrozen(r), true)
  })

  it('empresaId faltante (null) → IDENTITY_EMPRESA_REQUIRED', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, empresaId: null }),
      { code: 'IDENTITY_EMPRESA_REQUIRED' }
    )
  })

  it('empresaId faltante (undefined) → IDENTITY_EMPRESA_REQUIRED', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: 2, rol: 'SUPERADMIN', activo: true }),
      { code: 'IDENTITY_EMPRESA_REQUIRED' }
    )
  })

  it('sucursalId presente → IDENTITY_SUCURSAL_FORBIDDEN', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, sucursalId: 1 }),
      { code: 'IDENTITY_SUCURSAL_FORBIDDEN' }
    )
  })

  it('entrada no mutada', () => {
    const entrada = { ...VALIDO }
    const copia = { ...entrada }
    identity.validarIdentidadFinalUsuario(entrada)
    assert.deepStrictEqual(entrada, copia)
  })
})

describe('validarIdentidadFinalUsuario — ADMIN_SUCURSAL', () => {
  const VALIDO = { id: 3, rol: 'ADMIN_SUCURSAL', empresaId: 1, sucursalId: 5, activo: true }

  it('válido → snapshot congelado', () => {
    const r = identity.validarIdentidadFinalUsuario(VALIDO)
    assert.strictEqual(r.id, 3)
    assert.strictEqual(r.rol, 'ADMIN_SUCURSAL')
    assert.strictEqual(r.activo, true)
    assert.strictEqual(r.empresaId, 1)
    assert.strictEqual(r.sucursalId, 5)
    assert.strictEqual(Object.isFrozen(r), true)
  })

  it('empresaId faltante → IDENTITY_EMPRESA_REQUIRED', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, empresaId: null }),
      { code: 'IDENTITY_EMPRESA_REQUIRED' }
    )
  })

  it('sucursalId faltante (null) → IDENTITY_SUCURSAL_REQUIRED', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, sucursalId: null }),
      { code: 'IDENTITY_SUCURSAL_REQUIRED' }
    )
  })

  it('sucursalId faltante (undefined) → IDENTITY_SUCURSAL_REQUIRED', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: 3, rol: 'ADMIN_SUCURSAL', empresaId: 1, activo: true }),
      { code: 'IDENTITY_SUCURSAL_REQUIRED' }
    )
  })

  it('sucursalId 0 → IDENTITY_SUCURSAL_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, sucursalId: 0 }),
      { code: 'IDENTITY_SUCURSAL_INVALID' }
    )
  })

  it('sucursalId string → IDENTITY_SUCURSAL_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, sucursalId: '5' }),
      { code: 'IDENTITY_SUCURSAL_INVALID' }
    )
  })

  it('sucursalId decimal → IDENTITY_SUCURSAL_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, sucursalId: 5.5 }),
      { code: 'IDENTITY_SUCURSAL_INVALID' }
    )
  })

  it('sucursalId negativo → IDENTITY_SUCURSAL_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, sucursalId: -1 }),
      { code: 'IDENTITY_SUCURSAL_INVALID' }
    )
  })

  it('entrada no mutada', () => {
    const entrada = { ...VALIDO }
    const copia = { ...entrada }
    identity.validarIdentidadFinalUsuario(entrada)
    assert.deepStrictEqual(entrada, copia)
  })
})

describe('validarIdentidadFinalUsuario — EMPLEADO', () => {
  const VALIDO = { id: 4, rol: 'EMPLEADO', empresaId: 1, sucursalId: 5, activo: true }

  it('válido → snapshot congelado', () => {
    const r = identity.validarIdentidadFinalUsuario(VALIDO)
    assert.strictEqual(r.id, 4)
    assert.strictEqual(r.rol, 'EMPLEADO')
    assert.strictEqual(r.activo, true)
    assert.strictEqual(r.empresaId, 1)
    assert.strictEqual(r.sucursalId, 5)
    assert.strictEqual(Object.isFrozen(r), true)
  })

  it('empresaId faltante → IDENTITY_EMPRESA_REQUIRED', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, empresaId: null }),
      { code: 'IDENTITY_EMPRESA_REQUIRED' }
    )
  })

  it('sucursalId faltante → IDENTITY_SUCURSAL_REQUIRED', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...VALIDO, sucursalId: null }),
      { code: 'IDENTITY_SUCURSAL_REQUIRED' }
    )
  })

  it('entrada no mutada', () => {
    const entrada = { ...VALIDO }
    const copia = { ...entrada }
    identity.validarIdentidadFinalUsuario(entrada)
    assert.deepStrictEqual(entrada, copia)
  })
})

describe('validarIdentidadFinalUsuario — PRECIOS', () => {
  const CON_SUCURSAL = { id: 5, rol: 'PRECIOS', empresaId: 1, sucursalId: 5, activo: true }
  const SIN_SUCURSAL = { id: 5, rol: 'PRECIOS', empresaId: 1, sucursalId: null, activo: true }

  it('válido con sucursal → snapshot', () => {
    const r = identity.validarIdentidadFinalUsuario(CON_SUCURSAL)
    assert.strictEqual(r.rol, 'PRECIOS')
    assert.strictEqual(r.empresaId, 1)
    assert.strictEqual(r.sucursalId, 5)
  })

  it('válido sin sucursal → snapshot', () => {
    const r = identity.validarIdentidadFinalUsuario(SIN_SUCURSAL)
    assert.strictEqual(r.rol, 'PRECIOS')
    assert.strictEqual(r.empresaId, 1)
    assert.strictEqual(r.sucursalId, null)
  })

  it('empresaId faltante → IDENTITY_EMPRESA_REQUIRED', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...CON_SUCURSAL, empresaId: null }),
      { code: 'IDENTITY_EMPRESA_REQUIRED' }
    )
  })

  it('sucursalId inválido (string) → IDENTITY_SUCURSAL_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...CON_SUCURSAL, sucursalId: '5' }),
      { code: 'IDENTITY_SUCURSAL_INVALID' }
    )
  })

  it('sucursalId inválido (decimal) → IDENTITY_SUCURSAL_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...CON_SUCURSAL, sucursalId: 5.5 }),
      { code: 'IDENTITY_SUCURSAL_INVALID' }
    )
  })

  it('sucursalId inválido (negativo) → IDENTITY_SUCURSAL_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ ...CON_SUCURSAL, sucursalId: -1 }),
      { code: 'IDENTITY_SUCURSAL_INVALID' }
    )
  })

  it('entrada no mutada', () => {
    const entrada = { ...CON_SUCURSAL }
    const copia = { ...entrada }
    identity.validarIdentidadFinalUsuario(entrada)
    assert.deepStrictEqual(entrada, copia)
  })
})

describe('validarIdentidadFinalUsuario — generales', () => {
  it('rol desconocido → IDENTITY_ROLE_UNKNOWN', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: 1, rol: 'X', activo: true }),
      { code: 'IDENTITY_ROLE_UNKNOWN' }
    )
  })

  it('activo no boolean → IDENTITY_ACTIVE_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: 1, rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: 1 }),
      { code: 'IDENTITY_ACTIVE_INVALID' }
    )
  })

  it('activo string → IDENTITY_ACTIVE_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: 1, rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: 'true' }),
      { code: 'IDENTITY_ACTIVE_INVALID' }
    )
  })

  it('id 0 → IDENTITY_INPUT_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: 0, rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: true }),
      { code: 'IDENTITY_INPUT_INVALID' }
    )
  })

  it('id negativo → IDENTITY_INPUT_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: -1, rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: true }),
      { code: 'IDENTITY_INPUT_INVALID' }
    )
  })

  it('id decimal → IDENTITY_INPUT_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: 1.5, rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: true }),
      { code: 'IDENTITY_INPUT_INVALID' }
    )
  })

  it('id string → IDENTITY_INPUT_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario({ id: '1', rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: true }),
      { code: 'IDENTITY_INPUT_INVALID' }
    )
  })

  it('input null → IDENTITY_INPUT_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario(null),
      { code: 'IDENTITY_INPUT_INVALID' }
    )
  })

  it('input array → IDENTITY_INPUT_INVALID', () => {
    assert.throws(
      () => identity.validarIdentidadFinalUsuario([1]),
      { code: 'IDENTITY_INPUT_INVALID' }
    )
  })

  it('propiedades extra eliminadas del snapshot', () => {
    const r = identity.validarIdentidadFinalUsuario({
      id: 1, rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: true,
      passwordHash: 'abc', username: 'juan', nombre: 'Juan'
    })
    assert.strictEqual(r.passwordHash, undefined)
    assert.strictEqual(r.username, undefined)
    assert.strictEqual(r.nombre, undefined)
  })

  it('snapshot congelado no se puede mutar', () => {
    const r = identity.validarIdentidadFinalUsuario({
      id: 1, rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: true
    })
    assert.throws(() => { r.rol = 'SUPERADMIN' })
  })
})

describe('detectarIdentidadLegacy', () => {
  it('PLATFORM_ADMIN con empresaId → PLATFORM_ADMIN_CON_EMPRESA_LEGACY', () => {
    const r = identity.detectarIdentidadLegacy({
      id: 1, rol: 'PLATFORM_ADMIN', empresaId: 1, sucursalId: null, activo: true
    })
    assert.strictEqual(r, 'PLATFORM_ADMIN_CON_EMPRESA_LEGACY')
  })

  it('PLATFORM_ADMIN con sucursalId → PLATFORM_ADMIN_CON_EMPRESA_LEGACY', () => {
    const r = identity.detectarIdentidadLegacy({
      id: 1, rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: 5, activo: true
    })
    assert.strictEqual(r, 'PLATFORM_ADMIN_CON_EMPRESA_LEGACY')
  })

  it('PLATFORM_ADMIN correcto (todo null) → null', () => {
    const r = identity.detectarIdentidadLegacy({
      id: 1, rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null, activo: true
    })
    assert.strictEqual(r, null)
  })

  it('SUPERADMIN → null (no es legacy)', () => {
    const r = identity.detectarIdentidadLegacy({
      id: 2, rol: 'SUPERADMIN', empresaId: 1, sucursalId: null, activo: true
    })
    assert.strictEqual(r, null)
  })

  it('input null → null', () => {
    assert.strictEqual(identity.detectarIdentidadLegacy(null), null)
  })
})

describe('crearPrincipalPlataforma', () => {
  it('PLATFORM_ADMIN válido → principal congelado', () => {
    const p = identity.crearPrincipalPlataforma({
      id: 1, rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null, activo: true
    })
    assert.strictEqual(p.version, 1)
    assert.strictEqual(p.kind, 'PLATFORM')
    assert.strictEqual(p.sub, 1)
    assert.strictEqual(p.rol, 'PLATFORM_ADMIN')
    assert.strictEqual(Object.isFrozen(p), true)
  })

  it('no incluye empresaId', () => {
    const p = identity.crearPrincipalPlataforma({
      id: 1, rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null, activo: true
    })
    assert.strictEqual(p.empresaId, undefined)
    assert.strictEqual(p.sucursalId, undefined)
    assert.strictEqual(p.username, undefined)
    assert.strictEqual(p.nombre, undefined)
    assert.strictEqual(p.activo, undefined)
    assert.strictEqual(p.passwordHash, undefined)
  })

  it('SUPERADMIN → lanza', () => {
    assert.throws(
      () => identity.crearPrincipalPlataforma({
        id: 2, rol: 'SUPERADMIN', empresaId: 1, sucursalId: null, activo: true
      }),
      { code: 'IDENTITY_ROLE_UNKNOWN' }
    )
  })
})

describe('crearPrincipalTenant', () => {
  it('SUPERADMIN → principal congelado', () => {
    const p = identity.crearPrincipalTenant({
      id: 2, rol: 'SUPERADMIN', empresaId: 1, sucursalId: null, activo: true
    })
    assert.strictEqual(p.version, 1)
    assert.strictEqual(p.kind, 'TENANT')
    assert.strictEqual(p.sub, 2)
    assert.strictEqual(p.rol, 'SUPERADMIN')
    assert.strictEqual(Object.isFrozen(p), true)
  })

  it('ADMIN_SUCURSAL → principal', () => {
    const p = identity.crearPrincipalTenant({
      id: 3, rol: 'ADMIN_SUCURSAL', empresaId: 1, sucursalId: 1, activo: true
    })
    assert.strictEqual(p.rol, 'ADMIN_SUCURSAL')
  })

  it('EMPLEADO → principal', () => {
    const p = identity.crearPrincipalTenant({
      id: 4, rol: 'EMPLEADO', empresaId: 1, sucursalId: 1, activo: true
    })
    assert.strictEqual(p.rol, 'EMPLEADO')
  })

  it('PRECIOS → principal', () => {
    const p = identity.crearPrincipalTenant({
      id: 5, rol: 'PRECIOS', empresaId: 1, sucursalId: null, activo: true
    })
    assert.strictEqual(p.rol, 'PRECIOS')
  })

  it('no incluye secretos ni extras', () => {
    const p = identity.crearPrincipalTenant({
      id: 2, rol: 'SUPERADMIN', empresaId: 1, sucursalId: null, activo: true,
      passwordHash: 'abc', PIN: '1234'
    })
    assert.strictEqual(p.passwordHash, undefined)
    assert.strictEqual(p.PIN, undefined)
    assert.strictEqual(p.empresaId, undefined)
    assert.strictEqual(p.sucursalId, undefined)
  })

  it('PLATFORM_ADMIN → lanza', () => {
    assert.throws(
      () => identity.crearPrincipalTenant({
        id: 1, rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null, activo: true
      }),
      { code: 'IDENTITY_ROLE_UNKNOWN' }
    )
  })
})
