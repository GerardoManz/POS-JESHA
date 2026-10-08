# Branding Documental

## Origen Del Asset

`Imagenes/logo-jesha-documento.png` es una derivada fiel de `Imagenes/logo-jesha.png`, cuyo origen está documentado en el commit inicial `f7fa5a3b6caa1bfb44e9d24d8684deb347376387`. La derivada conserva el dibujo, colores, tipografía y proporción del original; únicamente elimina el fondo blanco mediante alpha y recorta márgenes transparentes.

La versión blanca actual de `Imagenes/logo-jesha.png` se conserva intacta porque pertenece al branding de pantalla/login. No se aplica inversión ni filtro global.

## Contrato

`Empresa.logoDocumentalUrl` es nullable y pertenece al tenant. `Empresa.logoUrl` continúa siendo el logo de pantalla. Cotizaciones prefiere `logoDocumentalUrl`; si está vacío usa el `logoUrl` HTTP/HTTPS del mismo tenant y, si tampoco existe o falla, muestra el nombre comercial. Nunca usa un fallback global.

El campo separado es necesario porque una variante blanca para fondos oscuros y una variante oscura para documentos blancos no pueden compartir el mismo recurso sin afectar una de las superficies.

El SQL `jesha-pos-backend/prisma/manual-sql/20261005_add_logo_documental_url.sql` se aplica manualmente, primero en local y despues en produccion, antes de desplegar el backend.

## Orden De Compatibilidad

1. Columna: aplicar el `ALTER TABLE` localmente y verificar que `Empresa.logoDocumentalUrl` exista y sea nullable.
2. Backend: regenerar Prisma y desplegar el contrato que selecciona/escribe `logoDocumentalUrl` en `/auth/me`, `/branding/logo-documental` y la ruta equivalente de plataforma.
3. Frontend: publicar `session.js`, `cotizaciones.js` y configuración; empresas sin valor documental reciben `null`, usan `logoUrl` HTTP/HTTPS válido y finalmente el nombre comercial.

No se debe publicar el backend antes de que exista la columna, porque Prisma selecciona el campo explícitamente.
