import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
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
import { fetchMarketData } from '../services/api'
import { fetchCryptoMarketData } from '../services/cryptoApi'
import {
  CRYPTO_MAX_AUTO_ATR_PCT,
  getCryptoAtrPct,
  getCryptoAutoScore,
  getCryptoSignalType,
  isCryptoActionableResult,
  isCryptoAutoEligibleResult,
  isCryptoRejectedResult,
  sortByCryptoAutoScore,
} from '../services/cryptoRules'
import { CRYPTO_TICKERS } from '../services/cryptoUniverse'
import { EUROPEAN_TICKERS } from '../services/marketUniverse'
import { getMarketCopy } from '../services/marketCopy'
import { LEGACY_POSITION_SIZE } from '../services/positionSizing'
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

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const SCAN_TIMEOUT_MS = 20000

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
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? currencyFormatter.format(value)
    : 'Non disponibile'
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

function getRecoveredCapital(trade, fallbackSlotSize) {
  if (Number.isFinite(Number(trade.recoveredCapital))) {
    return Number(trade.recoveredCapital)
  }

  const invested = Number.isFinite(Number(trade.invested))
    ? Number(trade.invested)
    : fallbackSlotSize
  const pnl = Number.isFinite(Number(trade.pnlEur)) ? Number(trade.pnlEur) : 0

  return Math.max(invested + pnl, 0)
}

function getPositionLivePrice(position, scanRow) {
  const latestPrice = Number(position.latestPrice)
  const scanPrice = Number(scanRow?.currentPrice)

  if (Number.isFinite(latestPrice)) {
    return latestPrice
  }

  return Number.isFinite(scanPrice) ? scanPrice : null
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
  const entryPrice = Number(position.entryPrice)

  if (!Number.isFinite(invested) || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return null
  }

  const quantity = invested / entryPrice
  const pnl =
    position.type === 'LONG'
      ? (livePrice - entryPrice) * quantity
      : (entryPrice - livePrice) * quantity

  return pnl
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
  if (row.market === 'crypto') {
    return getCryptoSignalType(row)
  }

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
  const isCrypto = row.market === 'crypto'
  const assetLabel = isCrypto ? 'asset crypto' : 'titolo'

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
  const isCrypto = row.market === 'crypto'

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
              {isCrypto ? 'Volume €' : 'P/E'}
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {isCrypto ? formatCurrency(row.volumeEur) : formatNumber(row.pe)}
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
        {isCrypto ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Market cap
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {formatCurrency(row.marketCapEur)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Ranking
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {row.marketCapRank ? `#${row.marketCapRank}` : 'Non disponibile'}
              </p>
            </div>
          </div>
        ) : null}
        {isCrypto && (row.mappingWarning || row.mappingIssue) ? (
          <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">
              Mapping simboli
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-100/80">
              {row.mappingIssue || row.mappingWarning}
            </p>
          </div>
        ) : null}
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
  const isCrypto = row.market === 'crypto'
  const atrPct = isCrypto ? getCryptoAtrPct(row) : getAtrPct(row)
  const maxAtrPct = isCrypto ? CRYPTO_MAX_AUTO_ATR_PCT : MAX_AUTO_ATR_PCT
  const eligible = isCrypto
    ? isCryptoAutoEligibleResult(row)
    : isAutoEligibleResult(row)
  const score = isCrypto ? getCryptoAutoScore(row) : getAutoScore(row)

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
        Aperta a {formatCurrency(position.entryPrice)}
      </p>
    </div>
  )
}

function WatchlistBadge({ row, isActionable }) {
  if (row.status !== 'ok') {
    return <Badge variant="negative">SCARTATO</Badge>
  }

  if (isActionable(row)) {
    const type = getRowTradeType(row)

    return <StrategyBadge rsi={type === 'LONG' ? 0 : type === 'SHORT' ? 100 : 50} />
  }

  return <Badge>NESSUN SEGNALE</Badge>
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
  const scannerConfig = useMemo(() => {
    if (effectiveMarket === 'crypto') {
      const copy = getMarketCopy('crypto')
      return {
        copy,
        provider: 'Kraken',
        universe: CRYPTO_TICKERS,
        fetcher: fetchCryptoMarketData,
        isActionable: isCryptoActionableResult,
        isAutoEligible: isCryptoAutoEligibleResult,
        isRejected: isCryptoRejectedResult,
        sortByScore: sortByCryptoAutoScore,
        getScore: getCryptoAutoScore,
        scanLabel: copy.assetPlural,
        diagnosticLabel: copy.assetPlural,
        errorLabel: 'Kraken',
      }
    }

    const copy = getMarketCopy('equities')
    return {
      copy,
      provider: 'Yahoo Finance',
      universe: EUROPEAN_TICKERS,
      fetcher: fetchMarketData,
      isActionable: isActionableResult,
      isAutoEligible: isAutoEligibleResult,
      isRejected: isRejectedResult,
      sortByScore: sortByAutoScore,
      getScore: getAutoScore,
      scanLabel: copy.assetPlural,
      diagnosticLabel: copy.assetPlural,
      errorLabel: 'Yahoo Finance',
    }
  }, [effectiveMarket])
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
    () => scannerConfig.sortByScore(results.filter(scannerConfig.isAutoEligible)),
    [results, scannerConfig],
  )
  const rejectedResults = useMemo(
    () => results.filter(scannerConfig.isRejected),
    [results, scannerConfig],
  )
  const resultsByTicker = useMemo(
    () => new Map(results.map((row) => [row.ticker, row])),
    [results],
  )
  const recentClosedTrades = useMemo(
    () => visibleHistory.slice(0, 5),
    [visibleHistory],
  )
  const cryptoMappingAlerts = useMemo(
    () =>
      effectiveMarket === 'crypto'
        ? results.filter((row) => row.mappingWarning || row.mappingIssue)
        : [],
    [effectiveMarket, results],
  )
  const cryptoMappingIssues = useMemo(
    () =>
      cryptoMappingAlerts.filter((row) => row.mappingIssue),
    [cryptoMappingAlerts],
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
      const marketData = await withTimeout(
        scannerConfig.fetcher(scannerConfig.universe),
        `Tempo massimo superato: ${scannerConfig.provider} non ha completato la scansione`,
      )
      const actionableRows = marketData.filter(scannerConfig.isActionable)
      const automaticRows = scannerConfig.sortByScore(
        marketData.filter(scannerConfig.isAutoEligible),
      )

      setResults(marketData)
      recordScanComplete(
        {
          scannedCount: marketData.length,
          signalCount: actionableRows.length,
          results: marketData,
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
          title: 'Pilota automatico: segnali presenti ma non abbastanza forti',
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

  const handleExecuteTrade = (row) => {
    const type = getRowTradeType(row)

    if (!type) {
      toast({
        title: 'Nessuna direzione operativa disponibile',
        variant: 'destructive',
      })
      return
    }

    try {
      const trade = executeTrade(
        row.ticker,
        row.currentPrice,
        row.atr,
        type,
        row.profile || null,
        effectiveMarket,
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

  const refillAfterManualClose = async (closedTicker) => {
    if (!routeAutomationEnabled) {
      return
    }

    recordScanStart(scannerConfig.universe.length, effectiveMarket)

    try {
      const marketData = await scannerConfig.fetcher(scannerConfig.universe)
      const actionableRows = marketData.filter(scannerConfig.isActionable)
      const automaticRows = scannerConfig.sortByScore(
        marketData.filter(
          (row) => scannerConfig.isAutoEligible(row) && row.ticker !== closedTicker,
        ),
      )

      setResults(marketData)
      recordScanComplete(
        {
          scannedCount: marketData.length,
          signalCount: actionableRows.length,
          results: marketData,
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

      {effectiveMarket === 'crypto' && cryptoMappingAlerts.length > 0 ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
            <div>
              <p className="font-semibold">
                Controllo mapping crypto: {cryptoMappingAlerts.length} simboli con
                alias operativo
              </p>
              <p className="mt-1 leading-6 text-amber-100/75">
                Alcuni asset hanno un codice visibile diverso dal codice usato da
                Kraken. Spapple li segnala in diagnostica e blocca quelli non
                confermati da CoinGecko.
              </p>
              {cryptoMappingIssues.length > 0 ? (
                <p className="mt-2 text-[#ef8f8f]">
                  {cryptoMappingIssues.length} asset esclusi per mapping
                  CoinGecko non confermato.
                </p>
              ) : null}
            </div>
          </div>
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
                      <TableCell>{formatCurrency(position.entryPrice)}</TableCell>
                      <TableCell>
                        <div>
                          <p>{formatCurrency(livePrice)}</p>
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
                            Lock {formatCurrency(position.takeProfit)}
                          </p>
                          {position.finalTakeProfit ? (
                            <p className="text-slate-400">
                              Max {formatCurrency(position.finalTakeProfit)}
                            </p>
                          ) : null}
                          <p className="text-slate-500">
                            SL {formatCurrency(position.stopLoss)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={closingId === position.id}
                          onClick={() => handleManualClose(position)}
                        >
                          {closingId === position.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          Chiudi a prezzo aggiornato
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
            <CardTitle>Ultime vendite</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Qui vedi quando hai investito, quando hai venduto e quanto è
              rientrato dopo la chiusura.
            </p>
          </div>
          <Badge>{visibleHistory.length} chiuse</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {recentClosedTrades.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ticker</TableHead>
                  <TableHead>Investito il</TableHead>
                  <TableHead>Venduto il</TableHead>
                  <TableHead>Investito</TableHead>
                  <TableHead>Ricavato</TableHead>
                  <TableHead>P/L</TableHead>
                  <TableHead>Esito</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentClosedTrades.map((trade, index) => {
                  const recovered = getRecoveredCapital(trade, LEGACY_POSITION_SIZE)
                  const pnlPositive = Number(trade.pnlEur) >= 0

                  return (
                    <TableRow key={`${trade.ticker}-${trade.exitDate}-${index}`}>
                      <TableCell>{trade.ticker}</TableCell>
                      <TableCell>{formatDateTime(trade.openedAt)}</TableCell>
                      <TableCell>{formatDateTime(trade.exitDate)}</TableCell>
                      <TableCell>
                        {formatCurrency(trade.invested || LEGACY_POSITION_SIZE)}
                      </TableCell>
                      <TableCell className="font-semibold text-white">
                        {formatCurrency(recovered)}
                      </TableCell>
                      <TableCell
                        className={
                          pnlPositive
                            ? 'font-semibold text-[var(--market-accent)]'
                            : 'font-semibold text-[#ef8f8f]'
                        }
                      >
                        {formatCurrency(trade.pnlEur)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={trade.result === 'WIN' ? 'positive' : 'negative'}>
                          {trade.result === 'WIN' ? 'Utile' : 'Perdita'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6 text-sm text-slate-500">
              Nessuna vendita registrata. Appena una posizione verrà chiusa,
              vedrai qui ricavato e risultato.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Risultati filtrati</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Sono visibili solo gli asset che rispettano le regole del mercato
              attivo. La strategia indica se Spapple cerca rialzo o ribasso.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{results.length} scansionati</Badge>
            <Badge>{rejectedResults.length} scartati</Badge>
            <Badge>{filteredResults.length} segnali</Badge>
            <Badge>{autoEligibleResults.length} auto</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Ticker</TableHead>
                <TableHead>Prezzo</TableHead>
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
                  <TableCell>{formatCurrency(row.currentPrice)}</TableCell>
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
                        routeKillSwitchEnabled ||
                        slotsFull ||
                        isTickerAlreadyOpen(row.ticker) ||
                        isTickerInCooldown(row.ticker)
                      }
                      onClick={() => handleExecuteTrade(row)}
                    >
                      {routeKillSwitchEnabled
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

          {!loading && filteredResults.length === 0 ? (
            <div className="flex min-h-72 items-center justify-center border-t border-slate-800 p-8 text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                  <SearchX className="h-5 w-5 text-slate-500" />
                </div>
                <p className="mt-4 font-medium text-white">
                  Nessun segnale operativo disponibile
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Se l’aggiornamento automatico non ha trovato segnali, puoi
                  usare il bottone manuale per ripetere la scansione.
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Diagnostica della scansione</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Tutti i {scannerConfig.universe.length}{' '}
              {scannerConfig.diagnosticLabel} analizzati, inclusi quelli
              scartati e il motivo della decisione.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>
              {results.length} {scannerConfig.diagnosticLabel}
            </Badge>
            <Badge>{filteredResults.length} ammessi</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {results.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ticker</TableHead>
                  <TableHead>Prezzo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Dati e motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((row) => (
                  <TableRow key={`universo-${row.ticker}`}>
                    <TableCell>
                      <TickerInfo
                        assetType={scannerConfig.copy.assetType}
                        ticker={row.ticker}
                        profile={row.profile}
                      />
                    </TableCell>
                    <TableCell>{formatCurrency(row.currentPrice)}</TableCell>
                    <TableCell>
                      <WatchlistBadge
                        row={row}
                        isActionable={scannerConfig.isActionable}
                      />
                      {row.mappingWarning || row.mappingIssue ? (
                        <div className="mt-2">
                          <Badge
                            variant={row.mappingIssue ? 'negative' : 'default'}
                          >
                            Mapping
                          </Badge>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <TechnicalTooltip row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex min-h-56 items-center justify-center p-8 text-center">
              <div>
                <p className="font-medium text-white">
                  Diagnostica pronta per la prossima scansione
                </p>
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
