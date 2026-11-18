'use strict'

const router = require('express').Router()
const { requestContext } = require('../../middlewares/request-context.middleware')
const { branchOptional } = require('../../middlewares/scope.middleware')
const controller = require('./notas.controller')

router.use(requestContext, branchOptional)

router.get('/', controller.listar)
router.get('/resumen-no-leidas', controller.resumenNoLeidas)
router.post('/leer-todas', controller.leerTodas)
router.get('/:id', controller.obtener)
router.get('/:id/lecturas', controller.lecturas)
router.post('/', controller.crear)
router.post('/:id/leer', controller.leer)
router.post('/:id/retirar', controller.retirar)
router.post('/:id/reemplazar', controller.reemplazar)

module.exports = router
