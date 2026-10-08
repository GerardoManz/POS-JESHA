# Hallazgos Fuera De Alcance

Estos puntos fueron revalidados contra la base `e1ca291c601b72331aeaeb72511904557e4947e9` y no se modificaron.

## Compras

- `compras.js:1383-1500`: el comprobante de recepción abre el popup después de `await fetchEmpresaBranding()`, usa `window.__JESHA_LOGO_URL__` como fallback, interpola datos sin escape/validación de URL y espera `onload` sin timeout ni `decode()`.
- Política esperada: usar únicamente el branding del tenant autorizado, abrir el popup antes del primer `await`, validar URLs, escapar HTML, y esperar carga/decodificación de imágenes con `naturalWidth`, `error` y timeout finito.

## Autofacturación

- `facturar.html:536-574`: la página pública carga el logo recibido desde el endpoint y lo asigna directamente a `img.src`; no hay validación de URL, manejo explícito de error ni fallback visual seguro.
- `facturar.html:539-541`: imprime el token de facturación en consola.
- Política esperada: no registrar tokens ni credenciales; aceptar únicamente URLs HTTP/HTTPS del branding autorizado y mostrar un fallback seguro cuando el recurso falte o falle.

## Scope De Sucursal

- `jesha-pos-backend/src/modules/cotizaciones/cotizaciones.service.js:73-84`: el listado aplica `sucursalId` para roles distintos de `SUPERADMIN`, mientras `SUPERADMIN` puede listar sin ese filtro.
- `jesha-pos-backend/src/modules/cotizaciones/cotizaciones.controller.js:25-33,74-75,139-150,173-180`: las rutas resuelven la sucursal operativa y la pasan al servicio para listar, crear, editar y cambiar estado.
- `cotizaciones.js:1074-1077`: al cargar una cotización al POS se copia la empresa y la sucursal seleccionada al payload local.
- Política esperada: mantener aislamiento por `empresaId`, validar pertenencia de la sucursal mediante el contexto operativo del backend y aplicar la política de acceso por rol; cualquier cambio de esta política requiere una tarea separada.
