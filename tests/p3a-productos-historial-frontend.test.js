const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'productos.html'), 'utf8')
const js = fs.readFileSync(path.join(root, 'productos.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'productos.css'), 'utf8')
const sidebar = fs.readFileSync(path.join(root, 'sidebar.js'), 'utf8')
const feature = js.slice(js.indexOf('// HISTORIAL ECONÓMICO'), js.indexOf('// CARGA DE DATOS'))

test('F01 SUPERADMIN ve botón', () => {
  assert.match(js, /PUEDE_VER_HISTORIAL\s*=\s*\['SUPERADMIN'/)
  assert.match(js, /if \(ES_ADMIN\)[\s\S]*?\$\{historial\}/)
})

test('F02 ADMIN_SUCURSAL ve botón', () => {
  assert.match(js, /\['SUPERADMIN', 'ADMIN_SUCURSAL', 'PRECIOS'\]/)
})

test('F03 PRECIOS ve botón', () => {
  assert.match(js, /if \(ES_PRECIOS\)[\s\S]*?return `\$\{historial\}/)
})

test('F04 EMPLEADO no ve botón', () => {
  assert.match(js, /if \(ES_EMPLEADO\)[\s\S]*?return `<button class="btn-icon btn-editar-basico"/)
  assert.doesNotMatch(js, /\['SUPERADMIN', 'ADMIN_SUCURSAL', 'PRECIOS', 'EMPLEADO'\]/)
})

test('F05 PLATFORM_ADMIN directo no obtiene bypass', () => {
  assert.doesNotMatch(js, /PUEDE_VER_HISTORIAL[^\n]*PLATFORM_ADMIN/)
})

test('F06 abre el historial del producto correcto', () => {
  assert.match(feature, /productosLista\.find\(item => Number\(item\.id\) === Number\(productoId\)\)/)
  assert.match(feature, /actualizarIdentidadHistorial\(historialProductoActivo\)/)
})

test('F07 el botón X cierra el drawer', () => {
  assert.match(html, /id="historial-producto-cerrar"/)
  assert.match(feature, /historial-producto-cerrar'\)\?\.addEventListener\('click', cerrarHistorialProducto\)/)
})

test('F08 Escape cierra el drawer', () => {
  assert.match(feature, /event\.key === 'Escape'[\s\S]*?cerrarHistorialProducto\(\)/)
})

test('F09 abrir A y después B reinicia datos', () => {
  assert.match(feature, /resetEstadoTabsHistorial\(\)[\s\S]*?historialProductoActivo\s*=\s*\{/)
})

test('F10 una respuesta anterior no sobrescribe el producto nuevo', () => {
  assert.match(feature, /openingVersion !== historialAperturaVersion/)
  assert.match(feature, /historialProductoActivo\?\.id !== productoId/)
  assert.match(feature, /requestId !== state\.requestId/)
  assert.match(feature, /historialAbortControllers/)
  assert.match(feature, /cancelAnimationFrame\(historialAperturaFrame\)/)
})

test('F11 renderiza eventos de catálogo', () => {
  assert.match(feature, /eventos\.forEach\(evento =>/)
  assert.match(feature, /historial-evento/)
})

test('F12 renderiza todos los detalles del evento', () => {
  assert.match(feature, /filas\.forEach\(detalle =>/)
})

test('F13 null se presenta como guion', () => {
  assert.match(feature, /valor === null \|\| valor === undefined \|\| valor === ''\) return '—'/)
})

test('F14 cero conserva su valor', () => {
  const formatter = feature.slice(feature.indexOf('function formatoValorHistorial'), feature.indexOf('function etiquetaDesconocida'))
  assert.match(formatter, /Number\.isFinite\(numero\)/)
  assert.doesNotMatch(formatter, /if \(!valor\) return '—'/)
})

test('F15 campos monetarios usan formato de moneda', () => {
  assert.match(feature, /HISTORIAL_CAMPOS_MONEDA\.has\(campo\).*\$\$\{numero\.toFixed\(2\)\}/)
})

test('F16 margen usa porcentaje', () => {
  assert.match(feature, /campo === 'margen'.*numero\.toFixed\(2\).*%/)
})

test('F17 factor de conversión no usa moneda', () => {
  assert.match(feature, /campo === 'factorConversion'.*numero\.toFixed\(4\)/)
  assert.doesNotMatch(js.match(/const HISTORIAL_CAMPOS_MONEDA = new Set\(\[[\s\S]*?\]\)/)[0], /factorConversion/)
})

test('F18 catálogo vacío tiene estado útil', () => {
  assert.match(feature, /Aún no hay cambios económicos registrados para este producto/)
})

test('F19 muestra primerEventoRegistradoEn sin afirmar historial completo', () => {
  assert.match(feature, /meta\?\.primerEventoRegistradoEn/)
  assert.match(feature, /Historial registrado desde/)
  assert.doesNotMatch(feature, /Historial completo desde/)
})

test('F20 catálogo usa paginación backend', () => {
  assert.match(feature, /renderPaginacionHistorial\(panel, 'catalogo', payload\?\.paginacion\)/)
})

test('F21 compras se cargan al abrir su tab', () => {
  assert.match(feature, /seleccionarTabHistorial\(tab[\s\S]*?cargarTabHistorial\(tab\)/)
})

test('F22 compras no se solicitan al abrir drawer', () => {
  const open = feature.slice(feature.indexOf('function abrirHistorialProducto'), feature.indexOf('function cerrarHistorialProducto'))
  assert.match(open, /seleccionarTabHistorial\('catalogo'\)/)
  assert.doesNotMatch(open, /seleccionarTabHistorial\('compras'\)/)
})

test('F23 renderiza filas de compras', () => {
  assert.match(feature, /Array\.isArray\(payload\?\.\[tipo\]\)/)
  assert.match(feature, /historial-observaciones/)
})

test('F24 compras muestran proveedor', () => {
  assert.match(feature, /row\?\.proveedor\?\.alias \|\| row\?\.proveedor\?\.nombreOficial/)
})

test('F25 compras muestran sucursal', () => {
  assert.match(feature, /\['Sucursal', row\?\.sucursal\?\.nombre \|\| '—'\]/)
})

test('F26 compras usan resumen backend', () => {
  assert.match(feature, /renderResumenObservado\(panel, payload\?\.resumen, tipo\)/)
})

test('F27 etiqueta promedio ponderado', () => {
  assert.match(feature, /\['Promedio ponderado',/)
})

test('F28 compras tienen empty state', () => {
  assert.match(feature, /Aún no hay compras observadas para este producto/)
})

test('F29 ventas tienen lazy loading', () => {
  assert.match(feature, /const endpoint = tab === 'catalogo' \? 'historial-economico' : `historial-\$\{tab\}`/)
  assert.match(feature, /state\.pages\.has\(page\)/)
})

test('F30 renderiza filas de ventas', () => {
  assert.match(feature, /renderObservadoHistorial\(tab, payload\)/)
})

test('F31 ventas se etiquetan como precio observado', () => {
  assert.match(feature, /Precio observado de venta/)
})

test('F32 ventas muestran cantidad', () => {
  assert.match(feature, /\['Cantidad', fmtStock\(row\?\.cantidad\)\]/)
})

test('F33 ventas muestran resumen backend', () => {
  assert.match(feature, /tipo === 'compras' \? 'Última compra' : 'Última venta'/)
})

test('F34 ventas tienen empty state', () => {
  assert.match(feature, /Aún no hay ventas observadas para este producto/)
})

test('F35 compras no se mezclan en catálogo', () => {
  assert.match(feature, /tab === 'catalogo' \? 'historial-economico'/)
  assert.match(feature, /if \(tab === 'catalogo'\)[\s\S]*?renderCatalogoHistorial\(payload\)/)
})

test('F36 ventas no se mezclan en catálogo', () => {
  assert.match(html, /id="historial-panel-catalogo"[\s\S]*?id="historial-panel-compras"[\s\S]*?id="historial-panel-ventas"/)
})

test('F37 catálogo conserva etiqueta propia', () => {
  assert.match(html, />Cambios de catálogo<\/button>/)
})

test('F38 costo observado no se etiqueta como costo actual', () => {
  assert.match(feature, /Costo observado de compra/)
  assert.match(feature, /costos observados de recepción, no cambios de catálogo/)
})

test('F39 401 conserva flujo de autenticación existente', () => {
  assert.match(feature, /apiFetch\(endpointTabHistorial/)
  assert.match(sidebar, /if \(res\.status === 401\)/)
})

test('F40 403 muestra mensaje de permiso', () => {
  assert.match(feature, /error\?\.status === 403 \|\| \/acceso\|permiso\|denegad\|forbidden\/i/)
  assert.match(feature, /if \(esPermiso\) return 'No tienes permisos para consultar este historial/)
})

test('F41 404 muestra producto no encontrado', () => {
  assert.match(feature, /error\?\.status === 404.*Producto no encontrado/)
})

test('F42 500 usa mensaje seguro', () => {
  assert.match(feature, /No fue posible cargar el historial/)
  assert.match(feature, /if \(tab === 'catalogo'\) renderActualHistorial\(null\)/)
  assert.doesNotMatch(feature, /error\.stack|error\.message/)
})

test('F43 payload parcial no rompe el drawer', () => {
  assert.match(feature, /Array\.isArray\(payload\?\.historial\)/)
  assert.match(feature, /Array\.isArray\(evento\?\.detalles\)/)
  assert.match(feature, /payload \|\| \{\}/)
})

test('drawer mantiene seguridad, accesibilidad y responsive básico', () => {
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="historial-producto-titulo"/)
  assert.match(html, /role="tablist"/)
  assert.match(html, /role="tabpanel"/)
  assert.match(feature, /\.textContent\s*=/)
  assert.doesNotMatch(feature, /\.innerHTML\s*=/)
  assert.match(feature, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(feature, /historialElementoApertura/)
  assert.match(feature, /!historialDrawer\.contains\(document\.activeElement\) \|\| !focusables\.includes\(document\.activeElement\)/)
  assert.match(feature, /!historialOverlay\.classList\.contains\('active'\)/)
  assert.match(css, /\.historial-drawer-overlay\s*\{[\s\S]*?pointer-events: none/)
  assert.match(css, /\.historial-drawer-overlay\.active\s*\{[\s\S]*?pointer-events: auto/)
  assert.match(js, /aria-label="Ver historial económico de \$\{escaparHtml\(p\.nombre/)
  assert.match(css, /\.producto-card-actions \.actions-cell[\s\S]*?flex-wrap: wrap/)
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.historial-drawer\s*\{[\s\S]*?width: 100%/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
})
