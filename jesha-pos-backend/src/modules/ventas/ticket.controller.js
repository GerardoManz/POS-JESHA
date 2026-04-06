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
  tel1:     '4921016879',
}

// ════════════════════════════════════════════════════════════════════
//  FIX: La URL del QR debe apuntar al FRONTEND (donde está facturar.html)
//  En local: http://192.168.0.190:3000 (backend sirve el HTML)
//  En producción: https://jesha-pos.netlify.app (Netlify sirve el HTML)
// ════════════════════════════════════════════════════════════════════
const FACTURACION_URL = process.env.FRONTEND_URL || process.env.BASE_URL || 'http://192.168.0.190:3000'

// ── Cargar logo como base64 una sola vez ──
function cargarLogoBase64() {
  // Buscar el logo en varias rutas posibles
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

exports.generarTicket = async (req, res) => {
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

    // ════════════════════════════════════════════════════════════════
    //  FIX: En producción el QR apunta a facturar.html en Netlify
    //  En local apunta a /facturar (servido por Express)
    // ════════════════════════════════════════════════════════════════
    const isProduction = process.env.NODE_ENV === 'production'
    const facturarPath = isProduction ? '/facturar.html' : '/facturar'
    const urlFacturacion = `${FACTURACION_URL}${facturarPath}?token=${venta.tokenQr}`

    const qrDataUrl = await QRCode.toDataURL(urlFacturacion, {
      width: 140, margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    })

    // Desglose de pagos
    const totalEfectivo      = venta.metodoPago === 'EFECTIVO'                       ? parseFloat(venta.total) : 0
    const totalTarjeta       = ['CREDITO','DEBITO'].includes(venta.metodoPago)       ? parseFloat(venta.total) : 0
    const totalTransferencia = venta.metodoPago === 'TRANSFERENCIA'                  ? parseFloat(venta.total) : 0
    const totalCredito       = venta.metodoPago === 'CREDITO_CLIENTE'                ? parseFloat(venta.total) : 0

    // Fecha
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

exports.generarTicketThermal = async (req, res) => {
  exports.generarTicket(req, res)
}

// ════════════════════════════════════════════════════════════════════
//  GENERADOR HTML
// ════════════════════════════════════════════════════════════════════

function generarHTMLTicket(venta, qrDataUrl, fechaStr, pagos) {
  const fmt = v => `$${parseFloat(v||0).toFixed(2)}`

  // Productos
  const filaProductos = (venta.detalles || []).map(d => {
    const subtotal = d.subtotal ?? d.importe ?? (parseFloat(d.precioUnitario || 0) * parseFloat(d.cantidad || 1))
    const nombre   = d.producto?.nombre || d.descripcion || '—'
    const codigo   = d.producto?.codigoInterno ? `<div style="font-size:9px;color:#666;">${d.producto.codigoInterno}</div>` : ''
    const qty      = parseFloat(d.cantidad || 1)
    const qtyStr   = Number.isInteger(qty) ? qty.toString() : qty.toFixed(3).replace(/\.?0+$/, '')
    const precio   = parseFloat(d.precioUnitario || 0)
    return `<tr>
      <td style="padding:4px 0;font-size:11px;word-break:break-word;">
        <div style="font-weight:600;line-height:1.3;">${nombre}</div>
        ${codigo}
        <span style="font-size:10px;color:#555;">${qtyStr} × ${fmt(precio)}</span>
      </td>
      <td style="padding:4px 0;font-size:11px;text-align:right;white-space:nowrap;vertical-align:top;font-weight:600;">${fmt(subtotal)}</td>
    </tr>`
  }).join('')

  const folioCorto = venta.folio?.split('-').pop() || venta.folio
  const cajero     = venta.usuario?.nombre || '—'
  const descuento  = parseFloat(venta.descuento || 0)
  const subtotalV  = parseFloat(venta.subtotal || 0)

  // Método de pago — etiqueta legible
  const metodoLabel = {
    EFECTIVO:        'Efectivo',
    CREDITO:         'Tarjeta crédito',
    DEBITO:          'Tarjeta débito',
    TRANSFERENCIA:   'Transferencia',
    CREDITO_CLIENTE: 'Crédito cliente'
  }[venta.metodoPago] || venta.metodoPago

  // Sección de pago según método
  const montoPagado  = parseFloat(venta.montoPagado || 0)
  const cambio       = parseFloat(venta.cambio || 0)
  const seccionPago  = venta.metodoPago === 'EFECTIVO'
    ? `<div class="pago-row"><span>Recibido:</span><span>${fmt(montoPagado)}</span></div>
       <div class="pago-row cambio-row"><span><strong>Cambio:</strong></span><span><strong>${fmt(cambio)}</strong></span></div>`
    : ''

  // Logo
  const logoHTML = LOGO_BASE64
    ? `<img src="${LOGO_BASE64}" alt="JESHA" style="width:55mm;filter:invert(1);" />`
    : `<div style="font-size:18px;font-weight:900;letter-spacing:2px;">JESHA</div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Ticket ${venta.folio}</title>
  <style>
    @page { margin: 0; size: 80mm auto; }
    * { margin:0; padding:0; box-sizing:border-box; }

    body {
      font-family: 'Courier New', Courier, monospace;
      width: 72mm;
      margin: 0 auto;
      padding: 3mm 3mm;
      font-size: 11px;
      color: #000;
      background: #fff;
    }

    .header         { text-align:center; margin-bottom:4px; }
    .logo-wrap      { margin-bottom:3px; }
    .empresa-nombre { font-size:12px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; }
    .empresa-slogan { font-size:9px; letter-spacing:0.3px; margin-top:1px; }
    .empresa-dir    { font-size:9px; margin-top:2px; }

    .sep       { border:none; border-top:1px dashed #000; margin:4px 0; }
    .sep-doble { border:none; border-top:2px solid #000; margin:4px 0; }

    .info-row    { display:flex; justify-content:space-between; font-size:10px; padding:2px 0; }
    .info-label  { font-size:10px; padding:1px 0; }
    .tel-row     { text-align:center; font-size:12px; font-weight:bold; margin:3px 0; }

    .productos-header { display:flex; justify-content:space-between; font-weight:bold; font-size:10px; padding:2px 0; }
    .productos-tabla  { width:100%; border-collapse:collapse; }

    .resumen-row  { display:flex; justify-content:space-between; font-size:10px; padding:1px 0; }
    .total-row    { display:flex; justify-content:space-between; font-size:14px; font-weight:bold; padding:5px 0; }

    .pago-row     { display:flex; justify-content:space-between; font-size:10px; padding:1px 0; }
    .cambio-row   { font-size:12px; padding:3px 0; }

    .qr-section { text-align:center; margin:5px 0 3px; }
    .qr-section img { width:30mm; height:30mm; }
    .qr-label { font-size:8px; color:#444; margin-top:2px; }

    .footer { text-align:center; font-size:9px; color:#555; margin-top:4px; }

    .btn-print {
      display:block; margin:12px auto 0; padding:9px 28px;
      background:#1f3a66; color:#fff; border:none; border-radius:8px;
      font-size:13px; font-weight:700; cursor:pointer; font-family:sans-serif;
    }
    @media print {
      .btn-print { display:none; }
      body { width:72mm; }
    }
  </style>
</head>
<body>

  <!-- ── ENCABEZADO ── -->
  <div class="header">
    <div class="logo-wrap">${logoHTML}</div>
    <div class="empresa-nombre">${EMPRESA.nombre}</div>
    <div class="empresa-slogan">${EMPRESA.slogan}</div>
    <div class="empresa-dir">${EMPRESA.direccion}</div>
    <div class="empresa-dir">${EMPRESA.ciudad}</div>
  </div>

  <hr class="sep"/>

  <div class="info-row">
    <span>Fecha: ${fechaStr}</span>
    <span>Folio: ${folioCorto}</span>
  </div>
  <div class="info-label">Cajero: ${cajero}</div>
  ${venta.cliente ? `<div class="info-label">Cliente: ${venta.cliente.nombre}</div>` : ''}

  <div class="tel-row">${EMPRESA.tel1}</div>

  <hr class="sep-doble"/>

  <!-- ── PRODUCTOS ── -->
  <div class="productos-header">
    <span>Descripción</span>
    <span>Importe</span>
  </div>
  <hr class="sep"/>

  <table class="productos-tabla">
    <tbody>${filaProductos || '<tr><td colspan="2" style="text-align:center;color:#999;padding:4px 0;">Sin productos</td></tr>'}</tbody>
  </table>

  <hr class="sep"/>

  <!-- ── RESUMEN ── -->
  <div class="resumen-row">
    <span>Subtotal:</span>
    <span>${fmt(subtotalV)}</span>
  </div>
  ${descuento > 0 ? `<div class="resumen-row"><span>Descuento:</span><span>-${fmt(descuento)}</span></div>` : ''}

  <hr class="sep-doble"/>

  <div class="total-row">
    <span>TOTAL</span>
    <span>${fmt(venta.total)}</span>
  </div>

  <hr class="sep-doble"/>

  <!-- ── PAGO ── -->
  <div class="pago-row">
    <span>Método de pago:</span>
    <span>${metodoLabel}</span>
  </div>
  ${seccionPago}
  ${pagos.totalCredito > 0 ? `<div class="pago-row" style="color:#c47000;font-weight:600;"><span>Saldo a crédito:</span><span>${fmt(pagos.totalCredito)}</span></div>` : ''}

  <hr class="sep"/>

  <!-- ── QR FACTURACIÓN ── -->
  <div class="qr-section">
    <img src="${qrDataUrl}" alt="QR Facturación" />
    <div class="qr-label">Escanea para solicitar factura electrónica</div>
  </div>

  <!-- ── PIE ── -->
  <div class="footer">
    Gracias por su compra<br/>
    Conserve su ticket para cualquier aclaración<br/><br/>
    <span style="font-size:8px;color:#333;">
      Tienes <strong>3 días</strong> a partir de la fecha de compra para solicitar tu factura.<br/>
      Pasado este plazo, Ferretería JESHA no se hace responsable de la emisión.<br/>
      No se aceptan devoluciones de productos dañados o con mal uso.
    </span>
  </div>

  <button class="btn-print" onclick="window.print()">🖨️ Imprimir Ticket</button>

  <script>
    window.addEventListener('load', () => { setTimeout(() => window.print(), 400) })
  </script>
</body>
</html>`
}