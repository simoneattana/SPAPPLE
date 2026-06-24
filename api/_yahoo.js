let yahooAuth = null

export async function getYahooAuth() {
  if (yahooAuth) {
    return yahooAuth
  }

  const cookieResponse = await fetch('https://fc.yahoo.com', {
    redirect: 'manual',
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
  })
  const cookie = cookieResponse.headers.get('set-cookie')?.split(';')[0] ?? ''

  if (!cookie) {
    throw new Error('Cookie Yahoo non disponibile')
  }

  const crumbResponse = await fetch(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    {
      headers: {
        cookie,
        'user-agent': 'Mozilla/5.0',
      },
    },
  )
  const crumb = await crumbResponse.text()

  if (!crumbResponse.ok || !crumb || crumb.includes('Unauthorized')) {
    throw new Error('Crumb Yahoo non disponibile')
  }

  yahooAuth = { cookie, crumb }
  return yahooAuth
}

export function clearYahooAuth() {
  yahooAuth = null
}

export function sendText(response, statusCode, text, contentType = 'text/plain') {
  response.statusCode = statusCode
  response.setHeader('content-type', `${contentType}; charset=utf-8`)
  response.end(text)
}

export async function fetchYahooJson(url, headers = {}) {
  const yahooResponse = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0',
      ...headers,
    },
  })
  const text = await yahooResponse.text()

  return {
    ok: yahooResponse.ok,
    status: yahooResponse.status,
    text,
  }
}
