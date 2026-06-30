import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLatestPrice } from '../services/api'
import {
  LEGACY_POSITION_SIZE,
  MIN_POSITION_SIZE,
  calculatePositionSize,
  canOpenPosition,
} from '../services/positionSizing'
import { getMarketCopy } from '../services/marketCopy'
import {
  loadRemoteTradingState,
  saveRemoteTradingState,
} from '../services/remoteState'
import { useAuth } from '../services/useAuth'
import {
  DEFAULT_MARKET_ID,
  TRADING_STRATEGIES,
  getTradingStrategy,
} from '../strategies'
import { TradingContext } from './tradingState'

const MAX_POSITIONS = 5
const STORAGE_KEY = 'spapple_state'
const STORAGE_VERSION = 4
const LIVE_MONITOR_INTERVAL_MS = 60_000

const initialActivity = {
  id: 'system-ready',
  type: 'system',
  status: 'done',
  title: 'Sistema azzerato',
  detail: 'Nuova simulazione avviata con capitale operativo iniziale di 30.000€ e pilota automatico attivo.',
  createdAt: new Date().toISOString(),
}

const marketStateFields = [
  'capital',
  'vault',
  'positions',
  'history',
  'activityLog',
  'events',
  'automationEnabled',
  'lastScanAt',
  'lastScanCount',
  'lastSignalCount',
  'lastScanResults',
  'engineStatus',
  'liveMonitorEnabled',
  'backendMonitorEnabled',
  'lastLiveCheckAt',
  'lastBackendCheckAt',
  'nextLiveCheckAt',
]

function createInitialMarketState(strategy = getTradingStrategy()) {
  return {
    marketId: strategy.id,
    marketLabel: strategy.label,
    capital: strategy.initialCapital,
    vault: 0,
    positions: [],
    history: [],
    activityLog: [initialActivity],
    events: [initialActivity],
    automationEnabled: true,
    lastScanAt: null,
    lastScanCount: 0,
    lastSignalCount: 0,
    lastScanResults: [],
    engineStatus: 'In attesa',
    liveMonitorEnabled: true,
    backendMonitorEnabled: true,
    lastLiveCheckAt: null,
    lastBackendCheckAt: null,
    nextLiveCheckAt: null,
  }
}

const initialEquitiesState = createInitialMarketState()

function createInitialMarkets() {
  return Object.values(TRADING_STRATEGIES).reduce((markets, strategy) => {
    markets[strategy.id] = createInitialMarketState(strategy)
    return markets
  }, {})
}

const initialState = {
  version: STORAGE_VERSION,
  activeMarket: DEFAULT_MARKET_ID,
  markets: createInitialMarkets(),
  marketId: initialEquitiesState.marketId,
  marketLabel: initialEquitiesState.marketLabel,
  capital: initialEquitiesState.capital,
  vault: 0,
  positions: [],
  history: [],
  activityLog: [initialActivity],
  events: [initialActivity],
  automationEnabled: true,
  lastScanAt: null,
  lastScanCount: 0,
  lastSignalCount: 0,
  lastScanResults: [],
  engineStatus: 'In attesa',
  liveMonitorEnabled: true,
  backendMonitorEnabled: true,
  lastLiveCheckAt: null,
  lastBackendCheckAt: null,
  nextLiveCheckAt: null,
}

function pickMarketState(state) {
  return marketStateFields.reduce((marketState, field) => {
    marketState[field] = state[field]
    return marketState
  }, {})
}

function normalizeMarketState(marketId, rawMarketState = {}) {
  const strategy = getTradingStrategy(marketId)
  const fallback = createInitialMarketState(strategy)
  const capital = Number(rawMarketState.capital)
  const vault = Number(rawMarketState.vault)
  const unusedMarket =
    !rawMarketState.positions?.length &&
    !rawMarketState.history?.length &&
    !rawMarketState.events?.length
  const normalizedCapital =
    strategy.id === 'crypto' &&
    (capital === 0 || capital === 5000) &&
    unusedMarket
      ? fallback.capital
      : Number.isFinite(capital)
        ? capital
        : fallback.capital

  return {
    ...fallback,
    ...rawMarketState,
    marketId,
    marketLabel: strategy.label,
    capital: normalizedCapital,
    vault: Number.isFinite(vault) ? vault : fallback.vault,
    positions: Array.isArray(rawMarketState.positions)
      ? rawMarketState.positions
      : fallback.positions,
    history: Array.isArray(rawMarketState.history)
      ? rawMarketState.history
      : fallback.history,
    activityLog: Array.isArray(rawMarketState.activityLog)
      ? rawMarketState.activityLog
      : fallback.activityLog,
    events: Array.isArray(rawMarketState.events)
      ? rawMarketState.events
      : Array.isArray(rawMarketState.activityLog)
        ? rawMarketState.activityLog
        : fallback.events,
    automationEnabled:
      typeof rawMarketState.automationEnabled === 'boolean'
        ? rawMarketState.automationEnabled
        : fallback.automationEnabled,
    lastScanAt: rawMarketState.lastScanAt || fallback.lastScanAt,
    lastScanCount: Number.isFinite(Number(rawMarketState.lastScanCount))
      ? Number(rawMarketState.lastScanCount)
      : fallback.lastScanCount,
    lastSignalCount: Number.isFinite(Number(rawMarketState.lastSignalCount))
      ? Number(rawMarketState.lastSignalCount)
      : fallback.lastSignalCount,
    lastScanResults: Array.isArray(rawMarketState.lastScanResults)
      ? rawMarketState.lastScanResults
      : fallback.lastScanResults,
    engineStatus: rawMarketState.engineStatus || fallback.engineStatus,
    liveMonitorEnabled:
      typeof rawMarketState.liveMonitorEnabled === 'boolean'
        ? rawMarketState.liveMonitorEnabled
        : fallback.liveMonitorEnabled,
    backendMonitorEnabled:
      typeof rawMarketState.backendMonitorEnabled === 'boolean'
        ? rawMarketState.backendMonitorEnabled
        : fallback.backendMonitorEnabled,
    lastLiveCheckAt: rawMarketState.lastLiveCheckAt || fallback.lastLiveCheckAt,
    lastBackendCheckAt:
      rawMarketState.lastBackendCheckAt || fallback.lastBackendCheckAt,
    nextLiveCheckAt: rawMarketState.nextLiveCheckAt || fallback.nextLiveCheckAt,
  }
}

function syncActiveMarketState(state) {
  const activeMarket = state.activeMarket || DEFAULT_MARKET_ID
  const currentMarketState = normalizeMarketState(activeMarket, pickMarketState(state))
  const markets = {
    ...(state.markets || {}),
    [activeMarket]: currentMarketState,
  }

  return {
    ...state,
    activeMarket,
    markets,
    ...currentMarketState,
  }
}

function roundPrice(value) {
  return Number(value.toFixed(4))
}

function createActivity({ type = 'system', status = 'done', title, detail }) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    status,
    title,
    detail,
    createdAt: new Date().toISOString(),
  }
}

function appendActivity(state, activity) {
  return [activity, ...(state.activityLog || [])].slice(0, 14)
}

function appendLogs(state, activity) {
  return {
    activityLog: appendActivity(state, activity),
    events: [activity, ...(state.events || [])],
  }
}

function normalizeStoredState(parsedState) {
  const activeMarket = parsedState.activeMarket || DEFAULT_MARKET_ID
  const rawMarkets =
    parsedState.markets && typeof parsedState.markets === 'object'
      ? parsedState.markets
      : {}
  const legacyMarketState = normalizeMarketState(DEFAULT_MARKET_ID, parsedState)
  const markets = Object.values(TRADING_STRATEGIES).reduce(
    (normalizedMarkets, strategy) => {
      normalizedMarkets[strategy.id] = normalizeMarketState(
        strategy.id,
        rawMarkets[strategy.id] ||
          (strategy.id === DEFAULT_MARKET_ID ? legacyMarketState : {}),
      )
      return normalizedMarkets
    },
    {},
  )
  const activeMarketState = normalizeMarketState(
    activeMarket,
    markets[activeMarket] || markets[DEFAULT_MARKET_ID],
  )

  return syncActiveMarketState({
    version: STORAGE_VERSION,
    activeMarket,
    markets,
    ...activeMarketState,
  })
}

function loadInitialState() {
  try {
    const storedState = localStorage.getItem(STORAGE_KEY)

    if (!storedState) {
      return initialState
    }

    const parsedState = JSON.parse(storedState)

    if (parsedState.version !== STORAGE_VERSION) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState))
      return initialState
    }

    return normalizeStoredState(parsedState)
  } catch {
    return initialState
  }
}

function getStrategyMaxPositions(strategy) {
  return Number.isFinite(Number(strategy.maxPositions))
    ? Number(strategy.maxPositions)
    : MAX_POSITIONS
}

function buildTrade(
  ticker,
  price,
  atr,
  type,
  invested,
  profile = null,
  strategy = getTradingStrategy(),
) {
  const atrPct = (atr / price) * 100
  const isCrypto = strategy.id === 'crypto'
  const targetPct = isCrypto ? (atrPct < 4 ? 0.8 : 1.2) : atrPct < 1.5 ? 0.3 : 0.5
  const stopMultiplier = isCrypto ? 1.8 : 1.5
  const long = type === 'LONG'
  const openedAt = new Date().toISOString()

  return {
    id: `${ticker}-${type}-${Date.now()}`,
    marketId: strategy.id,
    marketLabel: strategy.label,
    ticker,
    profile,
    type,
    openedAt,
    entryPrice: roundPrice(price),
    atrAtEntry: roundPrice(atr),
    takeProfit: roundPrice(
      long ? price * (1 + targetPct / 100) : price * (1 - targetPct / 100),
    ),
    stopLoss: roundPrice(
      long ? price - atr * stopMultiplier : price + atr * stopMultiplier,
    ),
    daysHeld: 0,
    invested: roundPrice(invested),
    targetPct,
  }
}

function evaluatePositions(current, positionsWithPrices, { incrementDays }) {
  let capital = current.capital
  let vault = current.vault
  const activePositions = []
  const closedTrades = []

  current.positions.forEach((position) => {
    const priceData = positionsWithPrices.find(
      (item) => item.position.id === position.id,
    )
    const latestPrice = priceData?.latestPrice
    const updatedPosition = {
      ...position,
      daysHeld: incrementDays ? position.daysHeld + 1 : position.daysHeld,
    }

    if (!Number.isFinite(latestPrice)) {
      activePositions.push(updatedPosition)
      return
    }

    const investedAtRisk = position.invested || LEGACY_POSITION_SIZE
    const quantity = investedAtRisk / position.entryPrice
    const long = position.type === 'LONG'
    const pnlEur = long
      ? (latestPrice - position.entryPrice) * quantity
      : (position.entryPrice - latestPrice) * quantity
    const monitoredPosition = {
      ...updatedPosition,
      latestPrice: roundPrice(latestPrice),
      unrealizedPnl: roundPrice(pnlEur),
    }
    const isWin = long
      ? latestPrice >= position.takeProfit
      : latestPrice <= position.takeProfit
    const isLoss = long
      ? latestPrice <= position.stopLoss
      : latestPrice >= position.stopLoss

    if (!isWin && !isLoss) {
      activePositions.push(monitoredPosition)
      return
    }

    const roundedPnl = roundPrice(pnlEur)
    const invested = investedAtRisk
    const recoveredCapital = Math.max(invested + roundedPnl, 0)

    if (isWin) {
      capital += invested
      vault += Math.max(roundedPnl, 0)
    } else {
      capital += recoveredCapital
    }

    closedTrades.push({
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
    })
  })

  return {
    capital: roundPrice(capital),
    vault: roundPrice(vault),
    activePositions,
    closedTrades,
  }
}

export function TradingProvider({ children }) {
  const { isAuthenticated } = useAuth()
  const [state, setState] = useState(loadInitialState)
  const [remoteStatus, setRemoteStatus] = useState('disconnesso')
  const stateRef = useRef(state)
  const remoteReadyRef = useRef(false)
  const remoteSaveTimerRef = useRef(null)
  const liveCheckRunningRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (!isAuthenticated) {
      remoteReadyRef.current = false
      setRemoteStatus('disconnesso')
      return
    }

    let cancelled = false

    async function hydrateRemoteState() {
      setRemoteStatus('caricamento')

      try {
        const remoteState = await loadRemoteTradingState()

        if (cancelled) {
          return
        }

        if (remoteState.payload?.version === STORAGE_VERSION) {
          const hydratedState = normalizeStoredState(remoteState.payload)
          stateRef.current = hydratedState
          setState(hydratedState)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(hydratedState))
        } else {
          await saveRemoteTradingState(stateRef.current)
        }

        remoteReadyRef.current = true
        setRemoteStatus('sincronizzato')
      } catch (error) {
        if (!cancelled) {
          remoteReadyRef.current = false
          setRemoteStatus(`errore: ${error.message}`)
        }
      }
    }

    hydrateRemoteState()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !remoteReadyRef.current) {
      return undefined
    }

    clearTimeout(remoteSaveTimerRef.current)
    remoteSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveRemoteTradingState(stateRef.current)
        setRemoteStatus('sincronizzato')
      } catch (error) {
        setRemoteStatus(`errore: ${error.message}`)
      }
    }, 600)

    return () => {
      clearTimeout(remoteSaveTimerRef.current)
    }
  }, [isAuthenticated, state])

  const updateTradingState = useCallback((updater) => {
    const nextState = syncActiveMarketState(updater(stateRef.current))
    stateRef.current = nextState
    setState(nextState)
  }, [])

  const recordActivity = useCallback((activity) => {
    updateTradingState((current) => ({
      ...current,
      ...appendLogs(current, createActivity(activity)),
    }))
  }, [updateTradingState])

  const setAutomationEnabled = useCallback((enabled) => {
    updateTradingState((current) => ({
      ...current,
      automationEnabled: enabled,
      ...appendLogs(
        current,
        createActivity({
          type: 'automation',
          status: enabled ? 'working' : 'waiting',
          title: enabled ? 'Pilota automatico attivato' : 'Pilota automatico disattivato',
          detail: enabled
            ? 'Alla prossima scansione aprirà automaticamente i segnali validi, rispettando capitale e slot.'
            : 'Le prossime operazioni richiederanno conferma manuale dallo Scanner.',
        }),
      ),
    }))
  }, [updateTradingState])

  const setLiveMonitorEnabled = useCallback((enabled) => {
    updateTradingState((current) => ({
      ...current,
      liveMonitorEnabled: enabled,
      nextLiveCheckAt:
        enabled && current.positions.length > 0
          ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
          : null,
      ...appendLogs(
        current,
        createActivity({
          type: 'monitor',
          status: enabled ? 'working' : 'waiting',
          title: enabled ? 'Monitor live attivato' : 'Monitor live disattivato',
          detail: enabled
            ? 'Controllerò automaticamente le posizioni aperte ogni 60 secondi mentre l’app resta aperta.'
            : 'Le posizioni saranno controllate solo dal controllo manuale nel Portafoglio.',
        }),
      ),
    }))
  }, [updateTradingState])

  const setActiveMarket = useCallback((marketId) => {
    updateTradingState((current) => {
      const nextStrategy = getTradingStrategy(marketId)
      const currentSynced = syncActiveMarketState(current)
      const nextMarketState = normalizeMarketState(
        nextStrategy.id,
        currentSynced.markets?.[nextStrategy.id],
      )
      const activity = createActivity({
        type: 'market',
        status: 'done',
        title: `Mercato attivo: ${nextStrategy.label}`,
        detail: `Spapple ora mostra capitale, posizioni, scansioni e storico del mercato ${nextStrategy.label}.`,
      })

      return {
        ...currentSynced,
        activeMarket: nextStrategy.id,
        markets: currentSynced.markets,
        ...nextMarketState,
        ...appendLogs(nextMarketState, activity),
      }
    })
  }, [updateTradingState])

  const recordScanStart = useCallback((tickerCount) => {
    updateTradingState((current) => {
      const marketCopy = getMarketCopy(current.activeMarket)

      return {
        ...current,
        engineStatus: 'Scansione mercato in corso',
        ...appendLogs(
          current,
          createActivity({
            type: 'scan',
            status: 'working',
            title: `Scansione ${marketCopy.label} avviata`,
            detail: `Sto leggendo dati reali per ${tickerCount} ${marketCopy.assetPlural}.`,
          }),
        ),
      }
    })
  }, [updateTradingState])

  const recordScanComplete = useCallback(({ scannedCount, signalCount, results }) => {
    updateTradingState((current) => {
      const marketCopy = getMarketCopy(current.activeMarket)

      return {
        ...current,
        lastScanAt: new Date().toISOString(),
        lastScanCount: scannedCount,
        lastSignalCount: signalCount,
        lastScanResults: Array.isArray(results) ? results : current.lastScanResults,
        engineStatus:
          signalCount > 0
            ? 'Segnali disponibili'
            : 'Nessun segnale operativo',
        ...appendLogs(
          current,
          createActivity({
            type: 'scan',
            status: signalCount > 0 ? 'attention' : 'done',
            title: `Scansione ${marketCopy.label} completata`,
            detail:
              signalCount > 0
                ? `${signalCount} segnali validi trovati su ${scannedCount} ${marketCopy.assetPlural}.`
                : `${scannedCount} ${marketCopy.assetPlural} controllati. Nessun asset rispetta le regole operative.`,
          }),
        ),
      }
    })
  }, [updateTradingState])

  const recordScanError = useCallback((message) => {
    updateTradingState((current) => {
      const marketCopy = getMarketCopy(current.activeMarket)

      return {
        ...current,
        engineStatus: 'Errore dati mercato',
        ...appendLogs(
          current,
          createActivity({
            type: 'scan',
            status: 'error',
            title: `Scansione ${marketCopy.label} non riuscita`,
            detail:
              message ||
              `${marketCopy.provider} non ha restituito dati utilizzabili.`,
          }),
        ),
      }
    })
  }, [updateTradingState])

  const executeTrade = useCallback((ticker, price, atr, type, profile = null) => {
    const current = stateRef.current
    const strategy = getTradingStrategy(current.activeMarket)
    const sizing = strategy.positionSizing
    const maxPositions = getStrategyMaxPositions(strategy)

    if (!['LONG', 'SHORT'].includes(type)) {
      throw new Error('Tipo ordine non valido')
    }

    if (current.positions.length >= maxPositions) {
      throw new Error('Slot operativi esauriti')
    }

    const positionSize = calculatePositionSize(current.capital, sizing)

    if (!canOpenPosition(current.capital, sizing)) {
      throw new Error('Capitale operativo insufficiente')
    }

    if (current.positions.some((position) => position.ticker === ticker)) {
      throw new Error(`${ticker} è già presente in portafoglio`)
    }

    const trade = buildTrade(
      ticker,
      price,
      atr,
      type,
      positionSize,
      profile,
      strategy,
    )
    const nextState = syncActiveMarketState({
      ...current,
      capital: roundPrice(current.capital - positionSize),
      positions: [...current.positions, trade],
      engineStatus: 'Posizione aperta',
      ...appendLogs(
        current,
        createActivity({
          type: 'trade',
          status: 'done',
          title: `Ordine ${type === 'LONG' ? 'Long' : 'Short'} aperto`,
          detail: `${ticker}: posizione da ${positionSize.toFixed(
            2,
          )}€ allocata. Take profit ${roundPrice(
            trade.takeProfit,
          )}, stop loss ${roundPrice(trade.stopLoss)}.`,
        }),
      ),
    })

    stateRef.current = nextState
    setState(nextState)

    return trade
  }, [])

  const executeAutomatedTrades = useCallback((rows) => {
    const current = stateRef.current
    const strategy = getTradingStrategy(current.activeMarket)
    const sizing = strategy.positionSizing
    const maxPositions = getStrategyMaxPositions(strategy)
    let capital = current.capital
    const positions = [...current.positions]
    const openedTrades = []
    const skippedTickers = []
    let activityLog = current.activityLog || []
    let events = current.events || []

    const appendLocalLog = (activity) => {
      activityLog = appendActivity({ activityLog }, activity)
      events = [activity, ...events]
    }

    rows.forEach((row) => {
      const type = row.rsi < 30 ? 'LONG' : 'SHORT'
      const alreadyOpen = positions.some(
        (position) => position.ticker === row.ticker,
      )
      const canOpen =
        ['LONG', 'SHORT'].includes(type) &&
        positions.length < maxPositions &&
        canOpenPosition(capital, sizing) &&
        !alreadyOpen

      if (!canOpen) {
        skippedTickers.push(row.ticker)
        return
      }

      const positionSize = calculatePositionSize(capital, sizing)
      const trade = buildTrade(
        row.ticker,
        row.currentPrice,
        row.atr,
        type,
        positionSize,
        row.profile || null,
        strategy,
      )
      positions.push(trade)
      capital = roundPrice(capital - positionSize)
      openedTrades.push(trade)
      appendLocalLog(
        createActivity({
          type: 'trade',
          status: 'done',
          title: `Ordine automatico ${type === 'LONG' ? 'Long' : 'Short'}`,
          detail: `${row.ticker}: segnale validato e posizione da ${positionSize.toFixed(
            2,
          )}€ allocata.`,
        }),
      )
    })

    appendLocalLog(
      createActivity({
        type: 'automation',
        status: openedTrades.length > 0 ? 'done' : 'waiting',
        title: 'Pilota automatico completato',
        detail:
          openedTrades.length > 0
            ? `${openedTrades.length} posizioni aperte automaticamente.`
            : `Nessuna posizione aperta. ${
                skippedTickers.length > 0
                  ? 'Segnali saltati per slot, capitale o duplicati.'
                  : 'Nessun segnale disponibile.'
              }`,
      }),
    )

    const nextState = syncActiveMarketState({
      ...current,
      capital,
      positions,
      engineStatus:
        openedTrades.length > 0 ? 'Pilota automatico eseguito' : current.engineStatus,
      activityLog,
      events,
    })

    stateRef.current = nextState
    setState(nextState)

    return { openedTrades, skippedTickers }
  }, [])

  const fetchPositionPrices = useCallback(async (positions) => {
    const marketId = stateRef.current.activeMarket

    return Promise.all(
      positions.map(async (position) => ({
        position,
        latestPrice: await fetchLatestPrice(
          position.ticker,
          position.marketId || marketId,
        ),
      })),
    )
  }, [])

  const closePositionManually = useCallback(async (positionId) => {
    const snapshot = stateRef.current
    const position = snapshot.positions.find((item) => item.id === positionId)

    if (!position) {
      throw new Error('Posizione non trovata')
    }

    const latestPrice = await fetchLatestPrice(
      position.ticker,
      position.marketId || snapshot.activeMarket,
    )
    const invested = position.invested || LEGACY_POSITION_SIZE
    const quantity = invested / position.entryPrice
    const long = position.type === 'LONG'
    const pnlEur = long
      ? (latestPrice - position.entryPrice) * quantity
      : (position.entryPrice - latestPrice) * quantity
    const roundedPnl = roundPrice(pnlEur)
    const result = roundedPnl >= 0 ? 'WIN' : 'LOSS'
    const recoveredCapital = Math.max(invested + roundedPnl, 0)
    const closedTrade = {
      ticker: position.ticker,
      type: position.type,
      openedAt: position.openedAt || null,
      entryPrice: position.entryPrice,
      invested,
      pnlEur: roundedPnl,
      result,
      exitDate: new Date().toISOString(),
      exitPrice: roundPrice(latestPrice),
      exitReason: 'MANUALE',
      recoveredCapital: roundPrice(recoveredCapital),
    }

    updateTradingState((current) => {
      const remainingPositions = current.positions.filter(
        (item) => item.id !== positionId,
      )
      const capitalReturn =
        roundedPnl >= 0
          ? invested
          : recoveredCapital
      const vaultGain = roundedPnl > 0 ? roundedPnl : 0

      return {
        ...current,
        capital: roundPrice(current.capital + capitalReturn),
        vault: roundPrice(current.vault + vaultGain),
        positions: remainingPositions,
        history: [closedTrade, ...current.history],
        engineStatus:
          remainingPositions.length > 0
            ? 'Posizione chiusa manualmente'
            : 'Slot liberato, ricerca nuovi segnali',
        ...appendLogs(
          current,
          createActivity({
            type: 'trade',
            status: result === 'WIN' ? 'attention' : 'error',
            title: 'Chiusura manuale eseguita',
            detail: `${position.ticker}: P/L realizzato ${roundedPnl.toFixed(
              2,
            )}€. Avvio ricerca di un nuovo asset appetibile nel mercato attivo.`,
          }),
        ),
      }
    })

    return closedTrade
  }, [updateTradingState])

  const runLiveCheck = useCallback(async ({ silent = false } = {}) => {
    const snapshot = stateRef.current

    if (snapshot.positions.length === 0) {
      if (!silent) {
        recordActivity({
          type: 'monitor',
          status: 'waiting',
          title: 'Monitor live in attesa',
          detail: 'Non ci sono posizioni aperte da controllare.',
        })
      }
      return
    }

    updateTradingState((current) => ({
      ...current,
      engineStatus: 'Monitor live in corso',
      nextLiveCheckAt: null,
      ...appendLogs(
        current,
        createActivity({
          type: 'monitor',
          status: 'working',
          title: 'Controllo automatico avviato',
          detail: `Sto controllando ${current.positions.length} posizioni aperte con prezzi aggiornati.`,
        }),
      ),
    }))

    let positionsWithPrices = []

    try {
      positionsWithPrices = await fetchPositionPrices(snapshot.positions)
    } catch (error) {
      updateTradingState((current) => ({
        ...current,
        engineStatus: 'Errore monitor live',
        nextLiveCheckAt: new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString(),
        ...appendLogs(
          current,
          createActivity({
            type: 'monitor',
            status: 'error',
            title: 'Monitor live interrotto',
            detail: error.message || 'Prezzi aggiornati non disponibili.',
          }),
        ),
      }))
      throw error
    }

    updateTradingState((current) => {
      const evaluatedCount = current.positions.length
      const { capital, vault, activePositions, closedTrades } = evaluatePositions(
        current,
        positionsWithPrices,
        { incrementDays: false },
      )

      return {
        ...current,
        version: STORAGE_VERSION,
        capital,
        vault,
        positions: activePositions,
        history: [...closedTrades, ...current.history],
        lastLiveCheckAt: new Date().toISOString(),
        nextLiveCheckAt:
          activePositions.length > 0 && current.liveMonitorEnabled
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        engineStatus:
          activePositions.length > 0
            ? 'Monitor live attivo'
            : 'In attesa di nuova scansione',
        ...appendLogs(
          current,
          createActivity({
            type: 'monitor',
            status: closedTrades.length > 0 ? 'attention' : 'done',
            title:
              closedTrades.length > 0
                ? 'Uscita automatica eseguita'
                : 'Controllo automatico completato',
            detail:
              closedTrades.length > 0
                ? `${closedTrades.length} posizioni chiuse perché hanno raggiunto target o stop.`
                : `${evaluatedCount} posizioni controllate. Nessun target o stop raggiunto; prossimo controllo tra 60 secondi.`,
          }),
        ),
      }
    })
  }, [fetchPositionPrices, recordActivity, updateTradingState])

  const runEOD = useCallback(async () => {
    const snapshot = stateRef.current
    const marketCopy = getMarketCopy(snapshot.activeMarket)
    const engineName =
      snapshot.activeMarket === 'crypto' ? 'Controllo Crypto' : 'Motore EOD'

    if (snapshot.positions.length === 0) {
      recordActivity({
        type: 'eod',
        status: 'waiting',
        title: `${engineName} non eseguito`,
        detail: 'Non ci sono posizioni aperte da controllare.',
      })
      return
    }

    updateTradingState((current) => ({
      ...current,
      engineStatus: `${engineName} in esecuzione`,
      ...appendLogs(
        current,
        createActivity({
          type: 'eod',
          status: 'working',
          title: `${engineName} avviato`,
          detail: `Sto aggiornando i prezzi ${marketCopy.provider} di ${current.positions.length} posizioni aperte.`,
        }),
      ),
    }))

    let positionsWithPrices = []

    try {
      positionsWithPrices = await fetchPositionPrices(snapshot.positions)
    } catch (error) {
      updateTradingState((current) => ({
        ...current,
        engineStatus: `Errore ${engineName}`,
        ...appendLogs(
          current,
          createActivity({
            type: 'eod',
            status: 'error',
            title: `${engineName} interrotto`,
            detail: error.message || 'Prezzi aggiornati non disponibili.',
          }),
        ),
      }))
      throw error
    }

    updateTradingState((current) => {
      const evaluatedCount = current.positions.length
      const { capital, vault, activePositions, closedTrades } = evaluatePositions(
        current,
        positionsWithPrices,
        { incrementDays: true },
      )

      return {
        ...current,
        version: STORAGE_VERSION,
        capital,
        vault,
        positions: activePositions,
        history: [...closedTrades, ...current.history],
        lastLiveCheckAt: new Date().toISOString(),
        nextLiveCheckAt:
          activePositions.length > 0 && current.liveMonitorEnabled
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        engineStatus:
          activePositions.length > 0
            ? 'Posizioni in monitoraggio'
            : 'In attesa di nuova scansione',
        ...appendLogs(
          current,
          createActivity({
            type: 'eod',
            status: closedTrades.length > 0 ? 'attention' : 'done',
            title: `${engineName} completato`,
            detail:
              closedTrades.length > 0
                ? `${closedTrades.length} posizioni chiuse, ${activePositions.length} ancora aperte.`
                : `${evaluatedCount} posizioni controllate. Nessun target o stop loss raggiunto.`,
          }),
        ),
      }
    })
  }, [fetchPositionPrices, recordActivity, updateTradingState])

  useEffect(() => {
    const monitorActive =
      isAuthenticated &&
      state.automationEnabled &&
      state.liveMonitorEnabled &&
      state.positions.length > 0

    if (!monitorActive) {
      return undefined
    }

    updateTradingState((current) => ({
      ...current,
      nextLiveCheckAt:
        current.nextLiveCheckAt ||
        new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString(),
    }))

    const intervalId = window.setInterval(async () => {
      if (liveCheckRunningRef.current) {
        return
      }

      liveCheckRunningRef.current = true

      try {
        await runLiveCheck({ silent: true })
      } catch {
        // L'errore viene gia registrato nello storico dal monitor.
      } finally {
        liveCheckRunningRef.current = false
      }
    }, LIVE_MONITOR_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    isAuthenticated,
    runLiveCheck,
    state.automationEnabled,
    state.liveMonitorEnabled,
    state.positions.length,
    updateTradingState,
  ])

  const value = useMemo(
    () => ({
      ...state,
      remoteStatus,
      closePositionManually,
      executeTrade,
      executeAutomatedTrades,
      recordActivity,
      recordScanComplete,
      recordScanError,
      recordScanStart,
      runLiveCheck,
      runEOD,
      setAutomationEnabled,
      setLiveMonitorEnabled,
      setActiveMarket,
      strategies: Object.values(TRADING_STRATEGIES),
      currentStrategy: getTradingStrategy(state.activeMarket),
      slotSize: calculatePositionSize(
        state.capital,
        getTradingStrategy(state.activeMarket).positionSizing,
      ),
      minPositionSize:
        getTradingStrategy(state.activeMarket).positionSizing.min || MIN_POSITION_SIZE,
      maxPositions: getStrategyMaxPositions(getTradingStrategy(state.activeMarket)),
    }),
    [
      closePositionManually,
      executeTrade,
      executeAutomatedTrades,
      recordActivity,
      recordScanComplete,
      recordScanError,
      recordScanStart,
      runLiveCheck,
      runEOD,
      setAutomationEnabled,
      setLiveMonitorEnabled,
      setActiveMarket,
      state,
      remoteStatus,
    ],
  )

  return (
    <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
  )
}
