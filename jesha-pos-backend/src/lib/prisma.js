const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  maxLifetimeSeconds: 3600,
})

const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

module.exports = prisma
module.exports.pool = pool
