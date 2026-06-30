import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLatestPrice } from '../services/api'
import {
  loadRemoteTradingState,
  saveRemoteTradingState,
} from '../services/remoteState'
import { useAuth } from '../services/useAuth'
import { TradingContext } from './tradingState'

const SLOT_SIZE = 2000
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

const initialState = {
  version: STORAGE_VERSION,
  capital: 30000,
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
  const capital = Number(parsedState.capital)
  const vault = Number(parsedState.vault)

  return {
    version: STORAGE_VERSION,
    capital: Number.isFinite(capital) ? capital : initialState.capital,
    vault: Number.isFinite(vault) ? vault : initialState.vault,
    positions: Array.isArray(parsedState.positions)
      ? parsedState.positions
      : initialState.positions,
    history: Array.isArray(parsedState.history)
      ? parsedState.history
      : initialState.history,
    activityLog: Array.isArray(parsedState.activityLog)
      ? parsedState.activityLog
      : initialState.activityLog,
    events: Array.isArray(parsedState.events)
      ? parsedState.events
      : Array.isArray(parsedState.activityLog)
        ? parsedState.activityLog
        : initialState.events,
    automationEnabled:
      typeof parsedState.automationEnabled === 'boolean'
        ? parsedState.automationEnabled
        : initialState.automationEnabled,
    lastScanAt: parsedState.lastScanAt || initialState.lastScanAt,
    lastScanCount: Number.isFinite(Number(parsedState.lastScanCount))
      ? Number(parsedState.lastScanCount)
      : initialState.lastScanCount,
    lastSignalCount: Number.isFinite(Number(parsedState.lastSignalCount))
      ? Number(parsedState.lastSignalCount)
      : initialState.lastSignalCount,
    lastScanResults: Array.isArray(parsedState.lastScanResults)
      ? parsedState.lastScanResults
      : initialState.lastScanResults,
    engineStatus: parsedState.engineStatus || initialState.engineStatus,
    liveMonitorEnabled:
      typeof parsedState.liveMonitorEnabled === 'boolean'
        ? parsedState.liveMonitorEnabled
        : initialState.liveMonitorEnabled,
    backendMonitorEnabled:
      typeof parsedState.backendMonitorEnabled === 'boolean'
        ? parsedState.backendMonitorEnabled
        : initialState.backendMonitorEnabled,
    lastLiveCheckAt: parsedState.lastLiveCheckAt || initialState.lastLiveCheckAt,
    lastBackendCheckAt:
      parsedState.lastBackendCheckAt || initialState.lastBackendCheckAt,
    nextLiveCheckAt: parsedState.nextLiveCheckAt || initialState.nextLiveCheckAt,
  }
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

function buildTrade(ticker, price, atr, type, profile = null) {
  const atrPct = (atr / price) * 100
  const targetPct = atrPct < 1.5 ? 0.3 : 0.5
  const long = type === 'LONG'

  return {
    id: `${ticker}-${type}-${Date.now()}`,
    ticker,
    profile,
    type,
    entryPrice: roundPrice(price),
    atrAtEntry: roundPrice(atr),
    takeProfit: roundPrice(
      long ? price * (1 + targetPct / 100) : price * (1 - targetPct / 100),
    ),
    stopLoss: roundPrice(long ? price - atr * 1.5 : price + atr * 1.5),
    daysHeld: 0,
    invested: SLOT_SIZE,
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

    const quantity = position.invested / position.entryPrice
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

    if (isWin) {
      capital += position.invested
      vault += Math.max(roundedPnl, 0)
    } else {
      capital += Math.max(position.invested - Math.abs(roundedPnl), 0)
    }

    closedTrades.push({
      ticker: position.ticker,
      type: position.type,
      pnlEur: roundedPnl,
      result: isWin ? 'WIN' : 'LOSS',
      exitDate: new Date().toISOString(),
      exitPrice: roundPrice(latestPrice),
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
    const nextState = updater(stateRef.current)
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
            : 'Le posizioni saranno controllate solo dal Motore EOD manuale.',
        }),
      ),
    }))
  }, [updateTradingState])

  const recordScanStart = useCallback((tickerCount) => {
    updateTradingState((current) => ({
      ...current,
      engineStatus: 'Scansione mercato in corso',
      ...appendLogs(
        current,
        createActivity({
          type: 'scan',
          status: 'working',
          title: 'Scansione EOD avviata',
          detail: `Sto leggendo dati reali per ${tickerCount} ticker.`,
        }),
      ),
    }))
  }, [updateTradingState])

  const recordScanComplete = useCallback(({ scannedCount, signalCount, results }) => {
    updateTradingState((current) => ({
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
          title: 'Scansione completata',
          detail:
            signalCount > 0
              ? `${signalCount} segnali validi trovati su ${scannedCount} ticker.`
              : `${scannedCount} ticker controllati. Nessun titolo rispetta le regole operative.`,
        }),
      ),
    }))
  }, [updateTradingState])

  const recordScanError = useCallback((message) => {
    updateTradingState((current) => ({
      ...current,
      engineStatus: 'Errore dati mercato',
      ...appendLogs(
        current,
        createActivity({
          type: 'scan',
          status: 'error',
          title: 'Scansione non riuscita',
          detail: message || 'Yahoo Finance non ha restituito dati utilizzabili.',
        }),
      ),
    }))
  }, [updateTradingState])

  const executeTrade = useCallback((ticker, price, atr, type, profile = null) => {
    const current = stateRef.current

    if (!['LONG', 'SHORT'].includes(type)) {
      throw new Error('Tipo ordine non valido')
    }

    if (current.positions.length >= MAX_POSITIONS) {
      throw new Error('Slot operativi esauriti')
    }

    if (current.capital < SLOT_SIZE) {
      throw new Error('Capitale operativo insufficiente')
    }

    if (current.positions.some((position) => position.ticker === ticker)) {
      throw new Error(`${ticker} è già presente in portafoglio`)
    }

    const trade = buildTrade(ticker, price, atr, type, profile)
    const nextState = {
      ...current,
      capital: current.capital - SLOT_SIZE,
      positions: [...current.positions, trade],
      engineStatus: 'Posizione aperta',
      ...appendLogs(
        current,
        createActivity({
          type: 'trade',
          status: 'done',
          title: `Ordine ${type === 'LONG' ? 'Long' : 'Short'} aperto`,
          detail: `${ticker}: slot da 2.000€ allocato. Take profit ${roundPrice(
            trade.takeProfit,
          )}, stop loss ${roundPrice(trade.stopLoss)}.`,
        }),
      ),
    }

    stateRef.current = nextState
    setState(nextState)

    return trade
  }, [])

  const executeAutomatedTrades = useCallback((rows) => {
    const current = stateRef.current
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
        positions.length < MAX_POSITIONS &&
        capital >= SLOT_SIZE &&
        !alreadyOpen

      if (!canOpen) {
        skippedTickers.push(row.ticker)
        return
      }

      const trade = buildTrade(
        row.ticker,
        row.currentPrice,
        row.atr,
        type,
        row.profile || null,
      )
      positions.push(trade)
      capital -= SLOT_SIZE
      openedTrades.push(trade)
      appendLocalLog(
        createActivity({
          type: 'trade',
          status: 'done',
          title: `Ordine automatico ${type === 'LONG' ? 'Long' : 'Short'}`,
          detail: `${row.ticker}: segnale validato e slot da 2.000€ allocato.`,
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

    const nextState = {
      ...current,
      capital,
      positions,
      engineStatus:
        openedTrades.length > 0 ? 'Pilota automatico eseguito' : current.engineStatus,
      activityLog,
      events,
    }

    stateRef.current = nextState
    setState(nextState)

    return { openedTrades, skippedTickers }
  }, [])

  const fetchPositionPrices = useCallback(async (positions) => {
    return Promise.all(
      positions.map(async (position) => ({
        position,
        latestPrice: await fetchLatestPrice(position.ticker),
      })),
    )
  }, [])

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

    if (snapshot.positions.length === 0) {
      recordActivity({
        type: 'eod',
        status: 'waiting',
        title: 'Motore EOD non eseguito',
        detail: 'Non ci sono posizioni aperte da controllare.',
      })
      return
    }

    updateTradingState((current) => ({
      ...current,
      engineStatus: 'Motore EOD in esecuzione',
      ...appendLogs(
        current,
        createActivity({
          type: 'eod',
          status: 'working',
          title: 'Motore EOD avviato',
          detail: `Sto aggiornando i prezzi di ${current.positions.length} posizioni aperte.`,
        }),
      ),
    }))

    let positionsWithPrices = []

    try {
      positionsWithPrices = await fetchPositionPrices(snapshot.positions)
    } catch (error) {
      updateTradingState((current) => ({
        ...current,
        engineStatus: 'Errore Motore EOD',
        ...appendLogs(
          current,
          createActivity({
            type: 'eod',
            status: 'error',
            title: 'Motore EOD interrotto',
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
            title: 'Motore EOD completato',
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
      slotSize: SLOT_SIZE,
      maxPositions: MAX_POSITIONS,
    }),
    [
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
      state,
      remoteStatus,
    ],
  )

  return (
    <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
  )
}
