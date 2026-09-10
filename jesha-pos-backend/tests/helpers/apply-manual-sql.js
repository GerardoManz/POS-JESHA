'use strict'

// Helper P0 — aplica las fuentes SQL versionadas de prisma/manual-sql/.
// -----------------------------------------------------------------------
// Los tests NO reparan silenciosamente la BD: la estructura que Prisma no
// puede expresar (secuencias de folio, índice parcial de FacturaCfdi,
// NOT NULL de Bitacora) proviene de estos archivos, parte obligatoria del
// proceso de creación de una DB JESHA (ver AGENTS.md → "manual-sql").
//
// Uso:
//   const { applyManualSql } = require('./helpers/apply-manual-sql')
//   await applyManualSql((sql) => prisma.$executeRawUnsafe(sql))
//
// El executor debe ejecutar UNA sola sentencia SQL a la vez. Cada archivo
// de manual-sql/ es exactamente una sentencia (DO $$...$$ o un CREATE), por
// lo que pueden aplicarse vía pg.Client.query() o prisma.$executeRawUnsafe.

const fs = require('node:fs')
const path = require('node:path')

const MANUAL_SQL_DIR = path.resolve(__dirname, '../../prisma/manual-sql')

async function applyManualSql(executor) {
  const files = fs
    .readdirSync(MANUAL_SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MANUAL_SQL_DIR, file), 'utf8')
    await executor(sql)
  }
}

module.exports = { applyManualSql, MANUAL_SQL_DIR }