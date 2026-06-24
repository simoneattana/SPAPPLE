import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

let yahooAuth = null

async function getYahooAuth() {
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

async function proxyYahooJson(response, url, headers = {}) {
  const yahooResponse = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0',
      ...headers,
    },
  })
  const text = await yahooResponse.text()

  if (!yahooResponse.ok) {
    response.statusCode = yahooResponse.status
    response.end(text || 'Richiesta Yahoo fallita')
    return
  }

  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(text)
}

function yahooProxyPlugin() {
  return {
    name: 'spapple-yahoo-proxy',
    configureServer(server) {
      server.middlewares.use('/api/yahoo/chart', async (request, response) => {
        const requestUrl = new URL(request.url, 'http://localhost')
        const symbol = requestUrl.searchParams.get('symbol')

        if (!symbol) {
          response.statusCode = 400
          response.end('Ticker Yahoo mancante')
          return
        }

        const yahooUrl = new URL(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
        )
        yahooUrl.searchParams.set('range', '3mo')
        yahooUrl.searchParams.set('interval', '1d')

        try {
          await proxyYahooJson(response, yahooUrl)
        } catch (error) {
          response.statusCode = 502
          response.end(error.message || 'Yahoo non raggiungibile')
        }
      })

      server.middlewares.use('/api/yahoo/summary', async (request, response) => {
        const requestUrl = new URL(request.url, 'http://localhost')
        const symbol = requestUrl.searchParams.get('symbol')

        if (!symbol) {
          response.statusCode = 400
          response.end('Ticker Yahoo mancante')
          return
        }

        try {
          const { cookie, crumb } = await getYahooAuth()
          const yahooUrl = new URL(
            `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
          )
          yahooUrl.searchParams.set(
            'modules',
            'summaryDetail,defaultKeyStatistics,price',
          )
          yahooUrl.searchParams.set('crumb', crumb)

          await proxyYahooJson(response, yahooUrl, { cookie })
        } catch (error) {
          yahooAuth = null
          response.statusCode = 502
          response.end(error.message || 'Yahoo non raggiungibile')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), yahooProxyPlugin()],
})
