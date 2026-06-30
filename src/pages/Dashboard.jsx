import {
  Activity,
  BadgeEuro,
  ChartNoAxesCombined,
  PiggyBank,
  Radar,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { useTrading } from '../context/useTrading'

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

export default function Dashboard() {
  const {
    automationEnabled,
    capital,
    engineStatus,
    history,
    lastScanAt,
    lastScanCount,
    lastSignalCount,
    maxPositions,
    positions,
    vault,
  } = useTrading()
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
      accent: 'text-[#deff9a]',
    },
    {
      title: 'Salvadanaio Profitti',
      value: currencyFormatter.format(vault),
      detail: 'Profitti consolidati',
      icon: PiggyBank,
      accent: 'text-[#deff9a]',
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
      accent: 'text-[#deff9a]',
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Dashboard operativo
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              Spapple sta monitorando capitale, segnali e posizioni
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              Ultima scansione: {lastScanText}. Segnali trovati:{' '}
              {lastSignalCount} su {lastScanCount} titoli analizzati.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#deff9a]/25 bg-[#deff9a]/10 px-3 py-2 text-sm font-medium text-[#deff9a]">
            {automationEnabled ? (
              <Activity className="h-4 w-4" />
            ) : (
              <Radar className="h-4 w-4" />
            )}
            {automationEnabled ? 'Pilota automatico ON' : 'Pilota automatico OFF'}
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
            accent="text-[#deff9a]"
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
              strategyStats.expectancy >= 0 ? 'text-[#deff9a]' : 'text-[#ef8f8f]'
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
              <TrendingUp className="h-4 w-4 text-[#deff9a]" />
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
              I 5 slot attuali sono prudenti: limitano esposizione e falsi
              segnali mentre raccogliamo dati. Conviene aumentarli solo quando
              expectancy e win rate risultano stabili su un campione credibile.
            </p>
          </div>
        </div>
      </section>

      <section className="min-h-96 flex-1 rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Forward Testing
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
            <ChartNoAxesCombined className="mx-auto h-8 w-8 text-[#deff9a]" />
            <p className="mt-3 text-sm text-slate-400">
              Area riservata al grafico del capitale
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
