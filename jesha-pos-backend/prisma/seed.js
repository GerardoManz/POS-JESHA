require('dotenv').config()
const bcrypt = require('bcrypt')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Iniciando seed...')

  const sucursal = await prisma.sucursal.upsert({
    where: { id: 1 },
    update: {},
    create: {
      nombre: 'Ferretería JESHA - Matriz',
      direccion: 'Dirección principal',
      telefono: '000-000-0000',
      codigoPostal: '98000'
    }
  })
  console.log(`✅ Sucursal: ${sucursal.nombre}`)

  const hash = await bcrypt.hash('Admin2024!', 12)

  await prisma.usuario.upsert({
    where: { username: 'superadmin' },
    update: {},
    create: {
      nombre: 'Administrador JESHA',
      username: 'superadmin',
      passwordHash: hash,
      rol: 'SUPERADMIN',
      sucursalId: null
    }
  })

  await prisma.usuario.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      nombre: 'Admin Sucursal',
      username: 'admin',
      passwordHash: hash,
      rol: 'ADMIN_SUCURSAL',
      sucursalId: sucursal.id
    }
  })

  console.log('✅ Usuarios creados')
  console.log('🔑 superadmin / Admin2024!')
  console.log('🔑 admin / Admin2024!')
}

main().catch(console.error).finally(() => prisma.$disconnect())