import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import stateHandler from './api/state.js'
import chartHandler from './api/yahoo/chart.js'
import summaryHandler from './api/yahoo/summary.js'

function localApiPlugin() {
  return {
    name: 'spapple-local-api',
    configureServer(server) {
      server.middlewares.use('/api/state', stateHandler)
      server.middlewares.use('/api/yahoo/chart', chartHandler)
      server.middlewares.use('/api/yahoo/summary', summaryHandler)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApiPlugin()],
})
