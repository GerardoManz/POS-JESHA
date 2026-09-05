// src/modules/impresion/impresion.routes.js
const router = require('express').Router()
const { requireTenantOrDelegated } = require('../../middlewares/tenant-or-delegated.middleware')
const ctrl = require('./impresion.controller')

// ── Frontend (JWT de usuario) ──
router.post('/job', requireTenantOrDelegated, ctrl.encolarManual)
router.get('/jobs/:id', requireTenantOrDelegated, ctrl.consultarEstado)
router.get('/jobs', requireTenantOrDelegated, ctrl.listarJobs)
router.post('/drawer', requireTenantOrDelegated, ctrl.abrirCajon)

// ── Agente (token estático, scoped por JESHA_AGENT_EMPRESA_ID) ──
router.post('/agent/next', ctrl.requireAgentAuth, ctrl.agentNext)
router.post('/agent/reset', ctrl.requireAgentAuth, ctrl.agentReset)
router.post('/agent/:id/success', ctrl.requireAgentAuth, ctrl.agentSuccess)
router.post('/agent/:id/fail', ctrl.requireAgentAuth, ctrl.agentFail)
router.post('/agent/:id/consume-drawer', ctrl.requireAgentAuth, ctrl.agentConsumeDrawer)

// ── Health de la cola (mismo token que el agente, auditable) ──
router.get('/health', ctrl.requireAgentAuth, ctrl.agentHealth)

module.exports = router
