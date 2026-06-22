// src/modules/bitacora/bitacora.routes.js
const router = require('express').Router()
const c      = require('./bitacora.controller')
const tk     = require('./ticketAbono.controller')
const tm     = require('./ticketMateriales.controller')

// Lectura
router.get('/',                             c.listar)
router.get('/:id',                          c.obtener)

// Creación (solo bitácoras MANUAL)
router.post('/',                            c.crear)

// Edición de cabecera
router.patch('/:id',                        c.editar)

// Cierre manual / Cancelación / Reapertura (según estado enviado)
router.patch('/:id/estado',                 c.cambiarEstado)

// Eliminar (solo CANCELADA)
router.delete('/:id',                        c.eliminar)

// Productos (solo en bitácoras MANUAL)
router.post('/:id/productos/batch',         c.agregarProductosBatch)
router.post('/:id/productos',               c.agregarProducto)
router.patch('/:id/productos/:detalleId',   c.editarDetalle)
router.delete('/:id/productos/:detalleId',  c.quitarProducto)

// Abonos
router.post('/:id/abonos',                  c.registrarAbono)

// Ticket de abono imprimible (HTML 58mm)
router.get('/abonos/:abonoId/ticket',       tk.generarTicketAbono)

// Ticket de materiales / vale (HTML 58mm) — desde borrador o detalleIds, no guarda en BD
router.post('/:id/ticket-materiales',        tm.generarTicketMateriales)

// Ticket de retiro específico (HTML 58mm) — desde lote ya guardado
router.get('/:id/retiros/:retiroId/ticket',  tm.generarTicketRetiro)

module.exports = router