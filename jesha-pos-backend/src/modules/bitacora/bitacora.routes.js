// src/modules/bitacora/bitacora.routes.js
const router = require('express').Router()
const c      = require('./bitacora.controller')
const tk     = require('./ticketAbono.controller')

// Lectura
router.get('/',                             c.listar)
router.get('/:id',                          c.obtener)

// Creación (solo bitácoras MANUAL)
router.post('/',                            c.crear)

// Edición de cabecera
router.patch('/:id',                        c.editar)

// Cierre manual / Reapertura (según estado enviado)
router.patch('/:id/estado',                 c.cambiarEstado)

// Productos (solo en bitácoras MANUAL)
router.post('/:id/productos',               c.agregarProducto)
router.patch('/:id/productos/:detalleId',   c.editarDetalle)
router.delete('/:id/productos/:detalleId',  c.quitarProducto)

// Abonos
router.post('/:id/abonos',                  c.registrarAbono)

// Ticket de abono imprimible (HTML 58mm)
router.get('/abonos/:abonoId/ticket',       tk.generarTicketAbono)

module.exports = router