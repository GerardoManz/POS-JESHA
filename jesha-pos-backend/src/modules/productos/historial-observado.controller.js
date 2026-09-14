'use strict'

const prisma = require('../../lib/prisma')
const { Prisma } = require('@prisma/client')
const getEmpresaId = require('../../helpers/getEmpresaId')
const resolverSucursalId = require('../sucursal/sucursal.helper')

const PURCHASE_TYPE = 'ENTRADA_COMPRA'
const SALE_EXCLUDED_STATE = 'CANCELADA'

function parseInteger(value, fallback, min, max, name) {
  if (value === undefined) return { value: fallback }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return { error: `${name} inválido` }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return { error: `${name} inválido` }
  return { value: parsed }
}

function parseId(value, name) {
  if (value === undefined) return { value: undefined }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return { error: `${name} inválido` }
  return { value: parsed }
}

function parseDate(value, name, endOfDay = false) {
  if (value === undefined) return { value: undefined }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return { error: `${name} debe ser una fecha ISO válida` }
  const date = new Date(value.length === 10 && endOfDay ? `${value}T23:59:59.999Z` : value)
  if (Number.isNaN(date.getTime())) return { error: `${name} debe ser una fecha ISO válida` }
  return { value: date.toISOString() }
}

function decimal(value, scale = 4) {
  if (value === null || value === undefined) return null
  return new Prisma.Decimal(String(value)).toFixed(scale)
}

function decimalOrNull(value, scale = 4) {
  return value === null || value === undefined ? null : decimal(value, scale)
}

function getBranchScope(req, requestedSucursalId) {
  const contextSucursalId = resolverSucursalId(req)
  if (contextSucursalId !== null && contextSucursalId !== undefined) {
    if (requestedSucursalId !== undefined && requestedSucursalId !== contextSucursalId) {
      return { error: { status: 403, message: 'No tienes acceso a esta sucursal' } }
    }
    return { sucursalId: contextSucursalId }
  }
  return { sucursalId: requestedSucursalId }
}

async function validateSucursal(empresaId, sucursalId) {
  if (sucursalId === undefined) return null
  const sucursal = await prisma.sucursal.findFirst({
    where: { id: sucursalId, empresaId },
    select: { id: true }
  })
  return sucursal ? null : { status: 404, message: 'Sucursal no encontrada' }
}

async function validateTenantEntity(model, empresaId, id, label) {
  if (id === undefined) return null
  const entity = await prisma[model].findFirst({ where: { id, empresaId }, select: { id: true } })
  return entity ? null : { status: 404, message: `${label} no encontrado` }
}

async function loadProduct(empresaId, productoId) {
  return prisma.producto.findFirst({
    where: { id: productoId, empresaId },
    select: {
      id: true,
      codigoInterno: true,
      codigoBarras: true,
      nombre: true,
      unidadCompra: true,
      unidadVenta: true,
      factorConversion: true,
      precioVenta: true
    }
  })
}

function productPayload(producto) {
  return {
    id: producto.id,
    codigoInterno: producto.codigoInterno,
    codigoBarras: producto.codigoBarras,
    nombre: producto.nombre
  }
}

function pagination(page, limit, total) {
  return { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) }
}

function queryOptions(req, includeProvider) {
  const page = parseInteger(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER, 'page')
  const limit = parseInteger(req.query.limit, 50, 1, 100, 'limit')
  const provider = includeProvider ? parseId(req.query.proveedorId, 'proveedorId') : { value: undefined }
  const sucursal = parseId(req.query.sucursalId, 'sucursalId')
  const desde = parseDate(req.query.desde, 'desde')
  const hasta = parseDate(req.query.hasta, 'hasta', true)
  for (const result of [page, limit, provider, sucursal, desde, hasta]) {
    if (result.error) return { error: result.error }
  }
  if (desde.value && hasta.value && desde.value > hasta.value) return { error: 'desde no puede ser posterior a hasta' }
  return {
    page: page.value,
    limit: limit.value,
    proveedorId: provider.value,
    sucursalId: sucursal.value,
    desde: desde.value,
    hasta: hasta.value
  }
}

async function queryPurchases(empresaId, productoId, options) {
  const offset = (options.page - 1) * options.limit
  const values = [empresaId, productoId, PURCHASE_TYPE, options.sucursalId ?? null, options.proveedorId ?? null, options.desde ?? null, options.hasta ?? null]
  // SQL is static; every request value is passed as a PostgreSQL parameter.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT mi."id", mi."creadoEn" AS "fecha", mi."referencia", mi."cantidad", mi."costoUnitario",
           s."id" AS "sucursalId", s."nombre" AS "sucursalNombre",
           u."id" AS "usuarioId", u."nombre" AS "usuarioNombre",
           oc."id" AS "ordenCompraId", oc."folio" AS "ordenCompraFolio",
           prov."id" AS "proveedorId", prov."nombreOficial" AS "proveedorNombre", prov."alias" AS "proveedorAlias",
           doc."unidadCompraSnapshot", doc."unidadVentaSnapshot", doc."factorConversionSnapshot"
    FROM "MovimientoInventario" mi
    JOIN "Sucursal" s ON s."id" = mi."sucursalId" AND s."empresaId" = mi."empresaId"
    LEFT JOIN "Usuario" u ON u."id" = mi."usuarioId"
    LEFT JOIN "OrdenCompra" oc ON oc."empresaId" = mi."empresaId" AND oc."folio" = mi."referencia"
    LEFT JOIN "Proveedor" prov ON prov."id" = oc."proveedorId" AND prov."empresaId" = mi."empresaId"
    LEFT JOIN LATERAL (
      SELECT d."unidadCompraSnapshot", d."unidadVentaSnapshot", d."factorConversionSnapshot"
      FROM "DetalleOrdenCompra" d
      WHERE d."ordenCompraId" = oc."id" AND d."productoId" = mi."productoId"
      ORDER BY d."id" ASC
      LIMIT 1
    ) doc ON TRUE
    WHERE mi."empresaId" = $1 AND mi."productoId" = $2 AND mi."tipo" = $3
      AND ($4::int IS NULL OR mi."sucursalId" = $4)
      AND ($5::int IS NULL OR oc."proveedorId" = $5)
      AND ($6::timestamptz IS NULL OR mi."creadoEn" >= $6)
      AND ($7::timestamptz IS NULL OR mi."creadoEn" <= $7)
    ORDER BY mi."creadoEn" DESC, mi."id" DESC
    OFFSET $8 LIMIT $9
  `, ...values, offset, options.limit)
  const countRows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS "total"
    FROM "MovimientoInventario" mi
    LEFT JOIN "OrdenCompra" oc ON oc."empresaId" = mi."empresaId" AND oc."folio" = mi."referencia"
    WHERE mi."empresaId" = $1 AND mi."productoId" = $2 AND mi."tipo" = $3
      AND ($4::int IS NULL OR mi."sucursalId" = $4) AND ($5::int IS NULL OR oc."proveedorId" = $5)
      AND ($6::timestamptz IS NULL OR mi."creadoEn" >= $6) AND ($7::timestamptz IS NULL OR mi."creadoEn" <= $7)
  `, ...values)
  const summaryRows = await prisma.$queryRawUnsafe(`
    SELECT MIN(mi."costoUnitario") AS "min", MAX(mi."costoUnitario") AS "max",
           CASE WHEN SUM(mi."cantidad") = 0 THEN NULL
                ELSE SUM(mi."costoUnitario" * mi."cantidad") / SUM(mi."cantidad") END AS "promedio",
           MAX(mi."creadoEn") AS "ultima"
    FROM "MovimientoInventario" mi
    LEFT JOIN "OrdenCompra" oc ON oc."empresaId" = mi."empresaId" AND oc."folio" = mi."referencia"
    WHERE mi."empresaId" = $1 AND mi."productoId" = $2 AND mi."tipo" = $3
      AND ($4::int IS NULL OR mi."sucursalId" = $4) AND ($5::int IS NULL OR oc."proveedorId" = $5)
      AND ($6::timestamptz IS NULL OR mi."creadoEn" >= $6) AND ($7::timestamptz IS NULL OR mi."creadoEn" <= $7)
      AND mi."costoUnitario" IS NOT NULL
  `, ...values)
  return { rows, total: Number(countRows[0]?.total || 0), summary: summaryRows[0] || {} }
}

async function querySales(empresaId, productoId, options) {
  const offset = (options.page - 1) * options.limit
  const values = [empresaId, productoId, SALE_EXCLUDED_STATE, options.sucursalId ?? null, options.usuarioId ?? null, options.desde ?? null, options.hasta ?? null]
  const rows = await prisma.$queryRawUnsafe(`
    SELECT dv."id", v."creadaEn" AS "fecha", v."id" AS "ventaId", v."folio" AS "referencia",
           v."estado", dv."cantidad", dv."precioUnitario", dv."descuento", dv."subtotal",
           s."id" AS "sucursalId", s."nombre" AS "sucursalNombre",
           u."id" AS "usuarioId", u."nombre" AS "usuarioNombre"
    FROM "DetalleVenta" dv
    JOIN "Venta" v ON v."id" = dv."ventaId"
    JOIN "Sucursal" s ON s."id" = v."sucursalId" AND s."empresaId" = v."empresaId"
    LEFT JOIN "Usuario" u ON u."id" = v."usuarioId"
    WHERE v."empresaId" = $1 AND dv."productoId" = $2 AND v."estado" <> $3
      AND ($4::int IS NULL OR v."sucursalId" = $4) AND ($5::int IS NULL OR v."usuarioId" = $5)
      AND ($6::timestamptz IS NULL OR v."creadaEn" >= $6) AND ($7::timestamptz IS NULL OR v."creadaEn" <= $7)
    ORDER BY v."creadaEn" DESC, dv."id" DESC
    OFFSET $8 LIMIT $9
  `, ...values, offset, options.limit)
  const countRows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS "total"
    FROM "DetalleVenta" dv
    JOIN "Venta" v ON v."id" = dv."ventaId"
    WHERE v."empresaId" = $1 AND dv."productoId" = $2 AND v."estado" <> $3
      AND ($4::int IS NULL OR v."sucursalId" = $4) AND ($5::int IS NULL OR v."usuarioId" = $5)
      AND ($6::timestamptz IS NULL OR v."creadaEn" >= $6) AND ($7::timestamptz IS NULL OR v."creadaEn" <= $7)
  `, ...values)
  const summaryRows = await prisma.$queryRawUnsafe(`
    SELECT MIN(dv."precioUnitario") AS "min", MAX(dv."precioUnitario") AS "max",
           CASE WHEN SUM(dv."cantidad") = 0 THEN NULL
                ELSE SUM(dv."precioUnitario" * dv."cantidad") / SUM(dv."cantidad") END AS "promedio",
           MAX(v."creadaEn") AS "ultima"
    FROM "DetalleVenta" dv
    JOIN "Venta" v ON v."id" = dv."ventaId"
    WHERE v."empresaId" = $1 AND dv."productoId" = $2 AND v."estado" <> $3
      AND ($4::int IS NULL OR v."sucursalId" = $4) AND ($5::int IS NULL OR v."usuarioId" = $5)
      AND ($6::timestamptz IS NULL OR v."creadaEn" >= $6) AND ($7::timestamptz IS NULL OR v."creadaEn" <= $7)
  `, ...values)
  return { rows, total: Number(countRows[0]?.total || 0), summary: summaryRows[0] || {} }
}

function mapPurchase(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    ordenCompraId: row.ordenCompraId,
    referencia: row.referencia,
    proveedor: row.proveedorId ? { id: row.proveedorId, nombreOficial: row.proveedorNombre, alias: row.proveedorAlias } : null,
    sucursal: { id: row.sucursalId, nombre: row.sucursalNombre },
    usuario: row.usuarioId ? { id: row.usuarioId, nombre: row.usuarioNombre } : null,
    cantidad: decimal(row.cantidad, 3),
    costoUnitario: decimalOrNull(row.costoUnitario, 2),
    unidadCompra: row.unidadCompraSnapshot || null,
    unidadVenta: row.unidadVentaSnapshot || null,
    factorConversion: decimalOrNull(row.factorConversionSnapshot, 4)
  }
}

function mapSale(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    ventaId: row.ventaId,
    referencia: row.referencia,
    estado: row.estado,
    sucursal: { id: row.sucursalId, nombre: row.sucursalNombre },
    usuario: row.usuarioId ? { id: row.usuarioId, nombre: row.usuarioNombre } : null,
    cantidad: decimal(row.cantidad, 3),
    precioUnitario: decimal(row.precioUnitario, 2),
    descuentoLinea: decimal(row.descuento, 2),
    subtotal: decimal(row.subtotal, 2)
  }
}

function summaryPayload(summary, priceKey) {
  return {
    min: decimalOrNull(summary.min, 2),
    max: decimalOrNull(summary.max, 2),
    promedio: decimalOrNull(summary.promedio, 4),
    ultima: summary.ultima || null,
    promedioMetodo: 'ponderado_por_cantidad',
    campo: priceKey
  }
}

async function obtenerSerie(req, res, tipo) {
  try {
    const empresaId = getEmpresaId(req)
    const productoId = Number(req.params.id)
    if (!Number.isInteger(productoId) || productoId <= 0) return res.status(400).json({ error: 'id de producto inválido' })

    const options = queryOptions(req, tipo === 'compras')
    if (options.error) return res.status(400).json({ error: options.error })
    const branch = getBranchScope(req, options.sucursalId)
    if (branch.error) return res.status(branch.error.status).json({ error: branch.error.message })
    options.sucursalId = branch.sucursalId

    const filterSucursalError = await validateSucursal(empresaId, options.sucursalId)
    if (filterSucursalError) return res.status(filterSucursalError.status).json({ error: filterSucursalError.message })
    if (tipo === 'compras') {
      const providerError = await validateTenantEntity('proveedor', empresaId, options.proveedorId, 'Proveedor')
      if (providerError) return res.status(providerError.status).json({ error: providerError.message })
    }
    if (tipo === 'ventas' && req.query.usuarioId !== undefined) {
      const usuario = await parseId(req.query.usuarioId, 'usuarioId')
      if (usuario.error) return res.status(400).json({ error: usuario.error })
      options.usuarioId = usuario.value
      const userError = await validateTenantEntity('usuario', empresaId, options.usuarioId, 'Usuario')
      if (userError) return res.status(userError.status).json({ error: userError.message })
    }

    const producto = await loadProduct(empresaId, productoId)
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' })

    const result = tipo === 'compras'
      ? await queryPurchases(empresaId, productoId, options)
      : await querySales(empresaId, productoId, options)
    const rows = tipo === 'compras' ? result.rows.map(mapPurchase) : result.rows.map(mapSale)

    return res.json({
      producto: productPayload(producto),
      [tipo]: rows,
      paginacion: pagination(options.page, options.limit, result.total),
      resumen: summaryPayload(result.summary, tipo === 'compras' ? 'costoUnitario' : 'precioUnitario')
    })
  } catch (err) {
    console.error(`Error al consultar historial observado de ${tipo}:`, err)
    return res.status(500).json({ error: `Error al consultar historial observado de ${tipo}` })
  }
}

module.exports = {
  obtenerHistorialCompras: (req, res) => obtenerSerie(req, res, 'compras'),
  obtenerHistorialVentas: (req, res) => obtenerSerie(req, res, 'ventas')
}
