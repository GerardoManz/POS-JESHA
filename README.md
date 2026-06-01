# JESHA POS

Sistema de punto de venta (POS) integral multi-empresa para ferreterias. Gestiona ventas, inventario, compras, facturacion, cuentas de clientes y operaciones multi-sucursal, con aislamiento de datos por empresa (tenant).

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
    |   |-- helpers/
    |   |   |-- getEmpresaId.js   # Extraccion de tenant del JWT
    |   |-- middlewares/          # Auth JWT + guards de rol + acceso sucursal
    |   |-- lib/                  # Prisma + Cloudinary
    |   |-- utils/
    |   |   |-- roles.js          # Jerarquia de roles (JERARQUIA_ROLES)
    |   |-- modules/
    |       |-- auth/             # Login (incluye empresaId en JWT)
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
    |       |-- sucursal/         # Helper + GET endpoint (CRUD parcial)
    |-- prisma/
        |-- schema.prisma         # Esquema completo multi-tenant
```

## Arquitectura Multi-Tenant (Fase 1-SaaS)

Cada empresa es un tenant independiente. El modelo `Empresa` agrupa todos los datos: sucursales, usuarios, productos, ventas, clientes, etc.

**Flujo del tenant**:
1. Login incluye `empresaId` en el payload del JWT
2. Middleware `requireAuth` valida el JWT y adjunta `req.usuario.empresaId`
3. Helper `getEmpresaId(req)` extrae el tenant — lanza 401 si no existe
4. Todos los `.create()` y queries de busqueda scoped por `empresaId`

**Aislamiento**: 17 modelos tienen `empresaId NOT NULL`. Las claves unicas son compuestas (`@@unique([empresaId, folio])`) — mismo folio puede existir en diferentes empresas sin conflicto.

**Catálogos globales**: `Categoria` y `Departamento` con `esGlobal = true` tienen `empresaId = null` y son visibles para todas las empresas.

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
- **Sucursal** -- Multi-sucursal por empresa (GET disponible, CRUD completo pendiente)

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
- **Nuevo (2026-05-27):** Login incluye `empresaId` en el payload JWT. Helper `getEmpresaId(req)` centraliza la extraccion del tenant en todos los controllers.

## Roles de Usuario

```text
PLATFORM_ADMIN          → Todas las empresas, todas las sucursales
  ├── SUPERADMIN        → Una empresa, todas las sucursales
  │   └── ADMIN_SUCURSAL → Una sucursal, gestion completa
  │       └── EMPLEADO   → Una sucursal, operacion de mostrador
  └── PRECIOS           → Solo consulta de precios
```

`PLATFORM_ADMIN` es el nuevo rol tope de jerarquia (2026-05-27) — acceso cross-empresa sin restricciones.

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
- **Select/Include en respuestas**: PascalCase (`Empresa:`, `Cliente:`, `Usuario:`, `Producto:`, `DetalleDevolucion:`, etc.)
- **Property access**: PascalCase tambien (`venta.Devolucion` NO `venta.devoluciones`, `venta.DetalleVenta` NO `venta.detalleVenta`)
- **Acceso al cliente Prisma**: camelCase (`prisma.detalleBitacora`, `prisma.venta`, etc.)
- **Campos escalares (IDs)**: siempre lowercase (`empresaId`, `usuarioId`, `sucursalId`, etc.)
- **Compound unique keys**: formato `campo1_campo2` (`empresaId_codigoInterno`, `empresaId_rfc`, etc.)

### Claves Compuestas con `empresaId`

11 constraints usan `@@unique([empresaId, ...])`:
`Bitacora`, `Cliente` (x2), `Cotizacion`, `OrdenCompra`, `Pedido`, `Producto` (x2), `Proveedor` (x2), `Venta`

```js
// findUnique con compound key
await prisma.producto.findUnique({
  where: { empresaId_codigoInterno: { empresaId, codigoInterno } }
})

// Manejo de P2002 (unique constraint violation)
try {
  await prisma.cliente.create({ data: { empresaId, rfc, /* ... */ } })
} catch (err) {
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'El RFC ya existe en esta empresa' })
  }
}
```

### Errores Tipicos

| Error | Causa | Solucion |
|-------|-------|----------|
| `Argument 'Sucursal' is missing` | `sucursal:` en `data:` | Cambiar a `Sucursal:` |
| `Argument 'DetalleVenta' is missing` | `detalleVenta:` en `data:` | Cambiar a `DetalleVenta:` |
| `Unknown field 'DetalleDevolucion' for include on model Venta` | `DetalleDevolucion` en include de una `Venta` | `DetalleVenta` (Venta), `DetalleDevolucion` (solo Devolucion) |
| `venta.devoluciones is not iterable` | `venta.devoluciones` minusculas | `venta.Devolucion` PascalCase |
| `210001` en lugar de `21001` en stock | Suma Decimal sin `parseFloat` | `parseFloat(inv.stockActual)` |
| P2002 unique constraint | `empresaId` faltante en create | Agregar `empresaId` o usar compound key |

### Frontend
El API devuelve PascalCase. El frontend DEBE usar PascalCase al acceder a propiedades:
- `oc.Proveedor` NO `oc.proveedor`
- `b.Cliente` NO `b.cliente`
- `d.Producto` NO `d.producto`
- `v.Devolucion` NO `v.devoluciones`
- `p.Empresa` NO `p.empresa`

### Helper `getEmpresaId(req)`
```js
const getEmpresaId = require('../helpers/getEmpresaId')
const empresaId = getEmpresaId(req)  // lanza 401 si no hay empresaId en el JWT
```
Usado en 14 controllers para todo `.create()` y queries con scope de tenant.

## Fixes Recientes

### Semana 1 — 2026-05-20
- **devoluciones.controller.js** — Relaciones `DetalleVenta`→`DetalleDevolucion`, PascalCase property access, deduplicacion de productos, `parseFloat` en cantidades
- **clientes.js** — `cliente.saldoCredito` → `cliente.saldoPendiente`
- **auth.middleware.js** — `requireAuth` async + verificacion `usuario.activo`
- **facturas.controller.js** — Cancel SAT con `motive: '02'`
- **sucursal.helper.js** — Nuevo modulo `resolverSucursalId(req)`

### Semana 2 — 2026-05-27 (Multi-Tenant Fase 0-6)
- **Fase 0** — Schema: modelo `Empresa` + `empresaId` en 21 modelos + `@@unique` compuestos + rol `PLATFORM_ADMIN`
- **Fase 1** — Propagacion `empresaId` a todos los `.create()` del backend (14 archivos)
- **Fase 2** — Reversion `Empresa: { connect }` → escalar `empresaId` en 5 archivos
- **Fase 3** — Fix 17 queries rotos por `@@unique` compuestos en productos, importacion, clientes
- **Fase 4** — Manejo P2002 (unique constraint) en clientes con mensajes 409
- **Fase 5** — Fix stock en bitacora.js, PascalCase en ticketAbono.controller.js, default turno
- **Fase 6** — 1,833 caracteres de encoding UTF-8 corregidos en cotizaciones.js + typo en dashboard.js

### 2026-06-01 — Sucursal GET endpoint + apiFetch fix
- **sucursal.controller.js** — Nuevo endpoint `GET /sucursales`: devuelve sucursales activas de la empresa del usuario, scoped por `empresaId`, protegido con `requireAuth`
- **sucursal.routes.js** — Router nuevo (`GET /` → `listar`)
- **app.js** — Ruta `/sucursales` montada entre devoluciones y precios
- **sidebar.js** — `apiFetch` corregido: `res.json().catch(() => null)` antes de validar `res.ok` para evitar `Unexpected token '<'` con respuestas HTML del servidor

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

## Deuda Tecnica (proxima sesion)

- **Login sin empresa**: `findFirst({ username })` puede colisionar entre empresas con el mismo username
- **Login response**: no incluye `empresaId` en el objeto usuario (solo en JWT)
- **`requireSucursalAccess`** y **`sucursal.helper.js`**: no reconocen `PLATFORM_ADMIN` ni validan cross-empresa
