'use strict'
// P0-PLATFORM-COMPANY-PROVISIONING — Suites unitarias del controller de Empresas (sin BD).
// Cubre validación del payload, campos prohibidos/desconocidos, normalización de
// construirData y el error tipado EmpresaPlatformError. El comportamiento HTTP con
// PostgreSQL real vive en p0-platform-empresas-postgres.test.js.
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  EmpresaPlatformError,
  validarPayload,
  construirData,
  validarPayloadSuperadmin
} = require('../src/modules/empresas/empresas.controller')

function capturar(build) {
  try {
    build()
    return null
  } catch (err) {
    return err
  }
}

describe('P0-PLATFORM-EMPRESAS unit — validarPayload crear (esCrear=true)', () => {
  it('campos obligatorios faltantes → errores por campo', () => {
    const err = capturar(() => validarPayload({}, true))
    assert.ok(err instanceof EmpresaPlatformError)
    assert.strictEqual(err.status, 400)
    assert.strictEqual(err.code, 'EMPRESA_DATOS_INVALIDOS')
    const campos = err.errores.map((e) => e.campo)
    for (const c of ['slug', 'nombreComercial', 'razonSocial', 'whatsapp']) {
      assert.ok(campos.includes(c), `falta error de obligatorio para ${c}`)
    }
  })

  it('body vacío no debe ser válido', () => {
    const err = capturar(() => validarPayload(null, true))
    assert.ok(err instanceof EmpresaPlatformError)
    assert.strictEqual(err.code, 'EMPRESA_BODY_INVALIDO')
  })

  it('payload correcto → sin errores', () => {
    validarPayload({
      slug: 'ferre-plus',
      nombreComercial: 'Ferre Plus',
      razonSocial: 'Ferre Plus SA de CV',
      whatsapp: '5555555555'
    }, true)
  })

  it('rfc opcional válido se acepta', () => {
    validarPayload({
      slug: 'ferre-plus',
      nombreComercial: 'Ferre Plus',
      razonSocial: 'Ferre Plus SA de CV',
      whatsapp: '5555555555',
      rfc: 'FPL123456789'
    }, true)
  })
})

describe('P0-PLATFORM-EMPRESAS unit — campos prohibidos', () => {
  const casos = ['id', 'activa', 'creadoEn', 'creadaEn', 'empresaId', 'sucursalId', 'usuarioId', 'password', 'passwordHash']

  for (const campo of casos) {
    it(`${campo} en el body → error de prohibido`, () => {
      const payload = {
        slug: 'ferre-plus',
        nombreComercial: 'Ferre Plus',
        razonSocial: 'Ferre Plus SA',
        whatsapp: '5555555555'
      }
      payload[campo] = 'cualquier-valor'
      const err = capturar(() => validarPayload(payload, true))
      assert.ok(err instanceof EmpresaPlatformError)
      assert.ok(err.errores.some((e) => e.campo === campo), `debe reportar ${campo}`)
    })
  }
})

describe('P0-PLATFORM-EMPRESAS unit — validación de slug', () => {
  const slugValido = {
    slug: 'ferre-plus',
    nombreComercial: 'Ferre Plus',
    razonSocial: 'Ferre Plus SA',
    whatsapp: '5555555555'
  }

  it('slug en mayúsculas se normaliza a minúsculas (válido)', () => {
    const data = construirData({ slug: 'FERRES-PLUS' })
    assert.strictEqual(data.slug, 'ferres-plus')
    validarPayload({ ...slugValido, slug: 'FERRES-PLUS' }, true)
  })

  it('slug con espacios → error', () => {
    const err = capturar(() => validarPayload({ ...slugValido, slug: 'ferre plus' }, true))
    assert.ok(err.errores.some((e) => e.campo === 'slug'))
  })

  it('slug con acentos → error', () => {
    const err = capturar(() => validarPayload({ ...slugValido, slug: 'ferréplus' }, true))
    assert.ok(err.errores.some((e) => e.campo === 'slug'))
  })

  it('slug de 1 carácter → error (mínimo 2)', () => {
    const err = capturar(() => validarPayload({ ...slugValido, slug: 'f' }, true))
    assert.ok(err.errores.some((e) => e.campo === 'slug'))
  })

  it('slug con guiones dobles → error', () => {
    const err = capturar(() => validarPayload({ ...slugValido, slug: 'ferre--plus' }, true))
    assert.ok(err.errores.some((e) => e.campo === 'slug'))
  })

  it('slug numérico con guiones correcto → válido', () => {
    validarPayload({ ...slugValido, slug: 'ferre-2026' }, true)
  })
})

describe('P0-PLATFORM-EMPRESAS unit — validación de longitudes', () => {
  const base = {
    slug: 'ferre-plus',
    nombreComercial: 'Ferre Plus',
    razonSocial: 'Ferre Plus SA',
    whatsapp: '5555555555'
  }

  it('nombreComercial de 1 char → error', () => {
    const err = capturar(() => validarPayload({ ...base, nombreComercial: 'F' }, true))
    assert.ok(err.errores.some((e) => e.campo === 'nombreComercial'))
  })

  it('whatsapp demasiado corto (<7) → error', () => {
    const err = capturar(() => validarPayload({ ...base, whatsapp: '123' }, true))
    assert.ok(err.errores.some((e) => e.campo === 'whatsapp'))
  })

  it('rfc de más de 20 chars → error', () => {
    const err = capturar(() => validarPayload({ ...base, rfc: 'A'.repeat(21) }, true))
    assert.ok(err.errores.some((e) => e.campo === 'rfc'))
  })

  it('notas de más de 1000 chars → error', () => {
    const err = capturar(() => validarPayload({ ...base, notas: 'x'.repeat(1001) }, true))
    assert.ok(err.errores.some((e) => e.campo === 'notas'))
  })
})

describe('P0-PLATFORM-EMPRESAS unit — validarPayload editar (esCrear=false)', () => {
  it('payload vacío en edición → sin errores (la rama "sin cambios" la valida el controller)', () => {
    validarPayload({}, false)
  })

  it('editar con activa → error de prohibido', () => {
    const err = capturar(() => validarPayload({ activa: true }, false))
    assert.ok(err.errores.some((e) => e.campo === 'activa'))
  })

  it('editar con slug válido → sin errores', () => {
    validarPayload({ slug: 'ferre-plus-2' }, false)
  })

  it('editar con campo inventado → error de desconocido', () => {
    const err = capturar(() => validarPayload({ inventado: 'x' }, false))
    assert.ok(err.errores.some((e) => e.campo === 'inventado'))
  })
})

describe('P0-PLATFORM-EMPRESAS unit — construirData (normalización)', () => {
  it('slug se normaliza a minúsculas', () => {
    const data = construirData({ slug: '  FERRE-PLUS ' })
    assert.strictEqual(data.slug, 'ferre-plus')
  })

  it('rfc se normaliza a mayúsculas', () => {
    const data = construirData({ rfc: 'fpl123456789' })
    assert.strictEqual(data.rfc, 'FPL123456789')
  })

  it('rfc vacío se guarda como null', () => {
    const data = construirData({ rfc: '   ' })
    assert.strictEqual(data.rfc, null)
  })

  it('rfc null se conserva null', () => {
    const data = construirData({ rfc: null })
    assert.strictEqual(data.rfc, null)
  })

  it('notas vacío → null', () => {
    const data = construirData({ notas: '' })
    assert.strictEqual(data.notas, null)
  })

  it('construirData NUNCA incluye activa (el estado lo impone el backend)', () => {
    const data = construirData({ activa: true, slug: 'x1', nombreComercial: 'X', razonSocial: 'X SA', whatsapp: '0000000000' })
    assert.strictEqual(Object.hasOwn(data, 'activa'), false)
    assert.strictEqual(Object.hasOwn(data, 'id'), false)
    assert.strictEqual(Object.hasOwn(data, 'empresaId'), false)
  })
})

describe('P0-PLATFORM-EMPRESAS unit — EmpresaPlatformError shape', () => {
  it('constructor expone status, code y expose', () => {
    const err = new EmpresaPlatformError(409, 'EMPRESA_SIN_SUPERADMIN', 'mensaje')
    assert.strictEqual(err.status, 409)
    assert.strictEqual(err.code, 'EMPRESA_SIN_SUPERADMIN')
    assert.strictEqual(err.expose, true)
    assert.strictEqual(err.message, 'mensaje')
  })
})

describe('P0-PLATFORM-EMPRESAS unit — validarPayloadSuperadmin', () => {
  const valido = { nombre: 'Pedro Super', username: 'pedro', password: 'secreto123', confirmarPassword: 'secreto123' }

  it('body nulo o vacío → EMPRESA_SUPERADMIN_BODY_INVALIDO', () => {
    for (const body of [null, {}, undefined]) {
      const err = capturar(() => validarPayloadSuperadmin(body))
      assert.ok(err instanceof EmpresaPlatformError, 'debe ser EmpresaPlatformError')
      assert.strictEqual(err.code, 'EMPRESA_SUPERADMIN_BODY_INVALIDO')
    }
  })

  it('campos de identidad forjados (empresaId/sucursalId/rol/activo/id/passwordHash) → 400 prohibido', () => {
    for (const campo of ['id', 'empresaId', 'sucursalId', 'rol', 'activo', 'passwordHash']) {
      const err = capturar(() => validarPayloadSuperadmin({ ...valido, [campo]: 'cualquier-valor' }))
      assert.ok(err instanceof EmpresaPlatformError, `campo ${campo}`)
      assert.strictEqual(err.code, 'EMPRESA_SUPERADMIN_CAMPOS_PROHIBIDOS')
      assert.ok(err.campos.includes(campo), `debe reportar ${campo}`)
    }
  })

  it('campo desconocido → EMPRESA_SUPERADMIN_BODY_INVALIDO', () => {
    const err = capturar(() => validarPayloadSuperadmin({ ...valido, inventado: 'x' }))
    assert.strictEqual(err.code, 'EMPRESA_SUPERADMIN_BODY_INVALIDO')
    assert.ok(err.campos.includes('inventado'))
  })

  it('password corta (<6) → EMPRESA_SUPERADMIN_DATOS_INVALIDOS', () => {
    const err = capturar(() => validarPayloadSuperadmin({ ...valido, password: '12345', confirmarPassword: '12345' }))
    assert.strictEqual(err.code, 'EMPRESA_SUPERADMIN_DATOS_INVALIDOS')
    assert.ok(err.errores.some((e) => e.campo === 'password'))
  })

  it('confirmarPassword distinto → error de coincidencia', () => {
    const err = capturar(() => validarPayloadSuperadmin({ ...valido, confirmarPassword: 'otra' }))
    assert.strictEqual(err.code, 'EMPRESA_SUPERADMIN_DATOS_INVALIDOS')
    assert.ok(err.errores.some((e) => e.campo === 'confirmarPassword'))
  })

  it('nombre de 1 char → error de nombre', () => {
    const err = capturar(() => validarPayloadSuperadmin({ ...valido, nombre: 'A' }))
    assert.strictEqual(err.code, 'EMPRESA_SUPERADMIN_DATOS_INVALIDOS')
    assert.ok(err.errores.some((e) => e.campo === 'nombre'))
  })

  it('body válido → devuelve datos normalizados sin confirmarPassword ni extra', () => {
    const data = validarPayloadSuperadmin(valido)
    assert.deepStrictEqual(data, { nombre: 'Pedro Super', username: 'pedro', password: 'secreto123' })
  })

  it('username y nombre se recortan', () => {
    const data = validarPayloadSuperadmin({ ...valido, nombre: '  Pedro Super  ', username: '  pedro  ' })
    assert.strictEqual(data.nombre, 'Pedro Super')
    assert.strictEqual(data.username, 'pedro')
  })
})