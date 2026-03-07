// ═══════════════════════════════════════════════════════════════════
// SEED.JS — Datos iniciales JESHA POS
// Compatible con schema actual + campos Cliente restaurados
// ═══════════════════════════════════════════════════════════════════

require('dotenv').config()
const bcrypt = require('bcrypt')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Iniciando seed...\n')

  const sucursal = await prisma.sucursal.upsert({
    where: { id: 1 },
    update: {},
    create: { nombre: 'Ferretería JESHA - Matriz', direccion: 'Av. Principal 123, Zacatecas', telefono: '492-922-1234', codigoPostal: '98000', activa: true }
  })
  console.log(`✅ Sucursal: ${sucursal.nombre}`)

  const hash = await bcrypt.hash('Admin2024!', 12)
  await prisma.usuario.upsert({ where: { username: 'superadmin' }, update: {}, create: { nombre: 'Administrador JESHA', username: 'superadmin', passwordHash: hash, rol: 'SUPERADMIN', sucursalId: null, activo: true } })
  await prisma.usuario.upsert({ where: { username: 'admin' }, update: {}, create: { nombre: 'Admin Sucursal', username: 'admin', passwordHash: hash, rol: 'ADMIN_SUCURSAL', sucursalId: sucursal.id, activo: true } })
  await prisma.usuario.upsert({ where: { username: 'empleado' }, update: {}, create: { nombre: 'Empleado POS', username: 'empleado', passwordHash: hash, rol: 'EMPLEADO', sucursalId: sucursal.id, activo: true } })
  console.log('✅ Usuarios: superadmin / admin / empleado — Admin2024!')

  const deptos = ['Herramientas','Plomería','Electricidad','Pintura','Gas','Limpieza','Seguridad','Construcción','SERVICIOS']
  const iconos = ['🔧','🚿','⚡','🎨','🔥','🧹','🔒','🏗️','🛠️']
  const departamentos = {}
  for (let i = 0; i < deptos.length; i++) {
    departamentos[deptos[i]] = await prisma.departamento.upsert({ where: { nombre: deptos[i] }, update: {}, create: { nombre: deptos[i], icono: iconos[i], activo: true } })
  }
  console.log(`✅ ${deptos.length} departamentos`)

  const catMap = [
    ['Herramientas', ['Martillos','Destornilladores','Llaves','Sierras']],
    ['Plomería',     ['Tuberías','Accesorios','Grifería','Mangueras']],
    ['Electricidad', ['Cables','Focos','Contactos','Interruptores']],
    ['Pintura',      ['Pinturas','Brochas','Rodillos','Diluyentes']],
    ['Gas',          ['Cilindros','Reguladores','Conexiones','Válvulas']],
    ['Limpieza',     ['Desinfectantes','Detergentes','Escobas','Franelas']],
    ['Seguridad',    ['Cascos','Guantes','Gafas','Arneses']],
    ['Construcción', ['Cemento','Arena','Ladrillos','Varilla']],
    ['SERVICIOS',    ['Instalación','Reparación','Asesoría']]
  ]
  const categorias = {}
  for (const [dept, cats] of catMap) {
    for (const cat of cats) {
      categorias[cat] = await prisma.categoria.upsert({
        where: { departamentoId_nombre: { departamentoId: departamentos[dept].id, nombre: cat } },
        update: {},
        create: { departamentoId: departamentos[dept].id, nombre: cat, descripcion: `Categoría ${cat}` }
      })
    }
  }
  console.log(`✅ ${Object.keys(categorias).length} categorías`)

  // CLIENTES — con todos los campos restaurados
  await prisma.cliente.upsert({ where: { rfc: 'XAXX010101000' }, update: {}, create: { nombre: 'Cliente General', rfc: 'XAXX010101000', tipo: 'GENERAL', activo: true, limiteCredito: 0 } })
  await prisma.cliente.upsert({ where: { rfc: 'SEMG020428G7' }, update: {}, create: { nombre: 'Gerardo Andrés Serrano Manzano', apodo: 'Don Gerardo', rfc: 'SEMG020428G7', telefono: '4924920823', tipo: 'GENERAL', activo: true, limiteCredito: 0 } })
  await prisma.cliente.upsert({ where: { rfc: 'CXYZ240001SA' }, update: {}, create: { nombre: 'Constructora XYZ S.A. de C.V.', apodo: 'Constructora XYZ', rfc: 'CXYZ240001SA', telefono: '492-987-6543', email: 'fiscal@constructoraxyz.com', razonSocial: 'Constructora XYZ S.A. de C.V.', codigoPostalFiscal: '98000', regimenFiscal: '601', usoCfdi: 'G03', tipo: 'FISCAL', limiteCredito: 100000, activo: true } })
  console.log('✅ 3 clientes')

  for (const prov of [
    { nombreOficial: 'Herramientas del Centro', alias: 'HDC', telefono: '492-555-1111', email: 'contacto@hdc.com' },
    { nombreOficial: 'Distribuidora Eléctrica Nacional', alias: 'DEN', telefono: '492-555-2222', email: 'ventas@den.com' },
    { nombreOficial: 'Pinturas y Acabados S.A.', alias: 'PYA', telefono: '492-555-3333', email: 'pedidos@pya.com' }
  ]) {
    const existe = await prisma.proveedor.findFirst({ where: { nombreOficial: prov.nombreOficial } })
    if (!existe) await prisma.proveedor.create({ data: { ...prov, activo: true } })
  }
  console.log('✅ 3 proveedores')

  const prodsData = [
    { codigo: 'HER-001', nombre: 'Martillo de Uña 16oz',         cat: 'Martillos',        precio: 150, costo: 85,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'HER-002', nombre: 'Martillo de Uña 20oz',         cat: 'Martillos',        precio: 180, costo: 100, uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'HER-003', nombre: 'Destornillador Plano #2',      cat: 'Destornilladores', precio: 45,  costo: 25,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'HER-004', nombre: 'Destornillador Phillips #2',   cat: 'Destornilladores', precio: 45,  costo: 25,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'PLO-001', nombre: 'Tubo PVC 1/2" x 3m',          cat: 'Tuberías',         precio: 120, costo: 60,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'PLO-002', nombre: 'Tubo PVC 3/4" x 3m',          cat: 'Tuberías',         precio: 180, costo: 90,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'ELE-001', nombre: 'Cable Eléctrico Cal. 12',      cat: 'Cables',           precio: 25,  costo: 12,  uV: 'metro', uC: 'rollo', f: 100  },
    { codigo: 'ELE-002', nombre: 'Cable Eléctrico Cal. 10',      cat: 'Cables',           precio: 35,  costo: 18,  uV: 'metro', uC: 'rollo', f: 100  },
    { codigo: 'ELE-003', nombre: 'Foco LED 9W Blanco Frío',      cat: 'Focos',            precio: 45,  costo: 22,  uV: 'pza',   uC: 'caja',  f: 12   },
    { codigo: 'ELE-004', nombre: 'Foco LED 15W Blanco Cálido',   cat: 'Focos',            precio: 55,  costo: 27,  uV: 'pza',   uC: 'caja',  f: 12   },
    { codigo: 'PIN-001', nombre: 'Pintura Vinílica Blanca 1L',   cat: 'Pinturas',         precio: 89,  costo: 45,  uV: 'lt',    uC: 'lt',    f: null },
    { codigo: 'PIN-002', nombre: 'Pintura Vinílica Blanca 5L',   cat: 'Pinturas',         precio: 380, costo: 190, uV: 'bote',  uC: 'bote',  f: null },
    { codigo: 'PIN-003', nombre: 'Brocha Plana 3"',              cat: 'Brochas',          precio: 35,  costo: 17,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'PIN-004', nombre: 'Rodillo 9"',                   cat: 'Rodillos',         precio: 28,  costo: 14,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'GAS-001', nombre: 'Cilindro Gas LP 5kg',          cat: 'Cilindros',        precio: 250, costo: 120, uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'GAS-002', nombre: 'Regulador de Gas',             cat: 'Reguladores',      precio: 85,  costo: 40,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'LIM-001', nombre: 'Desinfectante Concentrado 1L', cat: 'Desinfectantes',   precio: 45,  costo: 22,  uV: 'lt',    uC: 'lt',    f: null },
    { codigo: 'LIM-002', nombre: 'Detergente Líquido 2L',        cat: 'Detergentes',      precio: 35,  costo: 17,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'LIM-003', nombre: 'Escoba de Nylon',              cat: 'Escobas',          precio: 55,  costo: 28,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'SEG-001', nombre: 'Casco de Seguridad Amarillo',  cat: 'Cascos',           precio: 125, costo: 60,  uV: 'pza',   uC: 'pza',   f: null },
    { codigo: 'SEG-002', nombre: 'Guantes de Trabajo (par)',     cat: 'Guantes',          precio: 35,  costo: 17,  uV: 'par',   uC: 'par',   f: null }
  ]

  const productosCreados = []
  for (const p of prodsData) {
    const cat = categorias[p.cat]
    if (!cat) { console.warn(`⚠️ Categoría no encontrada: ${p.cat}`); continue }
    const prod = await prisma.producto.upsert({
      where: { codigoInterno: p.codigo },
      update: {},
      create: { codigoInterno: p.codigo, nombre: p.nombre, descripcion: `${p.nombre} — JESHA`, precioBase: p.precio, costo: p.costo, costoPromedio: p.costo, categoriaId: cat.id, unidadVenta: p.uV, unidadCompra: p.uC, factorConversion: p.f, activo: true }
    })
    productosCreados.push(prod)
  }
  console.log(`✅ ${productosCreados.length} productos`)

  for (const prod of productosCreados) {
    await prisma.inventarioSucursal.upsert({
      where: { productoId_sucursalId: { productoId: prod.id, sucursalId: sucursal.id } },
      update: {},
      create: { productoId: prod.id, sucursalId: sucursal.id, stockActual: Math.floor(Math.random() * 80) + 20, stockMinimoAlerta: 5, stockMaximo: 200 }
    })
  }
  console.log(`✅ ${productosCreados.length} registros de inventario`)

  console.log('\n🎉 SEED COMPLETADO — contraseña: Admin2024!\n')
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())