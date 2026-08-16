// Cron sospeso il 2026-08-16: il blocco "crons" e stato tolto da vercel.json
// finche geometria e modello costi non sono allineati al broker IBKR.
// Per riaccendere il pilota automatico: rimettere in vercel.json
//   "crons": [{ "path": "/api/cron/monitor", "schedule": "*/5 * * * *" }]
// L'endpoint resta invocabile a mano con il CRON_SECRET.
import {
  DEFAULT_MARKET_ID,
  getSupabaseClient,
  readTradingState,
  runBackendMonitor,
  sendJson,
  writeTradingState,
} from '../_tradingEngine.js'

const MONITORED_MARKETS = ['equities', 'usa', 'asia']
const DEFAULT_MARKETS_PER_RUN = 1

function isAuthorized(request) {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return false
  }

  return request.headers.authorization === `Bearer ${cronSecret}`
}

function timestamp(value) {
  const time = new Date(value || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

function getRequestUrl(request) {
  const host = request.headers.host || 'localhost'

  return new URL(request.url || '/api/cron/monitor', `https://${host}`)
}

function getRequestedMarkets(request) {
  const url = getRequestUrl(request)
  const requestedMarket = url.searchParams.get('market')
  const allMarketsRequested = url.searchParams.get('all') === '1'

  if (requestedMarket && MONITORED_MARKETS.includes(requestedMarket)) {
    return [requestedMarket]
  }

  if (allMarketsRequested) {
    return MONITORED_MARKETS
  }

  return null
}

function selectMarketsForRun(payload) {
  const now = Date.now()

  return MONITORED_MARKETS.map((marketId, index) => {
    const marketState = payload.markets?.[marketId] || {}
    const hasOpenPositions = (marketState.positions || []).length > 0
    const nextScanAt = timestamp(marketState.nextScanAt)
    const scanOverdueMs = nextScanAt > 0 ? Math.max(0, now - nextScanAt) : 0
    const lastBackendCheckAt = timestamp(marketState.lastBackendCheckAt)
    const backendStaleMs =
      lastBackendCheckAt > 0 ? now - lastBackendCheckAt : Number.MAX_SAFE_INTEGER

    return {
      marketId,
      score:
        (hasOpenPositions ? 1_000_000_000 : 0) +
        Math.min(scanOverdueMs, 120 * 60_000) +
        Math.min(backendStaleMs, 120 * 60_000) +
        (MONITORED_MARKETS.length - index),
    }
  })
    .sort((left, right) => right.score - left.score)
    .slice(0, DEFAULT_MARKETS_PER_RUN)
    .map((item) => item.marketId)
}

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    sendJson(response, 405, { error: 'Metodo non supportato' })
    return
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'Cron non autorizzato' })
    return
  }

  const supabase = getSupabaseClient()

  if (!supabase) {
    sendJson(response, 503, { error: 'Database Neon non configurato' })
    return
  }

  try {
    const { payload } = await readTradingState(supabase)
    const originalActiveMarket = payload.activeMarket || DEFAULT_MARKET_ID
    let nextPayload = payload
    const results = []

    const requestedMarkets = getRequestedMarkets(request)
    const marketsToMonitor = requestedMarkets || selectMarketsForRun(payload)

    for (const marketId of marketsToMonitor) {
      const marketState = nextPayload.markets?.[marketId] || {}
      const result = await runBackendMonitor({
        ...nextPayload,
        activeMarket: marketId,
        ...marketState,
      })
      const checkedAt = new Date().toISOString()
      const rawProcessedMarketState =
        result.state.markets?.[marketId] ||
        (result.state.marketId === marketId ? result.state : {})
      const { markets: _processedMarkets, ...processedMarketState } =
        rawProcessedMarketState

      nextPayload = {
        ...result.state,
        activeMarket: originalActiveMarket,
        markets: {
          ...(nextPayload.markets || {}),
          ...(result.state.markets || {}),
          [marketId]: {
            ...marketState,
            ...processedMarketState,
            lastBackendCheckAt: checkedAt,
            lastSyncAt: processedMarketState.lastSyncAt || checkedAt,
          },
        },
      }
      results.push({ marketId, ...result })
    }

    const activeMarketState = nextPayload.markets?.[originalActiveMarket] || {}
    nextPayload = {
      ...nextPayload,
      activeMarket: originalActiveMarket,
      ...activeMarketState,
    }

    const writeResult = await writeTradingState(supabase, nextPayload, {
      source: 'backend-monitor',
      summary: `Monitor backend eseguito su ${marketsToMonitor.join(', ')}.`,
    })

    sendJson(response, 200, {
      ok: true,
      checkedCount: results.reduce(
        (sum, result) => sum + (result.checkedCount || 0),
        0,
      ),
      closedCount: results.reduce(
        (sum, result) => sum + (result.closedTrades?.length || 0),
        0,
      ),
      openedCount: results.reduce(
        (sum, result) => sum + (result.openedTrades?.length || 0),
        0,
      ),
      markets: results.map((result) => ({
        marketId: result.marketId,
        checkedCount: result.checkedCount || 0,
        closedCount: result.closedTrades?.length || 0,
        openedCount: result.openedTrades?.length || 0,
        errors: result.errors || [],
      })),
      monitoredMarkets: marketsToMonitor,
      errors: results.flatMap((result) => result.errors || []),
      updatedAt: writeResult.updatedAt,
      stateRevision: writeResult.stateRevision,
    })
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || 'Monitor backend non riuscito',
    })
  }
}
