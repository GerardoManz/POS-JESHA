const { Decimal } = require('@prisma/client')

const MAX_DIGITOS_ENTEROS = 8   // Decimal(10,2) → 10 total, 2 decimales → 8 enteros máximo
const MONTO_REGEX = new RegExp(`^\\d{1,${MAX_DIGITOS_ENTEROS}}\\.\\d{2}$`)

function validarMontoDecimal(input) {
  if (typeof input !== 'string') {
    return { error: 'monto debe ser un string decimal (ej. "300.00")' }
  }
  if (!MONTO_REGEX.test(input)) {
    return { error: `monto debe tener formato DDDDDDDD.DD (máx ${MAX_DIGITOS_ENTEROS} enteros, 2 decimales)` }
  }
  const valor = new Decimal(input)
  if (!valor.isPositive()) {
    return { error: 'monto debe ser positivo' }
  }
  return { valor }
}

module.exports = { validarMontoDecimal, Decimal }
