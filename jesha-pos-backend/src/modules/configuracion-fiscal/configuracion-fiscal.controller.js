'use strict'

const prisma = require('../../lib/prisma')
const getEmpresaId = require('../../helpers/getEmpresaId')
const { modoActivo, resetFacturapiCache } = require('../../lib/facturapi')
const { cifrarSecreto, obtenerMasterKey } = require('../../lib/fiscal-secrets')
const { facturapiAdmin } = require('../../lib/facturapi-admin')

const REGIMEN_RE = /^\d{3}$/
const CP_RE = /^\d{5}$/
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/
const CAMPOS_DATOS = new Set(['rfc', 'razonSocial', 'regimenFiscal', 'codigoPostalFiscal', 'direccionFiscal'])

function fiscalStatus(config, mode = modoActivo(), empresa = null) {
  const hasFiscalData = !empresa || Boolean(
    empresa.rfc && empresa.razonSocial && config?.regimenFiscal && config?.codigoPostalFiscal
  )
  if (!config?.facturapiOrganizationId) return config && hasFiscalData ? 'DATOS_GUARDADOS' : 'NO_CONFIGURADA'
  const hasModeKey = mode === 'live' ? Boolean(config.facturapiLiveKeyEnc) : Boolean(config.facturapiTestKeyEnc)
  const expiration = config.csdExpiraEn ? new Date(config.csdExpiraEn).getTime() : null
  const hasCsd = Boolean(config.csdSerial || config.csdExpiraEn) && !(expiration && expiration <= Date.now())
  const pendingSteps = Array.isArray(config.pendingSteps) ? config.pendingSteps : null
  return config.isProductionReady === true
    && hasModeKey
    && hasFiscalData
    && hasCsd
    && pendingSteps
    && pendingSteps.length === 0
    ? 'LISTA'
    : 'CONFIGURANDO'
}

function sanitizarConfiguracion(empresa, config) {
  return {
    empresaId: empresa.id,
    rfc: empresa.rfc,
    razonSocial: empresa.razonSocial,
    regimenFiscal: config?.regimenFiscal ?? null,
    codigoPostalFiscal: config?.codigoPostalFiscal ?? null,
    direccionFiscal: config?.direccionFiscal ?? null,
    facturapiOrganizationId: config?.facturapiOrganizationId ?? null,
    tieneTestKey: Boolean(config?.facturapiTestKeyEnc),
    tieneLiveKey: Boolean(config?.facturapiLiveKeyEnc),
    isProductionReady: config?.isProductionReady ?? null,
    pendingSteps: config?.pendingSteps ?? null,
    csdSerial: config?.csdSerial ?? null,
    csdExpiraEn: config?.csdExpiraEn ?? null,
    actualizadaEn: config?.actualizadaEn ?? null,
    hasCsd: Boolean(config?.csdSerial || config?.csdExpiraEn),
    status: fiscalStatus(config, modoActivo(), empresa)
  }
}

function camposDesconocidos(body, permitidos) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['body']
  return Object.keys(body).filter((key) => !permitidos.has(key))
}

function metadataOrganization(raw) {
  const organization = raw || {}
  const pendingSteps = organization.pending_steps ?? organization.pendingSteps ?? null
  const isProductionReady = organization.is_production_ready ?? organization.isProductionReady ?? null
  const certificate = organization.certificate || organization.csd || null
  const expiration = certificate?.expires_at ? new Date(certificate.expires_at) : null
  return {
    id: organization.id,
    rfc: organization.legal?.tax_id ?? organization.tax_id ?? organization.rfc ?? null,
    isProductionReady: typeof isProductionReady === 'boolean' ? isProductionReady : null,
    pendingSteps,
    hasCsd: typeof certificate?.has_certificate === 'boolean' ? certificate.has_certificate : null,
    csdSerial: certificate?.serial_number ?? certificate?.serial ?? null,
    csdExpiraEn: expiration && !Number.isNaN(expiration.getTime()) ? expiration : null
  }
}

function construirDatosLegales(empresa, config) {
  if (!empresa.nombreComercial || !empresa.rfc || !empresa.razonSocial || !config?.regimenFiscal || !config?.codigoPostalFiscal) {
    throw Object.assign(new Error('Completa RFC, razón social, régimen fiscal y código postal antes de vincular Facturapi'), {
      status: 409, code: 'FISCAL_CONFIG_NOT_READY', expose: true
    })
  }
  if (empresa.nombreComercial.length > 100) {
    throw Object.assign(new Error('El nombre comercial excede 100 caracteres'), { status: 400, expose: true })
  }
  return {
    name: empresa.nombreComercial,
    legal_name: empresa.razonSocial,
    tax_id: empresa.rfc,
    tax_system: config.regimenFiscal,
    address: { zip: config.codigoPostalFiscal }
  }
}

function cambiosStatus(meta) {
  const data = {}
  if (meta.isProductionReady !== null) data.isProductionReady = meta.isProductionReady
  if (meta.pendingSteps !== null) data.pendingSteps = meta.pendingSteps
  if (meta.hasCsd === false) {
    data.csdSerial = null
    data.csdExpiraEn = null
  } else if (meta.hasCsd === true || meta.csdSerial || meta.csdExpiraEn) {
    data.csdSerial = meta.csdSerial
    data.csdExpiraEn = meta.csdExpiraEn
  }
  return data
}

function validarRfc(empresaRfc, remotoRfc) {
  if (!empresaRfc || !remotoRfc) return
  if (empresaRfc.trim().toUpperCase() !== remotoRfc.trim().toUpperCase()) {
    throw Object.assign(new Error('El RFC de Facturapi no coincide con el RFC de la empresa'), {
      status: 409, code: 'FISCAL_RFC_MISMATCH', expose: true
    })
  }
}

const CSD_ERROR_MESSAGES = {
  certificate_file_required: 'Selecciona el archivo .cer del CSD.',
  private_key_file_required: 'Selecciona el archivo .key del CSD.',
  certificate_files_required: 'Selecciona los archivos .cer y .key del CSD.',
  certificate_files_invalid: 'El certificado o la llave privada no son válidos.',
  certificate_invalid: 'Facturapi rechazó el certificado por no ser válido.',
  certificate_not_yet_valid: 'El CSD todavía no se encuentra vigente.',
  csd_required: 'El archivo seleccionado no corresponde a un CSD.',
  private_key_certificate_mismatch: 'El archivo .key no corresponde al certificado .cer.',
  private_key_password_incorrect: 'La contraseña de la llave privada es incorrecta.',
  certificate_previous_rfc_mismatch: 'El RFC del CSD no coincide con el certificado anterior.'
}

function responderError(res, error, fallback) {
  const status = error.expose && Number.isInteger(error.status) ? error.status : 500
  if (status >= 500) console.error(fallback + ':', error.message)
  return res.status(status).json({
    error: status < 500 ? error.message : fallback,
    ...(error.code ? { code: error.code, codigo: error.code } : {})
  })
}

function normalizarErrorCsd(error) {
  if (error.code === 'FISCAL_RFC_MISMATCH') {
    error.code = 'FISCAL_RFC_CSD_MISMATCH'
    error.message = 'El RFC del Certificado de Sello Digital no coincide con el RFC configurado para esta empresa.'
    error.status = 409
    error.expose = true
  } else if (CSD_ERROR_MESSAGES[error.code]) {
    error.message = CSD_ERROR_MESSAGES[error.code]
    error.code = `FISCAL_CSD_${error.code.toUpperCase()}`
    error.status = 400
    error.expose = true
  }
  return error
}

function responderErrorCsd(res, error) {
  return responderError(res, normalizarErrorCsd(error), 'No se pudo cargar el CSD')
}

async function auditar(db, req, empresaId, accion, valorDespues) {
  try {
    await db.auditoria.create({
      data: {
        empresaId,
        usuarioId: req.usuario.id,
        accion,
        modulo: 'CONFIGURACION_FISCAL',
        referencia: `empresa:${empresaId}`,
        valorDespues,
        ip: req.ip
      }
    })
  } catch (error) {
    console.error('Error auditoría fiscal:', error.message)
  }
}

function crearConfiguracionFiscalController(dependencies = {}) {
  const db = dependencies.prisma || prisma
  const admin = dependencies.facturapiAdmin || facturapiAdmin
  const encrypt = dependencies.cifrarSecreto || cifrarSecreto
  const validateMaster = dependencies.obtenerMasterKey || obtenerMasterKey
  const sdkFactory = dependencies.facturapiSdk || null

  async function cargarEmpresa(empresaId) {
    return db.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombreComercial: true, razonSocial: true, rfc: true, ConfiguracionFiscal: true }
    })
  }

  async function obtener(req, res) {
    try {
      const empresaId = getEmpresaId(req)
      const empresa = await cargarEmpresa(empresaId)
      if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })
      return res.json({ configuracion: sanitizarConfiguracion(empresa, empresa.ConfiguracionFiscal) })
    } catch (error) {
      return responderError(res, error, 'No se pudo consultar la configuración fiscal')
    }
  }

  async function actualizar(req, res) {
    try {
      const empresaId = getEmpresaId(req)
      const desconocidos = camposDesconocidos(req.body, CAMPOS_DATOS)
      if (desconocidos.length) return res.status(400).json({ error: `Campos no permitidos: ${desconocidos.join(', ')}` })

      const rfc = req.body.rfc === undefined ? undefined : String(req.body.rfc).trim().toUpperCase()
      const razonSocial = req.body.razonSocial === undefined ? undefined : String(req.body.razonSocial).trim()
      const regimenFiscal = req.body.regimenFiscal === undefined ? undefined : String(req.body.regimenFiscal).trim()
      const codigoPostalFiscal = req.body.codigoPostalFiscal === undefined ? undefined : String(req.body.codigoPostalFiscal).trim()
      const direccionFiscal = req.body.direccionFiscal
      if (rfc !== undefined && !RFC_RE.test(rfc)) return res.status(400).json({ error: 'RFC inválido' })
      if (razonSocial !== undefined && razonSocial.length < 2) return res.status(400).json({ error: 'Razón social inválida' })
      if (regimenFiscal !== undefined && !REGIMEN_RE.test(regimenFiscal)) return res.status(400).json({ error: 'Régimen fiscal inválido' })
      if (codigoPostalFiscal !== undefined && !CP_RE.test(codigoPostalFiscal)) return res.status(400).json({ error: 'Código postal fiscal inválido' })
      if (direccionFiscal !== undefined && direccionFiscal !== null && (typeof direccionFiscal !== 'object' || Array.isArray(direccionFiscal))) {
        return res.status(400).json({ error: 'direccionFiscal debe ser un objeto' })
      }

      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(73001::int, ${empresaId}::int)::text`
        const empresa = await tx.empresa.findUnique({
          where: { id: empresaId },
          select: { id: true, nombreComercial: true, razonSocial: true, rfc: true, ConfiguracionFiscal: true }
        })
        if (!empresa) throw Object.assign(new Error('Empresa no encontrada'), { status: 404, expose: true })
        const configActual = empresa.ConfiguracionFiscal
        if (rfc !== undefined && configActual?.csdSerial && empresa.rfc && rfc !== empresa.rfc) {
          throw Object.assign(new Error('No se puede cambiar el RFC después de vincular el CSD'), {
            status: 409, code: 'FISCAL_RFC_CHANGE_REQUIRES_CSD', expose: true
          })
        }

        const empresaFinal = { ...empresa, rfc: rfc ?? empresa.rfc, razonSocial: razonSocial ?? empresa.razonSocial }
        const configFinal = {
          ...configActual,
          regimenFiscal: regimenFiscal ?? configActual?.regimenFiscal,
          codigoPostalFiscal: codigoPostalFiscal ?? configActual?.codigoPostalFiscal
        }
        if (configActual?.facturapiOrganizationId && (rfc !== undefined || razonSocial !== undefined || regimenFiscal !== undefined || codigoPostalFiscal !== undefined)) {
          validateMaster()
          const legal = construirDatosLegales(empresaFinal, configFinal)
          const remote = await admin.actualizarDatosLegales(configActual.facturapiOrganizationId, legal)
          validarRfc(empresaFinal.rfc, metadataOrganization(remote).rfc)
        }

        const empresaData = {}
        if (rfc !== undefined) empresaData.rfc = rfc
        if (razonSocial !== undefined) empresaData.razonSocial = razonSocial
        if (Object.keys(empresaData).length) await tx.empresa.update({ where: { id: empresaId }, data: empresaData })

        const fiscalData = {}
        if (regimenFiscal !== undefined) fiscalData.regimenFiscal = regimenFiscal
        if (codigoPostalFiscal !== undefined) fiscalData.codigoPostalFiscal = codigoPostalFiscal
        if (direccionFiscal !== undefined) fiscalData.direccionFiscal = direccionFiscal
        const existente = await tx.configuracionFiscal.findUnique({ where: { empresaId }, select: { id: true } })
        if (existente) await tx.configuracionFiscal.update({ where: { empresaId }, data: fiscalData })
        else await tx.configuracionFiscal.create({ data: { empresaId, ...fiscalData } })
      }, { timeout: 30000, maxWait: 10000 })

      const empresa = await cargarEmpresa(empresaId)
      await auditar(db, req, empresaId, 'FISCAL_DATOS_ACTUALIZAR', { campos: Object.keys(req.body) })
      return res.json({ configuracion: sanitizarConfiguracion(empresa, empresa.ConfiguracionFiscal) })
    } catch (error) {
      return responderError(res, error, 'No se pudo actualizar la configuración fiscal')
    }
  }

  async function iniciarOrganization(req, res) {
    try {
      const empresaId = getEmpresaId(req)
      validateMaster()
      const result = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(73001::int, ${empresaId}::int)::text`
        const empresa = await tx.empresa.findUnique({
          where: { id: empresaId },
          select: { id: true, nombreComercial: true, razonSocial: true, rfc: true }
        })
        if (!empresa) throw Object.assign(new Error('Empresa no encontrada'), { status: 404, expose: true })

        let config = await tx.configuracionFiscal.findUnique({ where: { empresaId } })
        const legal = construirDatosLegales(empresa, config)
        if (config?.facturapiOrganizationId) {
          const remote = await admin.actualizarDatosLegales(config.facturapiOrganizationId, legal)
          validarRfc(empresa.rfc, metadataOrganization(remote).rfc)
          if (!config.facturapiTestKeyEnc) {
            const testKey = await admin.obtenerTestKey(config.facturapiOrganizationId)
            if (typeof testKey !== 'string' || !testKey) throw Object.assign(new Error('Facturapi no devolvió la credencial de pruebas'), { status: 502, expose: true })
            await tx.configuracionFiscal.update({ where: { empresaId }, data: { facturapiTestKeyEnc: encrypt(testKey) } })
            return { created: false, credentialsUpdated: true }
          }
          return { created: false, credentialsUpdated: false }
        }

        const organization = await admin.crearOrganization({ name: empresa.nombreComercial }, { empresaId })
        if (!organization?.id) throw Object.assign(new Error('Facturapi no devolvió un identificador de Organization'), { status: 502, expose: true })
        const configured = await admin.actualizarDatosLegales(organization.id, legal)
        const testKey = await admin.obtenerTestKey(organization.id)
        if (typeof testKey !== 'string' || !testKey) throw Object.assign(new Error('Facturapi no devolvió la credencial de pruebas'), { status: 502, expose: true })
        const meta = metadataOrganization(configured || organization)
        meta.id = organization.id
        validarRfc(empresa.rfc, meta.rfc)
        const data = {
          facturapiOrganizationId: meta.id,
          facturapiTestKeyEnc: encrypt(testKey),
          ...cambiosStatus(meta)
        }
        config = config
          ? await tx.configuracionFiscal.update({ where: { empresaId }, data })
          : await tx.configuracionFiscal.create({ data: { empresaId, ...data } })
        return { created: true, credentialsUpdated: true, organizationId: config.facturapiOrganizationId }
      }, { timeout: 30000, maxWait: 10000 })

      resetFacturapiCache()
      await auditar(db, req, empresaId, 'FISCAL_ORGANIZATION_VINCULAR', result)
      const empresa = await cargarEmpresa(empresaId)
      return res.status(result.created ? 201 : 200).json({ configuracion: sanitizarConfiguracion(empresa, empresa.ConfiguracionFiscal) })
    } catch (error) {
      return responderError(res, error, 'No se pudo vincular la Organization Facturapi')
    }
  }

  async function sincronizarStatus(req, res) {
    try {
      const empresaId = getEmpresaId(req)
      const empresa = await cargarEmpresa(empresaId)
      const organizationId = empresa?.ConfiguracionFiscal?.facturapiOrganizationId
      if (!organizationId) return res.status(409).json({ error: 'Organization Facturapi no configurada', code: 'FISCAL_CONFIG_NOT_READY', codigo: 'FISCAL_CONFIG_NOT_READY' })
      const meta = metadataOrganization(await admin.obtenerOrganization(organizationId))
      validarRfc(empresa.rfc, meta.rfc)
      await db.configuracionFiscal.update({ where: { empresaId }, data: cambiosStatus(meta) })
      const actualizada = await cargarEmpresa(empresaId)
      await auditar(db, req, empresaId, 'FISCAL_STATUS_SINCRONIZAR', { status: fiscalStatus(actualizada.ConfiguracionFiscal, modoActivo(), actualizada) })
      return res.json({ configuracion: sanitizarConfiguracion(actualizada, actualizada.ConfiguracionFiscal) })
    } catch (error) {
      return responderError(res, error, 'No se pudo sincronizar el estado fiscal')
    }
  }

  async function crearLiveKey(req, res) {
    try {
      const empresaId = getEmpresaId(req)
      validateMaster()
      const config = await db.configuracionFiscal.findUnique({ where: { empresaId } })
      if (!config?.facturapiOrganizationId) return res.status(409).json({ error: 'Organization Facturapi no configurada', code: 'FISCAL_CONFIG_NOT_READY', codigo: 'FISCAL_CONFIG_NOT_READY' })
      if (config.isProductionReady !== true) return res.status(409).json({ error: 'La Organization todavía no está lista para producción', code: 'FISCAL_CONFIG_NOT_READY', codigo: 'FISCAL_CONFIG_NOT_READY' })
      if (config.facturapiLiveKeyEnc) return res.status(409).json({ error: 'La empresa ya tiene una credencial de producción', code: 'FACTURAPI_LIVE_KEY_ALREADY_CONFIGURED', codigo: 'FACTURAPI_LIVE_KEY_ALREADY_CONFIGURED' })
      const liveKey = await admin.crearLiveKey(config.facturapiOrganizationId)
      if (typeof liveKey !== 'string' || !liveKey) throw Object.assign(new Error('Facturapi no devolvió la credencial de producción'), { status: 502, expose: true })
      await db.configuracionFiscal.update({ where: { empresaId }, data: { facturapiLiveKeyEnc: encrypt(liveKey) } })
      resetFacturapiCache()
      const empresa = await cargarEmpresa(empresaId)
      await auditar(db, req, empresaId, 'FISCAL_LIVE_KEY_CREAR', { creada: true })
      return res.json({ configuracion: sanitizarConfiguracion(empresa, empresa.ConfiguracionFiscal) })
    } catch (error) {
      return responderError(res, error, 'No se pudo crear la credencial de producción')
    }
  }

  async function subirCsd(req, res) {
    const cer = req.files?.cer?.[0]?.buffer
    const key = req.files?.key?.[0]?.buffer
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    try {
      const empresaId = getEmpresaId(req)
      if (!cer || !key || !password) return res.status(400).json({ error: 'cer, key y password son requeridos' })
      const empresa = await cargarEmpresa(empresaId)
      const organizationId = empresa?.ConfiguracionFiscal?.facturapiOrganizationId
      if (!organizationId) return res.status(409).json({ error: 'Organization Facturapi no configurada', code: 'FISCAL_CONFIG_NOT_READY', codigo: 'FISCAL_CONFIG_NOT_READY' })
      const meta = metadataOrganization(await admin.subirCsd(organizationId, { cer, key, password }))
      validarRfc(empresa.rfc, meta.rfc)
      if (meta.hasCsd !== true) throw Object.assign(new Error('Facturapi no confirmó el certificado CSD'), { status: 502, code: 'FISCAL_CSD_NOT_CONFIRMED', expose: true })
      await db.configuracionFiscal.update({ where: { empresaId }, data: cambiosStatus(meta) })
      const actualizada = await cargarEmpresa(empresaId)
      await auditar(db, req, empresaId, 'FISCAL_CSD_CARGAR', {
        csdSerial: actualizada.ConfiguracionFiscal.csdSerial,
        csdExpiraEn: actualizada.ConfiguracionFiscal.csdExpiraEn
      })
      return res.json({ configuracion: sanitizarConfiguracion(actualizada, actualizada.ConfiguracionFiscal) })
    } catch (error) {
      return responderErrorCsd(res, error)
    } finally {
      if (cer) cer.fill(0)
      if (key) key.fill(0)
      if (typeof req.body?.password === 'string') req.body.password = ''
    }
  }

  async function reconcile(req, res) {
    try {
      const empresaId = getEmpresaId(req)
      validateMaster()
      const legacyKey = process.env.FACTURAPI_KEY_TEST
      if (typeof legacyKey !== 'string' || !legacyKey.trim()) {
        return res.status(409).json({
          error: 'No hay credencial legacy de Facturapi para reconciliar',
          code: 'FISCAL_NO_LEGACY_KEY',
          codigo: 'FISCAL_NO_LEGACY_KEY'
        })
      }

      const empresa = await cargarEmpresa(empresaId)
      if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })

      const result = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(73001::int, ${empresaId}::int)::text`
        const config = await tx.configuracionFiscal.findUnique({ where: { empresaId } })
        if (config?.facturapiOrganizationId) {
          return { reconciled: false, organizationId: config.facturapiOrganizationId, reason: 'already_linked' }
        }

        const FacturapiSdk = sdkFactory || require('facturapi').default
        const orgClient = typeof FacturapiSdk === 'function' && FacturapiSdk.prototype
          ? new FacturapiSdk(legacyKey.trim())
          : FacturapiSdk(legacyKey.trim())
        let remoteOrg
        try {
          remoteOrg = await orgClient.organizations.me()
        } catch (err) {
          throw Object.assign(new Error('No se pudo consultar la Organization en Facturapi: ' + (err.message || 'error desconocido')), { status: 502, expose: true })
        }
        if (!remoteOrg?.id) {
          throw Object.assign(new Error('Facturapi no devolvió un identificador de Organization'), { status: 502, expose: true })
        }

        const orgTaxId = remoteOrg.legal?.tax_id ?? remoteOrg.tax_id ?? null
        if (empresa.rfc && orgTaxId && empresa.rfc.trim().toUpperCase() !== orgTaxId.trim().toUpperCase()) {
          throw Object.assign(new Error(`El RFC de la Organization Facturapi (${orgTaxId}) no coincide con el RFC de la empresa (${empresa.rfc})`), { status: 409, code: 'FISCAL_RFC_MISMATCH', expose: true })
        }

        const encryptedKey = encrypt(legacyKey.trim())
        const meta = metadataOrganization(remoteOrg)
        const data = {
          facturapiOrganizationId: remoteOrg.id,
          facturapiTestKeyEnc: encryptedKey,
          ...cambiosStatus(meta)
        }
        if (config) {
          await tx.configuracionFiscal.update({ where: { empresaId }, data })
        } else {
          await tx.configuracionFiscal.create({ data: { empresaId, ...data } })
        }
        return { reconciled: true, organizationId: remoteOrg.id }
      }, { timeout: 30000, maxWait: 10000 })

      resetFacturapiCache()
      await auditar(db, req, empresaId, 'FISCAL_ORGANIZATION_RECONCILIAR', result)
      const empresaActualizada = await cargarEmpresa(empresaId)
      return res.status(result.reconciled ? 200 : 200).json({
        reconciled: result.reconciled,
        organizationId: result.organizationId,
        configuracion: sanitizarConfiguracion(empresaActualizada, empresaActualizada.ConfiguracionFiscal)
      })
    } catch (error) {
      return responderError(res, error, 'No se pudo reconciliar la configuración fiscal legacy')
    }
  }

  async function persistirLiveKey(req, res) {
    try {
      const empresaId = getEmpresaId(req)
      const { persistirLiveKeyDeEntorno } = require('../../lib/facturapi')
      const resultado = await persistirLiveKeyDeEntorno(empresaId)
      await auditar(db, req, empresaId, 'FISCAL_LIVE_KEY_PERSIST', resultado)
      const empresa = await cargarEmpresa(empresaId)
      return res.json({
        configuracion: sanitizarConfiguracion(empresa, empresa.ConfiguracionFiscal),
        ...(resultado.persistida
          ? { mensaje: 'Live key persistida exitosamente desde FACTURAPI_KEY.' }
          : { mensaje: 'La empresa ya tiene una live key configurada.' })
      })
    } catch (error) {
      return responderError(res, error, 'No se pudo persistir la live key')
    }
  }

  return { obtener, actualizar, iniciarOrganization, sincronizarStatus, crearLiveKey, subirCsd, reconcile, persistirLiveKey }
}

const controller = crearConfiguracionFiscalController()

module.exports = {
  fiscalStatus,
  sanitizarConfiguracion,
  metadataOrganization,
  construirDatosLegales,
  cambiosStatus,
  validarRfc,
  normalizarErrorCsd,
  crearConfiguracionFiscalController,
  ...controller
}
