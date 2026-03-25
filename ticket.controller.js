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

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

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

    // QR para facturación
    const urlFacturacion = `${BASE_URL}/facturar?token=${venta.tokenQr}`
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

  // Productos — usar precioUnitario * cantidad si subtotal no existe
  const filaProductos = (venta.detalles || []).map(d => {
    const subtotal = d.subtotal ?? d.importe ?? (parseFloat(d.precioUnitario || 0) * parseInt(d.cantidad || 1))
    const nombre   = d.producto?.nombre || d.descripcion || '—'
    const codigo   = d.producto?.codigoInterno ? `<div style="font-size:9px;color:#666;">${d.producto.codigoInterno}</div>` : ''
    const qty      = parseInt(d.cantidad || 1)
    const precio   = parseFloat(d.precioUnitario || 0)
    return `<tr>
      <td style="padding:3px 0;font-size:11px;word-break:break-word;">${nombre}${codigo}<span style="font-size:10px;color:#555;">${qty} × ${fmt(precio)}</span></td>
      <td style="padding:3px 0;font-size:11px;text-align:right;white-space:nowrap;vertical-align:top;">${fmt(subtotal)}</td>
    </tr>`
  }).join('')

  const folioCorto = venta.folio?.split('-').pop() || venta.folio

  // Logo — embebido en base64, filtro invert para logo blanco sobre fondo blanco
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
      padding: 4mm 3mm;
      font-size: 11px;
      color: #000;
      background: #fff;
    }

    .header       { text-align:center; margin-bottom:6px; }
    .logo-wrap    { margin-bottom:6px; }
    .empresa-nombre { font-size:13px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; }
    .empresa-slogan { font-size:9px; letter-spacing:0.3px; margin-top:1px; }
    .empresa-dir    { font-size:10px; margin-top:3px; }

    .sep       { border:none; border-top:1px dashed #000; margin:5px 0; }
    .sep-doble { border:none; border-top:2px solid #000; margin:5px 0; }

    .info-row { display:flex; justify-content:space-between; font-size:10px; padding:2px 0; }
    .tel-row  { display:flex; justify-content:center; gap:20px; font-size:12px; font-weight:bold; margin:4px 0; }
    .cliente-row { font-size:10px; margin:3px 0; }

    .productos-header { display:flex; justify-content:space-between; font-weight:bold; font-size:11px; padding:3px 0; }
    .productos-tabla  { width:100%; border-collapse:collapse; }

    .total-row { display:flex; justify-content:space-between; font-size:14px; font-weight:bold; padding:4px 0; }

    .pago-row { display:flex; justify-content:space-between; font-size:10px; padding:1px 0; }

    .qr-section { text-align:center; margin:6px 0 4px; }
    .qr-section img { width:32mm; height:32mm; }
    .qr-label { font-size:8px; color:#444; margin-top:2px; }

    .footer { text-align:center; font-size:9px; color:#555; margin-top:4px; }

    .btn-print {
      display:block; margin:14px auto 0; padding:10px 32px;
      background:#1f3a66; color:#fff; border:none; border-radius:8px;
      font-size:14px; font-weight:700; cursor:pointer; font-family:sans-serif;
      letter-spacing:0.5px;
    }
    @media print {
      .btn-print { display:none; }
      body { width:72mm; }
    }
  </style>
</head>
<body>

  <!-- ENCABEZADO -->
  <div class="header">
    <div class="logo-wrap">${logoHTML}</div>
    <div class="empresa-nombre">${EMPRESA.nombre}</div>
    <div class="empresa-slogan">${EMPRESA.slogan}</div>
    <div class="empresa-dir">${EMPRESA.direccion}</div>
    <div class="empresa-dir">${EMPRESA.ciudad}</div>
  </div>

  <hr class="sep"/>

  <div class="info-row">
    <span>Fecha:${fechaStr}</span>
    <span>Folio:${folioCorto}</span>
  </div>

  <div style="text-align:center;font-size:10px;margin:2px 0;">Números de contacto:</div>
  <div class="tel-row">
    <span>${EMPRESA.tel1}</span>
  </div>

  ${venta.cliente ? `<div class="cliente-row">Cliente: ${venta.cliente.nombre}</div>` : ''}

  <hr class="sep-doble"/>
  <hr class="sep-doble"/>

  <div class="productos-header">
    <span>Descripción</span>
    <span>Precio</span>
  </div>
  <hr class="sep"/>

  <table class="productos-tabla">
    <tbody>${filaProductos || '<tr><td colspan="2" style="text-align:center;color:#999;padding:4px 0;">Sin productos</td></tr>'}</tbody>
  </table>

  <hr class="sep-doble"/>
  <hr class="sep-doble"/>

  <div class="total-row">
    <span>TOTAL</span>
    <span>${fmt(venta.total)}</span>
  </div>

  <hr class="sep"/>

  <div class="pago-row"><span>Efectivo:</span><span>${pagos.totalEfectivo.toFixed(2)}</span></div>
  <div class="pago-row"><span>Tarjeta:</span><span>${pagos.totalTarjeta.toFixed(2)}</span></div>
  <div class="pago-row"><span>Transferencia:</span><span>${pagos.totalTransferencia.toFixed(2)}</span></div>
  ${pagos.totalCredito > 0 ? `<div class="pago-row" style="color:#e8710a;font-weight:600;"><span>Crédito cliente:</span><span>${pagos.totalCredito.toFixed(2)}</span></div>` : ''}

  <hr class="sep"/>

  <div class="qr-section">
    <img src="${qrDataUrl}" alt="QR Facturación" />
    <div class="qr-label">Escanea para solicitar factura electrónica</div>
  </div>

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