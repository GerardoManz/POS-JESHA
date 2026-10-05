// ════════════════════════════════════════════════════════════════════
//  BITACORA.CONTROLLER.JS — Soporta dos orígenes:
//    VENTA  — creada automáticamente desde venta a crédito (POS)
//    MANUAL — creada por el cajero para servicios/pedidos externos
//  src/modules/bitacora/bitacora.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const resolverSucursalId = require('../sucursal/sucursal.helper')
const construirWhereScopeTenant = require('../../helpers/construirWhereScopeTenant')
const { buildAbonoSnapshot, buildRetiroSnapshot, formatFechaTicket } = require('../impresion/impresion.snapshot')
const { encolarImpresion } = require('../impresion/impresion.service')
const { normalizarUnidadVenta } = require('../../helpers/unidades.helper')
const { validarMontoDecimal, Decimal } = require('../../helpers/validarMontoDecimal')

function errorNegocio(status, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { status, codigo })
}

function responderError(req, res, err, mensajeGenerico) {
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      success: false,
      error: err.message,
      codigo: err.codigo || null,
      requestId: req.requestId || null
    })
  }

  console.error(`[${req.requestId || 'sin-request-id'}]`, mensajeGenerico, err)
  return res.status(500).json({
    success: false,
    error: mensajeGenerico,
    codigo: 'ERROR_INTERNO',
    requestId: req.requestId || null
  })
}

async function bloquearBitacora(tx, bitacoraId, empresaId) {
  const rows = await tx.$queryRaw`
    SELECT id, "empresaId", "sucursalId", folio, estado, origen,
           "totalMateriales", "totalAbonado", "saldoPendiente", "saldoAlCerrar",
           "descuentoMonto", "clienteId", notas
    FROM "Bitacora"
    WHERE id = ${bitacoraId} AND "empresaId" = ${empresaId}
    FOR UPDATE`
  return rows[0] || null
}

function validarAlcanceSucursal(bitacora, sucursalOperativa) {
  if (!sucursalOperativa) {
    throw errorNegocio(400, 'BRANCH_CONTEXT_REQUIRED', 'Selecciona una sucursal para realizar esta operación')
  }
  if (bitacora.sucursalId !== sucursalOperativa) {
    throw errorNegocio(404, 'BITACORA_NO_ENCONTRADA', 'Bitácora no encontrada')
  }
}

function validarBitacoraManualEditable(bitacora, sucursalOperativa) {
  validarAlcanceSucursal(bitacora, sucursalOperativa)
  if (bitacora.origen !== 'MANUAL') {
    throw errorNegocio(403, 'ORIGEN_INCORRECTO', 'Solo se pueden modificar materiales de bitácoras MANUAL')
  }
  if (bitacora.estado !== 'ABIERTA') {
    throw errorNegocio(409, 'ESTADO_INVALIDO', `No se pueden modificar materiales en estado ${bitacora.estado}`)
  }
}

async function bloquearInventarioOpcional(tx, sucursalId, productoId) {
  const rows = await tx.$queryRaw`
    SELECT "productoId", "sucursalId", "stockActual"
    FROM "InventarioSucursal"
    WHERE "productoId" = ${productoId} AND "sucursalId" = ${sucursalId}
    FOR UPDATE`
  return rows[0] || null
}

// ── Auditoría ──
async function audit(usuarioId, sucursalId, accion, ref, empresaId, valorDespues = null) {
  try {
    const data = { accion, modulo: 'bitacora', referencia: ref, usuarioId, sucursalId }
    if (empresaId) data.empresaId = empresaId
    if (valorDespues !== null) data.valorDespues = valorDespues
    await prisma.auditoria.create({ data })
  }
  catch(e) { console.error('Audit:', e.message) }
}

function parseFechaManual(fechaManual) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaManual || '')) {
    throw new Error('fechaManual debe tener formato YYYY-MM-DD')
  }
  const [year, month, day] = fechaManual.split('-').map(n => parseInt(n, 10))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('fechaManual no es una fecha válida')
  }
  return date
}

function nombreTrabajador(t) {
  if (!t) return '—'
  return t.apodo ? `${t.apodo} (${t.nombre})` : t.nombre
}

function puedeAplicarDescuento(rol) {
  return ['SUPERADMIN', 'ADMIN_SUCURSAL'].includes(rol)
}

function calcularDescuentoGlobal(totalMateriales, descuentoTipo, descuentoValor) {
  const total = parseFloat(totalMateriales || 0)
  const valor = parseFloat(descuentoValor || 0)

  if (!descuentoTipo || valor <= 0) {
    return { descuentoTipo: null, descuentoValor: 0, descuentoMonto: 0 }
  }

  if (descuentoTipo === 'PORCENTAJE') {
    const monto = parseFloat((total * (valor / 100)).toFixed(2))
    return { descuentoTipo, descuentoValor: valor, descuentoMonto: monto }
  }

  const monto = parseFloat(valor.toFixed(2))
  return { descuentoTipo, descuentoValor: valor, descuentoMonto: monto }
}

// ── Generar folio BIT ──
async function generarFolioBitacora(tx) {
  const fecha  = new Date()
  const seq    = await tx.$queryRaw`SELECT nextval('folio_bitacora_seq') as seq`
  const numero = Number(seq[0].seq)
  return `BIT-${fecha.getFullYear()}${String(fecha.getMonth()+1).padStart(2,'0')}${String(fecha.getDate()).padStart(2,'0')}-${String(numero).padStart(5,'0')}`
}

// ── SELECT base de bitácora ──
const BITACORA_SELECT = {
  id: true, folio: true, titulo: true, descripcion: true, origen: true, estado: true,
  totalMateriales: true, totalAbonado: true, saldoPendiente: true, saldoAlCerrar: true,
  descuentoTipo: true, descuentoValor: true, descuentoMonto: true,
  notas: true, creadaEn: true, actualizadoEn: true, cerradaEn: true,
  clienteId: true, sucursalId: true, usuarioId: true,
  Cliente:  { select: { id: true, nombre: true, telefono: true, limiteCredito: true, saldoPendiente: true } },
  Usuario:  { select: { id: true, nombre: true } },
  Sucursal: { select: { id: true, nombre: true } },
  DetalleBitacora: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, cantidad: true, precioUnitario: true, subtotal: true,
      inventarioDescontado: true, notas: true, creadoEn: true,
      fechaManual: true, responsableId: true, retiroBitacoraId: true,
      recibeTrabajadorId: true, recibeNombre: true,
      unidadVentaSnapshot: true, unidadCapturadaSnapshot: true, esGranelSnapshot: true,
      factorConversionSnapshot: true, modoCapturaSnapshot: true,
      cantidadCapturadaSnapshot: true, importeCapturadoSnapshot: true,
      Venta:            { select: { id: true, folio: true, creadaEn: true } },
      Producto:         { select: { id: true, nombre: true, codigoInterno: true, codigoBarras: true, unidadVenta: true } },
      Responsable:      { select: { id: true, nombre: true } },
      RecibeTrabajador: { select: { id: true, nombre: true, apodo: true } }
    }
  },
  RetiroBitacora: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, recibeNombre: true, fechaManual: true, total: true, saldoAnterior: true, saldoDespues: true, creadoEn: true,
      DetalleBitacora: { select: { id: true } }
    }
  },
  AbonoBitacora: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, monto: true, metodoPago: true, notas: true, creadoEn: true,
      Usuario: { select: { id: true, nombre: true } },
      TurnoCaja:   { select: { id: true, abiertaEn: true, cerradaEn: true } }
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras
// ════════════════════════════════════════════════════════════════════
const listar = async (req, res) => {
  try {
    const { estado, clienteId, origen, buscar, page = 1, limit = 25 } = req.query
    const { sucursalId, rol } = req.usuario
    const where = construirWhereScopeTenant(req)
    const empresaId = where.empresaId
    const pageInt  = Math.max(1, parseInt(page) || 1)
    const limitInt = Math.min(100, Math.max(1, parseInt(limit) || 25))

    if (rol !== 'SUPERADMIN' && sucursalId) where.sucursalId = sucursalId
    if (estado) {
      where.estado = estado
    } else {
      // Por defecto: excluir cerradas y canceladas (archivadas)
      where.estado = { notIn: ['CERRADA_VENTA', 'CERRADA_INTERNA', 'CANCELADA'] }
    }
    if (origen)    where.origen    = origen
    if (clienteId && clienteId !== 'null') where.clienteId = parseInt(clienteId)
    if (buscar) {
      const termLimpio = buscar.trim()
      const esNumerico = /^\d+$/.test(termLimpio)
      let ids = []

      if (!esNumerico) {
        try {
          const rawResult = await prisma.$queryRaw`
            SELECT b.id FROM "Bitacora" b
            WHERE b."empresaId" = ${empresaId}
              AND to_tsvector('simple', b.titulo) @@ plainto_tsquery('simple', ${termLimpio})
          `
          ids = rawResult.map(r => r.id)
        } catch { /* fallback a contains */ }
      }

      const productoFilter = {
        empresaId,
        OR: [
          { nombre: { contains: termLimpio, mode: 'insensitive' } },
          { codigoInterno: { contains: termLimpio, mode: 'insensitive' } },
          { codigoBarras: { contains: termLimpio, mode: 'insensitive' } }
        ]
      }

      where.OR = [
        ...(ids.length > 0 ? [{ id: { in: ids } }] : [
          { titulo: { contains: termLimpio, mode: 'insensitive' } }
        ]),
        { folio:   { contains: termLimpio, mode: 'insensitive' } },
        { Cliente: { nombre: { contains: termLimpio, mode: 'insensitive' } } },
        { DetalleBitacora: { some: { Producto: productoFilter } } }
      ]
    }

    const skip = (pageInt - 1) * limitInt
    const [total, bitacoras] = await Promise.all([
      prisma.bitacora.count({ where }),
      prisma.bitacora.findMany({ where, select: BITACORA_SELECT, orderBy: { creadaEn: 'desc' }, skip, take: limitInt })
    ])
    res.json({ success: true, data: bitacoras, total, page: pageInt, limit: limitInt })
  } catch (err) {
    console.error('❌ listar bitacoras:', err)
    res.status(500).json({ success: false, error: 'No fue posible cargar las bitácoras. Intenta nuevamente.' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras/:id
// ════════════════════════════════════════════════════════════════════
const obtener = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const b = await prisma.bitacora.findFirst({
      where: { id: parseInt(req.params.id), empresaId },
      select: BITACORA_SELECT
    })
    if (!b) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    res.json({ success: true, data: b })
  } catch (err) {
    console.error('❌ obtener bitacora:', err)
    res.status(500).json({ success: false, error: 'No fue posible cargar la bitácora. Intenta nuevamente.' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras — Crear bitácora MANUAL
//  Título obligatorio. Cliente opcional. Siempre origen MANUAL.
// ════════════════════════════════════════════════════════════════════
const crear = async (req, res) => {
  try {
    const { titulo, descripcion, clienteId, notas } = req.body
    const { id: usuarioId } = req.usuario
    // P0-BRANCH-ISOLATION: la sucursal operativa viene del contexto, nunca del body ni fallback a 1.
    const sucursalId = resolverSucursalId(req)
    if (!sucursalId) {
      return res.status(400).json({ success: false, error: 'Se requiere contexto de sucursal para crear una bitácora', codigo: 'BRANCH_CONTEXT_REQUIRED' })
    }
    const empresaId = getEmpresaId(req)

    if (!titulo?.trim()) {
      return res.status(400).json({ success: false, error: 'El título del proyecto es obligatorio', codigo: 'TITULO_REQUERIDO' })
    }

    // Si se especifica cliente, validar que existe y pertenece a la empresa
    if (clienteId) {
      const cliente = await prisma.cliente.findFirst({ where: { id: parseInt(clienteId), empresaId }, select: { id: true } })
      if (!cliente) return res.status(404).json({ success: false, error: 'Cliente no existe' })
    }

    const bitacora = await prisma.$transaction(async tx => {
      const folio = await generarFolioBitacora(tx)
      return await tx.bitacora.create({
        data: {
          empresaId,
          folio,
          titulo:         titulo.trim(),
          descripcion:    descripcion?.trim() || null,
          origen:         'MANUAL',
          clienteId:      clienteId ? parseInt(clienteId) : null,
          sucursalId,
          usuarioId,
          estado:         'ABIERTA',
          totalMateriales: 0,
          totalAbonado:    0,
          saldoPendiente:  0,
          descuentoTipo:   null,
          descuentoValor:  0,
          descuentoMonto:  0,
          notas:           notas?.trim() || null,
          actualizadoEn:   new Date()
        },
        select: BITACORA_SELECT
      })
    })

    await audit(usuarioId, sucursalId, 'CREAR_BITACORA_MANUAL', bitacora.folio, empresaId)
    res.status(201).json({ success: true, data: bitacora })
  } catch (err) {
    console.error('❌ crear bitacora:', err)
    res.status(500).json({ success: false, error: 'No fue posible crear la bitácora. Intenta nuevamente.' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id — Editar cabecera (título, descripción, notas, clienteId)
// ════════════════════════════════════════════════════════════════════
const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { titulo, descripcion, notas, clienteId: clienteIdRaw } = req.body
    const { id: usuarioId, sucursalId } = req.usuario
    const empresaId = getEmpresaId(req)

    const existente = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, clienteId: true, saldoPendiente: true }
    })
    if (!existente) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (existente.empresaId !== empresaId) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
    if (['CERRADA_VENTA','CERRADA_INTERNA'].includes(existente.estado))
      return res.status(400).json({ success: false, error: 'No se puede editar una bitácora cerrada' })

    const data = {}
    if (titulo !== undefined) {
      // Bitácora MANUAL requiere título siempre
      if (existente.origen === 'MANUAL' && !titulo?.trim()) {
        return res.status(400).json({ success: false, error: 'El título es obligatorio en bitácoras manuales' })
      }
      data.titulo = titulo?.trim() || null
    }
    if (descripcion !== undefined) data.descripcion = descripcion?.trim() || null
    if (notas !== undefined)       data.notas       = notas?.trim() || null

    // ── Cambio de cliente ──
    let clienteNuevoId = null
    const tieneClienteId = clienteIdRaw !== undefined && clienteIdRaw !== null
    if (tieneClienteId) {
      const cid = parseInt(clienteIdRaw)
      if (!cid || isNaN(cid)) {
        // clienteId vacío o inválido → quitar cliente
        clienteNuevoId = null
      } else {
        const cliente = await prisma.cliente.findFirst({ where: { id: cid, empresaId, activo: true }, select: { id: true } })
        if (!cliente) {
          return res.status(400).json({ success: false, error: 'Cliente no encontrado', codigo: 'CLIENTE_INVALIDO' })
        }
        clienteNuevoId = cid
      }
      data.clienteId = clienteNuevoId
    }

    const clienteIdAnterior = existente.clienteId || null
    const cambioCliente = tieneClienteId && clienteNuevoId !== clienteIdAnterior

    if (cambioCliente) {
      const saldoActual = parseFloat(existente.saldoPendiente || 0)

      await prisma.$transaction(async tx => {
        // Liberar saldo del cliente anterior
        if (clienteIdAnterior && saldoActual > 0) {
          await tx.cliente.update({
            where: { id: clienteIdAnterior },
            data:  { saldoPendiente: { decrement: saldoActual } }
          })
        }
        // Asignar saldo al cliente nuevo
        if (clienteNuevoId && saldoActual > 0) {
          await tx.cliente.update({
            where: { id: clienteNuevoId },
            data:  { saldoPendiente: { increment: saldoActual } }
          })
        }
        // Actualizar bitácora
        await tx.bitacora.update({
          where: { id: parseInt(id) },
          data
        })
      })
    } else if (Object.keys(data).length > 0) {
      // Sin cambio de cliente — update normal
      await prisma.bitacora.update({
        where: { id: parseInt(id) },
        data
      })
    }

    const b = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    await audit(usuarioId, sucursalId, cambioCliente ? 'EDITAR_BITACORA_CLIENTE' : 'EDITAR_BITACORA',
      cambioCliente ? `${existente.folio} — cliente:${clienteIdAnterior || 'ninguno'} → ${clienteNuevoId || 'ninguno'}` : existente.folio,
      empresaId)
    res.json({ success: true, data: b, mensaje: cambioCliente ? 'Cliente actualizado correctamente' : undefined })
  } catch (err) {
    console.error('❌ editar bitacora:', err)
    res.status(500).json({ success: false, error: 'No fue posible actualizar la bitácora. Intenta nuevamente.' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id/descuento — Descuento global de bitácora
// ════════════════════════════════════════════════════════════════════
const aplicarDescuento = async (req, res) => {
  try {
    const { id } = req.params
    const { descuentoTipo, descuentoValor } = req.body
    const { id: usuarioId, sucursalId, rol } = req.usuario
    const empresaId = getEmpresaId(req)

    if (!puedeAplicarDescuento(rol)) {
      return res.status(403).json({ success: false, error: 'Sin permiso para aplicar descuentos', codigo: 'SIN_PERMISO_DESCUENTO' })
    }

    const bitacora = await prisma.bitacora.findFirst({
      where: { id: parseInt(id), empresaId },
      select: {
        id: true, empresaId: true, folio: true, estado: true, totalMateriales: true,
        totalAbonado: true, saldoPendiente: true, clienteId: true, descuentoMonto: true
      }
    })
    if (!bitacora) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
    if (!['ABIERTA', 'PAUSADA'].includes(bitacora.estado)) {
      return res.status(400).json({ success: false, error: `No se puede aplicar descuento en estado ${bitacora.estado}`, codigo: 'ESTADO_INVALIDO' })
    }

    const tipo = descuentoTipo || null
    const valor = parseFloat(descuentoValor || 0)
    const totalMateriales = parseFloat(bitacora.totalMateriales || 0)
    const totalAbonado = parseFloat(bitacora.totalAbonado || 0)
    const saldoAnterior = parseFloat(bitacora.saldoPendiente || 0)

    if (tipo !== null && !['PORCENTAJE', 'MONTO'].includes(tipo)) {
      return res.status(400).json({ success: false, error: 'Tipo de descuento inválido', codigo: 'DESCUENTO_TIPO_INVALIDO' })
    }
    if (isNaN(valor) || valor < 0) {
      return res.status(400).json({ success: false, error: 'Valor de descuento inválido', codigo: 'DESCUENTO_VALOR_INVALIDO' })
    }
    if (tipo === 'PORCENTAJE' && valor > 10) {
      return res.status(400).json({ success: false, error: 'El porcentaje no puede ser mayor a 10%', codigo: 'DESCUENTO_PORCENTAJE_EXCEDE' })
    }
    if (tipo === 'MONTO' && valor > totalMateriales) {
      return res.status(400).json({ success: false, error: 'El descuento no puede exceder el total de materiales', codigo: 'DESCUENTO_MONTO_EXCEDE' })
    }

    const descuento = calcularDescuentoGlobal(totalMateriales, tipo, valor)
    const subtotalConDescuento = parseFloat((totalMateriales - descuento.descuentoMonto).toFixed(2))
    if (subtotalConDescuento < totalAbonado - 0.005) {
      return res.status(400).json({
        success: false,
        error: `No se puede aplicar ese descuento: el monto abonado (${totalAbonado.toFixed(2)}) excedería el subtotal con descuento (${subtotalConDescuento.toFixed(2)}).`,
        codigo: 'ABONO_EXCEDE_DESCUENTO'
      })
    }

    const nuevoSaldo = parseFloat(Math.max(0, subtotalConDescuento - totalAbonado).toFixed(2))
    const deltaCliente = parseFloat((nuevoSaldo - saldoAnterior).toFixed(2))

    await prisma.$transaction(async tx => {
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data: {
          descuentoTipo:  descuento.descuentoTipo,
          descuentoValor: descuento.descuentoValor,
          descuentoMonto: descuento.descuentoMonto,
          saldoPendiente: nuevoSaldo
        }
      })

      if (bitacora.clienteId && Math.abs(deltaCliente) > 0.005) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data:  { saldoPendiente: { increment: deltaCliente } }
        })
      }
    })

    await audit(usuarioId, sucursalId, 'APLICAR_DESCUENTO_BITACORA', `${bitacora.folio} - descuento:$${descuento.descuentoMonto.toFixed(2)}`, empresaId, {
      descuentoTipo: descuento.descuentoTipo,
      descuentoValor: descuento.descuentoValor,
      descuentoMonto: descuento.descuentoMonto,
      saldoAnterior,
      nuevoSaldo
    })

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({ success: true, data: bitacoraActualizada, mensaje: descuento.descuentoMonto > 0 ? 'Descuento aplicado correctamente' : 'Descuento removido correctamente' })
  } catch (err) {
    console.error('❌ aplicar descuento bitacora:', err)
    res.status(500).json({ success: false, error: 'No fue posible aplicar el descuento a la bitácora. Intenta nuevamente.' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id/estado
//  Dos operaciones:
//    1. Cerrar manualmente (CERRADA_INTERNA) — cualquier usuario con permiso, motivo obligatorio
//    2. Reabrir (ABIERTA) — solo SUPERADMIN, ventana de 30 días
// ════════════════════════════════════════════════════════════════════
const cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params
    const { estado, motivo } = req.body || {}
    const { id: usuarioId, rol } = req.usuario
    const empresaId = getEmpresaId(req)
    const sucursalId = resolverSucursalId(req)
    const bitacoraId = Number(id)

    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(bitacoraId)) {
      return res.status(400).json({ success: false, error: 'ID de bitácora inválido', codigo: 'BITACORA_ID_INVALIDO' })
    }

    const validos = ['ABIERTA', 'CERRADA_INTERNA', 'CANCELADA']
    if (!validos.includes(estado)) {
      return res.status(400).json({
        success: false,
        error: `Estado inválido: ${estado}. Solo se permite ABIERTA (reabrir), CERRADA_INTERNA (cierre manual) o CANCELADA.`
      })
    }

    if (estado === 'CANCELADA') {
      if (!motivo?.trim()) {
        return res.status(400).json({ success: false, error: 'Debe indicar un motivo para cancelar la bitácora', codigo: 'MOTIVO_REQUERIDO' })
      }

      const sucursalOperativa = sucursalId
      const resultado = await prisma.$transaction(async tx => {
        const locked = await bloquearBitacora(tx, bitacoraId, empresaId)
        if (!locked) throw errorNegocio(404, 'BITACORA_NO_ENCONTRADA', 'Bitácora no encontrada')

        validarAlcanceSucursal(locked, sucursalOperativa)

        if (locked.origen !== 'MANUAL') {
          throw errorNegocio(
            409,
            'CANCELACION_VENTA_REQUIERE_MODULO_VENTAS',
            'Las bitácoras originadas por una venta deben cancelarse desde el historial de ventas'
          )
        }
        if (locked.estado === 'CANCELADA') {
          throw errorNegocio(409, 'BITACORA_YA_CANCELADA', 'La bitácora ya está cancelada')
        }
        if (locked.estado !== 'ABIERTA' && locked.estado !== 'PAUSADA') {
          throw errorNegocio(409, 'ESTADO_NO_CANCELABLE', `Solo se pueden cancelar bitácoras en estado ABIERTA o PAUSADA (actual: ${locked.estado})`)
        }

        const abonos = await tx.abonoBitacora.findMany({
          where: { bitacoraId, empresaId },
          select: { id: true, monto: true, MovimientoCaja: { select: { id: true } } }
        })
        const movimientosCaja = await tx.movimientoCaja.count({
          where: { empresaId, referencia: locked.folio, tipo: 'ABONO_BITACORA' }
        })
        const totalAbonado = new Decimal(locked.totalAbonado || 0)
        const sumaAbonos = abonos.reduce((total, abono) => total.plus(abono.monto), new Decimal(0))
        const abonosSinCaja = abonos.some(abono => !abono.MovimientoCaja)
        if (!totalAbonado.equals(0) || abonos.length > 0 || movimientosCaja > 0) {
          const inconsistente = !totalAbonado.equals(sumaAbonos) || abonosSinCaja || movimientosCaja !== abonos.length
          throw errorNegocio(
            409,
            inconsistente ? 'PAGOS_INCONSISTENTES' : 'BITACORA_CON_ABONOS',
            inconsistente
              ? 'La bitácora tiene registros de pago inconsistentes y no puede cancelarse automáticamente'
              : 'No se puede cancelar una bitácora con abonos registrados'
          )
        }

        const detalles = await tx.detalleBitacora.findMany({
          where: { bitacoraId },
          select: { productoId: true, cantidad: true, inventarioDescontado: true }
        })
        const cantidades = new Map()
        for (const detalle of detalles) {
          if (!detalle.productoId) continue
          const actual = cantidades.get(detalle.productoId) || { total: new Decimal(0), marcado: new Decimal(0) }
          actual.total = actual.total.plus(detalle.cantidad)
          if (detalle.inventarioDescontado) actual.marcado = actual.marcado.plus(detalle.cantidad)
          cantidades.set(detalle.productoId, actual)
        }

        const movimientos = await tx.movimientoInventario.findMany({
          where: {
            empresaId,
            sucursalId: locked.sucursalId,
            referencia: locked.folio,
            tipo: { in: ['SALIDA_BITACORA', 'DEVOLUCION_ENTRADA'] }
          },
          select: { productoId: true, tipo: true, cantidad: true }
        })
        const netos = new Map()
        for (const movimiento of movimientos) {
          const signo = movimiento.tipo === 'SALIDA_BITACORA' ? 1 : -1
          const actual = netos.get(movimiento.productoId) || new Decimal(0)
          netos.set(movimiento.productoId, actual.plus(new Decimal(movimiento.cantidad).times(signo)))
        }

        const reintegros = new Map()
        const netosPorProducto = new Map()
        for (const [productoId, cantidad] of cantidades) {
          const neto = netos.get(productoId) || new Decimal(0)
          if (neto.isNegative() || neto.greaterThan(cantidad.total) || neto.lessThan(cantidad.marcado)) {
            throw errorNegocio(
              409,
              'INVENTARIO_DEVOLUCION_AMBIGUA',
              `El historial no permite determinar con certeza el inventario a reintegrar para el producto ${productoId}`
            )
          }
          netosPorProducto.set(productoId, neto)
          if (neto.greaterThan(0)) reintegros.set(productoId, neto)
          netos.delete(productoId)
        }
        if ([...netos.values()].some(neto => !neto.equals(0))) {
          throw errorNegocio(409, 'INVENTARIO_DEVOLUCION_AMBIGUA', 'Existen movimientos de inventario sin detalle vigente en la bitácora')
        }

        // Detalles que nunca descontaron inventario (inventarioDescontado=false).
        // Si el stock de la sucursal está en negativo, el material sí salió físicamente
        // y se reintegra la cantidad completa del detalle; con stock en 0 o positivo
        // no se toca nada (nunca se descontó, no hay nada que devolver).
        const sinDescontar = [...cantidades.keys()].filter(productoId => {
          const cantidadesProducto = cantidades.get(productoId)
          return cantidadesProducto.total.minus(cantidadesProducto.marcado).greaterThan(0)
        })

        const inventarios = new Map()
        const productoIds = [...new Set([...reintegros.keys(), ...sinDescontar])].sort((a, b) => a - b)
        for (const productoId of productoIds) {
          const inventario = await bloquearInventarioOpcional(tx, locked.sucursalId, productoId)
          if (!inventario) {
            if (reintegros.has(productoId)) {
              throw errorNegocio(409, 'INVENTARIO_FALTANTE', `No existe inventario para el producto ${productoId} en la sucursal de la bitácora`)
            }
            continue
          }
          inventarios.set(productoId, inventario)
        }

        const productosConExtra = new Set()
        for (const productoId of sinDescontar) {
          const inventario = inventarios.get(productoId)
          if (!inventario || !new Decimal(inventario.stockActual).isNegative()) continue
          const neto = netosPorProducto.get(productoId) || new Decimal(0)
          const extra = cantidades.get(productoId).total.minus(neto)
          if (extra.greaterThan(0)) {
            reintegros.set(productoId, neto.plus(extra))
            productosConExtra.add(productoId)
          }
        }

        for (const [productoId, cantidad] of reintegros) {
          const stockAntes = new Decimal(inventarios.get(productoId).stockActual)
          const stockDespues = stockAntes.plus(cantidad)
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId, sucursalId: locked.sucursalId } },
            data: { stockActual: stockDespues }
          })
          await tx.movimientoInventario.create({
            data: {
              empresaId,
              productoId,
              sucursalId: locked.sucursalId,
              usuarioId,
              tipo: 'DEVOLUCION_ENTRADA',
              cantidad,
              stockAntes,
              stockDespues,
              referencia: locked.folio,
              notas: productosConExtra.has(productoId)
                ? `Cancelación bitácora ${locked.folio} — incluye material no descontado (stock negativo)`
                : `Cancelación bitácora ${locked.folio}`
            }
          })
        }

        const saldo = new Decimal(locked.saldoPendiente || 0)
        if (saldo.isNegative()) {
          throw errorNegocio(409, 'INCONSISTENCIA_SALDO_BITACORA', 'La bitácora tiene un saldo pendiente inválido')
        }
        if (saldo.greaterThan(0) && locked.clienteId) {
          const actualizado = await tx.cliente.updateMany({
            where: { id: locked.clienteId, empresaId, saldoPendiente: { gte: saldo } },
            data: { saldoPendiente: { decrement: saldo } }
          })
          if (actualizado.count !== 1) {
            throw errorNegocio(409, 'INCONSISTENCIA_SALDO_CLIENTE', 'El saldo del cliente no permite liberar esta deuda de forma segura')
          }
        }

        await tx.bitacora.update({
          where: { id: bitacoraId },
          data: {
            estado: 'CANCELADA',
            cerradaEn: new Date(),
            saldoPendiente: 0,
            notas: `[CANCELADA ${new Date().toISOString().split('T')[0]}] ${motivo.trim()}\n${locked.notas || ''}`.trim()
          }
        })
        await tx.auditoria.create({
          data: {
            empresaId,
            usuarioId,
            sucursalId: locked.sucursalId,
            accion: 'CANCELAR_BITACORA',
            modulo: 'BITACORA',
            referencia: `${locked.folio} - ${motivo.trim()}`,
            valorAntes: { estado: locked.estado, saldoPendiente: saldo.toFixed(2) },
            valorDespues: { estado: 'CANCELADA', saldoPendiente: '0.00', productosReintegrados: reintegros.size, productosNoDescontadosReintegrados: productosConExtra.size }
          }
        })

        const data = await tx.bitacora.findFirst({ where: { id: bitacoraId, empresaId }, select: BITACORA_SELECT })
        return { data, folio: locked.folio }
      })

      return res.json({
        success: true,
        data: resultado.data,
        mensaje: 'Bitácora cancelada. Stock y deuda reintegrados de forma atómica.',
        requestId: req.requestId || null
      })
    }

    const existente = await prisma.bitacora.findFirst({
      where: { id: bitacoraId, empresaId },
      select: {
        id: true, folio: true, estado: true, saldoPendiente: true,
        descuentoTipo: true, descuentoValor: true, descuentoMonto: true,
        saldoAlCerrar: true, clienteId: true, origen: true,
        cerradaEn: true, notas: true, totalAbonado: true, empresaId: true
      }
    })
    if (!existente) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })

    // ──────────────────────────────────────────────────────────
    // CASO 1: CERRAR MANUALMENTE (CERRADA_INTERNA)
    // ──────────────────────────────────────────────────────────
    if (estado === 'CERRADA_INTERNA') {
      if (existente.estado !== 'ABIERTA' && existente.estado !== 'PAUSADA') {
        return res.status(400).json({ success: false, error: `Solo se pueden cerrar bitácoras en estado ABIERTA o PAUSADA (actual: ${existente.estado})` })
      }
      if (!motivo?.trim()) {
        return res.status(400).json({ success: false, error: 'Debe indicar un motivo para cierre manual', codigo: 'MOTIVO_REQUERIDO' })
      }

      await prisma.$transaction(async tx => {
        const locked = await bloquearBitacora(tx, bitacoraId, empresaId)
        if (!locked) throw errorNegocio(404, 'BITACORA_NO_ENCONTRADA', 'Bitácora no encontrada')
        validarAlcanceSucursal(locked, sucursalId)
        if (locked.estado !== 'ABIERTA' && locked.estado !== 'PAUSADA') {
          throw errorNegocio(409, 'ESTADO_INVALIDO', `Solo se pueden cerrar bitácoras en estado ABIERTA o PAUSADA (actual: ${locked.estado})`)
        }
        const saldo = parseFloat(locked.saldoPendiente)
        const updateData = {
          estado:         'CERRADA_INTERNA',
          cerradaEn:      new Date(),
          saldoPendiente: 0,
          saldoAlCerrar:  saldo,
          notas:          motivo.trim()
        }
        // Al cerrar con saldo > 0, liberar el saldo del cliente (si tiene)
        if (saldo > 0 && locked.clienteId) {
          const actualizado = await tx.cliente.updateMany({
            where: { id: locked.clienteId, empresaId, saldoPendiente: { gte: saldo } },
            data:  { saldoPendiente: { decrement: saldo } }
          })
          if (actualizado.count !== 1) throw errorNegocio(409, 'INCONSISTENCIA_SALDO_CLIENTE', 'El saldo del cliente no permite cerrar la bitácora')
        }
        await tx.bitacora.update({ where: { id: bitacoraId }, data: updateData })
      })

      await audit(usuarioId, sucursalId, 'CERRAR_BITACORA_INTERNA', `${existente.folio} - saldo:$${parseFloat(existente.saldoPendiente).toFixed(2)} - ${motivo}`, empresaId)
      const b = await prisma.bitacora.findFirst({ where: { id: parseInt(id), empresaId }, select: BITACORA_SELECT })
      return res.json({ success: true, data: b, mensaje: 'Bitácora cerrada manualmente' })
    }

    // ──────────────────────────────────────────────────────────
    // CASO 2: REABRIR (ABIERTA) - Solo SUPERADMIN, ventana 30 días
    // ──────────────────────────────────────────────────────────
    if (estado === 'ABIERTA') {
      // Validar permiso
      if (rol !== 'SUPERADMIN') {
        return res.status(403).json({
          success: false,
          error: 'Solo SUPERADMIN puede reabrir bitácoras cerradas',
          codigo: 'PERMISO_DENEGADO'
        })
      }
      // Validar estado previo
      if (!['CERRADA_VENTA', 'CERRADA_INTERNA'].includes(existente.estado)) {
        return res.status(400).json({
          success: false,
          error: `La bitácora no está cerrada (estado actual: ${existente.estado})`,
          codigo: 'NO_ESTA_CERRADA'
        })
      }
      // Validar ventana de 30 días desde cerradaEn
      if (existente.cerradaEn) {
        const diasDesdeCierre = (Date.now() - new Date(existente.cerradaEn).getTime()) / 86400000
        if (diasDesdeCierre > 30) {
          return res.status(400).json({
            success: false,
            error: `No se puede reabrir: han pasado ${Math.floor(diasDesdeCierre)} días desde el cierre (máximo 30)`,
            codigo: 'VENTANA_EXPIRADA',
            diasTranscurridos: Math.floor(diasDesdeCierre)
          })
        }
      }
      // Motivo de reapertura obligatorio
      if (!motivo?.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Debe indicar el motivo de reapertura',
          codigo: 'MOTIVO_REQUERIDO'
        })
      }

      await prisma.$transaction(async tx => {
        const locked = await bloquearBitacora(tx, bitacoraId, empresaId)
        if (!locked) throw errorNegocio(404, 'BITACORA_NO_ENCONTRADA', 'Bitácora no encontrada')
        validarAlcanceSucursal(locked, sucursalId)
        if (!['CERRADA_VENTA', 'CERRADA_INTERNA'].includes(locked.estado)) {
          throw errorNegocio(409, 'NO_ESTA_CERRADA', `La bitácora no está cerrada (estado actual: ${locked.estado})`)
        }
        // 1. Re-sumar al cliente el saldo que se le había liberado al cerrar
        //    (solo aplica si era CERRADA_INTERNA — en CERRADA_VENTA el saldo era 0)
        const saldoRecuperar = parseFloat(locked.saldoAlCerrar || 0)
        if (saldoRecuperar > 0 && locked.clienteId && locked.estado === 'CERRADA_INTERNA') {
          const actualizado = await tx.cliente.updateMany({
            where: { id: locked.clienteId, empresaId },
            data: { saldoPendiente: { increment: saldoRecuperar } }
          })
          if (actualizado.count !== 1) throw errorNegocio(409, 'INCONSISTENCIA_SALDO_CLIENTE', 'No fue posible restaurar el saldo del cliente')
        }

        // 2. Restaurar estado y limpiar campos de cierre
        await tx.bitacora.update({
          where: { id: parseInt(id) },
          data: {
            estado:         'ABIERTA',
            cerradaEn:      null,
            saldoAlCerrar:  null,
            saldoPendiente: saldoRecuperar || parseFloat(locked.saldoPendiente),
            notas:          `[REAPERTURA ${new Date().toISOString().split('T')[0]}] ${motivo.trim()}\n${locked.notas || ''}`.trim()
          }
        })
      })

      await audit(usuarioId, sucursalId, 'REABRIR_BITACORA',
        `${existente.folio} - estado previo:${existente.estado} - ${motivo}`, empresaId)
      const b = await prisma.bitacora.findFirst({ where: { id: parseInt(id), empresaId }, select: BITACORA_SELECT })
      return res.json({ success: true, data: b, mensaje: 'Bitácora reabierta. El saldo del cliente fue restaurado.' })
    }
  } catch (err) {
    return responderError(req, res, err, 'No fue posible cambiar el estado de la bitácora. Intenta nuevamente.')
  }
}

// ════════════════════════════════════════════════════════════════════
//  DELETE /bitacoras/:id — Eliminar bitácora CANCELADA
//  Solo SUPERADMIN. Solo estado CANCELADA. Irreversible.
// ════════════════════════════════════════════════════════════════════
const eliminar = async (req, res) => {
  try {
    const { id } = req.params
    const { id: usuarioId, sucursalId, rol } = req.usuario
    const empresaId = getEmpresaId(req)

    if (rol !== 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: 'Solo SUPERADMIN puede eliminar bitácoras', codigo: 'PERMISO_DENEGADO' })
    }

    const existente = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, empresaId: true, estado: true, folio: true }
    })
    if (!existente || existente.empresaId !== empresaId) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
    if (existente.estado !== 'CANCELADA') {
      return res.status(400).json({ success: false, error: 'Solo se pueden eliminar bitácoras CANCELADA', codigo: 'ESTADO_INVALIDO' })
    }

    await prisma.$transaction(async tx => {
      await tx.detalleBitacora.deleteMany({ where: { bitacoraId: parseInt(id) } })
      await tx.abonoBitacora.deleteMany({ where: { bitacoraId: parseInt(id) } })
      await tx.bitacora.delete({ where: { id: parseInt(id) } })
    })

    await audit(usuarioId, sucursalId, 'ELIMINAR_BITACORA', `${existente.folio} — eliminación permanente`, empresaId)
    res.json({ success: true, mensaje: `Bitácora ${existente.folio} eliminada permanentemente` })
  } catch (err) {
    console.error('❌ eliminar bitacora:', err)
    res.status(500).json({ success: false, error: 'No fue posible eliminar la bitácora. Intenta nuevamente.' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/productos — Agregar producto (SOLO MANUAL)
//  Descuenta inventario de la sucursal del usuario.
//  Si stock insuficiente: permite la operación pero devuelve flag.
// ════════════════════════════════════════════════════════════════════
const agregarProducto = async (req, res) => {
  try {
    const { id } = req.params
    const { productoId, cantidad, precioUnitario, notas, fechaManual, responsableId, recibeTrabajadorId } = req.body
    const { id: usuarioId } = req.usuario
    // P0-BRANCH-ISOLATION: la sucursal operativa viene del contexto, nunca del body ni fallback a 1.
    const sucursalId = resolverSucursalId(req)
    if (!sucursalId) {
      return res.status(400).json({ success: false, error: 'Se requiere contexto de sucursal para operar la bitácora', codigo: 'BRANCH_CONTEXT_REQUIRED' })
    }
    const empresaId = getEmpresaId(req)

    // ── Validaciones ──
    if (!productoId)                        return res.status(400).json({ success: false, error: 'productoId requerido' })
    const cant = parseFloat(cantidad)
    if (!cant || cant <= 0)                 return res.status(400).json({ success: false, error: 'Cantidad debe ser > 0' })
    const precio = parseFloat(precioUnitario)
    if (isNaN(precio) || precio < 0)        return res.status(400).json({ success: false, error: 'Precio unitario inválido' })

    // ── Fecha manual (obligatoria en altas manuales) ──
    let fechaManualDate
    try {
      fechaManualDate = parseFechaManual(fechaManual)
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message, codigo: 'FECHA_INVALIDA' })
    }

    // ── Responsable (obligatorio, misma empresa, activo) ──
    const respId = Number(responsableId)
    if (!Number.isInteger(respId) || respId <= 0) {
      return res.status(400).json({ success: false, error: 'responsableId requerido', codigo: 'RESPONSABLE_REQUERIDO' })
    }
    const responsable = await prisma.usuario.findFirst({
      where: { id: respId, empresaId, activo: true },
      select: { id: true, nombre: true }
    })
    if (!responsable) {
      return res.status(400).json({ success: false, error: 'Responsable inválido o de otra empresa', codigo: 'RESPONSABLE_INVALIDO' })
    }

    // ── Recibe (obligatorio, misma empresa, activo) ──
    const recibeId = Number(recibeTrabajadorId)
    if (!Number.isInteger(recibeId) || recibeId <= 0) {
      return res.status(400).json({ success: false, error: 'recibeTrabajadorId requerido', codigo: 'RECIBE_REQUERIDO' })
    }
    const trabajador = await prisma.trabajador.findFirst({
      where: { id: recibeId, empresaId, activo: true },
      select: { id: true, nombre: true, apodo: true }
    })
    if (!trabajador) {
      return res.status(400).json({ success: false, error: 'Trabajador inválido, inactivo o de otra empresa', codigo: 'RECIBE_INVALIDO' })
    }

    // ── Bitácora ──
    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, descuentoMonto: true, clienteId: true }
    })
    if (!bitacora)                          return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.empresaId !== empresaId) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
    if (bitacora.origen !== 'MANUAL') {
      return res.status(403).json({
        success: false,
        error: 'Solo se pueden agregar productos a bitácoras MANUAL. Las bitácoras origen VENTA se actualizan automáticamente desde el POS.',
        codigo: 'ORIGEN_INCORRECTO'
      })
    }
    if (bitacora.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, error: `No se pueden agregar productos en estado ${bitacora.estado}`, codigo: 'ESTADO_INVALIDO' })
    }

    // ── Producto + inventario ──
    const producto = await prisma.producto.findFirst({
      where: { id: parseInt(productoId), empresaId, activo: true },
      select: { id: true, nombre: true, codigoInterno: true, precioVenta: true, activo: true, unidadVenta: true, esGranel: true }
    })
    if (!producto)                    return res.status(404).json({ success: false, error: 'Producto no encontrado' })

    const subtotal          = parseFloat((cant * precio).toFixed(2))

    // ── Transacción ──
    const resultado = await prisma.$transaction(async tx => {
      const locked = await bloquearBitacora(tx, parseInt(id), empresaId)
      if (!locked) throw errorNegocio(404, 'BITACORA_NO_ENCONTRADA', 'Bitácora no encontrada')
      validarBitacoraManualEditable(locked, sucursalId)

      const inv = await bloquearInventarioOpcional(tx, sucursalId, producto.id)
      const stockActual = new Decimal(inv?.stockActual || 0)
      const cantidadDecimal = new Decimal(cant)
      const stockInsuficiente = !inv || stockActual.lessThan(cantidadDecimal)

      // 1. Crear detalle de bitácora
      const detalle = await tx.detalleBitacora.create({
        data: {
          bitacoraId:           parseInt(id),
          productoId:           producto.id,
          cantidad:             cant,
          precioUnitario:       precio,
          subtotal,
          inventarioDescontado: !stockInsuficiente,
          notas:                notas?.trim() || null,
          fechaManual:          fechaManualDate,
          responsableId:        responsable.id,
          recibeTrabajadorId:   trabajador.id,
          recibeNombre:         nombreTrabajador(trabajador),
          unidadVentaSnapshot:       normalizarUnidadVenta(producto.unidadVenta, false) || null,
          unidadCapturadaSnapshot:   normalizarUnidadVenta(producto.unidadVenta, false) || null,
          esGranelSnapshot:          producto.esGranel,
          factorConversionSnapshot:  null,
          modoCapturaSnapshot:       'CANTIDAD',
          cantidadCapturadaSnapshot: cant,
          importeCapturadoSnapshot:  null
        }
      })

      // 2. El inventario se descuenta completo o no se toca.
      if (!stockInsuficiente) {
        const nuevoStock = stockActual.minus(cantidadDecimal)
        await tx.inventarioSucursal.update({
          where: { productoId_sucursalId: { productoId: producto.id, sucursalId } },
          data:  { stockActual: nuevoStock }
        })
        await tx.movimientoInventario.create({
          data: {
            empresaId,
            productoId: producto.id,
            sucursalId,
            usuarioId,
            tipo: 'SALIDA_BITACORA',
            cantidad: cantidadDecimal,
            stockAntes: stockActual,
            stockDespues: nuevoStock,
            referencia: locked.folio,
            notas: `Bitácora ${locked.folio} — ${producto.nombre}`
          }
        })
      }

      // 3. Actualizar totales de bitácora
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data: {
          totalMateriales: { increment: subtotal },
          saldoPendiente: { increment: subtotal }
        }
      })

      // 4. Actualizar saldo del cliente SOLO si la bitácora tiene cliente
      if (locked.clienteId) {
        const actualizado = await tx.cliente.updateMany({
          where: { id: locked.clienteId, empresaId },
          data:  { saldoPendiente: { increment: subtotal } }
        })
        if (actualizado.count !== 1) throw errorNegocio(409, 'CLIENTE_INCONSISTENTE', 'No fue posible actualizar el saldo del cliente')
      }

      return { detalle, stockInsuficiente, stockActual: stockActual.toNumber() }
    })

    await audit(usuarioId, sucursalId, 'AGREGAR_PRODUCTO_BITACORA', `${bitacora.folio} — ${producto.nombre} x${cant}`, empresaId, {
      detalleId:          resultado.detalle.id,
      productoId:         producto.id,
      cantidad:           cant,
      precioUnitario:     precio,
      subtotal,
      fechaManual,
      responsableId:      responsable.id,
      recibeTrabajadorId: trabajador.id,
      recibeNombre:       nombreTrabajador(trabajador)
    })

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({
      success:  true,
      data:     bitacoraActualizada,
      detalleId: resultado.detalle.id,
      stockInsuficiente: resultado.stockInsuficiente,
      stockActual: resultado.stockActual,
      mensaje: resultado.stockInsuficiente
        ? `⚠️ Producto agregado sin descontar inventario: stock insuficiente (había ${resultado.stockActual}, se pidieron ${cant})`
        : 'Producto agregado correctamente'
    })
  } catch (err) {
    return responderError(req, res, err, 'No fue posible agregar el producto a la bitácora. Intenta nuevamente.')
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/productos/batch — Agregar varios productos (SOLO MANUAL)
//  Atómico: o entran todos los items o ninguno (un item inválido aborta el lote).
//  Cada item es un renglón nuevo en DetalleBitacora con su propia fecha/responsable
//  (no hay merge ni suma por producto repetido).
//  Stock secuencial: un mismo producto repetido se descuenta acumulado dentro del lote.
//  Stock insuficiente NO aborta el lote (marca inventarioDescontado:false, como agregarProducto).
//  Totales de bitácora y saldo de cliente se actualizan UNA sola vez al final.
// ════════════════════════════════════════════════════════════════════
const agregarProductosBatch = async (req, res) => {
  try {
    const { id } = req.params
    const { items } = req.body
    const { id: usuarioId } = req.usuario
    // P0-BRANCH-ISOLATION: la sucursal operativa viene del contexto, nunca del body ni fallback a 1.
    const sucursalId = resolverSucursalId(req)
    if (!sucursalId) {
      return res.status(400).json({ success: false, error: 'Se requiere contexto de sucursal para operar la bitácora', codigo: 'BRANCH_CONTEXT_REQUIRED' })
    }
    const empresaId = getEmpresaId(req)

    // ── Validar lote ──
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items debe ser un arreglo con al menos un producto', codigo: 'ITEMS_VACIO' })
    }
    if (items.length > 100) {
      return res.status(400).json({ success: false, error: 'Máximo 100 productos por lote', codigo: 'ITEMS_EXCESO' })
    }

    // ── Validar forma de cada item + parsear fecha (un item inválido aborta todo) ──
    const itemsNorm = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {}
      const productoId = parseInt(it.productoId)
      if (!productoId) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: productoId requerido`, codigo: 'ITEM_INVALIDO', indice: i })
      }
      const cant = parseFloat(it.cantidad)
      if (!cant || cant <= 0) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: cantidad debe ser > 0`, codigo: 'ITEM_INVALIDO', indice: i })
      }
      const precio = parseFloat(it.precioUnitario)
      if (isNaN(precio) || precio < 0) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: precio unitario inválido`, codigo: 'ITEM_INVALIDO', indice: i })
      }
      let fechaManualDate
      try {
        fechaManualDate = parseFechaManual(it.fechaManual)
      } catch (e) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: ${e.message}`, codigo: 'FECHA_INVALIDA', indice: i })
      }
      const respId = Number(it.responsableId)
      if (!Number.isInteger(respId) || respId <= 0) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: responsableId requerido`, codigo: 'RESPONSABLE_REQUERIDO', indice: i })
      }
      const recibeId = Number(it.recibeTrabajadorId)
      if (!Number.isInteger(recibeId) || recibeId <= 0) {
        return res.status(400).json({ success: false, error: `Ítem ${i}: recibeTrabajadorId requerido`, codigo: 'RECIBE_REQUERIDO', indice: i })
      }
      itemsNorm.push({ indice: i, productoId, cant, precio, fechaManualDate, respId, recibeId, notas: it.notas?.trim() || null })
    }

    // ── Bitácora (validada una sola vez) ──
    const bitacora = await prisma.bitacora.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, descuentoMonto: true, clienteId: true }
    })
    if (!bitacora)                          return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.empresaId !== empresaId) {
      return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    }
    if (bitacora.origen !== 'MANUAL') {
      return res.status(403).json({ success: false, error: 'Solo se pueden agregar productos a bitácoras MANUAL', codigo: 'ORIGEN_INCORRECTO' })
    }
    if (bitacora.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, error: `No se pueden agregar productos en estado ${bitacora.estado}`, codigo: 'ESTADO_INVALIDO' })
    }

    // ── Responsables: todos válidos, activos, misma empresa (una sola query) ──
    const respIds = [...new Set(itemsNorm.map(x => x.respId))]
    const responsables = await prisma.usuario.findMany({
      where: { id: { in: respIds }, empresaId, activo: true },
      select: { id: true }
    })
    const respValidos = new Set(responsables.map(r => r.id))
    const itemRespMal = itemsNorm.find(x => !respValidos.has(x.respId))
    if (itemRespMal) {
      return res.status(400).json({ success: false, error: `Ítem ${itemRespMal.indice}: responsable inválido o de otra empresa`, codigo: 'RESPONSABLE_INVALIDO', indice: itemRespMal.indice })
    }

    // ── Trabajadores (Recibe): todos válidos, activos, misma empresa (una sola query) ──
    const trabIds = [...new Set(itemsNorm.map(x => x.recibeId))]
    const trabajadores = await prisma.trabajador.findMany({
      where: { id: { in: trabIds }, empresaId, activo: true },
      select: { id: true, nombre: true, apodo: true }
    })
    const trabMap = new Map(trabajadores.map(t => [t.id, t]))
    const itemTrabMal = itemsNorm.find(x => !trabMap.has(x.recibeId))
    if (itemTrabMal) {
      return res.status(400).json({ success: false, error: `Ítem ${itemTrabMal.indice}: trabajador (recibe) inválido, inactivo o de otra empresa`, codigo: 'RECIBE_INVALIDO', indice: itemTrabMal.indice })
    }

    // ── Productos: todos existen, activos, misma empresa (una sola query) ──
    const prodIds = [...new Set(itemsNorm.map(x => x.productoId))]
    const productos = await prisma.producto.findMany({
      where: { id: { in: prodIds }, empresaId, activo: true },
      select: { id: true, nombre: true }
    })
    const prodMap = new Map(productos.map(p => [p.id, p]))
    const itemProdMal = itemsNorm.find(x => !prodMap.has(x.productoId))
    if (itemProdMal) {
      return res.status(404).json({ success: false, error: `Ítem ${itemProdMal.indice}: producto no encontrado o inactivo`, codigo: 'PRODUCTO_INVALIDO', indice: itemProdMal.indice })
    }

    // ── Retiro/lote: un registro persistente por cada guardado de borrador ──
    const totalLotePrevisto = parseFloat(itemsNorm.reduce((sum, it) => sum + (it.cant * it.precio), 0).toFixed(2))
    const saldoActual = parseFloat(bitacora.saldoPendiente || 0)
    const saldoPrevisto = parseFloat((saldoActual + totalLotePrevisto).toFixed(2))
    const recibeIdsUnicos = [...new Set(itemsNorm.map(x => x.recibeId))]
    const respIdsUnicos = [...new Set(itemsNorm.map(x => x.respId))]
    const fechasUnicas = [...new Set(itemsNorm.map(x => x.fechaManualDate.toISOString().slice(0, 10)))]
    const recibeNombreRetiro = [...new Set(itemsNorm.map(x => nombreTrabajador(trabMap.get(x.recibeId))))].join(', ')
    const recibeTrabajadorIdRetiro = recibeIdsUnicos.length === 1 ? recibeIdsUnicos[0] : null
    const responsableIdRetiro = respIdsUnicos.length === 1 ? respIdsUnicos[0] : null
    const fechaManualRetiro = fechasUnicas.length === 1 ? itemsNorm[0].fechaManualDate : null

    // ── Transacción única: todo el lote es atómico ──
    const resultado = await prisma.$transaction(async tx => {
      const locked = await bloquearBitacora(tx, parseInt(id), empresaId)
      if (!locked) throw errorNegocio(404, 'BITACORA_NO_ENCONTRADA', 'Bitácora no encontrada')
      validarBitacoraManualEditable(locked, sucursalId)

      const saldoLocked = parseFloat(locked.saldoPendiente || 0)
      const retiro = await tx.retiroBitacora.create({
        data: {
          empresaId,
          bitacoraId: parseInt(id),
          usuarioId,
          responsableId: responsableIdRetiro,
          recibeTrabajadorId: recibeTrabajadorIdRetiro,
          recibeNombre: recibeNombreRetiro,
          fechaManual: fechaManualRetiro,
          total: totalLotePrevisto,
          saldoAnterior: saldoLocked,
          saldoDespues: parseFloat((saldoLocked + totalLotePrevisto).toFixed(2))
        }
      })

      // Stock vigente por producto, en memoria, para descuento secuencial
      const stockMap = new Map()
      for (const pid of [...prodIds].sort((a, b) => a - b)) {
        const inv = await bloquearInventarioOpcional(tx, sucursalId, pid)
        stockMap.set(pid, { existe: !!inv, stock: parseFloat(inv?.stockActual || 0) })
      }

      const resumen  = []
      let totalLote  = 0

      for (const it of itemsNorm) {
        const prod = prodMap.get(it.productoId)
        const st   = stockMap.get(it.productoId)
        const stockActual       = st.stock
        const stockInsuficiente = it.cant > stockActual
        const subtotal          = parseFloat((it.cant * it.precio).toFixed(2))

        // 1. Crear detalle (un renglón por item, sin merge)
        const detalle = await tx.detalleBitacora.create({
          data: {
            bitacoraId:           parseInt(id),
            productoId:           prod.id,
            cantidad:             it.cant,
            precioUnitario:       it.precio,
            subtotal,
            inventarioDescontado: !stockInsuficiente,
            notas:                it.notas,
            fechaManual:          it.fechaManualDate,
            responsableId:        it.respId,
            recibeTrabajadorId:   it.recibeId,
            recibeNombre:         nombreTrabajador(trabMap.get(it.recibeId)),
            retiroBitacoraId:     retiro.id
          }
        })

        // 2. El inventario se descuenta completo o no se toca.
        if (!stockInsuficiente && st.existe) {
          const nuevoStock = parseFloat((stockActual - it.cant).toFixed(3))
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: prod.id, sucursalId } },
            data:  { stockActual: nuevoStock }
          })
          await tx.movimientoInventario.create({
            data: {
              empresaId,
              productoId: prod.id,
              sucursalId,
              usuarioId,
              tipo: 'SALIDA_BITACORA',
              cantidad: it.cant,
              stockAntes: stockActual,
              stockDespues: nuevoStock,
              referencia: locked.folio,
              notas: `Bitácora ${locked.folio} — ${prod.nombre}`
            }
          })
          st.stock = nuevoStock   // actualizar memoria para el próximo item del mismo producto
        }

        totalLote = parseFloat((totalLote + subtotal).toFixed(2))
        resumen.push({ indice: it.indice, detalleId: detalle.id, productoId: prod.id, cantidad: it.cant, stockInsuficiente })
      }

      // 4. Totales de bitácora — una sola vez
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data:  { totalMateriales: { increment: totalLote }, saldoPendiente: { increment: totalLote } }
      })

      // 5. Saldo del cliente — una sola vez, solo si hay cliente
      if (locked.clienteId) {
        const actualizado = await tx.cliente.updateMany({
          where: { id: locked.clienteId, empresaId },
          data:  { saldoPendiente: { increment: totalLote } }
        })
        if (actualizado.count !== 1) throw errorNegocio(409, 'CLIENTE_INCONSISTENTE', 'No fue posible actualizar el saldo del cliente')
      }

      return { resumen, totalLote, retiroId: retiro.id }
    })

    const conStockInsuf = resultado.resumen.filter(r => r.stockInsuficiente).length
    await audit(usuarioId, sucursalId, 'AGREGAR_PRODUCTOS_BATCH', `${bitacora.folio} — ${resultado.resumen.length} productos +$${resultado.totalLote.toFixed(2)}`, empresaId, {
      cantidadItems:        resultado.resumen.length,
      totalLote:            resultado.totalLote,
      retiroId:             resultado.retiroId,
      conStockInsuficiente: conStockInsuf,
      detalleIds:           resultado.resumen.map(r => r.detalleId)
    })

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({
      success:              true,
      data:                 bitacoraActualizada,
      agregados:            resultado.resumen.length,
      conStockInsuficiente: conStockInsuf,
      retiroId:             resultado.retiroId,
      resumen:              resultado.resumen,
      mensaje: conStockInsuf > 0
        ? `${resultado.resumen.length} productos agregados (${conStockInsuf} con stock insuficiente)`
        : `${resultado.resumen.length} productos agregados correctamente`
    })
  } catch (err) {
    return responderError(req, res, err, 'No fue posible agregar los productos a la bitácora. Intenta nuevamente.')
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id/productos/:detalleId
//  Editar cantidad o precioUnitario de un detalle (SOLO MANUAL).
//  Ajusta inventario, totales de bitácora y saldo del cliente.
// ════════════════════════════════════════════════════════════════════
const editarDetalle = async (req, res) => {
  try {
    const { id, detalleId } = req.params
    const { cantidad, precioUnitario, recibeTrabajadorId } = req.body
    const { id: usuarioId } = req.usuario
    // P0-BRANCH-ISOLATION: la sucursal operativa viene del contexto, nunca del fallback a 1.
    const sucursalId = resolverSucursalId(req)
    if (!sucursalId) {
      return res.status(400).json({ success: false, error: 'Se requiere contexto de sucursal para operar la bitácora', codigo: 'BRANCH_CONTEXT_REQUIRED' })
    }
    const empresaId = getEmpresaId(req)

    if (cantidad === undefined && precioUnitario === undefined && recibeTrabajadorId === undefined) {
      return res.status(400).json({ success: false, error: 'Debes enviar cantidad, precioUnitario o recibeTrabajadorId' })
    }

    const bitacora = await prisma.bitacora.findFirst({
      where: { id: parseInt(id), empresaId },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, totalAbonado: true, descuentoMonto: true, clienteId: true }
    })
    if (!bitacora) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.origen !== 'MANUAL')  return res.status(403).json({ success: false, error: 'Solo se pueden editar detalles de bitácoras MANUAL', codigo: 'ORIGEN_INCORRECTO' })
    if (bitacora.estado !== 'ABIERTA') return res.status(400).json({ success: false, error: `No se pueden editar detalles en estado ${bitacora.estado}` })

    const detalle = await prisma.detalleBitacora.findUnique({
      where: { id: parseInt(detalleId) },
      select: { id: true, bitacoraId: true, productoId: true, cantidad: true, precioUnitario: true, subtotal: true, inventarioDescontado: true, Producto: { select: { nombre: true } } }
    })
    if (!detalle || detalle.bitacoraId !== parseInt(id)) {
      return res.status(404).json({ success: false, error: 'Detalle no encontrado en esta bitácora' })
    }

    const cantidadNueva = cantidad !== undefined ? parseFloat(cantidad) : parseFloat(detalle.cantidad)
    const precioNuevo   = precioUnitario !== undefined ? parseFloat(precioUnitario) : parseFloat(detalle.precioUnitario)

    if (isNaN(cantidadNueva) || cantidadNueva < 0) return res.status(400).json({ success: false, error: 'Cantidad inválida' })
    if (isNaN(precioNuevo) || precioNuevo < 0)     return res.status(400).json({ success: false, error: 'Precio inválido' })

    // ── Recibe (opcional en edición) ──
    let trabData = {}
    if (recibeTrabajadorId !== undefined) {
      if (recibeTrabajadorId === null || recibeTrabajadorId === '') {
        trabData = { recibeTrabajadorId: null, recibeNombre: null }
      } else {
        const recibeId = Number(recibeTrabajadorId)
        if (!Number.isInteger(recibeId) || recibeId <= 0) {
          return res.status(400).json({ success: false, error: 'recibeTrabajadorId inválido', codigo: 'RECIBE_INVALIDO' })
        }
        const trab = await prisma.trabajador.findFirst({
          where: { id: recibeId, empresaId, activo: true },
          select: { id: true, nombre: true, apodo: true }
        })
        if (!trab) {
          return res.status(400).json({ success: false, error: 'Trabajador inválido, inactivo o de otra empresa', codigo: 'RECIBE_INVALIDO' })
        }
        trabData = { recibeTrabajadorId: trab.id, recibeNombre: nombreTrabajador(trab) }
      }
    }

    const subtotalNuevo  = parseFloat((cantidadNueva * precioNuevo).toFixed(2))
    const subtotalOrig   = parseFloat(detalle.subtotal)
    const diferencia     = subtotalNuevo - subtotalOrig

    // Validar que el nuevo subtotal neto no quede por debajo del total abonado
    const nuevoTotalMat = parseFloat((parseFloat(bitacora.totalMateriales) + diferencia).toFixed(2))
    const descuentoMonto = parseFloat(bitacora.descuentoMonto || 0)
    const nuevoSubtotalNeto = parseFloat((nuevoTotalMat - descuentoMonto).toFixed(2))
    const totalAbonado  = parseFloat(bitacora.totalAbonado)
    if (nuevoSubtotalNeto < totalAbonado - 0.005) {
      return res.status(400).json({
        success: false,
        error: `No se puede reducir tanto: el monto ya abonado ($${totalAbonado.toFixed(2)}) excedería el nuevo subtotal con descuento ($${nuevoSubtotalNeto.toFixed(2)}).`,
        codigo: 'ABONO_EXCEDE'
      })
    }

    // Cambio de cantidad → ajuste de inventario
    let stockInsuficiente = false
    let stockActualSucursal = 0
    if (cantidad !== undefined && detalle.productoId) {
      const cantidadOrig = parseFloat(detalle.cantidad)
      const deltaCant    = cantidadNueva - cantidadOrig

      const inv = await prisma.inventarioSucursal.findUnique({
        where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId } },
        select: { stockActual: true }
      })
      stockActualSucursal = parseFloat(inv?.stockActual || 0)

      // Si AUMENTAMOS cantidad → necesitamos descontar más stock
      if (deltaCant > 0) {
        stockInsuficiente = deltaCant > stockActualSucursal
      }
    }

    const resultadoEdicion = await prisma.$transaction(async tx => {
      const locked = await bloquearBitacora(tx, parseInt(id), empresaId)
      if (!locked) throw errorNegocio(404, 'BITACORA_NO_ENCONTRADA', 'Bitácora no encontrada')
      validarBitacoraManualEditable(locked, sucursalId)

      const detalleLocked = await tx.detalleBitacora.findFirst({
        where: { id: parseInt(detalleId), bitacoraId: parseInt(id) },
        select: { id: true, productoId: true, cantidad: true, precioUnitario: true, subtotal: true, inventarioDescontado: true }
      })
      if (!detalleLocked) throw errorNegocio(404, 'DETALLE_NO_ENCONTRADO', 'Detalle no encontrado en esta bitácora')

      const cantNueva = cantidad !== undefined ? parseFloat(cantidad) : parseFloat(detalleLocked.cantidad)
      const precioNuevoLocked = precioUnitario !== undefined ? parseFloat(precioUnitario) : parseFloat(detalleLocked.precioUnitario)
      const subtotalNuevoLocked = parseFloat((cantNueva * precioNuevoLocked).toFixed(2))
      const diferenciaLocked = parseFloat((subtotalNuevoLocked - parseFloat(detalleLocked.subtotal)).toFixed(2))
      const nuevoTotalLocked = parseFloat((parseFloat(locked.totalMateriales) + diferenciaLocked).toFixed(2))
      const nuevoSaldoLocked = parseFloat((parseFloat(locked.saldoPendiente) + diferenciaLocked).toFixed(2))
      if (nuevoTotalLocked - parseFloat(locked.descuentoMonto || 0) < parseFloat(locked.totalAbonado) - 0.005) {
        throw errorNegocio(409, 'ABONO_EXCEDE', 'El cambio dejaría el total por debajo de los abonos registrados')
      }

      let insuficiente = false
      let stockActual = 0
      let inventarioDescontado = detalleLocked.inventarioDescontado
      if (cantidad !== undefined && detalleLocked.productoId) {
        const inv = await bloquearInventarioOpcional(tx, sucursalId, detalleLocked.productoId)
        const deduccionAnterior = detalleLocked.inventarioDescontado ? new Decimal(detalleLocked.cantidad) : new Decimal(0)
        if (!inv && deduccionAnterior.greaterThan(0)) {
          throw errorNegocio(409, 'INVENTARIO_FALTANTE', 'Falta el inventario previamente descontado para este detalle')
        }
        const stockAntes = new Decimal(inv?.stockActual || 0)
        const disponible = stockAntes.plus(deduccionAnterior)
        const deduccionNueva = inv && disponible.greaterThanOrEqualTo(cantNueva) ? new Decimal(cantNueva) : new Decimal(0)
        const deltaDeduccion = deduccionNueva.minus(deduccionAnterior)
        const stockDespues = stockAntes.minus(deltaDeduccion)
        insuficiente = deduccionNueva.lessThan(cantNueva)
        inventarioDescontado = !insuficiente
        stockActual = stockAntes.toNumber()

        if (!deltaDeduccion.equals(0)) {
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: detalleLocked.productoId, sucursalId } },
            data: { stockActual: stockDespues }
          })
          await tx.movimientoInventario.create({
            data: {
              empresaId,
              productoId: detalleLocked.productoId,
              sucursalId,
              usuarioId,
              tipo: deltaDeduccion.greaterThan(0) ? 'SALIDA_BITACORA' : 'DEVOLUCION_ENTRADA',
              cantidad: deltaDeduccion.abs(),
              stockAntes,
              stockDespues,
              referencia: locked.folio,
              notas: `Edición de detalle bitácora ${locked.folio}`
            }
          })
        }
      }

      await tx.detalleBitacora.update({
        where: { id: detalleLocked.id },
        data: {
          cantidad: cantNueva,
          precioUnitario: precioNuevoLocked,
          subtotal: subtotalNuevoLocked,
          inventarioDescontado,
          ...trabData
        }
      })
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data: {
          totalMateriales: { increment: diferenciaLocked },
          saldoPendiente: { increment: diferenciaLocked }
        }
      })
      if (locked.clienteId && diferenciaLocked !== 0) {
        const whereCliente = { id: locked.clienteId, empresaId }
        if (diferenciaLocked < 0) whereCliente.saldoPendiente = { gte: Math.abs(diferenciaLocked) }
        const actualizado = await tx.cliente.updateMany({
          where: whereCliente,
          data: { saldoPendiente: { increment: diferenciaLocked } }
        })
        if (actualizado.count !== 1) throw errorNegocio(409, 'INCONSISTENCIA_SALDO_CLIENTE', 'El saldo del cliente no permite aplicar el cambio')
      }
      return { diferencia: diferenciaLocked, stockInsuficiente: insuficiente, stockActual }
    })

    await audit(usuarioId, sucursalId, 'EDITAR_DETALLE_BITACORA', `${bitacora.folio} — ${detalle.Producto?.nombre || 'Sin nombre'} (Δ$${resultadoEdicion.diferencia.toFixed(2)})`, empresaId)

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({
      success: true,
      data:    bitacoraActualizada,
      stockInsuficiente: resultadoEdicion.stockInsuficiente,
      stockActual: resultadoEdicion.stockActual,
      mensaje: resultadoEdicion.stockInsuficiente
        ? `⚠️ Cambio aplicado sin descontar inventario: stock insuficiente (disponible: ${resultadoEdicion.stockActual})`
        : 'Cambio guardado correctamente'
    })
  } catch (err) {
    return responderError(req, res, err, 'No fue posible editar el detalle de la bitácora. Intenta nuevamente.')
  }
}

// ════════════════════════════════════════════════════════════════════
//  DELETE /bitacoras/:id/productos/:detalleId
//  Quitar producto de bitácora MANUAL y reintegrar inventario.
// ════════════════════════════════════════════════════════════════════
const quitarProducto = async (req, res) => {
  try {
    const { id, detalleId } = req.params
    const { id: usuarioId } = req.usuario
    // P0-BRANCH-ISOLATION: la sucursal operativa viene del contexto, nunca del fallback a 1.
    const sucursalId = resolverSucursalId(req)
    if (!sucursalId) {
      return res.status(400).json({ success: false, error: 'Se requiere contexto de sucursal para operar la bitácora', codigo: 'BRANCH_CONTEXT_REQUIRED' })
    }
    const empresaId = getEmpresaId(req)

    const bitacora = await prisma.bitacora.findFirst({
      where: { id: parseInt(id), empresaId },
      select: { id: true, empresaId: true, folio: true, estado: true, origen: true, totalMateriales: true, saldoPendiente: true, totalAbonado: true, descuentoMonto: true, clienteId: true }
    })
    if (!bitacora)                     return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.origen !== 'MANUAL')  return res.status(403).json({ success: false, error: 'Solo se pueden quitar productos de bitácoras MANUAL', codigo: 'ORIGEN_INCORRECTO' })
    if (bitacora.estado !== 'ABIERTA') return res.status(400).json({ success: false, error: `No se pueden quitar productos en estado ${bitacora.estado}` })

    const detalle = await prisma.detalleBitacora.findUnique({
      where: { id: parseInt(detalleId) },
      select: { id: true, bitacoraId: true, productoId: true, cantidad: true, subtotal: true, inventarioDescontado: true, Producto: { select: { nombre: true } } }
    })
    if (!detalle || detalle.bitacoraId !== parseInt(id)) {
      return res.status(404).json({ success: false, error: 'Detalle no encontrado en esta bitácora' })
    }

    // Validar que no se quite más de lo que queda por abonar
    const subtotalDetalle = parseFloat(detalle.subtotal)
    const totalAbonado    = parseFloat(bitacora.totalAbonado)
    const nuevoTotal      = parseFloat(bitacora.totalMateriales) - subtotalDetalle
    const descuentoMonto  = parseFloat(bitacora.descuentoMonto || 0)
    const nuevoSubtotalNeto = parseFloat((nuevoTotal - descuentoMonto).toFixed(2))
    if (nuevoSubtotalNeto < totalAbonado - 0.005) {
      return res.status(400).json({
        success: false,
        error: `No se puede quitar: el monto ya abonado ($${totalAbonado.toFixed(2)}) excedería el subtotal con descuento restante ($${nuevoSubtotalNeto.toFixed(2)}). Registra devolución de abono primero.`,
        codigo: 'ABONO_EXCEDE'
      })
    }

    const resultadoQuitar = await prisma.$transaction(async tx => {
      const locked = await bloquearBitacora(tx, parseInt(id), empresaId)
      if (!locked) throw errorNegocio(404, 'BITACORA_NO_ENCONTRADA', 'Bitácora no encontrada')
      validarBitacoraManualEditable(locked, sucursalId)

      const detalleLocked = await tx.detalleBitacora.findFirst({
        where: { id: parseInt(detalleId), bitacoraId: parseInt(id) },
        select: { id: true, productoId: true, cantidad: true, subtotal: true, inventarioDescontado: true }
      })
      if (!detalleLocked) throw errorNegocio(404, 'DETALLE_NO_ENCONTRADO', 'Detalle no encontrado en esta bitácora')

      const subtotal = new Decimal(detalleLocked.subtotal)
      const nuevoTotalLocked = new Decimal(locked.totalMateriales).minus(subtotal)
      const nuevoSaldoLocked = new Decimal(locked.saldoPendiente).minus(subtotal)
      if (nuevoTotalLocked.minus(locked.descuentoMonto || 0).lessThan(new Decimal(locked.totalAbonado).minus('0.005'))) {
        throw errorNegocio(409, 'ABONO_EXCEDE', 'No se puede quitar el detalle porque dejaría los abonos por encima del total')
      }
      if (nuevoSaldoLocked.isNegative()) {
        throw errorNegocio(409, 'INCONSISTENCIA_SALDO_BITACORA', 'El saldo de la bitácora no permite quitar este detalle')
      }

      if (detalleLocked.productoId) {
        if (!detalleLocked.inventarioDescontado) {
          const detallesProducto = await tx.detalleBitacora.findMany({
            where: { bitacoraId: parseInt(id), productoId: detalleLocked.productoId },
            select: { cantidad: true, inventarioDescontado: true }
          })
          const marcado = detallesProducto.reduce(
            (total, item) => item.inventarioDescontado ? total.plus(item.cantidad) : total,
            new Decimal(0)
          )
          const movimientos = await tx.movimientoInventario.findMany({
            where: {
              empresaId,
              sucursalId,
              productoId: detalleLocked.productoId,
              referencia: locked.folio,
              tipo: { in: ['SALIDA_BITACORA', 'DEVOLUCION_ENTRADA'] }
            },
            select: { tipo: true, cantidad: true }
          })
          const neto = movimientos.reduce(
            (total, mov) => total.plus(new Decimal(mov.cantidad).times(mov.tipo === 'SALIDA_BITACORA' ? 1 : -1)),
            new Decimal(0)
          )
          if (!neto.equals(marcado)) {
            throw errorNegocio(409, 'INVENTARIO_DEVOLUCION_AMBIGUA', 'El historial no permite determinar cuánto inventario corresponde a este detalle')
          }
        } else {
          const inv = await bloquearInventarioOpcional(tx, sucursalId, detalleLocked.productoId)
          if (!inv) throw errorNegocio(409, 'INVENTARIO_FALTANTE', 'Falta el inventario que debe recibir el reintegro')
          const stockAntes = new Decimal(inv.stockActual)
          const cantReintegrar = new Decimal(detalleLocked.cantidad)
          const stockDespues = stockAntes.plus(cantReintegrar)
          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: detalleLocked.productoId, sucursalId } },
            data: { stockActual: stockDespues }
          })
          await tx.movimientoInventario.create({
            data: {
              empresaId,
              productoId: detalleLocked.productoId,
              sucursalId,
              usuarioId,
              tipo: 'DEVOLUCION_ENTRADA',
              cantidad: cantReintegrar,
              stockAntes,
              stockDespues,
              referencia: locked.folio,
              notas: `Reintegro por quitar producto de bitácora ${locked.folio}`
            }
          })
        }
      }

      await tx.detalleBitacora.delete({ where: { id: detalleLocked.id } })
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data: { totalMateriales: { decrement: subtotal }, saldoPendiente: { decrement: subtotal } }
      })
      if (locked.clienteId && subtotal.greaterThan(0)) {
        const actualizado = await tx.cliente.updateMany({
          where: { id: locked.clienteId, empresaId, saldoPendiente: { gte: subtotal } },
          data: { saldoPendiente: { decrement: subtotal } }
        })
        if (actualizado.count !== 1) throw errorNegocio(409, 'INCONSISTENCIA_SALDO_CLIENTE', 'El saldo del cliente no permite quitar el detalle')
      }
      return { subtotal: subtotal.toNumber() }
    })

    await audit(usuarioId, sucursalId, 'QUITAR_PRODUCTO_BITACORA', `${bitacora.folio} — ${detalle.Producto?.nombre || 'Sin nombre'} - $${resultadoQuitar.subtotal.toFixed(2)}`, empresaId)

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({ success: true, data: bitacoraActualizada, mensaje: 'Producto eliminado y stock reintegrado' })
  } catch (err) {
    return responderError(req, res, err, 'No fue posible eliminar el detalle de la bitácora. Intenta nuevamente.')
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/abonos — Registrar abono
//  VENTA y MANUAL → exigen turno, crean MovimientoCaja (afecta corte)
//  Cierre automático si saldo llega a $0.
function esEstadoLiquidado(estado) {
  return ['CERRADA_VENTA', 'CERRADA_INTERNA'].includes(estado)
}

function resolverEstadoLiquidacion(origen) {
  if (origen === 'VENTA')  return 'CERRADA_VENTA'
  if (origen === 'MANUAL') return 'CERRADA_INTERNA'
  throw Object.assign(new Error(`Origen no soportado para liquidación: ${origen}`), { status: 409, codigo: 'ORIGEN_NO_LIQUIDABLE' })
}

// ════════════════════════════════════════════════════════════════════
const registrarAbono = async (req, res) => {
  try {
    const bitacoraId = parseInt(req.params.id)
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(bitacoraId)) {
      return res.status(400).json({ success: false, error: 'ID de bitácora inválido' })
    }

    const { metodoPago, notas } = req.body
    const empresaId = getEmpresaId(req)
    const usuarioId = req.usuario.id
    const { rol } = req.usuario
    // P0-BRANCH-ISOLATION: la sucursal operativa viene del contexto (requerida para escribir).
    const sucursalOperativa = resolverSucursalId(req)
    if (!sucursalOperativa) {
      return res.status(400).json({ success: false, error: 'Se requiere contexto de sucursal para registrar el abono', codigo: 'BRANCH_CONTEXT_REQUIRED' })
    }
    // Para roles con sucursal fija, se valida contra la bitácora después del FOR UPDATE

    const METODOS_VALIDOS = ['EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA']
    if (!metodoPago || !METODOS_VALIDOS.includes(metodoPago)) {
      return res.status(400).json({ success: false, error: `Método no soportado: ${metodoPago || '(vacío)'}`, codigo: 'METODO_INVALIDO', metodosPermitidos: METODOS_VALIDOS })
    }

    const montoResult = validarMontoDecimal(req.body.monto)
    if (montoResult.error) {
      return res.status(400).json({ success: false, error: montoResult.error, codigo: 'MONTO_INVALIDO' })
    }
    const monto = montoResult.valor
    if (monto.lte(0)) {
      return res.status(400).json({ success: false, error: 'El monto debe ser mayor a $0', codigo: 'MONTO_CERO' })
    }

    const idempotencyKey = req.headers['idempotency-key']
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 64 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return res.status(400).json({ success: false, error: 'Idempotency-Key requerido (UUID v4)', codigo: 'IDEMPOTENCY_KEY_REQUERIDO' })
    }

    let resultado
    try {
      resultado = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw`
          SELECT id, "empresaId", "sucursalId", folio, estado, origen,
                 "totalMateriales", "totalAbonado", "saldoPendiente",
                 "descuentoMonto", "clienteId"
          FROM "Bitacora"
          WHERE id = ${bitacoraId}
            AND "empresaId" = ${empresaId}
            AND "sucursalId" = ${sucursalOperativa}
          FOR UPDATE`
        if (rows.length === 0) {
          throw Object.assign(new Error('Bitácora no encontrada'), { status: 404 })
        }
        const bit = rows[0]

        const existente = await tx.abonoBitacora.findUnique({
          where: { empresaId_idempotencyKey: { empresaId, idempotencyKey } },
          select: {
            id: true, monto: true, metodoPago: true, bitacoraId: true, turnoId: true,
            saldoAntesSnapshot: true, saldoDespuesSnapshot: true,
            estadoResultante: true, cerradaEnSnapshot: true,
            MovimientoCaja: { select: { id: true } }
          }
        })
        if (existente) {
          if (existente.bitacoraId !== bitacoraId) {
            throw Object.assign(new Error('Idempotency-Key reutilizada en otra bitácora'), { status: 409, codigo: 'KEY_BITACORA_DIFERENTE' })
          }
          const montoExistente = new Decimal(existente.monto)
          if (!montoExistente.equals(monto) || existente.metodoPago !== metodoPago) {
            throw Object.assign(new Error('Misma Idempotency-Key con payload diferente'), { status: 409, codigo: 'KEY_PAYLOAD_DIFERENTE' })
          }
          return {
            status: 200,
            body: {
              success: true,
              abonoId: existente.id,
              bitacoraId,
              montoAplicado: montoExistente.toFixed(2),
              saldoAnterior: existente.saldoAntesSnapshot ? new Decimal(existente.saldoAntesSnapshot).toFixed(2) : null,
              saldoPosterior: existente.saldoDespuesSnapshot ? new Decimal(existente.saldoDespuesSnapshot).toFixed(2) : null,
              liquidada: esEstadoLiquidado(existente.estadoResultante),
              estado: existente.estadoResultante,
              movimientoCajaId: existente.MovimientoCaja?.id ?? null,
              idempotencyKey,
              idempotent: true,
              mensaje: existente.estadoResultante === 'CERRADA_VENTA' ? 'Abono ya registrado — bitácora cerrada' : 'Abono ya registrado'
            }
          }
        }

        if (bit.estado !== 'ABIERTA') {
          throw Object.assign(new Error(`No se pueden registrar abonos en estado ${bit.estado}`), { status: 409, codigo: 'ESTADO_INVALIDO' })
        }

        const saldoPendiente = new Decimal(bit.saldoPendiente)
        if (monto.greaterThan(saldoPendiente)) {
          throw Object.assign(new Error(`Monto $${monto.toFixed(2)} excede saldo $${saldoPendiente.toFixed(2)}`), { status: 409, codigo: 'EXCEDE_SALDO' })
        }

        const turnos = await tx.turnoCaja.findMany({
          where: { sucursalId: bit.sucursalId, abierto: true, empresaId },
          select: { id: true },
          take: 2
        })
        if (turnos.length === 0) {
          throw Object.assign(new Error('No hay turno abierto en esta sucursal'), { status: 409, codigo: 'SIN_TURNO_ABIERTO' })
        }
        if (turnos.length > 1) {
          throw Object.assign(new Error('Múltiples turnos abiertos en la sucursal'), { status: 409, codigo: 'MULTIPLES_TURNOS_ABIERTOS' })
        }
        const turnoId = turnos[0].id

        const totalMateriales = new Decimal(bit.totalMateriales)
        const descuentoMonto = new Decimal(bit.descuentoMonto || 0)
        const totalAbonadoAntes = new Decimal(bit.totalAbonado)
        const saldoDespues = saldoPendiente.minus(monto)
        const totalAbonadoDespues = totalAbonadoAntes.plus(monto)

        const saldoTeorico = totalMateriales.minus(descuentoMonto).minus(totalAbonadoDespues)
        if (!saldoTeorico.equals(saldoDespues)) {
          throw Object.assign(new Error('Inconsistencia en saldo de bitácora detectada'), { status: 409, codigo: 'INCONSISTENCIA_SALDO_BITACORA' })
        }

        const cerrar = saldoDespues.equals(new Decimal('0.00'))
        const estadoCierre = cerrar ? resolverEstadoLiquidacion(bit.origen) : null

        const abono = await tx.abonoBitacora.create({
          data: {
            empresaId, bitacoraId, usuarioId, turnoId,
            monto, metodoPago, idempotencyKey, notas: notas || null,
            saldoAntesSnapshot: saldoPendiente,
            saldoDespuesSnapshot: saldoDespues,
            estadoResultante: cerrar ? estadoCierre : 'ABIERTA',
            cerradaEnSnapshot: cerrar ? new Date() : null
          }
        })

        const mc = await tx.movimientoCaja.create({
          data: {
            empresaId, turnoId, tipo: 'ABONO_BITACORA',
            monto, metodoPago, referencia: bit.folio,
            notas: `Abono a bitácora ${bit.folio}${cerrar ? ' (liquidación completa)' : ''}`,
            abonoBitacoraId: abono.id
          }
        })

        await tx.bitacora.update({
          where: { id: bitacoraId },
          data: {
            totalAbonado: totalAbonadoDespues,
            saldoPendiente: saldoDespues,
            ...(cerrar ? { estado: estadoCierre, cerradaEn: new Date() } : {})
          }
        })

        if (bit.clienteId) {
          const upd = await tx.cliente.updateMany({
            where: { id: bit.clienteId, empresaId, saldoPendiente: { gte: monto } },
            data: { saldoPendiente: { decrement: monto } }
          })
          if (upd.count !== 1) {
            throw Object.assign(new Error('Inconsistencia en saldo del cliente'), { status: 409, codigo: 'INCONSISTENCIA_SALDO_CLIENTE' })
          }
        }

        await tx.auditoria.create({
          data: {
            empresaId, usuarioId, sucursalId: bit.sucursalId,
            accion: cerrar ? 'ABONO_BITACORA_CIERRE' : 'ABONO_BITACORA',
            modulo: 'BITACORA',
            referencia: `${bit.folio} → abono #${abono.id}`,
            valorAntes: { saldoPendiente: saldoPendiente.toFixed(2), totalAbonado: totalAbonadoAntes.toFixed(2) },
            valorDespues: { abonoId: abono.id, monto: monto.toFixed(2), metodoPago, saldoPosterior: saldoDespues.toFixed(2), liquidada: cerrar }
          }
        })

        return {
          status: 201,
          body: {
            success: true,
            abonoId: abono.id,
            bitacoraId,
            montoAplicado: monto.toFixed(2),
            saldoAnterior: saldoPendiente.toFixed(2),
            saldoPosterior: saldoDespues.toFixed(2),
            liquidada: cerrar,
            estado: cerrar ? estadoCierre : 'ABIERTA',
            movimientoCajaId: mc.id,
            idempotencyKey,
            idempotent: false,
            mensaje: cerrar ? 'Abono registrado — bitácora cerrada automáticamente (saldo en $0)' : 'Abono registrado correctamente'
          }
        }
      })
    } catch (err) {
      if (err.code === 'P2002') {
        const target = err.meta?.target
        if (Array.isArray(target) && target.includes('idempotencyKey')) {
          const existente = await prisma.abonoBitacora.findUnique({
            where: { empresaId_idempotencyKey: { empresaId, idempotencyKey } },
            select: {
              id: true, monto: true, metodoPago: true, bitacoraId: true,
              saldoAntesSnapshot: true, saldoDespuesSnapshot: true,
              estadoResultante: true, cerradaEnSnapshot: true,
              MovimientoCaja: { select: { id: true } }
            }
          })
          if (existente && existente.bitacoraId === bitacoraId) {
            const montoExistente = new Decimal(existente.monto)
            if (montoExistente.equals(monto) && existente.metodoPago === metodoPago) {
              return res.status(200).json({
                success: true,
                abonoId: existente.id,
                bitacoraId,
                montoAplicado: montoExistente.toFixed(2),
                saldoAnterior: existente.saldoAntesSnapshot ? new Decimal(existente.saldoAntesSnapshot).toFixed(2) : null,
                saldoPosterior: existente.saldoDespuesSnapshot ? new Decimal(existente.saldoDespuesSnapshot).toFixed(2) : null,
                liquidada: esEstadoLiquidado(existente.estadoResultante),
                estado: existente.estadoResultante,
                movimientoCajaId: existente.MovimientoCaja?.id ?? null,
                idempotencyKey,
                idempotent: true,
                mensaje: existente.estadoResultante === 'CERRADA_VENTA' ? 'Abono ya registrado — bitácora cerrada' : 'Abono ya registrado'
              })
            }
          }
        }
      }
      if (err.status) {
        return res.status(err.status).json({ success: false, error: err.message, codigo: err.codigo || null })
      }
      throw err
    }

    return res.status(resultado.status).json(resultado.body)

  } catch (err) {
    console.error('❌ abono bitacora:', err)
    res.status(500).json({ success: false, error: 'No fue posible registrar el abono de la bitácora. Intenta nuevamente.' })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras/:id/contexto-cobranza
//  Devuelve datos para el POS en modo cobranza (solo origen VENTA)
// ════════════════════════════════════════════════════════════════════
const contextoCobranza = async (req, res) => {
  try {
    const bitacoraId = parseInt(req.params.id)
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(bitacoraId)) {
      return res.status(400).json({ success: false, error: 'ID de bitácora inválido' })
    }
    const empresaId = getEmpresaId(req)
    const { rol } = req.usuario
    const sucursalOperativa = resolverSucursalId(req)  // null para SUPERADMIN NONE
    // Para roles con sucursal fija, se valida contra la bitácora al cargar

    const bitacora = await prisma.bitacora.findUnique({
      where: { id: bitacoraId },
      select: {
        id: true, empresaId: true, sucursalId: true, folio: true, estado: true, origen: true,
        totalMateriales: true, totalAbonado: true, saldoPendiente: true, descuentoMonto: true,
        titulo: true, clienteId: true,
        Cliente: { select: { id: true, nombre: true } },
        DetalleBitacora: {
          select: {
            id: true, productoId: true, cantidad: true, precioUnitario: true, subtotal: true,
            unidadVentaSnapshot: true,
            Producto: { select: { id: true, nombre: true, esGranel: true, unidadVenta: true } }
          }
        }
      }
    })
    if (!bitacora) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (bitacora.empresaId !== empresaId) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (sucursalOperativa != null && bitacora.sucursalId !== sucursalOperativa) {
      return res.status(403).json({ success: false, error: 'Esta bitácora pertenece a otra sucursal', codigo: 'SUCURSAL_INCORRECTA' })
    }
    if (bitacora.estado !== 'ABIERTA') {
      return res.status(409).json({ success: false, error: `Bitácora en estado ${bitacora.estado}`, codigo: 'ESTADO_INVALIDO' })
    }
    const ORIGENES_COBRABLES_POS = ['VENTA', 'MANUAL']
    if (!ORIGENES_COBRABLES_POS.includes(bitacora.origen)) {
      return res.status(409).json({ success: false, error: `Origen ${bitacora.origen} no puede cobrarse en POS`, codigo: 'ORIGEN_NO_COBRABLE' })
    }

    const turnos = await prisma.turnoCaja.findMany({
      where: { sucursalId: sucursalOperativa, abierto: true, empresaId },
      select: { id: true },
      take: 2
    })
    if (turnos.length === 0) {
      return res.status(409).json({ success: false, error: 'No hay turno abierto en esta sucursal', codigo: 'SIN_TURNO_ABIERTO' })
    }

    const saldoPendiente = new Decimal(bitacora.saldoPendiente)
    const totalAbonado = new Decimal(bitacora.totalAbonado)
    const totalMateriales = new Decimal(bitacora.totalMateriales)
    const descuentoMonto = new Decimal(bitacora.descuentoMonto || 0)

    res.json({
      success: true,
      data: {
        id: bitacora.id,
        folio: bitacora.folio,
        estado: bitacora.estado,
        origen: bitacora.origen,
        titulo: bitacora.titulo,
        cliente: bitacora.Cliente ? { id: bitacora.Cliente.id, nombre: bitacora.Cliente.nombre } : null,
        totalMateriales: totalMateriales.toFixed(2),
        totalAbonado: totalAbonado.toFixed(2),
        descuentoMonto: descuentoMonto.toFixed(2),
        saldoPendiente: saldoPendiente.toFixed(2),
        productos: bitacora.DetalleBitacora.map(d => ({
          id: d.Producto?.id ?? d.productoId,
          nombre: d.Producto?.nombre || '—',
          cantidad: new Decimal(d.cantidad).toFixed(2),
          precioUnitario: new Decimal(d.precioUnitario).toFixed(2),
          subtotal: new Decimal(d.subtotal).toFixed(2),
          unidadVenta: d.unidadVentaSnapshot ?? d.Producto?.unidadVenta ?? ''
        }))
      }
    })
  } catch (err) {
    console.error('❌ contexto-cobranza:', err)
    res.status(500).json({ success: false, error: 'No fue posible actualizar la bitácora. Intenta nuevamente.' })
  }
}

module.exports = {
  listar,
  obtener,
  crear,
  editar,
  aplicarDescuento,
  cambiarEstado,
  eliminar,
  agregarProducto,
  agregarProductosBatch,
  editarDetalle,
  quitarProducto,
  registrarAbono,
  contextoCobranza
}
