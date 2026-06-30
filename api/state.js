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

    items.set(item.id, item)
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

    items.set(`${item.ticker}-${item.exitDate}`, item)
  })

  return [...items.values()].sort(
    (a, b) => timestamp(b.exitDate) - timestamp(a.exitDate),
  )
}

function mergeMarkets(mergedState, incoming, currentPayload, preserveBackendTrading) {
  const activeMarket = mergedState.activeMarket || DEFAULT_MARKET_ID
  const incomingMarkets = incoming.markets || {}
  const currentMarkets = currentPayload.markets || {}
  const activeMarketState = {
    ...(currentMarkets[activeMarket] || {}),
    ...(incomingMarkets[activeMarket] || {}),
    capital: mergedState.capital,
    vault: mergedState.vault,
    positions: mergedState.positions,
    history: mergedState.history,
    events: mergedState.events,
    activityLog: mergedState.activityLog,
    lastBackendCheckAt: mergedState.lastBackendCheckAt,
    backendMonitorEnabled: mergedState.backendMonitorEnabled,
  }

  if (preserveBackendTrading && currentMarkets[activeMarket]) {
    activeMarketState.lastScanAt =
      currentMarkets[activeMarket].lastScanAt || activeMarketState.lastScanAt
    activeMarketState.lastScanCount =
      currentMarkets[activeMarket].lastScanCount ?? activeMarketState.lastScanCount
    activeMarketState.lastSignalCount =
      currentMarkets[activeMarket].lastSignalCount ??
      activeMarketState.lastSignalCount
    activeMarketState.lastScanResults =
      currentMarkets[activeMarket].lastScanResults ||
      activeMarketState.lastScanResults
  }

  return {
    ...currentMarkets,
    ...incomingMarkets,
    [activeMarket]: activeMarketState,
  }
}

async function mergeIncomingState(supabase, incomingPayload) {
  const { payload: currentPayload } = await readTradingState(supabase)
  const incoming = normalizeTradingState(incomingPayload)
  const currentBackendTime = timestamp(currentPayload.lastBackendCheckAt)
  const incomingBackendTime = timestamp(incoming.lastBackendCheckAt)
  const preserveBackendTrading = currentBackendTime > incomingBackendTime

  const mergedState = {
    ...currentPayload,
    ...incoming,
    capital: preserveBackendTrading ? currentPayload.capital : incoming.capital,
    vault: preserveBackendTrading ? currentPayload.vault : incoming.vault,
    positions: preserveBackendTrading
      ? currentPayload.positions
      : incoming.positions,
    history: mergeHistory(incoming.history, currentPayload.history),
    events: mergeById(incoming.events, currentPayload.events),
    activityLog: mergeById(incoming.activityLog, currentPayload.activityLog).slice(
      0,
      14,
    ),
    backendMonitorEnabled:
      typeof incomingPayload.backendMonitorEnabled === 'boolean'
        ? incoming.backendMonitorEnabled
        : currentPayload.backendMonitorEnabled,
    lastBackendCheckAt:
      currentBackendTime > incomingBackendTime
        ? currentPayload.lastBackendCheckAt
        : incoming.lastBackendCheckAt,
  }

  return {
    ...mergedState,
    markets: mergeMarkets(
      mergedState,
      incoming,
      currentPayload,
      preserveBackendTrading,
    ),
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
      const mergedPayload = await mergeIncomingState(supabase, body.payload)
      await writeTradingState(supabase, mergedPayload)
    } catch (error) {
      sendJson(response, 500, { error: error.message })
      return
    }

    sendJson(response, 200, { ok: true })
    return
  }

  sendJson(response, 405, { error: 'Metodo non supportato' })
}
