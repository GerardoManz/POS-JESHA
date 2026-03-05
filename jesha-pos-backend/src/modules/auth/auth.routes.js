const express = require('express')
const router = express.Router()
const { login, me } = require('./auth.controller')
const { requireAuth } = require('../../middlewares/auth.middleware')

router.post('/login', login)
router.get('/me', requireAuth, me)

module.exports = router