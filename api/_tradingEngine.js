import { createClient } from '@supabase/supabase-js'
import { ATR, RSI } from 'technicalindicators'
import {
  CRYPTO_TICKERS,
  getCryptoMeta,
  getCryptoMappingWarning,
} from '../src/services/cryptoUniverse.js'
import {
  CRYPTO_LONG_RSI_LIMIT,
  getCryptoSignalType,
  isCryptoActionableResult,
  isCryptoAutoEligibleResult,
  sortByCryptoAutoScore,
  CRYPTO_MIN_DAILY_VOLUME_EUR,
  CRYPTO_MIN_MARKET_CAP_EUR,
  CRYPTO_SHORT_RSI_LIMIT,
} from '../src/services/cryptoRules.js'
import { EUROPEAN_TICKERS } from '../src/services/marketUniverse.js'
import {
  isActionableResult,
  isAutoEligibleResult,
  sortByAutoScore,
} from '../src/services/tradingRules.js'
import {
  buildUsMarketContextFromHistory,
  createUnavailableUsMarketContext,
  filterEquityRowsByUsMarketContext,
  getUsMarketContextSummary,
  US_MARKET_CONTEXT_SYMBOL,
} from '../src/services/usMarketContext.js'
import {
  LEGACY_POSITION_SIZE,
  MIN_POSITION_SIZE,
  calculatePositionSize,
  canOpenPosition,
} from '../src/services/positionSizing.js'
import { getEodhdSymbol } from '../src/services/eodhdSymbols.js'
import { mergeTickerProfile } from '../src/services/tickerMetadata.js'
import {
  DEFAULT_MARKET_ID,
  TRADING_STRATEGIES,
  getTradingStrategy,
} from '../src/strategies/index.js'
import { fetchEodhdJson, isEodhdConfigured } from './_eodhd.js'
import { clearYahooAuth, fetchYahooJson, getYahooAuth } from './_yahoo.js'

export const STATE_ID = 'default'
export const STORAGE_VERSION = 9
export { DEFAULT_MARKET_ID }

const MAX_POSITIONS = 5
const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 8
const EXECUTION_MODE = 'simulation'
const EQUITIES_SCAN_INTERVAL_MS = 15 * 60_000
const CRYPTO_SCAN_INTERVAL_MS = 5 * 60_000
const EQUITIES_MARKET_CLOSE_GUARD = {
  marketId: 'equities',
  timezone: 'Europe/Rome',
  hour: 16,
  minute: 25,
}
const EQUITIES_MARKET_SCAN_START = {
  hour: 9,
  minute: 5,
}
const DEFAULT_RISK_LIMITS = {
  maxDailyOrders: 20,
  maxDailyCapitalPct: 1,
  maxConsecutiveLosses: 3,
}
const DEFAULT_REENTRY_COOLDOWN_MS = 6 * 60 * 60 * 1000

function getTimeInTimezone(date = new Date(), timezone = 'Europe/Rome') {
  const parts = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  const second = Number(parts.find((part) => part.type === 'second')?.value)

  return { hour, minute, second }
}

function isEquitiesCloseGuardActive(strategy, date = new Date()) {
  if (strategy?.id !== EQUITIES_MARKET_CLOSE_GUARD.marketId) {
    return false
  }

  const { hour, minute } = getTimeInTimezone(
    date,
    EQUITIES_MARKET_CLOSE_GUARD.timezone,
  )

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false
  }

  const currentMinutes = hour * 60 + minute
  const guardMinutes =
    EQUITIES_MARKET_CLOSE_GUARD.hour * 60 + EQUITIES_MARKET_CLOSE_GUARD.minute

  return currentMinutes >= guardMinutes
}

function getEquitiesCloseGuardLabel() {
  return `${String(EQUITIES_MARKET_CLOSE_GUARD.hour).padStart(2, '0')}:${String(
    EQUITIES_MARKET_CLOSE_GUARD.minute,
  ).padStart(2, '0')}`
}

function getEquitiesScanStartLabel() {
  return `${String(EQUITIES_MARKET_SCAN_START.hour).padStart(2, '0')}:${String(
    EQUITIES_MARKET_SCAN_START.minute,
  ).padStart(2, '0')}`
}

function getMarketScanIntervalMs(marketId) {
  return marketId === 'crypto' ? CRYPTO_SCAN_INTERVAL_MS : EQUITIES_SCAN_INTERVAL_MS
}

function getRiskLimits(strategy, riskLimits = {}) {
  return {
    ...DEFAULT_RISK_LIMITS,
    ...(riskLimits || {}),
    ...(strategy?.riskLimits || {}),
  }
}

function getNextEquitiesScanAt(now = new Date()) {
  const currentRomeTime = getTimeInTimezone(
    now,
    EQUITIES_MARKET_CLOSE_GUARD.timezone,
  )
  const currentSeconds =
    currentRomeTime.hour * 3600 +
    currentRomeTime.minute * 60 +
    currentRomeTime.second
  const scanStartSeconds =
    EQUITIES_MARKET_SCAN_START.hour * 3600 +
    EQUITIES_MARKET_SCAN_START.minute * 60

  if (!Number.isFinite(currentSeconds)) {
    return new Date(now.getTime() + EQUITIES_SCAN_INTERVAL_MS)
  }

  const secondsUntilOpen =
    currentSeconds < scanStartSeconds
      ? scanStartSeconds - currentSeconds
      : 24 * 3600 - currentSeconds + scanStartSeconds

  return new Date(now.getTime() + secondsUntilOpen * 1000)
}

function isEquitiesScanBlocked(strategy, date = new Date()) {
  if (strategy?.id !== EQUITIES_MARKET_CLOSE_GUARD.marketId) {
    return false
  }

  const { hour, minute } = getTimeInTimezone(
    date,
    EQUITIES_MARKET_CLOSE_GUARD.timezone,
  )

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false
  }

  const currentMinutes = hour * 60 + minute
  const scanStartMinutes =
    EQUITIES_MARKET_SCAN_START.hour * 60 + EQUITIES_MARKET_SCAN_START.minute
  const closeMinutes =
    EQUITIES_MARKET_CLOSE_GUARD.hour * 60 + EQUITIES_MARKET_CLOSE_GUARD.minute

  return currentMinutes < scanStartMinutes || currentMinutes >= closeMinutes
}

function getNextScanAt(marketId, from = new Date()) {
  const strategy = getTradingStrategy(marketId)

  if (isEquitiesCloseGuardActive(strategy, from)) {
    return getNextEquitiesScanAt(from).toISOString()
  }

  if (isEquitiesScanBlocked(strategy, from)) {
    return getNextEquitiesScanAt(from).toISOString()
  }

  return new Date(from.getTime() + getMarketScanIntervalMs(marketId)).toISOString()
}

function normalizeNextScanAt(marketId, value, fallbackValue = null) {
  const candidate = value || fallbackValue

  if (!candidate) {
    return getNextScanAt(marketId)
  }

  const candidateDate = new Date(candidate)

  if (
    Number.isFinite(candidateDate.getTime()) &&
    isEquitiesScanBlocked(getTradingStrategy(marketId), candidateDate)
  ) {
    return getNextScanAt(marketId, candidateDate)
  }

  return candidate
}

function getStrategyMaxPositions(strategy) {
  return Number.isFinite(Number(strategy.maxPositions))
    ? Number(strategy.maxPositions)
    : MAX_POSITIONS
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
  'isChecking',
  'isScanning',
  'lastAutomationMessage',
  'lastDataProvider',
  'lastSyncAt',
  'lastLiveCheckAt',
  'lastBackendCheckAt',
  'nextScanAt',
  'nextLiveCheckAt',
  'engineStatus',
  'liveMonitorEnabled',
  'backendMonitorEnabled',
  'usMarketContext',
]

const initialState = {
  version: STORAGE_VERSION,
  stateRevision: 0,
  lastStateMutationAt: null,
  lastStateMutationSource: 'iniziale',
  lastStateMutationSummary: 'Stato iniziale Spapple.',
  activeMarket: DEFAULT_MARKET_ID,
  marketId: DEFAULT_MARKET_ID,
  marketLabel: getTradingStrategy(DEFAULT_MARKET_ID).label,
  capital: 30000,
  vault: 0,
  positions: [],
  history: [],
  orders: [],
  activityLog: [],
  events: [],
  executionMode: EXECUTION_MODE,
  killSwitchEnabled: false,
  riskLimits: DEFAULT_RISK_LIMITS,
  automationEnabled: true,
  liveMonitorEnabled: true,
  backendMonitorEnabled: true,
  lastScanAt: null,
  lastScanCount: 0,
  lastSignalCount: 0,
  lastScanResults: [],
  isChecking: false,
  isScanning: false,
  lastAutomationMessage: 'Pilota automatico pronto.',
  lastDataProvider: null,
  lastSyncAt: null,
  lastLiveCheckAt: null,
  lastBackendCheckAt: null,
  nextScanAt: getNextScanAt(DEFAULT_MARKET_ID),
  nextLiveCheckAt: null,
  engineStatus: 'In attesa',
  usMarketContext: null,
}

function createInitialMarkets() {
  return Object.values(TRADING_STRATEGIES).reduce((markets, strategy) => {
    markets[strategy.id] = normalizeMarketState(strategy.id, {})
    return markets
  }, {})
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

function calculateNetPnlFromHistory(history = []) {
  return history.reduce((total, trade) => {
    const pnl = Number(trade?.pnlEur)

    return Number.isFinite(pnl) ? total + pnl : total
  }, 0)
}

function calculateInvestedInPositions(positions = []) {
  return positions.reduce((total, position) => {
    const invested = Number(position?.invested)

    return Number.isFinite(invested) ? total + invested : total
  }, 0)
}

function reconcileAvailableCapital(strategy, fallbackCapital, history, positions) {
  if (!history.length && !positions.length) {
    return fallbackCapital
  }

  const netPnl = calculateNetPnlFromHistory(history)
  const invested = calculateInvestedInPositions(positions)

  return roundPrice(Math.max(strategy.initialCapital + netPnl - invested, 0))
}

function normalizeMarketState(marketId, rawMarketState = {}) {
  const strategy = getTradingStrategy(marketId)
  const fallback = {
    marketId: strategy.id,
    marketLabel: strategy.label,
    capital: strategy.initialCapital,
    vault: 0,
    positions: [],
    history: [],
    orders: [],
    activityLog: [],
    events: [],
    executionMode: EXECUTION_MODE,
    killSwitchEnabled: false,
    riskLimits: getRiskLimits(strategy),
    automationEnabled: true,
    liveMonitorEnabled: true,
    backendMonitorEnabled: true,
    lastScanAt: null,
    lastScanCount: 0,
    lastSignalCount: 0,
    lastScanResults: [],
    isChecking: false,
    isScanning: false,
    lastAutomationMessage: 'Pilota automatico pronto.',
    lastDataProvider: null,
    lastSyncAt: null,
    lastLiveCheckAt: null,
    lastBackendCheckAt: null,
    nextScanAt: getNextScanAt(strategy.id),
    nextLiveCheckAt: null,
    engineStatus: 'In attesa',
  }
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

  const history = Array.isArray(rawMarketState.history) ? rawMarketState.history : []
  const orders = Array.isArray(rawMarketState.orders) ? rawMarketState.orders : []
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
      : [],
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
      : [],
    events: Array.isArray(rawMarketState.events) ? rawMarketState.events : [],
    executionMode: rawMarketState.executionMode || fallback.executionMode,
    killSwitchEnabled: false,
    riskLimits: getRiskLimits(strategy, rawMarketState.riskLimits),
    automationEnabled: true,
    liveMonitorEnabled: true,
    backendMonitorEnabled:
      typeof rawMarketState.backendMonitorEnabled === 'boolean'
        ? rawMarketState.backendMonitorEnabled
        : fallback.backendMonitorEnabled,
    isChecking: Boolean(rawMarketState.isChecking),
    isScanning: Boolean(rawMarketState.isScanning),
    lastAutomationMessage:
      rawMarketState.lastAutomationMessage || fallback.lastAutomationMessage,
    lastDataProvider: rawMarketState.lastDataProvider || fallback.lastDataProvider,
    lastSyncAt: rawMarketState.lastSyncAt || fallback.lastSyncAt,
    lastScanAt: rawMarketState.lastScanAt || fallback.lastScanAt,
    lastScanCount: Number.isFinite(Number(rawMarketState.lastScanCount))
      ? Number(rawMarketState.lastScanCount)
      : fallback.lastScanCount,
    lastSignalCount: Number.isFinite(Number(rawMarketState.lastSignalCount))
      ? Number(rawMarketState.lastSignalCount)
      : fallback.lastSignalCount,
    lastLiveCheckAt: rawMarketState.lastLiveCheckAt || fallback.lastLiveCheckAt,
    lastBackendCheckAt:
      rawMarketState.lastBackendCheckAt || fallback.lastBackendCheckAt,
    nextScanAt: normalizeNextScanAt(
      marketId,
      rawMarketState.nextScanAt,
      fallback.nextScanAt,
    ),
    nextLiveCheckAt: rawMarketState.nextLiveCheckAt || fallback.nextLiveCheckAt,
    lastScanResults: sanitizeScanResults(rawMarketState.lastScanResults, marketId),
    usMarketContext: rawMarketState.usMarketContext || fallback.usMarketContext,
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
    version: STORAGE_VERSION,
  }
}

export function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

export function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServerKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVER_KEY

  if (!supabaseUrl || !supabaseServerKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseServerKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export function normalizeTradingState(payload) {
  const state = payload && typeof payload === 'object' ? payload : {}
  const activeMarket = state.activeMarket || DEFAULT_MARKET_ID
  const rawMarkets =
    state.markets && typeof state.markets === 'object' ? state.markets : {}
  const legacyMarketState = normalizeMarketState(DEFAULT_MARKET_ID, state)
  const markets = {
    ...createInitialMarkets(),
    ...rawMarkets,
    ...Object.values(TRADING_STRATEGIES).reduce((normalizedMarkets, strategy) => {
      normalizedMarkets[strategy.id] = normalizeMarketState(
        strategy.id,
        rawMarkets[strategy.id] ||
          (strategy.id === DEFAULT_MARKET_ID ? legacyMarketState : {}),
      )
      return normalizedMarkets
    }, {}),
  }
  const activeMarketState = normalizeMarketState(
    activeMarket,
    markets[activeMarket] || markets[DEFAULT_MARKET_ID],
  )

  return syncActiveMarketState({
    ...initialState,
    ...state,
    version: STORAGE_VERSION,
    stateRevision: Number.isFinite(Number(state.stateRevision))
      ? Number(state.stateRevision)
      : 0,
    lastStateMutationAt: state.lastStateMutationAt || null,
    lastStateMutationSource: state.lastStateMutationSource || 'iniziale',
    lastStateMutationSummary:
      state.lastStateMutationSummary || 'Stato iniziale Spapple.',
    activeMarket,
    markets,
    ...activeMarketState,
  })
}

function roundPrice(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return null
  }

  return Number(number.toFixed(4))
}

function roundQuantity(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return null
  }

  return Number(number.toFixed(8))
}

function assertNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`${label} non disponibile`)
  }

  return number
}

function createActivity({ type = 'system', status = 'done', title, detail }) {
  return {
    id: `${type}-${Date.now()}-${crypto.randomUUID()}`,
    type,
    status,
    title,
    detail,
    createdAt: new Date().toISOString(),
  }
}

function appendLogs(state, activity) {
  return {
    activityLog: [activity, ...(state.activityLog || [])].slice(0, 14),
    events: [activity, ...(state.events || [])],
  }
}

function appendOrders(state, orders) {
  const nextOrders = Array.isArray(orders) ? orders : [orders]
  return [...nextOrders, ...(state.orders || [])].slice(0, 250)
}

function isSameDay(value, dayKey = new Date().toISOString().slice(0, 10)) {
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

function getReentryCooldownMs(strategy, latestClosedTrade) {
  const pnlEur = Number(latestClosedTrade?.pnlEur)
  const isLoss =
    latestClosedTrade?.result === 'LOSS' || (Number.isFinite(pnlEur) && pnlEur < 0)
  const isWin =
    latestClosedTrade?.result === 'WIN' || (Number.isFinite(pnlEur) && pnlEur >= 0)
  const dynamicCooldownMs = isLoss
    ? strategy?.reentryCooldownAfterLossMs
    : isWin
      ? strategy?.reentryCooldownAfterWinMs
      : null

  if (Number.isFinite(Number(dynamicCooldownMs))) {
    return Number(dynamicCooldownMs)
  }

  if (Number.isFinite(Number(strategy?.reentryCooldownMs))) {
    return Number(strategy.reentryCooldownMs)
  }

  return DEFAULT_REENTRY_COOLDOWN_MS
}

function getTickerCooldownReason(marketState, ticker, strategy) {
  if (!ticker) {
    return null
  }

  const latestClosedTrade = (marketState.history || []).find(
    (trade) => trade?.ticker === ticker && trade?.exitDate,
  )

  if (!latestClosedTrade) {
    return null
  }

  const cooldownMs = getReentryCooldownMs(strategy, latestClosedTrade)

  if (cooldownMs <= 0) {
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
  const riskLimits = getRiskLimits(strategy, marketState.riskLimits)

  if (marketState.executionMode !== EXECUTION_MODE) {
    return 'Modalità operativa non supportata: al momento Spapple può eseguire solo ordini simulati.'
  }

  if (marketState.killSwitchEnabled) {
    return 'Kill switch attivo: nuove aperture bloccate.'
  }

  if (isEquitiesCloseGuardActive(strategy)) {
    return `Protezione azionaria ${getEquitiesCloseGuardLabel()} attiva: nuove aperture bloccate fino alla prossima seduta.`
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

  if (todaysOpeningOrders.length >= riskLimits.maxDailyOrders) {
    return `Limite giornaliero raggiunto: massimo ${riskLimits.maxDailyOrders} aperture eseguite al giorno.`
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
  source = 'backend-monitor',
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
    id: `order-${Date.now()}-${crypto.randomUUID()}`,
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

async function fetchSummaryPrice(ticker) {
  const { cookie, crumb } = await getYahooAuth()
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`,
  )
  yahooUrl.searchParams.set('modules', 'price')
  yahooUrl.searchParams.set('crumb', crumb)

  const yahooResponse = await fetchYahooJson(yahooUrl, { cookie })

  if (!yahooResponse.ok) {
    clearYahooAuth()
    throw new Error(`${ticker}: prezzo Yahoo non disponibile`)
  }

  const data = JSON.parse(yahooResponse.text)
  const summary = data?.quoteSummary?.result?.[0]
  const price =
    summary?.price?.regularMarketPrice?.raw ??
    summary?.price?.postMarketPrice?.raw ??
    summary?.price?.preMarketPrice?.raw
  const number = Number(price)

  if (!Number.isFinite(number)) {
    throw new Error(`${ticker}: prezzo di mercato non valido`)
  }

  return number
}

async function fetchChartPrice(ticker) {
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  )
  yahooUrl.searchParams.set('range', '5d')
  yahooUrl.searchParams.set('interval', '1d')

  const yahooResponse = await fetchYahooJson(yahooUrl)

  if (!yahooResponse.ok) {
    throw new Error(`${ticker}: storico Yahoo non disponibile`)
  }

  const data = JSON.parse(yahooResponse.text)
  const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []
  const latestClose = [...closes].reverse().find((value) => value !== null)
  const number = Number(latestClose)

  if (!Number.isFinite(number)) {
    throw new Error(`${ticker}: ultimo prezzo non valido`)
  }

  return number
}

function getEodhdFromDate(days = 120) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function extractEodhdHistory(eodData, ticker) {
  if (!Array.isArray(eodData)) {
    throw new Error(`${ticker}: storico EODHD non disponibile`)
  }

  const history = eodData
    .map((bar) => ({
      date: bar.date,
      high: bar.high,
      low: bar.low,
      close: bar.adjusted_close ?? bar.close,
    }))
    .filter(
      (bar) =>
        bar.date &&
        bar.high !== null &&
        bar.high !== undefined &&
        bar.low !== null &&
        bar.low !== undefined &&
        bar.close !== null &&
        bar.close !== undefined,
    )
    .map((bar) => ({
      date: bar.date,
      high: assertNumber(bar.high, `${ticker}: massimo EODHD`),
      low: assertNumber(bar.low, `${ticker}: minimo EODHD`),
      close: assertNumber(bar.close, `${ticker}: chiusura EODHD`),
    }))

  if (history.length < MIN_HISTORY_LENGTH) {
    throw new Error(`${ticker}: storico EODHD giornaliero insufficiente`)
  }

  return history
}

function extractEodhdPeRatio(fundamentalsData, ticker) {
  const highlights = fundamentalsData?.Highlights || {}
  const valuation = fundamentalsData?.Valuation || {}
  const pe =
    highlights.PERatio ??
    highlights.TrailingPE ??
    highlights.ForwardPE ??
    valuation.TrailingPE ??
    valuation.ForwardPE
  const peNumber = assertNumber(pe, `${ticker}: P/E EODHD`)

  if (peNumber <= 0) {
    throw new Error(`${ticker}: P/E EODHD non profittevole`)
  }

  return peNumber
}

function extractEodhdPrice(realTimeData, ticker) {
  const price =
    realTimeData?.close ??
    realTimeData?.adjusted_close ??
    realTimeData?.previousClose ??
    realTimeData?.last ??
    realTimeData?.price

  return assertNumber(price, `${ticker}: prezzo EODHD`)
}

function extractEodhdProfile(fundamentalsData, ticker) {
  const general = fundamentalsData?.General || {}

  return mergeTickerProfile(ticker, {
    name: general.Name || null,
    sector: general.Sector || null,
    industry: general.Industry || null,
    country: general.CountryName || general.CountryISO || null,
    website: general.WebURL || null,
    description: general.Description || null,
  })
}

async function fetchEodhdHistory(ticker) {
  const data = await fetchEodhdJson(`eod/${encodeURIComponent(getEodhdSymbol(ticker))}`, {
    period: 'd',
    order: 'a',
    from: getEodhdFromDate(),
    to: new Date().toISOString().slice(0, 10),
  })

  return extractEodhdHistory(data, ticker)
}

async function fetchEodhdLatestPrice(ticker) {
  try {
    const realTimeData = await fetchEodhdJson(
      `real-time/${encodeURIComponent(getEodhdSymbol(ticker))}`,
    )

    return extractEodhdPrice(realTimeData, ticker)
  } catch {
    const history = await fetchEodhdHistory(ticker)

    return history.at(-1).close
  }
}

async function fetchEodhdFundamentals(ticker) {
  return fetchEodhdJson(`fundamentals/${encodeURIComponent(getEodhdSymbol(ticker))}`)
}

function getCoinGeckoApiKey() {
  return process.env.COINGECKO_API_KEY || process.env.CG_API_KEY || ''
}

async function fetchCoinGeckoMarkets(items) {
  const ids = items
    .map((item) => getCryptoMeta(item.ticker || item)?.coingeckoId)
    .filter(Boolean)

  if (ids.length === 0) {
    return new Map()
  }

  const apiKey = getCoinGeckoApiKey()

  if (!apiKey) {
    throw new Error('Chiave CoinGecko non configurata sul server')
  }

  const coingeckoUrl = new URL('https://api.coingecko.com/api/v3/coins/markets')
  coingeckoUrl.searchParams.set('vs_currency', 'eur')
  coingeckoUrl.searchParams.set('ids', [...new Set(ids)].join(','))
  coingeckoUrl.searchParams.set('order', 'market_cap_desc')
  coingeckoUrl.searchParams.set('per_page', '250')
  coingeckoUrl.searchParams.set('page', '1')
  coingeckoUrl.searchParams.set('sparkline', 'false')
  coingeckoUrl.searchParams.set('price_change_percentage', '24h,7d')

  const coingeckoResponse = await fetch(coingeckoUrl, {
    headers: {
      accept: 'application/json',
      'x-cg-demo-api-key': apiKey,
    },
  })
  const payload = await coingeckoResponse.json()

  if (!coingeckoResponse.ok || !Array.isArray(payload)) {
    throw new Error(
      payload?.error ||
        payload?.status?.error_message ||
        'CoinGecko non ha restituito dati utilizzabili',
    )
  }

  return new Map(payload.map((item) => [item.id, item]))
}

async function fetchKrakenOhlc(pair) {
  const krakenUrl = new URL('https://api.kraken.com/0/public/OHLC')
  krakenUrl.searchParams.set('pair', pair)
  krakenUrl.searchParams.set('interval', '1440')

  const krakenResponse = await fetch(krakenUrl)
  const data = await krakenResponse.json()

  if (!krakenResponse.ok || data.error?.length) {
    throw new Error(
      data.error?.join(', ') || 'Kraken non ha restituito dati utilizzabili',
    )
  }

  return data
}

function extractKrakenHistory(payload, ticker) {
  const result = payload?.result || {}
  const pairKey = Object.keys(result).find((key) => key !== 'last')
  const rows = pairKey ? result[pairKey] : null

  if (!Array.isArray(rows)) {
    throw new Error(`${ticker}: storico Kraken non disponibile`)
  }

  const history = rows
    .map((row) => ({
      date: new Date(Number(row[0]) * 1000).toISOString().slice(0, 10),
      high: assertNumber(row[2], `${ticker}: massimo`),
      low: assertNumber(row[3], `${ticker}: minimo`),
      close: assertNumber(row[4], `${ticker}: chiusura`),
      volume: assertNumber(row[6], `${ticker}: volume`),
    }))
    .filter((bar) => bar.high > 0 && bar.low > 0 && bar.close > 0)

  if (history.length < MIN_HISTORY_LENGTH) {
    throw new Error(`${ticker}: storico giornaliero insufficiente`)
  }

  return history
}

export async function fetchLatestMarketPrice(ticker, marketId = DEFAULT_MARKET_ID) {
  if (marketId === 'crypto') {
    const meta = getCryptoMeta(ticker)

    if (!meta?.krakenPair) {
      throw new Error(`${ticker}: coppia Kraken non configurata`)
    }

    const payload = await fetchKrakenOhlc(meta.krakenPair)
    const history = extractKrakenHistory(payload, ticker)

    return history.at(-1).close
  }

  if (isEodhdConfigured()) {
    try {
      return await fetchEodhdLatestPrice(ticker)
    } catch {
      // Yahoo resta una rete di sicurezza se EODHD non restituisce quel ticker.
    }
  }

  try {
    return await fetchSummaryPrice(ticker)
  } catch {
    return fetchChartPrice(ticker)
  }
}

async function fetchChartHistory(ticker) {
  if (isEodhdConfigured()) {
    try {
      return await fetchEodhdHistory(ticker)
    } catch {
      // Se EODHD non copre il simbolo specifico, continuiamo con Yahoo.
    }
  }

  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  )
  yahooUrl.searchParams.set('range', '3mo')
  yahooUrl.searchParams.set('interval', '1d')

  const yahooResponse = await fetchYahooJson(yahooUrl)

  if (!yahooResponse.ok) {
    throw new Error(`${ticker}: storico Yahoo non disponibile`)
  }

  const data = JSON.parse(yahooResponse.text)
  const result = data?.chart?.result?.[0]
  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0]

  if (!Array.isArray(timestamps) || !quote) {
    throw new Error(`${ticker}: storico giornaliero non valido`)
  }

  const history = timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: quote.close?.[index],
    }))
    .filter((bar) => bar.high !== null && bar.low !== null && bar.close !== null)
    .map((bar) => ({
      date: bar.date,
      high: assertNumber(bar.high, `${ticker}: massimo`),
      low: assertNumber(bar.low, `${ticker}: minimo`),
      close: assertNumber(bar.close, `${ticker}: chiusura`),
    }))

  if (history.length < MIN_HISTORY_LENGTH) {
    throw new Error(`${ticker}: storico giornaliero insufficiente`)
  }

  return history
}

async function fetchBackendUsMarketContext() {
  try {
    const history = await fetchChartHistory(US_MARKET_CONTEXT_SYMBOL)

    return buildUsMarketContextFromHistory(history)
  } catch (error) {
    return createUnavailableUsMarketContext(
      error.message || 'Contesto USA non disponibile',
    )
  }
}

async function fetchSummaryData(ticker) {
  const { cookie, crumb } = await getYahooAuth()
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`,
  )
  yahooUrl.searchParams.set(
    'modules',
    'summaryDetail,defaultKeyStatistics,price,assetProfile',
  )
  yahooUrl.searchParams.set('crumb', crumb)

  const yahooResponse = await fetchYahooJson(yahooUrl, { cookie })

  if (!yahooResponse.ok) {
    clearYahooAuth()
    throw new Error(`${ticker}: fondamentali Yahoo non disponibili`)
  }

  return JSON.parse(yahooResponse.text)
}

function extractPeRatio(summaryData, ticker) {
  const summary = summaryData?.quoteSummary?.result?.[0]
  const pe =
    summary?.summaryDetail?.trailingPE?.raw ??
    summary?.defaultKeyStatistics?.trailingPE?.raw ??
    summary?.summaryDetail?.forwardPE?.raw

  const peNumber = assertNumber(pe, `${ticker}: P/E`)

  if (peNumber <= 0) {
    throw new Error(`${ticker}: P/E non profittevole`)
  }

  return peNumber
}

function calculateIndicators(history, ticker) {
  const high = history.map((bar) => bar.high)
  const low = history.map((bar) => bar.low)
  const close = history.map((bar) => bar.close)
  const rsi = RSI.calculate({ values: close, period: RSI_PERIOD }).at(-1)
  const atr = ATR.calculate({ high, low, close, period: ATR_PERIOD }).at(-1)

  return {
    rsi: assertNumber(rsi, `${ticker}: RSI`),
    atr: assertNumber(atr, `${ticker}: ATR`),
  }
}

function getDiagnostic(row) {
  if (row.status === 'error') {
    return row.reason || 'Dati non disponibili'
  }

  if (row.pe <= 0) {
    return 'Scartato: P/E assente, nullo o negativo'
  }

  if (row.rsi >= 30 && row.rsi <= 70) {
    return 'Scartato: RSI in zona neutrale'
  }

  if (row.rsi < 30) {
    return 'Ammesso: società profittevole e RSI sotto 30'
  }

  return 'Ammesso: società profittevole e RSI sopra 70'
}

async function fetchTickerDiagnostic(ticker) {
  try {
    let history
    let pe
    let profile = null
    let provider = 'Yahoo Finance'

    if (isEodhdConfigured()) {
      try {
        history = await fetchEodhdHistory(ticker)
        provider = 'EODHD'

        const fundamentalsData = await fetchEodhdFundamentals(ticker).catch(
          () => null,
        )

        if (fundamentalsData) {
          profile = extractEodhdProfile(fundamentalsData, ticker)

          try {
            pe = extractEodhdPeRatio(fundamentalsData, ticker)
          } catch {
            pe = null
          }
        }

        if (!Number.isFinite(pe)) {
          const summaryData = await fetchSummaryData(ticker)
          pe = extractPeRatio(summaryData, ticker)
          profile = profile || mergeTickerProfile(ticker)
          provider = 'EODHD + Yahoo P/E'
        }
      } catch {
        // Manteniamo Yahoo come fallback operativo, senza generare dati finti.
      }
    }

    if (!history) {
      const [yahooHistory, summaryData] = await Promise.all([
        fetchChartHistory(ticker),
        fetchSummaryData(ticker),
      ])
      history = yahooHistory
      pe = extractPeRatio(summaryData, ticker)
      profile = mergeTickerProfile(ticker)
    }

    const latestBar = history.at(-1)
    const { rsi, atr } = calculateIndicators(history, ticker)
    const row = {
      ticker,
      provider,
      profile,
      currentPrice: latestBar.close,
      pe,
      rsi,
      atr,
      status: 'ok',
    }

    return {
      ...row,
      reason: getDiagnostic(row),
    }
  } catch (error) {
    return {
      ticker,
      profile: null,
      currentPrice: null,
      pe: null,
      rsi: null,
      atr: null,
      status: 'error',
      reason: getDiagnostic({
        status: 'error',
        reason: error.message || `${ticker}: dati non disponibili`,
      }),
    }
  }
}

function buildCryptoProfile(meta) {
  return {
    name: meta.name,
    isin: null,
    country: 'Mercato crypto globale',
    sector: meta.sector || 'Criptovalute',
    industry: 'Asset digitale',
    website: null,
    description: meta.description || null,
  }
}

function enrichCryptoProfile(profile, marketData) {
  if (!marketData) {
    return profile
  }

  return {
    ...profile,
    description:
      profile.description ||
      `Crypto in posizione ${marketData.market_cap_rank || 'N/D'} per capitalizzazione secondo CoinGecko.`,
  }
}

function getCryptoDiagnostic(row) {
  if (row.status === 'error') {
    return row.reason || 'Dati non disponibili'
  }

  if (row.mappingIssue) {
    return row.mappingIssue
  }

  if (row.tradeEnabled === false) {
    return 'Osservata come liquidità stabile: esclusa dagli ingressi automatici'
  }

  if (Number(row.volumeEur) < CRYPTO_MIN_DAILY_VOLUME_EUR) {
    return 'Scartata: liquidità giornaliera troppo bassa'
  }

  if (Number(row.marketCapEur || 0) < CRYPTO_MIN_MARKET_CAP_EUR) {
    return 'Scartata: capitalizzazione troppo bassa per il pilota prudente'
  }

  if (row.rsi >= CRYPTO_LONG_RSI_LIMIT && row.rsi <= CRYPTO_SHORT_RSI_LIMIT) {
    return 'Scartata: RSI in zona neutrale'
  }

  if (row.rsi < CRYPTO_LONG_RSI_LIMIT) {
    return `Ammessa: crypto liquida, market cap verificato e RSI sotto ${CRYPTO_LONG_RSI_LIMIT}`
  }

  return `Ammessa: crypto liquida, market cap verificato e RSI sopra ${CRYPTO_SHORT_RSI_LIMIT}`
}

async function fetchCryptoTickerDiagnostic(meta, coingeckoMarkets = new Map()) {
  const marketData = meta.coingeckoId ? coingeckoMarkets.get(meta.coingeckoId) : null
  const mappingWarning = getCryptoMappingWarning(meta)

  try {
    const payload = await fetchKrakenOhlc(meta.krakenPair)
    const history = extractKrakenHistory(payload, meta.ticker)
    const latestBar = history.at(-1)
    const { rsi, atr } = calculateIndicators(history, meta.ticker)
    const row = {
      ticker: meta.ticker,
      market: 'crypto',
      provider: marketData ? 'Kraken + CoinGecko' : 'Kraken',
      profile: enrichCryptoProfile(buildCryptoProfile(meta), marketData),
      krakenPair: meta.krakenPair,
      coingeckoId: meta.coingeckoId,
      tradeEnabled: meta.tradeEnabled !== false,
      role: meta.role || 'operativo',
      mappingWarning,
      mappingIssue: marketData
        ? null
        : `${meta.ticker}: CoinGecko non ha confermato l’id ${meta.coingeckoId}`,
      currentPrice: latestBar.close,
      pe: null,
      volume: latestBar.volume,
      volumeEur: Number(marketData?.total_volume) || latestBar.volume * latestBar.close,
      marketCapEur: Number(marketData?.market_cap) || null,
      marketCapRank: Number(marketData?.market_cap_rank) || null,
      priceChange24hPct: Number(marketData?.price_change_percentage_24h) || null,
      priceChange7dPct: Number(marketData?.price_change_percentage_7d_in_currency) || null,
      rsi,
      atr,
      status: 'ok',
    }

    return {
      ...row,
      reason: getCryptoDiagnostic(row),
    }
  } catch (error) {
    return {
      ticker: meta.ticker,
      market: 'crypto',
      provider: 'Kraken',
      profile: buildCryptoProfile(meta),
      krakenPair: meta.krakenPair,
      coingeckoId: meta.coingeckoId,
      tradeEnabled: meta.tradeEnabled !== false,
      role: meta.role || 'operativo',
      mappingWarning,
      mappingIssue: meta.coingeckoId && !marketData
        ? `${meta.ticker}: CoinGecko non ha confermato l’id ${meta.coingeckoId}`
        : null,
      currentPrice: null,
      pe: null,
      volume: null,
      volumeEur: null,
      marketCapEur: null,
      marketCapRank: null,
      priceChange24hPct: null,
      priceChange7dPct: null,
      rsi: null,
      atr: null,
      status: 'error',
      reason: getCryptoDiagnostic({
        status: 'error',
        reason: error.message || `${meta.ticker}: dati non disponibili`,
      }),
    }
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = []

  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit)
    const batchResults = await Promise.all(batch.map(mapper))
    results.push(...batchResults)
  }

  return results
}

async function fetchBackendMarketData(marketId = DEFAULT_MARKET_ID) {
  if (marketId === 'crypto') {
    const coingeckoMarkets = await fetchCoinGeckoMarkets(CRYPTO_TICKERS)

    return mapWithConcurrency(
      CRYPTO_TICKERS,
      REQUEST_CONCURRENCY,
      (meta) => fetchCryptoTickerDiagnostic(meta, coingeckoMarkets),
    )
  }

  return mapWithConcurrency(EUROPEAN_TICKERS, REQUEST_CONCURRENCY, fetchTickerDiagnostic)
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

function buildTrade(row, invested, strategy = getTradingStrategy(), order = null) {
  const atrPct = (row.atr / row.currentPrice) * 100
  const isCrypto = strategy.id === 'crypto'
  const targetPct = isCrypto ? (atrPct < 4 ? 0.45 : 0.65) : atrPct < 1.5 ? 0.35 : 0.6
  const maxTargetPct = isCrypto ? targetPct : atrPct < 1.5 ? 0.8 : 1.2
  const trailingPct = isCrypto ? null : atrPct < 1.5 ? 0.2 : 0.3
  const stopMultiplier = isCrypto ? 1.8 : atrPct < 1.5 ? 1.2 : 1.5
  const type = strategy.id === 'crypto'
    ? getCryptoSignalType(row)
    : row.rsi < 30
      ? 'LONG'
      : 'SHORT'
  const long = type === 'LONG'
  const openedAt = new Date().toISOString()

  return {
    id: `${row.ticker}-${type}-${Date.now()}-${crypto.randomUUID()}`,
    marketId: strategy.id,
    marketLabel: strategy.label,
    ticker: row.ticker,
    profile: row.profile || null,
    type,
    openOrderId: order?.id || null,
    openedAt,
    entryPrice: roundPrice(row.currentPrice),
    atrAtEntry: roundPrice(row.atr),
    takeProfit: roundPrice(
      long
        ? row.currentPrice * (1 + targetPct / 100)
        : row.currentPrice * (1 - targetPct / 100),
    ),
    finalTakeProfit: roundPrice(
      long
        ? row.currentPrice * (1 + maxTargetPct / 100)
        : row.currentPrice * (1 - maxTargetPct / 100),
    ),
    stopLoss: roundPrice(
      long
        ? row.currentPrice - row.atr * stopMultiplier
        : row.currentPrice + row.atr * stopMultiplier,
    ),
    initialStopLoss: roundPrice(
      long
        ? row.currentPrice - row.atr * stopMultiplier
        : row.currentPrice + row.atr * stopMultiplier,
    ),
    profitLockArmed: false,
    favorablePrice: roundPrice(row.currentPrice),
    daysHeld: 0,
    invested: roundPrice(invested),
    quantity: order?.quantity || roundQuantity(invested / row.currentPrice),
    targetPct,
    maxTargetPct,
    trailingPct,
  }
}

function evaluateProfitExit(position, latestPrice) {
  const long = position.type === 'LONG'
  const trailingPct = Number(position.trailingPct)
  const hasDynamicProfit = Number.isFinite(trailingPct) && trailingPct > 0
  const takeProfit = Number(position.takeProfit)
  const finalTakeProfit = Number(position.finalTakeProfit || position.takeProfit)

  if (!hasDynamicProfit) {
    return {
      exitReason: 'TAKE_PROFIT',
      isWin: long ? latestPrice >= takeProfit : latestPrice <= takeProfit,
      monitoredFields: {},
    }
  }

  const previousFavorablePrice = Number.isFinite(Number(position.favorablePrice))
    ? Number(position.favorablePrice)
    : Number(position.entryPrice)
  const favorablePrice = long
    ? Math.max(previousFavorablePrice, latestPrice)
    : Math.min(previousFavorablePrice, latestPrice)
  const profitLockReached = long
    ? latestPrice >= takeProfit
    : latestPrice <= takeProfit
  const profitLockArmed = Boolean(position.profitLockArmed) || profitLockReached
  const trailingStopPrice = profitLockArmed
    ? long
      ? favorablePrice * (1 - trailingPct / 100)
      : favorablePrice * (1 + trailingPct / 100)
    : null
  const maxTargetReached = long
    ? latestPrice >= finalTakeProfit
    : latestPrice <= finalTakeProfit
  const trailingTriggered =
    profitLockArmed &&
    Number.isFinite(Number(trailingStopPrice)) &&
    (long ? latestPrice <= trailingStopPrice : latestPrice >= trailingStopPrice)

  return {
    exitReason: maxTargetReached ? 'TAKE_PROFIT_MAX' : 'TRAILING_PROFIT',
    isWin: maxTargetReached || trailingTriggered,
    monitoredFields: {
      profitLockArmed,
      favorablePrice: roundPrice(favorablePrice),
      trailingStopPrice: Number.isFinite(Number(trailingStopPrice))
        ? roundPrice(trailingStopPrice)
        : null,
    },
  }
}

function getProtectedStopLoss(position, profitExit) {
  const trailingPct = Number(position.trailingPct)
  const hasDynamicStop = Number.isFinite(trailingPct) && trailingPct > 0
  const currentStopLoss = Number(position.stopLoss)

  if (!hasDynamicStop || !Number.isFinite(currentStopLoss)) {
    return currentStopLoss
  }

  const profitLockArmed =
    Boolean(position.profitLockArmed) ||
    Boolean(profitExit?.monitoredFields?.profitLockArmed)

  if (!profitLockArmed) {
    return currentStopLoss
  }

  const entryPrice = Number(position.entryPrice)

  if (!Number.isFinite(entryPrice)) {
    return currentStopLoss
  }

  return position.type === 'LONG'
    ? Math.max(currentStopLoss, entryPrice)
    : Math.min(currentStopLoss, entryPrice)
}

function getCloseReasonText(exitReason) {
  if (exitReason === 'STOP_LOSS') {
    return 'Chiusura automatica backend: stop loss raggiunto.'
  }

  if (exitReason === 'BREAK_EVEN_STOP') {
    return 'Chiusura automatica backend: stop a pareggio raggiunto.'
  }

  if (exitReason === 'SESSION_PROTECTION') {
    return `Chiusura automatica backend: protezione azionaria ${getEquitiesCloseGuardLabel()} attivata.`
  }

  if (exitReason === 'TRAILING_PROFIT') {
    return 'Chiusura automatica backend: trailing profit attivato.'
  }

  return 'Chiusura automatica backend: target profit raggiunto.'
}

async function refillOpenSlots(state, excludedTickers = []) {
  const strategy = getTradingStrategy(state.activeMarket)
  const usMarketContext =
    strategy.id === 'equities'
      ? await fetchBackendUsMarketContext()
      : state.usMarketContext || null
  const marketData = await fetchBackendMarketData(strategy.id)
  const actionableRows = marketData.filter(
    strategy.id === 'crypto' ? isCryptoActionableResult : isActionableResult,
  )
  const isAutoEligible =
    strategy.id === 'crypto' ? isCryptoAutoEligibleResult : isAutoEligibleResult
  const sortRows =
    strategy.id === 'crypto' ? sortByCryptoAutoScore : sortByAutoScore
  const excluded = new Set([
    ...excludedTickers,
    ...state.positions.map((position) => position.ticker),
  ])
  const automaticRows = sortRows(
    (strategy.id === 'equities'
      ? filterEquityRowsByUsMarketContext(
          marketData.filter((row) => isAutoEligible(row)),
          usMarketContext,
        )
      : marketData.filter((row) => isAutoEligible(row))
    ).filter((row) => !excluded.has(row.ticker)),
  )
  const positions = [...state.positions]
  let orders = state.orders || []
  const openedTrades = []
  const rejectedOrders = []
  let capital = state.capital
  const maxPositions = getStrategyMaxPositions(strategy)
  const sizing = strategy.positionSizing

  automaticRows.forEach((row) => {
    if (positions.length >= maxPositions || !canOpenPosition(capital, sizing)) {
      return
    }

    const positionSize = calculatePositionSize(capital, sizing)
    const type = getSignalType(row, strategy)
    const blockReason = getOpeningOrderBlockReason(
      { ...state, capital, positions, orders, pendingTicker: row.ticker },
      positionSize,
      strategy,
    )

    if (blockReason) {
      const rejectedOrder = createSimulationOrder({
        action: 'OPEN',
        direction: type,
        marketId: strategy.id,
        marketLabel: strategy.label,
        notional: positionSize,
        requestedPrice: row.currentPrice,
        reason: blockReason,
        side: getOpenOrderSide(type),
        source: 'backend-monitor',
        status: 'RIFIUTATO',
        ticker: row.ticker,
      })
      orders = appendOrders({ orders }, rejectedOrder)
      rejectedOrders.push(rejectedOrder)
      return
    }

    let order = createSimulationOrder({
      action: 'OPEN',
      direction: type,
      executedPrice: row.currentPrice,
      marketId: strategy.id,
      marketLabel: strategy.label,
      notional: positionSize,
      requestedPrice: row.currentPrice,
      reason: 'Apertura automatica backend da segnale validato.',
      side: getOpenOrderSide(type),
      source: 'backend-monitor',
      ticker: row.ticker,
    })
    const trade = buildTrade(row, positionSize, strategy, order)
    order = { ...order, positionId: trade.id }
    orders = appendOrders({ orders }, order)
    positions.push(trade)
    capital = roundPrice(capital - positionSize)
    openedTrades.push(trade)
  })

  return {
    capital: roundPrice(capital),
    positions,
    orders,
    openedTrades,
    rejectedOrders,
    usMarketContext,
    marketData,
    scannedCount: marketData.length,
    signalCount: actionableRows.length,
  }
}

function evaluatePosition(position, latestPrice, { forceCloseReason = null } = {}) {
  const invested = position.invested || LEGACY_POSITION_SIZE
  const quantity = invested / position.entryPrice
  const long = position.type === 'LONG'
  const pnlEur = long
    ? (latestPrice - position.entryPrice) * quantity
    : (position.entryPrice - latestPrice) * quantity
  const roundedPnl = roundPrice(pnlEur)
  const profitExit = evaluateProfitExit(position, latestPrice)
  const effectiveStopLoss = getProtectedStopLoss(position, profitExit)
  const lockProtected =
    Number.isFinite(Number(effectiveStopLoss)) &&
    roundPrice(effectiveStopLoss) === roundPrice(position.entryPrice) &&
    Boolean(position.profitLockArmed || profitExit.monitoredFields?.profitLockArmed)
  const recoveredCapital = Math.max(invested + roundedPnl, 0)
  const isProfitableExit = profitExit.isWin && roundedPnl > 0
  const isLoss = long
    ? latestPrice <= effectiveStopLoss
    : latestPrice >= effectiveStopLoss
  const isForcedClose = Boolean(forceCloseReason)
  const exitReason = isForcedClose
    ? forceCloseReason
    : isProfitableExit
      ? profitExit.exitReason
      : lockProtected && roundedPnl >= 0
        ? 'BREAK_EVEN_STOP'
        : 'STOP_LOSS'
  const result = isProfitableExit || roundedPnl >= 0 ? 'WIN' : 'LOSS'
  const closeOrder =
    isForcedClose || isProfitableExit || profitExit.isWin || isLoss
      ? createSimulationOrder({
          action: 'CLOSE',
          direction: position.type,
          executedPrice: latestPrice,
          marketId: position.marketId,
          marketLabel: position.marketLabel,
          notional: recoveredCapital,
          positionId: position.id,
          quantity: position.quantity || quantity,
          requestedPrice: latestPrice,
          reason: getCloseReasonText(exitReason),
          side: getCloseOrderSide(position.type),
          source: 'backend-monitor',
          ticker: position.ticker,
        })
      : null

  return {
    monitoredPosition: {
      ...position,
      ...profitExit.monitoredFields,
      stopLoss: Number.isFinite(Number(effectiveStopLoss))
        ? roundPrice(effectiveStopLoss)
        : position.stopLoss,
      latestPrice: roundPrice(latestPrice),
      latestPriceAt: new Date().toISOString(),
      unrealizedPnl: roundPrice(pnlEur),
    },
    closeOrder,
    closedTrade:
      profitExit.isWin || isLoss
        ? {
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
            exitReason,
            recoveredCapital: roundPrice(recoveredCapital),
          }
        : null,
  }
}

export async function runBackendMonitor(state) {
  const current = normalizeTradingState(state)
  const strategy = getTradingStrategy(current.activeMarket)
  const sizing = strategy.positionSizing
  const maxPositions = getStrategyMaxPositions(strategy)
  const closeGuardActive = isEquitiesCloseGuardActive(strategy)
  const now = new Date()
  const scanBlocked = isEquitiesScanBlocked(strategy, now)
  const nextScanTime = current.nextScanAt ? new Date(current.nextScanAt).getTime() : 0
  const scanDue = !nextScanTime || nextScanTime <= now.getTime()

  if (!current.backendMonitorEnabled || !current.automationEnabled) {
    const activity = createActivity({
      type: 'backend-monitor',
      status: 'waiting',
      title: 'Monitor backend in pausa',
      detail: 'Il pilota automatico o il monitor backend non sono attivi.',
    })

    return {
      state: syncActiveMarketState({
        ...current,
        isChecking: false,
        isScanning: false,
        lastBackendCheckAt: new Date().toISOString(),
        lastAutomationMessage:
          'Monitor backend in pausa: pilota automatico o backend non attivi.',
        ...appendLogs(current, activity),
      }),
      closedTrades: [],
      checkedCount: 0,
    }
  }

  if (current.positions.length === 0) {
    if (scanBlocked) {
      const activity = createActivity({
        type: 'backend-monitor',
        status: 'waiting',
        title: closeGuardActive
          ? `Protezione azioni ${getEquitiesCloseGuardLabel()} attiva`
          : `Azioni in attesa delle ${getEquitiesScanStartLabel()}`,
        detail: closeGuardActive
          ? 'Nessuna posizione azionaria aperta. Nuove aperture bloccate fino alla prossima seduta.'
          : `Nessuna posizione azionaria aperta. La prima scansione partirà alle ${getEquitiesScanStartLabel()}, dopo la lettura della chiusura USA.`,
      })

      return {
        state: syncActiveMarketState({
          ...current,
          isChecking: false,
          isScanning: false,
          engineStatus: closeGuardActive
            ? `Protezione azioni ${getEquitiesCloseGuardLabel()} attiva`
            : `In attesa delle ${getEquitiesScanStartLabel()}`,
          nextScanAt: getNextScanAt(current.activeMarket, now),
          lastBackendCheckAt: new Date().toISOString(),
          lastAutomationMessage: closeGuardActive
            ? `Mondo azionario fermo: nessuna scansione o apertura prima delle ${getEquitiesScanStartLabel()}.`
            : `Mondo azionario in attesa: prima scansione automatica alle ${getEquitiesScanStartLabel()}, con contesto USA.`,
          ...appendLogs(current, activity),
        }),
        closedTrades: [],
        openedTrades: [],
        checkedCount: 0,
        errors: [],
      }
    }

    if (!scanDue) {
      const activity = createActivity({
        type: 'backend-monitor',
        status: 'waiting',
        title: 'Backend in attesa dati',
        detail: `Nessuna posizione aperta. Prossima scansione automatica gia programmata.`,
      })

      return {
        state: syncActiveMarketState({
          ...current,
          isChecking: false,
          isScanning: false,
          lastBackendCheckAt: new Date().toISOString(),
          lastAutomationMessage:
            'Sono in attesa della prossima finestra di scansione automatica.',
          ...appendLogs(current, activity),
        }),
        closedTrades: [],
        openedTrades: [],
        checkedCount: 0,
        errors: [],
      }
    }

    const refillErrors = []
    let refill = null

    if (canOpenPosition(current.capital, sizing)) {
      try {
        refill = await refillOpenSlots(current)
      } catch (error) {
        refillErrors.push(error.message || 'Ricerca nuovi titoli non riuscita')
      }
    }

    const openedTrades = refill?.openedTrades || []
    const activity = createActivity({
      type: 'backend-monitor',
      status:
        refillErrors.length > 0
          ? 'error'
          : openedTrades.length > 0
            ? 'attention'
            : 'waiting',
      title:
        openedTrades.length > 0
          ? 'Nuovi slot aperti dal backend'
          : 'Ricerca automatica completata',
      detail:
        refillErrors.length > 0
          ? `Nessuna posizione aperta. Ricerca nuovi titoli non riuscita: ${refillErrors[0]}.`
          : openedTrades.length > 0
            ? `Nessuna posizione era aperta: ho trovato ${openedTrades.length} segnali e ho riaperto nuovi slot.${
                refill?.usMarketContext
                  ? ` ${getUsMarketContextSummary(refill.usMarketContext)}`
                  : ''
              }`
            : `Nessuna posizione aperta. ${
                refill
                  ? `${refill.scannedCount} titoli scansionati, ${refill.signalCount} segnali trovati, nessuno abbastanza forte per il pilota.${
                      refill.usMarketContext
                        ? ` ${getUsMarketContextSummary(refill.usMarketContext)}`
                        : ''
                    }`
                  : `Capitale operativo sotto il minimo di ${
                      sizing.min || MIN_POSITION_SIZE
                    }€ per aprire nuovi slot.`
              }`,
    })

    return {
      state: syncActiveMarketState({
        ...current,
        capital: refill ? refill.capital : current.capital,
        positions: refill ? refill.positions : current.positions,
        orders: refill ? refill.orders : current.orders,
        isChecking: false,
        isScanning: false,
        lastSyncAt: new Date().toISOString(),
        nextScanAt: getNextScanAt(current.activeMarket, now),
        lastDataProvider:
          current.activeMarket === 'crypto'
            ? 'Kraken + CoinGecko'
            : 'EODHD / Yahoo Finance',
        lastAutomationMessage:
          openedTrades.length > 0
            ? `Ho aperto ${openedTrades.length} nuovi slot dal backend.${
                refill?.usMarketContext
                  ? ` ${getUsMarketContextSummary(refill.usMarketContext)}`
                  : ''
              }`
            : refillErrors.length > 0
              ? `Ricerca automatica non riuscita: ${refillErrors[0]}.`
              : `Scansione backend completata: nessun segnale apribile ora.${
                  refill?.usMarketContext
                    ? ` ${getUsMarketContextSummary(refill.usMarketContext)}`
                    : ''
                }`,
        ...(refill
          ? {
              lastScanAt: new Date().toISOString(),
              lastScanCount: refill.scannedCount,
              lastSignalCount: refill.signalCount,
              lastScanResults: refill.marketData,
              usMarketContext: refill.usMarketContext || current.usMarketContext,
            }
          : {}),
        engineStatus:
          openedTrades.length > 0
            ? 'Slot riempiti dal backend'
            : 'Nessun segnale automatico disponibile',
        lastBackendCheckAt: new Date().toISOString(),
        ...appendLogs(current, activity),
      }),
      closedTrades: [],
      openedTrades,
      checkedCount: 0,
      errors: refillErrors,
    }
  }

  let capital = current.capital
  let vault = current.vault
  const activePositions = []
  const closedTrades = []
  let orders = current.orders || []
  const errors = []

  for (const position of current.positions) {
    try {
      const latestPrice = await fetchLatestMarketPrice(
        position.ticker,
        position.marketId || current.activeMarket,
      )
      const { monitoredPosition, closedTrade, closeOrder } = evaluatePosition(
        position,
        latestPrice,
        {
          forceCloseReason: closeGuardActive ? 'SESSION_PROTECTION' : null,
        },
      )

      if (!closedTrade) {
        activePositions.push(monitoredPosition)
        continue
      }

      orders = appendOrders({ orders }, closeOrder)
      capital += closedTrade.recoveredCapital || 0
      vault += Math.max(closedTrade.pnlEur, 0)

      closedTrades.push(closedTrade)
    } catch (error) {
      errors.push(`${position.ticker}: ${error.message}`)
      activePositions.push(position)
    }
  }

  const refillErrors = []
  let openedTrades = []
  let scanPatch = {}

  if (
    (closedTrades.length > 0 || scanDue) &&
    !scanBlocked &&
    activePositions.length < maxPositions &&
    canOpenPosition(capital, sizing)
  ) {
    try {
      const refill = await refillOpenSlots(
        {
          ...current,
          capital,
          positions: activePositions,
        },
        closedTrades.map((trade) => trade.ticker),
      )

      capital = refill.capital
      activePositions.splice(0, activePositions.length, ...refill.positions)
      orders = refill.orders
      openedTrades = refill.openedTrades
      scanPatch = {
        lastScanAt: new Date().toISOString(),
        lastScanCount: refill.scannedCount,
        lastSignalCount: refill.signalCount,
        lastScanResults: refill.marketData,
        usMarketContext: refill.usMarketContext || current.usMarketContext,
        lastSyncAt: new Date().toISOString(),
        nextScanAt: getNextScanAt(current.activeMarket, now),
        lastDataProvider:
          current.activeMarket === 'crypto'
            ? 'Kraken + CoinGecko'
            : 'EODHD / Yahoo Finance',
      }
    } catch (error) {
      refillErrors.push(error.message || 'Ricerca nuovi titoli non riuscita')
    }
  }

  const status =
    errors.length > 0 || refillErrors.length > 0
      ? 'error'
      : closedTrades.length > 0 || openedTrades.length > 0
        ? 'attention'
        : 'done'
  const activity = createActivity({
    type: 'backend-monitor',
    status,
    title:
      openedTrades.length > 0
        ? 'Rotazione automatica completata'
        : closedTrades.length > 0
        ? closeGuardActive
          ? `Protezione azioni ${getEquitiesCloseGuardLabel()} eseguita`
          : 'Uscita automatica backend'
        : 'Controllo backend completato',
    detail:
      errors.length > 0 || refillErrors.length > 0
        ? `${current.positions.length} posizioni controllate con ${
            errors.length + refillErrors.length
          } errori dati.`
        : openedTrades.length > 0
          ? `${closedTrades.length} posizioni chiuse e ${openedTrades.length} nuovi slot aperti automaticamente.${
              scanPatch.usMarketContext
                ? ` ${getUsMarketContextSummary(scanPatch.usMarketContext)}`
                : ''
            }`
          : closedTrades.length > 0
            ? closeGuardActive
              ? `${closedTrades.length} posizioni azionarie chiuse dalla protezione ${getEquitiesCloseGuardLabel()}. Nessuna nuova apertura azionaria consentita.`
              : `${closedTrades.length} posizioni chiuse automaticamente. Nessun nuovo titolo abbastanza forte.${
                  scanPatch.usMarketContext
                    ? ` ${getUsMarketContextSummary(scanPatch.usMarketContext)}`
                    : ''
                }`
          : `${current.positions.length} posizioni controllate. Nessun target o stop raggiunto.`,
  })
  const nextMarketState = {
    ...current,
    capital: roundPrice(capital),
    vault: roundPrice(vault),
    positions: activePositions,
    orders,
    history: [...closedTrades, ...current.history],
    isChecking: false,
    isScanning: false,
    lastSyncAt: new Date().toISOString(),
    nextScanAt:
      scanPatch.nextScanAt ||
      (scanDue || closeGuardActive
        ? getNextScanAt(current.activeMarket, now)
        : current.nextScanAt || getNextScanAt(current.activeMarket, now)),
    lastAutomationMessage:
      openedTrades.length > 0
        ? `${closedTrades.length} chiusure e ${openedTrades.length} nuove aperture automatiche.${
            scanPatch.usMarketContext
              ? ` ${getUsMarketContextSummary(scanPatch.usMarketContext)}`
              : ''
          }`
        : closedTrades.length > 0
          ? `${closedTrades.length} posizioni chiuse automaticamente.`
          : scanDue
            ? `Controllo backend completato: nessun nuovo slot apribile ora.${
                scanPatch.usMarketContext
                  ? ` ${getUsMarketContextSummary(scanPatch.usMarketContext)}`
                  : ''
              }`
            : 'Controllo backend completato: posizioni monitorate, prossima scansione gia programmata.',
    ...scanPatch,
    lastBackendCheckAt: new Date().toISOString(),
    lastLiveCheckAt: new Date().toISOString(),
    engineStatus:
      openedTrades.length > 0
        ? 'Slot riempiti dal backend'
        : activePositions.length > 0
          ? 'Monitor backend attivo'
          : closeGuardActive
            ? `Protezione azioni ${getEquitiesCloseGuardLabel()} completata`
            : 'In attesa di nuova scansione',
    ...appendLogs(current, activity),
  }
  delete nextMarketState.markets

  return {
    state: syncActiveMarketState({
      ...current,
      activeMarket: current.activeMarket,
      markets: {
        ...(current.markets || {}),
        [current.activeMarket]: nextMarketState,
      },
      ...nextMarketState,
    }),
    closedTrades,
    openedTrades,
    checkedCount: current.positions.length,
    errors: [...errors, ...refillErrors],
  }
}

export async function readTradingState(supabase) {
  const { data, error } = await supabase
    .from('spapple_state')
    .select('payload, updated_at')
    .eq('id', STATE_ID)
    .maybeSingle()

  if (error) {
    throw error
  }

  return {
    payload: normalizeTradingState(data?.payload),
    updatedAt: data?.updated_at || null,
  }
}

async function writeStateEvent(supabase, payload) {
  const { error } = await supabase.from('spapple_state_events').insert({
    state_id: STATE_ID,
    revision: payload.stateRevision,
    source: payload.lastStateMutationSource || 'server',
    summary: payload.lastStateMutationSummary || 'Stato Spapple aggiornato',
  })

  if (!error) {
    return
  }

  const optionalRealtimeMissing =
    error.code === '42P01' ||
    error.code === '42501' ||
    error.code === 'PGRST205' ||
    String(error.message || '').includes('spapple_state_events')

  if (optionalRealtimeMissing) {
    return
  }

  throw error
}

export async function writeTradingState(
  supabase,
  payload,
  { source = 'server', summary = 'Stato Spapple aggiornato' } = {},
) {
  const { payload: currentPayload } = await readTradingState(supabase)
  const updatedAt = new Date().toISOString()
  const nextPayload = normalizeTradingState({
    ...payload,
    stateRevision: Number(currentPayload.stateRevision || 0) + 1,
    lastStateMutationAt: updatedAt,
    lastStateMutationSource: source,
    lastStateMutationSummary: summary,
  })
  const { error } = await supabase.from('spapple_state').upsert({
    id: STATE_ID,
    payload: nextPayload,
    updated_at: updatedAt,
  })

  if (error) {
    throw error
  }

  await writeStateEvent(supabase, nextPayload)

  return {
    payload: nextPayload,
    updatedAt,
    stateRevision: nextPayload.stateRevision,
  }
}
