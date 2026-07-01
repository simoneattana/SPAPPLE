import { useEffect, useState } from 'react'
import {
  Bot,
  Clock3,
  ListChecks,
  Radio,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  Zap,
} from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { getTradingStrategy } from '../strategies'

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

function getOperatingState({
  automationEnabled,
  engineStatus,
  killSwitchEnabled,
  marketCopy,
  positions,
}) {
  if (killSwitchEnabled) {
    return {
      title: 'Nuove aperture bloccate',
      detail: 'Continuo a controllare le posizioni aperte, ma non apro nuovi ordini.',
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
      title: 'Monitoraggio attivo',
      detail: `${positions.length} posizioni aperte su ${marketCopy.label}. Controllo target e stop.`,
      variant: 'positive',
    }
  }

  return {
    title: automationEnabled ? 'Pilota pronto' : 'Pilota spento',
    detail: automationEnabled
      ? 'Alla prossima scansione apro automaticamente i segnali validi.'
      : 'Riattiva il pilota automatico per lasciare a Spapple apertura e controllo.',
    variant: automationEnabled ? 'positive' : 'default',
  }
}

function getNextAction({
  automationEnabled,
  killSwitchEnabled,
  lastScanAt,
  lastSignalCount,
  positions,
}) {
  if (killSwitchEnabled) {
    return 'Attendo che tu disattivi il kill switch. Le aperture automatiche sono bloccate.'
  }

  if (positions.length > 0) {
    return 'Sto monitorando le posizioni aperte. Se un prezzo tocca take profit o stop loss, chiudo automaticamente.'
  }

  if (lastScanAt && lastSignalCount > 0 && !automationEnabled) {
    return 'Ci sono segnali disponibili, ma il pilota automatico è spento. Puoi riattivarlo o agire dallo Scanner.'
  }

  if (automationEnabled) {
    return 'Cercherò nuovi segnali e aprirò posizioni solo se rispettano le regole del mercato attivo.'
  }

  return 'Prossimo passo: riattiva il pilota oppure avvia una scansione manuale.'
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
  const strategy = getTradingStrategy(routeMarket)
  const marketState = markets?.[routeMarket] || {}
  const marketCopy = getMarketCopy(routeMarket)
  const automationEnabled =
    typeof marketState.automationEnabled === 'boolean'
      ? marketState.automationEnabled
      : true
  const liveMonitorEnabled =
    typeof marketState.liveMonitorEnabled === 'boolean'
      ? marketState.liveMonitorEnabled
      : true
  const killSwitchEnabled = Boolean(marketState.killSwitchEnabled)
  const positions = Array.isArray(marketState.positions)
    ? marketState.positions
    : EMPTY_ARRAY
  const engineStatus = marketState.engineStatus || 'In attesa'
  const lastScanAt = marketState.lastScanAt || null
  const lastSignalCount = Number(marketState.lastSignalCount || 0)
  const lastLiveCheckAt = marketState.lastLiveCheckAt || null
  const lastBackendCheckAt = marketState.lastBackendCheckAt || null
  const nextLiveCheckAt = marketState.nextLiveCheckAt || null
  const marketLabel = marketState.marketLabel || strategy.label
  const operatingState = getOperatingState({
    automationEnabled,
    engineStatus,
    killSwitchEnabled,
    marketCopy,
    positions,
  })
  const nextAction = getNextAction({
    automationEnabled,
    killSwitchEnabled,
    lastScanAt,
    lastSignalCount,
    positions,
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="mt-4 rounded-lg border border-slate-800 bg-[#090b10] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Regia sistema
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {marketLabel}
          </p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
          <Bot className="h-4 w-4 text-[var(--market-accent)]" />
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] p-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-[var(--market-accent)]" />
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--market-accent)]">
            Prossima azione
          </p>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-200">{nextAction}</p>
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Stato ora
          </p>
          <Badge variant={operatingState.variant}>{engineStatus}</Badge>
        </div>
        <p className="mt-2 text-sm font-semibold text-white">
          {operatingState.title}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          {operatingState.detail}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
          <div className="rounded-lg border border-slate-800 bg-[#090b10] p-2">
            <p>Prossimo</p>
            <p className="mt-1 font-semibold text-[var(--market-accent)]">
              {formatCountdown(nextLiveCheckAt)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#090b10] p-2">
            <p>Ultimo live</p>
            <p className="mt-1 font-semibold text-slate-300">
              {formatActivityDate(lastLiveCheckAt)}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-600">
          Backend: {formatActivityDate(lastBackendCheckAt)} · Archivio:{' '}
          {remoteStatus}
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Esecuzione
        </p>
        <div className="mt-3 space-y-2">
          <Button
            className="w-full justify-between"
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
            className="w-full justify-between"
            variant={liveMonitorEnabled ? 'default' : 'ghost'}
            onClick={() => setLiveMonitorEnabled(!liveMonitorEnabled, routeMarket)}
          >
            <span className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Monitor live
            </span>
            <span>{liveMonitorEnabled ? 'ON' : 'OFF'}</span>
          </Button>
          <Button
            className="w-full justify-between"
            variant={killSwitchEnabled ? 'default' : 'ghost'}
            onClick={() => setKillSwitchEnabled(!killSwitchEnabled, routeMarket)}
          >
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Kill switch
            </span>
            <span>{killSwitchEnabled ? 'ON' : 'OFF'}</span>
          </Button>
          <Button
            className="w-full justify-between"
            variant="ghost"
            disabled={positions.length === 0}
            onClick={() => runLiveCheck({ targetMarketId: routeMarket })}
          >
            <span className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Controlla ora
            </span>
            <span>Live</span>
          </Button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-[var(--market-accent)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Posizioni monitorate
            </p>
          </div>
          <Badge>{positions.length}</Badge>
        </div>
        <div className="mt-3 space-y-2">
          {positions.length > 0 ? (
            positions.slice(0, 5).map((position) => {
              const pnl = Number(position.unrealizedPnl)
              const pnlReady = Number.isFinite(pnl)
              const pnlColor =
                pnl >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'

              return (
                <div
                  key={position.id}
                  className="rounded-lg border border-slate-800 bg-[#090b10] p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-white">
                      {position.ticker}
                    </p>
                    <Badge variant={position.type === 'LONG' ? 'positive' : 'negative'}>
                      {position.type === 'LONG' ? 'Long' : 'Short'}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>{position.daysHeld || 0} giorni</span>
                    <span className={pnlReady ? pnlColor : 'text-slate-500'}>
                      {pnlReady ? currencyFormatter.format(pnl) : 'P/L dopo check'}
                    </span>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="rounded-lg border border-slate-800 bg-[#090b10] p-2 text-xs leading-5 text-slate-500">
              Nessuna posizione aperta nel mercato attivo.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
