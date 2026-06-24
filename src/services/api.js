import { ATR, RSI } from 'technicalindicators'

const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14

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

  return {
    ticker,
    currentPrice: latestBar.close,
    pe,
    rsi,
    atr,
  }
}

export async function fetchMarketData(tickers) {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error('Lista ticker non valida')
  }

  return Promise.all(tickers.map((ticker) => fetchTickerData(ticker)))
}
