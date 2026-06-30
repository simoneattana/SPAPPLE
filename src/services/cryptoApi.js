import { ATR, RSI } from 'technicalindicators'
import { CRYPTO_TICKERS } from './cryptoUniverse'
import {
  CRYPTO_LONG_RSI_LIMIT,
  CRYPTO_MIN_DAILY_VOLUME_EUR,
  CRYPTO_MIN_MARKET_CAP_EUR,
  CRYPTO_SHORT_RSI_LIMIT,
} from './cryptoRules'

const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 9
const REQUEST_TIMEOUT_MS = 6000

async function fetchJson(url, label) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  let text

  try {
    response = await fetch(url, { signal: controller.signal })
    text = await response.text()
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${label}: richiesta scaduta`)
    }

    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }

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

async function fetchCoinGeckoMarkets(items) {
  const ids = items
    .map((item) => getCryptoMeta(item)?.coingeckoId)
    .filter(Boolean)

  if (ids.length === 0) {
    return new Map()
  }

  const payload = await fetchJson(
    `/api/coingecko/markets?ids=${encodeURIComponent([...new Set(ids)].join(','))}`,
    'Dati CoinGecko',
  )

  if (!Array.isArray(payload)) {
    throw new Error('CoinGecko: risposta mercati non valida')
  }

  return new Map(payload.map((item) => [item.id, item]))
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

function enrichProfileWithMarketData(profile, marketData) {
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

function getDiagnostic(row) {
  if (row.status === 'error') {
    return row.reason || 'Dati non disponibili'
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

async function fetchCryptoDiagnostic(input, coingeckoMarkets) {
  const meta = getCryptoMeta(input)
  const ticker = meta?.ticker || String(input)
  const marketData = meta?.coingeckoId
    ? coingeckoMarkets.get(meta.coingeckoId)
    : null

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
    const volumeEur = Number(marketData?.total_volume) || latestBar.volume * latestBar.close
    const row = {
      ticker,
      market: 'crypto',
      provider: marketData ? 'Kraken + CoinGecko' : 'Kraken',
      profile: enrichProfileWithMarketData(buildProfile(meta), marketData),
      currentPrice: latestBar.close,
      pe: null,
      volume: latestBar.volume,
      volumeEur,
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
      marketCapEur: marketData?.market_cap || null,
      marketCapRank: marketData?.market_cap_rank || null,
      priceChange24hPct: marketData?.price_change_percentage_24h || null,
      priceChange7dPct: marketData?.price_change_percentage_7d_in_currency || null,
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

  const coingeckoMarkets = await fetchCoinGeckoMarkets(tickers)
  const results = await mapWithConcurrency(
    tickers,
    REQUEST_CONCURRENCY,
    (item) => fetchCryptoDiagnostic(item, coingeckoMarkets),
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
