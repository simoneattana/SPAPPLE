import { neon } from '@neondatabase/serverless'
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
  canOpenPosition,
} from '../src/services/positionSizing.js'
import {
  applyExecutionCosts,
  getPositionOpenCommissionEur,
} from '../src/services/executionCosts.js'
import {
  getEodhdSymbol,
  getYahooSymbol,
  shouldUseEodhdForTicker,
} from '../src/services/eodhdSymbols.js'
import { getTickerCurrency } from '../src/services/marketUniverse.js'
import {
  getMarketCloseGuardLabel,
  getMarketScanStartLabel,
  getMarketSessionStatus,
  getPreCloseProtectionDecision,
  isMarketCloseGuardActive,
  isMarketScanBlocked,
} from '../src/services/marketHours.js'
import { mergeTickerProfile } from '../src/services/tickerMetadata.js'
import {
  DEFAULT_MARKET_ID,
  TRADING_STRATEGIES,
  getTradingStrategy,
} from '../src/strategies/index.js'
import { MAX_POSITIONS } from '../src/services/engine/constants.js'
import { roundPrice, roundQuantity } from '../src/services/engine/format.js'
import { appendLogs, createActivity } from '../src/services/engine/activity.js'
import {
  appendOrders,
  createSimulationOrder,
  getCloseOrderSide,
  getOpenOrderSide,
} from '../src/services/engine/orders.js'
import {
  STORAGE_VERSION,
  createInitialMarkets,
  createInitialState,
  getNextScanAt,
  normalizeMarketState,
  syncActiveMarketState,
} from '../src/services/engine/state.js'
import {
  getOpeningOrderBlockReason,
  getRiskAdjustedPositionSize,
  getRiskGovernorState,
} from '../src/services/engine/risk.js'
import { fetchEodhdJson, isEodhdConfigured } from './_eodhd.js'
import { clearYahooAuth, fetchYahooJson, getYahooAuth } from './_yahoo.js'

export const STATE_ID = 'default'
export { STORAGE_VERSION } from '../src/services/engine/state.js'
export { DEFAULT_MARKET_ID }

const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 8
const STATE_EVENT_RETENTION_MS = 60 * 24 * 60 * 60 * 1000
const SUPABASE_QUERY_TIMEOUT_MS = 8_000
const backendFxRateCache = new Map()
function getStrategyMaxPositions(strategy) {
  return Number.isFinite(Number(strategy.maxPositions))
    ? Number(strategy.maxPositions)
    : MAX_POSITIONS
}

export function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

export function getNeonSql() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_URL

  if (!databaseUrl) {
    return null
  }

  return neon(databaseUrl)
}

export function getSupabaseClient() {
  return getNeonSql()
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
    ...createInitialState(),
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

function convertToEur(value, fxToEur = 1) {
  const amount = Number(value)
  const rate = Number(fxToEur)

  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) {
    return null
  }

  return amount * rate
}

function assertNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`${label} non disponibile`)
  }

  return number
}

async function fetchSummaryPrice(ticker) {
  const { cookie, crumb } = await getYahooAuth()
  const yahooSymbol = getYahooSymbol(ticker)
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      yahooSymbol,
    )}`,
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
  const yahooSymbol = getYahooSymbol(ticker)
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooSymbol,
    )}`,
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

  if (isEodhdConfigured() && shouldUseEodhdForTicker(ticker)) {
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
  if (isEodhdConfigured() && shouldUseEodhdForTicker(ticker)) {
    try {
      return await fetchEodhdHistory(ticker)
    } catch {
      // Se EODHD non copre il simbolo specifico, continuiamo con Yahoo.
    }
  }

  const yahooSymbol = getYahooSymbol(ticker)
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
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
  const yahooSymbol = getYahooSymbol(ticker)
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}`,
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

function extractFxRate(data, pair) {
  const rate =
    data?.close ??
    data?.adjusted_close ??
    data?.previousClose ??
    data?.last ??
    data?.price
  const number = Number(rate)

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${pair}: cambio EODHD non disponibile`)
  }

  return number
}

async function fetchBackendFxRateToEur(currency = 'EUR') {
  const from = String(currency || 'EUR').toUpperCase()

  if (backendFxRateCache.has(from)) {
    return backendFxRateCache.get(from)
  }

  if (from === 'EUR') {
    const fx = {
      pair: 'EUREUR.FOREX',
      rate: 1,
      provider: 'EODHD',
    }
    backendFxRateCache.set(from, fx)
    return fx
  }

  const directPair = `${from}EUR.FOREX`
  const inversePair = `EUR${from}.FOREX`

  try {
    const data = await fetchEodhdJson(`real-time/${directPair}`)

    const fx = {
      pair: directPair,
      rate: extractFxRate(data, directPair),
      provider: 'EODHD',
    }
    backendFxRateCache.set(from, fx)
    return fx
  } catch {
    const data = await fetchEodhdJson(`real-time/${inversePair}`)
    const inverseRate = extractFxRate(data, inversePair)

    const fx = {
      pair: inversePair,
      rate: 1 / inverseRate,
      provider: 'EODHD',
    }
    backendFxRateCache.set(from, fx)
    return fx
  }
}

async function withCurrencyData(row) {
  if (row.market === 'crypto') {
    return {
      ...row,
      currency: 'EUR',
      fxToEur: 1,
      fxPair: 'EUREUR.FOREX',
      fxProvider: 'EODHD',
      currentPriceEur: row.currentPrice,
      atrEur: row.atr,
    }
  }

  const currency = getTickerCurrency(row.ticker)
  const fx = await fetchBackendFxRateToEur(currency)

  return {
    ...row,
    currency,
    fxToEur: fx.rate,
    fxPair: fx.pair,
    fxProvider: fx.provider,
    currentPriceEur: convertToEur(row.currentPrice, fx.rate),
    atrEur: convertToEur(row.atr, fx.rate),
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
    const isUsTicker = String(ticker).endsWith('.US')
    let yahooSummaryData = null

    if (isEodhdConfigured() && shouldUseEodhdForTicker(ticker)) {
      try {
        const [eodhdHistory, fundamentalsData, summaryData] = await Promise.all([
          fetchEodhdHistory(ticker),
          isUsTicker
            ? Promise.resolve(null)
            : fetchEodhdFundamentals(ticker).catch(() => null),
          isUsTicker ? fetchSummaryData(ticker) : Promise.resolve(null),
        ])

        history = eodhdHistory
        yahooSummaryData = summaryData
        provider = 'EODHD'

        if (fundamentalsData) {
          profile = extractEodhdProfile(fundamentalsData, ticker)

          try {
            pe = extractEodhdPeRatio(fundamentalsData, ticker)
          } catch {
            pe = null
          }
        }

        if (!Number.isFinite(pe)) {
          const summaryData = yahooSummaryData || (await fetchSummaryData(ticker))
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
    const baseRow = {
      ticker,
      provider,
      profile,
      currentPrice: latestBar.close,
      pe,
      rsi,
      atr,
      status: 'ok',
    }
    const row = await withCurrencyData(baseRow)

    return {
      ...row,
      reason: getDiagnostic(row),
    }
  } catch (error) {
    return {
      ticker,
      profile: null,
      currentPrice: null,
      currentPriceEur: null,
      currency: getTickerCurrency(ticker),
      fxToEur: null,
      fxPair: null,
      fxProvider: null,
      pe: null,
      rsi: null,
      atr: null,
      atrEur: null,
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
  const strategy = getTradingStrategy(marketId)

  if (marketId === 'crypto') {
    const coingeckoMarkets = await fetchCoinGeckoMarkets(CRYPTO_TICKERS)

    return mapWithConcurrency(
      CRYPTO_TICKERS,
      REQUEST_CONCURRENCY,
      (meta) => fetchCryptoTickerDiagnostic(meta, coingeckoMarkets),
    )
  }

  return mapWithConcurrency(
    strategy.universe || [],
    REQUEST_CONCURRENCY,
    fetchTickerDiagnostic,
  )
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
  const currency = row.currency || getTickerCurrency(row.ticker)
  const entryFxToEur =
    Number.isFinite(Number(row.fxToEur)) && Number(row.fxToEur) > 0
      ? Number(row.fxToEur)
      : 1
  const openExecutionCosts = applyExecutionCosts({
    atr: row.atr,
    currency,
    fxToEur: entryFxToEur,
    marketId: strategy.id,
    notionalEur: invested,
    phase: 'OPEN',
    price: row.currentPrice,
    type,
  })
  const entryPrice = openExecutionCosts.effectivePrice
  const entryPriceEur =
    Number(openExecutionCosts.effectivePriceEur) ||
    convertToEur(entryPrice, entryFxToEur)
  const entrySignalPriceEur =
    Number(row.currentPriceEur) || convertToEur(row.currentPrice, entryFxToEur)
  const atrAtEntryEur = Number(row.atrEur) || convertToEur(row.atr, entryFxToEur)
  const quantity = roundQuantity(invested / entryPriceEur)

  return {
    id: `${row.ticker}-${type}-${Date.now()}-${crypto.randomUUID()}`,
    marketId: strategy.id,
    marketLabel: strategy.label,
    ticker: row.ticker,
    profile: row.profile || null,
    type,
    openOrderId: order?.id || null,
    openedAt,
    currency,
    entryFxToEur,
    entryPriceEur: roundPrice(entryPriceEur),
    entrySignalPrice: roundPrice(row.currentPrice),
    entrySignalPriceEur: roundPrice(entrySignalPriceEur),
    atrAtEntryEur: roundPrice(atrAtEntryEur),
    fxPair: row.fxPair || null,
    fxProvider: row.fxProvider || null,
    entryPrice: roundPrice(entryPrice),
    executionCosts: {
      open: openExecutionCosts,
    },
    atrAtEntry: roundPrice(row.atr),
    takeProfit: roundPrice(
      long
        ? entryPrice * (1 + targetPct / 100)
        : entryPrice * (1 - targetPct / 100),
    ),
    finalTakeProfit: roundPrice(
      long
        ? entryPrice * (1 + maxTargetPct / 100)
        : entryPrice * (1 - maxTargetPct / 100),
    ),
    stopLoss: roundPrice(
      long
        ? entryPrice - row.atr * stopMultiplier
        : entryPrice + row.atr * stopMultiplier,
    ),
    initialStopLoss: roundPrice(
      long
        ? entryPrice - row.atr * stopMultiplier
        : entryPrice + row.atr * stopMultiplier,
    ),
    profitLockArmed: false,
    favorablePrice: roundPrice(entryPrice),
    daysHeld: 0,
    invested: roundPrice(invested),
    quantity,
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

function getCloseReasonText(exitReason, strategy = null) {
  if (exitReason === 'STOP_LOSS') {
    return 'Chiusura automatica backend: stop loss raggiunto.'
  }

  if (exitReason === 'BREAK_EVEN_STOP') {
    return 'Chiusura automatica backend: stop a pareggio raggiunto.'
  }

  if (exitReason === 'PRE_CLOSE_PROFIT_LOCK') {
    return 'Chiusura automatica backend: protezione pre-chiusura, utile consolidato.'
  }

  if (exitReason === 'PRE_CLOSE_CAPITAL_PROTECTION') {
    return 'Chiusura automatica backend: protezione pre-chiusura, capitale protetto.'
  }

  if (exitReason === 'PRE_CLOSE_RISK' || exitReason === 'SESSION_PROTECTION') {
    return `Chiusura automatica backend: protezione ${getMarketCloseGuardLabel(strategy)} attivata.`
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
  // Il governo del rischio vale anche qui: dopo due perdite consecutive la size
  // scende, dopo tre si apre al massimo una posizione. Prima il backend ignorava
  // i moltiplicatori e conosceva solo il blocco permanente.
  const riskState = getRiskGovernorState(state, strategy)
  let riskOpenings = 0

  automaticRows.forEach((row) => {
    if (positions.length >= maxPositions || !canOpenPosition(capital, sizing)) {
      return
    }

    if (riskOpenings >= (riskState.maxOpenings ?? Infinity)) {
      return
    }

    const positionSize = getRiskAdjustedPositionSize(capital, sizing, riskState)
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
    const openCommissionEur = Number(trade.executionCosts?.open?.commissionEur) || 0

    if (capital < positionSize + openCommissionEur) {
      const rejectedOrder = createSimulationOrder({
        action: 'OPEN',
        direction: type,
        marketId: strategy.id,
        marketLabel: strategy.label,
        notional: positionSize,
        requestedPrice: row.currentPrice,
        reason: 'Capitale insufficiente per coprire importo e commissione di apertura.',
        side: getOpenOrderSide(type),
        source: 'backend-monitor',
        status: 'RIFIUTATO',
        ticker: row.ticker,
      })
      orders = appendOrders({ orders }, rejectedOrder)
      rejectedOrders.push(rejectedOrder)
      return
    }

    order = {
      ...order,
      executedPrice: trade.entryPrice,
      executedPriceEur: trade.entryPriceEur,
      executionCosts: trade.executionCosts.open,
      fee: openCommissionEur,
      positionId: trade.id,
      quantity: trade.quantity,
    }
    orders = appendOrders({ orders }, order)
    positions.push(trade)
    capital = roundPrice(capital - positionSize - openCommissionEur)
    openedTrades.push(trade)
    riskOpenings += 1
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

function evaluatePosition(
  position,
  latestPrice,
  { forceCloseReason = null, priceData = {} } = {},
) {
  const invested = position.invested || LEGACY_POSITION_SIZE
  const entryPriceEur =
    Number(position.entryPriceEur) ||
    convertToEur(position.entryPrice, position.entryFxToEur || 1)
  const latestFxToEur =
    Number(priceData.latestFxToEur || priceData.fxToEur) ||
    position.latestFxToEur ||
    position.entryFxToEur ||
    1
  const entryCommissionEur = getPositionOpenCommissionEur(position)
  const estimatedQuantity =
    Number.isFinite(Number(position.quantity)) && Number(position.quantity) > 0
      ? Number(position.quantity)
      : invested / entryPriceEur
  const theoreticalLatestPriceEur = convertToEur(latestPrice, latestFxToEur)
  const estimatedExitNotionalEur =
    Number.isFinite(Number(theoreticalLatestPriceEur)) && estimatedQuantity > 0
      ? theoreticalLatestPriceEur * estimatedQuantity
      : invested
  const closeExecutionCosts = applyExecutionCosts({
    atr: position.atrAtEntry,
    currency: position.currency || getTickerCurrency(position.ticker),
    fxToEur: latestFxToEur,
    marketId: position.marketId || DEFAULT_MARKET_ID,
    notionalEur: estimatedExitNotionalEur,
    phase: 'CLOSE',
    price: latestPrice,
    type: position.type,
  })
  const effectiveLatestPrice = Number(closeExecutionCosts.effectivePrice)
  const latestPriceEur =
    Number(closeExecutionCosts.effectivePriceEur) ||
    convertToEur(effectiveLatestPrice, latestFxToEur)
  const quantity =
    Number.isFinite(Number(position.quantity)) && Number(position.quantity) > 0
      ? Number(position.quantity)
      : invested / entryPriceEur
  const long = position.type === 'LONG'
  const pricePnlEur = long
    ? (latestPriceEur - entryPriceEur) * quantity
    : (entryPriceEur - latestPriceEur) * quantity
  const exitCommissionEur = Number(closeExecutionCosts.commissionEur) || 0
  const pnlEur = pricePnlEur - entryCommissionEur - exitCommissionEur
  const roundedPnl = roundPrice(pnlEur)
  const positionStrategy = getTradingStrategy(position.marketId)
  const sessionStatus = getMarketSessionStatus(
    positionStrategy,
    new Date(),
    position.ticker,
  )
  const preCloseDecision = getPreCloseProtectionDecision({
    position,
    latestPrice,
    pnlEur,
    sessionStatus,
  })
  const profitExit = evaluateProfitExit(position, latestPrice)
  const effectiveStopLoss = getProtectedStopLoss(position, profitExit)
  const lockProtected =
    Number.isFinite(Number(effectiveStopLoss)) &&
    roundPrice(effectiveStopLoss) === roundPrice(position.entryPrice) &&
    Boolean(position.profitLockArmed || profitExit.monitoredFields?.profitLockArmed)
  const recoveredCapital = Math.max(invested + pricePnlEur - exitCommissionEur, 0)
  const isProfitableExit = profitExit.isWin && roundedPnl > 0
  const isLoss = long
    ? latestPrice <= effectiveStopLoss
    : latestPrice >= effectiveStopLoss
  const isForcedClose = Boolean(forceCloseReason)
  const isPreCloseClose = preCloseDecision.shouldClose
  const exitReason = isForcedClose
    ? forceCloseReason
    : isPreCloseClose
      ? preCloseDecision.exitReason
      : isProfitableExit
        ? profitExit.exitReason
        : lockProtected && roundedPnl >= 0
          ? 'BREAK_EVEN_STOP'
          : 'STOP_LOSS'
  const result = roundedPnl >= 0 ? 'WIN' : 'LOSS'
  const pnlOriginal = long
    ? (effectiveLatestPrice - position.entryPrice) * quantity
    : (position.entryPrice - effectiveLatestPrice) * quantity
  const closeOrder =
    isForcedClose || isPreCloseClose || isProfitableExit || profitExit.isWin || isLoss
      ? createSimulationOrder({
          action: 'CLOSE',
          direction: position.type,
          executedPrice: effectiveLatestPrice,
          executedPriceEur: latestPriceEur,
          executionCosts: closeExecutionCosts,
          fee: exitCommissionEur,
          marketId: position.marketId,
          marketLabel: position.marketLabel,
          notional: recoveredCapital,
          positionId: position.id,
          quantity: position.quantity || quantity,
          requestedPrice: latestPrice,
          reason: getCloseReasonText(exitReason, positionStrategy),
          side: getCloseOrderSide(position.type),
          source: 'backend-monitor',
          ticker: position.ticker,
        })
      : null
  const shouldClosePosition = Boolean(closeOrder)

  return {
    monitoredPosition: {
      ...position,
      ...profitExit.monitoredFields,
      executionCosts: {
        ...(position.executionCosts || {}),
        latestClose: closeExecutionCosts,
      },
      stopLoss: Number.isFinite(Number(effectiveStopLoss))
        ? roundPrice(effectiveStopLoss)
        : position.stopLoss,
      latestMarketPrice: roundPrice(latestPrice),
      latestPrice: roundPrice(effectiveLatestPrice),
      latestFxToEur,
      latestPriceEur: roundPrice(latestPriceEur),
      latestPriceAt: new Date().toISOString(),
      unrealizedPnl: roundPrice(pnlEur),
      preCloseRiskScore: preCloseDecision.riskScore,
      preCloseRiskMessage: preCloseDecision.message,
    },
    closeOrder,
    closedTrade:
      shouldClosePosition
        ? {
            ticker: position.ticker,
            type: position.type,
            positionId: position.id,
            closeOrderId: closeOrder.id,
            openedAt: position.openedAt || null,
            entryPrice: position.entryPrice,
            entryPriceEur: roundPrice(entryPriceEur),
            currency: position.currency || getTickerCurrency(position.ticker),
            entryFxToEur: position.entryFxToEur || 1,
            entrySignalPrice: position.entrySignalPrice || position.entryPrice,
            entrySignalPriceEur: position.entrySignalPriceEur || entryPriceEur,
            invested,
            executionCosts: {
              ...(position.executionCosts || {}),
              close: closeExecutionCosts,
            },
            grossPnlEur: roundPrice(pricePnlEur),
            totalCostsEur: roundPrice(entryCommissionEur + exitCommissionEur),
            pnlOriginal: roundPrice(pnlOriginal),
            pnlEur: roundedPnl,
            result,
            exitDate: new Date().toISOString(),
            exitSignalPrice: roundPrice(latestPrice),
            exitSignalPriceEur: roundPrice(theoreticalLatestPriceEur),
            exitPrice: roundPrice(effectiveLatestPrice),
            exitPriceEur: roundPrice(latestPriceEur),
            exitFxToEur: latestFxToEur,
            preCloseRiskScore: preCloseDecision.riskScore,
            preCloseRiskMessage: preCloseDecision.message,
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
  const closeGuardActive = isMarketCloseGuardActive(strategy)
  const now = new Date()
  const scanBlocked = isMarketScanBlocked(strategy, now)
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
          ? `Protezione azioni ${getMarketCloseGuardLabel(strategy)} attiva`
          : `Azioni in attesa delle ${getMarketScanStartLabel(strategy)}`,
        detail: closeGuardActive
          ? 'Nessuna posizione azionaria aperta. Nuove aperture bloccate fino alla prossima seduta.'
          : `Nessuna posizione azionaria aperta. La prima scansione partirà alle ${getMarketScanStartLabel(strategy)}, dopo la lettura della chiusura USA.`,
      })

      return {
        state: syncActiveMarketState({
          ...current,
          isChecking: false,
          isScanning: false,
          engineStatus: closeGuardActive
            ? `Protezione azioni ${getMarketCloseGuardLabel(strategy)} attiva`
            : `In attesa delle ${getMarketScanStartLabel(strategy)}`,
          nextScanAt: getNextScanAt(current.activeMarket, now),
          lastBackendCheckAt: new Date().toISOString(),
          lastAutomationMessage: closeGuardActive
            ? `Mondo azionario fermo: nessuna scansione o apertura prima delle ${getMarketScanStartLabel(strategy)}.`
            : `Mondo azionario in attesa: prima scansione automatica alle ${getMarketScanStartLabel(strategy)}, con contesto USA.`,
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
      const currency = position.currency || getTickerCurrency(position.ticker)
      const fx = await fetchBackendFxRateToEur(currency).catch(() => ({
        rate: position.entryFxToEur || 1,
      }))
      const { monitoredPosition, closedTrade, closeOrder } = evaluatePosition(
        position,
        latestPrice,
        {
          forceCloseReason: null,
          priceData: {
            latestFxToEur: Number(fx.rate) || position.entryFxToEur || 1,
          },
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
          ? `Protezione azioni ${getMarketCloseGuardLabel(strategy)} eseguita`
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
              ? `${closedTrades.length} posizioni azionarie chiuse dalla protezione ${getMarketCloseGuardLabel(strategy)}. Nessuna nuova apertura azionaria consentita.`
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
            ? `Protezione azioni ${getMarketCloseGuardLabel(strategy)} completata`
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

async function runNeonQuery(label, queryFn) {
  const timeoutMs = SUPABASE_QUERY_TIMEOUT_MS || 8_000
  return Promise.race([
    queryFn(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} non ha risposto entro ${timeoutMs / 1000} secondi.`)),
        timeoutMs,
      ),
    ),
  ])
}

export async function readTradingState(dbClient) {
  const sql = typeof dbClient === 'function' ? dbClient : getNeonSql()

  if (!sql) {
    throw new Error('Database Neon non configurato')
  }

  const rows = await runNeonQuery('Lettura stato Neon', () =>
    sql`SELECT payload, updated_at FROM public.spapple_state WHERE id = ${STATE_ID} LIMIT 1`,
  )

  const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null

  return {
    payload: normalizeTradingState(data?.payload),
    updatedAt: data?.updated_at ? new Date(data.updated_at).toISOString() : null,
  }
}

async function writeStateEvent(sql, payload) {
  const deleteBefore = new Date(Date.now() - STATE_EVENT_RETENTION_MS).toISOString()

  try {
    await runNeonQuery('Pulizia eventi Neon', () =>
      sql`DELETE FROM public.spapple_state_events WHERE state_id = ${STATE_ID} AND created_at < ${deleteBefore}`,
    )

    await runNeonQuery('Scrittura evento Neon', () =>
      sql`INSERT INTO public.spapple_state_events (state_id, revision, source, summary)
          VALUES (${STATE_ID}, ${payload.stateRevision || 0}, ${payload.lastStateMutationSource || 'server'}, ${payload.lastStateMutationSummary || 'Stato Spapple aggiornato'})`,
    )
  } catch (error) {
    const rawMessage = String(error?.message || error || '')
    const optionalTableMissing =
      rawMessage.includes('spapple_state_events') ||
      rawMessage.includes('42P01') ||
      rawMessage.includes('42501')

    if (!optionalTableMissing) {
      // Ignora errori su tabella opzionale di eventi
    }
  }
}

export async function writeTradingState(
  dbClient,
  payload,
  { source = 'server', summary = 'Stato Spapple aggiornato' } = {},
) {
  const sql = typeof dbClient === 'function' ? dbClient : getNeonSql()

  if (!sql) {
    throw new Error('Database Neon non configurato')
  }

  const { payload: currentPayload } = await readTradingState(sql)
  const updatedAt = new Date().toISOString()
  const nextPayload = normalizeTradingState({
    ...payload,
    stateRevision: Number(currentPayload.stateRevision || 0) + 1,
    lastStateMutationAt: updatedAt,
    lastStateMutationSource: source,
    lastStateMutationSummary: summary,
  })

  await runNeonQuery('Scrittura stato Neon', () =>
    sql`INSERT INTO public.spapple_state (id, payload, updated_at)
        VALUES (${STATE_ID}, ${JSON.stringify(nextPayload)}, ${updatedAt})
        ON CONFLICT (id) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
  )

  await writeStateEvent(sql, nextPayload)

  return {
    payload: nextPayload,
    updatedAt,
    stateRevision: nextPayload.stateRevision,
  }
}
