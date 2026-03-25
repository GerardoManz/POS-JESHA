// ════════════════════════════════════════════════════════════════════
//  BITACORA.CONTROLLER.JS
//  src/modules/bitacora/bitacora.controller.js
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')

// ── Folio ──
async function generarFolio() {
  const d   = new Date()
  const str = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  const ultima = await prisma.bitacora.findFirst({
    where: { folio: { startsWith: `BIT-${str}` } }, orderBy: { id: 'desc' }, select: { folio: true }
  })
  const sec = ultima ? parseInt(ultima.folio.split('-').pop()) + 1 : 1
  return `BIT-${str}-${String(sec).padStart(5,'0')}`
}

async function audit(usuarioId, sucursalId, accion, ref) {
  try { await prisma.auditoria.create({ data: { accion, modulo: 'bitacora', referencia: ref, usuarioId, sucursalId } }) }
  catch(e) { console.error('Audit:', e.message) }
}

const BITACORA_SELECT = {
  id: true, folio: true, titulo: true, descripcion: true, estado: true,
  totalMateriales: true, totalAbonado: true, saldoPendiente: true,
  notas: true, creadaEn: true, actualizadoEn: true, ventaId: true,
  cliente:  { select: { id: true, nombre: true, telefono: true } },
  usuario:  { select: { id: true, nombre: true } },
  sucursal: { select: { id: true, nombre: true } },
  detalles: {
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, cantidad: true, precioUnitario: true, subtotal: true,
      inventarioDescontado: true, notas: true, creadoEn: true,
      producto: { select: { id: true, nombre: true, codigoInterno: true, unidadVenta: true } }
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

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras
// ════════════════════════════════════════════════════════════════════
const listar = async (req, res) => {
  try {
    const { estado, clienteId, buscar, page = 1, limit = 25 } = req.query
    const { sucursalId, rol } = req.usuario
    const where = {}

    if (rol !== 'SUPERADMIN' && sucursalId) where.sucursalId = sucursalId
    if (estado)    where.estado    = estado
    if (clienteId) where.clienteId = parseInt(clienteId)
    if (buscar) {
      where.OR = [
        { folio:   { contains: buscar, mode: 'insensitive' } },
        { titulo:  { contains: buscar, mode: 'insensitive' } },
        { cliente: { nombre: { contains: buscar, mode: 'insensitive' } } }
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [total, bitacoras] = await Promise.all([
      prisma.bitacora.count({ where }),
      prisma.bitacora.findMany({ where, select: BITACORA_SELECT, orderBy: { creadaEn: 'desc' }, skip, take: parseInt(limit) })
    ])
    res.json({ success: true, data: bitacoras, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    console.error('❌ listar bitacoras:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  GET /bitacoras/:id
// ════════════════════════════════════════════════════════════════════
const obtener = async (req, res) => {
  try {
    let b = await prisma.bitacora.findUnique({ where: { id: parseInt(req.params.id) }, select: BITACORA_SELECT })
    if (!b) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })

    // Auto-importar productos si la bitácora está vacía y viene de una venta a crédito
    if (b.ventaId && (!b.detalles || b.detalles.length === 0)) {
      try {
        const venta = await prisma.venta.findUnique({
          where: { id: b.ventaId },
          include: { detalles: true }
        })
        if (venta && venta.detalles.length > 0) {
          await prisma.$transaction(async tx => {
            let sumaSubtotales = 0;

            for (const d of venta.detalles) {
              const subtotalItem = parseFloat(d.subtotal);
              sumaSubtotales += subtotalItem;

              await tx.detalleBitacora.create({
                data: {
                  bitacoraId:           b.id,
                  productoId:           d.productoId,
                  cantidad:             d.cantidad,
                  precioUnitario:       parseFloat(d.precioUnitario),
                  subtotal:             subtotalItem,
                  inventarioDescontado: false,
                  notas:                'Importado automáticamente desde venta ' + venta.folio
                }
              })
            }

            // Actualizar totales de la bitácora
            await tx.bitacora.update({
              where: { id: b.id },
              data: {
                totalMateriales: sumaSubtotales,
                saldoPendiente: sumaSubtotales
              }
            });

            // Sumar deuda al cliente
            if (b.cliente?.id) {
              await tx.cliente.update({
                where: { id: b.cliente.id },
                data: {
                  saldoPendiente: { increment: sumaSubtotales }
                }
              });
            }
          })
          // Recargar con productos importados
          b = await prisma.bitacora.findUnique({ where: { id: parseInt(req.params.id) }, select: BITACORA_SELECT })
        }
      } catch(importErr) {
        console.warn('⚠️ No se pudo auto-importar productos a bitácora:', importErr.message)
      }
    }

    res.json({ success: true, data: b })
  } catch (err) { res.status(500).json({ success: false, error: err.message }) }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras — Crear bitácora
// ════════════════════════════════════════════════════════════════════
const crear = async (req, res) => {
  try {
    const { clienteId, titulo, descripcion, notas } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    if (!titulo?.trim()) return res.status(400).json({ success: false, error: 'El título es requerido' })

    const folio    = await generarFolio()
    const bitacora = await prisma.bitacora.create({
      data: { folio, titulo: titulo.trim(), descripcion: descripcion || null,
              clienteId: clienteId ? parseInt(clienteId) : null,
              sucursalId, usuarioId, notas: notas || null },
      select: BITACORA_SELECT
    })
    await audit(usuarioId, sucursalId, 'CREAR_BITACORA', folio)
    res.status(201).json({ success: true, data: bitacora })
  } catch (err) {
    console.error('❌ crear bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/productos — Agregar producto y descontar stock
// ════════════════════════════════════════════════════════════════════
const agregarProducto = async (req, res) => {
  try {
    const { id }                         = req.params
    const { productoId, cantidad, precioUnitario, notas } = req.body
    const { id: usuarioId, sucursalId }  = req.usuario

    if (!productoId || !cantidad || cantidad <= 0)
      return res.status(400).json({ success: false, error: 'productoId y cantidad > 0 son requeridos' })

    const bitacora = await prisma.bitacora.findUnique({ 
      where: { id: parseInt(id) }, 
      select: { id: true, folio: true, estado: true, totalMateriales: true, sucursalId: true, clienteId: true } 
    })
    if (!bitacora) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (!['ABIERTA'].includes(bitacora.estado))
      return res.status(400).json({ success: false, error: `No se pueden agregar productos en estado ${bitacora.estado}` })

    // Verificar stock
    const inventario = await prisma.inventarioSucursal.findUnique({
      where: { productoId_sucursalId: { productoId: parseInt(productoId), sucursalId: bitacora.sucursalId } }
    })
    if (!inventario || inventario.stockActual < parseInt(cantidad))
      return res.status(400).json({ success: false, error: `Stock insuficiente. Disponible: ${inventario?.stockActual || 0}` })

    const producto = await prisma.producto.findUnique({ where: { id: parseInt(productoId) }, select: { id: true, precioBase: true } })
    const precio   = parseFloat(precioUnitario ?? producto.precioBase)
    const qty      = parseInt(cantidad)
    const subtotal = parseFloat((precio * qty).toFixed(2))

    // Transacción: crear detalle + descontar inventario + actualizar totales
    const result = await prisma.$transaction(async tx => {
      const detalle = await tx.detalleBitacora.create({
        data: { bitacoraId: parseInt(id), productoId: parseInt(productoId), cantidad: qty,
                precioUnitario: precio, subtotal, inventarioDescontado: true, notas: notas || null }
      })

      const stockAntes    = inventario.stockActual
      const stockDespues  = stockAntes - qty
      await tx.inventarioSucursal.update({
        where: { productoId_sucursalId: { productoId: parseInt(productoId), sucursalId: bitacora.sucursalId } },
        data:  { stockActual: stockDespues }
      })

      await tx.movimientoInventario.create({
        data: { productoId: parseInt(productoId), sucursalId: bitacora.sucursalId, usuarioId,
                tipo: 'SALIDA_BITACORA', cantidad: qty, stockAntes, stockDespues, referencia: bitacora.folio }
      })

      const nuevoTotal = parseFloat((parseFloat(bitacora.totalMateriales) + subtotal).toFixed(2))
      const saldo      = await calcularSaldo(tx, parseInt(id), nuevoTotal)

      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data:  { totalMateriales: nuevoTotal, saldoPendiente: saldo }
      })

      // Actualizar crédito del cliente si la bitácora está vinculada a uno
      if (bitacora.clienteId) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data: { saldoPendiente: { increment: subtotal } }
        })
      }

      return detalle
    })

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({ success: true, data: bitacoraActualizada })
  } catch (err) {
    console.error('❌ agregar producto bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  DELETE /bitacoras/:id/productos/:detalleId — Quitar producto
// ════════════════════════════════════════════════════════════════════
const quitarProducto = async (req, res) => {
  try {
    const { id, detalleId }             = req.params
    const { id: usuarioId, sucursalId } = req.usuario

    const detalle  = await prisma.detalleBitacora.findUnique({ where: { id: parseInt(detalleId) } })
    if (!detalle)  return res.status(404).json({ success: false, error: 'Detalle no encontrado' })

    const bitacora = await prisma.bitacora.findUnique({ 
      where: { id: parseInt(id) }, 
      select: { id: true, folio: true, estado: true, totalMateriales: true, sucursalId: true, clienteId: true } 
    })
    if (!['ABIERTA'].includes(bitacora.estado))
      return res.status(400).json({ success: false, error: 'No se puede modificar en este estado' })

    await prisma.$transaction(async tx => {
      // Reintegrar stock
      if (detalle.inventarioDescontado) {
        const inv = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: bitacora.sucursalId } }
        })
        const stockAntes   = inv?.stockActual || 0
        const stockDespues = stockAntes + detalle.cantidad

        await tx.inventarioSucursal.update({
          where: { productoId_sucursalId: { productoId: detalle.productoId, sucursalId: bitacora.sucursalId } },
          data:  { stockActual: stockDespues }
        })
        await tx.movimientoInventario.create({
          data: { productoId: detalle.productoId, sucursalId: bitacora.sucursalId, usuarioId,
                  tipo: 'AJUSTE_POSITIVO', cantidad: detalle.cantidad, stockAntes, stockDespues, referencia: bitacora.folio, notas: 'Quitar de bitácora' }
        })
      }

      await tx.detalleBitacora.delete({ where: { id: parseInt(detalleId) } })

      const subtotalEliminado = parseFloat(detalle.subtotal)
      const nuevoTotal = parseFloat((parseFloat(bitacora.totalMateriales) - subtotalEliminado).toFixed(2))
      const saldo      = await calcularSaldo(tx, parseInt(id), Math.max(0, nuevoTotal))
      
      await tx.bitacora.update({ 
        where: { id: parseInt(id) }, 
        data: { totalMateriales: Math.max(0, nuevoTotal), saldoPendiente: saldo } 
      })

      // Restar del crédito del cliente si la bitácora está vinculada a uno
      if (bitacora.clienteId) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data: { saldoPendiente: { decrement: subtotalEliminado } }
        })
      }
    })

    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({ success: true, data: bitacoraActualizada })
  } catch (err) {
    console.error('❌ quitar producto bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  POST /bitacoras/:id/abonos — Registrar abono
// ════════════════════════════════════════════════════════════════════
const registrarAbono = async (req, res) => {
  try {
    const { id }                         = req.params
    const { monto, metodoPago, notas }   = req.body
    const { id: usuarioId, sucursalId }  = req.usuario

    if (!monto || parseFloat(monto) <= 0)
      return res.status(400).json({ success: false, error: 'El monto debe ser mayor a 0' })

    const bitacora = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: { id: true, folio: true, estado: true, totalAbonado: true, totalMateriales: true, clienteId: true } })
    if (!bitacora) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (!['ABIERTA'].includes(bitacora.estado))
      return res.status(400).json({ success: false, error: `No se pueden registrar abonos en estado ${bitacora.estado}` })

    const montoAbono    = parseFloat(parseFloat(monto).toFixed(2))
    const nuevoAbonado  = parseFloat((parseFloat(bitacora.totalAbonado) + montoAbono).toFixed(2))
    const nuevoSaldo    = parseFloat((parseFloat(bitacora.totalMateriales) - nuevoAbonado).toFixed(2))

    await prisma.$transaction(async tx => {
      await tx.abonoBitacora.create({
        data: { bitacoraId: parseInt(id), usuarioId, monto: montoAbono,
                metodoPago: metodoPago || 'EFECTIVO', notas: notas || null }
      })
      await tx.bitacora.update({
        where: { id: parseInt(id) },
        data:  { totalAbonado: nuevoAbonado, saldoPendiente: nuevoSaldo }
      })
      // Restar el abono del saldo pendiente del cliente si la bitácora está vinculada a un cliente
      if (bitacora.clienteId) {
        await tx.cliente.update({
          where: { id: bitacora.clienteId },
          data: {
            saldoPendiente: { decrement: montoAbono }
          }
        })
      }
    })

    await audit(usuarioId, sucursalId, 'ABONO_BITACORA', `${bitacora.folio} +$${montoAbono}`)
    const bitacoraActualizada = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: BITACORA_SELECT })
    res.json({ success: true, data: bitacoraActualizada })
  } catch (err) {
    console.error('❌ abono bitacora:', err)
    res.status(500).json({ success: false, error: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id/estado — Cambiar estado
// ════════════════════════════════════════════════════════════════════
const cambiarEstado = async (req, res) => {
  try {
    const { id }      = req.params
    const { estado }  = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    const validos = ['ABIERTA', 'CERRADA_VENTA', 'CERRADA_INTERNA']
    if (!validos.includes(estado)) return res.status(400).json({ success: false, error: `Estado inválido: ${estado}` })

    const existente = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: { id: true, folio: true, estado: true } })
    if (!existente) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })

    const b = await prisma.bitacora.update({ where: { id: parseInt(id) }, data: { estado }, select: BITACORA_SELECT })
    await audit(usuarioId, sucursalId, `ESTADO_BITACORA_${estado}`, existente.folio)
    res.json({ success: true, data: b })
  } catch (err) { res.status(500).json({ success: false, error: err.message }) }
}

// ════════════════════════════════════════════════════════════════════
//  PATCH /bitacoras/:id — Editar cabecera
// ════════════════════════════════════════════════════════════════════
const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { titulo, descripcion, clienteId, notas } = req.body
    const { id: usuarioId, sucursalId } = req.usuario

    const existente = await prisma.bitacora.findUnique({ where: { id: parseInt(id) }, select: { id: true, folio: true, estado: true } })
    if (!existente) return res.status(404).json({ success: false, error: 'Bitácora no encontrada' })
    if (['CERRADA_VENTA','CERRADA_INTERNA'].includes(existente.estado))
      return res.status(400).json({ success: false, error: 'No se puede editar una bitácora cerrada' })

    const data = {}
    if (titulo      !== undefined) data.titulo      = titulo.trim()
    if (descripcion !== undefined) data.descripcion = descripcion
    if (clienteId   !== undefined) data.clienteId   = clienteId ? parseInt(clienteId) : null
    if (notas       !== undefined) data.notas       = notas

    const b = await prisma.bitacora.update({ where: { id: parseInt(id) }, data, select: BITACORA_SELECT })
    await audit(usuarioId, sucursalId, 'EDITAR_BITACORA', existente.folio)
    res.json({ success: true, data: b })
  } catch (err) { res.status(500).json({ success: false, error: err.message }) }
}

// ── Helper: calcular saldo pendiente ──
async function calcularSaldo(tx, bitacoraId, totalMateriales) {
  const abonos = await tx.abonoBitacora.aggregate({
    where:  { bitacoraId },
    _sum:   { monto: true }
  })
  const totalAbonado = parseFloat(abonos._sum.monto || 0)
  return parseFloat((totalMateriales - totalAbonado).toFixed(2))
}

module.exports = { listar, obtener, crear, agregarProducto, quitarProducto, registrarAbono, cambiarEstado, editar }