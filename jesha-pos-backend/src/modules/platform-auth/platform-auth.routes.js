'use strict'

const express = require('express')
const rateLimit = require('express-rate-limit')
const { login, me } = require('./platform-auth.controller')
const { autenticarPlataforma } = require('../../middlewares/platform-auth.middleware')

const router = express.Router()

const platformLoginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo más tarde.' }
})

router.post('/login', platformLoginLimiter, login)
router.get('/me', autenticarPlataforma, me)

module.exports = router
