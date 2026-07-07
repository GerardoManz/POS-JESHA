// agent.js — Print Agent local (Windows). Consume PrintJobs y los imprime en la POS58.
// Modos:
//   node agent.js            -> loop normal (reset huérfanos + polling)
//   node agent.js --list     -> lista impresoras que ve la librería y sale
//   node agent.js --hello    -> imprime HOLA MUNDO y sale
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { makePrinter, buildTicket, printTicket, checkPrinterOnline } = require('./escpos-builder')

// ── Config ──
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
const API_URL = process.env.JESHA_API_URL || cfg.apiUrl
const TOKEN = process.env.JESHA_AGENT_TOKEN
const PRINTER = cfg.printer || {}
const PRINTER_NAME = (PRINTER.interface || '').replace(/^printer:/, '') || 'POS58 Printer'
const POLL_MS = cfg.pollIntervalMs || 2000
const TIMEOUT_MS = cfg.networkTimeoutMs || 8000
const SKIP_OLD = cfg.skipOldJobs !== false
const OLD_THRESHOLD_MS = (cfg.oldJobThresholdMinutes || 120) * 60 * 1000
const RESET_ON_START = cfg.resetOnStart === true
const LOGO_URL = cfg.printer && cfg.printer.logoUrl || null
let LOGO_BUFFER = null

if (!TOKEN) {
  console.error('Falta JESHA_AGENT_TOKEN en .env')
  process.exit(1)
}

// ── HTTP al backend (fetch global de Node 22) con timeout ──
async function api(reqPath, { method = 'POST', body } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(API_URL + reqPath, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
  } finally {
    clearTimeout(t)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Parsea fecha "DD/MM/YY HH:mm" del payload a Date
function parsePayloadDate(payload) {
  const raw = (payload && (payload.venta?.fecha || payload.corte?.fecha || payload.abono?.fecha || payload.retiro?.fecha))
  if (!raw) return null
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/)
  if (!m) return null
  const [_, dd, mm, yy, hh, mi] = m
  return new Date(`20${yy}-${mm}-${dd}T${hh}:${mi}:00`)
}

// Confirma /success con reintentos. NUNCA llama /fail (el ticket ya salió).
async function confirmSuccess(id, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await api(`/impresion/agent/${id}/success`)
      if (r.ok) return true
    } catch (_) { /* reintentar */ }
    await sleep(500 * (i + 1))
  }
  return false
}

async function reportFail(id, msg) {
  try {
    await api(`/impresion/agent/${id}/fail`, { body: { error: msg } })
  } catch (_) { /* el reaper lo recupera */ }
}

// ── Procesa un trabajo (un ciclo). Devuelve true si tomó un trabajo. ──
async function tick() {
  let res
  try {
    res = await api('/impresion/agent/next')
  } catch (e) {
    console.error('[next] red:', e.name === 'AbortError' ? 'timeout' : e.message)
    return false
  }
  if (res.status === 204) return false // sin trabajos
  if (!res.ok) {
    console.error('[next] HTTP', res.status)
    return false
  }

  const job = await res.json()
  console.log(`Job ${job.printJobId} | ${job.tipo}/${job.modo}`)

  // Seguridad: saltar jobs antiguos sin imprimirlos
  if (SKIP_OLD) {
    const fecha = parsePayloadDate(job.payload)
    if (fecha) {
      const edadMs = Date.now() - fecha.getTime()
      if (edadMs > OLD_THRESHOLD_MS) {
        const dias = Math.round(edadMs / 86400000)
        console.log(`  -> saltado (${dias}d antiguo, umbral ${cfg.oldJobThresholdMinutes || 120}min)`)
        await reportFail(job.printJobId, `omitido por antiguedad: ${dias} dias`)
        return true
      }
    }
  }

  // Fase A: verificar que la impresora esté en línea
  if (!checkPrinterOnline(PRINTER_NAME)) {
    console.log(`  -> impresora NO disponible (offline/desconectada)`)
    await reportFail(job.printJobId, 'impresora no disponible')
    return true
  }

  // Fase B: construir + imprimir. Si falla aquí, NADA salió -> /fail (seguro reintentar).
  try {
    const printer = makePrinter(PRINTER)
    buildTicket(printer, job.payload, PRINTER, LOGO_BUFFER)
    printTicket(printer, PRINTER_NAME)
  } catch (err) {
    const msg = String((err && err.message) || err)
    console.error(`  -> fallo de impresión: ${msg}`)
    await reportFail(job.printJobId, msg)
    return true
  }

  // Fase C: el ticket YA salió. Confirmar con reintentos; nunca /fail aquí.
  const ok = await confirmSuccess(job.printJobId)
  if (ok) {
    console.log(`  -> ENVIADO_A_IMPRESORA`)
  } else {
    console.error(`  -> CRITICO: ticket ${job.printJobId} impreso pero /success no confirmo. ` +
      'No se marca fail para evitar reimpresion inmediata; el reaper podria reintentarlo.')
  }
  return true
}

// ── Loop: poll continuo; si procesó, vuelve enseguida; si no, espera ──
async function loop() {
  let printed = false
  try {
    printed = await tick()
  } catch (e) {
    console.error('[loop]', e.message)
  }
  setTimeout(loop, printed ? 0 : POLL_MS)
}

// ── Modo --list: impresoras del sistema mediante PowerShell ──
function listPrinters() {
  const { execFileSync } = require('child_process')
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-Command',
      'Get-Printer | Select-Object Name,PrinterStatus,DriverName,PortName | ConvertTo-Json'
    ], { stdio: 'pipe', timeout: 10000 })
    const printers = JSON.parse(out.toString().trim())
    const arr = Array.isArray(printers) ? printers : [printers]
    console.log('Impresoras del sistema:')
    for (const p of arr) {
      console.log(`  - "${p.Name}"  (status: ${p.PrinterStatus}, port: ${p.PortName})`)
    }
  } catch (e) {
    console.error('Error listando impresoras:', e.message)
  }
  console.log(`\nConfig actual interface: "${PRINTER.interface}"`)
  console.log(`Nombre usado para imprimir: "${PRINTER_NAME}"`)
}

// ── Modo --drawer: abre el cajón de dinero ──
function drawerTest() {
  if (!checkPrinterOnline(PRINTER_NAME)) {
    console.log(`ERROR: Impresora "${PRINTER_NAME}" no disponible. Verifica que esté encendida y conectada.`)
    process.exit(1)
  }
  const printer = makePrinter(PRINTER)
  printer.openCashDrawer()
  printTicket(printer, PRINTER_NAME)
  console.log('Cajón abierto.')
}

// ── Modo --hello: ticket mínimo de prueba ──
function helloWorld() {
  if (!checkPrinterOnline(PRINTER_NAME)) {
    console.log(`ERROR: Impresora "${PRINTER_NAME}" no disponible. Verifica que esté encendida y conectada.`)
    process.exit(1)
  }
  const printer = makePrinter(PRINTER)
  printer.alignCenter()
  printer.bold(true)
  printer.println('HOLA MUNDO')
  printer.bold(false)
  printer.println('JESHA POS - prueba de agente')
  printer.println(new Date().toLocaleString())
  printer.drawLine()
  printer.println('Acentos: n a e i o u')
  printer.println('UTF simple: n a e i o u $')
  for (let i = 0; i < (PRINTER.feedLinesAfterPrint || 4); i++) printer.newLine()
  printer.cut()
  printTicket(printer, PRINTER_NAME)
  console.log('HOLA MUNDO enviado.')
}

// ── Arranque ──
async function main() {
  const arg = process.argv[2]

  if (arg === '--list') return listPrinters()
  if (arg === '--hello') return helloWorld()
  if (arg === '--drawer') return drawerTest()

  console.log(`Print Agent | API ${API_URL} | impresora "${PRINTER.interface}"`)
  if (SKIP_OLD) console.log(`Seguridad: saltando jobs >${cfg.oldJobThresholdMinutes || 120}min de antiguedad`)

  // Reset de huérfanos: opcional (config.resetOnStart=true), desactivado por defecto
  // para no re-procesar jobs antiguos al arrancar.
  if (RESET_ON_START) {
    try {
      const r = await api('/impresion/agent/reset')
      if (r.ok) {
        const { resetCount } = await r.json()
        console.log(`Reset de huérfanos: ${resetCount} job(s) devueltos a PENDIENTE`)
      } else {
        console.warn(`Reset devolvió HTTP ${r.status} (¿token o API?)`)
      }
    } catch (e) {
      console.warn('No se pudo resetear al arrancar:', e.message)
    }
  }

  // Limpiar spooler al arrancar (jobs huérfanos de ejecuciones previas)
  try {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Get-PrintJob -PrinterName "${PRINTER_NAME}" -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue`
    ], { stdio: 'pipe', timeout: 10000 })
  } catch (_) { /* si falla la limpieza, no es crítico */ }

  // Monitor periódico de estado de impresora (cada 30s)
  let printerWasOnline = null
  setInterval(() => {
    const online = checkPrinterOnline(PRINTER_NAME)
    if (online !== printerWasOnline) {
      printerWasOnline = online
      if (online) {
        console.log(`[monitor] Impresora "${PRINTER_NAME}" ONLINE`)
      } else {
        console.log(`[monitor] Impresora "${PRINTER_NAME}" OFFLINE - no se imprimiran tickets hasta que vuelva`)
      }
    }
  }, 30000)

  // Cargar logo desde Cloudinary a buffer (para printImageBuffer)
  if (LOGO_URL) {
    try {
      const res = await fetch(LOGO_URL)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        LOGO_BUFFER = Buffer.from(buf)
        // Verificar firma PNG (bytes 0-3: 89 50 4E 47)
        if (LOGO_BUFFER[0] === 0x89 && LOGO_BUFFER[1] === 0x50) {
          console.log('Logo cargado de Cloudinary (PNG)')
        } else {
          console.warn('Logo descargado NO es PNG — verificar URL sin f_auto. Bytes:', LOGO_BUFFER.slice(0, 4).toString('hex'))
          LOGO_BUFFER = null
        }
      } else {
        console.warn('No se pudo cargar el logo: HTTP', res.status)
      }
    } catch (e) {
      console.warn('No se pudo cargar el logo:', e.message)
    }
  }

  loop()
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
