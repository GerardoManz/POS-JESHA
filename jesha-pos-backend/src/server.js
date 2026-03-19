require('dotenv').config()
const app  = require('./app')
const PORT = process.env.PORT || 3000

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor JESHA POS corriendo en http://0.0.0.0:${PORT}`)
  console.log(`   Local:    http://localhost:${PORT}`)
  console.log(`   Red WiFi: http://<tu-ip>:${PORT}`)
})