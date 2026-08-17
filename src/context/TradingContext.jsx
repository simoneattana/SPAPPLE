import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLatestPrice, fetchMarketData, fetchUsMarketContext } from '../services/api'
import { fetchCryptoMarketData } from '../services/cryptoApi'
import { CRYPTO_TICKERS } from '../services/cryptoUniverse'
import {
  LEGACY_POSITION_SIZE,
  MIN_POSITION_SIZE,
  calculatePositionSize,
  canOpenPosition,
} from '../services/positionSizing'
import {
  applyExecutionCosts,
  getExecutionFeesEur,
  getPositionOpenCommissionEur,
} from '../services/executionCosts'
import { getMarketCopy } from '../services/marketCopy'
import {
  isCryptoActionableResult,
  isCryptoAutoEligibleResult,
  sortByCryptoAutoScore,
} from '../services/cryptoRules'
import {
  isActionableResult,
  isAutoEligibleResult,
  sortByAutoScore,
} from '../services/tradingRules'
import {
  filterEquityRowsByUsMarketContext,
  getUsMarketContextSummary,
} from '../services/usMarketContext'
import {
  loadRemoteTradingState,
  saveRemoteTradingState,
} from '../services/remoteState'
import {
  isRealtimeConfigured,
  subscribeToStateEvents,
} from '../services/realtimeState'
import { useAuth } from '../services/useAuth'
import { safeGetItem, safeSetItem } from '../services/safeStorage'
import { convertToBaseCurrency, fetchFxRateToEur } from '../services/currency'
import { getTickerCurrency } from '../services/marketUniverse'
import {
  getMarketCloseGuardLabel,
  getMarketScanStartLabel,
  getMarketSessionStatus,
  getPreCloseProtectionDecision,
  isMarketCloseGuardActive,
  isMarketScanBlocked,
} from '../services/marketHours'
import {
  DEFAULT_MARKET_ID,
  TRADING_STRATEGIES,
  getTradingStrategy,
} from '../strategies'
import { RISK_RECOVERY_MAX_OPENINGS } from '../services/engine/constants'
import { roundPrice } from '../services/engine/format'
import {
  appendActivity,
  appendLogs,
  createActivity,
} from '../services/engine/activity'
import {
  appendOrders,
  createSimulationOrder,
  getCloseOrderSide,
  getOpenOrderSide,
} from '../services/engine/orders'
import {
  STORAGE_VERSION,
  createInitialState,
  getNextScanAt,
  normalizeMarketState,
  syncActiveMarketState,
} from '../services/engine/state'
import {
  getOpeningOrderBlockReason,
  getRiskAdjustedPositionSize,
  getRiskGovernorState,
} from '../services/engine/risk'
import { isMarketDataStale } from '../services/engine/marketCalendar'
import {
  buildTrade,
  evaluateCostViability,
  evaluateProfitExit,
  getCloseReasonText,
  getProtectedStopLoss,
  getSignalType,
  getStrategyMaxPositions,
} from '../services/engine/trades'
import { TradingContext } from './tradingState'

const STORAGE_KEY = 'spapple_state'
const LIVE_MONITOR_INTERVAL_MS = 60_000
const REMOTE_REFRESH_INTERVAL_MS = 3_000
const STALE_SYNC_THRESHOLD_MS = 10_000
const PRICE_FETCH_TIMEOUT_MS = 15_000
function getMarketScannerConfig(marketId) {
  const strategy = getTradingStrategy(marketId)

  if (marketId === 'crypto') {
    return {
      errorLabel: 'Kraken',
      fetcher: fetchCryptoMarketData,
      isActionable: isCryptoActionableResult,
      isAutoEligible: isCryptoAutoEligibleResult,
      provider: 'Kraken + CoinGecko',
      sortByScore: sortByCryptoAutoScore,
      universe: CRYPTO_TICKERS,
      contextFetcher: null,
    }
  }

  return {
    errorLabel: 'EODHD / Yahoo Finance',
    fetcher: fetchMarketData,
    isActionable: isActionableResult,
    isAutoEligible: isAutoEligibleResult,
    provider: 'EODHD / Yahoo Finance',
    sortByScore: sortByAutoScore,
    universe: strategy.universe,
    contextFetcher: marketId === 'equities' ? fetchUsMarketContext : null,
  }
}

function filterAutomaticRowsByMarketContext(rows, marketId, usMarketContext) {
  if (marketId !== 'equities') {
    return rows
  }

  return filterEquityRowsByUsMarketContext(rows, usMarketContext)
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

function updateMarketState(state, marketId, marketState) {
  const syncedState = syncActiveMarketState(state)
  const activeMarket = syncedState.activeMarket || DEFAULT_MARKET_ID
  const normalizedMarketState = normalizeMarketState(marketId, marketState)
  const markets = {
    ...(syncedState.markets || {}),
    [marketId]: normalizedMarketState,
  }
  const activeMarketState = normalizeMarketState(
    activeMarket,
    markets[activeMarket],
  )

  return {
    ...syncedState,
    activeMarket,
    markets,
    ...activeMarketState,
    version: STORAGE_VERSION,
  }
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
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
    stateRevision: Number.isFinite(Number(parsedState.stateRevision))
      ? Number(parsedState.stateRevision)
      : 0,
    lastStateMutationAt: parsedState.lastStateMutationAt || null,
    lastStateMutationSource: parsedState.lastStateMutationSource || 'iniziale',
    lastStateMutationSummary:
      parsedState.lastStateMutationSummary || 'Stato iniziale Spapple.',
    activeMarket,
    markets,
    ...activeMarketState,
  })
}

function loadInitialState() {
  try {
    const storedState = safeGetItem(STORAGE_KEY)

    if (!storedState) {
      return createInitialState()
    }

    const parsedState = JSON.parse(storedState)

    return normalizeStoredState(parsedState)
  } catch {
    return createInitialState()
  }
}

function getPositionEntryPriceEur(position) {
  const explicitPrice = Number(position.entryPriceEur)

  if (Number.isFinite(explicitPrice) && explicitPrice > 0) {
    return explicitPrice
  }

  const entryPrice = Number(position.entryPrice)
  const fxToEur = Number(position.entryFxToEur || position.fxToEur || 1)

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return null
  }

  return entryPrice * (Number.isFinite(fxToEur) && fxToEur > 0 ? fxToEur : 1)
}

function getPositionLatestPriceEur(position, latestPrice, priceData = {}) {
  const explicitPrice = Number(priceData?.latestPriceEur)

  if (Number.isFinite(explicitPrice) && explicitPrice > 0) {
    return explicitPrice
  }

  const price = Number(latestPrice)
  const fxToEur = Number(
    priceData?.fxToEur ||
      priceData?.latestFxToEur ||
      position.latestFxToEur ||
      position.entryFxToEur ||
      position.fxToEur ||
      1,
  )

  if (!Number.isFinite(price) || price <= 0) {
    return null
  }

  return price * (Number.isFinite(fxToEur) && fxToEur > 0 ? fxToEur : 1)
}

function calculatePositionExecutionSnapshot(position, latestPrice, priceData = {}) {
  const invested = Number(position.invested || LEGACY_POSITION_SIZE)
  const entryPriceEur = getPositionEntryPriceEur(position)
  const latestFxToEur = Number(
    priceData?.fxToEur ||
      priceData?.latestFxToEur ||
      position.latestFxToEur ||
      position.entryFxToEur ||
      position.fxToEur ||
      1,
  )
  const quantity =
    Number.isFinite(Number(position.quantity)) && Number(position.quantity) > 0
      ? Number(position.quantity)
      : invested / entryPriceEur
  const theoreticalLatestPriceEur = getPositionLatestPriceEur(
    position,
    latestPrice,
    priceData,
  )

  if (
    !Number.isFinite(invested) ||
    invested <= 0 ||
    !Number.isFinite(entryPriceEur) ||
    entryPriceEur <= 0 ||
    !Number.isFinite(theoreticalLatestPriceEur) ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return null
  }

  const closeExecutionCosts = applyExecutionCosts({
    atr: position.atrAtEntry,
    currency: position.currency || getTickerCurrency(position.ticker),
    fxToEur: latestFxToEur,
    marketId: position.marketId || DEFAULT_MARKET_ID,
    notionalEur: theoreticalLatestPriceEur * quantity,
    phase: 'CLOSE',
    price: latestPrice,
    ticker: position.ticker,
    type: position.type,
  })
  const effectiveLatestPrice = Number(closeExecutionCosts.effectivePrice)
  const effectiveLatestPriceEur =
    Number(closeExecutionCosts.effectivePriceEur) ||
    getPositionLatestPriceEur(position, effectiveLatestPrice, priceData)
  const long = position.type === 'LONG'
  const grossPnlEur = long
    ? (effectiveLatestPriceEur - entryPriceEur) * quantity
    : (entryPriceEur - effectiveLatestPriceEur) * quantity
  const openCommissionEur = getPositionOpenCommissionEur(position)
  const closeCommissionEur = getExecutionFeesEur(closeExecutionCosts)
  const pnlEur = grossPnlEur - openCommissionEur - closeCommissionEur

  return {
    closeExecutionCosts,
    closeCommissionEur,
    effectiveLatestPrice,
    effectiveLatestPriceEur,
    grossPnlEur,
    openCommissionEur,
    pnlEur,
    quantity,
    theoreticalLatestPriceEur,
  }
}

function evaluatePositions(
  current,
  positionsWithPrices,
  { forceCloseReason = null, incrementDays, source = 'monitor' },
) {
  let capital = current.capital
  let vault = current.vault
  const activePositions = []
  const closedTrades = []
  const closeOrders = []

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
    const executionSnapshot = calculatePositionExecutionSnapshot(
      position,
      latestPrice,
      priceData,
    )
    const pnlEur = executionSnapshot?.pnlEur

    if (!Number.isFinite(Number(pnlEur))) {
      activePositions.push(updatedPosition)
      return
    }

    const positionStrategy = getTradingStrategy(
      position.marketId || current.marketId || current.activeMarket,
    )
    const sessionStatus = getMarketSessionStatus(
      positionStrategy,
      new Date(),
      position.ticker,
    )
    const preCloseDecision = getPreCloseProtectionDecision({
      position,
      latestPrice,
      pnlEur,
      sessionStatus,
    })
    const long = position.type === 'LONG'
    const monitoredPosition = {
      ...updatedPosition,
      executionCosts: {
        ...(position.executionCosts || {}),
        latestClose: executionSnapshot.closeExecutionCosts,
      },
      latestMarketPrice: roundPrice(latestPrice),
      latestPrice: roundPrice(executionSnapshot.effectiveLatestPrice),
      latestFxToEur:
        Number(priceData?.fxToEur || priceData?.latestFxToEur) ||
        position.latestFxToEur ||
        position.entryFxToEur ||
        1,
      latestPriceEur: roundPrice(executionSnapshot.effectiveLatestPriceEur),
      latestPriceAt: new Date().toISOString(),
      unrealizedPnl: roundPrice(pnlEur),
      preCloseRiskScore: preCloseDecision.riskScore,
      preCloseRiskMessage: preCloseDecision.message,
    }
    const profitExit = evaluateProfitExit(position, latestPrice)
    const effectiveStopLoss = getProtectedStopLoss(position, profitExit)
    const lockProtected =
      Number.isFinite(Number(effectiveStopLoss)) &&
      roundPrice(effectiveStopLoss) === roundPrice(position.entryPrice) &&
      Boolean(
        position.profitLockArmed || profitExit.monitoredFields?.profitLockArmed,
      )
    const isLoss = long
      ? latestPrice <= effectiveStopLoss
      : latestPrice >= effectiveStopLoss
    const isForcedClose = Boolean(forceCloseReason)
    const isPreCloseClose = preCloseDecision.shouldClose

    if (!isForcedClose && !isPreCloseClose && !profitExit.isWin && !isLoss) {
      activePositions.push({
        ...monitoredPosition,
        ...profitExit.monitoredFields,
        stopLoss: Number.isFinite(Number(effectiveStopLoss))
          ? roundPrice(effectiveStopLoss)
          : monitoredPosition.stopLoss,
      })
      return
    }

    const roundedPnl = roundPrice(pnlEur)
    const invested = investedAtRisk
    const recoveredCapital = Math.max(
      invested + executionSnapshot.grossPnlEur - executionSnapshot.closeCommissionEur,
      0,
    )
    const isProfitableExit = profitExit.isWin && roundedPnl > 0
    const exitReason = isForcedClose
      ? forceCloseReason
      : isPreCloseClose
        ? preCloseDecision.exitReason
        : isProfitableExit
          ? profitExit.exitReason
          : lockProtected && roundedPnl >= 0
            ? 'BREAK_EVEN_STOP'
            : 'STOP_LOSS'
    const result = roundedPnl >= 0 ? 'WIN' : 'LOSS'
    const pnlOriginal = long
      ? (executionSnapshot.effectiveLatestPrice - position.entryPrice) *
        executionSnapshot.quantity
      : (position.entryPrice - executionSnapshot.effectiveLatestPrice) *
        executionSnapshot.quantity
    const closeOrder = createSimulationOrder({
      action: 'CLOSE',
      direction: position.type,
      executedPrice: executionSnapshot.effectiveLatestPrice,
      executedPriceEur: executionSnapshot.effectiveLatestPriceEur,
      executionCosts: executionSnapshot.closeExecutionCosts,
      fee: executionSnapshot.closeCommissionEur,
      marketId: position.marketId || current.marketId,
      marketLabel: position.marketLabel || current.marketLabel,
      notional: recoveredCapital,
      positionId: position.id,
      quantity: position.quantity || executionSnapshot.quantity,
      requestedPrice: latestPrice,
      reason: getCloseReasonText(exitReason, source, positionStrategy),
      side: getCloseOrderSide(position.type),
      source,
      ticker: position.ticker,
    })

    capital += recoveredCapital
    vault += Math.max(roundedPnl, 0)

    closeOrders.push(closeOrder)
    closedTrades.push({
      ticker: position.ticker,
      type: position.type,
      positionId: position.id,
      closeOrderId: closeOrder.id,
      openedAt: position.openedAt || null,
      entryPrice: position.entryPrice,
      entryPriceEur: roundPrice(getPositionEntryPriceEur(position)),
      currency: position.currency || getTickerCurrency(position.ticker),
      entryFxToEur: position.entryFxToEur || 1,
      entrySignalPrice: position.entrySignalPrice || position.entryPrice,
      entrySignalPriceEur:
        position.entrySignalPriceEur || getPositionEntryPriceEur(position),
      invested,
      executionCosts: {
        ...(position.executionCosts || {}),
        close: executionSnapshot.closeExecutionCosts,
      },
      grossPnlEur: roundPrice(executionSnapshot.grossPnlEur),
      totalCostsEur: roundPrice(
        executionSnapshot.openCommissionEur + executionSnapshot.closeCommissionEur,
      ),
      pnlOriginal: roundPrice(pnlOriginal),
      pnlEur: roundedPnl,
      result,
      exitDate: new Date().toISOString(),
      exitSignalPrice: roundPrice(latestPrice),
      exitSignalPriceEur: roundPrice(executionSnapshot.theoreticalLatestPriceEur),
      exitPrice: roundPrice(executionSnapshot.effectiveLatestPrice),
      exitPriceEur: roundPrice(executionSnapshot.effectiveLatestPriceEur),
      exitFxToEur: monitoredPosition.latestFxToEur,
      preCloseRiskScore: preCloseDecision.riskScore,
      preCloseRiskMessage: preCloseDecision.message,
      exitReason,
      recoveredCapital: roundPrice(recoveredCapital),
    })
  })

  return {
    capital: roundPrice(capital),
    vault: roundPrice(vault),
    activePositions,
    closedTrades,
    closeOrders,
  }
}

export function TradingProvider({ children }) {
  const { isAuthenticated } = useAuth()
  const [state, setState] = useState(loadInitialState)
  const [remoteStatus, setRemoteStatus] = useState('disconnesso')
  const [syncMeta, setSyncMeta] = useState({
    mode: isRealtimeConfigured() ? 'realtime' : 'polling',
    status: 'disconnesso',
    lastSyncedAt: null,
    lastRemoteUpdatedAt: null,
    lastEventAt: null,
    stateRevision: state.stateRevision || 0,
    isStale: false,
    message: 'Sincronizzazione non ancora avviata.',
  })
  const stateRef = useRef(state)
  const remoteReadyRef = useRef(false)
  const remoteUpdatedAtRef = useRef(null)
  const remoteSaveTimerRef = useRef(null)
  const skipNextRemoteSaveRef = useRef(false)
  const applyingRemoteStateRef = useRef(false)
  const syncTickRef = useRef(null)
  const liveCheckRunningRef = useRef(false)
  const automatedScanRunningRef = useRef(false)
  const scanRunningRef = useRef(new Set())
  const closingPositionsRef = useRef(new Set())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    safeSetItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const applyRemoteSnapshot = useCallback((remoteState, message = 'Dati sincronizzati.') => {
    if (!remoteState?.payload) {
      return null
    }

    const hydratedState = normalizeStoredState(remoteState.payload)

    applyingRemoteStateRef.current = true
    skipNextRemoteSaveRef.current = true
    remoteUpdatedAtRef.current = remoteState.updatedAt || null
    stateRef.current = hydratedState
    setState(hydratedState)
    safeSetItem(STORAGE_KEY, JSON.stringify(hydratedState))
    setSyncMeta((current) => ({
      ...current,
      status: 'live',
      lastSyncedAt: new Date().toISOString(),
      lastRemoteUpdatedAt: remoteState.updatedAt || current.lastRemoteUpdatedAt,
      stateRevision: hydratedState.stateRevision || remoteState.stateRevision || 0,
      isStale: false,
      message,
    }))

    queueMicrotask(() => {
      applyingRemoteStateRef.current = false
    })

    return hydratedState
  }, [])

  const refreshRemoteState = useCallback(async ({
    force = false,
    reason = 'refresh',
  } = {}) => {
    setSyncMeta((current) => ({
      ...current,
      status: current.status === 'disconnesso' ? 'caricamento' : 'sync',
      message:
        reason === 'azione-critica'
          ? 'Controllo lo stato remoto prima di procedere.'
          : 'Sto verificando gli aggiornamenti remoti.',
    }))

    const remoteState = await loadRemoteTradingState()
    const hasChanged =
      force ||
      !remoteState.updatedAt ||
      remoteState.updatedAt !== remoteUpdatedAtRef.current ||
      Number(remoteState.stateRevision || remoteState.payload?.stateRevision || 0) >
        Number(stateRef.current.stateRevision || 0)

    if (hasChanged) {
      return applyRemoteSnapshot(remoteState, 'Dati aggiornati da Supabase.')
    }

    setSyncMeta((current) => ({
      ...current,
      status: 'live',
      lastSyncedAt: new Date().toISOString(),
      isStale: false,
      message: 'Dati già allineati.',
    }))

    return syncActiveMarketState(stateRef.current)
  }, [applyRemoteSnapshot])

  useEffect(() => {
    if (!isAuthenticated) {
      remoteReadyRef.current = false
      setRemoteStatus('disconnesso')
      setSyncMeta((current) => ({
        ...current,
        status: 'disconnesso',
        isStale: true,
        message: 'Accesso richiesto per sincronizzare i dati.',
      }))
      return
    }

    let cancelled = false

    async function hydrateRemoteState() {
      setRemoteStatus('caricamento')
      setSyncMeta((current) => ({
        ...current,
        status: 'caricamento',
        message: 'Carico lo stato autorevole da Supabase.',
      }))

      try {
        const remoteState = await loadRemoteTradingState()

        if (cancelled) {
          return
        }

        if (remoteState.payload) {
          const hydratedState = applyRemoteSnapshot(
            remoteState,
            'Stato autorevole caricato da Supabase.',
          )

          if (remoteState.payload.version !== STORAGE_VERSION) {
            const result = await saveRemoteTradingState(hydratedState, {
              source: 'migrazione-browser',
              summary: 'Stato aggiornato alla versione corrente dell’app.',
            })
            applyRemoteSnapshot(result, 'Stato migrato e riallineato.')
          }
        } else {
          const result = await saveRemoteTradingState(stateRef.current, {
            source: 'inizializzazione-browser',
            summary: 'Stato iniziale creato dal browser.',
          })
          applyRemoteSnapshot(result, 'Stato iniziale salvato su Supabase.')
        }

        remoteReadyRef.current = true
        setRemoteStatus('sincronizzato')
      } catch (error) {
        if (!cancelled) {
          remoteReadyRef.current = false
          setRemoteStatus(`errore: ${error.message}`)
          setSyncMeta((current) => ({
            ...current,
            status: 'errore',
            isStale: true,
            message: error.message || 'Sincronizzazione remota non disponibile.',
          }))
        }
      }
    }

    hydrateRemoteState()

    return () => {
      cancelled = true
    }
  }, [applyRemoteSnapshot, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !remoteReadyRef.current) {
      return undefined
    }

    if (applyingRemoteStateRef.current || skipNextRemoteSaveRef.current) {
      skipNextRemoteSaveRef.current = false
      return undefined
    }

    clearTimeout(remoteSaveTimerRef.current)
    remoteSaveTimerRef.current = setTimeout(async () => {
      try {
        const result = await saveRemoteTradingState(stateRef.current, {
          source: 'frontend',
          summary: stateRef.current.lastStateMutationSummary || 'Stato aggiornato dal browser.',
        })
        applyRemoteSnapshot(result, 'Modifica salvata e confermata da Supabase.')
        setRemoteStatus('sincronizzato')
      } catch (error) {
        setRemoteStatus(`errore: ${error.message}`)
        setSyncMeta((current) => ({
          ...current,
          status: 'errore',
          isStale: true,
          message: error.message || 'Salvataggio remoto non riuscito.',
        }))
      }
    }, 600)

    return () => {
      clearTimeout(remoteSaveTimerRef.current)
    }
  }, [applyRemoteSnapshot, isAuthenticated, state])

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined
    }

    const intervalId = window.setInterval(async () => {
      if (!remoteReadyRef.current) {
        return
      }

      try {
        await refreshRemoteState({ reason: 'polling' })
        setRemoteStatus('sincronizzato')
      } catch (error) {
        setRemoteStatus(`errore: ${error.message}`)
        setSyncMeta((current) => ({
          ...current,
          status: 'errore',
          isStale: true,
          message: error.message || 'Refresh remoto non riuscito.',
        }))
      }
    }, REMOTE_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isAuthenticated, refreshRemoteState])

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined
    }

    return subscribeToStateEvents(
      async (event) => {
        if (!remoteReadyRef.current) {
          return
        }

        setSyncMeta((current) => ({
          ...current,
          status: 'sync',
          lastEventAt: event?.created_at || new Date().toISOString(),
          message: event?.summary || 'Aggiornamento remoto ricevuto.',
        }))

        try {
          await refreshRemoteState({ force: true, reason: 'realtime' })
        } catch (error) {
          setSyncMeta((current) => ({
            ...current,
            status: 'errore',
            isStale: true,
            message: error.message || 'Evento realtime non riallineato.',
          }))
        }
      },
      (status) => {
        setSyncMeta((current) => ({
          ...current,
          mode: isRealtimeConfigured() ? 'realtime' : 'polling',
          status:
            status === 'SUBSCRIBED'
              ? 'live'
              : status === 'non_configurato'
                ? current.status
                : current.status === 'disconnesso'
                  ? 'caricamento'
                  : current.status,
          message:
            status === 'SUBSCRIBED'
              ? 'Realtime attivo: gli aggiornamenti arrivano senza refresh.'
              : status === 'non_configurato'
                ? 'Realtime non configurato: uso polling ogni 3 secondi.'
                : current.message,
        }))
      },
    )
  }, [isAuthenticated, refreshRemoteState])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      syncTickRef.current = Date.now()
      setSyncMeta((current) => {
        const lastSyncedAt = current.lastSyncedAt
          ? new Date(current.lastSyncedAt).getTime()
          : 0
        const isStale =
          !lastSyncedAt || Date.now() - lastSyncedAt > STALE_SYNC_THRESHOLD_MS

        if (current.isStale === isStale) {
          return current
        }

        return {
          ...current,
          isStale,
          status: isStale ? 'stale' : current.status,
          message: isStale
            ? 'Dati non aggiornati da oltre 10 secondi.'
            : current.message,
        }
      })
    }, 1_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  const updateTradingState = useCallback((updater, { persist = true } = {}) => {
    const now = new Date().toISOString()
    const nextState = syncActiveMarketState({
      ...updater(stateRef.current),
      lastStateMutationAt: now,
      lastStateMutationSource: 'browser',
      lastStateMutationSummary: 'Modifica locale in attesa di conferma Supabase.',
    })

    if (!persist) {
      skipNextRemoteSaveRef.current = true
    }

    stateRef.current = nextState
    setState(nextState)
    setSyncMeta((current) => ({
      ...current,
      status: 'sync',
      isStale: false,
      message: 'Modifica locale salvata, attendo conferma Supabase.',
    }))
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

  const setKillSwitchEnabled = useCallback((enabled, targetMarketId = null) => {
    updateTradingState((current) => {
      const syncedCurrent = syncActiveMarketState(current)
      const marketId = targetMarketId || syncedCurrent.activeMarket
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        killSwitchEnabled: enabled,
        engineStatus: enabled
          ? 'Kill switch attivo'
          : 'Kill switch disattivato',
        ...appendLogs(
          marketState,
          createActivity({
            type: 'risk',
            status: enabled ? 'error' : 'done',
            title: enabled
              ? 'Kill switch attivato'
              : 'Kill switch disattivato',
            detail: enabled
              ? 'Nuove aperture bloccate. Le posizioni gia aperte restano monitorate.'
              : 'Le nuove aperture tornano disponibili nel rispetto dei limiti rischio.',
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
      const scannerConfig = getMarketScannerConfig(marketId)
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        isScanning: true,
        lastDataProvider: scannerConfig.provider,
        lastAutomationMessage: `Sto leggendo dati reali da ${scannerConfig.provider}.`,
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
    }, { persist: false })
  }, [updateTradingState])

  const recordScanComplete = useCallback(({ scannedCount, signalCount, results, usMarketContext }, targetMarketId = null) => {
    updateTradingState((current) => {
      const marketId = targetMarketId || current.activeMarket
      const marketCopy = getMarketCopy(marketId)
      const scannerConfig = getMarketScannerConfig(marketId)
      const completedAt = new Date()
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        isScanning: false,
        lastDataProvider: scannerConfig.provider,
        lastSyncAt: completedAt.toISOString(),
        lastScanAt: completedAt.toISOString(),
        lastScanCount: scannedCount,
        lastSignalCount: signalCount,
        nextScanAt: getNextScanAt(marketId, completedAt),
        lastScanResults: Array.isArray(results)
          ? results
          : marketState.lastScanResults,
        usMarketContext: usMarketContext || marketState.usMarketContext,
        engineStatus:
          signalCount > 0
            ? 'Segnali disponibili'
            : 'Nessun segnale operativo',
        lastAutomationMessage:
          signalCount > 0
            ? `${signalCount} segnali validi trovati. ${
                usMarketContext
                  ? `${getUsMarketContextSummary(usMarketContext)} `
                  : ''
              }Valuto aperture automatiche se gli slot e i limiti rischio lo consentono.`
            : `Dati aggiornati da ${scannerConfig.provider}. ${
                usMarketContext ? `${getUsMarketContextSummary(usMarketContext)} ` : ''
              }Nessun segnale operativo ora.`,
        ...appendLogs(
          marketState,
          createActivity({
            type: 'scan',
            status: signalCount > 0 ? 'attention' : 'done',
            title: `Scansione ${marketCopy.label} completata`,
            detail:
              signalCount > 0
                ? `${signalCount} segnali validi trovati su ${scannedCount} ${marketCopy.assetPlural}.${
                    usMarketContext
                      ? ` ${getUsMarketContextSummary(usMarketContext)}`
                      : ''
                  }`
                : `${scannedCount} ${marketCopy.assetPlural} controllati. Nessun asset rispetta le regole operative.${
                    usMarketContext
                      ? ` ${getUsMarketContextSummary(usMarketContext)}`
                      : ''
                  }`,
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
      const failedAt = new Date()
      const syncedCurrent = syncActiveMarketState(current)
      const marketState = normalizeMarketState(
        marketId,
        syncedCurrent.markets?.[marketId],
      )
      const nextMarketState = {
        ...marketState,
        isScanning: false,
        lastSyncAt: failedAt.toISOString(),
        nextScanAt: getNextScanAt(marketId, failedAt),
        lastAutomationMessage:
          message ||
          `${marketCopy.provider} non ha restituito dati utilizzabili.`,
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

  const executeTrade = useCallback((ticker, price, atr, type, profile = null, targetMarketId = null, marketData = {}) => {
    const current = syncActiveMarketState(stateRef.current)
    const marketId = targetMarketId || current.activeMarket
    const strategy = getTradingStrategy(marketId)
    const marketState = normalizeMarketState(marketId, current.markets?.[marketId])
    const sizing = strategy.positionSizing
    const maxPositions = getStrategyMaxPositions(strategy)
    const riskState = getRiskGovernorState(marketState, strategy)

    if (!['LONG', 'SHORT'].includes(type)) {
      throw new Error('Tipo ordine non valido')
    }

    if (marketState.positions.length >= maxPositions) {
      throw new Error('Slot operativi esauriti')
    }

    const positionSize = getRiskAdjustedPositionSize(
      marketState.capital,
      sizing,
      riskState,
    )

    if (!canOpenPosition(marketState.capital, sizing)) {
      throw new Error('Capitale operativo insufficiente')
    }

    if (marketState.positions.some((position) => position.ticker === ticker)) {
      throw new Error(`${ticker} è già presente in portafoglio`)
    }

    const blockReason = getOpeningOrderBlockReason(
      { ...marketState, pendingTicker: ticker },
      positionSize,
      strategy,
    )

    if (blockReason) {
      const rejectedOrder = createSimulationOrder({
        action: 'OPEN',
        direction: type,
        marketId,
        marketLabel: strategy.label,
        notional: positionSize,
        requestedPrice: price,
        reason: blockReason,
        side: getOpenOrderSide(type),
        source: 'manual',
        status: 'RIFIUTATO',
        ticker,
      })
      const nextMarketState = {
        ...marketState,
        orders: appendOrders(marketState, rejectedOrder),
        engineStatus: 'Ordine simulato rifiutato',
        ...appendLogs(
          marketState,
          createActivity({
            type: 'order',
            status: 'error',
            title: 'Ordine simulato rifiutato',
            detail: `${ticker}: ${blockReason}`,
          }),
        ),
      }
      const nextState = activateMarketState(current, marketId, nextMarketState)

      stateRef.current = nextState
      setState(nextState)
      throw new Error(blockReason)
    }

    let order = createSimulationOrder({
      action: 'OPEN',
      direction: type,
      executedPrice: price,
      marketId,
      marketLabel: strategy.label,
      notional: positionSize,
      requestedPrice: price,
      reason: 'Apertura manuale confermata dallo Scanner.',
      side: getOpenOrderSide(type),
      source: 'manual',
      ticker,
    })
    const trade = buildTrade({
      ticker,
      price,
      atr,
      type,
      invested: positionSize,
      profile,
      strategy,
      order,
      marketData,
    })
    const openCommissionEur = getExecutionFeesEur(trade.executionCosts?.open)

    if (marketState.capital < positionSize + openCommissionEur) {
      throw new Error('Capitale insufficiente per coprire importo e commissione di apertura')
    }

    order = {
      ...order,
      executedPrice: trade.entryPrice,
      executedPriceEur: trade.entryPriceEur,
      executionCosts: trade.executionCosts.open,
      fee: openCommissionEur,
      positionId: trade.id,
      quantity: trade.quantity,
    }
    const nextMarketState = {
      ...marketState,
      capital: roundPrice(marketState.capital - positionSize - openCommissionEur),
      positions: [...marketState.positions, trade],
      orders: appendOrders(marketState, order),
      engineStatus: 'Posizione aperta',
      ...appendLogs(
        marketState,
        createActivity({
          type: 'order',
          status: 'done',
          title: `Ordine simulato ${type === 'LONG' ? 'Long' : 'Short'} eseguito`,
          detail: `${ticker}: ordine ${order.id} eseguito a ${roundPrice(
            price,
          )}. Posizione da ${positionSize.toFixed(
            2,
          )}€ allocata. Take profit ${roundPrice(
            trade.takeProfit,
          )}${
            trade.finalTakeProfit
              ? `, target massimo ${roundPrice(trade.finalTakeProfit)}`
              : ''
          }, stop loss ${roundPrice(trade.stopLoss)}.`,
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
    const marketCopy = getMarketCopy(marketId)
    const marketState = normalizeMarketState(marketId, current.markets?.[marketId])
    const sizing = strategy.positionSizing
    const maxPositions = getStrategyMaxPositions(strategy)
    const riskState = getRiskGovernorState(marketState, strategy)
    let capital = marketState.capital
    const positions = [...marketState.positions]
    let orders = marketState.orders || []
    const openedTrades = []
    const skippedTickers = []
    let activityLog = marketState.activityLog || []
    let events = marketState.events || []

    const appendLocalLog = (activity) => {
      activityLog = appendActivity({ activityLog }, activity)
      events = [activity, ...events]
    }

    if (isMarketScanBlocked(strategy)) {
      const closeGuardActive = isMarketCloseGuardActive(strategy)
      const activity = createActivity({
        type: 'automation',
        status: 'waiting',
        title: closeGuardActive
          ? `Protezione ${marketCopy.label} ${getMarketCloseGuardLabel(strategy)} attiva`
          : `${marketCopy.label} in attesa delle ${getMarketScanStartLabel(strategy)}`,
        detail: closeGuardActive
          ? `${marketCopy.label} fermo: nuove aperture bloccate fino alla prossima seduta.`
          : `${marketCopy.label} fermo: prima scansione consentita alle ${getMarketScanStartLabel(strategy)}.`,
      })
      appendLocalLog(activity)

      const nextMarketState = {
        ...marketState,
        engineStatus: closeGuardActive
          ? `Protezione ${marketCopy.label} ${getMarketCloseGuardLabel(strategy)} attiva`
          : `In attesa delle ${getMarketScanStartLabel(strategy)}`,
        nextScanAt: getNextScanAt(marketId),
        activityLog,
        events,
      }
      const nextState = activateMarketState(current, marketId, nextMarketState)

      stateRef.current = nextState
      setState(nextState)

      return {
        openedTrades,
        riskState,
        skippedTickers: rows.map((row) => row.ticker),
      }
    }

    const rowsAllowedByContext = filterAutomaticRowsByMarketContext(
      rows,
      marketId,
      marketState.usMarketContext,
    )
    const candidateRows =
      riskState.mode === 'recovery'
        ? rowsAllowedByContext.slice(0, RISK_RECOVERY_MAX_OPENINGS)
        : rowsAllowedByContext

    rows
      .filter((row) => !rowsAllowedByContext.includes(row))
      .forEach((row) => skippedTickers.push(row.ticker))

    rowsAllowedByContext
      .filter((row) => !candidateRows.includes(row))
      .forEach((row) => skippedTickers.push(row.ticker))

    candidateRows.forEach((row) => {
      if (
        Number.isFinite(Number(riskState.maxOpenings)) &&
        openedTrades.length >= Number(riskState.maxOpenings)
      ) {
        skippedTickers.push(row.ticker)
        return
      }

      const type = getSignalType(row, strategy)
      const alreadyOpen = positions.some(
        (position) => position.ticker === row.ticker,
      )
      const canOpen =
        ['LONG', 'SHORT'].includes(type) &&
        // Rete per le chiusure lunghe che il calendario non conosce: se
        // l'ultimo dato disponibile e troppo vecchio, quella borsa e ferma.
        !isMarketDataStale(row.latestBarDate) &&
        positions.length < maxPositions &&
        canOpenPosition(capital, sizing) &&
        !alreadyOpen

      if (!canOpen) {
        skippedTickers.push(row.ticker)
        return
      }

      const positionSize = getRiskAdjustedPositionSize(capital, sizing, riskState)

      // Guardia sui costi: un bersaglio che non copre il costo del giro e una
      // scommessa persa in partenza, qualunque cosa faccia il segnale.
      const viability = evaluateCostViability({
        ticker: row.ticker,
        price: row.currentPrice,
        atr: row.atr,
        type,
        invested: positionSize,
        strategy,
        marketData: row,
      })

      const blockReason = !viability.viable
        ? viability.reason
        : getOpeningOrderBlockReason(
            { ...marketState, capital, positions, orders, pendingTicker: row.ticker },
            positionSize,
            strategy,
          )

      if (blockReason) {
        const rejectedOrder = createSimulationOrder({
          action: 'OPEN',
          direction: type,
          marketId,
          marketLabel: strategy.label,
          notional: positionSize,
          requestedPrice: row.currentPrice,
          reason: blockReason,
          side: getOpenOrderSide(type),
          source: 'automation',
          status: 'RIFIUTATO',
          ticker: row.ticker,
        })
        orders = appendOrders({ orders }, rejectedOrder)
        skippedTickers.push(row.ticker)
        appendLocalLog(
          createActivity({
            type: 'order',
            status: 'error',
            title: 'Ordine automatico rifiutato',
            detail: `${row.ticker}: ${blockReason}`,
          }),
        )
        return
      }

      let order = createSimulationOrder({
        action: 'OPEN',
        direction: type,
        executedPrice: row.currentPrice,
        marketId,
        marketLabel: strategy.label,
        notional: positionSize,
        requestedPrice: row.currentPrice,
        reason: 'Apertura automatica da segnale validato.',
        side: getOpenOrderSide(type),
        source: 'automation',
        ticker: row.ticker,
      })
      const trade = buildTrade({
        ticker: row.ticker,
        price: row.currentPrice,
        atr: row.atr,
        type,
        invested: positionSize,
        profile: row.profile || null,
        strategy,
        order,
        marketData: row,
      })
      const openCommissionEur = getExecutionFeesEur(trade.executionCosts?.open)

      if (capital < positionSize + openCommissionEur) {
        const rejectedOrder = createSimulationOrder({
          action: 'OPEN',
          direction: type,
          marketId,
          marketLabel: strategy.label,
          notional: positionSize,
          requestedPrice: row.currentPrice,
          reason: 'Capitale insufficiente per coprire importo e commissione di apertura.',
          side: getOpenOrderSide(type),
          source: 'automation',
          status: 'RIFIUTATO',
          ticker: row.ticker,
        })
        orders = appendOrders({ orders }, rejectedOrder)
        skippedTickers.push(row.ticker)
        return
      }

      order = {
        ...order,
        executedPrice: trade.entryPrice,
        executedPriceEur: trade.entryPriceEur,
        executionCosts: trade.executionCosts.open,
        fee: openCommissionEur,
        positionId: trade.id,
        quantity: trade.quantity,
      }
      orders = appendOrders({ orders }, order)
      positions.push(trade)
      capital = roundPrice(capital - positionSize - openCommissionEur)
      openedTrades.push(trade)
      appendLocalLog(
        createActivity({
          type: 'order',
          status: 'done',
          title: `Ordine automatico simulato ${type === 'LONG' ? 'Long' : 'Short'}`,
          detail: `${row.ticker}: ordine ${order.id} eseguito, posizione da ${positionSize.toFixed(
            2,
          )}€ allocata.${
            riskState.mode === 'normal'
              ? ''
              : ` ${riskState.message || 'Size ridotta per controllo rischio.'}`
          }`,
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
                  ? riskState.message ||
                    'Segnali saltati per slot, capitale o duplicati.'
                  : 'Nessun segnale disponibile.'
              }`,
      }),
    )

    const nextMarketState = {
      ...marketState,
      capital,
      positions,
      orders,
      engineStatus:
        openedTrades.length > 0
          ? riskState.mode === 'recovery'
            ? 'Recovery eseguita'
            : 'Pilota automatico eseguito'
          : marketState.engineStatus,
      activityLog,
      events,
    }
    const nextState = activateMarketState(current, marketId, nextMarketState)

    stateRef.current = nextState
    setState(nextState)

    return { openedTrades, riskState, skippedTickers }
  }, [])

  const runAutomatedScan = useCallback(async (targetMarketId) => {
    const marketId = targetMarketId || stateRef.current.activeMarket

    if (scanRunningRef.current.has(marketId)) {
      return { openedTrades: [], skipped: true }
    }

    const strategy = getTradingStrategy(marketId)
    const scannerConfig = getMarketScannerConfig(marketId)
    const marketCopy = getMarketCopy(marketId)

    if (isMarketScanBlocked(strategy)) {
      const closeGuardActive = isMarketCloseGuardActive(strategy)
      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const marketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )

        return updateMarketState(syncedCurrent, marketId, {
          ...marketState,
          isScanning: false,
          nextScanAt: getNextScanAt(marketId),
          engineStatus: closeGuardActive
            ? `Protezione ${marketCopy.label} ${getMarketCloseGuardLabel(strategy)} attiva`
            : `${marketCopy.label} in attesa delle ${getMarketScanStartLabel(strategy)}`,
          lastAutomationMessage: closeGuardActive
            ? `${marketCopy.label} fermo: nessuna scansione o apertura prima delle ${getMarketScanStartLabel(strategy)}.`
            : `${marketCopy.label} in attesa: prossima scansione automatica alle ${getMarketScanStartLabel(strategy)}.`,
        })
      })

      return { openedTrades: [], skipped: true }
    }

    scanRunningRef.current.add(marketId)
    recordScanStart(scannerConfig.universe.length, marketId)

    try {
      const usMarketContext = scannerConfig.contextFetcher
        ? await scannerConfig.contextFetcher()
        : null
      const marketData = await scannerConfig.fetcher(scannerConfig.universe)
      const actionableRows = marketData.filter(scannerConfig.isActionable)
      const automaticRows = scannerConfig.sortByScore(
        filterAutomaticRowsByMarketContext(
          marketData.filter(scannerConfig.isAutoEligible),
          marketId,
          usMarketContext,
        ),
      )

      recordScanComplete(
        {
          scannedCount: marketData.length,
          signalCount: actionableRows.length,
          results: marketData,
          usMarketContext,
        },
        marketId,
      )

      const { openedTrades, riskState } = executeAutomatedTrades(
        automaticRows,
        marketId,
      )

      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const marketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )
        const message =
          openedTrades.length > 0
            ? `Ho aperto ${openedTrades.length} posizioni automatiche dopo dati ${scannerConfig.provider}.`
            : actionableRows.length > 0
              ? riskState?.message ||
                'Ho trovato segnali, ma nessuno abbastanza forte o apribile secondo i limiti rischio.'
              : `Dati aggiornati da ${scannerConfig.provider}. Resto in attesa del prossimo ciclo.`

        return updateMarketState(syncedCurrent, marketId, {
          ...marketState,
          isScanning: false,
          lastAutomationMessage: message,
        })
      })

      return { openedTrades, skipped: false }
    } catch (error) {
      recordScanError(error.message, marketId)
      return { openedTrades: [], skipped: false, error }
    } finally {
      scanRunningRef.current.delete(marketId)
    }
  }, [
    executeAutomatedTrades,
    recordScanComplete,
    recordScanError,
    recordScanStart,
    updateTradingState,
  ])

  const fetchPositionPrices = useCallback(async (positions, targetMarketId = null) => {
    const marketId = targetMarketId || stateRef.current.activeMarket
    return Promise.all(
      positions.map(async (position) => {
        try {
          const latestPrice = await withTimeout(
            fetchLatestPrice(position.ticker, position.marketId || marketId),
            PRICE_FETCH_TIMEOUT_MS,
            `${position.ticker}: tempo massimo superato sul prezzo aggiornato`,
          )
          const currency = position.currency || getTickerCurrency(position.ticker)
          const fx = await withTimeout(
            fetchFxRateToEur(currency),
            PRICE_FETCH_TIMEOUT_MS,
            `${position.ticker}: tempo massimo superato sul cambio ${currency}/EUR`,
          )
          const latestFxToEur = Number(fx.rate) || position.entryFxToEur || 1

          return {
            position,
            latestPrice,
            latestFxToEur,
            fxToEur: latestFxToEur,
            latestPriceEur: convertToBaseCurrency(latestPrice, latestFxToEur),
          }
        } catch (error) {
          return {
            position,
            latestPrice: Number.NaN,
            error: error.message || `${position.ticker}: prezzo non disponibile`,
          }
        }
      }),
    )
  }, [])

  const closePositionManually = useCallback(async (positionId, targetMarketId = null) => {
    if (closingPositionsRef.current.has(positionId)) {
      throw new Error('Chiusura già in corso per questa posizione')
    }

    closingPositionsRef.current.add(positionId)

    try {
      const refreshedState = await refreshRemoteState({
        force: true,
        reason: 'azione-critica',
      })
      const snapshot = syncActiveMarketState(refreshedState || stateRef.current)
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
        throw new Error('Posizione non trovata o già chiusa da un altro utente')
      }

      if (!marketState) {
        marketState = normalizeMarketState(marketId, snapshot.markets?.[marketId])
      }

      const latestPrice = await fetchLatestPrice(
        position.ticker,
        position.marketId || marketId,
      )
      const currency = position.currency || getTickerCurrency(position.ticker)
      const fx = await fetchFxRateToEur(currency)
      const exitFxToEur = Number(fx.rate) || position.entryFxToEur || 1
      const invested = position.invested || LEGACY_POSITION_SIZE
      const entryPriceEur = getPositionEntryPriceEur(position)
      const theoreticalExitPriceEur = convertToBaseCurrency(latestPrice, exitFxToEur)
      const executionSnapshot = calculatePositionExecutionSnapshot(position, latestPrice, {
        latestFxToEur: exitFxToEur,
        latestPriceEur: theoreticalExitPriceEur,
      })
      const pnlEur = executionSnapshot?.pnlEur

      if (!Number.isFinite(Number(pnlEur))) {
        throw new Error(`${position.ticker}: P/L non calcolabile`)
      }

      const pnlOriginal =
        position.type === 'LONG'
          ? (executionSnapshot.effectiveLatestPrice - position.entryPrice) *
            executionSnapshot.quantity
          : (position.entryPrice - executionSnapshot.effectiveLatestPrice) *
            executionSnapshot.quantity
      const roundedPnl = roundPrice(pnlEur)
      const result = roundedPnl >= 0 ? 'WIN' : 'LOSS'
      const recoveredCapital = Math.max(
        invested + executionSnapshot.grossPnlEur - executionSnapshot.closeCommissionEur,
        0,
      )
      const closeOrder = createSimulationOrder({
        action: 'CLOSE',
        direction: position.type,
        executedPrice: executionSnapshot.effectiveLatestPrice,
        executedPriceEur: executionSnapshot.effectiveLatestPriceEur,
        executionCosts: executionSnapshot.closeExecutionCosts,
        fee: executionSnapshot.closeCommissionEur,
        marketId,
        marketLabel: marketState.marketLabel,
        notional: recoveredCapital,
        positionId: position.id,
        quantity: position.quantity || executionSnapshot.quantity,
        requestedPrice: latestPrice,
        reason: 'Chiusura manuale richiesta dallo Scanner o dal Portafoglio.',
        side: getCloseOrderSide(position.type),
        source: 'manual',
        ticker: position.ticker,
      })
      const closedTrade = {
        ticker: position.ticker,
        type: position.type,
        positionId: position.id,
        closeOrderId: closeOrder.id,
        openedAt: position.openedAt || null,
        entryPrice: position.entryPrice,
        entryPriceEur: roundPrice(entryPriceEur || position.entryPrice),
        currency,
        entryFxToEur: position.entryFxToEur || 1,
        entrySignalPrice: position.entrySignalPrice || position.entryPrice,
        entrySignalPriceEur: position.entrySignalPriceEur || entryPriceEur,
        invested,
        executionCosts: {
          ...(position.executionCosts || {}),
          close: executionSnapshot.closeExecutionCosts,
        },
        grossPnlEur: roundPrice(executionSnapshot.grossPnlEur),
        totalCostsEur: roundPrice(
          executionSnapshot.openCommissionEur + executionSnapshot.closeCommissionEur,
        ),
        pnlOriginal: roundPrice(pnlOriginal),
        pnlEur: roundedPnl,
        result,
        exitDate: new Date().toISOString(),
        exitSignalPrice: roundPrice(latestPrice),
        exitSignalPriceEur: roundPrice(theoreticalExitPriceEur || latestPrice),
        exitPrice: roundPrice(executionSnapshot.effectiveLatestPrice),
        exitPriceEur: roundPrice(executionSnapshot.effectiveLatestPriceEur),
        exitFxToEur,
        exitReason: 'MANUALE',
        recoveredCapital: roundPrice(recoveredCapital),
      }

      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )
        const alreadyClosed = currentMarketState.history.some(
          (trade) => trade.positionId === positionId,
        )

        if (alreadyClosed) {
          return syncedCurrent
        }

        const remainingPositions = currentMarketState.positions.filter(
          (item) => item.id !== positionId,
        )
        const capitalReturn = recoveredCapital
        const vaultGain = roundedPnl > 0 ? roundedPnl : 0

        const nextMarketState = {
          ...currentMarketState,
          capital: roundPrice(currentMarketState.capital + capitalReturn),
          vault: roundPrice(currentMarketState.vault + vaultGain),
          positions: remainingPositions,
          orders: appendOrders(currentMarketState, closeOrder),
          history: [closedTrade, ...currentMarketState.history],
          engineStatus:
            remainingPositions.length > 0
              ? 'Posizione chiusa manualmente'
              : 'Slot liberato, ricerca nuovi segnali',
          ...appendLogs(
            currentMarketState,
            createActivity({
              type: 'order',
              status: result === 'WIN' ? 'attention' : 'error',
              title: 'Ordine di chiusura simulato eseguito',
              detail: `${position.ticker}: ordine ${closeOrder.id} eseguito. P/L realizzato ${roundedPnl.toFixed(
                2,
              )}€. Avvio ricerca di un nuovo asset appetibile in ${currentMarketState.marketLabel}.`,
            }),
          ),
        }

        return activateMarketState(syncedCurrent, marketId, nextMarketState)
      })

      return closedTrade
    } finally {
      closingPositionsRef.current.delete(positionId)
    }
  }, [refreshRemoteState, updateTradingState])

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

          return updateMarketState(syncedCurrent, marketId, {
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
      updateTradingState((current) => {
        const syncedCurrent = syncActiveMarketState(current)
        const currentMarketState = normalizeMarketState(
          marketId,
          syncedCurrent.markets?.[marketId],
        )

        return updateMarketState(syncedCurrent, marketId, {
          ...currentMarketState,
          nextLiveCheckAt: new Date(
            Date.now() + LIVE_MONITOR_INTERVAL_MS,
          ).toISOString(),
          lastAutomationMessage:
            currentMarketState.lastAutomationMessage ||
            'Nessuna posizione aperta: aspetto la prossima scansione automatica.',
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

      return updateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        isChecking: true,
        engineStatus: 'Monitor live in corso',
        lastAutomationMessage: `Sto controllando ${currentMarketState.positions.length} posizioni aperte con prezzi reali.`,
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
    }, { persist: false })

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

        return updateMarketState(syncedCurrent, marketId, {
          ...currentMarketState,
          isChecking: false,
          engineStatus: 'Errore monitor live',
          nextLiveCheckAt: new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString(),
          lastAutomationMessage:
            error.message || 'Prezzi aggiornati non disponibili.',
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
      const strategy = getTradingStrategy(marketId)
      const closeGuardActive = isMarketCloseGuardActive(strategy)
      const evaluatedCount = currentMarketState.positions.length
      const { capital, vault, activePositions, closedTrades, closeOrders } =
        evaluatePositions(currentMarketState, positionsWithPrices, {
          forceCloseReason: null,
          incrementDays: false,
          source: 'live-monitor',
        })

      return updateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        version: STORAGE_VERSION,
        capital,
        vault,
        positions: activePositions,
        orders: appendOrders(currentMarketState, closeOrders),
        history: [...closedTrades, ...currentMarketState.history],
        isChecking: false,
        lastSyncAt: new Date().toISOString(),
        lastLiveCheckAt: new Date().toISOString(),
        nextLiveCheckAt:
          activePositions.length > 0 && currentMarketState.liveMonitorEnabled
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        engineStatus:
          activePositions.length > 0
            ? 'Monitor live attivo'
            : closeGuardActive
              ? `Protezione azioni ${getMarketCloseGuardLabel(strategy)} completata`
              : 'In attesa di nuova scansione',
        lastAutomationMessage:
          closedTrades.length > 0
            ? closeGuardActive
              ? `${closedTrades.length} posizioni azionarie chiuse dalla protezione ${getMarketCloseGuardLabel(strategy)}.`
              : `${closedTrades.length} posizioni chiuse automaticamente.`
            : `${evaluatedCount} posizioni controllate. Nessun target o stop raggiunto.`,
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
                ? closeGuardActive
                  ? `${closedTrades.length} posizioni azionarie chiuse dalla protezione ${getMarketCloseGuardLabel(strategy)}.`
                  : `${closedTrades.length} posizioni chiuse perché hanno raggiunto target o stop.`
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
    }, { persist: false })

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
      const strategy = getTradingStrategy(marketId)
      const closeGuardActive = isMarketCloseGuardActive(strategy)
      const evaluatedCount = currentMarketState.positions.length
      const { capital, vault, activePositions, closedTrades, closeOrders } =
        evaluatePositions(currentMarketState, positionsWithPrices, {
          forceCloseReason: null,
          incrementDays: true,
          source: 'eod',
        })

      return activateMarketState(syncedCurrent, marketId, {
        ...currentMarketState,
        version: STORAGE_VERSION,
        capital,
        vault,
        positions: activePositions,
        orders: appendOrders(currentMarketState, closeOrders),
        history: [...closedTrades, ...currentMarketState.history],
        lastLiveCheckAt: new Date().toISOString(),
        nextLiveCheckAt:
          activePositions.length > 0 && currentMarketState.liveMonitorEnabled
            ? new Date(Date.now() + LIVE_MONITOR_INTERVAL_MS).toISOString()
            : null,
        engineStatus:
          activePositions.length > 0
            ? 'Posizioni in monitoraggio'
            : closeGuardActive
              ? `Protezione azioni ${getMarketCloseGuardLabel(strategy)} completata`
              : 'In attesa di nuova scansione',
        ...appendLogs(
          currentMarketState,
          createActivity({
            type: 'eod',
            status: closedTrades.length > 0 ? 'attention' : 'done',
            title: `${engineName} completato`,
            detail:
              closedTrades.length > 0
                ? closeGuardActive
                  ? `${closedTrades.length} posizioni azionarie chiuse dalla protezione ${getMarketCloseGuardLabel(strategy)}.`
                  : `${closedTrades.length} posizioni chiuse, ${activePositions.length} ancora aperte.`
                : `${evaluatedCount} posizioni controllate. Nessun target o stop loss raggiunto.`,
          }),
        ),
      })
    })
  }, [fetchPositionPrices, updateTradingState])

  useEffect(() => {
    const marketIdsToMonitor = Object.values(TRADING_STRATEGIES)
      .filter((strategy) => strategy.enabled !== false)
      .map((strategy) => strategy.id)
      .filter((marketId) => {
        const marketState = normalizeMarketState(
          marketId,
          state.markets?.[marketId],
        )

        return (
          marketState.automationEnabled &&
          marketState.liveMonitorEnabled &&
          marketState.positions.length > 0
        )
      })

    if (!isAuthenticated || marketIdsToMonitor.length === 0) {
      return undefined
    }

    const missingNextCheckIds = marketIdsToMonitor.filter((marketId) => {
      const marketState = normalizeMarketState(marketId, state.markets?.[marketId])
      return !marketState.nextLiveCheckAt
    })

    if (missingNextCheckIds.length > 0) {
      updateTradingState((current) => {
        let nextState = syncActiveMarketState(current)

        missingNextCheckIds.forEach((marketId) => {
          const marketState = normalizeMarketState(
            marketId,
            nextState.markets?.[marketId],
          )

          nextState = updateMarketState(nextState, marketId, {
            ...marketState,
            nextLiveCheckAt: new Date(
              Date.now() + LIVE_MONITOR_INTERVAL_MS,
            ).toISOString(),
          })
        })

        return nextState
      })
    }

    const intervalId = window.setInterval(async () => {
      if (liveCheckRunningRef.current) {
        return
      }

      liveCheckRunningRef.current = true

      try {
        for (const marketId of marketIdsToMonitor) {
          await runLiveCheck({ silent: true, targetMarketId: marketId })
        }
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
    state.markets,
    updateTradingState,
  ])

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined
    }

    const marketIds = Object.values(TRADING_STRATEGIES)
      .filter((strategy) => strategy.enabled !== false)
      .map((strategy) => strategy.id)

    const missingNextScanIds = marketIds.filter((marketId) => {
      const marketState = normalizeMarketState(marketId, state.markets?.[marketId])
      return !marketState.nextScanAt
    })

    if (missingNextScanIds.length > 0) {
      updateTradingState((current) => {
        let nextState = syncActiveMarketState(current)

        missingNextScanIds.forEach((marketId) => {
          const marketState = normalizeMarketState(
            marketId,
            nextState.markets?.[marketId],
          )

          nextState = updateMarketState(nextState, marketId, {
            ...marketState,
            nextScanAt: getNextScanAt(marketId),
          })
        })

        return nextState
      })
    }

    const intervalId = window.setInterval(async () => {
      if (automatedScanRunningRef.current) {
        return
      }

      const snapshot = syncActiveMarketState(stateRef.current)
      const dueMarketIds = []

      marketIds.forEach((marketId) => {
        const marketState = normalizeMarketState(
          marketId,
          snapshot.markets?.[marketId],
        )
        const dueAt = marketState.nextScanAt
          ? new Date(marketState.nextScanAt).getTime()
          : 0

        if (
          marketState.automationEnabled &&
          !marketState.isScanning &&
          Number.isFinite(dueAt) &&
          dueAt <= Date.now()
        ) {
          dueMarketIds.push(marketId)
        }
      })

      if (dueMarketIds.length === 0) {
        return
      }

      automatedScanRunningRef.current = true

      try {
        for (const marketId of dueMarketIds) {
          await runAutomatedScan(marketId)
        }
      } finally {
        automatedScanRunningRef.current = false
      }
    }, 5_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    isAuthenticated,
    runAutomatedScan,
    state.markets,
    updateTradingState,
  ])

  const value = useMemo(
    () => ({
      ...state,
      remoteStatus,
      syncMeta,
      isDataStale: Boolean(syncMeta.isStale),
      refreshRemoteState,
      closePositionManually,
      executeTrade,
      executeAutomatedTrades,
      recordActivity,
      recordScanComplete,
      recordScanError,
      recordScanStart,
      runAutomatedScan,
      runLiveCheck,
      runEOD,
      setAutomationEnabled,
      setKillSwitchEnabled,
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
      runAutomatedScan,
      runLiveCheck,
      runEOD,
      setAutomationEnabled,
      setKillSwitchEnabled,
      setLiveMonitorEnabled,
      setActiveMarket,
      state,
      remoteStatus,
      syncMeta,
      refreshRemoteState,
    ],
  )

  return (
    <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
  )
}
