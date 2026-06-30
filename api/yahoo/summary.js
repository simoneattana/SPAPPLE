import {
  clearYahooAuth,
  fetchYahooJson,
  getYahooAuth,
  sendText,
} from '../_yahoo.js'

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost')
  const symbol = requestUrl.searchParams.get('symbol')

  if (!symbol) {
    sendText(response, 400, 'Ticker Yahoo mancante')
    return
  }

  try {
    const { cookie, crumb } = await getYahooAuth()
    const yahooUrl = new URL(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
    )
    yahooUrl.searchParams.set(
      'modules',
      'summaryDetail,defaultKeyStatistics,price,assetProfile',
    )
    yahooUrl.searchParams.set('crumb', crumb)

    const yahooResponse = await fetchYahooJson(yahooUrl, { cookie })

    if (!yahooResponse.ok) {
      clearYahooAuth()
      sendText(response, yahooResponse.status, yahooResponse.text)
      return
    }

    sendText(response, 200, yahooResponse.text, 'application/json')
  } catch (error) {
    clearYahooAuth()
    sendText(response, 502, error.message || 'Yahoo non raggiungibile')
  }
}
