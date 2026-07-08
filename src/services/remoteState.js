const STATE_ENDPOINT = '/api/state'
const APP_PASSWORD = 'alpha'

function normalizeRemoteError(message, status) {
  const text = String(message || '').trim()
  const statusLabel = status ? ` (${status})` : ''

  if (!text) {
    return `Backend remoto temporaneamente non disponibile${statusLabel}.`
  }

  if (
    text.includes('<!DOCTYPE') ||
    text.includes('<html') ||
    text.toLowerCase().includes('bad gateway')
  ) {
    return `Backend remoto temporaneamente non disponibile${statusLabel}. Riprovo in automatico.`
  }

  return text.length > 180 ? `${text.slice(0, 180)}...` : text
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  const rawText = await response.text()
  let data = {}

  if (contentType.includes('application/json') && rawText) {
    try {
      data = JSON.parse(rawText)
    } catch {
      throw new Error(
        normalizeRemoteError('Risposta JSON remota non valida', response.status),
      )
    }
  }

  if (!response.ok) {
    throw new Error(
      normalizeRemoteError(
        data.error || rawText || 'Stato remoto non disponibile',
        response.status,
      ),
    )
  }

  if (!contentType.includes('application/json')) {
    throw new Error(
      normalizeRemoteError(
        rawText || 'Risposta remota non valida',
        response.status,
      ),
    )
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
