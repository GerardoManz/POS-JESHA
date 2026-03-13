require('dotenv').config()
const { requireAuth } = require('./middlewares/auth.middleware')
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
app.use('/ventas',   requireAuth, require('./modules/ventas/ventas.routes'))
app.use('/turnos-caja', requireAuth, require('./modules/turnos-caja/turnos-caja.routes'))

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