export const AUTO_LONG_RSI_LIMIT = 28
export const AUTO_SHORT_RSI_LIMIT = 72
export const MAX_AUTO_ATR_PCT = 6

export function isActionableResult(row) {
  return row.status === 'ok' && row.pe > 0 && (row.rsi < 30 || row.rsi > 70)
}

export function getAtrPct(row) {
  if (!Number.isFinite(Number(row.atr)) || !Number.isFinite(Number(row.currentPrice))) {
    return null
  }

  return (Number(row.atr) / Number(row.currentPrice)) * 100
}

export function getAutoScore(row) {
  const rsiDistance = row.rsi < 30 ? 30 - row.rsi : row.rsi - 70
  const atrPct = getAtrPct(row) || 0

  return rsiDistance * 10 - atrPct
}

export function isAutoEligibleResult(row) {
  if (!isActionableResult(row)) {
    return false
  }

  const atrPct = getAtrPct(row)
  const hasStrongRsi =
    row.rsi <= AUTO_LONG_RSI_LIMIT || row.rsi >= AUTO_SHORT_RSI_LIMIT

  return hasStrongRsi && Number.isFinite(atrPct) && atrPct <= MAX_AUTO_ATR_PCT
}

export function sortByAutoScore(rows) {
  return [...rows].sort((left, right) => getAutoScore(right) - getAutoScore(left))
}

export function isRejectedResult(row) {
  return row.status !== 'ok' || !isActionableResult(row)
}
