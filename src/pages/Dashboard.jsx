import { useEffect, useState } from 'react'
import {
  Activity,
  BadgeEuro,
  ChartNoAxesCombined,
  Clock3,
  CircleSlash,
  PiggyBank,
  Radar,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
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
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { getMarketDisplayStatus } from '../services/marketHours'
import {
  calculateRealizedTotals,
  filterTradesByCurrentMonth,
  filterTradesByToday,
} from '../services/profitStats'
import { LEGACY_POSITION_SIZE } from '../services/positionSizing'
import {
  getUsMarketContextDetail,
  getUsMarketContextLabel,
} from '../services/usMarketContext'
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

function MiniMetric({ label, value, info, accent = 'text-white' }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        {info ? <InfoTip>{info}</InfoTip> : null}
      </div>
      <p className={`mt-2 text-lg font-semibold leading-tight ${accent}`}>
        {value}
      </p>
    </div>
  )
}

function ProfitWindowCard({ info, title, totals }) {
  const netAccent =
    totals.netPnl >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 p-4 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle>{title}</CardTitle>
          <InfoTip>{info}</InfoTip>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
          <PiggyBank className="h-4 w-4 text-[var(--market-accent)]" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 pt-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            Utili realizzati
          </p>
          <p className="mt-1 text-xl font-semibold text-[var(--market-accent)]">
            {currencyFormatter.format(totals.grossWins)}
          </p>
        </div>
        <div className="border-t border-slate-800 pt-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            P/L netto
          </p>
          <p className={`mt-1 text-xl font-semibold ${netAccent}`}>
            {currencyFormatter.format(totals.netPnl)}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {totals.closed} chiusure · {totals.wins} utili · {totals.losses} perdite
        </p>
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

function MarketStatusBanner({ status }) {
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
  const colorClass = isOpen
    ? 'border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
    : isPreOpen
      ? 'border-amber-400/35 bg-amber-400/10 text-amber-200'
      : 'border-[#ef8f8f]/35 bg-[#ef8f8f]/10 text-[#ef8f8f]'

  return (
    <div className={`mt-4 rounded-lg border p-4 ${colorClass}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-current/30 bg-black/20">
            <Clock3 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight text-white">
              {title}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Orari di apertura: {status.openingHoursLabel}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-current/25 bg-black/25 px-4 py-3">
          <p className="text-sm font-semibold text-white">{countdown}</p>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard({ marketId }) {
  const { activeMarket, markets } = useTrading()
  const [now, setNow] = useState(() => Date.now())
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
  const usMarketContext = routeMarketState.usMarketContext || null
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
  const marketDisplayStatus = getMarketDisplayStatus(
    currentStrategy,
    new Date(now),
  )
  const expectancyColor =
    strategyStats.expectancy >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'
  const kpis = [
    {
      title: 'Capitale',
      value: currencyFormatter.format(totalCapital),
      info: `Capitale totale simulato: include ${currencyFormatter.format(capital)} di liquidità disponibile e ${currencyFormatter.format(investedInOpenPositions)} già investiti in posizioni aperte.`,
      icon: BadgeEuro,
      accent: 'text-[var(--market-accent)]',
    },
    {
      title: 'Slot',
      value: `${positions.length}/${maxPositions}`,
      info: `Stato motore: ${engineStatus}. Numero di posizioni aperte rispetto al limite massimo del mercato.`,
      icon: ShieldCheck,
      accent: 'text-white',
    },
  ]

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-4 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
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

        <MarketStatusBanner status={marketDisplayStatus} />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MiniMetric
            label="Ultima scansione"
            value={lastScanText}
            info="Momento dell’ultima scansione completata con dati reali."
          />
          <MiniMetric
            label="Segnali"
            value={
              scanUniverseIsCurrent
                ? `${lastSignalCount}/${lastScanCount}`
                : `${lastSignalCount}/${lastScanCount || 0} · universo ${currentUniverseCount}`
            }
            info={
              scanUniverseIsCurrent
                ? `Segnali validi trovati sugli ${marketCopy.assetPlural} analizzati.`
                : `L’ultima scansione è stata fatta su ${lastScanCount || 0} ${marketCopy.assetPlural}; l’universo attuale è di ${currentUniverseCount}. La prossima scansione aggiornerà il dato.`
            }
          />
          {effectiveMarket === 'equities' ? (
            <MiniMetric
              label="Contesto USA"
              value={getUsMarketContextLabel(usMarketContext)}
              info={getUsMarketContextDetail(usMarketContext)}
            />
          ) : null}
          <MiniMetric
            label="Ordini"
            value={`${executedOrders.length}/${orders.length}`}
            info="Ordini simulati eseguiti rispetto al totale degli ordini registrati."
          />
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon

          return (
            <Card key={kpi.title}>
              <CardHeader className="flex-row items-center justify-between gap-3 p-4 pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle>{kpi.title}</CardTitle>
                  <InfoTip>{kpi.info}</InfoTip>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                  <Icon className={`h-4 w-4 ${kpi.accent}`} />
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-1">
                <p className={`break-words text-xl font-semibold leading-tight ${kpi.accent}`}>
                  {kpi.value}
                </p>
              </CardContent>
            </Card>
          )
        })}
        <ProfitWindowCard
          title="Mese corrente"
          totals={currentMonthStats}
          info="Dati calcolati dalle chiusure registrate dal primo giorno del mese corrente a oggi."
        />
        <ProfitWindowCard
          title="Oggi"
          totals={todayStats}
          info="Dati calcolati solo dalle chiusure registrate nella giornata attuale."
        />
      </section>

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-5">
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
                      <TableHead>P/L</TableHead>
                      <TableHead>Esito</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentClosedTrades.map((trade, index) => {
                      const isWin = trade.result === 'WIN'
                      const recovered = getRecoveredCapital(trade, LEGACY_POSITION_SIZE)

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
            <MiniMetric
              label="Win rate"
              value={
                strategyStats.total > 0
                  ? percentFormatter.format(strategyStats.winRate)
                  : 'N/D'
              }
              info="Percentuale di operazioni chiuse in profitto."
              accent="text-[var(--market-accent)]"
            />
            <MiniMetric
              label="Expectancy"
              value={
                strategyStats.total > 0
                  ? currencyFormatter.format(strategyStats.expectancy)
                  : 'N/D'
              }
              info="Profitto medio atteso per operazione chiusa, calcolato solo dallo storico reale."
              accent={expectancyColor}
            />
            <MiniMetric
              label="Chiusure"
              value={`${strategyStats.total}`}
              info={`${strategyStats.wins} operazioni in utile e ${strategyStats.losses} in perdita.`}
            />
            <MiniMetric
              label="Perdite"
              value={currencyFormatter.format(strategyStats.grossLosses)}
              info="Somma delle perdite realizzate. Il capitale operativo riflette sia utili reinvestiti sia perdite."
              accent={
                strategyStats.grossLosses > 0 ? 'text-[#ef8f8f]' : 'text-white'
              }
            />
            <MiniMetric
              label="Size"
              value={`${positionPercent}%`}
              info={`Ogni nuova posizione usa circa il ${positionPercent}% del capitale operativo di ${marketLabel}.`}
            />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
              <ChartNoAxesCombined className="h-5 w-5 text-[var(--market-accent)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-white">Andamento capitale</p>
                <InfoTip>
                  Il grafico storico sarà utile quando avremo più punti dati
                  consolidati. Per ora il dato principale resta il capitale operativo.
                </InfoTip>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Grafico in preparazione, senza occupare spazio operativo.
              </p>
            </div>
          </div>
          <Badge>{Math.min(strategyStats.total, MINIMUM_SAMPLE)} / {MINIMUM_SAMPLE}</Badge>
        </CardContent>
      </Card>
    </div>
  )
}
