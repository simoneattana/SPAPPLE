import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpenText,
  Loader2,
  Play,
  SearchX,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Skeleton } from '../components/ui/Skeleton'
import { TickerInfo } from '../components/TickerInfo'
import { MarketCountdownPanel } from '../components/MarketCountdownPanel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table'
import { useToast } from '../components/ui/useToast'
import { useTrading } from '../context/useTrading'
import { fetchMarketData, fetchUsMarketContext } from '../services/api'
import {
  formatCurrencyAmount,
  formatFxRate,
} from '../services/currency'
import { getMarketCopy } from '../services/marketCopy'
import { getTradingStrategy } from '../strategies'
import {
  MAX_AUTO_ATR_PCT,
  getAtrPct,
  getAutoScore,
  isActionableResult,
  isAutoEligibleResult,
  isRejectedResult,
  sortByAutoScore,
} from '../services/tradingRules'
import {
  filterEquityRowsByUsMarketContext,
  getUsMarketContextSummary,
} from '../services/usMarketContext'

const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const SCAN_TIMEOUT_MS = 120000

function withTimeout(promise, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(message))
    }, SCAN_TIMEOUT_MS)
  })

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId)
  })
}

function formatCurrency(value) {
  return formatCurrencyAmount(value, 'EUR')
}

function formatMarketCurrency(value, currency = 'EUR') {
  return formatCurrencyAmount(value, currency)
}

function getRowCurrency(row) {
  return row?.currency || 'EUR'
}

function getRowFxToEur(row) {
  const rate = Number(row?.fxToEur)
  return Number.isFinite(rate) && rate > 0 ? rate : 1
}

function getRowPriceEur(row) {
  const explicitPrice = Number(row?.currentPriceEur)

  if (Number.isFinite(explicitPrice)) {
    return explicitPrice
  }

  const price = Number(row?.currentPrice)

  return Number.isFinite(price) ? price * getRowFxToEur(row) : null
}

function formatNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? numberFormatter.format(value)
    : 'Non disponibile'
}

function formatDateTime(value) {
  if (!value) {
    return 'Non disponibile'
  }

  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getPositionOpenedAt(position) {
  if (position.openedAt) {
    return position.openedAt
  }

  const timestamp = Number(String(position.id || '').split('-').at(-1))
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function getPositionLivePrice(position, scanRow) {
  const latestPrice = Number(position.latestPrice)
  const scanPrice = Number(scanRow?.currentPrice)

  if (Number.isFinite(latestPrice)) {
    return latestPrice
  }

  return Number.isFinite(scanPrice) ? scanPrice : null
}

function getPositionCurrency(position, scanRow) {
  return position.currency || getRowCurrency(scanRow)
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

function getPositionLivePriceEur(position, scanRow) {
  const explicitPrice = Number(position.latestPriceEur)

  if (Number.isFinite(explicitPrice) && explicitPrice > 0) {
    return explicitPrice
  }

  const livePrice = getPositionLivePrice(position, scanRow)
  const fxToEur = Number(
    scanRow?.fxToEur ||
      position.latestFxToEur ||
      position.entryFxToEur ||
      position.fxToEur ||
      1,
  )

  if (!Number.isFinite(Number(livePrice))) {
    return null
  }

  return Number(livePrice) * (Number.isFinite(fxToEur) && fxToEur > 0 ? fxToEur : 1)
}

function getPositionPriceSource(position, scanRow) {
  if (Number.isFinite(Number(position.latestPrice))) {
    return position.latestPriceAt
      ? `Da monitor · ${formatDateTime(position.latestPriceAt)}`
      : 'Da monitor'
  }

  return scanRow ? 'Da ultima scansione' : 'In attesa monitor'
}

function calculatePositionPnl(position, scanRow) {
  const livePrice = getPositionLivePrice(position, scanRow)

  if (!Number.isFinite(Number(livePrice))) {
    return null
  }

  const invested = Number(position.invested)
  const entryPrice = getPositionEntryPriceEur(position)
  const livePriceEur = getPositionLivePriceEur(position, scanRow)

  if (
    !Number.isFinite(invested) ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(Number(livePriceEur))
  ) {
    return null
  }

  const quantity =
    Number.isFinite(Number(position.quantity)) && Number(position.quantity) > 0
      ? Number(position.quantity)
      : invested / entryPrice
  const pnl =
    position.type === 'LONG'
      ? (livePriceEur - entryPrice) * quantity
      : (entryPrice - livePriceEur) * quantity

  return pnl
}

function PriceStack({ price, currency = 'EUR', eurValue = null, fxToEur = null }) {
  return (
    <div className="min-w-32">
      <p className="font-medium text-white">
        {formatMarketCurrency(price, currency)}
      </p>
      {currency !== 'EUR' ? (
        <p className="mt-1 text-xs text-slate-500">
          {formatCurrency(eurValue)} · cambio {formatFxRate(fxToEur)}
        </p>
      ) : null}
    </div>
  )
}

function calculatePositionPnlPct(position, pnl) {
  const invested = Number(position.invested)

  if (!Number.isFinite(invested) || invested <= 0 || !Number.isFinite(Number(pnl))) {
    return null
  }

  return (Number(pnl) / invested) * 100
}

function StrategyBadge({ rsi }) {
  if (rsi < 30) {
    return <Badge variant="positive">LONG / RIALZO</Badge>
  }

  if (rsi > 70) {
    return <Badge variant="negative">SHORT / RIBASSO</Badge>
  }

  return <Badge>NEUTRALE</Badge>
}

function getRowTradeType(row) {
  if (row.rsi < 30) {
    return 'LONG'
  }

  if (row.rsi > 70) {
    return 'SHORT'
  }

  return null
}

function StrategyCell({ row, marketCopy }) {
  const type = getRowTradeType(row)
  const isLong = type === 'LONG'
  const assetLabel = marketCopy.assetSingular

  return (
    <div className="min-w-48">
      <StrategyBadge rsi={isLong ? 0 : type === 'SHORT' ? 100 : 50} />
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {isLong
          ? `Apre una posizione che guadagna se il prezzo dell’${assetLabel} sale.`
          : `Apre una posizione che guadagna se il prezzo dell’${assetLabel} scende.`}
      </p>
    </div>
  )
}

function ReasonCell({ row }) {
  const assetLabel = 'titolo'

  if (row.status !== 'ok') {
    return (
      <p className="min-w-56 text-sm leading-6 text-slate-400">
        {row.reason || 'Dati non disponibili per questo ticker.'}
      </p>
    )
  }

  if (row.rsi < 30) {
    return (
      <p className="min-w-56 text-sm leading-6 text-slate-400">
        RSI sotto 30: l’{assetLabel} risulta molto venduto e il sistema cerca
        un possibile rimbalzo.
      </p>
    )
  }

  if (row.rsi <= 70) {
    return (
      <p className="min-w-56 text-sm leading-6 text-slate-400">
        {row.reason || 'RSI in zona neutrale: nessun segnale operativo.'}
      </p>
    )
  }

  return (
    <p className="min-w-56 text-sm leading-6 text-slate-400">
      RSI sopra 70: l’{assetLabel} risulta molto comprato e il sistema cerca una
      possibile discesa.
    </p>
  )
}

function TechnicalTooltip({ row }) {
  return (
    <div className="group relative inline-flex">
      <Button size="sm" variant="ghost">
        Dati tecnici
      </Button>
      <div className="pointer-events-none absolute left-0 top-11 z-40 hidden w-80 rounded-lg border border-slate-700 bg-[#090b10] p-4 text-left shadow-2xl shadow-black/50 group-hover:block">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
              RSI
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {formatNumber(row.rsi)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
              P/E
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {formatNumber(row.pe)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
              ATR
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {formatNumber(row.atr)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-slate-500">
          Perché
        </p>
        <div className="mt-1 text-sm leading-6 text-slate-300">
          <ReasonCell row={row} />
        </div>
      </div>
    </div>
  )
}

function AutoRuleCell({ row }) {
  const atrPct = getAtrPct(row)
  const maxAtrPct = MAX_AUTO_ATR_PCT
  const eligible = isAutoEligibleResult(row)
  const score = getAutoScore(row)

  if (eligible) {
    return (
      <div className="min-w-52">
        <Badge variant="positive">AUTO OK</Badge>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          RSI forte e ATR sotto {maxAtrPct}%. Priorità: {formatNumber(score)}
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-52">
      <Badge>SOLO MANUALE</Badge>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {atrPct && atrPct > maxAtrPct
          ? `ATR ${formatNumber(atrPct)}%: volatilità troppo alta per il pilota.`
          : `RSI non abbastanza estremo per il pilota automatico.`}
      </p>
    </div>
  )
}

function InvestmentCell({ position }) {
  if (!position) {
    return (
      <div className="min-w-36">
        <p className="font-semibold text-slate-400">Non aperta</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Nessun capitale impegnato
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-36">
      <p className="font-semibold text-[var(--market-accent)]">
        {formatCurrency(position.invested)}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Capitale allocato sulla posizione aperta
      </p>
    </div>
  )
}

function getExtendedScanReason(row, scannerConfig) {
  if (row.status !== 'ok') {
    return row.reason || 'Asset escluso perché i dati reali non sono disponibili o non sono completi.'
  }

  if (scannerConfig.isActionable(row)) {
    const type = getRowTradeType(row)
    const direction =
      type === 'LONG'
        ? 'possibile rimbalzo al rialzo'
        : 'possibile correzione al ribasso'
    const autoText = scannerConfig.isAutoEligible(row)
      ? 'Il segnale è abbastanza forte per il pilota automatico.'
      : 'Il segnale è visibile, ma non abbastanza forte per l’apertura automatica.'

    return `Asset scelto dal criterio: prezzo e dati tecnici validi, RSI ${formatNumber(row.rsi)} con ${direction}. ${autoText}`
  }

  if (row.reason) {
    return row.reason
  }

  return `Titolo scartato: P/E non valido oppure RSI ${formatNumber(row.rsi)} fuori dalle zone operative richieste.`
}

function filterAutomaticRowsByContext(rows, marketId, usMarketContext) {
  if (marketId !== 'equities') {
    return rows
  }

  return filterEquityRowsByUsMarketContext(rows, usMarketContext)
}

export default function Scanner({ marketId }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [closingId, setClosingId] = useState(null)
  const autoScanStarted = useRef(false)
  const { toast } = useToast()
  const {
    automationEnabled,
    closePositionManually,
    executeAutomatedTrades,
    executeTrade,
    history,
    activeMarket,
    currentStrategy,
    lastScanAt,
    lastScanResults,
    marketLabel,
    markets,
    positions,
    maxPositions,
    recordScanComplete,
    recordScanError,
    recordScanStart,
    refreshRemoteState,
    syncMeta,
  } = useTrading()
  const effectiveMarket = marketId || activeMarket
  const effectiveStrategy = getTradingStrategy(effectiveMarket)
  const effectiveMarketLabel = effectiveStrategy.label
  const routeMarketState = markets?.[effectiveMarket] || null
  const routeAutomationEnabled =
    typeof routeMarketState?.automationEnabled === 'boolean'
      ? routeMarketState.automationEnabled
      : automationEnabled
  const routeLastScanAt = routeMarketState?.lastScanAt || lastScanAt
  const routeLastScanResults = useMemo(
    () =>
      Array.isArray(routeMarketState?.lastScanResults)
        ? routeMarketState.lastScanResults
        : lastScanResults || [],
    [lastScanResults, routeMarketState],
  )
  const routeMarketLabel = routeMarketState?.marketLabel || effectiveMarketLabel
  const routeMaxPositions = effectiveStrategy.maxPositions || maxPositions
  const routeKillSwitchEnabled = Boolean(routeMarketState?.killSwitchEnabled)
  const routeUsMarketContext = routeMarketState?.usMarketContext || null
  const scannerConfig = useMemo(() => {
    const copy = getMarketCopy(effectiveMarket)
    return {
      copy,
      provider: copy.provider,
      universe: effectiveStrategy.universe,
      fetcher: fetchMarketData,
      isActionable: isActionableResult,
      isAutoEligible: isAutoEligibleResult,
      isRejected: isRejectedResult,
      sortByScore: sortByAutoScore,
      getScore: getAutoScore,
      scanLabel: copy.assetPlural,
      diagnosticLabel: copy.assetPlural,
      errorLabel: copy.provider,
      contextFetcher: effectiveMarket === 'equities' ? fetchUsMarketContext : null,
    }
  }, [effectiveMarket, effectiveStrategy])
  const [results, setResults] = useState(
    routeLastScanResults || [],
  )
  const visiblePositions = useMemo(
    () =>
      Array.isArray(routeMarketState?.positions)
        ? routeMarketState.positions
        : activeMarket === effectiveMarket
          ? positions
          : [],
    [activeMarket, effectiveMarket, positions, routeMarketState],
  )
  const visibleHistory = useMemo(
    () =>
      Array.isArray(routeMarketState?.history)
        ? routeMarketState.history
        : activeMarket === effectiveMarket
          ? history
          : [],
    [activeMarket, effectiveMarket, history, routeMarketState],
  )
  const visibleLastScanAt = routeLastScanAt
  const visibleLastScanResults = routeLastScanResults
  const slotsFull = visiblePositions.length >= routeMaxPositions
  const getCooldownRemainingMs = useCallback(
    (ticker) => {
      if (!ticker) {
        return 0
      }

      const latestClosedTrade = visibleHistory.find(
        (trade) => trade?.ticker === ticker && trade?.exitDate,
      )

      if (!latestClosedTrade) {
        return 0
      }

      const pnlEur = Number(latestClosedTrade.pnlEur)
      const isLoss =
        latestClosedTrade.result === 'LOSS' ||
        (Number.isFinite(pnlEur) && pnlEur < 0)
      const isWin =
        latestClosedTrade.result === 'WIN' ||
        (Number.isFinite(pnlEur) && pnlEur >= 0)
      const dynamicCooldownMs = isLoss
        ? effectiveStrategy.reentryCooldownAfterLossMs
        : isWin
          ? effectiveStrategy.reentryCooldownAfterWinMs
          : null
      const cooldownMs = Number.isFinite(Number(dynamicCooldownMs))
        ? Number(dynamicCooldownMs)
        : Number(effectiveStrategy.reentryCooldownMs || 0)

      if (cooldownMs <= 0) {
        return 0
      }

      const closedAt = new Date(latestClosedTrade.exitDate).getTime()
      const remainingMs = closedAt + cooldownMs - Date.now()

      return Number.isFinite(remainingMs) && remainingMs > 0 ? remainingMs : 0
    },
    [
      effectiveStrategy.reentryCooldownAfterLossMs,
      effectiveStrategy.reentryCooldownAfterWinMs,
      effectiveStrategy.reentryCooldownMs,
      visibleHistory,
    ],
  )
  const isTickerInCooldown = useCallback(
    (ticker) => getCooldownRemainingMs(ticker) > 0,
    [getCooldownRemainingMs],
  )

  const filteredResults = useMemo(
    () => results.filter(scannerConfig.isActionable),
    [results, scannerConfig],
  )
  const autoEligibleResults = useMemo(
    () =>
      scannerConfig.sortByScore(
        filterAutomaticRowsByContext(
          results.filter(scannerConfig.isAutoEligible),
          effectiveMarket,
          routeUsMarketContext,
        ),
      ),
    [effectiveMarket, results, routeUsMarketContext, scannerConfig],
  )
  const resultsByTicker = useMemo(
    () => new Map(results.map((row) => [row.ticker, row])),
    [results],
  )

  useEffect(() => {
    setResults(visibleLastScanResults || [])
  }, [visibleLastScanResults])

  useEffect(() => {
    autoScanStarted.current = false
  }, [effectiveMarket])

  const scanIsFromToday = useMemo(() => {
    if (!visibleLastScanAt) {
      return false
    }

    return new Date(visibleLastScanAt).toDateString() === new Date().toDateString()
  }, [visibleLastScanAt])

  const handleScan = useCallback(async ({ automatic = false } = {}) => {
    setLoading(true)
    setError('')
    recordScanStart(scannerConfig.universe.length, effectiveMarket)

    try {
      const usMarketContext = scannerConfig.contextFetcher
        ? await withTimeout(
            scannerConfig.contextFetcher(),
            'Tempo massimo superato: contesto USA non disponibile',
          )
        : null
      const marketData = await withTimeout(
        scannerConfig.fetcher(scannerConfig.universe),
        `Tempo massimo superato: ${scannerConfig.provider} non ha completato la scansione`,
      )
      const actionableRows = marketData.filter(scannerConfig.isActionable)
      const automaticRows = scannerConfig.sortByScore(
        filterAutomaticRowsByContext(
          marketData.filter(scannerConfig.isAutoEligible),
          effectiveMarket,
          usMarketContext,
        ),
      )

      setResults(marketData)
      recordScanComplete(
        {
          scannedCount: marketData.length,
          signalCount: actionableRows.length,
          results: marketData,
          usMarketContext,
        },
        effectiveMarket,
      )

      if (routeAutomationEnabled && automaticRows.length > 0) {
        const { openedTrades } = executeAutomatedTrades(
          automaticRows,
          effectiveMarket,
        )

        toast({
          title:
            openedTrades.length > 0
              ? `Pilota automatico: ${openedTrades.length} posizioni aperte`
              : 'Pilota automatico: nessuna posizione aperta',
        })
      } else if (routeAutomationEnabled && actionableRows.length > 0) {
        toast({
          title: 'Pilota automatico: segnali presenti ma filtrati',
          description: usMarketContext
            ? getUsMarketContextSummary(usMarketContext)
            : 'Nessun segnale abbastanza forte secondo i limiti rischio.',
        })
      } else if (automatic) {
        toast({
          title: 'Scansione automatica aggiornata',
        })
      }
    } catch (apiError) {
      console.error(apiError)
      setError(apiError.message)
      recordScanError(apiError.message, effectiveMarket)
      toast({
        title: `Errore dati: Controlla la connessione o ${scannerConfig.errorLabel}`,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [
    executeAutomatedTrades,
    recordScanComplete,
    recordScanError,
    recordScanStart,
    scannerConfig,
    toast,
    effectiveMarket,
    routeAutomationEnabled,
  ])

  useEffect(() => {
    const shouldAutoScan =
      !autoScanStarted.current &&
      (!visibleLastScanResults?.length || !scanIsFromToday)

    if (!shouldAutoScan) {
      return
    }

    autoScanStarted.current = true
    handleScan({ automatic: true })
  }, [handleScan, visibleLastScanResults?.length, scanIsFromToday])

  const handleExecuteTrade = async (row) => {
    const type = getRowTradeType(row)

    if (!type) {
      toast({
        title: 'Nessuna direzione operativa disponibile',
        variant: 'destructive',
      })
      return
    }

    try {
      await refreshRemoteState({ force: true, reason: 'azione-critica' })
      const trade = executeTrade(
        row.ticker,
        row.currentPrice,
        row.atr,
        type,
        row.profile || null,
        effectiveMarket,
        row,
      )
      toast({
        title: `Posizione ${type === 'LONG' ? 'Long' : 'Short'} su ${trade.ticker} aperta`,
      })
    } catch (tradeError) {
      toast({
        title: tradeError.message,
        variant: 'destructive',
      })
    }
  }

  const isTickerAlreadyOpen = (ticker) =>
    visiblePositions.some((position) => position.ticker === ticker)

  const getOpenPosition = (ticker) =>
    visiblePositions.find((position) => position.ticker === ticker)

  const visibleSignalRows = useMemo(() => {
    const openTickers = new Set(visiblePositions.map((position) => position.ticker))

    return [...filteredResults].sort((left, right) => {
      const leftOpen = openTickers.has(left.ticker)
      const rightOpen = openTickers.has(right.ticker)

      if (leftOpen !== rightOpen) {
        return leftOpen ? -1 : 1
      }

      return scannerConfig.getScore(right) - scannerConfig.getScore(left)
    })
  }, [filteredResults, visiblePositions, scannerConfig])
  const discardedRows = useMemo(() => {
    const selectedTickers = new Set(visibleSignalRows.map((row) => row.ticker))

    return results.filter((row) => !selectedTickers.has(row.ticker))
  }, [results, visibleSignalRows])

  const refillAfterManualClose = async (closedTicker) => {
    if (!routeAutomationEnabled) {
      return
    }

    recordScanStart(scannerConfig.universe.length, effectiveMarket)

    try {
      const usMarketContext = scannerConfig.contextFetcher
        ? await scannerConfig.contextFetcher()
        : null
      const marketData = await scannerConfig.fetcher(scannerConfig.universe)
      const actionableRows = marketData.filter(scannerConfig.isActionable)
      const automaticRows = scannerConfig.sortByScore(
        filterAutomaticRowsByContext(
          marketData.filter(
            (row) => scannerConfig.isAutoEligible(row) && row.ticker !== closedTicker,
          ),
          effectiveMarket,
          usMarketContext,
        ),
      )

      setResults(marketData)
      recordScanComplete(
        {
          scannedCount: marketData.length,
          signalCount: actionableRows.length,
          results: marketData,
          usMarketContext,
        },
        effectiveMarket,
      )

      const { openedTrades } = executeAutomatedTrades(
        automaticRows,
        effectiveMarket,
      )

      toast({
        title:
          openedTrades.length > 0
            ? `Slot riempito: ${openedTrades[0].ticker} aperto dal pilota`
            : `Slot libero: nessun nuovo ${scannerConfig.copy.assetSingular} abbastanza forte`,
      })
    } catch (scanError) {
      recordScanError(scanError.message, effectiveMarket)
      toast({
        title: 'Chiusura eseguita, ma nuova scansione non riuscita',
        variant: 'destructive',
      })
    }
  }

  const handleManualClose = async (position) => {
    setClosingId(position.id)

    try {
      const closedTrade = await closePositionManually(position.id, effectiveMarket)

      toast({
        title: `${position.ticker} chiuso: P/L ${formatCurrency(closedTrade.pnlEur)}`,
      })

      await refillAfterManualClose(position.ticker)
    } catch (closeError) {
      toast({
        title: closeError.message || 'Chiusura manuale non riuscita',
        variant: 'destructive',
      })
    } finally {
      setClosingId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="flex flex-col gap-5 rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            Scanner quantitativo · {scannerConfig.copy.eyebrow}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            Scanner{' '}
            {routeMarketLabel || marketLabel || currentStrategy?.label}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Analisi {scannerConfig.copy.scanMode} automatica su{' '}
            {scannerConfig.universe.length}{' '}
            {scannerConfig.scanLabel} con dati reali da {scannerConfig.provider}.
            {scannerConfig.copy.scanDescription}
          </p>
        </div>

        <Button onClick={() => handleScan()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Aggiorna Scansione {scannerConfig.copy.scanMode}
        </Button>
      </header>

      <MarketCountdownPanel marketId={effectiveMarket} />

      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle>Scansione mercato in corso...</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-4/5" />
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-[#ef8f8f]/35 bg-[#ef8f8f]/10 p-4 text-sm text-[#ef8f8f]">
          Errore dati: Controlla la connessione o {scannerConfig.errorLabel}
        </div>
      ) : null}

      {routeKillSwitchEnabled ? (
        <div className="rounded-lg border border-[#ef8f8f]/35 bg-[#ef8f8f]/10 p-4 text-sm leading-6 text-[#ef8f8f]">
          Kill switch attivo: lo Scanner può aggiornare i dati, ma non può
          aprire nuove posizioni finché il blocco resta attivo.
        </div>
      ) : null}

      <Card className="overflow-hidden border-[var(--market-accent-border)]">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Posizioni aperte</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Prima vedi cosa hai realmente in portafoglio: quando è stato
              investito, quanto è investito e il P/L aggiornato con l’ultimo
              prezzo disponibile.
            </p>
          </div>
          <Badge>{visiblePositions.length} aperte</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {visiblePositions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ticker</TableHead>
                  <TableHead>Investito il</TableHead>
                  <TableHead>Investito</TableHead>
                  <TableHead>Ingresso</TableHead>
                  <TableHead>Prezzo live</TableHead>
                  <TableHead>Guadagno live</TableHead>
                  <TableHead>P/L %</TableHead>
                  <TableHead>Target / Stop</TableHead>
                  <TableHead>Azione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePositions.map((position) => {
                  const scanRow = resultsByTicker.get(position.ticker)
                  const livePrice = getPositionLivePrice(position, scanRow)
                  const positionCurrency = getPositionCurrency(position, scanRow)
                  const livePnl = calculatePositionPnl(position, scanRow)
                  const livePnlPct = calculatePositionPnlPct(position, livePnl)
                  const pnlPositive = Number(livePnl) >= 0

                  return (
                    <TableRow key={`aperta-${position.id}`}>
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          <TickerInfo
                            assetType={scannerConfig.copy.assetType}
                            ticker={position.ticker}
                            profile={position.profile}
                          />
                          <StrategyBadge rsi={position.type === 'LONG' ? 0 : 100} />
                        </div>
                      </TableCell>
                      <TableCell>{formatDateTime(getPositionOpenedAt(position))}</TableCell>
                      <TableCell className="font-semibold text-[var(--market-accent)]">
                        {formatCurrency(position.invested)}
                      </TableCell>
                      <TableCell>
                        <PriceStack
                          price={position.entryPrice}
                          currency={positionCurrency}
                          eurValue={getPositionEntryPriceEur(position)}
                          fxToEur={position.entryFxToEur || scanRow?.fxToEur || 1}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <PriceStack
                            price={livePrice}
                            currency={positionCurrency}
                            eurValue={getPositionLivePriceEur(position, scanRow)}
                            fxToEur={
                              scanRow?.fxToEur ||
                              position.latestFxToEur ||
                              position.entryFxToEur ||
                              1
                            }
                          />
                          <p className="mt-1 text-xs text-slate-500">
                            {getPositionPriceSource(position, scanRow)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p
                          className={
                            Number.isFinite(Number(livePnl))
                              ? pnlPositive
                                ? 'font-semibold text-[var(--market-accent)]'
                                : 'font-semibold text-[#ef8f8f]'
                              : 'text-slate-400'
                          }
                        >
                          {formatCurrency(livePnl)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p
                          className={
                            Number.isFinite(Number(livePnlPct))
                              ? pnlPositive
                                ? 'font-semibold text-[var(--market-accent)]'
                                : 'font-semibold text-[#ef8f8f]'
                              : 'text-slate-400'
                          }
                        >
                          {Number.isFinite(Number(livePnlPct))
                            ? `${formatNumber(livePnlPct)}%`
                            : 'Non disponibile'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-36 text-sm leading-6">
                          <p>
                            Lock {formatMarketCurrency(
                              position.takeProfit,
                              positionCurrency,
                            )}
                          </p>
                          {position.finalTakeProfit ? (
                            <p className="text-slate-400">
                              Max {formatMarketCurrency(
                                position.finalTakeProfit,
                                positionCurrency,
                              )}
                            </p>
                          ) : null}
                          <p className="text-slate-500">
                            SL {formatMarketCurrency(
                              position.stopLoss,
                              positionCurrency,
                            )}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={syncMeta?.isStale || closingId === position.id}
                          onClick={() => handleManualClose(position)}
                        >
                          {closingId === position.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {syncMeta?.isStale
                            ? 'Sync richiesta'
                            : 'Chiudi a prezzo aggiornato'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6 text-sm text-slate-500">
              Nessuna posizione aperta. Quando il pilota apre o tu apri una
              posizione, comparirà qui sopra ai segnali.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Risultati e diagnostica</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              In alto trovi gli asset scelti dal criterio operativo. Subito
              sotto trovi tutti gli altri asset analizzati con il motivo esteso
              dello scarto.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{results.length} scansionati</Badge>
            <Badge>{filteredResults.length} segnali</Badge>
            <Badge>{autoEligibleResults.length} auto</Badge>
            <Badge>{discardedRows.length} scartati</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visibleSignalRows.length > 0 ? (
            <div>
              <div className="border-b border-slate-800 bg-[var(--market-accent-soft)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--market-accent)]">
                  Asset scelti dal criterio
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Ticker</TableHead>
                    <TableHead>Prezzo mercato</TableHead>
                    <TableHead>Cambio EUR</TableHead>
                    <TableHead>Valore EUR</TableHead>
                    <TableHead>Investito reale</TableHead>
                    <TableHead>Dati</TableHead>
                    <TableHead>Strategia suggerita</TableHead>
                    <TableHead>Criterio pilota</TableHead>
                    <TableHead>Azione</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleSignalRows.map((row) => (
                    <TableRow key={row.ticker}>
                      <TableCell>
                        <TickerInfo
                          assetType={scannerConfig.copy.assetType}
                          ticker={row.ticker}
                          profile={row.profile}
                        />
                      </TableCell>
                      <TableCell>
                        <PriceStack
                          price={row.currentPrice}
                          currency={getRowCurrency(row)}
                          eurValue={getRowPriceEur(row)}
                          fxToEur={row.fxToEur}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-slate-300">
                          {getRowCurrency(row) === 'EUR'
                            ? '1,0000'
                            : formatFxRate(row.fxToEur)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {row.fxPair || 'EUR'}
                        </p>
                      </TableCell>
                      <TableCell>{formatCurrency(getRowPriceEur(row))}</TableCell>
                      <TableCell>
                        <InvestmentCell position={getOpenPosition(row.ticker)} />
                      </TableCell>
                      <TableCell>
                        <TechnicalTooltip row={row} />
                      </TableCell>
                      <TableCell>
                        <StrategyCell row={row} marketCopy={scannerConfig.copy} />
                      </TableCell>
                      <TableCell>
                        <AutoRuleCell row={row} />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={
                            syncMeta?.isStale ||
                            routeKillSwitchEnabled ||
                            slotsFull ||
                            isTickerAlreadyOpen(row.ticker) ||
                            isTickerInCooldown(row.ticker)
                          }
                          onClick={() => handleExecuteTrade(row)}
                        >
                          {syncMeta?.isStale
                            ? 'Sync richiesta'
                            : routeKillSwitchEnabled
                            ? 'Bloccato'
                            : isTickerAlreadyOpen(row.ticker)
                            ? 'Già in portafoglio'
                            : isTickerInCooldown(row.ticker)
                            ? 'In pausa'
                            : 'Apri posizione'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : !loading ? (
            <div className="flex min-h-56 items-center justify-center p-8 text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                  <SearchX className="h-5 w-5 text-slate-500" />
                </div>
                <p className="mt-4 font-medium text-white">
                  Nessun asset scelto dal criterio
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  La scansione resta utile: sotto trovi il resto degli asset e
                  il motivo per cui non sono stati selezionati.
                </p>
              </div>
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="border-t border-slate-800">
              <div className="border-b border-slate-800 bg-slate-950 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Asset scartati / non selezionati
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Ticker</TableHead>
                    <TableHead>Prezzo mercato</TableHead>
                    <TableHead>Valore EUR</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discardedRows.map((row) => (
                    <TableRow key={`scartato-${row.ticker}`}>
                      <TableCell>
                        <TickerInfo
                          assetType={scannerConfig.copy.assetType}
                          ticker={row.ticker}
                          profile={row.profile}
                        />
                      </TableCell>
                      <TableCell>
                        <PriceStack
                          price={row.currentPrice}
                          currency={getRowCurrency(row)}
                          eurValue={getRowPriceEur(row)}
                          fxToEur={row.fxToEur}
                        />
                      </TableCell>
                      <TableCell>{formatCurrency(getRowPriceEur(row))}</TableCell>
                      <TableCell>
                        <p className="max-w-3xl text-sm leading-6 text-slate-400">
                          {getExtendedScanReason(row, scannerConfig)}
                        </p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex min-h-56 items-center justify-center p-8 text-center">
              <div>
                <p className="font-medium text-white">Scansione non ancora disponibile</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {scannerConfig.copy.diagnosticDescription}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="items-start gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
              <BookOpenText className="h-5 w-5 text-[var(--market-accent)]" />
            </div>
            <div>
              <CardTitle>Legenda veloce</CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                I termini principali che userai per leggere Scanner e
                Portafoglio.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {scannerConfig.copy.glossary.map((item) => (
            <div
              key={item.term}
              className="rounded-lg border border-slate-800 bg-slate-950 p-4"
            >
              <p className="text-sm font-semibold text-white">{item.term}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {item.description}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
