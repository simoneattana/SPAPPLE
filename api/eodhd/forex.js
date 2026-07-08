import { fetchEodhdJson, sendJson } from '../_eodhd.js'

function normalizePair(pair) {
  return String(pair || '')
    .replace(/[^a-z]/gi, '')
    .toUpperCase()
}

function extractRate(data, pair) {
  const rate =
    data?.close ??
    data?.adjusted_close ??
    data?.previousClose ??
    data?.last ??
    data?.price

  const number = Number(rate)

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${pair}: cambio EODHD non disponibile`)
  }

  return number
}

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost')
  const from = normalizePair(requestUrl.searchParams.get('from'))
  const to = normalizePair(requestUrl.searchParams.get('to') || 'EUR')

  if (!from || !to || from.length !== 3 || to.length !== 3) {
    sendJson(response, 400, { error: 'Coppia Forex non valida' })
    return
  }

  if (from === to) {
    sendJson(response, 200, {
      from,
      to,
      pair: `${from}${to}.FOREX`,
      rate: 1,
      inverted: false,
      provider: 'EODHD',
    })
    return
  }

  const directPair = `${from}${to}.FOREX`
  const inversePair = `${to}${from}.FOREX`

  try {
    const data = await fetchEodhdJson(`real-time/${directPair}`)
    const rate = extractRate(data, directPair)

    sendJson(response, 200, {
      from,
      to,
      pair: directPair,
      rate,
      inverted: false,
      provider: 'EODHD',
      timestamp: data?.timestamp || null,
    })
  } catch (directError) {
    try {
      const data = await fetchEodhdJson(`real-time/${inversePair}`)
      const inverseRate = extractRate(data, inversePair)

      sendJson(response, 200, {
        from,
        to,
        pair: inversePair,
        rate: 1 / inverseRate,
        inverted: true,
        provider: 'EODHD',
        timestamp: data?.timestamp || null,
      })
    } catch (inverseError) {
      sendJson(response, inverseError.statusCode || directError.statusCode || 502, {
        error:
          inverseError.message ||
          directError.message ||
          `${from}/${to}: cambio EODHD non disponibile`,
      })
    }
  }
}
