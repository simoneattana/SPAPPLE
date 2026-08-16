// Validazione delle regole del calendario contro i calendari pubblicati dalle
// borse. Le regole servono a non dover riscrivere le date ogni anno, ma valgono
// solo se riproducono esattamente le liste ufficiali.
//
// Il confronto ignora sabato e domenica: le regole elencano anche le feste che
// cadono nel fine settimana, i calendari ufficiali no, e in ogni caso il
// controllo sul fine settimana le assorbe prima.
//
// Fonti consultate il 2026-08-16:
//   six-group.com, euronext.com, cashmarket.deutsche-boerse.com,
//   nasdaqomxnordic.com, jpx.co.jp, hkex.com.hk

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getExchangeHolidays,
  getExchangeIdForTicker,
  hasCalendarFor,
  isExchangeHoliday,
} from '../src/services/engine/marketCalendar.js'

function feriali(date) {
  const giorno = new Date(`${date}T00:00:00Z`).getUTCDay()
  return giorno !== 0 && giorno !== 6
}

function calcolate(exchangeId, year) {
  return [...getExchangeHolidays(exchangeId, year)].filter(feriali).sort()
}

function verifica(exchangeId, year, ufficiali) {
  assert.deepEqual(calcolate(exchangeId, year), ufficiali.filter(feriali).sort())
}

describe('le regole riproducono i calendari ufficiali', () => {
  it('SIX Swiss Exchange 2026', () => {
    verifica('six', 2026, [
      '2026-01-01', '2026-01-02', '2026-04-03', '2026-04-06', '2026-05-01',
      '2026-05-14', '2026-05-25', '2026-08-01', '2026-12-24', '2026-12-25',
      '2026-12-31',
    ])
  })

  it('SIX Swiss Exchange 2027', () => {
    verifica('six', 2027, [
      '2027-01-01', '2027-01-02', '2027-03-26', '2027-03-29', '2027-05-01',
      '2027-05-06', '2027-05-17', '2027-08-01', '2027-12-24', '2027-12-25',
      '2027-12-31',
    ])
  })

  it('Euronext 2026: Milano, Parigi, Amsterdam', () => {
    verifica('euronext', 2026, [
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-25',
    ])
  })

  it('Euronext 2027, con il Natale osservato il 24', () => {
    verifica('euronext', 2027, [
      '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-01', '2027-12-24',
    ])
  })

  it('Oslo 2026: Euronext piu le feste norvegesi', () => {
    verifica('oslo', 2026, [
      '2026-01-01', '2026-04-02', '2026-04-03', '2026-04-06', '2026-05-01',
      '2026-05-14', '2026-05-25', '2026-12-24', '2026-12-25', '2026-12-31',
    ])
  })

  it('Xetra 2026', () => {
    verifica('xetra', 2026, [
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-24',
      '2026-12-25', '2026-12-31',
    ])
  })

  it('Nasdaq Nordic 2026: Stoccolma, Copenaghen, Helsinki', () => {
    verifica('nordic', 2026, [
      '2026-01-01', '2026-01-06', '2026-04-03', '2026-04-06', '2026-05-01',
      '2026-05-14', '2026-06-19', '2026-12-24', '2026-12-25', '2026-12-31',
    ])
  })

  it('BME Madrid 2026', () => {
    verifica('bme', 2026, [
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-24',
      '2026-12-25', '2026-12-31',
    ])
  })

  it('Tokyo 2027', () => {
    verifica('tokyo', 2027, [
      '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-11', '2027-02-11',
      '2027-02-23', '2027-03-21', '2027-04-29', '2027-05-03', '2027-05-04',
      '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-22',
      '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23', '2027-12-31',
    ])
  })

  it('Hong Kong 2027, capodanno lunare di quattro giorni', () => {
    verifica('hong-kong', 2027, [
      '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
      '2027-03-26', '2027-03-29', '2027-04-05', '2027-05-01', '2027-05-13',
      '2027-06-09', '2027-07-01', '2027-09-16', '2027-10-01', '2027-10-08',
      '2027-12-25', '2027-12-27',
    ])
  })

  it('USA 2026, con il 4 luglio osservato il 3', () => {
    verifica('usa', 2026, [
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
      '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
    ])
  })
})

describe('ogni titolo europeo guarda la sua borsa', () => {
  it('il suffisso porta alla borsa giusta', () => {
    assert.equal(getExchangeIdForTicker('europe', 'ISP.MI'), 'euronext')
    assert.equal(getExchangeIdForTicker('europe', 'ACA.PA'), 'euronext')
    assert.equal(getExchangeIdForTicker('europe', 'ADYEN.AS'), 'euronext')
    assert.equal(getExchangeIdForTicker('europe', 'SAP.DE'), 'xetra')
    assert.equal(getExchangeIdForTicker('europe', 'UBSG.SW'), 'six')
    assert.equal(getExchangeIdForTicker('europe', 'VOLV-B.ST'), 'nordic')
    assert.equal(getExchangeIdForTicker('europe', 'MAERSK-B.CO'), 'nordic')
    assert.equal(getExchangeIdForTicker('europe', 'NOKIA.HE'), 'nordic')
    assert.equal(getExchangeIdForTicker('europe', 'EQNR.OL'), 'oslo')
    assert.equal(getExchangeIdForTicker('europe', 'SAN.MC'), 'bme')
  })

  it('senza titolo si usa il nucleo comune a tutte le borse europee', () => {
    assert.equal(getExchangeIdForTicker('europe', null), 'europe')
    assert.equal(isExchangeHoliday('europe', '2026-12-24'), false, 'non tutte chiudono')
    assert.equal(isExchangeHoliday('europe', '2026-12-25'), true, 'chiudono tutte')
  })

  it('la festa svizzera del 1 agosto non ferma Milano', () => {
    // Nel 2028 il 1 agosto cade di martedi
    assert.equal(isExchangeHoliday('europe', '2028-08-01', 'UBSG.SW'), true)
    assert.equal(isExchangeHoliday('europe', '2028-08-01', 'ISP.MI'), false)
  })

  it('la vigilia di Natale ferma Zurigo, Francoforte e Madrid ma non Parigi', () => {
    assert.equal(isExchangeHoliday('europe', '2026-12-24', 'UBSG.SW'), true)
    assert.equal(isExchangeHoliday('europe', '2026-12-24', 'SAP.DE'), true)
    assert.equal(isExchangeHoliday('europe', '2026-12-24', 'SAN.MC'), true)
    assert.equal(isExchangeHoliday('europe', '2026-12-24', 'ACA.PA'), false)
  })

  it('il Midsummer ferma Stoccolma e non le altre', () => {
    assert.equal(isExchangeHoliday('europe', '2026-06-19', 'VOLV-B.ST'), true)
    assert.equal(isExchangeHoliday('europe', '2026-06-19', 'ISP.MI'), false)
  })

  it('l Epifania ferma i nordici e non Milano', () => {
    assert.equal(isExchangeHoliday('europe', '2026-01-06', 'NOKIA.HE'), true)
    assert.equal(isExchangeHoliday('europe', '2026-01-06', 'ISP.MI'), false)
  })

  it('il giovedi santo ferma Oslo e non Amsterdam', () => {
    assert.equal(isExchangeHoliday('europe', '2026-04-02', 'EQNR.OL'), true)
    assert.equal(isExchangeHoliday('europe', '2026-04-02', 'ADYEN.AS'), false)
  })
})

describe('scadenza del calendario', () => {
  it('le borse a regola hanno un calendario per qualunque anno', () => {
    for (const borsa of ['europe', 'euronext', 'xetra', 'six', 'nordic', 'bme', 'usa']) {
      assert.equal(hasCalendarFor(borsa, 2030), true, borsa)
    }
  })

  it('le borse asiatiche dipendono da liste, e si vede quando scadono', () => {
    assert.equal(hasCalendarFor('tokyo', 2026), true)
    assert.equal(hasCalendarFor('tokyo', 2027), true)
    assert.equal(hasCalendarFor('tokyo', 2028), false, 'da rinnovare')
    assert.equal(hasCalendarFor('hong-kong', 2028), false, 'da rinnovare')
  })
})
