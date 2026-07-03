import {
  DEFAULT_MARKET_ID,
  getSupabaseClient,
  readTradingState,
  runBackendMonitor,
  sendJson,
  writeTradingState,
} from '../_tradingEngine.js'

const MONITORED_MARKETS = ['equities', 'crypto']

function isAuthorized(request) {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return false
  }

  return request.headers.authorization === `Bearer ${cronSecret}`
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
    sendJson(response, 503, { error: 'Supabase non configurato' })
    return
  }

  try {
    const { payload } = await readTradingState(supabase)
    const originalActiveMarket = payload.activeMarket || DEFAULT_MARKET_ID
    let nextPayload = payload
    const results = []

    for (const marketId of MONITORED_MARKETS) {
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
      summary: 'Monitor backend eseguito su azioni e crypto.',
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
