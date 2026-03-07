require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcrypt')

const prisma = new PrismaClient()

async function seed() {
  try {
    console.log('🌱 Iniciando seed de datos...\n')

    // Verificar conexión
    const ping = await prisma.usuario.count()
    console.log(`✅ BD conectada (${ping} usuarios actuales)`)

    // Crear usuarios de prueba
    const usuarios = [
      {
        username: 'admin',
        password: 'admin123',
        nombre: 'Administrador General',
        rol: 'SUPERADMIN',
        sucursalId: null // SUPERADMIN no tiene sucursal
      },
      {
        username: 'vendedor',
        password: 'vendedor123',
        nombre: 'Vendedor Demo',
        rol: 'EMPLEADO',
        sucursalId: null // se asignará a sucursal 1 si existe
      }
    ]

    console.log('\n📝 Creando usuarios...\n')

    for (const user of usuarios) {
      try {
        const hashedPassword = await bcrypt.hash(user.password, 10)

        const newUser = await prisma.usuario.create({
          data: {
            username: user.username,
            nombre: user.nombre,
            passwordHash: hashedPassword,
            rol: user.rol,
            sucursalId: user.sucursalId,
            activo: true
          }
        })

        console.log(`✅ Usuario creado: @${user.username}`)
        console.log(`   Nombre: ${user.nombre}`)
        console.log(`   Rol: ${user.rol}\n`)

      } catch (err) {
        if (err.code === 'P2002') {
          console.log(`⚠️  Usuario @${user.username} ya existe, saltando...\n`)
        } else {
          throw err
        }
      }
    }

    console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓')
    console.log('┃  📊 USUARIOS DE PRUEBA CREADOS     ┃')
    console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛')
    console.log('\n👤 ADMINISTRADOR')
    console.log('   Usuario: admin')
    console.log('   Contraseña: admin123')
    console.log('   Rol: SUPERADMIN (acceso total)')
    console.log('\n👤 VENDEDOR')
    console.log('   Usuario: vendedor')
    console.log('   Contraseña: vendedor123')
    console.log('   Rol: EMPLEADO (vendedor normal)')
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    console.log('✨ Seed completado exitosamente')
    console.log('🚀 Ya puedes iniciar sesión en login.html\n')

  } catch (error) {
    console.error('❌ Error en seed:', error.message)
    console.error('\nPosibles causas:')
    console.error('  1. BD no está conectada')
    console.error('  2. Falta ejecutar: npx prisma migrate dev')
    console.error('  3. Faltan dependencias: npm install')
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

seed()