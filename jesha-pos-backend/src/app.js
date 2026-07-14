// ════════════════════════════════════════════════════════════════════
// APP.JS
// ════════════════════════════════════════════════════════════════════
require('dotenv').config()
require('./lib/facturapi').assertFacturapiSeguro()
const { requireAuth, requireRole } = require('./middlewares/auth.middleware')
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
  process.env.FRONTEND_URL,     // ej: https://jesha-pos.netlify.app
  process.env.RENDER_EXTERNAL_URL, // ej: https://jesha-pos-api.onrender.com
].filter(Boolean)

  const isProduction = process.env.NODE_ENV === 'production'

  // Acepta cualquier IP privada de la LAN (puertos 3000/5500) SOLO en desarrollo.
  // En producción este comodín NO aplica: todo pasa por ALLOWED_ORIGINS/FRONTEND_URL.
  const LAN_ORIGIN_REGEX = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):(3000|5500)$/

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, apps nativas, mismo servidor)
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    if (!isProduction && LAN_ORIGIN_REGEX.test(origin)) return callback(null, true)
    callback(new Error(`CORS bloqueado: ${origin}`))
  },
  methods:        ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}))
app.use(express.json())

// ── Archivos estáticos del frontend ──
const frontendPath = path.join(__dirname, '../../')

// Guard de estáticos: el frontend vive en la raíz del repo (../../), que también
// contiene la carpeta del backend. Sin esto se servirían el código fuente, prisma/,
// package.json, AGENTS.md y seed.js (con contraseñas). Bloqueamos esas rutas.
const BLOQUEO_ESTATICO = /^\/(jesha-pos-backend|node_modules|\.git)(\/|$)|(^|\/)(AGENTS\.md|seed\.js|fix-password\.js)$/i
app.use((req, res, next) => {
  if (BLOQUEO_ESTATICO.test(decodeURIComponent(req.path))) return res.status(404).end()
  next()
})

app.use(express.static(frontendPath))

// ── Ruta especial: GET /facturar?token=... → sirve el HTML ──
app.get('/facturar', (req, res) => {
  res.sendFile(path.join(frontendPath, 'facturar.html'))
})

// ── Rutas PÚBLICAS del API ──
app.use('/auth',          require('./modules/auth/auth.routes'))
app.use('/facturar/api',  require('./modules/facturacion/facturacion.routes'))

const { generarTicketAbono } = require('./modules/bitacora/ticketAbono.controller')
const abonosRouter = require('express').Router()
abonosRouter.get('/ticket', generarTicketAbono)
app.use('/abonos', abonosRouter)

// ── Rutas protegidas ──
app.use('/facturas',     requireAuth, require('./modules/facturas/facturas.routes'))
app.use('/usuarios',     requireAuth, require('./modules/usuarios/usuarios.routes'))
app.use('/clientes',     requireAuth, require('./modules/clientes/clientes.routes'))
app.use('/productos',    requireAuth, require('./modules/productos/productos.routes'))
app.use('/inventario',   requireAuth, require('./modules/inventario/inventario.routes'))
app.use('/ventas',       requireAuth, require('./modules/ventas/ventas.routes'))
app.use('/turnos-caja',  requireAuth, require('./modules/turnos-caja/turnos-caja.routes'))
app.use('/cotizaciones', requireAuth, require('./modules/cotizaciones/cotizaciones.routes'))
app.use('/pedidos',      requireAuth, require('./modules/pedidos/pedidos.routes'))
app.use('/proveedores',  requireAuth, require('./modules/proveedores/proveedores.routes'))
app.use('/bitacoras',    requireAuth, require('./modules/bitacora/bitacora.routes'))
app.use('/compras',      requireAuth, require('./modules/compras/compras.routes'))
app.use('/devoluciones', requireAuth, require('./modules/devoluciones/devoluciones.routes'))
app.use('/reportes', requireAuth, require('./modules/reportes/reporte-stock.routes'))
app.use('/sucursales', requireAuth, require('./modules/sucursal/sucursal.routes'))
app.use('/trabajadores', requireAuth, require('./modules/trabajadores/trabajadores.routes'))
app.use('/impresion',    require('./modules/impresion/impresion.routes')) // rutas de agente + frontend, auth interna
app.use('/precios',     requireAuth, requireRole('PRECIOS', 'ADMIN_SUCURSAL', 'SUPERADMIN', 'PLATFORM_ADMIN'), require('./modules/precios/precios.routes'))

// ── Imágenes de productos ──
app.use('/imagenes', express.static(path.join(__dirname, 'public/imagenes')))

// ── Health checks ──
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.get('/health/db', async (req, res) => {
  try {
    const prisma = require('./lib/prisma')
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('Health/DB error:', err.message)
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message })
  }
})

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('Error:', err)
  res.status(500).json({ error: 'Error interno' })
})

module.exports = app
