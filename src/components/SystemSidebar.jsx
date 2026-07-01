import { useEffect, useState } from 'react'
import {
  Bot,
  Clock3,
  ListChecks,
  RefreshCw,
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

const EMPTY_ARRAY = []
const EQUITIES_GUARD_TIMEZONE = 'Europe/Rome'
const EQUITIES_STOP_MINUTES = 16 * 60 + 25
const EQUITIES_REOPEN_MINUTES = 6 * 60

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

function getRomeClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: EQUITIES_GUARD_TIMEZONE,
  }).formatToParts(date)

  return {
    hour: Number(parts.find((part) => part.type === 'hour')?.value),
    minute: Number(parts.find((part) => part.type === 'minute')?.value),
    second: Number(parts.find((part) => part.type === 'second')?.value),
  }
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function getEquitiesSessionStatus(now = new Date()) {
  const { hour, minute, second } = getRomeClockParts(now)

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null
  }

  const currentSeconds = hour * 3600 + minute * 60 + second
  const stopSeconds = EQUITIES_STOP_MINUTES * 60
  const reopenSeconds = EQUITIES_REOPEN_MINUTES * 60

  if (currentSeconds < reopenSeconds) {
    return {
      isStopped: true,
      title: 'Azioni ferme fino alle 06:00',
      detail: 'Il mondo azionario resta in protezione: nessuna nuova apertura prima della prossima finestra operativa.',
      countdownLabel: 'Ripartenza',
      countdown: formatDuration(reopenSeconds - currentSeconds),
      badge: 'Fermo',
    }
  }

  if (currentSeconds >= stopSeconds) {
    const secondsUntilReopen = 24 * 3600 - currentSeconds + reopenSeconds

    return {
      isStopped: true,
      title: 'Azioni ferme fino alle 06:00',
      detail: 'Protezione 16:25 attiva: Spapple non apre nuove posizioni azionarie e chiude quelle ancora aperte al primo controllo utile.',
      countdownLabel: 'Ripartenza',
      countdown: formatDuration(secondsUntilReopen),
      badge: 'Fermo',
    }
  }

  return {
    isStopped: false,
    title: 'Finestra azionaria attiva',
    detail: 'Dopo le 16:25 Spapple bloccherà nuove aperture azionarie e proteggerà le posizioni aperte.',
    countdownLabel: 'Stop alle 16:25',
    countdown: formatDuration(stopSeconds - currentSeconds),
    badge: 'Attivo',
  }
}

function getOperatingState({
  engineStatus,
  isChecking,
  isScanning,
  marketCopy,
  positions,
}) {
  if (engineStatus?.toLowerCase().includes('errore')) {
    return {
      title: engineStatus,
      detail: `Serve una nuova scansione ${marketCopy.label} quando i dati tornano disponibili.`,
      variant: 'negative',
    }
  }

  if (isScanning) {
    return {
      title: 'Scansione dati in corso',
      detail: `Sto interrogando ${marketCopy.provider}. Aggiorno la dashboard appena arrivano dati reali.`,
      variant: 'default',
    }
  }

  if (isChecking) {
    return {
      title: 'Controllo prezzi in corso',
      detail: `Sto verificando target e stop sulle posizioni aperte.`,
      variant: 'default',
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
    title: 'Pilota automatico pronto',
    detail: 'Scansiono il mercato a intervalli regolari e apro solo segnali validi.',
    variant: 'positive',
  }
}

function getNextAction({
  isScanning,
  lastScanAt,
  lastSignalCount,
  positions,
}) {
  if (isScanning) {
    return 'Sto aggiornando i dati esterni. Appena arrivano, valuto segnali e possibili aperture.'
  }

  if (positions.length > 0) {
    return 'Sto monitorando le posizioni aperte. Se un prezzo tocca take profit o stop loss, chiudo automaticamente.'
  }

  if (lastScanAt && lastSignalCount > 0) {
    return 'Ho segnali recenti disponibili. Apro automaticamente solo quelli abbastanza forti e compatibili con i limiti rischio.'
  }

  return 'Cercherò nuovi segnali al prossimo aggiornamento programmato.'
}

export function SystemSidebar() {
  const {
    activeMarket,
    markets,
    remoteStatus,
    runLiveCheck,
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
  const positions = Array.isArray(marketState.positions)
    ? marketState.positions
    : EMPTY_ARRAY
  const engineStatus = marketState.engineStatus || 'In attesa'
  const isChecking = Boolean(marketState.isChecking)
  const isScanning = Boolean(marketState.isScanning)
  const lastAutomationMessage = marketState.lastAutomationMessage || null
  const lastDataProvider = marketState.lastDataProvider || marketCopy.provider
  const lastSyncAt = marketState.lastSyncAt || null
  const lastScanAt = marketState.lastScanAt || null
  const lastSignalCount = Number(marketState.lastSignalCount || 0)
  const lastLiveCheckAt = marketState.lastLiveCheckAt || null
  const lastBackendCheckAt = marketState.lastBackendCheckAt || null
  const nextScanAt = marketState.nextScanAt || null
  const nextLiveCheckAt = marketState.nextLiveCheckAt || null
  const marketLabel = marketState.marketLabel || strategy.label
  const operatingState = getOperatingState({
    engineStatus,
    isChecking,
    isScanning,
    marketCopy,
    positions,
  })
  const nextAction = getNextAction({
    isScanning,
    lastScanAt,
    lastSignalCount,
    positions,
  })
  const equitiesSessionStatus =
    routeMarket === 'equities' ? getEquitiesSessionStatus(new Date()) : null

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
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-[var(--market-accent)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Prossimi dati
            </p>
          </div>
          <Badge variant={isScanning || isChecking ? 'default' : 'positive'}>
            {isScanning || isChecking ? 'In corso' : 'Auto'}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
          <div className="rounded-lg border border-slate-800 bg-[#090b10] p-2">
            <p>Scansione</p>
            <p className="mt-1 font-semibold text-[var(--market-accent)]">
              {formatCountdown(nextScanAt)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#090b10] p-2">
            <p>Prezzi live</p>
            <p className="mt-1 font-semibold text-[var(--market-accent)]">
              {positions.length > 0 ? formatCountdown(nextLiveCheckAt) : 'In attesa'}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          {lastAutomationMessage ||
            `Aspetto il prossimo aggiornamento da ${lastDataProvider}.`}
        </p>
      </div>

      {equitiesSessionStatus ? (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            equitiesSessionStatus.isStopped
              ? 'border-[#ef8f8f]/40 bg-[#2a1217]'
              : 'border-[var(--market-accent-border)] bg-slate-950'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock3
                className={`h-4 w-4 ${
                  equitiesSessionStatus.isStopped
                    ? 'text-[#ef8f8f]'
                    : 'text-[var(--market-accent)]'
                }`}
              />
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Orario azioni
              </p>
            </div>
            <Badge variant={equitiesSessionStatus.isStopped ? 'negative' : 'positive'}>
              {equitiesSessionStatus.badge}
            </Badge>
          </div>
          <p className="mt-2 text-sm font-semibold text-white">
            {equitiesSessionStatus.title}
          </p>
          <div className="mt-2 rounded-lg border border-slate-800 bg-[#090b10] p-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              {equitiesSessionStatus.countdownLabel}
            </p>
            <p
              className={`mt-1 text-lg font-semibold ${
                equitiesSessionStatus.isStopped
                  ? 'text-[#ef8f8f]'
                  : 'text-[var(--market-accent)]'
              }`}
            >
              {equitiesSessionStatus.countdown}
            </p>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {equitiesSessionStatus.detail}
          </p>
        </div>
      ) : null}

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
        <p className="mt-2 text-[11px] text-slate-600">
          Sync: {formatActivityDate(lastSyncAt || lastLiveCheckAt)} · Backend:{' '}
          {formatActivityDate(lastBackendCheckAt)} · Archivio:{' '}
          {remoteStatus}
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Esecuzione manuale
        </p>
        <div className="mt-3">
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
    </section>
  )
}
