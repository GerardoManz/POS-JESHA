-- Preservar datos de Usuario y Cliente
-- Recrear tablas producto-dependientes con nuevo schema

-- Backup temporal de datos de prueba (opcional)
CREATE TABLE IF NOT EXISTS "Producto_old" AS SELECT * FROM "Producto";
CREATE TABLE IF NOT EXISTS "InventarioSucursal_old" AS SELECT * FROM "InventarioSucursal";

-- Drop cascade (esto borra todo lo que depende)
DROP TABLE IF EXISTS "DetalleOrdenCompra" CASCADE;
DROP TABLE IF EXISTS "OrdenCompra" CASCADE;
DROP TABLE IF EXISTS "DetallePedido" CASCADE;
DROP TABLE IF EXISTS "Pedido" CASCADE;
DROP TABLE IF EXISTS "DetalleCotizacion" CASCADE;
DROP TABLE IF EXISTS "Cotizacion" CASCADE;
DROP TABLE IF EXISTS "DetalleVenta" CASCADE;
DROP TABLE IF EXISTS "Devolucion" CASCADE;
DROP TABLE IF EXISTS "DetalleDevolucion" CASCADE;
DROP TABLE IF EXISTS "Venta" CASCADE;
DROP TABLE IF EXISTS "MovimientoCaja" CASCADE;
DROP TABLE IF EXISTS "TurnoCaja" CASCADE;
DROP TABLE IF EXISTS "AlertaStock" CASCADE;
DROP TABLE IF EXISTS "MovimientoInventario" CASCADE;
DROP TABLE IF EXISTS "InventarioSucursal" CASCADE;
DROP TABLE IF EXISTS "Promocion" CASCADE;
DROP TABLE IF EXISTS "ProveedorProducto" CASCADE;
DROP TABLE IF EXISTS "Producto" CASCADE;
DROP TABLE IF EXISTS "FacturaCfdi" CASCADE;

-- Usuario y Cliente se preservan automáticamente

-- Recrear tablas con nuevo schema
CREATE TABLE "Departamento" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "nombre" VARCHAR(255) NOT NULL UNIQUE,
  "icono" VARCHAR(255),
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Categoria" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "departamentoId" INTEGER NOT NULL,
  "nombre" VARCHAR(255) NOT NULL,
  "descripcion" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Categoria_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "Departamento" ("id"),
  UNIQUE ("departamentoId", "nombre")
);

CREATE TABLE "Proveedor" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "nombreOficial" VARCHAR(255) NOT NULL UNIQUE,
  "alias" VARCHAR(255) UNIQUE,
  "telefono" VARCHAR(255),
  "celular" VARCHAR(255),
  "email" VARCHAR(255),
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Producto" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "nombre" VARCHAR(255) NOT NULL,
  "codigoInterno" VARCHAR(255) NOT NULL UNIQUE,
  "codigoBarras" VARCHAR(255) UNIQUE,
  "descripcion" TEXT,
  "imagenUrl" VARCHAR(255),
  "imagenOriginal" VARCHAR(255),
  "precioBase" DECIMAL(10,2) NOT NULL,
  "costo" DECIMAL(10,2),
  "costoPromedio" DECIMAL(10,2),
  "precioMayoreo" DECIMAL(10,2),
  "cantidadMinMayoreo" INTEGER DEFAULT 10,
  "aplicaMayoreo" BOOLEAN NOT NULL DEFAULT false,
  "unidadCompra" VARCHAR(255),
  "unidadVenta" VARCHAR(255),
  "factorConversion" DECIMAL(10,4),
  "claveSat" VARCHAR(255),
  "unidadSat" VARCHAR(255),
  "esGranel" BOOLEAN NOT NULL DEFAULT false,
  "margen" DECIMAL(5,2),
  "categoriaId" INTEGER NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id")
);

-- Crear índices
CREATE INDEX "Producto_nombre_idx" ON "Producto"("nombre");
CREATE INDEX "Producto_codigoInterno_idx" ON "Producto"("codigoInterno");
CREATE INDEX "Producto_codigoBarras_idx" ON "Producto"("codigoBarras");
CREATE INDEX "Proveedor_nombreOficial_idx" ON "Proveedor"("nombreOficial");
CREATE INDEX "Proveedor_alias_idx" ON "Proveedor"("alias");

-- Crear tablas dependientes...
-- (resto de tablas en orden de dependencias)