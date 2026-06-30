import { useState } from 'react'
import { Building2, Coins, ExternalLink, Info, X } from 'lucide-react'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { getTickerMetadata, mergeTickerProfile } from '../services/tickerMetadata'

function InfoRow({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">
        {value || 'Non disponibile'}
      </p>
    </div>
  )
}

export function TickerInfo({ ticker, profile, compact = false, assetType = 'societa' }) {
  const [open, setOpen] = useState(false)
  const isCrypto = assetType === 'crypto'
  const fallbackProfile = getTickerMetadata(ticker)
  const tickerProfile = mergeTickerProfile(ticker, {
    ...fallbackProfile,
    ...(profile || {}),
  })

  return (
    <>
      <div className="flex min-w-44 items-center gap-3">
        <div>
          <p className="font-semibold text-white">{ticker}</p>
          <p className="mt-1 max-w-48 truncate text-xs text-slate-500">
            {tickerProfile.name || (isCrypto ? 'Asset non disponibile' : 'Società non disponibile')}
          </p>
          {!compact && !isCrypto ? (
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-600">
              ISIN {tickerProfile.isin || 'non disponibile'}
            </p>
          ) : null}
        </div>
        <Button
          aria-label={`Apri dettagli ${ticker}`}
          className="h-8 w-8 shrink-0 p-0"
          size="icon"
          variant="ghost"
          onClick={() => setOpen(true)}
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-lg border border-slate-800 bg-[#090b10] shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
                  {isCrypto ? (
                    <Coins className="h-5 w-5 text-[var(--market-accent)]" />
                  ) : (
                    <Building2 className="h-5 w-5 text-[var(--market-accent)]" />
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    {isCrypto ? 'Scheda asset crypto' : 'Scheda titolo'}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    {tickerProfile.name || ticker}
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{ticker}</Badge>
                    <Badge>
                      {isCrypto
                        ? 'Coppia Kraken'
                        : tickerProfile.isin || 'ISIN non disponibile'}
                    </Badge>
                  </div>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {!isCrypto ? <InfoRow label="ISIN" value={tickerProfile.isin} /> : null}
              <InfoRow label="Paese" value={tickerProfile.country} />
              <InfoRow label="Settore" value={tickerProfile.sector} />
              <InfoRow label="Industria" value={tickerProfile.industry} />
            </div>

            {tickerProfile.description ? (
              <div className="border-t border-slate-800 px-5 py-4">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  Profilo sintetico
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {tickerProfile.description}
                </p>
              </div>
            ) : null}

            {tickerProfile.website ? (
              <div className="border-t border-slate-800 p-5">
                <a
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--market-accent)] hover:text-[var(--market-accent-hover)]"
                  href={tickerProfile.website}
                  rel="noreferrer"
                  target="_blank"
                >
                  {isCrypto ? 'Sito progetto' : 'Sito aziendale'}
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
