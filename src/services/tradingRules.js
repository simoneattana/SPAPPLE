export const DEFAULT_LONG_RSI_LIMIT = 30
export const DEFAULT_SHORT_RSI_LIMIT = 70
export const AUTO_LONG_RSI_LIMIT = 28
export const AUTO_SHORT_RSI_LIMIT = 72
export const MAX_AUTO_ATR_PCT = 6

export const ASIA_LONG_RSI_LIMIT = 35
export const ASIA_SHORT_RSI_LIMIT = 65
export const ASIA_AUTO_LONG_RSI_LIMIT = 32
export const ASIA_AUTO_SHORT_RSI_LIMIT = 68

function getTickerFromRow(rowOrTicker) {
  if (typeof rowOrTicker === 'string') {
    return rowOrTicker
  }

  return rowOrTicker?.ticker || ''
}

export function getEquitySignalThresholds(rowOrTicker) {
  const ticker = getTickerFromRow(rowOrTicker).toUpperCase()
  const isAsiaTicker = ticker.endsWith('.TSE') || ticker.endsWith('.HK')

  if (isAsiaTicker) {
    return {
      long: ASIA_LONG_RSI_LIMIT,
      short: ASIA_SHORT_RSI_LIMIT,
      autoLong: ASIA_AUTO_LONG_RSI_LIMIT,
      autoShort: ASIA_AUTO_SHORT_RSI_LIMIT,
      maxAtrPct: MAX_AUTO_ATR_PCT,
    }
  }

  return {
    long: DEFAULT_LONG_RSI_LIMIT,
    short: DEFAULT_SHORT_RSI_LIMIT,
    autoLong: AUTO_LONG_RSI_LIMIT,
    autoShort: AUTO_SHORT_RSI_LIMIT,
    maxAtrPct: MAX_AUTO_ATR_PCT,
  }
}

export function getEquitySignalType(row) {
  const thresholds = getEquitySignalThresholds(row)

  if (row.rsi < thresholds.long) {
    return 'LONG'
  }

  if (row.rsi > thresholds.short) {
    return 'SHORT'
  }

  return null
}

export function isActionableResult(row) {
  return row.status === 'ok' && row.pe > 0 && Boolean(getEquitySignalType(row))
}

export function getAtrPct(row) {
  if (!Number.isFinite(Number(row.atr)) || !Number.isFinite(Number(row.currentPrice))) {
    return null
  }

  return (Number(row.atr) / Number(row.currentPrice)) * 100
}

export function getAutoScore(row) {
  const thresholds = getEquitySignalThresholds(row)
  const rsiDistance =
    row.rsi < thresholds.long
      ? thresholds.long - row.rsi
      : row.rsi - thresholds.short
  const atrPct = getAtrPct(row) || 0

  return rsiDistance * 10 - atrPct
}

export function isAutoEligibleResult(row) {
  if (!isActionableResult(row)) {
    return false
  }

  const atrPct = getAtrPct(row)
  const thresholds = getEquitySignalThresholds(row)
  const hasStrongRsi =
    row.rsi <= thresholds.autoLong || row.rsi >= thresholds.autoShort

  return (
    hasStrongRsi &&
    Number.isFinite(atrPct) &&
    atrPct <= thresholds.maxAtrPct
  )
}

export function sortByAutoScore(rows) {
  return [...rows].sort((left, right) => getAutoScore(right) - getAutoScore(left))
}

export function isRejectedResult(row) {
  return row.status !== 'ok' || !isActionableResult(row)
}
