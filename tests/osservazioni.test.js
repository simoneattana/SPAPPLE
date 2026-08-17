// Modalita osservazione, aggiunta il 2026-08-17.
//
// Registra ogni segnale, anche quelli che il motore non apre, e ne segue il
// prezzo a un'ora, un giorno, tre giorni e una settimana. Serve a rispondere
// alla domanda «quanto conviene tenere aperta una posizione», che il solo
// trading non puo risolvere: apre al massimo 8 posizioni per mercato e le
// chiude con una regola sola, quindi impara di una cosa alla volta.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAX_OSSERVAZIONI,
  ORIZZONTI,
  createObservation,
  getObservationStats,
  pruneObservations,
  registerObservations,
  updateObservations,
} from '../src/services/engine/observations.js'

const riga = (ticker, currentPrice, rsi = 75) => ({
  ticker,
  currentPrice,
  rsi,
  atr: currentPrice * 0.02,
  status: 'ok',
  pe: 12,
})

const ORE = 3_600_000

describe('registrazione dei segnali', () => {
  it('registra ticker, direzione, prezzo e la decisione presa', () => {
    const o = createObservation({
      row: riga('SAP.DE', 100),
      type: 'SHORT',
      marketId: 'equities',
      decisione: 'aperta',
      now: new Date('2026-08-17T09:00:00Z'),
    })

    assert.equal(o.ticker, 'SAP.DE')
    assert.equal(o.type, 'SHORT')
    assert.equal(o.prezzo, 100)
    assert.equal(o.decisione, 'aperta')
    assert.deepEqual(o.rilevazioni, {})
  })

  it('scarta le righe senza prezzo utilizzabile', () => {
    assert.equal(createObservation({ row: riga('X.DE', 0), type: 'SHORT', marketId: 'equities' }), null)
    assert.equal(createObservation({ row: { ticker: 'X.DE' }, type: 'SHORT', marketId: 'equities' }), null)
    assert.equal(createObservation({ row: riga('X.DE', 100), type: null, marketId: 'equities' }), null)
  })

  it('registra anche i segnali che il motore non ha aperto', () => {
    const elenco = registerObservations(
      [],
      [
        { row: riga('A.DE', 100), type: 'SHORT' },
        { row: riga('B.DE', 50), type: 'LONG' },
        { row: riga('C.DE', 20), type: 'SHORT' },
      ],
      {
        marketId: 'equities',
        decisioni: { 'A.DE': 'aperta', 'B.DE': 'rifiutata-costi' },
        now: new Date('2026-08-17T09:00:00Z'),
      },
    )

    assert.equal(elenco.length, 3)
    assert.equal(elenco.find((o) => o.ticker === 'A.DE').decisione, 'aperta')
    assert.equal(elenco.find((o) => o.ticker === 'B.DE').decisione, 'rifiutata-costi')
    assert.equal(elenco.find((o) => o.ticker === 'C.DE').decisione, 'non-selezionata')
  })

  // La scansione gira ogni 15 minuti: senza questo vincolo lo stesso segnale
  // verrebbe registrato decine di volte al giorno, gonfiando il campione senza
  // aggiungere una sola informazione.
  it('lo stesso titolo nello stesso giorno si registra una volta sola', () => {
    const opzioni = { marketId: 'equities', now: new Date('2026-08-17T09:00:00Z') }
    let elenco = registerObservations([], [{ row: riga('A.DE', 100), type: 'SHORT' }], opzioni)
    elenco = registerObservations(elenco, [{ row: riga('A.DE', 101), type: 'SHORT' }], {
      ...opzioni,
      now: new Date('2026-08-17T14:00:00Z'),
    })

    assert.equal(elenco.length, 1)
    assert.equal(elenco[0].prezzo, 100, 'resta il primo prezzo del giorno')
  })

  it('ma il giorno dopo si registra di nuovo', () => {
    const primo = registerObservations([], [{ row: riga('A.DE', 100), type: 'SHORT' }], {
      marketId: 'equities',
      now: new Date('2026-08-17T09:00:00Z'),
    })
    const secondo = registerObservations(primo, [{ row: riga('A.DE', 104), type: 'SHORT' }], {
      marketId: 'equities',
      now: new Date('2026-08-18T09:00:00Z'),
    })

    assert.equal(secondo.length, 2)
  })

  it('anche la direzione opposta sullo stesso titolo e un segnale diverso', () => {
    const opzioni = { marketId: 'equities', now: new Date('2026-08-17T09:00:00Z') }
    let elenco = registerObservations([], [{ row: riga('A.DE', 100), type: 'SHORT' }], opzioni)
    elenco = registerObservations(elenco, [{ row: riga('A.DE', 100), type: 'LONG' }], opzioni)

    assert.equal(elenco.length, 2)
  })
})

describe('rilevazioni successive', () => {
  const nascita = new Date('2026-08-17T09:00:00Z')
  const base = () =>
    registerObservations([], [{ row: riga('A.DE', 100), type: 'SHORT' }], {
      marketId: 'equities',
      now: nascita,
    })

  it('prima che scada un orizzonte non rileva niente', () => {
    const dopo = updateObservations(base(), { 'A.DE': 105 }, new Date(nascita.getTime() + 30 * 60_000))

    assert.deepEqual(dopo[0].rilevazioni, {})
  })

  it('passata un ora rileva il primo orizzonte', () => {
    const dopo = updateObservations(base(), { 'A.DE': 98 }, new Date(nascita.getTime() + ORE))
    const r = dopo[0].rilevazioni['1h']

    assert.equal(r.prezzo, 98)
    assert.equal(r.variazionePct, -2)
    assert.equal(r.resaPct, 2, 'uno short guadagna quando il prezzo scende')
  })

  it('per un long la resa segue il prezzo', () => {
    const elenco = registerObservations([], [{ row: riga('B.DE', 100), type: 'LONG' }], {
      marketId: 'equities',
      now: nascita,
    })
    const dopo = updateObservations(elenco, { 'B.DE': 103 }, new Date(nascita.getTime() + ORE))

    assert.equal(dopo[0].rilevazioni['1h'].resaPct, 3)
  })

  it('registra le ore davvero trascorse, non quelle nominali', () => {
    const dopo = updateObservations(base(), { 'A.DE': 99 }, new Date(nascita.getTime() + 1.4 * ORE))

    assert.equal(dopo[0].rilevazioni['1h'].oreEffettive, 1.4)
  })

  it('non riscrive un orizzonte gia rilevato', () => {
    let elenco = updateObservations(base(), { 'A.DE': 98 }, new Date(nascita.getTime() + ORE))
    elenco = updateObservations(elenco, { 'A.DE': 90 }, new Date(nascita.getTime() + 2 * ORE))

    assert.equal(elenco[0].rilevazioni['1h'].prezzo, 98, 'la prima rilevazione resta')
  })

  it('a distanza di una settimana riempie tutti gli orizzonti in un colpo', () => {
    const dopo = updateObservations(base(), { 'A.DE': 90 }, new Date(nascita.getTime() + 8 * 24 * ORE))

    for (const orizzonte of ORIZZONTI) {
      assert.ok(dopo[0].rilevazioni[orizzonte.id], orizzonte.id)
    }
  })

  it('senza prezzo per quel titolo non inventa niente', () => {
    const dopo = updateObservations(base(), {}, new Date(nascita.getTime() + 8 * 24 * ORE))

    assert.deepEqual(dopo[0].rilevazioni, {})
  })
})

describe('pulizia', () => {
  it('non supera il tetto di osservazioni', () => {
    const troppe = Array.from({ length: MAX_OSSERVAZIONI + 50 }, (_, i) => ({
      marketId: 'equities',
      ticker: `T${i}.DE`,
      type: 'SHORT',
      registrataIl: new Date().toISOString(),
      prezzo: 100,
      rilevazioni: {},
    }))

    assert.equal(pruneObservations(troppe).length, MAX_OSSERVAZIONI)
  })

  it('tiene le vecchie a cui mancano ancora rilevazioni', () => {
    const vecchia = {
      marketId: 'equities',
      ticker: 'A.DE',
      type: 'SHORT',
      registrataIl: '2026-01-01T09:00:00Z',
      prezzo: 100,
      rilevazioni: { '1h': { prezzo: 99 } },
    }

    assert.equal(pruneObservations([vecchia], new Date('2026-08-17T09:00:00Z')).length, 1)
  })

  it('scarta le voci senza data valida', () => {
    assert.equal(pruneObservations([{ ticker: 'A.DE', registrataIl: null }]).length, 0)
  })
})

describe('statistiche per orizzonte', () => {
  it('contano le giornate, non le osservazioni', () => {
    const stessoGiorno = Array.from({ length: 6 }, (_, i) => ({
      marketId: 'asia',
      ticker: `T${i}.HK`,
      type: 'SHORT',
      registrataIl: '2026-08-17T02:00:00Z',
      prezzo: 100,
      rilevazioni: { '1g': { resaPct: 1 } },
    }))

    const stats = getObservationStats(stessoGiorno).find((s) => s.orizzonte === '1g')

    assert.equal(stats.osservazioni, 6)
    assert.equal(stats.giornate, 1, 'sei segnali dello stesso giorno sono una misura')
    assert.equal(stats.resaMediaPct, 1)
    assert.equal(stats.quotaPositive, 1)
  })

  it('un orizzonte senza rilevazioni resta a zero, non a un numero inventato', () => {
    const stats = getObservationStats([
      {
        marketId: 'equities',
        ticker: 'A.DE',
        type: 'SHORT',
        registrataIl: '2026-08-17T09:00:00Z',
        prezzo: 100,
        rilevazioni: {},
      },
    ])

    for (const riga of stats) {
      assert.equal(riga.osservazioni, 0, riga.orizzonte)
      assert.equal(riga.giornate, 0, riga.orizzonte)
    }
  })
})
