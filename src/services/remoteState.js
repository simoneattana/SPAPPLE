const STATE_ENDPOINT = '/api/state'
const APP_PASSWORD = 'alpha'

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || 'Stato remoto non disponibile')
  }

  return data
}

export async function loadRemoteTradingState() {
  const response = await fetch(STATE_ENDPOINT, {
    method: 'GET',
    headers: {
      'x-spapple-password': APP_PASSWORD,
    },
  })

  return parseResponse(response)
}

export async function saveRemoteTradingState(
  payload,
  { reset = false, source = 'frontend', summary = 'Stato aggiornato dal browser.' } = {},
) {
  const response = await fetch(STATE_ENDPOINT, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-spapple-password': APP_PASSWORD,
    },
    body: JSON.stringify({ payload, reset, source, summary }),
  })

  return parseResponse(response)
}
