import {
  Activity,
  BadgeEuro,
  ChartNoAxesCombined,
  PiggyBank,
  ShieldCheck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'

const kpis = [
  {
    title: 'Capitale Operativo',
    value: '€ 10.000,00',
    detail: 'Liquidità disponibile',
    icon: BadgeEuro,
    accent: 'text-[#deff9a]',
  },
  {
    title: 'Salvadanaio Profitti',
    value: '€ 0,00',
    detail: 'Profitti consolidati',
    icon: PiggyBank,
    accent: 'text-[#deff9a]',
  },
  {
    title: 'Posizioni Attive',
    value: '0 / 5 Slot',
    detail: 'Capacità operativa',
    icon: ChartNoAxesCombined,
    accent: 'text-slate-200',
  },
  {
    title: 'Stato Sistema',
    value: 'In attesa di scansione EOD',
    detail: 'Controllo giornaliero',
    icon: ShieldCheck,
    accent: 'text-[#deff9a]',
  },
]

export default function Dashboard() {
  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Dashboard operativo
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              Indice Eurozona vs SMA200: Valutazione in corso...
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#deff9a]/25 bg-[#deff9a]/10 px-3 py-2 text-sm font-medium text-[#deff9a]">
            <Activity className="h-4 w-4" />
            Monitoraggio attivo
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
