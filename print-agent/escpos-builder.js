// escpos-builder.js — arma comandos ESC/POS desde el payload del PrintJob.
// Envía los datos a la impresora vía PowerShell (Write-Printer), sin módulos nativos.
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer')
const { execFileSync } = require('child_process')
const { PNG } = require('pngjs')
const fs = require('fs')
const path = require('path')

// Quita acentos para compatibilidad con firmware de clones POS58 que no
// implementan correctamente las tablas de caracteres extendidas (PC850, PC860).
// n -> n, a -> a, e -> e, i -> i, o -> o, u -> u, u -> u, etc.
function stripAccents(str) {
  if (typeof str !== 'string') return String(str ?? '')
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Version segura de printer.println que quita acentos
function pprintln(printer, txt) {
  printer.println(stripAccents(txt))
}
function pleftRight(printer, left, right) {
  printer.leftRight(stripAccents(left), stripAccents(right))
}

// ── Helpers modo compacto ──
function isCompact(printerCfg = {}) {
  return printerCfg.compactTicket !== false
}
function trunc(str, max) {
  const s = stripAccents(str || '')
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 3)) + '...'
}
function lineLR(left, right, width) {
  const l = stripAccents(left || '')
  const r = stripAccents(right || '')
  const w = width || 42
  const space = Math.max(1, w - l.length - r.length)
  return l + ' '.repeat(space) + r
}
// ── Fin helpers compactos ──

const CODEPAGE = {
  PC850: CharacterSet.PC850_MULTILINGUAL,
  PC437: CharacterSet.PC437_USA,
  PC860: CharacterSet.PC860_PORTUGUESE
}

function makePrinter(printerCfg = {}) {
  const compact = isCompact(printerCfg)
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: { execute: () => {} },
    width: compact ? 42 : (printerCfg.width || 32),
    characterSet: CODEPAGE[printerCfg.codepage] || CharacterSet.PC850_MULTILINGUAL,
    removeSpecialCharacters: true,
    lineCharacter: '-'
  })
}

// Verifica si la impresora esta en linea (no desconectada ni en offline manual).
// Usa WorkOffline (offline manual) y PrinterStatus (7=Offline).
// Status 0 (Unknown) es comun en POS58 USB incluso cuando funciona.
function checkPrinterOnline(printerName) {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-Command',
      `$p = Get-CimInstance -ClassName Win32_Printer -Filter "Name='${printerName}'"; if (!$p) { 'NOT_FOUND'; return }; if ($p.WorkOffline -or $p.PrinterStatus -eq 7 -or $p.Availability -eq 7 -or $p.Availability -eq 8 -or $p.ExtendedPrinterStatus -eq 7) { 'OFFLINE' } else { 'ONLINE' }`
    ], { stdio: 'pipe', timeout: 5000, encoding: 'utf8' })
    const status = (out || '').trim()
    return status === 'ONLINE'
  } catch (_) {
    console.warn('[checkPrinterOnline] Error consultando estado de impresora:', _?.message || _)
    return true // ante la duda, asumir online para no bloquear ventas
  }
}

// Envia un buffer ESC/POS a la impresora Windows escribiendo a la ruta compartida
function printRaw(buffer, printerName) {
  const paths = [
    `\\\\localhost\\POS58`,                          // share name mas comun
    `\\\\localhost\\${printerName}`,                  // nombre exacto de la impresora
  ]
  for (const p of paths) {
    try {
      fs.writeFileSync(p, buffer)
      return
    } catch (_) { /* intentar siguiente */ }
  }
  throw new Error(`No se pudo enviar datos a la impresora "${printerName}" (share no disponible)`)
}

async function printTicket(printer, printerName) {
  const buf = printer.getBuffer()
  printRaw(buf, printerName)
}

function money(n) {
  const v = Number(n) || 0
  return `$${v.toFixed(2)}`
}

// Enteros sin decimales; granel con hasta 3 (sin ceros de cola).
function qty(n) {
  const v = Number(n) || 0
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function feed(printer, n) {
  for (let i = 0; i < (n || 0); i++) printer.newLine()
}

// Genera bytes ESC/POS GS v 0 desde un buffer PNG.
// Todo pixel opaco (alpha > 126) se imprime en negro.
function buildRasterImage(pngBuffer) {
  if (!pngBuffer || !Buffer.isBuffer(pngBuffer)) return null
  let png
  try {
    png = PNG.sync.read(pngBuffer)
  } catch (_) {
    return null
  }
  const { width, height, data } = png
  const bytesPerRow = Math.ceil(width / 8)
  const imgData = Buffer.alloc(bytesPerRow * height, 0)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) << 2
      const a = data[idx + 3]
      if (a > 126) {
        const byteIdx = y * bytesPerRow + (x >> 3)
        const bitIdx = 7 - (x & 7)
        imgData[byteIdx] |= (1 << bitIdx)
      }
    }
  }

  const paddedWidth = bytesPerRow * 8
  const xL = (paddedWidth >> 3) & 0xFF
  const yL = height & 0xFF
  const yH = (height >> 8) & 0xFF

  return Buffer.concat([
    Buffer.from([0x1D, 0x76, 0x30, 0, xL, 0x00, yL, yH]),
    imgData
  ])
}

function aplicarCorte(printer, cutMode) {
  if (cutMode === 'partial') printer.partialCut()
  else if (cutMode === 'full') printer.cut()
  // 'none' (default): no corta; el feed deja papel para corte manual
}

// ── Helpers de producto compactos ──
function printProductoVentaCompacto(printer, p, width) {
  const cantPrecio = `${qty(p.cantidad)}x${money(p.precioUnitario)}`
  const total = money(p.subtotal)
  const right = `${cantPrecio}  ${total}`
  const maxName = Math.max(8, width - right.length - 1)
  const name = trunc(p.nombre || '', maxName)
  pprintln(printer, lineLR(name, right, width))
}
function printProductoRetiroCompacto(printer, p, width) {
  const cant = qty(p.cantidad)
  const precio = p.precioUnitario != null ? money(p.precioUnitario) : ''
  const right = `x${cant} ${precio}`.trim()
  const maxName = Math.max(8, width - right.length - 1)
  const name = trunc(p.nombre || '', maxName)
  pprintln(printer, lineLR(name, right, width))
}

// ── Ticket de VENTA ──
function buildVentaTicket(printer, payload, printerCfg = {}, logoBuffer = null) {
  const emp = payload.empresa || {}
  const v = payload.venta || {}
  const productos = Array.isArray(payload.productos) ? payload.productos : []
  const compact = isCompact(printerCfg)
  const w = compact ? 42 : (printerCfg.width || 32)

  if (compact) printer.setTypeFontB()

  if (printerCfg.printLogo && logoBuffer) {
    const raster = buildRasterImage(logoBuffer)
    if (raster) {
      printer.alignCenter()
      printer.append(raster)
      feed(printer, 1)
    }
  }

  if (compact) {
    headerEmpresaCompacto(printer, emp)

    printer.alignLeft()
    const folioCorto = v.folio ? v.folio.slice(-5) : ''
    pprintln(printer, lineLR(v.fecha || '', `Folio: ${folioCorto}`, w))
    const cli = trunc(`Cliente: ${payload.cliente || 'Publico General'}`, 27)
    const caj = payload.cajero ? trunc(`Cajero: ${payload.cajero}`, 14) : ''
    pprintln(printer, lineLR(cli, caj, w))

    printer.drawLine()

    for (const p of productos) {
      printProductoVentaCompacto(printer, p, w)
    }

    if (Number(v.descuento) > 0) {
      pprintln(printer, lineLR(`Subtotal: ${money(v.subtotal)}`, `Desc: -${money(v.descuento)}`, w))
    } else {
      pprintln(printer, lineLR('Subtotal:', money(v.subtotal), w))
    }

    printer.drawLine()

    printer.setTypeFontA()
    printer.bold(true)
    printer.alignCenter()
    pprintln(printer, `TOTAL ${money(v.total)}`)
    printer.bold(false)
    if (compact) printer.setTypeFontB()
    printer.alignLeft()
    printer.drawLine()

    const metodo = payload.metodoLabel || payload.metodoPago || ''
    if (metodo) pprintln(printer, `Metodo: ${metodo}`)
    const recibido = Number(payload.montoPagado) > 0 ? `Rec: ${money(payload.montoPagado)}` : ''
    const cambio = Number(payload.cambio) > 0 ? `Cambio: ${money(payload.cambio)}` : ''
    const pagoLine2 = [recibido, cambio].filter(Boolean).join('  ')
    if (pagoLine2) pprintln(printer, trunc(pagoLine2, w))

    if (payload.qrUrl) {
      printer.drawLine()
      printer.alignCenter()
      printer.printQR(payload.qrUrl, { cellSize: 4, correction: 'M' })
      pprintln(printer, 'Escanea para solicitar factura')
      printer.drawLine()
    }

    printer.alignCenter()
    pprintln(printer, 'Gracias por su compra')
    pprintln(printer, 'Conserve su ticket para aclaraciones')
    pprintln(printer, 'Factura dentro de 3 dias')
    pprintln(printer, 'No devoluciones por mal uso')

  } else {

    headerEmpresa(printer, emp)

    printer.drawLine()
    printer.alignLeft()
    const folioCorto = v.folio ? v.folio.slice(-5) : ''
    pleftRight(printer, v.fecha || '', `Folio: ${folioCorto}`)
    if (payload.cajero) pprintln(printer, `Cajero: ${payload.cajero}`)
    pprintln(printer, `Cliente: ${payload.cliente || 'Publico General'}`)

    printer.drawLine()
    pleftRight(printer, 'Descripcion', 'Importe')
    for (const p of productos) {
      pprintln(printer, String(p.nombre || ''))
      pleftRight(printer, `  ${qty(p.cantidad)} x ${money(p.precioUnitario)}`, money(p.subtotal))
    }

    printer.drawLine()
    pleftRight(printer, 'Subtotal:', money(v.subtotal))
    if (Number(v.descuento) > 0) {
      pleftRight(printer, 'Descuento:', `-${money(v.descuento)}`)
    }
    printer.drawLine()

    printer.setTextDoubleHeight()
    pleftRight(printer, 'TOTAL', money(v.total))
    printer.setTextNormal()
    printer.drawLine()

    pleftRight(printer, 'Metodo:', payload.metodoLabel || payload.metodoPago || '')
    if (Number(payload.montoPagado) > 0) {
      pleftRight(printer, 'Recibido:', money(payload.montoPagado))
    }
    if (Number(payload.cambio) > 0) {
      pleftRight(printer, 'Cambio:', money(payload.cambio))
    }

    if (payload.qrUrl) {
      printer.drawLine()
      printer.alignCenter()
      printer.printQR(payload.qrUrl, { cellSize: 4, correction: 'M' })
      printer.newLine()
      pprintln(printer, 'Escanea para solicitar factura')
    }

    printer.drawLine()
    printer.alignCenter()
    pprintln(printer, 'Gracias por su compra')
    pprintln(printer, 'Conserve su ticket para')
    pprintln(printer, 'aclaraciones')
    printer.drawLine()
    pprintln(printer, 'El cliente cuenta con 3 dias')
    pprintln(printer, 'para realizar su factura.')
    pprintln(printer, 'Pasado el plazo, JESHA no')
    pprintln(printer, 'se hace responsable.')
    pprintln(printer, 'No se aceptan devoluciones')
    pprintln(printer, 'por mal uso.')
  }

  feed(printer, printerCfg.feedLinesAfterPrint ?? 2)
  aplicarCorte(printer, printerCfg.cutMode || 'none')

  // Cajon: doble candado - habilitado en config Y solicitado en el payload
  if (printerCfg.openCashDrawerEnabled && payload.abrirCajon) {
    printer.openCashDrawer()
  }
}

// ── Ticket de CORTE DE CAJA ──
function buildCorteTicket(printer, payload, printerCfg = {}, logoBuffer = null) {
  const emp = payload.empresa || {}
  const c = payload.corte || {}
  const movimientos = Array.isArray(payload.movimientos) ? payload.movimientos : []
  const compact = isCompact(printerCfg)
  const w = compact ? 42 : (printerCfg.width || 32)

  if (compact) printer.setTypeFontB()

  if (printerCfg.printLogo && logoBuffer) {
    const raster = buildRasterImage(logoBuffer)
    if (raster) {
      printer.alignCenter()
      printer.append(raster)
      feed(printer, 1)
    }
  }

  if (compact) {
    headerEmpresaCompacto(printer, emp)

    printer.drawLine()
    printer.alignCenter()
    printer.bold(true)
    pprintln(printer, 'CORTE DE CAJA')
    printer.bold(false)
    printer.drawLine()

    printer.alignLeft()
    const infos = []
    if (c.turnoId) infos.push(`Turno: #${c.turnoId}`)
    if (c.sucursal) infos.push(`Suc: ${c.sucursal}`)
    if (payload.cajero) infos.push(`Cajero: ${payload.cajero}`)
    infos.push(c.fecha || '')
    pprintln(printer, infos.join('  '))

    pprintln(printer, 'Movimientos:')
    for (const m of movimientos) {
      pprintln(printer, lineLR(`  ${m.metodo || ''}`, money(m.monto), w))
    }

    printer.drawLine()
    pprintln(printer, lineLR('Calculado:', money(c.montoCalculado), w))
    pprintln(printer, lineLR('Declarado:', money(c.montoFinalDeclarado), w))
    const diff = Number(c.diferencia) || 0
    if (diff !== 0) {
      pprintln(printer, lineLR('Diferencia:', diff > 0 ? `+${money(diff)}` : `-${money(Math.abs(diff))}`, w))
    } else {
      pprintln(printer, lineLR('Diferencia:', '$0.00', w))
    }

    printer.drawLine()
    printer.alignLeft()
    pprintln(printer, 'Firma Cajero: ____________________')
    pprintln(printer, 'Firma Supervisor: ________________')

  } else {

    headerEmpresa(printer, emp)

    printer.drawLine()
    printer.alignCenter()
    printer.setTextDoubleHeight()
    pprintln(printer, 'CORTE DE CAJA')
    printer.setTextNormal()
    printer.drawLine()

    printer.alignLeft()
    if (c.turnoId) pprintln(printer, `Turno: #${c.turnoId}`)
    if (payload.cajero) pprintln(printer, `Cajero: ${payload.cajero}`)
    pprintln(printer, `Fecha: ${c.fecha || ''}`)
    if (c.sucursal) pprintln(printer, `Sucursal: ${c.sucursal}`)

    printer.drawLine()
    pprintln(printer, 'Movimientos por metodo:')
    for (const m of movimientos) {
      pleftRight(printer, `  ${m.metodo || ''}`, money(m.monto))
    }

    printer.drawLine()
    pleftRight(printer, 'Total calculado:', money(c.montoCalculado))
    pleftRight(printer, 'Total declarado:', money(c.montoFinalDeclarado))
    const diff = Number(c.diferencia) || 0
    if (diff !== 0) {
      pleftRight(printer, 'Diferencia:', diff > 0 ? `+${money(diff)}` : `-${money(Math.abs(diff))}`)
    } else {
      pleftRight(printer, 'Diferencia:', '$0.00')
    }

    printer.drawLine()
    printer.alignCenter()
    pprintln(printer, 'Firma Cajero')
    feed(printer, 2)
    printer.drawLine()
    pprintln(printer, 'Firma Supervisor')
  }

  feed(printer, printerCfg.feedLinesAfterPrint ?? 2)
  aplicarCorte(printer, printerCfg.cutMode || 'none')
}

// ── Ticket de ABONO ──
function buildAbonoTicket(printer, payload, printerCfg = {}, logoBuffer = null) {
  const emp = payload.empresa || {}
  const a = payload.abono || {}
  const compact = isCompact(printerCfg)
  const w = compact ? 42 : (printerCfg.width || 32)

  if (compact) printer.setTypeFontB()

  if (printerCfg.printLogo && logoBuffer) {
    const raster = buildRasterImage(logoBuffer)
    if (raster) {
      printer.alignCenter()
      printer.append(raster)
      feed(printer, 1)
    }
  }

  if (compact) {
    headerEmpresaCompacto(printer, emp)

    printer.drawLine()
    printer.alignCenter()
    printer.bold(true)
    pprintln(printer, 'COMPROBANTE DE ABONO')
    printer.bold(false)
    printer.drawLine()

    printer.alignLeft()
    const infos = []
    if (a.abonoId) infos.push(`Abono: #${a.abonoId}`)
    if (payload.cajero) infos.push(`Cajero: ${payload.cajero}`)
    infos.push(a.fecha || '')
    pprintln(printer, infos.join('  '))
    pprintln(printer, `Cliente: ${payload.cliente || 'No especificado'}`)

    printer.drawLine()
    const metodo = payload.metodoLabel || payload.metodoPago || ''
    pprintln(printer, lineLR(metodo, `Abonado: ${money(a.monto)}`, w))

    if (a.saldoAnterior != null) {
      pprintln(printer, lineLR('Saldo anterior:', money(a.saldoAnterior), w))
    }
    if (a.saldoNuevo != null) {
      const saldo = Number(a.saldoNuevo) || 0
      if (saldo <= 0) {
        pprintln(printer, lineLR('Saldo:', 'LIQUIDADA', w))
      } else {
        pprintln(printer, lineLR('Saldo pendiente:', money(a.saldoNuevo), w))
      }
    }

    printer.drawLine()
    printer.alignCenter()
    pprintln(printer, 'Gracias por su pago')

  } else {

    headerEmpresa(printer, emp)

    printer.drawLine()
    printer.alignCenter()
    printer.setTextDoubleHeight()
    pprintln(printer, 'COMPROBANTE')
    pprintln(printer, 'DE ABONO')
    printer.setTextNormal()
    printer.drawLine()

    printer.alignLeft()
    if (a.abonoId) pprintln(printer, `Abono No: ${a.abonoId}`)
    pprintln(printer, `Fecha: ${a.fecha || ''}`)
    if (payload.cajero) pprintln(printer, `Cajero: ${payload.cajero}`)
    pprintln(printer, `Cliente: ${payload.cliente || 'No especificado'}`)
    printer.drawLine()

    pleftRight(printer, 'Metodo:', payload.metodoLabel || payload.metodoPago || '')
    pleftRight(printer, 'Monto abonado:', money(a.monto))

    printer.drawLine()
    if (a.saldoAnterior != null) {
      pleftRight(printer, 'Saldo anterior:', money(a.saldoAnterior))
    }
    if (a.saldoNuevo != null) {
      const saldo = Number(a.saldoNuevo) || 0
      if (saldo <= 0) {
        pleftRight(printer, 'Estado:', 'LIQUIDADA')
      } else {
        pleftRight(printer, 'Saldo pendiente:', money(a.saldoNuevo))
      }
    }

    printer.drawLine()
    printer.alignCenter()
    pprintln(printer, 'Gracias por su pago')
  }

  feed(printer, printerCfg.feedLinesAfterPrint ?? 2)
  aplicarCorte(printer, printerCfg.cutMode || 'none')

  if (printerCfg.openCashDrawerEnabled && payload.abrirCajon) {
    printer.openCashDrawer()
  }
}

// ── Ticket de RETIRO DE MATERIALES ──
function buildRetiroTicket(printer, payload, printerCfg = {}, logoBuffer = null) {
  const emp = payload.empresa || {}
  const r = payload.retiro || {}
  const productos = Array.isArray(payload.productos) ? payload.productos : []
  const compact = isCompact(printerCfg)
  const w = compact ? 42 : (printerCfg.width || 32)

  if (compact) printer.setTypeFontB()

  if (printerCfg.printLogo && logoBuffer) {
    const raster = buildRasterImage(logoBuffer)
    if (raster) {
      printer.alignCenter()
      printer.append(raster)
      feed(printer, 1)
    }
  }

  if (compact) {
    headerEmpresaCompacto(printer, emp)

    printer.drawLine()
    printer.alignCenter()
    printer.bold(true)
    pprintln(printer, 'RETIRO DE MATERIALES')
    printer.bold(false)
    printer.drawLine()

    printer.alignLeft()
    const infos = []
    if (r.retiroId) infos.push(`Retiro: #${r.retiroId}`)
    infos.push(r.fecha || '')
    if (payload.cajero) infos.push(`Entrega: ${payload.cajero}`)
    if (r.trabajador) infos.push(`Recibe: ${r.trabajador}`)
    pprintln(printer, infos.join('  '))

    for (const p of productos) {
      printProductoRetiroCompacto(printer, p, w)
    }

    printer.drawLine()
    printer.alignLeft()
    pprintln(printer, 'Firma recibe: ____________________')

  } else {

    headerEmpresa(printer, emp)

    printer.drawLine()
    printer.alignCenter()
    printer.setTextDoubleHeight()
    pprintln(printer, 'RETIRO DE')
    pprintln(printer, 'MATERIALES')
    printer.setTextNormal()
    printer.drawLine()

    printer.alignLeft()
    if (r.retiroId) pprintln(printer, `Retiro No: ${r.retiroId}`)
    pprintln(printer, `Fecha: ${r.fecha || ''}`)
    if (payload.cajero) pprintln(printer, `Entregado por: ${payload.cajero}`)
    if (r.trabajador) pprintln(printer, `Recibido por: ${r.trabajador}`)

    printer.drawLine()
    pleftRight(printer, 'Producto', 'Cantidad')
    for (const p of productos) {
      pprintln(printer, String(p.nombre || ''))
      pleftRight(printer, `  x ${qty(p.cantidad)}`, p.precioUnitario != null ? money(p.precioUnitario) : '')
    }

    printer.drawLine()
    printer.alignCenter()
    pprintln(printer, 'Firma de quien recibe')
    feed(printer, 2)
    printer.drawLine()
  }

  feed(printer, printerCfg.feedLinesAfterPrint ?? 2)
  aplicarCorte(printer, printerCfg.cutMode || 'none')
}

// ── Helper: header comun de empresa (completo) ──
function headerEmpresa(printer, emp) {
  printer.alignCenter()
  pprintln(printer, emp.nombre || '')
  if (emp.slogan) pprintln(printer, emp.slogan)
  if (emp.direccion) pprintln(printer, emp.direccion)
  if (emp.ciudad) pprintln(printer, emp.ciudad)
  if (emp.rfc) pprintln(printer, `RFC: ${emp.rfc}`)
  if (emp.telefono) pprintln(printer, `Tel: ${emp.telefono}`)
}

// ── Helper: header compacto (modo compacto) ──
function headerEmpresaCompacto(printer, emp) {
  printer.alignCenter()
  pprintln(printer, emp.nombre || '')
  if (emp.direccion) pprintln(printer, emp.direccion)
  if (emp.rfc) pprintln(printer, `RFC: ${emp.rfc}`)
  if (emp.telefono) pprintln(printer, `Tel: ${emp.telefono}`)
}

// Dispatcher por tipo.
function buildTicket(printer, payload, printerCfg = {}, logoBuffer = null) {
  switch (payload && payload.tipo) {
    case 'VENTA':
      return buildVentaTicket(printer, payload, printerCfg, logoBuffer)
    case 'CORTE':
      return buildCorteTicket(printer, payload, printerCfg, logoBuffer)
    case 'ABONO':
      return buildAbonoTicket(printer, payload, printerCfg, logoBuffer)
    case 'RETIRO':
      return buildRetiroTicket(printer, payload, printerCfg, logoBuffer)
    case 'CAJON':
      printer.openCashDrawer()
      return
    default:
      throw new Error(`tipo de ticket no soportado: ${payload && payload.tipo}`)
  }
}

module.exports = {
  makePrinter, buildTicket,
  buildVentaTicket, buildCorteTicket, buildAbonoTicket, buildRetiroTicket,
  printTicket, money, qty, stripAccents, pprintln, pleftRight,
  checkPrinterOnline, buildRasterImage
}
