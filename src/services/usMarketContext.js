export const US_MARKET_CONTEXT_SYMBOL = '^GSPC'
export const US_MARKET_CONTEXT_NAME = 'S&P 500'
export const US_MARKET_POSITIVE_THRESHOLD_PCT = 0.4
export const US_MARKET_NEGATIVE_THRESHOLD_PCT = -0.4
export const US_MARKET_STRONG_LONG_RSI = 25
export const US_MARKET_STRONG_SHORT_RSI = 75

function isFiniteNumber(value) {
  return Number.isFinite(Number(value))
}

function roundPct(value) {
  return Number(Number(value).toFixed(2))
}

export function createUnavailableUsMarketContext(reason = 'Dato USA non disponibile') {
  return {
    symbol: US_MARKET_CONTEXT_SYMBOL,
    name: US_MARKET_CONTEXT_NAME,
    status: 'unavailable',
    label: 'USA non disponibile',
    changePct: null,
    latestClose: null,
    previousClose: null,
    latestDate: null,
    previousDate: null,
    reason,
    fetchedAt: new Date().toISOString(),
  }
}

export function classifyUsMarketContext(changePct) {
  if (!isFiniteNumber(changePct)) {
    return 'unavailable'
  }

  if (Number(changePct) >= US_MARKET_POSITIVE_THRESHOLD_PCT) {
    return 'positive'
  }

  if (Number(changePct) <= US_MARKET_NEGATIVE_THRESHOLD_PCT) {
    return 'negative'
  }

  return 'neutral'
}

export function buildUsMarketContextFromHistory(history = []) {
  const validBars = history.filter((bar) => isFiniteNumber(bar?.close))
  const latest = validBars.at(-1)
  const previous = validBars.at(-2)

  if (!latest || !previous || Number(previous.close) <= 0) {
    return createUnavailableUsMarketContext(
      'Storico S&P 500 insufficiente per leggere la chiusura USA precedente.',
    )
  }

  const latestClose = Number(latest.close)
  const previousClose = Number(previous.close)
  const changePct = ((latestClose - previousClose) / previousClose) * 100
  const status = classifyUsMarketContext(changePct)

  return {
    symbol: US_MARKET_CONTEXT_SYMBOL,
    name: US_MARKET_CONTEXT_NAME,
    status,
    label: getUsMarketContextLabel({ status }),
    changePct: roundPct(changePct),
    latestClose,
    previousClose,
    latestDate: latest.date || null,
    previousDate: previous.date || null,
    reason: null,
    fetchedAt: new Date().toISOString(),
  }
}

export function getUsMarketContextLabel(context) {
  if (!context || context.status === 'unavailable') {
    return 'USA non disponibile'
  }

  if (context.status === 'positive') {
    return 'USA positiva'
  }

  if (context.status === 'negative') {
    return 'USA negativa'
  }

  return 'USA neutrale'
}

export function getUsMarketContextDetail(context) {
  if (!context || context.status === 'unavailable') {
    return context?.reason || 'La chiusura USA precedente non è disponibile.'
  }

  const change = `${Number(context.changePct).toFixed(2).replace('.', ',')}%`
  const date = context.latestDate ? ` del ${context.latestDate}` : ''

  if (context.status === 'positive') {
    return `${US_MARKET_CONTEXT_NAME}${date} ha chiuso a ${change}. Contesto risk-on: gli Short europei automatici richiedono RSI >= ${US_MARKET_STRONG_SHORT_RSI}.`
  }

  if (context.status === 'negative') {
    return `${US_MARKET_CONTEXT_NAME}${date} ha chiuso a ${change}. Contesto risk-off: i Long europei automatici richiedono RSI <= ${US_MARKET_STRONG_LONG_RSI}.`
  }

  return `${US_MARKET_CONTEXT_NAME}${date} ha chiuso a ${change}. Contesto neutrale: il pilota usa le soglie standard.`
}

export function getUsMarketContextSummary(context) {
  return `${getUsMarketContextLabel(context)} · ${getUsMarketContextDetail(context)}`
}

function getEquitySignalType(row) {
  if (Number(row?.rsi) < 30) {
    return 'LONG'
  }

  if (Number(row?.rsi) > 70) {
    return 'SHORT'
  }

  return null
}

export function isEquityAutoAllowedByUsContext(row, context) {
  if (!context || context.status === 'neutral' || context.status === 'unavailable') {
    return true
  }

  const signalType = getEquitySignalType(row)
  const rsi = Number(row?.rsi)

  if (context.status === 'negative' && signalType === 'LONG') {
    return rsi <= US_MARKET_STRONG_LONG_RSI
  }

  if (context.status === 'positive' && signalType === 'SHORT') {
    return rsi >= US_MARKET_STRONG_SHORT_RSI
  }

  return true
}

export function filterEquityRowsByUsMarketContext(rows = [], context) {
  return rows.filter((row) => isEquityAutoAllowedByUsContext(row, context))
}
