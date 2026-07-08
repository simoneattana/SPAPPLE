import { ATR, RSI } from 'technicalindicators'
import { fetchLatestCryptoPrice } from './cryptoApi'
import { convertToBaseCurrency, fetchFxRateToEur } from './currency'
import {
  getEodhdSymbol,
  getYahooSymbol,
  shouldUseEodhdForTicker,
} from './eodhdSymbols'
import { getTickerCurrency } from './marketUniverse'
import { mergeTickerProfile } from './tickerMetadata'
import {
  getEquitySignalThresholds,
  getEquitySignalType,
} from './tradingRules'
import {
  US_MARKET_CONTEXT_SYMBOL,
  buildUsMarketContextFromHistory,
  createUnavailableUsMarketContext,
} from './usMarketContext'

const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 8
const fxRateCache = new Map()

async function fetchJson(url, label) {
  const response = await fetch(url)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(text || `${label}: richiesta fallita`)
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label}: risposta non valida`)
  }
}

function assertNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`${label} non disponibile`)
  }

  return number
}

function extractChartHistory(chartData, ticker) {
  const result = chartData?.chart?.result?.[0]
  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0]

  if (!Array.isArray(timestamps) || !quote) {
    throw new Error(`${ticker}: storico Yahoo non disponibile`)
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

function extractUsContextHistory(chartData) {
  const result = chartData?.chart?.result?.[0]
  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0]

  if (!Array.isArray(timestamps) || !quote) {
    return []
  }

  return timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close: quote.close?.[index],
    }))
    .filter((bar) => bar.close !== null && bar.close !== undefined)
    .map((bar) => ({
      date: bar.date,
      close: assertNumber(bar.close, 'S&P 500: chiusura'),
    }))
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

function extractMarketPrice(summaryData, ticker) {
  const summary = summaryData?.quoteSummary?.result?.[0]
  const price =
    summary?.price?.regularMarketPrice?.raw ??
    summary?.price?.postMarketPrice?.raw ??
    summary?.price?.preMarketPrice?.raw

  return assertNumber(price, `${ticker}: prezzo di mercato`)
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

function extractTickerProfile(summaryData, ticker) {
  const summary = summaryData?.quoteSummary?.result?.[0]
  const price = summary?.price || {}
  const assetProfile = summary?.assetProfile || {}
  const rawDescription = assetProfile.longBusinessSummary || ''
  const description =
    rawDescription.length > 260
      ? `${rawDescription.slice(0, 260).trim()}...`
      : rawDescription

  return mergeTickerProfile(ticker, {
    name: price.longName || price.shortName || null,
    sector: assetProfile.sector || null,
    industry: assetProfile.industry || null,
    country: assetProfile.country || null,
    website: assetProfile.website || null,
    description: description || null,
  })
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

function getDiagnostic(row) {
  if (row.status === 'error') {
    return row.reason || 'Dati non disponibili'
  }

  const thresholds = getEquitySignalThresholds(row)
  const signalType = getEquitySignalType(row)

  if (row.pe <= 0) {
    return 'Scartato: P/E assente, nullo o negativo'
  }

  if (!signalType) {
    return `Scartato: RSI in zona neutrale (${thresholds.long}-${thresholds.short})`
  }

  if (signalType === 'LONG') {
    return `Ammesso: società profittevole e RSI sotto ${thresholds.long}`
  }

  return `Ammesso: società profittevole e RSI sopra ${thresholds.short}`
}

function calculateIndicators(history, ticker) {
  const high = history.map((bar) => bar.high)
  const low = history.map((bar) => bar.low)
  const close = history.map((bar) => bar.close)

  const rsiValues = RSI.calculate({ values: close, period: RSI_PERIOD })
  const atrValues = ATR.calculate({ high, low, close, period: ATR_PERIOD })
  const rsi = rsiValues.at(-1)
  const atr = atrValues.at(-1)

  return {
    rsi: assertNumber(rsi, `${ticker}: RSI`),
    atr: assertNumber(atr, `${ticker}: ATR`),
  }
}

async function withCurrencyData(row) {
  const currency = getTickerCurrency(row.ticker)
  const cacheKey = String(currency || 'EUR').toUpperCase()

  if (!fxRateCache.has(cacheKey)) {
    fxRateCache.set(cacheKey, fetchFxRateToEur(currency))
  }

  const fx = await fxRateCache.get(cacheKey)
  const currentPriceEur = convertToBaseCurrency(row.currentPrice, fx.rate)
  const atrEur = convertToBaseCurrency(row.atr, fx.rate)

  return {
    ...row,
    currency,
    fxToEur: fx.rate,
    fxPair: fx.pair,
    fxProvider: fx.provider,
    currentPriceEur,
    atrEur,
  }
}

async function fetchTickerData(ticker) {
  if (!shouldUseEodhdForTicker(ticker)) {
    return fetchYahooTickerData(ticker)
  }

  try {
    return await fetchEodhdTickerData(ticker)
  } catch {
    return fetchYahooTickerData(ticker)
  }
}

async function fetchEodhdTickerData(ticker) {
  const encodedTicker = encodeURIComponent(getEodhdSymbol(ticker))
  const yahooTicker = getYahooSymbol(ticker)
  const isUsTicker = String(ticker).endsWith('.US')
  const [eodData, fundamentalsData, yahooSummaryData] = await Promise.all([
    fetchJson(
      `/api/eodhd/eod?symbol=${encodedTicker}`,
      `${ticker} storico EODHD`,
    ),
    isUsTicker
      ? Promise.resolve(null)
      : fetchJson(
          `/api/eodhd/fundamentals?symbol=${encodedTicker}`,
          `${ticker} fondamentali EODHD`,
        ).catch(() => null),
    isUsTicker
      ? fetchJson(
          `/api/yahoo/summary?symbol=${encodeURIComponent(yahooTicker)}`,
          `${ticker} P/E`,
        )
      : Promise.resolve(null),
  ])

  const history = extractEodhdHistory(eodData, ticker)
  const latestBar = history.at(-1)
  const { rsi, atr } = calculateIndicators(history, ticker)
  let pe = null
  let profile = fundamentalsData
    ? extractEodhdProfile(fundamentalsData, ticker)
    : null
  let provider = 'EODHD'

  if (fundamentalsData) {
    try {
      pe = extractEodhdPeRatio(fundamentalsData, ticker)
    } catch {
      pe = null
    }
  }

  if (!Number.isFinite(pe)) {
    const summaryData =
      yahooSummaryData ||
      (await fetchJson(
        `/api/yahoo/summary?symbol=${encodeURIComponent(yahooTicker)}`,
        `${ticker} P/E`,
      ))
    pe = extractPeRatio(summaryData, ticker)
    profile = profile || extractTickerProfile(summaryData, ticker)
    provider = 'EODHD + Yahoo P/E'
  }

  return {
    ticker,
    profile,
    currentPrice: latestBar.close,
    pe,
    rsi,
    atr,
    status: 'ok',
    provider,
  }
}

async function fetchYahooTickerData(ticker) {
  const yahooTicker = getYahooSymbol(ticker)
  const encodedTicker = encodeURIComponent(yahooTicker)
  const [chartData, summaryData] = await Promise.all([
    fetchJson(`/api/yahoo/chart?symbol=${encodedTicker}`, `${ticker} storico`),
    fetchJson(`/api/yahoo/summary?symbol=${encodedTicker}`, `${ticker} P/E`),
  ])

  const history = extractChartHistory(chartData, ticker)
  const latestBar = history.at(-1)
  const pe = extractPeRatio(summaryData, ticker)
  const { rsi, atr } = calculateIndicators(history, ticker)
  const profile = extractTickerProfile(summaryData, ticker)

  return {
    ticker,
    profile,
    currentPrice: latestBar.close,
    pe,
    rsi,
    atr,
    status: 'ok',
    provider: 'Yahoo Finance',
  }
}

async function fetchTickerDiagnostic(ticker) {
  try {
    const row = await withCurrencyData(await fetchTickerData(ticker))

    return {
      ...row,
      reason: getDiagnostic(row),
    }
  } catch (error) {
    return {
      ticker,
      profile: mergeTickerProfile(ticker),
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

async function mapWithConcurrency(items, limit, mapper) {
  const results = []

  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit)
    const batchResults = await Promise.all(batch.map(mapper))
    results.push(...batchResults)
  }

  return results
}

export async function fetchLatestPrice(ticker, marketId = 'equities') {
  if (marketId === 'crypto') {
    return fetchLatestCryptoPrice(ticker)
  }

  const yahooTicker = getYahooSymbol(ticker)
  const encodedTicker = encodeURIComponent(yahooTicker)
  const encodedEodhdTicker = encodeURIComponent(getEodhdSymbol(ticker))
  const useEodhd = shouldUseEodhdForTicker(ticker)
  const eodhdRealtimeData = useEodhd
    ? await fetchJson(
        `/api/eodhd/real-time?symbol=${encodedEodhdTicker}`,
        `${ticker} prezzo EODHD`,
      ).catch(() => null)
    : null

  if (eodhdRealtimeData) {
    try {
      return extractEodhdPrice(eodhdRealtimeData, ticker)
    } catch {
      // Se EODHD non espone un prezzo aggiornato valido, passiamo a Yahoo.
    }
  }

  const eodhdData = useEodhd
    ? await fetchJson(
        `/api/eodhd/eod?symbol=${encodedEodhdTicker}`,
        `${ticker} prezzo EODHD EOD`,
      ).catch(() => null)
    : null

  if (eodhdData) {
    try {
      return extractEodhdHistory(eodhdData, ticker).at(-1).close
    } catch {
      // Se anche lo storico EODHD non è leggibile, usiamo Yahoo.
    }
  }

  const summaryData = await fetchJson(
    `/api/yahoo/summary?symbol=${encodedTicker}`,
    `${ticker} prezzo aggiornato`,
  ).catch(() => null)

  if (summaryData) {
    try {
      return extractMarketPrice(summaryData, ticker)
    } catch {
      // Se Yahoo non espone il prezzo live, usiamo la barra giornaliera.
    }
  }

  const chartData = await fetchJson(
    `/api/yahoo/chart?symbol=${encodedTicker}`,
    `${ticker} prezzo aggiornato`,
  )
  const history = extractChartHistory(chartData, ticker)

  return history.at(-1).close
}

export async function fetchMarketData(tickers) {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error('Lista ticker non valida')
  }

  const results = await mapWithConcurrency(
    tickers,
    REQUEST_CONCURRENCY,
    fetchTickerDiagnostic,
  )

  if (results.every((row) => row.status === 'error')) {
    throw new Error('Nessun dato reale disponibile per la scansione')
  }

  return results
}

export async function fetchUsMarketContext() {
  try {
    const chartData = await fetchJson(
      `/api/yahoo/chart?symbol=${encodeURIComponent(US_MARKET_CONTEXT_SYMBOL)}`,
      'Contesto USA',
    )
    const history = extractUsContextHistory(chartData)

    return buildUsMarketContextFromHistory(history)
  } catch (error) {
    return createUnavailableUsMarketContext(
      error.message || 'Contesto USA non disponibile',
    )
  }
}
