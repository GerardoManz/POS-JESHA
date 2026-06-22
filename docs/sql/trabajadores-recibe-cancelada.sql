-- ════════════════════════════════════════════════════════════════════
--  SQL MANUAL — TRABAJADORES + RECIBE + CANCELADA
--  Aplicar en orden: primero local (pgAdmin), luego producción (DBeaver)
--  PASO 1: Verificar conteo ANTES
--  PASO 2: Ejecutar SQL
--  PASO 3: Verificar conteo DESPUÉS
--  PASO 4: COMMIT (si usas BEGIN/COMMIT)
-- ════════════════════════════════════════════════════════════════════

-- VERIFICACIÓN PREVIA
SELECT count(*) AS detalle_bitacora_antes FROM "DetalleBitacora";
SELECT count(*) AS empresas_antes FROM "Empresa";

-- ============================================================
-- 1. AGREGAR 'CANCELADA' AL ENUM EstadoBitacora
--    PostgreSQL 9.6+ soporta ALTER TYPE ADD VALUE.
--    Esta línea NO puede ir dentro de un bloque BEGIN/COMMIT.
-- ============================================================
ALTER TYPE "EstadoBitacora" ADD VALUE IF NOT EXISTS 'CANCELADA';

-- ============================================================
-- 2. CREAR TABLA "Trabajador"
-- ============================================================
CREATE TABLE IF NOT EXISTS "Trabajador" (
    "id"         SERIAL       NOT NULL,
    "empresaId"  INTEGER      NOT NULL,
    "nombre"     VARCHAR(150) NOT NULL,
    "apodo"      VARCHAR(100),
    "telefono"   VARCHAR(50),
    "notas"      VARCHAR(500),
    "activo"     BOOLEAN      NOT NULL DEFAULT true,
    "creadoEn"   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "Trabajador_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Trabajador_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Trabajador_empresaId_nombre_key" ON "Trabajador"("empresaId", "nombre");
CREATE INDEX IF NOT EXISTS "Trabajador_empresaId_idx" ON "Trabajador"("empresaId");

-- Para instalaciones donde la tabla ya existía antes de agregar apodo
ALTER TABLE "Trabajador"
  ADD COLUMN IF NOT EXISTS "apodo" VARCHAR(100);

CREATE INDEX IF NOT EXISTS "Trabajador_empresaId_apodo_idx" ON "Trabajador"("empresaId", "apodo");

-- ============================================================
-- 3. AGREGAR COLUMNAS A "DetalleBitacora"
-- ============================================================
ALTER TABLE "DetalleBitacora"
  ADD COLUMN IF NOT EXISTS "recibeTrabajadorId" INTEGER,
  ADD COLUMN IF NOT EXISTS "recibeNombre"       VARCHAR(255);

-- FK (opcional: si el trabajador se borra, queda NULL el ID)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DetalleBitacora_recibeTrabajadorId_fkey'
  ) THEN
    ALTER TABLE "DetalleBitacora"
      ADD CONSTRAINT "DetalleBitacora_recibeTrabajadorId_fkey"
        FOREIGN KEY ("recibeTrabajadorId") REFERENCES "Trabajador"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "DetalleBitacora_recibeTrabajadorId_idx" ON "DetalleBitacora"("recibeTrabajadorId");

-- ============================================================
-- 4. CREAR RETIROS / LOTES DE BITÁCORA
-- ============================================================
CREATE TABLE IF NOT EXISTS "RetiroBitacora" (
    "id"                 SERIAL        NOT NULL,
    "empresaId"          INTEGER       NOT NULL,
    "bitacoraId"         INTEGER       NOT NULL,
    "usuarioId"          INTEGER       NOT NULL,
    "responsableId"      INTEGER,
    "recibeTrabajadorId" INTEGER,
    "recibeNombre"       VARCHAR(255)  NOT NULL,
    "fechaManual"        DATE,
    "total"              DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldoAnterior"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldoDespues"       DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creadoEn"           TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT "RetiroBitacora_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RetiroBitacora_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id"),
    CONSTRAINT "RetiroBitacora_bitacoraId_fkey" FOREIGN KEY ("bitacoraId") REFERENCES "Bitacora"("id") ON DELETE CASCADE,
    CONSTRAINT "RetiroBitacora_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id"),
    CONSTRAINT "RetiroBitacora_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "Usuario"("id") ON DELETE SET NULL,
    CONSTRAINT "RetiroBitacora_recibeTrabajadorId_fkey" FOREIGN KEY ("recibeTrabajadorId") REFERENCES "Trabajador"("id") ON DELETE SET NULL
);

ALTER TABLE "DetalleBitacora"
  ADD COLUMN IF NOT EXISTS "retiroBitacoraId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DetalleBitacora_retiroBitacoraId_fkey'
  ) THEN
    ALTER TABLE "DetalleBitacora"
      ADD CONSTRAINT "DetalleBitacora_retiroBitacoraId_fkey"
        FOREIGN KEY ("retiroBitacoraId") REFERENCES "RetiroBitacora"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RetiroBitacora_empresaId_idx" ON "RetiroBitacora"("empresaId");
CREATE INDEX IF NOT EXISTS "RetiroBitacora_bitacoraId_idx" ON "RetiroBitacora"("bitacoraId");
CREATE INDEX IF NOT EXISTS "RetiroBitacora_recibeTrabajadorId_idx" ON "RetiroBitacora"("recibeTrabajadorId");
CREATE INDEX IF NOT EXISTS "DetalleBitacora_retiroBitacoraId_idx" ON "DetalleBitacora"("retiroBitacoraId");

-- ============================================================
-- VERIFICACIÓN POSTERIOR
-- ============================================================
SELECT count(*) AS detalle_bitacora_despues FROM "DetalleBitacora";
SELECT count(*) AS trabajadores FROM "Trabajador";
SELECT count(*) AS retiros_bitacora FROM "RetiroBitacora";

-- Confirmar que el enum tiene CANCELADA
SELECT unnest(enum_range(NULL::"EstadoBitacora")) AS estados;

-- ============================================================
-- ROLLBACK (solo si es necesario, NO ejecutar sin motivo)
-- ============================================================
-- ALTER TABLE "DetalleBitacora" DROP CONSTRAINT IF EXISTS "DetalleBitacora_recibeTrabajadorId_fkey";
-- ALTER TABLE "DetalleBitacora" DROP CONSTRAINT IF EXISTS "DetalleBitacora_retiroBitacoraId_fkey";
-- ALTER TABLE "DetalleBitacora" DROP COLUMN IF EXISTS "retiroBitacoraId";
-- DROP TABLE IF EXISTS "RetiroBitacora" CASCADE;
-- ALTER TABLE "DetalleBitacora" DROP COLUMN IF EXISTS "recibeTrabajadorId";
-- ALTER TABLE "DetalleBitacora" DROP COLUMN IF EXISTS "recibeNombre";
-- DROP TABLE IF EXISTS "Trabajador" CASCADE;
-- Nota: CANCELADA no se puede quitar del enum sin recrear el tipo.
