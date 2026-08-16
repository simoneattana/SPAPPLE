// Calendario di borsa: giorni in cui il mercato non scambia.
//
// Fino al 2026-08-16 Spapple non sapeva che giorno della settimana fosse:
// getTimeInTimezone leggeva solo ore e minuti. Sabato e domenica erano giorni
// di borsa come gli altri, e infatti il 2 agosto 2026, di domenica, ha aperto
// e chiuso tre posizioni su Europa e USA a mercati chiusi.
//
// Due livelli di protezione:
//  1. questo calendario, che sa in anticipo le chiusure note
//  2. il controllo di freschezza del dato in isMarketDataStale, che coglie le
//     chiusure lunghe non previste qui (Capodanno lunare, Golden Week)

// --- Pasqua, da cui discendono Venerdi Santo e Lunedi dell'Angelo -----------
// Algoritmo di Gauss-Butcher, valido per il calendario gregoriano.
export function getEasterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return new Date(Date.UTC(year, month - 1, day))
}

function toKey(date) {
  return date.toISOString().slice(0, 10)
}

function shift(date, days) {
  return new Date(date.getTime() + days * 86_400_000)
}

function fixed(year, month, day) {
  return toKey(new Date(Date.UTC(year, month - 1, day)))
}

// n-esimo giorno della settimana del mese: nthWeekday(2026, 1, 1, 3) = terzo lunedi di gennaio
function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return toKey(new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7)))
}

function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0))
  const offset = (last.getUTCDay() - weekday + 7) % 7
  return toKey(shift(last, -offset))
}

// Regola americana: la festivita che cade di sabato si osserva il venerdi
// prima, quella che cade di domenica il lunedi dopo.
function usObserved(key) {
  const date = new Date(`${key}T00:00:00Z`)
  const weekday = date.getUTCDay()

  if (weekday === 6) return toKey(shift(date, -1))
  if (weekday === 0) return toKey(shift(date, 1))

  return key
}

// --- Chiusure verificate sui calendari ufficiali ----------------------------
// JPX e HKEX hanno molte festivita non calcolabili per regola (equinozi,
// capodanno lunare), quindi vanno elencate anno per anno.
// Fonti: jpx.co.jp e hkex.com.hk, consultate il 2026-08-16.
const CHIUSURE_ELENCATE = {
  tokyo: {
    2026: [
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-12', '2026-02-11',
      '2026-02-23', '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04',
      '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11', '2026-09-21',
      '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
      '2026-12-31',
    ],
  },
  'hong-kong': {
    2026: [
      '2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19', '2026-04-03',
      '2026-04-04', '2026-04-06', '2026-04-07', '2026-05-01', '2026-05-25',
      '2026-06-19', '2026-07-01', '2026-09-26', '2026-10-01', '2026-10-19',
      '2026-12-25', '2026-12-26',
    ],
  },
}

// --- Chiusure calcolabili per regola ---------------------------------------
// Nucleo comune alle borse europee. Il mercato "equities" ne raggruppa dieci
// (.MI .PA .DE .AS .MC .SW .ST .CO .HE .OL) sotto un'unica sessione, quindi qui
// stanno solo le chiusure che valgono per tutte.
//
// Resta scoperto: le festivita locali di un solo giorno, come la Festa
// nazionale svizzera del 1 agosto, l'Ascensione e il Lunedi di Pentecoste nei
// paesi nordici, il Midsummer svedese, il 3 ottobre tedesco. In quei giorni la
// borsa interessata e chiusa mentre le altre lavorano, e il controllo di
// freschezza non se ne accorge perche dura un giorno solo. Per chiuderlo
// servono liste per suffisso di borsa.
function chiusureEuropa(year) {
  const pasqua = getEasterSunday(year)

  return [
    fixed(year, 1, 1), // Capodanno
    toKey(shift(pasqua, -2)), // Venerdi Santo
    toKey(shift(pasqua, 1)), // Lunedi dell'Angelo
    fixed(year, 5, 1), // Primo maggio
    fixed(year, 12, 25), // Natale
    fixed(year, 12, 26), // Santo Stefano
  ]
}

function chiusureUsa(year) {
  const pasqua = getEasterSunday(year)

  return [
    usObserved(fixed(year, 1, 1)), // Capodanno
    nthWeekday(year, 1, 1, 3), // Martin Luther King, terzo lunedi
    nthWeekday(year, 2, 1, 3), // Presidents Day, terzo lunedi
    toKey(shift(pasqua, -2)), // Venerdi Santo
    lastWeekday(year, 5, 1), // Memorial Day, ultimo lunedi
    usObserved(fixed(year, 6, 19)), // Juneteenth
    usObserved(fixed(year, 7, 4)), // Indipendenza
    nthWeekday(year, 9, 1, 1), // Labor Day, primo lunedi
    nthWeekday(year, 11, 4, 4), // Ringraziamento, quarto giovedi
    usObserved(fixed(year, 12, 25)), // Natale
  ]
}

const REGOLE = {
  europe: chiusureEuropa,
  usa: chiusureUsa,
}

const cache = new Map()

export function getExchangeHolidays(exchangeId, year) {
  const chiave = `${exchangeId}-${year}`

  if (cache.has(chiave)) {
    return cache.get(chiave)
  }

  const daRegola = REGOLE[exchangeId] ? REGOLE[exchangeId](year) : []
  const elencate = CHIUSURE_ELENCATE[exchangeId]?.[year] || []
  const insieme = new Set([...daRegola, ...elencate])

  cache.set(chiave, insieme)

  return insieme
}

// Vero quando per quella borsa non esiste nessuna chiusura nota per l'anno.
// Serve a distinguere "oggi si scambia" da "il calendario e scaduto".
export function hasCalendarFor(exchangeId, year) {
  return getExchangeHolidays(exchangeId, year).size > 0
}

export function isExchangeHoliday(exchangeId, isoDate) {
  const year = Number(String(isoDate).slice(0, 4))

  if (!Number.isFinite(year)) {
    return false
  }

  return getExchangeHolidays(exchangeId, year).has(String(isoDate))
}

export function isWeekend(weekday) {
  return weekday === 0 || weekday === 6
}

// Rete per le chiusure lunghe che il calendario non conosce: Capodanno lunare,
// Golden Week, settimane festive. Non puo essere piu stretta di cosi perche
// durante una seduta normale l'ultima barra giornaliera chiusa e quella del
// giorno di borsa precedente, quindi un weekend piu una festivita valgono
// gia quattro giorni di distanza legittimi.
export const MAX_ETA_DATO_GIORNI = 4

export function isMarketDataStale(latestBarDate, now = new Date()) {
  if (!latestBarDate) {
    return false
  }

  const barra = new Date(`${String(latestBarDate).slice(0, 10)}T00:00:00Z`)

  if (!Number.isFinite(barra.getTime())) {
    return false
  }

  const giorni = (now.getTime() - barra.getTime()) / 86_400_000

  return giorni > MAX_ETA_DATO_GIORNI
}
