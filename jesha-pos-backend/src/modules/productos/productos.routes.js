// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.ROUTES.JS — CON CLOUDINARY
// Cambios: quitados path/fs/sharp, handler de imagen simplificado
// ═══════════════════════════════════════════════════════════════════

const express = require('express')
const router  = express.Router()
const multer  = require('multer')

const productosController   = require('./productos.controller')
const importacionController = require('./importacion.controller')
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
router.post('/departamentos',    productosController.crearDepartamento)
router.get('/categorias',        productosController.listarCategorias)
router.get('/departamentos/:departamentoId/categorias', productosController.categoriasPorDepartamento)
router.post('/categorias',       productosController.crearCategoria)

// ═══════════════════════════════════════════════════════════════════
// IMPORTACIÓN CSV
// ═══════════════════════════════════════════════════════════════════

router.post('/importar/csv',            uploadCSV.single('archivo'), importacionController.importarCSV)
router.post('/importar/solo-nuevos',    uploadCSV.single('archivo'), importacionController.importarSoloNuevos)
router.post('/importar/datos-fiscales', uploadCSV.single('archivo'), importacionController.actualizarDatosFiscales)

// ═══════════════════════════════════════════════════════════════════
// CRUD PRODUCTOS
// ═══════════════════════════════════════════════════════════════════

router.get('/',                    productosController.listar)

// GET /productos/:id — Venta específica
router.post('/',                 productosController.crear)
router.put('/:id',               productosController.editar)
router.patch('/:id/estado',      productosController.cambiarEstado)
router.patch('/:id/inventario',  productosController.ajustarInventario)

// ═══════════════════════════════════════════════════════════════════
// IMAGEN — SUBIR (ahora va a Cloudinary, sin tocar disco)
// ═══════════════════════════════════════════════════════════════════

router.post('/:id/imagen', uploadImagen.single('imagen'), async (req, res) => {
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

router.delete('/:id/imagen', productosController.eliminarImagen)

module.exports = router