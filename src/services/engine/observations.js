// Modalita osservazione.
//
// Il motore apre al massimo 8 posizioni per mercato e le chiude quando decide
// la sua geometria. Cosi impara una cosa sola: com'e andata quella regola su
// quei pochi titoli. Di tutti gli altri segnali non sa niente.
//
// Qui invece si registra OGNI segnale, anche quelli che il motore non ha
// aperto e quelli che la guardia sui costi ha rifiutato, e si guarda cosa
// succede dopo un'ora, un giorno, tre giorni e una settimana. E il dato che
// serve per rispondere alla domanda «quanto conviene tenere aperta una
// posizione», che oggi nessuno sa.
//
// Non costa nessuna chiamata dati in piu: le rilevazioni successive si
// riempiono dai prezzi che la scansione scarica gia ogni quindici minuti.

import { getEquitySignalThresholds } from '../tradingRules.js'

export const ORIZZONTI = [
  { id: '1h', etichetta: '1 ora', ms: 60 * 60 * 1000 },
  { id: '1g', etichetta: '1 giorno', ms: 24 * 60 * 60 * 1000 },
  { id: '3g', etichetta: '3 giorni', ms: 3 * 24 * 60 * 60 * 1000 },
  { id: '7g', etichetta: '1 settimana', ms: 7 * 24 * 60 * 60 * 1000 },
]

export const MAX_OSSERVAZIONI = 400
const RITENZIONE_MS = 30 * 24 * 60 * 60 * 1000

function giorno(iso) {
  return String(iso || '').slice(0, 10)
}

// new Date(null) non e una data non valida: e il 1 gennaio 1970, e il suo
// getTime() e 0, che passa qualunque controllo su Number.isFinite. Serve
// escludere il valore assente prima di costruire la data.
function istante(valore) {
  if (valore === null || valore === undefined || valore === '') {
    return null
  }

  const tempo = new Date(valore).getTime()

  return Number.isFinite(tempo) ? tempo : null
}

// Una sola osservazione per titolo e direzione al giorno: la scansione gira
// ogni quindici minuti e senza questo vincolo lo stesso segnale finirebbe
// registrato decine di volte, gonfiando il campione senza aggiungere niente.
function chiave(osservazione) {
  return [
    osservazione.marketId,
    osservazione.ticker,
    osservazione.type,
    giorno(osservazione.registrataIl),
  ].join('|')
}

export function createObservation({ row, type, marketId, decisione, now = new Date() }) {
  const prezzo = Number(row?.currentPrice)

  if (!row?.ticker || !type || !Number.isFinite(prezzo) || prezzo <= 0) {
    return null
  }

  const soglie = getEquitySignalThresholds(row)

  return {
    marketId,
    ticker: row.ticker,
    type,
    registrataIl: now.toISOString(),
    prezzo,
    rsi: Number.isFinite(Number(row.rsi)) ? Number(row.rsi) : null,
    atrPct:
      Number.isFinite(Number(row.atr)) && prezzo > 0
        ? Number(((Number(row.atr) / prezzo) * 100).toFixed(3))
        : null,
    sogliaLong: soglie.long,
    sogliaShort: soglie.short,
    // aperta, rifiutata-costi, rifiutata-rischio, non-selezionata
    decisione: decisione || 'non-selezionata',
    rilevazioni: {},
  }
}

export function registerObservations(
  esistenti = [],
  righe = [],
  { marketId, decisioni = {}, now = new Date() } = {},
) {
  const elenco = Array.isArray(esistenti) ? [...esistenti] : []
  const viste = new Set(elenco.map(chiave))

  for (const { row, type } of righe) {
    const osservazione = createObservation({
      row,
      type,
      marketId,
      decisione: decisioni[row?.ticker],
      now,
    })

    if (!osservazione || viste.has(chiave(osservazione))) {
      continue
    }

    viste.add(chiave(osservazione))
    elenco.push(osservazione)
  }

  return elenco
}

// Riempie gli orizzonti scaduti usando i prezzi che la scansione ha appena
// scaricato. Registra anche quanto tempo e passato davvero, perche la
// rilevazione avviene alla prima scansione utile e non al minuto esatto.
export function updateObservations(esistenti = [], prezzi = {}, now = new Date()) {
  const adesso = now.getTime()

  return (Array.isArray(esistenti) ? esistenti : []).map((osservazione) => {
    const prezzoOra = Number(prezzi[osservazione.ticker])

    if (!Number.isFinite(prezzoOra) || prezzoOra <= 0) {
      return osservazione
    }

    const nascita = istante(osservazione.registrataIl)

    if (nascita === null) {
      return osservazione
    }

    const trascorso = adesso - nascita
    const rilevazioni = { ...(osservazione.rilevazioni || {}) }
    let cambiata = false

    for (const orizzonte of ORIZZONTI) {
      if (rilevazioni[orizzonte.id] || trascorso < orizzonte.ms) {
        continue
      }

      const variazionePct =
        ((prezzoOra - osservazione.prezzo) / osservazione.prezzo) * 100

      rilevazioni[orizzonte.id] = {
        prezzo: Number(prezzoOra.toFixed(6)),
        rilevataIl: now.toISOString(),
        oreEffettive: Number((trascorso / 3_600_000).toFixed(2)),
        variazionePct: Number(variazionePct.toFixed(4)),
        // Il rendimento dal punto di vista della scommessa: uno short guadagna
        // quando il prezzo scende.
        resaPct: Number(
          (osservazione.type === 'LONG' ? variazionePct : -variazionePct).toFixed(4),
        ),
      }
      cambiata = true
    }

    return cambiata ? { ...osservazione, rilevazioni } : osservazione
  })
}

export function pruneObservations(esistenti = [], now = new Date()) {
  const limite = now.getTime() - RITENZIONE_MS
  const complete = (osservazione) =>
    ORIZZONTI.every((o) => osservazione.rilevazioni?.[o.id])

  return (Array.isArray(esistenti) ? esistenti : [])
    .filter((osservazione) => {
      const nascita = istante(osservazione.registrataIl)

      if (nascita === null) {
        return false
      }

      // Si tiene finche non e vecchia, oppure finche mancano rilevazioni.
      return nascita >= limite || !complete(osservazione)
    })
    .slice(-MAX_OSSERVAZIONI)
}

// Statistiche per orizzonte, con la numerosita contata in giornate come da
// regola: osservazioni nate lo stesso giorno sullo stesso mercato valgono una.
export function getObservationStats(esistenti = []) {
  const elenco = Array.isArray(esistenti) ? esistenti : []

  return ORIZZONTI.map((orizzonte) => {
    const con = elenco.filter((o) => o.rilevazioni?.[orizzonte.id])
    const rese = con.map((o) => o.rilevazioni[orizzonte.id].resaPct)
    const giornate = new Set(con.map((o) => `${o.marketId}-${giorno(o.registrataIl)}`))
    const media = rese.length ? rese.reduce((s, x) => s + x, 0) / rese.length : 0
    const positive = rese.filter((x) => x > 0).length

    return {
      orizzonte: orizzonte.id,
      etichetta: orizzonte.etichetta,
      osservazioni: con.length,
      giornate: giornate.size,
      resaMediaPct: Number(media.toFixed(4)),
      quotaPositive: rese.length ? positive / rese.length : 0,
    }
  })
}
