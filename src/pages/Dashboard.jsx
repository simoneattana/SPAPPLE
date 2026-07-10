import { useEffect, useState } from 'react'
import {
  Activity,
  ChartNoAxesCombined,
  CircleSlash,
  Loader2,
  Radar,
  RefreshCw,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { InfoTip } from '../components/ui/InfoTip'
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
import {
  EXECUTION_COST_ASSUMPTIONS,
  SLIPPAGE_ATR_RATIO,
} from '../services/executionCosts'
import { getMarketCopy } from '../services/marketCopy'
import { getMarketDisplayStatus } from '../services/marketHours'
import {
  calculateRealizedTotals,
  filterTradesByCurrentMonth,
  filterTradesByToday,
} from '../services/profitStats'
import { LEGACY_POSITION_SIZE } from '../services/positionSizing'
import { getTradingStrategy } from '../strategies'

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const percentFormatter = new Intl.NumberFormat('it-IT', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const MINIMUM_SAMPLE = 30
const RELIABLE_SAMPLE = 100

const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatCurrency(value) {
  return Number.isFinite(Number(value))
    ? currencyFormatter.format(Number(value))
    : 'N/D'
}

function formatDate(value) {
  return value ? dateTimeFormatter.format(new Date(value)) : 'N/D'
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
  }

  return `${minutes}m ${String(safeSeconds % 60).padStart(2, '0')}s`
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

function getExecutionImpact(costs) {
  return (
    Number(costs?.commissionEur || 0) +
    Number(costs?.pricePenaltyEur || 0)
  )
}

function getTradeCommissionEur(trade) {
  return (
    Number(trade?.executionCosts?.open?.commissionEur || 0) +
    Number(trade?.executionCosts?.close?.commissionEur || 0)
  )
}

function calculateCommissionTotal(trades = []) {
  return trades.reduce((total, trade) => total + getTradeCommissionEur(trade), 0)
}

function calculateGrossPnlTotal(trades = []) {
  return trades.reduce((total, trade) => {
    if (Number.isFinite(Number(trade?.grossPnlEur))) {
      return total + Number(trade.grossPnlEur)
    }

    if (Number.isFinite(Number(trade?.pnlEur))) {
      return total + Number(trade.pnlEur)
    }

    return total
  }, 0)
}

function calculateOpenPositionCommissions(positions = []) {
  return positions.reduce((total, position) => {
    const openCommission = Number(position?.executionCosts?.open?.commissionEur)

    return Number.isFinite(openCommission) ? total + openCommission : total
  }, 0)
}

function calculateOpenPositionLivePnl(positions = []) {
  return positions.reduce((total, position) => {
    const pnl = Number(position?.unrealizedPnl)

    return Number.isFinite(pnl) ? total + pnl : total
  }, 0)
}

function calculateOpenPositionRealtimeValue(positions = []) {
  return positions.reduce((total, position) => {
    const invested = Number(position?.invested)
    const pnl = Number(position?.unrealizedPnl)
    const openCommission = Number(position?.executionCosts?.open?.commissionEur)

    if (!Number.isFinite(invested)) {
      return total
    }

    return (
      total +
      invested +
      (Number.isFinite(pnl) ? pnl : 0) +
      (Number.isFinite(openCommission) ? openCommission : 0)
    )
  }, 0)
}

function getOpenPositionEstimatedCosts(position) {
  return (
    getExecutionImpact(position.executionCosts?.open) +
    getExecutionImpact(position.executionCosts?.latestClose)
  )
}

function CostSummaryTip({ closeLabel = 'Chiusura', closeCosts, grossPnl, netPnl, openCosts, totalCosts }) {
  const resolvedTotal =
    Number.isFinite(Number(totalCosts))
      ? Number(totalCosts)
      : getExecutionImpact(openCosts) + getExecutionImpact(closeCosts)

  return (
    <InfoTip label="Dettaglio costi">
      <div className="space-y-2">
        <p className="font-semibold text-white">Come leggere il risultato</p>
        {Number.isFinite(Number(grossPnl)) ? (
          <p>P/L prima dei costi: {formatCurrency(grossPnl)}</p>
        ) : null}
        {Number.isFinite(Number(netPnl)) ? (
          <p>P/L netto visibile: {formatCurrency(netPnl)}</p>
        ) : null}
        <p>Costi totali inclusi: {formatCurrency(resolvedTotal)}</p>
        {openCosts ? (
          <div className="border-t border-slate-800 pt-2">
            <p className="font-semibold text-slate-300">Apertura</p>
            <p>Spread: {formatCurrency(openCosts.spreadEur)}</p>
            <p>Slippage: {formatCurrency(openCosts.slippageEur)}</p>
            <p>Commissione: {formatCurrency(openCosts.commissionEur)}</p>
          </div>
        ) : null}
        {closeCosts ? (
          <div className="border-t border-slate-800 pt-2">
            <p className="font-semibold text-slate-300">{closeLabel}</p>
            <p>Spread: {formatCurrency(closeCosts.spreadEur)}</p>
            <p>Slippage: {formatCurrency(closeCosts.slippageEur)}</p>
            <p>Commissione: {formatCurrency(closeCosts.commissionEur)}</p>
          </div>
        ) : null}
      </div>
    </InfoTip>
  )
}

function exitReasonLabel(reason) {
  const labels = {
    MANUALE: 'Manuale',
    BREAK_EVEN_STOP: 'Stop a pareggio',
    PRE_CLOSE_CAPITAL_PROTECTION: 'Protezione capitale',
    PRE_CLOSE_PROFIT_LOCK: 'Utile pre-chiusura',
    PRE_CLOSE_RISK: 'Rischio pre-chiusura',
    SESSION_PROTECTION: 'Protezione sessione',
    STOP_LOSS: 'Stop loss',
    TAKE_PROFIT: 'Take profit',
    TAKE_PROFIT_MAX: 'Target massimo',
    TRAILING_PROFIT: 'Trailing profit',
  }

  return labels[reason] || reason || 'N/D'
}

function calculateStrategyStats(history) {
  const closedTrades = Array.isArray(history) ? history : []
  const wins = closedTrades.filter((trade) => trade.result === 'WIN')
  const losses = closedTrades.filter((trade) => trade.result === 'LOSS')
  const total = closedTrades.length
  const { grossLosses, grossWins, netPnl } = calculateRealizedTotals(closedTrades)
  const winRate = total > 0 ? wins.length / total : 0
  const averageWin = wins.length > 0 ? grossWins / wins.length : 0
  const averageLoss = losses.length > 0 ? grossLosses / losses.length : 0
  const expectancy =
    total > 0 ? winRate * averageWin - (1 - winRate) * averageLoss : 0

  let sampleLabel = 'Campione basso'
  let sampleVariant = 'negative'

  if (total >= RELIABLE_SAMPLE) {
    sampleLabel = 'Campione solido'
    sampleVariant = 'positive'
  } else if (total >= MINIMUM_SAMPLE) {
    sampleLabel = 'Campione iniziale'
    sampleVariant = 'default'
  }

  return {
    averageLoss,
    averageWin,
    expectancy,
    grossLosses,
    grossWins,
    losses: losses.length,
    netPnl,
    sampleLabel,
    sampleVariant,
    total,
    winRate,
    wins: wins.length,
  }
}

function DashboardBox({ detail, info, label, value, accent = 'text-white' }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#090b10] p-4 shadow-xl shadow-black/20">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        {info ? <InfoTip>{info}</InfoTip> : null}
      </div>
      <p className={`mt-3 text-xl font-semibold leading-tight ${accent}`}>
        {value}
      </p>
      {detail && typeof detail === 'string' ? (
        <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
      ) : detail ? (
        <div className="mt-2 text-sm leading-6 text-slate-500">{detail}</div>
      ) : null}
    </div>
  )
}

function CostAssumptionsPanel() {
  return (
    <Card>
      <CardHeader className="items-center justify-between gap-4 border-b border-slate-800 p-4">
        <div className="flex items-center gap-2">
          <CardTitle className="text-white">Percentuali commissioni e costi</CardTitle>
          <InfoTip>
            Sono le assunzioni statiche usate per rendere la simulazione più
            realistica. Spread e slippage peggiorano il prezzo; le commissioni
            broker vengono sottratte dal risultato.
          </InfoTip>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 lg:grid-cols-3">
        {EXECUTION_COST_ASSUMPTIONS.map((item) => (
          <div
            className="rounded-lg border border-slate-800 bg-[#07090d] p-4"
            key={item.id}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {item.label}
            </p>
            <div className="mt-3 space-y-2 text-sm text-slate-400">
              <p>
                <span className="text-slate-500">Spread:</span>{' '}
                <span className="font-semibold text-slate-200">{item.spread}</span>
              </p>
              <p>
                <span className="text-slate-500">Slippage:</span>{' '}
                <span className="font-semibold text-slate-200">
                  {Math.round(SLIPPAGE_ATR_RATIO * 100)}% dell’ATR per lato
                </span>
              </p>
              <p>
                <span className="text-slate-500">Broker:</span>{' '}
                <span className="font-semibold text-slate-200">
                  {item.commission}
                </span>
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function CapitalTrendPanel({ sampleCount }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
              <ChartNoAxesCombined className="h-5 w-5 text-[var(--market-accent)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold text-white">Andamento capitale</p>
                <InfoTip>
                  Il grafico storico diventerà utile quando avremo un campione
                  sufficiente di operazioni comparabili con il nuovo calcolo costi.
                </InfoTip>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Grafico in preparazione. Ora il dato operativo resta nei box capitale,
                utili e P/L netto.
              </p>
            </div>
          </div>
          <Badge>{Math.min(sampleCount, MINIMUM_SAMPLE)} / {MINIMUM_SAMPLE}</Badge>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusChip({ children, variant = 'default', icon: Icon }) {
  const className =
    variant === 'negative'
      ? 'border-[#ef8f8f]/40 bg-[#ef8f8f]/10 text-[#ef8f8f]'
      : variant === 'positive'
        ? 'border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
        : 'border-slate-800 bg-slate-950 text-slate-300'

  return (
    <span
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${className}`}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </span>
  )
}

function getMarketStatusContent(status) {
  const isOpen = status.isAnyMarketOpen
  const isPreOpen = !isOpen && status.isAnyPreOpen
  const title = isOpen
    ? 'Mercato aperto'
    : isPreOpen
      ? 'Mercato in pre-apertura'
      : 'Mercato chiuso'
  const countdown = isOpen
    ? `Mancano ${formatDuration(
        Number(status.minutesToMarketClose || 0) * 60,
      )} alla chiusura`
    : `Mancano ${formatDuration(status.secondsToOpen)} all’apertura`

  return {
    accent: isOpen
      ? 'text-[var(--market-accent)]'
      : isPreOpen
        ? 'text-amber-200'
        : 'text-[#ef8f8f]',
    countdown,
    title,
  }
}

export default function Dashboard({ marketId }) {
  const {
    activeMarket,
    closePositionManually,
    markets,
    runAutomatedScan,
    syncMeta,
  } = useTrading()
  const { toast } = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [closingId, setClosingId] = useState(null)
  const [scanLoading, setScanLoading] = useState(false)
  const effectiveMarket = marketId || activeMarket
  const currentStrategy = getTradingStrategy(effectiveMarket)
  const routeMarketState = markets?.[effectiveMarket] || {}
  const automationEnabled =
    typeof routeMarketState.automationEnabled === 'boolean'
      ? routeMarketState.automationEnabled
      : true
  const capital = Number.isFinite(Number(routeMarketState.capital))
    ? Number(routeMarketState.capital)
    : currentStrategy.initialCapital
  const positions = Array.isArray(routeMarketState.positions)
    ? routeMarketState.positions
    : []
  const investedInOpenPositions = positions.reduce((total, position) => {
    const invested = Number(position?.invested)

    return Number.isFinite(invested) ? total + invested : total
  }, 0)
  const totalCapital = capital + investedInOpenPositions
  const history = Array.isArray(routeMarketState.history)
    ? routeMarketState.history
    : []
  const orders = Array.isArray(routeMarketState.orders)
    ? routeMarketState.orders
    : []
  const engineStatus = routeMarketState.engineStatus || 'In attesa'
  const executionMode = routeMarketState.executionMode || 'simulation'
  const killSwitchEnabled = Boolean(routeMarketState.killSwitchEnabled)
  const executedOrders = orders.filter((order) => order.status === 'ESEGUITO')
  const recentClosedTrades = history.slice(0, 5)
  const currentMonthTrades = filterTradesByCurrentMonth(history)
  const todayClosedTrades = filterTradesByToday(history)
  const lastScanAt = routeMarketState.lastScanAt || null
  const lastScanCount = Number(routeMarketState.lastScanCount || 0)
  const lastSignalCount = Number(routeMarketState.lastSignalCount || 0)
  const marketLabel = routeMarketState.marketLabel || currentStrategy.label
  const maxPositions = currentStrategy.maxPositions || 5
  const marketCopy = getMarketCopy(effectiveMarket)
  const currentUniverseCount = Array.isArray(currentStrategy.universe)
    ? currentStrategy.universe.length
    : lastScanCount
  const scanUniverseIsCurrent =
    lastScanCount > 0 && lastScanCount === currentUniverseCount
  const positionPercent = Math.round(
    (currentStrategy?.positionSizing?.percent || 0.1) * 100,
  )
  const lastScanText = lastScanAt ? formatDate(lastScanAt) : 'Mai'
  const strategyStats = calculateStrategyStats(history)
  const currentMonthStats = calculateRealizedTotals(currentMonthTrades)
  const todayStats = calculateRealizedTotals(todayClosedTrades)
  const todayCommissions = calculateCommissionTotal(todayClosedTrades)
  const currentMonthCommissions = calculateCommissionTotal(currentMonthTrades)
  const todayGrossPnl = calculateGrossPnlTotal(todayClosedTrades)
  const currentMonthGrossPnl = calculateGrossPnlTotal(currentMonthTrades)
  const openPositionCommissions = calculateOpenPositionCommissions(positions)
  const openPositionLivePnl = calculateOpenPositionLivePnl(positions)
  const openPositionRealtimeValue = calculateOpenPositionRealtimeValue(positions)
  const realtimeCapital = capital + openPositionRealtimeValue
  const marketDisplayStatus = getMarketDisplayStatus(
    currentStrategy,
    new Date(now),
  )
  const marketStatusContent = getMarketStatusContent(marketDisplayStatus)
  const lastLiveCheckText = routeMarketState.lastLiveCheckAt
    ? formatDate(routeMarketState.lastLiveCheckAt)
    : 'In attesa'
  const lastBackendCheckText = routeMarketState.lastBackendCheckAt
    ? formatDate(routeMarketState.lastBackendCheckAt)
    : 'In attesa'
  const liveDataDetail =
    positions.length > 0
      ? `Prezzi posizioni: ${lastLiveCheckText}`
      : `Monitor live sospeso: nessuna posizione aperta. Backend: ${lastBackendCheckText}`
  const profitsInfo =
    'Somma dei soli trade chiusi con risultato positivo. È un dato già netto dalle commissioni broker salvate per ogni operazione.'
  const netPnlInfo =
    'Risultato finale delle operazioni chiuse: P/L lordo calcolato sui prezzi peggiorati meno commissioni broker di apertura e chiusura.'
  const expectancyColor =
    strategyStats.expectancy >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  const handleManualClose = async (position) => {
    setClosingId(position.id)

    try {
      const closedTrade = await closePositionManually(position.id, effectiveMarket)

      toast({
        title: `${position.ticker} chiuso manualmente: P/L ${formatCurrency(closedTrade.pnlEur)}`,
      })
    } catch (error) {
      toast({
        title: error.message || 'Chiusura manuale non riuscita',
        variant: 'destructive',
      })
    } finally {
      setClosingId(null)
    }
  }

  const handleDashboardScan = async () => {
    setScanLoading(true)

    try {
      const result = await runAutomatedScan(effectiveMarket)

      if (result?.error) {
        toast({
          title: result.error.message || 'Scansione non riuscita',
          variant: 'destructive',
        })
        return
      }

      toast({
        title: result?.skipped
          ? 'Scansione non disponibile ora'
          : result?.openedTrades?.length > 0
            ? `Scansione completata: ${result.openedTrades.length} posizioni aperte`
            : 'Scansione completata: nessuna nuova apertura',
      })
    } catch (error) {
      toast({
        title: error.message || 'Scansione non riuscita',
        variant: 'destructive',
      })
    } finally {
      setScanLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Dashboard · {marketCopy.eyebrow}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-white sm:text-3xl">
                {marketLabel}
              </h1>
              {marketCopy.budgetReason ? (
                <InfoTip>{marketCopy.budgetReason}</InfoTip>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={scanLoading || syncMeta?.isStale}
              onClick={handleDashboardScan}
              className="min-w-36"
            >
              {scanLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Scansione
            </Button>
            <StatusChip
              icon={automationEnabled ? Activity : Radar}
              variant={automationEnabled ? 'positive' : 'default'}
            >
              {automationEnabled ? 'Pilota ON' : 'Pilota OFF'}
            </StatusChip>
            <StatusChip
              icon={CircleSlash}
              variant={killSwitchEnabled ? 'negative' : 'default'}
            >
              {killSwitchEnabled ? 'Kill switch ON' : 'Kill switch OFF'}
            </StatusChip>
            <StatusChip variant="default">
              {executionMode === 'simulation' ? 'Simulazione' : executionMode}
            </StatusChip>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <DashboardBox
            accent={marketStatusContent.accent}
            detail={marketStatusContent.countdown}
            info={`Orari di apertura: ${marketDisplayStatus.openingHoursLabel}`}
            label="Mercato aperto/chiuso"
            value={marketStatusContent.title}
          />
          <DashboardBox
            detail={liveDataDetail}
            info="Indica quando il sistema ha aggiornato prezzi live e monitor backend."
            label="Dati live"
            value={positions.length > 0 ? 'Monitor attivo' : 'Nessuna posizione'}
          />
          <DashboardBox
            detail={`${lastScanCount || 0} analizzati · ${lastSignalCount || 0} segnali`}
            info="Momento dell’ultima scansione completata con dati reali."
            label="Ultima scansione"
            value={lastScanText}
          />
        </div>
      </header>

      <CapitalTrendPanel sampleCount={strategyStats.total} />

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="grid gap-4">
          <DashboardBox
            accent="text-[var(--market-accent)]"
            detail={
              <>
                <p>
                  {formatCurrency(capital)} liquidi ·{' '}
                  {formatCurrency(investedInOpenPositions)} investiti
                </p>
                {openPositionCommissions > 0 ? (
                  <p className="text-xs text-slate-500">
                    Commissioni apertura già pagate:{' '}
                    {formatCurrency(openPositionCommissions)}
                  </p>
                ) : null}
              </>
            }
            info="Capitale contabile simulato: liquidità disponibile più capitale allocato nelle posizioni aperte. Le commissioni di apertura delle posizioni aperte sono già state pagate e quindi riducono il capitale."
            label="Capitale"
            value={formatCurrency(totalCapital)}
          />
          <DashboardBox
            accent={
              openPositionLivePnl >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'
            }
            detail={
              positions.length > 0 ? (
                <>
                  <p>
                    Valore liquidabile stimato:{' '}
                    {formatCurrency(openPositionRealtimeValue)}
                  </p>
                  <p>
                    P/L live netto posizioni aperte:{' '}
                    {formatCurrency(openPositionLivePnl)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Capitale stimato se chiudessi ora:{' '}
                    {formatCurrency(realtimeCapital)}
                  </p>
                </>
              ) : (
                'Nessun titolo acquistato o venduto short in portafoglio.'
              )
            }
            info="Stima in tempo reale delle posizioni aperte: investito più P/L live netto, considerando i costi di chiusura stimati. Serve a capire quanto capitale recupereresti se chiudessi ora."
            label="Capitale live su titoli acquistati"
            value={
              positions.length > 0
                ? formatCurrency(openPositionRealtimeValue)
                : formatCurrency(0)
            }
          />
        </div>
        <DashboardBox
          accent="text-[var(--market-accent)]"
          detail={
            <>
              <p>
                {formatCurrency(todayStats.grossWins)} oggi ·{' '}
                {formatCurrency(currentMonthStats.grossWins)} questo mese
              </p>
              <p className="text-xs text-slate-500">
                Solo operazioni chiuse in positivo, già al netto delle commissioni.
              </p>
            </>
          }
          info={profitsInfo}
          label="Utili realizzati"
          value={formatCurrency(todayStats.grossWins)}
        />
        <DashboardBox
          accent={todayStats.netPnl >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'}
          detail={
            <>
              <p className="font-semibold text-slate-300">
                Oggi: {formatCurrency(todayStats.netPnl)} netti
              </p>
              <p>
                Mese: {formatCurrency(currentMonthStats.netPnl)} netti
              </p>
              <p className="text-xs text-slate-500">
                Oggi: {formatCurrency(todayGrossPnl)} lordi -{' '}
                {formatCurrency(todayCommissions)} commissioni.
              </p>
              <p className="text-xs text-slate-500">
                Mese: {formatCurrency(currentMonthGrossPnl)} lordi -{' '}
                {formatCurrency(currentMonthCommissions)} commissioni.
              </p>
            </>
          }
          info={netPnlInfo}
          label="P/L netto"
          value={formatCurrency(todayStats.netPnl)}
        />
      </section>

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-5">
          <Card className="overflow-hidden">
            <CardHeader className="items-center justify-between gap-4 border-b border-slate-800 p-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-white">Posizioni aperte</CardTitle>
                <InfoTip>
                  Posizioni ancora monitorate dal pilota automatico. Il P/L è
                  stimato sui dati live disponibili.
                </InfoTip>
              </div>
              <Badge>{positions.length}/{maxPositions}</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {positions.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Ticker</TableHead>
                      <TableHead>Apertura</TableHead>
                      <TableHead>Direzione</TableHead>
                      <TableHead>Investito</TableHead>
                      <TableHead>P/L live</TableHead>
                      <TableHead>Costi</TableHead>
                      <TableHead>Giorni</TableHead>
                      <TableHead>Azione</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((position) => {
                      const pnl = Number(position.unrealizedPnl)
                      const pnlAccent =
                        Number.isFinite(pnl) && pnl < 0
                          ? 'font-semibold text-[#ef8f8f]'
                          : 'font-semibold text-[var(--market-accent)]'
                      const estimatedCosts = getOpenPositionEstimatedCosts(position)

                      return (
                        <TableRow key={position.id || position.ticker}>
                          <TableCell className="font-semibold text-white">
                            {position.ticker}
                          </TableCell>
                          <TableCell>{formatDate(position.openedAt)}</TableCell>
                          <TableCell>{position.type === 'LONG' ? 'Long' : 'Short'}</TableCell>
                          <TableCell>{formatCurrency(position.invested)}</TableCell>
                          <TableCell className={pnlAccent}>
                            {Number.isFinite(pnl) ? formatCurrency(pnl) : 'In attesa'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-300">
                                {estimatedCosts > 0
                                  ? formatCurrency(estimatedCosts)
                                  : 'In attesa'}
                              </span>
                              <CostSummaryTip
                                closeLabel="Chiusura stimata"
                                closeCosts={position.executionCosts?.latestClose}
                                netPnl={pnl}
                                openCosts={position.executionCosts?.open}
                                totalCosts={estimatedCosts}
                              />
                            </div>
                          </TableCell>
                          <TableCell>{position.daysHeld || 0}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              disabled={syncMeta?.isStale || closingId === position.id}
                              onClick={() => handleManualClose(position)}
                              className="min-w-36"
                            >
                              {closingId === position.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              {syncMeta?.isStale ? 'Sync richiesta' : 'Chiudi ora'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex min-h-32 items-center justify-center p-5 text-center">
                  <div>
                    <p className="font-medium text-white">Nessuna posizione aperta</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                      Il pilota aprirà posizioni quando scansione, orario, rischio
                      e capitale lo permetteranno.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="items-center justify-between gap-4 border-b border-slate-800 p-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-white">Ultime vendite</CardTitle>
                <InfoTip>
                  Mostra le ultime posizioni chiuse nel mercato selezionato. I
                  valori P/L sono netti dopo spread, slippage e commissioni.
                </InfoTip>
              </div>
              <Badge>{recentClosedTrades.length} recenti</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {recentClosedTrades.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Data</TableHead>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Direzione</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Ricavato</TableHead>
                      <TableHead>Costi</TableHead>
                      <TableHead>P/L</TableHead>
                      <TableHead>Esito</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentClosedTrades.map((trade, index) => {
                      const isWin = trade.result === 'WIN'
                      const recovered = getRecoveredCapital(trade, LEGACY_POSITION_SIZE)
                      const totalCosts =
                        Number.isFinite(Number(trade.totalCostsEur))
                          ? Number(trade.totalCostsEur)
                          : getExecutionImpact(trade.executionCosts?.open) +
                            getExecutionImpact(trade.executionCosts?.close)

                      return (
                        <TableRow key={`${trade.ticker}-${trade.exitDate}-${index}`}>
                          <TableCell>{formatDate(trade.exitDate)}</TableCell>
                          <TableCell className="font-semibold text-white">
                            {trade.ticker}
                          </TableCell>
                          <TableCell>
                            {trade.type === 'LONG' ? 'Long' : 'Short'}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p>{exitReasonLabel(trade.exitReason)}</p>
                              {trade.dataQuality === 'incomplete' ? (
                                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#ef8f8f]">
                                  Dato incompleto
                                </p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="font-semibold text-white">
                            {formatCurrency(recovered)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-300">
                                {formatCurrency(totalCosts)}
                              </span>
                              <CostSummaryTip
                                closeCosts={trade.executionCosts?.close}
                                grossPnl={trade.grossPnlEur}
                                netPnl={trade.pnlEur}
                                openCosts={trade.executionCosts?.open}
                                totalCosts={totalCosts}
                              />
                            </div>
                          </TableCell>
                          <TableCell
                            className={
                              isWin
                                ? 'font-semibold text-[var(--market-accent)]'
                                : 'font-semibold text-[#ef8f8f]'
                            }
                          >
                            {formatCurrency(trade.pnlEur)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={isWin ? 'positive' : 'negative'}>
                              {isWin ? 'Utile' : 'Perdita'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex min-h-36 items-center justify-center p-5 text-center">
                  <div>
                    <p className="font-medium text-white">Nessuna vendita registrata</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                      Quando una posizione verrà chiusa, apparirà qui con ricavato
                      e risultato netto.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="items-center justify-between gap-3 p-4 pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-white">Strategia</CardTitle>
              <InfoTip>
                Le metriche sono utili solo quando esiste uno storico sufficiente.
                Sotto {MINIMUM_SAMPLE} chiusure sono indicative, non decisionali.
              </InfoTip>
            </div>
            <Badge variant={strategyStats.sampleVariant}>
              {strategyStats.sampleLabel}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-3 p-4">
            <DashboardBox
              label="Win rate"
              value={
                strategyStats.total > 0
                  ? percentFormatter.format(strategyStats.winRate)
                  : 'N/D'
              }
              info="Percentuale di operazioni chiuse in profitto."
              accent="text-[var(--market-accent)]"
            />
            <DashboardBox
              label="Expectancy"
              value={
                strategyStats.total > 0
                  ? currencyFormatter.format(strategyStats.expectancy)
                  : 'N/D'
              }
              info="Profitto medio atteso per operazione chiusa, calcolato solo dallo storico reale."
              accent={expectancyColor}
            />
            <DashboardBox
              label="Chiusure"
              value={`${strategyStats.total}`}
              info={`${strategyStats.wins} operazioni in utile e ${strategyStats.losses} in perdita.`}
            />
            <DashboardBox
              label="Perdite"
              value={currencyFormatter.format(strategyStats.grossLosses)}
              info="Somma delle perdite realizzate. Il capitale operativo riflette sia utili reinvestiti sia perdite."
              accent={
                strategyStats.grossLosses > 0 ? 'text-[#ef8f8f]' : 'text-white'
              }
            />
            <DashboardBox
              label="Size"
              value={`${positionPercent}%`}
              info={`Ogni nuova posizione usa circa il ${positionPercent}% del capitale operativo di ${marketLabel}.`}
            />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <DashboardBox
          label="Segnali"
          value={
            scanUniverseIsCurrent
              ? `${lastSignalCount}/${lastScanCount}`
              : `${lastSignalCount}/${lastScanCount || 0}`
          }
          detail={
            scanUniverseIsCurrent
              ? `${marketCopy.assetPlural} aggiornati`
              : `Universo attuale: ${currentUniverseCount}`
          }
          info="Segnali validi trovati nell’ultima scansione completata."
        />
        <DashboardBox
          label="Ordini"
          value={`${executedOrders.length}/${orders.length}`}
          detail="Eseguiti / totali"
          info="Ordini simulati registrati dal sistema."
        />
        <DashboardBox
          label="Slot"
          value={`${positions.length}/${maxPositions}`}
          detail={`Motore: ${engineStatus}`}
          info="Numero di posizioni aperte rispetto al limite massimo del mercato."
        />
      </section>

      <CostAssumptionsPanel />
    </div>
  )
}
