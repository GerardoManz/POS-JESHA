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

    const isProduction = process.env.NODE_ENV === 'production'
    const facturarPath = isProduction ? '/facturar.html' : '/facturar'
    const urlFacturacion = `${FACTURACION_URL}${facturarPath}?token=${venta.tokenQr}`

    const qrDataUrl = await QRCode.toDataURL(urlFacturacion, {
      width: 100, margin: 0,
      color: { dark: '#000000', light: '#ffffff' }
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

exports.generarTicketThermal = async (req, res) => {
  exports.generarTicket(req, res)
}

// ════════════════════════════════════════════════════════════════════
//  GENERADOR HTML — Optimizado para GHIA GTP582 (58mm / 48mm útiles)
// ════════════════════════════════════════════════════════════════════

function generarHTMLTicket(venta, qrDataUrl, fechaStr, pagos) {
  const fmt = v => `$${parseFloat(v||0).toFixed(2)}`

  const filaProductos = (venta.detalles || []).map(d => {
    const subtotal = d.subtotal ?? d.importe ?? (parseFloat(d.precioUnitario || 0) * parseFloat(d.cantidad || 1))
    const nombre   = d.producto?.nombre || d.descripcion || '—'
    const qty      = parseFloat(d.cantidad || 1)
    const qtyStr   = Number.isInteger(qty) ? qty.toString() : qty.toFixed(3).replace(/\.?0+$/, '')
    const precio   = parseFloat(d.precioUnitario || 0)
    return `<tr>
      <td class="td-prod">${nombre}<br><span class="sub">${qtyStr} × ${fmt(precio)}</span></td>
      <td class="td-imp">${fmt(subtotal)}</td>
    </tr>`
  }).join('')

  const folioCorto = venta.folio?.split('-').pop() || venta.folio
  const cajero     = venta.usuario?.nombre || '—'
  const descuento  = parseFloat(venta.descuento || 0)
  const subtotalV  = parseFloat(venta.subtotal || 0)

  const metodoLabel = {
    EFECTIVO:        'Efectivo',
    CREDITO:         'T. crédito',
    DEBITO:          'T. débito',
    TRANSFERENCIA:   'Transferencia',
    CREDITO_CLIENTE: 'Crédito cliente'
  }[venta.metodoPago] || venta.metodoPago

  const montoPagado  = parseFloat(venta.montoPagado || 0)
  const cambio       = parseFloat(venta.cambio || 0)
  const seccionPago  = venta.metodoPago === 'EFECTIVO'
    ? `<div class="row"><span>Recibido:</span><span>${fmt(montoPagado)}</span></div>
       <div class="row bold"><span>Cambio:</span><span>${fmt(cambio)}</span></div>`
    : ''

  const logoHTML = LOGO_BASE64
    ? `<img src="${LOGO_BASE64}" alt="JESHA" style="width:38mm;filter:invert(1);" />`
    : `<div style="font-size:14px;font-weight:900;letter-spacing:2px;">JESHA</div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Ticket ${venta.folio}</title>
<style>
@page{margin:0;size:58mm auto;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:48mm;margin:0 auto;padding:1mm 0 0;font-family:'Courier New',Courier,monospace;font-size:9px;color:#000;background:#fff;line-height:1.3;}
.hdr{text-align:center;margin-bottom:2px;}
.hdr img{display:block;margin:0 auto 1px;}
.emp{font-size:9px;font-weight:bold;text-transform:uppercase;}
.slg{font-size:7px;margin-top:1px;}
.dir{font-size:7px;}
.sep{border:0;border-top:1px dashed #000;margin:2px 0;}
.sep2{border:0;border-top:1.5px solid #000;margin:2px 0;}
.row{display:flex;justify-content:space-between;font-size:8px;padding:1px 0;}
.row.bold{font-weight:bold;font-size:9px;}
.tel{text-align:center;font-size:10px;font-weight:bold;margin:2px 0;}
.tbl{width:100%;border-collapse:collapse;}
.td-prod{padding:2px 0;font-size:8px;word-break:break-word;line-height:1.2;}
.td-prod .sub{font-size:7px;color:#555;}
.td-imp{padding:2px 0;font-size:8px;text-align:right;white-space:nowrap;vertical-align:top;font-weight:bold;}
.total{display:flex;justify-content:space-between;font-size:12px;font-weight:bold;padding:2px 0;}
.qr{text-align:center;margin:3px 0 1px;}
.qr img{width:22mm;height:22mm;}
.qr-lbl{font-size:6px;color:#444;margin-top:1px;}
.pie{text-align:center;font-size:7px;color:#555;margin-top:2px;line-height:1.3;}
.pie2{font-size:6px;color:#333;margin-top:1px;}
.no-print{display:block;margin:8px auto 4px;padding:6px 16px;background:#1f3a66;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:sans-serif;}
@media print{.no-print{display:none!important;}html,body{width:48mm;padding:0;}}
</style>
</head>
<body>

<div class="hdr">
${logoHTML}
<div class="emp">${EMPRESA.nombre}</div>
<div class="slg">${EMPRESA.slogan}</div>
<div class="dir">${EMPRESA.direccion}</div>
<div class="dir">${EMPRESA.ciudad}</div>
</div>

<hr class="sep"/>
<div class="row"><span>${fechaStr}</span><span>F:${folioCorto}</span></div>
<div class="row"><span>Cajero: ${cajero}</span></div>
${venta.cliente ? `<div class="row"><span>Cliente: ${venta.cliente.nombre}</span></div>` : ''}
<div class="tel">${EMPRESA.tel1}</div>
<hr class="sep2"/>

<div class="row bold"><span>Descripción</span><span>Imp.</span></div>
<hr class="sep"/>
<table class="tbl"><tbody>${filaProductos || '<tr><td colspan="2" style="text-align:center;color:#999;padding:2px 0;">Sin productos</td></tr>'}</tbody></table>
<hr class="sep"/>

<div class="row"><span>Subtotal:</span><span>${fmt(subtotalV)}</span></div>
${descuento > 0 ? `<div class="row"><span>Desc:</span><span>-${fmt(descuento)}</span></div>` : ''}
<hr class="sep2"/>
<div class="total"><span>TOTAL</span><span>${fmt(venta.total)}</span></div>
<hr class="sep2"/>

<div class="row"><span>Pago:</span><span>${metodoLabel}</span></div>
${seccionPago}
${pagos.totalCredito > 0 ? `<div class="row bold" style="color:#c47000;"><span>A crédito:</span><span>${fmt(pagos.totalCredito)}</span></div>` : ''}

<hr class="sep"/>
<div class="qr">
<img src="${qrDataUrl}" alt="QR"/>
<div class="qr-lbl">Escanea para factura electrónica</div>
</div>

<div class="pie">Gracias por su compra<br/>Conserve su ticket para aclaraciones</div>
<div class="pie2">3 días para solicitar factura.<br/>Pasado el plazo, JESHA no se hace responsable.<br/>No se aceptan devoluciones por mal uso.</div>

<button class="no-print" onclick="window.print()">Imprimir</button>
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),400)})</script>
</body>
</html>`
}