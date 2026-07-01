export function normalizeTradeDate(value) {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

export function isSameLocalDay(firstValue, secondValue = new Date()) {
  const first = normalizeTradeDate(firstValue)
  const second = normalizeTradeDate(secondValue)

  if (!first || !second) {
    return false
  }

  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

export function isSameLocalMonth(firstValue, secondValue = new Date()) {
  const first = normalizeTradeDate(firstValue)
  const second = normalizeTradeDate(secondValue)

  if (!first || !second) {
    return false
  }

  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth()
  )
}

export function monthKey(value) {
  const date = normalizeTradeDate(value)

  if (!date) {
    return 'senza-data'
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function calculateRealizedTotals(history = []) {
  const trades = Array.isArray(history) ? history : []
  const wins = trades.filter((trade) => trade.result === 'WIN')
  const losses = trades.filter((trade) => trade.result === 'LOSS')
  const grossWins = wins.reduce(
    (sum, trade) => sum + Math.max(Number(trade.pnlEur || 0), 0),
    0,
  )
  const grossLosses = losses.reduce(
    (sum, trade) => sum + Math.abs(Math.min(Number(trade.pnlEur || 0), 0)),
    0,
  )

  return {
    closed: trades.length,
    grossLosses,
    grossWins,
    losses: losses.length,
    netPnl: grossWins - grossLosses,
    wins: wins.length,
  }
}

export function filterTradesByCurrentMonth(history = [], now = new Date()) {
  return history.filter((trade) => isSameLocalMonth(trade.exitDate, now))
}

export function filterTradesByToday(history = [], now = new Date()) {
  return history.filter((trade) => isSameLocalDay(trade.exitDate, now))
}

export function getMonthOptionsFromTrades(history = []) {
  const values = new Map()

  history.forEach((trade) => {
    const key = monthKey(trade.exitDate)

    if (key !== 'senza-data' && !values.has(key)) {
      values.set(key, key)
    }
  })

  return [...values.keys()].sort().reverse()
}

export function filterTradesByMonthKey(history = [], key) {
  if (!key || key === 'all') {
    return history
  }

  return history.filter((trade) => monthKey(trade.exitDate) === key)
}

export function groupTradesByDay(history = []) {
  return history.reduce((days, trade) => {
    const date = normalizeTradeDate(trade.exitDate)

    if (!date) {
      return days
    }

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(date.getDate()).padStart(2, '0')}`

    if (!days[key]) {
      days[key] = []
    }

    days[key].push(trade)
    return days
  }, {})
}
