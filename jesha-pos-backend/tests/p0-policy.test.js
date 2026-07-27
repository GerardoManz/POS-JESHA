'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  validarEstadoUsuarioPorRol,
  normalizarIdPositivo
} = require('../src/utils/usuario-policy')

describe('normalizarIdPositivo', () => {
  it('entero positivo como number → ok', () => {
    assert.strictEqual(normalizarIdPositivo(42), 42)
  })

  it('string numérica positiva → ok', () => {
    assert.strictEqual(normalizarIdPositivo('42'), 42)
  })

  it('null sin permitirNull → lanza', () => {
    assert.throws(() => normalizarIdPositivo(null), { code: 'ID_INVALIDO' })
  })

  it('null con permitirNull → null', () => {
    assert.strictEqual(normalizarIdPositivo(null, { permitirNull: true }), null)
  })

  it('undefined → lanza', () => {
    assert.throws(() => normalizarIdPositivo(undefined), { code: 'ID_INVALIDO' })
  })

  it('0 → lanza', () => {
    assert.throws(() => normalizarIdPositivo(0), { code: 'ID_INVALIDO' })
  })

  it('-1 → lanza', () => {
    assert.throws(() => normalizarIdPositivo(-1), { code: 'ID_INVALIDO' })
  })

  it('decimal → lanza', () => {
    assert.throws(() => normalizarIdPositivo(1.5), { code: 'ID_INVALIDO' })
  })

  it('NaN → lanza', () => {
    assert.throws(() => normalizarIdPositivo(NaN), { code: 'ID_INVALIDO' })
  })

  it('Infinity → lanza', () => {
    assert.throws(() => normalizarIdPositivo(Infinity), { code: 'ID_INVALIDO' })
  })

  it('string vacía → lanza', () => {
    assert.throws(() => normalizarIdPositivo(''), { code: 'ID_INVALIDO' })
  })

  it('texto arbitrario → lanza', () => {
    assert.throws(() => normalizarIdPositivo('abc'), { code: 'ID_INVALIDO' })
  })

  it('string "0" → lanza', () => {
    assert.throws(() => normalizarIdPositivo('0'), { code: 'ID_INVALIDO' })
  })

  it('código personalizado', () => {
    assert.throws(
      () => normalizarIdPositivo(-5, { codigo: 'SUCURSAL_INVALIDA', mensaje: 'Sucursal inválida' }),
      { code: 'SUCURSAL_INVALIDA' }
    )
  })
})

describe('validarEstadoUsuarioPorRol', () => {
  it('ADMIN_SUCURSAL sin sucursal → SUCURSAL_REQUERIDA', () => {
    assert.throws(
      () => validarEstadoUsuarioPorRol({
        rol: 'ADMIN_SUCURSAL',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: null,
        sucursal: null
      }),
      { code: 'SUCURSAL_REQUERIDA' }
    )
  })

  it('ADMIN_SUCURSAL con sucursal válida → OK', () => {
    assert.strictEqual(
      validarEstadoUsuarioPorRol({
        rol: 'ADMIN_SUCURSAL',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: 1,
        sucursal: { id: 1, empresaId: 1, activa: true }
      }),
      true
    )
  })

  it('ADMIN_SUCURSAL con sucursal de otra empresa → SUCURSAL_NO_PERTENECE_A_EMPRESA', () => {
    assert.throws(
      () => validarEstadoUsuarioPorRol({
        rol: 'ADMIN_SUCURSAL',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: 2,
        sucursal: { id: 2, empresaId: 2, activa: true }
      }),
      { code: 'SUCURSAL_NO_PERTENECE_A_EMPRESA' }
    )
  })

  it('ADMIN_SUCURSAL con sucursal inactiva → SUCURSAL_INACTIVA', () => {
    assert.throws(
      () => validarEstadoUsuarioPorRol({
        rol: 'ADMIN_SUCURSAL',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: 1,
        sucursal: { id: 1, empresaId: 1, activa: false }
      }),
      { code: 'SUCURSAL_INACTIVA' }
    )
  })

  it('EMPLEADO sin sucursal → SUCURSAL_REQUERIDA', () => {
    assert.throws(
      () => validarEstadoUsuarioPorRol({
        rol: 'EMPLEADO',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: null,
        sucursal: null
      }),
      { code: 'SUCURSAL_REQUERIDA' }
    )
  })

  it('EMPLEADO con sucursal válida → OK', () => {
    assert.strictEqual(
      validarEstadoUsuarioPorRol({
        rol: 'EMPLEADO',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: 1,
        sucursal: { id: 1, empresaId: 1, activa: true }
      }),
      true
    )
  })

  it('SUPERADMIN con empresa activa y sucursal null → OK', () => {
    assert.strictEqual(
      validarEstadoUsuarioPorRol({
        rol: 'SUPERADMIN',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: null,
        sucursal: null
      }),
      true
    )
  })

  it('SUPERADMIN sin empresa → EMPRESA_REQUERIDA', () => {
    assert.throws(
      () => validarEstadoUsuarioPorRol({
        rol: 'SUPERADMIN',
        empresaId: null,
        empresa: null,
        sucursalId: null,
        sucursal: null
      }),
      { code: 'EMPRESA_REQUERIDA' }
    )
  })

  it('PRECIOS con empresa y sin sucursal → OK', () => {
    assert.strictEqual(
      validarEstadoUsuarioPorRol({
        rol: 'PRECIOS',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: null,
        sucursal: null
      }),
      true
    )
  })

  it('PRECIOS con sucursal válida → OK', () => {
    assert.strictEqual(
      validarEstadoUsuarioPorRol({
        rol: 'PRECIOS',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: 1,
        sucursal: { id: 1, empresaId: 1, activa: true }
      }),
      true
    )
  })

  it('PRECIOS con sucursal de otra empresa → error', () => {
    assert.throws(
      () => validarEstadoUsuarioPorRol({
        rol: 'PRECIOS',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: 2,
        sucursal: { id: 2, empresaId: 2, activa: true }
      }),
      { code: 'SUCURSAL_NO_PERTENECE_A_EMPRESA' }
    )
  })

  it('PLATFORM_ADMIN sin empresa/sucursal → OK (policy de dominio)', () => {
    assert.strictEqual(
      validarEstadoUsuarioPorRol({
        rol: 'PLATFORM_ADMIN',
        empresaId: null,
        empresa: null,
        sucursalId: null,
        sucursal: null
      }),
      true
    )
  })

  it('PLATFORM_ADMIN con empresa → EMPRESA_PROHIBIDA', () => {
    assert.throws(
      () => validarEstadoUsuarioPorRol({
        rol: 'PLATFORM_ADMIN',
        empresaId: 1,
        empresa: { id: 1, activa: true },
        sucursalId: null,
        sucursal: null
      }),
      { code: 'EMPRESA_PROHIBIDA' }
    )
  })

  it('Rol inválido → ROL_INVALIDO', () => {
    assert.throws(
      () => validarEstadoUsuarioPorRol({
        rol: 'INEXISTENTE',
        empresaId: null,
        empresa: null,
        sucursalId: null,
        sucursal: null
      }),
      { code: 'ROL_INVALIDO' }
    )
  })
})
