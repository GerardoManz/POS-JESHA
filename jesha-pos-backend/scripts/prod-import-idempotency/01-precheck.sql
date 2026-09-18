-- Verificar el estado antes de crear las tablas de idempotencia de importaciones.
-- Resultado esperado: ambas columnas *_exists = false.

SELECT
  to_regclass('public."ImportacionProductos"') IS NOT NULL AS importacion_productos_exists,
  to_regclass('public."ImportacionProductosDetalle"') IS NOT NULL AS importacion_detalle_exists;

-- Las relaciones requeridas deben existir antes de continuar.
SELECT
  to_regclass('public."Empresa"') IS NOT NULL AS empresa_exists,
  to_regclass('public."Usuario"') IS NOT NULL AS usuario_exists,
  to_regclass('public."Sucursal"') IS NOT NULL AS sucursal_exists;
