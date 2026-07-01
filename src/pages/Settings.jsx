import {
  CircleSlash,
  PlugZap,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { getTradingStrategy } from '../strategies'

const percentFormatter = new Intl.NumberFormat('it-IT', {
  style: 'percent',
  maximumFractionDigits: 0,
})

export default function Settings() {
  const {
    activeMarket,
    markets,
    setKillSwitchEnabled,
  } = useTrading()
  const strategy = getTradingStrategy(activeMarket)
  const marketState = markets?.[activeMarket] || {}
  const marketCopy = getMarketCopy(activeMarket)
  const executionMode = marketState.executionMode || 'simulation'
  const killSwitchEnabled = Boolean(marketState.killSwitchEnabled)
  const riskLimits = {
    maxDailyOrders: 20,
    maxDailyCapitalPct: 1,
    maxConsecutiveLosses: 3,
    ...(marketState.riskLimits || {}),
  }

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
          Impostazioni operative · {marketCopy.eyebrow}
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
          Controlli broker-ready
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
          Spapple resta in simulazione, ma ora usa lo stesso schema operativo
          che servirà per un futuro broker reale: ordini, stati, blocchi rischio
          e audit completo.
        </p>
      </header>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Modalità operativa</CardTitle>
              <PlugZap className="h-5 w-5 text-[var(--market-accent)]" />
            </div>
          </CardHeader>
          <CardContent>
            <Badge variant="positive">
              {executionMode === 'simulation' ? 'Simulazione' : executionMode}
            </Badge>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              Tutti gli ordini sono eseguiti da `simulationBroker`. Nessuna API
              di broker o exchange riceve ordini reali.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Kill switch</CardTitle>
              <CircleSlash
                className={
                  killSwitchEnabled
                    ? 'h-5 w-5 text-[#ef8f8f]'
                    : 'h-5 w-5 text-slate-500'
                }
              />
            </div>
          </CardHeader>
          <CardContent>
            <Button
              variant={killSwitchEnabled ? 'default' : 'ghost'}
              onClick={() => setKillSwitchEnabled(!killSwitchEnabled, activeMarket)}
            >
              {killSwitchEnabled ? (
                <ToggleRight className="h-4 w-4" />
              ) : (
                <ToggleLeft className="h-4 w-4" />
              )}
              {killSwitchEnabled ? 'Disattiva blocco' : 'Blocca nuove aperture'}
            </Button>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              Quando è attivo blocca solo nuove aperture. Le posizioni già
              aperte restano monitorate e possono chiudersi a target, stop o
              manualmente.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Limiti rischio</CardTitle>
              <ShieldCheck className="h-5 w-5 text-[var(--market-accent)]" />
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm leading-6 text-slate-400">
              <li>
                Massimo <strong className="text-white">{riskLimits.maxDailyOrders}</strong>{' '}
                ordini al giorno.
              </li>
              <li>
                Massimo{' '}
                <strong className="text-white">
                  {percentFormatter.format(riskLimits.maxDailyCapitalPct)}
                </strong>{' '}
                del capitale iniziale allocabile in giornata.
              </li>
              <li>
                Blocco dopo{' '}
                <strong className="text-white">
                  {riskLimits.maxConsecutiveLosses}
                </strong>{' '}
                perdite consecutive.
              </li>
              <li>
                Mercato attivo: <strong className="text-white">{strategy.label}</strong>.
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
