const bcrypt = require('bcryptjs')
const prisma  = require('../../lib/prisma')
const { puedeGestionar, ROLES_ASIGNABLES_POR_SUPERADMIN } = require('../../utils/roles')
const {
  validarEstadoUsuarioPorRol,
  normalizarIdPositivo,
  crearErrorPoliticaUsuario
} = require('../../utils/usuario-policy')
const getEmpresaId = require('../../helpers/getEmpresaId')

function policyError(code, message) {
  const err = new Error(message)
  err.name = 'UserPolicyError'
  err.code = code
  err.expose = true
  return err
}

async function registrarAudit(solicitante, accion, referencia, ip) {
  try {
    const data = { accion, modulo: 'usuarios', referencia, ip }
    if (solicitante.sucursalId) data.sucursalId = solicitante.sucursalId
    if (solicitante.id) data.usuarioId = solicitante.id
    await prisma.auditoria.create({ data })
  } catch (e) { console.error('Audit error:', e.message) }
}

async function prevalidarActor(actorUsuarioId) {
  const actor = await prisma.usuario.findUnique({
    where: { id: actorUsuarioId },
    select: { id: true, activo: true, rol: true, empresaId: true }
  })
  if (!actor || !actor.activo) throw policyError('ACTOR_NO_AUTORIZADO', 'No autorizado')
  if (actor.rol !== 'SUPERADMIN') throw policyError('ACTOR_NO_AUTORIZADO', 'No autorizado')
  if (!actor.empresaId || !Number.isSafeInteger(Number(actor.empresaId)) || Number(actor.empresaId) <= 0) {
    throw policyError('ACTOR_SIN_EMPRESA', 'No autorizado')
  }
  const empresa = await prisma.empresa.findUnique({
    where: { id: Number(actor.empresaId) },
    select: { id: true, activa: true }
  })
  if (!empresa || !empresa.activa) throw policyError('EMPRESA_INACTIVA', 'Operación no disponible')
}

async function rehidratarActorEnTx(tx, actorUsuarioId) {
  const actorRows = await tx.$queryRaw`
    SELECT id, rol, activo, "empresaId"
    FROM "Usuario"
    WHERE id = ${actorUsuarioId}
    FOR SHARE
  `
  if (!Array.isArray(actorRows) || actorRows.length === 0) {
    throw policyError('ACTOR_NO_AUTORIZADO', 'No autorizado')
  }
  const actor = actorRows[0]
  const empresaId = Number(actor.empresaId)
  if (!actor.activo) throw policyError('ACTOR_NO_AUTORIZADO', 'No autorizado')
  if (actor.rol !== 'SUPERADMIN') throw policyError('ACTOR_NO_AUTORIZADO', 'No autorizado')
  if (!actor.empresaId || !Number.isSafeInteger(empresaId) || empresaId <= 0) {
    throw policyError('ACTOR_SIN_EMPRESA', 'No autorizado')
  }
  const empRows = await tx.$queryRaw`
    SELECT id, activa
    FROM "Empresa"
    WHERE id = ${empresaId}
    FOR SHARE
  `
  if (!Array.isArray(empRows) || empRows.length === 0 || !empRows[0].activa) {
    throw policyError('EMPRESA_INACTIVA', 'Operación no disponible')
  }
  return { actorEmpresaId: empresaId, empresa: empRows[0] }
}

function construirDataCreacion(body) {
  const permitido = ['nombre', 'username', 'password', 'confirmarPassword', 'rol', 'sucursalId']
  const extra = Object.keys(body).filter(k => !permitido.includes(k))
  if (extra.length > 0) {
    if (extra.includes('empresaId')) throw policyError('EMPRESA_NO_MODIFICABLE', 'No puedes modificar la empresa del usuario')
  }
  const data = {
    nombre: body.nombre,
    username: body.username,
    password: body.password,
    confirmarPassword: body.confirmarPassword,
    rol: body.rol
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sucursalId')) {
    data.sucursalId = body.sucursalId
  }
  return data
}

function construirDataEdicion(body) {
  const permitido = ['nombre', 'username', 'password', 'confirmarPassword', 'rol', 'sucursalId']
  const extra = Object.keys(body).filter(k => !permitido.includes(k))
  if (extra.length > 0) {
    if (extra.includes('empresaId')) throw policyError('EMPRESA_NO_MODIFICABLE', 'No puedes modificar la empresa del usuario')
  }
  return body
}

function extractSucursalIdCrear(body) {
  const tiene = Object.prototype.hasOwnProperty.call(body, 'sucursalId')
  if (!tiene) return null
  const val = body.sucursalId
  if (val === null) return null
  if (typeof val !== 'number') {
    throw policyError('SUCURSAL_INVALIDA', 'Sucursal inválida')
  }
  return normalizarIdPositivo(val, { codigo: 'SUCURSAL_INVALIDA', mensaje: 'Sucursal inválida' })
}

function extractSucursalIdEditar(body) {
  const tiene = Object.prototype.hasOwnProperty.call(body, 'sucursalId')
  if (!tiene) return undefined
  const val = body.sucursalId
  if (val === null) return null
  if (typeof val !== 'number') {
    throw policyError('SUCURSAL_INVALIDA', 'Sucursal inválida')
  }
  return normalizarIdPositivo(val, { codigo: 'SUCURSAL_INVALIDA', mensaje: 'Sucursal inválida' })
}

async function consultarSucursalEnTenant(tx, sucursalId, actorEmpresaId) {
  if (sucursalId === null || sucursalId === undefined) return null
  const sucursal = await tx.sucursal.findFirst({
    where: { id: sucursalId, empresaId: actorEmpresaId },
    select: { id: true, empresaId: true, activa: true }
  })
  if (!sucursal) throw policyError('SUCURSAL_INVALIDA', 'Sucursal inválida')
  if (!sucursal.activa) throw policyError('SUCURSAL_INACTIVA', 'La sucursal del usuario está inactiva')
  return sucursal
}

function mapearErrorController(err, res) {
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'El nombre de usuario ya existe en esta empresa' })
  }
  if (err.code === 'P2034') {
    return res.status(409).json({ error: 'Conflicto de concurrencia. Intenta de nuevo.' })
  }
  if (err.name === 'UserPolicyError') {
    if (err.code === 'USUARIO_NO_ENCONTRADO') {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }
    const status = err.code === 'ACTOR_NO_AUTORIZADO' || err.code === 'ACTOR_SIN_EMPRESA' || err.code === 'EMPRESA_INACTIVA' || err.code === 'USUARIO_PROTEGIDO' ? 403 : 400
    return res.status(status).json({ error: err.message })
  }
  console.error('Error en usuarios.controller:', err)
  return res.status(500).json({ error: 'Error interno del servidor' })
}

const listar = async (req, res) => {
  try {
    const { rol, sucursalId, buscar, activo } = req.query
    const solicitante = req.usuario
    const empresaId = getEmpresaId(req)
    const where = { empresaId }
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

const crear = async (req, res) => {
  try {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Cuerpo de solicitud inválido' })
    }

    const actorUsuarioId = normalizarIdPositivo(req.usuario.id, {
      codigo: 'ACTOR_NO_AUTORIZADO', mensaje: 'No autorizado'
    })

    const body = construirDataCreacion(req.body)

    if (!body.nombre || !body.username || !body.password || !body.rol) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' })
    }

    if (body.password !== body.confirmarPassword) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' })
    }
    if (body.password.length < 6) {
      return res.status(400).json({ error: 'Mínimo 6 caracteres' })
    }

    if (!ROLES_ASIGNABLES_POR_SUPERADMIN.has(body.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para crear este tipo de usuario' })
    }
    if (!puedeGestionar('SUPERADMIN', body.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para crear este tipo de usuario' })
    }

    await prevalidarActor(actorUsuarioId)

    const passwordHash = await bcrypt.hash(body.password, 10)

    const sucursalId = extractSucursalIdCrear(body)

    const resultado = await prisma.$transaction(async (tx) => {
      const { actorEmpresaId, empresa } = await rehidratarActorEnTx(tx, actorUsuarioId)

      const rolFinal = body.rol
      const empresaIdFinal = actorEmpresaId

      if (sucursalId !== null) {
        await consultarSucursalEnTenant(tx, sucursalId, actorEmpresaId)
      }

      validarEstadoUsuarioPorRol({
        rol: rolFinal,
        empresaId: empresaIdFinal,
        empresa,
        sucursalId,
        sucursal: sucursalId !== null ? { id: sucursalId, empresaId: actorEmpresaId, activa: true } : null
      })

      const existe = await tx.usuario.findUnique({
        where: { empresaId_username: { empresaId: empresaIdFinal, username: body.username } }
      })
      if (existe) {
        const err = new Error('El nombre de usuario ya existe en esta empresa')
        err.code = 'P2002'
        throw err
      }

      const usuario = await tx.usuario.create({
        data: {
          nombre: body.nombre,
          username: body.username,
          passwordHash,
          rol: rolFinal,
          sucursalId,
          activo: true,
          empresaId: empresaIdFinal
        },
        select: { id: true, nombre: true, username: true, rol: true, activo: true, tienePin: true, Sucursal: { select: { id: true, nombre: true } } }
      })

      return usuario
    }, { isolationLevel: 'Serializable' })

    await registrarAudit(
      { id: actorUsuarioId, ...req.usuario },
      'CREAR_USUARIO',
      `${req.usuario.nombre} creo al usuario ${body.username} con rol ${body.rol}`,
      req.ip
    )

    res.status(201).json(resultado)
  } catch (err) {
    return mapearErrorController(err, res)
  }
}

const editar = async (req, res) => {
  try {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Cuerpo de solicitud inválido' })
    }

    const actorUsuarioId = normalizarIdPositivo(req.usuario.id, {
      codigo: 'ACTOR_NO_AUTORIZADO', mensaje: 'No autorizado'
    })
    const objetivoId = normalizarIdPositivo(parseInt(req.params.id), {
      codigo: 'USUARIO_NO_ENCONTRADO', mensaje: 'Usuario no encontrado'
    })

    const body = req.body

    if (Object.prototype.hasOwnProperty.call(body, 'empresaId')) {
      throw policyError('EMPRESA_NO_MODIFICABLE', 'No puedes modificar la empresa del usuario')
    }

    let passwordHash = undefined
    if (Object.prototype.hasOwnProperty.call(body, 'password') && body.password) {
      if (!Object.prototype.hasOwnProperty.call(body, 'confirmarPassword') || !body.confirmarPassword) {
        return res.status(400).json({ error: 'Debes confirmar la nueva contraseña' })
      }
      if (body.password !== body.confirmarPassword) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden' })
      }
      if (body.password.length < 6) {
        return res.status(400).json({ error: 'Mínimo 6 caracteres' })
      }
      passwordHash = await bcrypt.hash(body.password, 10)
    }

    await prevalidarActor(actorUsuarioId)

    const resultado = await prisma.$transaction(async (tx) => {
      const { actorEmpresaId, empresa } = await rehidratarActorEnTx(tx, actorUsuarioId)

      const objRows = await tx.$queryRaw`
        SELECT id, rol, activo, "empresaId", "sucursalId", nombre, username
        FROM "Usuario"
        WHERE id = ${objetivoId}
          AND "empresaId" = ${actorEmpresaId}
        FOR UPDATE
      `
      if (!Array.isArray(objRows) || objRows.length === 0) {
        throw policyError('USUARIO_NO_ENCONTRADO', 'Usuario no encontrado')
      }
      const objetivo = objRows[0]

      const objetivoRol = objetivo.rol
      if (objetivoRol === 'SUPERADMIN' || objetivoRol === 'PLATFORM_ADMIN') {
        throw policyError('USUARIO_PROTEGIDO', 'No tienes permisos para gestionar este usuario')
      }
      if (!puedeGestionar('SUPERADMIN', objetivoRol)) {
        throw policyError('USUARIO_PROTEGIDO', 'No tienes permisos para gestionar este usuario')
      }

      const nextState = {
        rol: Object.prototype.hasOwnProperty.call(body, 'rol') ? body.rol : objetivo.rol,
        empresaId: actorEmpresaId,
        sucursalId: extractSucursalIdEditar(body)
      }

      if (nextState.sucursalId === undefined) {
        nextState.sucursalId = Number(objetivo.sucursalId) || null
      }

      if (!ROLES_ASIGNABLES_POR_SUPERADMIN.has(nextState.rol)) {
        throw policyError('ROL_INVALIDO', 'No tienes permisos para asignar este rol')
      }
      if (!puedeGestionar('SUPERADMIN', nextState.rol)) {
        throw policyError('ROL_INVALIDO', 'No tienes permisos para asignar este rol')
      }

      let sucursal = null
      if (nextState.sucursalId !== null && nextState.sucursalId !== undefined) {
        sucursal = await consultarSucursalEnTenant(tx, nextState.sucursalId, actorEmpresaId)
      }

      validarEstadoUsuarioPorRol({
        rol: nextState.rol,
        empresaId: nextState.empresaId,
        empresa,
        sucursalId: nextState.sucursalId,
        sucursal
      })

      const data = {}
      if (Object.prototype.hasOwnProperty.call(body, 'nombre')) data.nombre = body.nombre
      if (Object.prototype.hasOwnProperty.call(body, 'username')) data.username = body.username
      if (Object.prototype.hasOwnProperty.call(body, 'rol')) data.rol = nextState.rol
      if (Object.prototype.hasOwnProperty.call(body, 'sucursalId')) data.sucursalId = nextState.sucursalId
      if (passwordHash !== undefined) data.passwordHash = passwordHash

      const updateResult = await tx.usuario.updateMany({
        where: { id: Number(objetivo.id), empresaId: actorEmpresaId },
        data
      })

      if (updateResult.count !== 1) {
        throw new Error('Unexpected update count')
      }

      const usuarioActualizado = await tx.usuario.findUnique({
        where: { id: Number(objetivo.id) },
        select: { id: true, nombre: true, username: true, rol: true, activo: true, tienePin: true, Sucursal: { select: { id: true, nombre: true } } }
      })

      return usuarioActualizado
    }, { isolationLevel: 'Serializable' })

    await registrarAudit(
      { id: actorUsuarioId, ...req.usuario },
      'EDITAR_USUARIO',
      `${req.usuario.nombre} edito al usuario ${resultado.username}`,
      req.ip
    )

    res.json(resultado)
  } catch (err) {
    return mapearErrorController(err, res)
  }
}

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

const establecerPin = async (req, res) => {
  try {
    const { id }  = req.params
    const { pin } = req.body
    const solicitante = req.usuario

    if (!pin) return res.status(400).json({ error: 'PIN requerido' })
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'El PIN debe ser exactamente 4 dígitos numéricos' })

    const objetivo = await prisma.usuario.findUnique({ where: { id: parseInt(id) } })
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado' })

    if (!puedeGestionar(solicitante.rol, objetivo.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para gestionar este usuario' })
    }
    if (solicitante.rol === 'ADMIN_SUCURSAL' && objetivo.sucursalId !== solicitante.sucursalId) {
      return res.status(403).json({ error: 'El usuario no pertenece a tu sucursal' })
    }

    const pinHash = await bcrypt.hash(pin, 10)
    await prisma.usuario.update({ where: { id: parseInt(id) }, data: { pin: pinHash, tienePin: true } })

    await registrarAudit(solicitante, 'ESTABLECER_PIN', `${solicitante.nombre} asignó PIN al usuario ${objetivo.username}`, req.ip)
    res.json({ success: true, mensaje: 'PIN establecido correctamente' })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al establecer PIN' }) }
}

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

const listarVendedores = async (req, res) => {
  try {
    const empresaId = getEmpresaId(req)
    const { branch } = req.context
    const where = { activo: true, empresaId }

    if (branch.mode === 'FIXED' || branch.mode === 'SELECTED') {
      if (branch.sucursalId) {
        where.OR = [
          { sucursalId: branch.sucursalId },
          { rol: 'SUPERADMIN' }
        ]
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
    console.error('Error listar responsables bitacora:', err)
    res.status(err.status || 500).json({
      error: err.status ? err.message : 'Error al obtener responsables'
    })
  }
}

const listarSucursales = async (req, res) => {
  try {
    const { rol, empresaId: tokenEmpresaId } = req.usuario || {}
    const where = { activa: true, empresaId: getEmpresaId(req) }

    const sucursales = await prisma.sucursal.findMany({
      where,
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' }
    })
    res.json(sucursales)
  } catch (err) { res.status(500).json({ error: 'Error al obtener sucursales' }) }
}

module.exports = { listar, crear, editar, cambiarEstado, resetPassword, establecerPin, verificarPin, listarSucursales, listarVendedores, listarResponsablesBitacora }
