import { ATR, RSI } from 'technicalindicators'
import { CRYPTO_TICKERS } from './cryptoUniverse'
import { CRYPTO_MIN_DAILY_VOLUME_EUR } from './cryptoRules'

const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 6

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

function getCryptoMeta(input) {
  if (typeof input === 'object' && input !== null) {
    return input
  }

  return CRYPTO_TICKERS.find((item) => item.ticker === input || item.krakenPair === input)
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

function buildProfile(meta) {
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

function getDiagnostic(row) {
  if (row.status === 'error') {
    return row.reason || 'Dati non disponibili'
  }

  if (Number(row.volumeEur) < CRYPTO_MIN_DAILY_VOLUME_EUR) {
    return 'Scartata: liquidità giornaliera troppo bassa'
  }

  if (row.rsi >= 30 && row.rsi <= 70) {
    return 'Scartata: RSI in zona neutrale'
  }

  if (row.rsi < 30) {
    return 'Ammessa: crypto liquida e RSI sotto 30'
  }

  return 'Ammessa: crypto liquida e RSI sopra 70'
}

async function fetchCryptoDiagnostic(input) {
  const meta = getCryptoMeta(input)
  const ticker = meta?.ticker || String(input)

  try {
    if (!meta?.krakenPair) {
      throw new Error(`${ticker}: coppia Kraken non configurata`)
    }

    const payload = await fetchJson(
      `/api/kraken/ohlc?pair=${encodeURIComponent(meta.krakenPair)}&interval=1440`,
      `${ticker} storico Kraken`,
    )
    const history = extractKrakenHistory(payload, ticker)
    const latestBar = history.at(-1)
    const { rsi, atr } = calculateIndicators(history, ticker)
    const volumeEur = latestBar.volume * latestBar.close
    const row = {
      ticker,
      market: 'crypto',
      provider: 'Kraken',
      profile: buildProfile(meta),
      currentPrice: latestBar.close,
      pe: null,
      volume: latestBar.volume,
      volumeEur,
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
      market: 'crypto',
      provider: 'Kraken',
      profile: meta ? buildProfile(meta) : null,
      currentPrice: null,
      pe: null,
      volume: null,
      volumeEur: null,
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

export async function fetchCryptoMarketData(tickers = CRYPTO_TICKERS) {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error('Lista crypto non valida')
  }

  const results = await mapWithConcurrency(
    tickers,
    REQUEST_CONCURRENCY,
    fetchCryptoDiagnostic,
  )

  if (results.every((row) => row.status === 'error')) {
    throw new Error('Nessun dato reale Kraken disponibile per la scansione')
  }

  return results
}

export async function fetchLatestCryptoPrice(ticker) {
  const meta = getCryptoMeta(ticker)

  if (!meta?.krakenPair) {
    throw new Error(`${ticker}: coppia Kraken non configurata`)
  }

  const payload = await fetchJson(
    `/api/kraken/ohlc?pair=${encodeURIComponent(meta.krakenPair)}&interval=1440`,
    `${ticker} prezzo Kraken`,
  )
  const history = extractKrakenHistory(payload, ticker)

  return history.at(-1).close
}
