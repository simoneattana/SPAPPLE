const EODHD_PROXY_URL = '/api/eodhd/eod'
const MIN_HISTORY_LENGTH = 15

const EODHD_SYMBOLS = {
  'ENEL.MI': {
    symbol: '0NRE.LSE',
    label: 'Enel SpA',
    note: 'Listing EODHD LSE in EUR',
  },
  'ISP.MI': {
    symbol: 'IES.XETRA',
    label: 'Intesa Sanpaolo S.p.A.',
    note: 'Listing EODHD XETRA in EUR',
  },
  'RACE.MI': {
    symbol: '2FE.XETRA',
    label: 'Ferrari N.V.',
    note: 'Listing EODHD XETRA in EUR',
  },
  'STLAM.MI': {
    symbol: 'STLAP.PA',
    label: 'Stellantis N.V.',
    note: 'Listing EODHD Paris in EUR',
  },
  'UCG.MI': {
    symbol: 'CRIN.XETRA',
    label: 'UniCredit S.p.A.',
    note: 'Listing EODHD XETRA in EUR',
  },
}

function resolveEodhdSymbol(ticker) {
  const mappedSymbol = EODHD_SYMBOLS[ticker]

  if (!mappedSymbol) {
    throw new Error(`Ticker EODHD non configurato per ${ticker}`)
  }

  return mappedSymbol
}

async function fetchEodHistory(ticker, mappedSymbol) {
  const url = `${EODHD_PROXY_URL}?symbol=${encodeURIComponent(mappedSymbol.symbol)}`
  const response = await fetch(url)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(text || `${ticker}: richiesta EODHD fallita`)
  }

  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${ticker}: risposta EODHD non valida`)
  }

  if (!Array.isArray(data) || data.length < MIN_HISTORY_LENGTH) {
    throw new Error(`${ticker}: storico EODHD insufficiente`)
  }

  return data
    .map((item) => ({
      date: item.date,
      open: assertNumber(item.open, `${ticker}: apertura`),
      high: assertNumber(item.high, `${ticker}: massimo`),
      low: assertNumber(item.low, `${ticker}: minimo`),
      close: assertNumber(item.close, `${ticker}: chiusura`),
      volume: assertNumber(item.volume, `${ticker}: volume`),
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

function assertNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`${label} non disponibile`)
  }

  return number
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

async function fetchTickerData(ticker) {
  const mappedSymbol = resolveEodhdSymbol(ticker)
  const history = await fetchEodHistory(ticker, mappedSymbol)
  const latestBar = history.at(-1)

  return {
    ticker,
    dataSymbol: mappedSymbol.symbol,
    label: mappedSymbol.label,
    note: mappedSymbol.note,
    closePrice: latestBar.close,
    rsi14: calculateRsi(history, 14),
    atr14: calculateAtr(history, 14),
    peRatio: null,
    source: 'EODHD',
    eodDate: latestBar.date,
  }
}

export async function fetchMarketData(tickers) {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error('Lista ticker non valida')
  }

  return Promise.all(tickers.map((ticker) => fetchTickerData(ticker)))
}
