import { createClient } from '@supabase/supabase-js'

const STATE_ID = 'default'

function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServerKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVER_KEY

  if (!supabaseUrl || !supabaseServerKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseServerKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

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
    const { data, error } = await supabase
      .from('spapple_state')
      .select('payload, updated_at')
      .eq('id', STATE_ID)
      .maybeSingle()

    if (error) {
      sendJson(response, 500, { error: error.message })
      return
    }

    sendJson(response, 200, {
      payload: data?.payload || null,
      updatedAt: data?.updated_at || null,
    })
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

    const { error } = await supabase.from('spapple_state').upsert({
      id: STATE_ID,
      payload: body.payload,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      sendJson(response, 500, { error: error.message })
      return
    }

    sendJson(response, 200, { ok: true })
    return
  }

  sendJson(response, 405, { error: 'Metodo non supportato' })
}
