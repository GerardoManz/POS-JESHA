'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const bitacora = fs.readFileSync(path.join(ROOT, 'bitacora.js'), 'utf8')
const sidebar = fs.readFileSync(path.join(ROOT, 'sidebar.js'), 'utf8')

describe('Cancelación de bitácoras frontend', () => {
  it('solo ofrece cancelación directa para origen MANUAL y roles operativos existentes', () => {
    assert.match(bitacora, /b\.origen === 'MANUAL' && puedeCancelarRol/)
    assert.match(bitacora, /\['SUPERADMIN', 'ADMIN_SUCURSAL', 'EMPLEADO'\]/)
    assert.doesNotMatch(bitacora, /ADMIN_EMPRESA|admin_empresa/)
  })

  it('orienta las bitácoras VENTA al historial de ventas', () => {
    assert.match(bitacora, /Para revertir esta cuenta, cancela la venta desde Historial de ventas/)
  })

  it('envía PATCH con estado CANCELADA y motivo, sin empresaId ni sucursalId', () => {
    assert.match(bitacora, /apiFetch\(`\/bitacoras\/\$\{bitacoraActual\.id\}\/estado`/)
    assert.match(bitacora, /method: 'PATCH'/)
    assert.match(bitacora, /JSON\.stringify\(\{ estado: 'CANCELADA', motivo \}\)/)
  })

  it('bloquea el botón durante toda la solicitud y la verificación posterior', () => {
    const inicio = bitacora.indexOf('async function confirmarCancelacion()')
    const fin = bitacora.indexOf('async function borrarBitacora()', inicio)
    const funcion = bitacora.slice(inicio, fin)
    assert.match(funcion, /btn\.disabled = true/)
    assert.match(funcion, /finally\s*\{[\s\S]*btn\.disabled = false/)
  })

  it('ante red o 5xx consulta el estado antes de permitir otro intento', () => {
    assert.match(bitacora, /if \(!e\.status \|\| e\.status >= 500\)/)
    assert.match(bitacora, /apiFetch\(`\/bitacoras\/\$\{bitacoraActual\.id\}`/)
    assert.match(bitacora, /verificacion\?\.data\?\.estado === 'CANCELADA'/)
  })

  it('refresca listado y clientes después de confirmación', () => {
    assert.match(bitacora, /Promise\.all\(\[cargarBitacoras\(paginaActual\), cargarClientes\(\)\]\)/)
  })

  it('muestra el request ID devuelto por backend', () => {
    assert.match(sidebar, /error\.requestId = data\?\.requestId \|\| res\.headers\.get\('X-Request-Id'\)/)
    assert.match(bitacora, /referencia: \$\{e\.requestId\}/)
  })

  it('preserva código de negocio tanto en code como en codigo', () => {
    assert.match(sidebar, /data\?\.code \|\| data\?\.codigo/)
  })
})
