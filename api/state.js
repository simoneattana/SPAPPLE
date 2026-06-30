import {
  getSupabaseClient,
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
      await writeTradingState(supabase, body.payload)
    } catch (error) {
      sendJson(response, 500, { error: error.message })
      return
    }

    sendJson(response, 200, { ok: true })
    return
  }

  sendJson(response, 405, { error: 'Metodo non supportato' })
}
