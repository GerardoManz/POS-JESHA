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
  },
  {
    id: 'cinchos',
    tokens: { cincho: 2 },
    claves: ['39121703'],
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
    excluye: ['presion'],
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
    claves: ['31161500'],
  },
  {
    id: 'pernos',
    tokens: { perno: 2 },
    claves: ['31161600'],
  },
  {
    id: 'focos_lamparas',
    tokens: { foco: 2, bombilla: 2, lampara: 2, led: 1 },
    claves: ['39101600'],
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
    id: 'valvulas',
    tokens: { valvula: 2, llave: 1, esfera: 1, paso: 1, compuerta: 1, angular: 1, check: 1 },
    claves: ['40141600'],
  },
  {
    id: 'selladores_adhesivos',
    tokens: { silicon: 2, sellador: 2, adhesivo: 2, pegamento: 2, resistol: 1 },
    claves: ['31201600'],
  },
  {
    id: 'seguetas_arcos',
    tokens: { segueta: 2, sierra: 1 },
    claves: ['27111559'],
  },
  {
    id: 'tinacos_tanques',
    tokens: { tinaco: 2, cisterna: 1, tanque: 1 },
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
    tokens: { conector: 2, conexion: 1, cople: 2, acople: 2, pvc: 2, tubo: 1 },
    requiereAlguno: ['conector', 'cople', 'acople'],
    requiere: ['pvc'],
    excluye: ['cpvc'],
    claves: ['40172508'],
    certificada: true,
  },
  {
    id: 'conectores_tubo_cpvc',
    tokens: { conector: 2, conexion: 1, cople: 2, acople: 2, cpvc: 2, tubo: 1 },
    requiereAlguno: ['conector', 'cople', 'acople'],
    requiere: ['cpvc'],
    claves: ['40172509'],
    certificada: true,
  },
  {
    id: 'tubos_pvc',
    tokens: { tubo: 2, pvc: 2, tramo: 1 },
    requiere: ['tubo', 'pvc'],
    excluye: ['cpvc'],
    claves: ['40171517'],
    certificada: true,
  },
  {
    id: 'tubos_cpvc',
    tokens: { tubo: 2, cpvc: 2, tramo: 1 },
    requiere: ['tubo', 'cpvc'],
    claves: ['40171518'],
    certificada: true,
  },
  {
    id: 'tubos_cobre',
    tokens: { tubo: 2, cobre: 2 },
    requiere: ['tubo', 'cobre'],
    claves: ['40171511'],
    certificada: true,
  },
  {
    id: 'cemento_construccion',
    tokens: { cemento: 2, gris: 1, bulto: 1 },
    requiere: ['cemento'],
    excluye: ['disolvente', 'pegamento', 'pvc', 'cpvc'],
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
    claves: ['31211909'],
    certificada: true,
  },
  // ---- Familias sin clave confirmada todavía (solo gate + acotación) ----
  {
    id: 'plomeria_conexiones',
    tokens: { codo: 2, tee: 2, cople: 2, niple: 2, reduccion: 2, conexion: 1, yee: 2, ppr: 2 },
    claves: [],
  },
  {
    id: 'brocas',
    tokens: { broca: 2 },
    claves: [],
  },
  {
    id: 'cepillos',
    tokens: { cepillo: 2 },
    claves: [],
  },
  {
    id: 'griferia',
    tokens: { mezcladora: 2, monomando: 2, regadera: 2, grifo: 2, lavabo: 1 },
    claves: [],
  },
  {
    id: 'herramientas_manuales',
    tokens: { perica: 2, martillo: 2, pinza: 2, alicate: 2, allen: 2, matraca: 2, dado: 1, llave: 1, combinada: 1, espanola: 1, mixta: 1 },
    claves: [],
  },
  {
    id: 'pinturas_recubrimientos',
    tokens: { pintura: 1, vinilica: 2, esmalte: 2, impermeabilizante: 2, barniz: 2, primario: 1 },
    claves: [],
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
    claves: [],
  },
  {
    id: 'mangueras',
    tokens: { manguera: 2, jardin: 1 },
    claves: [],
  },
  {
    id: 'cementos_morteros',
    tokens: { cemento: 2, mortero: 2, yeso: 2 },
    claves: [],
  },
  // ---- Familias lote 2 (2026-07-03): alta frecuencia en productos sin familia ----
  {
    id: 'lijas_abrasivos',
    tokens: { lija: 2, abrasivo: 2, esmeril: 2, grano: 1 },
    requiereAlguno: ['lija', 'abrasivo', 'esmeril'],
    claves: ['31191500'],
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
  },
  {
    id: 'remaches',
    tokens: { remache: 2, roblon: 1 },
    claves: ['31162200'],
  },
  {
    id: 'tuercas_arandelas',
    tokens: { tuerca: 2, rondana: 2, arandela: 2, golilla: 1 },
    claves: ['31161800'],
  },
  {
    id: 'extensiones_electricas',
    tokens: { extension: 2, multicontacto: 2, supresor: 1 },
    claves: ['39121440'],
  },
  {
    id: 'navajas_cutter',
    tokens: { navaja: 2, cutter: 2, exacto: 1, cuchillo: 1 },
    requiereAlguno: ['navaja', 'cutter', 'exacto'],
    excluye: ['cocina', 'comer', 'cubierto', 'carne', 'pan'],
    claves: ['27111503'],
  },
  {
    id: 'esmeriladoras_pulidoras',
    tokens: { esmeriladora: 2, pulidora: 2, esmeril: 1, minigrinder: 1 },
    claves: ['23101506'],
  },
  {
    id: 'escaleras',
    tokens: { escalera: 2, tijera: 1, peldano: 1 },
    excluye: ['mecanica', 'electrica', 'cinta', 'rodante'],
    claves: ['30191501'],
  },
  {
    id: 'calentadores_agua',
    tokens: { boiler: 2, calentador: 2, paso: 1, gas: 1 },
    claves: ['40101825'],
  },
  {
    id: 'empaques',
    tokens: { empaque: 2, empaquetadura: 2, junta: 1, sello: 1 },
    excluye: ['papel', 'caja', 'carton', 'plastico', 'alimento'],
    claves: ['31181701'],
  },
  {
    id: 'tapones_tuberia',
    tokens: { tapon: 2, capa: 1, hembra: 1, pvc: 1, cpvc: 1 },
    claves: ['40173500'],
  },
  {
    id: 'conectores_electricos',
    tokens: { conector: 1, electrico: 1, cable: 1, alambre: 1, terminal: 1, ficha: 1 },
    requiere: ['conector'],
    excluye: ['manguera', 'tubo', 'pvc', 'cpvc', 'cobre', 'hidraulico'],
    claves: ['39121409'],
  },
  {
    id: 'enchufes_clavijas',
    tokens: { clavija: 2, enchufe: 2, adaptador: 1, ficha: 1, hembra: 1 },
    claves: ['39121402'],
  },
  {
    id: 'interruptores_apagadores',
    tokens: { apagador: 2, interruptor: 2, switch: 1, boton: 1 },
    excluye: ['circuito', 'tablero', 'termico', 'magnetico', 'presion', 'flotador', 'seguridad'],
    claves: ['39122200'],
  },
  {
    id: 'sierras_serruchos',
    tokens: { serrucho: 2, sierra: 2, triscado: 1, podar: 1 },
    excluye: ['cinta', 'mecanica', 'electrica', 'circular', 'mesa', 'calar', 'cinta', 'cinta', 'caladora'],
    claves: ['27111508'],
  },
  {
    id: 'flexometros_medicion',
    tokens: { flexometro: 2, metro: 1, cinta: 1, medir: 1, metrica: 1 },
    requiereAlguno: ['flexometro'],
    excluye: ['lija', 'abrasivo', 'teflon', 'aislante', 'masking', 'enmascarar', 'antiderrapante', 'doble', 'montaje', 'señalar', 'barricada', 'precaucion'],
    claves: ['27111801'],
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
    claves: [],
  },
  {
    id: 'poliducto',
    tokens: { poliducto: 2, conducto: 1, corrugado: 1, electrico: 1 },
    claves: [],
  },
  {
    id: 'cintas_transparente',
    tokens: { cinta: 2, transparente: 2, polipropileno: 1 },
    requiere: ['cinta', 'transparente'],
    claves: ['31201512'],
  },
  {
    id: 'jaladeras_tiradores',
    tokens: { jaladera: 2, tirador: 2, manija: 1, pomo: 1, chapa: 1 },
    claves: ['31162801'],
  },
  {
    id: 'tapon_capa_hembra',
    tokens: { capa: 2, hembra: 1, macho: 1, reduccion: 1, bushing: 1 },
    requiere: ['capa'],
    claves: [],
  },
  // ---- Familias lote 3 (2026-07-03): siguientes mayores frecuencias ----
  {
    id: 'placas_contactos',
    tokens: { placa: 2, contacto: 2, apagador: 1, interruptor: 1, duplex: 1, toma: 1, tomacorriente: 1, aterrizado: 1 },
    requiere: ['placa'],
    excluye: ['acero', 'metalico', 'metal', 'aluminio', 'laton', 'zinc', 'fierro', 'hierro', 'tornillo', 'bisagra'],
    claves: ['39122200'],
  },
  {
    id: 'grapas',
    tokens: { grapa: 2, engrapadora: 1 },
    claves: ['31162000'],
  },
  {
    id: 'niveles_plomadas',
    tokens: { nivel: 2, plomada: 2, burbuja: 1, tiralineas: 1, pendiente: 1 },
    claves: ['27111822'],
  },
  {
    id: 'soldadura_electrodos',
    tokens: { soldadura: 2, soldar: 2, electrodo: 2, suelda: 1, flux: 1, tungsteno: 1, varilla: 1 },
    claves: [],
  },
  {
    id: 'cuerdas_piolas',
    tokens: { cuerda: 2, piola: 2, mecate: 2, hilo: 1, nylon: 1 },
    excluye: ['zapato', 'bota', 'tenis', 'calzado', 'guitarra', 'pescar'],
    claves: ['31151500'],
  },
  {
    id: 'mallas_alambre',
    tokens: { malla: 2, ciclon: 2, alambre: 1, acero: 1 },
    requiereAlguno: ['malla', 'ciclon'],
    excluye: ['pescar', 'padel', 'deportiva', 'tenis', 'futbol', 'protector', 'mosquitera'],
    claves: [],
  },
  {
    id: 'coladeras_desagues',
    tokens: { coladera: 2, desague: 2, rejilla: 1, drenaje: 1, piso: 1 },
    claves: [],
  },
  {
    id: 'caretas_proteccion',
    tokens: { careta: 2, lente: 1, proteccion: 1, seguridad: 1, soldar: 1, mascarilla: 1 },
    claves: ['46181700'],
  },
  {
    id: 'fregaderos_tarjas',
    tokens: { fregadero: 2, tarja: 2, lavabo: 1 },
    claves: [],
  },
  {
    id: 'limas_escofinas',
    tokens: { lima: 2, escofina: 2, limaton: 1 },
    excluye: ['factor', 'tiempo', 'produccion', 'cadena', 'control', 'limon', 'fruta'],
    claves: [],
  },
  {
    id: 'cucharas_llanas',
    tokens: { cuchara: 2, llana: 2, plana: 1, albanil: 1, construccion: 1 },
    excluye: ['cocina', 'comer', 'mesa', 'sopa', 'postre', 'cafe', 'taza'],
    claves: [],
  },
  {
    id: 'timbres_campanas',
    tokens: { timbre: 2, campana: 1, llamador: 1, chicharra: 1 },
    claves: ['39122200'],
  },
  {
    id: 'armellas_ganchos',
    tokens: { armella: 2, gancho: 1, escarpia: 1, ojo: 1 },
    claves: [],
  },
  {
    id: 'boquillas_accesorios',
    tokens: { boquilla: 2, pistola: 1, calor: 1, aire: 1, silicon: 1 },
    claves: [],
  },
  {
    id: 'accesorios_cable_acero',
    tokens: { cable: 1, acero: 1, perro: 2, nudo: 2, guardacabo: 2, tensor: 1, canastilla: 1 },
    requiere: ['cable'],
    claves: ['31162800'],
  },
  {
    id: 'taladros_rotomartillos',
    tokens: { taladro: 2, rotomartillo: 2, percutor: 2, inalambrico: 1 },
    claves: ['27112700'],
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
  for (const familia of FAMILIAS) {
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
for (const familia of FAMILIAS) {
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
  AMBIGUOS,
  detectarFamilias,
  esAmbiguo,
  familiasDeClave,
  variantes,
  coincide,
};
