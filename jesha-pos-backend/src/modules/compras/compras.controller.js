// ════════════════════════════════════════════════════════════════════
//  COMPRAS.CONTROLLER.JS
//  src/modules/compras/compras.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

async function generarFolio() {
  const d   = new Date()
  const str = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  const result = await prisma.$queryRaw`SELECT nextval('folio_compra_seq') as seq`
  const sec = String(Number(result[0].seq)).padStart(5, '0')
  return `OC-${str}-${sec}`
}

async function audit(usuarioId, sucursalId, accion, ref) {
  try { await prisma.auditoria.create({ data: { accion, modulo: 'compras', referencia: ref, usuarioId, sucursalId } }) }
  catch(e) { console.error('Audit:', e.message) }
}

const OC_SELECT = {
  id: true, folio: true, estado: true, pagada: true,
  totalEstimado: true, totalRecibido: true, totalPagado: true,
  notas: true, creadaEn: true, recibidaEn: true,
  proveedor: { select: { id: true, nombreOficial: true, alias: true, telefono: true, celular: true } },
  usuario:   { select: { id: true, nombre: true } },
  sucursal:  { select: { id: true, nombre: true } },
  detalles: {
    select: {
      id: true, cantidadPedida: true, cantidadRecibida: true,
      precioCosto: true, subtotalPedido: true, subtotalRecibido: true,
      producto: { select: { id: true, nombre: true, codigoInterno: true, unidadCompra: true, costo: true, costoPromedio: true } }
    }
  },
  abonos: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, monto: true, metodoPago: true, notas: true, creadoEn: true,
      usuario: { select: { id: true, nombre: true } }
    }
  }
}

// ── GET /compras ──
const listar = async (req, res) => {
  try {
    const { estado, proveedorId, pagada, buscar, page = 1, limit = 25 } = req.query
    const { sucursalId, rol } = req.usuario
    const where = {}

    if (rol !== 'SUPERADMIN' && sucursalId) where.sucursalId = sucursalId
    if (estado)      where.estado      = estado
    if (proveedorId) where.proveedorId = parseInt(proveedorId)
    if (pagada !== undefined) where.pagada = pagada === 'true'
    if (buscar) {
      where.OR = [
        { folio:     { contains: buscar, mode: 'insensitive' } },
        { proveedor: { nombreOficial: { contains: buscar, mode: 'insensitive' } } },
        { proveedor: { alias:         { contains: buscar, mode: 'insensitive' } } }
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [total, ordenes] = await Promise.all([
      prisma.ordenCompra.count({ where }),
      prisma.ordenCompra.findMany({ where, select: OC_SELECT, orderBy: { creadaEn: 'desc' }, skip, take: parseInt(limit) })
    ])
    res.json({ success: true, data: ordenes, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    console.error('❌ listar compras:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── GET /compras/:id ──
const obtener = async (req, res) => {
  try {
    const oc = await prisma.ordenCompra.findUnique({ where: { id: parseInt(req.params.id) }, select: OC_SELECT })
    if (!oc) return res.status(404).json({ success: false, error: 'Orden no encontrada' })
    res.json({ success: true, data: oc })
  } catch (err) { res.status(500).json({ success: false, error: err.message }) }
}

// ── POST /compras ──
const crear = async (req, res) => {
  try {
    const { proveedorId, detalles, notas } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.body.sucursalId) || 1

    if (!proveedorId) return res.status(400).json({ success: false, error: 'Proveedor requerido' })
    if (!detalles || detalles.length === 0)
      return res.status(400).json({ success: false, error: 'Agrega al menos un producto' })

    const roles = ['ADMIN_SUCURSAL','SUPERADMIN']
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { rol: true } })
    if (!roles.includes(usuario.rol))
      return res.status(403).json({ success: false, error: 'Sin permiso para crear compras' })

    const rows = detalles.map(d => {
      const costo    = parseFloat(d.precioCosto || 0)
      // FIX: parseFloat para soportar cantidades decimales (ej. 1.5 metros de alambre)
      const cantidad = parseFloat(d.cantidadPedida) || 1
      return {
        productoId:       parseInt(d.productoId),
        cantidadPedida:   cantidad,
        cantidadRecibida: 0,
        precioCosto:      costo,
        subtotalPedido:   parseFloat((costo * cantidad).toFixed(2)),
        subtotalRecibido: 0
      }
    })

    const totalEstimado = parseFloat(rows.reduce((s, r) => s + r.subtotalPedido, 0).toFixed(2))
    const folio = await generarFolio()

    const oc = await prisma.ordenCompra.create({
      data: { folio, sucursalId, proveedorId: parseInt(proveedorId), usuarioId, estado: 'ENVIADO',
              totalEstimado, notas: notas || null, detalles: { create: rows } },
      select: OC_SELECT
    })
    await audit(usuarioId, sucursalId, 'CREAR_COMPRA', folio)
    res.status(201).json({ success: true, data: oc })
  } catch (err) {
    console.error('❌ crear compra:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── PUT /compras/:id ── (solo antes de recibir)
const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { proveedorId, detalles, notas } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || parseInt(req.body.sucursalId) || 1

    const existente = await prisma.ordenCompra.findUnique({
      where:  { id: parseInt(id) },
      select: { id: true, folio: true, estado: true,
                detalles: { select: { id: true, productoId: true, cantidadRecibida: true } } }
    })
    if (!existente) return res.status(404).json({ success: false, error: 'Orden no encontrada' })
    if (!['ENVIADO','RECIBIDO_PARCIAL'].includes(existente.estado))
      return res.status(400).json({ success: false, error: 'Solo se puede editar en estado Pendiente o Recibido parcial' })

    const detallesConRecepcion = existente.detalles.filter(d => parseFloat(d.cantidadRecibida) > 0)
    const idsProtegidos        = new Set(detallesConRecepcion.map(d => d.productoId))

    const updateData = {}
    if (proveedorId !== undefined) updateData.proveedorId = parseInt(proveedorId)
    if (notas       !== undefined) updateData.notas       = notas

    if (detalles && detalles.length > 0) {
      const idsNuevos  = new Set(detalles.map(d => parseInt(d.productoId)))
      const eliminados = [...idsProtegidos].filter(pid => !idsNuevos.has(pid))

      if (eliminados.length > 0) {
        const nombresElim = await prisma.producto.findMany({
          where: { id: { in: eliminados } }, select: { nombre: true }
        })
        return res.status(400).json({
          success: false,
          error: `No puedes eliminar productos que ya tienen mercancía recibida: ${nombresElim.map(p => p.nombre).join(', ')}`
        })
      }

      const rows = detalles.map(d => {
        const costo    = parseFloat(d.precioCosto || 0)
        // FIX: parseFloat para soportar cantidades decimales
        const qty      = parseFloat(d.cantidadPedida) || 1
        const detExist = existente.detalles.find(e => e.productoId === parseInt(d.productoId))
        // FIX: parseFloat en cantidadRecibida que viene de Prisma como Decimal
        const cantRec  = parseFloat(detExist?.cantidadRecibida || 0)
        return {
          productoId:       parseInt(d.productoId),
          cantidadPedida:   qty,
          cantidadRecibida: cantRec,
          precioCosto:      costo,
          subtotalPedido:   parseFloat((costo * qty).toFixed(2)),
          subtotalRecibido: parseFloat((costo * cantRec).toFixed(2))
        }
      })
      updateData.totalEstimado = parseFloat(rows.reduce((s, r) => s + r.subtotalPedido, 0).toFixed(2))

      const oc = await prisma.$transaction(async tx => {
        await tx.detalleOrdenCompra.deleteMany({ where: { ordenCompraId: parseInt(id) } })
        return tx.ordenCompra.update({
          where: { id: parseInt(id) },
          data:  { ...updateData, detalles: { create: rows } },
          select: OC_SELECT
        })
      })
      await audit(usuarioId, sucursalId, 'EDITAR_COMPRA', existente.folio)
      return res.json({ success: true, data: oc })
    }

    const oc = await prisma.ordenCompra.update({ where: { id: parseInt(id) }, data: updateData, select: OC_SELECT })
    await audit(usuarioId, sucursalId, 'EDITAR_COMPRA', existente.folio)
    res.json({ success: true, data: oc })
  } catch (err) {
    console.error('❌ editar compra:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /compras/:id/recibir ── (recepción por producto)
const recibir = async (req, res) => {
  try {
    const { id }       = req.params
    const { detalles } = req.body  // [{ detalleId, cantidadRecibida, precioVenta? }]
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || 1

    if (!detalles || detalles.length === 0)
      return res.status(400).json({ success: false, error: 'Detalles de recepción requeridos' })

    const oc = await prisma.ordenCompra.findUnique({
      where:  { id: parseInt(id) },
      select: {
        id: true, folio: true, estado: true, sucursalId: true, proveedorId: true,
        detalles: { select: { id: true, productoId: true, cantidadPedida: true, cantidadRecibida: true, precioCosto: true } }
      }
    })
    if (!oc)                         return res.status(404).json({ success: false, error: 'Orden no encontrada' })
    if (oc.estado === 'CANCELADO')   return res.status(400).json({ success: false, error: 'Orden cancelada' })
    if (oc.estado === 'RECIBIDO')    return res.status(400).json({ success: false, error: 'Orden ya recibida completamente' })

    const roles = ['ADMIN_SUCURSAL','SUPERADMIN']
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { rol: true } })
    if (!roles.includes(usuario.rol))
      return res.status(403).json({ success: false, error: 'Sin permiso para recibir mercancía' })

    let totalRecibidoNuevo = 0

    await prisma.$transaction(async tx => {
      for (const item of detalles) {
        const detalle = oc.detalles.find(d => d.id === parseInt(item.detalleId))
        if (!detalle) continue

        // FIX: parseFloat para soportar recepciones parciales decimales (ej. 0.5 kg)
        const cantNueva = parseFloat(item.cantidadRecibida) || 0
        if (cantNueva <= 0) continue

        // FIX: parseFloat en cantidadRecibida que viene de Prisma como tipo Decimal
        const cantYaRecibida    = parseFloat(detalle.cantidadRecibida)
        const cantTotalRecibida = parseFloat((cantYaRecibida + cantNueva).toFixed(3))
        const costoUnit         = parseFloat(detalle.precioCosto)

        const subtotalNuevo = parseFloat((costoUnit * cantNueva).toFixed(2))
        totalRecibidoNuevo += subtotalNuevo

        // Actualizar detalle — acumular cantidades
        await tx.detalleOrdenCompra.update({
          where: { id: detalle.id },
          data:  {
            cantidadRecibida: cantTotalRecibida,
            subtotalRecibido: parseFloat((costoUnit * cantTotalRecibida).toFixed(2))
          }
        })

        // Actualizar stock
        const inv = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: oc.sucursalId } }
        })

        if (inv) {
          const stockAntes   = parseFloat(inv.stockActual)
          const stockDespues = parseFloat((stockAntes + cantNueva).toFixed(3))

          // Calcular costo promedio ponderado
          const costoActual        = parseFloat((await tx.producto.findUnique({ where: { id: detalle.productoId }, select: { costoPromedio: true } }))?.costoPromedio || costoUnit)
          const nuevoCostoPromedio = stockAntes + cantNueva > 0
            ? parseFloat(((stockAntes * costoActual + cantNueva * costoUnit) / (stockAntes + cantNueva)).toFixed(4))
            : costoUnit

          await tx.inventarioSucursal.update({
            where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: oc.sucursalId } },
            data:  { stockActual: stockDespues }
          })

          const nuevoPrecioVenta = item.precioVenta ? parseFloat(item.precioVenta) : undefined
          await tx.producto.update({
            where: { id: detalle.productoId },
            data:  {
              costo:         costoUnit,
              costoPromedio: nuevoCostoPromedio,
              ...(nuevoPrecioVenta && nuevoPrecioVenta > 0 ? { precioVenta: nuevoPrecioVenta } : {})
            }
          })

          // Actualizar precioCosto en ProveedorProducto (precio vigente por proveedor)
          await tx.proveedorProducto.updateMany({
            where: { proveedorId: oc.proveedorId, productoId: detalle.productoId },
            data:  { precioCosto: costoUnit }
          })

          await tx.movimientoInventario.create({
            data: {
              productoId:   detalle.productoId,
              sucursalId:   oc.sucursalId,
              usuarioId,
              tipo:         'ENTRADA_COMPRA',
              cantidad:     cantNueva,
              stockAntes,
              stockDespues,
              referencia:   oc.folio
            }
          })
        }
      }

      // Determinar nuevo estado comparando con cantidadPedida
      // FIX: parseFloat en ambos lados de la comparación
      const totalRecibMap = Object.fromEntries(
        detalles.map(d => [d.detalleId, parseFloat(d.cantidadRecibida) || 0])
      )
      const todoCompleto = oc.detalles.every(d => {
        const yaRecibido = parseFloat(d.cantidadRecibida)
        const nuevaRec   = totalRecibMap[d.id] || 0
        return (yaRecibido + nuevaRec) >= parseFloat(d.cantidadPedida)
      })
      const nuevoEstado = todoCompleto ? 'RECIBIDO' : 'RECIBIDO_PARCIAL'

      const ocConTotal = await tx.ordenCompra.findUnique({ where: { id: parseInt(id) }, select: { totalRecibido: true } })
      const totalRecibidoAcumulado = parseFloat((parseFloat(ocConTotal.totalRecibido || 0) + totalRecibidoNuevo).toFixed(2))

      await tx.ordenCompra.update({
        where: { id: parseInt(id) },
        data:  { estado: nuevoEstado, totalRecibido: totalRecibidoAcumulado, recibidaEn: new Date() }
      })
    })

    await audit(usuarioId, sucursalId, 'RECIBIR_COMPRA', oc.folio)
    const ocActualizada = await prisma.ordenCompra.findUnique({ where: { id: parseInt(id) }, select: OC_SELECT })
    res.json({ success: true, data: ocActualizada })
  } catch (err) {
    console.error('❌ recibir compra:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /compras/:id/abonos ──
const registrarAbono = async (req, res) => {
  try {
    const { id }                        = req.params
    const { monto, metodoPago, notas }  = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || 1

    if (!monto || parseFloat(monto) <= 0)
      return res.status(400).json({ success: false, error: 'Monto debe ser mayor a 0' })

    const oc = await prisma.ordenCompra.findUnique({ where: { id: parseInt(id) }, select: { id: true, folio: true, totalPagado: true, totalEstimado: true } })
    if (!oc) return res.status(404).json({ success: false, error: 'Orden no encontrada' })

    const montoAbono = parseFloat(parseFloat(monto).toFixed(2))
    const nuevoTotal = parseFloat((parseFloat(oc.totalPagado) + montoAbono).toFixed(2))
    const pagada     = nuevoTotal >= parseFloat(oc.totalEstimado)

    await prisma.$transaction(async tx => {
      await tx.abonoCompra.create({
        data: { ordenCompraId: parseInt(id), usuarioId, monto: montoAbono, metodoPago: metodoPago || 'EFECTIVO', notas: notas || null }
      })
      await tx.ordenCompra.update({
        where: { id: parseInt(id) },
        data:  { totalPagado: nuevoTotal, pagada }
      })
    })

    await audit(usuarioId, sucursalId, 'ABONO_COMPRA', `${oc.folio} +$${montoAbono}`)
    const ocActualizada = await prisma.ordenCompra.findUnique({ where: { id: parseInt(id) }, select: OC_SELECT })
    res.json({ success: true, data: ocActualizada })
  } catch (err) {
    console.error('❌ abono compra:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ── PATCH /compras/:id/cancelar ──
const cancelar = async (req, res) => {
  try {
    const { id } = req.params
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || 1

    const oc = await prisma.ordenCompra.findUnique({ where: { id: parseInt(id) }, select: { id: true, folio: true, estado: true } })
    if (!oc) return res.status(404).json({ success: false, error: 'Orden no encontrada' })
    if (!['ENVIADO','RECIBIDO_PARCIAL'].includes(oc.estado))
      return res.status(400).json({ success: false, error: 'Solo se puede cancelar antes de recibir completamente' })

    const ocActualizada = await prisma.ordenCompra.update({ where: { id: parseInt(id) }, data: { estado: 'CANCELADO' }, select: OC_SELECT })
    await audit(usuarioId, sucursalId, 'CANCELAR_COMPRA', oc.folio)
    res.json({ success: true, data: ocActualizada })
  } catch (err) { res.status(500).json({ success: false, error: err.message }) }
}

// ── GET /compras/proveedores ──
const listarProveedores = async (req, res) => {
  try {
    const { buscar } = req.query
    const where = { activo: true }
    if (buscar) {
      where.OR = [
        { nombreOficial: { contains: buscar, mode: 'insensitive' } },
        { alias:         { contains: buscar, mode: 'insensitive' } }
      ]
    }
    const proveedores = await prisma.proveedor.findMany({ where, orderBy: { nombreOficial: 'asc' }, take: 50 })
    res.json({ success: true, data: proveedores })
  } catch (err) { res.status(500).json({ success: false, error: err.message }) }
}

// ── POST /compras/proveedores ──
const crearProveedor = async (req, res) => {
  try {
    const { nombreOficial, alias, telefono, celular, email } = req.body
    if (!nombreOficial?.trim()) return res.status(400).json({ success: false, error: 'Nombre oficial requerido' })

    const proveedor = await prisma.proveedor.create({
      data: { nombreOficial: nombreOficial.trim(), alias: alias?.trim() || null, telefono: telefono || null, celular: celular || null, email: email || null }
    })
    res.status(201).json({ success: true, data: proveedor })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'Ya existe un proveedor con ese nombre o alias' })
    res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = { listar, obtener, crear, editar, recibir, registrarAbono, cancelar, listarProveedores, crearProveedor }