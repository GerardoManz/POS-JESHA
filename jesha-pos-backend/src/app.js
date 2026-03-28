// ════════════════════════════════════════════════════════════════════
// APP.JS
// ════════════════════════════════════════════════════════════════════
require('dotenv').config()
const { requireAuth } = require('./middlewares/auth.middleware')
const express = require('express')
const cors    = require('cors')
const path    = require('path')
const app     = express()

// Orígenes permitidos — agrega tu URL de ngrok aquí si la necesitas
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://192.168.0.190:3000',
  process.env.NGROK_URL,        // ej: https://tu-url.ngrok-free.dev
  process.env.FRONTEND_URL,     // para producción futura
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, apps nativas, mismo servidor)
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    callback(new Error(`CORS bloqueado: ${origin}`))
  },
  methods:        ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}))
app.use(express.json())

// ── Archivos estáticos del frontend ──
const frontendPath = path.join(__dirname, '../../')
app.use(express.static(frontendPath))

// ── Ruta especial: GET /facturar?token=... → sirve el HTML ──
app.get('/facturar', (req, res) => {
  res.sendFile(path.join(frontendPath, 'facturar.html'))
})

// ── Rutas PÚBLICAS del API ──
app.use('/auth',          require('./modules/auth/auth.routes'))
app.use('/facturar/api',  require('./modules/facturacion/facturacion.routes'))

// ── Rutas protegidas ──
app.use('/facturas',     requireAuth, require('./modules/facturas/facturas.routes'))
app.use('/usuarios',     requireAuth, require('./modules/usuarios/usuarios.routes'))
app.use('/clientes',     requireAuth, require('./modules/clientes/clientes.routes'))
app.use('/productos',    requireAuth, require('./modules/productos/productos.routes'))
app.use('/ventas',       requireAuth, require('./modules/ventas/ventas.routes'))
app.use('/turnos-caja',  requireAuth, require('./modules/turnos-caja/turnos-caja.routes'))
app.use('/cotizaciones', requireAuth, require('./modules/cotizaciones/cotizaciones.routes'))
app.use('/pedidos',      requireAuth, require('./modules/pedidos/pedidos.routes'))
app.use('/bitacoras',    requireAuth, require('./modules/bitacora/bitacora.routes'))
app.use('/compras',      requireAuth, require('./modules/compras/compras.routes'))
app.use('/devoluciones', requireAuth, require('./modules/devoluciones/devoluciones.routes'))

// ── Imágenes de productos ──
app.use('/imagenes', express.static(path.join(__dirname, 'public/imagenes')))

// ── Health check ──
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('Error:', err)
  res.status(500).json({ error: 'Error interno' })
})

module.exports = app