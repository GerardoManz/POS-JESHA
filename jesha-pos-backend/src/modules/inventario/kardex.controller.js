// ════════════════════════════════════════════════════════════════════
//  KARDEX CONTROLLER
//  Ubicación: src/modules/inventario/kardex.controller.js
//  Ruta: GET /inventario/producto/:productoId/kardex
//  Lectura sola. Stock por movimiento. Sin transferencias.
//  Branch-aware: NONE/SELECTED/FIXED con contrato estricto.
// ════════════════════════════════════════════════════════════════════

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { resolverSucursalId } = require('../sucursal/sucursal.helper')
const { BRANCH_MODE, assertTenantRequestContext } = require('../../security/request-context')

const ENTRADAS = new Set([
  'ENTRADA_COMPRA',
  'AJUSTE_POSITIVO',
  'DEVOLUCION_ENTRADA',
  'CANCELACION_VENTA',
  'REINTEGRO_BITACORA',
  'TRANSFERENCIA_ENTRADA'
])

const TIPOS_VALIDOS = new Set([
  'ENTRADA_COMPRA', 'SALIDA_VENTA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO',
  'DEVOLUCION_ENTRADA', 'DEVOLUCION_SALIDA', 'SALIDA_BITACORA',
  'CANCELACION_VENTA', 'REINTEGRO_BITACORA',
  'TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA'
])

exports.kardex = async (req, res) => {
  try {
    const empresaId  = getEmpresaId(req)
    const productoId = parseInt(req.params.productoId)

    if (!productoId || isNaN(productoId)) {
      return res.status(400).json({ error: 'productoId inválido' })
    }

    const context = assertTenantRequestContext(req.context)
    const branchMode = context.branch.mode
    const contextSucursalId = context.branch.sucursalId

    const producto = await prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: {
        id: true, nombre: true, codigoInterno: true,
        unidadVenta: true, esGranel: true, costo: true
      }
    })
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado en esta empresa' })
    }

    let effectiveSucursalId = null
    let sucursalInfo = null

    if (branchMode === BRANCH_MODE.FIXED || branchMode === BRANCH_MODE.SELECTED) {
      effectiveSucursalId = contextSucursalId
      const querySucursalId = parseInt(req.query.sucursalId)
      if (querySucursalId && querySucursalId !== effectiveSucursalId) {
        return res.status(400).json({ error: 'No puedes consultar otra sucursal desde este modo' })
      }
      const suc = await prisma.sucursal.findFirst({
        where: { id: effectiveSucursalId, empresaId },
        select: { id: true, nombre: true }
      })
      if (!suc) {
        return res.status(404).json({ error: 'Sucursal no encontrada en esta empresa' })
      }
      sucursalInfo = suc
    } else {
      const querySucursalId = parseInt(req.query.sucursalId)
      if (querySucursalId) {
        const suc = await prisma.sucursal.findFirst({
          where: { id: querySucursalId, empresaId },
          select: { id: true, nombre: true }
        })
        if (!suc) {
          return res.status(404).json({ error: 'Sucursal no encontrada en esta empresa' })
        }
        effectiveSucursalId = querySucursalId
        sucursalInfo = suc
      }
    }

    const pagina = Math.max(parseInt(req.query.pagina) || 1, 1)
    const tamano = Math.min(Math.max(parseInt(req.query.tamano) || 50, 1), 200)
    const desde  = req.query.desde || null
    const hasta  = req.query.hasta || null
    const tipo   = req.query.tipo || null

    if (tipo && !TIPOS_VALIDOS.has(tipo)) {
      return res.status(400).json({ error: 'Tipo de movimiento inválido' })
    }

    if (desde && hasta && new Date(desde) > new Date(hasta)) {
      return res.status(400).json({ error: 'fechaDesde no puede ser mayor que fechaHasta' })
    }

    const where = {
      empresaId,
      productoId,
      ...(effectiveSucursalId ? { sucursalId: effectiveSucursalId } : {}),
      ...(desde && { creadoEn: { gte: new Date(desde) } }),
      ...(hasta && { creadoEn: { ...(desde ? {} : {}), lte: new Date(new Date(hasta).setHours(23, 59, 59, 999)) } }),
      ...(tipo && { tipo })
    }

    if (desde && hasta) {
      where.creadoEn = { gte: new Date(desde), lte: new Date(new Date(hasta).setHours(23, 59, 59, 999)) }
    }

    const [total, movimientos] = await Promise.all([
      prisma.movimientoInventario.count({ where }),
      prisma.movimientoInventario.findMany({
        where,
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * tamano,
        take: tamano,
        select: {
          id: true, tipo: true, cantidad: true,
          stockAntes: true, stockDespues: true,
          referencia: true, notas: true, costoUnitario: true,
          creadoEn: true, sucursalId: true,
          Sucursal: { select: { id: true, nombre: true } },
          Usuario: { select: { id: true, nombre: true } },
          TurnoCaja: { select: { id: true } }
        }
      })
    ])

    let stockActual = null
    let stockMinimo = null
    if (effectiveSucursalId) {
      const inv = await prisma.inventarioSucursal.findUnique({
        where: { productoId_sucursalId: { productoId, sucursalId: effectiveSucursalId } },
        select: { stockActual: true, stockMinimoAlerta: true }
      })
      stockActual = inv ? parseFloat(inv.stockActual) : 0
      stockMinimo = inv ? parseFloat(inv.stockMinimoAlerta) : 0
    }

    return res.json({
      producto,
      sucursal: sucursalInfo,
      branchMode,
      stockActual,
      stockMinimo,
      movimientos: movimientos.map(m => ({
        id: m.id,
        tipo: m.tipo,
        cantidad: parseFloat(m.cantidad),
        stockAntes: parseFloat(m.stockAntes),
        stockDespues: parseFloat(m.stockDespues),
        referencia: m.referencia,
        notas: m.notas,
        costoUnitario: m.costoUnitario ? parseFloat(m.costoUnitario) : null,
        creadoEn: m.creadoEn,
        sucursalId: m.sucursalId,
        sucursal: m.Sucursal?.nombre || null,
        sucursalNombre: m.Sucursal?.nombre || null,
        usuarioNombre: m.Usuario?.nombre || null,
        turnoFolio: m.TurnoCaja?.id || null,
        esEntrada: ENTRADAS.has(m.tipo)
      })),
      pagination: {
        total,
        pagina,
        tamano,
        paginas: Math.ceil(total / tamano)
      }
    })
  } catch (err) {
    console.error('❌ Error en kardex:', err)
    return res.status(500).json({ error: 'Error al consultar kardex' })
  }
}
