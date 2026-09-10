'use strict'
// ════════════════════════════════════════════════════════════════════
//  FACTURA-CANCELACION.MAPPER.JS
//  src/modules/facturas/factura-cancelacion.mapper.js
//
//  Centralized Facturapi state → JESHA state mapping.
//  INVARIANTE: solo marcar CANCELADA local cuando SAT confirma status='canceled'.
//  cancellation_status=accepted con status=valid = transitorio (no marcar aún).
// ════════════════════════════════════════════════════════════════════

// ── Facturapi cancellation_status → JESHA UI mapping ──
const CANCELLATION_STATUS_MAP = {
  none:     { badge: null,                         label: null,                      tooltip: null,                      canCancel: true,  canSync: true,  type: 'idle' },
  pending:  { badge: 'badge-pending-cancel',       label: '⏳ Esperando receptor',   tooltip: 'Cancelación pendiente de aceptación del receptor', canCancel: false, canSync: true, type: 'in_progress' },
  verifying:{ badge: 'badge-verifying',            label: '🔍 Verificando SAT',      tooltip: 'El SAT está verificando la solicitud de cancelación',            canCancel: false, canSync: true, type: 'in_progress' },
  accepted: { badge: 'badge-cancelada',            label: '✓ Cancelada',             tooltip: 'Cancelación aceptada por el SAT',                               canCancel: false, canSync: false, type: 'terminal' },
  rejected: { badge: 'badge-rejected',             label: '✕ Rechazada',             tooltip: 'La solicitud de cancelación fue rechazada por el SAT o el receptor', canCancel: true, canSync: true, type: 'terminal_error' },
  expired:  { badge: 'badge-expired',              label: '⚠ Expirada',              tooltip: 'La solicitud de cancelación expiró sin respuesta del receptor',   canCancel: true, canSync: true, type: 'terminal_error' },
}

// ── Facturapi invoice.status → JESHA estado mapping ──
const INVOICE_STATUS_MAP = {
  draft:   { jeshaEstado: null,           label: null,                      badge: null,                         type: 'draft' },
  pending: { jeshaEstado: 'PENDIENTE_TIMBRADO', label: '⏳ Pendiente',    badge: 'badge-pendiente',            type: 'pending' },
  valid:   { jeshaEstado: 'TIMBRADA',     label: '✓ Timbrada',             badge: 'badge-timbrada',             type: 'active' },
  canceled:{ jeshaEstado: 'CANCELADA',    label: '✕ Cancelada',            badge: 'badge-cancelada',            type: 'terminal' },
  failed:  { jeshaEstado: 'PENDIENTE_TIMBRADO', label: '⚠ Timbrado falló', badge: 'badge-failed',             type: 'error' },
}

// ── Motivos SAT ──
const MOTIVOS_SAT = {
  '01': { label: 'Errores con relación',            description: 'Factura con errores que tiene sustitución (requiere UUID de sustitución)', requiresSubstitution: true },
  '02': { label: 'Errores sin relación',             description: 'Factura con errores sin sustitución',                                          requiresSubstitution: false },
  '03': { label: 'No se llevó a cabo la operación',  description: 'La operación descrita en la factura no se concretó',                           requiresSubstitution: false },
  '04': { label: 'Factura global (nominativa)',       description: 'Cancelación de factura global por facturación nominativa',                      requiresSubstitution: false },
}

// ── Facturapi error codes → user-friendly messages ──
const FP_ERROR_MAP = {
  invoice_cancellation_in_progress:           { message: 'Ya hay una cancelación en proceso para este CFDI. Espera a que el SAT confirme y usa "Actualizar estado".',     retryable: true,  suggestSync: true },
  invoice_cancellation_receipt_unavailable:    { message: 'El comprobante de cancelación no está disponible temporalmente. Intenta más tarde.',                           retryable: true,  suggestSync: true },
  invoice_cancellation_failed:                 { message: 'La cancelación falló en el servidor de Facturapi. Puedes reintentar.',                                       retryable: true,  suggestSync: false },
  invoice_cancellation_not_allowed:            { message: 'Este CFDI no puede ser cancelado en este momento. Verifica el estado en el portal del SAT.',                   retryable: false, suggestSync: true },
  invoice_cancellation_not_found:              { message: 'El CFDI no se encontró en la cuenta de Facturapi. Puede que ya fue cancelado o nunca se timbró.',               retryable: false, suggestSync: true },
  invoice_cancellation_rfc_mismatch:           { message: 'El RFC del emisor no coincide con la cuenta de Facturapi. Verifica la configuración fiscal.',                  retryable: false, suggestSync: false },
  invoice_cancellation_service_unavailable:    { message: 'El servicio de cancelación del SAT no está disponible temporalmente. Intenta más tarde.',                       retryable: true,  suggestSync: true },
  invoice_not_cancelable:                      { message: 'Este CFDI no es cancelable (puede estar en proceso de otro movimiento fiscal).',                              retryable: false, suggestSync: true },
  invoice_not_cancelable_by_sat:               { message: 'El SAT no permite cancelar este CFDI. Verifica directamente en el portal del SAT.',                             retryable: false, suggestSync: true },
  substitution_invoice_required:               { message: 'El motivo de cancelación requiere una factura de sustitución. Cambia el motivo a "02" o proporciona el UUID de sustitución.', retryable: false, suggestSync: false },
  substitution_invoice_not_found:              { message: 'La factura de sustitución no se encontró. Verifica el UUID proporcionado.',                                     retryable: false, suggestSync: false },
  substitution_invoice_canceled:               { message: 'La factura de sustitución ya fue cancelada. No se puede usar como sustituta.',                                 retryable: false, suggestSync: false },
  substitution_invoice_status_not_allowed:     { message: 'La factura de sustitución no tiene un estado válido para sustituir. Debe estar timbrada (status=valid).',      retryable: false, suggestSync: false },
}

// ════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════

/**
 * Map Facturapi invoice + cancellation status to JESHA unified state.
 * @param {Object} invoice - Facturapi invoice object (status, cancellation_status, cancellation)
 * @returns {Object} mapped state with badge, label, canCancel, canSync, type
 */
function mapFacturaState(invoice) {
  const status = invoice?.status
  const cs = invoice?.cancellation_status || 'none'
  const cancellation = invoice?.cancellation || {}

  const statusInfo = INVOICE_STATUS_MAP[status] || INVOICE_STATUS_MAP.valid
  const csInfo = CANCELLATION_STATUS_MAP[cs] || CANCELLATION_STATUS_MAP.none

  // Determine if invoice is canceled (terminal state)
  const isCanceled = status === 'canceled'

  // Handle accepted transitorio: cancellation_status=accepted but status=valid
  // This means SAT accepted the cancellation but invoice.status hasn't flipped yet
  const isAcceptedTransitorio = !isCanceled && cs === 'accepted'

  // Determine effective state
  let effectiveBadge = statusInfo.badge
  let effectiveLabel = statusInfo.label
  let effectiveType = statusInfo.type

  // If there's an active cancellation_status (not none), it overrides the status badge
  if (cs !== 'none' && !isCanceled) {
    effectiveBadge = csInfo.badge
    effectiveLabel = csInfo.label
    effectiveType = csInfo.type
  }

  // Canceled is always terminal regardless of cancellation_status
  if (isCanceled) {
    effectiveBadge = 'badge-cancelada'
    effectiveLabel = '✕ Cancelada'
    effectiveType = 'terminal'
  }

  return {
    // Status fields
    invoiceStatus: status,
    cancellationStatus: cs,
    isCanceled,
    isAcceptedTransitorio,

    // UI fields
    badge: effectiveBadge,
    label: effectiveLabel,
    tooltip: csInfo.tooltip || statusInfo.label,
    type: effectiveType,

    // Action flags
    canCancel: isCanceled ? false : csInfo.canCancel,
    canSync: isCanceled ? false : csInfo.canSync,

    // Cancellation detail
    motive: cancellation.motive || null,
    substitutionUUID: cancellation.substitution_uuid || null,
    requestedAt: cancellation.requested_at || null,
    lastChecked: cancellation.last_checked || null,
  }
}

/**
 * Map Facturapi error code to user-friendly message.
 * @param {string} code - Facturapi error code
 * @param {string} fallbackMessage - fallback message if code not mapped
 * @returns {Object} { message, retryable, suggestSync }
 */
function mapFpError(code, fallbackMessage) {
  if (!code) return { message: fallbackMessage || 'Error desconocido de Facturapi', retryable: false, suggestSync: false }
  const mapped = FP_ERROR_MAP[code]
  if (mapped) return mapped
  return { message: fallbackMessage || `Error de Facturapi: ${code}`, retryable: false, suggestSync: false }
}

/**
 * Validate motivo de cancelación.
 * @param {string} motivo
 * @returns {Object|null} { motivo, requiresSubstitution } or null if invalid
 */
function validateMotivo(motivo) {
  const m = MOTIVOS_SAT[motivo]
  if (!m) return null
  return { motivo, ...m }
}

/**
 * Get all valid motivos for UI selector.
 * @returns {Array<Object>} array of { value, label, description, requiresSubstitution }
 */
function getMotivosParaUI() {
  return Object.entries(MOTIVOS_SAT).map(([value, info]) => ({
    value,
    ...info,
  }))
}

/**
 * Build normalized cancellation response for frontend.
 * @param {Object} params
 * @returns {Object} normalized response
 */
function buildCancellationResponse({ success, mappedState, mensaje, warning, data }) {
  const response = { success: !!success }

  if (mappedState) {
    response.facturaEstado = mappedState.isCanceled ? 'CANCELADA' : null
    response.cancellationStatus = mappedState.cancellationStatus
    response.code = mappedState.invoiceStatus
    response.canCancel = mappedState.canCancel
    response.canSync = mappedState.canSync
    response.cancellationDetail = {
      badge: mappedState.badge,
      label: mappedState.label,
      tooltip: mappedState.tooltip,
      type: mappedState.type,
      motive: mappedState.motive,
      substitutionUUID: mappedState.substitutionUUID,
      requestedAt: mappedState.requestedAt,
      lastChecked: mappedState.lastChecked,
    }
  }

  if (mensaje) response.mensaje = mensaje
  if (warning) response.warning = warning
  if (data) response.data = data

  return response
}

module.exports = {
  mapFacturaState,
  mapFpError,
  validateMotivo,
  getMotivosParaUI,
  buildCancellationResponse,
  CANCELLATION_STATUS_MAP,
  INVOICE_STATUS_MAP,
  MOTIVOS_SAT,
  FP_ERROR_MAP,
}
