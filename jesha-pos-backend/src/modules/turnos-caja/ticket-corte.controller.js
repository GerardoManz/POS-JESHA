const prisma  = require('../../lib/prisma')
const fs      = require('fs')
const path    = require('path')

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
//  GET /turnos-caja/:id/ticket
// ════════════════════════════════════════════════════════════════════

const generarTicketCorte = async (req, res) => {
  try {
    const turno = await prisma.turnoCaja.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        Usuario:   { select: { id: true, nombre: true } },
        Sucursal:  { select: { id: true, nombre: true } }
      }
    })

    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' })
    }

    if (turno.abierto) {
      return res.status(400).json({ error: 'El turno aún está abierto' })
    }

    const [totalesRaw] = await prisma.$queryRaw`
      SELECT
        COALESCE(SUM(v.total) FILTER (WHERE v."metodoPago" = 'EFECTIVO'), 0)::numeric AS "totalEfectivo",
        COALESCE(SUM(v.total) FILTER (WHERE v."metodoPago" IN ('DEBITO','CREDITO')), 0)::numeric AS "totalTarjeta",
        COALESCE(SUM(v.total) FILTER (WHERE v."metodoPago" = 'TRANSFERENCIA'), 0)::numeric AS "totalTransferencia",
        COUNT(v.id)::integer AS "numVentas"
      FROM "Venta" v
      WHERE v."turnoId" = ${turno.id} AND v.estado = 'COMPLETADA'
    `

    const t = Array.isArray(totalesRaw) ? totalesRaw[0] : totalesRaw
    const totalEfectivo      = parseFloat(t.totalEfectivo) || 0
    const totalTarjeta       = parseFloat(t.totalTarjeta) || 0
    const totalTransferencia = parseFloat(t.totalTransferencia) || 0
    const totalGeneral       = totalEfectivo + totalTarjeta + totalTransferencia
    const numVentas          = parseInt(t.numVentas) || 0

    const html = generarHTMLCorte({
      turno, numVentas, totalEfectivo, totalTarjeta, totalTransferencia, totalGeneral
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    console.error('❌ Error generando ticket de corte:', err)
    res.status(500).json({ error: err.message })
  }
}

function generarHTMLCorte({ turno, numVentas, totalEfectivo, totalTarjeta, totalTransferencia, totalGeneral }) {
  const fmt = v => `$${parseFloat(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

  const fmtFecha = (d) => {
    if (!d) return '—'
    const f = new Date(d)
    return `${String(f.getDate()).padStart(2,'0')}/${String(f.getMonth()+1).padStart(2,'0')}/${String(f.getFullYear()).slice(-2)} ${String(f.getHours()).padStart(2,'0')}:${String(f.getMinutes()).padStart(2,'0')}`
  }

  const diff      = parseFloat(turno.diferencia) || 0
  const diffStr   = Math.abs(diff).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const diffLabel = diff === 0 ? 'Sin diferencia' : diff > 0 ? 'Sobrante' : 'Faltante'
  const diffSigno = diff >= 0 ? '+' : '-'

  const logoHTML  = `<img src="${LOGO_URL}" alt="JESHA" class="logo" />`

  const notasHTML = turno.notasCierre
    ? `<div class="notas">${turno.notasCierre.replace(/\n/g, '<br/>')}</div><hr class="sep"/>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Corte de Caja #${turno.id}</title>
<style>
@page { size: 58mm auto; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body {
  width: 100%; max-width: 100%; margin: 0; padding: 1mm 3mm;
  font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000;
  background: #fff; line-height: 1.3; font-weight: 700; overflow: hidden;
}
.hdr { text-align: center; padding-bottom: 1.5mm; }
.logo { display: block; margin: 0 auto 1mm; width: 20mm; height: auto; image-rendering: crisp-edges; }
.logo-text { font-size: 16px; font-weight: 900; letter-spacing: 3px; }
.emp { font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.2px; }
.slg { font-size: 7px; font-weight: 700; margin-top: 0.5mm; }
.dir { font-size: 7px; font-weight: 700; margin-top: 0.3mm; }
.tel { font-size: 8px; font-weight: 900; margin-top: 0.5mm; letter-spacing: 0.3px; }
.sep { border: 0; border-top: 1px dashed #000; margin: 1mm 0; }
.sep-bold { border: 0; border-top: 1.5px solid #000; margin: 1mm 0; }
.titulo { text-align: center; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; margin: 1mm 0; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl td { padding: 0.3mm 0; font-size: 8px; font-weight: 700; }
.tbl .lbl { text-align: left; }
.tbl .val { text-align: right; font-weight: 900; }
.tbl .sep-row td { border-top: 1px dashed #000; }
.resumen-seccion { font-size: 8px; font-weight: 900; text-transform: uppercase; margin: 1mm 0 0.5mm; }
.resaltado td { font-weight: 900; font-size: 10px; }
.resaltado-dif td { font-weight: 900; font-size: 10px; }
.diff-ok { color: #1a7a1a; }
.diff-mal { color: #c00; }
.diff-cero { color: #555; }
.firmas { margin-top: 1.5mm; }
.firmas-linea { text-align: center; font-size: 7px; font-weight: 700; margin-top: 3mm; }
.pie { text-align: center; font-size: 8px; font-weight: 900; margin-top: 1mm; line-height: 1.3; }
.notas { font-size: 7px; font-weight: 700; text-align: left; margin: 0.5mm 0; white-space: pre-wrap; word-break: break-word; }
.no-print { display: block; margin: 6px auto; padding: 8px 20px; background: #1f3a66; color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
@media print { .no-print { display: none !important; } html,body { width: 58mm; margin: auto; padding: 0mm 2mm; font-weight: 900; } * { color: #000 !important; } .logo { filter: contrast(2) brightness(0); } }
@media screen { html,body { width: 58mm; margin: 0 auto; padding: 2mm 3mm; box-shadow: 0 0 10px rgba(0,0,0,0.15); } }
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

<div class="titulo">Corte de Caja</div>
<div style="text-align:center;font-size:8px;font-weight:900;">#${turno.id}</div>

<hr class="sep"/>

<table class="tbl">
  <tr><td class="lbl">Cajero:</td><td class="val">${turno.Usuario?.nombre || '—'}</td></tr>
  <tr><td class="lbl">Sucursal:</td><td class="val">${turno.Sucursal?.nombre || '—'}</td></tr>
  <tr><td class="lbl">Apertura:</td><td class="val">${fmtFecha(turno.abiertaEn)}</td></tr>
  <tr><td class="lbl">Cierre:</td><td class="val">${fmtFecha(turno.cerradaEn)}</td></tr>
</table>

<hr class="sep-bold"/>

<div class="resumen-seccion">Resumen Financiero</div>
<table class="tbl">
  <tr class="sep-row"><td class="lbl">Monto apertura:</td><td class="val">${fmt(turno.montoInicial)}</td></tr>
  <tr class="sep-row"><td class="lbl">Ventas efectivo:</td><td class="val">${fmt(totalEfectivo)}</td></tr>
  <tr class="sep-row"><td class="lbl">Total esperado:</td><td class="val">${fmt(turno.montoCalculado)}</td></tr>
  <tr class="sep-row"><td class="lbl">Declarado:</td><td class="val">${fmt(turno.montoFinalDeclarado)}</td></tr>
  <tr class="resaltado-dif">
    <td class="lbl">Diferencia:</td>
    <td class="val ${diff === 0 ? 'diff-cero' : diff > 0 ? 'diff-ok' : 'diff-mal'}">${diffSigno}${fmt(Math.abs(diff))}</td>
  </tr>
</table>

<hr class="sep-bold"/>

<div class="resumen-seccion">Métodos de Pago</div>
<table class="tbl">
  <tr><td class="lbl">Efectivo:</td><td class="val">${fmt(totalEfectivo)}</td></tr>
  <tr><td class="lbl">Tarjeta:</td><td class="val">${fmt(totalTarjeta)}</td></tr>
  <tr><td class="lbl">Transferencia:</td><td class="val">${fmt(totalTransferencia)}</td></tr>
  <tr class="resaltado"><td class="lbl">TOTAL:</td><td class="val">${fmt(totalGeneral)}</td></tr>
</table>

<hr class="sep"/>

<table class="tbl">
  <tr><td class="lbl">Núm. Ventas:</td><td class="val">${numVentas}</td></tr>
</table>

${notasHTML}

<hr class="sep-bold"/>

<div class="firmas">
  <div class="firmas-linea">______________</div>
  <div class="firmas-linea" style="margin-top:0.5mm;">Cajero</div>
  <div class="firmas-linea" style="margin-top:3mm;">______________</div>
  <div class="firmas-linea" style="margin-top:0.5mm;">Supervisor</div>
</div>

<hr class="sep"/>

<div class="pie">¡Gracias por su trabajo!<br/>JESHA POS</div>

<button class="no-print" onclick="window.print()">Imprimir Ticket</button>
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),600)})</script>
</body>
</html>`
}

module.exports = { generarTicketCorte }