// ════════════════════════════════════════════════════════════════════
//  FACTURACION.CONTROLLER.JS
//  src/modules/facturacion/facturacion.controller.js
//  Rutas públicas — sin requireAuth (portal de autofactura)
//  + función de timbrado interno via Facturapi
//
//  Fase 2 — Hardening de timbrado individual:
//  - Se crea FacturaCfdi PENDIENTE_TIMBRADO + FacturaVenta ANTES de llamar a
//    Facturapi (cierra la ventana de crash "sellado sin registro local").
//  - Dual-write: ventaId (guard legacy/índice parcial) + FacturaVenta (fuente de verdad).
//  - idempotency_key = jesha-factura-{id} en cada create (anti doble-sellado).
//  - timbrarManual toma un CAS local (procesandoTimbrado) anti doble-clic concurrente.
//  - Clasificación de error: VALIDACION (4xx, no sellado, reintentable) vs
//    INCIERTO (timeout/5xx/409/sin status → pudo sellarse → revisión manual).
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const resolverEmpresaScope = require('../../helpers/resolverEmpresaScope')
const resolverDatosEmisor = require('../../helpers/resolverDatosEmisor')
const { getFacturapi } = require('../../lib/facturapi')

const TASA_IVA   = parseFloat(process.env.TASA_IVA || '0.16')
const IVA_FACTOR = 1 + TASA_IVA

const FORMA_PAGO_SAT = {
  EFECTIVO:      '01',
  DEBITO:        '28',
  CREDITO:       '04',
  TRANSFERENCIA: '03'
}

const PERIODICIDAD_FACTURAPI = {
  '01': 'day',
  '02': 'week',
  '03': 'fortnight',
  '04': 'month',
  '05': 'two_months'
}

const METODOS_GLOBALES = ['EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA']

// Plazo de autofacturación en línea por QR público: 72h desde la venta.
// El canal interno de mostrador NO usa este límite (conserva facturaLimite = mes fiscal).
const HORAS_LIMITE_QR = 72

// ════════════════════════════════════════════════════════════════════
//  RFC PÚBLICO EN GENERAL — reglas del SAT para CFDI 4.0
//
//  RFC XAXX010101000 + nombre "PUBLICO EN GENERAL" = factura GLOBAL
//  → requiere nodo InformacionGlobal (Facturapi no lo soporta en invoices)
//
//  RFC XAXX010101000 + nombre DIFERENTE = factura individual sin RFC
//  → NO requiere InformacionGlobal, funciona normal en Facturapi
//
//  Solución: cuando el RFC es genérico, forzar que el nombre NO sea
//  exactamente "PUBLICO EN GENERAL" para que sea factura individual.
//  También forzar régimen 616, uso S01, y CP del emisor.
//
//  NOTA Fase 4: este builder NO sirve para factura GLOBAL real (renombra
//  "PUBLICO EN GENERAL" → "VENTA AL PUBLICO" y no agrega el nodo global).
//  La global usará un builder separado.
// ════════════════════════════════════════════════════════════════════
const RFC_PUBLICO_GENERAL = 'XAXX010101000'
const ACENTOS_RAZON_SOCIAL = /[ÁÉÍÓÚÜáéíóúü]/

function esRfcGenerico(rfc) {
  return rfc && rfc.trim().toUpperCase() === RFC_PUBLICO_GENERAL
}

function validarRazonSocialSat(razonSocial) {
  const razon = String(razonSocial || '').trim().normalize('NFC')
  if (!razon) return 'Nombre o razón social requerida'
  if (ACENTOS_RAZON_SOCIAL.test(razon)) return 'La razón social debe escribirse sin acentos. Ejemplo: FERRETERIA, no FERRETERÍA.'
  if (razon !== razon.toUpperCase()) return 'La razón social debe escribirse en MAYÚSCULAS.'
  return null
}

function obtenerFacturaActivaDeVenta(venta) {
  const directas = Array.isArray(venta.FacturaCfdi) ? venta.FacturaCfdi : []
  const vinculadas = Array.isArray(venta.FacturaVenta)
    ? venta.FacturaVenta.map(fv => fv.FacturaCfdi).filter(Boolean)
    : []
  return [...directas, ...vinculadas].find(f => f.estado !== 'CANCELADA')
}

// Devuelve el nombre del primer detalle SERVICIO con clave SAT inválida (no 8
// dígitos), o null si todos son facturables. Se llama ANTES de crear el lock
// PENDIENTE (o antes de timbrar en manual) para rechazar con 400 sin dejar la
// venta atorada en PENDIENTE_TIMBRADO. NO aplica a factura global (usa 01010101).
function primerServicioInvalido(detalles) {
  for (const d of detalles) {
    if (d.Producto?.tipo === 'SERVICIO' && !/^\d{8}$/.test(d.Producto?.claveSat || '')) {
      return d.Producto?.nombre || `producto ${d.productoId}`
    }
  }
  return null
}

// ════════════════════════════════════════════════════════════════════
//  Construir objeto de invoice para Facturapi (DRY)
//  Usado tanto en solicitarFactura como en timbrarManual.
//  El idempotency_key se agrega en el call site (es campo top-level).
// ════════════════════════════════════════════════════════════════════
function buildInvoicePayload({ rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdi, email, metodoPago, detalles, datosEmisor }) {
  const rfcUpper = rfc.trim().toUpperCase()

  const items = detalles.map(d => {
    const esServicio  = d.Producto?.tipo === 'SERVICIO'
    const claveValida = d.Producto?.claveSat && /^\d{8}$/.test(d.Producto.claveSat)
    // Defensa en profundidad: un servicio sin clave válida NO cae al default de
    // ferretería. El pre-check en el call site evita llegar aquí con el lock puesto.
    if (esServicio && !claveValida) {
      throw new Error(`Servicio "${d.Producto?.nombre || '?'}" requiere clave SAT de 8 dígitos válida`)
    }
    return {
      quantity: parseFloat(d.cantidad),
      product: {
        description:  d.Producto?.nombre || 'Mercancía',
        product_key:  claveValida ? d.Producto.claveSat : '31161500',
        unit_key:     d.Producto?.unidadSat || (esServicio ? 'E48' : 'H87'),
        price:        parseFloat(d.precioUnitario),
        tax_included: true,
        taxes: [{ type: 'IVA', rate: TASA_IVA, factor: 'Tasa', withholding: false }]
      }
    }
  })

  // Nombre para el customer
  let nombreFinal = razonSocial.trim()

  // ── FIX: Si es RFC genérico, asegurar que NO diga "PUBLICO EN GENERAL" ──
  // porque eso dispara la regla SAT de factura global (InformacionGlobal)
  // que Facturapi no soporta en invoices. Usamos "VENTA AL PUBLICO" en su lugar.
  if (esRfcGenerico(rfcUpper)) {
    const nombreNorm = nombreFinal.toUpperCase().replace(/\s+/g, ' ').trim()
    if (nombreNorm === 'PUBLICO EN GENERAL' || nombreNorm === 'PÚBLICO EN GENERAL') {
      nombreFinal = 'VENTA AL PUBLICO'
    }
    // Forzar datos correctos del SAT para RFC genérico
    regimenFiscal = '616'
    usoCfdi       = 'S01'
    codigoPostal  = datosEmisor.cp
    console.log(`📋 RFC genérico detectado — nombre: "${nombreFinal}", régimen: 616, uso: S01`)
  }

  const payload = {
    customer: {
      legal_name: nombreFinal,
      tax_id:     rfcUpper,
      tax_system: regimenFiscal,
      email:      email || undefined,
      address:    { zip: codigoPostal.trim() }
    },
    use:            usoCfdi,
    payment_form:   FORMA_PAGO_SAT[metodoPago] || '01',
    payment_method: 'PUE',
    items
  }

  return payload
}

function buildGlobalInvoicePayload({ ventas, metodoPago, periodicidad, mes, anio, datosEmisor }) {
  const paymentForm = FORMA_PAGO_SAT[metodoPago]
  if (!paymentForm) {
    throw new Error(`metodoPago inválido para global: "${metodoPago}". Use uno de: ${METODOS_GLOBALES.join(', ')}`)
  }

  const totalRaw = ventas.reduce((sum, v) => sum + parseFloat(v.total), 0)
  const total    = parseFloat(totalRaw.toFixed(2))
  const subtotal = parseFloat((total / IVA_FACTOR).toFixed(2))
  const iva      = parseFloat((total - subtotal).toFixed(2))

  const items = ventas.map(v => ({
    quantity: 1,
    product: {
      description: `Venta ${v.folio}`,
      product_key: '01010101',
      unit_key:    'ACT',
      price:       parseFloat(v.total),
      tax_included: true,
      taxes: [{ type: 'IVA', rate: TASA_IVA, factor: 'Tasa', withholding: false }]
    }
  }))

  const periodicityValue = PERIODICIDAD_FACTURAPI[periodicidad]
  if (!periodicityValue) {
    throw new Error(`periodicidad inválida: "${periodicidad}". Use 01-05.`)
  }

  return {
    customer: {
      legal_name: 'PUBLICO EN GENERAL',
      tax_id:     RFC_PUBLICO_GENERAL,
      tax_system: '616',
      email:      undefined,
      address:    { zip: datosEmisor.cp }
    },
    use:            'S01',
    payment_form:   paymentForm,
    payment_method: 'PUE',
    items,
    global: {
      periodicity: periodicityValue,
      months:      mes,
      year:        parseInt(anio, 10)
    }
  }
}

exports.buildGlobalInvoicePayload = buildGlobalInvoicePayload
exports.METODOS_GLOBALES = METODOS_GLOBALES
exports.PERIODICIDAD_FACTURAPI = PERIODICIDAD_FACTURAPI

// ════════════════════════════════════════════════════════════════════
//  Helpers Fase 2
// ════════════════════════════════════════════════════════════════════

// Ventas asociadas a una factura: FacturaVenta (fuente de verdad) con FALLBACK
// LEGACY a FacturaCfdi.ventaId para facturas creadas antes del backfill/retrofit.
async function obtenerVentaIdsDeFactura(facturaId, ventaIdLegacy) {
  const relaciones = await prisma.facturaVenta.findMany({
    where: { facturaId },
    select: { ventaId: true }
  })
  if (relaciones.length > 0) return relaciones.map(r => r.ventaId)
  return ventaIdLegacy != null ? [ventaIdLegacy] : []
}

// Clasifica un error de Facturapi para decidir si es seguro reintentar.
//  - VALIDACION: 4xx claro (payload rechazado, NO se selló) → reintentable corrigiendo.
//  - INCIERTO:   timeout / 5xx / 409 / sin status → pudo sellarse → revisión manual.
// Conservador a propósito: ante la duda, INCIERTO (nunca re-timbra a ciegas).
function clasificarErrorTimbrado(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status
  const reintentables = [408, 409, 425, 429] // timeout/conflicto/rate-limit → inciertos
  if (typeof status === 'number' && status >= 400 && status < 500 && !reintentables.includes(status)) {
    return 'VALIDACION'
  }
  // El SDK de Facturapi puede lanzar Error plano sin status en errores 400.
  // Si el mensaje es claramente de validación de campos, es seguro liberar lock.
  const msg = (err?.message || '').toLowerCase()
  if (/campo|obligatorio|inv[aá]lid|v[aá]lid|requerid|required/.test(msg)) {
    return 'VALIDACION'
  }
  return 'INCIERTO'
}

// Calcula la idempotency_key a usar:
//  - Sin correcciones: reutiliza la key existente (reconciliación segura por timeout),
//    o asigna la base si aún no tiene.
//  - Con correcciones tras un 4xx: NUEVA revisión (-r2, -r3...) para no toparse con
//    una respuesta cacheada del intento anterior.
function calcularIdempotencyKey(facturaId, keyActual, huboCorrecciones) {
  const base = `jesha-factura-${facturaId}`
  if (!huboCorrecciones) return keyActual || base
  if (!keyActual) return base
  const m = /-r(\d+)$/.exec(keyActual)
  const n = m ? parseInt(m[1], 10) + 1 : 2
  const raiz = keyActual.replace(/-r\d+$/, '')
  return `${raiz}-r${n}`
}

const REGIMENES_FISCALES = [
  { clave: '601', descripcion: 'General de Ley Personas Morales' },
  { clave: '603', descripcion: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', descripcion: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { clave: '606', descripcion: 'Arrendamiento' },
  { clave: '607', descripcion: 'Régimen de Enajenación o Adquisición de Bienes' },
  { clave: '608', descripcion: 'Demas ingresos' },
  { clave: '610', descripcion: 'Residentes en el Extranjero sin Establecimiento Permanente en Mexico' },
  { clave: '611', descripcion: 'Ingresos por Dividendos (socios y accionistas)' },
  { clave: '612', descripcion: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '614', descripcion: 'Ingresos por intereses' },
  { clave: '615', descripcion: 'Ingresos por obtención de premios' },
  { clave: '616', descripcion: 'Sin obligaciones fiscales' },
  { clave: '620', descripcion: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos' },
  { clave: '621', descripcion: 'Incorporación Fiscal' },
  { clave: '622', descripcion: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { clave: '623', descripcion: 'Opcional para Grupos de Sociedades' },
  { clave: '624', descripcion: 'Coordinados' },
  { clave: '625', descripcion: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { clave: '626', descripcion: 'Régimen Simplificado de Confianza' },
]

const USOS_CFDI = [
  { clave: 'G01', descripcion: 'Adquisición de mercancias' },
  { clave: 'G02', descripcion: 'Devoluciones, descuentos o bonificaciones' },
  { clave: 'G03', descripcion: 'Gastos en general' },
  { clave: 'I01', descripcion: 'Construcciones' },
  { clave: 'I02', descripcion: 'Mobilario y equipo de oficina por inversiones' },
  { clave: 'I03', descripcion: 'Equipo de transporte' },
  { clave: 'I04', descripcion: 'Equipo de computo y accesorios' },
  { clave: 'I05', descripcion: 'Dados, troqueles, moldes, matrices y herramental' },
  { clave: 'I06', descripcion: 'Comunicaciones telefónicas' },
  { clave: 'I08', descripcion: 'Otra maquinaria y equipo' },
  { clave: 'D01', descripcion: 'Honorarios médicos, dentales y gastos hospitalarios' },
  { clave: 'D02', descripcion: 'Gastos médicos por incapacidad o discapacidad' },
  { clave: 'D03', descripcion: 'Gastos funerales' },
  { clave: 'D04', descripcion: 'Donativos' },
  { clave: 'D05', descripcion: 'Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)' },
  { clave: 'D06', descripcion: 'Aportaciones voluntarias al SAR' },
  { clave: 'D07', descripcion: 'Primas por seguros de gastos médicos' },
  { clave: 'D08', descripcion: 'Gastos de transportación escolar obligatoria' },
  { clave: 'D09', descripcion: 'Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones' },
  { clave: 'D10', descripcion: 'Pagos por servicios educativos (colegiaturas)' },
  { clave: 'S01', descripcion: 'Sin efectos fiscales' },
  { clave: 'CP01', descripcion: 'Pagos' },
  { clave: 'CN01', descripcion: 'Nomina' },
]

// ════════════════════════════════════════════════════════════════════
//  GET /facturar/api?token=XXX
// ════════════════════════════════════════════════════════════════════
exports.obtenerVentaPorToken = async (req, res) => {
  try {
    const { token } = req.query
    if (!token) return res.status(400).json({ error: 'Token requerido' })

    const venta = await prisma.venta.findFirst({
      where: { tokenQr: token },
      include: {
        Cliente: {
          select: {
            id: true, nombre: true, rfc: true, razonSocial: true,
            regimenFiscal: true, codigoPostalFiscal: true, usoCfdi: true, email: true,
            emailSecundario1: true, emailSecundario2: true
          }
        },
        DetalleVenta: { include: { Producto: { select: { nombre: true } } } },
        FacturaCfdi:  true,
        FacturaVenta: { include: { FacturaCfdi: true } }
      }
    })

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada. Verifica el QR.' })

    const ahora      = new Date()
    const fechaVenta  = new Date(venta.creadaEn)
    const horas      = (ahora - fechaVenta) / (1000 * 60 * 60)

    // venta.FacturaCfdi ahora es un array (relación 1-a-muchos). La "factura viva"
    // es la única no cancelada; el índice parcial en BD garantiza que haya máximo una.
    const facturaActiva = obtenerFacturaActivaDeVenta(venta)
    if (facturaActiva) {
      const uuid = facturaActiva.folioFiscal || null
      return res.status(409).json({
        error: uuid ? 'Esta venta ya fue facturada.' : 'Esta venta tiene un proceso de factura en curso. Intenta más tarde.',
        uuid
      })
    }
    if (venta.estado === 'CANCELADA') return res.status(400).json({ error: 'Esta venta fue cancelada y no puede facturarse.' })
    if (venta.facturaEstado === 'BLOQUEADA') return res.status(400).json({ error: 'Esta venta no puede facturarse en línea (efectivo mayor a $2,000). Solicita tu factura directamente en sucursal.' })
    if (horas > HORAS_LIMITE_QR) return res.status(400).json({ razon: 'TIEMPO_EXPIRADO', error: 'El plazo de autofacturación en línea (3 días) venció. Solicita tu factura directamente en sucursal.' })
    if (venta.facturaEstado === 'VENCIDA' || ahora > new Date(venta.facturaLimite)) return res.status(400).json({ error: 'El plazo para solicitar factura venció. Contacta a la sucursal si necesitas ayuda.' })

    res.json({
      success: true,
      venta: {
        id: venta.id, folio: venta.folio, fecha: fechaVenta,
        total: parseFloat(venta.total), metodoPago: venta.metodoPago,
        horasTranscurridas: Math.floor(horas),
        productos: venta.DetalleVenta.map(d => ({
          nombre: d.Producto?.nombre || '—', cantidad: d.cantidad,
          precio: parseFloat(d.precioUnitario),
          subtotal: parseFloat(d.subtotal || (d.precioUnitario * d.cantidad))
        }))
      },
      clienteDatos: venta.Cliente ? {
        rfc: venta.Cliente.rfc || '', razonSocial: venta.Cliente.razonSocial || venta.Cliente.nombre || '',
        regimenFiscal: venta.Cliente.regimenFiscal || '', codigoPostal: venta.Cliente.codigoPostalFiscal || '',
        usoCfdi: venta.Cliente.usoCfdi || 'G03', email: venta.Cliente.email || '',
        emailSecundario1: venta.Cliente.emailSecundario1 || '',
        emailSecundario2: venta.Cliente.emailSecundario2 || '',
      } : null,
      catalogos: { regimenes: REGIMENES_FISCALES, usosCfdi: USOS_CFDI }
    })
  } catch (err) {
    console.error('❌ Error obtenerVentaPorToken:', err)
    // Portal público: 500 fijo intencional. No usa resolverEmpresaScope ni
    // propaga .status (no hay errores expose aquí); cualquier fallo es interno.
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturar/api — solicitar + timbrar (crash-safe)
// ════════════════════════════════════════════════════════════════════
exports.solicitarFactura = async (req, res) => {
  try {
    const { token, rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdi, email, emailSecundario1, emailSecundario2 } = req.body

    if (!token)         return res.status(400).json({ error: 'Token requerido' })
    if (!rfc)           return res.status(400).json({ error: 'RFC requerido' })
    if (!razonSocial)   return res.status(400).json({ error: 'Nombre o razón social requerida' })
    if (!regimenFiscal) return res.status(400).json({ error: 'Régimen fiscal requerido' })
    if (!codigoPostal)  return res.status(400).json({ error: 'Código postal fiscal requerido' })
    if (!usoCfdi)       return res.status(400).json({ error: 'Uso CFDI requerido' })
    if (!email)         return res.status(400).json({ error: 'Email requerido' })

    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(rfc.trim())) return res.status(400).json({ error: 'RFC inválido.' })
    const errorRazonSocial = validarRazonSocialSat(razonSocial)
    if (errorRazonSocial) return res.status(400).json({ error: errorRazonSocial })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Email inválido.' })

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const sec1 = (emailSecundario1 || '').trim()
    const sec2 = (emailSecundario2 || '').trim()
    if (sec1 && !emailRegex.test(sec1)) return res.status(400).json({ error: 'Email secundario 1 inválido.' })
    if (sec2 && !emailRegex.test(sec2)) return res.status(400).json({ error: 'Email secundario 2 inválido.' })

    const venta = await prisma.venta.findFirst({
      where: { tokenQr: token },
      include: {
        FacturaCfdi: true,
        FacturaVenta: { include: { FacturaCfdi: true } },
        DetalleVenta: { include: { Producto: true } }
      }
    })

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })

    // Factura viva (no cancelada) → ya facturada
    const facturaActiva = obtenerFacturaActivaDeVenta(venta)
    if (facturaActiva) {
      return res.status(409).json({
        error: facturaActiva.folioFiscal ? 'Esta venta ya fue facturada.' : 'Esta venta tiene un proceso de factura en curso. Intenta más tarde.',
        uuid: facturaActiva.folioFiscal || null
      })
    }

    const empresaId = venta.empresaId
    if (venta.estado === 'CANCELADA') return res.status(400).json({ error: 'Venta cancelada.' })
    if (venta.facturaEstado === 'BLOQUEADA') return res.status(400).json({ error: 'Venta no facturable en línea.' })
    // Gate por canal: QR público = 72h desde la venta; interno (mostrador) = mes fiscal (facturaLimite).
    // Fail-safe: cualquier valor que no sea 'INTERNO' explícito se trata como QR (canal restrictivo).
    const esCanalQr = req.canalFacturacion !== 'INTERNO'
    if (esCanalQr) {
      const horasQr = (new Date() - new Date(venta.creadaEn)) / 36e5
      if (horasQr > HORAS_LIMITE_QR) {
        return res.status(400).json({ error: 'El plazo de autofacturación en línea (3 días) venció. Solicita tu factura en sucursal.' })
      }
    } else if (new Date() > new Date(venta.facturaLimite)) {
      return res.status(400).json({ error: 'Plazo de facturación vencido.' })
    }
    // Defensa adicional al check de factura viva: solo se factura si está DISPONIBLE.
    if (venta.facturaEstado !== 'DISPONIBLE') {
      return res.status(409).json({ error: 'Esta venta tiene un proceso de factura en curso. Intenta más tarde.' })
    }

    // Pre-check ANTES del lock: un servicio sin clave válida se rechaza aquí (400),
    // sin crear la FacturaCfdi PENDIENTE que dejaría la venta atorada en 409.
    const servMalo = primerServicioInvalido(venta.DetalleVenta)
    if (servMalo) {
      return res.status(400).json({ error: `Servicio "${servMalo}" sin clave SAT de 8 dígitos. Corrige el producto antes de facturar.` })
    }

    const total        = parseFloat(venta.total)
    const subtotal     = parseFloat((total / IVA_FACTOR).toFixed(2))
    const iva          = parseFloat((total - subtotal).toFixed(2))
    const rfcUpper     = rfc.trim().toUpperCase()
    const nombreReceptor = razonSocial.trim()
    const emailTrimmed = email.trim()

    const datosFactura = {
      empresaId,
      ventaId: venta.id, clienteId: venta.clienteId || null,
      rfcReceptor: rfcUpper, nombreReceptor,
      cpReceptor: codigoPostal.trim(), regimenFiscal, usoCfdi,
      emailReceptor: emailTrimmed,
      emailSecundario1: sec1 || null,
      emailSecundario2: sec2 || null,
      lugarExpedicion: process.env.JESHA_CP_EMISOR || '98660',
      subtotal, iva, total
    }

    // ── 1) Crear PENDIENTE + FacturaVenta + bloquear venta (transacción corta) ──
    // El índice parcial sobre ventaId garantiza una sola factura viva por venta:
    // si otra solicitud ganó la carrera, el create lanza P2002 → 409.
    let factura
    try {
      factura = await prisma.$transaction(async (tx) => {
        const f = await tx.facturaCfdi.create({
          data: {
            ...datosFactura,
            estado: 'PENDIENTE_TIMBRADO',
            tipoFactura: 'INDIVIDUAL',
            procesandoTimbrado: true,
            procesandoTimbradoEn: new Date(),
            idempotencyKey: null
          }
        })
        await tx.facturaVenta.create({ data: { facturaId: f.id, ventaId: venta.id } })
        await tx.venta.update({
          where: { id: venta.id },
          data: { facturaEstado: 'PENDIENTE_TIMBRADO', procesoFacturaId: f.id }
        })
        // idempotencyKey determinística a partir del id
        return tx.facturaCfdi.update({
          where: { id: f.id },
          data: { idempotencyKey: `jesha-factura-${f.id}` }
        })
      })
    } catch (e) {
      if (e?.code === 'P2002') {
        return res.status(409).json({ error: 'Esta venta ya tiene una factura en proceso o emitida.' })
      }
      throw e
    }

    const fp = getFacturapi()

    // Sin Facturapi: queda PENDIENTE_TIMBRADO para timbrado manual.
    if (!fp) {
      await prisma.facturaCfdi.update({
        where: { id: factura.id },
        data: { procesandoTimbrado: false, procesandoTimbradoEn: null }
      })
      console.log(`📋 Factura PENDIENTE_TIMBRADO creada (sin Facturapi): ${factura.id} | ${venta.folio} | ${rfcUpper}`)
      return res.status(202).json({
        success: true, timbrado: false,
        mensaje: `Solicitud de factura recibida. Te enviaremos la factura a ${emailTrimmed} cuando sea procesada.`,
        facturaId: factura.id
      })
    }

    // ── 2) Timbrar con idempotency_key (fuera de transacción) ──
    const idempotencyKey = `jesha-factura-${factura.id}`
    let invoice = null
    let selladoOk = false
    const datosEmisor = resolverDatosEmisor(empresaId)
    try {
      invoice = await fp.invoices.create({
        ...buildInvoicePayload({
          rfc: rfcUpper, razonSocial: nombreReceptor, regimenFiscal, codigoPostal,
          usoCfdi, email: emailTrimmed, metodoPago: venta.metodoPago,
          detalles: venta.DetalleVenta, datosEmisor
        }),
        idempotency_key: idempotencyKey
      })
      selladoOk = true

      // ── 3) Éxito → TIMBRADA + venta FACTURADA ──
      await prisma.$transaction([
        prisma.facturaCfdi.update({
          where: { id: factura.id },
          data: {
            folioFiscal: invoice.uuid, facturapiId: invoice.id,
            estado: 'TIMBRADA', timbradaEn: new Date(),
            procesandoTimbrado: false, procesandoTimbradoEn: null, ultimoErrorTimbrado: null
          }
        }),
        prisma.venta.update({
          where: { id: venta.id },
          data: { facturaEstado: 'FACTURADA', procesoFacturaId: null }
        })
      ])

      const emailsEnvio = [emailTrimmed, sec1, sec2].filter(Boolean)
      try { await fp.invoices.sendByEmail(invoice.id, { email: emailsEnvio }) } catch (e) { console.warn('⚠️  No se pudo enviar email:', e.message) }

      console.log(`✅ CFDI timbrado: ${invoice.uuid} | ${venta.folio} | ${rfcUpper}`)
      return res.json({
        success: true, timbrado: true,
        mensaje: `Tu factura fue emitida exitosamente. Te enviaremos el XML y PDF a ${emailsEnvio.join(', ')}.`,
        uuid: invoice.uuid, facturaId: factura.id
      })

    } catch (fpErr) {
      console.error('❌ Error Facturapi (solicitarFactura):', fpErr.message)

      if (selladoOk) {
        // Selló pero falló el guardado local → NO liberar el flag; queda para reconciliación.
        await prisma.facturaCfdi.update({
          where: { id: factura.id },
          data: {
            folioFiscal: invoice?.uuid ?? undefined,
            facturapiId: invoice?.id ?? undefined,
            ultimoErrorTimbrado: ('Sellado OK, falló persistencia local: ' + (fpErr.message || '')).slice(0, 500)
          }
        }).catch(() => {})
        return res.status(202).json({
          success: true, timbrado: false, requiereRevision: true,
          mensaje: `Tu factura se está procesando. Te la enviaremos a ${emailTrimmed} en breve.`,
          facturaId: factura.id
        })
      }

      const tipo = clasificarErrorTimbrado(fpErr)
      if (tipo === 'VALIDACION') {
        // No se selló → queda PENDIENTE, se libera el flag; la venta sigue bloqueada
        // (PENDIENTE_TIMBRADO + procesoFacturaId) para corrección/reintento manual.
        await prisma.facturaCfdi.update({
          where: { id: factura.id },
          data: { procesandoTimbrado: false, procesandoTimbradoEn: null, ultimoErrorTimbrado: (fpErr.message || '').slice(0, 500) }
        }).catch(() => {})
        return res.status(202).json({
          success: true, timbrado: false,
          mensaje: `Solicitud recibida. Hubo un problema al timbrar — procesaremos tu factura manualmente y te la enviaremos a ${emailTrimmed} a la brevedad.`,
          error_tecnico: fpErr.message, facturaId: factura.id
        })
      }

      // INCIERTO → NO liberar el flag (procesandoTimbrado sigue true) → revisión manual.
      await prisma.facturaCfdi.update({
        where: { id: factura.id },
        data: { ultimoErrorTimbrado: (fpErr.message || '').slice(0, 500) }
      }).catch(() => {})
      return res.status(202).json({
        success: true, timbrado: false, requiereRevision: true,
        mensaje: `Solicitud recibida. Estamos verificando el timbrado y te enviaremos la factura a ${emailTrimmed}.`,
        facturaId: factura.id
      })
    }

  } catch (err) {
    console.error('❌ Error solicitarFactura:', err)
    // Portal público: 500 fijo intencional.
    res.status(500).json({ error: 'Error al procesar la solicitud: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturas/:id/timbrar — timbrar manualmente una PENDIENTE
// ════════════════════════════════════════════════════════════════════
exports.timbrarManual = async (req, res) => {
  try {
    const scope = resolverEmpresaScope(req)
    const whereScope = scope.modo === 'GLOBAL' ? {} : { empresaId: scope.empresaId }

    const id = parseInt(req.params.id)
    const factura = await prisma.facturaCfdi.findFirst({ where: { id, ...whereScope } })

    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.estado !== 'PENDIENTE_TIMBRADO') return res.status(400).json({ error: `Estado actual: ${factura.estado}. Solo PENDIENTE_TIMBRADO.` })

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada. Agrega FACTURAPI_KEY al .env' })

    // ── CAS local: tomar el lock de timbrado (anti doble-clic concurrente) ──
    // updateMany con where restrictivo es atómico: solo un request gana.
    const lock = await prisma.facturaCfdi.updateMany({
      where: { id, ...whereScope, estado: 'PENDIENTE_TIMBRADO', procesandoTimbrado: false },
      data: { procesandoTimbrado: true, procesandoTimbradoEn: new Date(), ultimoErrorTimbrado: null }
    })
    if (lock.count !== 1) {
      return res.status(409).json({ error: 'La factura ya se está timbrando o quedó marcada para revisión manual de un intento previo.' })
    }

    let invoice = null
    let selladoOk = false
    try {
      // ── Correcciones opcionales del body ──
      const {
        rfc:           nuevoRfc,
        razonSocial:   nuevaRazonSocial,
        regimenFiscal: nuevoRegimen,
        codigoPostal:  nuevoCp,
        usoCfdi:       nuevoUso,
        email:         nuevoEmail,
        emailSecundario1: nuevoEmailSec1,
        emailSecundario2: nuevoEmailSec2
      } = req.body || {}

      if (nuevaRazonSocial?.trim()) {
        const errorRazon = validarRazonSocialSat(nuevaRazonSocial)
        if (errorRazon) return res.status(400).json({ error: errorRazon })
      }

      const updates = {}
      if (nuevoRfc?.trim())          updates.rfcReceptor    = nuevoRfc.trim().toUpperCase()
      if (nuevaRazonSocial?.trim())  updates.nombreReceptor = nuevaRazonSocial.trim()
      if (nuevoRegimen)              updates.regimenFiscal  = nuevoRegimen
      if (nuevoCp?.trim())           updates.cpReceptor     = nuevoCp.trim()
      if (nuevoUso)                  updates.usoCfdi        = nuevoUso
      if (nuevoEmail?.trim())        updates.emailReceptor  = nuevoEmail.trim()
      if (nuevoEmailSec1 !== undefined) updates.emailSecundario1 = nuevoEmailSec1?.trim() || null
      if (nuevoEmailSec2 !== undefined) updates.emailSecundario2 = nuevoEmailSec2?.trim() || null
      const huboCorrecciones = Object.keys(updates).length > 0

      // idempotency_key: reusa por timeout; nueva revisión (-r2...) si hay correcciones.
      // NOTA: una pendiente legacy (idempotencyKey NULL) pudo haberse sellado SIN key
      // en un timeout viejo; no es reconciliable por key. Hoy hay 0 de estas, pero el
      // endurecimiento (exigir confirmación explícita) queda pendiente.
      const nuevaKey = calcularIdempotencyKey(factura.id, factura.idempotencyKey, huboCorrecciones)
      if (nuevaKey !== factura.idempotencyKey) updates.idempotencyKey = nuevaKey

      if (Object.keys(updates).length > 0) {
        await prisma.facturaCfdi.update({ where: { id, ...whereScope }, data: updates })
        if (huboCorrecciones) console.log(`📝 Factura ${id}: datos corregidos antes de timbrar`)
      }

      // Releer factura (ya con correcciones / key definitiva)
      const f = await prisma.facturaCfdi.findFirst({ where: { id, ...whereScope } })

      // ── Resolver venta(s) vía FacturaVenta (+ fallback legacy) ──
      const ventaIds = await obtenerVentaIdsDeFactura(f.id, f.ventaId)
      if (ventaIds.length === 0) {
        await prisma.facturaCfdi.update({ where: { id, ...whereScope }, data: { procesandoTimbrado: false, procesandoTimbradoEn: null } }).catch(() => {})
        return res.status(409).json({ error: 'La factura no tiene ventas asociadas.' })
      }
      if (ventaIds.length > 1) {
        // Fase 2 = individual. El retimbrado de conjunta llega en Fase 3 (service).
        await prisma.facturaCfdi.update({ where: { id, ...whereScope }, data: { procesandoTimbrado: false, procesandoTimbradoEn: null } }).catch(() => {})
        return res.status(400).json({ error: 'Retimbrado de factura conjunta no disponible en esta fase.' })
      }

      const venta = await prisma.venta.findUnique({
        where: { id: ventaIds[0] },
        include: { DetalleVenta: { include: { Producto: true } } }
      })
      if (!venta) {
        await prisma.facturaCfdi.update({ where: { id, ...whereScope }, data: { procesandoTimbrado: false, procesandoTimbradoEn: null } }).catch(() => {})
        return res.status(409).json({ error: 'La venta asociada no existe.' })
      }

      // Pre-check de servicio: rechazar antes de llamar a Facturapi y liberar el
      // lock, dejando la factura PENDIENTE para corrección (patrón de L676/L690).
      const servMalo = primerServicioInvalido(venta.DetalleVenta)
      if (servMalo) {
        await prisma.facturaCfdi.update({ where: { id, ...whereScope }, data: { procesandoTimbrado: false, procesandoTimbradoEn: null } }).catch(() => {})
        return res.status(400).json({ error: `Servicio "${servMalo}" sin clave SAT de 8 dígitos. Corrige el producto antes de timbrar.` })
      }

      // ── Timbrar con idempotency_key ──
      const datosEmisor = resolverDatosEmisor(scope.empresaId)
      invoice = await fp.invoices.create({
        ...buildInvoicePayload({
          rfc: f.rfcReceptor, razonSocial: f.nombreReceptor, regimenFiscal: f.regimenFiscal,
          codigoPostal: f.cpReceptor, usoCfdi: f.usoCfdi, email: f.emailReceptor,
          metodoPago: venta.metodoPago, detalles: venta.DetalleVenta, datosEmisor
        }),
        idempotency_key: f.idempotencyKey
      })
      selladoOk = true

      // ── Éxito ──
      const [actualizada] = await prisma.$transaction([
        prisma.facturaCfdi.update({
          where: { id, ...whereScope },
          data: {
            folioFiscal: invoice.uuid, facturapiId: invoice.id,
            estado: 'TIMBRADA', timbradaEn: new Date(),
            procesandoTimbrado: false, procesandoTimbradoEn: null, ultimoErrorTimbrado: null
          }
        }),
        prisma.venta.update({
          where: { id: venta.id },
          data: { facturaEstado: 'FACTURADA', procesoFacturaId: null }
        })
      ])

      const emailsManual = [f.emailReceptor, f.emailSecundario1, f.emailSecundario2].filter(Boolean)
      try { await fp.invoices.sendByEmail(invoice.id, { email: emailsManual }) } catch (e) { console.warn('⚠️  No se pudo enviar email:', e.message) }

      console.log(`✅ Timbrado manual: ${invoice.uuid} | factura ${id}`)
      return res.json({ success: true, uuid: invoice.uuid, data: actualizada, cfdi: invoice })

    } catch (fpErr) {
      console.error('❌ Error timbrarManual:', fpErr.message)

      if (selladoOk) {
        // Selló pero falló el guardado local → NO liberar el lock; revisión manual.
        await prisma.facturaCfdi.update({
          where: { id, ...whereScope },
          data: {
            folioFiscal: invoice?.uuid ?? undefined,
            facturapiId: invoice?.id ?? undefined,
            ultimoErrorTimbrado: ('Sellado OK, falló persistencia local: ' + (fpErr.message || '')).slice(0, 500)
          }
        }).catch(() => {})
        return res.status(502).json({
          error: 'El CFDI se selló pero falló el guardado local. Quedó marcada para revisión; verifícala en Facturapi antes de reintentar.',
          requiereRevision: true
        })
      }

      const tipo = clasificarErrorTimbrado(fpErr)
      if (tipo === 'VALIDACION') {
        // No se selló → liberar lock; queda PENDIENTE para corregir y reintentar.
        await prisma.facturaCfdi.update({
          where: { id, ...whereScope },
          data: { procesandoTimbrado: false, procesandoTimbradoEn: null, ultimoErrorTimbrado: (fpErr.message || '').slice(0, 500) }
        }).catch(() => {})
        return res.status(422).json({ error: 'Error de validación al timbrar: ' + fpErr.message, requiereCorreccion: true })
      }

      // INCIERTO → NO liberar lock (procesandoTimbrado sigue true) → revisión manual.
      await prisma.facturaCfdi.update({
        where: { id, ...whereScope },
        data: { ultimoErrorTimbrado: (fpErr.message || '').slice(0, 500) }
      }).catch(() => {})
      return res.status(502).json({
        error: 'Resultado de timbrado desconocido. La factura quedó marcada para revisión manual; no reintentes hasta verificar en Facturapi.',
        requiereRevision: true
      })
    }

  } catch (err) {
    console.error('❌ Error timbrarManual (externo):', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: 'Error al timbrar: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /facturas/:id/descargar/pdf — proxy para descargar PDF
// ════════════════════════════════════════════════════════════════════
exports.descargarPdf = async (req, res) => {
  try {
    const scope = resolverEmpresaScope(req)
    const whereScope = scope.modo === 'GLOBAL' ? {} : { empresaId: scope.empresaId }

    const factura = await prisma.facturaCfdi.findFirst({
      where: { id: parseInt(req.params.id), ...whereScope }
    })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (!factura.facturapiId) return res.status(400).json({ error: 'Factura sin ID de Facturapi — no se puede descargar' })

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada' })

    const stream = await fp.invoices.downloadPdf(factura.facturapiId)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="factura_${factura.folioFiscal || factura.id}.pdf"`)
    stream.pipe(res)
  } catch (err) {
    console.error('❌ Error descargar PDF:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: 'Error al descargar PDF: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /facturas/:id/descargar/xml — proxy para descargar XML
// ════════════════════════════════════════════════════════════════════
exports.descargarXml = async (req, res) => {
  try {
    const scope = resolverEmpresaScope(req)
    const whereScope = scope.modo === 'GLOBAL' ? {} : { empresaId: scope.empresaId }

    const factura = await prisma.facturaCfdi.findFirst({
      where: { id: parseInt(req.params.id), ...whereScope }
    })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (!factura.facturapiId) return res.status(400).json({ error: 'Factura sin ID de Facturapi' })

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada' })

    const stream = await fp.invoices.downloadXml(factura.facturapiId)
    res.setHeader('Content-Type', 'application/xml')
    res.setHeader('Content-Disposition', `attachment; filename="factura_${factura.folioFiscal || factura.id}.xml"`)
    stream.pipe(res)
  } catch (err) {
    console.error('❌ Error descargar XML:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: 'Error al descargar XML: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturas/:id/enviar-email — reenviar email con PDF+XML
// ════════════════════════════════════════════════════════════════════
exports.enviarEmail = async (req, res) => {
  try {
    const scope = resolverEmpresaScope(req)
    const whereScope = scope.modo === 'GLOBAL' ? {} : { empresaId: scope.empresaId }

    const factura = await prisma.facturaCfdi.findFirst({
      where: { id: parseInt(req.params.id), ...whereScope }
    })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (!factura.facturapiId) return res.status(400).json({ error: 'Factura sin ID de Facturapi' })

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada' })

    const emailsReenvio = [factura.emailReceptor, factura.emailSecundario1, factura.emailSecundario2].filter(Boolean)
    await fp.invoices.sendByEmail(factura.facturapiId, { email: emailsReenvio })
    console.log(`📧 Email reenviado: factura ${factura.id} → ${emailsReenvio.join(', ')}`)
    res.json({ success: true, mensaje: `Email enviado a ${emailsReenvio.join(', ')}` })
  } catch (err) {
    console.error('❌ Error enviar email:', err)
    res.status(err.expose ? (err.status || 500) : 500).json({ error: 'Error al enviar email: ' + err.message })
  }
}