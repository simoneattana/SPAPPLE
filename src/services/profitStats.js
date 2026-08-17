export function normalizeTradeDate(value) {
  // new Date(null) non da una data non valida: da il 1 gennaio 1970. Senza
  // questa guardia un'operazione senza data inventa una giornata di borsa.
  if (value === null || value === undefined || value === '') {
    return null
  }

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

// La numerosita vera di un campione di operazioni non e quante sono, e quante
// giornate distinte le hanno prodotte.
//
// Tredici posizioni aperte nello stesso giro sullo stesso mercato si muovono
// insieme: se quel giorno la borsa scende, vanno bene tutte e tredici per un
// motivo solo. Contarle come tredici prove separate e l'errore che ha fatto
// sembrare positivo uno storico che positivo non era.
export function calculateSampleSize(history = [], fallbackMarketId = null) {
  const trades = Array.isArray(history) ? history : []
  const giornate = new Set()

  for (const trade of trades) {
    const data = normalizeTradeDate(trade?.openedAt || trade?.exitDate)

    if (!data) {
      continue
    }

    const mercato = trade?.marketId || fallbackMarketId || 'n/d'
    giornate.add(`${mercato}-${data.toISOString().slice(0, 10)}`)
  }

  return {
    operazioni: trades.length,
    giornate: giornate.size,
    // Quante operazioni, in media, vengono dalla stessa giornata. Sopra 3 il
    // campione e molto piu piccolo di quanto sembri.
    perGiornata: giornate.size > 0 ? trades.length / giornate.size : 0,
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
