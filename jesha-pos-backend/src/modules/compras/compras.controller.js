// ════════════════════════════════════════════════════════════════════
//  COMPRAS.CONTROLLER.JS
//  src/modules/compras/compras.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { FACTOR_IVA } = require('../../utils/constantes')

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
  Proveedor: { select: { id: true, nombreOficial: true, alias: true, telefono: true, celular: true } },
  Usuario:   { select: { id: true, nombre: true } },
  Sucursal:  { select: { id: true, nombre: true } },
  DetalleOrdenCompra: {
    select: {
      id: true, cantidadPedida: true, cantidadRecibida: true,
      precioCosto: true, subtotalPedido: true, subtotalRecibido: true,
      costoAnterior: true, precioVentaAnterior: true, precioVentaNuevo: true, facturaDesglosada: true,
        Producto: { select: { id: true, nombre: true, codigoInterno: true, codigoBarras: true, unidadCompra: true, costo: true, costoPromedio: true, precioVenta: true, precioBase: true, esGranel: true, tipoFacturaProv: true, costoSinIvaProveedor: true, ProveedorProducto: { select: { proveedorId: true, codigoProveedor: true } } } }
    }
  },
  AbonoCompra: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, monto: true, metodoPago: true, notas: true, creadoEn: true,
      Usuario: { select: { id: true, nombre: true } }
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
        { folio:    { contains: buscar, mode: 'insensitive' } },
        { Proveedor: { nombreOficial: { contains: buscar, mode: 'insensitive' } } },
        { Proveedor: { alias:         { contains: buscar, mode: 'insensitive' } } }
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

    // Validar que todos los productos estén activos
    const productoIds = rows.map(r => r.productoId)
    const productosActivos = await prisma.producto.findMany({
      where: { id: { in: productoIds }, activo: true },
      select: { id: true }
    })
    const inactivos = productoIds.filter(id => !productosActivos.find(p => p.id === id))
    if (inactivos.length > 0) {
      return res.status(400).json({
        success: false,
        error: `No se puede crear la orden: los productos ${inactivos.join(', ')} están inactivos.`
      })
    }

    const empresaId = getEmpresaId(req)

    const oc = await prisma.ordenCompra.create({
      data: { empresaId, folio, sucursalId, proveedorId: parseInt(proveedorId), usuarioId, estado: 'ENVIADO',
              totalEstimado, notas: notas || null, DetalleOrdenCompra: { create: rows } },
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
                DetalleOrdenCompra: { select: { id: true, productoId: true, cantidadRecibida: true } } }
    })
    if (!existente) return res.status(404).json({ success: false, error: 'Orden no encontrada' })
    if (!['ENVIADO','RECIBIDO_PARCIAL'].includes(existente.estado))
      return res.status(400).json({ success: false, error: 'Solo se puede editar en estado Pendiente o Recibido parcial' })

    const detallesConRecepcion = existente.DetalleOrdenCompra.filter(d => parseFloat(d.cantidadRecibida) > 0)
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
        const qty      = parseFloat(d.cantidadPedida) || 1
        const detExist = existente.DetalleOrdenCompra.find(e => e.productoId === parseInt(d.productoId))
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
        // TODO: migrar a upsert por detalle cuando se agregue trazabilidad por detalleId — actualmente deleteMany+create cambia los IDs de DetalleOrdenCompra
        await tx.detalleOrdenCompra.deleteMany({ where: { ordenCompraId: parseInt(id) } })
        return tx.ordenCompra.update({
          where: { id: parseInt(id) },
          data:  { ...updateData, DetalleOrdenCompra: { create: rows } },
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
    const { detalles } = req.body
    const { id: usuarioId, sucursalId: sucursalIdToken } = req.usuario
    const sucursalId = sucursalIdToken || 1
    const empresaId = getEmpresaId(req)

    if (!detalles || detalles.length === 0)
      return res.status(400).json({ success: false, error: 'Detalles de recepción requeridos' })

    const oc = await prisma.ordenCompra.findUnique({
      where:  { id: parseInt(id) },
      select: {
        id: true, folio: true, estado: true, sucursalId: true, proveedorId: true,
        DetalleOrdenCompra: { select: { id: true, productoId: true, cantidadPedida: true, cantidadRecibida: true, precioCosto: true } }
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
        const detalle = oc.DetalleOrdenCompra.find(d => d.id === parseInt(item.detalleId))
        if (!detalle) continue

        const cantNueva = parseFloat(item.cantidadRecibida) || 0
        if (cantNueva <= 0) continue

        const cantYaRecibida    = parseFloat(detalle.cantidadRecibida)
        const cantTotalRecibida = parseFloat((cantYaRecibida + cantNueva).toFixed(3))
        const costoUnit = (item.precioCosto != null && parseFloat(item.precioCosto) > 0)
          ? parseFloat(item.precioCosto)
          : parseFloat(detalle.precioCosto)

        const subtotalNuevo = parseFloat((costoUnit * cantNueva).toFixed(2))
        totalRecibidoNuevo += subtotalNuevo

        // Foto del producto ANTES de actualizarlo (auditoría) — se reutiliza para el costo promedio
        const prodAntes = await tx.producto.findUnique({
          where: { id: detalle.productoId },
          select: { costo: true, precioVenta: true, costoPromedio: true }
        })
        const costoAnterior       = prodAntes?.costo != null ? parseFloat(prodAntes.costo) : null
        const precioVentaAnterior = prodAntes?.precioVenta != null ? parseFloat(prodAntes.precioVenta) : null
        const precioVentaNuevo    = (item.precioVenta != null && parseFloat(item.precioVenta) > 0)
          ? parseFloat(item.precioVenta) : null

        // Actualizar detalle — cantidades, costo corregido y snapshot de auditoría
        await tx.detalleOrdenCompra.update({
          where: { id: detalle.id },
          data:  {
            precioCosto:      costoUnit,
            cantidadRecibida: cantTotalRecibida,
            subtotalPedido:   parseFloat((costoUnit * parseFloat(detalle.cantidadPedida)).toFixed(2)),
            subtotalRecibido: parseFloat((costoUnit * cantTotalRecibida).toFixed(2)),
            costoAnterior,
            precioVentaAnterior,
            precioVentaNuevo,
            facturaDesglosada: item.tipoFacturaProv === 'DESGLOSE'
          }
        })

        // Upsert inventario — crea registro si no existe (InventarioSucursal NO tiene empresaId)
        const inv = await tx.inventarioSucursal.upsert({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: oc.sucursalId } },
          update: {},
          create: { productoId: detalle.productoId, sucursalId: oc.sucursalId, stockActual: 0 }
        })

        const stockAntes   = parseFloat(inv.stockActual)
        const stockDespues = parseFloat((stockAntes + cantNueva).toFixed(3))

        // Calcular costo promedio ponderado (reusa prodAntes)
        const costoActual        = parseFloat(prodAntes?.costoPromedio ?? costoUnit)
        const nuevoCostoPromedio = stockAntes + cantNueva > 0
          ? parseFloat(((stockAntes * costoActual + cantNueva * costoUnit) / (stockAntes + cantNueva)).toFixed(4))
          : costoUnit

        await tx.inventarioSucursal.update({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: oc.sucursalId } },
          data:  { stockActual: stockDespues }
        })

        const nuevoPrecioVenta = item.precioVenta ? parseFloat(item.precioVenta) : undefined
        const tipoMapeado = item.tipoFacturaProv === 'DESGLOSE' ? 'DESGLOSE' : 'NETO'
        const costoSinIva = item.costoSinIvaProveedor != null ? parseFloat(item.costoSinIvaProveedor) : null
        await tx.producto.update({
          where: { id: detalle.productoId },
          data:  {
            costo:           costoUnit,
            costoPromedio:   nuevoCostoPromedio,
            tipoFacturaProv: tipoMapeado,
            ...(tipoMapeado === 'DESGLOSE' && costoSinIva && costoSinIva > 0 ? { costoSinIvaProveedor: costoSinIva } : {}),
            ...(tipoMapeado === 'NETO' ? { costoSinIvaProveedor: null } : {}),
            ...(nuevoPrecioVenta && nuevoPrecioVenta > 0 ? {
              precioVenta: nuevoPrecioVenta,
              precioBase:  parseFloat((nuevoPrecioVenta / FACTOR_IVA).toFixed(2)),
              margen:      costoUnit > 0 ? parseFloat(Math.min(((nuevoPrecioVenta / costoUnit - 1) * 100), 999.99).toFixed(2)) : null
            } : {})
          }
        })

        // ProveedorProducto NO tiene empresaId
        await tx.proveedorProducto.upsert({
          where: { proveedorId_productoId: { proveedorId: oc.proveedorId, productoId: detalle.productoId } },
          update: { precioCosto: costoUnit, activo: true },
          create: { proveedorId: oc.proveedorId, productoId: detalle.productoId, precioCosto: costoUnit, activo: true }
        })

        await tx.movimientoInventario.create({
          data: {
            empresaId,
            productoId:   detalle.productoId,
            sucursalId:   oc.sucursalId,
            usuarioId,
            tipo:         'ENTRADA_COMPRA',
            cantidad:     cantNueva,
            stockAntes,
            stockDespues,
            costoUnitario: costoUnit,
            referencia:   oc.folio
          }
        })
      }

      // Determinar nuevo estado
      const totalRecibMap = Object.fromEntries(
        detalles.map(d => [d.detalleId, parseFloat(d.cantidadRecibida) || 0])
      )
      const todoCompleto = oc.DetalleOrdenCompra.every(d => {
        const yaRecibido = parseFloat(d.cantidadRecibida)
        const nuevaRec   = totalRecibMap[d.id] || 0
        return (yaRecibido + nuevaRec) >= parseFloat(d.cantidadPedida)
      })
      const nuevoEstado = todoCompleto ? 'RECIBIDO' : 'RECIBIDO_PARCIAL'

      const ocConTotal = await tx.ordenCompra.findUnique({ where: { id: parseInt(id) }, select: { totalRecibido: true } })
      const totalRecibidoAcumulado = parseFloat((parseFloat(ocConTotal.totalRecibido || 0) + totalRecibidoNuevo).toFixed(2))

      const detallesActuales = await tx.detalleOrdenCompra.findMany({
        where: { ordenCompraId: parseInt(id) },
        select: { subtotalPedido: true }
      })
      const totalEstimadoNuevo = parseFloat(
        detallesActuales.reduce((s, d) => s + parseFloat(d.subtotalPedido), 0).toFixed(2)
      )

      await tx.ordenCompra.update({
        where: { id: parseInt(id) },
        data:  {
          estado:        nuevoEstado,
          totalRecibido: totalRecibidoAcumulado,
          totalEstimado: totalEstimadoNuevo,
          recibidaEn:    new Date()
        }
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
// FIX: Validación de saldo pendiente para evitar cobros excesivos
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

    const montoAbono     = parseFloat(parseFloat(monto).toFixed(2))
    const saldoPendiente = parseFloat((parseFloat(oc.totalEstimado) - parseFloat(oc.totalPagado)).toFixed(2))

    // FIX: Bloquear abonos que excedan el saldo pendiente
    if (montoAbono > saldoPendiente + 0.005) {
      return res.status(400).json({
        success: false,
        error: `Monto excede saldo pendiente. Saldo: $${saldoPendiente.toFixed(2)}, Intento: $${montoAbono.toFixed(2)}`,
        codigo: 'EXCEDE_SALDO',
        saldoPendiente
      })
    }

    const nuevoTotal = parseFloat((parseFloat(oc.totalPagado) + montoAbono).toFixed(2))
    const pagada     = nuevoTotal >= parseFloat(oc.totalEstimado) - 0.005

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

    const empresaId = getEmpresaId(req)
    const proveedor = await prisma.proveedor.create({
      data: { empresaId, nombreOficial: nombreOficial.trim(), alias: alias?.trim() || null, telefono: telefono || null, celular: celular || null, email: email || null }
    })
    res.status(201).json({ success: true, data: proveedor })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'Ya existe un proveedor con ese nombre o alias' })
    res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = { listar, obtener, crear, editar, recibir, registrarAbono, cancelar, listarProveedores, crearProveedor }
