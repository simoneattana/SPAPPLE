export const CRYPTO_LONG_RSI_LIMIT = 36
export const CRYPTO_SHORT_RSI_LIMIT = 64
export const CRYPTO_AUTO_LONG_RSI_LIMIT = 32
export const CRYPTO_AUTO_SHORT_RSI_LIMIT = 68
export const CRYPTO_MAX_AUTO_ATR_PCT = 9
export const CRYPTO_MIN_DAILY_VOLUME_EUR = 5000000
export const CRYPTO_MIN_MARKET_CAP_EUR = 1000000000

export function getCryptoAtrPct(row) {
  if (!Number.isFinite(Number(row.atr)) || !Number.isFinite(Number(row.currentPrice))) {
    return null
  }

  return (Number(row.atr) / Number(row.currentPrice)) * 100
}

export function isCryptoActionableResult(row) {
  return (
    row.status === 'ok' &&
    row.tradeEnabled !== false &&
    Number(row.volumeEur) >= CRYPTO_MIN_DAILY_VOLUME_EUR &&
    Number(row.marketCapEur || 0) >= CRYPTO_MIN_MARKET_CAP_EUR &&
    (row.rsi < CRYPTO_LONG_RSI_LIMIT || row.rsi > CRYPTO_SHORT_RSI_LIMIT)
  )
}

export function getCryptoSignalType(row) {
  if (row.rsi < CRYPTO_LONG_RSI_LIMIT) {
    return 'LONG'
  }

  if (row.rsi > CRYPTO_SHORT_RSI_LIMIT) {
    return 'SHORT'
  }

  return null
}

export function getCryptoAutoScore(row) {
  const signalType = getCryptoSignalType(row)
  const rsiDistance =
    signalType === 'LONG'
      ? CRYPTO_LONG_RSI_LIMIT - row.rsi
      : row.rsi - CRYPTO_SHORT_RSI_LIMIT
  const atrPct = getCryptoAtrPct(row) || 0
  const volumeBonus = Math.min(Math.log10(Math.max(Number(row.volumeEur), 1)), 8)
  const capBonus = Math.min(Math.log10(Math.max(Number(row.marketCapEur), 1)), 11)
  const rankPenalty = Number(row.marketCapRank) > 0
    ? Math.min(Number(row.marketCapRank) / 100, 2)
    : 0

  return rsiDistance * 12 + volumeBonus + capBonus - atrPct - rankPenalty
}

export function isCryptoAutoEligibleResult(row) {
  if (!isCryptoActionableResult(row)) {
    return false
  }

  const atrPct = getCryptoAtrPct(row)
  const hasStrongRsi =
    row.rsi <= CRYPTO_AUTO_LONG_RSI_LIMIT ||
    row.rsi >= CRYPTO_AUTO_SHORT_RSI_LIMIT

  return hasStrongRsi && Number.isFinite(atrPct) && atrPct <= CRYPTO_MAX_AUTO_ATR_PCT
}

export function sortByCryptoAutoScore(rows) {
  return [...rows].sort(
    (left, right) => getCryptoAutoScore(right) - getCryptoAutoScore(left),
  )
}

export function isCryptoRejectedResult(row) {
  return row.status !== 'ok' || !isCryptoActionableResult(row)
}
