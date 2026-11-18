'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const HTML = fs.readFileSync(path.join(ROOT, 'notas.html'), 'utf8')
const SOURCE = fs.readFileSync(path.join(ROOT, 'notas.js'), 'utf8')
const CSS = fs.readFileSync(path.join(ROOT, 'notas.css'), 'utf8')
const SIDEBAR = fs.readFileSync(path.join(ROOT, 'sidebar.js'), 'utf8')
const SIDEBAR_HTML = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8')
const SESSION = fs.readFileSync(path.join(ROOT, 'session.js'), 'utf8')
const BUILD_PS = fs.readFileSync(path.join(ROOT, 'build-frontend.ps1'), 'utf8')
const BUILD_SH = fs.readFileSync(path.join(ROOT, 'build-frontend.sh'), 'utf8')

function cargarUI({ rol = 'SUPERADMIN', sucursalId = null, selectedSucursalId = null } = {}) {
  const elementos = {
    'nota-titulo': { value: 'Aviso de inventario' },
    'nota-contenido': { value: 'Revisar existencias al cierre.' },
    'nota-alcance': { value: 'USUARIO' },
    'nota-sucursal': { value: '' },
    'nota-usuario': { value: '27' }
  }
  const usuario = { id: 5, rol, sucursalId, empresaId: 10 }
  const window = {
    location: { href: '', replace() {} },
    jeshaSession: {
      getUsuario: () => usuario,
      isValid: () => true,
      getSelectedSucursalId: () => selectedSucursalId
    }
  }
  const document = {
    addEventListener() {},
    getElementById: id => elementos[id] || null
  }
  const context = vm.createContext({ window, document, localStorage: { setItem() {} }, URLSearchParams, console, Set, Number, Date })
  vm.runInContext(SOURCE, context, { filename: 'notas.js' })
  return { UI: window.NotasUI, elementos }
}

describe('NOTAS frontend shell and navigation', () => {
  it('usa el shell de Pedidos y conserva el orden canónico de scripts', () => {
    assert.match(HTML, /<body data-page="notas">/)
    assert.match(HTML, /class="ped-table"/)
    const scripts = ['config.js', 'sonidos.js', 'session.js', 'sidebar.js', 'pagination.js', 'notas.js']
    for (let i = 1; i < scripts.length; i += 1) {
      assert.ok(HTML.indexOf(scripts[i - 1]) < HTML.indexOf(scripts[i]), `${scripts[i - 1]} carga antes que ${scripts[i]}`)
    }
  })

  it('muestra Notas a todos los roles tenant y deja el badge fuera de menu-text', () => {
    assert.match(SIDEBAR_HTML, /data-page="notas"/)
    assert.match(SIDEBAR_HTML, /<span class="menu-text">Notas<\/span>\s*<span id="notas-unread-badge"/)
    for (const role of ['ADMIN_SUCURSAL', 'EMPLEADO', 'PRECIOS']) {
      const match = SIDEBAR.match(new RegExp(`${role}:\\s*\\[([\\s\\S]*?)\\]`))
      assert.ok(match, `existe matriz para ${role}`)
      assert.doesNotMatch(match[1], /['"]notas['"]/, `${role} puede navegar a Notas`)
    }
  })

  it('incluye los tres assets en ambas whitelist y /notas en el wrapper de sesión', () => {
    for (const asset of ['notas.html', 'notas.css', 'notas.js']) {
      assert.ok(BUILD_PS.includes(`"${asset}"`), `${asset} está en PowerShell`)
      assert.match(BUILD_SH, new RegExp(`\\b${asset.replace('.', '\\.') }\\b`))
    }
    assert.match(SESSION, /['"]\/notas['"]/)
  })

  it('cambia a cards en móvil y mantiene estilos basados en el tema actual', () => {
    assert.match(CSS, /@media \(max-width: 640px\)/)
    assert.match(CSS, /\.notas-tabla-wrap \{ display: none; \}/)
    assert.match(CSS, /\.notas-cards \{ display: block; \}/)
    assert.match(CSS, /var\(--text\)/)
    assert.match(CSS, /var\(--panel-border\)/)
  })
})

describe('NOTAS frontend contracts', () => {
  it('normaliza el envelope paginado del backend', () => {
    const { UI } = cargarUI()
    const result = UI.normalizarPagina({
      success: true,
      data: [{ id: 1 }],
      paginacion: { page: 2, limit: 25, total: 76, totalPages: 4 }
    })
    assert.equal(result.data.length, 1)
    assert.equal(result.page, 2)
    assert.equal(result.total, 76)
    assert.equal(result.totalPages, 4)
  })

  it('publica destino personal con usuarioDestinatarioId', () => {
    const { UI } = cargarUI()
    const payload = UI.payloadPublicacion()
    assert.equal(payload.usuarioDestinatarioId, 27)
    assert.equal(Object.hasOwn(payload, 'usuarioId'), false)
    assert.equal(payload.alcance, 'USUARIO')
  })

  it('restringe empresa a SUPERADMIN y fija sucursal para roles de sucursal', () => {
    const superadmin = cargarUI({ rol: 'SUPERADMIN', selectedSucursalId: 8 }).UI
    const empleado = cargarUI({ rol: 'EMPLEADO', sucursalId: 4 }).UI
    assert.equal(superadmin.resolverEstadoDestino('SUPERADMIN', 'EMPRESA', {}).alcancePermitido, true)
    assert.equal(empleado.resolverEstadoDestino('EMPLEADO', 'EMPRESA', { sucursalId: 4 }).alcancePermitido, false)
    const destino = empleado.resolverEstadoDestino('EMPLEADO', 'SUCURSAL', { sucursalId: 4 })
    assert.equal(destino.sucursalBloqueada, true)
    assert.equal(destino.sucursalId, 4)
  })

  it('usa valores de lectura y nombres de respuesta del contrato', () => {
    assert.match(HTML, /value="no_leidas"/)
    assert.match(HTML, /value="leidas"/)
    assert.match(SOURCE, /nota\.creadaEn/)
    assert.match(SOURCE, /nota\.autor\?\.nombre/)
    assert.match(SOURCE, /lectura\.usuario\?\.nombre/)
  })

  it('no inserta texto del backend mediante innerHTML', () => {
    assert.doesNotMatch(SOURCE, /innerHTML/)
    assert.match(SOURCE, /\.textContent =/)
  })
})

describe('NOTAS sidebar poller', () => {
  it('consume unreadCount, limita 99+ y expone decrement/refresh', () => {
    assert.match(SIDEBAR, /data\.unreadCount/)
    assert.match(SIDEBAR, /safeTotal > 99 \? '99\+'/)
    assert.match(SIDEBAR, /window\.jeshaNotas = notasPoller/)
    assert.match(SIDEBAR, /\{ attach, update, decrement, refresh,/)
  })

  it('no notifica el baseline, pausa oculto y termina en 401/403/404', () => {
    assert.match(SIDEBAR, /let initialized = false/)
    assert.match(SIDEBAR, /document\.visibilityState === 'hidden'[\s\S]*?return/)
    assert.match(SIDEBAR, /\[401, 403, 404\]\.includes/)
    assert.match(SIDEBAR, /Math\.min\(300000,/)
  })
})
