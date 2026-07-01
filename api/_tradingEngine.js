import { createClient } from '@supabase/supabase-js'
import { ATR, RSI } from 'technicalindicators'
import {
  CRYPTO_TICKERS,
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
  LEGACY_POSITION_SIZE,
  MIN_POSITION_SIZE,
  calculatePositionSize,
  canOpenPosition,
} from '../src/services/positionSizing.js'
import {
  DEFAULT_MARKET_ID,
  TRADING_STRATEGIES,
  getTradingStrategy,
} from '../src/strategies/index.js'
import { clearYahooAuth, fetchYahooJson, getYahooAuth } from './_yahoo.js'

export const STATE_ID = 'default'
export const STORAGE_VERSION = 5
export { DEFAULT_MARKET_ID }

const MAX_POSITIONS = 5
const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 8
const EXECUTION_MODE = 'simulation'
const DEFAULT_RISK_LIMITS = {
  maxDailyOrders: 20,
  maxDailyCapitalPct: 1,
  maxConsecutiveLosses: 3,
}
const DEFAULT_REENTRY_COOLDOWN_MS = 6 * 60 * 60 * 1000

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
  'lastLiveCheckAt',
  'lastBackendCheckAt',
  'nextLiveCheckAt',
  'engineStatus',
  'liveMonitorEnabled',
  'backendMonitorEnabled',
]

const initialState = {
  version: STORAGE_VERSION,
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
  lastLiveCheckAt: null,
  lastBackendCheckAt: null,
  nextLiveCheckAt: null,
  engineStatus: 'In attesa',
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
    riskLimits: DEFAULT_RISK_LIMITS,
    automationEnabled: true,
    liveMonitorEnabled: true,
    backendMonitorEnabled: true,
    lastScanAt: null,
    lastScanCount: 0,
    lastSignalCount: 0,
    lastScanResults: [],
    lastLiveCheckAt: null,
    lastBackendCheckAt: null,
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
      : [],
    events: Array.isArray(rawMarketState.events) ? rawMarketState.events : [],
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
    liveMonitorEnabled:
      typeof rawMarketState.liveMonitorEnabled === 'boolean'
        ? rawMarketState.liveMonitorEnabled
        : fallback.liveMonitorEnabled,
    backendMonitorEnabled:
      typeof rawMarketState.backendMonitorEnabled === 'boolean'
        ? rawMarketState.backendMonitorEnabled
        : fallback.backendMonitorEnabled,
    lastScanResults: sanitizeScanResults(rawMarketState.lastScanResults, marketId),
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
    activeMarket,
    markets,
    ...activeMarketState,
  })
}

function roundPrice(value) {
  return Number(value.toFixed(4))
}

function roundQuantity(value) {
  return Number(value.toFixed(8))
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

  if (todaysOrders.length >= riskLimits.maxDailyOrders) {
    return `Limite giornaliero raggiunto: massimo ${riskLimits.maxDailyOrders} ordini al giorno.`
  }

  const dailyCapitalLimit =
    Number(strategy.initialCapital || 0) * Number(riskLimits.maxDailyCapitalPct)
  const dailyAllocated = todaysOrders
    .filter((order) => order.action === 'OPEN' && order.status === 'ESEGUITO')
    .reduce((sum, order) => sum + Number(order.notional || 0), 0)

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

function getCryptoMeta(ticker) {
  return CRYPTO_TICKERS.find(
    (item) => item.ticker === ticker || item.krakenPair === ticker,
  )
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

  try {
    return await fetchSummaryPrice(ticker)
  } catch {
    return fetchChartPrice(ticker)
  }
}

async function fetchChartHistory(ticker) {
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
    const [history, summaryData] = await Promise.all([
      fetchChartHistory(ticker),
      fetchSummaryData(ticker),
    ])
    const latestBar = history.at(-1)
    const pe = extractPeRatio(summaryData, ticker)
    const { rsi, atr } = calculateIndicators(history, ticker)
    const row = {
      ticker,
      profile: null,
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
  const targetPct = isCrypto ? (atrPct < 4 ? 0.8 : 1.2) : atrPct < 1.5 ? 0.35 : 0.6
  const maxTargetPct = isCrypto ? targetPct : atrPct < 1.5 ? 0.8 : 1.2
  const trailingPct = isCrypto ? null : atrPct < 1.5 ? 0.2 : 0.3
  const stopMultiplier = isCrypto ? 1.8 : 1.5
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

async function refillOpenSlots(state, excludedTickers = []) {
  const strategy = getTradingStrategy(state.activeMarket)
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
    marketData.filter(
      (row) => isAutoEligible(row) && !excluded.has(row.ticker),
    ),
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
    marketData,
    scannedCount: marketData.length,
    signalCount: actionableRows.length,
  }
}

function evaluatePosition(position, latestPrice) {
  const invested = position.invested || LEGACY_POSITION_SIZE
  const quantity = invested / position.entryPrice
  const long = position.type === 'LONG'
  const pnlEur = long
    ? (latestPrice - position.entryPrice) * quantity
    : (position.entryPrice - latestPrice) * quantity
  const profitExit = evaluateProfitExit(position, latestPrice)
  const isLoss = long
    ? latestPrice <= position.stopLoss
    : latestPrice >= position.stopLoss
  const roundedPnl = roundPrice(pnlEur)
  const recoveredCapital = Math.max(invested + roundedPnl, 0)
  const exitReason = profitExit.isWin ? profitExit.exitReason : 'STOP_LOSS'
  const closeOrder =
    profitExit.isWin || isLoss
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
          reason:
            exitReason === 'STOP_LOSS'
              ? 'Chiusura automatica backend: stop loss raggiunto.'
              : exitReason === 'TRAILING_PROFIT'
                ? 'Chiusura automatica backend: trailing profit attivato.'
                : 'Chiusura automatica backend: target profit raggiunto.',
          side: getCloseOrderSide(position.type),
          source: 'backend-monitor',
          ticker: position.ticker,
        })
      : null

  return {
    monitoredPosition: {
      ...position,
      ...profitExit.monitoredFields,
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
            result: profitExit.isWin ? 'WIN' : 'LOSS',
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
        lastBackendCheckAt: new Date().toISOString(),
        ...appendLogs(current, activity),
      }),
      closedTrades: [],
      checkedCount: 0,
    }
  }

  if (current.positions.length === 0) {
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
            ? `Nessuna posizione era aperta: ho trovato ${openedTrades.length} segnali e ho riaperto nuovi slot.`
            : `Nessuna posizione aperta. ${
                refill
                  ? `${refill.scannedCount} titoli scansionati, ${refill.signalCount} segnali trovati, nessuno abbastanza forte per il pilota.`
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
        ...(refill
          ? {
              lastScanAt: new Date().toISOString(),
              lastScanCount: refill.scannedCount,
              lastSignalCount: refill.signalCount,
              lastScanResults: refill.marketData,
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
      )

      if (!closedTrade) {
        activePositions.push(monitoredPosition)
        continue
      }

      orders = appendOrders({ orders }, closeOrder)
      if (closedTrade.result === 'WIN') {
        capital += closedTrade.invested || LEGACY_POSITION_SIZE
        vault += Math.max(closedTrade.pnlEur, 0)
      } else {
        capital += closedTrade.recoveredCapital || 0
      }

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
    closedTrades.length > 0 &&
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
        ? 'Uscita automatica backend'
        : 'Controllo backend completato',
    detail:
      errors.length > 0 || refillErrors.length > 0
        ? `${current.positions.length} posizioni controllate con ${
            errors.length + refillErrors.length
          } errori dati.`
        : openedTrades.length > 0
          ? `${closedTrades.length} posizioni chiuse e ${openedTrades.length} nuovi slot aperti automaticamente.`
          : closedTrades.length > 0
            ? `${closedTrades.length} posizioni chiuse automaticamente. Nessun nuovo titolo abbastanza forte.`
          : `${current.positions.length} posizioni controllate. Nessun target o stop raggiunto.`,
  })

  return {
    state: syncActiveMarketState({
      ...current,
      capital: roundPrice(capital),
      vault: roundPrice(vault),
      positions: activePositions,
      orders,
      history: [...closedTrades, ...current.history],
      ...scanPatch,
      lastBackendCheckAt: new Date().toISOString(),
      lastLiveCheckAt: new Date().toISOString(),
      engineStatus:
        openedTrades.length > 0
          ? 'Slot riempiti dal backend'
          : activePositions.length > 0
          ? 'Monitor backend attivo'
          : 'In attesa di nuova scansione',
      ...appendLogs(current, activity),
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

export async function writeTradingState(supabase, payload) {
  const { error } = await supabase.from('spapple_state').upsert({
    id: STATE_ID,
    payload,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    throw error
  }
}
