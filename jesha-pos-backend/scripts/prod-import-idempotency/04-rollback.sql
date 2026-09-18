-- Rollback destructivo. Ejecutar solo si se revierte el código que usa estas tablas.
-- Revisar los conteos antes de ejecutar los DROP.

SELECT
  (SELECT COUNT(*) FROM "ImportacionProductos") AS headers_a_eliminar,
  (SELECT COUNT(*) FROM "ImportacionProductosDetalle") AS detalles_a_eliminar;

BEGIN;
DROP TABLE "ImportacionProductosDetalle";
DROP TABLE "ImportacionProductos";
COMMIT;

SELECT
  to_regclass('public."ImportacionProductos"') IS NULL AS importacion_productos_removed,
  to_regclass('public."ImportacionProductosDetalle"') IS NULL AS importacion_detalle_removed;
