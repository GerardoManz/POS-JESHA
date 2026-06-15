'use strict';

/**
 * Evaluador offline del matcher SAT (Fase 6).
 *
 * NO se conecta a la base de datos. Lee un CSV exportado desde DBeaver
 * con la consulta controlada (contrato de columnas snake_case):
 *
 *   id,codigo_interno,codigo_barras,nombre,descripcion,clave_sat,
 *   unidad_sat,unidad_venta,es_granel,categoria_id,activo
 *
 * Uso:
 *   node scripts/sat/evaluar_matcher.js <productos.csv> [claves_bd.csv] [tamMuestra]
 *
 * Genera tres archivos junto al CSV de entrada:
 *   1. <entrada>.distribucion.txt        Panorama global (salida B):
 *      estados, MANUAL por razón (fallo real vs dato sucio), calidad de
 *      la BD actual, top claves sugeridas/AUTO/SUGERIR, familias.
 *   2. <entrada>.muestra_estratificada.csv  Métrica real: muestra
 *      ALEATORIA REPRODUCIBLE por estrato (seed fija). Sobre su columna
 *      correcto_manual se calcula la precisión. NO sesgada.
 *   3. <entrada>.muestra_priorizada.csv   Auditoría: prioriza AUTO y
 *      desacuerdos con BD para encontrar errores rápido. NO es métrica.
 *
 * Reglas (confirmadas en auditoría):
 *   - Solo se evalúan productos con activo = 1.
 *   - categoria_id NO se usa como señal (ruido confirmado).
 *   - El producto bajo evaluación se EXCLUYE de productosExistentes.
 *   - La clave actual de la BD es señal débil (~60-70%), se reporta como
 *     coincide_bd pero NUNCA como verdad.
 */

const fs = require('fs');
const matcher = require('../../src/modules/productos/sat.matcher');
const listas = require('../../src/modules/productos/sat.listas');

// ---------------------------------------------------------------------------
// Parser CSV tolerante (comillas, escapadas, saltos internos, BOM)
// ---------------------------------------------------------------------------

function parsearCSV(texto) {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  const filas = [];
  let campo = '';
  let fila = [];
  let enComillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 1; }
        else enComillas = false;
      } else campo += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ',') {
      fila.push(campo); campo = '';
    } else if (c === '\n') {
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else if (c === '\r') {
      // ignorar
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas;
}

function leerProductos(ruta) {
  const filas = parsearCSV(fs.readFileSync(ruta, 'utf8'));
  if (filas.length === 0) throw new Error('CSV vacío');
  const header = filas[0].map((h) => h.trim());
  const col = (n) => header.indexOf(n);
  for (const obligatoria of ['id', 'nombre', 'clave_sat', 'unidad_sat', 'unidad_venta', 'es_granel', 'activo']) {
    if (col(obligatoria) === -1) throw new Error(`Columna faltante: ${obligatoria}. Header: ${header.join(',')}`);
  }
  const i = {
    id: col('id'), ci: col('codigo_interno'), cb: col('codigo_barras'),
    nombre: col('nombre'), desc: col('descripcion'), clave: col('clave_sat'),
    unidad: col('unidad_sat'), uventa: col('unidad_venta'), granel: col('es_granel'),
    cat: col('categoria_id'), activo: col('activo'),
  };
  const productos = [];
  for (let k = 1; k < filas.length; k += 1) {
    const f = filas[k];
    if (f.length === 1 && f[0] === '') continue;
    const g = (idx) => (idx === -1 ? '' : (f[idx] || ''));
    productos.push({
      id: g(i.id),
      codigoInterno: g(i.ci),
      codigoBarras: g(i.cb),
      nombre: g(i.nombre),
      descripcion: g(i.desc),
      claveSat: g(i.clave).trim(),
      unidadSat: g(i.unidad).trim().toUpperCase(),
      unidadVenta: g(i.uventa).trim(),
      esGranel: g(i.granel) === '1' || g(i.granel).toLowerCase() === 'true',
      categoriaId: g(i.cat),
      activo: g(i.activo) === '1' || g(i.activo).toLowerCase() === 'true',
    });
  }
  return productos;
}

function leerFrecuencias(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return null;
  const filas = parsearCSV(fs.readFileSync(ruta, 'utf8'));
  if (filas.length === 0) return null;
  const header = filas[0].map((h) => h.trim());
  const iClave = header.indexOf('claveSat');
  const iTotal = header.indexOf('total_productos');
  if (iClave === -1) return null;
  const freq = {};
  for (let k = 1; k < filas.length; k += 1) {
    const clave = (filas[k][iClave] || '').trim();
    if (clave === '') continue;
    const total = iTotal === -1 ? 1 : parseInt(filas[k][iTotal], 10) || 0;
    freq[clave] = (freq[clave] || 0) + total;
  }
  return freq;
}

// ---------------------------------------------------------------------------
// Clasificación de razón MANUAL
// ---------------------------------------------------------------------------

function razonManual(resultado) {
  const texto = (resultado.razones || []).join(' | ').toLowerCase();
  if (texto.includes('granel') && texto.includes('contradictorio')) return 'MANUAL_GRANEL_CONTRADICTORIO';
  if (texto.includes('granel sin unidad')) return 'MANUAL_GRANEL_SIN_UNIDAD';
  if (texto.includes('fuera de whitelist') || texto.includes('no reconocida')) return 'MANUAL_UNIDAD_NO_OPERATIVA';
  if (texto.includes('ambiguo') || texto.includes('término ambiguo')) return 'MANUAL_AMBIGUO';
  if (texto.includes('sin candidatos')) return 'MANUAL_SIN_CANDIDATOS';
  if (texto.includes('confianza insuficiente')) return 'MANUAL_CONFIANZA_BAJA';
  return 'MANUAL_OTRO';
}

const MANUAL_NO_ES_FALLO = new Set([
  'MANUAL_GRANEL_CONTRADICTORIO',
  'MANUAL_GRANEL_SIN_UNIDAD',
  'MANUAL_UNIDAD_NO_OPERATIVA',
]);

// ---------------------------------------------------------------------------
// PRNG reproducible (mulberry32) para muestra estratificada determinista
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  return function rng() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajarReproducible(arr, seed) {
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------

function evaluarUno(prod, todosExistentes, frecuencias) {
  const existentes = todosExistentes.filter((p) => p.id !== prod.id);
  return matcher.sugerirSat(
    {
      nombre: prod.nombre,
      descripcion: prod.descripcion,
      esGranel: prod.esGranel,
      unidadVenta: prod.unidadVenta,
      productosExistentes: existentes,
    },
    { diagnostico: true, frecuencias }
  );
}

function csvCampo(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNAS_MUESTRA = [
  'id', 'codigo_interno', 'codigo_barras', 'nombre', 'descripcion',
  'unidad_venta', 'es_granel', 'categoria_id',
  'clave_bd', 'unidad_bd', 'clave_sugerida', 'estado', 'score',
  'unidad_sugerida', 'familia', 'razon_manual', 'candidatos_top3',
  'coincide_bd', 'correcto_manual',
];

function filaMuestra(item) {
  const { prod, res, claveSugerida, coincide, razonM } = item;
  const fam = (res.razones.find((r) => r.startsWith('Familia detectada:')) || '').replace('Familia detectada: ', '');
  const top3 = res.candidatos.map((c) => `${c.claveSat}:${c.score}`).join(' ');
  return [
    prod.id, prod.codigoInterno, prod.codigoBarras, prod.nombre, prod.descripcion,
    prod.unidadVenta, prod.esGranel ? '1' : '0', prod.categoriaId,
    prod.claveSat, prod.unidadSat, claveSugerida, res.estado, res.confianza,
    res.unidadSat || '', fam, razonM, top3, coincide ? 'SI' : 'NO', '',
  ].map(csvCampo).join(',');
}

function calidadBd(activos) {
  let hardBlock = 0, noAuto = 0, fueraWhitelist = 0, granelContra = 0, granelSinUnidad = 0;
  for (const p of activos) {
    if (p.claveSat && listas.esHardBlock(p.claveSat)) hardBlock += 1;
    if (p.claveSat && listas.NO_AUTO.has(p.claveSat)) noAuto += 1;
    if (p.unidadSat && !listas.esUnidadOperativa(p.unidadSat)) fueraWhitelist += 1;
    if (p.esGranel) {
      const uv = (p.unidadVenta || '').toLowerCase();
      // Mismo criterio que el matcher: mapear la unidad de venta y ver si
      // cae en una unidad de granel válida (KGM/MTR/LTR). Fuente única.
      const mapeada = uv === '' ? null : (matcher.MAPA_UNIDAD_VENTA[uv] || null);
      if (uv === '') granelSinUnidad += 1;
      else if (mapeada === null || !matcher.UNIDADES_GRANEL.has(mapeada)) granelContra += 1;
    }
  }
  return { hardBlock, noAuto, fueraWhitelist, granelContra, granelSinUnidad };
}

function main() {
  const rutaProductos = process.argv[2];
  const rutaFrecuencias = process.argv[3] && !/^\d+$/.test(process.argv[3]) ? process.argv[3] : null;
  const tamMuestra = parseInt(process.argv[4] || process.argv[3], 10) || 200;
  const SEED = 20260615;

  if (!rutaProductos || !fs.existsSync(rutaProductos)) {
    console.error('Uso: node scripts/sat/evaluar_matcher.js <productos.csv> [claves_bd.csv] [tamMuestra]');
    process.exit(1);
  }

  console.log('Cargando índice SAT...');
  matcher.cargarIndice();

  console.log('Leyendo productos...');
  const todos = leerProductos(rutaProductos);
  const activos = todos.filter((p) => p.activo);
  console.log(`Total: ${todos.length} | Activos: ${activos.length}`);

  const frecuencias = leerFrecuencias(rutaFrecuencias);
  console.log(frecuencias ? `Frecuencias cargadas: ${Object.keys(frecuencias).length} claves` : 'Sin archivo de frecuencias');

  console.log('Evaluando todos los activos (puede tardar)...');
  const inicio = Date.now();
  const resultados = [];
  const dist = { AUTO: 0, SUGERIR: 0, MANUAL: 0 };
  const manualPorRazon = {};
  const familiaDist = {};
  const clavesPorEstado = { TODAS: {}, AUTO: {}, SUGERIR: {} };
  let coincideBd = 0;
  let evaluables = 0;

  for (let k = 0; k < activos.length; k += 1) {
    const prod = activos[k];
    const res = evaluarUno(prod, activos, frecuencias);
    dist[res.estado] += 1;
    const razonM = res.estado === 'MANUAL' ? razonManual(res) : '';
    if (razonM) manualPorRazon[razonM] = (manualPorRazon[razonM] || 0) + 1;

    const fam = (res.razones.find((r) => r.startsWith('Familia detectada:')) || '').replace('Familia detectada: ', '') || '(sin familia)';
    familiaDist[fam] = (familiaDist[fam] || 0) + 1;

    const claveSugerida = res.claveSat || (res.candidatos[0] && res.candidatos[0].claveSat) || '';
    if (claveSugerida !== '') {
      clavesPorEstado.TODAS[claveSugerida] = (clavesPorEstado.TODAS[claveSugerida] || 0) + 1;
      if (res.estado === 'AUTO') clavesPorEstado.AUTO[claveSugerida] = (clavesPorEstado.AUTO[claveSugerida] || 0) + 1;
      if (res.estado === 'SUGERIR') clavesPorEstado.SUGERIR[claveSugerida] = (clavesPorEstado.SUGERIR[claveSugerida] || 0) + 1;
    }
    const coincide = claveSugerida !== '' && claveSugerida === prod.claveSat;
    if (claveSugerida !== '') { evaluables += 1; if (coincide) coincideBd += 1; }

    resultados.push({ prod, res, claveSugerida, coincide, razonM, estrato: res.estado === 'MANUAL' ? razonM : res.estado });
    if ((k + 1) % 500 === 0) console.log(`  ${k + 1}/${activos.length}  (${((Date.now() - inicio) / 1000).toFixed(0)}s)`);
  }
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  // ----- Salida B: distribución -----
  const cal = calidadBd(activos);
  const pct = (n) => `${((n / activos.length) * 100).toFixed(1)}%`;
  const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

  const L = [];
  L.push('=== DISTRIBUCIÓN GLOBAL (salida B) ===');
  L.push(`Generado: ${new Date().toISOString()}`);
  L.push(`Activos evaluados: ${activos.length}  |  Tiempo: ${segundos}s  |  Seed muestra: ${SEED}`);
  L.push('');
  L.push('Estados:');
  L.push(`  AUTO:    ${dist.AUTO}  (${pct(dist.AUTO)})`);
  L.push(`  SUGERIR: ${dist.SUGERIR}  (${pct(dist.SUGERIR)})`);
  L.push(`  MANUAL:  ${dist.MANUAL}  (${pct(dist.MANUAL)})`);
  L.push('');
  L.push('MANUAL por razón:');
  let manualDatoSucio = 0, manualReal = 0;
  for (const [razon, n] of Object.entries(manualPorRazon).sort((a, b) => b[1] - a[1])) {
    const etq = MANUAL_NO_ES_FALLO.has(razon) ? '(dato sucio/no operativo)' : '(abstención del matcher)';
    L.push(`  ${razon.padEnd(28)} ${String(n).padStart(5)}  ${etq}`);
    if (MANUAL_NO_ES_FALLO.has(razon)) manualDatoSucio += n; else manualReal += n;
  }
  L.push(`  -> MANUAL por dato sucio/no operativo: ${manualDatoSucio}  (NO es fallo del matcher)`);
  L.push(`  -> MANUAL por abstención legítima:     ${manualReal}`);
  L.push('');
  L.push('Calidad de la BD actual (contexto, no métrica del matcher):');
  L.push(`  Hard block activos:           ${cal.hardBlock}`);
  L.push(`  NO_AUTO activos:              ${cal.noAuto}`);
  L.push(`  Unidad SAT fuera whitelist:   ${cal.fueraWhitelist}`);
  L.push(`  Granel con unidad contradict: ${cal.granelContra}`);
  L.push(`  Granel sin unidad de venta:   ${cal.granelSinUnidad}`);
  L.push('');
  L.push('Coincidencia con BD actual (SEÑAL DÉBIL, no verdad fiscal):');
  L.push(`  Con clave sugerida visible: ${evaluables}`);
  L.push(`  Coinciden con clave BD:     ${coincideBd}  (${evaluables ? ((coincideBd / evaluables) * 100).toFixed(1) : 0}%)`);
  L.push('  NOTA: la BD está ~30-40% contaminada; esta cifra NO es precisión real.');
  L.push('        La precisión real sale de correcto_manual en la muestra estratificada.');
  L.push('');
  L.push('Top 15 claves sugeridas GLOBAL (vigilar concentración tipo 31162800):');
  for (const [clave, n] of topN(clavesPorEstado.TODAS, 15)) L.push(`  ${clave}  ${n}  (${pct(n)})`);
  L.push('');
  L.push('Top 10 claves en AUTO (un error aquí va directo a factura):');
  for (const [clave, n] of topN(clavesPorEstado.AUTO, 10)) L.push(`  ${clave}  ${n}`);
  L.push('');
  L.push('Top 10 claves en SUGERIR:');
  for (const [clave, n] of topN(clavesPorEstado.SUGERIR, 10)) L.push(`  ${clave}  ${n}`);
  L.push('');
  L.push('Top 20 familias detectadas:');
  for (const [fam, n] of topN(familiaDist, 20)) L.push(`  ${fam.padEnd(30)} ${n}`);
  L.push('');
  L.push('=== CÓMO MEDIR (llenar columna correcto_manual: SI/NO/DUDOSO) ===');
  L.push('  Precisión GLOBAL  -> muestra_estratificada.csv (aprox. proporcional por estrato, reproducible)');
  L.push('  Precisión de AUTO -> muestra_auto.csv (todos los AUTO hasta 500; métrica fiscal)');
  L.push('  Auditoría rápida  -> muestra_priorizada.csv (AUTO y desacuerdos; NO es métrica)');
  L.push('  Precisión = SI / (SI + NO). Los DUDOSO se reportan aparte, no cuentan en el denominador.');
  const rutaDist = rutaProductos.replace(/\.csv$/i, '') + '.distribucion.txt';
  fs.writeFileSync(rutaDist, L.join('\n'));

  // Estratos
  const estratos = {};
  for (const item of resultados) (estratos[item.estrato] = estratos[item.estrato] || []).push(item);
  const nombresEstratos = Object.keys(estratos);

  // ----- Salida A1: muestra ESTRATIFICADA reproducible (métrica global) -----
  // Aproximadamente PROPORCIONAL por estrato (cuota redondeada, mínimo 1
  // por estrato), aleatoria con seed fija. Mide precisión GLOBAL. La
  // precisión de AUTO NO se mide aquí: sale de muestra_auto.csv (todos los
  // AUTO hasta 500), para no sesgar esta muestra.
  const muestraEstrat = [];
  const usados = new Set();
  for (const nombre of nombresEstratos) {
    const grupo = barajarReproducible(estratos[nombre], SEED + nombre.length);
    const cuota = Math.max(1, Math.round((estratos[nombre].length / activos.length) * tamMuestra));
    for (const item of grupo.slice(0, cuota)) { muestraEstrat.push(item); usados.add(item.prod.id); }
  }
  // Rellenar hasta tamMuestra con el resto, barajado reproducible.
  if (muestraEstrat.length < tamMuestra) {
    const resto = barajarReproducible(resultados.filter((it) => !usados.has(it.prod.id)), SEED + 7);
    for (const item of resto) {
      if (muestraEstrat.length >= tamMuestra) break;
      muestraEstrat.push(item); usados.add(item.prod.id);
    }
  }
  const filasE = [COLUMNAS_MUESTRA.join(',')].concat(muestraEstrat.map(filaMuestra));
  const rutaEstrat = rutaProductos.replace(/\.csv$/i, '') + '.muestra_estratificada.csv';
  fs.writeFileSync(rutaEstrat, filasE.join('\n'));

  // ----- Salida A2: muestra PRIORIZADA (auditoría de errores) -----
  // AUTO primero, luego desacuerdos con BD. NO es métrica estadística.
  const ordenEstado = { AUTO: 0, SUGERIR: 1, MANUAL: 2 };
  const priorizada = resultados.slice().sort((a, b) => {
    if (ordenEstado[a.res.estado] !== ordenEstado[b.res.estado]) return ordenEstado[a.res.estado] - ordenEstado[b.res.estado];
    const aDes = a.claveSugerida !== '' && !a.coincide ? 0 : 1;
    const bDes = b.claveSugerida !== '' && !b.coincide ? 0 : 1;
    return aDes - bDes;
  }).slice(0, tamMuestra);
  const filasP = [COLUMNAS_MUESTRA.join(',')].concat(priorizada.map(filaMuestra));
  const rutaPrior = rutaProductos.replace(/\.csv$/i, '') + '.muestra_priorizada.csv';
  fs.writeFileSync(rutaPrior, filasP.join('\n'));

  // ----- Salida A3: AUTO para auditoría fiscal (todos hasta 500) -----
  // AUTO incorrecto = riesgo fiscal silencioso. Se revisa el total de AUTO
  // si es manejable (<=500); si hay más, una muestra reproducible de 500.
  const todosAuto = resultados.filter((it) => it.res.estado === 'AUTO');
  const LIMITE_AUTO = 500;
  const autoParaRevisar = todosAuto.length <= LIMITE_AUTO
    ? todosAuto
    : barajarReproducible(todosAuto, SEED + 99).slice(0, LIMITE_AUTO);
  const filasA = [COLUMNAS_MUESTRA.join(',')].concat(autoParaRevisar.map(filaMuestra));
  const rutaAuto = rutaProductos.replace(/\.csv$/i, '') + '.muestra_auto.csv';
  fs.writeFileSync(rutaAuto, filasA.join('\n'));

  console.log('');
  console.log(`Distribución        -> ${rutaDist}`);
  console.log(`Muestra estratificada (métrica real, ${muestraEstrat.length} filas) -> ${rutaEstrat}`);
  console.log(`Muestra priorizada  (auditoría, ${priorizada.length} filas)          -> ${rutaPrior}`);
  console.log(`Muestra AUTO        (${autoParaRevisar.length}/${todosAuto.length} AUTO${todosAuto.length > LIMITE_AUTO ? ', muestreado' : ', completa'}) -> ${rutaAuto}`);
  console.log('Llena correcto_manual (SI/NO/DUDOSO) en la muestra ESTRATIFICADA y en la muestra AUTO.');
}

main();
