// src/modules/impresion/impresion.snapshot.js
// Constructores PUROS del payload del ticket (sin prisma, sin red, sin req).
// Consumen valores ya normalizados: el hook que vive en cada controller mapea
// los campos reales de la entidad a estas entradas. El agente arma el ESC/POS
// a partir de este payload.

// Conversión segura de Decimal/string/number de Prisma a number.
function num(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

// Fecha local Zacatecas (UTC-6 fijo, sin DST) -> "dd/mm/yy HH:MM".
// Desplaza a UTC-6 y lee campos UTC para evitar drift por toISOString().
function formatFechaTicket(d = new Date()) {
  const z = new Date(d.getTime() - 6 * 60 * 60 * 1000)
  const dd = String(z.getUTCDate()).padStart(2, '0')
  const mm = String(z.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(z.getUTCFullYear()).slice(-2)
  const hh = String(z.getUTCHours()).padStart(2, '0')
  const mi = String(z.getUTCMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy} ${hh}:${mi}`
}

function shapeEmpresa(e = {}) {
  return {
    nombre: e.nombre || '',
    slogan: e.slogan || null,
    direccion: e.direccion || '',
    ciudad: e.ciudad || '',
    rfc: e.rfc || null,
    telefono: e.telefono || e.tel || null
  }
}

// VENTA — incluye QR de facturación y, opcionalmente, cajón.
function buildVentaSnapshot({
  empresa, folio, fecha, subtotal, descuento = 0, total,
  productos = [], metodoPago, metodoLabel, montoPagado = 0, cambio = 0,
  cajero = null, cliente = null, qrUrl = null, logoUrl = null,
  abrirCajon = false, copia = false, copiaNum = null
}) {
  return {
    tipo: 'VENTA',
    empresa: shapeEmpresa(empresa),
    venta: {
      folio: folio == null ? null : String(folio),
      fecha,
      subtotal: num(subtotal),
      descuento: num(descuento),
      total: num(total)
    },
    productos: productos.map((p) => ({
      nombre: String(p.nombre || ''),
      cantidad: num(p.cantidad),
      precioUnitario: num(p.precioUnitario),
      subtotal: num(p.subtotal),
      unidad: p.unidad ?? null
    })),
    metodoPago: metodoPago || null,
    metodoLabel: metodoLabel || metodoPago || '',
    montoPagado: num(montoPagado),
    cambio: num(cambio),
    cajero,
    cliente,
    qrUrl,
    logoUrl,
    abrirCajon: !!abrirCajon,
    copia: !!copia,
    copiaNum
  }
}

// CORTE — sin QR, sin cajón.
function buildCorteSnapshot({
  empresa, turnoId = null, fecha, cajero = null, sucursal = null,
  montoCalculado, montoFinalDeclarado, diferencia, movimientos = []
}) {
  return {
    tipo: 'CORTE',
    empresa: shapeEmpresa(empresa),
    corte: {
      turnoId,
      fecha,
      sucursal,
      montoCalculado: num(montoCalculado),
      montoFinalDeclarado: num(montoFinalDeclarado),
      diferencia: num(diferencia)
    },
    cajero,
    movimientos: movimientos.map((m) => ({
      metodo: String(m.metodo || ''),
      monto: num(m.monto)
    })),
    abrirCajon: false,
    copia: false
  }
}

// ABONO — cajón solo si el abono fue en efectivo (lo decide el hook).
function buildAbonoSnapshot({
  empresa, abonoId = null, fecha, cajero = null, cliente = null,
  montoAbono, metodoPago, metodoLabel,
  saldoAnterior = null, saldoNuevo = null, abrirCajon = false
}) {
  return {
    tipo: 'ABONO',
    empresa: shapeEmpresa(empresa),
    abono: {
      abonoId,
      fecha,
      monto: num(montoAbono),
      saldoAnterior: saldoAnterior == null ? null : num(saldoAnterior),
      saldoNuevo: saldoNuevo == null ? null : num(saldoNuevo)
    },
    cliente,
    cajero,
    metodoPago: metodoPago || null,
    metodoLabel: metodoLabel || metodoPago || '',
    abrirCajon: !!abrirCajon,
    copia: false
  }
}

// RETIRO — sin QR, sin cajón.
function buildRetiroSnapshot({
  empresa, retiroId = null, fecha, cajero = null, trabajador = null,
  productos = []
}) {
  return {
    tipo: 'RETIRO',
    empresa: shapeEmpresa(empresa),
    retiro: { retiroId, fecha, trabajador },
    cajero,
    productos: productos.map((p) => ({
      nombre: String(p.nombre || ''),
      cantidad: num(p.cantidad),
      precioUnitario: p.precioUnitario == null ? null : num(p.precioUnitario)
    })),
    abrirCajon: false,
    copia: false
  }
}

module.exports = {
  num,
  formatFechaTicket,
  shapeEmpresa,
  buildVentaSnapshot,
  buildCorteSnapshot,
  buildAbonoSnapshot,
  buildRetiroSnapshot
}
