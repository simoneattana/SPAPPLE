import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLatestPrice } from '../services/api'
import {
  LEGACY_POSITION_SIZE,
  MIN_POSITION_SIZE,
  calculatePositionSize,
  canOpenPosition,
} from '../services/positionSizing'
import { getMarketCopy } from '../services/marketCopy'
import { getCryptoSignalType } from '../services/cryptoRules'
import {
  loadRemoteTradingState,
  saveRemoteTradingState,
} from '../services/remoteState'
import { useAuth } from '../services/useAuth'
import {
  DEFAULT_MARKET_ID,
  TRADING_STRATEGIES,
  getTradingStrategy,
} from '../strategies'
import { TradingContext } from './tradingState'

const MAX_POSITIONS = 5
const STORAGE_KEY = 'spapple_state'
const STORAGE_VERSION = 5
const LIVE_MONITOR_INTERVAL_MS = 60_000
const REMOTE_REFRESH_INTERVAL_MS = 30_000
const EXECUTION_MODE = 'simulation'
const DEFAULT_RISK_LIMITS = {
  maxDailyOrders: 20,
  maxDailyCapitalPct: 1,
  maxConsecutiveLosses: 3,
}
const DEFAULT_REENTRY_COOLDOWN_MS = 6 * 60 * 60 * 1000

const initialActivity = {
  id: 'system-ready',
  type: 'system',
  status: 'done',
  title: 'Sistema azzerato',
  detail: 'Nuova simulazione avviata: Azioni 30.000€, Crypto 20.000€ e pilota automatico attivo.',
  createdAt: new Date().toISOString(),
}

const marketStateFields = [
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
  'engineStatus',
  'liveMonitorEnabled',
  'backendMonitorEnabled',
  'lastLiveCheckAt',
  'lastBackendCheckAt',
  'nextLiveCheckAt',
]

function createInitialMarketState(strategy = getTradingStrategy()) {
  return {
    marketId: strategy.id,
    marketLabel: strategy.label,
    capital: strategy.initialCapital,
    vault: 0,
    positions: [],
    history: [],
    orders: [],
    activityLog: [initialActivity],
    events: [initialActivity],
    executionMode: EXECUTION_MODE,
    killSwitchEnabled: false,
    riskLimits: DEFAULT_RISK_LIMITS,
    automationEnabled: true,
    lastScanAt: null,
    lastScanCount: 0,
    lastSignalCount: 0,
    lastScanResults: [],
    engineStatus: 'In attesa',
    liveMonitorEnabled: true,
    backendMonitorEnabled: true,
    lastLiveCheckAt: null,
    lastBackendCheckAt: null,
    nextLiveCheckAt: null,
  }
}

const initialEquitiesState = createInitialMarketState()

function createInitialMarkets() {
  return Object.values(TRADING_STRATEGIES).reduce((markets, strategy) => {
    markets[strategy.id] = createInitialMarketState(strategy)
    return markets
  }, {})
}

const initialState = {
  version: STORAGE_VERSION,
  activeMarket: DEFAULT_MARKET_ID,
  markets: createInitialMarkets(),
  marketId: initialEquitiesState.marketId,
  marketLabel: initialEquitiesState.marketLabel,
  capital: initialEquitiesState.capital,
  vault: 0,
  positions: [],
  history: [],
  orders: [],
  activityLog: [initialActivity],
  events: [initialActivity],
  executionMode: EXECUTION_MODE,
  killSwitchEnabled: false,
  riskLimits: DEFAULT_RISK_LIMITS,
  automationEnabled: true,
  lastScanAt: null,
  lastScanCount: 0,
  lastSignalCount: 0,
  lastScanResults: [],
  engineStatus: 'In attesa',
  liveMonitorEnabled: true,
  backendMonitorEnabled: true,
  lastLiveCheckAt: null,
  lastBackendCheckAt: null,
  nextLiveCheckAt: null,
}

function pickMarketState(state) {
  return marketStateFields.reduce((marketState, field) => {
    marketState[field] = state[field]
    return marketState
  }, {})
}

function removeClosedPositions(positions = [], history = []) {
  const closedIds = new Set(
    history.map((trade) => trade?.positionId).filter(Boolean),
  )
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

function resultBelongsToMarket(row, marketId) {
  if (!row || typeof row !== 'object') {
    return false
  }

  if (marketId === 'crypto') {
    return row.market === 'crypto' || row.provider === 'Kraken'
  }

  return row.market !== 'crypto' && row.provider !== 'Kraken'
}

function sanitizeScanResults(results = [], marketId) {
  if (!Array.isArray(results)) {
    return []
  }

  return results.filter((row) => resultBelongsToMarket(row, marketId))
}

function dedupeClosedTrades(history = []) {
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
    (first, second) =>
      new Date(second.exitDate || 0) - new Date(first.exitDate || 0),
  )
}

function dedupeOrders(orders = []) {
  const normalizedOrders = Array.isArray(orders) ? orders : []
  const byKey = new Map()

  normalizedOrders.forEach((order) => {
    if (!order?.id) {
      return
    }

    const key =
      order.action === 'CLOSE' && order.positionId
        ? `close-${order.positionId}`
        : `order-${order.id}`
    const current = byKey.get(key)

    if (
      !current ||
      new Date(order.createdAt || 0) > new Date(current.createdAt || 0)
    ) {
      byKey.set(key, order)
    }
  })

  return [...byKey.values()].sort(
    (first, second) =>
      new Date(second.createdAt || 0) - new Date(first.createdAt || 0),
  )
}

function calculateVaultFromHistory(history = []) {
  return history.reduce((total, trade) => {
    const pnl = Number(trade?.pnlEur)

    if (trade?.result !== 'WIN' || !Number.isFinite(pnl) || pnl <= 0) {
      return total
    }

    return total + pnl
  }, 0)
}

function normalizeMarketState(marketId, rawMarketState = {}) {
  const strategy = getTradingStrategy(marketId)
  const fallback = createInitialMarketState(strategy)
  const capital = Number(rawMarketState.capital)
  const vault = Number(rawMarketState.vault)
  const unusedMarket =
    !rawMarketState.positions?.length &&
    !rawMarketState.history?.length &&
    !rawMarketState.events?.length
  const normalizedCapital =
    strategy.id === 'crypto' &&
    (capital === 0 || capital === 5000) &&
    unusedMarket
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
  const backfill = backfillLegacyCloseOrders(
    marketId,
    strategy.label,
    history,
    orders,
  )
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

  return {
    ...fallback,
    ...rawMarketState,
    marketId,
    marketLabel: strategy.label,
    capital: normalizedCapital,
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
    riskLimits: {
      ...DEFAULT_RISK_LIMITS,
      ...(rawMarketState.riskLimits || {}),
    },
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
    engineStatus: rawMarketState.engineStatus || fallback.engineStatus,
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
    nextLiveCheckAt: rawMarketState.nextLiveCheckAt || fallback.nextLiveCheckAt,
  }
}

function syncActiveMarketState(state) {
  const activeMarket = state.activeMarket || DEFAULT_MARKET_ID
  const rawMarkets =
    state.markets && typeof state.markets === 'object' ? state.markets : {}
  const rawActiveMarketState =
    rawMarkets[activeMarket] || rawMarkets[DEFAULT_MARKET_ID]
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
  }
}

function activateMarketState(state, marketId, marketState) {
  const syncedState = syncActiveMarketState(state)
  const normalizedMarketState = normalizeMarketState(marketId, marketState)

  return syncActiveMarketState({
    ...syncedState,
    activeMarket: marketId,
    markets: {
      ...(syncedState.markets || {}),
      [marketId]: normalizedMarketState,
    },
    ...normalizedMarketState,
  })
}

function updateMarketState(state, marketId, marketState) {
  const syncedState = syncActiveMarketState(state)
  const activeMarket = syncedState.activeMarket || DEFAULT_MARKET_ID
  const normalizedMarketState = normalizeMarketState(marketId, marketState)
  const markets = {
    ...(syncedState.markets || {}),
    [marketId]: normalizedMarketState,
  }
  const activeMarketState = normalizeMarketState(
    activeMarket,
    markets[activeMarket],
  )

  return {
    ...syncedState,
    activeMarket,
    markets,
    ...activeMarketState,
  }
}

function roundPrice(value) {
  return Number(value.toFixed(4))
}

function roundQuantity(value) {
  return Number(value.toFixed(8))
}

function createActivity({ type = 'system', status = 'done', title, detail }) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    status,
    title,
    detail,
    createdAt: new Date().toISOString(),
  }
}

function appendActivity(state, activity) {
  return [activity, ...(state.activityLog || [])].slice(0, 14)
}

function appendLogs(state, activity) {
  return {
    activityLog: appendActivity(state, activity),
    events: [activity, ...(state.events || [])],
  }
}

function appendOrders(state, orders) {
  const nextOrders = Array.isArray(orders) ? orders : [orders]
  return [...nextOrders, ...(state.orders || [])].slice(0, 250)
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}

function isSameDay(value, dayKey = getTodayKey()) {
  return value ? String(value).slice(0, 10) === dayKey : false
}

function getConsecutiveLosses(history = []) {
  let losses = 0

  for (const trade of history) {
    if (trade.result === 'LOSS') {
      losses += 1
      continue
    }

    break
  }

  return losses
}

function formatCooldownDuration(remainingMs) {
  const minutes = Math.ceil(remainingMs / 60000)

  if (minutes < 60) {
    return `${minutes} min`
  }

  return `${Math.ceil(minutes / 60)} ore`
}

function getTickerCooldownReason(marketState, ticker, strategy) {
  const cooldownMs = Number.isFinite(Number(strategy.reentryCooldownMs))
    ? Number(strategy.reentryCooldownMs)
    : DEFAULT_REENTRY_COOLDOWN_MS

  if (!ticker || cooldownMs <= 0) {
    return null
  }

  const latestClosedTrade = (marketState.history || []).find(
    (trade) => trade?.ticker === ticker && trade?.exitDate,
  )

  if (!latestClosedTrade) {
    return null
  }

  const closedAt = new Date(latestClosedTrade.exitDate).getTime()
  const remainingMs = closedAt + cooldownMs - Date.now()

  if (!Number.isFinite(closedAt) || remainingMs <= 0) {
    return null
  }

  return `${ticker} è in pausa operativa dopo l’ultima chiusura. Nuova apertura consentita tra circa ${formatCooldownDuration(
    remainingMs,
  )}.`
}

function getOpeningOrderBlockReason(marketState, notional, strategy) {
  const riskLimits = {
    ...DEFAULT_RISK_LIMITS,
    ...(marketState.riskLimits || {}),
  }

  if (marketState.executionMode !== EXECUTION_MODE) {
    return 'Modalità operativa non supportata: al momento Spapple può eseguire solo ordini simulati.'
  }

  if (marketState.killSwitchEnabled) {
    return 'Kill switch attivo: nuove aperture bloccate.'
  }

  if (marketState.pendingTicker) {
    const cooldownReason = getTickerCooldownReason(
      marketState,
      marketState.pendingTicker,
      strategy,
    )

    if (cooldownReason) {
      return cooldownReason
    }
  }

  const todaysOrders = (marketState.orders || []).filter((order) =>
    isSameDay(order.createdAt),
  )
  const todaysOpeningOrders = todaysOrders.filter(
    (order) => order.action === 'OPEN' && order.status === 'ESEGUITO',
  )

  if (todaysOrders.length >= riskLimits.maxDailyOrders) {
    return `Limite giornaliero raggiunto: massimo ${riskLimits.maxDailyOrders} ordini al giorno.`
  }

  const dailyCapitalLimit =
    Number(strategy.initialCapital || 0) * Number(riskLimits.maxDailyCapitalPct)
  const dailyAllocated = todaysOpeningOrders.reduce(
    (sum, order) => sum + Number(order.notional || 0),
    0,
  )

  if (
    Number.isFinite(dailyCapitalLimit) &&
    dailyCapitalLimit > 0 &&
    dailyAllocated + Number(notional || 0) > dailyCapitalLimit
  ) {
    return `Limite capitale giornaliero superato: massimo ${Math.round(
      riskLimits.maxDailyCapitalPct * 100,
    )}% del capitale iniziale del mercato.`
  }

  const consecutiveLosses = getConsecutiveLosses(marketState.history || [])

  if (consecutiveLosses >= riskLimits.maxConsecutiveLosses) {
    return `Blocco prudenziale attivo: ${consecutiveLosses} perdite consecutive.`
  }

  return null
}

function getOpenOrderSide(type) {
  return type === 'LONG' ? 'BUY' : 'SELL_SHORT'
}

function getCloseOrderSide(type) {
  return type === 'LONG' ? 'SELL' : 'BUY_TO_COVER'
}

function normalizeIdPart(value) {
  return String(value || 'na')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function createLegacyCloseOrderId(marketId, trade, index) {
  return [
    'legacy-close',
    marketId,
    normalizeIdPart(trade.ticker),
    normalizeIdPart(trade.openedAt),
    normalizeIdPart(trade.exitDate),
    index,
  ].join('-')
}

function hasCompleteLegacyTradeData(trade) {
  return (
    Number.isFinite(Number(trade.entryPrice)) &&
    Number(trade.entryPrice) > 0 &&
    Number.isFinite(Number(trade.exitPrice)) &&
    Number(trade.exitPrice) > 0 &&
    Number.isFinite(Number(trade.pnlEur)) &&
    Number.isFinite(Number(trade.recoveredCapital))
  )
}

function createLegacyCloseOrder(trade, marketId, marketLabel, index) {
  const complete = hasCompleteLegacyTradeData(trade)
  const id = trade.closeOrderId || createLegacyCloseOrderId(marketId, trade, index)
  const positionId =
    trade.positionId ||
    `legacy-position-${marketId}-${normalizeIdPart(trade.ticker)}-${normalizeIdPart(
      trade.openedAt || trade.exitDate,
    )}-${index}`
  const entryPrice = Number(trade.entryPrice)
  const exitPrice = Number(trade.exitPrice)
  const invested = Number(trade.invested)
  const recoveredCapital = Number(trade.recoveredCapital)
  const quantity =
    complete && Number.isFinite(invested) && invested > 0
      ? invested / entryPrice
      : null
  const createdAt = trade.exitDate || new Date().toISOString()

  return {
    id,
    marketId,
    marketLabel,
    executionMode: EXECUTION_MODE,
    broker: 'simulationBroker',
    action: 'CLOSE',
    side: getCloseOrderSide(trade.type),
    direction: trade.type,
    status: 'ESEGUITO',
    source: 'legacy-backfill',
    ticker: trade.ticker,
    positionId,
    quantity: Number.isFinite(quantity) ? roundQuantity(quantity) : null,
    notional: Number.isFinite(recoveredCapital)
      ? roundPrice(recoveredCapital)
      : Number.isFinite(invested)
        ? roundPrice(invested)
        : 0,
    requestedPrice: complete ? roundPrice(exitPrice) : null,
    executedPrice: complete ? roundPrice(exitPrice) : null,
    fee: 0,
    slippagePct: 0,
    reason: complete
      ? 'Ordine storico ricostruito da una chiusura già registrata.'
      : 'Ordine storico ricostruito con dati incompleti: prezzi o P/L legacy non disponibili.',
    dataQuality: complete ? 'complete' : 'incomplete',
    createdAt,
    submittedAt: createdAt,
    executedAt: createdAt,
    statusHistory: [
      { status: 'CREATO', at: createdAt },
      { status: 'INVIATO', at: createdAt },
      {
        status: 'ESEGUITO',
        at: createdAt,
        detail: complete ? 'Backfill storico completo' : 'Backfill storico incompleto',
      },
    ],
  }
}

function backfillLegacyCloseOrders(marketId, marketLabel, history = [], orders = []) {
  const existingOrderIds = new Set(orders.map((order) => order?.id).filter(Boolean))
  const nextOrders = [...orders]
  let changed = false
  const nextHistory = history.map((trade, index) => {
    if (!trade?.ticker || !trade?.exitDate) {
      return trade
    }

    const order = createLegacyCloseOrder(trade, marketId, marketLabel, index)
    const positionId = trade.positionId || order.positionId
    const nextTrade = {
      ...trade,
      positionId,
      closeOrderId: trade.closeOrderId || order.id,
      dataQuality: hasCompleteLegacyTradeData(trade) ? 'complete' : 'incomplete',
      legacyBackfilled: true,
    }

    if (!existingOrderIds.has(order.id)) {
      nextOrders.push(order)
      existingOrderIds.add(order.id)
      changed = true
    }

    if (
      nextTrade.positionId !== trade.positionId ||
      nextTrade.closeOrderId !== trade.closeOrderId ||
      nextTrade.dataQuality !== trade.dataQuality ||
      nextTrade.legacyBackfilled !== trade.legacyBackfilled
    ) {
      changed = true
      return nextTrade
    }

    return trade
  })

  return {
    changed,
    history: nextHistory,
    orders: nextOrders.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    ),
  }
}

function createSimulationOrder({
  action,
  direction,
  executedPrice = null,
  marketId,
  marketLabel,
  notional = 0,
  positionId = null,
  quantity = null,
  reason,
  requestedPrice = null,
  side,
  source = 'manual',
  status = 'ESEGUITO',
  ticker,
}) {
  const now = new Date().toISOString()
  const normalizedPrice = Number(executedPrice ?? requestedPrice)
  const normalizedNotional = Number(notional)
  const normalizedQuantity =
    Number.isFinite(Number(quantity)) && Number(quantity) > 0
      ? Number(quantity)
      : Number.isFinite(normalizedPrice) && normalizedPrice > 0
        ? normalizedNotional / normalizedPrice
        : null

  return {
    id: `order-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    marketId,
    marketLabel,
    executionMode: EXECUTION_MODE,
    broker: 'simulationBroker',
    action,
    side,
    direction,
    status,
    source,
    ticker,
    positionId,
    quantity: Number.isFinite(normalizedQuantity)
      ? roundQuantity(normalizedQuantity)
      : null,
    notional: Number.isFinite(normalizedNotional)
      ? roundPrice(normalizedNotional)
      : 0,
    requestedPrice: Number.isFinite(Number(requestedPrice))
      ? roundPrice(Number(requestedPrice))
      : null,
    executedPrice: Number.isFinite(Number(executedPrice))
      ? roundPrice(Number(executedPrice))
      : null,
    fee: 0,
    slippagePct: 0,
    reason,
    createdAt: now,
    submittedAt: status === 'RIFIUTATO' ? null : now,
    executedAt: status === 'ESEGUITO' ? now : null,
    statusHistory:
      status === 'RIFIUTATO'
        ? [
            { status: 'CREATO', at: now },
            { status: 'RIFIUTATO', at: now, detail: reason },
          ]
        : [
            { status: 'CREATO', at: now },
            { status: 'INVIATO', at: now },
            { status: 'ESEGUITO', at: now },
          ],
  }
}

function normalizeStoredState(parsedState) {
  const activeMarket = parsedState.activeMarket || DEFAULT_MARKET_ID
  const rawMarkets =
    parsedState.markets && typeof parsedState.markets === 'object'
      ? parsedState.markets
      : {}
  const legacyMarketState = normalizeMarketState(DEFAULT_MARKET_ID, parsedState)
  const markets = Object.values(TRADING_STRATEGIES).reduce(
    (normalizedMarkets, strategy) => {
      normalizedMarkets[strategy.id] = normalizeMarketState(
        strategy.id,
        rawMarkets[strategy.id] ||
          (strategy.id === DEFAULT_MARKET_ID ? legacyMarketState : {}),
      )
      return normalizedMarkets
    },
    {},
  )
  const activeMarketState = normalizeMarketState(
    activeMarket,
    markets[activeMarket] || markets[DEFAULT_MARKET_ID],
  )

  return syncActiveMarketState({
    version: STORAGE_VERSION,
    activeMarket,
    markets,
    ...activeMarketState,
  })
}

function loadInitialState() {
  try {
    const storedState = localStorage.getItem(STORAGE_KEY)

    if (!storedState) {
      return initialState
    }

    const parsedState = JSON.parse(storedState)

    if (parsedState.version !== STORAGE_VERSION) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState))
      return initialState
    }

    return normalizeStoredState(parsedState)
  } catch {
    return initialState
  }
}

function getStrategyMaxPositions(strategy) {
  return Number.isFinite(Number(strategy.maxPositions))
    ? Number(strategy.maxPositions)
    : MAX_POSITIONS
}

function buildTrade(
  ticker,
  price,
  atr,
  type,
  invested,
  profile = null,
  strategy = getTradingStrategy(),
  order = null,
) {
  const atrPct = (atr / price) * 100
  const isCrypto = strategy.id === 'crypto'
  const targetPct = isCrypto ? (atrPct < 4 ? 0.8 : 1.2) : atrPct < 1.5 ? 0.3 : 0.5
  const stopMultiplier = isCrypto ? 1.8 : 1.5
  const long = type === 'LONG'
  const openedAt = new Date().toISOString()

  return {
    id: `${ticker}-${type}-${Date.now()}`,
    marketId: strategy.id,
    marketLabel: strategy.label,
    ticker,
    profile,
    type,
    openOrderId: order?.id || null,
    openedAt,
    entryPrice: roundPrice(price),
    atrAtEntry: roundPrice(atr),
    takeProfit: roundPrice(
      long ? price * (1 + targetPct / 100) : price * (1 - targetPct / 100),
    ),
    stopLoss: roundPrice(
      long ? price - atr * stopMultiplier : price + atr * stopMultiplier,
    ),
    daysHeld: 0,
    invested: roundPrice(invested),
    quantity: order?.quantity || roundQuantity(invested / price),
    targetPct,
  }
}

function getSignalType(row, strategy) {
  if (strategy.id === 'crypto') {
    return getCryptoSignalType(row)
  }

  if (row.rsi < 30) {
    return 'LONG'
  }

  if (row.rsi > 70) {
    return 'SHORT'
  }

  return null
}

function evaluatePositions(
  current,
  positionsWithPrices,
  { incrementDays, source = 'monitor' },
) {
  let capital = current.capital
  let vault = current.vault
  const activePositions = []
  const closedTrades = []
  const closeOrders = []

  current.positions.forEach((position) => {
    const priceData = positionsWithPrices.find(
      (item) => item.position.id === position.id,
    )
    const latestPrice = priceData?.latestPrice
    const updatedPosition = {
      ...position,
      daysHeld: incrementDays ? position.daysHeld + 1 : position.daysHeld,
    }

    if (!Number.isFinite(latestPrice)) {
      activePositions.push(updatedPosition)
      return
    }

    const investedAtRisk = position.invested || LEGACY_POSITION_SIZE
    const quantity = investedAtRisk / position.entryPrice
    const long = position.type === 'LONG'
    const pnlEur = long
      ? (latestPrice - position.entryPrice) * quantity
      : (position.entryPrice - latestPrice) * quantity
    const monitoredPosition = {
      ...updatedPosition,
      latestPrice: roundPrice(latestPrice),
      latestPriceAt: new Date().toISOString(),
      unrealizedPnl: roundPrice(pnlEur),
    }
    const isWin = long
      ? latestPrice >= position.takeProfit
      : latestPrice <= position.takeProfit
    const isLoss = long
      ? latestPrice <= position.stopLoss
      : latestPrice >= position.stopLoss

    if (!isWin && !isLoss) {
      activePositions.push(monitoredPosition)
      return
    }

    const roundedPnl = roundPrice(pnlEur)
    const invested = investedAtRisk
    const recoveredCapital = Math.max(invested + roundedPnl, 0)
    const exitReason = isWin ? 'TAKE_PROFIT' : 'STOP_LOSS'
    const closeOrder = createSimulationOrder({
      action: 'CLOSE',
      direction: position.type,
      executedPrice: latestPrice,
      marketId: position.marketId || current.marketId,
      marketLabel: position.marketLabel || current.marketLabel,
      notional: recoveredCapital,
      positionId: position.id,
      quantity: position.quantity || quantity,
      requestedPrice: latestPrice,
      reason:
        exitReason === 'TAKE_PROFIT'
          ? 'Chiusura automatica: take profit raggiunto.'
          : 'Chiusura automatica: stop loss raggiunto.',
      side: getCloseOrderSide(position.type),
      source,
      ticker: position.ticker,
    })

    if (isWin) {
      capital += invested
      vault += Math.max(roundedPnl, 0)
    } else {
      capital += recoveredCapital
    }

    closeOrders.push(closeOrder)
    closedTrades.push({
      ticker: position.ticker,
      type: position.type,
      positionId: position.id,
      closeOrderId: closeOrder.id,
      openedAt: position.openedAt || null,
      entryPrice: position.entryPrice,
      invested,
      pnlEur: roundedPnl,
      result: isWin ? 'WIN' : 'LOSS',
      exitDate: new Date().toISOString(),
      exitPrice: roundPrice(latestPrice),
      exitReason,
      recoveredCapital: roundPrice(recoveredCapital),
    })
  })

  return {
    capital: roundPrice(capital),
    vault: roundPrice(vault),
    activePositions,
    closedTrades,
    closeOrders,
  }
}

export function TradingProvider({ children }) {
  const { isAuthenticated } = useAuth()
  const [state, setState] = useState(loadInitialState)
  const [remoteStatus, setRemoteStatus] = useState('disconnesso')
  const stateRef = useRef(state)
  const remoteReadyRef = useRef(false)
  const remoteUpdatedAtRef = useRef(null)
  const remoteSaveTimerRef = useRef(null)
  const liveCheckRunningRef = useRef(false)
  const closingPositionsRef = useRef(new Set())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (!isAuthenticated) {
      remoteReadyRef.current = false
      setRemoteStatus('disconnesso')
      return
    }

    let cancelled = false

    async function hydrateRemoteState() {
      setRemoteStatus('caricamento')

      try {
        const remoteState = await loadRemoteTradingState()

        if (cancelled) {
          return
        }

        if (remoteState.payload?.version === STORAGE_VERSION) {
          const hydratedState = normalizeStoredState(remoteState.payload)
          remoteUpdatedAtRef.current = remoteState.updatedAt || null
          stateRef.current = hydratedState
          setState(hydratedState)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(hydratedState))
        } else {
          await saveRemoteTradingState(stateRef.current)
        }

        remoteReadyRef.current = true
        setRemoteStatus('sincronizzato')
      } catch (error) {
        if (!cancelled) {
          remoteReadyRef.current = false
          setRemoteStatus(`errore: ${error.message}`)
        }
      }
    }

    hydrateRemoteState()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !remoteReadyRef.current) {
      return undefined
    }

    clearTimeout(remoteSaveTimerRef.current)
    remoteSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveRemoteTradingState(stateRef.current)
        setRemoteStatus('sincronizzato')
      } catch (error) {
        setRemoteStatus(`errore: ${error.message}`)
      }
    }, 600)

    return () => {
      clearTimeout(remoteSaveTimerRef.current)
    }
  }, [isAuthenticated, state])

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined
    }

    const intervalId = window.setInterval(async () => {
      if (!remoteReadyRef.current) {
        return
      }

      try {
        const remoteState = await loadRemoteTradingState()

        if (
          !remoteState.payload ||
          remoteState.payload.version !== STORAGE_VERSION ||
          !remoteState.updatedAt ||
          remoteState.updatedAt === remoteUpdatedAtRef.current
        ) {
          return
        }

        const refreshedState = normalizeStoredState(remoteState.payload)
        remoteUpdatedAtRef.current = remoteState.updatedAt
        stateRef.current = refreshedState
        setState(refreshedState)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshedState))
        setRemoteStatus('sincronizzato')
      } catch (error) {
        setRemoteStatus(`errore: ${error.message}`)
      }
    }, REMOTE_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isAuthenticated])

  const updateTradingState = useCallback((updater) => {
    const nextState = syncActiveMarketState(updater(stateRef.current))
    stateRef.current = nextState
    setState(nextState)
  }, [])

  const recordActivity = useCallback((activity) => {
    updateTradingState((current) => ({
      ...current,
      ...appendLogs(current, createActivity(activity)),
    }))
  }, [updateTradingState])

  const setAutomationEnabled = useCallback((enabled, targetMarketId = null) => {
    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const marketId = targetMarketId || syncedCurrent.activeMarket
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        automationEnabled: enabled,
        ...appendLogs(
          marketState,
          createActivity({
            type: 'automation',
            status: enabled ? 'working' : 'waiting',
            title: enabled ? 'Pilota automatico attivato' : 'Pilota automatico disattivato',
            detail: enabled
              ? 'Alla prossima scansione aprirà automaticamente i segnali validi, rispettando capitale e slot.'
              : 'Le prossime operazioni richiederanno conferma manuale dallo Scanner.',
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const setLiveMonitorEnabled = useCallback((enabled, targetMarketId = null) => {
    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const marketId = targetMarketId || syncedCurrent.activeMarket
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        liveMonitorEnabled: enabled,
        nextLiveCheckAt:
          enabled && marketState.positions.length > 0
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        ...appendLogs(
          marketState,
          createActivity({
            type: 'monitor',
            status: enabled ? 'working' : 'waiting',
            title: enabled ? 'Monitor live attivato' : 'Monitor live disattivato',
            detail: enabled
              ? 'Controllerò automaticamente le posizioni aperte ogni 60 secondi mentre l’app resta aperta.'
              : 'Le posizioni saranno controllate solo dal controllo manuale nel Portafoglio.',
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const setKillSwitchEnabled = useCallback((enabled, targetMarketId = null) => {
    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const marketId = targetMarketId || syncedCurrent.activeMarket
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        killSwitchEnabled: enabled,
        engineStatus: enabled
          ? 'Kill switch attivo'
          : 'Kill switch disattivato',
        ...appendLogs(
          marketState,
          createActivity({
            type: 'risk',
            status: enabled ? 'error' : 'done',
            title: enabled
              ? 'Kill switch attivato'
              : 'Kill switch disattivato',
            detail: enabled
              ? 'Nuove aperture bloccate. Le posizioni gia aperte restano monitorate.'
              : 'Le nuove aperture tornano disponibili nel rispetto dei limiti rischio.',
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const setActiveMarket = useCallback((marketId) => {
    updateTradingState((current) => {
      const nextStrategy = getTradingStrategy(marketId)
      const currentSynced = syncActiveMarketState(current)
      const nextMarketState = normalizeMarketState(
        nextStrategy.id,
        currentSynced.markets?.[nextStrategy.id],
      )
      const activity = createActivity({
        type: 'market',
        status: 'done',
        title: `Mercato attivo: ${nextStrategy.label}`,
        detail: `Spapple ora mostra capitale, posizioni, scansioni e storico del mercato ${nextStrategy.label}.`,
      })

      return {
        ...currentSynced,
        activeMarket: nextStrategy.id,
        markets: currentSynced.markets,
        ...nextMarketState,
        ...appendLogs(nextMarketState, activity),
      }
    })
  }, [updateTradingState])

  const recordScanStart = useCallback((tickerCount, targetMarketId = null) => {
    updateTradingState((current) => {
      const marketId = targetMarketId || current.activeMarket
      const marketCopy = getMarketCopy(marketId)
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        engineStatus: 'Scansione mercato in corso',
        ...appendLogs(
          marketState,
          createActivity({
            type: 'scan',
            status: 'working',
            title: `Scansione ${marketCopy.label} avviata`,
            detail: `Sto leggendo dati reali per ${tickerCount} ${marketCopy.assetPlural}.`,
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const recordScanComplete = useCallback(({ scannedCount, signalCount, results }, targetMarketId = null) => {
    updateTradingState((current) => {
      const marketId = targetMarketId || current.activeMarket
      const marketCopy = getMarketCopy(marketId)
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        lastScanAt: new Date().toISOString(),
        lastScanCount: scannedCount,
        lastSignalCount: signalCount,
        lastScanResults: Array.isArray(results)
          ? results
          : marketState.lastScanResults,
        engineStatus:
          signalCount > 0
            ? 'Segnali disponibili'
            : 'Nessun segnale operativo',
        ...appendLogs(
          marketState,
          createActivity({
            type: 'scan',
            status: signalCount > 0 ? 'attention' : 'done',
            title: `Scansione ${marketCopy.label} completata`,
            detail:
              signalCount > 0
                ? `${signalCount} segnali validi trovati su ${scannedCount} ${marketCopy.assetPlural}.`
                : `${scannedCount} ${marketCopy.assetPlural} controllati. Nessun asset rispetta le regole operative.`,
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const recordScanError = useCallback((message, targetMarketId = null) => {
    updateTradingState((current) => {
      const marketId = targetMarketId || current.activeMarket
      const marketCopy = getMarketCopy(marketId)
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        engineStatus: 'Errore dati mercato',
        ...appendLogs(
          marketState,
          createActivity({
            type: 'scan',
            status: 'error',
            title: `Scansione ${marketCopy.label} non riuscita`,
            detail:
              message ||
              `${marketCopy.provider} non ha restituito dati utilizzabili.`,
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const executeTrade = useCallback((ticker, price, atr, type, profile = null, targetMarketId = null) => {
    const current = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || current.activeMarket
    const strategy = getTradingStrategy(marketId)
    const marketState = normalizeMarketState(marketId, current.markets?.[marketId])
    const sizing = strategy.positionSizing
    const maxPositions = getStrategyMaxPositions(strategy)

    if (!['LONG', 'SHORT'].includes(type)) {
      throw new Error('Tipo ordine non valido')
    }

    if (marketState.positions.length >= maxPositions) {
      throw new Error('Slot operativi esauriti')
    }

    const positionSize = calculatePositionSize(marketState.capital, sizing)

    if (!canOpenPosition(marketState.capital, sizing)) {
      throw new Error('Capitale operativo insufficiente')
    }

    if (marketState.positions.some((position) => position.ticker === ticker)) {
      throw new Error(`${ticker} è già presente in portafoglio`)
    }

    const blockReason = getOpeningOrderBlockReason(
      { ...marketState, pendingTicker: ticker },
      positionSize,
      strategy,
    )

    if (blockReason) {
      const rejectedOrder = createSimulationOrder({
        action: 'OPEN',
        direction: type,
        marketId,
        marketLabel: strategy.label,
        notional: positionSize,
        requestedPrice: price,
        reason: blockReason,
        side: getOpenOrderSide(type),
        source: 'manual',
        status: 'RIFIUTATO',
        ticker,
      })
      const nextMarketState = {
        ...marketState,
        orders: appendOrders(marketState, rejectedOrder),
        engineStatus: 'Ordine simulato rifiutato',
        ...appendLogs(
          marketState,
          createActivity({
            type: 'order',
            status: 'error',
            title: 'Ordine simulato rifiutato',
            detail: `${ticker}: ${blockReason}`,
          }),
        ),
      }
      const nextState = activateMarketState(current, marketId, nextMarketState)

      stateRef.current = nextState
      setState(nextState)
      throw new Error(blockReason)
    }

    let order = createSimulationOrder({
      action: 'OPEN',
      direction: type,
      executedPrice: price,
      marketId,
      marketLabel: strategy.label,
      notional: positionSize,
      requestedPrice: price,
      reason: 'Apertura manuale confermata dallo Scanner.',
      side: getOpenOrderSide(type),
      source: 'manual',
      ticker,
    })
    const trade = buildTrade(
      ticker,
      price,
      atr,
      type,
      positionSize,
      profile,
      strategy,
      order,
    )
    order = { ...order, positionId: trade.id }
    const nextMarketState = {
      ...marketState,
      capital: roundPrice(marketState.capital - positionSize),
      positions: [...marketState.positions, trade],
      orders: appendOrders(marketState, order),
      engineStatus: 'Posizione aperta',
      ...appendLogs(
        marketState,
        createActivity({
          type: 'order',
          status: 'done',
          title: `Ordine simulato ${type === 'LONG' ? 'Long' : 'Short'} eseguito`,
          detail: `${ticker}: ordine ${order.id} eseguito a ${roundPrice(
            price,
          )}. Posizione da ${positionSize.toFixed(
            2,
          )}€ allocata. Take profit ${roundPrice(
            trade.takeProfit,
          )}, stop loss ${roundPrice(trade.stopLoss)}.`,
        }),
      ),
    }
    const nextState = activateMarketState(current, marketId, nextMarketState)

    stateRef.current = nextState
    setState(nextState)

    return trade
  }, [])

  const executeAutomatedTrades = useCallback((rows, targetMarketId = null) => {
    const current = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || current.activeMarket
    const strategy = getTradingStrategy(marketId)
    const marketState = normalizeMarketState(marketId, current.markets?.[marketId])
    const sizing = strategy.positionSizing
    const maxPositions = getStrategyMaxPositions(strategy)
    let capital = marketState.capital
    const positions = [...marketState.positions]
    let orders = marketState.orders || []
    const openedTrades = []
    const skippedTickers = []
    let activityLog = marketState.activityLog || []
    let events = marketState.events || []

    const appendLocalLog = (activity) => {
      activityLog = appendActivity({ activityLog }, activity)
      events = [activity, ...events]
    }

    rows.forEach((row) => {
      const type = getSignalType(row, strategy)
      const alreadyOpen = positions.some(
        (position) => position.ticker === row.ticker,
      )
      const canOpen =
        ['LONG', 'SHORT'].includes(type) &&
        positions.length < maxPositions &&
        canOpenPosition(capital, sizing) &&
        !alreadyOpen

      if (!canOpen) {
        skippedTickers.push(row.ticker)
        return
      }

      const positionSize = calculatePositionSize(capital, sizing)
      const blockReason = getOpeningOrderBlockReason(
        { ...marketState, capital, positions, orders, pendingTicker: row.ticker },
        positionSize,
        strategy,
      )

      if (blockReason) {
        const rejectedOrder = createSimulationOrder({
          action: 'OPEN',
          direction: type,
          marketId,
          marketLabel: strategy.label,
          notional: positionSize,
          requestedPrice: row.currentPrice,
          reason: blockReason,
          side: getOpenOrderSide(type),
          source: 'automation',
          status: 'RIFIUTATO',
          ticker: row.ticker,
        })
        orders = appendOrders({ orders }, rejectedOrder)
        skippedTickers.push(row.ticker)
        appendLocalLog(
          createActivity({
            type: 'order',
            status: 'error',
            title: 'Ordine automatico rifiutato',
            detail: `${row.ticker}: ${blockReason}`,
          }),
        )
        return
      }

      let order = createSimulationOrder({
        action: 'OPEN',
        direction: type,
        executedPrice: row.currentPrice,
        marketId,
        marketLabel: strategy.label,
        notional: positionSize,
        requestedPrice: row.currentPrice,
        reason: 'Apertura automatica da segnale validato.',
        side: getOpenOrderSide(type),
        source: 'automation',
        ticker: row.ticker,
      })
      const trade = buildTrade(
        row.ticker,
        row.currentPrice,
        row.atr,
        type,
        positionSize,
        row.profile || null,
        strategy,
        order,
      )
      order = { ...order, positionId: trade.id }
      orders = appendOrders({ orders }, order)
      positions.push(trade)
      capital = roundPrice(capital - positionSize)
      openedTrades.push(trade)
      appendLocalLog(
        createActivity({
          type: 'order',
          status: 'done',
          title: `Ordine automatico simulato ${type === 'LONG' ? 'Long' : 'Short'}`,
          detail: `${row.ticker}: ordine ${order.id} eseguito, posizione da ${positionSize.toFixed(
            2,
          )}€ allocata.`,
        }),
      )
    })

    appendLocalLog(
      createActivity({
        type: 'automation',
        status: openedTrades.length > 0 ? 'done' : 'waiting',
        title: 'Pilota automatico completato',
        detail:
          openedTrades.length > 0
            ? `${openedTrades.length} posizioni aperte automaticamente.`
            : `Nessuna posizione aperta. ${
                skippedTickers.length > 0
                  ? 'Segnali saltati per slot, capitale o duplicati.'
                  : 'Nessun segnale disponibile.'
              }`,
      }),
    )

    const nextMarketState = {
      ...marketState,
      capital,
      positions,
      orders,
      engineStatus:
        openedTrades.length > 0
          ? 'Pilota automatico eseguito'
          : marketState.engineStatus,
      activityLog,
      events,
    }
    const nextState = activateMarketState(current, marketId, nextMarketState)

    stateRef.current = nextState
    setState(nextState)

    return { openedTrades, skippedTickers }
  }, [])

  const fetchPositionPrices = useCallback(async (positions, targetMarketId = null) => {
    const marketId = targetMarketId || stateRef.current.activeMarket
    return Promise.all(
      positions.map(async (position) => ({
        position,
        latestPrice: await fetchLatestPrice(
          position.ticker,
          position.marketId || marketId,
        ),
      })),
    )
  }, [])

  const closePositionManually = useCallback(async (positionId, targetMarketId = null) => {
    if (closingPositionsRef.current.has(positionId)) {
      throw new Error('Chiusura già in corso per questa posizione')
    }

    closingPositionsRef.current.add(positionId)

    try {
      const snapshot = syncActiveMarketState(stateRef.current)
      const candidateMarketIds = targetMarketId
        ? [targetMarketId]
        : Object.keys(snapshot.markets || {})
      let marketId = targetMarketId
      let marketState = null
      let position = null

      for (const candidateMarketId of candidateMarketIds) {
        const candidateState = normalizeMarketState(
          candidateMarketId,
          snapshot.markets?.[candidateMarketId],
        )
        const candidatePosition = candidateState.positions.find(
          (item) => item.id === positionId,
        )

        if (candidatePosition) {
          marketId = candidateMarketId
          marketState = candidateState
          position = candidatePosition
          break
        }
      }

      if (!position) {
        throw new Error('Posizione non trovata')
      }

      if (!marketState) {
        marketState = normalizeMarketState(marketId, snapshot.markets?.[marketId])
      }

      const latestPrice = await fetchLatestPrice(
        position.ticker,
        position.marketId || marketId,
      )
      const invested = position.invested || LEGACY_POSITION_SIZE
      const quantity = invested / position.entryPrice
      const long = position.type === 'LONG'
      const pnlEur = long
        ? (latestPrice - position.entryPrice) * quantity
        : (position.entryPrice - latestPrice) * quantity
      const roundedPnl = roundPrice(pnlEur)
      const result = roundedPnl >= 0 ? 'WIN' : 'LOSS'
      const recoveredCapital = Math.max(invested + roundedPnl, 0)
      const closeOrder = createSimulationOrder({
        action: 'CLOSE',
        direction: position.type,
        executedPrice: latestPrice,
        marketId,
        marketLabel: marketState.marketLabel,
        notional: recoveredCapital,
        positionId: position.id,
        quantity: position.quantity || quantity,
        requestedPrice: latestPrice,
        reason: 'Chiusura manuale richiesta dallo Scanner o dal Portafoglio.',
        side: getCloseOrderSide(position.type),
        source: 'manual',
        ticker: position.ticker,
      })
      const closedTrade = {
        ticker: position.ticker,
        type: position.type,
        positionId: position.id,
        closeOrderId: closeOrder.id,
        openedAt: position.openedAt || null,
        entryPrice: position.entryPrice,
        invested,
        pnlEur: roundedPnl,
        result,
        exitDate: new Date().toISOString(),
        exitPrice: roundPrice(latestPrice),
        exitReason: 'MANUALE',
        recoveredCapital: roundPrice(recoveredCapital),
      }

      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )
        const alreadyClosed = currentMarketState.history.some(
          (trade) => trade.positionId === positionId,
        )

        if (alreadyClosed) {
          return syncedCurrent
        }

        const remainingPositions = currentMarketState.positions.filter(
          (item) => item.id !== positionId,
        )
        const capitalReturn = roundedPnl >= 0 ? invested : recoveredCapital
        const vaultGain = roundedPnl > 0 ? roundedPnl : 0

        const nextMarketState = {
          ...currentMarketState,
          capital: roundPrice(currentMarketState.capital + capitalReturn),
          vault: roundPrice(currentMarketState.vault + vaultGain),
          positions: remainingPositions,
          orders: appendOrders(currentMarketState, closeOrder),
          history: [closedTrade, ...currentMarketState.history],
          engineStatus:
            remainingPositions.length > 0
              ? 'Posizione chiusa manualmente'
              : 'Slot liberato, ricerca nuovi segnali',
          ...appendLogs(
            currentMarketState,
            createActivity({
              type: 'order',
              status: result === 'WIN' ? 'attention' : 'error',
              title: 'Ordine di chiusura simulato eseguito',
              detail: `${position.ticker}: ordine ${closeOrder.id} eseguito. P/L realizzato ${roundedPnl.toFixed(
                2,
              )}€. Avvio ricerca di un nuovo asset appetibile in ${currentMarketState.marketLabel}.`,
            }),
          ),
        }

        return activateMarketState(syncedCurrent, marketId, nextMarketState)
      })

      return closedTrade
    } finally {
      closingPositionsRef.current.delete(positionId)
    }
  }, [updateTradingState])

  const runLiveCheck = useCallback(async ({ silent = false, targetMarketId = null } = {}) => {
    const snapshot = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || snapshot.activeMarket
    const marketState = normalizeMarketState(marketId, snapshot.markets?.[marketId])

    if (marketState.positions.length === 0) {
      if (!silent) {
        updateTradingState((current) => {
          const syncedCurrent = syncActiveMarketState(current)
          const currentMarketState = normalizeMarketState(
            marketId,
            syncedCurrent.markets?.[marketId],
          )

          return updateMarketState(syncedCurrent, marketId, {
            ...currentMarketState,
            ...appendLogs(
              currentMarketState,
              createActivity({
                type: 'monitor',
                status: 'waiting',
                title: 'Monitor live in attesa',
                detail: 'Non ci sono posizioni aperte da controllare.',
              }),
            ),
          })
        })
      }
      return
    }

    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )

      return updateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        engineStatus: 'Monitor live in corso',
        nextLiveCheckAt: null,
        ...appendLogs(
          currentMarketState,
          createActivity({
            type: 'monitor',
            status: 'working',
            title: 'Controllo automatico avviato',
            detail: `Sto controllando ${currentMarketState.positions.length} posizioni aperte con prezzi aggiornati.`,
          }),
        ),
      })
    })

    let positionsWithPrices = []

    try {
      positionsWithPrices = await fetchPositionPrices(marketState.positions, marketId)
    } catch (error) {
      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )

        return updateMarketState(syncedCurrent, marketId, {
          ...currentMarketState,
          engineStatus: 'Errore monitor live',
          nextLiveCheckAt: new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString(),
          ...appendLogs(
            currentMarketState,
            createActivity({
              type: 'monitor',
              status: 'error',
              title: 'Monitor live interrotto',
              detail: error.message || 'Prezzi aggiornati non disponibili.',
            }),
          ),
        })
      })
      throw error
    }

    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const evaluatedCount = currentMarketState.positions.length
      const { capital, vault, activePositions, closedTrades, closeOrders } =
        evaluatePositions(currentMarketState, positionsWithPrices, {
          incrementDays: false,
          source: 'live-monitor',
        })

      return updateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        version: STORAGE_VERSION,
        capital,
        vault,
        positions: activePositions,
        orders: appendOrders(currentMarketState, closeOrders),
        history: [...closedTrades, ...currentMarketState.history],
        lastLiveCheckAt: new Date().toISOString(),
        nextLiveCheckAt:
          activePositions.length > 0 && currentMarketState.liveMonitorEnabled
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        engineStatus:
          activePositions.length > 0
            ? 'Monitor live attivo'
            : 'In attesa di nuova scansione',
        ...appendLogs(
          currentMarketState,
          createActivity({
            type: 'monitor',
            status: closedTrades.length > 0 ? 'attention' : 'done',
            title:
              closedTrades.length > 0
                ? 'Uscita automatica eseguita'
                : 'Controllo automatico completato',
            detail:
              closedTrades.length > 0
                ? `${closedTrades.length} posizioni chiuse perché hanno raggiunto target o stop.`
                : `${evaluatedCount} posizioni controllate. Nessun target o stop raggiunto; prossimo controllo tra 60 secondi.`,
          }),
        ),
      })
    })
  }, [fetchPositionPrices, updateTradingState])

  const runEOD = useCallback(async (targetMarketId = null) => {
    const snapshot = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || snapshot.activeMarket
    const marketState = normalizeMarketState(marketId, snapshot.markets?.[marketId])
    const marketCopy = getMarketCopy(marketId)
    const engineName =
      marketId === 'crypto' ? 'Controllo Crypto' : 'Motore EOD'

    if (marketState.positions.length === 0) {
      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )

        return activateMarketState(syncedCurrent, marketId, {
          ...currentMarketState,
          ...appendLogs(
            currentMarketState,
            createActivity({
              type: 'eod',
              status: 'waiting',
              title: `${engineName} non eseguito`,
              detail: 'Non ci sono posizioni aperte da controllare.',
            }),
          ),
        })
      })
      return
    }

    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )

      return activateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        engineStatus: `${engineName} in esecuzione`,
        ...appendLogs(
          currentMarketState,
          createActivity({
            type: 'eod',
            status: 'working',
            title: `${engineName} avviato`,
            detail: `Sto aggiornando i prezzi ${marketCopy.provider} di ${currentMarketState.positions.length} posizioni aperte.`,
          }),
        ),
      })
    })

    let positionsWithPrices = []

    try {
      positionsWithPrices = await fetchPositionPrices(marketState.positions, marketId)
    } catch (error) {
      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )

        return activateMarketState(syncedCurrent, marketId, {
          ...currentMarketState,
          engineStatus: `Errore ${engineName}`,
          ...appendLogs(
            currentMarketState,
            createActivity({
              type: 'eod',
              status: 'error',
              title: `${engineName} interrotto`,
              detail: error.message || 'Prezzi aggiornati non disponibili.',
            }),
          ),
        })
      })
      throw error
    }

    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const evaluatedCount = currentMarketState.positions.length
      const { capital, vault, activePositions, closedTrades, closeOrders } =
        evaluatePositions(currentMarketState, positionsWithPrices, {
          incrementDays: true,
          source: 'eod',
        })

      return activateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        version: STORAGE_VERSION,
        capital,
        vault,
        positions: activePositions,
        orders: appendOrders(currentMarketState, closeOrders),
        history: [...closedTrades, ...currentMarketState.history],
        lastLiveCheckAt: new Date().toISOString(),
        nextLiveCheckAt:
          activePositions.length > 0 && currentMarketState.liveMonitorEnabled
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        engineStatus:
          activePositions.length > 0
            ? 'Posizioni in monitoraggio'
            : 'In attesa di nuova scansione',
        ...appendLogs(
          currentMarketState,
          createActivity({
            type: 'eod',
            status: closedTrades.length > 0 ? 'attention' : 'done',
            title: `${engineName} completato`,
            detail:
              closedTrades.length > 0
                ? `${closedTrades.length} posizioni chiuse, ${activePositions.length} ancora aperte.`
                : `${evaluatedCount} posizioni controllate. Nessun target o stop loss raggiunto.`,
          }),
        ),
      })
    })
  }, [fetchPositionPrices, updateTradingState])

  useEffect(() => {
    const marketIdsToMonitor = Object.values(TRADING_STRATEGIES)
      .map((strategy) => strategy.id)
      .filter((marketId) => {
        const marketState = normalizeMarketState(
          marketId,
          state.markets?.[marketId],
        )

        return (
          marketState.automationEnabled &&
          marketState.liveMonitorEnabled &&
          marketState.positions.length > 0
        )
      })

    if (!isAuthenticated || marketIdsToMonitor.length === 0) {
      return undefined
    }

    const missingNextCheckIds = marketIdsToMonitor.filter((marketId) => {
      const marketState = normalizeMarketState(marketId, state.markets?.[marketId])
      return !marketState.nextLiveCheckAt
    })

    if (missingNextCheckIds.length > 0) {
      updateTradingState((current) => {
        let nextState = syncActiveMarketState(current)

        missingNextCheckIds.forEach((marketId) => {
          const marketState = normalizeMarketState(
            marketId,
            nextState.markets?.[marketId],
          )

          nextState = updateMarketState(nextState, marketId, {
            ...marketState,
            nextLiveCheckAt: new Date(
              Date.now() + LIVE_MONITOR_INTERVAL_MS,
            ).toISOString(),
          })
        })

        return nextState
      })
    }

    const intervalId = window.setInterval(async () => {
      if (liveCheckRunningRef.current) {
        return
      }

      liveCheckRunningRef.current = true

      try {
        for (const marketId of marketIdsToMonitor) {
          await runLiveCheck({ silent: true, targetMarketId: marketId })
        }
      } catch {
        // L'errore viene gia registrato nello storico dal monitor.
      } finally {
        liveCheckRunningRef.current = false
      }
    }, LIVE_MONITOR_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    isAuthenticated,
    runLiveCheck,
    state.markets,
    updateTradingState,
  ])

  const value = useMemo(
    () => ({
      ...state,
      remoteStatus,
      closePositionManually,
      executeTrade,
      executeAutomatedTrades,
      recordActivity,
      recordScanComplete,
      recordScanError,
      recordScanStart,
      runLiveCheck,
      runEOD,
      setAutomationEnabled,
      setKillSwitchEnabled,
      setLiveMonitorEnabled,
      setActiveMarket,
      strategies: Object.values(TRADING_STRATEGIES),
      currentStrategy: getTradingStrategy(state.activeMarket),
      slotSize: calculatePositionSize(
        state.capital,
        getTradingStrategy(state.activeMarket).positionSizing,
      ),
      minPositionSize:
        getTradingStrategy(state.activeMarket).positionSizing.min || MIN_POSITION_SIZE,
      maxPositions: getStrategyMaxPositions(getTradingStrategy(state.activeMarket)),
    }),
    [
      closePositionManually,
      executeTrade,
      executeAutomatedTrades,
      recordActivity,
      recordScanComplete,
      recordScanError,
      recordScanStart,
      runLiveCheck,
      runEOD,
      setAutomationEnabled,
      setKillSwitchEnabled,
      setLiveMonitorEnabled,
      setActiveMarket,
      state,
      remoteStatus,
    ],
  )

  return (
    <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
  )
}
