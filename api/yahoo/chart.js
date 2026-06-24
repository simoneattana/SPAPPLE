import { fetchYahooJson, sendText } from '../_yahoo.js'

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost')
  const symbol = requestUrl.searchParams.get('symbol')

  if (!symbol) {
    sendText(response, 400, 'Ticker Yahoo mancante')
    return
  }

  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  )
  yahooUrl.searchParams.set('range', '3mo')
  yahooUrl.searchParams.set('interval', '1d')

  try {
    const yahooResponse = await fetchYahooJson(yahooUrl)

    if (!yahooResponse.ok) {
      sendText(response, yahooResponse.status, yahooResponse.text)
      return
    }

    sendText(response, 200, yahooResponse.text, 'application/json')
  } catch (error) {
    sendText(response, 502, error.message || 'Yahoo non raggiungibile')
  }
}
