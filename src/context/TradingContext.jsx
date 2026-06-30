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

function removeClosedPositions(positions = [], history = []) {
  const closedKeys = new Set(
    history
      .filter((trade) => trade?.ticker && trade?.openedAt)
      .map((trade) => `${trade.ticker}-${trade.openedAt}`),
  )

  return positions.filter((position) => {
    if (!position?.ticker || !position?.openedAt) {
      return true
    }

    return !closedKeys.has(`${position.ticker}-${position.openedAt}`)
  })
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

  const history = Array.isArray(rawMarketState.history)
    ? rawMarketState.history
    : fallback.history
  const positions = removeClosedPositions(
    Array.isArray(rawMarketState.positions)
      ? rawMarketState.positions
      : fallback.positions,
    history,
  )

  return {
    ...fallback,
    ...rawMarketState,
    marketId,
    marketLabel: strategy.label,
    capital: normalizedCapital,
    vault: Number.isFinite(vault) ? vault : fallback.vault,
    positions,
    history,
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

function activateMarketState(state, marketId, marketState) {
  const syncedState = syncActiveMarketState(state)
  const normalizedMarketState = normalizeMarketState(marketId, marketState)

  return syncActiveMarketState({
    ...syncedState,
    activeMarket: marketId,
    markets: {
      ...(syncedState.markets || {}),
      [marketId]: normalizedMarketState,
    },
    ...normalizedMarketState,
  })
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

  const setAutomationEnabled = useCallback((enabled, targetMarketId = null) => {
    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const marketId = targetMarketId || syncedCurrent.activeMarket
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        automationEnabled: enabled,
        ...appendLogs(
          marketState,
          createActivity({
            type: 'automation',
            status: enabled ? 'working' : 'waiting',
            title: enabled ? 'Pilota automatico attivato' : 'Pilota automatico disattivato',
            detail: enabled
              ? 'Alla prossima scansione aprirà automaticamente i segnali validi, rispettando capitale e slot.'
              : 'Le prossime operazioni richiederanno conferma manuale dallo Scanner.',
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const setLiveMonitorEnabled = useCallback((enabled, targetMarketId = null) => {
    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const marketId = targetMarketId || syncedCurrent.activeMarket
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        liveMonitorEnabled: enabled,
        nextLiveCheckAt:
          enabled && marketState.positions.length > 0
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        ...appendLogs(
          marketState,
          createActivity({
            type: 'monitor',
            status: enabled ? 'working' : 'waiting',
            title: enabled ? 'Monitor live attivato' : 'Monitor live disattivato',
            detail: enabled
              ? 'Controllerò automaticamente le posizioni aperte ogni 60 secondi mentre l’app resta aperta.'
              : 'Le posizioni saranno controllate solo dal controllo manuale nel Portafoglio.',
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
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

  const recordScanStart = useCallback((tickerCount, targetMarketId = null) => {
    updateTradingState((current) => {
      const marketId = targetMarketId || current.activeMarket
      const marketCopy = getMarketCopy(marketId)
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        engineStatus: 'Scansione mercato in corso',
        ...appendLogs(
          marketState,
          createActivity({
            type: 'scan',
            status: 'working',
            title: `Scansione ${marketCopy.label} avviata`,
            detail: `Sto leggendo dati reali per ${tickerCount} ${marketCopy.assetPlural}.`,
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const recordScanComplete = useCallback(({ scannedCount, signalCount, results }, targetMarketId = null) => {
    updateTradingState((current) => {
      const marketId = targetMarketId || current.activeMarket
      const marketCopy = getMarketCopy(marketId)
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        lastScanAt: new Date().toISOString(),
        lastScanCount: scannedCount,
        lastSignalCount: signalCount,
        lastScanResults: Array.isArray(results)
          ? results
          : marketState.lastScanResults,
        engineStatus:
          signalCount > 0
            ? 'Segnali disponibili'
            : 'Nessun segnale operativo',
        ...appendLogs(
          marketState,
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

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const recordScanError = useCallback((message, targetMarketId = null) => {
    updateTradingState((current) => {
      const marketId = targetMarketId || current.activeMarket
      const marketCopy = getMarketCopy(marketId)
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        engineStatus: 'Errore dati mercato',
        ...appendLogs(
          marketState,
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

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })
  }, [updateTradingState])

  const executeTrade = useCallback((ticker, price, atr, type, profile = null, targetMarketId = null) => {
    const current = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || current.activeMarket
    const strategy = getTradingStrategy(marketId)
    const marketState = normalizeMarketState(marketId, current.markets?.[marketId])
    const sizing = strategy.positionSizing
    const maxPositions = getStrategyMaxPositions(strategy)

    if (!['LONG', 'SHORT'].includes(type)) {
      throw new Error('Tipo ordine non valido')
    }

    if (marketState.positions.length >= maxPositions) {
      throw new Error('Slot operativi esauriti')
    }

    const positionSize = calculatePositionSize(marketState.capital, sizing)

    if (!canOpenPosition(marketState.capital, sizing)) {
      throw new Error('Capitale operativo insufficiente')
    }

    if (marketState.positions.some((position) => position.ticker === ticker)) {
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
    const nextMarketState = {
      ...marketState,
      capital: roundPrice(marketState.capital - positionSize),
      positions: [...marketState.positions, trade],
      engineStatus: 'Posizione aperta',
      ...appendLogs(
        marketState,
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
    }
    const nextState = activateMarketState(current, marketId, nextMarketState)

    stateRef.current = nextState
    setState(nextState)

    return trade
  }, [])

  const executeAutomatedTrades = useCallback((rows, targetMarketId = null) => {
    const current = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || current.activeMarket
    const strategy = getTradingStrategy(marketId)
    const marketState = normalizeMarketState(marketId, current.markets?.[marketId])
    const sizing = strategy.positionSizing
    const maxPositions = getStrategyMaxPositions(strategy)
    let capital = marketState.capital
    const positions = [...marketState.positions]
    const openedTrades = []
    const skippedTickers = []
    let activityLog = marketState.activityLog || []
    let events = marketState.events || []

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

    const nextMarketState = {
      ...marketState,
      capital,
      positions,
      engineStatus:
        openedTrades.length > 0
          ? 'Pilota automatico eseguito'
          : marketState.engineStatus,
      activityLog,
      events,
    }
    const nextState = activateMarketState(current, marketId, nextMarketState)

    stateRef.current = nextState
    setState(nextState)

    return { openedTrades, skippedTickers }
  }, [])

  const fetchPositionPrices = useCallback(async (positions, targetMarketId = null) => {
    const marketId = targetMarketId || stateRef.current.activeMarket
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

  const closePositionManually = useCallback(async (positionId, targetMarketId = null) => {
    const snapshot = syncActiveMarketState(stateRef.current)
    const candidateMarketIds = targetMarketId
      ? [targetMarketId]
      : Object.keys(snapshot.markets || {})
    let marketId = targetMarketId
    let marketState = null
    let position = null

    for (const candidateMarketId of candidateMarketIds) {
      const candidateState = normalizeMarketState(
        candidateMarketId,
        snapshot.markets?.[candidateMarketId],
      )
      const candidatePosition = candidateState.positions.find(
        (item) => item.id === positionId,
      )

      if (candidatePosition) {
        marketId = candidateMarketId
        marketState = candidateState
        position = candidatePosition
        break
      }
    }

    if (!position) {
      throw new Error('Posizione non trovata')
    }

    if (!marketState) {
      marketState = normalizeMarketState(marketId, snapshot.markets?.[marketId])
    }

    const latestPrice = await fetchLatestPrice(
      position.ticker,
      position.marketId || marketId,
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
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const remainingPositions = currentMarketState.positions.filter(
        (item) => item.id !== positionId,
      )
      const capitalReturn =
        roundedPnl >= 0
          ? invested
          : recoveredCapital
      const vaultGain = roundedPnl > 0 ? roundedPnl : 0

      const nextMarketState = {
        ...currentMarketState,
        capital: roundPrice(currentMarketState.capital + capitalReturn),
        vault: roundPrice(currentMarketState.vault + vaultGain),
        positions: remainingPositions,
        history: [closedTrade, ...currentMarketState.history],
        engineStatus:
          remainingPositions.length > 0
            ? 'Posizione chiusa manualmente'
            : 'Slot liberato, ricerca nuovi segnali',
        ...appendLogs(
          currentMarketState,
          createActivity({
            type: 'trade',
            status: result === 'WIN' ? 'attention' : 'error',
            title: 'Chiusura manuale eseguita',
            detail: `${position.ticker}: P/L realizzato ${roundedPnl.toFixed(
              2,
            )}€. Avvio ricerca di un nuovo asset appetibile in ${currentMarketState.marketLabel}.`,
          }),
        ),
      }

      return activateMarketState(syncedCurrent, marketId, nextMarketState)
    })

    return closedTrade
  }, [updateTradingState])

  const runLiveCheck = useCallback(async ({ silent = false, targetMarketId = null } = {}) => {
    const snapshot = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || snapshot.activeMarket
    const marketState = normalizeMarketState(marketId, snapshot.markets?.[marketId])

    if (marketState.positions.length === 0) {
      if (!silent) {
        updateTradingState((current) => {
          const syncedCurrent = syncActiveMarketState(current)
          const currentMarketState = normalizeMarketState(
            marketId,
            syncedCurrent.markets?.[marketId],
          )

          return activateMarketState(syncedCurrent, marketId, {
            ...currentMarketState,
            ...appendLogs(
              currentMarketState,
              createActivity({
                type: 'monitor',
                status: 'waiting',
                title: 'Monitor live in attesa',
                detail: 'Non ci sono posizioni aperte da controllare.',
              }),
            ),
          })
        })
      }
      return
    }

    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )

      return activateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        engineStatus: 'Monitor live in corso',
        nextLiveCheckAt: null,
        ...appendLogs(
          currentMarketState,
          createActivity({
            type: 'monitor',
            status: 'working',
            title: 'Controllo automatico avviato',
            detail: `Sto controllando ${currentMarketState.positions.length} posizioni aperte con prezzi aggiornati.`,
          }),
        ),
      })
    })

    let positionsWithPrices = []

    try {
      positionsWithPrices = await fetchPositionPrices(marketState.positions, marketId)
    } catch (error) {
      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )

        return activateMarketState(syncedCurrent, marketId, {
          ...currentMarketState,
          engineStatus: 'Errore monitor live',
          nextLiveCheckAt: new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString(),
          ...appendLogs(
            currentMarketState,
            createActivity({
              type: 'monitor',
              status: 'error',
              title: 'Monitor live interrotto',
              detail: error.message || 'Prezzi aggiornati non disponibili.',
            }),
          ),
        })
      })
      throw error
    }

    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const evaluatedCount = currentMarketState.positions.length
      const { capital, vault, activePositions, closedTrades } = evaluatePositions(
        currentMarketState,
        positionsWithPrices,
        { incrementDays: false },
      )

      return activateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        version: STORAGE_VERSION,
        capital,
        vault,
        positions: activePositions,
        history: [...closedTrades, ...currentMarketState.history],
        lastLiveCheckAt: new Date().toISOString(),
        nextLiveCheckAt:
          activePositions.length > 0 && currentMarketState.liveMonitorEnabled
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        engineStatus:
          activePositions.length > 0
            ? 'Monitor live attivo'
            : 'In attesa di nuova scansione',
        ...appendLogs(
          currentMarketState,
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
      })
    })
  }, [fetchPositionPrices, updateTradingState])

  const runEOD = useCallback(async (targetMarketId = null) => {
    const snapshot = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || snapshot.activeMarket
    const marketState = normalizeMarketState(marketId, snapshot.markets?.[marketId])
    const marketCopy = getMarketCopy(marketId)
    const engineName =
      marketId === 'crypto' ? 'Controllo Crypto' : 'Motore EOD'

    if (marketState.positions.length === 0) {
      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )

        return activateMarketState(syncedCurrent, marketId, {
          ...currentMarketState,
          ...appendLogs(
            currentMarketState,
            createActivity({
              type: 'eod',
              status: 'waiting',
              title: `${engineName} non eseguito`,
              detail: 'Non ci sono posizioni aperte da controllare.',
            }),
          ),
        })
      })
      return
    }

    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )

      return activateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        engineStatus: `${engineName} in esecuzione`,
        ...appendLogs(
          currentMarketState,
          createActivity({
            type: 'eod',
            status: 'working',
            title: `${engineName} avviato`,
            detail: `Sto aggiornando i prezzi ${marketCopy.provider} di ${currentMarketState.positions.length} posizioni aperte.`,
          }),
        ),
      })
    })

    let positionsWithPrices = []

    try {
      positionsWithPrices = await fetchPositionPrices(marketState.positions, marketId)
    } catch (error) {
      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )

        return activateMarketState(syncedCurrent, marketId, {
          ...currentMarketState,
          engineStatus: `Errore ${engineName}`,
          ...appendLogs(
            currentMarketState,
            createActivity({
              type: 'eod',
              status: 'error',
              title: `${engineName} interrotto`,
              detail: error.message || 'Prezzi aggiornati non disponibili.',
            }),
          ),
        })
      })
      throw error
    }

    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const currentMarketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const evaluatedCount = currentMarketState.positions.length
      const { capital, vault, activePositions, closedTrades } = evaluatePositions(
        currentMarketState,
        positionsWithPrices,
        { incrementDays: true },
      )

      return activateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        version: STORAGE_VERSION,
        capital,
        vault,
        positions: activePositions,
        history: [...closedTrades, ...currentMarketState.history],
        lastLiveCheckAt: new Date().toISOString(),
        nextLiveCheckAt:
          activePositions.length > 0 && currentMarketState.liveMonitorEnabled
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        engineStatus:
          activePositions.length > 0
            ? 'Posizioni in monitoraggio'
            : 'In attesa di nuova scansione',
        ...appendLogs(
          currentMarketState,
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
      })
    })
  }, [fetchPositionPrices, updateTradingState])

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
