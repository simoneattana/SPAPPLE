// Regressione del 2026-08-17, trovata accendendo il motore in produzione.
//
// Il monitor backend riportava «aperte: 3» ma nello stato salvato non c'era
// nessuna posizione. Le aperture sparivano fra il calcolo e il salvataggio.
//
// Causa: il motore aggiorna i campi alla radice dello stato, mentre
// syncActiveMarketState legge le posizioni da markets[mercato]. Se markets non
// viene aggiornato prima, la copia vecchia vince e le modifiche appena
// calcolate finiscono nel cestino.
//
// Il ramo principale del monitor lo faceva gia a mano. I quattro rami di uscita
// anticipata no, ed e per questo che il difetto si vedeva solo quando non
// c'erano posizioni da valutare: con posizioni aperte si passava dal ramo
// giusto. Il 3 agosto ce n'erano, e infatti allora aveva funzionato.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeTradingState, withMarketState } from '../api/_tradingEngine.js'

function statoConMercatoVuoto() {
  const base = normalizeTradingState({ activeMarket: 'equities' })
  const mercato = base.markets.equities

  // Come arriva a runBackendMonitor: radice e mercato attivo appiattiti insieme
  return { ...base, activeMarket: 'equities', ...mercato }
}

const posizioneFinta = {
  id: 'TEST.DE-SHORT-1',
  ticker: 'TEST.DE',
  type: 'SHORT',
  marketId: 'equities',
  openedAt: new Date().toISOString(),
  invested: 3000,
  quantity: 30,
  entryPrice: 100,
  entryPriceEur: 100,
  stopLoss: 103,
  takeProfit: 99.4,
}

describe('le modifiche del monitor sopravvivono al salvataggio', () => {
  it('una posizione aggiunta alla radice finisce anche dentro markets', () => {
    const current = statoConMercatoVuoto()
    assert.equal(current.markets.equities.positions.length, 0, 'si parte da zero')

    const risultato = withMarketState(current, { positions: [posizioneFinta] })

    assert.equal(risultato.positions.length, 1, 'alla radice')
    assert.equal(risultato.markets.equities.positions.length, 1, 'dentro markets')
    assert.equal(risultato.markets.equities.positions[0].ticker, 'TEST.DE')
  })

  it('e ci resta anche dopo la normalizzazione che precede la scrittura', () => {
    const current = statoConMercatoVuoto()
    const risultato = normalizeTradingState(
      withMarketState(current, { positions: [posizioneFinta] }),
    )

    assert.equal(risultato.markets.equities.positions.length, 1)
  })

  it('vale anche per capitale e ordini, non solo per le posizioni', () => {
    const current = statoConMercatoVuoto()
    const ordine = {
      id: 'ordine-test',
      action: 'OPEN',
      status: 'ESEGUITO',
      ticker: 'TEST.DE',
      createdAt: new Date().toISOString(),
      notional: 3000,
    }

    const risultato = withMarketState(current, { orders: [ordine], capital: 27000 })

    assert.equal(risultato.markets.equities.orders.length, 1)
    assert.equal(risultato.markets.equities.capital, 27000)
  })

  it('gli altri mercati non vengono toccati', () => {
    const current = statoConMercatoVuoto()
    const risultato = withMarketState(current, { positions: [posizioneFinta] })

    for (const altro of ['usa', 'asia', 'crypto']) {
      assert.equal(risultato.markets[altro].positions.length, 0, altro)
    }
  })
})
