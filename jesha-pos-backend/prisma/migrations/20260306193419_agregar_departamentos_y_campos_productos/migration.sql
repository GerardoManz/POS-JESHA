/*
  Warnings:

  - You are about to drop the column `activo` on the `Cliente` table. All the data in the column will be lost.
  - You are about to drop the column `actualizadoEn` on the `Cliente` table. All the data in the column will be lost.
  - You are about to drop the column `limiteCredito` on the `Cliente` table. All the data in the column will be lost.
  - You are about to drop the column `razonSocial` on the `Cliente` table. All the data in the column will be lost.
  - You are about to drop the column `saldoCredito` on the `Cliente` table. All the data in the column will be lost.
  - You are about to drop the column `usoCfdi` on the `Cliente` table. All the data in the column will be lost.
  - You are about to drop the `Abono` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[departamentoId,nombre]` on the table `Categoria` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[rfc]` on the table `Cliente` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[codigoInterno]` on the table `Producto` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `departamentoId` to the `Categoria` table without a default value. This is not possible if the table is not empty.
  - Added the required column `codigoInterno` to the `Producto` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Abono" DROP CONSTRAINT "Abono_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "DetalleCotizacion" DROP CONSTRAINT "DetalleCotizacion_cotizacionId_fkey";

-- DropForeignKey
ALTER TABLE "DetalleDevolucion" DROP CONSTRAINT "DetalleDevolucion_devolucionId_fkey";

-- DropForeignKey
ALTER TABLE "DetalleOrdenCompra" DROP CONSTRAINT "DetalleOrdenCompra_ordenCompraId_fkey";

-- DropForeignKey
ALTER TABLE "DetallePedido" DROP CONSTRAINT "DetallePedido_pedidoId_fkey";

-- DropForeignKey
ALTER TABLE "DetalleVenta" DROP CONSTRAINT "DetalleVenta_ventaId_fkey";

-- DropForeignKey
ALTER TABLE "Devolucion" DROP CONSTRAINT "Devolucion_ventaId_fkey";

-- DropForeignKey
ALTER TABLE "FacturaCfdi" DROP CONSTRAINT "FacturaCfdi_ventaId_fkey";

-- DropForeignKey
ALTER TABLE "InventarioSucursal" DROP CONSTRAINT "InventarioSucursal_productoId_fkey";

-- DropForeignKey
ALTER TABLE "MovimientoCaja" DROP CONSTRAINT "MovimientoCaja_turnoId_fkey";

-- DropForeignKey
ALTER TABLE "MovimientoInventario" DROP CONSTRAINT "MovimientoInventario_productoId_fkey";

-- DropIndex
DROP INDEX "Categoria_nombre_key";

-- DropIndex
DROP INDEX "Cliente_activo_idx";

-- DropIndex
DROP INDEX "Cliente_email_idx";

-- DropIndex
DROP INDEX "Cliente_nombre_idx";

-- DropIndex
DROP INDEX "Cliente_rfc_idx";

-- DropIndex
DROP INDEX "Cliente_tipo_idx";

-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "departamentoId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Cliente" DROP COLUMN "activo",
DROP COLUMN "actualizadoEn",
DROP COLUMN "limiteCredito",
DROP COLUMN "razonSocial",
DROP COLUMN "saldoCredito",
DROP COLUMN "usoCfdi";

-- AlterTable
ALTER TABLE "MovimientoInventario" ADD COLUMN     "usuarioId" INTEGER;

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "claveSat" TEXT,
ADD COLUMN     "codigoInterno" TEXT NOT NULL,
ADD COLUMN     "costoPromedio" DECIMAL(10,2),
ADD COLUMN     "departamentoId" INTEGER,
ADD COLUMN     "factorConversion" DECIMAL(10,4),
ADD COLUMN     "imagenOriginal" TEXT,
ADD COLUMN     "unidadCompra" TEXT,
ADD COLUMN     "unidadSat" TEXT,
ADD COLUMN     "unidadVenta" TEXT;

-- DropTable
DROP TABLE "Abono";

-- CreateTable
CREATE TABLE "Departamento" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "icono" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Departamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Departamento_nombre_key" ON "Departamento"("nombre");

-- CreateIndex
CREATE INDEX "Auditoria_usuarioId_idx" ON "Auditoria"("usuarioId");

-- CreateIndex
CREATE INDEX "Auditoria_modulo_idx" ON "Auditoria"("modulo");

-- CreateIndex
CREATE INDEX "Auditoria_accion_idx" ON "Auditoria"("accion");

-- CreateIndex
CREATE INDEX "Auditoria_creadoEn_idx" ON "Auditoria"("creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_departamentoId_nombre_key" ON "Categoria"("departamentoId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_rfc_key" ON "Cliente"("rfc");

-- CreateIndex
CREATE INDEX "InventarioSucursal_sucursalId_idx" ON "InventarioSucursal"("sucursalId");

-- CreateIndex
CREATE INDEX "InventarioSucursal_stockActual_idx" ON "InventarioSucursal"("stockActual");

-- CreateIndex
CREATE INDEX "MovimientoInventario_productoId_idx" ON "MovimientoInventario"("productoId");

-- CreateIndex
CREATE INDEX "MovimientoInventario_sucursalId_idx" ON "MovimientoInventario"("sucursalId");

-- CreateIndex
CREATE INDEX "MovimientoInventario_usuarioId_idx" ON "MovimientoInventario"("usuarioId");

-- CreateIndex
CREATE INDEX "MovimientoInventario_tipo_idx" ON "MovimientoInventario"("tipo");

-- CreateIndex
CREATE INDEX "MovimientoInventario_creadoEn_idx" ON "MovimientoInventario"("creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_codigoInterno_key" ON "Producto"("codigoInterno");

-- CreateIndex
CREATE INDEX "Producto_nombre_idx" ON "Producto"("nombre");

-- CreateIndex
CREATE INDEX "Producto_codigoInterno_idx" ON "Producto"("codigoInterno");

-- CreateIndex
CREATE INDEX "Producto_codigoBarras_idx" ON "Producto"("codigoBarras");

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "Departamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioSucursal" ADD CONSTRAINT "InventarioSucursal_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleVenta" ADD CONSTRAINT "DetalleVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleDevolucion" ADD CONSTRAINT "DetalleDevolucion_devolucionId_fkey" FOREIGN KEY ("devolucionId") REFERENCES "Devolucion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleCotizacion" ADD CONSTRAINT "DetalleCotizacion_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "Cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetallePedido" ADD CONSTRAINT "DetallePedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleOrdenCompra" ADD CONSTRAINT "DetalleOrdenCompra_ordenCompraId_fkey" FOREIGN KEY ("ordenCompraId") REFERENCES "OrdenCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaCfdi" ADD CONSTRAINT "FacturaCfdi_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
