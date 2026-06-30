export const CRYPTO_AUTO_LONG_RSI_LIMIT = 28
export const CRYPTO_AUTO_SHORT_RSI_LIMIT = 72
export const CRYPTO_MAX_AUTO_ATR_PCT = 12
export const CRYPTO_MIN_DAILY_VOLUME_EUR = 100000

export function getCryptoAtrPct(row) {
  if (!Number.isFinite(Number(row.atr)) || !Number.isFinite(Number(row.currentPrice))) {
    return null
  }

  return (Number(row.atr) / Number(row.currentPrice)) * 100
}

export function isCryptoActionableResult(row) {
  return (
    row.status === 'ok' &&
    Number(row.volumeEur) >= CRYPTO_MIN_DAILY_VOLUME_EUR &&
    (row.rsi < 30 || row.rsi > 70)
  )
}

export function getCryptoAutoScore(row) {
  const rsiDistance = row.rsi < 30 ? 30 - row.rsi : row.rsi - 70
  const atrPct = getCryptoAtrPct(row) || 0
  const volumeBonus = Math.min(Math.log10(Math.max(Number(row.volumeEur), 1)), 8)

  return rsiDistance * 12 + volumeBonus - atrPct
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
