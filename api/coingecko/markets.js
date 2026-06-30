function getApiKey() {
  return process.env.COINGECKO_API_KEY || process.env.CG_API_KEY || ''
}

export default async function handler(request, response) {
  const ids = String(request.query.ids || '').trim()
  const currency = String(request.query.vs_currency || 'eur').trim()

  if (!ids) {
    response.status(400).json({ error: 'Lista CoinGecko mancante' })
    return
  }

  const apiKey = getApiKey()

  if (!apiKey) {
    response.status(503).json({
      error: 'Chiave CoinGecko non configurata sul server',
    })
    return
  }

  const coingeckoUrl = new URL('https://api.coingecko.com/api/v3/coins/markets')
  coingeckoUrl.searchParams.set('vs_currency', currency)
  coingeckoUrl.searchParams.set('ids', ids)
  coingeckoUrl.searchParams.set('order', 'market_cap_desc')
  coingeckoUrl.searchParams.set('per_page', '250')
  coingeckoUrl.searchParams.set('page', '1')
  coingeckoUrl.searchParams.set('sparkline', 'false')
  coingeckoUrl.searchParams.set('price_change_percentage', '24h,7d')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 7000)

  try {
    const coingeckoResponse = await fetch(coingeckoUrl, {
      headers: {
        accept: 'application/json',
        'x-cg-demo-api-key': apiKey,
      },
      signal: controller.signal,
    })
    const payload = await coingeckoResponse.json()

    if (!coingeckoResponse.ok) {
      response.status(coingeckoResponse.status).json({
        error:
          payload?.error ||
          payload?.status?.error_message ||
          'CoinGecko non ha restituito dati utilizzabili',
      })
      return
    }

    response.status(200).json(payload)
  } catch (error) {
    response.status(502).json({
      error:
        error.name === 'AbortError'
          ? 'CoinGecko non ha risposto entro il tempo massimo'
          : error.message || 'Connessione CoinGecko non riuscita',
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
