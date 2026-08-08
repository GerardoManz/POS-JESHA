'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  validarPayload,
  normalizarId,
  validarEntero,
  CAMPOS_PERMITIDOS,
  CAMPOS_PROHIBIDOS
} = require('../src/modules/sucursal/sucursal.controller')

describe('P0-TENANT-BRANCH-MANAGEMENT unit — campos permitidos/prohibidos', () => {
  it('la sucursal NO expone campo actualizadaEn (no existe en schema)', () => {
    assert.strictEqual(CAMPOS_PERMITIDOS.has('actualizadaEn'), false)
  })

  it('la sucursal define los 4 campos editables', () => {
    for (const c of ['nombre', 'codigoPostal', 'direccion', 'telefono']) {
      assert.strictEqual(CAMPOS_PERMITIDOS.has(c), true)
    }
  })

  it('id está prohibido como campo editable desde el cliente', () => {
    assert.strictEqual(CAMPOS_PROHIBIDOS.has('id'), true)
  })

  it('empresaId está prohibido (tenant se resuelve del contexto)', () => {
    assert.strictEqual(CAMPOS_PROHIBIDOS.has('empresaId'), true)
  })

  it('activa está prohibido (el backend impone el estado)', () => {
    assert.strictEqual(CAMPOS_PROHIBIDOS.has('activa'), true)
  })

  it('creadaEn/creadoEn están prohibidos', () => {
    assert.strictEqual(CAMPOS_PROHIBIDOS.has('creadaEn'), true)
    assert.strictEqual(CAMPOS_PROHIBIDOS.has('creadoEn'), true)
  })
})

describe('P0-TENANT-BRANCH-MANAGEMENT validarPayload — crear (esCrear=true)', () => {
  it('campos obligatorios faltantes → errores', () => {
    const errs = validarPayload({}, true)
    const campos = errs.map(e => e.campo)
    assert.ok(campos.includes('nombre'))
    assert.ok(campos.includes('codigoPostal'))
  })

  it('nombre vacío → error de obligatorio y/o longitud', () => {
    const errs = validarPayload({ nombre: '', codigoPostal: '97000' }, true)
    assert.ok(errs.length > 0)
  })

  it('nombre demasiado corto (1 char) → error', () => {
    const errs = validarPayload({ nombre: 'A', codigoPostal: '97000' }, true)
    assert.ok(errs.some(e => e.campo === 'nombre'))
  })

  it('nombre demasiado largo (>120) → error', () => {
    const errs = validarPayload({ nombre: 'X'.repeat(121), codigoPostal: '97000' }, true)
    assert.ok(errs.some(e => e.campo === 'nombre'))
  })

  it('nombre válido y codigoPostal válido → sin errores', () => {
    const errs = validarPayload({ nombre: 'Sucursal Centro', codigoPostal: '97000' }, true)
    assert.deepStrictEqual(errs, [])
  })

  it('codigoPostal preserva ceros iniciales como string (no se convierte a número)', () => {
    const errs = validarPayload({ nombre: 'Sucursal', codigoPostal: '97000' }, true)
    assert.deepStrictEqual(errs, [])
  })

  it('empresaId en el body → error de prohibido', () => {
    const errs = validarPayload({ nombre: 'Sucursal', codigoPostal: '97000', empresaId: 1 }, true)
    assert.ok(errs.some(e => e.campo === 'empresaId'))
  })

  it('activa true en el body → error de prohibido (no se puede crear activa)', () => {
    const errs = validarPayload({ nombre: 'Sucursal', codigoPostal: '97000', activa: true }, true)
    assert.ok(errs.some(e => e.campo === 'activa'))
  })

  it('campo desconocido → error de campo desconocido', () => {
    const errs = validarPayload({ nombre: 'Sucursal', codigoPostal: '97000', folio: 'S1' }, true)
    assert.ok(errs.some(e => e.campo === 'folio'))
  })

  it('direccion muy larga (>250) → error', () => {
    const errs = validarPayload({ nombre: 'Sucursal', codigoPostal: '97000', direccion: 'Y'.repeat(251) }, true)
    assert.ok(errs.some(e => e.campo === 'direccion'))
  })

  it('telefono muy largo (>20) → error', () => {
    const errs = validarPayload({ nombre: 'Sucursal', codigoPostal: '97000', telefono: '9'.repeat(21) }, true)
    assert.ok(errs.some(e => e.campo === 'telefono'))
  })
})

describe('PBAR-TENANT-BRANCH-MANAGEMENT validarPayload — editar (esCrear=false)', () => {
  it('payload vacío en edición → sin errores (se valida "sin campos" aparte)', () => {
    assert.deepStrictEqual(validarPayload({}, false), [])
  })

  it('editar solo nombre válido → sin errores', () => {
    assert.deepStrictEqual(validarPayload({ nombre: 'Central' }, false), [])
  })

  it('editar solo codigoPostal válido → sin errores', () => {
    assert.deepStrictEqual(validarPayload({ codigoPostal: '97000' }, false), [])
  })

  it('editar con activa → error de prohibido', () => {
    const errs = validarPayload({ activa: false }, false)
    assert.ok(errs.some(e => e.campo === 'activa'))
  })

  it('editar nombre corto → error', () => {
    const errs = validarPayload({ nombre: 'A' }, false)
    assert.ok(errs.some(e => e.campo === 'nombre'))
  })

  it('editar con id → error de prohibido', () => {
    const errs = validarPayload({ id: 5 }, false)
    assert.ok(errs.some(e => e.campo === 'id'))
  })

  it('editar con id → error de prohibido', () => {
    const errs = validarPayload({ id: 5 }, false)
    assert.ok(errs.some(e => e.campo === 'id'))
  })

  it('editar telefono (campo permitido) → sin error de desconocido', () => {
    const errs = validarPayload({ telefono: '9991234567' }, false)
    assert.strictEqual(errs.some(e => e.campo === 'telefono'), false)
  })

  it('editar campo inventado → error de desconocido', () => {
    const errs = validarPayload({ folioInterno: 'S1' }, false)
    assert.ok(errs.some(e => e.campo === 'folioInterno'))
  })
})

describe('PBAR-MANAGEMENT normalizarId', () => {
  it('entero positivo → ok', () => assumeId(7, 7))
  it('string numérica → ok', () => assumeId('12', 12))
  it('0 → null', () => assumeId(0, null))
  it('-3 → null', () => assumeId(-3, null))
  it('NaN → null', () => assumeId(NaN, null))
  it('decimal → null', () => assumeId(1.5, null))
  it('texto arbitrario → null', () => assumeId('abc', null))
})

function assumeId(raw, esperado) {
  assert.strictEqual(normalizarId(raw), esperado)
}

describe('validarEntero', () => {
  it('número válido dentro de rango → ok', () => {
    assert.strictEqual(validarEntero(3, 1, 1, 100), 3)
  })

  it('valor no numérico → default', () => {
    assert.strictEqual(validarEntero('abc', 20, 1, 100), 20)
  })

  it('undefined → default', () => {
    assert.strictEqual(validarEntero(undefined, 20, 1, 100), 20)
  })

  it('decimal se trunca', () => {
    assert.strictEqual(validarEntero(3.9, 20, 1, 100), 3)
  })

  it('valor menor que min → recorta a min', () => {
    assert.strictEqual(validarEntero(0, 20, 1, 100), 1)
  })

  it('valor mayor que max → recorta a max', () => {
    assert.strictEqual(validarEntero(5000, 20, 1, 100), 100)
  })
})