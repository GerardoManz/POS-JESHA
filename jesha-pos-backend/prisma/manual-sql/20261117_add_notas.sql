-- NOTAS backend schema. Apply manually in local first, then production only
-- through the documented schema-change protocol. DO NOT run from the app.
-- Execute this complete file so verification and COMMIT cannot be separated.
SELECT current_database() AS database_name,
       current_user AS database_user,
       inet_server_addr() AS server_address,
       current_setting('transaction_read_only') AS transaction_read_only,
       NOW() AS checked_at;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlcanceNota') THEN
    CREATE TYPE "AlcanceNota" AS ENUM ('EMPRESA', 'SUCURSAL', 'USUARIO');
  END IF;
END $$;

-- These keys let every tenant-owned relationship fail closed at the FK layer.
ALTER TABLE "Usuario"
  ADD CONSTRAINT "Usuario_id_empresaId_key" UNIQUE ("id", "empresaId");
ALTER TABLE "Sucursal"
  ADD CONSTRAINT "Sucursal_id_empresaId_key" UNIQUE ("id", "empresaId");

CREATE TABLE "Nota" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "autorId" INTEGER NOT NULL,
  "alcance" "AlcanceNota" NOT NULL,
  "sucursalId" INTEGER,
  "usuarioDestinatarioId" INTEGER,
  "titulo" VARCHAR(160) NOT NULL,
  "contenido" TEXT NOT NULL,
  "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiradaEn" TIMESTAMP(3),
  "retiradaPorId" INTEGER,
  "motivoRetiro" TEXT,
  "reemplazaNotaId" INTEGER,
  CONSTRAINT "Nota_destino_check" CHECK (
    ("alcance" = 'EMPRESA' AND "sucursalId" IS NULL AND "usuarioDestinatarioId" IS NULL) OR
    ("alcance" = 'SUCURSAL' AND "sucursalId" IS NOT NULL AND "usuarioDestinatarioId" IS NULL) OR
    ("alcance" = 'USUARIO' AND "sucursalId" IS NULL AND "usuarioDestinatarioId" IS NOT NULL)
  ),
  CONSTRAINT "Nota_autodestino_check" CHECK (
    "alcance" <> 'USUARIO' OR "autorId" <> "usuarioDestinatarioId"
  ),
  CONSTRAINT "Nota_contenido_check" CHECK (
    length(btrim("titulo")) BETWEEN 1 AND 160 AND
    length(btrim("contenido")) BETWEEN 1 AND 20000
  ),
  CONSTRAINT "Nota_retiro_check" CHECK (
    ("retiradaEn" IS NULL AND "retiradaPorId" IS NULL AND "motivoRetiro" IS NULL) OR
    ("retiradaEn" IS NOT NULL AND "retiradaPorId" IS NOT NULL AND length(btrim("motivoRetiro")) BETWEEN 1 AND 500)
  ),
  CONSTRAINT "Nota_reemplazo_propio_check" CHECK ("reemplazaNotaId" IS NULL OR "reemplazaNotaId" <> "id"),
  CONSTRAINT "Nota_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT,
  CONSTRAINT "Nota_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT,
  CONSTRAINT "Nota_sucursalId_empresaId_fkey" FOREIGN KEY ("sucursalId", "empresaId") REFERENCES "Sucursal"("id", "empresaId") ON DELETE RESTRICT,
  CONSTRAINT "Nota_usuarioDestinatarioId_empresaId_fkey" FOREIGN KEY ("usuarioDestinatarioId", "empresaId") REFERENCES "Usuario"("id", "empresaId") ON DELETE RESTRICT,
  CONSTRAINT "Nota_retiradaPorId_fkey" FOREIGN KEY ("retiradaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT,
  CONSTRAINT "Nota_id_empresaId_key" UNIQUE ("id", "empresaId"),
  CONSTRAINT "Nota_reemplazaNotaId_empresaId_key" UNIQUE ("reemplazaNotaId", "empresaId")
);

ALTER TABLE "Nota"
  ADD CONSTRAINT "Nota_reemplazaNotaId_empresaId_fkey"
  FOREIGN KEY ("reemplazaNotaId", "empresaId")
  REFERENCES "Nota"("id", "empresaId") ON DELETE RESTRICT;

CREATE TABLE "NotaDestinatario" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "notaId" INTEGER NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  "leidaEn" TIMESTAMP(3),
  CONSTRAINT "NotaDestinatario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT,
  CONSTRAINT "NotaDestinatario_notaId_empresaId_fkey" FOREIGN KEY ("notaId", "empresaId") REFERENCES "Nota"("id", "empresaId") ON DELETE RESTRICT,
  CONSTRAINT "NotaDestinatario_usuarioId_empresaId_fkey" FOREIGN KEY ("usuarioId", "empresaId") REFERENCES "Usuario"("id", "empresaId") ON DELETE RESTRICT,
  CONSTRAINT "NotaDestinatario_notaId_usuarioId_key" UNIQUE ("notaId", "usuarioId")
);

CREATE INDEX "Nota_empresaId_creadaEn_id_idx" ON "Nota"("empresaId", "creadaEn" DESC, "id" DESC);
CREATE INDEX "Nota_autorId_creadaEn_id_idx" ON "Nota"("autorId", "creadaEn" DESC, "id" DESC);
CREATE INDEX "Nota_sucursalId_idx" ON "Nota"("sucursalId");
CREATE INDEX "Nota_usuarioDestinatarioId_idx" ON "Nota"("usuarioDestinatarioId");
CREATE INDEX "Nota_retiradaEn_idx" ON "Nota"("retiradaEn");
CREATE INDEX "NotaDestinatario_empresaId_usuarioId_leidaEn_idx" ON "NotaDestinatario"("empresaId", "usuarioId", "leidaEn");
CREATE INDEX "NotaDestinatario_notaId_idx" ON "NotaDestinatario"("notaId");

DO $$
DECLARE
  nota_columns INTEGER;
  receipt_columns INTEGER;
BEGIN
  SELECT COUNT(*) INTO nota_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Nota';

  SELECT COUNT(*) INTO receipt_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'NotaDestinatario';

  IF nota_columns <> 13 OR receipt_columns <> 5 THEN
    RAISE EXCEPTION 'Verificacion NOTAS fallo: Nota=%, NotaDestinatario=%', nota_columns, receipt_columns;
  END IF;
END $$;

COMMIT;

-- Post-commit verification: expect 3 enum values, both tables, and zero rows.
SELECT enumlabel
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'AlcanceNota'
ORDER BY e.enumsortorder;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('Nota', 'NotaDestinatario')
ORDER BY table_name;

SELECT (SELECT COUNT(*) FROM "Nota") AS notas,
       (SELECT COUNT(*) FROM "NotaDestinatario") AS destinatarios;
