#!/usr/bin/env bash
set -euo pipefail

# Whitelist estricta: mantener sincronizada con build-frontend.ps1.
ROOT_ASSETS=(
  bitacora.html clientes.html compras.html configuracion.html corte-caja.html
  cotizaciones.html dashboard.html facturar.html facturas.html historial-cortes.html
  historial.html importacion.html index.html kardex.html login.html pedidos.html
  platform-empresas.html platform-login.html platform-sidebar.html productos.html
  proveedores.html punto-venta.html reportes.html sidebar.html sucursales.html
  transferencias.html usuarios.html

  bitacora.css clientes.css compras.css configuracion.css corte-caja.css
  cotizaciones.css dashboard.css facturas.css historial-cortes.css historial.css
  kardex.css login.css pagination.css pedidos.css platform.css productos.css
  proveedores.css punto-venta.css reportes.css sucursales.css transferencias.css
  view-transitions.css

  bitacora.js catalogos-sat.js clientes.js compras.js config.js configuracion.js
  corte-caja.js cotizaciones.js dashboard.js facturas.js historial-cortes.js
  historial.js importacion.js kardex.js login.js pagination.js pedidos.js platform-empresas.js
  platform-login.js platform-session.js platform-sidebar.js productos.js
  proveedores.js punto-venta.js reportes.js session.js sidebar.js sonidos.js
  sucursales.js fiscal-state.js theme.js transferencias.js usuarios.js

  apple-touch-icon.png favicon.ico favicon-16x16.png favicon-32x32.png
  favicon-48x48.png favicon-64x64.png favicon-128x128.png favicon-192x192.png
  favicon-256x256.png favicon-512x512.png

  gsap.min.js motion.js
)

rm -rf dist
mkdir -p dist

for asset in "${ROOT_ASSETS[@]}"; do
  [[ -f "$asset" ]] || { echo "Asset permitido no encontrado: $asset" >&2; exit 1; }
  cp "$asset" dist/
done

mkdir -p dist/Imagenes
cp -R Imagenes/. dist/Imagenes/

VERSION="${WORKERS_CI_COMMIT_SHA:-${CF_PAGES_COMMIT_SHA:-$(date +%s%3N)}}"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > dist/version.json <<EOF
{
  "v": "${VERSION}",
  "builtAt": "${BUILT_AT}"
}
EOF
