// Arrotondamenti, date e identificatori del motore.
//
// Le guardie su valore non finito vengono dalla copia backend: quella frontend
// chiamava value.toFixed() direttamente e andava in errore su null.

// null, undefined e stringa vuota non sono zero: Number() li convertirebbe in 0
// e un prezzo zero sembra un prezzo vero, mentre un valore assente si vede.
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const number = Number(value)

  return Number.isFinite(number) ? number : null
}

export function roundPrice(value) {
  const number = toFiniteNumber(value)

  return number === null ? null : Number(number.toFixed(4))
}

export function roundQuantity(value) {
  const number = toFiniteNumber(value)

  return number === null ? null : Number(number.toFixed(8))
}

export function getTodayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

export function isSameDay(value, dayKey = getTodayKey()) {
  return value ? String(value).slice(0, 10) === dayKey : false
}

export function normalizeIdPart(value) {
  return String(value || 'na')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

export function formatCooldownDuration(remainingMs) {
  const minutes = Math.ceil(remainingMs / 60000)

  if (minutes < 60) {
    return `${minutes} min`
  }

  return `${Math.ceil(minutes / 60)} ore`
}

// Identificatore univoco. crypto.randomUUID esiste sia in Node sia nel browser
// in contesto sicuro; il ripiego serve solo agli ambienti che non lo espongono.
export function createId(prefix) {
  const unique =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(16).slice(2)

  return `${prefix}-${Date.now()}-${unique}`
}
