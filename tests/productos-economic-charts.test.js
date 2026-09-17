'use strict'

const assert = require('node:assert/strict')
const { describe, it, beforeEach } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'productos.js'), 'utf8')
const CSS = fs.readFileSync(path.join(__dirname, '..', 'productos.css'), 'utf8')

const chartStart = SOURCE.indexOf('// HISTORIAL — Gráficas de evolución')
const chartEnd = SOURCE.indexOf('function elemento(tag, clase, texto)', chartStart)
const CHART_SOURCE = SOURCE.slice(chartStart, chartEnd)

function makeCtx() {
  const toasts = []
  const formatoFechaHistorial = (v, soloFecha) => {
    if (!v) return '—'
    return new Date(v).toISOString().slice(0, 10)
  }
  const HISTORIAL_ORIGENES = { EDICION_PRECIOS: 'Edición de precios', COMPRA: 'Compra', CREACION_PRODUCTO: 'Creación' }
  const etiquetaDesconocida = (v) => v || '—'
  const window = { jeshaToast(msg) { toasts.push(msg) } }
  const document = {
    createElement(tag) {
      const children = []
      const attrs = {}
      return {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        children,
        childNodes: children,
        hidden: false,
        style: {},
        attributes: attrs,
        append(...nodes) { children.push(...nodes) },
        appendChild(node) { children.push(node); return node },
        replaceChildren() { children.length = 0 },
        setAttribute(k, v) { attrs[k] = v },
        getAttribute(k) { return attrs[k] },
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 } },
        addEventListener() {},
        closest() { return null }
      }
    },
    createElementNS(ns, tag) {
      const children = []
      const attrs = {}
      return {
        tagName: tag,
        namespaceURI: ns,
        className: '',
        textContent: '',
        children,
        childNodes: children,
        hidden: false,
        style: {},
        attributes: attrs,
        append(...nodes) { children.push(...nodes) },
        appendChild(node) { children.push(node); return node },
        replaceChildren() { children.length = 0 },
        setAttribute(k, v) { attrs[k] = v },
        getAttribute(k) { return attrs[k] },
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 } },
        addEventListener() {},
        closest() { return null }
      }
    }
  }
  const ctx = vm.createContext({ console, assert, Array, Number, Math, Date, String, Object, Map, Set, RegExp, JSON, parseInt, parseFloat, isNaN, isFinite, Intl, ...window, document, formatoFechaHistorial, HISTORIAL_ORIGENES, etiquetaDesconocida,
    elemento: function(tag, clase, texto) {
      const node = document.createElement(tag)
      if (clase) node.className = clase
      if (texto !== undefined) node.textContent = texto
      return node
    },
    limpiarNodo: function(node) { if (node) node.replaceChildren() }
  })
  vm.runInContext(CHART_SOURCE, ctx)
  return { ctx, toasts }
}

describe('G — Catalog chart: reconstruirSerieCatalogo', () => {
  it('G01 reconstruye precioVenta desde eventos HPP', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'precioVenta', valorAnterior: '100.0000', valorNuevo: '150.0000' }] },
      { id: 2, ocurridoEn: '2026-09-10T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'precioVenta', valorAnterior: '150.0000', valorNuevo: '170.0000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'precioVenta')
    assert.equal(puntos.length, 2)
    assert.equal(puntos[0].valor, 150)
    assert.equal(puntos[1].valor, 170)
  })

  it('G02 null baseline: creación no genera punto falso', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'CREACION_PRODUCTO', detalles: [{ campo: 'precioVenta', valorAnterior: null, valorNuevo: '100.0000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'precioVenta')
    assert.equal(puntos.length, 1)
    assert.equal(puntos[0].valor, 100)
  })

  it('G03 eventos de otros campos no crean punto para precioVenta', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'costo', valorAnterior: '50.0000', valorNuevo: '60.0000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'precioVenta')
    assert.equal(puntos.length, 0)
  })

  it('G04 cambio costo reconstruye correctamente', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'COMPRA', detalles: [{ campo: 'costo', valorAnterior: '50.0000', valorNuevo: '55.0000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'costo')
    assert.equal(puntos.length, 1)
    assert.equal(puntos[0].valor, 55)
  })

  it('G05 costoPromedio reconstruido', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'COMPRA', detalles: [{ campo: 'costoPromedio', valorAnterior: null, valorNuevo: '52.5000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'costoPromedio')
    assert.equal(puntos.length, 1)
    assert.equal(puntos[0].valor, 52.5)
  })

  it('G06 mayoreo reconstruido', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'precioMayoreo', valorAnterior: '80.0000', valorNuevo: '85.0000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'precioMayoreo')
    assert.equal(puntos.length, 1)
    assert.equal(puntos[0].valor, 85)
  })

  it('G07 margen reconstruido', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'margen', valorAnterior: '30.0000', valorNuevo: '35.0000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'margen')
    assert.equal(puntos.length, 1)
    assert.equal(puntos[0].valor, 35)
  })

  it('G08 orden cronológico ASC', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 2, ocurridoEn: '2026-09-10T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'precioVenta', valorAnterior: '150.0000', valorNuevo: '170.0000' }] },
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'precioVenta', valorAnterior: '100.0000', valorNuevo: '150.0000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'precioVenta')
    assert.equal(puntos[0].valor, 150)
    assert.equal(puntos[1].valor, 170)
  })

  it('G09 mismo timestamp: ordena por id', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 2, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'precioVenta', valorAnterior: '150.0000', valorNuevo: '170.0000' }] },
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'precioVenta', valorAnterior: '100.0000', valorNuevo: '150.0000' }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'precioVenta')
    assert.equal(puntos[0].valor, 150)
    assert.equal(puntos[1].valor, 170)
  })

  it('G10 historial vacío devuelve []', () => {
    const { ctx } = makeCtx()
    const result = ctx.reconstruirSerieCatalogo([], 'precioVenta')
    assert.ok(Array.isArray(result), 'returns an array')
    assert.equal(result.length, 0, 'empty array')
  })

  it('G11 valorNuevo null genera punto con valor null', () => {
    const { ctx } = makeCtx()
    const historial = [
      { id: 1, ocurridoEn: '2026-09-01T10:00:00Z', origen: 'EDICION_PRECIOS', detalles: [{ campo: 'precioVenta', valorAnterior: '100.0000', valorNuevo: null }] }
    ]
    const puntos = ctx.reconstruirSerieCatalogo(historial, 'precioVenta')
    assert.equal(puntos.length, 1)
    assert.equal(puntos[0].valor, null)
  })
})

describe('G — Purchases chart: reconstruirSerieObservada', () => {
  it('G12 puntos de costoUnitario desde compras', () => {
    const { ctx } = makeCtx()
    const rows = [
      { id: 1, fecha: '2026-09-01T10:00:00Z', costoUnitario: '55.00', proveedor: null, referencia: 'OC-001' },
      { id: 2, fecha: '2026-09-10T10:00:00Z', costoUnitario: '60.00', proveedor: null, referencia: 'OC-002' }
    ]
    const puntos = ctx.reconstruirSerieObservada(rows, 'costoUnitario')
    assert.equal(puntos.length, 2)
    assert.equal(puntos[0].valor, 55)
    assert.equal(puntos[1].valor, 60)
  })

  it('G13 costoUnitario null se filtra', () => {
    const { ctx } = makeCtx()
    const rows = [
      { id: 1, fecha: '2026-09-01T10:00:00Z', costoUnitario: null, proveedor: null, referencia: null }
    ]
    const puntos = ctx.reconstruirSerieObservada(rows, 'costoUnitario')
    assert.equal(puntos.length, 0)
  })

  it('G14 orden cronológico ASC', () => {
    const { ctx } = makeCtx()
    const rows = [
      { id: 2, fecha: '2026-09-10T10:00:00Z', costoUnitario: '60.00', proveedor: null, referencia: null },
      { id: 1, fecha: '2026-09-01T10:00:00Z', costoUnitario: '55.00', proveedor: null, referencia: null }
    ]
    const puntos = ctx.reconstruirSerieObservada(rows, 'costoUnitario')
    assert.equal(puntos[0].valor, 55)
    assert.equal(puntos[1].valor, 60)
  })

  it('G15 resumen backend no se recalcula', () => {
    assert.match(SOURCE, /renderResumenObservado/)
    assert.doesNotMatch(CHART_SOURCE, /promedio.*=.*sum|weighted/)
  })

  it('G16 rows vacío devuelve []', () => {
    const { ctx } = makeCtx()
    const result = ctx.reconstruirSerieObservada([], 'costoUnitario')
    assert.ok(Array.isArray(result), 'returns an array')
    assert.equal(result.length, 0, 'empty array')
  })
})

describe('G — Sales chart: reconstruirSerieObservada for ventas', () => {
  it('G17 puntos de precioUnitario desde ventas', () => {
    const { ctx } = makeCtx()
    const rows = [
      { id: 1, fecha: '2026-09-01T10:00:00Z', precioUnitario: '150.00', proveedor: null, referencia: null },
      { id: 2, fecha: '2026-09-10T10:00:00Z', precioUnitario: '160.00', proveedor: null, referencia: null }
    ]
    const puntos = ctx.reconstruirSerieObservada(rows, 'precioUnitario')
    assert.equal(puntos.length, 2)
    assert.equal(puntos[0].valor, 150)
    assert.equal(puntos[1].valor, 160)
  })

  it('G18 precioUnitario null se filtra', () => {
    const { ctx } = makeCtx()
    const rows = [
      { id: 1, fecha: '2026-09-01T10:00:00Z', precioUnitario: null, proveedor: null, referencia: null }
    ]
    const puntos = ctx.reconstruirSerieObservada(rows, 'precioUnitario')
    assert.equal(puntos.length, 0)
  })

  it('G19 no usa Producto.precioVenta', () => {
    assert.doesNotMatch(CHART_SOURCE, /Producto\.precioVenta/)
  })

  it('G20 resumen backend intacto para ventas', () => {
    assert.match(SOURCE, /promedioMetodo.*ponderado|ponderado.*promedio/)
  })
})

describe('G — SVG chart renderer', () => {
  it('G21 renderGraficaHistorial genera SVG con viewBox', () => {
    const { ctx } = makeCtx()
    const puntos = [
      { fecha: '2026-09-01T10:00:00Z', valor: 100, origen: 'test' },
      { fecha: '2026-09-10T10:00:00Z', valor: 150, origen: 'test' }
    ]
    const result = ctx.renderGraficaHistorial(puntos, { tipo: 'moneda', etiqueta: 'test' })
    assert.ok(result, 'returns a wrapper element')
    const svg = result.children[0]
    assert.equal(svg.tagName, 'svg')
    assert.ok(svg.attributes.viewBox, 'has viewBox')
  })

  it('G22 0 puntos devuelve null', () => {
    const { ctx } = makeCtx()
    assert.equal(ctx.renderGraficaHistorial([], { tipo: 'moneda' }), null)
  })

  it('G23 1 punto genera gráfica válida', () => {
    const { ctx } = makeCtx()
    const puntos = [{ fecha: '2026-09-01T10:00:00Z', valor: 100, origen: null }]
    const result = ctx.renderGraficaHistorial(puntos, { tipo: 'moneda' })
    assert.ok(result)
  })

  it('G24 todos null genera null', () => {
    const { ctx } = makeCtx()
    const puntos = [
      { fecha: '2026-09-01T10:00:00Z', valor: null, origen: null }
    ]
    assert.equal(ctx.renderGraficaHistorial(puntos, { tipo: 'moneda' }), null)
  })

  it('G25 puntos generan circles con data attributes', () => {
    const { ctx } = makeCtx()
    const puntos = [
      { fecha: '2026-09-01T10:00:00Z', valor: 100, origen: 'test' }
    ]
    const result = ctx.renderGraficaHistorial(puntos, { tipo: 'moneda' })
    const circles = result.children[0].children.filter(c => c.tagName === 'circle')
    assert.ok(circles.length >= 1, 'has circle')
    assert.equal(circles[0].attributes['data-valor'], '$100.00')
  })

  it('G26 porcentaje formatea como XX.XX%', () => {
    const { ctx } = makeCtx()
    const puntos = [{ fecha: '2026-09-01T10:00:00Z', valor: 35.5, origen: null }]
    const result = ctx.renderGraficaHistorial(puntos, { tipo: 'porcentaje' })
    const circles = result.children[0].children.filter(c => c.tagName === 'circle')
    assert.equal(circles[0].attributes['data-valor'], '35.50%')
  })
})

describe('G — UI integration', () => {
  it('G27 renderSelectorSerieCatalogo genera select con opciones', () => {
    const { ctx } = makeCtx()
    const select = ctx.renderSelectorSerieCatalogo('precioVenta', () => {})
    assert.equal(select.tagName, 'SELECT')
    assert.equal(select.children.length, 5)
    assert.equal(select.children[0].value, 'precioVenta')
  })

  it('G28 selector tiene aria-label', () => {
    const { ctx } = makeCtx()
    const select = ctx.renderSelectorSerieCatalogo('precioVenta', () => {})
    assert.equal(select.attributes['aria-label'], 'Serie a graficar')
  })

  it('G29 renderCatalogoHistorial incluye gráfica section', () => {
    assert.match(SOURCE, /historial-grafica-section/)
    assert.match(SOURCE, /renderSelectorSerieCatalogo/)
    assert.match(SOURCE, /reconstruirSerieCatalogo/)
  })

  it('G30 renderObservadoHistorial incluye gráfica para compras', () => {
    assert.match(SOURCE, /reconstruirSerieObservada\(rows, campoGrafica\)/)
    assert.match(SOURCE, /costoUnitario/)
  })

  it('G31 renderObservadoHistorial incluye gráfica para ventas', () => {
    assert.match(SOURCE, /precioUnitario/)
  })
})

describe('G — CSS chart styles', () => {
  it('G32 historial-grafica-section existe', () => {
    assert.match(CSS, /\.historial-grafica-section/)
  })

  it('G33 historial-grafica-svg responsive', () => {
    assert.match(CSS, /\.historial-grafica-svg/)
    assert.match(CSS, /width:\s*100%/)
  })

  it('G34 tooltip existe', () => {
    assert.match(CSS, /\.historial-grafica-tooltip/)
  })

  it('G35 selector styling', () => {
    assert.match(CSS, /\.historial-serie-selector/)
  })
})

describe('G — Race safety: A→B chart cleanup', () => {
  it('G36 limpiarNodo se usa en renderCatalogoHistorial', () => {
    assert.match(SOURCE, /function renderCatalogoHistorial[\s\S]*?limpiarNodo\(panel\)/)
  })

  it('G37 limpiarNodo se usa en renderObservadoHistorial', () => {
    assert.match(SOURCE, /function renderObservadoHistorial[\s\S]*?limpiarNodo\(panel\)/)
  })

  it('G38 gráfica container se limpia al cambiar serie', () => {
    assert.match(SOURCE, /actualizarGraficaCatalogo[\s\S]*?limpiarNodo\(graficaContainer\)/)
  })
})

describe('G — Regression: existing features unchanged', () => {
  it('G39 debounce 400ms sin cambios', () => {
    assert.match(SOURCE, /setTimeout\(function\(\) \{ aplicarFiltros\(\) \}, 400\)/)
  })

  it('G40 voice search sin cambios', () => {
    assert.match(SOURCE, /configurarBusquedaVoz/)
    assert.match(SOURCE, / SpeechRecognition/)
  })
})
