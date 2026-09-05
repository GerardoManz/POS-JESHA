const express = require('express')
const router = express.Router()
const rateLimit = require('express-rate-limit')
const { login, me, actualizarPreferencias, obtenerContexto } = require('./auth.controller')
const { requireTenantOrDelegated } = require('../../middlewares/tenant-or-delegated.middleware')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { branchOptional } = require('../../middlewares/scope.middleware')

const loginLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 3 * 60 * 1000,  // 3 minutos
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 7,                          // 7 intentos por IP
  message: { error: 'Demasiados intentos. Intenta de nuevo en 3 minutos.' }
})

router.post('/login', loginLimiter, login)
router.get('/me', requireTenantOrDelegated, me)
router.patch('/preferencias', requireTenantOrDelegated, actualizarPreferencias)
router.get('/context', requireTenantOrDelegated, requestContext, branchOptional, obtenerContexto)

module.exports = router
