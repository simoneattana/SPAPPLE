export function getEodhdApiKey() {
  return process.env.EODHD_API_KEY || process.env.EODHD_API_TOKEN || ''
}

export function isEodhdConfigured() {
  return Boolean(getEodhdApiKey())
}

export function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

export async function fetchEodhdJson(pathname, searchParams = {}) {
  const apiKey = getEodhdApiKey()

  if (!apiKey) {
    const error = new Error('Chiave EODHD non configurata')
    error.statusCode = 503
    throw error
  }

  const url = new URL(`https://eodhd.com/api/${pathname}`)
  url.searchParams.set('api_token', apiKey)
  url.searchParams.set('fmt', 'json')

  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, value)
    }
  })

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Spapple/1.0',
    },
  })
  const text = await response.text()

  if (!response.ok) {
    const error = new Error(text || `EODHD errore ${response.status}`)
    error.statusCode = response.status
    throw error
  }

  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('Risposta EODHD non valida')
    error.statusCode = 502
    throw error
  }
}
