// ════════════════════════════════════════════════════════════════════
//  REPORTE.CONTROLLER.JS
//  Genera el HTML imprimible (A4) del reporte completo de una bitácora.
//  GET /bitacoras/:id/reporte
//  src/modules/bitacora/reporte.controller.js
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

function fmt(v) {
  return '$' + parseFloat(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtFechaCorta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function nombreTrabajador(t) {
  if (!t) return '—'
  return t.apodo ? `${t.apodo} (${t.nombre})` : t.nombre
}

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras/:id/reporte
// ════════════════════════════════════════════════════════════════════
const generarReporte = async (req, res) => {
  try {
    const { id } = req.params
    const empresaId = getEmpresaId(req)

    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true, folio: true, titulo: true, descripcion: true, origen: true, estado: true,
        totalMateriales: true, totalAbonado: true, saldoPendiente: true,
        descuentoTipo: true, descuentoValor: true, descuentoMonto: true,
        notas: true, creadaEn: true, cerradaEn: true, empresaId: true,
        Cliente: { select: { nombre: true, telefono: true } },
        Usuario:  { select: { nombre: true } },
        Sucursal: { select: { nombre: true } },
        DetalleBitacora: {
          orderBy: { creadoEn: 'asc' },
          select: {
            id: true, cantidad: true, precioUnitario: true, subtotal: true,
            fechaManual: true, retiroBitacoraId: true,
            recibeNombre: true, notas: true,
            Producto:    { select: { nombre: true, unidadVenta: true } },
            Responsable: { select: { nombre: true } },
            RecibeTrabajador: { select: { nombre: true, apodo: true } }
          }
        },
        RetiroBitacora: {
          orderBy: { creadoEn: 'asc' },
          select: {
            id: true, recibeNombre: true, fechaManual: true, total: true, creadoEn: true,
            Responsable: { select: { nombre: true } }
          }
        },
        AbonoBitacora: {
          orderBy: { creadoEn: 'asc' },
          select: {
            id: true, monto: true, metodoPago: true, notas: true, creadoEn: true,
            Usuario: { select: { nombre: true } }
          }
        }
      }
    })

    if (!bitacora || bitacora.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Bitácora no encontrada' })
    }

    // Agrupar detalles por retiroBitacoraId
    const retirosInfo = new Map()
    if (bitacora.RetiroBitacora) {
      for (const r of bitacora.RetiroBitacora) {
        retirosInfo.set(r.id, r)
      }
    }

    const sinRetiro = []
    const porRetiro = new Map()
    for (const d of bitacora.DetalleBitacora || []) {
      if (d.retiroBitacoraId) {
        if (!porRetiro.has(d.retiroBitacoraId)) porRetiro.set(d.retiroBitacoraId, [])
        porRetiro.get(d.retiroBitacoraId).push(d)
      } else {
        sinRetiro.push(d)
      }
    }

    const html = generarHTMLReporte(bitacora, porRetiro, retirosInfo, sinRetiro)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    console.error('❌ Error reporte bitacora:', err)
    res.status(500).json({ error: err.message })
  }
}

function generarHTMLReporte(bitacora, porRetiro, retirosInfo, sinRetiro) {
  const totalMateriales = parseFloat(bitacora.totalMateriales || 0)
  const totalAbonado    = parseFloat(bitacora.totalAbonado || 0)
  const saldoPendiente  = parseFloat(bitacora.saldoPendiente || 0)
  const descuentoMonto  = parseFloat(bitacora.descuentoMonto || 0)
  const descuentoValor  = parseFloat(bitacora.descuentoValor || 0)
  const descuentoTipo   = bitacora.descuentoTipo || null
  const subtotalConDesc = parseFloat((totalMateriales - descuentoMonto).toFixed(2))

  let descuentoEtiqueta = ''
  if (descuentoMonto > 0) {
    descuentoEtiqueta = descuentoTipo === 'PORCENTAJE'
      ? `${descuentoValor}%`
      : 'Monto fijo'
  }

  // Contar total de productos
  const totalItems = (bitacora.DetalleBitacora || []).length

  // Armar filas de productos
  let filasHTML = ''

  // 1. Por retiro
  for (const [retiroId, items] of porRetiro) {
    const ri = retirosInfo.get(retiroId)
    const fechaRetiro = ri?.fechaManual ? fmtFechaCorta(ri.fechaManual) : '—'
    const recibeRetiro = ri?.recibeNombre || '—'
    const responsableRetiro = ri?.Responsable?.nombre || '—'
    const totalRetiro = items.reduce((s, d) => parseFloat((s + parseFloat(d.subtotal || 0)).toFixed(2)), 0)

    filasHTML += `<tr class="retiro-header">
      <td colspan="7">
        <div class="retiro-bar">
          <span class="retiro-badge">Retiro #${retiroId}</span>
          <span>${fechaRetiro}</span>
          <span>Entregó: ${responsableRetiro}</span>
          <span>Recibió: ${recibeRetiro}</span>
          <span class="retiro-total">${fmt(totalRetiro)}</span>
        </div>
      </td>
    </tr>`

    for (const d of items) {
      filasHTML += filaProductoHTML(d)
    }
  }

  // 2. Sin retiro
  if (sinRetiro.length > 0) {
    filasHTML += `<tr class="retiro-header">
      <td colspan="7"><div class="retiro-bar"><span class="retiro-badge">Ventas / directos</span></div></td>
    </tr>`
    for (const d of sinRetiro) {
      filasHTML += filaProductoHTML(d)
    }
  }

  // Abonos
  let abonosHTML = ''
  if ((bitacora.AbonoBitacora || []).length > 0) {
    abonosHTML = `
    <div class="seccion">
      <div class="seccion-titulo">Historial de Abonos</div>
      <table class="tbl-abonos">
        <thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Cajero</th><th>Nota</th></tr></thead>
        <tbody>
          ${bitacora.AbonoBitacora.map(a => `
            <tr>
              <td>${fmtFecha(a.creadoEn)}</td>
              <td class="monto-positivo">${fmt(a.monto)}</td>
              <td>${a.metodoPago}</td>
              <td>${a.Usuario?.nombre || '—'}</td>
              <td>${a.notas || ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`
  }

  const descuentoHTML = descuentoMonto > 0 ? `
    <tr><td class="lbl">Descuento Global (${descuentoEtiqueta})</td><td class="val descuento-val">- ${fmt(descuentoMonto)}</td></tr>
    <tr><td class="lbl">Subtotal con Descuento</td><td class="val">${fmt(subtotalConDesc)}</td></tr>` : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Reporte ${bitacora.folio}</title>
<style>
@page { size: A4; margin: 8mm; }
* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html, body { font-family:Arial,Helvetica,sans-serif; font-size:10px; color:#1a1a1a; background:#fff; line-height:1.35; }
.hdr { text-align:center; padding-bottom:3mm; border-bottom:2px solid #1a1a1a; margin-bottom:3mm; }
.logo { display:block; margin:0 auto 1.5mm; width:28mm; height:auto; image-rendering:crisp-edges; }
.emp { font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:1px; }
.slg { font-size:9px; font-weight:700; margin-top:0.3mm; color:#444; }
.dir { font-size:8px; font-weight:700; margin-top:0.2mm; color:#555; }
.tel { font-size:9px; font-weight:900; margin-top:0.5mm; }

.doc-tipo { text-align:center; font-size:14px; font-weight:900; letter-spacing:3px; padding:2mm 0; background:#1f3a66; color:#fff; margin:2mm 0; }

.info-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:2mm; margin-bottom:3mm; }
.info-item { font-size:8px; }
.info-label { font-weight:700; color:#555; text-transform:uppercase; font-size:7px; }
.info-valor { font-weight:700; font-size:9px; margin-top:0.5mm; }

.seccion { margin:3mm 0; }
.seccion-titulo { font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; padding:1.5mm 2mm; background:#f0f0f0; border-bottom:1.5px solid #1a1a1a; }

.tbl-prods { width:100%; border-collapse:collapse; font-size:8px; }
.tbl-prods th { padding:1.5mm 2mm; text-align:left; background:#f5f5f5; border-bottom:1.5px solid #1a1a1a; font-size:7px; font-weight:900; text-transform:uppercase; color:#555; }
.tbl-prods td { padding:1.5mm 2mm; border-bottom:0.5px solid #ddd; vertical-align:top; }
.tbl-prods .num { text-align:right; white-space:nowrap; }
.tbl-prods .prod-nombre { font-weight:700; }
.tbl-prods .prod-detalle { font-size:7px; color:#666; }

.retiro-header td { padding:2mm 2mm 1mm 2mm; background:#eef2f7; border-bottom:1px solid #ccc; }
.retiro-bar { display:flex; align-items:center; gap:3mm; font-size:8px; }
.retiro-badge { font-weight:900; color:#1f3a66; }
.retiro-total { font-weight:900; color:#1f3a66; margin-left:auto; font-size:9px; }

.resumen { margin:3mm 0; border:1.5px solid #1a1a1a; padding:2mm; }
.resumen table { width:100%; border-collapse:collapse; font-size:9px; }
.resumen td { padding:0.8mm 2mm; }
.resumen .lbl { text-align:left; font-weight:700; width:62%; }
.resumen .val { text-align:right; font-weight:900; width:38%; }
.resumen .saldo-final td { font-size:12px; font-weight:900; border-top:1.5px solid #1a1a1a; padding-top:1.5mm; }
.descuento-val { color:#c2410c; }

.tbl-abonos { width:100%; border-collapse:collapse; font-size:8px; }
.tbl-abonos th { padding:1mm 2mm; text-align:left; background:#f5f5f5; border-bottom:1px solid #ccc; font-size:7px; font-weight:700; color:#555; }
.tbl-abonos td { padding:1mm 2mm; border-bottom:0.5px solid #eee; }
.monto-positivo { font-weight:900; color:#166534; }

.pie { text-align:center; font-size:8px; color:#777; margin-top:4mm; padding-top:2mm; border-top:1px solid #ddd; }
.pie-legal { text-align:center; font-size:7px; color:#999; margin-top:1mm; }

.no-print { display:block; margin:12px auto 5px; padding:10px 28px; background:#1f3a66; color:#fff; border:none; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; }

@media print {
  .no-print { display:none !important; }
  html, body { width:100%; }
  * { color:#000 !important; }
  .doc-tipo, .doc-tipo * { color:#fff !important; background:#1f3a66 !important; }
  .logo { filter:contrast(2) brightness(0); }
  .descuento-val { color:#000 !important; }
  .monto-positivo { color:#000 !important; }
}
@media screen {
  html, body { max-width:210mm; margin:0 auto; padding:5mm 8mm; box-shadow:0 0 15px rgba(0,0,0,0.1); }
}
</style>
</head>
<body>

<div class="hdr">
  <img src="${LOGO_URL}" alt="JESHA" class="logo" />
  <div class="emp">${EMPRESA.nombre}</div>
  <div class="slg">${EMPRESA.slogan}</div>
  <div class="dir">${EMPRESA.direccion} — ${EMPRESA.ciudad}</div>
  <div class="tel">Tel. ${EMPRESA.tel1}</div>
</div>

<div class="doc-tipo">REPORTE DE BITÁCORA</div>

<div class="info-grid">
  <div class="info-item">
    <div class="info-label">Folio</div>
    <div class="info-valor">${bitacora.folio}</div>
  </div>
  <div class="info-item">
    <div class="info-label">Fecha Inicio</div>
    <div class="info-valor">${fmtFecha(bitacora.creadaEn)}</div>
  </div>
  <div class="info-item">
    <div class="info-label">Estado</div>
    <div class="info-valor">${bitacora.estado === 'CERRADA_VENTA' ? 'Pagada' : bitacora.estado === 'CERRADA_INTERNA' ? 'Cerrada interna' : bitacora.estado === 'CANCELADA' ? 'Cancelada' : bitacora.estado === 'PAUSADA' ? 'Pausada' : 'Abierta'}</div>
  </div>
  <div class="info-item">
    <div class="info-label">Título</div>
    <div class="info-valor">${bitacora.titulo || '—'}</div>
  </div>
  <div class="info-item">
    <div class="info-label">Cajero</div>
    <div class="info-valor">${bitacora.Usuario?.nombre || '—'}</div>
  </div>
  <div class="info-item">
    <div class="info-label">Origen</div>
    <div class="info-valor">${bitacora.origen === 'VENTA' ? 'POS (crédito)' : 'Manual'}</div>
  </div>
  <div class="info-item">
    <div class="info-label">Cliente</div>
    <div class="info-valor">${bitacora.Cliente?.nombre || '—'}</div>
  </div>
  <div class="info-item">
    <div class="info-label">Teléfono</div>
    <div class="info-valor">${bitacora.Cliente?.telefono || '—'}</div>
  </div>
  <div class="info-item">
    <div class="info-label">Sucursal</div>
    <div class="info-valor">${bitacora.Sucursal?.nombre || '—'}</div>
  </div>
</div>

${bitacora.descripcion ? `<p style="font-size:8px;color:#555;margin-bottom:2mm;padding:2mm;background:#f9f9f9;border-left:3px solid #1f3a66;">${bitacora.descripcion}</p>` : ''}

<div class="seccion">
  <div class="seccion-titulo">Productos (${totalItems} items)</div>
  <table class="tbl-prods">
    <thead>
      <tr>
        <th>Producto</th>
        <th class="num">Cant.</th>
        <th class="num">Precio</th>
        <th class="num">Subtotal</th>
        <th>Fecha</th>
        <th>Entregó</th>
        <th>Recibió</th>
      </tr>
    </thead>
    <tbody>
      ${filasHTML || '<tr><td colspan="7" style="text-align:center;padding:4mm;">Sin productos registrados</td></tr>'}
    </tbody>
  </table>
</div>

<div class="resumen">
  <table>
    <tr><td class="lbl">Total Materiales</td><td class="val">${fmt(totalMateriales)}</td></tr>
    ${descuentoHTML}
    <tr><td class="lbl">Total Abonado</td><td class="val monto-positivo">${fmt(totalAbonado)}</td></tr>
    <tr class="saldo-final">
      <td class="lbl">Saldo Pendiente</td>
      <td class="val">${fmt(saldoPendiente)}</td>
    </tr>
  </table>
</div>

${abonosHTML}

${bitacora.notas ? `<p style="font-size:8px;color:#555;margin-top:2mm;padding:2mm;background:#f9f9f9;border-left:3px solid #999;">Notas: ${bitacora.notas}</p>` : ''}

<div class="pie">
  Documento de control interno generado desde JESHA POS<br/>
  ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
</div>
<div class="pie-legal">
  Todos los importes incluyen IVA si aplica. Para factura solicítela al momento de la compra.
</div>

<button class="no-print" onclick="window.print()">Imprimir Reporte</button>
</body>
</html>`
}

function filaProductoHTML(d) {
  const nombre = d.Producto?.nombre || '—'
  const unidad = d.Producto?.unidadVenta || 'pz'
  const cantidad = parseFloat(d.cantidad || 0)
  const precio   = parseFloat(d.precioUnitario || 0)
  const subtotal = parseFloat(d.subtotal || 0)
  const fecha    = d.fechaManual ? fmtFechaCorta(d.fechaManual) : '—'
  const entrego  = d.Responsable?.nombre || '—'
  const recibio  = d.recibeNombre || (d.RecibeTrabajador ? nombreTrabajador(d.RecibeTrabajador) : '—')

  return `<tr>
    <td class="prod-nombre">${nombre}</td>
    <td class="num">${cantidad} ${unidad}</td>
    <td class="num">${fmt(precio)}</td>
    <td class="num">${fmt(subtotal)}</td>
    <td>${fecha}</td>
    <td>${entrego}</td>
    <td>${recibio}</td>
  </tr>`
}

module.exports = { generarReporte }
