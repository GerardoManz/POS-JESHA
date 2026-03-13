const express = require('express')
const router = express.Router()
const { obtenerActivo, abrirTurno, cerrarTurno } = require('./turnos-caja.controller')

const { requireAuth } = require('../../middlewares/auth.middleware')
router.get('/activo', obtenerActivo)
router.post('/abrir', abrirTurno)
router.post('/cerrar', cerrarTurno)

module.exports = router