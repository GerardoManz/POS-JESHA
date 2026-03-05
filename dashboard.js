const DASHBOARD_PAGE = 'index.html'
const LOGIN_PAGE = 'login.html'

const token = localStorage.getItem('jesha_token')
if (!token) {
  window.location.href = LOGIN_PAGE
}

const logoutButton = document.getElementById('logout-btn')
if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('jesha_token')
    localStorage.removeItem('jesha_usuario')
    window.location.href = LOGIN_PAGE
  })
}