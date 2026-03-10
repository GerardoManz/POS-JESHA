// ═══════════════════════════════════════════════════════════════════
// IMPORTACIÓN.CONTROLLER.JS - VERSIÓN FINAL CORREGIDA
// SIN stockActual/stockMinimoAlerta en Producto (solo en InventarioSucursal)
// ═══════════════════════════════════════════════════════════════════

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const csv = require('csv-parse/sync')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function importarCSV(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Archivo requerido' })
  }

  try {
    console.log('📥 Iniciando importación...')
    const contenido = req.file.buffer.toString('utf-8')

    const registros = csv.parse(contenido, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    })

    console.log(`📊 Total registros CSV: ${registros.length}`)

    // ═══════════════════════════════════════════════════════════════
    // PASO 1: LIMPIAR BASE DE DATOS (opcional)
    // ═══════════════════════════════════════════════════════════════
    
    console.log('🧹 Limpiando base de datos...')
    
    // Eliminar movimientos de inventario
    await prisma.movimientoInventario.deleteMany({})
    console.log('  ✅ Movimientos eliminados')
    
    // Eliminar inventarios
    await prisma.inventarioSucursal.deleteMany({})
    console.log('  ✅ Inventarios eliminados')
    
    // Eliminar productos
    await prisma.producto.deleteMany({})
    console.log('  ✅ Productos eliminados')
    
    // Eliminar categorías
    await prisma.categoria.deleteMany({})
    console.log('  ✅ Categorías eliminadas')
    
    // Eliminar departamentos
    await prisma.departamento.deleteMany({})
    console.log('  ✅ Departamentos eliminados')

    // ═══════════════════════════════════════════════════════════════
    // PASO 2: CREAR DEPARTAMENTOS
    // ═══════════════════════════════════════════════════════════════

    const deptosUnicos = [...new Set(
      registros
        .map(r => r['DEPARTAMENTO']?.trim())
        .filter(Boolean)
    )]
    
    const departamentosMap = {}

    console.log(`\n🏢 Creando ${deptosUnicos.length} departamentos...`)
    
    for (const depto of deptosUnicos) {
      const deptoObj = await prisma.departamento.create({
        data: {
          nombre: depto,
          activo: true
        }
      })
      departamentosMap[depto] = deptoObj.id
      console.log(`  ✅ ${depto}`)
    }

    // ═══════════════════════════════════════════════════════════════
    // PASO 3: CREAR CATEGORÍAS
    // ═══════════════════════════════════════════════════════════════

    const categoriasUnicas = registros.reduce((acc, r) => {
      const key = `${r['DEPARTAMENTO']}|${r['CATEGORIA']}`
      if (!acc[key]) {
        acc[key] = r
      }
      return acc
    }, {})

    const categoriasMap = {}

    console.log(`\n📂 Creando ${Object.keys(categoriasUnicas).length} categorías...`)

    for (const [key, row] of Object.entries(categoriasUnicas)) {
      const depto = row['DEPARTAMENTO']?.trim()
      const cat = row['CATEGORIA']?.trim()
      const deptId = departamentosMap[depto]

      if (!deptId) {
        console.log(`  ⚠️  Departamento no encontrado: ${depto}`)
        continue
      }

      const catObj = await prisma.categoria.create({
        data: {
          departamentoId: deptId,
          nombre: cat,
          descripcion: null
        }
      })

      categoriasMap[cat] = catObj.id
      console.log(`  ✅ ${depto} > ${cat}`)
    }

    // ═══════════════════════════════════════════════════════════════
    // PASO 4: IMPORTAR PRODUCTOS
    // ═══════════════════════════════════════════════════════════════

    console.log(`\n📦 Importando ${registros.length} productos...`)

    let creados = 0
    let actualizados = 0
    let errores = 0
    const sucursalId = 1

    for (let i = 0; i < registros.length; i++) {
      try {
        const row = registros[i]

        // Extraer datos
        const nombre = row['DESCRIPCION']?.trim()
        const codigoInterno = row['CLAVE']?.trim()
        const codigoBarras = row['CLAVE ALTERNA']?.trim() || null
        const costo = parseFloat(row['PRECIO COMPRA']) || 0
        const precioBase = parseFloat(row['PRECIO 1']) || 0
        const precio2 = parseFloat(row['PRECIO 2']) || 0
        const depto = row['DEPARTAMENTO']?.trim()
        const cat = row['CATEGORIA']?.trim()

        // Validaciones
        if (!nombre || !codigoInterno) {
          errores++
          continue
        }

        const deptId = departamentosMap[depto]
        const catId = categoriasMap[cat]

        if (!deptId || !catId) {
          errores++
          continue
        }

        // Crear producto (SIN stock)
        const producto = await prisma.producto.create({
          data: {
            nombre,
            codigoInterno,
            codigoBarras,
            costo,
            costoPromedio: costo,
            precioBase,
            precioMayoreo: precio2 > 0 && precio2 < precioBase ? precio2 : null,
            cantidadMinMayoreo: parseInt(row['MAYOREO 2']) || 10,
            aplicaMayoreo: precio2 > 0 && precio2 < precioBase,
            esGranel: row['GRANEL (S/N)'] === 'S',
            descripcion: row['CARACTERISTICAS']?.trim() || null,
            categoriaId: catId,
            activo: true
          }
        })

        // Crear inventario (AQUÍ VA EL STOCK)
        await prisma.inventarioSucursal.create({
          data: {
            productoId: producto.id,
            sucursalId,
            stockActual: parseInt(row['EXIST.']) || 0,
            stockMinimoAlerta: parseInt(row['INV_MIN']) || 5,
            stockMaximo: parseInt(row['INV_MAX']) || null
          }
        })

        creados++

        // Log cada 500
        if ((i + 1) % 500 === 0) {
          console.log(`  ⏳ ${i + 1}/${registros.length} procesados...`)
        }
      } catch (error) {
        console.error(`❌ Fila ${i}: ${error.message}`)
        errores++
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // RESULTADO
    // ═══════════════════════════════════════════════════════════════

    console.log(`\n✅ IMPORTACIÓN COMPLETADA`)
    console.log(`   📦 Creados: ${creados}`)
    console.log(`   ♻️  Actualizados: ${actualizados}`)
    console.log(`   ❌ Errores: ${errores}`)
    console.log(`   📊 Total: ${registros.length}`)

    res.json({
      success: true,
      mensaje: 'Importación completada exitosamente',
      resumen: {
        creados,
        actualizados,
        errores,
        total: registros.length
      }
    })
  } catch (error) {
    console.error('❌ Error fatal:', error)
    res.status(500).json({ 
      success: false,
      error: error.message 
    })
  }
}

module.exports = { importarCSV }