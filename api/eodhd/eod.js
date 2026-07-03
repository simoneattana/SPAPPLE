import { fetchEodhdJson, sendJson } from '../_eodhd.js'

function getDefaultFromDate() {
  const date = new Date()
  date.setDate(date.getDate() - 120)
  return date.toISOString().slice(0, 10)
}

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost')
  const symbol = requestUrl.searchParams.get('symbol')

  if (!symbol) {
    sendJson(response, 400, { error: 'Ticker EODHD mancante' })
    return
  }

  try {
    const data = await fetchEodhdJson(`eod/${encodeURIComponent(symbol)}`, {
      period: 'd',
      order: 'a',
      from: requestUrl.searchParams.get('from') || getDefaultFromDate(),
      to: requestUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10),
    })

    sendJson(response, 200, data)
  } catch (error) {
    sendJson(response, error.statusCode || 502, {
      error: error.message || 'EODHD storico non disponibile',
    })
  }
}
