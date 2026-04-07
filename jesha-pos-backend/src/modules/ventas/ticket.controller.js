const prisma  = require('../../lib/prisma')
const QRCode  = require('qrcode')
const fs      = require('fs')
const path    = require('path')

// ── Datos fijos de JESHA ──
const EMPRESA = {
  nombre:   'Ferretería e Iluminación JESHA',
  slogan:   'Productos y Servicios de Máxima Calidad',
  direccion:'Av. San Simón #03',
  ciudad:   'Guadalupe, Zacatecas',
  tel1:     '492 101 6879',
}

const FACTURACION_URL = process.env.FRONTEND_URL || process.env.BASE_URL || 'http://192.168.0.190:3000'

// ── Cargar logo como base64 una sola vez ──
function cargarLogoBase64() {
  const rutas = [
    path.join(__dirname, '../../../../Imagenes/logo-jesha.png'),
    path.join(__dirname, '../../../public/Imagenes/logo-jesha.png'),
    path.join(__dirname, '../../../../public/Imagenes/logo-jesha.png'),
    path.join(process.cwd(), 'Imagenes/logo-jesha.png'),
    path.join(process.cwd(), '../Imagenes/logo-jesha.png'),
    path.join(process.cwd(), 'public/Imagenes/logo-jesha.png'),
  ]
  for (const ruta of rutas) {
    if (fs.existsSync(ruta)) {
      const data = fs.readFileSync(ruta)
      console.log(`✅ Logo encontrado en: ${ruta}`)
      return `data:image/png;base64,${data.toString('base64')}`
    }
  }
  console.warn('⚠️  Logo no encontrado — se omitirá en el ticket')
  return null
}

let LOGO_BASE64 = null
try { LOGO_BASE64 = cargarLogoBase64() } catch(e) { console.warn('⚠️  Error cargando logo:', e.message) }

// ════════════════════════════════════════════════════════════════════
//  GET /ventas/:id/ticket
// ════════════════════════════════════════════════════════════════════

const generarTicket = async (req, res) => {
  try {
    const venta = await prisma.venta.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        cliente:  { select: { nombre: true } },
        usuario:  { select: { nombre: true } },
        detalles: {
          include: {
            producto: { select: { nombre: true, codigoInterno: true } }
          }
        }
      }
    })

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })

    const isProduction = process.env.NODE_ENV === 'production'
    const facturarPath = isProduction ? '/facturar.html' : '/facturar'
    const urlFacturacion = `${FACTURACION_URL}${facturarPath}?token=${venta.tokenQr}`

    const qrDataUrl = await QRCode.toDataURL(urlFacturacion, {
      width: 200, margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    })

    const totalEfectivo      = venta.metodoPago === 'EFECTIVO'                       ? parseFloat(venta.total) : 0
    const totalTarjeta       = ['CREDITO','DEBITO'].includes(venta.metodoPago)       ? parseFloat(venta.total) : 0
    const totalTransferencia = venta.metodoPago === 'TRANSFERENCIA'                  ? parseFloat(venta.total) : 0
    const totalCredito       = venta.metodoPago === 'CREDITO_CLIENTE'                ? parseFloat(venta.total) : 0

    const fecha   = new Date(venta.creadaEn || venta.fecha || venta.createdAt)
    const fechaStr = `${String(fecha.getDate()).padStart(2,'0')}/${String(fecha.getMonth()+1).padStart(2,'0')}/${String(fecha.getFullYear()).slice(-2)}`

    const html = generarHTMLTicket(venta, qrDataUrl, fechaStr, { totalEfectivo, totalTarjeta, totalTransferencia, totalCredito })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)

  } catch (err) {
    console.error('❌ Error generando ticket:', err)
    res.status(500).json({ error: err.message })
  }
}

const generarTicketThermal = async (req, res) => {
  generarTicket(req, res)
}

// ════════════════════════════════════════════════════════════════════
//  GENERADOR HTML — Optimizado para GHIA GTP582 (58mm)
//  ✅ Corregido: legibilidad, alineación, jerarquía visual
// ════════════════════════════════════════════════════════════════════

function generarHTMLTicket(venta, qrDataUrl, fechaStr, pagos) {
  // Formateador seguro — siempre 2 decimales
  const fmt = v => {
    const num = parseFloat(v || 0)
    return `$${num.toFixed(2)}`
  }

  const filaProductos = (venta.detalles || []).map(d => {
    const subtotal = parseFloat(d.subtotal ?? d.importe ?? (parseFloat(d.precioUnitario || 0) * parseFloat(d.cantidad || 1)))
    const nombre   = d.producto?.nombre || d.descripcion || '—'
    const qty      = parseFloat(d.cantidad || 1)
    const qtyStr   = Number.isInteger(qty) ? qty.toString() : qty.toFixed(3).replace(/\.?0+$/, '')
    const precio   = parseFloat(d.precioUnitario || 0)
    return `<tr>
      <td class="td-prod">${nombre}<br><span class="td-det">${qtyStr} x ${fmt(precio)}</span></td>
      <td class="td-imp">${fmt(subtotal)}</td>
    </tr>`
  }).join('')

  const folioCorto = venta.folio?.split('-').pop() || venta.folio
  const cajero     = venta.usuario?.nombre || '—'
  const descuento  = parseFloat(venta.descuento || 0)
  const subtotalV  = parseFloat(venta.subtotal || 0)

  const metodoLabel = {
    EFECTIVO:        'Efectivo',
    CREDITO:         'T. Crédito',
    DEBITO:          'T. Débito',
    TRANSFERENCIA:   'Transferencia',
    CREDITO_CLIENTE: 'Crédito cliente'
  }[venta.metodoPago] || venta.metodoPago

  const montoPagado  = parseFloat(venta.montoPagado || 0)
  const cambio       = parseFloat(venta.cambio || 0)
  const seccionPago  = venta.metodoPago === 'EFECTIVO'
    ? `<tr><td class="lbl">Recibido:</td><td class="val">${fmt(montoPagado)}</td></tr>
       <tr class="bold"><td class="lbl">Cambio:</td><td class="val">${fmt(cambio)}</td></tr>`
    : ''

  // Logo: reducido a 25mm, sin filtro invert (causa pérdida de contraste en térmicas)
  const logoHTML = LOGO_BASE64
    ? `<img src="${LOGO_BASE64}" alt="JESHA" class="logo" />`
    : `<div class="logo-text">JESHA</div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=48mm"/>
<title>Ticket ${venta.folio}</title>
<style>
/* ═══════════════════════════════════════════════
   RESET + BASE — Optimizado para térmica 58mm
   ═══════════════════════════════════════════════ */
@page {
  margin: 0;
  size: 58mm auto;
}
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
html, body {
  width: 48mm;              /* 58mm papel - ~5mm márgenes físicos de la impresora */
  max-width: 48mm;
  margin: 0 auto;
  padding: 2mm 0;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 11px;
  color: #000;
  background: #fff;
  line-height: 1.3;
  font-weight: 700;         /* TODO BOLD por defecto — térmica necesita peso */
}

/* ═══ ENCABEZADO ═══ */
.hdr {
  text-align: center;
  padding-bottom: 2mm;
}
.logo {
  display: block;
  margin: 0 auto 1.5mm;
  width: 25mm;
  height: auto;
  image-rendering: crisp-edges;
}
.logo-text {
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 3px;
}
.emp {
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.slg {
  font-size: 8px;
  font-weight: 700;
  margin-top: 0.5mm;
}
.dir {
  font-size: 8px;
  font-weight: 700;
  margin-top: 0.3mm;
}
.tel {
  font-size: 9px;
  font-weight: 900;
  margin-top: 1mm;
  letter-spacing: 0.5px;
}

/* ═══ SEPARADORES ═══ */
.sep {
  border: 0;
  border-top: 1px dashed #000;
  margin: 1.5mm 0;
}
.sep-bold {
  border: 0;
  border-top: 2px solid #000;
  margin: 1.5mm 0;
}

/* ═══ INFO DE VENTA ═══ */
.info {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}
.info td {
  padding: 0.3mm 0;
  vertical-align: top;
}
.info .lbl {
  text-align: left;
  font-weight: 700;
}
.info .val {
  text-align: right;
  font-weight: 900;
}

/* ═══ TABLA DE PRODUCTOS ═══ */
.tbl-hdr {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
  font-weight: 900;
}
.tbl-hdr td:first-child { text-align: left; }
.tbl-hdr td:last-child  { text-align: right; }

.tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;       /* CLAVE: anchos fijos para alineación */
}
.td-prod {
  width: 72%;
  padding: 1mm 0;
  font-size: 10px;
  font-weight: 900;         /* Nombre del producto en negrita fuerte */
  word-break: break-word;
  line-height: 1.25;
  vertical-align: top;
}
.td-det {
  font-size: 9px;
  font-weight: 700;         /* Detalle qty x precio ligeramente menos pesado */
}
.td-imp {
  width: 28%;
  padding: 1mm 0;
  font-size: 11px;
  font-weight: 900;
  text-align: right;
  white-space: nowrap;
  vertical-align: top;
}

/* ═══ TOTALES ═══ */
.totales {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}
.totales td {
  padding: 0.3mm 0;
}
.totales .lbl {
  text-align: left;
  font-weight: 700;
}
.totales .val {
  text-align: right;
  font-weight: 900;
}
.total-row td {
  font-size: 14px;
  font-weight: 900;
  padding: 1mm 0;
}
.bold td {
  font-weight: 900;
}

/* ═══ QR Y PIE ═══ */
.qr {
  text-align: center;
  margin: 2mm 0;
}
.qr img {
  width: 25mm;
  height: 25mm;
  image-rendering: pixelated;      /* QR nítido en térmica */
  -ms-interpolation-mode: nearest-neighbor;
}
.qr-lbl {
  font-size: 8px;
  font-weight: 700;
  margin-top: 1mm;
}
.pie {
  text-align: center;
  font-size: 9px;
  font-weight: 900;
  margin-top: 1.5mm;
  line-height: 1.3;
}
.pie-legal {
  text-align: center;
  font-size: 7px;
  font-weight: 700;
  margin-top: 1.5mm;
  line-height: 1.25;
}

/* ═══ BOTÓN IMPRIMIR (solo pantalla) ═══ */
.no-print {
  display: block;
  margin: 10px auto 5px;
  padding: 10px 24px;
  background: #1f3a66;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

/* ═══ MEDIA PRINT — Forzar máxima legibilidad ═══ */
@media print {
  .no-print { display: none !important; }
  html, body {
    width: 48mm;
    max-width: 48mm;
    padding: 1mm 0;
    font-weight: 900;        /* Máximo peso en impresión */
  }
  * {
    color: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .logo {
    /* SIN filter:invert — la térmica ya imprime en negro sobre blanco */
    filter: contrast(2) brightness(0);    /* Maximizar contraste del logo */
  }
  img {
    image-rendering: crisp-edges;
  }
}
</style>
</head>
<body>

<!-- ═══ ENCABEZADO ═══ -->
<div class="hdr">
  ${logoHTML}
  <div class="emp">${EMPRESA.nombre}</div>
  <div class="slg">${EMPRESA.slogan}</div>
  <div class="dir">${EMPRESA.direccion}</div>
  <div class="dir">${EMPRESA.ciudad}</div>
  <div class="tel">Tel. ${EMPRESA.tel1}</div>
</div>

<hr class="sep"/>

<!-- ═══ INFO DE VENTA ═══ -->
<table class="info">
  <tr><td class="lbl">${fechaStr}</td><td class="val">Folio: ${folioCorto}</td></tr>
  <tr><td class="lbl">Cajero:</td><td class="val">${cajero}</td></tr>
  ${venta.cliente ? `<tr><td class="lbl">Cliente:</td><td class="val">${venta.cliente.nombre}</td></tr>` : ''}
</table>

<hr class="sep-bold"/>

<!-- ═══ ENCABEZADO DE PRODUCTOS ═══ -->
<table class="tbl-hdr"><tr><td>Descripción</td><td>Importe</td></tr></table>
<hr class="sep"/>

<!-- ═══ PRODUCTOS ═══ -->
<table class="tbl">
  <tbody>
    ${filaProductos || '<tr><td colspan="2" style="text-align:center;padding:2mm 0;">Sin productos</td></tr>'}
  </tbody>
</table>

<hr class="sep"/>

<!-- ═══ TOTALES ═══ -->
<table class="totales">
  <tr><td class="lbl">Subtotal:</td><td class="val">${fmt(subtotalV)}</td></tr>
  ${descuento > 0 ? `<tr><td class="lbl">Descuento:</td><td class="val">-${fmt(descuento)}</td></tr>` : ''}
</table>

<hr class="sep-bold"/>
<table class="totales">
  <tr class="total-row"><td class="lbl">TOTAL</td><td class="val">${fmt(venta.total)}</td></tr>
</table>
<hr class="sep-bold"/>

<!-- ═══ MÉTODO DE PAGO ═══ -->
<table class="totales">
  <tr><td class="lbl">Método de pago:</td><td class="val">${metodoLabel}</td></tr>
  ${seccionPago}
  ${pagos.totalCredito > 0 ? `<tr class="bold"><td class="lbl">A crédito:</td><td class="val">${fmt(pagos.totalCredito)}</td></tr>` : ''}
</table>

<hr class="sep"/>

<!-- ═══ QR FACTURACIÓN ═══ -->
<div class="qr">
  <img src="${qrDataUrl}" alt="QR Facturación"/>
  <div class="qr-lbl">Escanea para solicitar factura electrónica</div>
</div>

<!-- ═══ PIE ═══ -->
<div class="pie">¡Gracias por su compra!<br/>Conserve su ticket para aclaraciones</div>
<div class="pie-legal">
  Cuenta con 3 días para solicitar factura.<br/>
  Pasado el plazo, JESHA no se hace responsable.<br/>
  No se aceptan devoluciones por mal uso del producto.
</div>

<button class="no-print" onclick="window.print()">Imprimir Ticket</button>
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),600)})</script>
</body>
</html>`
}

module.exports = { generarTicket, generarTicketThermal }