const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { assertTenantRequestContext, BRANCH_MODE } = require('../../security/request-context')

const listar = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)

    if (!empresaId) {
      return res.status(403).json({ error: 'No se pudo determinar la empresa del usuario' })
    }

    const sucursales = await prisma.sucursal.findMany({
      where: { empresaId, activa: true },
      select: { id: true, nombre: true, direccion: true, activa: true },
      orderBy: { nombre: 'asc' }
    })

    res.json(sucursales)
  } catch (err) {
    console.error('Error al obtener sucursales:', err)
    res.status(500).json({ error: 'Error al obtener sucursales' })
  }
}

const listarDisponibles = async (req, res) => {
  try {
    const context = assertTenantRequestContext(req.context)

    const empresaId = context.tenant.empresaId
    const rol = context.actor.rol
    const mode = context.branch.mode
    const sucursalId = context.branch.sucursalId

    if (mode === BRANCH_MODE.FIXED) {
      const sucursal = await prisma.sucursal.findUnique({
        where: { id: sucursalId },
        select: { id: true, nombre: true, activa: true }
      })
      return res.json({
        sucursales: sucursal && sucursal.activa
          ? [{ id: sucursal.id, nombre: sucursal.nombre, activa: true }]
          : []
      })
    }

    const sucursales = await prisma.sucursal.findMany({
      where: { empresaId, activa: true },
      select: { id: true, nombre: true, activa: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }]
    })

    res.json({ sucursales })
  } catch (err) {
    if (err.code && err.status) throw err
    console.error('Error al obtener sucursales disponibles:', err)
    res.status(500).json({ error: 'Error al obtener sucursales' })
  }
}

module.exports = { listar, listarDisponibles }
