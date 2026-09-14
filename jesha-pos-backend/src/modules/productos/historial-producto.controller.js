'use strict'

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')

const CAMPOS_ECONOMICOS = new Set([
  'precioVenta',
  'precioBase',
  'precioMayoreo',
  'costo',
  'costoPromedio',
  'margen',
  'costoSinIvaProveedor',
  'factorConversion',
  'precioCosto'
])

const ORIGENES_HISTORICOS = new Set([
  'EDICION_PRECIOS',
  'EDICION_PRODUCTO',
  'COMPRA',
  'CREACION_PRODUCTO',
  'DUPLICACION_PRODUCTO',
  'CREACION_PRODUCTO_RAPIDO',
  'IMPORTACION'
])

function parseEnteroQuery(value, defaultValue, min, max, nombre) {
  if (value === undefined) return { value: defaultValue }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return { error: `${nombre} debe ser un número entero entre ${min} y ${max}` }
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return { error: `${nombre} debe ser un número entero entre ${min} y ${max}` }
  }
  return { value: parsed }
}

function parseFechaISO(value, nombre) {
  if (value === undefined) return { value: undefined }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
    return { error: `${nombre} debe ser una fecha ISO válida` }
  }

  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return { error: `${nombre} debe ser una fecha ISO válida` }
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return { error: `${nombre} debe ser una fecha ISO válida` }
  }
  return { value: parsed }
}

function serializarDecimal(value) {
  return value === null || value === undefined ? null : value.toFixed(4)
}

function relacionDelTenant(relacion, empresaId, permiteGlobal = false) {
  if (!relacion) return null
  if (relacion.empresaId === empresaId || (permiteGlobal && relacion.empresaId === null)) return relacion
  return null
}

async function obtenerHistorialEconomico(req, res) {
  try {
    const empresaId = getEmpresaId(req)
    const productoId = Number(req.params.id)
    if (!Number.isInteger(productoId) || productoId <= 0) {
      return res.status(400).json({ error: 'id de producto inválido' })
    }

    const pageResult = parseEnteroQuery(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER, 'page')
    if (pageResult.error) return res.status(400).json({ error: pageResult.error })

    const limitResult = parseEnteroQuery(req.query.limit, 50, 1, 100, 'limit')
    if (limitResult.error) return res.status(400).json({ error: limitResult.error })

    const campo = req.query.campo
    if (campo !== undefined && (typeof campo !== 'string' || !CAMPOS_ECONOMICOS.has(campo))) {
      return res.status(400).json({ error: 'campo económico inválido' })
    }

    const origen = req.query.origen
    if (origen !== undefined && (typeof origen !== 'string' || !ORIGENES_HISTORICOS.has(origen))) {
      return res.status(400).json({ error: 'origen de historial inválido' })
    }

    const desdeResult = parseFechaISO(req.query.desde, 'desde')
    if (desdeResult.error) return res.status(400).json({ error: desdeResult.error })

    const hastaResult = parseFechaISO(req.query.hasta, 'hasta')
    if (hastaResult.error) return res.status(400).json({ error: hastaResult.error })

    const desde = desdeResult.value
    const hasta = hastaResult.value
    if (desde && hasta && desde > hasta) {
      return res.status(400).json({ error: 'desde no puede ser posterior a hasta' })
    }

    const producto = await prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: {
        id: true,
        codigoInterno: true,
        codigoBarras: true,
        nombre: true,
        precioVenta: true,
        precioBase: true,
        precioMayoreo: true,
        costo: true,
        costoPromedio: true,
        margen: true,
        costoSinIvaProveedor: true,
        factorConversion: true
      }
    })

    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' })

    const where = {
      empresaId,
      productoId,
      ...(campo ? { Detalle: { some: { campo } } } : {}),
      ...(origen ? { origen } : {}),
      ...(desde || hasta
        ? {
            ocurridoEn: {
              ...(desde ? { gte: desde } : {}),
              ...(hasta ? { lte: hasta } : {})
            }
          }
        : {})
    }

    const page = pageResult.value
    const limit = limitResult.value
    const [total, eventos, primerEvento] = await prisma.$transaction([
      prisma.historialPrecioProducto.count({ where }),
      prisma.historialPrecioProducto.findMany({
        where,
        orderBy: [{ ocurridoEn: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          empresaId: true,
          ocurridoEn: true,
          registradoEn: true,
          origen: true,
          accion: true,
          referencia: true,
          Detalle: {
            orderBy: { id: 'asc' },
            select: { campo: true, valorAnterior: true, valorNuevo: true }
          },
          Usuario: {
            select: { id: true, empresaId: true, nombre: true, username: true, rol: true }
          },
          Sucursal: {
            select: { id: true, empresaId: true, nombre: true }
          },
          OrdenCompra: {
            select: { id: true, empresaId: true, folio: true, estado: true }
          },
          Proveedor: {
            select: { id: true, empresaId: true, nombreOficial: true, alias: true }
          }
        }
      }),
      prisma.historialPrecioProducto.aggregate({
        where: { empresaId, productoId },
        _min: { ocurridoEn: true }
      })
    ])

    const historial = eventos.map(evento => {
      const usuario = relacionDelTenant(evento.Usuario, empresaId, true)
      const sucursal = relacionDelTenant(evento.Sucursal, empresaId)
      const ordenCompra = relacionDelTenant(evento.OrdenCompra, empresaId)
      const proveedor = relacionDelTenant(evento.Proveedor, empresaId)

      return {
        id: evento.id,
        ocurridoEn: evento.ocurridoEn,
        registradoEn: evento.registradoEn,
        origen: evento.origen,
        accion: evento.accion,
        referencia: evento.referencia,
        usuario: usuario ? { id: usuario.id, nombre: usuario.nombre, username: usuario.username, rol: usuario.rol } : null,
        sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null,
        ordenCompra: ordenCompra ? { id: ordenCompra.id, folio: ordenCompra.folio, estado: ordenCompra.estado } : null,
        proveedor: proveedor ? { id: proveedor.id, nombreOficial: proveedor.nombreOficial, alias: proveedor.alias } : null,
        detalles: evento.Detalle.map(detalle => ({
          campo: detalle.campo,
          valorAnterior: serializarDecimal(detalle.valorAnterior),
          valorNuevo: serializarDecimal(detalle.valorNuevo)
        }))
      }
    })

    return res.json({
      producto: {
        id: producto.id,
        codigoInterno: producto.codigoInterno,
        codigoBarras: producto.codigoBarras,
        nombre: producto.nombre
      },
      actual: {
        precioVenta: serializarDecimal(producto.precioVenta),
        precioBase: serializarDecimal(producto.precioBase),
        precioMayoreo: serializarDecimal(producto.precioMayoreo),
        costo: serializarDecimal(producto.costo),
        costoPromedio: serializarDecimal(producto.costoPromedio),
        margen: serializarDecimal(producto.margen),
        costoSinIvaProveedor: serializarDecimal(producto.costoSinIvaProveedor),
        factorConversion: serializarDecimal(producto.factorConversion)
      },
      historial,
      paginacion: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit)
      },
      meta: {
        primerEventoRegistradoEn: primerEvento._min.ocurridoEn
      }
    })
  } catch (err) {
    console.error('Error al consultar historial económico del producto:', err)
    return res.status(500).json({ error: 'Error al consultar historial económico del producto' })
  }
}

module.exports = {
  CAMPOS_ECONOMICOS,
  ORIGENES_HISTORICOS,
  obtenerHistorialEconomico
}
