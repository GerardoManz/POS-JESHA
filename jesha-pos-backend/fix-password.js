require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const bcrypt = require('bcryptjs')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function fixPasswords() {
  const hash = await bcrypt.hash('admin123', 10)
  await prisma.usuario.updateMany({
    where: { username: 'admin' },
    data: { passwordHash: hash }
  })
  console.log('✅ Password de admin actualizada')
  
  const hash2 = await bcrypt.hash('vendedor123', 10)
  await prisma.usuario.updateMany({
    where: { username: 'vendedor' },
    data: { passwordHash: hash2 }
  })
  console.log('✅ Password de vendedor actualizada')
  
  process.exit(0)
}

fixPasswords()