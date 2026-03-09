// ===== SIDEBAR.JS (VERSIÓN FINAL CORREGIDA) =====
// Este archivo centraliza la autenticación y la carga del menú global.

// 🔒 1. VERIFICAR AUTENTICACIÓN
function verificarAutenticacion() {
  const token = localStorage.getItem('jesha_token');
  const usuario = localStorage.getItem('jesha_usuario');
  
  if (!token || !usuario) {
    console.warn('⚠️ No hay autenticación - redirigiendo a login');
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

// 📂 2. CARGAR SIDEBAR DINÁMICO
async function cargarSidebar(paginaActual) {
  try {
    const response = await fetch('sidebar.html');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const html = await response.text();
    const container = document.getElementById('sidebar-container');
    
    if (!container) {
      console.error('❌ Error: No se encontró el contenedor #sidebar-container');
      return;
    }
    
    // Inyectar el HTML
    container.innerHTML = html;
    console.log('✓ Sidebar inyectado correctamente');

    // Marcar el ítem del menú como activo
    marcarPaginaActiva(paginaActual);
    
    // Configurar el botón de salida con reintentos para evitar el error de "No existe"
    configurarLogoutConReintentos(10);

  } catch (error) {
    console.error('❌ Error cargando el archivo sidebar.html:', error);
  }
}

// 📍 3. RESALTAR PÁGINA ACTUAL
function marcarPaginaActiva(paginaActual) {
  const items = document.querySelectorAll('.menu-item');
  items.forEach(item => item.classList.remove('active'));
  
  const itemActivo = document.querySelector(`.menu-item[data-page="${paginaActual}"]`);
  if (itemActivo) {
    itemActivo.classList.add('active');
    console.log(`✓ Menú activo: ${paginaActual}`);
  }
}

// 🚪 4. CONFIGURAR LOGOUT (Robusto)
function configurarLogoutConReintentos(intentos) {
  const logoutBtn = document.getElementById('logout-btn');
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('🔓 Cerrando sesión...');
      localStorage.removeItem('jesha_token');
      localStorage.removeItem('jesha_usuario');
      window.location.href = 'login.html';
    });
    console.log('✓ Botón de salida vinculado');
  } else if (intentos > 0) {
    // Si el DOM aún no procesa el ID, esperamos un frame (aprox 16ms) y reintentamos
    requestAnimationFrame(() => configurarLogoutConReintentos(intentos - 1));
  } else {
    console.warn('⚠️ No se pudo vincular el botón de salida (no se encontró el ID)');
  }
}

// ⚡ 5. INICIALIZACIÓN AUTOMÁTICA
document.addEventListener('DOMContentLoaded', () => {
  console.log('📄 DOMContentLoaded: Iniciando sidebar...');
  
  if (verificarAutenticacion()) {
    // Obtenemos la página actual del atributo data-page del body
    const paginaActual = document.body.getAttribute('data-page') || 'dashboard';
    cargarSidebar(paginaActual);
  }
});