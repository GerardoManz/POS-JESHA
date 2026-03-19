// ════════════════════════════════════════════════════════════════════
//  APP.JS
// ════════════════════════════════════════════════════════════════════

require('dotenv').config()
const { requireAuth } = require('./middlewares/auth.middleware')
const express = require('express')
const cors    = require('cors')
const path    = require('path')

const app = express()

app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}))
app.use(express.json())

// ── Archivos estáticos del frontend ──
const frontendPath = path.join(__dirname, '../../')
app.use(express.static(frontendPath))

// ── Ruta especial: GET /facturar?token=... → sirve el HTML ──
// POST /facturar sigue siendo el API para guardar la solicitud
app.get('/facturar', (req, res) => {
  res.sendFile(path.join(frontendPath, 'facturar.html'))
})

// ── Rutas PÚBLICAS del API ──
app.use('/auth',         require('./modules/auth/auth.routes'))
app.use('/facturar/api', require('./modules/facturacion/facturacion.routes'))

// ── Rutas protegidas ──
app.use('/usuarios',    requireAuth, require('./modules/usuarios/usuarios.routes'))
app.use('/clientes',    requireAuth, require('./modules/clientes/clientes.routes'))
app.use('/productos',   requireAuth, require('./modules/productos/productos.routes'))
app.use('/ventas',      requireAuth, require('./modules/ventas/ventas.routes'))
app.use('/turnos-caja', requireAuth, require('./modules/turnos-caja/turnos-caja.routes'))
app.use('/cotizaciones',requireAuth, require('./modules/cotizaciones/cotizaciones.routes'))
app.use('/pedidos',     requireAuth, require('./modules/pedidos/pedidos.routes'))
app.use('/bitacoras',   requireAuth, require('./modules/bitacora/bitacora.routes'))
app.use('/compras',     requireAuth, require('./modules/compras/compras.routes'))

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