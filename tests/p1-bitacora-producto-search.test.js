'use strict'
const assert = require('node:assert/strict')
const { describe, it, before } = require('node:test')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

// ── Carga real de bitacora.js en un sandbox (sin DOM real) para probar las
//    funciones puras de búsqueda tal cual están en producción. ──
let sandbox
before(() => {
  const src = read('bitacora.js')
  sandbox = {
    window: { jeshaSession: { getUsuario: () => ({ rol: 'SUPERADMIN', nombre: 'tester' }) } },
    document: {
      addEventListener() {},
      getElementById() { return null },
      querySelectorAll() { return [] }
    },
    console,
    setTimeout,
    clearTimeout
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  // Puente en el MISMO scope del script para poder fijar el estado léxico
  // (filtroMateriales / bitacoraActual) y ejercitar aplicarFiltroMaterialesLocal real.
  const bridge = `
;globalThis.__p1_5_applyFake = function (detalles, term, tbody) {
  bitacoraActual = { DetalleBitacora: detalles };
  filtroMateriales = term;
  document.getElementById = function () { return tbody; };
  document.createElement = function () { return { className: '', innerHTML: '' }; };
  aplicarFiltroMaterialesLocal();
};
`
  vm.runInContext(src + bridge, sandbox, { filename: 'bitacora.js' })
})

function makeFakeTbody(detalles) {
  const rows = detalles.map(d => ({
    dataset: { detid: String(d.id), retiro: '' },
    style: { display: '' },
    className: ''
  }))
  return {
    __rows: rows,
    querySelectorAll(selector) {
      if (selector === 'tr[data-detid]') return rows.slice()
      if (selector === 'tr[data-retiro-header]') return []
      if (selector === '.filtro-materiales-vacio') return rows.filter(r => r.className === 'filtro-materiales-vacio')
      const m = /^tr\[data-detid\]\[data-retiro="(.*)"\]$/.exec(selector)
      if (m) return rows.filter(r => r.dataset.retiro === m[1])
      return []
    },
    appendChild(r) {
      r.remove = () => { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1) }
      rows.push(r)
    }
  }
}

const visibleRows = tbody => tbody.__rows.filter(r => r.className !== 'filtro-materiales-vacio' && r.style.display !== 'none')

const fn = (name) => {
  const f = sandbox[name]
  assert.equal(typeof f, 'function', `bitacora.js debe exponer ${name}`)
  return f
}

// ── Fixtures: Bitácora A (id 25) y Bitácora B (id 26) ──
const A = {
  id: 25,
  totalMateriales: 2600,
  totalAbonado: 1600,
  saldoPendiente: 1000,
  DetalleBitacora: [
    { id: 1, subtotal: 300,  Producto: { nombre: 'MARTILLO TRUPER',      codigoInterno: '228045', codigoBarras: '7501234567890', activo: true } },
    { id: 2, subtotal: 150,  Producto: { nombre: 'PINZA ELECTRICISTA',   codigoInterno: 'PIN-01', codigoBarras: null,           activo: true } },
    { id: 3, subtotal: 50,   Producto: { nombre: 'TORNILLO 1/4',         codigoInterno: 'TOR14',  codigoBarras: '0001234',      activo: true } },
    { id: 4, subtotal: 2000, Producto: { nombre: 'CEMENTO GRIS',         codigoInterno: 'CEM',    codigoBarras: '75099',        activo: true } },
    { id: 5, subtotal: 100,  Producto: { nombre: 'MARTILLO TRUPER',      codigoInterno: '228045', codigoBarras: '7501234567890', activo: true } },
    { id: 6, subtotal: 80,   Producto: { nombre: 'DESARMADOR VIEJO',     codigoInterno: 'DSM',    codigoBarras: null,           activo: false } }
  ]
}

const B = {
  id: 26,
  totalMateriales: 999,
  saldoPendiente: 999,
  DetalleBitacora: [
    { id: 10, subtotal: 999, Producto: { nombre: 'TORNILLO 1/4', codigoInterno: 'TOR14', codigoBarras: '0001234', activo: true } }
  ]
}

const idsA = (term) => fn('filtrarDetallesBitacora')(A.DetalleBitacora, term).idsVisibles

describe('P1-5 — Búsqueda de productos dentro de Bitácora (semántica)', () => {
  it('T01 nombre exacto', () => {
    assert.deepEqual(idsA('MARTILLO TRUPER'), [1, 5])
  })

  it('T02 nombre lowercase / case-insensitive', () => {
    assert.deepEqual(idsA('martillo trupER'), [1, 5])
    assert.deepEqual(idsA('pinza'), [2])
  })

  it('T03 nombre parcial (contains)', () => {
    assert.deepEqual(idsA('tornill'), [3])
    assert.deepEqual(idsA('mart'), [1, 5])
  })

  it('T04 codigoInterno exacto y parcial', () => {
    assert.deepEqual(idsA('228045'), [1, 5])
    assert.deepEqual(idsA('228'), [1, 5])
    assert.deepEqual(idsA('pin-01'), [2])
  })

  it('T05 codigoBarras', () => {
    assert.deepEqual(idsA('7501234567890'), [1, 5])
    assert.deepEqual(idsA('75099'), [4])
  })

  it('T06 producto inexistente → sin coincidencias', () => {
    assert.deepEqual(idsA('ZZZ-NO-EXISTE'), [])
  })

  it('T07 término vacío → todas las líneas', () => {
    assert.deepEqual(idsA(''), [1, 2, 3, 4, 5, 6])
  })

  it('T08 whitespace → todas las líneas', () => {
    assert.deepEqual(idsA('   \t  '), [1, 2, 3, 4, 5, 6])
  })

  it('T09 varias coincidencias', () => {
    assert.deepEqual(idsA('TRUPER'), [1, 5])
  })

  it('T10 mismo producto repetido → TODAS las líneas (no deduplica)', () => {
    assert.deepEqual(idsA('228045'), [1, 5])
    assert.equal(idsA('228045').length, 2)
  })

  it('T11 búsqueda en Bitácora A no afecta Bitácora B', () => {
    const resA = fn('filtrarDetallesBitacora')(A.DetalleBitacora, 'TORNILLO')
    const resB = fn('filtrarDetallesBitacora')(B.DetalleBitacora, 'TORNILLO')
    assert.deepEqual(resA.idsVisibles, [3])
    assert.deepEqual(resB.idsVisibles, [10])
    assert.ok(!resA.idsVisibles.includes(10), 'A no debe exponer líneas de B')
    // B intacta tras buscar en A
    assert.equal(B.DetalleBitacora.length, 1)
    assert.equal(B.totalMateriales, 999)
  })

  it('T12 limpiar restaura todas las líneas', () => {
    const filtrada = fn('filtrarDetallesBitacora')(A.DetalleBitacora, 'PINZA')
    assert.deepEqual(filtrada.idsVisibles, [2])
    const limpia = fn('filtrarDetallesBitacora')(A.DetalleBitacora, '')
    assert.deepEqual(limpia.idsVisibles, [1, 2, 3, 4, 5, 6])
  })

  it('T13 orden original preservado en resultados', () => {
    assert.deepEqual(idsA('750'), [1, 4, 5])
  })

  it('T14 totals antes = totals durante búsqueda (función pura no los toca)', () => {
    const before = A.totalMateriales
    fn('filtrarDetallesBitacora')(A.DetalleBitacora, 'PINZA')
    assert.equal(A.totalMateriales, before)
    const res = fn('filtrarDetallesBitacora')(A.DetalleBitacora, 'PINZA')
    assert.deepEqual(Object.keys(res).sort(), ['idsVisibles', 'term'])
  })

  it('T15 saldo antes = saldo durante búsqueda', () => {
    const before = A.saldoPendiente
    fn('filtrarDetallesBitacora')(A.DetalleBitacora, 'CEMENTO')
    assert.equal(A.saldoPendiente, before)
  })

  it('T16 acciones siguen disponibles (filtro no borra filas ni handlers)', () => {
    const js = read('bitacora.js')
    const body = js.slice(js.indexOf('function aplicarFiltroMaterialesLocal'), js.indexOf('function renderDetalleItems'))
    assert.ok(body.includes(".style.display = coincide ? '' : 'none'"), 'debe ocultar con style.display')
    assert.ok(!body.includes('btn-quitar-prod'), 'no debe eliminar botones de acción')
    assert.ok(!body.includes('removeEventListener'), 'no debe desconectar handlers')
  })

  it('T17 codigoBarras null no rompe', () => {
    const txt = fn('textoBuscableLinea')(A.DetalleBitacora[1])
    assert.ok(typeof txt === 'string')
    assert.ok(txt.includes('pinza electricista'))
    assert.deepEqual(idsA('PIN-01'), [2])
  })

  it('T18 códigos tratados como string (ceros iniciales preservados)', () => {
    assert.deepEqual(idsA('0001234'), [3])
    assert.deepEqual(idsA('0001'), [3])
    const txt = fn('textoBuscableLinea')(A.DetalleBitacora[2])
    assert.ok(txt.includes('0001234'), 'el barcode debe conservar ceros iniciales')
  })

  it('T19 producto inactivo que ya pertenece a la Bitácora sí se encuentra', () => {
    assert.deepEqual(idsA('DESARMADOR'), [6])
  })

  it('T20 estado vacío de búsqueda ≠ Bitácora realmente vacía', () => {
    const vacia = fn('filtrarDetallesBitacora')([], 'PINZA')
    assert.deepEqual(vacia.idsVisibles, [])
    const sinMatch = fn('filtrarDetallesBitacora')(A.DetalleBitacora, 'ZZZ')
    assert.deepEqual(sinMatch.idsVisibles, [])
    const js = read('bitacora.js')
    assert.ok(js.includes('term && visibles === 0 && detalles.length > 0'),
      'el estado "sin resultados" solo aplica si la bitácora tiene líneas')
  })
})

describe('P1-5 — Patrón P3/P4 reutilizado (HTML/CSS)', () => {
  const html = read('bitacora.html')

  it('T21 input de búsqueda interno existe con id search-materiales', () => {
    assert.ok(html.includes('id="search-materiales"'), 'falta #search-materiales')
  })

  it('T22 reutiliza clases .search-group y .search-input (igual que P3/P4)', () => {
    const block = html.slice(html.indexOf('id="search-materiales"') - 400, html.indexOf('id="search-materiales"') + 120)
    assert.ok(block.includes('class="search-group"'), 'debe usar .search-group')
    assert.ok(block.includes('class="search-input"'), 'debe usar .search-input')
  })

  it('T23 reutiliza el icono SVG de lupa del patrón existente', () => {
    const block = html.slice(html.indexOf('id="search-materiales"') - 400, html.indexOf('id="search-materiales"'))
    assert.ok(block.includes('<svg') && block.includes('circle cx="11"'), 'debe reusar icono lupa')
  })

  it('T24 placeholder acorde al patrón', () => {
    assert.ok(html.includes('placeholder="Buscar producto o código..."'), 'placeholder incorrecto')
  })

  it('T25 ubicado DENTRO del detalle (#modal-detalle), no global', () => {
    const modalIdx = html.indexOf('id="modal-detalle"')
    const inputIdx = html.indexOf('id="search-materiales"')
    assert.ok(modalIdx !== -1 && inputIdx > modalIdx, 'el buscador debe estar dentro del modal de detalle')
    const globalToolbar = html.indexOf('id="search-input"')
    assert.ok(globalToolbar !== -1 && globalToolbar < modalIdx, 'search-input global no debe reutilizarse aquí')
  })
})

describe('P1-5 — Implementación client-side + debounce', () => {
  const js = read('bitacora.js')

  it('T26 estado scoped por bitácora (filtroMateriales reiniciado al abrir/cerrar)', () => {
    assert.ok(js.includes('let filtroMateriales'), 'debe declarar filtroMateriales')
    const limpiado = /filtroMateriales\s*=\s*''/
    const abrir = js.slice(js.indexOf('async function abrirDetalle'), js.indexOf('async function cerrarDetalle'))
    assert.ok(limpiado.test(abrir), 'debe limpiar filtro al abrir')
    const cerrar = js.slice(js.indexOf('async function cerrarDetalle'), js.indexOf('function renderDetalle()'))
    assert.ok(limpiado.test(cerrar), 'debe limpiar filtro al cerrar')
  })

  it('T27 sin llamadas de red en el filtrado (client-side)', () => {
    const body = js.slice(js.indexOf('function aplicarFiltroMaterialesLocal'), js.indexOf('function renderDetalleItems'))
    assert.ok(!body.includes('apiFetch') && !body.includes('fetch('), 'el filtro no debe hacer fetch')
  })

  it('T28 debounce presente y copiado del patrón de lista (400ms)', () => {
    assert.ok(js.includes('debounceMateriales'), 'debe usar debounceMateriales')
    assert.ok(js.includes("}, 400)"), 'debe usar 400ms como los filtros de lista')
  })

  it('T29 normalización trim + lowercase', () => {
    const norm = fn('normalizarFiltroMateriales')
    assert.equal(norm('  HOLA  '), 'hola')
    assert.equal(norm(null), '')
    assert.equal(norm(undefined), '')
  })

  it('T30 se aplica tras cada render (compatible con re-render por edición)', () => {
    const body = js.slice(js.indexOf('function renderDetalleItems'), js.indexOf('function filaProductoGuardadoHTML'))
    assert.ok(body.includes('aplicarFiltroMaterialesLocal()'), 'debe reaplicar el filtro en cada render')
  })
})

describe('P1-5 — Backend: codigoBarras expuesto (sin cambio de schema)', () => {
  const ctrl = read(path.join('jesha-pos-backend', 'src', 'modules', 'bitacora', 'bitacora.controller.js'))
  const schema = read(path.join('jesha-pos-backend', 'prisma', 'schema.prisma'))

  it('T31 BITACORA_SELECT incluye codigoBarras de Producto', () => {
    assert.ok(ctrl.includes('codigoBarras: true'), 'el select debe exponer codigoBarras')
  })

  it('T32 no se agregó ningún endpoint nuevo para P1-5', () => {
    const routes = read(path.join('jesha-pos-backend', 'src', 'modules', 'bitacora', 'bitacora.routes.js'))
    assert.ok(!routes.includes('search'), 'no debe existir ruta de búsqueda nueva')
    assert.ok(!routes.includes('buscar-producto'), 'no debe existir ruta de búsqueda nueva')
  })

  it('T33 Producto.codigoBarras es String? (tratado como string)', () => {
    const idx = schema.indexOf('model Producto')
    const block = schema.slice(idx, schema.indexOf('}', idx))
    assert.ok(/codigoBarras\s+String\?/.test(block), 'codigoBarras debe ser String? en schema')
  })
})

describe('P1-5 — Gate de bitácora grande (25 líneas, determinista)', () => {
  const LARGE = { id: 999, totalMateriales: 0, saldoPendiente: 123.45, DetalleBitacora: [] }
  for (let i = 1; i <= 5; i++) {
    LARGE.DetalleBitacora.push({
      id: i, subtotal: 10,
      Producto: { nombre: 'MARTILLO TRUPER', codigoInterno: 'MART-001', codigoBarras: '7500000000001' }
    })
  }
  for (let i = 6; i <= 25; i++) {
    LARGE.DetalleBitacora.push({
      id: i, subtotal: 20,
      Producto: { nombre: 'PRODUCTO ' + i, codigoInterno: 'P-' + i, codigoBarras: '750000001' + String(i).padStart(4, '0') }
    })
  }
  LARGE.totalMateriales = LARGE.DetalleBitacora.reduce((s, d) => s + d.subtotal, 0) // 5*10 + 20*20 = 450
  const originalIds = LARGE.DetalleBitacora.map(d => String(d.id))

  it('LARGE_BITACORA_ROWS=25', () => {
    assert.equal(LARGE.DetalleBitacora.length, 25)
    assert.equal(makeFakeTbody(LARGE.DetalleBitacora).__rows.length, 25)
  })

  it('LARGE_SEARCH por nombre (>=5 coincidencias, filas originales preservadas)', () => {
    const tbody = makeFakeTbody(LARGE.DetalleBitacora)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, 'MARTILLO', tbody)
    assert.equal(visibleRows(tbody).length, 5)
    assert.equal(tbody.__rows.length, 25, 'las 25 filas/acciones siguen en el DOM')
  })

  it('LARGE_SEARCH por código interno', () => {
    const tbody = makeFakeTbody(LARGE.DetalleBitacora)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, 'MART-001', tbody)
    assert.equal(visibleRows(tbody).length, 5)
  })

  it('LARGE_SEARCH por código de barras', () => {
    const tbody = makeFakeTbody(LARGE.DetalleBitacora)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, '7500000000001', tbody)
    assert.equal(visibleRows(tbody).length, 5)
  })

  it('LARGE_CLEAR restaura las 25 líneas', () => {
    const tbody = makeFakeTbody(LARGE.DetalleBitacora)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, 'MARTILLO', tbody)
    assert.equal(visibleRows(tbody).length, 5)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, '', tbody)
    assert.equal(visibleRows(tbody).length, 25)
  })

  it('LARGE_ORDER_RESTORED (orden original intacto)', () => {
    const tbody = makeFakeTbody(LARGE.DetalleBitacora)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, 'PRODUCTO 1', tbody)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, '', tbody)
    const ids = tbody.__rows.filter(r => r.className !== 'filtro-materiales-vacio').map(r => r.dataset.detid)
    assert.deepEqual(ids, originalIds)
  })

  it('LARGE_TOTAL_UNCHANGED (total lógico y saldo intactos)', () => {
    const before = LARGE.totalMateriales
    const saldoBefore = LARGE.saldoPendiente
    const tbody = makeFakeTbody(LARGE.DetalleBitacora)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, 'MARTILLO', tbody)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, '', tbody)
    assert.equal(LARGE.totalMateriales, before)
    assert.equal(LARGE.saldoPendiente, saldoBefore)
  })

  it('LARGE_ACTIONS_PRESERVED (25 filas durante y tras búsqueda)', () => {
    const tbody = makeFakeTbody(LARGE.DetalleBitacora)
    sandbox.__p1_5_applyFake(LARGE.DetalleBitacora, 'MARTILLO', tbody)
    assert.equal(tbody.__rows.filter(r => r.className !== 'filtro-materiales-vacio').length, 25)
    assert.equal(visibleRows(tbody).length, 5)
  })
})
