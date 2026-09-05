// src/modules/bitacora/bitacora.routes.js
const router = require('express').Router()
const c      = require('./bitacora.controller')
const tk     = require('./ticketAbono.controller')
const tm     = require('./ticketMateriales.controller')
const rp     = require('./reporte.controller')
const { requireRole } = require('../../middlewares/auth.middleware')

const ROLES_OPERATIVOS = ['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO']

// Lectura
router.get('/',                             c.listar)
router.get('/:id',                          c.obtener)

// Creación (solo bitácoras MANUAL)
router.post('/',                            requireRole(...ROLES_OPERATIVOS), c.crear)

// Edición de cabecera
router.patch('/:id',                        requireRole(...ROLES_OPERATIVOS), c.editar)

// Descuento global de bitácora
router.patch('/:id/descuento',              requireRole(...ROLES_OPERATIVOS), c.aplicarDescuento)

// Cierre manual / Cancelación / Reapertura (según estado enviado)
router.patch('/:id/estado',                 requireRole(...ROLES_OPERATIVOS), c.cambiarEstado)

// Eliminar (solo CANCELADA)
router.delete('/:id',                       requireRole(...ROLES_OPERATIVOS), c.eliminar)

// Productos (solo en bitácoras MANUAL)
router.post('/:id/productos/batch',         requireRole(...ROLES_OPERATIVOS), c.agregarProductosBatch)
router.post('/:id/productos',               requireRole(...ROLES_OPERATIVOS), c.agregarProducto)
router.patch('/:id/productos/:detalleId',   requireRole(...ROLES_OPERATIVOS), c.editarDetalle)
router.delete('/:id/productos/:detalleId',  requireRole(...ROLES_OPERATIVOS), c.quitarProducto)

// Abonos
router.post('/:id/abonos',                  requireRole(...ROLES_OPERATIVOS), c.registrarAbono)

// Contexto de cobranza para POS (solo bitácoras VENTA ABIERTA)
router.get('/:id/contexto-cobranza',        c.contextoCobranza)

// Ticket de abono imprimible (HTML 58mm)
router.get('/abonos/:abonoId/ticket',       tk.generarTicketAbono)

// Ticket de materiales / vale (HTML 58mm) — desde borrador o detalleIds, no guarda en BD
router.post('/:id/ticket-materiales',       requireRole(...ROLES_OPERATIVOS), tm.generarTicketMateriales)

// Reporte completo (HTML A4) — todos los productos + resumen financiero + descuento
router.get('/:id/reporte',                  rp.generarReporte)

// Ticket de retiro específico (HTML 58mm) — desde lote ya guardado
router.get('/:id/retiros/:retiroId/ticket',  tm.generarTicketRetiro)

module.exports = router
