import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getTradingStrategy } from '../src/strategies/index.js'
import {
  getNextMarketScanAt,
  isMarketCloseGuardActive,
  isMarketScanBlocked,
} from '../src/services/marketHours.js'
import {
  getEasterSunday,
  isExchangeHoliday,
  isMarketDataStale,
} from '../src/services/engine/marketCalendar.js'

const equities = getTradingStrategy('equities')
const usa = getTradingStrategy('usa')
const asia = getTradingStrategy('asia')
const crypto = getTradingStrategy('crypto')

const at = (iso) => new Date(iso)

describe('fine settimana', () => {
  // Regressione del 2026-08-16. marketHours leggeva solo ore e minuti, mai il
  // giorno: sabato e domenica erano sedute normali. Il 2 agosto 2026, domenica,
  // Spapple ha aperto e chiuso tre posizioni su Europa e USA a borse chiuse, e
  // quelle tre perdite sono le stesse che hanno poi fatto scattare il blocco.
  it('nessun mercato azionario scansiona di sabato', () => {
    assert.equal(isMarketScanBlocked(equities, at('2026-08-22T09:00:00Z')), true)
    assert.equal(isMarketScanBlocked(usa, at('2026-08-22T15:00:00Z')), true)
    assert.equal(isMarketScanBlocked(asia, at('2026-08-22T01:00:00Z'), '6758.TSE'), true)
  })

  it('nessun mercato azionario scansiona di domenica', () => {
    assert.equal(isMarketScanBlocked(equities, at('2026-08-23T09:00:00Z')), true)
    assert.equal(isMarketScanBlocked(usa, at('2026-08-23T15:00:00Z')), true)
    assert.equal(isMarketScanBlocked(asia, at('2026-08-23T02:00:00Z'), '9618.HK'), true)
  })

  it('la domenica del 2 agosto 2026, quella delle tre posizioni fantasma', () => {
    assert.equal(isMarketScanBlocked(equities, at('2026-08-02T13:32:00Z')), true)
    assert.equal(isMarketScanBlocked(usa, at('2026-08-02T13:35:00Z')), true)
  })

  it('il lunedi in orario di seduta si scansiona', () => {
    assert.equal(isMarketScanBlocked(equities, at('2026-08-24T09:00:00Z')), false)
    assert.equal(isMarketScanBlocked(usa, at('2026-08-24T15:00:00Z')), false)
  })

  it('il crypto non chiude mai, nemmeno di domenica', () => {
    assert.equal(isMarketScanBlocked(crypto, at('2026-08-23T09:00:00Z')), false)
    assert.equal(isMarketScanBlocked(crypto, at('2026-12-25T09:00:00Z')), false)
  })
})

describe('festivita', () => {
  it('Europa chiusa a Natale, Santo Stefano e Capodanno', () => {
    assert.equal(isMarketScanBlocked(equities, at('2026-12-25T10:00:00Z')), true)
    assert.equal(isMarketScanBlocked(equities, at('2027-01-01T10:00:00Z')), true)
  })

  it('Europa chiusa il Venerdi Santo e il Lunedi dell Angelo', () => {
    // Pasqua 2026 cade il 5 aprile
    assert.equal(isExchangeHoliday('europe', '2026-04-03'), true)
    assert.equal(isExchangeHoliday('europe', '2026-04-06'), true)
    assert.equal(isExchangeHoliday('europe', '2026-04-07'), false)
  })

  it('USA chiusa a Thanksgiving e il 3 luglio quando il 4 cade di sabato', () => {
    assert.equal(isMarketScanBlocked(usa, at('2026-11-26T16:00:00Z')), true)
    assert.equal(isExchangeHoliday('usa', '2026-07-03'), true, '4 luglio osservato')
    assert.equal(isExchangeHoliday('usa', '2026-07-04'), false, 'il 4 e sabato')
  })

  it('USA: le feste a data mobile cadono dove devono', () => {
    assert.equal(isExchangeHoliday('usa', '2026-01-19'), true, 'MLK, terzo lunedi')
    assert.equal(isExchangeHoliday('usa', '2026-05-25'), true, 'Memorial, ultimo lunedi')
    assert.equal(isExchangeHoliday('usa', '2026-09-07'), true, 'Labor, primo lunedi')
  })

  it('Tokyo chiusa nella Golden Week e a fine anno', () => {
    for (const giorno of ['2026-04-29', '2026-05-04', '2026-05-05', '2026-12-31']) {
      assert.equal(isExchangeHoliday('tokyo', giorno), true, giorno)
    }
  })

  it('Hong Kong chiusa per il Capodanno lunare', () => {
    for (const giorno of ['2026-02-17', '2026-02-18', '2026-02-19']) {
      assert.equal(isExchangeHoliday('hong-kong', giorno), true, giorno)
    }
  })

  it('un giorno feriale qualunque non e festivo', () => {
    assert.equal(isExchangeHoliday('europe', '2026-08-19'), false)
    assert.equal(isExchangeHoliday('usa', '2026-08-19'), false)
  })
})

describe('calcolo della Pasqua', () => {
  it('cade nelle date giuste negli anni di riferimento', () => {
    assert.equal(getEasterSunday(2026).toISOString().slice(0, 10), '2026-04-05')
    assert.equal(getEasterSunday(2027).toISOString().slice(0, 10), '2027-03-28')
    assert.equal(getEasterSunday(2025).toISOString().slice(0, 10), '2025-04-20')
  })
})

describe('ripartenza dopo una pausa di rischio', () => {
  // Il governo del rischio calcola le pause con getNextMarketScanAt. Prima una
  // pausa decisa il venerdi sera ripartiva il sabato mattina.
  it('una pausa del venerdi sera riparte il lunedi', () => {
    const next = getNextMarketScanAt(equities, at('2026-08-21T16:00:00Z'))
    assert.equal(next.toISOString().slice(0, 10), '2026-08-24')
    assert.equal(next.getUTCDay(), 1, 'lunedi')
  })

  it('una pausa della vigilia di Natale salta le feste e riparte il 28', () => {
    const next = getNextMarketScanAt(equities, at('2026-12-24T16:30:00Z'))
    assert.equal(next.toISOString().slice(0, 10), '2026-12-28')
  })

  it('la ripartenza non cade mai di sabato o domenica', () => {
    for (const giorno of ['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']) {
      const next = getNextMarketScanAt(equities, at(`${giorno}T18:00:00Z`))
      assert.ok(next.getUTCDay() !== 0 && next.getUTCDay() !== 6, `da ${giorno}`)
    }
  })
})

describe('protezione di fine seduta nei giorni chiusi', () => {
  it('non si attiva di domenica: non c e nessuna seduta da proteggere', () => {
    assert.equal(isMarketCloseGuardActive(equities, at('2026-08-23T15:15:00Z')), false)
  })
})

describe('freschezza del dato, rete per le chiusure lunghe', () => {
  const adesso = at('2026-08-24T10:00:00Z')

  it('un dato di venerdi guardato lunedi e ancora buono', () => {
    assert.equal(isMarketDataStale('2026-08-21', adesso), false)
  })

  it('un dato piu vecchio di quattro giorni segnala borsa ferma', () => {
    assert.equal(isMarketDataStale('2026-08-18', adesso), true)
    assert.equal(isMarketDataStale('2026-08-10', adesso), true)
  })

  it('senza data non si blocca niente', () => {
    assert.equal(isMarketDataStale(null, adesso), false)
    assert.equal(isMarketDataStale(undefined, adesso), false)
  })
})
