import { ATR, RSI } from 'technicalindicators'
import { fetchLatestCryptoPrice } from './cryptoApi'
import { mergeTickerProfile } from './tickerMetadata'
import {
  US_MARKET_CONTEXT_SYMBOL,
  buildUsMarketContextFromHistory,
  createUnavailableUsMarketContext,
} from './usMarketContext'

const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 8

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

function extractMarketPrice(summaryData, ticker) {
  const summary = summaryData?.quoteSummary?.result?.[0]
  const price =
    summary?.price?.regularMarketPrice?.raw ??
    summary?.price?.postMarketPrice?.raw ??
    summary?.price?.preMarketPrice?.raw

  return assertNumber(price, `${ticker}: prezzo di mercato`)
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

async function fetchTickerData(ticker) {
  const encodedTicker = encodeURIComponent(ticker)
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
  }
}

async function fetchTickerDiagnostic(ticker) {
  try {
    const row = await fetchTickerData(ticker)

    return {
      ...row,
      reason: getDiagnostic(row),
    }
  } catch (error) {
    return {
      ticker,
      profile: mergeTickerProfile(ticker),
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

  const encodedTicker = encodeURIComponent(ticker)
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
