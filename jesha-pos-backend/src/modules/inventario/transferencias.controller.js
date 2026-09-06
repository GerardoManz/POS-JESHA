// ════════════════════════════════════════════════════════════════════
//  TRANSFERENCIAS DE INVENTARIO
//  Ubicación: src/modules/inventario/transferencias.controller.js
//  Atomicidad: UNA transacción PostgreSQL por transferencia.
//  Idempotencia: clientTransferId único por empresa.
//  Concurrencia: FOR UPDATE en InventarioSucursal + orden determinista.
// ════════════════════════════════════════════════════════════════════

const crypto = require('node:crypto')
const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { BRANCH_MODE, assertTenantRequestContext } = require('../../security/request-context')

const MAX_ITEMS = 100
const MAX_NOTAS_LENGTH = 500

const ROLES_PERMITIDOS = ['SUPERADMIN', 'ADMIN_SUCURSAL']

function computeHash(data) {
  const canonical = JSON.stringify({
    origen: data.sucursalOrigenId,
    destino: data.sucursalDestinoId,
    items: data.items
      .map(i => ({ p: parseInt(i.productoId), c: parseFloat(i.cantidad) }))
      .sort((a, b) => a.p - b.p),
    notas: (data.notas || '').trim().substring(0, 200)
  })
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

// ──────────────────────────────────────────────────────────────────
//  POST /inventario/transferencias — Crear transferencia
// ──────────────────────────────────────────────────────────────────
exports.crear = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const context = assertTenantRequestContext(req.context)
    const branchMode = context.branch.mode
    const sucursalOrigenId = context.branch.sucursalId

    // ── Branch authority ────────────────────────────────────────
    if (branchMode === BRANCH_MODE.NONE) {
      return res.status(400).json({
        error: 'Selecciona una sucursal de trabajo para crear transferencias',
        codigo: 'BRANCH_CONTEXT_REQUIRED'
      })
    }

    const usuarioId = req.usuario?.id ? parseInt(req.usuario.id) : null
    if (!usuarioId) {
      return res.status(401).json({ error: 'Usuario no autenticado', codigo: 'NO_AUTH' })
    }

    // ── Role check ─────────────────────────────────────────────
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario || !usuario.activo) {
      return res.status(403).json({ error: 'Usuario inválido o inactivo', codigo: 'USUARIO_INACTIVO' })
    }
    if (!ROLES_PERMITIDOS.includes(usuario.rol)) {
      return res.status(403).json({ error: 'Sin permiso para transferir inventario', codigo: 'SIN_PERMISO_TRANSFERENCIA' })
    }

    // ── Input validation ───────────────────────────────────────
    const { clientTransferId, sucursalDestinoId, items, notas } = req.body || {}

    if (!clientTransferId || typeof clientTransferId !== 'string' || clientTransferId.trim().length === 0) {
      return res.status(400).json({ error: 'clientTransferId es requerido', codigo: 'CLIENT_TRANSFER_ID_REQUERIDO' })
    }
    if (clientTransferId.length > 128) {
      return res.status(400).json({ error: 'clientTransferId máximo 128 caracteres', codigo: 'CLIENT_TRANSFER_ID_LARGO' })
    }

    const destinoId = parseInt(sucursalDestinoId)
    if (!destinoId || isNaN(destinoId)) {
      return res.status(400).json({ error: 'sucursalDestinoId inválido', codigo: 'DESTINO_INVALIDO' })
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items debe ser un array con al menos 1 elemento', codigo: 'ITEMS_REQUERIDOS' })
    }
    if (items.length > MAX_ITEMS) {
      return res.status(400).json({ error: `Máximo ${MAX_ITEMS} productos por transferencia`, codigo: 'ITEMS_EXCEDIDOS' })
    }

    if (notas && notas.length > MAX_NOTAS_LENGTH) {
      return res.status(400).json({ error: `notas máximo ${MAX_NOTAS_LENGTH} caracteres`, codigo: 'NOTAS_LARGO' })
    }

    // Validate each item
    const productoIds = new Set()
    for (const item of items) {
      const pid = parseInt(item.productoId)
      const qty = parseFloat(item.cantidad)
      if (!pid || isNaN(pid)) {
        return res.status(400).json({ error: `productoId inválido en item`, codigo: 'PRODUCTO_INVALIDO' })
      }
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: `cantidad debe ser > 0 para producto ${pid}`, codigo: 'CANTIDAD_INVALIDA' })
      }
      if (productoIds.has(pid)) {
        return res.status(400).json({ error: `Producto ${pid} duplicado en items`, codigo: 'PRODUCTO_DUPLICADO_TRANSFERENCIA' })
      }
      productoIds.add(pid)
    }

    // ── Validate branches ──────────────────────────────────────
    if (destinoId === sucursalOrigenId) {
      return res.status(400).json({ error: 'Sucursal destino no puede ser igual a origen', codigo: 'DESTINO_IGUAL_ORIGEN' })
    }

    const [sucursalOrigen, sucursalDestino] = await Promise.all([
      prisma.sucursal.findFirst({ where: { id: sucursalOrigenId, empresaId }, select: { id: true, nombre: true, activa: true } }),
      prisma.sucursal.findFirst({ where: { id: destinoId, empresaId }, select: { id: true, nombre: true, activa: true } })
    ])

    if (!sucursalOrigen) {
      return res.status(404).json({ error: 'Sucursal origen no encontrada en esta empresa', codigo: 'ORIGEN_NO_ENCONTRADO' })
    }
    if (!sucursalOrigen.activa) {
      return res.status(400).json({ error: 'Sucursal origen inactiva', codigo: 'ORIGEN_INACTIVO' })
    }
    if (!sucursalDestino) {
      return res.status(404).json({ error: 'Sucursal destino no encontrada en esta empresa', codigo: 'DESTINO_NO_ENCONTRADO' })
    }
    if (!sucursalDestino.activa) {
      return res.status(400).json({ error: 'Sucursal destino inactiva', codigo: 'DESTINO_INACTIVO' })
    }

    // ── Validate products belong to empresa ─────────────────────
    const productIds = [...productoIds]
    const productos = await prisma.producto.findMany({
      where: { id: { in: productIds }, empresaId },
      select: { id: true, nombre: true, costo: true }
    })
    if (productos.length !== productIds.length) {
      const found = new Set(productos.map(p => p.id))
      const missing = productIds.filter(id => !found.has(id))
      return res.status(404).json({
        error: `Productos no encontrados en esta empresa: ${missing.join(', ')}`,
        codigo: 'PRODUCTOS_NO_ENCONTRADOS'
      })
    }

    // ── Request hash for idempotency ───────────────────────────
    const requestHash = computeHash({ sucursalOrigenId, sucursalDestinoId: destinoId, items, notas })

    // ════════════════════════════════════════════════════════════
    //  TRANSACCIÓN ATÓMICA
    // ════════════════════════════════════════════════════════════
    const result = await prisma.$transaction(async (tx) => {
      // ── Idempotency check ────────────────────────────────────
      const existing = await tx.transferenciaInventario.findUnique({
        where: { empresaId_clientTransferId: { empresaId, clientTransferId: clientTransferId.trim() } },
        include: { Detalle: true }
      })

      if (existing) {
        if (existing.requestHash !== requestHash) {
          return { status: 409, error: 'clientTransferId ya utilizado con payload diferente', codigo: 'IDEMPOTENCY_KEY_REUSED' }
        }
        return { status: 200, transferencia: existing, idempotent: true }
      }

      // ── Lock stocks in deterministic order (productoId ASC) ──
      const lockedProducts = await Promise.all(
        productIds.sort((a, b) => a - b).map(pid =>
          tx.$queryRaw`
            SELECT inv.id, inv."productoId", inv."sucursalId", inv."stockActual"
            FROM "InventarioSucursal" inv
            WHERE inv."productoId" = ${pid} AND inv."sucursalId" = ${sucursalOrigenId}
            FOR UPDATE
          `
        )
      )

      // Build map of locked stocks
      const stockMap = {}
      for (const row of lockedProducts.flat()) {
        stockMap[row.productoId] = parseFloat(row.stockActual)
      }

      // ── Verify stock sufficiency ─────────────────────────────
      const stockIssues = []
      for (const item of items) {
        const pid = parseInt(item.productoId)
        const qty = parseFloat(item.cantidad)
        const available = stockMap[pid]
        if (available === undefined) {
          stockIssues.push({
            productoId: pid,
            nombre: productos.find(p => p.id === pid)?.nombre,
            stockDisponible: 0,
            cantidadSolicitada: qty
          })
        } else if (available < qty) {
          stockIssues.push({
            productoId: pid,
            nombre: productos.find(p => p.id === pid)?.nombre,
            stockDisponible: available,
            cantidadSolicitada: qty
          })
        }
      }

      if (stockIssues.length > 0) {
        return { status: 409, error: 'Stock insuficiente para algunos productos', codigo: 'STOCK_INSUFICIENTE', detalles: stockIssues }
      }

      // ── Create transfer header ───────────────────────────────
      const transferencia = await tx.transferenciaInventario.create({
        data: {
          empresaId,
          sucursalOrigenId,
          sucursalDestinoId: destinoId,
          clientTransferId: clientTransferId.trim(),
          requestHash,
          notas: notas || null,
          creadoPorId: usuarioId
        }
      })

      const detalles = []
      const movimientos = []

      // ── Process each item ────────────────────────────────────
      for (const item of items) {
        const pid = parseInt(item.productoId)
        const qty = parseFloat(item.cantidad)
        const stockOrigenAntes = stockMap[pid]
        const stockOrigenDespues = parseFloat((stockOrigenAntes - qty).toFixed(3))
        const costo = productos.find(p => p.id === pid)?.costo

        // Get or create destination inventory
        const invDestino = await tx.inventarioSucursal.findUnique({
          where: { productoId_sucursalId: { productoId: pid, sucursalId: destinoId } }
        })
        const stockDestinoAntes = invDestino ? parseFloat(invDestino.stockActual) : 0
        const stockDestinoDespues = parseFloat((stockDestinoAntes + qty).toFixed(3))

        // Create detail
        const detalle = await tx.transferenciaInventarioDetalle.create({
          data: {
            transferenciaId: transferencia.id,
            productoId: pid,
            cantidad: qty,
            stockOrigenAntes,
            stockOrigenDespues,
            stockDestinoAntes,
            stockDestinoDespues,
            costoUnitario: costo || null
          }
        })
        detalles.push(detalle)

        // Create SALIDA movement
        const movSalida = await tx.movimientoInventario.create({
          data: {
            empresaId,
            productoId: pid,
            sucursalId: sucursalOrigenId,
            usuarioId,
            tipo: 'TRANSFERENCIA_SALIDA',
            cantidad: qty,
            stockAntes: stockOrigenAntes,
            stockDespues: stockOrigenDespues,
            referencia: `TRF:${transferencia.id}`,
            notas: `Transferencia a ${sucursalDestino.nombre}`,
            costoUnitario: costo || null,
            transferenciaDetalleId: detalle.id
          }
        })
        movimientos.push(movSalida)

        // Create ENTRADA movement
        const movEntrada = await tx.movimientoInventario.create({
          data: {
            empresaId,
            productoId: pid,
            sucursalId: destinoId,
            usuarioId,
            tipo: 'TRANSFERENCIA_ENTRADA',
            cantidad: qty,
            stockAntes: stockDestinoAntes,
            stockDespues: stockDestinoDespues,
            referencia: `TRF:${transferencia.id}`,
            notas: `Transferencia desde ${sucursalOrigen.nombre}`,
            costoUnitario: costo || null,
            transferenciaDetalleId: detalle.id
          }
        })
        movimientos.push(movEntrada)

        // Update origin stock
        await tx.inventarioSucursal.update({
          where: { productoId_sucursalId: { productoId: pid, sucursalId: sucursalOrigenId } },
          data: { stockActual: stockOrigenDespues }
        })

        // Upsert destination stock
        await tx.inventarioSucursal.upsert({
          where: { productoId_sucursalId: { productoId: pid, sucursalId: destinoId } },
          create: { productoId: pid, sucursalId: destinoId, stockActual: stockDestinoDespues },
          update: { stockActual: stockDestinoDespues }
        })
      }

      return {
        status: 201,
        transferencia: {
          ...transferencia,
          Detalle: detalles,
          _movimientos: movimientos
        },
        idempotent: false
      }
    })

    // ── Handle idempotent response ─────────────────────────────
    if (result.status === 200 && result.idempotent) {
      return res.json({
        message: 'Transferencia ya existente (idempotente)',
        transferencia: formatTransferencia(result.transferencia),
        idempotent: true
      })
    }

    if (result.status === 409) {
      return res.status(409).json({ error: result.error, codigo: result.codigo, detalles: result.detalles })
    }

    return res.status(201).json({
      message: 'Transferencia creada exitosamente',
      transferencia: formatTransferencia(result.transferencia),
      idempotent: false
    })
  } catch (err) {
    console.error('❌ Error creando transferencia:', err)
    return res.status(500).json({ error: 'Error al crear transferencia' })
  }
}

// ──────────────────────────────────────────────────────────────────
//  GET /inventario/transferencias — Listado histórico
// ──────────────────────────────────────────────────────────────────
exports.listar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const context = assertTenantRequestContext(req.context)
    const branchMode = context.branch.mode
    const contextSucursalId = context.branch.sucursalId

    const pagina = Math.max(parseInt(req.query.pagina) || 1, 1)
    const tamano = Math.min(Math.max(parseInt(req.query.tamano) || 50, 1), 200)
    const desde = req.query.desde || null
    const hasta = req.query.hasta || null

    const where = { empresaId }

    // Date filter
    if (desde && hasta) {
      where.creadoEn = { gte: new Date(desde), lte: new Date(new Date(hasta).setHours(23, 59, 59, 999)) }
    } else if (desde) {
      where.creadoEn = { gte: new Date(desde) }
    } else if (hasta) {
      where.creadoEn = { lte: new Date(new Date(hasta).setHours(23, 59, 59, 999)) }
    }

    // Branch scope
    if (branchMode === BRANCH_MODE.SELECTED || branchMode === BRANCH_MODE.FIXED) {
      where.OR = [
        { sucursalOrigenId: contextSucursalId },
        { sucursalDestinoId: contextSucursalId }
      ]
    }

    // Optional sucursal filter for NONE mode
    if (branchMode === BRANCH_MODE.NONE && req.query.sucursalId) {
      const filterSucId = parseInt(req.query.sucursalId)
      if (filterSucId) {
        where.OR = [
          { sucursalOrigenId: filterSucId },
          { sucursalDestinoId: filterSucId }
        ]
      }
    }

    const [total, transferencias] = await Promise.all([
      prisma.transferenciaInventario.count({ where }),
      prisma.transferenciaInventario.findMany({
        where,
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * tamano,
        take: tamano,
        include: {
          SucursalOrigen: { select: { id: true, nombre: true } },
          SucursalDestino: { select: { id: true, nombre: true } },
          CreadoPor: { select: { id: true, nombre: true } },
          Detalle: {
            select: { cantidad: true, productoId: true }
          }
        }
      })
    ])

    const results = transferencias.map(t => ({
      id: t.id,
      folio: `TRF-${String(t.id).padStart(6, '0')}`,
      creadoEn: t.creadoEn,
      origen: t.SucursalOrigen,
      destino: t.SucursalDestino,
      totalProductos: t.Detalle.length,
      totalUnidades: t.Detalle.reduce((sum, d) => sum + parseFloat(d.cantidad), 0),
      usuario: t.CreadoPor,
      notas: t.notas
    }))

    return res.json({
      transferencias: results,
      pagination: { total, pagina, tamano, paginas: Math.ceil(total / tamano) }
    })
  } catch (err) {
    console.error('❌ Error listando transferencias:', err)
    return res.status(500).json({ error: 'Error al listar transferencias' })
  }
}

// ──────────────────────────────────────────────────────────────────
//  GET /inventario/transferencias/:id — Detalle
// ──────────────────────────────────────────────────────────────────
exports.detalle = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const context = assertTenantRequestContext(req.context)
    const branchMode = context.branch.mode
    const contextSucursalId = context.branch.sucursalId
    const id = parseInt(req.params.id)

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'ID de transferencia inválido' })
    }

    const transferencia = await prisma.transferenciaInventario.findFirst({
      where: { id, empresaId },
      include: {
        SucursalOrigen: { select: { id: true, nombre: true } },
        SucursalDestino: { select: { id: true, nombre: true } },
        CreadoPor: { select: { id: true, nombre: true } },
        Detalle: {
          include: {
            Producto: { select: { id: true, nombre: true, codigoInterno: true, unidadVenta: true } }
          }
        }
      }
    })

    if (!transferencia) {
      return res.status(404).json({ error: 'Transferencia no encontrada' })
    }

    // Branch scope check
    if (branchMode === BRANCH_MODE.SELECTED || branchMode === BRANCH_MODE.FIXED) {
      const participates = transferencia.sucursalOrigenId === contextSucursalId || transferencia.sucursalDestinoId === contextSucursalId
      if (!participates) {
        return res.status(404).json({ error: 'Transferencia no encontrada' })
      }
    }

    return res.json({
      transferencia: {
        id: transferencia.id,
        folio: `TRF-${String(transferencia.id).padStart(6, '0')}`,
        creadoEn: transferencia.creadoEn,
        origen: transferencia.SucursalOrigen,
        destino: transferencia.SucursalDestino,
        usuario: transferencia.CreadoPor,
        notas: transferencia.notas,
        clientTransferId: transferencia.clientTransferId,
        items: transferencia.Detalle.map(d => ({
          producto: d.Producto,
          cantidad: parseFloat(d.cantidad),
          stockOrigenAntes: parseFloat(d.stockOrigenAntes),
          stockOrigenDespues: parseFloat(d.stockOrigenDespues),
          stockDestinoAntes: parseFloat(d.stockDestinoAntes),
          stockDestinoDespues: parseFloat(d.stockDestinoDespues),
          costoUnitario: d.costoUnitario ? parseFloat(d.costoUnitario) : null
        }))
      }
    })
  } catch (err) {
    console.error('❌ Error obteniendo transferencia:', err)
    return res.status(500).json({ error: 'Error al obtener transferencia' })
  }
}

function formatTransferencia(t) {
  return {
    id: t.id,
    folio: `TRF-${String(t.id).padStart(6, '0')}`,
    creadoEn: t.creadoEn,
    sucursalOrigenId: t.sucursalOrigenId,
    sucursalDestinoId: t.sucursalDestinoId,
    clientTransferId: t.clientTransferId,
    notas: t.notas,
    items: (t.Detalle || []).map(d => ({
      productoId: d.productoId,
      cantidad: parseFloat(d.cantidad)
    }))
  }
}
