// ════════════════════════════════════════════════════════════════════
//  FACTURACION.CONTROLLER.JS
//  src/modules/facturacion/facturacion.controller.js
//  Fase 2 — Formulario público de solicitud de factura
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// ── Catálogos SAT fijos ──
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
//  GET /facturar?token=XXX  — Página pública (no requiere auth)
//  Devuelve datos de la venta para el formulario
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
            id: true, nombre: true, rfc: true,
            razonSocial: true, regimenFiscal: true,
            codigoPostalFiscal: true, usoCfdi: true, email: true
          }
        },
        detalles: {
          include: { producto: { select: { nombre: true } } }
        },
        factura: true
      }
    })

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada. Verifica el QR.' })

    // ── Validaciones fiscales ──
    const ahora = new Date()
    const fechaVenta = new Date(venta.creadaEn || venta.fecha)
    const horas = (ahora - fechaVenta) / (1000 * 60 * 60)

    // Ya facturada
    if (venta.factura) {
      return res.status(409).json({
        error: 'Esta venta ya fue facturada.',
        uuid: venta.factura.uuid || null
      })
    }

    // Estado de la venta
    if (venta.estado === 'CANCELADA') {
      return res.status(400).json({ error: 'Esta venta fue cancelada y no puede facturarse.' })
    }

    // Más de 72 horas (solo clientes — admin puede igual)
    const esFueraDePlayzo = horas > 72
    if (esFueraDePlayzo) {
      return res.status(400).json({
        error: `El plazo para solicitar factura venció. Solo tienes 72 horas desde la compra (${Math.floor(horas)}h transcurridas).`
      })
    }

    // Límite $2,000 en efectivo
    if (venta.metodoPago === 'EFECTIVO' && parseFloat(venta.total) > 2000) {
      return res.status(400).json({
        error: `Las ventas en efectivo mayores a $2,000 no pueden facturarse (total: $${parseFloat(venta.total).toFixed(2)}).`
      })
    }

    // ── Respuesta con datos de la venta ──
    res.json({
      success: true,
      venta: {
        id:         venta.id,
        folio:      venta.folio,
        fecha:      fechaVenta,
        total:      parseFloat(venta.total),
        metodoPago: venta.metodoPago,
        horasTranscurridas: Math.floor(horas),
        productos:  venta.detalles.map(d => ({
          nombre:    d.producto?.nombre || '—',
          cantidad:  d.cantidad,
          precio:    parseFloat(d.precioUnitario),
          subtotal:  parseFloat(d.subtotal || (d.precioUnitario * d.cantidad))
        }))
      },
      // Datos del cliente registrado para autocompletar
      clienteDatos: venta.cliente ? {
        rfc:              venta.cliente.rfc        || '',
        razonSocial:      venta.cliente.razonSocial || venta.cliente.nombre || '',
        regimenFiscal:    venta.cliente.regimenFiscal || '',
        codigoPostal:     venta.cliente.codigoPostalFiscal || '',
        usoCfdi:          venta.cliente.usoCfdi    || 'G03',
        email:            venta.cliente.email      || '',
      } : null,
      catalogos: { regimenes: REGIMENES_FISCALES, usosCfdi: USOS_CFDI }
    })

  } catch (err) {
    console.error('❌ Error obtenerVentaPorToken:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /facturar  — Guardar solicitud de factura
// ════════════════════════════════════════════════════════════════════

exports.solicitarFactura = async (req, res) => {
  try {
    const {
      token, rfc, razonSocial, regimenFiscal,
      codigoPostal, usoCfdi, email
    } = req.body

    // Validaciones básicas
    if (!token)        return res.status(400).json({ error: 'Token requerido' })
    if (!rfc)          return res.status(400).json({ error: 'RFC requerido' })
    if (!razonSocial)  return res.status(400).json({ error: 'Nombre o razón social requerida' })
    if (!regimenFiscal) return res.status(400).json({ error: 'Régimen fiscal requerido' })
    if (!codigoPostal)  return res.status(400).json({ error: 'Código postal fiscal requerido' })
    if (!usoCfdi)       return res.status(400).json({ error: 'Uso CFDI requerido' })
    if (!email)         return res.status(400).json({ error: 'Email requerido' })

    // Validar formato RFC
    const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i
    if (!rfcRegex.test(rfc.trim())) {
      return res.status(400).json({ error: 'RFC inválido. Verifica el formato.' })
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Email inválido.' })
    }

    // Buscar venta
    const venta = await prisma.venta.findFirst({
      where: { tokenQr: token },
      include: { factura: true }
    })

    if (!venta)        return res.status(404).json({ error: 'Venta no encontrada' })
    if (venta.factura) return res.status(409).json({ error: 'Esta venta ya fue facturada.' })
    if (venta.estado === 'CANCELADA') return res.status(400).json({ error: 'Venta cancelada.' })

    // Validar 72 horas
    const horas = (new Date() - new Date(venta.creadaEn)) / (1000 * 60 * 60)
    if (horas > 72) return res.status(400).json({ error: 'Plazo de 72 horas vencido.' })

    // Validar $2,000 efectivo
    if (venta.metodoPago === 'EFECTIVO' && parseFloat(venta.total) > 2000) {
      return res.status(400).json({ error: 'Ventas en efectivo mayores a $2,000 no facturables.' })
    }

    // Calcular subtotal e IVA (precios incluyen IVA)
    const total    = parseFloat(venta.total)
    const subtotal = parseFloat((total / 1.16).toFixed(2))
    const iva      = parseFloat((total - subtotal).toFixed(2))

    // Guardar factura como PENDIENTE_TIMBRADO
    const factura = await prisma.facturaCfdi.create({
      data: {
        ventaId:       venta.id,
        rfcReceptor:   rfc.trim().toUpperCase(),
        nombreReceptor: razonSocial.trim(),
        regimenReceptor: regimenFiscal,
        cpReceptor:    codigoPostal.trim(),
        usoCfdi:       usoCfdi,
        emailReceptor: email.trim().toLowerCase(),
        subtotal,
        iva,
        total,
        estado:        'PENDIENTE_TIMBRADO',
        // Datos del emisor fijos de JESHA
        rfcEmisor:     'VADJ820305197',
        nombreEmisor:  'JORGE ARMANDO VALDEZ DELGADO',
        regimenEmisor: '612',
        cpEmisor:      '98660',
      }
    })

    console.log(`✅ Factura PENDIENTE creada: ${factura.id} | venta ${venta.folio} | ${rfc}`)

    res.json({
      success: true,
      mensaje: 'Solicitud de factura recibida correctamente. Te enviaremos la factura a ' + email + ' cuando sea procesada.',
      facturaId: factura.id
    })

  } catch (err) {
    console.error('❌ Error solicitarFactura:', err)
    res.status(500).json({ error: 'Error al procesar la solicitud: ' + err.message })
  }
}