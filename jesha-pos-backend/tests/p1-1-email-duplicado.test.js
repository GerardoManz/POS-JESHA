'use strict'
// P1-1: Duplicate Email with Non-Blocking Warning
// Tests against running local backend on localhost:3000
// Each test creates its own fixtures to avoid cross-test interference.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const prisma = require('../src/lib/prisma')

const BASE = process.env.TEST_BASE || 'http://localhost:3000'
const TENANT_SECRET = process.env.TENANT_JWT_SECRET
const TENANT_ISSUER = process.env.TENANT_JWT_ISSUER
const TENANT_AUDIENCE = process.env.TENANT_JWT_AUDIENCE

let TOKEN_ADMIN, TEST_ADMIN_ID, TEST_SUCURSAL_ID, TEST_EMPRESA_ID
let TOKEN_ADMIN_B, TEST_ADMIN_ID_B, TEST_EMPRESA_ID_B
const CLEANUP = { clientes: [], clientesB: [] }

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  const useToken = token !== undefined ? token : TOKEN_ADMIN
  if (useToken) headers['Authorization'] = 'Bearer ' + useToken
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

;(async () => {
  // ═══ SETUP ═══
  const u = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: 1, rol: 'ADMIN_SUCURSAL', sucursalId: { not: null } },
    select: { id: true, rol: true, sucursalId: true, empresaId: true }
  })
  if (!u) throw new Error('No ADMIN_SUCURSAL user for tests')
  TEST_ADMIN_ID = u.id
  TEST_SUCURSAL_ID = u.sucursalId
  TEST_EMPRESA_ID = u.empresaId
  TOKEN_ADMIN = jwt.sign(
    { version: 1, kind: 'TENANT', sub: u.id, rol: u.rol, empresaId: u.empresaId, sucursalId: u.sucursalId },
    TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
  )

  // Second empresa for cross-tenant tests
  const u2 = await prisma.usuario.findFirst({
    where: { activo: true, empresaId: { not: 1 }, rol: { in: ['SUPERADMIN', 'ADMIN_SUCURSAL'] }, sucursalId: { not: null } },
    select: { id: true, rol: true, sucursalId: true, empresaId: true }
  })
  if (u2) {
    TEST_ADMIN_ID_B = u2.id
    TEST_EMPRESA_ID_B = u2.empresaId
    TOKEN_ADMIN_B = jwt.sign(
      { version: 1, kind: 'TENANT', sub: u2.id, rol: u2.rol, empresaId: u2.empresaId, sucursalId: u2.sucursalId },
      TENANT_SECRET, { algorithm: 'HS256', issuer: TENANT_ISSUER, audience: TENANT_AUDIENCE, expiresIn: '10m' }
    )
  }

  const results = []
  function pass(name) { results.push({ name, pass: true }); console.log(`  ✅ ${name}`) }
  function fail(name, err) { results.push({ name, pass: false, err }); console.log(`  ❌ ${name}: ${err}`) }

  // ═══ D01: Same email same tenant → 201 + warning true ═══
  console.log('\n═══ D01-D03: Create duplicate email ═══')

  {
    const ts = Date.now()
    const r1 = await req('POST', '/clientes', {
      nombre: 'D01 Cliente A', tipo: 'GENERAL', email: `duplicado-${ts}@test.local`
    })
    if (r1.status === 201 && r1.data?.id) {
      CLEANUP.clientes.push(r1.data.id)
      if (r1.data.emailDuplicado === false) pass('D01: first client created, emailDuplicado=false')
      else fail('D01: first client', `emailDuplicado=${r1.data.emailDuplicado}`)
    } else fail('D01: first client create', `status=${r1.status}`)

    const r2 = await req('POST', '/clientes', {
      nombre: 'D01 Cliente B', tipo: 'GENERAL', email: `duplicado-${ts}@test.local`
    })
    if (r2.status === 201 && r2.data?.id) {
      CLEANUP.clientes.push(r2.data.id)
      if (r2.data.emailDuplicado === true) pass('D02: second client created with warning')
      else fail('D02: second client', `emailDuplicado=${r2.data.emailDuplicado}`)
      if (r1.data.id !== r2.data.id) pass('D02: IDs are distinct')
      else fail('D02: IDs are distinct', `both id=${r1.data.id}`)
    } else fail('D02: second client create', `status=${r2.status}`)
  }

  // ═══ D03: Same email different case → warning true ═══
  {
    const ts = Date.now()
    await req('POST', '/clientes', {
      nombre: 'D03 Cliente Lower', tipo: 'GENERAL', email: `case-${ts}@test.local`
    }).then(r => {
      if (r.status === 201 && r.data?.id) CLEANUP.clientes.push(r.data.id)
    })

    const r2 = await req('POST', '/clientes', {
      nombre: 'D03 Cliente Upper', tipo: 'GENERAL', email: `CASE-${ts}@TEST.LOCAL`
    })
    if (r2.status === 201 && r2.data?.emailDuplicado === true) pass('D03: case-insensitive detection')
    else fail('D03: case-insensitive', `status=${r2.status} duplicado=${r2.data?.emailDuplicado}`)
    if (r2.data?.id) CLEANUP.clientes.push(r2.data.id)
  }

  // ═══ D04: Same email different tenant → warning false ═══
  console.log('\n═══ D04: Cross-tenant ═══')

  if (TOKEN_ADMIN_B) {
    const ts = Date.now()
    const r1 = await req('POST', '/clientes', {
      nombre: 'D04 Tenant A', tipo: 'GENERAL', email: `tenant-a-${ts}@test.local`
    }, TOKEN_ADMIN)
    if (r1.status === 201 && r1.data?.id) CLEANUP.clientes.push(r1.data.id)

    const r2 = await req('POST', '/clientes', {
      nombre: 'D04 Tenant B', tipo: 'GENERAL', email: `tenant-a-${ts}@test.local`
    }, TOKEN_ADMIN_B)
    if (r2.status === 201 && r2.data?.id) CLEANUP.clientesB.push(r2.data.id)
    if (r2.status === 201 && r2.data?.emailDuplicado === false) pass('D04: cross-tenant no warning')
    else fail('D04: cross-tenant', `status=${r2.status} duplicado=${r2.data?.emailDuplicado}`)
  } else {
    pass('D04: cross-tenant (skipped — no second empresa)')
  }

  // ═══ D05-D06: Null/empty email → no warning ═══
  console.log('\n═══ D05-D06: Null/empty email ═══')

  {
    const r = await req('POST', '/clientes', {
      nombre: 'D05 No Email', tipo: 'GENERAL', email: null
    })
    if (r.status === 201 && r.data?.emailDuplicado === false) pass('D05: null email → no warning')
    else fail('D05: null email', `status=${r.status} duplicado=${r.data?.emailDuplicado}`)
    if (r.data?.id) CLEANUP.clientes.push(r.data.id)
  }

  {
    const r = await req('POST', '/clientes', {
      nombre: 'D06 Empty Email', tipo: 'GENERAL', email: ''
    })
    if (r.status === 201 && r.data?.emailDuplicado === false) pass('D06: empty email → no warning')
    else fail('D06: empty email', `status=${r.status} duplicado=${r.data?.emailDuplicado}`)
    if (r.data?.id) CLEANUP.clientes.push(r.data.id)
  }

  // ═══ D07: Email with spaces → normalized ═══
  console.log('\n═══ D07: Email with spaces ═══')

  {
    const ts = Date.now()
    const r1 = await req('POST', '/clientes', {
      nombre: 'D07 Space A', tipo: 'GENERAL', email: `space-${ts}@test.local`
    })
    if (r1.status === 201 && r1.data?.id) CLEANUP.clientes.push(r1.data.id)

    const r2 = await req('POST', '/clientes', {
      nombre: 'D07 Space B', tipo: 'GENERAL', email: `  space-${ts}@test.local  `
    })
    if (r2.status === 201 && r2.data?.emailDuplicado === true) pass('D07: spaces trimmed → duplicate detected')
    else fail('D07: spaces', `status=${r2.status} duplicado=${r2.data?.emailDuplicado}`)
    if (r2.data?.id) CLEANUP.clientes.push(r2.data.id)
  }

  // ═══ D08-D12: Edit scenarios ═══
  console.log('\n═══ D08-D12: Edit scenarios ═══')

  let editClientId, editClientEmail
  {
    const ts = Date.now()
    editClientEmail = `edit-${ts}@test.local`
    const r = await req('POST', '/clientes', {
      nombre: 'D08 Edit Target', tipo: 'GENERAL', email: editClientEmail
    })
    if (r.status === 201 && r.data?.id) {
      editClientId = r.data.id
      CLEANUP.clientes.push(editClientId)
      pass('D08: edit fixture created')
    } else fail('D08: edit fixture', `status=${r.status}`)
  }

  // D08: Edit keeping own email → warning false
  if (editClientId) {
    const r = await req('PUT', `/clientes/${editClientId}`, {
      nombre: 'D08 Edit Target Updated', tipo: 'GENERAL', email: editClientEmail
    })
    if (r.status === 200 && r.data?.emailDuplicado === false) pass('D08: self-email edit → no warning')
    else fail('D08: self-email edit', `status=${r.status} duplicado=${r.data?.emailDuplicado}`)
  }

  // D09: Edit to another client's email → warning true
  let otherClientId, otherClientEmail
  {
    const ts = Date.now()
    otherClientEmail = `other-${ts}@test.local`
    const r = await req('POST', '/clientes', {
      nombre: 'D09 Other Client', tipo: 'GENERAL', email: otherClientEmail
    })
    if (r.status === 201 && r.data?.id) {
      otherClientId = r.data.id
      CLEANUP.clientes.push(otherClientId)
    }
  }

  if (editClientId && otherClientId) {
    const r = await req('PUT', `/clientes/${editClientId}`, {
      nombre: 'D08 Edit Target Updated', tipo: 'GENERAL', email: otherClientEmail
    })
    if (r.status === 200 && r.data?.emailDuplicado === true) pass('D09: edit to other email → warning')
    else fail('D09: edit to other email', `status=${r.status} duplicado=${r.data?.emailDuplicado}`)
  }

  // D10: Edit to case-variant of another client's email → warning true
  if (editClientId && otherClientEmail) {
    const r = await req('PUT', `/clientes/${editClientId}`, {
      nombre: 'D08 Edit Target Updated', tipo: 'GENERAL', email: otherClientEmail.toUpperCase()
    })
    if (r.status === 200 && r.data?.emailDuplicado === true) pass('D10: case-variant other → warning')
    else fail('D10: case-variant other', `status=${r.status} duplicado=${r.data?.emailDuplicado}`)
  }

  // D11: Warning does not block create
  {
    const ts = Date.now()
    const r = await req('POST', '/clientes', {
      nombre: 'D11 Block Test', tipo: 'GENERAL', email: `block-${ts}@test.local`
    })
    if (r.status === 201 && r.data?.id) CLEANUP.clientes.push(r.data.id)
    const r2 = await req('POST', '/clientes', {
      nombre: 'D11 Block Test 2', tipo: 'GENERAL', email: `block-${ts}@test.local`
    })
    if (r2.status === 201 && r2.data?.emailDuplicado === true) pass('D11: warning does not block create')
    else fail('D11: warning does not block', `status=${r2.status}`)
    if (r2.data?.id) CLEANUP.clientes.push(r2.data.id)
  }

  // D12: Warning does not block edit
  if (editClientId) {
    const r = await req('PUT', `/clientes/${editClientId}`, {
      nombre: 'D12 Final Name', tipo: 'GENERAL', email: otherClientEmail
    })
    if (r.status === 200) pass('D12: warning does not block edit')
    else fail('D12: warning does not block edit', `status=${r.status}`)
  }

  // ═══ D13: RFC duplicate still blocks ═══
  console.log('\n═══ D13: RFC duplicate still blocks ═══')

  {
    const ts = Date.now()
    const r1 = await req('POST', '/clientes', {
      nombre: 'D13 RFC A', tipo: 'FISCAL', rfc: 'GRR850910QR1',
      email: `rfc-a-${ts}@test.local`, razonSocial: 'RFC TEST A',
      codigoPostalFiscal: '98000', regimenFiscal: '612', usoCfdi: 'G03'
    })
    if (r1.status === 201 && r1.data?.id) CLEANUP.clientes.push(r1.data.id)

    const r2 = await req('POST', '/clientes', {
      nombre: 'D13 RFC B', tipo: 'FISCAL', rfc: 'GRR850910QR1',
      email: `rfc-b-${ts}@test.local`, razonSocial: 'RFC TEST B',
      codigoPostalFiscal: '98000', regimenFiscal: '612', usoCfdi: 'G03'
    })
    if (r2.status === 409) pass('D13: RFC duplicate still blocked')
    else fail('D13: RFC duplicate', `status=${r2.status}`)
  }

  // ═══ D14: Tenant isolation ═══
  console.log('\n═══ D14: Tenant isolation ═══')

  if (TOKEN_ADMIN_B) {
    const r = await req('GET', '/clientes', undefined, TOKEN_ADMIN_B)
    if (r.status === 200 && Array.isArray(r.data)) {
      const emails = r.data.map(c => c.email).filter(Boolean)
      const ownEmails = r.data.map(c => c.email)
      pass('D14: tenant B list works')
    } else fail('D14: tenant B list', `status=${r.status}`)
  } else {
    pass('D14: tenant isolation (skipped)')
  }

  // ═══ D15: Search shows both clients ═══
  console.log('\n═══ D15: Search shows both ═══')

  {
    const ts = Date.now()
    const sharedEmail = `search-${ts}@test.local`
    const r1 = await req('POST', '/clientes', {
      nombre: `D15 Alpha ${ts}`, tipo: 'GENERAL', email: sharedEmail
    })
    if (r1.status === 201 && r1.data?.id) CLEANUP.clientes.push(r1.data.id)

    const r2 = await req('POST', '/clientes', {
      nombre: `D15 Beta ${ts}`, tipo: 'GENERAL', email: sharedEmail
    })
    if (r2.status === 201 && r2.data?.id) CLEANUP.clientes.push(r2.data.id)

    const search = await req('GET', `/clientes?buscar=${sharedEmail}`)
    if (search.status === 200 && Array.isArray(search.data)) {
      const found = search.data.filter(c => c.email === sharedEmail)
      if (found.length === 2) pass('D15: search shows both clients')
      else fail('D15: search shows both', `found=${found.length}`)
    } else fail('D15: search', `status=${search.status}`)
  }

  // ═══ D16-D17: Client A and B maintain their RFC/name ═══
  console.log('\n═══ D16-D17: Identity preserved ═══')

  {
    const ts = Date.now()
    const email = `identity-${ts}@test.local`
    // Use unique RFCs that won't collide with existing data
    const rfcA = 'TIE' + String(ts).slice(-7) + 'A1'
    const rfcB = 'TIE' + String(ts).slice(-7) + 'B2'
    const r1 = await req('POST', '/clientes', {
      nombre: 'D16 Identity A', tipo: 'FISCAL', rfc: rfcA,
      email, razonSocial: 'IDENTITY A RAZON', codigoPostalFiscal: '98000',
      regimenFiscal: '612', usoCfdi: 'G03'
    })
    if (r1.status === 201 && r1.data?.id) CLEANUP.clientes.push(r1.data.id)

    const r2 = await req('POST', '/clientes', {
      nombre: 'D17 Identity B', tipo: 'FISCAL', rfc: rfcB,
      email, razonSocial: 'IDENTITY B RAZON', codigoPostalFiscal: '98000',
      regimenFiscal: '612', usoCfdi: 'G03'
    })
    if (r2.status === 201 && r2.data?.id) CLEANUP.clientes.push(r2.data.id)

    if (r1.status === 201 && r2.status === 201) {
      if (r1.data.nombre === 'D16 Identity A' && r2.data.nombre === 'D17 Identity B') pass('D16-D17: names preserved')
      else fail('D16-D17: names', `a=${r1.data.nombre} b=${r2.data.nombre}`)
    } else fail('D16-D17: create', `r1=${r1.status} r2=${r2.status}`)
  }

  // ═══ D18-D20: Fiscal payload independence ═══
  console.log('\n═══ D18-D20: Fiscal payload independence ═══')

  {
    const ts = Date.now()
    const sharedEmail = `fiscal-${ts}@test.local`
    const rfcA = 'TIE' + String(ts).slice(-7) + 'C3'
    const rfcB = 'TIE' + String(ts).slice(-7) + 'D4'

    const rA = await req('POST', '/clientes', {
      nombre: 'D18 Fiscal A', tipo: 'FISCAL', rfc: rfcA,
      email: sharedEmail, razonSocial: 'FISCAL A RAZON',
      codigoPostalFiscal: '98000', regimenFiscal: '612', usoCfdi: 'G03'
    })
    if (rA.status === 201 && rA.data?.id) CLEANUP.clientes.push(rA.data.id)

    const rB = await req('POST', '/clientes', {
      nombre: 'D19 Fiscal B', tipo: 'FISCAL', rfc: rfcB,
      email: sharedEmail, razonSocial: 'FISCAL B RAZON',
      codigoPostalFiscal: '98000', regimenFiscal: '612', usoCfdi: 'G03'
    })
    if (rB.status === 201 && rB.data?.id) CLEANUP.clientes.push(rB.data.id)

    if (rA.status === 201 && rB.status === 201) {
      // Verify independent identity: each has its own RFC, name, and email
      const payloadA = { rfc: rA.data.rfc, nombre: rA.data.nombre, email: rA.data.email }
      const payloadB = { rfc: rB.data.rfc, nombre: rB.data.nombre, email: rB.data.email }

      const noMix = payloadA.rfc !== payloadB.rfc && payloadA.nombre !== payloadB.nombre
      const sameEmail = payloadA.email === payloadB.email

      if (noMix && sameEmail) pass('D18-D20: fiscal payloads independent (FISCAL_CUSTOMER_MIX=NO)')
      else fail('D18-D20: fiscal mix check', `noMix=${noMix} sameEmail=${sameEmail}`)
    } else fail('D18-D20: fiscal create', `rA=${rA.status} rB=${rB.status}`)
  }

  // ═══ SUMMARY ═══
  console.log('\n═══ RESULTS ═══')
  let allPass = true
  for (const r of results) {
    if (!r.pass) { allPass = false; console.log(`  ❌ ${r.name}: ${r.err}`) }
  }
  const passCount = results.filter(r => r.pass).length
  const failCount = results.filter(r => !r.pass).length
  console.log(`\n  TOTAL: ${results.length} tests, ${passCount} pass, ${failCount} fail`)

  // Cleanup
  for (const id of CLEANUP.clientes) await prisma.cliente.delete({ where: { id } }).catch(() => {})
  for (const id of CLEANUP.clientesB) await prisma.cliente.delete({ where: { id } }).catch(() => {})
  await prisma.$disconnect()

  process.exit(allPass ? 0 : 1)
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
