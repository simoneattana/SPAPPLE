import { CalendarClock, Play, Target, Wallet } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { useToast } from '../components/ui/useToast'
import { useTrading } from '../context/useTrading'

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function TradeTypeBadge({ type }) {
  if (type === 'LONG') {
    return <Badge variant="positive">Long</Badge>
  }

  return <Badge variant="negative">Short</Badge>
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
    </div>
  )
}

export default function Portfolio() {
  const { positions, capital, vault, runEOD, maxPositions } = useTrading()
  const { toast } = useToast()

  const handleRunEOD = () => {
    runEOD()
    toast({
      title: 'Motore EOD eseguito. Giorni aggiornati.',
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="flex flex-col gap-5 rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            Portafoglio virtuale
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            Posizioni Forward Testing
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Gestione degli slot operativi, target autotuning e motore EOD.
          </p>
        </div>

        <Button onClick={handleRunEOD} disabled={positions.length === 0}>
          <Play className="h-4 w-4" />
          Esegui Motore EOD (Fine Giornata)
        </Button>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <CardTitle>Capitale Operativo</CardTitle>
            <Wallet className="h-5 w-5 text-[#deff9a]" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-[#deff9a]">
              {currencyFormatter.format(capital)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <CardTitle>Salvadanaio Profitti</CardTitle>
            <Target className="h-5 w-5 text-[#deff9a]" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-[#deff9a]">
              {currencyFormatter.format(vault)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <CardTitle>Slot Attivi</CardTitle>
            <CalendarClock className="h-5 w-5 text-slate-300" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-white">
              {positions.length} / {maxPositions}
            </p>
          </CardContent>
        </Card>
      </section>

      {positions.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {positions.map((position) => (
            <Card key={position.id}>
              <CardHeader className="items-start justify-between gap-4 border-b border-slate-800">
                <div>
                  <CardTitle>{position.ticker}</CardTitle>
                  <p className="mt-2 text-sm text-slate-500">
                    Slot investito: {currencyFormatter.format(position.invested)}
                  </p>
                </div>
                <TradeTypeBadge type={position.type} />
              </CardHeader>
              <CardContent className="grid gap-3 pt-5">
                <Metric
                  label="Prezzo Ingresso"
                  value={currencyFormatter.format(position.entryPrice)}
                />
                <Metric
                  label="Take Profit Target"
                  value={currencyFormatter.format(position.takeProfit)}
                />
                <Metric
                  label="Stop Loss"
                  value={currencyFormatter.format(position.stopLoss)}
                />
                <Metric
                  label="ATR Ingresso"
                  value={numberFormatter.format(position.atrAtEntry)}
                />
                <Metric
                  label="Giorni in Portafoglio"
                  value={`${position.daysHeld} giorni`}
                />
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <section className="flex min-h-[420px] items-center justify-center rounded-lg border border-slate-800 bg-[#090b10] p-8 text-center shadow-xl shadow-black/20">
          <div>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-[#deff9a]/25 bg-[#deff9a]/10">
              <Wallet className="h-6 w-6 text-[#deff9a]" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-white">
              Nessuna posizione attiva
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
              Apri una posizione dallo Scanner di Mercato per avviare il forward
              testing.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
