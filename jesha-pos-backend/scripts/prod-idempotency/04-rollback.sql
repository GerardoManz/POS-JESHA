-- 04-rollback.sql — Revertir la migración si es necesario
-- ⚠️ SOLO ejecutar si se necesita revertir después de 02-create.sql
-- ADVERTENCIA: Esto eliminará todos los registros de idempotency existentes

-- Verificar cuántos registros hay antes de borrar
SELECT COUNT(*) AS registros_existentes FROM "RecepcionOrdenCompra";

-- Drop indexes primero
DROP INDEX IF EXISTS "RecepcionOrdenCompra_empresaId_claveIdempotencia_key";
DROP INDEX IF EXISTS "RecepcionOrdenCompra_ordenCompraId_creadoEn_idx";

-- Drop table (cascade elimina la PK constraint también)
DROP TABLE IF EXISTS "RecepcionOrdenCompra";

-- Verificar
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'RecepcionOrdenCompra'
) AS table_exists_after_rollback;
-- Resultado esperado: table_exists_after_rollback = false
