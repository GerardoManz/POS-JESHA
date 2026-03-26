// ── GUARD DE ACCESO (FIX #4: whitelist en lugar de blacklist) ──
;(function() {
  try {
    const rol = JSON.parse(localStorage.getItem('jesha_usuario') || '{}').rol
    const ROLES_PERMITIDOS = ['SUPERADMIN']
    if (!ROLES_PERMITIDOS.includes(rol)) {
      window.location.replace('index.html')
    }
  } catch(e) { window.location.replace('index.html') }
})()


// ── OBTENER TOKEN ──
const TOKEN = localStorage.getItem('jesha_token')

// ── PROTECCIÓN CONTRA BUCLES ──
// Solo redirige si NO está en login.html
if (!TOKEN && !window.location.pathname.includes('login.html')) {
  console.log('❌ No hay token, redirigiendo a login...')
  localStorage.setItem('redirect_after_login', 'usuarios.html')
  window.location.href = 'login.html'
  throw new Error('Sin autenticación')
}

// Si llegó aquí sin token, detener
if (!TOKEN) {
  console.error('❌ ERROR: Sin token y en usuarios.html')
  throw new Error('Sin autenticación')
}

// ── API ──
const API_URL = window.__JESHA_API_URL__ || 'http://localhost:3000'

console.log('✅ Usuarios.js cargado correctamente')
console.log('✅ Token encontrado:', TOKEN.substring(0, 20) + '...')

// ══════════════════════════════════════════════════════════════════
//  DOM ELEMENTS
// ══════════════════════════════════════════════════════════════════

const searchInput = document.getElementById('buscar')
const filtroRol = document.getElementById('filtro-rol')
const btnNuevoUsuario = document.getElementById('btn-nuevo')
const tablaBody = document.getElementById('tabla-body')

const modalUsuario = document.getElementById('modal-usuario')
const modalReset = document.getElementById('modal-reset')
const formUsuario = document.getElementById('form-usuario')
const modalTitulo = document.getElementById('modal-titulo')
const btnCerrarModal = document.getElementById('btn-cerrar-modal')
const btnCerrar = document.getElementById('btn-cerrar')
const btnCerrarReset = document.getElementById('btn-cerrar-reset-modal')
const btnCerrarResetBtn = document.getElementById('btn-cerrar-reset')

const msgUsuario = document.getElementById('msg-usuario')
const msgReset = document.getElementById('msg-reset')

// ── FECHA ACTUAL ──
const fechaActual = document.getElementById('fecha-actual')
if (fechaActual) {
  fechaActual.textContent = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

// ── VARIABLES GLOBALES ──
let usuarioActual = null
let usuariosLista = []
let usuarioResetId = null

// ══════════════════════════════════════════════════════════════════
//  FUNCIONES PRINCIPALES
// ══════════════════════════════════════════════════════════════════

async function cargarUsuarios() {
  try {
    if (!tablaBody) return console.error('❌ tablaBody no encontrado')
    
    tablaBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px;">
          <div class="spinner"></div>
          <p style="margin-top: 12px; color: var(--muted);">Cargando usuarios...</p>
        </td>
      </tr>
    `

    const params = new URLSearchParams()
    if (searchInput && searchInput.value) {
      params.append('buscar', searchInput.value)
    }
    if (filtroRol && filtroRol.value) {
      params.append('rol', filtroRol.value)
    }

    const response = await fetch(`${API_URL}/usuarios?${params}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(response.status)) return

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`)
    }

    usuariosLista = await response.json()
    console.log('✅ Usuarios cargados:', usuariosLista.length)
    
    // Actualizar contador
    const totalUsuarios = document.getElementById('total-usuarios')
    if (totalUsuarios) {
      totalUsuarios.textContent = `${usuariosLista.length} usuario${usuariosLista.length !== 1 ? 's' : ''}`
    }

    renderizarTabla()

  } catch (error) {
    console.error('❌ Error al cargar usuarios:', error)
    if (tablaBody) {
      tablaBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: #ff9999; padding: 20px;">
            Error: ${error.message}
          </td>
        </tr>
      `
    }
  }
}

// FIX #2: cargarSucursales movida al scope global (antes estaba dentro del submit handler)
async function cargarSucursales() {
  try {
    const res = await fetch(`${API_URL}/usuarios/sucursales`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    })
    if (window.handle401 && window.handle401(res.status)) return
    if (!res.ok) return
    const sucursales = await res.json()
    const select = document.getElementById('f-sucursal')
    if (!select) return
    select.innerHTML = '<option value="">Seleccionar sucursal...</option>'
    sucursales.forEach(s => {
      select.innerHTML += `<option value="${s.id}">${s.nombre}</option>`
    })
  } catch (e) {
    console.error('Error cargando sucursales:', e)
  }
}

function renderizarTabla() {
  if (!tablaBody) return

  if (usuariosLista.length === 0) {
    tablaBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No hay usuarios registrados</td>
      </tr>
    `
    return
  }

  tablaBody.innerHTML = usuariosLista.map(usuario => {
    const rolBadgeClass = usuario.rol === 'SUPERADMIN' ? 'badge-superadmin' : 
                          usuario.rol === 'ADMIN_SUCURSAL' ? 'badge-admin' : 'badge-vendedor'
    const rolTexto = usuario.rol === 'SUPERADMIN' ? 'Superadmin' : 
                     usuario.rol === 'ADMIN_SUCURSAL' ? 'Admin Sucursal' : 'Empleado'
    const estadoClass = usuario.activo ? 'on' : ''
    const estadoTextoClass = usuario.activo ? 'on' : ''
    const ultimoLogin = usuario.ultimoLogin 
      ? new Date(usuario.ultimoLogin).toLocaleDateString('es-MX')
      : 'Nunca'
    
    return `
      <tr>
        <td>
          <div class="user-name">${usuario.nombre}</div>
          <div class="user-username">@${usuario.username}</div>
        </td>
        <td>${usuario.username}</td>
        <td>
          <span class="badge ${rolBadgeClass}">${rolTexto}</span>
        </td>
        <td>
          <button class="toggle ${estadoClass}" onclick="toggleEstadoUsuario(${usuario.id}, ${!usuario.activo})" 
            title="${usuario.activo ? 'Desactivar' : 'Activar'}">
          </button>
          <span class="toggle-label ${estadoTextoClass}">${usuario.activo ? 'Activo' : 'Inactivo'}</span>
        </td>
        <td class="login-${usuario.ultimoLogin ? 'time' : 'never'}">
          ${usuario.ultimoLogin 
            ? `${ultimoLogin}` 
            : '<em>Nunca ha iniciado sesión</em>'}
        </td>
        <td>
          <div class="actions">
            <button class="btn-icon" onclick="editarUsuario(${usuario.id})" title="Editar">✏️</button>
            <button class="btn-icon" title="${usuario.tienePin ? 'PIN configurado ✓' : 'Sin PIN — click para asignar'}"
              style="${usuario.tienePin ? 'color:#60d080;border-color:rgba(96,208,128,0.3)' : 'color:#e8710a;border-color:rgba(232,113,10,0.3)'}"
              onclick="editarUsuario(${usuario.id})">🔢</button>
            <button class="btn-icon warning" onclick="abrirResetPassword(${usuario.id})" title="Reset Password">🔑</button>
            <button class="btn-icon warning" onclick="toggleEstadoUsuario(${usuario.id}, ${!usuario.activo})" 
              title="${usuario.activo ? 'Desactivar' : 'Activar'}">
              ${usuario.activo ? '👁️' : '🔒'}
            </button>
          </div>
        </td>
      </tr>
    `
  }).join('')
}

function abrirModalNuevoUsuario() {
  usuarioActual = null
  if (formUsuario) formUsuario.reset()
  if (modalTitulo) modalTitulo.textContent = 'Nuevo Usuario'
  
  const metaInfo = document.getElementById('meta-info')
  if (metaInfo) metaInfo.style.display = 'none'
  
  const tituloPas = document.getElementById('titulo-pass')
  if (tituloPas) tituloPas.textContent = 'Nueva Contraseña *'
  
  const labelPass = document.getElementById('label-pass')
  if (labelPass) labelPass.textContent = 'Contraseña *'
  
  // Ocultar PIN en nuevo usuario
  const secPin = document.getElementById('seccion-pin')
  if (secPin) secPin.style.display = 'none'

  // Botón dice "Crear Usuario" en modo nuevo
  const btnGuardar = document.getElementById('btn-guardar')
  if (btnGuardar) btnGuardar.textContent = 'Crear Usuario'

  if (msgUsuario) msgUsuario.textContent = ''
  if (modalUsuario) modalUsuario.classList.add('open')
}

window.editarUsuario = async function(usuarioId) {
  usuarioActual = usuariosLista.find(u => u.id === usuarioId)
  if (!usuarioActual) return

  if (modalTitulo) modalTitulo.textContent = 'Editar Usuario'
  
  document.getElementById('f-nombre').value = usuarioActual.nombre || ''
  document.getElementById('f-username').value = usuarioActual.username || ''
  document.getElementById('f-rol').value = usuarioActual.rol || ''
  
  // Asignar sucursal — siempre recargar para garantizar opciones actualizadas
  const sucursalSelect = document.getElementById('f-sucursal')
  if (sucursalSelect) {
    // Recargar sucursales para tener opciones frescas
    await cargarSucursales()
    // Asignar el valor DESPUÉS de que las opciones están en el DOM
    if (usuarioActual.sucursalId) {
      sucursalSelect.value = String(usuarioActual.sucursalId)
    }
  }
  
  // Mostrar metadata
  const metaInfo = document.getElementById('meta-info')
  if (metaInfo) {
    metaInfo.style.display = 'grid'
    document.getElementById('meta-id').textContent = usuarioActual.id
    document.getElementById('meta-creado').textContent = 
      new Date(usuarioActual.creadoEn).toLocaleDateString('es-MX')
    document.getElementById('meta-login').textContent = 
      usuarioActual.ultimoLogin 
        ? new Date(usuarioActual.ultimoLogin).toLocaleDateString('es-MX')
        : 'Nunca'
    document.getElementById('meta-ventas').textContent = usuarioActual._count?.ventas || 0
  }
  
  // Cambiar título de contraseña
  const tituloPas = document.getElementById('titulo-pass')
  if (tituloPas) tituloPas.textContent = 'Cambiar Contraseña (Opcional)'
  
  const labelPass = document.getElementById('label-pass')
  if (labelPass) labelPass.textContent = 'Contraseña (dejar en blanco para no cambiar)'
  
  // Hacer password no requerido en edición
  document.getElementById('f-password').required = false
  document.getElementById('f-confirmar').required = false

  // Mostrar sección PIN en edición
  const secPin = document.getElementById('seccion-pin')
  if (secPin) secPin.style.display = 'block'
  const pinInput = document.getElementById('f-pin')
  if (pinInput) pinInput.value = ''
  const pinEstado = document.getElementById('pin-estado')
  if (pinEstado) {
    pinEstado.textContent = usuarioActual.tienePin ? '✓ PIN configurado' : '⚠ Sin PIN asignado'
    pinEstado.style.color = usuarioActual.tienePin ? '#60d080' : '#e8710a'
  }
  
  // Botón dice "Actualizar Usuario" en modo edición
  const btnGuardar = document.getElementById('btn-guardar')
  if (btnGuardar) btnGuardar.textContent = 'Actualizar Usuario'

  if (msgUsuario) msgUsuario.textContent = ''
  if (modalUsuario) modalUsuario.classList.add('open')
}

function cerrarModalUsuario() {
  if (modalUsuario) modalUsuario.classList.remove('open')
  usuarioActual = null
  if (formUsuario) formUsuario.reset()
  
  // Restaurar requerimientos
  document.getElementById('f-password').required = true
  document.getElementById('f-confirmar').required = true
}

window.abrirResetPassword = function(usuarioId) {
  usuarioResetId = usuarioId
  const usuario = usuariosLista.find(u => u.id === usuarioId)
  if (!usuario) return
  
  document.getElementById('reset-nombre').textContent = usuario.nombre
  if (msgReset) msgReset.textContent = ''
  document.getElementById('r-password').value = ''
  document.getElementById('r-confirmar').value = ''
  
  if (modalReset) modalReset.classList.add('open')
}

function cerrarModalReset() {
  if (modalReset) modalReset.classList.remove('open')
  usuarioResetId = null
}

window.toggleEstadoUsuario = async function(usuarioId, nuevoEstado) {
  try {
    const response = await fetch(`${API_URL}/usuarios/${usuarioId}/estado`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({ activo: nuevoEstado })
    })
    if (window.handle401 && window.handle401(response.status)) return

    if (!response.ok) throw new Error('Error al cambiar estado')
    await cargarUsuarios()
  } catch (error) {
    console.error(error)
    jeshaToast('Error: ' + error.message, 'error')
  }
}

// ══════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════════════════

if (btnNuevoUsuario) {
  btnNuevoUsuario.addEventListener('click', abrirModalNuevoUsuario)
}

if (formUsuario) {
  formUsuario.addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const nombre = document.getElementById('f-nombre').value.trim()
    const username = document.getElementById('f-username').value.trim()
    const rol = document.getElementById('f-rol').value
    const password = document.getElementById('f-password').value
    const confirmar = document.getElementById('f-confirmar').value
    
    if (!nombre) return mostrarErrorUsuario('El nombre es requerido')
    if (!username) return mostrarErrorUsuario('El usuario es requerido')
    if (!rol) return mostrarErrorUsuario('El rol es requerido')
    
    // En creación, password es obligatorio; en edición es opcional
    if (!usuarioActual) {
      if (!password) return mostrarErrorUsuario('La contraseña es requerida')
      if (password.length < 6) return mostrarErrorUsuario('Mínimo 6 caracteres')
    } else {
      if (password && password.length < 6) return mostrarErrorUsuario('Mínimo 6 caracteres')
    }
    
    if (password && password !== confirmar) {
      return mostrarErrorUsuario('Las contraseñas no coinciden')
    }

    const datos = {
      nombre,
      username,
      rol,
      // FIX #5: convertir a número antes de enviar
      sucursalId: parseInt(document.getElementById('f-sucursal').value) || null,
      ...(password && { password, confirmarPassword: confirmar })
    }

    try {
      const metodo = usuarioActual ? 'PUT' : 'POST'
      const url = usuarioActual ? `${API_URL}/usuarios/${usuarioActual.id}` : `${API_URL}/usuarios`

      const response = await fetch(url, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`
        },
        body: JSON.stringify(datos)
      })
      if (window.handle401 && window.handle401(response.status)) return

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al guardar usuario')
      }

      // Si hay PIN y estamos editando, guardarlo
      const pinVal = document.getElementById('f-pin')?.value.trim()
      if (usuarioActual && pinVal) {
        if (!/^\d{4}$/.test(pinVal)) {
          mostrarErrorUsuario('El PIN debe ser exactamente 4 dígitos numéricos')
          return
        }
        try {
          const resPIN = await fetch(`${API_URL}/usuarios/${usuarioActual.id}/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
            body: JSON.stringify({ pin: pinVal })
          })
          if (window.handle401 && window.handle401(resPIN.status)) return
          if (!resPIN.ok) {
            const errPin = await resPIN.json()
            mostrarErrorUsuario(errPin.error || 'Error al guardar PIN')
            return
          }
        } catch (e) {
          mostrarErrorUsuario('Error al guardar PIN: ' + e.message)
          return
        }
      }

      cargarUsuarios()
      cerrarModalUsuario()
    } catch (error) {
      console.error(error)
      mostrarErrorUsuario(error.message)
    }
  })
}

// ── RESET PASSWORD ──
// FIX #3: URL corregida a /reset-password, método POST, body incluye confirmarPassword
document.getElementById('btn-reset-guardar')?.addEventListener('click', async (e) => {
  e.preventDefault()
  
  const password = document.getElementById('r-password').value
  const confirmar = document.getElementById('r-confirmar').value
  
  if (!password) return mostrarErrorReset('La contraseña es requerida')
  if (password.length < 6) return mostrarErrorReset('Mínimo 6 caracteres')
  if (password !== confirmar) return mostrarErrorReset('Las contraseñas no coinciden')
  
  try {
    const response = await fetch(`${API_URL}/usuarios/${usuarioResetId}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({ password, confirmarPassword: confirmar })
    })
    if (window.handle401 && window.handle401(response.status)) return

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Error al resetear contraseña')
    }

    cerrarModalReset()
    cargarUsuarios()
  } catch (error) {
    console.error(error)
    mostrarErrorReset(error.message)
  }
})

if (btnCerrarModal) btnCerrarModal.addEventListener('click', cerrarModalUsuario)
if (btnCerrar) btnCerrar.addEventListener('click', cerrarModalUsuario)
if (btnCerrarResetBtn) btnCerrarResetBtn.addEventListener('click', cerrarModalReset)
if (btnCerrarReset) btnCerrarReset.addEventListener('click', cerrarModalReset)

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(window.searchTimeout)
    window.searchTimeout = setTimeout(cargarUsuarios, 300)
  })
}

if (filtroRol) {
  filtroRol.addEventListener('change', cargarUsuarios)
}

function mostrarErrorUsuario(msg) {
  if (msgUsuario) {
    msgUsuario.textContent = msg
    msgUsuario.classList.add('show')
  }
}

function mostrarErrorReset(msg) {
  if (msgReset) {
    msgReset.textContent = msg
    msgReset.classList.add('show')
  }
}

function togglePassword() {
  const input = document.getElementById('f-password')
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password'
  }
}

// ── INICIAR ──
console.log('🚀 Inicializando módulo de usuarios...')
cargarUsuarios()
cargarSucursales()