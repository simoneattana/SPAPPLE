// Il modello costi sotto il listino IBKR Pro Tiered, adottato il 2026-08-17 al
// posto di Directa. Ogni numero atteso qui corrisponde a una riga di listino
// con la sua fonte annotata in executionCosts.js.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASSUNZIONI,
  FX_AUTO_RATE,
  applyExecutionCosts,
  getBorrowCostEur,
  getExecutionFeesEur,
  getFxCostEur,
  getStateTaxEur,
} from '../src/services/executionCosts.js'

const apri = (extra = {}) =>
  applyExecutionCosts({
    atr: 1.5,
    currency: 'EUR',
    fxToEur: 1,
    marketId: 'equities',
    notionalEur: 3000,
    phase: 'OPEN',
    price: 100,
    ticker: 'SAP.DE',
    type: 'LONG',
    ...extra,
  })

describe('commissioni IBKR', () => {
  it('Europa: 0,05% del controvalore', () => {
    assert.equal(apri({ notionalEur: 10000 }).commissionEur, 5)
  })

  it('Europa: sotto i 2.500 euro scatta il minimo di 1,25', () => {
    assert.equal(apri({ notionalEur: 1000 }).commissionEur, 1.25)
    assert.equal(apri({ notionalEur: 2500 }).commissionEur, 1.25)
    assert.equal(apri({ notionalEur: 3000 }).commissionEur, 1.5)
  })

  it('Xetra: il tetto di 29 euro non si supera', () => {
    assert.equal(apri({ ticker: 'SAP.DE', notionalEur: 200000 }).commissionEur, 29)
  })

  it('Hong Kong: minimo 18 HKD, convertito col cambio del titolo', () => {
    const costo = apri({
      ticker: '9618.HK',
      currency: 'HKD',
      fxToEur: 0.11,
      marketId: 'asia',
      notionalEur: 3000,
    })
    // 0,05% di 3000 = 1,50 EUR, sotto il minimo di 18 HKD = 1,98 EUR
    assert.equal(costo.commissionEur, 1.98)
  })

  it('USA: per azione, con minimo 0,35 USD', () => {
    // 3000 EUR a 50 EUR per azione = 60 azioni; 60 x 0,0035 USD = 0,21 USD,
    // sotto il minimo, quindi vale 0,35 USD
    const costo = apri({
      ticker: 'REGN',
      currency: 'USD',
      fxToEur: 0.92,
      marketId: 'usa',
      price: 54.35,
      notionalEur: 3000,
    })
    assert.equal(costo.commissionEur, 0.322)
  })

  it('ogni riga di listino dichiara la sua fonte', () => {
    for (const ticker of ['ISP.MI', 'SAP.DE', 'UBSG.SW', '9618.HK', '6758.TSE']) {
      assert.ok(apri({ ticker }).commissionSource, ticker)
    }
  })
})

describe('cambio valuta', () => {
  it('non si paga sui titoli in euro', () => {
    assert.equal(getFxCostEur({ currency: 'EUR', notionalEur: 5000 }).fxCostEur, 0)
  })

  it('si paga lo 0,03% su tutto il resto', () => {
    assert.equal(FX_AUTO_RATE, 0.0003)
    assert.equal(getFxCostEur({ currency: 'HKD', notionalEur: 3000 }).fxCostEur, 0.9)
    assert.equal(getFxCostEur({ currency: 'USD', notionalEur: 10000 }).fxCostEur, 3)
  })
})

describe('imposte di stato', () => {
  const base = { notionalEur: 3000, marketId: 'equities' }

  it("la Tobin italiana colpisce solo l'acquisto", () => {
    const compraLong = getStateTaxEur({ ...base, ticker: 'ISP.MI', type: 'LONG', phase: 'OPEN' })
    const vendeLong = getStateTaxEur({ ...base, ticker: 'ISP.MI', type: 'LONG', phase: 'CLOSE' })
    assert.equal(compraLong.stateTaxEur, 3)
    assert.equal(vendeLong.stateTaxEur, 0)
  })

  it('su uno short italiano la Tobin arriva alla chiusura, quando si ricompra', () => {
    const apreShort = getStateTaxEur({ ...base, ticker: 'ISP.MI', type: 'SHORT', phase: 'OPEN' })
    const chiudeShort = getStateTaxEur({ ...base, ticker: 'ISP.MI', type: 'SHORT', phase: 'CLOSE' })
    assert.equal(apreShort.stateTaxEur, 0)
    assert.equal(chiudeShort.stateTaxEur, 3)
  })

  it('il bollo di Hong Kong colpisce entrambi i lati', () => {
    for (const phase of ['OPEN', 'CLOSE']) {
      const imposta = getStateTaxEur({ ...base, ticker: '9618.HK', type: 'SHORT', phase, marketId: 'asia' })
      assert.equal(imposta.stateTaxEur, 3, phase)
    }
  })

  it('Germania e Svizzera non hanno imposte di transazione', () => {
    for (const ticker of ['SAP.DE', 'UBSG.SW']) {
      const imposta = getStateTaxEur({ ...base, ticker, type: 'LONG', phase: 'OPEN' })
      assert.equal(imposta.stateTaxEur, 0, ticker)
    }
  })
})

describe('prestito titoli sugli short', () => {
  it('non costa niente su una posizione chiusa in giornata', () => {
    const costo = getBorrowCostEur({ daysHeld: 0, notionalEur: 3000, phase: 'CLOSE', type: 'SHORT' })
    assert.equal(costo.borrowCostEur, 0)
  })

  it('non si applica ai long', () => {
    const costo = getBorrowCostEur({ daysHeld: 30, notionalEur: 3000, phase: 'CLOSE', type: 'LONG' })
    assert.equal(costo.borrowCostEur, 0)
  })

  it('cresce con i giorni di tenuta', () => {
    const dieci = getBorrowCostEur({ daysHeld: 10, notionalEur: 3000, phase: 'CLOSE', type: 'SHORT' })
    const trenta = getBorrowCostEur({ daysHeld: 30, notionalEur: 3000, phase: 'CLOSE', type: 'SHORT' })
    assert.ok(dieci.borrowCostEur > 0)
    assert.ok(trenta.borrowCostEur > dieci.borrowCostEur * 2.9)
  })
})

describe('il totale di un lato', () => {
  it('somma commissione, cambio, imposte e prestito', () => {
    const costo = apri({
      ticker: '9618.HK',
      currency: 'HKD',
      fxToEur: 0.11,
      marketId: 'asia',
      type: 'SHORT',
      notionalEur: 3000,
    })
    const atteso =
      costo.commissionEur + costo.fxCostEur + costo.stateTaxEur + costo.borrowCostEur

    assert.equal(costo.feesEur, Number(atteso.toFixed(4)))
    assert.ok(costo.feesEur > costo.commissionEur, 'il totale supera la sola commissione')
  })

  it('le operazioni salvate prima del nuovo modello ripiegano sulla commissione', () => {
    assert.equal(getExecutionFeesEur({ commissionEur: 9 }), 9)
    assert.equal(getExecutionFeesEur(null), 0)
  })
})

describe('le ipotesi sono dichiarate come tali', () => {
  it('lo slittamento si presenta senza fonte e marcato come ipotesi', () => {
    assert.equal(ASSUNZIONI.slippage.fonte, null)
    assert.equal(apri().slippageIsAssumption, true)
    assert.match(apri().slippageRule, /ipotesi/)
  })

  it('anche il prestito titoli e dichiarato senza fonte', () => {
    assert.equal(ASSUNZIONI.prestitoTitoli.fonte, null)
  })
})

describe('costo di un giro completo su 3.000 euro', () => {
  function giro({ ticker, currency, fxToEur, marketId, price, type = 'SHORT' }) {
    const open = applyExecutionCosts({
      atr: price * 0.015,
      currency,
      fxToEur,
      marketId,
      notionalEur: 3000,
      phase: 'OPEN',
      price,
      ticker,
      type,
    })
    const close = applyExecutionCosts({
      atr: price * 0.015,
      currency,
      daysHeld: 0,
      fxToEur,
      marketId,
      notionalEur: 3000,
      phase: 'CLOSE',
      price,
      ticker,
      type,
    })
    const contanti = open.feesEur + close.feesEur
    const prezzo = (open.pricePenaltyEur + close.pricePenaltyEur) * (3000 / (price * fxToEur))
    return ((contanti + prezzo) / 3000) * 100
  }

  // Il modello Directa misurato sulle 25 operazioni costava lo 0,85%.
  it('Xetra costa meno di mezzo punto', () => {
    const pct = giro({ ticker: 'SAP.DE', currency: 'EUR', fxToEur: 1, marketId: 'equities', price: 100 })
    assert.ok(pct < 0.5, `Xetra ${pct.toFixed(3)}%`)
    assert.ok(pct > 0.2, `Xetra ${pct.toFixed(3)}%`)
  })

  it('Hong Kong resta il piu caro, per via del bollo', () => {
    const hk = giro({ ticker: '9618.HK', currency: 'HKD', fxToEur: 0.11, marketId: 'asia', price: 120 })
    const de = giro({ ticker: 'SAP.DE', currency: 'EUR', fxToEur: 1, marketId: 'equities', price: 100 })
    assert.ok(hk > de, `HK ${hk.toFixed(3)}% contro Xetra ${de.toFixed(3)}%`)
    assert.ok(hk > 0.55, `HK ${hk.toFixed(3)}%`)
  })

  it('ogni giro costa comunque meno dello 0,85% del vecchio modello', () => {
    for (const caso of [
      { ticker: 'SAP.DE', currency: 'EUR', fxToEur: 1, marketId: 'equities', price: 100 },
      { ticker: 'ISP.MI', currency: 'EUR', fxToEur: 1, marketId: 'equities', price: 3 },
      { ticker: 'REGN', currency: 'USD', fxToEur: 0.92, marketId: 'usa', price: 600 },
      { ticker: '9618.HK', currency: 'HKD', fxToEur: 0.11, marketId: 'asia', price: 120 },
    ]) {
      const pct = giro(caso)
      assert.ok(pct < 0.85, `${caso.ticker} ${pct.toFixed(3)}%`)
    }
  })
})
