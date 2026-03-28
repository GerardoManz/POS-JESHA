-- ════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Fix completo FacturaCfdi
-- Ejecutar en pgAdmin sobre la BD de JESHA POS
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "FacturaCfdi" ALTER COLUMN "clienteId" DROP NOT NULL;
ALTER TABLE "FacturaCfdi" ADD COLUMN IF NOT EXISTS "emailReceptor" TEXT;
ALTER TABLE "FacturaCfdi" ADD COLUMN IF NOT EXISTS "facturapiId" TEXT;
