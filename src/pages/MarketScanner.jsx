import { Link } from 'react-router-dom'
import { Activity, ArrowRight, Clock3, Radar } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { InfoTip } from '../components/ui/InfoTip'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { getMarketDisplayStatus } from '../services/marketHours'
import {
  calculateRealizedTotals,
  filterTradesByCurrentMonth,
} from '../services/profitStats'
import { getMarketTheme } from '../services/marketTheme'
import { getTradingStrategy } from '../strategies'

const visibleMarketIds = ['equities', 'usa', 'asia']

const marketRoutes = {
  asia: '/asia/dashboard',
  equities: '/europa/dashboard',
  usa: '/usa/dashboard',
}

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatCurrency(value) {
  return Number.isFinite(Number(value))
    ? currencyFormatter.format(Number(value))
    : 'N/D'
}

function formatDate(value) {
  return value ? dateFormatter.format(new Date(value)) : 'Mai'
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

function getMarketStatusSummary(strategy) {
  const status = getMarketDisplayStatus(strategy)
  const open = status.isAnyMarketOpen
  const preOpen = !open && status.isAnyPreOpen

  return {
    accent: open
      ? 'text-[var(--market-accent)]'
      : preOpen
        ? 'text-amber-200'
        : 'text-[#ef8f8f]',
    label: open ? 'Aperto' : preOpen ? 'Pre-apertura' : 'Chiuso',
    timing: open
      ? `chiude tra ${formatDuration(Number(status.minutesToMarketClose || 0) * 60)}`
      : `apre tra ${formatDuration(status.secondsToOpen)}`,
  }
}

function SummaryMetric({ label, value, accent = 'text-white' }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className={`mt-2 text-lg font-semibold ${accent}`}>{value}</p>
    </div>
  )
}

function MarketSummaryCard({ marketId, marketState }) {
  const strategy = getTradingStrategy(marketId)
  const copy = getMarketCopy(marketId)
  const theme = getMarketTheme(marketId)
  const history = Array.isArray(marketState.history) ? marketState.history : []
  const orders = Array.isArray(marketState.orders) ? marketState.orders : []
  const positions = Array.isArray(marketState.positions) ? marketState.positions : []
  const monthStats = calculateRealizedTotals(filterTradesByCurrentMonth(history))
  const capital = Number.isFinite(Number(marketState.capital))
    ? Number(marketState.capital)
    : strategy.initialCapital
  const invested = positions.reduce((total, position) => {
    const value = Number(position.invested)

    return Number.isFinite(value) ? total + value : total
  }, 0)
  const totalCapital = capital + invested
  const status = getMarketStatusSummary(strategy)
  const lastScanCount = Number(marketState.lastScanCount || 0)
  const lastSignalCount = Number(marketState.lastSignalCount || 0)
  const executedOrders = orders.filter((order) => order.status === 'ESEGUITO')
  const maxPositions = strategy.maxPositions || 5
  const netPnlAccent =
    monthStats.netPnl >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'

  return (
    <Card
      style={{
        '--market-accent': theme.accent,
        '--market-accent-border': theme.accentBorder,
        '--market-accent-hover': theme.accentHover,
        '--market-accent-soft': theme.accentSoft,
      }}
    >
      <CardHeader className="items-start justify-between gap-4 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {copy.eyebrow}
          </p>
          <CardTitle className="mt-2 text-2xl font-semibold text-white">
            {copy.label}
          </CardTitle>
        </div>
        <Badge variant={status.label === 'Aperto' ? 'positive' : 'default'}>
          {status.label}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-4 p-5 pt-0">
        <div className="rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] p-4">
          <div className="flex items-center gap-3">
            <Clock3 className={`h-5 w-5 ${status.accent}`} />
            <div>
              <p className={`font-semibold ${status.accent}`}>
                Mercato {status.label.toLowerCase()}
              </p>
              <p className="mt-1 text-sm text-slate-400">{status.timing}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryMetric
            accent="text-[var(--market-accent)]"
            label="Capitale"
            value={formatCurrency(totalCapital)}
          />
          <SummaryMetric
            accent={netPnlAccent}
            label="P/L mese"
            value={formatCurrency(monthStats.netPnl)}
          />
          <SummaryMetric
            label="Ultima scansione"
            value={formatDate(marketState.lastScanAt)}
          />
          <SummaryMetric
            label="Segnali"
            value={`${lastSignalCount}/${lastScanCount || 0}`}
          />
          <SummaryMetric
            label="Ordini"
            value={`${executedOrders.length}/${orders.length}`}
          />
          <SummaryMetric
            label="Slot"
            value={`${positions.length}/${maxPositions}`}
          />
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Stato operativo
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {marketState.lastAutomationMessage ||
              marketState.engineStatus ||
              'Pilota automatico pronto.'}
          </p>
        </div>

        <Link
          to={marketRoutes[marketId]}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent)] px-4 text-sm font-semibold text-slate-950 shadow-lg shadow-[var(--market-accent-soft)] transition hover:bg-[var(--market-accent-hover)]"
        >
          Vai alla dashboard
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  )
}

export default function MarketScanner() {
  const { markets } = useTrading()

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
            <Radar className="h-5 w-5 text-[var(--market-accent)]" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Regia unica
            </p>
            <h1 className="text-3xl font-semibold text-white">
              Sintesi mercati
            </h1>
          </div>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-slate-500">
          Un colpo d’occhio su Europa, USA e Asia. Le scansioni manuali sono ora
          dentro le singole dashboard, accanto allo stato operativo.
        </p>
      </header>

      <div className="rounded-lg border border-slate-800 bg-[#090b10] p-4">
        <div className="flex items-start gap-3">
          <Activity className="mt-0.5 h-5 w-5 text-[var(--market-accent)]" />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-white">Stato generale Spapple</p>
              <InfoTip>
                Questa pagina non mostra posizioni aperte o asset scelti: serve
                solo per capire rapidamente come stanno lavorando i tre mercati.
              </InfoTip>
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Capitale, P/L mensile, scansioni, ordini e slot restano separati
              per mercato.
            </p>
          </div>
        </div>
      </div>

      <section className="grid gap-5 xl:grid-cols-3">
        {visibleMarketIds.map((marketId) => (
          <MarketSummaryCard
            key={marketId}
            marketId={marketId}
            marketState={markets?.[marketId] || {}}
          />
        ))}
      </section>
    </div>
  )
}
