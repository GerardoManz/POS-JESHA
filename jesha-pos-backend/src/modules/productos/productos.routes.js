// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.ROUTES.JS — CON CLOUDINARY
// Cambios: quitados path/fs/sharp, handler de imagen simplificado
// ═══════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const multer  = require('multer')

const { requireRole } = require('../../middlewares/auth.middleware')

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
// DEPARTAMENTOS Y CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

router.get('/departamentos',     productosController.listarDepartamentos)
router.post('/departamentos',    requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), productosController.crearDepartamento)
router.get('/categorias',        productosController.listarCategorias)
router.get('/departamentos/:departamentoId/categorias', productosController.categoriasPorDepartamento)
router.post('/categorias',       requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), productosController.crearCategoria)

// ═══════════════════════════════════════════════════════════════════
// IMPORTACIÓN CSV
// ═══════════════════════════════════════════════════════════════════

router.post('/importar/csv',            requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), uploadCSV.single('archivo'), importacionController.importarCSV)
router.post('/importar/solo-nuevos',    requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), uploadCSV.single('archivo'), importacionController.importarSoloNuevos)
// ═══════════════════════════════════════════════════════════════════
// CRUD PRODUCTOS
// ═══════════════════════════════════════════════════════════════════

router.get('/',                    productosController.listar)

// GET /productos/sat/unidades — catálogo SAT + unidades operativas para dropdowns
router.get('/sat/unidades',        satController.listarUnidades)

// POST /productos/articulo-rapido — alta rápida desde POS (cualquier usuario autenticado)
router.post('/articulo-rapido',   productosRapidoController.crearArticuloRapido)

// GET /productos/:id — Obtener producto individual
router.get('/:id', productosController.obtener)

router.post('/',                 requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), productosController.crear)
router.put('/:id',               requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), productosController.editar)
router.patch('/:id/datos-basicos', requireRole('EMPLEADO', 'ADMIN_SUCURSAL', 'SUPERADMIN', 'PLATFORM_ADMIN'), productosController.editarDatosBasicos)
router.patch('/:id/estado',      requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), productosController.cambiarEstado)
router.patch('/:id/inventario',  requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), productosController.ajustarInventario)

// ═══════════════════════════════════════════════════════════════════
// SUGERENCIA SAT (read-only, sin requireRole: cualquier usuario autenticado)
// ═══════════════════════════════════════════════════════════════════

router.post('/sat/sugerir', satController.sugerirSat)

// ═══════════════════════════════════════════════════════════════════
// IMAGEN — SUBIR (ahora va a Cloudinary, sin tocar disco)
// ═══════════════════════════════════════════════════════════════════

router.post('/:id/imagen', requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), uploadImagen.single('imagen'), async (req, res) => {
    try {
        const { id } = req.params

        if (!req.file) return res.status(400).json({ error: 'Imagen requerida' })

        // Sube a Cloudinary (resize + WebP los hace Cloudinary, no nosotros)
        const { url, public_id } = await subirImagenProducto(req.file.buffer, id)

        // Guarda url + public_id en BD
        const producto = await productosController.actualizarImagen(id, { url, public_id })

        res.json({
            mensaje:    'Imagen subida exitosamente',
            imagenUrl:  url,
            producto
        })
    } catch (err) {
        console.error('❌ Error subiendo imagen:', err)
        res.status(400).json({ error: err.message })
    }
})

// ═══════════════════════════════════════════════════════════════════
// IMAGEN — ELIMINAR (opcional, listo para usar cuando lo conectes al frontend)
// ═══════════════════════════════════════════════════════════════════

router.delete('/:id/imagen', requireRole('SUPERADMIN', 'ADMIN_SUCURSAL', 'PLATFORM_ADMIN'), productosController.eliminarImagen)

module.exports = router
