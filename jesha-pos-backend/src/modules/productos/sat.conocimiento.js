'use strict';

/**
 * Conocimiento de mercado mexicano para productos ferreteros.
 *
 * A diferencia del diccionario, estas reglas inspeccionan texto crudo
 * normalizado y pueden usar marcas/productos iconicos. Por eso se ejecutan
 * antes/despues del stopword filtering del normalizador sin depender de el.
 */

function quitarAcentos(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizarCrudo(texto) {
  if (typeof texto !== 'string') return '';
  return quitarAcentos(texto.toLowerCase())
    .replace(/[^a-z0-9/\-.\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contieneTodos(texto, patrones) {
  return patrones.every((patron) => patron.test(texto));
}

function contieneAlguno(texto, patrones) {
  return patrones.some((patron) => patron.test(texto));
}

const REGLAS_DIRECTAS = [
  // Quimicos / lubricantes.
  {
    id: 'wd40_lubricante',
    claveSat: '15121806',
    confianza: 98,
    todos: [/\bwd\s*-?\s*40\b/],
    razon: 'WD-40 identificado como lubricante anticorrosion',
  },

  // Refacciones/componentes que no deben clasificarse como el producto padre.
  {
    id: 'mango_martillo_mazo',
    claveSat: '27111610',
    confianza: 97,
    todos: [/\bmango\b/, /\b(martillo|martillos|marro|marros|mazo|mazos)\b/],
    razon: 'Mango para martillo/marro identificado como componente',
  },
  {
    id: 'juego_brocas',
    claveSat: '27112845',
    confianza: 96,
    todos: [/\b(juego|kit|set)\b/, /\bbrocas?\b/],
    razon: 'Juego/kit de brocas identificado',
  },
  {
    id: 'aflojatodo_lubricante',
    claveSat: '15121806',
    confianza: 94,
    todos: [/\baflojatodo\b/],
    razon: 'Aflojatodo identificado como lubricante anticorrosion',
  },

  // Cinta delimitadora / seguridad.
  {
    id: 'cinta_delimitadora_seguridad',
    claveSat: '31201513',
    confianza: 96,
    todos: [/\bcinta\b/, /\b(delimitador|delimitadora|precaución|precaucion|seguridad)\b/],
    razon: 'Cinta delimitadora/de seguridad identificada',
  },

  // Pegatanke (marcas de adhesivos).
  {
    id: 'pegatanke_transparente',
    claveSat: '31201619',
    confianza: 96,
    todos: [/\bpegatanke\b/, /\btransparente\b/],
    razon: 'Pegatanke transparente identificado como adhesivo instantaneo',
  },
  {
    id: 'pegatanke_masilla',
    claveSat: '31201605',
    confianza: 96,
    todos: [/\bpegatanke\b/, /\b(masilla|epoxica)\b/],
    razon: 'Pegatanke masilla epoxica identificado',
  },
  {
    id: 'pegatanke_negro',
    claveSat: '31201632',
    confianza: 93,
    todos: [/\bpegatanke\b/, /\bnegro\b/],
    razon: 'Pegatanke negro identificado como sellador de silicona',
  },
  {
    id: 'pegatanke_generico',
    claveSat: '31201600',
    confianza: 90,
    todos: [/\bpegatanke\b/],
    razon: 'Pegatanke generico identificado como adhesivo/sellador',
  },

  // Llave nariz (hose bib / outdoor faucet).
  {
    id: 'llave_nariz_jardin',
    claveSat: '40141600',
    confianza: 96,
    todos: [/\bllave\b/, /\bnariz\b/, /\bjardin\b/],
    razon: 'Llave nariz de jardin identificada como valvula para manguera',
  },

  // Cintas.
  {
    id: 'cinta_teflon_ptfe',
    claveSat: '31201514',
    confianza: 98,
    todos: [/\bcinta\b/, /\b(teflon|ptfe|sella\s*rosca|sellar\s*rosca|selladora\s*rosca)\b/],
    razon: 'Cinta de teflon/PTFE identificada',
  },
  {
    id: 'cinta_aislante_electrica',
    claveSat: '31201502',
    confianza: 97,
    todos: [/\bcinta\b/, /\b(aislante|aislar|temflex|vinil)\b/],
    razon: 'Cinta aislante electrica identificada',
  },
  {
    id: 'cinta_masking',
    claveSat: '31201503',
    confianza: 98,
    todos: [/\b(masking|enmascarar|enmascarado)\b/],
    razon: 'Masking tape identificado como cinta de enmascarar',
  },
  {
    id: 'cinta_antiderrapante',
    claveSat: '31201513',
    confianza: 96,
    todos: [/\bcinta\b/, /\b(antiderrapante|antideslizante|abrasivo)\b/],
    razon: 'Cinta antideslizante de seguridad identificada',
  },
  {
    id: 'cinta_doble_cara',
    claveSat: '31201505',
    confianza: 94,
    todos: [/\bcinta\b/, /\b(doble\s*cara|doble\s*faz|montaje)\b/],
    razon: 'Cinta doble cara/de montaje identificada',
  },
  {
    id: 'cinta_transparente_diurex',
    claveSat: '31201512',
    confianza: 93,
    todos: [/\b(cinta|diurex)\b/, /\b(transparente|diurex|cristal)\b/],
    razon: 'Cinta transparente identificada',
  },

  // Adhesivos y selladores.
  {
    id: 'kola_loka_instantaneo',
    claveSat: '31201619',
    confianza: 98,
    todos: [/\b(kola\s*loka|krazy\s*kola|cianoacrilato)\b/],
    razon: 'Kola Loka/cianoacrilato identificado como adhesivo instantaneo',
  },
  {
    id: 'plastilina_epoxica',
    claveSat: '31201605',
    confianza: 96,
    todos: [/\b(plasti\s*loka|plastilina\s*epoxica)\b/],
    razon: 'Plastilina epoxica identificada como masilla',
  },
  {
    id: 'pegamento_pvc_cpvc',
    claveSat: '31201617',
    confianza: 97,
    todos: [/\b(pegamento|cemento\s*disolvente|cemento)\b/, /\b(pvc|cpvc)\b/],
    razon: 'Pegamento/cemento disolvente para PVC/CPVC identificado',
  },
  {
    id: 'adhesivo_contacto',
    claveSat: '31201623',
    confianza: 94,
    todos: [/\b(pegamento|adhesivo|resistol)\b/, /\bcontacto\b/],
    razon: 'Adhesivo de contacto identificado',
  },
  {
    id: 'silicon_sellador',
    claveSat: '31201632',
    confianza: 92,
    todos: [/\b(silicon|silicona|sellador)\b/],
    excluye: [/\b(pistola|aplicador|pipe)\b/],
    razon: 'Silicon/sellador identificado como adhesivo de silicona',
  },

  // Pinturas y recubrimientos.
  {
    id: 'pintura_aerosol',
    claveSat: '31211507',
    confianza: 97,
    todos: [/\bpintura\b/, /\baerosol\b/],
    razon: 'Pintura en aerosol identificada',
  },
  {
    id: 'esmalte',
    claveSat: '31211701',
    confianza: 92,
    todos: [/\besmalte\b/],
    razon: 'Esmalte identificado como acabado vitrificado',
  },
  {
    id: 'impermeabilizante',
    claveSat: '12164900',
    confianza: 92,
    todos: [/\bimpermeabilizante\b/],
    razon: 'Impermeabilizante identificado como agente de impermeabilizacion',
  },
  {
    id: 'pigmento_colorante',
    claveSat: '12171600',
    confianza: 94,
    todos: [/\b(pigmento|pigmentos|colorante|colorantes)\b/],
    excluye: [/\b(pintura|esmalte|barniz)\b/],
    razon: 'Pigmento/colorante identificado',
  },

  // Materiales de construccion.
  {
    id: 'cemento',
    claveSat: '30111601',
    confianza: 95,
    todos: [/\bcemento\b/],
    excluye: [/\b(disolvente|pegamento|pvc|cpvc|pigmento|pigmentos|colorante|colorantes|oxido)\b/],
    razon: 'Cemento de construccion identificado',
  },
  {
    id: 'mortero',
    claveSat: '30111502',
    confianza: 95,
    todos: [/\bmortero\b/],
    excluye: [/\b(revolvedor|mezclador|pistola)\b/],
    razon: 'Mortero de construccion identificado',
  },
  {
    id: 'yeso',
    claveSat: '30111701',
    confianza: 93,
    todos: [/\byeso\b/],
    excluye: [/\b(serrucho|soporte|cinta|taquete|pija|tornillo)\b/],
    razon: 'Yeso de construccion identificado',
  },

  // Utensilios de pintura.
  {
    id: 'cepillo_pintor',
    claveSat: '27113003',
    confianza: 92,
    todos: [/\bcepillo\b/, /\b(pintor|pintores)\b/],
    excluye: [/\balambre\b/, /\bacero\b/],
    razon: 'Cepillo para pintor identificado como cepillo de aplicar',
  },

  // Bombas manuales / infladores.
  {
    id: 'bomba_manual_inflar',
    claveSat: '40151506',
    confianza: 93,
    todos: [/\bbomba\b/, /\b(manual|inflar|inflador|bicicleta|balon|balones)\b/],
    excluye: [/\bagua\b/, /\b(sumergible|periferica|presurizadora|electrico|electrica)\b/],
    razon: 'Bomba manual/inflador identificado',
  },

  // Cortapernos.
  {
    id: 'cortapernos',
    claveSat: '27111512',
    confianza: 96,
    todos: [/\bcortapernos?\b/],
    razon: 'Cortapernos identificado',
  },

  // Brocas escalonadas (step drill bits).
  {
    id: 'broca_escalonada',
    claveSat: '27112841',
    confianza: 94,
    todos: [/\bbroca\b/, /\bescalonad[ao]\b/],
    razon: 'Broca escalonada identificada como broca para metal',
  },

  // Equipo de seguridad.
  {
    id: 'chaleco_seguridad',
    claveSat: '46181507',
    confianza: 95,
    todos: [/\bchaleco\b/, /\b(seguridad|reflectante|reflejante)\b/],
    razon: 'Chaleco de seguridad identificado',
  },
  {
    id: 'casco_seguridad',
    claveSat: '46181704',
    confianza: 95,
    todos: [/\bcasco\b/, /\b(seguridad|proteccion)\b/],
    excluye: [/\b(barco|bote|lancha|marino|antiguo|historico)\b/],
    razon: 'Casco de seguridad identificado',
  },

  // Herramientas electricas.
  {
    id: 'pistola_calor',
    claveSat: '27112717',
    confianza: 97,
    todos: [/\bpistola\b/, /\bcalor\b/],
    excluye: [/\b(soldar|silicon|calafatead)\b/],
    razon: 'Pistola de calor identificada',
  },

  // Accesorios de lavabo/fregadero.
  {
    id: 'chupon_sprayer',
    claveSat: '30181812',
    confianza: 88,
    todos: [/\bchupon\b/],
    razon: 'Chupon/rociador de lavabo identificado como rociador',
  },

  // ── More lubricants and chemicals ──
  {
    id: 'silicona_lubricante',
    claveSat: '15121806',
    confianza: 92,
    todos: [/\bsilicona?\b/, /\blubricante\b/],
    razon: 'Silicona lubricante identificada',
  },
  {
    id: 'aceite_multigrado',
    claveSat: '15121501',
    confianza: 93,
    todos: [/\baceite\b/, /\bsae\b/],
    razon: 'Aceite SAE identificado como lubricante para motor',
  },
  {
    id: 'desengrasante',
    claveSat: '47131805',
    confianza: 94,
    todos: [/\bdesengrasante\b/],
    razon: 'Desengrasante identificado como limpiador industrial',
  },
  {
    id: 'pegamento_blanco',
    claveSat: '31201610',
    confianza: 92,
    todos: [/\bpegamento\b/, /\bblanco\b/],
    excluye: [/\bpvc\b/, /\bcpvc\b/, /\bcontacto\b/],
    razon: 'Pegamento blanco identificado como adhesivo escolar/vinilico',
  },
  {
    id: 'pegamento_instantaneo',
    claveSat: '31201619',
    confianza: 90,
    todos: [/\bpegamento\b/, /\b(instantaneo|super\s*pegamento)\b/],
    razon: 'Pegamento instantaneo identificado como cianoacrilato',
  },
  {
    id: 'soldadura_fria',
    claveSat: '31201605',
    confianza: 93,
    todos: [/\bsoldadura\b/, /\bfria\b/],
    razon: 'Soldadura fria identificada como masilla epoxica',
  },

  // ── Power tools ──
  {
    id: 'taladro_inalambrico',
    claveSat: '27112700',
    confianza: 95,
    todos: [/\btaladro\b/, /\b(inalambrico|bateria|20v|18v|12v)\b/],
    excluye: [/\brefaccion\b/, /\brepuesto\b/, /\bcarbon\b/, /\bescobilla\b/],
    razon: 'Taladro inalambrico identificado',
  },
  {
    id: 'taladro_percutor',
    claveSat: '27112702',
    confianza: 96,
    todos: [/\btaladro\b/, /\bpercutor\b/],
    excluye: [/\brefaccion\b/, /\brepuesto\b/],
    razon: 'Taladro percutor identificado',
  },
  {
    id: 'atornillador_inalambrico',
    claveSat: '27112703',
    confianza: 95,
    todos: [/\b(atornillador|destornillador)\b/, /\b(inalambrico|bateria|recargable)\b/],
    razon: 'Atornillador inalambrico identificado',
  },
  {
    id: 'sierra_circular',
    claveSat: '27112704',
    confianza: 96,
    todos: [/\bsierra\b/, /\bcircular\b/],
    excluye: [/\brefaccion\b/, /\brepuesto\b/, /\bdisco\b/],
    razon: 'Sierra circular identificada',
  },
  {
    id: 'sierra_caladora',
    claveSat: '27112705',
    confianza: 96,
    todos: [/\bsierra\b/, /\b(caladora|calar|sable)\b/],
    razon: 'Sierra caladora/de sable identificada',
  },
  {
    id: 'esmeriladora_angular',
    claveSat: '27112706',
    confianza: 95,
    todos: [/\b(esmeriladora|pulidora|amoladora)\b/, /\bangular\b/],
    excluye: [/\brefaccion\b/, /\brepuesto\b/, /\bdisco\b/],
    razon: 'Esmeriladora angular identificada',
  },
  {
    id: 'lijadora',
    claveSat: '27112707',
    confianza: 94,
    todos: [/\blijadora\b/],
    excluye: [/\brefaccion\b/, /\brepuesto\b/],
    razon: 'Lijadora identificada',
  },
  {
    id: 'rotomartillo_herramienta',
    claveSat: '27112708',
    confianza: 97,
    todos: [/\brotomartillo\b/],
    excluye: [/\brefaccion\b/, /\brepuesto\b/],
    razon: 'Rotomartillo identificado',
  },
  {
    id: 'compresor_aire',
    claveSat: '23101515',
    confianza: 95,
    todos: [/\bcompresor\b/, /\baire\b/],
    razon: 'Compresor de aire identificado',
  },

  // ── Plumbing ──
  {
    id: 'tubo_pvc_hidraulico',
    claveSat: '40171517',
    confianza: 95,
    todos: [/\btubo\b/, /\bpvc\b/, /\b(hidraulico|presion|cementar)\b/],
    razon: 'Tubo PVC hidraulico identificado',
  },
  {
    id: 'tubo_pvc_sanitario',
    claveSat: '40171520',
    confianza: 95,
    todos: [/\btubo\b/, /\bpvc\b/, /\b(sanitario|drenaje|desague)\b/],
    razon: 'Tubo PVC sanitario identificado',
  },
  {
    id: 'valvula_compuerta',
    claveSat: '40141601',
    confianza: 94,
    todos: [/\bvalvula?\b/, /\bcompuerta\b/],
    excluye: [/\bbola\b/, /\bcheck\b/, /\bmariposa\b/],
    razon: 'Valvula de compuerta identificada',
  },
  {
    id: 'manguera_jardin_reforzada',
    claveSat: '40142008',
    confianza: 94,
    todos: [/\bmanguera\b/, /\bjardin\b/, /\breforzada\b/],
    razon: 'Manguera de jardin reforzada identificada',
  },
  {
    id: 'llave_agua_jardin',
    claveSat: '40141600',
    confianza: 95,
    todos: [/\bllave\b/, /\bagua\b/, /\bjardin\b/],
    razon: 'Llave de agua para jardin identificada',
  },
  {
    id: 'tinaco_rotoplas',
    claveSat: '24111810',
    confianza: 96,
    todos: [/\btinaco\b/, /\brotoplas\b/],
    razon: 'Tinaco Rotoplas identificado',
  },

  // ── Electrical ──
  {
    id: 'contacto_polarizado',
    claveSat: '39121405',
    confianza: 95,
    todos: [/\bcontacto\b/, /\bpolarizado\b/],
    razon: 'Contacto polarizado identificado',
  },
  {
    id: 'apagador_sencillo',
    claveSat: '39122202',
    confianza: 96,
    todos: [/\b(apagador|interruptor)\b/, /\bsencillo\b/],
    razon: 'Apagador/interruptor sencillo identificado',
  },
  {
    id: 'apagador_escalera',
    claveSat: '39122203',
    confianza: 96,
    todos: [/\b(apagador|interruptor)\b/, /\b(escalera|tres\s*vias|3\s*vias)\b/],
    razon: 'Apagador de escalera (3 vias) identificado',
  },
  {
    id: 'cable_sotano',
    claveSat: '26121600',
    confianza: 94,
    todos: [/\bcable\b/, /\bsotano\b/],
    razon: 'Cable de sotano identificado',
  },

  // ── Security ──
  {
    id: 'cerradura_manija',
    claveSat: '46171503',
    confianza: 93,
    todos: [/\bcerradura\b/, /\bmanija\b/],
    razon: 'Cerradura con manija identificada',
  },
  {
    id: 'guante_nitrilo',
    claveSat: '46181504',
    confianza: 96,
    todos: [/\bguante\b/, /\bnitrilo\b/],
    razon: 'Guante de nitrilo identificado',
  },
  {
    id: 'lente_seguridad_claro',
    claveSat: '46181705',
    confianza: 95,
    todos: [/\blente\b/, /\bseguridad\b/],
    razon: 'Lente de seguridad identificado',
  },
  {
    id: 'mascarilla_polvo',
    claveSat: '46181707',
    confianza: 94,
    todos: [/\bmascarilla\b/, /\b(polvo|respirador)\b/],
    razon: 'Mascarilla/respirador identificado',
  },

  // ── Plumbing fixtures ──
  {
    id: 'lavabo_ceramico',
    claveSat: '30161701',
    confianza: 93,
    todos: [/\blavabo\b/, /\b(ceramico|ceramica|vitreo)\b/],
    razon: 'Lavabo ceramico identificado',
  },
  {
    id: 'mezcladora_lavabo',
    claveSat: '30181701',
    confianza: 95,
    todos: [/\bmezcladora\b/, /\blavabo\b/],
    razon: 'Mezcladora para lavabo identificada',
  },
  {
    id: 'mezcladora_fregadero',
    claveSat: '30181702',
    confianza: 95,
    todos: [/\bmezcladora\b/, /\b(fregadero|tarja|cocina)\b/],
    razon: 'Mezcladora para fregadero identificada',
  },
  {
    id: 'regadera_telefono',
    claveSat: '30181803',
    confianza: 95,
    todos: [/\bregadera\b/, /\btelefono\b/],
    razon: 'Regadera telefono identificada',
  },

  // ── Construction ──
  {
    id: 'block_concreto',
    claveSat: '30101501',
    confianza: 96,
    todos: [/\bblock\b/, /\b(concreto|cemento|hormigon)\b/],
    razon: 'Block de concreto identificado',
  },
  {
    id: 'varilla_corrugada',
    claveSat: '30102401',
    confianza: 97,
    todos: [/\bvarilla\b/, /\bcorrugada\b/],
    razon: 'Varilla corrugada identificada',
  },
  {
    id: 'malla_ciclon',
    claveSat: '11162108',
    confianza: 96,
    todos: [/\bmalla\b/, /\bciclon\b/],
    razon: 'Malla ciclon identificada',
  },

  // ── Tools ──
  {
    id: 'flexometro_medicion',
    claveSat: '27111801',
    confianza: 96,
    todos: [/\bflexometro\b/],
    razon: 'Flexometro identificado como cinta metrica',
  },
  {
    id: 'nivel_laser',
    claveSat: '27111802',
    confianza: 96,
    todos: [/\bnivel\b/, /\blaser\b/],
    razon: 'Nivel laser identificado',
  },
  {
    id: 'llave_perica',
    claveSat: '27111707',
    confianza: 97,
    todos: [/\bllave\b/, /\bperica\b/],
    razon: 'Llave perica/ajustable identificada',
  },
  {
    id: 'disco_diamante_segmentado',
    claveSat: '31191505',
    confianza: 96,
    todos: [/\bdisco\b/, /\bdiamante\b/],
    razon: 'Disco de diamante identificado',
  },
  {
    id: 'disco_corte_metal',
    claveSat: '27112838',
    confianza: 95,
    todos: [/\bdisco\b/, /\bcorte\b/, /\b(metal|acero|hierro|fierro)\b/],
    excluye: [/\bdiamante\b/, /\blaminado\b/, /\bdesbaste\b/],
    razon: 'Disco de corte para metal identificado',
  },
  {
    id: 'rondana_presion',
    claveSat: '31161804',
    confianza: 96,
    todos: [/\b(rondana|arandela)\b/, /\bpresion\b/],
    razon: 'Rondana de presion identificada',
  },
  {
    id: 'cinta_canela',
    claveSat: '31201512',
    confianza: 92,
    todos: [/\bcinta\b/, /\bcanela\b/],
    razon: 'Cinta canela/transparente identificada',
  },
  {
    id: 'cortador_tubo_pvc',
    claveSat: '23241610',
    confianza: 95,
    todos: [/\bcortador\b/, /\btubo\b/, /\b(pvc|plastico)\b/],
    razon: 'Cortador de tubo PVC/plastico identificado',
  },
  {
    id: 'pistola_silicona',
    claveSat: '27112906',
    confianza: 96,
    todos: [/\bpistola\b/, /\bsilicon\b/],
    razon: 'Pistola aplicadora de silicon identificada',
  },
  {
    id: 'pistola_pintura',
    claveSat: '23153100',
    confianza: 94,
    todos: [/\bpistola\b/, /\b(pintar|pintura|hvlp)\b/],
    razon: 'Pistola de pintura identificada',
  },
  {
    id: 'martillo_ule',
    claveSat: '27111602',
    confianza: 95,
    todos: [/\bmartillo\b/, /\b(ule|uya|una)\b/],
    razon: 'Martillo con uya identificado',
  },
  {
    id: 'martillo_bola',
    claveSat: '27111604',
    confianza: 95,
    todos: [/\bmartillo\b/, /\bbola\b/],
    razon: 'Martillo de bola identificado',
  },
];

function detectarConocimiento(texto) {
  const normalizado = normalizarCrudo(texto);
  if (normalizado === '') return [];

  return REGLAS_DIRECTAS.filter((regla) => {
    if (Array.isArray(regla.todos) && !contieneTodos(normalizado, regla.todos)) return false;
    if (Array.isArray(regla.alguno) && !contieneAlguno(normalizado, regla.alguno)) return false;
    if (Array.isArray(regla.excluye) && contieneAlguno(normalizado, regla.excluye)) return false;
    return true;
  }).map((regla) => ({
    id: regla.id,
    claveSat: regla.claveSat,
    confianza: regla.confianza,
    razon: regla.razon,
  }));
}

module.exports = {
  REGLAS_DIRECTAS,
  detectarConocimiento,
  normalizarCrudo,
};
