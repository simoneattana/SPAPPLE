import { fetchEodhdJson, sendJson } from '../_eodhd.js'

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost')
  const symbol = requestUrl.searchParams.get('symbol')

  if (!symbol) {
    sendJson(response, 400, { error: 'Ticker EODHD mancante' })
    return
  }

  try {
    const data = await fetchEodhdJson(`fundamentals/${encodeURIComponent(symbol)}`, {
      filter: requestUrl.searchParams.get('filter') || '',
    })

    sendJson(response, 200, data)
  } catch (error) {
    sendJson(response, error.statusCode || 502, {
      error: error.message || 'EODHD fondamentali non disponibili',
    })
  }
}
