export default async function handler(request, response) {
  const pair = String(request.query.pair || '').trim()
  const interval = String(request.query.interval || '1440').trim()

  if (!pair) {
    response.status(400).json({ error: 'Coppia Kraken mancante' })
    return
  }

  const krakenUrl = new URL('https://api.kraken.com/0/public/OHLC')
  krakenUrl.searchParams.set('pair', pair)
  krakenUrl.searchParams.set('interval', interval)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const krakenResponse = await fetch(krakenUrl, { signal: controller.signal })
    const payload = await krakenResponse.json()

    if (!krakenResponse.ok || payload.error?.length) {
      response.status(krakenResponse.ok ? 502 : krakenResponse.status).json({
        error:
          payload.error?.join(', ') ||
          'Kraken non ha restituito dati utilizzabili',
      })
      return
    }

    response.status(200).json(payload)
  } catch (error) {
    response.status(502).json({
      error:
        error.name === 'AbortError'
          ? 'Kraken non ha risposto entro il tempo massimo'
          : error.message || 'Connessione Kraken non riuscita',
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
