const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')

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

module.exports = { listar }
