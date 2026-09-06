// ════════════════════════════════════════════════════════════════════
//  LIB/FISCAL-SECRETS.JS
//  src/lib/fiscal-secrets.js
//
//  Cifrado simétrico AES-256-GCM para secretos fiscales por Empresa
//  (Test/Live keys de Facturapi). La llave maestra viene SOLO del entorno:
//    FISCAL_SECRETS_MASTER_KEY = base64 de 32 bytes (256 bits).
//
//  Formato persistido: v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>
//
//  Reglas de seguridad:
//   - obtenerMasterKey() es fail-fast: si falta o no son 32 bytes, LANZA.
//     Nunca se degrada a otra derivación.
//   - descifrarSecreto() es fail-closed: formato inválido, IV/tag corruptos
//     o ciphertext manipulado → LANZA (GCM valida autenticidad del tag).
//   - Solo se cifran/des-cifran secretos en memoria; nada se loguea.
// ════════════════════════════════════════════════════════════════════

'use strict'

const crypto = require('node:crypto')

const VERSION = 'v1'

function obtenerMasterKey() {
  const raw = process.env.FISCAL_SECRETS_MASTER_KEY
  if (!raw || typeof raw !== 'string') {
    throw new Error('FISCAL_SECRETS_MASTER_KEY no configurada')
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error('FISCAL_SECRETS_MASTER_KEY debe ser base64 de 32 bytes (256 bits)')
  }
  return buf
}

function cifrarSecreto(texto) {
  if (typeof texto !== 'string' || texto.length === 0) {
    throw new Error('Secreto vacío no se puede cifrar')
  }
  const key = obtenerMasterKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

function descifrarSecreto(token) {
  const key = obtenerMasterKey()
  const parts = String(token).split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Secreto cifrado con formato inválido')
  }
  const [, ivB64, tagB64, encB64] = parts
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const out = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()])
  return out.toString('utf8')
}

module.exports = { cifrarSecreto, descifrarSecreto, obtenerMasterKey, VERSION }