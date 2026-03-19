// ════════════════════════════════════════════════════════════════════
//  APP.JS
// ════════════════════════════════════════════════════════════════════
require('dotenv').config()
const { requireAuth } = require('./middlewares/auth.middleware')
const express = require('express')
const cors    = require('cors')
const path    = require('path')
const app     = express()

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }))
app.use(express.json())

app.use('/auth',       require('./modules/auth/auth.routes'))

app.use('/usuarios',    requireAuth, require('./modules/usuarios/usuarios.routes'))
app.use('/clientes',    requireAuth, require('./modules/clientes/clientes.routes'))
app.use('/productos',   requireAuth, require('./modules/productos/productos.routes'))
app.use('/ventas',      requireAuth, require('./modules/ventas/ventas.routes'))
app.use('/turnos-caja', requireAuth, require('./modules/turnos-caja/turnos-caja.routes'))
app.use('/cotizaciones',requireAuth, require('./modules/cotizaciones/cotizaciones.routes'))
app.use('/pedidos',     requireAuth, require('./modules/pedidos/pedidos.routes'))
app.use('/bitacoras',   requireAuth, require('./modules/bitacora/bitacora.routes'))
app.use('/compras',     requireAuth, require('./modules/compras/compras.routes'))

app.use('/imagenes', express.static(path.join(__dirname, 'public/imagenes')))
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.use((req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` }))
app.use((err, req, res, next) => { console.error('Error:', err); res.status(500).json({ error: 'Error interno' }) })

module.exports = app

app.use('/facturar', require('./modules/facturacion/facturacion.routes'))
