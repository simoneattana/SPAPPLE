import {
  DEFAULT_MARKET_ID,
  getSupabaseClient,
  normalizeTradingState,
  readTradingState,
  sendJson,
  writeTradingState,
} from './_tradingEngine.js'

function isAuthorized(request) {
  const expectedPassword = process.env.SPAPPLE_APP_PASSWORD || 'alpha'
  return request.headers['x-spapple-password'] === expectedPassword
}

async function readRequestBody(request) {
  if (request.body && typeof request.body === 'object') {
    return request.body
  }

  if (typeof request.body === 'string') {
    return JSON.parse(request.body || '{}')
  }

  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function timestamp(value) {
  const time = new Date(value || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

function mergeById(first = [], second = []) {
  const items = new Map()

  ;[...first, ...second].forEach((item) => {
    if (!item?.id) {
      return
    }

    const key =
      item.action === 'CLOSE' && item.positionId
        ? `close-${item.positionId}`
        : `item-${item.id}`
    const current = items.get(key)

    if (!current || timestamp(item.createdAt) > timestamp(current.createdAt)) {
      items.set(key, item)
    }
  })

  return [...items.values()].sort(
    (a, b) => timestamp(b.createdAt) - timestamp(a.createdAt),
  )
}

function mergeHistory(first = [], second = []) {
  const items = new Map()

  ;[...first, ...second].forEach((item) => {
    if (!item?.ticker || !item?.exitDate) {
      return
    }

    const key = item.positionId
      ? `position-${item.positionId}`
      : `${item.ticker}-${item.exitDate}`
    const current = items.get(key)

    if (!current || timestamp(item.exitDate) > timestamp(current.exitDate)) {
      items.set(key, item)
    }
  })

  return [...items.values()].sort(
    (a, b) => timestamp(b.exitDate) - timestamp(a.exitDate),
  )
}

function mergePositions(incomingPositions = [], currentPositions = [], history = []) {
  const positionsById = new Map()

  ;[...currentPositions, ...incomingPositions].forEach((position) => {
    if (!position?.id) {
      return
    }

    positionsById.set(position.id, position)
  })

  const closedPositionIds = new Set(
    history
      .map((trade) => trade?.positionId)
      .filter(Boolean),
  )
  const closedTickerDates = new Set(
    history
      .filter((trade) => trade?.ticker && trade?.openedAt)
      .map((trade) => `${trade.ticker}-${trade.openedAt}`),
  )

  return [...positionsById.values()].filter((position) => {
    if (closedPositionIds.has(position.id)) {
      return false
    }

    if (position?.ticker && position?.openedAt) {
      return !closedTickerDates.has(`${position.ticker}-${position.openedAt}`)
    }

    return true
  })
}

function roundPrice(value) {
  return Number(value.toFixed(4))
}

function calculateVaultFromHistory(history = []) {
  return history.reduce((total, trade) => {
    const pnl = Number(trade?.pnlEur)

    if (trade?.result !== 'WIN' || !Number.isFinite(pnl) || pnl <= 0) {
      return total
    }

    return total + pnl
  }, 0)
}

function latestTimestamp(first, second) {
  return timestamp(first) >= timestamp(second) ? first : second
}

function mergeMarketState(incomingMarket = {}, currentMarket = {}) {
  const history = mergeHistory(incomingMarket.history, currentMarket.history)
  const orders = mergeById(incomingMarket.orders, currentMarket.orders)
  const positions = mergePositions(
    incomingMarket.positions,
    currentMarket.positions,
    history,
  )
  const vault =
    history.length > 0
      ? calculateVaultFromHistory(history)
      : Math.max(
          Number.isFinite(Number(incomingMarket.vault))
            ? Number(incomingMarket.vault)
            : 0,
          Number.isFinite(Number(currentMarket.vault))
            ? Number(currentMarket.vault)
            : 0,
        )

  return {
    ...currentMarket,
    ...incomingMarket,
    vault: roundPrice(vault),
    positions,
    history,
    orders,
    events: mergeById(incomingMarket.events, currentMarket.events),
    activityLog: mergeById(
      incomingMarket.activityLog,
      currentMarket.activityLog,
    ).slice(0, 14),
    lastBackendCheckAt: latestTimestamp(
      incomingMarket.lastBackendCheckAt,
      currentMarket.lastBackendCheckAt,
    ),
    backendMonitorEnabled:
      typeof incomingMarket.backendMonitorEnabled === 'boolean'
        ? incomingMarket.backendMonitorEnabled
        : currentMarket.backendMonitorEnabled,
  }
}

function mergeMarkets(incoming, currentPayload) {
  const incomingMarkets = incoming.markets || {}
  const currentMarkets = currentPayload.markets || {}
  const marketIds = new Set([
    DEFAULT_MARKET_ID,
    incoming.activeMarket || DEFAULT_MARKET_ID,
    currentPayload.activeMarket || DEFAULT_MARKET_ID,
    ...Object.keys(currentMarkets),
    ...Object.keys(incomingMarkets),
  ])
  const mergedMarkets = {}

  marketIds.forEach((marketId) => {
    mergedMarkets[marketId] = mergeMarketState(
      incomingMarkets[marketId],
      currentMarkets[marketId],
    )
  })

  return mergedMarkets
}

async function mergeIncomingState(supabase, incomingPayload) {
  const { payload: currentPayload } = await readTradingState(supabase)
  const incoming = normalizeTradingState(incomingPayload)
  const markets = mergeMarkets(incoming, currentPayload)
  const activeMarket = incoming.activeMarket || DEFAULT_MARKET_ID
  const activeMarketState = markets[activeMarket] || {}

  return {
    ...currentPayload,
    ...incoming,
    activeMarket,
    markets,
    ...activeMarketState,
    history: activeMarketState.history || [],
    events: activeMarketState.events || [],
    activityLog: activeMarketState.activityLog || [],
    backendMonitorEnabled:
      typeof activeMarketState.backendMonitorEnabled === 'boolean'
        ? activeMarketState.backendMonitorEnabled
        : true,
    lastBackendCheckAt: activeMarketState.lastBackendCheckAt || null,
  }
}

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, {
      error: 'Accesso non autorizzato allo stato remoto',
    })
    return
  }

  const supabase = getSupabaseClient()

  if (!supabase) {
    sendJson(response, 503, {
      error: 'Supabase non configurato',
    })
    return
  }

  if (request.method === 'GET') {
    try {
      const { payload, updatedAt } = await readTradingState(supabase)

      sendJson(response, 200, {
        payload,
        updatedAt,
      })
    } catch (error) {
      sendJson(response, 500, { error: error.message })
    }

    return
  }

  if (request.method === 'PUT') {
    let body

    try {
      body = await readRequestBody(request)
    } catch {
      sendJson(response, 400, { error: 'Payload JSON non valido' })
      return
    }

    if (!body?.payload || typeof body.payload !== 'object') {
      sendJson(response, 400, { error: 'Stato Spapple mancante' })
      return
    }

    try {
      const nextPayload =
        body.reset === true
          ? normalizeTradingState(body.payload)
          : await mergeIncomingState(supabase, body.payload)

      await writeTradingState(supabase, nextPayload)
    } catch (error) {
      sendJson(response, 500, { error: error.message })
      return
    }

    sendJson(response, 200, { ok: true })
    return
  }

  sendJson(response, 405, { error: 'Metodo non supportato' })
}
