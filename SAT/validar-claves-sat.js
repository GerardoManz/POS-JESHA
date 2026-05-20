// validar-claves-sat.js
// Usage: node validar-claves-sat.js
// Input: SAT/c_ClaveProdServ.json + SAT/claves_bd.csv

const fs = require('fs');
const path = require('path');

const CARPETA_SAT = __dirname;
const CATALOGO_SAT = path.join(CARPETA_SAT, 'c_ClaveProdServ.json');
const CLAVES_BD_CSV = path.join(CARPETA_SAT, 'claves_bd.csv');

// ============== 1. Cargar catalogo SAT ==============
console.log('📂 [1/4] Cargando catalogo SAT...');
const catalogoRaw = JSON.parse(fs.readFileSync(CATALOGO_SAT, 'utf8'));
const clavesValidas = new Set(catalogoRaw.map(c => c.id));
console.log(`✅ Catalogo cargado: ${clavesValidas.size} claves validas`);

// ============== 2. Cargar claves de la BD ==============
console.log('📂 [2/4] Cargando claves de la BD...');

if (!fs.existsSync(CLAVES_BD_CSV)) {
  console.error(`❌ No se encontro: ${CLAVES_BD_CSV}`);
  console.log('\n📋 INSTRUCCIONES:');
  console.log('1. Ejecuta este query en DBeaver:');
  console.log(`
SELECT 
    "claveSat",
    "unidadSat",
    COUNT(*) AS total_productos
FROM "Producto"
WHERE "claveSat" IS NOT NULL
GROUP BY "claveSat", "unidadSat"
ORDER BY total_productos DESC;
`);
  console.log('\n2. Exporta el resultado como CSV (claves_bd.csv)');
  console.log('3. Guarda el archivo en: SAT/claves_bd.csv');
  console.log('4. Vuelve a ejecutar este script');
  process.exit(1);
}

const csvContent = fs.readFileSync(CLAVES_BD_CSV, 'utf8');
const lineas = csvContent.trim().split('\n');

const datos = lineas[0].includes('claveSat') ? lineas.slice(1) : lineas;

const clavesBD = [];
for (const linea of datos) {
  const partes = linea.split(',');
  if (partes.length >= 2) {
    const clave = partes[0].trim().replace(/"/g, '');
    const unidad = partes[1].trim().replace(/"/g, '');
    const productos = partes[2] ? parseInt(partes[2].trim()) : 0;
    if (clave && clave.length > 0) {
      clavesBD.push({ claveSat: clave, unidadSat: unidad, productos });
    }
  }
}

console.log(`✅ Claves BD cargadas: ${clavesBD.length} grupos unicos`);

// ============== 3. Comparar ==============
console.log('\n🔍 [3/4] Comparando claves...\n');

const invalidas = [];
const validas = [];
const sinClave = [];

for (const item of clavesBD) {
  if (!item.claveSat || item.claveSat === '') {
    sinClave.push(item);
  } else if (!clavesValidas.has(item.claveSat)) {
    invalidas.push(item);
    console.log(`❌ INVALIDA: ${item.claveSat} (${item.productos} productos)`);
  } else {
    validas.push(item);
    console.log(`✅ ${item.claveSat}`);
  }
}

// ============== 4. Generar reporte ==============
console.log('\n========== REPORTE FINAL ==========');
console.log(`Total grupos de claves BD: ${clavesBD.length}`);
console.log(`✅ Validas: ${validas.length}`);
console.log(`❌ Invalidas: ${invalidas.length}`);
console.log(`⚠️  Sin clave: ${sinClave.length}`);
console.log('=====================================\n');

let reporte = 'CLAVES INVALIDAS (no existen en catalogo SAT)\n';
reporte += '='.repeat(60) + '\n\n';

if (invalidas.length > 0) {
  for (const item of invalidas) {
    reporte += `Clave: ${item.claveSat}\n`;
    reporte += `  Unidad: ${item.unidadSat}\n`;
    reporte += `  Productos afectados: ${item.productos}\n`;
    reporte += '-'.repeat(40) + '\n';
  }
} else {
  reporte += 'NINGUNA - Todas las claves son validas ✅\n';
}

if (sinClave.length > 0) {
  reporte += '\nCLAVES SIN ASIGNAR\n';
  reporte += '='.repeat(60) + '\n';
  for (const item of sinClave) {
    reporte += `  ${item.productos} productos sin claveSAT\n`;
  }
}

const reportePath = path.join(CARPETA_SAT, 'reporte-claves-invalidas.txt');
fs.writeFileSync(reportePath, reporte);
console.log(`📄 Reporte guardado en: ${reportePath}`);

const jsonReporte = {
  fecha: new Date().toISOString(),
  resumen: {
    totalGrupos: clavesBD.length,
    validas: validas.length,
    invalidas: invalidas.length,
    sinClave: sinClave.length
  },
  invalidas,
  sinClave
};
fs.writeFileSync(path.join(CARPETA_SAT, 'reporte-claves-invalidas.json'), JSON.stringify(jsonReporte, null, 2));
console.log(`📄 JSON guardado en: SAT/reporte-claves-invalidas.json`);