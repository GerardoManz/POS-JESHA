-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO', 'PRECIOS');

-- CreateEnum
CREATE TYPE "EstadoVenta" AS ENUM ('COMPLETADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "EstadoCotizacion" AS ENUM ('PENDIENTE', 'CONVERTIDA', 'VENCIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('BORRADOR', 'PENDIENTE', 'ACTIVO', 'BLOQUEADO', 'EJECUTADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoOrdenCompra" AS ENUM ('ENVIADO', 'RECIBIDO_PARCIAL', 'RECIBIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('DISPONIBLE', 'FACTURADA', 'VENCIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoMovimientoInventario" AS ENUM ('ENTRADA_COMPRA', 'SALIDA_VENTA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'DEVOLUCION_ENTRADA', 'DEVOLUCION_SALIDA');

-- CreateEnum
CREATE TYPE "TipoMovimientoCaja" AS ENUM ('APERTURA', 'VENTA', 'DEVOLUCION', 'AJUSTE', 'CIERRE');

-- CreateEnum
CREATE TYPE "TipoPromocion" AS ENUM ('BUEN_FIN', 'HOT_SALE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AlcancePromocion" AS ENUM ('PRODUCTO', 'CATEGORIA', 'SUCURSAL');

-- CreateEnum
CREATE TYPE "EstadoAlerta" AS ENUM ('PENDIENTE', 'VISTA', 'RESUELTA');

-- CreateTable
CREATE TABLE "Sucursal" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "telefono" TEXT,
    "codigoPostal" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sucursalId" INTEGER,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "rfc" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "codigoPostalFiscal" TEXT,
    "regimenFiscal" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'REGULAR',
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proveedor" (
    "id" SERIAL NOT NULL,
    "nombreOficial" TEXT NOT NULL,
    "alias" TEXT,
    "telefono" TEXT,
    "celular" TEXT,
    "email" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProveedorProducto" (
    "id" SERIAL NOT NULL,
    "proveedorId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "codigoProveedor" TEXT,
    "precioCosto" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProveedorProducto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigoBarras" TEXT,
    "descripcion" TEXT,
    "imagenUrl" TEXT,
    "precioBase" DECIMAL(10,2) NOT NULL,
    "costo" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "categoriaId" INTEGER NOT NULL,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventarioSucursal" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "stockActual" INTEGER NOT NULL DEFAULT 0,
    "stockMinimoAlerta" INTEGER NOT NULL DEFAULT 5,
    "stockMaximo" INTEGER,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventarioSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoInventario" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "tipo" "TipoMovimientoInventario" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "stockAntes" INTEGER NOT NULL,
    "stockDespues" INTEGER NOT NULL,
    "referencia" TEXT,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertaStock" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "stockActual" INTEGER NOT NULL,
    "stockMinimo" INTEGER NOT NULL,
    "estado" "EstadoAlerta" NOT NULL DEFAULT 'PENDIENTE',
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vistaEn" TIMESTAMP(3),

    CONSTRAINT "AlertaStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnoCaja" (
    "id" SERIAL NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "montoInicial" DECIMAL(10,2) NOT NULL,
    "montoFinalDeclarado" DECIMAL(10,2),
    "montoCalculado" DECIMAL(10,2),
    "diferencia" DECIMAL(10,2),
    "abierto" BOOLEAN NOT NULL DEFAULT true,
    "abiertaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaEn" TIMESTAMP(3),

    CONSTRAINT "TurnoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "tipo" "TipoMovimientoCaja" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "metodoPago" "MetodoPago",
    "referencia" TEXT,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venta" (
    "id" SERIAL NOT NULL,
    "folio" TEXT NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "clienteId" INTEGER,
    "turnoId" INTEGER,
    "metodoPago" "MetodoPago" NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "descuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "estado" "EstadoVenta" NOT NULL DEFAULT 'COMPLETADA',
    "tokenQr" TEXT NOT NULL,
    "facturaEstado" "EstadoFactura" NOT NULL DEFAULT 'DISPONIBLE',
    "facturaLimite" TIMESTAMP(3) NOT NULL,
    "notas" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetalleVenta" (
    "id" SERIAL NOT NULL,
    "ventaId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "descuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "promocionId" INTEGER,

    CONSTRAINT "DetalleVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Devolucion" (
    "id" SERIAL NOT NULL,
    "ventaId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "reintegraInventario" BOOLEAN NOT NULL DEFAULT true,
    "tipoReembolso" TEXT NOT NULL,
    "montoReembolso" DECIMAL(10,2) NOT NULL,
    "notas" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Devolucion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetalleDevolucion" (
    "id" SERIAL NOT NULL,
    "devolucionId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "DetalleDevolucion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cotizacion" (
    "id" SERIAL NOT NULL,
    "folio" TEXT NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "clienteId" INTEGER,
    "total" DECIMAL(10,2) NOT NULL,
    "estado" "EstadoCotizacion" NOT NULL DEFAULT 'PENDIENTE',
    "venceEn" TIMESTAMP(3),
    "notas" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetalleCotizacion" (
    "id" SERIAL NOT NULL,
    "cotizacionId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "DetalleCotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" SERIAL NOT NULL,
    "folio" TEXT NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "clienteId" INTEGER,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'BORRADOR',
    "totalEstimado" DECIMAL(10,2) NOT NULL,
    "motivoBloqueo" TEXT,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetallePedido" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioAcordado" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "DetallePedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdenCompra" (
    "id" SERIAL NOT NULL,
    "folio" TEXT NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "proveedorId" INTEGER NOT NULL,
    "estado" "EstadoOrdenCompra" NOT NULL DEFAULT 'ENVIADO',
    "totalEstimado" DECIMAL(10,2) NOT NULL,
    "notas" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recibidaEn" TIMESTAMP(3),

    CONSTRAINT "OrdenCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetalleOrdenCompra" (
    "id" SERIAL NOT NULL,
    "ordenCompraId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidadPedida" INTEGER NOT NULL,
    "cantidadRecibida" INTEGER NOT NULL DEFAULT 0,
    "precioCosto" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "DetalleOrdenCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promocion" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoPromocion" NOT NULL,
    "alcance" "AlcancePromocion" NOT NULL,
    "descuento" DECIMAL(5,2) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "categoriaId" INTEGER,
    "notas" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promocion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacturaCfdi" (
    "id" SERIAL NOT NULL,
    "ventaId" INTEGER NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "rfcReceptor" TEXT NOT NULL,
    "nombreReceptor" TEXT NOT NULL,
    "cpReceptor" TEXT NOT NULL,
    "regimenFiscal" TEXT NOT NULL,
    "usoCfdi" TEXT NOT NULL,
    "lugarExpedicion" TEXT NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "iva" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "folioFiscal" TEXT,
    "xmlUrl" TEXT,
    "pdfUrl" TEXT,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'FACTURADA',
    "timbradaEn" TIMESTAMP(3),
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturaCfdi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER,
    "sucursalId" INTEGER,
    "accion" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "referencia" TEXT,
    "valorAntes" JSONB,
    "valorDespues" JSONB,
    "ip" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PromocionProducto" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_PromocionProducto_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_username_key" ON "Usuario"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_nombre_key" ON "Categoria"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "ProveedorProducto_proveedorId_productoId_key" ON "ProveedorProducto"("proveedorId", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_codigoBarras_key" ON "Producto"("codigoBarras");

-- CreateIndex
CREATE UNIQUE INDEX "InventarioSucursal_productoId_sucursalId_key" ON "InventarioSucursal"("productoId", "sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertaStock_productoId_sucursalId_estado_key" ON "AlertaStock"("productoId", "sucursalId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_folio_key" ON "Venta"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_tokenQr_key" ON "Venta"("tokenQr");

-- CreateIndex
CREATE UNIQUE INDEX "Cotizacion_folio_key" ON "Cotizacion"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_folio_key" ON "Pedido"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "OrdenCompra_folio_key" ON "OrdenCompra"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "FacturaCfdi_ventaId_key" ON "FacturaCfdi"("ventaId");

-- CreateIndex
CREATE INDEX "_PromocionProducto_B_index" ON "_PromocionProducto"("B");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProveedorProducto" ADD CONSTRAINT "ProveedorProducto_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProveedorProducto" ADD CONSTRAINT "ProveedorProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioSucursal" ADD CONSTRAINT "InventarioSucursal_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioSucursal" ADD CONSTRAINT "InventarioSucursal_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaStock" ADD CONSTRAINT "AlertaStock_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoCaja" ADD CONSTRAINT "TurnoCaja_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoCaja" ADD CONSTRAINT "TurnoCaja_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleVenta" ADD CONSTRAINT "DetalleVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleVenta" ADD CONSTRAINT "DetalleVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleVenta" ADD CONSTRAINT "DetalleVenta_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "Promocion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleDevolucion" ADD CONSTRAINT "DetalleDevolucion_devolucionId_fkey" FOREIGN KEY ("devolucionId") REFERENCES "Devolucion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleCotizacion" ADD CONSTRAINT "DetalleCotizacion_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "Cotizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleCotizacion" ADD CONSTRAINT "DetalleCotizacion_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetallePedido" ADD CONSTRAINT "DetallePedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetallePedido" ADD CONSTRAINT "DetallePedido_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenCompra" ADD CONSTRAINT "OrdenCompra_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenCompra" ADD CONSTRAINT "OrdenCompra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleOrdenCompra" ADD CONSTRAINT "DetalleOrdenCompra_ordenCompraId_fkey" FOREIGN KEY ("ordenCompraId") REFERENCES "OrdenCompra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleOrdenCompra" ADD CONSTRAINT "DetalleOrdenCompra_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promocion" ADD CONSTRAINT "Promocion_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promocion" ADD CONSTRAINT "Promocion_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaCfdi" ADD CONSTRAINT "FacturaCfdi_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaCfdi" ADD CONSTRAINT "FacturaCfdi_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromocionProducto" ADD CONSTRAINT "_PromocionProducto_A_fkey" FOREIGN KEY ("A") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromocionProducto" ADD CONSTRAINT "_PromocionProducto_B_fkey" FOREIGN KEY ("B") REFERENCES "Promocion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
