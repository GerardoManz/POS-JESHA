DOCUMENTACIÓN — RESTOCK MASIVO Y CONSOLIDACIÓN DE DUPLICADOS
Proyecto: JESHA POS
Fecha de aplicación: 2026-05-29
Referencia de restock: RESTOCK-MAYO-2026
Referencia de consolidación: CONSOLIDACION-DUPLICADOS-MAYO-2026

============================================================
1. RESUMEN EJECUTIVO
============================================================

Se aplicó un restock masivo de productos existentes en la base de datos a partir de un Excel de inventario/facturas.

La operación tuvo dos partes:

1) Restock normal:
   - Para productos únicos encontrados en la base:
     stock final = stock actual + cantidad del Excel

2) Restock con consolidación de duplicados:
   - Para productos ambiguos/duplicados:
     stock final del producto conservado =
       stock actual del producto conservado
       + stock actual del producto duplicado
       + cantidad del Excel

   - El producto duplicado quedó:
     activo = false
     codigoBarras = NULL
     stockActual = 0

Importante:
- No se hizo DELETE físico de productos.
- No se modificó codigoInterno de productos desactivados.
- No se tocaron costos, precios, compras ni corte de caja.
- Sí se registró kardex en MovimientoInventario.
- Sí se movió ProveedorProducto cuando estaba asociado al producto duplicado.

============================================================
2. RESULTADO FINAL APLICADO
============================================================

Resultado devuelto por el script final:

productos_conservados_ajustados: 491
productos_desactivados: 18
proveedores_movidos: 8
movimientos_restock: 491
movimientos_consolidacion: 34
cantidad_restock_sumada: 4550.800
stock_duplicado_movido: 132.000

Desglose de movimientos creados en MovimientoInventario:

CONSOLIDACION-DUPLICADOS-MAYO-2026 | AJUSTE_POSITIVO | 17 movimientos | 132.000
CONSOLIDACION-DUPLICADOS-MAYO-2026 | AJUSTE_NEGATIVO | 17 movimientos | 132.000
RESTOCK-MAYO-2026                  | AJUSTE_POSITIVO | 491 movimientos | 4550.800

Nota:
Hubo 18 productos duplicados desactivados, pero solo 17 generaron movimientos de consolidación porque uno de los duplicados tenía stock 0.000.

============================================================
3. TABLAS AFECTADAS
============================================================

Tablas modificadas:

1) Producto
   - Se desactivaron 18 productos duplicados.
   - Se puso codigoBarras = NULL en los productos desactivados.
   - No se modificó codigoInterno para no afectar tickets/reportes históricos.

2) InventarioSucursal
   - Se sumó stock a los productos conservados.
   - Se dejó en 0 el stock de los productos duplicados desactivados.

3) MovimientoInventario
   - Se insertaron movimientos de kardex:
     AJUSTE_POSITIVO para restock.
     AJUSTE_POSITIVO para entrada de stock consolidado al producto conservado.
     AJUSTE_NEGATIVO para salida de stock del producto duplicado.

4) ProveedorProducto
   - Se movieron 8 relaciones de proveedor desde productos duplicados hacia productos conservados.

Tablas NO modificadas:

- DetalleVenta
- Venta
- Compra
- DetalleCompra
- OrdenCompra
- DetalleOrdenCompra
- Corte de caja
- Precios
- Costos
- Costo promedio
- Categorías
- Promociones

============================================================
4. REGLAS DE NEGOCIO APLICADAS
============================================================

Regla para productos únicos:

stock_final = stock_actual + cantidad_excel

Regla para productos duplicados/ambiguos:

stock_final_producto_conservado =
  stock_actual_producto_conservado
  + stock_actual_producto_duplicado
  + cantidad_excel

stock_final_producto_duplicado = 0

Reglas para elegir producto conservado:

1) Conservar el producto con mayor stock.
2) Si había empate, conservar el que tenía proveedor.
3) Si seguía empatado, conservar el producto validado manualmente.
4) No borrar productos físicamente.
5) No cambiar codigoInterno del producto desactivado.
6) Poner codigoBarras = NULL en el producto desactivado para liberar la ambigüedad.
7) Mover ProveedorProducto al producto conservado cuando el proveedor estaba ligado al duplicado.
8) Registrar todo en MovimientoInventario.

============================================================
5. PRODUCTOS DUPLICADOS CONSOLIDADOS
============================================================

Formato:
codigo | producto conservado | producto desactivado

32432MX | conservar 19732 | desactivar 17677
6941640164780 | conservar 17199 | desactivar 19850
710631905840 | conservar 19710 | desactivar 19550
7501316141508 | conservar 19812 | desactivar 16721
7501316150814 | conservar 19738 | desactivar 15940
7501741800964 | conservar 19671 | desactivar 15152
7502222810267 | conservar 15162 | desactivar 19695
7503005496791 | conservar 15168 | desactivar 19679
7503005496807 | conservar 15166 | desactivar 19674
7503005496814 | conservar 15164 | desactivar 19694
7503005496821 | conservar 15161 | desactivar 19678
7503007746115 | conservar 19742 | desactivar 15931
7503007746214 | conservar 19508 | desactivar 19669
7503007746238 | conservar 19670 | desactivar 15105
7506240612759 | conservar 19815 | desactivar 16674
ALAMBRON | conservar 19756 | desactivar 16092
ROLLO P/ PISO | conservar 17066 | desactivar 19837
TABLARROCA | conservar 15789 | desactivar 19729

============================================================
6. VALIDACIONES REALIZADAS
============================================================

6.1 Validación de movimientos creados

Consulta:

SELECT
  "referencia",
  "tipo",
  COUNT(*) AS movimientos,
  ROUND(SUM("cantidad"), 3) AS cantidad_total
FROM public."MovimientoInventario"
WHERE "referencia" IN (
  'RESTOCK-MAYO-2026',
  'CONSOLIDACION-DUPLICADOS-MAYO-2026'
)
GROUP BY "referencia", "tipo"
ORDER BY "referencia", "tipo";

Resultado validado:

CONSOLIDACION-DUPLICADOS-MAYO-2026 | AJUSTE_POSITIVO | 17 | 132.000
CONSOLIDACION-DUPLICADOS-MAYO-2026 | AJUSTE_NEGATIVO | 17 | 132.000
RESTOCK-MAYO-2026                  | AJUSTE_POSITIVO | 491 | 4550.800

------------------------------------------------------------

6.2 Validación de stock final en productos clave

Consulta:

WITH revisar(codigo, producto_id, stock_esperado) AS (
  VALUES
    ('TABLARROCA', 15789, 236.000::numeric),
    ('ALAMBRON', 19756, 87.000::numeric),
    ('710631905840', 19710, 32.000::numeric),
    ('32432MX', 19732, 6.000::numeric)
)
SELECT
  r.codigo,
  p."id" AS producto_id,
  p."codigoInterno",
  p."codigoBarras",
  p."nombre",
  p."activo",
  i."stockActual" AS stock_actual,
  r.stock_esperado,
  CASE
    WHEN i."stockActual" = r.stock_esperado THEN 'OK'
    ELSE 'REVISAR'
  END AS estado
FROM revisar r
JOIN public."Producto" p
  ON p."id" = r.producto_id
LEFT JOIN public."InventarioSucursal" i
  ON i."productoId" = p."id"
 AND i."sucursalId" = 1
ORDER BY r.codigo;

Resultado validado:

32432MX | producto 19732 | stock_actual 6.000 | stock_esperado 6.000 | OK
710631905840 | producto 19710 | stock_actual 32.000 | stock_esperado 32.000 | OK
ALAMBRON | producto 19756 | stock_actual 87.000 | stock_esperado 87.000 | OK
TABLARROCA | producto 15789 | stock_actual 236.000 | stock_esperado 236.000 | OK

------------------------------------------------------------

6.3 Validación de proveedores movidos

Consulta usada:

WITH decision_ambiguos(codigo_norm, conservar_id, desactivar_id) AS (
  VALUES
    ('6941640164780', 17199, 19850),
    ('710631905840', 19710, 19550),
    ('7501316141508', 19812, 16721),
    ('7501316150814', 19738, 15940),
    ('7501741800964', 19671, 15152),
    ('7502222810267', 15162, 19695),
    ('7503005496791', 15168, 19679),
    ('7503005496807', 15166, 19674),
    ('7503005496814', 15164, 19694),
    ('7503005496821', 15161, 19678),
    ('7503007746115', 19742, 15931),
    ('7503007746214', 19508, 19669),
    ('7503007746238', 19670, 15105),
    ('7506240612759', 19815, 16674),
    ('32432MX', 19732, 17677),
    ('ALAMBRON', 19756, 16092),
    ('ROLLO P/ PISO', 17066, 19837),
    ('TABLARROCA', 15789, 19729)
)
SELECT
  d.codigo_norm,
  pp."id" AS proveedor_producto_id,
  pp."productoId",
  d.conservar_id,
  d.desactivar_id,
  pp."proveedorId",
  pp."codigoProveedor",
  pp."precioCosto",
  pp."activo",
  CASE
    WHEN pp."productoId" = d.conservar_id THEN 'OK_PROVEEDOR_EN_CONSERVADO'
    WHEN pp."productoId" = d.desactivar_id THEN 'ERROR_PROVEEDOR_SIGUE_EN_DESACTIVADO'
    ELSE 'REVISION'
  END AS estado
FROM decision_ambiguos d
JOIN public."ProveedorProducto" pp
  ON pp."productoId" IN (d.conservar_id, d.desactivar_id)
ORDER BY estado, d.codigo_norm;

Resultado:
Todos los registros salieron como OK_PROVEEDOR_EN_CONSERVADO.
No quedó proveedor apuntando a productos desactivados del lote.

------------------------------------------------------------

6.4 Validación de ambigüedades activas

Consulta usada:

WITH decision_ambiguos(codigo_norm, conservar_id, desactivar_id) AS (
  VALUES
    ('6941640164780', 17199, 19850),
    ('710631905840', 19710, 19550),
    ('7501316141508', 19812, 16721),
    ('7501316150814', 19738, 15940),
    ('7501741800964', 19671, 15152),
    ('7502222810267', 15162, 19695),
    ('7503005496791', 15168, 19679),
    ('7503005496807', 15166, 19674),
    ('7503005496814', 15164, 19694),
    ('7503005496821', 15161, 19678),
    ('7503007746115', 19742, 15931),
    ('7503007746214', 19508, 19669),
    ('7503007746238', 19670, 15105),
    ('7506240612759', 19815, 16674),
    ('32432MX', 19732, 17677),
    ('ALAMBRON', 19756, 16092),
    ('ROLLO P/ PISO', 17066, 19837),
    ('TABLARROCA', 15789, 19729)
)
SELECT
  d.codigo_norm,
  COUNT(p."id") AS productos_activos_que_coinciden
FROM decision_ambiguos d
LEFT JOIN public."Producto" p
  ON p."empresaId" = 1
 AND p."activo" = true
 AND (
      UPPER(TRIM(p."codigoInterno")) = d.codigo_norm
      OR UPPER(TRIM(COALESCE(p."codigoBarras", ''))) = d.codigo_norm
 )
GROUP BY d.codigo_norm
HAVING COUNT(p."id") <> 1
ORDER BY d.codigo_norm;

Resultado:
SIN RESULTADOS.
Esto significa que, para los 18 códigos ambiguos del lote, ya solo queda un producto activo coincidente.

============================================================
7. BACKUPS CREADOS
============================================================

Antes de aplicar el restock se crearon backups en la base:

backup_restock_mayo_2026_producto
backup_restock_mayo_2026_inventario
backup_restock_mayo_2026_proveedor_producto
backup_restock_mayo_2026_movimientos_previos

Conteos validados:

backup_producto: 5266
backup_inventario: 5264
backup_proveedor_producto: 2685
backup_movimientos_previos: 0

Recomendación:
No borrar estos backups inmediatamente. Mantenerlos algunos días por seguridad.

============================================================
8. ADVERTENCIAS IMPORTANTES PARA FUTURAS CARGAS
============================================================

1) No ejecutar scripts de restock masivo sin preview.
2) No usar DELETE físico para productos duplicados.
3) No cambiar codigoInterno de productos desactivados, porque tickets y reportes históricos pueden mostrar el valor actual del producto.
4) Si se desactiva un producto duplicado, poner codigoBarras = NULL para liberar la ambigüedad.
5) Siempre crear MovimientoInventario para mantener kardex.
6) Siempre verificar si ProveedorProducto debe moverse al producto conservado.
7) No tocar costos ni precios en un restock administrativo.
8) No mezclar limpieza global de catálogo con restock puntual.
9) Mantener referencias únicas por lote:
   - RESTOCK-MAYO-2026
   - CONSOLIDACION-DUPLICADOS-MAYO-2026
10) En DBeaver, evitar scripts con BEGIN sin COMMIT. Para operaciones grandes conviene usar un solo statement atómico o confirmar autocommit/transacción.

============================================================
9. PROBLEMA DETECTADO DURANTE EJECUCIÓN
============================================================

Durante la ejecución inicial, se usó un archivo que todavía contenía BEGIN; pero no tenía COMMIT; al final.

Efecto:
- DBeaver mostró éxito temporal.
- Se veían movimientos y stocks actualizados en la sesión.
- Pero al revisar después, no quedó persistido.
- El stock volvió a coincidir con el backup y MovimientoInventario quedó sin registros.

Solución:
Se generó un script atómico sin BEGIN ni COMMIT explícitos, con un solo statement SQL.
Ese fue el script que finalmente aplicó correctamente.

Resultado final validado:
- MovimientoInventario contiene los movimientos esperados.
- Los stocks finales de productos clave están en OK.
- Los duplicados del lote están inactivos y con stock 0.
- Los proveedores quedaron en productos conservados.

============================================================
10. CONSULTA RÁPIDA PARA VALIDAR ESTE LOTE EN EL FUTURO
============================================================

SELECT
  "referencia",
  "tipo",
  COUNT(*) AS movimientos,
  ROUND(SUM("cantidad"), 3) AS cantidad_total
FROM public."MovimientoInventario"
WHERE "referencia" IN (
  'RESTOCK-MAYO-2026',
  'CONSOLIDACION-DUPLICADOS-MAYO-2026'
)
GROUP BY "referencia", "tipo"
ORDER BY "referencia", "tipo";

Resultado esperado:

CONSOLIDACION-DUPLICADOS-MAYO-2026 | AJUSTE_POSITIVO | 17 | 132.000
CONSOLIDACION-DUPLICADOS-MAYO-2026 | AJUSTE_NEGATIVO | 17 | 132.000
RESTOCK-MAYO-2026                  | AJUSTE_POSITIVO | 491 | 4550.800

============================================================
11. ESTADO PENDIENTE
============================================================

Quedaron 92 productos del Excel como NO_EXISTE.
Esos productos no fueron creados ni ajustados en esta operación.

La limpieza global de duplicados del catálogo queda pendiente para una fase separada.
No mezclar esa limpieza con restocks futuros sin análisis específico.
