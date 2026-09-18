-- Verificar estructura después de ejecutar 02-create.sql.

SELECT
  to_regclass('public."ImportacionProductos"') IS NOT NULL AS importacion_productos_exists,
  to_regclass('public."ImportacionProductosDetalle"') IS NOT NULL AS importacion_detalle_exists;

SELECT table_name, COUNT(*) AS columnas
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('ImportacionProductos', 'ImportacionProductosDetalle')
GROUP BY table_name
ORDER BY table_name;

-- Esperado:
-- ImportacionProductos = 21 columnas
-- ImportacionProductosDetalle = 11 columnas

SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name IN ('ImportacionProductos', 'ImportacionProductosDetalle')
ORDER BY table_name, constraint_name;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('ImportacionProductos', 'ImportacionProductosDetalle')
ORDER BY tablename, indexname;

SELECT
  (SELECT COUNT(*) FROM "ImportacionProductos") AS headers,
  (SELECT COUNT(*) FROM "ImportacionProductosDetalle") AS detalles;
