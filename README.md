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
