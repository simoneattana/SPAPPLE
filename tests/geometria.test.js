import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getTradingStrategy } from '../src/strategies/index.js'
import {
  buildTrade,
  evaluateProfitExit,
  getProtectedStopLoss,
  getSignalType,
} from '../src/services/engine/trades.js'

const asia = getTradingStrategy('asia')
const equities = getTradingStrategy('equities')

const riga = (ticker, rsi) => ({
  ticker,
  rsi,
  status: 'ok',
  pe: 12,
  currentPrice: 100,
  atr: 2,
  currency: 'EUR',
  fxToEur: 1,
})

function apri(row, strategy, type) {
  return buildTrade({
    ticker: row.ticker,
    price: row.currentPrice,
    atr: row.atr,
    type,
    invested: 2000,
    strategy,
    marketData: row,
  })
}

describe('geometria di apertura', () => {
  it('un LONG ha il target sopra e lo stop sotto il prezzo di ingresso', () => {
    const trade = apri(riga('NN.AS', 25), equities, 'LONG')

    assert.equal(trade.type, 'LONG')
    assert.ok(trade.takeProfit > trade.entryPrice, 'target sopra')
    assert.ok(trade.finalTakeProfit > trade.takeProfit, 'target massimo piu lontano')
    assert.ok(trade.stopLoss < trade.entryPrice, 'stop sotto')
    assert.equal(trade.initialStopLoss, trade.stopLoss)
  })

  it('uno SHORT ha il target sotto e lo stop sopra', () => {
    const trade = apri(riga('NN.AS', 75), equities, 'SHORT')

    assert.equal(trade.type, 'SHORT')
    assert.ok(trade.takeProfit < trade.entryPrice, 'target sotto')
    assert.ok(trade.finalTakeProfit < trade.takeProfit, 'target massimo piu lontano')
    assert.ok(trade.stopLoss > trade.entryPrice, 'stop sopra')
  })

  it('apre senza profitto bloccato e con il prezzo favorevole sull ingresso', () => {
    const trade = apri(riga('NN.AS', 25), equities, 'LONG')

    assert.equal(trade.profitLockArmed, false)
    assert.equal(trade.favorablePrice, trade.entryPrice)
    assert.equal(trade.daysHeld, 0)
    assert.ok(trade.quantity > 0)
  })

  // Regressione del 2026-08-16. La copia backend di buildTrade ricalcolava la
  // direzione con `row.rsi < 30 ? 'LONG' : 'SHORT'` su tutti i mercati: su Asia,
  // dove il LONG scatta sotto 35, un titolo a RSI 31,18 come 4063.TSE veniva
  // aperto SHORT, cioe nella direzione opposta al segnale.
  it('Asia a RSI 31,18: la direzione decisa e quella che finisce nel trade', () => {
    const row = riga('4063.TSE', 31.18)
    const type = getSignalType(row, asia)

    assert.equal(type, 'LONG')

    const trade = apri(row, asia, type)

    assert.equal(trade.type, 'LONG')
    assert.ok(trade.stopLoss < trade.entryPrice, 'lo stop di un LONG sta sotto')
  })

  it('quando non c e segnale non c e direzione da passare a buildTrade', () => {
    assert.equal(getSignalType(riga('4063.TSE', 50), asia), null)
    assert.equal(getSignalType(riga('NN.AS', 50), equities), null)
  })
})

describe('uscite in profitto', () => {
  const base = {
    type: 'LONG',
    entryPrice: 100,
    takeProfit: 101,
    finalTakeProfit: 102,
    trailingPct: 0.3,
    favorablePrice: 100,
  }

  it('sotto il primo target non arma niente', () => {
    const esito = evaluateProfitExit(base, 100.5)

    assert.equal(esito.isWin, false)
    assert.equal(esito.monitoredFields.profitLockArmed, false)
    assert.equal(esito.monitoredFields.trailingStopPrice, null)
  })

  it('raggiunto il primo target arma il trailing e alza il prezzo favorevole', () => {
    const esito = evaluateProfitExit(base, 101.5)

    assert.equal(esito.monitoredFields.profitLockArmed, true)
    assert.equal(esito.monitoredFields.favorablePrice, 101.5)
    assert.ok(esito.monitoredFields.trailingStopPrice < 101.5)
  })

  it('al target massimo chiude in vittoria', () => {
    const esito = evaluateProfitExit(base, 102.5)

    assert.equal(esito.isWin, true)
    assert.equal(esito.exitReason, 'TAKE_PROFIT_MAX')
  })

  it('senza trailing la regola resta il target semplice', () => {
    const esito = evaluateProfitExit({ ...base, trailingPct: null }, 101.2)

    assert.equal(esito.exitReason, 'TAKE_PROFIT')
    assert.equal(esito.isWin, true)
  })
})

describe('stop protetto', () => {
  it('con profitto bloccato lo stop di un LONG non scende sotto l ingresso', () => {
    const stop = getProtectedStopLoss(
      { type: 'LONG', entryPrice: 100, stopLoss: 97, trailingPct: 0.3 },
      { monitoredFields: { profitLockArmed: true } },
    )

    assert.equal(stop, 100)
  })

  it('con profitto bloccato lo stop di uno SHORT non sale sopra l ingresso', () => {
    const stop = getProtectedStopLoss(
      { type: 'SHORT', entryPrice: 100, stopLoss: 103, trailingPct: 0.3 },
      { monitoredFields: { profitLockArmed: true } },
    )

    assert.equal(stop, 100)
  })

  it('senza profitto bloccato lo stop resta dov era', () => {
    const stop = getProtectedStopLoss(
      { type: 'LONG', entryPrice: 100, stopLoss: 97, trailingPct: 0.3 },
      { monitoredFields: { profitLockArmed: false } },
    )

    assert.equal(stop, 97)
  })
})
