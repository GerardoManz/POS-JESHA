const router = require('express').Router()
const { listar } = require('./sucursal.controller')

router.get('/', listar)

module.exports = router
