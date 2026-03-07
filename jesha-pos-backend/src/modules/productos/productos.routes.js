// ═══════════════════════════════════════════════════════════════════
// PRODUCTOS.ROUTES.JS
// FIX: requireAuth importado del middleware, no redefinido localmente
// ═══════════════════════════════════════════════════════════════════

const express = require('express')
const router = express.Router()
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const { requireAuth } = require('../../middlewares/auth.middleware')
const productosController = require('./productos.controller')

// ═══════════════════════════════════════════════════════════════════
// MULTER — subida de imágenes en memoria
// ═══════════════════════════════════════════════════════════════════

const upload = multer({
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
// DEPARTAMENTOS Y CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

router.get('/departamentos', requireAuth, productosController.listarDepartamentos)
router.get('/categorias',    requireAuth, productosController.listarCategorias)

// ═══════════════════════════════════════════════════════════════════
// CRUD PRODUCTOS
// ═══════════════════════════════════════════════════════════════════

router.get('/',          requireAuth, productosController.listar)
router.get('/:id',       requireAuth, productosController.obtener)
router.post('/',         requireAuth, productosController.crear)
router.put('/:id',       requireAuth, productosController.editar)
router.patch('/:id/estado', requireAuth, productosController.cambiarEstado)

// ═══════════════════════════════════════════════════════════════════
// SUBIR IMAGEN
// ═══════════════════════════════════════════════════════════════════

router.post('/:id/imagen', requireAuth, upload.single('imagen'), async (req, res) => {
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

module.exports = router