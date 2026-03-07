// ═══════════════════════════════════════════════════════════════════
// CLIENTES.ROUTES.JS — sin cambios, estaba correcto
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router()
const { listar, crear, editar, cambiarEstado, obtenerVentas, obtenerAbonos } = require('./clientes.controller')
const { requireAuth } = require('../../middlewares/auth.middleware')

router.get('/',            requireAuth, listar)
router.post('/',           requireAuth, crear)
router.put('/:id',         requireAuth, editar)
router.patch('/:id/estado',requireAuth, cambiarEstado)
router.get('/:id/ventas',  requireAuth, obtenerVentas)
router.get('/:id/abonos',  requireAuth, obtenerAbonos)

module.exports = router