import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLatestPrice } from '../services/api'
import { TradingContext } from './tradingState'

const SLOT_SIZE = 2000
const MAX_POSITIONS = 5
const STORAGE_KEY = 'spapple_state'
const STORAGE_VERSION = 2

const initialState = {
  version: STORAGE_VERSION,
  capital: 30000,
  vault: 0,
  positions: [],
  history: [],
  activityLog: [
    {
      id: 'system-ready',
      type: 'system',
      status: 'done',
      title: 'Sistema inizializzato',
      detail: 'Capitale operativo pronto e nessuna posizione aperta.',
      createdAt: new Date().toISOString(),
    },
  ],
  automationEnabled: false,
  lastScanAt: null,
  lastScanCount: 0,
  lastSignalCount: 0,
  lastScanResults: [],
  engineStatus: 'In attesa',
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
      automationEnabled: Boolean(parsedState.automationEnabled),
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
    }
  } catch {
    return initialState
  }
}

function buildTrade(ticker, price, atr, type) {
  const atrPct = (atr / price) * 100
  const targetPct = atrPct < 1.5 ? 0.3 : 0.5
  const long = type === 'LONG'

  return {
    id: `${ticker}-${type}-${Date.now()}`,
    ticker,
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

export function TradingProvider({ children }) {
  const [state, setState] = useState(loadInitialState)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const updateTradingState = useCallback((updater) => {
    const nextState = updater(stateRef.current)
    stateRef.current = nextState
    setState(nextState)
  }, [])

  const recordActivity = useCallback((activity) => {
    updateTradingState((current) => ({
        ...current,
        activityLog: appendActivity(current, createActivity(activity)),
      }))
  }, [updateTradingState])

  const setAutomationEnabled = useCallback((enabled) => {
    updateTradingState((current) => ({
      ...current,
      automationEnabled: enabled,
      activityLog: appendActivity(
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

  const recordScanStart = useCallback((tickerCount) => {
    updateTradingState((current) => ({
      ...current,
      engineStatus: 'Scansione mercato in corso',
      activityLog: appendActivity(
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
      activityLog: appendActivity(
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
      activityLog: appendActivity(
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

  const executeTrade = useCallback((ticker, price, atr, type) => {
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

    const trade = buildTrade(ticker, price, atr, type)
    const nextState = {
      ...current,
      capital: current.capital - SLOT_SIZE,
      positions: [...current.positions, trade],
      engineStatus: 'Posizione aperta',
      activityLog: appendActivity(
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

      const trade = buildTrade(row.ticker, row.currentPrice, row.atr, type)
      positions.push(trade)
      capital -= SLOT_SIZE
      openedTrades.push(trade)
      activityLog = appendActivity(
        { activityLog },
        createActivity({
          type: 'trade',
          status: 'done',
          title: `Ordine automatico ${type === 'LONG' ? 'Long' : 'Short'}`,
          detail: `${row.ticker}: segnale validato e slot da 2.000€ allocato.`,
        }),
      )
    })

    const nextState = {
      ...current,
      capital,
      positions,
      engineStatus:
        openedTrades.length > 0 ? 'Pilota automatico eseguito' : current.engineStatus,
      activityLog: appendActivity(
        { activityLog },
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
      ),
    }

    stateRef.current = nextState
    setState(nextState)

    return { openedTrades, skippedTickers }
  }, [])

  const runEOD = useCallback(async () => {
    if (state.positions.length === 0) {
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
      activityLog: appendActivity(
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
      positionsWithPrices = await Promise.all(
        state.positions.map(async (position) => ({
          position,
          latestPrice: await fetchLatestPrice(position.ticker),
        })),
      )
    } catch (error) {
      updateTradingState((current) => ({
        ...current,
        engineStatus: 'Errore Motore EOD',
        activityLog: appendActivity(
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
      let capital = current.capital
      let vault = current.vault
      const activePositions = []
      const closedTrades = []
      const evaluatedCount = current.positions.length

      current.positions.forEach((position) => {
        const priceData = positionsWithPrices.find(
          (item) => item.position.id === position.id,
        )
        const latestPrice = priceData?.latestPrice
        const updatedPosition = {
          ...position,
          daysHeld: position.daysHeld + 1,
        }

        if (!Number.isFinite(latestPrice)) {
          console.log('Valutazione EOD posizione', updatedPosition)
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

        console.log('Valutazione EOD posizione', {
          ...monitoredPosition,
          latestPrice,
          pnlEur,
          isWin,
          isLoss,
        })

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
        })
      })

      return {
        ...current,
        version: STORAGE_VERSION,
        capital: roundPrice(capital),
        vault: roundPrice(vault),
        positions: activePositions,
        history: [...closedTrades, ...current.history],
        engineStatus:
          activePositions.length > 0
            ? 'Posizioni in monitoraggio'
            : 'In attesa di nuova scansione',
        activityLog: appendActivity(
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
  }, [recordActivity, state.positions, updateTradingState])

  const value = useMemo(
    () => ({
      ...state,
      executeTrade,
      executeAutomatedTrades,
      recordActivity,
      recordScanComplete,
      recordScanError,
      recordScanStart,
      runEOD,
      setAutomationEnabled,
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
      runEOD,
      setAutomationEnabled,
      state,
    ],
  )

  return (
    <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
  )
}
