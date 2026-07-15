// ═══════════════════════════════════════════════════════════════════
//  ARTÍCULO RÁPIDO — Crea producto + inventario + movimiento en una sola
//  transacción desde el POS de caja.
//
//  Endpoint: POST /productos/articulo-rapido
//  Auth:    requireAuth (aplicado en app.js al montar /productos)
//  Roles:   sin requireRole — cualquier usuario autenticado puede crear
//
//  No toca ventas, cortes ni movimientos de caja: la venta posterior
//  pasa por /ventas con su propia transacción atómica, así que el
//  artículo rápido no tiene efecto dominó.
//
//  Body esperado:
//    {
//      nombre:          string   (requerido)
//      codigoInterno:   string?  (opcional, se genera si falta)
//      codigoBarras:    string?  (opcional, null si falta)
//      precioVenta:     number   (requerido, > 0)
//      stockInicial:    number   (requerido, >= 0)
//      cantidadVenta:   number   (requerido, > 0 y <= stockInicial)
//      unidadVenta:     string?  (default 'pza')
//      esGranel:        boolean? (default false)
//      categoriaId:     int      (requerido)
//      sucursalId:      int?     (opcional, se resuelve del turno)
//      turnoId:         int?     (opcional, recomendado)
//      unidadSat:       string?  (default 'H87')
//      claveSat:        string?  (opcional, queda null para no bloquear caja)
//    }
//
//  Response 201:
//    { success: true, data: { id, nombre, ..., stock, inventario } }
// ═══════════════════════════════════════════════════════════════════

const { Prisma } = require('@prisma/client')
const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const satMatcher = require('./sat.matcher')
const {
    normalizarCodigoBarras,
    validarCodigoBarrasDuplicado,
    parsearErrorPrismaProducto
} = require('./productos.helpers')

const IVA_FACTOR = 1.16

function generarCodigoInterno() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const rand = Math.floor(Math.random() * 0xFFFF)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0')
  return `AR-${y}${m}${day}-${h}${mi}${s}-${rand}`
}

exports.crearArticuloRapido = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const {
      nombre,
      codigoInterno: codigoInternoIn,
      codigoBarras: codigoBarrasIn,
      precioVenta,
      stockInicial,
      cantidadVenta,
      unidadVenta: unidadVentaIn,
      esGranel,
      categoriaId,
      sucursalId: sucursalIdBody,
      turnoId,
      unidadSat,
      claveSat
    } = req.body || {}

    // ── Normalización y trim ───────────────────────────────────────
    const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : ''
    const codigoInternoLimpio = typeof codigoInternoIn === 'string'
      ? codigoInternoIn.trim()
      : ''
    const codigoBarrasLimpio = normalizarCodigoBarras(codigoBarrasIn) || ''
    const unidadVentaLimpia = typeof unidadVentaIn === 'string' && unidadVentaIn.trim() !== ''
      ? unidadVentaIn.trim()
      : 'pza'

    // ── Validaciones ───────────────────────────────────────────────
    if (!nombreLimpio) {
      return res.status(400).json({ success: false, error: 'El campo "nombre" es requerido' })
    }

    const precioVentaNum = parseFloat(precioVenta)
    if (!precioVenta || isNaN(precioVentaNum) || precioVentaNum <= 0) {
      return res.status(400).json({ success: false, error: 'precioVenta debe ser > 0' })
    }

    const stockInicialNum = parseFloat(stockInicial)
    if (stockInicial === undefined || stockInicial === null || isNaN(stockInicialNum) || stockInicialNum < 0) {
      return res.status(400).json({ success: false, error: 'stockInicial debe ser >= 0' })
    }

    const cantidadVentaNum = parseFloat(cantidadVenta)
    if (!cantidadVenta || isNaN(cantidadVentaNum) || cantidadVentaNum <= 0) {
      return res.status(400).json({ success: false, error: 'cantidadVenta debe ser > 0' })
    }
    if (cantidadVentaNum > stockInicialNum) {
      return res
        .status(400)
        .json({ success: false, error: 'cantidadVenta no puede ser mayor que stockInicial' })
    }

    const categoriaIdNum = parseInt(categoriaId)
    if (!categoriaId || isNaN(categoriaIdNum)) {
      return res.status(400).json({ success: false, error: 'categoriaId es requerido' })
    }

    // ── Resolución de sucursalId y turnoId ────────────────────────
    // Prioridad: 1) turnoId body (busca en BD), 2) body, 3) token.
    let turnoIdNum = parseInt(turnoId)
    if (isNaN(turnoIdNum)) turnoIdNum = null

    let sucursalIdNum = parseInt(sucursalIdBody)
    if (isNaN(sucursalIdNum)) sucursalIdNum = null

    if (turnoIdNum) {
      const turno = await prisma.turnoCaja.findUnique({ where: { id: turnoIdNum } })
      if (!turno) {
        return res.status(400).json({ success: false, error: 'turnoId no existe' })
      }
      if (!turno.abierto) {
        return res.status(400).json({ success: false, error: 'El turno está cerrado' })
      }
      if (turno.empresaId !== empresaId) {
        return res.status(403).json({ success: false, error: 'El turno no pertenece a tu empresa' })
      }
      sucursalIdNum = turno.sucursalId
    }

    if (!sucursalIdNum && req.usuario?.sucursalId) {
      sucursalIdNum = parseInt(req.usuario.sucursalId)
    }

    if (!sucursalIdNum || isNaN(sucursalIdNum)) {
      return res
        .status(400)
        .json({ success: false, error: 'No se pudo determinar la sucursal (envía sucursalId o turnoId)' })
    }

    // Validar que la sucursal pertenezca a la empresa
    const sucursal = await prisma.sucursal.findUnique({ where: { id: sucursalIdNum } })
    if (!sucursal || sucursal.empresaId !== empresaId) {
      return res.status(403).json({ success: false, error: 'sucursalId inválida para tu empresa' })
    }

    // Validar categoría
    const categoria = await prisma.categoria.findUnique({ where: { id: categoriaIdNum } })
    if (!categoria) {
      return res.status(400).json({ success: false, error: 'categoriaId no existe' })
    }
    if (categoria.empresaId !== null && categoria.empresaId !== empresaId) {
      return res.status(403).json({ success: false, error: 'La categoría no pertenece a tu empresa' })
    }

    // ── Resolución de codigoInterno ───────────────────────────────
    let codigoInternoFinal = codigoInternoLimpio
    if (!codigoInternoFinal) {
      codigoInternoFinal = generarCodigoInterno()
    }

    // Duplicado por empresaId + codigoInterno
    const dupInterno = await prisma.producto.findUnique({
      where: { empresaId_codigoInterno: { empresaId, codigoInterno: codigoInternoFinal } }
    })
    if (dupInterno) {
      return res
        .status(409)
        .json({ success: false, error: 'El código interno ya existe en esta empresa', campo: 'codigoInterno' })
    }

    // Duplicado por codigoBarras (si viene)
    let codigoBarrasFinal = null
    if (codigoBarrasLimpio) {
      const dupBarras = await validarCodigoBarrasDuplicado({ empresaId, codigoBarras: codigoBarrasLimpio, prismaClient: prisma })
      if (dupBarras) {
        return res
          .status(409)
          .json({ success: false, error: 'El código de barras ya existe en esta empresa', campo: 'codigoBarras' })
      }
      codigoBarrasFinal = codigoBarrasLimpio
    }

    // ── Cálculos ───────────────────────────────────────────────────
    const precioBaseNum = parseFloat((precioVentaNum / IVA_FACTOR).toFixed(2))
    const esGranelBool = esGranel === true || esGranel === 'true'
    const stockInicialFixed = parseFloat(stockInicialNum.toFixed(3))
    const cantidadVentaFixed = parseFloat(cantidadVentaNum.toFixed(3))
    const usuarioId = req.usuario?.id ? parseInt(req.usuario.id) : null
    const unidadSatFinal = typeof unidadSat === 'string' && unidadSat.trim() !== ''
      ? unidadSat.trim().toUpperCase()
      : 'H87'
    const claveSatFinal = typeof claveSat === 'string' && claveSat.trim() !== ''
      ? claveSat.trim()
      : null

    if (!satMatcher.validarUnidadSat(unidadSatFinal)) {
      return res.status(400).json({ success: false, error: `UNIDAD SAT ${unidadSatFinal} no existe en el catálogo SAT vigente`, campo: 'unidadSat' })
    }

    if (claveSatFinal && !/^\d{8}$/.test(claveSatFinal)) {
      return res.status(400).json({ success: false, error: 'CLAVE SAT debe tener 8 dígitos', campo: 'claveSat' })
    }

    if (claveSatFinal && !satMatcher.validarClaveSat(claveSatFinal)) {
      return res.status(400).json({ success: false, error: `CLAVE SAT ${claveSatFinal} no existe en el catálogo SAT vigente`, campo: 'claveSat' })
    }

    // ── Transacción ACID ──────────────────────────────────────────
    const resultado = await prisma.$transaction(async (tx) => {
      const producto = await tx.producto.create({
        data: {
          empresaId,
          nombre:               nombreLimpio,
          codigoInterno:        codigoInternoFinal,
          codigoBarras:         codigoBarrasFinal,
          descripcion:          null,
          costo:                null,
          costoPromedio:        null,
          precioBase:           precioBaseNum,
          precioVenta:          precioVentaNum,
          unidadCompra:         unidadVentaLimpia,
          unidadVenta:          unidadVentaLimpia,
          factorConversion:     1,
          claveSat:             claveSatFinal,
          unidadSat:            unidadSatFinal,
          tipoFacturaProv:      'NETO',
          costoSinIvaProveedor: null,
          esGranel:             esGranelBool,
          categoriaId:          categoriaIdNum,
          activo:               true
        },
        include: {
          Categoria: { include: { Departamento: true } }
        }
      })

      // Inventario inicial (siempre crear — el control de existencia vive aquí)
      const inv = await tx.inventarioSucursal.upsert({
        where: { productoId_sucursalId: { productoId: producto.id, sucursalId: sucursalIdNum } },
        update: {},
        create: {
          productoId:  producto.id,
          sucursalId:  sucursalIdNum,
          stockActual: stockInicialFixed
        }
      })

      // Si ya existía inventario, lo dejamos intacto y NO emitimos AJUSTE_POSITIVO
      // automático (sería un alta doble). Solo emitimos movimiento si el registro
      // se creó en este mismo request.
      const inventarioEraNuevo = parseFloat(inv.stockActual) === stockInicialFixed
        && inv.actualizadoEn.getTime() === (await tx.inventarioSucursal.findUnique({
            where: { id: inv.id }, select: { actualizadoEn: true }
          }))?.actualizadoEn.getTime()

      if (stockInicialFixed > 0) {
        await tx.movimientoInventario.create({
          data: {
            empresaId,
            productoId:  producto.id,
            sucursalId:  sucursalIdNum,
            usuarioId,
            tipo:        'AJUSTE_POSITIVO',
            cantidad:    stockInicialFixed,
            stockAntes:  0,
            stockDespues: stockInicialFixed,
            turnoId:     turnoIdNum,
            referencia:  `ARTICULO-RAPIDO-${producto.id}`,
            notas:       'Alta rápida desde POS'
          }
        })
      }

      return { producto, inventario: inv }
    })

    const { producto, inventario } = resultado

    console.log(
      `✅ Artículo rápido creado: ${producto.nombre} (id ${producto.id}) — stock ${stockInicialFixed} en sucursal ${sucursalIdNum}`
    )

    return res.status(201).json({
      success: true,
      data: {
        ...producto,
        stock: stockInicialFixed,
        inventario: {
          ...inventario,
          stockActual: parseFloat(inventario.stockActual)
        }
      }
    })
  } catch (err) {
    console.error('❌ Error artículo rápido:', err)
    const prismaErr = parsearErrorPrismaProducto(err)
    if (prismaErr) {
      return res.status(prismaErr.status).json({ success: false, error: prismaErr.error })
    }
    return res.status(500).json({ success: false, error: 'Error interno al crear artículo rápido' })
  }
}
