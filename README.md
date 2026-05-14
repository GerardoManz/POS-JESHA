# JESHA POS

Sistema de punto de venta (POS) integral para Ferretería JESHA. Gestiona ventas, inventario, compras, facturación, cuentas de clientes y operaciones multi-sucursal.

## Tecnologías

| Capa | Tecnología |
|------|------------|
| Frontend | HTML/CSS/JS vanilla |
| Backend | Node.js + Express |
| Base de datos | PostgreSQL + Prisma ORM |
| Imágenes | Cloudinary |
| Facturación | Facturapi (CFDI 4.0) |
| Autenticación | JWT |

## Estructura del Proyecto

```
Ferreteria JESHA/
├── *.html                        # Páginas frontend
├── config.js                     # Configuración API + IVA
├── sidebar.js, sidebar.html      # Navegación global
├── dashboard.css                  # Estilos compartidos
└── jesha-pos-backend/
    ├── src/
    │   ├── app.js                # Rutas Express
    │   ├── server.js             # Entry point
    │   ├── middlewares/          # Auth JWT
    │   ├── lib/                  # Prisma + Cloudinary
    │   └── modules/
    │       ├── auth/             # Login
    │       ├── ventas/           # Ventas + tickets
    │       ├── productos/        # Productos + importación CSV
    │       ├── inventario/       # Stock por sucursal
    │       ├── clientes/         # Clientes
    │       ├── turnos-caja/      # Turnos de caja
    │       ├── bitacora/         # Cuenta corriente clientes
    │       ├── cotizaciones/     # Cotizaciones
    │       ├── pedidos/          # Pedidos
    │       ├── compras/          # Órdenes de compra
    │       ├── devoluciones/     # Devoluciones
    │       ├── facturacion/      # Facturapi
    │       └── facturas/         # Registros CFDI
    └── prisma/
        └── schema.prisma         # Esquema completo
```

## Módulos Principales

- **Ventas** — Punto de venta con múltiples métodos de pago (Efectivo, Débito, Crédito, Transferencia, Crédito Cliente, Mixto)
- **Inventario** — Stock por sucursal, ajustes, alertas de baja existencia
- **Productos** — Catálogo con departamentos/categorías, venta a granel, importación CSV, imágenes en Cloudinary
- **Caja** — Apertura/cierre de turnos, control de diferencias, reporte de efectivo
- **Bitácora** — Cuenta corriente de clientes (ventas a crédito y cargos manuales)
- **Facturación** — CFDI 4.0 via Facturapi (PDF + XML)
- **Clientes** — 3 tipos (General, Registrado, Fiscal) con límite de crédito
- **Cotizaciones** — Guardar carritos, convertir a venta
- **Pedidos** — Órdenes de cliente
- **Compras** — Órdenes de compra a proveedores
- **Devoluciones** — Reembolso de productos

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
npm start         # Producción
npm run seed      # Poblar base de datos
npm run studio    # Prisma Studio

# Frontend: servir con npx serve . o Live Server en VS Code
```

## Autenticación

- JWT almacenado en `localStorage` como `jesha_token`
- Middleware `requireAuth` protege todas las rutas `/api/*`
- Sidebar redirige a `login.html` si no hay token válido

## Roles de Usuario

- `SUPERADMIN` — Acceso total, todas las sucursales
- `ADMIN_SUCURSAL` — Administrador de sucursal
- `EMPLEADO` — Operador de mostrador
- `PRECIOS` — Solo consulta de precios

## Prisma 7.4 - Convenciones de Nombres

**IMPORTANTE**: Prisma 7.4 requiere PascalCase para TODOS los nombres de relaciones en `data:`, `select:` e `include:`. Usar camelCase causa errores como `Argument 'X' is missing`.

### Backend
- **`data:` en create/update**: PascalCase (`DetalleVenta: { create: [...] }`, `Sucursal: { connect: { id } }`)
- **Select/Include en respuestas**: PascalCase (`Cliente:`, `Usuario:`, `Producto:`, etc.)
- **Acceso al cliente Prisma**: camelCase (`prisma.detalleBitacora`, `prisma.venta`, etc.)
- **Where con relaciones**: PascalCase (`where: { Bitacora: { ... } }`)
- **Campos escalares (IDs)**: siempre lowercase (`usuarioId`, `sucursalId`, etc.)

### Errores Típicos

| Error | Causa | Solución |
|-------|-------|----------|
| `Argument 'Sucursal' is missing` | `sucursal:` en `data:` | Cambiar a `Sucursal:` |
| `Argument 'DetalleVenta' is missing` | `detalleVenta:` en `data:` | Cambiar a `DetalleVenta:` |

### Frontend
El API devuelve PascalCase. El frontend DEBE usar PascalCase al acceder a propiedades:
- `oc.Proveedor` NO `oc.proveedor`
- `oc.DetalleOrdenCompra` NO `oc.detalles`
- `b.Cliente` NO `b.cliente`
- `d.Producto` NO `d.producto`

## Fixes Conocidos

### devoluciones.controller.js - Relación incorrecta + PascalCase (2026-05-14)
- **Bug 1**: Usaba `DetalleVenta` en lugar de `DetalleDevolucion` (el modelo Devolucion tiene esa relación inversa)
- **Bug 2**: Usaba minúsculas en `data:` y `include:` (PascalCase requerido en Prisma 7.4)
- **Fix**: Cambiar a `DetalleDevolucion` con PascalCase

### bitacora.controller.js - Crear bitácora MANUAL
- **Bug**: Campo `actualizadoEn` obligatorio no enviado
- **Fix**: Agregar `actualizadoEn: new Date()` en `tx.bitacora.create`

## Endpoints Testeados (2026-05-13)

| Endpoint | Método | Estado |
|----------|--------|--------|
| `/auth/login` | POST | ✅ OK |
| `/cotizaciones` | GET | ✅ OK |
| `/compras` | GET | ✅ OK |
| `/bitacoras` | GET/POST | ✅ OK |
| `/pedidos` | GET | ✅ OK |
| `/facturas` | GET | ✅ OK |
| `/turnos-caja/historial` | GET | ✅ OK |
| `/turnos-caja/activo` | GET | ✅ OK |
| `/turnos-caja/resumen` | GET | ✅ OK |
| `/usuarios/vendedores` | GET | ✅ OK |
