const router = require('express').Router()
const { actualizarPrecios } = require('./precios.controller')

// PATCH /precios/:id — Actualizar solo campos de precio de un producto
// Protegido por requireRole a nivel de app.js (PRECIOS, ADMIN_SUCURSAL, SUPERADMIN)
router.patch('/:id', actualizarPrecios)

module.exports = router
