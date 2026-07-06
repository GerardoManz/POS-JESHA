// src/modules/impresion/impresion.routes.js
const router = require('express').Router()
const { requireAuth } = require('../../middlewares/auth.middleware')
const ctrl = require('./impresion.controller')

// ── Frontend (JWT de usuario) ──
router.post('/job', requireAuth, ctrl.encolarManual)
router.get('/jobs/:id', requireAuth, ctrl.consultarEstado)
router.get('/jobs', requireAuth, ctrl.listarJobs)
router.post('/drawer', requireAuth, ctrl.abrirCajon)

// ── Agente (token estático, scoped por JESHA_AGENT_EMPRESA_ID) ──
router.post('/agent/next', ctrl.requireAgentAuth, ctrl.agentNext)
router.post('/agent/reset', ctrl.requireAgentAuth, ctrl.agentReset)
router.post('/agent/:id/success', ctrl.requireAgentAuth, ctrl.agentSuccess)
router.post('/agent/:id/fail', ctrl.requireAgentAuth, ctrl.agentFail)

// ── Health de la cola (mismo token que el agente, auditable) ──
router.get('/health', ctrl.requireAgentAuth, ctrl.agentHealth)

module.exports = router
