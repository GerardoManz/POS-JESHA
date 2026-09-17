-- 01-precheck.sql — Verificar que la tabla NO existe aún
-- Ejecutar ANTES de 02-create.sql

SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'RecepcionOrdenCompra'
) AS table_exists;

-- Resultado esperado: table_exists = false
-- Si es true, NO ejecutar 02-create.sql
