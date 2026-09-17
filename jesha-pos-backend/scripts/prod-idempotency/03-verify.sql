-- 03-verify.sql — Verificar que la tabla se creó correctamente
-- Ejecutar DESPUÉS de 02-create.sql

-- 1. Tabla existe
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'RecepcionOrdenCompra'
) AS table_exists;

-- 2. Columnas correctas
SELECT column_name, data_type, is_nullable, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'RecepcionOrdenCompra' AND table_schema = 'public'
ORDER BY ordinal_position;

-- 3. Constraints correctos
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'RecepcionOrdenCompra' AND table_schema = 'public';

-- 4. Índices correctos
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'RecepcionOrdenCompra' AND schemaname = 'public';

-- Resultados esperados:
-- table_exists = true
-- 11 columnas (id, empresaId, ordenCompraId, sucursalId, proveedorId, usuarioId,
--   claveIdempotencia, fingerprintHash, respuesta, creadoEn)
-- 5 FK constraints + 1 PK + 1 UNIQUE = 7 constraints
-- 3 indexes: unique + OC index + primary key
