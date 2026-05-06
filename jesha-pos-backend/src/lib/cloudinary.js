// ═══════════════════════════════════════════════════════════════════
// CLOUDINARY — Instancia centralizada
// Configura el SDK una sola vez con las credenciales del entorno
// ═══════════════════════════════════════════════════════════════════

const { v2: cloudinary } = require('cloudinary')

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true
})

// Validación temprana — si falta alguna variable, falla rápido al iniciar
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('❌ Faltan variables de entorno de Cloudinary')
    throw new Error('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET son requeridas')
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Subir buffer a Cloudinary
// public_id determinístico → reemplaza automáticamente la imagen previa
// ═══════════════════════════════════════════════════════════════════

function subirImagenProducto(buffer, productoId) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder:    'jesha/productos',
                public_id: `producto_${productoId}`,
                overwrite: true,
                invalidate: true,
                resource_type: 'image',
                format: 'webp',
                transformation: [
                    { width: 800, height: 800, crop: 'limit' },
                    { quality: 'auto:good' }
                ]
            },
            (error, result) => {
                if (error) return reject(error)
                resolve({
                    url:       result.secure_url,
                    public_id: result.public_id
                })
            }
        )
        stream.end(buffer)
    })
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Eliminar imagen de Cloudinary
// (Opción suave — solo se llama cuando el usuario lo solicita explícitamente)
// ═══════════════════════════════════════════════════════════════════

async function eliminarImagenProducto(publicId) {
    if (!publicId) return null
    try {
        const result = await cloudinary.uploader.destroy(publicId, { invalidate: true })
        return result
    } catch (err) {
        console.error('⚠️  Error eliminando imagen de Cloudinary:', err.message)
        return null  // No bloqueamos al usuario si falla el delete remoto
    }
}

module.exports = {
    cloudinary,
    subirImagenProducto,
    eliminarImagenProducto
}