'use strict'

// ════════════════════════════════════════════════════════════════════
//  P0-SEED v2 — Bootstrap local multi-tenant seguro
//  Entrypoint canónico: npm run seed → node prisma/seed.js
// ════════════════════════════════════════════════════════════════════

const path = require('path')

// ════════════════════════════════════════════════════════════════════
//  SeedError
// ════════════════════════════════════════════════════════════════════
class SeedError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SeedError'
    this.code = code
  }
}

// ════════════════════════════════════════════════════════════════════
//  Constantes
// ════════════════════════════════════════════════════════════════════
const ADVISORY_LOCK_KEY = 876543210
const EMPRESA_SLUG = 'jesha'
const NOMBRE_SUCURSAL = 'Ferretería JESHA - Matriz'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const CLOUD_HOSTS = ['onrender.com', 'render.com', 'neon.tech', 'supabase.co', 'railway.app']

const USUARIO_SUPERADMIN = Object.freeze({
  username: 'Gerardo_Manz',
  nombre: 'Gerardo Manzano',
  rol: 'SUPERADMIN',
  sucursalId: null
})

const USUARIO_ADMIN_SUCURSAL = Object.freeze({
  username: 'admin',
  nombre: 'Admin Sucursal',
  rol: 'ADMIN_SUCURSAL'
})

const USUARIO_EMPLEADO = Object.freeze({
  username: 'empleado',
  nombre: 'Empleado POS',
  rol: 'EMPLEADO'
})

// ════════════════════════════════════════════════════════════════════
//  RESOLVER CONFIGURACIÓN (sin bcrypt, sin Prisma)
// ════════════════════════════════════════════════════════════════════
function resolverConfiguracion(env = process.env) {
  const SUPERADMIN_PASSWORD = env.SEED_SUPERADMIN_PASSWORD
  const ADMIN_PASSWORD = env.SEED_ADMIN_PASSWORD
  const EMPLEADO_PASSWORD = env.SEED_EMPLEADO_PASSWORD

  if (!SUPERADMIN_PASSWORD || typeof SUPERADMIN_PASSWORD !== 'string' || SUPERADMIN_PASSWORD.length === 0) {
    throw new SeedError('SEED_PASSWORD_REQUIRED', 'Falta SEED_SUPERADMIN_PASSWORD')
  }
  if (!ADMIN_PASSWORD || typeof ADMIN_PASSWORD !== 'string' || ADMIN_PASSWORD.length === 0) {
    throw new SeedError('SEED_PASSWORD_REQUIRED', 'Falta SEED_ADMIN_PASSWORD')
  }
  if (!EMPLEADO_PASSWORD || typeof EMPLEADO_PASSWORD !== 'string' || EMPLEADO_PASSWORD.length === 0) {
    throw new SeedError('SEED_PASSWORD_REQUIRED', 'Falta SEED_EMPLEADO_PASSWORD')
  }

  const target = env.SEED_TARGET
  if (!target || !['test', 'local'].includes(target)) {
    throw new SeedError('SEED_TARGET_INVALID', 'SEED_TARGET debe ser test o local')
  }

  const p0Conf = env.P0_SEED_CONFIRMATION
  const localConf = env.LOCAL_SEED_CONFIRMATION

  if (target === 'test') {
    if (localConf !== undefined) {
      throw new SeedError('SEED_CONFIRMATION_CONFLICT', 'LOCAL_SEED_CONFIRMATION no debe estar definida en modo test')
    }
    if (p0Conf !== 'SEED_JESHA_ISOLATED_TEST_ONLY') {
      throw new SeedError('SEED_CONFIRMATION_REQUIRED', 'Modo test requiere P0_SEED_CONFIRMATION=SEED_JESHA_ISOLATED_TEST_ONLY')
    }
  }

  if (target === 'local') {
    if (p0Conf !== undefined) {
      throw new SeedError('SEED_CONFIRMATION_CONFLICT', 'P0_SEED_CONFIRMATION no debe estar definida en modo local')
    }
    if (localConf !== 'SEED_JESHA_LOCAL_ONLY') {
      throw new SeedError('SEED_CONFIRMATION_REQUIRED', 'Modo local requiere LOCAL_SEED_CONFIRMATION=SEED_JESHA_LOCAL_ONLY')
    }
  }

  return {
    target,
    SUPERADMIN_PASSWORD,
    ADMIN_PASSWORD,
    EMPLEADO_PASSWORD
  }
}

// ════════════════════════════════════════════════════════════════════
//  VALIDAR DESTINO (sin Prisma)
// ════════════════════════════════════════════════════════════════════
function validarDestino(target, rawUrl = process.env.DATABASE_URL) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new SeedError('SEED_DATABASE_URL_INVALID', 'DATABASE_URL no definida')
  }

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new SeedError('SEED_DATABASE_URL_INVALID', 'DATABASE_URL no es una URL válida')
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new SeedError('SEED_DATABASE_URL_INVALID', 'Solo se permiten protocolos postgresql/postgres')
  }

  const hostnameRaw = parsed.hostname || ''
  const hostname = hostnameRaw === '[::1]' ? '::1' : hostnameRaw.toLowerCase()
  const dbName = (parsed.pathname || '').replace(/^\//, '')

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new SeedError('SEED_REMOTE_HOST_BLOCKED', 'Host no permitido')
  }

  if (CLOUD_HOSTS.some(h => hostname.includes(h))) {
    throw new SeedError('SEED_REMOTE_HOST_BLOCKED', 'Proveedor cloud bloqueado')
  }

  if (target === 'test') {
    if (!dbName.startsWith('jesha_p0_seed_test_')) {
      throw new SeedError('SEED_DATABASE_GUARD_FAILED', 'BD de test debe empezar con jesha_p0_seed_test_')
    }
    if (dbName === 'jesha_db') {
      throw new SeedError('SEED_DATABASE_GUARD_FAILED', 'jesha_db no permitida en modo test')
    }
  }

  if (target === 'local') {
    if (dbName !== 'jesha_db') {
      throw new SeedError('SEED_DATABASE_GUARD_FAILED', 'Modo local solo acepta jesha_db')
    }
  }

  return { hostname, dbName }
}

// ════════════════════════════════════════════════════════════════════
//  VALIDAR BD CONECTADA (exact match)
// ════════════════════════════════════════════════════════════════════
async function validarCurrentDatabase(prisma, dbNameEsperado) {
  try {
    const rows = await prisma.$queryRaw`SELECT current_database() AS db`
    const currentDb = (rows && rows.length > 0) ? rows[0].db : null

    if (!currentDb) {
      throw new SeedError('SEED_DATABASE_GUARD_FAILED', 'current_database() devolvió vacío')
    }

    if (currentDb !== dbNameEsperado) {
      throw new SeedError('SEED_DATABASE_GUARD_FAILED', 'current_database() no coincide con DATABASE_URL')
    }
  } catch (e) {
    if (e instanceof SeedError) throw e
    throw new SeedError('SEED_DATABASE_GUARD_FAILED', 'No se pudo verificar la base de datos')
  }
}

// ════════════════════════════════════════════════════════════════════
//  HELPERS TRANSACCIONALES
// ════════════════════════════════════════════════════════════════════

async function adquirirSeedLock(tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})::text`
}

function compararEstadoUsuario(actual, esperado) {
  return (
    actual.rol === esperado.rol &&
    actual.empresaId === esperado.empresaId &&
    actual.sucursalId === esperado.sucursalId &&
    actual.activo === esperado.activo
  )
}

// ════════════════════════════════════════════════════════════════════
//  cargarRuntimeReal — inicialización perezosa tras guardas
// ════════════════════════════════════════════════════════════════════
function cargarRuntimeReal() {
  const bcrypt = require('bcryptjs')
  const prisma = require('../src/lib/prisma')
  const { validarEstadoUsuarioPorRol } = require('../src/utils/usuario-policy')
  return { bcrypt, prisma, validarEstadoUsuarioPorRol }
}

// ════════════════════════════════════════════════════════════════════
//  main
// ════════════════════════════════════════════════════════════════════
async function main(opciones = {}) {
  const {
    env = process.env,
    logger = console,
    cargarRuntime = cargarRuntimeReal
  } = opciones

  let prisma = null
  let primaryError = null
  let seedCommitted = false

  try {
    // ── Paso 1: dotenv (solo si no se inyecta ruta) ──
    if (!opciones.env) {
      require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
    }

    // ── Guardas sin Prisma ──
    const config = resolverConfiguracion(env)
    const { dbName } = validarDestino(config.target, env.DATABASE_URL)

    // ── Cargar runtime ──
    const { bcrypt, prisma: prismaClient, validarEstadoUsuarioPorRol } = cargarRuntime()
    prisma = prismaClient

    // ── Validar BD conectada ──
    await validarCurrentDatabase(prisma, dbName)

    // ── Guardas completadas ──
    logger.log('SEED_GUARD_OK')
    logger.log(config.target === 'test' ? 'TARGET_DATABASE_TEST' : 'TARGET_DATABASE_LOCAL')

    // ── Calcular hashes (fuera de tx) ──
    const hashSA = await bcrypt.hash(config.SUPERADMIN_PASSWORD, 10)
    const hashAdmin = await bcrypt.hash(config.ADMIN_PASSWORD, 10)
    const hashEmpleado = await bcrypt.hash(config.EMPLEADO_PASSWORD, 10)

    // ════════════════════════════════════════════════════════════════
    //  TRANSACCIÓN 1: NÚCLEO
    // ════════════════════════════════════════════════════════════════
    let coreResult
    try {
      coreResult = await prisma.$transaction(async (tx) => {
        await adquirirSeedLock(tx)

        // Empresa
        let empresaBase = await tx.empresa.findUnique({ where: { slug: EMPRESA_SLUG } })
        if (!empresaBase) {
          empresaBase = await tx.empresa.create({
            data: {
              slug: EMPRESA_SLUG,
              nombreComercial: 'Ferretería JESHA',
              razonSocial: 'Ferretería JESHA S.A. de C.V.',
              whatsapp: '4920000000',
              activa: true
            }
          })
        }
        if (!empresaBase.activa) {
          throw new SeedError('EMPRESA_SEED_INACTIVA', 'La empresa base está inactiva')
        }

        // Sucursal
        const sucursales = await tx.sucursal.findMany({
          where: { nombre: NOMBRE_SUCURSAL, empresaId: empresaBase.id }
        })

        let sucursalBase
        if (sucursales.length === 0) {
          sucursalBase = await tx.sucursal.create({
            data: {
              nombre: NOMBRE_SUCURSAL,
              empresaId: empresaBase.id,
              direccion: 'Av. Principal 123, Zacatecas',
              codigoPostal: '98000',
              activa: true
            }
          })
        } else if (sucursales.length === 1) {
          sucursalBase = sucursales[0]
          if (!sucursalBase.activa) {
            throw new SeedError('SUCURSAL_SEED_INACTIVA', 'La sucursal base está inactiva')
          }
          if (sucursalBase.empresaId !== empresaBase.id) {
            throw new SeedError('SUCURSAL_SEED_AMBIGUA', 'La sucursal no pertenece a la empresa base')
          }
        } else {
          throw new SeedError('SUCURSAL_SEED_AMBIGUA', 'Existen múltiples sucursales con el mismo nombre')
        }

        // Helper crear/verificar usuario
        async function seedUsuario(txU, estado, passwordHash, codigoDivergencia) {
          const sucursalIdUsuario = estado.sucursalId !== undefined ? estado.sucursalId : sucursalBase.id
          const existente = await txU.usuario.findUnique({
            where: { empresaId_username: { empresaId: empresaBase.id, username: estado.username } }
          })

          if (!existente) {
            validarEstadoUsuarioPorRol({
              rol: estado.rol,
              empresaId: empresaBase.id,
              empresa: empresaBase,
              sucursalId: sucursalIdUsuario,
              sucursal: sucursalIdUsuario !== null
                ? { id: sucursalIdUsuario, empresaId: empresaBase.id, activa: true }
                : null
            })

            const dataCreate = {
              nombre: estado.nombre,
              username: estado.username,
              passwordHash,
              rol: estado.rol,
              empresaId: empresaBase.id,
              activo: true
            }
            if (estado.sucursalId !== undefined) {
              dataCreate.sucursalId = estado.sucursalId
            } else {
              dataCreate.sucursalId = sucursalBase.id
            }

            await txU.usuario.create({ data: dataCreate })
          } else {
            const esperado = {
              rol: estado.rol,
              empresaId: empresaBase.id,
              sucursalId: sucursalIdUsuario,
              activo: true
            }
            if (!compararEstadoUsuario(existente, esperado)) {
              throw new SeedError(codigoDivergencia, `Usuario ${estado.username} divergente`)
            }
          }
        }

        await seedUsuario(tx, USUARIO_SUPERADMIN, hashSA, 'SEED_SUPERADMIN_DIVERGENTE')
        await seedUsuario(tx, USUARIO_ADMIN_SUCURSAL, hashAdmin, 'SEED_ADMIN_DIVERGENTE')
        await seedUsuario(tx, USUARIO_EMPLEADO, hashEmpleado, 'SEED_EMPLEADO_DIVERGENTE')

        // Validación final
        const totalCore = await tx.usuario.count({
          where: { empresaId: empresaBase.id, username: { in: ['Gerardo_Manz', 'admin', 'empleado'] } }
        })
        if (totalCore !== 3) throw new SeedError('SEED_CORE_VALIDATION_FAILED', 'Usuarios del núcleo incompletos')

        const saVal = await tx.usuario.findFirst({
          where: { empresaId: empresaBase.id, username: 'Gerardo_Manz' },
          select: { empresaId: true, sucursalId: true, activo: true }
        })
        if (!saVal || saVal.empresaId === null || saVal.sucursalId !== null || !saVal.activo) {
          throw new SeedError('SEED_CORE_VALIDATION_FAILED', 'SUPERADMIN inválido')
        }

        const sinSucursal = await tx.usuario.count({
          where: { empresaId: empresaBase.id, username: { in: ['admin', 'empleado'] }, sucursalId: null }
        })
        if (sinSucursal !== 0) throw new SeedError('SEED_CORE_VALIDATION_FAILED', 'Usuarios sin sucursal')

        const sucVal = await tx.sucursal.findUnique({
          where: { id: sucursalBase.id },
          select: { empresaId: true, activa: true }
        })
        if (!sucVal || sucVal.empresaId !== empresaBase.id || !sucVal.activa) {
          throw new SeedError('SEED_CORE_VALIDATION_FAILED', 'Sucursal incoherente')
        }

        return { empresaId: empresaBase.id, sucursalId: sucursalBase.id }
      }, { isolationLevel: 'ReadCommitted' })

      // Logs solo después del commit exitoso
      logger.log('NUCLEO_EMPRESA_OK')
      logger.log('NUCLEO_SUCURSAL_OK')
      logger.log('NUCLEO_SUPERADMIN_OK')
      logger.log('NUCLEO_ADMIN_SUCURSAL_OK')
      logger.log('NUCLEO_EMPLEADO_OK')
      logger.log('NUCLEO_VALIDATION_OK')

    } catch (e) {
      if (e instanceof SeedError) {
        throw e
      }
      throw new SeedError('SEED_CORE_FAILED', e.message)
    }

    // ════════════════════════════════════════════════════════════════
    //  TRANSACCIÓN 2: DEMO (usa IDs resueltos del núcleo)
    // ════════════════════════════════════════════════════════════════
    const { empresaId, sucursalId } = coreResult

    try {
      await prisma.$transaction(async (tx) => {
        await adquirirSeedLock(tx)

        // Validar referencias del núcleo
        const empresaBase = await tx.empresa.findUnique({ where: { id: empresaId } })
        if (!empresaBase || empresaBase.slug !== EMPRESA_SLUG || !empresaBase.activa) {
          throw new SeedError('SEED_CORE_REFERENCE_INVALID', 'Empresa base inválida en demo')
        }

        const sucursalBase = await tx.sucursal.findUnique({ where: { id: sucursalId } })
        if (!sucursalBase || sucursalBase.empresaId !== empresaId || !sucursalBase.activa || sucursalBase.nombre !== NOMBRE_SUCURSAL) {
          throw new SeedError('SEED_CORE_REFERENCE_INVALID', 'Sucursal base inválida en demo')
        }

        // Departamentos globales
        const deptosData = [
          { nombre: 'Herramientas', icono: '🔧' },
          { nombre: 'Plomería', icono: '🚿' },
          { nombre: 'Electricidad', icono: '⚡' },
          { nombre: 'Pintura', icono: '🎨' },
          { nombre: 'Gas', icono: '🔥' },
          { nombre: 'Limpieza', icono: '🧹' },
          { nombre: 'Seguridad', icono: '🔒' },
          { nombre: 'Construcción', icono: '🏗️' },
          { nombre: 'SERVICIOS', icono: '🛠️' }
        ]

        const departamentos = {}
        for (const d of deptosData) {
          const existentes = await tx.departamento.findMany({
            where: { nombre: d.nombre, empresaId: null }
          })
          if (existentes.length === 0) {
            departamentos[d.nombre] = await tx.departamento.create({
              data: { nombre: d.nombre, icono: d.icono, esGlobal: true, empresaId: null, activo: true }
            })
          } else if (existentes.length === 1) {
            const dept = existentes[0]
            if (dept.empresaId !== null || dept.esGlobal !== true || dept.activo !== true || dept.nombre !== d.nombre) {
              throw new SeedError('DEPARTAMENTO_GLOBAL_DIVERGENTE', `Departamento "${d.nombre}" divergente`)
            }
            departamentos[d.nombre] = dept
          } else {
            throw new SeedError('DEPARTAMENTO_GLOBAL_AMBIGUO', `"${d.nombre}" tiene ${existentes.length} registros`)
          }
        }

        // Categorías globales
        const catMap = [
          ['Herramientas', ['Martillos', 'Destornilladores', 'Llaves', 'Sierras']],
          ['Plomería', ['Tuberías', 'Accesorios', 'Grifería', 'Mangueras']],
          ['Electricidad', ['Cables', 'Focos', 'Contactos', 'Interruptores']],
          ['Pintura', ['Pinturas', 'Brochas', 'Rodillos', 'Diluyentes']],
          ['Gas', ['Cilindros', 'Reguladores', 'Conexiones', 'Válvulas']],
          ['Limpieza', ['Desinfectantes', 'Detergentes', 'Escobas', 'Franelas']],
          ['Seguridad', ['Cascos', 'Guantes', 'Gafas', 'Arneses']],
          ['Construcción', ['Cemento', 'Arena', 'Ladrillos', 'Varilla']],
          ['SERVICIOS', ['Instalación', 'Reparación', 'Asesoría']]
        ]

        const categorias = {}
        for (const [deptNombre, catsNombres] of catMap) {
          for (const catNombre of catsNombres) {
            const existentes = await tx.categoria.findMany({
              where: { nombre: catNombre, departamentoId: departamentos[deptNombre].id, empresaId: null }
            })
            if (existentes.length === 0) {
              categorias[catNombre] = await tx.categoria.create({
                data: {
                  nombre: catNombre,
                  descripcion: `Categoría ${catNombre}`,
                  departamentoId: departamentos[deptNombre].id,
                  esGlobal: true,
                  empresaId: null
                }
              })
            } else if (existentes.length === 1) {
              const cat = existentes[0]
              if (cat.empresaId !== null || cat.esGlobal !== true || cat.departamentoId !== departamentos[deptNombre].id || cat.nombre !== catNombre) {
                throw new SeedError('CATEGORIA_GLOBAL_DIVERGENTE', `Categoría "${catNombre}" divergente`)
              }
              categorias[catNombre] = cat
            } else {
              throw new SeedError('CATEGORIA_GLOBAL_AMBIGUA', `"${catNombre}" tiene ${existentes.length} registros`)
            }
          }
        }

        // Clientes
        const clientes = [
          { nombre: 'Cliente General', rfc: 'XAXX010101000', tipo: 'GENERAL', limiteCredito: 0 },
          { nombre: 'Gerardo Andrés Serrano Manzano', apodo: 'Don Gerardo', rfc: 'SEMG020428G7', telefono: '4924920823', tipo: 'GENERAL', limiteCredito: 0 },
          { nombre: 'Constructora XYZ S.A. de C.V.', apodo: 'Constructora XYZ', rfc: 'CXYZ240001SA', telefono: '492-987-6543', email: 'fiscal@constructoraxyz.com', razonSocial: 'Constructora XYZ S.A. de C.V.', codigoPostalFiscal: '98000', regimenFiscal: '601', usoCfdi: 'G03', tipo: 'FISCAL', limiteCredito: 100000 }
        ]
        for (const c of clientes) {
          const existente = await tx.cliente.findUnique({
            where: { empresaId_rfc: { empresaId: empresaId, rfc: c.rfc } }
          })
          if (!existente) {
            await tx.cliente.create({ data: { ...c, activo: true, empresaId } })
          } else {
            if (existente.empresaId !== empresaId || existente.rfc !== c.rfc || existente.activo !== true || existente.tipo !== c.tipo) {
              throw new SeedError('CLIENTE_DEMO_DIVERGENTE', `Cliente ${c.rfc} divergente`)
            }
          }
        }

        // Proveedores
        const proveedores = [
          { nombreOficial: 'Herramientas del Centro', alias: 'HDC', telefono: '492-555-1111', email: 'contacto@hdc.com' },
          { nombreOficial: 'Distribuidora Eléctrica Nacional', alias: 'DEN', telefono: '492-555-2222', email: 'ventas@den.com' },
          { nombreOficial: 'Pinturas y Acabados S.A.', alias: 'PYA', telefono: '492-555-3333', email: 'pedidos@pya.com' }
        ]
        for (const prov of proveedores) {
          const existente = await tx.proveedor.findUnique({
            where: { empresaId_nombreOficial: { empresaId: empresaId, nombreOficial: prov.nombreOficial } }
          })
          if (!existente) {
            await tx.proveedor.create({ data: { ...prov, activo: true, empresaId } })
          } else {
            if (existente.empresaId !== empresaId || existente.nombreOficial !== prov.nombreOficial || existente.alias !== prov.alias || existente.activo !== true) {
              throw new SeedError('PROVEEDOR_DEMO_DIVERGENTE', `Proveedor ${prov.nombreOficial} divergente`)
            }
          }
        }

        // Productos
        const prodsData = [
          { codigo: 'HER-001', nombre: 'Martillo de Uña 16oz', cat: 'Martillos', precio: 150, costo: 85, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'HER-002', nombre: 'Martillo de Uña 20oz', cat: 'Martillos', precio: 180, costo: 100, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'HER-003', nombre: 'Destornillador Plano #2', cat: 'Destornilladores', precio: 45, costo: 25, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'HER-004', nombre: 'Destornillador Phillips #2', cat: 'Destornilladores', precio: 45, costo: 25, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'PLO-001', nombre: 'Tubo PVC 1/2" x 3m', cat: 'Tuberías', precio: 120, costo: 60, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'PLO-002', nombre: 'Tubo PVC 3/4" x 3m', cat: 'Tuberías', precio: 180, costo: 90, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'ELE-001', nombre: 'Cable Eléctrico Cal. 12', cat: 'Cables', precio: 25, costo: 12, uV: 'metro', uC: 'rollo', f: 100 },
          { codigo: 'ELE-002', nombre: 'Cable Eléctrico Cal. 10', cat: 'Cables', precio: 35, costo: 18, uV: 'metro', uC: 'rollo', f: 100 },
          { codigo: 'ELE-003', nombre: 'Foco LED 9W Blanco Frío', cat: 'Focos', precio: 45, costo: 22, uV: 'pza', uC: 'caja', f: 12 },
          { codigo: 'ELE-004', nombre: 'Foco LED 15W Blanco Cálido', cat: 'Focos', precio: 55, costo: 27, uV: 'pza', uC: 'caja', f: 12 },
          { codigo: 'PIN-001', nombre: 'Pintura Vinílica Blanca 1L', cat: 'Pinturas', precio: 89, costo: 45, uV: 'lt', uC: 'lt', f: null },
          { codigo: 'PIN-002', nombre: 'Pintura Vinílica Blanca 5L', cat: 'Pinturas', precio: 380, costo: 190, uV: 'bote', uC: 'bote', f: null },
          { codigo: 'PIN-003', nombre: 'Brocha Plana 3"', cat: 'Brochas', precio: 35, costo: 17, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'PIN-004', nombre: 'Rodillo 9"', cat: 'Rodillos', precio: 28, costo: 14, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'GAS-001', nombre: 'Cilindro Gas LP 5kg', cat: 'Cilindros', precio: 250, costo: 120, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'GAS-002', nombre: 'Regulador de Gas', cat: 'Reguladores', precio: 85, costo: 40, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'LIM-001', nombre: 'Desinfectante Concentrado 1L', cat: 'Desinfectantes', precio: 45, costo: 22, uV: 'lt', uC: 'lt', f: null },
          { codigo: 'LIM-002', nombre: 'Detergente Líquido 2L', cat: 'Detergentes', precio: 35, costo: 17, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'LIM-003', nombre: 'Escoba de Nylon', cat: 'Escobas', precio: 55, costo: 28, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'SEG-001', nombre: 'Casco de Seguridad Amarillo', cat: 'Cascos', precio: 125, costo: 60, uV: 'pza', uC: 'pza', f: null },
          { codigo: 'SEG-002', nombre: 'Guantes de Trabajo (par)', cat: 'Guantes', precio: 35, costo: 17, uV: 'par', uC: 'par', f: null }
        ]

        const productosCreados = []
        for (const p of prodsData) {
          const cat = categorias[p.cat]
          if (!cat) continue
          const existente = await tx.producto.findUnique({
            where: { empresaId_codigoInterno: { empresaId: empresaId, codigoInterno: p.codigo } }
          })
          if (!existente) {
            const prod = await tx.producto.create({
              data: {
                codigoInterno: p.codigo, nombre: p.nombre, descripcion: `${p.nombre} — JESHA`,
                precioBase: p.precio, costo: p.costo, costoPromedio: p.costo,
                categoriaId: cat.id, unidadVenta: p.uV, unidadCompra: p.uC,
                factorConversion: p.f, activo: true, empresaId
              }
            })
            productosCreados.push(prod)
          } else {
            if (existente.empresaId !== empresaId || existente.codigoInterno !== p.codigo || existente.categoriaId !== cat.id || existente.activo !== true) {
              throw new SeedError('PRODUCTO_DEMO_DIVERGENTE', `Producto ${p.codigo} divergente`)
            }
            productosCreados.push(existente)
          }
        }

        // Inventario determinista
        const STOCK_INICIAL = 50
        for (const prod of productosCreados) {
          const existenteInv = await tx.inventarioSucursal.findUnique({
            where: { productoId_sucursalId: { productoId: prod.id, sucursalId: sucursalId } }
          })
          if (!existenteInv) {
            await tx.inventarioSucursal.create({
              data: {
                productoId: prod.id,
                sucursalId: sucursalId,
                stockActual: STOCK_INICIAL,
                stockMinimoAlerta: 5,
                stockMaximo: 200
              }
            })
          }
        }
      }, { isolationLevel: 'ReadCommitted' })

      logger.log('DEMO_DATA_OK')

    } catch (e) {
      if (e instanceof SeedError) {
        primaryError = e
        throw e
      }
      primaryError = new SeedError('DEMO_DATA_FAILED', e.message)
      throw primaryError
    }

    seedCommitted = true

  } catch (e) {
    primaryError = e
    throw e
  } finally {
    if (prisma && typeof prisma.$disconnect === 'function') {
      try {
        await prisma.$disconnect()
      } catch (disconnectError) {
        if (!primaryError) {
          throw new SeedError('SEED_DISCONNECT_FAILED', 'No fue posible cerrar la conexión')
        }
      }
    }
  }

  if (seedCommitted) {
    logger.log('SEED_COMPLETED')
  }
}

// ════════════════════════════════════════════════════════════════════
//  Entrypoint seguro
// ════════════════════════════════════════════════════════════════════
if (require.main === module) {
  main().catch((error) => {
    if (error instanceof SeedError) {
      console.error(error.code)
    } else {
      console.error('SEED_UNEXPECTED_ERROR')
    }
    process.exitCode = 1
  })
}

module.exports = {
  SeedError,
  main,
  resolverConfiguracion,
  validarDestino,
  validarCurrentDatabase,
  adquirirSeedLock,
  compararEstadoUsuario,
  cargarRuntimeReal
}
