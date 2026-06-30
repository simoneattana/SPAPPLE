import { createClient } from '@supabase/supabase-js'
import { ATR, RSI } from 'technicalindicators'
import { EUROPEAN_TICKERS } from '../src/services/marketUniverse.js'
import {
  isActionableResult,
  isAutoEligibleResult,
  sortByAutoScore,
} from '../src/services/tradingRules.js'
import { clearYahooAuth, fetchYahooJson, getYahooAuth } from './_yahoo.js'

export const STATE_ID = 'default'
export const STORAGE_VERSION = 4

const SLOT_SIZE = 2000
const MAX_POSITIONS = 5
const MIN_HISTORY_LENGTH = 30
const RSI_PERIOD = 14
const ATR_PERIOD = 14
const REQUEST_CONCURRENCY = 8

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

function assertNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`${label} non disponibile`)
  }

  return number
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

async function fetchChartHistory(ticker) {
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  )
  yahooUrl.searchParams.set('range', '3mo')
  yahooUrl.searchParams.set('interval', '1d')

  const yahooResponse = await fetchYahooJson(yahooUrl)

  if (!yahooResponse.ok) {
    throw new Error(`${ticker}: storico Yahoo non disponibile`)
  }

  const data = JSON.parse(yahooResponse.text)
  const result = data?.chart?.result?.[0]
  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0]

  if (!Array.isArray(timestamps) || !quote) {
    throw new Error(`${ticker}: storico giornaliero non valido`)
  }

  const history = timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: quote.close?.[index],
    }))
    .filter((bar) => bar.high !== null && bar.low !== null && bar.close !== null)
    .map((bar) => ({
      date: bar.date,
      high: assertNumber(bar.high, `${ticker}: massimo`),
      low: assertNumber(bar.low, `${ticker}: minimo`),
      close: assertNumber(bar.close, `${ticker}: chiusura`),
    }))

  if (history.length < MIN_HISTORY_LENGTH) {
    throw new Error(`${ticker}: storico giornaliero insufficiente`)
  }

  return history
}

async function fetchSummaryData(ticker) {
  const { cookie, crumb } = await getYahooAuth()
  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`,
  )
  yahooUrl.searchParams.set(
    'modules',
    'summaryDetail,defaultKeyStatistics,price,assetProfile',
  )
  yahooUrl.searchParams.set('crumb', crumb)

  const yahooResponse = await fetchYahooJson(yahooUrl, { cookie })

  if (!yahooResponse.ok) {
    clearYahooAuth()
    throw new Error(`${ticker}: fondamentali Yahoo non disponibili`)
  }

  return JSON.parse(yahooResponse.text)
}

function extractPeRatio(summaryData, ticker) {
  const summary = summaryData?.quoteSummary?.result?.[0]
  const pe =
    summary?.summaryDetail?.trailingPE?.raw ??
    summary?.defaultKeyStatistics?.trailingPE?.raw ??
    summary?.summaryDetail?.forwardPE?.raw

  const peNumber = assertNumber(pe, `${ticker}: P/E`)

  if (peNumber <= 0) {
    throw new Error(`${ticker}: P/E non profittevole`)
  }

  return peNumber
}

function calculateIndicators(history, ticker) {
  const high = history.map((bar) => bar.high)
  const low = history.map((bar) => bar.low)
  const close = history.map((bar) => bar.close)
  const rsi = RSI.calculate({ values: close, period: RSI_PERIOD }).at(-1)
  const atr = ATR.calculate({ high, low, close, period: ATR_PERIOD }).at(-1)

  return {
    rsi: assertNumber(rsi, `${ticker}: RSI`),
    atr: assertNumber(atr, `${ticker}: ATR`),
  }
}

function getDiagnostic(row) {
  if (row.status === 'error') {
    return row.reason || 'Dati non disponibili'
  }

  if (row.pe <= 0) {
    return 'Scartato: P/E assente, nullo o negativo'
  }

  if (row.rsi >= 30 && row.rsi <= 70) {
    return 'Scartato: RSI in zona neutrale'
  }

  if (row.rsi < 30) {
    return 'Ammesso: società profittevole e RSI sotto 30'
  }

  return 'Ammesso: società profittevole e RSI sopra 70'
}

async function fetchTickerDiagnostic(ticker) {
  try {
    const [history, summaryData] = await Promise.all([
      fetchChartHistory(ticker),
      fetchSummaryData(ticker),
    ])
    const latestBar = history.at(-1)
    const pe = extractPeRatio(summaryData, ticker)
    const { rsi, atr } = calculateIndicators(history, ticker)
    const row = {
      ticker,
      profile: null,
      currentPrice: latestBar.close,
      pe,
      rsi,
      atr,
      status: 'ok',
    }

    return {
      ...row,
      reason: getDiagnostic(row),
    }
  } catch (error) {
    return {
      ticker,
      profile: null,
      currentPrice: null,
      pe: null,
      rsi: null,
      atr: null,
      status: 'error',
      reason: getDiagnostic({
        status: 'error',
        reason: error.message || `${ticker}: dati non disponibili`,
      }),
    }
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = []

  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit)
    const batchResults = await Promise.all(batch.map(mapper))
    results.push(...batchResults)
  }

  return results
}

async function fetchBackendMarketData() {
  return mapWithConcurrency(
    EUROPEAN_TICKERS,
    REQUEST_CONCURRENCY,
    fetchTickerDiagnostic,
  )
}

function buildTrade(row) {
  const atrPct = (row.atr / row.currentPrice) * 100
  const targetPct = atrPct < 1.5 ? 0.3 : 0.5
  const long = row.rsi < 30
  const type = long ? 'LONG' : 'SHORT'
  const openedAt = new Date().toISOString()

  return {
    id: `${row.ticker}-${type}-${Date.now()}-${crypto.randomUUID()}`,
    ticker: row.ticker,
    profile: row.profile || null,
    type,
    openedAt,
    entryPrice: roundPrice(row.currentPrice),
    atrAtEntry: roundPrice(row.atr),
    takeProfit: roundPrice(
      long
        ? row.currentPrice * (1 + targetPct / 100)
        : row.currentPrice * (1 - targetPct / 100),
    ),
    stopLoss: roundPrice(
      long ? row.currentPrice - row.atr * 1.5 : row.currentPrice + row.atr * 1.5,
    ),
    daysHeld: 0,
    invested: SLOT_SIZE,
    targetPct,
  }
}

async function refillOpenSlots(state, excludedTickers = []) {
  const marketData = await fetchBackendMarketData()
  const actionableRows = marketData.filter(isActionableResult)
  const excluded = new Set([
    ...excludedTickers,
    ...state.positions.map((position) => position.ticker),
  ])
  const automaticRows = sortByAutoScore(
    marketData.filter(
      (row) => isAutoEligibleResult(row) && !excluded.has(row.ticker),
    ),
  )
  const positions = [...state.positions]
  const openedTrades = []
  let capital = state.capital

  automaticRows.forEach((row) => {
    if (positions.length >= MAX_POSITIONS || capital < SLOT_SIZE) {
      return
    }

    const trade = buildTrade(row)
    positions.push(trade)
    capital -= SLOT_SIZE
    openedTrades.push(trade)
  })

  return {
    capital: roundPrice(capital),
    positions,
    openedTrades,
    marketData,
    scannedCount: marketData.length,
    signalCount: actionableRows.length,
  }
}

function evaluatePosition(position, latestPrice) {
  const invested = position.invested || SLOT_SIZE
  const quantity = invested / position.entryPrice
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
  const roundedPnl = roundPrice(pnlEur)
  const recoveredCapital = Math.max(invested + roundedPnl, 0)

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
            openedAt: position.openedAt || null,
            entryPrice: position.entryPrice,
            invested,
            pnlEur: roundedPnl,
            result: isWin ? 'WIN' : 'LOSS',
            exitDate: new Date().toISOString(),
            exitPrice: roundPrice(latestPrice),
            exitReason: isWin ? 'TAKE_PROFIT' : 'STOP_LOSS',
            recoveredCapital: roundPrice(recoveredCapital),
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
    const refillErrors = []
    let refill = null

    if (current.capital >= SLOT_SIZE) {
      try {
        refill = await refillOpenSlots(current)
      } catch (error) {
        refillErrors.push(error.message || 'Ricerca nuovi titoli non riuscita')
      }
    }

    const openedTrades = refill?.openedTrades || []
    const activity = createActivity({
      type: 'backend-monitor',
      status:
        refillErrors.length > 0
          ? 'error'
          : openedTrades.length > 0
            ? 'attention'
            : 'waiting',
      title:
        openedTrades.length > 0
          ? 'Nuovi slot aperti dal backend'
          : 'Ricerca automatica completata',
      detail:
        refillErrors.length > 0
          ? `Nessuna posizione aperta. Ricerca nuovi titoli non riuscita: ${refillErrors[0]}.`
          : openedTrades.length > 0
            ? `Nessuna posizione era aperta: ho trovato ${openedTrades.length} segnali e ho riaperto nuovi slot.`
            : `Nessuna posizione aperta. ${
                refill
                  ? `${refill.scannedCount} titoli scansionati, ${refill.signalCount} segnali trovati, nessuno abbastanza forte per il pilota.`
                  : 'Capitale operativo insufficiente per aprire nuovi slot.'
              }`,
    })

    return {
      state: {
        ...current,
        capital: refill ? refill.capital : current.capital,
        positions: refill ? refill.positions : current.positions,
        ...(refill
          ? {
              lastScanAt: new Date().toISOString(),
              lastScanCount: refill.scannedCount,
              lastSignalCount: refill.signalCount,
              lastScanResults: refill.marketData,
            }
          : {}),
        engineStatus:
          openedTrades.length > 0
            ? 'Slot riempiti dal backend'
            : 'Nessun segnale automatico disponibile',
        lastBackendCheckAt: new Date().toISOString(),
        ...appendLogs(current, activity),
      },
      closedTrades: [],
      openedTrades,
      checkedCount: 0,
      errors: refillErrors,
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
        capital += closedTrade.invested || SLOT_SIZE
        vault += Math.max(closedTrade.pnlEur, 0)
      } else {
        capital += closedTrade.recoveredCapital || 0
      }

      closedTrades.push(closedTrade)
    } catch (error) {
      errors.push(`${position.ticker}: ${error.message}`)
      activePositions.push(position)
    }
  }

  const refillErrors = []
  let openedTrades = []
  let scanPatch = {}

  if (
    closedTrades.length > 0 &&
    activePositions.length < MAX_POSITIONS &&
    capital >= SLOT_SIZE
  ) {
    try {
      const refill = await refillOpenSlots(
        {
          ...current,
          capital,
          positions: activePositions,
        },
        closedTrades.map((trade) => trade.ticker),
      )

      capital = refill.capital
      activePositions.splice(0, activePositions.length, ...refill.positions)
      openedTrades = refill.openedTrades
      scanPatch = {
        lastScanAt: new Date().toISOString(),
        lastScanCount: refill.scannedCount,
        lastSignalCount: refill.signalCount,
        lastScanResults: refill.marketData,
      }
    } catch (error) {
      refillErrors.push(error.message || 'Ricerca nuovi titoli non riuscita')
    }
  }

  const status =
    errors.length > 0 || refillErrors.length > 0
      ? 'error'
      : closedTrades.length > 0 || openedTrades.length > 0
        ? 'attention'
        : 'done'
  const activity = createActivity({
    type: 'backend-monitor',
    status,
    title:
      openedTrades.length > 0
        ? 'Rotazione automatica completata'
        : closedTrades.length > 0
        ? 'Uscita automatica backend'
        : 'Controllo backend completato',
    detail:
      errors.length > 0 || refillErrors.length > 0
        ? `${current.positions.length} posizioni controllate con ${
            errors.length + refillErrors.length
          } errori dati.`
        : openedTrades.length > 0
          ? `${closedTrades.length} posizioni chiuse e ${openedTrades.length} nuovi slot aperti automaticamente.`
          : closedTrades.length > 0
            ? `${closedTrades.length} posizioni chiuse automaticamente. Nessun nuovo titolo abbastanza forte.`
          : `${current.positions.length} posizioni controllate. Nessun target o stop raggiunto.`,
  })

  return {
    state: {
      ...current,
      capital: roundPrice(capital),
      vault: roundPrice(vault),
      positions: activePositions,
      history: [...closedTrades, ...current.history],
      ...scanPatch,
      lastBackendCheckAt: new Date().toISOString(),
      lastLiveCheckAt: new Date().toISOString(),
      engineStatus:
        openedTrades.length > 0
          ? 'Slot riempiti dal backend'
          : activePositions.length > 0
          ? 'Monitor backend attivo'
          : 'In attesa di nuova scansione',
      ...appendLogs(current, activity),
    },
    closedTrades,
    openedTrades,
    checkedCount: current.positions.length,
    errors: [...errors, ...refillErrors],
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
