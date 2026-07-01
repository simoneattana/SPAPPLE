import { useEffect, useMemo, useState } from 'react'
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
  Zap,
} from 'lucide-react'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { calculatePositionSize, MIN_POSITION_SIZE } from '../services/positionSizing'
import { getTradingStrategy } from '../strategies'
import { useLocation } from 'react-router-dom'

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

const EMPTY_ARRAY = []

function formatActivityDate(value) {
  if (!value) {
    return 'Mai'
  }

  return dateTimeFormatter.format(new Date(value))
}

function formatCountdown(target) {
  if (!target) {
    return 'In attesa'
  }

  const remainingMs = new Date(target).getTime() - Date.now()

  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 'A breve'
  }

  const seconds = Math.ceil(remainingMs / 1000)

  if (seconds < 60) {
    return `${seconds}s`
  }

  return `${Math.ceil(seconds / 60)} min`
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
      dot: 'bg-[var(--market-accent)] animate-pulse',
      text: 'text-[var(--market-accent)]',
      border: 'border-[var(--market-accent-border)]',
      bg: 'bg-[var(--market-accent-soft)]',
    }
  }

  if (status === 'attention') {
    return {
      icon: PlayCircle,
      dot: 'bg-[var(--market-accent)]',
      text: 'text-[var(--market-accent)]',
      border: 'border-[var(--market-accent-border)]',
      bg: 'bg-[var(--market-accent-soft)]',
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
    dot: 'bg-[var(--market-accent)]',
    text: 'text-slate-200',
    border: 'border-slate-800',
    bg: 'bg-slate-950',
  }
}

function getOperatingState({
  automationEnabled,
  killSwitchEnabled,
  marketCopy,
  positions,
  lastScanAt,
  lastSignalCount,
  engineStatus,
}) {
  if (killSwitchEnabled) {
    return {
      title: 'Nuove aperture bloccate',
      detail: 'Il kill switch è attivo. Continuo a monitorare eventuali posizioni aperte, ma non aprirò nuovi ordini.',
      variant: 'negative',
    }
  }

  if (engineStatus?.toLowerCase().includes('errore')) {
    return {
      title: engineStatus,
      detail: `Serve una nuova scansione ${marketCopy.label} quando i dati tornano disponibili.`,
      variant: 'negative',
    }
  }

  if (positions.length > 0) {
    return {
      title: 'Monitoraggio posizioni',
      detail: `Ci sono ${positions.length} posizioni aperte su ${marketCopy.label}. Il monitor controlla target e stop su questo mercato.`,
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
    return 'Sto monitorando le posizioni del mercato attivo. Se un prezzo tocca take profit o stop loss, chiudo automaticamente.'
  }

  if (lastScanAt && lastSignalCount > 0 && !automationEnabled) {
    return 'Ci sono segnali disponibili nel mercato attivo: puoi aprirli manualmente dallo Scanner o attivare il Pilota automatico.'
  }

  if (automationEnabled) {
    return 'La prossima scansione aprirà automaticamente i segnali validi finché ci sono slot e capitale.'
  }

  return 'Prossimo passo: vai nello Scanner e avvia una scansione con dati reali.'
}

function buildAssistantMessages({
  automationEnabled,
  backendMonitorEnabled,
  liveMonitorEnabled,
  marketCopy,
  nextLiveCheckAt,
  positions,
}) {
  if (
    positions.length > 0 &&
    automationEnabled &&
    liveMonitorEnabled &&
    backendMonitorEnabled
  ) {
    return [
      'Sono in pilota automatico completo: il browser controlla ogni 60 secondi quando l’app è aperta.',
      `Anche se chiudi l’app, il monitor backend su Vercel continua a controllare ${marketCopy.label} e i prezzi ${marketCopy.provider}.`,
      `Prossimo controllo live locale: ${formatCountdown(nextLiveCheckAt)}.`,
      `Se un ${marketCopy.assetSingular} raggiunge take profit o stop loss, chiudo la posizione e aggiorno capitale, salvadanaio e storico del mercato ${marketCopy.label}.`,
    ]
  }

  if (positions.length > 0) {
    return [
      'Ci sono posizioni aperte, ma il monitor live non è completamente attivo.',
      'Puoi riattivare pilota automatico e monitor live per far controllare a me i prezzi.',
      `In alternativa puoi usare il controllo manuale ${marketCopy.label} dal Portafoglio.`,
    ]
  }

  if (automationEnabled) {
    return [
      'Sono pronto a lavorare in automatico.',
      `Alla prossima scansione ${marketCopy.label} valuterò solo ${marketCopy.assetPlural} e aprirò solo quelli che rispettano le regole.`,
      'Dopo l’apertura partiranno monitor live e monitor backend.',
    ]
  }

  return [
    'Sono in attesa: il pilota automatico è spento.',
    'Puoi riattivarlo quando vuoi per lasciare a Spapple apertura e monitoraggio delle posizioni.',
  ]
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
    activeMarket,
    markets,
    remoteStatus,
    runLiveCheck,
  setAutomationEnabled,
  setKillSwitchEnabled,
  setLiveMonitorEnabled,
} = useTrading()
  const location = useLocation()
  const [, setNow] = useState(Date.now())
  const routeMarket = location.pathname.startsWith('/crypto')
    ? 'crypto'
    : location.pathname.startsWith('/azioni')
      ? 'equities'
      : activeMarket
  const routeStrategy = getTradingStrategy(routeMarket)
  const routeMarketState = markets?.[routeMarket] || {}
  const activityLog = Array.isArray(routeMarketState.activityLog)
    ? routeMarketState.activityLog
    : EMPTY_ARRAY
  const automationEnabled =
    typeof routeMarketState.automationEnabled === 'boolean'
      ? routeMarketState.automationEnabled
      : true
  const backendMonitorEnabled =
    typeof routeMarketState.backendMonitorEnabled === 'boolean'
      ? routeMarketState.backendMonitorEnabled
      : true
  const liveMonitorEnabled =
    typeof routeMarketState.liveMonitorEnabled === 'boolean'
      ? routeMarketState.liveMonitorEnabled
      : true
  const executionMode = routeMarketState.executionMode || 'simulation'
  const killSwitchEnabled = Boolean(routeMarketState.killSwitchEnabled)
  const capital = Number.isFinite(Number(routeMarketState.capital))
    ? Number(routeMarketState.capital)
    : routeStrategy.initialCapital
  const currentStrategy = routeStrategy
  const engineStatus = routeMarketState.engineStatus || 'In attesa'
  const lastScanAt = routeMarketState.lastScanAt || null
  const lastScanCount = Number(routeMarketState.lastScanCount || 0)
  const lastSignalCount = Number(routeMarketState.lastSignalCount || 0)
  const lastBackendCheckAt = routeMarketState.lastBackendCheckAt || null
  const lastLiveCheckAt = routeMarketState.lastLiveCheckAt || null
  const marketLabel = routeMarketState.marketLabel || routeStrategy.label
  const maxPositions = routeStrategy.maxPositions || 5
  const nextLiveCheckAt = routeMarketState.nextLiveCheckAt || null
  const positions = Array.isArray(routeMarketState.positions)
    ? routeMarketState.positions
    : EMPTY_ARRAY
  const slotSize = calculatePositionSize(capital, routeStrategy.positionSizing)
  const minPositionSize = routeStrategy.positionSizing?.min || MIN_POSITION_SIZE
  const marketCopy = getMarketCopy(routeMarket)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const operatingState = getOperatingState({
    automationEnabled,
    killSwitchEnabled,
    marketCopy,
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
  const capitalSlots =
    slotSize >= minPositionSize ? Math.floor(capital / slotSize) : 0
  const executableSlots = Math.min(availableSlots, capitalSlots)
  const assistantMessages = useMemo(
    () =>
      buildAssistantMessages({
        automationEnabled,
        backendMonitorEnabled,
        liveMonitorEnabled,
        marketCopy,
        nextLiveCheckAt,
        positions,
      }),
    [
      automationEnabled,
      backendMonitorEnabled,
      liveMonitorEnabled,
      marketCopy,
      nextLiveCheckAt,
      positions,
    ],
  )

  return (
    <aside className="flex min-h-0 flex-col gap-4 xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)] xl:overflow-y-auto xl:pr-1">
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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
            <Bot className="h-5 w-5 text-[var(--market-accent)]" />
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              Stato ora
            </p>
            <Badge variant={operatingState.variant}>{engineStatus}</Badge>
          </div>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            Mercato attivo
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--market-accent)]">
            {marketLabel || 'Azioni Europa'}
          </p>
          <p className="mt-2 rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] px-3 py-2 text-xs leading-5 text-slate-300">
            Ambiente separato: dati, capitale, posizioni e storico appartengono
            solo a {marketLabel}.
          </p>
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
            <p className="mt-2 text-xl font-semibold text-[var(--market-accent)]">
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

        <div
          className={
            killSwitchEnabled
              ? 'mt-4 rounded-lg border border-[#ef8f8f]/40 bg-[#ef8f8f]/10 p-3'
              : 'mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3'
          }
        >
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
            Esecuzione
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--market-accent)]">
              {executionMode === 'simulation' ? 'Simulazione' : executionMode}
            </p>
            <Badge variant={killSwitchEnabled ? 'negative' : 'positive'}>
              {killSwitchEnabled ? 'Blocco ON' : 'Broker simulato'}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Gli ordini passano da simulationBroker e non muovono denaro reale.
          </p>
          <Button
            className="mt-3 w-full justify-between"
            variant={killSwitchEnabled ? 'default' : 'ghost'}
            onClick={() => setKillSwitchEnabled(!killSwitchEnabled, routeMarket)}
          >
            <span>{killSwitchEnabled ? 'Sblocca aperture' : 'Attiva kill switch'}</span>
            <span>{killSwitchEnabled ? 'OFF' : 'ON'}</span>
          </Button>
        </div>

        <Button
          className="mt-4 w-full justify-between"
          variant={automationEnabled ? 'default' : 'ghost'}
          onClick={() => setAutomationEnabled(!automationEnabled, routeMarket)}
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

        <Button
          className="mt-3 w-full justify-between"
          variant={liveMonitorEnabled ? 'default' : 'ghost'}
          onClick={() => setLiveMonitorEnabled(!liveMonitorEnabled, routeMarket)}
        >
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Monitor live
          </span>
          <span>{liveMonitorEnabled ? 'ON' : 'OFF'}</span>
        </Button>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-[var(--market-accent)]" />
            <p className="text-sm font-semibold text-white">Prossima azione</p>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">{nextAction}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-slate-800 bg-[#090b10] p-2">
              <p className="uppercase tracking-[0.12em] text-slate-600">
                Prossimo controllo
              </p>
              <p className="mt-1 font-semibold text-[var(--market-accent)]">
                {formatCountdown(nextLiveCheckAt)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#090b10] p-2">
              <p className="uppercase tracking-[0.12em] text-slate-600">
                Ultimo controllo
              </p>
              <p className="mt-1 font-semibold text-slate-300">
                {formatActivityDate(lastLiveCheckAt)}
              </p>
            </div>
          </div>
          <div className="mt-2 rounded-lg border border-slate-800 bg-[#090b10] p-2 text-xs">
            <p className="uppercase tracking-[0.12em] text-slate-600">
              Ultimo controllo backend
            </p>
            <p className="mt-1 font-semibold text-slate-300">
              {formatActivityDate(lastBackendCheckAt)}
            </p>
          </div>
          <Button
            className="mt-3 w-full"
            variant="ghost"
            disabled={positions.length === 0}
            onClick={() => runLiveCheck({ targetMarketId: routeMarket })}
          >
            Controlla ora
          </Button>
        </div>

        {positions.length > 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-[var(--market-accent)]" />
              <p className="text-sm font-semibold text-white">
                Posizioni monitorate
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {positions.slice(0, 5).map((position) => {
                const pnl = Number(position.unrealizedPnl)
                const pnlReady = Number.isFinite(pnl)
                const pnlColor = pnl >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'

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
                          : routeMarket === 'crypto'
                            ? 'P/L dopo controllo'
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
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              Archivio remoto
            </p>
            <Badge
              variant={
                remoteStatus === 'sincronizzato'
                  ? 'positive'
                  : remoteStatus?.startsWith('errore')
                    ? 'negative'
                    : 'default'
              }
            >
              {remoteStatus}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--market-accent)]" />
            <p className="text-sm font-semibold text-white">Regole attive</p>
          </div>
          <ul className="mt-2 space-y-2 text-xs leading-5 text-slate-400">
            {currentStrategy?.rules?.profitabilityFilter ? (
              <li>{currentStrategy.rules.profitabilityFilter}.</li>
            ) : null}
            {currentStrategy?.rules?.liquidityFilter ? (
              <li>{currentStrategy.rules.liquidityFilter}.</li>
            ) : null}
            <li>{currentStrategy?.rules?.signalFilter || 'RSI sotto 30 o sopra 70'}.</li>
            <li>Massimo {maxPositions} posizioni aperte.</li>
            <li>
              Ogni nuova posizione usa circa{' '}
              {Math.round((currentStrategy?.positionSizing?.percent || 0.1) * 100)}
              % del capitale operativo.
            </li>
            <li>
              Minimo {currencyFormatter.format(minPositionSize)}, massimo{' '}
              {currencyFormatter.format(currentStrategy?.positionSizing?.max || 0)}
              per posizione.
            </li>
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
              Chat operativa
            </h2>
          </div>
          <Activity className="h-5 w-5 text-[var(--market-accent)]" />
        </div>

        <div className="mt-4 space-y-2">
          {assistantMessages.map((message) => (
            <div
              key={message}
              className="rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] p-3 text-sm leading-6 text-slate-200"
            >
              {message}
            </div>
          ))}
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
