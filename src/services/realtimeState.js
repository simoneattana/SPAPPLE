import { loadRemoteTradingState } from './remoteState'

const ACTIVE_POLL_INTERVAL_MS = 5_000
const INACTIVE_POLL_INTERVAL_MS = 15_000

export function isRealtimeConfigured() {
  return true
}

export function subscribeToStateEvents(onChange, onStatusChange = () => {}) {
  let active = true
  let timerId = null
  let lastRevision = null

  onStatusChange('SUBSCRIBED')

  async function checkState() {
    if (!active) {
      return
    }

    try {
      const data = await loadRemoteTradingState()
      const currentRevision =
        data?.stateRevision ?? data?.payload?.stateRevision ?? null

      if (currentRevision !== null) {
        if (lastRevision !== null && currentRevision !== lastRevision) {
          onChange({
            revision: currentRevision,
            source: data?.payload?.lastStateMutationSource || 'server',
            summary:
              data?.payload?.lastStateMutationSummary || 'Stato Spapple aggiornato',
          })
        }
        lastRevision = currentRevision
      }
    } catch {
      // Ignora errori di rete temporanei durante il polling in background
    }

    if (active) {
      const isVisible =
        typeof document !== 'undefined'
          ? document.visibilityState === 'visible'
          : true
      const delay = isVisible
        ? ACTIVE_POLL_INTERVAL_MS
        : INACTIVE_POLL_INTERVAL_MS
      timerId = setTimeout(checkState, delay)
    }
  }

  timerId = setTimeout(checkState, ACTIVE_POLL_INTERVAL_MS)

  return () => {
    active = false
    if (timerId) {
      clearTimeout(timerId)
    }
    onStatusChange('CLOSED')
  }
}
