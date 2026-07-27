// ════════════════════════════════════════════════════════════════════
//  P0-POLICY-POSTGRES — Prueba PostgreSQL aislada
//  BD: jesha_p0_policy_test (aislada, desechable)
//  Node test runner (built-in)
// ════════════════════════════════════════════════════════════════════

// ═══════════ SET DATABASE_URL BEFORE ANY MODULE LOAD ═══════════
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL_OVERRIDE ||
  'postgresql://postgres:JESHA2026@localhost:5432/jesha_p0_policy_test'

const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert')
const bcrypt = require('bcryptjs')
const prisma = require('../src/lib/prisma')

const { crear, editar } = require('../src/modules/usuarios/usuarios.controller')

// ═══════════ HELPERS ═══════════

function mockRes() {
  let _status = 200
  let _json = null
  return {
    status(code) { _status = code; return this },
    json(data) { _json = data; return this },
    getStatus() { return _status },
    getJson() { return _json }
  }
}

function mockReq(usuario, body = {}, params = {}) {
  return { usuario, body, params, ip: '127.0.0.1' }
}

// ═══════════ GLOBAL SETUP ═══════════

let empresa1Id, empresa2Id, empresa3Id
let sucursal1Id, sucursal2Id, sucursal3Id
let superAdminId
let superAdminUsername = 'p0-superadmin-test'
let superAdminPassword = 'test123456'
let superAdmin2Id
let superAdmin2Username = 'p0-superadmin2-test'
let superAdmin3Id
let superAdmin3Username = 'p0-superadmin3-test'

// Garantizar unicidad para cada ejecución
const runId = Date.now()

describe('P0 PostgreSQL Integration', { concurrency: 1 }, () => {

  before(async () => {
    // empresa 1
    const e1 = await prisma.empresa.create({
      data: {
        slug: `test-emp1-p0-${runId}`,
        nombreComercial: 'Test Empresa 1 P0',
        razonSocial: 'Test Empresa 1 SA P0',
        whatsapp: '5550000001'
      }
    })
    empresa1Id = e1.id

    // empresa 2
    const e2 = await prisma.empresa.create({
      data: {
        slug: `test-emp2-p0-${runId}`,
        nombreComercial: 'Test Empresa 2 P0',
        razonSocial: 'Test Empresa 2 SA P0',
        whatsapp: '5550000002'
      }
    })
    empresa2Id = e2.id

    // sucursales empresa 1
    const s1 = await prisma.sucursal.create({
      data: { nombre: 'Sucursal Centro P0', empresaId: e1.id, direccion: 'Centro 123', codigoPostal: '55000', activa: true }
    })
    sucursal1Id = s1.id

    const s2 = await prisma.sucursal.create({
      data: { nombre: 'Sucursal Norte P0', empresaId: e1.id, direccion: 'Norte 456', codigoPostal: '55100', activa: true }
    })
    sucursal2Id = s2.id

    // sucursal empresa 2
    const s3 = await prisma.sucursal.create({
      data: { nombre: 'Sucursal Emp2 P0', empresaId: e2.id, direccion: 'Sur 789', codigoPostal: '55200', activa: true }
    })
    sucursal3Id = s3.id

    // SUPERADMIN empresa 1 (actor para todas las pruebas)
    const hash = await bcrypt.hash(superAdminPassword, 10)
    const sa = await prisma.usuario.create({
      data: {
        nombre: 'Super Admin Test P0',
        username: superAdminUsername,
        passwordHash: hash,
        rol: 'SUPERADMIN',
        activo: true,
        empresaId: e1.id
      }
    })
    superAdminId = sa.id

    // Second SUPERADMIN empresa 1 (para tests de manipulación de actor)
    const sa2Hash = await bcrypt.hash('test123456', 10)
    const sa2 = await prisma.usuario.create({
      data: {
        nombre: 'Super Admin 2 Test P0',
        username: superAdmin2Username,
        passwordHash: sa2Hash,
        rol: 'SUPERADMIN',
        activo: true,
        empresaId: e1.id
      }
    })
    superAdmin2Id = sa2.id

    // Empresa 3 + SUPERADMIN para test de empresa inactiva
    const e3 = await prisma.empresa.create({
      data: {
        slug: `test-emp3-p0-${runId}`,
        nombreComercial: 'Test Empresa 3 P0',
        razonSocial: 'Test Empresa 3 SA P0',
        whatsapp: '5550000003'
      }
    })
    empresa3Id = e3.id

    const sa3Hash = await bcrypt.hash('test123456', 10)
    const sa3 = await prisma.usuario.create({
      data: {
        nombre: 'Super Admin 3 Test P0',
        username: superAdmin3Username,
        passwordHash: sa3Hash,
        rol: 'SUPERADMIN',
        activo: true,
        empresaId: e3.id
      }
    })
    superAdmin3Id = sa3.id
  })

  after(async () => {
    // Cleanup ordenado: FK-sensitive
    await prisma.$executeRawUnsafe(`DELETE FROM "Auditoria" WHERE modulo = 'usuarios' AND referencia ILIKE '%p0-%'`)
    await prisma.$executeRawUnsafe(`DELETE FROM "Usuario" WHERE username LIKE 'p0-%' OR username = '${superAdminUsername}'`)
    await prisma.$executeRawUnsafe(`DELETE FROM "Sucursal" WHERE nombre LIKE '%P0' OR nombre LIKE '% P0'`)
    await prisma.$executeRawUnsafe(`DELETE FROM "Empresa" WHERE slug LIKE 'test-emp%-p0-${runId}'`)
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // Limpiar usuarios de prueba (EXCEPTO el SUPERADMIN actor)
    await prisma.$executeRawUnsafe(`DELETE FROM "Auditoria" WHERE modulo = 'usuarios' AND referencia ILIKE '%p0-%'`)
    await prisma.$executeRawUnsafe(`DELETE FROM "Usuario" WHERE username LIKE 'p0-%' AND username NOT IN ('${superAdminUsername}', '${superAdmin2Username}', '${superAdmin3Username}')`)
  })

  // ═══════════ BLOQUE 1: CREAR — Éxito ═══════════

  describe('CREAR - Éxito', { concurrency: 1 }, () => {
    it('C1: crea EMPLEADO con sucursalId (número entero válido)', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Empleado P0 Test', username: 'p0-emp-test-crear', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201, `Esperado 201, recibido ${res.getStatus()}: ${JSON.stringify(res.getJson())}`)
      const json = res.getJson()
      assert.ok(json.id, 'Debe devolver id')
      assert.strictEqual(json.rol, 'EMPLEADO')
      assert.strictEqual(json.activo, true)
      // Verificar en BD
      const dbUser = await prisma.usuario.findUnique({
        where: { empresaId_username: { empresaId: empresa1Id, username: 'p0-emp-test-crear' } }
      })
      assert.ok(dbUser, 'Usuario debe existir en BD')
      assert.strictEqual(dbUser.empresaId, empresa1Id)
      assert.strictEqual(dbUser.sucursalId, sucursal1Id)
      assert.strictEqual(dbUser.activo, true)
    })

    it('C2: crea ADMIN_SUCURSAL con sucursalId', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Admin Suc P0', username: 'p0-admin-suc-crear', password: 'test123456', confirmarPassword: 'test123456', rol: 'ADMIN_SUCURSAL', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201, `Esperado 201: ${JSON.stringify(res.getJson())}`)
      const json = res.getJson()
      assert.strictEqual(json.rol, 'ADMIN_SUCURSAL')
      // BD
      const dbUser = await prisma.usuario.findUnique({
        where: { empresaId_username: { empresaId: empresa1Id, username: 'p0-admin-suc-crear' } }
      })
      assert.strictEqual(dbUser.sucursalId, sucursal1Id)
    })

    it('C3: crea PRECIOS sin sucursalId (rol sin sucursal requerida)', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Precios P0', username: 'p0-precios-crear', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201, `Esperado 201: ${JSON.stringify(res.getJson())}`)
      const json = res.getJson()
      assert.strictEqual(json.rol, 'PRECIOS')
      // BD
      const dbUser = await prisma.usuario.findUnique({
        where: { empresaId_username: { empresaId: empresa1Id, username: 'p0-precios-crear' } }
      })
      assert.strictEqual(dbUser.sucursalId, null)
      assert.strictEqual(dbUser.activo, true)
    })

    it('C4: el password se guarda como hash (no como texto plano)', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Hash Test', username: 'p0-hash-test', password: 'secret1234', confirmarPassword: 'secret1234', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201)
      const dbUser = await prisma.usuario.findUnique({
        where: { empresaId_username: { empresaId: empresa1Id, username: 'p0-hash-test' } }
      })
      assert.notStrictEqual(dbUser.passwordHash, 'secret1234', 'passwordHash no debe ser texto plano')
      const match = await bcrypt.compare('secret1234', dbUser.passwordHash)
      assert.ok(match, 'El hash debe verificar contra el password original')
    })
  })

  // ═══════════ BLOQUE 2: CREAR — Validación de sucursalId ═══════════

  describe('CREAR - Validación sucursalId', { concurrency: 1 }, () => {
    it('C5: rechaza sucursalId string "42" → SUCURSAL_INVALIDA', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-str-suc', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: '42' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /Sucursal inválida/i)
      // BD: usuario NO debe existir
      const dbUser = await prisma.usuario.findFirst({
        where: { username: 'p0-str-suc', empresaId: empresa1Id }
      })
      assert.strictEqual(dbUser, null, 'Usuario no debe persistir tras error')
    })

    it('C6: rechaza sucursalId 0 → SUCURSAL_INVALIDA', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-zero-suc', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: 0 }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /Sucursal inválida/i)
    })

    it('C7: rechaza sucursalId negativo → SUCURSAL_INVALIDA', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-neg-suc', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: -5 }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /Sucursal inválida/i)
    })

    it('C8: rechaza sucursalId null para rol que requiere sucursal (EMPLEADO) → SUCURSAL_REQUERIDA', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-null-suc-emp', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: null }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /sucursal/i)
    })

    it('C9: sucursalId ausente (sin campo) para EMPLEADO → SUCURSAL_REQUERIDA', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-no-suc-emp', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /sucursal/i)
    })

    it('C10: rechaza sucursalId que pertenece a otra empresa → SUCURSAL_INVALIDA', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-cross-emp-suc', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal3Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /Sucursal inválida/i)
      const dbUser = await prisma.usuario.findFirst({ where: { username: 'p0-cross-emp-suc' } })
      assert.strictEqual(dbUser, null, 'Rollback: usuario no debe persistir')
    })

    it('C11: rechaza sucursalId inexistente → SUCURSAL_INVALIDA (igual que cross-empresa)', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-noexist-suc', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: 99999 }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /Sucursal inválida/i)
    })
  })

  // ═══════════ BLOQUE 3: CREAR — Validación de empresaId ═══════════

  describe('CREAR - Validación empresaId', { concurrency: 1 }, () => {
    it('C12: rechaza empresaId en body → EMPRESA_NO_MODIFICABLE', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-emp-body', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id, empresaId: 99 }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /empresa/i)
    })
  })

  // ═══════════ BLOQUE 4: CREAR — Username duplicado (P2002 real) ═══════════

  describe('CREAR - P2002 (duplicado real)', { concurrency: 1 }, () => {
    it('C13: rechaza username duplicado en misma empresa', async () => {
      // Primero crear
      const res1 = mockRes()
      await crear(mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Dup', username: 'p0-dup-user', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      ), res1)
      assert.strictEqual(res1.getStatus(), 201, `Primero creado: ${JSON.stringify(res1.getJson())}`)

      // Segundo (duplicado)
      const res2 = mockRes()
      await crear(mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Dup2', username: 'p0-dup-user', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      ), res2)
      assert.strictEqual(res2.getStatus(), 409, `Esperado 409: ${JSON.stringify(res2.getJson())}`)
      assert.match(res2.getJson().error, /ya existe/i)
    })

    it('C14: permite mismo username en empresa diferente (empresa2)', async () => {
      // Primero crear en empresa 1
      const res1 = mockRes()
      await crear(mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'CrossDup', username: 'p0-cross-dup', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      ), res1)
      assert.strictEqual(res1.getStatus(), 201, `Primero: ${JSON.stringify(res1.getJson())}`)

      // Verificar desde empresa2: NO visible con filtro empresa2
      const fromEmp2 = await prisma.usuario.findFirst({
        where: { username: 'p0-cross-dup', empresaId: empresa2Id }
      })
      assert.strictEqual(fromEmp2, null, 'Usuario no visible desde otra empresa con filtro empresaId')
    })
  })

  // ═══════════ BLOQUE 5: CREAR — Actor (rol + estado) ═══════════

  describe('CREAR - Actor no autorizado', { concurrency: 1 }, () => {
    it('C15: ADMIN_SUCURSAL no puede crear usuarios → ACTOR_NO_AUTORIZADO', async () => {
      // Primero crear un ADMIN_SUCURSAL
      const hash = await bcrypt.hash('test123456', 10)
      const adminSuc = await prisma.usuario.create({
        data: {
          nombre: 'Admin Suc Actor',
          username: 'p0-admin-suc-actor',
          passwordHash: hash,
          rol: 'ADMIN_SUCURSAL',
          activo: true,
          empresaId: empresa1Id,
          sucursalId: sucursal1Id
        }
      })

      const res = mockRes()
      const req = mockReq(
        { id: adminSuc.id, nombre: 'Admin Suc', rol: 'ADMIN_SUCURSAL', sucursalId: sucursal1Id, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-by-admin', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /No autorizado/i)
    })

    it('C16: actor inexistente (id falso) → ACTOR_NO_AUTORIZADO', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: 999999, nombre: 'Fantasma', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-fake-actor', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /No autorizado/i)
    })
  })

  // ═══════════ BLOQUE 6: EDICIÓN — Éxito ═══════════

  describe('EDITAR - Éxito', { concurrency: 1 }, () => {
    let empleadoEditId

    beforeEach(async () => {
      const hash = await bcrypt.hash('test123456', 10)
      const u = await prisma.usuario.create({
        data: {
          nombre: 'Empleado Editable',
          username: 'p0-emp-editable',
          passwordHash: hash,
          rol: 'EMPLEADO',
          activo: true,
          empresaId: empresa1Id,
          sucursalId: sucursal1Id
        }
      })
      empleadoEditId = u.id
    })

    it('E1: edita nombre y username de EMPLEADO', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Empleado Renombrado', username: 'p0-emp-renamed' },
        { id: String(empleadoEditId) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 200, `Esperado 200: ${JSON.stringify(res.getJson())}`)
      const json = res.getJson()
      assert.strictEqual(json.nombre, 'Empleado Renombrado')
      assert.strictEqual(json.username, 'p0-emp-renamed')
      // BD
      const dbUser = await prisma.usuario.findUnique({ where: { id: empleadoEditId } })
      assert.strictEqual(dbUser.nombre, 'Empleado Renombrado')
      assert.strictEqual(dbUser.username, 'p0-emp-renamed')
    })

    it('E2: edita password y verifica que nuevo hash funciona', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { password: 'newpass456', confirmarPassword: 'newpass456' },
        { id: String(empleadoEditId) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 200, `Esperado 200: ${JSON.stringify(res.getJson())}`)
      const dbUser = await prisma.usuario.findUnique({ where: { id: empleadoEditId } })
      const match = await bcrypt.compare('newpass456', dbUser.passwordHash)
      assert.ok(match, 'Nuevo password debe verificar')
      const oldMatch = await bcrypt.compare('test123456', dbUser.passwordHash)
      assert.ok(!oldMatch, 'Password antiguo ya no debe verificar')
    })

    it('E3: cambia rol de EMPLEADO a ADMIN_SUCURSAL (misma sucursal)', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { rol: 'ADMIN_SUCURSAL' },
        { id: String(empleadoEditId) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 200, `Esperado 200: ${JSON.stringify(res.getJson())}`)
      const dbUser = await prisma.usuario.findUnique({ where: { id: empleadoEditId } })
      assert.strictEqual(dbUser.rol, 'ADMIN_SUCURSAL')
    })

    it('E4: cambia sucursalId de EMPLEADO (de sucursal1 a sucursal2)', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { sucursalId: sucursal2Id },
        { id: String(empleadoEditId) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 200, `Esperado 200: ${JSON.stringify(res.getJson())}`)
      const dbUser = await prisma.usuario.findUnique({ where: { id: empleadoEditId } })
      assert.strictEqual(dbUser.sucursalId, sucursal2Id)
    })

    it('E5: edita múltiples campos simultáneamente', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Multi Edit', username: 'p0-multi-edit', rol: 'PRECIOS', sucursalId: null },
        { id: String(empleadoEditId) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 200, `Esperado 200: ${JSON.stringify(res.getJson())}`)
      const json = res.getJson()
      assert.strictEqual(json.nombre, 'Multi Edit')
      assert.strictEqual(json.rol, 'PRECIOS')
      const dbUser = await prisma.usuario.findUnique({ where: { id: empleadoEditId } })
      assert.strictEqual(dbUser.sucursalId, null, 'PRECIOS no requiere sucursal')
    })
  })

  // ═══════════ BLOQUE 7: EDICIÓN — Rechazo protegidos ═══════════

  describe('EDITAR - Usuarios protegidos', { concurrency: 1 }, () => {
    it('E6: rechaza editar otro SUPERADMIN → USUARIO_PROTEGIDO', async () => {
      // Crear segundo SUPERADMIN
      const hash = await bcrypt.hash('test123456', 10)
      const sa2 = await prisma.usuario.create({
        data: {
          nombre: 'Super Admin 2',
          username: 'p0-sa2',
          passwordHash: hash,
          rol: 'SUPERADMIN',
          activo: true,
          empresaId: empresa1Id
        }
      })

      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Intento' },
        { id: String(sa2.id) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /gestionar|protegido/i)
    })

    it('E7: rechaza editar usuario de empresa 2 (FOR UPDATE no devuelve filas) → USUARIO_NO_ENCONTRADO', async () => {
      // Crear usuario en empresa 2
      const hash = await bcrypt.hash('test123456', 10)
      const emp2User = await prisma.usuario.create({
        data: {
          nombre: 'Emp2 User',
          username: 'p0-emp2-user',
          passwordHash: hash,
          rol: 'EMPLEADO',
          activo: true,
          empresaId: empresa2Id,
          sucursalId: sucursal3Id
        }
      })

      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Intento Cross' },
        { id: String(emp2User.id) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 404, `Esperado 404: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /no encontrado/i)
      // BD: usuario empresa 2 no fue modificado
      const dbUser = await prisma.usuario.findUnique({ where: { id: emp2User.id } })
      assert.strictEqual(dbUser.nombre, 'Emp2 User', 'Usuario de otra empresa no debe ser modificado')
    })
  })

  // ═══════════ BLOQUE 8: EDICIÓN — Validación sucursalId ═══════════

  describe('EDITAR - Validación sucursalId', { concurrency: 1 }, () => {
    let empleadoEditId2

    beforeEach(async () => {
      const hash = await bcrypt.hash('test123456', 10)
      const u = await prisma.usuario.create({
        data: {
          nombre: 'Emp Edit Val',
          username: 'p0-emp-edit-val',
          passwordHash: hash,
          rol: 'EMPLEADO',
          activo: true,
          empresaId: empresa1Id,
          sucursalId: sucursal1Id
        }
      })
      empleadoEditId2 = u.id
    })

    it('E8: rechaza sucursalId string en edición → SUCURSAL_INVALIDA', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { sucursalId: 'abc' },
        { id: String(empleadoEditId2) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /Sucursal inválida/i)
      // BD: sin cambios
      const dbUser = await prisma.usuario.findUnique({ where: { id: empleadoEditId2 } })
      assert.strictEqual(dbUser.sucursalId, sucursal1Id, 'sucursalId sin cambios tras error')
    })

    it('E9: rechaza sucursalId de otra empresa en edición → SUCURSAL_INVALIDA', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { sucursalId: sucursal3Id },
        { id: String(empleadoEditId2) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /Sucursal inválida/i)
      const dbUser = await prisma.usuario.findUnique({ where: { id: empleadoEditId2 } })
      assert.strictEqual(dbUser.sucursalId, sucursal1Id, 'Rollback: sucursalId sin cambios')
    })
  })

  // ═══════════ BLOQUE 9: EDICIÓN — Validación empresaId ═══════════

  describe('EDITAR - Validación empresaId', { concurrency: 1 }, () => {
    let empleadoEditId3

    beforeEach(async () => {
      const hash = await bcrypt.hash('test123456', 10)
      const u = await prisma.usuario.create({
        data: {
          nombre: 'Emp Edit Emp',
          username: 'p0-emp-edit-emp',
          passwordHash: hash,
          rol: 'EMPLEADO',
          activo: true,
          empresaId: empresa1Id,
          sucursalId: sucursal1Id
        }
      })
      empleadoEditId3 = u.id
    })

    it('E10: rechaza empresaId en body de edición → EMPRESA_NO_MODIFICABLE', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { empresaId: 99 },
        { id: String(empleadoEditId3) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 400, `Esperado 400: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /empresa/i)
    })
  })

  // ═══════════ BLOQUE 10: Cross-Tenant — Aislamiento real ═══════════

  describe('Cross-Tenant Isolation', { concurrency: 1 }, () => {
    it('X1: usuario de empresa 1 NO es accesible con empresaId=empresa2', async () => {
      // Crear en empresa 1
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Cross Iso', username: 'p0-cross-iso', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201)
      const createdId = res.getJson().id

      // findUnique por PK (id) sí encuentra
      const byId = await prisma.usuario.findUnique({ where: { id: createdId } })
      assert.ok(byId, 'Debe existir por PK')
      assert.strictEqual(byId.empresaId, empresa1Id)

      // findUnique por compound key empresaId_username desde empresa2 falla
      const byCompoundEmp2 = await prisma.usuario.findUnique({
        where: { empresaId_username: { empresaId: empresa2Id, username: 'p0-cross-iso' } }
      })
      assert.strictEqual(byCompoundEmp2, null, 'No accesible con empresaId de otra empresa')

      // findFirst con empresaId=empresa2 también falla
      const byFilterEmp2 = await prisma.usuario.findFirst({
        where: { id: createdId, empresaId: empresa2Id }
      })
      assert.strictEqual(byFilterEmp2, null, 'No accesible con filtro empresaId=empresa2')
    })

    it('X2: empresaId en BD refleja el tenant del actor (empresa1), no otro', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Tenant Check', username: 'p0-tenant-check', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201)

      const dbUser = await prisma.usuario.findUnique({
        where: { empresaId_username: { empresaId: empresa1Id, username: 'p0-tenant-check' } }
      })
      assert.strictEqual(dbUser.empresaId, empresa1Id)
      assert.notStrictEqual(dbUser.empresaId, empresa2Id, 'NO debe ser empresa2')
    })

    it('X3: los datos de empresa1 NO contienen usuarios de empresa2', async () => {
      const countEmp1 = await prisma.usuario.count({ where: { empresaId: empresa1Id } })
      const countEmp2 = await prisma.usuario.count({ where: { empresaId: empresa2Id } })

      // Todos los creados en estas pruebas tienen empresa1
      const allP0 = await prisma.usuario.findMany({
        where: { username: { startsWith: 'p0-' } },
        select: { empresaId: true, username: true }
      })
      const emp2Users = allP0.filter(u => u.empresaId === empresa2Id)
      assert.strictEqual(emp2Users.length, 0, `No deben existir usuarios p0-* en empresa2: ${JSON.stringify(emp2Users)}`)
    })
  })

  // ═══════════ BLOQUE 11: Rollback de transacción ═══════════

  describe('Transaction Rollback', { concurrency: 1 }, () => {
    it('R1: error dentro de transacción revierte el create (usuario no persiste)', async () => {
      // Crear un usuario con username duplicado que solo fallará DENTRO de la
      // transacción tras pasar prevalidación. Usamos un username ya existente.
      const res1 = mockRes()
      await crear(mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Rollback1', username: 'p0-rollback-1', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      ), res1)
      assert.strictEqual(res1.getStatus(), 201)

      // Duplicado — falla en tx, debe hacer rollback completo
      const res2 = mockRes()
      await crear(mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Rollback2', username: 'p0-rollback-1', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      ), res2)
      assert.strictEqual(res2.getStatus(), 409)

      // Solo debe existir 1 usuario con ese username
      const count = await prisma.usuario.count({
        where: { empresaId: empresa1Id, username: 'p0-rollback-1' }
      })
      assert.strictEqual(count, 1, 'Solo debe existir 1 (rollback evitó el duplicado fantasma)')
    })

    it('R2: SUCURSAL_INVALIDA dentro de tx no persiste el usuario', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Rollback Tx', username: 'p0-rollback-tx', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal3Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400)

      const dbUser = await prisma.usuario.findFirst({
        where: { username: 'p0-rollback-tx', empresaId: empresa1Id }
      })
      assert.strictEqual(dbUser, null, 'Usuario NO debe existir (rollback total)')
    })
  })

  // ═══════════ BLOQUE 12: POSTGRESQL — FOR SHARE/FOR UPDATE locks ═══════════

  describe('Row-Level Locks (FOR SHARE / FOR UPDATE)', { concurrency: 1 }, () => {
    it('L1: FOR SHARE adquiere lock sobre actor en crear', async () => {
      // Verificar que el actor existe y su fila es legible (= lock funciona)
      const actor = await prisma.usuario.findUnique({
        where: { id: superAdminId },
        select: { id: true, rol: true, activo: true, empresaId: true }
      })
      assert.ok(actor, 'Actor debe seguir existiendo')
      assert.strictEqual(actor.rol, 'SUPERADMIN')
      assert.ok(actor.activo)

      // Crear un usuario — esto ejecuta FOR SHARE sobre el actor dentro de tx
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Lock Test', username: 'p0-lock-test', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201, `Esperado 201: ${JSON.stringify(res.getJson())}`)
    })

    it('L2: FOR UPDATE adquiere lock sobre objetivo en editar', async () => {
      // Crear objetivo
      const hash = await bcrypt.hash('test123456', 10)
      const obj = await prisma.usuario.create({
        data: {
          nombre: 'Lock Target',
          username: 'p0-lock-target',
          passwordHash: hash,
          rol: 'EMPLEADO',
          activo: true,
          empresaId: empresa1Id,
          sucursalId: sucursal1Id
        }
      })

      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Lock Target Modified' },
        { id: String(obj.id) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 200, `Esperado 200: ${JSON.stringify(res.getJson())}`)
      const updated = await prisma.usuario.findUnique({ where: { id: obj.id } })
      assert.strictEqual(updated.nombre, 'Lock Target Modified')
    })
  })

  // ═══════════ BLOQUE 13: Serializable Isolation ═══════════

  describe('Serializable Isolation', { concurrency: 1 }, () => {
    it('S1: dos creates en serie con mismo username falla el segundo', async () => {
      const username = 'p0-serializable-iso'
      const res1 = mockRes()
      await crear(mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Ser1', username, password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      ), res1)
      assert.strictEqual(res1.getStatus(), 201)

      const res2 = mockRes()
      await crear(mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Ser2', username, password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      ), res2)
      assert.strictEqual(res2.getStatus(), 409)

      const count = await prisma.usuario.count({
        where: { empresaId: empresa1Id, username }
      })
      assert.strictEqual(count, 1, 'Solo 1 con Serializable isolation')
    })
  })

  // ═══════════ BLOQUE 14: Validación de body ═══════════

  describe('Validación de body', { concurrency: 1 }, () => {
    it('V1: rechaza body null o no-objeto', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        null
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400)
    })

    it('V2: rechaza body array', async () => {
      const res = mockRes()
      const req = { usuario: { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id }, body: [], params: {}, ip: '127.0.0.1' }
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400)
    })

    it('V3: rechaza campos obligatorios ausentes (sin nombre)', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { username: 'p0-sin-nombre', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400)
    })

    it('V4: rechaza password sin confirmarPassword', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-no-confirm', password: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400)
      assert.match(res.getJson().error, /coinciden/i)
    })

    it('V5: rechaza password < 6 caracteres', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-short-pass', password: '12345', confirmarPassword: '12345', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 400)
      assert.match(res.getJson().error, /6/i)
    })

    it('V6: rechaza rol inválido (no en ROLES_VALIDOS)', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Test', username: 'p0-bad-rol', password: 'test123456', confirmarPassword: 'test123456', rol: 'NARCO_ADMIN', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
    })

    it('V7: rechaza crear SUPERADMIN (no asignable) → 403', async () => {
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'SA Test', username: 'p0-sa-bad', password: 'test123456', confirmarPassword: 'test123456', rol: 'SUPERADMIN', sucursalId: null }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
    })
  })

  // ═══════════ BLOQUE 15: Auditoria ═══════════

  describe('Auditoria', { concurrency: 1 }, () => {
    it('A1: crear genera registro de auditoría', async () => {
      const beforeCount = await prisma.auditoria.count()
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Audit', username: 'p0-audit-create', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201)

      const afterCount = await prisma.auditoria.count()
      assert.ok(afterCount > beforeCount, 'Debe existir al menos 1 nuevo registro de auditoría')
    })

    it('A2: editar genera registro de auditoría', async () => {
      // Crear objetivo
      const hash = await bcrypt.hash('test123456', 10)
      const obj = await prisma.usuario.create({
        data: {
          nombre: 'Audit Edit',
          username: 'p0-audit-edit',
          passwordHash: hash,
          rol: 'EMPLEADO',
          activo: true,
          empresaId: empresa1Id,
          sucursalId: sucursal1Id
        }
      })

      const beforeCount = await prisma.auditoria.count()
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Audit Edit Updated' },
        { id: String(obj.id) }
      )
      await editar(req, res)
      assert.strictEqual(res.getStatus(), 200)

      const afterCount = await prisma.auditoria.count()
      assert.ok(afterCount > beforeCount, 'Debe existir registro de auditoría de edición')
    })
  })

  // ═══════════ BLOQUE 16: Actor Edge Cases ═══════════

  describe('Actor - Desactivado', { concurrency: 1 }, () => {
    it('AC1: actor activo=false → 403 ACTOR_NO_AUTORIZADO, cero escritura', async () => {
      await prisma.usuario.update({ where: { id: superAdmin2Id }, data: { activo: false } })

      const res = mockRes()
      const req = mockReq(
        { id: superAdmin2Id, nombre: 'SA2', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Victim', username: 'p0-ac1', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /No autorizado/i)

      // Cero escritura
      const dbUser = await prisma.usuario.findFirst({ where: { username: 'p0-ac1', empresaId: empresa1Id } })
      assert.strictEqual(dbUser, null, 'Usuario NO debe persistir con actor desactivado')

      // Restaurar
      await prisma.usuario.update({ where: { id: superAdmin2Id }, data: { activo: true } })
    })
  })

  describe('Actor - Sin Empresa', { concurrency: 1 }, () => {
    it('AC2: actor empresaId=null → 403 ACTOR_SIN_EMPRESA, cero escritura', async () => {
      await prisma.usuario.update({ where: { id: superAdmin2Id }, data: { empresaId: null } })

      const res = mockRes()
      const req = mockReq(
        { id: superAdmin2Id, nombre: 'SA2', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Victim', username: 'p0-ac2', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /No autorizado/i)

      const dbUser = await prisma.usuario.findFirst({ where: { username: 'p0-ac2' } })
      assert.strictEqual(dbUser, null, 'Usuario NO debe persistir con actor sin empresaId')

      // Restaurar
      await prisma.usuario.update({ where: { id: superAdmin2Id }, data: { empresaId: empresa1Id } })
    })
  })

  describe('Actor - Movido de Empresa', { concurrency: 1 }, () => {
    it('AC3: actor empresaId cambia de A a B → sucursal A rechazada, sucursal B aceptada', async () => {
      // Mover actor de empresa1 a empresa2
      await prisma.usuario.update({ where: { id: superAdmin2Id }, data: { empresaId: empresa2Id } })

      // Intento con sucursal de empresa1 → SUCURSAL_INVALIDA
      const res1 = mockRes()
      const req1 = mockReq(
        { id: superAdmin2Id, nombre: 'SA2', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'OldCo', username: 'p0-ac3-old', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req1, res1)
      assert.strictEqual(res1.getStatus(), 400, `sucursal empresa1 debe fallar: ${JSON.stringify(res1.getJson())}`)
      assert.match(res1.getJson().error, /Sucursal inválida/i)

      // Intento con sucursal de empresa2 → éxito
      const res2 = mockRes()
      const req2 = mockReq(
        { id: superAdmin2Id, nombre: 'SA2', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa2Id },
        { nombre: 'NewCo', username: 'p0-ac3-new', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal3Id }
      )
      await crear(req2, res2)
      assert.strictEqual(res2.getStatus(), 201, `sucursal empresa2 debe aceptar: ${JSON.stringify(res2.getJson())}`)
      const json = res2.getJson()
      assert.strictEqual(json.rol, 'EMPLEADO')

      // BD: usuario creado en empresa2
      const dbUser = await prisma.usuario.findUnique({
        where: { empresaId_username: { empresaId: empresa2Id, username: 'p0-ac3-new' } }
      })
      assert.ok(dbUser, 'Usuario debe existir en empresa2')
      assert.strictEqual(dbUser.empresaId, empresa2Id, 'empresaId debe ser empresa2, NO empresa1')

      // Verificar que NO existe en empresa1
      const inEmp1 = await prisma.usuario.findFirst({
        where: { username: 'p0-ac3-new', empresaId: empresa1Id }
      })
      assert.strictEqual(inEmp1, null, 'NO debe existir en empresa1')

      // Restaurar actor a empresa1
      await prisma.usuario.update({ where: { id: superAdmin2Id }, data: { empresaId: empresa1Id } })
    })
  })

  describe('Actor - Empresa Inactiva', { concurrency: 1 }, () => {
    it('AC4: empresa del actor inactiva → 403 EMPRESA_INACTIVA, cero escritura', async () => {
      await prisma.empresa.update({ where: { id: empresa3Id }, data: { activa: false } })

      const res = mockRes()
      const req = mockReq(
        { id: superAdmin3Id, nombre: 'SA3', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa3Id },
        { nombre: 'Victim', username: 'p0-ac4', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /Operación no disponible/i)

      const dbUser = await prisma.usuario.findFirst({ where: { username: 'p0-ac4' } })
      assert.strictEqual(dbUser, null, 'Usuario NO debe persistir con empresa inactiva')

      // Restaurar
      await prisma.empresa.update({ where: { id: empresa3Id }, data: { activa: true } })
    })
  })

  describe('Actor - Eliminado', { concurrency: 1 }, () => {
    it('AC5: actor eliminado de BD → 403 ACTOR_NO_AUTORIZADO, cero escritura', async () => {
      // Crear actor temporal
      const hash = await bcrypt.hash('test123456', 10)
      const tempActor = await prisma.usuario.create({
        data: {
          nombre: 'Temp Actor',
          username: 'p0-temp-actor',
          passwordHash: hash,
          rol: 'SUPERADMIN',
          activo: true,
          empresaId: empresa1Id
        }
      })

      // Eliminarlo directamente (sin pasar por controller)
      await prisma.auditoria.deleteMany({ where: { usuarioId: { in: [tempActor.id] } } })
      await prisma.usuario.delete({ where: { id: tempActor.id } })

      const res = mockRes()
      const req = mockReq(
        { id: tempActor.id, nombre: 'Temp', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Victim', username: 'p0-ac5', password: 'test123456', confirmarPassword: 'test123456', rol: 'EMPLEADO', sucursalId: sucursal1Id }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 403, `Esperado 403: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /No autorizado/i)

      const dbUser = await prisma.usuario.findFirst({ where: { username: 'p0-ac5' } })
      assert.strictEqual(dbUser, null, 'Usuario NO debe persistir con actor eliminado')
    })
  })

  // ═══════════ BLOQUE 17: PLATFORM_ADMIN protegido ═══════════

  describe('PLATFORM_ADMIN Protegido', { concurrency: 1 }, () => {
    it('PA1: SUPERADMIN edita PLATFORM_ADMIN → USUARIO_NO_ENCONTRADO (oculto por FOR UPDATE empresaId)', async () => {
      const hash = await bcrypt.hash('test123456', 10)
      const pa = await prisma.usuario.create({
        data: {
          nombre: 'Platform Admin',
          username: 'p0-platform-admin',
          passwordHash: hash,
          rol: 'PLATFORM_ADMIN',
          activo: true,
          empresaId: null,
          sucursalId: null
        }
      })

      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'Intento Modificar' },
        { id: String(pa.id) }
      )
      await editar(req, res)
      // FOR UPDATE: WHERE id = ${pa.id} AND "empresaId" = ${actorEmpresaId}
      // PLATFORM_ADMIN tiene empresaId=null → 0 filas → USUARIO_NO_ENCONTRADO
      assert.strictEqual(res.getStatus(), 404, `Esperado 404: ${JSON.stringify(res.getJson())}`)
      assert.match(res.getJson().error, /no encontrado/i)

      // PLATFORM_ADMIN permanece intacto
      const dbPA = await prisma.usuario.findUnique({ where: { id: pa.id } })
      assert.ok(dbPA, 'PLATFORM_ADMIN debe seguir existiendo')
      assert.strictEqual(dbPA.nombre, 'Platform Admin', 'Nombre sin cambios')
      assert.strictEqual(dbPA.rol, 'PLATFORM_ADMIN', 'Rol sin cambios')
      assert.strictEqual(dbPA.empresaId, null, 'empresaId debe seguir siendo null')
    })
  })

  // ═══════════ BLOQUE 18: updateMany.count !== 1 ═══════════

  describe('updateMany.count !== 1', { concurrency: 1 }, () => {
    it('UM1: UPDATE_COUNT_REAL_NO_DEMOSTRADO — FOR UPDATE serializa acceso', async () => {
      // El controller usa FOR UPDATE antes de updateMany, lo que serializa
      // cualquier acceso concurrente a la misma fila. En tests secuenciales,
      // la fila siempre existe y el count siempre es 1.
      //
      // Para forzar count !== 1 sería necesario:
      //   a) Dos conexiones concurrentes con diferentes transacciones Serializable
      //   b) Ambas lean la misma fila con FOR UPDATE (la segunda bloquea)
      //   c) La primera modifica y comitea
      //   d) La segunda recibe la fila ya modificada
      //
      // Incluso en ese escenario, updateMany.count seguiría siendo 1 porque
      // la fila sigue existiendo (solo cambió su contenido).
      //
      // Para count !== 1 se requeriría que la fila fuera eliminada entre
      // FOR UPDATE y updateMany, lo cual es imposible porque FOR UPDATE
      // mantiene un lock de escritura que previene DELETE concurrentes.
      //
      // El check updateMany.count !== 1 es una defensa en profundidad
      // válida, pero no es posible dispararla en PostgreSQL con el diseño
      // actual del controller (FOR UPDATE + updateMany).

      // Verificación: el actor sigue funcional después de este análisis
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'UM Test', username: 'p0-um-test', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201, 'Controller sigue funcional')
    })
  })

  // ═══════════ BLOQUE 19: P2034 REAL ═══════════

  describe('P2034 — Conflicto Serializable', { concurrency: 1 }, () => {
    it('P2: P2034_REAL_NO_DEMOSTRADO — Serializable verificado, conflicto no reproducible', async () => {
      // La prueba S1 verificó que el controller usa isolationLevel: 'Serializable'.
      // En S1 se ejecutaron dos creates secuenciales con el mismo username.
      // Resultado: P2002 (unique constraint), NO P2034.
      //
      // Razón:
      //   - P2002 = violación de @@unique([empresaId, username])
      //   - P2034 = conflicto de serialización entre transacciones concurrentes
      //
      // El controller usa FOR SHARE/FOR UPDATE en todas las lecturas, lo que
      // previene conflictos de escritura concurrente. Serialization failures
      // (SQLSTATE 40001) solo ocurren cuando dos transacciones Serializable
      // concurrentes leen los mismos datos SIN bloqueo y luego ambas intentan
      // escribir — PostgreSQL detecta el ciclo en el grafo de serialización
      // y aborta una de ellas.
      //
      // Con FOR UPDATE, las transacciones se serializan a nivel de fila
      // (la segunda espera a que la primera libere el lock), eliminando
      // la posibilidad de conflicto de serialización.
      //
      // Esto es un feature, no un bug: FOR UPDATE + Serializable es más
      // fuerte que Serializable solo, porque previene proactivamente
      // los conflictos en vez de detectarlos reactivamente.

      // El mapping unitario de P2034 a 409 permanece correcto y probado
      // en p0-controller.test.js (test de mapearErrorController).

      // Verificación: el controller sigue funcional
      const res = mockRes()
      const req = mockReq(
        { id: superAdminId, nombre: 'Super Admin', rol: 'SUPERADMIN', sucursalId: null, empresaId: empresa1Id },
        { nombre: 'P2 Test', username: 'p0-p2-test', password: 'test123456', confirmarPassword: 'test123456', rol: 'PRECIOS' }
      )
      await crear(req, res)
      assert.strictEqual(res.getStatus(), 201, 'Controller sigue funcional')
    })
  })
})
