// agent.js — Print Agent local (Windows). Consume PrintJobs y los imprime en la POS58.
// Modos:
//   node agent.js            -> loop normal (reset huérfanos + polling)
//   node agent.js --list     -> lista impresoras que ve la librería y sale
//   node agent.js --hello    -> imprime HOLA MUNDO y sale
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { makePrinter, buildTicket, printTicket } = require('./escpos-builder')

// ── Config ──
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
const API_URL = process.env.JESHA_API_URL || cfg.apiUrl
const TOKEN = process.env.JESHA_AGENT_TOKEN
const PRINTER = cfg.printer || {}
const PRINTER_NAME = (PRINTER.interface || '').replace(/^printer:/, '') || 'POS58 Printer'
const POLL_MS = cfg.pollIntervalMs || 2000
const TIMEOUT_MS = cfg.networkTimeoutMs || 8000

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

  // Fase A: construir + imprimir. Si falla aquí, NADA salió -> /fail (seguro reintentar).
  try {
    const printer = makePrinter(PRINTER)
    buildTicket(printer, job.payload, PRINTER)
    printTicket(printer, PRINTER_NAME)
  } catch (err) {
    const msg = String((err && err.message) || err)
    console.error(`  -> fallo de impresión: ${msg}`)
    await reportFail(job.printJobId, msg)
    return true
  }

  // Fase B: el ticket YA salió. Confirmar con reintentos; nunca /fail aquí.
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
  const printer = makePrinter(PRINTER)
  printer.openCashDrawer()
  printTicket(printer, PRINTER_NAME)
  console.log('Cajón abierto.')
}

// ── Modo --hello: ticket mínimo de prueba ──
function helloWorld() {
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
  printer.cut()
  for (let i = 0; i < (PRINTER.feedLinesAfterPrint || 4); i++) printer.newLine()
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

  // Reset de huérfanos: con 1 agente, todo EN_PROCESO previo está atascado.
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

  loop()
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
