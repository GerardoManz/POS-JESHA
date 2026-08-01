const express = require('express')
const router = express.Router()
const rateLimit = require('express-rate-limit')
const { login, me, actualizarPreferencias, obtenerContexto } = require('./auth.controller')
const { requireAuth } = require('../../middlewares/auth.middleware')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { branchOptional } = require('../../middlewares/scope.middleware')

const loginLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,  // 3 minutos
  max: 7,                    // 7 intentos por IP
  message: { error: 'Demasiados intentos. Intenta de nuevo en 3 minutos.' }
})

router.post('/login', loginLimiter, login)
router.get('/me', requireAuth, me)
router.patch('/preferencias', requireAuth, actualizarPreferencias)
router.get('/context', requireAuth, requestContext, branchOptional, obtenerContexto)

module.exports = router
