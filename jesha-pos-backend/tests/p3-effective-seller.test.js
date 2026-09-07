'use strict'

// ─── Environment setup (BEFORE any imports that read config) ────────
process.env.TENANT_JWT_SECRET = 'tenant-test-secret-'.padEnd(64, 't')
process.env.TENANT_JWT_ISSUER = 'jesha-tenant-test'
process.env.TENANT_JWT_AUDIENCE = 'jesha-tenant-api-test'
process.env.TENANT_JWT_TTL = '8h'
process.env.PLATFORM_JWT_SECRET = 'platform-test-secret-'.padEnd(64, 'p')
process.env.PLATFORM_JWT_ISSUER = 'jesha-platform-test'
process.env.PLATFORM_JWT_AUDIENCE = 'jesha-platform-api-test'
process.env.PLATFORM_JWT_TTL = '15m'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const jwt = require('jsonwebtoken')

// ─── Module under test ──────────────────────────────────────────────
const {
  SELLER_AUTH_AUDIENCE,
  SELLER_AUTH_TTL_SECONDS,
  SellerAuthError,
  signSellerAuthorization,
  verifySellerAuthorization
} = require('../src/security/seller-auth')
const prisma = require('../src/lib/prisma')
const { crearVenta } = require('../src/modules/ventas/ventas.controller')

// ─── Config for JWT tests ───────────────────────────────────────────
const TENANT_CONFIG = {
  secret: process.env.TENANT_JWT_SECRET,
  issuer: process.env.TENANT_JWT_ISSUER,
  audience: process.env.TENANT_JWT_AUDIENCE,
  algorithm: 'HS256'
}

// ─── Helpers ────────────────────────────────────────────────────────
function signSessionToken(overrides = {}) {
  return jwt.sign(
    { version: 1, kind: 'TENANT', sub: 100, rol: 'ADMIN_SUCURSAL', ...overrides },
    TENANT_CONFIG.secret,
    { algorithm: TENANT_CONFIG.algorithm, issuer: TENANT_CONFIG.issuer, audience: TENANT_CONFIG.audience, expiresIn: '1h' }
  )
}

function mockControllerRes() {
  const state = { statusCode: 200, body: null }
  return {
    state,
    status(code) {
      state.statusCode = code
      return this
    },
    json(body) {
      state.body = body
      return this
    }
  }
}

// ─── Tests ──────────────────────────────────────────────────────────
describe('P3-EFFECTIVE-SELLER', { concurrency: 1 }, () => {

  // ════════════════════════════════════════════════════════════════════
  //  SELLER AUTH MODULE (seller-auth.js)
  // ════════════════════════════════════════════════════════════════════

  describe('T16/T17 — SAT token structure and expiration', () => {
    it('signs a valid SAT with correct claims', () => {
      const token = signSellerAuthorization({
        sellerId: 200,
        sessionUserId: 100,
        empresaId: 10,
        sucursalId: 30
      })
      assert.ok(typeof token === 'string')
      assert.ok(token.length > 0)

      const decoded = jwt.decode(token)
      assert.strictEqual(decoded.sub, 200)
      assert.strictEqual(decoded.sid, 100)
      assert.strictEqual(decoded.eid, 10)
      assert.strictEqual(decoded.bid, 30)
      assert.strictEqual(decoded.aud, SELLER_AUTH_AUDIENCE)
      assert.ok(decoded.iat > 0)
      assert.ok(decoded.exp > decoded.iat)
    })

    it('uses 5-minute expiration', () => {
      assert.strictEqual(SELLER_AUTH_TTL_SECONDS, 300)
      const token = signSellerAuthorization({ sellerId: 1, sessionUserId: 2, empresaId: 3, sucursalId: 4 })
      const decoded = jwt.decode(token)
      assert.strictEqual(decoded.exp - decoded.iat, 300)
    })

    it('rejects invalid sellerId', () => {
      assert.throws(() => signSellerAuthorization({ sellerId: -1, sessionUserId: 1, empresaId: 1, sucursalId: 1 }), /positive integer/)
      assert.throws(() => signSellerAuthorization({ sellerId: 0, sessionUserId: 1, empresaId: 1, sucursalId: 1 }), /positive integer/)
      assert.throws(() => signSellerAuthorization({ sellerId: 'abc', sessionUserId: 1, empresaId: 1, sucursalId: 1 }), /positive integer/)
    })

    it('verifies a valid SAT', () => {
      const token = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 30 })
      const claims = verifySellerAuthorization(token)
      assert.strictEqual(claims.sub, 200)
      assert.strictEqual(claims.sid, 100)
      assert.strictEqual(claims.eid, 10)
      assert.strictEqual(claims.bid, 30)
    })

    it('rejects empty/null token', () => {
      assert.throws(() => verifySellerAuthorization(null), SellerAuthError)
      assert.throws(() => verifySellerAuthorization(''), SellerAuthError)
      assert.throws(() => verifySellerAuthorization(123), SellerAuthError)
    })

    it('rejects expired SAT', () => {
      const token = jwt.sign(
        { sub: 1, sid: 2, eid: 3, bid: 4, iat: Math.floor(Date.now() / 1000) - 600, exp: Math.floor(Date.now() / 1000) - 300 },
        TENANT_CONFIG.secret,
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: SELLER_AUTH_AUDIENCE }
      )
      assert.throws(() => verifySellerAuthorization(token), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_EXPIRED')
        return true
      })
    })

    it('rejects SAT with wrong audience', () => {
      const token = jwt.sign(
        { sub: 1, sid: 2, eid: 3, bid: 4 },
        TENANT_CONFIG.secret,
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: 'wrong-audience' }
      )
      assert.throws(() => verifySellerAuthorization(token), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_INVALID')
        return true
      })
    })

    it('rejects SAT with wrong secret', () => {
      const token = jwt.sign(
        { sub: 1, sid: 2, eid: 3, bid: 4 },
        'wrong-secret-at-least-32-chars-long!!',
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: SELLER_AUTH_AUDIENCE }
      )
      assert.throws(() => verifySellerAuthorization(token), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_INVALID')
        return true
      })
    })

    it('rejects SAT with wrong issuer', () => {
      const token = jwt.sign(
        { sub: 1, sid: 2, eid: 3, bid: 4 },
        TENANT_CONFIG.secret,
        { algorithm: 'HS256', issuer: 'wrong-issuer', audience: SELLER_AUTH_AUDIENCE }
      )
      assert.throws(() => verifySellerAuthorization(token), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_INVALID')
        return true
      })
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  T19 — SAT cannot be used as session JWT
  // ════════════════════════════════════════════════════════════════════

  describe('T19 — Seller token cannot authenticate session', () => {
    it('rejects SAT as Bearer token (wrong audience)', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 30 })

      assert.throws(() => {
        jwt.verify(sat, TENANT_CONFIG.secret, {
          algorithms: [TENANT_CONFIG.algorithm],
          issuer: TENANT_CONFIG.issuer,
          audience: TENANT_CONFIG.audience
        })
      }, /audience/)
    })

    it('rejects session token as SAT (wrong audience)', () => {
      const sessionToken = signSessionToken()

      assert.throws(() => {
        verifySellerAuthorization(sessionToken)
      }, (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_INVALID')
        return true
      })
    })

    it('SAT and session token have different aud claims', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 30 })
      const session = signSessionToken()

      const satDecoded = jwt.decode(sat)
      const sessionDecoded = jwt.decode(session)

      assert.strictEqual(satDecoded.aud, 'pos-seller-auth')
      assert.strictEqual(sessionDecoded.aud, 'jesha-tenant-api-test')
      assert.notStrictEqual(satDecoded.aud, sessionDecoded.aud)
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  VENTAS CONTROLLER — Seller resolution logic
  // ════════════════════════════════════════════════════════════════════

  describe('Ventas controller — seller resolution', () => {
    it('T1 — no usuarioId in body → uses session user', () => {
      const sessionUserId = 100
      const bodyUsuarioId = null
      const result = resolveSellerId(bodyUsuarioId, sessionUserId, null)
      assert.deepStrictEqual(result, { sellerId: sessionUserId })
    })

    it('T1b — usuarioId matches session user → uses session user', () => {
      const sessionUserId = 100
      const bodyUsuarioId = 100
      const result = resolveSellerId(bodyUsuarioId, sessionUserId, null)
      assert.deepStrictEqual(result, { sellerId: sessionUserId })
    })

    it('T20 — usuarioId different from session, no SAT → REJECT', () => {
      const sessionUserId = 100
      const bodyUsuarioId = 200
      const sat = null
      const result = resolveSellerId(bodyUsuarioId, sessionUserId, sat)
      assert.strictEqual(result.error, 'SELLER_AUTH_REQUIRED')
    })

    it('T2 — usuarioId different, valid SAT → uses seller from SAT', () => {
      const sessionUserId = 100
      const bodyUsuarioId = 200
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 30 })
      const result = resolveSellerId(bodyUsuarioId, sessionUserId, sat)
      assert.strictEqual(result.sellerId, 200)
    })

    it('T5 — forged SAT (wrong secret) → REJECT', () => {
      const forged = jwt.sign(
        { sub: 200, sid: 100, eid: 10, bid: 30 },
        'wrong-secret!!!!!!!!!!!!!!!!!!!!!!!!',
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: SELLER_AUTH_AUDIENCE }
      )
      const result = resolveSellerId(200, 100, forged)
      assert.strictEqual(result.error, 'SELLER_AUTH_INVALID')
    })

    it('T6 — expired SAT → REJECT', () => {
      const expired = jwt.sign(
        { sub: 200, sid: 100, eid: 10, bid: 30, iat: Math.floor(Date.now() / 1000) - 600, exp: Math.floor(Date.now() / 1000) - 300 },
        TENANT_CONFIG.secret,
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: SELLER_AUTH_AUDIENCE }
      )
      const result = resolveSellerId(200, 100, expired)
      assert.strictEqual(result.error, 'SELLER_AUTH_EXPIRED')
    })

    it('T7 — SAT for different session (sid mismatch) → REJECT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 999, empresaId: 10, sucursalId: 30 })
      const result = resolveSellerId(200, 100, sat)
      assert.strictEqual(result.error, 'SELLER_AUTH_SESSION_MISMATCH')
    })

    it('T8 — SAT for different tenant (eid mismatch) → REJECT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 99, sucursalId: 30 })
      const result = resolveSellerId(200, 100, sat, 10)
      assert.strictEqual(result.error, 'SELLER_AUTH_TENANT_MISMATCH')
    })

    it('T11 — SAT for different branch (bid mismatch) → REJECT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 99 })
      const result = resolveSellerId(200, 100, sat, 10, 30)
      assert.strictEqual(result.error, 'SELLER_AUTH_BRANCH_MISMATCH')
    })

    it('T21 — SAT.sub != body.usuarioId → REJECT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 30 })
      const result = resolveSellerId(300, 100, sat)
      assert.strictEqual(result.error, 'SELLER_AUTH_SELLER_MISMATCH')
    })

    it('T22 — SUPERADMIN: SAT for branch A used in branch B → REJECT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 30 })
      const result = resolveSellerId(200, 100, sat, 10, 40)
      assert.strictEqual(result.error, 'SELLER_AUTH_BRANCH_MISMATCH')
    })

    it('T22b — SUPERADMIN: SAT for branch B, used in branch B → ACCEPT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 40 })
      const result = resolveSellerId(200, 100, sat, 10, 40)
      assert.strictEqual(result.sellerId, 200)
    })

    it('T19b — SAT cannot bypass session auth', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 30 })

      assert.throws(() => {
        jwt.verify(sat, TENANT_CONFIG.secret, {
          algorithms: ['HS256'],
          issuer: TENANT_CONFIG.issuer,
          audience: TENANT_CONFIG.audience
        })
      })
    })
  })

  describe('Ventas controller — real crearVenta path', { concurrency: 1 }, () => {
    it('valid SAT reaches sale validation without ReferenceError', async () => {
      const originalFindFirst = prisma.turnoCaja.findFirst
      let turnoQuery = null

      try {
        prisma.turnoCaja.findFirst = async (args) => {
          turnoQuery = args
          return null
        }

        const sellerAuthorization = signSellerAuthorization({
          sellerId: 200,
          sessionUserId: 100,
          empresaId: 10,
          sucursalId: 30
        })
        const req = {
          usuario: { id: 100, nombre: 'Administrador', rol: 'SUPERADMIN' },
          context: Object.freeze({
            version: 1,
            kind: 'TENANT',
            actor: { id: 100, rol: 'SUPERADMIN' },
            tenant: { empresaId: 10 },
            branch: { mode: 'SELECTED', sucursalId: 30 }
          }),
          body: {
            usuarioId: 200,
            sellerAuthorization,
            turnoId: 77,
            metodoPago: 'EFECTIVO',
            subtotal: 100,
            iva: 0,
            descuento: 0,
            total: 100,
            montoPagado: 100,
            detalles: [{
              productoId: 501,
              cantidad: 1,
              precioUnitario: 100,
              subtotal: 100,
              modoCaptura: 'CANTIDAD',
              cantidadCapturada: 1,
              unidadCapturada: 'PZA'
            }]
          }
        }
        const res = mockControllerRes()

        await crearVenta(req, res)

        assert.deepStrictEqual(turnoQuery, {
          where: { id: 77, empresaId: 10, sucursalId: 30, abierto: true }
        })
        assert.strictEqual(res.state.statusCode, 403)
        assert.strictEqual(res.state.body.codigo, 'SIN_TURNO_ABIERTO')
      } finally {
        prisma.turnoCaja.findFirst = originalFindFirst
      }
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  B1-B12 — BRANCH BINDING BLOCKING TESTS
  // ════════════════════════════════════════════════════════════════════

  describe('B1-B12 — Branch binding blocking tests', () => {
    it('B1 — sign with sucursalId=null → REJECTED', () => {
      assert.throws(() => signSellerAuthorization({ sellerId: 1, sessionUserId: 2, empresaId: 3, sucursalId: null }), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_REQUIRED')
        return true
      })
    })

    it('B2 — sign without sucursalId property → REJECTED', () => {
      assert.throws(() => signSellerAuthorization({ sellerId: 1, sessionUserId: 2, empresaId: 3 }), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_REQUIRED')
        return true
      })
    })

    it('B3 — verify forged JWT with bid=null → REJECTED', () => {
      const forged = jwt.sign(
        { sub: 1, sid: 2, eid: 3, bid: null },
        TENANT_CONFIG.secret,
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: SELLER_AUTH_AUDIENCE }
      )
      assert.throws(() => verifySellerAuthorization(forged), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_INVALID')
        return true
      })
    })

    it('B4 — verify JWT missing bid claim → REJECTED', () => {
      const forged = jwt.sign(
        { sub: 1, sid: 2, eid: 3 },
        TENANT_CONFIG.secret,
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: SELLER_AUTH_AUDIENCE }
      )
      assert.throws(() => verifySellerAuthorization(forged), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_INVALID')
        return true
      })
    })

    it('B5 — verify JWT with bid as string → REJECTED', () => {
      const forged = jwt.sign(
        { sub: 1, sid: 2, eid: 3, bid: '10' },
        TENANT_CONFIG.secret,
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: SELLER_AUTH_AUDIENCE }
      )
      assert.throws(() => verifySellerAuthorization(forged), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_INVALID')
        return true
      })
    })

    it('B6 — cross branch: SAT.bid=10, venta.sucursalId=11 → REJECT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 10 })
      const result = resolveSellerId(200, 100, sat, 10, 11)
      assert.strictEqual(result.error, 'SELLER_AUTH_BRANCH_MISMATCH')
    })

    it('B7 — same branch: SAT.bid=10, venta.sucursalId=10 → ACCEPT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 10 })
      const result = resolveSellerId(200, 100, sat, 10, 10)
      assert.strictEqual(result.sellerId, 200)
    })

    it('B8 — SUPERADMIN cross branch: SAT for A used in B → REJECT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 30 })
      const result = resolveSellerId(200, 100, sat, 10, 40)
      assert.strictEqual(result.error, 'SELLER_AUTH_BRANCH_MISMATCH')
    })

    it('B9 — SUPERADMIN new SAT for B → ACCEPT', () => {
      const sat = signSellerAuthorization({ sellerId: 200, sessionUserId: 100, empresaId: 10, sucursalId: 40 })
      const result = resolveSellerId(200, 100, sat, 10, 40)
      assert.strictEqual(result.sellerId, 200)
    })

    it('B10 — sign with sucursalId=0 → REJECTED', () => {
      assert.throws(() => signSellerAuthorization({ sellerId: 1, sessionUserId: 2, empresaId: 3, sucursalId: 0 }), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_REQUIRED')
        return true
      })
    })

    it('B11 — sign with sucursalId=-5 → REJECTED', () => {
      assert.throws(() => signSellerAuthorization({ sellerId: 1, sessionUserId: 2, empresaId: 3, sucursalId: -5 }), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_REQUIRED')
        return true
      })
    })

    it('B11b — sign with string or NaN sucursalId → REJECTED', () => {
      for (const sucursalId of ['5', NaN]) {
        assert.throws(() => signSellerAuthorization({ sellerId: 1, sessionUserId: 2, empresaId: 3, sucursalId }), (err) => {
          assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_REQUIRED')
          return true
        })
      }
    })

    it('B12 — verify JWT with bid=0 → REJECTED', () => {
      const forged = jwt.sign(
        { sub: 1, sid: 2, eid: 3, bid: 0 },
        TENANT_CONFIG.secret,
        { algorithm: 'HS256', issuer: TENANT_CONFIG.issuer, audience: SELLER_AUTH_AUDIENCE }
      )
      assert.throws(() => verifySellerAuthorization(forged), (err) => {
        assert.strictEqual(err.code, 'SELLER_AUTH_BRANCH_INVALID')
        return true
      })
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  VERSION AUDIT
  // ════════════════════════════════════════════════════════════════════

  describe('T18 — Version strings', () => {
    const fs = require('fs')
    const path = require('path')
    const ROOT = path.resolve(__dirname, '..', '..')

    it('backend package.json shows 2.0.1', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'package.json'), 'utf8'))
      assert.strictEqual(pkg.version, '2.0.1')
    })

    it('sidebar.js shows 2.0.1', () => {
      const src = fs.readFileSync(path.join(ROOT, 'sidebar.js'), 'utf8')
      assert.ok(src.includes('Versión 2.0.1'), 'sidebar.js should contain "Versión 2.0.1"')
      assert.ok(!src.includes('Versión 1.0.0'), 'sidebar.js should NOT contain "Versión 1.0.0"')
    })

    it('sidebar.html shows 2.0.1', () => {
      const src = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8')
      assert.ok(src.includes('Versión 2.0.1'), 'sidebar.html should contain "Versión 2.0.1"')
      assert.ok(!src.includes('Versión 1.0.0'), 'sidebar.html should NOT contain "Versión 1.0.0"')
    })
  })

  // ════════════════════════════════════════════════════════════════════
  //  CODE INTEGRITY AUDIT
  // ════════════════════════════════════════════════════════════════════

  describe('Code integrity — key patterns', () => {
    const fs = require('fs')
    const path = require('path')
    const ROOT = path.resolve(__dirname, '..', '..')

    it('ventas.controller.js uses seller auth for cross-user sales', () => {
      const src = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src/modules/ventas/ventas.controller.js'), 'utf8')
      assert.ok(src.includes('SELLER_AUTH_REQUIRED'), 'Should reject when SAT is missing for cross-user sale')
      assert.ok(src.includes('SELLER_AUTH_SELLER_MISMATCH'), 'Should reject SAT/body seller mismatch')
      assert.ok(src.includes('verifySellerAuthorization'), 'Should call verifySellerAuthorization')
    })

    it('ventas.controller.js no longer hardcodes req.usuario.id as usuarioId', () => {
      const src = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src/modules/ventas/ventas.controller.js'), 'utf8')
      assert.ok(!src.includes('const usuarioId  = req.usuario.id'), 'Old hardcoded usuarioId assignment should be removed')
    })

    it('ventas.controller.js uses strict bid comparison (no null skip)', () => {
      const src = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src/modules/ventas/ventas.controller.js'), 'utf8')
      assert.ok(src.includes('satClaims.bid !== sucursalId'), 'Should use strict bid !== sucursalId comparison')
      assert.ok(!src.includes('satClaims.bid != null && satClaims.bid !=='), 'Should NOT use null-skip pattern')
    })

    it('ventas.controller.js print snapshot uses effective seller name', () => {
      const src = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src/modules/ventas/ventas.controller.js'), 'utf8')
      assert.ok(src.includes('usuario?.nombre'), 'Print snapshot should use usuario?.nombre (effective seller)')
    })

    it('usuarios.controller.js signs SAT in verificarPin', () => {
      const src = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src/modules/usuarios/usuarios.controller.js'), 'utf8')
      assert.ok(src.includes('signSellerAuthorization'), 'verificarPin should sign a SAT')
      assert.ok(src.includes('sellerAuthorization'), 'Response should include sellerAuthorization')
    })

    it('usuarios.controller.js requires sucursalId in verificarPin', () => {
      const src = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend', 'src/modules/usuarios/usuarios.controller.js'), 'utf8')
      assert.ok(src.includes('SELLER_AUTH_BRANCH_REQUIRED'), 'Should reject when sucursalId is missing')
    })

    it('punto-venta.js sends sellerAuthorization in payload', () => {
      const src = fs.readFileSync(path.join(ROOT, 'punto-venta.js'), 'utf8')
      assert.ok(src.includes('sellerAuthorization: sellerAuthorization || undefined'), 'Payload should include sellerAuthorization')
      assert.ok(src.includes('let sellerAuthorization'), 'State variable should exist')
    })

    it('punto-venta.js sends sucursalId in PIN verification', () => {
      const src = fs.readFileSync(path.join(ROOT, 'punto-venta.js'), 'utf8')
      assert.ok(src.includes('sucursalId: turnoActivo?.sucursalId'), 'PIN verification should send sucursalId')
    })

    it('seller-auth.js rejects null sucursalId in sign', () => {
      const src = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend/src/security/seller-auth.js'), 'utf8')
      assert.ok(src.includes('SELLER_AUTH_BRANCH_REQUIRED'), 'Should throw SELLER_AUTH_BRANCH_REQUIRED for null branch')
    })

    it('seller-auth.js rejects null/missing bid in verify', () => {
      const src = fs.readFileSync(path.join(ROOT, 'jesha-pos-backend/src/security/seller-auth.js'), 'utf8')
      assert.ok(src.includes('SELLER_AUTH_BRANCH_INVALID'), 'Should reject null/missing bid in verify')
      assert.ok(!src.includes('bid: payload.bid ?? null'), 'Should NOT fallback bid to null')
    })
  })
})

// ─── Pure helper: resolves seller ID following the 4-case logic ─────
function resolveSellerId(bodyUsuarioId, sessionUserId, sat, empresaId, sucursalId) {
  if (bodyUsuarioId != null && !isNaN(bodyUsuarioId) && bodyUsuarioId !== sessionUserId) {
    // Case C/D: cross-user sale — SAT mandatory
    if (!sat) {
      return { error: 'SELLER_AUTH_REQUIRED' }
    }
    let satClaims
    try {
      satClaims = verifySellerAuthorization(sat)
    } catch (err) {
      return { error: err.code || 'SELLER_AUTH_INVALID' }
    }
    if (satClaims.sid !== sessionUserId) {
      return { error: 'SELLER_AUTH_SESSION_MISMATCH' }
    }
    if (empresaId != null && satClaims.eid !== empresaId) {
      return { error: 'SELLER_AUTH_TENANT_MISMATCH' }
    }
    if (sucursalId != null && satClaims.bid !== sucursalId) {
      return { error: 'SELLER_AUTH_BRANCH_MISMATCH' }
    }
    if (satClaims.sub !== bodyUsuarioId) {
      return { error: 'SELLER_AUTH_SELLER_MISMATCH' }
    }
    return { sellerId: satClaims.sub }
  }
  // Case A/B: self-sale
  return { sellerId: sessionUserId }
}
