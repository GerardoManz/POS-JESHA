// ════════════════════════════════════════════════════════════════════
//  FACTURACION.CONTROLLER.JS
//  src/modules/facturacion/facturacion.controller.js
//  Rutas públicas — sin requireAuth (portal de autofactura)
//  + función de timbrado interno via Facturapi
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

const TASA_IVA   = parseFloat(process.env.TASA_IVA || '0.16')
const IVA_FACTOR = 1 + TASA_IVA

let facturapi = null
function getFacturapi() {
  if (facturapi) return facturapi
  const key = process.env.FACTURAPI_KEY
  if (!key) {
    console.warn('⚠️  FACTURAPI_KEY no configurada — timbrado desactivado')
    return null
  }
  const Facturapi = require('facturapi').default
  facturapi = new Facturapi(key)
  return facturapi
}

const FORMA_PAGO_SAT = {
  EFECTIVO:      '01',
  DEBITO:        '28',
  CREDITO:       '04',
  TRANSFERENCIA: '03'
}

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
// ════════════════════════════════════════════════════════════════════
const RFC_PUBLICO_GENERAL = 'XAXX010101000'

function esRfcGenerico(rfc) {
  return rfc && rfc.trim().toUpperCase() === RFC_PUBLICO_GENERAL
}

// ════════════════════════════════════════════════════════════════════
//  Construir objeto de invoice para Facturapi (DRY)
//  Usado tanto en solicitarFactura como en timbrarManual
// ════════════════════════════════════════════════════════════════════
function buildInvoicePayload({ rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdi, email, metodoPago, detalles }) {
  const rfcUpper = rfc.trim().toUpperCase()

  const items = detalles.map(d => {
    let productKey = '31161500'
    if (d.producto?.claveSat && /^\d{8}$/.test(d.producto.claveSat)) {
      productKey = d.producto.claveSat
    }
    return {
      quantity: parseFloat(d.cantidad),
      product: {
        description:  d.producto?.nombre || 'Mercancía',
        product_key:  productKey,
        unit_key:     d.producto?.unidadSat || 'H87',
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
    codigoPostal  = process.env.JESHA_CP_EMISOR || '98660'
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

const REGIMENES_FISCALES = [
  { clave: '601', descripcion: 'General de Ley Personas Morales' },
  { clave: '603', descripcion: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', descripcion: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { clave: '606', descripcion: 'Arrendamiento' },
  { clave: '607', descripcion: 'Régimen de Enajenación o Adquisición de Bienes' },
  { clave: '608', descripcion: 'Demás Ingresos' },
  { clave: '610', descripcion: 'Residentes en el Extranjero sin Establecimiento Permanente en México' },
  { clave: '611', descripcion: 'Ingresos por Dividendos (socios y accionistas)' },
  { clave: '612', descripcion: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '614', descripcion: 'Ingresos por intereses' },
  { clave: '615', descripcion: 'Régimen de los ingresos por obtención de premios' },
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
  { clave: 'CN01', descripcion: 'Nómina' },
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
        cliente: {
          select: {
            id: true, nombre: true, rfc: true, razonSocial: true,
            regimenFiscal: true, codigoPostalFiscal: true, usoCfdi: true, email: true
          }
        },
        detalles: { include: { producto: { select: { nombre: true } } } },
        factura:  true
      }
    })

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada. Verifica el QR.' })

    const ahora      = new Date()
    const fechaVenta  = new Date(venta.creadaEn)
    const horas      = (ahora - fechaVenta) / (1000 * 60 * 60)

    if (venta.factura) return res.status(409).json({ error: 'Esta venta ya fue facturada.', uuid: venta.factura.folioFiscal || null })
    if (venta.estado === 'CANCELADA') return res.status(400).json({ error: 'Esta venta fue cancelada y no puede facturarse.' })
    if (venta.facturaEstado === 'BLOQUEADA') return res.status(400).json({ error: 'Esta venta no puede facturarse en línea (efectivo mayor a $2,000). Solicita tu factura directamente en sucursal.' })
    if (venta.facturaEstado === 'VENCIDA' || ahora > new Date(venta.facturaLimite)) return res.status(400).json({ error: 'El plazo para solicitar factura venció. Contacta a la sucursal si necesitas ayuda.' })

    res.json({
      success: true,
      venta: {
        id: venta.id, folio: venta.folio, fecha: fechaVenta,
        total: parseFloat(venta.total), metodoPago: venta.metodoPago,
        horasTranscurridas: Math.floor(horas),
        productos: venta.detalles.map(d => ({
          nombre: d.producto?.nombre || '—', cantidad: d.cantidad,
          precio: parseFloat(d.precioUnitario),
          subtotal: parseFloat(d.subtotal || (d.precioUnitario * d.cantidad))
        }))
      },
      clienteDatos: venta.cliente ? {
        rfc: venta.cliente.rfc || '', razonSocial: venta.cliente.razonSocial || venta.cliente.nombre || '',
        regimenFiscal: venta.cliente.regimenFiscal || '', codigoPostal: venta.cliente.codigoPostalFiscal || '',
        usoCfdi: venta.cliente.usoCfdi || 'G03', email: venta.cliente.email || '',
      } : null,
      catalogos: { regimenes: REGIMENES_FISCALES, usosCfdi: USOS_CFDI }
    })
  } catch (err) {
    console.error('❌ Error obtenerVentaPorToken:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturar/api — solicitar + timbrar
// ════════════════════════════════════════════════════════════════════
exports.solicitarFactura = async (req, res) => {
  try {
    const { token, rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdi, email } = req.body

    if (!token)         return res.status(400).json({ error: 'Token requerido' })
    if (!rfc)           return res.status(400).json({ error: 'RFC requerido' })
    if (!razonSocial)   return res.status(400).json({ error: 'Nombre o razón social requerida' })
    if (!regimenFiscal) return res.status(400).json({ error: 'Régimen fiscal requerido' })
    if (!codigoPostal)  return res.status(400).json({ error: 'Código postal fiscal requerido' })
    if (!usoCfdi)       return res.status(400).json({ error: 'Uso CFDI requerido' })
    if (!email)         return res.status(400).json({ error: 'Email requerido' })

    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(rfc.trim())) return res.status(400).json({ error: 'RFC inválido.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Email inválido.' })

    const venta = await prisma.venta.findFirst({
      where: { tokenQr: token },
      include: { factura: true, detalles: { include: { producto: true } } }
    })

    if (!venta)        return res.status(404).json({ error: 'Venta no encontrada' })
    if (venta.factura) return res.status(409).json({ error: 'Esta venta ya fue facturada.' })
    if (venta.estado === 'CANCELADA') return res.status(400).json({ error: 'Venta cancelada.' })
    if (venta.facturaEstado === 'BLOQUEADA') return res.status(400).json({ error: 'Venta no facturable en línea.' })
    if (new Date() > new Date(venta.facturaLimite)) return res.status(400).json({ error: 'Plazo de facturación vencido.' })

    const total        = parseFloat(venta.total)
    const subtotal     = parseFloat((total / IVA_FACTOR).toFixed(2))
    const iva          = parseFloat((total - subtotal).toFixed(2))
    const rfcUpper     = rfc.trim().toUpperCase()
    const emailTrimmed = email.trim()

    const fp = getFacturapi()

    if (fp) {
      try {
        // ── Usar helper centralizado que incluye global_information si aplica ──
        const invoicePayload = buildInvoicePayload({
          rfc: rfcUpper,
          razonSocial,
          regimenFiscal,
          codigoPostal,
          usoCfdi,
          email: emailTrimmed,
          metodoPago: venta.metodoPago,
          detalles: venta.detalles
        })

        const invoice = await fp.invoices.create(invoicePayload)

        const factura = await prisma.facturaCfdi.create({
          data: {
            ventaId: venta.id, clienteId: venta.clienteId || null,
            rfcReceptor: rfcUpper, nombreReceptor: razonSocial.trim(),
            cpReceptor: codigoPostal.trim(), regimenFiscal, usoCfdi,
            emailReceptor: emailTrimmed,
            lugarExpedicion: process.env.JESHA_CP_EMISOR || '98660',
            subtotal, iva, total,
            folioFiscal: invoice.uuid,
            facturapiId: invoice.id,
            estado: 'TIMBRADA', timbradaEn: new Date()
          }
        })

        await prisma.venta.update({ where: { id: venta.id }, data: { facturaEstado: 'FACTURADA' } })

        // Enviar email con PDF+XML automáticamente
        try { await fp.invoices.sendByEmail(invoice.id) } catch (e) { console.warn('⚠️  No se pudo enviar email:', e.message) }

        console.log(`✅ CFDI timbrado: ${invoice.uuid} | ${venta.folio} | ${rfcUpper}`)

        return res.json({
          success: true, timbrado: true,
          mensaje: `Tu factura fue emitida exitosamente. Te enviaremos el XML y PDF a ${emailTrimmed}.`,
          uuid: invoice.uuid, facturaId: factura.id
        })

      } catch (fpErr) {
        console.error('❌ Error Facturapi:', fpErr.message)
        await prisma.facturaCfdi.create({
          data: {
            ventaId: venta.id, clienteId: venta.clienteId || null,
            rfcReceptor: rfcUpper, nombreReceptor: razonSocial.trim(),
            cpReceptor: codigoPostal.trim(), regimenFiscal, usoCfdi,
            emailReceptor: emailTrimmed,
            lugarExpedicion: process.env.JESHA_CP_EMISOR || '98660',
            subtotal, iva, total, estado: 'PENDIENTE_TIMBRADO'
          }
        })
        return res.status(202).json({
          success: true, timbrado: false,
          mensaje: `Solicitud recibida. Hubo un problema al timbrar — procesaremos tu factura manualmente y te la enviaremos a ${emailTrimmed} a la brevedad.`,
          error_tecnico: fpErr.message
        })
      }
    }

    // Sin Facturapi configurada
    const factura = await prisma.facturaCfdi.create({
      data: {
        ventaId: venta.id, clienteId: venta.clienteId || null,
        rfcReceptor: rfcUpper, nombreReceptor: razonSocial.trim(),
        cpReceptor: codigoPostal.trim(), regimenFiscal, usoCfdi,
        emailReceptor: emailTrimmed,
        lugarExpedicion: process.env.JESHA_CP_EMISOR || '98660',
        subtotal, iva, total, estado: 'PENDIENTE_TIMBRADO'
      }
    })
    console.log(`📋 Factura PENDIENTE_TIMBRADO creada: ${factura.id} | ${venta.folio} | ${rfcUpper}`)
    res.json({ success: true, timbrado: false, mensaje: `Solicitud de factura recibida. Te enviaremos la factura a ${emailTrimmed} cuando sea procesada.`, facturaId: factura.id })
  } catch (err) {
    console.error('❌ Error solicitarFactura:', err)
    res.status(500).json({ error: 'Error al procesar la solicitud: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturas/:id/timbrar — timbrar manualmente una PENDIENTE
// ════════════════════════════════════════════════════════════════════
exports.timbrarManual = async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const factura = await prisma.facturaCfdi.findUnique({
      where: { id },
      include: { venta: { include: { detalles: { include: { producto: true } } } } }
    })

    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.estado !== 'PENDIENTE_TIMBRADO') return res.status(400).json({ error: `Estado actual: ${factura.estado}. Solo PENDIENTE_TIMBRADO.` })

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada. Agrega FACTURAPI_KEY al .env' })

    const venta = factura.venta

    // ── Usar helper centralizado que incluye global_information si aplica ──
    const invoicePayload = buildInvoicePayload({
      rfc:           factura.rfcReceptor,
      razonSocial:   factura.nombreReceptor,
      regimenFiscal: factura.regimenFiscal,
      codigoPostal:  factura.cpReceptor,
      usoCfdi:       factura.usoCfdi,
      email:         factura.emailReceptor,
      metodoPago:    venta.metodoPago,
      detalles:      venta.detalles
    })

    const invoice = await fp.invoices.create(invoicePayload)

    const actualizada = await prisma.facturaCfdi.update({
      where: { id },
      data: {
        folioFiscal: invoice.uuid, facturapiId: invoice.id,
        estado: 'TIMBRADA', timbradaEn: new Date()
      }
    })
    await prisma.venta.update({ where: { id: venta.id }, data: { facturaEstado: 'FACTURADA' } })

    // Enviar email
    try { await fp.invoices.sendByEmail(invoice.id) } catch (e) { console.warn('⚠️  No se pudo enviar email:', e.message) }

    console.log(`✅ Timbrado manual: ${invoice.uuid} | factura ${id}`)
    res.json({ success: true, uuid: invoice.uuid, data: actualizada })
  } catch (err) {
    console.error('❌ Error timbrarManual:', err)
    res.status(500).json({ error: 'Error al timbrar: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /facturas/:id/descargar/pdf — proxy para descargar PDF
// ════════════════════════════════════════════════════════════════════
exports.descargarPdf = async (req, res) => {
  try {
    const factura = await prisma.facturaCfdi.findUnique({ where: { id: parseInt(req.params.id) } })
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
    res.status(500).json({ error: 'Error al descargar PDF: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /facturas/:id/descargar/xml — proxy para descargar XML
// ════════════════════════════════════════════════════════════════════
exports.descargarXml = async (req, res) => {
  try {
    const factura = await prisma.facturaCfdi.findUnique({ where: { id: parseInt(req.params.id) } })
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
    res.status(500).json({ error: 'Error al descargar XML: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturas/:id/enviar-email — reenviar email con PDF+XML
// ════════════════════════════════════════════════════════════════════
exports.enviarEmail = async (req, res) => {
  try {
    const factura = await prisma.facturaCfdi.findUnique({ where: { id: parseInt(req.params.id) } })
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (!factura.facturapiId) return res.status(400).json({ error: 'Factura sin ID de Facturapi' })

    const fp = getFacturapi()
    if (!fp) return res.status(503).json({ error: 'Facturapi no configurada' })

    await fp.invoices.sendByEmail(factura.facturapiId)
    console.log(`📧 Email reenviado: factura ${factura.id} → ${factura.emailReceptor}`)
    res.json({ success: true, mensaje: `Email enviado a ${factura.emailReceptor || 'el correo registrado'}` })
  } catch (err) {
    console.error('❌ Error enviar email:', err)
    res.status(500).json({ error: 'Error al enviar email: ' + err.message })
  }
}