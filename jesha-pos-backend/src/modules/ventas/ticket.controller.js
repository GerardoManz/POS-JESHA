// ════════════════════════════════════════════════════════════════════
//  TICKET.CONTROLLER.JS
//  src/modules/ventas/ticket.controller.js
//  Genera HTML imprimible del ticket de venta
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const QRCode = require('qrcode')

// ── Datos fijos de JESHA ──
const EMPRESA = {
  nombre:    'Ferretería e Iluminación JESHA',
  slogan:    'Productos y Servicios de Máxima Calidad',
  direccion: 'Av. San Simón #03',
  ciudad:    'Guadalupe, Zacatecas',
  tel1:      '4921941703',
  tel2:      '4921016879',
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

// ── GET /ventas/:id/ticket ──
exports.generarTicket = async (req, res) => {
  try {
    const venta = await prisma.venta.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        cliente:  { select: { nombre: true } },
        usuario:  { select: { nombre: true } },
        detalles: {
          include: { producto: { select: { nombre: true, codigoInterno: true } } }
        }
      }
    })

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })

    // Generar QR para facturación
    const urlFacturacion = `${BASE_URL}/facturar?token=${venta.tokenQr}`
    const qrDataUrl = await QRCode.toDataURL(urlFacturacion, {
      width: 120, margin: 1, color: { dark: '#000000', light: '#ffffff' }
    })

    // Calcular desglose de pagos
    const totalEfectivo     = venta.metodoPago === 'EFECTIVO'      ? parseFloat(venta.total) : 0
    const totalTarjeta      = ['CREDITO','DEBITO'].includes(venta.metodoPago) ? parseFloat(venta.total) : 0
    const totalTransferencia = venta.metodoPago === 'TRANSFERENCIA' ? parseFloat(venta.total) : 0

    // Fecha formateada
    const fecha = new Date(venta.creadaEn)
    const fechaStr = `${String(fecha.getDate()).padStart(2,'0')}/${String(fecha.getMonth()+1).padStart(2,'0')}/${String(fecha.getFullYear()).slice(-2)}`

    const html = generarHTMLTicket(venta, qrDataUrl, fechaStr, { totalEfectivo, totalTarjeta, totalTransferencia })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    console.error('❌ Error generando ticket:', err)
    res.status(500).json({ error: err.message })
  }
}

// ── GET /ventas/:id/ticket/thermal ── (80mm)
exports.generarTicketThermal = async (req, res) => {
  req.params.thermal = true
  exports.generarTicket(req, res)
}

// ════════════════════════════════════════════════════════════════════
//  GENERADOR HTML
// ════════════════════════════════════════════════════════════════════

function generarHTMLTicket(venta, qrDataUrl, fechaStr, pagos) {
  const fmt = v => `$${parseFloat(v||0).toFixed(1)}`

  const filaProductos = (venta.detalles || []).map(d => `
    <tr>
      <td style="padding:3px 0;font-size:11px;">${d.producto?.nombre || '—'}</td>
      <td style="padding:3px 0;font-size:11px;text-align:right;">${fmt(d.subtotal)}</td>
    </tr>
  `).join('')

  // Folio corto (últimos 5 chars)
  const folioCorto = venta.folio?.split('-').pop() || venta.folio

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Ticket ${venta.folio}</title>
  <style>
    @page { margin: 0; size: 80mm auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Courier New', Courier, monospace;
      width: 72mm;
      margin: 0 auto;
      padding: 4mm 3mm;
      font-size: 11px;
      color: #000;
      background: #fff;
    }

    /* ── ENCABEZADO ── */
    .header { text-align: center; margin-bottom: 6px; }
    .logo-wrap { margin-bottom: 4px; }
    .logo-wrap img { width: 55mm; }
    .empresa-nombre {
      font-size: 13px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .empresa-slogan {
      font-size: 9px;
      letter-spacing: 0.3px;
      margin-top: 1px;
    }
    .empresa-dir { font-size: 10px; margin-top: 4px; }

    /* ── SEPARADORES ── */
    .sep {
      border: none;
      border-top: 1px dashed #000;
      margin: 5px 0;
    }
    .sep-doble {
      border: none;
      border-top: 2px solid #000;
      margin: 5px 0;
    }

    /* ── INFO VENTA ── */
    .info-row {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      padding: 1px 0;
    }
    .tel-row {
      display: flex;
      justify-content: center;
      gap: 20px;
      font-size: 12px;
      font-weight: bold;
      margin: 4px 0;
    }
    .cliente-row { font-size: 10px; margin: 3px 0; }

    /* ── PRODUCTOS ── */
    .productos-header {
      display: flex;
      justify-content: space-between;
      font-weight: bold;
      font-size: 11px;
      padding: 3px 0;
    }
    .productos-tabla { width: 100%; border-collapse: collapse; }

    /* ── TOTAL ── */
    .total-row {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      font-weight: bold;
      padding: 4px 0;
    }

    /* ── PAGOS ── */
    .pago-row {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      padding: 1px 0;
    }

    /* ── QR ── */
    .qr-section { text-align: center; margin: 6px 0 4px; }
    .qr-section img { width: 28mm; height: 28mm; }
    .qr-label { font-size: 8px; color: #444; margin-top: 2px; }

    /* ── FOOTER ── */
    .footer { text-align: center; font-size: 9px; color: #555; margin-top: 4px; }

    /* ── BOTÓN IMPRIMIR (no se imprime) ── */
    .btn-print {
      display: block;
      margin: 12px auto 0;
      padding: 10px 32px;
      background: #1f3a66;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      font-family: sans-serif;
    }
    @media print {
      .btn-print { display: none; }
      body { width: 72mm; }
    }
  </style>
</head>
<body>

  <!-- ENCABEZADO -->
  <div class="header">
    <div class="logo-wrap">
      <img src="Imagenes/logo-jesha.png" alt="JESHA" onerror="this.style.display='none'" />
    </div>
    <div class="empresa-nombre">Ferretería e Iluminación JESHA</div>
    <div class="empresa-slogan">Productos y Servicios de Máxima Calidad</div>
    <div class="empresa-dir">${EMPRESA.direccion}</div>
    <div class="empresa-dir">${EMPRESA.ciudad}</div>
  </div>

  <hr class="sep"/>

  <!-- FECHA Y FOLIO -->
  <div class="info-row">
    <span>Fecha:${fechaStr}</span>
    <span>Folio:${folioCorto}</span>
  </div>

  <!-- TELÉFONOS -->
  <div style="text-align:center;font-size:10px;margin:2px 0;">Números de contacto:</div>
  <div class="tel-row">
    <span>${EMPRESA.tel1}</span>
    <span>${EMPRESA.tel2}</span>
  </div>

  <!-- CLIENTE -->
  ${venta.cliente ? `<div class="cliente-row">Cliente: ${venta.cliente.nombre}</div>` : ''}

  <hr class="sep-doble"/>
  <hr class="sep-doble"/>

  <!-- PRODUCTOS -->
  <div class="productos-header">
    <span>Descripción</span>
    <span>Precio</span>
  </div>
  <hr class="sep"/>

  <table class="productos-tabla">
    <tbody>${filaProductos}</tbody>
  </table>

  <hr class="sep-doble"/>
  <hr class="sep-doble"/>

  <!-- TOTAL -->
  <div class="total-row">
    <span>TOTAL</span>
    <span>${fmt(venta.total)}</span>
  </div>

  <hr class="sep"/>

  <!-- DESGLOSE PAGOS -->
  <div class="pago-row"><span>Efectivo:</span><span>${pagos.totalEfectivo.toFixed(2)}</span></div>
  <div class="pago-row"><span>Tarjeta:</span><span>${pagos.totalTarjeta.toFixed(2)}</span></div>
  <div class="pago-row"><span>Transferencia:</span><span>${pagos.totalTransferencia.toFixed(2)}</span></div>

  <!-- QR FACTURACIÓN -->
  <hr class="sep"/>
  <div class="qr-section">
    <img src="${qrDataUrl}" alt="QR Facturación" />
    <div class="qr-label">Escanea para solicitar factura electrónica</div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    Gracias por su compra<br/>
    Conserve su ticket para cualquier aclaración
  </div>

  <button class="btn-print" onclick="window.print()">🖨️ Imprimir Ticket</button>

  <script>
    // Auto-abrir diálogo de impresión al cargar
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 400)
    })
  </script>
</body>
</html>`
}
