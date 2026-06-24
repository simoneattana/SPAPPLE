const API_BASE_URL = 'https://financialmodelingprep.com/stable'
const MIN_HISTORY_LENGTH = 15

function getApiKey() {
  const apiKey = import.meta.env.VITE_API_KEY

  if (!apiKey) {
    throw new Error('Chiave API mancante')
  }

  return apiKey
}

async function fetchJson(url) {
  const response = await fetch(url)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(text || `Richiesta API fallita con stato ${response.status}`)
  }

  try {
    const data = JSON.parse(text)

    if (data?.['Error Message'] || data?.error) {
      throw new Error(data['Error Message'] || data.error)
    }

    return data
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(text || 'Risposta API non valida')
    }

    throw error
  }
}

function assertNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`${label} non disponibile`)
  }

  return number
}

function assertArray(data, label) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`${label} non disponibile`)
  }

  return data
}

function normalizeHistory(historyData, ticker) {
  const history = assertArray(historyData, `Storico EOD per ${ticker}`)
    .map((item) => ({
      date: item.date,
      open: assertNumber(item.open, `Apertura EOD per ${ticker}`),
      high: assertNumber(item.high, `Massimo EOD per ${ticker}`),
      low: assertNumber(item.low, `Minimo EOD per ${ticker}`),
      close: assertNumber(item.close, `Chiusura EOD per ${ticker}`),
      volume: assertNumber(item.volume, `Volume EOD per ${ticker}`),
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  if (history.length < MIN_HISTORY_LENGTH) {
    throw new Error(`Storico EOD insufficiente per ${ticker}`)
  }

  return history
}

function calculateRsi(history, period = 14) {
  const closes = history.map((item) => item.close)
  let averageGain = 0
  let averageLoss = 0

  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1]
    averageGain += Math.max(change, 0)
    averageLoss += Math.max(-change, 0)
  }

  averageGain /= period
  averageLoss /= period

  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1]
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)
    averageGain = (averageGain * (period - 1) + gain) / period
    averageLoss = (averageLoss * (period - 1) + loss) / period
  }

  if (averageLoss === 0) {
    return 100
  }

  const relativeStrength = averageGain / averageLoss
  return 100 - 100 / (1 + relativeStrength)
}

function calculateAtr(history, period = 14) {
  const trueRanges = []

  for (let index = 1; index < history.length; index += 1) {
    const current = history[index]
    const previous = history[index - 1]
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    )
  }

  if (trueRanges.length < period) {
    throw new Error('Storico EOD insufficiente per ATR')
  }

  let atr =
    trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period

  for (let index = period; index < trueRanges.length; index += 1) {
    atr = (atr * (period - 1) + trueRanges[index]) / period
  }

  return atr
}

function extractPeRatio(metricsData, ticker) {
  const metrics = assertArray(metricsData, `Metriche fondamentali per ${ticker}`)[0]
  const earningsYield = assertNumber(
    metrics.earningsYieldTTM,
    `Earnings Yield TTM per ${ticker}`,
  )

  if (earningsYield === 0) {
    throw new Error(`P/E non calcolabile per ${ticker}`)
  }

  return 1 / earningsYield
}

async function fetchTickerData(ticker, apiKey) {
  const encodedTicker = encodeURIComponent(ticker)
  const historyUrl = `${API_BASE_URL}/historical-price-eod/full?symbol=${encodedTicker}&apikey=${apiKey}`
  const metricsUrl = `${API_BASE_URL}/key-metrics-ttm?symbol=${encodedTicker}&apikey=${apiKey}`

  const [historyData, metricsData] = await Promise.all([
    fetchJson(historyUrl),
    fetchJson(metricsUrl),
  ])

  const history = normalizeHistory(historyData, ticker)
  const latestBar = history.at(-1)

  return {
    ticker,
    closePrice: latestBar.close,
    rsi14: calculateRsi(history, 14),
    atr14: calculateAtr(history, 14),
    peRatio: extractPeRatio(metricsData, ticker),
    source: 'Financial Modeling Prep',
    eodDate: latestBar.date,
  }
}

export async function fetchMarketData(tickers) {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error('Lista ticker non valida')
  }

  const apiKey = getApiKey()
  return Promise.all(tickers.map((ticker) => fetchTickerData(ticker, apiKey)))
}
