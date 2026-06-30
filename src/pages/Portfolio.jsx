import { useState } from 'react'
import { CalendarClock, Loader2, Play, Target, Wallet } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { TickerInfo } from '../components/TickerInfo'
import { useToast } from '../components/ui/useToast'
import { useTrading } from '../context/useTrading'
import { fetchMarketData } from '../services/api'
import { fetchCryptoMarketData } from '../services/cryptoApi'
import {
  isCryptoActionableResult,
  isCryptoAutoEligibleResult,
  sortByCryptoAutoScore,
} from '../services/cryptoRules'
import { CRYPTO_TICKERS } from '../services/cryptoUniverse'
import { EUROPEAN_TICKERS } from '../services/marketUniverse'
import { getMarketCopy } from '../services/marketCopy'
import { getTradingStrategy } from '../strategies'
import {
  isActionableResult,
  isAutoEligibleResult,
  sortByAutoScore,
} from '../services/tradingRules'

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

function PnlMetric({ value }) {
  const pnl = Number(value)
  const color = pnl >= 0 ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
        P/L Latente
      </p>
      <p className={`mt-2 text-base font-semibold ${color}`}>
        {Number.isFinite(pnl)
          ? currencyFormatter.format(pnl)
          : 'In attesa aggiornamento'}
      </p>
    </div>
  )
}

export default function Portfolio({ marketId }) {
  const {
    closePositionManually,
    executeAutomatedTrades,
    activeMarket,
    markets,
    recordScanComplete,
    recordScanError,
    recordScanStart,
    runEOD,
    maxPositions,
  } = useTrading()
  const { toast } = useToast()
  const [runningEOD, setRunningEOD] = useState(false)
  const [closingId, setClosingId] = useState(null)
  const effectiveMarket = marketId || activeMarket
  const effectiveStrategy = getTradingStrategy(effectiveMarket)
  const effectiveMarketLabel = effectiveStrategy.label
  const routeMarketState = markets?.[effectiveMarket] || {}
  const routeAutomationEnabled =
    typeof routeMarketState.automationEnabled === 'boolean'
      ? routeMarketState.automationEnabled
      : true
  const marketCopy = getMarketCopy(effectiveMarket)
  const visiblePositions = Array.isArray(routeMarketState.positions)
    ? routeMarketState.positions
    : []
  const visibleCapital = currencyFormatter.format(
    Number.isFinite(Number(routeMarketState.capital))
      ? Number(routeMarketState.capital)
      : effectiveStrategy.initialCapital,
  )
  const visibleVault = currencyFormatter.format(
    Number.isFinite(Number(routeMarketState.vault))
      ? Number(routeMarketState.vault)
      : 0,
  )
  const visibleMaxPositions = effectiveStrategy.maxPositions || maxPositions
  const routeMarketLabel = routeMarketState.marketLabel || effectiveMarketLabel

  const handleRunEOD = async () => {
    setRunningEOD(true)

    try {
      await runEOD(effectiveMarket)
      toast({
        title:
          effectiveMarket === 'crypto'
            ? 'Controllo Crypto completato. Posizioni aggiornate.'
            : 'Elaborazione EOD completata. Posizioni aggiornate.',
      })
    } catch (error) {
      toast({
        title:
          error.message ||
          (effectiveMarket === 'crypto'
            ? 'Errore durante il Controllo Crypto'
            : 'Errore durante il Motore EOD'),
        variant: 'destructive',
      })
    } finally {
      setRunningEOD(false)
    }
  }

  const refillAfterManualClose = async (closedTicker) => {
    if (!routeAutomationEnabled) {
      return
    }

    const config =
      effectiveMarket === 'crypto'
        ? {
            universe: CRYPTO_TICKERS,
            fetcher: fetchCryptoMarketData,
            isActionable: isCryptoActionableResult,
            isAutoEligible: isCryptoAutoEligibleResult,
            sortByScore: sortByCryptoAutoScore,
          }
        : {
            universe: EUROPEAN_TICKERS,
            fetcher: fetchMarketData,
            isActionable: isActionableResult,
            isAutoEligible: isAutoEligibleResult,
            sortByScore: sortByAutoScore,
          }

    recordScanStart(config.universe.length, effectiveMarket)

    try {
      const marketData = await config.fetcher(config.universe)
      const actionableRows = marketData.filter(config.isActionable)
      const automaticRows = config.sortByScore(
        marketData.filter(
          (row) => config.isAutoEligible(row) && row.ticker !== closedTicker,
        ),
      )

      recordScanComplete(
        {
          scannedCount: marketData.length,
          signalCount: actionableRows.length,
          results: marketData,
        },
        effectiveMarket,
      )

      const { openedTrades } = executeAutomatedTrades(
        automaticRows,
        effectiveMarket,
      )

      toast({
        title:
          openedTrades.length > 0
            ? `Slot riempito: ${openedTrades[0].ticker} aperto dal pilota`
            : `Slot libero: nessun nuovo ${marketCopy.assetSingular} abbastanza forte`,
      })
    } catch (error) {
      recordScanError(error.message, effectiveMarket)
      toast({
        title: 'Chiusura eseguita, ma nuova scansione non riuscita',
        variant: 'destructive',
      })
    }
  }

  const handleManualClose = async (position) => {
    setClosingId(position.id)

    try {
      const closedTrade = await closePositionManually(position.id, effectiveMarket)

      toast({
        title: `${position.ticker} chiuso manualmente: ${currencyFormatter.format(
          closedTrade.pnlEur,
        )}`,
      })

      await refillAfterManualClose(position.ticker)
    } catch (error) {
      toast({
        title: error.message || 'Chiusura manuale non riuscita',
        variant: 'destructive',
      })
    } finally {
      setClosingId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="flex flex-col gap-5 rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            Portafoglio virtuale · {marketCopy.eyebrow}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            Portafoglio {routeMarketLabel}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Gestione separata di capitale, posizioni, target e stop per{' '}
            {routeMarketLabel}.
          </p>
        </div>

        <Button
          onClick={handleRunEOD}
          disabled={visiblePositions.length === 0 || runningEOD}
        >
          {runningEOD ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {effectiveMarket === 'crypto'
            ? 'Esegui Controllo Crypto'
            : 'Esegui Motore EOD (Fine Giornata)'}
        </Button>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <CardTitle>Capitale Operativo</CardTitle>
            <Wallet className="h-5 w-5 text-[var(--market-accent)]" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-[var(--market-accent)]">
              {visibleCapital}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <CardTitle>Salvadanaio Profitti</CardTitle>
            <Target className="h-5 w-5 text-[var(--market-accent)]" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-[var(--market-accent)]">
              {visibleVault}
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
              {visiblePositions.length} / {visibleMaxPositions}
            </p>
          </CardContent>
        </Card>
      </section>

      {visiblePositions.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visiblePositions.map((position) => (
            <Card key={position.id}>
              <CardHeader className="items-start justify-between gap-4 border-b border-slate-800">
                <div>
                  <TickerInfo
                    assetType={marketCopy.assetType}
                    compact
                    ticker={position.ticker}
                    profile={position.profile}
                  />
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
                  label={
                    effectiveMarket === 'crypto'
                      ? 'Ultimo Prezzo Kraken'
                      : 'Ultimo Prezzo EOD'
                  }
                  value={
                    Number.isFinite(Number(position.latestPrice))
                      ? currencyFormatter.format(position.latestPrice)
                      : 'Non ancora aggiornato'
                  }
                />
                <PnlMetric value={position.unrealizedPnl} />
                <Metric
                  label="ATR Ingresso"
                  value={numberFormatter.format(position.atrAtEntry)}
                />
                <Metric
                  label="Giorni in Portafoglio"
                  value={`${position.daysHeld} giorni`}
                />
                <Button
                  variant="ghost"
                  disabled={closingId === position.id}
                  onClick={() => handleManualClose(position)}
                >
                  {closingId === position.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Chiudi ora e cerca nuovo {marketCopy.assetSingular}
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <section className="flex min-h-[420px] items-center justify-center rounded-lg border border-slate-800 bg-[#090b10] p-8 text-center shadow-xl shadow-black/20">
          <div>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
              <Wallet className="h-6 w-6 text-[var(--market-accent)]" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-white">
              Nessuna posizione attiva
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
              Apri una posizione dallo Scanner di Mercato{' '}
              {routeMarketLabel} per
              avviare il forward testing separato.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
