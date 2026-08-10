'use strict'

const express = require('express')
const {
  listar,
  obtener,
  crear,
  editar,
  activar,
  suspender
} = require('./empresas.controller')

const router = express.Router()

router.get('/', listar)
router.get('/:id', obtener)
router.post('/', crear)
router.patch('/:id', editar)
router.post('/:id/activar', activar)
router.post('/:id/suspender', suspender)

module.exports = router
