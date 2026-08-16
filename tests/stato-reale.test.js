// Rete di sicurezza per la deduplicazione del motore.
//
// Passa lo stato operativo reale del 2026-08-03, archiviato prima del reset,
// dentro la normalizzazione e ne fissa i numeri derivati: capitale riconciliato,
// vault calcolato dallo storico, posizioni ancora aperte dopo la rimozione di
// quelle chiuse, ordini dopo la deduplica. Se un'estrazione cambia uno di questi
// numeri, il comportamento del motore e cambiato e il test lo dice.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { normalizeTradingState } from '../api/_tradingEngine.js'

const archivePath = fileURLToPath(
  new URL('../docs/archive/stato-operativo-2026-08-03.json', import.meta.url),
)
const archive = JSON.parse(readFileSync(archivePath, 'utf8'))

function buildRawState() {
  const markets = {}
  for (const [id, market] of Object.entries(archive.mercati)) {
    markets[id] = { marketId: id, ...market }
  }
  return { version: 4, activeMarket: 'equities', markets }
}

const ATTESI = {
  equities: { capital: 29900.4592, vault: 0, positions: 0, history: 4, orders: 13 },
  crypto: { capital: 20000, vault: 0, positions: 0, history: 0, orders: 0 },
  usa: { capital: 29786.142, vault: 0, positions: 0, history: 5, orders: 10 },
  asia: { capital: 26818.3981, vault: 102.0031, positions: 2, history: 16, orders: 180 },
}

describe('normalizzazione dello stato reale del 3 agosto', () => {
  const state = normalizeTradingState(buildRawState())

  it('conserva i quattro mercati', () => {
    assert.deepEqual(Object.keys(state.markets).sort(), ['asia', 'crypto', 'equities', 'usa'])
  })

  for (const [id, atteso] of Object.entries(ATTESI)) {
    it(`${id}: capitale, vault, posizioni, storico e ordini restano quelli`, () => {
      const market = state.markets[id]
      assert.equal(market.capital, atteso.capital, 'capitale riconciliato')
      assert.equal(market.vault, atteso.vault, 'vault calcolato dallo storico')
      assert.equal((market.positions || []).length, atteso.positions, 'posizioni aperte')
      assert.equal((market.history || []).length, atteso.history, 'operazioni chiuse')
      assert.equal((market.orders || []).length, atteso.orders, 'ordini dopo la deduplica')
    })
  }

  it('le due posizioni Asia sono quelle rimaste appese, con la direzione registrata', () => {
    const tickers = state.markets.asia.positions.map((p) => p.ticker).sort()
    assert.deepEqual(tickers, ['0941.HK', '9618.HK'])
    for (const position of state.markets.asia.positions) {
      assert.equal(position.type, 'SHORT')
    }
  })

  it('gli interruttori salvati sopravvivono alla normalizzazione', () => {
    const raw = buildRawState()
    for (const market of Object.values(raw.markets)) {
      market.killSwitchEnabled = true
      market.automationEnabled = false
      market.liveMonitorEnabled = false
    }

    const bloccato = normalizeTradingState(raw)

    for (const [id, market] of Object.entries(bloccato.markets)) {
      assert.equal(market.killSwitchEnabled, true, `${id}: blocco aperture`)
      assert.equal(market.automationEnabled, false, `${id}: automazione`)
      assert.equal(market.liveMonitorEnabled, false, `${id}: monitor browser`)
    }
  })
})
