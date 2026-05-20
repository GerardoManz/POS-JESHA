# JESHA POS

Sistema de punto de venta (POS) integral para Ferreteria JESHA. Gestiona ventas, inventario, compras, facturacion, cuentas de clientes y operaciones multi-sucursal.

## Tecnologias

| Capa | Tecnologia |
|------|------------|
| Frontend | HTML/CSS/JS vanilla |
| Backend | Node.js + Express |
| Base de datos | PostgreSQL + Prisma ORM |
| Imagenes | Cloudinary |
| Facturacion | Facturapi (CFDI 4.0) |
| Autenticacion | JWT |

## Estructura del Proyecto

```
Ferreteria JESHA/
|-- *.html                        # Paginas frontend
|-- config.js                     # Configuracion API + IVA
|-- sidebar.js, sidebar.html      # Navegacion global
|-- dashboard.css                  # Estilos compartidos
|-- jesha-pos-backend/
    |-- src/
    |   |-- app.js                # Rutas Express
    |   |-- server.js             # Entry point
    |   |-- middlewares/          # Auth JWT (async + verifica activo en BD)
    |   |-- lib/                  # Prisma + Cloudinary
    |   |-- modules/
    |       |-- auth/             # Login
    |       |-- ventas/           # Ventas + tickets + dashboard KPIs
    |       |-- productos/        # Productos + importacion CSV
    |       |-- inventario/       # Stock por sucursal
    |       |-- clientes/         # Clientes
    |       |-- turnos-caja/      # Turnos de caja + ticket de corte
    |       |-- bitacora/         # Cuenta corriente clientes
    |       |-- cotizaciones/     # Cotizaciones
    |       |-- pedidos/          # Pedidos
    |       |-- compras/          # Ordenes de compra
    |       |-- devoluciones/     # Devoluciones
    |       |-- facturacion/      # Facturapi
    |       |-- facturas/         # Registros CFDI
    |       |-- sucursal/         # Helper de sucursal (CRUD pendiente)
    |-- prisma/
        |-- schema.prisma         # Esquema completo
```

## Modulos Principales

- **Ventas** -- Punto de venta con multiples metodos de pago (Efectivo, Debito, Credito, Transferencia, Credito Cliente, Mixto)
- **Inventario** -- Stock por sucursal, ajustes, alertas de baja existencia
- **Productos** -- Catalogo con departamentos/categorias, venta a granel, importacion CSV, imagenes en Cloudinary
- **Caja** -- Apertura/cierre de turnos, control de diferencias, reporte de efectivo
- **Bitacora** -- Cuenta corriente de clientes (ventas a credito y cargos manuales)
- **Facturacion** -- CFDI 4.0 via Facturapi (PDF + XML)
- **Clientes** -- 3 tipos (General, Registrado, Fiscal) con limite de credito
- **Cotizaciones** -- Guardar carritos, convertir a venta
- **Pedidos** -- Ordenes de cliente
- **Compras** -- Ordenes de compra a proveedores
- **Devoluciones** -- Reembolso de productos

## Variables de Entorno (Backend)

```env
DATABASE_URL=postgresql://...
JWT_SECRET=...
CLOUDINARY_URL=...
FACTURAPI_KEY=...
NGROK_URL=...
FRONTEND_URL=...
```

## Comandos de Desarrollo

```bash
cd jesha-pos-backend

npm install
npm run build     # Generar cliente Prisma + migrar
npm run dev       # Iniciar con nodemon (desarrollo local)
npm start         # Produccion
npm run seed      # Poblar base de datos
npm run studio    # Prisma Studio

# Frontend: servir con npx serve . o Live Server en VS Code
```

## Autenticacion

- JWT almacenado en `localStorage` como `jesha_token`
- Middleware `requireAuth` protege todas las rutas `/api/*`
- Sidebar redirige a `login.html` si no hay token valido
- **Nuevo (2026-05-20):** `requireAuth` es `async` -- verifica que el usuario siga activo en BD en cada request

## Roles de Usuario

- `SUPERADMIN` -- Acceso total, todas las sucursales
- `ADMIN_SUCURSAL` -- Administrador de sucursal
- `EMPLEADO` -- Operador de mostrador
- `PRECIOS` -- Solo consulta de precios

## Dashboard KPIs

- `ventasHoy.total` -- Ventas **netas** del dia (brutas - devoluciones con reembolso)
- `ventasHoy.totalBruto` -- Ventas brutas antes de devoluciones
- `ventasHoy.devoluciones` -- Monto total devuelto en el dia
- Las devoluciones se descuentan automaticamente del total

## Prisma Decimal + Aritmetica

**CRITICO: Los campos Prisma `Decimal` se convierten a strings en JavaScript. Sumarlos directamente con `+` causa concatenacion, no suma numerica.**

```js
// INCORRECTO -- "21000" + 1 = "210001" (concatenacion)
const stockDespues = inv.stockActual + det.cantidad

// CORRECTO -- parseFloat primero
const stockAntes = parseFloat(inv.stockActual)
const stockDespues = stockAntes + det.cantidad
```

**Regla: siempre usar `parseFloat()` antes de cualquier operacion aritmetica con campos Decimal de Prisma.**

Campos afectados: `stockActual`, `precioUnitario`, `saldoPendiente`, `montoReembolso`, `total`, `cantidad`, `subtotal`, etc.

Para granel (Decimal 10,3): siempre `toFixed(3)`. Para dinero (Decimal 10,2): siempre `toFixed(2)`.

## Prisma 7.4 - Convenciones de Nombres

**IMPORTANTE**: Prisma 7.4 requiere PascalCase para TODOS los nombres de relaciones en `data:`, `select:` e `include:`. Usar camelCase causa errores como `Argument 'X' is missing`.

### Backend
- **`data:` en create/update**: PascalCase (`DetalleVenta: { create: [...] }`, `Sucursal: { connect: { id } }`)
- **Select/Include en respuestas**: PascalCase (`Cliente:`, `Usuario:`, `Producto:`, `DetalleDevolucion:`, etc.)
- **Property access**: PascalCase tambien (`venta.Devolucion` NO `venta.devoluciones`, `venta.DetalleVenta` NO `venta.detalleVenta`)
- **Acceso al cliente Prisma**: camelCase (`prisma.detalleBitacora`, `prisma.venta`, etc.)
- **Campos escalares (IDs)**: siempre lowercase (`usuarioId`, `sucursalId`, etc.)

### Errores Tipicos

| Error | Causa | Solucion |
|-------|-------|----------|
| `Argument 'Sucursal' is missing` | `sucursal:` en `data:` | Cambiar a `Sucursal:` |
| `Argument 'DetalleVenta' is missing` | `detalleVenta:` en `data:` | Cambiar a `DetalleVenta:` |
| `Unknown field 'DetalleDevolucion' for include on model Venta` | `DetalleDevolucion` en include de una `Venta` | `DetalleVenta` (Venta), `DetalleDevolucion` (solo Devolucion) |
| `venta.devoluciones is not iterable` | `venta.devoluciones` minúsculas | `venta.Devolucion` PascalCase |
| `210001` en lugar de `21001` en stock | Suma Decimal sin `parseFloat` | `parseFloat(inv.stockActual)` |

### Frontend
El API devuelve PascalCase. El frontend DEBE usar PascalCase al acceder a propiedades:
- `oc.Proveedor` NO `oc.proveedor`
- `b.Cliente` NO `b.cliente`
- `d.Producto` NO `d.producto`
- `v.Devolucion` NO `v.devoluciones`

## Fixes Recientes (Semana 1 -- 2026-05-20)

### devoluciones.controller.js -- Relaciones, deduplicacion y parseFloat
- 7 lineas corregidas: `DetalleVenta` a `DetalleDevolucion` en relaciones de Devolucion
- `venta.devoluciones` a `venta.Devolucion` (PascalCase property access)
- Deduplicacion de productos (mismo producto en 2 lineas de venta = 1 entrada)
- `parseFloat` en todas las cantidades (previene concatenacion de strings)
- `parseFloat(inv.stockActual)` + `toFixed(3)` para reingreso de inventario

### clientes.js -- Campo de credito
- `cliente.saldoCredito` a `cliente.saldoPendiente`

### auth.middleware.js -- Usuario desactivado
- `requireAuth` ahora es `async`
- Verifica `usuario.activo` en BD en cada request
- Errores JWT 401, otros errores (BD) 500

### facturas.controller.js -- Cancelacion SAT
- `fp.invoices.cancel(facturapiId, { motive: '02' })` en cancelar
- Si Facturapi no configurada + factura tiene facturapiId error 500

### sucursal.helper.js -- Nuevo modulo
- `resolverSucursalId(req)` centralizado
- SUPERADMIN puede consultar cualquier sucursal o todas (null)
- ADMIN_SUCURSAL/EMPLEADO solo la suya

## Endpoints Testeados (2026-05-13)

| Endpoint | Metodo | Estado |
|----------|--------|--------|
| `/auth/login` | POST | OK |
| `/cotizaciones` | GET | OK |
| `/compras` | GET | OK |
| `/bitacoras` | GET/POST | OK |
| `/pedidos` | GET | OK |
| `/facturas` | GET | OK |
| `/turnos-caja/historial` | GET | OK |
| `/turnos-caja/activo` | GET | OK |
| `/turnos-caja/resumen` | GET | OK |
| `/usuarios/vendedores` | GET | OK |
