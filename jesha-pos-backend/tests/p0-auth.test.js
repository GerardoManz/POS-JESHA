const { describe, it } = require('node:test')
const assert = require('node:assert')
const jwt = require('jsonwebtoken')
const { validarIdentidadFinalUsuario, IdentityError } = require('../src/security/identity')

describe('P0-PLATFORM-AUTH: identity validation in auth flow', () => {

  it('login builds JWT payload from identity-validated snapshot (SUPERADMIN)', () => {
    const usuario = { id: 1, nombre: 'Admin', username: 'admin', rol: 'SUPERADMIN', empresaId: 1, sucursalId: null, activo: true }
    const identidad = validarIdentidadFinalUsuario(usuario)
    const payload = { id: identidad.id, username: usuario.username, nombre: usuario.nombre, rol: identidad.rol, empresaId: identidad.empresaId, sucursalId: identidad.sucursalId }

    const token = jwt.sign(payload, 'test-secret', { expiresIn: '1h' })
    const decoded = jwt.verify(token, 'test-secret')

    assert.strictEqual(decoded.id, 1)
    assert.strictEqual(decoded.username, 'admin')
    assert.strictEqual(decoded.nombre, 'Admin')
    assert.strictEqual(decoded.rol, 'SUPERADMIN')
    assert.strictEqual(decoded.empresaId, 1)
    assert.strictEqual(decoded.sucursalId, null)
  })

  it('login builds JWT payload from identity-validated snapshot (PLATFORM_ADMIN)', () => {
    const usuario = { id: 5, nombre: 'God', username: 'god', rol: 'PLATFORM_ADMIN', empresaId: null, sucursalId: null, activo: true }
    const identidad = validarIdentidadFinalUsuario(usuario)
    const payload = { id: identidad.id, username: usuario.username, nombre: usuario.nombre, rol: identidad.rol, empresaId: identidad.empresaId, sucursalId: identidad.sucursalId }

    const token = jwt.sign(payload, 'test-secret', { expiresIn: '1h' })
    const decoded = jwt.verify(token, 'test-secret')

    assert.strictEqual(decoded.rol, 'PLATFORM_ADMIN')
    assert.strictEqual(decoded.empresaId, null)
    assert.strictEqual(decoded.sucursalId, null)
  })

  it('login builds JWT payload from identity-validated snapshot (EMPLEADO con sucursal)', () => {
    const usuario = { id: 10, nombre: 'Emp', username: 'emp', rol: 'EMPLEADO', empresaId: 2, sucursalId: 3, activo: true }
    const identidad = validarIdentidadFinalUsuario(usuario)
    const payload = { id: identidad.id, username: usuario.username, nombre: usuario.nombre, rol: identidad.rol, empresaId: identidad.empresaId, sucursalId: identidad.sucursalId }

    const token = jwt.sign(payload, 'test-secret', { expiresIn: '1h' })
    const decoded = jwt.verify(token, 'test-secret')

    assert.strictEqual(decoded.rol, 'EMPLEADO')
    assert.strictEqual(decoded.empresaId, 2)
    assert.strictEqual(decoded.sucursalId, 3)
  })

  it('login rejects PLATFORM_ADMIN with empresaId (identity validation)', () => {
    assert.throws(
      () => validarIdentidadFinalUsuario({ id: 1, nombre: 'Bad', username: 'bad', rol: 'PLATFORM_ADMIN', empresaId: 5, sucursalId: null, activo: true }),
      IdentityError
    )
  })

  it('login rejects EMPLEADO without sucursalId (identity validation)', () => {
    assert.throws(
      () => validarIdentidadFinalUsuario({ id: 1, nombre: 'Bad', username: 'bad', rol: 'EMPLEADO', empresaId: 1, sucursalId: null, activo: true }),
      IdentityError
    )
  })

  it('login rejects SUPERADMIN with sucursalId (identity validation)', () => {
    assert.throws(
      () => validarIdentidadFinalUsuario({ id: 1, nombre: 'Bad', username: 'bad', rol: 'SUPERADMIN', empresaId: 1, sucursalId: 5, activo: true }),
      IdentityError
    )
  })

  it('login rejects ADMIN_SUCURSAL without sucursalId (identity validation)', () => {
    assert.throws(
      () => validarIdentidadFinalUsuario({ id: 1, nombre: 'Bad', username: 'bad', rol: 'ADMIN_SUCURSAL', empresaId: 1, sucursalId: null, activo: true }),
      IdentityError
    )
  })

  it('login rejects unknown role (identity validation)', () => {
    assert.throws(
      () => validarIdentidadFinalUsuario({ id: 1, nombre: 'Bad', username: 'bad', rol: 'FAKE_ROLE', empresaId: null, sucursalId: null, activo: true }),
      IdentityError
    )
  })

  it('requireAuth validates identity from JWT payload — valid SUPERADMIN', () => {
    const payload = { id: 1, rol: 'SUPERADMIN', empresaId: 1, sucursalId: null }
    const result = validarIdentidadFinalUsuario({ ...payload, activo: true })
    assert.strictEqual(result.rol, 'SUPERADMIN')
    assert.strictEqual(result.empresaId, 1)
    assert.strictEqual(result.sucursalId, null)
  })

  it('requireAuth validates identity from JWT payload — valid ADMIN_SUCURSAL', () => {
    const payload = { id: 1, rol: 'ADMIN_SUCURSAL', empresaId: 1, sucursalId: 2 }
    const result = validarIdentidadFinalUsuario({ ...payload, activo: true })
    assert.strictEqual(result.rol, 'ADMIN_SUCURSAL')
    assert.strictEqual(result.empresaId, 1)
    assert.strictEqual(result.sucursalId, 2)
  })

  it('requireAuth rejects JWT with PLATFORM_ADMIN + empresaId (identity validation)', () => {
    assert.throws(
      () => validarIdentidadFinalUsuario({ id: 1, rol: 'PLATFORM_ADMIN', empresaId: 5, sucursalId: null, activo: true }),
      IdentityError
    )
  })

  it('requireAuth rejects JWT with EMPLEADO missing sucursalId (identity validation)', () => {
    assert.throws(
      () => validarIdentidadFinalUsuario({ id: 1, rol: 'EMPLEADO', empresaId: 1, sucursalId: null, activo: true }),
      IdentityError
    )
  })

  it('token payload exact shape matches system requirements', () => {
    const usuario = { id: 1, nombre: 'Admin', username: 'admin', rol: 'SUPERADMIN', empresaId: 1, sucursalId: null, activo: true }
    const identidad = validarIdentidadFinalUsuario(usuario)
    const payload = { id: identidad.id, username: usuario.username, nombre: usuario.nombre, rol: identidad.rol, empresaId: identidad.empresaId, sucursalId: identidad.sucursalId }

    assert.deepStrictEqual(Object.keys(payload).sort(), ['empresaId', 'id', 'nombre', 'rol', 'sucursalId', 'username'])
  })
})
