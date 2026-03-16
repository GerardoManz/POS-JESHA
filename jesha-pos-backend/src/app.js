// ════════════════════════════════════════════════════════════════════
//  APP.JS — ACTUALIZADO
//  Ubicación: src/app.js
//  Cambio: añadida ruta /cotizaciones
// ════════════════════════════════════════════════════════════════════

require('dotenv').config()
const { requireAuth } = require('./middlewares/auth.middleware')
const express = require('express')
const cors    = require('cors')
const path    = require('path')

const app = express()

// ════════════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ════════════════════════════════════════════════════════════════════

app.use(cors({
  origin:         '*',
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json())

// ════════════════════════════════════════════════════════════════════
//  RUTAS PÚBLICAS
// ════════════════════════════════════════════════════════════════════

app.use('/auth', require('./modules/auth/auth.routes'))

// ════════════════════════════════════════════════════════════════════
//  RUTAS PROTEGIDAS
// ════════════════════════════════════════════════════════════════════

app.use('/usuarios',     requireAuth, require('./modules/usuarios/usuarios.routes'))
app.use('/clientes',     requireAuth, require('./modules/clientes/clientes.routes'))
app.use('/productos',    requireAuth, require('./modules/productos/productos.routes'))
app.use('/ventas',       requireAuth, require('./modules/ventas/ventas.routes'))
app.use('/turnos-caja',  requireAuth, require('./modules/turnos-caja/turnos-caja.routes'))
app.use('/cotizaciones', requireAuth, require('./modules/cotizaciones/cotizaciones.routes'))

// ════════════════════════════════════════════════════════════════════
//  ESTÁTICOS
// ════════════════════════════════════════════════════════════════════

app.use('/imagenes', express.static(path.join(__dirname, 'public/imagenes')))

// ════════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ════════════════════════════════════════════════════════════════════
//  MANEJO DE ERRORES
// ════════════════════════════════════════════════════════════════════

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` })
})

app.use((err, req, res, next) => {
  console.error('❌ Error no controlado:', err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

module.exports = app