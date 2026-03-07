-- Migración: Ampliar Cliente a Opción B
-- Añade campos SAT, crédito y auditoría
-- Fecha: 2026-03-05

-- 1. Agregar nuevos campos a tabla Cliente
ALTER TABLE "Cliente" ADD COLUMN "razonSocial" TEXT;
ALTER TABLE "Cliente" ADD COLUMN "usoCfdi" TEXT;
ALTER TABLE "Cliente" ADD COLUMN "limiteCredito" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "Cliente" ADD COLUMN "saldoCredito" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "Cliente" ADD COLUMN "activo" BOOLEAN DEFAULT true;
ALTER TABLE "Cliente" ADD COLUMN "actualizadoEn" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- 2. Hacer RFC único (opcional - descomentar si lo necesitas)
-- ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_rfc_key" UNIQUE("rfc");

-- 3. Hacer email único (opcional - descomentar si lo necesitas)
-- ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_email_key" UNIQUE("email");

-- 4. Cambiar tipo de REGULAR/FRECUENTE a GENERAL/REGISTRADO/FISCAL
-- Primero actualizar valores existentes
UPDATE "Cliente" 
SET "tipo" = CASE 
  WHEN "tipo" = 'REGULAR' THEN 'GENERAL'
  WHEN "tipo" = 'FRECUENTE' THEN 'REGISTRADO'
  ELSE 'GENERAL'
END;

-- 5. Crear tabla Abono para registrar pagos de crédito
CREATE TABLE "Abono" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "clienteId" INTEGER NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "metodoPago" VARCHAR(50) NOT NULL,
    "referencia" TEXT,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Abono_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 6. Crear índice para búsquedas rápidas en abonos
CREATE INDEX "Abono_clienteId_idx" ON "Abono"("clienteId");
CREATE INDEX "Abono_creadoEn_idx" ON "Abono"("creadoEn");

-- 7. Crear índices adicionales en Cliente para búsquedas
CREATE INDEX "Cliente_rfc_idx" ON "Cliente"("rfc");
CREATE INDEX "Cliente_email_idx" ON "Cliente"("email");
CREATE INDEX "Cliente_tipo_idx" ON "Cliente"("tipo");
CREATE INDEX "Cliente_activo_idx" ON "Cliente"("activo");
CREATE INDEX "Cliente_nombre_idx" ON "Cliente"("nombre");