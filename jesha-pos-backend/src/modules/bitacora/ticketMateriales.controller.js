// ════════════════════════════════════════════════════════════════════
//  TICKETMATERIALES.CONTROLLER.JS
//  Genera el HTML imprimible (58mm) de un vale/remito de materiales.
//  POST /bitacoras/:id/ticket-materiales
//  Recibe los productos del borrador + trabajador (recibe).
//  NO guarda nada en BD. Solo genera el ticket instantáneo.
// ════════════════════════════════════════════════════════════════════

const prisma      = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')

const EMPRESA = {
  nombre:    'Ferretería e Iluminación JESHA',
  slogan:    'Productos y Servicios de Máxima Calidad',
  direccion: 'Av. San Simón #03',
  ciudad:    'Guadalupe, Zacatecas',
  tel1:      '492 101 6879',
}

const LOGO_URL = 'https://res.cloudinary.com/dabyfymjd/image/upload/q_auto/f_auto/v1779317658/logo-jesha_hmlble.png'

function nombreTrabajador(t) {
  if (!t) return '—'
  return t.apodo ? `${t.apodo} (${t.nombre})` : t.nombre
}

function formatearFechaTicket(fecha) {
  if (!fecha) fecha = new Date()
  if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [y, m, d] = fecha.split('-')
    return `${d}/${m}/${y.slice(-2)}`
  }
  const d = new Date(fecha)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/ticket-materiales
// ════════════════════════════════════════════════════════════════════
const generarTicketMateriales = async (req, res) => {
  try {
    const { id } = req.params
    const { items, detalleIds, recibeTrabajadorId, fechaManual, responsableId } = req.body
    const empresaId = getEmpresaId(req)

    // Buscar bitácora
    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true, folio: true, titulo: true, estado: true, empresaId: true,
        totalMateriales: true, totalAbonado: true, saldoPendiente: true,
        descuentoTipo: true, descuentoValor: true, descuentoMonto: true,
        Cliente: { select: { nombre: true, telefono: true } },
        Usuario: { select: { nombre: true } }
      }
    })
    if (!bitacora || bitacora.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Bitácora no encontrada' })
    }

    let filas = []
    let totalRetiro = 0
    let deudaAnterior = 0
    let nuevaDeuda = 0
    let recibeNombre = '—'
    let responsable = null
    let fechaStr = formatearFechaTicket(fechaManual)

    // Modo post-guardado: el lote ya existe en DetalleBitacora.
    if (Array.isArray(detalleIds) && detalleIds.length > 0) {
      const ids = [...new Set(detalleIds.map(x => parseInt(x)).filter(Number.isInteger))]
      if (!ids.length) return res.status(400).json({ error: 'detalleIds inválido' })

      const detalles = await prisma.detalleBitacora.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, bitacoraId: true, cantidad: true, precioUnitario: true, subtotal: true,
          fechaManual: true, recibeNombre: true,
          Producto: { select: { nombre: true } },
          Responsable: { select: { nombre: true } }
        },
        orderBy: { creadoEn: 'asc' }
      })
      if (detalles.length !== ids.length || detalles.some(d => d.bitacoraId !== bitacora.id)) {
        return res.status(400).json({ error: 'Uno o más detalles no pertenecen a esta bitácora' })
      }

      filas = detalles.map(d => {
        const cant = parseFloat(d.cantidad || 0)
        const prec = parseFloat(d.precioUnitario || 0)
        const subt = parseFloat(d.subtotal || 0)
        totalRetiro = parseFloat((totalRetiro + subt).toFixed(2))
        return { nombre: d.Producto?.nombre || '—', cant, prec, subt }
      })

      const recibeSet = [...new Set(detalles.map(d => d.recibeNombre).filter(Boolean))]
      recibeNombre = recibeSet.length ? recibeSet.join(', ') : '—'
      responsable = detalles.find(d => d.Responsable)?.Responsable || bitacora.Usuario || null
      fechaStr = formatearFechaTicket(detalles[0]?.fechaManual || fechaManual)
      nuevaDeuda = parseFloat(bitacora.saldoPendiente || 0)
      deudaAnterior = parseFloat((nuevaDeuda - totalRetiro).toFixed(2))
    } else {
      // Modo borrador: los productos aún no están guardados.
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items debe ser un arreglo con al menos un producto' })
      }

      const recibeId = Number(recibeTrabajadorId)
      if (!Number.isInteger(recibeId) || recibeId <= 0) {
        return res.status(400).json({ error: 'recibeTrabajadorId requerido' })
      }

      const trabajador = await prisma.trabajador.findFirst({
        where: { id: recibeId, empresaId, activo: true },
        select: { id: true, nombre: true, apodo: true }
      })
      if (!trabajador) {
        return res.status(400).json({ error: 'Trabajador inválido o inactivo' })
      }

      responsable = responsableId ? await prisma.usuario.findFirst({
        where: { id: Number(responsableId), empresaId, activo: true },
        select: { nombre: true }
      }) : null

      filas = items.map(it => {
        const cant = parseFloat(it.cantidad || 0)
        const prec = parseFloat(it.precioUnitario || 0)
        const subt = parseFloat((cant * prec).toFixed(2))
        totalRetiro = parseFloat((totalRetiro + subt).toFixed(2))
        return { nombre: it.nombre || it.Producto?.nombre || '—', cant, prec, subt }
      })

      recibeNombre = nombreTrabajador(trabajador)
      deudaAnterior = parseFloat(bitacora.saldoPendiente || 0)
      nuevaDeuda = parseFloat((deudaAnterior + totalRetiro).toFixed(2))
      fechaStr = formatearFechaTicket(fechaManual)
    }

    const totalAbonado = parseFloat(bitacora.totalAbonado || 0)
    const html = generarHTML(filas, totalRetiro, deudaAnterior, nuevaDeuda, totalAbonado, bitacora, recibeNombre, responsable, fechaStr)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    console.error('❌ Error ticket materiales:', err)
    res.status(500).json({ error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras/:id/retiros/:retiroId/ticket
//  Imprime un retiro/lote específico ya guardado.
//  Usa saldoAnterior/saldoDespues históricos del retiro.
// ════════════════════════════════════════════════════════════════════
const generarTicketRetiro = async (req, res) => {
  try {
    const { id, retiroId } = req.params
    const empresaId = getEmpresaId(req)

    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, folio: true, titulo: true, estado: true, empresaId: true,
        totalMateriales: true, totalAbonado: true, saldoPendiente: true,
        descuentoTipo: true, descuentoValor: true, descuentoMonto: true,
        Cliente: { select: { nombre: true } }
      }
    })
    if (!bitacora || bitacora.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Bitácora no encontrada' })
    }

    const retiro = await prisma.retiroBitacora.findUnique({
      where: { id: parseInt(retiroId) },
      select: {
        id: true, bitacoraId: true, recibeNombre: true, fechaManual: true,
        total: true, saldoAnterior: true, saldoDespues: true, creadoEn: true,
        Responsable: { select: { nombre: true } },
        DetalleBitacora: {
          orderBy: { creadoEn: 'asc' },
          select: {
            id: true, cantidad: true, precioUnitario: true, subtotal: true,
            Producto: { select: { nombre: true } }
          }
        }
      }
    })
    if (!retiro || retiro.bitacoraId !== bitacora.id) {
      return res.status(404).json({ error: 'Retiro no encontrado en esta bitácora' })
    }

    const filas = retiro.DetalleBitacora.map(d => ({
      nombre: d.Producto?.nombre || '—',
      cant: parseFloat(d.cantidad || 0),
      prec: parseFloat(d.precioUnitario || 0),
      subt: parseFloat(d.subtotal || 0)
    }))

    const totalRetiro = parseFloat(filas.reduce((s, f) => parseFloat((s + f.subt).toFixed(2)), 0))
    const deudaAnterior = parseFloat((parseFloat(bitacora.saldoPendiente || 0) - totalRetiro).toFixed(2))
    const nuevaDeuda = parseFloat(bitacora.saldoPendiente || 0)
    const recibeNombre = retiro.recibeNombre || '—'
    const responsable = retiro.Responsable || null
    const fechaStr = formatearFechaTicket(retiro.fechaManual || retiro.creadoEn)
    const totalAbonado = parseFloat(bitacora.totalAbonado || 0)

    const html = generarHTML(filas, totalRetiro, deudaAnterior, nuevaDeuda, totalAbonado, bitacora, recibeNombre, responsable, fechaStr)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    console.error('❌ Error ticket retiro:', err)
    res.status(500).json({ error: err.message })
  }
}

function generarHTML(filas, totalRetiro, deudaAnterior, nuevaDeuda, totalAbonado, bitacora, recibeNombre, responsable, fechaStr) {
  const fmt = v => `$${parseFloat(v || 0).toFixed(2)}`
  const logoHTML = `<img src="${LOGO_URL}" alt="JESHA" class="logo" />`
  const descuentoMonto = parseFloat(bitacora.descuentoMonto || 0)
  const descuentoValor = parseFloat(bitacora.descuentoValor || 0)
  const subtotalConDesc = parseFloat((parseFloat(bitacora.totalMateriales || 0) - descuentoMonto).toFixed(2))
  const descuentoLabel = bitacora.descuentoTipo === 'PORCENTAJE' && descuentoValor > 0
    ? ` (${descuentoValor}%)`
    : ''

  const filasHTML = filas.map(f => `
    <tr>
      <td class="td-prod">${f.nombre}<br><span class="td-det">${f.cant} x ${fmt(f.prec)}</span></td>
      <td class="td-imp">${fmt(f.subt)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Vale ${bitacora.folio}</title>
<style>
@page { size: 58mm auto; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html, body { width:100%; max-width:100%; margin:0; padding:1mm 3mm; font-family:Arial,Helvetica,sans-serif; font-size:9px; color:#000; background:#fff; line-height:1.3; font-weight:700; overflow:hidden; }
.hdr { text-align:center; padding-bottom:1.5mm; }
.logo { display:block; margin:0 auto 1mm; width:20mm; height:auto; image-rendering:crisp-edges; }
.emp { font-size:7px; font-weight:900; text-transform:uppercase; letter-spacing:0; line-height:1.15; max-width:41mm; margin:0 auto; }
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

.tbl { width:100%; border-collapse:collapse; table-layout:fixed; }
.tbl .td-prod { width:60%; padding:0.8mm 1mm 0.8mm 0; font-size:8px; font-weight:900; word-break:break-word; }
.tbl .td-det  { font-size:7px; font-weight:700; }
.tbl .td-imp  { width:40%; padding:0.8mm 0; font-size:9px; font-weight:900; text-align:right; white-space:nowrap; }

.resumen { background:rgba(0,0,0,0.03); padding:1.2mm 1.5mm; margin:1mm 0; border:1px dashed #000; }
.saldo-final td { font-size:11px; font-weight:900; padding:0.8mm 0; }

.pie { text-align:center; font-size:8px; font-weight:900; margin-top:1mm; line-height:1.3; }
.pie-legal { text-align:center; font-size:7.5px; font-weight:700; margin-top:1mm; line-height:1.25; }

.no-print { display:block; margin:10px auto 5px; padding:10px 24px; background:#1f3a66; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; }

@media print {
  .no-print { display:none !important; }
  html { width:100%; max-width:100%; margin:0; padding:0; }
  body { width:45mm; max-width:45mm; margin:0 auto; padding:0; font-weight:800; overflow:visible; }
  .info-tbl .val,.tbl .td-imp { padding-right:3mm; }
  .pie,.pie-legal { max-width:41mm; margin-left:auto; margin-right:auto; overflow-wrap:break-word; }
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
  <div class="emp">${EMPRESA.nombre.replace(' JESHA', '<br/>JESHA')}</div>
  <div class="slg">${EMPRESA.slogan}</div>
  <div class="dir">${EMPRESA.direccion}</div>
  <div class="dir">${EMPRESA.ciudad}</div>
  <div class="tel">Tel. ${EMPRESA.tel1}</div>
</div>

<div class="doc-tipo">VALE DE MATERIALES</div>

<table class="info-tbl">
  <tr><td class="lbl">Fecha:</td><td class="val">${fechaStr}</td></tr>
  <tr><td class="lbl">Bitácora:</td><td class="val">${bitacora.folio}</td></tr>
  ${bitacora.Cliente ? `<tr><td class="lbl">Cliente:</td><td class="val">${bitacora.Cliente.nombre}</td></tr>` : ''}
  ${responsable ? `<tr><td class="lbl">Atiende:</td><td class="val">${responsable.nombre}</td></tr>` : ''}
  <tr><td class="lbl">Recibe:</td><td class="val">${recibeNombre}</td></tr>
</table>

<hr class="sep-bold"/>
<table class="tbl">
  ${filasHTML}
</table>
<hr class="sep-bold"/>

<table class="info-tbl">
  <tr><td class="lbl">Este retiro:</td><td class="val">${fmt(totalRetiro)}</td></tr>
</table>

<hr class="sep"/>

<div class="resumen">
  <table class="info-tbl">
    <tr><td class="lbl">Deuda anterior:</td><td class="val">${fmt(deudaAnterior)}</td></tr>
    <tr><td class="lbl">+ Este retiro:</td><td class="val">${fmt(totalRetiro)}</td></tr>
    ${descuentoMonto > 0 ? `<tr><td class="lbl">Desc. global${descuentoLabel}:</td><td class="val">-${fmt(descuentoMonto)}</td></tr>` : ''}
    ${descuentoMonto > 0 ? `<tr><td class="lbl">Subtotal c/desc.:</td><td class="val">${fmt(subtotalConDesc)}</td></tr>` : ''}
    <tr><td class="lbl">Nueva deuda:</td><td class="val">${fmt(nuevaDeuda)}</td></tr>
    ${totalAbonado > 0 ? `<tr><td class="lbl">Total abonado:</td><td class="val">${fmt(totalAbonado)}</td></tr>` : ''}
    <tr class="saldo-final">
      <td class="lbl">SALDO ACTUAL:</td>
      <td class="val">${fmt(nuevaDeuda)}</td>
    </tr>
  </table>
</div>

<div class="pie">Recibí los materiales arriba descritos</div>
<div class="pie">Firma: ______________________________</div>
<div class="pie-legal">
  Documento interno de control.<br/>
  Para factura solicítela al momento de la compra.
</div>

<button class="no-print" onclick="window.print()">Imprimir</button>
</body>
</html>`
}

module.exports = { generarTicketMateriales, generarTicketRetiro }
