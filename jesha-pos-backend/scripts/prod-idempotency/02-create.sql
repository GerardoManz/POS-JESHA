-- 02-create.sql — Crear tabla RecepcionOrdenCompra para idempotency de recepciones
-- Ejecutar DESPUÉS de 01-precheck.sql (verificar que table_exists = false)
-- Basado en: prisma/schema.prisma líneas 878-898

CREATE TABLE "RecepcionOrdenCompra" (
  "id"                SERIAL PRIMARY KEY,
  "empresaId"         INTEGER NOT NULL,
  "ordenCompraId"     INTEGER NOT NULL,
  "sucursalId"        INTEGER NOT NULL,
  "proveedorId"       INTEGER NOT NULL,
  "usuarioId"         INTEGER,
  "claveIdempotencia" VARCHAR(64),
  "fingerprintHash"   VARCHAR(64),
  "respuesta"         JSONB,
  "creadoEn"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecepcionOrdenCompra_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecepcionOrdenCompra_ordenCompraId_fkey"
    FOREIGN KEY ("ordenCompraId") REFERENCES "OrdenCompra"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecepcionOrdenCompra_sucursalId_fkey"
    FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecepcionOrdenCompra_proveedorId_fkey"
    FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecepcionOrdenCompra_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Unique constraint compuesto: empresaId + claveIdempotencia
CREATE UNIQUE INDEX "RecepcionOrdenCompra_empresaId_claveIdempotencia_key"
  ON "RecepcionOrdenCompra" ("empresaId", "claveIdempotencia");

-- Index para queries por OC
CREATE INDEX "RecepcionOrdenCompra_ordenCompraId_creadoEn_idx"
  ON "RecepcionOrdenCompra" ("ordenCompraId", "creadoEn");
