import {
  Activity,
  BadgeEuro,
  BookOpen,
  ChartNoAxesCombined,
  CircleSlash,
  PiggyBank,
  Radar,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
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

function exitReasonLabel(reason) {
  const labels = {
    MANUALE: 'Manuale',
    STOP_LOSS: 'Stop loss',
    TAKE_PROFIT: 'Take profit',
  }

  return labels[reason] || reason || 'N/D'
}

function calculateStrategyStats(history) {
  const closedTrades = Array.isArray(history) ? history : []
  const wins = closedTrades.filter((trade) => trade.result === 'WIN')
  const losses = closedTrades.filter((trade) => trade.result === 'LOSS')
  const total = closedTrades.length
  const winRate = total > 0 ? wins.length / total : 0
  const averageWin =
    wins.length > 0
      ? wins.reduce((sum, trade) => sum + Number(trade.pnlEur || 0), 0) /
        wins.length
      : 0
  const averageLoss =
    losses.length > 0
      ? Math.abs(
          losses.reduce((sum, trade) => sum + Number(trade.pnlEur || 0), 0) /
            losses.length,
        )
      : 0
  const expectancy =
    total > 0 ? winRate * averageWin - (1 - winRate) * averageLoss : 0

  let sampleLabel = 'Campione insufficiente'
  let sampleDetail = `Servono almeno ${MINIMUM_SAMPLE} operazioni chiuse per una prima stima.`
  let sampleVariant = 'negative'

  if (total >= RELIABLE_SAMPLE) {
    sampleLabel = 'Stima attendibile'
    sampleDetail = 'Il campione è abbastanza ampio per valutare la strategia.'
    sampleVariant = 'positive'
  } else if (total >= MINIMUM_SAMPLE) {
    sampleLabel = 'Stima iniziale'
    sampleDetail = `Campione utile, ma sotto le ${RELIABLE_SAMPLE} operazioni resta prudenziale.`
    sampleVariant = 'default'
  }

  return {
    averageLoss,
    averageWin,
    expectancy,
    losses: losses.length,
    sampleDetail,
    sampleLabel,
    sampleVariant,
    total,
    winRate,
    wins: wins.length,
  }
}

function StatBox({ label, value, detail, accent = 'text-white' }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className={`mt-2 text-xl font-semibold ${accent}`}>{value}</p>
      {detail ? <p className="mt-2 text-sm text-slate-500">{detail}</p> : null}
    </div>
  )
}

export default function Dashboard({ marketId }) {
  const {
    activeMarket,
    markets,
  } = useTrading()
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
  const vault = Number.isFinite(Number(routeMarketState.vault))
    ? Number(routeMarketState.vault)
    : 0
  const positions = Array.isArray(routeMarketState.positions)
    ? routeMarketState.positions
    : []
  const history = Array.isArray(routeMarketState.history)
    ? routeMarketState.history
    : []
  const engineStatus = routeMarketState.engineStatus || 'In attesa'
  const executionMode = routeMarketState.executionMode || 'simulation'
  const killSwitchEnabled = Boolean(routeMarketState.killSwitchEnabled)
  const orders = Array.isArray(routeMarketState.orders)
    ? routeMarketState.orders
    : []
  const executedOrders = orders.filter((order) => order.status === 'ESEGUITO')
  const recentClosedTrades = history.slice(0, 5)
  const ordersById = new Map(orders.map((order) => [order.id, order]))
  const lastScanAt = routeMarketState.lastScanAt || null
  const lastScanCount = Number(routeMarketState.lastScanCount || 0)
  const lastSignalCount = Number(routeMarketState.lastSignalCount || 0)
  const marketLabel = routeMarketState.marketLabel || currentStrategy.label
  const maxPositions = currentStrategy.maxPositions || 5
  const marketCopy = getMarketCopy(effectiveMarket)
  const positionPercent = Math.round(
    (currentStrategy?.positionSizing?.percent || 0.1) * 100,
  )
  const lastScanText = lastScanAt
    ? new Intl.DateTimeFormat('it-IT', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(lastScanAt))
    : 'Non ancora eseguita'
  const strategyStats = calculateStrategyStats(history)
  const kpis = [
    {
      title: 'Capitale Operativo',
      value: currencyFormatter.format(capital),
      detail: 'Liquidità disponibile',
      icon: BadgeEuro,
      accent: 'text-[var(--market-accent)]',
    },
    {
      title: 'Salvadanaio Profitti',
      value: currencyFormatter.format(vault),
      detail: 'Profitti consolidati',
      icon: PiggyBank,
      accent: 'text-[var(--market-accent)]',
    },
    {
      title: 'Posizioni Attive',
      value: `${positions.length} / ${maxPositions} Slot`,
      detail: 'Capacità operativa',
      icon: ChartNoAxesCombined,
      accent: 'text-slate-200',
    },
    {
      title: 'Stato Sistema',
      value: engineStatus,
      detail: automationEnabled ? 'Pilota automatico attivo' : 'Pilota manuale',
      icon: ShieldCheck,
      accent: 'text-[var(--market-accent)]',
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Dashboard operativo · {marketCopy.eyebrow}
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              Dashboard {marketLabel}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              Ambiente operativo separato.{' '}
              Ultima scansione: {lastScanText}. Segnali trovati:{' '}
              {lastSignalCount} su {lastScanCount} {marketCopy.assetPlural}{' '}
              analizzati.
            </p>
            {marketCopy.budgetReason ? (
              <p className="mt-3 max-w-3xl rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] px-3 py-2 text-sm leading-6 text-slate-300">
                {marketCopy.budgetReason}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] px-3 py-2 text-sm font-medium text-[var(--market-accent)]">
            {automationEnabled ? (
              <Activity className="h-4 w-4" />
            ) : (
              <Radar className="h-4 w-4" />
            )}
            {automationEnabled ? 'Pilota automatico ON' : 'Pilota automatico OFF'}
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              Modalità operativa
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--market-accent)]">
              {executionMode === 'simulation'
                ? 'Simulazione'
                : executionMode}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Nessun ordine reale viene inviato a broker o exchange.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              Ordini simulati
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {executedOrders.length} eseguiti / {orders.length} totali
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Le posizioni passano dal registro ordini broker-ready.
            </p>
          </div>
          <div
            className={
              killSwitchEnabled
                ? 'rounded-lg border border-[#ef8f8f]/40 bg-[#ef8f8f]/10 p-3'
                : 'rounded-lg border border-slate-800 bg-slate-950 p-3'
            }
          >
            <div className="flex items-center gap-2">
              <CircleSlash
                className={
                  killSwitchEnabled
                    ? 'h-4 w-4 text-[#ef8f8f]'
                    : 'h-4 w-4 text-slate-500'
                }
              />
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                Kill switch
              </p>
            </div>
            <p
              className={
                killSwitchEnabled
                  ? 'mt-2 text-sm font-semibold text-[#ef8f8f]'
                  : 'mt-2 text-sm font-semibold text-white'
              }
            >
              {killSwitchEnabled ? 'Nuove aperture bloccate' : 'Non attivo'}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Le posizioni aperte restano comunque monitorate.
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon

          return (
            <Card key={kpi.title}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <CardTitle>{kpi.title}</CardTitle>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                  <Icon className={`h-5 w-5 ${kpi.accent}`} />
                </div>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-semibold leading-tight ${kpi.accent}`}>
                  {kpi.value}
                </p>
                <p className="mt-2 text-sm text-slate-500">{kpi.detail}</p>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Ultime chiusure</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Vendite e ricoperture chiuse automaticamente o manualmente nel
              mercato {marketLabel}.
            </p>
          </div>
          <Badge>{history.length} chiuse</Badge>
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
                  <TableHead>P/L</TableHead>
                  <TableHead>Esito</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentClosedTrades.map((trade, index) => {
                  const closeOrder = ordersById.get(trade.closeOrderId)
                  const isWin = trade.result === 'WIN'

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
                          <p className="mt-1 text-xs text-slate-500">
                            {closeOrder?.source === 'backend-monitor'
                              ? 'Chiusura backend'
                              : closeOrder?.source === 'live-monitor'
                                ? 'Monitor live'
                                : closeOrder?.source === 'manual'
                                  ? 'Manuale'
                                  : 'Motore automatico'}
                          </p>
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
            <div className="flex min-h-48 items-center justify-center p-6 text-center">
              <div>
                <BookOpen className="mx-auto h-6 w-6 text-slate-500" />
                <p className="mt-3 font-medium text-white">
                  Nessuna chiusura registrata
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Quando Spapple chiude una posizione, comparirà qui senza dover
                  cercare nel diario.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Affidabilità strategia
            </p>
            <h2 className="mt-3 text-xl font-semibold text-white">
              Probabilità stimata solo su operazioni chiuse
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Spapple non inventa percentuali: calcola win rate ed expectancy
              solo dai trade realmente chiusi dal motore.
            </p>
          </div>
          <Badge variant={strategyStats.sampleVariant}>
            {strategyStats.sampleLabel}
          </Badge>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatBox
            label="Operazioni chiuse"
            value={`${strategyStats.total}`}
            detail={`${strategyStats.wins} WIN / ${strategyStats.losses} LOSS`}
          />
          <StatBox
            label="Win Rate"
            value={
              strategyStats.total > 0
                ? percentFormatter.format(strategyStats.winRate)
                : 'N/D'
            }
            detail="Percentuale di trade chiusi in profitto"
            accent="text-[var(--market-accent)]"
          />
          <StatBox
            label="Expectancy"
            value={
              strategyStats.total > 0
                ? currencyFormatter.format(strategyStats.expectancy)
                : 'N/D'
            }
            detail="Profitto medio atteso per trade"
            accent={
              strategyStats.expectancy >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'
            }
          />
          <StatBox
            label="Campione minimo"
            value={`${Math.min(strategyStats.total, MINIMUM_SAMPLE)} / ${MINIMUM_SAMPLE}`}
            detail={strategyStats.sampleDetail}
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[var(--market-accent)]" />
              <p className="text-sm font-semibold text-white">
                Lettura corretta
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Sotto le {MINIMUM_SAMPLE} operazioni chiuse la stima è solo
              orientativa. Sopra le {RELIABLE_SAMPLE} diventa più utile per
              decidere se aumentare capitale, slot o automazione.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <p className="text-sm font-semibold text-white">
              Slot operativi consigliati
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Gli slot attuali sono separati per mercato. Su {marketLabel} il
              sistema usa massimo {maxPositions} posizioni e circa{' '}
              {positionPercent}% del capitale per nuova posizione. Conviene
              aumentare il rischio solo quando expectancy e win rate risultano
              stabili su un campione credibile.
            </p>
          </div>
        </div>
      </section>

      <section className="min-h-96 flex-1 rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Forward Testing · {marketLabel}
            </p>
            <h2 className="mt-3 text-xl font-semibold text-white">
              Andamento Capitale (Forward Testing)
            </h2>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-400">
            Grafico in preparazione
          </div>
        </div>

        <div className="mt-8 flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-[linear-gradient(135deg,rgba(222,255,154,0.08),rgba(15,23,42,0.22))]">
          <div className="text-center">
            <ChartNoAxesCombined className="mx-auto h-8 w-8 text-[var(--market-accent)]" />
            <p className="mt-3 text-sm text-slate-400">
              Area riservata al grafico del capitale
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
