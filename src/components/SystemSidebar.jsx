import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ListChecks,
  PlayCircle,
  Radio,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { useTrading } from '../context/useTrading'

const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

function formatActivityDate(value) {
  if (!value) {
    return 'Mai'
  }

  return dateTimeFormatter.format(new Date(value))
}

function activityStyles(status) {
  if (status === 'error') {
    return {
      icon: AlertTriangle,
      dot: 'bg-[#ef8f8f]',
      text: 'text-[#ef8f8f]',
      border: 'border-[#ef8f8f]/30',
      bg: 'bg-[#ef8f8f]/10',
    }
  }

  if (status === 'working') {
    return {
      icon: Radio,
      dot: 'bg-[#deff9a] animate-pulse',
      text: 'text-[#deff9a]',
      border: 'border-[#deff9a]/30',
      bg: 'bg-[#deff9a]/10',
    }
  }

  if (status === 'attention') {
    return {
      icon: PlayCircle,
      dot: 'bg-[#deff9a]',
      text: 'text-[#deff9a]',
      border: 'border-[#deff9a]/30',
      bg: 'bg-[#deff9a]/10',
    }
  }

  if (status === 'waiting') {
    return {
      icon: Clock3,
      dot: 'bg-slate-500',
      text: 'text-slate-300',
      border: 'border-slate-700',
      bg: 'bg-slate-950',
    }
  }

  return {
    icon: CheckCircle2,
    dot: 'bg-[#deff9a]',
    text: 'text-slate-200',
    border: 'border-slate-800',
    bg: 'bg-slate-950',
  }
}

function getOperatingState({
  automationEnabled,
  positions,
  lastScanAt,
  lastSignalCount,
  engineStatus,
}) {
  if (engineStatus?.toLowerCase().includes('errore')) {
    return {
      title: engineStatus,
      detail: 'Serve una nuova scansione o un nuovo EOD quando i dati tornano disponibili.',
      variant: 'negative',
    }
  }

  if (positions.length > 0) {
    return {
      title: 'Monitoraggio posizioni',
      detail: `Ci sono ${positions.length} posizioni aperte. Il prossimo controllo utile è il Motore EOD.`,
      variant: 'positive',
    }
  }

  if (lastScanAt && lastSignalCount === 0) {
    return {
      title: 'In attesa di nuovi segnali',
      detail: 'L’ultima scansione non ha trovato condizioni operative valide.',
      variant: 'default',
    }
  }

  return {
    title: automationEnabled ? 'Pilota automatico pronto' : 'Sistema in attesa',
    detail: automationEnabled
      ? 'Avvia una scansione: se trova segnali validi, li trasformerà in posizioni.'
      : 'Avvia lo Scanner o attiva il Pilota automatico per ridurre le decisioni manuali.',
    variant: automationEnabled ? 'positive' : 'default',
  }
}

function getNextAction({ automationEnabled, positions, lastScanAt, lastSignalCount }) {
  if (positions.length > 0) {
    return 'A mercati chiusi, esegui il Motore EOD: aggiornerà i prezzi e chiuderà solo target o stop loss raggiunti.'
  }

  if (lastScanAt && lastSignalCount > 0 && !automationEnabled) {
    return 'Ci sono segnali disponibili: puoi aprirli manualmente dallo Scanner o attivare il Pilota automatico.'
  }

  if (automationEnabled) {
    return 'La prossima scansione aprirà automaticamente i segnali validi finché ci sono slot e capitale.'
  }

  return 'Prossimo passo: vai nello Scanner e avvia una scansione EOD con dati reali.'
}

function ActivityItem({ item }) {
  const styles = activityStyles(item.status)
  const Icon = styles.icon

  return (
    <li className={`rounded-lg border p-3 ${styles.border} ${styles.bg}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${styles.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className={`text-sm font-semibold ${styles.text}`}>{item.title}</p>
            <Icon className={`h-4 w-4 shrink-0 ${styles.text}`} />
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{item.detail}</p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-slate-600">
            {formatActivityDate(item.createdAt)}
          </p>
        </div>
      </div>
    </li>
  )
}

export function SystemSidebar() {
  const {
    activityLog,
    automationEnabled,
    capital,
    engineStatus,
    lastScanAt,
    lastScanCount,
    lastSignalCount,
    maxPositions,
    positions,
    setAutomationEnabled,
    slotSize,
  } = useTrading()

  const operatingState = getOperatingState({
    automationEnabled,
    positions,
    lastScanAt,
    lastSignalCount,
    engineStatus,
  })
  const nextAction = getNextAction({
    automationEnabled,
    positions,
    lastScanAt,
    lastSignalCount,
  })
  const availableSlots = Math.max(maxPositions - positions.length, 0)
  const capitalSlots = Math.floor(capital / slotSize)
  const executableSlots = Math.min(availableSlots, capitalSlots)

  return (
    <aside className="flex flex-col gap-4 xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)]">
      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-4 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Regia sistema
            </p>
            <h2 className="mt-2 text-lg font-semibold text-white">
              Pannello Operativo
            </h2>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#deff9a]/30 bg-[#deff9a]/10">
            <Bot className="h-5 w-5 text-[#deff9a]" />
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              Stato ora
            </p>
            <Badge variant={operatingState.variant}>{engineStatus}</Badge>
          </div>
          <p className="mt-3 text-base font-semibold text-white">
            {operatingState.title}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {operatingState.detail}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              Slot usabili
            </p>
            <p className="mt-2 text-xl font-semibold text-[#deff9a]">
              {executableSlots}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              Segnali
            </p>
            <p className="mt-2 text-xl font-semibold text-white">
              {lastSignalCount}/{lastScanCount}
            </p>
          </div>
        </div>

        <Button
          className="mt-4 w-full justify-between"
          variant={automationEnabled ? 'default' : 'ghost'}
          onClick={() => setAutomationEnabled(!automationEnabled)}
        >
          <span className="flex items-center gap-2">
            {automationEnabled ? (
              <ToggleRight className="h-4 w-4" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
            Pilota automatico
          </span>
          <span>{automationEnabled ? 'ON' : 'OFF'}</span>
        </Button>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-[#deff9a]" />
            <p className="text-sm font-semibold text-white">Prossima azione</p>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">{nextAction}</p>
        </div>

        {positions.length > 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-[#deff9a]" />
              <p className="text-sm font-semibold text-white">
                Posizioni monitorate
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {positions.slice(0, 5).map((position) => {
                const pnl = Number(position.unrealizedPnl)
                const pnlReady = Number.isFinite(pnl)
                const pnlColor = pnl >= 0 ? 'text-[#deff9a]' : 'text-[#ef8f8f]'

                return (
                  <div
                    key={position.id}
                    className="rounded-lg border border-slate-800 bg-[#090b10] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">
                        {position.ticker}
                      </p>
                      <Badge
                        variant={position.type === 'LONG' ? 'positive' : 'negative'}
                      >
                        {position.type === 'LONG' ? 'Long' : 'Short'}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                      <span>{position.daysHeld} giorni</span>
                      <span className={pnlReady ? pnlColor : 'text-slate-500'}>
                        {pnlReady
                          ? currencyFormatter.format(pnl)
                          : 'P/L dopo EOD'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#deff9a]" />
            <p className="text-sm font-semibold text-white">Regole attive</p>
          </div>
          <ul className="mt-2 space-y-2 text-xs leading-5 text-slate-400">
            <li>P/E positivo obbligatorio.</li>
            <li>RSI sotto 30 o sopra 70.</li>
            <li>Massimo {maxPositions} posizioni aperte.</li>
            <li>Ogni slot usa 2.000€.</li>
          </ul>
        </div>
      </section>

      <section className="min-h-0 rounded-lg border border-slate-800 bg-[#090b10] p-4 shadow-xl shadow-black/20 xl:overflow-hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Diario sistema
            </p>
            <h2 className="mt-2 text-base font-semibold text-white">
              Cosa è successo
            </h2>
          </div>
          <Activity className="h-5 w-5 text-[#deff9a]" />
        </div>

        <ol className="mt-4 space-y-3 xl:max-h-[34vh] xl:overflow-y-auto xl:pr-1">
          {(activityLog || []).map((item) => (
            <ActivityItem key={item.id} item={item} />
          ))}
        </ol>
      </section>
    </aside>
  )
}
