BEGIN;

-- =============================================
-- FASE 1: CORRECCIÓN CLAVES SAT
-- Categorías limpias + subgrupos claros
-- Fecha: 2026-05-19
-- =============================================

-- =============================================
-- GRUPO 1: UPDATE POR CATEGORÍA COMPLETA
-- =============================================

-- Cat 408 BROCAS (67 productos) → 27111500 - Herramientas de corte y engarzado y punzones
UPDATE "Producto" SET "claveSat" = '27111500'
WHERE "categoriaId" = 408 AND "claveSat" = '27110000';

-- Cat 338 PUNTAS (61 productos) → 27111500 - Herramientas de corte y engarzado y punzones
UPDATE "Producto" SET "claveSat" = '27111500'
WHERE "categoriaId" = 338 AND "claveSat" = '27110000';

-- Cat 538 ACCESORIOS cutters/navajas (9 productos) → 27111500 - Herramientas de corte y engarzado y punzones
UPDATE "Producto" SET "claveSat" = '27111500'
WHERE "categoriaId" = 538 AND "claveSat" = '27110000';

-- Cat 381 CARPINTERIA (9 productos) → 27111500 - Herramientas de corte y engarzado y punzones
UPDATE "Producto" SET "claveSat" = '27111500'
WHERE "categoriaId" = 381 AND "claveSat" = '27110000';

-- Cat 428 ILUMINACION (25 productos) → 39111500 - Iluminación de interiores y artefactos
UPDATE "Producto" SET "claveSat" = '39111500'
WHERE "categoriaId" = 428 AND "claveSat" = '27110000';

-- Cat 556 LUMINARIAS (10 productos) → 39111500 - Iluminación de interiores y artefactos
UPDATE "Producto" SET "claveSat" = '39111500'
WHERE "categoriaId" = 556 AND "claveSat" = '27110000';

-- Cat 356 REFLECTORES (8 productos) → 39111500 - Iluminación de interiores y artefactos
UPDATE "Producto" SET "claveSat" = '39111500'
WHERE "categoriaId" = 356 AND "claveSat" = '27110000';

-- Cat 536 SIN DEFINIR luminaria (1 producto) → 39111500 - Iluminación de interiores y artefactos
UPDATE "Producto" SET "claveSat" = '39111500'
WHERE "categoriaId" = 536 AND "claveSat" = '27110000';

-- Cat 363 CERRADURAS (12 productos) → 31162800 - Ferretería en general
UPDATE "Producto" SET "claveSat" = '31162800'
WHERE "categoriaId" = 363 AND "claveSat" = '27110000';

-- Cat 374 Escuadra (12 productos) → 31162800 - Ferretería en general
UPDATE "Producto" SET "claveSat" = '31162800'
WHERE "categoriaId" = 374 AND "claveSat" = '27110000';

-- Cat 365 TOPES Y SOPORTES (28 productos) → 31162800 - Ferretería en general
UPDATE "Producto" SET "claveSat" = '31162800'
WHERE "categoriaId" = 365 AND "claveSat" = '27110000';

-- Cat 429 BOTAS (6 productos) → 46181604 - Botas de seguridad
UPDATE "Producto" SET "claveSat" = '46181604'
WHERE "categoriaId" = 429 AND "claveSat" = '27110000';

-- Cat 542 LIJAS (3 productos) → 31191500 - Abrasivos y medios de abrasivo
UPDATE "Producto" SET "claveSat" = '31191500'
WHERE "categoriaId" = 542 AND "claveSat" = '27110000';

-- Cat 435 PROTECCION VISION (6 productos) → 46181800 - Protección y accesorios para la visión
UPDATE "Producto" SET "claveSat" = '46181800'
WHERE "categoriaId" = 435 AND "claveSat" = '27110000';

-- Cat 552 PROTECCION RESPIRATORIA (2 productos) → 46182000 - Protección de la respiración
UPDATE "Producto" SET "claveSat" = '46182000'
WHERE "categoriaId" = 552 AND "claveSat" = '27110000';

-- Cat 440 SENALIZACION (2 productos) → 46161508 - Conos o delineadores de tráfico
UPDATE "Producto" SET "claveSat" = '46161508'
WHERE "categoriaId" = 440 AND "claveSat" = '27110000';

-- Cat 432 GUANTES/tapones auditivos (1 producto) → 46181900 - Protectores auditivos
UPDATE "Producto" SET "claveSat" = '46181900'
WHERE "categoriaId" = 432 AND "claveSat" = '27110000';

-- Cat 530 RODILLERA (1 producto) → 46181500 - Ropa de seguridad
UPDATE "Producto" SET "claveSat" = '46181500'
WHERE "categoriaId" = 530 AND "claveSat" = '27110000';

-- Cat 366 REMACHES (6 productos) → 31162000 - Clavos
UPDATE "Producto" SET "claveSat" = '31162000'
WHERE "categoriaId" = 366 AND "claveSat" = '27110000';

-- Cat 396 Organizador Tornillos (23 productos) → 31162000 - Clavos
UPDATE "Producto" SET "claveSat" = '31162000'
WHERE "categoriaId" = 396 AND "claveSat" = '27110000';

-- Cat 339 Serrucho/clavos (1 producto) → 31162000 - Clavos
UPDATE "Producto" SET "claveSat" = '31162000'
WHERE "categoriaId" = 339 AND "claveSat" = '27110000';

-- Cat 554 CADENAS (2 productos) → 31151600 - Cadenas
UPDATE "Producto" SET "claveSat" = '31151600'
WHERE "categoriaId" = 554 AND "claveSat" = '27110000';

-- Cat 550 TUBOS (1 producto) → 40141700 - Accesorios de tubería
UPDATE "Producto" SET "claveSat" = '40141700'
WHERE "categoriaId" = 550 AND "claveSat" = '27110000';

-- Cat 382 accesorios tinaco (8 productos) → 40141700 - Accesorios de tubería
UPDATE "Producto" SET "claveSat" = '40141700'
WHERE "categoriaId" = 382 AND "claveSat" = '27110000';

-- Cat 549 TINACOS (20 productos) → 40141739 - Contenedores de agua
UPDATE "Producto" SET "claveSat" = '40141739'
WHERE "categoriaId" = 549 AND "claveSat" = '27110000';

-- Cat 553 SANITARIOS (15 productos) → 30181600 - Accesorios de plomería
UPDATE "Producto" SET "claveSat" = '30181600'
WHERE "categoriaId" = 553 AND "claveSat" = '27110000';

-- Cat 393 Mesa cajon 1 (28 productos) → 39121700 - Ferretería eléctrica y suministros
UPDATE "Producto" SET "claveSat" = '39121700'
WHERE "categoriaId" = 393 AND "claveSat" = '27110000';

-- Cat 355 EXTENSIONES (12 productos) → 39121700 - Ferretería eléctrica y suministros
UPDATE "Producto" SET "claveSat" = '39121700'
WHERE "categoriaId" = 355 AND "claveSat" = '27110000';

-- Cat 398 INTERRUPTORES timbre (2 productos) → 39121700 - Ferretería eléctrica y suministros
UPDATE "Producto" SET "claveSat" = '39121700'
WHERE "categoriaId" = 398 AND "claveSat" = '27110000';

-- Cat 400 Electricidad conduit (1 producto) → 39121700 - Ferretería eléctrica y suministros
UPDATE "Producto" SET "claveSat" = '39121700'
WHERE "categoriaId" = 400 AND "claveSat" = '27110000';

-- Cat 419 Organizador Avante carbones (19 productos) → 27112800 - Conexiones de herramientas y accesorios
UPDATE "Producto" SET "claveSat" = '27112800'
WHERE "categoriaId" = 419 AND "claveSat" = '27110000';

-- Cat 557 ACCESORIOS GAS (8 productos) → 40101800 - Equipo de calefacción y piezas y accesorios
UPDATE "Producto" SET "claveSat" = '40101800'
WHERE "categoriaId" = 557 AND "claveSat" = '27110000';

-- Cat 446 ESTANTES DETRAS CAJA flauta gas (1 producto) → 40101800 - Equipo de calefacción y piezas y accesorios
UPDATE "Producto" SET "claveSat" = '40101800'
WHERE "categoriaId" = 446 AND "claveSat" = '27110000';

-- Cat 335 Tapizador esponjas (4 productos) → 27112200 - Herramientas de albañilería y concreto
UPDATE "Producto" SET "claveSat" = '27112200'
WHERE "categoriaId" = 335 AND "claveSat" = '27110000';

-- Cat 336 Espatula (1 producto) → 27112200 - Herramientas de albañilería y concreto
UPDATE "Producto" SET "claveSat" = '27112200'
WHERE "categoriaId" = 336 AND "claveSat" = '27110000';

-- Cat 558 IMPERMEABILIZANTES (2 productos) → 30161500 - Materiales para acabados de paredes
UPDATE "Producto" SET "claveSat" = '30161500'
WHERE "categoriaId" = 558 AND "claveSat" = '27110000';

-- Cat 560 TOLDOS (1 producto) → 30151901 - Toldos
UPDATE "Producto" SET "claveSat" = '30151901'
WHERE "categoriaId" = 560 AND "claveSat" = '27110000';

-- Cat 561 TECNOLOGIA calculadora (1 producto) → 44122000 - Contadores
UPDATE "Producto" SET "claveSat" = '44122000'
WHERE "categoriaId" = 561 AND "claveSat" = '27110000';

-- Cat 539 LUBRICANTES (2 productos) → 15121900 - Grasas
UPDATE "Producto" SET "claveSat" = '15121900'
WHERE "categoriaId" = 539 AND "claveSat" = '27110000';

-- Cat 370 CINTA papel kraft (3 productos) → 44121700 - Cartón y papel para embalaje
UPDATE "Producto" SET "claveSat" = '44121700'
WHERE "categoriaId" = 370 AND "claveSat" = '27110000';

-- =============================================
-- GRUPO 2: UPDATE POR CATEGORÍA CON EXCEPCIONES
-- =============================================

-- Cat 343 LINEA DE CORTE: UPDATE completo (16 productos) → 27111500
UPDATE "Producto" SET "claveSat" = '27111500'
WHERE "categoriaId" = 343 AND "claveSat" = '27110000';
-- Excepciones: tijeras podar → 27112007
-- Busca la clave base que el UPDATE anterior estableció
UPDATE "Producto" SET "claveSat" = '27112007'
WHERE id IN (17389, 17390, 15920, 15678) AND "claveSat" = '27111500';

-- Cat 342 ACCESORIOS JARDIN: UPDATE completo (9 productos) → 27112001
UPDATE "Producto" SET "claveSat" = '27112001'
WHERE "categoriaId" = 342 AND "claveSat" = '27110000';
-- Excepciones: pistolas riego → 21101800
UPDATE "Producto" SET "claveSat" = '21101800'
WHERE id IN (19438, 17080, 17079) AND "claveSat" = '27112001';

-- Cat 367 JARDINERIA: UPDATE completo (21 productos) → 27112000
UPDATE "Producto" SET "claveSat" = '27112000'
WHERE "categoriaId" = 367 AND "claveSat" = '27110000';
-- Excepciones: cilindros gas LP → 24101600
UPDATE "Producto" SET "claveSat" = '24101600'
WHERE id IN (19045, 18668, 18665) AND "claveSat" = '27112000';

-- Cat 344 REFACCIONES: UPDATE completo (18 productos) → 27112700
UPDATE "Producto" SET "claveSat" = '27112700'
WHERE "categoriaId" = 344 AND "claveSat" = '27110000';
-- Excepciones: bombas presurizadoras → 40141700
UPDATE "Producto" SET "claveSat" = '40141700'
WHERE id IN (16648, 16649, 17509, 19235, 17510) AND "claveSat" = '27112700';
-- Excepción: bomba inflarllantas → 27112800
UPDATE "Producto" SET "claveSat" = '27112800'
WHERE id = 16456 AND "claveSat" = '27112700';
-- Excepciones: calibradores/vernier → 27111800
UPDATE "Producto" SET "claveSat" = '27111800'
WHERE id IN (16694, 17308, 17432) AND "claveSat" = '27112700';
-- Excepciones: rodajas/ruedas → 31162800
UPDATE "Producto" SET "claveSat" = '31162800'
WHERE id IN (16184, 16254, 16255, 19265, 16958, 18759, 16028, 18953, 16080) AND "claveSat" = '27112700';

-- Cat 427 GUANTE: UPDATE completo (4 productos) → 46181500
UPDATE "Producto" SET "claveSat" = '46181500'
WHERE "categoriaId" = 427 AND "claveSat" = '27110000';
-- Excepción: lentes sport → 46181800
UPDATE "Producto" SET "claveSat" = '46181800'
WHERE id = 19152 AND "claveSat" = '46181500';

-- Cat 426 CINTURON: UPDATE por IDs separados (NO por categoría)
-- Arnés cuerpo completo, línea de vida → 46182300
UPDATE "Producto" SET "claveSat" = '46182300'
WHERE id IN (19162, 19163) AND "claveSat" = '27110000';
-- Organizadores 11 y 17 compartimentos → 31162800
UPDATE "Producto" SET "claveSat" = '31162800'
WHERE id IN (15480, 16016) AND "claveSat" = '27110000';

-- Cat 413 Conexiones Agua: UPDATE completo (22 productos) → 40141700
UPDATE "Producto" SET "claveSat" = '40141700'
WHERE "categoriaId" = 413 AND "claveSat" = '27110000';
-- Excepciones: regatones, protectores patas, cuñas puerta → 31162800
UPDATE "Producto" SET "claveSat" = '31162800'
WHERE id IN (19284, 17258, 17259, 17255, 17256, 17253, 17254, 19264, 16735, 16734) AND "claveSat" = '40141700';

-- Cat 562 ACCESORIOS soldadura: UPDATE por IDs separados
-- Encendedor soplete → 27112602
UPDATE "Producto" SET "claveSat" = '27112602'
WHERE id = 19394 AND "claveSat" = '27110000';
-- Encendedores económicos colores → 12131700
UPDATE "Producto" SET "claveSat" = '12131700'
WHERE id = 19385 AND "claveSat" = '27110000';

-- Cat 405 BASES Y SELLADORES: UPDATE por IDs separados
-- Acelerante concreto IMPAC → 30111600
UPDATE "Producto" SET "claveSat" = '30111600'
WHERE id = 15738 AND "claveSat" = '27110000';
-- Body filler FTX → 31201600
UPDATE "Producto" SET "claveSat" = '31201600'
WHERE id = 18374 AND "claveSat" = '27110000';

-- Cat 347 CINTAS: UPDATE por ID
-- Gato hidráulico botella 21 ton → 27112100
UPDATE "Producto" SET "claveSat" = '27112100'
WHERE id = 18903 AND "claveSat" = '27110000';

-- Cat 388 PPR/TUBOPLUS: UPDATE (solo 1 producto con 27110000)
-- Sierra circular 7-1/4" 1400W Ingco → 27112700
UPDATE "Producto" SET "claveSat" = '27112700'
WHERE "categoriaId" = 388 AND "claveSat" = '27110000';

-- Cat 425 SIN DEFINIR: UPDATE por ID
-- Pelador angular plástico → 52151600
UPDATE "Producto" SET "claveSat" = '52151600'
WHERE id = 19494 AND "claveSat" = '27110000';

-- =============================================
-- VERIFICACIÓN FINAL
-- =============================================
SELECT COUNT(*) AS "restantes_27110000"
FROM "Producto" WHERE "claveSat" = '27110000';

COMMIT;