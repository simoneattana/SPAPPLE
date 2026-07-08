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
import {
  getMarketCloseGuardLabel,
  getMarketScanStartLabel,
  getNextMarketScanAt,
  isMarketCloseGuardActive,
  isMarketScanBlocked,
} from '../services/marketHours'
import { getTradingStrategy } from '../strategies'

const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const EMPTY_ARRAY = []

function formatActivityDate(value) {
  if (!value) {
    return 'Mai'
  }

  return dateTimeFormatter.format(new Date(value))
}

function formatRemoteStatus(status) {
  const text = String(status || 'disconnesso')

  if (
    text.includes('<!DOCTYPE') ||
    text.includes('<html') ||
    text.toLowerCase().includes('bad gateway')
  ) {
    return 'errore temporaneo Supabase'
  }

  return text.length > 70 ? `${text.slice(0, 70)}...` : text
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

function getMarketOperatingWindowStatus(strategy, now = new Date()) {
  const scanBlocked = isMarketScanBlocked(strategy, now)
  const closeGuardActive = isMarketCloseGuardActive(strategy, now)
  const nextScanAt = getNextMarketScanAt(strategy, now)
  const secondsUntilNextScan = Math.ceil((nextScanAt.getTime() - now.getTime()) / 1000)

  if (closeGuardActive) {
    return {
      isStopped: true,
      title: `Protezione ${getMarketCloseGuardLabel(strategy)} attiva`,
      detail:
        'Nuove aperture bloccate. Spapple valuta solo chiusure prudenti con risk score pre-chiusura.',
      countdownLabel: 'Ripartenza',
      countdown: formatDuration(secondsUntilNextScan),
      badge: 'Protezione',
    }
  }

  if (scanBlocked) {
    return {
      isStopped: true,
      title: `Mercato in attesa di ${getMarketScanStartLabel(strategy)}`,
      detail:
        'Il pilota non apre nuove posizioni fuori dalla finestra operativa del mercato selezionato.',
      countdownLabel: 'Ripartenza',
      countdown: formatDuration(secondsUntilNextScan),
      badge: 'Fermo',
    }
  }

  return {
    isStopped: false,
    title: 'Finestra operativa attiva',
    detail:
      'Spapple può aprire solo segnali idonei. La protezione pre-chiusura partirà automaticamente.',
    countdownLabel: 'Prossima soglia',
    countdown: 'Attiva',
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
    runAutomatedScan,
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
  const lastSyncAt = marketState.lastSyncAt || null
  const lastScanAt = marketState.lastScanAt || null
  const lastSignalCount = Number(marketState.lastSignalCount || 0)
  const lastLiveCheckAt = marketState.lastLiveCheckAt || null
  const lastBackendCheckAt = marketState.lastBackendCheckAt || null
  const readableRemoteStatus = formatRemoteStatus(remoteStatus)
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
  const marketWindowStatus = getMarketOperatingWindowStatus(strategy, new Date())

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

      {marketWindowStatus ? (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            marketWindowStatus.isStopped
              ? 'border-[#ef8f8f]/40 bg-[#2a1217]'
              : 'border-[var(--market-accent-border)] bg-slate-950'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock3
                className={`h-4 w-4 ${
                  marketWindowStatus.isStopped
                    ? 'text-[#ef8f8f]'
                    : 'text-[var(--market-accent)]'
                }`}
              />
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Finestra mercato
              </p>
            </div>
            <Badge variant={marketWindowStatus.isStopped ? 'negative' : 'positive'}>
              {marketWindowStatus.badge}
            </Badge>
          </div>
          <p className="mt-2 text-sm font-semibold text-white">
            {marketWindowStatus.title}
          </p>
          <div className="mt-2 rounded-lg border border-slate-800 bg-[#090b10] p-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              {marketWindowStatus.countdownLabel}
            </p>
            <p
              className={`mt-1 text-lg font-semibold ${
                marketWindowStatus.isStopped
                  ? 'text-[#ef8f8f]'
                  : 'text-[var(--market-accent)]'
              }`}
            >
              {marketWindowStatus.countdown}
            </p>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {marketWindowStatus.detail}
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
          {readableRemoteStatus}
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Esecuzione manuale
        </p>
        <div className="mt-3 space-y-2">
          <Button
            className="w-full justify-between"
            variant="default"
            disabled={isScanning}
            onClick={() => runAutomatedScan(routeMarket)}
          >
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Aggiorna scansione
            </span>
            <span>{marketCopy.scanMode}</span>
          </Button>
          <Button
            className="w-full justify-between"
            variant="ghost"
            disabled={positions.length === 0 || isChecking}
            onClick={() => runLiveCheck({ targetMarketId: routeMarket })}
          >
            <span className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Controlla posizioni
            </span>
            <span>Live</span>
          </Button>
        </div>
      </div>
    </section>
  )
}
