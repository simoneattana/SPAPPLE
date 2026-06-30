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
export const STORAGE_VERSION = 4
export { DEFAULT_MARKET_ID }

const MAX_POSITIONS = 5
const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 8

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
  'activityLog',
  'events',
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
  activityLog: [],
  events: [],
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
  const closedKeys = new Set(
    history
      .filter((trade) => trade?.ticker && trade?.openedAt)
      .map((trade) => `${trade.ticker}-${trade.openedAt}`),
  )

  return positions.filter((position) => {
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

function normalizeMarketState(marketId, rawMarketState = {}) {
  const strategy = getTradingStrategy(marketId)
  const fallback = {
    marketId: strategy.id,
    marketLabel: strategy.label,
    capital: strategy.initialCapital,
    vault: 0,
    positions: [],
    history: [],
    activityLog: [],
    events: [],
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
  const positions = removeClosedPositions(
    Array.isArray(rawMarketState.positions)
      ? rawMarketState.positions
      : [],
    history,
  )

  return {
    ...fallback,
    ...rawMarketState,
    marketId,
    marketLabel: strategy.label,
    capital: normalizedCapital,
    vault: Number.isFinite(vault) ? vault : fallback.vault,
    positions,
    history,
    activityLog: Array.isArray(rawMarketState.activityLog)
      ? rawMarketState.activityLog
      : [],
    events: Array.isArray(rawMarketState.events) ? rawMarketState.events : [],
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

function buildTrade(row, invested, strategy = getTradingStrategy()) {
  const atrPct = (row.atr / row.currentPrice) * 100
  const isCrypto = strategy.id === 'crypto'
  const targetPct = isCrypto ? (atrPct < 4 ? 0.8 : 1.2) : atrPct < 1.5 ? 0.3 : 0.5
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
    openedAt,
    entryPrice: roundPrice(row.currentPrice),
    atrAtEntry: roundPrice(row.atr),
    takeProfit: roundPrice(
      long
        ? row.currentPrice * (1 + targetPct / 100)
        : row.currentPrice * (1 - targetPct / 100),
    ),
    stopLoss: roundPrice(
      long
        ? row.currentPrice - row.atr * stopMultiplier
        : row.currentPrice + row.atr * stopMultiplier,
    ),
    daysHeld: 0,
    invested: roundPrice(invested),
    targetPct,
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
  const openedTrades = []
  let capital = state.capital
  const maxPositions = getStrategyMaxPositions(strategy)
  const sizing = strategy.positionSizing

  automaticRows.forEach((row) => {
    if (positions.length >= maxPositions || !canOpenPosition(capital, sizing)) {
      return
    }

    const positionSize = calculatePositionSize(capital, sizing)
    const trade = buildTrade(row, positionSize, strategy)
    positions.push(trade)
    capital = roundPrice(capital - positionSize)
    openedTrades.push(trade)
  })

  return {
    capital: roundPrice(capital),
    positions,
    openedTrades,
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
  const isWin = long
    ? latestPrice >= position.takeProfit
    : latestPrice <= position.takeProfit
  const isLoss = long
    ? latestPrice <= position.stopLoss
    : latestPrice >= position.stopLoss
  const roundedPnl = roundPrice(pnlEur)
  const recoveredCapital = Math.max(invested + roundedPnl, 0)

  return {
    monitoredPosition: {
      ...position,
      latestPrice: roundPrice(latestPrice),
      unrealizedPnl: roundPrice(pnlEur),
    },
    closedTrade:
      isWin || isLoss
        ? {
            ticker: position.ticker,
            type: position.type,
            openedAt: position.openedAt || null,
            entryPrice: position.entryPrice,
            invested,
            pnlEur: roundedPnl,
            result: isWin ? 'WIN' : 'LOSS',
            exitDate: new Date().toISOString(),
            exitPrice: roundPrice(latestPrice),
            exitReason: isWin ? 'TAKE_PROFIT' : 'STOP_LOSS',
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
  const errors = []

  for (const position of current.positions) {
    try {
      const latestPrice = await fetchLatestMarketPrice(
        position.ticker,
        position.marketId || current.activeMarket,
      )
      const { monitoredPosition, closedTrade } = evaluatePosition(
        position,
        latestPrice,
      )

      if (!closedTrade) {
        activePositions.push(monitoredPosition)
        continue
      }

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
