const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

let realtimeClient = null

export function isRealtimeConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

async function getRealtimeClient() {
  if (!isRealtimeConfigured()) {
    return null
  }

  if (!realtimeClient) {
    const { createClient } = await import('@supabase/supabase-js')

    realtimeClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }

  return realtimeClient
}

export function subscribeToStateEvents(onChange, onStatusChange = () => {}) {
  if (!isRealtimeConfigured()) {
    onStatusChange('non_configurato')
    return () => {}
  }

  let channel = null
  let active = true

  getRealtimeClient()
    .then((client) => {
      if (!client || !active) {
        return
      }

      channel = client
        .channel('spapple-state-events')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'spapple_state_events',
            filter: 'state_id=eq.default',
          },
          (payload) => {
            onChange(payload.new)
          },
        )
        .subscribe((status) => {
          onStatusChange(status)
        })
    })
    .catch((error) => {
      onStatusChange(`errore: ${error.message}`)
    })

  return () => {
    active = false

    if (realtimeClient && channel) {
      realtimeClient.removeChannel(channel)
    }
  }
}
