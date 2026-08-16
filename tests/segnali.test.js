import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASIA_LONG_RSI_LIMIT,
  ASIA_SHORT_RSI_LIMIT,
  DEFAULT_LONG_RSI_LIMIT,
  DEFAULT_SHORT_RSI_LIMIT,
  getEquitySignalThresholds,
  getEquitySignalType,
} from '../src/services/tradingRules.js'

const row = (ticker, rsi) => ({ ticker, rsi, status: 'ok', pe: 10 })

describe('soglie RSI per mercato', () => {
  it('Europa e USA usano 30 e 70', () => {
    for (const ticker of ['NN.AS', 'REGN.US', 'UBSG.SW']) {
      const t = getEquitySignalThresholds(ticker)
      assert.equal(t.long, DEFAULT_LONG_RSI_LIMIT)
      assert.equal(t.short, DEFAULT_SHORT_RSI_LIMIT)
    }
  })

  it('Asia usa 35 e 65', () => {
    for (const ticker of ['9618.HK', '6501.TSE']) {
      const t = getEquitySignalThresholds(ticker)
      assert.equal(t.long, ASIA_LONG_RSI_LIMIT)
      assert.equal(t.short, ASIA_SHORT_RSI_LIMIT)
    }
  })
})

describe('direzione del segnale', () => {
  it('Europa: sotto 30 e LONG, sopra 70 e SHORT, in mezzo nessun segnale', () => {
    assert.equal(getEquitySignalType(row('NN.AS', 29.9)), 'LONG')
    assert.equal(getEquitySignalType(row('NN.AS', 70.1)), 'SHORT')
    assert.equal(getEquitySignalType(row('NN.AS', 50)), null)
  })

  it('Asia: sotto 35 e LONG, sopra 65 e SHORT', () => {
    assert.equal(getEquitySignalType(row('9618.HK', 34.9)), 'LONG')
    assert.equal(getEquitySignalType(row('9618.HK', 65.1)), 'SHORT')
    assert.equal(getEquitySignalType(row('9618.HK', 50)), null)
  })

  // Regressione del 2026-08-16: il motore backend calcolava la direzione con
  // le soglie 30/70 su tutti i mercati. Su Asia un titolo a RSI 31 e un LONG,
  // ma il backend lo apriva SHORT perche non era sotto 30.
  it('Asia a RSI 31,18 e un LONG, non uno SHORT', () => {
    assert.equal(getEquitySignalType(row('4063.TSE', 31.18)), 'LONG')
  })

  it('Asia nella fascia 65-70 da SHORT, dove il backend non dava nulla', () => {
    for (const rsi of [65.62, 68.33, 69.39]) {
      assert.equal(getEquitySignalType(row('9618.HK', rsi)), 'SHORT')
    }
  })

  it('nessuna direzione senza RSI utilizzabile', () => {
    assert.equal(getEquitySignalType(row('NN.AS', undefined)), null)
    assert.equal(getEquitySignalType(row('NN.AS', null)), null)
  })
})
