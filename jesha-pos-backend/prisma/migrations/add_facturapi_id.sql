-- Agregar facturapiId para poder descargar PDF/XML de FacturAPI
ALTER TABLE "FacturaCfdi" ADD COLUMN IF NOT EXISTS "facturapiId" TEXT;
