-- Crear las tablas de idempotencia de importaciones.
-- Ejecutar el script completo en una sola operación después de 01-precheck.sql.

BEGIN;

CREATE TABLE "ImportacionProductos" (
  "id"                SERIAL PRIMARY KEY,
  "empresaId"         INTEGER NOT NULL,
  "usuarioId"         INTEGER,
  "sucursalId"        INTEGER,
  "claveIdempotencia" VARCHAR(64) NOT NULL,
  "fingerprintHash"   VARCHAR(64) NOT NULL,
  "tipo"              TEXT NOT NULL,
  "estado"            TEXT NOT NULL DEFAULT 'PROCESANDO',
  "totalFilas"        INTEGER NOT NULL,
  "filasProcesadas"   INTEGER NOT NULL DEFAULT 0,
  "creados"           INTEGER NOT NULL DEFAULT 0,
  "actualizados"      INTEGER NOT NULL DEFAULT 0,
  "vinculaciones"     INTEGER NOT NULL DEFAULT 0,
  "omitidos"          INTEGER NOT NULL DEFAULT 0,
  "errores"           INTEGER NOT NULL DEFAULT 0,
  "advertencias"      INTEGER NOT NULL DEFAULT 0,
  "respuesta"         JSONB,
  "leaseToken"        VARCHAR(64),
  "leaseExpiresAt"    TIMESTAMP(3),
  "creadoEn"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizarEn"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ImportacionProductos_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ImportacionProductos_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ImportacionProductos_sucursalId_fkey"
    FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ImportacionProductos_tipo_check"
    CHECK ("tipo" IN ('upsert', 'solo_nuevos')),
  CONSTRAINT "ImportacionProductos_estado_check"
    CHECK ("estado" IN ('PROCESANDO', 'COMPLETADA', 'FALLIDA')),
  CONSTRAINT "ImportacionProductos_fingerprintHash_check"
    CHECK ("fingerprintHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "ImportacionProductos_empresaId_claveIdempotencia_key"
  ON "ImportacionProductos" ("empresaId", "claveIdempotencia");

CREATE INDEX "ImportacionProductos_empresaId_creadoEn_idx"
  ON "ImportacionProductos" ("empresaId", "creadoEn");

CREATE TABLE "ImportacionProductosDetalle" (
  "id"              SERIAL PRIMARY KEY,
  "importacionId"   INTEGER NOT NULL,
  "fila"            INTEGER NOT NULL,
  "codigoInterno"   TEXT NOT NULL,
  "estado"          TEXT NOT NULL,
  "accion"          TEXT NOT NULL,
  "productoId"      INTEGER,
  "vinculaciones"   INTEGER NOT NULL DEFAULT 0,
  "error"           TEXT,
  "advertencia"     TEXT,
  "mensaje"         TEXT,

  CONSTRAINT "ImportacionProductosDetalle_importacionId_fkey"
    FOREIGN KEY ("importacionId") REFERENCES "ImportacionProductos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImportacionProductosDetalle_estado_check"
    CHECK ("estado" IN ('COMPLETADA', 'ERROR_VALIDACION', 'ERROR_SISTEMA')),
  CONSTRAINT "ImportacionProductosDetalle_accion_check"
    CHECK ("accion" IN ('CREADO', 'ACTUALIZADO', 'OMITIDO', 'ERROR')),
  CONSTRAINT "ImportacionProductosDetalle_vinculaciones_check"
    CHECK ("vinculaciones" >= 0)
);

CREATE UNIQUE INDEX "ImportacionProductosDetalle_importacionId_fila_key"
  ON "ImportacionProductosDetalle" ("importacionId", "fila");

CREATE INDEX "ImportacionProductosDetalle_importacionId_idx"
  ON "ImportacionProductosDetalle" ("importacionId");

COMMIT;
