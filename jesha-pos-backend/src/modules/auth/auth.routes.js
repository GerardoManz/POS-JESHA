const express = require('express')
const router = express.Router()
const rateLimit = require('express-rate-limit')
const { login, me, actualizarPreferencias } = require('./auth.controller')
const { requireAuth } = require('../../middlewares/auth.middleware')

const loginLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,  // 3 minutos
  max: 7,                    // 7 intentos por IP
  message: { error: 'Demasiados intentos. Intenta de nuevo en 3 minutos.' }
})

router.post('/login', loginLimiter, login)
router.get('/me', requireAuth, me)
router.patch('/preferencias', requireAuth, actualizarPreferencias)

module.exports = router
