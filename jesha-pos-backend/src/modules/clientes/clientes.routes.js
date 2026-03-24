const router = require('express').Router()
const { listar, obtener, crear, editar, cambiarEstado, obtenerVentas, obtenerAbonos, abonarCredito } = require('./clientes.controller')
const { requireAuth } = require('../../middlewares/auth.middleware')

router.get('/',                    requireAuth, listar)
router.get('/:id',                 requireAuth, obtener)
router.post('/',                   requireAuth, crear)
router.put('/:id',                 requireAuth, editar)
router.patch('/:id/estado',        requireAuth, cambiarEstado)
router.get('/:id/ventas',          requireAuth, obtenerVentas)
router.get('/:id/abonos',          requireAuth, obtenerAbonos)
router.post('/:id/abonar-credito', requireAuth, abonarCredito)

module.exports = router