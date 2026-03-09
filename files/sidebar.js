// ===== AUTENTICACIÓN CENTRALIZADA =====
function verificarAutenticacion() {
  const token = localStorage.getItem('jesha_token');
  const usuario = localStorage.getItem('jesha_usuario');
  
  if (!token || !usuario) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

// ===== CARGAR SIDEBAR =====
async function cargarSidebar(paginaActual) {
  // Verificar que el contenedor existe ANTES de hacer fetch
  const contenedor = document.getElementById('sidebar-container');
  
  if (!contenedor) {
    console.error('❌ ERROR: No existe <div id="sidebar-container"> en el HTML');
    return;
  }

  try {
    // Cargar el HTML del sidebar
    const respuesta = await fetch('sidebar.html');
    
    if (!respuesta.ok) {
      throw new Error(`HTTP error! status: ${respuesta.status}`);
    }
    
    const html = await respuesta.text();
    contenedor.innerHTML = html;
    
    // ===== MARCAR PÁGINA ACTIVA =====
    marcarPaginaActiva(paginaActual);
    
    // ===== CONFIGURAR LOGOUT =====
    configurarLogout();
    
  } catch (error) {
    console.error('❌ Error cargando sidebar:', error);
    contenedor.innerHTML = '<p style="padding: 20px; color: red;">Error cargando menú</p>';
  }
}

// ===== MARCAR PÁGINA ACTIVA (MEJORADO) =====
function marcarPaginaActiva(paginaActual) {
  // Obtener todos los items del menú
  const items = document.querySelectorAll('.menu-item');
  
  items.forEach(item => {
    // Remover clase active de todos
    item.classList.remove('active');
    
    // Agregar active solo al que coincida con paginaActual
    if (item.dataset.page === paginaActual) {
      item.classList.add('active');
    }
  });
  
  // DEBUG: Mostrar en console cuál página se marcó como activa
  console.log(`✓ Página activa marcada: ${paginaActual}`);
}

// ===== LOGOUT =====
function configurarLogout() {
  const logoutBtn = document.getElementById('logout-btn');
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      // Limpiar localStorage
      localStorage.removeItem('jesha_token');
      localStorage.removeItem('jesha_usuario');
      localStorage.removeItem('jesha_rol');
      
      // Redirigir a login
      window.location.href = 'login.html';
    });
  } else {
    console.warn('⚠ Botón logout no encontrado');
  }
}

// ===== EJECUTAR AL CARGAR =====
document.addEventListener('DOMContentLoaded', () => {
  // Verificar autenticación PRIMERO
  if (!verificarAutenticacion()) {
    return; // Si no está autenticado, salir
  }
  
  console.log('✓ Usuario autenticado');
});
