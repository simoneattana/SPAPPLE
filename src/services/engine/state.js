// Stato dei mercati: creazione, normalizzazione e riconciliazione.
//
// Fino al 2026-08-16 normalizeMarketState esisteva in due copie che forzavano
// killSwitchEnabled a false e automationEnabled a true a ogni passaggio: il
// pulsante "Blocca nuove aperture" salvava la scelta e il giro dopo la perdeva.
// Qui i flag salvati vincono, e il default vale solo quando mancano.

import {
  DEFAULT_MARKET_ID,
  TRADING_STRATEGIES,
  getTradingStrategy,
} from '../../strategies/index.js'
import { getPositionOpenCommissionEur } from '../executionCosts.js'
import {
  getNextMarketScanAt,
  isMarketCloseGuardActive,
  isMarketScanBlocked,
} from '../marketHours.js'
import { EXECUTION_MODE, getMarketScanIntervalMs } from './constants.js'
import { roundPrice } from './format.js'
import { backfillLegacyCloseOrders, dedupeOrders } from './orders.js'
import { getRiskLimits } from './risk.js'

export const STORAGE_VERSION = 10

export const MARKET_STATE_FIELDS = [
  'capital',
  'vault',
  'positions',
  'history',
  'orders',
  'activityLog',
  'events',
  'executionMode',
  'killSwitchEnabled',
  'riskLimits',
  'automationEnabled',
  'lastScanAt',
  'lastScanCount',
  'lastSignalCount',
  'lastScanResults',
  'observations',
  'engineStatus',
  'isChecking',
  'isScanning',
  'lastAutomationMessage',
  'lastDataProvider',
  'lastSyncAt',
  'liveMonitorEnabled',
  'backendMonitorEnabled',
  'lastLiveCheckAt',
  'lastBackendCheckAt',
  'nextScanAt',
  'nextLiveCheckAt',
  'usMarketContext',
]

export function getNextScanAt(marketId, from = new Date()) {
  const strategy = getTradingStrategy(marketId)

  if (isMarketCloseGuardActive(strategy, from) || isMarketScanBlocked(strategy, from)) {
    return getNextMarketScanAt(strategy, from).toISOString()
  }

  return new Date(from.getTime() + getMarketScanIntervalMs(marketId)).toISOString()
}

export function normalizeNextScanAt(marketId, value, fallbackValue = null) {
  const candidate = value || fallbackValue

  if (!candidate) {
    return getNextScanAt(marketId)
  }

  const candidateDate = new Date(candidate)

  if (
    Number.isFinite(candidateDate.getTime()) &&
    isMarketScanBlocked(getTradingStrategy(marketId), candidateDate)
  ) {
    return getNextScanAt(marketId, candidateDate)
  }

  return candidate
}

function createInitialActivity() {
  return {
    id: 'system-ready',
    type: 'system',
    status: 'done',
    title: 'Sistema azzerato',
    detail:
      'Nuova simulazione avviata: Europa, USA e Asia con pilota automatico attivo.',
    createdAt: new Date().toISOString(),
  }
}

export function createInitialMarketState(strategy = getTradingStrategy()) {
  const activity = createInitialActivity()

  return {
    marketId: strategy.id,
    marketLabel: strategy.label,
    capital: strategy.initialCapital,
    vault: 0,
    positions: [],
    history: [],
    orders: [],
    activityLog: [activity],
    events: [activity],
    executionMode: EXECUTION_MODE,
    killSwitchEnabled: false,
    riskLimits: getRiskLimits(strategy),
    automationEnabled: true,
    lastScanAt: null,
    lastScanCount: 0,
    lastSignalCount: 0,
    lastScanResults: [],
    observations: [],
    engineStatus: 'In attesa',
    isChecking: false,
    isScanning: false,
    lastAutomationMessage: 'Pilota automatico pronto.',
    lastDataProvider: null,
    lastSyncAt: null,
    liveMonitorEnabled: true,
    backendMonitorEnabled: true,
    lastLiveCheckAt: null,
    lastBackendCheckAt: null,
    nextScanAt: getNextScanAt(strategy.id),
    nextLiveCheckAt: null,
    usMarketContext: null,
  }
}

export function createInitialMarkets() {
  return Object.values(TRADING_STRATEGIES).reduce((markets, strategy) => {
    markets[strategy.id] = createInitialMarketState(strategy)
    return markets
  }, {})
}

// Stato completo appena nato: metadati, i quattro mercati e lo specchio piatto
// del mercato attivo, che il resto dell'app legge ancora dalla radice.
export function createInitialState() {
  const markets = createInitialMarkets()

  return {
    version: STORAGE_VERSION,
    stateRevision: 0,
    lastStateMutationAt: null,
    lastStateMutationSource: 'iniziale',
    lastStateMutationSummary: 'Stato iniziale Spapple.',
    activeMarket: DEFAULT_MARKET_ID,
    markets,
    ...markets[DEFAULT_MARKET_ID],
  }
}

export function pickMarketState(state) {
  return MARKET_STATE_FIELDS.reduce((marketState, field) => {
    marketState[field] = state[field]
    return marketState
  }, {})
}

export function removeClosedPositions(positions = [], history = []) {
  const closedIds = new Set(history.map((trade) => trade?.positionId).filter(Boolean))
  const closedKeys = new Set(
    history
      .filter((trade) => trade?.ticker && trade?.openedAt)
      .map((trade) => `${trade.ticker}-${trade.openedAt}`),
  )

  return positions.filter((position) => {
    if (position?.id && closedIds.has(position.id)) {
      return false
    }

    if (!position?.ticker || !position?.openedAt) {
      return true
    }

    return !closedKeys.has(`${position.ticker}-${position.openedAt}`)
  })
}

export function resultBelongsToMarket(row, marketId) {
  if (!row || typeof row !== 'object') {
    return false
  }

  if (marketId === 'crypto') {
    return row.market === 'crypto' || row.provider === 'Kraken'
  }

  return row.market !== 'crypto' && row.provider !== 'Kraken'
}

export function sanitizeScanResults(results = [], marketId) {
  if (!Array.isArray(results)) {
    return []
  }

  return results.filter((row) => resultBelongsToMarket(row, marketId))
}

export function dedupeClosedTrades(history = []) {
  const trades = Array.isArray(history) ? history : []
  const byPosition = new Map()

  trades.forEach((trade) => {
    if (!trade?.ticker || !trade?.exitDate) {
      return
    }

    const key = trade.positionId
      ? `position-${trade.positionId}`
      : `${trade.ticker}-${trade.exitDate}`
    const current = byPosition.get(key)

    if (!current || new Date(trade.exitDate) > new Date(current.exitDate)) {
      byPosition.set(key, trade)
    }
  })

  return [...byPosition.values()].sort(
    (first, second) => new Date(second.exitDate || 0) - new Date(first.exitDate || 0),
  )
}

export function calculateVaultFromHistory(history = []) {
  return history.reduce((total, trade) => {
    const pnl = Number(trade?.pnlEur)

    if (trade?.result !== 'WIN' || !Number.isFinite(pnl) || pnl <= 0) {
      return total
    }

    return total + pnl
  }, 0)
}

export function calculateNetPnlFromHistory(history = []) {
  return history.reduce((total, trade) => {
    const pnl = Number(trade?.pnlEur)

    return Number.isFinite(pnl) ? total + pnl : total
  }, 0)
}

export function calculateInvestedInPositions(positions = []) {
  return positions.reduce((total, position) => {
    const invested = Number(position?.invested)
    const openCommission = getPositionOpenCommissionEur(position)

    return Number.isFinite(invested) ? total + invested + openCommission : total
  }, 0)
}

export function reconcileAvailableCapital(strategy, fallbackCapital, history, positions) {
  if (!history.length && !positions.length) {
    return fallbackCapital
  }

  const netPnl = calculateNetPnlFromHistory(history)
  const invested = calculateInvestedInPositions(positions)

  return roundPrice(Math.max(strategy.initialCapital + netPnl - invested, 0))
}

export function normalizeMarketState(marketId, rawMarketState = {}) {
  const strategy = getTradingStrategy(marketId)
  const fallback = createInitialMarketState(strategy)
  const capital = Number(rawMarketState.capital)
  const vault = Number(rawMarketState.vault)
  const unusedMarket =
    !rawMarketState.positions?.length &&
    !rawMarketState.history?.length &&
    !rawMarketState.events?.length
  const normalizedCapital =
    strategy.id === 'crypto' && (capital === 0 || capital === 5000) && unusedMarket
      ? fallback.capital
      : Number.isFinite(capital)
        ? capital
        : fallback.capital

  const history = Array.isArray(rawMarketState.history)
    ? rawMarketState.history
    : fallback.history
  const orders = Array.isArray(rawMarketState.orders)
    ? rawMarketState.orders
    : fallback.orders
  const backfill = backfillLegacyCloseOrders(marketId, strategy.label, history, orders)
  const normalizedHistory = dedupeClosedTrades(backfill.history)
  const vaultFromHistory = calculateVaultFromHistory(normalizedHistory)
  const normalizedVault =
    normalizedHistory.length > 0
      ? vaultFromHistory
      : Number.isFinite(vault)
        ? vault
        : fallback.vault
  const positions = removeClosedPositions(
    Array.isArray(rawMarketState.positions)
      ? rawMarketState.positions
      : fallback.positions,
    normalizedHistory,
  )
  const reconciledCapital = reconcileAvailableCapital(
    strategy,
    normalizedCapital,
    normalizedHistory,
    positions,
  )

  return {
    ...fallback,
    ...rawMarketState,
    marketId,
    marketLabel: strategy.label,
    capital: reconciledCapital,
    vault: roundPrice(normalizedVault),
    positions,
    history: normalizedHistory,
    orders: dedupeOrders(backfill.orders),
    activityLog: Array.isArray(rawMarketState.activityLog)
      ? rawMarketState.activityLog
      : fallback.activityLog,
    events: Array.isArray(rawMarketState.events)
      ? rawMarketState.events
      : Array.isArray(rawMarketState.activityLog)
        ? rawMarketState.activityLog
        : fallback.events,
    executionMode: rawMarketState.executionMode || fallback.executionMode,
    killSwitchEnabled:
      typeof rawMarketState.killSwitchEnabled === 'boolean'
        ? rawMarketState.killSwitchEnabled
        : fallback.killSwitchEnabled,
    riskLimits: getRiskLimits(strategy, rawMarketState.riskLimits),
    automationEnabled:
      typeof rawMarketState.automationEnabled === 'boolean'
        ? rawMarketState.automationEnabled
        : fallback.automationEnabled,
    lastScanAt: rawMarketState.lastScanAt || fallback.lastScanAt,
    lastScanCount: Number.isFinite(Number(rawMarketState.lastScanCount))
      ? Number(rawMarketState.lastScanCount)
      : fallback.lastScanCount,
    lastSignalCount: Number.isFinite(Number(rawMarketState.lastSignalCount))
      ? Number(rawMarketState.lastSignalCount)
      : fallback.lastSignalCount,
    lastScanResults: sanitizeScanResults(rawMarketState.lastScanResults, marketId),
    observations: Array.isArray(rawMarketState.observations)
      ? rawMarketState.observations
      : fallback.observations,
    engineStatus: rawMarketState.engineStatus || fallback.engineStatus,
    isChecking: Boolean(rawMarketState.isChecking),
    isScanning: Boolean(rawMarketState.isScanning),
    lastAutomationMessage:
      rawMarketState.lastAutomationMessage || fallback.lastAutomationMessage,
    lastDataProvider: rawMarketState.lastDataProvider || fallback.lastDataProvider,
    lastSyncAt: rawMarketState.lastSyncAt || fallback.lastSyncAt,
    liveMonitorEnabled:
      typeof rawMarketState.liveMonitorEnabled === 'boolean'
        ? rawMarketState.liveMonitorEnabled
        : fallback.liveMonitorEnabled,
    backendMonitorEnabled:
      typeof rawMarketState.backendMonitorEnabled === 'boolean'
        ? rawMarketState.backendMonitorEnabled
        : fallback.backendMonitorEnabled,
    lastLiveCheckAt: rawMarketState.lastLiveCheckAt || fallback.lastLiveCheckAt,
    lastBackendCheckAt:
      rawMarketState.lastBackendCheckAt || fallback.lastBackendCheckAt,
    nextScanAt: normalizeNextScanAt(
      marketId,
      rawMarketState.nextScanAt,
      fallback.nextScanAt,
    ),
    nextLiveCheckAt: rawMarketState.nextLiveCheckAt || fallback.nextLiveCheckAt,
    usMarketContext: rawMarketState.usMarketContext || fallback.usMarketContext,
  }
}

export function syncActiveMarketState(state) {
  const activeMarket = state.activeMarket || DEFAULT_MARKET_ID
  const rawMarkets =
    state.markets && typeof state.markets === 'object' ? state.markets : {}
  const rawActiveMarketState = rawMarkets[activeMarket] || rawMarkets[DEFAULT_MARKET_ID]
  const currentMarketState = normalizeMarketState(
    activeMarket,
    rawActiveMarketState || pickMarketState(state),
  )
  const markets = {
    ...rawMarkets,
    [activeMarket]: currentMarketState,
  }

  return {
    ...state,
    activeMarket,
    markets,
    ...currentMarketState,
    version: STORAGE_VERSION,
    stateRevision: Number.isFinite(Number(state.stateRevision))
      ? Number(state.stateRevision)
      : 0,
    lastStateMutationAt: state.lastStateMutationAt || null,
    lastStateMutationSource: state.lastStateMutationSource || 'iniziale',
    lastStateMutationSummary:
      state.lastStateMutationSummary || 'Stato iniziale Spapple.',
  }
}
