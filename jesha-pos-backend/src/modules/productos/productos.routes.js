// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.ROUTES.JS — CON CLOUDINARY
// Cambios: quitados path/fs/sharp, handler de imagen simplificado
// ═══════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const multer  = require('multer')

const { requireRole } = require('../../middlewares/auth.middleware')
const { requestContext } = require('../../middlewares/request-context.middleware')
const { tenantGlobal, branchOptional } = require('../../middlewares/scope.middleware')

const productosController   = require('./productos.controller')
const productosRapidoController = require('./productos.rapido.controller')
const importacionController = require('./importacion.controller')
const satController         = require('./productos.sat.controller')
const { subirImagenProducto } = require('../../lib/cloudinary')

// ═══════════════════════════════════════════════════════════════════
// MULTER — IMÁGENES (memoryStorage para enviar buffer a Cloudinary)
// ═══════════════════════════════════════════════════════════════════

const uploadImagen = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const permitidos = ['image/jpeg', 'image/png', 'image/webp']
        if (permitidos.includes(file.mimetype)) cb(null, true)
        else cb(new Error('Solo JPEG, PNG o WebP permitidos'))
    }
})

// ═══════════════════════════════════════════════════════════════════
// MULTER — CSV (sin cambios)
// ═══════════════════════════════════════════════════════════════════

const uploadCSV = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const mimePermitidos = [
            'text/csv',
            'application/vnd.ms-excel',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]
        if (mimePermitidos.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
            cb(null, true)
        } else {
            cb(new Error('Solo archivos CSV permitidos'))
        }
    }
})

// ═══════════════════════════════════════════════════════════════════
// CONTEXTO TENANT — requestContext hidrata req.context (inmutable).
// El scope se aplica por ruta: catalog/CRUD es TENANT_GLOBAL;
// lecturas con existencias son BRANCH_OPTIONAL.
// ═══════════════════════════════════════════════════════════════════

router.use(requestContext)

// ═══════════════════════════════════════════════════════════════════
// DEPARTAMENTOS Y CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

router.get('/departamentos',     tenantGlobal, productosController.listarDepartamentos)
router.post('/departamentos',    tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.crearDepartamento)
router.get('/categorias',        tenantGlobal, productosController.listarCategorias)
router.get('/departamentos/:departamentoId/categorias', tenantGlobal, productosController.categoriasPorDepartamento)
router.post('/categorias',       tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.crearCategoria)

// ═══════════════════════════════════════════════════════════════════
// IMPORTACIÓN CSV — FUERA_DE_ALCANCE (escribe inventario + movimientos)
// ═══════════════════════════════════════════════════════════════════

router.post('/importar/csv',            requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), uploadCSV.single('archivo'), importacionController.importarCSV)
router.post('/importar/solo-nuevos',    requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), uploadCSV.single('archivo'), importacionController.importarSoloNuevos)
// ═══════════════════════════════════════════════════════════════════
// CRUD PRODUCTOS
// ═══════════════════════════════════════════════════════════════════

router.get('/',                    branchOptional, productosController.listar)

// GET /productos/sat/unidades — catálogo SAT + unidades operativas para dropdowns
router.get('/sat/unidades',        tenantGlobal, satController.listarUnidades)

// POST /productos/articulo-rapido — FUERA_DE_ALCANCE (crea inventario + movimiento)
router.post('/articulo-rapido',   productosRapidoController.crearArticuloRapido)

// GET /productos/sugerir — Autocomplete (ANTES de /:id para que no capture "sugerir" como :id)
router.get('/sugerir', branchOptional, productosController.sugerirNombres)

// GET /productos/exportar/excel — Exportación XLSX de todos los productos filtrados (ANTES de /:id)
router.get('/exportar/excel', branchOptional, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.exportarExcel)

// GET /productos/:id — Obtener producto individual (incluye existencias por sucursal)
router.get('/:id', branchOptional, productosController.obtener)

router.post('/',                 tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.crear)
router.put('/:id',               tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.editar)
router.patch('/:id/datos-basicos', tenantGlobal, requireRole('EMPLEADO', 'ADMIN_SUCURSAL', 'SUPERADMIN'), productosController.editarDatosBasicos)
router.patch('/:id/estado',      tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.cambiarEstado)
router.patch('/:id/inventario',  requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.ajustarInventario)
router.post('/:id/duplicar',     tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.duplicarProducto)

// ═══════════════════════════════════════════════════════════════════
// SUGERENCIA SAT (read-only, sin requireRole: cualquier usuario autenticado)
// ═══════════════════════════════════════════════════════════════════

router.post('/sat/sugerir', tenantGlobal, satController.sugerirSat)

// ═══════════════════════════════════════════════════════════════════
// IMAGEN — SUBIR (ahora va a Cloudinary, sin tocar disco)
// ═══════════════════════════════════════════════════════════════════

router.post('/:id/imagen', tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), uploadImagen.single('imagen'), async (req, res) => {
    try {
        const { id } = req.params

        if (!req.file) return res.status(400).json({ error: 'Imagen requerida' })

        // Sube a Cloudinary (resize + WebP los hace Cloudinary, no nosotros)
        const { url, public_id } = await subirImagenProducto(req.file.buffer, id)

        // Guarda url + public_id en BD (scoped por empresa desde el contexto)
        const producto = await productosController.actualizarImagen(id, req, { url, public_id })

        res.json({
            mensaje:    'Imagen subida exitosamente',
            imagenUrl:  url,
            producto
        })
    } catch (err) {
        console.error('❌ Error subiendo imagen:', err)
        const status = err.statusCode || 400
        res.status(status).json({ error: err.message })
    }
})

// ═══════════════════════════════════════════════════════════════════
// IMAGEN — ELIMINAR (opcional, listo para usar cuando lo conectes al frontend)
// ═══════════════════════════════════════════════════════════════════

router.delete('/:id/imagen', tenantGlobal, requireRole('SUPERADMIN', 'ADMIN_SUCURSAL'), productosController.eliminarImagen)

module.exports = router
