import { createClient } from '@supabase/supabase-js'
import { clearYahooAuth, fetchYahooJson, getYahooAuth } from './_yahoo.js'

export const STATE_ID = 'default'
export const STORAGE_VERSION = 4

const SLOT_SIZE = 2000

const initialState = {
  version: STORAGE_VERSION,
  capital: 30000,
  vault: 0,
  positions: [],
  history: [],
  activityLog: [],
  events: [],
  automationEnabled: true,
  liveMonitorEnabled: true,
  backendMonitorEnabled: true,
  lastScanAt: null,
  lastScanCount: 0,
  lastSignalCount: 0,
  lastScanResults: [],
  lastLiveCheckAt: null,
  lastBackendCheckAt: null,
  nextLiveCheckAt: null,
  engineStatus: 'In attesa',
}

export function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

export function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServerKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVER_KEY

  if (!supabaseUrl || !supabaseServerKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseServerKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export function normalizeTradingState(payload) {
  const state = payload && typeof payload === 'object' ? payload : {}
  const capital = Number(state.capital)
  const vault = Number(state.vault)

  return {
    ...initialState,
    ...state,
    version: STORAGE_VERSION,
    capital: Number.isFinite(capital) ? capital : initialState.capital,
    vault: Number.isFinite(vault) ? vault : initialState.vault,
    positions: Array.isArray(state.positions) ? state.positions : [],
    history: Array.isArray(state.history) ? state.history : [],
    activityLog: Array.isArray(state.activityLog) ? state.activityLog : [],
    events: Array.isArray(state.events) ? state.events : [],
    automationEnabled:
      typeof state.automationEnabled === 'boolean'
        ? state.automationEnabled
        : initialState.automationEnabled,
    liveMonitorEnabled:
      typeof state.liveMonitorEnabled === 'boolean'
        ? state.liveMonitorEnabled
        : initialState.liveMonitorEnabled,
    backendMonitorEnabled:
      typeof state.backendMonitorEnabled === 'boolean'
        ? state.backendMonitorEnabled
        : initialState.backendMonitorEnabled,
  }
}

function roundPrice(value) {
  return Number(value.toFixed(4))
}

function createActivity({ type = 'system', status = 'done', title, detail }) {
  return {
    id: `${type}-${Date.now()}-${crypto.randomUUID()}`,
    type,
    status,
    title,
    detail,
    createdAt: new Date().toISOString(),
  }
}

function appendLogs(state, activity) {
  return {
    activityLog: [activity, ...(state.activityLog || [])].slice(0, 14),
    events: [activity, ...(state.events || [])],
  }
}

async function fetchSummaryPrice(ticker) {
  const { cookie, crumb } = await getYahooAuth()
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`,
  )
  yahooUrl.searchParams.set('modules', 'price')
  yahooUrl.searchParams.set('crumb', crumb)

  const yahooResponse = await fetchYahooJson(yahooUrl, { cookie })

  if (!yahooResponse.ok) {
    clearYahooAuth()
    throw new Error(`${ticker}: prezzo Yahoo non disponibile`)
  }

  const data = JSON.parse(yahooResponse.text)
  const summary = data?.quoteSummary?.result?.[0]
  const price =
    summary?.price?.regularMarketPrice?.raw ??
    summary?.price?.postMarketPrice?.raw ??
    summary?.price?.preMarketPrice?.raw
  const number = Number(price)

  if (!Number.isFinite(number)) {
    throw new Error(`${ticker}: prezzo di mercato non valido`)
  }

  return number
}

async function fetchChartPrice(ticker) {
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  )
  yahooUrl.searchParams.set('range', '5d')
  yahooUrl.searchParams.set('interval', '1d')

  const yahooResponse = await fetchYahooJson(yahooUrl)

  if (!yahooResponse.ok) {
    throw new Error(`${ticker}: storico Yahoo non disponibile`)
  }

  const data = JSON.parse(yahooResponse.text)
  const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []
  const latestClose = [...closes].reverse().find((value) => value !== null)
  const number = Number(latestClose)

  if (!Number.isFinite(number)) {
    throw new Error(`${ticker}: ultimo prezzo non valido`)
  }

  return number
}

export async function fetchLatestMarketPrice(ticker) {
  try {
    return await fetchSummaryPrice(ticker)
  } catch {
    return fetchChartPrice(ticker)
  }
}

function evaluatePosition(position, latestPrice) {
  const quantity = position.invested / position.entryPrice
  const long = position.type === 'LONG'
  const pnlEur = long
    ? (latestPrice - position.entryPrice) * quantity
    : (position.entryPrice - latestPrice) * quantity
  const isWin = long
    ? latestPrice >= position.takeProfit
    : latestPrice <= position.takeProfit
  const isLoss = long
    ? latestPrice <= position.stopLoss
    : latestPrice >= position.stopLoss

  return {
    monitoredPosition: {
      ...position,
      latestPrice: roundPrice(latestPrice),
      unrealizedPnl: roundPrice(pnlEur),
    },
    closedTrade:
      isWin || isLoss
        ? {
            ticker: position.ticker,
            type: position.type,
            pnlEur: roundPrice(pnlEur),
            result: isWin ? 'WIN' : 'LOSS',
            exitDate: new Date().toISOString(),
            exitPrice: roundPrice(latestPrice),
          }
        : null,
  }
}

export async function runBackendMonitor(state) {
  const current = normalizeTradingState(state)

  if (!current.backendMonitorEnabled || !current.automationEnabled) {
    const activity = createActivity({
      type: 'backend-monitor',
      status: 'waiting',
      title: 'Monitor backend in pausa',
      detail: 'Il pilota automatico o il monitor backend non sono attivi.',
    })

    return {
      state: {
        ...current,
        lastBackendCheckAt: new Date().toISOString(),
        ...appendLogs(current, activity),
      },
      closedTrades: [],
      checkedCount: 0,
    }
  }

  if (current.positions.length === 0) {
    const activity = createActivity({
      type: 'backend-monitor',
      status: 'waiting',
      title: 'Monitor backend in attesa',
      detail: 'Controllo automatico eseguito: nessuna posizione aperta.',
    })

    return {
      state: {
        ...current,
        engineStatus: 'In attesa di nuova scansione',
        lastBackendCheckAt: new Date().toISOString(),
        ...appendLogs(current, activity),
      },
      closedTrades: [],
      checkedCount: 0,
    }
  }

  let capital = current.capital
  let vault = current.vault
  const activePositions = []
  const closedTrades = []
  const errors = []

  for (const position of current.positions) {
    try {
      const latestPrice = await fetchLatestMarketPrice(position.ticker)
      const { monitoredPosition, closedTrade } = evaluatePosition(
        position,
        latestPrice,
      )

      if (!closedTrade) {
        activePositions.push(monitoredPosition)
        continue
      }

      if (closedTrade.result === 'WIN') {
        capital += position.invested || SLOT_SIZE
        vault += Math.max(closedTrade.pnlEur, 0)
      } else {
        capital += Math.max(
          (position.invested || SLOT_SIZE) - Math.abs(closedTrade.pnlEur),
          0,
        )
      }

      closedTrades.push(closedTrade)
    } catch (error) {
      errors.push(`${position.ticker}: ${error.message}`)
      activePositions.push(position)
    }
  }

  const status = errors.length > 0 ? 'error' : closedTrades.length > 0 ? 'attention' : 'done'
  const activity = createActivity({
    type: 'backend-monitor',
    status,
    title:
      closedTrades.length > 0
        ? 'Uscita automatica backend'
        : 'Controllo backend completato',
    detail:
      errors.length > 0
        ? `${current.positions.length} posizioni controllate con ${errors.length} errori dati.`
        : closedTrades.length > 0
          ? `${closedTrades.length} posizioni chiuse automaticamente anche con app chiusa.`
          : `${current.positions.length} posizioni controllate. Nessun target o stop raggiunto.`,
  })

  return {
    state: {
      ...current,
      capital: roundPrice(capital),
      vault: roundPrice(vault),
      positions: activePositions,
      history: [...closedTrades, ...current.history],
      lastBackendCheckAt: new Date().toISOString(),
      lastLiveCheckAt: new Date().toISOString(),
      engineStatus:
        activePositions.length > 0
          ? 'Monitor backend attivo'
          : 'In attesa di nuova scansione',
      ...appendLogs(current, activity),
    },
    closedTrades,
    checkedCount: current.positions.length,
    errors,
  }
}

export async function readTradingState(supabase) {
  const { data, error } = await supabase
    .from('spapple_state')
    .select('payload, updated_at')
    .eq('id', STATE_ID)
    .maybeSingle()

  if (error) {
    throw error
  }

  return {
    payload: normalizeTradingState(data?.payload),
    updatedAt: data?.updated_at || null,
  }
}

export async function writeTradingState(supabase, payload) {
  const { error } = await supabase.from('spapple_state').upsert({
    id: STATE_ID,
    payload,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    throw error
  }
}
