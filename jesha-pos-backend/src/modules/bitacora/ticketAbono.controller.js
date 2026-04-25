// ════════════════════════════════════════════════════════════════════
//  TICKETABONO.CONTROLLER.JS
//  Genera el HTML imprimible (58mm) de un abono a bitácora.
//  src/modules/bitacora/ticketAbono.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const fs     = require('fs')
const path   = require('path')

// ── Datos fijos de JESHA ──
const EMPRESA = {
  nombre:    'Ferretería e Iluminación JESHA',
  slogan:    'Productos y Servicios de Máxima Calidad',
  direccion: 'Av. San Simón #03',
  ciudad:    'Guadalupe, Zacatecas',
  tel1:      '492 101 6879',
}

// ── Cargar logo una sola vez ──
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
      return `data:image/png;base64,${data.toString('base64')}`
    }
  }
  return null
}

let LOGO_BASE64 = null
try { LOGO_BASE64 = cargarLogoBase64() } catch(e) { console.warn('⚠️  Error logo ticket abono:', e.message) }

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras/abonos/:abonoId/ticket
// ════════════════════════════════════════════════════════════════════
const generarTicketAbono = async (req, res) => {
  try {
    const abonoId = parseInt(req.params.abonoId)
    if (!abonoId) return res.status(400).json({ error: 'abonoId inválido' })

    const abono = await prisma.abonoBitacora.findUnique({
      where: { id: abonoId },
      include: {
        usuario:  { select: { nombre: true } },
        turno:    { select: { id: true } },
        bitacora: {
          select: {
            id: true, folio: true, titulo: true, estado: true,
            totalMateriales: true, totalAbonado: true, saldoPendiente: true,
            cliente: { select: { nombre: true, telefono: true, saldoPendiente: true } }
          }
        }
      }
    })

    if (!abono) return res.status(404).json({ error: 'Abono no encontrado' })

    const fecha    = new Date(abono.creadoEn)
    const fechaStr = `${String(fecha.getDate()).padStart(2,'0')}/${String(fecha.getMonth()+1).padStart(2,'0')}/${String(fecha.getFullYear()).slice(-2)}`
    const horaStr  = `${String(fecha.getHours()).padStart(2,'0')}:${String(fecha.getMinutes()).padStart(2,'0')}`

    const html = generarHTMLTicketAbono(abono, fechaStr, horaStr)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    console.error('❌ Error ticket abono:', err)
    res.status(500).json({ error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  HTML del ticket (58mm)
// ════════════════════════════════════════════════════════════════════
function generarHTMLTicketAbono(abono, fechaStr, horaStr) {
  const fmt = v => `$${parseFloat(v || 0).toFixed(2)}`
  const { bitacora } = abono

  const metodoLabel = {
    EFECTIVO:      'Efectivo',
    CREDITO:       'T. Crédito',
    DEBITO:        'T. Débito',
    TRANSFERENCIA: 'Transferencia'
  }[abono.metodoPago] || abono.metodoPago

  const bitacoraLiquidada = bitacora.estado === 'CERRADA_VENTA'
  const saldoCliente      = bitacora.cliente ? parseFloat(bitacora.cliente.saldoPendiente || 0) : null

  const logoHTML = LOGO_BASE64
    ? `<img src="${LOGO_BASE64}" alt="JESHA" class="logo" />`
    : `<div class="logo-text">JESHA</div>`

  const folioCorto  = bitacora.folio?.split('-').pop() || bitacora.folio
  const abonoCorto  = String(abono.id).padStart(5, '0')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Abono ${bitacora.folio} - ${abonoCorto}</title>
<style>
@page { size: 58mm auto; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html, body { width:100%; max-width:100%; margin:0; padding:1mm 3mm; font-family:Arial,Helvetica,sans-serif; font-size:9px; color:#000; background:#fff; line-height:1.3; font-weight:700; overflow:hidden; }
.hdr { text-align:center; padding-bottom:1.5mm; }
.logo { display:block; margin:0 auto 1mm; width:20mm; height:auto; image-rendering:crisp-edges; }
.logo-text { font-size:16px; font-weight:900; letter-spacing:3px; }
.emp { font-size:8px; font-weight:900; text-transform:uppercase; letter-spacing:0.2px; }
.slg { font-size:7px; font-weight:700; margin-top:0.5mm; }
.dir { font-size:7px; font-weight:700; margin-top:0.3mm; }
.tel { font-size:8px; font-weight:900; margin-top:0.5mm; letter-spacing:0.3px; }
.sep { border:0; border-top:1px dashed #000; margin:1mm 0; }
.sep-bold { border:0; border-top:1.5px solid #000; margin:1mm 0; }

.doc-tipo { text-align:center; font-size:11px; font-weight:900; letter-spacing:2px; padding:1mm 0; background:#000; color:#fff !important; margin:1mm 0; }
.doc-tipo * { color:#fff !important; }

.info-tbl { width:100%; border-collapse:collapse; font-size:8px; table-layout:fixed; }
.info-tbl td { padding:0.3mm 0; vertical-align:top; overflow:hidden; }
.info-tbl .lbl { text-align:left; font-weight:700; width:52%; }
.info-tbl .val { text-align:right; font-weight:900; width:48%; word-break:break-word; }

.monto-abono td { font-size:14px !important; font-weight:900; padding:1.2mm 0; }
.saldo-final td { font-size:11px; font-weight:900; padding:0.8mm 0; }

.resumen { background:rgba(0,0,0,0.03); padding:1.2mm 1.5mm; margin:1mm 0; border:1px dashed #000; }

.pie { text-align:center; font-size:8px; font-weight:900; margin-top:1mm; line-height:1.3; }
.pie-legal { text-align:center; font-size:7.5px; font-weight:700; margin-top:1mm; line-height:1.25; }
.pie-liquidada { text-align:center; font-size:10px; font-weight:900; margin:1.5mm 0; padding:1mm; border:1.5px solid #000; letter-spacing:1px; }

.no-print { display:block; margin:10px auto 5px; padding:10px 24px; background:#1f3a66; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; }

@media print {
  .no-print { display:none !important; }
  html, body { width:100%; max-width:100%; padding:0mm 2mm; font-weight:900; }
  * { color:#000 !important; }
  .doc-tipo, .doc-tipo * { color:#fff !important; background:#000 !important; }
  .logo { filter:contrast(2) brightness(0); }
}
@media screen {
  html, body { width:58mm; margin:0 auto; padding:2mm 3mm; box-shadow:0 0 10px rgba(0,0,0,0.15); }
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

<div class="doc-tipo">COMPROBANTE DE ABONO</div>

<table class="info-tbl">
  <tr><td class="lbl">Fecha:</td><td class="val">${fechaStr} ${horaStr}</td></tr>
  <tr><td class="lbl">Abono N°:</td><td class="val">${abonoCorto}</td></tr>
  <tr><td class="lbl">Bitácora:</td><td class="val">${folioCorto}</td></tr>
  <tr><td class="lbl">Cajero:</td><td class="val">${abono.usuario?.nombre || '—'}</td></tr>
  <tr><td class="lbl">Turno:</td><td class="val">#${abono.turnoId}</td></tr>
</table>

<hr class="sep"/>

${bitacora.titulo ? `
<table class="info-tbl">
  <tr><td class="lbl">Concepto:</td><td class="val">${bitacora.titulo}</td></tr>
</table>
<hr class="sep"/>` : ''}

${bitacora.cliente ? `
<table class="info-tbl">
  <tr><td class="lbl">Cliente:</td><td class="val">${bitacora.cliente.nombre}</td></tr>
  ${bitacora.cliente.telefono ? `<tr><td class="lbl">Tel:</td><td class="val">${bitacora.cliente.telefono}</td></tr>` : ''}
</table>
<hr class="sep"/>` : ''}

<hr class="sep-bold"/>
<table class="info-tbl">
  <tr class="monto-abono">
    <td class="lbl">ABONO</td>
    <td class="val">${fmt(abono.monto)}</td>
  </tr>
  <tr><td class="lbl">Método:</td><td class="val">${metodoLabel}</td></tr>
  ${abono.notas ? `<tr><td class="lbl">Nota:</td><td class="val">${abono.notas}</td></tr>` : ''}
</table>
<hr class="sep-bold"/>

<div class="resumen">
  <table class="info-tbl">
    <tr><td class="lbl">Total materiales:</td><td class="val">${fmt(bitacora.totalMateriales)}</td></tr>
    <tr><td class="lbl">Total abonado:</td><td class="val">${fmt(bitacora.totalAbonado)}</td></tr>
    <tr class="saldo-final">
      <td class="lbl">${bitacoraLiquidada ? 'SALDO:' : 'RESTA:'}</td>
      <td class="val">${fmt(bitacora.saldoPendiente)}</td>
    </tr>
  </table>
</div>

${bitacoraLiquidada
  ? `<div class="pie-liquidada">✓ BITÁCORA LIQUIDADA</div>`
  : `<hr class="sep"/>`}

${(saldoCliente !== null && saldoCliente > 0 && !bitacoraLiquidada) ? `
<table class="info-tbl">
  <tr><td class="lbl">Saldo total cliente:</td><td class="val">${fmt(saldoCliente)}</td></tr>
</table>
<hr class="sep"/>` : ''}

<div class="pie">¡Gracias por su pago!<br/>Conserve este comprobante</div>
<div class="pie-legal">
  Documento interno de control.<br/>
  Para factura solicítela al momento de la compra.
</div>

<button class="no-print" onclick="window.print()">Imprimir</button>
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),600)})</script>
</body>
</html>`
}

module.exports = { generarTicketAbono }
