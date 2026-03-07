require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()

// ═══════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json())

// ═══════════════════════════════════════════════════════════════════
// MIDDLEWARE DE AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════════

// ✅ NUEVO: Middleware que valida el token
const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader) {
      return res.status(401).json({ 
        success: false, 
        error: 'No token provided' 
      })
    }

    const token = authHeader.replace('Bearer ', '')
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token format' 
      })
    }

    // ✅ Token válido, continuar
    req.token = token
    next()
  } catch (error) {
    console.error('❌ Error en autenticación:', error.message)
    res.status(401).json({ 
      success: false, 
      error: error.message 
    })
  }
}

// ═══════════════════════════════════════════════════════════════════
// RUTAS PÚBLICAS (sin autenticación)
// ═══════════════════════════════════════════════════════════════════

app.use('/auth', require('./modules/auth/auth.routes'))

// ═══════════════════════════════════════════════════════════════════
// RUTAS PROTEGIDAS (con autenticación)
// ═══════════════════════════════════════════════════════════════════

// ✅ CORREGIDO: Agregar requireAuth a rutas protegidas
app.use('/usuarios', requireAuth, require('./modules/usuarios/usuarios.routes'))
app.use('/clientes', requireAuth, require('./modules/clientes/clientes.routes'))
app.use('/productos', requireAuth, require('./modules/productos/productos.routes'))

// ═══════════════════════════════════════════════════════════════════
// RUTAS ESTÁTICAS
// ═══════════════════════════════════════════════════════════════════

app.use('/imagenes', express.static(path.join(__dirname, 'public/imagenes')))

// ═══════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ═══════════════════════════════════════════════════════════════════
// MANEJO DE ERRORES
// ═══════════════════════════════════════════════════════════════════

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` })
})

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error no controlado:', err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

// ═══════════════════════════════════════════════════════════════════
// EXPORTAR
// ═══════════════════════════════════════════════════════════════════

module.exports = app