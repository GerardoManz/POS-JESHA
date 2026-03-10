// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.ROUTES.JS (CORREGIDO)
// ═══════════════════════════════════════════════════════════════════

const express = require('express')
const router = express.Router()
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const productosController = require('./productos.controller')
const importacionController = require('./importacion.controller')

// ═══════════════════════════════════════════════════════════════════
// MULTER — PARA IMÁGENES
// ═══════════════════════════════════════════════════════════════════

const uploadImagen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp']
    if (permitidos.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Solo JPEG, PNG o WebP permitidos'))
    }
  }
})

// ═══════════════════════════════════════════════════════════════════
// MULTER — PARA ARCHIVOS CSV
// ═══════════════════════════════════════════════════════════════════

const uploadCSV = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    if (permitidos.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
      cb(null, true)
    } else {
      cb(new Error('Solo archivos CSV o Excel permitidos'))
    }
  }
})

// ═══════════════════════════════════════════════════════════════════
// DEPARTAMENTOS Y CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

router.get('/departamentos', productosController.listarDepartamentos)
router.get('/categorias',    productosController.listarCategorias)

// ═══════════════════════════════════════════════════════════════════
// CRUD PRODUCTOS
// ═══════════════════════════════════════════════════════════════════

router.get('/',          productosController.listar)
router.get('/:id',       productosController.obtener)
router.post('/',         productosController.crear)
router.put('/:id',       productosController.editar)
router.patch('/:id/estado', productosController.cambiarEstado)

// ═══════════════════════════════════════════════════════════════════
// SUBIR IMAGEN
// ═══════════════════════════════════════════════════════════════════

router.post('/:id/imagen', uploadImagen.single('imagen'), async (req, res) => {
  try {
    const { id } = req.params

    if (!req.file) {
      return res.status(400).json({ error: 'Imagen requerida' })
    }

    const dirProductos = path.join(__dirname, '../../public/imagenes/productos')
    if (!fs.existsSync(dirProductos)) {
      fs.mkdirSync(dirProductos, { recursive: true })
    }

    const nombreImagen = `${id}-${Date.now()}.webp`
    const rutaImagen = path.join(dirProductos, nombreImagen)

    await sharp(req.file.buffer)
      .resize(800, 800, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
      .webp({ quality: 80 })
      .toFile(rutaImagen)

    const urlImagen = `/imagenes/productos/${nombreImagen}`
    const producto = await productosController.actualizarImagen(id, urlImagen)

    res.json({ mensaje: 'Imagen subida exitosamente', imagenUrl: urlImagen, producto })
  } catch (err) {
    console.error('❌ Error subiendo imagen:', err)
    res.status(400).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════
// IMPORTACIÓN CSV
// ═══════════════════════════════════════════════════════════════════

router.post('/importar/csv', uploadCSV.single('archivo'), importacionController.importarCSV)

// ═══════════════════════════════════════════════════════════════════
// EXPORTAR
// ═══════════════════════════════════════════════════════════════════

module.exports = router