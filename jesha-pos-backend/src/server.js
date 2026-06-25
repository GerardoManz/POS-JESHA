require('dotenv').config()

// ── Diagnóstico de conexión: a qué base apunta ESTE proceso ──
// Salvaguarda contra arrancar accidentalmente contra producción.
;(() => {
  try {
    const u = new URL(process.env.DATABASE_URL || 'http://none')
    const esRemota = !['localhost', '127.0.0.1'].includes(u.hostname)
    console.log(`🗄️  DB → host=${u.hostname} port=${u.port || '5432'} db=${u.pathname.slice(1)}`)
    console.log(`🌱 NODE_ENV=${process.env.NODE_ENV || '(sin definir)'}`)
    if (esRemota && process.env.NODE_ENV !== 'production') {
      console.warn('⚠️  ATENCIÓN: estás en desarrollo pero la DB es REMOTA. Verifica que no estés tocando producción.')
    }
  } catch {
    console.error('❌ DATABASE_URL inválida o ausente en .env')
  }
})()

const app  = require('./app')
const PORT = process.env.PORT || 3000

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor JESHA POS corriendo en http://0.0.0.0:${PORT}`)
  console.log(`   Local:    http://localhost:${PORT}`)
  console.log(`   Red WiFi: http://<tu-ip>:${PORT}`)
})

server.keepAliveTimeout = 65000
server.headersTimeout = 66000

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err)
})