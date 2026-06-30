-- ════════════════════════════════════════════════════════════════════
--  FASE 1 — PrintJob: cola de impresión térmica
--  Ejecutar en pgAdmin (local) y DBeaver (prod) ANTES de prisma generate
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Crear enums (idempotentes con DO $$ guard)
DO $$ BEGIN
  CREATE TYPE "PrintJobTipo" AS ENUM ('VENTA', 'CORTE', 'ABONO', 'RETIRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PrintJobModo" AS ENUM ('ORIGINAL', 'COPIA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PrintJobEstado" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'ENVIADO_A_IMPRESORA', 'FALLIDO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Crear tabla PrintJob
CREATE TABLE IF NOT EXISTS "PrintJob" (
  "id"                SERIAL PRIMARY KEY,
  "empresaId"         INTEGER NOT NULL,
  "idempotencyKey"    TEXT NOT NULL,
  "tipo"              "PrintJobTipo" NOT NULL,
  "modo"              "PrintJobModo" NOT NULL DEFAULT 'ORIGINAL',
  "ventaId"           INTEGER,
  "turnoId"           INTEGER,
  "abonoId"           INTEGER,
  "retiroId"          INTEGER,
  "queueName"         TEXT NOT NULL DEFAULT 'printer-principal',
  "estado"            "PrintJobEstado" NOT NULL DEFAULT 'PENDIENTE',
  "intentos"          INTEGER NOT NULL DEFAULT 0,
  "payload"           JSONB NOT NULL DEFAULT '{}',
  "error"             TEXT,
  "creadoEn"          TIMESTAMP NOT NULL DEFAULT NOW(),
  "enviadoEn"         TIMESTAMP,
  "ultimoIntentoEn"   TIMESTAMP,

  CONSTRAINT "PrintJob_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "PrintJob_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id"),
  CONSTRAINT "PrintJob_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL
);

-- 3. Crear índices
CREATE INDEX IF NOT EXISTS "PrintJob_empresaId_estado_idx" ON "PrintJob"("empresaId", "estado");
CREATE INDEX IF NOT EXISTS "PrintJob_estado_creadoEn_idx" ON "PrintJob"("estado", "creadoEn");

COMMIT;

-- ═══ Verificación post-ejecución ═══
-- 1. Tabla creada
SELECT COUNT(*) AS total_print_jobs FROM "PrintJob";

-- 2. Estructura correcta (verificar columnas)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'PrintJob'
ORDER BY ordinal_position;

-- 3. Enums creados
SELECT typname FROM pg_type WHERE typname LIKE 'printjob%';
