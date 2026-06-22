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

// ── Logo desde Cloudinary ──
const LOGO_URL = 'https://res.cloudinary.com/dabyfymjd/image/upload/q_auto/f_auto/v1779317658/logo-jesha_hmlble.png'

// ════════════════════════════════════════════════════════════════════
//  GET /ventas/:id/ticket
// ════════════════════════════════════════════════════════════════════

const generarTicket = async (req, res) => {
  try {
    const venta = await prisma.venta.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        Cliente:  { select: { nombre: true } },
        Usuario:  { select: { nombre: true } },
        DetalleVenta: {
          include: {
            Producto: { select: { nombre: true, codigoInterno: true } }
          }
        }
      }
    })

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })

    const isProduction    = process.env.NODE_ENV === 'production'
    const FACTURACION_URL = isProduction
      ? `https://${req.get('host')}`
      : `${req.protocol}://${req.get('host')}`
    const facturarPath    = isProduction ? '/facturar.html' : '/facturar'
    const urlFacturacion  = `${FACTURACION_URL}${facturarPath}?token=${venta.tokenQr}`

    const qrDataUrl = await QRCode.toDataURL(urlFacturacion, {
      width: 200, margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    })

    const totalEfectivo      = venta.metodoPago === 'EFECTIVO'                       ? parseFloat(venta.total) : 0
    const totalTarjeta       = ['CREDITO','DEBITO'].includes(venta.metodoPago)       ? parseFloat(venta.total) : 0
    const totalTransferencia = venta.metodoPago === 'TRANSFERENCIA'                  ? parseFloat(venta.total) : 0
    const totalCredito       = venta.metodoPago === 'CREDITO_CLIENTE'                ? parseFloat(venta.total) : 0
    const esMixto            = venta.metodoPago === 'MIXTO' && venta.desglosePagos

    const fecha   = new Date(venta.creadaEn || venta.fecha || venta.createdAt)
    const fechaStr = `${String(fecha.getDate()).padStart(2,'0')}/${String(fecha.getMonth()+1).padStart(2,'0')}/${String(fecha.getFullYear()).slice(-2)}`

    const html = generarHTMLTicket(venta, qrDataUrl, fechaStr, { totalEfectivo, totalTarjeta, totalTransferencia, totalCredito, esMixto })
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
//  v4 — Fix: último carácter cortado + pie tenue
//
//  Cambios vs v3:
//  - padding body: 1mm 2mm → 1mm 3mm (más margen derecho)
//  - @media print padding: 0mm 1mm → 0mm 2mm
//  - Columna precios: 35% → 38% (más espacio para "$1,000.00")
//  - Columna producto: 65% → 62%
//  - Pie legal: 6px → 8px con font-weight 900 (era 700)
//  - Nombre empresa: 10px → 8px (para que quepa en 1 línea)
//  - Font-size base reducidos ~1px para ganar margen horizontal
// ════════════════════════════════════════════════════════════════════

function generarHTMLTicket(venta, qrDataUrl, fechaStr, pagos) {
  const fmt = v => {
    const num = parseFloat(v || 0)
    return `$${num.toFixed(2)}`
  }

  const filaProductos = (venta.DetalleVenta || []).map(d => {
    const subtotal = parseFloat(d.subtotal ?? d.importe ?? (parseFloat(d.precioUnitario || 0) * parseFloat(d.cantidad || 1)))
    const nombre   = d.Producto?.nombre || d.descripcion || '—'
    const qty      = parseFloat(d.cantidad || 1)
    const qtyStr   = Number.isInteger(qty) ? qty.toString() : qty.toFixed(3).replace(/\.?0+$/, '')
    const precio   = parseFloat(d.precioUnitario || 0)
    return `<tr>
      <td class="td-prod">${nombre}<br><span class="td-det">${qtyStr} x ${fmt(precio)}</span></td>
      <td class="td-imp">${fmt(subtotal)}</td>
    </tr>`
  }).join('')

  const folioCorto = venta.folio?.split('-').pop() || venta.folio
  const cajero     = venta.Usuario?.nombre || '—'
  const descuento  = parseFloat(venta.descuento || 0)
  const subtotalV  = parseFloat(venta.subtotal || 0)

  const metodoLabel = {
    EFECTIVO:        'Efectivo',
    CREDITO:         'T. Crédito',
    DEBITO:          'T. Débito',
    TRANSFERENCIA:   'Transferencia',
    CREDITO_CLIENTE: 'Crédito cliente',
    MIXTO:           'Pago Mixto'
  }[venta.metodoPago] || venta.metodoPago

  const montoPagado  = parseFloat(venta.montoPagado || 0)
  const cambio       = parseFloat(venta.cambio || 0)
  const seccionPago  = venta.metodoPago === 'EFECTIVO'
    ? `<tr><td class="lbl">Recibido:</td><td class="val">${fmt(montoPagado)}</td></tr>
       <tr class="bold"><td class="lbl">Cambio:</td><td class="val">${fmt(cambio)}</td></tr>`
    : ''

  // ── Desglose de pago mixto ──
  const metodoLabelCorto = { EFECTIVO:'Efectivo', CREDITO:'T. Crédito', DEBITO:'T. Débito', TRANSFERENCIA:'Transf.' }
  let seccionMixto = ''
  if (pagos.esMixto && venta.desglosePagos) {
    seccionMixto = venta.desglosePagos.map(p =>
      `<tr><td class="lbl">${metodoLabelCorto[p.metodo] || p.metodo}:</td><td class="val">${fmt(p.monto)}</td></tr>`
    ).join('')
    if (cambio > 0) {
      seccionMixto += `<tr class="bold"><td class="lbl">Cambio:</td><td class="val">${fmt(cambio)}</td></tr>`
    }
  }

  // ── Extraer N° Autorización Ingenico de notas ──
  let refAutorizacion = null
  if (['CREDITO', 'DEBITO'].includes(venta.metodoPago) && venta.notas) {
    const match = venta.notas.match(/Ref\.\s*Ingenico:\s*(\d{4,6})/)
    if (match) refAutorizacion = match[1]
  }
  const seccionAutorizacion = refAutorizacion
    ? `<tr class="bold"><td class="lbl">Autorización:</td><td class="val">${refAutorizacion}</td></tr>`
    : ''

  const seccionFirma = pagos.totalCredito > 0
    ? `<tr><td colspan="2" class="firma-box">
         <div class="firma-linea"></div>
         <div class="firma-texto">Firma de recibido</div>
         <div class="firma-linea"></div>
         <div class="firma-texto">El cliente acepta que el precio puede variar al momento de surtir</div>
       </td></tr>`
    : ''

  const logoHTML = `<img src="${LOGO_URL}" alt="JESHA" class="logo" />`

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Ticket ${venta.folio}</title>
<style>
@page {
  size: 58mm auto;
  margin: 0;
}
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
html, body {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 1mm 3mm;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 9px;
  color: #000;
  background: #fff;
  line-height: 1.3;
  font-weight: 700;
  overflow: hidden;
}
.hdr{text-align:center;padding-bottom:1.5mm;}
.logo{display:block;margin:0 auto 1mm;width:20mm;height:auto;image-rendering:crisp-edges;}
.logo-text{font-size:16px;font-weight:900;letter-spacing:3px;}
.emp{font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:0.2px;}
.slg{font-size:7px;font-weight:700;margin-top:0.5mm;}
.dir{font-size:7px;font-weight:700;margin-top:0.3mm;}
.tel{font-size:8px;font-weight:900;margin-top:0.5mm;letter-spacing:0.3px;}
.sep{border:0;border-top:1px dashed #000;margin:1mm 0;}
.sep-bold{border:0;border-top:1.5px solid #000;margin:1mm 0;}
.info-tbl{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed;}
.info-tbl td{padding:0.3mm 0;vertical-align:top;overflow:hidden;}
.info-tbl .lbl{text-align:left;font-weight:700;width:52%;}
.info-tbl .val{text-align:right;font-weight:900;width:48%;}
.col-desc{width:60%;text-align:left;padding:0.8mm 1mm 0.8mm 0;font-size:8px;font-weight:900;word-break:break-word;}
.col-imp{width:40%;text-align:right;padding:0.8mm 0;}
.tbl{width:100%;border-collapse:collapse;table-layout:fixed;}
.tbl .td-prod{width:60%;padding:0.8mm 1mm 0.8mm 0;font-size:8px;font-weight:900;word-break:break-word;overflow-wrap:break-word;line-height:1.2;vertical-align:top;}
.tbl .td-det{font-size:7px;font-weight:700;}
.tbl .td-imp{width:40%;padding:0.8mm 0;font-size:9px;font-weight:900;text-align:right;white-space:nowrap;vertical-align:top;}
.total-row td{font-size:12px;font-weight:900;padding:0.8mm 0;}
.bold td{font-weight:900;}
.qr{text-align:center;margin:1.5mm 0;}
.qr img{width:22mm;height:22mm;image-rendering:pixelated;-ms-interpolation-mode:nearest-neighbor;}
.qr-lbl{font-size:7px;font-weight:900;margin-top:0.5mm;}
.pie{text-align:center;font-size:8px;font-weight:900;margin-top:1mm;line-height:1.3;}
.pie-legal{text-align:center;font-size:8px;font-weight:900;margin-top:1mm;line-height:1.25;}
.firma-box{text-align:center;padding-top:3mm;}
.firma-linea{border-bottom:1px solid #000;width:80%;margin:2mm auto 0.5mm;}
.firma-texto{font-size:7px;font-weight:700;}
.no-print{display:block;margin:10px auto 5px;padding:10px 24px;background:#1f3a66;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;}
@media print{
  .no-print{display:none!important;}
  html,body{width:100%;max-width:100%;padding:0mm 2mm;font-weight:900;}
  *{color:#000!important;}
  .logo{filter:contrast(2) brightness(0);}
}
@media screen{
  html,body{width:58mm;margin:0 auto;padding:2mm 3mm;box-shadow:0 0 10px rgba(0,0,0,0.15);}
}
</style>
</head>
<body>

<div class="hdr">
  ${logoHTML}
  <div class="emp">${EMPRESA.nombre}</div>
  <div class="slg">${EMPRESA.slogan}</div>
  <div class="dir">${EMPRESA.direccion}</div>
  <div class="dir">${EMPRESA.ciudad}</div>
  <div class="tel">Tel. ${EMPRESA.tel1}</div>
</div>

<hr class="sep"/>

<table class="info-tbl">
  <tr><td class="lbl">${fechaStr}</td><td class="val">Folio: ${folioCorto}</td></tr>
  <tr><td class="lbl">Cajero: ${cajero}</td><td class="val"></td></tr>
  ${venta.Cliente ? `<tr><td class="lbl">Cliente:</td><td class="val">${venta.Cliente.nombre}</td></tr>` : ''}
</table>

<hr class="sep-bold"/>

<table class="tbl">
  <thead>
    <tr><td class="col-desc">Descripción</td><td class="col-imp">Importe</td></tr>
  </thead>
  <tbody>
    ${filaProductos || '<tr><td colspan="2" style="text-align:center;padding:2mm 0;">Sin productos</td></tr>'}
  </tbody>
</table>

<hr class="sep"/>

<table class="info-tbl">
  <tr><td class="lbl">Subtotal:</td><td class="val">${fmt(subtotalV)}</td></tr>
  ${descuento > 0 ? `<tr><td class="lbl">Descuento:</td><td class="val">-${fmt(descuento)}</td></tr>` : ''}
</table>

<hr class="sep-bold"/>
<table class="info-tbl">
  <tr class="total-row"><td class="lbl">TOTAL</td><td class="val">${fmt(venta.total)}</td></tr>
</table>
<hr class="sep-bold"/>

<table class="info-tbl">
  <tr><td class="lbl">Método:</td><td class="val">${metodoLabel}</td></tr>
  ${seccionAutorizacion}
  ${seccionMixto}
  ${seccionPago}
  ${pagos.totalCredito > 0 ? `<tr class="bold"><td class="lbl">A crédito:</td><td class="val">${fmt(pagos.totalCredito)}</td></tr>` : ''}
  ${seccionFirma}
</table>

<hr class="sep"/>

<div class="qr">
  <img src="${qrDataUrl}" alt="QR Facturación"/>
  <div class="qr-lbl">Escanea para solicitar factura</div>
</div>

<div class="pie">¡Gracias por su compra!<br/>Conserve su ticket para aclaraciones</div>
<div class="pie-legal">
  El cliente cuenta con 3 días para realizar su factura.<br/>
  Pasado el plazo, JESHA no se hace responsable.<br/>
  No se aceptan devoluciones por mal uso.
</div>

<button class="no-print" onclick="window.print()">Imprimir Ticket</button>
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),600)})</script>
</body>
</html>`
}

module.exports = { generarTicket, generarTicketThermal }
