// ════════════════════════════════════════════════════════════════════
//  FACTURACION.CONTROLLER.JS
//  src/modules/facturacion/facturacion.controller.js
//  Rutas públicas — sin requireAuth (portal de autofactura)
//  + función de timbrado interno via Facturapi
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// ── Facturapi — se inicializa solo si la key está configurada ────────
let facturapi = null
function getFacturapi() {
  if (facturapi) return facturapi
  const key = process.env.FACTURAPI_KEY
  if (!key) {
    console.warn('⚠️  FACTURAPI_KEY no configurada — timbrado desactivado')
    return null
  }
  const Facturapi = require('facturapi')

// Tasa IVA — configurable vía .env (TASA_IVA=0.16)
const TASA_IVA   = parseFloat(process.env.TASA_IVA || '0.16')
const IVA_FACTOR = 1 + TASA_IVA
  facturapi = new Facturapi(key)
  return facturapi
}

// ── Mapeo método de pago JESHA → clave SAT ──────────────────────────
const FORMA_PAGO_SAT = {
  EFECTIVO:      '01',
  DEBITO:        '28',
  CREDITO:       '04',
  TRANSFERENCIA: '03'
}

// ── Catálogos SAT ────────────────────────────────────────────────────
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
//  GET /facturar/api?token=XXX — datos de la venta para el formulario
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

    const ahora     = new Date()
    const fechaVenta = new Date(venta.creadaEn)
    const horas     = (ahora - fechaVenta) / (1000 * 60 * 60)

    if (venta.factura) {
      return res.status(409).json({ error: 'Esta venta ya fue facturada.', uuid: venta.factura.folioFiscal || null })
    }
    if (venta.estado === 'CANCELADA') {
      return res.status(400).json({ error: 'Esta venta fue cancelada y no puede facturarse.' })
    }
    if (horas > 72) {
      return res.status(400).json({
        error: `El plazo para solicitar factura venció. Solo tienes 72 horas desde la compra (${Math.floor(horas)}h transcurridas).`
      })
    }
    if (venta.metodoPago === 'EFECTIVO' && parseFloat(venta.total) > 2000) {
      return res.status(400).json({
        error: `Las ventas en efectivo mayores a $2,000 no pueden facturarse (total: $${parseFloat(venta.total).toFixed(2)}).`
      })
    }

    res.json({
      success: true,
      venta: {
        id:          venta.id,
        folio:       venta.folio,
        fecha:       fechaVenta,
        total:       parseFloat(venta.total),
        metodoPago:  venta.metodoPago,
        horasTranscurridas: Math.floor(horas),
        productos:   venta.detalles.map(d => ({
          nombre:    d.producto?.nombre || '—',
          cantidad:  d.cantidad,
          precio:    parseFloat(d.precioUnitario),
          subtotal:  parseFloat(d.subtotal || (d.precioUnitario * d.cantidad))
        }))
      },
      clienteDatos: venta.cliente ? {
        rfc:          venta.cliente.rfc || '',
        razonSocial:  venta.cliente.razonSocial || venta.cliente.nombre || '',
        regimenFiscal: venta.cliente.regimenFiscal || '',
        codigoPostal: venta.cliente.codigoPostalFiscal || '',
        usoCfdi:      venta.cliente.usoCfdi || 'G03',
        email:        venta.cliente.email || '',
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
//  Si Facturapi está configurada: timbra en el momento
//  Si no: guarda como PENDIENTE_TIMBRADO para procesar después
// ════════════════════════════════════════════════════════════════════
exports.solicitarFactura = async (req, res) => {
  try {
    const { token, rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdi, email } = req.body

    // ── Validaciones ──────────────────────────────────────────────
    if (!token)        return res.status(400).json({ error: 'Token requerido' })
    if (!rfc)          return res.status(400).json({ error: 'RFC requerido' })
    if (!razonSocial)  return res.status(400).json({ error: 'Nombre o razón social requerida' })
    if (!regimenFiscal) return res.status(400).json({ error: 'Régimen fiscal requerido' })
    if (!codigoPostal) return res.status(400).json({ error: 'Código postal fiscal requerido' })
    if (!usoCfdi)      return res.status(400).json({ error: 'Uso CFDI requerido' })
    if (!email)        return res.status(400).json({ error: 'Email requerido' })

    const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i
    if (!rfcRegex.test(rfc.trim())) {
      return res.status(400).json({ error: 'RFC inválido. Verifica el formato.' })
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Email inválido.' })
    }

    // ── Cargar venta ──────────────────────────────────────────────
    const venta = await prisma.venta.findFirst({
      where:   { tokenQr: token },
      include: {
        factura:  true,
        detalles: { include: { producto: true } }
      }
    })

    if (!venta)          return res.status(404).json({ error: 'Venta no encontrada' })
    if (venta.factura)   return res.status(409).json({ error: 'Esta venta ya fue facturada.' })
    if (venta.estado === 'CANCELADA') return res.status(400).json({ error: 'Venta cancelada.' })

    const horas = (new Date() - new Date(venta.creadaEn)) / (1000 * 60 * 60)
    if (horas > 72) return res.status(400).json({ error: 'Plazo de 72 horas vencido.' })
    if (venta.metodoPago === 'EFECTIVO' && parseFloat(venta.total) > 2000) {
      return res.status(400).json({ error: 'Ventas en efectivo mayores a $2,000 no facturables.' })
    }

    const total    = parseFloat(venta.total)
    const subtotal = parseFloat((total / IVA_FACTOR).toFixed(2))
    const iva      = parseFloat((total - subtotal).toFixed(2))
    const rfcUpper = rfc.trim().toUpperCase()

    // ── Intentar timbrado inmediato si Facturapi está configurada ──
    const fp = getFacturapi()

    if (fp) {
      try {
        // Armar conceptos desde los detalles de la venta
        const items = venta.detalles.map(d => ({
          quantity:     d.cantidad,
          product: {
            description:   d.producto?.nombre || 'Mercancía',
            // Usar clave SAT del producto si existe, sino clave genérica ferretería
            product_key:   d.producto?.claveSat || '31161500',
            unit_key:      d.producto?.unidadSat || 'H87',
            price:         parseFloat(d.precioUnitario),
            tax_included:  true,
            taxes: [{ type: 'IVA', rate: TASA_IVA, factor: 'Tasa', withholding: false }]
          }
        }))

        const invoice = await fp.invoices.create({
          customer: {
            legal_name: razonSocial.trim(),
            tax_id:     rfcUpper,
            tax_system: regimenFiscal,
            address:    { zip: codigoPostal.trim() }
          },
          use:          usoCfdi,
          payment_form: FORMA_PAGO_SAT[venta.metodoPago] || '01',
          payment_method: 'PUE',
          items,
          ...(email && { email })
        })

        // Guardar factura timbrada en BD
        const factura = await prisma.facturaCfdi.create({
          data: {
            ventaId:       venta.id,
            clienteId:     venta.clienteId || null,
            rfcReceptor:   rfcUpper,
            nombreReceptor: razonSocial.trim(),
            cpReceptor:    codigoPostal.trim(),
            regimenFiscal,
            usoCfdi,
            lugarExpedicion: process.env.JESHA_CP_EMISOR || '98660',
            subtotal,
            iva,
            total,
            folioFiscal: invoice.uuid,
            xmlUrl:      invoice.xml_url  || null,
            pdfUrl:      invoice.pdf_url  || null,
            estado:      'TIMBRADA',
            timbradaEn:  new Date()
          }
        })

        // Actualizar estado de la venta
        await prisma.venta.update({
          where: { id: venta.id },
          data:  { facturaEstado: 'FACTURADA' }
        })

        console.log(`✅ CFDI timbrado: ${invoice.uuid} | ${venta.folio} | ${rfcUpper}`)

        return res.json({
          success:  true,
          timbrado: true,
          mensaje:  `Tu factura fue emitida exitosamente. Te enviaremos el XML y PDF a ${email}.`,
          uuid:     invoice.uuid,
          facturaId: factura.id
        })

      } catch (fpErr) {
        // Si Facturapi falla, guardar pendiente y avisar
        console.error('❌ Error Facturapi:', fpErr.message)

        await prisma.facturaCfdi.create({
          data: {
            ventaId:       venta.id,
            clienteId:     venta.clienteId || null,
            rfcReceptor:   rfcUpper,
            nombreReceptor: razonSocial.trim(),
            cpReceptor:    codigoPostal.trim(),
            regimenFiscal,
            usoCfdi,
            lugarExpedicion: process.env.JESHA_CP_EMISOR || '98660',
            subtotal,
            iva,
            total,
            estado: 'PENDIENTE_TIMBRADO'
          }
        })

        return res.status(202).json({
          success:  true,
          timbrado: false,
          mensaje:  'Solicitud recibida. Hubo un problema al timbrar en este momento — procesaremos tu factura manualmente y te la enviaremos a ' + email + ' a la brevedad.',
          error_tecnico: fpErr.message
        })
      }
    }

    // ── Sin Facturapi configurada: guardar PENDIENTE ───────────────
    const factura = await prisma.facturaCfdi.create({
      data: {
        ventaId:       venta.id,
        clienteId:     venta.clienteId || null,
        rfcReceptor:   rfcUpper,
        nombreReceptor: razonSocial.trim(),
        cpReceptor:    codigoPostal.trim(),
        regimenFiscal,
        usoCfdi,
        lugarExpedicion: process.env.JESHA_CP_EMISOR || '98660',
        subtotal,
        iva,
        total,
        estado: 'PENDIENTE_TIMBRADO'
      }
    })

    console.log(`📋 Factura PENDIENTE_TIMBRADO creada: ${factura.id} | ${venta.folio} | ${rfcUpper}`)

    res.json({
      success:  true,
      timbrado: false,
      mensaje:  `Solicitud de factura recibida correctamente. Te enviaremos la factura a ${email} cuando sea procesada.`,
      facturaId: factura.id
    })

  } catch (err) {
    console.error('❌ Error solicitarFactura:', err)
    res.status(500).json({ error: 'Error al procesar la solicitud: ' + err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturas/:id/timbrar — timbrar manualmente una PENDIENTE
//  Llamado desde el panel interno de admins
// ════════════════════════════════════════════════════════════════════
exports.timbrarManual = async (req, res) => {
  try {
    const id      = parseInt(req.params.id)
    const factura = await prisma.facturaCfdi.findUnique({
      where:   { id },
      include: { venta: { include: { detalles: { include: { producto: true } } } } }
    })

    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
    if (factura.estado !== 'PENDIENTE_TIMBRADO') {
      return res.status(400).json({ error: `Estado actual: ${factura.estado}. Solo se pueden timbrar facturas PENDIENTE_TIMBRADO.` })
    }

    const fp = getFacturapi()
    if (!fp) {
      return res.status(503).json({ error: 'Facturapi no está configurada. Agrega FACTURAPI_KEY al .env' })
    }

    const venta = factura.venta
    const items = venta.detalles.map(d => ({
      quantity: d.cantidad,
      product: {
        description:  d.producto?.nombre || 'Mercancía',
        product_key:  d.producto?.claveSat || '31161500',
        unit_key:     d.producto?.unidadSat || 'H87',
        price:        parseFloat(d.precioUnitario),
        tax_included: true,
        taxes: [{ type: 'IVA', rate: TASA_IVA, factor: 'Tasa', withholding: false }]
      }
    }))

    const invoice = await fp.invoices.create({
      customer: {
        legal_name: factura.nombreReceptor,
        tax_id:     factura.rfcReceptor,
        tax_system: factura.regimenFiscal,
        address:    { zip: factura.cpReceptor }
      },
      use:            factura.usoCfdi,
      payment_form:   FORMA_PAGO_SAT[venta.metodoPago] || '01',
      payment_method: 'PUE',
      items
    })

    const actualizada = await prisma.facturaCfdi.update({
      where: { id },
      data: {
        folioFiscal: invoice.uuid,
        xmlUrl:      invoice.xml_url  || null,
        pdfUrl:      invoice.pdf_url  || null,
        estado:      'TIMBRADA',
        timbradaEn:  new Date()
      }
    })

    await prisma.venta.update({
      where: { id: venta.id },
      data:  { facturaEstado: 'FACTURADA' }
    })

    console.log(`✅ Timbrado manual: ${invoice.uuid} | factura ${id}`)

    res.json({ success: true, uuid: invoice.uuid, data: actualizada })

  } catch (err) {
    console.error('❌ Error timbrarManual:', err)
    res.status(500).json({ error: 'Error al timbrar: ' + err.message })
  }
}