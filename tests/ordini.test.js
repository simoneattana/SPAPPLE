import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  formatCooldownDuration,
  isSameDay,
  normalizeIdPart,
  roundPrice,
  roundQuantity,
} from '../src/services/engine/format.js'
import {
  compactOrder,
  createSimulationOrder,
  dedupeOrders,
  getCloseOrderSide,
  getOpenOrderSide,
} from '../src/services/engine/orders.js'

describe('arrotondamenti', () => {
  it('arrotondano a 4 e 8 decimali', () => {
    assert.equal(roundPrice(126.854712), 126.8547)
    assert.equal(roundQuantity(118.844312664321), 118.84431266)
  })

  // Regressione: la copia frontend faceva value.toFixed() diretto e andava in
  // errore su null o undefined, buttando giu la pagina.
  it('tornano null invece di rompersi su valori non utilizzabili', () => {
    for (const value of [null, undefined, 'ciao', Number.NaN, Infinity]) {
      assert.equal(roundPrice(value), null)
      assert.equal(roundQuantity(value), null)
    }
  })
})

describe('date e identificatori', () => {
  it('isSameDay confronta solo la parte data', () => {
    assert.equal(isSameDay('2026-08-16T22:59:00.000Z', '2026-08-16'), true)
    assert.equal(isSameDay('2026-08-17T00:01:00.000Z', '2026-08-16'), false)
    assert.equal(isSameDay(null, '2026-08-16'), false)
  })

  it('normalizeIdPart ripulisce e non lascia trattini ai bordi', () => {
    assert.equal(normalizeIdPart('9618.HK'), '9618-hk')
    assert.equal(normalizeIdPart('  VOLV-B.ST  '), 'volv-b-st')
    assert.equal(normalizeIdPart(null), 'na')
  })

  it('formatCooldownDuration passa da minuti a ore', () => {
    assert.equal(formatCooldownDuration(59 * 60_000), '59 min')
    assert.equal(formatCooldownDuration(90 * 60_000), '2 ore')
  })
})

describe('ordini', () => {
  it('la direzione decide il lato dell ordine', () => {
    assert.equal(getOpenOrderSide('LONG'), 'BUY')
    assert.equal(getOpenOrderSide('SHORT'), 'SELL_SHORT')
    assert.equal(getCloseOrderSide('LONG'), 'SELL')
    assert.equal(getCloseOrderSide('SHORT'), 'BUY_TO_COVER')
  })

  it('compactOrder toglie i campi vuoti ma tiene il notional a zero', () => {
    const order = compactOrder({ id: 'x', ticker: 'NN.AS', notional: 0 })
    assert.equal(order.notional, 0)
    assert.equal('positionId' in order, false)
    assert.equal(order.source, 'system')
  })

  it('senza id non esiste ordine', () => {
    assert.equal(compactOrder({ ticker: 'NN.AS' }), null)
  })

  // Le due copie avevano due default diversi per source, 'backend-monitor' e
  // 'manual', e l'ordine finiva etichettato con chi non lo aveva creato.
  it('un ordine senza source dichiarata si riconosce, non si traveste', () => {
    const order = createSimulationOrder({
      action: 'OPEN',
      direction: 'SHORT',
      marketId: 'asia',
      notional: 1500,
      requestedPrice: 100,
      side: 'SELL_SHORT',
      ticker: '9618.HK',
    })
    assert.equal(order.source, 'system')
  })

  it('di due chiusure sulla stessa posizione resta la piu recente', () => {
    const vecchia = {
      id: 'a',
      action: 'CLOSE',
      positionId: 'pos-1',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      notional: 10,
    }
    const nuova = {
      id: 'b',
      action: 'CLOSE',
      positionId: 'pos-1',
      createdAt: new Date().toISOString(),
      notional: 20,
    }

    const deduped = dedupeOrders([vecchia, nuova])
    assert.equal(deduped.length, 1)
    assert.equal(deduped[0].id, 'b')
  })

  it('gli ordini piu vecchi della finestra di ritenzione spariscono', () => {
    const vecchissimo = {
      id: 'antico',
      action: 'OPEN',
      createdAt: new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString(),
    }
    assert.equal(dedupeOrders([vecchissimo]).length, 0)
  })
})
