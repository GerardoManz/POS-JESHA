-- ════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Fix FacturaCfdi para integración FacturAPI
-- Ejecutar en pgAdmin sobre la BD de JESHA POS
-- ════════════════════════════════════════════════════════════════════

-- 1. Hacer clienteId nullable (ventas sin cliente registrado)
ALTER TABLE "FacturaCfdi" ALTER COLUMN "clienteId" DROP NOT NULL;

-- 2. Agregar campo para guardar el email del solicitante
ALTER TABLE "FacturaCfdi" ADD COLUMN IF NOT EXISTS "emailReceptor" TEXT;

-- 3. Hacer la FK de clienteId opcional (si ya existe constraint)
-- Prisma lo maneja, pero por si acaso:
-- ALTER TABLE "FacturaCfdi" DROP CONSTRAINT IF EXISTS "FacturaCfdi_clienteId_fkey";
-- ALTER TABLE "FacturaCfdi" ADD CONSTRAINT "FacturaCfdi_clienteId_fkey" 
--   FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL;
