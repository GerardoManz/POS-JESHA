'use strict';

/**
 * Preprocesador del catálogo SAT.
 *
 * Lee los catálogos oficiales crudos y genera un índice compacto que es
 * lo ÚNICO que carga el backend en runtime (Render). Se ejecuta de forma
 * manual y local cada vez que el SAT publique una actualización:
 *
 *   node scripts/sat/preprocesar_catalogo.js [dirEntrada] [archivoSalida]
 *
 * Por defecto:
 *   entrada: src/data/sat/raw/  (c_ClaveProdServ.json, c_ClaveUnidad.json)
 *   salida:  src/data/sat/sat.index.json
 *
 * Qué hace:
 *   1. Excluye claves expiradas (fechaFinVigencia en el pasado) y la clave
 *      01010101 ("No existe en el catálogo"). Las claves que no entran al
 *      índice quedan automáticamente fuera de validación y de candidatos.
 *   2. Tokeniza descripcion y palabrasSimilares con el MISMO normalizador
 *      que usará el matcher, para que la comparación sea simétrica.
 *   3. Filtra unidades expiradas y guarda id + nombre de las vigentes.
 *
 * El formato de fecha del SAT ("07-01-2019") es ambiguo, así que el script
 * autodetecta DD-MM-YYYY vs MM-DD-YYYY escaneando todo el dataset. Si no
 * puede desambiguar, asume DD-MM-YYYY (convención mexicana) y lo avisa.
 */

const fs = require('fs');
const path = require('path');
const { normalizarTexto } = require('../../src/modules/productos/sat.normalizador');

const RAIZ = path.join(__dirname, '..', '..');
const DIR_ENTRADA_DEF = path.join(RAIZ, 'src', 'data', 'sat', 'raw');
const SALIDA_DEF = path.join(RAIZ, 'src', 'data', 'sat', 'sat.index.json');

const CLAVES_EXCLUIDAS_SIEMPRE = new Set(['01010101']);

function leerJson(ruta) {
  let crudo = fs.readFileSync(ruta, 'utf8');
  if (crudo.charCodeAt(0) === 0xfeff) crudo = crudo.slice(1); // BOM
  return JSON.parse(crudo);
}

/**
 * Detecta el formato de fecha del dataset completo.
 * @param {string[]} fechas - todas las fechas no vacías encontradas
 * @returns {{ formato: 'DMY'|'MDY', detectado: boolean }}
 */
function detectarFormatoFecha(fechas) {
  for (const f of fechas) {
    const partes = f.split('-');
    if (partes.length !== 3) continue;
    const a = parseInt(partes[0], 10);
    const b = parseInt(partes[1], 10);
    if (a > 12) return { formato: 'DMY', detectado: true };
    if (b > 12) return { formato: 'MDY', detectado: true };
  }
  return { formato: 'DMY', detectado: false };
}

function parsearFecha(fecha, formato) {
  const partes = fecha.split('-').map((p) => parseInt(p, 10));
  if (partes.length !== 3 || partes.some(Number.isNaN)) return null;
  const [a, b, anio] = partes;
  const dia = formato === 'DMY' ? a : b;
  const mes = formato === 'DMY' ? b : a;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function estaExpirada(fechaFin, formato, hoy) {
  if (typeof fechaFin !== 'string' || fechaFin.trim() === '') return false;
  const fecha = parsearFecha(fechaFin.trim(), formato);
  if (fecha === null) return true; // fecha fin ilegible: fuera, por seguridad fiscal
  return fecha.getTime() <= hoy.getTime();
}

function procesarClavesProdServ(registros, formato, hoy, stats) {
  const claves = {};
  for (const reg of registros) {
    const id = typeof reg.id === 'string' ? reg.id.trim() : '';
    if (!/^\d{8}$/.test(id)) {
      stats.clavesMalformadas += 1;
      continue;
    }
    if (CLAVES_EXCLUIDAS_SIEMPRE.has(id)) {
      stats.clavesExcluidasSiempre += 1;
      continue;
    }
    if (estaExpirada(reg.fechaFinVigencia, formato, hoy)) {
      stats.clavesExpiradas += 1;
      continue;
    }
    const descripcion = typeof reg.descripcion === 'string' ? reg.descripcion.trim() : '';
    if (descripcion === '') {
      stats.clavesMalformadas += 1;
      continue;
    }

    const normDesc = normalizarTexto(descripcion);
    const entrada = { d: descripcion, t: normDesc.tokens };

    const similares = typeof reg.palabrasSimilares === 'string' ? reg.palabrasSimilares.trim() : '';
    if (similares !== '') {
      const normSim = normalizarTexto(similares);
      if (normSim.tokens.length > 0) {
        entrada.s = normSim.tokens;
        stats.clavesConPalabrasSimilares += 1;
      }
    }

    claves[id] = entrada;
  }
  return claves;
}

function procesarUnidades(registros, formato, hoy, stats) {
  const unidades = {};
  for (const reg of registros) {
    const id = typeof reg.id === 'string' ? reg.id.trim() : '';
    if (id === '') {
      stats.unidadesMalformadas += 1;
      continue;
    }
    if (estaExpirada(reg.fechaDeFinDeVigencia, formato, hoy)) {
      stats.unidadesExpiradas += 1;
      continue;
    }
    const nombre = typeof reg.nombre === 'string' ? reg.nombre.trim() : '';
    unidades[id] = { n: nombre };
  }
  return unidades;
}

function main() {
  const dirEntrada = process.argv[2] ? path.resolve(process.argv[2]) : DIR_ENTRADA_DEF;
  const archivoSalida = process.argv[3] ? path.resolve(process.argv[3]) : SALIDA_DEF;

  const rutaProdServ = path.join(dirEntrada, 'c_ClaveProdServ.json');
  const rutaUnidades = path.join(dirEntrada, 'c_ClaveUnidad.json');

  for (const ruta of [rutaProdServ, rutaUnidades]) {
    if (!fs.existsSync(ruta)) {
      console.error(`ERROR: no se encontró ${ruta}`);
      console.error('Copia los catálogos crudos del SAT a src/data/sat/raw/ antes de ejecutar.');
      process.exit(1);
    }
  }

  const inicio = Date.now();
  const hoy = new Date();
  const hoyUtc = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));

  console.log('Leyendo catálogos crudos...');
  const regsProdServ = leerJson(rutaProdServ);
  const regsUnidades = leerJson(rutaUnidades);
  if (!Array.isArray(regsProdServ) || !Array.isArray(regsUnidades)) {
    console.error('ERROR: se esperaba un array en el nivel raíz de ambos catálogos.');
    process.exit(1);
  }

  const fechasProdServ = regsProdServ
    .flatMap((r) => [r.fechaInicioVigencia, r.fechaFinVigencia])
    .filter((f) => typeof f === 'string' && f.trim() !== '');
  const fechasUnidades = regsUnidades
    .flatMap((r) => [r.fechaDeInicioDeVigencia, r.fechaDeFinDeVigencia])
    .filter((f) => typeof f === 'string' && f.trim() !== '');

  const fmtProdServ = detectarFormatoFecha(fechasProdServ);
  const fmtUnidades = detectarFormatoFecha(fechasUnidades);
  for (const [nombre, fmt] of [['c_ClaveProdServ', fmtProdServ], ['c_ClaveUnidad', fmtUnidades]]) {
    if (fmt.detectado) {
      console.log(`Formato de fecha en ${nombre}: ${fmt.formato} (autodetectado)`);
    } else {
      console.log(`AVISO: formato de fecha en ${nombre} ambiguo; se asume DD-MM-YYYY.`);
    }
  }

  const stats = {
    clavesMalformadas: 0,
    clavesExcluidasSiempre: 0,
    clavesExpiradas: 0,
    clavesConPalabrasSimilares: 0,
    unidadesMalformadas: 0,
    unidadesExpiradas: 0,
  };

  console.log('Procesando claves de producto/servicio...');
  const claves = procesarClavesProdServ(regsProdServ, fmtProdServ.formato, hoyUtc, stats);
  console.log('Procesando unidades...');
  const unidades = procesarUnidades(regsUnidades, fmtUnidades.formato, hoyUtc, stats);

  const indice = {
    version: 1,
    generadoEn: new Date().toISOString(),
    fuente: {
      totalClavesCrudas: regsProdServ.length,
      totalUnidadesCrudas: regsUnidades.length,
    },
    totalClaves: Object.keys(claves).length,
    totalUnidades: Object.keys(unidades).length,
    claves,
    unidades,
  };

  fs.mkdirSync(path.dirname(archivoSalida), { recursive: true });
  fs.writeFileSync(archivoSalida, JSON.stringify(indice));

  const tamanoMb = (fs.statSync(archivoSalida).size / (1024 * 1024)).toFixed(2);
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  console.log('');
  console.log('=== Resumen ===');
  console.log(`Claves crudas:               ${regsProdServ.length}`);
  console.log(`Claves en índice:            ${indice.totalClaves}`);
  console.log(`  Excluidas por expiración:  ${stats.clavesExpiradas}`);
  console.log(`  Excluidas fijas (01010101): ${stats.clavesExcluidasSiempre}`);
  console.log(`  Malformadas:               ${stats.clavesMalformadas}`);
  console.log(`  Con palabrasSimilares:     ${stats.clavesConPalabrasSimilares}`);
  console.log(`Unidades crudas:             ${regsUnidades.length}`);
  console.log(`Unidades en índice:          ${indice.totalUnidades}`);
  console.log(`  Excluidas por expiración:  ${stats.unidadesExpiradas}`);
  console.log(`  Malformadas:               ${stats.unidadesMalformadas}`);
  console.log(`Salida: ${archivoSalida} (${tamanoMb} MB)`);
  console.log(`Tiempo: ${segundos}s`);
}

main();
