import {
  getSupabaseClient,
  readTradingState,
  runBackendMonitor,
  sendJson,
  writeTradingState,
} from '../_tradingEngine.js'

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
    const result = await runBackendMonitor(payload)
    await writeTradingState(supabase, result.state)

    sendJson(response, 200, {
      ok: true,
      checkedCount: result.checkedCount,
      closedCount: result.closedTrades.length,
      errors: result.errors || [],
      updatedAt: result.state.lastBackendCheckAt,
    })
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || 'Monitor backend non riuscito',
    })
  }
}
