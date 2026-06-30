# AGENTS.md — JESHA POS

## Project Overview

**JESHA POS** is a multi-tenant Point of Sale (POS) system for hardware stores. It manages sales, inventory, purchases, billing, customer accounts, and multi-branch operations across multiple businesses (empresas) via tenant isolation.

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
│   │   ├── app.js                                        # Express routes (public + protected) + /health + /health/db
│   │   ├── server.js                                      # Server entry point
│   │   ├── helpers/
│   │   │   └── getEmpresaId.js                           # Tenant extraction from JWT (all creates)
│   │   ├── middlewares/auth.middleware.js                # JWT auth + role guards + sucursal access
│   │   ├── lib/prisma.js, cloudinary.js                 # Prisma + Cloudinary clients
│   │   ├── utils/
│   │   │   └── roles.js                                  # Role hierarchy (JERARQUIA_ROLES)
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
│   │       ├── facturas/                                # Invoice records
│   │       └── sucursal/                                # Branch helper + GET endpoint (CRUD parcial)
│   └── prisma/
│       └── schema.prisma                                # Full database schema
```

## Git Workflow — Cómo subir cambios a `main` (procedimiento explícito)

### Modelo de trabajo

- **Default: trabajo directo sobre `main`.** Los cambios de rutina (correcciones, ajustes de lógica, fixes puntuales) se commitean en `main` local y se empujan a `origin/main`. No se crean ramas para esto.
- **Excepción deliberada: rama + PR.** Solo para features grandes y aislables que el usuario pida explícitamente (ej. PR2 pago mixto ya integrado; PR3/PR4 de granel/pausadas/hover pendientes). Tras el merge, limpiar la rama local y remota como se hizo en PR2.
- **Regla de oro ante errores: NUNCA crear una rama para escapar de un problema.** Si algo sale mal, se resuelve sobre `main` con `stash`, `rebase` o `revert`. La proliferación de ramas divergentes es exactamente lo que se quiere evitar.
- **Producción es en vivo.** Cada push a `origin/main` despliega automáticamente: backend a Render, frontend a Cloudflare, golpeando a las cajeras reales. En push directo no hay gate de revisión, así que **probar en Brave contra el entorno local antes de empujar es obligatorio.**

### 1. Pre-flight (antes de tocar cualquier archivo)

```powershell
git switch main
git fetch origin
git status --short --branch
```

Esperado: `## main...origin/main` sin `ahead`/`behind`.
- Si dice `behind N`: `git pull --ff-only origin main` y reconfirmar.
- Si dice `ahead` inesperado o `diverged`: **PARAR** (ver tabla de recuperación).

### 2. Verificar ANTES de commitear

1. `node --check <archivo>` en **cada** `.js` tocado. Si falla, no continuar.
2. Probar en Brave contra local (`npm run dev`). Confirmar el comportamiento real, no asumirlo.
3. Revisar exactamente qué cambió:
   ```powershell
   git --no-pager diff
   git status --short
   ```
   `status` debe mostrar SOLO los archivos esperados. Si aparece algo más, **PARAR** y revisar antes de hacer stage.

### 2.1. Protocolo de pruebas locales (entrada al sistema + endpoints)

Este proyecto no se valida solo con `node --check`: cada cambio funcional debe probarse contra el sistema local cuando sea factible.

#### Levantar backend local

```powershell
cd jesha-pos-backend
npm run dev
```

Si necesitas arrancar sin nodemon:

```powershell
cd jesha-pos-backend
node src/server.js
```

Verificar proceso y base de datos:

```powershell
curl.exe -sS http://localhost:3000/health
curl.exe -sS http://localhost:3000/health/db
```

Resultado esperado:
- `/health` responde `status: ok` (proceso Node vivo).
- `/health/db` responde `db: connected` (Prisma + PostgreSQL funcionando).

Si arrancaste el backend con `Start-Process` o en segundo plano, detén el proceso al terminar la prueba.

#### Levantar frontend local

Desde la raíz del repo:

```powershell
npx serve .
```

También se puede usar Live Server en VS Code. Abrir `login.html` en `localhost`. `config.js` detecta `localhost` / `127.0.0.1` / LAN local y apunta a `http://localhost:3000`.

#### Entrar al sistema local

Ruta normal:
1. Abrir `login.html` desde el servidor local.
2. Iniciar sesión con un usuario existente de la BD local.
3. Confirmar que `localStorage` contiene `jesha_token` y `jesha_usuario`.
4. Navegar a la página que se quiere probar (`dashboard.html`, `punto-venta.html`, `productos.html`, etc.).

Si la BD local no tiene contraseña conocida, NO inventar credenciales ni tocar producción. Para pruebas locales de endpoints protegidos se permite generar un JWT temporal con `JWT_SECRET` y un usuario activo de la BD local. Reglas:
- Solo contra `localhost`.
- No imprimir el token en respuestas finales.
- No pegar tokens en el chat.
- No guardar tokens en archivos del repo.
- No usar este método para producción.

Ejemplo de prueba HTTP directa con token temporal en memoria (sin frontend):

```powershell
cd jesha-pos-backend
node -e 'require("dotenv").config(); const jwt=require("jsonwebtoken"); const prisma=require("./src/lib/prisma"); (async()=>{ const u=await prisma.usuario.findFirst({where:{activo:true,empresaId:1},select:{id:true,username:true,nombre:true,rol:true,sucursalId:true,empresaId:true}}); if(!u) throw new Error("No hay usuario local activo"); const token=jwt.sign(u,process.env.JWT_SECRET,{expiresIn:"15m"}); const res=await fetch("http://localhost:3000/productos/sat/sugerir",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({nombre:"disco corte 7",unidadVenta:"pza",esGranel:false})}); console.log(await res.text()); await prisma.$disconnect(); })().catch(async e=>{ console.error(e.message); try{await prisma.$disconnect()}catch{}; process.exit(1); })'
```

#### Cómo probar cualquier cambio

Backend:
- Probar al menos un caso exitoso del endpoint o flujo tocado.
- Probar al menos un error esperado (400/401/404/409 según aplique).
- Confirmar que no responde 500.
- Si el endpoint escribe en BD, verificar persistencia recargando o consultando el dato por API.

Frontend:
- Abrir la página local real en Brave.
- Usar DevTools Network para confirmar que las llamadas van a `localhost:3000`.
- Confirmar comportamiento visible y persistencia al recargar cuando aplique.
- Revisar consola por errores JS.

Endpoints protegidos:
- Preferir login real local.
- Si no hay login local, usar JWT temporal local como arriba.
- Nunca reutilizar token de producción.

#### Checks finales antes de stage

```powershell
node --check <cada-js-tocado>
git --no-pager diff --check
git --no-pager diff
git status --short
```

Si existe `.gitattributes` con `eol=lf`, avisos como `CRLF will be replaced by LF` son normales en Windows. `git diff --check` debe terminar con código 0; si reporta whitespace errors, corregir antes de commitear.

### 3. Commit y push

```powershell
git add <archivos-específicos>                     # nunca "git add ." a ciegas
git commit -m "tipo(scope): mensaje en español"    # un solo propósito por commit
git push origin main
```

`git push origin main` debe aceptarse como fast-forward.

### 4. Confirmar después del push

```powershell
git status --short --branch        # ## main...origin/main, sin ahead
git --no-pager log --oneline -3
```

Luego verificar el deploy: Render (backend) y Cloudflare (frontend) reconstruyen solos. Si tocaste frontend, revisar el banner de versión y la checklist de "Cloudflare Workers - Deploy Seguro".

---

### Cuándo PARAR y qué hacer (recuperación sin crear ramas)

Regla transversal: si aparece `force`, `non-fast-forward`, `diverged`, `fetch first`, o un conflicto que no puedes resolver con confianza → **detente y reporta la salida literal antes de seguir.** No improvises, no uses `--force`, no uses `git reset --hard` sobre `main`.

| Síntoma | Qué significa | Recuperación (sobre `main`, sin rama) |
|---------|---------------|----------------------------------------|
| `push` rechazado: `non-fast-forward` / `fetch first` | `origin/main` avanzó; estás detrás | `git fetch origin` → `git pull --rebase origin main` (reaplica tus commits encima, historia lineal) → reintentar push |
| Working tree sucio al sincronizar | Cambios sin commitear que estorban | `git stash push -m "wip <desc>"` → sincronizar → `git stash pop` |
| Commit equivocado **NO** empujado | Error en el último commit local | `git reset --soft HEAD~1` (conserva cambios en staging para rehacer). NUNCA `--hard` |
| Commit equivocado **YA** empujado | No se reescribe historia en `main` | `git revert <sha>` → `git push origin main`. `main` solo avanza, nunca se reescribe |
| `pull --ff-only` falla: `diverged` | Local y remoto tienen commits distintos | **PARAR.** `git tag respaldo-main-<fecha>` (tag, no rama) → `git pull --rebase origin main` → reportar antes de seguir |
| Conflicto en `rebase` irresoluble | El replay chocó | `git rebase --abort` (vuelve al estado previo) → reportar el conflicto |
| Rechazo del remoto por permisos / protección de rama | Acceso o regla de GitHub | PARAR y reportar; no reintentar con flags |

El tag de respaldo (`respaldo-main-<fecha>`) es la **única** red de seguridad tipo "rama" permitida, y técnicamente es un tag: no aparece en `git branch` ni contamina el listado. Se usa solo antes de un rebase de reconciliación y se borra (`git tag -d respaldo-main-<fecha>`) una vez confirmado que todo quedó bien.

### Recordatorios de merge (si en algún momento se usa rama + PR)

- Si el PR se integra con `Rebase and merge` o `Squash merge`, el SHA cambia: `git branch -d` NO detectará el merge por ancestría. Verificar equivalencia con `git --no-pager cherry main <rama>` (espera `-`) o `git log --cherry-mark --left-right` antes de borrar con `-D`.
- No borrar stashes ni tags/ramas de respaldo hasta confirmar que ya no se necesitan.
- No dejar WIP largo acumulado en `main`; si el trabajo queda incompleto, aparcarlo en `stash` (nunca en una rama nueva improvisada).

## Arquitectura Multi-Tenant (Fase 1-SaaS)

### `Empresa` — Modelo Tenant

Cada empresa es un tenant aislado. El modelo `Empresa` tiene:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | Int (PK) | Autoincremental |
| `slug` | String (unique) | Identificador único de tenant (ej. `jesha`, `ferre-plus`) |
| `nombreComercial` | String | Nombre visible de la empresa |
| `razonSocial` | String | Razón social fiscal |
| `rfc` | String? | RFC de la empresa |
| `whatsapp` | String | Teléfono WhatsApp |
| `notas` | String? | Notas administrativas |
| `activa` | Boolean | Soft-disable de empresa |

`Empresa` tiene relaciones con **21 modelos**: todos los modelos transaccionales + catálogos + auditoría.

### Aislamiento por Tenant

El `empresaId` fluye así:

1. **Login** → `auth.controller.js` incluye `empresaId` en el payload del JWT
2. **Middleware** → `requireAuth` valida el JWT y adjunta `req.usuario` (con `empresaId`)
3. **Helper** → `getEmpresaId(req)` extrae `req.usuario.empresaId` y lanza 401 si falta
4. **Controllers** → todos los `.create()` y queries usan `empresaId` para aislar datos

### Modelos con `empresaId`

#### NOT NULL (17 modelos — obligatorio en create)

`AbonoBitacora`, `AlertaStock`, `Bitacora`, `Cliente`, `Cotizacion`, `Devolucion`, `FacturaCfdi`, `MovimientoCaja`, `MovimientoInventario`, `OrdenCompra`, `Pedido`, `Producto`, `Promocion`, `Proveedor`, `Sucursal`, `TurnoCaja`, `Venta`

#### NULLABLE (4 modelos — opcional según contexto)

| Modelo | Cuándo es NULL | Cuándo tiene valor |
|--------|---------------|-------------------|
| `Usuario` | Usuario global (PLATFORM_ADMIN / SUPERADMIN sin empresa fija) | Usuario de una empresa específica |
| `Categoria` | `esGlobal = true` (catálogo compartido) | `esGlobal = false` (catálogo por empresa) |
| `Departamento` | `esGlobal = true` (catálogo compartido) | `esGlobal = false` (catálogo por empresa) |
| `Auditoria` | Siempre NULL (registro cross-tenant intencional) | Nunca se setea actualmente |

#### Heredados (9 modelos — sin `empresaId` propio)

`AbonoCompra`, `DetalleBitacora`, `DetalleCotizacion`, `DetalleDevolucion`, `DetalleOrdenCompra`, `DetallePedido`, `DetalleVenta`, `InventarioSucursal`, `ProveedorProducto`

Estos heredan el tenant de su modelo padre (ej: `DetalleVenta` pertenece a la misma empresa que `Venta`).

### `@@unique` Compuestos con `empresaId`

11 constraints requieren `empresaId` como parte de la clave única:

| Modelo | `@@unique` |
|--------|-----------|
| `Bitacora` | `[empresaId, folio]` |
| `Cliente` | `[empresaId, rfc]`, `[empresaId, email]` |
| `Cotizacion` | `[empresaId, folio]` |
| `OrdenCompra` | `[empresaId, folio]` |
| `Pedido` | `[empresaId, folio]` |
| `Producto` | `[empresaId, codigoInterno]`, `[empresaId, codigoBarras]` |
| `Proveedor` | `[empresaId, nombreOficial]`, `[empresaId, alias]` |
| `Venta` | `[empresaId, folio]` |

**Cómo usarlos en queries:**

```js
// findUnique con clave compuesta
await prisma.producto.findUnique({
  where: { empresaId_codigoInterno: { empresaId, codigoInterno } }
})

// findFirst con ambos campos
await prisma.cliente.findFirst({
  where: { empresaId, rfc }
})

// Unique constraint al crear — Prisma lo maneja automáticamente
await prisma.bitacora.create({
  data: { empresaId, folio, /* ... */ }
})
```

**Manejo de P2002 (unique constraint violation):**

```js
try {
  await prisma.cliente.create({ data: { empresaId, rfc, /* ... */ } })
} catch (err) {
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'El RFC ya existe en esta empresa' })
  }
  throw err
}
```

### Catálogos Globales vs. por Empresa

`Categoria` y `Departamento` tienen el campo `esGlobal`:

- **`esGlobal = true`**: `empresaId = null`. Visible para todas las empresas. Creado por un PLATFORM_ADMIN.
- **`esGlobal = false`**: `empresaId` tiene valor. Pertenece a una empresa específica.

El `@@unique` compuesto `[empresaId, departamentoId, nombre]` en Categoria y `[empresaId, nombre]` en Departamento permite nombres duplicados entre empresas pero no dentro de la misma empresa.

### `getEmpresaId(req)` — Helper Centralizado

**Ubicación**: `jesha-pos-backend/src/helpers/getEmpresaId.js`

```js
const getEmpresaId = require('../helpers/getEmpresaId')
// Uso en todos los controllers:
const empresaId = getEmpresaId(req)
// Lanza 401 si req.usuario.empresaId no existe
```

**Usado en 15 controllers con 32+ call sites**:
`ventas`, `productos` (+ importación), `clientes`, `bitacora`, `cotizaciones`, `pedidos`, `compras`, `devoluciones`, `inventario`, `turnos-caja`, `facturacion`, `sucursal`

### Roles y Jerarquía

```text
PLATFORM_ADMIN          → Todas las empresas, todas las sucursales
  ├── SUPERADMIN        → Una empresa, todas las sucursales
  │   └── ADMIN_SUCURSAL → Una sucursal, gestión completa
  │       └── EMPLEADO   → Una sucursal, operación de mostrador
  └── PRECIOS           → Solo consulta de precios (sin sucursal)
```

**`puedeGestionar(rolSuperior, rolInferior)`** en `utils/roles.js` implementa la jerarquía programáticamente.

**Gaps conocidos en middleware** (deuda técnica documentada):

| Gap | Archivo | Impacto |
|-----|---------|---------|
| `requireSucursalAccess` no reconoce `PLATFORM_ADMIN` | `auth.middleware.js:57` | PLATFORM_ADMIN restringido a una sucursal |
| `resolverSucursalId()` no reconoce `PLATFORM_ADMIN` | `sucursal.helper.js:16` | PLATFORM_ADMIN no puede ver todas las sucursales |
| Login no recibe `empresaSlug` — colisión de usernames | `auth.controller.js:13` | Dos empresas con mismo username = ambigüedad |
| Login response no incluye `empresaId` | `auth.controller.js:45` | Frontend depende de `/auth/me` para saber la empresa |

---

## Database Schema (Prisma)

### Core Entities

- **Empresa** — Tenant (multi-empresa). Slug único, nombre comercial, RFC, WhatsApp
- **Sucursal** — Branches (pertenece a una Empresa)
- **Usuario** — Users with roles: `PLATFORM_ADMIN`, `SUPERADMIN`, `ADMIN_SUCURSAL`, `EMPLEADO`, `PRECIOS`
- **Cliente** — Customers with credit limits and fiscal data (RFC, regimen, CFDI)
- **Producto** — Products with pricing, codes, SAT keys, granel (bulk) support
- **Categoria / Departamento** — Product catalog hierarchy (global or per-empresa)
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
5. JWT payload includes: `{ id, username, nombre, rol, sucursalId, empresaId }`
6. All API requests include `Authorization: Bearer <token>`
7. Backend middleware `requireAuth` validates JWT, checks `usuario.activo` in DB, attaches `req.usuario`
8. Controllers extract `empresaId` via `getEmpresaId(req)` and `sucursalId` via `resolverSucursalId(req)`
9. Logout clears localStorage and redirects to login

## API Configuration

- **config.js** auto-detects environment: `localhost` / `127.0.0.1` / `192.168.0.190` → local API (`http://localhost:3000`)
- Otherwise → production API (`https://jesha-pos-api.onrender.com`)
- IVA rate: `0.16` (16%) — stored in `CONFIG.IVA`

## Cloudflare Workers - Deploy Seguro

El Worker de produccion se llama `jeshapos` y es assets-only. `wrangler.toml` debe mantenerse sin `main` y con `[assets] directory = "./dist"`, `html_handling = "auto-trailing-slash"` y `not_found_handling = "404-page"`.

Regla de oro: **whitelist, no denylist**. `build-frontend.sh` copia solo lo explicitamente permitido: `*.html`, `*.css`, `*.js` del primer nivel, `Imagenes/` y `version.json`. Cualquier archivo o carpeta nueva queda fuera por defecto. Para publicar algo nuevo, agregarlo conscientemente a la whitelist; nunca publicar por descarte.

Prohibiciones operativas:

- Nunca usar `assets.directory = "."`.
- Nunca publicar la raiz del repo.
- Nunca usar `npx wrangler deploy --temporary` para este proyecto.
- Nunca pegar tokens de Cloudflare en el chat o en archivos del repo.
- Nunca pushear `main` local divergente ni con `--force` (ver "Git Workflow"). Los cambios llegan a `main` por push directo o, para features grandes, por PR; en ambos casos `main` solo avanza hacia adelante.

`dist/` es la unica carpeta publica. `README.md`, `AGENTS.md`, `jesha-pos-backend/`, `SAT/`, `files/`, `repomix-output.xml` y cualquier otro archivo fuera de la whitelist viven en el repo pero NO se publican.

Contrato de versionado del banner:

```json
{ "v": "...", "builtAt": "..." }
```

`sidebar.js` consume `data.v`. No cambiar `version.json` a claves como `version` o `buildTime` sin actualizar tambien el checker.

Validaciones obligatorias antes de cualquier deploy real:

```powershell
Test-Path dist\jesha-pos-backend
Test-Path dist\repomix-output.xml
Test-Path dist\AGENTS.md
Test-Path dist\SAT
Test-Path dist\files
Test-Path dist\version.json
```

Resultado esperado: `False`, `False`, `False`, `False`, `False`, `True`.

Siempre ejecutar `npx wrangler deploy --dry-run` antes de `npx wrangler deploy`. Si `dry-run` falla o `dist/` contiene archivos fuera de whitelist, detenerse y reportar.

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
- Credit limit tracking with `saldoPendiente` (NOT `saldoCredito` — that field does not exist)
- `@@unique([empresaId, rfc])` — RFC único por empresa, no global

### Facturacion (CFDI)
- Uses Facturapi for CFDI 4.0
- Public route (`/facturar`) for invoice request via token
- Generates PDF and XML download

### Devoluciones (Returns)
- Validates returned quantities against original sale + previously returned amounts
- Reingrates inventory: `stockActual = parseFloat(stockActual) + cantidad`
- Creates `DEVOLUCION_ENTRADA` movement for stock increase
- Creates `DEVOLUCION` movement in caja (negative amount) for REEMBOLSO/CAMBIO_PARCIAL
- Supports partial returns, bitsácora updates for credit sales

### Sucursal (Branches)
- **GET /sucursales**: Implementado — devuelve sucursales activas de la empresa del usuario (scoped por `empresaId`). Protegido con `requireAuth`.
- **Helper**: `sucursal.helper.js` → `resolverSucursalId(req)` — centralized branch resolution
- **CRUD completo**: Pendiente (POST/PUT/DELETE + frontend page)
- Model exists in schema, belongs to an `Empresa`

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
| `jesha-pos-backend/prisma/schema.prisma` | Complete DB schema with all models/enums + multi-tenant |
| `jesha-pos-backend/src/lib/prisma.js` | Prisma client con pool config (max, connectionTimeoutMillis, idleTimeoutMillis, maxLifetimeSeconds) |
| `jesha-pos-backend/src/server.js` | Server entry point con crash handlers (unhandledRejection, uncaughtException) + HTTP timeouts |
| `jesha-pos-backend/src/app.js` | Express routes (public + protected) + /health + /health/db |
| `jesha-pos-backend/src/helpers/getEmpresaId.js` | Tenant extraction from JWT (all creates use it) |
| `jesha-pos-backend/src/middlewares/auth.middleware.js` | JWT validation + user active check + role guards |
| `jesha-pos-backend/src/utils/roles.js` | Role hierarchy (`JERARQUIA_ROLES`, `puedeGestionar`) |
| `jesha-pos-backend/src/modules/auth/auth.controller.js` | Login — includes `empresaId` in JWT payload |
| `jesha-pos-backend/src/modules/ventas/ventas.controller.js` | Sales business logic + dashboard KPIs |
| `jesha-pos-backend/src/modules/bitacora/bitacora.controller.js` | Customer ledger logic |
| `jesha-pos-backend/src/modules/devoluciones/devoluciones.controller.js` | Returns with deduplicated products + parseFloat |
| `jesha-pos-backend/src/modules/sucursal/sucursal.helper.js` | Centralized `resolverSucursalId(req)` helper |
| `jesha-pos-backend/src/modules/sucursal/sucursal.controller.js` | GET /sucursales — lista sucursales activas por empresa |
| `jesha-pos-backend/src/modules/sucursal/sucursal.routes.js` | Router de sucursales (GET /) |
| `config.js` | Frontend API URL + IVA config |
| `sidebar.js` | Global nav + auth guard + apiFetch con parseo JSON seguro |
| `punto-venta.js` | POS cart logic |

## Development Commands

```bash
# Backend
cd jesha-pos-backend
npm run dev          # Start with nodemon (local)
npm start            # Production start
npm run seed         # Seed database
npm run studio       # Prisma Studio
npx prisma generate  # Regenerar el cliente Prisma tras un cambio de esquema

# Frontend (static files)
# Serve with: npx serve .  OR  Live Server in VS Code
```

> ⚠️ **NO usar `npm run migrate`, `prisma migrate` ni `prisma db push` en este proyecto.** Los cambios de esquema se aplican como `ALTER TABLE` manual: primero en local (pgAdmin), luego en producción (DBeaver), siempre dentro de una transacción con verificación `SELECT COUNT(*)` antes del `COMMIT`. Después de aplicar el SQL, ejecutar `npx prisma generate` para sincronizar el cliente.
>
> Aunque `package.json` contenga scripts `migrate`/`build` que invoquen `prisma migrate`, no se ejecutan manualmente. **Pendiente de verificar:** si el build de Render dispara `prisma migrate` automáticamente, eso contradice el protocolo de ALTER manual y debe revisarse.

---

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
- `Empresa:`, `Cliente:`, `Usuario:`, `Producto:`, `Sucursal:`, `Proveedor:`, `Categoria:`, `Departamento:`, `InventarioSucursal:`, `DetalleVenta:`, `DetalleBitacora:`, `DetalleOrdenCompra:`, `DetallePedido:`, `DetalleCotizacion:`, `AbonoBitacora:`, `AbonoCompra:`, `Bitacora:`, `DetalleDevolucion:`, `TurnoCaja:`, `Venta:`, `Devolucion:`

**3. Prisma client calls (model access)** — camelCase (NUNCA cambiar)
- `prisma.detalleBitacora.create(...)`, `tx.detalleOrdenCompra.update(...)`, `prisma.inventarioSucursal.upsert(...)`, etc.

**4. Where filter relations** — PascalCase
- `where: { Bitacora: { clienteId: ... } }`, `where: { ProveedorProducto: { some: ... } }`

**5. Scalar fields (IDs)** — siempre lowercase
- `empresaId`, `usuarioId`, `sucursalId`, `clienteId`, `productoId`, `categoriaId`, `turnoId`, `ordenCompraId`, `pedidoId`, etc.

**6. Compound unique keys** — formato `campo1_campo2`
- `empresaId_codigoInterno`, `empresaId_rfc`, `empresaId_folio`, etc.

**7. Auditoria create** — usar scalars, NO nested connect
- `prisma.auditoria.create({ data: { accion, modulo, referencia, usuarioId, sucursalId } })`

### Typical Errors (Debugging)

| Error Message | Causa | Fix |
|---------------|-------|-----|
| `Argument 'Sucursal' is missing` | `sucursal:` en `data:` | Cambiar a `Sucursal:` |
| `Argument 'DetalleVenta' is missing` | `detalleVenta:` en `data:` | Cambiar a `DetalleVenta:` |
| `Unknown field 'DetalleDevolucion' for include on model Venta` | `DetalleDevolucion` no existe en Venta | Usar `DetalleVenta` (Venta), `DetalleDevolucion` solo en Devolucion |
| `Invalid tx.venta.create()` | relación mal escrita en data | Verificar PascalCase en todo el `data:` |
| P2002 unique constraint | `empresaId` no incluido en create | Agregar `empresaId` o usar compound key |

**8. Property access on returned Prisma objects** — PascalCase for relations
When you use `include: { Devolucion: true }` on a `Venta` query, the returned object has `venta.Devolucion` (PascalCase), NOT `venta.devoluciones`.

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
- `p.Empresa` NOT `p.empresa`
- `c.Cliente` NOT `c.cliente`
- `c.Usuario` NOT `c.usuario`
- `c.DetalleCotizacion` NOT `c.detalles`
- `d.Producto` NOT `d.producto`
- `t.Usuario` NOT `t.usuario`
- `t.Sucursal` NOT `t.sucursal`
- `v.Devolucion` NOT `v.devoluciones`
- `v.DetalleVenta` NOT `v.detalleVenta`

---

## 🚨 Prisma Decimal + Arithmetic = STRING CONCATENATION

**CRITICAL BUG PATTERN**: In JavaScript, when you add a Prisma `Decimal` field to a Number using the `+` operator, JavaScript coerces the Decimal to a **string** and performs **string concatenation** instead of numeric addition.

```js
// ❌ WRONG — "21000" + 1 → "210001" (string, not 21001)
const stockDespues = inv.stockActual + det.cantidad

// ✅ CORRECT — parseFloat first
const stockAntes = parseFloat(inv.stockActual)
const stockDespues = stockAntes + det.cantidad
```

### Rule: ALWAYS `parseFloat()` Prisma Decimal fields before arithmetic

| Operation | Wrong | Correct |
|-----------|-------|---------|
| Stock sum | `inv.stockActual + qty` | `parseFloat(inv.stockActual) + qty` |
| Price calc | `det.cantidad * precio` | `parseFloat(det.cantidad) * parseFloat(precio)` |
| Balance | `saldo - monto` | `parseFloat(saldo) - monto` |
| Accumulation | `(map[id] \|\| 0) + val` | `(map[id] \|\| 0) + parseFloat(val)` |

### Granel precision: always `toFixed(3)` before storing

```js
// ✅ For granel (Decimal(10,3)):
const stockDespues = parseFloat((stockAntes + det.cantidad).toFixed(3))

// ✅ For money (Decimal(10,2)):
const nuevoSaldo = parseFloat((saldo + monto).toFixed(2))
```

### Known affected patterns (audited 2026-05-20)

| File | Line | Field | Status |
|------|------|-------|--------|
| `devoluciones.controller.js` | 60 | `det.cantidad` (DetalleDevolucion) | ✅ Fixed |
| `devoluciones.controller.js` | 89 | `detalleOriginal.cantidad` (DetalleVenta) | ✅ Fixed |
| `devoluciones.controller.js` | 180-181 | `inv.stockActual` (InventarioSucursal) | ✅ Fixed |
| `devoluciones.controller.js` | 372 | `det.cantidad` (porVenta summary) | 🟡 Pending |
| `bitacora.controller.js` | 584 | `bitacora.saldoPendiente` | 🟡 Pending |
| `bitacora.controller.js` | 667 | `stockAntes` + `cantReintegrar` | 🟡 Pending |
| `turnos-caja.controller.js` | 77 | `efectivoEsperado` | 🟡 Pending |
| `facturacion.controller.js` | 202 | `precioUnitario * cantidad` | 🟡 Pending |

---

## Facturapi Cancel — Requires `motive`

```js
// ❌ WRONG — Facturapi throws "motive is required"
await fp.invoices.cancel(factura.facturapiId)

// ✅ CORRECT — include motive code (SAT 01-04)
const { motivo: motivoCancelacion = '02' } = req.body || {}
await fp.invoices.cancel(factura.facturapiId, { motive: motivoCancelacion })
// '01' — Emitido con errores con relación
// '02' — Emitido con errores sin relación (default)
// '03' — No se llevó a cabo la operación
// '04' — Operación nominativa en factura global
```

## Devoluciones — Deduplication + parseFloat Rules

**The inventory reingreso loop MUST use `parseFloat` on all quantities** and **deduplicate products** before processing:

```js
// 1. Deduplicate (same product in 2 sale lines = 1 return entry)
const productosMap = {}
for (const item of productos) {
  const pid = parseInt(item.productoId)
  if (!pid || !item.cantidad || parseFloat(item.cantidad) <= 0) {
    return res.status(400).json({ error: '...' })
  }
  if (productosMap[pid]) {
    productosMap[pid].cantidad += parseFloat(item.cantidad)
  } else {
    productosMap[pid] = { ...item, productoId: pid, cantidad: parseFloat(item.cantidad) }
  }
}

// 2. Process deduplicated
for (const item of Object.values(productosMap)) {
  const detalleOriginal = venta.DetalleVenta.find(d => d.productoId === item.productoId)
  const cantidadDisponible = parseFloat(detalleOriginal.cantidad) - (yaDevuelto[item.productoId] || 0)
  // ... validate, accumulate, push
}

// 3. Reingrese inventory with parseFloat + toFixed(3)
const stockAntes = parseFloat(inv.stockActual)
const stockDespues = parseFloat((stockAntes + det.cantidad).toFixed(3))
```

## New Module: `sucursal.helper.js`

Centralized branch resolution for all controllers. Located at:
`jesha-pos-backend/src/modules/sucursal/sucursal.helper.js`

```js
const resolverSucursalId = require('../sucursal/sucursal.helper')
// Usage: const sucursalId = resolverSucursalId(req)
// SUPERADMIN: can specify via query/body/params
// Others: uses token's sucursalId
```

**Known gap**: does not recognize `PLATFORM_ADMIN` role. See "Deuda Técnica" section.

## Updated Auth Middleware (2026-05-20)

- `requireAuth` is now **async** — validates JWT + checks `usuario.activo` in BD
- `JsonWebTokenError` / `TokenExpiredError` → 401
- Any other error (DB connection, etc.) → 500 with log
- Sets `req.usuario = payload` (includes `empresaId`, `sucursalId`, `rol`, etc.)

## Dashboard KPIs (2026-05-20)

- `ventasHoy.total` now shows **net sales** (gross - devoluciones with REEMBOLSO/CAMBIO_PARCIAL)
- `ventasHoy.totalBruto` shows gross sales before returns
- `ventasHoy.devoluciones` shows total returned amount
- Uses same date range (`desdeDate`/`hastaDate`) across all queries

---

## Connection Pool & Stability (2026-06-25)

### Problema: Congelamiento diario a las 4:30 PM

El sistema se congelaba todos los días ~4:30 PM (16:30). UptimeRobot no lo detectaba porque el endpoint `/health` nunca tocaba la base de datos. La causa raíz era un **leak del pool de conexiones de PostgreSQL**: conexiones se acumulaban gradualmente durante ~8 horas de operación hasta agotar las 10 disponibles (default de `pg-pool`). Sin `connectionTimeoutMillis`, las nuevas requests esperaban **indefinidamente** por una conexión, provocando el freeze total.

### Fix A: Pool de Prisma (`src/lib/prisma.js`)

```js
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 10,                        // explícito (default)
  connectionTimeoutMillis: 10000, // 10s máx esperando conexión → error en vez de freeze
  idleTimeoutMillis: 30000,       // 30s inactiva → se cierra (default era 10s, muy agresivo)
  maxLifetimeSeconds: 3600,       // 1h máx por conexión → reciclado forzado
})
```

| Parámetro | Default antiguo | Valor nuevo | Efecto |
|-----------|----------------|-------------|--------|
| `connectionTimeoutMillis` | `0` (infinito) | `10000` (10s) | Si el pool está lleno, error en 10s en vez de colgarse para siempre |
| `idleTimeoutMillis` | `10000` (10s) | `30000` (30s) | Conexiones inactivas sobreviven 30s (evita crear/destruir constantemente) |
| `maxLifetimeSeconds` | `0` (sin límite) | `3600` (1h) | Cada conexión se recicla cada hora → previene acumulación de leaks |

### Fix B: Crash handlers + HTTP timeouts (`src/server.js`)

```js
const server = app.listen(PORT, '0.0.0.0', () => { ... })

server.keepAliveTimeout = 65000    // > que el timeout de Render (55s)
server.headersTimeout = 66000      // > que keepAliveTimeout

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err)
})
```

- **`keepAliveTimeout`/`headersTimeout`**: evitan que el proxy de Render cierre la conexión antes que el servidor, causando `ECONNRESET`.
- **`unhandledRejection`**: promesa rechazada sin `.catch()` → antes crash silencioso, ahora loguea y sigue vivo.
- **`uncaughtException`**: excepción no capturada → antes mataba el proceso, ahora loguea y mantiene el proceso (el event loop puede quedar inestable, pero es preferible a perder todo el servicio sin diagnóstico).

### Fix C: Health check con BD (`src/app.js`)

```js
app.get('/health/db', async (req, res) => {
  try {
    const prisma = require('./lib/prisma')
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('Health/DB error:', err.message)
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message })
  }
})
```

- **`GET /health`**: sin cambios, no toca BD (útil para saber si el proceso Node vive).
- **`GET /health/db`**: hace un `SELECT 1` real. Si la BD no responde → `503`. **Configurar UptimeRobot para monitorear este endpoint**, no `/health`.

### Fix D: Timeouts a nivel PostgreSQL (pgAdmin + DBeaver)

Ejecutar **una sola vez** en local (pgAdmin) y producción (DBeaver):

```sql
ALTER DATABASE jesha_db SET statement_timeout = '30s';
ALTER DATABASE jesha_db SET idle_in_transaction_session_timeout = '60s';
```

Verificación:

```sql
SELECT d.datname, s.setconfig
FROM pg_db_role_setting s
JOIN pg_database d ON d.oid = s.setdatabase
WHERE d.datname = 'jesha_db';
```

- **`statement_timeout = 30s`**: PostgreSQL mata cualquier query que exceda 30 segundos. Previene que una consulta mal optimizada bloquee una conexión del pool indefinidamente.
- **`idle_in_transaction_session_timeout = 60s`**: mata conexiones con transacción abierta inactiva por más de 60s. Previene el leak causado por `BEGIN` sin `COMMIT`/`ROLLBACK`.

---

## Files Fixed (Prisma 7.4 compatibility)

**2026-05-14 - PascalCase en data: de controllers**:
- `ventas.controller.js` — 5 relaciones: Sucursal, Usuario, TurnoCaja, Cliente, DetalleVenta
- `pedidos.controller.js` — DetallePedido (create)
- `compras.controller.js` — DetalleOrdenCompra (create)
- `devoluciones.controller.js` — DetalleDevolucion (era DetalleVenta, nombre incorrecto)

**2026-05-20 - Semana 1 fixes (dev, auth, facturas, helper)**:
- `devoluciones.controller.js` — 7 reemplazos: `DetalleVenta` → `DetalleDevolucion` en Devolucion relations. Fix: `venta.Devolucion` (PascalCase para property access). Deduplication + `parseFloat` en cantidades. `parseFloat(inv.stockActual)` antes de suma.
- `clientes.js` — `saldoCredito` → `saldoPendiente` (campo real en schema)
- `auth.middleware.js` — `async` + query BD para `usuario.activo` + catch por tipo de error
- `facturas.controller.js` — `fp.invoices.cancel()` con `motive` + check `!fp` → 500
- `sucursal/sucursal.helper.js` — nuevo archivo: `resolverSucursalId(req)` centralizado

**2026-05-27 - Fase 0-5: Multi-Tenant (empresaId)**:
- `helpers/getEmpresaId.js` — nuevo helper centralizado para extraer tenant del JWT
- **Fase 0**: Schema — agregado `Empresa` + `empresaId` a 21 modelos + `@@unique` compuestos
- **Fase 1**: Propagación `empresaId` a `.create()` en controllers core: `ventas`, `compras`, `devoluciones`, `pedidos`, `cotizaciones`, `bitacora`, `turnos-caja`, `inventario`, `facturacion`
- **Fase 2**: `Empresa: { connect }` → escalar `empresaId` en 5 archivos revertidos + connects convertidos a scalars
- **Fase 3**: Fix queries rotos por `@@unique` compuestos — 17 cambios en 4 archivos (`productos.controller.js`, `importacion.controller.js`, `clientes.controller.js`, `clientes.service.js`)
- **Fase 4**: Fix P2002 en `clientes.controller.js` — mensajes 409 amigables para RFC/email duplicados
- **Fase 5**: Fix stock en `bitacora.js` (campo mal nombrado), fix PascalCase en `ticketAbono.controller.js`, fix default turno en `punto-venta`
- **Fase 6**: Encoding UTF-8 — 1833 caracteres double-encoded corregidos en `cotizaciones.js`, typo `Sinagotados` en `dashboard.js:164`

**Backend previo**: `compras.controller.js`, `pedidos.controller.js`, `usuarios.controller.js`, `clientes.controller.js`, `facturacion.controller.js`, `devoluciones.controller.js`, `ventas.controller.js`, `facturas.controller.js`, `bitacora.controller.js`, `ticket.controller.js`, `ticket-corte.controller.js`, `ticketAbono.controller.js`, `productos.controller.js`, `productos.service.js`, `cotizaciones.service.js`, `turnos-caja.controller.js`

**Frontend**: `compras.js`, `productos.js`, `bitacora.js`, `cotizaciones.js`, `historial-cortes.js`, `corte-caja.js`, `dashboard.js`

**2026-06-01 - Sucursal GET endpoint + apiFetch fix**:
- `sucursal/sucursal.controller.js` — nuevo: `GET /sucursales` scoped por `empresaId`, solo activas, protegido con `requireAuth`
- `sucursal/sucursal.routes.js` — nuevo: router con `GET /` → `listar`
- `app.js` — montada ruta `/sucursales` entre devoluciones y precios
- `sidebar.js` — `apiFetch`: `res.json().catch(() => null)` antes de validar `res.ok` (evita `Unexpected token '<'` con respuestas HTML)

**2026-06-25 - Connection pool + stability guards**:
- `src/lib/prisma.js` — pool config: connectionTimeoutMillis=10s, idleTimeoutMillis=30s, maxLifetimeSeconds=1h
- `src/server.js` — crash handlers (unhandledRejection, uncaughtException) + HTTP timeouts (keepAliveTimeout=65s, headersTimeout=66s)
- `src/app.js` — nuevo endpoint GET /health/db (SELECT 1 real, responde 503 si BD no accesible)

### Notes
- **dashboard.js**: `producto.InventarioSucursal` (PascalCase), NOT `producto.inventarios`
- **historial-cortes**: Uses `.toolbar` / `.panel` / `.pagination` patterns (same as compras)
- **data: vs include/select**: En `data:` se usan tanto PascalCase para relaciones anidadas (`DetalleVenta: { create: [...] }`) como `{ connect: { id: X } }` para FK. Ambos estilos funcionan, pero el nombre de la clave debe ser PascalCase.

## Known Fixes Applied

### devoluciones.controller.js - Relación incorrecta + PascalCase + parseFloat
- **Bug 1**: Usaba `DetalleVenta` en lugar de `DetalleDevolucion` en el include del objeto Devolucion
- **Bug 2**: Usaba `venta.devoluciones` en lugar de `venta.Devolucion` (PascalCase en acceso a propiedad)
- **Bug 3**: `inv.stockActual` (Prisma Decimal) + número = concatenación de strings → stock masivo incorrecto
- **Fix**: Cambiar a `DetalleDevolucion` con PascalCase + `parseFloat` + deduplicación de productos

### bitacora.controller.js - Crear bitácora MANUAL
- **Bug**: Error al crear bitácora - faltaba campo `actualizadoEn` obligatorio
- **Fix**: Agregar `actualizadoEn: new Date()` en la creación de `Bitacora`

### facturas.controller.js - Cancelar factura SAT
- **Bug**: Cancel local no llamaba a `fp.invoices.cancel()` — factura seguía activa en SAT
- **Bug 2**: Falta `motive` requerido por Facturapi API
- **Fix**: Agregar `await fp.invoices.cancel(facturaId, { motive: '02' })` con check `!fp` → 500

### auth.middleware.js - Usuario desactivado
- **Bug**: JWT válido seguía funcionando aunque el usuario fuera desactivado
- **Fix**: `requireAuth` ahora es `async`, consulta `usuario.activo` en BD después de validar JWT

### dashboard.js — Ventas netas
- **Bug**: Devoluciones con reembolso no se descontaban del total
- **Fix**: `ventasHoy.total` ahora es `ventasNetasHoy = totalBruto - montoDevuelto`

### clientes.js — Campo de crédito
- **Bug**: Usaba `cliente.saldoCredito` que no existe en el modelo
- **Fix**: Cambio a `cliente.saldoPendiente`

### clientes.controller.js + clientes.js + clientes.css — Validación campos fiscales obligatorios
- **Feature**: Al crear/editar cliente FISCAL ahora son obligatorios RFC, Email, Razón Social, CP Fiscal, Régimen Fiscal y Uso CFDI
- **Backend** (`crear` y `editar`): validan los 6 campos y devuelven `{ error, errores: [{ campo, mensaje }] }` con mensaje individual por campo faltante
- **Frontend** (`actualizarCamposDinamicos`): `required` dinámico + limpieza de clase `input-error` al cambiar tipo
- **Frontend** (submit): validación client-side con `jeshaToast` por campo + borde rojo. Si hay error, no se envía al servidor
- **Frontend** (fetch): manejo de respuesta `errores[]` del backend — resalta campos y muestra toasts
- **CSS** (`clientes.css`): nueva clase `.input-error` (borde rojo + sombra)

### clientes.css + clientes.html — Fix diseño modal clientes (desbordamiento + cortes)
- **Bug**: Modal de crear/editar cliente se desbordaba horizontalmente con selects largos (`601 – General de Ley Personas Morales`). Labels cortados. Selectores `.modal-content` genéricos afectaban también al modal de historial.
- **Fix**: Scoped todos los estilos del modal por ID (`#modal-cliente`, `#modal-historial`). Ancho aumentado a `860px`. Labels con `white-space: normal` y `overflow-wrap: break-word`. Fila SAT asimétrica (`fiscal-row-sat` con CP compacto, régimen ancho). Override scoped de selects globales de `dashboard.css`. Sin cambios en `dashboard.css` ni otros módulos.

### cotizaciones.js — Doble codificación UTF-8
- **Bug**: Archivo con doble codificación UTF-8: acentos, emojis, em dashes, símbolos todos corruptos
- **Fix**: 1,833 caracteres corregidos con script Node.js. Acentos (`áéíóúñ`), símbolos (`¿·→`), separadores (`═─`), emojis normalizados.

### bitacora.js — Stock incorrecto en búsqueda de productos
- **Bug**: Usaba `p.inventarios?.[0]?.stockActual` (campo no existe con ese nombre)
- **Fix**: `p.stock ?? p.inventario?.stockActual ?? 0` (convenience field del backend + fallback)

### ticketAbono.controller.js — PascalCase en propiedad
- **Bug**: `const { bitacora } = abono` → `undefined` (Prisma devuelve `abono.Bitacora`)
- **Fix**: `const bitacora = abono.Bitacora`

### punto-venta — Turno default
- **Bug**: Valor default del turno era 0 en lugar de 2000
- **Fix**: `punto-venta.html:210` y `punto-venta.js:257` → `value="2000"`

### prisma.js + server.js + app.js — Connection pool exhaust diario (freeze 4:30 PM)
- **Bug**: Pool de `pg-pool` sin `connectionTimeoutMillis` → leaks graduales durante ~8h agotan las 10 conexiones → requests esperan infinitamente → freeze total
- **Bug 2**: `/health` no tocaba BD → UptimeRobot nunca detectaba el colapso
- **Bug 3**: Sin `unhandledRejection`/`uncaughtException` → crash silencioso en producción
- **Fix**: Pool con timeouts explícitos + crash handlers + `/health/db` + `statement_timeout` a nivel PostgreSQL

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
| `/sucursales` | GET | ✅ OK |

---

## Deuda Técnica (documentada para futura sesión)

### Login — Empresa no especificada
- **Archivo**: `auth.controller.js:13`
- **Problema**: `findFirst({ username, activo: true })` no scopa por `empresaId`. Si dos empresas tienen el mismo username, el login es ambiguo.
- **Fix**: Recibir `empresaSlug` desde el frontend, buscar `findFirst({ username, Empresa: { slug } })`.

### Login — Respuesta sin empresaId
- **Archivo**: `auth.controller.js:45`
- **Problema**: `POST /auth/login` no incluye `empresaId` en el objeto `usuario` de la respuesta. El frontend necesita decodificar el JWT o llamar `/auth/me` para saber la empresa.
- **Fix**: Agregar `empresaId: usuario.empresaId` al objeto `usuario` en la respuesta.

### Middleware — PLATFORM_ADMIN no reconocido
- **Archivo**: `auth.middleware.js:57` (`requireSucursalAccess`)
- **Problema**: Solo chequea `req.usuario.rol === 'SUPERADMIN'` para bypass. PLATFORM_ADMIN no tiene bypass.
- **Fix**: Agregar `|| req.usuario.rol === 'PLATFORM_ADMIN'`.

### sucursal.helper.js — PLATFORM_ADMIN no reconocido
- **Archivo**: `sucursal.helper.js:16` (`resolverSucursalId`)
- **Problema**: Solo chequea `rol === 'SUPERADMIN'` para acceso multi-sucursal. PLATFORM_ADMIN cae al path de usuario normal.
- **Fix**: Agregar `rol === 'PLATFORM_ADMIN'` al bypass.

### requireSucursalAccess — Sin validación cross-empresa
- **Archivo**: `auth.middleware.js:57`
- **Problema**: No verifica que la sucursal solicitada pertenezca a la misma empresa que el usuario. Un usuario de empresa A podría acceder a sucursal de empresa B adivinando el ID.
- **Fix**: Query adicional para validar que `sucursal.empresaId === req.usuario.empresaId` (excepto PLATFORM_ADMIN).

### Código muerto — Servicios no usados
- **Archivos**: `clientes.service.js`, `productos.service.js`
- **Problema**: No son importados por ningún módulo. Solo se corrigieron por consistencia de `@@unique`.
- **Acción**: Evaluar si eliminarlos o reactivarlos.

### Endpoint muerto — Ticket de abono
- **Endpoint**: `GET /bitacoras/abonos/:abonoId/ticket`
- **Problema**: Nunca llamado por el frontend. Roto por diseño (`req.params` vs `req.query`).
- **Acción**: Documentado, no se modifica hasta que se necesite.

---

## Operaciones de Inventario Masivo (Restock / Consolidación)

### Reglas operativas (lectura obligatoria antes de cualquier restock)

1. **Nunca ejecutar scripts de restock sin preview.** Ejecutar SELECT de previsualización y revisar NO_EXISTE y AMBIGUO antes de cualquier UPDATE.
2. **Nunca usar DELETE físico** para productos duplicados. Usar `activo = false`.
3. **No cambiar `codigoInterno`** de productos desactivados. Los tickets y reportes históricos muestran el valor actual del campo vía `productoId` (no hay snapshot al momento de la venta). Cambiarlo rompe la trazabilidad de ventas antiguas.
4. **Poner `codigoBarras = NULL`** en productos duplicados desactivados para liberar la ambigüedad entre `codigoInterno` y `codigoBarras`.
5. **Siempre crear `MovimientoInventario`** para mantener el kardex. Usar `AJUSTE_POSITIVO` para restock, `AJUSTE_NEGATIVO` para salida por consolidación.
6. **Si el producto duplicado tiene `ProveedorProducto` que el conservado no tiene**, moverlo al conservado. Validar que no viole `@@unique([proveedorId, productoId])`.
7. **No tocar costos ni precios** en un restock administrativo (`AJUSTE_POSITIVO`). Solo `ENTRADA_COMPRA` actualiza `Producto.costo` y `Producto.costoPromedio`.
8. **No mezclar limpieza global de catálogo con restock puntual.** Son operaciones con riesgos distintos.
9. **Usar referencias únicas por lote** en `MovimientoInventario.referencia` (ej: `RESTOCK-MAYO-2026`, `CONSOLIDACION-DUPLICADOS-MAYO-2026`).
10. **En DBeaver/psql: asegurar COMMIT.** Un script con `BEGIN;` sin `COMMIT;` muestra éxito en sesión local pero no persiste. Para operaciones grandes usar un solo statement atómico sin BEGIN/COMMIT explícitos.

### Referencias de lotes históricos aplicados

| Referencia | Fecha | Operación | Movimientos |
|------------|-------|-----------|-------------|
| `RESTOCK-MAYO-2026` | 2026-05-29 | Restock masivo desde Excel | 491 (AJUSTE_POSITIVO) |
| `CONSOLIDACION-DUPLICADOS-MAYO-2026` | 2026-05-29 | Consolidación de 18 duplicados | 34 (17 POSITIVO + 17 NEGATIVO) |

Detalles completos en: `docs/operaciones/restock-mayo-2026.md`

### Query rápida de validación post-restock

```sql
SELECT referencia, tipo, COUNT(*) AS movimientos, ROUND(SUM(cantidad), 3) AS total
FROM "MovimientoInventario"
WHERE referencia LIKE 'RESTOCK-%' OR referencia LIKE 'CONSOLIDACION-%'
GROUP BY referencia, tipo ORDER BY referencia, tipo;
```

### Pitfall conocido: DBeaver + BEGIN sin COMMIT

Durante el restock de mayo 2026, un script con `BEGIN;` pero sin `COMMIT;` al final provocó que DBeaver mostrara los cambios como aplicados (sesión activa), pero al desconectar la sesión PostgreSQL hizo ROLLBACK implícito. El stock volvió a los valores originales y `MovimientoInventario` quedó vacío. **Solución:** regenerar el script como un solo statement atómico sin `BEGIN`/`COMMIT` explícitos.
