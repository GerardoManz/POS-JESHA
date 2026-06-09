const bcrypt = require('bcryptjs')
const prisma  = require('../../lib/prisma')
const { puedeGestionar } = require('../../utils/roles')
const getEmpresaId = require('../../helpers/getEmpresaId')

async function registrarAudit(solicitante, accion, referencia, ip) {
  try {
    const data = { accion, modulo: 'usuarios', referencia, ip }
    if (solicitante.sucursalId) data.sucursalId = solicitante.sucursalId
    if (solicitante.id) data.usuarioId = solicitante.id
    await prisma.auditoria.create({ data })
  } catch (e) { console.error('Audit error:', e.message) }
}

// GET /usuarios
const listar = async (req, res) => {
  try {
    const { rol, sucursalId, buscar, activo } = req.query
    const solicitante = req.usuario
    const where = {}
    if (solicitante.rol === 'ADMIN_SUCURSAL') { where.sucursalId = solicitante.sucursalId; where.rol = { not: 'SUPERADMIN' } }
    if (rol)        where.rol        = rol
    if (sucursalId) where.sucursalId = parseInt(sucursalId)
    if (activo !== undefined) where.activo = activo === 'true'
    if (buscar) { where.OR = [{ nombre: { contains: buscar, mode: 'insensitive' } }, { username: { contains: buscar, mode: 'insensitive' } }] }

    const usuarios = await prisma.usuario.findMany({
      where,
      select: {
        id: true, nombre: true, username: true, rol: true, activo: true, creadoEn: true,
        tienePin: true,
        sucursalId: true,
        Sucursal: { select: { id: true, nombre: true } },
        Auditoria: { where: { accion: 'LOGIN' }, orderBy: { creadoEn: 'desc' }, take: 1, select: { creadoEn: true } }
      },
      orderBy: { creadoEn: 'desc' }
    })

    res.json(usuarios.map(u => ({ ...u, ultimoLogin: u.Auditoria[0]?.creadoEn || null, Auditoria: undefined })))
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener usuarios' }) }
}

// POST /usuarios
const crear = async (req, res) => {
  try {
    // Extraer empresaId del cuerpo de la solicitud
    const { nombre, username, password, confirmarPassword, rol, sucursalId, empresaId: empresaIdBody } = req.body
    const solicitante = req.usuario

    // Validaciones básicas
    if (!nombre || !username || !password || !rol) return res.status(400).json({ error: 'Faltan campos obligatorios' })
    if (password !== confirmarPassword) return res.status(400).json({ error: 'Las contraseñas no coinciden' })

    // --- Verificaciones de permisos (jerarquía) ---
    if (!puedeGestionar(solicitante.rol, rol)) {
      return res.status(403).json({ error: 'No tienes permisos para crear este tipo de usuario' })
    }

    // Restricciones adicionales para ADMIN_SUCURSAL
    if (solicitante.rol === 'ADMIN_SUCURSAL') {
      if (rol === 'ADMIN_SUCURSAL' && empresaIdBody && parseInt(empresaIdBody) !== solicitante.empresaId) {
        return res.status(403).json({ error: 'No tienes permiso para crear administradores de otras empresas' })
      }
      if (sucursalId && parseInt(sucursalId) !== solicitante.sucursalId) {
        return res.status(403).json({ error: 'No tienes permiso para asignar sucursal fuera de tu empresa' })
      }
    }

    // --- Determinar el empresaId para el nuevo usuario ---
    let nuevaEmpresaId = null;
    if (solicitante.rol === 'ADMIN_SUCURSAL') {
      // ADMIN_SUCURSAL crea usuarios para su propia empresa
      nuevaEmpresaId = solicitante.empresaId;
    } else if (solicitante.rol === 'SUPERADMIN' || solicitante.rol === 'PLATFORM_ADMIN') {
      // SUPERADMIN/PLATFORM_ADMIN puede especificar empresaId o crear usuarios globales
      if (empresaIdBody) {
        nuevaEmpresaId = parseInt(empresaIdBody);
      } else if (rol !== 'SUPERADMIN' && rol !== 'PLATFORM_ADMIN') {
        // Si el rol a crear no es SUPERADMIN/PLATFORM_ADMIN, empresaId es obligatorio
        return res.status(400).json({ error: 'Para este rol, empresaId es obligatorio para el nuevo usuario' });
      }
      // Si el rol es SUPERADMIN/PLATFORM_ADMIN y no se especifica empresaId, se asume global (null)
    }

    // --- Verificación de unicidad del nombre de usuario ---
    let existe;
    if (nuevaEmpresaId !== null) {
      // Para usuarios con empresaId, usar el unique compuesto
      existe = await prisma.usuario.findUnique({
        where: { empresaId_username: { empresaId: nuevaEmpresaId, username } }
      });
    } else {
      // Para usuarios globales (empresaId: null), usar findFirst para buscar unicidad
      // Nota: La restricción de unicidad de DB con NULL es permisiva, esto es una mitigación a nivel de aplicación.
      existe = await prisma.usuario.findFirst({
        where: { empresaId: null, username }
      });
    }

    if (existe) {
      return res.status(409).json({ error: 'El nombre de usuario ya existe en esta empresa o como usuario global' })
    }

    // --- Preparar sucursalId para el nuevo usuario ---
    // Si el solicitante es ADMIN_SUCURSAL, la sucursal del nuevo usuario debe ser la suya.
    // De lo contrario, se usa la sucursalId proporcionada en el body (si existe) o null.
    const sucId = solicitante.rol === 'ADMIN_SUCURSAL' ? solicitante.sucursalId : (sucursalId ? parseInt(sucursalId) : null)
    
    // --- Hashear contraseña y crear usuario ---
    const hash  = await bcrypt.hash(password, 10)
    const usuario = await prisma.usuario.create({
      data: {
        nombre,
        username,
        passwordHash: hash,
        rol,
        sucursalId: sucId,
        activo: true,
        empresaId: nuevaEmpresaId // Asignar el empresaId determinado
      },
      select: { id: true, nombre: true, username: true, rol: true, activo: true, tienePin: true, Sucursal: { select: { id: true, nombre: true } } }
    })
    await registrarAudit(solicitante, 'CREAR_USUARIO', `${solicitante.nombre} creo al usuario ${username} con rol ${rol}`, req.ip)
    res.status(201).json(usuario)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al crear usuario' }) }
}

// PUT /usuarios/:id
const editar = async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, username, rol, sucursalId, password, confirmarPassword } = req.body
    const solicitante = req.usuario
    const objetivo = await prisma.usuario.findUnique({ where: { id: parseInt(id) } })
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado' })
    // Verificar jerarquía: no se puede editar a un usuario de igual o mayor nivel
    if (!puedeGestionar(solicitante.rol, objetivo.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para editar este usuario' })
    }
    // ADMIN_SUCURSAL: no puede cambiarse su propio rol
    if (solicitante.rol === 'ADMIN_SUCURSAL' && parseInt(id) === solicitante.id && rol && rol !== objetivo.rol) {
      return res.status(403).json({ error: 'No puedes cambiar tu propio rol' })
    }
    const data = { nombre, username }
    if (rol)                    data.rol        = rol
    if (sucursalId !== undefined) data.sucursalId = sucursalId ? parseInt(sucursalId) : null
    // ── Contraseña opcional ──
    if (password) {
      if (!confirmarPassword)            return res.status(400).json({ error: 'Debes confirmar la nueva contraseña' })
      if (password !== confirmarPassword) return res.status(400).json({ error: 'Las contraseñas no coinciden' })
      if (password.length < 6)           return res.status(400).json({ error: 'Mínimo 6 caracteres' })
      data.passwordHash = await bcrypt.hash(password, 10)
    }
    const usuario = await prisma.usuario.update({
      where: { id: parseInt(id) }, data,
      select: { id: true, nombre: true, username: true, rol: true, activo: true, tienePin: true, Sucursal: { select: { id: true, nombre: true } } }
    })
    await registrarAudit(solicitante, 'EDITAR_USUARIO', `${solicitante.nombre} edito al usuario ${objetivo.username}`, req.ip)
    res.json(usuario)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al editar usuario' }) }
}

// PATCH /usuarios/:id/estado
const cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params
    const { activo } = req.body
    const solicitante = req.usuario
    const objetivo = await prisma.usuario.findUnique({ where: { id: parseInt(id) } })
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado' })
    if (!puedeGestionar(solicitante.rol, objetivo.rol)) return res.status(403).json({ error: 'No tienes permisos para gestionar este usuario' })
    const usuario = await prisma.usuario.update({ where: { id: parseInt(id) }, data: { activo }, select: { id: true, nombre: true, activo: true } })
    await registrarAudit(solicitante, activo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO', `${solicitante.nombre} ${activo ? 'activo' : 'desactivo'} al usuario ${objetivo.username}`, req.ip)
    res.json(usuario)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al cambiar estado' }) }
}

// POST /usuarios/:id/reset-password
const resetPassword = async (req, res) => {
  try {
    const { id } = req.params
    const { password, confirmarPassword } = req.body
    const solicitante = req.usuario
    if (!password || !confirmarPassword) return res.status(400).json({ error: 'Faltan campos obligatorios' })
    if (password !== confirmarPassword)  return res.status(400).json({ error: 'Las contrasenas no coinciden' })
    if (password.length < 6)            return res.status(400).json({ error: 'Minimo 6 caracteres' })
    const objetivo = await prisma.usuario.findUnique({ where: { id: parseInt(id) } })
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado' })
    if (!puedeGestionar(solicitante.rol, objetivo.rol)) return res.status(403).json({ error: 'No tienes permisos para gestionar este usuario' })
    const hash = await bcrypt.hash(password, 10)
    await prisma.usuario.update({ where: { id: parseInt(id) }, data: { passwordHash: hash } })
    await registrarAudit(solicitante, 'RESET_PASSWORD', `${solicitante.nombre} reseteo la contrasena de ${objetivo.username}`, req.ip)
    res.json({ mensaje: 'Contrasena actualizada correctamente' })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al resetear contrasena' }) }
}

// ════════════════════════════════════════════════════════════════════
//  POST /usuarios/:id/pin — Establecer/cambiar PIN de 4 dígitos
// ════════════════════════════════════════════════════════════════════
const establecerPin = async (req, res) => {
  try {
    const { id }  = req.params
    const { pin } = req.body
    const solicitante = req.usuario

    if (!pin) return res.status(400).json({ error: 'PIN requerido' })
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'El PIN debe ser exactamente 4 dígitos numéricos' })

    const objetivo = await prisma.usuario.findUnique({ where: { id: parseInt(id) } })
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado' })

    // Jerarquía: solo roles superiores pueden asignar PIN
    if (!puedeGestionar(solicitante.rol, objetivo.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para gestionar este usuario' })
    }
    // ADMIN_SUCURSAL solo puede asignar PIN a usuarios de su sucursal
    if (solicitante.rol === 'ADMIN_SUCURSAL' && objetivo.sucursalId !== solicitante.sucursalId) {
      return res.status(403).json({ error: 'El usuario no pertenece a tu sucursal' })
    }

    const pinHash = await bcrypt.hash(pin, 10)
    await prisma.usuario.update({ where: { id: parseInt(id) }, data: { pin: pinHash, tienePin: true } })

    await registrarAudit(solicitante, 'ESTABLECER_PIN', `${solicitante.nombre} asignó PIN al usuario ${objetivo.username}`, req.ip)
    res.json({ success: true, mensaje: 'PIN establecido correctamente' })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al establecer PIN' }) }
}

// ════════════════════════════════════════════════════════════════════
//  POST /usuarios/:id/verificar-pin — Verificar PIN (desde POS)
//  Ruta pública con auth normal — el POS la llama al seleccionar vendedor
// ════════════════════════════════════════════════════════════════════
const verificarPin = async (req, res) => {
  try {
    const { id }  = req.params
    const { pin } = req.body

    if (!pin) return res.status(400).json({ error: 'PIN requerido' })

    const usuario = await prisma.usuario.findUnique({ where: { id: parseInt(id) }, select: { id: true, nombre: true, pin: true, tienePin: true, activo: true } })
    if (!usuario)        return res.status(404).json({ error: 'Usuario no encontrado' })
    if (!usuario.activo) return res.status(403).json({ error: 'Usuario inactivo' })
    if (!usuario.tienePin || !usuario.pin) return res.status(400).json({ error: 'Este usuario no tiene PIN configurado — pide al administrador que lo asigne' })

    const valido = await bcrypt.compare(pin, usuario.pin)
    if (!valido) return res.status(401).json({ error: 'PIN incorrecto' })

    res.json({ success: true, usuario: { id: usuario.id, nombre: usuario.nombre } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al verificar PIN' }) }
}

// GET /usuarios/vendedores — para el POS (cualquier rol autenticado)
// Devuelve solo id+nombre de usuarios activos de la misma sucursal
const listarVendedores = async (req, res) => {
  try {
    const { sucursalId, rol } = req.usuario
    const where = { activo: true }
    // SUPERADMIN ve todos; los demás ven su sucursal + SUPERADMIN
    if (rol !== 'SUPERADMIN') {
      if (sucursalId) {
        where.OR = [
          { sucursalId },
          { rol: 'SUPERADMIN' }
        ]
      } else {
        // ADMIN_SUCURSAL/EMPLEADO sin sucursal asignada — no debería ocurrir
        return res.status(400).json({ error: 'Usuario sin sucursal asignada' })
      }
    }

    const vendedores = await prisma.usuario.findMany({
      where,
      select: { id: true, nombre: true, rol: true },
      orderBy: { nombre: 'asc' }
    })
    res.json(vendedores)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener vendedores' }) }
}

// GET /usuarios/responsables-bitacora — para Bitácora (cualquier rol autenticado)
// Devuelve id+nombre de usuarios activos de la MISMA empresa.
const listarResponsablesBitacora = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const responsables = await prisma.usuario.findMany({
      where: { empresaId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' }
    })
    res.json(responsables)
  } catch (err) {
    console.error('❌ listar responsables bitacora:', err)
    res.status(err.status || 500).json({
      error: err.status ? err.message : 'Error al obtener responsables'
    })
  }
}

// GET /usuarios/sucursales
const listarSucursales = async (req, res) => {
  try {
    const sucursales = await prisma.sucursal.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } })
    res.json(sucursales)
  } catch (err) { res.status(500).json({ error: 'Error al obtener sucursales' }) }
}

module.exports = { listar, crear, editar, cambiarEstado, resetPassword, establecerPin, verificarPin, listarSucursales, listarVendedores, listarResponsablesBitacora }
