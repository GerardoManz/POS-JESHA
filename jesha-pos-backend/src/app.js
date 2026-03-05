require('dotenv').config()
const express = require('express')
const cors = require('cors')

const app = express()

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json())

app.use('/auth', require('./modules/auth/auth.routes'))
app.use('/usuarios', require('./modules/usuarios/usuarios.routes'))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` })
})

app.use((err, req, res, next) => {
  console.error('Error no controlado:', err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

module.exports = app