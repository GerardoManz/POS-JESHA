-- CreateEnum
CREATE TYPE "ModoCapturaDetalle" AS ENUM ('CANTIDAD', 'IMPORTE', 'CONVERSION');

-- AlterTable
ALTER TABLE "DetalleVenta"
ADD COLUMN "unidadVentaSnapshot" TEXT,
ADD COLUMN "unidadCapturadaSnapshot" TEXT,
ADD COLUMN "esGranelSnapshot" BOOLEAN,
ADD COLUMN "factorConversionSnapshot" DECIMAL(10,4),
ADD COLUMN "modoCapturaSnapshot" "ModoCapturaDetalle",
ADD COLUMN "cantidadCapturadaSnapshot" DECIMAL(10,3),
ADD COLUMN "importeCapturadoSnapshot" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "DetalleBitacora"
ADD COLUMN "unidadVentaSnapshot" TEXT,
ADD COLUMN "unidadCapturadaSnapshot" TEXT,
ADD COLUMN "esGranelSnapshot" BOOLEAN,
ADD COLUMN "factorConversionSnapshot" DECIMAL(10,4),
ADD COLUMN "modoCapturaSnapshot" "ModoCapturaDetalle",
ADD COLUMN "cantidadCapturadaSnapshot" DECIMAL(10,3),
ADD COLUMN "importeCapturadoSnapshot" DECIMAL(10,2);
