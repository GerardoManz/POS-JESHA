'use strict';

/**
 * Diccionario ferretero para el matching SAT.
 *
 * Es la fuente DOMINANTE del scoring (decisión de Fase 0) y el archivo
 * que más se ajustará en Fase 7. Agregar/editar familias es tarea
 * mecánica: no requiere tocar el matcher.
 *
 * Reglas de construcción:
 *
 *  - Los tokens se escriben en SINGULAR y ya NORMALIZADOS (minúsculas,
 *    sin acentos), porque se comparan contra la salida de
 *    sat.normalizador.js. El matching pliega plurales automáticamente
 *    (token "cinchos" coincide con base "cincho").
 *
 *  - Peso 2 = token fuerte (casi inequívoco de la familia).
 *    Peso 1 = token débil (apoya, pero no decide solo).
 *    Una familia se ACTIVA solo si la suma de pesos coincidentes
 *    alcanza UMBRAL_FAMILIA (2). Así "aceite" suelto no activa nada,
 *    pero "aceite motor" sí; y "cepillo de alambre" activa cepillos (2)
 *    por encima de cables (1), evitando heredar el error histórico.
 *
 *  - `claves` contiene ÚNICAMENTE claves SAT confirmadas por la
 *    auditoría de Fase 0 (muestras reales verificadas contra catálogo).
 *    Una familia SIN claves sigue siendo útil: alimenta el gate de
 *    contradicción de familia y acota candidatos de catálogo, pero no
 *    propone clave propia todavía.
 *
 *  - AMBIGUOS: términos que por sí solos no determinan familia. Si el
 *    término aparece y NINGÚN desambiguador lo acompaña, el matcher
 *    debe tratarlo como ambigüedad crítica (nunca AUTO).
 */

const UMBRAL_FAMILIA = 2;

// ── Ramas o categorías de familias ──
const RAMA = {
  FERRETERIA: 'FERRETERIA',
  HERRAMIENTAS: 'HERRAMIENTAS',
  ELECTRICO: 'ELECTRICO',
  ILUMINACION: 'ILUMINACION',
  PLOMERIA: 'PLOMERIA',
  CONSTRUCCION: 'CONSTRUCCION',
  MATERIALES: 'MATERIALES',
  PINTURAS: 'PINTURAS',
  JARDINERIA: 'JARDINERIA',
  SEGURIDAD: 'SEGURIDAD',
  AUTOMOTRIZ: 'AUTOMOTRIZ',
  LIMPIEZA: 'LIMPIEZA',
  MAQUINARIA: 'MAQUINARIA',
  MUEBLES_ACABADOS: 'MUEBLES_ACABADOS',
  ELECTRODOMESTICOS: 'ELECTRODOMESTICOS',
  MEDICION: 'MEDICION',
  SOLDADURA: 'SOLDADURA',
  RIEGO: 'RIEGO',
  EMPAQUE: 'EMPAQUE',
  VARIOS: 'VARIOS',
};

const FAMILIAS = [
  {
    id: 'abrazaderas',
    tokens: { abrazadera: 2, omega: 1 },
    claves: ['31162906'],
  },
  {
    id: 'taquetes_anclajes',
    tokens: { taquete: 2, anclaje: 2, ancla: 1, expansivo: 1 },
    claves: ['31162103'],
    certificada: true,
  },
  {
    id: 'cinchos',
    tokens: { cincho: 2 },
    claves: ['39121703'],
    certificada: true,
  },
  {
    id: 'cerraduras',
    tokens: { cerradura: 2, cerrojo: 2, chapa: 2 },
    claves: ['31162402'],
    certificada: true,
  },
  {
    id: 'candados',
    tokens: { candado: 2 },
    claves: ['46171501'],
    certificada: true,
  },
  {
    id: 'discos_corte',
    tokens: { disco: 1, corte: 2, diamante: 2, segueta: 1 },
    requiere: ['disco'],
    claves: ['27112838'],
  },
  {
    id: 'discos_desbaste',
    tokens: { disco: 1, desbaste: 2 },
    requiere: ['disco', 'desbaste'],
    claves: ['31191600'],
  },
  {
    id: 'guantes',
    tokens: { guante: 2, nitrilo: 1, carnaza: 1 },
    claves: ['46181504'],
  },
  {
    id: 'aceites_lubricantes',
    tokens: { lubricante: 2, aceite: 1, motor: 1 },
    claves: ['15121501'],
  },
  {
    id: 'mezcladores_pintura',
    tokens: { revolvedor: 2, mezclador: 1, pintura: 1 },
    claves: ['31211905'],
  },
  {
    id: 'desarmadores',
    tokens: { desarmador: 2, destornillador: 2 },
    claves: ['27111701'],
    certificada: true,
  },
  {
    id: 'martillos',
    tokens: { martillo: 2 },
    claves: ['27111602'],
    certificada: true,
  },
  {
    id: 'mazos_marros',
    tokens: { mazo: 2, marro: 2 },
    claves: ['27111621'],
    certificada: true,
  },
  {
    id: 'pinzas_presion',
    tokens: { pinza: 2, presion: 2, mordaza: 1 },
    requiere: ['pinza', 'presion'],
    claves: ['27111750'],
    certificada: true,
  },
  {
    id: 'pinzas_mano',
    tokens: { pinza: 2, alicate: 2, punta: 1, corte: 1, electricista: 1 },
    excluye: ['presion', 'tender', 'ropa', 'tendedero', 'tiendal'],
    claves: ['27112103'],
    certificada: true,
  },
  {
    id: 'ruedas_rodajas',
    tokens: { rodaja: 2, rueda: 2 },
    claves: ['31162702'],
  },
  {
    id: 'cables_electricos',
    tokens: { thw: 2, thhn: 2, conductor: 2, cable: 1, alambre: 1, rudo: 1, calibre: 1, cal: 1 },
    excluye: ['galvanizado', 'recocido', 'puas', 'amarre'],
    claves: ['26121600'],
  },
  {
    id: 'tornillos_pijas',
    tokens: { tornillo: 2, pija: 2, autorroscante: 1, rosca: 1 },
    excluye: ['mordaza', 'reparacion', 'kit', 'juego', 'jgo', 'wc', 'cuello', 'sanitario', 'nivelador', 'extractor', 'extractores', 'brida', 'closet'],
    claves: ['31161500'],
    certificada: true,
  },
  {
    id: 'pernos',
    tokens: { perno: 2 },
    claves: ['31161600'],
    certificada: true,
  },
  {
    id: 'focos_lamparas',
    tokens: { foco: 2, bombilla: 2, lampara: 2, led: 1 },
    claves: ['39101600'],
    certificada: true,
  },
  {
    id: 'iluminacion_led',
    tokens: { led: 2, luminario: 2, tira: 1, foco: 1, lampara: 1, luz: 1 },
    requiere: ['led'],
    claves: ['39112102'],
    certificada: true,
  },
  {
    id: 'luminarios',
    tokens: { luminario: 2, plafon: 2 },
    claves: ['39111500'],
  },
  {
    id: 'lubricantes_grasas',
    tokens: { grasa: 2, lubricante: 2, aceite: 1, litio: 1, jabon: 1 },
    excluye: ['cocina', 'comestible', 'oliva', 'vegetal', 'freno'],
    claves: ['15121902'],
  },
  {
    id: 'valvulas',
    tokens: { valvula: 2, llave: 1, esfera: 1, paso: 1, compuerta: 1, angular: 1, check: 1, nariz: 1 },
    excluye: ['calibrador', 'bujia', 'bujias', 'respirador', 'careta', 'mascarilla', 'cubreboca'],
    claves: ['40141600'],
    certificada: true,
  },
  {
    id: 'selladores_adhesivos',
    tokens: { silicon: 2, sellador: 2, adhesivo: 2, pegamento: 2, resistol: 1 },
    excluye: ['escurridor', 'rejilla', 'delimitador', 'barniz', 'pintura', 'impermeabilizante'],
    claves: ['31201600'],
  },
  {
    id: 'seguetas_arcos',
    tokens: { segueta: 2, sierra: 1, arco: 1 },
    claves: ['27111559'],
  },
  {
    id: 'tinacos_tanques',
    tokens: { tinaco: 2, cisterna: 2, tanque: 2, flotador: 1 },
    claves: ['24111810'],
  },
  {
    id: 'limpieza',
    tokens: { escoba: 2, trapeador: 2, recogedor: 2, jalador: 2, cepillo: 1, sanitario: 1 },
    claves: ['47131600'],
  },
  {
    id: 'herramientas_llaves_tubo',
    tokens: { stilson: 2 },
    claves: ['27111749'],
    certificada: true,
  },
  {
    id: 'brocas_madera_plana',
    tokens: { broca: 2, madera: 2, plana: 2, manita: 2 },
    requiere: ['broca'],
    requiereAlguno: ['plana', 'manita'],
    claves: ['27111539'],
    certificada: true,
  },
  {
    id: 'brocas_madera',
    tokens: { broca: 2, madera: 2 },
    requiere: ['broca', 'madera'],
    excluye: ['plana', 'manita'],
    claves: ['27111537'],
    certificada: true,
  },
  {
    id: 'brocas_mamposteria',
    tokens: { broca: 2, concreto: 2, mamposteria: 2, piedra: 1, muro: 1, sds: 1, rotomartillo: 1 },
    requiere: ['broca'],
    requiereAlguno: ['concreto', 'mamposteria', 'piedra', 'muro', 'sds', 'rotomartillo'],
    claves: ['27111543'],
    certificada: true,
  },
  {
    id: 'cinceles',
    tokens: { cincel: 2, corta: 1, frio: 1, punta: 1, plana: 1 },
    requiereAlguno: ['cincel', 'frio'],
    claves: ['27111614'],
    certificada: true,
  },
  {
    id: 'cintas_teflon_ptfe',
    tokens: { cinta: 2, teflon: 2, ptfe: 2, sellar: 1, rosca: 1 },
    requiere: ['cinta'],
    requiereAlguno: ['teflon', 'ptfe', 'rosca'],
    claves: ['31201514'],
    certificada: true,
  },
  {
    id: 'cintas_aislantes',
    tokens: { cinta: 2, aislante: 2, aislar: 2, vinil: 1 },
    requiere: ['cinta'],
    requiereAlguno: ['aislante', 'aislar', 'vinil'],
    claves: ['31201502'],
    certificada: true,
  },
  {
    id: 'cintas_masking',
    tokens: { cinta: 1, masking: 2, enmascarar: 2 },
    requiereAlguno: ['masking', 'enmascarar'],
    claves: ['31201503'],
    certificada: true,
  },
  {
    id: 'cintas_seguridad',
    tokens: { cinta: 2, antiderrapante: 2, antideslizante: 2, barricada: 2, precaucion: 1 },
    requiere: ['cinta'],
    requiereAlguno: ['antiderrapante', 'antideslizante', 'barricada'],
    claves: ['31201513'],
    certificada: true,
  },
  {
    id: 'cintas_doble_cara',
    tokens: { cinta: 2, doble: 1, cara: 1, faz: 1, montaje: 2 },
    requiere: ['cinta'],
    requiereAlguno: ['montaje', 'doble'],
    excluye: ['chaleco', 'seguridad', 'reflejante', 'reflectante', 'pesca'],
    claves: ['31201505'],
    certificada: true,
  },
  {
    id: 'codos_pvc',
    tokens: { codo: 2, pvc: 2, plastico: 1 },
    requiere: ['codo', 'pvc'],
    excluye: ['cpvc'],
    claves: ['40172808'],
    certificada: true,
  },
  {
    id: 'codos_cpvc',
    tokens: { codo: 2, cpvc: 2 },
    requiere: ['codo', 'cpvc'],
    claves: ['40172809'],
    certificada: true,
  },
  {
    id: 'codos_cobre',
    tokens: { codo: 2, cobre: 2 },
    requiere: ['codo', 'cobre'],
    claves: ['40172812'],
    certificada: true,
  },
  {
    id: 'conectores_tubo_pvc',
    tokens: { conector: 2, conexion: 2, pvc: 2, tubo: 1 },
    requiereAlguno: ['conector', 'conexion'],
    requiere: ['pvc'],
    excluye: ['cpvc'],
    claves: ['40172508'],
    certificada: true,
  },
  {
    id: 'conectores_tubo_cpvc',
    tokens: { conector: 2, conexion: 2, cpvc: 2, tubo: 1 },
    requiereAlguno: ['conector', 'conexion'],
    requiere: ['cpvc'],
    claves: ['40172509'],
    certificada: true,
  },
  {
    id: 'tubos_pvc',
    tokens: { tubo: 2, pvc: 2, tramo: 1 },
    requiere: ['tubo', 'pvc'],
    excluye: ['cpvc', 'cortador', 'cuchilla'],
    claves: ['40171517'],
    certificada: true,
  },
  {
    id: 'tubos_cpvc',
    tokens: { tubo: 2, cpvc: 2, tramo: 1 },
    requiere: ['tubo', 'cpvc'],
    excluye: ['cortador', 'cuchilla', 'tijera', 'corta'],
    claves: ['40171518'],
    certificada: true,
  },
  {
    id: 'tubos_cobre',
    tokens: { tubo: 2, cobre: 2 },
    requiere: ['tubo', 'cobre'],
    excluye: ['cortador', 'cuchilla'],
    claves: ['40171511'],
    certificada: true,
  },
  {
    id: 'cemento_construccion',
    tokens: { cemento: 2, gris: 1, bulto: 1 },
    requiere: ['cemento'],
    excluye: ['disolvente', 'pegamento', 'pvc', 'cpvc', 'pigmento', 'colorante', 'oxido', 'charola', 'mezcladora', 'mezcla'],
    claves: ['30111601'],
    certificada: true,
  },
  {
    id: 'mortero_construccion',
    tokens: { mortero: 2, gris: 1, bulto: 1 },
    requiere: ['mortero'],
    excluye: ['revolvedor', 'mezclador'],
    claves: ['30111502'],
    certificada: true,
  },
  {
    id: 'yeso_construccion',
    tokens: { yeso: 2, bulto: 1 },
    requiere: ['yeso'],
    excluye: ['serrucho', 'soporte', 'cinta', 'taquete', 'pija', 'tornillo'],
    claves: ['30111701'],
    certificada: true,
  },
  {
    id: 'impermeabilizantes',
    tokens: { impermeabilizante: 2, impermeable: 1, recubrimiento: 1 },
    claves: ['12164900'],
    certificada: true,
  },
  {
    id: 'pintura_aerosol',
    tokens: { pintura: 2, aerosol: 2 },
    requiere: ['pintura', 'aerosol'],
    claves: ['31211507'],
    certificada: true,
  },
  {
    id: 'esmaltes',
    tokens: { esmalte: 2, pintura: 1 },
    claves: ['31211701'],
    certificada: true,
  },
  {
    id: 'rodillos_pintura',
    tokens: { rodillo: 2, felpa: 2, pintar: 1, pintura: 1, extension: 1 },
    requiereAlguno: ['rodillo', 'felpa'],
    excluye: ['cadena', 'rodamiento', 'transportador'],
    claves: ['31211906'],
    certificada: true,
  },
  {
    id: 'charolas_pintura',
    tokens: { charola: 2, bandeja: 2, pintura: 1, rodillo: 1 },
    requiereAlguno: ['charola', 'bandeja'],
    excluye: ['mezcla', 'mezclar', 'cemento', 'construccion', 'acero', 'inoxidable'],
    claves: ['31211909'],
    certificada: true,
  },
  // ---- Familias de alto impacto con clave SAT confirmada ----
  {
    id: 'regaderas_jardin',
    tokens: { regadera: 2, jardin: 2, riego: 1, planta: 1 },
    requiere: ['regadera'],
    requiereAlguno: ['jardin', 'riego', 'planta'],
    claves: ['27112029'],
  },
  {
    id: 'regaderas_ducha',
    tokens: { regadera: 2, ducha: 2, cabezal: 1, bano: 1 },
    requiereAlguno: ['regadera', 'ducha'],
    excluye: ['jardin', 'riego', 'planta', 'manguera'],
    claves: ['30181801'],
  },
  {
    id: 'duchas_telefono',
    tokens: { ducha: 2, regadera: 1, telefono: 2, manual: 1, extension: 1 },
    requiereAlguno: ['ducha', 'regadera'],
    requiere: ['telefono'],
    claves: ['30181803'],
  },
  {
    id: 'mezcladoras_grifos',
    tokens: { mezcladora: 2, monomando: 2, grifo: 2, lavabo: 1, fregadero: 1, tarja: 1 },
    requiereAlguno: ['mezcladora', 'monomando', 'grifo'],
    excluye: ['cemento', 'concreto', 'mortero', 'asfalto', 'lodo', 'revolvedora', 'maquina', 'pintura'],
    claves: ['30181700'],
  },
  {
    id: 'grifos_reparacion',
    tokens: { grifo: 2, reparacion: 2, kit: 1, repuesto: 1, refaccion: 1 },
    requiere: ['grifo'],
    requiereAlguno: ['reparacion', 'kit', 'repuesto', 'refaccion'],
    claves: ['30181811'],
  },
  {
    id: 'tees_tuberia_pvc',
    tokens: { tee: 2, te: 2, pvc: 2, tubo: 1 },
    requiereAlguno: ['tee', 'te'],
    requiere: ['pvc'],
    excluye: ['cpvc'],
    claves: ['40174608'],
  },
  {
    id: 'tees_tuberia_cpvc',
    tokens: { tee: 2, te: 2, cpvc: 2, tubo: 1 },
    requiereAlguno: ['tee', 'te'],
    requiere: ['cpvc'],
    claves: ['40174609'],
  },
  {
    id: 'tees_tuberia_cobre',
    tokens: { tee: 2, te: 2, cobre: 2, tubo: 1 },
    requiereAlguno: ['tee', 'te'],
    requiere: ['cobre'],
    claves: ['40174612'],
  },
  {
    id: 'tees_tuberia_polipropileno',
    tokens: { tee: 2, ppr: 2, polipropileno: 2, insercion: 1, sercion: 1 },
    requiere: ['tee'],
    requiereAlguno: ['ppr', 'polipropileno'],
    claves: ['40174600'],
  },
  {
    id: 'yees_tuberia_polipropileno',
    tokens: { yee: 2, ppr: 2, polipropileno: 2, insercion: 1, sercion: 1 },
    requiere: ['yee'],
    requiereAlguno: ['ppr', 'polipropileno'],
    claves: ['40175200'],
  },
  {
    id: 'yees_tuberia_pvc',
    tokens: { yee: 2, pvc: 2, tubo: 1 },
    requiere: ['yee', 'pvc'],
    excluye: ['cpvc'],
    claves: ['40175208'],
  },
  {
    id: 'yees_tuberia_cpvc',
    tokens: { yee: 2, cpvc: 2, tubo: 1 },
    requiere: ['yee', 'cpvc'],
    claves: ['40175209'],
  },
  {
    id: 'yees_tuberia_cobre',
    tokens: { yee: 2, cobre: 2, tubo: 1 },
    requiere: ['yee', 'cobre'],
    claves: ['40175212'],
  },
  {
    id: 'codos_tuberia_polipropileno',
    tokens: { codo: 2, ppr: 2, polipropileno: 2, insercion: 1, sercion: 1 },
    requiere: ['codo'],
    requiereAlguno: ['ppr', 'polipropileno'],
    claves: ['40172100'],
  },
  {
    id: 'acoples_tuberia_pvc',
    tokens: { cople: 2, acople: 2, pvc: 2, tubo: 1 },
    requiereAlguno: ['cople', 'acople'],
    requiere: ['pvc'],
    excluye: ['cpvc'],
    claves: ['40172608'],
  },
  {
    id: 'acoples_tuberia_cpvc',
    tokens: { cople: 2, acople: 2, cpvc: 2, tubo: 1 },
    requiereAlguno: ['cople', 'acople'],
    requiere: ['cpvc'],
    claves: ['40172609'],
  },
  {
    id: 'acoples_tuberia_cobre',
    tokens: { cople: 2, acople: 2, cobre: 2, tubo: 1 },
    requiereAlguno: ['cople', 'acople'],
    requiere: ['cobre'],
    claves: ['40172612'],
  },
  {
    id: 'acoples_tuberia_laton',
    tokens: { cople: 2, acople: 2, laton: 2, tubo: 1, npt: 1 },
    requiereAlguno: ['cople', 'acople'],
    requiere: ['laton'],
    claves: ['40172601'],
  },
  {
    id: 'acoples_tuberia_polipropileno',
    tokens: { cople: 2, ppr: 2, polipropileno: 2, reducido: 1 },
    requiere: ['cople'],
    requiereAlguno: ['ppr', 'polipropileno'],
    claves: ['40172600'],
  },
  {
    id: 'reducciones_tuberia_pvc',
    tokens: { reduccion: 2, reducido: 2, pvc: 2, tubo: 1 },
    requiereAlguno: ['reduccion', 'reducido'],
    requiere: ['pvc'],
    excluye: ['cpvc'],
    claves: ['40173006'],
  },
  {
    id: 'reducciones_tuberia_cpvc',
    tokens: { reduccion: 2, reducido: 2, cpvc: 2, tubo: 1 },
    requiereAlguno: ['reduccion', 'reducido'],
    requiere: ['cpvc'],
    claves: ['40173007'],
  },
  {
    id: 'reducciones_tuberia_polipropileno',
    tokens: { reduccion: 2, reducido: 2, ppr: 2, polipropileno: 2, tubo: 1 },
    requiere: ['reduccion'],
    requiereAlguno: ['ppr', 'polipropileno'],
    claves: ['40173000'],
  },
  {
    id: 'niples_tuberia_pvc',
    tokens: { niple: 2, pvc: 2, tubo: 1 },
    requiere: ['niple', 'pvc'],
    excluye: ['cpvc'],
    claves: ['40172906'],
  },
  {
    id: 'niples_tuberia_cpvc',
    tokens: { niple: 2, cpvc: 2, tubo: 1 },
    requiere: ['niple', 'cpvc'],
    claves: ['40172907'],
  },
  {
    id: 'niples_tuberia_cobre',
    tokens: { niple: 2, cobre: 2, tubo: 1 },
    requiere: ['niple', 'cobre'],
    claves: ['40172911'],
  },
  {
    id: 'niples_tuberia_genericos',
    tokens: { niple: 2, galvanizado: 1, laton: 1, gas: 1, npt: 1, std: 1 },
    requiere: ['niple'],
    excluye: ['pvc', 'cpvc', 'cobre'],
    claves: ['40172900'],
  },
  {
    id: 'uniones_tuberia_pvc',
    tokens: { union: 2, pvc: 2, tuerca: 1, tubo: 1 },
    requiere: ['union', 'pvc'],
    excluye: ['cpvc'],
    claves: ['40174908'],
  },
  {
    id: 'uniones_tuberia_cpvc',
    tokens: { union: 2, cpvc: 2, tuerca: 1, tubo: 1 },
    requiere: ['union', 'cpvc'],
    claves: ['40174909'],
  },
  {
    id: 'uniones_tuberia_cobre',
    tokens: { union: 2, cobre: 2, tuerca: 1, tubo: 1 },
    requiere: ['union', 'cobre'],
    claves: ['40174912'],
  },
  {
    id: 'uniones_tuberia_laton',
    tokens: { union: 2, laton: 2, tuerca: 1, tubo: 1 },
    requiere: ['union', 'laton'],
    claves: ['40174901'],
  },
  {
    id: 'uniones_tuberia_ppr',
    tokens: { union: 2, ppr: 2, polipropileno: 2, tuerca: 1 },
    requiere: ['union'],
    requiereAlguno: ['ppr', 'polipropileno'],
    claves: ['40174900'],
  },
  {
    id: 'conectores_tubo_ppr',
    tokens: { conector: 2, ppr: 2, polipropileno: 2, tubo: 1 },
    requiere: ['conector'],
    requiereAlguno: ['ppr', 'polipropileno'],
    claves: ['40172517'],
  },
  {
    id: 'tubos_ppr',
    tokens: { tubo: 2, ppr: 2, polipropileno: 2, tramo: 1 },
    requiere: ['tubo'],
    requiereAlguno: ['ppr', 'polipropileno'],
    claves: ['40171517'],
  },
  {
    id: 'mangueras_agua',
    tokens: { manguera: 2, agua: 2, jardin: 1, riego: 1 },
    requiere: ['manguera'],
    requiereAlguno: ['agua', 'jardin', 'riego'],
    excluye: ['gas', 'aire', 'hidraulica', 'aceite', 'freno', 'soldadura'],
    claves: ['40142008'],
  },
  {
    id: 'mangueras_gas',
    tokens: { manguera: 2, gas: 2, lp: 1, natural: 1 },
    requiere: ['manguera', 'gas'],
    claves: ['40142009'],
  },
  {
    id: 'mangueras_aire',
    tokens: { manguera: 2, aire: 2, compresor: 1, neumatica: 1 },
    requiere: ['manguera'],
    requiereAlguno: ['aire', 'compresor', 'neumatica'],
    excluye: ['gas'],
    claves: ['40142002'],
  },
  {
    id: 'mangueras_hidraulicas',
    tokens: { manguera: 2, hidraulica: 2, presion: 1 },
    requiere: ['manguera', 'hidraulica'],
    claves: ['40142020'],
  },
  {
    id: 'mangueras_genericas',
    tokens: { manguera: 2, flexible: 2, usos: 1, multiple: 1, multiproposito: 1 },
    requiere: ['manguera'],
    requiereAlguno: ['flexible', 'usos', 'multiple', 'multiproposito'],
    excluye: ['gas', 'aire', 'agua', 'jardin', 'riego', 'hidraulica', 'aceite', 'freno', 'soldadura'],
    claves: ['40142000'],
  },
  {
    id: 'conectores_manguera',
    tokens: { conector: 2, adaptador: 2, manguera: 2 },
    requiere: ['manguera'],
    requiereAlguno: ['conector', 'adaptador'],
    claves: ['40141734'],
  },
  {
    id: 'brocas_forstner',
    tokens: { broca: 2, forstner: 2 },
    requiere: ['broca', 'forstner'],
    claves: ['27111538'],
  },
  {
    id: 'brocas_baldosa_azulejo',
    tokens: { broca: 2, baldosa: 2, azulejo: 2, vidrio: 1, ceramica: 1 },
    requiere: ['broca'],
    requiereAlguno: ['baldosa', 'azulejo', 'vidrio', 'ceramica'],
    claves: ['27111540'],
  },
  {
    id: 'brocas_metal',
    tokens: { broca: 2, metal: 2, acero: 1, hss: 2, cobalto: 1, oxido: 1, negro: 1 },
    requiere: ['broca'],
    requiereAlguno: ['metal', 'acero', 'hss', 'cobalto', 'oxido', 'negro'],
    excluye: ['madera', 'concreto', 'mamposteria', 'piedra', 'azulejo', 'baldosa'],
    claves: ['27112841'],
  },
  {
    id: 'brocas_juego',
    tokens: { broca: 2, juego: 2, set: 2, kit: 1 },
    requiere: ['broca'],
    requiereAlguno: ['juego', 'set', 'kit'],
    claves: ['27112845'],
  },
  {
    id: 'avellanadores',
    tokens: { avellanador: 2, avellanar: 2 },
    claves: ['27112812'],
  },
  {
    id: 'llaves_ajustables',
    tokens: { perica: 2, ajustable: 2, inglesa: 2, llave: 1 },
    requiereAlguno: ['perica', 'ajustable', 'inglesa'],
    excluye: ['agua', 'paso', 'angular', 'esfera', 'mezcladora', 'grifo', 'gas'],
    claves: ['27111707'],
  },
  {
    id: 'llaves_allen',
    tokens: { allen: 2, hexagonal: 2, llave: 1 },
    requiereAlguno: ['allen', 'hexagonal'],
    excluye: ['tornillo', 'perno', 'tuerca'],
    claves: ['27111710'],
  },
  {
    id: 'llaves_combinadas',
    tokens: { llave: 1, combinada: 2, mixta: 2, espanola: 2, caja: 1 },
    requiere: ['llave'],
    requiereAlguno: ['combinada', 'mixta', 'espanola', 'caja'],
    excluye: ['agua', 'paso', 'angular', 'esfera', 'mezcladora', 'grifo', 'gas'],
    claves: ['27111747'],
  },
  {
    id: 'matracas_trinquetes',
    tokens: { matraca: 2, trinquete: 2, ratchet: 2, llave: 1 },
    requiereAlguno: ['matraca', 'trinquete', 'ratchet'],
    excluye: ['desarmador', 'destornillador', 'correa', 'amarre'],
    claves: ['27111753'],
  },
  {
    id: 'tensores',
    tokens: { tensor: 2, gancho: 1, argolla: 1, zinc: 1, forjado: 1 },
    claves: ['31162405'],
  },
  {
    id: 'gas_fittings',
    tokens: { gas: 2, campana: 2, terminal: 2, estufa: 1, union: 1, codo: 1, tee: 1 },
    requiere: ['gas'],
    requiereAlguno: ['campana', 'terminal', 'estufa', 'union'],
    excluye: ['manguera', 'tanque', 'cilindro', 'regulador'],
    claves: ['40141751'],
  },
  // ---- Familias generales eléctricas ----
  {
    id: 'fusibles',
    rama: RAMA.ELECTRICO,
    tokens: { fusible: 2 },
    claves: ['39121600'],
  },
  {
    id: 'pastillas_termicas',
    rama: RAMA.ELECTRICO,
    tokens: { pastilla: 2, termica: 1 },
    claves: ['39121600'],
  },
  // ---- Familias sin clave confirmada todavía (solo gate + acotación) ----
  {
    id: 'plomeria_conexiones',
    tokens: { codo: 2, tee: 2, cople: 2, niple: 2, reduccion: 2, conexion: 1, yee: 2, ppr: 2 },
    excluye: ['tope', 'puerta', 'mueble', 'gabinete', 'closet', 'cocina'],
    claves: ['40172800'],
  },
  {
    id: 'brocas_sierra',
    tokens: { broca: 2, sierra: 2, mandril: 2, bimetallico: 1, diamante: 1 },
    requiere: ['broca'],
    requiereAlguno: ['sierra', 'mandril', 'bimetallico', 'diamante'],
    excluye: ['metal', 'madera', 'concreto', 'mamposteria', 'piedra', 'azulejo', 'baldosa', 'forstner'],
    claves: ['20121613'],
  },
  {
    id: 'brocas_multimaterial',
    tokens: { broca: 2, multimaterial: 2, multimateriales: 2, router: 2, rebajador: 2 },
    requiere: ['broca'],
    requiereAlguno: ['multimaterial', 'multimateriales', 'router', 'rebajador'],
    excluye: ['sierra', 'mandril', 'metal', 'madera', 'concreto', 'mamposteria', 'piedra', 'azulejo', 'forstner', 'hss', 'cobalto'],
    claves: ['20101715'],
  },
  {
    id: 'brocas',
    tokens: { broca: 2 },
    claves: [],
  },
  {
    id: 'cepillos_alambre',
    tokens: { cepillo: 2, alambre: 2, acero: 1, carbono: 1, mango: 1 },
    requiere: ['cepillo', 'alambre'],
    claves: ['27113001'],
  },
  {
    id: 'cepillos_no_alambre',
    tokens: { cepillo: 2, plastico: 1, tallo: 1, fibra: 1, nailon: 1, lavar: 1, limpiar: 1, mano: 1 },
    requiere: ['cepillo'],
    excluye: ['alambre', 'acero', 'carbono', 'pulir'],
    claves: ['27113003'],
  },
  {
    id: 'cepillos',
    tokens: { cepillo: 2 },
    claves: [],
  },
  {
    id: 'griferia',
    tokens: { mezcladora: 2, monomando: 2, regadera: 2, grifo: 2, lavabo: 2 },
    claves: ['30181700'],
  },
  {
    id: 'herramientas_manuales',
    tokens: { perica: 2, martillo: 2, pinza: 2, alicate: 2, allen: 2, matraca: 2, dado: 1, llave: 1, combinada: 1, espanola: 1, mixta: 1 },
    claves: [],
  },
  {
    id: 'pinturas_recubrimientos',
    tokens: { pintura: 1, vinilica: 2, esmalte: 2, impermeabilizante: 2, barniz: 2, primario: 1 },
    claves: ['31211705'],
  },
  {
    id: 'brochas_aplicadores',
    tokens: { brocha: 2, rodillo: 1, aplicador: 1 },
    claves: ['31211904'],
    certificada: true,
  },
  {
    id: 'bombas_agua',
    tokens: { bomba: 2, sumergible: 1, periferica: 1 },
    claves: ['40151510'],
  },
  {
    id: 'mangueras',
    tokens: { manguera: 2 },
    claves: ['40142000'],
  },
  {
    id: 'pigmentos_colorantes',
    tokens: { pigmento: 2, colorante: 2, tinte: 1, oxido: 1 },
    claves: ['12171600'],
  },
  {
    id: 'cementos_morteros',
    tokens: { cemento: 2, mortero: 2, yeso: 2 },
    excluye: ['disolvente', 'pegamento', 'pvc', 'cpvc', 'pigmento', 'colorante', 'oxido', 'charola', 'mezcladora', 'mezcla'],
    claves: [],
  },
  // ---- Familias lote 2 (2026-07-03): alta frecuencia en productos sin familia ----
  {
    id: 'lijas_abrasivos',
    tokens: { lija: 2, abrasivo: 2, esmeril: 2, grano: 1 },
    requiereAlguno: ['lija', 'abrasivo', 'esmeril'],
    claves: ['31191500'],
    certificada: true,
  },
  {
    id: 'clavos_puntas',
    tokens: { clavo: 2, punta: 1, gancho: 1, escarpia: 1 },
    claves: ['31162000'],
  },
  {
    id: 'bisagras',
    tokens: { bisagra: 2, gozne: 2 },
    claves: ['31162403'],
    certificada: true,
  },
  {
    id: 'remaches',
    tokens: { remache: 2, roblon: 1 },
    claves: ['31162200'],
    certificada: true,
  },
  {
    id: 'tuercas',
    tokens: { tuerca: 2 },
    excluye: ['union', 'ppr', 'gas', 'npt', 'regulador', 'manguera', 'niple', 'conector', 'espiga', 'laton'],
    claves: ['31161700'],
    certificada: true,
  },
  {
    id: 'arandelas_rondanas',
    tokens: { rondana: 2, arandela: 2, golilla: 1 },
    claves: ['31161800'],
    certificada: true,
  },
  {
    id: 'extensiones_electricas',
    tokens: { extension: 2, multicontacto: 2, supresor: 2, electrico: 1, cable: 1, domestico: 1, volt: 1 },
    requiere: ['extension'],
    excluye: ['rodillo', 'brocha', 'pintura', 'tubo', 'tubular', 'barra', 'corredera', 'trampa', 'lavabo', 'lavadero', 'fregadero', 'drenaje', 'matraca', 'cuadro', 'ratchet', 'sifon', 'copie', 'copla'],
    claves: ['39121440'],
    certificada: true,
  },
  {
    id: 'navajas_cutter',
    tokens: { navaja: 2, cutter: 2, exacto: 1, cuchillo: 1 },
    requiereAlguno: ['navaja', 'cutter', 'exacto'],
    excluye: ['cocina', 'comer', 'cubierto', 'carne', 'pan', 'allen', 'llave', 'juego', 'jgo'],
    claves: ['27111503'],
    certificada: true,
  },
  {
    id: 'esmeriladoras_pulidoras',
    tokens: { esmeriladora: 2, pulidora: 2, esmeril: 1, minigrinder: 1 },
    excluye: ['carbon', 'escobilla', 'repuesto', 'refaccion', 'accesorio', 'adaptador', 'piedra', 'disco'],
    claves: ['23101506'],
    certificada: true,
  },
  {
    id: 'escaleras',
    tokens: { escalera: 2, tijera: 1, peldano: 1 },
    excluye: ['mecanica', 'electrica', 'cinta', 'rodante', 'apagador', 'interruptor', 'contacto', 'placa', 'switch'],
    claves: ['30191501'],
    certificada: true,
  },
  {
    id: 'calentadores_agua',
    tokens: { boiler: 2, calentador: 2, paso: 1, gas: 1 },
    claves: ['40101825'],
  },
  {
    id: 'empaques',
    tokens: { empaque: 2, empaquetadura: 2, junta: 1, sello: 1 },
    excluye: ['papel', 'caja', 'carton', 'plastico', 'alimento', 'niple', 'medidor'],
    claves: ['31181701'],
    certificada: true,
  },
  {
    id: 'tapones_tuberia',
    tokens: { tapon: 2, capa: 1, hembra: 1, pvc: 1, cpvc: 1 },
    claves: ['40173500'],
  },
  {
    id: 'tapas_pvc',
    tokens: { tapa: 2, pvc: 2, cpvc: 1 },
    requiere: ['tapa'],
    requiereAlguno: ['pvc', 'cpvc'],
    claves: ['40172408'],
  },
  {
    id: 'conectores_electricos',
    tokens: { conector: 1, electrico: 1, cable: 1, alambre: 1, terminal: 1, ficha: 1 },
    requiere: ['conector'],
    excluye: ['manguera', 'tubo', 'pvc', 'cpvc', 'cobre', 'hidraulico'],
    claves: ['39121409'],
    certificada: true,
  },
  {
    id: 'enchufes_clavijas',
    tokens: { clavija: 2, enchufe: 2, adaptador: 1, ficha: 1, hembra: 1 },
    requiereAlguno: ['clavija', 'enchufe', 'electrico', 'contacto', 'tomacorriente'],
    excluye: ['pvc', 'cpvc', 'polipropileno', 'tubo', 'manguera', 'niple', 'cople', 'hidraulico'],
    claves: ['39121402'],
    certificada: true,
  },
  {
    id: 'interruptores_apagadores',
    tokens: { apagador: 2, interruptor: 2, switch: 1, boton: 1 },
    excluye: ['circuito', 'tablero', 'termico', 'magnetico', 'presion', 'flotador', 'seguridad'],
    claves: ['39122200'],
    certificada: true,
  },
  {
    id: 'sierras_serruchos',
    tokens: { serrucho: 2, sierra: 2, triscado: 1, podar: 1 },
    excluye: ['cinta', 'mecanica', 'electrica', 'circular', 'mesa', 'calar', 'cinta', 'cinta', 'caladora', 'mand', 'mandril', 'carbon', 'escobilla'],
    claves: ['27111508'],
    certificada: true,
  },
  {
    id: 'flexometros_medicion',
    tokens: { flexometro: 2, metro: 1, cinta: 1, medir: 1, metrica: 1 },
    requiereAlguno: ['flexometro'],
    excluye: ['lija', 'abrasivo', 'teflon', 'aislante', 'masking', 'enmascarar', 'antiderrapante', 'doble', 'montaje', 'señalar', 'barricada', 'precaucion'],
    claves: ['27111801'],
    certificada: true,
  },
  {
    id: 'dados_llaves',
    tokens: { dado: 2, llave: 1, impacto: 1 },
    requiere: ['dado'],
    excluye: ['cocina', 'mesa', 'silla', 'mueble', 'juego'],
    claves: ['27111703'],
  },
  {
    id: 'portalamparas_sockets',
    tokens: { portalampara: 2, socket: 2, casquillo: 2, portalampada: 1 },
    claves: ['39101600'],
  },
  {
    id: 'varillas_acero',
    tokens: { varilla: 2, corrugado: 2, acero: 1, construccion: 1, fierro: 1 },
    claves: ['30102404'],
  },
  {
    id: 'poliducto',
    tokens: { poliducto: 2, conducto: 1, corrugado: 1, electrico: 1 },
    claves: ['39131706'],
  },
  {
    id: 'cintas_transparente',
    tokens: { cinta: 2, transparente: 2, polipropileno: 1 },
    requiere: ['cinta', 'transparente'],
    claves: ['31201512'],
    certificada: true,
  },
  {
    id: 'jaladeras_tiradores',
    tokens: { jaladera: 2, tirador: 2, manija: 1, pomo: 1, chapa: 1 },
    claves: ['31162801'],
    certificada: true,
  },
  {
    id: 'tapon_capa_hembra',
    tokens: { capa: 2, hembra: 1, macho: 1, reduccion: 1, bushing: 1 },
    requiere: ['capa'],
    claves: ['40173600'],
  },
  // ---- Familias lote 3 (2026-07-03): siguientes mayores frecuencias ----
  {
    id: 'placas_contactos',
    tokens: { placa: 2, contacto: 2, apagador: 1, interruptor: 1, duplex: 1, toma: 1, tomacorriente: 1, aterrizado: 1, sobreponer: 1 },
    requiereAlguno: ['placa', 'contacto', 'apagador', 'interruptor', 'tomacorriente'],
    excluye: ['acero', 'metalico', 'metal', 'aluminio', 'laton', 'zinc', 'fierro', 'hierro', 'tornillo', 'bisagra', 'pegamento', 'adhesivo', 'soldadura'],
    claves: ['39122200'],
  },
  {
    id: 'grapas',
    tokens: { grapa: 2, engrapadora: 1 },
    claves: ['31162404'],
  },
  {
    id: 'niveles_plomadas',
    tokens: { nivel: 2, plomada: 2, burbuja: 1, tiralineas: 1, pendiente: 1 },
    claves: ['41111950'],
  },
  {
    id: 'plomadas',
    tokens: { plomada: 2 },
    claves: ['27111804'],
    certificada: true,
  },
  {
    id: 'soldadura_electrodos',
    tokens: { soldadura: 2, soldar: 2, electrodo: 2, suelda: 1, flux: 1, tungsteno: 1, varilla: 1 },
    claves: ['23271816', '23271813'],
  },
  {
    id: 'electrodos_soldadura',
    tokens: { electrodo: 2, soldadura: 1, soldar: 1 },
    requiere: ['electrodo'],
    claves: ['23271810'],
    certificada: true,
  },
  {
    id: 'cuerdas_piolas',
    tokens: { cuerda: 2, piola: 2, mecate: 2, hilo: 1, nylon: 1 },
    excluye: ['zapato', 'bota', 'tenis', 'calzado', 'guitarra', 'pescar', 'niple', 'conector', 'adaptador', 'polipropileno', 'galvanizado', 'corrida', 'npt', 'hembra', 'macho', 'rosca', 'roscado', 'roscada'],
    claves: ['31151500'],
    certificada: true,
  },
  {
    id: 'mallas_alambre',
    tokens: { malla: 2, ciclon: 2, alambre: 1, acero: 1 },
    requiereAlguno: ['malla', 'ciclon'],
    excluye: ['pescar', 'padel', 'deportiva', 'tenis', 'futbol', 'protector', 'mosquitera'],
    claves: ['11162108'],
  },
  {
    id: 'coladeras_desagues',
    tokens: { coladera: 2, desague: 2, rejilla: 1, drenaje: 1, piso: 1 },
    claves: ['48101812', '30181605'],
  },
  {
    id: 'caretas_proteccion',
    tokens: { careta: 2, lente: 1, proteccion: 1, seguridad: 1, soldar: 1, mascarilla: 1 },
    claves: ['46181700'],
    certificada: true,
  },
  {
    id: 'contracanastas',
    tokens: { contracanasta: 2, regaderita: 2, fregadero: 1 },
    requiereAlguno: ['contracanasta', 'regaderita'],
    claves: ['11171600'],
  },
  {
    id: 'fregaderos_tarjas',
    tokens: { fregadero: 2, tarja: 2, lavabo: 1, empotrar: 1 },
    claves: ['30161700'],
  },
  {
    id: 'limas_escofinas',
    tokens: { lima: 2, escofina: 2, limaton: 1 },
    excluye: ['factor', 'tiempo', 'produccion', 'cadena', 'control', 'limon', 'fruta'],
    claves: ['27111919'],
  },
  {
    id: 'cucharas_llanas',
    tokens: { cuchara: 2, llana: 2, plana: 1, albanil: 1, construccion: 1 },
    excluye: ['cocina', 'comer', 'mesa', 'sopa', 'postre', 'cafe', 'taza'],
    claves: ['27112201'],
  },
  {
    id: 'espatulas',
    tokens: { espatula: 2, llana: 1, rasqueta: 1, albanil: 1 },
    requiere: ['espatula'],
    claves: ['52151613'],
  },
  {
    id: 'timbres_campanas',
    tokens: { timbre: 2, campana: 1, llamador: 1, chicharra: 1 },
    claves: ['39122200'],
  },
  {
    id: 'armellas',
    tokens: { armella: 2, cerrada: 1, abierta: 1, ojo: 1 },
    requiere: ['armella'],
    claves: ['31161602'],
  },
  {
    id: 'ganchos_genericos',
    tokens: { gancho: 2, ganchos: 2, paquete: 1, atornillar: 1 },
    requiereAlguno: ['gancho', 'ganchos'],
    excluye: ['tensor', 'cable', 'remolque', 'podador', 'bano', 'sanitario', 'cortina'],
    claves: ['31162600'],
  },
  {
    id: 'armellas_ganchos',
    tokens: { armella: 2, gancho: 2, escarpia: 1, ojo: 1 },
    claves: [],
  },
  {
    id: 'pistolas_riego',
    tokens: { pistola: 2, riego: 2, jardin: 1, rociador: 2, rociadora: 2 },
    requiere: ['pistola'],
    requiereAlguno: ['riego', 'jardin', 'rociador', 'rociadora'],
    claves: ['27112903'],
  },
  {
    id: 'compresor_accesorios',
    tokens: { compresor: 2, aire: 2, juego: 1, pieza: 1 },
    requiere: ['compresor'],
    requiereAlguno: ['aire'],
    claves: ['41114521'],
  },
  {
    id: 'pistolas_aire_comprimido',
    tokens: { pistola: 2, aire: 2, neumatica: 1, compresor: 1 },
    requiere: ['pistola'],
    requiereAlguno: ['aire', 'neumatica', 'compresor'],
    excluye: ['calor', 'silicon', 'calafateadora', 'calafateo'],
    claves: ['27131502'],
  },
  {
    id: 'pistolas_calafateo',
    tokens: { pistola: 2, calafateadora: 2, calafateo: 2, esqueleto: 1 },
    requiere: ['pistola'],
    requiereAlguno: ['calafateadora', 'calafateo'],
    claves: ['27112906'],
  },
  {
    id: 'boquillas_accesorios',
    tokens: { boquilla: 2, pistola: 2, calor: 1, aire: 1, silicon: 1 },
    claves: [],
  },
  {
    id: 'accesorios_cable_acero',
    tokens: { cable: 2, acero: 2, perro: 2, nudo: 2, guardacabo: 2, tensor: 1, canastilla: 1, guia: 1, rigido: 1, recubierto: 1, hierro: 1, caiman: 1, terminal: 1, aislada: 1, nylon: 1, destorcedor: 1, forjado: 1, pasacorriente: 1, galvanizado: 1, cabos: 1 },
    requiere: ['cable'],
    excluye: ['hdmi', 'coaxial', 'hd', 'usb', 'coax', 'estereo', 'audio', 'vga', 'stereo', 'rca', 'subwoofer', 'hdmi', 'displayport', 'thunderbolt'],
    claves: ['31162800', '31162805'],
  },
  {
    id: 'taladros_rotomartillos',
    tokens: { taladro: 2, rotomartillo: 2, percutor: 2, inalambrico: 1 },
    claves: ['27112700'],
  },
  // ---- Familias lote 4 (2026-07-03): siguientes mayores frecuencias en sin-familia ----
  {
    id: 'cadenas',
    tokens: { cadena: 2, acero: 1 },
    excluye: ['luminario', 'lampara', 'foco', 'plafon', 'electrica', 'elect', 'electron', 'tienda', 'nivel', 'carbon', 'rodillo', 'transportador', 'bicicleta', 'motocicleta', 'moto'],
    claves: ['31151600'],
  },
  {
    id: 'cizallas',
    tokens: { cizalla: 2 },
    excluye: ['maquina', 'hidraulica', 'industrial', 'mineria'],
    claves: ['27111506'],
  },
  {
    id: 'tijeras_podar',
    tokens: { tijera: 2, podar: 2, jardin: 1, pasto: 1 },
    requiere: ['tijera'],
    requiereAlguno: ['podar', 'jardin', 'pasto'],
    claves: ['27112007'],
  },
  {
    id: 'tijeras_estano_lamina',
    tokens: { tijera: 2, estano: 2, lamina: 2, hojalatero: 1 },
    requiere: ['tijera'],
    requiereAlguno: ['estano', 'lamina', 'hojalatero'],
    claves: ['27111519'],
  },
  {
    id: 'tijeras_aviacion',
    tokens: { tijera: 2, aviacion: 2 },
    requiere: ['tijera', 'aviacion'],
    claves: ['27111516'],
  },
  {
    id: 'tijeras_alambre',
    tokens: { tijera: 2, alambre: 2 },
    requiere: ['tijera', 'alambre'],
    claves: ['27111535'],
  },
  {
    id: 'tijeras_aisladas',
    tokens: { tijera: 2, aislada: 2, electricista: 1 },
    requiere: ['tijera'],
    requiereAlguno: ['aislada', 'electricista'],
    claves: ['27111529'],
  },
  {
    id: 'esponjas_limpia',
    tokens: { esponja: 2, estropajo: 1 },
    claves: ['47131603'],
  },
  {
    id: 'fibras_restregar',
    tokens: { fibra: 2, restregar: 2, abrasiva: 1, estropajo: 1 },
    requiereAlguno: ['fibra', 'restregar'],
    excluye: ['vidrio', 'optica', 'carbon', 'cable'],
    claves: ['47131602'],
  },
  {
    id: 'pilas_alcalinas',
    tokens: { pila: 2, bateria: 1, alcalina: 2, aa: 1, aaa: 1, doble: 1, triple: 1 },
    requiereAlguno: ['pila', 'bateria'],
    excluye: ['agua', 'calentador', 'cocina', 'estufa', 'gas', 'lavabo', 'fregadero', 'tarja', 'tinaco', 'cisterna', 'tanque', 'nivel', 'prueba', 'hidrostatica', 'tierra', 'concreto', 'arena', 'piedra', 'ladrillo', 'block', 'mortero', 'cemento', 'lavadero'],
    claves: ['26111702'],
  },
  {
    id: 'baterias_recargables',
    tokens: { bateria: 2, pila: 1, recargable: 2 },
    requiereAlguno: ['bateria', 'pila'],
    requiere: ['recargable'],
    claves: ['26111701'],
  },
  {
    id: 'pilas_baterias',
    tokens: { pila: 2, bateria: 2 },
    excluye: ['agua', 'calentador', 'cocina', 'estufa', 'gas', 'lavabo', 'fregadero', 'tarja', 'tinaco', 'cisterna', 'tanque', 'nivel', 'prueba', 'hidrostatica', 'tierra', 'concreto', 'arena', 'piedra', 'ladrillo', 'block', 'mortero', 'cemento', 'lavadero'],
    claves: ['26111700'],
  },
  {
    id: 'escuadras',
    tokens: { escuadra: 2 },
    claves: ['27111803'],
  },
  {
    id: 'prensas_carpinteria',
    tokens: { prensa: 2, sargento: 2, rapida: 1, carpinteria: 1 },
    excluye: ['agua', 'hidraulica', 'hidroneumatico', 'tierra', 'aceite', 'filtro', 'rodamiento', 'barren', 'barreno', 'taladro', 'broca', 'inserto', 'rosca', 'tornillo', 'remache', 'pinza', 'mordaza', 'banco', 'trabajo', 'taller', 'mesa'],
    claves: ['31162916'],
  },
  {
    id: 'resortes_compresion',
    tokens: { resorte: 2, muelle: 2, compresion: 2 },
    requiereAlguno: ['resorte', 'muelle'],
    requiere: ['compresion'],
    excluye: ['valvula', 'motor', 'auto', 'automotriz', 'carro', 'coche', 'embrague', 'freno', 'suspension'],
    claves: ['31161904'],
  },
  {
    id: 'resortes',
    tokens: { resorte: 2, muelle: 2 },
    excluye: ['valvula', 'motor', 'auto', 'automotriz', 'carro', 'coche', 'embrague', 'freno', 'suspension'],
    claves: ['31161900'],
  },
  {
    id: 'acoples_conduit',
    tokens: { conduit: 2, cople: 2, acople: 2, conector: 2 },
    requiere: ['conduit'],
    requiereAlguno: ['cople', 'acople', 'conector'],
    claves: ['39131707'],
  },
  {
    id: 'codos_conduit',
    tokens: { conduit: 2, codo: 2, curva: 1 },
    requiere: ['conduit'],
    requiereAlguno: ['codo', 'curva'],
    claves: ['39131717'],
  },
  {
    id: 'boquillas_conduit',
    tokens: { conduit: 2, boquilla: 2 },
    requiere: ['conduit', 'boquilla'],
    claves: ['39131718'],
  },
  {
    id: 'conduit',
    tokens: { conduit: 2, tubo: 1, galvanizado: 1, pared: 1, electrico: 1 },
    excluye: ['codo', 'curva', 'boquilla', 'cople', 'acople', 'conector'],
    claves: ['39131706'],
  },
  {
    id: 'cal_construccion',
    tokens: { cal: 2, hidratada: 2, apagada: 2, hidraulica: 2, construccion: 1, saco: 1, bulto: 1, arena: 1 },
    requiere: ['cal'],
    requiereAlguno: ['hidratada', 'apagada', 'hidraulica', 'construccion', 'saco', 'bulto'],
    excluye: ['cable', 'thw', 'thhn', 'conductor', 'alambre', 'calibre'],
    claves: ['30111604'],
  },
  {
    id: 'centros_carga',
    tokens: { centro: 2, carga: 2, empotrar: 1, sobreponer: 1, polo: 1 },
    requiere: ['centro', 'carga'],
    claves: ['10216408'],
  },
  {
    id: 'pichanchas',
    tokens: { pichancha: 2, canastilla: 1, lavabo: 1, tarja: 1 },
    requiere: ['pichancha'],
    claves: ['40172521'],
  },
  {
    id: 'carbon_escobillas',
    tokens: { carbon: 2, escobilla: 2, cortadora: 1, pulidora: 1, esmeriladora: 1, rectificador: 1, avante: 1, bosch: 1, makita: 1, dewalt: 1, black: 1, decker: 1, herramienta: 1, taladro: 1, mini: 1, b: 1, d: 1 },
    requiere: ['carbon'],
    requiereAlguno: ['escobilla', 'cortadora', 'pulidora', 'esmeriladora', 'rectificador', 'avante', 'bosch', 'makita', 'dewalt', 'herramienta', 'taladro'],
    claves: ['26101404'],
  },
  {
    id: 'puntas_desarmador',
    tokens: { punta: 2, phillips: 2, torx: 2, hex: 2, combinada: 1, desarmador: 1, destornillador: 1 },
    requiere: ['punta'],
    requiereAlguno: ['phillips', 'torx', 'hex', 'combinada', 'desarmador', 'destornillador', 'estrella', 'tornillo'],
    claves: ['27111703'],
  },
  {
    id: 'hachas',
    tokens: { hacha: 2, machete: 2, cazadora: 1, mango: 1, hickory: 1, cabeza: 1, lb: 1, destral: 1, tactical: 1, axe: 1 },
    requiereAlguno: ['hacha', 'machete', 'destral'],
    claves: ['27112000'],
  },
  {
    id: 'palas',
    tokens: { pala: 2, cuadrada: 1, redonda: 1, puno: 1, mango: 1, jardin: 1, cava: 1, trasplante: 1 },
    requiere: ['pala'],
    claves: ['22101700'],
  },
  {
    id: 'lonas_carpas',
    tokens: { lona: 2, reforzada: 2, impermeable: 1, cubierta: 1, gris: 1, azul: 1, verde: 1 },
    requiere: ['lona'],
    claves: ['24111501'],
  },
  {
    id: 'pasadores_cerraduras',
    tokens: { pasador: 2, barra: 1, plano: 1, sobreponer: 1, cromo: 1, laton: 1, dexter: 1, hermex: 1 },
    requiere: ['pasador'],
    excluye: ['tensor', 'cable', 'acero', 'varilla', 'rosca', 'soldar'],
    claves: ['46171500'],
  },
  {
    id: 'piedras_afilar',
    tokens: { piedra: 2, afilar: 2, cuchillo: 1, asentar: 1, agua: 1, cinasa: 1 },
    requiere: ['piedra', 'afilar'],
    claves: ['11111600'],
  },
  {
    id: 'trampas_roedores',
    tokens: { trampa: 2, rata: 2, raton: 2, roedor: 1, victor: 1, madera: 1, racumin: 1, rodenticida: 1, raticida: 1, kill: 1 },
    requiere: ['trampa'],
    claves: ['31162421'],
  },
  {
    id: 'mensulas_soportes',
    tokens: { mensula: 2, soporte: 1, closet: 1, tubo: 1, redondo: 1, ovalado: 1, hermex: 1, central: 1 },
    requiere: ['mensula'],
    claves: ['30161800'],
  },
  {
    id: 'cortadores_tubo',
    tokens: { cortador: 2, tubo: 2, cobre: 1, plastico: 1, pvc: 1, capacidad: 1, cuchilla: 1 },
    requiere: ['cortador', 'tubo'],
    claves: ['23241610'],
  },
  {
    id: 'discos_laminados',
    tokens: { disco: 2, laminado: 2, zirc: 1, grano: 1, fandel: 1, centro: 1 },
    requiere: ['disco', 'laminado'],
    claves: ['26111500'],
  },
  {
    id: 'sogas_polipropileno',
    tokens: { soga: 2, cuerda: 1, polipropileno: 2, polip: 1, nylon: 1, vianti: 1 },
    requiereAlguno: ['soga', 'cuerda'],
    requiere: ['polipropileno'],
    claves: ['31151503'],
  },
  {
    id: 'tuercas_gas',
    tokens: { tuerca: 2, gas: 2, izquierda: 1, conica: 1, maneral: 1, pig: 1, tail: 1, iusa: 1, coflex: 1, lp: 1 },
    requiere: ['tuerca', 'gas'],
    claves: ['31161700'],
  },
  {
    id: 'bandolas_mosquetones',
    tokens: { bandola: 2, mosqueton: 2, seguro: 1, acero: 1 },
    requiereAlguno: ['bandola', 'mosqueton'],
    claves: ['31162600'],
  },
  {
    id: 'alimentadores_flexibles',
    tokens: { alimentador: 2, sanitario: 1, coflex: 1, reforzado: 1, premium: 1, nacobre: 1, foset: 1, flex: 1 },
    requiere: ['alimentador'],
    claves: ['40172500'],
  },
  {
    id: 'pistolas_pintura',
    tokens: { pistola: 2, pintar: 2, pintura: 2, gravedad: 1, aerosol: 1, spray: 1, aerografica: 1, gotero: 1, presion: 1, convencional: 1, exito: 1 },
    requiere: ['pistola'],
    requiereAlguno: ['pintar', 'pintura', 'spray', 'gravedad', 'aerografica', 'aerosol'],
    claves: ['23153100'],
  },
  {
    id: 'boquillas_piso',
    tokens: { boquilla: 2, piso: 2, junteador: 1, arena: 1, gamusa: 1, evano: 1, interceramic: 1, real: 1, chocolate: 1, negra: 1, gris: 1, bone: 1, avellana: 1 },
    requiere: ['boquilla', 'piso'],
    claves: ['30111600'],
  },
  {
    id: 'alambre_galvanizado',
    tokens: { alambre: 2, galvanizado: 2, tirolera: 2, recocido: 1, kg: 1, bwg: 1, calibre: 1, puas: 1, acero: 1 },
    requiere: ['alambre', 'galvanizado'],
    claves: ['30264400'],
  },
  {
    id: 'formones_cinceles',
    tokens: { formon: 2, cincel: 2, escoplo: 2, barreta: 2, punta: 1, mango: 1, comfort: 1, grip: 1, truper: 1 },
    requiereAlguno: ['formon', 'cincel', 'escoplo', 'barreta'],
    claves: ['27111911'],
  },
  {
    id: 'conectores_rapidos',
    tokens: { conector: 2, rapido: 2, npt: 1, macho: 1, hembra: 1, manguera: 1, m: 1 },
    requiere: ['conector', 'rapido'],
    claves: ['27112729'],
  },
  {
    id: 'adaptadores_ppr',
    tokens: { adaptador: 2, polipropileno: 2, ppr: 1, insercion: 1, movible: 1 },
    requiere: ['adaptador', 'polipropileno'],
    claves: ['40141768'],
  },
  {
    id: 'cespol_sifones',
    tokens: { cespol: 2, sifon: 2, bote: 1, integral: 1, compacto: 1, fleximatic: 1, trampa: 1, flexible: 1 },
    requiere: ['cespol'],
    claves: ['40142513'],
  },
  {
    id: 'conectores_manguera_flexible',
    tokens: { conector: 1, tubo: 1, flexible: 2, metalico: 1, recto: 1 },
    requiere: ['conector', 'tubo', 'flexible'],
    claves: ['40172513'],
  },
  {
    id: 'cuello_cera_wc',
    tokens: { cuello: 2, cera: 2, sanitario: 1, wc: 1, guia: 1, coflex: 1, foset: 1 },
    requiere: ['cuello', 'cera'],
    claves: ['31161634'],
  },
  {
    id: 'conectores_cobre',
    tokens: { conector: 2, cobre: 2, macho: 1, hembra: 1, rosca: 1, exterior: 1, interior: 1 },
    requiere: ['conector', 'cobre'],
    claves: ['40172521'],
  },
  {
    id: 'tapas_galvanizadas',
    tokens: { tapa: 2, galvanizado: 2, cuadrada: 1, redonda: 1 },
    requiere: ['tapa', 'galvanizado'],
    claves: ['24112112'],
  },
  {
    id: 'conos_reflejantes',
    tokens: { cono: 2, reflejante: 2, trafico: 1, seguridad: 1, vial: 1, alta: 1, visibilidad: 1 },
    requiere: ['cono', 'reflejante'],
    claves: ['20101703'],
  },
  {
    id: 'separadores_losetas',
    tokens: { separador: 2, loseta: 2, ancla: 1, nivelacion: 1, mm: 1 },
    requiere: ['separador', 'loseta'],
    claves: ['40161700'],
  },
  {
    id: 'botas_jardinero',
    tokens: { bota: 2, jardinera: 2, pvc: 1, talla: 1 },
    requiere: ['bota', 'jardinera'],
    claves: ['53111500'],
  },
  {
    id: 'estucos_textucos',
    tokens: { estuco: 2, textuco: 2, texa: 1, blanco: 1, kg: 1 },
    requiereAlguno: ['estuco', 'textuco'],
    claves: ['30111604'],
  },
  {
    id: 'bases_medidores',
    tokens: { base: 2, medidor: 2, watthorimetro: 1, terminal: 1, iusa: 1, volteck: 1 },
    requiere: ['base', 'medidor'],
    claves: ['39121600'],
  },
  {
    id: 'lapices_carpintero',
    tokens: { lapiz: 2, carpintero: 2, bicolor: 1, grueso: 1, bufly: 1 },
    requiere: ['lapiz', 'carpintero'],
    claves: ['27112309'],
  },
  {
    id: 'accesorios_bano',
    tokens: { bano: 2, jabonera: 2, accesorio: 1, accessorios: 1, cepillero: 1, portavasos: 1, toallero: 1, helvex: 1, cromo: 1, foset: 1, oro: 1, bath: 1 },
    requiere: ['bano'],
    requiereAlguno: ['jabonera', 'accesorio', 'accessorios', 'cepillero', 'portavasos', 'toallero', 'bath'],
    claves: ['30181606'],
  },
  {
    id: 'tubo_closet',
    tokens: { tubo: 2, closet: 2, ovalado: 1, cromado: 1, redondo: 1, hermex: 1, metro: 1 },
    requiere: ['tubo', 'closet'],
    claves: ['20111712'],
  },
  {
    id: 'pinzas_ropa',
    tokens: { pinza: 2, ropa: 2, tender: 1, tiendal: 1, pericos: 1 },
    requiere: ['pinza', 'ropa'],
    claves: ['27112105'],
  },
];

/**
 * Términos que solos no determinan familia. Si el término está presente
 * y ninguno de sus desambiguadores lo acompaña, hay ambigüedad crítica.
 */
const AMBIGUOS = {
  llave: ['stilson', 'perica', 'angular', 'esfera', 'paso', 'compuerta', 'mezcladora', 'allen', 'combinada', 'espanola', 'mixta'],
  arco: ['segueta'],
  barra: ['cerradura', 'cortina', 'panico'],
};

// ── Ramas automáticas por ID de familia ──
function ramaDeFamilia(familia) {
  if (familia.rama) return familia.rama;
  if (familia.automatica) return familia.rama || 'VARIOS';
  const id = familia.id || '';
  // PLOMERIA
  if (/^(tuberia|plomeria|valvula|conexiones|gas_|codos_|tapones_|coladeras_|cespol|alimentadores|llaves_agua|bombas_agua|calentadores|tinacos|flotadores|regaderas|pichanchas|contracanastas|cuello_cera|sifones|conectores_manguera_flexible|adaptadores_ppr|acoples_tuberia|reducciones_tuberia|niples_tuberia|uniones_tuberia|conectores_tubo_ppr|tubos_ppr|conectores_cobre|llaves_paso)/.test(id)) return RAMA.PLOMERIA;
  // ELECTRICO
  if (/^(interruptores|apagadores|contactos_|placas_contactos|cables_|conductores|thw|thhn|pastillas|termomagneticas|fusibles|relevadores|centros_carga|conduit|poliducto|extensiones_|multicontactos|enchufes|clavijas|timbres|conectores_electricos|arrancadores|capacitores|transformadores|reguladores_voltaje|fotoceldas|sensores_movimiento|supresores)/.test(id)) return RAMA.ELECTRICO;
  // ILUMINACION
  if (/^(focos_|lamparas_|luminarios|reflectores|paneles_led|tiras_led|apliques|sockets|portalamp|balastras|iluminacion)/.test(id)) return RAMA.ILUMINACION;
  // HERRAMIENTAS
  if (/^(martillos|marros|combos|hachas|machetes|llaves_|pinzas_|alicates|desarmadores|destornilladores|dados_|matracas|trinquetes|brocas_|sierras_|serruchos|seguetas|cuchillas|navajas_|limas_|escofinas|cepillos_|formones|cinceles|espatulas|cucharas_|llanas_|niveles_|flexometros|plomadas|prensas_|sargentos|taladros_|rotomartillos|esmeriladoras|pulidoras|caladoras|cizallas|tijeras_|cortadores_|tenazas|ganchos_)/.test(id)) return RAMA.HERRAMIENTAS;
  // FERRETERIA
  if (/^(tornillos|tuercas_|arandelas|rondanas|remaches|pernos|taquetes|anclas_|clavos_|grapas|pijas_|bisagras|resortes|muelles|tensores|armellas|jaladeras|pasadores|cerraduras|candados|chapas_|cierres_)/.test(id)) return RAMA.FERRETERIA;
  // CONSTRUCCION
  if (/^(varillas_|mallas_|alambre_galvanizado|blocks_|cementos|morteros|yesos|cal_|tabiques|ladrillos|piedras_|arenas_|gravas_)/.test(id)) return RAMA.CONSTRUCCION;
  // PINTURAS
  if (/^(pinturas_|esmaltes_|barnices|impermeabilizantes|thinner|aguarras|selladores|masillas|estucos_|textucos|pigmentos|colorantes|brochas_|rodillos_|espatulas_)/.test(id)) return RAMA.PINTURAS;
  // SEGURIDAD
  if (/^(cascos_|guantes_|lentes_|caretas_|arneses_|botas_|chalecos_|conos_|senalizacion|extintores|alarmas_)/.test(id)) return RAMA.SEGURIDAD;
  // JARDINERIA / RIEGO
  if (/^(mangueras_|pistolas_riego|aspersores|rociadores|palas_|azadones|rastrillos|carretillas|tijeras_podar|hachas_|machetes)/.test(id)) return RAMA.JARDINERIA;
  // AUTOMOTRIZ
  if (/^(baterias_|pilas_|automotriz|aceites_|lubricantes|refrigerantes|frenos_|embragues|filtros_|llantas_|neumaticos)/.test(id)) return RAMA.AUTOMOTRIZ;
  // LIMPIEZA
  if (/^(esponjas|fibras_|jabones_|detergentes|desinfectantes|jergas|trapeadores|escobas_|recogedores|bolsas_basura)/.test(id)) return RAMA.LIMPIEZA;
  // ELECTRODOMESTICOS
  if (/^(calentadores_agua|bombas_agua|hornos_|parrillas|estufas_|refrigeradores|lavadoras|secadoras|campanas_)/.test(id)) return RAMA.ELECTRODOMESTICOS;
  // MAQUINARIA
  if (/^(maquinaria|compresores_|generadores|plantas_luz|montacargas|elevadores|transportadores|bandas_)/.test(id)) return RAMA.MAQUINARIA;
  // MATERIALES
  if (/^(lijas_|abrasivos|discos_|materiales_|molduras_|perfiles_|plafones_)/.test(id)) return RAMA.MATERIALES;
  // MUEBLES_ACABADOS
  if (/^(muebles_|mesas_|sillas_|armarios_|estantes_|closets_|cocinas_|banos_|lavabos_|fregaderos_|tarjas_)/.test(id)) return RAMA.MUEBLES_ACABADOS;
  // SOLDADURA
  if (/^(soldadura_|electrodos_|soldar_|suelda_|flux_|antorchas_)/.test(id)) return RAMA.SOLDADURA;
  // MEDICION
  if (/^(medidores_|manometros|termometros|micrometros|calibradores_)/.test(id)) return RAMA.MEDICION;
  return RAMA.VARIOS;
}

// ── Cargar familias automáticas desde el índice SAT ──
const FAMILIAS_AUTO = (() => {
  try {
    const ruta = require('path').join(__dirname, '..', '..', 'data', 'sat', 'familias_automaticas.json');
    const data = JSON.parse(require('fs').readFileSync(ruta, 'utf8'));
    if (data && Array.isArray(data.familias)) return data.familias;
    return [];
  } catch (_) {
    return [];
  }
})();

// ── Nuevas familias manuales (~600+) ──
const FAMILIAS_NUEVAS = [
  // ═══════════════════════════════════════
  // ILUMINACION (~45)
  // ═══════════════════════════════════════
  { id: 'focos_led', rama: RAMA.ILUMINACION, tokens: { foco: 1, led: 2 }, requiere: ['foco', 'led'], claves: ['39111613'] },
  { id: 'focos_ahorradores', rama: RAMA.ILUMINACION, tokens: { ahorrador: 2, foco: 1 }, claves: ['39111614'] },
  { id: 'focos_incandescentes', rama: RAMA.ILUMINACION, tokens: { incandescente: 2, foco: 1 }, claves: ['39111610'] },
  { id: 'focos_halogenos', rama: RAMA.ILUMINACION, tokens: { halogeno: 2, foco: 1 }, claves: ['39111611'] },
  { id: 'tiras_led', rama: RAMA.ILUMINACION, tokens: { tira: 2, led: 2 }, claves: ['39111606'] },
  { id: 'paneles_led', rama: RAMA.ILUMINACION, tokens: { panel: 2, led: 2 }, claves: ['39111630'] },
  { id: 'reflectores_led', rama: RAMA.ILUMINACION, tokens: { reflector: 2, led: 1 }, claves: ['39111612'] },
  { id: 'luminarios_empotrar', rama: RAMA.ILUMINACION, tokens: { luminario: 2, empotrar: 2 }, claves: ['39111625'] },
  { id: 'luminarios_sobreponer', rama: RAMA.ILUMINACION, tokens: { luminario: 2, sobreponer: 2 }, claves: ['39111626'] },
  { id: 'apliques_pared', rama: RAMA.ILUMINACION, tokens: { aplique: 2, pared: 2 }, claves: ['39111627'] },
  { id: 'lamparas_colgantes', rama: RAMA.ILUMINACION, tokens: { lampara: 1, colgante: 2 }, claves: ['39111628'] },
  { id: 'lamparas_techo', rama: RAMA.ILUMINACION, tokens: { lampara: 1, techo: 2 }, claves: ['39111629'] },
  { id: 'lamparas_escritorio', rama: RAMA.ILUMINACION, tokens: { lampara: 1, escritorio: 2 }, claves: ['39111632'] },
  { id: 'lamparas_piso', rama: RAMA.ILUMINACION, tokens: { lampara: 1, piso: 2 }, claves: ['39111633'] },
  { id: 'sockets_portalamparas', rama: RAMA.ILUMINACION, tokens: { socket: 2, portalamp: 2 }, claves: ['39111617'] },
  { id: 'balastras_led', rama: RAMA.ILUMINACION, tokens: { balastra: 2, led: 1 }, claves: ['39111619'] },
  { id: 'fotoceldas', rama: RAMA.ILUMINACION, tokens: { fotocelda: 2, sensor: 1 }, claves: ['39122208'] },
  { id: 'sensores_movimiento', rama: RAMA.ILUMINACION, tokens: { sensor: 2, movimiento: 2 }, claves: ['39122208'] },
  { id: 'reguladores_luz', rama: RAMA.ILUMINACION, tokens: { regulador: 2, luz: 2, dimer: 1 }, claves: ['39121630'] },
  { id: 'plafones', rama: RAMA.ILUMINACION, tokens: { plafon: 2 }, claves: ['39111635'] },
  { id: 'focos_decorativos', rama: RAMA.ILUMINACION, tokens: { foco: 1, decorativo: 2 }, claves: ['39111615'] },
  { id: 'luminarios_emergencia', rama: RAMA.ILUMINACION, tokens: { luminario: 1, emergencia: 2 }, claves: ['39111636'] },
  { id: 'lamparas_industriales', rama: RAMA.ILUMINACION, tokens: { lampara: 1, industrial: 2 }, claves: ['39111631'] },
  { id: 'focos_especiales', rama: RAMA.ILUMINACION, tokens: { foco: 1, especial: 2, uv: 1, multicolor: 1 }, claves: ['39111616'] },
  { id: 'portalamparas', rama: RAMA.ILUMINACION, tokens: { portalamp: 2 }, requiere: ['portalamp'], claves: ['39111617'] },
  { id: 'cables_luz', rama: RAMA.ILUMINACION, tokens: { cable: 1, luz: 2, serie: 1 }, claves: ['39111621'] },

  // ═══════════════════════════════════════
  // ELECTRICO (~60)
  // ═══════════════════════════════════════
  { id: 'contactos_tomacorriente', rama: RAMA.ELECTRICO, tokens: { contacto: 2, tomacorriente: 2 }, claves: ['39121402'] },
  { id: 'contactos_sobreponer', rama: RAMA.ELECTRICO, tokens: { contacto: 1, sobreponer: 2 }, claves: ['39121403'] },
  { id: 'contactos_empotrar', rama: RAMA.ELECTRICO, tokens: { contacto: 1, empotrar: 2 }, claves: ['39121404'] },
  { id: 'contactos_uso_general', rama: RAMA.ELECTRICO, tokens: { contacto: 1, uso: 1, general: 1 }, claves: ['39121401'] },
  { id: 'contactos_aterrizados', rama: RAMA.ELECTRICO, tokens: { contacto: 1, aterrizado: 2, polarizado: 1 }, claves: ['39121405'] },
  { id: 'cables_thw', rama: RAMA.ELECTRICO, tokens: { cable: 1, thw: 2, calibre: 1 }, requiere: ['thw'], claves: ['39121501'] },
  { id: 'cables_thhn', rama: RAMA.ELECTRICO, tokens: { cable: 1, thhn: 2, calibre: 1 }, requiere: ['thhn'], claves: ['39121502'] },
  { id: 'cables_sotano', rama: RAMA.ELECTRICO, tokens: { cable: 1, sotano: 2 }, claves: ['39121503'] },
  { id: 'cables_uso_rudo', rama: RAMA.ELECTRICO, tokens: { cable: 1, rudo: 2 }, claves: ['39121504'] },
  { id: 'cables_twisteados', rama: RAMA.ELECTRICO, tokens: { cable: 1, twist: 1, trenzado: 1 }, claves: ['39121505'] },
  { id: 'cables_plano', rama: RAMA.ELECTRICO, tokens: { cable: 1, plano: 2 }, claves: ['39121506'] },
  { id: 'cables_coaxial', rama: RAMA.ELECTRICO, tokens: { cable: 1, coaxial: 2 }, claves: ['39121507'] },
  { id: 'cables_audio_video', rama: RAMA.ELECTRICO, tokens: { cable: 1, audio: 1, video: 1, hdmi: 1, rca: 1 }, claves: ['39121508'] },
  { id: 'pastillas_termomagneticas', rama: RAMA.ELECTRICO, tokens: { pastilla: 2, termomagnetica: 2 }, claves: ['39121601'] },
  { id: 'pastillas_thermoelectricas', rama: RAMA.ELECTRICO, tokens: { pastilla: 1, termica: 2 }, claves: ['39121602'] },
  { id: 'fusibles_cartucho', rama: RAMA.ELECTRICO, tokens: { fusible: 2, cartucho: 2 }, claves: ['39121603'] },
  { id: 'fusibles_cuchilla', rama: RAMA.ELECTRICO, tokens: { fusible: 1, cuchilla: 2 }, claves: ['39121604'] },
  { id: 'fusibles_termicos', rama: RAMA.ELECTRICO, tokens: { fusible: 1, termico: 2 }, claves: ['39121605'] },
  { id: 'interruptores_termomagneticos', rama: RAMA.ELECTRICO, tokens: { interruptor: 1, termomagnetico: 2 }, claves: ['39122201'] },
  { id: 'interruptores_sencillos', rama: RAMA.ELECTRICO, tokens: { interruptor: 1, sencillo: 2, apagador: 1 }, claves: ['39122202'] },
  { id: 'apagadores_sencillos', rama: RAMA.ELECTRICO, tokens: { apagador: 2, sencillo: 1 }, claves: ['39122202'] },
  { id: 'apagadores_escalera', rama: RAMA.ELECTRICO, tokens: { apagador: 1, escalera: 2 }, claves: ['39122203'] },
  { id: 'apagadores_sobreponer', rama: RAMA.ELECTRICO, tokens: { apagador: 1, sobreponer: 2 }, claves: ['39122204'] },
  { id: 'centros_carga', rama: RAMA.ELECTRICO, tokens: { centro: 2, carga: 2 }, requiere: ['centro', 'carga'], claves: ['39121606'] },
  { id: 'transformadores_corriente', rama: RAMA.ELECTRICO, tokens: { transformador: 2, corriente: 1 }, claves: ['39121607'] },
  { id: 'reguladores_voltaje', rama: RAMA.ELECTRICO, tokens: { regulador: 2, voltaje: 2 }, claves: ['39121608'] },
  { id: 'no_break', rama: RAMA.ELECTRICO, tokens: { no: 1, break: 2, ups: 1 }, claves: ['39121609'] },
  { id: 'supresores_picos', rama: RAMA.ELECTRICO, tokens: { supresor: 2, pico: 1 }, claves: ['39121610'] },
  { id: 'relevadores_estado_solido', rama: RAMA.ELECTRICO, tokens: { relevador: 2, estado: 1, solido: 1 }, claves: ['39121611'] },
  { id: 'relevadores_electromagneticos', rama: RAMA.ELECTRICO, tokens: { relevador: 1, electromagnetico: 2 }, claves: ['39121612'] },
  { id: 'arrancadores_motores', rama: RAMA.ELECTRICO, tokens: { arrancador: 2, motor: 1 }, claves: ['39121613'] },
  { id: 'capacitores_arranque', rama: RAMA.ELECTRICO, tokens: { capacitor: 2, arranque: 2 }, claves: ['39121614'] },
  { id: 'capacitores_permanentes', rama: RAMA.ELECTRICO, tokens: { capacitor: 2, permanente: 2 }, claves: ['39121615'] },
  { id: 'timbres_chicharras', rama: RAMA.ELECTRICO, tokens: { timbre: 2, chicharra: 2 }, claves: ['39122206'] },
  { id: 'interruptores_termicos', rama: RAMA.ELECTRICO, tokens: { interruptor: 1, termico: 2 }, claves: ['39122209'] },
  { id: 'interruptores_presion', rama: RAMA.ELECTRICO, tokens: { interruptor: 1, presion: 2 }, claves: ['39122210'] },
  { id: 'interruptores_flotador', rama: RAMA.ELECTRICO, tokens: { interruptor: 1, flotador: 2 }, claves: ['39122211'] },
  { id: 'interruptores_cuchilla', rama: RAMA.ELECTRICO, tokens: { interruptor: 1, cuchilla: 2 }, claves: ['39122212'] },
  { id: 'apagadores_mercurio', rama: RAMA.ELECTRICO, tokens: { apagador: 1, mercurio: 2 }, claves: ['39122213'] },
  { id: 'conmutadores', rama: RAMA.ELECTRICO, tokens: { conmutador: 2 }, claves: ['39122214'] },
  { id: 'selectores', rama: RAMA.ELECTRICO, tokens: { selector: 2 }, claves: ['39122215'] },
  { id: 'pulsadores_botones', rama: RAMA.ELECTRICO, tokens: { pulsador: 2, boton: 2 }, claves: ['39122216'] },

  // ═══════════════════════════════════════
  // FERRETERIA (~100)
  // ═══════════════════════════════════════
  { id: 'tornillos_acero_inoxidable', rama: RAMA.FERRETERIA, tokens: { tornillo: 2, inoxidable: 2 }, requiere: ['tornillo', 'inoxidable'], claves: ['31161701'] },
  { id: 'tornillos_galvanizados', rama: RAMA.FERRETERIA, tokens: { tornillo: 2, galvanizado: 2 }, requiere: ['tornillo', 'galvanizado'], claves: ['31161702'] },
  { id: 'tornillos_cabeza_hexagonal', rama: RAMA.FERRETERIA, tokens: { tornillo: 2, hexagonal: 2, cabeza: 1 }, claves: ['31161703'] },
  { id: 'tornillos_cabeza_plana', rama: RAMA.FERRETERIA, tokens: { tornillo: 2, plano: 1, cabeza: 1 }, claves: ['31161704'] },
  { id: 'tornillos_autorroscantes', rama: RAMA.FERRETERIA, tokens: { tornillo: 2, autorroscante: 2 }, claves: ['31161705'] },
  { id: 'tornillos_madera', rama: RAMA.FERRETERIA, tokens: { tornillo: 2, madera: 2 }, claves: ['31161706'] },
  { id: 'tornillos_laminas', rama: RAMA.FERRETERIA, tokens: { tornillo: 1, lamina: 2 }, claves: ['31161707'] },
  { id: 'tornillos_mariposa', rama: RAMA.FERRETERIA, tokens: { tornillo: 1, mariposa: 2 }, claves: ['31161708'] },
  { id: 'tornillos_ojos', rama: RAMA.FERRETERIA, tokens: { tornillo: 1, ojo: 2, argolla: 1 }, claves: ['31161709'] },
  { id: 'tuercas_hexagonales', rama: RAMA.FERRETERIA, tokens: { tuerca: 2, hexagonal: 2 }, claves: ['31161801'] },
  { id: 'tuercas_seguridad', rama: RAMA.FERRETERIA, tokens: { tuerca: 2, seguridad: 2 }, claves: ['31161802'] },
  { id: 'tuercas_mariposa', rama: RAMA.FERRETERIA, tokens: { tuerca: 1, mariposa: 2 }, claves: ['31161803'] },
  { id: 'rondanas_presion', rama: RAMA.FERRETERIA, tokens: { rondana: 2, presion: 2 }, claves: ['31161804'] },
  { id: 'rondanas_planas', rama: RAMA.FERRETERIA, tokens: { rondana: 2, plana: 2 }, claves: ['31161805'] },
  { id: 'arandelas_golilla', rama: RAMA.FERRETERIA, tokens: { arandela: 2, golilla: 2 }, claves: ['31161806'] },
  { id: 'remaches_pop', rama: RAMA.FERRETERIA, tokens: { remache: 2, pop: 2 }, claves: ['31161807'] },
  { id: 'remaches_solidos', rama: RAMA.FERRETERIA, tokens: { remache: 1, solido: 2 }, claves: ['31161808'] },
  { id: 'pernos_hexagonales', rama: RAMA.FERRETERIA, tokens: { perno: 2, hexagonal: 2 }, claves: ['31161809'] },
  { id: 'pernos_coche', rama: RAMA.FERRETERIA, tokens: { perno: 2, coche: 2 }, claves: ['31161810'] },
  { id: 'taquetes_expansion', rama: RAMA.FERRETERIA, tokens: { taquete: 2, expansion: 2 }, claves: ['31161811'] },
  { id: 'taquetes_plasticos', rama: RAMA.FERRETERIA, tokens: { taquete: 2, plastico: 2 }, claves: ['31161812'] },
  { id: 'taquetes_metalicos', rama: RAMA.FERRETERIA, tokens: { taquete: 2, metalico: 2 }, claves: ['31161813'] },
  { id: 'anclas_concreto', rama: RAMA.FERRETERIA, tokens: { ancla: 2, concreto: 2 }, claves: ['31161814'] },
  { id: 'anclas_quimicas', rama: RAMA.FERRETERIA, tokens: { ancla: 1, quimica: 2 }, claves: ['31161815'] },
  { id: 'clavos_concreto', rama: RAMA.FERRETERIA, tokens: { clavo: 2, concreto: 2 }, claves: ['31161816'] },
  { id: 'clavos_madera', rama: RAMA.FERRETERIA, tokens: { clavo: 2, madera: 2 }, claves: ['31161817'] },
  { id: 'clavos_acero', rama: RAMA.FERRETERIA, tokens: { clavo: 1, acero: 2 }, claves: ['31161818'] },
  { id: 'grapas_engrapadora', rama: RAMA.FERRETERIA, tokens: { grapa: 2, engrapadora: 2 }, claves: ['31161819'] },
  { id: 'pijas_madera', rama: RAMA.FERRETERIA, tokens: { pija: 2, madera: 2 }, claves: ['31161706'] },
  { id: 'pijas_metal', rama: RAMA.FERRETERIA, tokens: { pija: 2, metal: 2 }, claves: ['31161701'] },
  { id: 'bisagras_sobreponer', rama: RAMA.FERRETERIA, tokens: { bisagra: 2, sobreponer: 2 }, claves: ['31162401'] },
  { id: 'bisagras_empotrar', rama: RAMA.FERRETERIA, tokens: { bisagra: 2, empotrar: 2 }, claves: ['31162402'] },
  { id: 'bisagras_piano', rama: RAMA.FERRETERIA, tokens: { bisagra: 1, piano: 2 }, claves: ['31162403'] },
  { id: 'resortes_compresion', rama: RAMA.FERRETERIA, tokens: { resorte: 2, compresion: 2 }, claves: ['31161901'] },
  { id: 'resortes_torsion', rama: RAMA.FERRETERIA, tokens: { resorte: 2, torsion: 2 }, claves: ['31161902'] },
  { id: 'resortes_extension', rama: RAMA.FERRETERIA, tokens: { resorte: 2, extension: 2 }, claves: ['31161903'] },
  { id: 'cadenas_acero', rama: RAMA.FERRETERIA, tokens: { cadena: 2, acero: 2 }, claves: ['31161904'] },
  { id: 'cadenas_galvanizadas', rama: RAMA.FERRETERIA, tokens: { cadena: 2, galvanizado: 2 }, claves: ['31161905'] },
  { id: 'cadenas_eslabon', rama: RAMA.FERRETERIA, tokens: { cadena: 1, eslabon: 2 }, claves: ['31161906'] },
  { id: 'tensores_cable', rama: RAMA.FERRETERIA, tokens: { tensor: 2, cable: 2 }, claves: ['31162404'] },
  { id: 'ganchos_acero', rama: RAMA.FERRETERIA, tokens: { gancho: 2, acero: 2 }, claves: ['31162405'] },
  { id: 'ganchos_plastico', rama: RAMA.FERRETERIA, tokens: { gancho: 2, plastico: 2 }, claves: ['31162406'] },
  { id: 'armellas_abiertas', rama: RAMA.FERRETERIA, tokens: { armella: 2, abierta: 2 }, claves: ['31162407'] },
  { id: 'armellas_cerradas', rama: RAMA.FERRETERIA, tokens: { armella: 2, cerrada: 2 }, claves: ['31162408'] },
  { id: 'pasadores_cerraduras', rama: RAMA.FERRETERIA, tokens: { pasador: 2, cerradura: 2 }, claves: ['31162409'] },
  { id: 'pasadores_barra', rama: RAMA.FERRETERIA, tokens: { pasador: 2, barra: 2 }, claves: ['31162410'] },
  { id: 'jaladeras_muebles', rama: RAMA.FERRETERIA, tokens: { jaladera: 2, mueble: 2 }, claves: ['31162801'] },
  { id: 'tiradores_muebles', rama: RAMA.FERRETERIA, tokens: { tirador: 2, mueble: 2 }, claves: ['31162802'] },
  { id: 'topes_puerta', rama: RAMA.FERRETERIA, tokens: { tope: 2, puerta: 2 }, claves: ['31162411'] },
  { id: 'cerraduras_sobreponer', rama: RAMA.FERRETERIA, tokens: { cerradura: 2, sobreponer: 2 }, claves: ['46171501'] },
  { id: 'cerraduras_empotrar', rama: RAMA.FERRETERIA, tokens: { cerradura: 2, empotrar: 2 }, claves: ['46171502'] },
  { id: 'cerraduras_manija', rama: RAMA.FERRETERIA, tokens: { cerradura: 1, manija: 2 }, claves: ['46171503'] },
  { id: 'chapas_seguridad', rama: RAMA.FERRETERIA, tokens: { chapa: 2, seguridad: 2 }, claves: ['46171504'] },
  { id: 'candados_laton', rama: RAMA.FERRETERIA, tokens: { candado: 2, laton: 2 }, claves: ['46171601'] },
  { id: 'candados_acero', rama: RAMA.FERRETERIA, tokens: { candado: 2, acero: 2 }, claves: ['46171602'] },
  { id: 'candados_combinacion', rama: RAMA.FERRETERIA, tokens: { candado: 2, combinacion: 2 }, claves: ['46171603'] },
  { id: 'candados_seguridad', rama: RAMA.FERRETERIA, tokens: { candado: 2, seguridad: 2 }, claves: ['46171604'] },

  // ═══════════════════════════════════════
  // HERRAMIENTAS (~80)
  // ═══════════════════════════════════════
  { id: 'pinzas_corte', rama: RAMA.HERRAMIENTAS, tokens: { pinza: 2, corte: 2 }, requiere: ['pinza', 'corte'], claves: ['27111701'] },
  { id: 'pinzas_punta', rama: RAMA.HERRAMIENTAS, tokens: { pinza: 2, punta: 2 }, claves: ['27111702'] },
  { id: 'pinzas_mecanica', rama: RAMA.HERRAMIENTAS, tokens: { pinza: 2, mecanica: 2 }, claves: ['27111703'] },
  { id: 'pinzas_apriete', rama: RAMA.HERRAMIENTAS, tokens: { pinza: 2, apriete: 2 }, claves: ['27111704'] },
  { id: 'alicates_punta', rama: RAMA.HERRAMIENTAS, tokens: { alicata: 2, punta: 2 }, claves: ['27111705'] },
  { id: 'alicates_corte', rama: RAMA.HERRAMIENTAS, tokens: { alicata: 2, corte: 2 }, claves: ['27111706'] },
  { id: 'llaves_pericas', rama: RAMA.HERRAMIENTAS, tokens: { llave: 2, perica: 2 }, requiere: ['llave', 'perica'], claves: ['27111707'] },
  { id: 'llaves_espanolas', rama: RAMA.HERRAMIENTAS, tokens: { llave: 2, espanola: 2 }, claves: ['27111708'] },
  { id: 'llaves_combinadas', rama: RAMA.HERRAMIENTAS, tokens: { llave: 2, combinada: 2 }, claves: ['27111709'] },
  { id: 'llaves_hexagonales', rama: RAMA.HERRAMIENTAS, tokens: { llave: 2, hexagonal: 2, allen: 1 }, claves: ['27111710'] },
  { id: 'llaves_torx', rama: RAMA.HERRAMIENTAS, tokens: { llave: 1, torx: 2 }, claves: ['27111711'] },
  { id: 'llaves_stilson', rama: RAMA.HERRAMIENTAS, tokens: { llave: 1, stilson: 2 }, claves: ['27111712'] },
  { id: 'llaves_inglesas', rama: RAMA.HERRAMIENTAS, tokens: { llave: 1, inglesa: 2 }, claves: ['27111713'] },
  { id: 'llaves_tubo', rama: RAMA.HERRAMIENTAS, tokens: { llave: 1, tubo: 2 }, claves: ['27111714'] },
  { id: 'dados_hexagonales', rama: RAMA.HERRAMIENTAS, tokens: { dado: 2, hexagonal: 2 }, claves: ['27111715'] },
  { id: 'dados_torx', rama: RAMA.HERRAMIENTAS, tokens: { dado: 2, torx: 2 }, claves: ['27111716'] },
  { id: 'matracas_trinquetes', rama: RAMA.HERRAMIENTAS, tokens: { matraca: 2, trinquete: 2 }, claves: ['27111717'] },
  { id: 'desarmadores_plano', rama: RAMA.HERRAMIENTAS, tokens: { desarmador: 2, plano: 2 }, claves: ['27111718'] },
  { id: 'desarmadores_phillips', rama: RAMA.HERRAMIENTAS, tokens: { desarmador: 2, phillips: 2 }, claves: ['27111719'] },
  { id: 'desarmadores_precision', rama: RAMA.HERRAMIENTAS, tokens: { desarmador: 2, precision: 2 }, claves: ['27111720'] },
  { id: 'desarmadores_impacto', rama: RAMA.HERRAMIENTAS, tokens: { desarmador: 1, impacto: 2 }, claves: ['27111721'] },
  { id: 'martillos_uya', rama: RAMA.HERRAMIENTAS, tokens: { martillo: 2, uya: 2 }, claves: ['27111501'] },
  { id: 'martillos_bola', rama: RAMA.HERRAMIENTAS, tokens: { martillo: 2, bola: 2 }, claves: ['27111502'] },
  { id: 'martillos_maso', rama: RAMA.HERRAMIENTAS, tokens: { martillo: 2, maso: 2 }, claves: ['27111503'] },
  { id: 'marros', rama: RAMA.HERRAMIENTAS, tokens: { marro: 2 }, claves: ['27111504'] },
  { id: 'combos', rama: RAMA.HERRAMIENTAS, tokens: { combo: 2 }, claves: ['27111505'] },
  { id: 'hachas', rama: RAMA.HERRAMIENTAS, tokens: { hacha: 2 }, claves: ['27111506'] },
  { id: 'machetes', rama: RAMA.HERRAMIENTAS, tokens: { machete: 2 }, claves: ['27111507'] },
  { id: 'brocas_metal', rama: RAMA.HERRAMIENTAS, tokens: { broca: 2, metal: 2, hss: 1 }, claves: ['27112801'] },
  { id: 'brocas_madera', rama: RAMA.HERRAMIENTAS, tokens: { broca: 2, madera: 2 }, claves: ['27112802'] },
  { id: 'brocas_concreto', rama: RAMA.HERRAMIENTAS, tokens: { broca: 2, concreto: 2 }, claves: ['27112803'] },
  { id: 'brocas_multimaterial', rama: RAMA.HERRAMIENTAS, tokens: { broca: 2, multimaterial: 2 }, claves: ['27112804'] },
  { id: 'brocas_forstner', rama: RAMA.HERRAMIENTAS, tokens: { broca: 2, forstner: 2 }, claves: ['27112805'] },
  { id: 'brocas_pala', rama: RAMA.HERRAMIENTAS, tokens: { broca: 2, pala: 2 }, claves: ['27112806'] },
  { id: 'brocas_escalonada', rama: RAMA.HERRAMIENTAS, tokens: { broca: 2, escalonada: 2 }, claves: ['27112807'] },
  { id: 'seguetas_arco', rama: RAMA.HERRAMIENTAS, tokens: { segueta: 2, arco: 2 }, claves: ['27111508'] },
  { id: 'sierras_mano', rama: RAMA.HERRAMIENTAS, tokens: { sierra: 2, mano: 2 }, claves: ['27111509'] },
  { id: 'serruchos_podar', rama: RAMA.HERRAMIENTAS, tokens: { serrucho: 2, podar: 2 }, claves: ['27111510'] },
  { id: 'cuchillas_carpintero', rama: RAMA.HERRAMIENTAS, tokens: { cuchilla: 2, carpintero: 2 }, claves: ['27111511'] },
  { id: 'navajas_cutter', rama: RAMA.HERRAMIENTAS, tokens: { navaja: 2, cutter: 2 }, claves: ['27111512'] },
  { id: 'limas_planas', rama: RAMA.HERRAMIENTAS, tokens: { lima: 2, plana: 2 }, claves: ['27111901'] },
  { id: 'limas_redondas', rama: RAMA.HERRAMIENTAS, tokens: { lima: 2, redonda: 2 }, claves: ['27111902'] },
  { id: 'limas_triangulares', rama: RAMA.HERRAMIENTAS, tokens: { lima: 2, triangular: 2 }, claves: ['27111903'] },
  { id: 'escofinas', rama: RAMA.HERRAMIENTAS, tokens: { escofina: 2 }, claves: ['27111904'] },
  { id: 'formones_cinceles', rama: RAMA.HERRAMIENTAS, tokens: { formon: 2, cincel: 2 }, claves: ['27111905'] },
  { id: 'cepillos_carpintero', rama: RAMA.HERRAMIENTAS, tokens: { cepillo: 2, carpintero: 2 }, claves: ['27111906'] },
  { id: 'niveles_burbuja', rama: RAMA.HERRAMIENTAS, tokens: { nivel: 2, burbuja: 2 }, claves: ['27111801'] },
  { id: 'niveles_laser', rama: RAMA.HERRAMIENTAS, tokens: { nivel: 2, laser: 2 }, claves: ['27111802'] },
  { id: 'flexometros_cinta', rama: RAMA.HERRAMIENTAS, tokens: { flexomet: 2, cinta: 1 }, claves: ['27111803'] },
  { id: 'plomadas', rama: RAMA.HERRAMIENTAS, tokens: { plomada: 2 }, claves: ['27111804'] },
  { id: 'prensas_sargentos', rama: RAMA.HERRAMIENTAS, tokens: { prensa: 2, sargento: 2 }, claves: ['27111805'] },
  { id: 'espatulas_llanas', rama: RAMA.HERRAMIENTAS, tokens: { espatula: 2, llana: 1 }, claves: ['27112201'] },
  { id: 'cucharas_albanil', rama: RAMA.HERRAMIENTAS, tokens: { cuchara: 2, albanil: 2 }, claves: ['27112202'] },
  { id: 'llanas_albanil', rama: RAMA.HERRAMIENTAS, tokens: { llana: 2, albanil: 2 }, claves: ['27112203'] },

  // ═══════════════════════════════════════
  // PLOMERIA (~50)
  // ═══════════════════════════════════════
  { id: 'valvulas_compuerta', rama: RAMA.PLOMERIA, tokens: { valvula: 2, compuerta: 2 }, claves: ['40141601'] },
  { id: 'valvulas_bola', rama: RAMA.PLOMERIA, tokens: { valvula: 2, bola: 2 }, claves: ['40141602'] },
  { id: 'valvulas_check', rama: RAMA.PLOMERIA, tokens: { valvula: 2, check: 2 }, claves: ['40141603'] },
  { id: 'valvulas_mariposa', rama: RAMA.PLOMERIA, tokens: { valvula: 2, mariposa: 2 }, claves: ['40141604'] },
  { id: 'valvulas_seguridad', rama: RAMA.PLOMERIA, tokens: { valvula: 2, seguridad: 2 }, claves: ['40141605'] },
  { id: 'valvulas_alivio', rama: RAMA.PLOMERIA, tokens: { valvula: 1, alivio: 2 }, claves: ['40141606'] },
  { id: 'valvulas_aguja', rama: RAMA.PLOMERIA, tokens: { valvula: 2, aguja: 2 }, claves: ['40141607'] },
  { id: 'valvulas_retencion', rama: RAMA.PLOMERIA, tokens: { valvula: 2, retencion: 2 }, claves: ['40141608'] },
  { id: 'llaves_paso_corta', rama: RAMA.PLOMERIA, tokens: { llave: 2, paso: 2, corta: 1 }, requiere: ['llave', 'paso'], claves: ['40141609'] },
  { id: 'llaves_angulo', rama: RAMA.PLOMERIA, tokens: { llave: 2, angular: 2, paso: 1 }, claves: ['40141610'] },
  { id: 'llaves_esfera', rama: RAMA.PLOMERIA, tokens: { llave: 2, esfera: 2 }, claves: ['40141611'] },
  { id: 'flotadores_tinaco', rama: RAMA.PLOMERIA, tokens: { flotador: 2, tinaco: 2 }, claves: ['40141612'] },
  { id: 'flotadores_wc', rama: RAMA.PLOMERIA, tokens: { flotador: 2, wc: 1, sanitario: 1 }, claves: ['40141613'] },
  { id: 'tinacos_plasticos', rama: RAMA.PLOMERIA, tokens: { tinaco: 2, plastico: 2 }, claves: ['40141501'] },
  { id: 'tinacos_concreto', rama: RAMA.PLOMERIA, tokens: { tinaco: 1, concreto: 2 }, claves: ['40141502'] },
  { id: 'cisternas', rama: RAMA.PLOMERIA, tokens: { cisterna: 2 }, claves: ['40141503'] },
  { id: 'calentadores_gas', rama: RAMA.PLOMERIA, tokens: { calentador: 2, gas: 2 }, claves: ['40101501'] },
  { id: 'calentadores_electricos', rama: RAMA.PLOMERIA, tokens: { calentador: 2, electrico: 2 }, claves: ['40101502'] },
  { id: 'bombas_agua_perifericas', rama: RAMA.PLOMERIA, tokens: { bomba: 2, periferica: 2 }, claves: ['40151501'] },
  { id: 'bombas_agua_centrifugas', rama: RAMA.PLOMERIA, tokens: { bomba: 2, centrifuga: 2 }, claves: ['40151502'] },
  { id: 'bombas_agua_sumergibles', rama: RAMA.PLOMERIA, tokens: { bomba: 2, sumergible: 2 }, claves: ['40151503'] },
  { id: 'bombas_agua_presion', rama: RAMA.PLOMERIA, tokens: { bomba: 2, presion: 2 }, claves: ['40151504'] },
  { id: 'tuberia_pvc', rama: RAMA.PLOMERIA, tokens: { tuberia: 2, pvc: 2 }, claves: ['40141701'] },
  { id: 'tuberia_cpvc', rama: RAMA.PLOMERIA, tokens: { tuberia: 2, cpvc: 2 }, claves: ['40141702'] },
  { id: 'tuberia_cobre', rama: RAMA.PLOMERIA, tokens: { tuberia: 2, cobre: 2 }, claves: ['40141703'] },
  { id: 'tuberia_galvanizada', rama: RAMA.PLOMERIA, tokens: { tuberia: 2, galvanizado: 2 }, claves: ['40141704'] },
  { id: 'conexiones_pvc', rama: RAMA.PLOMERIA, tokens: { conexion: 2, pvc: 2 }, claves: ['40141705'] },
  { id: 'conexiones_cobre', rama: RAMA.PLOMERIA, tokens: { conexion: 2, cobre: 2 }, claves: ['40141706'] },
  { id: 'soldadura_estano', rama: RAMA.PLOMERIA, tokens: { soldadura: 2, estano: 2 }, claves: ['40141707'] },
  { id: 'cinta_teflon', rama: RAMA.PLOMERIA, tokens: { cinta: 2, teflon: 2 }, claves: ['40141708'] },
  { id: 'coladeras_piso', rama: RAMA.PLOMERIA, tokens: { coladera: 2, piso: 2 }, claves: ['40141709'] },
  { id: 'coladeras_lavabo', rama: RAMA.PLOMERIA, tokens: { coladera: 2, lavabo: 2 }, claves: ['40141710'] },
  { id: 'cespol_sifones', rama: RAMA.PLOMERIA, tokens: { cespol: 2, sifon: 2 }, claves: ['40141711'] },
  { id: 'alimentadores_flexibles', rama: RAMA.PLOMERIA, tokens: { alimentador: 2, flexible: 2 }, claves: ['40141712'] },
  { id: 'llaves_jardin', rama: RAMA.PLOMERIA, tokens: { llave: 1, jardin: 2 }, claves: ['40141614'] },
  { id: 'manometros', rama: RAMA.PLOMERIA, tokens: { manometro: 2 }, claves: ['40141615'] },
  { id: 'termometros_agua', rama: RAMA.PLOMERIA, tokens: { termometro: 2, agua: 1 }, claves: ['40141616'] },
  { id: 'filtros_agua', rama: RAMA.PLOMERIA, tokens: { filtro: 2, agua: 2 }, claves: ['40141617'] },
  { id: 'suavizadores_agua', rama: RAMA.PLOMERIA, tokens: { suavizador: 2, agua: 2 }, claves: ['40141618'] },

  // ═══════════════════════════════════════
  // CONSTRUCCION (~50)
  // ═══════════════════════════════════════
  { id: 'blocks_huecos', rama: RAMA.CONSTRUCCION, tokens: { block: 2, hueco: 2 }, claves: ['30101501'] },
  { id: 'blocks_macizos', rama: RAMA.CONSTRUCCION, tokens: { block: 2, macizo: 2 }, claves: ['30101502'] },
  { id: 'ladrillos_arcilla', rama: RAMA.CONSTRUCCION, tokens: { ladrillo: 2, arcilla: 2 }, claves: ['30101503'] },
  { id: 'tabiques_barro', rama: RAMA.CONSTRUCCION, tokens: { tabique: 2, barro: 2 }, claves: ['30101504'] },
  { id: 'varillas_corrugadas', rama: RAMA.CONSTRUCCION, tokens: { varilla: 2, corrugado: 2 }, claves: ['30102401'] },
  { id: 'varillas_lisas', rama: RAMA.CONSTRUCCION, tokens: { varilla: 2, lisa: 2 }, claves: ['30102402'] },
  { id: 'mallas_electrosoldadas', rama: RAMA.CONSTRUCCION, tokens: { malla: 2, electrosoldada: 2 }, claves: ['30102403'] },
  { id: 'mallas_ciclon', rama: RAMA.CONSTRUCCION, tokens: { malla: 2, ciclon: 2 }, claves: ['30102404'] },
  { id: 'alambre_recocido', rama: RAMA.CONSTRUCCION, tokens: { alambre: 2, recocido: 2 }, claves: ['30102405'] } ,
  { id: 'alambre_puas', rama: RAMA.CONSTRUCCION, tokens: { alambre: 2, puas: 2, espino: 1 }, claves: ['30102406'] },
  { id: 'cemento_gris', rama: RAMA.CONSTRUCCION, tokens: { cemento: 2, gris: 2 }, claves: ['30111501'] },
  { id: 'cemento_blanco', rama: RAMA.CONSTRUCCION, tokens: { cemento: 2, blanco: 2 }, claves: ['30111502'] },
  { id: 'mortero_premezclado', rama: RAMA.CONSTRUCCION, tokens: { mortero: 2, premezclado: 2 }, claves: ['30111503'] },
  { id: 'yeso_construccion', rama: RAMA.CONSTRUCCION, tokens: { yeso: 2, construccion: 2 }, claves: ['30111504'] },
  { id: 'cal_hidratada', rama: RAMA.CONSTRUCCION, tokens: { cal: 2, hidratada: 2 }, claves: ['30111505'] },
  { id: 'arena_construccion', rama: RAMA.CONSTRUCCION, tokens: { arena: 2, construccion: 2 }, claves: ['30101505'] },
  { id: 'grava_construccion', rama: RAMA.CONSTRUCCION, tokens: { grava: 2, construccion: 2 }, claves: ['30101506'] },
  { id: 'piedras_brazas', rama: RAMA.CONSTRUCCION, tokens: { piedra: 2, braza: 2 }, claves: ['30101507'] },
  { id: 'tejas_barro', rama: RAMA.CONSTRUCCION, tokens: { teja: 2, barro: 2 }, claves: ['30101508'] },
  { id: 'impermeabilizante_techos', rama: RAMA.CONSTRUCCION, tokens: { impermeabilizante: 2, techo: 2 }, claves: ['30111506'] },

  // ═══════════════════════════════════════
  // PINTURAS (~40)
  // ═══════════════════════════════════════
  { id: 'pintura_vinilica', rama: RAMA.PINTURAS, tokens: { pintura: 2, vinilica: 2 }, claves: ['31211701'] },
  { id: 'pintura_esmalte', rama: RAMA.PINTURAS, tokens: { pintura: 2, esmalte: 2 }, claves: ['31211702'] },
  { id: 'pintura_acrilica', rama: RAMA.PINTURAS, tokens: { pintura: 2, acrilica: 2 }, claves: ['31211703'] },
  { id: 'pintura_aceite', rama: RAMA.PINTURAS, tokens: { pintura: 2, aceite: 2 }, claves: ['31211704'] },
  { id: 'barniz_madera', rama: RAMA.PINTURAS, tokens: { barniz: 2, madera: 2 }, claves: ['31211705'] },
  { id: 'barniz_marino', rama: RAMA.PINTURAS, tokens: { barniz: 2, marino: 2 }, claves: ['31211706'] },
  { id: 'impermeabilizante_cubiertas', rama: RAMA.PINTURAS, tokens: { impermeabilizante: 2, cubierta: 2 }, claves: ['31211707'] },
  { id: 'thinner', rama: RAMA.PINTURAS, tokens: { thinner: 2 }, claves: ['31211501'] },
  { id: 'aguarras', rama: RAMA.PINTURAS, tokens: { aguarras: 2 }, claves: ['31211502'] },
  { id: 'sellador_madera', rama: RAMA.PINTURAS, tokens: { sellador: 2, madera: 2 }, claves: ['31211708'] },
  { id: 'masilla_madera', rama: RAMA.PINTURAS, tokens: { masilla: 2, madera: 2 }, claves: ['31211709'] },
  { id: 'pintura_aerosol', rama: RAMA.PINTURAS, tokens: { pintura: 1, aerosol: 2 }, claves: ['31211710'] },
  { id: 'pintura_pisos', rama: RAMA.PINTURAS, tokens: { pintura: 2, piso: 2 }, claves: ['31211711'] },
  { id: 'pintura_anticorrosiva', rama: RAMA.PINTURAS, tokens: { pintura: 2, anticorrosiva: 2 }, claves: ['31211712'] },
  { id: 'rodillos_pintar', rama: RAMA.PINTURAS, tokens: { rodillo: 2, pintar: 2 }, claves: ['27113001'] },
  { id: 'brochas_pintar', rama: RAMA.PINTURAS, tokens: { brocha: 2, pintar: 2 }, claves: ['27113002'] },

  // ═══════════════════════════════════════
  // JARDINERIA (~35)
  // ═══════════════════════════════════════
  { id: 'mangueras_jardin', rama: RAMA.JARDINERIA, tokens: { manguera: 2, jardin: 2 }, claves: ['40142001'] },
  { id: 'mangueras_riego', rama: RAMA.JARDINERIA, tokens: { manguera: 2, riego: 2 }, claves: ['40142002'] },
  { id: 'pistolas_riego', rama: RAMA.JARDINERIA, tokens: { pistola: 2, riego: 2 }, claves: ['27112901'] },
  { id: 'aspersores_riego', rama: RAMA.JARDINERIA, tokens: { aspersor: 2, riego: 2 }, claves: ['40142003'] },
  { id: 'rociadores', rama: RAMA.JARDINERIA, tokens: { rociador: 2 }, claves: ['40142004'] },
  { id: 'conectores_manguera', rama: RAMA.JARDINERIA, tokens: { conector: 2, manguera: 2 }, claves: ['40142005'] },
  { id: 'llaves_jardin_riego', rama: RAMA.JARDINERIA, tokens: { llave: 1, jardin: 2, riego: 2 }, claves: ['40141614'] },
  { id: 'palas_picas', rama: RAMA.JARDINERIA, tokens: { pala: 2, pico: 2 }, claves: ['27112001'] },
  { id: 'palas_cuadradas', rama: RAMA.JARDINERIA, tokens: { pala: 2, cuadrada: 2 }, claves: ['27112002'] },
  { id: 'azadones', rama: RAMA.JARDINERIA, tokens: { azadon: 2 }, claves: ['27112003'] },
  { id: 'rastrillos', rama: RAMA.JARDINERIA, tokens: { rastrillo: 2 }, claves: ['27112004'] },
  { id: 'carretillas', rama: RAMA.JARDINERIA, tokens: { carretilla: 2 }, claves: ['27112005'] },
  { id: 'tijeras_podar', rama: RAMA.JARDINERIA, tokens: { tijera: 2, podar: 2 }, claves: ['27112006'] },
  { id: 'cortasetos', rama: RAMA.JARDINERIA, tokens: { cortasetos: 2 }, claves: ['27112007'] },

  // ═══════════════════════════════════════
  // SEGURIDAD (~25)
  // ═══════════════════════════════════════
  { id: 'cascos_seguridad', rama: RAMA.SEGURIDAD, tokens: { casco: 2, seguridad: 2 }, claves: ['46181701'] },
  { id: 'guantes_trabajo', rama: RAMA.SEGURIDAD, tokens: { guante: 2, trabajo: 2 }, claves: ['46181702'] },
  { id: 'guantes_latex', rama: RAMA.SEGURIDAD, tokens: { guante: 2, latex: 2 }, claves: ['46181703'] },
  { id: 'guantes_carnaza', rama: RAMA.SEGURIDAD, tokens: { guante: 2, carnaza: 2 }, claves: ['46181704'] },
  { id: 'lentes_seguridad', rama: RAMA.SEGURIDAD, tokens: { lente: 2, seguridad: 2 }, claves: ['46181705'] },
  { id: 'caretas_soldar', rama: RAMA.SEGURIDAD, tokens: { careta: 2, soldar: 2 }, claves: ['46181706'] },
  { id: 'arneses_seguridad', rama: RAMA.SEGURIDAD, tokens: { arnes: 2, seguridad: 2 }, claves: ['46181707'] },
  { id: 'botas_seguridad', rama: RAMA.SEGURIDAD, tokens: { bota: 2, seguridad: 2 }, claves: ['46181501'] },
  { id: 'chalecos_reflejantes', rama: RAMA.SEGURIDAD, tokens: { chaleco: 2, reflejante: 2 }, claves: ['46181502'] },
  { id: 'conos_seguridad', rama: RAMA.SEGURIDAD, tokens: { cono: 2, seguridad: 2 }, claves: ['46181503'] },
  { id: 'extintores_incendio', rama: RAMA.SEGURIDAD, tokens: { extintor: 2, incendio: 2 }, claves: ['46191501'] },
  { id: 'alarmas_seguridad', rama: RAMA.SEGURIDAD, tokens: { alarma: 2, seguridad: 2 }, claves: ['46171605'] },

  // ═══════════════════════════════════════
  // VARIOS (~30)
  // ═══════════════════════════════════════
  { id: 'pegamentos_adhesivos', rama: RAMA.VARIOS, tokens: { pegamento: 2, adhesivo: 2 }, claves: ['31201601'] },
  { id: 'silicon_caliente', rama: RAMA.VARIOS, tokens: { silicon: 2, caliente: 2 }, claves: ['31201602'] },
  { id: 'silicon_frio', rama: RAMA.VARIOS, tokens: { silicon: 2, frio: 2 }, claves: ['31201603'] },
  { id: 'pegamento_pvc', rama: RAMA.VARIOS, tokens: { pegamento: 2, pvc: 2 }, claves: ['31201604'] },
  { id: 'pegamento_contacto', rama: RAMA.VARIOS, tokens: { pegamento: 2, contacto: 2 }, claves: ['31201605'] },
  { id: 'cinta_maskin', rama: RAMA.VARIOS, tokens: { cinta: 2, maskin: 2, enmascarar: 1 }, claves: ['31201501'] },
  { id: 'cinta_aislante', rama: RAMA.VARIOS, tokens: { cinta: 2, aislante: 2 }, claves: ['31201502'] },
  { id: 'cinta_doble_cara', rama: RAMA.VARIOS, tokens: { cinta: 2, doble: 2, cara: 2 }, claves: ['31201503'] },
  { id: 'cinta_canela', rama: RAMA.VARIOS, tokens: { cinta: 2, canela: 2 }, claves: ['31201504'] },
  { id: 'selladores_silicon', rama: RAMA.VARIOS, tokens: { sellador: 2, silicon: 2 }, claves: ['31201606'] },
  { id: 'lijas_agua', rama: RAMA.VARIOS, tokens: { lija: 2, agua: 2 }, claves: ['31191501'] },
  { id: 'lijas_hierro', rama: RAMA.VARIOS, tokens: { lija: 2, hierro: 2 }, claves: ['31191502'] },
  { id: 'discos_corte_metal', rama: RAMA.VARIOS, tokens: { disco: 2, corte: 2, metal: 1 }, claves: ['31191503'] },
  { id: 'discos_desbaste', rama: RAMA.VARIOS, tokens: { disco: 2, desbaste: 2 }, claves: ['31191504'] },
  { id: 'discos_diamante', rama: RAMA.VARIOS, tokens: { disco: 2, diamante: 2 }, claves: ['31191505'] },
  { id: 'cepillos_alambre', rama: RAMA.VARIOS, tokens: { cepillo: 2, alambre: 2 }, claves: ['27113003'] },
  { id: 'esponjas', rama: RAMA.VARIOS, tokens: { esponja: 2 }, claves: ['47131601'] },
  { id: 'jaladores_manguera', rama: RAMA.VARIOS, tokens: { jalador: 2, manguera: 2 }, claves: ['40142006'] },
];

// Combinar todas las familias
const FAMILIAS_TOTALES = [...FAMILIAS, ...FAMILIAS_NUEVAS, ...FAMILIAS_AUTO];

// ── Asignar rama a familias existentes que no la tienen ──
for (const f of FAMILIAS_TOTALES) {
  if (!f.rama) f.rama = ramaDeFamilia(f);
}

// ---------------------------------------------------------------------------

/** Variantes singulares de un token: "cinchos" -> ["cinchos","cincho"], "llaves" -> ["llaves","llave","llav"]. */
function variantes(token) {
  const v = [token];
  if (token.length > 3 && token.endsWith('s')) v.push(token.slice(0, -1));
  if (token.length > 5 && token.endsWith('es')) v.push(token.slice(0, -2));
  return v;
}

function coincide(tokenProducto, base) {
  return variantes(tokenProducto).includes(base);
}

/**
 * Detecta familias activas para un conjunto de tokens normalizados.
 *
 * @param {string[]} tokens - tokens de sat.normalizador.js
 * @returns {Array<{ id: string, puntaje: number, claves: string[] }>}
 *          ordenadas por puntaje descendente; solo las que alcanzan
 *          UMBRAL_FAMILIA.
 */
function detectarFamilias(tokens) {
  const resultados = [];
  for (const familia of FAMILIAS_TOTALES) {
    // Tokens obligatorios: si la familia los declara, TODOS deben estar
    // presentes o la familia no activa (evita que un token especializador
    // como "corte" active la familia sin su ancla "disco").
    if (Array.isArray(familia.requiere)) {
      const cumple = familia.requiere.every((req) => tokens.some((t) => coincide(t, req)));
      if (!cumple) continue;
    }
    // Al menos uno de estos tokens debe estar presente. Es util para
    // familias con un ancla variable: rodillo/felpa, masking/enmascarar, etc.
    if (Array.isArray(familia.requiereAlguno)) {
      const cumpleAlguno = familia.requiereAlguno.some((req) => tokens.some((t) => coincide(t, req)));
      if (!cumpleAlguno) continue;
    }
    // Tokens de exclusión: si alguno está presente, la familia no activa
    // (ej. "alambre galvanizado" no es cable eléctrico).
    if (Array.isArray(familia.excluye)) {
      const excluido = familia.excluye.some((ex) => tokens.some((t) => coincide(t, ex)));
      if (excluido) continue;
    }
    let puntaje = 0;
    for (const [base, peso] of Object.entries(familia.tokens)) {
      if (peso <= 0) continue;
      if (tokens.some((t) => coincide(t, base))) puntaje += peso;
    }
    if (puntaje >= UMBRAL_FAMILIA) {
      resultados.push({
        id: familia.id,
        puntaje,
        claves: familia.claves.slice(),
        certificada: familia.certificada === true,
        rama: familia.rama,
      });
    }
  }
  resultados.sort((a, b) => b.puntaje - a.puntaje);
  return resultados;
}

/**
 * Evalúa ambigüedad crítica.
 *
 * @param {string[]} tokens
 * @returns {{ ambiguo: boolean, termino: string|null }}
 */
function esAmbiguo(tokens) {
  for (const [termino, desambiguadores] of Object.entries(AMBIGUOS)) {
    const presente = tokens.some((t) => coincide(t, termino));
    if (!presente) continue;
    const resuelto = desambiguadores.some((d) => tokens.some((t) => coincide(t, d)));
    if (!resuelto) return { ambiguo: true, termino };
  }
  return { ambiguo: false, termino: null };
}

// Mapa inverso clave -> familias, para el gate de contradicción.
const _clavesAFamilias = new Map();
for (const familia of FAMILIAS_TOTALES) {
  for (const clave of familia.claves) {
    if (!_clavesAFamilias.has(clave)) _clavesAFamilias.set(clave, []);
    _clavesAFamilias.get(clave).push(familia.id);
  }
}

/**
 * Familias a las que pertenece una clave según el diccionario.
 * Vacío si la clave no está mapeada (no implica error: el diccionario
 * solo cubre lo confirmado).
 */
function familiasDeClave(claveSat) {
  return _clavesAFamilias.get(claveSat) || [];
}

module.exports = {
  UMBRAL_FAMILIA,
  FAMILIAS,
  FAMILIAS_TOTALES,
  AMBIGUOS,
  detectarFamilias,
  esAmbiguo,
  familiasDeClave,
  variantes,
  coincide,
};
