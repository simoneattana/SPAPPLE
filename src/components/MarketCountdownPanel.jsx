import { useEffect, useState } from 'react'
import { Clock3, RefreshCw, ServerCog, Signal } from 'lucide-react'
import { Badge } from './ui/Badge'
import {
  CRYPTO_AUTO_LONG_RSI_LIMIT,
  CRYPTO_AUTO_SHORT_RSI_LIMIT,
  CRYPTO_MAX_AUTO_ATR_PCT,
} from '../services/cryptoRules'
import { getMarketCopy } from '../services/marketCopy'
import { getTradingStrategy } from '../strategies'
import { useTrading } from '../context/useTrading'

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

function formatCountdown(target) {
  if (!target) {
    return 'In attesa'
  }

  const remainingMs = new Date(target).getTime() - Date.now()

  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 'Ora'
  }

  return formatDuration(Math.ceil(remainingMs / 1000))
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

function getScanSummary({ lastScanAt, lastScanCount, lastSignalCount, marketId }) {
  if (!lastScanAt) {
    return 'Non ho ancora una scansione salvata per questo mercato.'
  }

  if (lastSignalCount <= 0) {
    return `${lastScanCount} asset analizzati nell’ultima scansione. Nessun segnale apribile ora.`
  }

  if (marketId === 'crypto') {
    return `${lastSignalCount} segnali visibili. Il pilota apre solo se RSI <= ${CRYPTO_AUTO_LONG_RSI_LIMIT} o >= ${CRYPTO_AUTO_SHORT_RSI_LIMIT}, ATR entro ${CRYPTO_MAX_AUTO_ATR_PCT}% e liquidità ok.`
  }

  return `${lastSignalCount} segnali visibili. Il pilota apre solo se rischio, slot, cooldown e qualità del segnale lo consentono.`
}

function CountdownMetric({ detail, icon: Icon, label, value, variant = 'default' }) {
  const valueClass =
    variant === 'muted' ? 'text-white' : 'text-[var(--market-accent)]'

  return (
    <div className="min-h-28 rounded-lg border border-slate-800 bg-[#090b10] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        <Icon className="h-4 w-4 text-[var(--market-accent)]" />
      </div>
      <p className={`mt-3 text-2xl font-semibold leading-none ${valueClass}`}>
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  )
}

export function MarketCountdownPanel({ marketId }) {
  const { markets, remoteStatus } = useTrading()
  const readableRemoteStatus = formatRemoteStatus(remoteStatus)
  const [, setNow] = useState(Date.now())
  const strategy = getTradingStrategy(marketId)
  const marketState = markets?.[strategy.id] || {}
  const marketCopy = getMarketCopy(strategy.id)
  const positions = Array.isArray(marketState.positions)
    ? marketState.positions
    : EMPTY_ARRAY
  const isChecking = Boolean(marketState.isChecking)
  const isScanning = Boolean(marketState.isScanning)
  const lastAutomationMessage = marketState.lastAutomationMessage || null
  const lastBackendCheckAt = marketState.lastBackendCheckAt || null
  const lastScanAt = marketState.lastScanAt || null
  const lastScanCount = Number(marketState.lastScanCount || 0)
  const lastSignalCount = Number(marketState.lastSignalCount || 0)
  const nextLiveCheckAt = marketState.nextLiveCheckAt || null
  const nextScanAt = marketState.nextScanAt || null
  const scanSummary = getScanSummary({
    lastScanAt,
    lastScanCount,
    lastSignalCount,
    marketId: strategy.id,
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="rounded-lg border border-[var(--market-accent-border)] bg-slate-950 p-4 shadow-xl shadow-black/20">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-[var(--market-accent)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--market-accent)]">
              Regia rapida {marketCopy.scanMode}
            </p>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {scanSummary}
          </p>
        </div>
        <Badge variant={isScanning || isChecking ? 'default' : 'positive'}>
          {isScanning || isChecking ? 'In corso' : 'Automatico'}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CountdownMetric
          detail="Aggiorna dati esterni, RSI, ATR e segnali."
          icon={RefreshCw}
          label="Nuova scansione"
          value={formatCountdown(nextScanAt)}
        />
        <CountdownMetric
          detail={
            positions.length > 0
              ? `${positions.length} posizioni aperte sotto controllo.`
              : 'Parte solo quando ci sono posizioni aperte.'
          }
          icon={Clock3}
          label="Prezzi posizioni"
          value={positions.length > 0 ? formatCountdown(nextLiveCheckAt) : 'Sospeso'}
        />
        <CountdownMetric
          detail={`${lastScanCount} analizzati · ${lastSignalCount} segnali`}
          icon={Signal}
          label="Ultima scansione"
          value={formatActivityDate(lastScanAt)}
          variant="muted"
        />
        <CountdownMetric
          detail={`Archivio: ${readableRemoteStatus}. Lavora anche ad app chiusa.`}
          icon={ServerCog}
          label="Backend remoto"
          value={formatActivityDate(lastBackendCheckAt)}
          variant="muted"
        />
      </div>

      {lastAutomationMessage ? (
        <p className="mt-3 rounded-lg border border-slate-800 bg-[#090b10] p-3 text-xs leading-5 text-slate-400">
          {lastAutomationMessage}
        </p>
      ) : null}
    </section>
  )
}
