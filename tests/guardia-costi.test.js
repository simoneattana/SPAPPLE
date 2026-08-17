// La guardia sui costi, aggiunta il 2026-08-17 subito dopo aver portato il
// modello costi su IBKR. Rifiuta le operazioni il cui bersaglio non copre il
// costo del giro completo.
//
// Il metro e il bersaglio vicino, non quello massimo: una regola di sicurezza
// si misura sullo scenario normale, non su quello migliore. Nei dati reali il
// bersaglio massimo e stato raggiunto in 6 casi su 25.
//
// Questa regola non e tarata sui risultati passati. Discende dall'aritmetica:
// se il guadagno a cui punti e minore di quanto spendi per entrare e uscire,
// l'operazione e persa qualunque cosa faccia il prezzo.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getTradingStrategy } from '../src/strategies/index.js'
import {
  evaluateCostViability,
  getRoundTripCostPct,
  getTradeGeometry,
} from '../src/services/engine/trades.js'

const equities = getTradingStrategy('equities')
const asia = getTradingStrategy('asia')
const crypto = getTradingStrategy('crypto')

describe('geometria, in un posto solo', () => {
  it('sotto 1,5% di volatilita punta piu vicino e mette lo stop piu stretto', () => {
    const calma = getTradeGeometry(1.0, equities)
    assert.equal(calma.targetPct, 0.35)
    assert.equal(calma.maxTargetPct, 0.8)
    assert.equal(calma.stopMultiplier, 1.2)
  })

  it('sopra 1,5% allarga tutto', () => {
    const mossa = getTradeGeometry(2.0, equities)
    assert.equal(mossa.targetPct, 0.6)
    assert.equal(mossa.maxTargetPct, 1.2)
    assert.equal(mossa.stopMultiplier, 1.5)
  })

  it('il crypto ha una geometria sua, senza trailing', () => {
    assert.equal(getTradeGeometry(3, crypto).targetPct, 0.45)
    assert.equal(getTradeGeometry(5, crypto).targetPct, 0.65)
    assert.equal(getTradeGeometry(3, crypto).trailingPct, null)
  })
})

describe('costo di un giro completo', () => {
  it('somma esborsi in contanti e peggioramento del prezzo', () => {
    const costo = getRoundTripCostPct({
      ticker: 'SAP.DE',
      price: 100,
      atr: 1.5,
      type: 'LONG',
      invested: 3000,
      strategy: equities,
      marketData: { currency: 'EUR', fxToEur: 1 },
    })

    assert.ok(costo.cashEur > 0, 'contanti')
    assert.ok(costo.priceImpactEur > 0, 'impatto sul prezzo')
    assert.ok(costo.costPct > 0.2 && costo.costPct < 0.5, `${costo.costPct.toFixed(3)}%`)
  })

  it('cresce con la volatilita, perche lo slittamento segue l ATR', () => {
    const base = { ticker: 'SAP.DE', price: 100, type: 'LONG', invested: 3000, strategy: equities, marketData: { currency: 'EUR', fxToEur: 1 } }
    const calmo = getRoundTripCostPct({ ...base, atr: 1 })
    const mosso = getRoundTripCostPct({ ...base, atr: 4 })

    assert.ok(mosso.costPct > calmo.costPct * 1.5)
  })
})

describe('la guardia', () => {
  const hongKong = {
    ticker: '9618.HK',
    price: 120,
    atr: 120 * 0.023,
    type: 'SHORT',
    invested: 3000,
    strategy: asia,
    marketData: { currency: 'HKD', fxToEur: 0.11 },
  }

  const xetra = {
    ticker: 'SAP.DE',
    price: 100,
    atr: 2,
    type: 'SHORT',
    invested: 3000,
    strategy: equities,
    marketData: { currency: 'EUR', fxToEur: 1 },
  }

  // Nei dati archiviati ogni singola posizione su Hong Kong sarebbe stata
  // rifiutata: fra bollo di stato e spread piu largo il giro costa piu del
  // bersaglio, e nessuna scelta di intermediario lo cambia.
  it('boccia Hong Kong, dove il bollo di stato rende il giro troppo caro', () => {
    const esito = evaluateCostViability(hongKong)

    assert.equal(esito.viable, false)
    assert.ok(esito.costPct > esito.targetPct)
    assert.match(esito.reason, /non copre il costo/)
  })

  it('lascia passare Xetra, dove non ci sono imposte di transazione', () => {
    const esito = evaluateCostViability(xetra)

    assert.equal(esito.viable, true)
    assert.equal(esito.reason, null)
    assert.ok(esito.marginPct > 0)
  })

  it('boccia i titoli troppo mossi, perche lo slittamento cresce e il bersaglio no', () => {
    const mossissimo = evaluateCostViability({ ...xetra, atr: 100 * 0.06 })

    assert.equal(mossissimo.viable, false, 'ATR al 6% con bersaglio fermo allo 0,60%')
  })

  it('posizioni piu grandi diluiscono i minimi fissi e diventano sostenibili', () => {
    const piccola = evaluateCostViability({ ...xetra, invested: 800 })
    const grande = evaluateCostViability({ ...xetra, invested: 8000 })

    assert.ok(grande.costPct < piccola.costPct)
  })

  it('il verdetto usa il bersaglio vicino, non quello massimo', () => {
    const esito = evaluateCostViability(hongKong)
    const geometria = getTradeGeometry((hongKong.atr / hongKong.price) * 100, asia)

    assert.equal(esito.targetPct, geometria.targetPct)
    assert.ok(
      geometria.maxTargetPct > esito.costPct,
      'col bersaglio massimo sarebbe passata: e la scelta di metro che la boccia',
    )
  })

  it('spiega sempre il motivo del rifiuto, con i due numeri che lo determinano', () => {
    const esito = evaluateCostViability(hongKong)

    assert.match(esito.reason, new RegExp(esito.targetPct.toFixed(2)))
    assert.match(esito.reason, new RegExp(esito.costPct.toFixed(2)))
  })
})
