// ════════════════════════════════════════════════════════════════════
//  CATALOGOS-SAT.JS
//  Catálogos fiscales SAT compartidos para todo el frontend.
//  Cargar antes que los módulos que usen selects de régimen/uso CFDI.
// ════════════════════════════════════════════════════════════════════

// ── Catálogo completo de regímenes fiscales SAT (18 claves) ──
window.CATALOGO_REGIMENES = [
  { clave: '601', descripcion: 'General de Ley Personas Morales' },
  { clave: '603', descripcion: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', descripcion: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { clave: '606', descripcion: 'Arrendamiento' },
  { clave: '607', descripcion: 'Régimen de Enajenación o Adquisición de Bienes' },
  { clave: '608', descripcion: 'Demás Ingresos' },
  { clave: '610', descripcion: 'Residentes en el Extranjero sin Establecimiento Permanente en México' },
  { clave: '611', descripcion: 'Ingresos por Dividendos (socios y accionistas)' },
  { clave: '612', descripcion: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '614', descripcion: 'Ingresos por intereses' },
  { clave: '615', descripcion: 'Régimen de los ingresos por obtención de premios' },
  { clave: '616', descripcion: 'Sin obligaciones fiscales' },
  { clave: '620', descripcion: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos' },
  { clave: '621', descripcion: 'Incorporación Fiscal' },
  { clave: '622', descripcion: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { clave: '623', descripcion: 'Opcional para Grupos de Sociedades' },
  { clave: '624', descripcion: 'Coordinados' },
  { clave: '625', descripcion: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { clave: '626', descripcion: 'Régimen Simplificado de Confianza' }
]

// ── Catálogo completo de usos CFDI SAT (18 claves) ──
window.CATALOGO_USOS = [
  { clave: 'G01', descripcion: 'Adquisición de mercancías' },
  { clave: 'G02', descripcion: 'Devoluciones, descuentos o bonificaciones' },
  { clave: 'G03', descripcion: 'Gastos en general' },
  { clave: 'I01', descripcion: 'Construcciones' },
  { clave: 'I02', descripcion: 'Mobiliario y equipo de oficina por inversiones' },
  { clave: 'I03', descripcion: 'Equipo de transporte' },
  { clave: 'I04', descripcion: 'Equipo de cómputo y accesorios' },
  { clave: 'I05', descripcion: 'Dados, troqueles, moldes, matrices y herramental' },
  { clave: 'I06', descripcion: 'Comunicaciones telefónicas' },
  { clave: 'I08', descripcion: 'Otra maquinaria y equipo' },
  { clave: 'D01', descripcion: 'Honorarios médicos, dentales y gastos hospitalarios' },
  { clave: 'D02', descripcion: 'Gastos médicos por incapacidad o discapacidad' },
  { clave: 'D03', descripcion: 'Gastos funerales' },
  { clave: 'D04', descripcion: 'Donativos' },
  { clave: 'D10', descripcion: 'Pagos por servicios educativos (colegiaturas)' },
  { clave: 'S01', descripcion: 'Sin efectos fiscales' },
  { clave: 'CP01', descripcion: 'Pagos' },
  { clave: 'CN01', descripcion: 'Nómina' }
]

// ── Tipo de persona por régimen: F=Física, M=Moral, A=Ambos ──
window.TIPO_POR_REGIMEN = {
  '601':'M', '603':'M', '605':'F', '606':'F', '607':'F', '608':'F',
  '610':'A', '611':'F', '612':'F', '614':'F', '615':'F', '616':'F',
  '620':'M', '621':'F', '622':'A', '623':'M', '624':'M', '625':'F',
  '626':'A'
}

// ── Tipo de persona por uso CFDI: F=Física, M=Moral, A=Ambos ──
window.TIPO_POR_USO = {
  'G01':'A', 'G02':'A', 'G03':'A',
  'I01':'A', 'I02':'A', 'I03':'A', 'I04':'A', 'I05':'A', 'I06':'A', 'I08':'A',
  'D01':'F', 'D02':'F', 'D03':'F', 'D04':'F', 'D10':'F',
  'S01':'A', 'CP01':'A', 'CN01':'A'
}

// ════════════════════════════════════════════════════════════════════
//  poblarSelectSAT(selectElement, catalogo)
//  Llena un <select> con opciones del catálogo SAT.
//  Respeta el primer <option> como placeholder y no duplica.
// ════════════════════════════════════════════════════════════════════
window.poblarSelectSAT = function(selectElement, catalogo) {
  if (!selectElement || !catalogo) return
  if (selectElement.options.length > 1) return   // ya poblado

  catalogo.forEach(item => {
    const opt = document.createElement('option')
    opt.value = item.clave
    opt.textContent = item.clave + ' — ' + item.descripcion
    selectElement.appendChild(opt)
  })
}

// ════════════════════════════════════════════════════════════════════
//  filtrarUsosPorRegimen(selectRegimen, selectUso)
//  Filtra las opciones de UsoCFDI según el régimen seleccionado.
//  Oculta los usos incompatibles con el tipo de persona del régimen.
// ════════════════════════════════════════════════════════════════════
window.filtrarUsosPorRegimen = function(selectRegimen, selectUso) {
  if (!selectRegimen || !selectUso) return

  const regimen = selectRegimen.value
  const tipoPersona = window.TIPO_POR_REGIMEN[regimen] || null
  let algunoSeleccionadoOculto = false

  for (let i = 0; i < selectUso.options.length; i++) {
    const opt = selectUso.options[i]
    if (!opt.value) continue   // placeholder

    const tipoUso = window.TIPO_POR_USO[opt.value] || 'A'

    let visible = true
    if (tipoPersona && tipoPersona !== 'A' && tipoUso !== 'A' && tipoUso !== tipoPersona) {
      visible = false
    }

    opt.hidden = !visible
    opt.disabled = !visible

    if (!visible && opt.selected) {
      algunoSeleccionadoOculto = true
    }
  }

  if (algunoSeleccionadoOculto) {
    selectUso.value = ''
  }
}
