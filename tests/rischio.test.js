import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getTradingStrategy } from '../src/strategies/index.js'
import {
  getConsecutiveLosses,
  getOpeningOrderBlockReason,
  getRiskAdjustedPositionSize,
  getRiskGovernorState,
} from '../src/services/engine/risk.js'

const strategy = getTradingStrategy('equities')

// Le perdite sono in testa allo storico: la piu recente per prima.
function storico(risultati, exitDate = '2026-08-14T15:00:00.000Z') {
  return risultati.map((result, index) => ({
    ticker: `T${index}.AS`,
    result,
    pnlEur: result === 'LOSS' ? -10 : 10,
    exitDate,
  }))
}

const mercato = (history) => ({ history, riskLimits: {}, orders: [] })

describe('conteggio delle perdite consecutive', () => {
  it('conta dalla piu recente e si ferma alla prima non perdente', () => {
    assert.equal(getConsecutiveLosses(storico(['LOSS', 'LOSS', 'WIN', 'LOSS'])), 2)
    assert.equal(getConsecutiveLosses(storico(['WIN', 'LOSS', 'LOSS'])), 0)
    assert.equal(getConsecutiveLosses([]), 0)
  })
})

describe('governo del rischio a gradini', () => {
  it('fino a una perdita si opera normalmente', () => {
    const stato = getRiskGovernorState(mercato(storico(['LOSS'])), strategy)
    assert.equal(stato.mode, 'normal')
    assert.equal(stato.sizeMultiplier, 1)
  })

  it('due perdite riducono la size senza fermare nulla', () => {
    const stato = getRiskGovernorState(mercato(storico(['LOSS', 'LOSS'])), strategy)
    assert.equal(stato.mode, 'caution')
    assert.equal(stato.sizeMultiplier, 0.75)
  })

  it('tre perdite appena chiuse mettono in pausa fino alla sessione dopo', () => {
    const pocoFa = new Date(Date.now() - 60_000).toISOString()
    const stato = getRiskGovernorState(
      mercato(storico(['LOSS', 'LOSS', 'LOSS'], pocoFa)),
      strategy,
    )
    assert.equal(stato.mode, 'paused')
    assert.equal(stato.sizeMultiplier, 0)
    assert.ok(stato.pauseUntil instanceof Date)
  })

  // Regressione del 2026-08-16. La copia backend rispondeva "Blocco prudenziale
  // attivo" per sempre: il contatore si azzera solo con un'operazione non
  // perdente in cima allo storico, che pero non poteva piu aprirsi. I tre
  // mercati attivi erano dentro quel vicolo cieco dal 3 agosto.
  it('tre perdite vecchie non bloccano per sempre: si passa a recupero', () => {
    const stato = getRiskGovernorState(
      mercato(storico(['LOSS', 'LOSS', 'LOSS'], '2026-01-05T10:00:00.000Z')),
      strategy,
    )
    assert.equal(stato.mode, 'recovery')
    assert.equal(stato.maxOpenings, 1)
    assert.ok(stato.sizeMultiplier > 0, 'in recupero si apre ancora, con size ridotta')
  })

  it('cinque perdite appena chiuse fermano piu a lungo', () => {
    const pocoFa = new Date(Date.now() - 60_000).toISOString()
    const stato = getRiskGovernorState(
      mercato(storico(['LOSS', 'LOSS', 'LOSS', 'LOSS', 'LOSS'], pocoFa)),
      strategy,
    )
    assert.equal(stato.mode, 'hard_stop')
    assert.equal(stato.sizeMultiplier, 0)
  })

  it('anche il blocco forte scade: con perdite vecchie si torna a recupero', () => {
    const stato = getRiskGovernorState(
      mercato(storico(['LOSS', 'LOSS', 'LOSS', 'LOSS', 'LOSS'], '2026-01-05T10:00:00.000Z')),
      strategy,
    )
    assert.notEqual(stato.mode, 'hard_stop')
    assert.equal(stato.mode, 'recovery')
  })
})

describe('size adattata al rischio', () => {
  const sizing = strategy.positionSizing

  it('il moltiplicatore riduce la size senza mai andare sotto zero', () => {
    const piena = getRiskAdjustedPositionSize(30000, sizing, { sizeMultiplier: 1 })
    const ridotta = getRiskAdjustedPositionSize(30000, sizing, { sizeMultiplier: 0.5 })

    assert.ok(piena > 0)
    assert.equal(ridotta, piena * 0.5)
    assert.equal(getRiskAdjustedPositionSize(30000, sizing, { sizeMultiplier: 0 }), 0)
    assert.equal(
      getRiskAdjustedPositionSize(30000, sizing, { sizeMultiplier: -3 }),
      0,
      'un moltiplicatore negativo non produce size negative',
    )
  })
})

describe('blocchi in apertura', () => {
  const base = {
    executionMode: 'simulation',
    history: [],
    orders: [],
    riskLimits: {},
  }

  it('il blocco aperture ferma tutto, ed e la prima cosa che guarda', () => {
    const motivo = getOpeningOrderBlockReason(
      { ...base, killSwitchEnabled: true },
      1000,
      strategy,
    )
    assert.match(motivo, /Kill switch attivo/)
  })

  it('una modalita di esecuzione diversa da simulazione blocca', () => {
    const motivo = getOpeningOrderBlockReason(
      { ...base, executionMode: 'live' },
      1000,
      strategy,
    )
    assert.match(motivo, /Modalità operativa non supportata/)
  })
})
