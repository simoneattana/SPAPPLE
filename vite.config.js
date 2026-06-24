import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function eodhdProxyPlugin(apiKey) {
  return {
    name: 'spapple-eodhd-proxy',
    configureServer(server) {
      server.middlewares.use('/api/eodhd/eod', async (request, response) => {
        const requestUrl = new URL(request.url, 'http://localhost')
        const symbol = requestUrl.searchParams.get('symbol')

        if (!apiKey) {
          response.statusCode = 500
          response.end('Chiave EODHD mancante')
          return
        }

        if (!symbol) {
          response.statusCode = 400
          response.end('Ticker EODHD mancante')
          return
        }

        const eodhdUrl = new URL(
          `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}`,
        )
        eodhdUrl.searchParams.set('api_token', apiKey)
        eodhdUrl.searchParams.set('fmt', 'json')
        eodhdUrl.searchParams.set('period', 'd')
        eodhdUrl.searchParams.set('order', 'a')

        try {
          const eodhdResponse = await fetch(eodhdUrl)
          const text = await eodhdResponse.text()

          if (!eodhdResponse.ok) {
            response.statusCode = eodhdResponse.status
            response.end(text || 'Richiesta EODHD fallita')
            return
          }

          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(text)
        } catch (error) {
          response.statusCode = 502
          response.end(error.message || 'EODHD non raggiungibile')
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), eodhdProxyPlugin(env.EODHD_API_KEY)],
  }
})
