# AGENTS.md — JESHA POS

## Project Overview

**JESHA POS** is a comprehensive Point of Sale (POS) system for a hardware store ("Ferretería JESHA"). It manages sales, inventory, purchases, billing, customer accounts, and multi-branch operations.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Backend | Node.js + Express |
| Database | PostgreSQL via Prisma ORM |
| Authentication | JWT tokens |
| Image Storage | Cloudinary |
| Billing | Facturapi (CFDI 4.0) |

## Project Structure

```
Ferreteria JESHA/
├── index.html, punto-venta.html, productos.html, ...   # Frontend pages
├── config.js                                              # Central API config + IVA rate
├── sidebar.js, sidebar.html                               # Global navigation component
├── dashboard.js, dashboard.css                           # Main dashboard
├── jesha-pos-backend/
│   ├── src/
│   │   ├── app.js                                        # Express routes (public + protected)
│   │   ├── server.js                                      # Server entry point
│   │   ├── middlewares/auth.middleware.js                # JWT auth middleware
│   │   ├── lib/prisma.js, cloudinary.js                 # Prisma + Cloudinary clients
│   │   └── modules/
│   │       ├── auth/                                      # Login (public)
│   │       ├── ventas/                                   # Sales + tickets
│   │       ├── productos/                                # Products + CSV import
│   │       ├── inventario/                              # Branch inventory
│   │       ├── clientes/                                 # Customer management
│   │       ├── turnos-caja/                             # Cash register shifts
│   │       ├── bitacora/                                # Customer accounts/ledger
│   │       ├── cotizaciones/                            # Quotes
│   │       ├── pedidos/                                 # Orders
│   │       ├── compras/                                 # Purchase orders
│   │       ├── devoluciones/                            # Returns
│   │       ├── facturacion/                             # Facturapi (public)
│   │       └── facturas/                                # Invoice records
│   └── prisma/
│       └── schema.prisma                                # Full database schema
```

## Database Schema (Prisma)

### Core Entities

- **Sucursal** — Branches (multi-branch support)
- **Usuario** — Users with roles: `SUPERADMIN`, `ADMIN_SUCURSAL`, `EMPLEADO`, `PRECIOS`
- **Cliente** — Customers with credit limits and fiscal data (RFC, regimen, CFDI)
- **Producto** — Products with pricing, codes, SAT keys, granel (bulk) support
- **Categoria / Departamento** — Product catalog hierarchy
- **Proveedor / ProveedorProducto** — Suppliers and pricing per supplier
- **InventarioSucursal** — Per-branch stock levels
- **TurnoCaja** — Cash register shifts (open/close with balance tracking)
- **MovimientoCaja** — Cash movements within a shift
- **MovimientoInventario** — All stock changes (sales, purchases, adjustments)
- **AlertaStock** — Low stock alerts per shift

### Transactional Entities

- **Venta / DetalleVenta** — Sales with multiple payment methods
- **Devolucion / DetalleDevolucion** — Product returns
- **Cotizacion / DetalleCotizacion** — Quotes with expiration
- **Pedido / DetallePedido** — Customer orders
- **OrdenCompra / DetalleOrdenCompra / AbonoCompra** — Purchase orders
- **Bitacora / DetalleBitacora / AbonoBitacora** — Customer ledger/accounts (VENTA or MANUAL origin)
- **Promocion** — Discounts (BUEN_FIN, HOT_SALE, MANUAL) per branch/category/product
- **FacturaCfdi** — CFDI 4.0 invoices via Facturapi
- **Auditoria** — Audit log of all changes

### Enums

`Rol`, `EstadoVenta`, `EstadoPago`, `MetodoPago`, `EstadoCotizacion`, `EstadoPedido`, `EstadoOrdenCompra`, `EstadoFactura`, `TipoMovimientoInventario`, `TipoMovimientoCaja`, `TipoPromocion`, `AlcancePromocion`, `EstadoAlerta`, `EstadoReporteStock`, `EstadoBitacora`, `OrigenBitacora`

## Authentication Flow

1. User visits any page → `sidebar.js` checks for `jesha_token` in localStorage
2. If missing → redirect to `login.html`
3. Login submits credentials to `POST /auth/login`
4. Backend returns `{ token, usuario }` → stored in localStorage
5. All API requests include `Authorization: Bearer <token>`
6. Backend middleware `requireAuth` validates JWT and attaches `req.usuario`
7. Logout clears localStorage and redirects to login

## API Configuration

- **config.js** auto-detects environment: `localhost` / `127.0.0.1` / `192.168.0.190` → local API (`http://localhost:3000`)
- Otherwise → production API (`https://jesha-pos-api.onrender.com`)
- IVA rate: `0.16` (16%) — stored in `CONFIG.IVA`

## Frontend Patterns

### Page Structure
Each page includes `config.js` + `sidebar.js` + page-specific JS:
```html
<script src="config.js"></script>
<script src="sidebar.js"></script>
<script src="page.js"></script>
```

### Global Components
- **sidebar.html/sidebar.js** — Loaded into `#sidebar-container`, highlights active page via `data-page`
- **dashboard.css** — Shared dark theme styles for all pages

### Common Features
- Protected pages check auth in inline `<script>` before body renders
- Table loading with spinner placeholder rows
- Modals for create/edit forms
- Error messages in dedicated `.error-message` divs
- Form reset on modal close

## Key Modules

### Ventas (Sales)
- Create sale → deduct inventory → record `MovimientoInventario`
- Supports payment methods: `EFECTIVO`, `DEBITO`, `CREDITO`, `TRANSFERENCIA`, `CREDITO_CLIENTE`, `MIXTO`
- Venta a crédito creates/links to a `Bitacora`
- Generates QR token for invoice request
- Ticket generation with QR

### Productos (Products)
- CRUD with department/category hierarchy
- CSV import: two modes — UPSERT (update existing) vs. "Solo Nuevos" (skip existing)
- Separate CSV import for fiscal data updates
- Image upload to Cloudinary
- Bulk pricing calculations from supplier costs (with/without IVA)
- Granel (bulk) products support with unit conversion factor

### Inventario (Inventory)
- Per-sucursal stock management
- Stock adjustments with reasons
- Low stock alerts

### Turnos-Caja (Cash Shifts)
- Open shift with initial amount
- Close shift → compare declared vs. calculated balance
- Generate stock report on close

### Bitacora (Customer Ledger)
- Two origins: `VENTA` (auto from credit sale) or `MANUAL` (projects)
- Accumulate charges and payments
- Abonos reduce `saldoPendiente`
- Close bitacora with final balance

### Cotizaciones (Quotes)
- Save cart as quote, optionally set expiration date
- Convert to sale when confirmed

### Clientes (Customers)
- Types: `GENERAL`, `REGISTRADO`, `FISCAL`
- Fiscal fields: RFC, razón social, CP, régimen fiscal, uso CFDI
- Credit limit tracking with `saldoPendiente`

### Facturacion (CFDI)
- Uses Facturapi for CFDI 4.0
- Public route (`/facturar`) for invoice request via token
- Generates PDF and XML download

## Environment Variables (Backend)

```
DATABASE_URL=postgresql://...
JWT_SECRET=...
CLOUDINARY_URL=...
FACTURAPI_KEY=...
NGROK_URL=...
FRONTEND_URL=...
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `jesha-pos-backend/prisma/schema.prisma` | Complete DB schema with all models/enums |
| `jesha-pos-backend/src/app.js` | Express app — all API routes |
| `jesha-pos-backend/src/middlewares/auth.middleware.js` | JWT validation |
| `jesha-pos-backend/src/modules/ventas/ventas.controller.js` | Sales business logic |
| `jesha-pos-backend/src/modules/bitacora/bitacora.controller.js` | Customer ledger logic |
| `config.js` | Frontend API URL + IVA config |
| `sidebar.js` | Global nav + auth guard |
| `punto-venta.js` | POS cart logic |

## Development Commands

```bash
# Backend
cd jesha-pos-backend
npm run dev          # Start with nodemon (local)
npm start            # Production start
npm run migrate     # Prisma migrations
npm run build       # Generate Prisma client + migrate
npm run seed        # Seed database
npm run studio      # Prisma Studio

# Frontend (static files)
# Serve with: npx serve .  OR  Live Server in VS Code
```

## TODO / In Progress

- Products with "granel" mode sell by variable quantity (meters, kg, liters)
- Descuento empleado (employee discount) in POS confirmation modal
- AbonosBitacora integrate into cash shift
- Stock report generation on shift close
- Multi-sucursal support (SUPERADMIN can filter by branch)

## Prisma 7.4 Naming Conventions

**CRITICAL**: Prisma 7.4 uses PascalCase for ALL relation names in `select:`, `include:`, and `data:` objects. Using camelCase will cause runtime errors like `Argument 'X' is missing`.

### Backend (controllers/services)

**1. `data:` objects (create/update)** — PascalCase obligatorio
```js
// ✅ CORRECTO
tx.venta.create({ data: { Sucursal: { connect: { id } }, DetalleVenta: { create: [...] } } })

// ❌ ERROR: Prisma 7 rechaza minúsculas en data:
tx.venta.create({ data: { sucursal: { connect: { id } }, detalleVenta: { create: [...] } } })
```

**2. `include:` y `select:` objects** — PascalCase
- `Cliente:`, `Usuario:`, `Producto:`, `Sucursal:`, `Proveedor:`, `Categoria:`, `Departamento:`, `InventarioSucursal:`, `DetalleVenta:`, `DetalleBitacora:`, `DetalleOrdenCompra:`, `DetallePedido:`, `DetalleCotizacion:`, `AbonoBitacora:`, `AbonoCompra:`, `Bitacora:`, `DetalleDevolucion:`, `TurnoCaja:`, `Venta:`

**3. Prisma client calls (model access)** — camelCase (NUNCA cambiar)
- `prisma.detalleBitacora.create(...)`, `tx.detalleOrdenCompra.update(...)`, `prisma.inventarioSucursal.upsert(...)`, etc.

**4. Where filter relations** — PascalCase
- `where: { Bitacora: { clienteId: ... } }`, `where: { ProveedorProducto: { some: ... } }`

**5. Scalar fields (IDs)** — siempre lowercase
- `usuarioId`, `sucursalId`, `clienteId`, `productoId`, `categoriaId`, `turnoId`, `ordenCompraId`, `pedidoId`, etc.

**6. Auditoria create** — usar scalars, NO nested connect
- `prisma.auditoria.create({ data: { accion, modulo, referencia, usuarioId, sucursalId } })`

### Typical Errors (Debugging)

| Error Message | Causa | Fix |
|---------------|-------|-----|
| `Argument 'Sucursal' is missing` | `sucursal:` en `data:` | Cambiar a `Sucursal:` |
| `Argument 'DetalleVenta' is missing` | `detalleVenta:` en `data:` | Cambiar a `DetalleVenta:` |
| `Invalid tx.venta.create()` | relación mal escrita en data | Verificar PascalCase en todo el `data:` |

### Frontend (JS files reading API responses)
The API returns PascalCase relation names. Frontend MUST use PascalCase when accessing API response properties:
- `oc.Proveedor` NOT `oc.proveedor`
- `oc.Usuario` NOT `oc.usuario`
- `oc.AbonoCompra` NOT `oc.abonos`
- `oc.DetalleOrdenCompra` NOT `oc.detalles`
- `d.Producto` NOT `d.producto`
- `b.Cliente` NOT `b.cliente`
- `b.Usuario` NOT `b.usuario`
- `b.DetalleBitacora` NOT `b.detalles`
- `b.AbonoBitacora` NOT `b.abonos`
- `a.Usuario` NOT `a.usuario`
- `p.Categoria` NOT `p.categoria`
- `p.Categoria.Departamento` NOT `p.categoria.departamento`
- `p.ProveedorProducto` NOT `p.proveedores`
- `c.Cliente` NOT `c.cliente`
- `c.Usuario` NOT `c.usuario`
- `c.DetalleCotizacion` NOT `c.detalles`
- `d.Producto` NOT `d.producto`
- `t.Usuario` NOT `t.usuario`
- `t.Sucursal` NOT `t.sucursal`

### Files Fixed (Prisma 7.4 compatibility)

**2026-05-14 - PascalCase en data: de controllers**:
- `ventas.controller.js` — 5 relaciones: Sucursal, Usuario, TurnoCaja, Cliente, DetalleVenta
- `pedidos.controller.js` — DetallePedido (create)
- `compras.controller.js` — DetalleOrdenCompra (create)
- `devoluciones.controller.js` — DetalleDevolucion (era DetalleVenta, nombre incorrecto)

**Backend previo**: `compras.controller.js`, `pedidos.controller.js`, `usuarios.controller.js`, `clientes.controller.js`, `facturacion.controller.js`, `devoluciones.controller.js`, `ventas.controller.js`, `facturas.controller.js`, `bitacora.controller.js`, `ticket.controller.js`, `ticket-corte.controller.js`, `ticketAbono.controller.js`, `productos.controller.js`, `productos.service.js`, `cotizaciones.service.js`, `turnos-caja.controller.js`

**Frontend**: `compras.js`, `productos.js`, `bitacora.js`, `cotizaciones.js`, `historial-cortes.js`, `corte-caja.js`, `dashboard.js`

### Notes
- **dashboard.js**: `producto.InventarioSucursal` (PascalCase), NOT `producto.inventarios`
- **historial-cortes**: Uses `.toolbar` / `.panel` / `.pagination` patterns (same as compras)
- **data: vs include/select**: En `data:` se usan tanto PascalCase para relaciones anidadas (`DetalleVenta: { create: [...] }`) como `{ connect: { id: X } }` para FK. Ambos estilos funcionan, pero el nombre de la clave debe ser PascalCase.

## Known Fixes Applied

### devoluciones.controller.js - Relación incorrecta + PascalCase
- **Bug 1**: Usaba `DetalleVenta` en lugar de `DetalleDevolucion` (el modelo Devolucion tiene esa relación inversa)
- **Bug 2**: Usaba minúsculas en `data:` y `include:` (PascalCase requerido en Prisma 7.4)
- **Fix**: Cambiar a `DetalleDevolucion` con PascalCase en ambas posiciones (líneas 147 y 156)
- **Fecha**: 2026-05-14

### bitacora.controller.js - Crear bitácora MANUAL
- **Bug**: Error al crear bitácora - faltaba campo `actualizadoEn` obligatorio
- **Fix**: Agregar `actualizadoEn: new Date()` en la creación de `Bitacora`
- **Línea**: ~137 (en `tx.bitacora.create`)

## API Endpoints Testeados (2026-05-13)

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
