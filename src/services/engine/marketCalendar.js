// Calendario di borsa: giorni in cui il mercato non scambia.
//
// Fino al 2026-08-16 Spapple non sapeva che giorno della settimana fosse:
// getTimeInTimezone leggeva solo ore e minuti. Sabato e domenica erano giorni
// di borsa come gli altri, e infatti il 2 agosto 2026, di domenica, ha aperto
// e chiuso tre posizioni su Europa e USA a mercati chiusi.
//
// Tre livelli di protezione:
//  1. fine settimana, che si sa dalla data e non sbaglia mai
//  2. questo calendario, per borsa e non per mercato: il gruppo "Europa" ne
//     contiene dieci con festivita diverse fra loro
//  3. il controllo di freschezza del dato in isMarketDataStale, che coglie le
//     chiusure lunghe non previste qui
//
// Le date non calcolabili per regola (equinozi giapponesi, capodanno lunare)
// sono elencate anno per anno. Fonti consultate il 2026-08-16: jpx.co.jp,
// hkex.com.hk, euronext.com, six-group.com, cashmarket.deutsche-boerse.com.

// --- Pasqua, da cui discendono meta delle feste europee ---------------------
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

// Il venerdi fra il 19 e il 25 giugno: Midsummer svedese e finlandese.
function midsummerFriday(year) {
  for (let day = 19; day <= 25; day += 1) {
    const date = new Date(Date.UTC(year, 5, day))
    if (date.getUTCDay() === 5) {
      return toKey(date)
    }
  }

  return fixed(year, 6, 19)
}

function pasquali(year) {
  const pasqua = getEasterSunday(year)

  return {
    giovediSanto: toKey(shift(pasqua, -3)),
    venerdiSanto: toKey(shift(pasqua, -2)),
    lunediAngelo: toKey(shift(pasqua, 1)),
    ascensione: toKey(shift(pasqua, 39)),
    lunediPentecoste: toKey(shift(pasqua, 50)),
  }
}

// --- Una regola per borsa ---------------------------------------------------
// Le chiusure di fine anno sono elencate anche quando cadono di sabato o
// domenica: il controllo sul fine settimana le assorbe comunque.

// Milano, Parigi, Amsterdam, Lisbona, Bruxelles.
function chiusureEuronext(year) {
  const p = pasquali(year)

  return [
    fixed(year, 1, 1),
    p.venerdiSanto,
    p.lunediAngelo,
    fixed(year, 5, 1),
    fixed(year, 12, 25),
    fixed(year, 12, 26),
  ]
}

// Oslo segue Euronext ma aggiunge le feste norvegesi.
function chiusureOslo(year) {
  const p = pasquali(year)

  return [
    ...chiusureEuronext(year),
    p.giovediSanto,
    p.ascensione,
    p.lunediPentecoste,
    fixed(year, 12, 24),
    fixed(year, 12, 31),
  ]
}

// Xetra e Borsa di Francoforte.
function chiusureXetra(year) {
  const p = pasquali(year)

  return [
    fixed(year, 1, 1),
    p.venerdiSanto,
    p.lunediAngelo,
    fixed(year, 5, 1),
    fixed(year, 12, 24),
    fixed(year, 12, 25),
    fixed(year, 12, 26),
    fixed(year, 12, 31),
  ]
}

// SIX Swiss Exchange.
function chiusureSix(year) {
  const p = pasquali(year)

  return [
    fixed(year, 1, 1),
    fixed(year, 1, 2), // Berchtoldstag
    p.venerdiSanto,
    p.lunediAngelo,
    fixed(year, 5, 1),
    p.ascensione,
    p.lunediPentecoste,
    // Festa nazionale svizzera. Nel 2026 e nel 2027 cade di weekend, quindi non
    // compare nei calendari ufficiali di quegli anni e la regola non e
    // verificabile su quelle liste: sta qui perche SIX chiude il 1 agosto.
    fixed(year, 8, 1),
    fixed(year, 12, 24),
    fixed(year, 12, 25),
    fixed(year, 12, 31),
  ]
}

// Nasdaq Nordic: Stoccolma, Copenaghen, Helsinki.
function chiusureNordic(year) {
  const p = pasquali(year)

  return [
    fixed(year, 1, 1),
    fixed(year, 1, 6), // Epifania
    p.venerdiSanto,
    p.lunediAngelo,
    fixed(year, 5, 1),
    p.ascensione,
    midsummerFriday(year),
    fixed(year, 12, 24),
    fixed(year, 12, 25),
    fixed(year, 12, 26),
    fixed(year, 12, 31),
  ]
}

// BME, Madrid.
function chiusureBme(year) {
  const p = pasquali(year)

  return [
    fixed(year, 1, 1),
    p.venerdiSanto,
    p.lunediAngelo,
    fixed(year, 5, 1),
    fixed(year, 12, 24),
    fixed(year, 12, 25),
    fixed(year, 12, 31),
  ]
}

// Nucleo comune: le sole chiusure condivise da tutte e dieci le borse europee.
// Vale quando si ragiona sul mercato "Europa" senza un titolo specifico.
function chiusureEuropaComuni(year) {
  const p = pasquali(year)

  return [
    fixed(year, 1, 1),
    p.venerdiSanto,
    p.lunediAngelo,
    fixed(year, 5, 1),
    fixed(year, 12, 25),
  ]
}

function chiusureUsa(year) {
  const p = pasquali(year)

  return [
    usObserved(fixed(year, 1, 1)),
    nthWeekday(year, 1, 1, 3), // Martin Luther King, terzo lunedi
    nthWeekday(year, 2, 1, 3), // Presidents Day, terzo lunedi
    p.venerdiSanto,
    lastWeekday(year, 5, 1), // Memorial Day, ultimo lunedi
    usObserved(fixed(year, 6, 19)), // Juneteenth
    usObserved(fixed(year, 7, 4)), // Indipendenza
    nthWeekday(year, 9, 1, 1), // Labor Day, primo lunedi
    nthWeekday(year, 11, 4, 4), // Ringraziamento, quarto giovedi
    usObserved(fixed(year, 12, 25)),
  ]
}

const REGOLE = {
  europe: chiusureEuropaComuni,
  euronext: chiusureEuronext,
  oslo: chiusureOslo,
  xetra: chiusureXetra,
  six: chiusureSix,
  nordic: chiusureNordic,
  bme: chiusureBme,
  usa: chiusureUsa,
}

// --- Chiusure non calcolabili per regola ------------------------------------
const CHIUSURE_ELENCATE = {
  tokyo: {
    2026: [
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-12', '2026-02-11',
      '2026-02-23', '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04',
      '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11', '2026-09-21',
      '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
      '2026-12-31',
    ],
    2027: [
      '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-11', '2027-02-11',
      '2027-02-23', '2027-03-21', '2027-04-29', '2027-05-03', '2027-05-04',
      '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-22',
      '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23', '2027-12-31',
    ],
  },
  'hong-kong': {
    2026: [
      '2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19', '2026-04-03',
      '2026-04-04', '2026-04-06', '2026-04-07', '2026-05-01', '2026-05-25',
      '2026-06-19', '2026-07-01', '2026-09-26', '2026-10-01', '2026-10-19',
      '2026-12-25', '2026-12-26',
    ],
    2027: [
      '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
      '2027-03-26', '2027-03-29', '2027-04-05', '2027-05-01', '2027-05-13',
      '2027-06-09', '2027-07-01', '2027-09-16', '2027-10-01', '2027-10-08',
      '2027-12-25', '2027-12-27',
    ],
  },
  // Euronext osserva il Natale il 24 quando il 25 e il 26 cadono nel fine
  // settimana, come nel 2027.
  euronext: {
    2027: ['2027-12-24'],
  },
}

// --- Da quale borsa dipende un titolo europeo -------------------------------
const BORSA_PER_SUFFISSO = {
  '.MI': 'euronext',
  '.PA': 'euronext',
  '.AS': 'euronext',
  '.BR': 'euronext',
  '.LS': 'euronext',
  '.OL': 'oslo',
  '.DE': 'xetra',
  '.F': 'xetra',
  '.SW': 'six',
  '.VX': 'six',
  '.ST': 'nordic',
  '.CO': 'nordic',
  '.HE': 'nordic',
  '.MC': 'bme',
}

export function getExchangeIdForTicker(sessionId, ticker) {
  if (sessionId !== 'europe' || !ticker) {
    return sessionId
  }

  const normalizzato = String(ticker).toUpperCase()
  const suffisso = Object.keys(BORSA_PER_SUFFISSO).find((chiave) =>
    normalizzato.endsWith(chiave),
  )

  return suffisso ? BORSA_PER_SUFFISSO[suffisso] : 'europe'
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

// Vero quando per quella borsa esiste almeno una chiusura nota per l'anno.
// Serve a distinguere "oggi si scambia" da "il calendario e scaduto": le borse
// asiatiche dipendono da liste elencate, che vanno rinnovate.
export function hasCalendarFor(exchangeId, year) {
  return getExchangeHolidays(exchangeId, year).size > 0
}

export function isExchangeHoliday(exchangeId, isoDate, ticker = null) {
  const year = Number(String(isoDate).slice(0, 4))

  if (!Number.isFinite(year)) {
    return false
  }

  const borsa = getExchangeIdForTicker(exchangeId, ticker)

  return getExchangeHolidays(borsa, year).has(String(isoDate))
}

export function isWeekend(weekday) {
  return weekday === 0 || weekday === 6
}

// Rete per le chiusure lunghe non previste dal calendario. Non puo essere piu
// stretta di cosi perche durante una seduta normale l'ultima barra giornaliera
// chiusa e quella del giorno di borsa precedente, quindi un fine settimana piu
// una festivita valgono gia quattro giorni di distanza legittimi.
export const MAX_ETA_DATO_GIORNI = 4

export function isMarketDataStale(latestBarDate, now = new Date()) {
  if (!latestBarDate) {
    return false
  }

  const barra = new Date(`${String(latestBarDate).slice(0, 10)}T00:00:00Z`)

  if (!Number.isFinite(barra.getTime())) {
    return false
  }

  return (now.getTime() - barra.getTime()) / 86_400_000 > MAX_ETA_DATO_GIORNI
}
